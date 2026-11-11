// Autorizaciones puntuales: un usuario pide acceso a un módulo que su rol no le da, y alguien que
// puede decidir (el superadministrador o un rol con «puede resolver») lo concede —de lectura, o de
// lectura y escritura—, o lo deniega. Siempre con un mensaje que le llega al que pidió.
//
// Es puro y compartido (main y renderer). El que manda es el proceso principal: la concesión vigente
// se suma a lo que el rol ya permite al decidir cada llamado (servicios/permisos.ts) y NUNCA le saca
// nada: una autorización sólo puede subir el nivel de un área, jamás bajarlo.
//
// Los pedidos viven en `usuarios.json` (mismo archivo que los permisos, así valen en todas las
// computadoras sin tocar el servidor) o, sin base compartida, en la tabla `configuracion`.
import { AREAS, esArea, esNivel, mejorNivel, type Area, type Nivel } from './permisos'

export type EstadoDeSolicitud = 'pendiente' | 'concedida' | 'denegada'

/** Cuánto dura una autorización concedida. */
export const DURACIONES = ['hora', 'cuatroHoras', 'hoy', 'semana'] as const
export type Duracion = (typeof DURACIONES)[number]

export const NOMBRE_DURACION: Record<Duracion, string> = {
  hora: '1 hora',
  cuatroHoras: '4 horas',
  hoy: 'Hasta el final del día',
  semana: '7 días',
}

export const LARGO_MAXIMO_MENSAJE = 400

export interface SolicitudDeAutorizacion {
  id: string
  /** El usuario (login, en minúsculas) que pidió. */
  usuario: string
  nombre: string
  area: Area
  /** Lo que pidió: `ver` (sólo lectura) o `editar` (lectura y escritura). */
  nivelPedido: Exclude<Nivel, 'ninguno'>
  motivo: string
  creadaEn: string
  estado: EstadoDeSolicitud
  /** Lo que decidió quien resolvió: `editar`, `ver` o `ninguno` (denegada). */
  nivelOtorgado: Nivel | null
  resueltaPor: string | null
  resueltaEn: string | null
  /** El mensaje de quien resolvió, para el que pidió. */
  mensaje: string
  /** Hasta cuándo vale la concesión (ISO). Sólo las concedidas. */
  venceEn: string | null
  /** Si el que pidió ya vio la respuesta: es lo que apaga el puntito de la campana. */
  vista: boolean
}

/** Cuánto se guarda de lo ya resuelto: lo suficiente para ver el historial reciente sin que el archivo crezca. */
const DIAS_DE_HISTORIAL = 30
const MAXIMO_DE_SOLICITUDES = 300

function texto(valor: unknown, maximo: number): string {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, maximo) : ''
}

function fecha(valor: unknown): string | null {
  return typeof valor === 'string' && !Number.isNaN(Date.parse(valor)) ? valor : null
}

export function normalizarSolicitudes(crudo: unknown): SolicitudDeAutorizacion[] {
  if (!Array.isArray(crudo)) return []
  const vistos = new Set<string>()
  const resultado: SolicitudDeAutorizacion[] = []
  for (const item of crudo) {
    if (typeof item !== 'object' || item === null) continue
    const s = item as Record<string, unknown>
    const id = texto(s.id, 60)
    const usuario = texto(s.usuario, 60).toLowerCase()
    const creadaEn = fecha(s.creadaEn)
    if (!id || vistos.has(id) || !usuario || !creadaEn || !esArea(s.area)) continue
    if (s.nivelPedido !== 'ver' && s.nivelPedido !== 'editar') continue
    const estado: EstadoDeSolicitud = s.estado === 'concedida' || s.estado === 'denegada' ? s.estado : 'pendiente'
    vistos.add(id)
    resultado.push({
      id,
      usuario,
      nombre: texto(s.nombre, 80) || usuario,
      area: s.area,
      nivelPedido: s.nivelPedido,
      motivo: texto(s.motivo, LARGO_MAXIMO_MENSAJE),
      creadaEn,
      estado,
      nivelOtorgado: estado === 'pendiente' ? null : esNivel(s.nivelOtorgado) ? s.nivelOtorgado : 'ninguno',
      resueltaPor: estado === 'pendiente' ? null : texto(s.resueltaPor, 80) || null,
      resueltaEn: estado === 'pendiente' ? null : fecha(s.resueltaEn),
      mensaje: estado === 'pendiente' ? '' : texto(s.mensaje, LARGO_MAXIMO_MENSAJE),
      venceEn: estado === 'concedida' ? fecha(s.venceEn) : null,
      vista: s.vista === true,
    })
  }
  return resultado
}

