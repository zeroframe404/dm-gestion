// La RAMA de una póliza de vehículo: auto, moto, pick up, camión, scooter, moto eléctrica o trailer.
//
// Vive en shared —como las sucursales, el semáforo y las pólizas— porque la lista tiene que ser LA
// MISMA en el proceso principal, en el importador y en las pantallas. Si cada lado arma la suya, un
// filtro ofrece siete opciones y otro nueve, y la diferencia se ve como filas que desaparecen sin
// explicación.
//
// Es una lista cerrada, igual que las cuatro sucursales, y por el mismo motivo: la planilla escribe
// «PICK UP», «PICKUP», «Pick-Up» y «CAMIONETA» para el mismo vehículo, y sin plegarlos el desplegable
// termina con cuatro opciones que son una sola y elegir una esconde las filas de las otras tres.
//
// OJO con la diferencia entre RAMA y CATEGORIA: la categoría (`CATEGORIAS_DE_VEHICULO` en tipos.ts)
// la decide el catálogo de vehículos y tiene quince valores de carrocería (SEDAN, HATCHBACK, SUV…);
// la rama es cómo vende la agencia, y son estas siete. Una es de la base, la otra es del mostrador.

import type { CategoriaDeVehiculo } from './tipos'

/** Las únicas ramas que existen, en el orden en que se ofrecen. */
export const RAMAS = ['AUTO', 'MOTO', 'PICK UP', 'CAMION', 'SCOOTER', 'MOTO ELÉCTRICA', 'TRAILER'] as const

export type Rama = (typeof RAMAS)[number]

/** Cómo se lee cada rama en pantalla. El valor guardado sigue siendo el de arriba, en mayúsculas. */
export const NOMBRE_RAMA: Record<Rama, string> = {
  AUTO: 'Auto',
  MOTO: 'Moto',
  'PICK UP': 'Pick up',
  CAMION: 'Camión',
  SCOOTER: 'Scooter',
  'MOTO ELÉCTRICA': 'Moto eléctrica',
  TRAILER: 'Trailer',
}

/**
 * Forma para comparar: mayúsculas, sin tildes, sin puntuación ni espacios. «pick up», «PICK-UP» y
 * «PickUp» dan la misma clave, y «MOTO ELECTRICA» empata con «MOTO ELÉCTRICA» aunque a la planilla se
 * le haya escapado la tilde. Se compara acá y nunca en el SQL, por lo mismo que las sucursales:
 * `UPPER()` y `COLLATE NOCASE` de SQLite sólo tocan el ASCII, así que `UPPER('ELÉCTRICA')` devuelve
 * `'ELéCTRICA'` y no empata con el «ELECTRICA» de la hoja.
 */
