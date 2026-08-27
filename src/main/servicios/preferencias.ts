// Preferencias de la aplicación que viven en la base (no son credenciales): hoy, la ticketeadora de
// Cobranzas y las direcciones que encabezan su comprobante. Las plantillas de los mensajes se mudaron
// a plantillas.ts en la Fase 9, que es cuando dejaron de ser una sola.
import type { DatosDeImpresora } from '../../shared/tipos'
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

export interface ImpresoraGuardada {
  habilitada: boolean
  /** Preguntar antes de cada ticket en vez de imprimirlo solo. */
  preguntar: boolean
  impresora: string | null
  anchoMm: number
}

const SIN_IMPRESORA: ImpresoraGuardada = {
  habilitada: false,
  preguntar: true,
  impresora: null,
  anchoMm: ANCHO_TICKET_POR_DEFECTO,
}

export function impresoraGuardada(): ImpresoraGuardada {
  const crudo = leer(CLAVE_IMPRESORA)
  if (!crudo) return SIN_IMPRESORA
  try {
    const datos = JSON.parse(crudo) as Partial<ImpresoraGuardada>
    return {
      habilitada: datos.habilitada === true,
      // Sin la clave guardada (configuraciones anteriores a que existiera la pregunta) se pregunta:
      // gastar papel de más molesta más que un cartel, y el cartel se apaga con un tilde.
      preguntar: datos.preguntar !== false,
      impresora: typeof datos.impresora === 'string' && datos.impresora ? datos.impresora : null,
      anchoMm: typeof datos.anchoMm === 'number' && datos.anchoMm >= 40 && datos.anchoMm <= 120 ? datos.anchoMm : ANCHO_TICKET_POR_DEFECTO,
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
  if (datos.habilitada === true && !impresora) {
    throw new ErrorDeNegocio('Elegí la impresora térmica antes de activar el ticket.')
  }
  const nueva: ImpresoraGuardada = {
    habilitada: datos.habilitada === true,
    preguntar: datos.preguntar === true,
    impresora: impresora || null,
    anchoMm: ancho,
  }
  guardar(CLAVE_IMPRESORA, JSON.stringify(nueva))
  return nueva
}

// ---------------------------------------------------------------------------
// Direcciones de las sucursales para el encabezado del ticket
// ---------------------------------------------------------------------------

const CLAVE_DIRECCIONES = 'direcciones_ticket'

/**
 * Las tres direcciones que la agencia ya tenía impresas. Están acá para que el ticket salga bien desde
 * el primer arranque; cualquiera de ellas se puede pisar desde Administración → Impresora, y una
 * sucursal nueva se carga ahí mismo sin tocar código.
 */
const DIRECCIONES_INICIALES: Record<string, string> = {
  AVELLANEDA: 'Manuel Estévez N° 1234 Avellaneda',
  SARANDI: 'Av. Bartolomé Mitre 2588',
  LANUS: 'Centenario Uruguayo 1217',
}

/** Los nombres de sucursal se comparan sin acentos, mayúsculas ni espacios de más («Lanús» = «LANUS»). */
export function claveDeSucursal(nombre: string): string {
  return nombre
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
}

/** Lo guardado tal cual: nombre de sucursal → dirección. Sin las iniciales. */
export function direccionesGuardadas(): Map<string, string> {
  const crudo = leer(CLAVE_DIRECCIONES)
  if (!crudo) return new Map()
  try {
    const datos = JSON.parse(crudo) as unknown
    if (!Array.isArray(datos)) return new Map()
    const mapa = new Map<string, string>()
    for (const fila of datos) {
      if (typeof fila !== 'object' || fila === null) continue
      const { sucursal, direccion } = fila as { sucursal?: unknown; direccion?: unknown }
      if (typeof sucursal !== 'string' || !sucursal.trim()) continue
      mapa.set(sucursal.trim(), typeof direccion === 'string' ? direccion.trim() : '')
    }
    return mapa
  } catch {
    return new Map()
  }
}

export function guardarDirecciones(direcciones: { sucursal: string; direccion: string }[]): void {
  // Se guardan también las vacías: borrar la dirección de una sucursal es una decisión, no un olvido,
  // y si no quedara guardada volvería la inicial en el siguiente ticket.
  const limpias: { sucursal: string; direccion: string }[] = []
  const vistas = new Set<string>()
  for (const fila of direcciones) {
    const sucursal = (fila.sucursal ?? '').trim()
    if (!sucursal) continue
    const clave = claveDeSucursal(sucursal)
    if (vistas.has(clave)) continue
    vistas.add(clave)
    limpias.push({ sucursal, direccion: (fila.direccion ?? '').trim().slice(0, 200) })
  }
  guardar(CLAVE_DIRECCIONES, JSON.stringify(limpias))
}

/** La dirección que va en el ticket de esa sucursal. Cadena vacía si nadie la cargó todavía. */
export function direccionDeSucursal(nombre: string | null | undefined): string {
  const buscado = claveDeSucursal(nombre ?? '')
  if (!buscado) return ''
  for (const [sucursal, direccion] of direccionesGuardadas()) {
    if (claveDeSucursal(sucursal) === buscado) return direccion
  }
  return DIRECCIONES_INICIALES[buscado] ?? ''
}

/** La inicial de fábrica de una sucursal, para no perderla al listar las que nadie tocó. */
export function direccionInicial(nombre: string): string {
  return DIRECCIONES_INICIALES[claveDeSucursal(nombre)] ?? ''
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
