// Cuenta Corriente (Galeno Seguros y ART, manual páginas 76-77): consulta de cuenta corriente y
// detalle de liquidaciones. Igual que en consultas.ts, cada reporte tiene sus columnas fijas del
// manual y se devuelve como `ReporteGaleno` para una tabla genérica.
import type { ColumnaDeReporteGaleno, FiltrosDeReporteGaleno, ReporteGaleno } from '../../../shared/tipos'
import type { ClienteGaleno } from './cliente'

function filaDesde(cruda: unknown): Record<string, string | number | null> {
  if (!cruda || typeof cruda !== 'object') return {}
  const fila: Record<string, string | number | null> = {}
  for (const [clave, valor] of Object.entries(cruda as Record<string, unknown>)) {
    fila[clave] = typeof valor === 'string' || typeof valor === 'number' ? valor : valor === null ? null : String(valor)
  }
  return fila
}

function listaDe(cruda: unknown, clave: string): unknown[] {
  if (Array.isArray(cruda)) return cruda
  if (cruda && typeof cruda === 'object') {
    const lista = (cruda as Record<string, unknown>)[clave]
    if (Array.isArray(lista)) return lista
  }
  return []
}

const COLUMNAS_CUENTA_CORRIENTE: ColumnaDeReporteGaleno[] = [
  { clave: 'mesLiquidacion', titulo: 'Mes' },
  { clave: 'importe', titulo: 'Importe' },
  { clave: 'retencionIVA', titulo: 'Retención IVA' },
  { clave: 'nroFactura', titulo: 'Factura' },
  { clave: 'tipoFactura', titulo: 'Tipo' },
  { clave: 'descConcepto', titulo: 'Concepto' },
  { clave: 'fechaFactura', titulo: 'Fecha de factura' },
]

/**
 * `idNegocio`: 27 = ART, 20 = Seguros y Autos. `mesDesde`/`mesHasta` van en formato aaaammm — el
 * llamador (servicios/galeno.ts) ya los arma así a partir de lo que carga la persona en la pantalla.
 */
export async function consultaCuentaCorriente(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    idNegocio: String(filtros.idNegocio ?? 20),
    nroLegajo,
    fechaDesde: filtros.mesDesde,
    fechaHasta: filtros.mesHasta,
    pendFact: filtros.soloPendientesDeFacturar ? 'S' : 'T',
  }
  const cruda = await cliente.pedirJson('/api/comisiones/consultaCuentaCorriente', { metodo: 'POST', body })
  return { columnas: COLUMNAS_CUENTA_CORRIENTE, filas: listaDe(cruda, 'listaCuentaCorriente').map(filaDesde) }
}

const COLUMNAS_LIQUIDACIONES: ColumnaDeReporteGaleno[] = [
  { clave: 'contratoOPoliza', titulo: 'Contrato/Póliza' },
  { clave: 'clienteORazonSocial', titulo: 'Cliente' },
  { clave: 'fechaUltimaCobranza', titulo: 'Última cobranza' },
  { clave: 'importeCobranzas', titulo: 'Cobranzas' },
  { clave: 'comisionProductor', titulo: 'Comisión productor' },
  { clave: 'razonSocialProductor', titulo: 'Productor' },
]

/** Los datos del período (`mesLiquidacion`, `nroFactura`, etc.) son los que devolvió la fila elegida
 *  de `consultaCuentaCorriente`: se pasan tal cual, no se vuelven a pedir. */
export async function detalleDeLiquidaciones(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    idNegocio: String(filtros.idNegocio ?? 20),
    nroLegajo,
    mesLiquidacion: filtros.mesLiquidacion,
    nroFactura: filtros.nroFactura,
    tipoFactura: filtros.tipoFactura,
    codConcepto: filtros.codConcepto,
    fechaFactura: filtros.fechaFactura,
    fechaMovIngFact: filtros.fechaMovIngFact,
  }
  const cruda = await cliente.pedirJson('/api/comisiones/detalleCuentaCorriente', { metodo: 'POST', body })
  return { columnas: COLUMNAS_LIQUIDACIONES, filas: listaDe(cruda, 'listaDetalleLiquidaciones').map(filaDesde) }
}
