// Sucursales: sólo lectura. Las cuatro de la agencia (Dock Sud, Lanús, Sarandí y Daniel) las deja
// sembradas `ajustarCatalogoDeSucursales` en cada arranque; acá no se crea ninguna.
import { claveDeSucursal, sucursalCanonica, SUCURSALES } from '../../shared/sucursales'
import type { Sucursal } from '../../shared/tipos'
import { db } from '../db/base'

const ORDEN: readonly string[] = SUCURSALES

/**
 * El catálogo en el orden de la agencia, no en el del `id`: Sarandí se agregó después de las otras
 * tres, así que en una base vieja su id es el más alto y ordenar por id la mandaba al final de todos
 * los desplegables. Un nombre que no sea de los cuatro (queda si alguna base lo tenía) va al final.
 */
export function listarSucursales(): Sucursal[] {
  const filas = db().prepare('SELECT id, nombre FROM sucursales').all() as Sucursal[]
  const orden = (nombre: string) => {
    const posicion = ORDEN.indexOf(sucursalCanonica(nombre) ?? '')
    return posicion === -1 ? ORDEN.length : posicion
  }
  return filas.sort((a, b) => orden(a.nombre) - orden(b.nombre) || a.nombre.localeCompare(b.nombre, 'es'))
}

export function obtenerSucursal(id: number): Sucursal | null {
  const fila = db().prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(id) as Sucursal | undefined
  return fila ?? null
}

/**
 * El id de la sucursal del catálogo que corresponde a ese texto, sin distinguir mayúsculas, tildes ni
 * espacios de más, y entendiendo los dos nombres del mismo mostrador: la hoja escribe «LANUS»,
 * «DOCK SUD», «DOCKSUD» o «AVELLANEDA», y el catálogo dice «Lanús» y «Dock Sud».
 *
 * La comparación TIENE que hacerse acá y no en el SQL. `UPPER()` y `COLLATE NOCASE` de SQLite sólo
 * tocan el ASCII: `UPPER('Lanús')` devuelve `'LANúS'`, que no empata nunca con el «LANUS» de la
 * planilla. De las cuatro sucursales de la agencia, las que llevan tilde son justamente Lanús y
 * Sarandí, así que eran las que no se enganchaban con su catálogo mientras Dock Sud y Daniel andaban
 * bien. Son cuatro filas: recorrerlas no se nota.
 */
export function idDeSucursalPorNombre(nombre: string): number | null {
  const clave = claveDeSucursal(nombre)
  if (!clave) return null
  const buscado = sucursalCanonica(nombre)
  for (const fila of listarSucursales()) {
    if (buscado ? sucursalCanonica(fila.nombre) === buscado : claveDeSucursal(fila.nombre) === clave) return fila.id
  }
  return null
}

/**
 * El texto de sucursal listo para guardar: escrito como el catálogo, o null si viene vacío. Lo que la
 * agencia carga a mano —una consulta, un cliente nuevo— tiene que quedar igual que lo que trae la hoja,
 * o el mismo local termina siendo dos opciones distintas en el desplegable.
 */
export function sucursalParaGuardar(texto: string | null | undefined): string | null {
  const limpio = (texto ?? '').trim()
  if (!limpio) return null
  return sucursalCanonica(limpio) ?? limpio
}
