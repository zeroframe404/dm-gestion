// Las tablas de parámetros de ATM: marcas, modelos, códigos de InfoAuto, usos, localidades…
//
// ATM NO las da por su API: las deja todas las noches en un FTP (capítulo 11 del manual) y cada
// productor las baja de ahí. Sin ellas no hay con qué traducir el vehículo de la agencia al código que
// ATM entiende (`cod_infoauto` + su código de uso), así que el multicotizador las necesita sí o sí.
//
// Lo de este archivo es PURO —leer los archivos y armar el catálogo— y se prueba solo. Bajarlas por
// FTP, guardarlas en disco y tenerlas en memoria es repositorio.ts.
//
// EL FORMATO: el manual da los nombres de las tablas y de sus columnas, pero no cómo vienen los
// archivos. Al escribir esto no se pudo entrar al FTP (desde donde se programó sólo sale HTTPS), así
// que el lector acepta lo razonable: texto separado por `;`, `|`, tabulador o coma (con o sin fila de
// encabezado, entre comillas o no, en UTF-8 o en Latin-1), JSON o XML, sueltos o adentro de un .zip o
// un .gz. Lo que no entienda lo dice por tabla en API Aseguradoras → ATM, en vez de cotizar mal.
import { gunzipSync, inflateRawSync } from 'node:zlib'
import { normalizarTexto } from '../../../shared/multicotizador'
import { aObjeto, leerXml } from './xml'

export const TABLAS_ATM = [
  'ws_au_marca_modelo',
  'ws_au_infoauto',
  'ws_au_marcas',
  'ws_au_localidades',
  'ws_au_usos',
  'ws_au_rastreo_satelital',
  'ws_au_iva',
  'ws_au_tipo_persona',
] as const
export type TablaAtm = (typeof TABLAS_ATM)[number]

/** Sin éstas no se puede cotizar: hace falta al menos una de las dos para encontrar el vehículo. */
export const TABLAS_DE_VEHICULOS: readonly TablaAtm[] = ['ws_au_marca_modelo', 'ws_au_infoauto']

/** Para qué sirve cada una, en castellano, para la pantalla. */
export const DESCRIPCION_TABLA_ATM: Record<TablaAtm, string> = {
  ws_au_marca_modelo: 'Marcas y modelos (con su código de InfoAuto y de uso)',
  ws_au_infoauto: 'Sumas aseguradas por año (InfoAuto)',
  ws_au_marcas: 'Marcas (auto o moto)',
  ws_au_localidades: 'Localidades por código postal',
  ws_au_usos: 'Usos del vehículo',
  ws_au_rastreo_satelital: 'Equipos de rastreo satelital',
  ws_au_iva: 'Condiciones de IVA',
  ws_au_tipo_persona: 'Tipos de persona',
}

/** Las columnas de cada tabla, en el orden del manual: es lo que se usa si el archivo no trae encabezado. */
const COLUMNAS: Record<TablaAtm, string[]> = {
  ws_au_marca_modelo: ['cod_marca', 'marca', 'cod_modelo', 'modelo', 'tau_codia', 'cod_uso', 'tipo_uso'],
  ws_au_infoauto: [
    'tau_nmarc',
    'tau_marca',
    'tau_nmode',
    'tau_model',
    'tau_codia',
    'tau_cgrup',
    'tau_creas',
    'tau_anioe',
    ...Array.from({ length: 30 }, (_, i) => `tau_pre${String(i + 1).padStart(2, '0')}`),
  ],
  ws_au_marcas: ['codigo', 'descripcion', 'seccion'],
  ws_au_localidades: ['codpos', 'localidad', 'provincia', 'codpro', 'subcodpos'],
  ws_au_usos: ['codigo', 'descripcion'],
  ws_au_rastreo_satelital: ['codigo', 'descripcion'],
  ws_au_iva: ['codigo', 'descripcion'],
  ws_au_tipo_persona: ['codigo', 'descripcion'],
}

export type FilaDeTabla = Record<string, string>

// ---------------------------------------------------------------------------
// Los archivos
// ---------------------------------------------------------------------------

