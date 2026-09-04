// Achicar una foto antes de adjuntarla, sin que se note.
//
// Una foto de celular pesa 4 a 8 MB y mide 4000 píxeles de lado: para el legajo de una póliza o un
// siniestro sobra. Se baja el lado largo a 2560 px (más que cualquier pantalla de la agencia) y se
// guarda como JPEG al 86 %, que a ojo es indistinguible del original. Una foto de 6 MB queda en menos
// de 1 MB, sube al servidor en segundos y no llena el disco de las cinco computadoras.
//
// Lo que no se toca: PDF y documentos (no son imágenes), GIF (animados), HEIC (Chromium no lo
// decodifica) y cualquier imagen que al recomprimirla saldría MÁS grande. Ante la duda, el original.
import type { ArchivoParaAdjuntar } from '../shared/tipos'

/** Lado largo máximo, en píxeles. */
export const LADO_MAXIMO = 2560
/** Calidad JPEG: 0.86 es el punto donde el peso baja mucho y el ojo todavía no ve nada. */
export const CALIDAD_JPEG = 0.86

/** Las imágenes que se dejan como vienen. */
const SIN_TOCAR = new Set(['image/gif', 'image/heic', 'image/heif', 'image/svg+xml', 'image/bmp'])

export interface ResultadoDeOptimizacion {
  archivo: ArchivoParaAdjuntar
  /** Bytes antes y después, para contar en pantalla cuánto se ahorró. */
  antes: number
  despues: number
}

function cambiarExtension(nombre: string, extension: string): string {
  const punto = nombre.lastIndexOf('.')
  return `${punto > 0 ? nombre.slice(0, punto) : nombre}.${extension}`
}

async function original(file: File, medidas: { ancho: number | null; alto: number | null } = { ancho: null, alto: null }): Promise<ResultadoDeOptimizacion> {
  const contenido = new Uint8Array(await file.arrayBuffer())
  return {
    archivo: { nombre: file.name, tipo: file.type || 'application/octet-stream', contenido, ancho: medidas.ancho, alto: medidas.alto, optimizado: false },
    antes: file.size,
    despues: file.size,
  }
}

/**
 * Devuelve el archivo listo para mandar al proceso principal: la foto achicada o, si no era una foto
 * o no valía la pena, el original tal cual. Nunca lanza: un error de decodificación es «el original».
 */
export async function optimizarImagen(file: File): Promise<ResultadoDeOptimizacion> {
  const tipo = (file.type || '').toLowerCase()
  if (!tipo.startsWith('image/') || SIN_TOCAR.has(tipo)) return original(file)
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return original(file)

  let bitmap: ImageBitmap
  try {
    // `from-image`: la foto sacada de costado con el celular queda derecha, como la muestra el celular.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return original(file)
  }
  try {
    const { width, height } = bitmap
    const escala = Math.min(1, LADO_MAXIMO / Math.max(width, height))
    const ancho = Math.max(1, Math.round(width * escala))
    const alto = Math.max(1, Math.round(height * escala))
    // Un PNG chico y sin achicar (una captura de pantalla) se deja como está: convertirlo a JPEG le
    // pondría ruido a las letras y no ahorra casi nada.
    if (tipo === 'image/png' && escala === 1 && file.size < 1024 * 1024) return original(file, { ancho: width, alto: height })

    const lienzo = new OffscreenCanvas(ancho, alto)
    const contexto = lienzo.getContext('2d')
    if (!contexto) return original(file, { ancho: width, alto: height })
    if (tipo === 'image/png') {
      // Lo que tenía transparencia la mantiene: el PNG se achica pero sigue siendo PNG.
      contexto.drawImage(bitmap, 0, 0, ancho, alto)
      const blob = await lienzo.convertToBlob({ type: 'image/png' })
      if (blob.size >= file.size) return original(file, { ancho: width, alto: height })
      return {
        archivo: { nombre: file.name, tipo: 'image/png', contenido: new Uint8Array(await blob.arrayBuffer()), ancho, alto, optimizado: true },
        antes: file.size,
        despues: blob.size,
      }
    }
    // Fondo blanco por si la imagen traía transparencia (WebP): el JPEG no la tiene.
    contexto.fillStyle = '#ffffff'
    contexto.fillRect(0, 0, ancho, alto)
    contexto.drawImage(bitmap, 0, 0, ancho, alto)
    const blob = await lienzo.convertToBlob({ type: 'image/jpeg', quality: CALIDAD_JPEG })
    if (escala === 1 && blob.size >= file.size) return original(file, { ancho: width, alto: height })
    return {
      archivo: {
        nombre: tipo === 'image/jpeg' ? file.name : cambiarExtension(file.name, 'jpg'),
        tipo: 'image/jpeg',
        contenido: new Uint8Array(await blob.arrayBuffer()),
        ancho,
        alto,
        optimizado: true,
      },
      antes: file.size,
      despues: blob.size,
    }
  } catch {
    return original(file)
  } finally {
    bitmap.close()
  }
}

/** Todos los archivos, en orden, cada uno achicado si correspondía. */
export async function prepararArchivos(files: Iterable<File>): Promise<ResultadoDeOptimizacion[]> {
  const salida: ResultadoDeOptimizacion[] = []
  for (const file of files) salida.push(await optimizarImagen(file))
  return salida
}

export function pesoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
