// Cómo llegan las listas del módulo Compañías a las otras cuatro computadoras.
//
// El problema. Las cuatro listas que se cargan a mano (organizadores, precios, grúas y cláusulas) no
// tienen pestaña en la planilla de la agencia: no hay ninguna tabla donde escribirlas, y la que se le
// parece —COBERTURA— es un cuadro de resumen con celdas combinadas. Sin un camino propio, la lista de
// precios habría que cargarla cinco veces, una por máquina, y con que una quede vieja alguien le pasa
// un precio de hace tres meses a un cliente.
//
// El camino. El mismo puente de ajustes del VPS por el que ya viajan las credenciales del catálogo de
// vehículos (ver ajustesCompartidos.ts): el superadministrador publica, el servidor lo guarda cifrado
// y el resto de las computadoras lo adopta sola al arrancar. La clave del ajuste es «referencias».
//
// Las tres reglas que ordenan el archivo, heredadas de ese puente:
//
// 1. NADA DE ESTO PUEDE FRENAR EL PROGRAMA. Si el VPS no contesta se devuelve el motivo y se sigue con
//    lo que haya cargado localmente. Estas listas son de consulta: sin ellas se atiende igual.
// 2. LA ÚLTIMA PUBLICACIÓN GANA. No hay resolución de conflictos, y alcanza porque las carga una sola
//    persona: sólo el SUPER_ADMIN puede editarlas (ver referencias.ts).
// 3. ADOPTAR ES REEMPLAZAR. La computadora que adopta se queda EXACTAMENTE con lo publicado, no con
//    una mezcla. Una mezcla dejaría precios viejos conviviendo con los nuevos sin que se note cuál es
//    cuál, que es peor que no tener ninguno.
import { createHash } from 'node:crypto'
import type { EstadoDeReferencias } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import { ErrorDeNegocio } from './errores'
import { crearFuenteVps } from './sincronizacion'

/** La clave del ajuste en el servidor. La lista blanca del VPS tiene que conocerla. */
const CLAVE = 'referencias'

/**
 * Versión del formato de lo publicado. Si algún día cambian las columnas, una computadora con el
 * programa viejo tiene que poder DARSE CUENTA de que no entiende lo que bajó, en vez de adoptar
 * media lista. Se sube sólo cuando el cambio no es compatible hacia atrás.
 */
const VERSION = 1

