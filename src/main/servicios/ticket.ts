// El comprobante de la ticketeadora térmica (POS-80). Es opcional: si la PC no tiene impresora
// configurada, registrar un pago funciona igual y acá no pasa nada.
//
// Este archivo es el único de Cobranzas que toca Electron. Se imprime en silencio con una ventana
// oculta: se escribe el ticket como HTML en la carpeta de datos, se lo carga y se manda a imprimir a
// la impresora elegida, sin diálogo. El pago NO espera a la impresora: si falla, el error queda
// guardado y se ve en Administración → Impresora.
//
// Con «preguntar antes de imprimir» activado el ticket no sale solo: el mostrador confirma primero
// (hay compañías que no piden comprobante y el rollo se gasta igual). Eso lo arma `pedidoDeTicket`.
import { BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ConfigImpresora, DatosDeImpresora, DireccionDeSucursal, PedidoDeTicket } from '../../shared/tipos'
import { fechaDeVencimiento, periodoSiguiente } from '../../shared/semaforo'
import { db } from '../db/base'
import { carpetaDatos } from '../rutas'
import {
  anotarErrorDeImpresion,
  claveDeSucursal,
  direccionDeSucursal,
  direccionesGuardadas,
  guardarDirecciones,
  guardarImpresora,
  impresoraGuardada,
  ultimoErrorDeImpresion,
} from './preferencias'
import { listarSucursales } from './sucursales'
import { ErrorDeNegocio } from './errores'
import { enteroPositivo } from './validacion'

/** Un trabajo colgado no puede dejar una ventana oculta viva para siempre. */
const ESPERA_MAXIMA_MS = 20_000

/**
 * Lo fijo del comprobante: los datos de la agencia, que no cambian de una sucursal a otra ni de un
 * pago a otro. La dirección sí cambia por sucursal y se carga en Administración → Impresora.
 */
const AGENCIA = {
  provinciaYTelefono: 'Pcia de Buenos Aires - Tel: 11 4083-0416',
  cuit: 'C.U.I.T  30-70839042-5',
  inicioDeActividades: 'Inicio de actividades 08-2005 N 0000015865',
  // La agencia trabaja automotor: no hay ramo cargado por póliza, así que la línea es fija.
  seccionYRamo: 'Sección/Ramo: 04 – AUTOMOTOR',
  leyenda: 'ESTE COMPROBANTE SERÁ VÁLIDO SI TODOS LOS DATOS SE CORRESPONDEN CON LOS DE LA PÓLIZA.',
  cuidado: 'NO EXPONER A LA LUZ Y AL CALOR',
} as const