/**
 * A qué tabla corresponde un archivo, por su nombre: «WS_AU_MARCA_MODELO.txt», «ws_au_infoauto_20261009.csv»…
 * Las de nombre más largo se prueban primero, así «ws_au_marca_modelo» no se confunde con «ws_au_marcas».
 */
export function tablaDelArchivo(nombre: string): TablaAtm | null {
  const base = nombre.toLowerCase().replace(/\\/g, '/').split('/').pop() ?? ''
  const plano = base.replace(/[\s-]+/g, '_')
  const ordenadas = [...TABLAS_ATM].sort((a, b) => b.length - a.length)
  return ordenadas.find((tabla) => plano.includes(tabla)) ?? null
}

export interface ArchivoSuelto {
  nombre: string
  bytes: Buffer
}

/** Los archivos que hay adentro de un .zip (sólo los comprimidos con «deflate» o sin comprimir). */
export function archivosDelZip(zip: Buffer): ArchivoSuelto[] {
  // El directorio central está al final: se busca la firma del «fin de directorio» de atrás para adelante.
  let fin = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      fin = i
      break
    }
  }
  if (fin < 0) throw new Error('El .zip está dañado (no tiene directorio).')
  const cantidad = zip.readUInt16LE(fin + 10)
  let posicion = zip.readUInt32LE(fin + 16)
  const archivos: ArchivoSuelto[] = []
  for (let n = 0; n < cantidad; n++) {
    if (zip.readUInt32LE(posicion) !== 0x02014b50) throw new Error('El .zip está dañado (directorio ilegible).')
    const metodo = zip.readUInt16LE(posicion + 10)
    const comprimido = zip.readUInt32LE(posicion + 20)
    const largoNombre = zip.readUInt16LE(posicion + 28)
    const largoExtra = zip.readUInt16LE(posicion + 30)
    const largoComentario = zip.readUInt16LE(posicion + 32)
    const local = zip.readUInt32LE(posicion + 42)
    const nombre = zip.subarray(posicion + 46, posicion + 46 + largoNombre).toString('utf8')
    posicion += 46 + largoNombre + largoExtra + largoComentario
    if (nombre.endsWith('/')) continue
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`El .zip está dañado (${nombre}).`)
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const datos = zip.subarray(inicio, inicio + comprimido)
    if (metodo === 0) archivos.push({ nombre, bytes: Buffer.from(datos) })
    else if (metodo === 8) archivos.push({ nombre, bytes: inflateRawSync(datos) })
    else throw new Error(`El .zip usa una compresión que no se puede leer (${nombre}).`)
  }
  return archivos
}

/** Un archivo tal como vino (suelto, .zip o .gz) → los archivos de datos que trae. */
export function expandirArchivo(archivo: ArchivoSuelto): ArchivoSuelto[] {
  const { bytes, nombre } = archivo
  if (bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50) return archivosDelZip(bytes).flatMap(expandirArchivo)
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return [{ nombre: nombre.replace(/\.gz$/i, ''), bytes: gunzipSync(bytes) }]
  return [archivo]
}

/** UTF-8 si lo es (con o sin BOM); si no, Latin-1, que es como suelen salir los sistemas viejos. */
export function decodificar(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

// ---------------------------------------------------------------------------
// Las filas
// ---------------------------------------------------------------------------

/** El nombre de una columna como se compara: minúsculas, sin tildes ni comillas ni espacios. */
function columna(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^["']|["']$/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
}

/** Una línea separada por `separador`, respetando los campos entre comillas dobles ("" es una comilla). */
export function partirLinea(linea: string, separador: string): string[] {
  const campos: string[] = []
  let actual = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i]!
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"'
        i++
      } else if (c === '"') entreComillas = false
      else actual += c
    } else if (c === '"' && actual.trim() === '') {
      entreComillas = true
      actual = ''
    } else if (c === separador) {
      campos.push(actual.trim())
      actual = ''
    } else actual += c
  }
  campos.push(actual.trim())
  return campos
}

const SEPARADORES = [';', '|', '\t', ','] as const

/**
 * El separador de un texto: el que aparece la misma cantidad de veces (y al menos una) en la mayoría
 * de las primeras líneas. La coma va última porque también es la coma decimal de los importes.
 */
