// Arreglos de lo que dejaron versiones anteriores y hoy se sabe hacer bien. Corren al arrancar la
// sincronización y después de cada importación completa; en una base sana no tocan nada.
//
// Dos cosas, las dos de la 12.2:
//  - Los PAGOS que nunca viajaron. Hasta la 12.1, sin una pestaña IMPUTADOS que fuera una tabla por
//    fila, el pago quedaba sólo en la computadora que lo cobró; ahora viaja por «APP PAGOS» (ver
//    pagos.ts), y los que ya estaban se encolan una vez para que lleguen a las otras computadoras.
//  - Las BAJAS duplicadas. Cuando la misma fila se agregaba dos veces a BAJAS (ver `subirTanda`), la
//    importación le inventaba un _ID nuevo al segundo renglón y la póliza aparecía dos veces en la
//    pantalla de Bajas. Ya no se agrega dos veces; lo que quedó repetido se saca acá, de la base local
//    y de la base de la agencia.
//  - Las CUOTAS duplicadas de la 12.2: la planilla del mes mostraba cada fila dos veces. Cuando en la
//    hoja quedan dos pestañas del mismo mes (la de siempre y una copia), la importación le da un _ID
//    nuevo a cada renglón de la copia —es lo correcto: son renglones distintos— y la póliza termina con
//    dos cuotas del mismo período. Ahora la importación toma UNA sola planilla por mes (ver
//    `elegirPlanillaPorPeriodo` en el importador) y acá se sacan las copias que ya habían entrado.
import { db } from '../db/base'
import { anotarEvento, encolar } from '../sincronizacion/cola'
import { filasConCambiosSinSubir, PESTANA_APP, PREFIJO_DE_BAJA } from './filas'
import { subirPagosRezagados } from './pagos'

interface BajaRepetida {
  id: number
  fila_id: string
  poliza_id: number
  periodo: string
  hecha_en_la_app: number
  /** Dónde vive el renglón en la hoja, si está en ella; null si nunca viajó o ya no está. */
  pestana: string | null
}

/**
 * Elige cuál de las bajas repetidas de una póliza en un mes es la de verdad: la que hizo la aplicación,
 * si no la que lleva el _ID con el que la aplicación nombra a sus bajas, y si no la más vieja. Las
 * demás son copias.
 */
export function elegirBajaQueQueda<T extends { id: number; fila_id: string; hecha_en_la_app: number }>(grupo: T[]): T {
  const puntaje = (baja: T) => (baja.hecha_en_la_app === 1 ? 2 : 0) + (baja.fila_id.startsWith(PREFIJO_DE_BAJA) ? 1 : 0)
  return [...grupo].sort((a, b) => puntaje(b) - puntaje(a) || a.id - b.id)[0]!
}

/**
 * Saca las bajas repetidas: misma póliza y mismo mes más de una vez, cuando alguna de ellas es de la
 * aplicación (las repetidas que vienen de la hoja vieja de la agencia no se tocan: no son nuestras).
 * La copia se borra de acá y se encola su borrado en la hoja, así desaparece también en las otras
 * computadoras con la próxima bajada. Devuelve cuántas sacó.
 */
