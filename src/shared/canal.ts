// Canal del programa: «estable» (el de la agencia) o «beta» (el que prueba el dueño antes de promoverlo).
//
// El canal sale de la versión con la que se armó el instalador: la beta siempre lleva el sufijo
// `-beta.N` (p. ej. 17.7.3-beta.12) y la estable nunca. Así no hay un segundo dato que pueda quedar
// desparejo con el instalador: si el instalador es el de la beta, el programa se sabe beta.
export type Canal = 'estable' | 'beta'

/** Cómo se llama el programa en cada canal: carteles, título de la ventana, accesos directos. */
export const NOMBRE_ESTABLE = 'DM Gestión'
export const NOMBRE_BETA = 'DM Gestión (Beta)'

/** `17.7.3-beta.12` es beta; `17.7.2` no. */
export function esVersionBeta(version: string): boolean {
  return /-beta(\.|$)/.test(version)
}

export function nombreDelPrograma(canal: Canal): string {
  return canal === 'beta' ? NOMBRE_BETA : NOMBRE_ESTABLE
}
