// Módulo Pólizas: el listado por póliza, el alta y la edición en una sola pantalla, la validación
// contra la matriz de coberturas y la baja.
//
// Una póliza vive repartida en tres tablas: `polizas` (lo que no cambia de mes a mes: compañía, número,
// cobertura, vigencias), `cuotas_mes` (la fila de la planilla del mes, que es donde están la cuota, el
// día de vencimiento y la forma de pago) y `bajas` (por qué se fue). Por eso casi todo lo de acá tiene
// dos mitades: la de la póliza y la de la fila del mes abierto.
import {
  buscarRegla,
  comoTextoDeFecha,
  diasParaVencer,
  estadoDePoliza,
  pareceIso,
  validarAntiguedad,
} from '../../shared/polizas'
import { describirRiesgo, esVehiculo, leerIntegrantes, nombreDeTipoDeRiesgo, tipoDeRiesgo } from '../../shared/riesgos'
import { hoyLocal, periodoDeHoy } from '../../shared/semaforo'
import { mismaSucursal } from '../../shared/sucursales'
import {
  MOTIVOS_DE_BAJA,
  type AvisoDeCobertura,
  type CatalogosDePoliza,
  type DatosDeBaja,
  type DatosDePoliza,
  type EstadoPoliza,
  type FiltrosPolizas,
  type IntegranteDePoliza,
  type ListadoPolizas,
  type MotivoDeBaja,
  type PolizaDeCliente,
  type SesionUsuario,
  type VehiculoDeCliente,
  type CategoriaDeVehiculo,
} from '../../shared/tipos'
import { db } from '../db/base'
import type { Campo } from '../importacion/encabezados'
import {
  ahoraIso,
  generarId,
  interpretarDiaDeVencimiento,
  interpretarEntero,
  interpretarFecha,
  interpretarNumero,
  limpiar,
  normalizarDocumento,
  normalizarNumeroPoliza,
  normalizarPatente,
  normalizarTexto,
} from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { darDeBaja, INSERT_BAJA, nombreDePestanaMensual, periodosDisponibles, pestanaDeBajas } from './cartera'
import { sincronizarCompanias } from './companias'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { reglasVigentes } from './reglas'
import { sucursalesParaElegir } from './sucursales'
import { enteroPositivo, objeto, texto } from './validacion'

/** El mismo valor que usa cartera.ts para las filas que nacieron en la aplicación y no en una pestaña. */
const PESTANA_APP = '(cargado en DM Gestión)'

/** Formas de pago que ya usa la agencia; el desplegable las ofrece pero deja escribir otra. */
const FORMAS_DE_PAGO = ['CUPONERA', 'LOCAL', 'TARJETA', 'CBU', 'EFECTIVO', 'TRANSFERENCIA', 'MERCADO PAGO', 'DEBITO']

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Una fila por póliza. La cuota y el día de vencimiento se traen del mes abierto con un LEFT JOIN a la
 * cuota puntual (no a `poliza_id = p.id AND periodo = …`): si por un error de la hoja quedaron dos filas
 * de la misma póliza en el mismo mes, el listado tiene que seguir mostrando una sola póliza.
 * La baja es la más reciente de esa póliza, que es la que explica por qué está dada de baja hoy.
 */
const SELECT_POLIZAS = `
  SELECT
    p.id, p.fila_id, p.numero, p.propuesta, p.compania, p.cobertura, p.activa, p.clave,
    p.vigencia_desde, p.vigencia_hasta, p.vigencia_desde_iso, p.vigencia_hasta_iso,
    COALESCE(q.forma_pago, p.forma_pago) AS forma_pago,
    COALESCE(p.avisar_vto, q.avisar_vto) AS avisar_vto,
    COALESCE(p.observaciones, q.observaciones) AS observaciones,
    q.id AS cuota_id, q.fila_id AS cuota_fila_id, q.pestana AS cuota_pestana,
    q.cuota, q.dia_vencimiento,
    p.vehiculo_id, v.marca, v.modelo, v.tipo AS tipo_vehiculo, v.anio, v.chasis,
    v.direccion_riesgo, v.titular_nombre, v.titular_documento, v.integrantes,
    COALESCE(v.patente, q.patente) AS patente,
    p.cliente_id,
    COALESCE(cl.nombre, q.cliente_nombre) AS cliente_nombre,
    COALESCE(cl.documento, q.documento) AS documento,
    COALESCE(cl.sucursal_texto, q.sucursal_texto) AS sucursal,
    b.motivo AS motivo_baja,
    COALESCE(b.fecha_baja_iso, b.fecha_baja) AS fecha_baja
  FROM polizas p
  LEFT JOIN clientes cl ON cl.id = p.cliente_id
  LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
  LEFT JOIN cuotas_mes q ON q.id = (
    SELECT c2.id FROM cuotas_mes c2
    WHERE c2.poliza_id = p.id AND c2.periodo = @periodo AND c2.dada_de_baja = 0
    ORDER BY c2.id DESC LIMIT 1)
  LEFT JOIN bajas b ON b.id = (
    SELECT b2.id FROM bajas b2
    WHERE b2.poliza_id = p.id
    ORDER BY COALESCE(b2.fecha_baja_iso, b2.fecha_baja) DESC, b2.id DESC LIMIT 1)
`

interface FilaCrudaPoliza {
  id: number
  fila_id: string | null
  numero: string | null
  propuesta: string | null
  compania: string | null
  cobertura: string | null
  activa: number
  clave: string
  vigencia_desde: string | null
  vigencia_hasta: string | null
  vigencia_desde_iso: string | null
  vigencia_hasta_iso: string | null
  forma_pago: string | null
  avisar_vto: string | null
  observaciones: string | null
  cuota_id: number | null
  cuota_fila_id: string | null
  cuota_pestana: string | null
  cuota: string | null
  dia_vencimiento: string | null
  vehiculo_id: number | null
  marca: string | null
  modelo: string | null
  tipo_vehiculo: string | null
  anio: string | null
  chasis: string | null
  direccion_riesgo: string | null
  titular_nombre: string | null
  titular_documento: string | null
  integrantes: string | null
  patente: string | null
  cliente_id: number
  cliente_nombre: string | null
  documento: string | null
  sucursal: string | null
  motivo_baja: string | null
  fecha_baja: string | null
}

/**
 * Cómo se nombra el riesgo en una sola celda. En un vehículo, la marca y el modelo son lo que la gente
 * busca con la vista; el tipo («AUTO», «MOTO») queda de respaldo para las filas viejas que sólo tienen
 * eso. En los demás riesgos (hogar, bicicleta, accidentes personales…) la línea la arma shared/riesgos,
 * igual que en el formulario y en la ficha del cliente: «Hogar · MITRE 1234».
 */
