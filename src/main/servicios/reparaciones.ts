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
import { resolverCampo, type Campo } from '../importacion/encabezados'
import { ahoraIso, limpiar } from '../importacion/normalizar'
import { registrarLoQueNoViajo } from './adjuntos'
import { anotarEvento, encolar } from '../sincronizacion/cola'
import { filasConCambiosSinSubir, PESTANA_APP, PREFIJO_DE_BAJA } from './filas'
import { claveDeVinculoDeTarea } from '../sincronizacion/vinculos'
import { repararClientesDuplicados } from './duplicados'
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
   * Peso de la pestaña de la que salió ésta: cuántos renglones tiene EN LA BASE (`filas_crudas` con
   * `en_la_hoja = 1`), que es lo que todas las computadoras ven igual. La que tiene un puñado es la
   * copia o la del nombre viejo. Hasta la 12.5 se contaban las cuotas de esta base, y dos
   * computadoras con distinto historial podían elegir distinto y borrarse la fila una a la otra.
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
              (SELECT COUNT(*) FROM filas_crudas h WHERE h.pestana = c.pestana AND h.en_la_hoja = 1) AS filas_de_la_pestana,
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

/** Las reparaciones de duplicados: al arrancar, después de cada importación (automática o a mano). */
export function repararDuplicados(): void {
  repararBajasDuplicadas()
  repararCuotasDuplicadas()
  repararClientesDuplicados()
}

/** Lo que se repara cada vez que arranca la sincronización. */
export function repararAlArrancar(): void {
  repararColaContraPestanaInexistente()
  const pagos = subirPagosRezagados()
  if (pagos > 0) anotarEvento('reparacion', `${pagos} pagos que habían quedado sólo en esta computadora se encolaron hacia la base.`)
  repararDuplicados()
  // 12.7: los siniestros que llegaron sin asegurado toman el de su póliza, y los cargados acá cuyos
  // datos no habían viajado (la pestaña no tenía la columna) se vuelven a mandar.
  repararSiniestros()
  try {
    reenviarVinculosDeTareas()
  } catch (error) {
    console.error('[reparaciones] No se pudieron reenviar los vínculos de las tareas:', error)
  }
  // 12.6: los adjuntos y comentarios de antes vivían sólo en esta PC. Ahora viajan como los nuevos.
  try {
    const anexos = registrarLoQueNoViajo()
    if (anexos.adjuntos > 0 || anexos.comentarios > 0) {
      anotarEvento('reparacion', `${anexos.adjuntos} adjuntos y ${anexos.comentarios} comentarios que estaban sólo en esta computadora se encolaron hacia la base.`)
    }
  } catch (error) {
    console.error('[reparaciones] No se pudieron registrar los adjuntos viejos:', error)
  }
}

// ---------------------------------------------------------------------------
// Siniestros que llegaron incompletos (12.7)
// ---------------------------------------------------------------------------

/**
 * Un siniestro que entró de la base con la póliza reconocida pero sin cliente (la pestaña no tenía
 * columna de nombre ni de documento) toma el cliente de la póliza, y con él el nombre y el documento
 * que le faltaban. Es local, idempotente y barato: corre al arrancar y después de cada importación.
 */
export function repararSiniestrosSinCliente(): number {
  const base = db()
  const ahora = ahoraIso()
  let cambios = 0
  base.transaction(() => {
    cambios += base
      .prepare(
        `UPDATE siniestros SET cliente_id = (SELECT cliente_id FROM polizas WHERE polizas.id = siniestros.poliza_id), actualizado_en = ?
         WHERE cliente_id IS NULL AND poliza_id IS NOT NULL
           AND (SELECT cliente_id FROM polizas WHERE polizas.id = siniestros.poliza_id) IS NOT NULL`,
      )
      .run(ahora).changes
    cambios += base
      .prepare(
        `UPDATE siniestros SET cliente_nombre = (SELECT nombre FROM clientes WHERE clientes.id = siniestros.cliente_id), actualizado_en = ?
         WHERE (cliente_nombre IS NULL OR TRIM(cliente_nombre) = '') AND cliente_id IS NOT NULL
           AND (SELECT nombre FROM clientes WHERE clientes.id = siniestros.cliente_id) IS NOT NULL`,
      )
      .run(ahora).changes
    cambios += base
      .prepare(
        `UPDATE siniestros SET documento = (SELECT documento FROM clientes WHERE clientes.id = siniestros.cliente_id), actualizado_en = ?
         WHERE (documento IS NULL OR TRIM(documento) = '') AND cliente_id IS NOT NULL
           AND (SELECT documento FROM clientes WHERE clientes.id = siniestros.cliente_id) IS NOT NULL`,
      )
      .run(ahora).changes
  })()
  if (cambios > 0) anotarEvento('reparacion', `${cambios} siniestros que estaban sin asegurado tomaron el titular de su póliza.`)
  return cambios
}

