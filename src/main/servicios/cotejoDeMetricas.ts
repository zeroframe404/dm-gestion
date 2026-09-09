// Piezas chicas y genéricas que usan todos los "ConCache" (metricasDesdeCache.ts, cobranzasDesdeCache.ts):
// el respiro entre cotejos para no duplicar el cálculo local en cada tecla del filtro, de dónde sale la
// frescura de un cálculo del servidor, y cómo se anota (nunca se muestra) una diferencia encontrada.
import type { FrescuraDeMetrica } from '../../shared/tipos'
import { estadoDeSincronizacion } from './sincronizacion'

/** Cuándo se cotejó por última vez cada combinación de pantalla+filtros, para no correr el cálculo
 *  local en cada tecla del filtro — sólo una vez cada tanto por combinación. */
const ultimoCotejo = new Map<string, number>()
const RESPIRO_ENTRE_COTEJOS_MS = 60_000

export function tocaCotejar(clave: string): boolean {
  const ahora = Date.now()
  const anterior = ultimoCotejo.get(clave) ?? 0
  if (ahora - anterior < RESPIRO_ENTRE_COTEJOS_MS) return false
  ultimoCotejo.set(clave, ahora)
  return true
}

/** Para el banco de pruebas: sin esto, dos pruebas que cotejan la misma clave (mismo período, mismos
 *  filtros) en la misma corrida verían la segunda silenciada por el respiro de la primera. */
export function reiniciarCotejoParaPruebas(): void {
  ultimoCotejo.clear()
}

export function frescuraActual(): FrescuraDeMetrica {
  return estadoDeSincronizacion().situacion === 'sin-conexion' ? 'DESCONECTADA' : 'AL_DIA'
}

/** Compara pares [campo, local, servidor] y, si alguno difiere, lo anota por consola —nunca se le
 *  muestra la diferencia al usuario, sólo queda registrada para revisión durante la migración. */
export function cotejarNumeros(etiqueta: string, campos: Array<[string, number | null, number | null]>): void {
  const diferencias = campos.filter(([, local, servidor]) => local !== servidor)
  if (diferencias.length === 0) return
  console.error(
    `[métricas] el cálculo del servidor no coincide con el local en ${etiqueta}: ` +
      diferencias.map(([campo, local, servidor]) => `${campo} local=${local} servidor=${servidor}`).join('; '),
  )
}
