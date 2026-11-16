// El cliente base de la API v2 de Río Uruguay Seguros (RUS): consigue el token y hace los GET/POST con
// él. Nada de lo de acá sale de esta carpeta: el resto de la app sólo ve `src/main/servicios/rus.ts` y el
// adaptador del multicotizador.
//
// Cómo es su API (ver la documentación de Postman «API-RUS V2 #APIPASSubscriber» que mandó RUS):
// - Dos entornos con la misma forma: sandbox (`api.rus.com.ar/sandbox`) y producción (`api.rus.com.ar/v2`).
//   Sólo HTTPS; un pedido por HTTP es 403.
// - TODO pedido lleva la API-Key que da el equipo de integraciones de RUS en el encabezado `x-api-key`.
// - El token sale de `POST login/token` con un JSON `{ username, password }` (el usuario y la contraseña
//   del PAS) y viaja después como `Authorization: Bearer …`. Dura una hora (`expires_in: 3599`); vencido,
//   los servicios contestan 403 `User is not authorized to access this resource with an explicit deny`.
// - Los errores vienen como `{ errors: [{ message, code, description }], status }` (validación y
//   negocio), `{ message: "Forbidden" }` (gateway) o, en el catálogo de vehículos, con 200 y
//   `{ errores: { listError: [{ atributo, descripcion }] } }`.
// - Como máximo 5 pedidos a la vez y 20 por segundo.
import { createHash } from 'node:crypto'
import type { AmbienteRus } from '../../../shared/tipos'
import { esDemo } from '../../canal'
import { esFallaDeRed } from '../../servicios/red'

export const URL_BASE_RUS: Record<AmbienteRus, string> = {
  produccion: 'https://api.rus.com.ar/v2',
  sandbox: 'https://api.rus.com.ar/sandbox',
}

export const RUTA_TOKEN = 'login/token'
export const ENCABEZADO_API_KEY = 'x-api-key'

/** Una cotización puede tardar; el resto es rápido. */
const ESPERA_MS = 60_000
/** Si el token no dice cuánto dura, se pide otro a los cinco minutos. */
const DURACION_POR_DEFECTO_S = 5 * 60
/** Se renueva un rato antes de que venza, así un pedido largo no lo encuentra vencido a mitad de camino. */
const MARGEN_S = 60

export class ErrorDeRus extends Error {
  constructor(
    mensaje: string,
    /** true si fue «no hay internet» y no «RUS dijo que no». */
    readonly esDeRed: boolean,
    /** El status HTTP con que contestó RUS, si llegó a contestar. */
    readonly status?: number,
  ) {
    super(mensaje)
    this.name = 'ErrorDeRus'
  }
}

export interface CuentaRus {
  ambiente: AmbienteRus
  usuario: string
  clave: string
  apiKey: string
}

export interface TokenDeRus {
  token: string
  /** Hasta cuándo vale (epoch ms), ya con el margen descontado. */
  venceEn: number
  /** Hasta cuándo dijo RUS que vale (epoch ms), o null si no lo dijo. */
  venceSegunRus: number | null
}

/** Cuando RUS no contesta lo esperado, un pedazo de lo que contestó, sin etiquetas, para el mensaje. */
export function resumenDelCuerpo(texto: string): string {
  const limpio = texto
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return limpio.length > 300 ? `${limpio.slice(0, 300)}…` : limpio
}

/** `JSON.parse` sin tirar: una página de error del gateway no es JSON. */
export function parseJsonSeguro(texto: string): unknown {
  if (!texto.trim()) return undefined
  try {
    return JSON.parse(texto) as unknown
  } catch {
    return undefined
  }
}

export function textoSuelto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : ''
}

/**
 * Los errores de RUS, en una lista de textos, vengan como vengan: `errors: [{ description, message }]`,
 * `errores: { listError: [{ atributo, descripcion }] }` o un `exceptionResponse` con su mensaje.
 */
export function erroresDeRus(datos: unknown): string[] {
  if (!datos || typeof datos !== 'object') return []
  const d = datos as Record<string, unknown>
  const textos: string[] = []
  const deUno = (e: unknown) => {
    if (typeof e === 'string') {
      if (e.trim()) textos.push(e.trim())
      return
    }
    if (!e || typeof e !== 'object') return
    const error = e as Record<string, unknown>
    const descripcion = textoSuelto(error.description) || textoSuelto(error.descripcion) || textoSuelto(error.mensaje)
    const mensaje = textoSuelto(error.message)
    const atributo = textoSuelto(error.atributo)
    // La descripción es la que se entiende («Fecha de inicio de vigencia no valida»); el `message` suele
    // ser una clave interna («WebService.cotizacion.fechaInicioNoValida») o la ruta del campo.
    const texto = descripcion || mensaje
    if (texto) textos.push(atributo && !texto.toLowerCase().includes(atributo.toLowerCase()) ? `${atributo}: ${texto}` : texto)
  }
  if (Array.isArray(d.errors)) d.errors.forEach(deUno)
  const errores = d.errores
  if (Array.isArray(errores)) errores.forEach(deUno)
  else if (errores && typeof errores === 'object') {
    const lista = (errores as Record<string, unknown>).listError
    if (Array.isArray(lista)) lista.forEach(deUno)
  }
  return textos
}

