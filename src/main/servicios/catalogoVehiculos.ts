// El catálogo de vehículos: el maestro de la DNRPA bajado del VPS y el selector encadenado que lo lee.
//
// De dónde sale: el VPS lee una vez por edición la Tabla de Valuación de Automotores y Motovehículos
// de la DNRPA (gratis y oficial, autos y motos, un código MTM/FMM por versión) y la publica. Cada PC
// baja sólo lo que cambió desde la última vez. El PDF no se descarga en ninguna PC.
//
// La regla que ordena todo el archivo: DIBUJAR UN DESPLEGABLE NUNCA SALE A INTERNET. El selector lee
// siempre de la base. A internet se sale al arrancar, cada algunas horas y cuando alguien toca
// «Actualizar» en Administración. Si no fuera así, elegir un vehículo en el mostrador sería medio
// segundo de espera por cada clic, y nada cuando se corta la conexión.
//
// Sin catálogo bajado todo sigue funcionando: el formulario cae solo a los campos de texto libre de
// siempre y no se bloquea ningún guardado.
import {
  NOMBRE_CATEGORIA,
  TIPOS_DE_VEHICULO,
  type CategoriaDeVehiculo,
  type EstadoDelCatalogo,
  type EstadoDeUnTipo,
  type ImportacionDelCatalogo,
  type LineaDeCatalogo,
  type OpcionDeCatalogo,
  type ProgresoDeCatalogo,
  type RegistroDeImportaciones,
  type ResultadoDeImportarAhora,
  type TipoDeVehiculo,
  type VehiculoDelCatalogo,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, limpiar, normalizarTexto } from '../importacion/normalizar'
import { categoriaDeCatalogo } from '../vehiculos/mapeo'
import type { BajadaDelMaestroVps, FuenteVps, VehiculoDelMaestroVps } from '../vps/fuenteVps'
import { ErrorDeNegocio } from './errores'
import { crearFuenteVps } from './sincronizacion'

/** Lo que este archivo necesita del VPS. Las pruebas ponen uno falso con `usarFuenteDePrueba`. */
export type FuenteDelMaestro = Pick<FuenteVps, 'leerMaestroDeVehiculos' | 'importacionesDeVehiculos' | 'importarVehiculos'>

let fuenteDePrueba: FuenteDelMaestro | null = null

export function usarFuenteDePrueba(fuente: FuenteDelMaestro | null): void {
  fuenteDePrueba = fuente
}

function fuente(): FuenteDelMaestro | null {
  return fuenteDePrueba ?? crearFuenteVps()
}

function esTipo(valor: unknown): valor is TipoDeVehiculo {
  return typeof valor === 'string' && (TIPOS_DE_VEHICULO as readonly string[]).includes(valor)
}

function exigirTipo(valor: unknown): TipoDeVehiculo {
  if (!esTipo(valor)) throw new ErrorDeNegocio('El tipo de vehículo tiene que ser Auto o Moto.')
  return valor
}

// ---------------------------------------------------------------------------
// Cómo se ve una marca
// ---------------------------------------------------------------------------
// La tabla trae todo en mayúsculas. En pantalla va «Volkswagen» en vez de «VOLKSWAGEN», salvo las
// siglas, que no son una palabra. Es la misma lista que usa el VPS para el formulario web.
const SIGLAS_DE_MARCA = new Map<string, string>([
  ['BMW', 'BMW'],
  ['BYD', 'BYD'],
  ['DS', 'DS'],
  ['DSFK', 'DSFK'],
  ['FCA', 'FCA'],
  ['GWM', 'GWM'],
  ['JAC', 'JAC'],
  ['JMC', 'JMC'],
  ['KIA', 'Kia'],
  ['KTM', 'KTM'],
  ['MINI', 'MINI'],
  ['MG', 'MG'],
  ['RAM', 'RAM'],
  ['UAZ', 'UAZ'],
  ['DFAC', 'DFAC'],
  ['DFSK', 'DFSK'],
  ['JMEV', 'JMEV'],
])

