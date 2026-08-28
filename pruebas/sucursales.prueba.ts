// Las cuatro sucursales de la agencia: Dock Sud (que es lo mismo que Avellaneda), Lanús, Sarandí y
// Daniel. No hay una quinta y no se puede crear una sin querer.
//
// Antes eran tres y cualquier texto podía convertirse en una más: bastaba una pestaña que escribiera
// «AVELLANEDA» o un usuarios.json editado a mano en GitHub. El mismo mostrador quedaba dos veces en
// cada desplegable y elegir uno escondía las filas del otro. Acá se fija que eso no vuelva a pasar.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db, type BaseDeDatos } from '../src/main/db/base'
import { ajustarCatalogoDeSucursales } from '../src/main/db/semilla'
import { catalogos } from '../src/main/servicios/cartera'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { idDeSucursalPorNombre, listarSucursales } from '../src/main/servicios/sucursales'
import { direccionDeSucursal } from '../src/main/servicios/preferencias'
import { leerDocumento } from '../src/main/usuarios/documento'
import { idDeSucursal } from '../src/main/usuarios/espejo'
import { mismaSucursal, SUCURSALES, sucursalCanonica } from '../src/shared/sucursales'
import { HojaSimulada } from './hoja-simulada'
import { importar, unico } from './ayuda'

/** Base nueva y en silencio: las migraciones y la semilla avisan por consola. */
function baseNueva(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  try {
    return abrirBaseDeDatos(':memory:')
  } finally {
    console.log = registrar
  }
}

// ---------------------------------------------------------------------------
// La lista, sin base de datos de por medio
// ---------------------------------------------------------------------------

test('sólo existen cuatro sucursales y «Avellaneda» es una forma de nombrar a Dock Sud', () => {
  assert.deepEqual([...SUCURSALES], ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])

  for (const escrito of ['Dock Sud', 'DOCK SUD', 'docksud', ' dock-sud ', 'Avellaneda', 'AVELLANEDA']) {
    assert.equal(sucursalCanonica(escrito), 'Dock Sud', `«${escrito}» es Dock Sud`)
  }
  for (const escrito of ['Lanús', 'LANUS', 'lanus ']) assert.equal(sucursalCanonica(escrito), 'Lanús')
  for (const escrito of ['Sarandí', 'SARANDI', 'sarandi']) assert.equal(sucursalCanonica(escrito), 'Sarandí')
  assert.equal(sucursalCanonica('DANIEL'), 'Daniel')

  // La quinta no existe: no se inventa ni se acerca a la más parecida.
  assert.equal(sucursalCanonica('Quilmes'), null)
  assert.equal(sucursalCanonica('Dock'), null)
  assert.equal(sucursalCanonica(''), null)
  assert.equal(sucursalCanonica(null), null)
})

test('comparar dos textos dice si son el mismo mostrador', () => {
  assert.ok(mismaSucursal('AVELLANEDA', 'Dock Sud'))
  assert.ok(mismaSucursal('lanus', 'Lanús'))
  assert.ok(!mismaSucursal('Lanús', 'Sarandí'))
  assert.ok(!mismaSucursal('Quilmes', 'Dock Sud'), 'una que no es del catálogo no empata con ninguna')
  // Fuera del catálogo cada texto sigue empatando consigo mismo: si no, un valor viejo se perdería.
  assert.ok(mismaSucursal('BRENDA', 'brenda '))
})

// ---------------------------------------------------------------------------
// El catálogo de la base
// ---------------------------------------------------------------------------

