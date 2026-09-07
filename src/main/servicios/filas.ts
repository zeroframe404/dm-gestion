// Registro local de las filas que nacen en la aplicación (una póliza nueva, una renovación, el cierre
// de mes) antes de que la sincronización las suba a la hoja.
//
// Por qué hace falta: la bajada compara la hoja contra `filas_crudas` usando el `_ID`. Una fila que la
// aplicación escribió en la hoja pero que no está en `filas_crudas` se ve como «fila nueva que vino de
// otra computadora» y dispara una importación completa cada cinco minutos, para siempre. Anotándola
// acá en el mismo momento en que se crea, la bajada la reconoce y no pasa nada.
import type { TipoPestana } from '../../shared/tipos'
import { db, type BaseDeDatos } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import { borrarAnexoLocal, esPestanaDeAnexos } from '../sincronizacion/anexos'
import { borrarArchivoDeAdjunto } from './carpetaDeAdjuntos'

/**
 * Pestaña de origen que se le pone a lo que nació en la aplicación y todavía no tiene lugar en la
 * hoja (una baja, un pago cuando la hoja no tiene IMPUTADOS). No es el nombre de ninguna pestaña real.
 */
export const PESTANA_APP = '(cargado en DM Gestión)'

export interface FilaNuevaDeLaApp {
  filaId: string
  pestana: string
  tipoPestana: TipoPestana
  periodo: string | null
}

/**
 * Anota la fila como conocida pero todavía no presente en la hoja (`en_la_hoja = 0`, sin huella).
 * Cuando la subida la agregue, `registrarFilaSubida` le pone su número de fila y su huella reales.
 *
 * `datos_json` queda vacío a propósito: se guarda con los nombres de los encabezados de la pestaña, y
 * recién se sabe cuáles son al momento de escribirla en la hoja. Vacío es además lo correcto para la
 * comparación de conflictos: no había nada en la hoja antes, así que no hay nada que se pueda pisar.
 */
export function registrarFilaDeLaApp(fila: FilaNuevaDeLaApp): void {
  const ahora = ahoraIso()
  db()
    .prepare(
      `INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, periodo, numero_fila, datos_json, en_la_hoja, huella, creado_en, actualizado_en)
       VALUES (@fila_id, @pestana, @tipo_pestana, @periodo, 0, '{}', 0, NULL, @ahora, @ahora)
       ON CONFLICT(fila_id) DO NOTHING`,
    )
    .run({
      fila_id: fila.filaId,
      pestana: fila.pestana,
      tipo_pestana: fila.tipoPestana,
      periodo: fila.periodo,
      ahora,
    })
}

/** La fila dejó de existir del lado de la aplicación (se deshizo una baja, se borró una póliza nueva). */
export function olvidarFilaDeLaApp(filaId: string): void {
  db().prepare(`DELETE FROM filas_crudas WHERE fila_id = ? AND numero_fila = 0 AND en_la_hoja = 0`).run(filaId)
}

// ---------------------------------------------------------------------------
// Lo que la hoja dice de una fila que esta computadora ya conocía
// ---------------------------------------------------------------------------

/** Prefijo del `_ID` de una baja hecha en la aplicación: lo que sigue es el `_ID` de la cuota. */
export const PREFIJO_DE_BAJA = 'BAJA:'

/** El `_ID` de la cuota que se dio de baja, si el `_ID` de la baja es de los que arma la aplicación. */
export function cuotaDeLaBaja(filaIdDeLaBaja: string): string | null {
  return filaIdDeLaBaja.startsWith(PREFIJO_DE_BAJA) ? filaIdDeLaBaja.slice(PREFIJO_DE_BAJA.length) || null : null
}

/**
 * Filas con cambios locales que todavía no viajaron (pendientes o dados por perdidos): sobre ellas lo
 * que dice la hoja está atrasado respecto de esta computadora, y ni la bajada ni la importación
 * pueden usarlo para decidir nada.
 */
export function filasConCambiosSinSubir(base: BaseDeDatos = db()): Set<string> {
  return new Set(
    (base.prepare(`SELECT DISTINCT fila_id FROM cola_sync WHERE estado IN ('pendiente', 'fallido')`).all() as Array<{ fila_id: string }>).map(
      (fila) => fila.fila_id,
    ),
  )
}

