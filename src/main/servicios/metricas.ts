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
//     Y se reconoce IGUAL EN TODAS LAS COMPUTADORAS (13.0.2): la cuenta sale de lo que la planilla
//     tiene escrito, no de un enganche que sólo conoce la máquina que renovó (ver `contadorDeAltas`).
//     Si dos sucursales ven podios distintos del mismo mes, es que bajaron la hoja en momentos
//     distintos: por eso el podio dice de cuándo son sus datos.
//
//  3. BAJAS de un mes = las pólizas de la pestaña de BAJAS de ese mes, con su MOTIVO, también una vez
//     por póliza.
import { hoyLocal, periodoDeHoy } from '../../shared/semaforo'
import { normalizarEstadoSiniestro } from '../../shared/siniestros'
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { mismaSucursal } from '../../shared/sucursales'
import { categoriaDeCartera } from '../../shared/polizas'
import type {
  BajaPorMotivo,
  CobranzaDelMes,
  DetalleDeAltas,
  EstadisticasDeCartera,
  FilaEstadistica,
  FiltrosMetricas,
  MesDeEvolucion,
  PodioMensual,
  PorcionMetrica,
  ResumenDeCartera,
  TableroMetricas,
  TotalPorMedio,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, limpiar, normalizarDocumento, normalizarNumeroPoliza, normalizarPatente, normalizarTexto } from '../importacion/normalizar'
import { leerMarca } from '../sincronizacion/cola'
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
 *
 * LO QUE ESTA CADENA TODAVÍA NO ALCANZA. `poliza_anterior_id` lo escribe la computadora donde alguien
 * apretó «Renovar» y no viaja por la hoja de Google: la planilla no tiene columna para él. En las
 * demás computadoras la renovación llega como una fila más de la planilla del mes, así que:
 *
 *   · si la compañía DEJA EL MISMO NÚMERO —lo normal, y lo que propone la bandeja de renovaciones— la
 *     fila nueva cae en la misma clave («POL:<cía>|<número>») y en la misma póliza: la renovación se
 *     reconoce sola en todas las computadoras, con cadena o sin ella;
 *   · si la compañía CAMBIA EL NÚMERO, la computadora que no renovó ve una póliza con clave nueva y
 *     sin cadena, y la sigue contando como alta.
 *
 * Cerrarlo del todo es hacer viajar el enganche por la hoja (una columna más en la planilla del mes,
 * con lo que eso arrastra en el importador y en la sincronización). No se hizo acá porque el caso
 * frecuente ya queda bien y el detalle del podio —`altasDelMes`— deja ver cuándo pasa: si en la lista
 * aparecen clientes viejos, son renovaciones con número nuevo hechas en otra máquina.
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
 * El RIESGO que asegura una fila, tal como está escrito en la planilla: la patente. Es con lo que se
 * reconoce una renovación con número nuevo en TODAS las computadoras (ver `contadorDeAltas`), así que
 * sale sólo de lo que viaja por la hoja.
 *
 * Sólo la patente, y no la compañía ni el documento, a propósito: es la misma identidad con la que el
 * importador engancha las planillas viejas a una póliza cuando el número no coincide (`buscarPoliza`),
 * y las dos cuentas tienen que decir lo mismo, si no una computadora instalada de cero —que importa la
 * historia entera— y una que la fue bajando mes a mes verían altas distintas. Con el documento solo,
 * además, un cliente que vendió la moto y aseguró un auto pasaría por una renovación. `normalizarPatente`
 * devuelve '' para «0KM», «SIN PATENTE» y compañía: sin eso dos autos sin chapa serían el mismo riesgo.
 * Una póliza sin patente de verdad no tiene riesgo que reconocer, y su renovación con número nuevo se
 * reconoce sólo por la cadena, en la máquina que renovó.
 */
