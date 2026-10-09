// Las listas que ATM da por REST: los vendedores de la cuenta y los planes que cada vendedor puede
// cotizar. Todo lo demás (marcas, modelos, localidades, usos…) ATM lo publica en tablas por FTP: ver
// tablas.ts.
import type { TipoDeVehiculo } from '../../../shared/tipos'
import { ErrorDeAtm, type ClienteAtm } from './cliente'

/** La «sección» de ATM: 3 autos, 4 motos. */
export const SECCION_ATM: Record<TipoDeVehiculo, '3' | '4'> = { AUTO: '3', MOTO: '4' }

export interface VendedorAtm {
  /** El código de 10 dígitos que va en `<vendedor>` («prodlargo»). */
  codigo: string
  /** Como lo nombra ATM: «12663 - MARTINEZ DANIEL ADRIAN». */
  nombre: string
  puedeInspeccionar: boolean
}

/**
 * El plan es la combinación de vigencia, facturación, cuotas y forma de pago: «ANUAL/MENSUAL» con
 * tarjeta es un plan y «ANUAL/MENSUAL» con CBU, otro.
 */
export interface PlanAtm {
  codigo: string
  descripcion: string
  /** Como la nombra ATM: TARJETA, CBU, EFVO. */
  formaDePago: string
  /** 0 efectivo, 3 tarjeta, 4 CBU (débito). */
  formaDePagoCodigo: number
}

function textoSuelto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : typeof valor === 'number' ? String(valor) : ''
}

/** Los mensajes de error que ATM mete en `errores` (o en una lista suelta), en una línea. */
function errores(valor: unknown): string {
  const lista = Array.isArray(valor) ? valor : []
  return lista.map(textoSuelto).filter(Boolean).join(' · ')
}

export function leerVendedores(respuesta: unknown): VendedorAtm[] {
  if (!respuesta || typeof respuesta !== 'object' || Array.isArray(respuesta)) {
    throw new ErrorDeAtm('ATM contestó la lista de vendedores con un formato inesperado.', false)
  }
  const r = respuesta as { error?: unknown; errores?: unknown; vendedores?: unknown }
  if (r.error === true || r.error === 'true') {
    throw new ErrorDeAtm(`ATM no aceptó la cuenta: ${errores(r.errores) || 'sin detalle'}.`, false)
  }
  const lista = Array.isArray(r.vendedores) ? r.vendedores : []
  return lista.flatMap((fila) => {
    if (!fila || typeof fila !== 'object') return []
    const v = fila as Record<string, unknown>
    const codigo = textoSuelto(v.prodlargo)
    if (!codigo) return []
    return [{ codigo, nombre: textoSuelto(v.apellido) || codigo, puedeInspeccionar: textoSuelto(v.inspeccion).toUpperCase() === 'S' }]
  })
}

export async function vendedoresAtm(cliente: ClienteAtm): Promise<VendedorAtm[]> {
  return leerVendedores(await cliente.post('ws_vendedores', { usuario: cliente.cuenta.usuario, password: cliente.cuenta.clave }))
}

export function leerPlanes(respuesta: unknown): PlanAtm[] {
  if (Array.isArray(respuesta) && respuesta.every((fila) => typeof fila === 'string')) {
    // Así contesta un usuario que no existe: `["Error usuario: X no encontrado"]`.
    throw new ErrorDeAtm(`ATM no devolvió los planes: ${errores(respuesta) || 'sin detalle'}.`, false)
  }
  if (!Array.isArray(respuesta)) {
    const r = respuesta && typeof respuesta === 'object' ? (respuesta as { response?: unknown; errores?: unknown }) : {}
    const detalle =
      r.response && typeof r.response === 'object' ? Object.values(r.response as Record<string, unknown>).flat().map(textoSuelto).filter(Boolean).join(' · ') : errores(r.errores)
    throw new ErrorDeAtm(`ATM no devolvió los planes${detalle ? `: ${detalle}` : '.'}`, false)
  }
  return respuesta.flatMap((fila) => {
    if (!fila || typeof fila !== 'object') return []
    const p = fila as Record<string, unknown>
    const codigo = textoSuelto(p.Plan)
    if (!codigo) return []
    const formaDePagoCodigo = Number(p.FormaDePagoCodigo)
    return [
      {
        codigo,
        descripcion: textoSuelto(p.Descripcion) || `Plan ${codigo}`,
        formaDePago: textoSuelto(p.FormaDePago),
        formaDePagoCodigo: Number.isFinite(formaDePagoCodigo) ? formaDePagoCodigo : -1,
      },
    ]
  })
}

export async function planesAtm(cliente: ClienteAtm, tipo: TipoDeVehiculo, vendedor: string): Promise<PlanAtm[]> {
  return leerPlanes(await cliente.get('get_plans', { usa: cliente.cuenta.usuario, seccion: SECCION_ATM[tipo], vendedor }))
}
