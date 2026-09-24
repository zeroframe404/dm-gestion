// Las compañías que cotiza el multicotizador. Sumar una es escribir su adaptador (ver aseguradora.ts y
// galeno.ts) y agregarla a esta lista: la pantalla la muestra sola, con su tarjeta y sus ajustes.
import type { CotizadorDeAseguradora } from './aseguradora'
import { galeno } from './galeno'

const REGISTRADAS: readonly CotizadorDeAseguradora[] = [galeno]

/** Las pruebas reemplazan las compañías de verdad por unas que no salen a internet. */
let dePrueba: readonly CotizadorDeAseguradora[] | null = null

export function usarAseguradorasDePrueba(lista: readonly CotizadorDeAseguradora[] | null): void {
  dePrueba = lista
}

export function aseguradorasRegistradas(): readonly CotizadorDeAseguradora[] {
  return dePrueba ?? REGISTRADAS
}
