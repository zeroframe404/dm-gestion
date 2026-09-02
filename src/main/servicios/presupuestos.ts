// Presupuestos: un vehículo y las compañías que se cotizaron para él.
//
// Lo que hoy es un mensaje de WhatsApp escrito a mano tres veces por día acá es una fila con sus
// opciones. El mensaje se arma solo y sale siempre igual de prolijo, y el PDF sale con el nombre de la
// aseguradora para el que lo quiere en papel.
//
// Las VERSIONES son la regla que importa: tocar un presupuesto ya ENVIADO no lo edita, crea la
// versión siguiente y deja la anterior tal cual. Si el cliente tiene en el teléfono el mensaje con los
// precios de ayer, ese mensaje tiene que seguir existiendo acá igualito; si no, cuando llame diciendo
// «me habías pasado 45.000» no hay con qué comparar.
import {
  ESTADOS_DE_PRESUPUESTO,
  type AceptacionDePresupuesto,
  type DatosDeOpcion,
  type DatosDePresupuesto,
  type EnvioDePresupuesto,
  type EstadoPresupuesto,
  type FichaPresupuesto,
  type FilaPresupuesto,
  type FiltrosPresupuestos,
  type ListadoPresupuestos,
  type OpcionDePresupuesto,
  type SesionUsuario,
} from '../../shared/tipos'
import { hoyLocal } from '../../shared/semaforo'
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { mismaSucursal } from '../../shared/sucursales'
import { db } from '../db/base'
import { ahoraIso, generarId, interpretarNumero, limpiar, normalizarPatente, normalizarTexto } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { PESTANAS_DE_LA_APP } from '../sincronizacion/pestanasApp'
import { telefonoParaWhatsapp } from './cartera'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { nombreDePestana } from './hojas'
import { sucursalesParaElegir } from './sucursales'
import { enteroPositivo, objeto } from './validacion'

const PESTANA_POR_DEFECTO = PESTANAS_DE_LA_APP.find((p) => p.tipo === 'APP_PRESUPUESTOS')!.titulo

export function pestanaDePresupuestos(): string {
  return nombreDePestana('APP_PRESUPUESTOS', PESTANA_POR_DEFECTO)
}

/** Cómo se llama la agencia en el mensaje y en el PDF. */
export const NOMBRE_DE_LA_ASEGURADORA = 'SEGUROS DANIEL MARTÍNEZ'

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

const SELECT_PRESUPUESTO = `
  SELECT p.id, p.fila_id, p.numero, p.version, p.estado, p.lead_id, p.cliente_id, p.cliente_nombre,
         p.telefono, p.documento, p.sucursal_texto AS sucursal, p.patente, p.marca, p.modelo, p.anio,
         p.tipo_vehiculo, p.observaciones, p.enviado_en, p.aceptado_en, p.poliza_id, p.usuario_nombre,
         p.creado_en, p.actualizado_en, p.vigente,
         (SELECT COUNT(*) FROM presupuesto_opciones o WHERE o.presupuesto_id = p.id) AS opciones,
         (SELECT o.precio FROM presupuesto_opciones o
           WHERE o.presupuesto_id = p.id AND o.precio_monto IS NOT NULL
           ORDER BY o.precio_monto LIMIT 1) AS desde
  FROM presupuestos p
`

interface FilaCruda {
  id: number
  fila_id: string
  numero: string
  version: number
  estado: string
  lead_id: number | null
  cliente_id: number | null
  cliente_nombre: string
  telefono: string | null
  documento: string | null
  sucursal: string | null
  patente: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  tipo_vehiculo: string | null
  observaciones: string | null
  enviado_en: string | null
  aceptado_en: string | null
  poliza_id: number | null
  usuario_nombre: string | null
  creado_en: string
  actualizado_en: string
  vigente: number
  opciones: number
  desde: string | null
}

function aFila(f: FilaCruda): FilaPresupuesto {
  return {
    id: f.id,
    filaId: f.fila_id,
    numero: f.numero,
    version: f.version,
    estado: f.estado as EstadoPresupuesto,
    leadId: f.lead_id,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    telefono: f.telefono,
    documento: f.documento,
    sucursal: f.sucursal,
    patente: f.patente,
    marca: f.marca,
    modelo: f.modelo,
    anio: f.anio,
    tipoVehiculo: f.tipo_vehiculo,
    observaciones: f.observaciones,
    opciones: f.opciones,
    desde: f.desde,
    enviadoEn: f.enviado_en,
    aceptadoEn: f.aceptado_en,
    polizaId: f.poliza_id,
    usuarioNombre: f.usuario_nombre,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
    vigente: f.vigente === 1,
  }
}

function buscarPresupuesto(presupuestoId: number): FilaCruda {
  const fila = db().prepare(`${SELECT_PRESUPUESTO} WHERE p.id = ?`).get(presupuestoId) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró ese presupuesto.')
  return fila
}