export function etiquetaDeMarca(marca: string): string {
  return marca
    .split(/([\s/-]+)/)
    .map((parte) => {
      if (!/^[A-Z0-9]+$/.test(parte)) return parte
      const sigla = SIGLAS_DE_MARCA.get(parte)
      if (sigla) return sigla
      return parte.length <= 2 ? parte : `${parte.charAt(0)}${parte.slice(1).toLowerCase()}`
    })
    .join('')
}

/** «SEDAN 5 PUERTAS» → «Sedan 5 puertas», para mostrar al lado de la versión. */
function carroceriaLegible(carroceria: string): string {
  const minuscula = carroceria.toLowerCase()
  return `${minuscula.charAt(0).toUpperCase()}${minuscula.slice(1)}`
}

// ---------------------------------------------------------------------------
// El estado
// ---------------------------------------------------------------------------

let bajandoAhora = false

interface FilaDeEstado {
  revision: number
  edicion: string | null
  bajado_en: string | null
  intentado_en: string | null
  ultimo_error: string | null
}

function filaDeEstado(): FilaDeEstado {
  const fila = db().prepare('SELECT revision, edicion, bajado_en, intentado_en, ultimo_error FROM maestro_estado WHERE id = 1').get() as
    | FilaDeEstado
    | undefined
  return fila ?? { revision: 0, edicion: null, bajado_en: null, intentado_en: null, ultimo_error: null }
}

function anotarIntento(error: string | null): void {
  db()
    .prepare(
      `INSERT INTO maestro_estado (id, intentado_en, ultimo_error) VALUES (1, @ahora, @error)
       ON CONFLICT(id) DO UPDATE SET intentado_en = excluded.intentado_en, ultimo_error = excluded.ultimo_error`,
    )
    .run({ ahora: ahoraIso(), error })
}

function estadoDeUnTipo(tipo: TipoDeVehiculo): EstadoDeUnTipo {
  const cuentas = db()
    .prepare(
      `SELECT COUNT(DISTINCT marca) AS marcas, COUNT(DISTINCT marca || '|' || modelo) AS modelos, COUNT(*) AS versiones
         FROM maestro_vehiculos WHERE tipo = ? AND activo = 1`,
    )
    .get(tipo) as { marcas: number; modelos: number; versiones: number }
  return { tipo, ...cuentas }
}

export function estadoDelCatalogo(): EstadoDelCatalogo {
  const estado = filaDeEstado()
  const porTipo = TIPOS_DE_VEHICULO.map(estadoDeUnTipo)
  return {
    hayCatalogo: porTipo.some((tipo) => tipo.versiones > 0),
    revision: estado.revision,
    edicion: estado.edicion,
    bajadoEn: estado.bajado_en,
    intentadoEn: estado.intentado_en,
    ultimoError: estado.ultimo_error,
    bajandoAhora,
    porTipo,
  }
}

// ---------------------------------------------------------------------------
// El selector encadenado: todo sale de la base
// ---------------------------------------------------------------------------

export function marcasDelCatalogo(tipo: unknown): OpcionDeCatalogo[] {
  const cual = exigirTipo(tipo)
  const filas = db()
    .prepare('SELECT DISTINCT marca FROM maestro_vehiculos WHERE tipo = ? AND activo = 1 ORDER BY marca')
    .all(cual) as Array<{ marca: string }>
  return filas.map((fila) => ({ id: fila.marca, nombre: etiquetaDeMarca(fila.marca) }))
}

export function modelosDelCatalogo(tipo: unknown, marcaId: unknown): OpcionDeCatalogo[] {
  const cual = exigirTipo(tipo)
  const marca = limpiar(marcaId)
  if (!marca) return []
  const filas = db()
    .prepare('SELECT DISTINCT modelo FROM maestro_vehiculos WHERE tipo = ? AND marca = ? AND activo = 1 ORDER BY modelo')
    .all(cual, marca) as Array<{ modelo: string }>
  return filas.map((fila) => ({ id: fila.modelo, nombre: fila.modelo }))
}

