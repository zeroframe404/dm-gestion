// El tablero de Métricas y la tabla de Cartera → Estadísticas, armados a partir del payload que YA
// calculó el servidor (clave 'metricas' del caché, ver servicios/metricasCache.ts) en vez de correr SQL
// contra la copia local de esta PC — la migración que le faltaba al módulo Métricas desde que el Podio
// de Inicio se mudó al servidor en la 13.2 (ver metricas.ts:podioDelMes, "SUPERADA").
//
// POR QUÉ ACÁ Y NO EN metricas.ts. metricas.ts sigue teniendo el algoritmo de referencia
// (`tableroDeMetricasLocal`/`estadisticasDeCarteraLocal`): este archivo es la otra mitad, la que arma
// la MISMA forma de datos a partir de un payload ajeno en vez de una consulta propia. Separarlos deja
// clarísimo, con sólo mirar los imports de cada uno, cuál lee la base y cuál no.
//
// CÓMO SE RECORTA UN PAYLOAD QUE CUBRE TODOS LOS PERÍODOS. El servidor calcula una sola vez una grilla
// cruzada (sucursal × compañía) por cada período que conoce, no una respuesta por cada combinación de
// filtros que alguien pueda pedir (ver metricas.calculo.ts del lado del servidor). Elegir el período
// pedido y sumar sólo las sucursales elegidas es trabajo de JS puro sobre esa grilla, acá abajo — nunca
// un pedido nuevo al servidor: cambiar el desplegable de mes o de sucursal es instantáneo.
//
// EL COTEJO. Mientras dura la migración, cada handler de ipc.ts corre TAMBIÉN el cálculo local de
// siempre (con throttle, para no duplicar el costo en cada tecla) y compara los números importantes; si
// no coinciden, se anota con `console.error` —nunca se le muestra al usuario— para que quede en el log
// del proceso principal. Pasada la ventana de transición sin sorpresas, una limpieza aparte saca este
// cotejo y el algoritmo local deja de correr en cada pedido.
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { mismaSucursal } from '../../shared/sucursales'
import type {
  BajaPorMotivo,
  CobranzaDelMes,
  DetalleDeAltas,
  EstadisticasDeCartera,
  FilaEstadistica,
  FiltrosMetricas,
  MesDeEvolucion,
  PorcionMetrica,
  ResumenDeCartera,
  TableroMetricas,
  TotalPorMedio,
} from '../../shared/tipos'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import { catalogos } from './cartera'
import { cotejarNumeros, frescuraActual, tocaCotejar } from './cotejoDeMetricas'
import { leerSnapshotDeMetrica } from './metricasCache'
import { altasDelMes, claveDeLaFilaDeSucursal, estadisticasDeCarteraLocal, resumenDeCartera, tableroDeMetricasLocal } from './metricas'

const FORMATO_PERIODO = /^\d{4}-\d{2}$/
const MESES_DE_EVOLUCION = 12

// ---------------------------------------------------------------------------
// La forma del payload cacheado (espejo de `MetricasPayload` en
// Seguros_Daniel_Martinez/server/src/modules/dmg/metricas.calculo.ts — no hay paquete compartido entre
// los dos repos, así que esto se vendorea a mano, igual que sucursales/normalizar del lado del servidor).
// ---------------------------------------------------------------------------

interface CeldaDeMetricasCache {
  sucursal: string
  compania: string
  activos: number
  altas: number
  bajas: number
  cuotasCobradas: number
  cuotasPendientes: number
  sinImporte: number
  pendiente: number
  pagos: number
  cobrado: number
}

interface MotivoDeBajaCache {
  sucursal: string
  motivo: string
  cantidad: number
}

interface MedioDePagoCache {
  sucursal: string
  medio: string
  pagos: number
  total: number
}

interface PeriodoDeMetricasCache {
  hayMesAnterior: boolean
  celdas: CeldaDeMetricasCache[]
  bajasPorMotivo: MotivoDeBajaCache[]
  pagosPorMedio: MedioDePagoCache[]
}

interface SiniestroCache {
  sucursal: string
  compania: string
  cantidad: number
}

