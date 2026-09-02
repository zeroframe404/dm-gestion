// El zoom vivo de la ventana: cuánto está puesto ahora, quién lo cambia y los atajos de teclado.
//
// Vive FUERA de React a propósito, por dos razones:
//
//   1. Los atajos tienen que andar siempre, también en la pantalla de ingreso y en la de cambiar la
//      contraseña, donde no hay barra superior y por lo tanto no hay botones. Alguien que dejó la
//      pantalla al 175 % y cerró sesión no tiene nada a mano: Ctrl 0 es su única salida.
//   2. El zoom se cambia desde tres lugares —los dos botones, el teclado y la rueda—, así que el valor
//      tiene que estar en un solo lado. Si viviera en el estado de un componente, cualquier otro que
//      lo mostrara quedaría diciendo un número viejo.
import { aplicarZoom, guardarZoom, zoomGuardado } from './preferencias'
import { acumularRueda, ESCALA_NORMAL, escalaAnterior, escalaSiguiente } from './vista'

let escala = ESCALA_NORMAL
let acumuladoDeRueda = 0
const oyentes = new Set<(escala: number) => void>()

/** La escala que está puesta ahora mismo. */
export function zoomActual(): number {
  return escala
}

/** La cambia, la aplica, la guarda en esta computadora y avisa a quien la esté mostrando. */
export function cambiarZoom(nueva: number): void {
  if (nueva === escala) return
  escala = nueva
  aplicarZoom(nueva)
  guardarZoom(nueva)
  for (const oyente of oyentes) oyente(nueva)
}

/** Para el control de la barra superior: se entera de los cambios que no hizo él. */
export function alCambiarZoom(oyente: (escala: number) => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/**
 * Ctrl + / Ctrl − / Ctrl 0, y Ctrl con la rueda. Son lo primero que cualquiera prueba.
 *
 * Van acá y no en un menú de Electron porque la versión publicada arranca sin menú
 * (`Menu.setApplicationMenu(null)`), y sin menú Chromium se queda sin los suyos de fábrica.
 */
function alTeclear(evento: KeyboardEvent): void {
  // Alt queda afuera: en el teclado español AltGr es Ctrl + Alt, y sin esta salida cualquier símbolo
  // escrito con AltGr haría zoom en el medio de una celda.
  if (!evento.ctrlKey || evento.altKey) return
  // Se mira `code` además de `key`: en el teclado numérico y con la distribución latinoamericana el
  // «+» sale de teclas distintas, y quien agranda la pantalla suele usar el pavé.
  const mas = evento.key === '+' || evento.key === '=' || evento.code === 'NumpadAdd'
  const menos = evento.key === '-' || evento.key === '_' || evento.code === 'NumpadSubtract'
  const normal = evento.key === '0' || evento.code === 'Numpad0'
  if (!mas && !menos && !normal) return
  evento.preventDefault()
  cambiarZoom(mas ? escalaSiguiente(escala) : menos ? escalaAnterior(escala) : ESCALA_NORMAL)
}

function alRodar(evento: WheelEvent): void {
  if (!evento.ctrlKey) return
  // Se cancela siempre, aunque todavía no haya un paso: si no, la planilla se mueve mientras se hace
  // el gesto y se pierde de vista la fila que se estaba mirando.
  evento.preventDefault()
  const resultado = acumularRueda(acumuladoDeRueda, evento.deltaY)
  acumuladoDeRueda = resultado.acumulado
  if (resultado.paso === 0) return
  cambiarZoom(resultado.paso === 1 ? escalaSiguiente(escala) : escalaAnterior(escala))
}

/**
 * Se llama una sola vez al arrancar, antes de dibujar nada: si el zoom se aplicara desde un componente,
 * la pantalla aparecería al 100 % y saltaría al tamaño elegido delante de quien la está mirando.
 */
export function iniciarZoom(): void {
  escala = zoomGuardado()
  aplicarZoom(escala)
  window.addEventListener('keydown', alTeclear)
  window.addEventListener('wheel', alRodar, { passive: false })
}
