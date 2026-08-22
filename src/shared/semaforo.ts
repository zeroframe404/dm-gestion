// El semáforo de la planilla del mes. Vive en shared porque lo usa la pantalla y lo prueba el banco
// de pruebas: es la regla que la gente mira todo el día, así que tiene que ser una sola y estar sola.
//
// La cobertura financiera son los días que la compañía sigue cubriendo al cliente después del
// vencimiento (ATM 7, EQUIDAD 5, METROPOL 3, AGROSALTA 0…). Se configura en Administración → Compañías.

export type ColorAlerta = 'verde' | 'azul' | 'amarillo' | 'naranja' | 'rojo' | 'neutro'

export interface Alerta {
  color: ColorAlerta
  /** Texto corto para la celda. */
  etiqueta: string
  /** Explicación para el tooltip. */
  detalle: string
  /** Días hasta el vencimiento (negativo = ya venció); null si no hay día cargado. */
  diasParaVencer: number | null
  /** Último día en que la compañía sigue cubriendo, 'AAAA-MM-DD'; null si no se puede calcular. */
  finCobertura: string | null
}

export interface DatosDeAlerta {
  /** Período de la planilla, 'AAAA-MM'. */
  periodo: string
  /** Día del mes en que vence la cuota (1-31); null si la fila no lo tiene cargado. */
  diaVencimiento: number | null
  /** true si la cuota está paga (fecha en CUANDO PAGO o pago registrado en la aplicación). */
  pagada: boolean
  /** Texto de FORMA DE PAGO tal cual está en la planilla. */
  formaPago: string | null
  /** Días de cobertura financiera de la compañía. */
  diasCobertura: number
}

export const DIAS_COBERTURA_POR_DEFECTO = 30

/** Formas de pago que se cobran solas: no hay que avisar ni perseguir el pago. */
const FORMAS_AUTOMATICAS = new Set(['TARJETA', 'CBU', 'DEBITO', 'DEBITO AUTOMATICO', 'TARJETA DE CREDITO', 'TARJETA DE DEBITO', 'DEBITO EN CUENTA', 'TC', 'DB'])

function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .replace(/ /g, ' ')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

export function esDebitoAutomatico(formaPago: string | null | undefined): boolean {
  return FORMAS_AUTOMATICAS.has(normalizar(formaPago))
}

/** Cantidad de días del mes (mes 1-12). */
function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

function aDia(iso: string): number {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1) / 86_400_000)
}

