// Cómo se traduce la solicitud común a las listas de cada compañía.
//
// Cada aseguradora tiene sus propios códigos para todo —la forma de pago, la condición de IVA, la
// marca, la versión del vehículo— y los nombra a su manera. Esto las compara por lo que DICEN, no por
// el código: es lo único que tienen en común. Es puro a propósito (sin red, sin base), así se prueba
// solo en pruebas/multicotizador.prueba.ts y lo reusa cualquier adaptador que se sume.
import { normalizarTexto, type CondicionIva, type MedioDePago, type TipoDePersona, type UsoDelVehiculo } from '../../shared/multicotizador'

export interface OpcionDeLista {
  codigo: string
  descripcion: string
}

/**
 * Las palabras de un texto, listas para comparar: «1.8» y «1,8» quedan como «18» (si no, el punto las
 * partiría en dos palabras sueltas que coinciden con cualquier cosa), y se descartan las palabras de
 * relleno que no distinguen una versión de otra.
 */
export function palabras(texto: string): string[] {
  const conDecimales = texto.replace(/(\d)[.,](\d)/g, '$1$2')
  return normalizarTexto(conDecimales)
    .split(' ')
    .filter((palabra) => palabra && !RELLENO.has(palabra))
}

const RELLENO = new Set(['DE', 'DEL', 'LA', 'EL', 'Y', 'CON', 'C', 'S', 'P', 'SIN', 'X', 'L'])

/** Dos palabras son la misma si son iguales o si una es abreviatura de la otra (TRENDL / TRENDLINE). */
function mismaPalabra(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 3 || b.length < 3) return false
  return a.startsWith(b) || b.startsWith(a)
}

/**
 * Qué tan parecidos son dos textos, de 0 a 1: la proporción de palabras en común (coeficiente de
 * Dice). No mira el orden —«COROLLA 1.8 XEI» y «XEI 1.8 COROLLA» son lo mismo— porque cada catálogo
 * ordena las palabras de la versión como quiere.
 */
export function similitud(a: string, b: string): number {
  const pa = palabras(a)
  const pb = palabras(b)
  if (pa.length === 0 || pb.length === 0) return 0
  const usadas = new Set<number>()
  let comunes = 0
  for (const palabra of pa) {
    const indice = pb.findIndex((otra, i) => !usadas.has(i) && mismaPalabra(palabra, otra))
    if (indice >= 0) {
      usadas.add(indice)
      comunes += 1
    }
  }
  return (2 * comunes) / (pa.length + pb.length)
}

export interface Candidato<T> {
  opcion: T
  puntaje: number
}

/** Las opciones ordenadas de la más parecida a la menos, sin las que no se parecen en nada. */
export function rankear<T>(texto: string, opciones: T[], describir: (opcion: T) => string): Candidato<T>[] {
  return opciones
    .map((opcion) => ({ opcion, puntaje: similitud(texto, describir(opcion)) }))
    .filter((candidato) => candidato.puntaje > 0)
    .sort((a, b) => b.puntaje - a.puntaje)
}

/**
 * La opción que corresponde sin dudas, o null. «Sin dudas» es: se parece lo suficiente y le saca
 * ventaja a la segunda. Elegir mal una versión es cotizar otro vehículo —otra suma asegurada, otra
 * prima—, así que ante la duda se pregunta en vez de adivinar.
 */
export function sinDudas<T>(candidatos: Candidato<T>[], minimo = 0.5, ventaja = 0.1): T | null {
  const [primero, segundo] = candidatos
  if (!primero || primero.puntaje < minimo) return null
  if (segundo && primero.puntaje - segundo.puntaje < ventaja) return null
  return primero.opcion
}

/** Los nombres con que las compañías escriben las marcas que más cambian de un catálogo a otro. */
const ALIAS_DE_MARCA: Record<string, string> = {
  VW: 'VOLKSWAGEN',
  VOLKS: 'VOLKSWAGEN',
  GM: 'CHEVROLET',
  CHEVY: 'CHEVROLET',
  MB: 'MERCEDES BENZ',
  MERCEDES: 'MERCEDES BENZ',
  'M BENZ': 'MERCEDES BENZ',
  MERCEDESBENZ: 'MERCEDES BENZ',
  DS: 'DS AUTOMOBILES',
  LAND: 'LAND ROVER',
  LANDROVER: 'LAND ROVER',
  ALFA: 'ALFA ROMEO',
}

