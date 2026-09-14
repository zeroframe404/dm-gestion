// El cliente base de la API REST de Galeno Seguros: autenticación y el fetch envuelto que usa el
// resto de los archivos de esta carpeta (catalogos.ts, cotizacion.ts, emision.ts, consultas.ts,
// impresion.ts, cuentaCorriente.ts y art.ts). Nada de lo de acá sale de esta carpeta: el resto de la
// app sólo ve `src/main/servicios/galeno.ts`.
//
// Cómo autentica: usuario y clave van en el BODY (no en el header) de POST /seguridad/token, junto
// con un "Authorization: Basic ..." que identifica a la APLICACIÓN —no a la persona— y que el manual
// de Galeno documenta como valor fijo para su ambiente de pruebas ("desa"). Para producción, tanto la
// URL base como ese Authorization son otros y Galeno los da aparte del manual (ver `ConfigGaleno` en
// servicios/config.ts): por eso los dos son overrides opcionales acá y valen los de pruebas si no se
// cargó nada.
//
// El "access_token" dura una hora (no hay endpoint de refresh documentado): se guarda en memoria y
// se vuelve a pedir con usuario y clave cinco minutos antes de vencer, o si Galeno devuelve 401 a
// mitad de camino.
//
// Un detalle del propio manual: el login de Galeno es de SESIÓN ÚNICA por usuario — entrar de nuevo
// caduca cualquier sesión vigente de ese mismo usuario. Si dos computadoras de la agencia llaman con
// el mismo usuario casi al mismo tiempo, la sesión de una puede caer con 401 apenas la otra entra; el
// reintento de acá se hace cargo solo (vuelve a loguear y repite el pedido una vez), así que no hace
// falta nada especial del lado de quien llama.
import { esFallaDeRed } from '../../servicios/red'

const URL_DESA = 'https://www.gsbeneficios.com.ar/WS-Seguros-desa'

/**
 * El "Authorization: Basic" de la aplicación para el ambiente de pruebas, tal como lo trae el manual
 * ("Servicios REST — Galeno Seguros v9.5", página 9): identifica al proveedor ante Galeno, no a un
 * usuario ni a la agencia, así que es el mismo para cualquiera que pruebe contra ese ambiente.
 */
const AUTHORIZATION_BASIC_DESA = 'Basic Z2FsZW5vX2NKdHh3ejd0Wmh5UXRqNGU6VVliZEVCM1IzcUpKR3hyVEtYdlVCc2NGcWc5SDlUQnZ2UFpKeWU0Rg=='

const ESPERA_MAXIMA_MS = 45_000

export class ErrorDeGaleno extends Error {
  constructor(
    mensaje: string,
    /** true si fue «no hay internet» y no «Galeno dijo que no». */
    readonly esDeRed: boolean,
  ) {
    super(mensaje)
    this.name = 'ErrorDeGaleno'
  }
}

export interface CredencialesGaleno {
  usuario: string
  clave: string
  ambiente: 'desa' | 'produccion'
  urlBase?: string
  authorizationBasic?: string
}

interface OpcionesDePedido {
  metodo?: 'GET' | 'POST'
  body?: unknown
}

export interface ClienteGaleno {
  /** GET o POST autenticado; `ruta` es relativa a la base (p. ej. `/api/cotizadores/comun/ramas`).
   *  Reintenta una vez ante 401. Devuelve el cuerpo ya parseado como JSON. */
  pedirJson<T>(ruta: string, opciones?: OpcionesDePedido): Promise<T>
  /** Igual que `pedirJson`, para los dos endpoints que no devuelven JSON: Impresión (PDF binario) y
   *  Contratos ART (CSV plano). Quien llama se encarga de leer el cuerpo de la respuesta. */
  pedirCrudo(ruta: string, opciones?: OpcionesDePedido): Promise<Response>
}

/** `JSON.parse` puede tirar si el cuerpo no es JSON (la página de error de Tomcat, por ejemplo). */
function parseJsonSeguro<T>(texto: string): T | null {
  if (!texto) return null
  try {
    return JSON.parse(texto) as T
  } catch {
    return null
  }
}

function mensajeDeError(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const j = json as { message?: unknown; descripcionError?: unknown; mensaje?: unknown; errores?: unknown; error_description?: unknown }
  if (typeof j.error_description === 'string' && j.error_description.trim()) return j.error_description.trim()
  if (typeof j.message === 'string' && j.message.trim()) return j.message.trim()
  if (typeof j.descripcionError === 'string' && j.descripcionError.trim()) return j.descripcionError.trim()
  if (typeof j.mensaje === 'string' && j.mensaje.trim()) return j.mensaje.trim()
  if (Array.isArray(j.errores) && j.errores.length > 0) {
    const primero = j.errores[0] as { descripcion?: unknown } | undefined
    if (primero && typeof primero.descripcion === 'string') return primero.descripcion
  }
  return null
}

