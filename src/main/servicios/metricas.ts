// Métricas: los números que hoy la agencia calcula a mano en las pestañas SEGUROS ACT y CONTADOR de
// la hoja, más la cobranza del mes y los siniestros abiertos.
//
// Tres definiciones que conviene tener claras, porque son las que hacen que los números coincidan con
// la planilla y no con otra cosa:
//
//  1. ACTIVOS de un mes = las filas de la planilla de ese mes que no están dadas de baja. Es
//     exactamente lo que cuentan los COUNTIF de SEGUROS ACT: la pestaña del mes, una fila por póliza.
//     No se filtra por `polizas.activa` a propósito: `activa` dice cómo está la póliza HOY, y con eso
//     un mes viejo mostraría menos pólizas de las que realmente tuvo.
//
//  2. ALTAS de un mes = las que están en ese mes y no estaban en el anterior. Es la cuenta que hace
//     el contador comparando dos pestañas, y es la única que se puede hacer sobre datos importados:
//     la columna ALTA de la hoja está llena a medias y con fechas de todos los formatos. Si no hay mes
//     anterior cargado no se puede deducir nada y las altas van en cero, dicho en la pantalla.
//
//  3. BAJAS de un mes = las filas de la pestaña de BAJAS de ese mes, con su MOTIVO.
import { hoyLocal, periodoDeHoy } from '../../shared/semaforo'
import { normalizarEstadoSiniestro } from '../../shared/siniestros'
import { mismaSucursal } from '../../shared/sucursales'
import type {
  BajaPorMotivo,
  CobranzaDelMes,
  EstadisticasDeCartera,
  FilaEstadistica,
  FiltrosMetricas,
  MesDeEvolucion,
  PorcionMetrica,
  TableroMetricas,
  TotalPorMedio,
} from '../../shared/tipos'
import { db } from '../db/base'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import { catalogos, periodosDisponibles } from './cartera'
import { PAGO_QUE_CUBRE_LA_CUOTA, SUCURSAL_DEL_PAGO } from './pagos'

/** Cuántos meses mira la evolución. */
const MESES_DE_EVOLUCION = 12

const FORMATO_PERIODO = /^\d{4}-\d{2}$/

/**
 * La sucursal de una fila de la planilla: la de la propia fila si la tiene, si no la del cliente. Es
 * el mismo COALESCE que usa SELECT_PLANILLA, y tiene que serlo para que los totales cierren.
 */
const SUCURSAL_DE_LA_CUOTA = `COALESCE(NULLIF(TRIM(c.sucursal_texto), ''), cl.sucursal_texto)`

/** El mes que rinde un pago: el de la columna MES o, si no se pudo leer, el de su fecha. */
const PERIODO_DEL_PAGO = `COALESCE(p.periodo, substr(p.fecha_iso, 1, 7))`

// La sucursal de un pago se resuelve en servicios/pagos.ts, que es de donde sale la caja: si cada
// pantalla se armara la suya, el mismo pago volvería a contar en una y a faltar en la otra.

/**
 * Identidad de una fila entre un mes y el siguiente. La póliza es lo que manda; para las filas que el
 * importador no pudo enganchar a ninguna se arma una clave con lo que tienen escrito.
 */
const IDENTIDAD_DE_LA_CUOTA = `COALESCE('P' || c.poliza_id, 'X' || COALESCE(c.numero_poliza, '') || '|' || COALESCE(c.patente, '') || '|' || COALESCE(c.documento, ''))`

// La sucursal se compara con `mismaSucursal` de shared y no con el texto normalizado: el desplegable de
// arriba lo arma `catalogos().sucursales`, que pliega «AVELLANEDA» y «DOCKSUD» dentro de «Dock Sud». Si
// acá se comparara el texto pelado, elegir Dock Sud dejaría afuera esas cuotas y el tablero mostraría
// números más chicos que la planilla sin decir por qué.

function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((parte / total) * 1000) / 10
}

