// Métricas: los números que hoy la agencia calcula a mano en las pestañas SEGUROS ACT y CONTADOR de
// la hoja, más la cobranza del mes y los siniestros abiertos.
//
// Tres definiciones que conviene tener claras, porque son las que hacen que los números coincidan con
// la planilla y no con otra cosa:
//
//  1. ACTIVOS de un mes = las PÓLIZAS de la planilla de ese mes que no están dadas de baja. Es lo que
//     cuentan los COUNTIF de SEGUROS ACT: la pestaña del mes, una fila por póliza. No se filtra por
//     `polizas.activa` a propósito: `activa` dice cómo está la póliza HOY, y con eso un mes viejo
//     mostraría menos pólizas de las que realmente tuvo. Y se cuenta UNA vez por póliza (12.6): si la
//     planilla trae la misma póliza en dos renglones —lo que dejaban los duplicados de la
//     sincronización—, el tablero no la cuenta dos veces mientras la reparación la acomoda.
//
//  2. ALTAS de un mes = las que están en ese mes y no estaban en el anterior. Es la cuenta que hace
//     el contador comparando dos pestañas, y es la única que se puede hacer sobre datos importados:
//     la columna ALTA de la hoja está llena a medias y con fechas de todos los formatos. Si no hay mes
//     anterior cargado no se puede deducir nada y las altas van en null —un guion en la pantalla—,
//     nunca en cero: un cero al lado de veinte bajas se lee «se fueron veinte y no entró nadie».
//     Y una RENOVACIÓN NO ES UN ALTA (13.0.1): el cliente ya estaba, sigue estando y la cartera no
//     creció. Es la misma distinción que hace el Excel de pólizas al separar RENOVADA de DADA DE
//     BAJA, sólo que del otro lado: la renovada no es cartera perdida, y tampoco es cartera nueva.
//
//  3. BAJAS de un mes = las pólizas de la pestaña de BAJAS de ese mes, con su MOTIVO, también una vez
//     por póliza.
import { hoyLocal, periodoDeHoy } from '../../shared/semaforo'
import { normalizarEstadoSiniestro } from '../../shared/siniestros'
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { mismaSucursal } from '../../shared/sucursales'
import type {
  BajaPorMotivo,
  CobranzaDelMes,
  EstadisticasDeCartera,
  FilaEstadistica,
  FiltrosMetricas,
  MesDeEvolucion,
  PodioMensual,
  PorcionMetrica,
  TableroMetricas,
  TotalPorMedio,
} from '../../shared/tipos'
import { db } from '../db/base'
import { limpiar, normalizarDocumento, normalizarNumeroPoliza, normalizarPatente, normalizarTexto } from '../importacion/normalizar'
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

/** Lo mínimo de una fila de la planilla para reconocerla: su póliza, si la tiene, y lo que tiene escrito. */
interface FilaReconocible {
  clave: string | null
  numero_poliza: string | null
  patente: string | null
  documento: string | null
}

/**
 * Lo que tiene escrito una fila que el importador no pudo enganchar a ninguna póliza, que es lo único
 * que queda para reconocerla. Va NORMALIZADO —el mismo `normalizarPatente` que usa el resto de la
 * aplicación— porque la hoja la escriben cinco personas: «AB 123 CD» y «AB123CD» son la misma patente
 * y «12.345.678» el mismo DNI, y comparando el texto pelado el mismo auto cambiaba de nombre de un mes
 * al otro y entraba como alta.
 */
function claveEscrita(fila: FilaReconocible): string {
  return `X:${normalizarNumeroPoliza(fila.numero_poliza)}|${normalizarPatente(fila.patente)}|${normalizarDocumento(fila.documento)}`
}

/**
 * Identidad de una fila DENTRO de su mes: es la que decide qué renglones son el mismo y se cuentan una
 * sola vez (12.6). La póliza es lo que manda, por su CLAVE («POL:<cía>|<número>», que sale de la
 * planilla y es la misma en todas las computadoras) y no por su id local, que es distinto en cada base.
 */
function identidadDeLaCuota(fila: FilaReconocible): string {
  return fila.clave === null ? claveEscrita(fila) : `P:${fila.clave}`
}

/** La misma identidad para una baja: por la clave de su póliza, si la tiene, y si no por su renglón. */
const IDENTIDAD_DE_LA_BAJA = `COALESCE('P:' || p.clave, 'B:' || b.fila_id)`

