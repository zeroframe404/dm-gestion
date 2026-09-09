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

/**
 * Lo que el tramo siguiente enchufa acá: `traerNovedadesDeMensajes(quien)` de `mensajeria/cartero.ts`
 * —la mitad de `unaVuelta` que PIDE (con `espera: 0`), guarda, acusa y avisa a la pantalla— separada
 * de la mitad que DESPACHA la cola de salida.
 */
export type TraerNovedadesDeMensajes = (quien: SesionUsuario) => Promise<void>

/**
 * El servidor avisó que hay novedades de mensajería para esta persona.
 *
 * TODO (14.0, tramo B2): el cuerpo es `await traerNovedadesDeMensajes(quien)`, envuelto en un
 * try/catch que sólo anote: un pedido que falló se recupera solo con el aviso siguiente o con la
 * reconciliación de la reconexión, y no puede tumbar el despacho del canal.
 */
export async function alLlegarAvisoDeMensajes(quien: SesionUsuario | null): Promise<void> {
  if (!quien) return
}
