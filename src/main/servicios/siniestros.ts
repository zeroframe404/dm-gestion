// Siniestros: el listado mensual con las mismas columnas de la hoja y, detrás de cada fila, una ficha
// con seguimiento —estado del trámite, línea de tiempo de observaciones, documentos y tareas.
//
// La pestaña SINIESTROS de la hoja SÍ es una tabla por fila (sus encabezados están en la fila 4 y el
// importador ya la sabe leer), así que todo lo que se carga acá viaja allá como cualquier otra fila.
// Lo que no tiene lugar en la hoja —la línea de tiempo, los adjuntos y las tareas— vive sólo en
// DM Gestión: son tablas propias, y la columna OBSERVACIONES de la hoja recibe el resumen de la línea
// de tiempo para que quien mire la planilla vea lo mismo que quien mira la ficha.
import { hoyLocal } from '../../shared/semaforo'
import { estadoTextoDiferente, mencionaRobo, normalizarEstadoSiniestro } from '../../shared/siniestros'
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { mismaSucursal } from '../../shared/sucursales'
import {
  ESTADOS_DE_SINIESTRO,
  type AdjuntoDeSiniestro,
  type CandidatoDeSiniestro,
  type DatosDeSiniestro,
  type DatosDeTareaDeSiniestro,
  type EstadoSiniestro,
  type EstadoTarea,
  type FichaSiniestro,
  type FilaSiniestro,
  type FiltrosSiniestros,
  type ListadoSiniestros,
  type ObservacionDeSiniestro,
  type SesionUsuario,
  type SiniestroDeCliente,
  type TareaDeCliente,
} from '../../shared/tipos'
import { db } from '../db/base'
import {
  ahoraIso,
  generarId,
  interpretarFecha,
  limpiar,
  mismoTexto,
  normalizarDocumento,
  normalizarPatente,
  normalizarTexto,
  sinRepetirTexto,
} from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { borrarArchivoDeAdjunto, carpetaDeAdjuntos, copiarAdjunto, rutaDeAdjunto, subirAdjuntoADrive } from './adjuntos'
import { avisarTareaCompletada } from './avisos'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { nombreDePestana } from './hojas'
import { polizasDeCliente } from './polizas'
import { dadorDeTokenDeGoogle } from './sincronizacion'
import { sucursalesParaElegir } from './sucursales'
import { registrarTareaNueva } from './tareas'
import { enteroPositivo, objeto, texto } from './validacion'

