// Los catálogos configurables: las sucursales de la agencia y las ramas de vehículo. Sin Electron ni Node:
// lo usan el proceso principal, la pantalla y el banco de pruebas.
//
// Antes eran dos listas fijas (cuatro sucursales, siete ramas) escritas en `sucursales.ts` y `ramas.ts`. Ahora
// esas listas son lo «de fábrica» y la agencia puede cambiarlas desde Administración → Sucursales y ramas. La
// lista sigue siendo CERRADA a propósito (lo que llega de la hoja o del servidor no crea opciones nuevas): lo
// que cambia es quién la decide.
//
// RENOMBRAR no toca ningún dato: el nombre viejo pasa a ser un sinónimo del nuevo, y como todo se compara por
// `sucursalCanonica` / `ramaCanonica` (nunca por texto), las filas que dicen «Lanús» se leen como «Lanús Centro»
// sin reescribir una sola.
//
// La versión normal (sin esta pantalla) ignora el ajuste y sigue con las listas de fábrica.

/** Cómo se agrupa una rama para afinarla con la categoría del catálogo de vehículos (ver `ramaDeVehiculo`). */
export type FamiliaDeRama = 'auto' | 'moto' | 'otro'

export interface SucursalConfigurada {
  /** El nombre tal como se guarda y se ve. */
  nombre: string
  /** Otras formas de escribir la misma sucursal (la hoja, usuarios viejos, el nombre anterior). */
  sinonimos: string[]
}

export interface RamaConfigurada {
  /** El valor guardado, en mayúsculas («PICK UP»). */
  valor: string
  /** Cómo se lee en pantalla («Pick up»). */
  nombre: string
  familia: FamiliaDeRama
  sinonimos: string[]
}

export interface Catalogos {
  sucursales: SucursalConfigurada[]
  ramas: RamaConfigurada[]
}

export const MAXIMO_DE_NOMBRE_DE_CATALOGO = 40
export const MAXIMO_DE_SINONIMOS = 20
export const MAXIMO_DE_SUCURSALES = 20
export const MAXIMO_DE_RAMAS = 30

/**
 * Forma para comparar: mayúsculas, sin tildes, sin puntuación ni espacios. «dock sud», «DOCKSUD» y «Dock-Sud»
 * dan la misma clave. Se compara acá y nunca en el SQL: `UPPER()` y `COLLATE NOCASE` de SQLite sólo tocan el
 * ASCII, así que `UPPER('Lanús')` devuelve `'LANúS'` y no empata con el «LANUS» que escribe la planilla.
 */
export function claveDeCatalogo(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

// ---------------------------------------------------------------------------
// Lo de fábrica
// ---------------------------------------------------------------------------

export const SUCURSALES_DE_FABRICA: readonly SucursalConfigurada[] = [
  // El mostrador de Dock Sud está en Avellaneda y la agencia lo nombra de las dos maneras.
  { nombre: 'Dock Sud', sinonimos: ['Avellaneda'] },
  { nombre: 'Lanús', sinonimos: [] },
  { nombre: 'Sarandí', sinonimos: [] },
  { nombre: 'Daniel', sinonimos: [] },
]

/**
 * Los sinónimos de las ramas salen de lo que realmente trae la hoja de Google y de las palabras que ya usa
 * `src/main/vehiculos/mapeo.ts` para deducir la categoría del catálogo.
 *
 * Las de carrocería (SEDAN, HATCHBACK, SUV…) caen todas en AUTO a propósito: para el catálogo son quince cosas
 * distintas, para el mostrador son un auto. Lo que NO está (FURGON, MICRO, CUATRICICLO, BICICLETA, HOGAR)
 * queda afuera del catálogo por elección: inventarles una rama que la agencia no vende es peor que dejarlas
 * listadas aparte. «ELECTRICA» a secas tampoco está: un auto eléctrico escrito así terminaría siendo una moto.
 */
export const RAMAS_DE_FABRICA: readonly RamaConfigurada[] = [
  {
    valor: 'AUTO',
    nombre: 'Auto',
    familia: 'auto',
    sinonimos: ['AUTOMOVIL', 'AUTOMOVILES', 'AUTOS', 'COCHE', 'SEDAN', 'HATCHBACK', 'COUPE', 'CABRIOLET', 'RURAL', 'MONOVOLUMEN', 'SUV'],
  },
  { valor: 'MOTO', nombre: 'Moto', familia: 'moto', sinonimos: ['MOTOS', 'MOTOCICLETA', 'MOTOCICLETAS', 'MOTOVEHICULO'] },
  // «Camioneta» es pick up en la calle argentina y así lo resuelve mapeo.ts desde la Fase 10.
  { valor: 'PICK UP', nombre: 'Pick up', familia: 'auto', sinonimos: ['CAMIONETA', 'CAMIONETAS', 'PICKUPS', 'DOBLE CABINA'] },
  { valor: 'CAMION', nombre: 'Camión', familia: 'auto', sinonimos: ['CAMIONES', 'CHASIS', 'TRACTOR', 'VOLCADOR'] },
  { valor: 'SCOOTER', nombre: 'Scooter', familia: 'moto', sinonimos: ['SCOOTERS', 'CICLOMOTOR'] },
  { valor: 'MOTO ELÉCTRICA', nombre: 'Moto eléctrica', familia: 'moto', sinonimos: ['MOTOS ELECTRICAS', 'MOTO E'] },
  { valor: 'TRAILER', nombre: 'Trailer', familia: 'otro', sinonimos: ['TRAILERS', 'TRAILA', 'ACOPLADO', 'REMOLQUE', 'CASA RODANTE'] },
]

export const CATALOGOS_DE_FABRICA: Catalogos = {
  sucursales: SUCURSALES_DE_FABRICA.map((s) => ({ ...s, sinonimos: [...s.sinonimos] })),
  ramas: RAMAS_DE_FABRICA.map((r) => ({ ...r, sinonimos: [...r.sinonimos] })),
}

// ---------------------------------------------------------------------------
// Limpieza de lo que llega de afuera (el disco, el servidor, la pantalla). Nunca tira.
// ---------------------------------------------------------------------------

function textoLimpio(valor: unknown): string {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, MAXIMO_DE_NOMBRE_DE_CATALOGO) : ''
}

