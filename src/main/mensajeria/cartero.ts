// El cartero: lo único que habla con el servidor de mensajes, y lo que hace que un mensaje aparezca
// del otro lado en el momento y no dentro de media hora.
//
// La vuelta, en orden:
//
//   1. **Confirmar lo que llegó.** Los mensajes que esta computadora bajó y guardó se le acusan al
//      servidor. Ése es el «entregado» que el otro ve como el segundo tilde. Va PRIMERO a propósito:
//      si el programa se cierra en el medio, lo peor que pasa es que un mensaje ya guardado se vuelva
//      a recibir la próxima vez (y se guarde encima del mismo, que es inofensivo). Al revés
//      —acusar y después guardar— un cierre en el medio perdería el mensaje para siempre.
//   2. **Despachar la cola.** Los mensajes escritos acá que ya tienen sus archivos arriba.
//   3. **Preguntar si hay algo nuevo**, con un pedido que el servidor deja abierto hasta 25 segundos.
//      Contesta apenas aparece algo, así que el mensaje llega cuando llega y no cuando toca el reloj.
//
// Y entonces vuelve a empezar. No hay `setInterval`: la espera está adentro del propio pedido. Es lo
// que hace que esto no sea «revisar cada 30 segundos» sino algo que se siente instantáneo, sin
// websockets y sin tocar la configuración del servidor de la agencia.
//
// Cuándo arranca y cuándo para: arranca cuando alguien ingresa y para cuando cierra sesión o se cierra
// el programa. Cerrar corta el pedido a mitad de camino con un `AbortController`; sin eso, apagar la
// aplicación esperaría los 25 segundos del pedido abierto.
import { BrowserWindow } from 'electron'
import type { DatosDeEvento, NombreEvento } from '../../shared/canales'
import type { SesionUsuario } from '../../shared/tipos'
import { resumenDeMensaje } from '../../shared/texto'
import { llamarLaAtencion, notificarEnElSistema } from '../servicios/avisos'
import { esFallaDeRed } from '../servicios/red'
import {
  actorDelPuente,
  anotarAcusePropio,
  anotarVueltaDelCartero,
  cursorDeAcuses,
  guardarAcusesSueltos,
  guardarConversacion,
  guardarCursorDeAcuses,
  guardarMensaje,
  marcarComoEnviado,
  marcarComoFallado,
  mensajesListosParaSalir,
  miClaveDe,
  paraMandar,
  pendientesDeConfirmarLlegada,
  posponerEnvio,
} from '../servicios/mensajeria'
import { esRechazoDefinitivo, ESPERA_DEL_LONG_POLL_SEGUNDOS, puenteDeMensajes } from './puente'

/** Después de una vuelta con error se espera esto antes de volver a intentar, para no golpear al servidor caído. */
const ESPERA_TRAS_ERROR_MS = 15_000
/** Después de una vuelta normal, un respiro mínimo: la espera de verdad la hace el long-poll. */
const RESPIRO_MS = 250

let corriendo = false
let cortar: AbortController | null = null
let quienSoy: SesionUsuario | null = null

/**
 * Las ventanas abiertas, o ninguna si no hay Electron alrededor. El banco de pruebas importa esto sin
 * proceso de Electron, y un aviso que no se puede mostrar no puede romper la entrega del mensaje.
 */
function ventanas(): BrowserWindow[] {
  try {
    return typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : []
  } catch {
    return []
  }
}

function emitir<E extends NombreEvento>(evento: E, datos: DatosDeEvento<E>): void {
  for (const ventana of ventanas()) {
    if (!ventana.isDestroyed()) ventana.webContents.send(evento, datos)
  }
}

/**
 * Espera `ms`, o menos si cortan. El oyente se saca siempre al terminar: sin eso, cada vuelta le deja
 * uno pegado a la misma señal y en un día de trabajo se juntan miles.
 */
