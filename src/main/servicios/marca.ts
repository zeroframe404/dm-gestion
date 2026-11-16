// La marca configurable (Administración → Marca): nombre del programa, nombre de la agencia, color y logo.
// La carga el superadministrador y viaja al resto de las computadoras como el ajuste compartido `marca`
// (ver ajustesCompartidos.ts). Si el servidor no la conoce o no contesta, queda en esta computadora y el
// programa sigue: nada de esto puede frenar el arranque.
//
// La versión normal (la que no tiene esta pantalla) ignora el ajuste: sigue diciendo «DM Gestión».
import { type Marca, MARCA_DE_FABRICA, normalizarMarca } from '../../shared/marca'
import { esDemo } from '../canal'
import { db } from '../db/base'
import { cambiarFirmaDePlantillas } from '../demo/identidad'
import { guardarMarcaEnConfig, hayMarcaGuardada, marcaGuardada } from './config'
import { ErrorDeNegocio } from './errores'

/** La marca que vale ahora. La demo tiene la suya fija (Cobertia) y no se configura. */
export function marcaVigente(): Marca {
  return esDemo() ? MARCA_DE_FABRICA : marcaGuardada()
}

/** Valida y guarda lo que mandó la pantalla. Devuelve lo que quedó. */
export function guardarMarca(datos: unknown): Marca {
  if (esDemo()) throw new ErrorDeNegocio('En la demo la marca no se configura.')
  const crudo = (datos && typeof datos === 'object' ? datos : {}) as Record<string, unknown>
  const nueva = normalizarMarca(crudo)
  // `normalizarMarca` descarta en silencio lo que no sirve; acá se avisa, porque quien lo cargó espera verlo.
  if (typeof crudo.color === 'string' && crudo.color && nueva.color === null) throw new ErrorDeNegocio('El color tiene que ser un código como #1d4ed8.')
  if (typeof crudo.logo === 'string' && crudo.logo && nueva.logo === null) {
    throw new ErrorDeNegocio('El logo tiene que ser una imagen PNG, JPG, WebP o SVG de hasta 200 KB.')
  }
  aplicar(nueva)
  return nueva
}

export function restaurarMarca(): Marca {
  if (esDemo()) throw new ErrorDeNegocio('En la demo la marca no se configura.')
  aplicar(MARCA_DE_FABRICA)
  return MARCA_DE_FABRICA
}

function aplicar(nueva: Marca): void {
  const anterior = marcaGuardada()
  guardarMarcaEnConfig(nueva)
  cambiarFirmaDePlantillas(db(), anterior.agencia, nueva.agencia)
}

/** Lo que viaja al VPS: null si nunca se tocó nada en esta computadora (no hay nada que publicar). */
export function valorCompartidoDeLaMarca(): Marca | null {
  return hayMarcaGuardada() ? marcaGuardada() : null
}

export function adoptarMarca(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  if (esDemo()) return false
  aplicar(normalizarMarca(valor))
  return true
}