function describirVehiculo(fila: FilaCrudaPoliza): string | null {
  if (!esVehiculo(fila.tipo_vehiculo)) {
    return (
      describirRiesgo({
        tipo: fila.tipo_vehiculo,
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
  return descripcion || limpiar(fila.tipo_vehiculo) || null
}

function aPoliza(fila: FilaCrudaPoliza, hoy: string): PolizaDeCliente {
  return {
    id: fila.id,
    filaId: fila.fila_id,
    numero: fila.numero,
    propuesta: fila.propuesta,
    compania: fila.compania,
    cobertura: fila.cobertura,
    formaPago: fila.forma_pago,
    cuota: fila.cuota,
    diaVencimiento: fila.dia_vencimiento,
    vigenciaDesde: fila.vigencia_desde,
    vigenciaHasta: fila.vigencia_hasta,
    vigenciaHastaIso: fila.vigencia_hasta_iso,
    avisarVto: fila.avisar_vto,
    observaciones: fila.observaciones,
    estado: estadoDePoliza(fila.activa === 1, fila.vigencia_hasta_iso, hoy),
    vehiculoId: fila.vehiculo_id,
    vehiculo: describirVehiculo(fila),
    patente: fila.patente,
    clienteId: fila.cliente_id,
    clienteNombre: fila.cliente_nombre,
    sucursal: fila.sucursal,
    // Sólo se muestran si la póliza está dada de baja: una póliza que volvió tiene una baja vieja
    // en la tabla y sería confuso mostrarla como si estuviera vigente.
    motivoBaja: fila.activa === 1 ? null : fila.motivo_baja,
    fechaBaja: fila.activa === 1 ? null : fila.fecha_baja,
    diasParaVencer: diasParaVencer(fila.vigencia_hasta_iso, hoy),
  }
}

/** El mes abierto: el período más nuevo que todavía tiene filas vivas. null si no se importó nada. */
function periodoAbierto(): string | null {
  return periodosDisponibles()[0]?.periodo ?? null
}

/**
 * Cómo se llama en la hoja la pestaña mensual de ese período. Si el mes ya tiene filas se usa el nombre
 * real de su pestaña (la agencia las titula «AGOSTO», pero también hay «AGOSTO 25»); si no, el que le
 * corresponde por el mes.
 */
function pestanaDelMes(periodo: string): string {
  const existente = db().prepare(`SELECT pestana FROM cuotas_mes WHERE periodo = ? LIMIT 1`).get(periodo) as
    | { pestana: string }
    | undefined
  return existente?.pestana ?? nombreDePestanaMensual(periodo)
}

function leerCruda(polizaId: number): FilaCrudaPoliza {
  const fila = db().prepare(`${SELECT_POLIZAS} WHERE p.id = @id`).get({ periodo: periodoAbierto(), id: polizaId }) as
    | FilaCrudaPoliza
    | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa póliza. Actualizá la pantalla y probá de nuevo.')
  return fila
}

export function verPoliza(polizaId: number): PolizaDeCliente {
  return aPoliza(leerCruda(enteroPositivo(polizaId, 'La póliza')), hoyLocal())
}

export function polizasDeCliente(clienteId: number): PolizaDeCliente[] {
  const id = enteroPositivo(clienteId, 'El cliente')
  const hoy = hoyLocal()
  const filas = db()
    .prepare(`${SELECT_POLIZAS} WHERE p.cliente_id = @cliente ORDER BY p.activa DESC, p.vigencia_hasta_iso DESC, p.id DESC`)
    .all({ periodo: periodoAbierto(), cliente: id }) as FilaCrudaPoliza[]
  return filas.map((f) => aPoliza(f, hoy))
}

export function vehiculosDeCliente(clienteId: number): VehiculoDeCliente[] {
  const id = enteroPositivo(clienteId, 'El cliente')
  const filas = db()
    .prepare(
      `SELECT v.id, v.patente, v.marca, v.modelo, v.linea, v.anio, v.anio_numero, v.tipo, v.categoria, v.motor, v.chasis, v.uso, v.color,
              v.direccion_riesgo, v.titular_nombre, v.titular_documento, v.integrantes,
              (SELECT COUNT(*) FROM polizas p WHERE p.vehiculo_id = v.id) AS polizas
       FROM vehiculos v WHERE v.cliente_id = ? ORDER BY v.patente, v.marca, v.id`,
    )
    .all(id) as Array<{
    id: number
    patente: string | null
    marca: string | null
    modelo: string | null
    linea: string | null
    anio: string | null
    anio_numero: number | null
    tipo: string | null
    categoria: string | null
    motor: string | null
    chasis: string | null
    uso: string | null
    color: string | null
    direccion_riesgo: string | null
    titular_nombre: string | null
    titular_documento: string | null
    integrantes: string | null
    polizas: number
  }>
  return filas.map((f) => ({
    id: f.id,
    patente: f.patente,
    marca: f.marca,
    modelo: f.modelo,
    linea: f.linea,
    anio: f.anio,
    anioNumero: f.anio_numero,
    tipo: f.tipo,
    categoria: (f.categoria as CategoriaDeVehiculo | null) ?? null,
    motor: f.motor,
    chasis: f.chasis,
    uso: f.uso,
    color: f.color,
    direccionRiesgo: f.direccion_riesgo,
    titularNombre: f.titular_nombre,
    titularDocumento: f.titular_documento,
    integrantes: leerIntegrantes(f.integrantes),
    polizas: f.polizas,
  }))
}

// ---------------------------------------------------------------------------
// Catálogos
// ---------------------------------------------------------------------------

/** Valores distintos de una columna, sin repetir por mayúsculas o tildes y ordenados como se leen. */
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

function combinar(...listas: string[][]): string[] {
  const vistos = new Map<string, string>()
  for (const lista of listas) {
    for (const valor of lista) {
      const clave = normalizarTexto(valor)
      if (clave && !vistos.has(clave)) vistos.set(clave, valor)
    }
  }
  return [...vistos.values()]
}

/**
 * Los desplegables del alta y los filtros del listado. Las coberturas incluyen las de la matriz aunque
 * todavía no las use ninguna póliza: si la compañía acepta una cobertura, tiene que poder elegirse.
 */
export function catalogosDePoliza(): CatalogosDePoliza {
  sincronizarCompanias()
  return {
    companias: combinar(
      valoresDistintos('SELECT nombre AS valor FROM companias WHERE activa = 1'),
      valoresDistintos('SELECT DISTINCT compania AS valor FROM polizas'),
    ),
    coberturas: combinar(
      valoresDistintos('SELECT DISTINCT cobertura AS valor FROM polizas'),
      valoresDistintos('SELECT DISTINCT cobertura AS valor FROM reglas_cobertura'),
    ),
    formasDePago: combinar(
      FORMAS_DE_PAGO,
      valoresDistintos('SELECT DISTINCT forma_pago AS valor FROM polizas'),
      valoresDistintos('SELECT DISTINCT forma_pago AS valor FROM cuotas_mes'),
    ),
    // Las sucursales no pasan por `combinar`: la lista de sucursal es una sola en toda la aplicación
    // y la arma `sucursalesParaElegir`, para que el alta de una póliza ofrezca las mismas cuatro que
    // el filtro del listado y que la Cartera.
    sucursales: sucursalesParaElegir(valoresDistintos('SELECT DISTINCT sucursal_texto AS valor FROM clientes')),
    tiposDeVehiculo: valoresDistintos('SELECT DISTINCT tipo AS valor FROM vehiculos'),
  }
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

export function listarPolizas(filtros: FiltrosPolizas): ListadoPolizas {
  const f = objeto(filtros, 'Los filtros')
  const busqueda = normalizarTexto(f.busqueda)
  const estado = typeof f.estado === 'string' ? f.estado : ''
  const compania = limpiar(f.compania)
  const sucursal = limpiar(f.sucursal)
  const cobertura = limpiar(f.cobertura)
  const hoy = hoyLocal()

  // Todos los filtros se resuelven en memoria, con `normalizarTexto`. En SQL no se puede: `UPPER()` de
  // SQLite sólo sube el ASCII, así que elegir «Lanús» del desplegable no encontraba las filas que la
  // hoja escribió «LANUS» y el listado salía vacío sin explicar por qué. El catálogo mezcla el nombre
  // oficial de la sucursal con el texto crudo de la planilla, así que el desajuste es el caso normal,
  // no la excepción. Son ~2.400 filas: filtrarlas acá no se nota.
  const compare = (valor: string | null, buscado: string) => !buscado || normalizarTexto(valor) === normalizarTexto(buscado)

  const crudas = db()
    .prepare(`${SELECT_POLIZAS} ORDER BY cliente_nombre COLLATE NOCASE, p.id`)
    .all({ periodo: periodoAbierto() }) as FilaCrudaPoliza[]

  const filas = crudas
    .filter((fila) => compare(fila.compania, compania))
    .filter((fila) => compare(fila.cobertura, cobertura))
    // La sucursal no pasa por `compare`: la compara `mismaSucursal`, que además de las tildes sabe
    // que «AVELLANEDA» y «DOCKSUD» son Dock Sud. Es el mismo plegado con el que `sucursalesParaElegir`
    // arma el desplegable de arriba, así que toda opción trae sus filas y toda fila tiene su opción.
    .filter((fila) => !sucursal || mismaSucursal(fila.sucursal, sucursal))
    .filter((fila) => coincideLaBusqueda(fila, busqueda))
    .map((fila) => aPoliza(fila, hoy))
    .filter((poliza) => estado === '' || poliza.estado === (estado as EstadoPoliza))

  const total = (db().prepare('SELECT COUNT(*) AS n FROM polizas').get() as { n: number }).n
  return { filas, total, catalogos: catalogosDePoliza(), hoy }
}

/** Se busca por nombre, documento, número de póliza y patente, que es lo que se tiene a mano en el mostrador. */
function coincideLaBusqueda(fila: FilaCrudaPoliza, busqueda: string): boolean {
  if (!busqueda) return true
  const donde = [fila.cliente_nombre, fila.documento, fila.numero, fila.propuesta, fila.patente]
  return donde.some((valor) => normalizarTexto(valor).includes(busqueda))
}

// ---------------------------------------------------------------------------
// Validación contra la matriz de coberturas
// ---------------------------------------------------------------------------

/**
 * Si la compañía acepta esa cobertura para un vehículo de ese año. La regla la resuelve
 * shared/polizas.ts para que la pantalla y el proceso principal adviertan exactamente lo mismo.
 */
export function validarCobertura(compania: string, cobertura: string, anioVehiculo: string): AvisoDeCobertura {
  const reglas = reglasVigentes()
  const regla = buscarRegla(reglas, limpiar(compania), limpiar(cobertura))
  return validarAntiguedad(regla, anioVehiculo, Number(hoyLocal().slice(0, 4)))
}

/**
 * La cobertura es obligatoria en un vehículo (TERCEROS COMPLETO, TODO RIESGO…): es lo que después se
 * cruza con la matriz de reglas. En una casa o un accidentes personales el nombre del riesgo ya dice
 * qué se aseguró, y la planilla de siempre las cargaba sin cobertura, así que ahí se deja vacía.
 */
function exigirCoberturaDelVehiculo(vehiculo: VehiculoResuelto, validados: DatosValidados): void {
  if (esVehiculo(vehiculo.tipo) && !validados.cobertura) {
    throw new ErrorDeNegocio('Cargá la cobertura de la póliza (por ejemplo, TERCEROS COMPLETO o TODO RIESGO).')
  }
}

/**
 * La antigüedad se valida sólo en los vehículos: una casa no tiene modelo, y una regla de SANCOR para
 * «HOGAR» que dijera «desde el modelo 2011» no querría decir nada.
 */
function avisoDeAntiguedad(vehiculo: VehiculoResuelto, validados: DatosValidados): AvisoDeCobertura {
  if (!esVehiculo(vehiculo.tipo)) return { hayProblema: false, mensaje: '', regla: null }
  return validarCobertura(validados.compania, validados.cobertura, vehiculo.anio)
}

/**
 * La advertencia frena el guardado salvo que un administrador la confirme. El pliego lo dice así: «se
 * puede continuar con confirmación de ADMIN», o sea que el empleado no puede levantarse el freno solo.
 */
function exigirCobertura(aviso: AvisoDeCobertura, confirmado: boolean, actor: SesionUsuario): void {
  if (!aviso.hayProblema) return
  if (!confirmado) throw new ErrorDeNegocio(aviso.mensaje)
  if (actor.rol === 'EMPLEADO') {
    throw new ErrorDeNegocio(`${aviso.mensaje} Para cargarla igual la tiene que confirmar un administrador.`)
  }
}

/** Deja constancia de que se siguió pese al aviso: es la única manera de saber después por qué se emitió. */
function anotarAvisoIgnorado(actor: SesionUsuario, polizaId: number, filaId: string | null, aviso: AvisoDeCobertura): void {
  if (!aviso.hayProblema) return
  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'polizas',
    registroId: polizaId,
    filaId,
    campo: 'AVISO DE COBERTURA',
    valorAnterior: aviso.mensaje,
    valorNuevo: `Confirmado por ${actor.nombre}`,
  })
}

// ---------------------------------------------------------------------------
// Validación de los datos del formulario
// ---------------------------------------------------------------------------

interface DatosValidados {
  clienteId: number
  compania: string
  cobertura: string
  formaPago: string
  cuota: string
  diaVencimiento: string
  numero: string
  propuesta: string
  vigenciaDesde: string
  vigenciaHasta: string
  avisarVto: string
  observaciones: string
  confirmado: boolean
}

/** Campo que puede venir vacío. Se revisa igual el tipo y el largo: el renderer no es confiable. */
function opcional(valor: unknown, campo: string, maximo: number): string {
  if (valor === null || valor === undefined) return ''
  return texto(valor, campo, 0, maximo)
}

/**
 * Vigencia de la hoja a fecha de verdad. Se aceptan hasta dos años adelante porque una vigencia que
 * termina el año que viene es lo normal, no una fecha fuera de rango.
 */
function vigenciaAIso(valor: string, anioBase: number): string | null {
  return interpretarFecha(valor, anioBase, anioBase + 1).iso
}

function validarDatos(datos: DatosDePoliza): DatosValidados {
  const d = objeto(datos, 'Los datos de la póliza')
  const validados: DatosValidados = {
    clienteId: enteroPositivo(d.clienteId, 'El cliente'),
    compania: texto(d.compania, 'La compañía', 1, 120),
    // Obligatoria sólo en los vehículos: se exige en `exigirCobertura`, cuando ya se sabe qué riesgo es.
    cobertura: opcional(d.cobertura, 'La cobertura', 120),
    formaPago: opcional(d.formaPago, 'La forma de pago', 60),
    cuota: opcional(d.cuota, 'La cuota', 40),
    diaVencimiento: opcional(d.diaVencimiento, 'El día de vencimiento', 40),
    numero: opcional(d.numero, 'El número de póliza', 60),
    propuesta: opcional(d.propuesta, 'El número de propuesta', 60),
    vigenciaDesde: opcional(d.vigenciaDesde, 'La vigencia desde', 40),
    vigenciaHasta: opcional(d.vigenciaHasta, 'La vigencia hasta', 40),
    avisarVto: opcional(d.avisarVto, 'El aviso de vencimiento', 120),
    observaciones: opcional(d.observaciones, 'Las observaciones', 500),
    confirmado: d.confirmadoPeseAlAviso === true,
  }

  // Una póliza sin número todavía se identifica por la propuesta; sin ninguno de los dos no hay con qué.
  if (!validados.numero && !validados.propuesta) {
    throw new ErrorDeNegocio('Cargá el número de póliza o, si todavía no está emitida, el número de propuesta.')
  }
  if (validados.diaVencimiento && interpretarDiaDeVencimiento(validados.diaVencimiento) === null) {
    throw new ErrorDeNegocio('El día de vencimiento tiene que ser un número del 1 al 31.')
  }

  const anioBase = Number(hoyLocal().slice(0, 4))
  const desde = validados.vigenciaDesde ? vigenciaAIso(validados.vigenciaDesde, anioBase) : null
  const hasta = validados.vigenciaHasta ? vigenciaAIso(validados.vigenciaHasta, anioBase) : null
  if (validados.vigenciaDesde && !desde) {
    throw new ErrorDeNegocio(`«${validados.vigenciaDesde}» no es una fecha válida. Usá el formato día/mes/año.`)
  }
  if (validados.vigenciaHasta && !hasta) {
    throw new ErrorDeNegocio(`«${validados.vigenciaHasta}» no es una fecha válida. Usá el formato día/mes/año.`)
  }
  if (desde && hasta && hasta < desde) {
    throw new ErrorDeNegocio('La vigencia no puede terminar antes de empezar: revisá las fechas.')
  }

  // Lo que el usuario escribió con sus palabras se guarda tal cual, como todo en esta aplicación. Pero
  // el selector de fecha entrega 'AAAA-MM-DD', y ese texto termina en la columna de la planilla junto a
  // veinte años de fechas escritas como 27/4/2026: sólo en ese caso se pasa al formato de la hoja.
  if (pareceIso(validados.vigenciaDesde) && desde) validados.vigenciaDesde = comoTextoDeFecha(desde)
  if (pareceIso(validados.vigenciaHasta) && hasta) validados.vigenciaHasta = comoTextoDeFecha(hasta)

  return validados
}

// ---------------------------------------------------------------------------
// Claves de identidad (las mismas que arma el importador)
// ---------------------------------------------------------------------------

/**
 * La clave con la que el importador reconoce una póliza de un mes al otro. Se calcula igual acá para
 * que una póliza cargada en la aplicación y después leída de la hoja sea la misma póliza y no dos.
 */
function claveDePoliza(compania: string, numero: string, documento: string | null, nombre: string | null, patente: string | null, filaId: string): string {
  const numeroNormalizado = normalizarNumeroPoliza(numero)
  if (numeroNormalizado.length >= 3 && /\d/.test(numeroNormalizado)) {
    return `POL:${normalizarTexto(compania)}|${numeroNormalizado}`
  }
  const patenteNormalizada = normalizarPatente(patente)
  const documentoNormalizado = normalizarDocumento(documento)
  const documentoValido = documentoNormalizado.length >= 6 && documentoNormalizado.length <= 11
  if (documentoValido && patenteNormalizada) return `DOCPAT:${documentoNormalizado}|${patenteNormalizada}`
  const nombreNormalizado = normalizarTexto(nombre)
  if (nombreNormalizado && patenteNormalizada) return `NOMPAT:${nombreNormalizado}|${patenteNormalizada}`
  return `FILA:${filaId}`
}

/** Igual que el importador: por patente si la hay, y si no por cliente + marca + modelo + motor/chasis. */
function claveDeVehiculo(clienteId: number, patente: string, marca: string, modelo: string, motor: string, chasis: string): string {
  const patenteNormalizada = normalizarPatente(patente)
  if (patenteNormalizada) return `PAT:${patenteNormalizada}`
  const distintivo = normalizarTexto(chasis) || normalizarTexto(motor)
  return `CLI:${clienteId}|${normalizarTexto(marca)}|${normalizarTexto(modelo)}${distintivo ? `|${distintivo}` : ''}`
}

/**
 * La clave de un riesgo que no es vehículo. Lo que lo distingue depende del tipo: la dirección en una
 * casa o un local, el cuadro (o la marca) en una bicicleta, la gente cubierta en un accidentes
 * personales, la persona en «otros». Siempre lleva el cliente y el tipo adelante: dos casas del mismo
 * cliente con distinta dirección son dos riesgos, y la misma dirección cargada dos veces es uno solo.
 */
function claveDeRiesgo(clienteId: number, tipo: string, distintivo: string): string {
  return `RIESGO:${clienteId}|${normalizarTexto(tipo)}|${distintivo}`
}

// ---------------------------------------------------------------------------
// Resolución del vehículo
// ---------------------------------------------------------------------------

interface VehiculoResuelto {
  id: number | null
  /** Datos del riesgo, para la fila del mes y para validar la antigüedad. */
  patente: string
  marca: string
  modelo: string
  anio: string
  tipo: string
  motor: string
  chasis: string
  uso: string
  color: string
  /** El riesgo en una línea, para el historial de cambios: «Hogar · MITRE 1234», «FORD FIESTA AB123CD». */
  descripcion: string
  /** Lo que hay que insertar si el riesgo todavía no existe. Null si ya existía. */
  aCrear: Record<string, unknown> | null
}

interface ClienteCargado {
  id: number
  nombre: string
  documento: string | null
  telefono: string | null
  sucursal_texto: string | null
}

function leerCliente(clienteId: number): ClienteCargado {
  const cliente = db()
    .prepare('SELECT id, nombre, documento, telefono, sucursal_texto FROM clientes WHERE id = ?')
    .get(clienteId) as ClienteCargado | undefined
  if (!cliente) throw new ErrorDeNegocio('No se encontró ese cliente. Actualizá la pantalla y probá de nuevo.')
  return cliente
}

interface VehiculoGuardado {
  id: number
  cliente_id: number | null
  patente: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  tipo: string | null
  motor: string | null
  chasis: string | null
  uso: string | null
  color: string | null
  direccion_riesgo: string | null
  titular_nombre: string | null
  titular_documento: string | null
  integrantes: string | null
}

const SELECT_VEHICULO = `SELECT id, cliente_id, patente, marca, modelo, anio, tipo, motor, chasis, uso, color,
                                direccion_riesgo, titular_nombre, titular_documento, integrantes
                         FROM vehiculos`

function leerVehiculo(id: number): VehiculoGuardado | undefined {
  return db().prepare(`${SELECT_VEHICULO} WHERE id = ?`).get(id) as VehiculoGuardado | undefined
}

function comoResuelto(veh: VehiculoGuardado): VehiculoResuelto {
  return {
    id: veh.id,
    patente: limpiar(veh.patente),
    marca: limpiar(veh.marca),
    modelo: limpiar(veh.modelo),
    anio: limpiar(veh.anio),
    tipo: limpiar(veh.tipo),
    motor: limpiar(veh.motor),
    chasis: limpiar(veh.chasis),
    uso: limpiar(veh.uso),
    color: limpiar(veh.color),
    descripcion: describirRiesgo({
      tipo: veh.tipo,
      patente: veh.patente,
      marca: veh.marca,
      modelo: veh.modelo,
      anio: veh.anio,
      chasis: veh.chasis,
      direccionRiesgo: veh.direccion_riesgo,
      titularNombre: veh.titular_nombre,
      titularDocumento: veh.titular_documento,
      integrantes: leerIntegrantes(veh.integrantes),
    }),
    aCrear: null,
  }
}

/** Los integrantes que manda la pantalla, revisados uno por uno: el renderer no es confiable. */
function integrantesValidados(valor: unknown): IntegranteDePoliza[] {
  if (valor === null || valor === undefined) return []
  if (!Array.isArray(valor)) throw new ErrorDeNegocio('Los integrantes de la póliza no tienen el formato esperado.')
  if (valor.length > 50) throw new ErrorDeNegocio('Una póliza no puede tener más de 50 integrantes.')
  const lista: IntegranteDePoliza[] = []
  for (const item of valor) {
    const i = objeto(item, 'Un integrante de la póliza')
    const nombre = opcional(i.nombre, 'El nombre del integrante', 120)
    const documento = opcional(i.documento, 'El DNI del integrante', 20)
    // Una fila que quedó en blanco en la pantalla no es un integrante: se ignora sin protestar.
    if (!nombre && !documento) continue
    lista.push({ nombre, documento })
  }
  return lista
}

/**
 * El vehículo de la póliza: uno que ya es del cliente o uno nuevo. No se toca un vehículo que figura a
 * nombre de otra persona: si la patente cambió de dueño hay que darla de baja donde estaba, porque si
 * no la póliza vieja se queda sin auto sin que nadie se entere.
 *
 * `actual` es el vehículo que la póliza ya tiene: al editar, un formulario que no manda ninguno de los
 * dos no está pidiendo sacarle el auto a la póliza, simplemente no tocó esa parte de la pantalla.
 */
function resolverVehiculo(datos: DatosDePoliza, cliente: ClienteCargado, actual: number | null, exigir: boolean): VehiculoResuelto {
  const vehiculoId = datos.vehiculoId
  if (vehiculoId !== null && vehiculoId !== undefined) {
    const id = enteroPositivo(vehiculoId, 'El vehículo')
    const veh = leerVehiculo(id)
    if (!veh) throw new ErrorDeNegocio('No se encontró ese vehículo.')
    if (veh.cliente_id !== cliente.id) {
      throw new ErrorDeNegocio('Ese vehículo no figura a nombre de este cliente. Elegí uno de su lista o cargá uno nuevo.')
    }
    return comoResuelto(veh)
  }

  const nuevo = datos.vehiculoNuevo
  if (!nuevo) {
    if (exigir) throw new ErrorDeNegocio('Elegí un riesgo del cliente (un vehículo, una casa…) o cargá uno nuevo.')
    const veh = actual === null ? undefined : leerVehiculo(actual)
    return veh
      ? comoResuelto(veh)
      : { id: actual, patente: '', marca: '', modelo: '', anio: '', tipo: '', motor: '', chasis: '', uso: '', color: '', descripcion: '', aCrear: null }
  }
  const n = objeto(nuevo, 'Los datos del riesgo')
  const tipo = opcional(n.tipo, 'El tipo de riesgo', 60)
  const patente = opcional(n.patente, 'La patente', 20)
  const marca = opcional(n.marca, 'La marca', 60)
  const modelo = opcional(n.modelo, 'El modelo', 60)
  const anio = opcional(n.anio, 'El año del vehículo', 20)
  // Lo que viene del catálogo. La categoría NO se valida contra una lista de la pantalla: llega tal
  // como la resolvió el catálogo o llega vacía, y el único que puede llenarla es 'vehiculos:resolver'.
  const linea = opcional(n.linea, 'La línea del vehículo', 120)
  const categoria = opcional(n.categoria, 'La categoría del vehículo', 30)
  const catalogoCodigo = opcional(n.catalogoCodigo, 'El código del catálogo', 60)
  const motor = opcional(n.motor, 'El motor', 60)
  const chasis = opcional(n.chasis, 'El chasis', 60)
  const uso = opcional(n.uso, 'El uso', 60)
  const color = opcional(n.color, 'El color', 40)
  const direccionRiesgo = opcional(n.direccionRiesgo, 'La dirección del riesgo', 200)
  const titularNombre = opcional(n.titularNombre, 'El nombre del titular', 120)
  const titularDocumento = opcional(n.titularDocumento, 'El DNI del titular', 20)
  const integrantes = integrantesValidados(n.integrantes)

  // Cada riesgo pide lo suyo. Un auto se reconoce por la patente (o la marca y el modelo); una casa,
  // por su dirección; un accidentes personales, por la gente que cubre. Sin eso no hay qué asegurar.
  const riesgo = tipoDeRiesgo(tipo)
  const vehicular = esVehiculo(tipo)
  let clave: string
  if (vehicular) {
    if (!patente && !marca && !modelo) {
      throw new ErrorDeNegocio('Del vehículo hace falta al menos la patente, o la marca y el modelo.')
    }
    clave = claveDeVehiculo(cliente.id, patente, marca, modelo, motor, chasis)
  } else if (riesgo === 'BICICLETA') {
    if (!marca && !chasis) throw new ErrorDeNegocio('De la bicicleta hace falta al menos la marca o el número de cuadro.')
    // La misma clave que arma el importador con la fila de la hoja (marca y chasis viajan a la
    // planilla): así la bicicleta que vuelve de la hoja es la misma y no una segunda.
    clave = claveDeVehiculo(cliente.id, '', marca, '', '', chasis)
  } else if (riesgo === 'ACCIDENTE PERSONAL') {
    if (integrantes.length === 0) throw new ErrorDeNegocio('Cargá al menos una persona cubierta, con su nombre completo y su DNI.')
    clave = claveDeRiesgo(
      cliente.id,
      riesgo,
      integrantes.map((i) => normalizarDocumento(i.documento) || normalizarTexto(i.nombre)).join(','),
    )
  } else if (riesgo === 'HOGAR' || riesgo === 'INTEGRAL DE COMERCIO') {
    if (!direccionRiesgo) {
      throw new ErrorDeNegocio(riesgo === 'HOGAR' ? 'Cargá la dirección de la casa asegurada.' : 'Cargá la dirección del comercio asegurado.')
    }
    clave = claveDeRiesgo(cliente.id, riesgo, normalizarTexto(direccionRiesgo))
  } else {
    // OTRO: lo único que se sabe es de quién es.
    if (!titularNombre && !titularDocumento) throw new ErrorDeNegocio('Cargá el nombre o el DNI de la persona asegurada.')
    clave = claveDeRiesgo(cliente.id, 'OTRO', normalizarDocumento(titularDocumento) || normalizarTexto(titularNombre))
  }

  const existente = db().prepare(`${SELECT_VEHICULO} WHERE clave = ?`).get(clave) as VehiculoGuardado | undefined
  if (existente) {
    if (existente.cliente_id !== null && existente.cliente_id !== cliente.id) {
      throw new ErrorDeNegocio(
        `La patente ${patente || existente.patente} ya está cargada a nombre de otro cliente. Revisá la cartera antes de volver a usarla.`,
      )
    }
    // Es un riesgo que este cliente ya tenía cargado: se reusa en vez de duplicarlo.
    const resuelto = comoResuelto(existente)
    return {
      ...resuelto,
      patente: resuelto.patente || patente,
      marca: resuelto.marca || marca,
      modelo: resuelto.modelo || modelo,
      anio: resuelto.anio || anio,
      tipo: resuelto.tipo || tipo,
      chasis: resuelto.chasis || chasis,
    }
  }

  return {
    id: null,
    patente,
    marca,
    modelo,
    anio,
    tipo,
    motor,
    chasis,
    uso,
    color,
    descripcion: describirRiesgo({ tipo, patente, marca, modelo, anio, chasis, direccionRiesgo, titularNombre, titularDocumento, integrantes }),
    aCrear: {
      clave,
      patente: patente || null,
      patente_normalizada: normalizarPatente(patente) || null,
      marca: marca || null,
      modelo: modelo || null,
      linea: linea || null,
      anio: anio || null,
      anio_numero: interpretarEntero(anio, 1950, Number(hoyLocal().slice(0, 4)) + 1),
      categoria: categoria || null,
      // Sin código, el vehículo se cargó a mano: es lo que distingue uno identificado de uno tipeado.
      catalogo_proveedor: catalogoCodigo ? 'InfoAuto' : null,
      catalogo_codigo: catalogoCodigo || null,
      motor: motor || null,
      chasis: chasis || null,
      tipo: tipo || null,
      uso: uso || null,
      color: color || null,
      direccion_riesgo: direccionRiesgo || null,
      titular_nombre: titularNombre || null,
      titular_documento: titularDocumento || null,
      integrantes: integrantes.length > 0 ? JSON.stringify(integrantes) : null,
      cliente_id: cliente.id,
    },
  }
}

function crearVehiculo(aCrear: Record<string, unknown>, ahora: string): number {
  const fila = db()
    .prepare(
      `INSERT INTO vehiculos (clave, patente, patente_normalizada, marca, modelo, linea, anio, anio_numero, categoria,
                              catalogo_proveedor, catalogo_codigo, motor, chasis, tipo, uso, color,
                              direccion_riesgo, titular_nombre, titular_documento, integrantes, cliente_id,
                              creado_en, actualizado_en)
       VALUES (@clave, @patente, @patente_normalizada, @marca, @modelo, @linea, @anio, @anio_numero, @categoria,
               @catalogo_proveedor, @catalogo_codigo, @motor, @chasis, @tipo, @uso, @color,
               @direccion_riesgo, @titular_nombre, @titular_documento, @integrantes, @cliente_id, @ahora, @ahora)
       RETURNING id`,
    )
    .get({ ...aCrear, ahora }) as { id: number }
  return fila.id
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

/** Los campos de la fila del mes con los nombres que entiende la sincronización. */
function camposDeLaFilaNueva(
  cliente: ClienteCargado,
  vehiculo: VehiculoResuelto,
  datos: DatosValidados,
): Partial<Record<Campo, string>> {
  return {
    nombre: cliente.nombre,
    documento: cliente.documento ?? '',
    telefono: cliente.telefono ?? '',
    sucursal: cliente.sucursal_texto ?? '',
    compania: datos.compania,
    numero_poliza: datos.numero,
    patente: vehiculo.patente,
    marca: vehiculo.marca,
    modelo: vehiculo.modelo,
    anio: vehiculo.anio,
    tipo_vehiculo: vehiculo.tipo,
    // La planilla tiene columna para estos cuatro; en una bicicleta el cuadro viaja en CHASIS. La
    // dirección de una casa o los integrantes de un accidentes personales no tienen columna en la
    // hoja: quedan en la base de esta computadora y se ven en la póliza y en la ficha del cliente.
    motor: vehiculo.motor,
    chasis: vehiculo.chasis,
    uso: vehiculo.uso,
    color: vehiculo.color,
    cobertura: datos.cobertura,
    cuota: datos.cuota,
    dia_vencimiento: datos.diaVencimiento,
    forma_pago: datos.formaPago,
    avisar_vto: datos.avisarVto,
    observaciones: datos.observaciones,
    vigencia_desde: datos.vigenciaDesde,
    vigencia_hasta: datos.vigenciaHasta,
  }
}

export function crearPoliza(datos: DatosDePoliza, actor: SesionUsuario): PolizaDeCliente {
  const validados = validarDatos(datos)
  const cliente = leerCliente(validados.clienteId)
  const vehiculo = resolverVehiculo(datos, cliente, null, true)
  exigirCoberturaDelVehiculo(vehiculo, validados)

  const aviso = avisoDeAntiguedad(vehiculo, validados)
  exigirCobertura(aviso, validados.confirmado, actor)

  // La póliza y su fila del mes comparten el _ID, igual que cuando vienen de la hoja: es una sola fila
  // de la planilla, y así la sincronización puede actualizar las dos mitades con un solo identificador.
  const filaId = generarId()
  const clave = claveDePoliza(validados.compania, validados.numero, cliente.documento, cliente.nombre, vehiculo.patente, filaId)
  const repetida = db().prepare('SELECT id FROM polizas WHERE clave = ?').get(clave) as { id: number } | undefined
  if (repetida) {
    throw new ErrorDeNegocio(
      `Ya hay una póliza cargada con esos datos (${validados.compania} ${validados.numero || vehiculo.patente}). Buscala en el listado en vez de cargarla de nuevo.`,
    )
  }

  const periodo = periodoAbierto() ?? periodoDeHoy()
  const pestana = pestanaDelMes(periodo)
  const anioBase = Number(hoyLocal().slice(0, 4))
  const ahora = ahoraIso()

  let polizaId = 0
  db().transaction(() => {
    const vehiculoId = vehiculo.aCrear ? crearVehiculo(vehiculo.aCrear, ahora) : vehiculo.id
    const insertada = db()
      .prepare(
        `INSERT INTO polizas (clave, fila_id, cliente_id, vehiculo_id, compania, numero, numero_normalizado, cobertura,
                              forma_pago, vigencia_desde, vigencia_hasta, vigencia_desde_iso, vigencia_hasta_iso,
                              propuesta, avisar_vto, observaciones, periodo_origen, pestana_origen, activa,
                              creada_en_la_app, creado_en, actualizado_en)
         VALUES (@clave, @fila_id, @cliente_id, @vehiculo_id, @compania, @numero, @numero_normalizado, @cobertura,
                 @forma_pago, @vigencia_desde, @vigencia_hasta, @vigencia_desde_iso, @vigencia_hasta_iso,
                 @propuesta, @avisar_vto, @observaciones, @periodo_origen, @pestana_origen, 1,
                 1, @ahora, @ahora)
         RETURNING id`,
      )
      .get({
        clave,
        fila_id: filaId,
        cliente_id: cliente.id,
        vehiculo_id: vehiculoId,
        compania: validados.compania,
        numero: validados.numero || null,
        numero_normalizado: normalizarNumeroPoliza(validados.numero) || null,
        cobertura: validados.cobertura || null,
        forma_pago: validados.formaPago || null,
        // El texto de la vigencia se guarda tal cual se escribió; la fecha va aparte, derivada.
        vigencia_desde: validados.vigenciaDesde || null,
        vigencia_hasta: validados.vigenciaHasta || null,
        vigencia_desde_iso: validados.vigenciaDesde ? vigenciaAIso(validados.vigenciaDesde, anioBase) : null,
        vigencia_hasta_iso: validados.vigenciaHasta ? vigenciaAIso(validados.vigenciaHasta, anioBase) : null,
        propuesta: validados.propuesta || null,
        avisar_vto: validados.avisarVto || null,
        observaciones: validados.observaciones || null,
        periodo_origen: periodo,
        pestana_origen: pestana,
        ahora,
      }) as { id: number }
    polizaId = insertada.id

    // Sin su fila en la planilla del mes, la póliza nueva no aparecería en la pantalla que la agencia
    // mira todos los días ni tendría dónde guardar la cuota y el día de vencimiento.
    db()
      .prepare(
        `INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania,
                                 numero_poliza, patente, sucursal_texto, cuota, cuota_monto, dia_vencimiento,
                                 dia_vencimiento_numero, aviso, aviso_enviado, pago, pago_fecha, observaciones,
                                 forma_pago, fecha_envio, avisar_vto, creada_en_la_app, dada_de_baja, creado_en, actualizado_en)
         VALUES (@fila_id, @periodo, @pestana, @poliza_id, @cliente_id, @cliente_nombre, @documento, @compania,
                 @numero_poliza, @patente, @sucursal_texto, @cuota, @cuota_monto, @dia_vencimiento,
                 @dia_vencimiento_numero, NULL, NULL, NULL, NULL, @observaciones,
                 @forma_pago, NULL, @avisar_vto, 1, 0, @ahora, @ahora)`,
      )
      .run({
        fila_id: filaId,
        periodo,
        pestana,
        poliza_id: polizaId,
        cliente_id: cliente.id,
        cliente_nombre: cliente.nombre,
        documento: cliente.documento,
        compania: validados.compania,
        numero_poliza: validados.numero || null,
        patente: vehiculo.patente || null,
        sucursal_texto: cliente.sucursal_texto,
        cuota: validados.cuota || null,
        cuota_monto: interpretarNumero(validados.cuota),
        dia_vencimiento: validados.diaVencimiento || null,
        dia_vencimiento_numero: interpretarDiaDeVencimiento(validados.diaVencimiento),
        observaciones: validados.observaciones || null,
        forma_pago: validados.formaPago || null,
        avisar_vto: validados.avisarVto || null,
        ahora,
      })

    // Se anota como fila conocida antes de encolarla: si no, la bajada la ve como una fila que apareció
    // sola en la hoja y dispara una importación completa cada cinco minutos.
    registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'MENSUAL', periodo })
  })()

  encolar({ operacion: 'crear', pestana, filaId, campos: camposDeLaFilaNueva(cliente, vehiculo, validados) }, actor)

  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'polizas',
    registroId: polizaId,
    filaId,
    campo: 'ALTA DE PÓLIZA',
    valorAnterior: null,
    valorNuevo: `${validados.compania} ${validados.numero || validados.propuesta}${vehiculo.patente ? ` · ${vehiculo.patente}` : ''}`,
  })
  anotarAvisoIgnorado(actor, polizaId, filaId, aviso)

  return verPoliza(polizaId)
}

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------