/** Cómo se llama en la hoja la pestaña de siniestros: la que ya existe, o el nombre por defecto. */
function pestanaDeSiniestros(): string {
  return nombreDePestana('SINIESTROS', 'SINIESTROS')
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * El mes de un siniestro es el de su FECHA DE CARGA: así se arma la lista mensual que ya conocen, la
 * misma que en la hoja. Los que no la tienen (vinieron de la hoja sin esa columna) caen en el mes en
 * que ocurrió el siniestro, que es lo más cercano.
 */
const PERIODO = `substr(COALESCE(s.fecha_carga_iso, s.fecha_iso), 1, 7)`

const SELECT_SINIESTRO = `
  SELECT s.id, s.fila_id, s.sucursal_texto AS sucursal, s.compania, s.numero_poliza, s.cobertura,
         s.cliente_id, COALESCE(s.cliente_nombre, cl.nombre) AS cliente_nombre,
         COALESCE(s.documento, cl.documento) AS documento, cl.telefono,
         s.patente, s.fecha_carga, s.fecha_carga_iso, s.fecha, s.fecha_iso,
         s.numero_siniestro, s.descripcion, s.observaciones, s.importe, s.estado, s.creado_en_la_app,
         ${PERIODO} AS periodo,
         (SELECT COUNT(*) FROM siniestro_observaciones o WHERE o.siniestro_id = s.id) AS observaciones_cargadas,
         (SELECT COUNT(*) FROM siniestro_adjuntos a WHERE a.siniestro_id = s.id) AS adjuntos,
         (SELECT COUNT(*) FROM tareas t WHERE t.siniestro_id = s.id AND t.estado <> 'hecha') AS tareas_pendientes
  FROM siniestros s
  LEFT JOIN clientes cl ON cl.id = s.cliente_id
`

interface FilaCruda {
  id: number
  fila_id: string
  sucursal: string | null
  compania: string | null
  numero_poliza: string | null
  cobertura: string | null
  cliente_id: number | null
  cliente_nombre: string | null
  documento: string | null
  telefono: string | null
  patente: string | null
  fecha_carga: string | null
  fecha_carga_iso: string | null
  fecha: string | null
  fecha_iso: string | null
  numero_siniestro: string | null
  descripcion: string | null
  observaciones: string | null
  importe: string | null
  estado: string | null
  creado_en_la_app: number
  periodo: string | null
  observaciones_cargadas: number
  adjuntos: number
  tareas_pendientes: number
}

function aFila(f: FilaCruda): FilaSiniestro {
  return {
    id: f.id,
    filaId: f.fila_id,
    sucursal: f.sucursal,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    cobertura: f.cobertura,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    documento: f.documento,
    telefono: f.telefono,
    patente: f.patente,
    fechaCarga: f.fecha_carga,
    fechaCargaIso: f.fecha_carga_iso,
    fecha: f.fecha,
    fechaIso: f.fecha_iso,
    numeroSiniestro: f.numero_siniestro,
    descripcion: f.descripcion,
    observaciones: f.observaciones,
    importe: f.importe,
    estado: normalizarEstadoSiniestro(f.estado),
    estadoTexto: estadoTextoDiferente(f.estado) ? f.estado : null,
    esRobo: mencionaRobo(f.descripcion, f.observaciones, f.numero_siniestro),
    observacionesCargadas: f.observaciones_cargadas,
    adjuntos: f.adjuntos,
    tareasPendientes: f.tareas_pendientes,
    creadoEnLaApp: f.creado_en_la_app === 1,
  }
}

/** Los siniestros del cliente, para la pestaña Siniestros de su ficha. */
export function siniestrosDeCliente(clienteId: number): SiniestroDeCliente[] {
  const filas = db()
    .prepare(
      `${SELECT_SINIESTRO}
       WHERE s.cliente_id = @cliente
          OR s.poliza_id IN (SELECT id FROM polizas WHERE cliente_id = @cliente)
       ORDER BY COALESCE(s.fecha_iso, s.fecha) DESC, s.id DESC`,
    )
    .all({ cliente: clienteId }) as FilaCruda[]
  return filas.map((f) => ({
    id: f.id,
    fecha: f.fecha_iso ?? f.fecha,
    numeroSiniestro: f.numero_siniestro,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    patente: f.patente,
    descripcion: f.descripcion,
    estado: f.estado,
    importe: f.importe,
  }))
}

function normalizarFiltros(filtros: unknown): FiltrosSiniestros {
  const f = objeto(filtros, 'Los filtros')
  const estado = limpiar(f.estado).toUpperCase()
  return {
    periodo: /^\d{4}-\d{2}$/.test(limpiar(f.periodo)) ? limpiar(f.periodo) : '',
    busqueda: limpiar(f.busqueda).slice(0, 100),
    sucursales: listaDeFiltro(f.sucursales).map((v) => v.slice(0, 80)),
    companias: listaDeFiltro(f.companias).map((v) => v.slice(0, 80)),
    estado: (ESTADOS_DE_SINIESTRO as readonly string[]).includes(estado) ? (estado as EstadoSiniestro) : '',
    soloRobos: f.soloRobos === true,
  }
}

export function listarSiniestros(filtros: unknown): ListadoSiniestros {
  const f = normalizarFiltros(filtros)
  const todas = (db().prepare(`${SELECT_SINIESTRO} ORDER BY COALESCE(s.fecha_carga_iso, s.fecha_iso, s.fecha) DESC, s.id DESC`).all() as FilaCruda[]).map(
    (cruda) => ({ cruda, fila: aFila(cruda) }),
  )

  const periodos = [...new Set(todas.map((s) => s.cruda.periodo).filter((p): p is string => !!p))].sort().reverse()
  // Las cuatro de la agencia más las que traen los siniestros cargados: una sucursal sin ningún
  // siniestro igual tiene que estar en el filtro, aunque sólo sea para ver que no tiene ninguno.
  const sucursales = sucursalesParaElegir(todas.map((s) => s.fila.sucursal))
  const companias = sinRepetirTexto(todas.map((s) => s.fila.compania))

  const busqueda = normalizarTexto(f.busqueda)
  const documento = normalizarDocumento(f.busqueda)
  const patente = normalizarPatente(f.busqueda)
  const coincide = (fila: FilaSiniestro): boolean => {
    if (!busqueda) return true
    if (documento.length >= 6 && normalizarDocumento(fila.documento) === documento) return true
    if (patente && normalizarPatente(fila.patente) === patente) return true
    const campos = [fila.clienteNombre, fila.numeroSiniestro, fila.numeroPoliza, fila.patente, fila.documento, fila.descripcion, fila.compania]
    return campos.some((valor) => normalizarTexto(valor).includes(busqueda))
  }

  // Todos los filtros menos el de estado: los contadores tienen que decir cuántos hay de cada estado
  // dentro de lo que se está mirando, si no tocar un contador vaciaría los demás.
  const sinEstado = todas.filter(
    ({ fila, cruda }) =>
      (!f.periodo || cruda.periodo === f.periodo) &&
      coincideAlguno(f.sucursales, fila.sucursal, mismaSucursal) &&
      coincideAlguno(f.companias, fila.compania, mismoTexto) &&
      (!f.soloRobos || fila.esRobo) &&
      coincide(fila),
  )

  const porEstado = { CARGADO: 0, 'EN TRÁMITE': 0, 'ESPERANDO DOCUMENTACIÓN': 0, CERRADO: 0 } as Record<EstadoSiniestro, number>
  for (const { fila } of sinEstado) porEstado[fila.estado]++

  return {
    filas: sinEstado.filter(({ fila }) => !f.estado || fila.estado === f.estado).map(({ fila }) => fila),
    periodos,
    sucursales,
    companias,
    total: todas.length,
    porEstado,
    hoy: hoyLocal(),
  }
}

function buscarSiniestro(siniestroId: number): FilaCruda {
  const fila = db().prepare(`${SELECT_SINIESTRO} WHERE s.id = ?`).get(siniestroId) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró ese siniestro.')
  return fila
}

function observacionesDe(siniestroId: number): ObservacionDeSiniestro[] {
  return (
    db()
      .prepare(`SELECT id, texto, usuario_nombre, creado_en FROM siniestro_observaciones WHERE siniestro_id = ? ORDER BY id DESC`)
      .all(siniestroId) as Array<{ id: number; texto: string; usuario_nombre: string; creado_en: string }>
  ).map((o) => ({ id: o.id, texto: o.texto, usuarioNombre: o.usuario_nombre, creadoEn: o.creado_en }))
}

function adjuntosDe(siniestroId: number): AdjuntoDeSiniestro[] {
  return (
    db()
      .prepare(
        `SELECT id, nombre, tamano, creado_en, usuario_nombre, drive_id, drive_error
         FROM siniestro_adjuntos WHERE siniestro_id = ? ORDER BY id DESC`,
      )
      .all(siniestroId) as Array<{
      id: number
      nombre: string
      tamano: number
      creado_en: string
      usuario_nombre: string
      drive_id: string | null
      drive_error: string | null
    }>
  ).map((a) => ({
    id: a.id,
    nombre: a.nombre,
    tamano: a.tamano,
    creadoEn: a.creado_en,
    usuarioNombre: a.usuario_nombre,
    enDrive: a.drive_id !== null,
    errorDeDrive: a.drive_error,
  }))
}

function tareasDe(siniestroId: number): TareaDeCliente[] {
  return (
    db()
      .prepare(
        `SELECT id, titulo, detalle, responsable_nombre, vence_el, estado, creado_por, creado_en
         FROM tareas WHERE siniestro_id = ?
         ORDER BY CASE estado WHEN 'hecha' THEN 1 ELSE 0 END, vence_el IS NULL, vence_el, id DESC`,
      )
      .all(siniestroId) as Array<{
      id: number
      titulo: string
      detalle: string | null
      responsable_nombre: string | null
      vence_el: string | null
      estado: string
      creado_por: string
      creado_en: string
    }>
  ).map((t) => ({
    id: t.id,
    titulo: t.titulo,
    detalle: t.detalle,
    responsableNombre: t.responsable_nombre,
    venceEl: t.vence_el,
    estado: t.estado as TareaDeCliente['estado'],
    creadoPor: t.creado_por,
    creadoEn: t.creado_en,
  }))
}

export function fichaDeSiniestro(siniestroId: number): FichaSiniestro {
  const cruda = buscarSiniestro(siniestroId)
  return {
    siniestro: aFila(cruda),
    observaciones: observacionesDe(siniestroId),
    adjuntos: adjuntosDe(siniestroId),
    tareas: tareasDe(siniestroId),
    polizas: cruda.cliente_id === null ? [] : polizasDeCliente(cruda.cliente_id),
    responsables: db().prepare('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre').all() as Array<{ id: number; nombre: string }>,
    carpetaDeAdjuntos: carpetaDeAdjuntos(),
  }
}

// ---------------------------------------------------------------------------
// Alta rápida: buscar la póliza y que los datos se completen solos
// ---------------------------------------------------------------------------

/**
 * Busca por patente, nombre, documento o número de póliza y devuelve las pólizas candidatas con todo lo
 * que hace falta para llenar el alta: compañía, número, cobertura, patente y sucursal. Se ofrecen
 * primero las activas, que son las que se pueden denunciar.
 */
export function buscarParaSiniestro(busqueda: string): CandidatoDeSiniestro[] {
  const termino = limpiar(busqueda)
  if (termino.length < 2) return []
  const texto = normalizarTexto(termino)
  const documento = normalizarDocumento(termino)
  const patente = normalizarPatente(termino)

  const filas = db()
    .prepare(
      `SELECT p.id AS poliza_id, p.compania, p.numero, p.cobertura, p.activa, p.vigencia_hasta_iso,
              cl.id AS cliente_id, cl.nombre, cl.documento, cl.telefono, cl.sucursal_texto AS sucursal,
              v.patente, v.marca, v.modelo, v.tipo
       FROM polizas p
       JOIN clientes cl ON cl.id = p.cliente_id
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       WHERE (@patente <> '' AND v.patente_normalizada = @patente)
          OR (@documento <> '' AND cl.documento_normalizado = @documento)
          OR (@texto <> '' AND (
                UPPER(cl.nombre) LIKE '%' || @textoCrudo || '%'
             OR UPPER(COALESCE(p.numero, '')) LIKE '%' || @textoCrudo || '%'
             OR UPPER(COALESCE(v.patente, '')) LIKE '%' || @textoCrudo || '%'))
       ORDER BY p.activa DESC, cl.nombre, p.id
       LIMIT 25`,
    )
    .all({ patente, documento, texto, textoCrudo: termino.toUpperCase() }) as Array<{
    poliza_id: number
    compania: string | null
    numero: string | null
    cobertura: string | null
    activa: number
    vigencia_hasta_iso: string | null
    cliente_id: number
    nombre: string
    documento: string | null
    telefono: string | null
    sucursal: string | null
    patente: string | null
    marca: string | null
    modelo: string | null
    tipo: string | null
  }>

  const hoy = hoyLocal()
  return filas.map((f) => ({
    clienteId: f.cliente_id,
    clienteNombre: f.nombre,
    documento: f.documento,
    telefono: f.telefono,
    sucursal: f.sucursal,
    polizaId: f.poliza_id,
    compania: f.compania,
    numeroPoliza: f.numero,
    cobertura: f.cobertura,
    patente: f.patente,
    vehiculo: [f.marca, f.modelo].filter(Boolean).join(' ') || f.tipo,
    estadoPoliza: f.activa !== 1 ? 'BAJA' : f.vigencia_hasta_iso && f.vigencia_hasta_iso < hoy ? 'VENCIDA' : 'ACTIVA',
  }))
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

/** Los campos del siniestro con los nombres que entiende la sincronización. */
function camposParaLaHoja(fila: FilaCruda): Record<string, string> {
  return {
    fecha: fila.fecha ?? '',
    fecha_carga: fila.fecha_carga ?? '',
    nombre: fila.cliente_nombre ?? '',
    documento: fila.documento ?? '',
    sucursal: fila.sucursal ?? '',
    patente: fila.patente ?? '',
    compania: fila.compania ?? '',
    numero_poliza: fila.numero_poliza ?? '',
    cobertura: fila.cobertura ?? '',
    numero_siniestro: fila.numero_siniestro ?? '',
    descripcion: fila.descripcion ?? '',
    estado: fila.estado ?? '',
    importe: fila.importe ?? '',
    observaciones: fila.observaciones ?? '',
  }
}

function fechaObligatoria(valor: string, campo: string): { texto: string; iso: string } {
  const escrito = limpiar(valor)
  if (!escrito) throw new ErrorDeNegocio(`Cargá ${campo}.`)
  const anio = new Date().getFullYear()
  const fecha = interpretarFecha(escrito, anio, anio)
  if (!fecha.iso) throw new ErrorDeNegocio(`«${escrito}» no es una fecha válida. Usá el formato día/mes/año.`)
  return { texto: escrito, iso: fecha.iso }
}

/**
 * Guarda el siniestro y lo encola para la hoja. Devuelve su id.
 *
 * Es el camino único de las dos altas: la rápida del módulo Siniestros y la de la ficha del cliente.
 */
function insertarSiniestro(datos: DatosDeSiniestro, actor: SesionUsuario): number {
  const d = objeto(datos, 'Los datos del siniestro')
  const clienteId = enteroPositivo(d.clienteId, 'El cliente')
  const descripcion = texto(d.descripcion, 'La descripción del siniestro', 1, 500)
  const numero = limpiar(d.numeroSiniestro)
  const importe = limpiar(d.importe)
  const observaciones = limpiar(d.observaciones)
  const estado = normalizarEstadoSiniestro(limpiar(d.estado) || 'CARGADO')

  const cliente = db().prepare('SELECT id, nombre, documento, sucursal_texto FROM clientes WHERE id = ?').get(clienteId) as
    | { id: number; nombre: string; documento: string | null; sucursal_texto: string | null }
    | undefined
  if (!cliente) throw new ErrorDeNegocio('No se encontró ese cliente.')

  // La fecha del siniestro es obligatoria: uno sin fecha no sirve para reclamar nada. La de carga, no:
  // si no viene es hoy, que es cuando se está cargando.
  const fecha = fechaObligatoria(String(d.fecha ?? ''), 'la fecha del siniestro')
  const cargaEscrita = limpiar(d.fechaCarga)
  const carga = cargaEscrita ? fechaObligatoria(cargaEscrita, 'la fecha de carga') : { texto: hoyLocal(), iso: hoyLocal() }

  // La póliza es optativa (a veces se denuncia antes de saber cuál), pero si viene tiene que ser del cliente.
  let poliza: { id: number; compania: string | null; numero: string | null; cobertura: string | null; patente: string | null } | null = null
  if (d.polizaId !== null && d.polizaId !== undefined) {
    const polizaId = enteroPositivo(d.polizaId, 'La póliza')
    const encontrada = db()
      .prepare(
        `SELECT p.id, p.compania, p.numero, p.cobertura, v.patente
         FROM polizas p LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
         WHERE p.id = ? AND p.cliente_id = ?`,
      )
      .get(polizaId, clienteId) as
      | { id: number; compania: string | null; numero: string | null; cobertura: string | null; patente: string | null }
      | undefined
    if (!encontrada) throw new ErrorDeNegocio('Esa póliza no es de este cliente.')
    poliza = encontrada
  }

  const filaId = generarId()
  const pestana = pestanaDeSiniestros()
  const ahora = ahoraIso()
  const sucursal = limpiar(d.sucursal) || cliente.sucursal_texto || actor.sucursal.nombre

  const id = db().transaction(() => {
    const resultado = db()
      .prepare(
        `INSERT INTO siniestros (fila_id, pestana, cliente_id, poliza_id, fecha, fecha_iso, fecha_carga, fecha_carga_iso,
                                 cliente_nombre, documento, patente, sucursal_texto, compania, numero_poliza, cobertura,
                                 numero_siniestro, descripcion, estado, importe, observaciones, creado_en_la_app,
                                 creado_en, actualizado_en)
         VALUES (@fila_id, @pestana, @cliente_id, @poliza_id, @fecha, @fecha_iso, @fecha_carga, @fecha_carga_iso,
                 @cliente_nombre, @documento, @patente, @sucursal_texto, @compania, @numero_poliza, @cobertura,
                 @numero_siniestro, @descripcion, @estado, @importe, @observaciones, 1, @ahora, @ahora)`,
      )
      .run({
        fila_id: filaId,
        pestana,
        cliente_id: clienteId,
        poliza_id: poliza?.id ?? null,
        fecha: fecha.texto,
        fecha_iso: fecha.iso,
        fecha_carga: carga.texto,
        fecha_carga_iso: carga.iso,
        cliente_nombre: cliente.nombre,
        documento: cliente.documento,
        patente: poliza?.patente ?? null,
        sucursal_texto: sucursal,
        compania: poliza?.compania ?? null,
        numero_poliza: poliza?.numero ?? null,
        cobertura: poliza?.cobertura ?? null,
        numero_siniestro: numero || null,
        descripcion,
        estado,
        importe: importe || null,
        observaciones: observaciones || null,
        ahora,
      })

    // Igual que con las pólizas: primero se anota como fila conocida y después se encola, si no la
    // bajada la ve como venida de otra computadora y pide una importación completa cada cinco minutos.
    registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'SINIESTROS', periodo: null })
    return Number(resultado.lastInsertRowid)
  })()

  encolar({ operacion: 'crear', pestana, filaId, campos: camposParaLaHoja(buscarSiniestro(id)) }, actor)

  registrarCambio(actor, {
    accion: 'siniestro',
    tabla: 'siniestros',
    registroId: id,
    filaId,
    campo: 'SINIESTRO',
    valorAnterior: null,
    valorNuevo: `${fecha.texto} · ${descripcion}${numero ? ` · N.º ${numero}` : ''}`,
  })

  // La primera observación de la línea de tiempo es la denuncia misma: así la ficha nunca arranca vacía
  // y se ve desde cuándo y con quién empezó el trámite.
  anotarObservacion(id, `Siniestro cargado: ${descripcion}`, actor)
  if (observaciones) anotarObservacion(id, observaciones, actor)

  return id
}

