// Configuración local en %APPDATA%/dm-gestion/config.json.
// Acá viven las credenciales de Google: nunca se guardan en la base ni en el repositorio.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { EstadoConexionGoogle } from '../../shared/tipos'
import { rutaConfig } from '../rutas'
import { ErrorDeNegocio } from './errores'
import { objeto, texto } from './validacion'

/** Campos que trae el JSON que descarga Google al crear una cuenta de servicio. */
interface CuentaServicio {
  type?: string
  project_id?: string
  client_email?: string
  private_key?: string
  [clave: string]: unknown
}

interface ConfigGoogle {
  cuentaServicio: CuentaServicio
  urlHoja: string
  actualizadoEn: string
}

/** Ajustes opcionales del puente con el VPS; sin este bloque valen los valores embebidos. */
interface ConfigVps {
  urlBase?: string
  token?: string
}

interface Config {
  google?: ConfigGoogle
  vps?: ConfigVps
}

// La base del GENERAL DE CLIENTES vive en el VPS de la agencia desde la v12. La URL y el token van
// embebidos (mismo criterio que TOKEN_DATOS y UPDATE_TOKEN: el repositorio es privado) y config.json
// puede pisarlos para pruebas o si algún día cambia el dominio.
const VPS_URL_BASE = 'https://dmartinezseguros.com'
const VPS_TOKEN = '8b8e041002f5125c317b463b551e6fd90fd6fad0ec827cac09e824d17ed3a5cb'

export function credencialesVps(): { urlBase: string; token: string } {
  const vps = leerConfig().vps
  return {
    urlBase: typeof vps?.urlBase === 'string' && vps.urlBase.trim() ? vps.urlBase.trim() : VPS_URL_BASE,
    token: typeof vps?.token === 'string' && vps.token.trim() ? vps.token.trim() : VPS_TOKEN,
  }
}

function leerConfig(): Config {
  const ruta = rutaConfig()
  if (!existsSync(ruta)) return {}
  try {
    const contenido = JSON.parse(readFileSync(ruta, 'utf8')) as unknown
    return typeof contenido === 'object' && contenido !== null ? (contenido as Config) : {}
  } catch (error) {
    console.error('[config] No se pudo leer config.json:', error)
    return {}
  }
}

/** Escritura atómica: primero a un archivo temporal y después se renombra. */
function escribirConfig(config: Config): void {
  const ruta = rutaConfig()
  mkdirSync(path.dirname(ruta), { recursive: true })
  const temporal = `${ruta}.tmp`
  writeFileSync(temporal, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporal, ruta)
}

function aEstado(google: ConfigGoogle | undefined): EstadoConexionGoogle {
  if (!google) {
    return { configurado: false, clientEmail: null, projectId: null, urlHoja: null, actualizadoEn: null }
  }
  return {
    configurado: true,
    clientEmail: typeof google.cuentaServicio.client_email === 'string' ? google.cuentaServicio.client_email : null,
    projectId: typeof google.cuentaServicio.project_id === 'string' ? google.cuentaServicio.project_id : null,
    urlHoja: google.urlHoja,
    actualizadoEn: google.actualizadoEn,
  }
}

export function estadoGoogle(): EstadoConexionGoogle {
  return aEstado(leerConfig().google)
}

/** Credenciales completas para el importador (nunca salen del proceso principal). */
export function credencialesGoogle(): { cuentaServicio: Record<string, unknown>; urlHoja: string } | null {
  const google = leerConfig().google
  if (!google?.cuentaServicio || !google.urlHoja) return null
  return { cuentaServicio: google.cuentaServicio as Record<string, unknown>, urlHoja: google.urlHoja }
}

const FORMATO_URL_HOJA = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+/

function validarCuentaServicio(contenido: string): CuentaServicio {
  let json: unknown
  try {
    json = JSON.parse(contenido)
  } catch {
    throw new ErrorDeNegocio('El contenido pegado no es un JSON válido.')
  }
  const cuenta = objeto(json, 'Los datos de la cuenta de servicio') as CuentaServicio
  if (
    cuenta.type !== 'service_account' ||
    typeof cuenta.client_email !== 'string' ||
    typeof cuenta.private_key !== 'string'
  ) {
    throw new ErrorDeNegocio(
      'El JSON no parece ser de una cuenta de servicio de Google: tiene que incluir "type": "service_account", "client_email" y "private_key".',
    )
  }
  return cuenta
}

export function guardarGoogle(datos: unknown): EstadoConexionGoogle {
  const d = objeto(datos, 'Los datos de conexión')
  const urlHoja = texto(d.urlHoja, 'La URL de la hoja de cálculo', 1, 2048)
  if (!FORMATO_URL_HOJA.test(urlHoja)) {
    throw new ErrorDeNegocio(
      'La URL tiene que ser de una hoja de cálculo de Google (https://docs.google.com/spreadsheets/d/...).',
    )
  }

  const contenido = typeof d.cuentaServicioJson === 'string' ? d.cuentaServicioJson.trim() : ''
  const config = leerConfig()

  let cuentaServicio: CuentaServicio
  if (contenido) {
    cuentaServicio = validarCuentaServicio(contenido)
  } else if (config.google) {
    // Sin JSON nuevo se conserva la cuenta ya guardada y sólo se actualiza la URL.
    cuentaServicio = config.google.cuentaServicio
  } else {
    throw new ErrorDeNegocio('Pegá el contenido del JSON de la cuenta de servicio.')
  }

  config.google = { cuentaServicio, urlHoja, actualizadoEn: new Date().toISOString() }
  escribirConfig(config)
  return aEstado(config.google)
}

