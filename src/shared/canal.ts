// Canal del programa: «estable» (el de la agencia), «beta» (el que prueba el dueño antes de promoverlo)
// o «demo» (la versión de demostración para mostrarle el programa a otras agencias).
//
// El canal sale de la versión con la que se armó el instalador: la beta siempre lleva el sufijo
// `-beta.N` (p. ej. 17.7.3-beta.12), la demo el sufijo `-demo.N` y la estable ninguno. Así no hay un
// segundo dato que pueda quedar desparejo con el instalador: si el instalador es el de la beta, el
// programa se sabe beta.
export type Canal = 'estable' | 'beta' | 'demo'

/** Cómo se llama el programa en cada canal: carteles, título de la ventana, accesos directos. */
export const NOMBRE_ESTABLE = 'DM Gestión'
export const NOMBRE_BETA = 'DM Gestión (Beta)'
/**
 * La demo se vende con marca propia: no es «DM Gestión» (el programa de una agencia concreta) sino un
 * producto que cada agencia configura con su servidor. Logo en `recursos/demo/` y `renderer/componentes/LogoDeLaMarca.tsx`.
 */
export const MARCA_DEMO = 'Cobertia'
export const NOMBRE_DEMO = `${MARCA_DEMO} (Demo)`

/** `17.7.3-beta.12` es beta; `17.7.2` no. */
export function esVersionBeta(version: string): boolean {
  return /-beta(\.|$)/.test(version)
}

/** `17.7.3-demo.4` es la demo; `17.7.2` y `17.7.3-beta.4` no. */
export function esVersionDemo(version: string): boolean {
  return /-demo(\.|$)/.test(version)
}

export function nombreDelPrograma(canal: Canal): string {
  if (canal === 'beta') return NOMBRE_BETA
  if (canal === 'demo') return NOMBRE_DEMO
  return NOMBRE_ESTABLE
}

/**
 * La marca, sin el «(Beta)» ni el «(Demo)»: lo que va en el encabezado de la barra lateral, en «Acerca
 * de», en la portada del manual y en la ayuda impresa. La demo se presenta como Cobertia; la estable y la
 * beta siguen siendo DM Gestión (la beta se distingue con su insignia, no con el nombre).
 */
export function marcaDelPrograma(canal: Canal): string {
  return canal === 'demo' ? MARCA_DEMO : NOMBRE_ESTABLE
}
