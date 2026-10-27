// El cliente base de la API GLM de La Equidad: se autentica y hace los GET/POST con el token. Nada de
// lo de acá sale de esta carpeta: el resto de la app sólo ve `src/main/servicios/equidad.ts` y el
// adaptador del multicotizador.
//
// Cómo es su API (ver docs/APIGLM V.1.11, «APIGLM - Emisión Automotor» y un .docx por servicio):
// - Es una API GeneXus: cada servicio es un servlet con nombre de clase Java
//   (`ar.com.glmsa.seguros.comercial.apiglm.<area>.aws<servicio>`) colgado de una URL base que la
//   compañía da por ambiente (`http://…/ATM_COM_PRUE/servlet/` en los ejemplos de la documentación).
// - Los GET llevan query params EN EL ORDEN de la documentación, y los opcionales van igual, vacíos.
//   Los POST llevan JSON. Las fechas de los query params van AAAAMMDD; las del JSON, aaaa-mm-dd.
// - La seguridad: `Authorization: Basic usuario:contraseña` (el «usuario de servicio» que da la
//   compañía) en los servicios que lo pidan, y `AutenticarUsuario` (POST {Usuario, Password}, el
//   «usuario de aplicación») devuelve `UsuCod` —el código de usuario que piden todas las listas— y un
//   token Bearer «válido para el usuario de aplicación y el de servicio en el resto de servicios».
//   Acá se manda el Bearer una vez autenticado y, si un servicio lo rechaza con 401, se reintenta con
//   el Basic: la documentación no dice cuál de los dos espera cada servicio.
// - Los errores HTTP vienen como `{status, Description, Detail, JsonResult}`; el de autenticación como
//   `{Codigo, Mensaje}`. Códigos: 400 faltan parámetros, 401 falló la autenticación, 500 error
//   interno, 501 no implementado, 503 no disponible.
import { createHash } from 'node:crypto'
import { esDemo } from '../../canal'
import { esFallaDeRed } from '../../servicios/red'

/** El prefijo de clase de todos los servicios. */
export const PAQUETE_GLM = 'ar.com.glmsa.seguros.comercial.apiglm'

/** Los servicios que se usan, con su nombre de clase (la columna «Endpoint» de cada .docx). */
export const SERVICIOS_EQUIDAD = {
  autenticarUsuario: `${PAQUETE_GLM}.seguridad.awsautenticarusuario`,
  listarTipoDePoliza: `${PAQUETE_GLM}.cotizacion.awslistartipodepoliza`,
  listarProductoresDeUsuario: `${PAQUETE_GLM}.comun.awslistarproductoresdeusuario`,
  listarCategoriaIVA: `${PAQUETE_GLM}.comun.awslistarcategoriaiva`,
  listarCategoriaIB: `${PAQUETE_GLM}.comun.awslistarcategoriaib`,
  listarPlanComercial: `${PAQUETE_GLM}.cotizacion.awslistarplancomercial`,
  listarMoneda: `${PAQUETE_GLM}.comun.awslistarmoneda`,
  listarModoDeFacturacion: `${PAQUETE_GLM}.cotizacion.awslistarmododefacturacion`,
  listarFormaDePago: `${PAQUETE_GLM}.cotizacion.awslistarformadepago`,
  listarCondicionDePago: `${PAQUETE_GLM}.cotizacion.awslistarcondiciondepago`,
  buscarCodigoPostal: `${PAQUETE_GLM}.comun.awsbuscarcodigopostal`,
  listarProvincia: `${PAQUETE_GLM}.comun.awslistarprovincia`,
  listarMarcaDeVehiculo: `${PAQUETE_GLM}.emision.automotores.awslistarmarcadevehiculo`,
  buscarVehiculos: `${PAQUETE_GLM}.emision.automotores.awsbuscarvehiculos`,
  obtenerVehiculoPorPatente: `${PAQUETE_GLM}.emision.automotores.awsobtenervehiculoporpatente`,
  listarVariantesDeVehiculo: `${PAQUETE_GLM}.emision.automotores.awslistarvariantesdevehiculo`,
  obtenerSumaAseguradaDeVehiculo: `${PAQUETE_GLM}.emision.automotores.awsobtenersumaaseguradadevehiculo`,
  listarClausulaDeAjuste: `${PAQUETE_GLM}.emision.automotores.awslistarclausuladeajuste`,
  listarAlarmaSatelital: `${PAQUETE_GLM}.emision.automotores.awslistaralarmasatelital`,
  listarAccesoriosDeVehiculo: `${PAQUETE_GLM}.emision.automotores.awslistaraccesoriosdevehiculo`,
  cotizarAutomotor: `${PAQUETE_GLM}.emision.automotores.awscotizarautomotor`,
  cotizarConNuevosPorcentajes: `${PAQUETE_GLM}.emision.automotores.awscotizarconnuevosporcentajes`,
  obtenerCotizacion: `${PAQUETE_GLM}.cotizacion.awsobtenercotizacion`,
  imprimirCotizacion: `${PAQUETE_GLM}.cotizacion.awsimprimircotizacion`,
  listarCotizaciones: `${PAQUETE_GLM}.cotizacion.awslistarcotizaciones`,
} as const

