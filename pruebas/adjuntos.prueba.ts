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
  nombreSeguro,
  registrarLoQueNoViajo,
  subirAdjuntosPendientes,
  usarCarpetaDeAdjuntosDePrueba,
  verificarAdjuntosContraElServidor,
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
import { ErrorDelServidorVps } from '../src/main/vps/fuenteVps'
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
  assert.equal(hoja.almacen.size, 1)
  ejecutarEliminacion('tarea', tarea.id, DANIEL)
  await subirTodo(lanus)
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 0, 'la fila del adjunto se fue con la tarea')
  assert.equal(filasDeAnexos(hoja, 'APP COMENTARIOS').length, 0, 'y la del comentario')
  assert.equal(hoja.almacen.size, 0, '12.7: el archivo también se fue del servidor, no quedó huérfano')

  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const contar = (tabla: string) => (dockSud.db.prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE tarea_id = ?`).get(idAlla) as { n: number }).n
  assert.equal(contar('tarea_adjuntos'), 0, 'el adjunto se fue de la otra computadora')
  assert.equal(contar('tarea_comentarios'), 0, 'y el comentario también')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// 12.7: la vuelta de subida no se traba con un archivo, y el servidor no manda a «nunca» por el token
// ---------------------------------------------------------------------------

interface EstadoDeSubida {
  id: number
  nombre: string
  vps_id: string
  vps_subido_en: string | null
  vps_error: string | null
  vps_intentos: number
  vps_proximo_intento: string | null
}

function estadoDeLosAdjuntos(db: BaseDeDatos, tareaId: number): Record<string, EstadoDeSubida> {
  const filas = db
    .prepare('SELECT id, nombre, vps_id, vps_subido_en, vps_error, vps_intentos, vps_proximo_intento FROM tarea_adjuntos WHERE tarea_id = ? ORDER BY id')
    .all(tareaId) as EstadoDeSubida[]
  return Object.fromEntries(filas.map((fila) => [fila.nombre, fila]))
}

function fallaDeRed(): Error {
  return Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })
}

function timeout(): Error {
  const error = new Error('The operation was aborted due to timeout')
  error.name = 'TimeoutError'
  return error
}

test('una falla de red en un archivo no frena a los que vienen después, y un timeout cuenta como intento', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Fotos del choque', responsableId: FEDE.id }, FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'primera.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'segunda.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  // Las fechas bien separadas: la primera es la primera, no importa el reloj.
  lanus.db.prepare(`UPDATE tarea_adjuntos SET creado_en = '2026-08-01T10:00:00.000Z' WHERE nombre = 'primera.pdf'`).run()
  lanus.db.prepare(`UPDATE tarea_adjuntos SET creado_en = '2026-08-01T10:01:00.000Z' WHERE nombre = 'segunda.pdf'`).run()

  // La primera se cae por la red: hasta la 12.6 esto cortaba la vuelta y la segunda no salía jamás.
  hoja.fallaDeSubida = fallaDeRed()
  let resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 1, fallidos: 0 }, 'la segunda subió igual')
  let estado = estadoDeLosAdjuntos(lanus.db, tarea.id)
  assert.equal(estado['primera.pdf']!.vps_intentos, 0, 'una falla de red no es un intento')
  assert.equal(estado['primera.pdf']!.vps_subido_en, null)
  assert.ok(estado['primera.pdf']!.vps_proximo_intento! > ahoraIso(), 'pero esa fila espera un minuto')
  assert.ok(estado['segunda.pdf']!.vps_subido_en, 'la segunda está en el servidor')
  assert.equal(hoja.almacen.size, 1)

  // Un timeout del PUT SÍ cuenta: un archivo que siempre tarda más de diez minutos no puede pasar
  // primero para siempre.
  lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'tercera.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  hoja.fallaDeSubida = timeout()
  resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 1, fallidos: 1 })
  estado = estadoDeLosAdjuntos(lanus.db, tarea.id)
  assert.equal(estado['primera.pdf']!.vps_intentos, 1, 'el timeout cuenta como intento')
  assert.match(estado['primera.pdf']!.vps_error ?? '', /diez minutos/)
  assert.ok(estado['primera.pdf']!.vps_proximo_intento! > ahoraIso())
  assert.ok(!estado['primera.pdf']!.vps_proximo_intento!.startsWith('9999'), 'y no es definitivo')
  assert.ok(estado['tercera.pdf']!.vps_subido_en, 'la tercera pasó por delante de la que ya falló')

  // Los que fallaron van al fondo: con una nueva y la que ya tiene un intento, sale primero la nueva.
  // Y sin internet de verdad (dos fallas de red seguidas) la vuelta se corta sin contar intentos.
  lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'cuarta.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  hoja.desconectar()
  resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 0, fallidos: 0 })
  estado = estadoDeLosAdjuntos(lanus.db, tarea.id)
  assert.equal(estado['cuarta.pdf']!.vps_intentos, 0)
  assert.ok(estado['cuarta.pdf']!.vps_proximo_intento! > ahoraIso(), 'la nueva se intentó (y espera)')
  assert.equal(estado['primera.pdf']!.vps_intentos, 1, 'la que ya había fallado no sumó intentos')
  assert.ok(estado['primera.pdf']!.vps_proximo_intento! > ahoraIso())
  hoja.conectar()

  // Con conexión, las dos suben.
  lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
  resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 2, fallidos: 0 })
  assert.equal(hoja.almacen.size, 4)
  assert.equal(hayAdjuntosPendientes(), false)
  cerrarTodo()
})

test('un 401 o un 503 del servidor nunca mandan el archivo a «nunca»; un 413 sí, al tercero, y un 409 también', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Con el token vencido', responsableId: FEDE.id }, FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'denuncia.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  const leer = () => estadoDeLosAdjuntos(lanus.db, tarea.id)['denuncia.pdf']!

  const rechazos = [
    new ErrorDelServidorVps('El servidor del VPS rechazó el token de DM Gestión.', 401),
    new ErrorDelServidorVps('El servidor del VPS rechazó el token de DM Gestión.', 401),
    new ErrorDelServidorVps('Falta DMG_SYNC_TOKEN en el servidor.', 503),
    new ErrorDelServidorVps('El servidor del VPS rechazó la operación (subir el adjunto): demasiados pedidos', 429),
  ]
  for (const [indice, rechazo] of rechazos.entries()) {
    lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
    hoja.fallaDeSubida = rechazo
    const resultado = await subirAdjuntosPendientes(null)
    assert.deepEqual(resultado, { subidos: 0, fallidos: 1 })
    const fila = leer()
    assert.equal(fila.vps_intentos, indice + 1, 'cada rechazo cuenta como intento')
    assert.ok(fila.vps_proximo_intento! > ahoraIso(), 'con espera creciente')
    assert.ok(!fila.vps_proximo_intento!.startsWith('9999'), `un ${rechazo.status} no es culpa del archivo: no se rinde (intento ${indice + 1})`)
  }
  // La espera tiene tope de una hora: con cuatro intentos son 8 minutos, nunca más de 60.
  const dentroDeUnaHora = new Date(Date.now() + 61 * 60_000).toISOString()
  assert.ok(leer().vps_proximo_intento! < dentroDeUnaHora)

  // Cuando el token se arregla, sube como si nada.
  lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
  assert.deepEqual(await subirAdjuntosPendientes(null), { subidos: 1, fallidos: 0 })
  assert.equal(leer().vps_error, null)

  // Un 413 (demasiado grande) sí es del archivo: al tercero, «nunca».
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'video.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  for (let vuelta = 1; vuelta <= 3; vuelta++) {
    lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
    hoja.fallaDeSubida = new ErrorDelServidorVps('El archivo supera el máximo que acepta el servidor (1024 MB).', 413)
    await subirAdjuntosPendientes(null)
  }
  const video = estadoDeLosAdjuntos(lanus.db, tarea.id)['video.pdf']!
  assert.equal(video.vps_intentos, 3)
  assert.ok(video.vps_proximo_intento!.startsWith('9999'), 'un 413 tres veces es definitivo')

  // Un 409 tampoco se arregla esperando: el id y la huella de la fila no cambian nunca, así que sin
  // esto el archivo entero (pueden ser decenas de MB) volvía a salir cada hora para siempre.
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'repetido.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  for (let vuelta = 1; vuelta <= 3; vuelta++) {
    lanus.db.prepare(`UPDATE tarea_adjuntos SET vps_proximo_intento = NULL WHERE nombre = 'repetido.pdf'`).run()
    hoja.fallaDeSubida = new ErrorDelServidorVps('Ya hay un adjunto con ese id y otro contenido: un adjunto no se reescribe.', 409)
    await subirAdjuntosPendientes(null)
  }
  const repetido = estadoDeLosAdjuntos(lanus.db, tarea.id)['repetido.pdf']!
  assert.equal(repetido.vps_intentos, 3)
  assert.ok(repetido.vps_proximo_intento!.startsWith('9999'), 'un 409 tres veces también se deja de intentar')
  cerrarTodo()
})

test('un 400 no se decide por el nombre del archivo: «hash.pdf» con un error transitorio se sigue intentando', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Con nombres traicioneros', responsableId: FEDE.id }, FEDE)
  // El mensaje que ve la ficha lleva adentro el nombre del archivo: «…(subir el adjunto «hash.pdf»):
  // el cuerpo del pedido no se pudo leer». Si se decidiera por ese texto, la palabra «hash» del NOMBRE
  // alcanzaría para dar el archivo por rechazado y no volver a intentarlo nunca.
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'hash.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  for (let vuelta = 1; vuelta <= 3; vuelta++) {
    lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
    hoja.fallaDeSubida = new ErrorDelServidorVps(
      'El servidor del VPS rechazó la operación (subir el adjunto «hash.pdf»): el cuerpo del pedido no se pudo leer',
      400,
      'el cuerpo del pedido no se pudo leer',
    )
    await subirAdjuntosPendientes(null)
  }
  const hash = estadoDeLosAdjuntos(lanus.db, tarea.id)['hash.pdf']!
  assert.equal(hash.vps_intentos, 3)
  assert.ok(!hash.vps_proximo_intento!.startsWith('9999'), 'el 400 era del pedido, no del archivo: se sigue intentando')

  // Y un 400 que sí es del archivo (lo dice el servidor, no el nombre) se rinde al tercero.
  lanus.db.prepare('UPDATE tarea_adjuntos SET vps_intentos = 0, vps_error = NULL, vps_proximo_intento = NULL').run()
  for (let vuelta = 1; vuelta <= 3; vuelta++) {
    lanus.db.prepare('UPDATE tarea_adjuntos SET vps_proximo_intento = NULL').run()
    hoja.fallaDeSubida = new ErrorDelServidorVps(
      'El servidor del VPS rechazó la operación (subir el adjunto «hash.pdf»): el archivo llegó vacío',
      400,
      'el archivo llegó vacío',
    )
    await subirAdjuntosPendientes(null)
  }
  assert.ok(estadoDeLosAdjuntos(lanus.db, tarea.id)['hash.pdf']!.vps_proximo_intento!.startsWith('9999'))
  cerrarTodo()
})

test('el archivo que una versión anterior dio por perdido por el token vuelve a la cola al verificar', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Lo que perdió la 12.6', responsableId: FEDE.id }, FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'rescatable.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'gigante.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  // Así quedaban en la 12.6: tres 401 seguidos con el token vencido mandaban el archivo a «nunca»
  // aunque el archivo estuviera perfecto en el disco, y ahí se moría para siempre.
  lanus.db
    .prepare(`UPDATE tarea_adjuntos SET vps_intentos = 3, vps_error = ?, vps_proximo_intento = '9999-12-31T00:00:00.000Z' WHERE nombre = 'rescatable.pdf'`)
    .run('El servidor del VPS rechazó el token de DM Gestión.')
  // Éste sí es culpa del archivo: reintentarlo no cambia nada, así que se queda donde está.
  lanus.db
    .prepare(`UPDATE tarea_adjuntos SET vps_intentos = 3, vps_error = ?, vps_proximo_intento = '9999-12-31T00:00:00.000Z' WHERE nombre = 'gigante.pdf'`)
    .run('El archivo supera el máximo que acepta el servidor (1024 MB).')
  assert.equal(hayAdjuntosPendientes(), false, 'los dos están fuera de la cola')

  assert.deepEqual(await verificarAdjuntosContraElServidor(), { reencolados: 1, confirmados: 0, desmarcados: 0 })
  const estado = estadoDeLosAdjuntos(lanus.db, tarea.id)
  assert.equal(estado['rescatable.pdf']!.vps_intentos, 0, 'vuelve a empezar de cero')
  assert.equal(estado['rescatable.pdf']!.vps_error, null)
  assert.equal(estado['rescatable.pdf']!.vps_proximo_intento, null)
  assert.ok(estado['gigante.pdf']!.vps_proximo_intento!.startsWith('9999'), 'lo que el servidor rechazó por el archivo no se rescata')

  await subirTodo(lanus)
  assert.equal(hoja.almacen.size, 1, 'el rescatado subió; el otro no se volvió a intentar')
  cerrarTodo()
})

test('un archivo que no se puede leer no tumba la vuelta ni el registro de los demás', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Con uno trabado', responsableId: FEDE.id }, FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'trabado.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'sano.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  lanus.db.prepare(`UPDATE tarea_adjuntos SET creado_en = '2026-08-01T10:00:00.000Z' WHERE nombre = 'trabado.pdf'`).run()
  lanus.db.prepare(`UPDATE tarea_adjuntos SET creado_en = '2026-08-01T10:01:00.000Z' WHERE nombre = 'sano.pdf'`).run()
  // Un archivo que existe pero no se deja leer: acá, una carpeta con su nombre (EISDIR); en Windows,
  // el PDF abierto en otro programa (EBUSY) o sin permiso (EPERM).
  const rutaTrabada = path.join(lanus.carpeta, `tarea-${tarea.id}`, 'trabado.pdf')
  rmSync(rutaTrabada)
  mkdirSync(rutaTrabada)

  const resultado = await subirAdjuntosPendientes(null)
  assert.deepEqual(resultado, { subidos: 1, fallidos: 1 }, 'la vuelta siguió y el sano subió')
  const estado = estadoDeLosAdjuntos(lanus.db, tarea.id)
  assert.equal(estado['trabado.pdf']!.vps_intentos, 1, 'no poder leerlo cuenta como intento')
  assert.match(estado['trabado.pdf']!.vps_error ?? '', /No se pudo leer el archivo/)
  assert.ok(estado['trabado.pdf']!.vps_proximo_intento! > ahoraIso())
  assert.ok(!estado['trabado.pdf']!.vps_proximo_intento!.startsWith('9999'))
  assert.ok(estado['sano.pdf']!.vps_subido_en)
  assert.equal(hoja.almacen.size, 1)

  // Lo mismo al registrar lo de versiones anteriores: uno ilegible no aborta el registro de los otros.
  const carpeta = path.join(lanus.carpeta, `tarea-${tarea.id}`)
  mkdirSync(path.join(carpeta, 'vieja-trabada.pdf'))
  writeFileSync(path.join(carpeta, 'vieja-sana.pdf'), PDF)
  const alta = lanus.db.prepare(`INSERT INTO tarea_adjuntos (tarea_id, nombre, archivo, tamano, usuario_id, usuario_nombre, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  alta.run(tarea.id, 'vieja-trabada.pdf', `tarea-${tarea.id}/vieja-trabada.pdf`, PDF.length, FEDE.id, FEDE.nombre, '2026-06-01T10:00:00.000Z')
  alta.run(tarea.id, 'vieja-sana.pdf', `tarea-${tarea.id}/vieja-sana.pdf`, PDF.length, FEDE.id, FEDE.nombre, '2026-06-01T10:01:00.000Z')
  assert.deepEqual(registrarLoQueNoViajo(), { adjuntos: 1, comentarios: 0 })
  const viejas = lanus.db.prepare(`SELECT nombre, fila_id FROM tarea_adjuntos WHERE nombre LIKE 'vieja-%' ORDER BY nombre`).all() as Array<{ nombre: string; fila_id: string | null }>
  assert.equal(viejas.find((v) => v.nombre === 'vieja-sana.pdf')!.fila_id?.startsWith('ADJ:'), true)
  assert.equal(viejas.find((v) => v.nombre === 'vieja-trabada.pdf')!.fila_id, null, 'la ilegible queda para el próximo arranque')
  cerrarTodo()
})

