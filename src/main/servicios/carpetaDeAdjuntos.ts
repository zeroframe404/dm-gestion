// La carpeta local de los adjuntos: %APPDATA%/dm-gestion/adjuntos/<grupo>/<archivo>.
//
// Es la parte de `adjuntos.ts` que no sabe nada de la base ni del servidor: dónde van los archivos,
// cómo se nombran sin que Windows los rechace y cómo se copian sin pisar uno que se llame igual. Vive
// aparte para que la sincronización (sincronizacion/anexos.ts) pueda borrar un archivo cuando la fila
// desaparece de la base sin importar el servicio entero.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { carpetaDatos } from '../rutas'
import { ErrorDeNegocio } from './errores'

/**
 * Tope por archivo. Hasta la 12.5 eran 25 MB; ahora las fotos se achican en la pantalla antes de
 * llegar acá y el servidor acepta 1 GB, así que el tope local sólo frena lo que claramente no es un
 * papel de la póliza (un video de 400 MB del celular).
 */
export const TAMANO_MAXIMO = 200 * 1024 * 1024

const TIPOS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
  '.zip': 'application/zip',
}

export function tipoDeArchivo(nombre: string): string {
  return TIPOS[path.extname(nombre).toLowerCase()] ?? 'application/octet-stream'
}

/** En las pruebas se apunta a una carpeta temporal para no escribir en los datos de nadie. */
let carpetaDePrueba: string | null = null

export function usarCarpetaDeAdjuntosDePrueba(ruta: string | null): void {
  carpetaDePrueba = ruta
}

export function carpetaDeAdjuntos(): string {
  return carpetaDePrueba ?? path.join(carpetaDatos(), 'adjuntos')
}

export function carpetaDelSiniestro(siniestroId: number): string {
  return carpetaDelGrupo(String(siniestroId))
}

/**
 * Carpeta de un grupo de adjuntos. Los siniestros usan el número a secas (así quedaron los de la Fase
 * 7 y no se les mueve el piso), las tareas de la Fase 8 usan «tarea-<id>» y las pólizas «poliza-<id>».
 */
export function carpetaDelGrupo(grupo: string): string {
  return path.join(carpetaDeAdjuntos(), grupo)
}

/** Ruta absoluta de un adjunto a partir de lo que guarda la base (`<grupo>/<archivo>`). */
export function rutaDeAdjunto(relativa: string): string {
  return path.join(carpetaDeAdjuntos(), relativa)
}

const NOMBRE_RESERVADO_DE_WINDOWS = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/**
 * Deja el nombre en algo que Windows acepte como archivo, sin perder de vista cuál era: se cambian los
 * caracteres prohibidos por guiones y se recorta si es larguísimo, conservando la extensión.
 */
