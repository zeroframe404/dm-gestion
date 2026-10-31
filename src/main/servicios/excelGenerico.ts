// Excel genérico para los listados: recibe {titulo, columnas, filas} YA calculados por la pantalla y
// arma el .xlsx con el escritor de siempre (xlsx.ts). No toca la base ni el servidor: lo único que
// hace el proceso principal es validar lo que llega y, después, abrir el diálogo «Guardar como».
import { hoyLocal } from '../../shared/semaforo'
import type { CeldaDeExcel, PedidoDeExcel } from '../../shared/listados/excel'
import { ErrorDeNegocio } from './errores'
import { paraNombreDeArchivo } from './exportacion'
import { construirXlsx, type ValorDeCelda } from './xlsx'

/** Tope de filas: más que esto no es un listado, es la base entera, y el escritor arma todo en memoria. */
const MAXIMO_DE_FILAS = 100_000
const MAXIMO_DE_COLUMNAS = 100

function aCelda(valor: unknown): ValorDeCelda {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  return String(valor)
}

/** El pedido llega del renderer: se revisa la forma antes de armar nada. */
export function validarPedidoDeExcel(crudo: unknown): PedidoDeExcel {
  const pedido = crudo as Partial<PedidoDeExcel> | null
  const titulo = typeof pedido?.titulo === 'string' ? pedido.titulo.trim() : ''
  if (!titulo) throw new ErrorDeNegocio('Falta el título de la planilla.')
  const columnas = pedido?.columnas
  if (!Array.isArray(columnas) || columnas.length === 0 || columnas.length > MAXIMO_DE_COLUMNAS) {
    throw new ErrorDeNegocio('La planilla necesita entre 1 y 100 columnas.')
  }
  const filas = pedido?.filas
  if (!Array.isArray(filas)) throw new ErrorDeNegocio('Faltan las filas de la planilla.')
  if (filas.length > MAXIMO_DE_FILAS) {
    throw new ErrorDeNegocio(`Son demasiadas filas para una planilla (${filas.length}). Filtrá para achicar el listado.`)
  }
  return {
    titulo: titulo.slice(0, 120),
    columnas: columnas.map((columna) => String(columna ?? '')),
    filas: filas.map((fila): CeldaDeExcel[] => (Array.isArray(fila) ? fila.map(aCelda) : [])),
  }
}

/** El .xlsx del listado: una pestaña con el título arriba, los encabezados y las filas. */
export function xlsxGenerico(crudo: unknown, fecha = new Date()): { nombre: string; contenido: Buffer } {
  const pedido = validarPedidoDeExcel(crudo)
  const contenido = construirXlsx(
    [{ nombre: pedido.titulo, titulo: pedido.titulo, encabezados: pedido.columnas, filas: pedido.filas }],
    fecha,
  )
  return { nombre: `${paraNombreDeArchivo(pedido.titulo)} ${hoyLocal(fecha)}.xlsx`, contenido }
}