interface FilaDelMaestro {
  mtm: string
  tipo: string
  marca: string
  modelo: string
  version: string
  carroceria: string | null
  categoria: string | null
  anio_desde: number | null
  anio_hasta: number | null
  anios: string
}

export function lineasDelCatalogo(tipo: unknown, marcaId: unknown, modeloId: unknown): LineaDeCatalogo[] {
  const cual = exigirTipo(tipo)
  const marca = limpiar(marcaId)
  const modelo = limpiar(modeloId)
  if (!marca || !modelo) return []
  const filas = db()
    .prepare(
      `SELECT mtm, version, carroceria, categoria, anio_desde, anio_hasta
         FROM maestro_vehiculos WHERE tipo = ? AND marca = ? AND modelo = ? AND activo = 1
        ORDER BY version, carroceria`,
    )
    .all(cual, marca, modelo) as Array<Pick<FilaDelMaestro, 'mtm' | 'version' | 'carroceria' | 'categoria' | 'anio_desde' | 'anio_hasta'>>
  // La misma versión puede venir en dos carrocerías («GOL TREND 1.6» de 3 y de 5 puertas son dos
  // códigos). Ahí la carrocería va en el nombre, porque si no la lista muestra dos renglones iguales.
  const repetidas = new Set<string>()
  const vistas = new Set<string>()
  for (const fila of filas) {
    if (vistas.has(fila.version)) repetidas.add(fila.version)
    vistas.add(fila.version)
  }
  return filas.map((fila) => ({
    id: fila.mtm,
    nombre: repetidas.has(fila.version) && fila.carroceria ? `${fila.version} · ${carroceriaLegible(fila.carroceria)}` : fila.version,
    anioDesde: fila.anio_desde,
    anioHasta: fila.anio_hasta,
    categoria: (fila.categoria as CategoriaDeVehiculo | null) ?? null,
    carroceria: fila.carroceria,
  }))
}

/** Sólo los vigentes: uno que la DNRPA dejó de publicar ya no se ofrece para elegir. */
function filaDelCodigo(tipo: TipoDeVehiculo, mtm: string): FilaDelMaestro | undefined {
  return db()
    .prepare(
      `SELECT mtm, tipo, marca, modelo, version, carroceria, categoria, anio_desde, anio_hasta, anios
         FROM maestro_vehiculos WHERE tipo = ? AND mtm = ? AND activo = 1`,
    )
    .get(tipo, mtm) as FilaDelMaestro | undefined
}

function aniosDe(fila: FilaDelMaestro): number[] {
  try {
    const anios = JSON.parse(fila.anios) as unknown
    return Array.isArray(anios) ? anios.filter((anio): anio is number => Number.isInteger(anio)).sort((a, b) => b - a) : []
  } catch {
    return []
  }
}

/**
 * Los años que se pueden elegir para una versión: los que tienen valuación en la tabla de la DNRPA.
 * Un Corolla 2015 no puede ser de una versión que salió en 2020, y ofrecerlo es dejar que el error
 * entre. La tabla llega hasta 2002; un vehículo más viejo se carga a mano.
 */
export function aniosDeLaLinea(tipo: unknown, marcaId: unknown, modeloId: unknown, lineaId: unknown): number[] {
  const cual = exigirTipo(tipo)
  const fila = filaDelCodigo(cual, limpiar(lineaId))
  if (!fila || fila.marca !== limpiar(marcaId) || fila.modelo !== limpiar(modeloId)) return []
  return aniosDe(fila)
}

/**
 * El vehículo terminado, con la categoría que decidió el catálogo. Es lo único que devuelve la
 * categoría, y no hay ningún camino por el que la pantalla pueda mandar una distinta.
 */
