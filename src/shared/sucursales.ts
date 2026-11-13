import { claveDeCatalogo, SUCURSALES_DE_FABRICA, type SucursalConfigurada } from './catalogos'

// Las sucursales de la agencia. Vive en shared, como el semáforo y las pólizas, porque la lista
// tiene que ser LA MISMA para el proceso principal, el importador y las pantallas: si cada lado arma su
// propia lista, un filtro ofrece cuatro opciones y otro cinco, y la diferencia se ve como filas que
// desaparecen sin explicación.
//
// La lista es cerrada a propósito, pero configurable (Administración → Sucursales y ramas, ver `catalogos.ts`).
// Lo que sigue describe por qué es cerrada. Antes el catálogo se sembraba con tres nombres y cualquier texto que
// llegara de la hoja de Google o del usuarios.json de GitHub podía crear una sucursal más; así aparecían
// «AVELLANEDA» y «Dock Sud» como dos locales distintos cuando son el mismo mostrador.

/**
 * Las únicas sucursales que existen, en el orden en que se ofrecen. Es la lista VIGENTE: arranca con las de
 * fábrica y `configurarSucursales` la reemplaza EN EL LUGAR (mismo arreglo), así que quien la importó sigue
 * viendo la lista actual sin enterarse. Se lee siempre en el momento de usarla, nunca se copia a una constante.
 */
const VIGENTES: string[] = SUCURSALES_DE_FABRICA.map((s) => s.nombre)
export const SUCURSALES: readonly string[] = VIGENTES

export type NombreDeSucursal = string

/** Forma para comparar (ver `claveDeCatalogo`): «dock sud», «DOCKSUD» y «Dock-Sud» dan la misma clave. */
export const claveDeSucursal = claveDeCatalogo

const POR_CLAVE = new Map<string, string>()

/**
 * Cambia las sucursales vigentes. Los sinónimos (el nombre anterior de una sucursal renombrada, «Avellaneda»
 * para Dock Sud) se suman a la tabla de claves, así las filas con el nombre viejo se siguen leyendo bien.
 */
export function configurarSucursales(lista: readonly SucursalConfigurada[]): void {
  VIGENTES.splice(0, VIGENTES.length, ...lista.map((s) => s.nombre))
  POR_CLAVE.clear()
  for (const s of lista) for (const alias of s.sinonimos) POR_CLAVE.set(claveDeSucursal(alias), s.nombre)
  // Los nombres propios al final: si un sinónimo choca con un nombre (no debería, `normalizarCatalogos` lo evita) gana el nombre.
  for (const s of lista) POR_CLAVE.set(claveDeSucursal(s.nombre), s.nombre)
}

configurarSucursales(SUCURSALES_DE_FABRICA)

/**
 * La sucursal de la agencia que ese texto nombra, escrita como la escribe el catálogo, o null si el
 * texto no es ninguna de las vigentes. «AVELLANEDA» y «DOCK SUD» devuelven las dos «Dock Sud».
 */
export function sucursalCanonica(texto: unknown): string | null {
  const clave = claveDeSucursal(texto)
  if (!clave) return null
  return POR_CLAVE.get(clave) ?? null
}

/**
 * true si los dos textos nombran la misma sucursal. Fuera del catálogo se comparan por clave, así que
 * un texto que nadie reconoce sigue empatando consigo mismo en vez de perderse.
 */
export function mismaSucursal(a: unknown, b: unknown): boolean {
  const canonicaA = sucursalCanonica(a)
  const canonicaB = sucursalCanonica(b)
  if (canonicaA && canonicaB) return canonicaA === canonicaB
  if (canonicaA || canonicaB) return false
  return claveDeSucursal(a) === claveDeSucursal(b)
}

/**
 * El valor del filtro para los pagos y las filas sin ninguna sucursal asignada: no es una sucursal del
 * catálogo, nunca se guarda en la base, es sólo lo que ofrece el desplegable —cuando hace falta— y lo
 * que reconoce `mismaSucursalOVacia` para encontrarlas.
 *
 * El caso real es un cliente cargado sin sucursal: su cobro no tiene mostrador y `mismaSucursal` nunca
 * lo empata con nada, ni con una sucursal puntual ni (al elegir «todas las del catálogo», en vez de
 * dejar la lista vacía) con las demás. La fila queda sin ninguna opción que la traiga.
 */
export const SIN_SUCURSAL = 'Sin sucursal'

/**
 * Como `mismaSucursal`, pero entendiendo además el valor especial `SIN_SUCURSAL`: matchea cualquier
 * texto que no resuelva a ninguna sucursal. Sólo hace falta en los filtros que ofrecen `SIN_SUCURSAL`
 * como opción; en todo lo demás sigue valiendo `mismaSucursal`.
 */
export function mismaSucursalOVacia(elegido: unknown, valor: unknown): boolean {
  if (elegido === SIN_SUCURSAL) return claveDeSucursal(valor) === ''
  if (valor === SIN_SUCURSAL) return claveDeSucursal(elegido) === ''
  return mismaSucursal(elegido, valor)
}

/** El texto de la hoja pasado al nombre del catálogo. Lo que no es del catálogo se deja tal cual. */
export function normalizarNombreDeSucursal(texto: string): string {
  return sucursalCanonica(texto) ?? texto
}

/** «Dock Sud, Lanús, Sarandí o Daniel» (las vigentes), para los mensajes que enumeran el catálogo. */
export function sucursalesEnTexto(): string {
  if (SUCURSALES.length <= 1) return SUCURSALES.join('')
  return `${SUCURSALES.slice(0, -1).join(', ')} o ${SUCURSALES[SUCURSALES.length - 1]}`
}
