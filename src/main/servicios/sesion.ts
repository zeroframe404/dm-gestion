// Sesión en memoria del proceso principal. Es la única fuente de verdad sobre quién está logueado:
// el renderer nunca decide permisos, sólo muestra u oculta pantallas.
import type { Rol, SesionUsuario } from '../../shared/tipos'
import { ErrorDeNegocio } from './errores'

let sesionActual: SesionUsuario | null = null

export function sesion(): SesionUsuario | null {
  return sesionActual
}

export function establecerSesion(nueva: SesionUsuario | null): void {
  sesionActual = nueva
}

export function exigirSesion(): SesionUsuario {
  if (!sesionActual) throw new ErrorDeNegocio('Tenés que iniciar sesión para continuar.')
  return sesionActual
}

export function exigirRol(...roles: Rol[]): SesionUsuario {
  const actual = exigirSesion()
  if (!roles.includes(actual.rol)) throw new ErrorDeNegocio('No tenés permisos para realizar esta acción.')
  return actual
}
