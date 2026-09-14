// Servicio de Consultas (manual, páginas 60-73): pólizas por legajo, riesgos de una póliza, detalle
// de póliza, detalle de producción de automotores, cuotas impagas, cuotas cobradas, pólizas vigentes
// y endosos. Son ocho reportes de sólo lectura con columnas ya fijas y documentadas 1 a 1 en el
// manual — en vez de un tipo TypeScript por reporte, cada función arma directamente un `ReporteGaleno`
// (columnas con su título en español + filas), y la pantalla los muestra con una sola tabla genérica.
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

function reporte(columnas: ColumnaDeReporteGaleno[], crudas: unknown): ReporteGaleno {
  const filas = Array.isArray(crudas) ? crudas.map(filaDesde) : []
  return { columnas, filas }
}

/** Algunas respuestas de Consultas vienen envueltas en `{ codigoError, descripcionError, lista: [...] }`. */
function listaDe(cruda: unknown, clave: string): unknown[] {
  if (Array.isArray(cruda)) return cruda
  if (cruda && typeof cruda === 'object') {
    const lista = (cruda as Record<string, unknown>)[clave]
    if (Array.isArray(lista)) return lista
  }
  return []
}

const COLUMNAS_POLIZAS_POR_LEGAJO: ColumnaDeReporteGaleno[] = [
  { clave: 'nroPoliza', titulo: 'Póliza' },
  { clave: 'tipoSeguro', titulo: 'Tipo' },
  { clave: 'rama', titulo: 'Rama' },
  { clave: 'nombreTomador', titulo: 'Tomador' },
  { clave: 'patente', titulo: 'Patente' },
  { clave: 'fecvigenciaDesde', titulo: 'Vigencia desde' },
  { clave: 'fecvigenciaHasta', titulo: 'Vigencia hasta' },
  { clave: 'fechaEmision', titulo: 'Emisión' },
]

export async function polizasPorLegajo(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    nroLegajo,
    rama: filtros.rama,
    poliza: filtros.poliza,
    inicioVigencia: filtros.inicioVigencia,
    finVigencia: filtros.finVigencia,
    estado: filtros.estado,
    tipoSeguro: filtros.tipoSeguro ?? 'TODOS',
    patente: filtros.patente,
    fechaEmisionDesde: filtros.fechaEmisionDesde,
    fechaEmisionHasta: filtros.fechaEmisionHasta,
  }
  const cruda = await cliente.pedirJson('/api/polizas/consultaXLegajo', { metodo: 'POST', body })
  return reporte(COLUMNAS_POLIZAS_POR_LEGAJO, cruda)
}

const COLUMNAS_RIESGOS: ColumnaDeReporteGaleno[] = [
  { clave: 'numRiesgo', titulo: 'Riesgo' },
  { clave: 'descRiesgo', titulo: 'Descripción' },
  { clave: 'patente', titulo: 'Patente' },
  { clave: 'desCobertura', titulo: 'Cobertura' },
  { clave: 'valorAsegurado', titulo: 'Suma asegurada' },
  { clave: 'nombreAsegurado', titulo: 'Asegurado' },
  { clave: 'vigDesde', titulo: 'Vigencia desde' },
  { clave: 'vigHasta', titulo: 'Vigencia hasta' },
]

export async function riesgosDePoliza(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    nroLegajo,
    poliza: filtros.poliza,
    rama: filtros.rama,
    patente: filtros.patente,
    estado: filtros.estado,
    nombreRiesgo: undefined,
    nroDocRiesgo: undefined,
  }
  const cruda = await cliente.pedirJson('/api/polizas/obtenerPolizasRiesgo', { metodo: 'POST', body })
  return reporte(COLUMNAS_RIESGOS, cruda)
}

/** El detalle de una póliza no es tabular (trae tomador, riesgos y cuotas anidados): se devuelve tal
 *  cual, y la pantalla lo muestra como ficha en vez de como tabla. */
export async function detalleDePoliza(cliente: ClienteGaleno, nroLegajo: string, rama: number, poliza?: string, nroRiesgo?: string): Promise<unknown> {
  return cliente.pedirJson('/api/polizas/detalle', { metodo: 'POST', body: { nroLegajo, rama, poliza, nroRiesgo } })
}

const COLUMNAS_PRODUCCION: ColumnaDeReporteGaleno[] = [
  { clave: 'poliza', titulo: 'Póliza' },
  { clave: 'endoso', titulo: 'Endoso' },
  { clave: 'tipoEndoso', titulo: 'Tipo' },
  { clave: 'nombreTomador', titulo: 'Tomador' },
  { clave: 'patenteVehiculo', titulo: 'Patente' },
  { clave: 'coberturaRiesgo', titulo: 'Cobertura' },
  { clave: 'premioPoliza', titulo: 'Premio' },
  { clave: 'fechaEmisionEndoso', titulo: 'Emisión' },
  { clave: 'fechaIniVigPoliza', titulo: 'Vigencia desde' },
  { clave: 'fechaFinVigPoliza', titulo: 'Vigencia hasta' },
]

