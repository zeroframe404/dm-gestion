// El tema, sin tocar el navegador.
//
// Vive en su propio archivo —sin `document`, sin `localStorage`, sin nada— por dos motivos. Uno: es
// lo único que el banco de pruebas necesita para comprobar que el valor que se escribe en el `<html>`
// es el mismo que espera `estilos.css`, y así puede hacerlo sin fingir un navegador entero. Dos: es
// EL dato que tiene que coincidir entre un archivo TypeScript y uno CSS, así que conviene que esté
// en un solo lugar y a la vista.
//
// La historia de por qué: el tema guardaba 'claro' / 'oscuro' y los escribía tal cual en el atributo,
// mientras el CSS estaba escrito contra `html[data-theme='dark']`. Nada falla al compilar —son dos
// mundos distintos— y el resultado fue una versión publicada con el botón del tema funcionando y la
// pantalla siempre blanca.

/** Cómo se llama el tema en el programa y en la preferencia guardada. */
export type Tema = 'claro' | 'oscuro'

export const TEMAS: readonly Tema[] = ['claro', 'oscuro']

/**
 * Cómo se llama el tema en el atributo `data-theme` del `<html>`.
 *
 * En inglés y no en castellano a propósito: son los valores que espera `estilos.css` y los que
 * entiende `color-scheme` para dar vuelta también los desplegables, los calendarios y las barras de
 * scroll que dibuja el sistema operativo.
 */
export const VALOR_EN_EL_ATRIBUTO: Record<Tema, string> = { claro: 'light', oscuro: 'dark' }
