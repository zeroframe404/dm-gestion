// Cobranzas: la caja del día, la mora, la rendición mensual (la pestaña IMPUTADOS) y las comisiones.
//
// Los pagos son siempre los mismos: los que nacen de «Registrar pago» en la Cartera y los que se
// cargan a mano acá. Esta pantalla los mira de tres maneras distintas —por día, por mes y por
// compañía—, así que todo sale de la misma tabla `pagos` y de `pagos.ts`.
import { esDebitoAutomatico, fechaDeVencimiento, hoyLocal, periodoDeHoy } from '../../shared/semaforo'
import {
  RESULTADOS_DE_IMPUTACION,
  type AvisoDeMora,
  type CajaDelDia,
  type DatosDePagoManual,
  type FilaCartera,
  type FilaComision,
  type FilaMora,
  type FiltrosMora,
  type ListadoMora,
  type PagoRegistrado,
  type RangoDeMora,
  type RendicionImputados,
  type ResultadoImputacion,
  type ResumenComisiones,
  type SesionUsuario,
  type TotalPorMedio,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, generarId, interpretarFecha, interpretarNumero, limpiar, normalizarTexto } from '../importacion/normalizar'
import {
  aFila,
  catalogos,
  idDelPagoDeLaCuota,
  periodosDisponibles,
  prepararAvisoDeCuota,
  registrarPago,
  SELECT_PLANILLA,
  type FilaCruda,
} from './cartera'
import { comisionPorCompania, diasCoberturaPorCompania, listarCompanias, sincronizarCompanias } from './companias'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { encolar } from '../sincronizacion/cola'
import {
  aPagoRegistrado,
  asegurarPagoEnLaHoja,
  guardarPago,
  hojaDeImputados,
  normalizarResultado,
  SELECT_PAGOS,
  type PagoCrudo,
} from './pagos'
import { enteroPositivo, texto } from './validacion'

const FORMATO_ISO = /^\d{4}-\d{2}-\d{2}$/
const FORMATO_PERIODO = /^\d{4}-\d{2}$/

function exigirFecha(valor: string | null): string {
  const limpia = limpiar(valor)
  if (!limpia) return hoyLocal()
  if (!FORMATO_ISO.test(limpia)) throw new ErrorDeNegocio(`«${limpia}» no es una fecha válida.`)
  return limpia
}

function mismaCosa(a: string | null, b: string | null): boolean {
  return normalizarTexto(a) === normalizarTexto(b)
}