export function resolverVehiculoDelCatalogo(tipo: unknown, marcaId: unknown, modeloId: unknown, lineaId: unknown, anio: unknown): VehiculoDelCatalogo {
  const cual = exigirTipo(tipo)
  const fila = filaDelCodigo(cual, limpiar(lineaId))
  if (!fila || fila.marca !== limpiar(marcaId) || fila.modelo !== limpiar(modeloId)) {
    throw new ErrorDeNegocio('Ese vehículo no está en el catálogo bajado. Actualizalo desde Administración o cargalo a mano.')
  }
  const anioTexto = limpiar(anio)
  if (!/^\d{4}$/.test(anioTexto)) throw new ErrorDeNegocio('Elegí el año del vehículo.')
  const anios = aniosDe(fila)
  if (anios.length > 0 && !anios.includes(Number(anioTexto))) {
    throw new ErrorDeNegocio(`La DNRPA no tiene valuación de esa versión para ${anioTexto}. Elegí otro año o cargalo a mano.`)
  }

  return {
    tipo: cual,
    marca: etiquetaDeMarca(fila.marca),
    modelo: fila.modelo,
    linea: fila.version,
    anio: anioTexto,
    categoria: (fila.categoria as CategoriaDeVehiculo | null) ?? null,
    codigo: fila.mtm,
  }
}

/** El nombre legible de una categoría, para las pantallas que sólo tienen el código guardado. */
export function nombreDeCategoria(categoria: string | null): string {
  if (!categoria) return ''
  return NOMBRE_CATEGORIA[categoria as CategoriaDeVehiculo] ?? categoria
}

// ---------------------------------------------------------------------------
// Bajar el catálogo del VPS
// ---------------------------------------------------------------------------

function tipoDelVps(tipo: string): TipoDeVehiculo | null {
  return esTipo(tipo) ? tipo : null
}

/** Guarda lo que bajó. Todo en una transacción: un corte a la mitad deja lo anterior intacto. */
function aplicarBajada(bajada: BajadaDelMaestroVps): { guardados: number; descartados: number } {
  const ahora = ahoraIso()
  let guardados = 0
  let descartados = 0
  db().transaction(() => {
    const guardar = db().prepare(
      `INSERT INTO maestro_vehiculos (mtm, tipo, origen, marca, modelo, version, version_normalizada, carroceria, categoria,
                                      anio_desde, anio_hasta, anios, activo, actualizado_en)
       VALUES (@mtm, @tipo, @origen, @marca, @modelo, @version, @version_normalizada, @carroceria, @categoria,
               @anio_desde, @anio_hasta, @anios, @activo, @ahora)
       ON CONFLICT(mtm) DO UPDATE SET tipo = excluded.tipo, origen = excluded.origen, marca = excluded.marca,
         modelo = excluded.modelo, version = excluded.version, version_normalizada = excluded.version_normalizada,
         carroceria = excluded.carroceria, categoria = excluded.categoria, anio_desde = excluded.anio_desde,
         anio_hasta = excluded.anio_hasta, anios = excluded.anios, activo = excluded.activo, actualizado_en = excluded.actualizado_en`,
    )
    const vistos: string[] = []
    for (const vehiculo of bajada.vehiculos as VehiculoDelMaestroVps[]) {
      const tipo = tipoDelVps(vehiculo.tipo)
      if (!tipo || !vehiculo.mtm || !vehiculo.marca || !vehiculo.version) {
        descartados++
        continue
      }
      const anios = (Array.isArray(vehiculo.anios) ? vehiculo.anios : []).filter((anio) => Number.isInteger(anio))
      guardar.run({
        mtm: vehiculo.mtm,
        tipo,
        origen: vehiculo.origen ?? 'NACIONAL',
        marca: vehiculo.marca,
        modelo: vehiculo.modelo || vehiculo.version,
        version: vehiculo.version,
        version_normalizada: normalizarTexto(vehiculo.version),
        carroceria: vehiculo.carroceria ?? null,
        categoria: categoriaDeCatalogo(tipo, vehiculo.carroceria ?? null, vehiculo.version),
        anio_desde: anios.length ? Math.min(...anios) : null,
        anio_hasta: anios.length ? Math.max(...anios) : null,
        anios: JSON.stringify(anios),
        activo: vehiculo.activo === false ? 0 : 1,
        ahora,
      })
      vistos.push(vehiculo.mtm)
      guardados++
    }
    // El catálogo entero trae sólo los activos: lo que no vino dejó de estar en la tabla. No se borra,
    // porque una póliza ya cargada puede nombrar ese código.
    if (bajada.completo) {
      db().exec('CREATE TEMP TABLE IF NOT EXISTS maestro_vistos (mtm TEXT PRIMARY KEY)')
      db().exec('DELETE FROM maestro_vistos')
      const anotar = db().prepare('INSERT OR IGNORE INTO maestro_vistos (mtm) VALUES (?)')
      for (const mtm of vistos) anotar.run(mtm)
      db().prepare('UPDATE maestro_vehiculos SET activo = 0, actualizado_en = ? WHERE activo = 1 AND mtm NOT IN (SELECT mtm FROM maestro_vistos)').run(ahora)
      db().exec('DELETE FROM maestro_vistos')
    }
    db()
      .prepare(
        `INSERT INTO maestro_estado (id, revision, edicion, bajado_en, intentado_en, ultimo_error)
         VALUES (1, @revision, @edicion, @ahora, @ahora, NULL)
         ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, edicion = COALESCE(excluded.edicion, maestro_estado.edicion),
           bajado_en = excluded.bajado_en, intentado_en = excluded.intentado_en, ultimo_error = NULL`,
      )
      .run({ revision: bajada.revision, edicion: bajada.edicion, ahora })
  })()
  return { guardados, descartados }
}

