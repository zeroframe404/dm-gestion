// El contrato que cumple cada compañía del multicotizador. Sumar una aseguradora es escribir un archivo
// que cumpla esto (ver galeno.ts) y agregarlo a registro.ts: ni la pantalla ni el servicio cambian.
import type {
  AjusteDeAseguradora,
  CoberturaCotizada,
  EstadoDeCotizacion,
  IdAseguradora,
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
}
