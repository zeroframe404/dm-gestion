// Listado de Comisiones (Cobranzas → Comisiones): las comisiones generadas por los pagos de pólizas. Estos
// tipos los puede cambiar con libertad quien construye la pantalla; ver el contrato en ./index.ts. Son un
// punto de partida mínimo: se ajustan a lo que de verdad exista en los datos de pagos y comisiones.
//
// Ojo: es información de la agencia, no del mostrador. El canal 'listados:comisiones' exige rol
// ADMIN o SUPER_ADMIN, igual que 'cobranzas:comisiones' (la pestaña Comisiones del panel).

export interface FiltrosDeComisiones {
  /** AAAA-MM-DD. El rango de fechas de cobro es obligatorio: sin él (o inválido) no se consulta nada. */
  desde: string;
  /** AAAA-MM-DD */
  hasta: string;
  /** Vacías = todas, igual que en el resto de los filtros (shared/filtros.ts). */
  companias: string[];
  ramas: string[];
  productores: string[];
  formasDePago: string[];
}

export const FILTROS_DE_COMISIONES_VACIOS: FiltrosDeComisiones = {
  desde: "",
  hasta: "",
  companias: [],
  ramas: [],
  productores: [],
  formasDePago: [],
};

/** Las opciones de los desplegables del listado (valores distintos, sin vacíos, ordenados): sin filas ni cálculo de comisión. */
export interface OpcionesDeComisiones {
  companias: string[];
  ramas: string[];
  productores: string[];
  formasDePago: string[];
}

export interface FilaDeComision {
  /** Id estable de la fila para la tabla (el `fila_id` del pago). */
  id: string;
  polizaId: number | null;
  clienteId: number | null;
  /** AAAA-MM-DD: la fecha de cobro. */
  fecha: string;
  compania: string | null;
  numero: string | null;
  /** El ramo de la póliza (rama del vehículo o tipo de riesgo); null si el pago no tiene póliza. */
  ramo: string | null;
  cliente: string;
  /** El importe cobrado; null si el pago no trae un monto numérico. */
  importePago: number | null;
  /** El % de comisión de la compañía (Administración → Compañías), o null si no está cargado (0 = sin cargar). */
  porcentaje: number | null;
  /** Sobre qué monto se calcula la comisión: el importe del pago, como en la pestaña Comisiones del panel. */
  base: number | null;
  /** La comisión estimada (base × % / 100, a centavos); null si no se puede calcular (sin porcentaje o sin importe). */
  comision: number | null;
  /** El medio con que se cobró el pago («Efectivo», «Transferencia»…); es lo que filtra «Formas de Pago». */
  formaPago: string | null;
  productor: string | null;
}
