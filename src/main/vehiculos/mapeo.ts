// El único lugar donde se decide qué es la categoría de un vehículo.
//
// Está aparte del adaptador porque es lo más frágil de todo esto: si la cuenta real de la agencia
// devuelve un nombre de campo distinto al que esperábamos, se corrige acá y no en cuatro lugares.
//
// La categoría es el dato que la agencia pidió que NO se pueda elegir, y con razón: de ella dependen
// la prima y qué coberturas se pueden emitir, y quien carga no tiene por qué saber si una Amarok es
// camioneta o pick-up. Cuando la API la trae, se traduce. Cuando no, se deduce de la descripción con
// una tabla de palabras —una Hilux dice «D/C» y «4x4», un Kangoo dice «furgón»— y, si tampoco alcanza,
// se devuelve null. Null y no «OTRO»: un «OTRO» inventado se ve igual que uno correcto y después
// nadie sabe cuál revisar.
import type { CategoriaDeVehiculo, TipoDeVehiculo } from '../../shared/tipos'

/** Cómo se llama la categoría en la respuesta, según con qué endpoint y versión se hable. */
const CLAVES_DE_CATEGORIA = ['category', 'categoria', 'vehicle_type', 'body_type', 'tipo', 'segment', 'group_type']
const CLAVES_DE_DESCRIPCION = ['description', 'descripcion', 'name', 'nombre', 'full_name', 'model_description']
const CLAVES_DE_ANIO_DESDE = ['prices_from', 'year_from', 'anio_desde', 'from_year', 'start_year']
const CLAVES_DE_ANIO_HASTA = ['prices_to', 'year_to', 'anio_hasta', 'to_year', 'end_year']

export function primerTextoDe(crudo: Record<string, unknown>, claves: string[]): string {
  for (const clave of claves) {
    const valor = crudo[clave]
    if (typeof valor === 'string' && valor.trim()) return valor.trim()
    if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor)
    // A veces viene anidado: { category: { name: 'PICK UP' } }
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      const adentro = (valor as Record<string, unknown>).name ?? (valor as Record<string, unknown>).nombre
      if (typeof adentro === 'string' && adentro.trim()) return adentro.trim()
    }
  }
  return ''
}

export function primerNumeroDe(crudo: Record<string, unknown>, claves: string[]): number | null {
  for (const clave of claves) {
    const valor = crudo[clave]
    if (typeof valor === 'number' && Number.isFinite(valor)) return Math.trunc(valor)
    if (typeof valor === 'string' && /^\d{4}$/.test(valor.trim())) return Number(valor.trim())
  }
  return null
}

export function anioDesdeHasta(crudo: Record<string, unknown>): { desde: number | null; hasta: number | null } {
  return { desde: primerNumeroDe(crudo, CLAVES_DE_ANIO_DESDE), hasta: primerNumeroDe(crudo, CLAVES_DE_ANIO_HASTA) }
}

function normalizar(valor: string): string {
  return valor
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * De la palabra a la categoría. El orden importa: se recorre de arriba abajo y gana la primera que
 * aparezca, así que lo más específico va primero. «PICK UP» tiene que ganarle a «UP», y «CAMIONETA»
 * a secas es tan ambigua en la calle que va al final.
 */
const PALABRAS_DE_AUTO: Array<[RegExp, CategoriaDeVehiculo]> = [
  [/\bPICK ?UP\b|\bPICKUP\b|\bD C\b|\bDOBLE CABINA\b|\bCABINA SIMPLE\b|\bC S\b/, 'PICKUP'],
  [/\bFURGON\b|\bFURGONETA\b|\bVAN\b|\bUTILITARIO\b|\bCARGO\b/, 'FURGON'],
  [/\bCAMION\b|\bCHASIS\b|\bTRACTOR\b|\bVOLCADOR\b/, 'CAMION'],
  [/\bMICRO\b|\bMINIBUS\b|\bCOLECTIVO\b|\bOMNIBUS\b/, 'MICRO'],
  [/\bSUV\b|\bTODO TERRENO\b|\bCROSSOVER\b|\b4X4\b/, 'SUV'],
  [/\bMONOVOLUMEN\b|\bMINIVAN\b|\bMPV\b/, 'MONOVOLUMEN'],
  [/\bRURAL\b|\bFAMILIAR\b|\bSW\b|\bSTATION WAGON\b|\bWAGON\b|\bBREAK\b/, 'RURAL'],
  [/\bCABRIOLET\b|\bCABRIO\b|\bCONVERTIBLE\b|\bROADSTER\b|\bDESCAPOTABLE\b/, 'CABRIOLET'],
  [/\bCOUPE\b/, 'COUPE'],
  [/\bHATCHBACK\b|\b3 P\b|\b5 P\b|\b3P\b|\b5P\b/, 'HATCHBACK'],
  [/\bSEDAN\b|\b4 P\b|\b4P\b/, 'SEDAN'],
  // Al final, porque en Argentina «camioneta» se le dice a una pick-up y también a una SUV.
  [/\bCAMIONETA\b/, 'PICKUP'],
]

const PALABRAS_DE_MOTO: Array<[RegExp, CategoriaDeVehiculo]> = [
  [/\bSCOOTER\b|\bCICLOMOTOR\b/, 'SCOOTER'],
  [/\bCUATRICICLO\b|\bATV\b|\bQUAD\b/, 'CUATRICICLO'],
]

/**
 * La categoría de una línea, con lo que dijo la API y su descripción.
 *
 * Devuelve null cuando no se puede saber, y eso es a propósito: la pantalla muestra «sin determinar»
 * en vez de una categoría inventada, porque una categoría equivocada llega hasta la póliza.
 */
export function categoriaDeCatalogo(
  tipo: TipoDeVehiculo,
  categoriaCruda: string | null,
  descripcion: string,
): CategoriaDeVehiculo | null {
  const tabla = tipo === 'MOTO' ? PALABRAS_DE_MOTO : PALABRAS_DE_AUTO
  // Primero lo que dijo la API, que es más confiable que la descripción comercial.
  for (const fuente of [categoriaCruda ?? '', descripcion]) {
    const texto = normalizar(fuente)
    if (!texto) continue
    for (const [patron, categoria] of tabla) {
      if (patron.test(texto)) return categoria
    }
  }
  // Una moto que no es scooter ni cuatriciclo es simplemente una moto: ahí sí se sabe.
  if (tipo === 'MOTO') return 'MOTO'
  return null
}

/** La categoría cruda que trae el registro, si trae alguna. */
export function categoriaCrudaDe(crudo: Record<string, unknown>): string | null {
  return primerTextoDe(crudo, CLAVES_DE_CATEGORIA) || null
}

export function descripcionDe(crudo: Record<string, unknown>): string {
  return primerTextoDe(crudo, CLAVES_DE_DESCRIPCION)
}
