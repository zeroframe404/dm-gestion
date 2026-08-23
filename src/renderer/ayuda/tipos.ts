// Forma del contenido de ayuda contextual: una entrada por cada pantalla o pestaña que tiene botón de
// ayuda. Está pensado para gente de la agencia, no para quien programa: nada de nombres de tablas,
// columnas ni de archivos del código.

export interface SeccionDeAyuda {
  /** Subtítulo de un bloque de explicación dentro del modal. */
  titulo: string
  /** Uno o más párrafos de texto corrido. */
  parrafos: string[]
  /** Lista de puntos opcional, para pasos o ítems sueltos. */
  lista?: string[]
}

export interface ConceptoDeAyuda {
  termino: string
  explicacion: string
}

export interface ContenidoDeAyuda {
  /** Clave estable: la usa el botón de ayuda para encontrar este contenido. */
  clave: string
  /** Título del modal, por ejemplo «Cartera → Planilla del mes». */
  titulo: string
  /** Copete de una o dos frases, debajo del título. */
  resumen: string
  secciones: SeccionDeAyuda[]
  /** Glosario de los términos que conviene entender para esta pantalla. */
  conceptos?: ConceptoDeAyuda[]
}
