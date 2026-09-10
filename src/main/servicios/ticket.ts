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
//
// Cuando salen dos comprobantes se mandan como DOS trabajos de impresión separados, uno después del
// otro, y no como un trabajo de dos copias: la guillotina de la térmica corta al terminar cada
// trabajo, así que un trabajo de dos copias devolvía los dos tickets pegados en la misma tira.
//
// El comprobante se compone más angosto que el rollo a propósito: el cabezal de una térmica no llega
// hasta el borde del papel y todo lo que se dibuje más allá no se imprime, no se corta prolijo. Ver
// `anchoUtilDelTicket`.
import { BrowserWindow } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { claveDeSucursal, sucursalCanonica } from '../../shared/sucursales'
import type { ConfigImpresora, DatosDeImpresora, DireccionDeSucursal, PedidoDeTicket } from '../../shared/tipos'
import { fechaDeVencimiento, periodoSiguiente } from '../../shared/semaforo'
import { db } from '../db/base'
import { carpetaDatos } from '../rutas'
import {
  anotarErrorDeImpresion,
  COPIAS_MAXIMAS,
  direccionDeSucursal,
  direccionesGuardadas,
  establecerProximoNumeroDeTicket,
  guardarDirecciones,
  guardarImpresora,
  impresoraGuardada,
  proximoNumeroDeTicket,
  telefonoDeSucursal,
  telefonoInicial,
  tomarNumeroDeTicket,
  ultimoErrorDeImpresion,
} from './preferencias'
import { guardarNumeroDeTicket } from './pagos'
import { listarSucursales } from './sucursales'
import { ErrorDeNegocio } from './errores'
import { enteroPositivo } from './validacion'

/** Un trabajo colgado no puede dejar una ventana oculta viva para siempre. */
const ESPERA_MAXIMA_MS = 20_000

/**
 * Lo que se espera entre un ticket y el siguiente. Sin esta pausa el spooler de Windows puede juntar
 * los dos trabajos en uno solo —que es justamente lo que hacía que salieran pegados— y la guillotina
 * corta una sola vez, al final.
 */
const PAUSA_ENTRE_TICKETS_MS = 400

const esperar = (ms: number): Promise<void> => new Promise((seguir) => setTimeout(seguir, ms).unref?.())

/**
 * Dos cobros seguidos pueden estar imprimiendo a la vez. Cada impresión escribe su propio archivo:
 * si compartieran uno, el segundo pisaría el HTML que el primero todavía no terminó de imprimir.
 */
let trabajosImpresos = 0

/**
 * Lo fijo del comprobante: los datos de la agencia, que no cambian de una sucursal a otra ni de un
 * pago a otro. La dirección y el teléfono sí cambian por sucursal —cada local atiende por su propio
 * celular— y se cargan en Administración → Impresora.
 */
const AGENCIA = {
  provincia: 'Pcia de Buenos Aires',
  cuit: 'C.U.I.T  30-70839042-5',
  inicioDeActividades: 'Inicio de actividades 08-2005 N 0000015865',
  // La agencia trabaja automotor: no hay ramo cargado por póliza, así que la línea es fija.
  seccionYRamo: 'Sección/Ramo: 04 – AUTOMOTOR',
  leyenda: 'ESTE COMPROBANTE SERÁ VÁLIDO SI TODOS LOS DATOS SE CORRESPONDEN CON LOS DE LA PÓLIZA.',
  cuidado: 'NO EXPONER A LA LUZ Y AL CALOR',
} as const

/** Lo variable del comprobante: sale del pago, del cliente, de la póliza y de la sucursal que cobró. */
export interface DatosDeTicket {
  /** Número correlativo del comprobante, ya formateado ('N° 000123'). */
  numero: string
  /** Dirección de la sucursal donde se cobró; encabeza el ticket. */
  direccion: string
  /** Teléfono de esa misma sucursal, debajo de la dirección. Vacío deja la línea con sólo la provincia. */
  telefono: string
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
    copias: guardada.copias,
    proximoNumeroDeTicket: proximoNumeroDeTicket(),
    disponibles: nombres,
    predeterminada,
    ultimoError: ultimoErrorDeImpresion(),
  }
}

