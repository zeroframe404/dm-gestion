// Lectura de la tabla local `usuarios` (el espejo). Lo comparten auth.ts, usuarios.ts y
// baseDeUsuarios.ts; vive aparte para que ninguno tenga que importar a los otros.
import type { Rol, SesionUsuario, Usuario } from '../../shared/tipos'
import { db } from '../db/base'

/** Fila cruda de la tabla usuarios, con el nombre de la sucursal ya unido. */
export interface FilaUsuario {
  id: number
  nombre: string
  usuario: string
  /** Vacío cuando el usuario vive en la base compartida: la contraseña no se guarda en esta computadora. */
  clave_hash: string
  rol: Rol
  sucursal_id: number
  sucursal_nombre: string
  activo: number
  debe_cambiar_clave: number
  remoto_id: number | null
  creado_en: string
  actualizado_en: string
}

export const CONSULTA_BASE = `
  SELECT u.id, u.nombre, u.usuario, u.clave_hash, u.rol, u.sucursal_id, s.nombre AS sucursal_nombre,
         u.activo, u.debe_cambiar_clave, u.remoto_id, u.creado_en, u.actualizado_en
  FROM usuarios u
  JOIN sucursales s ON s.id = u.sucursal_id`

/** Expresión SQL para la fecha actual en ISO 8601 (UTC). */
export const AHORA_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

export function aUsuario(fila: FilaUsuario): Usuario {
  return {
    id: fila.id,
    nombre: fila.nombre,
    usuario: fila.usuario,
    rol: fila.rol,
    sucursalId: fila.sucursal_id,
    sucursalNombre: fila.sucursal_nombre,
    activo: fila.activo === 1,
    debeCambiarClave: fila.debe_cambiar_clave === 1,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  }
}

export function filaASesion(fila: FilaUsuario): SesionUsuario {
  return {
    id: fila.id,
    nombre: fila.nombre,
    usuario: fila.usuario,
    rol: fila.rol,
    sucursal: { id: fila.sucursal_id, nombre: fila.sucursal_nombre },
    debeCambiarClave: fila.debe_cambiar_clave === 1,
  }
}

export function buscarFilaPorId(id: number): FilaUsuario | null {
  const fila = db().prepare(`${CONSULTA_BASE} WHERE u.id = ?`).get(id) as FilaUsuario | undefined
  return fila ?? null
}

/** La columna `usuario` tiene COLLATE NOCASE, así que la comparación no distingue mayúsculas. */
export function buscarFilaPorUsuario(usuario: string): FilaUsuario | null {
  const fila = db().prepare(`${CONSULTA_BASE} WHERE u.usuario = ?`).get(usuario) as FilaUsuario | undefined
  return fila ?? null
}

export function buscarFilaPorRemotoId(remotoId: number): FilaUsuario | null {
  const fila = db().prepare(`${CONSULTA_BASE} WHERE u.remoto_id = ?`).get(remotoId) as FilaUsuario | undefined
  return fila ?? null
}

export function listarFilas(): FilaUsuario[] {
  return db().prepare(`${CONSULTA_BASE} ORDER BY u.activo DESC, u.nombre COLLATE NOCASE, u.id`).all() as FilaUsuario[]
}
