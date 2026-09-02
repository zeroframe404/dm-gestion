// El tema vivo de la ventana: claro u oscuro, aplicado al `<html>` para que el CSS lo vea.
//
// Vive FUERA de React, igual que el zoom (ver `zoom.ts`): se aplica una sola vez al arrancar, antes de
// dibujar nada, para que la pantalla no aparezca en claro y salte a oscuro delante de quien la mira.
import { guardarTema, temaGuardado } from './preferencias'
import { VALOR_EN_EL_ATRIBUTO, type Tema } from './tema-valores'

let tema: Tema = 'claro'
const oyentes = new Set<(tema: Tema) => void>()

/** El tema que está puesto ahora mismo. */
export function temaActual(): Tema {
  return tema
}

/**
 * Lo que va en el atributo NO es 'claro' / 'oscuro': ver `tema-valores.ts`, donde vive el mapa y el
 * motivo. Escribir acá la palabra en castellano dejaba el atributo puesto y NINGUNA regla del CSS
 * enganchada: el botón se daba vuelta y la pantalla seguía blanca.
 */
function aplicarTema(nuevo: Tema): void {
  document.documentElement.setAttribute('data-theme', VALOR_EN_EL_ATRIBUTO[nuevo])
}

/** La cambia, la aplica, la guarda en esta computadora y avisa a quien la esté mostrando. */
export function cambiarTema(nuevo: Tema): void {
  if (nuevo === tema) return
  tema = nuevo
  aplicarTema(nuevo)
  guardarTema(nuevo)
  for (const oyente of oyentes) oyente(nuevo)
}

/** Para el botón de la barra superior: se entera de los cambios que no hizo él. */
export function alCambiarTema(oyente: (tema: Tema) => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

/** Se llama una sola vez al arrancar, antes de dibujar nada. */
export function iniciarTema(): void {
  tema = temaGuardado()
  aplicarTema(tema)
}
