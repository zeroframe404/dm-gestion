// El cartero: lo único que habla con el servidor de mensajes.
//
// POR EVENTOS, NO POR UN BUCLE (14.0). Hasta la 13.x esto era una vuelta sin fin: acusar, despachar y
// dejar un pedido colgado hasta 25 segundos esperando novedades; cuando contestaba, otra vuelta. Ahora
// el canal en vivo (`vivo/canal.ts`) avisa con un frame `{t:'mensajes'}` y el cartero sale a buscar lo
// que hay, con `espera: 0`. Los mismos endpoints de siempre; lo que se fue es la espera.
//
// La vuelta quedó partida en dos mitades, porque ahora se piden en momentos distintos:
//
//   · `despacharSalida(actor)` — acusar lo que ya llegó y vaciar la cola de salida. Se llama al
//     escribir un mensaje (`apurarAlCartero`, con 100 ms de respiro) y al abrir sesión.
//   · `traerNovedadesDeMensajes(actor)` — pedir lo que haya, guardarlo, acusarlo y avisar. Se llama
//     cuando el canal dice que hay algo, y al reconciliar tras una reconexión.
//
// EL ORDEN DE ADENTRO NO CAMBIÓ, Y ES LO QUE MÁS IMPORTA: primero se GUARDA y después se ACUSA. Si el
// programa se cierra en el medio, lo peor que pasa es que un mensaje ya guardado vuelva a llegar la
// próxima vez (y se guarde encima del mismo, que es inofensivo). Al revés —acusar y después guardar—
// un cierre en el medio perdería el mensaje para siempre.
//
// Cuándo arranca y cuándo para: arranca cuando alguien ingresa y para cuando cierra sesión o se cierra
// el programa. Sin bucle no hay nada que cortar a mitad de camino: lo único que se cancela al parar es
// el respiro de `apurarAlCartero`.
import type { SesionUsuario } from '../../shared/tipos'
import { resumenDeMensaje } from '../../shared/texto'
import { llamarLaAtencion, notificarEnElSistema, sacudirLaVentana } from '../servicios/avisos'
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
import { esRechazoDefinitivo, puenteDeMensajes } from './puente'
import { emitirATodas as emitir } from '../servicios/avisos'

/**
 * El respiro de `apurarAlCartero` (14.0). Mandar un mensaje con tres adjuntos deja tres avisos casi
 * juntos; con este respiro salen todos en el mismo despacho.
 */
const RESPIRO_MS = 100

let quienSoy: SesionUsuario | null = null
let apuro: ReturnType<typeof setTimeout> | null = null

/**
 * Acusa lo que ya llegó y vacía la cola de salida (14.0: la mitad de la vuelta que MANDA).
 *
 * Lanza si el servidor o la red fallaron: quien la llama decide qué hacer con eso. Los mensajes que el
 * servidor rechazó de una forma que no se arregla reintentando quedan marcados como fallados con el
 * motivo a la vista, igual que siempre.
 */
export async function despacharSalida(actor: SesionUsuario): Promise<void> {
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
}

/**
 * Pide lo que haya para esta persona y lo guarda (14.0: la mitad de la vuelta que TRAE).
 *
 * La pide con `espera: 0` —«contestá lo que tengas ahora»— porque quien avisa que hay algo es el canal
 * en vivo. Hasta la 13.x este mismo pedido se dejaba colgado 25 segundos esperando que apareciera algo;
 * ésa era la forma de enterarse sin websockets, y es justo lo que el canal vino a reemplazar.
 *
 * Lanza si el servidor o la red fallaron. Lo que se perdió por eso no se pierde para siempre: el
 * pedido no acusa nada que no haya guardado, así que el aviso siguiente —o la reconciliación de la
 * reconexión— lo vuelve a traer.
 */