/** Lo que decirle a la persona según cómo contestó RUS. */
export function mensajeDeError(status: number, texto: string, que: string): string {
  const datos = parseJsonSeguro(texto)
  const d = datos && typeof datos === 'object' ? (datos as Record<string, unknown>) : {}
  const errores = erroresDeRus(datos)
  if (errores.length > 0) return `RUS respondió ${status} a ${que}: ${errores.join(' · ')}`
  const delGateway = textoSuelto(d.message) || textoSuelto(d.Message)
  if (status === 403 && /explicit deny|not authorized/i.test(delGateway)) {
    return `RUS no autorizó ${que} (403): el token venció o el usuario no tiene permiso para ese servicio.`
  }
  if (status === 403 && /^forbidden$/i.test(delGateway)) {
    return `RUS rechazó ${que} (403 Forbidden): revisá la API-Key (que sea la de ese ambiente) y que el usuario esté habilitado para la API.`
  }
  if (status === 404) return `RUS no tiene la ruta ${que} (404): cambió su API o el ambiente no es el de la API-Key.`
  const descripcion = delGateway || textoSuelto(d.error_description) || textoSuelto(d.error) || resumenDelCuerpo(texto)
  return `RUS respondió ${status} a ${que}${descripcion ? `: ${descripcion}` : '.'}`
}

/** El token de la respuesta de `login/token` (la forma de siempre de OAuth: `access_token`, `expires_in`). */
export function leerToken(respuesta: unknown, ahora = Date.now()): TokenDeRus {
  const r = respuesta && typeof respuesta === 'object' ? (respuesta as Record<string, unknown>) : {}
  const token = textoSuelto(r.access_token) || textoSuelto(r.accessToken) || textoSuelto(r.token)
  if (!token) throw new ErrorDeRus('RUS contestó al pedido del token sin un token adentro.', false)
  const segundos = Number(r.expires_in ?? r.expiresIn)
  const dura = Number.isFinite(segundos) && segundos > 0 ? segundos : null
  return {
    token,
    venceEn: ahora + Math.max(dura ?? DURACION_POR_DEFECTO_S, MARGEN_S * 2) * 1000 - MARGEN_S * 1000,
    venceSegunRus: dura ? ahora + dura * 1000 : null,
  }
}

/** Lo que contestó RUS a un pedido, entero: la cotización necesita leer también los 400 con sus motivos. */
export interface RespuestaDeRus {
  status: number
  datos: unknown
  texto: string
}

export interface ClienteRus {
  readonly cuenta: CuentaRus
  /** El token vigente, pidiendo uno nuevo si no hay o venció. */
  token(): Promise<TokenDeRus>
  /** GET a `/<ruta>` con esos parámetros; devuelve el JSON (o tira con el motivo). */
  get<T>(ruta: string, parametros?: Record<string, string>): Promise<T>
  /** POST con JSON a `/<ruta>`; devuelve lo que contestó RUS, aunque sea un 400. Tira sólo si no hay token o red. */
  enviar(ruta: string, cuerpo: unknown, que: string): Promise<RespuestaDeRus>
}

export interface OpcionesDeCliente {
  /** Para las pruebas: otro servidor en vez del de RUS. */
  urlBase?: string
}

// Los tokens, en memoria, por cuenta: un token sirve para todos los pedidos de la misma cuenta hasta
// que vence. La clave del mapa es un hash: ni la contraseña ni la API-Key quedan en claro en una
// estructura que se pueda volcar.
const tokens = new Map<string, Promise<TokenDeRus>>()

function claveDeCuenta(cuenta: CuentaRus, urlBase: string): string {
  return createHash('sha256').update([urlBase, cuenta.usuario, cuenta.clave, cuenta.apiKey].join('\n')).digest('hex')
}

/** Al cambiar la cuenta, y en las pruebas: que ningún token de la cuenta anterior siga valiendo. */
export function olvidarTokensDeRus(): void {
  tokens.clear()
}

/** true si la respuesta dice que el token no sirve (venció o no lo aceptó): vale pedir otro y reintentar. */
function esTokenRechazado(status: number, texto: string): boolean {
  if (status === 401) return true
  return status === 403 && /explicit deny|not authorized|unauthorized|expired|token/i.test(texto)
}