function marcaCanonica(nombre: string): string {
  const normalizada = normalizarTexto(nombre)
  return ALIAS_DE_MARCA[normalizada] ?? normalizada
}

/** La marca de la lista de una compañía que corresponde al nombre de la marca en la agencia. */
export function buscarMarca(nombre: string, marcas: OpcionDeLista[]): OpcionDeLista | null {
  const buscada = marcaCanonica(nombre)
  if (!buscada) return null
  const exacta = marcas.find((marca) => marcaCanonica(marca.descripcion) === buscada)
  if (exacta) return exacta
  return sinDudas(rankear(buscada, marcas, (marca) => marcaCanonica(marca.descripcion)), 0.8, 0.1)
}

/**
 * La opción de una lista que mejor responde a un conjunto de palabras clave (prefijos). Gana la que
 * tiene más; si ninguna tiene ninguna, null. Sirve para todas las listas cortas de las compañías —forma
 * de pago, condición de IVA, tipo de persona, uso—, que dicen lo mismo con palabras distintas.
 */
export function porPalabrasClave(opciones: OpcionDeLista[], claves: string[]): OpcionDeLista | null {
  let mejor: OpcionDeLista | null = null
  let mejorPuntaje = 0
  for (const opcion of opciones) {
    const suyas = palabras(opcion.descripcion)
    const puntaje = claves.filter((clave) => suyas.some((palabra) => palabra.startsWith(clave))).length
    if (puntaje > mejorPuntaje) {
      mejor = opcion
      mejorPuntaje = puntaje
    }
  }
  return mejor
}

export const CLAVES_MEDIO_DE_PAGO: Record<MedioDePago, string[]> = {
  TARJETA: ['TARJETA', 'CREDITO', 'VISA', 'MASTER', 'AMEX', 'AMERICAN', 'CABAL', 'NARANJA', 'DINERS'],
  DEBITO: ['DEBITO', 'CBU', 'CUENTA', 'BANCARI', 'AHORRO', 'AUTOMATICO'],
  EFECTIVO: ['EFECTIVO', 'CUPON', 'PAGOFACIL', 'FACIL', 'RAPIPAGO', 'CONTADO', 'CHEQUE', 'VENTANILLA', 'LIBRE', 'COBRADOR'],
}

export const CLAVES_CONDICION_IVA: Record<CondicionIva, string[]> = {
  CONSUMIDOR_FINAL: ['CONSUMIDOR', 'FINAL', 'CF'],
  MONOTRIBUTO: ['MONOTRIBUT', 'MONOT'],
  RESPONSABLE_INSCRIPTO: ['RESPONSABLE', 'INSCRIPTO', 'RI'],
  EXENTO: ['EXENT'],
}

export const CLAVES_TIPO_DE_PERSONA: Record<TipoDePersona, string[]> = {
  FISICA: ['FISIC'],
  JURIDICA: ['JURIDIC', 'EMPRESA', 'SOCIEDAD'],
}

export const CLAVES_USO: Record<UsoDelVehiculo, string[]> = {
  PARTICULAR: ['PARTICULAR', 'PRIVADO', 'PERSONAL'],
  COMERCIAL: ['COMERCIAL', 'TRABAJO', 'UTILITARIO', 'PROFESIONAL'],
}

/** La localidad de la lista que corresponde a la escrita; si hay una sola, ésa. */
export function buscarLocalidad<T>(nombre: string, localidades: T[], describir: (localidad: T) => string): T | null {
  if (localidades.length === 1) return localidades[0]!
  const buscada = normalizarTexto(nombre)
  if (!buscada) return null
  const exacta = localidades.find((localidad) => normalizarTexto(describir(localidad)) === buscada)
  if (exacta) return exacta
  return sinDudas(rankear(buscada, localidades, describir), 0.6, 0.15)
}

/** «B1870ABC», «1870» o «CP 1870» → «1870». Las compañías cotizan con los cuatro números. */
export function codigoPostalDeCuatro(valor: string): string {
  const digitos = valor.replace(/\D/g, '')
  return digitos.length >= 4 ? digitos.slice(0, 4) : digitos
}