function opcionesDe(presupuestoId: number, opcionAceptadaId: number | null): OpcionDePresupuesto[] {
  return (
    db()
      .prepare(
        `SELECT id, compania, cobertura, precio, precio_monto, comentario
         FROM presupuesto_opciones WHERE presupuesto_id = ?
         ORDER BY precio_monto IS NULL, precio_monto, orden, id`,
      )
      .all(presupuestoId) as Array<{
      id: number
      compania: string
      cobertura: string
      precio: string | null
      precio_monto: number | null
      comentario: string | null
    }>
  ).map((o) => ({
    id: o.id,
    compania: o.compania,
    cobertura: o.cobertura,
    precio: o.precio ?? '',
    precioMonto: o.precio_monto,
    comentario: o.comentario,
    aceptada: o.id === opcionAceptadaId,
  }))
}

/** Los presupuestos de un lead, para su ficha. Sólo las versiones vigentes: la historia está adentro. */
export function presupuestosDeLead(leadId: number): FilaPresupuesto[] {
  return (db().prepare(`${SELECT_PRESUPUESTO} WHERE p.lead_id = ? AND p.vigente = 1 ORDER BY p.id DESC`).all(leadId) as FilaCruda[]).map(aFila)
}

/** Los presupuestos de un cliente, para su ficha. */
export function presupuestosDeCliente(clienteId: number): FilaPresupuesto[] {
  return (db().prepare(`${SELECT_PRESUPUESTO} WHERE p.cliente_id = ? AND p.vigente = 1 ORDER BY p.id DESC`).all(clienteId) as FilaCruda[]).map(
    aFila,
  )
}

function normalizarFiltros(filtros: unknown): FiltrosPresupuestos {
  const f = objeto(filtros, 'Los filtros')
  const estado = limpiar(f.estado).toUpperCase()
  return {
    busqueda: limpiar(f.busqueda).slice(0, 100),
    estado: (ESTADOS_DE_PRESUPUESTO as readonly string[]).includes(estado) ? (estado as EstadoPresupuesto) : '',
    sucursales: listaDeFiltro(f.sucursales).map((v) => v.slice(0, 80)),
    incluirVersiones: f.incluirVersiones === true,
  }
}

export function listarPresupuestos(filtros: unknown): ListadoPresupuestos {
  const f = normalizarFiltros(filtros)
  const todos = (db().prepare(`${SELECT_PRESUPUESTO} ORDER BY p.id DESC`).all() as FilaCruda[]).map(aFila)
  // Las cuatro de la agencia más las que traigan los presupuestos: la sucursal que todavía no hizo
  // ninguno tiene que estar igual en el filtro, si no parece que la pantalla no la conoce.
  const sucursales = sucursalesParaElegir(todos.map((p) => p.sucursal))

  const busqueda = normalizarTexto(f.busqueda)
  const patente = normalizarPatente(f.busqueda)
  const coincide = (p: FilaPresupuesto): boolean => {
    if (!busqueda) return true
    if (patente && normalizarPatente(p.patente) === patente) return true
    return [p.clienteNombre, p.numero, p.patente, p.marca, p.modelo, p.documento].some((valor) => normalizarTexto(valor).includes(busqueda))
  }

  const visibles = todos.filter(
    (p) => (f.incluirVersiones || p.vigente) && coincideAlguno(f.sucursales, p.sucursal, mismaSucursal) && coincide(p),
  )

  const porEstado = { BORRADOR: 0, ENVIADO: 0, ACEPTADO: 0, RECHAZADO: 0 } as Record<EstadoPresupuesto, number>
  for (const p of visibles) porEstado[p.estado]++

  return {
    filas: visibles.filter((p) => !f.estado || p.estado === f.estado),
    porEstado,
    total: todos.filter((p) => p.vigente).length,
    sucursales,
    avisoDeSincronizacion: null,
    hoy: hoyLocal(),
  }
}

/** Compañías y coberturas que ya se usan, para que el formulario ofrezca las de siempre. */
function catalogos(): { companias: string[]; coberturas: string[] } {
  const companias = (
    db()
      .prepare(
        `SELECT nombre AS valor FROM companias WHERE activa = 1
         UNION SELECT DISTINCT compania FROM presupuesto_opciones WHERE compania <> ''
         ORDER BY valor`,
      )
      .all() as Array<{ valor: string }>
  )
    .map((f) => limpiar(f.valor))
    .filter(Boolean)
  const coberturas = (
    db()
      .prepare(
        `SELECT DISTINCT cobertura AS valor FROM polizas WHERE cobertura IS NOT NULL AND cobertura <> ''
         UNION SELECT DISTINCT cobertura FROM presupuesto_opciones WHERE cobertura <> ''
         ORDER BY valor`,
      )
      .all() as Array<{ valor: string }>
  )
    .map((f) => limpiar(f.valor))
    .filter(Boolean)
  return { companias: [...new Set(companias)], coberturas: [...new Set(coberturas)] }
}

