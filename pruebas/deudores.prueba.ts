// El buscador de deudores de Clientes contra la hoja simulada: que los filtros acoten lo que tienen
// que acotar, que los días se puedan tildar salteados —que es para lo que existe la pantalla— y que
// lo exportado tenga adentro lo mismo que se ve.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { archivoDeDeudores, buscarDeudores } from '../src/main/servicios/deudores'
import { DEUDORES_SIN_FILTROS, type FiltrosDeudores } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { importar, leerZip } from './ayuda'

/** El mes abierto de la hoja de prueba y un día fijo adentro: las pruebas no pueden depender de hoy. */
const AGOSTO = '2026-08'
const HOY = '2026-08-20'

/** Los filtros como los manda el diálogo apenas se abre: el mes abierto y nada más tildado. */
const DEL_MES: FiltrosDeudores = { ...DEUDORES_SIN_FILTROS, periodo: AGOSTO }

/**
 * Cartera de prueba con las DOS importaciones, igual que en clientes.prueba.ts: así Fernández queda
 * dado de baja de verdad y sus cuotas no tienen que aparecer entre las deudas.
 */
async function carteraDePrueba(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  const hoja = new HojaSimulada(construirHojaDePrueba())
  const agosto = hoja.quitarPestana('AGOSTO')
  const bajasAgosto = hoja.quitarPestana('BAJAS AGOSTO')
  await importar(db, hoja)
  hoja.restaurarPestana(agosto)
  hoja.restaurarPestana(bajasAgosto)
  await importar(db, hoja)
  return db
}

/** Los apellidos que trae el listado, para poder afirmar quién está y quién no. */
function nombres(filtros: FiltrosDeudores): string[] {
  return buscarDeudores(filtros, HOY)
    .filas.map((fila) => fila.nombre ?? '')
    .sort()
}

function tiene(filtros: FiltrosDeudores, cliente: { nombre: string }): boolean {
  return nombres(filtros).some((nombre) => nombre === cliente.nombre)
}

// ---------------------------------------------------------------------------
// Qué es una deuda
// ---------------------------------------------------------------------------

test('por omisión trae las cuotas impagas del mes abierto y deja afuera las que se cobran solas', async () => {
  await carteraDePrueba()
  const listado = buscarDeudores(DEL_MES, HOY)

  // En AGOSTO no pagaron tres: Rodríguez (cuponera), Suárez (transferencia) y Martínez, que es
  // DÉBITO —el débito que no entró— y por eso no cuenta como deuda mientras no se lo pida.
  assert.equal(listado.filas.length, 2, `esperaba 2 deudas, hubo ${listado.filas.length}: ${nombres(DEL_MES).join(' · ')}`)
  assert.ok(tiene(DEL_MES, CLIENTES.rodriguez), 'Rodríguez paga por cuponera y no pagó')
  assert.ok(tiene(DEL_MES, CLIENTES.suarez), 'Suárez paga por transferencia y no pagó')
  assert.ok(!tiene(DEL_MES, CLIENTES.martinez), 'a un débito automático no se lo persigue')
  assert.ok(!tiene(DEL_MES, CLIENTES.gonzalez), 'González pagó: no debe nada')

  assert.equal(listado.clientes, 2, 'son dos personas distintas')
  assert.equal(
    listado.total,
    listado.filas.reduce((suma, fila) => suma + (fila.cuotaMonto ?? 0), 0),
    'el total es la suma de las cuotas con importe',
  )
  assert.equal(listado.periodo, AGOSTO)
  assert.equal(listado.sinDia, 0, 'en agosto todas las filas tienen día de vencimiento')
  assert.ok(listado.filas.every((fila) => fila.vencida && fila.diasDeAtraso !== null && fila.diasDeAtraso > 0), 'al 20 ya vencieron las dos')
})

