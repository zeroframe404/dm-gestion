// Bandeja de renovaciones: las pólizas que vencen dentro de los próximos DIAS_DE_RENOVACION días,
// agrupadas por semana, con su seguimiento (estado, responsable y nota) y las dos acciones que la
// cierran: «Renovar» —que crea la póliza del año siguiente— y «No renueva» —que la da de baja—.
//
// El seguimiento vive sólo acá: la hoja de Google no tiene columnas para el estado ni el responsable,
// así que nada de eso se encola. Lo que sí viaja a la hoja es el resultado: la fila nueva de la
// planilla del mes cuando se renueva, y la baja cuando no.
import { hoyLocal } from '../../shared/semaforo'
import {
  DIAS_DE_RENOVACION,
  MESES_DE_RENOVACION_POR_DEFECTO,
  aDia,
  desdeDia,
  diasParaVencer,
  lunesDe,
  mesesDeVigencia,
  mesesDespues,
  pideAumentoAlRenovar,
  porcentajeDeAumento,
  tituloDeSemana,
} from '../../shared/polizas'
import {
  ESTADOS_DE_RENOVACION,
  MOTIVOS_DE_BAJA,
  NOMBRE_DESTINO_ANTERIOR,
  NOMBRE_MOTIVO_BAJA,
  esDestinoDeLaAnterior,
  type BandejaRenovaciones,
  type DestinoDeLaAnterior,
  type DatosDeBaja,
  type DatosDeRenovacion,
  type DatosDeSeguimiento,
  type EstadoRenovacion,
  type FilaRenovacion,
  type MotivoDeBaja,
  type SemanaDeRenovaciones,
  type SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import {
  ahoraIso,
  generarId,
  interpretarFecha,
  interpretarNumero,
  limpiar,
  normalizarDocumento,
  normalizarNumeroPoliza,
  normalizarPatente,
  normalizarTexto,
} from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { darDeBaja, nombreDePestanaMensual, periodosDisponibles, pestanaDeBajas } from './cartera'
import { mesesDeRenovacionPorCompania, sincronizarCompanias } from './companias'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio, type AccionHistorial } from './historial'
import { sucursalesDeLasTareas } from './tareas'
import { enteroPositivo, objeto, texto } from './validacion'

const PESTANA_APP = '(cargado en DM Gestión)'

/**
 * Las pólizas que ya vencieron y siguen activas también entran en la bandeja: en la práctica son las
 * que más urge atender, y si se las deja afuera nadie las vuelve a mirar. Se muestran un mes.
 */
const DIAS_VENCIDAS_A_LA_VISTA = 30

/** Toda renovación queda anotada en el historial con esta acción. */
const ACCION_RENOVACION: AccionHistorial = 'renovacion'

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * La cuota del mes abierto se trae por el id más alto en vez de con un JOIN directo: `cuotas_mes` no
 * tiene único por (póliza, período) y una fila duplicada en la hoja multiplicaría la bandeja.
 */
const SELECT_BANDEJA = `
  SELECT
    p.id AS poliza_id, p.fila_id, p.cliente_id, p.compania, p.cobertura, p.numero,
    p.forma_pago, p.vigencia_desde, p.vigencia_hasta, p.vigencia_desde_iso, p.vigencia_hasta_iso,
    p.observaciones AS observaciones_poliza,
    cl.nombre AS cliente_nombre, cl.telefono,
    COALESCE(c.sucursal_texto, cl.sucursal_texto) AS sucursal,
    v.patente, v.marca, v.modelo, v.tipo AS tipo_vehiculo,
    c.cuota, c.observaciones AS observaciones_cuota,
    r.id AS renovacion_id, r.estado, r.responsable_id, r.responsable_nombre, r.nota
  FROM polizas p
  LEFT JOIN clientes cl ON cl.id = p.cliente_id
  LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
  LEFT JOIN (
    SELECT poliza_id, MAX(id) AS id FROM cuotas_mes
    WHERE periodo = @periodo AND dada_de_baja = 0 AND poliza_id IS NOT NULL GROUP BY poliza_id
  ) ultima ON ultima.poliza_id = p.id
  LEFT JOIN cuotas_mes c ON c.id = ultima.id
  LEFT JOIN renovaciones r ON r.poliza_id = p.id AND r.vence_el = p.vigencia_hasta_iso
  WHERE p.activa = 1
    AND p.vigencia_hasta_iso IS NOT NULL
    AND p.vigencia_hasta_iso >= @desde
    AND p.vigencia_hasta_iso <= @hasta
  ORDER BY p.vigencia_hasta_iso, cliente_nombre
`

interface FilaCrudaBandeja {
  renovacion_id: number | null
  poliza_id: number
  fila_id: string | null
  cliente_id: number
  compania: string | null
  cobertura: string | null
  numero: string | null
  forma_pago: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  vigencia_desde_iso: string | null
  vigencia_hasta_iso: string
  observaciones_poliza: string | null
  cliente_nombre: string | null
  telefono: string | null
  sucursal: string | null
  patente: string | null
  marca: string | null
  modelo: string | null
  tipo_vehiculo: string | null
  cuota: string | null
  observaciones_cuota: string | null
  estado: EstadoRenovacion | null
  responsable_id: number | null
  responsable_nombre: string | null
  nota: string | null
}

/**
 * Cómo se llama en la hoja la pestaña mensual de ese período: la que ya tienen las filas de ese mes, o
 * la que le corresponde por el nombre del mes si el período todavía no tiene ninguna.
 */
function pestanaDelPeriodo(periodo: string): string {
  const existente = db().prepare('SELECT pestana FROM cuotas_mes WHERE periodo = ? LIMIT 1').get(periodo) as
    | { pestana: string }
    | undefined
  return existente?.pestana ?? nombreDePestanaMensual(periodo)
}

/** El período abierto: el más nuevo con filas vivas. Puede no haber ninguno si todavía no se importó. */
function periodoAbierto(): string | null {
  return periodosDisponibles()[0]?.periodo ?? null
}