function riesgoDeLaCuota(fila: { patente: string | null }): string | null {
  const patente = normalizarPatente(fila.patente)
  return patente ? `PAT:${patente}` : null
}

/**
 * El contador de altas de un mes: se le pasan las filas del mes anterior y las del mes que se mira, y
 * después dice, fila por fila, cuál es alta.
 *
 * Una fila NO es alta si su línea de cartera ya estaba el mes anterior. Se cuenta contra un CONTEO y
 * no contra un conjunto porque una línea puede tener dos filas vivas a la vez: renovar eligiendo «la
 * anterior sigue activa» deja las dos pólizas en la planilla, y esa segunda fila sí es una fila más en
 * la cartera. Así la primera fila de una línea que ya estaba no es alta —es la misma póliza, o su
 * renovación— y la segunda sí.
 *
 * Y TAMPOCO es alta si es la RENOVACIÓN CON NÚMERO NUEVO de una fila que se fue (13.0.2): una fila
 * cuya línea no estaba el mes anterior, pero que asegura el mismo riesgo —la misma patente— que una
 * línea del mes anterior que en este mes YA NO ESTÁ. Es la misma cuenta que hace la
 * cadena de renovaciones (`lineasDeRenovacion`), hecha con lo que la planilla tiene escrito. Hace falta
 * porque la cadena no viaja por la hoja: la computadora donde se apretó «Renovar» conocía el enganche
 * y las demás no, así que el mismo mes daba un podio distinto en cada sucursal, y a la sucursal que
 * más renueva le sobraban altas en todas las máquinas menos en la suya. Por eso hay que recibir el mes
 * entero de antemano: para saber qué líneas del mes anterior quedaron huérfanas hay que haber visto
 * todas las filas de éste. Si la línea vieja sigue presente —se renovó dejando la anterior activa— no
 * está huérfana y la fila nueva es un alta, como siempre. Un cambio de vehículo es otro riesgo y sigue
 * siendo un alta (y el auto viejo, una baja); un cambio de compañía con el mismo auto no lo es: el
 * cliente y el auto siguen, la cartera no creció.
 *
 * Las filas llegan siempre en el mismo orden (ver el ORDER BY de `cuotasDelMes`), así que cuál de dos
 * filas queda como alta no cambia de una corrida a otra ni de una computadora a otra.
 */