export function nombreSeguro(nombre: string): string {
  const base = path.basename(nombre).replace(/[<>:"/\\|?*]/g, '-').trim()
  if (!base || base === '.' || base === '..') return 'adjunto'
  const extension = path.extname(base)
  const cuerpo = base.slice(0, base.length - extension.length)
  // Los nombres reservados de Windows (CON, PRN, AUX, NUL, COM1-9, LPT1-9), con o sin extensión y en
  // cualquier caja: «con.pdf» no se puede crear en NTFS. Un guion bajo adelante y listo (12.7).
  // Windows reserva el dispositivo por lo que va ANTES DEL PRIMER punto, no antes de la extensión:
  // «con.txt.pdf» y «nul.tar.gz» también abren el dispositivo, así que se mira ese primer pedazo.
  const seguro = NOMBRE_RESERVADO_DE_WINDOWS.test(base.split('.')[0] ?? '') ? `_${cuerpo}` : cuerpo
  return `${seguro.slice(0, 80) || 'adjunto'}${extension.slice(0, 12)}`
}

export interface AdjuntoCopiado {
  /** Nombre para mostrar (el original). */
  nombre: string
  /** Ruta relativa a la carpeta de adjuntos: '<grupo>/<archivo>'. */
  archivo: string
  tamano: number
}

/** Un nombre libre dentro de la carpeta: si ya hay uno igual, «(2)», «(3)»… */
function nombreLibreEn(carpeta: string, original: string): string {
  const extension = path.extname(original)
  const cuerpo = original.slice(0, original.length - extension.length)
  let nombre = original
  let intento = 2
  while (existsSync(path.join(carpeta, nombre))) {
    nombre = `${cuerpo} (${intento})${extension}`
    intento++
  }
  return nombre
}

/**
 * Copia el archivo a la carpeta del siniestro. Si ya había uno con ese nombre no lo pisa: le agrega
 * «(2)», «(3)»… porque dos fotos distintas pueden llamarse las dos IMG_0001.jpg y perder una sería
 * perder una prueba del reclamo.
 */
export function copiarAdjunto(siniestroId: number, rutaOrigen: string): AdjuntoCopiado {
  return copiarAdjuntoEn(String(siniestroId), rutaOrigen)
}

/** El mismo copiado, para cualquier grupo de adjuntos (los siniestros, las tareas y las pólizas). */
export function copiarAdjuntoEn(grupo: string, rutaOrigen: string): AdjuntoCopiado {
  if (!existsSync(rutaOrigen)) throw new ErrorDeNegocio(`No se encontró el archivo «${path.basename(rutaOrigen)}».`)
  const info = statSync(rutaOrigen)
  if (!info.isFile()) throw new ErrorDeNegocio(`«${path.basename(rutaOrigen)}» no es un archivo.`)
  exigirTamano(path.basename(rutaOrigen), info.size)

  const carpeta = carpetaDelGrupo(grupo)
  mkdirSync(carpeta, { recursive: true })
  const nombre = nombreLibreEn(carpeta, nombreSeguro(path.basename(rutaOrigen)))
  try {
    copyFileSync(rutaOrigen, path.join(carpeta, nombre))
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(`No se pudo copiar «${path.basename(rutaOrigen)}»: ${motivo}`)
  }
  return { nombre: path.basename(rutaOrigen), archivo: `${grupo}/${nombre}`, tamano: info.size }
}

/**
 * Guarda bytes que vinieron de la pantalla (arrastrados, pegados o elegidos, y ya achicados si eran
 * fotos) o bajados del servidor. Misma regla de nombres que la copia desde una ruta.
 */
export function guardarBytesEn(grupo: string, nombreOriginal: string, contenido: Buffer): AdjuntoCopiado {
  const mostrado = nombreOriginal.trim() || 'adjunto'
  exigirTamano(mostrado, contenido.length)
  const carpeta = carpetaDelGrupo(grupo)
  mkdirSync(carpeta, { recursive: true })
  const nombre = nombreLibreEn(carpeta, nombreSeguro(mostrado))
  try {
    writeFileSync(path.join(carpeta, nombre), contenido)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(`No se pudo guardar «${mostrado}»: ${motivo}`)
  }
  return { nombre: mostrado, archivo: `${grupo}/${nombre}`, tamano: contenido.length }
}

function exigirTamano(nombre: string, tamano: number): void {
  if (tamano > TAMANO_MAXIMO) {
    throw new ErrorDeNegocio(
      `«${nombre}» pesa ${Math.round(tamano / 1024 / 1024)} MB y el máximo son ${TAMANO_MAXIMO / 1024 / 1024} MB. Si es un video, subilo al Drive a mano.`,
    )
  }
  if (tamano === 0) throw new ErrorDeNegocio(`«${nombre}» está vacío.`)
}

/** Borra el archivo del disco. Que no esté no es un error: lo importante es que deje de figurar. */
export function borrarArchivoDeAdjunto(relativa: string): void {
  if (!relativa) return
  rmSync(rutaDeAdjunto(relativa), { force: true })
}
