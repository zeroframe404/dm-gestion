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
  aDia,
  desdeDia,
  diasParaVencer,
  lunesDe,
  pideAumentoAlRenovar,
  porcentajeDeAumento,
  tituloDeSemana,
  unAnioDespues,
} from '../../shared/polizas'
import {
  ESTADOS_DE_RENOVACION,
  MOTIVOS_DE_BAJA,
  NOMBRE_MOTIVO_BAJA,
  type BandejaRenovaciones,
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
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio, type AccionHistorial } from './historial'
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
    p.forma_pago, p.vigencia_desde, p.vigencia_hasta, p.vigencia_hasta_iso,
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

function aFilaRenovacion(cruda: FilaCrudaBandeja, hoy: string): FilaRenovacion {
  const observaciones = observacionesDe(cruda.observaciones_poliza, cruda.observaciones_cuota)
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
    filas.push(aFilaRenovacion(cruda, hoy))
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

  return { semanas, total: crudas.length, hoy, responsables: usuariosActivos() }
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
  const poliza = buscarPoliza(enteroPositivo(polizaId, 'La póliza'))
  const cuota = cuotaDelMesAbierto(poliza.id, periodoAbierto())
  const observaciones = observacionesDe(poliza.observaciones, cuota?.observaciones ?? null)

  // La vigencia nueva arranca donde termina la vieja. Si la póliza no tiene la fecha cargada (en la
  // hoja hay vigencias que son «A/D» o están vacías) se propone desde hoy: es un supuesto razonable y
  // el diálogo lo deja cambiar, que es mejor que abrirlo en blanco.
  const desde = poliza.vigencia_hasta_iso ?? hoyLocal()

  return {
    vigenciaDesde: desde,
    vigenciaHasta: unAnioDespues(desde),
    cuota: cuotaSugerida(cuota?.cuota ?? null, observaciones),
    numero: limpiar(poliza.numero),
    observaciones: limpiar(observaciones),
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

export function renovar(polizaId: number, datos: DatosDeRenovacion, actor: SesionUsuario): BandejaRenovaciones {
  const anterior = buscarPoliza(enteroPositivo(polizaId, 'La póliza'))
  if (anterior.activa !== 1) throw new ErrorDeNegocio('Esa póliza ya no está en la cartera: no se puede renovar.')

  const entrada = objeto(datos, 'Los datos de la renovación')
  const desdeIso = vigenciaIso(entrada.vigenciaDesde, 'la vigencia desde')
  const hastaIso = vigenciaIso(entrada.vigenciaHasta, 'la vigencia hasta')
  if (hastaIso <= desdeIso) throw new ErrorDeNegocio('La vigencia nueva tiene que terminar después de empezar.')
  const numero = texto(entrada.numero ?? '', 'El número de póliza', 0, 60)
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
        `INSERT INTO polizas (clave, fila_id, cliente_id, vehiculo_id, compania, numero, numero_normalizado, cobertura,
                              prima, prima_monto, forma_pago, productor, estado_texto, vigencia_desde, vigencia_hasta,
                              vigencia_desde_iso, vigencia_hasta_iso, alta, avisar_vto, observaciones, periodo_origen,
                              pestana_origen, poliza_anterior_id, creada_en_la_app, activa, creado_en, actualizado_en)
         VALUES (@clave, @fila_id, @cliente_id, @vehiculo_id, @compania, @numero, @numero_normalizado, @cobertura,
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

    // La anterior queda histórica: activa = 0 y enganchada por poliza_anterior_id. No se le inventa una
    // baja con motivo, porque no se dio de baja: se renovó, y en BAJAS no tiene nada que hacer.
    // (La clave ya se liberó más arriba, antes de insertar la nueva.)
    db().prepare('UPDATE polizas SET activa = 0, actualizado_en = ? WHERE id = ?').run(ahora, anterior.id)

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
      if (cuotaVieja) {
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
      if (cuotaVieja) encolar({ operacion: 'borrar', pestana: cuotaVieja.pestana, filaId: cuotaVieja.fila_id, campos: {} }, actor)
    }

    // El seguimiento de la ANTERIOR queda cerrado y apuntando a la nueva: así la bandeja de la semana
    // que viene no la vuelve a pedir y desde el historial se llega a la póliza que la reemplazó.
    const venceEl = anterior.vigencia_hasta_iso ?? desdeIso
    const seguimiento = seguimientoActual(anterior.id, venceEl)
    guardarSeguimiento(
      {
        polizaId: anterior.id,
        venceEl,
        estado: 'renovada',
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
    valorNuevo: `${numero || 'sin número'} · ${desdeTexto} a ${hastaTexto}`,
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
  const motivo = entrada.motivo as MotivoDeBaja
  if (!MOTIVOS_DE_BAJA.includes(motivo)) throw new ErrorDeNegocio('Elegí un motivo de baja de la lista.')
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
