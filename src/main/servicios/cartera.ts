// Cartera: la planilla del mes, sus acciones (avisar, registrar pago, dar de baja) y el cierre de mes.
// Todo lo que se cambia acá queda anotado en el historial.
import { hoyLocal, periodoDeHoy, periodoSiguiente } from '../../shared/semaforo'
import {
  MOTIVOS_DE_BAJA,
  PLANTILLA_AVISO_POR_DEFECTO,
  type AvisoPreparado,
  type CampoEditable,
  type CuotasDelCliente,
  type CatalogosCartera,
  type DatosDeBaja,
  type DatosDePago,
  type FilaBaja,
  type FilaCartera,
  type MotivoDeBaja,
  type PeriodoCartera,
  type PlanillaDelMes,
  type ResultadoDeReactivacion,
  type ResumenCierreDeMes,
  type SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import {
  ahoraIso,
  generarId,
  interpretarDiaDeVencimiento,
  interpretarFecha,
  interpretarFechaDePeriodo,
  interpretarNumero,
  limpiar,
  normalizarPatente,
  normalizarTexto,
} from '../importacion/normalizar'
import { diasCoberturaPorCompania, diasPorDefectoDe, sincronizarCompanias } from './companias'
import { aplicarPlantilla, plantillaDeAviso, saludoDe } from './plantillas'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { encolar } from '../sincronizacion/cola'
import { PESTANA_APP, registrarFilaDeLaApp } from './filas'
import { guardarPago, normalizarResultado } from './pagos'
import { texto } from './validacion'

/** Formas de pago que ya usa la agencia; el desplegable las ofrece pero deja escribir otra. */
const FORMAS_DE_PAGO = ['CUPONERA', 'LOCAL', 'TARJETA', 'CBU', 'EFECTIVO', 'TRANSFERENCIA', 'MERCADO PAGO', 'DEBITO']
const MEDIOS_DE_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'MERCADO PAGO', 'TARJETA', 'CBU', 'LOCAL', 'CUPONERA']

// ---------------------------------------------------------------------------
// Lectura de la planilla
// ---------------------------------------------------------------------------

/**
 * Las columnas que la planilla mensual tiene propias (nombre, documento, sucursal, patente, compañía y
 * póliza) mandan sobre el registro unificado: dos personas distintas que comparten DNI siguen mostrando
 * cada una lo suyo. El resto —teléfono, marca, cobertura, vigencias— sale del cliente, el vehículo y la
 * póliza, así corregir un dato una vez se ve en todos los meses.
 */
export const SELECT_PLANILLA = `
  SELECT
    c.id AS cuota_id, c.fila_id, c.periodo, c.pestana, c.poliza_id, c.cliente_id, p.vehiculo_id,
    COALESCE(c.sucursal_texto, cl.sucursal_texto) AS sucursal,
    COALESCE(c.cliente_nombre, cl.nombre) AS nombre,
    cl.telefono, COALESCE(c.documento, cl.documento) AS documento,
    cl.email, cl.direccion, cl.localidad,
    c.dia_vencimiento, c.dia_vencimiento_numero, c.cuota, c.cuota_monto,
    COALESCE(c.forma_pago, p.forma_pago) AS forma_pago,
    c.aviso, c.fecha_envio, c.avisar_vto, c.pago, c.pago_fecha, c.observaciones,
    v.tipo AS vehiculo, v.marca, v.modelo, COALESCE(c.patente, v.patente) AS patente,
    v.anio, v.motor, v.chasis, v.uso, v.color,
    p.cobertura, COALESCE(c.compania, p.compania) AS compania,
    COALESCE(c.numero_poliza, p.numero) AS numero_poliza, p.propuesta,
    p.vigencia_desde, p.vigencia_hasta, p.prima, p.productor, p.alta,
    COALESCE(p.activa, 1) AS poliza_activa,
    EXISTS (SELECT 1 FROM pagos pg WHERE pg.poliza_id = c.poliza_id AND pg.periodo = c.periodo) AS pago_registrado
  FROM cuotas_mes c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  LEFT JOIN polizas p ON p.id = c.poliza_id
  LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
`

export interface FilaCruda {
  cuota_id: number
  fila_id: string
  periodo: string
  pestana: string
  poliza_id: number | null
  cliente_id: number | null
  vehiculo_id: number | null
  sucursal: string | null
  nombre: string | null
  telefono: string | null
  documento: string | null
  email: string | null
  direccion: string | null
  localidad: string | null
  dia_vencimiento: string | null
  dia_vencimiento_numero: number | null
  cuota: string | null
  cuota_monto: number | null
  forma_pago: string | null
  aviso: string | null
  fecha_envio: string | null
  avisar_vto: string | null
  pago: string | null
  pago_fecha: string | null
  observaciones: string | null
  vehiculo: string | null
  marca: string | null
  modelo: string | null
  patente: string | null
  anio: string | null
  motor: string | null
  chasis: string | null
  uso: string | null
  color: string | null
  cobertura: string | null
  compania: string | null
  numero_poliza: string | null
  propuesta: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  prima: string | null
  productor: string | null
  alta: string | null
  poliza_activa: number
  pago_registrado: number
}

export function aFila(cruda: FilaCruda, dias: Record<string, number>): FilaCartera {
  const normalizada = normalizarTexto(cruda.compania)
  return {
    filaId: cruda.fila_id,
    cuotaId: cruda.cuota_id,
    periodo: cruda.periodo,
    polizaId: cruda.poliza_id,
    clienteId: cruda.cliente_id,
    vehiculoId: cruda.vehiculo_id,
    sucursal: cruda.sucursal,
    nombre: cruda.nombre,
    telefono: cruda.telefono,
    documento: cruda.documento,
    diaVencimiento: cruda.dia_vencimiento,
    diaVencimientoNumero: cruda.dia_vencimiento_numero,
    cuota: cruda.cuota,
    cuotaMonto: cruda.cuota_monto,
    formaPago: cruda.forma_pago,
    aviso: cruda.aviso,
    fechaEnvio: cruda.fecha_envio,
    avisarVto: cruda.avisar_vto,
    vehiculo: cruda.vehiculo,
    marca: cruda.marca,
    modelo: cruda.modelo,
    patente: cruda.patente,
    anio: cruda.anio,
    cobertura: cruda.cobertura,
    compania: cruda.compania,
    numeroPoliza: cruda.numero_poliza,
    propuesta: cruda.propuesta,
    vigenciaDesde: cruda.vigencia_desde,
    vigenciaHasta: cruda.vigencia_hasta,
    observaciones: cruda.observaciones,
    pago: cruda.pago,
    pagoFecha: cruda.pago_fecha,
    pagoRegistrado: cruda.pago_registrado === 1,
    email: cruda.email,
    direccion: cruda.direccion,
    localidad: cruda.localidad,
    motor: cruda.motor,
    chasis: cruda.chasis,
    uso: cruda.uso,
    color: cruda.color,
    prima: cruda.prima,
    productor: cruda.productor,
    alta: cruda.alta,
    polizaActiva: cruda.poliza_activa === 1,
    diasCobertura: dias[normalizada] ?? diasPorDefectoDe(cruda.compania ?? ''),
  }
}

export function periodosDisponibles(): PeriodoCartera[] {
  const filas = db()
    .prepare(`SELECT periodo, COUNT(*) AS filas FROM cuotas_mes WHERE dada_de_baja = 0 GROUP BY periodo ORDER BY periodo DESC`)
    .all() as Array<{ periodo: string; filas: number }>
  const masNuevo = filas[0]?.periodo ?? null
  return filas.map((f) => ({ periodo: f.periodo, filas: f.filas, esElActual: f.periodo === masNuevo }))
}