/** Alta desde la ficha del cliente: devuelve la lista de sus siniestros, que es lo que la ficha muestra. */
export function crearSiniestro(datos: DatosDeSiniestro, actor: SesionUsuario): SiniestroDeCliente[] {
  insertarSiniestro(datos, actor)
  return siniestrosDeCliente(enteroPositivo(objeto(datos).clienteId, 'El cliente'))
}

/** Alta rápida desde el módulo Siniestros: devuelve la ficha recién creada, lista para seguir cargándola. */
export function altaDeSiniestro(datos: DatosDeSiniestro, actor: SesionUsuario): FichaSiniestro {
  return fichaDeSiniestro(insertarSiniestro(datos, actor))
}

// ---------------------------------------------------------------------------
// La ficha: estado, línea de tiempo, documentos y tareas
// ---------------------------------------------------------------------------

/** Sube a la hoja los campos que cambiaron. */
function sincronizar(siniestroId: number, campos: Record<string, string>, actor: SesionUsuario): void {
  const fila = buscarSiniestro(siniestroId)
  encolar({ operacion: 'actualizar', pestana: pestanaDeSiniestros(), filaId: fila.fila_id, campos }, actor)
}

export function cambiarEstadoDeSiniestro(siniestroId: number, estado: unknown, actor: SesionUsuario): FichaSiniestro {
  const id = enteroPositivo(siniestroId, 'El siniestro')
  const fila = buscarSiniestro(id)
  const escrito = limpiar(estado).toUpperCase()
  if (!(ESTADOS_DE_SINIESTRO as readonly string[]).includes(escrito)) throw new ErrorDeNegocio('Ese estado no es válido.')
  const nuevo = escrito as EstadoSiniestro
  if (normalizarEstadoSiniestro(fila.estado) === nuevo && !estadoTextoDiferente(fila.estado)) return fichaDeSiniestro(id)

  db().prepare('UPDATE siniestros SET estado = ?, actualizado_en = ? WHERE id = ?').run(nuevo, ahoraIso(), id)
  sincronizar(id, { estado: nuevo }, actor)
  registrarCambio(actor, {
    accion: 'siniestro',
    tabla: 'siniestros',
    registroId: id,
    filaId: fila.fila_id,
    campo: 'ESTADO',
    valorAnterior: fila.estado,
    valorNuevo: nuevo,
  })
  // El cambio de estado es parte del relato del trámite: queda en la línea de tiempo.
  anotarObservacion(id, `Estado: ${nuevo}`, actor)
  return fichaDeSiniestro(id)
}