/** Lo que se devuelve cuando ni siquiera hay puente: en desarrollo, o sin VPS configurado. */
const SIN_SERVIDOR: EstadoDeReferencias = {
  hayServidor: false,
  enElServidor: false,
  actualizadoEn: null,
  actualizadoPor: null,
  alDia: false,
  sinPublicar: false,
  error: null,
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Lo que viaja
// ---------------------------------------------------------------------------

interface FilaPublicada {
  [columna: string]: string | number | null
}

interface Instantanea {
  version: number
  organizadores: FilaPublicada[]
  precios: FilaPublicada[]
  gruas: FilaPublicada[]
  clausulas: FilaPublicada[]
}

/**
 * Las columnas que viajan de cada tabla, en un orden FIJO.
 *
 * El orden importa de verdad: la huella con la que el servidor y cada computadora se comparan es el
 * SHA-256 del JSON, y JSON.stringify respeta el orden en que se armó el objeto. Leer las columnas con
 * `SELECT *` habría hecho que la misma lista diera dos huellas distintas el día que alguien agregue
 * una columna en el medio, y todas las máquinas se habrían visto «desactualizadas» para siempre.
 *
 * `id`, `clave`, `creado_en` y `actualizado_en` quedan afuera a propósito: son de cada base, no del
 * dato. Al adoptar se vuelven a generar.
 */
const COLUMNAS = {
  organizadores: ['nombre', 'companias', 'telefono', 'email', 'horario', 'observaciones', 'orden', 'activo'],
  precios: ['compania', 'cobertura', 'rama', 'precio', 'vigente_desde', 'observaciones'],
  gruas: ['compania', 'cobertura', 'kilometros', 'auxilio', 'observaciones'],
  clausulas: ['compania', 'cobertura', 'clausula', 'ampara', 'detalle', 'orden'],
} as const

const TABLAS = {
  organizadores: 'organizadores',
  precios: 'precios_companias',
  gruas: 'gruas_companias',
  clausulas: 'clausulas_coberturas',
} as const

type Lista = keyof typeof COLUMNAS

/** Lee una lista con sus columnas en el orden fijo y ordenada por `clave`, que es única y estable. */
function leerLista(lista: Lista): FilaPublicada[] {
  const columnas = COLUMNAS[lista]
  const filas = db()
    .prepare(`SELECT ${columnas.join(', ')} FROM ${TABLAS[lista]} ORDER BY clave`)
    .all() as Array<Record<string, unknown>>
  return filas.map((fila) => {
    const salida: FilaPublicada = {}
    for (const columna of columnas) {
      const valor = fila[columna]
      salida[columna] = valor === undefined ? null : (valor as string | number | null)
    }
    return salida
  })
}

/** Lo que hay cargado en esta computadora, listo para publicar o para comparar. */
export function instantaneaDeReferencias(): Instantanea {
  return {
    version: VERSION,
    organizadores: leerLista('organizadores'),
    precios: leerLista('precios'),
    gruas: leerLista('gruas'),
    clausulas: leerLista('clausulas'),
  }
}

/** La misma cuenta que hace el servidor (`huellaDeAjuste`): SHA-256 del JSON del valor. */
export function huellaDeReferencias(): string {
  return createHash('sha256').update(JSON.stringify(instantaneaDeReferencias())).digest('hex')
}

/**
 * La huella de la última vez que esta computadora y el servidor estuvieron igualados (se publicó, o
 * se adoptó). Es lo que permite distinguir dos situaciones que se ven idénticas mirando sólo las
 * huellas de hoy: «el servidor tiene algo más nuevo» y «acá hay cambios que nadie publicó».
 *
 * Sin esto, la adopción del arranque borraba en silencio los precios que el superadministrador había
 * cargado la noche anterior y todavía no había publicado.
 */
const CLAVE_HUELLA_SINCRONIZADA = 'referencias_huella_sincronizada'

function huellaSincronizada(): string | null {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE_HUELLA_SINCRONIZADA) as
    | { valor: string }
    | undefined
  return fila?.valor ?? null
}

