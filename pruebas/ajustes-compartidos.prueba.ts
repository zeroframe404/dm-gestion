// Los dos ajustes compartidos que se calculan contra la base: el catálogo de compañías y el
// encabezado del ticket.
//
// Se prueban acá y no en la pantalla porque lo que puede romperse en silencio es el CRUCE entre dos
// computadoras, y eso no se ve mirando una sola: la compañía que se cruza por nombre normalizado, la
// dirección de una sucursal que sólo existe de este lado, y la huella —el hash del JSON— que tiene que
// dar igual en las cinco máquinas o la pantalla dice «desactualizada» para siempre.
//
// (Google, Meta y el catálogo de vehículos se guardan en el config.json y ése no existe fuera de
// Electron: lo que sí se puede probar acá de ellos es que el valor que viaja no cambie de forma, y eso
// lo cubre la prueba del catálogo de vehículos.)
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { adoptarCompanias, editarCompania, listarCompanias, valorCompartidoDeCompanias } from '../src/main/servicios/companias'
import { plantillaDeAviso } from '../src/main/servicios/plantillas'
import { direccionesDeTicket, adoptarEncabezadoDelTicket, valorCompartidoDelTicket, guardarDireccionesDeTicket } from '../src/main/servicios/ticket'

/** Base nueva en memoria, con el esquema y las cuatro sucursales. */
function base(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  return db
}

function altaDeCompania(db: BaseDeDatos, nombre: string, normalizado: string, dias: number): number {
  const ahora = new Date().toISOString()
  return Number(
    db
      .prepare(
        `INSERT INTO companias (nombre, nombre_normalizado, dias_cobertura_financiera, comision_porcentaje,
                                meses_renovacion, activa, creado_en, actualizado_en)
         VALUES (?, ?, ?, 0, NULL, 1, ?, ?)`,
      )
      .run(nombre, normalizado, dias, ahora, ahora).lastInsertRowid,
  )
}

// ---------------------------------------------------------------------------
// El catálogo de compañías
// ---------------------------------------------------------------------------

test('sin ninguna compañía cargada no hay nada que publicar', () => {
  base()
  assert.equal(valorCompartidoDeCompanias(), null, 'publicar una lista vacía dejaría a las otras computadoras sin catálogo')
})

test('lo que viaja va ordenado y sin lo que es de cada base', () => {
  const db = base()
  altaDeCompania(db, 'Río Uruguay', 'RIO URUGUAY', 6)
  altaDeCompania(db, 'ATM', 'ATM', 7)

  const valor = valorCompartidoDeCompanias()
  assert.ok(valor)
  assert.deepEqual(
    valor.companias.map((c) => c.nombreNormalizado),
    ['ATM', 'RIO URUGUAY'],
    'ordenadas por nombre normalizado: la huella es el hash del JSON y tiene que salir igual en las cinco computadoras',
  )
  // Ni el id ni la cantidad de pólizas: son de cada base, no del dato.
  assert.deepEqual(Object.keys(valor.companias[0]!).sort(), [
    'activa',
    'comisionPorcentaje',
    'diasCoberturaFinanciera',
    'mesesRenovacion',
    'nombre',
    'nombreNormalizado',
  ])
  assert.equal(valor.plantillaAviso, plantillaDeAviso(), 'la plantilla del aviso viaja con el catálogo')
})

test('adoptar cruza por nombre normalizado: actualiza la que existe y da de alta la que no', () => {
  const db = base()
  altaDeCompania(db, 'ATM', 'ATM', 7)

  const adoptado = adoptarCompanias({
    version: 1,
    companias: [
      { nombre: 'ATM', nombreNormalizado: 'ATM', diasCoberturaFinanciera: 15, comisionPorcentaje: 12.5, mesesRenovacion: null, activa: true },
      { nombre: 'Metropol', nombreNormalizado: 'METROPOL', diasCoberturaFinanciera: 3, comisionPorcentaje: 20, mesesRenovacion: 12, activa: true },
    ],
    plantillaAviso: 'Hola {nombre}, te vence el {vencimiento}.',
  })
  assert.equal(adoptado, true)

  const catalogo = listarCompanias()
  const atm = catalogo.find((c) => c.nombre === 'ATM')
  assert.equal(atm?.diasCoberturaFinanciera, 15, 'la que ya estaba se actualiza, no se duplica')
  assert.equal(atm?.comisionPorcentaje, 12.5)
  const metropol = catalogo.find((c) => c.nombre === 'Metropol')
  assert.equal(metropol?.diasCoberturaFinanciera, 3, 'la que no estaba se da de alta')
  assert.equal(metropol?.mesesRenovacion, 12)
  assert.equal(plantillaDeAviso(), 'Hola {nombre}, te vence el {vencimiento}.')
})

test('adoptar NO borra las compañías que esta computadora tiene y no vinieron', () => {
  const db = base()
  // Una compañía que apareció hoy en la cartera de esta sucursal y todavía no viajó.
  altaDeCompania(db, 'San Patricio', 'SAN PATRICIO', 5)
  adoptarCompanias({
    version: 1,
    companias: [{ nombre: 'ATM', nombreNormalizado: 'ATM', diasCoberturaFinanciera: 7, comisionPorcentaje: 0, mesesRenovacion: null, activa: true }],
    plantillaAviso: '',
  })
  const nombres = listarCompanias().map((c) => c.nombre)
  assert.ok(nombres.includes('San Patricio'), 'borrarla dejaría sus pólizas sin días de cobertura')
  assert.ok(nombres.includes('ATM'))
})