/** Saca lo resuelto hace más de un mes y, si todavía son demasiadas, lo más viejo ya resuelto. */
export function podarSolicitudes(solicitudes: SolicitudDeAutorizacion[], ahoraMs: number): SolicitudDeAutorizacion[] {
  const limite = ahoraMs - DIAS_DE_HISTORIAL * 86_400_000
  let lista = solicitudes.filter((s) => s.estado === 'pendiente' || Date.parse(s.resueltaEn ?? s.creadaEn) >= limite)
  if (lista.length > MAXIMO_DE_SOLICITUDES) {
    const pendientes = lista.filter((s) => s.estado === 'pendiente')
    const resueltas = lista.filter((s) => s.estado !== 'pendiente').sort((a, b) => Date.parse(b.resueltaEn ?? '') - Date.parse(a.resueltaEn ?? ''))
    lista = [...pendientes, ...resueltas.slice(0, Math.max(0, MAXIMO_DE_SOLICITUDES - pendientes.length))]
  }
  return lista
}

/** ¿Esta concesión sigue valiendo ahora? */
export function estaVigente(solicitud: SolicitudDeAutorizacion, ahoraMs: number): boolean {
  return solicitud.estado === 'concedida' && solicitud.venceEn !== null && Date.parse(solicitud.venceEn) > ahoraMs
}

/** Las concesiones vigentes de un usuario. */
export function concesionesVigentes(solicitudes: SolicitudDeAutorizacion[], usuario: string, ahoraMs: number): SolicitudDeAutorizacion[] {
  const clave = usuario.trim().toLowerCase()
  return solicitudes.filter((s) => s.usuario === clave && estaVigente(s, ahoraMs))
}

/** El nivel que suman las concesiones vigentes en un área (`ninguno` si no hay ninguna). */
export function nivelConcedido(solicitudes: SolicitudDeAutorizacion[], usuario: string, area: Area, ahoraMs: number): Nivel {
  return concesionesVigentes(solicitudes, usuario, ahoraMs)
    .filter((s) => s.area === area)
    .reduce<Nivel>((mejor, s) => mejorNivel(mejor, s.nivelOtorgado ?? 'ninguno'), 'ninguno')
}

/** Cuándo vence una concesión que se da ahora. «Hoy» es hasta las 23:59 de la hora local de esta PC. */
export function vencimientoDe(duracion: Duracion, ahora: Date): string {
  switch (duracion) {
    case 'hora':
      return new Date(ahora.getTime() + 3_600_000).toISOString()
    case 'cuatroHoras':
      return new Date(ahora.getTime() + 4 * 3_600_000).toISOString()
    case 'semana':
      return new Date(ahora.getTime() + 7 * 86_400_000).toISOString()
    case 'hoy': {
      const fin = new Date(ahora)
      fin.setHours(23, 59, 59, 999)
      return fin.toISOString()
    }
  }
}

export function esDuracion(valor: unknown): valor is Duracion {
  return typeof valor === 'string' && (DURACIONES as readonly string[]).includes(valor)
}

export const AREAS_PEDIBLES: readonly Area[] = AREAS

/** Lo que ve la campana: mis pedidos y, si puedo decidir, los de los demás. */
export interface EstadoDeAutorizaciones {
  puedeSolicitar: boolean
  puedeResolver: boolean
  mias: SolicitudDeAutorizacion[]
  /** Pendientes de todos (menos los míos). Sólo si puede resolver. */
  pendientes: SolicitudDeAutorizacion[]
  /** Las que ya resolví yo o cualquier otro resolutor, para que no desaparezcan sin dejar rastro. */
  resueltasRecientes: SolicitudDeAutorizacion[]
}

export interface DatosDePedido {
  area: Area
  nivel: 'ver' | 'editar'
  motivo: string
}

export interface DatosDeResolucion {
  id: string
  decision: Nivel
  mensaje: string
  duracion: Duracion
}
