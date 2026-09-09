// La foto y el color de cada persona de la agencia (14.0). Por ahora, apenas el buzón: guarda lo
// último que mandó el servidor y avisa a la pantalla.
//
// El perfil es de la PERSONA, no de la computadora: la clave es `claveDeUsuario(usuario)`, la misma
// identidad con la que viajan los mensajes y la presencia entre las cinco máquinas. El color es un
// índice 0-11 de la paleta y el servidor lo cuida único, así que dos personas nunca comparten glow.
//
// TODO (14.0, fase C1): esto se guarda además en la base local (migración 29, tabla `perfiles`), para
// que la foto se siga viendo al abrir el programa sin internet —«ver sí, tocar no» vale también para
// las caras— y para que la lista no dependa de que el canal esté arriba. Ahí aparecen
// `guardarPerfiles`/`perfilesLocales` en `usuarios/perfiles.ts` y los canales IPC `perfiles:*`.
import { emitirATodas } from '../servicios/avisos'
import type { Perfil } from './protocolo'

/** Lo último que llegó, por clave de usuario. */
const perfiles = new Map<string, Perfil>()

/** La lista entera, tal como vino adentro del saludo. */
export function recibirPerfiles(lista: Perfil[]): void {
  perfiles.clear()
  for (const perfil of lista) perfiles.set(perfil.clave, perfil)
  emitirATodas('perfiles:cambiaron', null)
}

/** Alguien cambió su foto o su color, acá o en otra computadora. */
export function recibirPerfil(perfil: Perfil): void {
  const anterior = perfiles.get(perfil.clave)
  // Una foto vieja no puede pisar a una nueva: los frames de dos computadoras pueden cruzarse, y el
  // servidor numera cada cambio justamente para poder decidir esto sin mirar relojes.
  if (anterior && anterior.version > perfil.version) return
  perfiles.set(perfil.clave, perfil)
  emitirATodas('perfiles:cambiaron', null)
}

export function perfilesConocidos(): Perfil[] {
  return [...perfiles.values()]
}

export function perfilDe(clave: string): Perfil | null {
  return perfiles.get(clave) ?? null
}

/** Al cerrar sesión: la lista se vuelve a recibir entera en el saludo de la sesión siguiente. */
export function olvidarLosPerfiles(): void {
  if (perfiles.size === 0) return
  perfiles.clear()
  emitirATodas('perfiles:cambiaron', null)
}