export type ServicioEquidad = keyof typeof SERVICIOS_EQUIDAD

/** Una cotización puede tardar; el resto es rápido. */
const ESPERA_MS = 60_000
/** Si la respuesta de autenticación no trae `Expiracion`, se vuelve a autenticar a los 20 minutos. */
const DURACION_POR_DEFECTO_S = 20 * 60
/** Se renueva un rato antes de que venza, así un pedido largo no lo encuentra vencido a mitad de camino. */
const MARGEN_S = 30

export class ErrorDeEquidad extends Error {
  constructor(
    mensaje: string,
    /** true si fue «no hay internet» y no «Equidad dijo que no». */
    readonly esDeRed: boolean,
    /** El status HTTP con que contestó Equidad, si llegó a contestar. */
    readonly status?: number,
    /** El `Codigo` del error de autenticación, si vino. */
    readonly codigo?: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeEquidad'
  }
}

export interface CuentaEquidad {
  urlBase: string
  usuario: string
  clave: string
  usuarioDeServicio: string
  claveDeServicio: string
}

export interface SesionDeEquidad {
  /** El código de usuario de aplicación (`UsuCod`), el que piden todas las listas. */
  usuarioCodigo: string
  usuarioNombre: string
  usuarioDeServicio: string
  /** El token Bearer; vacío si la API no lo dio. */
  token: string
  /** Hasta cuándo vale (epoch ms), ya con el margen descontado. */
  venceEn: number
  /** Hasta cuándo dijo Equidad que vale (epoch ms), o null si no lo dijo. */
  venceSegunEquidad: number | null
}

/** Cuando Equidad no contesta lo esperado, un pedazo de lo que contestó, sin etiquetas, para el mensaje. */
export function resumenDelCuerpo(texto: string): string {
  const limpio = texto
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return limpio.length > 300 ? `${limpio.slice(0, 300)}…` : limpio
}

/** `JSON.parse` sin tirar: una página de error del servidor de aplicaciones no es JSON. */
export function parseJsonSeguro(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown
  } catch {
    return undefined
  }
}

function textoSuelto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : ''
}

/** El primer valor no vacío de esas claves, probadas en orden y sin importar mayúsculas. */
export function campo(objeto: Record<string, unknown>, claves: string[]): string {
  const entradas = Object.entries(objeto)
  for (const clave of claves) {
    const buscada = clave.toLowerCase()
    const entrada = entradas.find(([nombre]) => nombre.toLowerCase() === buscada)
    if (!entrada) continue
    const valor = textoSuelto(entrada[1])
    if (valor) return valor
  }
  return ''
}

