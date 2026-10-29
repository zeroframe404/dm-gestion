// Listado de Pólizas: la cartera de pólizas. Estos tipos los puede cambiar con libertad quien construye
// la pantalla; ver el contrato en ./index.ts.

/**
 * El estado que se ve en el listado. Sale de `estadoDePoliza()` (shared/polizas.ts: ACTIVA, VENCIDA,
 * RENOVADA, BAJA) más una distinción que sólo hace falta acá: una póliza activa cuya vigencia todavía
 * no empezó es «Programada». El modelo no tiene un estado «Anulada» aparte: una póliza anulada es una BAJA.
 */
export const ESTADOS_DEL_LISTADO_DE_POLIZAS = ['PROGRAMADA', 'VIGENTE', 'VENCIDA', 'RENOVADA', 'BAJA'] as const
export type EstadoDePolizaListado = (typeof ESTADOS_DEL_LISTADO_DE_POLIZAS)[number]

export const NOMBRE_ESTADO_DEL_LISTADO_DE_POLIZAS: Record<EstadoDePolizaListado, string> = {
  PROGRAMADA: 'Programada',
  VIGENTE: 'Vigente',
  VENCIDA: 'Vencida',
  RENOVADA: 'Renovada',
  BAJA: 'Baja',
}

export interface FiltrosDePolizasListado {
  /** Texto libre: número de póliza, cliente, documento o patente. Vacío = todas. */
  busqueda: string
  /** Vacías = todas, igual que en el resto de los filtros (shared/filtros.ts). */
  companias: string[]
  ramos: string[]
  estados: EstadoDePolizaListado[]
  productores: string[]
  /**
   * Rango de vigencia, 'AAAA-MM-DD' (vacío = sin límite). Entra la póliza cuya vigencia se SUPERPONE con
   * el rango; una póliza sin fechas cargadas no entra en cuanto se pone algún límite.
   */
  vigenciaDesde: string
  vigenciaHasta: string
}

export interface FilaDePolizaListado {
  polizaId: number
  clienteId: number
  compania: string | null
  numero: string | null
  /** «Auto», «Moto», «Hogar»…: la rama del vehículo o el tipo de riesgo. null si no hay riesgo cargado. */
  ramo: string | null
  cliente: string
  /** Lo asegurado: el vehículo, el domicilio… */
  riesgo: string | null
  /** AAAA-MM-DD */
  vigenciaDesde: string | null
  /** AAAA-MM-DD */
  vigenciaHasta: string | null
  estado: EstadoDePolizaListado
  productor: string | null
}
