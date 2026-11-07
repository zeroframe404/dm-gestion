// Preferencias de la aplicación que viven en la base (no son credenciales): hoy, la ticketeadora de
// Cobranzas y las direcciones que encabezan su comprobante. Las plantillas de los mensajes se mudaron
// a plantillas.ts en la Fase 9, que es cuando dejaron de ser una sola.
import { ENCABEZADOS_DE_TICKET_DE_LA_DEMO } from '../../shared/demo'
import { claveDeSucursal, mismaSucursal, sucursalCanonica, type NombreDeSucursal } from '../../shared/sucursales'
import { INTENSIDAD_MAXIMA_DEL_TICKET, type DatosDeImpresora, type FuenteDelTicket, type TipoDeImpresora } from '../../shared/tipos'
import { esDemo } from '../canal'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import { ErrorDeNegocio } from './errores'

function leer(clave: string): string | null {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave) as { valor: string } | undefined
  return fila?.valor ?? null
}

function guardar(clave: string, valor: string): void {
  db()
    .prepare(
      `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
    .run(clave, valor, ahoraIso())
}

// ---------------------------------------------------------------------------
// Ticketeadora térmica (Fase 6, opcional)
// ---------------------------------------------------------------------------

const CLAVE_IMPRESORA = 'impresora_ticket'
const CLAVE_ERROR_IMPRESION = 'impresora_ultimo_error'

/** Ancho de papel de una POS-80, que es la que usa la agencia. */
export const ANCHO_TICKET_POR_DEFECTO = 80

/** Cuántas copias del ticket salen por pago. Es lo normal: casi nadie necesita el duplicado. */
export const COPIAS_POR_DEFECTO = 1
/** El duplicado es la única razón para pedir más de una copia (por ejemplo, una para el cliente y otra para la agencia). */
export const COPIAS_MAXIMAS = 2

export interface ImpresoraGuardada {
  habilitada: boolean
  /** Térmica de rollo o impresora común de hoja A4. */
  tipo: TipoDeImpresora
  /** Preguntar antes de cada ticket en vez de imprimirlo solo. */
  preguntar: boolean
  impresora: string | null
  anchoMm: number
  /** Cuánto se corre el texto del ticket hacia la derecha (+) o la izquierda (−), en mm. Compensa el margen propio del driver. */
  ajusteMm: number
  fuente: FuenteDelTicket
  intensidad: number
  /** Entre 1 y COPIAS_MAXIMAS. */
  copias: number
}

const SIN_IMPRESORA: ImpresoraGuardada = {
  habilitada: false,
  tipo: 'termica',
  preguntar: true,
  impresora: null,
  anchoMm: ANCHO_TICKET_POR_DEFECTO,
  ajusteMm: 0,
  fuente: 'courier',
  intensidad: 0,
  copias: COPIAS_POR_DEFECTO,
}

/** El ajuste horizontal del ticket: entre -15 y 15 mm; cualquier otra cosa es 0. */
export const AJUSTE_MAXIMO_MM = 15
function comoAjuste(valor: unknown): number {
  const numero = Number(valor)
  if (!Number.isFinite(numero) || Math.abs(numero) > AJUSTE_MAXIMO_MM) return 0
  return Math.round(numero * 2) / 2
}

function comoFuente(valor: unknown): FuenteDelTicket {
  return valor === 'lucida' || valor === 'consolas' ? valor : 'courier'
}
function comoIntensidad(valor: unknown): number {
  const numero = Math.trunc(Number(valor))
  return Number.isFinite(numero) && numero >= 0 && numero <= INTENSIDAD_MAXIMA_DEL_TICKET ? numero : 0
}

function comoCantidadDeCopias(valor: unknown): number {
  const numero = Math.trunc(Number(valor))
  return Number.isFinite(numero) && numero >= 1 && numero <= COPIAS_MAXIMAS ? numero : COPIAS_POR_DEFECTO
}

export function impresoraGuardada(): ImpresoraGuardada {
  const crudo = leer(CLAVE_IMPRESORA)
  if (!crudo) return SIN_IMPRESORA
  try {
    const datos = JSON.parse(crudo) as Partial<ImpresoraGuardada>
    return {
      habilitada: datos.habilitada === true,
      // Configuraciones anteriores a la impresora común no traen la clave: eran todas térmicas.
      tipo: datos.tipo === 'comun' ? 'comun' : 'termica',
      // Sin la clave guardada (configuraciones anteriores a que existiera la pregunta) se pregunta:
      // gastar papel de más molesta más que un cartel, y el cartel se apaga con un tilde.
      preguntar: datos.preguntar !== false,
      impresora: typeof datos.impresora === 'string' && datos.impresora ? datos.impresora : null,
      anchoMm: typeof datos.anchoMm === 'number' && datos.anchoMm >= 40 && datos.anchoMm <= 120 ? datos.anchoMm : ANCHO_TICKET_POR_DEFECTO,
      ajusteMm: comoAjuste(datos.ajusteMm),
      fuente: comoFuente(datos.fuente),
      intensidad: comoIntensidad(datos.intensidad),
      // Configuraciones anteriores a que existieran las copias no traen la clave: una copia, como
      // siempre salió.
      copias: comoCantidadDeCopias(datos.copias),
    }
  } catch {
    return SIN_IMPRESORA
  }
}

export function guardarImpresora(datos: DatosDeImpresora): ImpresoraGuardada {
  const impresora = typeof datos.impresora === 'string' ? datos.impresora.trim() : ''
  const ancho = Number(datos.anchoMm)
  if (!Number.isFinite(ancho) || ancho < 40 || ancho > 120) {
    throw new ErrorDeNegocio('El ancho del papel tiene que estar entre 40 y 120 milímetros (una POS-80 usa 80).')
  }
  const copias = Number(datos.copias)
  if (!Number.isInteger(copias) || copias < 1 || copias > COPIAS_MAXIMAS) {
    throw new ErrorDeNegocio(`La cantidad de tickets tiene que ser 1 o ${COPIAS_MAXIMAS}.`)
  }
  if (datos.tipo !== undefined && datos.tipo !== 'termica' && datos.tipo !== 'comun') {
    throw new ErrorDeNegocio('El tipo de impresora tiene que ser «térmica» o «común».')
  }
  if (datos.habilitada === true && !impresora) {
    throw new ErrorDeNegocio('Elegí la impresora antes de activar el ticket.')
  }
  const nueva: ImpresoraGuardada = {
    habilitada: datos.habilitada === true,
    tipo: datos.tipo ?? impresoraGuardada().tipo,
    preguntar: datos.preguntar === true,
    impresora: impresora || null,
    anchoMm: ancho,
    ajusteMm: datos.ajusteMm === undefined ? impresoraGuardada().ajusteMm : comoAjuste(datos.ajusteMm),
    fuente: datos.fuente === undefined ? impresoraGuardada().fuente : comoFuente(datos.fuente),
    intensidad: datos.intensidad === undefined ? impresoraGuardada().intensidad : comoIntensidad(datos.intensidad),
    copias,
  }
  guardar(CLAVE_IMPRESORA, JSON.stringify(nueva))
  return nueva
}

// ---------------------------------------------------------------------------
// Impresora de documentos grandes
// ---------------------------------------------------------------------------

const CLAVE_IMPRESORA_DOCUMENTOS = 'impresora_documentos'

/**
 * La impresora común (hojas A4) para lo que no es un comprobante: presupuestos, listas de
 * cotizaciones. Es independiente de la del comprobante: una PC puede tener la ticketeadora para los
 * recibos y ésta para lo grande, las dos a la vez. null = sin elegir: se abre el diálogo de Windows.
 */
export function impresoraDeDocumentos(): string | null {
  const crudo = leer(CLAVE_IMPRESORA_DOCUMENTOS)
  if (!crudo) return null
  try {
    const datos = JSON.parse(crudo) as { impresora?: unknown }
    return typeof datos.impresora === 'string' && datos.impresora.trim() ? datos.impresora.trim() : null
  } catch {
    return null
  }
}

/** Vacío deja de usar una impresora fija: los documentos vuelven a preguntar en el diálogo de Windows. */
export function guardarImpresoraDeDocumentos(nombre: string): string | null {
  const impresora = typeof nombre === 'string' ? nombre.trim() : ''
  guardar(CLAVE_IMPRESORA_DOCUMENTOS, JSON.stringify({ impresora: impresora || null }))
  return impresora || null
}

// ---------------------------------------------------------------------------
// Numeración de los tickets
// ---------------------------------------------------------------------------

const CLAVE_CORRELATIVO_TICKET = 'impresora_correlativo_ticket'

/** El número que va a llevar el próximo ticket, sin consumirlo. Arranca en 1. */
export function proximoNumeroDeTicket(): number {
  const numero = Number(leer(CLAVE_CORRELATIVO_TICKET))
  return Number.isInteger(numero) && numero > 0 ? numero : 1
}

/**
 * Toma el número para el ticket que se está por imprimir y deja guardado el siguiente. No hay
 * `await` entre leer y guardar, así que dos pagos seguidos no se pueden llevar el mismo número.
 */
export function tomarNumeroDeTicket(): number {
  const numero = proximoNumeroDeTicket()
  guardar(CLAVE_CORRELATIVO_TICKET, String(numero + 1))
  return numero
}

/** Para Administración → Impresora: corrige el correlativo, por ejemplo después de cambiar el rollo. */
export function establecerProximoNumeroDeTicket(numero: number): number {
  if (!Number.isInteger(numero) || numero < 1) {
    throw new ErrorDeNegocio('El número de ticket tiene que ser un entero mayor o igual a 1.')
  }
  guardar(CLAVE_CORRELATIVO_TICKET, String(numero))
  return numero
}

// ---------------------------------------------------------------------------
// Direcciones de las sucursales para el encabezado del ticket
// ---------------------------------------------------------------------------

const CLAVE_DIRECCIONES = 'direcciones_ticket'

/**
 * Las direcciones que la agencia ya tenía impresas, por sucursal del catálogo. Están acá para que el
 * ticket salga bien desde el primer arranque; cualquiera se puede pisar desde Administración →
 * Impresora.
 *
 * La de Dock Sud está escrita como «Avellaneda» a propósito: es la calle del mostrador, que la agencia
 * nombra de las dos maneras. Mientras estas direcciones se guardaban bajo la clave «AVELLANEDA», el
 * ticket de la sucursal «Dock Sud» salía sin dirección porque los dos nombres no se cruzaban.
 */
const DIRECCIONES_INICIALES: Record<NombreDeSucursal, string> = {
  'Dock Sud': 'Manuel Estévez N° 1234 Avellaneda',
  Lanús: 'Centenario Uruguayo 1217',
  Sarandí: 'Av. Bartolomé Mitre 2588',
  Daniel: '',
}

/**
 * El teléfono que venía impreso en el encabezado del ticket. Era uno solo para toda la agencia, así
 * que arranca igual en las cuatro sucursales: quien atiende cada mostrador lo cambia por el celular
 * de su local desde Administración → Impresora y el resto sigue como estaba.
 */
const TELEFONO_INICIAL = '11 4083-0416'

const TELEFONOS_INICIALES: Record<NombreDeSucursal, string> = {
  'Dock Sud': TELEFONO_INICIAL,
  Lanús: TELEFONO_INICIAL,
  Sarandí: TELEFONO_INICIAL,
  Daniel: TELEFONO_INICIAL,
}

/** Lo que se guarda por sucursal para encabezar su ticket. */
export interface EncabezadoGuardado {
  direccion: string
  /**
   * null cuando la sucursal viene de una versión anterior, que guardaba sólo la dirección: ahí todavía
   * no hay una decisión sobre el teléfono y vale el de fábrica. La cadena vacía sí es una decisión —
   * alguien lo borró— y deja el ticket sin teléfono.
   */
  telefono: string | null
}

/** Lo guardado tal cual: nombre de sucursal → dirección y teléfono. Sin los iniciales. */
export function direccionesGuardadas(): Map<string, EncabezadoGuardado> {
  const crudo = leer(CLAVE_DIRECCIONES)
  if (!crudo) return new Map()
  try {
    const datos = JSON.parse(crudo) as unknown
    if (!Array.isArray(datos)) return new Map()
    const mapa = new Map<string, EncabezadoGuardado>()
    for (const fila of datos) {
      if (typeof fila !== 'object' || fila === null) continue
      const { sucursal, direccion, telefono } = fila as { sucursal?: unknown; direccion?: unknown; telefono?: unknown }
      if (typeof sucursal !== 'string' || !sucursal.trim()) continue
      mapa.set(sucursal.trim(), {
        direccion: typeof direccion === 'string' ? direccion.trim() : '',
        telefono: typeof telefono === 'string' ? telefono.trim() : null,
      })
    }
    return mapa
  } catch {
    return new Map()
  }
}

export function guardarDirecciones(direcciones: { sucursal: string; direccion: string; telefono?: string | null }[]): void {
  // Se guardan también las vacías: borrar la dirección de una sucursal es una decisión, no un olvido,
  // y si no quedara guardada volvería la inicial en el siguiente ticket.
  const limpias: { sucursal: string; direccion: string; telefono: string }[] = []
  const vistas = new Set<string>()
  for (const fila of direcciones) {
    const sucursal = (fila.sucursal ?? '').trim()
    if (!sucursal) continue
    const clave = claveDeSucursal(sucursal)
    if (vistas.has(clave)) continue
    vistas.add(clave)
    limpias.push({
      sucursal,
      direccion: (fila.direccion ?? '').trim().slice(0, 200),
      // Sin teléfono en lo que llega —una pantalla vieja, o una llamada que sólo trae la dirección— se
      // guarda el que ya estaba, para no borrarlo sin que nadie lo haya pedido.
      telefono: (fila.telefono ?? telefonoDeSucursal(sucursal)).trim().slice(0, 60),
    })
  }
  guardar(CLAVE_DIRECCIONES, JSON.stringify(limpias))
}

/** La dirección que va en el ticket de esa sucursal. Cadena vacía si nadie la cargó todavía. */
export function direccionDeSucursal(nombre: string | null | undefined): string {
  const buscado = claveDeSucursal(nombre ?? '')
  if (!buscado) return ''
  for (const [sucursal, guardada] of direccionesGuardadas()) {
    if (mismaSucursal(sucursal, nombre)) return guardada.direccion
  }
  return direccionInicial(nombre ?? '')
}

/**
 * El teléfono que va en el encabezado del ticket de esa sucursal. Cae al de fábrica mientras nadie
 * haya cargado uno propio, así que el ticket sigue saliendo igual que antes hasta que el mostrador
 * decide cambiarlo.
 */
export function telefonoDeSucursal(nombre: string | null | undefined): string {
  const buscado = claveDeSucursal(nombre ?? '')
  if (!buscado) return ''
  for (const [sucursal, guardada] of direccionesGuardadas()) {
    if (mismaSucursal(sucursal, nombre)) return guardada.telefono ?? telefonoInicial(nombre ?? '')
  }
  return telefonoInicial(nombre ?? '')
}

/** La inicial de fábrica de una sucursal, para no perderla al listar las que nadie tocó. */
export function direccionInicial(nombre: string): string {
  const sucursal = sucursalCanonica(nombre)
  if (!sucursal) return ''
  // La demo se le muestra a otras agencias: nada de las direcciones de los mostradores de verdad, sino
  // las inventadas que también publica su servidor simulado.
  return esDemo() ? ENCABEZADOS_DE_TICKET_DE_LA_DEMO[sucursal].direccion : DIRECCIONES_INICIALES[sucursal]
}

/**
 * El teléfono de fábrica. Una sucursal que no está en el catálogo arranca sin ninguno: el de la
 * agencia es el de los cuatro mostradores conocidos y no tiene por qué serlo de un local nuevo.
 */
export function telefonoInicial(nombre: string): string {
  const sucursal = sucursalCanonica(nombre)
  if (!sucursal) return ''
  // Lo mismo que la dirección: en la demo, un teléfono 5555 que no es de nadie.
  return esDemo() ? ENCABEZADOS_DE_TICKET_DE_LA_DEMO[sucursal].telefono : TELEFONOS_INICIALES[sucursal]
}

/**
 * El ticket se imprime en segundo plano para no demorar el cobro: si falla, el error se guarda acá y
 * se ve en Administración → Impresora en vez de perderse.
 */
export function ultimoErrorDeImpresion(): string | null {
  const valor = leer(CLAVE_ERROR_IMPRESION)
  return valor && valor.trim() ? valor : null
}

export function anotarErrorDeImpresion(mensaje: string | null): void {
  guardar(CLAVE_ERROR_IMPRESION, mensaje ? `${new Date().toISOString()} · ${mensaje}`.slice(0, 500) : '')
}
