// Qué hace esta computadora cuando el canal en vivo dice «la grilla cambió» (14.0).
//
// El servidor no manda datos: manda una FOTO —la generación, `{pestaña: versión}` y lo mismo para las
// métricas que él calcula— y cada computadora compara esa foto contra lo que ya tiene y baja nada más
// lo distinto. Es lo que hacía el vigía con su long-poll (`sincronizacion/vigia.ts`, 13.1, borrado en
// la 14.0), con exactamente la misma lógica: lo único que cambió es de dónde llega el aviso. Por eso
// vive acá y no adentro de `canal.ts`: `bienvenida` y `grilla` traen la misma foto, y el banco de
// pruebas la puede aplicar a mano, sin socket y sin servidor.
//
// EL ORDEN NO ES CASUAL. Las versiones se adoptan RECIÉN DESPUÉS de haber bajado bien. Adoptarlas
// antes sería decir «ya tengo esto» sin tenerlo: si la bajada falla —o ni siquiera corre porque el
// motor estaba subiendo o importando— ese cambio no se vuelve a pedir nunca. En la 13.1 eso se
// arreglaba solo en la vuelta siguiente del long-poll, que llegaba igual aunque no hubiera novedades;
// acá no llega ninguna foto hasta que alguien vuelva a escribir, así que los títulos quedan en
// `pendientesDeBajar` y los reintenta un reloj propio (ver `programarElReintento`).
//
// POR QUÉ «DISTINTO» Y NO «MAYOR»: los títulos que cambiaron se calculan acá comparando el mapa
// conocido contra el de la foto, y basta con que la versión sea distinta. Si se restaura un respaldo
// del servidor las versiones BAJAN, y con «mayor» esa pestaña no se bajaría nunca más. Además
// `adoptarVersionPropia` (ver `sincronizacion/versiones.ts`) puede dejarnos adelantados de a uno tras
// una escritura nuestra, y ahí «distinto» tampoco molesta: el número coincide y no se baja nada.
import { emitirATodas } from '../servicios/avisos'
import { guardarSnapshotDeMetrica, leerSnapshotDeMetrica } from '../servicios/metricasCache'
import { credencialesDelPuente } from '../servicios/sincronizacion'
import { anotarEvento } from '../sincronizacion/cola'
import type { MotorDeSincronizacion } from '../sincronizacion/motor'
import { traerMetricaDelServidor } from '../sincronizacion/puenteDeMetricas'
import {
  adoptarVersiones,
  elMapaEstaVacio,
  generacionConocida,
  olvidarVersiones,
  versionesConocidas,
} from '../sincronizacion/versiones'
import type { FotoDeLaGrilla } from './protocolo'

/**
 * Techo duro entre bajadas. Por más seguido que avisen —una importación grande o un cierre de mes son
 * decenas de escrituras—, no se baja más seguido que esto. El servidor ya agrupa los avisos de una
 * tanda; esto es el cinturón del otro lado.
 */
const MINIMO_ENTRE_BAJADAS_MS = 3_000

/**
 * Los títulos que el servidor dijo que cambiaron y que todavía no se pudieron bajar. Se vacía recién
 * cuando la bajada salió bien.
 */
const pendientesDeBajar = new Set<string>()

/** La última foto que llegó: es contra ella que se adoptan las versiones cuando el reintento sale bien. */
let ultimaFoto: FotoDeLaGrilla | null = null
let ultimaBajada = 0
let reintento: ReturnType<typeof setTimeout> | null = null

/**
 * Las fotos se aplican de a una. Llegan por el socket cuando se le canta al servidor —dos escrituras
 * seguidas en otra sucursal son dos frames con milisegundos de diferencia— y dos bajadas encimadas se
 * pisarían el `adoptarVersiones`: la segunda podría adoptar títulos que la primera todavía no bajó.
 * El vigía no tenía este problema porque era un bucle secuencial.
 */
let enCurso: Promise<string[]> = Promise.resolve([])

/** Una señal que no se aborta nunca, para cuando quien aplica la foto no tiene ninguna que pasar. */
const SIN_CORTE = new AbortController().signal