/** Qué campos de la ficha se corrigen a mano y cómo se llaman en la hoja. */
const CAMPOS_EDITABLES: Record<string, { columna: string; campoDeLaHoja: string; nombre: string; esFecha?: boolean }> = {
  numeroSiniestro: { columna: 'numero_siniestro', campoDeLaHoja: 'numero_siniestro', nombre: 'N° SINIESTRO' },
  descripcion: { columna: 'descripcion', campoDeLaHoja: 'descripcion', nombre: 'DESCRIPCION' },
  importe: { columna: 'importe', campoDeLaHoja: 'importe', nombre: 'IMPORTE' },
  cobertura: { columna: 'cobertura', campoDeLaHoja: 'cobertura', nombre: 'COBERTURA' },
  sucursal: { columna: 'sucursal_texto', campoDeLaHoja: 'sucursal', nombre: 'SUCURSAL' },
  patente: { columna: 'patente', campoDeLaHoja: 'patente', nombre: 'PATENTE' },
  fecha: { columna: 'fecha', campoDeLaHoja: 'fecha', nombre: 'FECHA DEL SINIESTRO', esFecha: true },
  fechaCarga: { columna: 'fecha_carga', campoDeLaHoja: 'fecha_carga', nombre: 'FECHA DE CARGA', esFecha: true },
}

