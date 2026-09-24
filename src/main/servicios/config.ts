// Configuración local en %APPDATA%/dm-gestion/config.json.
// Acá viven las credenciales de Google: nunca se guardan en la base ni en el repositorio.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { EstadoConexionGoogle, EstadoDeMeta } from '../../shared/tipos'
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

/**
 * La app de Meta para publicar en Facebook e Instagram. Es una credencial, así que va acá y no en la
 * base, por el mismo criterio que la cuenta de servicio de Google: config.json no se sincroniza ni
 * entra al repositorio.
 */
interface ConfigMeta {
  appId: string
  appSecret: string
  /**
   * La dirección a la que Facebook vuelve después de autorizar. Vacío o ausente = la de fábrica
   * (`URL_DE_REDIRECCION_DE_META`). Se puede cargar porque el día que cambie el dominio de la agencia
   * hay que poder corregirla sin publicar una versión nueva, y porque tiene que ser EXACTAMENTE la
   * misma en las cinco computadoras: por eso viaja con el resto del ajuste.
   */
  urlDeRedireccion?: string
  actualizadoEn: string
}

/** La consola del control remoto (MeshCentral). Sólo la URL; adentro se entra con usuario y clave. */
interface ConfigMesh {
  url?: string
}

/**
 * El legajo del productor conectado a la cuenta de Galeno, cacheado en ESTA computadora. La cuenta en
 * sí (usuario, clave, ambiente, URL y Authorization de producción) ya no vive acá: Galeno sólo acepta
 * pedidos desde la IP del VPS, así que la usa el servidor (`galenoRest.service.ts` allá) y esta
 * computadora sólo le pasa la ruta y el pedido a través del puente (`credencialesVps`). Ver
 * `main/aseguradoras/galeno/cliente.ts` y API Aseguradoras → Galeno, que ahora edita el ajuste
 * compartido `galenoApi` en vez de esto.
 *
 * El legajo sí queda por computadora: es sólo una cache de una consulta barata (el propio servicio lo
 * completa solo, la primera vez que prueba la conexión o cotiza), no un secreto que haga falta
 * compartir.
 */
interface ConfigGaleno {
  productorCodigo?: string
}

interface Config {
  google?: ConfigGoogle
  vps?: ConfigVps
  meta?: ConfigMeta
  mesh?: ConfigMesh
  galeno?: ConfigGaleno
}

/**
 * La dirección a la que Facebook vuelve después de que la persona autoriza. Nunca se navega a ella
 * —el programa atrapa el intento y lo cancela—, así que no hace falta que exista: sólo tiene que ser
 * EXACTAMENTE la misma que está registrada en el panel de Meta, y ese es el error de configuración
 * número uno. Por eso la pantalla la muestra con un botón para copiarla.
 *
 * Ésta es la de fábrica; la que vale la devuelve `urlDeVueltaDeMeta()`, porque desde la v12.4 se puede
 * cargar y viaja al resto de las computadoras junto con la app.
 */
export const URL_DE_REDIRECCION_DE_META = 'https://dmartinezseguros.com/meta/vuelta'

/** La dirección de vuelta vigente: la cargada, o la de fábrica mientras nadie haya cargado otra. */
export function urlDeVueltaDeMeta(): string {
  const escrita = leerConfig().meta?.urlDeRedireccion
  return typeof escrita === 'string' && escrita.trim() ? escrita.trim() : URL_DE_REDIRECCION_DE_META
}

// La base del GENERAL DE CLIENTES vive en el VPS de la agencia desde la v12. La URL y el token van
// embebidos y config.json puede pisarlos para pruebas o si algún día cambia el dominio.
//
// OJO: ese criterio ("total el repositorio es privado") ya no vale — el repositorio es PÚBLICO, así
// que este token, como TOKEN_DATOS, está a la vista de cualquiera. Hay que rotarlos y sacarlos del
// código (leerlos de config.json, que no se publica). El del updater ya se sacó: no hacía falta.
const VPS_URL_BASE = 'https://dmartinezseguros.com'
const VPS_TOKEN = '8b8e041002f5125c317b463b551e6fd90fd6fad0ec827cac09e824d17ed3a5cb'

// La consola con la que se atienden las computadoras de las sucursales sin ir hasta el local. Vive en
// el mismo VPS, detrás de su subdominio. Va embebida por el mismo criterio que la URL del VPS, y
// config.json la puede pisar para probar contra otra instalación.
const MESH_URL = 'https://mesh.dmartinezseguros.com'

export function urlDelMesh(): string {
  const mesh = leerConfig().mesh
  const escrita = typeof mesh?.url === 'string' ? mesh.url.trim() : ''
  return escrita || MESH_URL
}

