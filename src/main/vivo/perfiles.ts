// La foto y el color de cada persona de la agencia (14.0). Por ahora, apenas el buzón: guarda lo
// último que mandó el servidor y avisa a la pantalla.
//
// El perfil es de la PERSONA, no de la computadora: la clave es `claveDeUsuario(usuario)`, la misma
// identidad con la que viajan los mensajes y la presencia entre las cinco máquinas. El color es un
// índice 0-11 de la paleta y el servidor lo cuida único, así que dos personas nunca comparten glow.
//
// Lo que llega se guarda además en la base local (migración 29, tabla `perfiles`): así la foto se sigue
// viendo al abrir el programa sin internet —«ver sí, tocar no» vale también para las caras— y la lista
// que pide la pantalla (`perfiles:listar`) no depende de que el canal esté arriba. El espejo y el
// cliente del servidor viven en `usuarios/perfiles.ts`; acá está sólo el buzón del canal.
import { emitirATodas } from '../servicios/avisos'
import { guardarPerfil, guardarPerfiles } from '../usuarios/perfiles'
import type { Perfil } from './protocolo'

/**
 * Guarda en el espejo lo que llegó, sin dejar que un problema de la base tumbe el canal.
 *
 * El canal reparte con esta misma llamada la grilla, los mensajes y las llamadas de voz: una base que
 * todavía no está abierta (el banco de pruebas levantando un canal suelto) o un disco lleno no pueden
 * cortar ese reparto. La lista queda igual en memoria y se vuelve a guardar entera en el saludo
 * siguiente.
 */
function alEspejo(guardar: () => void): void {
  try {
    guardar()
  } catch (error) {
    console.error('[vivo] No se pudo guardar el perfil en la base local:', error instanceof Error ? error.message : error)
  }
}

/** Lo último que llegó, por clave de usuario. */
const perfiles = new Map<string, Perfil>()

/** La lista entera, tal como vino adentro del saludo. */
export function recibirPerfiles(lista: Perfil[]): void {
  perfiles.clear()
  for (const perfil of lista) perfiles.set(perfil.clave, perfil)
  alEspejo(() => guardarPerfiles(lista))
  emitirATodas('perfiles:cambiaron', null)
}

/** Alguien cambió su foto o su color, acá o en otra computadora. */
export function recibirPerfil(perfil: Perfil): void {
  const anterior = perfiles.get(perfil.clave)
  // Una foto vieja no puede pisar a una nueva: los frames de dos computadoras pueden cruzarse, y el
  // servidor numera cada cambio justamente para poder decidir esto sin mirar relojes.
  if (anterior && anterior.version > perfil.version) return
  perfiles.set(perfil.clave, perfil)
  alEspejo(() => guardarPerfil(perfil))
  emitirATodas('perfiles:cambiaron', null)
}

export function perfilesConocidos(): Perfil[] {
  return [...perfiles.values()]
}

export function perfilDe(clave: string): Perfil | null {
  return perfiles.get(clave) ?? null
}

/**
 * Al cerrar sesión: la lista se vuelve a recibir entera en el saludo de la sesión siguiente.
 *
 * Se vacía la memoria y NO el espejo: las caras tienen que seguir estando cuando el programa se abre
 * sin internet, que es justamente para lo que se guardan.
 */
export function olvidarLosPerfiles(): void {
  if (perfiles.size === 0) return
  perfiles.clear()
  emitirATodas('perfiles:cambiaron', null)
}
