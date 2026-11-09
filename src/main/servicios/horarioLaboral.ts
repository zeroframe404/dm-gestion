// Uso laboral: hace cumplir el horario de trabajo de cada rol (Administración → Ciberseguridad → Control de horarios).
//
// QUÉ HACE ESTE ARCHIVO
//   1. No deja ABRIR sesión fuera de horario (`verificarIngreso`, antes de armar nada: ni canal en vivo
//      ni sincronización) y deja pedirle una excepción al superadministrador.
//   2. Con la sesión abierta, un reloj mira cuánto falta para que termine el turno: a los 30 minutos
//      avisa (zumbido y cartel amarillo, con «Aceptar» o «Pedir excepción»), y al llegar la hora cierra
//      la sesión sola, lo que corta también la conexión con el VPS.
//   3. Del lado del superadministrador, mira cada tanto si hay pedidos nuevos y se los avisa.
//
// QUIÉN ES EL JEFE DEL RELOJ. La hora de la agencia es la del SERVIDOR, no la de esta PC: cada lectura
// guarda el desfase entre las dos, así que cambiar la hora de Windows no corre el turno. Sin conexión
// (que es cuando la PC ya no puede preguntar) se sigue con lo último que se supo, guardado en la base
// local: ni apagar el wifi ni reiniciar el programa dejan trabajar fuera de horario. Sólo la primera
// vez, sin nada guardado y sin servidor, no hay con qué comparar y se deja pasar (lo contrario sería
// dejar a la agencia afuera por una caída de internet).
//
// QUÉ NO PUEDE HACER. El servidor no sabe quién es cada PC (un token compartido): el horario lo hace
// cumplir este programa y el servidor deja el REGISTRO de cada pedido, con la IP y la localidad que él
// ve. El superadministrador no tiene horario: ni se lo calcula ni se lo consulta.
//
// NADA DE ESTO PUEDE ROMPER EL PROGRAMA: si el VPS no contesta, se sigue con lo guardado y se anota.
import {
  evaluarHorario,
  MINUTOS_DE_AVISO,
  MINUTOS_DE_EXCEPCION,
  mensajeFueraDeHorario,
  motivoDeConfiguracionInvalida,
  normalizarConfiguracion,
  type ConfiguracionDeHorario,
  type EstadoDelHorarioEnElVps,
  type EstadoDelPedido,
  type EstadoDeUsoLaboral,
  type SolicitudDeHorario,
} from '../../shared/horario'
import type { SesionUsuario } from '../../shared/tipos'
import { esDemo } from '../canal'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import { ErrorDelServidorVps, type ActorDeMiLinkVps, type FuenteVps } from '../vps/fuenteVps'
import { emitirATodas, notificarEnElSistema, sacudirLaVentana } from './avisos'
import { cerrarSesionPorHorario } from './baseDeUsuarios'
import { ErrorDeNegocio, FueraDeHorario } from './errores'
import { crearFuenteVps } from './sincronizacion'
import { sesion } from './sesion'

const CLAVE_DE_CACHE = 'horario_cache'
/** Cuánto se espera al servidor al ingresar: alguien está mirando la ruedita. */
const TOPE_DE_ESPERA_MS = 6_000
/** Cada cuánto mira el reloj. */
const CADA_MS = 20_000
/** Cada cuántas vueltas del reloj se vuelve a leer el horario del servidor (cambios y excepciones). */
const VUELTAS_ENTRE_LECTURAS = 6
const MINUTOS_DEL_SEGUNDO_AVISO = 5

// ---------------------------------------------------------------------------
// Lo último que se supo del servidor
// ---------------------------------------------------------------------------

interface UltimoEstado {
  config: ConfiguracionDeHorario
  version: number
  /** `hora del servidor − hora de esta PC`, en milisegundos, de la última lectura. */
  desfaseMs: number
  excepcionHastaMs: number | null
}

let ultimo: UltimoEstado | null = null
let cargadoDeLaBase = false

