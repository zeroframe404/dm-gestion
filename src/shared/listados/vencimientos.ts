// Listado de Vencimientos: pólizas próximas a vencer por renovación o refacturación. Estos tipos los
// puede cambiar con libertad quien construye la pantalla; ver el contrato en ./index.ts.

/**
 * Qué clase de vencimiento se busca. El modelo de datos NO tiene refacturación (una póliza no tiene
 * cuotas con vencimiento propio que se refacturen): hoy sólo funciona «Renovación». Las otras dos
 * opciones existen para que el selector sea el del diseño, pero la pantalla las muestra deshabilitadas
 * y el servicio, si le llegan igual, devuelve una lista vacía en vez de mezclar cosas que no son.
 */
export const TIPOS_DE_VENCIMIENTO = ['RENOVACION', 'REFACTURACION', 'AMBOS'] as const
export type TipoDeVencimiento = (typeof TIPOS_DE_VENCIMIENTO)[number]

export const NOMBRE_TIPO_DE_VENCIMIENTO: Record<TipoDeVencimiento, string> = {
  RENOVACION: 'Renovación',
  REFACTURACION: 'Refacturación',
  AMBOS: 'Renovación y Refacturación',
}

/** Sólo la renovación existe en el modelo; ver `TIPOS_DE_VENCIMIENTO`. */
export const TIPOS_DE_VENCIMIENTO_DISPONIBLES: readonly TipoDeVencimiento[] = ['RENOVACION']

export interface FiltrosDeVencimientos {
  /** AAAA-MM-DD. El rango de fechas es obligatorio: sin él (o con una fecha inválida) no se consulta nada. */
  desde: string
  /** AAAA-MM-DD */
  hasta: string
  tipo: TipoDeVencimiento
  /** Vacías = todas, igual que en el resto de los filtros (shared/filtros.ts). */
  companias: string[]
  ramas: string[]
  /** El «vendedor» de la póliza es su productor: este filtro cubre las dos cosas. */
  productores: string[]
  formasDePago: string[]
  /** Por defecto se excluyen las pólizas dadas de baja (BAJA). */
  incluirAnuladas: boolean
  /** Saca las que ya tienen una póliza que las reemplaza (`poliza_anterior_id`). */
  excluirRenovadas: boolean
  /** Deja sólo las que ya tienen una póliza que las reemplaza. Si vienen las dos, no queda nada. */
  soloRenovadas: boolean
}

export interface FilaDeVencimiento {
  polizaId: number
  clienteId: number
  compania: string | null
  numero: string | null
  /** «Auto», «Moto», «Hogar»…: la rama del vehículo o el tipo de riesgo. */
  ramo: string | null
  cliente: string
  /** AAAA-MM-DD */
  vencimiento: string
  /** «Renovación» (la refacturación no existe en el modelo). */
  tipo: string
  /** true si otra póliza la reemplaza (`poliza_anterior_id`), aunque esta siga activa. */
  renovada: boolean
  /** Id y número de la póliza que la reemplaza, si la hay. */
  renovadaPorId: number | null
  renovadaPorNumero: string | null
  /** true si salió de la cartera con una baja (estado BAJA): sólo aparece si se pidió incluir anuladas. */
  anulada: boolean
  formaPago: string | null
  riesgo: string | null
  productor: string | null
}
