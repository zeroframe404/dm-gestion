// Reglas de la vista: los pasos del zoom y qué columnas se ven en una tabla.
//
// Está separado de `preferencias.ts` a propósito: acá adentro no se toca `window` ni `localStorage`,
// así que la lógica se puede probar en Node (`pruebas/vista.prueba.ts`) sin simular un navegador.
// El archivo de al lado es el que guarda y el que aplica; éste es el que decide.

/**
 * Los pasos del zoom, de más chico a más grande. Son pasos y no un número libre porque el zoom se
 * maneja con dos botones y con Ctrl y la rueda: hace falta saber cuál es «el siguiente».
 *
 * El rango sale de las dos computadoras que conviven en la agencia: la del mostrador es una notebook
 * de 14" donde la planilla del mes entra justa —ahí se baja—, y en la oficina hay un monitor grande
 * mirado desde lejos, donde 100 % se lee chico —ahí se sube—.
 */
export const ESCALAS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

/** El tamaño de siempre: lo que devuelve «Ctrl + 0» y el botón del medio. */
export const ESCALA_NORMAL = 1

/** El paso más parecido a un número cualquiera. Sirve para sanear lo que quedó guardado. */
export function escalaMasCercana(valor: number): number {
  if (!Number.isFinite(valor)) return ESCALA_NORMAL
  let mejor = ESCALAS[0]!
  for (const escala of ESCALAS) {
    if (Math.abs(escala - valor) < Math.abs(mejor - valor)) mejor = escala
  }
  return mejor
}

/** Un paso más grande. En el tope se queda en el tope: los botones no se rompen, se apagan. */
export function escalaSiguiente(actual: number): number {
  const indice = ESCALAS.indexOf(escalaMasCercana(actual))
  return ESCALAS[Math.min(indice + 1, ESCALAS.length - 1)]!
}

/** Un paso más chico. Ídem: en el piso se queda en el piso. */
export function escalaAnterior(actual: number): number {
  const indice = ESCALAS.indexOf(escalaMasCercana(actual))
  return ESCALAS[Math.max(indice - 1, 0)]!
}

/**
 * Interpreta lo que quedó guardado en esta computadora. Cualquier cosa que no sea un número usable
 * —vacío, texto, infinito, negativo— vuelve al tamaño de siempre.
 *
 * El caso del vacío no es teórico: `Number('')` es 0, y 0 acomodado al paso más cercano daría 70 %.
 * Una preferencia a medio escribir no puede abrir la ventana chiquita.
 */
export function escalaGuardada(texto: string | null): number {
  if (texto === null || texto.trim() === '') return ESCALA_NORMAL
  const numero = Number(texto)
  if (!Number.isFinite(numero) || numero <= 0) return ESCALA_NORMAL
  return escalaMasCercana(numero)
}

/**
 * Cuánto hay que juntar con la rueda para que valga un paso de zoom.
 *
 * Sin esto, un paso por evento: con el mouse está bien —una muesca es un evento de ~100 px— pero en el
 * touchpad de la notebook, que es la máquina del caso, Chromium manda el pellizco como decenas de
 * eventos de Ctrl + rueda de unos pocos píxeles cada uno. Un solo gesto recorría los nueve pasos y
 * terminaba en el extremo.
 */
export const RUEDA_POR_PASO = 100

/**
 * Suma un evento de rueda a lo que venía juntado y dice si hay que moverse: 1 agranda, -1 achica, 0 no
 * hace nada todavía. Cuando se mueve, el acumulado vuelve a cero, así una vuelta larga no deja resto
 * para el gesto siguiente.
 *
 * `delta` viene de `WheelEvent.deltaY`: negativo es rueda hacia arriba, que es agrandar.
 */
export function acumularRueda(acumulado: number, delta: number): { acumulado: number; paso: -1 | 0 | 1 } {
  if (!Number.isFinite(delta) || delta === 0) return { acumulado, paso: 0 }
  // Cambiar de sentido arranca de cero: si no, achicar después de agrandar tiene que remontar primero
  // todo lo que se había juntado para el otro lado.
  const base = Math.sign(acumulado) === -Math.sign(delta) ? 0 : acumulado
  const total = base + delta
  if (Math.abs(total) < RUEDA_POR_PASO) return { acumulado: total, paso: 0 }
  return { acumulado: 0, paso: total < 0 ? 1 : -1 }
}

/** «110 %», como se muestra en el botón del medio. */
export function comoPorcentaje(escala: number): string {
  return `${Math.round(escala * 100)} %`
}

// ---------------------------------------------------------------------------
// Columnas
// ---------------------------------------------------------------------------

/**
 * Lo mínimo que hace falta saber de una columna para poder esconderla. `ColumnaTabla` cumple con
 * esto y agrega el ancho y cómo se dibuja la celda, que acá no importan.
 */
export interface ColumnaElegible {
  id: string
  titulo: string
  /** No se puede esconder. Es el caso del nombre: sin él, la fila no se sabe de quién es. */
  siempre?: boolean
}

/**
 * Limpia la lista de escondidas contra las columnas que existen hoy.
 *
 * Hace falta porque la lista vive en esta computadora y las columnas viven en el programa: si una
 * versión nueva le cambia el id a una columna, o convierte en obligatoria una que alguien había
 * escondido, lo guardado quedaría escondiendo un fantasma —o peor, el nombre—. Se saca lo que ya no
 * existe y lo que no se puede esconder, y se devuelve ordenado para que dos listas iguales se
 * escriban igual.
 */
export function sanearOcultas(columnas: ColumnaElegible[], ocultas: readonly string[]): string[] {
  const escondibles = new Set(columnas.filter((columna) => !columna.siempre).map((columna) => columna.id))
  return [...new Set(ocultas)].filter((id) => escondibles.has(id)).sort()
}

/** Prende o apaga una columna. Una obligatoria no se apaga aunque se la pidan. */
export function alternarOculta(columnas: ColumnaElegible[], ocultas: readonly string[], id: string): string[] {
  const columna = columnas.find((candidata) => candidata.id === id)
  if (!columna || columna.siempre) return sanearOcultas(columnas, ocultas)
  const yaEstaba = ocultas.includes(id)
  return sanearOcultas(columnas, yaEstaba ? ocultas.filter((otra) => otra !== id) : [...ocultas, id])
}

/**
 * Las columnas que se dibujan, en el orden en que están declaradas.
 *
 * Si de tanto esconder no quedara ninguna, se devuelven todas: una tabla sin columnas es una pantalla
 * en blanco de la que no se sale más, y eso no puede pasar por una preferencia guardada.
 */
export function columnasVisibles<C extends ColumnaElegible>(columnas: C[], ocultas: readonly string[]): C[] {
  const escondidas = new Set(sanearOcultas(columnas, ocultas))
  const visibles = columnas.filter((columna) => !escondidas.has(columna.id))
  return visibles.length > 0 ? visibles : columnas
}
