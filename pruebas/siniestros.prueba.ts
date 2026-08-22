// Siniestros, riesgos varios y AMP de punta a punta: se importa la hoja simulada y se trabaja como en
// la agencia —cargar un siniestro buscando la patente, seguirlo con observaciones y documentos,
// corregir un riesgo vario y sacar de la lista una ampliación ya emitida.
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarMigraciones, MIGRACIONES } from '../src/main/db/migraciones'
import { sembrarDatosIniciales } from '../src/main/db/semilla'
import { usarCarpetaDeAdjuntosDePrueba } from '../src/main/servicios/adjuntos'
import { cambiarResueltoDeAmp, listarAmp } from '../src/main/servicios/amp'
import { historialDeFila } from '../src/main/servicios/historial'
import { crearRiesgo, editarRiesgo, listarRiesgos } from '../src/main/servicios/riesgos'
import {
  agregarAdjuntos,
  agregarObservacion,
  altaDeSiniestro,
  borrarAdjunto,
  buscarParaSiniestro,
  cambiarEstadoDeSiniestro,
  cambiarEstadoDeTareaDeSiniestro,
  crearTareaDeSiniestro,
  editarSiniestro,
  fichaDeSiniestro,
  listarSiniestros,
  observacionesParaLaHoja,
} from '../src/main/servicios/siniestros'
import { usarFuenteDePrueba } from '../src/main/servicios/sincronizacion'
import { mencionaRobo, normalizarEstadoSiniestro } from '../src/shared/siniestros'
import type { FiltrosSiniestros, SesionUsuario } from '../src/shared/tipos'
import { filas, importar } from './ayuda'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

const SIN_FILTROS: FiltrosSiniestros = { periodo: '', busqueda: '', sucursal: '', compania: '', estado: '', soloRobos: false }

/** Carpetas temporales de adjuntos que hay que limpiar al terminar. */
const temporales: string[] = []

function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-adjuntos-'))
  temporales.push(carpeta)
  return carpeta
}

process.on('exit', () => {
  for (const carpeta of temporales) rmSync(carpeta, { recursive: true, force: true })
})

/** Los adjuntos de todas las pruebas van a una carpeta temporal, no a los datos de nadie. */
const CARPETA_DE_ADJUNTOS = carpetaTemporal()
usarCarpetaDeAdjuntosDePrueba(CARPETA_DE_ADJUNTOS)

/**
 * La hoja simulada del escenario abierto. Se guarda porque reimportar tiene que ser contra LA MISMA
 * hoja: una nueva sortearía otros _ID y cada fila entraría como si fuera distinta.
 */
let hojaActual: HojaSimulada | null = null

async function baseImportada(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const hoja = new HojaSimulada(construirHojaDePrueba())
  hojaActual = hoja
  await importar(db, hoja)
  // Sin una fuente de prueba, pedir el token de Drive saldría a buscar el config.json de verdad.
  usarFuenteDePrueba(hoja)
  return db
}

/** Lo que quedó camino a la pestaña SINIESTROS de la hoja. */
function colaDeSiniestros(db: BaseDeDatos) {
  return filas<{ operacion: string; fila_id: string; campos_json: string }>(
    db,
    `SELECT operacion, fila_id, campos_json FROM cola_sync WHERE pestana = 'SINIESTROS' ORDER BY id`,
  )
}

// ---------------------------------------------------------------------------
// Las reglas de siempre: el estado del trámite y la palabra ROBO
// ---------------------------------------------------------------------------

test('lo que la hoja escribió durante años cae en uno de los cuatro estados', () => {
  assert.equal(normalizarEstadoSiniestro('CERRADO'), 'CERRADO')
  assert.equal(normalizarEstadoSiniestro('EN TRAMITE'), 'EN TRÁMITE', 'sin tilde es como lo escriben')
  assert.equal(normalizarEstadoSiniestro('en trámite'), 'EN TRÁMITE')
  assert.equal(normalizarEstadoSiniestro('ABIERTO'), 'CARGADO')
  assert.equal(normalizarEstadoSiniestro('DENUNCIADO'), 'CARGADO')
  assert.equal(normalizarEstadoSiniestro('PERITADO'), 'EN TRÁMITE')
  assert.equal(normalizarEstadoSiniestro('FALTA DOCUMENTACION'), 'ESPERANDO DOCUMENTACIÓN')
  assert.equal(normalizarEstadoSiniestro('PAGADO'), 'CERRADO')
  assert.equal(normalizarEstadoSiniestro('RECHAZADO'), 'CERRADO')
  // Lo que no se reconoce no desaparece: se muestra como CARGADO y el texto original queda a la vista.
  assert.equal(normalizarEstadoSiniestro('LO VE EL ABOGADO'), 'CARGADO')
  assert.equal(normalizarEstadoSiniestro(''), 'CARGADO')
  assert.equal(normalizarEstadoSiniestro(null), 'CARGADO')
})