/**
 * La LÍNEA de cartera de cada póliza: el nombre con el que se la reconoce de un mes al otro AUNQUE SE
 * HAYA RENOVADO en el medio. Devuelve, para cada `polizas.id`, la clave de la primera póliza de su
 * cadena de renovaciones.
 *
 * Hace falta porque renovar no actualiza la póliza: crea una NUEVA que apunta a la anterior por
 * `poliza_anterior_id` y, cuando la compañía deja el mismo número —que es lo normal—, hasta le saca la
 * clave a la vieja, que pasa a ser «ANTERIOR:…» (ver `clavesDeLaRenovacion` en renovaciones.ts). Con la
 * identidad pelada, entonces, TODA renovación cambiaba de clave entre un mes y el siguiente y entraba
 * como alta: el podio le contaba a Dock Sud —la sucursal más grande y la que más renueva— más de cien
 * altas en un mes en el que no había entrado casi nadie, y al lado veinte bajas. Una renovación no es
 * cartera nueva: es la misma línea que sigue.
 */
function lineasDeRenovacion(): Map<number, string> {
  const filas = db()
    .prepare('SELECT id, clave, poliza_anterior_id AS anterior FROM polizas')
    .all() as Array<{ id: number; clave: string; anterior: number | null }>
  const porId = new Map(filas.map((fila) => [fila.id, fila]))
  const lineas = new Map<number, string>()
  for (const fila of filas) {
    // Se sube por la cadena hasta la primera. `vistas` no es prolijidad: una fusión de duplicados mal
    // hecha puede dejar una cadena que se muerde la cola, y sin freno esto no terminaría nunca y la
    // pantalla de Inicio quedaría colgada para todos.
    const camino: number[] = []
    const vistas = new Set<number>()
    let actual: { id: number; clave: string; anterior: number | null } | undefined = fila
    let clave = fila.clave
    while (actual && !vistas.has(actual.id)) {
      const resuelta = lineas.get(actual.id)
      if (resuelta !== undefined) {
        clave = resuelta
        break
      }
      vistas.add(actual.id)
      camino.push(actual.id)
      clave = actual.clave
      actual = actual.anterior === null ? undefined : porId.get(actual.anterior)
    }
    for (const id of camino) lineas.set(id, clave)
  }
  return lineas
}

/**
 * El contador de altas de un mes: se le pasan las líneas que estaban el mes anterior y va tachando.
 *
 * Se cuenta contra un CONTEO y no contra un conjunto porque una línea puede tener dos filas vivas a la
 * vez: renovar eligiendo «la anterior sigue activa» deja las dos pólizas en la planilla, y esa segunda
 * fila sí es una fila más en la cartera. Así la primera fila de una línea que ya estaba no es alta —es
 * la misma póliza, o su renovación— y la segunda sí. Las filas llegan siempre en el mismo orden (ver el
 * ORDER BY de `cuotasDelMes`), así que cuál de las dos queda como alta no cambia de una corrida a otra.
 */
function contadorDeAltas(anteriores: Map<string, number>): (linea: string) => boolean {
  const quedan = new Map(anteriores)
  return (linea) => {
    const restantes = quedan.get(linea) ?? 0
    if (restantes <= 0) return true
    quedan.set(linea, restantes - 1)
    return false
  }
}

/** Una vez por identidad, conservando el orden en que vinieron. */
function unaPorIdentidad<T extends { identidad: string }>(filas: T[]): T[] {
  const vistas = new Set<string>()
  return filas.filter((fila) => {
    if (vistas.has(fila.identidad)) return false
    vistas.add(fila.identidad)
    return true
  })
}

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
  /** La línea de cartera: la misma aunque la póliza se haya renovado. Es lo que se compara entre meses. */
  linea: string
  compania: string | null
  sucursal: string | null
  cuotaMonto: number | null
  cuota: string | null
  formaPago: string | null
  pagada: boolean
}

/**
 * Las filas de la planilla de un mes, ya filtradas por sucursal. Una sola consulta por mes: todo lo
 * demás (activos, altas, pendiente) sale de acá sin volver a la base. `lineas` es el mapa de
 * `lineasDeRenovacion()`, que se arma una vez por pantalla y se pasa a todos los meses que se miran.
 */
