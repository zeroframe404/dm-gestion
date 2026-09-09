// Comisiones, Imputados y (con un recorte mucho más chico) Caja del día, armados a partir del payload
// que YA calculó el servidor — la misma migración que metricasDesdeCache.ts, para el resto del módulo
// Cobranzas (ver el comentario de esa cabecera para el porqué del cotejo y de la separación entre "el
// algoritmo de referencia" y "esta mitad").
//
// LAS TRES PANTALLAS NO SE MIGRAN IGUAL.
//  - Comisiones es de sólo lectura y ya está gateada a SUPER_ADMIN/ADMIN a nivel de handler (ningún
//    empleado la pide), así que el payload del servidor la reemplaza ENTERA cuando está disponible,
//    igual que el tablero de Métricas.
//  - Imputados es, a la vez, la lista que se ve Y la que `cambiarResultado()` edita al instante
//    releyendo su propio escrito — migrar la lista rompería esa UX. Acá el cálculo LOCAL de siempre
//    (`imputados()`) sigue siendo la fuente de la lista/catálogos, y sólo se le PISAN los agregados
//    (`contadores`/`total`/`totalImporte`/`pendientes`/`sinCobrar`) con el valor del servidor, filtrando
//    la grilla cacheada por las MISMAS compañías/sucursales que el cálculo local ya resolvió —así las
//    dos cuentas están mirando exactamente la misma selección.
//  - Caja del día es la más chica de las tres migraciones a propósito (ver la cabecera del lado del
//    servidor, metricas.caja.ts): sólo se pisan `totalesPorMedio`/`total`/`sinImporte`/`imputados`, y
//    sólo para HOY y AYER — nunca `pagos` (la lista, que además tiene rutas de escritura: registrar un
//    pago manual, revisar un cobro, el número de ticket) ni `arqueo` (depende de `caja_movimientos`,
//    100% local, sin equivalente server-side). El filtro por sucursal que ya hizo el cálculo local
//    (`sucursalObligadaDe`, que a un EMPLEADO le fuerza SU mostrador) es el mismo que se usa para
//    recortar la grilla cacheada: nunca se filtra por lo que pidió el cliente, siempre por lo que el
//    cálculo local ya decidió que puede ver.
import { coincideAlguno } from '../../shared/filtros'
import { hoyLocal } from '../../shared/semaforo'
import { mismaSucursal } from '../../shared/sucursales'
import type { CajaDelDia, FilaComision, RendicionImputados, ResultadoImputacion, ResumenComisiones, SesionUsuario } from '../../shared/tipos'
import { normalizarTexto } from '../importacion/normalizar'
import { cajaDelDia, comisionesLocal, imputados } from './cobranzas'
import { cotejarNumeros, frescuraActual, tocaCotejar } from './cotejoDeMetricas'
import { leerSnapshotDeMetrica } from './metricasCache'

const FORMATO_PERIODO = /^\d{4}-\d{2}$/

/** Igual criterio que en metricasDesdeCache.ts: comparar por texto plegado, sin `normalizarTexto` de
 *  puntuación entera, porque acá se compara contra lo que ya devolvió el cálculo local (que usa el
 *  mismo criterio). */
function mismaCompania(a: string, b: unknown): boolean {
  return normalizarTexto(a) === normalizarTexto(b)
}

function resolverPeriodoDesdeCache(pedido: string | null | undefined, periodosAscendentes: string[]): string | null {
  const limpio = (pedido ?? '').trim()
  if (limpio && FORMATO_PERIODO.test(limpio)) return limpio
  return periodosAscendentes[periodosAscendentes.length - 1] ?? null
}

// ---------------------------------------------------------------------------
// Comisiones
// ---------------------------------------------------------------------------

interface FilaComisionCache {
  compania: string
  pagos: number
  cobrado: number
  porcentaje: number
  comision: number
}

interface ComisionesDelPeriodoCache {
  filas: FilaComisionCache[]
  cobrado: number
  comision: number
  sinPorcentaje: string[]
}

interface ComisionesPayloadCache {
  periodos: string[]
  porPeriodo: Record<string, ComisionesDelPeriodoCache>
}

function esPayloadDeComisiones(valor: unknown): valor is ComisionesPayloadCache {
  if (!valor || typeof valor !== 'object') return false
  const posible = valor as Partial<ComisionesPayloadCache>
  return Array.isArray(posible.periodos) && typeof posible.porPeriodo === 'object' && posible.porPeriodo !== null
}

