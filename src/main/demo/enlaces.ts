// La red de la versión de demostración: qué puede abrir, navegar o pedir el programa cuando es la demo.
//
// La demo se muestra delante de otras agencias y tiene que funcionar igual sin internet: todo lo que en
// el programa de verdad habla con un tercero (el VPS, Google, ATM, GitHub…) lo contesta adentro el
// servidor simulado (`demo/servidor.ts`, escuchando en 127.0.0.1) o las respuestas de `demo/apis.ts`.
// Cada servicio ya corta con su propio `if (esDemo())`, pero un camino nuevo que se olvide de ese corte
// saldría a internet sin que nadie lo note. Este archivo es la RED DE SEGURIDAD de abajo de todo eso:
//
//   - Enlaces (`abrirEnlaceDeLaDemo`): «Abrir en el navegador», los `target=_blank` de la pantalla y las
//     navegaciones de la ventana. Sólo se abre lo local; WhatsApp muestra cómo llegaría el mensaje
//     (`demo/whatsapp.ts`) y cualquier otra dirección muestra un aviso en vez de abrirse.
//   - Pedidos de la pantalla (`blindarSesionDeLaDemo`): toda request http/https/ws/wss del renderer a un
//     host que no sea de esta computadora se cancela antes de salir.
//   - Pedidos del proceso principal (`blindarFetchDeLaDemo`, `blindarWebSocketDeLaDemo`): `fetch` y
//     `WebSocket` globales rechazan los destinos que no son locales.
//
// Todo se engancha sólo si `esDemo()` (ver index.ts): la versión estable y la beta no pasan por acá.
import { dialog, shell, type BrowserWindow, type MessageBoxOptions, type Session } from 'electron'
import { mostrarWhatsappDeLaDemo, whatsappDeLaDemo } from './whatsapp'

/** El mensaje de los pedidos que la red de seguridad frena: lo ve quien lea la bitácora o un error. */
export const SIN_INTERNET_EN_LA_DEMO = 'La demo no se conecta a internet'

/**
 * Los hosts de esta misma computadora. El servidor simulado escucha en 127.0.0.1 y el de Vite (en
 * desarrollo) en localhost; `::1` es el localhost de IPv6, que `URL` devuelve entre corchetes.
 */
const HOSTS_LOCALES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * Esquemas que nunca salen de la computadora: la pantalla empaquetada (`file:`), la de carga (`data:`),
 * los archivos armados en memoria (`blob:`, p. ej. una vista previa) y las herramientas de desarrollo.
 */
const ESQUEMAS_LOCALES = new Set(['file:', 'data:', 'blob:', 'devtools:', 'chrome-devtools:', 'about:'])

/** Esquemas que sí viajan por la red y por eso se miran por host. */
const ESQUEMAS_DE_RED = new Set(['http:', 'https:', 'ws:', 'wss:'])

export function esHostLocal(host: string): boolean {
  return HOSTS_LOCALES.has(host.toLowerCase())
}

/**
 * true si la dirección no sale de esta computadora: un esquema local, o http/https/ws/wss contra un
 * host local. Lo que no se puede leer como URL NO es local: ante la duda, no se deja pasar.
 */
export function esDireccionLocal(url: string): boolean {
  let direccion: URL
  try {
    direccion = new URL(url)
  } catch {
    return false
  }
  const esquema = direccion.protocol.toLowerCase()
  if (ESQUEMAS_LOCALES.has(esquema)) return true
  if (ESQUEMAS_DE_RED.has(esquema)) return esHostLocal(direccion.hostname)
  return false
}

// --- Enlaces --------------------------------------------------------------------------------------

/** El cartel de «acá no se abren enlaces»: informativo, con la dirección para que se vea qué era. */
export async function avisarEnlaceBloqueado(url: string, ventana: BrowserWindow | null): Promise<void> {
  const opciones: MessageBoxOptions = {
    type: 'info',
    title: 'Enlace externo (demostración)',
    message: 'Esto es una demostración: no se abren enlaces externos.',
    // Cortada, por si es una dirección kilométrica (un enlace con el texto de un mensaje adentro).
    detail: url.length > 300 ? `${url.slice(0, 300)}…` : url,
    buttons: ['Entendido'],
    defaultId: 0,
    noLink: true,
  }
  if (ventana && !ventana.isDestroyed()) await dialog.showMessageBox(ventana, opciones)
  else await dialog.showMessageBox(opciones)
}

/**
 * Qué hace la demo con un enlace que el programa de verdad abriría en el navegador:
 *   - WhatsApp: el diálogo «Así le llegaría el WhatsApp al cliente», como hasta ahora.
 *   - Una dirección http(s) de esta computadora (Mi link contra el servidor simulado): se abre.
 *   - Cualquier otra cosa: no se abre y se avisa.
 * Quien llama sigue igual en los tres casos: para él el enlace «se abrió».
 */
