// Quién está conectado y en qué está trabajando (14.0). Por ahora, apenas el buzón: guarda la última
// foto que mandó el servidor y avisa a la pantalla.
//
// La presencia viaja como FOTO COMPLETA y no como diferencias: son cinco computadoras, la lista entra
// en un renglón, y mandar deltas obligaría a las dos puntas a llevar el mismo estado y a ponerse de
// acuerdo cuando se desincronizan. Con cinco, la foto entera siempre gana.
//
// De acá sale también el foco de esta computadora: en qué celda o en qué ficha está parada la persona
// que la usa. Va con un respiro de 100 ms porque moverse con las flechas por la planilla cambia de
// celda diez veces por segundo, y lo que las otras computadoras necesitan saber es dónde SE QUEDÓ, no
// por dónde pasó. Y se reenvía al reconectar: la presencia del servidor se pierde con el socket, así
// que después de una caída nadie sabría dónde está esta persona hasta que se moviera.
import { emitirATodas } from '../servicios/avisos'
import { mandarPorElCanal } from './emisor'
import type { Foco, Presente } from './protocolo'

/** El respiro del foco: se manda uno solo con lo último, no uno por tecla. */
const RESPIRO_DEL_FOCO_MS = 100

/** La última foto que llegó. Vive en memoria: al reconectar el servidor manda una nueva enseguida. */
let presentes: Presente[] = []

/** Dónde está parada esta computadora ahora mismo. Es lo que se reenvía al reconectar. */
let focoPropio: Foco | null = null
let envioPendiente: ReturnType<typeof setTimeout> | null = null

/** Llegó `{t:'presencia'}`, o la lista que vino adentro del saludo. */
export function recibirPresencia(foto: Presente[]): void {
  presentes = foto
  emitirATodas('presencia:cambio', null)
}

export function presenciaActual(): Presente[] {
  return [...presentes]
}

/**
 * Dónde está trabajando esta persona: una celda de la planilla, una ficha o una pantalla entera.
 *
 * Se junta lo que pase en 100 ms y sale un frame solo, con lo ÚLTIMO. El `null` es «ya no estoy en
 * ningún lado» y viaja igual que los demás: es lo que apaga el glow del otro lado cuando alguien
 * termina de editar una celda o cierra una ficha.
 */
export function reportarFoco(foco: Foco | null): void {
  focoPropio = foco
  if (envioPendiente) return
  envioPendiente = setTimeout(() => {
    envioPendiente = null
    mandarElFoco()
  }, RESPIRO_DEL_FOCO_MS)
  // Un foco esperando salir no puede demorar el cierre del programa.
  envioPendiente.unref?.()
}

/**
 * El foco que mandó la pantalla, si tiene la forma de uno.
 *
 * Lo que entra por IPC puede ser cualquier cosa y de acá sale un frame para el servidor: se controla la
 * forma antes de guardarlo. Lo que no se entiende vale como «no estoy en ningún lado» (null), que es lo
 * que corresponde: apagar el glow es siempre más seguro que dejarlo prendido en el lugar equivocado.
 */
export function leerFoco(crudo: unknown): Foco | null {
  if (!crudo || typeof crudo !== 'object') return null
  const dato = crudo as Record<string, unknown>
  const texto = (valor: unknown): string => (typeof valor === 'string' ? valor.trim().slice(0, 200) : '')
  const editando = dato.editando === true

  if (dato.tipo === 'celda') {
    const pestana = texto(dato.pestana)
    const filaId = texto(dato.filaId)
    const campo = texto(dato.campo)
    if (!pestana || !filaId || !campo) return null
    return { tipo: 'celda', pestana, filaId, campo, editando }
  }
  if (dato.tipo === 'objeto') {
    const objetos = ['cliente', 'poliza', 'siniestro', 'tarea', 'lead', 'presupuesto', 'fila'] as const
    const objeto = objetos.find((candidato) => candidato === dato.objeto)
    const filaId = texto(dato.filaId)
    if (!objeto || !filaId) return null
    return { tipo: 'objeto', objeto, filaId, editando }
  }
  if (dato.tipo === 'modulo') {
    const modulo = texto(dato.modulo)
    return modulo ? { tipo: 'modulo', modulo } : null
  }
  return null
}

/** Dónde dice esta computadora que está. Lo pregunta el renderer al montarse. */
export function focoActual(): Foco | null {
  return focoPropio
}

/**
 * El canal volvió: se vuelve a decir dónde está esta persona.
 *
 * Hace falta porque la presencia del servidor vive con el socket: cuando se corta, esta computadora
 * desaparece de la foto de las otras. Al reconectar, el saludo la vuelve a poner en la lista, pero sin
 * foco —el servidor no lo guardó—, y sin este reenvío el glow no volvería hasta que la persona se
 * moviera de celda.
 */
export function reenviarElFoco(): void {
  if (focoPropio) mandarElFoco()
}

function mandarElFoco(): void {
  // Sin canal no sale, y no pasa nada: `vivo:foco` es el único canal que escribe sin exigir conexión
  // (ver `ipc.ts`), porque un foco que no llegó no descoloca ningún dato.
  mandarPorElCanal({ t: 'foco', foco: focoPropio })
}

/**
 * Al cerrar sesión y al perder el canal: nadie está presente si no hay canal por el que verlo, y el
 * foco propio se olvida —lo que esta persona estaba mirando no es asunto de la que ingrese después—.
 */
export function olvidarLaPresencia(): void {
  focoPropio = null
  if (envioPendiente) clearTimeout(envioPendiente)
  envioPendiente = null
  if (presentes.length === 0) return
  presentes = []
  emitirATodas('presencia:cambio', null)
}
