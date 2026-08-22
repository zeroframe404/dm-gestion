// Registro local de las filas que nacen en la aplicación (una póliza nueva, una renovación, el cierre
// de mes) antes de que la sincronización las suba a la hoja.
//
// Por qué hace falta: la bajada compara la hoja contra `filas_crudas` usando el `_ID`. Una fila que la
// aplicación escribió en la hoja pero que no está en `filas_crudas` se ve como «fila nueva que vino de
// otra computadora» y dispara una importación completa cada cinco minutos, para siempre. Anotándola
// acá en el mismo momento en que se crea, la bajada la reconoce y no pasa nada.
import type { TipoPestana } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'

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
