// Columnas que faltan en una pestaña (12.7).
//
// Hasta la 12.6, cuando la aplicación tenía que escribir un campo en una pestaña que no tenía columna
// para él, el dato se descartaba con un aviso en la bitácora («columna faltante»). Era exactamente el
// origen de los siniestros sin asegurado: la pestaña SINIESTROS de la agencia no tenía una columna que
// la aplicación reconociera como el nombre, la computadora que cargó el siniestro se lo quedaba en su
// base, y las otras cuatro lo importaban de la base compartida en blanco.
//
// Ahora la columna se AGREGA: el encabezado se escribe en la fila de encabezados de la pestaña, en la
// primera columna que esté vacía en todos los renglones, y la subida sigue en el mismo ciclo con la
// pestaña ya completa. Las otras computadoras, al bajar, ven que la fila de encabezados cambió y
// rehacen el mapeo antes de aplicar nada (`refrescarLayoutSiCambio`), así el dato nuevo cae en la
// columna correcta de su base sin esperar a que se relea la estructura ni a una importación completa.
import { encabezadoParaAgregar, mapearEncabezados, primeraColumnaLibre, type Campo } from '../importacion/encabezados'
import type { FuenteHoja } from '../importacion/fuente'
import { limpiar } from '../importacion/normalizar'
import { anotarEvento } from './cola'
import type { PestanaSincronizable } from './hoja'

/** Campos que nunca se agregan como columna: el _ID tiene su propio camino. */
const NO_SE_AGREGAN = new Set<string>(['_id'])

/**
 * Si la fila de encabezados de la pestaña ya no dice lo que decía cuando se leyó la estructura (otra
 * computadora agregó una columna), rehace el mapeo en el lugar. Devuelve true si cambió algo.
 *
 * Toca `pestana.layout` a propósito: el contexto de la hoja se cachea cinco minutos en el motor, y la
 * misma referencia la comparten `contexto.pestanas` y `contexto.porTitulo`, así que con esto queda al
 * día para todo lo que corra hasta la próxima relectura.
 */
export function refrescarLayoutSiCambio(pestana: PestanaSincronizable, valores: string[][]): boolean {
  const layout = pestana.layout
  if (!layout || layout.filaEncabezados < 0) return false
  const filaLeida = (valores[layout.filaEncabezados] ?? []).map((celda) => limpiar(celda))
  const conocida = layout.mapeo.encabezados.map((celda) => limpiar(celda))
  while (filaLeida.length > 0 && filaLeida[filaLeida.length - 1] === '') filaLeida.pop()
  while (conocida.length > 0 && conocida[conocida.length - 1] === '') conocida.pop()
  if (filaLeida.length === conocida.length && filaLeida.every((celda, i) => celda === conocida[i])) return false
  pestana.layout = { ...layout, mapeo: mapearEncabezados(valores[layout.filaEncabezados] ?? [], pestana.tipo) }
  return true
}

/** Primera columna que está vacía en la fila de encabezados Y en todos los renglones de abajo. */
function columnaLibre(valores: string[][], filaEncabezados: number): number {
  const encabezados = valores[filaEncabezados] ?? []
  let indice = primeraColumnaLibre(encabezados)
  const ancho = valores.reduce((maximo, fila) => Math.max(maximo, fila.length), 0)
  while (indice < ancho) {
    const libre = valores.every((fila, r) => r < filaEncabezados || limpiar(fila[indice]) === '')
    if (libre) break
    indice++
  }
  return indice
}

export interface ColumnaAgregada {
  pestana: string
  campo: Campo
  encabezado: string
  columna: number
}

/**
 * Agrega a la pestaña las columnas que hagan falta para escribir esos campos. Escribe los encabezados
 * en la hoja, actualiza `valores` (la fila de encabezados) y `pestana.layout` en el lugar, y devuelve
 * qué agregó. Los campos que no se pueden titular de forma reconocible no se agregan (quien llama los
 * sigue tratando como «columna faltante»).
 *
 * Sólo trabaja sobre pestañas con fila de encabezados PROPIA: a una que usa el mapeo prestado de otra
 * (una BAJAS sin encabezados) no se le puede escribir un título en ningún lado.
 */
export async function agregarColumnasFaltantes(
  fuente: FuenteHoja,
  pestana: PestanaSincronizable,
  valores: string[][],
  campos: Iterable<Campo>,
): Promise<ColumnaAgregada[]> {
  const layout = pestana.layout
  if (!layout || layout.filaEncabezados < 0) return []
  const agregadas: ColumnaAgregada[] = []
  const filaEncabezados = layout.filaEncabezados
  // La fila de encabezados se completa en memoria a medida que se agregan, así dos campos de la misma
  // tanda no caen en la misma columna y el mapeo final se calcula una sola vez.
  const encabezados = [...(valores[filaEncabezados] ?? [])]
  for (const campo of new Set(campos)) {
    if (NO_SE_AGREGAN.has(campo)) continue
    if (pestana.layout?.mapeo.porCampo.has(campo)) continue
    if (agregadas.some((a) => a.campo === campo)) continue
    const titulo = encabezadoParaAgregar(campo, pestana.tipo, encabezados)
    if (!titulo) continue
    const columna = columnaLibre(valores, filaEncabezados)
    while (encabezados.length <= columna) encabezados.push('')
    encabezados[columna] = titulo
    if (!valores[filaEncabezados]) valores[filaEncabezados] = []
    const fila = valores[filaEncabezados]!
    while (fila.length <= columna) fila.push('')
    fila[columna] = titulo
    agregadas.push({ pestana: pestana.titulo, campo, encabezado: titulo, columna })
  }
  if (agregadas.length === 0) return []

  const columnasNecesarias = Math.max(...agregadas.map((a) => a.columna)) + 1
  await fuente.asegurarColumnas(pestana.sheetId, columnasNecesarias)
  await fuente.escribirCeldas(
    agregadas.map((a) => ({ titulo: pestana.titulo, fila: filaEncabezados + 1, columna: a.columna, valor: a.encabezado })),
  )
  pestana.layout = { ...layout, mapeo: mapearEncabezados(encabezados, pestana.tipo) }
  for (const a of agregadas) {
    anotarEvento('pestana', `La pestaña «${pestana.titulo}» no tenía columna para «${a.campo}»: se agregó «${a.encabezado}» al final, así el dato viaja a todas las computadoras.`)
  }
  return agregadas
}
