// Adjuntos y comentarios que viajan (12.6): lo que se carga en una computadora tiene que verse en la
// otra. Hasta la 12.5 la foto del choque adjuntada en Lanús no existía en Dock Sud, y el comentario
// de una tarea tampoco: la ficha viajaba por la base, lo que colgaba de ella no.
//
// Las dos computadoras comparten la hoja simulada, que además hace de almacén de archivos del VPS.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import {
  MENSAJE_SIN_DRIVE,
  adjuntosSinSubir,
  hayAdjuntosPendientes,
  registrarLoQueNoViajo,
  subirAdjuntosPendientes,
  usarCarpetaDeAdjuntosDePrueba,
} from '../src/main/servicios/adjuntos'
import { adjuntosDePoliza, agregarArchivosDePoliza, borrarAdjuntoDePoliza, rutaDelAdjuntoDePoliza } from '../src/main/servicios/adjuntosDePoliza'
import { ejecutarEliminacion } from '../src/main/servicios/eliminacion'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { usarFuenteDePrueba } from '../src/main/servicios/sincronizacion'
import { agregarArchivosDeSiniestro, agregarObservacion, fichaDeSiniestro, listarSiniestros } from '../src/main/servicios/siniestros'
import {
  agregarArchivosDeTarea,
  agregarComentario,
  borrarAdjuntoDeTarea,
  crearTareaCompleta,
  fichaDeTarea,
  rutaDelAdjuntoDeTarea,
} from '../src/main/servicios/tareas'
import { apurarAgrupadas, cuantasFallidas, cuantasPendientes } from '../src/main/sincronizacion/cola'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import type { DatosDeTareaCompleta, FiltrosSiniestros, SesionUsuario } from '../src/shared/tipos'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 4, nombre: 'Daniel' }, debeCambiarClave: false }
const FEDE: SesionUsuario = { id: 2, nombre: 'Fede', usuario: 'fede', rol: 'EMPLEADO', sucursal: { id: 1, nombre: 'Dock Sud' }, debeCambiarClave: false }
const MILAGROS: SesionUsuario = { id: 4, nombre: 'Milagros', usuario: 'milagros', rol: 'EMPLEADO', sucursal: { id: 2, nombre: 'Lanús' }, debeCambiarClave: false }

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

const SIN_FILTROS: FiltrosSiniestros = { periodo: '', busqueda: '', sucursales: [], companias: [], estado: '', soloRobos: false }

/** Un PDF chico pero de verdad: la cabecera alcanza para que el tipo se deduzca del nombre. */
const PDF = Buffer.from('%PDF-1.4\n% documento de prueba\n' + 'x'.repeat(2000))

// --- Carpetas y computadoras -------------------------------------------------------------------

const temporales: string[] = []
function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-adjuntos-'))
  temporales.push(carpeta)
  return carpeta
}
process.on('exit', () => {
  for (const carpeta of temporales) rmSync(carpeta, { recursive: true, force: true })
})

interface Computadora {
  nombre: string
  db: BaseDeDatos
  motor: MotorDeSincronizacion
  carpeta: string
}

const abiertas: Computadora[] = []

/**
 * Deja activa la base Y la carpeta de adjuntos de esa computadora: cada PC tiene su disco, y lo que
 * se prueba es justamente que un archivo que está en uno aparezca en el otro.
 */
function en(pc: Computadora): void {
  usarBaseDeDatos(pc.db)
  usarCarpetaDeAdjuntosDePrueba(pc.carpeta)
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
  const carpeta = carpetaTemporal()
  const importar = async () => {
    usarBaseDeDatos(db)
    usarCarpetaDeAdjuntosDePrueba(carpeta)
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  }
  await importar()
  const motor = new MotorDeSincronizacion({
    crearFuente: () => hoja,
    importar,
    hayArchivosPendientes: hayAdjuntosPendientes,
    subirArchivos: () => subirAdjuntosPendientes(null),
  })
  motor.encender()
  const pc = { nombre, db, motor, carpeta }
  abiertas.push(pc)
  return pc
}

