// Listado de Asegurados: los clientes de la cartera. Estos tipos los puede cambiar con libertad quien
// construye la pantalla; ver el contrato en ./index.ts.
//
// Todo sale de lo que ya está en la base (sin columnas nuevas): el tipo de documento se DEDUCE del
// número y el productor se toma de las pólizas del cliente.

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

export interface FiltrosDeAsegurados {
  /** Texto libre: nombre, documento, email o celular. Vacío = todos. */
  busqueda: string
  /** Productores elegidos: entra el cliente que tenga ALGUNA póliza con ALGUNO de ellos. Vacío = todos. */
  productores: string[]
  /** Sucursales elegidas. Vacío = todas. */
  sucursales: string[]
  /** Tipos de documento elegidos. Vacío = todos. */
  tiposDeDocumento: TipoDeDocumentoFiltrable[]
}

export const FILTROS_DE_ASEGURADOS_VACIOS: FiltrosDeAsegurados = {
  busqueda: '',
  productores: [],
  sucursales: [],
  tiposDeDocumento: [],
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
}
