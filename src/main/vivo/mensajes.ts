// El aviso de mensajería del canal en vivo (14.0).
//
// El frame `{t:'mensajes'}` no trae ningún mensaje: es un «hay algo tuyo». Los datos siguen viajando
// por `GET /api/dmg/mensajes/novedades` como desde la 12.8, sólo que ahora se pide con `espera: 0` y
// nada más cuando el servidor avisa, en vez de dejar un long-poll colgado las ocho horas del día.
//
// Por qué el aviso no trae el mensaje: la mensajería guarda adjuntos, acusa recibo y ordena hilos, y
// todo eso ya está resuelto del lado del cartero. Duplicarlo acá sería tener dos caminos por los que
// entra un mensaje y una sola forma de que se contradigan.
import type { SesionUsuario } from '../../shared/tipos'
import { traerNovedadesDeMensajes } from '../mensajeria/cartero'
import { esFallaDeRed } from '../servicios/red'

/**
 * El servidor avisó que hay novedades de mensajería para esta persona.
 *
 * Lo que salga mal queda anotado y nada más: un pedido que falló se recupera solo con el aviso
 * siguiente o con la reconciliación de la reconexión, y no puede tumbar el despacho del canal —que es
 * el mismo que reparte la grilla, la presencia y las llamadas—.
 */
export async function alLlegarAvisoDeMensajes(quien: SesionUsuario | null): Promise<void> {
  if (!quien) return
  try {
    await traerNovedadesDeMensajes(quien)
  } catch (error) {
    // Sin internet no se anota: es lo que ya está diciendo el banner de arriba.
    if (esFallaDeRed(error)) return
    console.error('[vivo] No se pudieron traer los mensajes nuevos:', error instanceof Error ? error.message : error)
  }
}