/** Cómo se llama en la hoja cada columna de la tabla `siniestros` que puede viajar. */
const CAMPOS_DEL_SINIESTRO: Array<{ columna: string; campo: Campo }> = [
  { columna: 'fecha', campo: 'fecha' },
  { columna: 'fecha_carga', campo: 'fecha_carga' },
  { columna: 'cliente_nombre', campo: 'nombre' },
  { columna: 'documento', campo: 'documento' },
  { columna: 'sucursal_texto', campo: 'sucursal' },
  { columna: 'patente', campo: 'patente' },
  { columna: 'compania', campo: 'compania' },
  { columna: 'numero_poliza', campo: 'numero_poliza' },
  { columna: 'cobertura', campo: 'cobertura' },
  { columna: 'numero_siniestro', campo: 'numero_siniestro' },
  { columna: 'descripcion', campo: 'descripcion' },
  { columna: 'estado', campo: 'estado' },
  { columna: 'importe', campo: 'importe' },
  { columna: 'observaciones', campo: 'observaciones' },
  { columna: 'abogado', campo: 'abogado' },
  { columna: 'tercero_compania', campo: 'tercero_compania' },
  { columna: 'tercero_telefono', campo: 'tercero_telefono' },
  { columna: 'tercero_patente', campo: 'tercero_patente' },
  { columna: 'tercero_lesionados', campo: 'tercero_lesionados' },
  { columna: 'tercero_lesionados_detalle', campo: 'tercero_lesionados_detalle' },
]

/**
 * Los siniestros cargados en ESTA computadora cuyos datos no llegaron enteros a la base: hasta la
 * 12.6 la subida descartaba los campos para los que la pestaña SINIESTROS no tenía columna (el
 * asegurado, la fecha del siniestro, el abogado…), y las otras computadoras los importaban en blanco.
 * Se compara lo que esta base sabe con lo que quedó escrito en la hoja (los datos crudos de la fila)
 * y lo que falta se vuelve a encolar; la subida de la 12.7 agrega la columna si no está.
 *
 * Idempotente: lo que ya está en la hoja no se manda de nuevo, y una fila con cambios esperando en
 * la cola se deja tranquila (se juntarían solos igual, pero no hace falta tocarla). Una fila cuyos
 * datos crudos quedaron en «{}» (subida con una versión anterior, que no los anotaba) se manda
 * entera UNA vez: la subida anota lo escrito y a la vuelta siguiente ya no falta nada.
 */
