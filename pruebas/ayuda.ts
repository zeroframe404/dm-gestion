// Utilidades comunes a las pruebas: base de datos en memoria y corrida del importador.
import { inflateRawSync } from 'node:zlib'
import Database from 'better-sqlite3'
import type { BaseDeDatos } from '../src/main/db/base'
import { ejecutarMigraciones } from '../src/main/db/migraciones'
import { sembrarDatosIniciales } from '../src/main/db/semilla'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import type { FuenteHoja } from '../src/main/importacion/fuente'
import { listarAmp } from '../src/main/servicios/amp'
import { catalogos } from '../src/main/servicios/cartera'
import { listarClientes } from '../src/main/servicios/clientes'
import { cajaDelDia, imputados, mora } from '../src/main/servicios/cobranzas'
import { buscarDeudores } from '../src/main/servicios/deudores'
import { listarLeads } from '../src/main/servicios/leads'
import { catalogosDePoliza } from '../src/main/servicios/polizas'
import { listarPresupuestos } from '../src/main/servicios/presupuestos'
import { listarRechazos } from '../src/main/servicios/rechazos'
import { listarRiesgos } from '../src/main/servicios/riesgos'
import { listarSiniestros } from '../src/main/servicios/siniestros'
import { listarTareas } from '../src/main/servicios/tareas'
import { DEUDORES_SIN_FILTROS, type InformeImportacion, type ProgresoImportacion } from '../src/shared/tipos'
import { ahoraIso } from '../src/main/importacion/normalizar'

/** Base nueva, en memoria, con el esquema y los datos iniciales (las cuatro sucursales). */
export function baseDePrueba(): BaseDeDatos {
  const db = new Database(':memory:') as BaseDeDatos
  db.pragma('foreign_keys = ON')
  // Las migraciones y la semilla avisan por consola: en las pruebas sólo tapan el resultado.
  const registrar = console.log
  console.log = () => undefined
  try {
    ejecutarMigraciones(db)
    sembrarDatosIniciales(db)
  } finally {
    console.log = registrar
  }
  return db
}

export interface ResultadoCorrida {
  informe: InformeImportacion
  progresos: ProgresoImportacion[]
}

export interface OpcionesCorrida {
  /** Año "de hoy" para las pruebas: fijo, así no cambian de un año al otro. */
  anioActual?: number
  estaCancelada?: () => boolean
}

/** Corre una importación completa contra la fuente dada y devuelve el informe y el progreso emitido. */
export async function importar(db: BaseDeDatos, fuente: FuenteHoja, opciones: OpcionesCorrida = {}): Promise<ResultadoCorrida> {
  const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
  const progresos: ProgresoImportacion[] = []
  const informe = await ejecutarImportacion({
    db,
    fuente,
    importacionId: id,
    anioActual: opciones.anioActual ?? 2026,
    estaCancelada: opciones.estaCancelada,
    alProgresar: (progreso) => progresos.push(JSON.parse(JSON.stringify(progreso)) as ProgresoImportacion),
  })
  db.prepare('UPDATE importaciones SET terminada_en = ?, estado = ? WHERE id = ?').run(informe.terminadaEn, informe.estado, id)
  return { informe, progresos }
}

/** Atajo: primera columna de la primera fila de una consulta. */
export function unico<T = unknown>(db: BaseDeDatos, sql: string, ...parametros: unknown[]): T {
  const fila = db.prepare(sql).get(...(parametros as [])) as Record<string, unknown> | undefined
  if (!fila) throw new Error(`La consulta no devolvió filas: ${sql}`)
  return Object.values(fila)[0] as T
}

export function contar(db: BaseDeDatos, tabla: string, condicion = '1=1'): number {
  return unico<number>(db, `SELECT COUNT(*) FROM ${tabla} WHERE ${condicion}`)
}

export function filas<T = Record<string, unknown>>(db: BaseDeDatos, sql: string, ...parametros: unknown[]): T[] {
  return db.prepare(sql).all(...(parametros as [])) as T[]
}

