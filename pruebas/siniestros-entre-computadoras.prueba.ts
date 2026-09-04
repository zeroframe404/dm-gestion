// Siniestros entre computadoras (12.7): lo que se carga en un mostrador tiene que verse IGUAL en los
// otros cuatro. Es el caso que la agencia reportó: siniestros que en otras PCs aparecían sin asegurado
// y sin fecha, documentos «en el servidor» que no se podían abrir, y una ficha que decía una cosa en
// cada computadora.
//
// Las dos computadoras comparten la hoja simulada, que además hace de almacén de archivos del VPS.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import {
  hayAdjuntosPendientes,
  subirAdjuntosPendientes,
  usarCarpetaDeAdjuntosDePrueba,
  verificarAdjuntosContraElServidor,
} from '../src/main/servicios/adjuntos'
import { reenviarSiniestrosIncompletos, repararSiniestrosSinCliente } from '../src/main/servicios/reparaciones'
import { usarFuenteDePrueba } from '../src/main/servicios/sincronizacion'
import {
  agregarArchivosDeSiniestro,
  agregarObservacion,
  altaDeSiniestro,
  buscarParaSiniestro,
  editarSiniestro,
  fichaDeSiniestro,
  listarSiniestros,
  rutaDelAdjunto,
} from '../src/main/servicios/siniestros'
import { apurarAgrupadas, cuantasFallidas, cuantasPendientes } from '../src/main/sincronizacion/cola'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import type { FiltrosSiniestros, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada, type PestanaSimulada } from './hoja-simulada'

const FEDE: SesionUsuario = { id: 2, nombre: 'Fede', usuario: 'fede', rol: 'EMPLEADO', sucursal: { id: 1, nombre: 'Dock Sud' }, debeCambiarClave: false }
const MILAGROS: SesionUsuario = { id: 4, nombre: 'Milagros', usuario: 'milagros', rol: 'EMPLEADO', sucursal: { id: 2, nombre: 'Lanús' }, debeCambiarClave: false }

const SIN_FILTROS: FiltrosSiniestros = { periodo: '', busqueda: '', sucursales: [], companias: [], estado: '', soloRobos: false }

const PDF = Buffer.from('%PDF-1.4\n% denuncia de prueba\n' + 'x'.repeat(1500))

// --- Carpetas y computadoras -------------------------------------------------------------------

const temporales: string[] = []
function carpetaTemporal(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-siniestros-'))
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
  importar: () => Promise<void>
}

const abiertas: Computadora[] = []

function en(pc: Computadora): void {
  usarBaseDeDatos(pc.db)
  usarCarpetaDeAdjuntosDePrueba(pc.carpeta)
}

/**
 * Una computadora contra la hoja. `subeArchivos: false` arma un motor que sube la cola pero NO los
 * archivos, para reproducir la ventana entre que la ficha del adjunto viaja y el archivo llega.
 */
async function computadora(hoja: HojaSimulada, nombre: string, opciones: { subeArchivos?: boolean } = {}): Promise<Computadora> {
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
    repararSiniestrosSinCliente()
  }
  await importar()
  const motor = new MotorDeSincronizacion({
    crearFuente: () => hoja,
    importar,
    hayArchivosPendientes: hayAdjuntosPendientes,
    ...(opciones.subeArchivos === false ? {} : { subirArchivos: () => subirAdjuntosPendientes(null) }),
  })
  motor.encender()
  const pc = { nombre, db, motor, carpeta, importar }
  abiertas.push(pc)
  return pc
}

/** La hoja de la agencia, con la pestaña SINIESTROS tal como se pida. */
function hojaConSiniestros(ajustar?: (pestana: PestanaSimulada) => void, extras: PestanaSimulada[] = []): HojaSimulada {
  const pestanas = construirHojaDePrueba().filter((p) => p.titulo !== 'IMPUTADOS')
  const siniestros = pestanas.find((p) => p.titulo === 'SINIESTROS')!
  ajustar?.(siniestros)
  const hoja = new HojaSimulada([...pestanas, ...extras])
  usarFuenteDePrueba(hoja)
  return hoja
}

