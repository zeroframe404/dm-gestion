// El cliente base de los servicios de ATM Seguros: el SOAP con el que se cotiza y los REST de sus
// listas (vendedores, planes). Nada de lo de acá sale de esta carpeta: el resto de la app sólo ve
// `src/main/servicios/atm.ts` y el adaptador del multicotizador.
//
// A DIFERENCIA DE GALENO, ATM no pide que los pedidos salgan de una IP dada de alta: se le habla
// directo desde cada computadora, con la cuenta que se carga en API Aseguradoras → ATM (y que viaja a
// las demás como ajuste compartido, ver ajustesCompartidos.ts). Probado contra los dos ambientes.
//
// Cómo contesta ATM, que no es lo que dice su manual en todo:
// - El SOAP siempre responde 200, también cuando rechaza el pedido: el rechazo viene adentro, en
//   `<statusSuccess>FALSE</statusSuccess>` con un `<msg>` por motivo.
// - `ws_vendedores` es POST con JSON (`usuario`, `password`); un usuario mal da 200 con `error: true`.
// - `get_plans` es GET con `usa`, `seccion` y `vendedor` en minúscula y no pide autenticación.
import type { AmbienteAtm } from '../../../shared/tipos'
import { esFallaDeRed } from '../../servicios/red'
import { buscar, escaparXml, leerXml, type NodoXml } from './xml'

/** El SOAP puede tardar: se vieron cotizaciones de 17 segundos en producción. */
const ESPERA_SOAP_MS = 90_000
const ESPERA_REST_MS = 30_000

export const URL_BASE_ATM: Record<AmbienteAtm, string> = {
  produccion: 'https://wsatm.atmseguros.com.ar',
  desarrollo: 'https://wsatm-dev.atmseguros.com.ar',
}

export class ErrorDeAtm extends Error {
  constructor(
    mensaje: string,
    /** true si fue «no hay internet» y no «ATM dijo que no». */
    readonly esDeRed: boolean,
    /** El status HTTP con que contestó ATM, si llegó a contestar. */
    readonly status?: number,
  ) {
    super(mensaje)
    this.name = 'ErrorDeAtm'
  }
}

export interface CuentaAtm {
  ambiente: AmbienteAtm
  usuario: string
  clave: string
}

export interface ClienteAtm {
  readonly cuenta: CuentaAtm
  /**
   * Llama a un método `*_PHP` del SOAP con `docIn` (el XML del pedido, sin escapar) y devuelve el
   * elemento que vino adentro del `<…Result>` (el `<auto>` de la respuesta, por ejemplo).
   */
  soap(metodo: string, docIn: string): Promise<NodoXml>
  /** GET a `/api/v1/<ruta>` con esos parámetros; devuelve el JSON. */
  get<T>(ruta: string, parametros: Record<string, string>): Promise<T>
  /** POST con JSON a `/api/v1/<ruta>`; devuelve el JSON. */
  post<T>(ruta: string, cuerpo: unknown): Promise<T>
}

/** Cuando ATM no contesta lo esperado, un pedazo de lo que contestó, sin etiquetas, para el mensaje. */
export function resumenDelCuerpo(texto: string): string {
  const limpio = texto
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return limpio.length > 300 ? `${limpio.slice(0, 300)}…` : limpio
}

/** El sobre SOAP 1.1 de un método `*_PHP`: el pedido va como TEXTO (escapado) en `doc_in`. */
export function sobreSoap(metodo: string, docIn: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://tempuri.org/">' +
    `<soap:Body><tns:${metodo}><tns:doc_in>${escaparXml(docIn)}</tns:doc_in></tns:${metodo}></soap:Body>` +
    '</soap:Envelope>'
  )
}

/**
 * Lo que vino adentro de `<metodoResult>` en la respuesta SOAP. ATM lo manda como XML anidado; si
 * algún día lo manda como texto escapado, también se entiende. Un `Fault` se convierte en error.
 */
