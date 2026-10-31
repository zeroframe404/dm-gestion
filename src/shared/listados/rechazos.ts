// Listado de Rechazos de Débito (Cobranzas → Rechazos): el historial de rechazos de débito de cuotas y pagos
// de pólizas. Ver el contrato en ./index.ts.
//
// La fuente es la misma que usa Cartera → Rechazos y la campana de la barra superior: la tabla de avisos de
// rechazo (`rechazos_debito`, pestaña «APP RECHAZOS»). De ahí salen la fecha, el motivo y el estado del aviso;
// la compañía, el productor y la rama salen de la póliza, y el importe de la cuota de la planilla del mes que
// rebotó. Es de sólo lectura: resolver o descartar sigue siendo cosa de la pantalla de Cartera.
import type { EstadoDeRechazo } from '../tipos'

export interface FiltrosDeRechazos {
  /** AAAA-MM-DD, día en que se anotó el rechazo. Opcionales: este listado se carga solo. Vacío = sin límite. */
  desde: string
  hasta: string
  /** Vacías = todas, igual que en el resto de los filtros (shared/filtros.ts). */
  companias: string[]
  ramas: string[]
  productores: string[]
  /** Motivos del rechazo tal como se leen en la tabla («Sin fondos en la cuenta»). */
  causas: string[]
  /** Estados del aviso tal como se leen en la tabla («Pendiente», «Visto», «Resuelto»). */
  tipos: string[]
  /** Texto libre sobre el nombre del cliente. Sin tildes ni mayúsculas. */
  cliente: string
}

export const FILTROS_DE_RECHAZOS_VACIOS: FiltrosDeRechazos = {
  desde: '',
  hasta: '',
  companias: [],
  ramas: [],
  productores: [],
  causas: [],
  tipos: [],
  cliente: '',
}

export interface FilaDeRechazo {
  /** Id estable de la fila para la tabla (el del aviso). */
  id: string
  polizaId: number | null
  clienteId: number | null
  /** AAAA-MM-DD */
  fecha: string
  compania: string | null
  numero: string | null
  /** La rama de la póliza («AUTO», «Hogar»…); null si el aviso no tiene póliza o no tiene riesgo. */
  ramo: string | null
  cliente: string
  /** Texto de la cuota que rebotó, tal como figura en la planilla del mes. */
  cuota: string | null
  /** Mes de la cuota que rebotó, 'AAAA-MM'. */
  periodo: string | null
  /** Monto de la cuota de la planilla que rebotó; null si el aviso no quedó atado a una cuota con monto. */
  importe: number | null
  /** El estado del aviso (el código, para el color del chip). */
  estado: EstadoDeRechazo
  /** El estado del aviso como se lee: «Pendiente», «Visto» o «Resuelto». */
  tipo: string
  /** El motivo como se lee («Sin fondos en la cuenta»); null si el aviso no trae motivo. */
  causa: string | null
  productor: string | null
}
