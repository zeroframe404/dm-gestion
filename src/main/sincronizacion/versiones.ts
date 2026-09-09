// Lo que esta computadora sabe de la hoja del servidor: en qué versión vio cada pestaña, y de qué
// generación. Es el mapa que se compara contra la foto que manda el canal en vivo (ver vivo/grilla.ts).
//
// Vive en memoria del proceso principal y NO en SQLite, a propósito. Si el programa se reinicia el
// mapa arranca vacío, el servidor contesta «todo es novedad» y se hace una bajada: que es exactamente
// lo que uno quiere al arrancar. Guardarlo en la base sólo agregaría una forma de quedarse pegado a
// un mapa viejo después de una restauración.
/** El mapa `{titulo: version}` tal como lo contestó el servidor la última vez que bajamos bien. */
let conocidas: Record<string, number> = {}
let generacion: number | null = null

export function versionesConocidas(): Record<string, number> {
  return { ...conocidas }
}

export function generacionConocida(): number | null {
  return generacion
}

/** Al arrancar y en la primera vuelta: ¿ya sabemos algo, o esto es una hoja en blanco? */
export function elMapaEstaVacio(): boolean {
  return generacion === null
}

/**
 * Adopta lo que contestó el servidor.
 *
 * Con `soloEstos` se adoptan nada más esos títulos: es lo que se usa cuando se pudieron bajar unas
 * pestañas y otras no. Adoptar una pestaña que NO se llegó a bajar sería decir «ya la tengo» sin
 * tenerla, y ese cambio no se volvería a pedir nunca (hasta la 13.x lo rescataba el reloj de red de
 * los cinco minutos; desde la 14.0 no hay reloj que lo rescate, ver vivo/grilla.ts).
 *
 * Los títulos que ya no están en la respuesta se olvidan: la pestaña se borró del servidor y no hay
 * nada que bajar de ella.
 */
export function adoptarVersiones(
  versiones: Record<string, number>,
  generacionNueva: number,
  soloEstos?: string[],
): void {
  if (soloEstos) {
    const nuevas = { ...conocidas }
    // Lo que el servidor ya no tiene se va del mapa, se haya bajado o no.
    for (const titulo of Object.keys(nuevas)) {
      if (!(titulo in versiones)) delete nuevas[titulo]
    }
    for (const titulo of soloEstos) {
      if (titulo in versiones) nuevas[titulo] = versiones[titulo]
    }
    conocidas = nuevas
  } else {
    conocidas = { ...versiones }
  }
  generacion = generacionNueva
}

/**
 * Adopta la versión que dejó una escritura NUESTRA, para no bajarnos la pestaña entera y no encontrar
 * nada. Sin esto, cada vez que alguien tipea una celda su propia computadora se despierta sola y se
 * baja la planilla del mes completa —dos mil y pico de renglones— para comparar huellas que ya sabe
 * que coinciden.
 *
 * La guarda del `+1` es lo que hace que esto sea correcto y no sutilmente roto. Si la versión que nos
 * devolvieron es la que sigue a la que conocíamos, nadie más escribió esa pestaña en el medio y
 * podemos darla por vista. Si el salto es mayor, entre nuestra lectura y nuestra escritura escribió
 * otra computadora: adoptarla nos haría perder ese cambio para siempre. Pasa de verdad, con dos
 * mostradores cargando pagos del mismo mes.
 *
 * Y si no conocíamos la pestaña, no se adopta: no hay contra qué comparar.
 */
export function adoptarVersionPropia(titulo: string, version: number | null | undefined): void {
  if (typeof version !== 'number' || !Number.isFinite(version)) return
  const anterior = conocidas[titulo]
  if (anterior === undefined || version !== anterior + 1) return
  conocidas[titulo] = version
}

/** Al cerrar sesión, al cambiar de servidor, o cuando la generación dice que la hoja se reemplazó. */
export function olvidarVersiones(): void {
  conocidas = {}
  generacion = null
}

/** Sólo para el banco de pruebas: mirar el mapa sin pasar por el servidor. */
export interface EstadoDeVersiones {
  versiones: Record<string, number>
  generacion: number | null
}

export function estadoDeVersiones(): EstadoDeVersiones {
  return { versiones: versionesConocidas(), generacion }
}