/** Lee un ZIP escrito por xlsx.ts: alcanza con recorrer las cabeceras locales de adelante hacia atrás. */
export function leerZip(archivo: Buffer): Map<string, string> {
  const entradas = new Map<string, string>()
  let posicion = 0
  while (posicion + 30 <= archivo.length && archivo.readUInt32LE(posicion) === 0x04034b50) {
    const metodo = archivo.readUInt16LE(posicion + 8)
    const comprimido = archivo.readUInt32LE(posicion + 18)
    const largoNombre = archivo.readUInt16LE(posicion + 26)
    const extra = archivo.readUInt16LE(posicion + 28)
    const nombre = archivo.subarray(posicion + 30, posicion + 30 + largoNombre).toString('utf8')
    const desde = posicion + 30 + largoNombre + extra
    const cuerpo = archivo.subarray(desde, desde + comprimido)
    entradas.set(nombre, (metodo === 8 ? inflateRawSync(cuerpo) : cuerpo).toString('utf8'))
    posicion = desde + comprimido
  }
  return entradas
}

/** Todos los problemas del informe de un tipo dado. */
export function problemasDeTipo(informe: InformeImportacion, tipo: string) {
  return informe.problemas.filter((p) => p.tipo === tipo)
}

export function resumenDe(informe: InformeImportacion, titulo: string) {
  const resumen = informe.pestanas.find((p) => p.titulo === titulo)
  if (!resumen) throw new Error(`El informe no tiene la pestaña «${titulo}»`)
  return resumen
}

// ---------------------------------------------------------------------------
// Los desplegables de sucursal
// ---------------------------------------------------------------------------

/**
 * Cada pantalla que ofrece un desplegable de sucursal, con el nombre que tiene para la agencia y la
 * lista que ofrece ahora mismo sobre la base abierta.
 *
 * Vive acá, y no dentro de una prueba, porque la miran dos: la de la base recién creada, donde no hay
 * ni una fila, y la de la base llena de datos pero sin ninguna fila de la sucursal nueva. Las dos
 * tienen que recorrer LAS MISMAS pantallas: el problema de Sarandí fue exactamente que una pantalla
 * quedó afuera del arreglo y nadie se enteró hasta que lo dijo la sucursal.
 *
 * `hoy` se le pasa a las dos pantallas que miran el calendario —la mora y los deudores—, para que la
 * prueba no dependa del día en que se corre: una cuota que hoy está vencida el mes que viene sigue
 * estándolo, pero al revés no, y la lista se armaría con otras filas.
 */
export function desplegablesDeSucursal(hoy?: string): Array<[string, string[]]> {
  const sinFiltros = {
    busqueda: '',
    estado: '',
    origenes: [],
    sucursales: [],
    companias: [],
    prioridades: [],
    responsableIds: [],
    incluirCerrados: true,
    incluirVersiones: true,
  }
  return [
    ['Cartera', catalogos().sucursales],
    ['Pólizas', catalogosDePoliza().sucursales],
    ['Clientes', listarClientes({ busqueda: '', sucursales: [], companias: [], estado: '' }).sucursales],
    ['Caja del día', cajaDelDia(null, []).sucursales],
    // Imputados tiene desplegable de sucursal desde la 12.5: entra acá para que no repita el problema
    // de Sarandí, que fue exactamente una pantalla que quedó afuera de este arreglo.
    ['Imputados', imputados(null, [], []).sucursales],
    ['Mora', mora({ busqueda: '', sucursales: [], companias: [], fechas: [], rangos: [], incluirDebito: true }, hoy).sucursales],
    ['Deudores', buscarDeudores(DEUDORES_SIN_FILTROS, hoy).sucursales],
    ['Riesgos varios', listarRiesgos().sucursales],
    ['Siniestros', listarSiniestros(sinFiltros).sucursales],
    ['Presupuestos', listarPresupuestos(sinFiltros).sucursales],
    ['Rechazos de débito', listarRechazos(sinFiltros).sucursales],
    ['Leads', listarLeads(sinFiltros).sucursales],
    ['AMP', listarAmp(true).sucursales],
    ['Tareas', listarTareas(sinFiltros).sucursales],
  ]
}
