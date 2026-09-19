// Leads: la consulta que todavía no es cliente. «Che, ¿cuánto me sale asegurar el Gol de mi hija?»
//
// Hoy eso vive en un papelito o en un chat sin contestar. Acá es una fila con estado: NUEVO cuando
// entra, EN CHARLA mientras se habla, COTIZADO cuando se le pasó un precio, y GANADO o PERDIDO al
// final. Lo único que se pregunta siempre es cómo llegó, porque es lo que después dice qué canal
// trae ventas de verdad.
//
// Nada de esto existe en el Excel de la agencia, así que la pestaña de la hoja la crea DM Gestión
// (ver sincronizacion/pestanasApp.ts). Igual se encola desde el primer día: si la pestaña todavía no
// está, la crea el motor en cuanto haya conexión y la fila sube sola.
import { DIRECCION_VACIA } from '../../shared/direccion'
import { hoyLocal } from '../../shared/semaforo'
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { mismaSucursal } from '../../shared/sucursales'
import {
  ESTADOS_DE_LEAD,
  ORIGENES_DE_LEAD,
  type DatosDeLead,
  type EstadoLead,
  type FichaLead,
  type FilaLead,
  type FiltrosLeads,
  type ListadoLeads,
  type NotaDeLead,
  type OrigenDeLead,
  type ResultadoConversion,
  type SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, generarId, limpiar, normalizarDocumento, normalizarTexto } from '../importacion/normalizar'
import { registrarComentarioNuevo } from '../sincronizacion/anexos'
import { encolar } from '../sincronizacion/cola'
import { PESTANAS_DE_LA_APP } from '../sincronizacion/pestanasApp'
import { telefonoParaWhatsapp } from './cartera'
import { crearCliente } from './clientes'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { nombreDePestana } from './hojas'
import { presupuestosDeLead } from './presupuestos'
import { idDeSucursalPorNombre, sucursalesParaElegir, sucursalParaGuardar } from './sucursales'
import { tareasDeVinculo } from './tareas'
import { enteroPositivo, objeto, texto } from './validacion'

const PESTANA_POR_DEFECTO = PESTANAS_DE_LA_APP.find((p) => p.tipo === 'APP_LEADS')!.titulo

