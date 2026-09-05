// Columnas que faltan en una pestaña (12.7).
//
// Hasta la 12.6, cuando la aplicación tenía que escribir un campo en una pestaña que no tenía columna
// para él, el dato se descartaba con un aviso en la bitácora («columna faltante»). Era exactamente el
// origen de los siniestros sin asegurado: la pestaña SINIESTROS de la agencia no tenía una columna que
// la aplicación reconociera como el nombre, la computadora que cargó el siniestro se lo quedaba en su
// base, y las otras cuatro lo importaban de la base compartida en blanco.
//
// Ahora la columna se AGREGA: el encabezado se escribe en la fila de encabezados de la pestaña, en la
// primera columna que esté vacía en todos los renglones, y la subida sigue en el mismo ciclo con la
// pestaña ya completa. Las otras computadoras, al bajar, ven que la fila de encabezados cambió y
// rehacen el mapeo antes de aplicar nada (`refrescarLayoutSiCambio`), así el dato nuevo cae en la
// columna correcta de su base sin esperar a que se relea la estructura ni a una importación completa.
import { encabezadoParaAgregar, mapearEncabezados, primeraColumnaLibre, type Campo } from '../importacion/encabezados'
import type { FuenteHoja } from '../importacion/fuente'
import { limpiar } from '../importacion/normalizar'
import { anotarEvento } from './cola'
import type { PestanaSincronizable } from './hoja'

/** Campos que nunca se agregan como columna: el _ID tiene su propio camino. */
const NO_SE_AGREGAN = new Set<string>(['_id'])

/**
 * Si la fila de encabezados de la pestaña ya no dice lo que decía cuando se leyó la estructura (otra
 * computadora agregó una columna), rehace el mapeo en el lugar. Devuelve true si cambió algo.
 *
 * Toca `pestana.layout` a propósito: el contexto de la hoja se cachea cinco minutos en el motor, y la
 * misma referencia la comparten `contexto.pestanas` y `contexto.porTitulo`, así que con esto queda al
 * día para todo lo que corra hasta la próxima relectura.
 */
export function refrescarLayoutSiCambio(pestana: PestanaSincronizable, valores: string[][]): boolean {
  const layout = pestana.layout
  if (!layout || layout.filaEncabezados < 0) return false
  const filaLeida = (valores[layout.filaEncabezados] ?? []).map((celda) => limpiar(celda))
  const conocida = layout.mapeo.encabezados.map((celda) => limpiar(celda))
  while (filaLeida.length > 0 && filaLeida[filaLeida.length - 1] === '') filaLeida.pop()
  while (conocida.length > 0 && conocida[conocida.length - 1] === '') conocida.pop()
  if (filaLeida.length === conocida.length && filaLeida.every((celda, i) => celda === conocida[i])) return false
  pestana.layout = { ...layout, mapeo: mapearEncabezados(valores[layout.filaEncabezados] ?? [], pestana.tipo) }
  return true
}

/** Primera columna que está vacía en la fila de encabezados Y en todos los renglones de abajo. */
function columnaLibre(valores: string[][], filaEncabezados: number): number {
  const encabezados = valores[filaEncabezados] ?? []
  let indice = primeraColumnaLibre(encabezados)
  const ancho = valores.reduce((maximo, fila) => Math.max(maximo, fila.length), 0)
  while (indice < ancho) {
    const libre = valores.every((fila, r) => r < filaEncabezados || limpiar(fila[indice]) === '')
    if (libre) break
    indice++
  }
  return indice
}

export interface ColumnaAgregada {
  pestana: string
  campo: Campo
  encabezado: string
  columna: number
}

/**
 * Cuántas veces se vuelve a intentar agregar una columna que otra computadora ganó en el mismo ciclo.
 * Dos computadoras que agregan a la vez pueden elegir la misma columna libre para títulos distintos:
 * el servidor traba la pestaña sólo mientras escribe, así que la última escritura pisa el título y la
 * otra escribía sus valores en esa columna creyendo que era su campo. Por eso, después de escribir,
 * la fila de encabezados se RELEE y sólo cuentan las columnas que dicen lo que se escribió.
 */
const REINTENTOS_POR_COLUMNA_PISADA = 2