/**
 * En la hoja la observación a veces está en la fila del mes y no en la póliza (se escribe donde se la
 * ve). Para «20% aumentar cuando se renueva» hay que mirar las dos, con la de la póliza adelante.
 */
function observacionesDe(dePoliza: string | null, deCuota: string | null): string | null {
  return limpiar(dePoliza) || limpiar(deCuota) || null
}

/** Cómo se nombra el vehículo en la bandeja: marca y modelo, que es lo que la gente busca con la vista. */
function nombreDeVehiculo(marca: string | null, modelo: string | null, tipo: string | null): string | null {
  const armado = [limpiar(marca), limpiar(modelo)].filter(Boolean).join(' ')
  return armado || limpiar(tipo) || null
}

/**
 * Los plazos con los que trabajan las compañías. La vigencia de la hoja sólo se usa para deducir el
 * plazo si cae justo en uno de estos: ahí hay vigencias a medio cargar (un «desde» que quedó del año
 * pasado, un «hasta» escrito a mano) y de un plazo raro no se puede concluir nada.
 */
const PLAZOS_HABITUALES = [3, 4, 6, 12]

/**
 * Cada cuántos meses se renueva esta póliza. Manda lo cargado en la compañía (Agrosalta 4, Río Uruguay
 * 6, Metropol 12); si no está cargado se lee de la propia vigencia —«igual eso lo dice la fin de
 * vigencia»— y recién en último caso se supone un año.
 */
function mesesDeRenovacionDe(
  compania: string | null,
  desdeIso: string | null,
  hastaIso: string | null,
  porCompania: Record<string, number>,
): number {
  const deLaCompania = porCompania[normalizarTexto(compania)]
  if (deLaCompania !== undefined) return deLaCompania
  const deLaVigencia = mesesDeVigencia(desdeIso, hastaIso)
  return deLaVigencia !== null && PLAZOS_HABITUALES.includes(deLaVigencia) ? deLaVigencia : MESES_DE_RENOVACION_POR_DEFECTO
}

function aFilaRenovacion(cruda: FilaCrudaBandeja, hoy: string, porCompania: Record<string, number>): FilaRenovacion {
  const observaciones = observacionesDe(cruda.observaciones_poliza, cruda.observaciones_cuota)
  const mesesDeLaCompania = porCompania[normalizarTexto(cruda.compania)] ?? null
  return {
    renovacionId: cruda.renovacion_id,
    polizaId: cruda.poliza_id,
    filaId: cruda.fila_id,
    clienteId: cruda.cliente_id,
    clienteNombre: cruda.cliente_nombre,
    telefono: cruda.telefono,
    sucursal: cruda.sucursal,
    compania: cruda.compania,
    cobertura: cruda.cobertura,
    numero: cruda.numero,
    patente: cruda.patente,
    vehiculo: nombreDeVehiculo(cruda.marca, cruda.modelo, cruda.tipo_vehiculo),
    cuota: cruda.cuota,
    vigenciaDesde: cruda.vigencia_desde,
    vigenciaHasta: cruda.vigencia_hasta,
    venceEl: cruda.vigencia_hasta_iso,
    // La fecha viene de la consulta, así que siempre se puede calcular; el 0 es sólo por el tipo.
    diasParaVencer: diasParaVencer(cruda.vigencia_hasta_iso, hoy) ?? 0,
    observaciones,
    aumentaAlRenovar: pideAumentoAlRenovar(observaciones),
    // Sólo las compañías con meses cargados se renuevan a mano; las demás renuevan solas y la bandeja
    // las esconde salvo que se las pida con el filtro.
    renovacionManual: mesesDeLaCompania !== null,
    mesesDeRenovacion: mesesDeLaCompania,
    // Sin fila de seguimiento la póliza está pendiente. No se crea acá: abrir la bandeja no tiene por
    // qué escribir en la base ni ensuciar el historial de nadie.
    estado: cruda.estado ?? 'pendiente',
    responsableId: cruda.responsable_id,
    responsableNombre: cruda.responsable_nombre,
    nota: cruda.nota,
  }
}

function usuariosActivos(): Array<{ id: number; nombre: string }> {
  return db().prepare('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre').all() as Array<{
    id: number
    nombre: string
  }>
}

export function bandejaDeRenovaciones(): BandejaRenovaciones {
  const hoy = hoyLocal()
  const enDias = aDia(hoy) ?? 0
  // Una compañía que apareció recién en la cartera todavía puede no estar en el catálogo, y de ahí sale
  // cada cuánto se renueva: se la da de alta antes de mirar, como hace la planilla del mes.
  sincronizarCompanias()
  const porCompania = mesesDeRenovacionPorCompania()
  const crudas = db()
    .prepare(SELECT_BANDEJA)
    .all({
      periodo: periodoAbierto() ?? '',
      desde: desdeDia(enDias - DIAS_VENCIDAS_A_LA_VISTA),
      hasta: desdeDia(enDias + DIAS_DE_RENOVACION),
    }) as FilaCrudaBandeja[]

  // Las semanas se arman con un Map porque la consulta ya viene ordenada por fecha: así cada semana
  // queda en su orden natural y no hay que ordenar dos veces.
  const porSemana = new Map<string, FilaRenovacion[]>()
  for (const cruda of crudas) {
    const lunes = lunesDe(cruda.vigencia_hasta_iso)
    const filas = porSemana.get(lunes) ?? []
    filas.push(aFilaRenovacion(cruda, hoy, porCompania))
    porSemana.set(lunes, filas)
  }

  const semanas: SemanaDeRenovaciones[] = [...porSemana.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lunes, filas]) => ({
      desde: lunes,
      hasta: desdeDia((aDia(lunes) ?? 0) + 6),
      titulo: tituloDeSemana(lunes, hoy),
      filas,
    }))

  // Las sucursales salen de Tareas y no de las renovaciones que hay a la vista: el botón «Anotar
  // tarea» de cada fila abre el diálogo del módulo Tareas, y tiene que ofrecer lo mismo que ahí.
  return { semanas, total: crudas.length, hoy, responsables: usuariosActivos(), sucursales: sucursalesDeLasTareas() }
}

