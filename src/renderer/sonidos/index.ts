// Los tres sonidos de aviso del programa.
//
// La agencia trabaja con la aplicación de fondo y la vista puesta en otra cosa —el teléfono, un
// papel, la persona del mostrador—, así que un punto rojo en una campana que nadie está mirando no
// avisa nada. Estos tres sonidos son para eso, y por eso son tres distintos: se tiene que poder
// saber QUÉ pasó sin dar vuelta la cabeza.
//
//   campana        una tarea nueva o algo que vence hoy
//   rechazo        un débito que rebotó y hay que salir a cobrarlo a mano
//   tareaHecha     alguien terminó una tarea (es el único que además es una buena noticia)
//
// Los archivos se importan con `?url`: Vite los copia al empaquetado y devuelve la ruta relativa, que
// es lo que la CSP de producción permite cargar (`media-src 'self'`).
//
// Dos cosas que parecen detalles y no lo son:
//   1. Chromium no deja sonar nada hasta que la persona tocó algo en la ventana. Si el aviso llega
//      antes de eso, el `play()` falla; se ignora en silencio y el siguiente ya suena. Nunca puede
//      tirar un error a la consola ni romper la pantalla que lo pidió.
//   2. El volumen y el interruptor de silencio son de esta computadora, no del usuario ni de la
//      agencia: en el mostrador se quiere escuchar y en la oficina de al lado, no. Por eso van en
//      localStorage y no en la base ni en la hoja.
import campanaUrl from './campana.m4a?url'
import rechazoUrl from './debito-rechazado.mp3?url'
import tareaHechaUrl from './tarea-completa.mp3?url'

export type NombreDeSonido = 'campana' | 'rechazo' | 'tareaHecha'

const ARCHIVOS: Record<NombreDeSonido, string> = {
  campana: campanaUrl,
  rechazo: rechazoUrl,
  tareaHecha: tareaHechaUrl,
}

const CLAVE_SILENCIO = 'dm.sonidos.silenciados'
const CLAVE_VOLUMEN = 'dm.sonidos.volumen'

/** Ni tan bajo que se pierda en una oficina, ni tan alto que asuste al que está atendiendo. */
const VOLUMEN_POR_DEFECTO = 0.6

/**
 * Un aviso repetido no se escucha dos veces seguidas: si llegan tres rechazos juntos suena uno solo.
 * Medio segundo alcanza para agrupar lo que llegó en la misma consulta sin comerse dos avisos reales.
 */
const ESPERA_ENTRE_IGUALES_MS = 500

const ultimaVez = new Map<NombreDeSonido, number>()
const precargados = new Map<NombreDeSonido, HTMLAudioElement>()

function leerBooleano(clave: string, siNoEsta: boolean): boolean {
  try {
    const guardado = window.localStorage.getItem(clave)
    return guardado === null ? siNoEsta : guardado === '1'
  } catch {
    // localStorage puede estar bloqueado; el sonido no es motivo para romper nada.
    return siNoEsta
  }
}

export function sonidosSilenciados(): boolean {
  return leerBooleano(CLAVE_SILENCIO, false)
}

export function silenciarSonidos(silenciar: boolean): void {
  try {
    window.localStorage.setItem(CLAVE_SILENCIO, silenciar ? '1' : '0')
  } catch {
    /* sin localStorage el interruptor vale sólo hasta cerrar la ventana */
  }
}

export function volumenDeLosSonidos(): number {
  try {
    const guardado = Number(window.localStorage.getItem(CLAVE_VOLUMEN))
    if (Number.isFinite(guardado) && guardado >= 0 && guardado <= 1) return guardado
  } catch {
    /* ídem */
  }
  return VOLUMEN_POR_DEFECTO
}

export function guardarVolumen(volumen: number): void {
  const acotado = Math.min(1, Math.max(0, volumen))
  try {
    window.localStorage.setItem(CLAVE_VOLUMEN, String(acotado))
  } catch {
    /* ídem */
  }
}

/**
 * Deja los tres archivos cargados antes de que haga falta. Sin esto, el primer aviso del día suena
 * medio segundo tarde —lo que tarda en bajar el archivo del disco— y llega después del cartel.
 */
export function precargarSonidos(): void {
  for (const nombre of Object.keys(ARCHIVOS) as NombreDeSonido[]) {
    if (precargados.has(nombre)) continue
    try {
      const audio = new Audio(ARCHIVOS[nombre])
      audio.preload = 'auto'
      audio.load()
      precargados.set(nombre, audio)
    } catch {
      /* si el archivo no está, el programa funciona igual: sólo no suena */
    }
  }
}

/**
 * Suena el aviso. Nunca lanza: si el navegador lo bloquea, si el archivo falta o si el usuario
 * silenció los sonidos, no pasa nada y quien lo llamó no se entera. Es un aviso, no una operación.
 */
export function reproducir(nombre: NombreDeSonido): void {
  if (sonidosSilenciados()) return

  const ahora = Date.now()
  const anterior = ultimaVez.get(nombre) ?? 0
  if (ahora - anterior < ESPERA_ENTRE_IGUALES_MS) return
  ultimaVez.set(nombre, ahora)

  try {
    const base = precargados.get(nombre)
    // Se clona para que dos avisos seguidos no se corten entre ellos: un mismo Audio reiniciado
    // silencia el que estaba sonando.
    const audio = base ? (base.cloneNode(true) as HTMLAudioElement) : new Audio(ARCHIVOS[nombre])
    audio.volume = volumenDeLosSonidos()
    const promesa = audio.play()
    if (promesa && typeof promesa.catch === 'function') promesa.catch(() => undefined)
  } catch {
    /* ver el comentario de arriba: un aviso que no suena no puede romper la pantalla */
  }
}

/** Para el botón «probar» de la pantalla de preferencias: suena aunque esté silenciado. */
export function probarSonido(nombre: NombreDeSonido): void {
  try {
    const audio = new Audio(ARCHIVOS[nombre])
    audio.volume = volumenDeLosSonidos()
    const promesa = audio.play()
    if (promesa && typeof promesa.catch === 'function') promesa.catch(() => undefined)
  } catch {
    /* ídem */
  }
}