interface CampoDePoliza {
  /** Cómo se llama el cambio en el historial: los nombres de las columnas de la planilla. */
  etiqueta: string
  /** Columna de `polizas`, o null si el dato sólo vive en la fila del mes. */
  columna: string | null
  /** Columna de `cuotas_mes` que guarda el mismo dato (o una copia que no puede discrepar). */
  columnaEnLaCuota: string | null
  /** Nombre con el que lo conoce la sincronización; null si la planilla no tiene esa columna. */
  enLaHoja: Campo | null
  /** Columnas derivadas que se recalculan al guardar (el monto, la fecha interpretada, el día). */
  derivadas?: (valor: string, anioBase: number) => Record<string, unknown>
}

type CampoDelFormulario =
  | 'compania'
  | 'numero'
  | 'propuesta'
  | 'cobertura'
  | 'formaPago'
  | 'cuota'
  | 'diaVencimiento'
  | 'vigenciaDesde'
  | 'vigenciaHasta'
  | 'avisarVto'
  | 'observaciones'

const CAMPOS: Record<CampoDelFormulario, CampoDePoliza> = {
  compania: { etiqueta: 'COMPAÑÍA', columna: 'compania', columnaEnLaCuota: 'compania', enLaHoja: 'compania' },
  numero: {
    etiqueta: 'POLIZA',
    columna: 'numero',
    columnaEnLaCuota: 'numero_poliza',
    enLaHoja: 'numero_poliza',
    derivadas: (valor) => ({ numero_normalizado: normalizarNumeroPoliza(valor) || null }),
  },
  // La propuesta es un dato interno de la agencia: la planilla no tiene columna para guardarla.
  propuesta: { etiqueta: 'PROPUESTA', columna: 'propuesta', columnaEnLaCuota: null, enLaHoja: null },
  cobertura: { etiqueta: 'COBERTURA', columna: 'cobertura', columnaEnLaCuota: null, enLaHoja: 'cobertura' },
  formaPago: { etiqueta: 'FORMA DE PAGO', columna: 'forma_pago', columnaEnLaCuota: 'forma_pago', enLaHoja: 'forma_pago' },
  cuota: {
    etiqueta: 'CUOTA',
    columna: null,
    columnaEnLaCuota: 'cuota',
    enLaHoja: 'cuota',
    derivadas: (valor) => ({ cuota_monto: interpretarNumero(valor) }),
  },
  diaVencimiento: {
    etiqueta: 'FECHA DE VENC',
    columna: null,
    columnaEnLaCuota: 'dia_vencimiento',
    enLaHoja: 'dia_vencimiento',
    derivadas: (valor) => ({ dia_vencimiento_numero: interpretarDiaDeVencimiento(valor) }),
  },
  vigenciaDesde: {
    etiqueta: 'DESDE',
    columna: 'vigencia_desde',
    columnaEnLaCuota: null,
    enLaHoja: 'vigencia_desde',
    derivadas: (valor, anioBase) => ({ vigencia_desde_iso: valor ? vigenciaAIso(valor, anioBase) : null }),
  },
  vigenciaHasta: {
    etiqueta: 'HASTA',
    columna: 'vigencia_hasta',
    columnaEnLaCuota: null,
    enLaHoja: 'vigencia_hasta',
    derivadas: (valor, anioBase) => ({ vigencia_hasta_iso: valor ? vigenciaAIso(valor, anioBase) : null }),
  },
  avisarVto: { etiqueta: 'AVISAR VTO', columna: 'avisar_vto', columnaEnLaCuota: 'avisar_vto', enLaHoja: 'avisar_vto' },
  observaciones: { etiqueta: 'OBSERVACIONES', columna: 'observaciones', columnaEnLaCuota: 'observaciones', enLaHoja: 'observaciones' },
}

