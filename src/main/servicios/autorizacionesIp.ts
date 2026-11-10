// Autorizaciones de IP (Administración → Ciberseguridad → Autorizaciones de IP). Sólo el superadministrador.
//
// QUÉ PROTEGE. Con el control prendido, el VPS sólo atiende a las computadoras de la lista: el que se lleva el
// programa con un usuario y su contraseña, o el que saca el token haciendo ingeniería inversa, no puede ingresar
// ni conectarse desde otra computadora. Lo hace cumplir el SERVIDOR (`server/src/modules/dmg/ips.service.ts` en
// el repositorio del VPS): este archivo sólo maneja la lista. Cada pedido al VPS lleva las IP de las placas de
// red de esta PC (`vps/equipo.ts`); la IP pública la ve el servidor solo.
//
// QUÉ PASA SI ESTA COMPUTADORA NO ESTÁ EN LA LISTA: no se puede ingresar (ni con la credencial guardada) y una
// sesión abierta se cierra en la próxima revalidación (ver `baseDeUsuarios.ts`, `no-autorizado`).
import { pareceUnaIp, type AutorizacionesIp, type EstadoDeAutorizacionesIp } from '../../shared/autorizacionIp'
import type { SesionUsuario } from '../../shared/tipos'
import { ErrorDelServidorVps, type ActorDeMiLinkVps, type FuenteVps } from '../vps/fuenteVps'
import { ipsLocalesDelEquipo } from '../vps/equipo'
import { ErrorDeNegocio } from './errores'
import { crearFuenteVps } from './sincronizacion'

let hacerFuente: () => FuenteVps | null = crearFuenteVps

/** Sólo para las pruebas. */
export function usarFuenteDeAutorizacionesIp(fuente: (() => FuenteVps | null) | null): void {
  hacerFuente = fuente ?? crearFuenteVps
}

function exigirSuper(actual: SesionUsuario): void {
  if (actual.rol !== 'SUPER_ADMIN') throw new ErrorDeNegocio('Esto lo hace únicamente el superadministrador.')
}

function actorDe(actual: SesionUsuario): ActorDeMiLinkVps {
  return { clave: actual.usuario.toLowerCase(), nombre: actual.nombre, rol: actual.rol }
}

async function conElServidor(hacer: (vps: FuenteVps) => Promise<EstadoDeAutorizacionesIp>): Promise<AutorizacionesIp> {
  const vps = hacerFuente()
  if (!vps) throw new ErrorDeNegocio('Las autorizaciones de IP necesitan conexión con el servidor de la agencia.')
  let estado: EstadoDeAutorizacionesIp
  try {
    estado = await hacer(vps)
  } catch (error) {
    if (error instanceof ErrorDelServidorVps && [400, 403, 404, 409].includes(error.status)) throw new ErrorDeNegocio(error.detalle)
    if (error instanceof ErrorDeNegocio) throw error
    throw new ErrorDeNegocio('No hay conexión con el servidor de la agencia. Probá de nuevo en un momento.')
  }
  return { ...estado, lista: estado.lista ?? [], ipsDeEstaPc: ipsLocalesDelEquipo() }
}

export async function leerAutorizacionesIp(actual: SesionUsuario): Promise<AutorizacionesIp> {
  exigirSuper(actual)
  return conElServidor((vps) => vps.ipsEstado(actorDe(actual)))
}

export async function cambiarControlDeIp(actual: SesionUsuario, activa: unknown): Promise<AutorizacionesIp> {
  exigirSuper(actual)
  if (typeof activa !== 'boolean') throw new ErrorDeNegocio('Falta si el control queda prendido o apagado.')
  return conElServidor((vps) => vps.ipsCambiarControl(actorDe(actual), activa))
}

export async function autorizarIp(actual: SesionUsuario, ip: unknown, nombre: unknown): Promise<AutorizacionesIp> {
  exigirSuper(actual)
  const limpia = typeof ip === 'string' ? ip.trim() : ''
  const nombreLimpio = typeof nombre === 'string' ? nombre.replace(/\s+/g, ' ').trim() : ''
  if (!pareceUnaIp(limpia)) throw new ErrorDeNegocio('Eso no es una dirección IP válida (por ejemplo, 192.168.1.46).')
  if (!nombreLimpio) throw new ErrorDeNegocio('Poné un nombre para reconocer la computadora (por ejemplo, «PC de caja»).')
  if (nombreLimpio.length > 80) throw new ErrorDeNegocio('El nombre puede tener hasta 80 letras.')
  return conElServidor((vps) => vps.ipsAutorizar(actorDe(actual), limpia, nombreLimpio))
}

export async function desautorizarIp(actual: SesionUsuario, id: unknown): Promise<AutorizacionesIp> {
  exigirSuper(actual)
  if (typeof id !== 'string' || !id.trim()) throw new ErrorDeNegocio('Falta cuál IP desautorizar.')
  return conElServidor((vps) => vps.ipsDesautorizar(actorDe(actual), id.trim()))
}