export function repararBajasDuplicadas(): number {
  const repetidas = db()
    .prepare(
      `SELECT b.id, b.fila_id, b.poliza_id, b.periodo, b.hecha_en_la_app,
              CASE WHEN fc.en_la_hoja = 1 THEN fc.pestana ELSE NULL END AS pestana
       FROM bajas b
       LEFT JOIN filas_crudas fc ON fc.fila_id = b.fila_id
       WHERE b.poliza_id IS NOT NULL AND b.periodo IS NOT NULL
         AND EXISTS (SELECT 1 FROM bajas o WHERE o.poliza_id = b.poliza_id AND o.periodo = b.periodo AND o.id <> b.id)
       ORDER BY b.poliza_id, b.periodo, b.id`,
    )
    .all() as BajaRepetida[]
  if (repetidas.length === 0) return 0

  const grupos = new Map<string, BajaRepetida[]>()
  for (const baja of repetidas) {
    const clave = `${baja.poliza_id}|${baja.periodo}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), baja])
  }
  const sinSubir = filasConCambiosSinSubir()
  let sacadas = 0
  db().transaction(() => {
    for (const grupo of grupos.values()) {
      if (!grupo.some((baja) => baja.hecha_en_la_app === 1 || baja.fila_id.startsWith(PREFIJO_DE_BAJA))) continue
      const queda = elegirBajaQueQueda(grupo)
      for (const copia of grupo) {
        if (copia.id === queda.id || sinSubir.has(copia.fila_id)) continue
        db().prepare('DELETE FROM bajas WHERE id = ?').run(copia.id)
        if (copia.pestana && copia.pestana !== PESTANA_APP) {
          encolar({ operacion: 'borrar', pestana: copia.pestana, filaId: copia.fila_id, campos: {} })
        }
        sacadas++
      }
    }
  })()
  if (sacadas > 0) {
    anotarEvento('reparacion', `Se sacaron ${sacadas} bajas que estaban repetidas (misma póliza y mismo mes); el renglón de más se borra de la base.`)
  }
  return sacadas
}

// ---------------------------------------------------------------------------
// Cuotas duplicadas: la misma póliza dos veces en el mismo mes
// ---------------------------------------------------------------------------

interface CuotaRepetida {
  id: number
  fila_id: string
  poliza_id: number
  periodo: string
  /** Dónde vive el renglón en la hoja, si está en ella; null si nunca viajó o ya no está. */
  pestana: string | null
  /**
   * Peso de la pestaña de la que salió ésta: cuántas cuotas del mes tiene, y muy por encima de eso si
   * son cuotas que abrió «Cerrar mes». La pestaña que la aplicación viene manteniendo es de donde
   * cuelgan los pagos y los adelantos; la que tiene un puñado es la copia o la del nombre viejo.
   */
  filas_de_la_pestana: number
  /** En qué renglón de la hoja está. El original está más arriba que la copia que alguien pegó debajo. */
  numero_fila: number
  /** 1 si de esta fila cuelga un cobro, una baja o un aviso de rechazo. Esa no se toca nunca. */
  atada: number
}

/**
 * Cuál de las cuotas repetidas de una póliza en un mes es la de verdad. El puntaje sale sólo de datos
 * que todas las computadoras ven igual —si dependiera del `id`, que es de cada base, Lanús y Dock Sud
 * elegirían distinto y se borrarían la fila una a la otra—:
 *
 *  1. La que tiene un cobro, una baja o un rechazo colgando: ahí hay plata y no se discute.
 *  2. La que está en la hoja, sobre la que quedó sólo en esta computadora.
 *  3. La que viene de la pestaña que concentra las cuotas del mes (la planilla que se sigue leyendo),
 *     sobre la que viene de la copia o de la pestaña con el nombre viejo.
 *  4. La que está más arriba en la hoja: el renglón original, no la copia pegada abajo.
 *  5. A igualdad, la del `fila_id` más chico, que es el mismo en todas las bases.
 */
export function elegirCuotaQueQueda<
  T extends { fila_id: string; pestana: string | null; filas_de_la_pestana: number; numero_fila: number; atada: number },
>(grupo: T[]): T {
  const puntaje = (cuota: T) => (cuota.atada === 1 ? 4 : 0) + (cuota.pestana ? 2 : 0)
  // Una fila sin renglón conocido (numero_fila 0, todavía sin viajar) va al final, no al principio.
  const renglon = (cuota: T) => (cuota.numero_fila > 0 ? cuota.numero_fila : Number.MAX_SAFE_INTEGER)
  return [...grupo].sort(
    (a, b) =>
      puntaje(b) - puntaje(a) ||
      b.filas_de_la_pestana - a.filas_de_la_pestana ||
      renglon(a) - renglon(b) ||
      a.fila_id.localeCompare(b.fila_id),
  )[0]!
}

/**
 * Saca las cuotas repetidas: la misma póliza más de una vez en el mismo mes. Se borra sólo la copia
 * que no tiene NADA colgando —ni un pago, ni una baja, ni un aviso de rechazo, ni un adelanto—, porque
 * borrar una que sí lo tenga haría desaparecer un cobro de la caja del día. Si las dos tienen algo, se
 * dejan las dos y queda anotado: eso lo mira una persona.
 *
 * El renglón se borra también de la hoja SÓLO cuando la copia está en la misma pestaña que la que
 * queda (dos renglones repetidos dentro de la planilla buena). Cuando la copia viene de otra pestaña
 * —el caso de la pestaña duplicada— alcanza con sacarla de acá: la importación ya no lee esa pestaña
 * como planilla del mes, así que no vuelve. Devuelve cuántas sacó.
 */
export function repararCuotasDuplicadas(): number {
  const repetidas = db()
    .prepare(
      `SELECT c.id, c.fila_id, c.poliza_id, c.periodo,
              CASE WHEN fc.en_la_hoja = 1 THEN fc.pestana ELSE NULL END AS pestana,
              COALESCE(fc.numero_fila, 0) AS numero_fila,
              (SELECT COUNT(*) + 1000000 * COALESCE(SUM(h.creada_en_la_app), 0)
                 FROM cuotas_mes h WHERE h.periodo = c.periodo AND h.pestana = c.pestana) AS filas_de_la_pestana,
              CASE WHEN EXISTS (SELECT 1 FROM pagos pg WHERE pg.cuota_fila_id = c.fila_id)
                     OR EXISTS (SELECT 1 FROM pagos pa WHERE pa.fila_id = 'PAGO:ADELANTO:' || c.fila_id)
                     OR EXISTS (SELECT 1 FROM bajas b WHERE b.cuota_fila_id = c.fila_id)
                     OR EXISTS (SELECT 1 FROM rechazos_debito rd WHERE rd.cuota_fila_id = c.fila_id)
                   THEN 1 ELSE 0 END AS atada
       FROM cuotas_mes c
       LEFT JOIN filas_crudas fc ON fc.fila_id = c.fila_id
       WHERE c.dada_de_baja = 0 AND c.poliza_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM cuotas_mes o
           WHERE o.poliza_id = c.poliza_id AND o.periodo = c.periodo AND o.dada_de_baja = 0 AND o.id <> c.id
         )
       ORDER BY c.poliza_id, c.periodo, c.fila_id`,
    )
    .all() as CuotaRepetida[]
  if (repetidas.length === 0) return 0

  const grupos = new Map<string, CuotaRepetida[]>()
  for (const cuota of repetidas) {
    const clave = `${cuota.poliza_id}|${cuota.periodo}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), cuota])
  }
  const sinSubir = filasConCambiosSinSubir()
  let sacadas = 0
  let conservadas = 0
  db().transaction(() => {
    for (const grupo of grupos.values()) {
      const queda = elegirCuotaQueQueda(grupo)
      for (const copia of grupo) {
        if (copia.fila_id === queda.fila_id) continue
        // Un cambio que todavía no viajó manda sobre lo que sabemos acá: esa fila no se toca hasta que suba.
        if (sinSubir.has(copia.fila_id)) {
          conservadas++
          continue
        }
        // Con un cobro, una baja o un rechazo colgando, borrarla sería perder el dato: se deja a la vista.
        if (copia.atada === 1) {
          conservadas++
          continue
        }
        db().prepare('DELETE FROM cuotas_mes WHERE id = ?').run(copia.id)
        // Sólo se borra el renglón de la hoja cuando es un repetido DENTRO de la planilla que queda.
        if (copia.pestana && copia.pestana !== PESTANA_APP && copia.pestana === queda.pestana) {
          encolar({ operacion: 'borrar', pestana: copia.pestana, filaId: copia.fila_id, campos: {} })
        }
        sacadas++
      }
    }
  })()
  if (sacadas > 0) {
    anotarEvento(
      'reparacion',
      `Se sacaron ${sacadas} cuotas que estaban repetidas (la misma póliza dos veces en el mismo mes). La planilla del mes vuelve a mostrar una fila por póliza.`,
    )
  }
  if (conservadas > 0) {
    anotarEvento(
      'reparacion',
      `Quedaron ${conservadas} cuotas repetidas sin sacar porque tienen un cobro, una baja o un aviso colgando: hay que mirarlas a mano en la planilla del mes.`,
    )
  }
  return sacadas
}

