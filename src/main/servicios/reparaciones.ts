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
import { ahoraIso, interpretarDiaDeVencimiento, interpretarFechaDePeriodo, limpiar, normalizarTexto } from '../importacion/normalizar'
import { registrarLoQueNoViajo } from './adjuntos'
import { anotarEvento, encolar, guardarMarca, leerMarca } from '../sincronizacion/cola'
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

// ---------------------------------------------------------------------------
// Cuotas que la bajada dejó a medias (hasta la 15.4.2)
// ---------------------------------------------------------------------------

/** La marca que dice que `repararCuotasBajadasAMedias` ya corrió en esta base. */
const MARCA_CUOTAS_A_MEDIAS = 'reparacion:cuotas-bajadas-a-medias'

/**
 * Lo que la bajada de la planilla del mes no aplicaba hasta la 15.4.2, y que por eso quedó distinto en
 * cada computadora aunque la base de la agencia estuviera bien:
 *
 *  - `pago_fecha`: el pago cargado en otra sucursal llegaba como texto en CUANDO PAGO pero sin la
 *    fecha interpretada, que es lo que la planilla mira para dar la fila por paga. La fila seguía
 *    «Vencido» en todas las computadoras menos en la que cobró. Y al revés: un pago anulado allá
 *    vaciaba el texto acá pero dejaba la fecha, y la fila seguía paga.
 *  - `dia_vencimiento_numero`: un cambio de FECHA DE VENC hecho en otra computadora no movía la
 *    alerta de ésta.
 *  - `obs_pago`: OBS PAGO nunca se bajaba. El valor de la base sí quedaba en los datos crudos de la
 *    fila, así que se toma de ahí. Las filas con cambios propios sin subir no se tocan: lo que la
 *    persona escribió acá todavía no viajó y es lo que tiene que ganar.
 *  - `pagos.cuota_fila_id`: los pagos que llegaron de otra computadora entraban sin la fila que
 *    pagan, y la planilla sólo los encontraba si la póliza y el mes coincidían.
 *
 * Corre UNA vez por base (la bajada ya los mantiene al día desde esta versión). Devuelve cuántas filas
 * tocó, entre cuotas y pagos.
 */
