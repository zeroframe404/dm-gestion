// El vigía: lo que hace que un cambio hecho en otra sucursal aparezca acá en el momento, y no dentro
// de cinco minutos.
//
// La vuelta, en orden:
//
//   1. **Preguntar qué cambió**, con un pedido que el servidor deja abierto hasta 25 segundos. Le
//      manda el mapa `{pestaña: versión}` que esta computadora conoce; el servidor contesta apenas
//      alguien escribe, y si no aparece nada contesta lo mismo y se vuelve a preguntar.
//   2. **Bajar sólo las pestañas que cambiaron.** No las catorce del ciclo de todos los días: las que
//      el servidor nombró, que casi siempre es una.
//   3. **Recién entonces anotar que ya las tenemos.**
//
// Y vuelve a empezar. No hay `setInterval`: la espera está adentro del propio pedido. Es lo mismo que
// hace el cartero de la mensajería, y por lo mismo se siente instantáneo sin websockets y sin tocar la
// configuración del servidor de la agencia.
//
// EL ORDEN DEL PASO 3 NO ES CASUAL. Adoptar las versiones antes de bajar sería decir «ya tengo esto»
// sin tenerlo: si la bajada falla —o ni siquiera corre porque el motor estaba ocupado— ese cambio no
// se vuelve a pedir nunca y queda esperando al reloj de red de los cinco minutos, que es justamente lo
// que esto vino a evitar. Por eso los títulos se guardan en `pendientesDeBajar` hasta que la bajada
// salió bien. Es el mismo razonamiento por el que el cartero acusa los mensajes DESPUÉS de guardarlos.
//
// CUÁNDO ARRANCA Y CUÁNDO PARA: arranca cuando alguien ingresa y para cuando cierra sesión o se cierra
// el programa. Cerrar corta el pedido a mitad de camino con un `AbortController`; sin eso, apagar la
// aplicación esperaría los 25 segundos del pedido abierto.
//
// CONTRA UN SERVIDOR VIEJO: `POST /api/dmg/novedades` no existe antes de la 13.1 y contesta 404. El
// vigía lo anota una vez, se declara muerto —y con eso el motor vuelve a encender su carril rápido de
// las tareas— y prueba de nuevo cada diez minutos. Cuando el VPS se actualiza, las cinco computadoras
// se enganchan solas sin que nadie las reinicie.
import { anotarEvento } from './cola'
import type { MotorDeSincronizacion } from './motor'
import { obtenerMotor } from '../servicios/sincronizacion'
import { esFallaDeRed } from '../servicios/red'
import {
  ESPERA_DEL_VIGIA_SEGUNDOS,
  esServidorSinAviso,
  puenteDeGrilla,
  type NovedadesDeLaGrilla,
} from './puenteDeGrilla'
import {
  adoptarVersiones,
  elMapaEstaVacio,
  generacionConocida,
  olvidarVersiones,
  versionesConocidas,
} from './versiones'

/** Después de una vuelta con error se espera esto antes de volver a intentar, para no golpear al servidor caído. */
const ESPERA_TRAS_ERROR_MS = 15_000
/** Después de una vuelta normal, un respiro mínimo: la espera de verdad la hace el long-poll. */
const RESPIRO_MS = 250
/**
 * Techo duro entre bajadas. Por más seguido que avisen —una importación grande o un cierre de mes son
 * decenas de escrituras—, no se baja más seguido que esto. El servidor ya agrupa los avisos de una
 * tanda; esto es el cinturón del otro lado.
 */
const MINIMO_ENTRE_BAJADAS_MS = 3_000
/** Tras un 404, cada cuánto se vuelve a probar si el servidor ya sabe avisar. */
const REINTENTO_DE_CAPACIDAD_MS = 10 * 60_000

let corriendo = false
let cortar: AbortController | null = null
/**
 * Si el servidor sabe avisar. `null` es «todavía no lo probamos». En false el motor vuelve a encender
 * su carril rápido de las tareas, así que una computadora nueva contra un servidor viejo se comporta
 * exactamente como antes de esto.
 */