/** Pasa un conteo por etiqueta a porciones ordenadas de mayor a menor. */
function aPorciones(conteo: Map<string, { etiqueta: string; cantidad: number }>, total: number): PorcionMetrica[] {
  return [...conteo.values()]
    .map((fila) => ({ etiqueta: fila.etiqueta, cantidad: fila.cantidad, porcentaje: porcentaje(fila.cantidad, total) }))
    .sort((a, b) => b.cantidad - a.cantidad || a.etiqueta.localeCompare(b.etiqueta, 'es'))
}

/** Suma uno a la etiqueta, respetando cómo está escrita la primera vez que aparece. */
function sumarUno(conteo: Map<string, { etiqueta: string; cantidad: number }>, valor: string | null, vacio: string): void {
  const etiqueta = limpiar(valor) || vacio
  const clave = normalizarTexto(etiqueta)
  const previo = conteo.get(clave)
  if (previo) previo.cantidad++
  else conteo.set(clave, { etiqueta, cantidad: 1 })
}

/** El período que se va a mirar: el pedido si existe, si no el mes abierto de la cartera. */
function resolverPeriodo(pedido: string | null | undefined, disponibles: string[]): string {
  const limpio = limpiar(pedido)
  if (limpio && FORMATO_PERIODO.test(limpio)) return limpio
  return disponibles[0] ?? periodoDeHoy()
}

/** El mes anterior a uno dado ('2026-01' → '2025-12'). */
function periodoAnterior(periodo: string): string {
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(5, 7))
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Lectura de la cartera de un mes
// ---------------------------------------------------------------------------

interface CuotaDelMes {
  identidad: string
  compania: string | null
  sucursal: string | null
  cuotaMonto: number | null
  cuota: string | null
  formaPago: string | null
  pagada: boolean
}

/**
 * Las filas de la planilla de un mes, ya filtradas por sucursal. Una sola consulta por mes: todo lo
 * demás (activos, altas, pendiente) sale de acá sin volver a la base.
 */
function cuotasDelMes(periodo: string, sucursal: string): CuotaDelMes[] {
  const filas = db()
    .prepare(
      `SELECT ${IDENTIDAD_DE_LA_CUOTA} AS identidad,
              COALESCE(NULLIF(TRIM(c.compania), ''), p.compania) AS compania,
              ${SUCURSAL_DE_LA_CUOTA} AS sucursal,
              c.cuota, c.cuota_monto,
              COALESCE(NULLIF(TRIM(c.forma_pago), ''), p.forma_pago) AS forma_pago,
              (
                (c.pago IS NOT NULL AND TRIM(c.pago) <> '')
                OR ${PAGO_QUE_CUBRE_LA_CUOTA}
              ) AS pagada
         FROM cuotas_mes c
         LEFT JOIN clientes cl ON cl.id = c.cliente_id
         LEFT JOIN polizas p ON p.id = c.poliza_id
        WHERE c.periodo = ? AND c.dada_de_baja = 0`,
    )
    .all(periodo) as Array<{
    identidad: string
    compania: string | null
    sucursal: string | null
    cuota: string | null
    cuota_monto: number | null
    forma_pago: string | null
    pagada: number
  }>

  return filas
    .filter((fila) => !sucursal || mismaSucursal(fila.sucursal, sucursal))
    .map((fila) => ({
      identidad: fila.identidad,
      compania: fila.compania,
      sucursal: fila.sucursal,
      cuota: fila.cuota,
      cuotaMonto: fila.cuota_monto,
      formaPago: fila.forma_pago,
      pagada: fila.pagada === 1,
    }))
}

/** Sólo las identidades de un mes: es lo único que hace falta para contar las altas del siguiente. */
function identidadesDelMes(periodo: string, sucursal: string): Set<string> {
  return new Set(cuotasDelMes(periodo, sucursal).map((cuota) => cuota.identidad))
}

interface BajaDelMes {
  motivo: string | null
  compania: string | null
  sucursal: string | null
}

function bajasDelMes(periodo: string, sucursal: string): BajaDelMes[] {
  const filas = db()
    .prepare(
      `SELECT b.motivo, b.compania, COALESCE(NULLIF(TRIM(b.sucursal_texto), ''), cl.sucursal_texto) AS sucursal
         FROM bajas b
         LEFT JOIN clientes cl ON cl.id = b.cliente_id
        WHERE b.periodo = ?`,
    )
    .all(periodo) as BajaDelMes[]
  return filas.filter((fila) => !sucursal || mismaSucursal(fila.sucursal, sucursal))
}

