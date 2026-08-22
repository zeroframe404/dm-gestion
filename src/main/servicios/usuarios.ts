// Administración de usuarios. El control de rol (SUPER_ADMIN) lo hace ipc.ts antes de llamar acá.
import type { DatosEdicionUsuario, DatosNuevoUsuario, Rol, SesionUsuario, Usuario } from '../../shared/tipos'
import { db } from '../db/base'
import { hashearClave, validarClave } from './claves'
import { ErrorDeNegocio } from './errores'
import { establecerSesion } from './sesion'
import { obtenerSucursal } from './sucursales'
import { booleano, enteroPositivo, nombreDeUsuario, objeto, rol as validarRol, texto } from './validacion'

/** Fila cruda de la tabla usuarios, con el nombre de la sucursal ya unido. */
export interface FilaUsuario {
  id: number
  nombre: string
  usuario: string
  clave_hash: string
  rol: Rol
  sucursal_id: number
  sucursal_nombre: string
  activo: number
  debe_cambiar_clave: number
  creado_en: string
  actualizado_en: string
}

const CONSULTA_BASE = `
  SELECT u.id, u.nombre, u.usuario, u.clave_hash, u.rol, u.sucursal_id, s.nombre AS sucursal_nombre,
         u.activo, u.debe_cambiar_clave, u.creado_en, u.actualizado_en
  FROM usuarios u
  JOIN sucursales s ON s.id = u.sucursal_id`

/** Expresión SQL para la fecha actual en ISO 8601 (UTC). */
const AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

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

export function buscarFilaPorId(id: number): FilaUsuario | null {
  const fila = db().prepare(`${CONSULTA_BASE} WHERE u.id = ?`).get(id) as FilaUsuario | undefined
  return fila ?? null
}

/** La columna `usuario` tiene COLLATE NOCASE, así que la comparación no distingue mayúsculas. */
export function buscarFilaPorUsuario(usuario: string): FilaUsuario | null {
  const fila = db().prepare(`${CONSULTA_BASE} WHERE u.usuario = ?`).get(usuario) as FilaUsuario | undefined
  return fila ?? null
}

function exigirFila(id: number): FilaUsuario {
  const fila = buscarFilaPorId(id)
  if (!fila) throw new ErrorDeNegocio('El usuario no existe.')
  return fila
}

export function listarUsuarios(): Usuario[] {
  const filas = db()
    .prepare(`${CONSULTA_BASE} ORDER BY u.activo DESC, u.nombre COLLATE NOCASE, u.id`)
    .all() as FilaUsuario[]
  return filas.map(aUsuario)
}

interface DatosComunes {
  nombre: string
  usuario: string
  rol: Rol
  sucursalId: number
}

function validarDatosComunes(datos: unknown): DatosComunes {
  const d = objeto(datos, 'Los datos del usuario')
  const nombre = texto(d.nombre, 'El nombre', 2, 80)
  const usuario = nombreDeUsuario(d.usuario)
  const rol = validarRol(d.rol)
  const sucursalId = enteroPositivo(d.sucursalId, 'La sucursal')
  if (!obtenerSucursal(sucursalId)) throw new ErrorDeNegocio('La sucursal elegida no existe.')
  return { nombre, usuario, rol, sucursalId }
}

function exigirUsuarioLibre(usuario: string, exceptoId?: number): void {
  const existente = buscarFilaPorUsuario(usuario)
  if (existente && existente.id !== exceptoId) {
    throw new ErrorDeNegocio(`Ya existe un usuario con el nombre "${usuario}".`)
  }
}

/** Cantidad de superadministradores activos sin contar al indicado. */
function contarOtrosSuperAdminsActivos(exceptoId: number): number {
  const { total } = db()
    .prepare(`SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'SUPER_ADMIN' AND activo = 1 AND id <> ?`)
    .get(exceptoId) as { total: number }
  return total
}

