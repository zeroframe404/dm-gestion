// Tareas: los pendientes internos del equipo. «Llamar al perito», «pedir la cédula verde», «avisarle a
// la señora que vence el viernes».
//
// La tabla existe desde la Fase 5 (se crean desde la ficha del cliente y desde la del siniestro); la
// Fase 8 le pone el módulo propio: a quién le toca, para cuándo, con qué urgencia, comentarios,
// documentos y el aviso en la campana cuando te asignan algo.
//
// Una tarea puede colgar de una ficha (cliente, póliza, siniestro, renovación, lead o presupuesto) o
// ser suelta. El vínculo es lo que hace que sirva: desde la tarea se salta a la ficha y desde la ficha
// se ve lo que falta hacer.
import { aDia, diasEntre } from '../../shared/polizas'
import { hoyLocal } from '../../shared/semaforo'
import { coincideAlguno, listaDeFiltro, numerosDeFiltro } from '../../shared/filtros'
import { mismaSucursal } from '../../shared/sucursales'
import {
  ESTADOS_DE_TAREA,
  NOMBRE_ESTADO_TAREA,
  PRIORIDADES_DE_TAREA,
  type AdjuntoDeTarea,
  type AvisosDeTareas,
  type ComentarioDeTarea,
  type DatosDeEdicionDeTarea,
  type DatosDeTareaCompleta,
  type EstadoTarea,
  type FichaTarea,
  type FilaTarea,
  type FiltrosTareas,
  type ListadoTareas,
  type PrioridadTarea,
  type SesionUsuario,
  type VinculoDeTarea,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, generarId, limpiar, normalizarTexto } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { PESTANAS_DE_LA_APP } from '../sincronizacion/pestanasApp'
import {
  borrarArchivoDeAdjunto,
  carpetaDeAdjuntos,
  copiarAdjuntoEn,
  rutaDeAdjunto,
  subirAdjuntoADriveComo,
} from './adjuntos'
import { avisarTareaCompletada } from './avisos'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { nombreDePestana } from './hojas'
import { dadorDeTokenDeGoogle } from './sincronizacion'
import { sucursalesParaElegir } from './sucursales'
import { enteroPositivo, objeto, texto } from './validacion'

const PESTANA_POR_DEFECTO = PESTANAS_DE_LA_APP.find((p) => p.tipo === 'APP_TAREAS')!.titulo

