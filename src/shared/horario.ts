// Uso laboral: el horario en que cada rol puede trabajar con DM Gestión. Sin Electron ni Node: lo usan el
// proceso principal (que hace cumplir el horario) y la pantalla de Administración (que lo configura).
//
// Las reglas de forma (`ConfiguracionDeHorario`) son la copia exacta de lo que valida el servidor
// (`modules/dmg/horario.reglas.ts` en Seguros_Daniel_Martinez): las dos tienen que decir lo mismo.
//
// LA HORA ES LA DE ARGENTINA (UTC-3, sin horario de verano), no la de la PC: «de 10 a 20» es de 10 a 20 en
// la agencia, esté la computadora configurada como esté. El superadministrador no tiene horario.
import type { Rol } from './tipos'

export type RolConHorario = 'ADMIN' | 'EMPLEADO'
export const ROLES_CON_HORARIO: readonly RolConHorario[] = ['ADMIN', 'EMPLEADO']

export interface ReglaDeHorario {
  /** Si es false, ese rol trabaja a cualquier hora. */
  activo: boolean
  /** «HH:MM», 24 horas. */
  desde: string
  hasta: string
}

export interface ConfiguracionDeHorario {
  /** El interruptor general. Viene apagado: la función es opcional. */
  habilitado: boolean
  ADMIN: ReglaDeHorario
  EMPLEADO: ReglaDeHorario
}

export const HORARIO_POR_OMISION: ConfiguracionDeHorario = {
  habilitado: false,
  ADMIN: { activo: false, desde: '10:00', hasta: '20:00' },
  EMPLEADO: { activo: false, desde: '10:00', hasta: '20:00' },
}

export const MS_DE_ARGENTINA = 3 * 60 * 60 * 1000
/** Cuánto antes del cierre se avisa que se acaba el tiempo. */
export const MINUTOS_DE_AVISO = 30
/** Cuánto puede durar una excepción que da el superadministrador. */
export const MINUTOS_DE_EXCEPCION = [30, 60, 120, 240] as const

export const NOMBRE_DE_ROL_CON_HORARIO: Record<RolConHorario, string> = {
  ADMIN: 'Administradores',
  EMPLEADO: 'Usuarios',
}

const PATRON_DE_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/

export function minutosDelDia(hora: string): number {
  const partes = PATRON_DE_HORA.exec(hora)
  if (!partes) return Number.NaN
  return Number(partes[1]) * 60 + Number(partes[2])
}

/** El motivo por el que una regla no se puede guardar, o null si está bien. */
export function motivoDeReglaInvalida(regla: ReglaDeHorario, nombre: string): string | null {
  if (!PATRON_DE_HORA.test(regla.desde)) return `La hora de entrada de ${nombre} no es válida.`
  if (!PATRON_DE_HORA.test(regla.hasta)) return `La hora de salida de ${nombre} no es válida.`
  if (minutosDelDia(regla.desde) >= minutosDelDia(regla.hasta)) {
    return `La hora de salida de ${nombre} tiene que ser posterior a la de entrada.`
  }
  return null
}

export function motivoDeConfiguracionInvalida(config: ConfiguracionDeHorario): string | null {
  return (
    motivoDeReglaInvalida(config.ADMIN, 'los administradores') ?? motivoDeReglaInvalida(config.EMPLEADO, 'los usuarios')
  )
}

/** Minutos transcurridos del día en Argentina (con decimales: incluye los segundos). */
export function minutosDeArgentina(instanteMs: number): number {
  const ar = new Date(instanteMs - MS_DE_ARGENTINA)
  return ar.getUTCHours() * 60 + ar.getUTCMinutes() + ar.getUTCSeconds() / 60
}

/** «HH:MM» en hora de Argentina. */
export function horaDeArgentina(instanteMs: number): string {
  const ar = new Date(instanteMs - MS_DE_ARGENTINA)
  return `${String(ar.getUTCHours()).padStart(2, '0')}:${String(ar.getUTCMinutes()).padStart(2, '0')}`
}