export function fichaDePresupuesto(presupuestoId: number): FichaPresupuesto {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  const cruda = buscarPresupuesto(id)
  const aceptada = (db().prepare('SELECT opcion_aceptada_id AS valor FROM presupuestos WHERE id = ?').get(id) as { valor: number | null }).valor
  const presupuesto = aFila(cruda)
  const opciones = opcionesDe(id, aceptada)

  // Las versiones anteriores: se sigue la cadena hacia atrás desde ésta.
  const versiones = (
    db()
      .prepare(`${SELECT_PRESUPUESTO} WHERE p.numero = ? AND p.id <> ? ORDER BY p.version DESC`).all(cruda.numero, id) as FilaCruda[]
  ).map(aFila)

  const mensaje = armarMensaje(presupuesto, opciones)
  const telefono = telefonoParaWhatsapp(presupuesto.telefono)
  const { companias, coberturas } = catalogos()
  return {
    presupuesto,
    opciones,
    versiones,
    mensaje,
    urlWhatsapp: telefono ? `https://wa.me/${telefono}?text=${encodeURIComponent(mensaje)}` : null,
    companias,
    coberturas,
  }
}

// ---------------------------------------------------------------------------
// El mensaje de WhatsApp
// ---------------------------------------------------------------------------

/**
 * Con qué nombre se saluda en el mensaje.
 *
 * Hay dos convenciones conviviendo y hay que distinguirlas o se saluda por el apellido. Lo que viene de
 * la hoja está en MAYÚSCULAS y escrito APELLIDO NOMBRE («PEREZ JUAN CARLOS»): ahí el nombre es la
 * segunda palabra. Lo que se tipeó acá —una consulta, un presupuesto suelto— se escribe como se habla,
 * «Rubén Sosa»: ahí el nombre es la primera. La mayúscula es la pista, y es fiable: nadie carga a mano
 * un nombre todo en mayúsculas.
 */
export function saludo(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length < 2) return partes[0] ?? ''
  const deLaHoja = nombre === nombre.toUpperCase()
  return deLaHoja ? partes[1]! : partes[0]!
}

function describirVehiculo(p: FilaPresupuesto): string {
  const partes = [p.marca, p.modelo, p.anio].map((v) => limpiar(v)).filter(Boolean)
  const patente = limpiar(p.patente)
  const texto = partes.join(' ')
  if (texto && patente) return `${texto} (${patente})`
  return texto || patente || limpiar(p.tipoVehiculo)
}

/**
 * El mensaje que se manda por WhatsApp. Sale prolijo siempre: saludo, el vehículo, una línea por
 * opción con compañía, cobertura y precio, y el cierre. Sin negritas ni asteriscos raros: en WhatsApp
 * un asterisco suelto queda feo y en el escritorio ni siquiera se ve igual.
 */
