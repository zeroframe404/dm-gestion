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
import { listarClientes } from '../src/main/servicios/clientes'
import { fichaDeLead, listarLeads } from '../src/main/servicios/leads'
import { bandejaDeRenovaciones } from '../src/main/servicios/renovaciones'
import { fichaDeTarea, listarTareas } from '../src/main/servicios/tareas'
import { idDeSucursalPorNombre, listarSucursales } from '../src/main/servicios/sucursales'
import { direccionDeSucursal } from '../src/main/servicios/preferencias'
import { leerDocumento } from '../src/main/usuarios/documento'
import { idDeSucursal } from '../src/main/usuarios/espejo'
import { mismaSucursal, SUCURSALES, sucursalCanonica } from '../src/shared/sucursales'
import type { SesionUsuario } from '../src/shared/tipos'
import { HojaSimulada } from './hoja-simulada'
import { desplegablesDeSucursal, importar, unico } from './ayuda'

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
  // El orden de la agencia es UNO SOLO en toda la aplicación: el de listarSucursales() (los
  // desplegables de Administración) y el de los filtros. Antes la cartera las ofrecía alfabéticas y
  // Administración por orden de agencia, así que la misma lista se leía distinta en cada pantalla;
  // desde que las arma `sucursalesParaElegir` no hay dos órdenes que mantener sincronizados.
  //
  // Lo que este banco NO puede mirar es el renderer: DialogoLead, DialogoNuevaTarea y FichaTarea
  // reciben esta misma lista y durante un tiempo le hacían `.sort()` encima, así que el filtro de
  // Leads arrancaba por «Dock Sud» y el «Nueva consulta» de esa misma pantalla por «Daniel». Ya no
  // reordenan: si alguien vuelve a agregar un `.sort()` allá, esta prueba sigue en verde y la
  // discrepancia vuelve. El orden se respeta desde acá hasta el desplegable, sin retoques en el medio.
  assert.deepEqual(listarSucursales().map((s) => s.nombre), ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
  assert.deepEqual(catalogos().sucursales, ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
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

  // Y el desplegable de la pantalla ofrece las cuatro, ni una más: «AVELLANEDA» no se cuela como
  // quinta opción al lado de «Dock Sud», y Daniel está aunque la hoja no traiga ni una fila suya.
  assert.deepEqual(catalogos().sucursales, ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
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

// ---------------------------------------------------------------------------
// Los desplegables de sucursal
// ---------------------------------------------------------------------------

test('todos los desplegables ofrecen las cuatro aunque ninguna fila tenga esa sucursal', () => {
  baseNueva()

  // Es el caso de Sarandí: se sembró cuando abrió el mostrador y no tenía todavía ni un cliente, ni un
  // lead, ni un siniestro. Las pantallas que armaban el desplegable sólo con lo ya cargado no la
  // ofrecían, así que desde Sarandí parecía que la sucursal no existía —y para que existiera había que
  // cargar una fila con esa sucursal, que era justamente lo que no se podía hacer—. Una base recién
  // creada es la versión extrema del mismo caso: ninguna tabla tiene nada y las cuatro tienen que estar.
  for (const [pantalla, ofrecidas] of desplegablesDeSucursal()) {
    assert.deepEqual(ofrecidas, [...SUCURSALES], `el desplegable de ${pantalla}`)
  }
  cerrarBaseDeDatos()
})

test('una sucursal que no es del catálogo pero está en los datos no se pierde del desplegable', () => {
  const base = baseNueva()
  // «BRENDA» es de las filas viejas de la hoja: no es ninguna de las cuatro y nadie la va a volver a
  // cargar, pero las filas que la tienen siguen ahí. Si desapareciera del desplegable no habría forma
  // de filtrarlas para encontrarlas y corregirlas.
  base.prepare(
    `INSERT INTO leads (fila_id, pestana, nombre, sucursal_texto, origen, estado, creado_en, actualizado_en)
     VALUES ('L-1', 'APP LEADS', 'QUIROGA NATALIA', 'BRENDA', 'OTRO', 'NUEVO', '2026-08-01T10:00:00', '2026-08-01T10:00:00')`,
  ).run()
  base.prepare(
    `INSERT INTO tareas (titulo, sucursal_texto, estado, creado_por, creado_en, actualizado_en)
     VALUES ('Llamar al perito', 'BRENDA', 'pendiente', 'daniel', '2026-08-01T10:00:00', '2026-08-01T10:00:00')`,
  ).run()

  const esperado = [...SUCURSALES, 'BRENDA']
  assert.deepEqual(listarLeads({ busqueda: '', estado: '', origen: '', sucursal: '', incluirCerrados: true }).sucursales, esperado)
  assert.deepEqual(listarTareas({ busqueda: '', estado: '', prioridad: '', sucursal: '', responsableId: 0 }).sucursales, esperado)

  // La ficha de la tarea tenía el problema al revés: ofrecía sólo el catálogo, así que abrir esta
  // tarea y guardarla la mudaba de sucursal sin que nadie lo pidiera.
  const tareaId = unico<number>(base, `SELECT id FROM tareas WHERE sucursal_texto = 'BRENDA'`)
  const actor: SesionUsuario = {
    id: 1,
    nombre: 'Daniel Martínez',
    usuario: 'daniel',
    rol: 'SUPER_ADMIN',
    sucursal: { id: 1, nombre: 'Daniel' },
    debeCambiarClave: false,
  }
  assert.deepEqual(fichaDeTarea(tareaId, actor).sucursales, esperado)
  cerrarBaseDeDatos()
})

test('«AVELLANEDA» en los datos no se suma como quinta opción al lado de «Dock Sud»', () => {
  const base = baseNueva()
  base.prepare(
    `INSERT INTO leads (fila_id, pestana, nombre, sucursal_texto, origen, estado, creado_en, actualizado_en)
     VALUES ('L-1', 'APP LEADS', 'SOSA MARTIN', 'AVELLANEDA', 'OTRO', 'NUEVO', '2026-08-01T10:00:00', '2026-08-01T10:00:00')`,
  ).run()

  // Es el mismo mostrador escrito de otra forma: dos opciones para el mismo local esconderían una las
  // filas de la otra, que es de donde salió toda esta historia.
  assert.deepEqual(listarLeads({ busqueda: '', estado: '', origen: '', sucursal: '', incluirCerrados: true }).sucursales, [...SUCURSALES])
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// El desplegable y el filtro pliegan igual
// ---------------------------------------------------------------------------
//
// La trampa de plegar las grafías en el desplegable es que el filtro tiene que plegarlas igual. Si el
// desplegable esconde «AVELLANEDA» dentro de «Dock Sud» pero el filtro compara el texto pelado, esas
// filas quedan sin NINGUNA opción que las traiga: ni la suya, que ya no está en la lista, ni la de Dock
// Sud, que no las encuentra. Es peor que antes: antes al menos la grafía fea estaba y funcionaba.
//
// El texto crudo entra igual: la celda «Sucursal» de la Planilla del mes y el alta de un riesgo son
// campos libres con sugerencias, así que se puede escribir «Avellaneda» a mano cuando se quiera.

/** Los leads de la base, con la sucursal como está escrita en cada uno. */
function leadsPorSucursal(sucursal: string): string[] {
  return listarLeads({ busqueda: '', estado: '', origen: '', sucursal, incluirCerrados: true }).filas.map((l) => l.nombre)
}

test('elegir «Dock Sud» trae también las filas que dicen «AVELLANEDA» o «DOCKSUD»', () => {
  const base = baseNueva()
  const alta = (nombre: string, sucursal: string) =>
    base
      .prepare(
        `INSERT INTO leads (fila_id, pestana, nombre, sucursal_texto, origen, estado, creado_en, actualizado_en)
         VALUES (?, 'APP LEADS', ?, ?, 'OTRO', 'NUEVO', '2026-08-01T10:00:00', '2026-08-01T10:00:00')`,
      )
      .run(`L-${nombre}`, nombre, sucursal)
  alta('SOSA MARTIN', 'AVELLANEDA')
  alta('PEREZ ANA', 'DOCKSUD')
  alta('GOMEZ LUIS', 'Dock  Sud')
  alta('QUIROGA NATALIA', 'BRENDA')

  // Cuatro grafías distintas y una sola opción para las tres primeras: son el mismo mostrador.
  assert.deepEqual(listarLeads({ busqueda: '', estado: '', origen: '', sucursal: '', incluirCerrados: true }).sucursales, [
    ...SUCURSALES,
    'BRENDA',
  ])

  // Y esa opción los trae a los tres. Con el filtro comparando el texto pelado devolvía uno solo y los
  // otros dos no aparecían bajo ninguna opción de la lista.
  assert.deepEqual(leadsPorSucursal('Dock Sud').sort(), ['GOMEZ LUIS', 'PEREZ ANA', 'SOSA MARTIN'])
  assert.deepEqual(leadsPorSucursal('BRENDA'), ['QUIROGA NATALIA'])
  for (const vacia of ['Lanús', 'Sarandí', 'Daniel']) {
    assert.deepEqual(leadsPorSucursal(vacia), [], `«${vacia}» no tiene ninguna consulta`)
  }

  // Ninguna consulta se pierde: entre todas las opciones que ofrece el desplegable están las cuatro.
  const alcanzadas = new Set(
    listarLeads({ busqueda: '', estado: '', origen: '', sucursal: '', incluirCerrados: true }).sucursales.flatMap((s) =>
      leadsPorSucursal(s),
    ),
  )
  assert.equal(alcanzadas.size, 4, 'toda fila tiene alguna opción que la trae')
  cerrarBaseDeDatos()
})

test('en Clientes, «Dock Sud» encuentra la ficha que la celda dejó escrita «Avellaneda»', () => {
  const base = baseNueva()
  // Así queda una ficha cuando alguien escribe la sucursal a mano en la Planilla del mes: `editarCelda`
  // guarda el texto tal cual, y la celda es un campo libre con sugerencias.
  base.prepare(
    `INSERT INTO clientes (clave, nombre, documento, sucursal_texto, creado_en, actualizado_en)
     VALUES ('doc:26999888', 'QUIROGA NATALIA', '26999888', 'Avellaneda', '2026-08-01T10:00:00', '2026-08-01T10:00:00')`,
  ).run()

  const listado = listarClientes({ busqueda: '', sucursal: '', compania: '', estado: '' })
  assert.deepEqual(listado.sucursales, [...SUCURSALES], '«Avellaneda» no es una quinta opción')

  const porDockSud = listarClientes({ busqueda: '', sucursal: 'Dock Sud', compania: '', estado: '' })
  assert.deepEqual(porDockSud.filas.map((f) => f.nombre), ['QUIROGA NATALIA'])
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Los otros lugares desde donde se abre el mismo diálogo
// ---------------------------------------------------------------------------
//
// Un desplegable de sucursal no se arregla por pantalla sino por diálogo: el mismo formulario se abre
// desde más de un lado y cada llamador le pasa la lista. Si uno se olvida, ahí queda el problema de
// Sarandí, más difícil de ver porque la pantalla de al lado anda bien.

test('la ficha de la consulta ofrece las mismas sucursales que el listado', () => {
  const base = baseNueva()
  base.prepare(
    `INSERT INTO leads (fila_id, pestana, nombre, sucursal_texto, origen, estado, creado_en, actualizado_en)
     VALUES ('L-1', 'APP LEADS', 'SOSA MARTIN', 'Lanús', 'OTRO', 'NUEVO', '2026-08-01T10:00:00', '2026-08-01T10:00:00')`,
  ).run()
  const leadId = unico<number>(base, `SELECT id FROM leads WHERE nombre = 'SOSA MARTIN'`)

  // «Editar la consulta» de la ficha es el mismo diálogo que «Nueva consulta» del listado. Antes la
  // ficha le pasaba nada más que la sucursal del lead, así que una consulta anotada en Lanús que en
  // realidad era de Sarandí no se podía corregir desde donde se la estaba mirando.
  assert.deepEqual(fichaDeLead(leadId).sucursales, listarLeads({ busqueda: '', estado: '', origen: '', sucursal: '', incluirCerrados: true }).sucursales)
  assert.deepEqual(fichaDeLead(leadId).sucursales, [...SUCURSALES])
  cerrarBaseDeDatos()
})

test('«Anotar tarea» desde Renovaciones ofrece las mismas sucursales que Tareas', () => {
  baseNueva()
  // La bandeja abre el `DialogoNuevaTarea` del módulo Tareas. Le pasaba la sucursal de la renovación y
  // nada más, así que desde acá no se le podía anotar una tarea a ninguna otra sucursal —y si la
  // renovación no tenía sucursal cargada, la única opción era la de quien entró.
  assert.deepEqual(
    bandejaDeRenovaciones().sucursales,
    listarTareas({ busqueda: '', estado: '', prioridad: '', sucursal: '', responsableId: 0 }).sucursales,
  )
  assert.deepEqual(bandejaDeRenovaciones().sucursales, [...SUCURSALES])
  cerrarBaseDeDatos()
})