export type VeredictoDeHorario =
  /** Sin horario (apagado, superadministrador o regla inactiva): trabaja a cualquier hora. */
  | { tipo: 'libre' }
  /** Dentro del turno (o con una excepción vigente): `cierraEnMs` es el instante en que se corta. */
  | { tipo: 'dentro'; cierraEnMs: number; cierraA: string }
  /** Fuera de turno: no puede ingresar. */
  | { tipo: 'fuera'; desde: string; hasta: string }

/**
 * ¿Puede este rol estar adentro ahora? `excepcionHastaMs` es el vencimiento de una excepción aprobada, si hay.
 * La excepción tiene prioridad: adentro hasta el final del turno o hasta que ella venza, lo que llegue más tarde.
 */
export function evaluarHorario(
  config: ConfiguracionDeHorario,
  rol: Rol,
  ahoraMs: number,
  excepcionHastaMs: number | null = null,
): VeredictoDeHorario {
  if (!config.habilitado || rol === 'SUPER_ADMIN') return { tipo: 'libre' }
  const regla = config[rol]
  if (!regla.activo) return { tipo: 'libre' }

  const minutos = minutosDeArgentina(ahoraMs)
  const desde = minutosDelDia(regla.desde)
  const hasta = minutosDelDia(regla.hasta)
  const hayExcepcion = excepcionHastaMs !== null && excepcionHastaMs > ahoraMs
  const dentroDelTurno = minutos >= desde && minutos < hasta

  if (dentroDelTurno) {
    const finDelTurnoMs = ahoraMs + (hasta - minutos) * 60_000
    const cierraEnMs = hayExcepcion ? Math.max(finDelTurnoMs, excepcionHastaMs) : finDelTurnoMs
    return { tipo: 'dentro', cierraEnMs, cierraA: horaDeArgentina(cierraEnMs) }
  }
  if (hayExcepcion) return { tipo: 'dentro', cierraEnMs: excepcionHastaMs, cierraA: horaDeArgentina(excepcionHastaMs) }
  return { tipo: 'fuera', desde: regla.desde, hasta: regla.hasta }
}

/** El texto que se le muestra a quien quiere ingresar fuera de horario. */
export function mensajeFueraDeHorario(veredicto: Extract<VeredictoDeHorario, { tipo: 'fuera' }>): string {
  return `Estás fuera de tu horario de trabajo (de ${veredicto.desde} a ${veredicto.hasta}). Podés pedirle una excepción al superadministrador.`
}

// --- Los pedidos de excepción (lo que guarda el servidor) ---------------------------------------------

export type MomentoDelPedido = 'INGRESO' | 'EN_SESION'
export type EstadoDelPedido = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA'

export interface SolicitudDeHorario {
  id: string
  numero: number
  usuario: string
  nombre: string
  rol: string
  sucursal: string
  momento: MomentoDelPedido
  motivo: string
  estado: EstadoDelPedido
  /** La IP y la localidad las ve el servidor: lo que diga la PC no vale. */
  ip: string
  localidad: string
  /** «2026-11-08 21:15», hora de Argentina. */
  horaLocal: string
  minutosConcedidos: number | null
  vigenteHasta: string | null
  resueltaPor: string | null
  resueltaEn: string | null
  creadoEn: string
}

/** Lo que devuelve el servidor al preguntarle por el horario de un usuario. */
export interface EstadoDelHorarioEnElVps {
  config: ConfiguracionDeHorario
  version: number
  /** ISO, UTC: la hora del servidor. */
  ahora: string
  excepcionHasta: string | null
}

/** Lo que muestra la pestaña «Uso laboral». */
export interface EstadoDeUsoLaboral {
  config: ConfiguracionDeHorario
  version: number
}

/** El aviso de que al turno le quedan pocos minutos (evento hacia la pantalla). */
export interface AvisoDeFinDeTurno {
  minutosRestantes: number
  cierraA: string
}

/** Lo que pasó con el pedido que hizo esta persona (evento hacia la pantalla). */
export interface RespuestaDeExcepcion {
  solicitudId: string
  estado: Exclude<EstadoDelPedido, 'PENDIENTE'>
  minutosConcedidos: number | null
  cierraA: string | null
}