/** Deja una lista de valores distintos, sin repetir por mayúsculas ni tildes, ordenada. */
function distintos(valores: Array<string | null>): string[] {
  const vistos = new Map<string, string>()
  for (const valor of valores) {
    const limpio = limpiar(valor)
    if (!limpio) continue
    const clave = normalizarTexto(limpio)
    if (!vistos.has(clave)) vistos.set(clave, limpio)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

// ---------------------------------------------------------------------------
// Caja del día
// ---------------------------------------------------------------------------

/** Las sucursales que pueden aparecer en la caja: las del catálogo más las que traen los pagos. */
function sucursalesDeLaCaja(): string[] {
  const delCatalogo = (db().prepare('SELECT nombre AS valor FROM sucursales').all() as Array<{ valor: string }>).map((f) => f.valor)
  const deLosPagos = (
    db().prepare('SELECT DISTINCT COALESCE(sucursal_cobro, sucursal_texto) AS valor FROM pagos').all() as Array<{ valor: string | null }>
  ).map((f) => f.valor)
  return distintos([...delCatalogo, ...deLosPagos])
}

function totalesPorMedio(pagos: PagoRegistrado[]): TotalPorMedio[] {
  const acumulado = new Map<string, TotalPorMedio>()
  for (const pago of pagos) {
    const etiqueta = limpiar(pago.medio) || '(sin especificar)'
    const clave = normalizarTexto(etiqueta)
    const previo = acumulado.get(clave) ?? { medio: etiqueta, pagos: 0, total: 0 }
    previo.pagos++
    previo.total += pago.importeMonto ?? 0
    acumulado.set(clave, previo)
  }
  return [...acumulado.values()].sort((a, b) => b.total - a.total || a.medio.localeCompare(b.medio, 'es'))
}

export function cajaDelDia(fechaPedida: string | null, sucursalPedida: string): CajaDelDia {
  const fecha = exigirFecha(fechaPedida)
  const sucursales = sucursalesDeLaCaja()
  const sucursal = sucursales.find((s) => mismaCosa(s, sucursalPedida)) ?? ''

  const crudas = db().prepare(`${SELECT_PAGOS} WHERE p.fecha_iso = ? ORDER BY p.creado_en, p.id`).all(fecha) as PagoCrudo[]
  const pagos = crudas.map(aPagoRegistrado).filter((pago) => !sucursal || mismaCosa(pago.sucursal, sucursal))

  return {
    fecha,
    sucursal,
    sucursales,
    mediosDePago: catalogos().mediosDePago,
    pagos,
    totalesPorMedio: totalesPorMedio(pagos),
    total: pagos.reduce((suma, pago) => suma + (pago.importeMonto ?? 0), 0),
    sinImporte: pagos.filter((pago) => pago.importeMonto === null).length,
    hoy: hoyLocal(),
  }
}

/** Importe con coma decimal y sin separador de miles: es lo que entiende el Excel en español. */
function comoImporte(valor: number): string {
  return valor.toFixed(2).replace('.', ',')
}

/**
 * Una celda del CSV. Además de escapar las comillas, se le antepone un apóstrofo a lo que empiece con
 * `=`, `+`, `-`, `@` o un tabulador: Excel toma eso como una fórmula, y los nombres, las pólizas y las
 * observaciones vienen de la hoja de Google y de lo que se tipea en la caja.
 */
function celda(valor: string | number | null): string {
  const contenido = valor === null ? '' : String(valor)
  const seguro = /^[=+\-@\t\r]/.test(contenido) ? `'${contenido}` : contenido
  return `"${seguro.replace(/"/g, '""')}"`
}

/**
 * El día en CSV, con punto y coma de separador y BOM: así se abre de un doble clic en el Excel de la
 * agencia, sin pasar por el asistente de importación.
 */
export function csvDeLaCaja(fechaPedida: string | null, sucursalPedida: string): { nombre: string; contenido: string } {
  const caja = cajaDelDia(fechaPedida, sucursalPedida)
  const lineas: string[] = []
  lineas.push(celda(`Caja del ${caja.fecha}${caja.sucursal ? ` · ${caja.sucursal}` : ' · todas las sucursales'}`))
  lineas.push('')
  lineas.push(
    ['Hora', 'Cliente', 'DNI/CUIT', 'Compañía', 'Póliza', 'Patente', 'Importe', 'Medio', 'Sucursal', 'Cobró', 'Mes', 'Resultado']
      .map(celda)
      .join(';'),
  )
  for (const pago of caja.pagos) {
    lineas.push(
      [
        celda(pago.hora),
        celda(pago.clienteNombre),
        celda(pago.documento),
        celda(pago.compania),
        celda(pago.numeroPoliza),
        celda(pago.patente),
        pago.importeMonto === null ? celda(pago.importe) : comoImporte(pago.importeMonto),
        celda(pago.medio),
        celda(pago.sucursal),
        celda(pago.usuarioNombre),
        celda(pago.periodo),
        celda(pago.resultado),
      ].join(';'),
    )
  }
  lineas.push('')
  lineas.push([celda('Total por medio de pago'), celda('Pagos'), celda('Importe')].join(';'))
  for (const total of caja.totalesPorMedio) {
    lineas.push([celda(total.medio), String(total.pagos), comoImporte(total.total)].join(';'))
  }
  lineas.push([celda('TOTAL'), String(caja.pagos.length), comoImporte(caja.total)].join(';'))
  if (caja.sinImporte > 0) {
    lineas.push('')
    lineas.push(celda(`${caja.sinImporte} pago(s) sin importe numérico: no suman al total.`))
  }

  const sufijo = caja.sucursal ? `-${caja.sucursal.replace(/[^\p{L}\p{N}]+/gu, '-')}` : ''
  // El BOM del principio es lo que le dice a Excel que el archivo está en UTF-8.
  return { nombre: `caja-${caja.fecha}${sufijo}.csv`, contenido: `﻿${lineas.join('\r\n')}\r\n` }
}

// ---------------------------------------------------------------------------
// Alta manual de un pago
// ---------------------------------------------------------------------------

export interface ResultadoDeAltaDePago {
  caja: CajaDelDia
  pagoId: number
}

/**
 * Carga un pago desde la caja. Si viene con una fila de la planilla del mes se registra por el mismo
 * camino que «Registrar pago» de la Cartera (así la fila queda paga y en verde); si no, queda como un
 * pago suelto, que es lo que hace falta para un riesgo vario o para alguien que todavía no está en la
 * planilla del mes.
 */
export function registrarPagoManual(datos: DatosDePagoManual, actor: SesionUsuario): ResultadoDeAltaDePago {
  const fecha = limpiar(datos.fecha) || hoyLocal()
  const interpretada = interpretarFecha(fecha, Number(hoyLocal().slice(0, 4)))
  if (!interpretada.iso) throw new ErrorDeNegocio(`«${fecha}» no es una fecha válida. Usá el formato día/mes/año.`)
  const sucursal = limpiar(datos.sucursal) || actor.sucursal.nombre

  const cuotaFilaId = limpiar(datos.cuotaFilaId)
  if (cuotaFilaId) {
    registrarPago(cuotaFilaId, { fecha, importe: limpiar(datos.importe), medioDePago: limpiar(datos.medioDePago), sucursal }, actor)
    const pagoId = idDelPagoDeLaCuota(cuotaFilaId)
    if (pagoId === null) throw new ErrorDeNegocio('El pago se guardó pero no se pudo leer de vuelta. Actualizá la pantalla.')
    return { caja: cajaDelDia(interpretada.iso, sucursal), pagoId }
  }

  const nombre = texto(datos.clienteNombre, 'El nombre del cliente', 2, 200)
  const importe = limpiar(datos.importe)
  if (!importe) throw new ErrorDeNegocio('Poné el importe que se cobró.')
  if (interpretarNumero(importe) === null) throw new ErrorDeNegocio(`«${importe}» no es un importe. Escribilo como 24.500 o 24500,50.`)

  const pagoId = guardarPago(
    {
      filaId: generarId(),
      cuotaFilaId: null,
      // Un id que no sea un entero positivo es «no hay cliente en la base»: no puede ir a la clave foránea.
      clienteId: typeof datos.clienteId === 'number' && datos.clienteId > 0 ? datos.clienteId : null,
      polizaId: typeof datos.polizaId === 'number' && datos.polizaId > 0 ? datos.polizaId : null,
      clienteNombre: nombre,
      documento: limpiar(datos.documento) || null,
      compania: limpiar(datos.compania) || null,
      numeroPoliza: limpiar(datos.numeroPoliza) || null,
      patente: limpiar(datos.patente) || null,
      // De un pago suelto no se sabe la sucursal DEL CLIENTE; la que se elige es la del mostrador.
      sucursalCliente: null,
      sucursalCobro: sucursal,
      fecha,
      fechaIso: interpretada.iso,
      importe,
      medio: limpiar(datos.medioDePago) || null,
      periodo: interpretada.iso.slice(0, 7),
      observaciones: limpiar(datos.observaciones) || null,
      resultado: '',
    },
    actor,
  )

  const medio = limpiar(datos.medioDePago)
  registrarCambio(actor, {
    accion: 'pago',
    tabla: 'pagos',
    registroId: pagoId,
    campo: 'CAJA',
    valorAnterior: null,
    valorNuevo: `${nombre} · ${importe}${medio ? ` · ${medio}` : ''} (${fecha})`,
  })
  return { caja: cajaDelDia(interpretada.iso, sucursal), pagoId }
}

// ---------------------------------------------------------------------------
// Mora
// ---------------------------------------------------------------------------

function aDia(iso: string): number {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1) / 86_400_000)
}

