// Las compañías que cotiza el multicotizador. Sumar una es escribir su adaptador (ver aseguradora.ts,
// galeno.ts, atm.ts, mercantil.ts y equidad.ts) y agregarla a esta lista: la pantalla la muestra sola, con su tarjeta y sus ajustes.
import { esDemo } from '../canal'
import { ASEGURADORAS_DE_LA_DEMO } from '../demo/aseguradoras'
import type { CotizadorDeAseguradora } from './aseguradora'
import { atm } from './atm'
import { equidad } from './equidad'
import { galeno } from './galeno'
import { mercantil } from './mercantil'

const REGISTRADAS: readonly CotizadorDeAseguradora[] = [galeno, atm, mercantil, equidad]

/** Las pruebas reemplazan las compañías de verdad por unas que no salen a internet. */
let dePrueba: readonly CotizadorDeAseguradora[] | null = null

export function usarAseguradorasDePrueba(lista: readonly CotizadorDeAseguradora[] | null): void {
  dePrueba = lista
}

export function aseguradorasRegistradas(): readonly CotizadorDeAseguradora[] {
  // Demo: las mismas compañías (y dos más), con cotizaciones inventadas que no salen a internet.
  return dePrueba ?? (esDemo() ? ASEGURADORAS_DE_LA_DEMO : REGISTRADAS)
}
