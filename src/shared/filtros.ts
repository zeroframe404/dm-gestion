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
    // `Number(null)`, `Number('')` y `Number(false)` dan 0, y un 0 colado en la lista de responsables
    // sería «el usuario 0». Sólo entran los números y los textos que son un número.
    if (typeof crudo === 'number') {
      if (Number.isInteger(crudo)) vistos.add(crudo)
      continue
    }
    if (typeof crudo !== 'string' || crudo.trim() === '') continue
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

// ---------------------------------------------------------------------------
// Rangos de fecha (el filtro «desde – hasta» de cada listado: sugerencia #121)
// ---------------------------------------------------------------------------

const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Un límite de rango tal como llegó (por IPC o del estado de la pantalla) pasado a 'AAAA-MM-DD', o `''`
 * si no es una fecha: un límite mal formado no filtra, igual que uno vacío.
 */
export function limiteDeFecha(valor: unknown): string {
  if (typeof valor !== 'string') return ''
  const texto = valor.trim()
  return DIA_ISO.test(texto) ? texto : ''
}

/**
 * El día 'AAAA-MM-DD' de un valor de fecha de una fila. Acepta un día suelto ('2026-09-18') y una marca
 * de tiempo completa ('2026-09-18T23:30:00.000Z'): ésta se lleva al día **en hora local**, porque un
 * presupuesto creado a las 22 del 18 en la agencia está guardado como el 19 en UTC y se tiene que ver
 * como del 18. Cualquier otra cosa (una fecha escrita a mano, «a confirmar») devuelve null.
 */
export function diaDeFecha(valor: string | null | undefined): string | null {
  if (!valor) return null
  const texto = valor.trim()
  if (DIA_ISO.test(texto)) return texto
  if (!/^\d{4}-\d{2}-\d{2}T/.test(texto)) return null
  const instante = new Date(texto)
  if (Number.isNaN(instante.getTime())) return DIA_ISO.test(texto.slice(0, 10)) ? texto.slice(0, 10) : null
  const desplazado = new Date(instante.getTime() - instante.getTimezoneOffset() * 60_000)
  return desplazado.toISOString().slice(0, 10)
}

/**
 * true si la fecha de la fila cae dentro del rango, con las dos puntas incluidas. Cada límite es
 * opcional y vacío no filtra. Una fila sin esa fecha (o con una que no se entiende) queda afuera en
 * cuanto se pone algún límite: no hay forma de saber si entra o no.
 */
export function dentroDelRango(valor: string | null | undefined, desde: unknown, hasta: unknown): boolean {
  const inicio = limiteDeFecha(desde)
  const fin = limiteDeFecha(hasta)
  if (!inicio && !fin) return true
  const dia = diaDeFecha(valor)
  if (!dia) return false
  if (inicio && dia < inicio) return false
  if (fin && dia > fin) return false
  return true
}
