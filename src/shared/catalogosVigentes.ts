// Aplica los catálogos configurados a las listas vigentes de `sucursales.ts` y `ramas.ts`. Vive aparte para que
// esos dos archivos no se importen entre sí. Lo llaman el proceso principal (al arrancar y al guardar o adoptar
// del servidor) y la pantalla (al arrancar, con lo que le contesta el proceso principal).
import { CATALOGOS_DE_FABRICA, type Catalogos, normalizarCatalogos } from './catalogos'
import { configurarRamas } from './ramas'
import { configurarSucursales } from './sucursales'

let vigentes: Catalogos = normalizarCatalogos(CATALOGOS_DE_FABRICA)

/** Deja los catálogos como dicen `crudo` (limpiado) y devuelve lo que quedó. */
export function aplicarCatalogos(crudo: unknown): Catalogos {
  vigentes = normalizarCatalogos(crudo)
  configurarSucursales(vigentes.sucursales)
  configurarRamas(vigentes.ramas)
  return vigentes
}

/** Lo que está aplicado ahora (una copia: nadie la toca desde afuera). */
export function catalogosAplicados(): Catalogos {
  return normalizarCatalogos(vigentes)
}