/** La URL base tal como se guarda: con `https://` si no lo trae, sin barras de más y terminada en `/`. */
export function normalizarUrlBase(valor: string): string {
  let url = valor.replace(/[\s\u200B-\u200D\uFEFF]/g, '')
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  // Si pegan la dirección de un servicio (p. ej. `…/servlet/ar.com…hlogin`), la base es lo que llega hasta `/servlet/`.
  const corte = url.search(/\/servlet\//i)
  if (corte >= 0) url = url.slice(0, corte + '/servlet'.length)
  return `${url.replace(/\/+$/, '')}/`
}

/** La URL de un servicio: la base más el nombre de clase (los ejemplos de la documentación: `…/servlet/ar.com.glmsa…`). */
export function urlDeServicio(urlBase: string, servicio: ServicioEquidad): string {
  return `${normalizarUrlBase(urlBase)}${SERVICIOS_EQUIDAD[servicio]}`
}

/**
 * Los query params como los pide la API: en el orden en que se pasan, y los vacíos también (la
 * documentación dice que los opcionales «deben enviarse igual, pero vacíos»).
 */
export function consultaOrdenada(parametros: Array<[string, string | number | boolean]>): string {
  return parametros.map(([clave, valor]) => `${encodeURIComponent(clave)}=${encodeURIComponent(String(valor))}`).join('&')
}

/** Una fecha aaaa-mm-dd como la piden los query params: AAAAMMDD. */
export function fechaCompacta(iso: string): string {
  return iso.replace(/-/g, '').slice(0, 8)
}

/**
 * Lo que decirle a la persona según cómo contestó Equidad. Los errores de la API vienen como
 * `{status, Description, Detail}` (el JSON Error de la documentación) o `{Codigo, Mensaje}` (el de
 * autenticación); una página HTML es el servidor de aplicaciones, no la API.
 */
export function mensajeDeError(status: number, texto: string, que: string): { mensaje: string; codigo?: string } {
  const datos = parseJsonSeguro(texto)
  const d = datos && typeof datos === 'object' && !Array.isArray(datos) ? (datos as Record<string, unknown>) : {}
  const codigo = campo(d, ['Codigo', 'code'])
  const descripcion = [campo(d, ['Mensaje', 'Description', 'message', 'descripcion']), campo(d, ['Detail', 'detalle', 'detail'])].filter(Boolean).join(': ')
  const detalle = descripcion || resumenDelCuerpo(texto)
  if (status === 401) {
    return {
      mensaje: `Equidad no aceptó las credenciales en ${que} (401)${detalle ? `: ${detalle}` : ''}. Revisá el usuario y la contraseña de la API y, si Equidad los dio, los del usuario de servicio.`,
      ...(codigo ? { codigo } : {}),
    }
  }
  if (status === 404) return { mensaje: `Equidad no tiene el servicio ${que} (404): revisá la URL base de la API (tiene que terminar en /servlet/).` }
  if (status === 400) return { mensaje: `Equidad dice que a ${que} le faltan parámetros (400)${detalle ? `: ${detalle}` : ''}.` }
  if (status === 501) return { mensaje: `Equidad no tiene implementado ${que} (501).` }
  if (status === 503) return { mensaje: `La API de Equidad no está disponible ahora (503, ${que}). Probá en un rato.` }
  return { mensaje: `Equidad respondió ${status} a ${que}${detalle ? `: ${detalle}` : '.'}`, ...(codigo ? { codigo } : {}) }
}

/** «2026-10-19T10:30:00», «2026-10-19 10:30:00», «19/10/2026 10:30» → epoch ms, o null si no se entiende. */
export function fechaDeEquidad(valor: unknown): number | null {
  const texto = textoSuelto(valor)
  if (!texto) return null
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(texto)
  if (dmy) {
    const fecha = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), Number(dmy[4] ?? 0), Number(dmy[5] ?? 0), Number(dmy[6] ?? 0))
    return Number.isNaN(fecha.getTime()) ? null : fecha.getTime()
  }
  const fecha = new Date(texto.replace(' ', 'T'))
  return Number.isNaN(fecha.getTime()) ? null : fecha.getTime()
}

