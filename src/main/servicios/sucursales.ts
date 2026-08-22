// Sucursales: por ahora sólo lectura (Dock Sud, Lanús y Daniel se crean en la semilla).
import type { Sucursal } from '../../shared/tipos'
import { db } from '../db/base'

export function listarSucursales(): Sucursal[] {
  return db().prepare('SELECT id, nombre FROM sucursales ORDER BY id').all() as Sucursal[]
}

export function obtenerSucursal(id: number): Sucursal | null {
  const fila = db().prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(id) as Sucursal | undefined
  return fila ?? null
}