export function separadorDe(lineas: string[]): string | null {
  const muestra = lineas.slice(0, 30)
  let mejor: { separador: string; puntaje: number } | null = null
  for (const separador of SEPARADORES) {
    const cuentas = muestra.map((linea) => partirLinea(linea, separador).length - 1)
    const frecuencias = new Map<number, number>()
    for (const cuenta of cuentas) if (cuenta > 0) frecuencias.set(cuenta, (frecuencias.get(cuenta) ?? 0) + 1)
    const [moda, veces] = [...frecuencias].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [0, 0]
    if (moda === 0 || veces < Math.ceil(muestra.length * 0.6)) continue
    const puntaje = veces * 1000 + moda
    if (!mejor || puntaje > mejor.puntaje) mejor = { separador, puntaje }
  }
  return mejor?.separador ?? null
}

function filasDeObjetos(objetos: unknown[]): FilaDeTabla[] {
  return objetos.flatMap((objeto) => {
    if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return []
    const fila: FilaDeTabla = {}
    for (const [clave, valor] of Object.entries(objeto as Record<string, unknown>)) {
      if (valor === null || valor === undefined) fila[columna(clave)] = ''
      else if (typeof valor !== 'object') fila[columna(clave)] = String(valor).trim()
    }
    return Object.keys(fila).length > 0 ? [fila] : []
  })
}

export class FormatoDeTablaNoReconocido extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'FormatoDeTablaNoReconocido'
  }
}

/**
 * Las filas de una tabla, con las columnas nombradas como en el manual (en minúsculas). Si el archivo
 * trae encabezado se usa; si no, se asume el orden del manual. Tira `FormatoDeTablaNoReconocido` si no
 * puede leerlo.
 */
export function leerFilas(texto: string, tabla: TablaAtm): FilaDeTabla[] {
  const limpio = texto.replace(/^﻿/, '').trim()
  if (!limpio) return []
  const esperadas = COLUMNAS[tabla]

  if (limpio.startsWith('[') || limpio.startsWith('{')) {
    let datos: unknown
    try {
      datos = JSON.parse(limpio)
    } catch {
      throw new FormatoDeTablaNoReconocido('parece JSON pero no se puede leer')
    }
    if (Array.isArray(datos)) return filasDeObjetos(datos)
    const lista = Object.values(datos as Record<string, unknown>).find(Array.isArray)
    if (lista) return filasDeObjetos(lista)
    throw new FormatoDeTablaNoReconocido('el JSON no trae una lista de filas')
  }

  if (limpio.startsWith('<')) {
    let raiz
    try {
      raiz = leerXml(limpio)
    } catch (error) {
      throw new FormatoDeTablaNoReconocido(`parece XML pero no se puede leer (${error instanceof Error ? error.message : String(error)})`)
    }
    // <tabla><fila><columna>…</columna></fila>…</tabla>, con o sin un nivel más de envoltorio.
    const filas = raiz.hijos.length === 1 && raiz.hijos[0]!.hijos.every((h) => h.hijos.length > 0) ? raiz.hijos[0]!.hijos : raiz.hijos
    return filasDeObjetos(filas.map((fila) => aObjeto(fila)))
  }

  const lineas = limpio.split(/\r?\n/).filter((linea) => linea.trim().length > 0)
  const separador = separadorDe(lineas)
  if (!separador) throw new FormatoDeTablaNoReconocido('no se encontró el separador de columnas (se probó ; | tabulador y coma)')
  const primera = partirLinea(lineas[0]!, separador).map(columna)
  const conEncabezado = primera.filter((nombre) => esperadas.includes(nombre)).length >= Math.min(2, esperadas.length)
  const nombres = conEncabezado ? primera : esperadas
  const datos = conEncabezado ? lineas.slice(1) : lineas
  if (!conEncabezado && partirLinea(lineas[0]!, separador).length < esperadas.length) {
    throw new FormatoDeTablaNoReconocido(
      `no trae encabezado y tiene menos columnas (${partirLinea(lineas[0]!, separador).length}) que las del manual (${esperadas.length})`,
    )
  }
  return datos.map((linea) => {
    const campos = partirLinea(linea, separador)
    const fila: FilaDeTabla = {}
    nombres.forEach((nombre, i) => {
      if (nombre) fila[nombre] = (campos[i] ?? '').trim()
    })
    return fila
  })
}

