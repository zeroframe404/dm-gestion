// Dos computadoras contra la misma base de la agencia: es el caso real de Lanús (dos mostradores, dos
// PC) y el origen de los dos problemas que cierra la 12.2. Una baja hecha en una tiene que salir de
// la planilla de la otra —y no poder repetirse, que era lo que duplicaba BAJAS—, y un pago cobrado en
// una tiene que aparecer en la caja del día de la otra.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { bajasDelMes, darDeBaja, deshacerBaja, editarCelda, periodosDisponibles, planillaDelMes, registrarPago } from '../src/main/servicios/cartera'
import { cajaDelDia, cambiarResultado, cargarMovimientoDeCaja, imputados } from '../src/main/servicios/cobranzas'
import { filaIdDelMovimiento } from '../src/main/servicios/caja'
import { PESTANA_APP } from '../src/main/servicios/filas'
import { hojaDeImputados, subirPagosRezagados } from '../src/main/servicios/pagos'
import { repararBajasDuplicadas, repararColaContraPestanaInexistente, repararCuotasDuplicadas } from '../src/main/servicios/reparaciones'
import { cerrarMesConLaBase } from '../src/main/servicios/sincronizacion'
import { apurarAgrupadas, cuantasFallidas, cuantasPendientes } from '../src/main/sincronizacion/cola'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { PESTANA_CAJA_APP, PESTANA_PAGOS_APP } from '../src/main/sincronizacion/pestanasApp'
import type { FilaCartera, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 4, nombre: 'Daniel' }, debeCambiarClave: false }
const FEDE: SesionUsuario = { id: 2, nombre: 'Fede', usuario: 'fede', rol: 'EMPLEADO', sucursal: { id: 1, nombre: 'Dock Sud' }, debeCambiarClave: false }
const MILAGROS: SesionUsuario = { id: 4, nombre: 'Milagros', usuario: 'milagros', rol: 'EMPLEADO', sucursal: { id: 2, nombre: 'Lanús' }, debeCambiarClave: false }
const DAIANA: SesionUsuario = { id: 5, nombre: 'Daiana', usuario: 'daiana', rol: 'EMPLEADO', sucursal: { id: 2, nombre: 'Lanús' }, debeCambiarClave: false }
const SOFIA: SesionUsuario = { id: 6, nombre: 'Sofia', usuario: 'sofia', rol: 'ADMIN', sucursal: { id: 4, nombre: 'Daniel' }, debeCambiarClave: false }

interface Computadora {
  nombre: string
  db: BaseDeDatos
  motor: MotorDeSincronizacion
  importar: () => Promise<void>
}

const abiertas: Computadora[] = []

/** Deja activa la base de esa computadora: todo lo que sigue corre «desde» ella. */
function en(pc: Computadora): void {
  usarBaseDeDatos(pc.db)
}

