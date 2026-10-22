// Configuración local en %APPDATA%/dm-gestion/config.json.
// Acá viven las credenciales de Google: nunca se guardan en la base ni en el repositorio.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  AMBIENTES_ATM,
  AMBIENTES_EQUIDAD,
  AMBIENTES_MERCANTIL,
  EMPRESA_EQUIDAD_POR_DEFECTO,
  RAMA_AUTOMOTOR_EQUIDAD_POR_DEFECTO,
  type AmbienteAtm,
  type AmbienteEquidad,
  type AmbienteMercantil,
  type EstadoConexionGoogle,
  type EstadoDeMeta,
} from '../../shared/tipos'
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

/**
 * La cuenta del web service de ATM Seguros. A diferencia de la de Galeno, ésta SÍ vive en cada
 * computadora: ATM no pide que los pedidos salgan de una IP dada de alta, así que cada PC cotiza
 * directo. Se carga una vez en API Aseguradoras → ATM y viaja a las demás como el ajuste compartido
 * `atmApi` (ver ajustesCompartidos.ts), igual que la app de Meta.
 */
interface ConfigAtm {
  ambiente: AmbienteAtm
  usuario: string
  clave: string
  /** El código de vendedor de 10 dígitos con que se cotiza; vacío = el primero de la cuenta. */
  vendedor: string
  actualizadoEn: string
}

/**
 * La cuenta de la API de Mercantil Andina. Como la de ATM, vive en cada computadora (Mercantil tampoco
 * restringe por IP) y viaja a las demás como el ajuste compartido `mercantilApi`. Son tres secretos
 * que hacen falta juntos: el usuario y la contraseña que da Mercantil, y la «subscription key» del
 * portal de APIs (ver la nota en shared/tipos.ts).
 */
interface ConfigMercantil {
  ambiente: AmbienteMercantil
  usuario: string
  clave: string
  claveDeSuscripcion: string
  /** El código de productor (PAS) con que se cotiza; vacío = el que Mercantil asocia al usuario. */
  productor: string
  actualizadoEn: string
}

/**
 * La cuenta de la API GLM de La Equidad. Como la de ATM y la de Mercantil, vive en cada computadora
 * (Equidad tampoco restringe por IP) y viaja a las demás como el ajuste compartido `equidadApi`. Son
 * dos pares de credenciales (el usuario de aplicación y el de servicio, ver la nota en shared/tipos.ts)
 * más la URL base del servlet, que cambia entre el ambiente de prueba y el de producción.
 */
interface ConfigEquidad {
  ambiente: AmbienteEquidad
  urlBase: string
  usuario: string
  clave: string
  usuarioDeServicio: string
  claveDeServicio: string
  productor: string
  rama: string
  empresa: string
  actualizadoEn: string
}