function recordarSincronizada(huella: string): void {
  db()
    .prepare(
      `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
    .run(CLAVE_HUELLA_SINCRONIZADA, huella, ahoraIso())
}

/**
 * ¿Hay en esta computadora algo cargado que todavía no viajó a las demás?
 *
 * Con listas vacías y sin nada recordado la respuesta es no: es una computadora recién instalada, y
 * tiene que poder adoptar sola. Con algo cargado y nada recordado la respuesta es sí, aunque nadie
 * haya tocado el botón de publicar: ese contenido es de acá y adoptar lo borraría.
 */
export function hayCambiosSinPublicar(): boolean {
  const recordada = huellaSincronizada()
  if (recordada === null) return !estaVacia(instantaneaDeReferencias())
  return recordada !== huellaDeReferencias()
}

/** true si las cuatro listas están vacías: no hay nada que publicar todavía. */
function estaVacia(instantanea: Instantanea): boolean {
  return (
    instantanea.organizadores.length === 0 &&
    instantanea.precios.length === 0 &&
    instantanea.gruas.length === 0 &&
    instantanea.clausulas.length === 0
  )
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

export async function estadoCompartidoDeReferencias(): Promise<EstadoDeReferencias> {
  const vps = crearFuenteVps()
  if (!vps) return { ...SIN_SERVIDOR }
  try {
    const ficha = await vps.estadoAjuste(CLAVE)
    if (!ficha) return { ...SIN_SERVIDOR, hayServidor: true, sinPublicar: hayCambiosSinPublicar() }
    return {
      hayServidor: true,
      enElServidor: true,
      actualizadoEn: ficha.actualizadoEn,
      actualizadoPor: ficha.actualizadoPor,
      alDia: ficha.huella === huellaDeReferencias(),
      sinPublicar: hayCambiosSinPublicar(),
      error: null,
    }
  } catch (error) {
    return { ...SIN_SERVIDOR, hayServidor: true, error: motivo(error) }
  }
}

/**
 * Manda al servidor lo que hay en esta computadora.
 *
 * Acá el error SÍ se propaga: esto lo dispara alguien que tocó «Publicar» y tiene que enterarse de
 * que el resto de las máquinas NO se enteró. Lo local ya está guardado, así que un fallo no pierde
 * nada: se vuelve a intentar con el botón.
 */
export async function publicarReferencias(quien: string | null): Promise<EstadoDeReferencias> {
  const instantanea = instantaneaDeReferencias()
  if (estaVacia(instantanea)) {
    throw new ErrorDeNegocio(
      'Todavía no hay nada cargado en estas listas: publicar ahora dejaría vacías las de las otras computadoras.',
    )
  }
  const vps = crearFuenteVps()
  if (!vps) {
    throw new ErrorDeNegocio(
      'La base del VPS no está disponible en esta computadora, así que las listas quedaron sólo acá.',
    )
  }
  const ficha = await vps.guardarAjuste(CLAVE, instantanea, quien)
  const huella = huellaDeReferencias()
  // Desde acá lo de esta computadora y lo del servidor son lo mismo: se anota, y el arranque de
  // mañana ya sabe que puede adoptar sin pisarle nada a nadie.
  if (ficha.huella === huella) recordarSincronizada(huella)
  return {
    hayServidor: true,
    enElServidor: true,
    actualizadoEn: ficha.actualizadoEn,
    actualizadoPor: ficha.actualizadoPor,
    alDia: ficha.huella === huella,
    sinPublicar: hayCambiosSinPublicar(),
    error: null,
  }
}

// ---------------------------------------------------------------------------
// Adoptar
// ---------------------------------------------------------------------------

export interface ResultadoDeAdopcion {
  adoptadas: boolean
  detalle: string
}

/** ¿Lo que bajó tiene la forma de una instantánea que esta versión del programa entiende? */
export function esInstantanea(valor: unknown): valor is Instantanea {
  if (typeof valor !== 'object' || valor === null) return false
  const crudo = valor as Record<string, unknown>
  if (crudo.version !== VERSION) return false
  return (['organizadores', 'precios', 'gruas', 'clausulas'] as Lista[]).every((lista) => Array.isArray(crudo[lista]))
}

/**
 * Escribe una lista entera: borra lo que había y pone lo que bajó. Va adentro de la transacción de
 * `adoptarReferenciasDelVps`, así que un error a mitad de camino no deja media lista.
 *
 * `clave` se recalcula acá y no viaja: es lo mismo que calcula referencias.ts al guardar, y hacerlo
 * de nuevo evita que una clave mal armada en otra computadora se propague a todas.
 */
function escribirLista(lista: Lista, filas: unknown[], claveDe: (fila: Record<string, unknown>) => string): number {
  const base = db()
  const columnas = COLUMNAS[lista]
  base.prepare(`DELETE FROM ${TABLAS[lista]}`).run()
  const ahora = ahoraIso()
  const insertar = base.prepare(
    `INSERT INTO ${TABLAS[lista]} (clave, ${columnas.join(', ')}, creado_en, actualizado_en)
     VALUES (@clave, ${columnas.map((columna) => `@${columna}`).join(', ')}, @ahora, @ahora)
     ON CONFLICT(clave) DO NOTHING`,
  )
  let escritas = 0
  for (const cruda of filas) {
    if (typeof cruda !== 'object' || cruda === null) continue
    const fila = cruda as Record<string, unknown>
    const clave = claveDe(fila)
    // Una fila sin nada con qué armar la clave no se puede guardar ni volver a encontrar: se saltea.
    if (!clave.replace(/\|/g, '')) continue
    const valores: Record<string, unknown> = { clave, ahora }
    for (const columna of columnas) valores[columna] = fila[columna] ?? DEFECTOS[columna] ?? null
    // Una fila a la que le falta algo obligatorio haría fallar el INSERT y, con él, la transacción
    // entera: se saltea esa sola. Adoptar noventa y nueve precios es mejor que no adoptar ninguno
    // porque el que hace cien vino sin importe.
    if (FALTA_ALGO[lista](valores)) continue
    escritas += insertar.run(valores).changes
  }
  return escritas
}

/** Lo que se pone cuando la fila que bajó no trae la columna: sólo para las que no admiten NULL. */
const DEFECTOS: Record<string, number | undefined> = { orden: 0, activo: 1, ampara: 1 }

/** Qué hace inservible a una fila de cada lista: lo que la tabla exige y no se puede inventar. */
const FALTA_ALGO: Record<Lista, (fila: Record<string, unknown>) => boolean> = {
  organizadores: (fila) => !fila.nombre,
  precios: (fila) => !fila.compania || !fila.cobertura || typeof fila.precio !== 'number',
  gruas: (fila) => !fila.compania || !fila.cobertura,
  clausulas: (fila) => !fila.cobertura || !fila.clausula,
}

/** Las mismas normalizaciones que usa referencias.ts para armar las claves. */
function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * REEMPLAZA las cuatro listas de esta computadora por las de una instantánea. Todo o nada: va en una
 * sola transacción, así un error a mitad de camino no deja media lista de precios.
 *
 * Está separado de `adoptarReferenciasDelVps` para poder probarlo sin un servidor: es el paso que de
 * verdad puede romper algo (borra lo que había), y el que tiene que seguir andando el día que alguien
 * agregue una columna.
 */
export function adoptarInstantanea(valor: unknown): ResultadoDeAdopcion {
  if (!esInstantanea(valor)) {
    return {
      adoptadas: false,
      detalle:
        'Lo que hay guardado en el servidor lo publicó una versión más nueva de DM Gestión y esta computadora no lo entiende. Actualizá el programa.',
    }
  }

  const escritas = db().transaction(() => ({
    organizadores: escribirLista('organizadores', valor.organizadores, (fila) => normalizar(fila.nombre)),
    precios: escribirLista('precios', valor.precios, (fila) =>
      [normalizar(fila.compania), normalizar(fila.cobertura), normalizar(fila.rama)].join('|'),
    ),
    gruas: escribirLista('gruas', valor.gruas, (fila) => [normalizar(fila.compania), normalizar(fila.cobertura)].join('|')),
    clausulas: escribirLista('clausulas', valor.clausulas, (fila) =>
      [normalizar(fila.compania), normalizar(fila.cobertura), normalizar(fila.clausula)].join('|'),
    ),
  }))()

  recordarSincronizada(huellaDeReferencias())
  return {
    adoptadas: true,
    detalle:
      `Se adoptaron las listas de las compañías que publicó el superadministrador: ${escritas.organizadores} organizadores, ` +
      `${escritas.precios} precios, ${escritas.gruas} grúas y ${escritas.clausulas} cláusulas.`,
  }
}

/**
 * Trae del servidor las cuatro listas y reemplaza las de esta computadora.
 *
 * Si ya coinciden no toca nada: reescribirlas cambiaría los `id` de todas las filas y la pantalla que
 * alguien tuviera abierta se quedaría apuntando a filas que ya no existen.
 */
export async function adoptarReferenciasDelVps(opciones: { pisarLoLocal?: boolean } = {}): Promise<ResultadoDeAdopcion> {
  const vps = crearFuenteVps()
  if (!vps) return { adoptadas: false, detalle: 'No hay conexión con la base del VPS en esta computadora.' }

  const ajuste = await vps.leerAjuste(CLAVE)
  if (!ajuste) {
    return {
      adoptadas: false,
      detalle: 'El servidor todavía no tiene las listas de las compañías. Las publica el superadministrador desde el módulo Compañías.',
    }
  }
  const huella = huellaDeReferencias()
  if (ajuste.huella === huella) {
    // Coinciden aunque esta computadora nunca hubiera publicado: quedan igualadas igual.
    recordarSincronizada(huella)
    return { adoptadas: false, detalle: 'Esta computadora ya tenía exactamente las mismas listas que el servidor.' }
  }
  // La adopción del arranque NO pisa lo que se cargó acá y todavía no se publicó: sería borrar los
  // precios que alguien cargó anoche. Se deja que la barra del módulo lo diga y que alguien elija.
  if (!opciones.pisarLoLocal && hayCambiosSinPublicar()) {
    return {
      adoptadas: false,
      detalle: 'Esta computadora tiene listas cargadas que todavía no se publicaron: no se pisaron con las del servidor.',
    }
  }
  return adoptarInstantanea(ajuste.valor)
}