export function repararCuotasBajadasAMedias(): number {
  if (leerMarca(MARCA_CUOTAS_A_MEDIAS)) return 0
  const base = db()
  const sinSubir = filasConCambiosSinSubir(base)
  const ahora = ahoraIso()
  let pagosAtados = 0
  let fechasDePago = 0
  let vencimientos = 0
  let observaciones = 0

  base.transaction(() => {
    // Los pagos de una cuota llevan «PAGO:<_ID de la fila>» (ver `cuotaDelPago` en pagos.ts); los
    // adelantos se atan al imputarlos y no se tocan.
    pagosAtados = base
      .prepare(
        `UPDATE pagos SET cuota_fila_id = substr(fila_id, 6), actualizado_en = ?
         WHERE cuota_fila_id IS NULL AND fila_id LIKE 'PAGO:%' AND fila_id NOT LIKE 'PAGO:ADELANTO:%' AND length(fila_id) > 5`,
      )
      .run(ahora).changes

    // De a tandas y no todas juntas: son todas las cuotas de todos los meses, cada una con sus datos
    // crudos, y esto corre al arrancar.
    const tanda = base.prepare(
      `SELECT c.id, c.periodo, c.pago, c.pago_fecha, c.dia_vencimiento, c.dia_vencimiento_numero, c.obs_pago,
              fc.fila_id AS cruda_id, fc.datos_json
       FROM cuotas_mes c LEFT JOIN filas_crudas fc ON fc.fila_id = c.fila_id
       WHERE c.id > ? ORDER BY c.id LIMIT 2000`,
    )
    const ponerFechaDePago = base.prepare('UPDATE cuotas_mes SET pago_fecha = ?, actualizado_en = ? WHERE id = ?')
    const ponerVencimiento = base.prepare('UPDATE cuotas_mes SET dia_vencimiento_numero = ?, actualizado_en = ? WHERE id = ?')
    const ponerObsPago = base.prepare('UPDATE cuotas_mes SET obs_pago = ?, actualizado_en = ? WHERE id = ?')
    /** Qué encabezado es OBS PAGO: cada planilla puede escribirlo distinto («OBS. PAGO», «NOTA DE PAGO»…). */
    const esObsPago = new Map<string, boolean>()

    for (let desde = 0; ; ) {
      const cuotas = tanda.all(desde) as Array<{
        id: number
        periodo: string
        pago: string | null
        pago_fecha: string | null
        dia_vencimiento: string | null
        dia_vencimiento_numero: number | null
        obs_pago: string | null
        cruda_id: string | null
        datos_json: string | null
      }>
      if (cuotas.length === 0) break
      desde = cuotas[cuotas.length - 1]!.id
      for (const cuota of cuotas) {
        // Sólo se completa lo que falta o se vacía lo que sobra: una fecha que ya está no se recalcula,
        // porque el cobro hecho en esta computadora la guarda con su propia regla de año.
        const pago = limpiar(cuota.pago)
        if (pago && !cuota.pago_fecha) {
          const periodo = /^\d{4}-\d{2}$/.test(cuota.periodo) ? cuota.periodo : null
          const iso = interpretarFechaDePeriodo(pago, periodo).iso
          if (iso) {
            ponerFechaDePago.run(iso, ahora, cuota.id)
            fechasDePago++
          }
        } else if (!pago && cuota.pago_fecha) {
          ponerFechaDePago.run(null, ahora, cuota.id)
          fechasDePago++
        }

        const dia = interpretarDiaDeVencimiento(cuota.dia_vencimiento)
        if (dia !== cuota.dia_vencimiento_numero) {
          ponerVencimiento.run(dia, ahora, cuota.id)
          vencimientos++
        }

        if (!cuota.cruda_id || !cuota.datos_json || sinSubir.has(cuota.cruda_id)) continue
        let datos: Record<string, unknown>
        try {
          datos = JSON.parse(cuota.datos_json) as Record<string, unknown>
        } catch {
          continue
        }
        for (const encabezado of Object.keys(datos)) {
          let es = esObsPago.get(encabezado)
          if (es === undefined) {
            es = resolverCampo(encabezado, 'MENSUAL') === 'obs_pago'
            esObsPago.set(encabezado, es)
          }
          if (!es) continue
          const enLaBase = limpiar(datos[encabezado])
          if (enLaBase !== limpiar(cuota.obs_pago)) {
            ponerObsPago.run(enLaBase || null, ahora, cuota.id)
            observaciones++
          }
          break
        }
      }
    }
    guardarMarca(MARCA_CUOTAS_A_MEDIAS, ahora)
  })()

  const tocadas = pagosAtados + fechasDePago + vencimientos + observaciones
  if (tocadas > 0) {
    anotarEvento(
      'reparacion',
      `Se completaron las cuotas que la sincronización había dejado a medias: ${fechasDePago} fechas de pago, ` +
        `${vencimientos} días de vencimiento, ${observaciones} OBS PAGO y ${pagosAtados} pagos atados a su fila.`,
    )
  }
  return tocadas
}