export async function traerNovedadesDeMensajes(actor: SesionUsuario): Promise<void> {
  const puente = puenteDeMensajes()
  if (!puente) return
  const yo = actorDelPuente(actor)
  const miClave = miClaveDe(actor)

  const novedades = await puente.novedades(yo, { desdeAcuses: cursorDeAcuses(), esperaSegundos: 0 })

  for (const conversacion of novedades.conversaciones) guardarConversacion(conversacion)

  const llegados: { autor: string; cuerpo: string; adjuntos: number }[] = []
  const zumbaron: string[] = []
  for (const remoto of novedades.mensajes) {
    const id = guardarMensaje(remoto, miClave)
    if (id === null) continue
    if (remoto.autorClave === miClave || remoto.eliminadoEn) continue
    // Un zumbido no es un mensaje que se lee: es un golpe en la puerta. Va por su propio camino —el
    // sacudón, el sonido fuerte— y no por el cartel de «te escribieron», que diría una frase vacía.
    if (remoto.tipo === 'ZUMBIDO') zumbaron.push(remoto.autorNombre)
    else llegados.push({ autor: remoto.autorNombre, cuerpo: remoto.cuerpo, adjuntos: remoto.adjuntos.length })
  }

  const acusesMovidos = guardarAcusesSueltos(novedades.acuses)
  guardarCursorDeAcuses(novedades.cursorAcuses)

  // Confirmar la llegada de lo que se acaba de guardar, sin esperar a nada más: el segundo tilde tiene
  // que aparecer del otro lado apenas el mensaje está acá. El acuse de `despacharSalida` sigue
  // existiendo igual, para lo que quedó sin confirmar de un pedido que falló a la mitad.
  const reciénGuardados = pendientesDeConfirmarLlegada(miClave)
  if (reciénGuardados.length) {
    await puente.avisarEntregados(
      yo,
      reciénGuardados.map((fila) => fila.remoto_id),
    )
    anotarAcusePropio(
      reciénGuardados.map((fila) => fila.id),
      miClave,
      'entregado_en',
    )
  }

  if (zumbaron.length) {
    // El sacudón de la ventana lo hace el proceso principal (es el único que puede moverla); el sonido
    // lo hace el renderer, igual que el resto de los avisos. Los dos empiezan en el mismo instante.
    notificarEnElSistema(zumbaron[0], zumbaron.length === 1 ? 'Te mandó un zumbido.' : 'Te mandaron un zumbido.')
    llamarLaAtencion()
    sacudirLaVentana()
    emitir('mensajes:zumbido', { autor: zumbaron[0] })
  }

  if (llegados.length) {
    avisarQueLlegaron(llegados)
    // El evento va DESPUÉS de guardar y de acusar: cuando la pantalla se entera, el mensaje ya está.
    emitir('mensajes:llegaron', null)
  } else if (zumbaron.length || acusesMovidos || novedades.conversaciones.length) {
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

/**
 * Arranca el cartero para quien acaba de ingresar: se queda con quién es y sale a buscar lo que quedó
 * pendiente de la sesión anterior. De ahí en más trabaja cuando lo llaman —el canal cuando avisa que
 * hay algo, o alguien que escribe un mensaje—, sin ningún reloj propio.
 *
 * Si ya estaba andando para la misma persona no sale de nuevo: `alCambiarLaSesion` se dispara también
 * cuando se refrescan los datos del usuario, y eso no es una sesión nueva.
 */
export function arrancarCartero(actor: SesionUsuario): void {
  const yaEstaba = quienSoy?.id === actor.id
  quienSoy = actor
  if (yaEstaba) return
  enSegundoPlano(unaVueltaDelCartero(actor), 'la vuelta de arranque')
}

export function pararCartero(): void {
  quienSoy = null
  if (apuro) clearTimeout(apuro)
  apuro = null
}

/**
 * Despierta al cartero para que despache ya: se usa al mandar un mensaje y al terminar de subir sus
 * archivos. Con 100 ms de respiro, para que un mensaje con varios adjuntos salga en un solo despacho.
 *
 * Sólo DESPACHA. Lo que llega no se pide acá: eso lo avisa el canal.
 */
export function apurarAlCartero(): void {
  if (!quienSoy || apuro) return
  apuro = setTimeout(() => {
    apuro = null
    const actor = quienSoy
    if (actor) enSegundoPlano(despacharSalida(actor), 'el despacho')
  }, RESPIRO_MS)
  // El respiro no tiene por qué mantener vivo el proceso al cerrar el programa.
  apuro.unref?.()
}

/**
 * Deja anotado lo que salió mal y sigue. Sin internet no se anota como error del servidor: es el
 * estado normal de una notebook que se llevaron a otro lado, y llenar la pantalla de errores rojos por
 * eso no ayuda a nadie.
 */
function enSegundoPlano(trabajo: Promise<unknown>, cual: string): void {
  void trabajo.then(
    () => anotarVueltaDelCartero(null),
    (error: unknown) => {
      const motivo = error instanceof Error ? error.message : String(error)
      anotarVueltaDelCartero(esFallaDeRed(error) ? null : motivo)
      if (!esFallaDeRed(error)) console.error(`[mensajería] Falló ${cual}:`, motivo)
    },
  )
}

/** Para las pruebas: las dos mitades, una atrás de la otra, que es lo que era una vuelta. */
export async function unaVueltaDelCartero(actor: SesionUsuario): Promise<void> {
  await despacharSalida(actor)
  await traerNovedadesDeMensajes(actor)
}