test('un adjunto de una ficha sin identidad queda sin fila_id y viaja cuando la ficha la gana', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Tarea sin fila', responsableId: FEDE.id }, FEDE)
  await subirTodo(lanus)
  // Una tarea como las de antes de la 12.6: sin fila en la base.
  const filaIdTarea = filaIdDeTarea(lanus.db, tarea.id)
  lanus.db.prepare('UPDATE tareas SET fila_id = NULL WHERE id = ?').run(tarea.id)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'huérfano.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  const leer = () =>
    lanus.db.prepare('SELECT fila_id, vps_id, vps_subido_en FROM tarea_adjuntos WHERE tarea_id = ?').get(tarea.id) as { fila_id: string | null; vps_id: string; vps_subido_en: string | null }
  assert.equal(leer().fila_id, null, 'sin ficha madre en la base no hay fila que mandar: fila_id queda en NULL')
  assert.ok(leer().vps_id, 'pero el archivo tiene id y puede ir subiendo')
  assert.equal(cuantasPendientes(), 0, 'nada en la cola para APP ADJUNTOS')

  await subirTodo(lanus)
  assert.equal(hoja.almacen.size, 1, 'el archivo subió')
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 0, 'sin fila todavía')
  const vpsId = leer().vps_id

  // La tarea gana identidad: al arrancar, el adjunto se registra con el MISMO id de archivo y con su
  // fecha de subida, así las otras computadoras lo ven «en el servidor» y lo pueden abrir.
  lanus.db.prepare('UPDATE tareas SET fila_id = ? WHERE id = ?').run(filaIdTarea, tarea.id)
  assert.deepEqual(registrarLoQueNoViajo(), { adjuntos: 1, comentarios: 0 })
  assert.equal(leer().fila_id, `ADJ:${vpsId}`)
  assert.equal(leer().vps_id, vpsId, 'conserva el id con el que ya subió')
  await subirTodo(lanus)
  const filas = filasDeAnexos(hoja, 'APP ADJUNTOS')
  assert.equal(filas.length, 1)
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', filas[0]!, 'ARCHIVO'), vpsId)
  assert.equal(celdaDe(hoja, 'APP ADJUNTOS', filas[0]!, 'SUBIDO'), leer().vps_subido_en, 'la fila ya dice que está en el servidor')
  cerrarTodo()
})

