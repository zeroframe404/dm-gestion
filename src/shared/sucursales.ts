// Las cuatro sucursales de la agencia. Vive en shared, como el semáforo y las pólizas, porque la lista
// tiene que ser LA MISMA para el proceso principal, el importador y las pantallas: si cada lado arma su
// propia lista, un filtro ofrece cuatro opciones y otro cinco, y la diferencia se ve como filas que
// desaparecen sin explicación.
//
// La lista es cerrada a propósito. Antes el catálogo se sembraba con tres nombres y cualquier texto que
// llegara de la hoja de Google o del usuarios.json de GitHub podía crear una sucursal más; así aparecían
// «AVELLANEDA» y «Dock Sud» como dos locales distintos cuando son el mismo mostrador.

/**
 * La versión de demostración (Cobertia) se le entrega a otras empresas y no puede mostrar los
 * mostradores de la agencia: tiene los suyos, inventados. Se elige AL COMPILAR, no al arrancar, porque
 * la lista la leen las dos puntas desde el primer import (mucho antes de que la pantalla sepa el canal):
 * `scripts/dist-demo.mjs` y `npm run dev:demo` compilan con `DM_GESTION_DEMO=1`, y las configuraciones de
 * Vite del proceso principal y de la pantalla definen esta constante. En todo lo demás (la estable, la
 * beta, el banco de pruebas, tsc) no está definida y queda la lista de la agencia.
 */
declare const __SUCURSALES_DE_LA_DEMO__: boolean | undefined
const ES_LA_DEMO = typeof __SUCURSALES_DE_LA_DEMO__ !== 'undefined' && __SUCURSALES_DE_LA_DEMO__ === true

/** Los mostradores de la agencia, en el orden en que se ofrecen. */
export const SUCURSALES_DE_LA_AGENCIA = ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'] as const
/**
 * Los de la demo, en el mismo orden de papeles: los tres primeros son mostradores y el cuarto es la
 * cartera de un productor. Localidades del conurbano que el cotizador simulado conoce por código postal.
 */
export const SUCURSALES_DE_LA_DEMO = ['San Isidro', 'Morón', 'Pilar', 'Tigre'] as const

/** Las únicas sucursales que existen, en el orden en que se ofrecen. */
export const SUCURSALES: readonly NombreDeSucursal[] = ES_LA_DEMO ? SUCURSALES_DE_LA_DEMO : SUCURSALES_DE_LA_AGENCIA

export type NombreDeSucursal = (typeof SUCURSALES_DE_LA_AGENCIA)[number] | (typeof SUCURSALES_DE_LA_DEMO)[number]

/**
 * Forma para comparar: mayúsculas, sin tildes, sin puntuación ni espacios. «dock sud», «DOCKSUD» y
 * «Dock-Sud» dan la misma clave. Se compara acá y nunca en el SQL: `UPPER()` y `COLLATE NOCASE` de
 * SQLite sólo tocan el ASCII, así que `UPPER('Lanús')` devuelve `'LANúS'` y no empata con el «LANUS»
 * que escribe la planilla.
 */
export function claveDeSucursal(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

/**
 * Las otras formas de escribir la misma sucursal. La única que no se deduce de la clave es Avellaneda:
 * el mostrador de Dock Sud está en Avellaneda y la agencia lo nombra de las dos maneras, así que la
 * planilla y los usuarios viejos traen cualquiera de las dos.
 */
const SINONIMOS: Record<string, NombreDeSucursal> = ES_LA_DEMO ? {} : { AVELLANEDA: 'Dock Sud' }

const POR_CLAVE = new Map<string, NombreDeSucursal>([
  ...SUCURSALES.map((nombre) => [claveDeSucursal(nombre), nombre] as const),
  ...Object.entries(SINONIMOS).map(([alias, nombre]) => [claveDeSucursal(alias), nombre] as const),
])

/**
 * La sucursal de la agencia que ese texto nombra, escrita como la escribe el catálogo, o null si el
 * texto no es ninguna de las cuatro. «AVELLANEDA» y «DOCK SUD» devuelven las dos «Dock Sud».
 */
export function sucursalCanonica(texto: unknown): NombreDeSucursal | null {
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

/** «Dock Sud, Lanús, Sarandí o Daniel», para los mensajes que enumeran el catálogo. */
export function sucursalesEnTexto(): string {
  return `${SUCURSALES.slice(0, -1).join(', ')} o ${SUCURSALES[SUCURSALES.length - 1]}`
}