/**
 * Espera `ms`, o menos si cortan. El oyente se saca siempre al terminar: sin eso, cada bajada le deja
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

/**
 * Aplica una foto de la grilla: trae las métricas que cambiaron, baja las pestañas distintas y recién
 * entonces da esas versiones por vistas. Devuelve los títulos que se bajaron, que es lo que miran las
 * pruebas («bajó AGOSTO 2026, y sólo ésa»).
 *
 * Sirve igual para `bienvenida` (la foto que trae el saludo del servidor) y para cada `grilla` que
 * llega después, que es lo mismo con menos campos alrededor.
 *
 * El motor se pasa a mano: el banco arma el suyo, con su base en memoria y su importador, en vez del
 * que usa el programa de verdad.
 */
export function aplicarFotoDeLaGrilla(
  foto: FotoDeLaGrilla,
  motor: MotorDeSincronizacion,
  senal: AbortSignal = SIN_CORTE,
): Promise<string[]> {
  enCurso = enCurso.catch(() => []).then(() => aplicarAhora(foto, motor, senal))
  return enCurso
}

async function aplicarAhora(
  foto: FotoDeLaGrilla,
  motor: MotorDeSincronizacion,
  senal: AbortSignal,
): Promise<string[]> {
  if (senal.aborted) return []
  ultimaFoto = foto
  const eraLaPrimera = elMapaEstaVacio()

  // Las métricas que el servidor ya calculó (el podio, por ahora): van aparte de las pestañas de la
  // grilla y no tienen que esperar a que el resto decida qué bajar.
  await procesarMetricas(foto.metricasVersiones, senal)
  if (senal.aborted) return []

  // La hoja se reemplazó entera del otro lado (restauraron un respaldo, o corrieron la migración
  // inicial). Las versiones de antes no dicen nada: se olvida todo y se baja de nuevo.
  const cambioLaGeneracion = !eraLaPrimera && generacionConocida() !== foto.generacion
  if (cambioLaGeneracion) {
    anotarEvento('motor', 'La base del servidor se reemplazó entera: se vuelve a bajar todo.')
    olvidarVersiones()
    pendientesDeBajar.clear()
    for (const titulo of Object.keys(foto.versiones)) pendientesDeBajar.add(titulo)
  } else if (eraLaPrimera && pendientesDeBajar.size === 0) {
    // Primera foto después de arrancar: `arrancarSincronizacion` acaba de correr una sincronización
    // completa, así que lo que hay ya está. Se adopta el mapa sin bajar nada.
    //
    // La condición del pendiente no sobra: después de un rebobinado el mapa queda olvidado a
    // propósito, y si la bajada de esa vez no pudo correr —el motor estaba ocupado— la foto siguiente
    // vería el mapa vacío y tomaría este atajo, dando por vista una hoja que todavía no bajó. Con
    // pendientes anotados no hay atajo que valga.
    adoptarVersiones(foto.versiones, foto.generacion)
    return []
  } else {
    for (const titulo of titulosQueCambiaron(foto.versiones)) pendientesDeBajar.add(titulo)
  }

  return bajarLosPendientes(foto, senal, motor)
}

/** Los títulos cuya versión no coincide con la que esta computadora tiene por vista. */
function titulosQueCambiaron(versiones: Record<string, number>): string[] {
  const conocidas = versionesConocidas()
  const cambiaron: string[] = []
  for (const [titulo, version] of Object.entries(versiones)) {
    if (conocidas[titulo] !== version) cambiaron.push(titulo)
  }
  return cambiaron
}

/**
 * Compara la versión de cada métrica contra la que esta computadora ya tiene guardada y trae la que
 * cambió. Una que no se pudo traer no frena a las demás ni a la foto entera: la versión conocida sigue
 * sin coincidir, así que se vuelve a intentar sola en la próxima —el mismo espíritu que
 * `pendientesDeBajar` con las pestañas, sólo que acá no hace falta ni anotar el pendiente: la
 * comparación de versiones ya hace ese papel.
 */