function valoresDistintos(consulta: string): string[] {
  const filas = db().prepare(consulta).all() as Array<{ valor: string | null }>
  const vistos = new Map<string, string>()
  for (const f of filas) {
    const valor = limpiar(f.valor)
    if (!valor) continue
    const clave = normalizarTexto(valor)
    if (!vistos.has(clave)) vistos.set(clave, valor)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

export function catalogos(): CatalogosCartera {
  const combinar = (base: string[], deLaBase: string[]) => {
    const vistos = new Map(base.map((v) => [normalizarTexto(v), v]))
    for (const valor of deLaBase) if (!vistos.has(normalizarTexto(valor))) vistos.set(normalizarTexto(valor), valor)
    return [...vistos.values()]
  }
  return {
    formasDePago: combinar(FORMAS_DE_PAGO, valoresDistintos('SELECT DISTINCT forma_pago AS valor FROM cuotas_mes')),
    sucursales: combinar(
      valoresDistintos('SELECT nombre AS valor FROM sucursales'),
      valoresDistintos('SELECT DISTINCT sucursal_texto AS valor FROM cuotas_mes'),
    ),
    companias: valoresDistintos('SELECT nombre AS valor FROM companias WHERE activa = 1'),
    coberturas: valoresDistintos('SELECT DISTINCT cobertura AS valor FROM polizas WHERE activa = 1'),
    tiposDeVehiculo: valoresDistintos('SELECT DISTINCT tipo AS valor FROM vehiculos'),
    mediosDePago: combinar(MEDIOS_DE_PAGO, valoresDistintos('SELECT DISTINCT medio AS valor FROM pagos')),
  }
}

export function planillaDelMes(periodoPedido?: string | null): PlanillaDelMes {
  sincronizarCompanias()
  const periodos = periodosDisponibles()
  const periodo = periodoPedido && periodos.some((p) => p.periodo === periodoPedido) ? periodoPedido : (periodos[0]?.periodo ?? periodoDeHoy())
  const dias = diasCoberturaPorCompania()
  const crudas = db()
    .prepare(`${SELECT_PLANILLA} WHERE c.periodo = ? AND c.dada_de_baja = 0 ORDER BY c.dia_vencimiento_numero, nombre`)
    .all(periodo) as FilaCruda[]

  return {
    periodo,
    soloLectura: periodos.length > 0 && periodos[0]!.periodo !== periodo,
    filas: crudas.map((c) => aFila(c, dias)),
    catalogos: catalogos(),
    diasCoberturaPorCompania: dias,
    periodos,
    hoy: hoyLocal(),
  }
}

function buscarFila(filaId: string): FilaCruda {
  const fila = db().prepare(`${SELECT_PLANILLA} WHERE c.fila_id = ?`).get(filaId) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa fila de la planilla. Actualizá la pantalla y probá de nuevo.')
  return fila
}

function devolverFila(filaId: string): FilaCartera {
  return aFila(buscarFila(filaId), diasCoberturaPorCompania())
}

/** Los meses cerrados son de sólo lectura: sólo se puede tocar el mes abierto. */
function exigirMesAbierto(periodo: string): void {
  const periodos = periodosDisponibles()
  if (periodos.length > 0 && periodos[0]!.periodo !== periodo) {
    throw new ErrorDeNegocio(`«${periodo}» es un mes anterior y se ve sólo para consultar. Cambiá al mes actual para modificar algo.`)
  }
}

// ---------------------------------------------------------------------------
// Edición de celdas
// ---------------------------------------------------------------------------

interface DestinoDeCampo {
  tabla: 'cuotas_mes' | 'clientes' | 'vehiculos' | 'polizas'
  columna: string
  /** Columna de cuotas_mes que guarda la misma cosa y también hay que actualizar. */
  columnaEnLaCuota?: string
  /** Columnas derivadas que se recalculan al guardar (monto, fecha interpretada…). */
  derivadas?: (valor: string, fila: FilaCruda) => Record<string, unknown>
  /** Si la fila no tiene el registro destino, se guarda en esta columna de cuotas_mes. */
  respaldoEnLaCuota?: string
  /**
   * El dato no existe como columna de la hoja: se guarda sólo en la base y no se encola. Es el caso de
   * la propuesta, que es un número interno de la agencia mientras la póliza todavía no está emitida.
   */
  soloLocal?: boolean
}

const DESTINOS: Record<CampoEditable, DestinoDeCampo> = {
  sucursal: { tabla: 'clientes', columna: 'sucursal_texto', respaldoEnLaCuota: 'sucursal_texto', columnaEnLaCuota: 'sucursal_texto' },
  nombre: { tabla: 'clientes', columna: 'nombre', respaldoEnLaCuota: 'cliente_nombre', columnaEnLaCuota: 'cliente_nombre' },
  telefono: { tabla: 'clientes', columna: 'telefono' },
  documento: { tabla: 'clientes', columna: 'documento', respaldoEnLaCuota: 'documento', columnaEnLaCuota: 'documento' },
  email: { tabla: 'clientes', columna: 'email' },
  direccion: { tabla: 'clientes', columna: 'direccion' },
  localidad: { tabla: 'clientes', columna: 'localidad' },

  diaVencimiento: {
    tabla: 'cuotas_mes',
    columna: 'dia_vencimiento',
    derivadas: (valor) => ({ dia_vencimiento_numero: interpretarDiaDeVencimiento(valor) }),
  },
  cuota: { tabla: 'cuotas_mes', columna: 'cuota', derivadas: (valor) => ({ cuota_monto: interpretarNumero(valor) }) },
  formaPago: { tabla: 'cuotas_mes', columna: 'forma_pago' },
  aviso: { tabla: 'cuotas_mes', columna: 'aviso' },
  avisarVto: { tabla: 'cuotas_mes', columna: 'avisar_vto' },
  observaciones: { tabla: 'cuotas_mes', columna: 'observaciones' },
  pago: {
    tabla: 'cuotas_mes',
    columna: 'pago',
    derivadas: (valor, fila) => ({ pago_fecha: interpretarFechaDePeriodo(valor, fila.periodo).iso }),
  },

  vehiculo: { tabla: 'vehiculos', columna: 'tipo' },
  marca: { tabla: 'vehiculos', columna: 'marca' },
  modelo: { tabla: 'vehiculos', columna: 'modelo' },
  patente: {
    tabla: 'vehiculos',
    columna: 'patente',
    derivadas: (valor) => ({ patente_normalizada: normalizarPatente(valor) || null }),
    respaldoEnLaCuota: 'patente',
    columnaEnLaCuota: 'patente',
  },
  anio: { tabla: 'vehiculos', columna: 'anio' },
  motor: { tabla: 'vehiculos', columna: 'motor' },
  chasis: { tabla: 'vehiculos', columna: 'chasis' },
  uso: { tabla: 'vehiculos', columna: 'uso' },
  color: { tabla: 'vehiculos', columna: 'color' },

  cobertura: { tabla: 'polizas', columna: 'cobertura' },
  compania: { tabla: 'polizas', columna: 'compania', respaldoEnLaCuota: 'compania', columnaEnLaCuota: 'compania' },
  numeroPoliza: { tabla: 'polizas', columna: 'numero', respaldoEnLaCuota: 'numero_poliza', columnaEnLaCuota: 'numero_poliza' },
  propuesta: { tabla: 'polizas', columna: 'propuesta', soloLocal: true },
  vigenciaDesde: { tabla: 'polizas', columna: 'vigencia_desde' },
  vigenciaHasta: { tabla: 'polizas', columna: 'vigencia_hasta' },
  prima: { tabla: 'polizas', columna: 'prima', derivadas: (valor) => ({ prima_monto: interpretarNumero(valor) }) },
  productor: { tabla: 'polizas', columna: 'productor' },
}

const NOMBRE_DE_CAMPO: Partial<Record<CampoEditable, string>> = {
  diaVencimiento: 'FECHA DE VENC',
  formaPago: 'FORMA DE PAGO',
  aviso: 'OB. AVISOS',
  avisarVto: 'AVISAR VTO',
  numeroPoliza: 'POLIZA',
  propuesta: 'PROPUESTA',
  vigenciaDesde: 'DESDE',
  vigenciaHasta: 'HASTA',
  pago: 'CUANDO PAGO',
  vehiculo: 'VEHICULO',
}

function idDelDestino(destino: DestinoDeCampo, fila: FilaCruda): number | null {
  if (destino.tabla === 'cuotas_mes') return fila.cuota_id
  if (destino.tabla === 'clientes') return fila.cliente_id
  if (destino.tabla === 'vehiculos') return fila.vehiculo_id
  return fila.poliza_id
}

export function editarCelda(filaId: string, campo: CampoEditable, valor: string, actor: SesionUsuario): FilaCartera {
  const destino = DESTINOS[campo]
  if (!destino) throw new ErrorDeNegocio('Ese campo no se puede editar desde la planilla.')
  const fila = buscarFila(texto(filaId, 'La fila', 1, 64))
  exigirMesAbierto(fila.periodo)

  const nuevo = limpiar(valor)
  const anterior = limpiar((fila as unknown as Record<string, unknown>)[destino.columna === 'nombre' ? 'nombre' : campoALectura(campo)])
  if (nuevo === anterior) return aFila(fila, diasCoberturaPorCompania())

  let tabla = destino.tabla
  let id = idDelDestino(destino, fila)
  let columna = destino.columna
  if (id === null) {
    // La fila no tiene cliente, vehículo o póliza propios (mes viejo cuya póliza ya no está):
    // se guarda en la copia que la cuota conserva de ese dato, si la hay.
    if (!destino.respaldoEnLaCuota) {
      throw new ErrorDeNegocio('Esa columna pertenece a una póliza que ya no está en la cartera, así que no se puede editar desde acá.')
    }
    tabla = 'cuotas_mes'
    id = fila.cuota_id
    columna = destino.respaldoEnLaCuota
  }

  const derivadas = tabla === destino.tabla ? (destino.derivadas?.(nuevo, fila) ?? {}) : {}
  const asignaciones = [`${columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`), 'actualizado_en = @ahora']
  db()
    .prepare(`UPDATE ${tabla} SET ${asignaciones.join(', ')} WHERE id = @id`)
    .run({ valor: nuevo === '' ? null : nuevo, ...derivadas, ahora: ahoraIso(), id })

  // La fila del mes guarda su propia copia de estas columnas: se actualizan las dos para que no discrepen.
  if (destino.columnaEnLaCuota && tabla !== 'cuotas_mes') {
    db()
      .prepare(`UPDATE cuotas_mes SET ${destino.columnaEnLaCuota} = ?, actualizado_en = ? WHERE id = ?`)
      .run(nuevo === '' ? null : nuevo, ahoraIso(), fila.cuota_id)
  }

  // La propuesta no tiene columna en la hoja: encolarla dejaría una entrada que la subida no sabe
  // dónde escribir y que quedaría para siempre en «no se pudo».
  if (!destino.soloLocal) {
    encolar({ operacion: 'actualizar', pestana: fila.pestana, filaId: fila.fila_id, campos: { [campoDeLaHoja(campo)]: nuevo } }, actor)
  }

  registrarCambio(actor, {
    accion: 'edicion',
    tabla,
    registroId: id,
    filaId: fila.fila_id,
    campo: NOMBRE_DE_CAMPO[campo] ?? campo,
    valorAnterior: anterior || null,
    valorNuevo: nuevo || null,
  })
  return devolverFila(fila.fila_id)
}

/** Nombre de la propiedad de FilaCruda que corresponde a cada campo editable. */
function campoALectura(campo: CampoEditable): string {
  const mapa: Partial<Record<CampoEditable, string>> = {
    diaVencimiento: 'dia_vencimiento',
    formaPago: 'forma_pago',
    numeroPoliza: 'numero_poliza',
    vigenciaDesde: 'vigencia_desde',
    vigenciaHasta: 'vigencia_hasta',
    avisarVto: 'avisar_vto',
  }
  return mapa[campo] ?? campo
}

// ---------------------------------------------------------------------------
// Avisar por WhatsApp
// ---------------------------------------------------------------------------

/** Deja el teléfono en el formato que espera wa.me: sólo dígitos, con 54 9 adelante si es argentino. */
export function telefonoParaWhatsapp(telefono: string | null): string {
  const digitos = limpiar(telefono).replace(/\D+/g, '')
  if (!digitos) return ''
  if (digitos.startsWith('54')) return digitos.length >= 12 && !digitos.startsWith('549') ? `549${digitos.slice(2)}` : digitos
  if (digitos.startsWith('0')) return `549${digitos.slice(1)}`
  return `549${digitos}`
}

export function armarMensaje(plantilla: string, fila: FilaCartera): string {
  return aplicarPlantilla(plantilla, {
    nombre: saludoDe(fila.nombre),
    cuota: fila.cuota,
    vencimiento: fila.diaVencimiento,
    patente: fila.patente,
    compania: fila.compania,
  })
}

export function prepararAviso(filaId: string, actor: SesionUsuario): AvisoPreparado {
  return prepararAvisoDeCuota(filaId, actor, true)
}

/**
 * Marca la fila como ENVIADO sin abrir WhatsApp. Es para cuando ya se avisó por otro lado —se lo dijeron
 * por teléfono, en el mostrador, o el WhatsApp se mandó desde el celular— y lo único que falta es que la
 * planilla lo diga. Deja exactamente lo mismo que el botón de WhatsApp: ENVIADO, la fecha de hoy, la
 * fila en «Avisados hoy» y el mismo renglón en el historial (con la aclaración de que fue a mano).
 */
export function marcarAvisado(filaId: string, actor: SesionUsuario): FilaCartera {
  const cruda = buscarFila(texto(filaId, 'La fila', 1, 64))
  exigirMesAbierto(cruda.periodo)
  const hoy = hoyLocal()

  db()
    .prepare(`UPDATE cuotas_mes SET aviso = 'ENVIADO', aviso_enviado = 1, fecha_envio = ?, actualizado_en = ? WHERE id = ?`)
    .run(hoy, ahoraIso(), cruda.cuota_id)
  encolar({ operacion: 'actualizar', pestana: cruda.pestana, filaId: cruda.fila_id, campos: { aviso: 'ENVIADO', fecha_envio: hoy } }, actor)

  registrarCambio(actor, {
    accion: 'aviso',
    tabla: 'cuotas_mes',
    registroId: cruda.cuota_id,
    filaId: cruda.fila_id,
    campo: 'OB. AVISOS',
    valorAnterior: cruda.aviso,
    valorNuevo: `ENVIADO (${hoy}, marcado a mano)`,
  })
  return devolverFila(cruda.fila_id)
}

/**
 * Arma el mensaje de WhatsApp de una cuota y, si el mes está abierto, deja la fila como ENVIADO.
 *
 * `exigirAbierto = false` es lo que usa la mora, que persigue deudas de meses ya cerrados: al cliente
 * se le puede escribir igual, pero la planilla de un mes cerrado no se toca (ni acá ni en la hoja).
 * El aviso queda igual en el historial, así se sabe quién escribió y cuándo.
 *
 * `plantilla` la manda Marketing cuando se avisa desde un segmento con otro mensaje. Sin ella se usa
 * la de vencimiento, que es la del botón «Avisar» de siempre.
 */
export function prepararAvisoDeCuota(
  filaId: string,
  actor: SesionUsuario,
  exigirAbierto: boolean,
  plantilla?: string,
): AvisoPreparado & { marcada: boolean } {
  const cruda = buscarFila(texto(filaId, 'La fila', 1, 64))
  if (exigirAbierto) exigirMesAbierto(cruda.periodo)
  const fila = aFila(cruda, diasCoberturaPorCompania())

  const telefono = telefonoParaWhatsapp(fila.telefono)
  if (!telefono) throw new ErrorDeNegocio(`«${fila.nombre ?? 'La fila'}» no tiene teléfono cargado: completá la columna TELÉFONO y probá de nuevo.`)

  const mensaje = armarMensaje(plantilla?.trim() ? plantilla : plantillaDeAviso(), fila)
  const hoy = hoyLocal()
  const periodos = periodosDisponibles()
  const marcada = periodos.length === 0 || periodos[0]!.periodo === cruda.periodo

  if (marcada) {
    db()
      .prepare(`UPDATE cuotas_mes SET aviso = 'ENVIADO', aviso_enviado = 1, fecha_envio = ?, actualizado_en = ? WHERE id = ?`)
      .run(hoy, ahoraIso(), cruda.cuota_id)
    encolar({ operacion: 'actualizar', pestana: cruda.pestana, filaId: cruda.fila_id, campos: { aviso: 'ENVIADO', fecha_envio: hoy } }, actor)
  }

  registrarCambio(actor, {
    accion: 'aviso',
    tabla: 'cuotas_mes',
    registroId: cruda.cuota_id,
    filaId: cruda.fila_id,
    campo: 'OB. AVISOS',
    valorAnterior: cruda.aviso,
    valorNuevo: marcada ? `ENVIADO (${hoy})` : `AVISADO POR MORA (${hoy}, ${cruda.periodo} ya cerrado)`,
  })

  return {
    url: `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}`,
    mensaje,
    telefono,
    fila: devolverFila(cruda.fila_id),
    marcada,
  }
}

// ---------------------------------------------------------------------------
// Registrar pago
// ---------------------------------------------------------------------------

/** El _ID que lleva el pago de una fila de la planilla. Es fijo: registrarlo dos veces lo corrige. */
export function idDeLaFilaDelPago(cuotaFilaId: string): string {
  return `PAGO:${cuotaFilaId}`
}

/** Id del pago ya registrado para esa cuota, o null. Lo usa el ticket, que se imprime después. */
export function idDelPagoDeLaCuota(cuotaFilaId: string): number | null {
  const fila = db().prepare('SELECT id FROM pagos WHERE fila_id = ?').get(idDeLaFilaDelPago(cuotaFilaId)) as
    | { id: number }
    | undefined
  return fila?.id ?? null
}

export function registrarPago(filaId: string, datos: DatosDePago, actor: SesionUsuario): FilaCartera {
  const fila = buscarFila(texto(filaId, 'La fila', 1, 64))
  exigirMesAbierto(fila.periodo)

  const fecha = limpiar(datos.fecha) || hoyLocal()
  const fechaIso = interpretarFecha(fecha, Number(fila.periodo.slice(0, 4))).iso
  if (!fechaIso) throw new ErrorDeNegocio(`«${fecha}» no es una fecha válida. Usá el formato día/mes/año.`)
  const importe = limpiar(datos.importe) || limpiar(fila.cuota)
  const medio = limpiar(datos.medioDePago)

  const ahora = ahoraIso()
  db().transaction(() => {
    db()
      .prepare(`UPDATE cuotas_mes SET pago = ?, pago_fecha = ?, actualizado_en = ? WHERE id = ?`)
      .run(fecha, fechaIso, ahora, fila.cuota_id)
    guardarPago(
      {
        filaId: idDeLaFilaDelPago(fila.fila_id),
        cuotaFilaId: fila.fila_id,
        clienteId: fila.cliente_id,
        polizaId: fila.poliza_id,
        clienteNombre: fila.nombre,
        documento: fila.documento,
        compania: fila.compania,
        numeroPoliza: fila.numero_poliza,
        patente: fila.patente,
        sucursalCliente: fila.sucursal,
        sucursalCobro: limpiar(datos.sucursal) || actor.sucursal.nombre,
        fecha,
        fechaIso,
        importe: importe || null,
        medio: medio || null,
        periodo: fila.periodo,
        observaciones: null,
        resultado: normalizarResultado(null),
      },
      actor,
    )
  })()

  encolar({ operacion: 'actualizar', pestana: fila.pestana, filaId: fila.fila_id, campos: { pago: fecha } }, actor)

  registrarCambio(actor, {
    accion: 'pago',
    tabla: 'cuotas_mes',
    registroId: fila.cuota_id,
    filaId: fila.fila_id,
    campo: 'CUANDO PAGO',
    valorAnterior: fila.pago,
    valorNuevo: `${fecha}${importe ? ` · ${importe}` : ''}${medio ? ` · ${medio}` : ''}`,
  })
  return devolverFila(fila.fila_id)
}

// ---------------------------------------------------------------------------
// Dar de baja
// ---------------------------------------------------------------------------

/**
 * El alta de una baja hecha en la aplicación, con la foto completa de la fila.
 *
 * Antes se guardaban nada más que nombre, documento, compañía, póliza, patente, sucursal y motivo, y
 * una póliza anulada perdía todo el resto de lo que decía la cartera. Ahora se guarda todo: la póliza
 * puede cambiar (o renovarse con otro vehículo) después de la baja, y lo que hay que poder mirar es
 * cómo estaba el día que se fue.
 *
 * Lo comparten `darDeBaja` (la baja desde la planilla del mes) y `darDeBajaPoliza` (la baja de una
 * póliza que no está en el mes abierto), para que las dos guarden exactamente lo mismo.
 */
export const INSERT_BAJA = `
  INSERT INTO bajas (fila_id, pestana, periodo, mes_texto, poliza_id, cliente_id, cliente_nombre, documento, compania,
                     numero_poliza, patente, sucursal_texto, motivo, fecha_baja, fecha_baja_iso, observaciones,
                     nota, hecha_en_la_app, cuota_fila_id,
                     telefono, email, direccion, localidad, cobertura, propuesta, cuota, dia_vencimiento, forma_pago,
                     prima, productor, vigencia_desde, vigencia_hasta, alta, vehiculo_id, tipo_vehiculo, marca, modelo,
                     anio, motor, chasis, uso, color,
                     creado_en, actualizado_en)
  VALUES (@fila_id, @pestana, @periodo, @mes_texto, @poliza_id, @cliente_id, @cliente_nombre, @documento, @compania,
          @numero_poliza, @patente, @sucursal_texto, @motivo, @fecha_baja, @fecha_baja_iso, @observaciones,
          @nota, 1, @cuota_fila_id,
          @telefono, @email, @direccion, @localidad, @cobertura, @propuesta, @cuota, @dia_vencimiento, @forma_pago,
          @prima, @productor, @vigencia_desde, @vigencia_hasta, @alta, @vehiculo_id, @tipo_vehiculo, @marca, @modelo,
          @anio, @motor, @chasis, @uso, @color,
          @ahora, @ahora)
  ON CONFLICT(fila_id) DO UPDATE SET
    motivo = excluded.motivo, nota = excluded.nota, fecha_baja = excluded.fecha_baja,
    fecha_baja_iso = excluded.fecha_baja_iso, actualizado_en = excluded.actualizado_en,
    telefono = excluded.telefono, email = excluded.email, direccion = excluded.direccion,
    localidad = excluded.localidad, cobertura = excluded.cobertura, propuesta = excluded.propuesta,
    cuota = excluded.cuota, dia_vencimiento = excluded.dia_vencimiento, forma_pago = excluded.forma_pago,
    prima = excluded.prima, productor = excluded.productor, vigencia_desde = excluded.vigencia_desde,
    vigencia_hasta = excluded.vigencia_hasta, alta = excluded.alta, vehiculo_id = excluded.vehiculo_id,
    tipo_vehiculo = excluded.tipo_vehiculo, marca = excluded.marca, modelo = excluded.modelo,
    anio = excluded.anio, motor = excluded.motor, chasis = excluded.chasis, uso = excluded.uso, color = excluded.color`

export function darDeBaja(filaId: string, datos: DatosDeBaja, actor: SesionUsuario): null {
  const fila = buscarFila(texto(filaId, 'La fila', 1, 64))
  exigirMesAbierto(fila.periodo)
  const motivo = datos.motivo
  if (!MOTIVOS_DE_BAJA.includes(motivo as MotivoDeBaja)) throw new ErrorDeNegocio('Elegí un motivo de baja de la lista.')
  const nota = limpiar(datos.nota)
  const hoy = hoyLocal()
  const ahora = ahoraIso()

  db().transaction(() => {
    db()
      .prepare(INSERT_BAJA)
      .run({
        fila_id: `BAJA:${fila.fila_id}`,
        pestana: PESTANA_APP,
        periodo: fila.periodo,
        mes_texto: fila.periodo,
        poliza_id: fila.poliza_id,
        cliente_id: fila.cliente_id,
        cliente_nombre: fila.nombre,
        documento: fila.documento,
        compania: fila.compania,
        numero_poliza: fila.numero_poliza,
        patente: fila.patente,
        sucursal_texto: fila.sucursal,
        motivo,
        fecha_baja: hoy,
        fecha_baja_iso: hoy,
        observaciones: fila.observaciones,
        nota: nota || null,
        cuota_fila_id: fila.fila_id,
        // La foto de la fila en el momento de la baja: todo lo demás que decía la cartera.
        telefono: fila.telefono,
        email: fila.email,
        direccion: fila.direccion,
        localidad: fila.localidad,
        cobertura: fila.cobertura,
        propuesta: fila.propuesta,
        cuota: fila.cuota,
        dia_vencimiento: fila.dia_vencimiento,
        forma_pago: fila.forma_pago,
        prima: fila.prima,
        productor: fila.productor,
        vigencia_desde: fila.vigencia_desde,
        vigencia_hasta: fila.vigencia_hasta,
        alta: fila.alta,
        vehiculo_id: fila.vehiculo_id,
        tipo_vehiculo: fila.vehiculo,
        marca: fila.marca,
        modelo: fila.modelo,
        anio: fila.anio,
        motor: fila.motor,
        chasis: fila.chasis,
        uso: fila.uso,
        color: fila.color,
        ahora,
      })
    db().prepare('UPDATE cuotas_mes SET dada_de_baja = 1, actualizado_en = ? WHERE id = ?').run(ahora, fila.cuota_id)
    if (fila.poliza_id !== null) {
      db().prepare('UPDATE polizas SET activa = 0, actualizado_en = ? WHERE id = ?').run(ahora, fila.poliza_id)
    }
  })()

  // En la hoja: primero se agrega a BAJAS y después se saca de la planilla del mes (ese orden importa:
  // si algo falla en el medio, la fila queda en los dos lados y no perdida).
  const pestanaBajas = pestanaDeBajas(fila.periodo)
  registrarFilaDeLaApp({ filaId: `BAJA:${fila.fila_id}`, pestana: pestanaBajas, tipoPestana: 'BAJAS', periodo: fila.periodo })
  encolar(
    {
      operacion: 'crear',
      pestana: pestanaBajas,
      filaId: `BAJA:${fila.fila_id}`,
      campos: { ...camposDeLaFila(fila), motivo, fecha_baja: hoy, mes: fila.periodo, observaciones: nota || fila.observaciones || '' },
    },
    actor,
  )
  encolar({ operacion: 'borrar', pestana: fila.pestana, filaId: fila.fila_id, campos: {} }, actor)

  registrarCambio(actor, {
    accion: 'baja',
    tabla: 'cuotas_mes',
    registroId: fila.cuota_id,
    filaId: fila.fila_id,
    campo: 'BAJA',
    valorAnterior: null,
    valorNuevo: `${motivo}${nota ? ` · ${nota}` : ''}`,
  })
  return null
}

export function deshacerBaja(bajaId: number, actor: SesionUsuario): FilaBaja[] {
  const baja = db().prepare('SELECT * FROM bajas WHERE id = ?').get(bajaId) as
    | { id: number; fila_id: string; pestana: string; cuota_fila_id: string | null; hecha_en_la_app: number; periodo: string | null; poliza_id: number | null; motivo: string | null }
    | undefined
  if (!baja) throw new ErrorDeNegocio('No se encontró esa baja.')
  if (baja.hecha_en_la_app !== 1 || !baja.cuota_fila_id) {
    throw new ErrorDeNegocio('Esa baja vino de la hoja de Google, no se puede deshacer desde acá.')
  }
  const ahora = ahoraIso()
  db().transaction(() => {
    db().prepare('UPDATE cuotas_mes SET dada_de_baja = 0, actualizado_en = ? WHERE fila_id = ?').run(ahora, baja.cuota_fila_id)
    if (baja.poliza_id !== null) db().prepare('UPDATE polizas SET activa = 1, actualizado_en = ? WHERE id = ?').run(ahora, baja.poliza_id)
    db().prepare('DELETE FROM bajas WHERE id = ?').run(baja.id)
  })()

  const filaDeVuelta = db().prepare(`${SELECT_PLANILLA} WHERE c.fila_id = ?`).get(baja.cuota_fila_id) as FilaCruda | undefined
  if (filaDeVuelta) {
    encolar({ operacion: 'borrar', pestana: baja.pestana, filaId: baja.fila_id, campos: {} }, actor)
    encolar(
      { operacion: 'crear', pestana: filaDeVuelta.pestana, filaId: filaDeVuelta.fila_id, campos: camposDeLaFila(filaDeVuelta) },
      actor,
    )
  }

  registrarCambio(actor, {
    accion: 'reactivacion',
    tabla: 'bajas',
    registroId: baja.id,
    filaId: baja.cuota_fila_id,
    campo: 'BAJA',
    valorAnterior: baja.motivo,
    valorNuevo: null,
  })
  return bajasDelMes(baja.periodo)
}

/**
 * «Poner vigente»: la póliza vuelve a la cartera sin cargarla de nuevo.
 *
 * Es distinto de «Deshacer», que es el «me equivoqué» del mismo mes y sólo sirve para las bajas que hizo
 * la aplicación. Acá el caso es el otro: al cliente lo dieron de baja en julio y en septiembre vuelve.
 * La póliza, el cliente y el vehículo nunca se borraron, así que alcanza con volver a activarla y
 * ponerle una fila en el mes abierto; los datos que hayan cambiado se corrigen después en la planilla.
 *
 * Sirve también para las bajas importadas de la hoja —que son la mayoría de las viejas— y por eso lo
 * único que se exige es saber de qué póliza es la baja.
 */
export function reactivarBaja(bajaId: number, actor: SesionUsuario): ResultadoDeReactivacion {
  const baja = db().prepare(`${SELECT_BAJAS} WHERE b.id = ?`).get(bajaId) as BajaCruda | undefined
  if (!baja) throw new ErrorDeNegocio('No se encontró esa baja.')
  if (baja.poliza_id === null) {
    throw new ErrorDeNegocio(
      'Esa baja no está enlazada a ninguna póliza, así que no hay nada que reactivar. Cargá la póliza desde Pólizas → Nueva póliza.',
    )
  }
  const periodoAbierto = periodosDisponibles()[0]?.periodo
  if (!periodoAbierto) throw new ErrorDeNegocio('Todavía no hay ninguna planilla cargada: importá la hoja de Google primero.')

  // Tres caminos, en este orden:
  //  1. la póliza YA tiene una fila viva en el mes abierto (alguien la volvió a cargar a mano): no se
  //     toca ninguna cuota, sólo se reactiva la póliza y se saca la baja. Crear otra fila la duplicaría;
  //  2. la fila que quedó marcada al dar de baja es de este mes: se reusa, que es lo más común;
  //  3. la baja es de un mes anterior: se le arma la fila del mes abierto con lo último que tenía.
  const yaEstaEnElMes = db()
    .prepare(`SELECT fila_id FROM cuotas_mes WHERE poliza_id = ? AND periodo = ? AND dada_de_baja = 0 LIMIT 1`)
    .get(baja.poliza_id, periodoAbierto) as { fila_id: string } | undefined

  const cuotaDelMes =
    !yaEstaEnElMes && baja.cuota_fila_id
      ? (db().prepare(`SELECT fila_id, pestana FROM cuotas_mes WHERE fila_id = ? AND periodo = ?`).get(baja.cuota_fila_id, periodoAbierto) as
          | { fila_id: string; pestana: string }
          | undefined)
      : undefined

  const ahora = ahoraIso()
  const pestanaDelMes = cuotaDelMes?.pestana ?? pestanaDelMesAbierto(periodoAbierto)
  const filaNuevaId = yaEstaEnElMes || cuotaDelMes ? null : generarId()
  // Dónde vive el renglón de BAJAS en la hoja: hay que leerlo ANTES de borrar la fila de la tabla.
  const pestanaDeLaBaja = bajaEnLaHoja(bajaId, baja.fila_id)

  db().transaction(() => {
    db().prepare('UPDATE polizas SET activa = 1, actualizado_en = ? WHERE id = ?').run(ahora, baja.poliza_id)
    if (cuotaDelMes) {
      db().prepare('UPDATE cuotas_mes SET dada_de_baja = 0, actualizado_en = ? WHERE fila_id = ?').run(ahora, cuotaDelMes.fila_id)
    } else if (filaNuevaId) {
      db()
        .prepare(
          `INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania,
                                   numero_poliza, patente, sucursal_texto, cuota, cuota_monto, dia_vencimiento,
                                   dia_vencimiento_numero, forma_pago, observaciones, creada_en_la_app, dada_de_baja,
                                   creado_en, actualizado_en)
           VALUES (@fila_id, @periodo, @pestana, @poliza_id, @cliente_id, @cliente_nombre, @documento, @compania,
                   @numero_poliza, @patente, @sucursal_texto, @cuota, @cuota_monto, @dia_vencimiento,
                   @dia_vencimiento_numero, @forma_pago, @observaciones, 1, 0, @ahora, @ahora)`,
        )
        .run({
          fila_id: filaNuevaId,
          periodo: periodoAbierto,
          pestana: pestanaDelMes,
          poliza_id: baja.poliza_id,
          cliente_id: baja.cliente_id,
          cliente_nombre: baja.cliente_nombre,
          documento: baja.documento,
          compania: baja.compania,
          numero_poliza: baja.numero_poliza,
          patente: baja.patente,
          sucursal_texto: baja.sucursal_texto,
          cuota: baja.cuota,
          cuota_monto: interpretarNumero(baja.cuota),
          dia_vencimiento: baja.dia_vencimiento,
          dia_vencimiento_numero: interpretarDiaDeVencimiento(baja.dia_vencimiento),
          forma_pago: baja.forma_pago,
          observaciones: baja.observaciones,
          ahora,
        })
    }
    db().prepare('DELETE FROM bajas WHERE id = ?').run(bajaId)
  })()

  // En la hoja: primero entra la fila en la planilla del mes y después se saca el renglón de BAJAS. Ese
  // orden importa por lo mismo de siempre: si algo falla en el medio, la póliza queda en los dos lados
  // y no perdida.
  if (cuotaDelMes) {
    // La fila ya existía en `filas_crudas` (la baja la sacó de la hoja pero no la olvidó), así que va
    // directo a la cola: es exactamente lo que hace `deshacerBaja`.
    const deVuelta = db().prepare(`${SELECT_PLANILLA} WHERE c.fila_id = ?`).get(cuotaDelMes.fila_id) as FilaCruda | undefined
    if (deVuelta) {
      encolar({ operacion: 'crear', pestana: deVuelta.pestana, filaId: deVuelta.fila_id, campos: camposDeLaFila(deVuelta) }, actor)
    }
  } else if (filaNuevaId) {
    const nueva = db().prepare(`${SELECT_PLANILLA} WHERE c.fila_id = ?`).get(filaNuevaId) as FilaCruda | undefined
    registrarFilaDeLaApp({ filaId: filaNuevaId, pestana: pestanaDelMes, tipoPestana: 'MENSUAL', periodo: periodoAbierto })
    if (nueva) encolar({ operacion: 'crear', pestana: pestanaDelMes, filaId: filaNuevaId, campos: camposDeLaFila(nueva) }, actor)
  }
  encolar({ operacion: 'borrar', pestana: pestanaDeLaBaja, filaId: baja.fila_id, campos: {} }, actor)

  registrarCambio(actor, {
    accion: 'reactivacion',
    tabla: 'polizas',
    registroId: baja.poliza_id,
    filaId: baja.cuota_fila_id ?? baja.fila_id,
    campo: 'PUESTA VIGENTE',
    valorAnterior: baja.motivo,
    valorNuevo: `vuelve a ${periodoAbierto}`,
  })

  return {
    bajas: bajasDelMes(baja.periodo),
    clienteNombre: baja.cliente_nombre ?? 'La póliza',
    periodo: periodoAbierto,
    filaNueva: filaNuevaId !== null,
  }
}

/** La pestaña de la hoja donde vive el renglón de esta baja, para poder sacarlo al reactivarla. */
function bajaEnLaHoja(bajaId: number, filaId: string): string {
  const fila = db().prepare('SELECT pestana FROM bajas WHERE id = ?').get(bajaId) as { pestana: string } | undefined
  if (fila?.pestana) return fila.pestana
  const cruda = db().prepare('SELECT pestana FROM filas_crudas WHERE fila_id = ?').get(filaId) as { pestana: string } | undefined
  return cruda?.pestana ?? 'BAJAS'
}

/** Cómo se llama en la hoja la pestaña del mes abierto (la que ya existe, o la que le corresponde). */
function pestanaDelMesAbierto(periodo: string): string {
  const existente = db().prepare(`SELECT pestana FROM cuotas_mes WHERE periodo = ? LIMIT 1`).get(periodo) as { pestana: string } | undefined
  return existente?.pestana ?? nombreDePestanaMensual(periodo)
}

/**
 * Las bajas del mes con TODO lo que la fila tenía en la cartera.
 *
 * Cada campo se resuelve en tres pasos: primero la foto guardada en la baja (que es cómo estaba el día
 * que se fue y es lo que hay que mostrar), después la póliza / el cliente / el vehículo, que siguen
 * existiendo, y por último la fila de la planilla de ese mes. Los dos últimos son para las bajas que
 * vinieron de la hoja de Google y para las que se cargaron antes de que existiera la foto: sin ellos
 * esas filas seguirían mostrando siete columnas y el resto vacío.
 */
const SELECT_BAJAS = `
  SELECT b.id, b.fila_id, b.periodo, b.motivo, b.nota, b.hecha_en_la_app, b.cuota_fila_id,
         COALESCE(b.fecha_baja_iso, b.fecha_baja) AS fecha_baja,
         COALESCE(b.poliza_id, q.poliza_id) AS poliza_id,
         COALESCE(b.cliente_id, q.cliente_id, p.cliente_id) AS cliente_id,
         COALESCE(b.cliente_nombre, q.cliente_nombre, cl.nombre) AS cliente_nombre,
         COALESCE(b.documento, q.documento, cl.documento) AS documento,
         COALESCE(b.telefono, cl.telefono) AS telefono,
         COALESCE(b.email, cl.email) AS email,
         COALESCE(b.direccion, cl.direccion) AS direccion,
         COALESCE(b.localidad, cl.localidad) AS localidad,
         COALESCE(b.sucursal_texto, q.sucursal_texto, cl.sucursal_texto) AS sucursal_texto,
         COALESCE(b.compania, q.compania, p.compania) AS compania,
         COALESCE(b.numero_poliza, q.numero_poliza, p.numero) AS numero_poliza,
         COALESCE(b.propuesta, p.propuesta) AS propuesta,
         COALESCE(b.cobertura, p.cobertura) AS cobertura,
         COALESCE(b.patente, q.patente, v.patente) AS patente,
         COALESCE(b.tipo_vehiculo, v.tipo) AS tipo_vehiculo,
         COALESCE(b.marca, v.marca) AS marca,
         COALESCE(b.modelo, v.modelo) AS modelo,
         COALESCE(b.anio, v.anio) AS anio,
         COALESCE(b.motor, v.motor) AS motor,
         COALESCE(b.chasis, v.chasis) AS chasis,
         COALESCE(b.uso, v.uso) AS uso,
         COALESCE(b.color, v.color) AS color,
         COALESCE(b.cuota, q.cuota) AS cuota,
         COALESCE(b.dia_vencimiento, q.dia_vencimiento) AS dia_vencimiento,
         COALESCE(b.forma_pago, q.forma_pago, p.forma_pago) AS forma_pago,
         COALESCE(b.prima, p.prima) AS prima,
         COALESCE(b.productor, p.productor) AS productor,
         COALESCE(b.vigencia_desde, p.vigencia_desde) AS vigencia_desde,
         COALESCE(b.vigencia_hasta, p.vigencia_hasta) AS vigencia_hasta,
         COALESCE(b.alta, p.alta) AS alta,
         COALESCE(b.observaciones, q.observaciones, p.observaciones) AS observaciones
  FROM bajas b
  LEFT JOIN cuotas_mes q ON q.fila_id = b.cuota_fila_id
  LEFT JOIN polizas p ON p.id = COALESCE(b.poliza_id, q.poliza_id)
  LEFT JOIN clientes cl ON cl.id = COALESCE(b.cliente_id, q.cliente_id, p.cliente_id)
  LEFT JOIN vehiculos v ON v.id = COALESCE(b.vehiculo_id, p.vehiculo_id)
`

interface BajaCruda {
  id: number
  fila_id: string
  periodo: string | null
  motivo: string | null
  nota: string | null
  hecha_en_la_app: number
  cuota_fila_id: string | null
  fecha_baja: string | null
  poliza_id: number | null
  cliente_id: number | null
  cliente_nombre: string | null
  documento: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  localidad: string | null
  sucursal_texto: string | null
  compania: string | null
  numero_poliza: string | null
  propuesta: string | null
  cobertura: string | null
  patente: string | null
  tipo_vehiculo: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  motor: string | null
  chasis: string | null
  uso: string | null
  color: string | null
  cuota: string | null
  dia_vencimiento: string | null
  forma_pago: string | null
  prima: string | null
  productor: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  alta: string | null
  observaciones: string | null
}

function aBaja(f: BajaCruda): FilaBaja {
  return {
    id: f.id,
    filaId: f.fila_id,
    periodo: f.periodo,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    documento: f.documento,
    telefono: f.telefono,
    email: f.email,
    direccion: f.direccion,
    localidad: f.localidad,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    propuesta: f.propuesta,
    cobertura: f.cobertura,
    patente: f.patente,
    vehiculo: f.tipo_vehiculo,
    marca: f.marca,
    modelo: f.modelo,
    anio: f.anio,
    motor: f.motor,
    chasis: f.chasis,
    uso: f.uso,
    color: f.color,
    cuota: f.cuota,
    diaVencimiento: f.dia_vencimiento,
    formaPago: f.forma_pago,
    prima: f.prima,
    productor: f.productor,
    vigenciaDesde: f.vigencia_desde,
    vigenciaHasta: f.vigencia_hasta,
    alta: f.alta,
    observaciones: f.observaciones,
    sucursal: f.sucursal_texto,
    motivo: f.motivo,
    nota: f.nota,
    fechaBaja: f.fecha_baja,
    polizaId: f.poliza_id,
    hechaEnLaApp: f.hecha_en_la_app === 1,
    // Volver a ponerla vigente sólo necesita saber de qué póliza es: una baja importada de la hoja
    // también se puede reactivar, que es justamente el caso del cliente que vuelve en septiembre.
    puedeReactivarse: f.poliza_id !== null,
  }
}

export function bajasDelMes(periodo: string | null): FilaBaja[] {
  const filas = db()
    .prepare(
      `${SELECT_BAJAS}
       WHERE b.periodo IS ? OR (? IS NULL AND b.periodo IS NULL)
       ORDER BY b.hecha_en_la_app DESC, cliente_nombre`,
    )
    .all(periodo, periodo) as BajaCruda[]
  return filas.map(aBaja)
}

// ---------------------------------------------------------------------------
// Cerrar mes
// ---------------------------------------------------------------------------

/**
 * Crea las cuotas del mes siguiente copiando las pólizas activas, igual que cuando se duplica la hoja:
 * se conservan cuota, vencimiento, forma de pago y observaciones, y se vacían el pago y el aviso.
 */
export function cerrarMes(actor: SesionUsuario): ResumenCierreDeMes {
  const periodos = periodosDisponibles()
  const actual = periodos[0]?.periodo
  if (!actual) throw new ErrorDeNegocio('Todavía no hay ninguna planilla cargada: importá la hoja de Google primero.')
  const nuevo = periodoSiguiente(actual)
  if (periodos.some((p) => p.periodo === nuevo)) throw new ErrorDeNegocio(`El mes ${nuevo} ya existe: no hace falta cerrarlo de nuevo.`)
  if (nuevo > periodoSiguiente(periodoDeHoy())) {
    throw new ErrorDeNegocio(`Ya está abierto ${actual}, que es el mes que viene. Esperá a que llegue para abrir ${nuevo}.`)
  }

  const origen = db()
    .prepare(
      `SELECT c.*, p.id AS poliza_activa_id FROM cuotas_mes c
       JOIN polizas p ON p.id = c.poliza_id AND p.activa = 1
       WHERE c.periodo = ? AND c.dada_de_baja = 0`,
    )
    .all(actual) as Array<Record<string, unknown>>
  if (origen.length === 0) throw new ErrorDeNegocio(`La planilla de ${actual} no tiene pólizas activas para copiar.`)

  const ahora = ahoraIso()
  const pestanaDelMesNuevo = nombreDePestanaMensual(nuevo)
  const insertar = db().prepare(`
    INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania,
                            numero_poliza, patente, sucursal_texto, cuota, cuota_monto, dia_vencimiento,
                            dia_vencimiento_numero, aviso, aviso_enviado, pago, pago_fecha, observaciones,
                            forma_pago, fecha_envio, avisar_vto, creada_en_la_app, dada_de_baja, creado_en, actualizado_en)
    VALUES (@fila_id, @periodo, @pestana, @poliza_id, @cliente_id, @cliente_nombre, @documento, @compania,
            @numero_poliza, @patente, @sucursal_texto, @cuota, @cuota_monto, @dia_vencimiento,
            @dia_vencimiento_numero, @aviso, NULL, NULL, NULL, @observaciones,
            @forma_pago, NULL, @avisar_vto, 1, 0, @ahora, @ahora)`)

  db().transaction(() => {
    for (const fila of origen) {
      const filaId = generarId()
      insertar.run({
        fila_id: filaId,
        periodo: nuevo,
        pestana: pestanaDelMesNuevo,
        poliza_id: fila.poliza_id,
        cliente_id: fila.cliente_id,
        cliente_nombre: fila.cliente_nombre,
        documento: fila.documento,
        compania: fila.compania,
        numero_poliza: fila.numero_poliza,
        patente: fila.patente,
        sucursal_texto: fila.sucursal_texto,
        cuota: fila.cuota,
        cuota_monto: fila.cuota_monto,
        dia_vencimiento: fila.dia_vencimiento,
        dia_vencimiento_numero: fila.dia_vencimiento_numero,
        aviso: fila.aviso,
        observaciones: fila.observaciones,
        forma_pago: fila.forma_pago,
        avisar_vto: fila.avisar_vto,
        ahora,
      })
      // La fila nueva se agrega al final de la pestaña del mes en la hoja. Se anota primero como fila
      // conocida: si no, la bajada la ve como venida de otra computadora y pide una importación completa.
      registrarFilaDeLaApp({ filaId, pestana: pestanaDelMesNuevo, tipoPestana: 'MENSUAL', periodo: nuevo })
      encolar(
        {
          operacion: 'crear',
          pestana: pestanaDelMesNuevo,
          filaId,
          campos: {
            nombre: String(fila.cliente_nombre ?? ''),
            documento: String(fila.documento ?? ''),
            sucursal: String(fila.sucursal_texto ?? ''),
            compania: String(fila.compania ?? ''),
            numero_poliza: String(fila.numero_poliza ?? ''),
            patente: String(fila.patente ?? ''),
            cuota: String(fila.cuota ?? ''),
            dia_vencimiento: String(fila.dia_vencimiento ?? ''),
            forma_pago: String(fila.forma_pago ?? ''),
            aviso: String(fila.aviso ?? ''),
            observaciones: String(fila.observaciones ?? ''),
          },
        },
        actor,
      )
    }
  })()

  registrarCambio(actor, {
    accion: 'cierre_mes',
    tabla: 'cuotas_mes',
    campo: 'PERÍODO',
    valorAnterior: actual,
    valorNuevo: `${nuevo} (${origen.length} pólizas)`,
  })
  return { periodo: nuevo, filasCreadas: origen.length }
}

export { PLANTILLA_AVISO_POR_DEFECTO }

// ---------------------------------------------------------------------------
// Riesgos varios
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Puente con la sincronización
// ---------------------------------------------------------------------------

/** El campo del modelo tal como lo entiende la sincronización (los nombres de `Campo`). */
function campoDeLaHoja(campo: CampoEditable): string {
  const mapa: Partial<Record<CampoEditable, string>> = {
    diaVencimiento: 'dia_vencimiento',
    formaPago: 'forma_pago',
    numeroPoliza: 'numero_poliza',
    vigenciaDesde: 'vigencia_desde',
    vigenciaHasta: 'vigencia_hasta',
    avisarVto: 'avisar_vto',
    vehiculo: 'tipo_vehiculo',
    anio: 'anio',
  }
  return mapa[campo] ?? campo
}

const MESES_EN_MAYUSCULA = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

/** Cómo se llama en la hoja la pestaña mensual de ese período. */
export function nombreDePestanaMensual(periodo: string): string {
  return MESES_EN_MAYUSCULA[Number(periodo.slice(5, 7)) - 1] ?? periodo
}

/** La pestaña de bajas de ese período: la que ya existe en la hoja, o el nombre que le corresponde. */
export function pestanaDeBajas(periodo: string | null): string {
  if (!periodo) return 'BAJAS'
  const existente = db()
    .prepare(`SELECT pestana FROM filas_crudas WHERE tipo_pestana = 'BAJAS' AND periodo = ? LIMIT 1`)
    .get(periodo) as { pestana: string } | undefined
  return existente?.pestana ?? `BAJAS ${nombreDePestanaMensual(periodo)}`
}

/** Los campos de una fila de la planilla, con los nombres que usa la sincronización. */
function camposDeLaFila(fila: FilaCruda): Record<string, string> {
  return {
    nombre: fila.nombre ?? '',
    documento: fila.documento ?? '',
    telefono: fila.telefono ?? '',
    sucursal: fila.sucursal ?? '',
    compania: fila.compania ?? '',
    numero_poliza: fila.numero_poliza ?? '',
    patente: fila.patente ?? '',
    marca: fila.marca ?? '',
    modelo: fila.modelo ?? '',
    anio: fila.anio ?? '',
    tipo_vehiculo: fila.vehiculo ?? '',
    cobertura: fila.cobertura ?? '',
    cuota: fila.cuota ?? '',
    dia_vencimiento: fila.dia_vencimiento ?? '',
    forma_pago: fila.forma_pago ?? '',
    aviso: fila.aviso ?? '',
    observaciones: fila.observaciones ?? '',
    vigencia_desde: fila.vigencia_desde ?? '',
    vigencia_hasta: fila.vigencia_hasta ?? '',
  }
}

// ---------------------------------------------------------------------------
// Puente con la ficha del cliente
// ---------------------------------------------------------------------------

/**
 * Las cuotas del mes abierto de un cliente: es lo que se puede pagar hoy desde su ficha. Se devuelven
 * las filas completas para poder reusar el mismo diálogo de «Registrar pago» que usa la planilla, con
 * los mismos medios de pago y la misma fecha de hoy.
 */
export function cuotasDelClienteEnElMes(clienteId: number): CuotasDelCliente {
  const periodo = periodosDisponibles()[0]?.periodo ?? periodoDeHoy()
  const dias = diasCoberturaPorCompania()
  const crudas = db()
    .prepare(`${SELECT_PLANILLA} WHERE c.periodo = ? AND c.dada_de_baja = 0 AND c.cliente_id = ? ORDER BY nombre`)
    .all(periodo, clienteId) as FilaCruda[]

  return {
    filas: crudas.map((c) => aFila(c, dias)),
    mediosDePago: catalogos().mediosDePago,
    hoy: hoyLocal(),
    periodo,
  }
}