function leerDeLaBase(): UltimoEstado | null {
  try {
    const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE_DE_CACHE) as { valor: string } | undefined
    if (!fila) return null
    const guardado = JSON.parse(fila.valor) as Partial<UltimoEstado>
    if (!guardado.config || typeof guardado.desfaseMs !== 'number') return null
    return {
      // Lo guardado por una versión anterior (un solo horario para todos) se lleva al formato por sucursal.
      config: normalizarConfiguracion(guardado.config),
      version: guardado.version ?? 0,
      desfaseMs: guardado.desfaseMs,
      excepcionHastaMs: typeof guardado.excepcionHastaMs === 'number' ? guardado.excepcionHastaMs : null,
    }
  } catch {
    return null
  }
}

function guardarEnLaBase(estado: UltimoEstado): void {
  try {
    db()
      .prepare(
        `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
      )
      .run(CLAVE_DE_CACHE, JSON.stringify(estado), ahoraIso())
  } catch (error) {
    console.error('[horario] No se pudo guardar lo último que se supo del horario:', error)
  }
}

function recordado(): UltimoEstado | null {
  if (!cargadoDeLaBase) {
    cargadoDeLaBase = true
    ultimo = leerDeLaBase()
  }
  return ultimo
}

function recordar(estado: EstadoDelHorarioEnElVps, ahoraLocalMs: number): UltimoEstado {
  const actual: UltimoEstado = {
    config: normalizarConfiguracion(estado.config),
    version: estado.version,
    desfaseMs: Date.parse(estado.ahora) - ahoraLocalMs,
    excepcionHastaMs: estado.excepcionHasta ? Date.parse(estado.excepcionHasta) : null,
  }
  ultimo = actual
  cargadoDeLaBase = true
  guardarEnLaBase(actual)
  return actual
}

// ---------------------------------------------------------------------------
// Hablar con el servidor
// ---------------------------------------------------------------------------

/** Cómo llegan los avisos a la pantalla. Las pruebas lo cambian para mirarlos (sin Electron no hay ventanas). */
let emitir: typeof emitirATodas = emitirATodas

export function usarEmisorDeHorario(nuevo: typeof emitirATodas | null): void {
  emitir = nuevo ?? emitirATodas
}

/** Para las pruebas: otra fuente. */
let hacerFuente: () => FuenteVps | null = crearFuenteVps

export function usarFuenteDeHorario(fuente: (() => FuenteVps | null) | null): void {
  hacerFuente = fuente ?? crearFuenteVps
}

function actorDe(sesionActual: Pick<SesionUsuario, 'usuario' | 'nombre' | 'rol'>): ActorDeMiLinkVps {
  return { clave: sesionActual.usuario.toLowerCase(), nombre: sesionActual.nombre, rol: sesionActual.rol }
}

function conTope<T>(promesa: Promise<T>, milisegundos: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('El servidor no contestó a tiempo.')), milisegundos)
    promesa.then(
      (valor) => {
        clearTimeout(reloj)
        resolver(valor)
      },
      (error: unknown) => {
        clearTimeout(reloj)
        rechazar(error)
      },
    )
  })
}

/** Lee el horario del servidor y lo recuerda. Null si no hay servidor o no contestó (se sigue con lo recordado). */
async function leerDelServidor(actor: ActorDeMiLinkVps, tope = TOPE_DE_ESPERA_MS): Promise<UltimoEstado | null> {
  const vps = hacerFuente()
  if (!vps) return null
  try {
    const antes = Date.now()
    const estado = await conTope(vps.horarioEstado(actor), tope)
    // El desfase se calcula con el punto medio del viaje: la hora del servidor es de cuando contestó.
    return recordar(estado, Math.round((antes + Date.now()) / 2))
  } catch (error) {
    console.error('[horario] No se pudo leer el horario del servidor:', error instanceof Error ? error.message : error)
    return null
  }
}

function sinHorario(rol: SesionUsuario['rol']): boolean {
  return rol === 'SUPER_ADMIN' || esDemo()
}

// ---------------------------------------------------------------------------
// 1. El ingreso
// ---------------------------------------------------------------------------

/** Quién quiso ingresar fuera de horario: es de quien se pide la excepción (la contraseña ya estaba bien). */
let bloqueado: { actor: ActorDeMiLinkVps; sucursal: string } | null = null
let pedidoDeIngreso: string | null = null

export async function verificarIngreso(candidata: SesionUsuario): Promise<void> {
  bloqueado = null
  pedidoDeIngreso = null
  if (sinHorario(candidata.rol)) return
  const actor = actorDe(candidata)
  const estado = (await leerDelServidor(actor)) ?? recordado()
  if (!estado) return
  const veredicto = evaluarHorario(estado.config, candidata.rol, candidata.sucursal.nombre, Date.now() + estado.desfaseMs, estado.excepcionHastaMs)
  if (veredicto.tipo !== 'fuera') return
  bloqueado = { actor, sucursal: candidata.sucursal.nombre }
  throw new FueraDeHorario(mensajeFueraDeHorario(veredicto))
}

export async function pedirExcepcionAlIngresar(motivo: unknown): Promise<SolicitudDeHorario> {
  if (!bloqueado) throw new ErrorDeNegocio('Primero ingresá con tu usuario y tu contraseña.')
  const solicitud = await conElServidor((vps) =>
    vps.horarioPedirExcepcion(bloqueado!.actor, { momento: 'INGRESO', sucursal: bloqueado!.sucursal, motivo: textoDe(motivo) }),
  )
  pedidoDeIngreso = solicitud.id
  return solicitud
}

/** Cómo viene el pedido hecho al ingresar (null si no se hizo ninguno). Lo pregunta la pantalla de Ingreso. */
export async function estadoDelPedidoAlIngresar(): Promise<SolicitudDeHorario | null> {
  if (!bloqueado || !pedidoDeIngreso) return null
  const id = pedidoDeIngreso
  const actor = bloqueado.actor
  return conElServidor((vps) => vps.horarioSolicitud(actor, id))
}

// ---------------------------------------------------------------------------
// 2. Con la sesión abierta
// ---------------------------------------------------------------------------

let reloj: ReturnType<typeof setInterval> | null = null
let vueltas = 0
let pedidoEnSesion: string | null = null
/** Hasta qué cierre ya se avisó, y en qué nivel (30 y 5 minutos): un aviso por cierre y nivel. */
let avisado: { cierraEnMs: number; nivel: number } | null = null
/** Los pedidos que el superadministrador ya vio, para no avisarle dos veces del mismo. */
let pedidosVistos = new Set<string>()
let trabajando = false

export function alCambiarLaSesionDeHorario(quien: SesionUsuario | null): void {
  pararReloj()
  if (!quien) return
  if (esDemo()) return
  vueltas = 0
  avisado = null
  pedidoEnSesion = null
  pedidosVistos = new Set()
  reloj = setInterval(() => void vuelta(), CADA_MS)
  // No mantiene vivo el proceso: si el programa se cierra, el reloj se va con él.
  reloj.unref?.()
  void vuelta()
}

export function pararReloj(): void {
  if (reloj) clearInterval(reloj)
  reloj = null
}

/** Una vuelta del reloj. Se exporta para que las pruebas no tengan que esperar 20 segundos. */
export async function vuelta(): Promise<void> {
  if (trabajando) return
  trabajando = true
  try {
    const actual = sesion()
    if (!actual) return
    if (actual.rol === 'SUPER_ADMIN') {
      await mirarPedidosNuevos(actual)
      return
    }
    vueltas++
    if (vueltas === 1 || vueltas % VUELTAS_ENTRE_LECTURAS === 0) await leerDelServidor(actorDe(actual), CADA_MS)
    await mirarMiPedido(actual)
    controlarElTurno(actual)
  } catch (error) {
    console.error('[horario] Falló una vuelta del reloj:', error)
  } finally {
    trabajando = false
  }
}

function controlarElTurno(actual: SesionUsuario): void {
  const estado = recordado()
  if (!estado) return
  const ahora = Date.now() + estado.desfaseMs
  const veredicto = evaluarHorario(estado.config, actual.rol, actual.sucursal.nombre, ahora, estado.excepcionHastaMs)
  if (veredicto.tipo === 'libre') return
  if (veredicto.tipo === 'fuera') {
    cerrarSesionPorHorario(
      'Terminó tu horario de trabajo y se cerró la sesión. Si necesitás seguir, ingresá de nuevo y pedile una excepción al superadministrador.',
    )
    return
  }
  const minutosRestantes = (veredicto.cierraEnMs - ahora) / 60_000
  const nivel = minutosRestantes <= MINUTOS_DEL_SEGUNDO_AVISO ? 2 : minutosRestantes <= MINUTOS_DE_AVISO ? 1 : 0
  if (nivel === 0) return
  if (avisado && avisado.cierraEnMs === veredicto.cierraEnMs && avisado.nivel >= nivel) return
  avisado = { cierraEnMs: veredicto.cierraEnMs, nivel }
  sacudirLaVentana()
  emitir('horario:aviso', { minutosRestantes: Math.max(1, Math.ceil(minutosRestantes)), cierraA: veredicto.cierraA })
}

/** Si esta persona pidió una excepción trabajando, mira si el superadministrador ya contestó. */
async function mirarMiPedido(actual: SesionUsuario): Promise<void> {
  if (!pedidoEnSesion) return
  const id = pedidoEnSesion
  const vps = hacerFuente()
  if (!vps) return
  let solicitud: SolicitudDeHorario
  try {
    solicitud = await conTope(vps.horarioSolicitud(actorDe(actual), id), CADA_MS)
  } catch (error) {
    console.error('[horario] No se pudo consultar el pedido de excepción:', error instanceof Error ? error.message : error)
    return
  }
  if (solicitud.estado === 'PENDIENTE') return
  pedidoEnSesion = null
  // Lo aprobado cambia el cierre: se vuelve a leer el horario para tener la excepción vigente.
  if (solicitud.estado === 'APROBADA') await leerDelServidor(actorDe(actual), CADA_MS)
  avisado = null
  emitir('horario:respuesta', {
    solicitudId: solicitud.id,
    estado: solicitud.estado,
    minutosConcedidos: solicitud.minutosConcedidos,
    cierraA: solicitud.estado === 'APROBADA' ? horaDelVencimiento(solicitud.vigenteHasta) : null,
  })
}

function horaDelVencimiento(iso: string | null): string | null {
  if (!iso) return null
  const ar = new Date(Date.parse(iso) - 3 * 60 * 60 * 1000)
  return `${String(ar.getUTCHours()).padStart(2, '0')}:${String(ar.getUTCMinutes()).padStart(2, '0')}`
}

export async function pedirExcepcionEnSesion(actual: SesionUsuario, motivo: unknown): Promise<SolicitudDeHorario> {
  if (actual.rol === 'SUPER_ADMIN') throw new ErrorDeNegocio('El superadministrador no tiene horario.')
  const solicitud = await conElServidor((vps) =>
    vps.horarioPedirExcepcion(actorDe(actual), { momento: 'EN_SESION', sucursal: actual.sucursal.nombre, motivo: textoDe(motivo) }),
  )
  pedidoEnSesion = solicitud.id
  return solicitud
}

// ---------------------------------------------------------------------------
// 3. El superadministrador
// ---------------------------------------------------------------------------

async function mirarPedidosNuevos(actual: SesionUsuario): Promise<void> {
  const vps = hacerFuente()
  if (!vps) return
  let pendientes: SolicitudDeHorario[]
  try {
    pendientes = await conTope(vps.horarioSolicitudes(actorDe(actual), 'PENDIENTE'), CADA_MS)
  } catch (error) {
    console.error('[horario] No se pudieron leer los pedidos pendientes:', error instanceof Error ? error.message : error)
    return
  }
  const nuevos = pendientes.filter((pedido) => !pedidosVistos.has(pedido.id))
  // Lo que ya no está pendiente (lo resolvió otra computadora) se olvida para que la lista no crezca.
  pedidosVistos = new Set(pendientes.map((pedido) => pedido.id))
  if (nuevos.length === 0) return
  sacudirLaVentana()
  notificarEnElSistema(
    'Pedido de excepción de horario',
    nuevos.length === 1 ? `${nuevos[0].nombre} pide trabajar fuera de horario.` : `${nuevos.length} personas piden trabajar fuera de horario.`,
  )
  emitir('horario:pedidos', { pendientes })
}

export async function pedidosPendientes(actual: SesionUsuario): Promise<SolicitudDeHorario[]> {
  exigirSuper(actual)
  return conElServidor((vps) => vps.horarioSolicitudes(actorDe(actual), 'PENDIENTE'))
}

export async function registroDeExcepciones(actual: SesionUsuario, estado?: EstadoDelPedido): Promise<SolicitudDeHorario[]> {
  exigirSuper(actual)
  return conElServidor((vps) => vps.horarioSolicitudes(actorDe(actual), estado))
}

export async function resolverPedido(
  actual: SesionUsuario,
  id: unknown,
  aprobada: unknown,
  minutos: unknown,
): Promise<SolicitudDeHorario> {
  exigirSuper(actual)
  if (typeof id !== 'string' || !id) throw new ErrorDeNegocio('Falta el pedido a resolver.')
  if (typeof aprobada !== 'boolean') throw new ErrorDeNegocio('Falta decir si se aprueba o se rechaza.')
  const duracion = aprobada ? (MINUTOS_DE_EXCEPCION.find((m) => m === Number(minutos)) ?? null) : null
  if (aprobada && duracion === null) throw new ErrorDeNegocio(`El permiso puede ser de ${MINUTOS_DE_EXCEPCION.join(', ')} minutos.`)
  return conElServidor((vps) => vps.horarioResolver(actorDe(actual), id, aprobada, duracion))
}

// ---------------------------------------------------------------------------
// La pantalla «Control de horarios»
// ---------------------------------------------------------------------------

function exigirSuper(actual: SesionUsuario): void {
  if (actual.rol !== 'SUPER_ADMIN') throw new ErrorDeNegocio('Esto lo hace únicamente el superadministrador.')
}

export async function estadoDeUsoLaboral(actual: SesionUsuario): Promise<EstadoDeUsoLaboral> {
  exigirSuper(actual)
  const estado = await conElServidor((vps) => vps.horarioEstado(actorDe(actual)))
  return { config: normalizarConfiguracion(estado.config), version: estado.version }
}

export async function guardarUsoLaboral(actual: SesionUsuario, config: unknown): Promise<EstadoDeUsoLaboral> {
  exigirSuper(actual)
  const valida = configuracionDe(config)
  const estado = await conElServidor((vps) => vps.horarioGuardar(actorDe(actual), valida))
  return { config: normalizarConfiguracion(estado.config), version: estado.version }
}

function configuracionDe(valor: unknown): ConfiguracionDeHorario {
  const crudo = (typeof valor === 'object' && valor !== null ? valor : {}) as Record<string, unknown>
  if (typeof crudo.habilitado !== 'boolean') throw new ErrorDeNegocio('Falta el interruptor general del horario.')
  // Se reconstruye con lo que el programa conoce: las cuatro sucursales, sólo los campos válidos.
  const config = normalizarConfiguracion(valor)
  const motivo = motivoDeConfiguracionInvalida(config)
  if (motivo) throw new ErrorDeNegocio(motivo)
  return config
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function textoDe(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim().slice(0, 500) : ''
}

/**
 * Corre un pedido contra el VPS dejando los «no» del servidor con SU texto (ya viene en castellano y para
 * la persona). Sin servidor o sin internet: un mensaje claro.
 */
async function conElServidor<T>(hacer: (vps: FuenteVps) => Promise<T>): Promise<T> {
  const vps = hacerFuente()
  if (!vps) throw new ErrorDeNegocio('El horario laboral necesita conexión con el servidor de la agencia.')
  try {
    return await hacer(vps)
  } catch (error) {
    if (error instanceof ErrorDelServidorVps && [400, 403, 404, 409].includes(error.status)) {
      throw new ErrorDeNegocio(error.detalle)
    }
    if (error instanceof ErrorDeNegocio) throw error
    throw new ErrorDeNegocio('No hay conexión con el servidor de la agencia. Probá de nuevo en un momento.')
  }
}

/** Sólo para las pruebas: vuelve al estado de recién arrancado. */
export function reiniciarHorarioParaPruebas(): void {
  pararReloj()
  vueltas = 0
  ultimo = null
  cargadoDeLaBase = false
  bloqueado = null
  pedidoDeIngreso = null
  pedidoEnSesion = null
  avisado = null
  pedidosVistos = new Set()
  trabajando = false
}