export function reenviarSiniestrosIncompletos(): number {
  const base = db()
  const sinSubir = filasConCambiosSinSubir(base)
  const filas = base
    .prepare(
      `SELECT s.fila_id, fc.pestana, fc.datos_json,
              s.fecha, s.fecha_carga, s.cliente_nombre, s.documento, s.sucursal_texto, s.patente, s.compania, s.numero_poliza,
              s.cobertura, s.numero_siniestro, s.descripcion, s.estado, s.importe, s.observaciones,
              s.abogado, s.tercero_compania, s.tercero_telefono, s.tercero_patente, s.tercero_lesionados, s.tercero_lesionados_detalle
       FROM siniestros s
       JOIN filas_crudas fc ON fc.fila_id = s.fila_id
       WHERE s.creado_en_la_app = 1 AND fc.en_la_hoja = 1`,
    )
    .all() as Array<Record<string, string | null> & { fila_id: string; pestana: string; datos_json: string }>

  let reenviados = 0
  for (const fila of filas) {
    if (sinSubir.has(fila.fila_id)) continue
    let datos: Record<string, string>
    try {
      datos = JSON.parse(fila.datos_json) as Record<string, string>
    } catch {
      continue
    }
    // Qué dice la hoja de cada campo: se busca la columna por su encabezado, con el mismo mapeo que
    // usa la importación, así «ASEGURADO» y «NOMBRE» cuentan como el mismo dato.
    const enLaHoja = new Map<Campo, string>()
    for (const [encabezado, valor] of Object.entries(datos)) {
      const campo = resolverCampo(encabezado, 'SINIESTROS')
      if (campo && !enLaHoja.has(campo) && limpiar(valor) !== '') enLaHoja.set(campo, limpiar(valor))
    }
    const faltan: Partial<Record<Campo, string>> = {}
    for (const { columna, campo } of CAMPOS_DEL_SINIESTRO) {
      const local = limpiar(fila[columna])
      if (!local || enLaHoja.has(campo)) continue
      faltan[campo] = local
    }
    if (Object.keys(faltan).length === 0) continue
    encolar({ operacion: 'actualizar', pestana: fila.pestana, filaId: fila.fila_id, campos: faltan })
    reenviados++
  }
  if (reenviados > 0) {
    anotarEvento('reparacion', `${reenviados} siniestros cargados en esta computadora tenían datos que no habían llegado a la base: se vuelven a mandar.`, { filas: reenviados })
  }
  return reenviados
}

/** Las dos reparaciones de siniestros juntas: la local y la que vuelve a mandar lo que faltó. */
export function repararSiniestros(): void {
  try {
    repararSiniestrosSinCliente()
    reenviarSiniestrosIncompletos()
  } catch (error) {
    console.error('[reparaciones] No se pudieron reparar los siniestros:', error)
  }
}

// ---------------------------------------------------------------------------
// Tareas que viajaron sin la clave de su vínculo (12.7)
// ---------------------------------------------------------------------------

/**
 * Las tareas cargadas antes de la 12.7 tienen su fila en APP TAREAS pero sin la columna VINCULO ID:
 * en las otras computadoras llegaron sueltas. Se les calcula la clave de sus id locales, se guarda y
 * se manda; la subida agrega la columna si la pestaña no la tiene. Una tarea suelta de verdad (sin
 * cliente ni póliza ni nada) no tiene clave y no se toca.
 */
export function reenviarVinculosDeTareas(): number {
  const base = db()
  const sinSubir = filasConCambiosSinSubir(base)
  const tareas = base
    .prepare(
      `SELECT id, fila_id, pestana, siniestro_id, renovacion_id, presupuesto_id, lead_id, poliza_id, cliente_id
       FROM tareas
       WHERE fila_id IS NOT NULL AND pestana IS NOT NULL AND (vinculo_clave IS NULL OR vinculo_clave = '')
         AND (siniestro_id IS NOT NULL OR renovacion_id IS NOT NULL OR presupuesto_id IS NOT NULL
              OR lead_id IS NOT NULL OR poliza_id IS NOT NULL OR cliente_id IS NOT NULL)`,
    )
    .all() as Array<{
    id: number
    fila_id: string
    pestana: string
    siniestro_id: number | null
    renovacion_id: number | null
    presupuesto_id: number | null
    lead_id: number | null
    poliza_id: number | null
    cliente_id: number | null
  }>
  let reenviadas = 0
  for (const tarea of tareas) {
    const clave = claveDeVinculoDeTarea(base, tarea)
    if (!clave) continue
    base.prepare('UPDATE tareas SET vinculo_clave = ? WHERE id = ?').run(clave, tarea.id)
    if (sinSubir.has(tarea.fila_id)) continue
    encolar({ operacion: 'actualizar', pestana: tarea.pestana, filaId: tarea.fila_id, campos: { vinculo_clave: clave } })
    reenviadas++
  }
  if (reenviadas > 0) anotarEvento('reparacion', `${reenviadas} tareas viajaban sin la clave de su vínculo: se manda ahora, así las otras computadoras las enganchan a su ficha.`)
  return reenviadas
}