/** `cobranzas:comisiones`: usa el payload del servidor cuando lo tiene, cae al cálculo local si no. */
export function comisionesConCache(periodoPedido: string | null): ResumenComisiones {
  const snap = leerSnapshotDeMetrica('comisiones')
  const payload = snap && esPayloadDeComisiones(snap.payload) ? snap.payload : null
  const periodo = payload ? resolverPeriodoDesdeCache(periodoPedido, payload.periodos) : null
  const datosPeriodo = periodo !== null ? payload?.porPeriodo[periodo] : undefined

  if (!snap || !payload || periodo === null || !datosPeriodo) return comisionesLocal(periodoPedido)

  const filas: FilaComision[] = datosPeriodo.filas.map((f) => ({ ...f }))
  const desdeCache: ResumenComisiones = {
    periodo,
    periodos: payload.periodos,
    filas,
    cobrado: datosPeriodo.cobrado,
    comision: datosPeriodo.comision,
    sinPorcentaje: datosPeriodo.sinPorcentaje,
  }

  if (tocaCotejar(`comisiones:${periodo}`)) {
    try {
      const local = comisionesLocal(periodoPedido)
      cotejarNumeros(`Comisiones ${periodo}`, [
        ['cobrado', local.cobrado, desdeCache.cobrado],
        ['comision', local.comision, desdeCache.comision],
      ])
    } catch (error) {
      console.error('[métricas] no se pudo cotejar comisiones contra el cálculo local:', error instanceof Error ? error.message : error)
    }
  }

  return { ...desdeCache, calculadoEn: snap.servidorCalculadoEn, recibidoEnEstaComputadora: snap.recibidoEn, frescura: frescuraActual() }
}

// ---------------------------------------------------------------------------
// Imputados — sólo el agregado; la lista y la edición siguen 100% locales
// ---------------------------------------------------------------------------

interface CeldaDeImputadosCache {
  sucursal: string
  compania: string
  contadores: Record<ResultadoImputacion, number>
  total: number
  totalImporte: number
  pendientes: number
  sinCobrar: number
}

interface ImputadosDelPeriodoCache {
  celdas: CeldaDeImputadosCache[]
}

interface ImputadosPayloadCache {
  periodos: string[]
  porPeriodo: Record<string, ImputadosDelPeriodoCache>
}

function esPayloadDeImputados(valor: unknown): valor is ImputadosPayloadCache {
  if (!valor || typeof valor !== 'object') return false
  const posible = valor as Partial<ImputadosPayloadCache>
  return Array.isArray(posible.periodos) && typeof posible.porPeriodo === 'object' && posible.porPeriodo !== null
}

const CONTADORES_EN_CERO: Record<ResultadoImputacion, number> = { '': 0, IMPUTADO: 0, OK: 0, REVISAR: 0, MAL: 0 }

/** Suma los contadores/total/etc. de las celdas que coinciden con las compañías y sucursales que el
 *  cálculo LOCAL ya resolvió (así las dos cuentas miran la misma selección). */
function agregadoDesdeCache(datosPeriodo: ImputadosDelPeriodoCache, companiasElegidas: string[], sucursalesElegidas: string[]) {
  const celdas = datosPeriodo.celdas.filter(
    (celda) =>
      coincideAlguno(sucursalesElegidas, celda.sucursal, mismaSucursal) && coincideAlguno(companiasElegidas, celda.compania, mismaCompania),
  )
  const contadores = { ...CONTADORES_EN_CERO }
  let total = 0
  let totalImporte = 0
  let sinCobrar = 0
  for (const celda of celdas) {
    for (const resultado of Object.keys(contadores) as ResultadoImputacion[]) contadores[resultado] += celda.contadores[resultado]
    total += celda.total
    totalImporte += celda.totalImporte
    sinCobrar += celda.sinCobrar
  }
  return { contadores, total, totalImporte, pendientes: contadores[''], sinCobrar }
}

/** `cobranzas:imputados`: la lista/catálogos siempre salen del cálculo local; los agregados se pisan
 *  con el valor del servidor cuando hay uno calculado para el período pedido. */
export function imputadosConCache(
  periodoPedido: string | null,
  companiasPedidas: string[],
  sucursalesPedidas: string[],
  veLosNumeros: boolean,
): RendicionImputados {
  const local = imputados(periodoPedido, companiasPedidas, sucursalesPedidas, veLosNumeros)

  const snap = leerSnapshotDeMetrica('imputados')
  const payload = snap && esPayloadDeImputados(snap.payload) ? snap.payload : null
  const datosPeriodo = payload?.porPeriodo[local.periodo]
  if (!snap || !payload || !datosPeriodo) return local

  const agregado = agregadoDesdeCache(datosPeriodo, local.companiasElegidas, local.sucursalesElegidas)

  if (tocaCotejar(`imputados:${local.periodo}:${local.companiasElegidas.slice().sort().join(',')}:${local.sucursalesElegidas.slice().sort().join(',')}`)) {
    cotejarNumeros(`Imputados ${local.periodo}`, [
      ['total', local.total, agregado.total],
      ['totalImporte', local.totalImporte, veLosNumeros ? agregado.totalImporte : local.totalImporte],
      ['pendientes', local.pendientes, agregado.pendientes],
      ['sinCobrar', local.sinCobrar, agregado.sinCobrar],
    ])
  }

  return {
    ...local,
    contadores: agregado.contadores,
    total: agregado.total,
    totalImporte: veLosNumeros ? agregado.totalImporte : null,
    pendientes: agregado.pendientes,
    sinCobrar: agregado.sinCobrar,
    calculadoEn: snap.servidorCalculadoEn,
    recibidoEnEstaComputadora: snap.recibidoEn,
    frescura: frescuraActual(),
  }
}

