// Respaldo diario: la primera vez que la aplicación está abierta después de las 20:00 se exporta la
// hoja entera a un .xlsx en %APPDATA%/dm-gestion/respaldos/ (se conservan 30) y se sube una copia a la
// carpeta «Respaldos DM» del Drive de la cuenta de servicio.
//
// No hace falta ninguna librería nueva: la exportación y la subida son dos llamadas HTTP a las API de
// Drive, firmadas con el mismo token de la cuenta de servicio que ya usa Sheets.
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { RespaldoGuardado } from '../../shared/tipos'
import { anotarEvento, guardarMarca, leerMarca } from './cola'

export const CARPETA_EN_DRIVE = 'Respaldos DM'
export const RESPALDOS_A_CONSERVAR = 30
/** A partir de esta hora se hace el respaldo del día. */
export const HORA_DEL_RESPALDO = 20

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Lo que el respaldo necesita de Google. Se separa para poder probarlo sin salir a internet. */
export interface ServicioDeRespaldo {
  /** Descarga la hoja entera en formato Excel. */
  exportarXlsx(hojaId: string): Promise<Buffer>
  /** Sube el archivo a la carpeta «Respaldos DM» y devuelve su id, o null si no se pudo. */
  subirADrive(nombre: string, contenido: Buffer): Promise<string | null>
}

export interface ResultadoRespaldo {
  hecho: boolean
  motivo: string
  ruta: string | null
  enDrive: boolean
}

function nombreDelArchivo(fecha: Date): string {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `respaldo-${y}${m}${d}.xlsx`
}

/** ¿Toca respaldar? Después de las 20:00 y si todavía no se hizo el de hoy. */
export function tocaRespaldar(ahora = new Date()): boolean {
  if (ahora.getHours() < HORA_DEL_RESPALDO) return false
  const ultimo = leerMarca('ultimo_respaldo')
  if (!ultimo) return true
  const dia = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
  return ultimo.slice(0, 10) !== dia
}

export async function hacerRespaldo(
  servicio: ServicioDeRespaldo,
  hojaId: string,
  carpeta: string,
  ahora = new Date(),
): Promise<ResultadoRespaldo> {
  mkdirSync(carpeta, { recursive: true })
  const nombre = nombreDelArchivo(ahora)
  const ruta = path.join(carpeta, nombre)

  let contenido: Buffer
  try {
    contenido = await servicio.exportarXlsx(hojaId)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    anotarEvento('respaldo', `No se pudo armar el respaldo de la base: ${motivo}`, { conError: true })
    return { hecho: false, motivo, ruta: null, enDrive: false }
  }
  writeFileSync(ruta, contenido)

  let enDrive = false
  try {
    enDrive = (await servicio.subirADrive(nombre, contenido)) !== null
  } catch (error) {
    // La copia local ya está guardada: que falle Drive no invalida el respaldo.
    const motivo = error instanceof Error ? error.message : String(error)
    anotarEvento('respaldo', `El respaldo quedó guardado acá, pero no se pudo subir a Drive: ${motivo}`, { conError: true })
  }

  const borrados = rotar(carpeta)
  guardarMarca('ultimo_respaldo', ahora.toISOString())
  anotarEvento(
    'respaldo',
    `Respaldo del día guardado en ${nombre} (${Math.round(contenido.length / 1024)} KB)${enDrive ? ' y subido a Drive' : ''}${borrados ? ` · se borraron ${borrados} viejos` : ''}.`,
  )
  return { hecho: true, motivo: 'listo', ruta, enDrive }
}

/** Deja sólo los últimos 30 respaldos. */
export function rotar(carpeta: string, aConservar = RESPALDOS_A_CONSERVAR): number {
  if (!existsSync(carpeta)) return 0
  const archivos = readdirSync(carpeta)
    .filter((a) => a.endsWith('.xlsx'))
    .sort()
  const sobran = archivos.slice(0, Math.max(0, archivos.length - aConservar))
  for (const archivo of sobran) rmSync(path.join(carpeta, archivo), { force: true })
  return sobran.length
}