export async function crearUsuario(datos: unknown): Promise<Usuario> {
  const comunes = validarDatosComunes(datos)
  const clave = validarClave((datos as Partial<DatosNuevoUsuario>).clave, 'La contraseña inicial')
  exigirUsuarioLibre(comunes.usuario)

  const claveHash = await hashearClave(clave)
  // El usuario nuevo entra con una contraseña que eligió otra persona: tiene que cambiarla al ingresar.
  const resultado = db()
    .prepare(
      `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
       VALUES (?, ?, ?, ?, ?, 1, 1)`,
    )
    .run(comunes.nombre, comunes.usuario, claveHash, comunes.rol, comunes.sucursalId)

  return aUsuario(exigirFila(Number(resultado.lastInsertRowid)))
}

export function editarUsuario(id: unknown, datos: unknown, actor: SesionUsuario): Usuario {
  const idValido = enteroPositivo(id, 'El usuario')
  const fila = exigirFila(idValido)
  const comunes: DatosEdicionUsuario = validarDatosComunes(datos)
  exigirUsuarioLibre(comunes.usuario, idValido)

  if (fila.id === actor.id && comunes.rol !== fila.rol) {
    throw new ErrorDeNegocio('No podés cambiar tu propio rol.')
  }
  if (
    fila.rol === 'SUPER_ADMIN' &&
    comunes.rol !== 'SUPER_ADMIN' &&
    fila.activo === 1 &&
    contarOtrosSuperAdminsActivos(fila.id) === 0
  ) {
    throw new ErrorDeNegocio('Tiene que quedar al menos un superadministrador activo.')
  }

  db()
    .prepare(
      `UPDATE usuarios SET nombre = ?, usuario = ?, rol = ?, sucursal_id = ?, actualizado_en = ${AHORA}
       WHERE id = ?`,
    )
    .run(comunes.nombre, comunes.usuario, comunes.rol, comunes.sucursalId, idValido)

  const actualizado = aUsuario(exigirFila(idValido))

  // Si se editó a sí mismo, la sesión tiene que reflejar el cambio de nombre o sucursal.
  if (actor.id === idValido) {
    establecerSesion({
      ...actor,
      nombre: actualizado.nombre,
      usuario: actualizado.usuario,
      sucursal: { id: actualizado.sucursalId, nombre: actualizado.sucursalNombre },
    })
  }
  return actualizado
}

export function cambiarActivo(id: unknown, activo: unknown, actor: SesionUsuario): Usuario {
  const idValido = enteroPositivo(id, 'El usuario')
  const activoValido = booleano(activo, 'El estado')
  const fila = exigirFila(idValido)

  if (!activoValido) {
    if (fila.id === actor.id) throw new ErrorDeNegocio('No podés desactivar tu propio usuario.')
    if (fila.rol === 'SUPER_ADMIN' && fila.activo === 1 && contarOtrosSuperAdminsActivos(fila.id) === 0) {
      throw new ErrorDeNegocio('Tiene que quedar al menos un superadministrador activo.')
    }
  }

  db()
    .prepare(`UPDATE usuarios SET activo = ?, actualizado_en = ${AHORA} WHERE id = ?`)
    .run(activoValido ? 1 : 0, idValido)

  return aUsuario(exigirFila(idValido))
}

export async function resetearClave(id: unknown, claveTemporal: unknown, actor: SesionUsuario): Promise<Usuario> {
  const idValido = enteroPositivo(id, 'El usuario')
  const clave = validarClave(claveTemporal, 'La contraseña temporal')
  const fila = exigirFila(idValido)
  const claveHash = await hashearClave(clave)

  // Si el superadministrador resetea su propia contraseña, la eligió él: no hace falta forzar el cambio.
  const esPropia = fila.id === actor.id
  db()
    .prepare(`UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = ?, actualizado_en = ${AHORA} WHERE id = ?`)
    .run(claveHash, esPropia ? 0 : 1, idValido)

  if (esPropia) establecerSesion({ ...actor, debeCambiarClave: false })
  return aUsuario(exigirFila(idValido))
}
