// Un atajo para abrir Administración directo en una sección: la franja de la demo lleva a «Servidor
// (VPS)» esté donde esté la persona. Si Administración ya está abierta se entera por el evento; si no,
// la lee al montarse.
const EVENTO = 'dm:administracion-seccion'

let pendiente: string | null = null

export function pedirSeccionDeAdministracion(seccion: string): void {
  pendiente = seccion
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: seccion }))
}

/** La sección pedida y todavía no atendida, si hay una. Leerla la consume. */
export function tomarSeccionPedida(): string | null {
  const seccion = pendiente
  pendiente = null
  return seccion
}

export function alPedirSeccion(escuchar: (seccion: string) => void): () => void {
  const manejar = (evento: Event) => {
    pendiente = null
    escuchar(String((evento as CustomEvent<string>).detail))
  }
  window.addEventListener(EVENTO, manejar)
  return () => window.removeEventListener(EVENTO, manejar)
}