// ---------------------------------------------------------------------------
// El catálogo de ATM armado con las tablas
// ---------------------------------------------------------------------------

/** Un vehículo en el catálogo de ATM: una versión con su código de InfoAuto. */
export interface VehiculoAtm {
  /** El código de InfoAuto (`cod_infoauto`). Es la clave: lo que se manda para cotizar. */
  codigoInfoAuto: string
  marca: string
  /** La descripción del modelo o versión, como la escribe ATM. */
  modelo: string
  /** 3 autos, 4 motos; null si las tablas no lo dicen (entonces vale para los dos). */
  seccion: '3' | '4' | null
  /** Los usos con que ATM lo cotiza: su código y si es particular (1) o comercial (2). */
  usos: Array<{ codigo: string; tipoUso: string }>
  /** Año → suma asegurada que usa ATM. Null si no se tiene la tabla de InfoAuto. */
  sumas: Map<number, number> | null
}

export interface LocalidadAtm {
  codigoPostal: string
  subCodigoPostal: string
  localidad: string
  provincia: string
}

export interface OpcionAtm {
  codigo: string
  descripcion: string
}

export interface TablasAtm {
  vehiculos: VehiculoAtm[]
  localidades: LocalidadAtm[]
  usos: OpcionAtm[]
  rastreos: OpcionAtm[]
  ivas: OpcionAtm[]
  personas: OpcionAtm[]
}

/** Un importe de las tablas de ATM: «21800000.00», «21800000,00», «21.800.000,00». */
function importe(valor: string | undefined): number {
  const limpio = (valor ?? '').trim()
  if (!limpio) return 0
  const normalizado = /,\d{1,2}$/.test(limpio) ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '')
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : 0
}

/** Un código numérico sin los ceros de adelante que algunos sistemas agregan («0460711» y «460711»). */
export function codigoSinCeros(valor: string | undefined): string {
  const limpio = (valor ?? '').trim()
  return /^\d+$/.test(limpio) ? String(Number(limpio)) : limpio
}

function opciones(filas: FilaDeTabla[] | undefined): OpcionAtm[] {
  return (filas ?? [])
    .map((fila) => ({ codigo: (fila.codigo ?? '').trim(), descripcion: (fila.descripcion ?? '').trim() }))
    .filter((opcion) => opcion.codigo)
}

/**
 * Las sumas de una fila de `ws_au_infoauto`: `tau_pre01` es la del año `tau_anioe`, `tau_pre02` la
 * del año anterior, y así para atrás. Los años sin suma (0 o vacío) no se ofrecen.
 */
export function sumasDeInfoAuto(fila: FilaDeTabla): Map<number, number> {
  const sumas = new Map<number, number>()
  const desde = Number(fila.tau_anioe)
  if (!Number.isInteger(desde) || desde < 1900) return sumas
  for (let i = 1; i <= 30; i++) {
    const suma = importe(fila[`tau_pre${String(i).padStart(2, '0')}`])
    if (suma > 0) sumas.set(desde - (i - 1), suma)
  }
  return sumas
}

function seccionDe(valor: string | undefined): '3' | '4' | null {
  const limpio = codigoSinCeros(valor)
  return limpio === '3' || limpio === '4' ? limpio : null
}

