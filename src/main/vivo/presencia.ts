// Quién está conectado y en qué está trabajando (14.0). Por ahora, apenas el buzón: guarda la última
// foto que mandó el servidor y avisa a la pantalla.
//
// La presencia viaja como FOTO COMPLETA y no como diferencias: son cinco computadoras, la lista entra
// en un renglón, y mandar deltas obligaría a las dos puntas a llevar el mismo estado y a ponerse de
// acuerdo cuando se desincronizan. Con cinco, la foto entera siempre gana.
//
// TODO (14.0, fase C2): acá van también `reportarFoco(foco)` —que manda `{t:'foco'}` por el canal con
// un respiro de 100 ms para no mandar un frame por cada tecla— y el reenvío del último foco al
// reconectar (el servidor pierde la presencia cuando se corta el socket). El canal IPC `vivo:foco` y
// el glow de colores del renderer son de la misma fase.
import { emitirATodas } from '../servicios/avisos'
import type { Presente } from './protocolo'

/** La última foto que llegó. Vive en memoria: al reconectar el servidor manda una nueva enseguida. */
let presentes: Presente[] = []

/** Llegó `{t:'presencia'}`, o la lista que vino adentro del saludo. */
export function recibirPresencia(foto: Presente[]): void {
  presentes = foto
  emitirATodas('presencia:cambio', null)
}

export function presenciaActual(): Presente[] {
  return [...presentes]
}

/** Al cerrar sesión y al perder el canal: nadie está presente si no hay canal por el que verlo. */
export function olvidarLaPresencia(): void {
  if (presentes.length === 0) return
  presentes = []
  emitirATodas('presencia:cambio', null)
}
