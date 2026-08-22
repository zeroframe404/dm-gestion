// El comprobante de la ticketeadora térmica (POS-80). Es opcional: si la PC no tiene impresora
// configurada, registrar un pago funciona igual y acá no pasa nada.
//
// Este archivo es el único de Cobranzas que toca Electron. Se imprime en silencio con una ventana
// oculta: se escribe el ticket como HTML en la carpeta de datos, se lo carga y se manda a imprimir a
// la impresora elegida, sin diálogo. El pago NO espera a la impresora: si falla, el error queda
// guardado y se ve en Administración → Impresora.
import { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ConfigImpresora, DatosDeImpresora } from '../../shared/tipos'
import { db } from '../db/base'
import { carpetaDatos } from '../rutas'
import { anotarErrorDeImpresion, guardarImpresora, impresoraGuardada, ultimoErrorDeImpresion } from './preferencias'
import { ErrorDeNegocio } from './errores'
import { enteroPositivo } from './validacion'

/** Un trabajo colgado no puede dejar una ventana oculta viva para siempre. */
const ESPERA_MAXIMA_MS = 20_000

export interface DatosDeTicket {
  sucursal: string
  fechaHora: string
  cliente: string
  documento: string
  patente: string
  compania: string
  poliza: string
  periodo: string
  importe: string
  medio: string
  atendidoPor: string
}

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

function ventanaViva(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((v) => !v.isDestroyed()) ?? null
}

/** Las impresoras que ve el sistema. Si Electron no las puede leer se devuelve la lista vacía. */
async function impresorasDelSistema(): Promise<{ nombres: string[]; predeterminada: string | null }> {
  const ventana = ventanaViva()
  if (!ventana) return { nombres: [], predeterminada: null }
  try {
    const impresoras = await ventana.webContents.getPrintersAsync()
    // Cuál es la predeterminada no está en el tipo de Electron: viene entre las opciones del sistema,
    // con distinto nombre según la plataforma. Si no se puede saber, no se preselecciona ninguna.
    const esPredeterminada = (opciones: unknown): boolean => {
      if (typeof opciones !== 'object' || opciones === null) return false
      const valores = opciones as Record<string, unknown>
      const marca = valores['printer-is-default'] ?? valores['is-default'] ?? valores['default']
      return marca === true || marca === 'true'
    }
    return {
      nombres: impresoras.map((i) => i.name),
      predeterminada: impresoras.find((i) => esPredeterminada(i.options))?.name ?? null,
    }
  } catch (error) {
    console.error('[ticket] No se pudieron leer las impresoras:', error)
    return { nombres: [], predeterminada: null }
  }
}

export async function configuracionDeImpresora(): Promise<ConfigImpresora> {
  const guardada = impresoraGuardada()
  const { nombres, predeterminada } = await impresorasDelSistema()
  return {
    habilitada: guardada.habilitada,
    impresora: guardada.impresora,
    anchoMm: guardada.anchoMm,
    disponibles: nombres,
    predeterminada,
    ultimoError: ultimoErrorDeImpresion(),
  }
}

export async function guardarConfiguracionDeImpresora(datos: DatosDeImpresora): Promise<ConfigImpresora> {
  guardarImpresora(datos)
  anotarErrorDeImpresion(null)
  return configuracionDeImpresora()
}

// ---------------------------------------------------------------------------
// El ticket
// ---------------------------------------------------------------------------