export function credencialesVps(): { urlBase: string; token: string } {
  const vps = leerConfig().vps
  return {
    urlBase: typeof vps?.urlBase === 'string' && vps.urlBase.trim() ? vps.urlBase.trim() : VPS_URL_BASE,
    token: typeof vps?.token === 'string' && vps.token.trim() ? vps.token.trim() : VPS_TOKEN,
  }
}

/**
 * La ruta del config.json, o '' si no hay Electron alrededor.
 *
 * El banco de pruebas importa los servicios en Node pelado y ahí `app.getPath` no existe. Sin este
 * guard, cualquier prueba que toque un servicio que lee la configuración —el catálogo de vehículos,
 * por ejemplo— se cae con «Cannot read properties of undefined». Sin ruta no hay configuración, que
 * es exactamente lo que una prueba quiere: arrancar sin nada cargado.
 */
function rutaSegura(): string {
  try {
    return rutaConfig()
  } catch {
    return ''
  }
}

function leerConfig(): Config {
  const ruta = rutaSegura()
  if (!ruta || !existsSync(ruta)) return {}
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

// ---------------------------------------------------------------------------
// La app de Meta (Facebook e Instagram)
// ---------------------------------------------------------------------------

export function estadoMeta(): EstadoDeMeta {
  const meta = leerConfig().meta
  return {
    configurada: Boolean(meta?.appId && meta.appSecret),
    // El App ID se muestra —está a la vista en cualquier posteo— y el App Secret no sale nunca de acá.
    appId: meta?.appId ?? '',
    urlDeRedireccion: urlDeVueltaDeMeta(),
    rutaDeConfig: rutaSegura(),
    actualizadoEn: meta?.actualizadoEn ?? null,
  }
}

/** Las credenciales completas, sólo para el proceso principal. */
export function credencialesMeta(): { appId: string; appSecret: string } | null {
  const meta = leerConfig().meta
  if (!meta?.appId || !meta.appSecret) return null
  return { appId: meta.appId, appSecret: meta.appSecret }
}

export function guardarMeta(datos: unknown): EstadoDeMeta {
  const d = objeto(datos, 'Los datos de la app de Meta')
  const appId = texto(d.appId, 'El identificador de la app (App ID)', 1, 64)
  if (!/^\d+$/.test(appId)) throw new ErrorDeNegocio('El App ID de Meta es sólo números. Copialo de developers.facebook.com.')

  const config = leerConfig()
  // Con el secreto vacío se conserva el que ya estaba: así se puede corregir el App ID sin tener que
  // ir a buscar de nuevo el secreto, que Meta muestra una sola vez.
  const escrito = typeof d.appSecret === 'string' ? d.appSecret.trim() : ''
  const appSecret = escrito || config.meta?.appSecret || ''
  if (!appSecret) throw new ErrorDeNegocio('Falta la clave secreta de la app (App Secret).')

  // La dirección de vuelta: vacía deja la de fábrica, que es lo que quiere el 99 % de las veces.
  const vuelta = typeof d.urlDeRedireccion === 'string' ? d.urlDeRedireccion.trim() : ''
  if (vuelta && !/^https:\/\//i.test(vuelta)) {
    throw new ErrorDeNegocio('La dirección de vuelta de Meta tiene que empezar con https://; es la que se registra en el panel de la app.')
  }

  escribirConfig({
    ...config,
    meta: {
      appId,
      appSecret,
      ...(vuelta ? { urlDeRedireccion: vuelta } : {}),
      actualizadoEn: new Date().toISOString(),
    },
  })
  return estadoMeta()
}

// ---------------------------------------------------------------------------
// Lo que viaja al resto de las computadoras
//
// Tres de estos ajustes se cargaban máquina por máquina y con eso alcanzaba para que una sucursal
// trabajara distinto que las otras sin que nadie se enterara: la que no tenía Google no subía los
// adjuntos de los siniestros, la que no tenía la app de Meta no podía publicar, y la que tenía otra
// dirección de vuelta fallaba el login de Facebook con un mensaje que no explica nada. Desde la v12.4
// los carga el superadministrador una vez y el resto los adopta (ver ajustesCompartidos.ts).
//
// En los tres, el ORDEN DE LAS CLAVES está escrito a mano y no se toca: la huella con la que el
// servidor y cada computadora se comparan es el hash del JSON, así que dos objetos con los mismos
// datos en distinto orden darían huellas distintas y la pantalla diría «desactualizada» para siempre.
// ---------------------------------------------------------------------------

/** Lo que viaja de la conexión con Google. Sin cuenta o sin hoja no hay nada que compartir. */
export function valorCompartidoDeGoogle(): { cuentaServicio: Record<string, unknown>; urlHoja: string } | null {
  const google = leerConfig().google
  if (!google?.cuentaServicio || !google.urlHoja) return null
  return { cuentaServicio: google.cuentaServicio as Record<string, unknown>, urlHoja: google.urlHoja }
}

/**
 * Escribe la conexión con Google tal cual vino del servidor, sin las validaciones de la pantalla: lo
 * que bajó ya lo validó quien lo cargó, y volver a pasarlo por «el JSON vacío conserva el anterior»
 * tendría el efecto contrario al que se busca.
 */
export function adoptarGoogle(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as { cuentaServicio?: unknown; urlHoja?: unknown }
  if (!v.cuentaServicio || typeof v.cuentaServicio !== 'object' || Array.isArray(v.cuentaServicio)) return false
  // Sin URL de la hoja la cuenta sirve igual: desde la v12 la hoja es sólo la migración, y lo que las
  // computadoras necesitan de Google es el token para Drive (respaldos y adjuntos). Hasta la 12.5 esto
  // rechazaba el valor y la PC quedaba sin Drive sin decir nada.
  const urlHoja = typeof v.urlHoja === 'string' ? v.urlHoja.trim() : ''
  const cuenta = v.cuentaServicio as CuentaServicio
  // La misma comprobación mínima que hace la pantalla: sin `client_email` y `private_key` no se puede
  // firmar nada, y adoptarla dejaría a esta computadora peor de lo que estaba.
  if (typeof cuenta.client_email !== 'string' || typeof cuenta.private_key !== 'string') return false

  const config = leerConfig()
  config.google = { cuentaServicio: cuenta, urlHoja, actualizadoEn: new Date().toISOString() }
  escribirConfig(config)
  return true
}

/**
 * Lo que viaja de la app de Meta. `urlDeRedireccion` va SIEMPRE, con la de fábrica cuando no se cargó
 * ninguna: es el dato que tiene que ser idéntico en las cinco computadoras y en el panel de Meta, así
 * que mandarlo explícito es justamente el punto.
 */
export function valorCompartidoDeMeta(): { appId: string; appSecret: string; urlDeRedireccion: string } | null {
  const meta = leerConfig().meta
  if (!meta?.appId || !meta.appSecret) return null
  return { appId: meta.appId, appSecret: meta.appSecret, urlDeRedireccion: urlDeVueltaDeMeta() }
}

export function adoptarMeta(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as { appId?: unknown; appSecret?: unknown; urlDeRedireccion?: unknown }
  const appId = typeof v.appId === 'string' ? v.appId.trim() : ''
  const appSecret = typeof v.appSecret === 'string' ? v.appSecret.trim() : ''
  if (!appId || !appSecret) return false
  const vuelta = typeof v.urlDeRedireccion === 'string' ? v.urlDeRedireccion.trim() : ''

  const config = leerConfig()
  config.meta = {
    appId,
    appSecret,
    ...(vuelta && vuelta !== URL_DE_REDIRECCION_DE_META ? { urlDeRedireccion: vuelta } : {}),
    actualizadoEn: new Date().toISOString(),
  }
  escribirConfig(config)
  return true
}

/** Saca la app de Meta de esta computadora. El vínculo con la Página se borra aparte. */
export function borrarMeta(): EstadoDeMeta {
  const config = leerConfig()
  delete config.meta
  escribirConfig(config)
  return estadoMeta()
}

/** Credenciales completas para el importador (nunca salen del proceso principal). */
/**
 * La cuenta de servicio para Drive, tenga o no URL de hoja: para firmar el token no hace falta la hoja.
 * `credencialesGoogle` (la migración) sigue exigiendo las dos cosas.
 */
export function credencialesParaDrive(): { cuentaServicio: Record<string, unknown>; urlHoja: string | null } | null {
  const google = leerConfig().google
  if (!google?.cuentaServicio) return null
  const cuenta = google.cuentaServicio as Record<string, unknown>
  if (typeof cuenta.client_email !== 'string' || typeof cuenta.private_key !== 'string') return null
  return { cuentaServicio: cuenta, urlHoja: google.urlHoja || null }
}

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

// ---------------------------------------------------------------------------
// Galeno Seguros: sólo el legajo cacheado. La cuenta vive en el VPS (ver la nota de `ConfigGaleno`).
// ---------------------------------------------------------------------------

/** El legajo del productor ya identificado en esta computadora, o `null` si todavía no se resolvió. */
export function legajoGaleno(): string | null {
  return leerConfig().galeno?.productorCodigo ?? null
}

/**
 * Lo guarda el propio servicio, no una persona: la primera vez que identifica el legajo del
 * productor conectado (web Service de Planes Comerciales), para no tener que volver a pedirlo en
 * cada consulta de Cuenta Corriente o de Pólizas por Legajo.
 */
export function guardarLegajoGaleno(productorCodigo: string): void {
  const config = leerConfig()
  escribirConfig({ ...config, galeno: { productorCodigo } })
}

