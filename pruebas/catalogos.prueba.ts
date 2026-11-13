// Las sucursales y ramas configurables (src/shared/catalogos.ts y catalogosVigentes.ts). El guardado en
// config.json no se prueba acá (ese archivo no existe fuera de Electron): sí lo que decide qué se acepta, que
// renombrar no pierda lo ya cargado y que la base siga la lista.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from '../src/main/db/base'
import { ajustarCatalogoDeSucursales } from '../src/main/db/semilla'
import { listarSucursales } from '../src/main/servicios/sucursales'
import { CATALOGOS_DE_FABRICA, normalizarCatalogos, sonCatalogosDeFabrica } from '../src/shared/catalogos'
import { aplicarCatalogos, catalogosAplicados } from '../src/shared/catalogosVigentes'
import { NOMBRE_RAMA, RAMAS, ramaCanonica, ramaDeVehiculo, ramasParaElegir } from '../src/shared/ramas'
import { mismaSucursal, SUCURSALES, sucursalCanonica } from '../src/shared/sucursales'

/** Corre `cuerpo` con otros catálogos y deja SIEMPRE los de fábrica al salir: el resto de las pruebas comparte el proceso. */
function con(crudo: unknown, cuerpo: () => void): void {
  try {
    aplicarCatalogos(crudo)
    cuerpo()
  } finally {
    aplicarCatalogos(CATALOGOS_DE_FABRICA)
  }
}

test('sin nada cargado, o con basura, vuelven las listas de fábrica', () => {
  for (const crudo of [undefined, null, 'hola', {}, { sucursales: [], ramas: 'x' }, { sucursales: [{ nombre: '  ' }] }]) {
    assert.ok(sonCatalogosDeFabrica(normalizarCatalogos(crudo)))
  }
  assert.deepEqual([...SUCURSALES], ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
  assert.equal(RAMAS.length, 7)
  assert.equal(sucursalCanonica('AVELLANEDA'), 'Dock Sud')
  assert.equal(ramaCanonica('Camioneta'), 'PICK UP')
})

test('los nombres repetidos se plegan por clave y un sinónimo no puede ser el nombre de otra entrada', () => {
  const c = normalizarCatalogos({
    sucursales: [
      { nombre: 'Lanús', sinonimos: ['Lanus', 'LANÚS', 'Remedios', 'Sarandí'] },
      { nombre: 'LANUS' },
      { nombre: 'Sarandí', sinonimos: ['Remedios'] },
    ],
  })
  assert.deepEqual(c.sucursales.map((s) => s.nombre), ['Lanús', 'Sarandí'])
  assert.deepEqual(c.sucursales[0].sinonimos, ['Remedios'], 'el propio nombre y el de otra sucursal no son sinónimos')
  assert.deepEqual(c.sucursales[1].sinonimos, [], 'un sinónimo ya tomado queda con la primera')
})

test('renombrar una sucursal: el nombre viejo se sigue leyendo como la nueva', () => {
  con({ sucursales: [{ nombre: 'Lanús Centro', sinonimos: ['Lanús', 'LANUS'] }, { nombre: 'Dock Sud', sinonimos: ['Avellaneda'] }], ramas: CATALOGOS_DE_FABRICA.ramas }, () => {
    assert.deepEqual([...SUCURSALES], ['Lanús Centro', 'Dock Sud'])
    assert.equal(sucursalCanonica('Lanús'), 'Lanús Centro')
    assert.equal(sucursalCanonica('lanus centro'), 'Lanús Centro')
    assert.ok(mismaSucursal('LANUS', 'Lanús Centro'))
    assert.equal(sucursalCanonica('Sarandí'), null, 'la que se sacó de la lista ya no es del catálogo')
  })
  assert.equal(sucursalCanonica('Lanús'), 'Lanús', 'y al volver a fábrica, todo como antes')
})

test('ramas: una nueva se reconoce, una sacada deja de ser del catálogo y aparece suelta', () => {
  const sinTrailer = CATALOGOS_DE_FABRICA.ramas.filter((r) => r.valor !== 'TRAILER')
  con({ ramas: [...sinTrailer, { valor: 'CUATRICICLO', nombre: 'Cuatriciclo', familia: 'moto', sinonimos: ['Cuatriciclos', 'Quad'] }] }, () => {
    assert.equal(ramaCanonica('quad'), 'CUATRICICLO')
    assert.equal(NOMBRE_RAMA.CUATRICICLO, 'Cuatriciclo')
    assert.equal(ramaCanonica('TRAILER'), null)
    assert.ok(RAMAS.includes('CUATRICICLO') && !RAMAS.includes('TRAILER'))
    assert.deepEqual(ramasParaElegir(['TRAILER', 'quad']).slice(-1), ['TRAILER'], 'lo sacado de la lista sigue elegible como suelto')
  })
  assert.equal(ramaCanonica('quad'), null)
  assert.equal(ramaCanonica('ACOPLADO'), 'TRAILER')
})

test('ramas: renombrar sólo cambia cómo se lee, y la afinación respeta lo que quedó en la lista', () => {
  const sinPickUp = CATALOGOS_DE_FABRICA.ramas.filter((r) => r.valor !== 'PICK UP')
  assert.equal(ramaDeVehiculo('AUTO', 'PICKUP'), 'PICK UP')
  con({ ramas: sinPickUp }, () => {
    assert.equal(ramaDeVehiculo('AUTO', 'PICKUP'), 'AUTO', 'sin la rama «Pick up» no se afina hacia una rama que no existe')
  })
  con({ ramas: CATALOGOS_DE_FABRICA.ramas.map((r) => (r.valor === 'MOTO' ? { ...r, nombre: 'Motocicleta' } : r)) }, () => {
    assert.equal(NOMBRE_RAMA.MOTO, 'Motocicleta')
    assert.equal(ramaCanonica('MOTOS'), 'MOTO', 'el valor guardado no cambia')
  })
})

test('la base sigue la lista: la sucursal nueva se siembra y la renombrada se une con la vieja', () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    const db = abrirBaseDeDatos(':memory:')
    const antes = db.prepare('SELECT sucursal_id AS id FROM usuarios LIMIT 1').get() as { id: number }
    con(
      {
        sucursales: [
          { nombre: 'Dock Sud', sinonimos: ['Avellaneda'] },
          { nombre: 'Lanús', sinonimos: [] },
          { nombre: 'Sarandí', sinonimos: [] },
          { nombre: 'Daniel Martínez', sinonimos: ['Daniel'] },
          { nombre: 'Banfield', sinonimos: [] },
        ],
      },
      () => {
        ajustarCatalogoDeSucursales(db)
        assert.deepEqual(listarSucursales().map((s) => s.nombre), ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel Martínez', 'Banfield'])
        const despues = db.prepare('SELECT s.nombre FROM usuarios u JOIN sucursales s ON s.id = u.sucursal_id LIMIT 1').get() as { nombre: string }
        assert.equal(despues.nombre, 'Daniel Martínez', 'el usuario que estaba en «Daniel» pasó a la sucursal renombrada')
        assert.notEqual(antes.id, undefined)
        assert.equal(catalogosAplicados().sucursales.length, 5)
      },
    )
  } finally {
    console.log = registrar
    cerrarBaseDeDatos()
  }
})