async function dosComputadoras(): Promise<{ hoja: HojaSimulada; lanus: Computadora; dockSud: Computadora }> {
  cerrarTodo()
  const hoja = new HojaSimulada(construirHojaDePrueba())
  hoja.quitarPestana('IMPUTADOS')
  // Con la hoja como fuente de prueba, el almacén de adjuntos es la hoja (ver sincronizacion.ts).
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

/** Sube lo que espera en la cola (borrados incluidos) y los archivos pendientes. */
async function subirTodo(pc: Computadora): Promise<void> {
  en(pc)
  apurarAgrupadas()
  await pc.motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 0, `${pc.nombre}: ninguna entrada tiene que quedar sin arreglo`)
  assert.equal(cuantasPendientes(), 0, `${pc.nombre}: la cola tiene que quedar vacía`)
}

function filasDeAnexos(hoja: HojaSimulada, titulo: string): string[][] {
  if (!hoja.titulos().includes(titulo)) return []
  return hoja.filasDe(titulo).slice(1).filter((fila) => fila.some((celda) => (celda ?? '').trim() !== ''))
}

function celdaDe(hoja: HojaSimulada, titulo: string, fila: string[], encabezado: string): string {
  const columna = hoja.encabezadosDe(titulo).findIndex((e) => e.trim() === encabezado)
  return columna >= 0 ? (fila[columna] ?? '').trim() : ''
}

/** El `_ID` de la tarea en la base (el listado no lo muestra; se lee de la tabla). */
function filaIdDeTarea(db: BaseDeDatos, tareaId: number): string {
  const fila = db.prepare('SELECT fila_id FROM tareas WHERE id = ?').get(tareaId) as { fila_id: string | null } | undefined
  assert.ok(fila?.fila_id, 'la tarea tiene que tener fila en la base')
  return fila.fila_id
}

function tareaPorFila(db: BaseDeDatos, filaId: string): number {
  const fila = db.prepare('SELECT id FROM tareas WHERE fila_id = ?').get(filaId) as { id: number } | undefined
  assert.ok(fila, `la tarea ${filaId} tiene que existir en esta computadora`)
  return fila.id
}

function siniestroPorFila(db: BaseDeDatos, filaId: string): number {
  const fila = db.prepare('SELECT id FROM siniestros WHERE fila_id = ?').get(filaId) as { id: number } | undefined
  assert.ok(fila, `el siniestro ${filaId} tiene que existir en esta computadora`)
  return fila.id
}

// ---------------------------------------------------------------------------
// Tareas: el adjunto y el comentario viajan
// ---------------------------------------------------------------------------