function cuotasDelMes(periodo: string, sucursales: string[], lineas: Map<number, string>): CuotaDelMes[] {
  const filas = db()
    .prepare(
      `SELECT c.poliza_id, p.clave, c.numero_poliza, c.patente, c.documento,
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
        WHERE c.periodo = ? AND c.dada_de_baja = 0
        -- Con dos renglones de la misma póliza se queda el que está pago (cuenta como cobrado) y, a
        -- igualdad, el del _ID más chico: el mismo en todas las computadoras.
        ORDER BY pagada DESC, c.fila_id`,
    )
    .all(periodo) as Array<{
    poliza_id: number | null
    clave: string | null
    numero_poliza: string | null
    patente: string | null
    documento: string | null
    compania: string | null
    sucursal: string | null
    cuota: string | null
    cuota_monto: number | null
    forma_pago: string | null
    pagada: number
  }>

  // La identidad y la línea se calculan ANTES de recortar por sucursal, igual que se deduplicaba antes:
  // dos renglones de la misma póliza son uno solo, mire quien mire.
  const conIdentidad = filas.map((fila) => {
    const identidad = identidadDeLaCuota(fila)
    // Sin póliza enganchada no hay cadena de renovaciones que seguir: la línea es lo que tiene escrito.
    const raiz = fila.poliza_id === null ? undefined : lineas.get(fila.poliza_id)
    return { ...fila, identidad, linea: raiz === undefined ? identidad : `L:${raiz}` }
  })
  return unaPorIdentidad(conIdentidad)
    .filter((fila) => coincideAlguno(sucursales, fila.sucursal, mismaSucursal))
    .map((fila) => ({
      identidad: fila.identidad,
      linea: fila.linea,
      compania: fila.compania,
      sucursal: fila.sucursal,
      cuota: fila.cuota,
      cuotaMonto: fila.cuota_monto,
      formaPago: fila.forma_pago,
      pagada: fila.pagada === 1,
    }))
}

/**
 * Cuántas filas tenía cada línea de cartera en un mes: es lo único que hace falta para contar las
 * altas del siguiente. Un conteo y no un conjunto por lo que explica `contadorDeAltas`.
 */
function lineasDelMes(periodo: string, sucursales: string[], lineas: Map<number, string>): Map<string, number> {
  const conteo = new Map<string, number>()
  for (const cuota of cuotasDelMes(periodo, sucursales, lineas)) {
    conteo.set(cuota.linea, (conteo.get(cuota.linea) ?? 0) + 1)
  }
  return conteo
}

interface BajaDelMes {
  identidad: string
  motivo: string | null
  compania: string | null
  sucursal: string | null
}

function bajasDelMes(periodo: string, sucursales: string[]): BajaDelMes[] {
  const filas = db()
    .prepare(
      `SELECT ${IDENTIDAD_DE_LA_BAJA} AS identidad, b.motivo, b.compania,
              COALESCE(NULLIF(TRIM(b.sucursal_texto), ''), cl.sucursal_texto) AS sucursal
         FROM bajas b
         LEFT JOIN clientes cl ON cl.id = b.cliente_id
         LEFT JOIN polizas p ON p.id = b.poliza_id
        WHERE b.periodo = ?
        ORDER BY b.hecha_en_la_app DESC, b.fila_id`,
    )
    .all(periodo) as BajaDelMes[]
  return unaPorIdentidad(filas).filter((fila) => coincideAlguno(sucursales, fila.sucursal, mismaSucursal))
}

interface PagoDelMes {
  compania: string | null
  sucursal: string | null
  medio: string | null
  importe: number | null
}