/**
 * Baja del VPS lo que cambió desde la última vez (o todo, la primera). Devuelve cómo quedó.
 *
 * Una respuesta completa pero vacía NO borra nada: es un servidor que todavía no importó la tabla, no
 * una tabla sin vehículos.
 */
export async function bajarCatalogo(avisar: (progreso: ProgresoDeCatalogo) => void = () => undefined): Promise<EstadoDelCatalogo> {
  const vps = fuente()
  if (!vps) {
    throw new ErrorDeNegocio('Esta computadora no está conectada al VPS, y el catálogo de vehículos se baja de ahí.')
  }
  if (bajandoAhora) throw new ErrorDeNegocio('Ya se está bajando el catálogo. Esperá a que termine.')
  bajandoAhora = true
  try {
    const local = filaDeEstado().revision
    avisar({ etapa: 'pidiendo', detalle: local > 0 ? 'Pidiendo las novedades del catálogo…' : 'Bajando el catálogo completo…' })
    let bajada = await vps.leerMaestroDeVehiculos(local)
    // El servidor quedó atrás de esta PC (se restauró una copia): se pide todo de nuevo.
    if (!bajada.completo && bajada.revision < local) bajada = await vps.leerMaestroDeVehiculos(0)

    if (bajada.completo && bajada.vehiculos.length === 0) {
      throw new ErrorDeNegocio('El VPS todavía no tiene el catálogo de vehículos. Se arma solo con la tabla de la DNRPA; probá en un rato.')
    }
    avisar({ etapa: 'guardando', detalle: `Guardando ${bajada.vehiculos.length} vehículos…` })
    const { guardados, descartados } = aplicarBajada(bajada)
    if (descartados > 0) console.warn(`[vehiculos] ${descartados} vehículo(s) del VPS vinieron incompletos y no se guardaron.`)
    avisar({ etapa: 'listo', detalle: guardados > 0 ? `${guardados} vehículos actualizados` : 'El catálogo ya estaba al día' })
    return estadoDelCatalogo()
  } catch (error) {
    anotarIntento(error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    bajandoAhora = false
  }
}

/** Cada cuánto se buscan novedades mientras el programa está abierto. */
const INTERVALO_DE_BAJADA_MS = 6 * 60 * 60 * 1000

/**
 * La bajada del arranque y la periódica. No espera a nadie y no rompe nada: sin VPS o sin red, el
 * programa abre igual con lo que ya tenía, y el motivo queda anotado para Administración.
 */
export function bajarCatalogoAlArrancar(): void {
  const intentar = () => {
    if (!fuente()) return
    void bajarCatalogo().catch((error: unknown) => {
      console.error('[vehiculos] No se pudo bajar el catálogo del VPS:', error instanceof Error ? error.message : error)
    })
  }
  intentar()
  setInterval(intentar, INTERVALO_DE_BAJADA_MS).unref?.()
}

// ---------------------------------------------------------------------------
// La importación en el VPS: el log y el botón «Buscar edición nueva»
// ---------------------------------------------------------------------------

function comoNumero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0
}