/** Los sinónimos de una entrada, sin vacíos, repetidos ni los que ya son de otra entrada (`usadas`). */
function sinonimosLimpios(crudo: unknown, propia: string, usadas: Set<string>): string[] {
  if (!Array.isArray(crudo)) return []
  const salida: string[] = []
  for (const item of crudo) {
    const texto = textoLimpio(item)
    const clave = claveDeCatalogo(texto)
    if (!clave || clave === propia || usadas.has(clave)) continue
    usadas.add(clave)
    salida.push(texto)
    if (salida.length >= MAXIMO_DE_SINONIMOS) break
  }
  return salida
}

function esFamilia(valor: unknown): valor is FamiliaDeRama {
  return valor === 'auto' || valor === 'moto' || valor === 'otro'
}

/**
 * Deja cualquier cosa como un catálogo usable. Una lista que queda vacía (o que no es una lista) vuelve a la de
 * fábrica: sin ninguna sucursal o sin ninguna rama el programa no tendría qué ofrecer.
 *
 * Los nombres no se pueden repetir (se comparan por clave: «Lanús» y «LANUS» son la misma) y un sinónimo no
 * puede ser el nombre de otra entrada ni de un sinónimo anterior: gana la primera, como en la lista de fábrica.
 */
export function normalizarCatalogos(crudo: unknown): Catalogos {
  const c = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>

  const sucursales: SucursalConfigurada[] = []
  if (Array.isArray(c.sucursales)) {
    const nombres = new Set<string>()
    const crudas: Array<{ nombre: string; sinonimos: unknown }> = []
    for (const item of c.sucursales.slice(0, MAXIMO_DE_SUCURSALES)) {
      const fila = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const nombre = textoLimpio(fila.nombre)
      const clave = claveDeCatalogo(nombre)
      if (!clave || nombres.has(clave)) continue
      nombres.add(clave)
      crudas.push({ nombre, sinonimos: fila.sinonimos })
    }
    const usadas = new Set(nombres)
    for (const { nombre, sinonimos } of crudas) {
      sucursales.push({ nombre, sinonimos: sinonimosLimpios(sinonimos, claveDeCatalogo(nombre), usadas) })
    }
  }

  const ramas: RamaConfigurada[] = []
  if (Array.isArray(c.ramas)) {
    const valores = new Set<string>()
    const crudas: Array<{ valor: string; nombre: string; familia: FamiliaDeRama; sinonimos: unknown }> = []
    for (const item of c.ramas.slice(0, MAXIMO_DE_RAMAS)) {
      const fila = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      const nombre = textoLimpio(fila.nombre) || textoLimpio(fila.valor)
      // El valor guardado va siempre en mayúsculas, como el de las ramas de fábrica.
      const valor = (textoLimpio(fila.valor) || nombre).toUpperCase()
      const clave = claveDeCatalogo(valor)
      if (!clave || valores.has(clave)) continue
      valores.add(clave)
      crudas.push({ valor, nombre: nombre || valor, familia: esFamilia(fila.familia) ? fila.familia : 'otro', sinonimos: fila.sinonimos })
    }
    const usadas = new Set(valores)
    for (const { valor, nombre, familia, sinonimos } of crudas) {
      ramas.push({ valor, nombre, familia, sinonimos: sinonimosLimpios(sinonimos, claveDeCatalogo(valor), usadas) })
    }
  }

  return {
    sucursales: sucursales.length ? sucursales : CATALOGOS_DE_FABRICA.sucursales.map((s) => ({ ...s, sinonimos: [...s.sinonimos] })),
    ramas: ramas.length ? ramas : CATALOGOS_DE_FABRICA.ramas.map((r) => ({ ...r, sinonimos: [...r.sinonimos] })),
  }
}

export function sonCatalogosDeFabrica(catalogos: Catalogos): boolean {
  return JSON.stringify(normalizarCatalogos(catalogos)) === JSON.stringify(CATALOGOS_DE_FABRICA)
}