// ---------------------------------------------------------------------------
// La póliza y su cuota del mes abierto
// ---------------------------------------------------------------------------

interface PolizaCruda {
  id: number
  clave: string
  fila_id: string | null
  cliente_id: number
  vehiculo_id: number | null
  compania: string | null
  numero: string | null
  propuesta: string | null
  cobertura: string | null
  prima: string | null
  prima_monto: number | null
  forma_pago: string | null
  productor: string | null
  estado_texto: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  vigencia_desde_iso: string | null
  vigencia_hasta_iso: string | null
  alta: string | null
  avisar_vto: string | null
  observaciones: string | null
  activa: number
  cliente_nombre: string | null
  documento: string | null
  telefono: string | null
  sucursal: string | null
  patente: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  tipo_vehiculo: string | null
}

const SELECT_POLIZA = `
  SELECT p.*, cl.nombre AS cliente_nombre, cl.documento, cl.telefono, cl.sucursal_texto AS sucursal,
         v.patente, v.marca, v.modelo, v.anio, v.tipo AS tipo_vehiculo
  FROM polizas p
  LEFT JOIN clientes cl ON cl.id = p.cliente_id
  LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
  WHERE p.id = ?
`

function buscarPoliza(polizaId: number): PolizaCruda {
  const poliza = db().prepare(SELECT_POLIZA).get(polizaId) as PolizaCruda | undefined
  if (!poliza) throw new ErrorDeNegocio('No se encontró esa póliza. Actualizá la pantalla y probá de nuevo.')
  return poliza
}

interface CuotaCruda {
  id: number
  fila_id: string
  pestana: string
  periodo: string
  cliente_id: number | null
  cliente_nombre: string | null
  documento: string | null
  compania: string | null
  numero_poliza: string | null
  patente: string | null
  sucursal_texto: string | null
  cuota: string | null
  cuota_monto: number | null
  dia_vencimiento: string | null
  dia_vencimiento_numero: number | null
  forma_pago: string | null
  aviso: string | null
  avisar_vto: string | null
  observaciones: string | null
}

/** La fila del mes abierto de esa póliza, si la tiene. Es de donde salen la cuota y el día de vencimiento. */
function cuotaDelMesAbierto(polizaId: number, periodo: string | null): CuotaCruda | null {
  if (!periodo) return null
  const fila = db()
    .prepare(
      `SELECT id, fila_id, pestana, periodo, cliente_id, cliente_nombre, documento, compania, numero_poliza, patente,
              sucursal_texto, cuota, cuota_monto, dia_vencimiento, dia_vencimiento_numero, forma_pago, aviso,
              avisar_vto, observaciones
       FROM cuotas_mes WHERE poliza_id = ? AND periodo = ? AND dada_de_baja = 0 ORDER BY id DESC LIMIT 1`,
    )
    .get(polizaId, periodo) as CuotaCruda | undefined
  return fila ?? null
}

// ---------------------------------------------------------------------------
// Lo que el diálogo de «Renovar» propone
// ---------------------------------------------------------------------------

