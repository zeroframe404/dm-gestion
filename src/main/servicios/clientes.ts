// Clientes: el listado con búsqueda y filtros, la ficha completa, el alta sin duplicados y las notas
// y tareas de la ficha.
//
// La regla que manda en este módulo es la del pliego: un DNI/CUIT es UNA persona. La hoja de Google
// viene con el mismo documento escrito de mil formas («20-12345678-3», «12.345.678», «12345678») y por
// eso todo lo que compara pasa antes por normalizarDocumento / normalizarTexto / normalizarPatente.
//
// Notas y tareas son internas de la aplicación: en la hoja no hay ninguna columna donde ponerlas, así
// que no se encolan; sí quedan en el historial, como todo lo que se toca desde acá.
import { diasParaVencer, estadoDePoliza, aDia } from '../../shared/polizas'
import { esDebitoAutomatico, hoyLocal } from '../../shared/semaforo'
import {
  NOMBRE_ESTADO_TAREA,
  type DatosDeCliente,
  type DatosDeTarea,
  type EstadoTarea,
  type FichaCliente,
  type FilaCliente,
  type FiltrosClientes,
  type ListadoClientes,
  type NotaDeCliente,
  type PagoDeCliente,
  type PolizaDeCliente,
  type ResultadoAltaCliente,
  type SesionUsuario,
  type SiniestroDeCliente,
  type TareaDeCliente,
  type VehiculoDeCliente,
} from '../../shared/tipos'
import { db } from '../db/base'
import {
  ahoraIso,
  generarId,
  limpiar,
  normalizarDocumento,
  normalizarNumeroPoliza,
  normalizarPatente,
  normalizarTexto,
  soloDigitos,
} from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { registrarTareaNueva } from './tareas'
import { enteroPositivo, objeto, texto as validarTexto } from './validacion'

// ---------------------------------------------------------------------------
// El mes abierto
// ---------------------------------------------------------------------------

/**
 * El período más nuevo que todavía tiene filas vivas: «el mes abierto». De ahí salen la deuda del
 * listado y la cuota que muestra cada póliza en la ficha. Los meses anteriores son de sólo lectura y
 * no cuentan para nada de esto: una cuota impaga de marzo no es deuda de hoy, es historia.
 */
function mesAbierto(): string | null {
  const fila = db()
    .prepare(`SELECT periodo FROM cuotas_mes WHERE dada_de_baja = 0 ORDER BY periodo DESC LIMIT 1`)
    .get() as { periodo: string } | undefined
  return fila?.periodo ?? null
}

// ---------------------------------------------------------------------------
// Agregados del listado
// ---------------------------------------------------------------------------

const COLUMNAS_DE_FILA = 'id, nombre, documento, documento_normalizado, telefono, email, sucursal_texto, localidad'

interface FilaClienteCruda {
  id: number
  nombre: string
  documento: string | null
  documento_normalizado: string | null
  telefono: string | null
  email: string | null
  sucursal_texto: string | null
  localidad: string | null
}

interface ClienteCrudo extends FilaClienteCruda {
  clave: string
  direccion: string | null
  fecha_nacimiento: string | null
}

interface Agregados {
  polizasActivas: Map<number, number>
  companias: Map<number, string[]>
  vehiculos: Map<number, number>
  conDeuda: Set<number>
}

/**
 * Los contadores de las 2.100 fichas resueltos en cuatro consultas agrupadas. Una consulta por cliente
 * (la forma obvia) son ocho mil idas a la base cada vez que se abre la pantalla; así abre de una.
 *
 * `clienteId` acota los mismos agregados a una sola ficha, para no recorrer toda la cartera cuando lo
 * único que hace falta es armar la fila del cliente que ya existía en un alta duplicada.
 */
function agregados(clienteId?: number): Agregados {
  const base = db()
  const cliente = clienteId ?? null
  const polizasActivas = new Map<number, number>()
  const companias = new Map<number, string[]>()

  const porCompania = base
    .prepare(
      `SELECT cliente_id, compania, COUNT(*) AS total FROM polizas
       WHERE activa = 1 AND (@cliente IS NULL OR cliente_id = @cliente)
       GROUP BY cliente_id, compania`,
    )
    .all({ cliente }) as Array<{ cliente_id: number | null; compania: string | null; total: number }>
  for (const fila of porCompania) {
    if (fila.cliente_id === null) continue
    polizasActivas.set(fila.cliente_id, (polizasActivas.get(fila.cliente_id) ?? 0) + fila.total)
    const nombre = limpiar(fila.compania)
    if (!nombre) continue
    // «RIVADAVIA» y «Rivadavia Seguros» conviven en la hoja: la lista se arma sin repetidos por forma.
    const lista = companias.get(fila.cliente_id) ?? []
    if (!lista.some((c) => normalizarTexto(c) === normalizarTexto(nombre))) lista.push(nombre)
    companias.set(fila.cliente_id, lista)
  }

  const vehiculos = new Map<number, number>()
  for (const fila of base
    .prepare(
      `SELECT cliente_id, COUNT(*) AS total FROM vehiculos
       WHERE cliente_id IS NOT NULL AND (@cliente IS NULL OR cliente_id = @cliente)
       GROUP BY cliente_id`,
    )
    .all({ cliente }) as Array<{ cliente_id: number; total: number }>) {
    vehiculos.set(fila.cliente_id, fila.total)
  }

  return { polizasActivas, companias, vehiculos, conDeuda: clientesConDeuda(cliente) }
}

/**
 * Quién debe hoy: tiene al menos una cuota del mes abierto que no está paga y que no se cobra sola.
 *
 * «Se cobra sola» lo decide esDebitoAutomatico(), que es JavaScript y vive en shared/semaforo.ts
 * (la lista de formas de pago tiene que ser una sola para toda la aplicación). Por eso las cuotas del
 * mes se traen enteras en UNA consulta y la deuda se resuelve acá, en memoria, en vez de intentar
 * escribir esa lista dentro del SQL y que después las dos versiones se separen.
 */
