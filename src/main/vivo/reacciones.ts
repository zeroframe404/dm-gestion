// Las reacciones de los mensajes que llegan por el canal en vivo (14.0). Por ahora, apenas el buzón:
// guarda la última lista de cada mensaje y hace que la pantalla se redibuje.
//
// Va por el canal y no por el cartero a propósito: una reacción es un tilde de un emoji, no un
// mensaje. Si viajara como novedad de mensajería sonaría la campana y se movería la conversación
// arriba de todo cada vez que alguien pone un pulgar, que es exactamente lo que hace que la gente
// termine silenciando un chat.
//
// Lo que llega se guarda en la tabla local `mensaje_reacciones` (migración 29) con la misma función que
// usa `guardarMensaje`, para que el hilo abierto muestre lo mismo que la base y para que siga estando
// al abrir el programa sin internet. El aviso a la pantalla es `mensajes:cambiaron`: redibuja SIN sonar.
import { aplicarReaccionesRemotas } from '../servicios/mensajeria'
import { emitirATodas } from '../servicios/avisos'
import type { DelServidor, ReaccionRemota } from './protocolo'

/** El frame `{t:'reaccion'}`, tal cual lo manda el servidor. */
export type AvisoDeReaccion = Extract<DelServidor, { t: 'reaccion' }>

/** La última lista completa de reacciones de cada mensaje, por id remoto del mensaje. */
const porMensaje = new Map<string, ReaccionRemota[]>()

export function recibirReaccion(aviso: AvisoDeReaccion): void {
  // El servidor manda la lista ENTERA del mensaje, no el cambio: así dos reacciones puestas al mismo
  // tiempo en dos computadoras no dejan a nadie con una cuenta a medias.
  porMensaje.set(aviso.mensajeId, aviso.reacciones)
  try {
    // Puede no estar todavía: el aviso les llega a todos los participantes y alguno puede no haber
    // bajado el mensaje. Cuando lo baje va a venir con sus reacciones adentro.
    aplicarReaccionesRemotas(aviso.mensajeId, aviso.reacciones)
  } catch (error) {
    // Una reacción que no se pudo guardar no puede tumbar el canal, que es el mismo que reparte la
    // grilla y los mensajes: queda lo que llegó en memoria y la base se pone al día en la vuelta
    // siguiente del cartero.
    console.error('[vivo] No se pudo guardar la reacción:', error instanceof Error ? error.message : error)
  }
  emitirATodas('mensajes:cambiaron', null)
}

export function reaccionesDe(mensajeId: string): ReaccionRemota[] {
  return porMensaje.get(mensajeId) ?? []
}

/** Al cerrar sesión: lo que importa está en la base; esto es nada más lo último que pasó por el canal. */
export function olvidarLasReacciones(): void {
  porMensaje.clear()
}
