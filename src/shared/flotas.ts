// Cartera → Flotas: una empresa con muchos autos. No se carga a mano: aparece sola cuando hay al menos
// MINIMO_DE_POLIZAS_DE_UNA_FLOTA pólizas vigentes con el mismo nombre de titular.

export const MINIMO_DE_POLIZAS_DE_UNA_FLOTA = 6

export interface VehiculoDeFlota {
  polizaId: number
  clienteId: number
  patente: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  compania: string | null
  numero: string | null
  cobertura: string | null
  vigenciaHasta: string | null
}

export interface Flota {
  /** El nombre como está cargado (el de la primera ficha del grupo). */
  nombre: string
  clientes: number
  vehiculos: VehiculoDeFlota[]
}

/**
 * Cierra el mensaje de «ya hay otra póliza con ese número» cuando es del mismo cliente: es la señal para
 * que la pantalla ofrezca «Es una flota, cargar igual» en vez de dejarlo como error.
 */
export const FRASE_DE_FLOTA = 'Si es una flota, podés cargarla igual.'

export function esAvisoDeFlota(mensaje: string): boolean {
  return mensaje.endsWith(FRASE_DE_FLOTA)
}