test('ROBO se reconoce como palabra, no como pedazo de otra', () => {
  assert.ok(mencionaRobo('ROBO DE RUEDAS'))
  assert.ok(mencionaRobo('le robaron el auto'))
  assert.ok(mencionaRobo(null, 'HURTO EN LA VIA PUBLICA'))
  assert.ok(mencionaRobo('Robó el estéreo'), 'con tilde y en minúscula vale igual')
  assert.ok(!mencionaRobo('BRAZO ROBOTIZADO'))
  assert.ok(!mencionaRobo('CHOQUE EN CADENA'))
  assert.ok(!mencionaRobo(null, undefined, ''))
})

// ---------------------------------------------------------------------------
// El listado
// ---------------------------------------------------------------------------

test('el listado trae los siniestros de la hoja con sus columnas y su mes', async () => {
  await baseImportada()
  const listado = listarSiniestros(SIN_FILTROS)

  assert.equal(listado.total, 3)
  const robo = listado.filas.find((f) => f.numeroSiniestro === 'S-2026-0804')!
  assert.ok(robo, 'el siniestro con ROBO tiene que estar')
  assert.equal(robo.sucursal, 'DOCK SUD')
  assert.equal(robo.compania, 'SANCOR')
  assert.equal(robo.cobertura, 'TODO RIESGO')
  assert.equal(robo.patente, CLIENTES.gonzalez.patente)
  assert.equal(robo.fechaCarga, '05/08/2026')
  assert.equal(robo.fecha, '04/08/2026')
  assert.equal(robo.estado, 'EN TRÁMITE', '«EN TRAMITE» de la hoja es EN TRÁMITE')
  assert.ok(robo.esRobo, 'la descripción dice ROBO')

  const choque = listado.filas.find((f) => f.numeroSiniestro === 'S-2026-0412')!
  assert.equal(choque.estado, 'CERRADO')
  assert.ok(!choque.esRobo)

  // El mes sale de la fecha de carga: es la lista mensual que ya conocen.
  assert.ok(listado.periodos.includes('2026-08'))
  assert.ok(listado.periodos.includes('2026-04'))
  cerrarBaseDeDatos()
})