export function crearClienteRus(cuenta: CuentaRus, opciones: OpcionesDeCliente = {}): ClienteRus {
  const base = (opciones.urlBase ?? URL_BASE_RUS[cuenta.ambiente]).replace(/\/+$/, '')
  const clave = claveDeCuenta(cuenta, base)

  async function pedir(url: string, init: RequestInit, que: string): Promise<{ status: number; texto: string }> {
    // Demo: nunca sale a RUS. La demo contesta antes (ver demo/); esto es por si algo se escapa.
    if (esDemo()) throw new ErrorDeRus('La versión de demostración no se conecta con Río Uruguay Seguros.', false)
    let respuesta: Response
    try {
      respuesta = await fetch(url, { ...init, signal: AbortSignal.timeout(ESPERA_MS) })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ErrorDeRus(`RUS no contestó ${que} en ${ESPERA_MS / 1000} segundos.`, true)
      }
      if (esFallaDeRed(error)) throw new ErrorDeRus('No se pudo conectar con Río Uruguay Seguros. Fijate si hay internet.', true)
      throw new ErrorDeRus(error instanceof Error ? error.message : String(error), false)
    }
    return { status: respuesta.status, texto: await respuesta.text() }
  }

  async function pedirToken(): Promise<TokenDeRus> {
    const { status, texto } = await pedir(
      `${base}/${RUTA_TOKEN}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', [ENCABEZADO_API_KEY]: cuenta.apiKey },
        body: JSON.stringify({ password: cuenta.clave, username: cuenta.usuario }),
      },
      'el pedido del token',
    )
    const datos = parseJsonSeguro(texto)
    if (status < 200 || status >= 300 || datos === undefined) {
      const d = datos && typeof datos === 'object' ? (datos as Record<string, unknown>) : {}
      const delGateway = textoSuelto(d.message) || textoSuelto(d.Message)
      // Un 403 «Forbidden» del gateway al pedir el token es la API-Key; un 400/401 con `error` de OAuth
      // (`invalid_grant`) es el usuario o la contraseña.
      if (status === 403 && /^forbidden$/i.test(delGateway)) {
        throw new ErrorDeRus('RUS rechazó el pedido del token (403 Forbidden): revisá la API-Key, que sea la de ese ambiente (sandbox o producción).', false, status)
      }
      if (status === 400 || status === 401 || (typeof d.error === 'string' && d.error)) {
        const detalle = textoSuelto(d.error_description) || textoSuelto(d.error) || erroresDeRus(datos).join(' · ') || delGateway
        throw new ErrorDeRus(`RUS no aceptó el usuario o la contraseña${detalle ? ` (${detalle})` : ''}. Revisá los dos y que el ambiente sea el de la cuenta.`, false, status)
      }
      throw new ErrorDeRus(mensajeDeError(status, texto, 'el pedido del token'), false, status)
    }
    return leerToken(datos)
  }

  async function token(): Promise<TokenDeRus> {
    const guardado = tokens.get(clave)
    if (guardado) {
      const vigente = await guardado.catch(() => null)
      if (vigente && vigente.venceEn > Date.now()) return vigente
    }
    const nuevo = pedirToken()
    tokens.set(clave, nuevo)
    nuevo.catch(() => {
      if (tokens.get(clave) === nuevo) tokens.delete(clave)
    })
    return nuevo
  }

  function encabezados(t: string, extra: Record<string, string> = {}): Record<string, string> {
    return { accept: 'application/json', authorization: `Bearer ${t}`, [ENCABEZADO_API_KEY]: cuenta.apiKey, ...extra }
  }

  /** Un pedido con token. Si RUS dice que el token no sirve (venció antes de lo esperado), se pide otro y se reintenta una vez. */
  async function conToken(ruta: string, armar: (t: string) => RequestInit, que: string): Promise<{ status: number; texto: string }> {
    const primero = await token()
    const url = `${base}/${ruta}`
    let respuesta = await pedir(url, armar(primero.token), que)
    if (esTokenRechazado(respuesta.status, respuesta.texto)) {
      tokens.delete(clave)
      const segundo = await token()
      respuesta = await pedir(url, armar(segundo.token), que)
    }
    return respuesta
  }

  return {
    cuenta,
    token,
    async get<T>(ruta: string, parametros: Record<string, string> = {}): Promise<T> {
      const consulta = new URLSearchParams(parametros).toString()
      const rutaCompleta = consulta ? `${ruta}?${consulta}` : ruta
      const { status, texto } = await conToken(rutaCompleta, (t) => ({ headers: encabezados(t) }), ruta)
      const datos = parseJsonSeguro(texto)
      if (status < 200 || status >= 300 || datos === undefined) throw new ErrorDeRus(mensajeDeError(status, texto, ruta), false, status)
      return datos as T
    },
    async enviar(ruta, cuerpo, que) {
      const { status, texto } = await conToken(
        ruta,
        (t) => ({ method: 'POST', headers: encabezados(t, { 'content-type': 'application/json' }), body: JSON.stringify(cuerpo) }),
        que,
      )
      // Un rechazo de la cuenta (la API-Key, el usuario) no es un «no cotizó»: tira, y el servicio lo muestra.
      if (status === 401 || status === 403) throw new ErrorDeRus(mensajeDeError(status, texto, que), false, status)
      return { status, datos: parseJsonSeguro(texto), texto }
    },
  }
}