/**
 * Corrige un campo de la ficha. El número de siniestro es el caso de todos los días: la compañía lo da
 * dos días después de la denuncia y hay que poderlo completar sin cargar todo de nuevo.
 */
export function editarSiniestro(siniestroId: number, campo: unknown, valor: unknown, actor: SesionUsuario): FichaSiniestro {
  const id = enteroPositivo(siniestroId, 'El siniestro')
  const clave = limpiar(campo)
  const destino = CAMPOS_EDITABLES[clave]
  if (!destino) throw new ErrorDeNegocio('Ese campo no se puede editar desde la ficha.')
  const fila = buscarSiniestro(id)
  const nuevo = limpiar(valor).slice(0, 500)

  const anterior = limpiar((fila as unknown as Record<string, unknown>)[destino.columna === 'sucursal_texto' ? 'sucursal' : destino.columna])
  if (nuevo === anterior) return fichaDeSiniestro(id)

  const derivadas: Record<string, string | null> = {}
  if (destino.esFecha) {
    const anio = new Date().getFullYear()
    const fecha = nuevo ? interpretarFecha(nuevo, anio, anio) : { iso: null }
    if (nuevo && !fecha.iso) throw new ErrorDeNegocio(`«${nuevo}» no es una fecha válida. Usá el formato día/mes/año.`)
    derivadas[`${destino.columna}_iso`] = fecha.iso
  }
  const asignaciones = [`${destino.columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`)]
  db()
    .prepare(`UPDATE siniestros SET ${asignaciones.join(', ')}, actualizado_en = @ahora WHERE id = @id`)
    .run({ valor: nuevo || null, ...derivadas, ahora: ahoraIso(), id })

  sincronizar(id, { [destino.campoDeLaHoja]: nuevo }, actor)
  registrarCambio(actor, {
    accion: 'siniestro',
    tabla: 'siniestros',
    registroId: id,
    filaId: fila.fila_id,
    campo: destino.nombre,
    valorAnterior: anterior || null,
    valorNuevo: nuevo || null,
  })
  return fichaDeSiniestro(id)
}

