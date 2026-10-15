// El cliente base de la API de Mercantil Andina: consigue el token y hace los GET/POST con él. Nada de
// lo de acá sale de esta carpeta: el resto de la app sólo ve `src/main/servicios/mercantil.ts` y el
// adaptador del multicotizador.
//
// Cómo es su API (ver docs/«Guía para la Conexión a las APIs de Mercantil Andina» y lo probado contra
// el gateway, 15/10/2026):
// - Es un Azure API Management: TODO pedido lleva la «subscription key» del portal en el encabezado
//   `Ocp-Apim-Subscription-Key`; sin ella contesta 401 `Access denied due to missing subscription key`,
//   con una que no es, 401 `… invalid subscription key`. Una ruta que no existe es 404 `Resource not found`.
// - El token sale de POST `credenciales/v2/` con un formulario (`client_id=api-clientes-login`,
//   `username`, `password`, `grant_type=password`), y después viaja como `Authorization: Bearer …`.
// - Los errores del negocio vienen como `{"errores":[{"id":"SEG001","texto":"Credenciales no válidas"}]}`.
// - Dos ambientes con la misma forma: producción (api.mercantilandina.com.ar) y desarrollo
//   (apidev.mercantilandina.com.ar), al que van las credenciales de test.
import { createHash } from 'node:crypto'
import type { AmbienteMercantil } from '../../../shared/tipos'
import { esFallaDeRed } from '../../servicios/red'

export const URL_BASE_MERCANTIL: Record<AmbienteMercantil, string> = {
  produccion: 'https://api.mercantilandina.com.ar',
  desarrollo: 'https://apidev.mercantilandina.com.ar',
}

/** La ruta del servicio de credenciales (con la barra final, como la da la guía). */
export const RUTA_TOKEN = 'credenciales/v2/'
export const CLIENT_ID = 'api-clientes-login'
export const ENCABEZADO_SUSCRIPCION = 'Ocp-Apim-Subscription-Key'

/** Una cotización puede tardar; el resto es rápido. */
const ESPERA_MS = 60_000
/** Si el token no dice cuánto dura, se pide otro a los cinco minutos. */
const DURACION_POR_DEFECTO_S = 5 * 60
/** Se renueva un rato antes de que venza, así un pedido largo no lo encuentra vencido a mitad de camino. */
const MARGEN_S = 30

export class ErrorDeMercantil extends Error {
  constructor(
    mensaje: string,
    /** true si fue «no hay internet» y no «Mercantil dijo que no». */
    readonly esDeRed: boolean,
    /** El status HTTP con que contestó Mercantil, si llegó a contestar. */
    readonly status?: number,
    /** El `id` del primer error de negocio (SEG001…), si vino. */
    readonly codigo?: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeMercantil'
  }
}

export interface CuentaMercantil {
  ambiente: AmbienteMercantil
  usuario: string
  clave: string
  claveDeSuscripcion: string
}

export interface TokenDeMercantil {
  token: string
  /** Hasta cuándo vale (epoch ms), ya con el margen descontado. */
  venceEn: number
  /** Hasta cuándo dijo Mercantil que vale (epoch ms), o null si no lo dijo. */
  venceSegunMercantil: number | null
}

/** Cuando Mercantil no contesta lo esperado, un pedazo de lo que contestó, sin etiquetas, para el mensaje. */
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
  try {
    return JSON.parse(texto) as unknown
  } catch {
    return undefined
  }
}

function textoSuelto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : typeof valor === 'number' ? String(valor) : ''
}

/** Los errores de negocio de Mercantil (`errores: [{id, texto}]`), en una línea; vacío si no vienen así. */
export function erroresDeNegocio(datos: unknown): { texto: string; codigo?: string } {
  if (!datos || typeof datos !== 'object') return { texto: '' }
  const lista = (datos as { errores?: unknown }).errores
  if (!Array.isArray(lista)) return { texto: '' }
  const errores = lista.flatMap((e) => {
    if (typeof e === 'string') return [{ id: '', texto: e.trim() }]
    if (!e || typeof e !== 'object') return []
    const error = e as Record<string, unknown>
    const texto = textoSuelto(error.texto) || textoSuelto(error.mensaje) || textoSuelto(error.message) || textoSuelto(error.descripcion)
    return texto ? [{ id: textoSuelto(error.id) || textoSuelto(error.codigo), texto }] : []
  })
  return { texto: errores.map((e) => e.texto).join(' · '), codigo: errores[0]?.id || undefined }
}