export interface MetricasPayloadCache {
  hoy: string
  periodos: string[]
  porPeriodo: Record<string, PeriodoDeMetricasCache>
  siniestros: SiniestroCache[]
}

/** Lo mínimo para confiar en el payload guardado: que sea la forma que este archivo espera, no
 *  cualquier otra cosa que haya quedado de una versión vieja del caché. */
function esPayloadDeMetricas(valor: unknown): valor is MetricasPayloadCache {
  if (!valor || typeof valor !== 'object') return false
  const posible = valor as Partial<MetricasPayloadCache>
  return Array.isArray(posible.periodos) && typeof posible.porPeriodo === 'object' && posible.porPeriodo !== null
}

// ---------------------------------------------------------------------------
// Piezas comunes de agrupación
// ---------------------------------------------------------------------------

/** Con qué período trabajar: el pedido, si tiene forma de período, TAL CUAL —esté o no en la lista—, y
 *  si no el más nuevo. Igual criterio que `resolverPeriodo` de metricas.ts (que tampoco chequea contra
 *  `disponibles`), sólo que acá "el más nuevo" sale de los períodos que el SERVIDOR conoce (ascendente)
 *  y no de los que esta PC importó. Que no chequee membresía es a propósito: un período válido pero que
 *  el payload no tiene (`payload.porPeriodo[periodo]` da `undefined`) hace que `tableroDesdeCache`/
 *  `estadisticasDesdeCache` devuelvan `null` más abajo, y el llamador cae al cálculo local — devolver
 *  acá el período MÁS NUEVO en su lugar mostraría los números de otro mes con la etiqueta del pedido. */
function resolverPeriodoDesdeCache(pedido: string | null | undefined, periodosAscendentes: string[]): string | null {
  const limpio = (pedido ?? '').trim()
  if (limpio && FORMATO_PERIODO.test(limpio)) return limpio
  return periodosAscendentes[periodosAscendentes.length - 1] ?? null
}

function sucursalesElegidas(pedidas: string[] | undefined, disponibles: string[]): string[] {
  return listaDeFiltro(pedidas).flatMap((pedida) => {
    const encontrada = disponibles.find((s) => mismaSucursal(s, pedida))
    return encontrada ? [encontrada] : []
  })
}

/** Acumula por etiqueta, plegando variantes de mayúsculas/tildes — mismo criterio que `sumarUno` en
 *  metricas.ts, sólo que acá la etiqueta ya viene resuelta (nunca vacía: el servidor ya puso
 *  "(sin sucursal)"/"(sin compañía)"/etc. cuando hacía falta). */
function acumular(mapa: Map<string, { etiqueta: string; cantidad: number }>, etiqueta: string, cantidad: number): void {
  const clave = normalizarTexto(etiqueta)
  const previo = mapa.get(clave)
  if (previo) previo.cantidad += cantidad
  else mapa.set(clave, { etiqueta, cantidad })
}

function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((parte / total) * 1000) / 10
}

function aPorciones(mapa: Map<string, { etiqueta: string; cantidad: number }>, total: number): PorcionMetrica[] {
  return [...mapa.values()]
    .map((fila) => ({ etiqueta: fila.etiqueta, cantidad: fila.cantidad, porcentaje: porcentaje(fila.cantidad, total) }))
    .sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta, 'es'))
}

// ---------------------------------------------------------------------------
// El tablero (Métricas)
// ---------------------------------------------------------------------------

function evolucionDesdeCache(payload: MetricasPayloadCache, periodo: string, sucursales: string[], conNumeros: boolean): MesDeEvolucion[] {
  const meses = payload.periodos.filter((p) => p <= periodo).slice(-MESES_DE_EVOLUCION)
  return meses.map((mes): MesDeEvolucion => {
    const datos = payload.porPeriodo[mes]
    if (!datos) return { periodo: mes, activos: 0, altas: null, bajas: 0, cobrado: conNumeros ? 0 : null }
    const celdas = datos.celdas.filter((celda) => coincideAlguno(sucursales, celda.sucursal, mismaSucursal))
    return {
      periodo: mes,
      activos: celdas.reduce((suma, c) => suma + c.activos, 0),
      altas: datos.hayMesAnterior ? celdas.reduce((suma, c) => suma + c.altas, 0) : null,
      bajas: celdas.reduce((suma, c) => suma + c.bajas, 0),
      cobrado: conNumeros ? celdas.reduce((suma, c) => suma + c.cobrado, 0) : null,
    }
  })
}

