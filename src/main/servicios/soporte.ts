// «Reportar error» y «Sugerir mejora»: lo que el mostrador escribe termina en un issue del repositorio.
//
// Desde la 12.6 el mismo cuadro sirve para sugerir una mejora: viaja con `tipo: 'mejora'` y el
// servidor le pone la etiqueta «enhancement» en vez de «bug», así los pedidos y los errores no se
// mezclan en la misma lista.
//
// El problema. Cuando algo falla en una sucursal, lo que llegaba era un mensaje de WhatsApp que decía
// «no anda». Sin la pantalla, sin la versión, sin la sucursal y casi siempre sin la captura. Con eso no
// se reproduce nada, así que la primera respuesta era siempre la misma pregunta y el problema esperaba
// un día más.
//
// Cómo va. El programa NO habla con GitHub: manda el reporte al VPS y el servidor abre el issue con un
// token que vive en su `.env`. Es la misma lección que la base de usuarios: un token con permiso de
// escritura embebido en el .exe está en las cinco computadoras y cualquiera lo puede extraer. Acá viaja
// por el puente, con el token que ya existía.
//
// Las capturas. Se eligen con el explorador o se pegan del portapapeles —que es de donde salen: la
// tecla Impr Pant deja la captura ahí— y viajan en base64 dentro del mismo pedido. El servidor las
// guarda y el issue las referencia por una URL suya, porque un issue no sabe recibir archivos por API.
import { clipboard, dialog, nativeImage, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ImagenDeReporte, ReporteCreado, ReporteDeError } from '../../shared/tipos'
import { carpetaDatos } from '../rutas'
import { credencialesVps } from './config'
import { ErrorDeNegocio } from './errores'

/** Cuántas capturas entran en un reporte. El servidor corta en las mismas cuatro. */
export const MAXIMO_IMAGENES = 4
/** 5 MB por captura, igual que el servidor: una pantalla completa en PNG entra holgada. */
const MAXIMO_BYTES = 5 * 1024 * 1024

/** El ancho de la vista previa que se dibuja en el cuadro. No es lo que viaja: lo que viaja es el original. */
const ANCHO_VISTA_PREVIA = 320

const TIPOS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Dónde van las capturas pegadas del portapapeles. Se limpian solas cuando alguien vacía la carpeta. */
function carpetaDeCapturas(): string {
  const carpeta = path.join(carpetaDatos(), 'capturas')
  mkdirSync(carpeta, { recursive: true })
  return carpeta
}

function tipoDe(ruta: string): string | null {
  return TIPOS[path.extname(ruta).toLowerCase()] ?? null
}

/**
 * Mira el archivo y arma la ficha que el cuadro muestra: nombre, tamaño y una vista previa chica.
 *
 * La vista previa se achica acá y no en la pantalla porque una captura de un monitor grande son varios
 * megas, y mandársela al renderer entera para dibujarla a 320 píxeles es tirar memoria a la basura.
 */
function fichaDeImagen(ruta: string): ImagenDeReporte {
  const tipo = tipoDe(ruta)
  if (!tipo) throw new ErrorDeNegocio(`«${path.basename(ruta)}» no es una imagen: se pueden adjuntar PNG, JPG, WEBP o GIF.`)
  const tamano = statSync(ruta).size
  if (tamano === 0) throw new ErrorDeNegocio(`«${path.basename(ruta)}» está vacío.`)
  if (tamano > MAXIMO_BYTES) {
    throw new ErrorDeNegocio(`«${path.basename(ruta)}» pesa más de 5 MB. Recortá la captura o mandá sólo la parte que importa.`)
  }
  let vistaPrevia = ''
  try {
    const imagen = nativeImage.createFromPath(ruta)
    if (!imagen.isEmpty()) vistaPrevia = imagen.resize({ width: ANCHO_VISTA_PREVIA }).toDataURL()
  } catch {
    // Sin vista previa el reporte se manda igual: es un adorno, no el dato.
  }
  return { ruta, nombre: path.basename(ruta), tipo, tamano, vistaPrevia }
}

/** El explorador de archivos, con varias a la vez. Cancelar devuelve la lista vacía. */
export async function elegirImagenesDelReporte(ventana: BrowserWindow | null): Promise<ImagenDeReporte[]> {
  const opciones = {
    title: 'Elegí las capturas del problema',
    buttonLabel: 'Adjuntar',
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  }
  const elegido = ventana ? await dialog.showOpenDialog(ventana, opciones) : await dialog.showOpenDialog(opciones)
  if (elegido.canceled) return []
  return elegido.filePaths.slice(0, MAXIMO_IMAGENES).map(fichaDeImagen)
}