/**
 * Lo que decirle a la persona según cómo contestó Mercantil. Las dos respuestas del gateway que
 * importan se reconocen por su texto: la clave de suscripción que falta o no vale, y la ruta que no
 * existe (que es un error nuestro, no de la cuenta).
 */
export function mensajeDeError(status: number, texto: string, que: string): { mensaje: string; codigo?: string } {
  const datos = parseJsonSeguro(texto)
  const d = datos && typeof datos === 'object' ? (datos as Record<string, unknown>) : {}
  const delGateway = textoSuelto(d.message)
  if (/subscription key/i.test(delGateway)) {
    return {
      mensaje: /invalid/i.test(delGateway)
        ? 'Mercantil no aceptó la clave de suscripción (Ocp-Apim-Subscription-Key): revisá que sea la del perfil del portal de APIs y que la suscripción esté activa.'
        : 'Mercantil pide la clave de suscripción del portal de APIs (Ocp-Apim-Subscription-Key) y no se mandó.',
    }
  }
  if (status === 404 && /resource not found/i.test(delGateway)) {
    return { mensaje: `Mercantil no tiene la ruta ${que} (404): cambió su API o la cuenta no está suscripta a ese producto.` }
  }
  const negocio = erroresDeNegocio(datos)
  if (negocio.texto) return { mensaje: `Mercantil respondió ${status} a ${que}: ${negocio.texto}`, ...(negocio.codigo ? { codigo: negocio.codigo } : {}) }
  const descripcion = textoSuelto(d.error_description) || delGateway || textoSuelto(d.mensaje) || textoSuelto(d.detail) || resumenDelCuerpo(texto)
  return { mensaje: `Mercantil respondió ${status} a ${que}${descripcion ? `: ${descripcion}` : '.'}` }
}

/** El token de la respuesta de `credenciales/v2/` (la forma de siempre de OAuth: `access_token`, `expires_in`). */
export function leerToken(respuesta: unknown, ahora = Date.now()): TokenDeMercantil {
  const r = respuesta && typeof respuesta === 'object' ? (respuesta as Record<string, unknown>) : {}
  const token = textoSuelto(r.access_token) || textoSuelto(r.accessToken) || textoSuelto(r.token) || textoSuelto(r.id_token)
  if (!token) throw new ErrorDeMercantil('Mercantil contestó al pedido del token sin un token adentro.', false)
  const segundos = Number(r.expires_in ?? r.expiresIn ?? r.expires)
  const dura = Number.isFinite(segundos) && segundos > 0 ? segundos : null
  return {
    token,
    venceEn: ahora + Math.max(dura ?? DURACION_POR_DEFECTO_S, MARGEN_S * 2) * 1000 - MARGEN_S * 1000,
    venceSegunMercantil: dura ? ahora + dura * 1000 : null,
  }
}

export interface ClienteMercantil {
  readonly cuenta: CuentaMercantil
  /** El token vigente, pidiendo uno nuevo si no hay o venció. */
  token(): Promise<TokenDeMercantil>
  /** GET a `/<ruta>` con esos parámetros; devuelve el JSON. */
  get<T>(ruta: string, parametros?: Record<string, string>): Promise<T>
  /** POST con JSON a `/<ruta>`; devuelve el JSON y el texto crudo. */
  post<T>(ruta: string, cuerpo: unknown): Promise<T>
}

export interface OpcionesDeCliente {
  /** Para las pruebas: otro servidor en vez del de Mercantil. */
  urlBase?: string
}

// Los tokens, en memoria, por cuenta: un token sirve para todos los pedidos de la misma cuenta hasta
// que vence, y cada cotización no tiene por qué pedir uno. La clave del mapa es un hash: ni la
// contraseña ni la clave de suscripción quedan en claro en una estructura que se pueda volcar.
const tokens = new Map<string, Promise<TokenDeMercantil>>()

function claveDeCuenta(cuenta: CuentaMercantil, urlBase: string): string {
  return createHash('sha256').update([urlBase, cuenta.usuario, cuenta.clave, cuenta.claveDeSuscripcion].join('\n')).digest('hex')
}

/** Al cambiar la cuenta, y en las pruebas: que ningún token de la cuenta anterior siga valiendo. */
export function olvidarTokensDeMercantil(): void {
  tokens.clear()
}