test('tildar una forma de pago manda sobre la exclusión del débito', async () => {
  await carteraDePrueba()
  // Es justamente lo que hace falta para revisar las tarjetas o los débitos que no entraron.
  const soloDebito: FiltrosDeudores = { ...DEL_MES, formasDePago: ['DEBITO'] }
  assert.equal(nombres(soloDebito).length, 1)
  assert.ok(tiene(soloDebito, CLIENTES.martinez), 'pedido explícitamente, el débito impago aparece')

  const soloCuponera: FiltrosDeudores = { ...DEL_MES, formasDePago: ['CUPONERA'] }
  assert.deepEqual(nombres(soloCuponera), [CLIENTES.rodriguez.nombre])

  // Y se pueden tildar varias a la vez: es un listado para repartir, no un filtro de a uno.
  const dos: FiltrosDeudores = { ...DEL_MES, formasDePago: ['CUPONERA', 'TRANSFERENCIA'] }
  assert.equal(nombres(dos).length, 2)

  // El «incluir las que se cobran solas» hace lo mismo sin tildar ninguna forma de pago.
  assert.equal(buscarDeudores({ ...DEL_MES, incluirDebito: true }, HOY).filas.length, 3)
})

test('las listas para tildar traen todo lo que hay, incluso lo que por omisión no se muestra', async () => {
  await carteraDePrueba()
  const listado = buscarDeudores(DEL_MES, HOY)

  // Si las listas se armaran después de filtrar, DEBITO no aparecería nunca y no habría forma de
  // pedir justamente los débitos que no entraron.
  assert.ok(listado.formasDePago.includes('DEBITO'), 'la forma de pago que queda afuera por omisión igual se puede tildar')
  assert.ok(listado.formasDePago.includes('CUPONERA') && listado.formasDePago.includes('TRANSFERENCIA'))
  assert.ok(listado.sucursales.includes(CLIENTES.martinez.sucursal), 'la sucursal del débito impago también')
  assert.ok(listado.companias.includes(CLIENTES.suarez.cia))
  assert.ok(
    listado.periodos.some((periodo) => periodo.periodo === AGOSTO && periodo.esElActual),
    'el desplegable de meses trae el mes abierto marcado',
  )
})

// ---------------------------------------------------------------------------
// Los días tildados, que es para lo que existe la pantalla
// ---------------------------------------------------------------------------

test('los días del mes se tildan de a uno y en desorden', async () => {
  await carteraDePrueba()
  // En AGOSTO vencen el 15 (Suárez) y el 10 (todos los demás).
  assert.deepEqual(nombres({ ...DEL_MES, dias: [10] }), [CLIENTES.rodriguez.nombre])
  assert.deepEqual(nombres({ ...DEL_MES, dias: [15] }), [CLIENTES.suarez.nombre])
  assert.equal(nombres({ ...DEL_MES, dias: [15, 10] }).length, 2, 'salteados y en cualquier orden')
  assert.equal(nombres({ ...DEL_MES, dias: [1, 3, 5] }).length, 0, 'esos días no vence nadie')

  // El contador por día es lo que deja tildar sabiendo dónde hay algo, y se calcula ANTES de aplicar
  // el filtro de días: si no, al tildar un día los demás quedarían en cero.
  const listado = buscarDeudores({ ...DEL_MES, dias: [10] }, HOY)
  assert.equal(listado.porDia[10], 1)
  assert.equal(listado.porDia[15], 1, 'el 15 sigue mostrando el suyo aunque esté tildado sólo el 10')
  assert.equal(listado.porDia[1], 0)
  assert.equal(buscarDeudores({ ...DEL_MES, incluirDebito: true }, HOY).porDia[10], 2, 'con el débito incluido son dos el día 10')

  // Un día que no existe o un texto no rompen nada: el proceso principal no confía en la pantalla.
  const raro = { ...DEL_MES, dias: [0, 32, 10, 'diez' as unknown as number] }
  assert.deepEqual(nombres(raro), [CLIENTES.rodriguez.nombre])
})

test('sucursal, compañía, forma de pago y días se combinan', async () => {
  await carteraDePrueba()
  assert.deepEqual(nombres({ ...DEL_MES, sucursales: [CLIENTES.suarez.sucursal] }), [CLIENTES.suarez.nombre])
  assert.deepEqual(nombres({ ...DEL_MES, companias: [CLIENTES.suarez.cia] }), [CLIENTES.suarez.nombre])

  const todo: FiltrosDeudores = {
    ...DEL_MES,
    sucursales: [CLIENTES.rodriguez.sucursal],
    companias: [CLIENTES.rodriguez.cia],
    formasDePago: ['CUPONERA'],
    dias: [1, 3, 10],
  }
  assert.deepEqual(nombres(todo), [CLIENTES.rodriguez.nombre], 'todos los filtros a la vez dejan a uno solo')

  // Combinaciones que no dan nada tienen que dar cero, no la lista entera.
  assert.equal(nombres({ ...DEL_MES, sucursales: [CLIENTES.suarez.sucursal], dias: [10] }).length, 0)

  // Se comparan sin tildes ni mayúsculas: en la hoja conviven «DOCK SUD» y «Dock Sud».
  assert.equal(nombres({ ...DEL_MES, sucursales: ['dock sud'] }).length, 1)
})