/** Lo que se repara cada vez que arranca la sincronización. */
export function repararAlArrancar(): void {
  repararColaContraPestanaInexistente()
  try {
    repararCuotasBajadasAMedias()
  } catch (error) {
    console.error('[reparaciones] No se pudieron completar las cuotas bajadas a medias:', error)
  }
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

// ---------------------------------------------------------------------------
// Renovaciones sin número que quedaron huérfanas (arreglo puntual, NO automático)
// ---------------------------------------------------------------------------
//
// `renovar()` (ver servicios/renovaciones.ts) acepta un número de póliza vacío —algunas compañías lo
// avisan después— y, sin período abierto, la póliza nueva queda sin `fila_id`. Antes del arreglo del
// importador (`anclarPolizaSinNumero`, en importacion/importador.ts), cuando el número real llegaba
// después en una fila de la hoja no había forma de engancharlo con esa póliza: se creaba una póliza
// aparte y la original quedaba huérfana —el barrido de `inactivarPolizas` la pasa a `activa = 0` sin
// ninguna baja anotada, así que la pantalla la muestra como BAJA «sin motivo cargado», sin fecha— en
// vez de RENOVADA, que es lo que pasó de verdad.
//
// Esto repara las que ya quedaron así en una base existente. A diferencia de las reparaciones de
// arriba, ACÁ NO HAY ENGANCHE: no se llama desde `repararAlArrancar` ni desde `repararDuplicados`. La
// coincidencia sale de adivinar por cliente + vehículo + compañía + vigencia superpuesta, no de una
// clave exacta (`fila_id`, `_ID`…) como las de arriba, así que antes de tocar la base de un cliente
// conviene que la vea una persona. `detectarRenovacionesHuerfanas` es de sólo lectura, para esa vista
// previa (y para que las pruebas chequeen la detección sin mutar nada); `repararRenovacionesHuerfanas`
// aplica el arreglo elegido: LIGAR la activa a la huérfana por `poliza_anterior_id`, exactamente lo que
// hace una renovación de verdad. No se borra ni se reasigna ninguna fila —la huérfana sigue existiendo
// con su propio id, así que un pago, un siniestro o un adjunto que ya la referenciara sigue intacto—,
// sólo cambia cómo la lee `polizasDe()` en clientes.ts: con `poliza_anterior_id` puesto, `tiene_sucesora`
// pasa a 1 y la pantalla la muestra RENOVADA en vez de BAJA. Es la opción menos destructiva posible.
//
// Recomendación para conectarla: una acción de administrador (un botón «Revisar y reparar» en alguna
// pantalla de mantenimiento) que primero muestre `detectarRenovacionesHuerfanas()` y recién después,
// con confirmación, corra `repararRenovacionesHuerfanas()` — NO una migración. Una migración corre sola
// al abrir la aplicación, sin que nadie la vea, y acá la coincidencia depende de datos (vigencias,
// compañía tal como quedó escrita) que pueden tener casos borde que conviene que alguien confirme la
// primera vez; además, a diferencia de una migración de esquema, no hace falta que corra en todas las
// bases ni una sola vez: es idempotente y se puede repetir después de importar más filas.

export interface RenovacionHuerfana {
  /** La póliza inactiva, sin número, que quedó mostrándose como BAJA sin motivo. */
  huerfanaId: number
  /** La póliza activa, con número, que en realidad la reemplazó. */
  activaId: number
  clienteId: number
  clienteNombre: string | null
  compania: string | null
  numeroActiva: string | null
  vigenciaHuerfana: { desde: string | null; hasta: string | null }
  vigenciaActiva: { desde: string | null; hasta: string | null }
}

interface PolizaParaHuerfanas {
  id: number
  cliente_id: number
  cliente_nombre: string | null
  vehiculo_id: number | null
  compania: string | null
  numero: string | null
  activa: number
  poliza_anterior_id: number | null
  vigencia_desde_iso: string | null
  vigencia_hasta_iso: string | null
}

/**
 * Las dos mitades de un posible par: pólizas inactivas sin número y sin ninguna baja ni sucesora
 * anotada (huérfanas candidatas), y pólizas activas con número que todavía no tienen anterior
 * (candidatas a ser la renovación que faltaba enganchar). El cruce entre las dos listas lo hace
 * `detectarRenovacionesHuerfanas`, en JS: acá sólo se trae lo que hace falta para cruzarlas.
 */
const SELECT_CANDIDATAS_HUERFANAS = `
  SELECT p.id, p.cliente_id, cl.nombre AS cliente_nombre, p.vehiculo_id, p.compania, p.numero, p.activa,
         p.poliza_anterior_id, p.vigencia_desde_iso, p.vigencia_hasta_iso
  FROM polizas p
  JOIN clientes cl ON cl.id = p.cliente_id
  WHERE p.vehiculo_id IS NOT NULL
    AND (
      (p.activa = 0 AND (p.numero IS NULL OR p.numero = '')
        AND NOT EXISTS (SELECT 1 FROM bajas b WHERE b.poliza_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM polizas s WHERE s.poliza_anterior_id = p.id))
      OR
      (p.activa = 1 AND p.numero IS NOT NULL AND p.numero <> '' AND p.poliza_anterior_id IS NULL)
    )
`

/** Dos vigencias se superponen (o son iguales); sin las dos fechas de las dos puntas no se adivina. */
function seSuperponen(a: { desde: string | null; hasta: string | null }, b: { desde: string | null; hasta: string | null }): boolean {
  if (!a.desde || !a.hasta || !b.desde || !b.hasta) return false
  return a.desde <= b.hasta && b.desde <= a.hasta
}

/**
 * Sólo lectura: qué pares detecta, sin tocar la base. Cliente + vehículo + compañía (normalizada) +
 * vigencia superpuesta; con más de una huérfana o más de una activa candidatas para el mismo grupo, no
 * se adivina ninguna (igual que `anclarPolizaSinNumero` en el importador: la ambigüedad se deja para
 * mirar a mano, nunca se resuelve sola).
 */
export function detectarRenovacionesHuerfanas(): RenovacionHuerfana[] {
  const filas = db().prepare(SELECT_CANDIDATAS_HUERFANAS).all() as PolizaParaHuerfanas[]
  const huerfanas = filas.filter((f) => f.activa === 0)
  const activas = filas.filter((f) => f.activa === 1)

  const claveDe = (f: PolizaParaHuerfanas) => `${f.cliente_id}|${f.vehiculo_id}|${normalizarTexto(f.compania)}`
  const agrupar = (lista: PolizaParaHuerfanas[]) => {
    const mapa = new Map<string, PolizaParaHuerfanas[]>()
    for (const f of lista) mapa.set(claveDe(f), [...(mapa.get(claveDe(f)) ?? []), f])
    return mapa
  }
  const huerfanasPorClave = agrupar(huerfanas)
  const activasPorClave = agrupar(activas)

  const pares: RenovacionHuerfana[] = []
  for (const [clave, grupoHuerfanas] of huerfanasPorClave) {
    const grupoActivas = activasPorClave.get(clave)
    if (!grupoActivas || grupoActivas.length !== 1 || grupoHuerfanas.length !== 1) continue
    const huerfana = grupoHuerfanas[0]!
    const activa = grupoActivas[0]!
    const vigenciaHuerfana = { desde: huerfana.vigencia_desde_iso, hasta: huerfana.vigencia_hasta_iso }
    const vigenciaActiva = { desde: activa.vigencia_desde_iso, hasta: activa.vigencia_hasta_iso }
    if (!seSuperponen(vigenciaHuerfana, vigenciaActiva)) continue
    pares.push({
      huerfanaId: huerfana.id,
      activaId: activa.id,
      clienteId: huerfana.cliente_id,
      clienteNombre: huerfana.cliente_nombre,
      compania: huerfana.compania,
      numeroActiva: activa.numero,
      vigenciaHuerfana,
      vigenciaActiva,
    })
  }
  return pares
}

/**
 * Aplica el arreglo: liga cada activa a su huérfana por `poliza_anterior_id`. Conservador —nunca borra
 * ni reasigna nada— e idempotente: correrla de nuevo no vuelve a tocar un par ya ligado (el `WHERE`
 * exige `poliza_anterior_id IS NULL`), así que se puede repetir después de una detección más nueva sin
 * pisar un enganche legítimo que haya puesto otra cosa mientras tanto. Devuelve cuántos pares ligó.
 *
 * Sin argumento, detecta y aplica en el mismo llamado; con la lista de una vista previa ya mostrada
 * (por ejemplo, la que confirmó una persona), aplica exactamente esos pares. NO se llama desde
 * `repararAlArrancar` ni desde `repararDuplicados`: ver la nota de arriba sobre por qué conviene una
 * acción de administrador antes que una migración automática.
 */
export function repararRenovacionesHuerfanas(pares: RenovacionHuerfana[] = detectarRenovacionesHuerfanas()): number {
  if (pares.length === 0) return 0
  const ahora = ahoraIso()
  let ligadas = 0
  db().transaction(() => {
    for (const par of pares) {
      const cambio = db()
        .prepare('UPDATE polizas SET poliza_anterior_id = ?, actualizado_en = ? WHERE id = ? AND poliza_anterior_id IS NULL AND activa = 1')
        .run(par.huerfanaId, ahora, par.activaId).changes
      if (cambio > 0) ligadas++
    }
  })()
  if (ligadas > 0) {
    anotarEvento(
      'reparacion',
      `${ligadas} pólizas sin número que habían quedado como BAJA sin motivo (una renovación sin período abierto cuyo número real no se llegó a enganchar) se marcan como RENOVADA.`,
    )
  }
  return ligadas
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