async function dosComputadoras(hoja: HojaSimulada, opciones: { subeArchivos?: boolean } = {}): Promise<{ lanus: Computadora; dockSud: Computadora }> {
  const lanus = await computadora(hoja, 'Lanús', opciones)
  const dockSud = await computadora(hoja, 'Dock Sud', opciones)
  return { lanus, dockSud }
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

function celda(hoja: HojaSimulada, pestana: string, filaId: string, encabezado: string): string | null {
  const columnaId = hoja.columnaIdDe(pestana)
  const columna = hoja.encabezadosDe(pestana).findIndex((e) => e.trim() === encabezado)
  const encontrada = hoja.filasDe(pestana).find((f) => (f[columnaId] ?? '').trim() === filaId)
  return encontrada && columna >= 0 ? (encontrada[columna] ?? '').trim() : null
}

function siniestroPorFila(db: BaseDeDatos, filaId: string): number {
  const fila = db.prepare('SELECT id FROM siniestros WHERE fila_id = ?').get(filaId) as { id: number } | undefined
  assert.ok(fila, `el siniestro ${filaId} tiene que existir en esta computadora`)
  return fila.id
}

/** Un siniestro nuevo para el auto de Pérez, cargado por el mostrador que esté activo. */
function cargarSiniestroDePerez(actor: SesionUsuario, fecha = '18/08/2026') {
  const candidato = buscarParaSiniestro(CLIENTES.perezAuto.patente)[0]!
  return altaDeSiniestro(
    {
      clienteId: candidato.clienteId,
      polizaId: candidato.polizaId,
      fecha,
      fechaCarga: '',
      numeroSiniestro: '',
      descripcion: 'LO CHOCARON DE ATRAS EN LA COLECTORA',
      estado: 'CARGADO',
      importe: '',
      observaciones: '',
      sucursal: 'LANUS',
    },
    actor,
  )
}

// ---------------------------------------------------------------------------
// El asegurado y la fecha llegan aunque la pestaña no tuviera esas columnas
// ---------------------------------------------------------------------------

test('un siniestro cargado en una computadora llega a la otra con asegurado y fecha aunque la pestaña no tuviera esas columnas', async () => {
  // La pestaña SINIESTROS de esta agencia no tiene columna de nombre, DNI, fecha del siniestro ni
  // cobertura: los encabezados están en blanco (los datos históricos quedan abajo, sin título).
  const hoja = hojaConSiniestros((pestana) => {
    const encabezados = pestana.valores[0]!
    for (const titulo of ['NOMBRE', 'DNI', 'FECHA', 'COBERTURA']) {
      const columna = encabezados.indexOf(titulo)
      assert.ok(columna >= 0, `la hoja de prueba tiene la columna ${titulo}`)
      encabezados[columna] = ''
    }
  })
  const { lanus, dockSud } = await dosComputadoras(hoja)

  // Los siniestros históricos no traen nombre… pero traen la patente y la póliza: el asegurado es el
  // titular de esa póliza, en las dos computadoras.
  for (const pc of [lanus, dockSud]) {
    en(pc)
    const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
    assert.equal(robo.clienteNombre, CLIENTES.gonzalez.nombre, `${pc.nombre}: el robo de González tiene asegurado aunque la pestaña no tenga NOMBRE`)
    assert.equal(robo.documento, CLIENTES.gonzalez.dni)
  }

  en(lanus)
  const ficha = cargarSiniestroDePerez(MILAGROS)
  const filaId = ficha.siniestro.filaId
  assert.equal(ficha.siniestro.clienteNombre, CLIENTES.perezAuto.nombre)
  assert.equal(ficha.siniestro.fecha, '18/08/2026')
  assert.match(ficha.siniestro.fechaCarga ?? '', /^\d{2}\/\d{2}\/\d{4}$/, 'la fecha de carga se escribe como en la planilla')
  await subirTodo(lanus)

  // La subida le agregó a la pestaña las columnas que le faltaban, al final, y escribió los datos ahí.
  const encabezados = hoja.encabezadosDe('SINIESTROS')
  for (const titulo of ['NOMBRE', 'DNI/CUIT', 'FECHA', 'COBERTURA']) {
    assert.ok(encabezados.includes(titulo), `la pestaña ganó la columna ${titulo}: ${encabezados.join(' | ')}`)
  }
  assert.equal(celda(hoja, 'SINIESTROS', filaId, 'NOMBRE'), CLIENTES.perezAuto.nombre)
  assert.equal(celda(hoja, 'SINIESTROS', filaId, 'FECHA'), '18/08/2026')
  assert.equal(celda(hoja, 'SINIESTROS', filaId, 'COBERTURA'), 'TERCEROS COMPLETO')
  assert.equal(celda(hoja, 'SINIESTROS', filaId, 'PATENTE'), CLIENTES.perezAuto.patente, 'lo que ya tenía columna sigue en su lugar')
  const eventos = lanus.db.prepare(`SELECT detalle FROM eventos_sync WHERE tipo = 'columna faltante'`).all()
  assert.equal(eventos.length, 0, 'ningún dato se descartó por falta de columna')

  // La otra computadora lo ve entero: con la persona, la fecha y la cobertura.
  en(dockSud)
  await dockSud.motor.ciclarBajada()
  const idAlla = siniestroPorFila(dockSud.db, filaId)
  const alla = fichaDeSiniestro(idAlla).siniestro
  assert.equal(alla.clienteNombre, CLIENTES.perezAuto.nombre, 'el asegurado llegó a la otra computadora')
  assert.equal(alla.documento, CLIENTES.perezAuto.dni)
  assert.equal(alla.fecha, '18/08/2026', 'la fecha del siniestro también')
  assert.equal(alla.fechaIso, '2026-08-18')
  assert.equal(alla.cobertura, 'TERCEROS COMPLETO')
  assert.equal(alla.compania, 'RIVADAVIA')
  assert.equal(alla.numeroPoliza, '998877')
  assert.equal(alla.patente, CLIENTES.perezAuto.patente)
  assert.equal(alla.descripcion, 'LO CHOCARON DE ATRAS EN LA COLECTORA')
  assert.ok(alla.clienteId, 'y quedó enganchado al cliente, así la ficha ofrece sus pólizas')
  cerrarTodo()
})

test('lo que se cargó antes del arreglo y no había viajado se vuelve a mandar al arrancar', async () => {
  const hoja = hojaConSiniestros((pestana) => {
    const encabezados = pestana.valores[0]!
    encabezados[encabezados.indexOf('NOMBRE')] = ''
    encabezados[encabezados.indexOf('FECHA')] = ''
  })
  const { lanus, dockSud } = await dosComputadoras(hoja)
  en(lanus)
  const ficha = cargarSiniestroDePerez(MILAGROS)
  const filaId = ficha.siniestro.filaId

  // Se simula la 12.6: la fila viajó sin nombre ni fecha (la subida los descartó) y la pestaña sigue
  // sin esas columnas. Para eso se saca de la cola lo que iba a escribirlos y se sube el resto.
  const entrada = lanus.db.prepare(`SELECT id, campos_json FROM cola_sync WHERE fila_id = ? AND estado = 'pendiente'`).get(filaId) as { id: number; campos_json: string }
  const campos = JSON.parse(entrada.campos_json) as Record<string, string>
  delete campos.nombre
  delete campos.documento
  delete campos.fecha
  delete campos.cobertura
  lanus.db.prepare('UPDATE cola_sync SET campos_json = ? WHERE id = ?').run(JSON.stringify(campos), entrada.id)
  await subirTodo(lanus)
  assert.ok(!hoja.encabezadosDe('SINIESTROS').includes('NOMBRE'), 'la pestaña sigue sin columna de nombre')

  en(dockSud)
  await dockSud.motor.ciclarBajada()
  const idAlla = siniestroPorFila(dockSud.db, filaId)
  // Sin columna de nombre, la otra computadora igual lo muestra: el titular de la póliza.
  assert.equal(fichaDeSiniestro(idAlla).siniestro.clienteNombre, CLIENTES.perezAuto.nombre)
  assert.equal(fichaDeSiniestro(idAlla).siniestro.fecha, null, 'pero la fecha del siniestro no llegó: no había dónde escribirla')

  // El arranque de la 12.7 en la computadora que lo cargó: compara su base con lo que quedó en la
  // hoja y vuelve a mandar lo que faltó. La subida agrega las columnas y lo escribe.
  en(lanus)
  assert.equal(reenviarSiniestrosIncompletos(), 1, 'un siniestro tenía datos sin viajar')
  assert.equal(reenviarSiniestrosIncompletos(), 0, 'y no se encola dos veces mientras espera')
  await subirTodo(lanus)
  assert.equal(celda(hoja, 'SINIESTROS', filaId, 'NOMBRE'), CLIENTES.perezAuto.nombre)
  assert.equal(celda(hoja, 'SINIESTROS', filaId, 'FECHA'), '18/08/2026')
  assert.equal(reenviarSiniestrosIncompletos(), 0, 'una vez en la hoja, no hay nada que volver a mandar')

  en(dockSud)
  const bajada = await dockSud.motor.ciclarBajada()
  assert.ok(bajada)
  assert.equal(bajada.necesitaImportacion, false, 'una fila conocida que cambió no pide la importación completa')
  assert.equal(fichaDeSiniestro(idAlla).siniestro.fecha, '18/08/2026', 'la fecha llegó por la bajada, sin reimportar')
  assert.equal(fichaDeSiniestro(idAlla).siniestro.fechaIso, '2026-08-18')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Las correcciones de la ficha bajan a la otra computadora sin importación completa
// ---------------------------------------------------------------------------

test('una corrección de la ficha hecha en una computadora baja a la otra, abogado y tercero incluidos', async () => {
  const hoja = hojaConSiniestros()
  const { lanus, dockSud } = await dosComputadoras(hoja)
  en(lanus)
  const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  editarSiniestro(robo.id, 'cobertura', 'TODO RIESGO CON FRANQUICIA', MILAGROS)
  editarSiniestro(robo.id, 'patente', 'AB123CD', MILAGROS)
  editarSiniestro(robo.id, 'fecha', '03/08/2026', MILAGROS)
  editarSiniestro(robo.id, 'sucursal', 'Lanús', MILAGROS)
  editarSiniestro(robo.id, 'abogado', 'Dr. Suárez, 11-4455-6677', MILAGROS)
  editarSiniestro(robo.id, 'terceroCompania', 'MERCANTIL ANDINA', MILAGROS)
  editarSiniestro(robo.id, 'terceroTelefono', '11-2233-4455', MILAGROS)
  editarSiniestro(robo.id, 'terceroPatente', 'AG321XY', MILAGROS)
  editarSiniestro(robo.id, 'terceroLesionados', 'SI', MILAGROS)
  editarSiniestro(robo.id, 'terceroLesionadosDetalle', 'El acompañante, fue al Fiorito', MILAGROS)
  await subirTodo(lanus)

  // La pestaña ganó las columnas del abogado y del tercero, con títulos que la agencia entiende.
  const encabezados = hoja.encabezadosDe('SINIESTROS')
  for (const titulo of ['ABOGADO', 'COMPAÑIA DEL TERCERO', 'TELEFONO DEL TERCERO', 'PATENTE DEL TERCERO', 'TERCEROS LESIONADOS', 'QUIEN SE LESIONO']) {
    assert.ok(encabezados.includes(titulo), `la pestaña ganó la columna ${titulo}: ${encabezados.join(' | ')}`)
  }
  assert.equal(celda(hoja, 'SINIESTROS', robo.filaId, 'ABOGADO'), 'Dr. Suárez, 11-4455-6677')
  assert.equal(celda(hoja, 'SINIESTROS', robo.filaId, 'COBERTURA'), 'TODO RIESGO CON FRANQUICIA')

  en(dockSud)
  const bajada = await dockSud.motor.ciclarBajada()
  assert.ok(bajada)
  assert.equal(bajada.necesitaImportacion, false, 'una corrección no dispara la importación completa')
  const idAlla = siniestroPorFila(dockSud.db, robo.filaId)
  const alla = fichaDeSiniestro(idAlla).siniestro
  assert.equal(alla.cobertura, 'TODO RIESGO CON FRANQUICIA', 'la cobertura corregida bajó a la tabla, no sólo a los datos crudos')
  assert.equal(alla.patente, 'AB123CD')
  assert.equal(alla.fecha, '03/08/2026')
  assert.equal(alla.fechaIso, '2026-08-03', 'con su fecha derivada, así el mes y el orden coinciden')
  assert.equal(alla.sucursal, 'Lanús')
  assert.equal(alla.abogado, 'Dr. Suárez, 11-4455-6677', 'el abogado se ve en la otra computadora')
  assert.equal(alla.terceroCompania, 'MERCANTIL ANDINA')
  assert.equal(alla.terceroTelefono, '11-2233-4455')
  assert.equal(alla.terceroPatente, 'AG321XY')
  assert.equal(alla.terceroLesionados, 'SI')
  assert.equal(alla.terceroLesionadosDetalle, 'El acompañante, fue al Fiorito')

  // Y a la inversa: Dock Sud borra el abogado y Lanús se entera.
  editarSiniestro(idAlla, 'abogado', '', FEDE)
  await subirTodo(dockSud)
  en(lanus)
  await lanus.motor.ciclarBajada()
  assert.equal(fichaDeSiniestro(robo.id).siniestro.abogado, null, 'lo que se borró allá se borró acá')
  assert.equal(fichaDeSiniestro(robo.id).siniestro.terceroCompania, 'MERCANTIL ANDINA', 'lo demás sigue')

  // Después de todo eso, una importación completa no cambia nada: las dos bases dicen lo mismo.
  for (const pc of [lanus, dockSud]) {
    en(pc)
    await pc.importar()
    const s = fichaDeSiniestro(siniestroPorFila(pc.db, robo.filaId)).siniestro
    assert.equal(s.abogado, null, `${pc.nombre}: reimportar no resucita el abogado borrado`)
    assert.equal(s.terceroPatente, 'AG321XY', `${pc.nombre}: reimportar conserva el tercero`)
    assert.equal(s.cobertura, 'TODO RIESGO CON FRANQUICIA')
  }
  cerrarTodo()
})

test('el renglón «Abogado: …» de una versión anterior completa la ficha de la otra computadora', async () => {
  const hoja = hojaConSiniestros()
  const { lanus, dockSud } = await dosComputadoras(hoja)
  en(lanus)
  const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  // Hasta la 12.6 el abogado sólo viajaba así: como texto en la línea de tiempo.
  agregarObservacion(robo.id, 'Abogado: Dra. López, 11-5555-0000', MILAGROS)
  agregarObservacion(robo.id, 'Patente del tercero: AC999ZZ', MILAGROS)
  await subirTodo(lanus)

  en(dockSud)
  await dockSud.motor.ciclarTareas()
  const alla = fichaDeSiniestro(siniestroPorFila(dockSud.db, robo.filaId)).siniestro
  assert.equal(alla.abogado, 'Dra. López, 11-5555-0000', 'el renglón llenó el campo vacío')
  assert.equal(alla.terceroPatente, 'AC999ZZ')
  cerrarTodo()
})

test('el listado se ordena igual en las dos computadoras aunque los id locales sean distintos', async () => {
  const hoja = hojaConSiniestros()
  const { lanus, dockSud } = await dosComputadoras(hoja)
  en(lanus)
  cargarSiniestroDePerez(MILAGROS, '18/08/2026')
  cargarSiniestroDePerez(MILAGROS, '18/08/2026')
  await subirTodo(lanus)
  en(dockSud)
  // Dock Sud carga uno más el mismo día: sus id locales quedan en otro orden que los de Lanús.
  cargarSiniestroDePerez(FEDE, '18/08/2026')
  await subirTodo(dockSud)
  await dockSud.motor.ciclarBajada()
  en(lanus)
  await lanus.motor.ciclarBajada()

  en(lanus)
  const ordenLanus = listarSiniestros(SIN_FILTROS).filas.map((f) => f.filaId)
  en(dockSud)
  const ordenDockSud = listarSiniestros(SIN_FILTROS).filas.map((f) => f.filaId)
  assert.equal(ordenLanus.length, 6, 'tres de la hoja y tres cargados')
  assert.deepEqual(ordenDockSud, ordenLanus, 'el mismo orden en las dos computadoras')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Los documentos: «en el servidor» quiere decir en el servidor
// ---------------------------------------------------------------------------

test('un documento que todavía no subió no figura «en el servidor», y una importación completa no lo da por subido', async () => {
  // APP ADJUNTOS ya existe en esta base, armada por la 12.6 sin la columna SUBIDO.
  const hoja = hojaConSiniestros(undefined, [
    { titulo: 'APP ADJUNTOS', valores: [['FECHA', 'TIPO', 'VINCULO', 'DESCRIPCION', 'NOMBRE', 'CATEGORIA', 'ARCHIVO', 'TAMANO', 'SHA256', 'CARGADO POR', '_ID']] },
  ])
  // Lanús sube la cola pero no los archivos: es la ventana entre que la ficha viaja y el archivo llega.
  const { lanus, dockSud } = await dosComputadoras(hoja, { subeArchivos: false })
  en(lanus)
  const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  const conDenuncia = await agregarArchivosDeSiniestro(robo.id, [{ nombre: 'denuncia.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], 'Denuncia', '', MILAGROS)
  assert.equal(conDenuncia.adjuntos.length, 1)
  await subirTodo(lanus)
  assert.equal(hoja.almacen.size, 0, 'el archivo todavía no llegó al servidor')
  assert.ok(!hoja.encabezadosDe('APP ADJUNTOS').includes('SUBIDO'), 'mientras no hay nada que decir, la pestaña vieja sigue como estaba')

  // Una importación completa en la computadora que lo cargó NO lo da por subido (era el bug de la 12.6).
  await lanus.importar()
  const local = lanus.db.prepare('SELECT vps_subido_en, archivo FROM siniestro_adjuntos').get() as { vps_subido_en: string | null; archivo: string }
  assert.equal(local.vps_subido_en, null, 'reimportar no marca como subido un archivo que no subió')
  assert.notEqual(local.archivo, '', 'y no pierde el archivo local')
  assert.equal(hayAdjuntosPendientes(), true, 'sigue pendiente de subir')
  assert.equal(fichaDeSiniestro(robo.id).adjuntos[0]!.enElServidor, false)

  // En la otra computadora la ficha dice la verdad: cargado en otra computadora, todavía no en el servidor.
  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const idAlla = siniestroPorFila(dockSud.db, robo.filaId)
  let alla = fichaDeSiniestro(idAlla).adjuntos[0]!
  assert.equal(alla.nombre, 'denuncia.pdf')
  assert.equal(alla.enElServidor, false, 'no se da por subido con sólo ver la fila')
  assert.equal(alla.enOtraComputadora, true)
  assert.equal(alla.descargado, false)
  await assert.rejects(rutaDelAdjunto(alla.id), /todavía no llegó al servidor/)

  // Lanús termina de subirlo: el archivo al servidor y la columna SUBIDO a la fila.
  en(lanus)
  const subida = await subirAdjuntosPendientes(null)
  assert.deepEqual(subida, { subidos: 1, fallidos: 0 })
  assert.equal(hoja.almacen.size, 1)
  await subirTodo(lanus)
  assert.ok(hoja.encabezadosDe('APP ADJUNTOS').includes('SUBIDO'), 'la pestaña vieja ganó la columna SUBIDO al primer archivo que llegó')
  const filaId = lanus.db.prepare('SELECT fila_id FROM siniestro_adjuntos').get() as { fila_id: string }
  assert.match(celda(hoja, 'APP ADJUNTOS', filaId.fila_id, 'SUBIDO') ?? '', /^\d{4}-\d{2}-\d{2}T/, 'la fila dice cuándo llegó')

  // Dock Sud se entera por el carril rápido, y ahora sí lo abre.
  en(dockSud)
  const rapido = await dockSud.motor.ciclarTareas()
  assert.ok(rapido)
  assert.equal(rapido.necesitaImportacion, false)
  alla = fichaDeSiniestro(idAlla).adjuntos[0]!
  assert.equal(alla.enElServidor, true, 'la otra computadora ya sabe que está en el servidor')
  assert.equal(alla.enOtraComputadora, false)
  const ruta = await rutaDelAdjunto(alla.id)
  assert.ok(ruta.startsWith(dockSud.carpeta))
  assert.equal(fichaDeSiniestro(idAlla).adjuntos[0]!.descargado, true)
  cerrarTodo()
})

test('lo que figuraba subido sin estarlo vuelve a subir al contrastar con el servidor', async () => {
  const hoja = hojaConSiniestros()
  const { lanus, dockSud } = await dosComputadoras(hoja, { subeArchivos: false })
  en(lanus)
  const robo = listarSiniestros({ ...SIN_FILTROS, soloRobos: true }).filas[0]!
  await agregarArchivosDeSiniestro(robo.id, [{ nombre: 'denuncia.pdf', tipo: 'application/pdf', contenido: new Uint8Array(PDF) }], 'Denuncia', '', MILAGROS)
  await subirTodo(lanus)
  // Lo que dejó la 12.6: marcado como subido, sin haber subido.
  lanus.db.prepare(`UPDATE siniestro_adjuntos SET vps_subido_en = ?`).run(ahoraIso())
  assert.equal(hayAdjuntosPendientes(), false, 'así nunca iba a subir')
  assert.equal(hoja.almacen.size, 0)

  const verificacion = await verificarAdjuntosContraElServidor()
  assert.deepEqual(verificacion, { reencolados: 1, confirmados: 0 })
  assert.equal(hayAdjuntosPendientes(), true, 'vuelve a la cola de subida')
  await subirAdjuntosPendientes(null)
  assert.equal(hoja.almacen.size, 1, 'y sube')
  assert.equal((await verificarAdjuntosContraElServidor()).reencolados, 0, 'la segunda pasada no toca nada')

  // La otra computadora recibió la fila antes de que el archivo llegara (sin SUBIDO): al contrastar,
  // se confirma que está y se puede abrir.
  en(dockSud)
  await dockSud.motor.ciclarBajada(true)
  const idAlla = siniestroPorFila(dockSud.db, robo.filaId)
  assert.equal(fichaDeSiniestro(idAlla).adjuntos[0]!.enOtraComputadora, true)
  assert.deepEqual(await verificarAdjuntosContraElServidor(), { reencolados: 0, confirmados: 1 })
  assert.equal(fichaDeSiniestro(idAlla).adjuntos[0]!.enElServidor, true)
  await rutaDelAdjunto(fichaDeSiniestro(idAlla).adjuntos[0]!.id)
  cerrarTodo()
})