test('mirando todos los meses aparecen las deudas viejas, con su mes', async () => {
  await carteraDePrueba()
  const todos = buscarDeudores({ ...DEUDORES_SIN_FILTROS }, HOY)
  const delMes = buscarDeudores(DEL_MES, HOY)

  assert.ok(todos.filas.length > delMes.filas.length, 'López no paga desde junio: esas cuotas siguen debiéndose')
  assert.ok(
    todos.filas.some((fila) => fila.periodo !== AGOSTO),
    'y traen el mes al que pertenecen',
  )
  assert.ok(
    todos.filas.some((fila) => (fila.nombre ?? '').includes('LOPEZ')),
    'el que dejó de pagar en junio aparece entre los deudores',
  )
  assert.equal(todos.periodo, '', 'sin mes elegido se miran todos')
  // Fernández se dio de baja en julio: a un ex cliente no se lo persigue por una cuota vieja.
  assert.ok(!todos.filas.some((fila) => (fila.nombre ?? '').includes('FERNANDEZ')))
})

// ---------------------------------------------------------------------------
// Exportar
// ---------------------------------------------------------------------------

test('el .txt sale con los filtros, las filas y el total', async () => {
  await carteraDePrueba()
  const filtros: FiltrosDeudores = { ...DEL_MES, dias: [10, 15] }
  const archivo = archivoDeDeudores(filtros, 'txt', HOY)

  assert.equal(archivo.nombre, `deudores-${AGOSTO}.txt`)
  assert.equal(typeof archivo.contenido, 'string')
  const texto = archivo.contenido as string

  assert.match(texto, /LISTADO DE DEUDORES/)
  assert.match(texto, /Agosto 2026/, 'dice de qué mes es')
  assert.match(texto, /Vencen el 10, 15/, 'y con qué días se armó')
  assert.ok(texto.includes(CLIENTES.rodriguez.nombre) && texto.includes(CLIENTES.suarez.nombre))
  assert.ok(!texto.includes(CLIENTES.martinez.nombre), 'el débito automático no está')
  assert.match(texto, /2 deuda\(s\) de 2 cliente\(s\)/)
  assert.ok(texto.includes('\r\n'), 'CRLF: lo abre el Bloc de notas de Windows')
})

test('el .xlsx es una planilla que Excel abre, con una fila por deuda', async () => {
  await carteraDePrueba()
  const archivo = archivoDeDeudores(DEL_MES, 'xlsx', HOY)
  assert.equal(archivo.nombre, `deudores-${AGOSTO}.xlsx`)
  assert.ok(Buffer.isBuffer(archivo.contenido))

  const partes = leerZip(archivo.contenido as Buffer)
  for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) {
    assert.ok(partes.has(parte), `falta ${parte} en el archivo`)
  }
  assert.match(partes.get('xl/workbook.xml')!, /name="Deudores"/)

  const hoja = partes.get('xl/worksheets/sheet1.xml')!
  assert.ok(hoja.includes(CLIENTES.rodriguez.nombre) && hoja.includes(CLIENTES.suarez.nombre))
  assert.match(hoja, /Forma de pago/, 'con los encabezados de la tabla')
  // Título, encabezados y dos deudas.
  assert.equal([...hoja.matchAll(/<row r="/g)].length, 4)
})

test('exportar con una sola sucursal tildada lo dice en el nombre del archivo', async () => {
  await carteraDePrueba()
  const archivo = archivoDeDeudores({ ...DEL_MES, sucursales: ['DOCK SUD'] }, 'txt', HOY)
  assert.equal(archivo.nombre, `deudores-${AGOSTO}-DOCK-SUD.txt`)
  assert.match(archivo.contenido as string, /Sucursal: DOCK SUD/)
})