export function pestanaDeTareas(): string {
  return nombreDePestana('APP_TAREAS', PESTANA_POR_DEFECTO)
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * El vínculo se resuelve en la misma consulta: qué ficha es y cómo se llama, para poder mostrarlo y
 * para poder saltar hasta allá sin una segunda vuelta a la base por cada tarea.
 */
const SELECT_TAREA = `
  SELECT t.id, t.titulo, t.detalle, t.responsable_id, t.responsable_nombre, t.sucursal_texto AS sucursal,
         t.vence_el, t.prioridad, t.estado, t.creado_por, t.creado_en, t.actualizado_en, t.visto_en,
         t.cliente_id, t.poliza_id, t.siniestro_id, t.renovacion_id, t.lead_id, t.presupuesto_id,
         t.fila_id, t.pestana,
         cl.nombre AS cliente_nombre,
         po.numero AS poliza_numero, po.compania AS poliza_compania,
         pcl.nombre AS poliza_cliente,
         si.numero_siniestro, si.descripcion AS siniestro_descripcion,
         le.nombre AS lead_nombre,
         pr.numero AS presupuesto_numero, pr.cliente_nombre AS presupuesto_cliente,
         (SELECT COUNT(*) FROM tarea_comentarios c WHERE c.tarea_id = t.id) AS comentarios,
         (SELECT COUNT(*) FROM tarea_adjuntos a WHERE a.tarea_id = t.id) AS adjuntos
  FROM tareas t
  LEFT JOIN clientes cl ON cl.id = t.cliente_id
  LEFT JOIN polizas po ON po.id = t.poliza_id
  LEFT JOIN clientes pcl ON pcl.id = po.cliente_id
  LEFT JOIN siniestros si ON si.id = t.siniestro_id
  LEFT JOIN leads le ON le.id = t.lead_id
  LEFT JOIN presupuestos pr ON pr.id = t.presupuesto_id
`

interface FilaCruda {
  id: number
  titulo: string
  detalle: string | null
  responsable_id: number | null
  responsable_nombre: string | null
  sucursal: string | null
  vence_el: string | null
  prioridad: string
  estado: string
  creado_por: string
  creado_en: string
  actualizado_en: string
  visto_en: string | null
  cliente_id: number | null
  poliza_id: number | null
  siniestro_id: number | null
  renovacion_id: number | null
  lead_id: number | null
  presupuesto_id: number | null
  fila_id: string | null
  pestana: string | null
  cliente_nombre: string | null
  poliza_numero: string | null
  poliza_compania: string | null
  poliza_cliente: string | null
  numero_siniestro: string | null
  siniestro_descripcion: string | null
  lead_nombre: string | null
  presupuesto_numero: string | null
  presupuesto_cliente: string | null
  comentarios: number
  adjuntos: number
}

/** De qué ficha cuelga la tarea y cómo se la nombra. El orden es de lo más específico a lo más general. */
function resolverVinculo(f: FilaCruda): { vinculo: VinculoDeTarea; vinculoId: number | null; vinculoTexto: string | null } {
  if (f.siniestro_id !== null) {
    const nombre = limpiar(f.numero_siniestro) || limpiar(f.siniestro_descripcion).slice(0, 60) || `Siniestro ${f.siniestro_id}`
    return { vinculo: 'siniestro', vinculoId: f.siniestro_id, vinculoTexto: `Siniestro ${nombre}` }
  }
  if (f.renovacion_id !== null && f.poliza_id !== null) {
    const poliza = limpiar(f.poliza_numero) || `N.º ${f.poliza_id}`
    return { vinculo: 'renovacion', vinculoId: f.renovacion_id, vinculoTexto: `Renovación ${poliza}` }
  }
  if (f.presupuesto_id !== null) {
    const nombre = limpiar(f.presupuesto_cliente)
    return {
      vinculo: 'presupuesto',
      vinculoId: f.presupuesto_id,
      vinculoTexto: `Presupuesto ${limpiar(f.presupuesto_numero)}${nombre ? ` · ${nombre}` : ''}`,
    }
  }
  if (f.lead_id !== null) return { vinculo: 'lead', vinculoId: f.lead_id, vinculoTexto: `Consulta de ${limpiar(f.lead_nombre)}` }
  if (f.poliza_id !== null) {
    const partes = [limpiar(f.poliza_compania), limpiar(f.poliza_numero)].filter(Boolean).join(' ')
    const de = limpiar(f.poliza_cliente) || limpiar(f.cliente_nombre)
    return { vinculo: 'poliza', vinculoId: f.poliza_id, vinculoTexto: `Póliza ${partes || f.poliza_id}${de ? ` · ${de}` : ''}` }
  }
  if (f.cliente_id !== null) return { vinculo: 'cliente', vinculoId: f.cliente_id, vinculoTexto: limpiar(f.cliente_nombre) || `Cliente ${f.cliente_id}` }
  return { vinculo: 'suelta', vinculoId: null, vinculoTexto: null }
}

function aFila(f: FilaCruda, hoy: string): FilaTarea {
  const { vinculo, vinculoId, vinculoTexto } = resolverVinculo(f)
  const dia = aDia(f.vence_el)
  const dias = dia === null ? null : diasEntre(hoy, f.vence_el ?? '')
  const abierta = f.estado !== 'hecha'
  return {
    id: f.id,
    titulo: f.titulo,
    detalle: f.detalle,
    responsableId: f.responsable_id,
    responsableNombre: f.responsable_nombre,
    sucursal: f.sucursal,
    venceEl: f.vence_el,
    prioridad: (f.prioridad as PrioridadTarea) ?? 'NORMAL',
    estado: f.estado as EstadoTarea,
    creadoPor: f.creado_por,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
    vinculo,
    vinculoId,
    vinculoTexto,
    clienteId: f.cliente_id,
    polizaId: f.poliza_id,
    siniestroId: f.siniestro_id,
    leadId: f.lead_id,
    presupuestoId: f.presupuesto_id,
    renovacionId: f.renovacion_id,
    comentarios: f.comentarios,
    adjuntos: f.adjuntos,
    diasParaVencer: dias,
    // Una tarea hecha no está vencida aunque su fecha haya pasado: ya no le debe nada a nadie.
    vencida: abierta && dias !== null && dias < 0,
    venceHoy: abierta && dias === 0,
  }
}

function buscarTarea(tareaId: number): FilaCruda {
  const fila = db().prepare(`${SELECT_TAREA} WHERE t.id = ?`).get(tareaId) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa tarea.')
  return fila
}

/** Orden de todos los listados: primero lo abierto, después lo urgente, después lo que vence antes. */
const ORDEN =
  `ORDER BY CASE t.estado WHEN 'hecha' THEN 1 ELSE 0 END,
            CASE t.prioridad WHEN 'ALTA' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END,
            t.vence_el IS NULL, t.vence_el, t.id DESC`

export interface VinculoABuscar {
  clienteId?: number
  polizaId?: number
  siniestroId?: number
  leadId?: number
  presupuestoId?: number
  renovacionId?: number
}

/** Las tareas de una ficha. Lo usan la ficha del lead, la del presupuesto y la del cliente. */
export function tareasDeVinculo(vinculo: VinculoABuscar): FilaTarea[] {
  const condiciones: string[] = []
  const parametros: Record<string, number> = {}
  const agregar = (columna: string, valor: number | undefined) => {
    if (valor === undefined) return
    condiciones.push(`t.${columna} = @${columna}`)
    parametros[columna] = valor
  }
  agregar('cliente_id', vinculo.clienteId)
  agregar('poliza_id', vinculo.polizaId)
  agregar('siniestro_id', vinculo.siniestroId)
  agregar('lead_id', vinculo.leadId)
  agregar('presupuesto_id', vinculo.presupuestoId)
  agregar('renovacion_id', vinculo.renovacionId)
  if (condiciones.length === 0) return []
  const hoy = hoyLocal()
  return (db().prepare(`${SELECT_TAREA} WHERE ${condiciones.join(' AND ')} ${ORDEN}`).all(parametros) as FilaCruda[]).map((f) => aFila(f, hoy))
}

function normalizarFiltros(filtros: unknown): FiltrosTareas {
  const f = objeto(filtros, 'Los filtros')
  const estado = limpiar(f.estado)
  return {
    busqueda: limpiar(f.busqueda).slice(0, 100),
    estado: (ESTADOS_DE_TAREA as readonly string[]).includes(estado) ? (estado as EstadoTarea) : '',
    prioridades: listaDeFiltro(f.prioridades)
      .map((p) => p.toUpperCase())
      .filter((p): p is PrioridadTarea => (PRIORIDADES_DE_TAREA as readonly string[]).includes(p)),
    // El 0 de antes («las de todos») ya no hace falta: la lista vacía es lo mismo, y dejarlo entrar
    // haría que elegir a alguien y además «todos» no filtrara nada.
    responsableIds: numerosDeFiltro(f.responsableIds).filter((id) => id !== 0),
    sucursales: listaDeFiltro(f.sucursales).map((v) => v.slice(0, 80)),
    soloVencidas: f.soloVencidas === true,
  }
}

function responsablesActivos(): Array<{ id: number; nombre: string }> {
  return db().prepare('SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre').all() as Array<{ id: number; nombre: string }>
}

export function listarTareas(filtros: unknown): ListadoTareas {
  const f = normalizarFiltros(filtros)
  const hoy = hoyLocal()
  const todas = (db().prepare(`${SELECT_TAREA} ${ORDEN}`).all() as FilaCruda[]).map((cruda) => aFila(cruda, hoy))
  const sucursales = sucursalesDeLasTareas()

  const busqueda = normalizarTexto(f.busqueda)
  const coincide = (t: FilaTarea): boolean =>
    !busqueda || [t.titulo, t.detalle, t.vinculoTexto, t.responsableNombre].some((valor) => normalizarTexto(valor).includes(busqueda))

  // Todos los filtros menos el de estado: los contadores dicen cuántas hay de cada estado dentro de
  // lo que se está mirando, si no tocar uno vaciaría los demás.
  const sinEstado = todas.filter(
    (t) =>
      (f.prioridades.length === 0 || f.prioridades.includes(t.prioridad)) &&
      // El -1 son las que no tienen responsable: se puede pedir junto con personas («las de Brenda y
      // las que no son de nadie»), que antes eran dos vueltas.
      (f.responsableIds.length === 0 || f.responsableIds.includes(t.responsableId ?? -1)) &&
      coincideAlguno(f.sucursales, t.sucursal, mismaSucursal) &&
      (!f.soloVencidas || t.vencida || t.venceHoy) &&
      coincide(t),
  )

  const porEstado = { pendiente: 0, 'en gestion': 0, hecha: 0 } as Record<EstadoTarea, number>
  for (const t of sinEstado) porEstado[t.estado]++

  return {
    filas: sinEstado.filter((t) => !f.estado || t.estado === f.estado),
    porEstado,
    total: todas.length,
    sucursales,
    responsables: responsablesActivos(),
    vencidas: sinEstado.filter((t) => t.vencida).length,
    venceHoy: sinEstado.filter((t) => t.venceHoy).length,
    avisoDeSincronizacion: null,
    hoy,
  }
}

function comentariosDe(tareaId: number): ComentarioDeTarea[] {
  return (
    db()
      .prepare('SELECT id, texto, usuario_nombre, creado_en FROM tarea_comentarios WHERE tarea_id = ? ORDER BY id DESC')
      .all(tareaId) as Array<{ id: number; texto: string; usuario_nombre: string; creado_en: string }>
  ).map((c) => ({ id: c.id, texto: c.texto, usuarioNombre: c.usuario_nombre, creadoEn: c.creado_en }))
}

function adjuntosDe(tareaId: number): AdjuntoDeTarea[] {
  return (
    db()
      .prepare(
        `SELECT id, nombre, tamano, creado_en, usuario_nombre, drive_id, drive_error
         FROM tarea_adjuntos WHERE tarea_id = ? ORDER BY id DESC`,
      )
      .all(tareaId) as Array<{
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

/**
 * El desplegable de sucursal de las tareas: las cuatro de la agencia más las que traigan las tareas
 * cargadas. Es UNA sola lista para los cuatro lugares donde aparece —el filtro del listado, la ficha,
 * el «Nueva tarea» de la pantalla de Tareas y el «Anotar tarea» de la bandeja de Renovaciones—, por eso
 * está exportada: la bandeja abre el mismo diálogo desde otro módulo y armaba la suya con la sucursal
 * de la renovación, así que ofrecía una opción o dos.
 *
 * Los dos extremos que hay que sostener juntos: la ficha mostraba sólo el catálogo, así que una tarea
 * vieja con una sucursal que ya no está en la lista perdía su propio valor al abrirla y guardarla la
 * mudaba de sucursal sin que nadie lo pidiera; y el filtro mostraba sólo lo cargado, así que una
 * sucursal sin ninguna tarea no se podía elegir para anotarle la primera. Ordenar en SQL tampoco
 * servía: `ORDER BY nombre` es binario y manda «Lanús» y «Sarandí» a otro lado.
 */
export function sucursalesDeLasTareas(): string[] {
  const deLasTareas = (
    db().prepare('SELECT DISTINCT sucursal_texto AS valor FROM tareas').all() as Array<{ valor: string | null }>
  ).map((f) => f.valor)
  return sucursalesParaElegir(deLasTareas)
}

/**
 * Abrir la ficha de una tarea que me asignaron cuenta como haberla visto: el punto de la campana se
 * apaga acá, que es el único momento en que se sabe de verdad que la persona la leyó.
 */
export function fichaDeTarea(tareaId: number, actor: SesionUsuario): FichaTarea {
  const id = enteroPositivo(tareaId, 'La tarea')
  const cruda = buscarTarea(id)
  if (cruda.responsable_id === actor.id && cruda.visto_en === null) {
    db().prepare('UPDATE tareas SET visto_en = ? WHERE id = ?').run(ahoraIso(), id)
  }
  return {
    tarea: aFila(buscarTarea(id), hoyLocal()),
    comentarios: comentariosDe(id),
    adjuntos: adjuntosDe(id),
    responsables: responsablesActivos(),
    sucursales: sucursalesDeLasTareas(),
    carpetaDeAdjuntos: carpetaDeAdjuntos(),
  }
}

// ---------------------------------------------------------------------------
// Lo que viaja a la hoja
// ---------------------------------------------------------------------------

function camposParaLaHoja(f: FilaCruda): Record<string, string> {
  const { vinculoTexto } = resolverVinculo(f)
  return {
    fecha: f.creado_en.slice(0, 10),
    titulo: f.titulo,
    descripcion: f.detalle ?? '',
    responsable: f.responsable_nombre ?? '',
    sucursal: f.sucursal ?? '',
    vence: f.vence_el ?? '',
    prioridad: f.prioridad,
    estado: NOMBRE_ESTADO_TAREA[f.estado as EstadoTarea] ?? f.estado,
    vinculo: vinculoTexto ?? '',
    usuario: f.creado_por,
  }
}

/**
 * Anota la tarea como fila de la pestaña APP TAREAS y la encola. La llaman las tres altas: la del
 * módulo, la de la ficha del cliente y la de la ficha del siniestro, para que una tarea sea la misma
 * cosa venga de donde venga.
 */
export function registrarTareaNueva(tareaId: number, actor: SesionUsuario): void {
  const cruda = buscarTarea(tareaId)
  if (cruda.fila_id) return
  const filaId = generarId()
  const pestana = pestanaDeTareas()
  db().transaction(() => {
    db().prepare('UPDATE tareas SET fila_id = ?, pestana = ? WHERE id = ?').run(filaId, pestana, tareaId)
    registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'APP_TAREAS', periodo: null })
  })()
  encolar({ operacion: 'crear', pestana, filaId, campos: camposParaLaHoja(buscarTarea(tareaId)) }, actor)
}

/** Sube los campos que cambiaron. Las tareas viejas (sin fila) no suben: no existen en la hoja. */
function sincronizar(tareaId: number, campos: Record<string, string>, actor: SesionUsuario): void {
  const cruda = buscarTarea(tareaId)
  if (!cruda.fila_id || !cruda.pestana) return
  encolar({ operacion: 'actualizar', pestana: cruda.pestana, filaId: cruda.fila_id, campos }, actor)
}

// ---------------------------------------------------------------------------
// Alta y edición
// ---------------------------------------------------------------------------

function fechaOpcional(valor: unknown, campo: string): string | null {
  const limpio = limpiar(valor).slice(0, 10)
  if (!limpio) return null
  if (aDia(limpio) === null) throw new ErrorDeNegocio(`${campo} no es una fecha válida.`)
  return limpio
}

function responsableValido(valor: unknown): { id: number | null; nombre: string | null } {
  if (valor === null || valor === undefined || valor === '') return { id: null, nombre: null }
  const id = enteroPositivo(valor, 'El responsable')
  const usuario = db().prepare('SELECT nombre FROM usuarios WHERE id = ? AND activo = 1').get(id) as { nombre: string } | undefined
  if (!usuario) throw new ErrorDeNegocio('El responsable que elegiste no existe o está dado de baja.')
  return { id, nombre: usuario.nombre }
}

/** Comprueba que la ficha vinculada exista de verdad: una tarea colgada de la nada no sirve para nada. */
function vinculoValido(valor: unknown, tabla: string, campo: string): number | null {
  if (valor === null || valor === undefined) return null
  const id = enteroPositivo(valor, campo)
  const existe = db().prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).get(id)
  if (!existe) throw new ErrorDeNegocio(`${campo} no existe.`)
  return id
}

function prioridadValida(valor: unknown): PrioridadTarea {
  const escrita = limpiar(valor).toUpperCase()
  if (!escrita) return 'NORMAL'
  if (!(PRIORIDADES_DE_TAREA as readonly string[]).includes(escrita)) throw new ErrorDeNegocio('Esa prioridad no es válida.')
  return escrita as PrioridadTarea
}

export function crearTareaCompleta(datos: DatosDeTareaCompleta, actor: SesionUsuario): FilaTarea {
  const d = objeto(datos, 'Los datos de la tarea')
  const titulo = texto(d.titulo, 'El título de la tarea', 1, 160)
  const detalle = limpiar(d.detalle).slice(0, 2000)
  const responsable = responsableValido(d.responsableId)
  const venceEl = fechaOpcional(d.venceEl, 'La fecha de vencimiento')
  const prioridad = prioridadValida(d.prioridad)
  const sucursal = limpiar(d.sucursal).slice(0, 80) || actor.sucursal.nombre

  const clienteId = vinculoValido(d.clienteId, 'clientes', 'El cliente')
  const polizaId = vinculoValido(d.polizaId, 'polizas', 'La póliza')
  const siniestroId = vinculoValido(d.siniestroId, 'siniestros', 'El siniestro')
  const leadId = vinculoValido(d.leadId, 'leads', 'La consulta')
  const presupuestoId = vinculoValido(d.presupuestoId, 'presupuestos', 'El presupuesto')
  const renovacionId = vinculoValido(d.renovacionId, 'renovaciones', 'La renovación')

  const ahora = ahoraIso()
  const id = Number(
    db()
      .prepare(
        `INSERT INTO tareas (titulo, detalle, cliente_id, poliza_id, siniestro_id, renovacion_id, lead_id,
                             presupuesto_id, responsable_id, responsable_nombre, sucursal_texto, vence_el,
                             prioridad, estado, creado_por, creado_por_id, visto_en, creado_en, actualizado_en)
         VALUES (@titulo, @detalle, @cliente_id, @poliza_id, @siniestro_id, @renovacion_id, @lead_id,
                 @presupuesto_id, @responsable_id, @responsable_nombre, @sucursal, @vence_el,
                 @prioridad, 'pendiente', @creado_por, @creado_por_id, @visto_en, @ahora, @ahora)`,
      )
      .run({
        titulo,
        detalle: detalle || null,
        cliente_id: clienteId,
        poliza_id: polizaId,
        siniestro_id: siniestroId,
        renovacion_id: renovacionId,
        lead_id: leadId,
        presupuesto_id: presupuestoId,
        responsable_id: responsable.id,
        responsable_nombre: responsable.nombre,
        sucursal: sucursal || null,
        vence_el: venceEl,
        prioridad,
        creado_por: actor.nombre,
        creado_por_id: actor.id,
        // Una tarea que me pongo yo mismo no es una novedad: no tiene por qué encender la campana.
        visto_en: responsable.id === null || responsable.id === actor.id ? ahora : null,
        ahora,
      }).lastInsertRowid,
  )

  registrarTareaNueva(id, actor)
  registrarCambio(actor, {
    accion: 'tarea',
    tabla: 'tareas',
    registroId: id,
    filaId: buscarTarea(id).fila_id,
    campo: 'TAREA',
    valorAnterior: null,
    valorNuevo: `${titulo}${responsable.nombre ? ` · ${responsable.nombre}` : ''}${venceEl ? ` · vence ${venceEl}` : ''}`,
  })
  return aFila(buscarTarea(id), hoyLocal())
}

/** Qué se le puede cambiar a una tarea, con el nombre que lleva en el historial y en la hoja. */
const CAMPOS_EDITABLES = [
  { campo: 'titulo', columna: 'titulo', etiqueta: 'TITULO', enLaHoja: 'titulo' },
  { campo: 'detalle', columna: 'detalle', etiqueta: 'DESCRIPCION', enLaHoja: 'descripcion' },
  { campo: 'responsable', columna: 'responsable_nombre', etiqueta: 'ASIGNADO A', enLaHoja: 'responsable' },
  { campo: 'sucursal', columna: 'sucursal_texto', etiqueta: 'LOCAL', enLaHoja: 'sucursal' },
  { campo: 'venceEl', columna: 'vence_el', etiqueta: 'VENCE', enLaHoja: 'vence' },
  { campo: 'prioridad', columna: 'prioridad', etiqueta: 'PRIORIDAD', enLaHoja: 'prioridad' },
  { campo: 'estado', columna: 'estado', etiqueta: 'ESTADO', enLaHoja: 'estado' },
] as const

export function editarTarea(tareaId: number, datos: DatosDeEdicionDeTarea, actor: SesionUsuario): FichaTarea {
  const id = enteroPositivo(tareaId, 'La tarea')
  const actual = buscarTarea(id)
  const d = objeto(datos, 'Los datos de la tarea')

  const titulo = texto(d.titulo, 'El título de la tarea', 1, 160)
  const detalle = limpiar(d.detalle).slice(0, 2000)
  const responsable = responsableValido(d.responsableId)
  const venceEl = fechaOpcional(d.venceEl, 'La fecha de vencimiento')
  const prioridad = prioridadValida(d.prioridad)
  const sucursal = limpiar(d.sucursal).slice(0, 80)
  const estado = limpiar(d.estado)
  if (!(ESTADOS_DE_TAREA as readonly string[]).includes(estado)) throw new ErrorDeNegocio('Ese estado de tarea no es válido.')

  const nuevos: Record<string, string> = {
    titulo,
    detalle,
    responsable: responsable.nombre ?? '',
    sucursal,
    venceEl: venceEl ?? '',
    prioridad,
    estado: NOMBRE_ESTADO_TAREA[estado as EstadoTarea],
  }
  const anteriores: Record<string, string> = {
    titulo: actual.titulo,
    detalle: limpiar(actual.detalle),
    responsable: limpiar(actual.responsable_nombre),
    sucursal: limpiar(actual.sucursal),
    venceEl: limpiar(actual.vence_el),
    prioridad: actual.prioridad,
    estado: NOMBRE_ESTADO_TAREA[actual.estado as EstadoTarea] ?? actual.estado,
  }
  const cambiados = CAMPOS_EDITABLES.filter((c) => nuevos[c.campo] !== anteriores[c.campo])
  if (cambiados.length === 0) return fichaDeTarea(id, actor)

  // Si cambió de dueño, para el nuevo es una novedad: la campana se le enciende hasta que la abra.
  const cambioDeResponsable = responsable.id !== actual.responsable_id
  const visto = !cambioDeResponsable
    ? actual.visto_en
    : responsable.id === null || responsable.id === actor.id
      ? ahoraIso()
      : null

  db()
    .prepare(
      `UPDATE tareas SET titulo = @titulo, detalle = @detalle, responsable_id = @responsable_id,
              responsable_nombre = @responsable_nombre, sucursal_texto = @sucursal, vence_el = @vence_el,
              prioridad = @prioridad, estado = @estado, visto_en = @visto, actualizado_en = @ahora
       WHERE id = @id`,
    )
    .run({
      titulo,
      detalle: detalle || null,
      responsable_id: responsable.id,
      responsable_nombre: responsable.nombre,
      sucursal: sucursal || null,
      vence_el: venceEl,
      prioridad,
      estado,
      visto,
      ahora: ahoraIso(),
      id,
    })

  const paraLaHoja: Record<string, string> = {}
  for (const cambio of cambiados) {
    paraLaHoja[cambio.enLaHoja] = nuevos[cambio.campo] ?? ''
    registrarCambio(actor, {
      accion: 'tarea',
      tabla: 'tareas',
      registroId: id,
      filaId: actual.fila_id,
      campo: cambio.etiqueta,
      valorAnterior: anteriores[cambio.campo] || null,
      valorNuevo: nuevos[cambio.campo] || null,
    })
  }
  sincronizar(id, paraLaHoja, actor)
  return fichaDeTarea(id, actor)
}

/** El gesto de todos los días: mover una tarea de PENDIENTE a EN CURSO y de ahí a HECHA. */
export function cambiarEstadoDeTareaDelModulo(tareaId: number, estado: unknown, actor: SesionUsuario): FilaTarea {
  const id = enteroPositivo(tareaId, 'La tarea')
  const actual = buscarTarea(id)
  const nuevo = limpiar(estado)
  if (!(ESTADOS_DE_TAREA as readonly string[]).includes(nuevo)) throw new ErrorDeNegocio('Ese estado de tarea no es válido.')
  if (actual.estado === nuevo) return aFila(actual, hoyLocal())

  db().prepare('UPDATE tareas SET estado = ?, actualizado_en = ? WHERE id = ?').run(nuevo, ahoraIso(), id)
  // Terminar una tarea es la única de las tres transiciones que se avisa: es la buena noticia, y la
  // que el resto del equipo quiere ver aunque tenga la aplicación detrás de otra ventana.
  if (nuevo === 'hecha') avisarTareaCompletada({ tareaId: id, titulo: actual.titulo, porQuien: actor.nombre })
  sincronizar(id, { estado: NOMBRE_ESTADO_TAREA[nuevo as EstadoTarea] }, actor)
  registrarCambio(actor, {
    accion: 'tarea',
    tabla: 'tareas',
    registroId: id,
    filaId: actual.fila_id,
    campo: 'ESTADO DE LA TAREA',
    valorAnterior: NOMBRE_ESTADO_TAREA[actual.estado as EstadoTarea] ?? actual.estado,
    valorNuevo: NOMBRE_ESTADO_TAREA[nuevo as EstadoTarea],
  })
  return aFila(buscarTarea(id), hoyLocal())
}

export function agregarComentario(tareaId: number, textoDelComentario: unknown, actor: SesionUsuario): FichaTarea {
  const id = enteroPositivo(tareaId, 'La tarea')
  buscarTarea(id)
  const contenido = texto(textoDelComentario, 'El comentario', 1, 2000)

  db()
    .prepare('INSERT INTO tarea_comentarios (tarea_id, texto, usuario_id, usuario_nombre, creado_en) VALUES (?, ?, ?, ?, ?)')
    .run(id, contenido, actor.id, actor.nombre, ahoraIso())
  db().prepare('UPDATE tareas SET actualizado_en = ? WHERE id = ?').run(ahoraIso(), id)

  registrarCambio(actor, {
    accion: 'tarea',
    tabla: 'tarea_comentarios',
    registroId: id,
    filaId: buscarTarea(id).fila_id,
    campo: 'COMENTARIO',
    valorAnterior: null,
    valorNuevo: contenido.slice(0, 200),
  })
  return fichaDeTarea(id, actor)
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

export async function agregarAdjuntosDeTarea(tareaId: number, rutas: unknown, actor: SesionUsuario): Promise<FichaTarea> {
  const id = enteroPositivo(tareaId, 'La tarea')
  const tarea = buscarTarea(id)
  if (!Array.isArray(rutas) || rutas.length === 0) throw new ErrorDeNegocio('No elegiste ningún archivo.')

  const dameToken = dadorDeTokenDeGoogle()
  for (const ruta of rutas) {
    const copia = copiarAdjuntoEn(`tarea-${id}`, texto(ruta, 'La ruta del archivo', 1, 4096))
    const drive = await subirAdjuntoADriveComo(dameToken, `tarea-${id}`, copia)
    db()
      .prepare(
        `INSERT INTO tarea_adjuntos (tarea_id, nombre, archivo, tamano, drive_id, drive_error, usuario_id, usuario_nombre, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, copia.nombre, copia.archivo, copia.tamano, drive.driveId, drive.error, actor.id, actor.nombre, ahoraIso())
    registrarCambio(actor, {
      accion: 'tarea',
      tabla: 'tarea_adjuntos',
      registroId: id,
      filaId: tarea.fila_id,
      campo: 'ADJUNTO',
      valorAnterior: null,
      valorNuevo: copia.nombre,
    })
  }
  return fichaDeTarea(id, actor)
}

export function rutaDelAdjuntoDeTarea(adjuntoId: number): string {
  const id = enteroPositivo(adjuntoId, 'El documento')
  const adjunto = db().prepare('SELECT archivo FROM tarea_adjuntos WHERE id = ?').get(id) as { archivo: string } | undefined
  if (!adjunto) throw new ErrorDeNegocio('No se encontró ese documento.')
  return rutaDeAdjunto(adjunto.archivo)
}

export function borrarAdjuntoDeTarea(adjuntoId: number, actor: SesionUsuario): FichaTarea {
  const id = enteroPositivo(adjuntoId, 'El documento')
  const adjunto = db().prepare('SELECT id, tarea_id, nombre, archivo FROM tarea_adjuntos WHERE id = ?').get(id) as
    | { id: number; tarea_id: number; nombre: string; archivo: string }
    | undefined
  if (!adjunto) throw new ErrorDeNegocio('No se encontró ese documento.')

  db().prepare('DELETE FROM tarea_adjuntos WHERE id = ?').run(id)
  borrarArchivoDeAdjunto(adjunto.archivo)
  registrarCambio(actor, {
    accion: 'tarea',
    tabla: 'tarea_adjuntos',
    registroId: adjunto.tarea_id,
    filaId: buscarTarea(adjunto.tarea_id).fila_id,
    campo: 'ADJUNTO BORRADO',
    valorAnterior: adjunto.nombre,
    valorNuevo: null,
  })
  return fichaDeTarea(adjunto.tarea_id, actor)
}

// ---------------------------------------------------------------------------
// Lo mío: Inicio y la campana de la barra superior
// ---------------------------------------------------------------------------

/** Cuántas se muestran en el desplegable de la campana y en Inicio. */
const CUANTAS_A_LA_VISTA = 8

/** Las tareas abiertas de quien está usando la aplicación, lo más urgente primero. */
export function misTareas(actor: SesionUsuario, limite = CUANTAS_A_LA_VISTA): FilaTarea[] {
  const hoy = hoyLocal()
  return (
    db()
      .prepare(`${SELECT_TAREA} WHERE t.responsable_id = ? AND t.estado <> 'hecha' ${ORDEN} LIMIT ?`)
      .all(actor.id, limite) as FilaCruda[]
  ).map((f) => aFila(f, hoy))
}

/**
 * Lo que mira la campana: cuántas me asignaron y todavía no vi, cuántas vencen hoy y cuántas están
 * vencidas. El punto rojo lo enciende `nuevas`; el número que se ve es lo pendiente.
 */
export function avisosDeTareas(actor: SesionUsuario): AvisosDeTareas {
  const hoy = hoyLocal()
  const abiertas = (
    db().prepare(`${SELECT_TAREA} WHERE t.responsable_id = ? AND t.estado <> 'hecha' ${ORDEN}`).all(actor.id) as FilaCruda[]
  ).map((f) => ({ fila: aFila(f, hoy), visto: f.visto_en }))

  return {
    nuevas: abiertas.filter((t) => t.visto === null).length,
    // Los ids, además del conteo: son los que la campana compara para decidir si suena. Una tarea que
    // uno se asigna a sí mismo ya nace con `visto_en` puesto, así que no entra acá y no suena, que es
    // exactamente lo que corresponde.
    idsNuevas: abiertas.filter((t) => t.visto === null).map((t) => t.fila.id),
    venceHoy: abiertas.filter((t) => t.fila.venceHoy).length,
    vencidas: abiertas.filter((t) => t.fila.vencida).length,
    pendientes: abiertas.length,
    filas: abiertas.slice(0, CUANTAS_A_LA_VISTA).map((t) => t.fila),
    hoy,
  }
}

/** Abrir la campana cuenta como enterarse: se apaga el punto de todas las que están ahí. */
export function marcarAvisosVistos(actor: SesionUsuario): AvisosDeTareas {
  db()
    .prepare(`UPDATE tareas SET visto_en = ? WHERE responsable_id = ? AND estado <> 'hecha' AND visto_en IS NULL`)
    .run(ahoraIso(), actor.id)
  return avisosDeTareas(actor)
}
