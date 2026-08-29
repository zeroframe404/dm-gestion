// La forma que tiene que tener cualquier proveedor de catálogo de vehículos.
//
// Va aparte del adaptador a propósito: el servicio no sabe nunca que del otro lado hay InfoAuto. El
// día que la agencia cambie de proveedor —o quiera una segunda fuente sólo para motos— se escribe
// otro archivo que cumpla esta interfaz y no se toca ni la caché, ni el selector, ni la pantalla.
import type { CategoriaDeVehiculo, TipoDeVehiculo } from '../../shared/tipos'

export interface MarcaCruda {
  id: string
  nombre: string
}

export interface ModeloCrudo {
  id: string
  marcaId: string
  nombre: string
}

/**
 * Una línea es la versión concreta —el «codia» de InfoAuto— y es el único nivel que trae categoría y
 * años. `categoriaCruda` se guarda tal cual la dijo la API, además de la nuestra ya traducida: si el
 * mapeo resulta estar mal, se corrige sin volver a bajar decenas de miles de filas.
 */
export interface LineaCruda {
  id: string
  marcaId: string
  modeloId: string
  nombre: string
  anioDesde: number | null
  anioHasta: number | null
  categoriaCruda: string | null
  categoria: CategoriaDeVehiculo | null
  precioLista: number | null
}

export interface PruebaDeProveedor {
  ok: boolean
  detalle: string
  marcasEncontradas: number
}

export class ErrorDeProveedor extends Error {
  constructor(
    mensaje: string,
    /** true si fue «no hay internet» y no «el proveedor dijo que no»: se reintenta distinto. */
    readonly esDeRed: boolean,
  ) {
    super(mensaje)
    this.name = 'ErrorDeProveedor'
  }
}

export interface ProveedorDeVehiculos {
  readonly nombre: string
  /** Los tipos que este proveedor puede servir. La agencia puede tener autos y no motos. */
  tiposQueSirve(): TipoDeVehiculo[]
  probar(): Promise<PruebaDeProveedor>
  marcas(tipo: TipoDeVehiculo): Promise<MarcaCruda[]>
  modelos(tipo: TipoDeVehiculo, marcaId: string): Promise<ModeloCrudo[]>
  lineas(tipo: TipoDeVehiculo, marcaId: string, modeloId: string): Promise<LineaCruda[]>
}