function clientesConDeuda(clienteId: number | null): Set<number> {
  const conDeuda = new Set<number>()
  const periodo = mesAbierto()
  if (!periodo) return conDeuda
  const base = db()

  // Un pago cargado desde la aplicación no siempre escribe CUANDO PAGO en la fila del mes, así que
  // hay que mirar también la tabla `pagos` antes de decir que alguien debe.
  const conPagoRegistrado = new Set(
    (
      base
        .prepare(`SELECT DISTINCT poliza_id FROM pagos WHERE periodo = @periodo AND poliza_id IS NOT NULL`)
        .all({ periodo }) as Array<{ poliza_id: number }>
    ).map((f) => f.poliza_id),
  )

  const cuotas = base
    .prepare(
      `SELECT c.cliente_id, c.poliza_id, c.pago_fecha, COALESCE(c.forma_pago, p.forma_pago) AS forma_pago
       FROM cuotas_mes c LEFT JOIN polizas p ON p.id = c.poliza_id
       WHERE c.periodo = @periodo AND c.dada_de_baja = 0 AND (@cliente IS NULL OR c.cliente_id = @cliente)`,
    )
    .all({ periodo, cliente: clienteId }) as Array<{
    cliente_id: number | null
    poliza_id: number | null
    pago_fecha: string | null
    forma_pago: string | null
  }>

  for (const cuota of cuotas) {
    if (cuota.cliente_id === null) continue
    if (cuota.pago_fecha) continue
    if (cuota.poliza_id !== null && conPagoRegistrado.has(cuota.poliza_id)) continue
    if (esDebitoAutomatico(cuota.forma_pago)) continue
    conDeuda.add(cuota.cliente_id)
  }
  return conDeuda
}

function armarFila(cruda: FilaClienteCruda, datos: Agregados): FilaCliente {
  return {
    id: cruda.id,
    nombre: cruda.nombre,
    documento: cruda.documento,
    telefono: cruda.telefono,
    email: cruda.email,
    sucursal: cruda.sucursal_texto,
    localidad: cruda.localidad,
    polizasActivas: datos.polizasActivas.get(cruda.id) ?? 0,
    vehiculos: datos.vehiculos.get(cruda.id) ?? 0,
    conDeuda: datos.conDeuda.has(cruda.id),
    companias: datos.companias.get(cruda.id) ?? [],
  }
}

// ---------------------------------------------------------------------------
// Búsqueda
// ---------------------------------------------------------------------------

interface Termino {
  /** El texto normalizado; vacío significa «sin búsqueda». */
  texto: string
  /** Sin espacios: es la forma en que se guardan las patentes y los números de póliza. */
  compacto: string
  documento: string
  digitos: string
}

function interpretarBusqueda(busqueda: unknown): Termino {
  const crudo = limpiar(busqueda)
  const normalizado = normalizarTexto(crudo)
  return {
    texto: normalizado,
    compacto: normalizado.replace(/\s+/g, ''),
    documento: normalizarDocumento(crudo),
    digitos: soloDigitos(crudo),
  }
}

/**
 * Patentes y números de póliza por cliente, para poder buscar «AB123CD» o «10-4567890» y que aparezca
 * el dueño. Se arma sólo cuando hay algo escrito: sin búsqueda es trabajo tirado.
 */
function indiceDeBusqueda(): { patentes: Map<number, string[]>; polizas: Map<number, string[]> } {
  const base = db()
  const patentes = new Map<number, string[]>()
  for (const fila of base
    .prepare(`SELECT cliente_id, patente, patente_normalizada FROM vehiculos WHERE cliente_id IS NOT NULL`)
    .all() as Array<{ cliente_id: number; patente: string | null; patente_normalizada: string | null }>) {
    const valor = fila.patente_normalizada || normalizarPatente(fila.patente)
    if (!valor) continue
    const lista = patentes.get(fila.cliente_id) ?? []
    lista.push(valor)
    patentes.set(fila.cliente_id, lista)
  }

  const polizas = new Map<number, string[]>()
  for (const fila of base.prepare(`SELECT cliente_id, numero, numero_normalizado FROM polizas`).all() as Array<{
    cliente_id: number
    numero: string | null
    numero_normalizado: string | null
  }>) {
    const valor = fila.numero_normalizado || normalizarNumeroPoliza(fila.numero)
    if (!valor) continue
    const lista = polizas.get(fila.cliente_id) ?? []
    lista.push(valor)
    polizas.set(fila.cliente_id, lista)
  }
  return { patentes, polizas }
}

/**
 * Nombre, documento, patente, número de póliza o teléfono. Lo escrito se compara en forma compacta y
 * no con normalizarPatente(), que devuelve vacío para menos de cinco caracteres: quien busca escribe
 * de a poco, y «AB12» tiene que ir encontrando algo mientras termina de tipear.
 */