function contadorDeAltas(anteriores: CuotaDelMes[], actuales: CuotaDelMes[]): (cuota: CuotaDelMes) => boolean {
  const quedan = new Map<string, number>()
  for (const cuota of anteriores) quedan.set(cuota.linea, (quedan.get(cuota.linea) ?? 0) + 1)

  // Las líneas del mes anterior que este mes no están, por riesgo: las candidatas a «se renovó con
  // otro número». Lo que se descuenta es siempre `quedan`, así que una línea consumida por acá no
  // vuelve a servir para otra fila.
  const presentes = new Set(actuales.map((cuota) => cuota.linea))
  const huerfanasPorRiesgo = new Map<string, string[]>()
  for (const cuota of anteriores) {
    if (cuota.riesgo === null || presentes.has(cuota.linea)) continue
    const lista = huerfanasPorRiesgo.get(cuota.riesgo) ?? []
    lista.push(cuota.linea)
    huerfanasPorRiesgo.set(cuota.riesgo, lista)
  }

  const descontar = (linea: string): boolean => {
    const restantes = quedan.get(linea) ?? 0
    if (restantes <= 0) return false
    quedan.set(linea, restantes - 1)
    return true
  }

  return (cuota) => {
    if (descontar(cuota.linea)) return false
    if (cuota.riesgo !== null) {
      for (const linea of huerfanasPorRiesgo.get(cuota.riesgo) ?? []) {
        if (descontar(linea)) return false
      }
    }
    return true
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
  /** El riesgo escrito en la fila (la patente): con qué se reconoce una renovación con número nuevo. */
  riesgo: string | null
  // Con qué se reconoce la fila en la planilla. Viaja acá, y no en una consulta aparte, porque el
  // detalle de altas tiene que listar EXACTAMENTE las filas que se contaron: si el listado saliera de
  // su propia consulta, el día que las dos se despeguen el detalle no sumaría lo que dice la tarjeta y
  // no habría forma de saber cuál de los dos números está mal.
  clienteNombre: string | null
  numeroPoliza: string | null
  patente: string | null
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
              COALESCE(NULLIF(TRIM(c.cliente_nombre), ''), cl.nombre) AS cliente_nombre,
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
    cliente_nombre: string | null
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
      riesgo: riesgoDeLaCuota(fila),
      clienteNombre: fila.cliente_nombre,
      numeroPoliza: fila.numero_poliza,
      patente: fila.patente,
      compania: fila.compania,
      sucursal: fila.sucursal,
      cuota: fila.cuota,
      cuotaMonto: fila.cuota_monto,
      formaPago: fila.forma_pago,
      pagada: fila.pagada === 1,
    }))
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
    const anteriores = cuotasDelMes(periodoAnterior(mes), sucursales, lineas)
    const esAlta = contadorDeAltas(anteriores, cuotas)
    const altas = anteriores.length === 0 ? null : cuotas.filter(esAlta).length
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
 * El tablero, calculado ACÁ MISMO contra la copia SQLite de esta PC. Desde que existe el cálculo
 * server-side (ver servicios/metricasDesdeCache.ts), la pantalla de Métricas ya no llama a esta función
 * directamente para lo que muestra: `metricas:tablero` en ipc.ts usa el payload cacheado del servidor
 * cuando lo tiene, y ESTA función queda como el algoritmo de referencia con el que se coteja ese
 * resultado (y como respaldo para cuando todavía no llegó ningún cálculo del servidor). Por eso sigue
 * viva y con sus pruebas: mientras las dos cuentas no digan lo mismo, alguna de las dos está mal.
 *
 * `conNumeros` en false deja afuera todo lo que sea plata agregada de la agencia: es lo que ve un
 * empleado. Se decide en el proceso principal y no en la pantalla a propósito —el dato ni siquiera
 * viaja—, porque una pantalla que oculta un número que igual llegó no oculta nada.
 */
