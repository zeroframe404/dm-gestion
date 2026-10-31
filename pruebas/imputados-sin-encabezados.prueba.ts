// IMPUTADOS sin encabezados (17.7.3): la fila 1 de la pestaña de pagos de la agencia quedó con sólo
// «_ID» y un «PAGO:…» metido. La importación tomaba igual la fila 1 como encabezados, pero la bajada
// buscaba el _ID por contenido y veía la pestaña «vacía» con todas sus filas «nuevas» en cada ciclo, y la
// subida daba cada pago por imposible («no tiene columna _ID») o lo agregaba sólo con su _ID. Acá se
// arma ese estado contra la hoja simulada y se verifica que la sincronización vuelve a andar sola.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { resolverCampo } from '../src/main/importacion/encabezados'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { planillaDelMes, registrarPago } from '../src/main/servicios/cartera'
import { reenviarPagosSinDatos } from '../src/main/servicios/pagos'
import { reintentarPagosTrabados } from '../src/main/servicios/reparaciones'
import { cuantasFallidas, cuantasPendientes } from '../src/main/sincronizacion/cola'
import { layoutDeLaFilaDelId } from '../src/main/sincronizacion/hoja'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import type { SesionUsuario } from '../src/shared/tipos'
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

const PAGO_METIDO = 'PAGO:div8iwqjw5z3'

let motorAnterior: MotorDeSincronizacion | null = null

interface Escenario {
  db: BaseDeDatos
  hoja: HojaSimulada
  importar: () => Promise<void>
  motor: () => MotorDeSincronizacion
}

/** La base importada con IMPUTADOS sana, como la conoció esta computadora antes del problema. */
async function escenario(): Promise<Escenario> {
  motorAnterior?.apagar()
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const importar = async () => {
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  }
  await importar()
  const motor = () => {
    motorAnterior?.apagar()
    const nuevo = new MotorDeSincronizacion({ crearFuente: () => hoja, importar })
    nuevo.encender()
    motorAnterior = nuevo
    return nuevo
  }
  return { db, hoja, importar, motor }
}

/** Deja la fila 1 de IMPUTADOS como quedó en la base de la agencia: «_ID» y un PAGO:… suelto. */
function romperEncabezados(hoja: HojaSimulada): number {
  const columnaId = hoja.columnaIdDe('IMPUTADOS')
  assert.ok(columnaId >= 0, 'la importación le escribió el _ID a IMPUTADOS')
  const encabezados = hoja.encabezadosDe('IMPUTADOS')
  encabezados.forEach((_, columna) => {
    if (columna !== columnaId) hoja.editarCelda('IMPUTADOS', 1, columna, '')
  })
  hoja.editarCelda('IMPUTADOS', 1, columnaId - 1, PAGO_METIDO)
  return columnaId
}

/** La fila de IMPUTADOS con ese _ID, buscándolo en la columna del _ID. */
function filaDe(hoja: HojaSimulada, columnaId: number, filaId: string): string[] | undefined {
  return hoja.filasDe('IMPUTADOS').find((fila) => (fila[columnaId] ?? '').trim() === filaId)
}

/** Columna de IMPUTADOS cuyo encabezado corresponde a ese campo de pagos, o -1. */
function columnaDelCampo(hoja: HojaSimulada, campo: string): number {
  return hoja.encabezadosDe('IMPUTADOS').findIndex((encabezado) => resolverCampo(encabezado, 'PAGOS') === campo)
}

test('una fila 1 con sólo «_ID» y _ID sueltos se toma como encabezados; una con datos, no', () => {
  const layout = layoutDeLaFilaDelId(['', '', PAGO_METIDO, '_ID'], 'PAGOS')
  assert.ok(layout, 'la fila 1 de IMPUTADOS tiene layout')
  assert.equal(layout.filaEncabezados, 0)
  assert.equal(layout.mapeo.columnaId, 3)
  assert.equal(layout.mapeo.porCampo.size, 0, 'el PAGO:… suelto no es el título de ningún campo')

  assert.equal(layoutDeLaFilaDelId(['09/08/2026', 'GONZALEZ JUAN', '$ 24.420', '_ID'], 'PAGOS'), undefined, 'un renglón de datos no se toma como encabezados')
  assert.equal(layoutDeLaFilaDelId(['', '', ''], 'PAGOS'), undefined, 'sin «_ID» no hay nada que tomar')
})

