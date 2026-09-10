// Los sonidos de aviso del programa.
//
// La agencia trabaja con la aplicación de fondo y la vista puesta en otra cosa —el teléfono, un
// papel, la persona del mostrador—, así que un punto rojo en una campana que nadie está mirando no
// avisa nada. Estos sonidos son para eso, y por eso son distintos entre sí: se tiene que poder
// saber QUÉ pasó sin dar vuelta la cabeza.
//
//   campana        una tarea nueva, algo que vence hoy, o un mensaje que llegó
//   rechazo        un débito que rebotó y hay que salir a cobrarlo a mano
//   tareaHecha     alguien terminó una tarea (es el único que además es una buena noticia)
//   zumbido        alguien tocó el botón de zumbar: interrumpe a propósito
//   tonoDeLlamada  alguien está llamando por voz (14.0): el único que suena EN BUCLE, hasta que se
//                  atiende, se rechaza o el que llama se cansa
//   colgar         la llamada se cortó (14.0): el «clac» del tubo, para saber que se terminó sin
//                  tener que mirar la pantalla
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
import zumbidoUrl from './zumbido.wav?url'
import tonoDeLlamadaUrl from './tono-llamada.wav?url'
import colgarUrl from './colgar.wav?url'

export type NombreDeSonido = 'campana' | 'rechazo' | 'tareaHecha' | 'zumbido' | 'tonoDeLlamada' | 'colgar'

const ARCHIVOS: Record<NombreDeSonido, string> = {
  campana: campanaUrl,
  rechazo: rechazoUrl,
  tareaHecha: tareaHechaUrl,
  zumbido: zumbidoUrl,
  tonoDeLlamada: tonoDeLlamadaUrl,
  colgar: colgarUrl,
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
 * El volumen con el que sale cada aviso.
 *
 * El zumbido y el tono de llamada (14.0) van un escalón más arriba que el resto (sin pasarse del tope)
 * porque son los dos que interrumpen a propósito: si suenan igual que la campana no se distinguen de
 * un mensaje cualquiera y el botón —o la llamada— no sirven para nada. Siguen respetando el volumen de
 * esta computadora y el interruptor de silencio: nadie puede hacer sonar algo en una oficina que
 * eligió no escuchar nada. Que una llamada entrante se pueda perder por tener el silencio puesto es
 * exactamente lo que quiere quien lo puso; para eso además se mueve la ventana y salta la notificación
 * del sistema, que no hacen ruido.
 */
function volumenDeSonido(nombre: NombreDeSonido): number {
  const base = volumenDeLosSonidos()
  return nombre === 'zumbido' || nombre === 'tonoDeLlamada' ? Math.min(1, base * 1.25) : base
}

/**
 * Deja los archivos cargados antes de que haga falta. Sin esto, el primer aviso del día suena
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
    audio.volume = volumenDeSonido(nombre)
    const promesa = audio.play()
    if (promesa && typeof promesa.catch === 'function') promesa.catch(() => undefined)
  } catch {
    /* ver el comentario de arriba: un aviso que no suena no puede romper la pantalla */
  }
}

/**
 * Un sonido que suena hasta que se lo corta: hoy es uno solo, el tono de una llamada entrante (14.0).
 *
 * Devuelve la función que lo para, para que quien lo arrancó no tenga que guardarse el `<audio>`. Se
 * llama desde un efecto de React y la función que devuelve es su limpieza: el tono se corta al
 * atender, al rechazar, cuando el que llama se cansa y también si la ventana se recarga en el medio.
 *
 * Tres diferencias con `reproducir`, todas a propósito:
 *   1. NO pasa por el respiro de medio segundo entre iguales: no son dos avisos, es uno que dura.
 *   2. Se crea un `<audio>` nuevo cada vez y no se clona el precargado, porque hay que quedarse con la
 *      referencia para poder pararlo.
 *   3. El silencio se mira UNA vez, al arrancar. Cambiar el interruptor con el teléfono sonando no lo
 *      calla —y no hace falta: el botón de silencio está en la barra de arriba, a un clic del de
 *      atender—.
 */
export function reproducirEnBucle(nombre: NombreDeSonido): () => void {
  if (sonidosSilenciados()) return () => undefined

  let audio: HTMLAudioElement | null = null
  try {
    audio = new Audio(ARCHIVOS[nombre])
    audio.loop = true
    audio.volume = volumenDeSonido(nombre)
    const promesa = audio.play()
    if (promesa && typeof promesa.catch === 'function') promesa.catch(() => undefined)
  } catch {
    /* ídem que en `reproducir`: un aviso que no suena no puede romper la pantalla que lo pidió */
  }

  return () => {
    if (!audio) return
    try {
      audio.pause()
      // A cero además de pausado: un `<audio>` que quedó a mitad de camino con `loop` puesto vuelve a
      // arrancar solo si el navegador lo reanuda (pasa al volver de una suspensión).
      audio.currentTime = 0
      audio.loop = false
    } catch {
      /* ídem */
    }
    audio = null
  }
}

/** Para el botón «probar» de la pantalla de preferencias: suena aunque esté silenciado. */
export function probarSonido(nombre: NombreDeSonido): void {
  try {
    const audio = new Audio(ARCHIVOS[nombre])
    audio.volume = volumenDeSonido(nombre)
    const promesa = audio.play()
    if (promesa && typeof promesa.catch === 'function') promesa.catch(() => undefined)
  } catch {
    /* ídem */
  }
}