/** Lo que la fila guarda hoy para cada campo del formulario. */
function valorActual(fila: FilaCrudaPoliza, campo: CampoDelFormulario): string {
  switch (campo) {
    case 'compania':
      return limpiar(fila.compania)
    case 'numero':
      return limpiar(fila.numero)
    case 'propuesta':
      return limpiar(fila.propuesta)
    case 'cobertura':
      return limpiar(fila.cobertura)
    case 'formaPago':
      return limpiar(fila.forma_pago)
    case 'cuota':
      return limpiar(fila.cuota)
    case 'diaVencimiento':
      return limpiar(fila.dia_vencimiento)
    case 'vigenciaDesde':
      return limpiar(fila.vigencia_desde)
    case 'vigenciaHasta':
      return limpiar(fila.vigencia_hasta)
    case 'avisarVto':
      return limpiar(fila.avisar_vto)
    case 'observaciones':
      return limpiar(fila.observaciones)
  }
}

function valorNuevo(datos: DatosValidados, campo: CampoDelFormulario): string {
  return datos[campo]
}

export function editarPoliza(polizaId: number, datos: DatosDePoliza, actor: SesionUsuario): PolizaDeCliente {
  const id = enteroPositivo(polizaId, 'La póliza')
  const validados = validarDatos(datos)
  const fila = leerCruda(id)
  if (validados.clienteId !== fila.cliente_id) {
    throw new ErrorDeNegocio('Una póliza no se puede pasar a otro cliente. Dala de baja y cargá una nueva a nombre de quien corresponda.')
  }
  const cliente = leerCliente(fila.cliente_id)
  const vehiculo = resolverVehiculo(datos, cliente, fila.vehiculo_id, false)
  exigirCoberturaDelVehiculo(vehiculo, validados)

  const aviso = avisoDeAntiguedad(vehiculo, validados)
  exigirCobertura(aviso, validados.confirmado, actor)

  const anioBase = Number(hoyLocal().slice(0, 4))
  const enPoliza: Record<string, unknown> = {}
  const enCuota: Record<string, unknown> = {}
  const paraLaHoja: Partial<Record<Campo, string>> = {}
  const cambios: Array<{ etiqueta: string; anterior: string; nuevo: string }> = []

  for (const nombre of Object.keys(CAMPOS) as CampoDelFormulario[]) {
    const campo = CAMPOS[nombre]
    const anterior = valorActual(fila, nombre)
    const nuevo = valorNuevo(validados, nombre)
    if (anterior === nuevo) continue
    // La cuota y el día de vencimiento sólo existen en la fila del mes: si la póliza no está en el mes
    // abierto (está de baja, o es de una planilla vieja) no hay dónde guardarlos, y decirlo es mejor
    // que aceptar el cambio y perderlo.
    if (campo.columna === null && fila.cuota_id === null) {
      throw new ErrorDeNegocio(
        `Esta póliza no tiene fila en la planilla del mes abierto, así que ${campo.etiqueta.toLowerCase()} no se puede cambiar desde acá.`,
      )
    }
    const derivadas = campo.derivadas?.(nuevo, anioBase) ?? {}
    if (campo.columna) Object.assign(enPoliza, { [campo.columna]: nuevo || null }, derivadas)
    if (campo.columnaEnLaCuota && fila.cuota_id !== null) {
      Object.assign(enCuota, { [campo.columnaEnLaCuota]: nuevo || null }, campo.columna ? {} : derivadas)
    }
    if (campo.enLaHoja) paraLaHoja[campo.enLaHoja] = nuevo
    cambios.push({ etiqueta: campo.etiqueta, anterior, nuevo })
  }

  const cambioDeVehiculo = vehiculo.aCrear !== null || vehiculo.id !== fila.vehiculo_id
  if (cambioDeVehiculo) {
    cambios.push({
      etiqueta: esVehiculo(fila.tipo_vehiculo) && esVehiculo(vehiculo.tipo) ? 'VEHICULO' : 'RIESGO',
      anterior: esVehiculo(fila.tipo_vehiculo)
        ? [limpiar(fila.marca), limpiar(fila.modelo), limpiar(fila.patente)].filter(Boolean).join(' ')
        : (describirVehiculo(fila) ?? ''),
      nuevo: esVehiculo(vehiculo.tipo)
        ? [vehiculo.marca, vehiculo.modelo, vehiculo.patente].filter(Boolean).join(' ')
        : vehiculo.descripcion || nombreDeTipoDeRiesgo(vehiculo.tipo),
    })
    Object.assign(paraLaHoja, {
      patente: vehiculo.patente,
      marca: vehiculo.marca,
      modelo: vehiculo.modelo,
      anio: vehiculo.anio,
      tipo_vehiculo: vehiculo.tipo,
      motor: vehiculo.motor,
      chasis: vehiculo.chasis,
      uso: vehiculo.uso,
      color: vehiculo.color,
    })
    if (fila.cuota_id !== null) enCuota.patente = vehiculo.patente || null
  }

  if (cambios.length === 0) return aPoliza(fila, hoyLocal())

  // Si cambió el número de póliza cambia su identidad: se renombra la clave para que el importador la
  // siga reconociendo. Si la clave nueva ya es de otra póliza, algo está mal cargado y hay que mirarlo.
  const claveNueva = claveDePoliza(validados.compania, validados.numero, cliente.documento, cliente.nombre, vehiculo.patente, fila.fila_id ?? `POL${fila.id}`)
  if (claveNueva !== fila.clave) {
    const ocupada = db().prepare('SELECT id FROM polizas WHERE clave = ? AND id <> ?').get(claveNueva, fila.id) as { id: number } | undefined
    if (ocupada) {
      throw new ErrorDeNegocio(`Ya hay otra póliza cargada con el número ${validados.numero} en ${validados.compania}.`)
    }
    enPoliza.clave = claveNueva
  }

  const ahora = ahoraIso()
  db().transaction(() => {
    if (cambioDeVehiculo) enPoliza.vehiculo_id = vehiculo.aCrear ? crearVehiculo(vehiculo.aCrear, ahora) : vehiculo.id
    if (Object.keys(enPoliza).length > 0) {
      const asignaciones = Object.keys(enPoliza).map((columna) => `${columna} = @${columna}`)
      db()
        .prepare(`UPDATE polizas SET ${asignaciones.join(', ')}, actualizado_en = @ahora WHERE id = @id`)
        .run({ ...enPoliza, ahora, id: fila.id })
    }
    if (Object.keys(enCuota).length > 0 && fila.cuota_id !== null) {
      const asignaciones = Object.keys(enCuota).map((columna) => `${columna} = @${columna}`)
      db()
        .prepare(`UPDATE cuotas_mes SET ${asignaciones.join(', ')}, actualizado_en = @ahora WHERE id = @id`)
        .run({ ...enCuota, ahora, id: fila.cuota_id })
    }
  })()

  // A la hoja sólo se sube lo que la planilla del mes tiene columna para guardar, y sólo si la póliza
  // está en el mes abierto: los meses cerrados son el histórico y no se tocan desde acá.
  if (fila.cuota_fila_id && fila.cuota_pestana && Object.keys(paraLaHoja).length > 0) {
    encolar({ operacion: 'actualizar', pestana: fila.cuota_pestana, filaId: fila.cuota_fila_id, campos: paraLaHoja }, actor)
  }

  for (const cambio of cambios) {
    registrarCambio(actor, {
      accion: 'edicion',
      tabla: 'polizas',
      registroId: fila.id,
      filaId: fila.fila_id,
      campo: cambio.etiqueta,
      valorAnterior: cambio.anterior || null,
      valorNuevo: cambio.nuevo || null,
    })
  }
  anotarAvisoIgnorado(actor, fila.id, fila.fila_id, aviso)

  return verPoliza(fila.id)
}