export function claveDeRama(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

/**
 * Las otras maneras de escribir la misma rama. Salen de lo que realmente trae la hoja de Google y de
 * las palabras que ya usa `src/main/vehiculos/mapeo.ts` para deducir la categoría del catálogo.
 *
 * Las de carrocería (SEDAN, HATCHBACK, SUV…) caen todas en AUTO a propósito: para el catálogo son
 * quince cosas distintas, para el mostrador son un auto. Lo que NO está acá —FURGON, MICRO,
 * CUATRICICLO, BICICLETA, HOGAR— queda afuera del catálogo por elección: inventarles una rama que la
 * agencia no vende es peor que dejarlas listadas aparte, que es lo que hace `ramasParaElegir`.
 */
const SINONIMOS: Record<string, Rama> = {
  // Auto
  AUTOMOVIL: 'AUTO',
  AUTOMOVILES: 'AUTO',
  AUTOS: 'AUTO',
  COCHE: 'AUTO',
  SEDAN: 'AUTO',
  HATCHBACK: 'AUTO',
  COUPE: 'AUTO',
  CABRIOLET: 'AUTO',
  RURAL: 'AUTO',
  MONOVOLUMEN: 'AUTO',
  SUV: 'AUTO',
  // Moto
  MOTOS: 'MOTO',
  MOTOCICLETA: 'MOTO',
  MOTOCICLETAS: 'MOTO',
  MOTOVEHICULO: 'MOTO',
  // Pick up. «Camioneta» es pick up en la calle argentina y así lo resuelve mapeo.ts desde la Fase 10.
  CAMIONETA: 'PICK UP',
  CAMIONETAS: 'PICK UP',
  PICKUPS: 'PICK UP',
  'DOBLE CABINA': 'PICK UP',
  // Camión
  CAMIONES: 'CAMION',
  CHASIS: 'CAMION',
  TRACTOR: 'CAMION',
  VOLCADOR: 'CAMION',
  // Scooter
  SCOOTERS: 'SCOOTER',
  CICLOMOTOR: 'SCOOTER',
  // Moto eléctrica
  'MOTO ELECTRICA': 'MOTO ELÉCTRICA',
  'MOTOS ELECTRICAS': 'MOTO ELÉCTRICA',
  'MOTO E': 'MOTO ELÉCTRICA',
  ELECTRICA: 'MOTO ELÉCTRICA',
  // Trailer
  TRAILERS: 'TRAILER',
  TRAILA: 'TRAILER',
  ACOPLADO: 'TRAILER',
  REMOLQUE: 'TRAILER',
  'CASA RODANTE': 'TRAILER',
}

const POR_CLAVE = new Map<string, Rama>([
  ...RAMAS.map((nombre) => [claveDeRama(nombre), nombre] as const),
  ...Object.entries(SINONIMOS).map(([alias, nombre]) => [claveDeRama(alias), nombre] as const),
])

/**
 * La rama que nombra ese texto, escrita como la escribe el catálogo, o null si el texto no es ninguna
 * de las siete. «PICKUP», «Pick-Up» y «CAMIONETA» devuelven las tres «PICK UP».
 */
export function ramaCanonica(texto: unknown): Rama | null {
  const clave = claveDeRama(texto)
  if (!clave) return null
  return POR_CLAVE.get(clave) ?? null
}

/**
 * La rama que le corresponde a una categoría del catálogo de vehículos, o null cuando el catálogo dice
 * algo que la agencia no vende por separado (FURGON, MICRO, CUATRICICLO) o no dice nada.
 *
 * Sólo se usa para AFINAR: ver `ramaDeVehiculo`.
 */
function ramaDeCategoria(categoria: CategoriaDeVehiculo | string | null | undefined): Rama | null {
  switch (claveDeRama(categoria)) {
    case 'PICKUP':
      return 'PICK UP'
    case 'CAMION':
      return 'CAMION'
    case 'SCOOTER':
      return 'SCOOTER'
    default:
      return null
  }
}

/** Las ramas que son un auto o derivan de uno, y las que son una moto. Se usan para afinar sin cruzarse. */
const FAMILIA: Record<Rama, 'auto' | 'moto' | 'otro'> = {
  AUTO: 'auto',
  'PICK UP': 'auto',
  CAMION: 'auto',
  MOTO: 'moto',
  SCOOTER: 'moto',
  'MOTO ELÉCTRICA': 'moto',
  TRAILER: 'otro',
}

/**
 * La rama de una fila de la planilla, mirando primero lo que dice el tipo y después la categoría del
 * catálogo.
 *
 * El orden importa y es a propósito:
 *
 *  1. **Gana el tipo** cuando ya nombra una rama concreta. Es lo que escribió la agencia en la hoja
 *     («PICK UP», «TRAILER», «MOTO ELECTRICA») y nadie la conoce mejor que ella.
 *  2. **Afina la categoría** cuando el tipo es genérico. Una pick up cargada desde «Nueva póliza» sale
 *     del catálogo con `tipo = 'AUTO'` y `categoria = 'PICKUP'`: sin este paso, el filtro «Pick up»
 *     encontraría sólo las que vinieron tipeadas de la hoja y ninguna de las cargadas en la aplicación
 *     —cero filas y ninguna explicación, que es exactamente el problema que ya tuvieron las sucursales.
 *  3. **Nunca cruza familias.** Un AUTO puede afinarse a PICK UP o CAMION, y una MOTO a SCOOTER; una
 *     categoría de moto jamás convierte a un auto en scooter aunque el dato venga mezclado.
 *
 * Devuelve null cuando el vehículo no es de ninguna de las siete ramas (un HOGAR, una BICICLETA, un
 * FURGON, o la fila que directamente no tiene vehículo cargado).
 */
export function ramaDeVehiculo(tipo: unknown, categoria?: CategoriaDeVehiculo | string | null): Rama | null {
  const porTipo = ramaCanonica(tipo)
  if (porTipo && porTipo !== 'AUTO' && porTipo !== 'MOTO') return porTipo

  const afinada = ramaDeCategoria(categoria)
  if (afinada && (porTipo === null || FAMILIA[afinada] === FAMILIA[porTipo])) return afinada

  return porTipo
}

/** true si los dos textos nombran la misma rama. Fuera del catálogo se comparan por clave, así que un texto que nadie reconoce sigue empatando consigo mismo en vez de perderse. */
export function mismaRama(a: unknown, b: unknown): boolean {
  const canonicaA = ramaCanonica(a)
  const canonicaB = ramaCanonica(b)
  if (canonicaA && canonicaB) return canonicaA === canonicaB
  if (canonicaA || canonicaB) return false
  return claveDeRama(a) === claveDeRama(b)
}

/**
 * Las opciones del desplegable de rama: las siete siempre, más lo que la base tenga y el catálogo no
 * conozca, sin repetir. Es el mismo trato que `sucursalesParaElegir` les da a las sucursales: la lista
 * cerrada nunca se achica —aunque el mes que se está mirando no tenga ninguna moto— y lo que quedó
 * fuera del catálogo sigue siendo elegible en vez de desaparecer del filtro.
 */
export function ramasParaElegir(deLaBase: Iterable<string | null | undefined>): string[] {
  const vistas = new Set<string>()
  const sueltas: string[] = []
  for (const valor of deLaBase) {
    const texto = (valor ?? '').trim()
    if (!texto) continue
    // Los sinónimos se pliegan ANTES de comparar: un «CAMIONETA» de la hoja ya está en la lista bajo
    // «PICK UP», y agregarlo aparte dejaría dos opciones para el mismo vehículo. Es exactamente lo que
    // pasaba con «AVELLANEDA» y «Dock Sud» antes de que las sucursales fueran una lista cerrada.
    if (ramaCanonica(texto)) continue
    const clave = claveDeRama(texto)
    if (!clave || vistas.has(clave)) continue
    vistas.add(clave)
    sueltas.push(texto)
  }
  return [...RAMAS, ...sueltas.sort((a, b) => a.localeCompare(b, 'es'))]
}

/** «AUTO, MOTO, PICK UP, CAMION, SCOOTER, MOTO ELÉCTRICA o TRAILER», para los mensajes que enumeran el catálogo. */
export function ramasEnTexto(): string {
  return `${RAMAS.slice(0, -1).join(', ')} o ${RAMAS[RAMAS.length - 1]}`
}