test('con la fila 1 de IMPUTADOS reducida a «_ID», el pago nuevo sube entero y la bajada deja de verla vacía', async () => {
  const { db, hoja, motor: crearMotor } = await escenario()
  const columnaId = romperEncabezados(hoja)
  const motor = crearMotor()

  const gonzalez = planillaDelMes(null).filas.find((f) => f.nombre === CLIENTES.gonzalez.nombre)
  assert.ok(gonzalez)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-12', importe: '$ 31.415', medioDePago: 'EFECTIVO' }, DANIEL)
  const pago = db.prepare(`SELECT fila_id, pestana FROM pagos WHERE importe = '$ 31.415'`).get() as { fila_id: string; pestana: string }
  assert.equal(pago.pestana, 'IMPUTADOS', 'esta computadora sigue mandando los pagos a IMPUTADOS, como en la agencia')

  await motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 0, 'el pago no queda «No se pudo»')
  assert.equal(cuantasPendientes(), 0)

  const fila = filaDe(hoja, columnaId, pago.fila_id)
  assert.ok(fila, 'el pago llegó a IMPUTADOS con su _ID')
  const columnaImporte = columnaDelCampo(hoja, 'importe')
  const columnaFecha = columnaDelCampo(hoja, 'fecha')
  assert.ok(columnaImporte > columnaId && columnaFecha > columnaId, 'las columnas que faltaban se titularon al final de la fila 1')
  assert.equal(fila[columnaImporte], '$ 31.415', 'el importe viajó con el pago')
  assert.ok((fila[columnaFecha] ?? '').trim() !== '', 'la fecha viajó con el pago')
  assert.equal(hoja.encabezadosDe('IMPUTADOS')[columnaId], '_ID', 'el _ID sigue en su columna')

  const bajada = await motor.ciclarBajada(true)
  assert.ok(bajada)
  assert.ok(!bajada.pestanasVaciasIgnoradas.includes('IMPUTADOS'), 'IMPUTADOS ya no «viene vacía»')
  const otra = await motor.ciclarBajada()
  assert.equal(otra?.filasNuevas ?? 0, 0, 'la bajada siguiente no vuelve a contar las filas de IMPUTADOS como nuevas')
  cerrarBaseDeDatos()
})

test('los pagos que llegaron a IMPUTADOS sólo con su _ID se completan con lo que sabe la computadora', async () => {
  const { db, hoja, importar, motor: crearMotor } = await escenario()
  const gonzalez = planillaDelMes(null).filas.find((f) => f.nombre === CLIENTES.gonzalez.nombre)
  assert.ok(gonzalez)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-12', importe: '$ 27.182', medioDePago: 'TRANSFERENCIA' }, DANIEL)
  const pago = db.prepare(`SELECT fila_id FROM pagos WHERE importe = '$ 27.182'`).get() as { fila_id: string }
  await crearMotor().ciclarSubida()
  assert.equal(cuantasPendientes(), 0)

  // Lo que pasó en la agencia: los títulos se perdieron y el renglón quedó con el _ID y nada más.
  const columnaId = romperEncabezados(hoja)
  const numero = hoja.filasDe('IMPUTADOS').findIndex((fila) => (fila[columnaId] ?? '').trim() === pago.fila_id) + 1
  assert.ok(numero > 1)
  hoja.filasDe('IMPUTADOS')[numero - 1]!.forEach((_, columna) => {
    if (columna !== columnaId) hoja.editarCelda('IMPUTADOS', numero, columna, '')
  })
  await importar()

  assert.equal(reenviarPagosSinDatos(), 1, 'se reenvía el pago cobrado acá que está en la base sin datos')
  assert.equal(reenviarPagosSinDatos(), 0, 'no se encola dos veces mientras espera subir')
  await crearMotor().ciclarSubida()
  assert.equal(cuantasFallidas(), 0)

  const fila = filaDe(hoja, columnaId, pago.fila_id)
  assert.ok(fila)
  assert.equal(fila[columnaDelCampo(hoja, 'importe')], '$ 27.182', 'el importe volvió a la base')
  cerrarBaseDeDatos()
})