function escapar(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function linea(etiqueta: string, valor: string): string {
  if (!valor) return ''
  return `<tr><th>${escapar(etiqueta)}</th><td>${escapar(valor)}</td></tr>`
}

/**
 * El ticket en HTML. Sin logo de imagen a propósito: en una térmica de 80 mm el texto sale nítido y
 * una imagen depende del driver. Ancho en milímetros para que el navegador lo componga a escala real.
 */
function htmlDelTicket(datos: DatosDeTicket, anchoMm: number): string {
  const util = Math.max(anchoMm - 6, 30)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Comprobante</title><style>
  @page { margin: 0; }
  body { width: ${util}mm; margin: 0 auto; padding: 3mm 0 6mm; font-family: "Courier New", monospace; font-size: 10pt; line-height: 1.35; color: #000; }
  h1 { margin: 0; font-size: 11pt; text-align: center; letter-spacing: .5px; }
  .sucursal { text-align: center; font-size: 9pt; margin: 1mm 0 2mm; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: normal; vertical-align: top; width: 33%; padding: .4mm 0; }
  td { text-align: right; padding: .4mm 0; word-break: break-word; }
  .importe { font-size: 14pt; font-weight: bold; text-align: center; margin: 2mm 0; }
  .pie { text-align: center; font-size: 8pt; margin-top: 3mm; }
</style></head><body>
  <h1>SEGUROS DANIEL MARTÍNEZ</h1>
  <p class="sucursal">${escapar(datos.sucursal)}<br>${escapar(datos.fechaHora)}</p>
  <hr>
  <table>
    ${linea('Cliente', datos.cliente)}
    ${linea('DNI/CUIT', datos.documento)}
    ${linea('Patente', datos.patente)}
    ${linea('Compañía', datos.compania)}
    ${linea('Póliza', datos.poliza)}
    ${linea('Período', datos.periodo)}
    ${linea('Medio', datos.medio)}
  </table>
  <hr>
  <p class="importe">${escapar(datos.importe)}</p>
  <hr>
  <table>${linea('Atendió', datos.atendidoPor)}</table>
  <p class="pie">Comprobante interno · no válido como factura</p>
</body></html>`
}

/** Alto estimado del papel: el contenido es corto y fijo, pero el driver necesita una medida. */
function altoEnMicrones(): number {
  return 140_000
}

async function imprimirHtml(html: string, deviceName: string, anchoMm: number): Promise<void> {
  const carpeta = path.join(carpetaDatos(), 'tickets')
  mkdirSync(carpeta, { recursive: true })
  const ruta = path.join(carpeta, 'ticket.html')
  writeFileSync(ruta, html, 'utf8')

  const ventana = new BrowserWindow({
    show: false,
    width: 420,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, spellcheck: false },
  })
  try {
    await ventana.loadFile(ruta)
    await new Promise<void>((resolver, rechazar) => {
      // `print` puede fallar de tres maneras: llamar al callback con error, tirar en el acto (un
      // nombre de impresora que no existe) o no volver nunca. Las tres tienen que terminar acá, y una
      // sola vez, o queda un temporizador vivo y la ventana oculta sin cerrar.
      let terminado = false
      const terminar = (error?: Error) => {
        if (terminado) return
        terminado = true
        clearTimeout(reloj)
        if (error) rechazar(error)
        else resolver()
      }
      const reloj = setTimeout(() => terminar(new Error('La impresora no respondió a tiempo.')), ESPERA_MAXIMA_MS)
      reloj.unref?.()
      try {
        ventana.webContents.print(
          {
            silent: true,
            deviceName,
            printBackground: false,
            margins: { marginType: 'none' },
            pageSize: { width: Math.round(anchoMm * 1000), height: altoEnMicrones() },
          },
          (exito, motivo) => terminar(exito ? undefined : new Error(motivo || 'La impresora rechazó el trabajo.')),
        )
      } catch (error) {
        terminar(error instanceof Error ? error : new Error(String(error)))
      }
    })
  } finally {
    if (!ventana.isDestroyed()) ventana.destroy()
  }
}

/**
 * Imprime el ticket si hay una impresora configurada y activa. Nunca lanza: el cobro ya está hecho y
 * un problema de impresora no puede volverse un error del pago. El motivo queda guardado.
 */
export async function imprimirTicketSiCorresponde(datos: DatosDeTicket): Promise<boolean> {
  const config = impresoraGuardada()
  if (!config.habilitada || !config.impresora) return false
  try {
    await imprimirHtml(htmlDelTicket(datos, config.anchoMm), config.impresora, config.anchoMm)
    anotarErrorDeImpresion(null)
    return true
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    console.error('[ticket] No se pudo imprimir:', mensaje)
    anotarErrorDeImpresion(mensaje)
    return false
  }
}

interface PagoParaTicket {
  fecha: string | null
  creado_en: string
  cliente_nombre: string | null
  documento: string | null
  patente: string | null
  compania: string | null
  numero_poliza: string | null
  periodo: string | null
  importe: string | null
  medio: string | null
  usuario_nombre: string | null
  sucursal: string | null
}

function comoFechaYHora(iso: string, fechaDelPago: string | null): string {
  const momento = new Date(iso)
  const hora = Number.isNaN(momento.getTime())
    ? ''
    : ` ${String(momento.getHours()).padStart(2, '0')}:${String(momento.getMinutes()).padStart(2, '0')}`
  const fecha = fechaDelPago && fechaDelPago.trim() ? fechaDelPago : iso.slice(0, 10)
  return `${fecha}${hora}`
}

/** Arma el ticket de un pago ya registrado y lo manda a imprimir. */
export async function imprimirTicketDePago(pagoId: number): Promise<boolean> {
  const pago = db()
    .prepare(
      `SELECT fecha, creado_en, cliente_nombre, documento, patente, compania, numero_poliza, periodo, importe, medio,
              usuario_nombre, COALESCE(sucursal_cobro, sucursal_texto) AS sucursal
       FROM pagos WHERE id = ?`,
    )
    .get(enteroPositivo(pagoId, 'El pago')) as PagoParaTicket | undefined
  if (!pago) return false

  return imprimirTicketSiCorresponde({
    sucursal: pago.sucursal ?? '',
    fechaHora: comoFechaYHora(pago.creado_en, pago.fecha),
    cliente: pago.cliente_nombre ?? '',
    documento: pago.documento ?? '',
    patente: pago.patente ?? '',
    compania: pago.compania ?? '',
    poliza: pago.numero_poliza ?? '',
    periodo: pago.periodo ?? '',
    importe: pago.importe ?? '',
    medio: pago.medio ?? '',
    atendidoPor: pago.usuario_nombre ?? '',
  })
}

/** El botón «Imprimir una prueba» de Administración → Impresora. */
export async function imprimirTicketDePrueba(sucursal: string, usuario: string): Promise<void> {
  const config = impresoraGuardada()
  if (!config.habilitada || !config.impresora) {
    throw new ErrorDeNegocio('Primero elegí la impresora térmica y activá el ticket.')
  }
  const ahora = new Date()
  const datos: DatosDeTicket = {
    sucursal,
    fechaHora: `${ahora.toISOString().slice(0, 10)} ${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`,
    cliente: 'PRUEBA DE IMPRESIÓN',
    documento: '00.000.000',
    patente: 'AA000AA',
    compania: 'PRUEBA',
    poliza: '000000',
    periodo: ahora.toISOString().slice(0, 7),
    importe: '$ 1,00',
    medio: 'EFECTIVO',
    atendidoPor: usuario,
  }
  try {
    await imprimirHtml(htmlDelTicket(datos, config.anchoMm), config.impresora, config.anchoMm)
    anotarErrorDeImpresion(null)
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    anotarErrorDeImpresion(mensaje)
    throw new ErrorDeNegocio(`No se pudo imprimir: ${mensaje}`)
  }
}