function coincide(cruda: FilaClienteCruda, termino: Termino, patentes: string[], polizas: string[]): boolean {
  if (!termino.texto) return true
  if (normalizarTexto(cruda.nombre).includes(termino.texto)) return true
  if (termino.documento && (cruda.documento_normalizado ?? '').includes(termino.documento)) return true
  if (termino.compacto.length >= 3) {
    if (patentes.some((patente) => patente.includes(termino.compacto))) return true
    if (polizas.some((numero) => numero.includes(termino.compacto))) return true
  }
  // Los teléfonos están escritos con guiones, paréntesis y prefijos, así que se comparan sólo los
  // dígitos; y desde una punta o la otra, no por el medio: buscar un número de póliza de seis cifras
  // caía adentro de medio listado de teléfonos («444555» está dentro de «11-4444-5555»). Lo que la
  // gente escribe es el número entero o los últimos dígitos que le quedaron en el visor.
  if (termino.digitos.length >= 6) {
    const telefono = soloDigitos(cruda.telefono)
    if (telefono && (telefono.endsWith(termino.digitos) || telefono.startsWith(termino.digitos))) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Catálogos de los desplegables
// ---------------------------------------------------------------------------

/** Valores distintos de una columna, sin repetir por mayúsculas ni tildes, ordenados en castellano. */
function valoresDistintos(consulta: string): string[] {
  const filas = db().prepare(consulta).all() as Array<{ valor: string | null }>
  const vistos = new Map<string, string>()
  for (const fila of filas) {
    const valor = limpiar(fila.valor)
    if (!valor) continue
    const clave = normalizarTexto(valor)
    if (!vistos.has(clave)) vistos.set(clave, valor)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

/** Las sucursales del catálogo más las que la hoja trae escritas de otra forma: el filtro tiene que ofrecer las dos. */
function sucursalesDelListado(): string[] {
  const vistos = new Map<string, string>()
  for (const valor of valoresDistintos('SELECT nombre AS valor FROM sucursales')) vistos.set(normalizarTexto(valor), valor)
  for (const valor of valoresDistintos('SELECT DISTINCT sucursal_texto AS valor FROM clientes')) {
    if (!vistos.has(normalizarTexto(valor))) vistos.set(normalizarTexto(valor), valor)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

interface FiltrosLimpios {
  termino: Termino
  sucursal: string
  compania: string
  deuda: '' | 'con' | 'sin'
}

function limpiarFiltros(filtros: FiltrosClientes): FiltrosLimpios {
  const datos = objeto(filtros, 'Los filtros')
  const deuda = datos.deuda === 'con' || datos.deuda === 'sin' ? datos.deuda : ''
  return {
    termino: interpretarBusqueda(datos.busqueda),
    sucursal: normalizarTexto(datos.sucursal),
    compania: normalizarTexto(datos.compania),
    deuda,
  }
}

function filasFiltradas(filtros: FiltrosLimpios, datos: Agregados, limite: number | null): FilaCliente[] {
  const crudas = db().prepare(`SELECT ${COLUMNAS_DE_FILA} FROM clientes`).all() as FilaClienteCruda[]
  const indice = filtros.termino.texto ? indiceDeBusqueda() : null

  const filas: FilaCliente[] = []
  for (const cruda of crudas) {
    if (filtros.sucursal && normalizarTexto(cruda.sucursal_texto) !== filtros.sucursal) continue
    if (filtros.deuda === 'con' && !datos.conDeuda.has(cruda.id)) continue
    if (filtros.deuda === 'sin' && datos.conDeuda.has(cruda.id)) continue
    if (filtros.compania) {
      const suyas = datos.companias.get(cruda.id) ?? []
      if (!suyas.some((compania) => normalizarTexto(compania) === filtros.compania)) continue
    }
    if (indice && !coincide(cruda, filtros.termino, indice.patentes.get(cruda.id) ?? [], indice.polizas.get(cruda.id) ?? [])) {
      continue
    }
    filas.push(armarFila(cruda, datos))
  }

  filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return limite === null ? filas : filas.slice(0, limite)
}

export function listarClientes(filtros: FiltrosClientes): ListadoClientes {
  const limpios = limpiarFiltros(filtros)
  const datos = agregados()
  return {
    filas: filasFiltradas(limpios, datos, null),
    // El total es de la cartera entera, antes de filtrar: es lo que deja decir «120 de 2.100».
    total: (db().prepare('SELECT COUNT(*) AS total FROM clientes').get() as { total: number }).total,
    sucursales: sucursalesDelListado(),
    companias: valoresDistintos('SELECT DISTINCT compania AS valor FROM polizas WHERE activa = 1'),
  }
}

/** Búsqueda suelta para los buscadores de otras pantallas (elegir el cliente de una póliza nueva). */
export function buscarClientes(busqueda: string, limite = 20): FilaCliente[] {
  const termino = interpretarBusqueda(busqueda)
  if (!termino.texto) return []
  const tope = Number.isInteger(limite) && limite > 0 ? Math.min(limite, 100) : 20
  return filasFiltradas({ termino, sucursal: '', compania: '', deuda: '' }, agregados(), tope)
}

// ---------------------------------------------------------------------------
// Ficha del cliente
// ---------------------------------------------------------------------------

function buscarCliente(id: number): ClienteCrudo {
  const fila = db()
    .prepare(`SELECT ${COLUMNAS_DE_FILA}, clave, direccion, fecha_nacimiento FROM clientes WHERE id = ?`)
    .get(id) as ClienteCrudo | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró ese cliente. Actualizá la pantalla y probá de nuevo.')
  return fila
}

function marcadores(cantidad: number): string {
  return new Array(cantidad).fill('?').join(', ')
}

interface PolizaCruda {
  id: number
  fila_id: string | null
  numero: string | null
  propuesta: string | null
  compania: string | null
  cobertura: string | null
  forma_pago: string | null
  avisar_vto: string | null
  observaciones: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
  vigencia_hasta_iso: string | null
  activa: number
  vehiculo_id: number | null
  patente: string | null
  marca: string | null
  modelo: string | null
  tipo: string | null
}

/** Cómo se nombra el vehículo en las listas de pólizas: «FORD FIESTA» dice más que «AUTO». */
function describirVehiculo(cruda: PolizaCruda): string | null {
  const descripcion = [limpiar(cruda.marca), limpiar(cruda.modelo)].filter(Boolean).join(' ')
  return descripcion || limpiar(cruda.tipo) || null
}

function polizasDe(cliente: ClienteCrudo, hoy: string): PolizaDeCliente[] {
  const base = db()
  const crudas = base
    .prepare(
      `SELECT p.id, p.fila_id, p.numero, p.propuesta, p.compania, p.cobertura, p.forma_pago, p.avisar_vto,
              p.observaciones, p.vigencia_desde, p.vigencia_hasta, p.vigencia_hasta_iso, p.activa, p.vehiculo_id,
              v.patente, v.marca, v.modelo, v.tipo
       FROM polizas p LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       WHERE p.cliente_id = ?`,
    )
    .all(cliente.id) as PolizaCruda[]
  if (crudas.length === 0) return []

  const ids = crudas.map((p) => p.id)
  const periodo = mesAbierto()

  // La cuota y el día de vencimiento salen de la fila del mes abierto, no de la póliza: son datos que
  // cambian todos los meses. Se traen aparte (y no con un JOIN) porque la hoja tiene pólizas repetidas
  // dentro del mismo mes y un JOIN duplicaría la póliza en la ficha.
  const cuotas = new Map<number, { cuota: string | null; diaVencimiento: string | null }>()
  if (periodo) {
    for (const fila of base
      .prepare(
        `SELECT poliza_id, cuota, dia_vencimiento FROM cuotas_mes
         WHERE periodo = ? AND dada_de_baja = 0 AND poliza_id IN (${marcadores(ids.length)})`,
      )
      .all(periodo, ...ids) as Array<{ poliza_id: number; cuota: string | null; dia_vencimiento: string | null }>) {
      if (!cuotas.has(fila.poliza_id)) cuotas.set(fila.poliza_id, { cuota: fila.cuota, diaVencimiento: fila.dia_vencimiento })
    }
  }

  // Motivo y fecha de la baja MÁS RECIENTE de cada póliza: una póliza puede haberse dado de baja,
  // reactivado y vuelto a dar de baja, y lo que se muestra es lo último que pasó.
  const bajas = new Map<number, { motivo: string | null; fecha: string | null }>()
  for (const fila of base
    .prepare(
      `SELECT poliza_id, motivo, COALESCE(fecha_baja_iso, fecha_baja) AS fecha
       FROM bajas WHERE poliza_id IN (${marcadores(ids.length)})
       ORDER BY fecha_baja_iso DESC, id DESC`,
    )
    .all(...ids) as Array<{ poliza_id: number; motivo: string | null; fecha: string | null }>) {
    if (!bajas.has(fila.poliza_id)) bajas.set(fila.poliza_id, { motivo: fila.motivo, fecha: fila.fecha })
  }

  const filas = crudas.map((cruda): PolizaDeCliente => {
    const estado = estadoDePoliza(cruda.activa === 1, cruda.vigencia_hasta_iso, hoy)
    const baja = estado === 'BAJA' ? (bajas.get(cruda.id) ?? null) : null
    const delMes = cuotas.get(cruda.id) ?? null
    return {
      id: cruda.id,
      filaId: cruda.fila_id,
      numero: cruda.numero,
      propuesta: cruda.propuesta,
      compania: cruda.compania,
      cobertura: cruda.cobertura,
      formaPago: cruda.forma_pago,
      cuota: delMes?.cuota ?? null,
      diaVencimiento: delMes?.diaVencimiento ?? null,
      vigenciaDesde: cruda.vigencia_desde,
      vigenciaHasta: cruda.vigencia_hasta,
      vigenciaHastaIso: cruda.vigencia_hasta_iso,
      avisarVto: cruda.avisar_vto,
      observaciones: cruda.observaciones,
      estado,
      vehiculoId: cruda.vehiculo_id,
      vehiculo: describirVehiculo(cruda),
      patente: cruda.patente,
      clienteId: cliente.id,
      clienteNombre: cliente.nombre,
      sucursal: cliente.sucursal_texto,
      motivoBaja: baja?.motivo ?? null,
      fechaBaja: baja?.fecha ?? null,
      diasParaVencer: diasParaVencer(cruda.vigencia_hasta_iso, hoy),
    }
  })

  // Primero la cartera vigente y después el histórico; dentro de cada grupo, lo que vence más tarde
  // arriba. Las pólizas sin vigencia cargada (la hoja tiene muchas) quedan al final de su grupo.
  return filas.sort((a, b) => {
    const grupo = Number(a.estado === 'BAJA') - Number(b.estado === 'BAJA')
    if (grupo !== 0) return grupo
    const hastaA = a.vigenciaHastaIso ?? ''
    const hastaB = b.vigenciaHastaIso ?? ''
    if (hastaA !== hastaB) return hastaB.localeCompare(hastaA)
    return (a.numero ?? '').localeCompare(b.numero ?? '', 'es')
  })
}

function vehiculosDe(clienteId: number, polizas: PolizaDeCliente[]): VehiculoDeCliente[] {
  const porVehiculo = new Map<number, number>()
  for (const poliza of polizas) {
    if (poliza.vehiculoId === null) continue
    porVehiculo.set(poliza.vehiculoId, (porVehiculo.get(poliza.vehiculoId) ?? 0) + 1)
  }
  const filas = db()
    .prepare(
      `SELECT id, patente, marca, modelo, anio, anio_numero, tipo, motor, chasis, uso, color
       FROM vehiculos WHERE cliente_id = ? ORDER BY id`,
    )
    .all(clienteId) as Array<{
    id: number
    patente: string | null
    marca: string | null
    modelo: string | null
    anio: string | null
    anio_numero: number | null
    tipo: string | null
    motor: string | null
    chasis: string | null
    uso: string | null
    color: string | null
  }>
  return filas.map((f) => ({
    id: f.id,
    patente: f.patente,
    marca: f.marca,
    modelo: f.modelo,
    anio: f.anio,
    anioNumero: f.anio_numero,
    tipo: f.tipo,
    motor: f.motor,
    chasis: f.chasis,
    uso: f.uso,
    color: f.color,
    // Cuántas pólizas de ESTE cliente tiene el vehículo: si lo vendió, la del comprador no es asunto suyo.
    polizas: porVehiculo.get(f.id) ?? 0,
  }))
}

function pagosDe(clienteId: number): PagoDeCliente[] {
  // Por póliza además de por cliente: los pagos importados de la pestaña PAGOS a veces enlazaron con la
  // póliza y no con el cliente (la fila no traía documento).
  const filas = db()
    .prepare(
      `SELECT id, COALESCE(fecha_iso, fecha) AS fecha, importe, medio, compania, numero_poliza, periodo
       FROM pagos
       WHERE cliente_id = @cliente OR poliza_id IN (SELECT id FROM polizas WHERE cliente_id = @cliente)
       ORDER BY fecha_iso DESC, id DESC`,
    )
    .all({ cliente: clienteId }) as Array<{
    id: number
    fecha: string | null
    importe: string | null
    medio: string | null
    compania: string | null
    numero_poliza: string | null
    periodo: string | null
  }>
  return filas.map((f) => ({
    id: f.id,
    fecha: f.fecha,
    importe: f.importe,
    medio: f.medio,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    periodo: f.periodo,
  }))
}

function siniestrosDe(clienteId: number): SiniestroDeCliente[] {
  const filas = db()
    .prepare(
      `SELECT id, COALESCE(fecha_iso, fecha) AS fecha, numero_siniestro, compania, numero_poliza, patente,
              descripcion, estado, importe
       FROM siniestros
       WHERE cliente_id = @cliente OR poliza_id IN (SELECT id FROM polizas WHERE cliente_id = @cliente)
       ORDER BY fecha_iso DESC, id DESC`,
    )
    .all({ cliente: clienteId }) as Array<{
    id: number
    fecha: string | null
    numero_siniestro: string | null
    compania: string | null
    numero_poliza: string | null
    patente: string | null
    descripcion: string | null
    estado: string | null
    importe: string | null
  }>
  return filas.map((f) => ({
    id: f.id,
    fecha: f.fecha,
    numeroSiniestro: f.numero_siniestro,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    patente: f.patente,
    descripcion: f.descripcion,
    estado: f.estado,
    importe: f.importe,
  }))
}

function notasDe(clienteId: number): NotaDeCliente[] {
  const filas = db()
    .prepare(`SELECT id, texto, usuario_nombre, creado_en FROM notas WHERE cliente_id = ? ORDER BY id DESC`)
    .all(clienteId) as Array<{ id: number; texto: string; usuario_nombre: string; creado_en: string }>
  return filas.map((f) => ({ id: f.id, texto: f.texto, usuarioNombre: f.usuario_nombre, creadoEn: f.creado_en }))
}

function tareasDe(clienteId: number): TareaDeCliente[] {
  // Lo que hay que hacer primero: las hechas al final, y arriba las que vencen antes. Las que no
  // tienen fecha van después de las que sí, porque no son urgentes por sí solas.
  const filas = db()
    .prepare(
      `SELECT id, titulo, detalle, responsable_nombre, vence_el, estado, creado_por, creado_en
       FROM tareas WHERE cliente_id = ?
       ORDER BY CASE estado WHEN 'hecha' THEN 1 ELSE 0 END, vence_el IS NULL, vence_el, id DESC`,
    )
    .all(clienteId) as Array<{
    id: number
    titulo: string
    detalle: string | null
    responsable_nombre: string | null
    vence_el: string | null
    estado: string
    creado_por: string
    creado_en: string
  }>
  return filas.map((f) => ({
    id: f.id,
    titulo: f.titulo,
    detalle: f.detalle,
    responsableNombre: f.responsable_nombre,
    venceEl: f.vence_el,
    estado: f.estado as TareaDeCliente['estado'],
    creadoPor: f.creado_por,
    creadoEn: f.creado_en,
  }))
}

export function fichaDeCliente(clienteId: number): FichaCliente {
  const id = enteroPositivo(clienteId, 'El cliente')
  const cliente = buscarCliente(id)
  const hoy = hoyLocal()
  const polizas = polizasDe(cliente, hoy)
  return {
    id: cliente.id,
    nombre: cliente.nombre,
    documento: cliente.documento,
    telefono: cliente.telefono,
    email: cliente.email,
    direccion: cliente.direccion,
    localidad: cliente.localidad,
    sucursal: cliente.sucursal_texto,
    fechaNacimiento: cliente.fecha_nacimiento,
    vehiculos: vehiculosDe(cliente.id, polizas),
    polizas,
    pagos: pagosDe(cliente.id),
    siniestros: siniestrosDe(cliente.id),
    notas: notasDe(cliente.id),
    tareas: tareasDe(cliente.id),
  }
}

// ---------------------------------------------------------------------------
// Alta y edición
// ---------------------------------------------------------------------------

interface CamposDeCliente {
  nombre: string
  documento: string
  telefono: string
  email: string
  direccion: string
  localidad: string
  sucursal: string
  fechaNacimiento: string
}

/** Campo que puede venir vacío: se acepta el vacío y sólo se controla el largo cuando trae algo. */
function opcional(valor: unknown, campo: string, maximo: number): string {
  if (valor === undefined || valor === null) return ''
  if (typeof valor !== 'string') throw new ErrorDeNegocio(`${campo} no es válido.`)
  if (limpiar(valor) === '') return ''
  return limpiar(validarTexto(valor, campo, 1, maximo))
}

/**
 * El nombre es lo único obligatorio. El documento puede faltar a propósito: en la hoja hay clientes
 * cargados sin DNI desde hace años y la aplicación no puede negarse a trabajar con ellos.
 */
function validarDatos(datos: DatosDeCliente): CamposDeCliente {
  const d = objeto(datos, 'Los datos del cliente')
  return {
    nombre: limpiar(validarTexto(d.nombre, 'El nombre', 1, 120)),
    documento: opcional(d.documento, 'El DNI/CUIT', 20),
    telefono: opcional(d.telefono, 'El teléfono', 60),
    email: opcional(d.email, 'El email', 120),
    direccion: opcional(d.direccion, 'La dirección', 160),
    localidad: opcional(d.localidad, 'La localidad', 80),
    sucursal: opcional(d.sucursal, 'La sucursal', 80),
    fechaNacimiento: opcional(d.fechaNacimiento, 'La fecha de nacimiento', 20),
  }
}

function conPuntos(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/**
 * Cómo se nombra el documento en los mensajes. El texto se muestra tal cual en pantalla, así que
 * conviene que diga «el DNI 12.345.678» y no «el documento 12345678».
 */
function describirDocumento(valor: string): string {
  const digitos = soloDigitos(valor)
  if (digitos.length === 11) return `el CUIT ${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
  if (digitos.length >= 7 && digitos.length <= 8) return `el DNI ${conPuntos(digitos)}`
  return `el documento ${limpiar(valor) || digitos}`
}

/** La sucursal del catálogo que corresponde a ese texto. La hoja escribe «DOCK SUD» y «DOCKSUD». */
function resolverSucursal(valor: string): number | null {
  if (!valor) return null
  const normalizado = normalizarTexto(valor)
  const sinEspacios = normalizado.replace(/ /g, '')
  const fila = db()
    .prepare(
      `SELECT id FROM sucursales
       WHERE REPLACE(UPPER(nombre), ' ', '') = @sinEspacios OR UPPER(nombre) = @normalizado
       LIMIT 1`,
    )
    .get({ normalizado, sinEspacios }) as { id: number } | undefined
  return fila?.id ?? null
}

function existeClave(clave: string): boolean {
  return db().prepare('SELECT 1 FROM clientes WHERE clave = ?').get(clave) !== undefined
}

/**
 * La misma convención que usa el importador (ver claveCliente() en importacion/importador.ts):
 * 'DOC:<dígitos normalizados>' si hay documento y 'NOM:<nombre normalizado>' si no. Importa que sea
 * idéntica: es el ancla con la que la próxima importación reconoce a este cliente en la hoja en vez
 * de crear un segundo registro para la misma persona.
 */
function claveDeCliente(nombre: string, documentoNormalizado: string): string {
  const documentoValido = documentoNormalizado.length >= 6 && documentoNormalizado.length <= 11
  if (documentoValido) return `DOC:${documentoNormalizado}`
  const normalizado = normalizarTexto(nombre)
  return normalizado ? `NOM:${normalizado}` : ''
}

/**
 * Si la clave que corresponde ya está ocupada (dos personas sin documento que se llaman igual, que
 * son gente distinta) se usa una propia: la columna es única y el alta no puede fallar por eso.
 */
function claveDisponible(nombre: string, documentoNormalizado: string): string {
  const clave = claveDeCliente(nombre, documentoNormalizado)
  if (clave && !existeClave(clave)) return clave
  return `APP:${generarId()}`
}

export function crearCliente(datos: DatosDeCliente, actor: SesionUsuario): ResultadoAltaCliente {
  const campos = validarDatos(datos)
  const documentoNormalizado = normalizarDocumento(campos.documento)

  // LA regla del pliego. normalizarDocumento() hace que «20-12345678-3» y «12345678» sean la misma
  // persona, así que en vez de crear el duplicado se devuelve el cliente que ya está y la pantalla
  // ofrece abrir su ficha. El documento vacío no se chequea: no hay nada con qué comparar.
  if (documentoNormalizado) {
    const existente = db()
      .prepare(`SELECT ${COLUMNAS_DE_FILA} FROM clientes WHERE documento_normalizado = ? ORDER BY id LIMIT 1`)
      .get(documentoNormalizado) as FilaClienteCruda | undefined
    if (existente) {
      const sucursal = limpiar(existente.sucursal_texto)
      return {
        creado: false,
        yaExiste: armarFila(existente, agregados(existente.id)),
        motivo:
          `Ya hay un cliente con ${describirDocumento(existente.documento || campos.documento)}: ` +
          `${existente.nombre}${sucursal ? `, de la sucursal ${sucursal}` : ''}.`,
      }
    }
  }

  const ahora = ahoraIso()
  const resultado = db()
    .prepare(
      `INSERT INTO clientes (clave, documento, documento_normalizado, nombre, telefono, email, direccion, localidad,
                             sucursal_id, sucursal_texto, fecha_nacimiento, fila_id, pestana_origen, creado_en, actualizado_en)
       VALUES (@clave, @documento, @documento_normalizado, @nombre, @telefono, @email, @direccion, @localidad,
               @sucursal_id, @sucursal_texto, @fecha_nacimiento, NULL, NULL, @ahora, @ahora)`,
    )
    .run({
      clave: claveDisponible(campos.nombre, documentoNormalizado),
      documento: campos.documento || null,
      documento_normalizado: documentoNormalizado || null,
      nombre: campos.nombre,
      telefono: campos.telefono || null,
      email: campos.email || null,
      direccion: campos.direccion || null,
      localidad: campos.localidad || null,
      sucursal_id: resolverSucursal(campos.sucursal),
      sucursal_texto: campos.sucursal || null,
      fecha_nacimiento: campos.fechaNacimiento || null,
      ahora,
    })
  const id = Number(resultado.lastInsertRowid)

  // No se encola nada: la hoja de Google es UNA FILA POR PÓLIZA, así que un cliente sin pólizas no
  // tiene dónde vivir allá. Viaja recién cuando se le crea la primera póliza, que es la que arma la
  // fila (`fila_id` queda en NULL hasta entonces, igual que `pestana_origen`).
  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'clientes',
    registroId: id,
    campo: 'ALTA DE CLIENTE',
    valorAnterior: null,
    valorNuevo: `${campos.nombre}${campos.documento ? ` · ${campos.documento}` : ''}`,
  })

  return { creado: true, cliente: fichaDeCliente(id) }
}

/**
 * Cada dato del cliente con su columna, cómo se llama en el historial, la copia que la fila del mes
 * guarda del mismo dato y el nombre con el que viaja a la hoja. Los que no tienen `enLaHoja` (email,
 * dirección, localidad, nacimiento) no están en la planilla mensual: se guardan y nada más.
 */
const CAMPOS_DEL_CLIENTE = [
  { campo: 'nombre', columna: 'nombre', etiqueta: 'NOMBRE', enLaCuota: 'cliente_nombre', enLaHoja: 'nombre' },
  { campo: 'documento', columna: 'documento', etiqueta: 'DNI/CUIT', enLaCuota: 'documento', enLaHoja: 'documento' },
  { campo: 'telefono', columna: 'telefono', etiqueta: 'TELEFONO', enLaCuota: null, enLaHoja: 'telefono' },
  { campo: 'sucursal', columna: 'sucursal_texto', etiqueta: 'LOCAL', enLaCuota: 'sucursal_texto', enLaHoja: 'sucursal' },
  { campo: 'email', columna: 'email', etiqueta: 'EMAIL', enLaCuota: null, enLaHoja: null },
  { campo: 'direccion', columna: 'direccion', etiqueta: 'DIRECCION', enLaCuota: null, enLaHoja: null },
  { campo: 'localidad', columna: 'localidad', etiqueta: 'LOCALIDAD', enLaCuota: null, enLaHoja: null },
  { campo: 'fechaNacimiento', columna: 'fecha_nacimiento', etiqueta: 'FECHA DE NACIMIENTO', enLaCuota: null, enLaHoja: null },
] as const

export function editarCliente(clienteId: number, datos: DatosDeCliente, actor: SesionUsuario): FichaCliente {
  const id = enteroPositivo(clienteId, 'El cliente')
  const campos = validarDatos(datos)
  const actual = buscarCliente(id)
  const documentoNormalizado = normalizarDocumento(campos.documento)

  // El mismo documento no puede estar en dos fichas: es la regla del alta, aplicada también acá.
  if (documentoNormalizado && documentoNormalizado !== (actual.documento_normalizado ?? '')) {
    const otro = db()
      .prepare('SELECT nombre FROM clientes WHERE documento_normalizado = ? AND id <> ? LIMIT 1')
      .get(documentoNormalizado, id) as { nombre: string } | undefined
    if (otro) {
      throw new ErrorDeNegocio(
        `No se puede guardar: ${describirDocumento(campos.documento)} ya es de ${otro.nombre}. Revisá el número.`,
      )
    }
  }

  const anteriores: Record<string, string> = {
    nombre: limpiar(actual.nombre),
    documento: limpiar(actual.documento),
    telefono: limpiar(actual.telefono),
    sucursal: limpiar(actual.sucursal_texto),
    email: limpiar(actual.email),
    direccion: limpiar(actual.direccion),
    localidad: limpiar(actual.localidad),
    fechaNacimiento: limpiar(actual.fecha_nacimiento),
  }
  const cambiados = CAMPOS_DEL_CLIENTE.filter((c) => anteriores[c.campo] !== campos[c.campo])
  if (cambiados.length === 0) return fichaDeCliente(id)

  // Si cambió el documento (o el nombre de un cliente que se identificaba por nombre), la clave tiene
  // que acompañar: es el ancla del importador. Sólo se toca cuando la clave sigue la convención y la
  // nueva está libre; si está ocupada se deja la vieja, porque la columna es única y no poder guardar
  // sería peor que perder el ancla.
  const claveNueva = claveDeCliente(campos.nombre, documentoNormalizado)
  const sigueLaConvencion = actual.clave.startsWith('DOC:') || actual.clave.startsWith('NOM:')
  const clave = sigueLaConvencion && claveNueva && claveNueva !== actual.clave && !existeClave(claveNueva) ? claveNueva : actual.clave

  const ahora = ahoraIso()
  const cuotas = cuotasDelMesAbierto(id)
  const columnasDeLaCuota = cambiados.filter((c) => c.enLaCuota !== null)
  const camposDeLaHoja: Partial<Record<'nombre' | 'documento' | 'telefono' | 'sucursal', string>> = {}
  for (const cambio of cambiados) {
    if (cambio.enLaHoja !== null) camposDeLaHoja[cambio.enLaHoja] = campos[cambio.campo]
  }

  db().transaction(() => {
    db()
      .prepare(
        `UPDATE clientes SET clave = @clave, nombre = @nombre, documento = @documento,
                documento_normalizado = @documento_normalizado, telefono = @telefono, email = @email,
                direccion = @direccion, localidad = @localidad, sucursal_id = @sucursal_id,
                sucursal_texto = @sucursal_texto, fecha_nacimiento = @fecha_nacimiento, actualizado_en = @ahora
         WHERE id = @id`,
      )
      .run({
        id,
        clave,
        nombre: campos.nombre,
        documento: campos.documento || null,
        documento_normalizado: documentoNormalizado || null,
        telefono: campos.telefono || null,
        email: campos.email || null,
        direccion: campos.direccion || null,
        localidad: campos.localidad || null,
        sucursal_id: resolverSucursal(campos.sucursal),
        sucursal_texto: campos.sucursal || null,
        fecha_nacimiento: campos.fechaNacimiento || null,
        ahora,
      })

    // La fila del mes guarda su propia copia del nombre, el documento y la sucursal: si se actualiza
    // una sola, la planilla sigue mostrando el dato viejo. Es lo mismo que hace editarCelda() en
    // cartera.ts, y por eso se hacen las dos escrituras juntas.
    if (columnasDeLaCuota.length > 0) {
      const asignaciones = columnasDeLaCuota.map((c) => `${c.enLaCuota} = @${c.campo}`).join(', ')
      const actualizar = db().prepare(`UPDATE cuotas_mes SET ${asignaciones}, actualizado_en = @ahora WHERE id = @id`)
      for (const cuota of cuotas) {
        const valores: Record<string, string | number | null> = { id: cuota.id, ahora }
        for (const c of columnasDeLaCuota) valores[c.campo] = campos[c.campo] || null
        actualizar.run(valores)
      }
    }
  })()

  // A la hoja viajan sólo los campos que la planilla mensual tiene, y una vez por cada fila del mes
  // abierto de este cliente: allá cada póliza es una fila distinta con el nombre repetido.
  if (Object.keys(camposDeLaHoja).length > 0) {
    for (const cuota of cuotas) {
      encolar({ operacion: 'actualizar', pestana: cuota.pestana, filaId: cuota.fila_id, campos: camposDeLaHoja }, actor)
    }
  }

  // Un renglón por campo que cambió de verdad: «se editó el cliente» no sirve para nada dentro de seis
  // meses, y quién cambió un teléfono es justo lo que se termina buscando.
  for (const cambio of cambiados) {
    registrarCambio(actor, {
      accion: 'edicion',
      tabla: 'clientes',
      registroId: id,
      campo: cambio.etiqueta,
      valorAnterior: anteriores[cambio.campo] || null,
      valorNuevo: campos[cambio.campo] || null,
    })
  }

  return fichaDeCliente(id)
}

/** Las filas del mes abierto de ese cliente: son las que hay que actualizar y encolar. */
function cuotasDelMesAbierto(clienteId: number): Array<{ id: number; fila_id: string; pestana: string }> {
  const periodo = mesAbierto()
  if (!periodo) return []
  return db()
    .prepare(`SELECT id, fila_id, pestana FROM cuotas_mes WHERE cliente_id = ? AND periodo = ? AND dada_de_baja = 0`)
    .all(clienteId, periodo) as Array<{ id: number; fila_id: string; pestana: string }>
}

// ---------------------------------------------------------------------------
// Notas y tareas de la ficha
// ---------------------------------------------------------------------------

export function agregarNota(clienteId: number, texto: string, actor: SesionUsuario): NotaDeCliente[] {
  const id = enteroPositivo(clienteId, 'El cliente')
  buscarCliente(id)
  const contenido = limpiar(validarTexto(texto, 'La nota', 1, 2000))

  db()
    .prepare(
      `INSERT INTO notas (cliente_id, texto, usuario_id, usuario_nombre, creado_en)
       VALUES (@cliente_id, @texto, @usuario_id, @usuario_nombre, @creado_en)`,
    )
    .run({ cliente_id: id, texto: contenido, usuario_id: actor.id, usuario_nombre: actor.nombre, creado_en: ahoraIso() })

  // No se encola: en la hoja no hay ninguna columna donde poner una nota. Queda sólo en la aplicación.
  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'notas',
    registroId: id,
    campo: 'NOTA',
    valorAnterior: null,
    valorNuevo: recortar(contenido),
  })
  return notasDe(id)
}

/** El historial es para leerlo de un vistazo: una nota larga entra recortada. */
function recortar(valor: string): string {
  return valor.length > 200 ? `${valor.slice(0, 197)}…` : valor
}

/** Fecha opcional en 'AAAA-MM-DD'. Vacío es válido: una tarea puede no tener fecha límite. */
function fechaOpcional(valor: unknown, campo: string): string | null {
  const limpio = opcional(valor, campo, 10)
  if (!limpio) return null
  if (aDia(limpio) === null) throw new ErrorDeNegocio(`${campo} no es una fecha válida.`)
  return limpio
}

export function crearTarea(datos: DatosDeTarea, actor: SesionUsuario): TareaDeCliente[] {
  const d = objeto(datos, 'Los datos de la tarea')
  const clienteId = enteroPositivo(d.clienteId, 'El cliente')
  buscarCliente(clienteId)
  const titulo = limpiar(validarTexto(d.titulo, 'El título de la tarea', 1, 160))
  const detalle = opcional(d.detalle, 'El detalle', 2000)
  const venceEl = fechaOpcional(d.venceEl, 'La fecha de vencimiento')

  const polizaId = d.polizaId === null || d.polizaId === undefined ? null : enteroPositivo(d.polizaId, 'La póliza')
  if (polizaId !== null) {
    const poliza = db().prepare('SELECT cliente_id FROM polizas WHERE id = ?').get(polizaId) as { cliente_id: number } | undefined
    if (!poliza || poliza.cliente_id !== clienteId) throw new ErrorDeNegocio('Esa póliza no es de este cliente.')
  }

  // El nombre del responsable se guarda además del id: la tarea se muestra en listados que no vuelven
  // a la tabla de usuarios, y si mañana ese usuario se desactiva la tarea igual sigue diciendo de quién era.
  let responsableId: number | null = null
  let responsableNombre: string | null = null
  if (d.responsableId !== null && d.responsableId !== undefined) {
    responsableId = enteroPositivo(d.responsableId, 'El responsable')
    const usuario = db().prepare('SELECT nombre FROM usuarios WHERE id = ? AND activo = 1').get(responsableId) as
      | { nombre: string }
      | undefined
    if (!usuario) throw new ErrorDeNegocio('El responsable que elegiste no existe o está dado de baja.')
    responsableNombre = usuario.nombre
  }

  const ahora = ahoraIso()
  const cliente = buscarCliente(clienteId)
  const resultado = db()
    .prepare(
      `INSERT INTO tareas (titulo, detalle, cliente_id, poliza_id, responsable_id, responsable_nombre, sucursal_texto,
                           vence_el, prioridad, estado, creado_por, creado_por_id, visto_en, creado_en, actualizado_en)
       VALUES (@titulo, @detalle, @cliente_id, @poliza_id, @responsable_id, @responsable_nombre, @sucursal,
               @vence_el, 'NORMAL', 'pendiente', @creado_por, @creado_por_id, @visto_en, @ahora, @ahora)`,
    )
    .run({
      titulo,
      detalle: detalle || null,
      cliente_id: clienteId,
      poliza_id: polizaId,
      responsable_id: responsableId,
      responsable_nombre: responsableNombre,
      sucursal: limpiar(cliente.sucursal_texto) || actor.sucursal.nombre,
      vence_el: venceEl,
      creado_por: actor.nombre,
      creado_por_id: actor.id,
      // Igual que en el módulo de Tareas: la que me pongo yo no enciende mi propia campana.
      visto_en: responsableId === null || responsableId === actor.id ? ahora : null,
      ahora,
    })

  const tareaId = Number(resultado.lastInsertRowid)
  // La tarea es la misma cosa venga de donde venga: también se anota en la pestaña APP TAREAS.
  registrarTareaNueva(tareaId, actor)
  registrarCambio(actor, {
    accion: 'edicion',
    tabla: 'tareas',
    registroId: tareaId,
    campo: 'TAREA',
    valorAnterior: null,
    valorNuevo: `${recortar(titulo)}${responsableNombre ? ` · ${responsableNombre}` : ''}${venceEl ? ` · vence ${venceEl}` : ''}`,
  })
  return tareasDe(clienteId)
}

export function cambiarEstadoDeTarea(tareaId: number, estado: EstadoTarea, actor: SesionUsuario): TareaDeCliente[] {
  const id = enteroPositivo(tareaId, 'La tarea')
  if (typeof estado !== 'string' || !(estado in NOMBRE_ESTADO_TAREA)) {
    throw new ErrorDeNegocio('Elegí un estado de la lista.')
  }
  const tarea = db().prepare('SELECT id, cliente_id, titulo, estado FROM tareas WHERE id = ?').get(id) as
    | { id: number; cliente_id: number | null; titulo: string; estado: EstadoTarea }
    | undefined
  if (!tarea) throw new ErrorDeNegocio('No se encontró esa tarea.')

  if (tarea.estado !== estado) {
    db().prepare('UPDATE tareas SET estado = ?, actualizado_en = ? WHERE id = ?').run(estado, ahoraIso(), id)
    registrarCambio(actor, {
      accion: 'edicion',
      tabla: 'tareas',
      registroId: id,
      campo: 'ESTADO DE LA TAREA',
      valorAnterior: NOMBRE_ESTADO_TAREA[tarea.estado] ?? tarea.estado,
      valorNuevo: NOMBRE_ESTADO_TAREA[estado],
    })
  }

  // Una tarea puede no tener cliente (las del módulo de tareas suelto): en ese caso no hay lista de
  // la ficha que devolver.
  return tarea.cliente_id === null ? [] : tareasDe(tarea.cliente_id)
}