/**
 * La captura que está en el portapapeles, guardada como archivo.
 *
 * Es el camino corto y el que se usa de verdad: se aprieta Impr Pant, se abre el cuadro y se pega. Sin
 * esto habría que guardar la captura a mano en algún lado y después buscarla con el explorador, que es
 * exactamente el paso donde la gente abandona y manda «no anda» por WhatsApp.
 */
export function imagenDelPortapapeles(): ImagenDeReporte | null {
  const imagen = clipboard.readImage()
  if (imagen.isEmpty()) return null
  const png = imagen.toPNG()
  if (png.length === 0) return null
  if (png.length > MAXIMO_BYTES) {
    throw new ErrorDeNegocio('La captura del portapapeles pesa más de 5 MB. Recortala y volvé a copiarla.')
  }
  const ruta = path.join(carpetaDeCapturas(), `pegada-${Date.now()}.png`)
  writeFileSync(ruta, png)
  return {
    ruta,
    nombre: path.basename(ruta),
    tipo: 'image/png',
    tamano: png.length,
    vistaPrevia: imagen.resize({ width: ANCHO_VISTA_PREVIA }).toDataURL(),
  }
}

/**
 * Manda el reporte al VPS, que es el que abre el issue.
 *
 * Los errores se propagan: esto lo dispara alguien que apretó «Enviar» y tiene que enterarse de que no
 * salió, con el motivo, para poder copiarse el texto y mandarlo por otro lado.
 */
export async function enviarReporteDeError(reporte: ReporteDeError, contexto: { quien: string; sucursal: string; version: string }): Promise<ReporteCreado> {
  const titulo = reporte.titulo.trim()
  const tipo = reporte.tipo === 'mejora' ? 'mejora' : 'error'
  if (!titulo) {
    throw new ErrorDeNegocio(
      tipo === 'mejora' ? 'Ponele un título a la sugerencia: qué te gustaría que haga el programa, en una línea.' : 'Ponele un título al reporte: con qué pantalla o qué acción falló alcanza.',
    )
  }

  const rutas = (reporte.rutasDeImagenes ?? []).slice(0, MAXIMO_IMAGENES)
  const imagenes = rutas.map((ruta) => {
    const tipo = tipoDe(ruta)
    if (!tipo) throw new ErrorDeNegocio(`«${path.basename(ruta)}» no es una imagen.`)
    const contenido = readFileSync(ruta)
    if (contenido.length > MAXIMO_BYTES) throw new ErrorDeNegocio(`«${path.basename(ruta)}» pesa más de 5 MB.`)
    return { nombre: path.basename(ruta), tipo, contenidoBase64: contenido.toString('base64') }
  })

  const { urlBase, token } = credencialesVps()
  let respuesta: Response
  try {
    respuesta = await fetch(`${urlBase.replace(/\/+$/, '')}/api/dmg/incidencias`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        titulo,
        tipo,
        cuerpo: reporte.cuerpo ?? '',
        imagenes,
        reportadoPor: contexto.quien,
        sucursal: contexto.sucursal,
        version: contexto.version,
        sistema: `${process.platform} ${process.getSystemVersion?.() ?? ''}`.trim(),
      }),
      // Con cuatro capturas de varios megas, subir por una conexión de mostrador lleva su tiempo.
      signal: AbortSignal.timeout(120_000),
    })
  } catch (error) {
    throw new ErrorDeNegocio(
      `No se pudo llegar al servidor para mandar el reporte (${error instanceof Error ? error.message : String(error)}). Probá de nuevo cuando vuelva internet; el texto queda escrito.`,
    )
  }

  let json: unknown = null
  try {
    json = await respuesta.json()
  } catch {
    json = null
  }
  if (!respuesta.ok) {
    const detalle = json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : `error ${respuesta.status}`
    throw new ErrorDeNegocio(`El servidor no pudo abrir el reporte: ${detalle}`)
  }
  const creado = json as { numero?: unknown; url?: unknown; imagenesSubidas?: unknown }
  if (typeof creado?.numero !== 'number' || typeof creado?.url !== 'string') {
    throw new ErrorDeNegocio('El servidor contestó, pero sin el número del reporte. Fijate en GitHub si quedó creado.')
  }
  return {
    numero: creado.numero,
    url: creado.url,
    imagenesSubidas: typeof creado.imagenesSubidas === 'number' ? creado.imagenesSubidas : 0,
  }
}