test('una fila con un número imposible se saltea sola, sin llevarse puesta la adopción entera', () => {
  base()
  const adoptado = adoptarCompanias({
    version: 1,
    companias: [
      { nombre: 'Rota', nombreNormalizado: 'ROTA', diasCoberturaFinanciera: 4000, comisionPorcentaje: 0, mesesRenovacion: null, activa: true },
      { nombre: 'ATM', nombreNormalizado: 'ATM', diasCoberturaFinanciera: 7, comisionPorcentaje: 0, mesesRenovacion: null, activa: true },
    ],
    plantillaAviso: '',
  })
  assert.equal(adoptado, true)
  const nombres = listarCompanias().map((c) => c.nombre)
  assert.deepEqual(nombres, ['ATM'])
})

test('lo publicado por una versión más nueva no se adopta a medias: no se adopta', () => {
  base()
  const adoptado = adoptarCompanias({
    version: 2,
    companias: [{ nombre: 'ATM', nombreNormalizado: 'ATM', diasCoberturaFinanciera: 7, comisionPorcentaje: 0, mesesRenovacion: null, activa: true }],
  })
  assert.equal(adoptado, false)
  assert.equal(listarCompanias().length, 0)
})

test('lo que se edita en la pantalla es exactamente lo que sale a publicar', () => {
  const db = base()
  const id = altaDeCompania(db, 'ATM', 'ATM', 7)
  editarCompania(id, { nombre: 'ATM', diasCoberturaFinanciera: 21, comisionPorcentaje: 15, mesesRenovacion: 6, activa: true })

  const publicado = valorCompartidoDeCompanias()?.companias.find((c) => c.nombreNormalizado === 'ATM')
  assert.equal(publicado?.diasCoberturaFinanciera, 21)
  assert.equal(publicado?.comisionPorcentaje, 15)
  assert.equal(publicado?.mesesRenovacion, 6)
})

// ---------------------------------------------------------------------------
// El encabezado del ticket
// ---------------------------------------------------------------------------

test('el encabezado viaja ordenado y con las cuatro sucursales que tienen algo cargado', () => {
  base()
  const valor = valorCompartidoDelTicket()
  assert.ok(valor, 'las direcciones de fábrica ya son algo que compartir')
  const sucursales = valor.direcciones.map((d) => d.sucursal)
  assert.deepEqual([...sucursales].sort(), sucursales, 'ordenadas, para que la huella dé igual en todas las computadoras')
  assert.ok(valor.direcciones.every((d) => d.direccion.trim() !== '' || d.telefono.trim() !== ''))
})

test('adoptar el encabezado reemplaza lo publicado y conserva la sucursal que sólo existe acá', () => {
  base()
  // Una sucursal que esta computadora cargó y todavía no publicó.
  guardarDireccionesDeTicket([
    ...direccionesDeTicket().map((fila) => ({ ...fila })),
    { sucursal: 'Quilmes', direccion: 'Rivadavia 1', telefono: '11 5555-0000', enLaLista: false },
  ])

  const adoptado = adoptarEncabezadoDelTicket({
    direcciones: [
      { sucursal: 'Lanús', direccion: 'Centenario Uruguayo 1217', telefono: '11 4000-1111' },
      { sucursal: 'Dock Sud', direccion: 'Manuel Estévez 1234', telefono: '11 4000-2222' },
    ],
  })
  assert.equal(adoptado, true)

  const filas = direccionesDeTicket()
  const lanus = filas.find((f) => f.sucursal === 'Lanús')
  assert.equal(lanus?.telefono, '11 4000-1111', 'lo publicado pisa lo que había')
  const quilmes = filas.find((f) => f.sucursal === 'Quilmes')
  assert.equal(quilmes?.direccion, 'Rivadavia 1', 'lo que no vino no se pierde: puede ser un local nuevo sin publicar')
})

test('«Avellaneda» y «Dock Sud» son el mismo mostrador también al adoptar', () => {
  base()
  adoptarEncabezadoDelTicket({ direcciones: [{ sucursal: 'AVELLANEDA', direccion: 'Otra calle 99', telefono: '11 9999-9999' }] })
  const dockSud = direccionesDeTicket().find((f) => f.sucursal === 'Dock Sud')
  assert.equal(dockSud?.direccion, 'Otra calle 99', 'si no se cruzaran, el mismo mostrador quedaría con dos direcciones')
  assert.equal(
    direccionesDeTicket().filter((f) => f.sucursal.toUpperCase() === 'AVELLANEDA').length,
    0,
    'y no aparece una fila suelta «AVELLANEDA» al lado de la de Dock Sud',
  )
})

test('un encabezado sin ninguna dirección usable no se adopta', () => {
  base()
  assert.equal(adoptarEncabezadoDelTicket({ direcciones: [] }), false)
  assert.equal(adoptarEncabezadoDelTicket({}), false)
  assert.equal(adoptarEncabezadoDelTicket(null), false)
})