export function crearClienteGaleno(credenciales: CredencialesGaleno): ClienteGaleno {
  const base = (credenciales.urlBase?.trim() || URL_DESA).replace(/\/+$/, '')
  const authorizationBasic = credenciales.authorizationBasic?.trim() || AUTHORIZATION_BASIC_DESA

  let tokenDeAcceso: string | null = null
  let venceEn = 0

  async function pedir(url: string, opciones: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...opciones, signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) })
    } catch (error) {
      if (esFallaDeRed(error)) throw new ErrorDeGaleno('No se pudo conectar con Galeno Seguros. Fijate si hay internet.', true)
      throw new ErrorDeGaleno(error instanceof Error ? error.message : String(error), false)
    }
  }

  /** Entra con usuario y clave. Deja el token en memoria; no hay nada que persistir. */
  async function ingresar(): Promise<void> {
    const cuerpo = new URLSearchParams({ grant_type: 'password', username: credenciales.usuario, password: credenciales.clave })
    const respuesta = await pedir(`${base}/seguridad/token`, {
      method: 'POST',
      headers: { authorization: authorizationBasic, 'content-type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    })
    const texto = await respuesta.text()
    const json = parseJsonSeguro<{ access_token?: string; error?: string; error_description?: string }>(texto)
    if (!respuesta.ok || !json?.access_token) {
      // El "Authorization" mal (Basic de otra aplicación, o de pruebas contra el ambiente de
      // producción) da una página de Tomcat, no JSON: "Bad credentials". Se distingue del usuario o
      // la clave mal —que sí vienen en JSON, con `error: "invalid_grant"`— para no decirle a la
      // persona que revise la clave cuando el problema es el Authorization de la aplicación.
      if (!json && /bad credentials/i.test(texto)) {
        throw new ErrorDeGaleno(
          'Galeno rechazó el "Authorization" de la aplicación (no el usuario ni la clave). Si estas credenciales son de producción, cargá en Administración → Galeno la URL y el "Authorization" que Galeno dio para producción.',
          false,
        )
      }
      const motivo = json?.error_description?.trim() || json?.error || `Galeno respondió ${respuesta.status} al ingresar.`
      throw new ErrorDeGaleno(motivo, false)
    }
    tokenDeAcceso = json.access_token
    // Documentado en una hora (3600s); se renueva cinco minutos antes por si el reloj de esta
    // computadora no coincide exacto con el de Galeno.
    venceEn = Date.now() + 55 * 60_000
  }

  async function token(): Promise<string> {
    if (tokenDeAcceso && Date.now() < venceEn) return tokenDeAcceso
    await ingresar()
    if (!tokenDeAcceso) throw new ErrorDeGaleno('No se pudo entrar a Galeno Seguros.', false)
    return tokenDeAcceso
  }

  async function pedirCrudo(ruta: string, opciones: OpcionesDePedido = {}): Promise<Response> {
    const metodo = opciones.metodo ?? 'GET'
    const cuerpo = opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined
    const headersBase: Record<string, string> = opciones.body !== undefined ? { 'content-type': 'application/json' } : {}

    let respuesta = await pedir(`${base}${ruta}`, { method: metodo, headers: { ...headersBase, authorization: `Bearer ${await token()}` }, body: cuerpo })
    if (respuesta.status === 401) {
      // Token vencido antes de lo previsto, o sesión caducada porque otra computadora entró con el
      // mismo usuario mientras tanto. Se vuelve a entrar y se repite el pedido una sola vez.
      tokenDeAcceso = null
      respuesta = await pedir(`${base}${ruta}`, { method: metodo, headers: { ...headersBase, authorization: `Bearer ${await token()}` }, body: cuerpo })
    }
    return respuesta
  }

  async function pedirJson<T>(ruta: string, opciones: OpcionesDePedido = {}): Promise<T> {
    const respuesta = await pedirCrudo(ruta, opciones)
    const texto = await respuesta.text()
    const json = parseJsonSeguro<unknown>(texto)
    if (!respuesta.ok) {
      throw new ErrorDeGaleno(mensajeDeError(json) ?? `Galeno respondió ${respuesta.status}.`, false)
    }
    return json as T
  }

  return { pedirJson, pedirCrudo }
}