interface Config {
  google?: ConfigGoogle
  vps?: ConfigVps
  meta?: ConfigMeta
  mesh?: ConfigMesh
  galeno?: ConfigGaleno
  atm?: ConfigAtm
  mercantil?: ConfigMercantil
  equidad?: ConfigEquidad
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

/** true si `urlBase` es el servidor de verdad de la agencia (y no un servidor de pruebas que alguien cargó). */
export function esElVpsDeProduccion(urlBase: string): boolean {
  const sinBarra = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase()
  return sinBarra(urlBase) === sinBarra(VPS_URL_BASE)
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


// ---------------------------------------------------------------------------
// ATM Seguros: la cuenta del web service (ver la nota de `ConfigAtm`).
// ---------------------------------------------------------------------------

/** Lo que se puede mostrar de la cuenta de ATM: todo menos la clave. */
export function cuentaAtmVisible(): { configurada: boolean; ambiente: AmbienteAtm; usuario: string; vendedor: string; actualizadoEn: string | null } {
  const atm = leerConfig().atm
  return {
    configurada: Boolean(atm?.usuario && atm.clave),
    ambiente: atm?.ambiente === 'desarrollo' ? 'desarrollo' : 'produccion',
    usuario: atm?.usuario ?? '',
    vendedor: atm?.vendedor ?? '',
    actualizadoEn: atm?.actualizadoEn ?? null,
  }
}

/** La cuenta completa, sólo para el proceso principal. Null si no está cargada. */
export function credencialesAtm(): { ambiente: AmbienteAtm; usuario: string; clave: string; vendedor: string } | null {
  const atm = leerConfig().atm
  if (!atm?.usuario || !atm.clave) return null
  return { ambiente: atm.ambiente === 'desarrollo' ? 'desarrollo' : 'produccion', usuario: atm.usuario, clave: atm.clave, vendedor: atm.vendedor ?? '' }
}

/** Lo mismo que hacen `guardarAtm` y `adoptarAtm`: si no, la huella del ajuste compartido no cerraría nunca. */
function normalizarAtm(ambiente: unknown, usuario: string, clave: string, vendedor: string): Omit<ConfigAtm, 'actualizadoEn'> {
  return {
    ambiente: typeof ambiente === 'string' && (AMBIENTES_ATM as readonly string[]).includes(ambiente) ? (ambiente as AmbienteAtm) : 'produccion',
    usuario: usuario.trim(),
    clave: clave.trim(),
    vendedor: vendedor.replace(/\s/g, ''),
  }
}

export function guardarAtm(datos: unknown): void {
  const d = objeto(datos, 'Los datos de la cuenta de ATM')
  const usuario = texto(d.usuario, 'El usuario de ATM', 1, 60)
  const config = leerConfig()
  // Con la clave vacía se conserva la que ya estaba: así se cambia el vendedor sin volver a escribirla.
  const escrita = typeof d.clave === 'string' ? d.clave.trim() : ''
  // La clave guardada es la del usuario guardado: con otro usuario hay que escribir la suya.
  if (!escrita && config.atm?.usuario && config.atm.usuario !== usuario.trim()) {
    throw new ErrorDeNegocio('Cambiaste el usuario de ATM: escribí también su clave.')
  }
  const clave = escrita || config.atm?.clave || ''
  if (!clave) throw new ErrorDeNegocio('Falta la clave de la cuenta de ATM.')
  const vendedor = typeof d.vendedor === 'string' ? d.vendedor.replace(/\s/g, '') : ''
  if (vendedor && !/^\d{10}$/.test(vendedor)) {
    throw new ErrorDeNegocio('El código de vendedor de ATM tiene 10 números (por ejemplo, 0956112663). Dejalo vacío para usar el de la cuenta.')
  }
  if (typeof d.ambiente !== 'string' || !(AMBIENTES_ATM as readonly string[]).includes(d.ambiente)) {
    throw new ErrorDeNegocio('Elegí el ambiente de ATM: producción o desarrollo.')
  }
  escribirConfig({ ...config, atm: { ...normalizarAtm(d.ambiente, usuario, clave, vendedor), actualizadoEn: new Date().toISOString() } })
}

/** Saca la cuenta de ATM de esta computadora. */
export function borrarAtm(): void {
  const config = leerConfig()
  delete config.atm
  escribirConfig(config)
}

/**
 * Lo que viaja de la cuenta de ATM: siempre las cuatro claves, en este orden y como texto (el vendedor
 * vacío va vacío, no se omite), por la huella. Sin usuario o clave no hay nada que compartir.
 */
export function valorCompartidoDeAtm(): { ambiente: AmbienteAtm; usuario: string; clave: string; vendedor: string } | null {
  const atm = credencialesAtm()
  if (!atm) return null
  return { ambiente: atm.ambiente, usuario: atm.usuario, clave: atm.clave, vendedor: atm.vendedor }
}

export function adoptarAtm(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as { ambiente?: unknown; usuario?: unknown; clave?: unknown; vendedor?: unknown }
  const atm = normalizarAtm(
    v.ambiente,
    typeof v.usuario === 'string' ? v.usuario : '',
    typeof v.clave === 'string' ? v.clave : '',
    typeof v.vendedor === 'string' ? v.vendedor : '',
  )
  if (!atm.usuario || !atm.clave) return false
  const config = leerConfig()
  config.atm = { ...atm, actualizadoEn: new Date().toISOString() }
  escribirConfig(config)
  return true
}

// ---------------------------------------------------------------------------
// Mercantil Andina: la cuenta de su API (ver la nota de `ConfigMercantil`).
// ---------------------------------------------------------------------------

export interface CredencialesMercantil {
  ambiente: AmbienteMercantil
  usuario: string
  clave: string
  claveDeSuscripcion: string
  productor: string
}

function ambienteMercantil(valor: unknown): AmbienteMercantil {
  return typeof valor === 'string' && (AMBIENTES_MERCANTIL as readonly string[]).includes(valor) ? (valor as AmbienteMercantil) : 'produccion'
}

/** Lo que se puede mostrar de la cuenta de Mercantil: todo menos la contraseña y la clave de suscripción (de ésta, el final). */
export function cuentaMercantilVisible(): {
  configurada: boolean
  ambiente: AmbienteMercantil
  usuario: string
  finDeClaveDeSuscripcion: string
  productor: string
  actualizadoEn: string | null
} {
  const m = leerConfig().mercantil
  return {
    configurada: Boolean(m?.usuario && m.clave && m.claveDeSuscripcion),
    ambiente: ambienteMercantil(m?.ambiente),
    usuario: m?.usuario ?? '',
    finDeClaveDeSuscripcion: m?.claveDeSuscripcion ? m.claveDeSuscripcion.slice(-4) : '',
    productor: m?.productor ?? '',
    actualizadoEn: m?.actualizadoEn ?? null,
  }
}

/** La cuenta completa, sólo para el proceso principal. Null si no está cargada entera. */
export function credencialesMercantil(): CredencialesMercantil | null {
  const m = leerConfig().mercantil
  if (!m?.usuario || !m.clave || !m.claveDeSuscripcion) return null
  return { ambiente: ambienteMercantil(m.ambiente), usuario: m.usuario, clave: m.clave, claveDeSuscripcion: m.claveDeSuscripcion, productor: m.productor ?? '' }
}

/** Lo mismo que hacen `guardarMercantil` y `adoptarMercantil`: si no, la huella del ajuste compartido no cerraría nunca. */
function normalizarMercantil(ambiente: unknown, usuario: string, clave: string, claveDeSuscripcion: string, productor: string): Omit<ConfigMercantil, 'actualizadoEn'> {
  return {
    ambiente: ambienteMercantil(ambiente),
    usuario: usuario.trim(),
    clave: clave.trim(),
    claveDeSuscripcion: claveDeSuscripcion.trim(),
    productor: productor.replace(/\s/g, ''),
  }
}

export function guardarMercantil(datos: unknown): void {
  const d = objeto(datos, 'Los datos de la cuenta de Mercantil Andina')
  const usuario = texto(d.usuario, 'El usuario de Mercantil', 1, 120)
  const config = leerConfig()
  const mismoUsuario = Boolean(config.mercantil?.usuario) && config.mercantil?.usuario === usuario.trim()
  // Con la contraseña vacía se conserva la que ya estaba: así se cambia el productor sin volver a escribirla.
  const claveEscrita = typeof d.clave === 'string' ? d.clave.trim() : ''
  if (!claveEscrita && config.mercantil?.usuario && !mismoUsuario) {
    throw new ErrorDeNegocio('Cambiaste el usuario de Mercantil: escribí también su contraseña.')
  }
  const clave = claveEscrita || config.mercantil?.clave || ''
  if (!clave) throw new ErrorDeNegocio('Falta la contraseña de la cuenta de Mercantil Andina.')
  // La clave de suscripción es del portal, no del usuario: se conserva aunque cambie el usuario.
  const suscripcionEscrita = typeof d.claveDeSuscripcion === 'string' ? d.claveDeSuscripcion.trim() : ''
  const claveDeSuscripcion = suscripcionEscrita || config.mercantil?.claveDeSuscripcion || ''
  if (!claveDeSuscripcion) throw new ErrorDeNegocio('Falta la clave de suscripción del portal de APIs de Mercantil (Ocp-Apim-Subscription-Key).')
  if (/\s/.test(claveDeSuscripcion) || claveDeSuscripcion.length > 200) throw new ErrorDeNegocio('La clave de suscripción de Mercantil no es válida: es una tira de letras y números, sin espacios.')
  const productor = typeof d.productor === 'string' ? d.productor.replace(/\s/g, '') : ''
  if (productor && !/^\d{1,10}$/.test(productor)) {
    throw new ErrorDeNegocio('El código de productor de Mercantil es numérico (hasta 10 números). Dejalo vacío para usar el del usuario.')
  }
  if (typeof d.ambiente !== 'string' || !(AMBIENTES_MERCANTIL as readonly string[]).includes(d.ambiente)) {
    throw new ErrorDeNegocio('Elegí el ambiente de Mercantil: producción o desarrollo.')
  }
  escribirConfig({
    ...config,
    mercantil: { ...normalizarMercantil(d.ambiente, usuario, clave, claveDeSuscripcion, productor), actualizadoEn: new Date().toISOString() },
  })
}

/** Saca la cuenta de Mercantil de esta computadora. */
export function borrarMercantil(): void {
  const config = leerConfig()
  delete config.mercantil
  escribirConfig(config)
}

/**
 * Lo que viaja de la cuenta de Mercantil: siempre las cinco claves, en este orden y como texto (el
 * productor vacío va vacío, no se omite), por la huella. Sin la cuenta entera no hay nada que compartir.
 */
export function valorCompartidoDeMercantil(): CredencialesMercantil | null {
  const m = credencialesMercantil()
  if (!m) return null
  return { ambiente: m.ambiente, usuario: m.usuario, clave: m.clave, claveDeSuscripcion: m.claveDeSuscripcion, productor: m.productor }
}

export function adoptarMercantil(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as { ambiente?: unknown; usuario?: unknown; clave?: unknown; claveDeSuscripcion?: unknown; productor?: unknown }
  const texto = (campo: unknown) => (typeof campo === 'string' ? campo : '')
  const m = normalizarMercantil(v.ambiente, texto(v.usuario), texto(v.clave), texto(v.claveDeSuscripcion), texto(v.productor))
  if (!m.usuario || !m.clave || !m.claveDeSuscripcion) return false
  const config = leerConfig()
  config.mercantil = { ...m, actualizadoEn: new Date().toISOString() }
  escribirConfig(config)
  return true
}

// ---------------------------------------------------------------------------
// La Equidad: la cuenta de su API GLM (ver la nota de `ConfigEquidad`).
// ---------------------------------------------------------------------------

export interface CredencialesEquidad {
  ambiente: AmbienteEquidad
  urlBase: string
  usuario: string
  clave: string
  usuarioDeServicio: string
  claveDeServicio: string
  productor: string
  rama: string
  empresa: string
}

function ambienteEquidad(valor: unknown): AmbienteEquidad {
  return typeof valor === 'string' && (AMBIENTES_EQUIDAD as readonly string[]).includes(valor) ? (valor as AmbienteEquidad) : 'produccion'
}

/** La URL base como se guarda: con esquema, sin barras de más y terminada en `/` (la misma regla que `normalizarUrlBase` del cliente). */
function urlBaseEquidad(valor: string): string {
  let url = valor.trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  return `${url.replace(/\/+$/, '')}/`
}

/** Lo que se puede mostrar de la cuenta de Equidad: todo menos las dos contraseñas. */
export function cuentaEquidadVisible(): {
  configurada: boolean
  ambiente: AmbienteEquidad
  urlBase: string
  usuario: string
  usuarioDeServicio: string
  productor: string
  rama: string
  empresa: string
  actualizadoEn: string | null
} {
  const e = leerConfig().equidad
  return {
    configurada: Boolean(e?.urlBase && e.usuario && e.clave),
    ambiente: ambienteEquidad(e?.ambiente),
    urlBase: e?.urlBase ?? '',
    usuario: e?.usuario ?? '',
    usuarioDeServicio: e?.usuarioDeServicio ?? '',
    productor: e?.productor ?? '',
    rama: e?.rama || RAMA_AUTOMOTOR_EQUIDAD_POR_DEFECTO,
    empresa: e?.empresa || EMPRESA_EQUIDAD_POR_DEFECTO,
    actualizadoEn: e?.actualizadoEn ?? null,
  }
}

/** La cuenta completa, sólo para el proceso principal. Null si no está cargada entera. */
export function credencialesEquidad(): CredencialesEquidad | null {
  const e = leerConfig().equidad
  if (!e?.urlBase || !e.usuario || !e.clave) return null
  return {
    ambiente: ambienteEquidad(e.ambiente),
    urlBase: e.urlBase,
    usuario: e.usuario,
    clave: e.clave,
    usuarioDeServicio: e.usuarioDeServicio ?? '',
    claveDeServicio: e.claveDeServicio ?? '',
    productor: e.productor ?? '',
    rama: e.rama || RAMA_AUTOMOTOR_EQUIDAD_POR_DEFECTO,
    empresa: e.empresa || EMPRESA_EQUIDAD_POR_DEFECTO,
  }
}

/** Lo mismo que hacen `guardarEquidad` y `adoptarEquidad`: si no, la huella del ajuste compartido no cerraría nunca. */
function normalizarEquidad(v: Record<string, string>, ambiente: unknown): Omit<ConfigEquidad, 'actualizadoEn'> {
  return {
    ambiente: ambienteEquidad(ambiente),
    urlBase: urlBaseEquidad(v.urlBase ?? ''),
    usuario: (v.usuario ?? '').trim(),
    clave: (v.clave ?? '').trim(),
    usuarioDeServicio: (v.usuarioDeServicio ?? '').trim(),
    claveDeServicio: (v.claveDeServicio ?? '').trim(),
    productor: (v.productor ?? '').replace(/\s/g, ''),
    rama: (v.rama ?? '').replace(/\s/g, '') || RAMA_AUTOMOTOR_EQUIDAD_POR_DEFECTO,
    empresa: (v.empresa ?? '').replace(/\s/g, '') || EMPRESA_EQUIDAD_POR_DEFECTO,
  }
}

export function guardarEquidad(datos: unknown): void {
  const d = objeto(datos, 'Los datos de la cuenta de Equidad')
  const usuario = texto(d.usuario, 'El usuario de la API de Equidad', 1, 60)
  const urlBase = urlBaseEquidad(texto(d.urlBase, 'La URL base de la API de Equidad', 1, 300))
  if (!/^https?:\/\/[^\s/]+\S*\/$/.test(urlBase)) throw new ErrorDeNegocio('La URL base de la API de Equidad no es válida: es una dirección como https://servidor/EQUIDAD/servlet/.')
  const config = leerConfig()
  const mismoUsuario = Boolean(config.equidad?.usuario) && config.equidad?.usuario === usuario
  // Con la contraseña vacía se conserva la que ya estaba: así se cambia el productor sin volver a escribirla.
  const claveEscrita = typeof d.clave === 'string' ? d.clave.trim() : ''
  if (!claveEscrita && config.equidad?.usuario && !mismoUsuario) {
    throw new ErrorDeNegocio('Cambiaste el usuario de la API de Equidad: escribí también su contraseña.')
  }
  const clave = claveEscrita || config.equidad?.clave || ''
  if (!clave) throw new ErrorDeNegocio('Falta la contraseña del usuario de la API de Equidad.')
  const usuarioDeServicio = typeof d.usuarioDeServicio === 'string' ? d.usuarioDeServicio.trim() : ''
  const claveDeServicioEscrita = typeof d.claveDeServicio === 'string' ? d.claveDeServicio.trim() : ''
  const mismoServicio = Boolean(config.equidad?.usuarioDeServicio) && config.equidad?.usuarioDeServicio === usuarioDeServicio
  const claveDeServicio = usuarioDeServicio ? claveDeServicioEscrita || (mismoServicio ? config.equidad?.claveDeServicio ?? '' : '') : ''
  if (usuarioDeServicio && !claveDeServicio) throw new ErrorDeNegocio('Falta la contraseña del usuario de servicio de Equidad (la del Authorization Basic). Si Equidad no dio uno, dejá los dos campos vacíos.')
  const productor = typeof d.productor === 'string' ? d.productor.replace(/\s/g, '') : ''
  if (productor && !/^\d{1,7}$/.test(productor)) throw new ErrorDeNegocio('El código de productor de Equidad es numérico (hasta 7 números). Dejalo vacío para usar el que lista la API.')
  const rama = typeof d.rama === 'string' ? d.rama.replace(/\s/g, '') : ''
  if (rama && !/^\d{1,2}$/.test(rama)) throw new ErrorDeNegocio('El código de rama de Equidad es numérico (hasta 2 números). Dejalo vacío para usar 4 (automotores).')
  const empresa = typeof d.empresa === 'string' ? d.empresa.replace(/\s/g, '') : ''
  if (empresa && !/^\d{1,2}$/.test(empresa)) throw new ErrorDeNegocio('El código de empresa de Equidad es numérico (hasta 2 números). Dejalo vacío para usar 1.')
  if (typeof d.ambiente !== 'string' || !(AMBIENTES_EQUIDAD as readonly string[]).includes(d.ambiente)) {
    throw new ErrorDeNegocio('Elegí el ambiente de Equidad: producción o prueba.')
  }
  escribirConfig({
    ...config,
    equidad: { ...normalizarEquidad({ urlBase, usuario, clave, usuarioDeServicio, claveDeServicio, productor, rama, empresa }, d.ambiente), actualizadoEn: new Date().toISOString() },
  })
}

/** Saca la cuenta de Equidad de esta computadora. */
export function borrarEquidad(): void {
  const config = leerConfig()
  delete config.equidad
  escribirConfig(config)
}

/**
 * Lo que viaja de la cuenta de Equidad: siempre las nueve claves, en este orden y como texto (lo vacío
 * va vacío, no se omite), por la huella. Sin la cuenta entera no hay nada que compartir.
 */
export function valorCompartidoDeEquidad(): CredencialesEquidad | null {
  const e = credencialesEquidad()
  if (!e) return null
  return {
    ambiente: e.ambiente,
    urlBase: e.urlBase,
    usuario: e.usuario,
    clave: e.clave,
    usuarioDeServicio: e.usuarioDeServicio,
    claveDeServicio: e.claveDeServicio,
    productor: e.productor,
    rama: e.rama,
    empresa: e.empresa,
  }
}

export function adoptarEquidad(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as Record<string, unknown>
  const textos: Record<string, string> = {}
  for (const clave of ['urlBase', 'usuario', 'clave', 'usuarioDeServicio', 'claveDeServicio', 'productor', 'rama', 'empresa']) {
    textos[clave] = typeof v[clave] === 'string' ? (v[clave] as string) : ''
  }
  const e = normalizarEquidad(textos, v.ambiente)
  if (!e.urlBase || !e.usuario || !e.clave) return false
  const config = leerConfig()
  config.equidad = { ...e, actualizadoEn: new Date().toISOString() }
  escribirConfig(config)
  return true
}