// ---------------------------------------------------------------------------
// Caja del día — sólo los totales de hoy/ayer; la lista, las escrituras y el arqueo siguen 100% locales
// ---------------------------------------------------------------------------

interface MedioDeCajaCache {
  medio: string
  pagos: number
  total: number
}

interface CeldaDeCajaCache {
  sucursal: string
  totalesPorMedio: MedioDeCajaCache[]
  total: number
  sinImporte: number
  imputados: number
}

interface DiaDeCajaCache {
  fecha: string
  celdas: CeldaDeCajaCache[]
}

interface CajaPayloadCache {
  hoy: string
  dias: DiaDeCajaCache[]
}

function esPayloadDeCaja(valor: unknown): valor is CajaPayloadCache {
  if (!valor || typeof valor !== 'object') return false
  const posible = valor as Partial<CajaPayloadCache>
  return Array.isArray(posible.dias)
}

/** Suma las celdas del día que coinciden con las sucursales que el cálculo LOCAL ya resolvió como
 *  visibles para este actor (`sucursalesElegidas`, que ya tiene aplicado `sucursalObligadaDe`). */
function agregadoDeCajaDesdeCache(dia: DiaDeCajaCache, sucursalesElegidas: string[]) {
  const celdas = dia.celdas.filter((celda) => coincideAlguno(sucursalesElegidas, celda.sucursal, mismaSucursal))
  let total = 0
  let sinImporte = 0
  let imputados = 0
  const medios = new Map<string, MedioDeCajaCache>()
  for (const celda of celdas) {
    total += celda.total
    sinImporte += celda.sinImporte
    imputados += celda.imputados
    for (const medio of celda.totalesPorMedio) {
      const clave = normalizarTexto(medio.medio)
      const previo = medios.get(clave)
      if (previo) {
        previo.pagos += medio.pagos
        previo.total += medio.total
      } else {
        medios.set(clave, { ...medio })
      }
    }
  }
  const totalesPorMedio = [...medios.values()].sort((a, b) => b.total - a.total || a.medio.localeCompare(b.medio, 'es'))
  return { total, sinImporte, imputados, totalesPorMedio }
}

/**
 * `cobranzas:caja`: la lista de pagos, las escrituras y el arqueo son SIEMPRE los del cálculo local
 * (`cajaDelDia`); sólo `totalesPorMedio`/`total`/`sinImporte`/`imputados` se pisan con el valor del
 * servidor, y sólo cuando el día pedido es hoy o ayer Y el servidor ya tiene ESE día exacto calculado
 * —nunca se confía en la etiqueta "hoy" que trae el payload (pudo quedar vieja si nadie tocó la grilla
 * desde la medianoche): se busca por la fecha que el cálculo local ya resolvió, no por la del servidor.
 */
export function cajaConCache(fechaPedida: string | null, sucursalesPedidas: string[], actor?: SesionUsuario | null): CajaDelDia {
  const local = cajaDelDia(fechaPedida, sucursalesPedidas, actor)

  const esHoyOAyer = local.fecha === hoyLocal() || local.fecha === diaAnterior(hoyLocal())
  if (!esHoyOAyer) return local

  const snap = leerSnapshotDeMetrica('caja')
  const payload = snap && esPayloadDeCaja(snap.payload) ? snap.payload : null
  const dia = payload?.dias.find((d) => d.fecha === local.fecha)
  if (!snap || !payload || !dia) return local

  const agregado = agregadoDeCajaDesdeCache(dia, local.sucursalesElegidas)

  if (tocaCotejar(`caja:${local.fecha}:${local.sucursalesElegidas.slice().sort().join(',')}`)) {
    cotejarNumeros(`Caja del día ${local.fecha}`, [
      ['total', local.total, agregado.total],
      ['sinImporte', local.sinImporte, agregado.sinImporte],
      ['imputados', local.imputados, agregado.imputados],
    ])
  }

  return {
    ...local,
    total: agregado.total,
    sinImporte: agregado.sinImporte,
    imputados: agregado.imputados,
    totalesPorMedio: agregado.totalesPorMedio,
    calculadoEn: snap.servidorCalculadoEn,
    recibidoEnEstaComputadora: snap.recibidoEn,
    frescura: frescuraActual(),
  }
}

function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return hoyLocal(d)
}
