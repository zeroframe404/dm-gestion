// Sucursales: por ahora sólo lectura (Dock Sud, Lanús y Daniel se crean en la semilla).
import type { Sucursal } from '../../shared/tipos'
import { db } from '../db/base'
import { normalizarTexto } from '../importacion/normalizar'

export function listarSucursales(): Sucursal[] {
  return db().prepare('SELECT id, nombre FROM sucursales ORDER BY id').all() as Sucursal[]
}

export function obtenerSucursal(id: number): Sucursal | null {
  const fila = db().prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(id) as Sucursal | undefined
  return fila ?? null
}

/**
 * El id de la sucursal del catálogo que corresponde a ese texto, sin distinguir mayúsculas, tildes ni
 * espacios de más: la hoja escribe «LANUS», «DOCK SUD» y «DOCKSUD», y el catálogo dice «Lanús».
 *
 * La comparación TIENE que hacerse acá y no en el SQL. `UPPER()` y `COLLATE NOCASE` de SQLite sólo
 * tocan el ASCII: `UPPER('Lanús')` devuelve `'LANúS'`, que no empata nunca con el «LANUS» de la
 * planilla. De las tres sucursales de la agencia, la única con tilde es justamente Lanús, así que era
 * la única que no se enganchaba con su catálogo mientras Dock Sud y Daniel andaban bien.
 * Son tres filas: recorrerlas no se nota.
 */
export function idDeSucursalPorNombre(nombre: string): number | null {
  const buscado = normalizarTexto(nombre)
  if (!buscado) return null
  const sinEspacios = buscado.replace(/ /g, '')
  for (const fila of listarSucursales()) {
    const delCatalogo = normalizarTexto(fila.nombre)
    if (delCatalogo === buscado || delCatalogo.replace(/ /g, '') === sinEspacios) return fila.id
  }
  return null
}