interface PagoDelMes {
  compania: string | null
  sucursal: string | null
  medio: string | null
  importe: number | null
}

function pagosDelMes(periodo: string, sucursal: string): PagoDelMes[] {
  const filas = db()
    .prepare(
      `SELECT p.compania, ${SUCURSAL_DEL_PAGO} AS sucursal, p.medio, p.importe_monto AS importe
         FROM pagos p LEFT JOIN clientes cl ON cl.id = p.cliente_id
        WHERE ${PERIODO_DEL_PAGO} = ?`,
    )
    .all(periodo) as PagoDelMes[]
  return filas.filter((fila) => !sucursal || mismaSucursal(fila.sucursal, sucursal))
}

// ---------------------------------------------------------------------------
// Cobranza del mes
// ---------------------------------------------------------------------------

function totalesPorMedio(pagos: PagoDelMes[]): TotalPorMedio[] {
  const acumulado = new Map<string, TotalPorMedio>()
  for (const pago of pagos) {
    const etiqueta = limpiar(pago.medio) || '(sin especificar)'
    const clave = normalizarTexto(etiqueta)
    const previo = acumulado.get(clave) ?? { medio: etiqueta, pagos: 0, total: 0 }
    previo.pagos++
    previo.total += pago.importe ?? 0
    acumulado.set(clave, previo)
  }
  return [...acumulado.values()].sort((a, b) => b.total - a.total || a.medio.localeCompare(b.medio, 'es'))
}

function cobranzaDelMes(cuotas: CuotaDelMes[], pagos: PagoDelMes[], conNumeros: boolean): CobranzaDelMes {
  const impagas = cuotas.filter((cuota) => !cuota.pagada)
  return {
    // Lo recaudado del mes es el número de la agencia: para un empleado viaja en null y no en cero,
    // porque un cero se lee «no se cobró nada» y sería mentira.
    cobrado: conNumeros ? pagos.reduce((suma, pago) => suma + (pago.importe ?? 0), 0) : null,
    pendiente: conNumeros ? impagas.reduce((suma, cuota) => suma + (cuota.cuotaMonto ?? 0), 0) : null,
    cuotasCobradas: cuotas.length - impagas.length,
    cuotasPendientes: impagas.length,
    // Una cuota escrita como «A CONVENIR» no se puede sumar: se cuenta aparte para que la diferencia
    // entre lo pendiente y la realidad tenga explicación en la pantalla.
    sinImporte: impagas.filter((cuota) => cuota.cuotaMonto === null && limpiar(cuota.cuota) !== '').length,
    porMedio: conNumeros ? totalesPorMedio(pagos) : null,
  }
}

// ---------------------------------------------------------------------------
// Evolución de los últimos doce meses
// ---------------------------------------------------------------------------

/**
 * Los doce meses que terminan en el elegido, tomados de los que realmente tienen planilla cargada. Si
 * la agencia importó ocho meses, la evolución muestra ocho: no se inventan meses en cero.
 */
function evolucion(periodo: string, sucursal: string, disponibles: string[], conNumeros: boolean): MesDeEvolucion[] {
  const hasta = disponibles.filter((candidato) => candidato <= periodo).slice(0, MESES_DE_EVOLUCION)
  const meses = [...hasta].sort()
  const filas: MesDeEvolucion[] = []
  for (const mes of meses) {
    const cuotas = cuotasDelMes(mes, sucursal)
    const anteriores = identidadesDelMes(periodoAnterior(mes), sucursal)
    const altas = anteriores.size === 0 ? 0 : cuotas.filter((cuota) => !anteriores.has(cuota.identidad)).length
    filas.push({
      periodo: mes,
      activos: cuotas.length,
      altas,
      bajas: bajasDelMes(mes, sucursal).length,
      cobrado: conNumeros ? pagosDelMes(mes, sucursal).reduce((suma, pago) => suma + (pago.importe ?? 0), 0) : null,
    })
  }
  return filas
}

// ---------------------------------------------------------------------------
// Siniestros abiertos
// ---------------------------------------------------------------------------

