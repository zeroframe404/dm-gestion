// El único lugar donde se decide qué es la categoría de un vehículo.
//
// La fuente es el catálogo maestro. Las filas viejas de la DNRPA traen la carrocería (SEDAN 5 PUERTAS,
// PICK-UP CABINA DOBLE, TODO TERRENO, MOTOCICLETA…); las de las APIs de las aseguradoras, no, y ahí
// la categoría sale de la descripción de la versión.
//
// La categoría es el dato que la agencia pidió que NO se pueda elegir, y con razón: de ella dependen
// la prima y qué coberturas se pueden emitir, y quien carga no tiene por qué saber si una Amarok es
// camioneta o pick-up. Cuando la tabla trae la carrocería, se traduce. Cuando no, se deduce de la descripción con
// una tabla de palabras —una Hilux dice «D/C» y «4x4», un Kangoo dice «furgón»— y, si tampoco alcanza,
// se devuelve null. Null y no «OTRO»: un «OTRO» inventado se ve igual que uno correcto y después
// nadie sabe cuál revisar.
import type { CategoriaDeVehiculo, TipoDeVehiculo } from '../../shared/tipos'

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
  [/\bMICRO\b|\bMINIBUS\b|\bMIDIBUS\b|\bCOLECTIVO\b|\bOMNIBUS\b|\bTRANS(PORTE)? DE PASAJEROS\b/, 'MICRO'],
  [/\bSUV\b|\bTODO TERRENO\b|\bCROSSOVER\b|\b4X4\b/, 'SUV'],
  [/\bMONOVOLUMEN\b|\bMINIVAN\b|\bMPV\b/, 'MONOVOLUMEN'],
  [/\bRURAL\b|\bFAMILIAR\b|\bSW\b|\bSTATION WAGON\b|\bWAGON\b|\bBREAK\b/, 'RURAL'],
  [/\bCABRIOLET\b|\bCABRIO\b|\bCONVERTIBLE\b|\bROADSTER\b|\bDESCAPOTABLE\b/, 'CABRIOLET'],
  [/\bCOUPE\b/, 'COUPE'],
  // La DNRPA llama «SEDAN 3/5 PUERTAS» a lo que en la calle es un hatchback (Gol Trend, 208, Onix);
  // el sedán de verdad es el de 4 puertas.
  [/\bHATCHBACK\b|\b3 P\b|\b5 P\b|\b3P\b|\b5P\b|\bSEDAN [235] PUERTAS\b/, 'HATCHBACK'],
  [/\bSEDAN\b|\b4 P\b|\b4P\b/, 'SEDAN'],
  // Al final, porque en Argentina «camioneta» se le dice a una pick-up y también a una SUV.
  [/\bCAMIONETA\b/, 'PICKUP'],
]

const PALABRAS_DE_MOTO: Array<[RegExp, CategoriaDeVehiculo]> = [
  [/\bSCOOTER\b|\bCICLOMOTOR\b|\bMOTONETA\b/, 'SCOOTER'],
  [/\bCUATRICICLO\b|\bCUATRIC\b|\bCUADRICICLO\b|\bATV\b|\bQUAD\b|\bARENERO\b/, 'CUATRICICLO'],
]

/**
 * La categoría de una versión, con la carrocería que trae la tabla y la descripción.
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
  // Primero la carrocería, que es más confiable que la descripción comercial.
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
