// Lo que se carga en un mostrador se ve en los otros (12.7), segunda parte: las consultas, los
// presupuestos, las tareas enganchadas a su ficha, los borrados, y la importación acotada que hace que
// todo eso llegue sin releer la base entera.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { usarCarpetaDeAdjuntosDePrueba } from '../src/main/servicios/adjuntos'
import { ejecutarEliminacion } from '../src/main/servicios/eliminacion'
import { agregarNotaDeLead, crearLead, fichaDeLead, listarLeads } from '../src/main/servicios/leads'
import { estadoDelImportador, hayImportacionEnCurso, iniciarImportacion, reservarImportacionAutomatica } from '../src/main/servicios/importacion'
import { crearPresupuesto, fichaDePresupuesto } from '../src/main/servicios/presupuestos'
import { obtenerMotor, usarFuenteDePrueba } from '../src/main/servicios/sincronizacion'
import { crearTareaDeSiniestro, fichaDeSiniestro, listarSiniestros } from '../src/main/servicios/siniestros'
import { crearTareaCompleta, fichaDeTarea, listarTareas } from '../src/main/servicios/tareas'
import { apurarAgrupadas, cuantasFallidas, cuantasPendientes } from '../src/main/sincronizacion/cola'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import type { DatosDeLead, DatosDePresupuesto, DatosDeTareaCompleta, FiltrosSiniestros, InformeImportacion, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 4, nombre: 'Daniel' }, debeCambiarClave: false }
const FEDE: SesionUsuario = { id: 2, nombre: 'Fede', usuario: 'fede', rol: 'EMPLEADO', sucursal: { id: 1, nombre: 'Dock Sud' }, debeCambiarClave: false }
const MILAGROS: SesionUsuario = { id: 4, nombre: 'Milagros', usuario: 'milagros', rol: 'EMPLEADO', sucursal: { id: 2, nombre: 'Lanús' }, debeCambiarClave: false }

const SIN_FILTROS: FiltrosSiniestros = { periodo: '', busqueda: '', sucursales: [], companias: [], estado: '', soloRobos: false }
const FILTROS_COMERCIALES = {
  busqueda: '',
  estado: '',
  origenes: [],
  sucursales: [],
  companias: [],
  prioridades: [],
  responsableIds: [],
  incluirCerrados: true,
  incluirVersiones: true,
}

const LEAD_VACIO: DatosDeLead = { nombre: '', telefono: '', sucursal: '', interes: '', tipoVehiculo: '', origen: '', estado: '', documento: '', email: '', nota: '' }
const PRESUPUESTO_VACIO: DatosDePresupuesto = {
  leadId: null,
  clienteId: null,
  clienteNombre: '',
  telefono: '',
  documento: '',
  sucursal: '',
  patente: '',
  marca: '',
  modelo: '',
  anio: '',
  tipoVehiculo: '',
  observaciones: '',
  opciones: [],
}
const TAREA_VACIA: DatosDeTareaCompleta = {
  titulo: '',
  detalle: '',
  responsableId: null,
  sucursal: '',
  venceEl: '',
  prioridad: '',
  clienteId: null,
  polizaId: null,
  siniestroId: null,
  renovacionId: null,
  leadId: null,
  presupuestoId: null,
}

/** Los adjuntos de todas las pruebas van a una carpeta temporal, no a los datos de nadie. */
const CARPETA_DE_ADJUNTOS = mkdtempSync(path.join(tmpdir(), 'dm-comercial-'))
usarCarpetaDeAdjuntosDePrueba(CARPETA_DE_ADJUNTOS)
process.on('exit', () => rmSync(CARPETA_DE_ADJUNTOS, { recursive: true, force: true }))

interface Computadora {
  nombre: string
  db: BaseDeDatos
  motor: MotorDeSincronizacion
  /** El informe de la última importación que corrió el motor, para ver qué pestañas guardó. */
  ultimaImportacion: InformeImportacion | null
}

const abiertas: Computadora[] = []

function en(pc: Computadora): void {
  usarBaseDeDatos(pc.db)
}

