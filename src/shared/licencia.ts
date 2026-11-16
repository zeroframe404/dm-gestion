// La licencia de DM Gestión de la agencia: lo que el servidor contesta en `GET /api/dmg/licencia`.
//
// La licencia la emite quien vende el programa y la comprueba el SERVIDOR de cada agencia (firma,
// agencia, vencimiento y puestos). El programa sólo muestra el estado y, si no deja ingresar, la
// pantalla de bloqueo con el lugar para pegar una licencia nueva.

export type NombreDeEstadoDeLicencia = 'exenta' | 'falta' | 'invalida' | 'vigente' | 'por_vencer' | 'en_gracia' | 'vencida'

export interface EstadoDeLicencia {
  estado: NombreDeEstadoDeLicencia
  /** ¿Se puede ingresar? */
  permiteIngresar: boolean
  agencia: string | null
  titular: string | null
  plan: string | null
  /** Cuántas computadoras puede tener abiertas la agencia. */
  puestos: number | null
  /** Cuántas hay con sesión abierta ahora. */
  usados: number | null
  /** El último día que vale, `AAAA-MM-DD`. */
  vence: string | null
  diasRestantes: number | null
  graciaHasta: string | null
  mensaje: string
}

/** Una computadora con sesión abierta: ocupa un puesto de la licencia. */
export interface PuestoOcupado {
  /** Con qué se la libera. */
  clave: string
  equipo: string
  usuarios: string[]
  app: string
  ultimoUso: string
}

export const LICENCIA_EXENTA: EstadoDeLicencia = {
  estado: 'exenta',
  permiteIngresar: true,
  agencia: null,
  titular: null,
  plan: null,
  puestos: null,
  usados: null,
  vence: null,
  diasRestantes: null,
  graciaHasta: null,
  mensaje: 'Este servidor no controla licencias.',
}

const ESTADOS: readonly NombreDeEstadoDeLicencia[] = ['exenta', 'falta', 'invalida', 'vigente', 'por_vencer', 'en_gracia', 'vencida']

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor ? valor : null
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

/** Lo que contestó el servidor, con forma segura. Null si no es un estado de licencia. */
export function normalizarEstadoDeLicencia(valor: unknown): EstadoDeLicencia | null {
  if (!valor || typeof valor !== 'object') return null
  const v = valor as Record<string, unknown>
  if (!ESTADOS.includes(v.estado as NombreDeEstadoDeLicencia)) return null
  return {
    estado: v.estado as NombreDeEstadoDeLicencia,
    permiteIngresar: v.permiteIngresar === true,
    agencia: texto(v.agencia),
    titular: texto(v.titular),
    plan: texto(v.plan),
    puestos: numero(v.puestos),
    usados: numero(v.usados),
    vence: texto(v.vence),
    diasRestantes: numero(v.diasRestantes),
    graciaHasta: texto(v.graciaHasta),
    mensaje: texto(v.mensaje) ?? '',
  }
}

/** Con este estado, ¿hay que avisar algo? Y a quién: los de gracia, a todos; los por vencer, a los administradores. */
export function avisoDeLicencia(estado: EstadoDeLicencia | null, rol: string): string | null {
  if (!estado) return null
  if (estado.estado === 'en_gracia') return estado.mensaje
  if (estado.estado === 'por_vencer' && (rol === 'SUPER_ADMIN' || rol === 'ADMIN')) return estado.mensaje
  return null
}

/** «31/01/2027» */
export function fechaDeLicencia(fecha: string | null): string {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return '—'
  const [a, m, d] = fecha.split('-')
  return `${d}/${m}/${a}`
}