test('un documento adjuntado a una tarea en una computadora se abre en la otra', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Pedir la cédula verde', responsableId: MILAGROS.id }, FEDE)
  const filaIdTarea = filaIdDeTarea(lanus.db, tarea.id)
  const conAdjunto = await agregarArchivosDeTarea(tarea.id, [{ nombre: 'cédula verde.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  assert.equal(conAdjunto.adjuntos.length, 1)
  const adjunto = conAdjunto.adjuntos[0]!
  assert.equal(adjunto.nombre, 'cédula verde.pdf')
  assert.equal(adjunto.tipo, 'application/pdf')
  assert.equal(adjunto.descargado, true, 'en la PC que lo cargó el archivo está')
  assert.equal(adjunto.enElServidor, false, 'todavía no viajó')
  assert.equal(adjunto.enDrive, false)
  assert.equal(adjunto.errorDeDrive, MENSAJE_SIN_DRIVE, 'sin Google la ficha lo DICE, no se queda callada')
  assert.equal(hayAdjuntosPendientes(), true)
  assert.equal(adjuntosSinSubir(), 1)

  // Un ciclo de subida: la fila a APP ADJUNTOS y el archivo al servidor.
  await subirTodo(lanus)
  assert.equal(hoja.almacen.size, 1, 'el archivo está en el almacén del servidor')
  const filas = filasDeAnexos(hoja, 'APP ADJUNTOS')
  assert.equal(filas.length, 1, 'una fila en APP ADJUNTOS')
  const fila = filas[0]!
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', fila, 'TIPO'), 'TAREA')
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', fila, 'VINCULO'), `TAREA:${filaIdTarea}`)
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', fila, 'NOMBRE'), 'cédula verde.pdf')
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', fila, 'CARGADO POR'), FEDE.nombre)
  assert.ok(hoja.almacen.has(celdaDe(hoja, 'APP ADJUNTOS', fila, 'ARCHIVO')), 'la columna ARCHIVO es el id en el servidor')
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', fila, 'TAMANO'), String(PDF.length))
  assert.equal(fichaDeTarea(tarea.id, FEDE).adjuntos[0]!.enElServidor, true)
  assert.equal(hayAdjuntosPendientes(), false)

  // La otra computadora: la tarea llega por la importación, el adjunto con ella.
  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const idEnDockSud = tareaPorFila(dockSud.db, filaIdTarea)
  const fichaAlla = fichaDeTarea(idEnDockSud, MILAGROS)
  assert.equal(fichaAlla.adjuntos.length, 1, 'el adjunto figura en la otra computadora')
  const alla = fichaAlla.adjuntos[0]!
  assert.equal(alla.nombre, 'cédula verde.pdf')
  assert.equal(alla.usuarioNombre, FEDE.nombre)
  assert.equal(alla.tamano, PDF.length)
  assert.equal(alla.enElServidor, true)
  assert.equal(alla.descargado, false, 'el archivo no se baja hasta que alguien lo abre')

  // Abrirlo lo baja del servidor a SU carpeta, y queda.
  const ruta = await rutaDelAdjuntoDeTarea(alla.id)
  assert.ok(ruta.startsWith(dockSud.carpeta), 'se bajó a la carpeta de esta computadora')
  assert.ok(readFileSync(ruta).equals(PDF), 'con los mismos bytes')
  assert.equal(fichaDeTarea(idEnDockSud, MILAGROS).adjuntos[0]!.descargado, true)
  const otraVez = await rutaDelAdjuntoDeTarea(alla.id)
  assert.equal(otraVez, ruta, 'la segunda vez no se vuelve a bajar')

  // Y el comentario: escrito en una, leído en la otra por el carril rápido.
  en(lanus)
  agregarComentario(tarea.id, 'Ya la pedí, la traen el lunes', FEDE)
  await subirTodo(lanus)
  assert.equal(filasDeAnexos(hoja, 'APP COMENTARIOS').length, 1)
  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const comentarios = fichaDeTarea(idEnDockSud, MILAGROS).comentarios
  assert.equal(comentarios.length, 1, 'el comentario llegó a la otra computadora')
  assert.equal(comentarios[0]!.texto, 'Ya la pedí, la traen el lunes')
  assert.equal(comentarios[0]!.usuarioNombre, FEDE.nombre)

  // Un segundo comentario llega por el carril rápido de 30 segundos, sin importación completa.
  en(lanus)
  agregarComentario(tarea.id, 'Llegó', FEDE)
  await subirTodo(lanus)
  en(dockSud)
  const rapido = await dockSud.motor.ciclarTareas()
  assert.ok(rapido, 'el carril rápido corrió')
  assert.equal(rapido!.necesitaImportacion, false, 'un comentario nuevo no pide la importación completa')
  assert.equal(fichaDeTarea(idEnDockSud, MILAGROS).comentarios.length, 2)
  assert.equal(fichaDeTarea(idEnDockSud, MILAGROS).comentarios[0]!.texto, 'Llegó', 'el más nuevo primero')

  // Borrarlo en una lo saca de la otra, archivo incluido.
  en(lanus)
  borrarAdjuntoDeTarea(adjunto.id, DANIEL)
  await subirTodo(lanus)
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 0, 'la fila salió de APP ADJUNTOS')
  assert.equal(hoja.almacen.size, 0, 'y el archivo del servidor')
  en(dockSud)
  await dockSud.motor.ciclarTareas()
  assert.equal(fichaDeTarea(idEnDockSud, MILAGROS).adjuntos.length, 0, 'la otra computadora ya no lo muestra')
  assert.equal(existsSync(ruta), false, 'ni lo tiene en el disco')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Siniestros: la observación aparece en la línea de tiempo de la otra PC; la foto, con su categoría
// ---------------------------------------------------------------------------

test('la observación y la foto de un siniestro se ven en la otra computadora', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const siniestro = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  agregarObservacion(siniestro.id, 'Llamó el perito: va el jueves', FEDE)
  const foto = Buffer.from('\x89PNG\r\n\x1a\n' + 'pixeles'.repeat(300), 'latin1')
  const conFoto = await agregarArchivosDeSiniestro(
    siniestro.id,
    [{ nombre: 'frente.png', tipo: 'image/png', contenido: new Uint8Array(foto), ancho: 1200, alto: 900 }],
    'Fotos del siniestro',
    '',
    FEDE,
  )
  assert.equal(conFoto.adjuntos.length, 1)
  assert.equal(conFoto.adjuntos[0]!.categoria, 'Fotos del siniestro')
  await subirTodo(lanus)

  const filas = filasDeAnexos(hoja, 'APP ADJUNTOS')
  assert.equal(filas.length, 1)
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', filas[0]!, 'VINCULO'), `SINIESTRO:${siniestro.filaId}`)
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', filas[0]!, 'CATEGORIA'), 'Fotos del siniestro')
  // La observación y la nota automática del adjunto: dos filas en APP COMENTARIOS.
  assert.equal(filasDeAnexos(hoja, 'APP COMENTARIOS').length, 2)

  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const idAlla = siniestroPorFila(dockSud.db, siniestro.filaId)
  const ficha = fichaDeSiniestro(idAlla)
  const textos = ficha.observaciones.map((o) => o.texto)
  assert.ok(textos.includes('Llamó el perito: va el jueves'), `la observación está en la línea de tiempo de la otra PC: ${textos.join(' | ')}`)
  assert.equal(ficha.observaciones.find((o) => o.texto.startsWith('Llamó'))!.usuarioNombre, FEDE.nombre)
  assert.equal(ficha.adjuntos.length, 1)
  assert.equal(ficha.adjuntos[0]!.categoria, 'Fotos del siniestro')
  assert.equal(ficha.adjuntos[0]!.descargado, false)
  assert.equal(ficha.adjuntos[0]!.enElServidor, true)
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Pólizas: las fotos del auto
// ---------------------------------------------------------------------------

test('las fotos de una póliza viajan por la clave de la póliza y se bajan al abrirlas', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const poliza = lanus.db.prepare('SELECT id, clave FROM polizas WHERE activa = 1 ORDER BY id LIMIT 1').get() as { id: number; clave: string }
  const foto = Buffer.from('JPEG de prueba '.repeat(500))
  const lista = await agregarArchivosDePoliza(
    poliza.id,
    [
      { nombre: 'frente.jpg', tipo: 'image/jpeg', contenido: new Uint8Array(foto), ancho: 2560, alto: 1920, optimizado: true },
      { nombre: 'póliza.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) },
    ],
    DANIEL,
  )
  assert.equal(lista.length, 2)
  assert.equal(lista.find((a) => a.nombre === 'frente.jpg')!.ancho, 2560, 'las medidas que midió la pantalla se conservan')
  await subirTodo(lanus)
  assert.equal(hoja.almacen.size, 2)
  const filas = filasDeAnexos(hoja, 'APP ADJUNTOS')
  assert.equal(filas.length, 2)
  for (const fila of filas) {
    assert.equal(celdaDe(hoja, 'APP ADJUNTOS', fila, 'TIPO'), 'POLIZA')
    assert.equal(celdaDe(hoja, 'APP ADJUNTOS', fila, 'VINCULO'), `POLIZA:${poliza.clave}`)
    assert.match(celdaDe(hoja, 'APP ADJUNTOS', fila, 'DESCRIPCION'), /^Póliza/)
  }

  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const alla = dockSud.db.prepare('SELECT id FROM polizas WHERE clave = ?').get(poliza.clave) as { id: number }
  const adjuntos = adjuntosDePoliza(alla.id)
  assert.equal(adjuntos.length, 2, 'las dos fotos figuran en la otra computadora')
  const pdf = adjuntos.find((a) => a.nombre === 'póliza.pdf')!
  const ruta = await rutaDelAdjuntoDePoliza(pdf.id)
  assert.ok(readFileSync(ruta).equals(PDF))

  // Borrar desde la otra computadora también vale, y vuelve a la primera.
  const sinPdf = borrarAdjuntoDePoliza(pdf.id, DANIEL)
  assert.equal(sinPdf.length, 1)
  await subirTodo(dockSud)
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 1)
  en(lanus)
  await lanus.motor.ciclarTareas()
  assert.equal(adjuntosDePoliza(poliza.id).length, 1, 'el borrado hecho en Dock Sud llegó a Lanús')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// La subida al servidor: reintentos con espera, y rendirse cuando el servidor dice que no
// ---------------------------------------------------------------------------

test('un archivo que el servidor rechaza espera antes de reintentar y se rinde al tercer rechazo', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Subir el video', responsableId: FEDE.id }, FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'grande.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)

  const rechazo = () => new ErrorDeNegocio('El servidor del VPS rechazó la operación (subir el adjunto): El archivo supera el máximo que acepta el servidor (1024 MB).')
  hoja.fallaDeSubida = rechazo()
  let resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 0, fallidos: 1 })
  const leer = () =>
    lanus.db.prepare('SELECT vps_subido_en, vps_error, vps_intentos, vps_proximo_intento FROM tarea_adjuntos WHERE tarea_id = ?').get(tarea.id) as {
      vps_subido_en: string | null
      vps_error: string | null
      vps_intentos: number
      vps_proximo_intento: string | null
    }
  let fila = leer()
  assert.equal(fila.vps_subido_en, null)
  assert.match(fila.vps_error ?? '', /supera el máximo/)
  assert.equal(fila.vps_intentos, 1)
  assert.ok(fila.vps_proximo_intento! > ahoraIso(), 'espera antes de volver a intentar')
  assert.equal(hayAdjuntosPendientes(), false, 'mientras espera no cuenta como pendiente')
  assert.equal(fichaDeTarea(tarea.id, FEDE).adjuntos[0]!.errorDelServidor?.includes('supera el máximo'), true, 'la ficha muestra el motivo')

  // Sin conexión: no cuenta como intento, sólo espera.
  lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
  hoja.desconectar()
  resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 0, fallidos: 0 })
  assert.equal(leer().vps_intentos, 1, 'una falla de red no es un rechazo')
  hoja.conectar()

  // Dos rechazos más y se rinde: el próximo intento queda en «nunca».
  for (const vuelta of [2, 3]) {
    lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
    hoja.fallaDeSubida = rechazo()
    await subirAdjuntosPendientes(null)
    assert.equal(leer().vps_intentos, vuelta)
  }
  assert.ok(leer().vps_proximo_intento!.startsWith('9999'), 'al tercer rechazo no se vuelve a intentar')

  // Si se le da otra oportunidad y el servidor ahora acepta, sube.
  lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
  resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 1, fallidos: 0 })
  fila = leer()
  assert.ok(fila.vps_subido_en)
  assert.equal(fila.vps_error, null)
  assert.equal(hoja.almacen.size, 1)
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Lo de antes de la 12.6, y lo que se borra con su ficha
// ---------------------------------------------------------------------------

