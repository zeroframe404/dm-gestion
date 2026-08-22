// Imprimir y guardar en PDF desde la aplicación. Hoy lo usa el presupuesto; la ticketeadora térmica
// tiene su propio camino en ticket.ts, que es otra cosa (papel de 80 mm, sin diálogo, en silencio).
//
// El mecanismo es el mismo de siempre en Electron: se escribe el HTML en la carpeta de datos, se lo
// carga en una ventana oculta y se le pide a Chromium el PDF o el diálogo de impresión. La ventana
// va sin JavaScript: es un papel, no una aplicación.
import { BrowserWindow, dialog } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { carpetaDatos } from '../rutas'
import { ErrorDeNegocio } from './errores'

/** Un trabajo colgado no puede dejar una ventana oculta viva para siempre. */
const ESPERA_MAXIMA_MS = 30_000

async function conVentanaDelHtml<T>(html: string, nombre: string, hacer: (ventana: BrowserWindow) => Promise<T>): Promise<T> {
  const carpeta = path.join(carpetaDatos(), 'impresiones')
  mkdirSync(carpeta, { recursive: true })
  const ruta = path.join(carpeta, nombre)
  writeFileSync(ruta, html, 'utf8')

  const ventana = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, spellcheck: false },
  })
  try {
    await ventana.loadFile(ruta)
    return await hacer(ventana)
  } finally {
    if (!ventana.isDestroyed()) ventana.destroy()
  }
}

/**
 * El PDF de un HTML, sin preguntar nada. El tamaño y la orientación los decide la propia hoja con
 * `@page`: acá los márgenes van en cero para no sumarlos dos veces (el reporte sale apaisado, el
 * presupuesto vertical, y los dos por el mismo camino).
 */
export async function pdfDelHtml(html: string): Promise<Buffer> {
  return conVentanaDelHtml(html, 'papel.html', (ventana) =>
    ventana.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }),
  )
}

/**
 * Guarda el HTML como PDF donde el usuario elija. Devuelve la ruta, o null si canceló el diálogo.
 */
export async function guardarHtmlComoPdf(
  html: string,
  nombreSugerido: string,
  ventanaPadre: BrowserWindow | null,
): Promise<{ ruta: string | null }> {
  const opciones = {
    title: 'Guardar el presupuesto en PDF',
    defaultPath: nombreSugerido,
    filters: [
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'Todos los archivos', extensions: ['*'] },
    ],
  }
  const elegido = ventanaPadre ? await dialog.showSaveDialog(ventanaPadre, opciones) : await dialog.showSaveDialog(opciones)
  if (elegido.canceled || !elegido.filePath) return { ruta: null }

  const pdf = await pdfDelHtml(html)

  try {
    writeFileSync(elegido.filePath, pdf)
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(
      `No se pudo guardar «${path.basename(elegido.filePath)}»: ${motivo}. Si el archivo está abierto en otro programa, cerralo y probá de nuevo.`,
    )
  }
  return { ruta: elegido.filePath }
}

/**
 * Manda el HTML a la impresora que elija el usuario (el diálogo de Windows). No es silencioso a
 * propósito: acá la persona quiere elegir impresora, bandeja y cantidad de copias.
 */
export async function imprimirHtmlConDialogo(html: string): Promise<boolean> {
  return conVentanaDelHtml(
    html,
    'papel.html',
    (ventana) =>
      new Promise<boolean>((resolver, rechazar) => {
        // `print` puede fallar de tres maneras: llamar al callback con error, tirar en el acto o no
        // volver nunca. Las tres tienen que terminar acá, y una sola vez.
        let terminado = false
        const terminar = (error?: Error, exito = false) => {
          if (terminado) return
          terminado = true
          clearTimeout(reloj)
          if (error) rechazar(error)
          else resolver(exito)
        }
        const reloj = setTimeout(() => terminar(new Error('La impresora no respondió a tiempo.')), ESPERA_MAXIMA_MS)
        reloj.unref?.()
        try {
          ventana.webContents.print({ silent: false, printBackground: true }, (exito, motivo) => {
            // Cancelar el diálogo no es un error: la persona se arrepintió y ya está.
            if (!exito && /cancel/i.test(motivo ?? '')) return terminar(undefined, false)
            if (!exito) return terminar(new Error(motivo || 'La impresora rechazó el trabajo.'))
            terminar(undefined, true)
          })
        } catch (error) {
          terminar(error instanceof Error ? error : new Error(String(error)))
        }
      }),
  )
}