/**
 * Las entradas de la cola que apuntan a «(cargado en DM Gestión)», que no es ninguna pestaña. Hasta la
 * 12.1, deshacer o poner vigente una baja encolaba el borrado contra esa pestaña (la de la tabla, no
 * la del renglón) y la entrada quedaba en «no se pudo» para siempre, con la fila todavía en BAJAS en
 * todas las computadoras. Se les pone la pestaña donde el renglón vive de verdad y vuelven a la cola;
 * las que no tienen renglón conocido no se pueden subir nunca y se sacan. Devuelve cuántas se recuperaron.
 */
export function repararColaContraPestanaInexistente(): number {
  const rotas = db()
    .prepare(
      `SELECT c.id, fc.pestana AS real
       FROM cola_sync c LEFT JOIN filas_crudas fc ON fc.fila_id = c.fila_id
       WHERE c.estado IN ('pendiente', 'fallido') AND c.pestana = ?`,
    )
    .all(PESTANA_APP) as Array<{ id: number; real: string | null }>
  if (rotas.length === 0) return 0
  let recuperadas = 0
  db().transaction(() => {
    for (const rota of rotas) {
      if (rota.real && rota.real !== PESTANA_APP) {
        db()
          .prepare(`UPDATE cola_sync SET pestana = ?, estado = 'pendiente', intentos = 0, proximo_intento = NULL, ultimo_error = NULL WHERE id = ?`)
          .run(rota.real, rota.id)
        recuperadas++
      } else {
        db().prepare('DELETE FROM cola_sync WHERE id = ?').run(rota.id)
      }
    }
  })()
  if (recuperadas > 0) anotarEvento('reparacion', `${recuperadas} cambios que apuntaban a una pestaña inexistente vuelven a la cola, ahora hacia la pestaña donde vive el renglón.`)
  return recuperadas
}

/** Lo que se repara cada vez que arranca la sincronización. */
export function repararAlArrancar(): void {
  repararColaContraPestanaInexistente()
  const pagos = subirPagosRezagados()
  if (pagos > 0) anotarEvento('reparacion', `${pagos} pagos que habían quedado sólo en esta computadora se encolaron hacia la base.`)
  repararBajasDuplicadas()
  repararCuotasDuplicadas()
}