export function resultadoDelSobre(metodo: string, xml: string): NodoXml {
  const sobre = leerXml(xml)
  const falla = buscar(sobre, 'Fault')
  if (falla) {
    const motivo = buscar(falla, 'faultstring')?.texto.trim() || buscar(falla, 'Text')?.texto.trim() || 'sin detalle'
    throw new ErrorDeAtm(`ATM rechazó el pedido (${metodo}): ${motivo}`, false)
  }
  const resultado = buscar(sobre, `${metodo}Result`)
  if (!resultado) throw new ErrorDeAtm(`ATM contestó a ${metodo} sin el resultado esperado.`, false)
  if (resultado.hijos.length > 0) return resultado.hijos[0]!
  const anidado = resultado.texto.trim()
  if (anidado.startsWith('<')) return leerXml(anidado)
  throw new ErrorDeAtm(`ATM contestó a ${metodo} con un resultado vacío.`, false)
}

/** `JSON.parse` sin tirar: la página de error de Laravel no es JSON. */
function parseJsonSeguro(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown
  } catch {
    return undefined
  }
}

export interface OpcionesDeCliente {
  /** Para las pruebas: otro servidor en vez del de ATM. */
  urlBase?: string
}

export function crearClienteAtm(cuenta: CuentaAtm, opciones: OpcionesDeCliente = {}): ClienteAtm {
  const base = (opciones.urlBase ?? URL_BASE_ATM[cuenta.ambiente]).replace(/\/+$/, '')

  async function pedir(url: string, init: RequestInit, espera: number, que: string): Promise<{ status: number; texto: string }> {
    let respuesta: Response
    try {
      respuesta = await fetch(url, { ...init, signal: AbortSignal.timeout(espera) })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ErrorDeAtm(`ATM no contestó ${que} en ${espera / 1000} segundos.`, true)
      }
      if (esFallaDeRed(error)) throw new ErrorDeAtm('No se pudo conectar con ATM. Fijate si hay internet.', true)
      throw new ErrorDeAtm(error instanceof Error ? error.message : String(error), false)
    }
    return { status: respuesta.status, texto: await respuesta.text() }
  }

  function json<T>(ruta: string, status: number, texto: string): T {
    const datos = parseJsonSeguro(texto)
    if (status < 200 || status >= 300 || datos === undefined) {
      const mensaje =
        datos && typeof datos === 'object' && typeof (datos as { message?: unknown }).message === 'string'
          ? (datos as { message: string }).message
          : resumenDelCuerpo(texto)
      throw new ErrorDeAtm(`ATM respondió ${status} a ${ruta}${mensaje ? `: ${mensaje}` : '.'}`, false, status)
    }
    return datos as T
  }

  return {
    cuenta,
    async soap(metodo, docIn) {
      const { status, texto } = await pedir(
        `${base}/index.php/soap`,
        {
          method: 'POST',
          headers: { 'content-type': 'text/xml; charset=utf-8', SOAPAction: `"http://tempuri.org/${metodo}"` },
          body: sobreSoap(metodo, docIn),
        },
        ESPERA_SOAP_MS,
        'la cotización',
      )
      try {
        return resultadoDelSobre(metodo, texto)
      } catch (error) {
        // Un XML que no es la respuesta esperada con un status de error (una página de mantenimiento
        // en XHTML, por ejemplo): el status es lo que más dice.
        if (error instanceof ErrorDeAtm && (status < 400 || error.status !== undefined)) throw error
        if (error instanceof ErrorDeAtm) throw new ErrorDeAtm(`ATM respondió ${status} a ${metodo}: ${error.message}`, false, status)
        // No era XML: un 500 de PHP, una página de mantenimiento…
        const cuerpo = resumenDelCuerpo(texto)
        throw new ErrorDeAtm(`ATM respondió ${status} a ${metodo}${cuerpo ? `: ${cuerpo}` : '.'}`, false, status)
      }
    },
    async get(ruta, parametros) {
      const consulta = new URLSearchParams(parametros).toString()
      const { status, texto } = await pedir(`${base}/api/v1/${ruta}?${consulta}`, { headers: { accept: 'application/json' } }, ESPERA_REST_MS, ruta)
      return json(ruta, status, texto)
    },
    async post(ruta, cuerpo) {
      const { status, texto } = await pedir(
        `${base}/api/v1/${ruta}`,
        { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(cuerpo) },
        ESPERA_REST_MS,
        ruta,
      )
      return json(ruta, status, texto)
    },
  }
}
