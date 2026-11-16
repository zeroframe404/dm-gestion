// Las sucursales y las ramas configurables (Administración → Sucursales y ramas). Las carga el
// superadministrador y viajan al resto de las computadoras como el ajuste compartido `catalogos` (ver
// ajustesCompartidos.ts). Si el servidor no los conoce o no contesta, quedan en esta computadora y el programa
// sigue: nada de esto puede frenar el arranque.
//
// La versión normal (la que no tiene esta pantalla) ignora el ajuste y sigue con las listas de fábrica.
// Cuando se guarda, las sucursales nuevas se siembran en la base y las renombradas se unen con la fila vieja
// (`ajustarCatalogoDeSucursales`), porque usuarios, clientes y leads las referencian por id.
import { aplicarCatalogos, catalogosAplicados } from '../../shared/catalogosVigentes'
import { CATALOGOS_DE_FABRICA, type Catalogos, normalizarCatalogos } from '../../shared/catalogos'
import { esDemo } from '../canal'
import { db } from '../db/base'
import { ajustarCatalogoDeSucursales } from '../db/semilla'
import { catalogosGuardados, guardarCatalogosEnConfig, hayCatalogosGuardados } from './config'
import { ErrorDeNegocio } from './errores'

/** Los catálogos que valen ahora. La demo tiene los de fábrica y no se configura. */
export function catalogosVigentes(): Catalogos {
  return esDemo() ? normalizarCatalogos(CATALOGOS_DE_FABRICA) : catalogosAplicados()
}

/**
 * Pone en marcha lo guardado en esta computadora. Va ANTES de abrir la base: la siembra de sucursales lee la
 * lista vigente. Nunca tira: si el archivo de configuración está roto quedan los de fábrica.
 */
export function cargarCatalogosAlArrancar(): void {
  if (esDemo()) return
  try {
    aplicarCatalogos(catalogosGuardados())
  } catch (error) {
    console.error('[catalogos] No se pudieron leer las sucursales y ramas guardadas; quedan las de fábrica:', error)
    aplicarCatalogos(CATALOGOS_DE_FABRICA)
  }
}

/** Valida y guarda lo que mandó la pantalla. Devuelve lo que quedó. */
export function guardarCatalogos(datos: unknown): Catalogos {
  if (esDemo()) throw new ErrorDeNegocio('En la demo las sucursales y las ramas no se configuran.')
  const crudo = (datos && typeof datos === 'object' ? datos : {}) as Record<string, unknown>
  // `normalizarCatalogos` descarta en silencio lo que no sirve; acá se avisa lo que dejaría sin opciones.
  if (!Array.isArray(crudo.sucursales) || !crudo.sucursales.some((s) => typeof (s as { nombre?: unknown })?.nombre === 'string' && (s as { nombre: string }).nombre.trim())) {
    throw new ErrorDeNegocio('Tiene que quedar al menos una sucursal.')
  }
  if (!Array.isArray(crudo.ramas) || !crudo.ramas.some((r) => typeof (r as { nombre?: unknown })?.nombre === 'string' && (r as { nombre: string }).nombre.trim())) {
    throw new ErrorDeNegocio('Tiene que quedar al menos una rama.')
  }
  const nuevos = normalizarCatalogos(crudo)
  aplicar(nuevos)
  return nuevos
}

export function restaurarCatalogos(): Catalogos {
  if (esDemo()) throw new ErrorDeNegocio('En la demo las sucursales y las ramas no se configuran.')
  const fabrica = normalizarCatalogos(CATALOGOS_DE_FABRICA)
  aplicar(fabrica)
  return fabrica
}

function aplicar(nuevos: Catalogos): void {
  guardarCatalogosEnConfig(nuevos)
  aplicarCatalogos(nuevos)
  ajustarCatalogoDeSucursales(db())
}

/** Lo que viaja al VPS: null si nunca se tocó nada en esta computadora (no hay nada que publicar). */
export function valorCompartidoDeLosCatalogos(): Catalogos | null {
  return hayCatalogosGuardados() ? catalogosGuardados() : null
}

export function adoptarCatalogos(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  if (esDemo()) return false
  aplicar(normalizarCatalogos(valor))
  return true
}
