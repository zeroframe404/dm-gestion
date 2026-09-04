// Lo que hay que saber de la hoja para sincronizar: qué pestañas tiene, de qué tipo es cada una, en qué
// fila están sus encabezados y qué columna es cada campo. Se lee de a poco y se cachea un rato, porque
// la cuota de Google es de ~60 llamadas por minuto y la estructura casi nunca cambia.
import type { TipoPestana } from '../../shared/tipos'
import { columnaIdPorContenido, ENCABEZADO_ID, type Campo } from '../importacion/encabezados'
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
    return { ...p, tipo: c?.tipo ?? 'OTRA', periodo: c?.periodo ?? null, layout: layouts.get(p.titulo) }
  })

  return {
    hojaId: estructura.hojaId,
    titulo: estructura.titulo,
    pestanas,
    porTitulo: new Map(pestanas.map((p) => [p.titulo, p])),
    avisos,
  }
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
