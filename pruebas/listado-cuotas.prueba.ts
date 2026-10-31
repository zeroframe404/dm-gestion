// Listado de Vencimientos de Cuotas: sale de la planilla mensual y respeta las reglas de pagada / vencida / anulada.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { planillaDelMes, registrarPago } from '../src/main/servicios/cartera'
import { estadoDeLaCuota, listarVencimientosDeCuotas } from '../src/main/servicios/listadoCuotas'
import { FILTROS_DE_CUOTAS_VACIOS, type FiltrosDeCuotas } from '../src/shared/listados/cuotas'
import type { SesionUsuario } from '../src/shared/tipos'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { importar } from './ayuda'

const HOY = '2026-08-20'
const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}
const AGOSTO: FiltrosDeCuotas = { ...FILTROS_DE_CUOTAS_VACIOS, desde: '2026-08-01', hasta: '2026-08-31' }

async function base(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(construirHojaDePrueba()))
  return db
}

test('el estado de la cuota: pagada manda, después adelantada, anulada, imputada y la fecha', () => {
  const base = { pagada: false, adelantada: false, anulada: false, imputada: false, vencimiento: '2026-08-10', hoy: HOY }
  assert.equal(estadoDeLaCuota({ ...base, pagada: true, anulada: true }), 'Pagada')
  assert.equal(estadoDeLaCuota({ ...base, adelantada: true }), 'Adelantada')
  assert.equal(estadoDeLaCuota({ ...base, anulada: true, imputada: true }), 'Anulada')
  assert.equal(estadoDeLaCuota({ ...base, imputada: true }), 'Imputada')
  assert.equal(estadoDeLaCuota({ ...base, renovada: true, imputada: true }), 'Renovada')
  assert.equal(estadoDeLaCuota({ ...base, sinMora: true }), 'Sin mora')
  assert.equal(estadoDeLaCuota({ ...base, sinMora: true, vencimiento: HOY }), 'Pendiente')
  assert.equal(estadoDeLaCuota(base), 'Vencida')
  assert.equal(estadoDeLaCuota({ ...base, vencimiento: HOY }), 'Pendiente')
  assert.equal(estadoDeLaCuota({ ...base, vencimiento: '2026-08-25' }), 'Pendiente')
})

test('sin rango válido no devuelve nada', async () => {
  await base()
  assert.deepEqual(listarVencimientosDeCuotas(FILTROS_DE_CUOTAS_VACIOS, HOY), [])
  assert.deepEqual(listarVencimientosDeCuotas({ ...AGOSTO, desde: '2026-09-01' }, HOY), [])
})

test('una fila por cuota del rango, ordenada por vencimiento, y las vencidas sin pago salen como Vencida', async () => {
  await base()
  const todas = listarVencimientosDeCuotas(AGOSTO, HOY)
  assert.ok(todas.length > 0)
  for (const f of todas) assert.ok(f.vencimiento >= AGOSTO.desde && f.vencimiento <= AGOSTO.hasta)
  assert.deepEqual(
    todas.map((f) => f.vencimiento),
    todas.map((f) => f.vencimiento).sort(),
  )
  for (const f of todas) if (f.estado === 'Vencida') assert.ok(f.vencimiento < HOY)
  assert.equal(new Set(todas.map((f) => f.id)).size, todas.length)
})

test('un pago registrado deja la cuota Pagada y «excluir pagadas» la saca', async () => {
  await base()
  // Una cuota que hoy figura sin pago (ni fecha, ni pago registrado, ni adelanto).
  const fila = planillaDelMes(null).filas.find((f) => !f.pagoFecha && !f.pagoRegistrado && !f.pagoAdelantado && !f.pagoImputado && f.diaVencimientoNumero !== null)
  assert.ok(fila)
  const antes = listarVencimientosDeCuotas(AGOSTO, HOY)
  const propia = antes.find((f) => f.id === fila.filaId)
  assert.ok(propia)
  assert.notEqual(propia.estado, 'Pagada')

  registrarPago(fila.filaId, { fecha: '2026-08-19', importe: '$ 10.000', medioDePago: 'EFECTIVO' }, DANIEL)
  const despues = listarVencimientosDeCuotas(AGOSTO, HOY)
  assert.equal(despues.find((f) => f.id === fila.filaId)?.estado, 'Pagada')
  assert.equal(listarVencimientosDeCuotas({ ...AGOSTO, excluirPagadas: true }, HOY).some((f) => f.id === fila.filaId), false)
})

test('«solo vencidas» deja las vencidas y es compatible con «excluir pagadas»', async () => {
  await base()
  const vencidas = listarVencimientosDeCuotas({ ...AGOSTO, soloVencidas: true }, HOY)
  assert.ok(vencidas.every((f) => f.estado === 'Vencida'))
  const juntas = listarVencimientosDeCuotas({ ...AGOSTO, soloVencidas: true, excluirPagadas: true }, HOY)
  assert.deepEqual(juntas, vencidas)
})

test('las cuotas dadas de baja de la planilla no se listan salvo que se pidan las anuladas', async () => {
  const db = await base()
  const fila = planillaDelMes(null).filas[0]!
  db.prepare('UPDATE cuotas_mes SET dada_de_baja = 1 WHERE fila_id = ?').run(fila.filaId)
  assert.equal(listarVencimientosDeCuotas(AGOSTO, HOY).some((f) => f.id === fila.filaId), false)
  const con = listarVencimientosDeCuotas({ ...AGOSTO, incluirAnuladas: true }, HOY)
  assert.ok(con.some((f) => f.id === fila.filaId))
})

test('los filtros de compañía, cliente y riesgo acotan, y soloOpciones devuelve las combinaciones', async () => {
  await base()
  const todas = listarVencimientosDeCuotas(AGOSTO, HOY)
  const compania = todas.find((f) => f.compania)?.compania
  assert.ok(compania)
  const deLaCompania = listarVencimientosDeCuotas({ ...AGOSTO, companias: [compania] }, HOY)
  assert.ok(deLaCompania.length > 0 && deLaCompania.every((f) => f.compania === compania))
  const cliente = todas[0]!.cliente
  const porCliente = listarVencimientosDeCuotas({ ...AGOSTO, cliente: cliente.toLowerCase().slice(0, 4) }, HOY)
  assert.ok(porCliente.some((f) => f.cliente === cliente))
  assert.deepEqual(listarVencimientosDeCuotas({ ...AGOSTO, riesgo: 'zzzz-no-existe' }, HOY), [])

  const opciones = listarVencimientosDeCuotas({ ...FILTROS_DE_CUOTAS_VACIOS, soloOpciones: true }, HOY)
  assert.ok(opciones.some((o) => o.compania === compania))
})
