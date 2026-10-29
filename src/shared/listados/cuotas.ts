// Listado de Vencimientos de Cuotas (Cobranzas → Vencimientos Cuotas): cuotas de pólizas próximas a vencer
// o vencidas. Contrato general en ./index.ts.
//
// Una fila es una fila de la planilla mensual (`cuotas_mes`): la misma que se ve en Cartera → Planilla del
// mes y de la que vive Cobranzas. El estado se calcula con las reglas de esas pantallas (ver
// main/servicios/listadoCuotas.ts), no se inventa acá.

export interface FiltrosDeCuotas {
  /** AAAA-MM-DD. El rango de fechas de vencimiento es obligatorio: sin él (o inválido) no se consulta nada. */
  desde: string
  /** AAAA-MM-DD */
  hasta: string
  /** Vacías = todas, igual que en el resto de los filtros (shared/filtros.ts). */
  companias: string[]
  ramas: string[]
  formasDePago: string[]
  productores: string[]
  /** Texto libre sobre el nombre del cliente. Vacío = todos. */
  cliente: string
  /** Texto libre sobre la descripción del riesgo. Vacío = todos. */
  riesgo: string
  /** Por defecto las cuotas de pólizas anuladas (o dadas de baja de la planilla) no se listan. */
  incluirAnuladas: boolean
  /** Saca las que ya están pagas (y las adelantadas, cuya plata ya entró). */
  excluirPagadas: boolean
  /** Deja sólo las que venció su fecha sin pago. Si también se pide excluir pagadas, no cambia nada: una vencida nunca está paga. */
  soloVencidas: boolean
  /**
   * Para llenar los desplegables: ignora el rango y los demás filtros y devuelve UNA fila por cada combinación
   * distinta de compañía / rama / forma de pago / productor que existe en la planilla (sin cliente, fecha ni
   * importe). Es barato; la alternativa era traer todas las cuotas de la historia sólo para saber qué compañías hay.
   */
  soloOpciones?: boolean
}

export const FILTROS_DE_CUOTAS_VACIOS: FiltrosDeCuotas = {
  desde: '',
  hasta: '',
  companias: [],
  ramas: [],
  formasDePago: [],
  productores: [],
  cliente: '',
  riesgo: '',
  incluirAnuladas: false,
  excluirPagadas: false,
  soloVencidas: false,
}

/**
 * Estados de una cuota, en el orden en que se deciden (la primera que cumple gana):
 *  - Pagada: tiene fecha en CUANDO PAGO o un pago registrado en la aplicación (igual que `estaPagada` de la planilla).
 *  - Adelantada: se cobró por adelantado y todavía nadie la imputó a la fila. La plata ya entró.
 *  - Anulada: la póliza está dada de baja sin renovarse, o la cuota se dio de baja de la planilla.
 *  - Renovada: la fila vieja que reemplazó una renovación (la cuota se dio de baja y la póliza tiene sucesora). No es una anulación.
 *  - Imputada: la agencia ya se la pagó a la compañía y falta que el cliente pague.
 *  - Vencida: la fecha de vencimiento ya pasó (antes de hoy) y es una cuota que la Mora persigue.
 *  - Sin mora: la fecha pasó, pero la Mora no la persigue (débito automático, algo escrito en CUANDO PAGO o un pago que la cubre).
 *  - Pendiente: todavía no venció (vence hoy o más adelante).
 */
export const ESTADOS_DE_CUOTA = ['Pagada', 'Adelantada', 'Anulada', 'Renovada', 'Imputada', 'Vencida', 'Sin mora', 'Pendiente'] as const
export type EstadoDeCuota = (typeof ESTADOS_DE_CUOTA)[number]

export interface FilaDeCuota {
  /** Id estable de la fila para la tabla: el `fila_id` de la cuota en la planilla. */
  id: string
  /** null cuando la cuota no está vinculada a una póliza (no hay ficha para abrir). */
  polizaId: number | null
  clienteId: number | null
  compania: string | null
  numero: string | null
  cliente: string
  /** AAAA-MM-DD */
  vencimiento: string
  importe: number | null
  /** Texto de la columna CUOTA de la planilla («3», «3/12»…), tal cual está cargado. */
  cuota: string | null
  estado: EstadoDeCuota
  /** El ramo: la rama del vehículo o el tipo de riesgo («Hogar»). */
  ramo: string | null
  formaPago: string | null
  riesgo: string | null
  productor: string | null
}
