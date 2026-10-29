// Consulta del listado de Vencimientos de Cuotas (ver el contrato en shared/listados/index.ts). Es de sólo lectura: nada de
// escribir en la base ni de mandar algo al servidor. Una fila por cuota de la planilla mensual (`cuotas_mes`), que es
// la misma tabla de la que viven Cartera → Planilla del mes y las pestañas de Cobranzas (Mora, Imputados).
//
// Las reglas son las de esas pantallas, no una versión nueva:
//  - Las filas salen de `SELECT_PLANILLA` (cartera.ts), con el mismo `pago_registrado`/`pago_imputado` y el mismo
//    COALESCE de compañía, número de póliza y forma de pago que ve la planilla.
//  - «Pagada» = fecha en CUANDO PAGO o pago registrado en la aplicación (`estaPagada` de la planilla). Un texto que no
//    es fecha («A/D», «DÉBITO») deja la cuota sin pagar, como en la planilla.
//  - «Vencida» = su fecha de vencimiento (`fechaDeVencimiento`: día de la cuota dentro del período) es anterior a hoy
//    y es una cuota que la Mora SÍ persigue: CUANDO PAGO vacío, sin pago que la cubra (`PAGO_QUE_CUBRE_LA_CUOTA`) y
//    que no se cobre sola (`esDebitoAutomatico`). Si la fecha pasó pero la Mora la descarta por alguno de esos motivos
//    sale «Sin mora», para que «Solo cuotas vencidas» sea la deuda real a perseguir. No se descuenta la cobertura
//    financiera de la compañía (matiz del semáforo). Diferencia que queda: la Mora sólo mira pólizas activas.
//  - «Anulada» = la cuota se dio de baja de la planilla (desapareció de la hoja o se borró en otra PC) o la póliza está
//    inactiva SIN haberse renovado (igual que el listado de Vencimientos de Cartera). Si la dada de baja es la fila
//    vieja que reemplazó una renovación (hay póliza sucesora) sale «Renovada»: la póliza no se anuló, se renovó.
import { coincideAlguno, listaDeFiltro, mismoTextoDeFiltro } from '../../shared/filtros'
import { pareceIso } from '../../shared/polizas'
import { mismaRama, ramaDeVehiculo, NOMBRE_RAMA } from '../../shared/ramas'
import { describirRiesgo, esVehiculo, leerIntegrantes, nombreDeTipoDeRiesgo } from '../../shared/riesgos'
import { esDebitoAutomatico, fechaDeVencimiento, hoyLocal } from '../../shared/semaforo'
import type { EstadoDeCuota, FilaDeCuota, FiltrosDeCuotas } from '../../shared/listados/cuotas'
import { db } from '../db/base'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import { aFila, SELECT_PLANILLA, type FilaCruda as FilaDePlanillaCruda } from './cartera'
import { PAGO_QUE_CUBRE_LA_CUOTA } from './pagos'
import { objeto } from './validacion'

/** La fila de la planilla más lo que el listado necesita para describir el riesgo y saber si está anulada. */
interface FilaCruda extends FilaDePlanillaCruda {
  dada_de_baja: number
  tiene_sucesora: number
  /** 1 si hay un pago (no imputado) de la fila o del período que la cubre: lo que la Mora descarta con `PAGO_QUE_CUBRE_LA_CUOTA`. */
  pago_cubre: number
  direccion_riesgo: string | null
  titular_nombre: string | null
  titular_documento: string | null
  integrantes: string | null
}

// El rango se acota en SQL por período (el vencimiento siempre cae dentro del mes de su período, ver
// `fechaDeVencimiento`); el día exacto se compara en memoria porque sale de un número + el período.
const SELECT_CUOTAS = `
  SELECT
    s.*, c.dada_de_baja,
    EXISTS (SELECT 1 FROM polizas suc WHERE suc.poliza_anterior_id = s.poliza_id) AS tiene_sucesora,
    -- La misma condición con la que la Mora y los Deudores dejan de perseguir una cuota (espera la planilla como \`c\`).
    ${PAGO_QUE_CUBRE_LA_CUOTA} AS pago_cubre,
    vr.direccion_riesgo, vr.titular_nombre, vr.titular_documento, vr.integrantes
  FROM (
    ${SELECT_PLANILLA}
    WHERE c.periodo >= @periodoDesde AND c.periodo <= @periodoHasta AND c.dia_vencimiento_numero IS NOT NULL
  ) s
  JOIN cuotas_mes c ON c.id = s.cuota_id
  LEFT JOIN vehiculos vr ON vr.id = s.vehiculo_id
`