/** Arma `TableroMetricas` recortando el payload cacheado al período y las sucursales pedidas. `null`
 *  cuando el payload no alcanza (todavía sin ningún período calculado, o el período pedido no está) —
 *  el llamador cae al cálculo local en ese caso. */
export function tableroDesdeCache(payload: MetricasPayloadCache, filtros: FiltrosMetricas, conNumeros: boolean): TableroMetricas | null {
  const periodo = resolverPeriodoDesdeCache(filtros?.periodo, payload.periodos)
  if (periodo === null) return null
  const datosPeriodo = payload.porPeriodo[periodo]
  if (!datosPeriodo) return null

  const disponiblesDeSucursal = catalogos().sucursales
  const sucursales = sucursalesElegidas(filtros?.sucursales, disponiblesDeSucursal)
  const celdas = datosPeriodo.celdas.filter((celda) => coincideAlguno(sucursales, celda.sucursal, mismaSucursal))

  const activos = celdas.reduce((suma, c) => suma + c.activos, 0)
  const altas = datosPeriodo.hayMesAnterior ? celdas.reduce((suma, c) => suma + c.altas, 0) : null
  const bajas = celdas.reduce((suma, c) => suma + c.bajas, 0)

  const porCompania = new Map<string, { etiqueta: string; cantidad: number }>()
  const porSucursal = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const celda of celdas) {
    acumular(porCompania, celda.compania, celda.activos)
    acumular(porSucursal, celda.sucursal, celda.activos)
  }

  const bajasPorMotivo = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const fila of datosPeriodo.bajasPorMotivo) {
    if (!coincideAlguno(sucursales, fila.sucursal, mismaSucursal)) continue
    acumular(bajasPorMotivo, fila.motivo, fila.cantidad)
  }
  const bajasPorMotivoOrdenadas: BajaPorMotivo[] = [...bajasPorMotivo.values()]
    .map((fila) => ({ motivo: fila.etiqueta, cantidad: fila.cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo, 'es'))

  const porMedio = new Map<string, TotalPorMedio>()
  for (const fila of datosPeriodo.pagosPorMedio) {
    if (!coincideAlguno(sucursales, fila.sucursal, mismaSucursal)) continue
    const clave = normalizarTexto(fila.medio)
    const previo = porMedio.get(clave)
    if (previo) {
      previo.pagos += fila.pagos
      previo.total += fila.total
    } else {
      porMedio.set(clave, { medio: fila.medio, pagos: fila.pagos, total: fila.total })
    }
  }

  const cobranza: CobranzaDelMes = {
    cobrado: conNumeros ? celdas.reduce((suma, c) => suma + c.cobrado, 0) : null,
    pendiente: conNumeros ? celdas.reduce((suma, c) => suma + c.pendiente, 0) : null,
    cuotasCobradas: celdas.reduce((suma, c) => suma + c.cuotasCobradas, 0),
    cuotasPendientes: celdas.reduce((suma, c) => suma + c.cuotasPendientes, 0),
    sinImporte: celdas.reduce((suma, c) => suma + c.sinImporte, 0),
    porMedio: conNumeros ? [...porMedio.values()].sort((a, b) => b.total - a.total || a.medio.localeCompare(b.medio, 'es')) : null,
  }

  const siniestrosFiltrados = payload.siniestros.filter((s) => coincideAlguno(sucursales, s.sucursal, mismaSucursal))
  const siniestrosAbiertos = siniestrosFiltrados.reduce((suma, s) => suma + s.cantidad, 0)
  const siniestrosPorCompania = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const s of siniestrosFiltrados) acumular(siniestrosPorCompania, s.compania, s.cantidad)

  return {
    periodo,
    periodos: payload.periodos,
    sucursalesElegidas: sucursales,
    sucursales: disponiblesDeSucursal,
    activos,
    activosPorCompania: aPorciones(porCompania, activos),
    activosPorSucursal: aPorciones(porSucursal, activos),
    altas,
    bajas,
    bajasPorMotivo: bajasPorMotivoOrdenadas,
    hayMesAnterior: datosPeriodo.hayMesAnterior,
    evolucion: evolucionDesdeCache(payload, periodo, sucursales, conNumeros),
    cobranza,
    siniestrosAbiertos,
    siniestrosPorCompania: aPorciones(siniestrosPorCompania, siniestrosAbiertos),
    hoy: payload.hoy,
  }
}