/** Dónde escribir los leads: la pestaña ya importada o la que la aplicación va a crear. */
export function pestanaDeLeads(): string {
  return nombreDePestana('APP_LEADS', PESTANA_POR_DEFECTO)
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

const SELECT_LEAD = `
  SELECT l.id, l.fila_id, l.nombre, l.telefono, l.documento, l.email, l.sucursal_texto AS sucursal,
         l.interes, l.tipo_vehiculo, l.origen, l.estado, l.cliente_id, l.convertido_en,
         l.usuario_nombre, l.creado_en, l.actualizado_en,
         (SELECT COUNT(*) FROM lead_notas n WHERE n.lead_id = l.id) AS notas,
         (SELECT n.texto FROM lead_notas n WHERE n.lead_id = l.id ORDER BY n.id DESC LIMIT 1) AS ultima_nota,
         (SELECT n.creado_en FROM lead_notas n WHERE n.lead_id = l.id ORDER BY n.id DESC LIMIT 1) AS ultima_nota_en,
         (SELECT COUNT(*) FROM presupuestos p WHERE p.lead_id = l.id AND p.vigente = 1) AS presupuestos,
         (SELECT COUNT(*) FROM tareas t WHERE t.lead_id = l.id AND t.estado <> 'hecha') AS tareas_pendientes
  FROM leads l
`

interface FilaCruda {
  id: number
  fila_id: string
  nombre: string
  telefono: string | null
  documento: string | null
  email: string | null
  sucursal: string | null
  interes: string | null
  tipo_vehiculo: string | null
  origen: string
  estado: string
  cliente_id: number | null
  convertido_en: string | null
  usuario_nombre: string | null
  creado_en: string
  actualizado_en: string
  notas: number
  ultima_nota: string | null
  ultima_nota_en: string | null
  presupuestos: number
  tareas_pendientes: number
}

function aFila(f: FilaCruda): FilaLead {
  const telefono = telefonoParaWhatsapp(f.telefono)
  return {
    id: f.id,
    filaId: f.fila_id,
    nombre: f.nombre,
    telefono: f.telefono,
    sucursal: f.sucursal,
    interes: f.interes,
    tipoVehiculo: f.tipo_vehiculo,
    origen: f.origen as OrigenDeLead,
    estado: f.estado as EstadoLead,
    documento: f.documento,
    email: f.email,
    clienteId: f.cliente_id,
    convertidoEn: f.convertido_en,
    usuarioNombre: f.usuario_nombre,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
    notas: f.notas,
    ultimaNota: f.ultima_nota,
    ultimaNotaEn: f.ultima_nota_en,
    presupuestos: f.presupuestos,
    tareasPendientes: f.tareas_pendientes,
    urlWhatsapp: telefono ? `https://wa.me/${telefono}` : null,
  }
}

function buscarLead(leadId: number): FilaCruda {
  const fila = db().prepare(`${SELECT_LEAD} WHERE l.id = ?`).get(leadId) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa consulta.')
  return fila
}

/**
 * El desplegable de sucursal del módulo: las cuatro de la agencia más las que traigan las consultas.
 *
 * No es sólo el filtro del listado. Es el mismo desplegable que ofrece «Nueva consulta» y el que
 * ofrece «Editar la consulta» desde la ficha —son el mismo diálogo—, así que los tres caminos tienen
 * que ver lo mismo: la sucursal recién abierta no tiene ninguna consulta justamente hasta que se la
 * pueda elegir, y una consulta cargada con la sucursal equivocada se corrige desde la ficha, que es
 * donde se la está mirando.
 */
function sucursalesDeLosLeads(): string[] {
  const deLosLeads = (
    db().prepare('SELECT DISTINCT sucursal_texto AS valor FROM leads').all() as Array<{ valor: string | null }>
  ).map((f) => f.valor)
  return sucursalesParaElegir(deLosLeads)
}

/** El lead como fila, para devolverlo desde cualquier lado sin rearmar la consulta. */
export function filaDeLead(leadId: number): FilaLead {
  return aFila(buscarLead(leadId))
}

function normalizarFiltros(filtros: unknown): FiltrosLeads {
  const f = objeto(filtros, 'Los filtros')
  const estado = limpiar(f.estado).toUpperCase()
  return {
    busqueda: limpiar(f.busqueda).slice(0, 100),
    estado: (ESTADOS_DE_LEAD as readonly string[]).includes(estado) ? (estado as EstadoLead) : '',
    origenes: listaDeFiltro(f.origenes)
      .map((o) => o.toUpperCase())
      .filter((o): o is OrigenDeLead => (ORIGENES_DE_LEAD as readonly string[]).includes(o)),
    sucursales: listaDeFiltro(f.sucursales).map((v) => v.slice(0, 80)),
    incluirCerrados: f.incluirCerrados === true,
  }
}

/** Un lead GANADO o PERDIDO ya no es trabajo pendiente: se esconde salvo que se pidan. */
const CERRADOS: EstadoLead[] = ['GANADO', 'PERDIDO']

export function listarLeads(filtros: unknown): ListadoLeads {
  const f = normalizarFiltros(filtros)
  const todos = (db().prepare(`${SELECT_LEAD} ORDER BY l.id DESC`).all() as FilaCruda[]).map(aFila)
  const sucursales = sucursalesDeLosLeads()

  const busqueda = normalizarTexto(f.busqueda)
  const documento = normalizarDocumento(f.busqueda)
  const soloDigitosDeLaBusqueda = f.busqueda.replace(/\D+/g, '')
  const coincide = (lead: FilaLead): boolean => {
    if (!busqueda) return true
    if (documento.length >= 6 && normalizarDocumento(lead.documento) === documento) return true
    // El teléfono es lo que más se busca, y casi nunca entero: «me llamó uno que terminaba en 2222».
    // Con cuatro dígitos alcanza; menos que eso engancharía cualquier cosa.
    if (soloDigitosDeLaBusqueda.length >= 4 && (lead.telefono ?? '').replace(/\D+/g, '').includes(soloDigitosDeLaBusqueda)) return true
    return [lead.nombre, lead.interes, lead.tipoVehiculo, lead.ultimaNota].some((valor) => normalizarTexto(valor).includes(busqueda))
  }

  // Todo menos el filtro de estado: los contadores tienen que decir cuántos hay de cada estado dentro
  // de lo que se está mirando, si no tocar uno vaciaría los demás.
  const sinEstado = todos.filter(
    (lead) =>
      (f.origenes.length === 0 || f.origenes.includes(lead.origen)) &&
      coincideAlguno(f.sucursales, lead.sucursal, mismaSucursal) &&
      (f.incluirCerrados || !CERRADOS.includes(lead.estado) || lead.estado === f.estado) &&
      coincide(lead),
  )

  const porEstado = { NUEVO: 0, 'EN CHARLA': 0, COTIZADO: 0, GANADO: 0, PERDIDO: 0 } as Record<EstadoLead, number>
  for (const lead of todos) {
    if (f.origenes.length > 0 && !f.origenes.includes(lead.origen)) continue
    if (!coincideAlguno(f.sucursales, lead.sucursal, mismaSucursal)) continue
    if (!coincide(lead)) continue
    porEstado[lead.estado]++
  }

  return {
    filas: sinEstado.filter((lead) => !f.estado || lead.estado === f.estado),
    porEstado,
    total: todos.length,
    sucursales,
    avisoDeSincronizacion: null,
    hoy: hoyLocal(),
  }
}

function notasDe(leadId: number): NotaDeLead[] {
  return (
    db()
      .prepare('SELECT id, texto, usuario_nombre, creado_en FROM lead_notas WHERE lead_id = ? ORDER BY id DESC')
      .all(leadId) as Array<{ id: number; texto: string; usuario_nombre: string; creado_en: string }>
  ).map((n) => ({ id: n.id, texto: n.texto, usuarioNombre: n.usuario_nombre, creadoEn: n.creado_en }))
}

export function fichaDeLead(leadId: number): FichaLead {
  const id = enteroPositivo(leadId, 'La consulta')
  const lead = aFila(buscarLead(id))
  return {
    lead,
    notas: notasDe(id),
    presupuestos: presupuestosDeLead(id),
    tareas: tareasDeVinculo({ leadId: id }),
    // La ficha edita la consulta con el mismo diálogo que la carga, así que necesita la misma lista
    // que el listado: desde acá también hay que poder mudar una consulta a Sarandí.
    sucursales: sucursalesDeLosLeads(),
  }
}

// ---------------------------------------------------------------------------
// Lo que viaja a la hoja
// ---------------------------------------------------------------------------

/** Resumen de las notas para la columna NOTAS de la hoja: es una celda, no un libro. */
const LARGO_NOTAS_EN_LA_HOJA = 900

function notasParaLaHoja(leadId: number): string {
  const junto = notasDe(leadId)
    .map((n) => `${n.creadoEn.slice(8, 10)}/${n.creadoEn.slice(5, 7)} ${n.usuarioNombre}: ${n.texto}`)
    .join(' · ')
  return junto.length > LARGO_NOTAS_EN_LA_HOJA ? `${junto.slice(0, LARGO_NOTAS_EN_LA_HOJA - 1)}…` : junto
}

function camposParaLaHoja(f: FilaCruda, notas: string): Record<string, string> {
  return {
    fecha: f.creado_en.slice(0, 10),
    sucursal: f.sucursal ?? '',
    nombre: f.nombre,
    telefono: f.telefono ?? '',
    documento: f.documento ?? '',
    origen: f.origen,
    interes: f.interes ?? '',
    tipo_vehiculo: f.tipo_vehiculo ?? '',
    estado: f.estado,
    observaciones: notas,
    usuario: f.usuario_nombre ?? '',
  }
}

/** Sube a la hoja los campos que cambiaron de un lead ya creado. */
function sincronizar(leadId: number, campos: Record<string, string>, actor: SesionUsuario): void {
  const fila = buscarLead(leadId)
  encolar({ operacion: 'actualizar', pestana: pestanaDeLeads(), filaId: fila.fila_id, campos }, actor)
}

// ---------------------------------------------------------------------------
// Alta y edición
// ---------------------------------------------------------------------------

interface CamposValidados {
  nombre: string
  telefono: string
  sucursal: string
  interes: string
  tipoVehiculo: string
  origen: OrigenDeLead
  estado: EstadoLead
  documento: string
  email: string
  nota: string
}

function validarDatos(datos: unknown, actor: SesionUsuario): CamposValidados {
  const d = objeto(datos, 'Los datos de la consulta')
  const origen = limpiar(d.origen).toUpperCase()
  const estado = limpiar(d.estado).toUpperCase()
  if (origen && !(ORIGENES_DE_LEAD as readonly string[]).includes(origen)) throw new ErrorDeNegocio('Elegí cómo llegó la consulta.')
  if (estado && !(ESTADOS_DE_LEAD as readonly string[]).includes(estado)) throw new ErrorDeNegocio('Ese estado no es válido.')
  return {
    nombre: texto(d.nombre, 'El nombre', 2, 160),
    telefono: limpiar(d.telefono).slice(0, 60),
    // Sin sucursal, la del que carga: es la del mostrador donde entró la consulta.
    sucursal: limpiar(d.sucursal).slice(0, 80) || actor.sucursal.nombre,
    interes: limpiar(d.interes).slice(0, 300),
    tipoVehiculo: limpiar(d.tipoVehiculo).slice(0, 80),
    origen: (origen || 'OTRO') as OrigenDeLead,
    estado: (estado || 'NUEVO') as EstadoLead,
    documento: limpiar(d.documento).slice(0, 40),
    email: limpiar(d.email).slice(0, 160),
    nota: limpiar(d.nota).slice(0, 2000),
  }
}

export function crearLead(datos: DatosDeLead, actor: SesionUsuario): FichaLead {
  const campos = validarDatos(datos, actor)
  const filaId = generarId()
  const pestana = pestanaDeLeads()
  const ahora = ahoraIso()

  const id = db().transaction(() => {
    const resultado = db()
      .prepare(
        `INSERT INTO leads (fila_id, pestana, nombre, telefono, documento, documento_normalizado, email,
                            sucursal_id, sucursal_texto, interes, tipo_vehiculo, origen, estado,
                            usuario_id, usuario_nombre, creado_en, actualizado_en)
         VALUES (@fila_id, @pestana, @nombre, @telefono, @documento, @documento_normalizado, @email,
                 @sucursal_id, @sucursal_texto, @interes, @tipo_vehiculo, @origen, @estado,
                 @usuario_id, @usuario_nombre, @ahora, @ahora)`,
      )
      .run({
        fila_id: filaId,
        pestana,
        nombre: campos.nombre,
        telefono: campos.telefono || null,
        documento: campos.documento || null,
        documento_normalizado: normalizarDocumento(campos.documento) || null,
        email: campos.email || null,
        sucursal_id: idDeSucursalPorNombre(campos.sucursal),
        sucursal_texto: sucursalParaGuardar(campos.sucursal),
        interes: campos.interes || null,
        tipo_vehiculo: campos.tipoVehiculo || null,
        origen: campos.origen,
        estado: campos.estado,
        usuario_id: actor.id,
        usuario_nombre: actor.nombre,
        ahora,
      })
    const nuevo = Number(resultado.lastInsertRowid)
    // Igual que las pólizas y los siniestros: primero se anota como fila conocida y recién después se
    // encola. Si no, la bajada la ve como una fila que vino de otra computadora y pide una importación
    // completa cada cinco minutos, para siempre.
    registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'APP_LEADS', periodo: null })
    if (campos.nota) {
      const { id: notaId } = db()
        .prepare('INSERT INTO lead_notas (lead_id, texto, usuario_id, usuario_nombre, creado_en) VALUES (?, ?, ?, ?, ?) RETURNING id')
        .get(nuevo, campos.nota, actor.id, actor.nombre, ahora) as { id: number }
      // 12.7: la nota viaja entera por APP COMENTARIOS, así la otra computadora la ve en la ficha.
      registrarComentarioNuevo('lead', nuevo, notaId, actor)
    }
    return nuevo
  })()

  encolar({ operacion: 'crear', pestana, filaId, campos: camposParaLaHoja(buscarLead(id), notasParaLaHoja(id)) }, actor)
  registrarCambio(actor, {
    accion: 'lead',
    tabla: 'leads',
    registroId: id,
    filaId,
    campo: 'ALTA DE CONSULTA',
    valorAnterior: null,
    valorNuevo: `${campos.nombre}${campos.interes ? ` · ${campos.interes}` : ''} · ${campos.origen}`,
  })
  return fichaDeLead(id)
}

