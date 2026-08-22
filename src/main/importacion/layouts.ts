// Dónde están los encabezados de cada pestaña y qué columna es cada campo.
//
// En la hoja real hay de todo: pestañas con el título ocupando las primeras filas (SINIESTROS empieza
// en la 4) y pestañas de BAJAS que NO tienen fila de encabezados y usan las columnas de otra. Esto lo
// resuelve una sola vez y lo usan tanto el importador como la sincronización.
import type { TipoPestana } from '../../shared/tipos'
import {
  ENCABEZADO_ID,
  mapearEncabezados,
  puntuarMapeoContraDatos,
  repiteEncabezados,
  type Campo,
  type MapeoDeColumnas,
} from './encabezados'
import { limpiar } from './normalizar'

/** Hasta qué fila se busca la fila de encabezados. */
export const FILAS_PARA_ENCABEZADOS = 8

/** Campos que tiene que reconocer una fila para considerarla la de encabezados. */
const MINIMO_CAMPOS_ENCABEZADO = 4

/** Puntaje mínimo para aceptar el mapeo prestado de otra pestaña. */
const MINIMO_PUNTAJE_PRESTADO = 4

/** Tipos de pestaña que se vuelcan a una tabla del modelo (las demás quedan sólo como datos crudos). */
export const TIPOS_CON_MAPEO: TipoPestana[] = ['MENSUAL', 'BAJAS', 'RIESGOS_VARIOS', 'SINIESTROS', 'PAGOS', 'COBERTURA']

export interface Layout {
  /** Índice (base 0) de la fila de encabezados; -1 si la pestaña no tiene y el mapeo es prestado. */
  filaEncabezados: number
  mapeo: MapeoDeColumnas
  puntaje: number
  prestadoDe: string | null
}

export interface PestanaParaLayout {
  titulo: string
  tipo: TipoPestana
  /** Las primeras filas de la pestaña (alcanza con FILAS_PARA_ENCABEZADOS). */
  filas: string[][]
}

export interface ResultadoDeLayouts {
  layouts: Map<string, Layout>
  /** Explicaciones para el informe: encabezados corridos, layouts prestados. */
  avisos: string[]
  /** Pestañas para las que no hubo forma de saber qué es cada columna. */
  sinResolver: Array<{ titulo: string; detalle: string }>
}

/**
 * Resuelve el layout de cada pestaña. Es una función pura: recibe las primeras filas ya leídas, así el
 * que llama decide cuántas llamadas hace a Google.
 */
export function resolverLayouts(pestanas: PestanaParaLayout[]): ResultadoDeLayouts {
  const layouts = new Map<string, Layout>()
  const avisos: string[] = []
  const sinResolver: Array<{ titulo: string; detalle: string }> = []
  const tipoPorTitulo = new Map(pestanas.map((p) => [p.titulo, p.tipo]))

  // 1) Encabezados propios: la fila que más campos reconoce y que además le calza a los datos de abajo.
  const sinEncabezados: PestanaParaLayout[] = []
  for (const p of pestanas) {
    let mejor: Layout | null = null
    for (let r = 0; r < Math.min(p.filas.length, FILAS_PARA_ENCABEZADOS); r++) {
      const mapeo = mapearEncabezados(p.filas[r] ?? [], p.tipo)
      if (mapeo.porCampo.size < MINIMO_CAMPOS_ENCABEZADO) continue
      const muestras = p.filas.slice(r + 1).filter((f) => !repiteEncabezados(f, p.filas[r] ?? []))
      const puntaje = mapeo.porCampo.size + puntuarMapeoContraDatos(mapeo, muestras) - r * 0.25
      if (!mejor || puntaje > mejor.puntaje) mejor = { filaEncabezados: r, mapeo, puntaje, prestadoDe: null }
    }
    if (mejor) {
      layouts.set(p.titulo, mejor)
      if (mejor.filaEncabezados > 0) {
        avisos.push(`En «${p.titulo}» los encabezados están en la fila ${mejor.filaEncabezados + 1}, no en la 1: las filas de arriba se saltearon.`)
      }
    } else if (TIPOS_CON_MAPEO.includes(p.tipo)) {
      sinEncabezados.push(p)
    }
  }

  // 2) Pestañas sin encabezados: se les presta el mapeo de la pestaña que mejor describa sus datos.
  const candidatos = [...layouts.entries()].map(([titulo, layout]) => ({ titulo, layout }))
  for (const p of sinEncabezados) {
    const filas = p.filas.filter((f) => f.some((v) => limpiar(v) !== ''))
    let mejor: { titulo: string; mapeo: MapeoDeColumnas; puntaje: number } | null = null
    for (const candidato of candidatos) {
      // Sólo tiene sentido prestar entre pestañas que guardan lo mismo (o de una mensual a sus bajas).
      const tipoCandidato = tipoPorTitulo.get(candidato.titulo)
      const compatible = tipoCandidato === p.tipo || (p.tipo === 'BAJAS' && tipoCandidato === 'MENSUAL')
      if (!compatible) continue
      // La columna _ID de la que presta no es parte del layout: cada pestaña tiene la suya.
      const encabezadosPrestados = candidato.layout.mapeo.encabezados.map((e) => (e.toUpperCase() === ENCABEZADO_ID ? '' : e))
      const mapeo = mapearEncabezados(encabezadosPrestados, p.tipo)
      const puntaje = puntuarMapeoContraDatos(mapeo, filas)
      if (!mejor || puntaje > mejor.puntaje) mejor = { titulo: candidato.titulo, mapeo, puntaje }
    }
    if (mejor && mejor.puntaje >= MINIMO_PUNTAJE_PRESTADO) {
      layouts.set(p.titulo, { filaEncabezados: -1, mapeo: mejor.mapeo, puntaje: mejor.puntaje, prestadoDe: mejor.titulo })
      avisos.push(`«${p.titulo}» no tiene fila de encabezados: se usaron los de «${mejor.titulo}», que son los que mejor describen sus columnas. Sus datos arrancan en la fila 1.`)
    } else {
      sinResolver.push({
        titulo: p.titulo,
        detalle:
          'no tiene fila de encabezados y ninguna otra pestaña tiene columnas parecidas, así que no hay forma de saber qué es cada columna: sus filas se guardan enteras en los datos crudos. Para que entre, copiá en su fila 1 los encabezados que le correspondan (por ejemplo los de otra pestaña de bajas) y volvé a importar.',
      })
    }
  }

  return { layouts, avisos, sinResolver }
}

/** Índice de la columna donde vive un campo en esa pestaña, o null si la pestaña no lo tiene. */
export function columnaDelCampo(layout: Layout | undefined, campo: Campo): number | null {
  return layout?.mapeo.porCampo.get(campo) ?? null
}

/** Primera fila con datos de la pestaña (base 1, como las cuenta Google). */
export function primeraFilaDeDatos(layout: Layout | undefined): number {
  return (layout?.filaEncabezados ?? 0) + 2
}