/** Separador de miles como en la hoja: 18360 → «18.360». */
function conSeparadores(numero: number): string {
  return String(numero).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/**
 * La cuota que se propone al renovar. Cuando las observaciones piden el aumento («20% aumentar cuando
 * se renueva») se propone ya aumentada: es exactamente para eso que la agencia lo deja escrito ahí, y
 * si no aparece calculada el aumento se olvida. Queda editable en el diálogo, como todo lo demás.
 */
function cuotaSugerida(cuotaActual: string | null, observaciones: string | null): string {
  const actual = limpiar(cuotaActual)
  const porcentaje = porcentajeDeAumento(observaciones)
  const monto = interpretarNumero(actual)
  if (porcentaje === null || monto === null || monto <= 0) return actual
  const aumentada = conSeparadores(Math.round(monto * (1 + porcentaje / 100)))
  return actual.includes('$') ? `$ ${aumentada}` : aumentada
}

export function datosSugeridosDeRenovacion(polizaId: number): DatosDeRenovacion {
  // Igual que la bandeja: si la compañía es nueva en la cartera, primero entra al catálogo, que es de
  // donde sale cada cuánto renueva.
  sincronizarCompanias()
  const poliza = buscarPoliza(enteroPositivo(polizaId, 'La póliza'))
  const cuota = cuotaDelMesAbierto(poliza.id, periodoAbierto())
  const observaciones = observacionesDe(poliza.observaciones, cuota?.observaciones ?? null)

  // La vigencia nueva arranca donde termina la vieja. Si la póliza no tiene la fecha cargada (en la
  // hoja hay vigencias que son «A/D» o están vacías) se propone desde hoy: es un supuesto razonable y
  // el diálogo lo deja cambiar, que es mejor que abrirlo en blanco.
  const desde = poliza.vigencia_hasta_iso ?? hoyLocal()
  // Cuánto dura la vigencia nueva: los meses de la compañía (Agrosalta 4, Río Uruguay 6, Metropol 12),
  // o los que duraba la vigencia que está terminando.
  const meses = mesesDeRenovacionDe(poliza.compania, poliza.vigencia_desde_iso, poliza.vigencia_hasta_iso, mesesDeRenovacionPorCompania())

  return {
    vigenciaDesde: desde,
    vigenciaHasta: mesesDespues(desde, meses),
    cuota: cuotaSugerida(cuota?.cuota ?? null, observaciones),
    // El número viene con el de la póliza que termina y NO en blanco a propósito: hay compañías que
    // renuevan conservando el número y ahí no hay nada que tipear. Cuando la compañía da uno nuevo se
    // pisa, que es el caso que la agencia pidió resolver con el cartel de acá abajo.
    numero: limpiar(poliza.numero),
    propuesta: limpiar(poliza.propuesta),
    observaciones: limpiar(observaciones),
    // Lo que viene elegido en el cartel: renovar sin darle vueltas es lo que pasa casi siempre.
    destinoDeLaAnterior: 'renovada',
    motivoDeBaja: 'CAMBIO DE COMPANIA',
    notaDeBaja: '',
  }
}

// ---------------------------------------------------------------------------
// Seguimiento (estado, responsable y nota)
// ---------------------------------------------------------------------------

interface SeguimientoCrudo {
  id: number
  estado: EstadoRenovacion
  responsable_id: number | null
  responsable_nombre: string | null
  nota: string | null
  poliza_nueva_id: number | null
}

function seguimientoActual(polizaId: number, venceEl: string): SeguimientoCrudo | null {
  const fila = db()
    .prepare('SELECT id, estado, responsable_id, responsable_nombre, nota, poliza_nueva_id FROM renovaciones WHERE poliza_id = ? AND vence_el = ?')
    .get(polizaId, venceEl) as SeguimientoCrudo | undefined
  return fila ?? null
}

interface SeguimientoAGuardar {
  polizaId: number
  venceEl: string
  estado: EstadoRenovacion
  responsableId: number | null
  responsableNombre: string | null
  nota: string | null
  polizaNuevaId?: number | null
}

/**
 * Crea o actualiza la fila de seguimiento. `poliza_nueva_id` se conserva si el llamado no trae uno:
 * marcar el estado a mano después de renovar no tiene que borrar el enganche con la póliza nueva.
 */
function guardarSeguimiento(entrada: SeguimientoAGuardar, actor: SesionUsuario): number {
  const ahora = ahoraIso()
  const fila = db()
    .prepare(
      `INSERT INTO renovaciones (poliza_id, vence_el, estado, responsable_id, responsable_nombre, nota,
                                 poliza_nueva_id, actualizado_por, creado_en, actualizado_en)
       VALUES (@poliza_id, @vence_el, @estado, @responsable_id, @responsable_nombre, @nota,
               @poliza_nueva_id, @actualizado_por, @ahora, @ahora)
       ON CONFLICT(poliza_id, vence_el) DO UPDATE SET
         estado = excluded.estado,
         responsable_id = excluded.responsable_id,
         responsable_nombre = excluded.responsable_nombre,
         nota = excluded.nota,
         poliza_nueva_id = COALESCE(excluded.poliza_nueva_id, renovaciones.poliza_nueva_id),
         actualizado_por = excluded.actualizado_por,
         actualizado_en = excluded.actualizado_en
       RETURNING id`,
    )
    .get({
      poliza_id: entrada.polizaId,
      vence_el: entrada.venceEl,
      estado: entrada.estado,
      responsable_id: entrada.responsableId,
      responsable_nombre: entrada.responsableNombre,
      nota: entrada.nota,
      poliza_nueva_id: entrada.polizaNuevaId ?? null,
      actualizado_por: actor.nombre,
      ahora,
    }) as { id: number }
  return fila.id
}

/** El responsable se resuelve contra la base: el renderer manda un id, el nombre lo pone la aplicación. */
function resolverResponsable(valor: unknown): { id: number | null; nombre: string | null } {
  if (valor === null || valor === undefined) return { id: null, nombre: null }
  const id = enteroPositivo(valor, 'El responsable')
  const usuario = db().prepare('SELECT id, nombre FROM usuarios WHERE id = ? AND activo = 1').get(id) as
    | { id: number; nombre: string }
    | undefined
  if (!usuario) throw new ErrorDeNegocio('Ese responsable no existe o está dado de baja.')
  return { id: usuario.id, nombre: usuario.nombre }
}

function fechaIso(valor: unknown, campo: string): string {
  const crudo = texto(valor, campo, 1, 40)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(crudo)) throw new ErrorDeNegocio(`${campo} no es una fecha válida.`)
  return crudo
}

function estadoValido(valor: unknown): EstadoRenovacion {
  if (typeof valor !== 'string' || !(ESTADOS_DE_RENOVACION as readonly string[]).includes(valor)) {
    throw new ErrorDeNegocio('Elegí un estado de la lista.')
  }
  return valor as EstadoRenovacion
}

export function actualizarSeguimiento(
  polizaId: number,
  venceEl: string,
  datos: DatosDeSeguimiento,
  actor: SesionUsuario,
): BandejaRenovaciones {
  const poliza = buscarPoliza(enteroPositivo(polizaId, 'La póliza'))
  const fecha = fechaIso(venceEl, 'El vencimiento')
  const entrada = objeto(datos, 'El seguimiento')
  const estado = estadoValido(entrada.estado)
  const responsable = resolverResponsable(entrada.responsableId)
  const nota = texto(entrada.nota ?? '', 'La nota', 0, 1000)

  const anterior = seguimientoActual(poliza.id, fecha)
  const id = guardarSeguimiento(
    { polizaId: poliza.id, venceEl: fecha, estado, responsableId: responsable.id, responsableNombre: responsable.nombre, nota: nota || null },
    actor,
  )

  // No se encola: en la hoja no hay columnas para el estado ni el responsable. Sí queda en el
  // historial, que es lo que después contesta «quién dijo que esto lo llamaba fulano».
  registrarCambio(actor, {
    accion: ACCION_RENOVACION,
    tabla: 'renovaciones',
    registroId: id,
    filaId: poliza.fila_id,
    campo: 'SEGUIMIENTO',
    valorAnterior: descripcionDeSeguimiento(anterior?.estado ?? 'pendiente', anterior?.responsable_nombre ?? null, anterior?.nota ?? null),
    valorNuevo: descripcionDeSeguimiento(estado, responsable.nombre, nota || null),
  })
  return bandejaDeRenovaciones()
}

function descripcionDeSeguimiento(estado: EstadoRenovacion, responsable: string | null, nota: string | null): string {
  return [estado, responsable, nota].filter(Boolean).join(' · ')
}

// ---------------------------------------------------------------------------
// Renovar
// ---------------------------------------------------------------------------