function desdeDia(dias: number): string {
  return new Date(dias * 86_400_000).toISOString().slice(0, 10)
}

function rangoDe(dias: number): Exclude<RangoDeMora, ''> {
  if (dias <= 7) return '1-7'
  if (dias <= 30) return '8-30'
  return '+30'
}

/** Pasa una fila de la planilla a una fila de mora. Devuelve null si no está vencida sin pagar. */
function aFilaMora(fila: FilaCartera, hoy: string, periodoAbierto: string | null): FilaMora | null {
  const vencimiento = fechaDeVencimiento(fila.periodo, fila.diaVencimientoNumero)
  if (!vencimiento) return null
  const diasDeAtraso = aDia(hoy) - aDia(vencimiento)
  if (diasDeAtraso < 1) return null
  const finCobertura = desdeDia(aDia(vencimiento) + fila.diasCobertura)
  return {
    filaId: fila.filaId,
    periodo: fila.periodo,
    clienteId: fila.clienteId,
    polizaId: fila.polizaId,
    nombre: fila.nombre,
    telefono: fila.telefono,
    documento: fila.documento,
    sucursal: fila.sucursal,
    compania: fila.compania,
    numeroPoliza: fila.numeroPoliza,
    patente: fila.patente,
    cuota: fila.cuota,
    cuotaMonto: fila.cuotaMonto,
    formaPago: fila.formaPago,
    diaVencimiento: fila.diaVencimiento,
    vencimiento,
    diasDeAtraso,
    rango: rangoDe(diasDeAtraso),
    finCobertura,
    dentroDeCobertura: aDia(finCobertura) >= aDia(hoy),
    aviso: fila.aviso,
    fechaEnvio: fila.fechaEnvio,
    mesAbierto: periodoAbierto === null || fila.periodo === periodoAbierto,
  }
}

