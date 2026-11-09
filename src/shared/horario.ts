// Uso laboral: el horario en que cada rol puede trabajar con DM Gestión. Sin Electron ni Node: lo usan el
// proceso principal (que hace cumplir el horario) y la pantalla de Administración (que lo configura).
//
// Las reglas de forma (`ConfiguracionDeHorario`) son la copia exacta de lo que valida el servidor
// (`modules/dmg/horario.reglas.ts` en Seguros_Daniel_Martinez): las dos tienen que decir lo mismo.
//
// LA HORA ES LA DE ARGENTINA (UTC-3, sin horario de verano), no la de la PC: «de 10 a 20» es de 10 a 20 en
// la agencia, esté la computadora configurada como esté. El superadministrador no tiene horario.
import { SUCURSALES, sucursalCanonica } from './sucursales'
import type { Rol } from './tipos'

export type RolConHorario = 'ADMIN' | 'EMPLEADO'
export const ROLES_CON_HORARIO: readonly RolConHorario[] = ['ADMIN', 'EMPLEADO']

export interface ReglaDeHorario {
  /** Si es false, ese rol trabaja a cualquier hora y cualquier día. */
  activo: boolean
  /** «HH:MM», 24 horas. */
  desde: string
  hasta: string
  /** Los días de trabajo: 0 = domingo … 6 = sábado (hora de Argentina). */
  dias: number[]
}

/** Un día puntual en que no se trabaja (un feriado, un puente). */
export interface Feriado {
  /** «AAAA-MM-DD». */
  fecha: string
  motivo: string
}

/** Lo que se configura por sucursal: el horario de cada rol y sus feriados. */
export interface HorarioDeSucursal {
  ADMIN: ReglaDeHorario
  EMPLEADO: ReglaDeHorario
  feriados: Feriado[]
}

export interface ConfiguracionDeHorario {
  /** El interruptor general. Viene apagado: la función es opcional. */
  habilitado: boolean
  /** Por nombre de sucursal, escrito como en `SUCURSALES`. */
  sucursales: Record<string, HorarioDeSucursal>
}

/** Los días de la semana en el orden en que se muestran (la semana empieza el lunes). */
export const DIAS_DE_LA_SEMANA: ReadonlyArray<{ numero: number; corto: string; largo: string }> = [
  { numero: 1, corto: 'Lun', largo: 'lunes' },
  { numero: 2, corto: 'Mar', largo: 'martes' },
  { numero: 3, corto: 'Mié', largo: 'miércoles' },
  { numero: 4, corto: 'Jue', largo: 'jueves' },
  { numero: 5, corto: 'Vie', largo: 'viernes' },
  { numero: 6, corto: 'Sáb', largo: 'sábado' },
  { numero: 0, corto: 'Dom', largo: 'domingo' },
]
const LUNES_A_VIERNES = [1, 2, 3, 4, 5]
const TODOS_LOS_DIAS = [0, 1, 2, 3, 4, 5, 6]

export function reglaPorOmision(): ReglaDeHorario {
  return { activo: false, desde: '10:00', hasta: '20:00', dias: [...LUNES_A_VIERNES] }
}

export function horarioDeSucursalPorOmision(): HorarioDeSucursal {
  return { ADMIN: reglaPorOmision(), EMPLEADO: reglaPorOmision(), feriados: [] }
}