// ---------------------------------------------------------------------------
// Baja
// ---------------------------------------------------------------------------

export function darDeBajaPoliza(polizaId: number, datos: DatosDeBaja, actor: SesionUsuario): null {
  const id = enteroPositivo(polizaId, 'La póliza')
  const d = objeto(datos, 'Los datos de la baja')
  const motivo = typeof d.motivo === 'string' ? d.motivo : ''
  if (!MOTIVOS_DE_BAJA.includes(motivo as MotivoDeBaja)) throw new ErrorDeNegocio('Elegí un motivo de baja de la lista.')
  const nota = opcional(d.nota, 'La nota', 500)
  const fila = leerCruda(id)
  if (fila.activa !== 1) throw new ErrorDeNegocio('Esa póliza ya está dada de baja.')

  // Si está en la planilla del mes abierto manda cartera.ts: ahí ya está resuelto el orden correcto
  // (primero la fila en BAJAS, después sacarla del mes) y no hay que escribirlo dos veces.
  if (fila.cuota_fila_id) return darDeBaja(fila.cuota_fila_id, { motivo: motivo as MotivoDeBaja, nota }, actor)

  // Póliza que no está en el mes abierto (una vieja, o una recién creada en un mes ya cerrado): la baja
  // se hace acá, mínima. No hay fila que sacar de la planilla, sólo el renglón de BAJAS que deja
  // constancia de por qué se fue.
  const periodo = periodoAbierto() ?? periodoDeHoy()
  const bajaFilaId = `BAJA:${fila.fila_id ?? `POL${fila.id}`}`
  const hoy = hoyLocal()
  const ahora = ahoraIso()

  // Los datos del cliente y del vehículo no están en `leerCruda` (el listado no los necesita) pero sí
  // en la foto de la baja: se leen acá, una vez, para que la baja guarde lo mismo que la de la planilla.
  const cliente = db().prepare('SELECT telefono, email, direccion, localidad FROM clientes WHERE id = ?').get(fila.cliente_id) as
    | { telefono: string | null; email: string | null; direccion: string | null; localidad: string | null }
    | undefined
  const vehiculo =
    fila.vehiculo_id === null
      ? undefined
      : (db().prepare('SELECT tipo, marca, modelo, anio, motor, chasis, uso, color FROM vehiculos WHERE id = ?').get(fila.vehiculo_id) as
          | { tipo: string | null; marca: string | null; modelo: string | null; anio: string | null; motor: string | null; chasis: string | null; uso: string | null; color: string | null }
          | undefined)
  const datosDePoliza = db().prepare('SELECT prima, productor, alta FROM polizas WHERE id = ?').get(fila.id) as
    | { prima: string | null; productor: string | null; alta: string | null }
    | undefined

  db().transaction(() => {
    db()
      .prepare(INSERT_BAJA)
      .run({
        fila_id: bajaFilaId,
        pestana: PESTANA_APP,
        periodo,
        mes_texto: periodo,
        poliza_id: fila.id,
        cliente_id: fila.cliente_id,
        cliente_nombre: fila.cliente_nombre,
        documento: fila.documento,
        compania: fila.compania,
        numero_poliza: fila.numero,
        patente: fila.patente,
        sucursal_texto: fila.sucursal,
        motivo,
        fecha_baja: hoy,
        fecha_baja_iso: hoy,
        observaciones: fila.observaciones,
        nota: nota || null,
        cuota_fila_id: null,
        telefono: cliente?.telefono ?? null,
        email: cliente?.email ?? null,
        direccion: cliente?.direccion ?? null,
        localidad: cliente?.localidad ?? null,
        cobertura: fila.cobertura,
        propuesta: fila.propuesta,
        cuota: fila.cuota,
        dia_vencimiento: fila.dia_vencimiento,
        forma_pago: fila.forma_pago,
        prima: datosDePoliza?.prima ?? null,
        productor: datosDePoliza?.productor ?? null,
        vigencia_desde: fila.vigencia_desde,
        vigencia_hasta: fila.vigencia_hasta,
        alta: datosDePoliza?.alta ?? null,
        vehiculo_id: fila.vehiculo_id,
        tipo_vehiculo: vehiculo?.tipo ?? fila.tipo_vehiculo,
        marca: vehiculo?.marca ?? fila.marca,
        modelo: vehiculo?.modelo ?? fila.modelo,
        anio: vehiculo?.anio ?? fila.anio,
        motor: vehiculo?.motor ?? null,
        chasis: vehiculo?.chasis ?? null,
        uso: vehiculo?.uso ?? null,
        color: vehiculo?.color ?? null,
        ahora,
      })
    db().prepare('UPDATE polizas SET activa = 0, actualizado_en = ? WHERE id = ?').run(ahora, fila.id)
  })()

  const pestanaBajas = pestanaDeBajas(periodo)
  registrarFilaDeLaApp({ filaId: bajaFilaId, pestana: pestanaBajas, tipoPestana: 'BAJAS', periodo })
  encolar(
    {
      operacion: 'crear',
      pestana: pestanaBajas,
      filaId: bajaFilaId,
      campos: {
        nombre: fila.cliente_nombre ?? '',
        documento: fila.documento ?? '',
        sucursal: fila.sucursal ?? '',
        compania: fila.compania ?? '',
        numero_poliza: fila.numero ?? '',
        patente: fila.patente ?? '',
        motivo,
        fecha_baja: hoy,
        mes: periodo,
        observaciones: nota || fila.observaciones || '',
      },
    },
    actor,
  )

  registrarCambio(actor, {
    accion: 'baja',
    tabla: 'polizas',
    registroId: fila.id,
    filaId: fila.fila_id,
    campo: 'BAJA',
    valorAnterior: null,
    valorNuevo: `${motivo}${nota ? ` · ${nota}` : ''}`,
  })
  return null
}
