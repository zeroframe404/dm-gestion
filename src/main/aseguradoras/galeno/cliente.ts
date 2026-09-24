// El cliente base de la API REST de Galeno Seguros: el fetch envuelto que usa el resto de los archivos
// de esta carpeta (catalogos.ts, cotizacion.ts, emision.ts, consultas.ts, impresion.ts,
// cuentaCorriente.ts y art.ts). Nada de lo de acá sale de esta carpeta: el resto de la app sólo ve
// `src/main/servicios/galeno.ts`.
//
// A DÓNDE VA CADA PEDIDO, Y POR QUÉ: Galeno sólo autoriza pedidos que salgan de la IP del VPS de la
// agencia —es la que se dio de alta ante Galeno—, y esta computadora (como cualquiera de las cinco
// sucursales) tiene la suya propia, casi siempre distinta y muchas veces dinámica. Antes esto le
// hablaba a Galeno directo y Galeno contestaba «Usuario no habilitado - La IP no fue informada» en
// cuanto la conexión no era la del VPS. Por eso acá no se llama a Galeno: se llama al VPS
// (`/api/dmg/galeno-rest/pedido`, con el mismo token del puente que usa el resto de dm-gestion —ver
// `credencialesVps` en servicios/config.ts—), y es el VPS el que tiene la cuenta de Galeno y le habla
// directo (ver `galenoRest.service.ts` allá). La ruta y el método de Galeno viajan en cabeceras
// (`x-galeno-ruta`, `x-galeno-metodo`); el VPS devuelve la respuesta de Galeno tal cual —mismo status,
// mismo content-type, mismos bytes—, así que todo lo demás de esta carpeta no nota la diferencia.
//
// La cuenta de Galeno (usuario, clave, ambiente, URL y Authorization de producción) ya no se carga acá:
// se edita desde API Aseguradoras → Galeno, que ahora guarda el ajuste compartido `galenoApi` en el
// VPS. Esta computadora no la necesita ni la ve.
import { esFallaDeRed } from '../../servicios/red'

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

interface OpcionesDePedido {
  metodo?: 'GET' | 'POST'
  body?: unknown
}

export interface ClienteGaleno {
  /** GET o POST vía el proxy del VPS; `ruta` es relativa a la base de Galeno (p. ej.
   *  `/api/cotizadores/comun/ramas`). Devuelve el cuerpo ya parseado como JSON. */
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
  const j = json as { message?: unknown; descripcionError?: unknown; mensaje?: unknown; errores?: unknown; error?: unknown }
  if (typeof j.message === 'string' && j.message.trim()) return j.message.trim()
  if (typeof j.descripcionError === 'string' && j.descripcionError.trim()) return j.descripcionError.trim()
  if (typeof j.mensaje === 'string' && j.mensaje.trim()) return j.mensaje.trim()
  // Del propio puente del VPS, si el token del puente está mal o el servidor no puede hablar con
  // Galeno (ver dmg.types.ts / galenoRest.service.ts allá).
  if (typeof j.error === 'string' && j.error.trim()) return j.error.trim()
  if (Array.isArray(j.errores) && j.errores.length > 0) {
    const primero = j.errores[0] as { descripcion?: unknown } | undefined
    if (primero && typeof primero.descripcion === 'string') return primero.descripcion
  }
  return null
}

export interface CredencialesVps {
  urlBase: string
  token: string
}

export function crearClienteGaleno(vps: CredencialesVps): ClienteGaleno {
  const base = vps.urlBase.replace(/\/+$/, '')

  async function pedir(url: string, opciones: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...opciones, signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) })
    } catch (error) {
      if (esFallaDeRed(error)) throw new ErrorDeGaleno('No se pudo conectar con el servidor de la agencia. Fijate si hay internet.', true)
      throw new ErrorDeGaleno(error instanceof Error ? error.message : String(error), false)
    }
  }

  async function pedirCrudo(ruta: string, opciones: OpcionesDePedido = {}): Promise<Response> {
    const metodo = opciones.metodo ?? 'GET'
    const cuerpo = opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined
    const headers: Record<string, string> = {
      authorization: `Bearer ${vps.token}`,
      'x-galeno-ruta': ruta,
      'x-galeno-metodo': metodo,
    }
    if (cuerpo !== undefined) headers['content-type'] = 'application/json'
    return pedir(`${base}/api/dmg/galeno-rest/pedido`, { method: 'POST', headers, body: cuerpo })
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