/**
 * Agrega a la pestaña las columnas que hagan falta para escribir esos campos. Escribe los encabezados
 * en la hoja, los relee para confirmar que quedaron (ver `REINTENTOS_POR_COLUMNA_PISADA`), actualiza
 * `valores` (la fila de encabezados) y `pestana.layout` en el lugar con lo que la base tiene DE VERDAD,
 * y devuelve qué columnas quedaron confirmadas. Los campos que no se pueden titular de forma
 * reconocible no se agregan (quien llama los sigue tratando como «columna faltante»).
 *
 * Sólo trabaja sobre pestañas con fila de encabezados PROPIA: a una que usa el mapeo prestado de otra
 * (una BAJAS sin encabezados) no se le puede escribir un título en ningún lado.
 */
export async function agregarColumnasFaltantes(
  fuente: FuenteHoja,
  pestana: PestanaSincronizable,
  valores: string[][],
  campos: Iterable<Campo>,
  /**
   * Contador opcional de llamadas a la base, para la bitácora de cuota de quien llama: cada vuelta
   * gasta tres (asegurar las columnas, escribir los títulos y releerlos) y puede haber hasta tres
   * vueltas, así que la constante que usaba la subida se quedaba corta; y una vuelta que no confirmó
   * ninguna columna (otra computadora las ganó) también gastó cuota y antes se contaba como cero.
   */
  contadorDeLlamadas?: { llamadas: number },
): Promise<ColumnaAgregada[]> {
  const layout = pestana.layout
  if (!layout || layout.filaEncabezados < 0) return []
  const contar = () => {
    if (contadorDeLlamadas) contadorDeLlamadas.llamadas++
  }
  const filaEncabezados = layout.filaEncabezados
  const confirmadas: ColumnaAgregada[] = []
  const faltantes = new Set([...campos].filter((campo) => !NO_SE_AGREGAN.has(campo)))

  for (let vuelta = 0; vuelta <= REINTENTOS_POR_COLUMNA_PISADA && faltantes.size > 0; vuelta++) {
    // La fila de encabezados se completa en memoria a medida que se agregan, así dos campos de la
    // misma tanda no caen en la misma columna y el mapeo se calcula una sola vez por vuelta.
    const encabezados = [...(valores[filaEncabezados] ?? [])]
    const agregadas: ColumnaAgregada[] = []
    for (const campo of faltantes) {
      // Con el mapeo al día el campo puede tener columna (otra computadora la agregó): no hay nada que hacer.
      if (pestana.layout?.mapeo.porCampo.has(campo)) {
        faltantes.delete(campo)
        continue
      }
      const titulo = encabezadoParaAgregar(campo, pestana.tipo, encabezados)
      if (!titulo) {
        faltantes.delete(campo)
        continue
      }
      const columna = columnaLibre(valores, filaEncabezados)
      while (encabezados.length <= columna) encabezados.push('')
      encabezados[columna] = titulo
      if (!valores[filaEncabezados]) valores[filaEncabezados] = []
      const fila = valores[filaEncabezados]!
      while (fila.length <= columna) fila.push('')
      fila[columna] = titulo
      agregadas.push({ pestana: pestana.titulo, campo, encabezado: titulo, columna })
    }
    if (agregadas.length === 0) break

    const columnasNecesarias = Math.max(...agregadas.map((a) => a.columna)) + 1
    await fuente.asegurarColumnas(pestana.sheetId, columnasNecesarias)
    contar()
    await fuente.escribirCeldas(
      agregadas.map((a) => ({ titulo: pestana.titulo, fila: filaEncabezados + 1, columna: a.columna, valor: a.encabezado })),
    )
    contar()

    // Se relee la fila de encabezados tal como quedó en la base: si otra computadora escribió otro
    // título en la misma columna después que ésta, acá se ve. El mapeo se rehace con lo leído (así se
    // aprovechan también las columnas que agregó la otra) y lo que no quedó se vuelve a intentar en la
    // próxima columna libre. Si la lectura no trae la fila, no hay indicio de choque: vale lo escrito.
    const [lectura] = await fuente.leerVarias([pestana.titulo], filaEncabezados + 1)
    contar()
    const leida = lectura?.valores[filaEncabezados] ?? []
    const filaReal = leida.length > 0 ? [...leida] : encabezados
    valores[filaEncabezados] = filaReal
    pestana.layout = { ...layout, mapeo: mapearEncabezados(filaReal, pestana.tipo) }
    for (const a of agregadas) {
      if (limpiar(filaReal[a.columna]) !== limpiar(a.encabezado)) continue
      confirmadas.push(a)
      faltantes.delete(a.campo)
    }
  }

  for (const a of confirmadas) {
    anotarEvento('pestana', `La pestaña «${pestana.titulo}» no tenía columna para «${a.campo}»: se agregó «${a.encabezado}» al final, así el dato viaja a todas las computadoras.`)
  }
  return confirmadas
}