async function computadora(hoja: HojaSimulada, nombre: string): Promise<Computadora> {
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const alta = db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES (@id, @nombre, @usuario, 'sin-clave', @rol, (SELECT id FROM sucursales WHERE nombre = @sucursal), 1, 0)`,
  )
  for (const persona of [FEDE, MILAGROS]) {
    alta.run({ id: persona.id, nombre: persona.nombre, usuario: persona.usuario, rol: persona.rol, sucursal: persona.sucursal.nombre })
  }
  const pc: Computadora = { nombre, db, motor: null as unknown as MotorDeSincronizacion, ultimaImportacion: null }
  const importar = async (pestanas?: string[]) => {
    usarBaseDeDatos(db)
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    pc.ultimaImportacion = await ejecutarImportacion({ db, fuente: hoja, importacionId: id, soloPestanas: pestanas })
  }
  await importar()
  pc.motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar })
  pc.motor.encender()
  abiertas.push(pc)
  return pc
}

async function dosComputadoras(): Promise<{ hoja: HojaSimulada; lanus: Computadora; dockSud: Computadora }> {
  cerrarTodo()
  const hoja = new HojaSimulada(construirHojaDePrueba().filter((p) => p.titulo !== 'IMPUTADOS'))
  usarFuenteDePrueba(hoja)
  const lanus = await computadora(hoja, 'Lanús')
  const dockSud = await computadora(hoja, 'Dock Sud')
  return { hoja, lanus, dockSud }
}

function cerrarTodo(): void {
  for (const pc of abiertas) {
    pc.motor.apagar()
    pc.db.close()
  }
  abiertas.length = 0
  usarFuenteDePrueba(null)
  cerrarBaseDeDatos()
}

async function subirTodo(pc: Computadora): Promise<void> {
  en(pc)
  apurarAgrupadas()
  await pc.motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 0, `${pc.nombre}: ninguna entrada tiene que quedar sin arreglo`)
  assert.equal(cuantasPendientes(), 0, `${pc.nombre}: la cola tiene que quedar vacía`)
}

function estadoDePestana(informe: InformeImportacion | null, titulo: string): string | undefined {
  return informe?.pestanas.find((p) => p.titulo === titulo)?.estado
}

// ---------------------------------------------------------------------------
// Consultas y presupuestos
// ---------------------------------------------------------------------------

test('una consulta con su nota y un presupuesto con sus opciones llegan enteros a la otra computadora', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const lead = crearLead(
    { ...LEAD_VACIO, nombre: 'Marcela Ibáñez', telefono: '11 5555-4444', interes: 'El Gol de la hija', tipoVehiculo: 'Auto', origen: 'WHATSAPP', nota: 'Preguntó por terceros completo.' },
    MILAGROS,
  )
  agregarNotaDeLead(lead.lead.id, 'Le mando el presupuesto mañana', MILAGROS)
  const presupuesto = crearPresupuesto(
    {
      ...PRESUPUESTO_VACIO,
      leadId: lead.lead.id,
      marca: 'VOLKSWAGEN',
      modelo: 'GOL TREND',
      anio: '2016',
      patente: 'AB123CD',
      observaciones: 'Los precios son con débito automático.',
      opciones: [
        { compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 52.400', comentario: 'Franquicia $ 250.000' },
        { compania: 'RIVADAVIA', cobertura: 'TERCEROS COMPLETO', precio: '$ 47.900', comentario: '' },
      ],
    },
    MILAGROS,
  )
  await subirTodo(lanus)
  assert.ok(hoja.titulos().includes('APP LEADS') && hoja.titulos().includes('APP PRESUPUESTOS'))
  assert.ok(hoja.encabezadosDe('APP PRESUPUESTOS').includes('OPCIONES JSON'), 'las opciones viajan enteras')
  assert.ok(hoja.encabezadosDe('APP PRESUPUESTOS').includes('VINCULO ID'), 'y el presupuesto dice de qué consulta salió')

  en(dockSud)
  const bajada = await dockSud.motor.ciclarBajada()
  assert.ok(bajada)
  assert.equal(bajada.necesitaImportacion, true, 'las filas nuevas piden importar…')
  // …pero sólo las pestañas con novedades: la consulta, el presupuesto y las notas (que no se pueden
  // colgar hasta que la consulta exista acá, y por eso también piden la importación).
  assert.deepEqual([...bajada.pestanasConFilasNuevas].sort(), ['APP COMENTARIOS', 'APP LEADS', 'APP PRESUPUESTOS'])
  assert.equal(estadoDePestana(dockSud.ultimaImportacion, 'APP LEADS'), 'lista')
  assert.equal(estadoDePestana(dockSud.ultimaImportacion, 'AGOSTO'), 'omitida', 'la planilla del mes ni se tocó: importación acotada')

  // La consulta, con su estado y sus notas.
  const leadsAlla = listarLeads(FILTROS_COMERCIALES).filas
  const leadAlla = leadsAlla.find((l) => l.nombre === 'Marcela Ibáñez')
  assert.ok(leadAlla, `la consulta llegó a la otra computadora: ${leadsAlla.map((l) => l.nombre).join(', ')}`)
  assert.equal(leadAlla.origen, 'WHATSAPP')
  assert.equal(leadAlla.estado, 'COTIZADO', 'con presupuesto, la consulta ya estaba COTIZADA')
  assert.equal(leadAlla.telefono, '11 5555-4444')
  const fichaAlla = fichaDeLead(leadAlla.id)
  const notas = fichaAlla.notas.map((n) => n.texto)
  assert.ok(notas.includes('Preguntó por terceros completo.'), `las notas viajaron: ${notas.join(' | ')}`)
  assert.ok(notas.includes('Le mando el presupuesto mañana'))
  assert.equal(fichaAlla.presupuestos.length, 1, 'y el presupuesto cuelga de la consulta también acá')

  // El presupuesto, con sus opciones y ordenado como allá.
  const presupuestoAlla = fichaDePresupuesto(fichaAlla.presupuestos[0]!.id)
  assert.equal(presupuestoAlla.presupuesto.numero, presupuesto.presupuesto.numero)
  assert.equal(presupuestoAlla.presupuesto.marca, 'VOLKSWAGEN')
  assert.equal(presupuestoAlla.presupuesto.vigente, true)
  assert.equal(presupuestoAlla.opciones.length, 2)
  assert.equal(presupuestoAlla.opciones[0]!.compania, 'RIVADAVIA', 'la más barata primero, como allá')
  assert.equal(presupuestoAlla.opciones[0]!.precio, '$ 47.900')
  assert.equal(presupuestoAlla.opciones[1]!.comentario, 'Franquicia $ 250.000')

  // Una nota más, por el carril rápido; y a la inversa, el estado cambia allá y se ve acá.
  en(lanus)
  agregarNotaDeLead(lead.lead.id, 'Aceptó', MILAGROS)
  await subirTodo(lanus)
  en(dockSud)
  await dockSud.motor.ciclarTareas()
  assert.ok(fichaDeLead(leadAlla.id).notas.some((n) => n.texto === 'Aceptó'), 'la nota nueva llega sin importar nada')

  // Reimportar todo no duplica ni desordena nada.
  for (const pc of [lanus, dockSud]) {
    en(pc)
    await pc.motor.ciclarBajada(true)
    assert.equal(listarLeads(FILTROS_COMERCIALES).filas.filter((l) => l.nombre === 'Marcela Ibáñez').length, 1, `${pc.nombre}: una sola consulta`)
    const suyo = fichaDeLead(listarLeads(FILTROS_COMERCIALES).filas.find((l) => l.nombre === 'Marcela Ibáñez')!.id)
    assert.equal(suyo.notas.length, 3, `${pc.nombre}: tres notas, ni una repetida`)
    assert.equal(suyo.presupuestos.length, 1)
    assert.equal(fichaDePresupuesto(suyo.presupuestos[0]!.id).opciones.length, 2, `${pc.nombre}: dos opciones`)
  }
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Las tareas llegan enganchadas a su ficha
// ---------------------------------------------------------------------------

test('la tarea de un siniestro aparece en la ficha del siniestro de la otra computadora', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  crearTareaDeSiniestro({ siniestroId: robo.id, titulo: 'Pedir la denuncia policial', detalle: '', responsableId: FEDE.id, venceEl: '' }, MILAGROS)
  // Y una tarea del cliente de González, desde el módulo de tareas.
  const gonzalez = lanus.db.prepare('SELECT id FROM clientes WHERE nombre = ?').get(CLIENTES.gonzalez.nombre) as { id: number }
  crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Llamar por la renovación', clienteId: gonzalez.id, responsableId: FEDE.id }, MILAGROS)
  await subirTodo(lanus)
  assert.ok(hoja.encabezadosDe('APP TAREAS').includes('VINCULO ID'), 'la clave del vínculo viaja en su columna')

  en(dockSud)
  await dockSud.motor.ciclarBajada()
  const idAlla = (dockSud.db.prepare('SELECT id FROM siniestros WHERE fila_id = ?').get(robo.filaId) as { id: number }).id
  const ficha = fichaDeSiniestro(idAlla)
  assert.equal(ficha.tareas.length, 1, 'la tarea cuelga del siniestro también en la otra computadora')
  assert.equal(ficha.tareas[0]!.titulo, 'Pedir la denuncia policial')
  assert.equal(listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!.tareasPendientes, 1, 'y el listado la cuenta')
  const tareas = listarTareas(FILTROS_COMERCIALES).filas
  const delCliente = tareas.find((t) => t.titulo === 'Llamar por la renovación')
  assert.ok(delCliente)
  assert.equal(delCliente.vinculo, 'cliente', 'la tarea del cliente llegó enganchada al cliente')
  assert.equal(delCliente.vinculoTexto, CLIENTES.gonzalez.nombre)
  cerrarTodo()
})

test('una tarea cargada con la versión anterior se engancha al arrancar la nueva', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  const ficha = crearTareaDeSiniestro({ siniestroId: robo.id, titulo: 'Pedir el presupuesto del taller', detalle: '', responsableId: null, venceEl: '' }, MILAGROS)
  const tareaId = ficha.tareas[0]!.id
  // Como la dejó la 12.6: sin clave en la base ni en la cola.
  lanus.db.prepare('UPDATE tareas SET vinculo_clave = NULL WHERE id = ?').run(tareaId)
  const entrada = lanus.db.prepare(`SELECT id, campos_json FROM cola_sync WHERE estado = 'pendiente' AND pestana = 'APP TAREAS'`).get() as { id: number; campos_json: string }
  const campos = JSON.parse(entrada.campos_json) as Record<string, string>
  delete campos.vinculo_clave
  lanus.db.prepare('UPDATE cola_sync SET campos_json = ? WHERE id = ?').run(JSON.stringify(campos), entrada.id)
  await subirTodo(lanus)
  assert.ok(hoja.filasDe('APP TAREAS').length >= 2, 'la tarea está en la pestaña, sin clave de vínculo')

  en(dockSud)
  await dockSud.motor.ciclarBajada()
  const idAlla = (dockSud.db.prepare('SELECT id FROM siniestros WHERE fila_id = ?').get(robo.filaId) as { id: number }).id
  assert.equal(fichaDeSiniestro(idAlla).tareas.length, 0, 'sin la clave, la tarea llegó suelta (así estaba en la 12.6)')

  // El arranque de la 12.7 en Lanús manda la clave; Dock Sud la recibe por la bajada y engancha la tarea.
  en(lanus)
  const { reenviarVinculosDeTareas } = await import('../src/main/servicios/reparaciones')
  assert.equal(reenviarVinculosDeTareas(), 1)
  await subirTodo(lanus)
  en(dockSud)
  const bajada = await dockSud.motor.ciclarBajada()
  assert.equal(bajada?.necesitaImportacion, false)
  assert.equal(fichaDeSiniestro(idAlla).tareas.length, 1, 'ahora cuelga del siniestro')
  assert.equal(fichaDeTarea(fichaDeSiniestro(idAlla).tareas[0]!.id, FEDE).tarea.vinculo, 'siniestro')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Lo que se borra en una computadora desaparece de la otra
// ---------------------------------------------------------------------------

test('un siniestro borrado en una computadora desaparece de la otra, con sus observaciones', async () => {
  const { lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  const antes = listarSiniestros(SIN_FILTROS).total
  ejecutarEliminacion('siniestro', robo.id, DANIEL)
  await subirTodo(lanus)

  en(dockSud)
  assert.ok(dockSud.db.prepare('SELECT id FROM siniestros WHERE fila_id = ?').get(robo.filaId), 'antes de bajar, la otra computadora todavía lo tiene')
  await dockSud.motor.ciclarBajada()
  assert.equal(dockSud.db.prepare('SELECT id FROM siniestros WHERE fila_id = ?').get(robo.filaId), undefined, 'después de bajar, no')
  assert.equal(listarSiniestros(SIN_FILTROS).total, antes - 1)
  assert.equal(listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas.length, 0, 'ni fantasma en el listado')
  cerrarTodo()
})

test('una tarea borrada en una computadora desaparece de la otra', async () => {
  const { lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Ordenar el archivo', responsableId: FEDE.id }, MILAGROS)
  await subirTodo(lanus)
  en(dockSud)
  await dockSud.motor.ciclarBajada()
  assert.ok(listarTareas(FILTROS_COMERCIALES).filas.some((t) => t.titulo === 'Ordenar el archivo'))

  en(lanus)
  ejecutarEliminacion('tarea', tarea.id, DANIEL)
  await subirTodo(lanus)
  en(dockSud)
  await dockSud.motor.ciclarTareas()
  assert.ok(!listarTareas(FILTROS_COMERCIALES).filas.some((t) => t.titulo === 'Ordenar el archivo'), 'la tarea borrada allá ya no está acá')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// La importación automática y el botón «Reimportar la base» no se pisan
// ---------------------------------------------------------------------------

test('la importación automática figura como en curso y se saltea mientras corre una manual', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  crearLead({ ...LEAD_VACIO, nombre: 'Rosa Quiroga', telefono: '11 4444-1111', origen: 'WHATSAPP' }, MILAGROS)
  await subirTodo(lanus)

  // En Dock Sud baja el motor del programa, que es el que corre la importación automática.
  en(dockSud)
  const motor = obtenerMotor()
  motor.encender()
  const enCursoAlLeer: boolean[] = []
  const estructura = hoja.estructura.bind(hoja)
  hoja.estructura = async () => {
    enCursoAlLeer.push(hayImportacionEnCurso())
    return estructura()
  }
  // La reserva y el parche de `estructura` se sueltan sí o sí: si una aserción del medio falla, dejar
  // el «en curso» tomado hace fallar todas las pruebas siguientes con «Ya hay una importación en curso»
  // y tapa la falla de verdad.
  let otra: ReturnType<typeof reservarImportacionAutomatica> = null
  try {
    // Alguien tiene una importación corriendo: la automática no arranca encima y queda para la
    // próxima bajada; y al revés, el botón se rechaza mientras hay una en curso.
    otra = reservarImportacionAutomatica(-1)
    assert.ok(otra, 'sin nada en curso, la reserva se concede')
    assert.throws(() => iniciarImportacion(DANIEL), /Ya hay una importación en curso/)
    // La automática no se le muestra a la pantalla de Importar: ésa lee el estado una sola vez al
    // abrirse y quedaría pegada en «Importación en curso…» aunque la automática ya haya terminado.
    assert.equal(estadoDelImportador().enCurso, false, 'la automática no figura en la pantalla de Importar')
    const enCursoAntes = (dockSud.db.prepare(`SELECT count(*) AS n FROM importaciones WHERE estado = 'EN_CURSO'`).get() as { n: number }).n
    const salteada = await motor.ciclarBajada()
    assert.ok(salteada)
    assert.equal(salteada.necesitaImportacion, true, 'la consulta nueva pide importar…')
    assert.ok(!listarLeads(FILTROS_COMERCIALES).filas.some((l) => l.nombre === 'Rosa Quiroga'), '…pero con otra importación en curso, la automática se saltea')
    assert.ok(dockSud.db.prepare(`SELECT 1 FROM eventos_sync WHERE detalle LIKE '%se salteó%'`).get(), 'y queda anotado en el panel')
    otra.liberar()
    assert.equal(hayImportacionEnCurso(), false)
    // Y no deja una importación colgada en EN_CURSO: en el próximo arranque se volvería una FALLIDA
    // fantasma que la pantalla muestra como «última importación».
    assert.equal((dockSud.db.prepare(`SELECT count(*) AS n FROM importaciones WHERE estado = 'EN_CURSO'`).get() as { n: number }).n, enCursoAntes)

    // Liberada, la bajada siguiente importa; mientras corre, quien pregunte ve la importación en curso.
    enCursoAlLeer.length = 0
    await motor.ciclarBajada()
    assert.ok(listarLeads(FILTROS_COMERCIALES).filas.some((l) => l.nombre === 'Rosa Quiroga'), 'la consulta llegó con la importación automática')
    assert.ok(enCursoAlLeer.includes(true), 'la importación automática tiene que figurar como en curso mientras corre')
    assert.equal(hayImportacionEnCurso(), false, 'y liberarse al terminar')
  } finally {
    otra?.liberar()
    hoja.estructura = estructura
    motor.apagar()
  }
  cerrarTodo()
})