export async function detalleDeProduccion(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    nroLegajo,
    poliza: filtros.poliza,
    cuiTomador: filtros.cuitTomador,
    fechaVigenciaDesde: filtros.inicioVigencia,
    fechaVigenciaHasta: filtros.finVigencia,
  }
  const cruda = await cliente.pedirJson('/api/polizas/autos/detalleProduccion', { metodo: 'POST', body })
  return reporte(COLUMNAS_PRODUCCION, listaDe(cruda, 'detalleProduccionAutomotores'))
}

const COLUMNAS_CUOTAS_IMPAGAS: ColumnaDeReporteGaleno[] = [
  { clave: 'poliza', titulo: 'Póliza' },
  { clave: 'nroCuota', titulo: 'Cuota' },
  { clave: 'tomador', titulo: 'Tomador' },
  { clave: 'fechaVtoAsegurado', titulo: 'Vencimiento' },
  { clave: 'saldoCuota', titulo: 'Saldo' },
  { clave: 'estadoPoliza', titulo: 'Estado de la póliza' },
]

export async function cuotasImpagas(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    nroLegajo,
    codRama: filtros.rama,
    nroPoliza: filtros.poliza,
    cuilTomador: filtros.cuitTomador,
    fechaVigenciaDesde: filtros.inicioVigencia,
    fechaVigenciaHasta: filtros.finVigencia,
  }
  const cruda = await cliente.pedirJson('/api/polizas/cuotasImpagas', { metodo: 'POST', body })
  return reporte(COLUMNAS_CUOTAS_IMPAGAS, listaDe(cruda, 'cuotasImpagas'))
}

const COLUMNAS_CUOTAS_COBRADAS: ColumnaDeReporteGaleno[] = [
  { clave: 'poliza', titulo: 'Póliza' },
  { clave: 'nroCuota', titulo: 'Cuota' },
  { clave: 'tomador', titulo: 'Tomador' },
  { clave: 'fechaVencimientoCuota', titulo: 'Vencimiento' },
  { clave: 'premioCobradoCuota', titulo: 'Cobrado' },
  { clave: 'formaPagoCuota', titulo: 'Forma de pago' },
  { clave: 'fechaContableImputacion', titulo: 'Imputación contable' },
]

export async function cuotasCobradas(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    nroLegajo,
    codRama: filtros.rama,
    nroPoliza: filtros.poliza,
    cuilTomador: filtros.cuitTomador,
    fechaImputacionContableDesde: filtros.fechaImputacionContableDesde,
    fechaImputacionContableHasta: filtros.fechaImputacionContableHasta,
  }
  const cruda = await cliente.pedirJson('/api/polizas/cuotasCobradas', { metodo: 'POST', body })
  return reporte(COLUMNAS_CUOTAS_COBRADAS, listaDe(cruda, 'cuotasCobradas'))
}

const COLUMNAS_POLIZAS_VIGENTES: ColumnaDeReporteGaleno[] = [
  { clave: 'poliza', titulo: 'Póliza' },
  { clave: 'descRama', titulo: 'Rama' },
  { clave: 'tomador', titulo: 'Tomador' },
  { clave: 'nombreAsegurado', titulo: 'Asegurado' },
  { clave: 'sumaAsegurada', titulo: 'Suma asegurada' },
  { clave: 'sumaPremios', titulo: 'Premios' },
  { clave: 'sumaSaldoVencido', titulo: 'Saldo vencido' },
]

export async function polizasVigentes(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = { nroLegajo, codRama: filtros.rama, nroPoliza: filtros.poliza, cuilTomador: filtros.cuitTomador }
  const cruda = await cliente.pedirJson('/api/polizas/vigentes', { metodo: 'POST', body })
  return reporte(COLUMNAS_POLIZAS_VIGENTES, listaDe(cruda, 'polizasVigentes'))
}

const COLUMNAS_ENDOSOS: ColumnaDeReporteGaleno[] = [
  { clave: 'poliza', titulo: 'Póliza' },
  { clave: 'endoso', titulo: 'Endoso' },
  { clave: 'desc_tipo_modificacion', titulo: 'Movimiento' },
  { clave: 'nombre_asegurado', titulo: 'Asegurado' },
  { clave: 'patente_vehiculo', titulo: 'Patente' },
  { clave: 'premio', titulo: 'Premio' },
  { clave: 'fecha_emision_movimiento', titulo: 'Fecha' },
]

/**
 * El propio endpoint exige `rama`, `fechaEmisionDesde` y `fechaEmisionHasta` (rango de máximo 31
 * días) y sólo devuelve los primeros 5000 registros: si hace falta más, se pagina con `pagina` y
 * `cantRegistrosPagina`.
 */
export async function endosos(cliente: ClienteGaleno, nroLegajo: string, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  const body = {
    nroLegajo,
    fechaEmisionDesde: filtros.fechaEmisionDesde,
    fechaEmisionHasta: filtros.fechaEmisionHasta,
    rama: filtros.rama,
    poliza: filtros.poliza,
    pagina: filtros.pagina,
    cantRegistrosPagina: filtros.cantRegistrosPagina,
  }
  const cruda = await cliente.pedirJson('/api/polizas/obtenerModificacionesEndosos', { metodo: 'POST', body })
  return reporte(COLUMNAS_ENDOSOS, listaDe(cruda, 'novedades'))
}