// ---------------------------------------------------------------------------
// La tabla (Cartera → Estadísticas)
// ---------------------------------------------------------------------------

interface AcumuladorDeFila {
  etiqueta: string
  activos: number
  altas: number
  bajas: number
  pagos: number
  cobrado: number
}

function tomarFila(mapa: Map<string, AcumuladorDeFila>, etiqueta: string): AcumuladorDeFila {
  const clave = normalizarTexto(etiqueta)
  const previa = mapa.get(clave)
  if (previa) return previa
  const nueva: AcumuladorDeFila = { etiqueta, activos: 0, altas: 0, bajas: 0, pagos: 0, cobrado: 0 }
  mapa.set(clave, nueva)
  return nueva
}

function ordenarFilas(mapa: Map<string, AcumuladorDeFila>, conNumeros: boolean, hayMesAnterior: boolean): FilaEstadistica[] {
  return [...mapa.values()]
    .map(({ etiqueta, activos, altas, bajas, pagos, cobrado }) => ({
      etiqueta,
      activos,
      bajas,
      pagos,
      altas: hayMesAnterior ? altas : null,
      cobrado: conNumeros ? cobrado : null,
    }))
    .sort((a, b) => b.activos - a.activos || a.etiqueta.localeCompare(b.etiqueta, 'es'))
}

/** Arma `EstadisticasDeCartera` recortando el payload cacheado, igual que `tableroDesdeCache`.
 *  `resumenCartera` no sale de acá (el servidor no lo puede calcular, ver la nota de
 *  `estadisticasDeCarteraLocal` en metricas.ts): lo trae el llamador y se pega tal cual. */
export function estadisticasDesdeCache(
  payload: MetricasPayloadCache,
  periodoPedido: string | null,
  sucursalesPedidas: string[],
  conNumeros: boolean,
  resumenCartera: ResumenDeCartera,
): EstadisticasDeCartera | null {
  const periodo = resolverPeriodoDesdeCache(periodoPedido, payload.periodos)
  if (periodo === null) return null
  const datosPeriodo = payload.porPeriodo[periodo]
  if (!datosPeriodo) return null

  const disponiblesDeSucursal = catalogos().sucursales
  const sucursales = sucursalesElegidas(sucursalesPedidas, disponiblesDeSucursal)
  const celdas = datosPeriodo.celdas.filter((celda) => coincideAlguno(sucursales, celda.sucursal, mismaSucursal))

  const companias = new Map<string, AcumuladorDeFila>()
  const sucursalesMapa = new Map<string, AcumuladorDeFila>()
  for (const celda of celdas) {
    for (const fila of [tomarFila(companias, celda.compania), tomarFila(sucursalesMapa, celda.sucursal)]) {
      fila.activos += celda.activos
      fila.altas += celda.altas
      fila.bajas += celda.bajas
      fila.pagos += celda.pagos
      fila.cobrado += celda.cobrado
    }
  }

  const porCompania = ordenarFilas(companias, conNumeros, datosPeriodo.hayMesAnterior)
  // El total sale de las filas por compañía, no del acumulador: cada cuota, baja y pago cae en una sola
  // fila de compañía, así que sumarlas da el total sin contar nada dos veces (mismo criterio que
  // `estadisticasDeCarteraLocal`).
  return {
    periodo,
    periodos: payload.periodos,
    sucursalesElegidas: sucursales,
    sucursales: disponiblesDeSucursal,
    porCompania,
    porSucursal: ordenarFilas(sucursalesMapa, conNumeros, datosPeriodo.hayMesAnterior),
    totales: {
      etiqueta: 'Total',
      activos: porCompania.reduce((suma, fila) => suma + fila.activos, 0),
      altas: datosPeriodo.hayMesAnterior ? porCompania.reduce((suma, fila) => suma + (fila.altas ?? 0), 0) : null,
      bajas: porCompania.reduce((suma, fila) => suma + fila.bajas, 0),
      pagos: porCompania.reduce((suma, fila) => suma + fila.pagos, 0),
      cobrado: conNumeros ? porCompania.reduce((suma, fila) => suma + (fila.cobrado ?? 0), 0) : null,
    },
    hayMesAnterior: datosPeriodo.hayMesAnterior,
    resumenCartera,
    hoy: payload.hoy,
  }
}