export function crearClienteMercantil(cuenta: CuentaMercantil, opciones: OpcionesDeCliente = {}): ClienteMercantil {
  const base = (opciones.urlBase ?? URL_BASE_MERCANTIL[cuenta.ambiente]).replace(/\/+$/, '')
  const clave = claveDeCuenta(cuenta, base)

  async function pedir(url: string, init: RequestInit, que: string): Promise<{ status: number; texto: string }> {
    let respuesta: Response
    try {
      respuesta = await fetch(url, { ...init, signal: AbortSignal.timeout(ESPERA_MS) })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ErrorDeMercantil(`Mercantil no contestó ${que} en ${ESPERA_MS / 1000} segundos.`, true)
      }
      if (esFallaDeRed(error)) throw new ErrorDeMercantil('No se pudo conectar con Mercantil Andina. Fijate si hay internet.', true)
      throw new ErrorDeMercantil(error instanceof Error ? error.message : String(error), false)
    }
    return { status: respuesta.status, texto: await respuesta.text() }
  }

  async function pedirToken(): Promise<TokenDeMercantil> {
    const cuerpo = new URLSearchParams({
      client_id: CLIENT_ID,
      username: cuenta.usuario,
      password: cuenta.clave,
      grant_type: 'password',
    })
    const { status, texto } = await pedir(
      `${base}/${RUTA_TOKEN}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          [ENCABEZADO_SUSCRIPCION]: cuenta.claveDeSuscripcion,
        },
        body: cuerpo.toString(),
      },
      'el token',
    )
    const datos = parseJsonSeguro(texto)
    if (status < 200 || status >= 300 || datos === undefined) {
      const d = datos && typeof datos === 'object' ? (datos as Record<string, unknown>) : {}
      // Un 400/401 con `error` de OAuth (`invalid_grant`) es el usuario o la contraseña, no la suscripción.
      if ((status === 400 || status === 401) && typeof d.error === 'string' && !/subscription key/i.test(textoSuelto(d.message))) {
        const detalle = textoSuelto(d.error_description) || textoSuelto(d.error)
        throw new ErrorDeMercantil(`Mercantil no aceptó el usuario o la contraseña${detalle ? ` (${detalle})` : ''}. Revisá los dos y que el ambiente sea el de las credenciales.`, false, status)
      }
      const { mensaje, codigo } = mensajeDeError(status, texto, 'el pedido del token')
      throw new ErrorDeMercantil(mensaje, false, status, codigo)
    }
    return leerToken(datos)
  }

  async function token(): Promise<TokenDeMercantil> {
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

  function leerJson<T>(ruta: string, status: number, texto: string): T {
    const datos = parseJsonSeguro(texto)
    if (status < 200 || status >= 300 || datos === undefined) {
      const { mensaje, codigo } = mensajeDeError(status, texto, ruta)
      throw new ErrorDeMercantil(mensaje, false, status, codigo)
    }
    return datos as T
  }

  /** Un pedido con token. Si Mercantil contesta 401 con un token que creíamos vigente, se pide otro y se reintenta una vez. */
  async function conToken<T>(ruta: string, armar: (token: string) => RequestInit, que: string): Promise<T> {
    const primero = await token()
    const url = `${base}/${ruta}`
    let respuesta = await pedir(url, armar(primero.token), que)
    if (respuesta.status === 401 && !/subscription key/i.test(respuesta.texto)) {
      tokens.delete(clave)
      const segundo = await token()
      respuesta = await pedir(url, armar(segundo.token), que)
    }
    return leerJson<T>(ruta, respuesta.status, respuesta.texto)
  }

  function encabezados(token: string, extra: Record<string, string> = {}): Record<string, string> {
    return { accept: 'application/json', authorization: `Bearer ${token}`, [ENCABEZADO_SUSCRIPCION]: cuenta.claveDeSuscripcion, ...extra }
  }

  return {
    cuenta,
    token,
    async get(ruta, parametros = {}) {
      const consulta = new URLSearchParams(parametros).toString()
      const rutaCompleta = consulta ? `${ruta}?${consulta}` : ruta
      return conToken(rutaCompleta, (t) => ({ headers: encabezados(t) }), ruta)
    },
    async post(ruta, cuerpo) {
      return conToken(
        ruta,
        (t) => ({ method: 'POST', headers: encabezados(t, { 'content-type': 'application/json' }), body: JSON.stringify(cuerpo) }),
        /cotizaciones/.test(ruta) ? 'la cotización' : ruta,
      )
    },
  }
}