/** Corrige el correlativo desde Administración → Impresora (por ejemplo, después de cambiar el rollo). */
export async function establecerNumeroDeTicket(numero: number): Promise<ConfigImpresora> {
  establecerProximoNumeroDeTicket(numero)
  return configuracionDeImpresora()
}

export async function guardarConfiguracionDeImpresora(datos: DatosDeImpresora): Promise<ConfigImpresora> {
  guardarImpresora(datos)
  anotarErrorDeImpresion(null)
  return configuracionDeImpresora()
}

// ---------------------------------------------------------------------------
// Direcciones del encabezado
// ---------------------------------------------------------------------------

/** «AVELLANEDA» guardada a mano y «Dock Sud» del catálogo son el mismo mostrador. */
function identidadDeSucursal(nombre: string): string {
  return claveDeSucursal(sucursalCanonica(nombre) ?? nombre)
}

/**
 * Una fila por sucursal de la agencia, con la dirección y el teléfono que encabezan su ticket. Al
 * final van las guardadas para nombres que ya no están en la lista: se ven y se pueden borrar, pero
 * no se pierden solas.
 *
 * Con `soloLaSucursal` se devuelve una sola fila: la del mostrador de quien está mirando. Es lo que ve
 * todo el mundo menos el superadministrador —empleado y administrador por igual: los dos están
 * asignados a un local—, porque la impresora que tiene delante imprime esa dirección y ninguna otra;
 * ver —y peor, poder cambiar— la dirección de Lanús desde Dock Sud sólo sirve para romper el ticket de
 * una sucursal en la que uno no está.
 */
export function direccionesDeTicket(soloLaSucursal?: string | null): DireccionDeSucursal[] {
  const filas = listarSucursales().map((sucursal) => ({
    sucursal: sucursal.nombre,
    direccion: direccionDeSucursal(sucursal.nombre),
    telefono: telefonoDeSucursal(sucursal.nombre),
    enLaLista: true,
  }))
  // Si no se cruzaran, la pantalla mostraría las dos y cada una con una dirección distinta para el
  // mismo mostrador.
  const conocidas = new Set(filas.map((fila) => identidadDeSucursal(fila.sucursal)))
  for (const [sucursal, guardada] of direccionesGuardadas()) {
    if (conocidas.has(identidadDeSucursal(sucursal))) continue
    filas.push({ sucursal, direccion: guardada.direccion, telefono: guardada.telefono ?? telefonoInicial(sucursal), enLaLista: false })
  }

  if (soloLaSucursal === undefined || soloLaSucursal === null) return filas
  const mia = identidadDeSucursal(soloLaSucursal)
  const propias = filas.filter((fila) => identidadDeSucursal(fila.sucursal) === mia)
  // Una sucursal que todavía no tiene fila (recién creada, o con un nombre que no está en el catálogo)
  // igual tiene que poder cargar su dirección: se devuelve una fila vacía en vez de una lista vacía.
  return propias.length > 0
    ? propias
    : [{ sucursal: soloLaSucursal, direccion: '', telefono: telefonoInicial(soloLaSucursal), enLaLista: false }]
}

/**
 * Guarda las direcciones y los teléfonos tal como quedaron en la pantalla. Una sucursal nueva se
 * carga acá mismo.
 *
 * Con `soloLaSucursal` sólo se acepta la de ese mostrador y el resto se deja intacto: si se guardara
 * la lista entera, la pantalla recortada de un empleado —que recibió una sola fila— borraría las
 * direcciones de todas las demás sucursales al guardar.
 */