/** Qué campos del lead se editan y cómo se llaman en el historial y en la hoja. */
const CAMPOS_EDITABLES = [
  { campo: 'nombre', columna: 'nombre', etiqueta: 'NOMBRE', enLaHoja: 'nombre' },
  { campo: 'telefono', columna: 'telefono', etiqueta: 'TELEFONO', enLaHoja: 'telefono' },
  { campo: 'sucursal', columna: 'sucursal_texto', etiqueta: 'LOCAL', enLaHoja: 'sucursal' },
  { campo: 'interes', columna: 'interes', etiqueta: 'QUE ASEGURA', enLaHoja: 'interes' },
  { campo: 'tipoVehiculo', columna: 'tipo_vehiculo', etiqueta: 'TIPO', enLaHoja: 'tipo_vehiculo' },
  { campo: 'origen', columna: 'origen', etiqueta: 'ORIGEN', enLaHoja: 'origen' },
  { campo: 'estado', columna: 'estado', etiqueta: 'ESTADO', enLaHoja: 'estado' },
  { campo: 'documento', columna: 'documento', etiqueta: 'DNI/CUIT', enLaHoja: 'documento' },
  { campo: 'email', columna: 'email', etiqueta: 'EMAIL', enLaHoja: null },
] as const

export function editarLead(leadId: number, datos: DatosDeLead, actor: SesionUsuario): FichaLead {
  const id = enteroPositivo(leadId, 'La consulta')
  const actual = buscarLead(id)
  const campos = validarDatos(datos, actor)

  const nuevos: Record<string, string> = {
    nombre: campos.nombre,
    telefono: campos.telefono,
    sucursal: campos.sucursal,
    interes: campos.interes,
    tipoVehiculo: campos.tipoVehiculo,
    origen: campos.origen,
    estado: campos.estado,
    documento: campos.documento,
    email: campos.email,
  }
  const anteriores: Record<string, string> = {
    nombre: actual.nombre,
    telefono: limpiar(actual.telefono),
    sucursal: limpiar(actual.sucursal),
    interes: limpiar(actual.interes),
    tipoVehiculo: limpiar(actual.tipo_vehiculo),
    origen: actual.origen,
    estado: actual.estado,
    documento: limpiar(actual.documento),
    email: limpiar(actual.email),
  }

  const cambiados = CAMPOS_EDITABLES.filter((c) => nuevos[c.campo] !== anteriores[c.campo])
  if (cambiados.length === 0) return fichaDeLead(id)

  db()
    .prepare(
      `UPDATE leads SET nombre = @nombre, telefono = @telefono, documento = @documento,
              documento_normalizado = @documento_normalizado, email = @email, sucursal_id = @sucursal_id,
              sucursal_texto = @sucursal_texto, interes = @interes, tipo_vehiculo = @tipo_vehiculo,
              origen = @origen, estado = @estado, actualizado_en = @ahora
       WHERE id = @id`,
    )
    .run({
      nombre: campos.nombre,
      telefono: campos.telefono || null,
      documento: campos.documento || null,
      documento_normalizado: normalizarDocumento(campos.documento) || null,
      email: campos.email || null,
      sucursal_id: idDeSucursalPorNombre(campos.sucursal),
      sucursal_texto: sucursalParaGuardar(campos.sucursal),
      interes: campos.interes || null,
      tipo_vehiculo: campos.tipoVehiculo || null,
      origen: campos.origen,
      estado: campos.estado,
      ahora: ahoraIso(),
      id,
    })

  const paraLaHoja: Record<string, string> = {}
  for (const cambio of cambiados) {
    if (cambio.enLaHoja) paraLaHoja[cambio.enLaHoja] = nuevos[cambio.campo] ?? ''
    registrarCambio(actor, {
      accion: 'lead',
      tabla: 'leads',
      registroId: id,
      filaId: actual.fila_id,
      campo: cambio.etiqueta,
      valorAnterior: anteriores[cambio.campo] || null,
      valorNuevo: nuevos[cambio.campo] || null,
    })
  }
  if (Object.keys(paraLaHoja).length > 0) sincronizar(id, paraLaHoja, actor)
  return fichaDeLead(id)
}