async function procesarMetricas(metricasVersiones: Record<string, number>, senal: AbortSignal): Promise<void> {
  const claves = Object.keys(metricasVersiones)
  if (claves.length === 0) return
  const credenciales = credencialesDelPuente()
  if (!credenciales) return

  for (const clave of claves) {
    if (senal.aborted) return
    const version = metricasVersiones[clave]
    const conocida = leerSnapshotDeMetrica(clave)?.servidorVersion ?? -1
    if (version === conocida) continue
    try {
      const resultado = await traerMetricaDelServidor(clave, credenciales, senal)
      if (!resultado) {
        console.error(`[vivo] No se pudo traer la métrica «${clave}»: se reintenta con la próxima foto.`)
        continue
      }
      // El servidor todavía no calculó esta métrica ninguna vez: nada que guardar.
      if (!resultado.disponible) continue
      guardarSnapshotDeMetrica(clave, {
        version: resultado.version,
        calculadoEn: resultado.calculadoEn,
        payload: resultado.payload,
      })
      emitirATodas('metricas:actualizaron', { claves: [clave] })
    } catch (error) {
      // Nunca deja la foto a mitad de camino por una métrica sola: se anota y se sigue con las demás.
      console.error(`[vivo] Falló al procesar la métrica «${clave}»:`, error instanceof Error ? error.message : error)
    }
  }
}

async function bajarLosPendientes(
  foto: FotoDeLaGrilla,
  senal: AbortSignal,
  motor: MotorDeSincronizacion,
): Promise<string[]> {
  if (pendientesDeBajar.size === 0) {
    // Nada que bajar, pero puede haber pestañas que se borraron del servidor: adoptar el mapa las saca.
    adoptarVersiones(foto.versiones, foto.generacion, [])
    return []
  }

  const desdeLaUltima = Date.now() - ultimaBajada
  if (desdeLaUltima < MINIMO_ENTRE_BAJADAS_MS) await esperar(MINIMO_ENTRE_BAJADAS_MS - desdeLaUltima, senal)
  if (senal.aborted) return []

  const titulos = [...pendientesDeBajar]
  ultimaBajada = Date.now()
  const resultado = await motor.ciclarBajadaDe(titulos)
  if (!resultado) {
    // El motor estaba subiendo o importando. Los títulos quedan en el conjunto y los reintenta el
    // reloj de abajo: darlos por bajados perdería el cambio, y esperar a la foto siguiente sería
    // esperar a que alguien vuelva a escribir en otra sucursal, que puede ser mañana.
    programarElReintento(motor)
    return []
  }

  for (const titulo of titulos) pendientesDeBajar.delete(titulo)
  adoptarVersiones(foto.versiones, foto.generacion, titulos)
  return titulos
}

/**
 * Un solo reloj de reintento, nunca dos. Se vuelve a armar en cada intento fallido porque una
 * importación de la base entera tarda minutos y un reintento único caería justo adentro: mientras
 * queden pendientes, se sigue golpeando la puerta del motor cada tanto. Cada golpe es barato —el
 * motor contesta `null` sin tocar la red— y se detiene solo cuando la bajada entra.
 */
function programarElReintento(motor: MotorDeSincronizacion): void {
  if (reintento) return
  reintento = setTimeout(() => {
    reintento = null
    if (pendientesDeBajar.size === 0 || !ultimaFoto) return
    const foto = ultimaFoto
    enCurso = enCurso.catch(() => []).then(() => bajarLosPendientes(foto, SIN_CORTE, motor))
    void enCurso
  }, MINIMO_ENTRE_BAJADAS_MS)
  // Un reintento pendiente no tiene por qué mantener vivo el proceso al cerrar el programa.
  reintento.unref?.()
}

/**
 * Volver al estado de recién arrancado: al abrir y al cerrar sesión, y en el banco de pruebas entre un
 * caso y el siguiente. Olvidar las versiones es a propósito: la sesión que entra baja todo de nuevo,
 * que es exactamente lo que uno quiere al empezar el día.
 */
export function reiniciarLaGrilla(): void {
  if (reintento) clearTimeout(reintento)
  reintento = null
  pendientesDeBajar.clear()
  ultimaFoto = null
  ultimaBajada = 0
  enCurso = Promise.resolve([])
  olvidarVersiones()
}

/** Sólo para el banco de pruebas: qué títulos quedaron esperando una bajada que no pudo correr. */
export function pendientesDeLaGrilla(): string[] {
  return [...pendientesDeBajar]
}