export function guardarDireccionesDeTicket(
  direcciones: DireccionDeSucursal[],
  soloLaSucursal?: string | null,
): DireccionDeSucursal[] {
  if (!Array.isArray(direcciones)) throw new ErrorDeNegocio('No llegó ninguna dirección para guardar.')

  // Una pantalla vieja puede mandar filas sin teléfono: ahí no hay nada que decidir y se conserva el
  // que ya estaba, en vez de borrarlo del encabezado sin que nadie lo haya pedido.
  const comoFila = (fila: DireccionDeSucursal) => ({
    sucursal: fila.sucursal,
    direccion: fila.direccion,
    telefono: typeof fila.telefono === 'string' ? fila.telefono : null,
  })

  if (soloLaSucursal === undefined || soloLaSucursal === null) {
    guardarDirecciones(direcciones.map(comoFila))
    return direccionesDeTicket()
  }

  const mia = identidadDeSucursal(soloLaSucursal)
  const propia = direcciones.find((fila) => identidadDeSucursal(fila.sucursal) === mia)
  if (!propia) throw new ErrorDeNegocio('Sólo podés cambiar el encabezado de tu sucursal.')
  // Se reescribe la lista completa con lo que ya había y sólo la propia cambiada.
  const todas = direccionesDeTicket().map((fila) => (identidadDeSucursal(fila.sucursal) === mia ? comoFila(propia) : comoFila(fila)))
  if (!todas.some((fila) => identidadDeSucursal(fila.sucursal) === mia)) {
    todas.push(comoFila(propia))
  }
  guardarDirecciones(todas)
  return direccionesDeTicket(soloLaSucursal)
}

// ---------------------------------------------------------------------------
// Lo que viaja al resto de las computadoras
// ---------------------------------------------------------------------------

/**
 * El encabezado de las cuatro sucursales, listo para publicar.
 *
 * Es el único de los ajustes compartidos que NO carga sólo el superadministrador: cada mostrador
 * escribe la dirección y el teléfono de su propio local (ver `guardarDireccionesDeTicket`, que recorta
 * lo que puede tocar cada uno). Lo que se comparte es el conjunto, así que cuando Lanús corrige su
 * teléfono, la computadora de la oficina también lo tiene: hasta ahora había que ir máquina por
 * máquina, y con que una quedara vieja salían comprobantes con un número que ya no atiende nadie.
 *
 * Las filas van ordenadas por sucursal y sin las que están completamente vacías: la huella es el hash
 * del JSON y tiene que dar igual en las cinco computadoras.
 */
export function valorCompartidoDelTicket(): { direcciones: Array<{ sucursal: string; direccion: string; telefono: string }> } | null {
  const filas = direccionesDeTicket()
    .map((fila) => ({
      sucursal: fila.sucursal,
      direccion: fila.direccion ?? '',
      telefono: fila.telefono ?? '',
    }))
    .filter((fila) => fila.direccion.trim() !== '' || fila.telefono.trim() !== '')
    .sort((a, b) => identidadDeSucursal(a.sucursal).localeCompare(identidadDeSucursal(b.sucursal)))
  if (filas.length === 0) return null
  return { direcciones: filas }
}

/**
 * Adopta el encabezado que publicó otra computadora.
 *
 * Reemplaza el conjunto: adoptar es quedarse con lo publicado, no con una mezcla. Lo que esta
 * computadora tenga cargado para una sucursal que no vino se conserva —puede ser un local nuevo que
 * todavía no se publicó—, así nadie se queda sin encabezado por adoptar.
 */
export function adoptarEncabezadoDelTicket(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const crudas = (valor as { direcciones?: unknown }).direcciones
  if (!Array.isArray(crudas)) return false

  const publicadas = new Map<string, { sucursal: string; direccion: string; telefono: string | null }>()
  for (const cruda of crudas) {
    if (!cruda || typeof cruda !== 'object') continue
    const fila = cruda as Record<string, unknown>
    const sucursal = typeof fila.sucursal === 'string' ? fila.sucursal.trim() : ''
    if (!sucursal) continue
    publicadas.set(identidadDeSucursal(sucursal), {
      sucursal,
      direccion: typeof fila.direccion === 'string' ? fila.direccion : '',
      telefono: typeof fila.telefono === 'string' ? fila.telefono : null,
    })
  }
  if (publicadas.size === 0) return false

  const propias = direccionesDeTicket()
    .filter((fila) => !publicadas.has(identidadDeSucursal(fila.sucursal)))
    .map((fila) => ({ sucursal: fila.sucursal, direccion: fila.direccion, telefono: fila.telefono ?? null }))
  guardarDirecciones([...publicadas.values(), ...propias])
  return true
}

// ---------------------------------------------------------------------------
// El ticket
// ---------------------------------------------------------------------------