/**
 * Los siniestros que todavía no están cerrados, hoy. No se filtran por mes a propósito: un siniestro
 * de marzo que sigue abierto en agosto es un problema de agosto.
 */
function siniestrosAbiertos(sucursal: string): { total: number; porCompania: PorcionMetrica[] } {
  const filas = db()
    .prepare(
      `SELECT s.compania, s.estado, COALESCE(NULLIF(TRIM(s.sucursal_texto), ''), cl.sucursal_texto) AS sucursal
         FROM siniestros s LEFT JOIN clientes cl ON cl.id = s.cliente_id`,
    )
    .all() as Array<{ compania: string | null; estado: string | null; sucursal: string | null }>

  const abiertos = filas.filter(
    (fila) => (!sucursal || mismaSucursal(fila.sucursal, sucursal)) && normalizarEstadoSiniestro(fila.estado) !== 'CERRADO',
  )
  const conteo = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const fila of abiertos) sumarUno(conteo, fila.compania, '(sin compañía)')
  return { total: abiertos.length, porCompania: aPorciones(conteo, abiertos.length) }
}

// ---------------------------------------------------------------------------
// El tablero
// ---------------------------------------------------------------------------

/**
 * El tablero. `conNumeros` en false deja afuera todo lo que sea plata agregada de la agencia: es lo
 * que ve un empleado. Se decide en el proceso principal y no en la pantalla a propósito —el dato ni
 * siquiera viaja—, porque una pantalla que oculta un número que igual llegó no oculta nada.
 */
export function tableroDeMetricas(filtros: FiltrosMetricas, conNumeros: boolean): TableroMetricas {
  const disponibles = periodosDisponibles().map((p) => p.periodo)
  const periodo = resolverPeriodo(filtros?.periodo, disponibles)
  const sucursales = catalogos().sucursales
  const sucursal = sucursales.find((s) => mismaSucursal(s, filtros?.sucursal ?? '')) ?? ''

  const cuotas = cuotasDelMes(periodo, sucursal)
  const anterior = periodoAnterior(periodo)
  const identidadesAnteriores = identidadesDelMes(anterior, sucursal)
  const hayMesAnterior = identidadesAnteriores.size > 0

  const porCompania = new Map<string, { etiqueta: string; cantidad: number }>()
  const porSucursal = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const cuota of cuotas) {
    sumarUno(porCompania, cuota.compania, '(sin compañía)')
    sumarUno(porSucursal, cuota.sucursal, '(sin sucursal)')
  }

  const bajas = bajasDelMes(periodo, sucursal)
  const motivos = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const baja of bajas) sumarUno(motivos, baja.motivo, '(sin motivo)')
  const bajasPorMotivo: BajaPorMotivo[] = [...motivos.values()]
    .map((fila) => ({ motivo: fila.etiqueta, cantidad: fila.cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo, 'es'))

  const siniestros = siniestrosAbiertos(sucursal)

  return {
    periodo,
    periodos: disponibles.includes(periodo) ? disponibles : [periodo, ...disponibles],
    sucursal,
    sucursales,

    activos: cuotas.length,
    activosPorCompania: aPorciones(porCompania, cuotas.length),
    activosPorSucursal: aPorciones(porSucursal, cuotas.length),

    altas: hayMesAnterior ? cuotas.filter((cuota) => !identidadesAnteriores.has(cuota.identidad)).length : 0,
    bajas: bajas.length,
    bajasPorMotivo,
    hayMesAnterior,

    evolucion: evolucion(periodo, sucursal, disponibles, conNumeros),
    cobranza: cobranzaDelMes(cuotas, pagosDelMes(periodo, sucursal), conNumeros),

    siniestrosAbiertos: siniestros.total,
    siniestrosPorCompania: siniestros.porCompania,

    hoy: hoyLocal(),
  }
}

// ---------------------------------------------------------------------------
// La versión tabular (Cartera → Estadísticas)
// ---------------------------------------------------------------------------

/**
 * Acumulador de una fila de la tabla mientras se recorren cuotas, bajas y pagos. Acá `cobrado` es
 * siempre un número: la suma se hace igual para todos y recién al armar la fila que sale se decide si
 * viaja o no. Sumar `number | null` obligaría a un `?? 0` en cada paso, y ese cero terminaría
 * confundiéndose con un cobro real.
 */
