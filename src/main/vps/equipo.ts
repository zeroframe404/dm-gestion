// Quién es esta computadora para el servidor (Autorizaciones de IP, Administración → Ciberseguridad).
//
// Cada pedido al VPS lleva las IP de las placas de red de esta PC en `x-dmg-ips-locales` (y el canal en vivo,
// en su `hola`). Con el control prendido, el servidor sólo atiende a las computadoras cuyas IP están en la
// lista. La IP pública no se manda: esa la ve el servidor solo, y nadie la puede inventar desde acá.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { CABECERA_DE_IPS_LOCALES } from '../../shared/autorizacionIp'
import { rutaIdDelEquipo } from '../rutas'

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

// ---------------------------------------------------------------------------
// El id estable de la computadora (licencia: los puestos)
// ---------------------------------------------------------------------------
//
// El nombre de Windows se repite (dos «PC-CAJA» en dos sucursales) y se cambia. Para contar puestos el
// servidor necesita algo que sea de ESTA computadora y no cambie: un id al azar que se crea la primera
// vez y se guarda. Si no se puede leer ni escribir (las pruebas, un disco lleno), se usa uno en memoria:
// la licencia cuenta igual, sólo que esa PC estrena puesto en cada arranque.

let idEnMemoria: string | null = null

const FORMATO = /^[A-Za-z0-9-]{8,80}$/

export function idDelEquipo(ruta?: string): string {
  if (idEnMemoria && ruta === undefined) return idEnMemoria
  let archivo = ruta ?? ''
  try {
    archivo ||= rutaIdDelEquipo()
  } catch {
    archivo = ''
  }
  let id = ''
  if (archivo) {
    try {
      if (existsSync(archivo)) {
        const guardado = (JSON.parse(readFileSync(archivo, 'utf8')) as { id?: unknown }).id
        if (typeof guardado === 'string' && FORMATO.test(guardado)) id = guardado
      }
      if (!id) {
        id = randomUUID()
        mkdirSync(path.dirname(archivo), { recursive: true })
        writeFileSync(archivo, JSON.stringify({ id }), 'utf8')
      }
    } catch (error) {
      console.error('[equipo] No se pudo guardar el id de esta computadora:', error instanceof Error ? error.message : error)
    }
  }
  id ||= randomUUID()
  if (ruta === undefined) idEnMemoria = id
  return id
}