test('los filtros acotan por mes, estado, sucursal y robos, y los contadores acompañan', async () => {
  await baseImportada()

  assert.equal(listarSiniestros({ ...SIN_FILTROS, periodo: '2026-08' }).filas.length, 1)
  assert.equal(listarSiniestros({ ...SIN_FILTROS, estado: 'CERRADO' }).filas.length, 1)
  assert.equal(listarSiniestros({ ...SIN_FILTROS, sucursal: 'LANUS' }).filas.length, 1)
  assert.equal(listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas.length, 1)
  assert.equal(listarSiniestros({ ...SIN_FILTROS, busqueda: CLIENTES.gonzalez.patente }).filas.length, 1)
  assert.equal(listarSiniestros({ ...SIN_FILTROS, busqueda: 'GRANIZO' }).filas.length, 1)

  // Los contadores cuentan dentro de lo filtrado, pero SIN el filtro de estado: si no, tocar uno
  // vaciaría los otros tres y no se podría volver.
  const conEstado = listarSiniestros({ ...SIN_FILTROS, estado: 'CERRADO' })
  assert.equal(conEstado.porEstado.CERRADO, 1)
  assert.equal(conEstado.porEstado['EN TRÁMITE'], 1)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// El alta rápida
// ---------------------------------------------------------------------------

test('buscando la patente, los datos de la póliza se completan solos', async () => {
  await baseImportada()

  const porPatente = buscarParaSiniestro(CLIENTES.perezAuto.patente)
  assert.equal(porPatente.length, 1)
  const candidato = porPatente[0]!
  assert.equal(candidato.clienteNombre, CLIENTES.perezAuto.nombre)
  assert.equal(candidato.compania, 'RIVADAVIA')
  assert.equal(candidato.numeroPoliza, '998877')
  assert.equal(candidato.estadoPoliza, 'ACTIVA')

  // También por apellido y por documento; Pérez tiene dos pólizas (el auto y la moto).
  assert.equal(buscarParaSiniestro('PEREZ').length, 2)
  assert.equal(buscarParaSiniestro(CLIENTES.perezAuto.dniPlano).length, 2)
  // Un texto de una letra no busca nada: sería traer la cartera entera.
  assert.equal(buscarParaSiniestro('P').length, 0)
  cerrarBaseDeDatos()
})

test('el siniestro nuevo se guarda con los datos de la póliza y sube a la pestaña SINIESTROS', async () => {
  const db = await baseImportada()
  const candidato = buscarParaSiniestro(CLIENTES.perezAuto.patente)[0]!

  const ficha = altaDeSiniestro(
    {
      clienteId: candidato.clienteId,
      polizaId: candidato.polizaId,
      fecha: '2026-08-18',
      fechaCarga: '2026-08-19',
      numeroSiniestro: '',
      descripcion: 'CRISTAL ROTO EN EL PARABRISAS',
      estado: 'CARGADO',
      importe: '',
      observaciones: '',
      sucursal: 'LANUS',
    },
    DANIEL,
  )

  const s = ficha.siniestro
  assert.equal(s.compania, 'RIVADAVIA', 'la compañía salió sola de la póliza')
  assert.equal(s.numeroPoliza, '998877')
  assert.equal(s.cobertura, 'TERCEROS COMPLETO')
  assert.equal(s.patente, CLIENTES.perezAuto.patente)
  assert.equal(s.fechaCargaIso, '2026-08-19')
  assert.equal(s.estado, 'CARGADO')
  assert.ok(s.creadoEnLaApp)

  // La ficha nunca arranca vacía: la denuncia misma es la primera entrada de la línea de tiempo.
  assert.equal(ficha.observaciones.length, 1)
  assert.match(ficha.observaciones[0]!.texto, /CRISTAL ROTO/)
  assert.equal(ficha.observaciones[0]!.usuarioNombre, DANIEL.nombre)

  // Y va camino a la hoja como una fila nueva.
  const cola = colaDeSiniestros(db)
  assert.equal(cola.length, 1)
  assert.equal(cola[0]!.operacion, 'crear')
  const campos = JSON.parse(cola[0]!.campos_json) as Record<string, string>
  assert.equal(campos.compania, 'RIVADAVIA')
  assert.equal(campos.numero_poliza, '998877')
  assert.equal(campos.estado, 'CARGADO')
  assert.equal(campos.fecha_carga, '2026-08-19')

  // La fila queda anotada como conocida: si no, cada bajada la vería como venida de otra computadora.
  const conocida = db.prepare('SELECT en_la_hoja, tipo_pestana FROM filas_crudas WHERE fila_id = ?').get(s.filaId) as
    | { en_la_hoja: number; tipo_pestana: string }
    | undefined
  assert.equal(conocida?.en_la_hoja, 0)
  assert.equal(conocida?.tipo_pestana, 'SINIESTROS')
  cerrarBaseDeDatos()
})

test('un siniestro sin fecha o de una póliza de otro cliente no se guarda', async () => {
  await baseImportada()
  const candidato = buscarParaSiniestro(CLIENTES.perezAuto.patente)[0]!
  const base = {
    clienteId: candidato.clienteId,
    polizaId: candidato.polizaId,
    fecha: '2026-08-18',
    numeroSiniestro: '',
    descripcion: 'CHOQUE',
    estado: 'CARGADO',
    importe: '',
    observaciones: '',
  }

  assert.throws(() => altaDeSiniestro({ ...base, fecha: '' }, DANIEL), /fecha del siniestro/i)
  assert.throws(() => altaDeSiniestro({ ...base, fecha: '31/02/2026' }, DANIEL), /no es una fecha válida/i)
  assert.throws(() => altaDeSiniestro({ ...base, descripcion: '' }, DANIEL), /descripción/i)

  const otro = buscarParaSiniestro(CLIENTES.gonzalez.patente)[0]!
  assert.throws(() => altaDeSiniestro({ ...base, polizaId: otro.polizaId }, DANIEL), /no es de este cliente/i)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// La ficha: línea de tiempo, estado, documentos y tareas
// ---------------------------------------------------------------------------

test('la observación queda fechada y firmada, y el resumen viaja a la hoja', async () => {
  const db = await baseImportada()
  const id = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!.id

  const ficha = agregarObservacion(id, 'Se pidió la denuncia policial', DANIEL)
  assert.equal(ficha.observaciones.length, 1)
  assert.equal(ficha.observaciones[0]!.texto, 'Se pidió la denuncia policial')
  assert.equal(ficha.observaciones[0]!.usuarioNombre, DANIEL.nombre)

  // Lo más nuevo primero, como se lee un expediente.
  const conDos = agregarObservacion(id, 'La compañía asignó perito', DANIEL)
  assert.equal(conDos.observaciones[0]!.texto, 'La compañía asignó perito')
  assert.equal(conDos.observaciones[1]!.texto, 'Se pidió la denuncia policial')

  // La columna OBSERVACIONES de la hoja recibe la línea de tiempo entera, con fecha y usuario.
  const resumen = observacionesParaLaHoja(id)
  assert.match(resumen, /La compañía asignó perito/)
  assert.match(resumen, /Se pidió la denuncia policial/)
  assert.match(resumen, new RegExp(DANIEL.nombre))

  const cola = colaDeSiniestros(db)
  const ultima = JSON.parse(cola[cola.length - 1]!.campos_json) as Record<string, string>
  assert.equal(ultima.observaciones, resumen)
  cerrarBaseDeDatos()
})

test('cambiar el estado queda en el historial, en la línea de tiempo y en la hoja', async () => {
  const db = await baseImportada()
  const fila = listarSiniestros({ ...SIN_FILTROS, busqueda: 'GRANIZO' }).filas[0]!
  assert.equal(fila.estado, 'CARGADO', '«ABIERTO» en la hoja es CARGADO')

  const ficha = cambiarEstadoDeSiniestro(fila.id, 'ESPERANDO DOCUMENTACIÓN', DANIEL)
  assert.equal(ficha.siniestro.estado, 'ESPERANDO DOCUMENTACIÓN')
  assert.equal(ficha.siniestro.estadoTexto, null, 'ya no hay texto raro que mostrar aparte')
  assert.match(ficha.observaciones[0]!.texto, /ESPERANDO DOCUMENTACIÓN/)

  const historial = historialDeFila(fila.filaId)
  assert.ok(historial.some((h) => h.campo === 'ESTADO' && h.valorNuevo === 'ESPERANDO DOCUMENTACIÓN'))

  const cola = colaDeSiniestros(db)
  assert.ok(cola.some((c) => (JSON.parse(c.campos_json) as Record<string, string>).estado === 'ESPERANDO DOCUMENTACIÓN'))

  assert.throws(() => cambiarEstadoDeSiniestro(fila.id, 'CUALQUIER COSA', DANIEL), /estado no es válido/i)
  cerrarBaseDeDatos()
})

test('el número de siniestro se completa después, cuando lo da la compañía', async () => {
  const db = await baseImportada()
  const id = altaDeSiniestro(
    {
      clienteId: buscarParaSiniestro(CLIENTES.perezAuto.patente)[0]!.clienteId,
      polizaId: buscarParaSiniestro(CLIENTES.perezAuto.patente)[0]!.polizaId,
      fecha: '2026-08-18',
      numeroSiniestro: '',
      descripcion: 'CHOQUE DE FRENTE',
      estado: 'CARGADO',
      importe: '',
      observaciones: '',
    },
    DANIEL,
  ).siniestro.id

  const ficha = editarSiniestro(id, 'numeroSiniestro', 'S-2026-9999', DANIEL)
  assert.equal(ficha.siniestro.numeroSiniestro, 'S-2026-9999')

  const cola = colaDeSiniestros(db)
  const juntos = JSON.parse(cola[0]!.campos_json) as Record<string, string>
  assert.equal(cola.length, 1, 'la fila todavía no subió: los dos cambios se juntan en el mismo «crear»')
  assert.equal(juntos.numero_siniestro, 'S-2026-9999')

  assert.throws(() => editarSiniestro(id, 'fecha', '31/02/2026', DANIEL), /no es una fecha válida/i)
  assert.throws(() => editarSiniestro(id, 'clienteNombre', 'OTRO', DANIEL), /no se puede editar/i)
  cerrarBaseDeDatos()
})

test('los documentos se copian a la carpeta del siniestro y quedan en la línea de tiempo', async () => {
  await baseImportada()
  const carpeta = carpetaTemporal()
  usarCarpetaDeAdjuntosDePrueba(carpeta)
  try {
    const id = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!.id

    const origen = path.join(carpetaTemporal(), 'denuncia policial.pdf')
    writeFileSync(origen, 'contenido de prueba')

    const ficha = await agregarAdjuntos(id, [origen], DANIEL)
    assert.equal(ficha.adjuntos.length, 1)
    assert.equal(ficha.adjuntos[0]!.nombre, 'denuncia policial.pdf')
    assert.equal(ficha.adjuntos[0]!.usuarioNombre, DANIEL.nombre)
    assert.equal(ficha.adjuntos[0]!.enDrive, false, 'sin credenciales de Google la copia queda sólo local')
    assert.ok(ficha.adjuntos[0]!.tamano > 0)

    // El archivo está de verdad, en la subcarpeta del siniestro.
    assert.deepEqual(readdirSync(path.join(carpeta, String(id))), ['denuncia policial.pdf'])
    // Y se anota quién lo adjuntó y cuándo.
    assert.match(ficha.observaciones[0]!.texto, /denuncia policial\.pdf/)

    // Dos archivos con el mismo nombre no se pisan: el segundo queda como «(2)».
    const otro = path.join(carpetaTemporal(), 'denuncia policial.pdf')
    writeFileSync(otro, 'otra cosa')
    const conDos = await agregarAdjuntos(id, [otro], DANIEL)
    assert.equal(conDos.adjuntos.length, 2)
    assert.deepEqual(readdirSync(path.join(carpeta, String(id))).sort(), ['denuncia policial (2).pdf', 'denuncia policial.pdf'])

    // Borrar saca el registro y el archivo.
    const sinUno = borrarAdjunto(conDos.adjuntos[0]!.id, DANIEL)
    assert.equal(sinUno.adjuntos.length, 1)
    assert.equal(readdirSync(path.join(carpeta, String(id))).length, 1)
  } finally {
    usarCarpetaDeAdjuntosDePrueba(CARPETA_DE_ADJUNTOS)
    cerrarBaseDeDatos()
  }
})

test('las tareas del siniestro se crean, se cuentan y se cierran', async () => {
  await baseImportada()
  const fila = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!

  const ficha = crearTareaDeSiniestro(
    { siniestroId: fila.id, titulo: 'Pedir el presupuesto del taller', detalle: '', responsableId: DANIEL.id, venceEl: '2026-08-25' },
    DANIEL,
  )
  assert.equal(ficha.tareas.length, 1)
  assert.equal(ficha.tareas[0]!.responsableNombre, DANIEL.nombre)
  assert.equal(ficha.siniestro.tareasPendientes, 1)

  const cerrada = cambiarEstadoDeTareaDeSiniestro(ficha.tareas[0]!.id, 'hecha', DANIEL)
  assert.equal(cerrada.tareas[0]!.estado, 'hecha')
  assert.equal(cerrada.siniestro.tareasPendientes, 0)

  // La tarea de un siniestro no se toca desde otro lado por error.
  assert.throws(() => cambiarEstadoDeTareaDeSiniestro(999, 'hecha', DANIEL), /no es de un siniestro/i)
  cerrarBaseDeDatos()
})

test('la ficha del siniestro ofrece las pólizas del cliente para imputarlo', async () => {
  await baseImportada()
  const fila = listarSiniestros({ ...SIN_FILTROS, busqueda: 'PEREZ' }).filas[0]!
  const ficha = fichaDeSiniestro(fila.id)
  assert.equal(ficha.polizas.length, 2, 'Pérez tiene el auto y la moto')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Riesgos varios
// ---------------------------------------------------------------------------

test('los riesgos varios se leen enteros, con su emisión', async () => {
  await baseImportada()
  const listado = listarRiesgos()
  assert.equal(listado.total, 2)
  const combinado = listado.filas.find((f) => f.tipoRiesgo === 'COMBINADO FAMILIAR')!
  assert.equal(combinado.compania, 'SANCOR')
  assert.equal(combinado.numeroPoliza, 'CF-4455')
  assert.equal(combinado.telefono, '11-4444-5555')
  assert.equal(combinado.sucursal, 'DOCK SUD')
  assert.ok(listado.companias.includes('MERCANTIL ANDINA'))
  cerrarBaseDeDatos()
})

test('editar una celda de un riesgo la guarda, la anota y la manda a la hoja', async () => {
  const db = await baseImportada()
  const riesgo = listarRiesgos().filas.find((f) => f.tipoRiesgo === 'COMBINADO FAMILIAR')!

  const actualizado = editarRiesgo(riesgo.id, 'formaPago', 'CBU', DANIEL)
  assert.equal(actualizado.formaPago, 'CBU')

  const cola = filas<{ operacion: string; campos_json: string }>(
    db,
    `SELECT operacion, campos_json FROM cola_sync WHERE pestana = 'RIESGOS VARIOS' ORDER BY id`,
  )
  assert.equal(cola.length, 1)
  assert.equal(cola[0]!.operacion, 'actualizar')
  assert.equal((JSON.parse(cola[0]!.campos_json) as Record<string, string>).forma_pago, 'CBU')

  const historial = historialDeFila(riesgo.filaId)
  assert.ok(historial.some((h) => h.campo === 'FORMA DE PAGO' && h.valorNuevo === 'CBU'))

  // Una fecha de emisión imposible no se guarda, y una columna que no existe tampoco.
  assert.throws(() => editarRiesgo(riesgo.id, 'emision', '31/02/2026', DANIEL), /no es una fecha válida/i)
  assert.throws(() => editarRiesgo(riesgo.id, 'inventada' as never, 'X', DANIEL), /no se puede editar/i)
  cerrarBaseDeDatos()
})

test('el alta de un riesgo vario pide lo mínimo y sube a la hoja como fila nueva', async () => {
  const db = await baseImportada()
  const listado = crearRiesgo(
    {
      clienteNombre: 'GONZALEZ MARIA LAURA',
      documento: CLIENTES.gonzalez.dni,
      telefono: '',
      sucursal: 'DOCK SUD',
      emision: '2026-08-20',
      tipoRiesgo: 'ACCIDENTES PERSONALES',
      descripcion: '',
      compania: 'SANCOR',
      numeroPoliza: '',
      patente: '',
      prima: '',
      cuota: '$ 5.000',
      diaVencimiento: '10',
      formaPago: 'TARJETA',
      vigenciaDesde: '',
      vigenciaHasta: '',
      observaciones: '',
    },
    DANIEL,
  )

  assert.equal(listado.total, 3)
  const nuevo = listado.filas.find((f) => f.tipoRiesgo === 'ACCIDENTES PERSONALES')!
  assert.ok(nuevo.creadoEnLaApp)
  assert.ok(nuevo.clienteId, 'el titular ya era cliente: el riesgo queda colgado de su ficha')

  const cola = filas<{ operacion: string; campos_json: string }>(
    db,
    `SELECT operacion, campos_json FROM cola_sync WHERE pestana = 'RIESGOS VARIOS' ORDER BY id`,
  )
  assert.equal(cola.length, 1)
  assert.equal(cola[0]!.operacion, 'crear')
  const campos = JSON.parse(cola[0]!.campos_json) as Record<string, string>
  assert.equal(campos.compania, 'SANCOR')
  assert.equal(campos.forma_pago, 'TARJETA')

  assert.throws(() => crearRiesgo({ ...listado.filas[0], clienteNombre: '' } as never, DANIEL), /titular/i)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// AMP
// ---------------------------------------------------------------------------

test('AMP se importa con sus columnas y arranca todo pendiente', async () => {
  await baseImportada()
  const listado = listarAmp()
  assert.equal(listado.pendientes, 2)
  assert.equal(listado.resueltas, 0)

  const granizo = listado.filas.find((f) => (f.detalle ?? '').includes('GRANIZO'))!
  assert.equal(granizo.sucursal, 'DOCK SUD')
  assert.equal(granizo.clienteNombre, CLIENTES.gonzalez.nombre)
  assert.equal(granizo.formaPago, 'TARJETA')
  assert.equal(granizo.patente, CLIENTES.gonzalez.patente)
  assert.equal(granizo.marca, CLIENTES.gonzalez.marca)
  assert.equal(granizo.vencimiento, '10/04/2026')
  assert.equal(granizo.vencimientoIso, '2026-04-10')
  assert.ok(granizo.clienteId, 'engancha con el cliente de la cartera')
  cerrarBaseDeDatos()
})

test('tildar «resuelto» saca la ampliación de la lista sin borrar nada', async () => {
  await baseImportada()
  const pendiente = listarAmp().filas[0]!

  const despues = cambiarResueltoDeAmp(pendiente.id, true, false, DANIEL)
  assert.equal(despues.pendientes, 1)
  assert.equal(despues.resueltas, 1)
  assert.ok(!despues.filas.some((f) => f.id === pendiente.id), 'ya no está en la lista de pendientes')

  const conResueltas = listarAmp(true)
  const resuelta = conResueltas.filas.find((f) => f.id === pendiente.id)!
  assert.ok(resuelta.resuelto)
  assert.equal(resuelta.resueltoPor, DANIEL.nombre)

  // Y se puede volver atrás: destildar la devuelve a la lista.
  const otraVez = cambiarResueltoDeAmp(pendiente.id, false, false, DANIEL)
  assert.equal(otraVez.pendientes, 2)

  const historial = historialDeFila(pendiente.filaId)
  assert.ok(historial.some((h) => h.campo === 'RESUELTO'))
  cerrarBaseDeDatos()
})

test('sin columna RESUELTO en la hoja, el tilde se guarda igual y se avisa por qué', async () => {
  const db = await baseImportada()
  const listado = listarAmp()
  // La pestaña AMP de la hoja simulada no tiene columna RESUELTO: el aviso lo dice.
  assert.ok(listado.avisoDeSincronizacion)
  assert.match(listado.avisoDeSincronizacion!, /RESUELTO/)

  cambiarResueltoDeAmp(listado.filas[0]!.id, true, false, DANIEL)
  const cola = filas<{ id: number }>(db, `SELECT id FROM cola_sync WHERE pestana = 'AMP'`)
  assert.equal(cola.length, 0, 'no se le escriben columnas que la planilla no espera')
  assert.equal(listarAmp().pendientes, 1, 'pero el trabajo no se pierde')
  cerrarBaseDeDatos()
})

test('reimportar la hoja no destilda lo que ya se había resuelto acá', async () => {
  const db = await baseImportada()
  const pendiente = listarAmp().filas[0]!
  cambiarResueltoDeAmp(pendiente.id, true, false, DANIEL)

  await importar(db, hojaActual!)
  assert.equal(listarAmp().pendientes, 1, 'la ampliación resuelta sigue resuelta')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// La base vieja se actualiza sola
// ---------------------------------------------------------------------------

test('una base de la Fase 6 se actualiza a la Fase 7 sin perder los siniestros que ya tenía', () => {
  const db = new Database(':memory:') as BaseDeDatos
  db.pragma('foreign_keys = ON')
  const registrar = console.log
  console.log = () => undefined
  try {
    for (const migracion of MIGRACIONES.filter((m) => m.version <= 7)) {
      db.exec(migracion.sql)
      db.pragma('user_version = ' + migracion.version)
    }
    sembrarDatosIniciales(db)
    db.prepare(
      `INSERT INTO siniestros (fila_id, pestana, fecha, fecha_iso, cliente_nombre, numero_siniestro, descripcion, estado, creado_en, actualizado_en)
       VALUES ('abc123def456', 'SINIESTROS', '12/04/2026', '2026-04-12', 'CLIENTE VIEJO', 'S-1', 'CHOQUE', 'ABIERTO', '2026-04-12T12:00:00.000Z', '2026-04-12T12:00:00.000Z')`,
    ).run()
    ejecutarMigraciones(db)
  } finally {
    console.log = registrar
  }

  assert.equal(db.pragma('user_version', { simple: true }), MIGRACIONES[MIGRACIONES.length - 1]!.version)
  const siniestro = db.prepare('SELECT numero_siniestro, estado, fecha_carga, cobertura FROM siniestros').get() as {
    numero_siniestro: string
    estado: string
    fecha_carga: string | null
    cobertura: string | null
  }
  assert.equal(siniestro.numero_siniestro, 'S-1')
  assert.equal(siniestro.estado, 'ABIERTO', 'el texto de la hoja se conserva: lo normaliza la lectura, no la migración')
  assert.equal(siniestro.fecha_carga, null, 'no se inventa una fecha de carga que nadie escribió')
  assert.equal(siniestro.cobertura, null)
  // Y las tablas nuevas están vacías y listas.
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM siniestro_observaciones').get() as { n: number }).n, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM amp').get() as { n: number }).n, 0)
  db.close()
})
