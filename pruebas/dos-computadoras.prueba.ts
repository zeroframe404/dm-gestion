// Dos computadoras contra la misma base de la agencia: es el caso real de Lanús (dos mostradores, dos
// PC) y el origen de los dos problemas que cierra la 12.2. Una baja hecha en una tiene que salir de
// la planilla de la otra —y no poder repetirse, que era lo que duplicaba BAJAS—, y un pago cobrado en
// una tiene que aparecer en la caja del día de la otra.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, usarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { bajasDelMes, darDeBaja, deshacerBaja, planillaDelMes, registrarPago } from '../src/main/servicios/cartera'
import { cajaDelDia, cambiarResultado, imputados } from '../src/main/servicios/cobranzas'
import { PESTANA_APP } from '../src/main/servicios/filas'
import { hojaDeImputados, subirPagosRezagados } from '../src/main/servicios/pagos'
import { repararBajasDuplicadas, repararColaContraPestanaInexistente } from '../src/main/servicios/reparaciones'
import { apurarAgrupadas, cuantasFallidas, cuantasPendientes } from '../src/main/sincronizacion/cola'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { PESTANA_PAGOS_APP } from '../src/main/sincronizacion/pestanasApp'
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
  const caja = cajaDelDia('2026-08-12', 'Lanús')
  const pago = caja.pagos.find((p) => p.clienteNombre === CLIENTES.gonzalez.nombre)
  assert.ok(pago, 'el pago está en la caja de la otra computadora')
  assert.equal(pago.usuarioNombre, 'Milagros', 'con quién lo cobró')
  assert.equal(pago.sucursal, 'Lanús')
  assert.equal(pago.importeMonto, 24420)
  assert.equal(caja.total, 24420)
  assert.equal(imputados('2026-08', '').pagos.some((p) => p.clienteNombre === CLIENTES.gonzalez.nombre), true, 'y en la rendición del mes')

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
  const pago = cajaDelDia('2026-08-13', 'Lanús').pagos.find((p) => p.clienteNombre === 'CLIENTE DE ANTES')
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
  const deDaiana = cajaDelDia('2026-08-12', 'Dock Sud', DAIANA)
  assert.equal(deDaiana.sucursal, 'Lanús', 'pida lo que pida, mira su mostrador')
  assert.equal(deDaiana.sucursalFija, true)
  assert.deepEqual(deDaiana.sucursales, ['Lanús'])
  assert.deepEqual(
    deDaiana.pagos.map((p) => p.clienteNombre),
    [CLIENTES.gonzalez.nombre],
  )
  const deFede = cajaDelDia('2026-08-12', '', FEDE)
  assert.deepEqual(
    deFede.pagos.map((p) => p.clienteNombre),
    [CLIENTES.perezAuto.nombre],
  )

  // Daniel y Sofia (administradores) eligen la sucursal, o todas.
  for (const admin of [DANIEL, SOFIA]) {
    const todas = cajaDelDia('2026-08-12', '', admin)
    assert.equal(todas.sucursalFija, false)
    assert.equal(todas.pagos.length, 2, `${admin.nombre} ve las dos cajas juntas`)
    assert.equal(cajaDelDia('2026-08-12', 'Lanús', admin).pagos.length, 1)
  }

  // Lo mismo en Imputados: la empleada rinde lo de su mostrador y no puede tocar lo de otro.
  const rendicion = imputados('2026-08', '', DAIANA)
  assert.equal(rendicion.sucursal, 'Lanús')
  assert.deepEqual(rendicion.pagos.map((p) => p.clienteNombre), [CLIENTES.gonzalez.nombre])
  assert.equal(imputados('2026-08', '', SOFIA).pagos.length, 2)
  assert.equal(imputados('2026-08', '', SOFIA).sucursal, '')
  const deDockSud = imputados('2026-08', '', SOFIA).pagos.find((p) => p.clienteNombre === CLIENTES.perezAuto.nombre)!
  assert.throws(() => cambiarResultado(deDockSud.id, 'OK', '', DAIANA), /otra sucursal/)
  assert.equal(cambiarResultado(deDockSud.id, 'OK', '', SOFIA).pagos.find((p) => p.id === deDockSud.id)?.resultado, 'OK')
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
  const caja = cajaDelDia('2026-08-12', 'Lanús')
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
  assert.equal(cajaDelDia('2026-08-14', 'Lanús').total, 24420)
  cerrarTodo()
})