/** Largo máximo de lo que se manda a la columna OBSERVACIONES de la hoja: es una celda, no un libro. */
const LARGO_OBSERVACIONES_EN_LA_HOJA = 900

/**
 * Arma lo que va a la columna OBSERVACIONES de la hoja: la línea de tiempo de la ficha, lo más nuevo
 * primero, con su fecha. Quien mire la planilla ve lo mismo que quien mira la ficha, sin tener que
 * entrar a la aplicación.
 */
export function observacionesParaLaHoja(siniestroId: number): string {
  const entradas = observacionesDe(siniestroId).map((o) => `${o.creadoEn.slice(8, 10)}/${o.creadoEn.slice(5, 7)} ${o.usuarioNombre}: ${o.texto}`)
  const junto = entradas.join(' · ')
  return junto.length > LARGO_OBSERVACIONES_EN_LA_HOJA ? `${junto.slice(0, LARGO_OBSERVACIONES_EN_LA_HOJA - 1)}…` : junto
}

/** Escribe la entrada en la línea de tiempo y deja la hoja al día. No valida: es de uso interno. */
function anotarObservacion(siniestroId: number, textoDeLaObservacion: string, actor: SesionUsuario): void {
  db()
    .prepare(
      `INSERT INTO siniestro_observaciones (siniestro_id, texto, usuario_id, usuario_nombre, creado_en)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(siniestroId, textoDeLaObservacion, actor.id, actor.nombre, ahoraIso())

  const resumen = observacionesParaLaHoja(siniestroId)
  db().prepare('UPDATE siniestros SET observaciones = ?, actualizado_en = ? WHERE id = ?').run(resumen, ahoraIso(), siniestroId)
  sincronizar(siniestroId, { observaciones: resumen }, actor)
}

export function agregarObservacion(siniestroId: number, textoDeLaObservacion: unknown, actor: SesionUsuario): FichaSiniestro {
  const id = enteroPositivo(siniestroId, 'El siniestro')
  buscarSiniestro(id)
  const limpio = texto(textoDeLaObservacion, 'La observación', 1, 1000)
  anotarObservacion(id, limpio, actor)
  registrarCambio(actor, {
    accion: 'siniestro',
    tabla: 'siniestro_observaciones',
    registroId: id,
    filaId: buscarSiniestro(id).fila_id,
    campo: 'OBSERVACION',
    valorAnterior: null,
    valorNuevo: limpio.slice(0, 200),
  })
  return fichaDeSiniestro(id)
}

// --- Documentos ---

/**
 * Copia los archivos a la carpeta del siniestro y, si hay conexión con Google, sube además una copia al
 * Drive. Un fallo de Drive no pierde nada: el archivo local ya está y el motivo queda a la vista.
 */
export async function agregarAdjuntos(siniestroId: number, rutas: unknown, actor: SesionUsuario): Promise<FichaSiniestro> {
  const id = enteroPositivo(siniestroId, 'El siniestro')
  const fila = buscarSiniestro(id)
  if (!Array.isArray(rutas) || rutas.length === 0) throw new ErrorDeNegocio('No elegiste ningún archivo.')

  const dameToken = dadorDeTokenDeGoogle()
  for (const ruta of rutas) {
    const copia = copiarAdjunto(id, texto(ruta, 'La ruta del archivo', 1, 4096))
    const drive = await subirAdjuntoADrive(dameToken, id, copia)
    db()
      .prepare(
        `INSERT INTO siniestro_adjuntos (siniestro_id, nombre, archivo, tamano, drive_id, drive_error,
                                         usuario_id, usuario_nombre, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, copia.nombre, copia.archivo, copia.tamano, drive.driveId, drive.error, actor.id, actor.nombre, ahoraIso())

    registrarCambio(actor, {
      accion: 'siniestro',
      tabla: 'siniestro_adjuntos',
      registroId: id,
      filaId: fila.fila_id,
      campo: 'ADJUNTO',
      valorAnterior: null,
      valorNuevo: copia.nombre,
    })
    anotarObservacion(id, `Se adjuntó «${copia.nombre}»`, actor)
  }
  return fichaDeSiniestro(id)
}