// ---------------------------------------------------------------------------
// Orquestación: caché primero, cálculo local como respaldo y como cotejo
// ---------------------------------------------------------------------------

/** `metricas:tablero`: usa el payload del servidor cuando lo tiene, cae al cálculo local si no. */
export function tableroConCache(filtros: FiltrosMetricas, conNumeros: boolean): TableroMetricas {
  const snap = leerSnapshotDeMetrica('metricas')
  const payload = snap && esPayloadDeMetricas(snap.payload) ? snap.payload : null
  const desdeCache = payload ? tableroDesdeCache(payload, filtros, conNumeros) : null

  if (!snap || !desdeCache) return tableroDeMetricasLocal(filtros, conNumeros)

  if (tocaCotejar(`tablero:${desdeCache.periodo}:${(filtros?.sucursales ?? []).slice().sort().join(',')}`)) {
    try {
      const local = tableroDeMetricasLocal(filtros, conNumeros)
      cotejarNumeros(`Métricas ${desdeCache.periodo}`, [
        ['activos', local.activos, desdeCache.activos],
        ['altas', local.altas, desdeCache.altas],
        ['bajas', local.bajas, desdeCache.bajas],
        ['cobrado', local.cobranza.cobrado, desdeCache.cobranza.cobrado],
        ['pendiente', local.cobranza.pendiente, desdeCache.cobranza.pendiente],
        ['siniestrosAbiertos', local.siniestrosAbiertos, desdeCache.siniestrosAbiertos],
      ])
    } catch (error) {
      console.error('[métricas] no se pudo cotejar el tablero contra el cálculo local:', error instanceof Error ? error.message : error)
    }
  }

  return { ...desdeCache, calculadoEn: snap.servidorCalculadoEn, recibidoEnEstaComputadora: snap.recibidoEn, frescura: frescuraActual() }
}

/** `metricas:estadisticas`: mismo criterio que `tableroConCache`, más el `resumenCartera` que siempre
 *  sale del cálculo local (nunca del servidor, ver la nota de `estadisticasDesdeCache`). */
export function estadisticasConCache(periodoPedido: string | null, sucursalesPedidas: string[], conNumeros: boolean): EstadisticasDeCartera {
  const snap = leerSnapshotDeMetrica('metricas')
  const payload = snap && esPayloadDeMetricas(snap.payload) ? snap.payload : null
  const resumenCartera = resumenDeCartera()
  const desdeCache = payload ? estadisticasDesdeCache(payload, periodoPedido, sucursalesPedidas, conNumeros, resumenCartera) : null

  if (!snap || !desdeCache) return estadisticasDeCarteraLocal(periodoPedido, sucursalesPedidas, conNumeros)

  if (tocaCotejar(`estadisticas:${desdeCache.periodo}:${sucursalesPedidas.slice().sort().join(',')}`)) {
    try {
      const local = estadisticasDeCarteraLocal(periodoPedido, sucursalesPedidas, conNumeros)
      cotejarNumeros(`Estadísticas ${desdeCache.periodo}`, [
        ['activos', local.totales.activos, desdeCache.totales.activos],
        ['altas', local.totales.altas, desdeCache.totales.altas],
        ['bajas', local.totales.bajas, desdeCache.totales.bajas],
        ['pagos', local.totales.pagos, desdeCache.totales.pagos],
        ['cobrado', local.totales.cobrado, desdeCache.totales.cobrado],
      ])
    } catch (error) {
      console.error('[métricas] no se pudo cotejar las estadísticas contra el cálculo local:', error instanceof Error ? error.message : error)
    }
  }

  return { ...desdeCache, calculadoEn: snap.servidorCalculadoEn, recibidoEnEstaComputadora: snap.recibidoEn, frescura: frescuraActual() }
}

