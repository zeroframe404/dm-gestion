// Inicio de sesión, cierre y cambio de contraseña del usuario logueado.
import { hashSync } from 'bcryptjs'
import type { SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { COSTO_BCRYPT, hashearClave, validarClave, verificarClave } from './claves'
import { ErrorDeNegocio } from './errores'
import { establecerSesion } from './sesion'
import { buscarFilaPorId, buscarFilaPorUsuario, type FilaUsuario } from './usuarios'
import { objeto, texto } from './validacion'

const AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

/**
 * Hash señuelo: cuando el usuario no existe igual comparamos contra algo, así el tiempo de
 * respuesta no delata qué nombres de usuario son válidos. Se calcula una sola vez.
 */
let hashSenuelo: string | null = null
function obtenerHashSenuelo(): string {
  if (!hashSenuelo) hashSenuelo = hashSync('dm-gestion-senuelo', COSTO_BCRYPT)
  return hashSenuelo
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

export async function ingresar(datos: unknown): Promise<SesionUsuario> {
  const d = objeto(datos, 'Las credenciales')
  const usuario = texto(d.usuario, 'El usuario', 1, 64).toLowerCase()
  const clave = typeof d.clave === 'string' ? d.clave : ''
  if (!clave) throw new ErrorDeNegocio('Ingresá tu contraseña.')

  const fila = buscarFilaPorUsuario(usuario)
  const claveCorrecta = await verificarClave(clave, fila ? fila.clave_hash : obtenerHashSenuelo())
  if (!fila || !claveCorrecta) throw new ErrorDeNegocio('Usuario o contraseña incorrectos.')
  if (fila.activo !== 1) throw new ErrorDeNegocio('Tu usuario está desactivado. Consultá con un administrador.')

  const nuevaSesion = filaASesion(fila)
  establecerSesion(nuevaSesion)
  return nuevaSesion
}

export function salir(): void {
  establecerSesion(null)
}

export async function cambiarClave(datos: unknown, actor: SesionUsuario): Promise<SesionUsuario> {
  const d = objeto(datos, 'Los datos')
  const claveActual = typeof d.claveActual === 'string' ? d.claveActual : ''
  const claveNueva = validarClave(d.claveNueva, 'La contraseña nueva')

  const fila = buscarFilaPorId(actor.id)
  if (!fila || fila.activo !== 1) {
    establecerSesion(null)
    throw new ErrorDeNegocio('La sesión ya no es válida. Volvé a iniciar sesión.')
  }
  if (!claveActual) throw new ErrorDeNegocio('Ingresá tu contraseña actual.')
  if (!(await verificarClave(claveActual, fila.clave_hash))) {
    throw new ErrorDeNegocio('La contraseña actual no es correcta.')
  }
  if (claveActual === claveNueva) {
    throw new ErrorDeNegocio('La contraseña nueva tiene que ser distinta de la actual.')
  }

  const claveHash = await hashearClave(claveNueva)
  db()
    .prepare(`UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = 0, actualizado_en = ${AHORA} WHERE id = ?`)
    .run(claveHash, actor.id)

  const sesionActualizada: SesionUsuario = { ...actor, debeCambiarClave: false }
  establecerSesion(sesionActualizada)
  return sesionActualizada
}