/** La ruta del archivo en el disco, para que el proceso principal lo abra con el programa del sistema. */
export function rutaDelAdjunto(adjuntoId: number): string {
  const id = enteroPositivo(adjuntoId, 'El documento')
  const adjunto = db().prepare('SELECT archivo FROM siniestro_adjuntos WHERE id = ?').get(id) as { archivo: string } | undefined
  if (!adjunto) throw new ErrorDeNegocio('No se encontró ese documento.')
  return rutaDeAdjunto(adjunto.archivo)
}

export function borrarAdjunto(adjuntoId: number, actor: SesionUsuario): FichaSiniestro {
  const id = enteroPositivo(adjuntoId, 'El documento')
  const adjunto = db().prepare('SELECT id, siniestro_id, nombre, archivo FROM siniestro_adjuntos WHERE id = ?').get(id) as
    | { id: number; siniestro_id: number; nombre: string; archivo: string }
    | undefined
  if (!adjunto) throw new ErrorDeNegocio('No se encontró ese documento.')

  db().prepare('DELETE FROM siniestro_adjuntos WHERE id = ?').run(id)
  borrarArchivoDeAdjunto(adjunto.archivo)
  registrarCambio(actor, {
    accion: 'siniestro',
    tabla: 'siniestro_adjuntos',
    registroId: adjunto.siniestro_id,
    filaId: buscarSiniestro(adjunto.siniestro_id).fila_id,
    campo: 'ADJUNTO BORRADO',
    valorAnterior: adjunto.nombre,
    valorNuevo: null,
  })
  anotarObservacion(adjunto.siniestro_id, `Se borró el documento «${adjunto.nombre}»`, actor)
  return fichaDeSiniestro(adjunto.siniestro_id)
}