let elServidorAvisa: boolean | null = null
let ultimaBajada = 0

/**
 * Los títulos que el servidor dijo que cambiaron y que todavía no se pudieron bajar. Se vacía recién
 * cuando la bajada salió bien.
 */
const pendientesDeBajar = new Set<string>()

/**
 * Espera `ms`, o menos si cortan. El oyente se saca siempre al terminar: sin eso, cada vuelta le deja
 * uno pegado a la misma señal y en un día de trabajo se juntan miles.
 */
function esperar(ms: number, senal: AbortSignal): Promise<void> {
  if (senal.aborted || ms <= 0) return Promise.resolve()
  return new Promise((seguir) => {
    const terminar = () => {
      clearTimeout(reloj)
      senal.removeEventListener('abort', terminar)
      seguir()
    }
    const reloj = setTimeout(terminar, ms)
    senal.addEventListener('abort', terminar, { once: true })
  })
}

export function arrancarVigia(): void {
  if (corriendo) return
  corriendo = true
  elServidorAvisa = null
  pendientesDeBajar.clear()
  olvidarVersiones()
  const control = new AbortController()
  cortar = control
  void vigilar(control.signal)
}

export function pararVigia(): void {
  corriendo = false
  cortar?.abort()
  cortar = null
  elServidorAvisa = null
  pendientesDeBajar.clear()
  olvidarVersiones()
}

/**
 * ¿El aviso en vivo está andando? Lo mira el motor para saber si tiene que seguir corriendo su carril
 * rápido de las tareas. Mientras no se probó todavía (`null`) se dice que sí: no vale la pena
 * encender el carril viejo por los dos segundos que tarda la primera vuelta.
 */
export function elVigiaEstaVivo(): boolean {
  return corriendo && elServidorAvisa !== false
}

async function vigilar(senal: AbortSignal): Promise<void> {
  while (corriendo && !senal.aborted) {
    try {
      await unaVuelta(senal, obtenerMotor())
      await esperar(RESPIRO_MS, senal)
    } catch (error) {
      if (senal.aborted) return
      if (esServidorSinAviso(error)) {
        // El VPS todavía no tiene el aviso en vivo. Se anota UNA vez —no una por vuelta— y se espera
        // largo: cuando lo desplieguen, esto se engancha solo.
        if (elServidorAvisa !== false) {
          elServidorAvisa = false
          anotarEvento(
            'motor',
            'El servidor todavía no tiene el aviso en vivo: los cambios de las otras computadoras van a llegar por el ciclo de siempre. Se vuelve a probar cada diez minutos.',
          )
        }
        await esperar(REINTENTO_DE_CAPACIDAD_MS, senal)
        continue
      }
      const motivo = error instanceof Error ? error.message : String(error)
      // Sin internet no se anota como error: es el estado normal de una notebook que se llevaron a
      // otro lado, y llenar la bitácora por eso no ayuda a nadie. El indicador de la barra ya lo dice.
      if (!esFallaDeRed(error)) console.error('[vigía] La vuelta del aviso en vivo falló:', motivo)
      await esperar(ESPERA_TRAS_ERROR_MS, senal)
    }
  }
}

/**
 * Una vuelta: preguntar, bajar lo que cambió, y recién entonces dar por vistas esas versiones.
 * Devuelve los títulos que se bajaron, que es lo que miran las pruebas.
 */
