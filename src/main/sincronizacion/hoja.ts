// Lo que hay que saber de la hoja para sincronizar: qué pestañas tiene, de qué tipo es cada una, en qué
// fila están sus encabezados y qué columna es cada campo. Se lee de a poco y se cachea un rato, porque
// la cuota de Google es de ~60 llamadas por minuto y la estructura casi nunca cambia.
import type { TipoPestana } from '../../shared/tipos'
import { columnaIdPorContenido, ENCABEZADO_ID, FORMATO_ID, mapearEncabezados, type Campo } from '../importacion/encabezados'
import type { FuenteHoja, PestanaDeHoja } from '../importacion/fuente'
import { FILAS_PARA_ENCABEZADOS, resolverLayouts, type Layout } from '../importacion/layouts'
import { limpiar } from '../importacion/normalizar'
import { clasificarPestanas } from '../importacion/pestanas'

export interface PestanaSincronizable extends PestanaDeHoja {
  tipo: TipoPestana
  periodo: string | null
  layout: Layout | undefined
}

export interface ContextoHoja {
  hojaId: string
  titulo: string
  pestanas: PestanaSincronizable[]
  porTitulo: Map<string, PestanaSincronizable>
  avisos: string[]
}

/** Dos llamadas a Google: la estructura y los encabezados de todas las pestañas juntos. */
export async function leerContexto(fuente: FuenteHoja): Promise<ContextoHoja> {
  const estructura = await fuente.estructura()
  const clasificadas = clasificarPestanas(estructura.pestanas.map((p) => ({ titulo: p.titulo, indice: p.indice })))
  const titulos = estructura.pestanas.map((p) => p.titulo)
  const cabeceras = await fuente.leerVarias(titulos, FILAS_PARA_ENCABEZADOS)
  const filasPorTitulo = new Map(cabeceras.map((c) => [c.titulo, c.valores]))

  const { layouts, avisos } = resolverLayouts(
    estructura.pestanas.map((p) => ({
      titulo: p.titulo,
      tipo: clasificadas.find((c) => c.titulo === p.titulo && c.indice === p.indice)?.tipo ?? 'OTRA',
      filas: filasPorTitulo.get(p.titulo) ?? [],
    })),
  )

  const pestanas: PestanaSincronizable[] = estructura.pestanas.map((p) => {
    const c = clasificadas.find((x) => x.titulo === p.titulo && x.indice === p.indice)
    const tipo = c?.tipo ?? 'OTRA'
    const layout = layouts.get(p.titulo) ?? layoutDeLaFilaDelId((filasPorTitulo.get(p.titulo) ?? [])[0] ?? [], tipo)
    return { ...p, tipo, periodo: c?.periodo ?? null, layout }
  })

  return {
    hojaId: estructura.hojaId,
    titulo: estructura.titulo,
    pestanas,
    porTitulo: new Map(pestanas.map((p) => [p.titulo, p])),
    avisos,
  }
}

/** Un _ID de la aplicación, solo o como referencia a otro renglón («PAGO:<_ID>», «BAJA:<_ID>»…). */
function pareceIdDeLaApp(valor: string): boolean {
  return FORMATO_ID.test(valor) || FORMATO_ID.test(valor.slice(valor.lastIndexOf(':') + 1))
}

/**
 * La fila 1 de una pestaña que perdió sus títulos pero conserva el «_ID» que le escribió la
 * importación, y nada más que eso (o, a lo sumo, algún _ID suelto que quedó metido en la fila).
 *
 * Así quedó IMPUTADOS en la base de la agencia: la fila 1 con sólo «_ID» y un «PAGO:…». Ninguna fila
 * reconoce campos, así que `resolverLayouts` no le arma layout. La importación igual toma la fila 1
 * como encabezados (y encuentra el _ID), pero la bajada buscaba el _ID por contenido, no lo encontraba
 * y veía la pestaña «vacía» con todas sus filas «nuevas» en cada ciclo; la subida no encontraba ningún
 * renglón y tampoco podía agregar las columnas que faltaban, así que cada pago llegaba sólo con su
 * _ID. Con este layout las tres partes miran la misma columna, y la subida vuelve a poder titular las
 * columnas que necesita al final de la fila 1.
 *
 * Una fila 1 con datos de verdad (una pestaña de bajas sin encabezados, con el «_ID» escrito al final
 * de su primer renglón) NO cuenta: titularle columnas ahí sería escribir sobre ese renglón.
 */
export function layoutDeLaFilaDelId(fila: string[], tipo: TipoPestana): Layout | undefined {
  const celdas = fila.map((celda) => limpiar(celda))
  if (!celdas.some((celda) => celda.toUpperCase() === ENCABEZADO_ID)) return undefined
  if (celdas.some((celda) => celda !== '' && celda.toUpperCase() !== ENCABEZADO_ID && !pareceIdDeLaApp(celda))) return undefined
  return { filaEncabezados: 0, mapeo: mapearEncabezados(fila, tipo), puntaje: 0, prestadoDe: null }
}

/** Índice de la columna del _ID en esa pestaña: por encabezado, o por contenido si no tiene encabezados. */
export function columnaDelId(pestana: PestanaSincronizable, valores: string[][]): number | null {
  const porEncabezado = pestana.layout?.mapeo.columnaId
  if (porEncabezado !== undefined && porEncabezado !== null) return porEncabezado
  const encabezados = pestana.layout && pestana.layout.filaEncabezados >= 0 ? (valores[pestana.layout.filaEncabezados] ?? []) : []
  const enLaFila = encabezados.findIndex((e) => limpiar(e).toUpperCase() === ENCABEZADO_ID)
  if (enLaFila >= 0) return enLaFila
  return columnaIdPorContenido(valores)
}

/**
 * Número de fila (base 1) de cada _ID de la pestaña. Si un _ID aparece dos veces manda el PRIMER
 * renglón, igual que en la base del VPS y en el importador (que le da un _ID nuevo al segundo): así
 * la subida, el servidor y la importación hablan del mismo renglón.
 */
export function filasPorId(valores: string[][], columnaId: number, desdeFila: number): Map<string, number> {
  const mapa = new Map<string, number>()
  for (let r = desdeFila - 1; r < valores.length; r++) {
    const id = limpiar(valores[r]?.[columnaId])
    if (id && !mapa.has(id)) mapa.set(id, r + 1)
  }
  return mapa
}

/** Índice de la columna donde vive un campo en esa pestaña. */
export function columnaDe(pestana: PestanaSincronizable | undefined, campo: Campo): number | null {
  return pestana?.layout?.mapeo.porCampo.get(campo) ?? null
}

/**
 * Huella de una fila tal como está en la hoja. Comparar dos strings es muchísimo más barato que
 * rearmar el objeto de 40 columnas de cada una de las 28.000 filas en cada ciclo.
 *
 * La columna del _ID queda afuera a propósito: la escribe la propia aplicación después de leer la fila,
 * y si contara, en el ciclo siguiente la hoja entera parecería haber cambiado.
 */
export function huellaDeFila(celdas: string[], columnaId?: number | null): string {
  const partes = celdas.map((c, i) => (i === columnaId ? '' : limpiar(c)))
  // Google devuelve las filas con largo desparejo (recorta las celdas vacías del final) y la columna
  // del _ID puede aparecer o no: sin recortar, la misma fila daría dos huellas distintas.
  while (partes.length > 0 && partes[partes.length - 1] === '') partes.pop()
  return partes.join('')
}