/** La sesión a partir de la respuesta de `AutenticarUsuario` ({UsuCod, UsuNom, UsuarioDeServicio, Token, Expiracion}). */
export function leerSesion(respuesta: unknown, usuarioConfigurado: string, ahora = Date.now()): SesionDeEquidad {
  const r = respuesta && typeof respuesta === 'object' && !Array.isArray(respuesta) ? (respuesta as Record<string, unknown>) : {}
  const usuarioCodigo = campo(r, ['UsuCod', 'Usuario', 'usuarioCodigo']) || usuarioConfigurado
  const token = campo(r, ['Token', 'access_token'])
  const venceSegunEquidad = fechaDeEquidad(r.Expiracion ?? r.expiracion ?? r.expires)
  const dura = venceSegunEquidad && venceSegunEquidad > ahora ? (venceSegunEquidad - ahora) / 1000 : null
  return {
    usuarioCodigo,
    usuarioNombre: campo(r, ['UsuNom', 'Nombre']),
    usuarioDeServicio: campo(r, ['UsuarioDeServicio']),
    token,
    venceEn: ahora + Math.max(dura ?? DURACION_POR_DEFECTO_S, MARGEN_S * 2) * 1000 - MARGEN_S * 1000,
    venceSegunEquidad,
  }
}

export interface ClienteEquidad {
  readonly cuenta: CuentaEquidad
  /** La sesión vigente (código de usuario y token), autenticando si no hay o venció. */
  sesion(): Promise<SesionDeEquidad>
  /** GET al servicio con esos parámetros, en ese orden; devuelve el JSON. */
  get<T>(servicio: ServicioEquidad, parametros: Array<[string, string | number | boolean]>): Promise<T>
  /** POST con JSON al servicio; devuelve el JSON. */
  post<T>(servicio: ServicioEquidad, cuerpo: unknown): Promise<T>
}

// Las sesiones, en memoria, por cuenta: una sesión sirve para todos los pedidos de la misma cuenta
// hasta que vence. La clave del mapa es un hash: ninguna contraseña queda en claro en una estructura
// que se pueda volcar.
const sesiones = new Map<string, Promise<SesionDeEquidad>>()

function claveDeCuenta(cuenta: CuentaEquidad): string {
  return createHash('sha256')
    .update([normalizarUrlBase(cuenta.urlBase), cuenta.usuario, cuenta.clave, cuenta.usuarioDeServicio, cuenta.claveDeServicio].join('\n'))
    .digest('hex')
}

/** Al cambiar la cuenta, y en las pruebas: que ninguna sesión de la cuenta anterior siga valiendo. */
export function olvidarSesionesDeEquidad(): void {
  sesiones.clear()
}

function basic(usuario: string, clave: string): string {
  return `Basic ${Buffer.from(`${usuario}:${clave}`, 'utf8').toString('base64')}`
}

const QUE: Partial<Record<ServicioEquidad, string>> = {
  autenticarUsuario: 'la autenticación',
  cotizarAutomotor: 'la cotización',
  cotizarConNuevosPorcentajes: 'el recálculo con otros porcentajes',
}