/** Valida la cantidad de copias pedida desde el renderer; si no llega nada válido, se usa la guardada. */
function comoCantidadDeCopias(pedida: number | undefined, porDefecto: number): number {
  const numero = Math.trunc(Number(pedida))
  return Number.isFinite(numero) && numero >= 1 && numero <= COPIAS_MAXIMAS ? numero : porDefecto
}

function escapar(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function linea(etiqueta: string, valor: string): string {
  if (!valor) return ''
  return `<p class="dato">${escapar(etiqueta)}: ${escapar(valor)}</p>`
}

/**
 * Una térmica no imprime todo el ancho del rollo: en una POS-80 el papel mide 80 mm pero el cabezal
 * cubre unos 72, y lo que se dibuje más allá no sale. Se reservan 10 —los 8 que el cabezal no alcanza
 * más 2 de resguardo, porque cada driver corre el margen a su gusto— y toda esa reserva queda del lado
 * derecho: el texto arranca pegado a la izquierda en vez de ir centrado.
 *
 * Centrado, la reserva se repartía entre los dos lados y el final de cada línea caía justo sobre el
 * borde que se recorta. Eso es lo que en Lanús dejaba la hora sin los minutos y el teléfono cortado a
 * la mitad.
 */
const RESERVA_DEL_CABEZAL_MM = 10

/** Lo que el texto se despega del borde izquierdo, que tampoco imprime desde el punto cero. */
export const SANGRIA_DEL_TICKET_MM = 1.5

/** El ancho de texto que entra de verdad en un papel de `anchoMm`. */
export function anchoUtilDelTicket(anchoMm: number): number {
  return Math.max(anchoMm - RESERVA_DEL_CABEZAL_MM - SANGRIA_DEL_TICKET_MM, 30)
}

/** Courier New es monoespaciada: cada carácter ocupa 0,6 em. De ahí sale, exacta, cuánto mide una línea. */
const ANCHO_DE_CARACTER_EM = 0.6
const MM_POR_PUNTO = 25.4 / 72

/** Los milímetros que ocupa una línea de `caracteres` en Courier New de `puntos`. */
export function anchoDeLineaMm(caracteres: number, puntos: number): number {
  return caracteres * ANCHO_DE_CARACTER_EM * puntos * MM_POR_PUNTO
}

/**
 * Los datos de la agencia —provincia y teléfono, CUIT, inicio de actividades— tienen que entrar en una
 * línea cada uno: partidos al medio se leen como si el número de inscripción fuera otro dato. Como la
 * tipografía es monoespaciada la cuenta es exacta, así que en vez de fijar 8 pt y cruzar los dedos se
 * achica lo justo, de a medio punto y nunca por debajo de 6: más chico que eso el papel térmico ya no
 * se lee, y ahí es preferible que la línea baje de renglón antes que salir ilegible.
 */
export function puntosDelEncabezado(utilMm: number, caracteresDeLaLineaMasLarga: number): number {
  const MAXIMO = 8
  const MINIMO = 6
  if (caracteresDeLaLineaMasLarga <= 0) return MAXIMO
  const justo = utilMm / (caracteresDeLaLineaMasLarga * ANCHO_DE_CARACTER_EM * MM_POR_PUNTO)
  const enPasosDeMedioPunto = Math.floor(justo * 2) / 2
  return Math.min(MAXIMO, Math.max(MINIMO, enPasosDeMedioPunto))
}

/**
 * El ticket en HTML, con la forma del comprobante que la agencia ya usaba. Sin logo de imagen a
 * propósito: en una térmica de 80 mm el texto sale nítido y una imagen depende del driver. Ancho en
 * milímetros para que el navegador lo componga a escala real.
 *
 * Fijo: los datos de la agencia (provincia, CUIT, inicio de actividades), la sección/ramo y las dos
 * leyendas del pie. Variable: la dirección y el teléfono de la sucursal que cobró y todo lo del pago.
 *
 * Nada queda pegado al borde derecho y nada se sale del ancho útil: lo que no entra baja de renglón,
 * que en un ticket se lee igual, mientras que lo que se pasa del cabezal directamente no existe.
 */
export function htmlDelTicket(datos: DatosDeTicket, anchoMm: number): string {
  const util = anchoUtilDelTicket(anchoMm)
  // El teléfono va en un bloque que no se parte: si la línea no entra, baja entero al renglón
  // siguiente. Medio número de teléfono impreso es peor que ninguno.
  const provinciaYTelefono = datos.telefono ? `${AGENCIA.provincia} - Tel: ${datos.telefono}` : AGENCIA.provincia
  const provinciaYTelefonoHtml = datos.telefono
    ? `${escapar(AGENCIA.provincia)} - <span class="junto">Tel: ${escapar(datos.telefono)}</span>`
    : escapar(AGENCIA.provincia)
  const puntosDeAgencia = puntosDelEncabezado(
    util,
    Math.max(provinciaYTelefono.length, AGENCIA.cuit.length, AGENCIA.inicioDeActividades.length),
  )
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Comprobante</title><style>
  @page { margin: 0; }
  /* Sin centrar y con sangría a la izquierda: la reserva del cabezal queda toda del lado que se recorta. */
  body { width: ${util}mm; margin: 0 0 0 ${SANGRIA_DEL_TICKET_MM}mm; padding: 3mm 0 6mm; font-family: "Courier New", monospace; font-size: 10pt; line-height: 1.35; color: #000; overflow-wrap: anywhere; }
  p { margin: 0; }
  /* Los datos de la agencia van más chicos que el resto: cuánto, lo decide el ancho del papel. */
  .encabezado { font-size: ${puntosDeAgencia}pt; }
  .encabezado .direccion { font-weight: bold; font-size: 10pt; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  /* Fecha y hora salen una al lado de la otra desde la izquierda. Antes iban separadas a los extremos
     («space-between»), que dejaba la hora justo sobre el borde que la térmica no imprime. */
  .cuando { display: flex; flex-wrap: wrap; gap: 0 6mm; font-size: 9pt; }
  .junto { white-space: nowrap; }
  .numero { margin-top: .5mm; font-weight: bold; text-align: center; }
  .dato { padding: .3mm 0; }
  .vencimiento { margin-top: 2mm; font-weight: bold; text-align: center; }
  .pie { margin-top: 3mm; font-size: 7.5pt; }
  .pie .cuidado { margin-top: 2mm; font-weight: bold; text-align: center; }
</style></head><body>
  <div class="encabezado">
    ${datos.direccion ? `<p class="direccion">${escapar(datos.direccion)}</p>` : ''}
    <p>${provinciaYTelefonoHtml}</p>
    <p>${escapar(AGENCIA.cuit)}</p>
    <p>${escapar(AGENCIA.inicioDeActividades)}</p>
  </div>
  <p class="numero">${escapar(datos.numero)}</p>
  <hr>
  <div class="cuando"><span class="junto">FECHA: ${escapar(datos.fecha)}</span><span class="junto">HORA: ${escapar(datos.hora)}</span></div>
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

/**
 * UN trabajo de impresión con UN comprobante. Es a propósito que no use `copies`: la ticketeadora
 * corta el papel cuando termina el trabajo, así que pedirle dos copias devuelve los dos tickets
 * pegados. Dos tickets = dos llamadas a esta función, y entre una y otra la guillotina corta.
 */
async function imprimirUnTrabajo(ventana: BrowserWindow, deviceName: string, anchoMm: number): Promise<void> {
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
          copies: 1,
        },
        (exito, motivo) => terminar(exito ? undefined : new Error(motivo || 'La impresora rechazó el trabajo.')),
      )
    } catch (error) {
      terminar(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

/**
 * Manda el comprobante a la impresora tantas veces como copias se hayan pedido, de a un trabajo por
 * vez y esperando a que cada uno termine. Si el segundo falla se levanta el error igual —el primero
 * ya salió y el mostrador tiene que enterarse de que el duplicado no—, y la ventana oculta se cierra
 * siempre.
 */
async function imprimirHtml(html: string, deviceName: string, anchoMm: number, copias: number): Promise<void> {
  const carpeta = path.join(carpetaDatos(), 'tickets')
  mkdirSync(carpeta, { recursive: true })
  // Un nombre por impresión: dos cobros seguidos pueden estar imprimiendo a la vez y el segundo no
  // puede pisarle el HTML al primero mientras la impresora todavía lo está leyendo.
  const ruta = path.join(carpeta, `ticket-${(trabajosImpresos = (trabajosImpresos + 1) % 1_000_000)}.html`)
  writeFileSync(ruta, html, 'utf8')

  const ventana = new BrowserWindow({
    show: false,
    width: 420,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, spellcheck: false },
  })
  try {
    await ventana.loadFile(ruta)
    for (let copia = 1; copia <= copias; copia++) {
      // Entre un ticket y el siguiente se espera: sin la pausa el spooler puede juntar los dos
      // trabajos y volveríamos a la tira sin corte del medio.
      if (copia > 1) await esperar(PAUSA_ENTRE_TICKETS_MS)
      await imprimirUnTrabajo(ventana, deviceName, anchoMm)
    }
  } finally {
    if (!ventana.isDestroyed()) ventana.destroy()
    // El HTML ya no hace falta: dejarlo sólo llena la carpeta de datos con un archivo por cobro.
    try {
      rmSync(ruta, { force: true })
    } catch {
      // Que no se pueda borrar el archivo no puede tumbar una impresión que ya salió.
    }
  }
}

/**
 * Imprime el ticket si hay una impresora configurada y activa. Nunca lanza: el cobro ya está hecho y
 * un problema de impresora no puede volverse un error del pago. El motivo queda guardado.
 *
 * `copias` es cuántas veces sale el mismo comprobante (1 o 2, para quien quiera un duplicado); sin
 * mandarlo se usa lo guardado en Administración → Impresora.
 */
export async function imprimirTicketSiCorresponde(datos: DatosDeTicket, copias?: number): Promise<boolean> {
  const config = impresoraGuardada()
  if (!config.habilitada || !config.impresora) return false
  const cantidad = comoCantidadDeCopias(copias, config.copias)
  try {
    await imprimirHtml(htmlDelTicket(datos, config.anchoMm), config.impresora, config.anchoMm, cantidad)
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
    copiasPorDefecto: config.copias,
  }
}

/** '000123': el correlativo solo, que es lo que se anota en la columna NRO TICKET de la caja. */
function numeroDeTicketPelado(numero: number): string {
  return String(numero).padStart(6, '0')
}

/** 'N° 000123', como venía saliendo en el papel de la agencia. */
function formatearNumeroDeTicket(numero: number): string {
  return `N° ${numeroDeTicketPelado(numero)}`
}

/**
 * Arma el ticket de un pago ya registrado y lo manda a imprimir. El correlativo se toma acá, recién
 * cuando el ticket se va a imprimir de verdad: si no hay impresora activa no se gasta un número al
 * pedo.
 */
export async function imprimirTicketDePago(pagoId: number, copias?: number): Promise<boolean> {
  const pago = leerPago(pagoId)
  if (!pago) return false
  const config = impresoraGuardada()
  if (!config.habilitada || !config.impresora) return false

  // El correlativo se toma acá y se guarda en el pago en el mismo movimiento: el número que salió en
  // el papel es el que va en la columna NRO TICKET de la planilla de caja, y así nadie lo copia a mano.
  // Se guarda aunque después la impresión falle: el número ya se gastó y ese ticket es de este cobro.
  const numero = tomarNumeroDeTicket()
  guardarNumeroDeTicket(pagoId, numeroDeTicketPelado(numero), null)

  return imprimirTicketSiCorresponde(
    {
      numero: formatearNumeroDeTicket(numero),
      direccion: direccionDeSucursal(pago.sucursal),
      telefono: telefonoDeSucursal(pago.sucursal),
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
    },
    copias,
  )
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
    // La prueba no gasta un número real: es sólo para ver que la impresora anda.
    numero: 'PRUEBA',
    direccion: direccionDeSucursal(sucursal),
    telefono: telefonoDeSucursal(sucursal),
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
    await imprimirHtml(htmlDelTicket(datos, config.anchoMm), config.impresora, config.anchoMm, 1)
    anotarErrorDeImpresion(null)
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    anotarErrorDeImpresion(mensaje)
    throw new ErrorDeNegocio(`No se pudo imprimir: ${mensaje}`)
  }
}
