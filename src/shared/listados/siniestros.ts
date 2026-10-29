// Listado de Siniestros. Estos tipos los puede cambiar con libertad quien construye la pantalla; ver el
// contrato en ./index.ts.
import type { EstadoSiniestro } from '../tipos'

export interface FiltrosDeSiniestrosListado {
  /** Texto libre: número de siniestro, póliza, asegurado, documento o patente. Vacío = todos. */
  busqueda: string
  /** Compañías elegidas (vacío = todas). */
  companias: string[]
  /** Estados elegidos, de los cinco que ya usa el módulo Siniestros (vacío = todos). */
  estados: EstadoSiniestro[]
  /** Productores de la póliza (vacío = todos). */
  productores: string[]
  /** Fecha del siniestro desde (AAAA-MM-DD, inclusive). Vacío = sin límite. */
  fechaDesde: string
  /** Fecha del siniestro hasta (AAAA-MM-DD, inclusive). Vacío = sin límite. */
  fechaHasta: string
}

export interface FilaDeSiniestroListado {
  siniestroId: number
  clienteId: number | null
  polizaId: number | null
  compania: string | null
  numero: string | null
  /**
   * Qué fue el siniestro. No existe un campo «tipo»: es la descripción corta que se cargó o, si no hay y el
   * siniestro menciona un robo, «Robo». Sin ninguna de las dos queda vacío (no se inventan categorías).
   */
  tipo: string | null
  numeroDePoliza: string | null
  ramo: string | null
  /** AAAA-MM-DD: el día del siniestro (o, si no se cargó, el de la carga). */
  fecha: string | null
  asegurado: string | null
  riesgo: string | null
  /** Uno de los cinco estados del módulo Siniestros. */
  estado: EstadoSiniestro
  productor: string | null
}
