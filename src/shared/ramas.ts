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
//
// La lista es configurable (Administración → Sucursales y ramas, ver `catalogos.ts`): lo de abajo describe la de
// fábrica, pero el código siempre lee la vigente.

import { claveDeCatalogo, RAMAS_DE_FABRICA, type FamiliaDeRama, type RamaConfigurada } from './catalogos'
import { esVehiculo } from './riesgos'
import type { CategoriaDeVehiculo } from './tipos'

/**
 * Las únicas ramas que existen, en el orden en que se ofrecen. Es la lista VIGENTE: arranca con las de fábrica y
 * `configurarRamas` la reemplaza EN EL LUGAR (mismo arreglo / mismo objeto), así que quien la importó sigue
 * viendo la lista actual. Se lee siempre en el momento de usarla, nunca se copia a una constante.
 */
const VIGENTES: string[] = []
export const RAMAS: readonly string[] = VIGENTES

export type Rama = string

/** Cómo se lee cada rama en pantalla. El valor guardado sigue siendo el de la lista, en mayúsculas. */
export const NOMBRE_RAMA: Record<string, string> = {}

/** Forma para comparar (ver `claveDeCatalogo`): «pick up», «PICK-UP» y «PickUp» dan la misma clave. */
export const claveDeRama = claveDeCatalogo

const FAMILIA: Record<string, FamiliaDeRama> = {}
const POR_CLAVE = new Map<string, string>()

/** Cambia las ramas vigentes. Los sinónimos de cada una (lo que escribe la hoja) se suman a la tabla de claves. */
export function configurarRamas(lista: readonly RamaConfigurada[]): void {
  VIGENTES.splice(0, VIGENTES.length, ...lista.map((r) => r.valor))
  for (const clave of Object.keys(NOMBRE_RAMA)) delete NOMBRE_RAMA[clave]
  for (const clave of Object.keys(FAMILIA)) delete FAMILIA[clave]
  POR_CLAVE.clear()
  for (const r of lista) {
    NOMBRE_RAMA[r.valor] = r.nombre
    FAMILIA[r.valor] = r.familia
    for (const alias of r.sinonimos) POR_CLAVE.set(claveDeRama(alias), r.valor)
  }
  // Los valores propios al final: si un sinónimo choca con un valor (no debería) gana el valor.
  for (const r of lista) POR_CLAVE.set(claveDeRama(r.valor), r.valor)
}

configurarRamas(RAMAS_DE_FABRICA)

/**
 * La rama que nombra ese texto, escrita como la escribe el catálogo, o null si el texto no es ninguna
 * de las siete. «PICKUP», «Pick-Up» y «CAMIONETA» devuelven las tres «PICK UP».
 */
export function ramaCanonica(texto: unknown): string | null {
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
  const deLaCategoria = (() => {
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
  })()
  // Si la agencia sacó esa rama de la lista, no se afina hacia una rama que ya no existe.
  return deLaCategoria && VIGENTES.includes(deLaCategoria) ? deLaCategoria : null
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

  // Un riesgo que NO es un vehículo se va sin rama, aunque tenga una categoría cargada. La fila de un
  // HOGAR o de una BICICLETA puede arrastrar la `categoria` del vehículo que esa póliza tenía antes:
  // sin este corte, afinar la convertía en una pick up y el filtro «Pick up» traía casas.
  if (!esVehiculo(tipo === null || tipo === undefined ? null : String(tipo))) return null

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

/** «AUTO, MOTO, PICK UP, CAMION, SCOOTER, MOTO ELÉCTRICA o TRAILER» (las vigentes), para los mensajes que enumeran el catálogo. */
export function ramasEnTexto(): string {
  if (RAMAS.length <= 1) return RAMAS.join('')
  return `${RAMAS.slice(0, -1).join(', ')} o ${RAMAS[RAMAS.length - 1]}`
}
