// Cobranzas: la caja del día, la mora, la rendición mensual (la pestaña IMPUTADOS) y las comisiones.
//
// Los pagos son siempre los mismos: los que nacen de «Registrar pago» en la Cartera y los que se
// cargan a mano acá. Esta pantalla los mira de tres maneras distintas —por día, por mes y por
// compañía—, así que todo sale de la misma tabla `pagos` y de `pagos.ts`.
import { coincideAlguno, dentroDelRango, listaDeFiltro } from '../../shared/filtros'
import { esDebitoAutomatico, fechaDeVencimiento, hoyLocal, periodoDeHoy } from '../../shared/semaforo'
import { veLosNumerosDeLaAgencia } from '../../shared/permisos'
import { claveDeSucursal, mismaSucursal, mismaSucursalOVacia, SIN_SUCURSAL } from '../../shared/sucursales'
import {
  RANGOS_DE_MORA,
  RESULTADOS_DE_IMPUTACION,
  type AvisoDeMora,
  type CajaDelDia,
  type DatosDeMovimientoDeCaja,
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
  idDelAdelantoDeLaCuota,
  idDelPagoDeLaCuota,
  periodosDisponibles,
  prepararAvisoDeCuota,
  registrarPago,
  SELECT_PLANILLA,
  type FilaCruda,
} from './cartera'
import { comisionPorCompania, diasCoberturaPorCompania, listarCompanias, sincronizarCompanias } from './companias'
import { sucursalesParaElegir } from './sucursales'
import { arqueoDeLaCaja, borrarMovimientoDeCaja, grupoDelMedio, guardarMovimientoDeCaja } from './caja'
import { paraNombreDeArchivo } from './exportacion'
import { construirXlsx, type HojaXlsx, type ValorDeCelda } from './xlsx'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { encolar } from '../sincronizacion/cola'
import {
  anularPago as anularPagoDeLaBase,
  aPagoRegistrado,
  asegurarPagoEnLaHoja,
  guardarNumeroDeTicket,
  guardarPago,
  hojaDeImputados,
  marcarPagoRevisado,
  normalizarEstadoDeCobro,
  normalizarResultado,
  PAGO_QUE_CUBRE_LA_CUOTA,
  SELECT_PAGOS,
  SUCURSAL_DEL_PAGO,
  type PagoCrudo,
} from './pagos'
import { booleano, enteroPositivo, texto } from './validacion'

const FORMATO_ISO = /^\d{4}-\d{2}-\d{2}$/
const FORMATO_PERIODO = /^\d{4}-\d{2}$/

function exigirFecha(valor: string | null): string {
  const limpia = limpiar(valor)
  if (!limpia) return hoyLocal()
  if (!FORMATO_ISO.test(limpia)) throw new ErrorDeNegocio(`«${limpia}» no es una fecha válida.`)
  return limpia
}