/** Lo variable del comprobante: sale del pago, del cliente, de la póliza y de la sucursal que cobró. */
export interface DatosDeTicket {
  /** Dirección de la sucursal donde se cobró; encabeza el ticket. */
  direccion: string
  /** Día del pago, 'd/M/aaaa'. */
  fecha: string
  /** Hora en que se registró, 'HH:mm'. */
  hora: string
  importe: string
  /** Mes de la cuota en mayúsculas ('ABRIL'). */
  periodo: string
  titular: string
  domicilio: string
  compania: string
  patente: string
  poliza: string
  cobertura: string
  /** Vencimiento de la cuota siguiente, 'dd/MM/aaaa'. Vacío si no se puede calcular. */
  proximoVencimiento: string
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
    preguntar: guardada.preguntar,
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
// Direcciones del encabezado
// ---------------------------------------------------------------------------

/**
 * Una fila por sucursal de la agencia, con la dirección que encabeza su ticket. Al final van las
 * direcciones guardadas para nombres que ya no están en la lista: se ven y se pueden borrar, pero no
 * se pierden solas.
 */
export function direccionesDeTicket(): DireccionDeSucursal[] {
  const filas = listarSucursales().map((sucursal) => ({
    sucursal: sucursal.nombre,
    direccion: direccionDeSucursal(sucursal.nombre),
    enLaLista: true,
  }))
  const conocidas = new Set(filas.map((fila) => claveDeSucursal(fila.sucursal)))
  for (const [sucursal, direccion] of direccionesGuardadas()) {
    if (conocidas.has(claveDeSucursal(sucursal))) continue
    filas.push({ sucursal, direccion, enLaLista: false })
  }
  return filas
}

/** Guarda las direcciones tal como quedaron en la pantalla. Una sucursal nueva se carga acá mismo. */
export function guardarDireccionesDeTicket(direcciones: DireccionDeSucursal[]): DireccionDeSucursal[] {
  if (!Array.isArray(direcciones)) throw new ErrorDeNegocio('No llegó ninguna dirección para guardar.')
  guardarDirecciones(direcciones.map((fila) => ({ sucursal: fila.sucursal, direccion: fila.direccion })))
  return direccionesDeTicket()
}

// ---------------------------------------------------------------------------
// El ticket
// ---------------------------------------------------------------------------

function escapar(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function linea(etiqueta: string, valor: string): string {
  if (!valor) return ''
  return `<p class="dato">${escapar(etiqueta)}: ${escapar(valor)}</p>`
}

/**
 * El ticket en HTML, con la forma del comprobante que la agencia ya usaba. Sin logo de imagen a
 * propósito: en una térmica de 80 mm el texto sale nítido y una imagen depende del driver. Ancho en
 * milímetros para que el navegador lo componga a escala real.
 *
 * Fijo: los datos de la agencia (provincia y teléfono, CUIT, inicio de actividades), la sección/ramo y
 * las dos leyendas del pie. Variable: la dirección de la sucursal que cobró y todo lo del pago.
 */
function htmlDelTicket(datos: DatosDeTicket, anchoMm: number): string {
  const util = Math.max(anchoMm - 6, 30)
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Comprobante</title><style>
  @page { margin: 0; }
  body { width: ${util}mm; margin: 0 auto; padding: 3mm 0 6mm; font-family: "Courier New", monospace; font-size: 10pt; line-height: 1.35; color: #000; }
  p { margin: 0; }
  /* Los datos de la agencia van más chicos que el resto para que entren en una línea de 80 mm. */
  .encabezado { font-size: 8pt; }
  .encabezado .direccion { font-weight: bold; font-size: 10pt; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  .cuando { display: flex; justify-content: space-between; gap: 2mm; font-size: 9pt; }
  .dato { padding: .3mm 0; word-break: break-word; }
  .vencimiento { margin-top: 2mm; font-weight: bold; text-align: center; }
  .pie { margin-top: 3mm; font-size: 7.5pt; }
  .pie .cuidado { margin-top: 2mm; font-weight: bold; text-align: center; }
</style></head><body>
  <div class="encabezado">
    ${datos.direccion ? `<p class="direccion">${escapar(datos.direccion)}</p>` : ''}
    <p>${escapar(AGENCIA.provinciaYTelefono)}</p>
    <p>${escapar(AGENCIA.cuit)}</p>
    <p>${escapar(AGENCIA.inicioDeActividades)}</p>
  </div>
  <hr>
  <div class="cuando"><span>FECHA: ${escapar(datos.fecha)}</span><span>HORA: ${escapar(datos.hora)}</span></div>
  <hr>
  ${linea('Importe', datos.importe)}
  ${linea('Periodo', datos.periodo)}
  ${linea('Titular', datos.titular)}
  ${linea('Domicilio', datos.domicilio)}
  ${linea('Compañía', datos.compania)}
  ${linea('Patente', datos.patente)}
  ${linea('Póliza', datos.poliza)}
  ${linea('Cobertura', datos.cobertura)}
  <p class="dato">${escapar(AGENCIA.seccionYRamo)}</p>
  ${datos.proximoVencimiento ? `<p class="vencimiento">PRÓXIMO VENCIMIENTO ${escapar(datos.proximoVencimiento)}</p>` : ''}
  <div class="pie">
    <p>${escapar(AGENCIA.leyenda)}</p>
    <p class="cuidado">${escapar(AGENCIA.cuidado)}</p>
  </div>
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
  fecha_iso: string | null
  creado_en: string
  cliente_nombre: string | null
  patente: string | null
  compania: string | null
  numero_poliza: string | null
  periodo: string | null
  periodo_texto: string | null
  importe: string | null
  importe_monto: number | null
  sucursal: string | null
  /** Domicilio del titular: sale de la ficha del cliente, no del pago. */
  direccion: string | null
  /** Cobertura de la póliza (RC, TR…). */
  cobertura: string | null
  /** Día del mes en que vence la cuota, tal como está en la planilla. */
  dia_vencimiento: string | null
}

const MESES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
]

/** 'AAAA-MM' → 'ABRIL'. Si el período no viene, se cae al texto de la planilla. */
function comoPeriodo(periodo: string | null, textoDeLaPlanilla: string | null): string {
  const mes = MESES[Number((periodo ?? '').slice(5, 7)) - 1]
  if (mes) return mes
  return (textoDeLaPlanilla ?? '').trim().toUpperCase()
}

/** 'AAAA-MM-DD' → 'd/M/aaaa' (como en el comprobante de la agencia). */
function comoFechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split('-')
  if (!anio || !mes || !dia) return iso
  return `${Number(dia)}/${Number(mes)}/${anio}`
}

/** 'AAAA-MM-DD' → 'dd/MM/aaaa' (el vencimiento va con dos dígitos, como se venía imprimiendo). */
function comoFechaLarga(iso: string): string {
  const [anio, mes, dia] = iso.split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

/** El día del pago en 'AAAA-MM-DD': el que se cargó a mano y, si no está, el de la registración. */
function diaDelPago(pago: PagoParaTicket): string {
  const cargado = (pago.fecha_iso ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(cargado)) return cargado
  return pago.creado_en.slice(0, 10)
}

function horaDeRegistro(iso: string): string {
  const momento = new Date(iso)
  if (Number.isNaN(momento.getTime())) return ''
  return `${String(momento.getHours()).padStart(2, '0')}:${String(momento.getMinutes()).padStart(2, '0')}`
}

/**
 * El vencimiento de la cuota siguiente: el mismo día del mes que vence esta, un período después. Si la
 * planilla no trae el día se usa el del pago, que es lo que la agencia mira cuando no hay otra cosa.
 */
function proximoVencimiento(pago: PagoParaTicket): string {
  const dia = Number((pago.dia_vencimiento ?? '').replace(/\D/g, '')) || Number(diaDelPago(pago).slice(8, 10))
  if (!dia) return ''
  const periodo = /^\d{4}-\d{2}$/.test(pago.periodo ?? '') ? (pago.periodo as string) : diaDelPago(pago).slice(0, 7)
  const vencimiento = fechaDeVencimiento(periodoSiguiente(periodo), dia)
  return vencimiento ? comoFechaLarga(vencimiento) : ''
}

/** El importe con el signo adelante. Se prefiere el número, que sale parejo aunque se haya tipeado feo. */
function comoImporte(pago: PagoParaTicket): string {
  const texto = (pago.importe ?? '').trim()
  const monto = pago.importe_monto
  if (monto !== null && Number.isFinite(monto)) {
    const partes = Math.abs(monto % 1) > 0.004 ? monto.toFixed(2).split('.') : [String(Math.round(monto))]
    const entero = partes[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return `$${partes[1] ? `${entero},${partes[1]}` : entero}`
  }
  if (!texto) return ''
  return texto.startsWith('$') ? texto : `$${texto}`
}

function leerPago(pagoId: number): PagoParaTicket | undefined {
  return db()
    .prepare(
      `SELECT p.fecha_iso, p.creado_en, p.cliente_nombre, p.patente, p.compania, p.numero_poliza,
              p.periodo, p.periodo_texto, p.importe, p.importe_monto,
              COALESCE(p.sucursal_cobro, p.sucursal_texto) AS sucursal,
              c.direccion AS direccion,
              po.cobertura AS cobertura,
              cm.dia_vencimiento AS dia_vencimiento
       FROM pagos p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN polizas po ON po.id = p.poliza_id
       LEFT JOIN cuotas_mes cm ON cm.fila_id = p.cuota_fila_id
       WHERE p.id = ?`,
    )
    .get(enteroPositivo(pagoId, 'El pago')) as PagoParaTicket | undefined
}

/**
 * El resumen del pago para el cartel «¿imprimo el comprobante?». Devuelve null cuando no hay nada que
 * preguntar: sin impresora activa, con la impresión automática, o si el pago no está.
 */
export function pedidoDeTicket(pagoId: number): PedidoDeTicket | null {
  const config = impresoraGuardada()
  if (!config.habilitada || !config.impresora || !config.preguntar) return null
  const pago = leerPago(pagoId)
  if (!pago) return null
  return {
    pagoId,
    cliente: pago.cliente_nombre ?? '',
    compania: pago.compania ?? '',
    poliza: pago.numero_poliza ?? '',
    importe: comoImporte(pago),
  }
}

/** Arma el ticket de un pago ya registrado y lo manda a imprimir. */
export async function imprimirTicketDePago(pagoId: number): Promise<boolean> {
  const pago = leerPago(pagoId)
  if (!pago) return false

  return imprimirTicketSiCorresponde({
    direccion: direccionDeSucursal(pago.sucursal),
    fecha: comoFechaCorta(diaDelPago(pago)),
    hora: horaDeRegistro(pago.creado_en),
    importe: comoImporte(pago),
    periodo: comoPeriodo(pago.periodo, pago.periodo_texto),
    titular: pago.cliente_nombre ?? '',
    domicilio: pago.direccion ?? '',
    compania: pago.compania ?? '',
    patente: pago.patente ?? '',
    poliza: pago.numero_poliza ?? '',
    cobertura: pago.cobertura ?? '',
    proximoVencimiento: proximoVencimiento(pago),
  })
}

/** El botón «Imprimir una prueba» de Administración → Impresora. */
export async function imprimirTicketDePrueba(sucursal: string): Promise<void> {
  const config = impresoraGuardada()
  if (!config.habilitada || !config.impresora) {
    throw new ErrorDeNegocio('Primero elegí la impresora térmica y activá el ticket.')
  }
  const ahora = new Date()
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`
  const datos: DatosDeTicket = {
    direccion: direccionDeSucursal(sucursal),
    fecha: comoFechaCorta(hoy),
    hora: horaDeRegistro(ahora.toISOString()),
    importe: '$1',
    periodo: MESES[ahora.getMonth()] ?? '',
    titular: 'PRUEBA DE IMPRESIÓN',
    domicilio: 'CALLE FALSA 123',
    compania: 'PRUEBA',
    patente: 'AA000AA',
    poliza: '000000',
    cobertura: 'RC',
    proximoVencimiento: comoFechaLarga(fechaDeVencimiento(periodoSiguiente(hoy.slice(0, 7)), ahora.getDate()) ?? ''),
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