export function listarRespaldos(carpeta: string): RespaldoGuardado[] {
  if (!existsSync(carpeta)) return []
  return readdirSync(carpeta)
    .filter((a) => a.endsWith('.xlsx'))
    .sort()
    .reverse()
    .map((archivo) => {
      const ruta = path.join(carpeta, archivo)
      const info = statSync(ruta)
      return { archivo, ruta, tamano: info.size, fecha: info.mtime.toISOString(), enDrive: false }
    })
}

// ---------------------------------------------------------------------------
// Implementación contra Google
// ---------------------------------------------------------------------------

/** Devuelve un token de la cuenta de servicio con permiso sobre Drive. */
export type DadorDeToken = () => Promise<string>

export function servicioDeRespaldoDeGoogle(dameToken: DadorDeToken): ServicioDeRespaldo {
  return {
    async exportarXlsx(hojaId: string): Promise<Buffer> {
      const token = await dameToken()
      const respuesta = await fetch(`https://www.googleapis.com/drive/v3/files/${hojaId}/export?mimeType=${encodeURIComponent(TIPO_XLSX)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!respuesta.ok) throw new Error(`Google devolvió ${respuesta.status} al exportar la hoja: ${(await respuesta.text()).slice(0, 200)}`)
      return Buffer.from(await respuesta.arrayBuffer())
    },

    async subirADrive(nombre: string, contenido: Buffer): Promise<string | null> {
      const token = await dameToken()
      return subirArchivoADrive(token, CARPETA_EN_DRIVE, nombre, contenido, TIPO_XLSX)
    },
  }
}

/**
 * Sube un archivo a una carpeta del Drive de la cuenta de servicio (creándola si hace falta). Lo usan
 * el respaldo diario y los adjuntos de los siniestros: es la misma llamada con otro contenido.
 */
export async function subirArchivoADrive(
  token: string,
  nombreDeLaCarpeta: string,
  nombre: string,
  contenido: Buffer,
  tipo: string,
): Promise<string | null> {
  const carpeta = await carpetaEnDrive(token, nombreDeLaCarpeta)
  if (!carpeta) return null

  const limite = `dm-${Math.random().toString(36).slice(2)}`
  const metadatos = JSON.stringify({ name: nombre, parents: [carpeta], mimeType: tipo })
  const cuerpo = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadatos}\r\n--${limite}\r\nContent-Type: ${tipo}\r\n\r\n`),
    contenido,
    Buffer.from(`\r\n--${limite}--\r\n`),
  ])
  const respuesta = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${limite}` },
    body: new Uint8Array(cuerpo),
  })
  if (!respuesta.ok) {
    const detalle = (await respuesta.text()).slice(0, 300)
    // Una cuenta de servicio no tiene Drive propio: la carpeta la tiene que compartir una persona.
    if (/storageQuotaExceeded|does not have storage quota/i.test(detalle)) {
      throw new Error(
        `La cuenta de servicio no tiene espacio propio en Drive. Creá la carpeta «${nombreDeLaCarpeta}» con tu cuenta de Google y compartila con el correo de la cuenta de servicio como editor.`,
      )
    }
    throw new Error(`Google devolvió ${respuesta.status} al subir «${nombre}»: ${detalle}`)
  }
  return ((await respuesta.json()) as { id?: string }).id ?? null
}

/** Busca la carpeta en el Drive de la cuenta de servicio y, si no existe y se puede, la crea. */
async function carpetaEnDrive(token: string, nombreDeLaCarpeta: string): Promise<string | null> {
  const consulta = encodeURIComponent(`name='${nombreDeLaCarpeta}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)
  const buscar = await fetch(`https://www.googleapis.com/drive/v3/files?q=${consulta}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (buscar.ok) {
    const encontradas = ((await buscar.json()) as { files?: Array<{ id: string }> }).files ?? []
    if (encontradas.length > 0) return encontradas[0]!.id
  }
  const crear = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombreDeLaCarpeta, mimeType: 'application/vnd.google-apps.folder' }),
  })
  if (!crear.ok) return null
  return ((await crear.json()) as { id?: string }).id ?? null
}
