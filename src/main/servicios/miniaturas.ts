// Miniaturas de las fotos adjuntas: un `data:` chico (320 px de ancho, JPEG) para que la ficha de la
// póliza o del siniestro muestre la foto sin abrir el archivo. Se calcula UNA vez al guardar el
// archivo y queda en la base; una ficha con veinte fotos no las vuelve a leer del disco cada vez.
//
// Usa `nativeImage` de Electron, que en el proceso principal decodifica JPEG/PNG/WebP/GIF. Fuera de
// Electron (el banco de pruebas corre en Node pelado) no hay decodificador: se devuelve todo en null
// y la ficha muestra el ícono del archivo, que es lo mismo que hace con un PDF.
import { nativeImage } from 'electron'

export const ANCHO_DE_MINIATURA = 320

export interface Miniatura {
  miniatura: string | null
  ancho: number | null
  alto: number | null
}

const SIN_MINIATURA: Miniatura = { miniatura: null, ancho: null, alto: null }

function hayDecodificador(): boolean {
  return typeof (nativeImage as { createFromPath?: unknown } | undefined)?.createFromPath === 'function'
}

export function esImagen(tipo: string | null | undefined): boolean {
  return typeof tipo === 'string' && tipo.startsWith('image/')
}

/** La miniatura y las medidas de una imagen del disco. Nunca lanza: sin miniatura la ficha se ve igual. */
export function miniaturaDe(ruta: string, tipo: string | null | undefined): Miniatura {
  if (!esImagen(tipo) || !hayDecodificador()) return SIN_MINIATURA
  try {
    const imagen = nativeImage.createFromPath(ruta)
    if (imagen.isEmpty()) return SIN_MINIATURA
    const { width, height } = imagen.getSize()
    const chica = width > ANCHO_DE_MINIATURA ? imagen.resize({ width: ANCHO_DE_MINIATURA }) : imagen
    return { miniatura: `data:image/jpeg;base64,${chica.toJPEG(72).toString('base64')}`, ancho: width, alto: height }
  } catch {
    return SIN_MINIATURA
  }
}