function desdeDia(dias: number): string {
  return new Date(dias * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Fecha de vencimiento de la cuota: el día indicado dentro del período. Si el día no existe en ese mes
 * (un 31 en febrero) se toma el último día del mes, que es lo que hace la agencia.
 */
export function fechaDeVencimiento(periodo: string, diaVencimiento: number | null): string | null {
  if (diaVencimiento === null || diaVencimiento < 1) return null
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(5, 7))
  if (!Number.isFinite(anio) || !Number.isFinite(mes) || mes < 1 || mes > 12) return null
  const dia = Math.min(diaVencimiento, diasDelMes(anio, mes))
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

const SIN_ALERTA: Alerta = { color: 'neutro', etiqueta: '', detalle: 'Todavía falta para el vencimiento.', diasParaVencer: null, finCobertura: null }

/**
 * Calcula el color de la fila. El orden importa:
 *  1. pagada             → verde
 *  2. débito automático  → azul
 *  3. faltan 4 a 7 días  → amarillo
 *  4. faltan 1 a 3 días  → naranja
 *  5. vence hoy          → rojo
 *  6. venció pero todavía corre la cobertura financiera → amarillo (naranja el último día)
 *  7. venció y se terminó la cobertura → rojo
 */
export function calcularAlerta(datos: DatosDeAlerta, hoy: string): Alerta {
  if (datos.pagada) {
    return { color: 'verde', etiqueta: 'Al día', detalle: 'La cuota de este mes está paga.', diasParaVencer: null, finCobertura: null }
  }
  if (esDebitoAutomatico(datos.formaPago)) {
    return { color: 'azul', etiqueta: 'Débito automático', detalle: `Se cobra solo por ${datos.formaPago}: no hay que avisar.`, diasParaVencer: null, finCobertura: null }
  }

  const vencimiento = fechaDeVencimiento(datos.periodo, datos.diaVencimiento)
  if (!vencimiento) {
    return { color: 'neutro', etiqueta: 'Sin vencimiento', detalle: 'La fila no tiene día de vencimiento cargado.', diasParaVencer: null, finCobertura: null }
  }

  const dias = aDia(vencimiento) - aDia(hoy)
  const diasCobertura = Number.isFinite(datos.diasCobertura) && datos.diasCobertura >= 0 ? datos.diasCobertura : DIAS_COBERTURA_POR_DEFECTO
  const finCobertura = desdeDia(aDia(vencimiento) + diasCobertura)

  if (dias >= 8) return { ...SIN_ALERTA, diasParaVencer: dias, finCobertura }
  if (dias >= 4) {
    return { color: 'amarillo', etiqueta: `Vence en ${dias} d`, detalle: `Vence el ${vencimiento}.`, diasParaVencer: dias, finCobertura }
  }
  if (dias >= 1) {
    return { color: 'naranja', etiqueta: dias === 1 ? 'Vence mañana' : `Vence en ${dias} d`, detalle: `Vence el ${vencimiento}.`, diasParaVencer: dias, finCobertura }
  }
  if (dias === 0) {
    return { color: 'rojo', etiqueta: 'Vence hoy', detalle: `Vence hoy (${vencimiento}) y no figura paga.`, diasParaVencer: 0, finCobertura }
  }

  // Ya venció: manda la cobertura financiera de la compañía.
  const diasHastaFin = aDia(finCobertura) - aDia(hoy)
  if (diasHastaFin > 0) {
    return {
      color: 'amarillo',
      etiqueta: `Cubierto ${diasHastaFin} d`,
      detalle: `Venció el ${vencimiento} sin pago, pero la compañía cubre hasta el ${finCobertura}.`,
      diasParaVencer: dias,
      finCobertura,
    }
  }
  if (diasHastaFin === 0) {
    return {
      color: 'naranja',
      etiqueta: 'Último día cob.',
      detalle: `Venció el ${vencimiento} y hoy es el último día que la compañía lo cubre.`,
      diasParaVencer: dias,
      finCobertura,
    }
  }
  return {
    color: 'rojo',
    etiqueta: `Vencido +${-dias} d`,
    detalle: `Venció el ${vencimiento} sin pago y la cobertura terminó el ${finCobertura}.`,
    diasParaVencer: dias,
    finCobertura,
  }
}

export const NOMBRE_COLOR: Record<ColorAlerta, string> = {
  verde: 'Al día',
  azul: 'Débito automático',
  amarillo: 'Vence pronto',
  naranja: 'Urgente',
  rojo: 'Vencido',
  neutro: 'Sin alerta',
}

/** Orden en que se muestran los colores en los filtros y al ordenar por urgencia. */
export const ORDEN_COLORES: ColorAlerta[] = ['rojo', 'naranja', 'amarillo', 'neutro', 'azul', 'verde']

/** Fecha de hoy en 'AAAA-MM-DD', en hora local (la agencia trabaja en su huso). */
export function hoyLocal(fecha = new Date()): string {
  const desplazado = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60_000)
  return desplazado.toISOString().slice(0, 10)
}

/** Período 'AAAA-MM' de hoy. */
export function periodoDeHoy(fecha = new Date()): string {
  return hoyLocal(fecha).slice(0, 7)
}

/** Período siguiente a uno dado ('2026-08' → '2026-09'). */
export function periodoSiguiente(periodo: string): string {
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(5, 7))
  return mes === 12 ? `${anio + 1}-01` : `${anio}-${String(mes + 1).padStart(2, '0')}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** '2026-08' → 'Agosto 2026'. */
export function nombreDePeriodo(periodo: string): string {
  const mes = MESES[Number(periodo.slice(5, 7)) - 1]
  if (!mes) return periodo
  return `${mes[0]!.toUpperCase()}${mes.slice(1)} ${periodo.slice(0, 4)}`
}