async function unaVuelta(senal: AbortSignal, motor: MotorDeSincronizacion): Promise<string[]> {
  const puente = puenteDeGrilla()
  if (!puente) {
    // Todavía no hay servidor configurado (desarrollo sin simulador). No es un error.
    await esperar(ESPERA_TRAS_ERROR_MS, senal)
    return []
  }

  const eraLaPrimera = elMapaEstaVacio()
  const novedades = await puente.novedades(
    versionesConocidas(),
    generacionConocida(),
    ESPERA_DEL_VIGIA_SEGUNDOS,
    senal,
  )
  if (elServidorAvisa !== true) elServidorAvisa = true
  if (senal.aborted) return []

  // La hoja se reemplazó entera del otro lado (restauraron un respaldo, o corrieron la migración
  // inicial). Las versiones de antes no dicen nada: se olvida todo y se baja de nuevo.
  const cambioLaGeneracion = !eraLaPrimera && generacionConocida() !== novedades.generacion
  if (cambioLaGeneracion) {
    anotarEvento('motor', 'La base del servidor se reemplazó entera: se vuelve a bajar todo.')
    olvidarVersiones()
    pendientesDeBajar.clear()
    for (const titulo of Object.keys(novedades.versiones)) pendientesDeBajar.add(titulo)
  } else if (eraLaPrimera && pendientesDeBajar.size === 0) {
    // Primera vuelta después de arrancar: `arrancarSincronizacion` acaba de correr una
    // sincronización completa, así que lo que hay ya está. Se adopta el mapa sin bajar nada.
    //
    // La condición del pendiente no sobra: después de un rebobinado el mapa queda olvidado a
    // propósito, y si la bajada de esa vuelta no pudo correr —el motor estaba ocupado— la vuelta
    // siguiente vería el mapa vacío y tomaría este atajo, dando por vista una hoja que todavía no
    // bajó. Con pendientes anotados no hay atajo que valga.
    adoptarVersiones(novedades.versiones, novedades.generacion)
    return []
  } else {
    for (const titulo of novedades.cambiaron) pendientesDeBajar.add(titulo)
  }

  return bajarLosPendientes(novedades, senal, motor)
}

async function bajarLosPendientes(
  novedades: NovedadesDeLaGrilla,
  senal: AbortSignal,
  motor: MotorDeSincronizacion,
): Promise<string[]> {
  if (pendientesDeBajar.size === 0) {
    // Nada que bajar, pero puede haber pestañas que se borraron del servidor: adoptar el mapa las saca.
    adoptarVersiones(novedades.versiones, novedades.generacion, [])
    return []
  }

  const desdeLaUltima = Date.now() - ultimaBajada
  if (desdeLaUltima < MINIMO_ENTRE_BAJADAS_MS) await esperar(MINIMO_ENTRE_BAJADAS_MS - desdeLaUltima, senal)
  if (senal.aborted) return []

  const titulos = [...pendientesDeBajar]
  ultimaBajada = Date.now()
  const resultado = await motor.ciclarBajadaDe(titulos)
  if (!resultado) {
    // El motor estaba subiendo o importando. Los títulos quedan en el conjunto y se reintentan en la
    // vuelta siguiente: darlos por bajados perdería el cambio hasta el reloj de red.
    return []
  }

  for (const titulo of titulos) pendientesDeBajar.delete(titulo)
  adoptarVersiones(novedades.versiones, novedades.generacion, titulos)
  return titulos
}

/**
 * Para el banco de pruebas: una vuelta sola, sin bucle ni esperas de error. Devuelve qué pestañas se
 * bajaron, que es lo que hay que poder afirmar («bajó AGOSTO 2026, y sólo ésa»).
 *
 * El motor se puede pasar a mano: el banco arma el suyo, con su base en memoria y su importador, en
 * vez del que usa el programa de verdad.
 */
export async function unaVueltaDelVigia(motor: MotorDeSincronizacion = obtenerMotor()): Promise<string[]> {
  const control = new AbortController()
  const eraCorriendo = corriendo
  corriendo = true
  try {
    return await unaVuelta(control.signal, motor)
  } finally {
    corriendo = eraCorriendo
  }
}

/** Para el banco de pruebas: volver al estado de recién arrancado sin levantar el bucle. */
export function reiniciarVigiaParaPruebas(): void {
  corriendo = false
  cortar = null
  elServidorAvisa = null
  ultimaBajada = 0
  pendientesDeBajar.clear()
  olvidarVersiones()
}