/** El horario apagado, con las cuatro sucursales listas para configurar. */
export function horarioPorOmision(): ConfiguracionDeHorario {
  return {
    habilitado: false,
    sucursales: Object.fromEntries(SUCURSALES.map((nombre) => [nombre, horarioDeSucursalPorOmision()])),
  }
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
const PATRON_DE_FECHA = /^\d{4}-\d{2}-\d{2}$/

export function minutosDelDia(hora: string): number {
  const partes = PATRON_DE_HORA.exec(hora)
  if (!partes) return Number.NaN
  return Number(partes[1]) * 60 + Number(partes[2])
}

/** true si la fecha «AAAA-MM-DD» existe en el calendario (no acepta el 30 de febrero). */
export function esFechaReal(fecha: string): boolean {
  if (!PATRON_DE_FECHA.test(fecha)) return false
  const instante = new Date(`${fecha}T00:00:00Z`)
  return !Number.isNaN(instante.getTime()) && instante.toISOString().slice(0, 10) === fecha
}

function reglaLimpia(valor: unknown): ReglaDeHorario {
  const base = reglaPorOmision()
  const crudo = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>
  const dias = Array.isArray(crudo.dias)
    ? [...new Set(crudo.dias.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
    : [...TODOS_LOS_DIAS]
  return {
    activo: crudo.activo === true,
    desde: typeof crudo.desde === 'string' ? crudo.desde : base.desde,
    hasta: typeof crudo.hasta === 'string' ? crudo.hasta : base.hasta,
    dias,
  }
}

/**
 * Lo que dice el servidor (o lo guardado en la base local) llevado a la forma que usa el programa, sin
 * fallar nunca: las cuatro sucursales siempre están, lo que falta o viene roto vuelve a lo apagado, y la
 * versión anterior del formato (un horario único para todos, sin días ni feriados) se lleva a todas las
 * sucursales con todos los días, que es lo que significaba.
 */
export function normalizarConfiguracion(valor: unknown): ConfiguracionDeHorario {
  const crudo = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>
  const salida = horarioPorOmision()
  salida.habilitado = crudo.habilitado === true
  const sucursales = crudo.sucursales
  if (typeof sucursales === 'object' && sucursales !== null && !Array.isArray(sucursales)) {
    for (const [nombre, valorDeSucursal] of Object.entries(sucursales as Record<string, unknown>)) {
      const canonica = sucursalCanonica(nombre)
      if (!canonica) continue
      const de = (typeof valorDeSucursal === 'object' && valorDeSucursal !== null ? valorDeSucursal : {}) as Record<string, unknown>
      const feriados = Array.isArray(de.feriados)
        ? de.feriados
            .map((f) => (typeof f === 'object' && f !== null ? (f as Record<string, unknown>) : {}))
            .filter((f): f is { fecha: string; motivo?: unknown } => typeof f.fecha === 'string' && esFechaReal(f.fecha))
            .map((f) => ({ fecha: f.fecha, motivo: typeof f.motivo === 'string' ? f.motivo : '' }))
        : []
      salida.sucursales[canonica] = { ADMIN: reglaLimpia(de.ADMIN), EMPLEADO: reglaLimpia(de.EMPLEADO), feriados }
    }
  } else if (crudo.ADMIN || crudo.EMPLEADO) {
    // El formato anterior: un solo horario para toda la agencia.
    for (const nombre of SUCURSALES) {
      salida.sucursales[nombre] = {
        ADMIN: reglaLimpia({ ...(crudo.ADMIN as object) }),
        EMPLEADO: reglaLimpia({ ...(crudo.EMPLEADO as object) }),
        feriados: [],
      }
    }
  }
  return salida
}

/** El horario que rige para este rol en esta sucursal, o null si la sucursal no es ninguna de las cuatro. */
export function reglaDe(config: ConfiguracionDeHorario, sucursal: string, rol: RolConHorario): ReglaDeHorario | null {
  const canonica = sucursalCanonica(sucursal)
  return canonica ? (config.sucursales[canonica]?.[rol] ?? null) : null
}

function feriadosDe(config: ConfiguracionDeHorario, sucursal: string): Feriado[] {
  const canonica = sucursalCanonica(sucursal)
  return canonica ? (config.sucursales[canonica]?.feriados ?? []) : []
}

/** El motivo por el que una regla no se puede guardar, o null si está bien. */
export function motivoDeReglaInvalida(regla: ReglaDeHorario, nombre: string): string | null {
  if (!PATRON_DE_HORA.test(regla.desde)) return `La hora de entrada de ${nombre} no es válida.`
  if (!PATRON_DE_HORA.test(regla.hasta)) return `La hora de salida de ${nombre} no es válida.`
  if (minutosDelDia(regla.desde) >= minutosDelDia(regla.hasta)) {
    return `La hora de salida de ${nombre} tiene que ser posterior a la de entrada.`
  }
  if (regla.activo && regla.dias.length === 0) return `Elegí al menos un día de trabajo para ${nombre}.`
  return null
}

export function motivoDeConfiguracionInvalida(config: ConfiguracionDeHorario): string | null {
  for (const [sucursal, horario] of Object.entries(config.sucursales)) {
    const motivo =
      motivoDeReglaInvalida(horario.ADMIN, `los administradores de ${sucursal}`) ??
      motivoDeReglaInvalida(horario.EMPLEADO, `los usuarios de ${sucursal}`)
    if (motivo) return motivo
  }
  return null
}

/** Minutos transcurridos del día en Argentina (con decimales: incluye los segundos). */
export function minutosDeArgentina(instanteMs: number): number {
  const ar = new Date(instanteMs - MS_DE_ARGENTINA)
  return ar.getUTCHours() * 60 + ar.getUTCMinutes() + ar.getUTCSeconds() / 60
}

/**
 * El instante (ms) en que es `minutosDelDia` de HOY en Argentina. Se calcula desde la medianoche de allá y no
 * sumándole a la hora actual lo que falta: así da SIEMPRE el mismo valor durante todo el día. Con la suma, el
 * resultado se corría unos milisegundos en cada consulta y el programa no podía reconocer que ya había avisado
 * de este mismo cierre (el aviso se repetía en cada vuelta del reloj).
 */
export function instanteDelDiaEnArgentina(ahoraMs: number, minutosDelDia: number): number {
  const medianoche = Math.floor((ahoraMs - MS_DE_ARGENTINA) / 86_400_000) * 86_400_000 + MS_DE_ARGENTINA
  return medianoche + minutosDelDia * 60_000
}

/** «HH:MM» en hora de Argentina. */
export function horaDeArgentina(instanteMs: number): string {
  const ar = new Date(instanteMs - MS_DE_ARGENTINA)
  return `${String(ar.getUTCHours()).padStart(2, '0')}:${String(ar.getUTCMinutes()).padStart(2, '0')}`
}

/** El día de la semana (0 = domingo) y la fecha «AAAA-MM-DD» de hoy en Argentina. */
export function diaDeArgentina(instanteMs: number): { diaDeLaSemana: number; fecha: string } {
  const ar = new Date(instanteMs - MS_DE_ARGENTINA)
  return { diaDeLaSemana: ar.getUTCDay(), fecha: ar.toISOString().slice(0, 10) }
}

/** «lunes a viernes», «todos los días» o la lista («lunes, miércoles y sábado»). */
export function textoDeDias(dias: number[]): string {
  const ordenados = DIAS_DE_LA_SEMANA.filter((d) => dias.includes(d.numero))
  if (ordenados.length === 7) return 'todos los días'
  if (ordenados.length === 0) return 'ningún día'
  const consecutivos = ordenados.every((d, i) => i === 0 || d.numero === (ordenados[i - 1].numero % 7) + 1)
  if (ordenados.length >= 3 && consecutivos) return `${ordenados[0].largo} a ${ordenados[ordenados.length - 1].largo}`
  const nombres = ordenados.map((d) => d.largo)
  return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

export type VeredictoDeHorario =
  /** Sin horario (apagado, superadministrador o regla inactiva): trabaja a cualquier hora. */
  | { tipo: 'libre' }
  /** Dentro del turno (o con una excepción vigente): `cierraEnMs` es el instante en que se corta. */
  | { tipo: 'dentro'; cierraEnMs: number; cierraA: string }
  /** No puede ingresar: fuera de hora, en un día que no se trabaja o en un feriado. */
  | { tipo: 'fuera'; motivo: 'horario' | 'dia' | 'feriado'; desde: string; hasta: string; dias: number[]; detalle: string }

/**
 * ¿Puede este rol, de esta sucursal, estar adentro ahora? `excepcionHastaMs` es el vencimiento de una excepción
 * aprobada, si hay. La excepción tiene prioridad: adentro hasta el final del turno o hasta que ella venza, lo
 * que llegue más tarde. Un día que no es de trabajo (por la semana o por feriado) es «fuera» todo el día.
 */
export function evaluarHorario(
  config: ConfiguracionDeHorario,
  rol: Rol,
  sucursal: string,
  ahoraMs: number,
  excepcionHastaMs: number | null = null,
): VeredictoDeHorario {
  if (!config.habilitado || rol === 'SUPER_ADMIN') return { tipo: 'libre' }
  const regla = reglaDe(config, sucursal, rol)
  if (!regla || !regla.activo) return { tipo: 'libre' }

  const minutos = minutosDeArgentina(ahoraMs)
  const desde = minutosDelDia(regla.desde)
  const hasta = minutosDelDia(regla.hasta)
  const hayExcepcion = excepcionHastaMs !== null && excepcionHastaMs > ahoraMs
  const { diaDeLaSemana, fecha } = diaDeArgentina(ahoraMs)
  const feriado = feriadosDe(config, sucursal).find((f) => f.fecha === fecha)
  const hoyEsDeTrabajo = !feriado && regla.dias.includes(diaDeLaSemana)
  const dentroDelTurno = hoyEsDeTrabajo && minutos >= desde && minutos < hasta

  if (dentroDelTurno) {
    const finDelTurnoMs = instanteDelDiaEnArgentina(ahoraMs, hasta)
    const cierraEnMs = hayExcepcion ? Math.max(finDelTurnoMs, excepcionHastaMs) : finDelTurnoMs
    return { tipo: 'dentro', cierraEnMs, cierraA: horaDeArgentina(cierraEnMs) }
  }
  if (hayExcepcion) return { tipo: 'dentro', cierraEnMs: excepcionHastaMs, cierraA: horaDeArgentina(excepcionHastaMs) }
  const base = { desde: regla.desde, hasta: regla.hasta, dias: regla.dias }
  if (feriado) return { tipo: 'fuera', motivo: 'feriado', ...base, detalle: feriado.motivo }
  if (!hoyEsDeTrabajo) return { tipo: 'fuera', motivo: 'dia', ...base, detalle: '' }
  return { tipo: 'fuera', motivo: 'horario', ...base, detalle: '' }
}

/** El texto que se le muestra a quien quiere ingresar fuera de horario. */
export function mensajeFueraDeHorario(veredicto: Extract<VeredictoDeHorario, { tipo: 'fuera' }>): string {
  const pedir = 'Podés pedirle una excepción al superadministrador.'
  if (veredicto.motivo === 'feriado') {
    return `Hoy es un día no laborable${veredicto.detalle ? ` (${veredicto.detalle})` : ''}. ${pedir}`
  }
  if (veredicto.motivo === 'dia') {
    return `Hoy no es un día de trabajo para tu rol: se trabaja ${textoDeDias(veredicto.dias)}, de ${veredicto.desde} a ${veredicto.hasta}. ${pedir}`
  }
  return `Estás fuera de tu horario de trabajo (de ${veredicto.desde} a ${veredicto.hasta}). ${pedir}`
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

/** Lo que muestra la pantalla «Control de horarios». */
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
