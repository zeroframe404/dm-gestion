// Autorizaciones de IP (Administración → Ciberseguridad): lo que comparten el proceso principal y las pantallas.
//
// Con el control prendido en el VPS, el servidor sólo atiende a las computadoras de la lista. Cada IP vale para
// su clase: una privada (192.168.x.x, 10.x.x.x, 169.254.x.x…) se compara contra las IP de las placas de red que
// declara esta PC (`CABECERA_DE_IPS_LOCALES`, en cada pedido y en el `hola` del canal en vivo); una pública,
// contra la que ve el servidor. Ver `server/src/modules/dmg/ips.reglas.ts` en el repositorio del VPS.

/** La cabecera con las IP locales de la PC. Tiene que ser la misma que lee el servidor. */
export const CABECERA_DE_IPS_LOCALES = 'x-dmg-ips-locales'
/** El `codigo` del 403 del servidor cuando la computadora no está en la lista. */
export const CODIGO_EQUIPO_NO_AUTORIZADO = 'EQUIPO_NO_AUTORIZADO'

export type TipoDeIp = 'local' | 'publica'

export interface IpAutorizada {
  id: string
  ip: string
  nombre: string
  tipo: TipoDeIp
  creadoPor: string | null
  creadoEn: string
}

export interface EquipoVistoPorElServidor {
  /** La IP pública con que esta PC llega al VPS ('' si no se supo). */
  publica: string
  /** Las IP de las placas de red de esta PC, como las recibió el servidor. */
  locales: string[]
  autorizado: boolean
  /** La IP de la lista que la deja entrar, o null. */
  porLaIp: string | null
}

/** Lo que contesta `/api/dmg/ips`. */
export interface EstadoDeAutorizacionesIp {
  activa: boolean
  /** El .env del VPS apagó el control (salida de emergencia): no se exige la lista aunque esté prendido. */
  apagadaPorElServidor: boolean
  actualizadoPor: string | null
  actualizadoEn: string | null
  lista: IpAutorizada[]
  esteEquipo: EquipoVistoPorElServidor
}

/** Lo que ve la pantalla: lo del servidor y las IP que esta PC lee de sus propias placas de red. */
export interface AutorizacionesIp extends EstadoDeAutorizacionesIp {
  ipsDeEstaPc: string[]
}

/** true si la respuesta del servidor es el rechazo por IP (y no otro 403). */
export function esRechazoDeEquipo(json: unknown): boolean {
  return typeof json === 'object' && json !== null && (json as { codigo?: unknown }).codigo === CODIGO_EQUIPO_NO_AUTORIZADO
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

/** Validación rápida para el formulario (la de verdad la hace el servidor, que también acepta IPv6). */
export function pareceUnaIp(texto: string): boolean {
  const limpio = texto.trim()
  return IPV4.test(limpio) || (/^[0-9a-f:]+$/i.test(limpio) && limpio.includes(':'))
}