// --- Tareas vinculadas ---

export function crearTareaDeSiniestro(datos: DatosDeTareaDeSiniestro, actor: SesionUsuario): FichaSiniestro {
  const d = objeto(datos, 'Los datos de la tarea')
  const siniestroId = enteroPositivo(d.siniestroId, 'El siniestro')
  const fila = buscarSiniestro(siniestroId)
  const titulo = texto(d.titulo, 'El título de la tarea', 1, 160)
  const detalle = limpiar(d.detalle).slice(0, 2000)
  const venceEl = limpiar(d.venceEl)
  if (venceEl && !/^\d{4}-\d{2}-\d{2}$/.test(venceEl)) throw new ErrorDeNegocio('La fecha de vencimiento no es válida.')

  let responsableId: number | null = null
  let responsableNombre: string | null = null
  if (d.responsableId !== null && d.responsableId !== undefined) {
    responsableId = enteroPositivo(d.responsableId, 'El responsable')
    const usuario = db().prepare('SELECT nombre FROM usuarios WHERE id = ? AND activo = 1').get(responsableId) as { nombre: string } | undefined
    if (!usuario) throw new ErrorDeNegocio('El responsable que elegiste no existe o está dado de baja.')
    responsableNombre = usuario.nombre
  }

  const ahora = ahoraIso()
  const resultado = db()
    .prepare(
      `INSERT INTO tareas (titulo, detalle, cliente_id, poliza_id, siniestro_id, responsable_id, responsable_nombre,
                           sucursal_texto, vence_el, prioridad, estado, creado_por, creado_por_id, visto_en,
                           creado_en, actualizado_en)
       VALUES (@titulo, @detalle, @cliente_id, NULL, @siniestro_id, @responsable_id, @responsable_nombre,
               @sucursal, @vence_el, 'NORMAL', 'pendiente', @creado_por, @creado_por_id, @visto_en, @ahora, @ahora)`,
    )
    .run({
      titulo,
      detalle: detalle || null,
      cliente_id: fila.cliente_id,
      siniestro_id: siniestroId,
      responsable_id: responsableId,
      responsable_nombre: responsableNombre,
      sucursal: limpiar(fila.sucursal) || actor.sucursal.nombre,
      vence_el: venceEl || null,
      creado_por: actor.nombre,
      creado_por_id: actor.id,
      // La tarea que me pongo yo mismo no es una novedad: no enciende mi propia campana.
      visto_en: responsableId === null || responsableId === actor.id ? ahora : null,
      ahora,
    })

  const tareaId = Number(resultado.lastInsertRowid)
  // Una tarea es la misma cosa venga de donde venga: también se anota en la pestaña APP TAREAS.
  registrarTareaNueva(tareaId, actor)
  registrarCambio(actor, {
    accion: 'tarea',
    tabla: 'tareas',
    registroId: tareaId,
    filaId: fila.fila_id,
    campo: 'TAREA',
    valorAnterior: null,
    valorNuevo: `${titulo}${responsableNombre ? ` · ${responsableNombre}` : ''}${venceEl ? ` · vence ${venceEl}` : ''}`,
  })
  return fichaDeSiniestro(siniestroId)
}

export function cambiarEstadoDeTareaDeSiniestro(tareaId: number, estado: unknown, actor: SesionUsuario): FichaSiniestro {
  const id = enteroPositivo(tareaId, 'La tarea')
  const valido: EstadoTarea[] = ['pendiente', 'en gestion', 'hecha']
  if (typeof estado !== 'string' || !valido.includes(estado as EstadoTarea)) throw new ErrorDeNegocio('Ese estado de tarea no es válido.')
  const tarea = db().prepare('SELECT id, siniestro_id, titulo, estado FROM tareas WHERE id = ?').get(id) as
    | { id: number; siniestro_id: number | null; titulo: string; estado: EstadoTarea }
    | undefined
  if (!tarea || tarea.siniestro_id === null) throw new ErrorDeNegocio('Esa tarea no es de un siniestro.')

  if (tarea.estado !== estado) {
    db().prepare('UPDATE tareas SET estado = ?, actualizado_en = ? WHERE id = ?').run(estado, ahoraIso(), id)
    registrarCambio(actor, {
      accion: 'tarea',
      tabla: 'tareas',
      registroId: id,
      filaId: buscarSiniestro(tarea.siniestro_id).fila_id,
      campo: 'ESTADO DE TAREA',
      valorAnterior: tarea.estado,
      valorNuevo: estado,
    })
    if (estado === 'hecha') avisarTareaCompletada({ tareaId: id, titulo: tarea.titulo, porQuien: actor.nombre })
  }
  return fichaDeSiniestro(tarea.siniestro_id)
}