export function tableroDeMetricasLocal(filtros: FiltrosMetricas, conNumeros: boolean): TableroMetricas {
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
  const anteriores = cuotasDelMes(periodoAnterior(periodo), sucursales, lineas)
  const hayMesAnterior = anteriores.length > 0
  const esAlta = contadorDeAltas(anteriores, cuotas)
  const altasDelMes = cuotas.filter(esAlta).length

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
 * El resumen de TODA la cartera —no el de un mes—: cuántas pólizas están activas, cuántas vencieron
 * sin renovarse y cuántas se dieron de baja, cada una contada una sola vez. Antes de esto, «Activos»
 * era lo único que se mostraba y salía de la planilla del mes: una póliza vencida que ya no aparecía en
 * la hoja no estaba en ese número, pero tampoco en ningún otro, así que se perdía de la cartera sin
 * dejar rastro. Acá se recorre `polizas` entera para que no quede ninguna afuera.
 */
export function resumenDeCartera(): ResumenDeCartera {
  const hoy = hoyLocal()
  const filas = db()
    .prepare(
      `SELECT p.id, p.activa, p.vigencia_hasta_iso,
              EXISTS (SELECT 1 FROM polizas s WHERE s.poliza_anterior_id = p.id) AS tiene_sucesora,
              EXISTS (SELECT 1 FROM bajas b WHERE b.poliza_id = p.id) AS tiene_baja
       FROM polizas p`,
    )
    .all() as Array<{
    id: number
    activa: number
    vigencia_hasta_iso: string | null
    tiene_sucesora: number
    tiene_baja: number
  }>

  const resumen: ResumenDeCartera = { activas: 0, fueraDeVigencia: 0, dadasDeBaja: 0 }
  for (const fila of filas) {
    // Misma regla que usa la ficha del cliente para distinguir «se renovó» de «se dio de baja»
    // (ver `clientes.ts`): si además hay una baja anotada a mano, gana la baja.
    const renovada = fila.activa === 0 && fila.tiene_sucesora === 1 && fila.tiene_baja === 0
    const categoria = categoriaDeCartera(fila.activa === 1, renovada, fila.vigencia_hasta_iso, hoy)
    if (categoria === 'ACTIVA') resumen.activas++
    else if (categoria === 'VENCIDA') resumen.fueraDeVigencia++
    else if (categoria === 'BAJA') resumen.dadasDeBaja++
  }
  return resumen
}

/**
 * Lo mismo que el tablero pero en tabla, que es como se compara contra la planilla: se pone la
 * pantalla al lado de la hoja y los números tienen que dar. Misma nota que `tableroDeMetricasLocal`:
 * `metricas:estadisticas` en ipc.ts usa el cálculo server-side cuando lo tiene, y esta función queda
 * como algoritmo de referencia (cotejo) y respaldo — salvo `resumenDeCartera()`, que el servidor no
 * puede calcular (depende de `polizas.activa` y de la cadena de renovaciones, que no tienen equivalente
 * ahí) y por eso sigue siendo SIEMPRE la fuente de ese campo puntual, cache o no.
 */
export function estadisticasDeCarteraLocal(
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
  const anteriores = cuotasDelMes(periodoAnterior(periodo), sucursales, lineas)
  const hayMesAnterior = anteriores.length > 0
  const contar = contadorDeAltas(anteriores, cuotas)

  const companias = new Map<string, Acumulador>()
  const sucursalesMapa = new Map<string, Acumulador>()
  for (const cuota of cuotas) {
    // `contar` va primero y se llama SIEMPRE: es el que tacha, y saltearlo cuando no hay mes anterior
    // lo dejaría descontando de más en la fila siguiente. Sin mes anterior no tacha nada igual, y las
    // altas salen en null de todos modos (ver `ordenar`).
    const esAlta = contar(cuota) && hayMesAnterior
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
    resumenCartera: resumenDeCartera(),
    hoy: hoyLocal(),
  }
}

// ---------------------------------------------------------------------------
// El podio del mes: la competencia entre sucursales por altas
// ---------------------------------------------------------------------------

/**
 * El ranking de sucursales por altas del mes en curso. Se apoya en `estadisticasDeCarteraLocal` en vez de
 * volver a recorrer cuotas y bajas: son la misma cuenta y así los números del podio nunca se
 * despegan de los de Cartera → Estadísticas. Siempre `conNumeros = false`: la competencia es por
 * altas y bajas, no por plata, y así la ve cualquiera, tenga o no el módulo Métricas habilitado.
 */
/**
 * Con qué nombre agrupa el podio una sucursal. Es el MISMO que usa `tomar()` para armar las filas de
 * Estadísticas, y tiene que serlo: el detalle se pide con la etiqueta que muestra la tarjeta, así que
 * si acá se comparara de otra forma —con `mismaSucursal`, que además pliega «AVELLANEDA» dentro de
 * «Dock Sud»— el listado traería filas que la tarjeta no contó y el número dejaría de cerrar.
 */
function claveDeLaFilaDeSucursal(valor: string | null): string {
  return normalizarTexto(limpiar(valor) || '(sin sucursal)')
}

/**
 * Las pólizas que se están contando como altas, una por una. Es la respuesta a «¿qué está contando?»:
 * el podio da un número y esto dice de quién es cada una, para poder mirarlo contra la planilla en vez
 * de creerle al cartel.
 *
 * Sale de las MISMAS filas que cuenta el podio y con el mismo recorrido, no de una consulta parecida:
 * se cuenta sobre toda la agencia y recién después se recorta por sucursal. Filtrar antes cambiaría
 * también el mes anterior contra el que se compara —una póliza que se mudó de local parecería un alta—
 * y el detalle de Dock Sud no sumaría lo que dice su tarjeta.
 */
export function altasDelMes(periodoPedido: string | null, sucursalPedida: string | null): DetalleDeAltas {
  const disponibles = periodosDisponibles().map((p) => p.periodo)
  const periodo = resolverPeriodo(periodoPedido, disponibles)
  const lineas = lineasDeRenovacion()
  const cuotas = cuotasDelMes(periodo, [], lineas)
  const anteriores = cuotasDelMes(periodoAnterior(periodo), [], lineas)
  const hayMesAnterior = anteriores.length > 0
  const esAlta = contadorDeAltas(anteriores, cuotas)
  // El contador se recorre entero aunque no haya mes anterior: es el mismo paseo que hace el podio, y
  // dos recorridos distintos sobre las mismas filas son dos números distintos esperando a aparecer.
  const altas = cuotas.filter(esAlta)

  const sucursal = limpiar(sucursalPedida) || null
  const buscada = sucursal === null ? null : claveDeLaFilaDeSucursal(sucursal)
  return {
    periodo,
    sucursal,
    hayMesAnterior,
    filas: (hayMesAnterior ? altas : [])
      .filter((cuota) => buscada === null || claveDeLaFilaDeSucursal(cuota.sucursal) === buscada)
      .map((cuota) => ({
        cliente: cuota.clienteNombre,
        compania: cuota.compania,
        numeroPoliza: cuota.numeroPoliza,
        patente: cuota.patente,
        sucursal: limpiar(cuota.sucursal) || null,
      }))
      .sort((a, b) => (a.cliente ?? '').localeCompare(b.cliente ?? '', 'es')),
  }
}

// SUPERADA (13.2): el handler 'metricas:podio' de ipc.ts ya no llama a esta función — el podio ahora lo
// calcula el servidor y esta computadora sólo lee el resultado (ver servicios/metricasCache.ts y
// sincronizacion/vigia.ts). Queda acá sin tocar porque una fase más adelante borra de una vez todo este
// cómputo local ya muerto, cuando el resto de las pantallas de Métricas también se muden.
export function podioDelMes(): PodioMensual {
  const estadisticas = estadisticasDeCarteraLocal(null, [], false)
  const ranking = estadisticas.porSucursal
    .filter((fila) => fila.etiqueta !== '(sin sucursal)')
    .sort((a, b) => {
      if (a.altas === null || b.altas === null) return b.activos - a.activos || a.etiqueta.localeCompare(b.etiqueta, 'es')
      return b.altas - a.altas || b.activos - a.activos || a.etiqueta.localeCompare(b.etiqueta, 'es')
    })
  return {
    periodo: estadisticas.periodo,
    periodoAnterior: periodoAnterior(estadisticas.periodo),
    hayMesAnterior: estadisticas.hayMesAnterior,
    ranking,
    hoy: estadisticas.hoy,
    // `PodioMensual` cambió de forma en la 13.2 (ver el comentario de la interfaz en shared/tipos.ts):
    // esta función quedó superada y ya no alimenta ninguna pantalla, así que estos dos campos son sólo
    // lo mínimo para seguir compilando contra el tipo compartido, no un cómputo real de frescura.
    // `recibidoEnEstaComputadora` ya no puede ser null (a diferencia del `datosBajadosEn` de antes): si
    // esta computadora nunca bajó nada de la hoja, se usa el instante actual, que para este cómputo
    // local sigue siendo una respuesta razonable a «¿de cuándo son estos números?».
    calculadoEn: ahoraIso(),
    recibidoEnEstaComputadora: leerMarca('ultima_bajada') ?? ahoraIso(),
    frescura: 'AL_DIA',
  }
}
