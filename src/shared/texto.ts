// Contar y recortar texto sin romper emojis. Es puro y compartido (main, precarga y renderer) como
// `semaforo.ts` y `permisos.ts`: la pantalla cuenta lo que se escribió, el proceso principal valida lo
// que llega por IPC y los dos tienen que dar el mismo número.
//
// El problema que resuelve, que no es teórico. Una cadena de JavaScript son unidades UTF-16 de 16
// bits, y todo lo que está arriba de U+FFFF —o sea casi todos los emojis— se guarda como un PAR
// SUSTITUTO: dos unidades que solas no significan nada. Entonces:
//
//   '👍'.length            → 2      (dos unidades, no dos caracteres)
//   '👍'.slice(0, 1)       → '\uD83D'   media unidad suelta: se ve «▯» o «�»
//   '👨‍👩‍👧'.length          → 8      (tres personas y dos uniones invisibles)
//
// Un tope de largo aplicado con `.length` cuenta el doble en un mensaje de emojis, y un recorte con
// `.slice()` puede partir el par al medio y dejar guardado en la base un carácter que ya no es nada.
// Peor todavía: eso se ve recién en la computadora del otro, cuando el mensaje ya salió.
//
// La regla, entonces: NADA que toque un texto escrito por una persona usa `.length` ni `.slice()`.
// Todo pasa por acá, que recorre PUNTOS DE CÓDIGO con `Array.from` (el iterador de las cadenas de
// JavaScript ya sabe juntar los pares sustitutos).

/**
 * Cuántos caracteres tiene, como los contaría alguien mirando la pantalla: `'👍 dale'` son seis y no
 * siete.
 *
 * No cuenta grafemas: '👨‍👩‍👧' son tres puntos de código más dos uniones invisibles, o sea cinco, aunque
 * se dibuje como una sola figura. Contarlos de verdad pide `Intl.Segmenter`, que existe pero cuesta
 * bastante más; para un tope de 8.000 la diferencia no cambia nada y la garantía que importa —no
 * partir un par sustituto— se cumple igual.
 */
export function largoEnPuntos(texto: string): number {
  return Array.from(texto).length
}

/**
 * Recorta a `maximo` puntos de código. Nunca deja media unidad sustituta suelta.
 *
 * Una secuencia compuesta que caiga justo en el borde sí se puede separar en sus partes (un '👍🏽'
 * cortado al medio queda como '👍', un '👨‍👩‍👧' como '👨'), pero las partes siguen siendo caracteres
 * válidos y visibles. Lo que nunca sale de acá es el rombo con el signo de pregunta.
 */
export function recortarPorPuntos(texto: string, maximo: number): string {
  const puntos = Array.from(texto)
  return puntos.length <= maximo ? texto : puntos.slice(0, maximo).join('')
}

/** El tope del cuerpo de un mensaje, en puntos de código. Lo comparten la pantalla, el main y el VPS. */
export const MAXIMO_DE_UN_MENSAJE = 8000

/**
 * El cuerpo de un mensaje tal como se guarda.
 *
 * Le saca los caracteres de control —que no se ven, ensucian el log del superadministrador y a veces
 * llegan pegados desde un PDF— menos el salto de línea y el tabulador, normaliza a NFC (así una «é»
 * escrita con acento combinante y otra escrita con el carácter propio quedan iguales en la base y el
 * buscador las encuentra a las dos) y recorta al tope. Los espacios al final de cada renglón se caen:
 * nadie los escribió a propósito y hacen que dos mensajes iguales parezcan distintos.
 */
export function cuerpoDeMensajeLimpio(valor: unknown): string {
  const crudo = typeof valor === 'string' ? valor : ''
  const sinControles = Array.from(crudo)
    .filter((punto) => {
      if (punto === '\n' || punto === '\t') return true
      const codigo = punto.codePointAt(0) ?? 0
      return !(codigo <= 31 || (codigo >= 0x7f && codigo <= 0x9f))
    })
    .join('')
  return recortarPorPuntos(sinControles.normalize('NFC').replace(/[ \t]+$/gm, ''), MAXIMO_DE_UN_MENSAJE)
}

/**
 * La identidad de una persona compartida por las cinco computadoras: su usuario de ingreso, en
 * minúscula.
 *
 * Es el usuario y no el `id` de la tabla `usuarios` porque ese id es LOCAL —la misma persona tiene
 * números distintos en cada máquina— y tampoco es el `remoto_id` porque el servidor no tiene forma de
 * traducirlo: la lista de usuarios vive cifrada en `dmg_usuarios` y el VPS no la abre. Con el usuario,
 * el registro del superadministrador se lee solo («ana → beto») sin desencriptar nada.
 *
 * Va en minúscula porque la columna `usuarios.usuario` es `COLLATE NOCASE UNIQUE`: «Ana» y «ana» son
 * la misma persona en esta base y tienen que serlo también del otro lado.
 */
export function claveDeUsuario(valor: unknown): string {
  const crudo = typeof valor === 'string' ? valor : ''
  return crudo.trim().toLowerCase().normalize('NFC').slice(0, 120)
}

/**
 * El renglón que se muestra en la lista de conversaciones y en el aviso del sistema: una línea, sin
 * saltos y cortada donde entra.
 */
export function resumenDeMensaje(cuerpo: string, maximo = 80): string {
  const enUnaLinea = cuerpo.replace(/\s+/g, ' ').trim()
  const recortado = recortarPorPuntos(enUnaLinea, maximo)
  return recortado.length < enUnaLinea.length ? `${recortado}…` : recortado
}