export async function abrirEnlaceDeLaDemo(url: string, ventana: BrowserWindow | null): Promise<void> {
  const whatsapp = whatsappDeLaDemo(url)
  if (whatsapp) {
    await mostrarWhatsappDeLaDemo(whatsapp, ventana)
    return
  }
  if (/^https?:\/\//i.test(url) && esDireccionLocal(url)) {
    await shell.openExternal(url)
    return
  }
  console.warn(`[demo] Enlace externo no abierto: ${url}`)
  await avisarEnlaceBloqueado(url, ventana)
}

// --- Pedidos de la pantalla -----------------------------------------------------------------------

/** Las sesiones que ya tienen la red puesta: `session-created` y la sesión por omisión pueden repetirse. */
const sesionesBlindadas = new WeakSet<Session>()

/**
 * Cancela en esta sesión todo pedido http/https/ws/wss a un host que no sea local. Lo que pide la
 * pantalla (imágenes, fuentes, un `fetch` del renderer, un iframe) pasa por acá, y también lo que el
 * proceso principal pida con `net` de Electron (p. ej. electron-updater). Lo frenado queda en la consola.
 *
 * Electron admite UN solo `onBeforeRequest` por sesión: si algún día hiciera falta otro, hay que sumarlo
 * adentro de éste en vez de registrar uno nuevo, que lo pisaría.
 */
export function blindarSesionDeLaDemo(sesion: Session): void {
  if (sesionesBlindadas.has(sesion)) return
  sesionesBlindadas.add(sesion)
  sesion.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (detalles, responder) => {
    if (esDireccionLocal(detalles.url)) {
      responder({})
      return
    }
    console.warn(`[demo] ${SIN_INTERNET_EN_LA_DEMO}: se canceló ${detalles.method} ${detalles.url} (${detalles.resourceType}).`)
    responder({ cancel: true })
  })
}

// --- Pedidos del proceso principal ----------------------------------------------------------------

/** La dirección de lo que se le pasa a `fetch`: texto, `URL` o un `Request` armado. */
function direccionDelPedido(entrada: unknown): string {
  if (typeof entrada === 'string') return entrada
  if (entrada instanceof URL) return entrada.href
  if (entrada && typeof entrada === 'object' && 'url' in entrada && typeof (entrada as { url: unknown }).url === 'string') {
    return (entrada as { url: string }).url
  }
  return String(entrada)
}

let fetchBlindado = false

/**
 * Envuelve el `fetch` global del proceso principal: a un destino local va como siempre; a cualquier
 * otro, la promesa se rechaza con un error que dice por qué. Se llama lo antes posible al arrancar, antes
 * de que ningún servicio pida nada.
 */
export function blindarFetchDeLaDemo(): void {
  if (fetchBlindado || typeof globalThis.fetch !== 'function') return
  fetchBlindado = true
  const original = globalThis.fetch.bind(globalThis)
  const blindado: typeof fetch = (entrada, init) => {
    const url = direccionDelPedido(entrada)
    if (esDireccionLocal(url)) return original(entrada, init)
    console.warn(`[demo] ${SIN_INTERNET_EN_LA_DEMO}: se frenó un pedido a ${url}.`)
    return Promise.reject(new Error(`${SIN_INTERNET_EN_LA_DEMO} (se pidió ${url}).`))
  }
  globalThis.fetch = blindado
}

let webSocketBlindado = false

/**
 * Lo mismo con el `WebSocket` global (el del canal en vivo y el de los compañeros simulados): contra el
 * servidor de la demo, en 127.0.0.1, abre como siempre; contra cualquier otro host, el constructor lanza
 * y el que lo llamó lo trata como cualquier falla de conexión.
 */
export function blindarWebSocketDeLaDemo(): void {
  const global = globalThis as { WebSocket?: new (url: string | URL, protocolos?: string | string[]) => object }
  const Original = global.WebSocket
  if (webSocketBlindado || typeof Original !== 'function') return
  webSocketBlindado = true
  class WebSocketDeLaDemo extends Original {
    constructor(url: string | URL, protocolos?: string | string[]) {
      const direccion = typeof url === 'string' ? url : url.href
      if (!esDireccionLocal(direccion)) {
        console.warn(`[demo] ${SIN_INTERNET_EN_LA_DEMO}: se frenó un WebSocket a ${direccion}.`)
        throw new Error(`${SIN_INTERNET_EN_LA_DEMO} (se pidió ${direccion}).`)
      }
      super(url, protocolos)
    }
  }
  global.WebSocket = WebSocketDeLaDemo
}