/** Cómo se nombra el riesgo en una celda: igual que en el listado de Pólizas. */
function describirElRiesgo(fila: FilaCruda): string | null {
  if (!esVehiculo(fila.vehiculo)) {
    return (
      describirRiesgo({
        tipo: fila.vehiculo,
        marca: fila.marca,
        chasis: fila.chasis,
        direccionRiesgo: fila.direccion_riesgo,
        titularNombre: fila.titular_nombre,
        titularDocumento: fila.titular_documento,
        integrantes: leerIntegrantes(fila.integrantes),
      }) || null
    )
  }
  const descripcion = [limpiar(fila.marca), limpiar(fila.modelo)].filter(Boolean).join(' ')
  return descripcion || limpiar(fila.vehiculo) || null
}

/** El ramo: la rama del vehículo o, si no es una de las siete, el tipo de riesgo («Hogar»). */
function ramoDe(tipo: string | null, categoria: string | null): string | null {
  const rama = ramaDeVehiculo(tipo, categoria)
  if (rama) return NOMBRE_RAMA[rama]
  return nombreDeTipoDeRiesgo(tipo) || null
}

/**
 * El estado de la cuota (ver `ESTADOS_DE_CUOTA` en shared/listados/cuotas.ts). Pura y exportada para las pruebas.
 * `vencimiento` y `hoy` son 'AAAA-MM-DD': se comparan como texto.
 */
export function estadoDeLaCuota(datos: {
  pagada: boolean
  adelantada: boolean
  anulada: boolean
  /** La fila vieja que reemplazó una renovación (opcional: sin dato se trata como que no). */
  renovada?: boolean
  imputada: boolean
  /** La Mora no la persigue (débito automático, algo escrito en CUANDO PAGO o un pago que la cubre). Opcional. */
  sinMora?: boolean
  vencimiento: string
  hoy: string
}): EstadoDeCuota {
  if (datos.pagada) return 'Pagada'
  if (datos.adelantada) return 'Adelantada'
  if (datos.anulada) return 'Anulada'
  if (datos.renovada) return 'Renovada'
  if (datos.imputada) return 'Imputada'
  if (datos.vencimiento >= datos.hoy) return 'Pendiente'
  return datos.sinMora ? 'Sin mora' : 'Vencida'
}

/** Una fila por cada combinación distinta de compañía / ramo / forma de pago / productor: sólo para los desplegables. */
function opcionesDeFiltros(): FilaDeCuota[] {
  const combinaciones = db()
    .prepare(
      `SELECT DISTINCT
         COALESCE(c.compania, p.compania) AS compania, COALESCE(c.forma_pago, p.forma_pago) AS forma_pago,
         p.productor, v.tipo, v.categoria
       FROM cuotas_mes c
       LEFT JOIN polizas p ON p.id = c.poliza_id
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id`,
    )
    .all() as Array<{ compania: string | null; forma_pago: string | null; productor: string | null; tipo: string | null; categoria: string | null }>
  return combinaciones.map((c, i) => ({
    id: `opcion:${i}`,
    polizaId: null,
    clienteId: null,
    compania: limpiar(c.compania) || null,
    numero: null,
    cliente: '',
    vencimiento: '',
    importe: null,
    cuota: null,
    estado: 'Pendiente',
    ramo: ramoDe(c.tipo, c.categoria),
    formaPago: limpiar(c.forma_pago) || null,
    riesgo: null,
    productor: limpiar(c.productor) || null,
  }))
}