/**
 * Las cuotas vencidas sin pago, de todos los meses. El «+30 días» del pliego sólo tiene sentido así:
 * dentro de un mes solo no puede haber atrasos de más de 30 días.
 *
 * No entran las pólizas dadas de baja (a un ex cliente no se lo persigue por WhatsApp) ni, salvo que
 * se pida, las de débito automático, que se cobran solas y por eso el semáforo las pinta de azul.
 */
function filasEnMora(incluirDebito: boolean, hoy: string): FilaMora[] {
  const dias = diasCoberturaPorCompania()
  const periodoAbierto = periodosDisponibles()[0]?.periodo ?? null

  const crudas = db()
    .prepare(
      `${SELECT_PLANILLA}
       WHERE c.dada_de_baja = 0
         AND (c.pago IS NULL OR TRIM(c.pago) = '')
         AND c.dia_vencimiento_numero IS NOT NULL
         AND COALESCE(p.activa, 1) = 1
         AND NOT EXISTS (SELECT 1 FROM pagos pg WHERE pg.poliza_id = c.poliza_id AND pg.periodo = c.periodo)`,
    )
    .all() as FilaCruda[]

  const filas: FilaMora[] = []
  for (const cruda of crudas) {
    const fila = aFila(cruda, dias)
    if (!incluirDebito && esDebitoAutomatico(fila.formaPago)) continue
    const enMora = aFilaMora(fila, hoy, periodoAbierto)
    if (enMora) filas.push(enMora)
  }
  return filas.sort((a, b) => b.diasDeAtraso - a.diasDeAtraso || (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'))
}

function coincideConLaBusqueda(fila: FilaMora, busqueda: string): boolean {
  if (!busqueda) return true
  return [fila.nombre, fila.documento, fila.numeroPoliza, fila.patente].some((valor) =>
    normalizarTexto(valor).replace(/ /g, '').includes(busqueda),
  )
}

/** `hoy` es sólo para las pruebas: en la aplicación siempre es el día de la máquina. */
export function mora(filtros: FiltrosMora, hoy = hoyLocal()): ListadoMora {
  const todas = filasEnMora(filtros.incluirDebito === true, hoy)
  const busqueda = normalizarTexto(filtros.busqueda).replace(/ /g, '')
  const sucursal = limpiar(filtros.sucursal)
  const compania = limpiar(filtros.compania)

  const sinRango = todas.filter(
    (fila) =>
      coincideConLaBusqueda(fila, busqueda) &&
      (!sucursal || mismaCosa(fila.sucursal, sucursal)) &&
      (!compania || mismaCosa(fila.compania, compania)),
  )
  const filas = filtros.rango ? sinRango.filter((fila) => fila.rango === filtros.rango) : sinRango

  const porRango: Record<Exclude<RangoDeMora, ''>, number> = { '1-7': 0, '8-30': 0, '+30': 0 }
  for (const fila of sinRango) porRango[fila.rango]++

  return {
    filas,
    sucursales: distintos(todas.map((f) => f.sucursal)),
    companias: distintos(todas.map((f) => f.compania)),
    total: todas.length,
    totalDeuda: filas.reduce((suma, fila) => suma + (fila.cuotaMonto ?? 0), 0),
    porRango,
    hoy,
  }
}

/** «Avisar» desde la mora: el mismo WhatsApp de la planilla, también para meses ya cerrados. */
export function avisarMora(filaId: string, actor: SesionUsuario, hoy = hoyLocal()): AvisoDeMora {
  const aviso = prepararAvisoDeCuota(filaId, actor, false)
  const periodoAbierto = periodosDisponibles()[0]?.periodo ?? null
  const fila = aFilaMora(aviso.fila, hoy, periodoAbierto)
  if (!fila) throw new ErrorDeNegocio('Esa cuota ya no figura vencida sin pago. Actualizá la pantalla.')
  return { url: aviso.url, mensaje: aviso.mensaje, telefono: aviso.telefono, marcada: aviso.marcada, fila }
}

// ---------------------------------------------------------------------------
// Imputados: la rendición mensual
// ---------------------------------------------------------------------------

/** El período de un pago es el mes que paga; si no se pudo deducir, el mes de la fecha. */
const PERIODO_DEL_PAGO = `COALESCE(p.periodo, substr(p.fecha_iso, 1, 7))`

function periodosConPagos(): string[] {
  const filas = db()
    .prepare(
      `SELECT DISTINCT COALESCE(periodo, substr(fecha_iso, 1, 7)) AS periodo FROM pagos
       WHERE COALESCE(periodo, substr(fecha_iso, 1, 7)) IS NOT NULL
       ORDER BY periodo DESC`,
    )
    .all() as Array<{ periodo: string }>
  return filas.map((f) => f.periodo)
}

export function imputados(periodoPedido: string | null, companiaPedida: string): RendicionImputados {
  const periodos = periodosConPagos()
  const pedido = limpiar(periodoPedido)
  const periodo = pedido && FORMATO_PERIODO.test(pedido) ? pedido : (periodos[0] ?? periodoDeHoy())

  const crudas = db()
    .prepare(`${SELECT_PAGOS} WHERE ${PERIODO_DEL_PAGO} = ? ORDER BY p.fecha_iso, p.cliente_nombre`)
    .all(periodo) as PagoCrudo[]
  const todos = crudas.map(aPagoRegistrado)

  const companias = distintos(todos.map((pago) => pago.compania))
  const compania = companias.find((c) => mismaCosa(c, companiaPedida)) ?? ''
  const pagos = compania ? todos.filter((pago) => mismaCosa(pago.compania, compania)) : todos

  const contadores = Object.fromEntries(RESULTADOS_DE_IMPUTACION.map((r) => [r, 0])) as Record<ResultadoImputacion, number>
  for (const pago of pagos) contadores[pago.resultado]++

  return {
    periodo,
    compania,
    // Sin ningún pago cargado la lista queda vacía a propósito: es lo que la pantalla mira para
    // explicar que la rendición todavía no tiene nada.
    periodos: periodos.length === 0 || periodos.includes(periodo) ? periodos : [periodo, ...periodos],
    companias,
    pagos,
    contadores,
    total: pagos.length,
    totalImporte: pagos.reduce((suma, pago) => suma + (pago.importeMonto ?? 0), 0),
    pendientes: contadores[''],
    sinMes: pagosSinMes(),
    avisoDeSincronizacion: hojaDeImputados().aviso,
  }
}

/**
 * Pagos que vinieron de la hoja con la fecha ilegible y sin MES: no caen en ningún mes, así que no
 * entran en ninguna rendición. La pantalla los cuenta para que la plata no desaparezca en silencio.
 */
function pagosSinMes(): number {
  return (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM pagos WHERE periodo IS NULL AND (fecha_iso IS NULL OR TRIM(fecha_iso) = '')`)
      .get() as { n: number }
  ).n
}

/**
 * Cambia el RESULTADO de un pago y lo manda a la hoja. Si la hoja no tiene una pestaña IMPUTADOS que
 * sirva —o la tiene sin columna RESULTADO— el cambio se guarda igual acá: no se pierde trabajo por
 * cómo esté armada la planilla, y la pantalla lo explica.
 */
export function cambiarResultado(
  pagoId: number,
  resultado: ResultadoImputacion,
  companiaDelFiltro: string,
  actor: SesionUsuario,
): RendicionImputados {
  const identificador = enteroPositivo(pagoId, 'El pago')
  if (!(RESULTADOS_DE_IMPUTACION as readonly string[]).includes(resultado)) {
    throw new ErrorDeNegocio('Ese resultado no está en la lista (vacío, IMPUTADO, OK, REVISAR o MAL).')
  }
  const pago = db().prepare(`${SELECT_PAGOS} WHERE p.id = ?`).get(identificador) as PagoCrudo | undefined
  if (!pago) throw new ErrorDeNegocio('No se encontró ese pago.')

  if (normalizarResultado(pago.resultado) !== resultado) {
    db().prepare('UPDATE pagos SET resultado = ?, actualizado_en = ? WHERE id = ?').run(resultado || null, ahoraIso(), identificador)

    const hoja = hojaDeImputados()
    if (hoja.pestana && hoja.tieneColumnaResultado) {
      // Si el pago todavía no está en la pestaña, primero se agrega entero: la fila nueva ya lleva el
      // resultado adentro y no hace falta un segundo cambio.
      if (asegurarPagoEnLaHoja(identificador, actor) === 'actualizar') {
        encolar({ operacion: 'actualizar', pestana: hoja.pestana, filaId: pago.fila_id, campos: { resultado } }, actor)
      }
    }

    registrarCambio(actor, {
      accion: 'imputacion',
      tabla: 'pagos',
      registroId: identificador,
      filaId: pago.fila_id,
      campo: 'RESULTADO',
      valorAnterior: pago.resultado,
      valorNuevo: resultado || null,
    })
  }
  return imputados(pago.periodo, companiaDelFiltro)
}

// ---------------------------------------------------------------------------
// Comisiones
// ---------------------------------------------------------------------------

/**
 * Lo cobrado y la comisión estimada de cada compañía en el mes. Es una estimación a propósito: la
 * comisión de verdad la liquida cada compañía y llega después; esto sirve para saber qué esperar.
 */
export function comisiones(periodoPedido: string | null): ResumenComisiones {
  sincronizarCompanias()
  const periodos = periodosConPagos()
  const pedido = limpiar(periodoPedido)
  const periodo = pedido && FORMATO_PERIODO.test(pedido) ? pedido : (periodos[0] ?? periodoDeHoy())

  const crudas = db()
    .prepare(
      `SELECT p.compania AS compania, COUNT(*) AS pagos, SUM(COALESCE(p.importe_monto, 0)) AS cobrado
       FROM pagos p WHERE ${PERIODO_DEL_PAGO} = ? GROUP BY p.compania`,
    )
    .all(periodo) as Array<{ compania: string | null; pagos: number; cobrado: number }>

  const porcentajes = comisionPorCompania()
  const nombres = new Map(listarCompanias().map((c) => [normalizarTexto(c.nombre), c.nombre]))
  const acumulado = new Map<string, FilaComision>()
  for (const cruda of crudas) {
    const etiqueta = limpiar(cruda.compania) || '(sin compañía)'
    const clave = normalizarTexto(etiqueta)
    const porcentaje = porcentajes[clave] ?? 0
    const previo = acumulado.get(clave) ?? { compania: nombres.get(clave) ?? etiqueta, pagos: 0, cobrado: 0, porcentaje, comision: 0 }
    previo.pagos += cruda.pagos
    previo.cobrado += cruda.cobrado
    // Se redondea a centavos una sola vez, sobre el total de la compañía.
    previo.comision = Math.round(previo.cobrado * porcentaje) / 100
    acumulado.set(clave, previo)
  }

  const filas = [...acumulado.values()].sort((a, b) => b.cobrado - a.cobrado || a.compania.localeCompare(b.compania, 'es'))
  return {
    periodo,
    periodos: periodos.includes(periodo) ? periodos : [periodo, ...periodos],
    filas,
    cobrado: filas.reduce((suma, fila) => suma + fila.cobrado, 0),
    comision: filas.reduce((suma, fila) => suma + fila.comision, 0),
    sinPorcentaje: filas.filter((fila) => fila.porcentaje === 0 && fila.cobrado > 0).map((fila) => fila.compania),
  }
}
