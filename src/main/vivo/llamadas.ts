// La señalización de las llamadas de voz que pasa por el canal en vivo (14.0). Por ahora, apenas el
// buzón: guarda lo último que llegó y se lo pasa a la pantalla.
//
// El servidor sólo REENVÍA estos eventos (invitar, timbrar, aceptar, sdp, ice, colgar): el audio va
// derecho de una computadora a la otra por WebRTC, con el coturn del VPS como muleta cuando el router
// de una sucursal no deja pasar la conexión directa. Por eso `ConfiguracionIce` viaja en el saludo:
// es lo único que la computadora no puede saber sola.
//
// Y por eso esto vive en el proceso principal aunque el audio lo maneje el renderer: el canal es uno
// solo y es de acá; el renderer nunca abre sockets (ver la CSP en `vite.config.mts`).
//
// TODO (14.0, fase E2): acá va la máquina de estados por computadora (`libre → llamando → en-llamada
// → terminando`, y `libre → timbrando → en-llamada`), una sola llamada por proceso, el corte a los 45
// segundos de timbre, el aguante de 15 segundos si el canal se cae en medio de una llamada, y los
// canales IPC `llamadas:*`. El evento al renderer va a llevar el `EventoDeLlamada` adentro; hoy es un
// «volvé a preguntar» porque todavía no hay a quién preguntarle.
import { emitirATodas } from '../servicios/avisos'
import type { ConfiguracionIce, EventoDeLlamada } from './protocolo'

let ultimoEvento: EventoDeLlamada | null = null
let ice: ConfiguracionIce | null = null

/** Llegó `{t:'llamada'}`. */
export function recibirEventoDeLlamada(evento: EventoDeLlamada): void {
  ultimoEvento = evento
  emitirATodas('llamadas:evento', null)
}

export function ultimoEventoDeLlamada(): EventoDeLlamada | null {
  return ultimoEvento
}

/**
 * La configuración de STUN/TURN que vino en el saludo. Se guarda tal cual: las credenciales del TURN
 * vencen (doce horas) y se renuevan solas en el saludo de la reconexión siguiente.
 */
export function recibirConfiguracionIce(configuracion: ConfiguracionIce): void {
  ice = configuracion
}

export function configuracionIce(): ConfiguracionIce | null {
  return ice
}

/** Al cerrar sesión o al perder el canal: sin canal no hay señalización, así que no hay llamada. */
export function olvidarLasLlamadas(): void {
  ultimoEvento = null
  ice = null
}