/** `hoy` es sólo para las pruebas: en la aplicación siempre es el día de la máquina. */
export function listarVencimientosDeCuotas(filtros: FiltrosDeCuotas, hoy = hoyLocal()): FilaDeCuota[] {
  const f = objeto(filtros ?? {}, 'Los filtros')
  if (f.soloOpciones === true) return opcionesDeFiltros()

  const desde = pareceIso(limpiar(f.desde)) ? limpiar(f.desde) : ''
  const hasta = pareceIso(limpiar(f.hasta)) ? limpiar(f.hasta) : ''
  // Sin rango no se consulta nada: es una búsqueda, no una lista que se carga sola.
  if (!desde || !hasta || desde > hasta) return []

  const companias = listaDeFiltro(f.companias)
  const ramas = listaDeFiltro(f.ramas)
  const productores = listaDeFiltro(f.productores)
  const formasDePago = listaDeFiltro(f.formasDePago)
  const cliente = normalizarTexto(f.cliente)
  const riesgo = normalizarTexto(f.riesgo)
  const incluirAnuladas = f.incluirAnuladas === true
  // «Excluir pagadas» y «Solo vencidas» son compatibles: una vencida nunca está paga, así que juntas dan lo mismo que «Solo vencidas».
  const excluirPagadas = f.excluirPagadas === true
  const soloVencidas = f.soloVencidas === true

  const crudas = db()
    .prepare(SELECT_CUOTAS)
    .all({ periodoDesde: desde.slice(0, 7), periodoHasta: hasta.slice(0, 7) }) as FilaCruda[]

  const filas: FilaDeCuota[] = []
  for (const cruda of crudas) {
    const vencimiento = fechaDeVencimiento(cruda.periodo, cruda.dia_vencimiento_numero)
    if (!vencimiento || vencimiento < desde || vencimiento > hasta) continue

    const compania = limpiar(cruda.compania) || null
    const productor = limpiar(cruda.productor) || null
    const formaPago = limpiar(cruda.forma_pago) || null
    const ramo = ramoDe(cruda.vehiculo, cruda.categoria_vehiculo)
    if (!coincideAlguno(companias, compania)) continue
    if (!coincideAlguno(productores, productor)) continue
    if (!coincideAlguno(formasDePago, formaPago, mismoTextoDeFiltro)) continue
    if (ramas.length > 0 && !ramas.some((r) => mismaRama(r, ramo))) continue

    const nombre = limpiar(cruda.nombre)
    if (cliente && !normalizarTexto(nombre).includes(cliente)) continue
    const descripcionDelRiesgo = describirElRiesgo(cruda)
    if (riesgo && !normalizarTexto(descripcionDelRiesgo).includes(riesgo)) continue

    // `aFila` es el mismo paso de la planilla: de ahí salen pagoFecha, pagoRegistrado, pagoImputado y el adelanto.
    const base = aFila(cruda, {})
    // La fila vieja que reemplazó una renovación (dada de baja con póliza sucesora) no es una anulación.
    const renovada = cruda.dada_de_baja === 1 && cruda.tiene_sucesora === 1
    const anulada = !renovada && (cruda.dada_de_baja === 1 || (cruda.poliza_activa === 0 && cruda.tiene_sucesora === 0))
    // Los tres motivos por los que la Mora descarta una cuota que ya venció (ver cobranzas.ts, `filasEnMora`).
    const sinMora = limpiar(cruda.pago) !== '' || cruda.pago_cubre === 1 || esDebitoAutomatico(formaPago)
    const estado = estadoDeLaCuota({
      pagada: Boolean(base.pagoFecha) || base.pagoRegistrado,
      adelantada: base.pagoAdelantado !== null,
      anulada,
      renovada,
      imputada: base.pagoImputado,
      sinMora,
      vencimiento,
      hoy,
    })
    // Anulada y Renovada se miran aparte del estado: una cuota ya paga de una póliza anulada tampoco se lista salvo que se pida.
    if ((anulada || renovada) && !incluirAnuladas) continue
    if (excluirPagadas && (estado === 'Pagada' || estado === 'Adelantada')) continue
    if (soloVencidas && estado !== 'Vencida') continue

    filas.push({
      id: cruda.fila_id,
      polizaId: cruda.poliza_id,
      clienteId: cruda.cliente_id,
      compania,
      numero: limpiar(cruda.numero_poliza) || null,
      cliente: nombre || 'Sin nombre',
      vencimiento,
      importe: cruda.cuota_monto,
      cuota: limpiar(cruda.cuota) || null,
      estado,
      ramo,
      formaPago,
      riesgo: descripcionDelRiesgo,
      productor,
    })
  }

  // Por fecha de vencimiento (la más próxima primero) y, a igual fecha, por cliente.
  return filas.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.cliente.localeCompare(b.cliente, 'es') || a.id.localeCompare(b.id))
}
