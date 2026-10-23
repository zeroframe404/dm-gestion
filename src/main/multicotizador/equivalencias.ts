// Cómo se traduce la solicitud común a las listas de cada compañía.
//
// Cada aseguradora tiene sus propios códigos para todo —la forma de pago, la condición de IVA, la
// marca, la versión del vehículo— y los nombra a su manera. Esto las compara por lo que DICEN, no por
// el código: es lo único que tienen en común. Es puro a propósito (sin red, sin base), así se prueba
// solo en pruebas/multicotizador.prueba.ts y lo reusa cualquier adaptador que se sume.
import {
  normalizarTexto,
  usoBasico,
  type AjusteDeAseguradora,
  type ClausulaDeAjuste,
  type CondicionIibb,
  type CondicionIva,
  type CuotasDeseadas,
  type Facturacion,
  type MedioDePago,
  type Rastreador,
  type TipoDePersona,
  type UsoDelVehiculo,
} from '../../shared/multicotizador'

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
  // «MANUAL» es «0 - PAGO MANUAL», la forma con la que cotiza por defecto la web de Galeno.
  EFECTIVO: ['EFECTIVO', 'CUPON', 'PAGOFACIL', 'FACIL', 'RAPIPAGO', 'CONTADO', 'CHEQUE', 'VENTANILLA', 'LIBRE', 'COBRADOR', 'MANUAL'],
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
  TAXI: ['TAXI'],
  REMIS: ['REMIS'],
  TRANSPORTE_DE_PASAJEROS: ['PASAJER', 'TRANSPORTE', 'ESPECIAL'],
  AUTOBOMBA: ['AUTOBOMBA', 'BOMBA', 'BOMBERO'],
  POLICIA: ['POLICI', 'PATRULL'],
  AMBULANCIA: ['AMBULANC', 'SANITARI'],
  AUXILIO_MECANICO: ['AUXILIO', 'MECANIC', 'REMOLQUE'],
  TRABAJO_RURAL: ['RURAL', 'AGRICOL', 'AGRO', 'CAMPO'],
  CASA_RODANTE: ['RODANTE', 'MOTORHOME', 'CASA'],
  TANQUE_ATMOSFERICO: ['ATMOSFERIC', 'DESAGOT', 'TANQUE'],
  CARGAS_PELIGROSAS: ['PELIGROS', 'INFLAMABL', 'QUIMIC'],
  ESCOLAR: ['ESCOLAR', 'ESCUELA'],
  TRANSPORTE_DE_BIENES: ['BIENES', 'CARGA', 'MERCADERI', 'REPARTO', 'TRANSPORTE'],
  PLATAFORMA: ['UBER', 'PLATAFORMA', 'APLICACION', 'APP', 'CABIFY', 'DIDI'],
}

/**
 * El uso de la lista de una compañía que corresponde al de la solicitud: el que tenga ese nombre (taxi,
 * remís, ambulancia…) y, si la compañía no lo distingue, el particular o el comercial de siempre.
 */
export function porUso(opciones: OpcionDeLista[], uso: UsoDelVehiculo): OpcionDeLista | null {
  const basico = usoBasico(uso)
  return (uso !== basico ? porPalabrasClave(opciones, CLAVES_USO[uso]) : null) ?? porPalabrasClave(opciones, CLAVES_USO[basico])
}

export const CLAVES_CONDICION_IIBB: Record<CondicionIibb, string[]> = {
  CONSUMIDOR_FINAL: ['CONSUMIDOR', 'FINAL', 'CF'],
  CONVENIO_MULTILATERAL: ['CONVENIO', 'MULTILATERAL'],
  EXENTO: ['EXENT'],
  LOCAL: ['LOCAL'],
  REGIMEN_SIMPLIFICADO: ['SIMPLIFICADO', 'REGIMEN'],
  RESPONSABLE_NO_INSCRIPTO: ['NO', 'RNI'],
}

/** Las marcas de rastreador como las escriben las compañías («LO JACK», «LOJACK», «ITURAN AVL»…). */
export const CLAVES_RASTREADOR: Record<Exclude<Rastreador, 'SIN_RASTREADOR'>, string[]> = {
  DE_LA_COMPANIA: ['COMPANIA', 'ASEGURADORA', 'CARGO', 'PROVIST'],
  OTRO: ['OTRO', 'GENERIC'],
  LO_JACK: ['LOJACK', 'JACK'],
  TRACER: ['TRACER'],
  POINTER: ['POINTER'],
  ITURAN: ['ITURAN'],
  UBICAR: ['UBICAR'],
}

/** El equipo de rastreo de la lista de una compañía que corresponde al de la solicitud, o null. */
export function porRastreador(opciones: OpcionDeLista[], rastreador: Rastreador): OpcionDeLista | null {
  return rastreador === 'SIN_RASTREADOR' ? null : porPalabrasClave(opciones, CLAVES_RASTREADOR[rastreador])
}

/** Los períodos de facturación, del más corto al más largo, con el prefijo con que se buscan. */
export const PERIODOS_DE_FACTURACION: Array<{ facturacion: Exclude<Facturacion, 'MEJOR_COSTO'>; prefijo: string }> = [
  { facturacion: 'MENSUAL', prefijo: 'MENSUAL' },
  { facturacion: 'BIMESTRAL', prefijo: 'BIMESTR' },
  { facturacion: 'TRIMESTRAL', prefijo: 'TRIMESTR' },
  { facturacion: 'CUATRIMESTRAL', prefijo: 'CUATRIMESTR' },
  { facturacion: 'SEMESTRAL', prefijo: 'SEMESTR' },
  { facturacion: 'ANUAL', prefijo: 'ANUAL' },
]