test('verificar contra el servidor desmarca lo que otra computadora dio por subido y ya no está', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Para verificar', responsableId: FEDE.id }, FEDE)
  const filaIdTarea = filaIdDeTarea(lanus.db, tarea.id)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'perdido.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  await subirTodo(lanus)
  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const idAlla = tareaPorFila(dockSud.db, filaIdTarea)
  assert.equal(fichaDeTarea(idAlla, MILAGROS).adjuntos[0]!.enElServidor, true, 'la columna SUBIDO lo dice')

  // El archivo desaparece del servidor (se borró a mano, o nunca terminó de subir).
  hoja.almacen.clear()
  let resultado = await verificarAdjuntosContraElServidor()
  assert.deepEqual(resultado, { reencolados: 0, confirmados: 0, desmarcados: 1 })
  const alla = fichaDeTarea(idAlla, MILAGROS).adjuntos[0]!
  assert.equal(alla.enElServidor, false, 'ya no se afirma que está en el servidor')
  assert.equal(alla.enOtraComputadora, true, 'la ficha dice «cargado en otra computadora»')
  assert.deepEqual(await verificarAdjuntosContraElServidor(), { reencolados: 0, confirmados: 0, desmarcados: 0 }, 'la segunda vez no hay nada que hacer')

  // Y aguanta una importación completa: la fila de APP ADJUNTOS sigue teniendo su columna SUBIDO
  // escrita, y hasta ahora eso volvía a marcar el adjunto como «en el servidor» apenas entraba una
  // importación (que corre sola cuando aparecen filas nuevas), o sea que el arreglo duraba minutos.
  await dockSud.motor.ciclarBajada(true)
  en(dockSud)
  assert.ok(
    (dockSud.db.prepare('SELECT vps_subido_en FROM tarea_adjuntos WHERE tarea_id = ?').get(idAlla) as { vps_subido_en: string | null }).vps_subido_en,
    'la importación vuelve a copiar la columna SUBIDO (por eso el desmarcado no puede vivir sólo en esa columna)',
  )
  const despues = fichaDeTarea(idAlla, MILAGROS).adjuntos[0]!
  assert.equal(despues.enElServidor, false, 'la importación no lo vuelve a dar por subido')
  assert.equal(despues.enOtraComputadora, true)
  assert.equal(despues.errorDelServidor, null, 'no se muestra como «no subió»: sigue siendo un archivo de otra computadora')

  // La computadora que SÍ tiene el archivo lo reencola y lo vuelve a subir (esto ya andaba: no se rompe).
  en(lanus)
  resultado = await verificarAdjuntosContraElServidor()
  assert.deepEqual(resultado, { reencolados: 1, confirmados: 0, desmarcados: 0 })
  assert.equal(hayAdjuntosPendientes(), true)
  await subirTodo(lanus)
  assert.equal(hoja.almacen.size, 1)

  // Y la otra, al verificar, lo confirma.
  en(dockSud)
  assert.deepEqual(await verificarAdjuntosContraElServidor(), { reencolados: 0, confirmados: 1, desmarcados: 0 })
  assert.equal(fichaDeTarea(idAlla, MILAGROS).adjuntos[0]!.enElServidor, true)
  cerrarTodo()
})

