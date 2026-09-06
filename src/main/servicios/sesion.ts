// Sesión en memoria del proceso principal. Es la única fuente de verdad sobre quién está logueado:
// el renderer nunca decide permisos, sólo muestra u oculta pantallas.
import type { Rol, SesionUsuario } from '../../shared/tipos'
import { ErrorDeNegocio } from './errores'

let sesionActual: SesionUsuario | null = null

/**
 * A quién avisarle que alguien entró o salió.
 *
 * Existe para que el cartero de la mensajería arranque al ingresar y pare al salir sin que este
 * archivo —que lo importa medio programa— tenga que importarlo a él: importarlo acá cerraría un
 * círculo (cartero → mensajería → sesión → cartero) y rompería el banco de pruebas, que carga los
 * servicios sueltos. Lo registra `index.ts` al arrancar.
 */
let avisarCambioDeSesion: ((sesion: SesionUsuario | null) => void) | null = null

export function alCambiarLaSesion(avisar: ((sesion: SesionUsuario | null) => void) | null): void {
  avisarCambioDeSesion = avisar
}

export function sesion(): SesionUsuario | null {
  return sesionActual
}

export function establecerSesion(nueva: SesionUsuario | null): void {
  const cambio = sesionActual?.id !== nueva?.id
  sesionActual = nueva
  if (!cambio) return
  try {
    avisarCambioDeSesion?.(nueva)
  } catch (error) {
    // Ingresar es lo importante; que algo no arranque después no puede impedir el ingreso.
    console.error('[sesión] Falló un aviso de cambio de sesión:', error)
  }
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
