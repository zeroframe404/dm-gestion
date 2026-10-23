// El contrato que cumple cada compañía del multicotizador. Sumar una aseguradora es escribir un archivo
// que cumpla esto (ver galeno.ts) y agregarlo a registro.ts: ni la pantalla ni el servicio cambian.
import type {
  AjusteDeAseguradora,
  CoberturaCotizada,
  CotizacionListada,
  EmisionListada,
  EstadoDeCotizacion,
  FiltrosDeListado,
  IdAseguradora,
  PlanListado,
  SolicitudDeCotizacion,
} from '../../shared/multicotizador'
import type { TipoDeVehiculo } from '../../shared/tipos'

/** Lo que devuelve un adaptador. El servicio le agrega el id, el nombre y cuánto tardó. */
export interface CotizacionDeAseguradora {
  estado: EstadoDeCotizacion
  mensaje: string | null
  descripcionVehiculo: string
  coberturas: CoberturaCotizada[]
  avisos: string[]
  ajustes: AjusteDeAseguradora[]
  /** Ver `ResultadoDeAseguradora.revisar`. */
  revisar?: string
  /** Ver `ResultadoDeAseguradora.detalleTecnico`. */
  detalleTecnico?: unknown
}

/** La solicitud con lo que el proceso principal ya resolvió por su cuenta. */
export interface SolicitudResuelta extends SolicitudDeCotizacion {
  /** El CODIA de InfoAuto del vehículo, si el catálogo de la agencia es el de InfoAuto. */
  codigoInfoAuto: string | null
}

export interface CotizadorDeAseguradora {
  id: IdAseguradora
  nombre: string
  tipos: readonly TipoDeVehiculo[]
  /** true si una cobertura cotizada se puede emitir desde la aplicación. */
  emite: boolean
  /** Null si está lista para cotizar; si no, por qué no. No sale a internet: tiene que ser instantáneo. */
  noDisponible(): string | null
  /** Las localidades que la compañía conoce para ese código postal (sus nombres). Opcional. */
  localidades?(tipo: TipoDeVehiculo, codigoPostal: string): Promise<string[]>
  /**
   * Cotiza. `elegidos` son las decisiones propias de la compañía que la persona cambió a mano (por
   * `campo` de `AjusteDeAseguradora`); lo que no esté ahí lo decide el adaptador.
   *
   * Si falta algo que el adaptador no puede decidir solo, NO tira error: devuelve `FALTAN_DATOS` con
   * todos los ajustes que sí pudo armar, para que se complete todo de una sola vez.
   */
  cotizar(solicitud: SolicitudResuelta, elegidos: Record<string, string>): Promise<CotizacionDeAseguradora>

  /**
   * Los listados del Multicotizador, desde la API de la compañía. Son opcionales: la compañía cuya API
   * no da ese listado no lo implementa, y el servicio muestra lo que haya en la base del VPS, marcado.
   * Igual que `cotizar`, sólo se llaman con `noDisponible()` en null.
   */
  planes?(tipo: TipoDeVehiculo): Promise<PlanDeAseguradora[]>
  cotizaciones?(filtros: FiltrosDeListado): Promise<CotizacionDeLaApi[]>
  emisiones?(filtros: FiltrosDeListado): Promise<EmisionDeLaApi[]>
}

/** Lo que devuelve un adaptador por cada fila: el servicio le agrega la compañía y el origen. */
type SinCompania<T> = Omit<T, 'origen' | 'aseguradora' | 'nombreAseguradora' | 'motivoVps'>
export type PlanDeAseguradora = Omit<PlanListado, 'aseguradora' | 'nombreAseguradora' | 'tipo'>
export type CotizacionDeLaApi = SinCompania<CotizacionListada>
export type EmisionDeLaApi = SinCompania<EmisionListada>