/** '2027-04-27' → '27/4/2027', que es como están escritas las vigencias en la hoja. */
function comoTextoDeLaHoja(iso: string): string {
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`
}

/**
 * Interpreta una vigencia escrita en el diálogo. Se aceptan 'AAAA-MM-DD' y el día/mes/año de siempre.
 * La ventana de años se corre dos: al renovar en diciembre una póliza que vence en enero, la vigencia
 * nueva termina dos años calendario más adelante y no por eso es un error de tipeo.
 */
function vigenciaIso(valor: unknown, campo: string): string {
  const crudo = texto(valor, campo, 1, 40)
  const anioActual = new Date().getFullYear()
  const { iso } = interpretarFecha(crudo, anioActual, anioActual + 2)
  if (!iso) throw new ErrorDeNegocio(`«${crudo}» no es una fecha válida en ${campo}. Escribila como día/mes/año.`)
  return iso
}

/**
 * La clave de la póliza nueva, con la convención del importador (POL: / DOCPAT: / NOMPAT: / FILA:).
 *
 * Cuando la renovación conserva el número de póliza —que es lo habitual— la clave calculada es la que
 * ya tiene la póliza vieja, y la columna es única. En ese caso la clave canónica se la queda la NUEVA,
 * que es la que está vigente y la que la hoja va a volver a traer en la próxima importación, y la
 * vieja pasa a una clave histórica. Al revés (dejar la canónica en la vieja) la importación siguiente
 * volvería a enganchar la fila de la hoja con la póliza vieja y la renovación quedaría deshecha.
 */
function clavesDeLaRenovacion(
  anterior: PolizaCruda,
  numeroNuevo: string,
  filaIdNuevo: string | null,
): { clave: string; claveHistoricaDeLaAnterior: string | null } {
  const numeroNormalizado = normalizarNumeroPoliza(numeroNuevo)
  const documento = normalizarDocumento(anterior.documento)
  const patente = normalizarPatente(anterior.patente)
  const nombre = normalizarTexto(anterior.cliente_nombre)
  const respaldo = filaIdNuevo ? `FILA:${filaIdNuevo}` : `RENOV:${anterior.id}|${ahoraIso()}`

  let clave: string
  if (numeroNormalizado.length >= 3 && /\d/.test(numeroNormalizado)) clave = `POL:${normalizarTexto(anterior.compania)}|${numeroNormalizado}`
  else if (documento.length >= 6 && documento.length <= 11 && patente) clave = `DOCPAT:${documento}|${patente}`
  else if (nombre && patente) clave = `NOMPAT:${nombre}|${patente}`
  else clave = respaldo

  const ocupada = db().prepare('SELECT id FROM polizas WHERE clave = ?').get(clave) as { id: number } | undefined
  if (!ocupada) return { clave, claveHistoricaDeLaAnterior: null }
  if (ocupada.id === anterior.id) return { clave, claveHistoricaDeLaAnterior: `ANTERIOR:${anterior.id}|${anterior.clave}`.slice(0, 300) }
  // La clave es de OTRA póliza (dos filas de la hoja con el mismo número): no se la saca a nadie.
  return { clave: respaldo, claveHistoricaDeLaAnterior: null }
}

/** Los campos de la fila nueva de la planilla, con los nombres que entiende la sincronización. */
function camposParaLaHoja(
  anterior: PolizaCruda,
  cuotaVieja: CuotaCruda | null,
  datos: { numero: string; cuota: string; observaciones: string; desdeTexto: string; hastaTexto: string; formaPago: string },
): Record<string, string> {
  return {
    nombre: anterior.cliente_nombre ?? '',
    documento: anterior.documento ?? '',
    telefono: anterior.telefono ?? '',
    sucursal: cuotaVieja?.sucursal_texto ?? anterior.sucursal ?? '',
    compania: anterior.compania ?? '',
    numero_poliza: datos.numero,
    patente: anterior.patente ?? '',
    marca: anterior.marca ?? '',
    modelo: anterior.modelo ?? '',
    anio: anterior.anio ?? '',
    tipo_vehiculo: anterior.tipo_vehiculo ?? '',
    cobertura: anterior.cobertura ?? '',
    cuota: datos.cuota,
    dia_vencimiento: cuotaVieja?.dia_vencimiento ?? '',
    forma_pago: datos.formaPago,
    // El aviso y el pago arrancan en blanco: la cuota del mes de la póliza nueva todavía no se avisó.
    aviso: '',
    observaciones: datos.observaciones,
    vigencia_desde: datos.desdeTexto,
    vigencia_hasta: datos.hastaTexto,
  }
}

/**
 * Qué se hace con la póliza vieja, leído de lo que mandó la pantalla.
 *
 * Sin destino se asume `renovada`, que es exactamente lo que hacía la 12.4: una computadora sin
 * actualizar sigue renovando como siempre en vez de que se le rechace el llamado.
 */
/** El motivo de baja tal como llega de la pantalla, o el error de siempre si no es uno de la lista. */
function motivoElegido(crudo: unknown): MotivoDeBaja {
  const motivo = crudo as MotivoDeBaja
  if (!MOTIVOS_DE_BAJA.includes(motivo)) throw new ErrorDeNegocio('Elegí un motivo de baja de la lista.')
  return motivo
}

function destinoDeLaAnterior(entrada: Record<string, unknown>): DestinoDeLaAnterior {
  const pedido = entrada.destinoDeLaAnterior
  if (pedido === undefined || pedido === null || pedido === '') return 'renovada'
  if (!esDestinoDeLaAnterior(pedido)) {
    throw new ErrorDeNegocio('Elegí qué pasa con la póliza anterior: dejarla en Renovadas, mandarla a Bajas o dejarla Activa.')
  }
  return pedido
}

export function renovar(polizaId: number, datos: DatosDeRenovacion, actor: SesionUsuario): BandejaRenovaciones {
  const anterior = buscarPoliza(enteroPositivo(polizaId, 'La póliza'))
  if (anterior.activa !== 1) throw new ErrorDeNegocio('Esa póliza ya no está en la cartera: no se puede renovar.')

  const entrada = objeto(datos, 'Los datos de la renovación')
  const destino = destinoDeLaAnterior(entrada)
  // El motivo se exige sólo cuando hace falta: pedirlo siempre obligaría a elegir uno para tirarlo.
  const motivoDeBaja = destino === 'baja' ? motivoElegido(entrada.motivoDeBaja) : null
  const notaDeBaja = destino === 'baja' ? texto(entrada.notaDeBaja ?? '', 'La nota de la baja', 0, 1000) : ''
  const desdeIso = vigenciaIso(entrada.vigenciaDesde, 'la vigencia desde')
  const hastaIso = vigenciaIso(entrada.vigenciaHasta, 'la vigencia hasta')
  if (hastaIso <= desdeIso) throw new ErrorDeNegocio('La vigencia nueva tiene que terminar después de empezar.')
  const numero = texto(entrada.numero ?? '', 'El número de póliza', 0, 60)
  const propuesta = texto(entrada.propuesta ?? '', 'El número de propuesta', 0, 60)
  const cuota = texto(entrada.cuota ?? '', 'La cuota', 0, 60)
  const observaciones = texto(entrada.observaciones ?? '', 'Las observaciones', 0, 1000)

  // Renovar dos veces la misma póliza crearía dos pólizas nuevas iguales y dejaría la cartera inflada.
  const yaRenovada = db().prepare('SELECT id FROM polizas WHERE poliza_anterior_id = ?').get(anterior.id) as { id: number } | undefined
  if (yaRenovada) throw new ErrorDeNegocio('Esa póliza ya fue renovada. Actualizá la pantalla para ver la póliza nueva.')

  const periodo = periodoAbierto()
  const cuotaVieja = cuotaDelMesAbierto(anterior.id, periodo)
  // La fila del mes es la que existe en la hoja: sin planilla abierta la renovación es sólo local y no
  // hay nada que subir (ni fila nueva ni fila para borrar).
  const filaIdNuevo = periodo ? generarId() : null
  // La pestaña tiene que ser la REAL de la hoja, no la que le correspondería por el mes: la agencia las
  // titula «AGOSTO» pero también «DICIEMBRE25». Si acá se inventa el nombre, el alta de la fila nueva
  // queda fallida (esa pestaña no existe) mientras que el borrado de la vieja —que sí usa el nombre
  // real— se ejecuta igual, y la póliza desaparece de la hoja.
  const pestanaDelMes = periodo ? (cuotaVieja?.pestana ?? pestanaDelPeriodo(periodo)) : null
  const { clave, claveHistoricaDeLaAnterior } = clavesDeLaRenovacion(anterior, numero, filaIdNuevo)

  const desdeTexto = comoTextoDeLaHoja(desdeIso)
  const hastaTexto = comoTextoDeLaHoja(hastaIso)
  const formaPago = limpiar(cuotaVieja?.forma_pago ?? anterior.forma_pago)
  const ahora = ahoraIso()

  const nuevaId = db().transaction(() => {
    // PRIMERO se libera la clave de la anterior. Renovar conservando el número de póliza es el caso
    // normal, y entonces la clave que le toca a la nueva («POL:cía|número») es exactamente la que
    // todavía ocupa la vieja: insertar antes de renombrar reventaría contra el índice único de
    // `polizas.clave` con un error crudo. La anterior conserva su número; lo que cambia es la clave
    // interna, que pasa a ser histórica.
    if (claveHistoricaDeLaAnterior) {
      db().prepare('UPDATE polizas SET clave = ?, actualizado_en = ? WHERE id = ?').run(claveHistoricaDeLaAnterior, ahora, anterior.id)
    }

    // La póliza nueva hereda cliente, vehículo, compañía, cobertura y forma de pago: lo que cambia en
    // una renovación son las vigencias, el número y la cuota.
    const nueva = db()
      .prepare(
        `INSERT INTO polizas (clave, fila_id, cliente_id, vehiculo_id, compania, numero, numero_normalizado, propuesta, cobertura,
                              prima, prima_monto, forma_pago, productor, estado_texto, vigencia_desde, vigencia_hasta,
                              vigencia_desde_iso, vigencia_hasta_iso, alta, avisar_vto, observaciones, periodo_origen,
                              pestana_origen, poliza_anterior_id, creada_en_la_app, activa, creado_en, actualizado_en)
         VALUES (@clave, @fila_id, @cliente_id, @vehiculo_id, @compania, @numero, @numero_normalizado, @propuesta, @cobertura,
                 @prima, @prima_monto, @forma_pago, @productor, @estado_texto, @vigencia_desde, @vigencia_hasta,
                 @vigencia_desde_iso, @vigencia_hasta_iso, @alta, @avisar_vto, @observaciones, @periodo_origen,
                 @pestana_origen, @poliza_anterior_id, 1, 1, @ahora, @ahora)
         RETURNING id`,
      )
      .get({
        clave,
        fila_id: filaIdNuevo,
        cliente_id: anterior.cliente_id,
        vehiculo_id: anterior.vehiculo_id,
        compania: anterior.compania,
        numero: numero || null,
        numero_normalizado: normalizarNumeroPoliza(numero) || null,
        propuesta: propuesta || null,
        cobertura: anterior.cobertura,
        prima: anterior.prima,
        prima_monto: anterior.prima_monto,
        forma_pago: formaPago || null,
        productor: anterior.productor,
        estado_texto: anterior.estado_texto,
        vigencia_desde: desdeTexto,
        vigencia_hasta: hastaTexto,
        vigencia_desde_iso: desdeIso,
        vigencia_hasta_iso: hastaIso,
        // El alta es la fecha en que el cliente entró: una renovación no la cambia.
        alta: anterior.alta,
        avisar_vto: anterior.avisar_vto,
        observaciones: observaciones || null,
        periodo_origen: periodo ?? anterior.vigencia_hasta_iso ?? desdeIso.slice(0, 7),
        pestana_origen: pestanaDelMes ?? PESTANA_APP,
        poliza_anterior_id: anterior.id,
        ahora,
      }) as { id: number }

    // Qué pasa con la anterior lo eligió quien renovó (ver `DESTINOS_DE_LA_ANTERIOR` en tipos.ts). Sea
    // cual sea, queda enganchada a la nueva por `poliza_anterior_id`, y la clave ya se liberó más
    // arriba, antes de insertar la nueva.
    //
    //   · renovada — sale de la cartera. No se le inventa una baja con motivo, porque no se dio de
    //     baja: se renovó, y en BAJAS no tiene nada que hacer.
    //   · baja     — sale de la cartera y además entra a BAJAS. Lo escribe `bajaSinFilaDelMes`, que es
    //     el mismo camino que usa «No renueva» cuando la póliza no tiene fila en el mes abierto: acá
    //     tampoco la tiene, porque la de abajo se dio de baja al crear la fila nueva.
    //   · activa   — no se toca: quedan las dos vigentes.
    if (destino !== 'activa') {
      db().prepare('UPDATE polizas SET activa = 0, actualizado_en = ? WHERE id = ?').run(ahora, anterior.id)
    }

    // La baja va ANTES de tocar la fila del mes, y adentro de la misma transacción.
    //
    // El orden importa por la HOJA y es el mismo que declara `darDeBaja` en cartera.ts: primero se
    // agrega a BAJAS y recién después se saca de la planilla del mes. La cola se aplica por orden de
    // id, así que encolar al revés dejaría, ante una falla en el medio, la póliza sacada del mes y sin
    // entrar a BAJAS: perdida en los dos lados. Al revés queda repetida un rato, que se arregla solo.
    //
    // `bajaSinFilaDelMes` es el mismo camino que usa «No renueva» cuando la póliza no tiene fila en el
    // mes abierto —acá tampoco la va a tener— y abre su propia transacción, que en better-sqlite3
    // anida con un SAVEPOINT y no rompe ésta.
    if (destino === 'baja' && motivoDeBaja) {
      bajaSinFilaDelMes(anterior, motivoDeBaja, notaDeBaja || `Renovada por la póliza ${numero || 'nueva'}.`, periodo, actor)
    }

    if (periodo && filaIdNuevo && pestanaDelMes) {
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
          fila_id: filaIdNuevo,
          periodo,
          pestana: pestanaDelMes,
          poliza_id: nueva.id,
          cliente_id: anterior.cliente_id,
          cliente_nombre: anterior.cliente_nombre,
          documento: anterior.documento,
          compania: anterior.compania,
          numero_poliza: numero || null,
          patente: anterior.patente,
          sucursal_texto: cuotaVieja?.sucursal_texto ?? anterior.sucursal,
          cuota: cuota || null,
          cuota_monto: interpretarNumero(cuota),
          dia_vencimiento: cuotaVieja?.dia_vencimiento ?? null,
          dia_vencimiento_numero: cuotaVieja?.dia_vencimiento_numero ?? null,
          observaciones: observaciones || null,
          forma_pago: formaPago || null,
          avisar_vto: cuotaVieja?.avisar_vto ?? anterior.avisar_vto,
          ahora,
        })

      // La fila vieja sale de la planilla: si quedaran las dos, el mes tendría la póliza duplicada.
      // Con la anterior ACTIVA es al revés: se la deja, porque las dos pólizas están vigentes y las dos
      // tienen que cobrarse. Ahí el mes muestra dos filas a propósito, no una duplicada.
      if (cuotaVieja && destino !== 'activa') {
        db().prepare('UPDATE cuotas_mes SET dada_de_baja = 1, actualizado_en = ? WHERE id = ?').run(ahora, cuotaVieja.id)
      }

      // Se anota como fila conocida ANTES de encolarla: si no, la bajada la ve como una fila que llegó
      // de otra computadora y dispara una importación completa cada cinco minutos.
      registrarFilaDeLaApp({ filaId: filaIdNuevo, pestana: pestanaDelMes, tipoPestana: 'MENSUAL', periodo })
      encolar(
        {
          operacion: 'crear',
          pestana: pestanaDelMes,
          filaId: filaIdNuevo,
          campos: camposParaLaHoja(anterior, cuotaVieja, { numero, cuota, observaciones, desdeTexto, hastaTexto, formaPago }),
        },
        actor,
      )
      if (cuotaVieja && destino !== 'activa') {
        encolar({ operacion: 'borrar', pestana: cuotaVieja.pestana, filaId: cuotaVieja.fila_id, campos: {} }, actor)
      }
    }

    // El seguimiento de la ANTERIOR queda cerrado y apuntando a la nueva: así la bandeja de la semana
    // que viene no la vuelve a pedir y desde el historial se llega a la póliza que la reemplazó.
    //
    // Con la anterior ACTIVA esto es lo único que la saca de la bandeja: la póliza sigue vigente y
    // vencida, así que sin el seguimiento cerrado volvería a pedir que la renueven todos los días.
    // Queda en la bandeja marcada «Renovada», que es lo que pasó.
    const venceEl = anterior.vigencia_hasta_iso ?? desdeIso
    const seguimiento = seguimientoActual(anterior.id, venceEl)
    guardarSeguimiento(
      {
        polizaId: anterior.id,
        venceEl,
        // El destino `baja` es una renovación en la que además la compañía anuló la vieja: el
        // seguimiento dice «no renueva» para que la bandeja lo lea como lo que la agencia ve en BAJAS.
        estado: destino === 'baja' ? 'no renueva' : 'renovada',
        responsableId: seguimiento?.responsable_id ?? null,
        responsableNombre: seguimiento?.responsable_nombre ?? null,
        nota: seguimiento?.nota ?? null,
        polizaNuevaId: nueva.id,
      },
      actor,
    )
    return nueva.id
  })()

  registrarCambio(actor, {
    accion: ACCION_RENOVACION,
    tabla: 'polizas',
    registroId: nuevaId,
    filaId: filaIdNuevo,
    campo: 'RENOVACIÓN',
    valorAnterior: `${limpiar(anterior.numero) || 'sin número'} · ${limpiar(anterior.vigencia_desde) || '?'} a ${limpiar(anterior.vigencia_hasta) || '?'}`,
    // Adónde fue a parar la anterior va en el historial y no sólo en la pantalla: dentro de un mes, la
    // pregunta va a ser por qué esa póliza quedó vigente (o en BAJAS) y la respuesta tiene que estar.
    valorNuevo: `${numero || 'sin número'} · ${desdeTexto} a ${hastaTexto} · la anterior queda en ${NOMBRE_DESTINO_ANTERIOR[destino]}`,
  })
  return bandejaDeRenovaciones()
}

// ---------------------------------------------------------------------------
// No renueva
// ---------------------------------------------------------------------------

/**
 * La baja de una póliza que ya no tiene fila en la planilla del mes (se cerró el mes sin ella, o la
 * póliza venció hace rato). Se anota igual en BAJAS, que es donde la agencia lleva la cuenta, pero no
 * hay ninguna fila mensual que sacar de la hoja.
 */
function bajaSinFilaDelMes(poliza: PolizaCruda, motivo: MotivoDeBaja, nota: string, periodo: string | null, actor: SesionUsuario): void {
  const hoy = hoyLocal()
  const ahora = ahoraIso()
  const filaId = `BAJA:POL${poliza.id}`

  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO bajas (fila_id, pestana, periodo, mes_texto, poliza_id, cliente_id, cliente_nombre, documento, compania,
                            numero_poliza, patente, sucursal_texto, motivo, fecha_baja, fecha_baja_iso, observaciones,
                            nota, hecha_en_la_app, cuota_fila_id, creado_en, actualizado_en)
         VALUES (@fila_id, @pestana, @periodo, @mes_texto, @poliza_id, @cliente_id, @cliente_nombre, @documento, @compania,
                 @numero_poliza, @patente, @sucursal_texto, @motivo, @fecha_baja, @fecha_baja_iso, @observaciones,
                 @nota, 1, NULL, @ahora, @ahora)
         ON CONFLICT(fila_id) DO UPDATE SET
           motivo = excluded.motivo, nota = excluded.nota, fecha_baja = excluded.fecha_baja,
           fecha_baja_iso = excluded.fecha_baja_iso, actualizado_en = excluded.actualizado_en`,
      )
      .run({
        fila_id: filaId,
        pestana: PESTANA_APP,
        periodo,
        mes_texto: periodo,
        poliza_id: poliza.id,
        cliente_id: poliza.cliente_id,
        cliente_nombre: poliza.cliente_nombre,
        documento: poliza.documento,
        compania: poliza.compania,
        numero_poliza: poliza.numero,
        patente: poliza.patente,
        sucursal_texto: poliza.sucursal,
        motivo,
        fecha_baja: hoy,
        fecha_baja_iso: hoy,
        observaciones: poliza.observaciones,
        nota: nota || null,
        ahora,
      })
    db().prepare('UPDATE polizas SET activa = 0, actualizado_en = ? WHERE id = ?').run(ahora, poliza.id)

    const pestanaBajas = pestanaDeBajas(periodo)
    registrarFilaDeLaApp({ filaId, pestana: pestanaBajas, tipoPestana: 'BAJAS', periodo })
    encolar(
      {
        operacion: 'crear',
        pestana: pestanaBajas,
        filaId,
        campos: {
          nombre: poliza.cliente_nombre ?? '',
          documento: poliza.documento ?? '',
          telefono: poliza.telefono ?? '',
          sucursal: poliza.sucursal ?? '',
          compania: poliza.compania ?? '',
          numero_poliza: poliza.numero ?? '',
          patente: poliza.patente ?? '',
          cobertura: poliza.cobertura ?? '',
          vigencia_desde: poliza.vigencia_desde ?? '',
          vigencia_hasta: poliza.vigencia_hasta ?? '',
          motivo,
          fecha_baja: hoy,
          mes: periodo ?? '',
          observaciones: nota || poliza.observaciones || '',
        },
      },
      actor,
    )
  })()

  registrarCambio(actor, {
    accion: 'baja',
    tabla: 'polizas',
    registroId: poliza.id,
    filaId,
    campo: 'BAJA',
    valorAnterior: null,
    valorNuevo: `${motivo}${nota ? ` · ${nota}` : ''}`,
  })
}