function comoTexto(valor: unknown): string | null {
  return typeof valor === 'string' && valor ? valor : null
}

export function comoImportacion(cruda: unknown): ImportacionDelCatalogo | null {
  if (!cruda || typeof cruda !== 'object') return null
  const c = cruda as Record<string, unknown>
  const detalle = (c.detalle && typeof c.detalle === 'object' ? c.detalle : {}) as Record<string, unknown>
  const porMotivo: Record<string, number> = {}
  if (detalle.descartesPorMotivo && typeof detalle.descartesPorMotivo === 'object') {
    for (const [motivo, cantidad] of Object.entries(detalle.descartesPorMotivo as Record<string, unknown>)) {
      porMotivo[motivo] = comoNumero(cantidad)
    }
  }
  return {
    id: String(c.id ?? ''),
    fuente: comoTexto(c.fuente) ?? 'DNRPA',
    edicion: comoTexto(c.edicion),
    estado: comoTexto(c.estado) ?? 'ERROR',
    leidas: comoNumero(c.leidas),
    aceptadas: comoNumero(c.aceptadas),
    descartadas: comoNumero(c.descartadas),
    altas: comoNumero(c.altas),
    cambios: comoNumero(c.cambios),
    bajas: comoNumero(c.bajas),
    mensaje: comoTexto(c.mensaje),
    iniciadaEn: comoTexto(c.iniciadaEn) ?? '',
    terminadaEn: comoTexto(c.terminadaEn),
    descartesPorMotivo: porMotivo,
    autos: typeof detalle.autos === 'number' ? detalle.autos : null,
    motos: typeof detalle.motos === 'number' ? detalle.motos : null,
  }
}

export async function importacionesDelVps(): Promise<RegistroDeImportaciones> {
  const vps = fuente()
  if (!vps) return { enCurso: false, importaciones: [], error: 'Esta computadora no está conectada al VPS.' }
  try {
    const { enCurso, importaciones } = await vps.importacionesDeVehiculos()
    return {
      enCurso,
      importaciones: importaciones.map(comoImportacion).filter((importacion): importacion is ImportacionDelCatalogo => importacion !== null),
      error: null,
    }
  } catch (error) {
    return { enCurso: false, importaciones: [], error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Le pide al VPS que busque ya la edición vigente de la DNRPA (sin esperar a su reloj) y después baja
 * lo nuevo a esta computadora.
 */
export async function importarAhora(forzar: boolean, avisar: (progreso: ProgresoDeCatalogo) => void): Promise<ResultadoDeImportarAhora> {
  const vps = fuente()
  if (!vps) throw new ErrorDeNegocio('Esta computadora no está conectada al VPS.')
  avisar({ etapa: 'pidiendo', detalle: 'El servidor está leyendo la tabla de la DNRPA (puede tardar un minuto)…' })
  const { sinNovedades, importacion } = await vps.importarVehiculos(forzar)
  const estado = await bajarCatalogo(avisar)
  return { sinNovedades, importacion: comoImportacion(importacion), estado }
}
