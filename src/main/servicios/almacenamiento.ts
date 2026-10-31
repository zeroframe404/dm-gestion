// Almacenamiento en la nube: cuánto ocupan los archivos adjuntos (fotos del auto, denuncias, PDF,
// planillas) y cuánto de lo contratado queda libre. Lo que se suma son las fichas de adjuntos de la
// base, que son las mismas en todas las computadoras: no se recorre ninguna carpeta.
//
// El servidor no informa su capacidad, así que el total es un dato que carga el superadministrador
// (por defecto, 50 GB).
import type { CategoriaDeArchivo, EstadoDeAlmacenamiento } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import { ErrorDeNegocio } from './errores'

const CLAVE_TOTAL = 'almacenamiento_total_bytes'
const GB = 1024 ** 3
export const TOTAL_POR_DEFECTO = 50 * GB
const TABLAS = ['poliza_adjuntos', 'siniestro_adjuntos', 'tarea_adjuntos', 'presupuesto_adjuntos', 'mensaje_adjuntos']

const EXTENSIONES: Record<Exclude<CategoriaDeArchivo, 'otros'>, string[]> = {
  imagenes: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'tif', 'tiff'],
  pdf: ['pdf'],
  excel: ['xls', 'xlsx', 'xlsm', 'csv', 'ods'],
  word: ['doc', 'docx', 'odt', 'rtf', 'txt'],
}

export function categoriaDeArchivo(nombre: string): CategoriaDeArchivo {
  const extension = nombre.includes('.') ? nombre.split('.').pop()!.toLowerCase() : ''
  for (const [categoria, lista] of Object.entries(EXTENSIONES)) {
    if (lista.includes(extension)) return categoria as CategoriaDeArchivo
  }
  return 'otros'
}

function totalGuardado(): number {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE_TOTAL) as { valor: string } | undefined
  const numero = Number(fila?.valor)
  return Number.isFinite(numero) && numero > 0 ? numero : TOTAL_POR_DEFECTO
}

export function estadoDeAlmacenamiento(): EstadoDeAlmacenamiento {
  const porCategoria = new Map<CategoriaDeArchivo, { bytes: number; archivos: number }>()
  for (const tabla of TABLAS) {
    const filas = db().prepare(`SELECT nombre, tamano FROM ${tabla}`).all() as Array<{ nombre: string; tamano: number }>
    for (const fila of filas) {
      const categoria = categoriaDeArchivo(fila.nombre)
      const acumulado = porCategoria.get(categoria) ?? { bytes: 0, archivos: 0 }
      acumulado.bytes += fila.tamano || 0
      acumulado.archivos += 1
      porCategoria.set(categoria, acumulado)
    }
  }
  const categorias = [...porCategoria.entries()]
    .map(([categoria, datos]) => ({ categoria, ...datos }))
    .sort((a, b) => b.bytes - a.bytes)
  return {
    usadoBytes: categorias.reduce((suma, c) => suma + c.bytes, 0),
    totalBytes: totalGuardado(),
    categorias,
  }
}

export function guardarTotalDeAlmacenamiento(gigabytes: number): EstadoDeAlmacenamiento {
  if (!Number.isFinite(gigabytes) || gigabytes <= 0 || gigabytes > 100_000) {
    throw new ErrorDeNegocio('El espacio total tiene que ser un número de GB mayor que cero.')
  }
  db()
    .prepare(
      `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
    .run(CLAVE_TOTAL, String(Math.round(gigabytes * GB)), ahoraIso())
  return estadoDeAlmacenamiento()
}