/**
 * Lo que sigue cuando una fila que ESTABA en la hoja ya no está. Lo llaman la bajada y la importación
 * completa después de marcarla `en_la_hoja = 0`.
 *
 *  - Una cuota que desapareció de la planilla del mes la sacó otra computadora: una baja, una
 *    renovación o un borrado. Acá también tiene que salir de la planilla. Hasta ahora quedaba, y ése
 *    era el origen de las bajas duplicadas: la baja hecha en Lanús seguía en la planilla de Dock Sud,
 *    alguien la volvía a dar de baja y la fila se agregaba por segunda vez a BAJAS.
 *  - Una baja que desapareció de BAJAS la deshicieron (o la pusieron vigente) desde otra computadora:
 *    el registro local se va con ella. Si quedara, la pantalla de Bajas seguiría mostrando a alguien
 *    que ya volvió a la cartera.
 *
 * Las filas con cambios sin subir no se tocan: la hoja va atrás de lo local, no al revés.
 */
export function alDesaparecerDeLaHoja(
  base: BaseDeDatos,
  filas: Array<{ filaId: string; tipo: TipoPestana }>,
  sinSubir: Set<string> = filasConCambiosSinSubir(base),
): void {
  if (filas.length === 0) return
  const ahora = ahoraIso()
  const darDeBaja = base.prepare('UPDATE cuotas_mes SET dada_de_baja = 1, actualizado_en = ? WHERE fila_id = ? AND dada_de_baja = 0')
  const olvidarBaja = base.prepare('DELETE FROM bajas WHERE fila_id = ?')
  for (const fila of filas) {
    if (sinSubir.has(fila.filaId)) continue
    if (fila.tipo === 'MENSUAL') darDeBaja.run(ahora, fila.filaId)
    else if (fila.tipo === 'BAJAS') olvidarBaja.run(fila.filaId)
    // Un adjunto o un comentario que desapareció de su pestaña lo borraron desde otra computadora:
    // se va de acá también, archivo incluido (12.6).
    else if (esPestanaDeAnexos(fila.tipo)) borrarAnexoLocal(fila.filaId, base)
    // 12.7: lo mismo con el resto. Un siniestro, una tarea, un riesgo, un pago, un aviso, una
    // consulta o un presupuesto que se borró en otra computadora seguía existiendo en ésta como
    // fantasma —editable, y con cada edición yendo a parar a «la fila ya no está en la base»—.
    else borrarRegistroQueYaNoEsta(base, fila.filaId, fila.tipo)
  }
}

/**
 * Borra de esta computadora el registro que representaba una fila que ya no está en la hoja, con lo
 * que cuelga de él (observaciones, comentarios, adjuntos con su archivo, opciones). Los vínculos
 * desde otras fichas (una tarea que apuntaba al siniestro) quedan sueltos, no se borran: la tarea
 * tiene su propia fila y su propio borrado.
 */