function esperar(ms: number, senal: AbortSignal): Promise<void> {
  if (senal.aborted) return Promise.resolve()
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
 * Una vuelta completa. Devuelve true si trajo algo nuevo (para que la pantalla se entere) y lanza si
 * el servidor o la red fallaron, que es lo que hace esperar a la vuelta siguiente.
 */
async function unaVuelta(actor: SesionUsuario, senal: AbortSignal): Promise<void> {
  const puente = puenteDeMensajes()
  if (!puente) return
  const yo = actorDelPuente(actor)
  const miClave = miClaveDe(actor)

  // 1. Confirmar la llegada de lo que ya está guardado acá.
  const porConfirmar = pendientesDeConfirmarLlegada(miClave)
  if (porConfirmar.length) {
    await puente.avisarEntregados(
      yo,
      porConfirmar.map((fila) => fila.remoto_id),
    )
    anotarAcusePropio(
      porConfirmar.map((fila) => fila.id),
      miClave,
      'entregado_en',
    )
  }

  // 2. Despachar la cola de salida.
  let saliAlgo = false
  for (const fila of mensajesListosParaSalir(miClave, new Date().toISOString())) {
    try {
      const { mensaje } = await puente.enviar(yo, paraMandar(fila))
      marcarComoEnviado(fila.id, mensaje.orden)
      saliAlgo = true
    } catch (error) {
      if (esFallaDeRed(error)) throw error
      const motivo = error instanceof Error ? error.message : String(error)
      // Un rechazo del servidor que no se arregla reintentando (la conversación ya no existe, el
      // mensaje está vacío) se da por perdido con el motivo a la vista, en vez de reintentarlo para
      // siempre. Lo demás espera 1, 2, 4… minutos.
      if (esRechazoDefinitivo(error)) marcarComoFallado(fila.id, motivo)
      else posponerEnvio(fila.id, fila.intentos, motivo)
      saliAlgo = true
    }
  }
  if (saliAlgo) emitir('mensajes:cambiaron', null)

  // 3. Preguntar si hay algo nuevo, esperando.
  const novedades = await puente.novedades(
    yo,
    { desdeAcuses: cursorDeAcuses(), esperaSegundos: ESPERA_DEL_LONG_POLL_SEGUNDOS },
    senal,
  )
  if (senal.aborted) return

  for (const conversacion of novedades.conversaciones) guardarConversacion(conversacion)

  const llegados: { autor: string; cuerpo: string; adjuntos: number }[] = []
  for (const remoto of novedades.mensajes) {
    const id = guardarMensaje(remoto, miClave)
    if (id === null) continue
    if (remoto.autorClave !== miClave && !remoto.eliminadoEn) {
      llegados.push({ autor: remoto.autorNombre, cuerpo: remoto.cuerpo, adjuntos: remoto.adjuntos.length })
    }
  }

  const acusesMovidos = guardarAcusesSueltos(novedades.acuses)
  guardarCursorDeAcuses(novedades.cursorAcuses)

  if (llegados.length) {
    avisarQueLlegaron(llegados)
    // El evento va DESPUÉS de guardar y de acusar: cuando la pantalla se entera, el mensaje ya está.
    emitir('mensajes:llegaron', null)
  } else if (acusesMovidos || novedades.conversaciones.length) {
    emitir('mensajes:cambiaron', null)
  }
}

/**
 * El aviso de que llegó algo: el cartel del sistema, el ícono que parpadea y el empujón al renderer
 * para que suene la campana (el mismo sonido de las notificaciones normales del programa).
 *
 * El sonido lo hace el renderer y no el sistema operativo, igual que con las tareas: la notificación
 * de Windows va en `silent`, porque si sonaran las dos se escucharían dos avisos pisados y el de
 * Windows es el mismo para todo.
 */
function avisarQueLlegaron(llegados: { autor: string; cuerpo: string; adjuntos: number }[]): void {
  const primero = llegados[0]
  const cuerpo = primero.cuerpo
    ? resumenDeMensaje(primero.cuerpo, 120)
    : primero.adjuntos === 1
      ? 'Te mandó un archivo.'
      : `Te mandó ${primero.adjuntos} archivos.`

  notificarEnElSistema(
    llegados.length === 1 ? primero.autor : `${llegados.length} mensajes nuevos`,
    llegados.length === 1 ? cuerpo : `El último es de ${primero.autor}: ${cuerpo}`,
  )
  llamarLaAtencion()
}

/** Arranca el cartero para quien acaba de ingresar. Si ya estaba corriendo para otra persona, lo cambia. */
export function arrancarCartero(actor: SesionUsuario): void {
  if (corriendo && quienSoy?.id === actor.id) return
  pararCartero()
  quienSoy = actor
  corriendo = true
  const control = new AbortController()
  cortar = control
  void reparto(actor, control.signal)
}

export function pararCartero(): void {
  corriendo = false
  quienSoy = null
  cortar?.abort()
  cortar = null
}

/** Despierta al cartero para que salga ya, sin esperar: se usa al mandar un mensaje. */
export function apurarAlCartero(): void {
  // Cortar el pedido que está esperando hace que la vuelta termine y arranque la siguiente enseguida,
  // que es exactamente lo que hace falta para que el mensaje recién escrito salga sin demora.
  if (!corriendo || !quienSoy) return
  const anterior = cortar
  const control = new AbortController()
  cortar = control
  anterior?.abort()
  void reparto(quienSoy, control.signal)
}

async function reparto(actor: SesionUsuario, senal: AbortSignal): Promise<void> {
  while (corriendo && !senal.aborted) {
    try {
      await unaVuelta(actor, senal)
      anotarVueltaDelCartero(null)
      await esperar(RESPIRO_MS, senal)
    } catch (error) {
      if (senal.aborted) return
      const motivo = error instanceof Error ? error.message : String(error)
      // Sin internet no se anota como error del servidor: es el estado normal de una notebook que se
      // llevaron a otro lado, y llenar la pantalla de errores rojos por eso no ayuda a nadie.
      anotarVueltaDelCartero(esFallaDeRed(error) ? null : motivo)
      if (!esFallaDeRed(error)) console.error('[mensajería] La vuelta del cartero falló:', motivo)
      await esperar(ESPERA_TRAS_ERROR_MS, senal)
    }
  }
}

/** Para las pruebas: correr una sola vuelta, sin bucle ni esperas. */
export async function unaVueltaDelCartero(actor: SesionUsuario): Promise<void> {
  const control = new AbortController()
  await unaVuelta(actor, control.signal)
}
