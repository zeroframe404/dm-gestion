// Inicio de sesión, cierre y cambio de contraseña del usuario logueado.
//
// Si la computadora trabaja con la base de usuarios compartida (GitHub), todo pasa por
// baseDeUsuarios.ts. Si no (desarrollo sin token, o la base todavía no se inicializó), se usa la tabla
// local como siempre.
import type { SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { AHORA_SQL, buscarFilaPorId, buscarFilaPorUsuario, filaASesion } from '../usuarios/filas'
import * as compartida from './baseDeUsuarios'
import { hashearClave, hashSenuelo, validarClave, verificarClave } from './claves'
import { ErrorDeNegocio } from './errores'
import { establecerSesion } from './sesion'
import { objeto, texto } from './validacion'

export { filaASesion }

export async function ingresar(datos: unknown): Promise<SesionUsuario> {
  const d = objeto(datos, 'Las credenciales')
  const usuario = texto(d.usuario, 'El usuario', 1, 64).toLowerCase()
  const clave = typeof d.clave === 'string' ? d.clave : ''
  if (!clave) throw new ErrorDeNegocio('Ingresá tu contraseña.')

  if ((await compartida.prepararIngreso()) === 'compartida') return compartida.ingresar(usuario, clave)
  return ingresarLocal(usuario, clave)
}

/** El ingreso de siempre: contra la tabla de esta computadora. */
async function ingresarLocal(usuario: string, clave: string): Promise<SesionUsuario> {
  const fila = buscarFilaPorUsuario(usuario)
  const claveCorrecta = await verificarClave(clave, fila && fila.clave_hash ? fila.clave_hash : hashSenuelo())
  if (!fila || !claveCorrecta) {
    // Base compartida configurada pero inalcanzable, y el usuario no es de esta computadora: decirle
    // «contraseña incorrecta» sería mentirle; lo que le falta es internet.
    const motivo = !fila || !fila.clave_hash ? compartida.motivoSinAccesoLocal() : null
    throw new ErrorDeNegocio(motivo ?? 'Usuario o contraseña incorrectos.')
  }
  if (fila.activo !== 1) throw new ErrorDeNegocio('Tu usuario está desactivado. Consultá con un administrador.')

  const nuevaSesion = filaASesion(fila)
  establecerSesion(nuevaSesion)
  compartida.anotarIngresoLocal()
  return nuevaSesion
}

export function salir(): void {
  compartida.cerrarSesion()
}

export async function cambiarClave(datos: unknown, actor: SesionUsuario): Promise<SesionUsuario> {
  const d = objeto(datos, 'Los datos')
  const claveActual = typeof d.claveActual === 'string' ? d.claveActual : ''
  const claveNueva = validarClave(d.claveNueva, 'La contraseña nueva')
  if (!claveActual) throw new ErrorDeNegocio('Ingresá tu contraseña actual.')
  if (claveActual === claveNueva) {
    throw new ErrorDeNegocio('La contraseña nueva tiene que ser distinta de la actual.')
  }

  if (compartida.usaBaseCompartida()) return compartida.cambiarClave(actor, claveActual, claveNueva)

  const fila = buscarFilaPorId(actor.id)
  if (!fila || fila.activo !== 1) {
    establecerSesion(null)
    throw new ErrorDeNegocio('La sesión ya no es válida. Volvé a iniciar sesión.')
  }
  if (!(await verificarClave(claveActual, fila.clave_hash))) {
    throw new ErrorDeNegocio('La contraseña actual no es correcta.')
  }

  const claveHash = await hashearClave(claveNueva)
  db()
    .prepare(`UPDATE usuarios SET clave_hash = ?, debe_cambiar_clave = 0, actualizado_en = ${AHORA_SQL} WHERE id = ?`)
    .run(claveHash, actor.id)

  const sesionActualizada: SesionUsuario = { ...actor, debeCambiarClave: false }
  establecerSesion(sesionActualizada)
  return sesionActualizada
}