test('lo que quedó «No se pudo» contra IMPUTADOS vuelve a la cola una sola vez', async () => {
  const { db } = await escenario()
  const pago = db.prepare(`SELECT fila_id FROM pagos WHERE pestana = 'IMPUTADOS' LIMIT 1`).get() as { fila_id: string }
  db.prepare(
    `INSERT INTO cola_sync (operacion, pestana, fila_id, campos_json, estado, intentos, ultimo_error, creado_en)
     VALUES ('actualizar', 'IMPUTADOS', ?, '{"resultado":"OK"}', 'fallido', 8, '«IMPUTADOS» no tiene columna _ID: reimportá la base', ?)`,
  ).run(pago.fila_id, ahoraIso())
  db.prepare(
    `INSERT INTO cola_sync (operacion, pestana, fila_id, campos_json, estado, intentos, ultimo_error, creado_en)
     VALUES ('actualizar', 'AGOSTO', 'otrafila0001', '{"telefono":"1"}', 'fallido', 8, 'otro motivo', ?)`,
  ).run(ahoraIso())

  assert.equal(reintentarPagosTrabados(), 1, 'sólo vuelve la de la pestaña de pagos')
  assert.equal((db.prepare(`SELECT estado FROM cola_sync WHERE pestana = 'IMPUTADOS'`).get() as { estado: string }).estado, 'pendiente')
  assert.equal((db.prepare(`SELECT estado FROM cola_sync WHERE pestana = 'AGOSTO'`).get() as { estado: string }).estado, 'fallido')

  db.prepare(`UPDATE cola_sync SET estado = 'fallido' WHERE pestana = 'IMPUTADOS'`).run()
  assert.equal(reintentarPagosTrabados(), 0, 'corre una sola vez')
  cerrarBaseDeDatos()
})

test('un pago que quedó en la base sólo con su _ID no se borra de la computadora que lo cobró', async () => {
  const { db, hoja, importar, motor: crearMotor } = await escenario()
  const gonzalez = planillaDelMes(null).filas.find((f) => f.nombre === CLIENTES.gonzalez.nombre)
  assert.ok(gonzalez)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-12', importe: '$ 16.180', medioDePago: 'EFECTIVO' }, DANIEL)
  const pago = db.prepare(`SELECT fila_id FROM pagos WHERE importe = '$ 16.180'`).get() as { fila_id: string }
  await crearMotor().ciclarSubida()

  const columnaId = romperEncabezados(hoja)
  const numero = hoja.filasDe('IMPUTADOS').findIndex((fila) => (fila[columnaId] ?? '').trim() === pago.fila_id) + 1
  hoja.filasDe('IMPUTADOS')[numero - 1]!.forEach((_, columna) => {
    if (columna !== columnaId) hoja.editarCelda('IMPUTADOS', numero, columna, '')
  })

  const existe = () => db.prepare('SELECT COUNT(*) AS n FROM pagos WHERE fila_id = ?').get(pago.fila_id) as { n: number }
  await crearMotor().ciclarBajada(true)
  assert.equal(existe().n, 1, 'la bajada no lo da por borrado')
  await importar()
  assert.equal(existe().n, 1, 'la importación tampoco')
  const cruda = db.prepare('SELECT en_la_hoja, datos_json FROM filas_crudas WHERE fila_id = ?').get(pago.fila_id) as { en_la_hoja: number; datos_json: string }
  assert.equal(cruda.en_la_hoja, 1, 'sigue figurando en la base')
  assert.equal(cruda.datos_json, '{}', 'anotado como renglón vacío, para que la reparación lo complete')
  cerrarBaseDeDatos()
})
