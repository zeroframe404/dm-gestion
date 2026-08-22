// Preferencias de la aplicación que viven en la base (no son credenciales): hoy, la ticketeadora de
// Cobranzas. Las plantillas de los mensajes se mudaron a plantillas.ts en la Fase 9, que es cuando
// dejaron de ser una sola.
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
  impresora: string | null
  anchoMm: number
}

const SIN_IMPRESORA: ImpresoraGuardada = { habilitada: false, impresora: null, anchoMm: ANCHO_TICKET_POR_DEFECTO }

export function impresoraGuardada(): ImpresoraGuardada {
  const crudo = leer(CLAVE_IMPRESORA)
  if (!crudo) return SIN_IMPRESORA
  try {
    const datos = JSON.parse(crudo) as Partial<ImpresoraGuardada>
    return {
      habilitada: datos.habilitada === true,
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
  const nueva: ImpresoraGuardada = { habilitada: datos.habilitada === true, impresora: impresora || null, anchoMm: ancho }
  guardar(CLAVE_IMPRESORA, JSON.stringify(nueva))
  return nueva
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
