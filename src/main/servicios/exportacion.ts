// Guardar un archivo desde la aplicación: abre el diálogo «Guardar como» y escribe el contenido.
// Lo usa «Exportar el día» de la caja; el informe de la importación tiene el suyo desde la Fase 2.
import { BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { ErrorDeNegocio } from './errores'

export interface ArchivoAGuardar {
  nombre: string
  contenido: string
  /** Descripción del tipo de archivo para el diálogo, por ejemplo 'Planilla CSV'. */
  descripcion: string
}

/** Devuelve la ruta elegida, o null si se canceló el diálogo. */
export async function guardarComo(archivo: ArchivoAGuardar, ventana: BrowserWindow | null): Promise<{ ruta: string | null }> {
  const extension = path.extname(archivo.nombre).replace('.', '') || 'txt'
  const opciones = {
    title: 'Guardar',
    defaultPath: archivo.nombre,
    filters: [
      { name: archivo.descripcion, extensions: [extension] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  }
  const resultado = ventana ? await dialog.showSaveDialog(ventana, opciones) : await dialog.showSaveDialog(opciones)
  if (resultado.canceled || !resultado.filePath) return { ruta: null }
  try {
    writeFileSync(resultado.filePath, archivo.contenido, 'utf8')
  } catch (error) {
    // El motivo importa: casi siempre es que el archivo está abierto en Excel o que la carpeta es de
    // sólo lectura, y con el mensaje genérico de «error inesperado» nadie lo adivina.
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(`No se pudo guardar «${path.basename(resultado.filePath)}»: ${motivo}. Si el archivo está abierto en Excel, cerralo y probá de nuevo.`)
  }
  return { ruta: resultado.filePath }
}

/**
 * Lo mismo pero para un archivo binario (el .xlsx de Reportes y el de la planilla clásica). Va aparte
 * de `guardarComo` porque un Buffer no se escribe con codificación: escribirlo como utf8 lo rompería
 * en silencio y el Excel diría que el archivo está dañado.
 */
export async function guardarBinarioComo(
  archivo: { nombre: string; contenido: Buffer; descripcion: string },
  ventana: BrowserWindow | null,
  titulo = 'Guardar',
): Promise<{ ruta: string | null }> {
  const extension = path.extname(archivo.nombre).replace('.', '') || 'bin'
  const opciones = {
    title: titulo,
    defaultPath: archivo.nombre,
    filters: [
      { name: archivo.descripcion, extensions: [extension] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  }
  const resultado = ventana ? await dialog.showSaveDialog(ventana, opciones) : await dialog.showSaveDialog(opciones)
  if (resultado.canceled || !resultado.filePath) return { ruta: null }
  try {
    writeFileSync(resultado.filePath, archivo.contenido)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(
      `No se pudo guardar «${path.basename(resultado.filePath)}»: ${motivo}. Si el archivo está abierto en Excel, cerralo y probá de nuevo.`,
    )
  }
  return { ruta: resultado.filePath }
}

/** Deja un texto en condiciones de ser parte de un nombre de archivo de Windows. */
export function paraNombreDeArchivo(valor: string): string {
  return valor
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * Escribe el archivo en una ruta ya conocida, sin abrir ningún diálogo. Lo usa la prueba de humo, que
 * no puede manejar un diálogo del sistema desde afuera; la aplicación siempre pasa por «Guardar como».
 */
export function guardarEn(ruta: string, contenido: string | Buffer): { ruta: string } {
  try {
    if (typeof contenido === 'string') writeFileSync(ruta, contenido, 'utf8')
    else writeFileSync(ruta, contenido)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(`No se pudo guardar «${path.basename(ruta)}»: ${motivo}.`)
  }
  return { ruta }
}
