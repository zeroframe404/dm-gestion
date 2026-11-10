// Quién es esta computadora para el servidor (Autorizaciones de IP, Administración → Ciberseguridad).
//
// Cada pedido al VPS lleva las IP de las placas de red de esta PC en `x-dmg-ips-locales` (y el canal en vivo,
// en su `hola`). Con el control prendido, el servidor sólo atiende a las computadoras cuyas IP están en la
// lista. La IP pública no se manda: esa la ve el servidor solo, y nadie la puede inventar desde acá.
import { networkInterfaces } from 'node:os'
import { CABECERA_DE_IPS_LOCALES } from '../../shared/autorizacionIp'

/** Una PC no tiene tantas placas: más que esto es ruido (adaptadores virtuales). Lo mismo tope el servidor. */
const MAXIMO = 32

/**
 * Las IPv4 de esta computadora, sin la de loopback. Incluye las 169.254.x.x (las que Windows se pone solo en
 * una placa sin DHCP): la agencia las tiene en la lista. Se leen en cada pedido, porque cambian (wifi, cable).
 */
export function ipsLocalesDelEquipo(placas: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const vistas = new Set<string>()
  for (const direcciones of Object.values(placas)) {
    for (const direccion of direcciones ?? []) {
      const familia = String(direccion.family)
      if (direccion.internal || (familia !== 'IPv4' && familia !== '4')) continue
      vistas.add(direccion.address)
    }
  }
  return [...vistas].slice(0, MAXIMO)
}

/** La cabecera que va en cada pedido al VPS. */
export function encabezadosDelEquipo(): Record<string, string> {
  try {
    return { [CABECERA_DE_IPS_LOCALES]: ipsLocalesDelEquipo().join(',') }
  } catch {
    // Leer las placas no puede romper un pedido: sin la cabecera, el servidor decide sólo por la IP pública.
    return {}
  }
}