function pagosDelMes(periodo: string, sucursales: string[]): PagoDelMes[] {
  const filas = db()
    .prepare(
      `SELECT p.compania, ${SUCURSAL_DEL_PAGO} AS sucursal, p.medio, p.importe_monto AS importe
         FROM pagos p LEFT JOIN clientes cl ON cl.id = p.cliente_id
        WHERE ${PERIODO_DEL_PAGO} = ?`,
    )
    .all(periodo) as PagoDelMes[]
  return filas.filter((fila) => coincideAlguno(sucursales, fila.sucursal, mismaSucursal))
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
function evolucion(
  periodo: string,
  sucursales: string[],
  disponibles: string[],
  conNumeros: boolean,
  lineas: Map<number, string>,
): MesDeEvolucion[] {
  const hasta = disponibles.filter((candidato) => candidato <= periodo).slice(0, MESES_DE_EVOLUCION)
  const meses = [...hasta].sort()
  const filas: MesDeEvolucion[] = []
  for (const mes of meses) {
    const cuotas = cuotasDelMes(mes, sucursales, lineas)
    const anteriores = lineasDelMes(periodoAnterior(mes), sucursales, lineas)
    const esAlta = contadorDeAltas(anteriores)
    const altas = anteriores.size === 0 ? null : cuotas.filter((cuota) => esAlta(cuota.linea)).length
    filas.push({
      periodo: mes,
      activos: cuotas.length,
      altas,
      bajas: bajasDelMes(mes, sucursales).length,
      cobrado: conNumeros ? pagosDelMes(mes, sucursales).reduce((suma, pago) => suma + (pago.importe ?? 0), 0) : null,
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
function siniestrosAbiertos(sucursales: string[]): { total: number; porCompania: PorcionMetrica[] } {
  const filas = db()
    .prepare(
      `SELECT s.compania, s.estado, COALESCE(NULLIF(TRIM(s.sucursal_texto), ''), cl.sucursal_texto) AS sucursal
         FROM siniestros s LEFT JOIN clientes cl ON cl.id = s.cliente_id`,
    )
    .all() as Array<{ compania: string | null; estado: string | null; sucursal: string | null }>

  const abiertos = filas.filter(
    (fila) => coincideAlguno(sucursales, fila.sucursal, mismaSucursal) && normalizarEstadoSiniestro(fila.estado) !== 'CERRADO',
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
  const disponiblesDeSucursal = catalogos().sucursales
  // Se devuelven como las escribe el catálogo, no como llegaron: así el desplegable se ve elegido
  // aunque la pantalla anterior las tuviera escritas de otra forma. Es lo mismo que hacía la versión
  // de un valor, sólo que ahora con la lista entera.
  const sucursales = listaDeFiltro(filtros?.sucursales).flatMap((pedida) => {
    const encontrada = disponiblesDeSucursal.find((s) => mismaSucursal(s, pedida))
    return encontrada ? [encontrada] : []
  })

  const lineas = lineasDeRenovacion()
  const cuotas = cuotasDelMes(periodo, sucursales, lineas)
  const anterior = periodoAnterior(periodo)
  const lineasAnteriores = lineasDelMes(anterior, sucursales, lineas)
  const hayMesAnterior = lineasAnteriores.size > 0
  const esAlta = contadorDeAltas(lineasAnteriores)
  const altasDelMes = cuotas.filter((cuota) => esAlta(cuota.linea)).length

  const porCompania = new Map<string, { etiqueta: string; cantidad: number }>()
  const porSucursal = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const cuota of cuotas) {
    sumarUno(porCompania, cuota.compania, '(sin compañía)')
    sumarUno(porSucursal, cuota.sucursal, '(sin sucursal)')
  }

  const bajas = bajasDelMes(periodo, sucursales)
  const motivos = new Map<string, { etiqueta: string; cantidad: number }>()
  for (const baja of bajas) sumarUno(motivos, baja.motivo, '(sin motivo)')
  const bajasPorMotivo: BajaPorMotivo[] = [...motivos.values()]
    .map((fila) => ({ motivo: fila.etiqueta, cantidad: fila.cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo, 'es'))

  const siniestros = siniestrosAbiertos(sucursales)

  return {
    periodo,
    periodos: disponibles.includes(periodo) ? disponibles : [periodo, ...disponibles],
    sucursalesElegidas: sucursales,
    sucursales: disponiblesDeSucursal,

    activos: cuotas.length,
    activosPorCompania: aPorciones(porCompania, cuotas.length),
    activosPorSucursal: aPorciones(porSucursal, cuotas.length),

    altas: hayMesAnterior ? altasDelMes : null,
    bajas: bajas.length,
    bajasPorMotivo,
    hayMesAnterior,

    evolucion: evolucion(periodo, sucursales, disponibles, conNumeros, lineas),
    cobranza: cobranzaDelMes(cuotas, pagosDelMes(periodo, sucursales), conNumeros),

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
interface Acumulador extends Omit<FilaEstadistica, 'cobrado' | 'altas'> {
  clave: string
  altas: number
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

function ordenar(mapa: Map<string, Acumulador>, conNumeros: boolean, hayMesAnterior: boolean): FilaEstadistica[] {
  return [...mapa.values()]
    .map(({ clave: _clave, cobrado, altas, ...fila }) => ({ ...fila, altas: hayMesAnterior ? altas : null, cobrado: conNumeros ? cobrado : null }))
    .sort((a, b) => b.activos - a.activos || a.etiqueta.localeCompare(b.etiqueta, 'es'))
}

/**
 * Lo mismo que el tablero pero en tabla, que es como se compara contra la planilla: se pone la
 * pantalla al lado de la hoja y los números tienen que dar.
 */
export function estadisticasDeCartera(
  periodoPedido: string | null,
  sucursalesPedidas: string[],
  conNumeros: boolean,
): EstadisticasDeCartera {
  const disponibles = periodosDisponibles().map((p) => p.periodo)
  const periodo = resolverPeriodo(periodoPedido, disponibles)
  const disponiblesDeSucursal = catalogos().sucursales
  const sucursales = listaDeFiltro(sucursalesPedidas).flatMap((pedida) => {
    const encontrada = disponiblesDeSucursal.find((s) => mismaSucursal(s, pedida))
    return encontrada ? [encontrada] : []
  })

  const lineas = lineasDeRenovacion()
  const cuotas = cuotasDelMes(periodo, sucursales, lineas)
  const lineasAnteriores = lineasDelMes(periodoAnterior(periodo), sucursales, lineas)
  const hayMesAnterior = lineasAnteriores.size > 0
  const contar = contadorDeAltas(lineasAnteriores)

  const companias = new Map<string, Acumulador>()
  const sucursalesMapa = new Map<string, Acumulador>()
  for (const cuota of cuotas) {
    // `contar` va primero y se llama SIEMPRE: es el que tacha, y saltearlo cuando no hay mes anterior
    // lo dejaría descontando de más en la fila siguiente. Sin mes anterior no tacha nada igual, y las
    // altas salen en null de todos modos (ver `ordenar`).
    const esAlta = contar(cuota.linea) && hayMesAnterior
    for (const fila of [tomar(companias, cuota.compania, '(sin compañía)'), tomar(sucursalesMapa, cuota.sucursal, '(sin sucursal)')]) {
      fila.activos++
      if (esAlta) fila.altas++
    }
  }
  for (const baja of bajasDelMes(periodo, sucursales)) {
    tomar(companias, baja.compania, '(sin compañía)').bajas++
    tomar(sucursalesMapa, baja.sucursal, '(sin sucursal)').bajas++
  }
  for (const pago of pagosDelMes(periodo, sucursales)) {
    for (const fila of [tomar(companias, pago.compania, '(sin compañía)'), tomar(sucursalesMapa, pago.sucursal, '(sin sucursal)')]) {
      fila.pagos++
      fila.cobrado += pago.importe ?? 0
    }
  }

  const porCompania = ordenar(companias, conNumeros, hayMesAnterior)
  // El total sale del acumulador y no de las filas ya recortadas: si no, con los números ocultos el
  // total sumaría nulls y daría cero.
  const totalCobrado = [...companias.values()].reduce((suma, fila) => suma + fila.cobrado, 0)
  return {
    periodo,
    periodos: disponibles.includes(periodo) ? disponibles : [periodo, ...disponibles],
    sucursalesElegidas: sucursales,
    sucursales: disponiblesDeSucursal,
    porCompania,
    porSucursal: ordenar(sucursalesMapa, conNumeros, hayMesAnterior),
    // El total sale de las filas por compañía: cada cuota, baja y pago cae en una sola.
    totales: {
      etiqueta: 'Total',
      activos: porCompania.reduce((suma, fila) => suma + fila.activos, 0),
      altas: hayMesAnterior ? porCompania.reduce((suma, fila) => suma + (fila.altas ?? 0), 0) : null,
      bajas: porCompania.reduce((suma, fila) => suma + fila.bajas, 0),
      pagos: porCompania.reduce((suma, fila) => suma + fila.pagos, 0),
      cobrado: conNumeros ? totalCobrado : null,
    },
    hayMesAnterior,
    hoy: hoyLocal(),
  }
}

// ---------------------------------------------------------------------------
// El podio del mes: la competencia entre sucursales por altas
// ---------------------------------------------------------------------------

/**
 * El ranking de sucursales por altas del mes en curso. Se apoya en `estadisticasDeCartera` en vez de
 * volver a recorrer cuotas y bajas: son la misma cuenta y así los números del podio nunca se
 * despegan de los de Cartera → Estadísticas. Siempre `conNumeros = false`: la competencia es por
 * altas y bajas, no por plata, y así la ve cualquiera, tenga o no el módulo Métricas habilitado.
 */
export function podioDelMes(): PodioMensual {
  const estadisticas = estadisticasDeCartera(null, [], false)
  const ranking = estadisticas.porSucursal
    .filter((fila) => fila.etiqueta !== '(sin sucursal)')
    .sort((a, b) => {
      if (a.altas === null || b.altas === null) return b.activos - a.activos || a.etiqueta.localeCompare(b.etiqueta, 'es')
      return b.altas - a.altas || b.activos - a.activos || a.etiqueta.localeCompare(b.etiqueta, 'es')
    })
  return {
    periodo: estadisticas.periodo,
    hayMesAnterior: estadisticas.hayMesAnterior,
    ranking,
    hoy: estadisticas.hoy,
  }
}