function mismaCosa(a: unknown, b: unknown): boolean {
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

/**
 * Las sucursales que pueden aparecer en la caja: las del catálogo, más las que traen los pagos, más
 * `SIN_SUCURSAL` cuando hay al menos un pago cuya sucursal —resuelta igual que `pago.sucursal`, con el
 * respaldo del cliente incluido— sigue sin ninguna. El caso real es un cliente cargado sin sucursal:
 * sin ese respaldo, ese pago no tenía ninguna opción del desplegable que lo trajera.
 *
 * La detección usa `SUCURSAL_DEL_PAGO` —la misma expresión de `SELECT_PAGOS`— y no el COALESCE corto
 * de acá arriba: un pago sin `sucursal_cobro` ni `sucursal_texto` —todo el historial importado antes
 * de que la app empezara a guardar `sucursal_cobro`— igual tiene sucursal si el cliente la sabe, y
 * contarlo como «sin sucursal» ofrecería la opción para pagos que en realidad sí tienen mostrador.
 */
function sucursalesDeLaCaja(): string[] {
  const deLosPagos = (
    db().prepare('SELECT DISTINCT COALESCE(sucursal_cobro, sucursal_texto) AS valor FROM pagos').all() as Array<{ valor: string | null }>
  ).map((f) => f.valor)
  const opciones = sucursalesParaElegir(deLosPagos)
  const resueltas = (
    db().prepare(`SELECT ${SUCURSAL_DEL_PAGO} AS valor FROM pagos p LEFT JOIN clientes cl ON cl.id = p.cliente_id`).all() as Array<{
      valor: string | null
    }>
  ).map((f) => f.valor)
  const haySinSucursal = resueltas.some((valor) => !claveDeSucursal(valor))
  return haySinSucursal ? [...opciones, SIN_SUCURSAL] : opciones
}

/** Los pagos que son plata que entró: un IMPUTADO todavía no se cobró y no suma a la caja. */
function cobrados(pagos: PagoRegistrado[]): PagoRegistrado[] {
  return pagos.filter((pago) => pago.estadoCobro === 'PAGO')
}

function totalesPorMedio(pagos: PagoRegistrado[]): TotalPorMedio[] {
  const acumulado = new Map<string, TotalPorMedio>()
  for (const pago of cobrados(pagos)) {
    const etiqueta = limpiar(pago.medio) || '(sin especificar)'
    const clave = normalizarTexto(etiqueta)
    const previo = acumulado.get(clave) ?? { medio: etiqueta, pagos: 0, total: 0 }
    previo.pagos++
    previo.total += pago.importeMonto ?? 0
    acumulado.set(clave, previo)
  }
  return [...acumulado.values()].sort((a, b) => b.total - a.total || a.medio.localeCompare(b.medio, 'es'))
}

/**
 * Qué sucursales de LA CAJA DEL DÍA puede mirar quien pregunta. Un administrador (SUPER_ADMIN o ADMIN)
 * ve la de todas; un empleado, sólo la de su mostrador. Es una regla de ROL, como la de los números de
 * la agencia (ver `veLosNumerosDeLaAgencia`): la caja de las otras sucursales es la plata que entró en
 * otro mostrador, y quien la mira desde arriba es quien administra la agencia.
 *
 * Es SÓLO de la caja del día y no de la rendición de Imputados, aunque las dos pantallas vivan en
 * Cobranzas. La caja es plata: cuánto entró hoy en cada mostrador. La rendición es una planilla de
 * control contra la compañía —qué dijo de cada pago del mes—, la agencia la cierra una vez por mes
 * entre todos, y partirla por mostrador dejaba a cada sucursal viendo un pedazo de una cuenta que es
 * una sola. Por eso Imputados quedó abierta a los tres roles y esto no se usa ahí.
 *
 * Devuelve '' cuando no hay restricción (también cuando no se sabe quién pregunta: los llamados
 * internos y las pruebas). Se compara por sucursal, no por usuario: dos personas del mismo mostrador
 * se ven entre sí, que es exactamente lo que faltaba en Lanús.
 */
export function sucursalObligadaDe(actor: SesionUsuario | null | undefined): string {
  if (!actor || actor.rol !== 'EMPLEADO') return ''
  return actor.sucursal.nombre
}

export function cajaDelDia(fechaPedida: string | null, sucursalesPedidas: string[], actor?: SesionUsuario | null): CajaDelDia {
  const fecha = exigirFecha(fechaPedida)
  const obligada = sucursalObligadaDe(actor)
  const todas = sucursalesDeLaCaja()
  const disponibles = obligada ? todas.filter((s) => mismaSucursal(s, obligada)) : todas
  // Con sucursal obligada, lo pedido no cuenta: se mira la del mostrador y nada más.
  //
  // El `?? obligada` es a propósito y no sobra. Hoy `sucursalesDeLaCaja()` pasa por
  // `sucursalesParaElegir`, que siembra siempre las cuatro de la agencia, así que `disponibles` nunca
  // queda vacía para un mostrador de verdad. Pero si algún día dejara de sembrarlas —o si a alguien le
  // quedara cargada una sucursal fuera del catálogo—, `disponibles` sería `[]`, y acá una lista vacía
  // quiere decir «todas»: el empleado vería la caja de TODAS las sucursales. Este filtro tiene que
  // fallar cerrado, nunca abierto, y no puede depender de que otra función siga sembrando el catálogo.
  const sucursales = obligada
    ? [disponibles[0] ?? obligada]
    : listaDeFiltro(sucursalesPedidas).flatMap((pedida) => {
        const encontrada = disponibles.find((s) => mismaSucursal(s, pedida))
        return encontrada ? [encontrada] : []
      })

  const crudas = db().prepare(`${SELECT_PAGOS} WHERE p.fecha_iso = ? ORDER BY p.creado_en, p.id`).all(fecha) as PagoCrudo[]
  const pagos = crudas.map(aPagoRegistrado).filter((pago) => coincideAlguno(sucursales, pago.sucursal, mismaSucursalOVacia))

  return {
    fecha,
    sucursalesElegidas: sucursales,
    sucursales: disponibles,
    sucursalFija: obligada !== '',
    mediosDePago: catalogos().mediosDePago,
    pagos,
    totalesPorMedio: totalesPorMedio(pagos),
    total: cobrados(pagos).reduce((suma, pago) => suma + (pago.importeMonto ?? 0), 0),
    sinImporte: cobrados(pagos).filter((pago) => pago.importeMonto === null).length,
    imputados: pagos.length - cobrados(pagos).length,
    // La caja chica es de UN mostrador: la del cajón que se abre a la mañana y se cuenta a la noche.
    // Con varias sucursales a la vista (o con todas) no hay una caja chica que mostrar, y sumarlas
    // daría un número que no es el de ningún cajón.
    arqueo: sucursales.length === 1 ? arqueoDeLaCaja(fecha, sucursales[0]!, pagos) : null,
    hoy: hoyLocal(),
  }
}

/** Los encabezados de la planilla de caja de la agencia, en su orden (columnas A a K). */
const COLUMNAS_DE_LA_PLANILLA = [
  'NRO TICKET',
  'PATENTE',
  'DESCRIPCION',
  'DEBE',
  'HABER',
  'POSNET MP',
  'MP',
  'REVISIÓN DE PAGO',
  'OBSERVACIONES',
  'CIA ASEGURADA',
  'POLIZA',
]

const ANCHOS_DE_LA_PLANILLA = [12, 12, 34, 14, 14, 14, 14, 16, 34, 18, 18]

/** El día como lo escribe la agencia, para el título de la planilla. */
function comoDiaCorto(fechaIso: string): string {
  const [anio, mes, dia] = fechaIso.split('-')
  return dia && mes && anio ? `${dia}/${mes}/${anio}` : fechaIso
}

/**
 * El día de caja con la forma de la planilla de la agencia: una fila por cobro con el ticket, la
 * patente, el nombre, el DEBE, el HABER, el posnet, las transferencias, el tilde de revisión, las
 * observaciones, la compañía y la póliza; y abajo el resumen con las cuentas hechas.
 *
 * Es a propósito la MISMA forma que la planilla que se lleva a mano: quien la mira ya sabe leerla, y
 * el mes se puede seguir armando con un archivo por día como hasta ahora. Lo único que cambia es que
 * las cuentas ya vienen hechas y los cobros no se copian de nuevo.
 *
 * La mitad de abajo (la caja chica) sale sólo cuando se está mirando UN mostrador: la caja chica es el
 * cambio que tiene ese cajón, y sumar la de dos sucursales no es la caja de ninguna.
 */
export function hojaDeLaCaja(caja: CajaDelDia): HojaXlsx {
  const arqueo = caja.arqueo
  const filas: ValorDeCelda[][] = []
  const renglon = (celdas: Partial<Record<number, ValorDeCelda>>): ValorDeCelda[] =>
    COLUMNAS_DE_LA_PLANILLA.map((_, indice) => celdas[indice] ?? null)

  // Fila 2 de la planilla: con cuánto cambio se abrió el día.
  if (arqueo) {
    filas.push(
      renglon({
        2: 'CAJA CHICA AL ABRIR',
        3: arqueo.apertura,
        8: arqueo.aperturaCargada
          ? null
          : arqueo.aperturaHeredadaDe
            ? `arrastrada del cierre del ${comoDiaCorto(arqueo.aperturaHeredadaDe)}`
            : 'sin cargar',
      }),
    )
  }

  for (const pago of caja.pagos) {
    const grupo = grupoDelMedio(pago.medio)
    const cobrado = pago.estadoCobro === 'PAGO' ? pago.importeMonto : null
    filas.push(
      renglon({
        0: pago.numeroTicket,
        1: pago.patente,
        2: pago.clienteNombre,
        3: cobrado ?? (pago.estadoCobro === 'PAGO' ? pago.importe : null),
        5: grupo === 'POSNET' ? cobrado : null,
        6: grupo === 'TRANSFERENCIA' ? cobrado : null,
        7: pago.revisado ? '✔' : null,
        8: [
          pago.observaciones,
          pago.medio ? `PAGO S/${pago.medio}` : null,
          pago.estadoCobro === 'IMPUTADO' ? 'IMPUTADO · FALTA COBRAR' : null,
          pago.adelantoModo ? 'PAGO ADELANTADO' : null,
          pago.usuarioNombre ? `COBRÓ ${pago.usuarioNombre}` : null,
        ]
          .filter(Boolean)
          .join(' / '),
        9: pago.compania,
        10: pago.numeroPoliza,
      }),
    )
  }

  // Lo que bajó a la caja fuerte va en la columna HABER, en su propio renglón: en la planilla a mano
  // se escribe al lado del cobro que lo generó, pero la plata que baja no es siempre la de un cobro
  // (a veces es el vuelto que quedó, a veces son dos cobros juntos).
  for (const movimiento of arqueo?.movimientos ?? []) {
    if (movimiento.tipo !== 'CAJA_FUERTE') continue
    filas.push(renglon({ 2: 'A LA CAJA FUERTE', 4: movimiento.importe, 8: movimiento.detalle }))
  }

  if (arqueo) {
    filas.push(renglon({ 2: 'TOTALES', 3: arqueo.debe, 4: arqueo.aLaCajaFuerte, 5: arqueo.posnet, 6: arqueo.transferencia }))
    filas.push([])
    filas.push(renglon({ 2: 'RESUMEN DEL DÍA', 8: 'TOTAL' }))
    filas.push(renglon({ 2: 'POSNET MP', 4: arqueo.posnet, 8: arqueo.haber }))
    filas.push(renglon({ 2: 'M.P/T.B', 4: arqueo.transferencia, 8: arqueo.debe }))
    if (arqueo.otros > 0) filas.push(renglon({ 2: 'OTROS MEDIOS', 4: arqueo.otros }))
    for (const movimiento of arqueo.movimientos) {
      if (movimiento.tipo !== 'GASTO') continue
      filas.push(renglon({ 2: 'GASTOS', 4: movimiento.importe, 5: movimiento.detalle }))
    }
    if (!arqueo.movimientos.some((movimiento) => movimiento.tipo === 'GASTO')) filas.push(renglon({ 2: 'GASTOS', 4: 0 }))
    filas.push(renglon({ 2: 'EFECTIVO', 4: arqueo.aLaCajaFuerte, 5: 'a la caja fuerte' }))
    filas.push(
      renglon({
        2: 'CAJA CHICA',
        4: arqueo.contado ?? arqueo.esperado,
        5: arqueo.contado === null ? 'lo que debería quedar' : 'contado al cerrar',
      }),
    )
    filas.push(renglon({ 2: 'TOTAL', 3: arqueo.debe, 4: arqueo.haber }))
    // La diferencia del arqueo es lo mismo que la distancia entre los dos totales de acá arriba, así
    // que va una sola vez y con el nombre que se entiende: lo contado contra lo que dicen las cuentas.
    if (arqueo.contado !== null && arqueo.diferencia !== 0) {
      filas.push(
        renglon({
          2: 'DIFERENCIA',
          4: Math.abs(arqueo.diferencia ?? 0),
          5: (arqueo.diferencia ?? 0) > 0 ? 'sobra en el cajón' : 'falta en el cajón',
        }),
      )
    }
  } else {
    filas.push(renglon({ 2: 'TOTAL COBRADO', 3: caja.total }))
    filas.push([])
    filas.push(renglon({ 2: 'La caja chica se lleva por mostrador: elegí una sola sucursal para que salgan sus cuentas.' }))
  }

  const donde = caja.sucursalesElegidas.length > 0 ? caja.sucursalesElegidas.join(', ') : 'todas las sucursales'
  return {
    // La pestaña se llama como las de la agencia: el día y el mes pegados («0109»).
    nombre: `${caja.fecha.slice(8, 10)}${caja.fecha.slice(5, 7)}`,
    titulo: `CAJA DEL ${comoDiaCorto(caja.fecha)} · ${donde}`,
    encabezados: COLUMNAS_DE_LA_PLANILLA,
    filas,
    anchos: ANCHOS_DE_LA_PLANILLA,
  }
}

/** El día de caja en un .xlsx, listo para guardar, imprimir o mandarle al contador. */
export function planillaDeLaCaja(
  fechaPedida: string | null,
  sucursalesPedidas: string[],
  actor?: SesionUsuario | null,
): { nombre: string; contenido: Buffer } {
  const caja = cajaDelDia(fechaPedida, sucursalesPedidas, actor)
  const sufijo = caja.sucursalesElegidas.length > 0 ? ` ${caja.sucursalesElegidas.join(' ')}` : ''
  return {
    nombre: `${paraNombreDeArchivo(`CAJA ${caja.fecha}${sufijo}`)}.xlsx`,
    contenido: construirXlsx([hojaDeLaCaja(caja)]),
  }
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
    registrarPago(
      cuotaFilaId,
      {
        fecha,
        importe: limpiar(datos.importe),
        medioDePago: limpiar(datos.medioDePago),
        sucursal,
        estadoCobro: datos.estadoCobro,
        alcance: datos.alcance,
        adelanto: datos.adelanto,
      },
      actor,
    )
    // El ticket es del pago de este mes; si sólo se adelantó la cuota que viene, del adelanto.
    const pagoId = (datos.alcance === 'ADELANTADO' ? idDelAdelantoDeLaCuota(cuotaFilaId) : idDelPagoDeLaCuota(cuotaFilaId)) ?? idDelAdelantoDeLaCuota(cuotaFilaId)
    if (pagoId === null) throw new ErrorDeNegocio('El pago se guardó pero no se pudo leer de vuelta. Actualizá la pantalla.')
    return { caja: cajaDelDia(interpretada.iso, sucursal ? [sucursal] : [], actor), pagoId }
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
      estadoCobro: normalizarEstadoDeCobro(datos.estadoCobro),
      adelantoModo: null,
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
  return { caja: cajaDelDia(interpretada.iso, sucursal ? [sucursal] : [], actor), pagoId }
}

// ---------------------------------------------------------------------------
// La caja chica: los renglones que se cargan a mano
// ---------------------------------------------------------------------------

/**
 * La sucursal en la que este usuario puede tocar la caja chica. Un empleado, la suya y ninguna otra:
 * es la misma regla con la que ve la caja del día (`sucursalObligadaDe`), y tiene que valer también
 * para escribir, no sólo para mirar. Un administrador carga la del mostrador que elija.
 */
function sucursalParaLaCaja(pedida: string, actor: SesionUsuario): string {
  const obligada = sucursalObligadaDe(actor)
  if (!obligada) return limpiar(pedida) || actor.sucursal.nombre
  const elegida = limpiar(pedida)
  if (elegida && !mismaSucursal(elegida, obligada)) {
    throw new ErrorDeNegocio(`La caja de ${elegida} la lleva ese mostrador. Vos cargás la de ${obligada}.`)
  }
  return obligada
}

/** Carga (o corrige) un renglón de la caja chica y devuelve la caja de ese día ya rehecha. */
export function cargarMovimientoDeCaja(datos: DatosDeMovimientoDeCaja, actor: SesionUsuario): CajaDelDia {
  const sucursal = sucursalParaLaCaja(datos?.sucursal ?? '', actor)
  const { movimiento } = guardarMovimientoDeCaja({ ...datos, sucursal }, actor)
  return cajaDelDia(movimiento.fecha, [movimiento.sucursal], actor)
}

/** Saca un renglón de la caja chica y devuelve la caja de ese día ya rehecha. */
export function quitarMovimientoDeCaja(movimientoId: unknown, actor: SesionUsuario): CajaDelDia {
  const id = enteroPositivo(movimientoId, 'El renglón de la caja')
  const dueno = db().prepare('SELECT sucursal FROM caja_movimientos WHERE id = ?').get(id) as { sucursal: string } | undefined
  if (!dueno) throw new ErrorDeNegocio('Ese renglón de la caja ya no está.')
  sucursalParaLaCaja(dueno.sucursal, actor)
  const movimiento = borrarMovimientoDeCaja(id, actor)
  return cajaDelDia(movimiento.fecha, [movimiento.sucursal], actor)
}

/** El día y el mostrador de un pago: es adónde vuelve la pantalla después de tocarlo. */
function diaDelPago(pagoId: number): { fecha: string; sucursal: string } {
  const pago = db()
    .prepare(`SELECT p.fecha_iso, ${SUCURSAL_DEL_PAGO} AS sucursal FROM pagos p LEFT JOIN clientes cl ON cl.id = p.cliente_id WHERE p.id = ?`)
    .get(pagoId) as { fecha_iso: string | null; sucursal: string | null } | undefined
  if (!pago) throw new ErrorDeNegocio('No se encontró ese pago.')
  return { fecha: pago.fecha_iso ?? hoyLocal(), sucursal: limpiar(pago.sucursal) }
}

/** El tilde de REVISIÓN DE PAGO: el cobro se miró y está todo bien. */
export function revisarPago(pagoId: unknown, revisado: unknown, actor: SesionUsuario): CajaDelDia {
  const id = enteroPositivo(pagoId, 'El pago')
  const dia = diaDelPago(id)
  sucursalParaLaCaja(dia.sucursal, actor)
  marcarPagoRevisado(id, booleano(revisado, 'El tilde de revisión'), actor)
  return cajaDelDia(dia.fecha, dia.sucursal ? [dia.sucursal] : [], actor)
}

/** El número del comprobante escrito a mano (el de la ticketeadora se guarda solo al imprimir). */
export function numeroDeTicketDelPago(pagoId: unknown, numero: unknown, actor: SesionUsuario): CajaDelDia {
  const id = enteroPositivo(pagoId, 'El pago')
  const dia = diaDelPago(id)
  sucursalParaLaCaja(dia.sucursal, actor)
  if (typeof numero !== 'string') throw new ErrorDeNegocio('El número de ticket no es válido.')
  guardarNumeroDeTicket(id, numero, actor)
  return cajaDelDia(dia.fecha, dia.sucursal ? [dia.sucursal] : [], actor)
}

/** Anula un pago cargado por error y devuelve la caja de ese día ya rehecha. */
export function anularPago(pagoId: unknown, motivo: unknown, actor: SesionUsuario): CajaDelDia {
  const id = enteroPositivo(pagoId, 'El pago')
  const dia = diaDelPago(id)
  sucursalParaLaCaja(dia.sucursal, actor)
  anularPagoDeLaBase(id, motivo, actor)
  return cajaDelDia(dia.fecha, dia.sucursal ? [dia.sucursal] : [], actor)
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
    imputada: fila.pagoImputado,
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
         AND NOT ${PAGO_QUE_CUBRE_LA_CUOTA}`,
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
  const sucursales = listaDeFiltro(filtros.sucursales)
  const companias = listaDeFiltro(filtros.companias)
  const fechas = listaDeFiltro(filtros.fechas)

  const sinRango = todas.filter(
    (fila) =>
      coincideConLaBusqueda(fila, busqueda) &&
      coincideAlguno(sucursales, fila.sucursal, mismaSucursal) &&
      coincideAlguno(companias, fila.compania, mismaCosa) &&
      coincideAlguno(fechas, fila.vencimiento) &&
      dentroDelRango(fila.vencimiento, filtros.desde, filtros.hasta),
  )
  const rangos = listaDeFiltro(filtros.rangos).filter((r): r is Exclude<RangoDeMora, ''> =>
    (RANGOS_DE_MORA as readonly string[]).includes(r) && r !== '',
  )
  const filas = rangos.length > 0 ? sinRango.filter((fila) => rangos.includes(fila.rango)) : sinRango

  const porRango: Record<Exclude<RangoDeMora, ''>, number> = { '1-7': 0, '8-30': 0, '+30': 0 }
  for (const fila of sinRango) porRango[fila.rango]++

  return {
    filas,
    // La sucursal que hoy no debe nada igual tiene que estar en el desplegable: si no aparece, desde
    // el mostrador parece que la mora es de las otras y que a esta pantalla le falta la sucursal.
    sucursales: sucursalesParaElegir(todas.map((f) => f.sucursal)),
    companias: distintos(todas.map((f) => f.compania)),
    fechas: distintos(todas.map((f) => f.vencimiento)).sort(),
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

/**
 * La rendición del mes contra las compañías. La ven ENTERA los tres roles, y la sucursal es un filtro
 * más —como la compañía—, no un recorte que se impone por rol.
 *
 * Por qué no se recorta como la caja del día: la rendición es UNA sola cuenta por mes contra cada
 * compañía. Un pago que se cobró en Lanús y una compañía que lo rechaza son el mismo problema para
 * toda la agencia, y quien se sienta a cerrar el mes necesita ver los pendientes de las cuatro
 * sucursales para saber si terminó. Con la rendición partida por mostrador nadie veía el total, cada
 * sucursal cerraba lo suyo sin saber qué faltaba y los pendientes de las otras no aparecían en ningún
 * lado.
 *
 * Lo único que SIGUE recortado por rol es el total en pesos del mes (`totalImporte`), que viene en
 * null para un empleado. Abrir la rendición a las cuatro sucursales convirtió ese número en el bruto
 * cobrado del mes por toda la agencia, que es exactamente lo que describe `veLosNumerosDeLaAgencia` en
 * permisos.ts y lo que la agencia pidió no mostrar. Las filas se ven enteras, con su importe cada una
 * —eso es el trabajo del día y un empleado ya lo ve en la mora y en la planilla—; lo que no se ve es
 * la suma. La cuenta de PAGOS, que es lo que sirve para saber cuánto falta rendir, se ve siempre.
 */
export function imputados(
  periodoPedido: string | null,
  companiasPedidas: string[],
  sucursalesPedidas: string[] = [],
  veLosNumeros = true,
): RendicionImputados {
  const periodos = periodosConPagos()
  const pedidas = listaDeFiltro(companiasPedidas)
  const pedido = limpiar(periodoPedido)
  const periodo = pedido && FORMATO_PERIODO.test(pedido) ? pedido : (periodos[0] ?? periodoDeHoy())

  // Las mismas opciones que ofrece la caja: las cuatro del catálogo más las que traigan los pagos.
  const sucursalesDisponibles = sucursalesDeLaCaja()
  // Lo pedido se pliega contra lo que existe, igual que las compañías: un nombre que no está en la
  // lista se descarta en vez de vaciar la pantalla sin explicación.
  const sucursales = listaDeFiltro(sucursalesPedidas).flatMap((pedidaSucursal) => {
    const encontrada = sucursalesDisponibles.find((s) => mismaSucursal(s, pedidaSucursal))
    return encontrada ? [encontrada] : []
  })

  const crudas = db()
    .prepare(`${SELECT_PAGOS} WHERE ${PERIODO_DEL_PAGO} = ? ORDER BY p.fecha_iso, p.cliente_nombre`)
    .all(periodo) as PagoCrudo[]
  const todos = crudas.map(aPagoRegistrado).filter((pago) => coincideAlguno(sucursales, pago.sucursal, mismaSucursalOVacia))

  const companiasDisponibles = distintos(todos.map((pago) => pago.compania))
  // Se devuelven las compañías tal como las escribe el mes, no como llegaron del filtro: así el
  // desplegable se ve elegido aunque en la pantalla anterior estuvieran escritas de otra forma. Una
  // que este mes no tiene ningún pago se cae sola, que es lo mismo que hacía la versión de un valor.
  const companias = companiasDisponibles.filter((c) => pedidas.some((pedida) => mismaCosa(c, pedida)))
  const pagos = companias.length > 0 ? todos.filter((pago) => companias.some((c) => mismaCosa(pago.compania, c))) : todos

  const contadores = Object.fromEntries(RESULTADOS_DE_IMPUTACION.map((r) => [r, 0])) as Record<ResultadoImputacion, number>
  for (const pago of pagos) contadores[pago.resultado]++

  return {
    periodo,
    companiasElegidas: companias,
    sucursalesElegidas: sucursales,
    sucursales: sucursalesDisponibles,
    // Sin ningún pago cargado la lista queda vacía a propósito: es lo que la pantalla mira para
    // explicar que la rendición todavía no tiene nada.
    periodos: periodos.length === 0 || periodos.includes(periodo) ? periodos : [periodo, ...periodos],
    companias: companiasDisponibles,
    pagos,
    contadores,
    total: pagos.length,
    totalImporte: veLosNumeros ? pagos.reduce((suma, pago) => suma + (pago.importeMonto ?? 0), 0) : null,
    pendientes: contadores[''],
    sinCobrar: pagos.filter((pago) => pago.estadoCobro === 'IMPUTADO').length,
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
 *
 * Se rinde cualquier pago del mes, sea de la sucursal que sea. Antes un empleado sólo podía tocar los
 * de su mostrador, y como la rendición ahora se ve entera, dejar la mitad de las filas mirando pero
 * sin poder tocarse sería peor que no mostrarlas: la pantalla ofrecería un desplegable que devuelve un
 * error rojo. Quién lo tocó queda anotado en el historial de siempre, que es lo que hace falta para
 * poder preguntar después.
 */
export function cambiarResultado(
  pagoId: number,
  resultado: ResultadoImputacion,
  companiasDelFiltro: string[],
  actor: SesionUsuario,
  sucursalesDelFiltro: string[] = [],
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
    if (hoja.tieneColumnaResultado) {
      // Si el pago todavía no está en la pestaña, primero se agrega entero: la fila nueva ya lleva el
      // resultado adentro y no hace falta un segundo cambio.
      const lugar = asegurarPagoEnLaHoja(identificador, actor)
      if (lugar?.operacion === 'actualizar') {
        encolar({ operacion: 'actualizar', pestana: lugar.pestana, filaId: pago.fila_id, campos: { resultado } }, actor)
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
  return imputados(pago.periodo, listaDeFiltro(companiasDelFiltro), listaDeFiltro(sucursalesDelFiltro), veLosNumerosDeLaAgencia(actor.rol))
}

// ---------------------------------------------------------------------------
// Comisiones
// ---------------------------------------------------------------------------

/**
 * Lo cobrado y la comisión estimada de cada compañía en el mes. Es una estimación a propósito: la
 * comisión de verdad la liquida cada compañía y llega después; esto sirve para saber qué esperar.
 *
 * Calculada ACÁ MISMO contra la copia SQLite de esta PC. Desde que existe el cálculo server-side (ver
 * servicios/metricas.comisiones.ts del lado del servidor y servicios/cobranzasDesdeCache.ts acá), la
 * pantalla ya no llama a esta función directamente: `cobranzas:comisiones` en ipc.ts usa
 * `comisionesConCache`, que lee el payload cacheado del servidor y cae acá sólo como respaldo y como
 * algoritmo de referencia para el cotejo. Misma nota que `tableroDeMetricasLocal` en metricas.ts.
 */
export function comisionesLocal(periodoPedido: string | null): ResumenComisiones {
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