test('una base nueva arranca con las cuatro, en el orden de la agencia', () => {
  baseNueva()
  // listarSucursales() da el orden de la agencia (es el de los desplegables de Administración); los
  // filtros de la cartera las ofrecen ordenadas alfabéticamente.
  assert.deepEqual(listarSucursales().map((s) => s.nombre), ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
  assert.deepEqual(catalogos().sucursales, ['Daniel', 'Dock Sud', 'Lanús', 'Sarandí'])
  cerrarBaseDeDatos()
})

test('una base que tenía «Avellaneda» aparte se queda con una sola Dock Sud, sin perder a quien la tenía', () => {
  const base = baseNueva()
  const dockSud = idDeSucursalPorNombre('Dock Sud')!
  const avellaneda = Number(base.prepare(`INSERT INTO sucursales (nombre) VALUES ('Avellaneda')`).run().lastInsertRowid)
  base.prepare(
    `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id) VALUES ('Fede', 'fede', '', 'EMPLEADO', ?)`,
  ).run(avellaneda)
  base.prepare(
    `INSERT INTO clientes (clave, nombre, sucursal_id, sucursal_texto, creado_en, actualizado_en)
     VALUES ('C-1', 'PEREZ JUAN', ?, 'Avellaneda', '2026-08-01T09:00:00', '2026-08-01T09:00:00')`,
  ).run(avellaneda)

  const registrar = console.log
  console.log = () => undefined
  try {
    ajustarCatalogoDeSucursales(base)
  } finally {
    console.log = registrar
  }

  assert.deepEqual(listarSucursales().map((s) => s.nombre), ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
  assert.equal(unico<number>(base, `SELECT sucursal_id FROM usuarios WHERE usuario = 'fede'`), dockSud)
  assert.equal(unico<number>(base, `SELECT sucursal_id FROM clientes WHERE clave = 'C-1'`), dockSud)
  cerrarBaseDeDatos()
})

test('una sucursal que no es ninguna de las cuatro no se borra: quien la tenga asignada no se queda sin nada', () => {
  const base = baseNueva()
  const quilmes = Number(base.prepare(`INSERT INTO sucursales (nombre) VALUES ('Quilmes')`).run().lastInsertRowid)

  ajustarCatalogoDeSucursales(base)

  assert.ok(listarSucursales().some((s) => s.id === quilmes), 'sigue estando, aunque quede al final de la lista')
  assert.equal(listarSucursales().at(-1)?.nombre, 'Quilmes')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// De dónde podía salir una quinta sucursal
// ---------------------------------------------------------------------------

test('el usuarios.json de GitHub no puede nombrar una sucursal que no existe', () => {
  const conSucursal = (sucursal: string) =>
    JSON.stringify({
      formato: 1,
      siguienteId: 2,
      usuarios: [{ id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', claveHash: 'x', rol: 'SUPER_ADMIN', sucursal }],
    })

  assert.throws(() => leerDocumento(conSucursal('Quilmes')), /Quilmes.*no existe/s)
  // Y las formas de escribir una de las cuatro entran, ya pasadas al nombre del catálogo.
  assert.equal(leerDocumento(conSucursal('avellaneda')).usuarios[0]!.sucursal, 'Dock Sud')
  assert.equal(leerDocumento(conSucursal('LANUS')).usuarios[0]!.sucursal, 'Lanús')
})

test('reflejar un usuario de GitHub no crea sucursales: «Avellaneda» cae en Dock Sud', () => {
  const base = baseNueva()
  assert.equal(idDeSucursal(base, 'AVELLANEDA'), idDeSucursalPorNombre('Dock Sud'))
  assert.equal(idDeSucursal(base, 'sarandi'), idDeSucursalPorNombre('Sarandí'))
  assert.equal(unico<number>(base, 'SELECT COUNT(*) FROM sucursales'), 4, 'siguen siendo cuatro')
  assert.throws(() => idDeSucursal(base, 'Quilmes'), ErrorDeNegocio)
  cerrarBaseDeDatos()
})

test('la planilla que escribe «AVELLANEDA» se guarda como «Dock Sud»', async () => {
  const base = baseNueva()
  const filas = [
    ['APELLIDO Y NOMBRE', 'DNI', 'SUCURSAL', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
    ['GOMEZ ANA', '20111222', 'AVELLANEDA', 'SANCOR', '900001', '$ 10.000', '10'],
    ['RUIZ LUIS', '20111223', 'DOCK SUD', 'SANCOR', '900002', '$ 10.000', '10'],
    ['DIAZ EVA', '20111224', 'SARANDI', 'SANCOR', '900003', '$ 10.000', '10'],
  ]
  const { informe } = await importar(base, new HojaSimulada([{ titulo: 'AGOSTO', valores: filas, columnas: 7 }]))

  assert.deepEqual(Object.keys(informe.sucursalesDesconocidas), [], 'las tres son del catálogo')
  const guardadas = base
    .prepare('SELECT DISTINCT sucursal_texto AS valor FROM cuotas_mes ORDER BY valor')
    .pluck()
    .all() as string[]
  assert.deepEqual(guardadas, ['Dock Sud', 'Sarandí'], '«AVELLANEDA» y «DOCK SUD» son una sola opción')

  // Y el desplegable de la pantalla ofrece las cuatro, ni una más.
  assert.deepEqual(catalogos().sucursales, ['Daniel', 'Dock Sud', 'Lanús', 'Sarandí'])
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// El ticket
// ---------------------------------------------------------------------------

test('el ticket de Dock Sud sale con la dirección de Avellaneda, que es la misma', () => {
  baseNueva()
  assert.match(direccionDeSucursal('Dock Sud'), /Manuel Estévez/)
  assert.match(direccionDeSucursal('AVELLANEDA'), /Manuel Estévez/)
  assert.match(direccionDeSucursal('Sarandí'), /Bartolomé Mitre/)
  assert.match(direccionDeSucursal('Lanús'), /Centenario Uruguayo/)
  assert.equal(direccionDeSucursal('Quilmes'), '')
  cerrarBaseDeDatos()
})

test('la sucursal del usuario que abrió sesión sigue siendo una de las cuatro', () => {
  baseNueva()
  const daniel = db()
    .prepare(`SELECT s.nombre FROM usuarios u JOIN sucursales s ON s.id = u.sucursal_id WHERE u.usuario = 'daniel'`)
    .pluck()
    .get() as string
  assert.equal(daniel, 'Daniel')
  cerrarBaseDeDatos()
})