async function computadora(hoja: HojaSimulada, nombre: string): Promise<Computadora> {
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  // Los pagos apuntan a quien cobró: las personas tienen que existir en cada computadora (la base de
  // usuarios compartida las trae; acá se cargan a mano, sin clave, porque nadie inicia sesión).
  const alta = db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES (@id, @nombre, @usuario, 'sin-clave', @rol, (SELECT id FROM sucursales WHERE nombre = @sucursal), 1, 0)`,
  )
  for (const persona of [FEDE, MILAGROS, DAIANA, SOFIA]) {
    alta.run({ id: persona.id, nombre: persona.nombre, usuario: persona.usuario, rol: persona.rol, sucursal: persona.sucursal.nombre })
  }
  const importar = async () => {
    usarBaseDeDatos(db)
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  }
  await importar()
  const motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar })
  motor.encender()
  const pc = { nombre, db, motor, importar }
  abiertas.push(pc)
  return pc
}

/** La hoja de la agencia tal cual es: IMPUTADOS no es una tabla por fila, así que se saca del todo. */
async function dosComputadoras(): Promise<{ hoja: HojaSimulada; lanus1: Computadora; lanus2: Computadora }> {
  cerrarTodo()
  const hoja = new HojaSimulada(construirHojaDePrueba())
  hoja.quitarPestana('IMPUTADOS')
  const lanus1 = await computadora(hoja, 'Lanús 1')
  const lanus2 = await computadora(hoja, 'Lanús 2')
  return { hoja, lanus1, lanus2 }
}

function cerrarTodo(): void {
  for (const pc of abiertas) {
    pc.motor.apagar()
    pc.db.close()
  }
  abiertas.length = 0
  cerrarBaseDeDatos()
}

function fila(nombre: string): FilaCartera | undefined {
  return planillaDelMes(null).filas.find((f) => f.nombre === nombre)
}

/**
 * Copia una fila de la planilla del mes con otro `_ID`, que es lo que deja la importación cuando el
 * mismo renglón aparece dos veces en la hoja (una pestaña duplicada, o un copiar y pegar).
 */
function duplicarCuota(pc: Computadora, filaId: string, filaIdDeLaCopia: string): void {
  const ahora = ahoraIso()
  pc.db
    .prepare(
      `INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania,
                               numero_poliza, patente, sucursal_texto, cuota, cuota_monto, dia_vencimiento,
                               dia_vencimiento_numero, aviso, pago, pago_fecha, observaciones, forma_pago, creado_en, actualizado_en)
       SELECT ?, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania,
              numero_poliza, patente, sucursal_texto, cuota, cuota_monto, dia_vencimiento,
              dia_vencimiento_numero, aviso, pago, pago_fecha, observaciones, forma_pago, ?, ?
         FROM cuotas_mes WHERE fila_id = ?`,
    )
    .run(filaIdDeLaCopia, ahora, ahora, filaId)
  pc.db
    .prepare(
      `INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, periodo, numero_fila, datos_json, en_la_hoja, huella, creado_en, actualizado_en)
       SELECT ?, pestana, tipo_pestana, periodo, numero_fila + 1000, '{}', 1, NULL, ?, ?
         FROM filas_crudas WHERE fila_id = ?`,
    )
    .run(filaIdDeLaCopia, ahora, ahora, filaId)
}

function exigirFila(nombre: string): FilaCartera {
  const encontrada = fila(nombre)
  if (!encontrada) throw new Error(`No está «${nombre}» en la planilla`)
  return encontrada
}

/** Cuántos renglones de la pestaña llevan ese _ID (tiene que ser uno, nunca dos). */
function renglonesCon(hoja: HojaSimulada, pestana: string, filaId: string): number {
  const columnaId = hoja.columnaIdDe(pestana)
  return hoja.filasDe(pestana).filter((f) => (f[columnaId] ?? '').trim() === filaId).length
}

function celda(hoja: HojaSimulada, pestana: string, filaId: string, encabezado: string): string | null {
  const columnaId = hoja.columnaIdDe(pestana)
  const columna = hoja.encabezadosDe(pestana).findIndex((e) => e.trim() === encabezado)
  const encontrada = hoja.filasDe(pestana).find((f) => (f[columnaId] ?? '').trim() === filaId)
  return encontrada && columna >= 0 ? (encontrada[columna] ?? '').trim() : null
}

/** Sube lo que espera en la cola, incluidos los borrados que esperan su ventana de agrupado. */
async function subirTodo(pc: Computadora): Promise<void> {
  en(pc)
  apurarAgrupadas()
  await pc.motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 0, `${pc.nombre}: ninguna entrada tiene que quedar sin arreglo`)
  assert.equal(cuantasPendientes(), 0, `${pc.nombre}: la cola tiene que quedar vacía`)
}

// ---------------------------------------------------------------------------
// Bajas
// ---------------------------------------------------------------------------

test('una baja hecha en una computadora saca la cuota de la planilla de la otra, y repetirla no la duplica', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  const martinez = exigirFila(CLIENTES.martinez.nombre)
  darDeBaja(martinez.filaId, { motivo: 'VENDIO', nota: 'Vendió la camioneta' }, MILAGROS)
  await subirTodo(lanus1)
  const idDeLaBaja = `BAJA:${martinez.filaId}`
  assert.equal(renglonesCon(hoja, 'BAJAS AGOSTO', idDeLaBaja), 1)

  // La otra computadora baja los cambios: la fila nueva de BAJAS dispara la importación completa.
  en(lanus2)
  await lanus2.motor.ciclarBajada()
  assert.equal(fila(CLIENTES.martinez.nombre), undefined, 'la cuota tiene que salir de la planilla de la otra computadora')
  const enBajas = bajasDelMes('2026-08').filter((b) => b.clienteNombre === CLIENTES.martinez.nombre)
  assert.equal(enBajas.length, 1, 'y aparecer una sola vez en sus Bajas')
  assert.equal(enBajas[0]!.motivo, 'VENDIO')

  // Hasta la 12.1 la cuota seguía en la planilla de la otra computadora y alguien la volvía a dar de
  // baja: el segundo renglón se agregaba igual a BAJAS con el mismo _ID. Se simula esa base atrasada.
  lanus2.db.prepare('UPDATE cuotas_mes SET dada_de_baja = 0 WHERE fila_id = ?').run(martinez.filaId)
  darDeBaja(martinez.filaId, { motivo: 'ANULA POR FALTA DE PAGO', nota: '' }, DAIANA)
  await subirTodo(lanus2)
  assert.equal(renglonesCon(hoja, 'BAJAS AGOSTO', idDeLaBaja), 1, 'la fila de BAJAS no se agrega dos veces: se escribe sobre la que hay')
  assert.equal(celda(hoja, 'BAJAS AGOSTO', idDeLaBaja, 'MOTIVO'), 'ANULA POR FALTA DE PAGO', 'con el motivo de la última baja')
  assert.equal(bajasDelMes('2026-08').filter((b) => b.clienteNombre === CLIENTES.martinez.nombre).length, 1)

  en(lanus1)
  await lanus1.motor.ciclarBajada()
  await lanus1.importar()
  assert.equal(bajasDelMes('2026-08').filter((b) => b.clienteNombre === CLIENTES.martinez.nombre).length, 1, 'tampoco en la primera')
  cerrarTodo()
})

test('dos computadoras borran en el mismo minuto: cada una saca SU renglón aunque la grilla se haya corrido (12.6)', async () => {
  // El caso que duplicaba la cartera y la hacía distinta en cada PC. Lanús 1 lee la planilla, decide
  // borrar el renglón de López por su número, y ANTES de que ese borrado llegue Lanús 2 borra un
  // renglón más arriba: en la base todos los de abajo se corren uno. Hasta la 12.5 el número viejo
  // borraba la póliza de al lado; ahora el borrado viaja con el _ID y cae donde tiene que caer.
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  const idsAntes = hoja.idsDe('AGOSTO')
  const renglonDe = (filaId: string) => [...idsAntes.entries()].find(([, id]) => id === filaId)?.[0] ?? -1

  en(lanus1)
  const lopez = exigirFila(CLIENTES.lopez.nombre)
  const suarez = exigirFila(CLIENTES.suarez.nombre)
  en(lanus2)
  const gonzalez = exigirFila(CLIENTES.gonzalez.nombre)
  assert.ok(renglonDe(gonzalez.filaId) < renglonDe(lopez.filaId), 'González está más arriba que López en la planilla')
  assert.ok(renglonDe(lopez.filaId) < renglonDe(suarez.filaId), 'y Suárez, más abajo que López')

  // Lanús 1: da de baja a López y además le anota un aviso a Suárez (una celda, no un borrado).
  en(lanus1)
  darDeBaja(lopez.filaId, { motivo: 'VENDIO', nota: '' }, MILAGROS)
  editarCelda(suarez.filaId, 'observaciones', 'LLAMAR EL LUNES', MILAGROS)
  // Lanús 2: da de baja a González, el renglón de más arriba.
  en(lanus2)
  darDeBaja(gonzalez.filaId, { motivo: 'VENDIO', nota: '' }, DAIANA)

  // La carrera: Lanús 1 lee la planilla y, entre esa lectura y su escritura, Lanús 2 sube lo suyo.
  const leerDeVerdad = hoja.leerVarias.bind(hoja)
  hoja.leerVarias = async (titulos, hastaFila) => {
    const lectura = await leerDeVerdad(titulos, hastaFila)
    hoja.leerVarias = leerDeVerdad
    await subirTodo(lanus2)
    en(lanus1)
    return lectura
  }
  await subirTodo(lanus1)

  assert.equal(renglonesCon(hoja, 'AGOSTO', gonzalez.filaId), 0, 'González salió de la planilla')
  assert.equal(renglonesCon(hoja, 'AGOSTO', lopez.filaId), 0, 'López salió de la planilla')
  assert.equal(renglonesCon(hoja, 'AGOSTO', suarez.filaId), 1, 'Suárez sigue: no se borró el renglón de al lado')
  assert.equal(hoja.idsDe('AGOSTO').size, idsAntes.size - 2, 'se fueron exactamente dos renglones')
  assert.equal(celda(hoja, 'AGOSTO', suarez.filaId, 'OBS'), 'LLAMAR EL LUNES', 'el aviso cayó en el renglón de Suárez, no en el que ahora ocupa su número viejo')
  for (const otro of [CLIENTES.perezAuto, CLIENTES.perezMoto, CLIENTES.rodriguez, CLIENTES.martinez]) {
    en(lanus1)
    assert.ok(fila(otro.nombre), `${otro.nombre} sigue en la planilla de Lanús 1`)
  }

  // Las dos computadoras terminan viendo lo mismo: dos bajas, ninguna fantasma.
  for (const pc of [lanus1, lanus2]) {
    en(pc)
    await pc.motor.ciclarBajada()
    assert.equal(planillaDelMes('2026-08').filas.length, idsAntes.size - 2, `${pc.nombre}: la planilla tiene dos filas menos`)
    assert.equal(bajasDelMes('2026-08').length, 2, `${pc.nombre}: dos bajas, las dos de verdad`)
    assert.ok(fila(CLIENTES.suarez.nombre), `${pc.nombre}: Suárez sigue vigente`)
  }
  cerrarTodo()
})

test('dos computadoras cierran el mes: sólo una crea la planilla nueva y la otra recibe un aviso claro (12.6)', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  const filasDeAgosto = planillaDelMes('2026-08').filas.length
  const resumen = await cerrarMesConLaBase(DANIEL, { fuente: hoja, sincronizar: () => lanus1.motor.sincronizarAhora(true) })
  assert.equal(resumen.periodo, '2026-09')
  assert.ok(hoja.titulos().includes('SEPTIEMBRE'), 'la pestaña se creó en la base ANTES de copiar las filas: es el candado')
  await subirTodo(lanus1)
  assert.equal(hoja.filasDe('SEPTIEMBRE').length - 1, filasDeAgosto, 'una fila por póliza activa')

  // Lanús 2 leyó la estructura antes de que Lanús 1 creara la pestaña (los dos pasan el «¿ya está
  // abierto?»): la base es la que dice que no, y acá no se copia nada.
  en(lanus2)
  const estructuraDeVerdad = hoja.estructura.bind(hoja)
  hoja.estructura = async () => {
    const estructura = await estructuraDeVerdad()
    return { ...estructura, pestanas: estructura.pestanas.filter((p) => p.titulo !== 'SEPTIEMBRE') }
  }
  await assert.rejects(cerrarMesConLaBase(DANIEL, { fuente: hoja, sincronizar: async () => undefined }), /Otra computadora acaba de cerrar el mes/)
  hoja.estructura = estructuraDeVerdad
  assert.equal(periodosDisponibles().some((p) => p.periodo === '2026-09'), false, 'Lanús 2 no copió ninguna fila')

  // Con la base a la vista, el freno es «ya está abierto en la base».
  await assert.rejects(cerrarMesConLaBase(DANIEL, { fuente: hoja, sincronizar: async () => undefined }), /ya está abierto en la base/)
  assert.equal(hoja.filasDe('SEPTIEMBRE').length - 1, filasDeAgosto, 'la planilla nueva sigue con una fila por póliza')
  // Y la sincronización de verdad le trae a Lanús 2 el mes nuevo tal como lo cerró Lanús 1.
  await lanus2.motor.sincronizarAhora(true)
  assert.equal(planillaDelMes('2026-09').filas.length, filasDeAgosto, 'Lanús 2 ve el mes nuevo con una fila por póliza')
  assert.equal(planillaDelMes('2026-09').filas.filter((f) => f.nombre === CLIENTES.lopez.nombre).length, 1, 'y a cada póliza una sola vez')

  // Sin conexión con la base no se cierra: el candado vive en la base.
  await assert.rejects(cerrarMesConLaBase(DANIEL, { fuente: null }), /Sin conexión con la base/)
  cerrarTodo()
})

test('renombrar una pestaña no le cambia el _ID a nadie en ninguna computadora (12.6)', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  const idsAntes = [...hoja.idsDe('AGOSTO').values()]
  const escriturasAntes = hoja.llamadas.escribirColumna
  en(lanus1)
  const filasAntes = planillaDelMes('2026-08').filas.length
  const bajasAntes = bajasDelMes('2026-08').length

  hoja.restaurarPestana(Object.assign(hoja.quitarPestana('AGOSTO'), { titulo: 'AGOSTO 2026' }))
  for (const pc of [lanus1, lanus2]) {
    en(pc)
    await pc.importar()
    assert.equal(planillaDelMes('2026-08').filas.length, filasAntes, `${pc.nombre}: la planilla tiene las mismas filas`)
    assert.equal(bajasDelMes('2026-08').length, bajasAntes, `${pc.nombre}: ninguna baja fantasma`)
  }
  assert.deepEqual([...hoja.idsDe('AGOSTO 2026').values()], idsAntes, 'los _ID son los mismos de antes')
  assert.equal(hoja.llamadas.escribirColumna, escriturasAntes, 'ninguna computadora escribió un _ID')
  cerrarTodo()
})

test('deshacer una baja saca el renglón de la pestaña BAJAS de verdad y la otra computadora la olvida', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  const gonzalez = exigirFila(CLIENTES.gonzalez.nombre)
  darDeBaja(gonzalez.filaId, { motivo: 'VENDIO', nota: '' }, MILAGROS)
  await subirTodo(lanus1)
  en(lanus2)
  await lanus2.motor.ciclarBajada()
  assert.equal(fila(CLIENTES.gonzalez.nombre), undefined)
  assert.equal(bajasDelMes('2026-08').some((b) => b.clienteNombre === CLIENTES.gonzalez.nombre), true)

  // «Me equivoqué»: la baja se deshace en la computadora que la hizo. El borrado tiene que ir a
  // «BAJAS AGOSTO», donde vive el renglón, y no a «(cargado en DM Gestión)», que no existe en ninguna
  // base: eso dejaba la baja en la hoja para siempre y volvía por la importación en todas las PC.
  en(lanus1)
  const baja = bajasDelMes('2026-08').find((b) => b.clienteNombre === CLIENTES.gonzalez.nombre)!
  deshacerBaja(baja.id, DANIEL)
  const pendientes = lanus1.db.prepare(`SELECT pestana, operacion FROM cola_sync WHERE estado = 'pendiente'`).all() as Array<{ pestana: string; operacion: string }>
  assert.ok(pendientes.every((p) => p.pestana !== PESTANA_APP), 'nada se encola contra la pestaña que no existe')
  await subirTodo(lanus1)
  assert.equal(renglonesCon(hoja, 'BAJAS AGOSTO', `BAJA:${gonzalez.filaId}`), 0, 'el renglón salió de BAJAS')
  assert.equal(renglonesCon(hoja, 'AGOSTO', gonzalez.filaId), 1, 'y la cuota volvió a la planilla')

  en(lanus2)
  await lanus2.motor.ciclarBajada()
  assert.ok(fila(CLIENTES.gonzalez.nombre), 'la cuota vuelve a la planilla de la otra computadora')
  assert.equal(bajasDelMes('2026-08').some((b) => b.clienteNombre === CLIENTES.gonzalez.nombre), false, 'y la baja deshecha desaparece de sus Bajas')
  cerrarTodo()
})

test('un borrado que quedó apuntando a la pestaña inexistente vuelve a la cola hacia la pestaña real', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  const lopez = exigirFila(CLIENTES.lopez.nombre)
  darDeBaja(lopez.filaId, { motivo: 'VENDIO', nota: '' }, MILAGROS)
  await subirTodo(lanus1)
  const idDeLaBaja = `BAJA:${lopez.filaId}`

  // Lo que dejaba la 12.1 al deshacer: el registro local borrado y el borrado del renglón encolado
  // contra «(cargado en DM Gestión)», dado por perdido. Y una entrada suelta sin renglón conocido.
  lanus1.db.prepare('DELETE FROM bajas WHERE fila_id = ?').run(idDeLaBaja)
  lanus1.db
    .prepare(`INSERT INTO cola_sync (creado_en, operacion, pestana, fila_id, campos_json, estado, intentos, ultimo_error) VALUES (?, 'borrar', ?, ?, '{}', 'fallido', 8, 'no existe')`)
    .run(ahoraIso(), PESTANA_APP, idDeLaBaja)
  lanus1.db
    .prepare(`INSERT INTO cola_sync (creado_en, operacion, pestana, fila_id, campos_json, estado) VALUES (?, 'actualizar', ?, 'nunca-existio', '{}', 'pendiente')`)
    .run(ahoraIso(), PESTANA_APP)

  assert.equal(repararColaContraPestanaInexistente(), 1)
  const cola = lanus1.db
    .prepare(`SELECT pestana, estado, fila_id FROM cola_sync WHERE fila_id IN (?, 'nunca-existio') AND estado <> 'listo'`)
    .all(idDeLaBaja) as Array<{ pestana: string; estado: string; fila_id: string }>
  assert.deepEqual(cola, [{ pestana: 'BAJAS AGOSTO', estado: 'pendiente', fila_id: idDeLaBaja }], 'la entrada sin renglón se sacó; la otra apunta a BAJAS AGOSTO')
  await subirTodo(lanus1)
  assert.equal(renglonesCon(hoja, 'BAJAS AGOSTO', idDeLaBaja), 0, 'y el renglón por fin salió de la base')

  en(lanus2)
  await lanus2.motor.ciclarBajada()
  assert.equal(bajasDelMes('2026-08').some((b) => b.clienteNombre === CLIENTES.lopez.nombre), false, 'la otra computadora deja de mostrar la baja')
  cerrarTodo()
})

test('si el agregado se aplicó pero la respuesta se perdió, el reintento no deja dos renglones', async () => {
  const { hoja, lanus1 } = await dosComputadoras()
  en(lanus1)
  const lopez = exigirFila(CLIENTES.lopez.nombre)
  darDeBaja(lopez.filaId, { motivo: 'VENDIO', nota: '' }, MILAGROS)

  // El servidor agrega la fila y la conexión se corta antes de contestar: para la aplicación el
  // pedido falló y queda para reintentar.
  const agregarDeVerdad = hoja.agregarFilas.bind(hoja)
  hoja.agregarFilas = async (titulo, filas) => {
    await agregarDeVerdad(titulo, filas)
    hoja.agregarFilas = agregarDeVerdad
    throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
  }
  apurarAgrupadas()
  await lanus1.motor.ciclarSubida()
  assert.equal(renglonesCon(hoja, 'BAJAS AGOSTO', `BAJA:${lopez.filaId}`), 1, 'la fila quedó en la hoja aunque la respuesta no llegó')
  assert.ok(cuantasPendientes() > 0, 'y la entrada espera su reintento')

  lanus1.db.prepare(`UPDATE cola_sync SET proximo_intento = NULL WHERE estado = 'pendiente'`).run()
  await subirTodo(lanus1)
  assert.equal(renglonesCon(hoja, 'BAJAS AGOSTO', `BAJA:${lopez.filaId}`), 1, 'el reintento escribe sobre la fila que ya estaba, no agrega otra')
  cerrarTodo()
})

test('una baja que la base tiene repetida se queda con una sola, acá y en la base', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  const suarez = exigirFila(CLIENTES.suarez.nombre)
  darDeBaja(suarez.filaId, { motivo: 'VENDIO', nota: '' }, MILAGROS)
  await subirTodo(lanus1)

  // Lo que dejaban las versiones anteriores: el mismo renglón dos veces en BAJAS, con el mismo _ID.
  const columnaId = hoja.columnaIdDe('BAJAS AGOSTO')
  const renglon = hoja.filasDe('BAJAS AGOSTO').find((f) => (f[columnaId] ?? '').trim() === `BAJA:${suarez.filaId}`)!
  hoja.agregarFila('BAJAS AGOSTO', [...renglon])

  en(lanus2)
  await lanus2.motor.ciclarBajada()
  const deSuarez = () => bajasDelMes('2026-08').filter((b) => b.clienteNombre === CLIENTES.suarez.nombre)
  assert.equal(deSuarez().length, 2, 'la importación le inventa un _ID al segundo renglón: es la baja duplicada que veía la agencia')

  assert.equal(repararBajasDuplicadas(), 1)
  assert.equal(deSuarez().length, 1, 'queda una sola')
  assert.equal(deSuarez()[0]!.filaId, `BAJA:${suarez.filaId}`, 'y es la que hizo la aplicación')
  await subirTodo(lanus2)
  assert.equal(hoja.filasDe('BAJAS AGOSTO').filter((f) => f.some((c) => (c ?? '').includes(CLIENTES.suarez.nombre))).length, 1, 'el renglón de más se borró de la base')
  assert.equal(repararBajasDuplicadas(), 0, 'la segunda pasada no tiene nada que hacer')
  cerrarTodo()
})

test('una cuota que la base tiene repetida se queda con una sola: la planilla deja de salir duplicada', async () => {
  const { hoja, lanus1 } = await dosComputadoras()
  en(lanus1)
  const suarez = exigirFila(CLIENTES.suarez.nombre)
  const deSuarez = () => planillaDelMes('2026-08').filas.filter((f) => f.nombre === CLIENTES.suarez.nombre)

  // La misma póliza dos veces en el mismo mes. Es lo que queda cuando en la hoja hay dos pestañas del
  // mismo mes o cuando alguien copia y pega renglones: la importación le da un _ID nuevo al segundo
  // —son renglones distintos, tiene que dárselo— y la planilla del mes muestra la fila repetida.
  duplicarCuota(lanus1, suarez.filaId, 'zzzcopiaagosto')
  assert.equal(deSuarez().length, 2, 'así se veía la planilla: cada fila dos veces')

  assert.equal(repararCuotasDuplicadas(), 1)
  assert.equal(deSuarez().length, 1, 'queda una sola')
  assert.equal(deSuarez()[0]!.filaId, suarez.filaId, 'y es la que ya estaba, no la que inventó la copia')
  assert.equal(repararCuotasDuplicadas(), 0, 'la segunda pasada no tiene nada que hacer')
  assert.ok(hoja.titulos().length > 0)
  cerrarTodo()
})

test('de dos cuotas repetidas queda la que tiene el cobro: no se pierde plata cobrada', async () => {
  const { lanus1 } = await dosComputadoras()
  en(lanus1)
  const gonzalez = exigirFila(CLIENTES.gonzalez.nombre)
  const deGonzalez = () => planillaDelMes('2026-08').filas.filter((f) => f.nombre === CLIENTES.gonzalez.nombre)

  duplicarCuota(lanus1, gonzalez.filaId, 'copiacobrada1')
  const copia = deGonzalez().find((f) => f.filaId !== gonzalez.filaId)!
  // El cobro entró sobre la copia, que es lo que pasa cuando quien atiende ve las dos filas y toca
  // cualquiera. La que tiene plata colgando es la que se queda, aunque sea la copia: de la otra no
  // cuelga nada y sacarla no pierde nada.
  registrarPago(copia.filaId, { fecha: '2026-08-10', importe: '$ 1.000', medioDePago: 'EFECTIVO' }, MILAGROS)

  assert.equal(repararCuotasDuplicadas(), 1)
  const quedaron = deGonzalez()
  assert.equal(quedaron.length, 1, 'queda una sola')
  assert.equal(quedaron[0]!.filaId, copia.filaId, 'y es la del cobro')
  assert.ok(
    cajaDelDia('2026-08-10', []).pagos.some((p) => p.clienteNombre === CLIENTES.gonzalez.nombre),
    'el pago sigue en la caja del día',
  )
  cerrarTodo()
})

test('de dos cuotas repetidas sin nada colgando queda la de más arriba en la hoja', async () => {
  const { lanus1 } = await dosComputadoras()
  en(lanus1)
  const perez = exigirFila(CLIENTES.perezAuto.nombre)
  const dePerez = () => planillaDelMes('2026-08').filas.filter((f) => f.filaId === perez.filaId || f.filaId === 'aaacopiaperez')

  // El _ID de la copia se elige a propósito más chico que el original: lo que decide no puede ser el
  // orden alfabético del _ID, sino cuál de los dos renglones está antes en la hoja.
  duplicarCuota(lanus1, perez.filaId, 'aaacopiaperez')
  assert.equal(dePerez().length, 2)

  assert.equal(repararCuotasDuplicadas(), 1)
  assert.equal(dePerez()[0]!.filaId, perez.filaId, 'queda el renglón original, no el pegado debajo')
  cerrarTodo()
})

// ---------------------------------------------------------------------------
// Pagos
// ---------------------------------------------------------------------------

test('el pago que cobra una computadora aparece en la caja del día de la otra, con quién lo cobró', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  const pestana = hojaDeImputados()
  assert.equal(pestana.pestana, PESTANA_PAGOS_APP, 'sin una IMPUTADOS por fila, los pagos viajan por APP PAGOS')
  assert.equal(pestana.esDeLaApp, true)
  assert.equal(pestana.aviso, null)

  const gonzalez = exigirFila(CLIENTES.gonzalez.nombre)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-12', importe: '$ 24.420', medioDePago: 'EFECTIVO' }, MILAGROS)
  await subirTodo(lanus1)
  assert.ok(hoja.titulos().includes(PESTANA_PAGOS_APP), 'la pestaña se creó sola al final de la base')
  const idDelPago = `PAGO:${gonzalez.filaId}`
  assert.equal(renglonesCon(hoja, PESTANA_PAGOS_APP, idDelPago), 1)
  assert.equal(celda(hoja, PESTANA_PAGOS_APP, idDelPago, 'COBRADO POR'), 'Milagros')
  assert.equal(celda(hoja, PESTANA_PAGOS_APP, idDelPago, 'LOCAL'), 'Lanús')
  assert.equal(celda(hoja, PESTANA_PAGOS_APP, idDelPago, 'IMPORTE'), '$ 24.420')

  en(lanus2)
  await lanus2.motor.ciclarBajada()
  const caja = cajaDelDia('2026-08-12', ['Lanús'])
  const pago = caja.pagos.find((p) => p.clienteNombre === CLIENTES.gonzalez.nombre)
  assert.ok(pago, 'el pago está en la caja de la otra computadora')
  assert.equal(pago.usuarioNombre, 'Milagros', 'con quién lo cobró')
  assert.equal(pago.sucursal, 'Lanús')
  assert.equal(pago.importeMonto, 24420)
  assert.equal(caja.total, 24420)
  assert.equal(imputados('2026-08', []).pagos.some((p) => p.clienteNombre === CLIENTES.gonzalez.nombre), true, 'y en la rendición del mes')

  // El pago cobrado en la otra computadora no se vuelve a subir desde ésta.
  assert.equal(cuantasPendientes(), 0)
  cerrarTodo()
})

test('los pagos que habían quedado sólo en una computadora se encolan solos al arrancar', async () => {
  const { lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  // Un pago de la 12.1: cobrado en la aplicación, sin pestaña donde escribirlo, con la pestaña de lo
  // que nunca viajó.
  lanus1.db
    .prepare(
      `INSERT INTO pagos (fila_id, pestana, fecha, fecha_iso, cliente_nombre, documento, compania, numero_poliza, importe, importe_monto, medio,
                          periodo, usuario_id, usuario_nombre, sucursal_cobro, hecho_en_la_app, creado_en, actualizado_en)
       VALUES ('abc123def456', ?, '13/08/2026', '2026-08-13', 'CLIENTE DE ANTES', '11222333', 'SANCOR', '5050', '$ 9.000', 9000, 'EFECTIVO',
               '2026-08', ?, 'Daiana', 'Lanús', 1, '2026-08-13T14:00:00.000Z', '2026-08-13T14:00:00.000Z')`,
    )
    .run(PESTANA_APP, DAIANA.id)
  assert.equal(subirPagosRezagados(), 1)
  assert.equal(subirPagosRezagados(), 0, 'la segunda vez no encola nada: ya está en camino')
  await subirTodo(lanus1)

  en(lanus2)
  await lanus2.motor.ciclarBajada()
  const pago = cajaDelDia('2026-08-13', ['Lanús']).pagos.find((p) => p.clienteNombre === 'CLIENTE DE ANTES')
  assert.ok(pago, 'el pago rezagado llegó a la otra computadora')
  assert.equal(pago.usuarioNombre, 'Daiana')
  cerrarTodo()
})

test('los administradores ven la caja y la rendición de todas las sucursales; un empleado, sólo la suya', async () => {
  const { lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  registrarPago(exigirFila(CLIENTES.gonzalez.nombre).filaId, { fecha: '2026-08-12', importe: '$ 24.420', medioDePago: 'EFECTIVO' }, MILAGROS)
  registrarPago(exigirFila(CLIENTES.perezAuto.nombre).filaId, { fecha: '2026-08-12', importe: '$ 10.000', medioDePago: 'EFECTIVO', sucursal: 'Dock Sud' }, FEDE)
  await subirTodo(lanus1)
  en(lanus2)
  await lanus2.motor.ciclarBajada()

  // Daiana (empleada de Lanús) desde la otra computadora: ve lo que cobró Milagros, no lo de Dock Sud.
  const deDaiana = cajaDelDia('2026-08-12', ['Dock Sud'], DAIANA)
  assert.deepEqual(deDaiana.sucursalesElegidas, ['Lanús'], 'pida lo que pida, mira su mostrador')
  assert.equal(deDaiana.sucursalFija, true)
  assert.deepEqual(deDaiana.sucursales, ['Lanús'])
  assert.deepEqual(
    deDaiana.pagos.map((p) => p.clienteNombre),
    [CLIENTES.gonzalez.nombre],
  )
  const deFede = cajaDelDia('2026-08-12', [], FEDE)
  assert.deepEqual(
    deFede.pagos.map((p) => p.clienteNombre),
    [CLIENTES.perezAuto.nombre],
  )

  // Daniel y Sofia (administradores) eligen la sucursal, o todas.
  for (const admin of [DANIEL, SOFIA]) {
    const todas = cajaDelDia('2026-08-12', [], admin)
    assert.equal(todas.sucursalFija, false)
    assert.equal(todas.pagos.length, 2, `${admin.nombre} ve las dos cajas juntas`)
    assert.equal(cajaDelDia('2026-08-12', ['Lanús'], admin).pagos.length, 1)
  }

  // Un mostrador que todavía no cobró nada ese día tiene que ver una caja VACÍA, no la de las demás.
  // Parece obvio y no lo es: desde que el filtro de sucursal es una lista, «ninguna elegida» quiere
  // decir «todas», así que un filtro obligado que se quedara sin valor mostraría de más en vez de de
  // menos. Éste tiene que fallar cerrado.
  const deSarandi = cajaDelDia('2026-08-12', ['Dock Sud'], { ...DAIANA, sucursal: { id: 4, nombre: 'Sarandí' } })
  assert.equal(deSarandi.sucursalFija, true)
  assert.deepEqual(deSarandi.sucursalesElegidas, ['Sarandí'], 'se filtra por el mostrador de quien pregunta')
  assert.deepEqual(deSarandi.pagos, [], 'Sarandí no cobró nada ese día: la caja está vacía, no llena de las otras')
  assert.equal(deSarandi.total, 0)

  // Imputados NO se recorta como la caja: la rendición del mes es una sola cuenta contra la compañía y
  // la ven entera los tres roles. La sucursal es un filtro de la pantalla, y quien lo pide de más se lo
  // pone; quien no lo pide, ve las cuatro.
  const rendicion = imputados('2026-08', [], [])
  assert.deepEqual(rendicion.sucursalesElegidas, [], 'sin filtro pedido, la rendición no se acota sola')
  assert.equal(rendicion.pagos.length, 2, 'la rendición trae los pagos de las dos sucursales')
  for (const deLaAgencia of ['Lanús', 'Dock Sud']) {
    assert.ok(rendicion.sucursales.includes(deLaAgencia), `«${deLaAgencia}» se puede elegir en el filtro`)
  }
  const soloLanus = imputados('2026-08', [], ['Lanús'])
  assert.deepEqual(soloLanus.sucursalesElegidas, ['Lanús'])
  assert.deepEqual(soloLanus.pagos.map((p) => p.clienteNombre), [CLIENTES.gonzalez.nombre])

  // Y se rinde cualquier pago, sea de la sucursal que sea: Daiana (empleada de Lanús) pone el resultado
  // de un pago que se cobró en Dock Sud. Antes esto reventaba con «otra sucursal».
  const deDockSud = rendicion.pagos.find((p) => p.clienteNombre === CLIENTES.perezAuto.nombre)!
  const rendido = cambiarResultado(deDockSud.id, 'OK', [], DAIANA)
  assert.equal(rendido.pagos.find((p) => p.id === deDockSud.id)?.resultado, 'OK')
  cerrarTodo()
})

test('las computadoras de esta prueba quedan cerradas', () => {
  cerrarTodo()
})

test('un cobro IMPUTADO viaja por la columna COBRO de APP PAGOS, y en la otra computadora la fila tampoco figura paga', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  const gonzalez = exigirFila(CLIENTES.gonzalez.nombre)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-12', importe: '$ 24.420', medioDePago: 'TRANSFERENCIA', estadoCobro: 'IMPUTADO' }, MILAGROS)
  await subirTodo(lanus1)
  const idDelPago = `PAGO:${gonzalez.filaId}`
  assert.equal(celda(hoja, PESTANA_PAGOS_APP, idDelPago, 'COBRO'), 'IMPUTADO')

  en(lanus2)
  await lanus2.motor.ciclarBajada()
  const alla = exigirFila(CLIENTES.gonzalez.nombre)
  assert.equal(alla.pagoImputado, true, 'la otra computadora sabe que está imputada')
  assert.equal(alla.pagoRegistrado, false, 'y que el cliente todavía no pagó')
  const caja = cajaDelDia('2026-08-12', ['Lanús'])
  assert.equal(caja.pagos.length, 1)
  assert.equal(caja.pagos[0]!.estadoCobro, 'IMPUTADO')
  assert.equal(caja.total, 0)

  // El cliente paga en la primera: la segunda se entera de que dejó de estar imputado y la fila queda paga.
  en(lanus1)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-14', importe: '$ 24.420', medioDePago: 'TRANSFERENCIA' }, MILAGROS)
  await subirTodo(lanus1)
  assert.equal(celda(hoja, PESTANA_PAGOS_APP, idDelPago, 'COBRO'), 'PAGO')

  en(lanus2)
  await lanus2.motor.ciclarBajada()
  const pagada = exigirFila(CLIENTES.gonzalez.nombre)
  assert.equal(pagada.pagoImputado, false)
  assert.equal(pagada.pagoRegistrado, true)
  assert.equal(cajaDelDia('2026-08-14', ['Lanús']).total, 24420)
  cerrarTodo()
})

test('la caja chica que carga un mostrador es la misma en la otra computadora del mostrador', async () => {
  const { hoja, lanus1, lanus2 } = await dosComputadoras()
  en(lanus1)
  // Milagros abre la caja, cobra en efectivo y anota un gasto del cajón.
  const gonzalez = exigirFila(CLIENTES.gonzalez.nombre)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-12', importe: '$ 24.420', medioDePago: 'EFECTIVO' }, MILAGROS)
  cargarMovimientoDeCaja({ fecha: '2026-08-12', sucursal: 'Lanús', tipo: 'APERTURA', detalle: '', importe: '20000' }, MILAGROS)
  cargarMovimientoDeCaja({ fecha: '2026-08-12', sucursal: 'Lanús', tipo: 'GASTO', detalle: 'limpieza', importe: '4600' }, MILAGROS)
  await subirTodo(lanus1)

  assert.ok(hoja.titulos().includes(PESTANA_CAJA_APP), 'la pestaña de la caja se creó sola al final de la base')
  const idDeLaApertura = filaIdDelMovimiento('2026-08-12', 'Lanús', 'APERTURA')
  assert.equal(renglonesCon(hoja, PESTANA_CAJA_APP, idDeLaApertura), 1)
  assert.equal(celda(hoja, PESTANA_CAJA_APP, idDeLaApertura, 'IMPORTE'), '20000')
  assert.equal(celda(hoja, PESTANA_CAJA_APP, idDeLaApertura, 'TIPO'), 'APERTURA')
  assert.equal(celda(hoja, PESTANA_CAJA_APP, idDeLaApertura, 'LOCAL'), 'Lanús')

  // Daiana, en la otra computadora del mismo mostrador, ve el mismo arqueo y lo cierra.
  en(lanus2)
  await lanus2.motor.ciclarBajada()
  const arqueo = cajaDelDia('2026-08-12', ['Lanús'], DAIANA).arqueo
  assert.ok(arqueo, 'la caja chica llegó a la otra computadora')
  assert.equal(arqueo.apertura, 20000)
  assert.equal(arqueo.gastos, 4600)
  assert.equal(arqueo.efectivo, 24420, 'lo cobrado sigue viajando por APP PAGOS')
  assert.equal(arqueo.esperado, 39820)
  assert.equal(arqueo.descuadre, 0)
  cargarMovimientoDeCaja({ fecha: '2026-08-12', sucursal: 'Lanús', tipo: 'CIERRE', detalle: '', importe: '39820' }, DAIANA)
  await subirTodo(lanus2)

  // Y el cierre vuelve a la primera, que además lo toma como la caja chica del día siguiente.
  en(lanus1)
  await lanus1.motor.ciclarBajada()
  const cerrada = cajaDelDia('2026-08-12', ['Lanús'], MILAGROS).arqueo
  assert.equal(cerrada?.contado, 39820)
  assert.equal(cerrada?.diferencia, 0)
  assert.equal(cerrada?.cerradoPor, 'Daiana')
  const siguiente = cajaDelDia('2026-08-13', ['Lanús'], MILAGROS).arqueo
  assert.equal(siguiente?.apertura, 39820)
  assert.equal(siguiente?.aperturaHeredadaDe, '2026-08-12')
  cerrarTodo()
})