test('bajar un adjunto sin conexión o con la descarga cortada da un mensaje claro, no un error inesperado', async () => {
  const { hoja, lanus, dockSud } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Para bajar', responsableId: FEDE.id }, FEDE)
  const filaIdTarea = filaIdDeTarea(lanus.db, tarea.id)
  await agregarArchivosDeTarea(tarea.id, [{ nombre: 'pesado.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  await subirTodo(lanus)
  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const adjunto = fichaDeTarea(tareaPorFila(dockSud.db, filaIdTarea), MILAGROS).adjuntos[0]!

  const esMensajeClaro = (error: unknown) => {
    assert.ok(error instanceof ErrorDeNegocio, 'es un error de negocio, con mensaje para la pantalla')
    assert.match(error.message, /«pesado\.pdf» se cortó o tardó demasiado/)
    return true
  }
  hoja.desconectar()
  await assert.rejects(rutaDelAdjuntoDeTarea(adjunto.id), esMensajeClaro)
  hoja.conectar()

  // La descarga que el reloj cortó (ver `pedirCrudo`): mismo mensaje.
  const bajarDeVerdad = hoja.bajarAdjunto.bind(hoja)
  hoja.bajarAdjunto = async () => {
    throw timeout()
  }
  await assert.rejects(rutaDelAdjuntoDeTarea(adjunto.id), esMensajeClaro)
  hoja.bajarAdjunto = bajarDeVerdad
  assert.ok(readFileSync(await rutaDelAdjuntoDeTarea(adjunto.id)).equals(PDF), 'con conexión baja bien')
  cerrarTodo()
})

test('borrar un adjunto deja su fila lista para salir en el ciclo siguiente, sin la ventana de agrupado', async () => {
  const { hoja, lanus } = await dosComputadoras()
  en(lanus)
  const tarea = crearTareaCompleta({ ...TAREA_VACIA, titulo: 'Para borrar rápido', responsableId: FEDE.id }, FEDE)
  const conAdjunto = await agregarArchivosDeTarea(tarea.id, [{ nombre: 'borrar.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], FEDE)
  await subirTodo(lanus)
  assert.equal(hoja.almacen.size, 1)
  const { fila_id } = lanus.db.prepare('SELECT fila_id FROM tarea_adjuntos WHERE tarea_id = ?').get(tarea.id) as { fila_id: string }

  borrarAdjuntoDeTarea(conAdjunto.adjuntos[0]!.id, DANIEL)
  const entrada = lanus.db
    .prepare(`SELECT proximo_intento FROM cola_sync WHERE fila_id = ? AND operacion = 'borrar' AND estado = 'pendiente'`)
    .get(fila_id) as { proximo_intento: string | null } | undefined
  assert.ok(entrada, 'el borrado está en la cola')
  assert.equal(entrada.proximo_intento, null, 'sin espera: el archivo ya no está en el servidor y la fila no puede quedar un minuto diciendo que sí')
  // Sin `apurarAgrupadas`: sale en el ciclo siguiente por sí sola.
  await lanus.motor.ciclarSubida()
  assert.equal(filasDeAnexos(hoja, 'APP ADJUNTOS').length, 0)
  assert.equal(hoja.almacen.size, 0)
  cerrarTodo()
})

test('los nombres reservados de Windows se guardan con un guion bajo adelante', () => {
  assert.equal(nombreSeguro('CON'), '_CON')
  assert.equal(nombreSeguro('con.pdf'), '_con.pdf')
  assert.equal(nombreSeguro('Nul.jpg'), '_Nul.jpg')
  assert.equal(nombreSeguro('LPT1.txt'), '_LPT1.txt')
  assert.equal(nombreSeguro('com9'), '_com9')
  // Windows abre el dispositivo por lo que va antes del PRIMER punto, no antes de la extensión.
  assert.equal(nombreSeguro('con.txt.pdf'), '_con.txt.pdf')
  assert.equal(nombreSeguro('nul.tar.gz'), '_nul.tar.gz')
  assert.equal(nombreSeguro('console.pdf'), 'console.pdf', 'sólo el nombre exacto, no lo que empieza igual')
  assert.equal(nombreSeguro('com0.pdf'), 'com0.pdf')
  assert.equal(nombreSeguro('contrato.pdf'), 'contrato.pdf')
})