function borrarRegistroQueYaNoEsta(base: BaseDeDatos, filaId: string, tipo: TipoPestana): void {
  const idDe = (tabla: string): number | null =>
    (base.prepare(`SELECT id FROM ${tabla} WHERE fila_id = ?`).get(filaId) as { id: number } | undefined)?.id ?? null
  const borrarArchivos = (tabla: string, columna: string, id: number) => {
    const archivos = base.prepare(`SELECT archivo FROM ${tabla} WHERE ${columna} = ?`).all(id) as Array<{ archivo: string }>
    for (const { archivo } of archivos) borrarArchivoDeAdjunto(archivo)
    base.prepare(`DELETE FROM ${tabla} WHERE ${columna} = ?`).run(id)
  }
  switch (tipo) {
    case 'SINIESTROS': {
      const id = idDe('siniestros')
      if (id === null) return
      base.prepare('DELETE FROM siniestro_observaciones WHERE siniestro_id = ?').run(id)
      borrarArchivos('siniestro_adjuntos', 'siniestro_id', id)
      base.prepare('UPDATE tareas SET siniestro_id = NULL WHERE siniestro_id = ?').run(id)
      base.prepare('DELETE FROM siniestros WHERE id = ?').run(id)
      return
    }
    case 'APP_TAREAS': {
      const id = idDe('tareas')
      if (id === null) return
      base.prepare('DELETE FROM tarea_comentarios WHERE tarea_id = ?').run(id)
      borrarArchivos('tarea_adjuntos', 'tarea_id', id)
      base.prepare('DELETE FROM tareas WHERE id = ?').run(id)
      return
    }
    case 'RIESGOS_VARIOS':
      base.prepare('DELETE FROM riesgos_varios WHERE fila_id = ?').run(filaId)
      return
    case 'PAGOS':
      base.prepare('DELETE FROM pagos WHERE fila_id = ?').run(filaId)
      return
    case 'APP_RECHAZOS':
      base.prepare('DELETE FROM rechazos_debito WHERE fila_id = ?').run(filaId)
      return
    case 'APP_CAJA':
      base.prepare('DELETE FROM caja_movimientos WHERE fila_id = ?').run(filaId)
      return
    case 'AMP':
      base.prepare('DELETE FROM amp WHERE fila_id = ?').run(filaId)
      return
    case 'COBERTURA':
      base.prepare('DELETE FROM reglas_cobertura WHERE fila_id = ?').run(filaId)
      return
    case 'APP_LEADS': {
      const id = idDe('leads')
      if (id === null) return
      base.prepare('DELETE FROM lead_notas WHERE lead_id = ?').run(id)
      base.prepare('UPDATE tareas SET lead_id = NULL WHERE lead_id = ?').run(id)
      base.prepare('UPDATE presupuestos SET lead_id = NULL WHERE lead_id = ?').run(id)
      base.prepare('DELETE FROM leads WHERE id = ?').run(id)
      return
    }
    case 'APP_PRESUPUESTOS': {
      const id = idDe('presupuestos')
      if (id === null) return
      base.prepare('DELETE FROM presupuesto_opciones WHERE presupuesto_id = ?').run(id)
      base.prepare('UPDATE tareas SET presupuesto_id = NULL WHERE presupuesto_id = ?').run(id)
      base.prepare('UPDATE presupuestos SET presupuesto_anterior_id = NULL WHERE presupuesto_anterior_id = ?').run(id)
      base.prepare('DELETE FROM presupuestos WHERE id = ?').run(id)
      return
    }
    default:
      return
  }
}

/**
 * Lo contrario: una fila que se había ido de la planilla del mes volvió a aparecer (deshicieron la
 * baja desde otra computadora). La cuota vuelve a la planilla.
 */
export function alReaparecerEnLaHoja(base: BaseDeDatos, filaId: string, tipo: TipoPestana): void {
  if (tipo !== 'MENSUAL') return
  base.prepare('UPDATE cuotas_mes SET dada_de_baja = 0, actualizado_en = ? WHERE fila_id = ? AND dada_de_baja = 1').run(ahoraIso(), filaId)
}

/**
 * Llegó (o se confirmó) en BAJAS una baja hecha desde la aplicación: la cuota que nombra su `_ID`
 * sale de la planilla del mes también en esta computadora, aunque su fila todavía esté en la hoja
 * (el borrado de la planilla viaja un minuto después que el alta en BAJAS, ver ESPERA_DE_AGRUPADO_MS).
 *
 * Sólo la cuota DEL MES DE LA BAJA: la baja de una póliza que no estaba en el mes abierto (ver
 * `darDeBajaPoliza`) lleva en el _ID la fila donde nació la póliza, que es de un mes viejo, y ése no
 * se toca.
 */
export function alLlegarUnaBaja(base: BaseDeDatos, filaIdDeLaBaja: string, periodo: string | null, sinSubir: Set<string>): void {
  const cuota = cuotaDeLaBaja(filaIdDeLaBaja)
  if (!cuota || !periodo || sinSubir.has(cuota)) return
  base
    .prepare('UPDATE cuotas_mes SET dada_de_baja = 1, actualizado_en = ? WHERE fila_id = ? AND periodo = ? AND dada_de_baja = 0')
    .run(ahoraIso(), cuota, periodo)
}

/** El `_ID` de la cuota de ese mes que la baja nombra, si existe en esta computadora; null si no. */
export function cuotaDelMesDeLaBaja(base: BaseDeDatos, filaIdDeLaBaja: string, periodo: string | null): string | null {
  const cuota = cuotaDeLaBaja(filaIdDeLaBaja)
  if (!cuota || !periodo) return null
  const existe = base.prepare('SELECT 1 FROM cuotas_mes WHERE fila_id = ? AND periodo = ?').get(cuota, periodo)
  return existe ? cuota : null
}