test('los adjuntos y comentarios cargados con versiones anteriores se registran al arrancar', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Tarea vieja', responsableId: FEDE.id }, FEDE)
  await subirTodo(lanus)
  // Un adjunto y un comentario como los dejaba la 12.5: en la tabla, sin fila_id, con el archivo en el disco.
  const carpeta = path.join(lanus.carpeta, `tarea-${tarea.id}`)
  mkdirSync(carpeta, { recursive: true })
  writeFileSync(path.join(carpeta, 'vieja.pdf'), PDF)
  lanus.db
    .prepare(`INSERT INTO tarea_adjuntos (tarea_id, nombre, archivo, tamano, usuario_id, usuario_nombre, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(tarea.id, 'vieja.pdf', `tarea-${tarea.id}/vieja.pdf`, PDF.length, FEDE.id, FEDE.nombre, '2026-06-01T10:00:00.000Z')
  lanus.db
    .prepare(`INSERT INTO tarea_comentarios (tarea_id, texto, usuario_id, usuario_nombre, creado_en) VALUES (?, ?, ?, ?, ?)`)
    .run(tarea.id, 'Comentario de junio', FEDE.id, FEDE.nombre, '2026-06-01T10:05:00.000Z')

  const registrados = registrarLoQueNoViajo()
  assert.deepEqual(registrados, { adjuntos: 1, comentarios: 1 })
  assert.deepEqual(registrarLoQueNoViajo(), { adjuntos: 0, comentarios: 0 }, 'la segunda vez no hay nada nuevo')
  const adjunto = lanus.db.prepare('SELECT fila_id, vps_id, sha256 FROM tarea_adjuntos WHERE tarea_id = ?').get(tarea.id) as { fila_id: string; vps_id: string; sha256: string }
  assert.match(adjunto.fila_id, /^ADJ:[0-9a-f]{32}$/)
  assert.equal(adjunto.fila_id, `ADJ:${adjunto.vps_id}`)
  assert.equal(adjunto.sha256.length, 64)
  assert.equal(cuantasPendientes(), 2, 'una fila para APP ADJUNTOS y otra para APP COMENTARIOS')

  await subirTodo(lanus)
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 1)
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', filasDeAnexos(hoja, 'APP ADJUNTOS')[0]!, 'FECHA'), '2026-06-01T10:00:00.000Z', 'con su fecha original')
  assert.equal(filasDeAnexos(hoja, 'APP COMENTARIOS').length, 1)
  assert.equal(hoja.almacen.size, 1, 'y el archivo subió')
  cerrarTodo()
})

test('eliminar una tarea saca sus adjuntos y comentarios de la base, y de la otra computadora', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Para borrar', responsableId: FEDE.id }, FEDE)
  const filaIdTarea = filaIdDeTarea(lanus.db, tarea.id)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'adjunto.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  agregarComentario(tarea.id, 'Un comentario', FEDE)
  await subirTodo(lanus)
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 1)
  assert.equal(filasDeAnexos(hoja, 'APP COMENTARIOS').length, 1)

  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const idAlla = tareaPorFila(dockSud.db, filaIdTarea)
  assert.equal(fichaDeTarea(idAlla, MILAGROS).adjuntos.length, 1)

  en(lanus)
  ejecutarEliminacion('tarea', tarea.id, DANIEL)
  await subirTodo(lanus)
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 0, 'la fila del adjunto se fue con la tarea')
  assert.equal(filasDeAnexos(hoja, 'APP COMENTARIOS').length, 0, 'y la del comentario')

  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const contar = (tabla: string) => (dockSud.db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE tarea_id = ?`).get(idAlla) as { n: number }).n
  assert.equal(contar('tarea_adjuntos'), 0, 'el adjunto se fue de la otra computadora')
  assert.equal(contar('tarea_comentarios'), 0, 'y el comentario también')
  cerrarTodo()
})