/**
 * Cada cuánto se factura lo que describe una opción: «ANUAL C/ REFACTURACIÓN TRIMESTRAL» es una póliza
 * anual que se factura por trimestre, así que cuenta el período que NO es el anual; «ANUAL» solo es
 * anual. Null si no nombra ninguno.
 */
export function periodoDeFacturacion(descripcion: string): Exclude<Facturacion, 'MEJOR_COSTO'> | null {
  const suyas = palabras(descripcion)
  const nombra = (prefijo: string) => suyas.some((palabra) => palabra.startsWith(prefijo))
  return PERIODOS_DE_FACTURACION.find((periodo) => periodo.facturacion !== 'ANUAL' && nombra(periodo.prefijo))?.facturacion ?? (nombra('ANUAL') ? 'ANUAL' : null)
}

/**
 * La primera opción (en el orden de la compañía) que factura con el período pedido. «Mejor costo» no
 * elige nada: cada compañía arranca en la suya.
 */
export function porFacturacion<T extends OpcionDeLista>(opciones: T[], facturacion: Facturacion): T | null {
  if (facturacion === 'MEJOR_COSTO') return null
  return opciones.find((opcion) => periodoDeFacturacion(opcion.descripcion) === facturacion) ?? null
}

/** En cuántas cuotas se paga lo que describe una opción («3 CUOTAS» → 3, «CONTADO» → 1), o null. */
export function cantidadDeCuotas(descripcion: string): number | null {
  const texto = normalizarTexto(descripcion)
  const numero = /\b(\d{1,2})\b/.exec(texto)
  if (numero) return Number(numero[1])
  return /\bCONTADO\b|\bUNIC[AO]\b|\bUNA CUOTA\b|\bUN PAGO\b/.test(texto) ? 1 : null
}

/**
 * La opción de una lista de cuotas que corresponde a lo pedido: la de esa cantidad exacta, o la de más
 * cuotas si se pidió la máxima. Null si no se pidió nada o la compañía no tiene esa cantidad.
 */
export function porCuotas<T extends OpcionDeLista>(opciones: T[], cuotas: CuotasDeseadas): T | null {
  if (cuotas === null) return null
  const conCantidad = opciones.map((opcion) => ({ opcion, cantidad: cantidadDeCuotas(opcion.descripcion) })).filter((o) => o.cantidad !== null)
  if (cuotas === 'MAXIMA') {
    let mejor: { opcion: T; cantidad: number | null } | null = null
    for (const candidata of conCantidad) if (!mejor || candidata.cantidad! > mejor.cantidad!) mejor = candidata
    return mejor?.opcion ?? null
  }
  return conCantidad.find((o) => o.cantidad === cuotas)?.opcion ?? null
}

/** Lo que se pidió de cuotas, como texto para atar a ello lo elegido a mano (ver `elegidoBajo`). */
export function claveDeCuotas(cuotas: CuotasDeseadas): string {
  return cuotas === null ? 'CADA_COMPANIA' : String(cuotas)
}

/**
 * La cláusula de ajuste de la lista de una compañía con el porcentaje pedido («AUTOMÁTICO 10 %»), o la
 * que dice que no hay cláusula si se pidió «No aplica». Null si la compañía no la tiene.
 */
export function porClausula<T extends OpcionDeLista>(opciones: T[], clausula: ClausulaDeAjuste): T | null {
  const numeros = (opcion: T) => [...normalizarTexto(`${opcion.descripcion}`).matchAll(/\b(\d{1,3})\b/g)].map((m) => m[1]!)
  if (clausula === '0') {
    return opciones.find((opcion) => /\bSIN\b|\bNO\b|\bNINGUN/.test(normalizarTexto(opcion.descripcion))) ?? opciones.find((opcion) => numeros(opcion).includes('0')) ?? null
  }
  return opciones.find((opcion) => numeros(opcion).includes(clausula)) ?? null
}

// --- Lo que arranca del formulario -------------------------------------------------------------------
//
// Muchos ajustes de cada compañía tienen su par en el formulario: la facturación, las cuotas, la forma
// de pago, la condición de IVA, el uso. La compañía arranca en lo que dice el formulario y en su tarjeta
// se puede afinar (elegir cuál de sus dos modos mensuales, por ejemplo). Lo afinado vale mientras el
// formulario siga diciendo lo mismo: por eso cada opción lleva adelante lo del formulario
// («MENSUAL|M12»). Si ahí se elige otra cosa, lo de antes deja de ser una opción y vuelve a mandar el
// formulario. Lo mismo pasa con lo guardado en esta computadora antes de que el formulario lo pidiera.

/** Lo elegido a mano en la tarjeta, si se eligió con el formulario diciendo lo mismo que ahora. */
export function elegidoBajo(elegido: string | undefined, delFormulario: string): string | undefined {
  const prefijo = `${delFormulario}|`
  return elegido?.startsWith(prefijo) ? elegido.slice(prefijo.length) : undefined
}

/** El ajuste con cada opción (y su valor) atada a lo que dice el formulario. Ver `elegidoBajo`. */
export function bajoElFormulario(delFormulario: string, ajuste: AjusteDeAseguradora): AjusteDeAseguradora {
  const atar = (valor: string) => (valor ? `${delFormulario}|${valor}` : '')
  return { ...ajuste, valor: atar(ajuste.valor), opciones: ajuste.opciones.map((opcion) => ({ ...opcion, valor: atar(opcion.valor) })) }
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
