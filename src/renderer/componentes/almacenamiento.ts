import type { CategoriaDeArchivo } from '../../shared/tipos'

export function formatearBytes(bytes: number): string {
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  let valor = bytes
  let i = 0
  while (valor >= 1024 && i < unidades.length - 1) {
    valor /= 1024
    i++
  }
  return `${valor.toLocaleString('es-AR', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${unidades[i]}`
}

export const NOMBRE_DE_CATEGORIA: Record<CategoriaDeArchivo, string> = {
  imagenes: 'Imágenes',
  pdf: 'PDF',
  excel: 'Excel',
  word: 'Word y texto',
  otros: 'Otros',
}