// ---------------------------------------------------------------------------
// El detalle del podio (qué pólizas son las altas)
// ---------------------------------------------------------------------------

interface FilaDeAltaCache {
  cliente: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  sucursal: string | null
}

export interface AltasPayloadCache {
  periodo: string
  hayMesAnterior: boolean
  filas: FilaDeAltaCache[]
}

function esPayloadDeAltas(valor: unknown): valor is AltasPayloadCache {
  if (!valor || typeof valor !== 'object') return false
  const posible = valor as Partial<AltasPayloadCache>
  return typeof posible.periodo === 'string' && Array.isArray(posible.filas)
}

/**
 * Arma `DetalleDeAltas` recortando el payload cacheado —que trae TODA la agencia, como el podio— a la
 * sucursal pedida. `null` cuando el payload no alcanza: el período que calculó el servidor no es el
 * pedido (el snapshot llegó de un mes que ya no es el actual, o el pedido no tiene forma de período), y
 * ahí el llamador cae al cálculo local en vez de mostrar el detalle de otro mes con la etiqueta de éste.
 */
export function altasDesdeCache(payload: AltasPayloadCache, periodoPedido: string | null, sucursalPedida: string | null): DetalleDeAltas | null {
  const periodoLimpio = (periodoPedido ?? '').trim()
  if (periodoLimpio && periodoLimpio !== payload.periodo) return null

  const sucursal = limpiar(sucursalPedida) || null
  if (!payload.hayMesAnterior) return { periodo: payload.periodo, sucursal, hayMesAnterior: false, filas: [] }

  const buscada = sucursal === null ? null : claveDeLaFilaDeSucursal(sucursal)
  return {
    periodo: payload.periodo,
    sucursal,
    hayMesAnterior: true,
    filas: payload.filas.filter((fila) => buscada === null || claveDeLaFilaDeSucursal(fila.sucursal) === buscada),
  }
}

/**
 * `metricas:altas`: usa el mismo payload del servidor que ya arma el podio (misma clave 'altas' del
 * caché) en vez de recorrer la copia SQLite de esta PC (`altasDelMes`, en metricas.ts). Es la mitad que
 * le faltaba a la migración de Inicio (13.2): la tarjeta del podio ya venía del servidor, pero el
 * detalle seguía saliendo de la base local, así que las dos cuentas podían mostrar números distintos
 * —justo lo que el propio diálogo (`DetalleDelPodio` en Inicio.tsx) le avisa al usuario cuando pasa— sin
 * que ninguna de las dos estuviera realmente "mal": eran dos cálculos sobre datos distintos.
 */
export function altasConCache(periodoPedido: string | null, sucursalPedida: string | null): DetalleDeAltas {
  const snap = leerSnapshotDeMetrica('altas')
  const payload = snap && esPayloadDeAltas(snap.payload) ? snap.payload : null
  const desdeCache = payload ? altasDesdeCache(payload, periodoPedido, sucursalPedida) : null

  if (!snap || !desdeCache) return altasDelMes(periodoPedido, sucursalPedida)

  if (tocaCotejar(`altas:${desdeCache.periodo}:${sucursalPedida ?? ''}`)) {
    try {
      const local = altasDelMes(periodoPedido, sucursalPedida)
      cotejarNumeros(`Altas ${desdeCache.periodo}${sucursalPedida ? ` · ${sucursalPedida}` : ''}`, [['filas', local.filas.length, desdeCache.filas.length]])
    } catch (error) {
      console.error('[métricas] no se pudo cotejar el detalle de altas contra el cálculo local:', error instanceof Error ? error.message : error)
    }
  }

  return desdeCache
}
