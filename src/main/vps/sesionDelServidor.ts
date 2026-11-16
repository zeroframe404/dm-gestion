// La sesión de esta computadora contra el servidor de la agencia: la cuenta por persona.
//
// Hasta la 18.1 todos los pedidos al servidor llevaban el mismo token, el que viaja adentro del
// instalador y es igual en todas las computadoras. El servidor no sabía quién estaba sentado: se lo
// decía el propio programa. Desde la 18.2, al ingresar con internet el servidor comprueba el usuario y
// la contraseña y devuelve un token que es de ESA persona (`usuarios/vps.ts`, `ingresar`). Mientras
// esa sesión esté abierta, todo lo que sale hacia el servidor lleva ese token en lugar del compartido.
//
// Vive acá, en un módulo sin dependencias, porque lo leen todos los que arman un pedido al servidor
// —la grilla, la mensajería, los perfiles, el canal en vivo, Galeno, «Reportar error»— y no puede ser
// que cada uno tenga que conocer a la base de usuarios para saber con qué llave habla.
//
// El token queda en memoria y nada más: no se guarda en disco. Al cerrar el programa se pierde y al
// volver a ingresar se pide otro.

let abierta: { servidor: string; token: string } | null = null

/** Para comparar direcciones: sin la barra final y sin mayúsculas. */
function servidorDe(urlBase: string): string {
  return urlBase.trim().replace(/\/+$/, '').toLowerCase()
}

export function abrirSesionDelServidor(urlBase: string, token: string): void {
  abierta = { servidor: servidorDe(urlBase), token }
}

/** Olvida la sesión y devuelve su token, por si hay que avisarle al servidor que se cerró. */
export function olvidarSesionDelServidor(): string | null {
  const token = abierta?.token ?? null
  abierta = null
  return token
}

export function haySesionDelServidor(): boolean {
  return abierta !== null
}

/**
 * Con qué token se le habla a `urlBase`: el de la sesión si hay una abierta contra ESE servidor, y si
 * no el compartido. Nunca se manda el token de una sesión a otro servidor que el que lo dio.
 */
export function tokenParaElServidor(urlBase: string, compartido: string): string {
  return abierta && abierta.servidor === servidorDe(urlBase) ? abierta.token : compartido
}

// Cuando el servidor rechaza la sesión (a la persona la desactivaron, le cambiaron la contraseña, o
// venció), el primero en enterarse suele ser el canal en vivo o una sincronización, no la base de
// usuarios. Avisan por acá, y quien sabe cerrar la sesión con su motivo —`servicios/baseDeUsuarios.ts`—
// se anota para escucharlo. Así ninguno de los dos tiene que importar al otro.
let alRechazo: (() => void) | null = null

export function alRechazarseLaSesion(avisar: (() => void) | null): void {
  alRechazo = avisar
}

/** El servidor dijo que la sesión con la que se le habló ya no vale. */
export function avisarQueLaSesionSeRechazo(): void {
  if (!abierta) return
  try {
    alRechazo?.()
  } catch (error) {
    console.error('[sesión] No se pudo avisar que el servidor rechazó la sesión:', error instanceof Error ? error.message : error)
  }
}