export function crearClienteEquidad(cuenta: CuentaEquidad): ClienteEquidad {
  const clave = claveDeCuenta(cuenta)
  const tieneServicio = Boolean(cuenta.usuarioDeServicio)

  async function pedir(url: string, init: RequestInit, que: string): Promise<{ status: number; texto: string }> {
    // Demo: nunca sale a Equidad. La demo contesta antes (ver demo/); esto es por si algo se escapa.
    if (esDemo()) throw new ErrorDeEquidad('La versión de demostración no se conecta con La Equidad.', false)
    let respuesta: Response
    try {
      respuesta = await fetch(url, { ...init, signal: AbortSignal.timeout(ESPERA_MS) })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ErrorDeEquidad(`Equidad no contestó ${que} en ${ESPERA_MS / 1000} segundos.`, true)
      }
      if (esFallaDeRed(error)) throw new ErrorDeEquidad('No se pudo conectar con la API de Equidad. Fijate si hay internet y que la URL base sea la que dio Equidad.', true)
      throw new ErrorDeEquidad(error instanceof Error ? error.message : String(error), false)
    }
    return { status: respuesta.status, texto: await respuesta.text() }
  }

  async function autenticar(): Promise<SesionDeEquidad> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
    if (tieneServicio) headers.authorization = basic(cuenta.usuarioDeServicio, cuenta.claveDeServicio)
    const { status, texto } = await pedir(
      urlDeServicio(cuenta.urlBase, 'autenticarUsuario'),
      { method: 'POST', headers, body: JSON.stringify({ Usuario: cuenta.usuario, Password: cuenta.clave }) },
      QUE.autenticarUsuario!,
    )
    const datos = parseJsonSeguro(texto)
    if (status < 200 || status >= 300 || datos === undefined) {
      const { mensaje, codigo } = mensajeDeError(status, texto, QUE.autenticarUsuario!)
      throw new ErrorDeEquidad(mensaje, false, status, codigo)
    }
    // Un 200 con {Codigo, Mensaje} y sin UsuCod es el «Json ERROR» de AutenticarUsuario.
    const d = datos && typeof datos === 'object' && !Array.isArray(datos) ? (datos as Record<string, unknown>) : {}
    if (!campo(d, ['UsuCod', 'Token']) && campo(d, ['Mensaje', 'Codigo'])) {
      const mensaje = campo(d, ['Mensaje']) || 'sin detalle'
      throw new ErrorDeEquidad(`Equidad no aceptó el usuario de la API: ${mensaje}. Revisá el usuario y la contraseña de aplicación.`, false, status, campo(d, ['Codigo']) || undefined)
    }
    return leerSesion(datos, cuenta.usuario)
  }

  async function sesion(): Promise<SesionDeEquidad> {
    const guardada = sesiones.get(clave)
    if (guardada) {
      const vigente = await guardada.catch(() => null)
      if (vigente && vigente.venceEn > Date.now()) return vigente
    }
    const nueva = autenticar()
    sesiones.set(clave, nueva)
    nueva.catch(() => {
      if (sesiones.get(clave) === nueva) sesiones.delete(clave)
    })
    return nueva
  }

  function leerJson<T>(que: string, status: number, texto: string): T {
    const datos = parseJsonSeguro(texto)
    if (status < 200 || status >= 300 || datos === undefined) {
      const { mensaje, codigo } = mensajeDeError(status, texto, que)
      throw new ErrorDeEquidad(mensaje, false, status, codigo)
    }
    return datos as T
  }

  /**
   * Un pedido autenticado. Primero con el Bearer de la sesión; si Equidad contesta 401 se autentica
   * de nuevo y reintenta una vez, y si sigue en 401 y hay usuario de servicio, prueba con el Basic
   * (la documentación no dice cuál de los dos espera cada servicio).
   */
  async function autenticado<T>(servicio: ServicioEquidad, consulta: string, armar: (authorization: string | null) => RequestInit): Promise<T> {
    const que = QUE[servicio] ?? SERVICIOS_EQUIDAD[servicio].split('.').pop()!
    const url = `${urlDeServicio(cuenta.urlBase, servicio)}${consulta ? `?${consulta}` : ''}`
    const conBearer = (s: SesionDeEquidad) => (s.token ? `Bearer ${s.token}` : tieneServicio ? basic(cuenta.usuarioDeServicio, cuenta.claveDeServicio) : null)
    const primera = await sesion()
    let respuesta = await pedir(url, armar(conBearer(primera)), que)
    if (respuesta.status === 401) {
      sesiones.delete(clave)
      const segunda = await sesion()
      respuesta = await pedir(url, armar(conBearer(segunda)), que)
      if (respuesta.status === 401 && tieneServicio && segunda.token) {
        respuesta = await pedir(url, armar(basic(cuenta.usuarioDeServicio, cuenta.claveDeServicio)), que)
      }
    }
    return leerJson<T>(que, respuesta.status, respuesta.texto)
  }

  function encabezados(authorization: string | null, extra: Record<string, string> = {}): Record<string, string> {
    return { accept: 'application/json', ...(authorization ? { authorization } : {}), ...extra }
  }

  return {
    cuenta,
    sesion,
    async get(servicio, parametros) {
      return autenticado(servicio, consultaOrdenada(parametros), (authorization) => ({ headers: encabezados(authorization) }))
    },
    async post(servicio, cuerpo) {
      return autenticado(servicio, '', (authorization) => ({
        method: 'POST',
        headers: encabezados(authorization, { 'content-type': 'application/json' }),
        body: JSON.stringify(cuerpo),
      }))
    },
  }
}
