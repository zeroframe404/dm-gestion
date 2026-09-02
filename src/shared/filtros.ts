// Lo que comparten todos los filtros de todas las pantallas desde que dejaron de ser «un valor» para
// pasar a ser «una lista de valores».
//
// Vive en shared porque las dos puntas tienen que estar de acuerdo: el renderer arma la lista y el
// proceso principal la aplica, y si cada lado decidiera por su cuenta qué es una lista vacía o cómo se
// comparan dos textos, un filtro traería filas que otro esconde.
//
// La regla, una sola y en todos lados: **la lista vacía es «todas»**. Es exactamente lo que antes
// significaba el `''` de un desplegable de un solo valor, así que una pantalla que todavía no elige
// nada sigue mostrando todo.

/** Sin tildes, sin mayúsculas y sin puntuación: «Río Uruguay» empata con «RIO URUGUAY». */
export function normalizarParaFiltro(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

/**
 * Lo que llegó por IPC pasado a una lista de textos limpios, sin vacíos y sin repetidos.
 *
 * Acepta también un texto suelto a propósito: los filtros viajaban como `string` y una computadora
 * puede quedar con una versión anterior mientras se actualiza el resto. Un `'ATM'` sigue significando
 * «sólo ATM» y no rompe nada; `''`, `null` y `[]` significan los tres «todas».
 */
export function listaDeFiltro(valor: unknown): string[] {
  const crudos = Array.isArray(valor) ? valor : valor === null || valor === undefined ? [] : [valor]
  const vistos = new Set<string>()
  const lista: string[] = []
  for (const crudo of crudos) {
    if (typeof crudo !== 'string' && typeof crudo !== 'number') continue
    const texto = String(crudo).trim()
    if (!texto || vistos.has(texto)) continue
    vistos.add(texto)
    lista.push(texto)
  }
  return lista
}

/**
 * Lo mismo para los filtros que eligen números (los ids de responsable de Tareas, los días del mes de
 * Deudores): enteros, sin repetidos y en orden. Lo que no sea un entero se descarta en silencio, que es
 * lo que ya hacía cada pantalla por su cuenta.
 */
export function numerosDeFiltro(valor: unknown): number[] {
  const crudos = Array.isArray(valor) ? valor : valor === null || valor === undefined || valor === '' ? [] : [valor]
  const vistos = new Set<number>()
  for (const crudo of crudos) {
    const numero = Number(crudo)
    if (Number.isInteger(numero)) vistos.add(numero)
  }
  return [...vistos].sort((a, b) => a - b)
}

/**
 * true si los dos textos son el mismo una vez plegados. Es la comparación por defecto de los filtros
 * **del renderer**, donde cada pantalla ya tenía su `normalizar` que borra la puntuación entera.
 *
 * En el proceso principal, en cambio, la comparación de siempre es `mismoTexto` de
 * `src/main/importacion/normalizar.ts`, que deja un espacio donde estaba la puntuación en vez de
 * borrarla: para ése «RIO URUGUAY» y «RIOURUGUAY» son dos compañías distintas, y para éste son la
 * misma. La diferencia es chica pero real, así que **cada lado sigue usando el suyo**: pasarle a
 * `coincideAlguno` el comparador que la pantalla o el servicio ya usaba es lo único que garantiza que
 * elegir de a varios traiga exactamente las mismas filas que elegir de a uno.
 */
export function mismoTextoDeFiltro(a: unknown, b: unknown): boolean {
  return normalizarParaFiltro(a) === normalizarParaFiltro(b)
}

/**
 * true si el filtro no filtra (lista vacía) o si alguno de los elegidos empata con el valor de la fila.
 *
 * `iguales` es la comparación, y no siempre es la misma: la sucursal usa `mismaSucursal` —que sabe que
 * «AVELLANEDA» es Dock Sud—, la rama usa `mismaRama`, y el resto se compara con `mismoTextoDeFiltro`.
 */
export function coincideAlguno(
  elegidos: readonly string[] | undefined | null,
  valor: unknown,
  iguales: (elegido: string, valor: unknown) => boolean = mismoTextoDeFiltro,
): boolean {
  if (!elegidos || elegidos.length === 0) return true
  return elegidos.some((elegido) => iguales(elegido, valor))
}