export function noRenueva(polizaId: number, datos: DatosDeBaja, actor: SesionUsuario): BandejaRenovaciones {
  const poliza = buscarPoliza(enteroPositivo(polizaId, 'La póliza'))
  if (poliza.activa !== 1) throw new ErrorDeNegocio('Esa póliza ya no está en la cartera.')

  const entrada = objeto(datos, 'Los datos de la baja')
  const motivo = motivoElegido(entrada.motivo)
  const nota = texto(entrada.nota ?? '', 'La nota', 0, 1000)

  const periodo = periodoAbierto()
  const cuota = cuotaDelMesAbierto(poliza.id, periodo)
  // Con fila en el mes abierto manda cartera.ts: ahí ya está resuelto todo lo de la pestaña BAJAS
  // (el orden de las dos operaciones en la hoja, la fila que se puede deshacer, el historial).
  if (cuota) darDeBaja(cuota.fila_id, { motivo, nota }, actor)
  else bajaSinFilaDelMes(poliza, motivo, nota, periodo, actor)

  const venceEl = poliza.vigencia_hasta_iso ?? hoyLocal()
  const seguimiento = seguimientoActual(poliza.id, venceEl)
  guardarSeguimiento(
    {
      polizaId: poliza.id,
      venceEl,
      estado: 'no renueva',
      responsableId: seguimiento?.responsable_id ?? null,
      responsableNombre: seguimiento?.responsable_nombre ?? null,
      // El motivo va en la nota del seguimiento para que se lea sin salir de la bandeja.
      nota: [NOMBRE_MOTIVO_BAJA[motivo], nota].filter(Boolean).join(' · '),
    },
    actor,
  )
  return bandejaDeRenovaciones()
}