export function armarMensaje(presupuesto: FilaPresupuesto, opciones: OpcionDePresupuesto[]): string {
  const lineas: string[] = []
  const quien = saludo(presupuesto.clienteNombre)
  lineas.push(`Hola${quien ? ` ${quien}` : ''}, te paso el presupuesto de ${NOMBRE_DE_LA_ASEGURADORA}.`)
  const vehiculo = describirVehiculo(presupuesto)
  if (vehiculo) lineas.push(`Vehículo: ${vehiculo}`)
  lineas.push('')

  if (opciones.length === 0) {
    lineas.push('(todavía sin opciones cargadas)')
  } else {
    opciones.forEach((opcion, indice) => {
      const precio = limpiar(opcion.precio)
      const partes = [`${indice + 1}) ${opcion.compania} — ${opcion.cobertura}`]
      if (precio) partes.push(`${precio} por mes`)
      lineas.push(partes.join(': '))
      if (limpiar(opcion.comentario)) lineas.push(`   ${limpiar(opcion.comentario)}`)
    })
  }

  if (limpiar(presupuesto.observaciones)) {
    lineas.push('')
    lineas.push(limpiar(presupuesto.observaciones))
  }
  lineas.push('')
  lineas.push('Los precios son de hoy y pueden cambiar según la compañía. Cualquier duda escribime.')
  return lineas.join('\n')
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

/** Siguiente número visible: P-0001, P-0002… Lo comparten todas las versiones del mismo presupuesto. */
function siguienteNumero(): string {
  const fila = db().prepare(`SELECT MAX(CAST(substr(numero, 3) AS INTEGER)) AS ultimo FROM presupuestos WHERE numero LIKE 'P-%'`).get() as {
    ultimo: number | null
  }
  return `P-${String((fila.ultimo ?? 0) + 1).padStart(4, '0')}`
}

interface OpcionValidada {
  compania: string
  cobertura: string
  precio: string
  precioMonto: number | null
  comentario: string
}

function validarOpciones(valor: unknown): OpcionValidada[] {
  if (!Array.isArray(valor)) throw new ErrorDeNegocio('Las opciones cotizadas no son válidas.')
  const opciones = (valor as DatosDeOpcion[])
    .map((opcion) => {
      const o = objeto(opcion, 'Una opción')
      return {
        compania: limpiar(o.compania).slice(0, 80),
        cobertura: limpiar(o.cobertura).slice(0, 80),
        precio: limpiar(o.precio).slice(0, 40),
        precioMonto: interpretarNumero(limpiar(o.precio)),
        comentario: limpiar(o.comentario).slice(0, 300),
      }
    })
    // Una fila del formulario que quedó totalmente vacía no es una opción: se descarta sin protestar.
    .filter((o) => o.compania || o.cobertura || o.precio || o.comentario)

  if (opciones.length === 0) throw new ErrorDeNegocio('Cargá al menos una opción: compañía, cobertura y precio.')
  if (opciones.length > 12) throw new ErrorDeNegocio('Son demasiadas opciones para un presupuesto (el máximo son 12).')
  for (const opcion of opciones) {
    if (!opcion.compania) throw new ErrorDeNegocio('Cada opción necesita la compañía.')
    if (!opcion.cobertura) throw new ErrorDeNegocio(`Cargá la cobertura de la opción de ${opcion.compania}.`)
  }
  return opciones
}

interface DatosValidados {
  leadId: number | null
  clienteId: number | null
  clienteNombre: string
  telefono: string
  documento: string
  sucursal: string
  patente: string
  marca: string
  modelo: string
  anio: string
  tipoVehiculo: string
  observaciones: string
  opciones: OpcionValidada[]
}

function validarDatos(datos: unknown, actor: SesionUsuario): DatosValidados {
  const d = objeto(datos, 'Los datos del presupuesto')
  const leadId = d.leadId === null || d.leadId === undefined ? null : enteroPositivo(d.leadId, 'La consulta')
  const clienteId = d.clienteId === null || d.clienteId === undefined ? null : enteroPositivo(d.clienteId, 'El cliente')

  // De quién es el presupuesto: si viene un lead o un cliente, los datos salen de ahí; si no, se
  // escriben a mano (pasa cuando alguien pregunta un precio y ni siquiera dejó el nombre completo).
  let nombre = limpiar(d.clienteNombre).slice(0, 160)
  let telefono = limpiar(d.telefono).slice(0, 60)
  let documento = limpiar(d.documento).slice(0, 40)
  let sucursal = limpiar(d.sucursal).slice(0, 80)

  if (clienteId !== null) {
    const cliente = db().prepare('SELECT nombre, telefono, documento, sucursal_texto FROM clientes WHERE id = ?').get(clienteId) as
      | { nombre: string; telefono: string | null; documento: string | null; sucursal_texto: string | null }
      | undefined
    if (!cliente) throw new ErrorDeNegocio('No se encontró ese cliente.')
    nombre = nombre || cliente.nombre
    telefono = telefono || limpiar(cliente.telefono)
    documento = documento || limpiar(cliente.documento)
    sucursal = sucursal || limpiar(cliente.sucursal_texto)
  } else if (leadId !== null) {
    const lead = db().prepare('SELECT nombre, telefono, documento, sucursal_texto, tipo_vehiculo FROM leads WHERE id = ?').get(leadId) as
      | { nombre: string; telefono: string | null; documento: string | null; sucursal_texto: string | null; tipo_vehiculo: string | null }
      | undefined
    if (!lead) throw new ErrorDeNegocio('No se encontró esa consulta.')
    nombre = nombre || lead.nombre
    telefono = telefono || limpiar(lead.telefono)
    documento = documento || limpiar(lead.documento)
    sucursal = sucursal || limpiar(lead.sucursal_texto)
  }

  if (!nombre) throw new ErrorDeNegocio('Cargá el nombre de quien pidió el presupuesto.')

  return {
    leadId,
    clienteId,
    clienteNombre: nombre,
    telefono,
    documento,
    sucursal: sucursal || actor.sucursal.nombre,
    patente: limpiar(d.patente).slice(0, 20).toUpperCase(),
    marca: limpiar(d.marca).slice(0, 80),
    modelo: limpiar(d.modelo).slice(0, 120),
    anio: limpiar(d.anio).slice(0, 10),
    tipoVehiculo: limpiar(d.tipoVehiculo).slice(0, 80),
    observaciones: limpiar(d.observaciones).slice(0, 1000),
    opciones: validarOpciones(d.opciones),
  }
}

/** Resumen de las opciones para la columna OPCIONES de la hoja: una celda, todas las compañías. */
function opcionesParaLaHoja(opciones: OpcionDePresupuesto[]): string {
  return opciones.map((o) => `${o.compania} ${o.cobertura}${limpiar(o.precio) ? ` ${limpiar(o.precio)}` : ''}`).join(' · ').slice(0, 900)
}

function camposParaLaHoja(f: FilaCruda, opciones: OpcionDePresupuesto[]): Record<string, string> {
  return {
    fecha: f.creado_en.slice(0, 10),
    numero_presupuesto: f.numero,
    version: String(f.version),
    sucursal: f.sucursal ?? '',
    nombre: f.cliente_nombre,
    telefono: f.telefono ?? '',
    documento: f.documento ?? '',
    patente: f.patente ?? '',
    marca: f.marca ?? '',
    modelo: f.modelo ?? '',
    anio: f.anio ?? '',
    opciones: opcionesParaLaHoja(opciones),
    precio: opciones.find((o) => o.precioMonto !== null)?.precio ?? '',
    estado: f.estado,
    observaciones: f.observaciones ?? '',
    usuario: f.usuario_nombre ?? '',
  }
}

/**
 * Guarda el presupuesto con sus opciones y lo encola. Es el camino único del alta y de la versión
 * nueva: la única diferencia es el número (que se hereda) y de qué versión viene.
 */
function insertar(
  campos: DatosValidados,
  actor: SesionUsuario,
  anterior: { numero: string; version: number; id: number } | null,
): number {
  const filaId = generarId()
  const pestana = pestanaDePresupuestos()
  const ahora = ahoraIso()
  const numero = anterior?.numero ?? siguienteNumero()
  const version = anterior ? anterior.version + 1 : 1

  const id = db().transaction(() => {
    const resultado = db()
      .prepare(
        `INSERT INTO presupuestos (fila_id, pestana, numero, version, presupuesto_anterior_id, vigente, lead_id,
                                   cliente_id, cliente_nombre, telefono, documento, sucursal_texto, patente, marca,
                                   modelo, anio, tipo_vehiculo, observaciones, estado, usuario_id, usuario_nombre,
                                   creado_en, actualizado_en)
         VALUES (@fila_id, @pestana, @numero, @version, @anterior_id, 1, @lead_id, @cliente_id, @cliente_nombre,
                 @telefono, @documento, @sucursal, @patente, @marca, @modelo, @anio, @tipo_vehiculo,
                 @observaciones, 'BORRADOR', @usuario_id, @usuario_nombre, @ahora, @ahora)`,
      )
      .run({
        fila_id: filaId,
        pestana,
        numero,
        version,
        anterior_id: anterior?.id ?? null,
        lead_id: campos.leadId,
        cliente_id: campos.clienteId,
        cliente_nombre: campos.clienteNombre,
        telefono: campos.telefono || null,
        documento: campos.documento || null,
        sucursal: campos.sucursal || null,
        patente: campos.patente || null,
        marca: campos.marca || null,
        modelo: campos.modelo || null,
        anio: campos.anio || null,
        tipo_vehiculo: campos.tipoVehiculo || null,
        observaciones: campos.observaciones || null,
        usuario_id: actor.id,
        usuario_nombre: actor.nombre,
        ahora,
      })
    const nuevo = Number(resultado.lastInsertRowid)

    const insertarOpcion = db().prepare(
      `INSERT INTO presupuesto_opciones (presupuesto_id, compania, cobertura, precio, precio_monto, comentario, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    campos.opciones.forEach((opcion, orden) => {
      insertarOpcion.run(nuevo, opcion.compania, opcion.cobertura, opcion.precio || null, opcion.precioMonto, opcion.comentario || null, orden)
    })

    // La versión anterior deja de ser la vigente: sigue existiendo, pero ya no es la que se muestra.
    if (anterior) db().prepare('UPDATE presupuestos SET vigente = 0, actualizado_en = ? WHERE id = ?').run(ahora, anterior.id)

    registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'APP_PRESUPUESTOS', periodo: null })
    return nuevo
  })()

  const cruda = buscarPresupuesto(id)
  encolar({ operacion: 'crear', pestana, filaId, campos: camposParaLaHoja(cruda, opcionesDe(id, null)) }, actor)

  registrarCambio(actor, {
    accion: 'presupuesto',
    tabla: 'presupuestos',
    registroId: id,
    filaId,
    campo: anterior ? 'NUEVA VERSION' : 'ALTA DE PRESUPUESTO',
    valorAnterior: anterior ? `${numero} v${anterior.version}` : null,
    valorNuevo: `${numero} v${version} · ${campos.clienteNombre} · ${campos.opciones.length} opción(es)`,
  })
  // Si el presupuesto es de un lead, ese lead pasó a estar COTIZADO: es exactamente lo que significa.
  if (campos.leadId !== null) marcarLeadCotizado(campos.leadId, actor)
  return id
}

/** El lead con presupuesto está COTIZADO. No se pisa un GANADO ni un PERDIDO: ésos ya se cerraron. */
function marcarLeadCotizado(leadId: number, actor: SesionUsuario): void {
  const lead = db().prepare('SELECT id, fila_id, estado, pestana FROM leads WHERE id = ?').get(leadId) as
    | { id: number; fila_id: string; estado: string; pestana: string }
    | undefined
  if (!lead || ['COTIZADO', 'GANADO', 'PERDIDO'].includes(lead.estado)) return
  db().prepare(`UPDATE leads SET estado = 'COTIZADO', actualizado_en = ? WHERE id = ?`).run(ahoraIso(), leadId)
  encolar({ operacion: 'actualizar', pestana: lead.pestana, filaId: lead.fila_id, campos: { estado: 'COTIZADO' } }, actor)
  registrarCambio(actor, {
    accion: 'lead',
    tabla: 'leads',
    registroId: leadId,
    filaId: lead.fila_id,
    campo: 'ESTADO',
    valorAnterior: lead.estado,
    valorNuevo: 'COTIZADO',
  })
}

export function crearPresupuesto(datos: DatosDePresupuesto, actor: SesionUsuario): FichaPresupuesto {
  return fichaDePresupuesto(insertar(validarDatos(datos, actor), actor, null))
}

/**
 * Guardar los cambios de un presupuesto.
 *
 * Mientras está en BORRADOR se edita en el lugar: todavía no lo vio nadie. Una vez ENVIADO (o
 * ACEPTADO, o RECHAZADO) ya salió de la agencia, así que guardar crea la versión siguiente y la
 * anterior queda intacta.
 */
export function guardarPresupuesto(presupuestoId: number, datos: DatosDePresupuesto, actor: SesionUsuario): FichaPresupuesto {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  const actual = buscarPresupuesto(id)
  if (actual.vigente !== 1) {
    throw new ErrorDeNegocio(`El presupuesto ${actual.numero} v${actual.version} es una versión vieja: abrí la última para modificarla.`)
  }
  const campos = validarDatos(datos, actor)

  if (actual.estado !== 'BORRADOR') {
    return fichaDePresupuesto(insertar(campos, actor, { numero: actual.numero, version: actual.version, id }))
  }

  const ahora = ahoraIso()
  db().transaction(() => {
    db()
      .prepare(
        `UPDATE presupuestos SET lead_id = @lead_id, cliente_id = @cliente_id, cliente_nombre = @cliente_nombre,
                telefono = @telefono, documento = @documento, sucursal_texto = @sucursal, patente = @patente,
                marca = @marca, modelo = @modelo, anio = @anio, tipo_vehiculo = @tipo_vehiculo,
                observaciones = @observaciones, actualizado_en = @ahora
         WHERE id = @id`,
      )
      .run({
        lead_id: campos.leadId,
        cliente_id: campos.clienteId,
        cliente_nombre: campos.clienteNombre,
        telefono: campos.telefono || null,
        documento: campos.documento || null,
        sucursal: campos.sucursal || null,
        patente: campos.patente || null,
        marca: campos.marca || null,
        modelo: campos.modelo || null,
        anio: campos.anio || null,
        tipo_vehiculo: campos.tipoVehiculo || null,
        observaciones: campos.observaciones || null,
        ahora,
        id,
      })
    db().prepare('DELETE FROM presupuesto_opciones WHERE presupuesto_id = ?').run(id)
    const insertarOpcion = db().prepare(
      `INSERT INTO presupuesto_opciones (presupuesto_id, compania, cobertura, precio, precio_monto, comentario, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    campos.opciones.forEach((opcion, orden) => {
      insertarOpcion.run(id, opcion.compania, opcion.cobertura, opcion.precio || null, opcion.precioMonto, opcion.comentario || null, orden)
    })
  })()

  const cruda = buscarPresupuesto(id)
  encolar(
    { operacion: 'actualizar', pestana: pestanaDePresupuestos(), filaId: cruda.fila_id, campos: camposParaLaHoja(cruda, opcionesDe(id, null)) },
    actor,
  )
  registrarCambio(actor, {
    accion: 'presupuesto',
    tabla: 'presupuestos',
    registroId: id,
    filaId: cruda.fila_id,
    campo: 'PRESUPUESTO',
    valorAnterior: `${actual.opciones} opción(es)`,
    valorNuevo: `${campos.opciones.length} opción(es)`,
  })
  if (campos.leadId !== null) marcarLeadCotizado(campos.leadId, actor)
  return fichaDePresupuesto(id)
}

// ---------------------------------------------------------------------------
// Enviar, aceptar y rechazar
// ---------------------------------------------------------------------------

function cambiarEstado(id: number, estado: EstadoPresupuesto, actor: SesionUsuario, extra: Record<string, string | number | null> = {}): void {
  const actual = buscarPresupuesto(id)
  const asignaciones = Object.keys(extra).map((c) => `${c} = @${c}`)
  db()
    .prepare(`UPDATE presupuestos SET estado = @estado, ${[...asignaciones, 'actualizado_en = @ahora'].join(', ')} WHERE id = @id`)
    .run({ estado, ...extra, ahora: ahoraIso(), id })
  encolar({ operacion: 'actualizar', pestana: pestanaDePresupuestos(), filaId: actual.fila_id, campos: { estado } }, actor)
  registrarCambio(actor, {
    accion: 'presupuesto',
    tabla: 'presupuestos',
    registroId: id,
    filaId: actual.fila_id,
    campo: 'ESTADO',
    valorAnterior: actual.estado,
    valorNuevo: estado,
  })
}

/**
 * «Enviar por WhatsApp»: devuelve la dirección lista para abrir y deja el presupuesto en ENVIADO.
 * Se marca acá y no cuando vuelve el navegador porque desde la aplicación no hay forma de saber si el
 * mensaje se mandó; lo que sí se sabe es que se abrió el WhatsApp de esa persona con este texto.
 */
export function enviarPresupuesto(presupuestoId: number, actor: SesionUsuario): EnvioDePresupuesto {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  const ficha = fichaDePresupuesto(id)
  const telefono = telefonoParaWhatsapp(ficha.presupuesto.telefono)
  if (!telefono) {
    throw new ErrorDeNegocio(`«${ficha.presupuesto.clienteNombre}» no tiene teléfono cargado: completalo y volvé a intentar.`)
  }
  if (ficha.opciones.length === 0) throw new ErrorDeNegocio('Cargá al menos una opción antes de mandarlo.')

  if (ficha.presupuesto.estado === 'BORRADOR') {
    cambiarEstado(id, 'ENVIADO', actor, { enviado_en: ahoraIso() })
  }
  const actualizada = fichaDePresupuesto(id)
  return {
    url: `https://wa.me/${telefono}?text=${encodeURIComponent(actualizada.mensaje)}`,
    mensaje: actualizada.mensaje,
    telefono,
    ficha: actualizada,
  }
}

/**
 * El cliente eligió una opción. El presupuesto queda ACEPTADO y se devuelve con qué cliente se puede
 * emitir la póliza; si era de un lead sin convertir, se avisa que primero hay que convertirlo.
 */
export function aceptarPresupuesto(presupuestoId: number, opcionId: unknown, actor: SesionUsuario): AceptacionDePresupuesto {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  const actual = buscarPresupuesto(id)
  const opcion = enteroPositivo(opcionId, 'La opción')
  const elegida = db().prepare('SELECT id, compania, cobertura, precio FROM presupuesto_opciones WHERE id = ? AND presupuesto_id = ?').get(
    opcion,
    id,
  ) as { id: number; compania: string; cobertura: string; precio: string | null } | undefined
  if (!elegida) throw new ErrorDeNegocio('Esa opción no es de este presupuesto.')

  cambiarEstado(id, 'ACEPTADO', actor, { aceptado_en: ahoraIso(), opcion_aceptada_id: elegida.id })
  registrarCambio(actor, {
    accion: 'presupuesto',
    tabla: 'presupuestos',
    registroId: id,
    filaId: actual.fila_id,
    campo: 'OPCION ACEPTADA',
    valorAnterior: null,
    valorNuevo: `${elegida.compania} · ${elegida.cobertura}${elegida.precio ? ` · ${elegida.precio}` : ''}`,
  })

  const ficha = fichaDePresupuesto(id)
  return {
    ficha,
    clienteId: ficha.presupuesto.clienteId,
    aviso:
      ficha.presupuesto.clienteId === null
        ? 'Este presupuesto todavía no tiene cliente. Convertí la consulta en cliente y desde ahí emitís la póliza con estos datos.'
        : null,
  }
}

export function rechazarPresupuesto(presupuestoId: number, motivo: unknown, actor: SesionUsuario): FichaPresupuesto {
  const id = enteroPositivo(presupuestoId, 'El presupuesto')
  const razon = limpiar(motivo).slice(0, 300)
  const actual = buscarPresupuesto(id)
  cambiarEstado(id, 'RECHAZADO', actor)
  if (razon) {
    const observaciones = [limpiar(actual.observaciones), `No lo tomó: ${razon}`].filter(Boolean).join(' · ').slice(0, 1000)
    db().prepare('UPDATE presupuestos SET observaciones = ?, actualizado_en = ? WHERE id = ?').run(observaciones, ahoraIso(), id)
    encolar({ operacion: 'actualizar', pestana: pestanaDePresupuestos(), filaId: actual.fila_id, campos: { observaciones } }, actor)
  }
  return fichaDePresupuesto(id)
}

/** La póliza ya se emitió a partir de este presupuesto: queda anotado de dónde salió la venta. */
export function anotarPolizaDelPresupuesto(presupuestoId: number, polizaId: number, actor: SesionUsuario): void {
  const actual = buscarPresupuesto(presupuestoId)
  db().prepare('UPDATE presupuestos SET poliza_id = ?, actualizado_en = ? WHERE id = ?').run(polizaId, ahoraIso(), presupuestoId)
  registrarCambio(actor, {
    accion: 'presupuesto',
    tabla: 'presupuestos',
    registroId: presupuestoId,
    filaId: actual.fila_id,
    campo: 'POLIZA EMITIDA',
    valorAnterior: null,
    valorNuevo: `Póliza ${polizaId}`,
  })
}

// ---------------------------------------------------------------------------
// El papel: HTML listo para imprimir o guardar como PDF
// ---------------------------------------------------------------------------

function escapar(valor: string): string {
  return valor.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fechaLegible(iso: string): string {
  const dia = iso.slice(8, 10)
  const mes = iso.slice(5, 7)
  const anio = iso.slice(0, 4)
  return dia && mes && anio ? `${dia}/${mes}/${anio}` : iso.slice(0, 10)
}

/**
 * El presupuesto en una hoja A4. Formato simple a propósito: encabezado con el nombre de la
 * aseguradora, los datos de quién es y para qué vehículo, la tabla de opciones y el pie. Nada de
 * logos: una imagen que no carga sale peor que no ponerla.
 */
export function htmlDelPresupuesto(ficha: FichaPresupuesto): string {
  const p = ficha.presupuesto
  const dato = (etiqueta: string, valor: string | null): string =>
    limpiar(valor) ? `<tr><th>${escapar(etiqueta)}</th><td>${escapar(limpiar(valor))}</td></tr>` : ''
  const vehiculo = describirVehiculo(p)

  const filas = ficha.opciones
    .map(
      (opcion) => `<tr${opcion.aceptada ? ' class="elegida"' : ''}>
      <td>${escapar(opcion.compania)}</td>
      <td>${escapar(opcion.cobertura)}</td>
      <td class="precio">${escapar(limpiar(opcion.precio) || '—')}</td>
      <td class="comentario">${escapar(limpiar(opcion.comentario))}</td>
    </tr>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Presupuesto ${escapar(p.numero)}</title><style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; color: #14243d; }
  header { border-bottom: 2px solid #12315d; padding-bottom: 8mm; margin-bottom: 8mm; }
  h1 { margin: 0; font-size: 17pt; letter-spacing: .5px; color: #12315d; }
  .sub { margin: 1mm 0 0; font-size: 10pt; color: #55627a; }
  .numero { float: right; text-align: right; font-size: 10pt; color: #55627a; }
  .numero strong { display: block; font-size: 14pt; color: #12315d; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: .08em; color: #55627a; margin: 0 0 3mm; }
  table.datos { border-collapse: collapse; margin-bottom: 8mm; }
  table.datos th { text-align: left; font-weight: normal; color: #55627a; padding: .8mm 6mm .8mm 0; white-space: nowrap; vertical-align: top; }
  table.datos td { padding: .8mm 0; font-weight: bold; }
  table.opciones { width: 100%; border-collapse: collapse; margin-bottom: 8mm; }
  table.opciones th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; color: #55627a;
                      border-bottom: 1px solid #c9d2e0; padding: 0 3mm 2mm 0; }
  table.opciones td { border-bottom: 1px solid #e6eaf1; padding: 2.5mm 3mm 2.5mm 0; vertical-align: top; }
  table.opciones td.precio { font-weight: bold; white-space: nowrap; }
  table.opciones td.comentario { color: #55627a; font-size: 10pt; }
  table.opciones tr.elegida td { background: #eef5ec; }
  .observaciones { border-left: 3px solid #c9d2e0; padding-left: 4mm; color: #33415c; margin-bottom: 8mm; }
  footer { border-top: 1px solid #c9d2e0; padding-top: 4mm; font-size: 9pt; color: #55627a; }
</style></head><body>
  <header>
    <div class="numero">Presupuesto <strong>${escapar(p.numero)}</strong>${p.version > 1 ? `versión ${p.version}` : ''}</div>
    <h1>${escapar(NOMBRE_DE_LA_ASEGURADORA)}</h1>
    <p class="sub">${escapar(limpiar(p.sucursal) || 'Casa central')} · ${escapar(fechaLegible(p.creadoEn))}</p>
  </header>

  <h2>Datos</h2>
  <table class="datos">
    ${dato('Cliente', p.clienteNombre)}
    ${dato('DNI/CUIT', p.documento)}
    ${dato('Teléfono', p.telefono)}
    ${dato('Vehículo', vehiculo)}
    ${dato('Uso', p.tipoVehiculo)}
  </table>

  <h2>Opciones cotizadas</h2>
  <table class="opciones">
    <thead><tr><th>Compañía</th><th>Cobertura</th><th>Precio mensual</th><th>Comentario</th></tr></thead>
    <tbody>${filas || '<tr><td colspan="4">Sin opciones cargadas.</td></tr>'}</tbody>
  </table>

  ${limpiar(p.observaciones) ? `<div class="observaciones">${escapar(limpiar(p.observaciones))}</div>` : ''}

  <footer>
    Los precios son los vigentes al ${escapar(fechaLegible(p.creadoEn))} y pueden variar según la compañía, la zona y los
    datos definitivos del vehículo. Este presupuesto no constituye cobertura: la cobertura empieza con la póliza emitida.
  </footer>
</body></html>`
}

/** El HTML del presupuesto y el nombre de archivo sugerido, para el PDF. */
export function presupuestoParaImprimir(presupuestoId: number): { html: string; nombreDeArchivo: string } {
  const ficha = fichaDePresupuesto(enteroPositivo(presupuestoId, 'El presupuesto'))
  const nombre = ficha.presupuesto.clienteNombre.replace(/[<>:"/\\|?*]/g, '-').trim().slice(0, 60)
  return {
    html: htmlDelPresupuesto(ficha),
    nombreDeArchivo: `Presupuesto ${ficha.presupuesto.numero}${ficha.presupuesto.version > 1 ? ` v${ficha.presupuesto.version}` : ''} - ${nombre}.pdf`,
  }
}