interface Acumulador extends Omit<FilaEstadistica, 'cobrado'> {
  clave: string
  cobrado: number
}

function tomar(mapa: Map<string, Acumulador>, valor: string | null, vacio: string): Acumulador {
  const etiqueta = limpiar(valor) || vacio
  const clave = normalizarTexto(etiqueta)
  const previo = mapa.get(clave)
  if (previo) return previo
  const nuevo: Acumulador = { clave, etiqueta, activos: 0, altas: 0, bajas: 0, pagos: 0, cobrado: 0 }
  mapa.set(clave, nuevo)
  return nuevo
}

function ordenar(mapa: Map<string, Acumulador>, conNumeros: boolean): FilaEstadistica[] {
  return [...mapa.values()]
    .map(({ clave: _clave, cobrado, ...fila }) => ({ ...fila, cobrado: conNumeros ? cobrado : null }))
    .sort((a, b) => b.activos - a.activos || a.etiqueta.localeCompare(b.etiqueta, 'es'))
}

/**
 * Lo mismo que el tablero pero en tabla, que es como se compara contra la planilla: se pone la
 * pantalla al lado de la hoja y los números tienen que dar.
 */
export function estadisticasDeCartera(
  periodoPedido: string | null,
  sucursalPedida: string,
  conNumeros: boolean,
): EstadisticasDeCartera {
  const disponibles = periodosDisponibles().map((p) => p.periodo)
  const periodo = resolverPeriodo(periodoPedido, disponibles)
  const sucursales = catalogos().sucursales
  const sucursal = sucursales.find((s) => mismaSucursal(s, sucursalPedida)) ?? ''

  const cuotas = cuotasDelMes(periodo, sucursal)
  const identidadesAnteriores = identidadesDelMes(periodoAnterior(periodo), sucursal)
  const hayMesAnterior = identidadesAnteriores.size > 0

  const companias = new Map<string, Acumulador>()
  const sucursalesMapa = new Map<string, Acumulador>()
  for (const cuota of cuotas) {
    const esAlta = hayMesAnterior && !identidadesAnteriores.has(cuota.identidad)
    for (const fila of [tomar(companias, cuota.compania, '(sin compañía)'), tomar(sucursalesMapa, cuota.sucursal, '(sin sucursal)')]) {
      fila.activos++
      if (esAlta) fila.altas++
    }
  }
  for (const baja of bajasDelMes(periodo, sucursal)) {
    tomar(companias, baja.compania, '(sin compañía)').bajas++
    tomar(sucursalesMapa, baja.sucursal, '(sin sucursal)').bajas++
  }
  for (const pago of pagosDelMes(periodo, sucursal)) {
    for (const fila of [tomar(companias, pago.compania, '(sin compañía)'), tomar(sucursalesMapa, pago.sucursal, '(sin sucursal)')]) {
      fila.pagos++
      fila.cobrado += pago.importe ?? 0
    }
  }

  const porCompania = ordenar(companias, conNumeros)
  // El total sale del acumulador y no de las filas ya recortadas: si no, con los números ocultos el
  // total sumaría nulls y daría cero.
  const totalCobrado = [...companias.values()].reduce((suma, fila) => suma + fila.cobrado, 0)
  return {
    periodo,
    periodos: disponibles.includes(periodo) ? disponibles : [periodo, ...disponibles],
    sucursal,
    sucursales,
    porCompania,
    porSucursal: ordenar(sucursalesMapa, conNumeros),
    // El total sale de las filas por compañía: cada cuota, baja y pago cae en una sola.
    totales: {
      etiqueta: 'Total',
      activos: porCompania.reduce((suma, fila) => suma + fila.activos, 0),
      altas: porCompania.reduce((suma, fila) => suma + fila.altas, 0),
      bajas: porCompania.reduce((suma, fila) => suma + fila.bajas, 0),
      pagos: porCompania.reduce((suma, fila) => suma + fila.pagos, 0),
      cobrado: conNumeros ? totalCobrado : null,
    },
    hayMesAnterior,
    hoy: hoyLocal(),
  }
}
