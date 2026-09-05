// Qué pestañas de la hoja de Google sirven para escribir, y con qué columnas.
//
// Existe porque la hoja real no siempre es lo que su título promete: IMPUTADOS es una matriz de
// resumen y no una tabla por fila, y a AMP puede faltarle la columna donde tildar lo resuelto. Antes de
// encolar un cambio hay que saberlo, porque una entrada que apunta a una columna que no existe queda
// para siempre en la cola marcada como fallida y no le sirve a nadie.
//
// La regla es la misma que ya usaba la rendición de Imputados: se mira la pestaña con más filas de ese
// tipo y se le pide que sus encabezados se reconozcan como una tabla.
import type { TipoPestana } from '../../shared/tipos'
import { db } from '../db/base'
import { resolverCampo, type Campo } from '../importacion/encabezados'

export interface PestanaDeLaHoja {
  /** Título de la pestaña, o null si la hoja no tiene una que sirva. */
  pestana: string | null
  /** Campos que se reconocen en sus encabezados. */
  campos: Set<Campo>
  /** Por qué no se puede escribir allá, o null si sí se puede. */
  aviso: string | null
}

interface Opciones {
  tipo: TipoPestana
  /** Cómo se llama la pestaña cuando todavía no se importó ninguna (se usa igual al encolar). */
  nombrePorDefecto: string
  /** Al menos uno de estos campos tiene que estar para que la pestaña valga como tabla. */
  minimos: Campo[]
  /** Qué encabezados tendría que tener, para decirlo en el aviso. */
  encabezadosEsperados: string
}

/** Campos reconocidos en los encabezados de una pestaña, mirando una de sus filas crudas. */
export function camposDeLaPestana(pestana: string, tipo: TipoPestana): Set<Campo> {
  const cruda = db()
    .prepare(`SELECT datos_json FROM filas_crudas WHERE pestana = ? AND datos_json <> '{}' LIMIT 1`)
    .get(pestana) as { datos_json: string } | undefined
  const campos = new Set<Campo>()
  if (!cruda) return campos
  for (const encabezado of Object.keys(JSON.parse(cruda.datos_json) as Record<string, string>)) {
    const campo = resolverCampo(encabezado, tipo)
    if (campo) campos.add(campo)
  }
  return campos
}

export function buscarPestana(opciones: Opciones): PestanaDeLaHoja {
  const candidata = db()
    .prepare(
      `SELECT pestana, COUNT(*) AS filas FROM filas_crudas
       WHERE tipo_pestana = ? AND en_la_hoja = 1
       GROUP BY pestana ORDER BY filas DESC LIMIT 1`,
    )
    .get(opciones.tipo) as { pestana: string; filas: number } | undefined

  const sinPestana =
    `La hoja de Google todavía no tiene una pestaña «${opciones.nombrePorDefecto}» importada con una fila por registro. ` +
    `Armala con encabezados ${opciones.encabezadosEsperados} e importala; hasta entonces lo que se cargue acá queda sólo en DM Gestión.`

  if (!candidata) return { pestana: null, campos: new Set(), aviso: sinPestana }

  const campos = camposDeLaPestana(candidata.pestana, opciones.tipo)
  const esTabla = campos.size >= 3 && opciones.minimos.some((campo) => campos.has(campo))
  if (!esTabla) return { pestana: null, campos, aviso: sinPestana }

  return { pestana: candidata.pestana, campos, aviso: null }
}

/**
 * Nombre de la pestaña donde escribir, aunque todavía no se haya importado: la que ya existe o el
 * nombre por defecto. Lo usan las altas, que igual encolan: si la pestaña aparece después, la fila
 * sube sola; si nunca aparece, la cola lo dice con nombre y apellido en Administración → Sincronización.
 */
export function nombreDePestana(tipo: TipoPestana, porDefecto: string): string {
  // La que más renglones tiene, y a igual cantidad la primera por nombre: con dos pestañas del mismo
  // tipo («SINIESTROS» y «SINIESTROS 2025») cada computadora tiene que elegir la MISMA; hasta la
  // 12.6 salía la que SQLite devolviera primero, que dependía del orden en que cada base importó.
  const existente = db()
    .prepare(
      `SELECT pestana, COUNT(*) AS filas FROM filas_crudas WHERE tipo_pestana = ? AND en_la_hoja = 1
       GROUP BY pestana ORDER BY filas DESC, pestana ASC LIMIT 1`,
    )
    .get(tipo) as { pestana: string } | undefined
  return existente?.pestana ?? porDefecto
}

/**
 * La pestaña REAL de una fila que ya existe, para corregirla donde vive. `nombreDePestana` elige la
 * pestaña «principal» del tipo, que es lo que corresponde para un ALTA (todavía no vive en ninguna),
 * pero para una CORRECCIÓN estaba mal: con dos pestañas del mismo tipo («SINIESTROS» y «SINIESTROS
 * 2024»), un siniestro que vive en la segunda encolaba contra la primera y la subida lo rebotaba con
 * «La fila ya no está en la base».
 *
 * Se exige que el tipo coincida: si el _ID quedó en una pestaña de otro tipo (una fila movida a mano
 * en la hoja) es más seguro caer en la pestaña por defecto que escribir en una tabla que no es.
 */
export function pestanaDeLaFila(filaId: string, tipo: TipoPestana, porDefecto: string): string {
  const cruda = db().prepare('SELECT pestana FROM filas_crudas WHERE fila_id = ? AND tipo_pestana = ?').get(filaId, tipo) as
    | { pestana: string }
    | undefined
  return cruda?.pestana ?? nombreDePestana(tipo, porDefecto)
}