/** Arma el catálogo con las filas de cada tabla que se haya podido leer. */
export function armarTablas(filas: Partial<Record<TablaAtm, FilaDeTabla[]>>): TablasAtm {
  const seccionPorMarca = new Map<string, '3' | '4'>()
  for (const fila of filas.ws_au_marcas ?? []) {
    const seccion = seccionDe(fila.seccion)
    if (seccion) seccionPorMarca.set(codigoSinCeros(fila.codigo), seccion)
  }

  const infoauto = new Map<string, FilaDeTabla>()
  for (const fila of filas.ws_au_infoauto ?? []) {
    const codia = codigoSinCeros(fila.tau_codia)
    if (codia) infoauto.set(codia, fila)
  }

  const vehiculos = new Map<string, VehiculoAtm>()
  for (const fila of filas.ws_au_marca_modelo ?? []) {
    const codia = codigoSinCeros(fila.tau_codia)
    if (!codia) continue
    let vehiculo = vehiculos.get(codia)
    if (!vehiculo) {
      const deInfoAuto = infoauto.get(codia)
      vehiculo = {
        codigoInfoAuto: codia,
        marca: (fila.marca || deInfoAuto?.tau_marca || '').trim(),
        modelo: (fila.modelo || deInfoAuto?.tau_model || '').trim(),
        seccion: seccionPorMarca.get(codigoSinCeros(fila.cod_marca)) ?? null,
        usos: [],
        sumas: deInfoAuto ? sumasDeInfoAuto(deInfoAuto) : null,
      }
      vehiculos.set(codia, vehiculo)
    }
    const uso = { codigo: (fila.cod_uso ?? '').trim(), tipoUso: codigoSinCeros(fila.tipo_uso) }
    if (uso.codigo && !vehiculo.usos.some((u) => u.codigo === uso.codigo)) vehiculo.usos.push(uso)
  }
  // Sin la tabla de marcas y modelos (o con versiones que no figuran ahí), las de InfoAuto: sirven para
  // las motos (que no llevan código de uso) y, con la lista de usos, para los autos.
  for (const [codia, fila] of infoauto) {
    if (vehiculos.has(codia)) continue
    vehiculos.set(codia, {
      codigoInfoAuto: codia,
      marca: (fila.tau_marca ?? '').trim(),
      modelo: (fila.tau_model ?? '').trim(),
      seccion: null,
      usos: [],
      sumas: sumasDeInfoAuto(fila),
    })
  }

  const localidades = (filas.ws_au_localidades ?? [])
    .map((fila) => ({
      codigoPostal: codigoSinCeros(fila.codpos).padStart(4, '0'),
      subCodigoPostal: (fila.subcodpos ?? '').trim(),
      localidad: (fila.localidad ?? '').trim(),
      provincia: (fila.provincia ?? '').trim(),
    }))
    .filter((localidad) => /^\d{4}$/.test(localidad.codigoPostal) && localidad.localidad)

  return {
    vehiculos: [...vehiculos.values()].filter((vehiculo) => vehiculo.marca && vehiculo.modelo),
    localidades,
    usos: opciones(filas.ws_au_usos),
    rastreos: opciones(filas.ws_au_rastreo_satelital),
    ivas: opciones(filas.ws_au_iva),
    personas: opciones(filas.ws_au_tipo_persona),
  }
}

/** Las marcas que ATM tiene para esa sección, sin repetir, en orden alfabético. */
export function marcasDeAtm(tablas: TablasAtm, seccion: '3' | '4'): string[] {
  const vistas = new Map<string, string>()
  for (const vehiculo of tablas.vehiculos) {
    if (vehiculo.seccion && vehiculo.seccion !== seccion) continue
    const clave = normalizarTexto(vehiculo.marca)
    if (!vistas.has(clave)) vistas.set(clave, vehiculo.marca)
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

/**
 * Las versiones de una marca para esa sección y ese año. Si se tienen las sumas de InfoAuto, sólo las
 * que ATM tiene para ese año: cotizar un año que no tiene da «La relación vehículo - año de fabricación
 * no es válida». Con `anio` null, todas las de la marca.
 */
export function versionesDeAtm(tablas: TablasAtm, seccion: '3' | '4', marca: string, anio: number | null): VehiculoAtm[] {
  const buscada = normalizarTexto(marca)
  return tablas.vehiculos
    .filter((vehiculo) => normalizarTexto(vehiculo.marca) === buscada)
    .filter((vehiculo) => !vehiculo.seccion || vehiculo.seccion === seccion)
    .filter((vehiculo) => anio === null || !vehiculo.sumas || vehiculo.sumas.size === 0 || vehiculo.sumas.has(anio))
    .sort((a, b) => a.modelo.localeCompare(b.modelo, 'es'))
}

/** Las localidades de un código postal (con su sub-código). */
export function localidadesDeAtm(tablas: TablasAtm, codigoPostal: string): LocalidadAtm[] {
  return tablas.localidades.filter((localidad) => localidad.codigoPostal === codigoPostal)
}
