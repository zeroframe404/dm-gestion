// Documentos adjuntos de un siniestro: la denuncia, el presupuesto del taller, las fotos del granizo.
//
// Se guardan como archivos, no dentro de la base: %APPDATA%/dm-gestion/adjuntos/<siniestro>/. Así se
// abren con doble clic desde la ficha, se pueden copiar a mano si hace falta y la base no engorda.
// Si hay conexión con Google, además se sube una copia a la carpeta «Adjuntos DM» del Drive de la
// cuenta de servicio; que eso falle nunca hace fracasar la carga, igual que con el respaldo diario.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { carpetaDatos } from '../rutas'
import { subirArchivoADrive } from '../sincronizacion/respaldo'
import { ErrorDeNegocio } from './errores'

export const CARPETA_DE_ADJUNTOS_EN_DRIVE = 'Adjuntos DM'

/** Más que esto no es un papel del siniestro: es un video o alguien se equivocó de archivo. */
export const TAMANO_MAXIMO = 25 * 1024 * 1024

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
 * 7 y no se les mueve el piso) y las tareas de la Fase 8 usan «tarea-<id>».
 */
export function carpetaDelGrupo(grupo: string): string {
  return path.join(carpetaDeAdjuntos(), grupo)
}

/** Ruta absoluta de un adjunto a partir de lo que guarda la base (`<grupo>/<archivo>`). */
export function rutaDeAdjunto(relativa: string): string {
  return path.join(carpetaDeAdjuntos(), relativa)
}

/**
 * Deja el nombre en algo que Windows acepte como archivo, sin perder de vista cuál era: se cambian los
 * caracteres prohibidos por guiones y se recorta si es larguísimo, conservando la extensión.
 */
export function nombreSeguro(nombre: string): string {
  const base = path.basename(nombre).replace(/[<>:"/\|?*]/g, '-').trim()
  if (!base || base === '.' || base === '..') return 'adjunto'
  const extension = path.extname(base)
  const cuerpo = base.slice(0, base.length - extension.length)
  return `${cuerpo.slice(0, 80) || 'adjunto'}${extension.slice(0, 12)}`
}

export interface AdjuntoCopiado {
  /** Nombre para mostrar (el original). */
  nombre: string
  /** Ruta relativa a la carpeta de adjuntos: '<siniestro>/<archivo>'. */
  archivo: string
  tamano: number
}

/**
 * Copia el archivo a la carpeta del siniestro. Si ya había uno con ese nombre no lo pisa: le agrega
 * «(2)», «(3)»… porque dos fotos distintas pueden llamarse las dos IMG_0001.jpg y perder una sería
 * perder una prueba del reclamo.
 */
export function copiarAdjunto(siniestroId: number, rutaOrigen: string): AdjuntoCopiado {
  return copiarAdjuntoEn(String(siniestroId), rutaOrigen)
}

/** El mismo copiado, para cualquier grupo de adjuntos (los siniestros y las tareas de la Fase 8). */
export function copiarAdjuntoEn(grupo: string, rutaOrigen: string): AdjuntoCopiado {
  if (!existsSync(rutaOrigen)) throw new ErrorDeNegocio(`No se encontró el archivo «${path.basename(rutaOrigen)}».`)
  const info = statSync(rutaOrigen)
  if (!info.isFile()) throw new ErrorDeNegocio(`«${path.basename(rutaOrigen)}» no es un archivo.`)
  if (info.size > TAMANO_MAXIMO) {
    throw new ErrorDeNegocio(
      `«${path.basename(rutaOrigen)}» pesa ${Math.round(info.size / 1024 / 1024)} MB y el máximo son ${TAMANO_MAXIMO / 1024 / 1024} MB. Achicá la foto o subilo al Drive a mano.`,
    )
  }

  const carpeta = carpetaDelGrupo(grupo)
  mkdirSync(carpeta, { recursive: true })

  const original = nombreSeguro(path.basename(rutaOrigen))
  const extension = path.extname(original)
  const cuerpo = original.slice(0, original.length - extension.length)
  let nombre = original
  let intento = 2
  while (existsSync(path.join(carpeta, nombre))) {
    nombre = `${cuerpo} (${intento})${extension}`
    intento++
  }

  try {
    copyFileSync(rutaOrigen, path.join(carpeta, nombre))
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(`No se pudo copiar «${path.basename(rutaOrigen)}»: ${motivo}`)
  }
  return { nombre: path.basename(rutaOrigen), archivo: `${grupo}/${nombre}`, tamano: info.size }
}

/** Borra el archivo del disco. Que no esté no es un error: lo importante es que deje de figurar. */
export function borrarArchivoDeAdjunto(relativa: string): void {
  rmSync(rutaDeAdjunto(relativa), { force: true })
}

export interface ResultadoDeDrive {
  driveId: string | null
  error: string | null
}

/**
 * Sube la copia a Drive. Nunca lanza: el archivo local ya está guardado y el motivo del fallo queda
 * anotado junto al adjunto para que se vea en la ficha.
 */
export async function subirAdjuntoADrive(
  dameToken: (() => Promise<string>) | null,
  siniestroId: number,
  copia: AdjuntoCopiado,
): Promise<ResultadoDeDrive> {
  return subirAdjuntoADriveComo(dameToken, `siniestro-${siniestroId}`, copia)
}

/** La misma subida, con la etiqueta que lleva el archivo en el Drive («siniestro-12», «tarea-40»). */
export async function subirAdjuntoADriveComo(
  dameToken: (() => Promise<string>) | null,
  etiqueta: string,
  copia: AdjuntoCopiado,
): Promise<ResultadoDeDrive> {
  if (!dameToken) return { driveId: null, error: null }
  try {
    const token = await dameToken()
    const contenido = readFileSync(rutaDeAdjunto(copia.archivo))
    const nombre = `${etiqueta} — ${copia.nombre}`
    const driveId = await subirArchivoADrive(token, CARPETA_DE_ADJUNTOS_EN_DRIVE, nombre, contenido, tipoDeArchivo(copia.nombre))
    return { driveId, error: driveId ? null : 'No se pudo crear la carpeta «Adjuntos DM» en el Drive.' }
  } catch (error) {
    return { driveId: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }
  }
}
