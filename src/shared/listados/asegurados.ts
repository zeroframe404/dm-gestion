// Listado de Asegurados: los clientes de la cartera. Estos tipos los puede cambiar con libertad quien
// construye la pantalla; ver el contrato en ./index.ts.
//
// Todo sale de lo que ya está en la base (sin columnas nuevas): el tipo de documento se DEDUCE del
// número y el productor se toma de las pólizas del cliente.
//
// Las aseguradoras salen de dos lados, y cada una dice de cuál:
//  - «API»: la propia aseguradora confirmó por su API que el cliente tiene una póliza vigente con ella
//    (Galeno, ATM, Equidad: ver servicios/aseguradorasPorApi.ts). Es la fuente principal.
//  - «VPS»: lo que dice la cartera de la agencia (la columna COMPAÑÍA de sus pólizas, que vive en el VPS).
//    Se usa cuando la aseguradora no tiene API de cartera o todavía no confirmó a ese cliente.

/** Los tipos de documento que se pueden elegir en el filtro. `OTRO` = sin documento o con un número que no es DNI ni CUIT/CUIL. */
export const TIPOS_DE_DOCUMENTO_FILTRABLES = ['DNI', 'CUIT', 'CUIL', 'OTRO'] as const
export type TipoDeDocumentoFiltrable = (typeof TIPOS_DE_DOCUMENTO_FILTRABLES)[number]

/** Cómo se lee cada opción del filtro «Tipo de documento». */
export const TEXTO_DE_TIPO_DE_DOCUMENTO: Record<TipoDeDocumentoFiltrable, string> = {
  DNI: 'DNI',
  CUIT: 'CUIT (empresas)',
  CUIL: 'CUIL / CUIT de persona',
  OTRO: 'Otro o sin documento',
}

/** De dónde salió que el cliente está con esa aseguradora. */
export const FUENTES_DE_ASEGURADORA = ['API', 'VPS'] as const
export type FuenteDeAseguradora = (typeof FUENTES_DE_ASEGURADORA)[number]

export const TEXTO_DE_FUENTE_DE_ASEGURADORA: Record<FuenteDeAseguradora, string> = {
  API: 'Confirmada por API',
  VPS: 'Según la cartera (VPS)',
}

export interface AseguradoraDelAsegurado {
  /** Cómo se muestra: la grafía más usada en la cartera («GALENO», «LA EQUIDAD»…). */
  nombre: string
  fuente: FuenteDeAseguradora
}

/**
 * La clave con que se agrupa una aseguradora: «La Equidad», «EQUIDAD SEGUROS» y «equidad» son la misma.
 * Las que tienen API se reconocen por su palabra; el resto queda por su texto normalizado.
 */
export function claveDeAseguradora(nombre: string | null | undefined): string {
  const texto = (nombre ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
  if (!texto) return ''
  if (/\bGALENO\b/.test(texto)) return 'GALENO'
  if (/\bATM\b/.test(texto)) return 'ATM'
  if (/\bEQUIDAD\b/.test(texto)) return 'EQUIDAD'
  if (/\bMERCANTIL\b/.test(texto)) return 'MERCANTIL'
  return texto
}

/** Las aseguradoras que tienen una integración por API en el sistema (API Aseguradoras). */
export const ASEGURADORAS_CON_API = ['GALENO', 'ATM', 'EQUIDAD', 'MERCANTIL'] as const
export type AseguradoraConApi = (typeof ASEGURADORAS_CON_API)[number]

export const NOMBRE_DE_ASEGURADORA_CON_API: Record<AseguradoraConApi, string> = {
  GALENO: 'Galeno',
  ATM: 'ATM',
  EQUIDAD: 'La Equidad',
  MERCANTIL: 'Mercantil Andina',
}

/**
 * Cómo se le pregunta a cada API quién está asegurado con ella:
 *  - CARTERA: una sola consulta trae todas las pólizas vigentes del productor (Galeno).
 *  - POR_CLIENTE: se pregunta cliente por cliente —por DNI (ATM) o por patente (Equidad)— sólo por los
 *    que la cartera dice que están con esa compañía. Confirma lo que dice el VPS; no descubre clientes nuevos.
 *  - SIN_CONSULTA: la integración no tiene un servicio de cartera (Mercantil: sólo cotiza).
 */
export type ModoDeConsultaDeApi = 'CARTERA' | 'POR_CLIENTE' | 'SIN_CONSULTA'

export interface EstadoDeApiDeAsegurados {
  aseguradora: AseguradoraConApi
  nombre: string
  modo: ModoDeConsultaDeApi
  /** Cuándo terminó la última consulta que anduvo. null = nunca. */
  consultadoEn: string | null
  /** Clientes (documentos) que la API confirmó. */
  confirmados: number
  /** Lo que falló la última vez (sin cuenta cargada, sin conexión…). null si anduvo. */
  error: string | null
  /** Clientes que faltan preguntar (POR_CLIENTE): se completan en las próximas pasadas. */
  pendientes: number
}

export interface EstadoDeApisDeAsegurados {
  enCurso: boolean
  apis: EstadoDeApiDeAsegurados[]
}

export interface FiltrosDeAsegurados {
  /** Texto libre: nombre, documento, email o celular. Vacío = todos. */
  busqueda: string
  /** Productores elegidos: entra el cliente que tenga ALGUNA póliza con ALGUNO de ellos. Vacío = todos. */
  productores: string[]
  /** Sucursales elegidas. Vacío = todas. */
  sucursales: string[]
  /** Tipos de documento elegidos. Vacío = todos. */
  tiposDeDocumento: TipoDeDocumentoFiltrable[]
  /** Aseguradoras elegidas: entra el cliente que esté con ALGUNA. Vacío = todas. */
  aseguradoras: string[]
  /** De dónde tiene que salir el dato de la aseguradora (API o VPS). Vacío = de cualquiera. */
  fuentes: FuenteDeAseguradora[]
}

export const FILTROS_DE_ASEGURADOS_VACIOS: FiltrosDeAsegurados = {
  busqueda: '',
  productores: [],
  sucursales: [],
  tiposDeDocumento: [],
  aseguradoras: [],
  fuentes: [],
}

export interface FilaDeAsegurado {
  clienteId: number
  nombreCompleto: string
  /** «DNI», «CUIT» o «CUIL», deducido del número. null si no hay documento o no se reconoce. */
  tipoDocumento: string | null
  /** El número como se lee («12.345.678», «20-12345678-9»); si no se reconoce, tal cual está cargado. */
  documento: string | null
  email: string | null
  /** El teléfono de la ficha (en la agencia es el celular y el WhatsApp: hay un solo número por cliente). */
  celular: string | null
  /**
   * Lo que se muestra en la columna Productor: TODOS los productores de sus pólizas separados por coma,
   * el que más pólizas tiene primero. Se cuentan las pólizas vigentes; si el cliente no tiene ninguna
   * vigente (una baja), se cuentan todas las que tuvo. null si ninguna póliza tiene productor.
   */
  productor: string | null
  /** Los mismos productores como lista (con la grafía más usada de cada uno): alimenta el filtro. */
  productores: string[]
  /** Sucursal de la ficha, con el nombre del catálogo si lo reconoce. Alimenta el filtro. */
  sucursal: string | null
  /** Con qué aseguradoras está, y de dónde salió cada una: primero las confirmadas por API. */
  aseguradoras: AseguradoraDelAsegurado[]
  /** Cuántas pólizas vigentes tiene (según la cartera). */
  polizasVigentes: number
}