/** Cambiar el estado es el gesto de todos los días: se arrastra la tarjeta y listo. */
export function cambiarEstadoDeLead(leadId: number, estado: unknown, actor: SesionUsuario): FichaLead {
  const id = enteroPositivo(leadId, 'La consulta')
  const actual = buscarLead(id)
  const escrito = limpiar(estado).toUpperCase()
  if (!(ESTADOS_DE_LEAD as readonly string[]).includes(escrito)) throw new ErrorDeNegocio('Ese estado no es válido.')
  if (actual.estado === escrito) return fichaDeLead(id)

  db().prepare('UPDATE leads SET estado = ?, actualizado_en = ? WHERE id = ?').run(escrito, ahoraIso(), id)
  sincronizar(id, { estado: escrito }, actor)
  registrarCambio(actor, {
    accion: 'lead',
    tabla: 'leads',
    registroId: id,
    filaId: actual.fila_id,
    campo: 'ESTADO',
    valorAnterior: actual.estado,
    valorNuevo: escrito,
  })
  return fichaDeLead(id)
}

export function agregarNotaDeLead(leadId: number, textoDeLaNota: unknown, actor: SesionUsuario): FichaLead {
  const id = enteroPositivo(leadId, 'La consulta')
  const fila = buscarLead(id)
  const contenido = texto(textoDeLaNota, 'La nota', 1, 2000)

  const { id: notaId } = db()
    .prepare('INSERT INTO lead_notas (lead_id, texto, usuario_id, usuario_nombre, creado_en) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .get(id, contenido, actor.id, actor.nombre, ahoraIso()) as { id: number }
  db().prepare('UPDATE leads SET actualizado_en = ? WHERE id = ?').run(ahoraIso(), id)
  // 12.7: la nota viaja entera por APP COMENTARIOS (la columna NOTAS de abajo es el resumen para Google).
  registrarComentarioNuevo('lead', id, notaId, actor)

  // La columna NOTAS de la hoja recibe la charla entera: quien mire la hoja ve lo mismo que la ficha.
  sincronizar(id, { observaciones: notasParaLaHoja(id) }, actor)
  registrarCambio(actor, {
    accion: 'lead',
    tabla: 'lead_notas',
    registroId: id,
    filaId: fila.fila_id,
    campo: 'NOTA',
    valorAnterior: null,
    valorNuevo: contenido.slice(0, 200),
  })
  return fichaDeLead(id)
}

// ---------------------------------------------------------------------------
// Convertir en cliente
// ---------------------------------------------------------------------------

/**
 * «Convertir en cliente»: crea el cliente con los datos que ya se cargaron en el lead y lo deja
 * GANADO. Ése es el punto de todo el módulo: que nadie vuelva a tipear el nombre y el teléfono que ya
 * están escritos.
 *
 * Si el DNI/CUIT ya es de un cliente, no se duplica: se usa el que está y se avisa (es la misma regla
 * del alta de clientes). La pantalla se queda con `clienteId` y abre el formulario de póliza nueva.
 */
export function convertirLeadEnCliente(leadId: number, actor: SesionUsuario): ResultadoConversion {
  const id = enteroPositivo(leadId, 'La consulta')
  const lead = buscarLead(id)

  if (lead.cliente_id !== null) {
    const existente = db().prepare('SELECT id, nombre FROM clientes WHERE id = ?').get(lead.cliente_id) as
      | { id: number; nombre: string }
      | undefined
    if (existente) {
      return {
        clienteId: existente.id,
        clienteNombre: existente.nombre,
        creado: false,
        aviso: `Esta consulta ya se había convertido: el cliente es ${existente.nombre}.`,
        lead: fichaDeLead(id),
      }
    }
  }

  const resultado = crearCliente(
    {
      nombre: lead.nombre,
      documento: limpiar(lead.documento),
      telefono: limpiar(lead.telefono),
      email: limpiar(lead.email),
      direccion: '',
      localidad: '',
      sucursal: limpiar(lead.sucursal),
      fechaNacimiento: '',
      profesion: '',
      // Una consulta no trae dirección: se carga después, desde la ficha del cliente.
      direccionDetalle: DIRECCION_VACIA,
    },
    actor,
  )

  const clienteId = resultado.creado ? resultado.cliente.id : resultado.yaExiste.id
  const clienteNombre = resultado.creado ? resultado.cliente.nombre : resultado.yaExiste.nombre
  const ahora = ahoraIso()

  db()
    .prepare(`UPDATE leads SET cliente_id = ?, convertido_en = ?, estado = 'GANADO', actualizado_en = ? WHERE id = ?`)
    .run(clienteId, ahora, ahora, id)
  // Los presupuestos que todavía no tenían cliente pasan a tenerlo: son del mismo señor.
  db().prepare('UPDATE presupuestos SET cliente_id = ?, actualizado_en = ? WHERE lead_id = ? AND cliente_id IS NULL').run(clienteId, ahora, id)

  if (lead.estado !== 'GANADO') sincronizar(id, { estado: 'GANADO' }, actor)
  registrarCambio(actor, {
    accion: 'lead',
    tabla: 'leads',
    registroId: id,
    filaId: lead.fila_id,
    campo: 'CONVERTIDO EN CLIENTE',
    valorAnterior: lead.estado,
    valorNuevo: `${clienteNombre} (cliente ${clienteId})`,
  })

  return {
    clienteId,
    clienteNombre,
    creado: resultado.creado,
    aviso: resultado.creado ? null : resultado.motivo,
    lead: fichaDeLead(id),
  }
}
