// Reproduce el caso «filtro por sucursal sin resultados» que apareció en una sola computadora.
//
// La computadora de Lanús se instaló igual que las demás, pero al filtrar por sucursal el listado
// salía vacío. El motivo no es el filtro: es que la hoja que importó ESA computadora no traía la
// columna LOCAL, así que todas sus filas quedaron sin sucursal. El desplegable, en cambio, se arma
// con el catálogo sembrado (Dock Sud, Lanús, Daniel), que existe siempre y en todas las bases.
//
// Resultado: la pantalla ofrece tres sucursales, ninguna puede coincidir con nada, y el vacío no se
// explica solo. Esta prueba fija esa combinación para que se vea de dónde sale.
import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarMigraciones, MIGRACIONES } from '../src/main/db/migraciones'
import { sembrarDatosIniciales } from '../src/main/db/semilla'
import { catalogos, cerrarMes, planillaDelMes } from '../src/main/servicios/cartera'
import { cajaDelDia } from '../src/main/servicios/cobranzas'
import { listarLeads } from '../src/main/servicios/leads'
import { idDeSucursalPorNombre } from '../src/main/servicios/sucursales'
import type { SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import type { PestanaSimulada } from './hoja-simulada'
import { importar } from './ayuda'

/** Los encabezados con los que la hoja puede nombrar a la sucursal (ver importacion/encabezados.ts). */
const ENCABEZADOS_DE_SUCURSAL = new Set(['LOCAL', 'SUCURSAL', 'SUC', 'OFICINA', 'SEDE', 'AGENCIA'])

/** Saca de la hoja la columna de sucursal, como una planilla que nunca la tuvo. */
function sinColumnaDeSucursal(pestanas: PestanaSimulada[]): PestanaSimulada[] {
  return pestanas.map((pestana) => {
    const encabezados = pestana.valores[0] ?? []
    const aQuitar = encabezados
      .map((titulo, indice) => (ENCABEZADOS_DE_SUCURSAL.has(titulo.trim().toUpperCase()) ? indice : -1))
      .filter((indice) => indice !== -1)
    if (aQuitar.length === 0) return pestana
    const valores = pestana.valores.map((fila) => fila.filter((_celda, indice) => !aQuitar.includes(indice)))
    return { ...pestana, valores, columnas: pestana.columnas ? pestana.columnas - aQuitar.length : undefined }
  })
}

async function baseSinSucursales() {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(sinColumnaDeSucursal(construirHojaDePrueba())))
  return db
}

test('una hoja sin columna LOCAL deja toda la cartera sin sucursal', async () => {
  await baseSinSucursales()
  const planilla = planillaDelMes(null)

  assert.ok(planilla.filas.length > 0, 'la planilla trae filas: el listado sin filtrar se ve normal')
  assert.equal(
    planilla.filas.filter((f) => f.sucursal !== null && f.sucursal !== '').length,
    0,
    'ninguna fila tiene sucursal, porque la hoja no traía la columna',
  )
  cerrarBaseDeDatos()
})

test('el desplegable ofrece las tres sucursales aunque ninguna fila las tenga', async () => {
  await baseSinSucursales()
  const ofrecidas = catalogos().sucursales

  // El catálogo sembrado siempre está: por eso el filtro parece sano hasta que se usa.
  assert.deepEqual([...ofrecidas].sort(), ['Daniel', 'Dock Sud', 'Lanús'])
  cerrarBaseDeDatos()
})

test('filtrar por cualquiera de las tres deja el listado en cero', async () => {
  await baseSinSucursales()
  const planilla = planillaDelMes(null)

  // Es el mismo filtro que aplica la pantalla (PlanillaDelMes.tsx): comparar normalizado.
  const normalizar = (valor: string | null) =>
    (valor ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '')

  for (const sucursal of catalogos().sucursales) {
    const visibles = planilla.filas.filter((f) => normalizar(f.sucursal) === normalizar(sucursal))
    assert.equal(visibles.length, 0, `filtrar por «${sucursal}» no devuelve nada`)
  }
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// La otra mitad del problema: la misma sucursal escrita de dos formas.
// ---------------------------------------------------------------------------

/** Dos consultas de la misma sucursal: una vino de la hoja («LANUS») y otra la cargó la app («Lanús»). */
function baseConDosGrafias(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const insertar = db.prepare(
    `INSERT INTO leads (fila_id, pestana, nombre, sucursal_texto, origen, estado, creado_en, actualizado_en)
     VALUES (?, 'APP LEADS', ?, ?, 'OTRO', 'NUEVO', '2026-08-01T10:00:00', '2026-08-01T10:00:00')`,
  )
  insertar.run('L-1', 'QUIROGA NATALIA', 'LANUS')
  insertar.run('L-2', 'SOSA MARTIN', 'Lanús')
  return db
}

test('el desplegable de sucursal no repite la misma sucursal escrita de dos formas', () => {
  baseConDosGrafias()
  const listado = listarLeads({ busqueda: '', estado: '', origen: '', sucursal: '', incluirCerrados: true })

  assert.equal(listado.sucursales.length, 1, '«LANUS» y «Lanús» son un solo local, no dos opciones')
  cerrarBaseDeDatos()
})

test('filtrar por sucursal encuentra las dos grafías, se elija la que se elija', () => {
  baseConDosGrafias()
  for (const elegida of ['LANUS', 'Lanús', 'lanus ']) {
    const listado = listarLeads({ busqueda: '', estado: '', origen: '', sucursal: elegida, incluirCerrados: true })
    assert.equal(listado.filas.length, 2, `elegir «${elegida}» trae las dos consultas de Lanús`)
    assert.equal(listado.porEstado.NUEVO, 2, 'los contadores cuentan lo mismo que el listado')
  }
  cerrarBaseDeDatos()
})

test('filtrar por otra sucursal sigue devolviendo vacío', () => {
  baseConDosGrafias()
  const listado = listarLeads({ busqueda: '', estado: '', origen: '', sucursal: 'Dock Sud', incluirCerrados: true })

  assert.equal(listado.filas.length, 0, 'normalizar no puede volver iguales a dos sucursales distintas')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Enganchar el texto de la planilla con el catálogo: la tilde de «Lanús».
// ---------------------------------------------------------------------------

test('«LANUS» de la planilla engancha con la sucursal «Lanús» del catálogo', () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  // UPPER() y COLLATE NOCASE de SQLite sólo suben el ASCII: UPPER('Lanús') es 'LANúS'. Resolver la
  // sucursal dentro del SQL dejaba a Lanús —la única de las tres con tilde— sin enganchar nunca.
  const comoLoHaciaElSql = db.prepare(`SELECT UPPER('Lanús') = 'LANUS' AS empata`).get() as { empata: number }
  assert.equal(comoLoHaciaElSql.empata, 0, 'en SQLite la comparación de Lanús falla: por eso se resuelve en JavaScript')

  const lanus = db.prepare(`SELECT id FROM sucursales WHERE nombre = 'Lanús'`).get() as { id: number }
  for (const escrito of ['LANUS', 'Lanús', 'lanus', ' Lanus ']) {
    assert.equal(idDeSucursalPorNombre(escrito), lanus.id, `«${escrito}» es la sucursal Lanús`)
  }

  // Las otras dos ya andaban, y tienen que seguir andando (incluida la forma pegada de la hoja).
  const dockSud = db.prepare(`SELECT id FROM sucursales WHERE nombre = 'Dock Sud'`).get() as { id: number }
  assert.equal(idDeSucursalPorNombre('DOCK SUD'), dockSud.id)
  assert.equal(idDeSucursalPorNombre('DOCKSUD'), dockSud.id)
  assert.equal(idDeSucursalPorNombre('QUILMES'), null, 'una sucursal que no existe sigue sin enganchar')
  assert.equal(idDeSucursalPorNombre(''), null)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// La caja del día de una computadora recién instalada.
// ---------------------------------------------------------------------------

/**
 * Un cobro como los que quedan después de instalar la aplicación en una sucursal nueva: entró por la
 * importación, así que no tiene `sucursal_cobro` —esa columna la escribe sólo la computadora que
 * cobró— ni `sucursal_texto` —la pestaña IMPUTADOS no tiene columna LOCAL—. Lo único que dice de qué
 * sucursal es, es el cliente.
 */
function baseConUnCobroImportado(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const { id } = db
    .prepare(
      `INSERT INTO clientes (clave, nombre, documento, sucursal_texto, creado_en, actualizado_en)
       VALUES ('C-1', 'PEREZ JUAN', '30111222', 'LANUS', '2026-08-01T09:00:00', '2026-08-01T09:00:00') RETURNING id`,
    )
    .get() as { id: number }
  db.prepare(
    `INSERT INTO pagos (fila_id, pestana, cliente_id, fecha, fecha_iso, cliente_nombre, importe, importe_monto,
                        medio, periodo, sucursal_texto, sucursal_cobro, creado_en, actualizado_en)
     VALUES ('P-1', 'IMPUTADOS', ?, '12/08/2026', '2026-08-12', 'PEREZ JUAN', '$ 15.000', 15000,
             'EFECTIVO', '2026-08', NULL, NULL, '2026-08-12T10:00:00', '2026-08-12T10:00:00')`,
  ).run(id)
  return db
}

test('un cobro importado cae en la sucursal de su cliente, no en «ninguna»', () => {
  baseConUnCobroImportado()

  const sinFiltro = cajaDelDia('2026-08-12', '')
  assert.equal(sinFiltro.pagos.length, 1, 'sin filtrar, el cobro está')
  assert.equal(sinFiltro.pagos[0]!.sucursal, 'LANUS', 'la sucursal sale del cliente cuando el cobro no la trae')
  cerrarBaseDeDatos()
})

test('la caja del día filtrada por Lanús encuentra ese cobro', () => {
  baseConUnCobroImportado()

  // Es lo que ve quien entra en la sucursal: la caja abre ya filtrada por la sucursal del usuario.
  const enLanus = cajaDelDia('2026-08-12', 'Lanús')
  assert.equal(enLanus.pagos.length, 1, 'elegir «Lanús» del desplegable tiene que encontrar el cobro de LANUS')
  assert.equal(enLanus.total, 15000, 'y el total de la caja lo incluye')

  const enDockSud = cajaDelDia('2026-08-12', 'Dock Sud')
  assert.equal(enDockSud.pagos.length, 0, 'y no se cuela en la caja de otra sucursal')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// La columna «Sucursal» en blanco en algunas computadoras y no en otras
// ---------------------------------------------------------------------------
//
// Lo que se vio: la planilla del mes con la columna «Sucursal» vacía en TODAS las filas de agosto en
// varias computadoras, y bien en la de Daniel. El resto de las columnas, normales.
//
// El caso real no es «la hoja no tiene la columna» —la hoja la tiene desde siempre— sino que la
// pestaña del mes NUEVO no la tiene: se arma duplicando la del mes anterior a mano, y ahí se pierde
// una columna sin que nadie se entere. Con eso solo se juntaban tres cosas:
//
//  1. el UPSERT de cuotas_mes pisaba `sucursal_texto` con NULL, porque el importador no distingue
//     «la pestaña no tiene la columna» de «la celda está vacía»;
//  2. el cliente —el respaldo de la fila— sólo aprende su sucursal de la planilla MÁS NUEVA, que es
//     justamente la que no la traía, así que el respaldo tampoco tenía nada;
//  3. y `SELECT_PLANILLA` elegía ese respaldo con un COALESCE pelado, que para SQL toma `''` como un
//     valor válido, de modo que una celda en blanco ganaba igual.
//
// La computadora que cerró el mes se salvaba porque las filas nuevas las había calculado ella misma y
// las tenía en su base; las demás importaban la pestaña y se quedaban en blanco. De ahí el «en algunas
// PC sí y en la mía no».
const CLIENTE_CON_SUCURSAL = 'Dock Sud'

/** Quien cierra el mes: sólo un superadministrador o un administrador puede. */
const DANIEL_SUPER: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

/** Saca la columna de sucursal de UNA pestaña: el mes nuevo duplicado a mano al que se le perdió. */
function sinSucursalEnLaPestana(pestanas: PestanaSimulada[], titulo: string): PestanaSimulada[] {
  return pestanas.map((pestana) => {
    if (pestana.titulo !== titulo) return pestana
    const [quitada] = sinColumnaDeSucursal([pestana])
    return quitada ?? pestana
  })
}

async function baseConAgostoSinSucursal() {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const resultado = await importar(db, new HojaSimulada(sinSucursalEnLaPestana(construirHojaDePrueba(), 'AGOSTO')))
  return { db, informe: resultado.informe }
}

test('la planilla del mes muestra la sucursal aunque a la pestaña más nueva le falte la columna', async () => {
  await baseConAgostoSinSucursal()
  const planilla = planillaDelMes(null)

  assert.ok(planilla.filas.length > 0, 'la planilla trae filas')
  const enBlanco = planilla.filas.filter((f) => (f.sucursal ?? '').trim() === '')
  // Suárez es el único que se queda sin sucursal, y es correcto que así sea: es un alta de AGOSTO, la
  // única pestaña que no trae la columna, así que NADIE en toda la hoja sabe de qué sucursal es. Lo que
  // el arreglo recupera es todo el resto, que antes también salía en blanco.
  assert.deepEqual(
    enBlanco.map((f) => f.nombre),
    [CLIENTES.suarez.nombre],
    'sólo queda en blanco el alta nueva de la pestaña sin columna; el resto lo sabe el cliente',
  )
  cerrarBaseDeDatos()
})

test('los meses viejos le enseñan al cliente de qué sucursal es', async () => {
  const { db } = await baseConAgostoSinSucursal()
  const sinSucursal = db
    .prepare(`SELECT nombre FROM clientes WHERE TRIM(COALESCE(sucursal_texto, '')) = '' ORDER BY nombre`)
    .all() as Array<{ nombre: string }>
  assert.deepEqual(
    sinSucursal.map((c) => c.nombre),
    [CLIENTES.suarez.nombre],
    'el cliente aprende su sucursal de cualquier mes que la traiga, no sólo del más nuevo',
  )

  // Y con el texto recuperado se engancha el id del catálogo, que es lo que usan los filtros por
  // sucursal. Sólo enganchan las tres sembradas: «SARANDI» y «BRENDA» no son del catálogo y quedan
  // como texto suelto, igual que antes.
  const gonzalez = db
    .prepare('SELECT sucursal_id, sucursal_texto FROM clientes WHERE nombre = ?')
    .get(CLIENTES.gonzalez.nombre) as { sucursal_id: number | null; sucursal_texto: string }
  assert.equal(gonzalez.sucursal_texto, CLIENTES.gonzalez.sucursal, 'recuperó el texto que traían los meses viejos')
  assert.ok(gonzalez.sucursal_id !== null, 'y quedó enganchado a «Dock Sud» del catálogo')
  cerrarBaseDeDatos()
})

/**
 * Una foto de la hoja simulada tal como quedó DESPUÉS de importar: con los _ID ya escritos. Sin esto, la
 * segunda importación no reconoce ninguna fila (el _ID es la clave del UPSERT), inserta todo de nuevo y
 * la prueba pasaría sin haber ejercitado el UPSERT, que es justamente lo que se quiere fijar.
 */
async function fotoDeLaHoja(hoja: HojaSimulada): Promise<PestanaSimulada[]> {
  const { pestanas } = await hoja.estructura()
  const lecturas = await hoja.leerVarias(pestanas.map((p) => p.titulo))
  return pestanas.map((p) => ({
    titulo: p.titulo,
    valores: lecturas.find((l) => l.titulo === p.titulo)?.valores ?? [],
  }))
}

test('importar con la pestaña más nueva sin columna de sucursal no borra la que ya estaba', async () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  // Primero la hoja entera, como la importó la computadora que sí veía las sucursales.
  const hoja = new HojaSimulada(construirHojaDePrueba())
  await importar(db, hoja)
  const antes = db
    .prepare(`SELECT COUNT(*) AS n FROM cuotas_mes WHERE pestana = 'AGOSTO' AND TRIM(COALESCE(sucursal_texto, '')) <> ''`)
    .get() as { n: number }
  assert.ok(antes.n > 0, 'la primera importación dejó las filas de agosto con sucursal')

  // Y ahora la MISMA hoja (con sus _ID ya escritos) a la que se le perdió la columna de agosto: es lo
  // que pasa cuando el mes nuevo se arma duplicando el anterior a mano y se borra una columna de más.
  const segunda = new HojaSimulada(sinSucursalEnLaPestana(await fotoDeLaHoja(hoja), 'AGOSTO'))
  await importar(db, segunda)
  const despues = db
    .prepare(`SELECT COUNT(*) AS n FROM cuotas_mes WHERE pestana = 'AGOSTO' AND TRIM(COALESCE(sucursal_texto, '')) <> ''`)
    .get() as { n: number }
  assert.equal(despues.n, antes.n, 'una pestaña que no tiene la columna no puede borrar lo que ya se sabía')
  cerrarBaseDeDatos()
})

test('el informe avisa que a la planilla mensual le falta la columna de sucursal', async () => {
  const { informe } = await baseConAgostoSinSucursal()
  const avisos = informe.problemas.filter((p) => p.tipo === 'columna de sucursal no encontrada')
  assert.ok(
    avisos.some((p) => p.pestana === 'AGOSTO'),
    'el informe de importación dice cuál es la pestaña a la que le falta LOCAL',
  )
  cerrarBaseDeDatos()
})

test('una celda de sucursal en blanco cae en la sucursal del cliente, no en «ninguna»', async () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(construirHojaDePrueba()))

  // Una fila cuya celda LOCAL quedó vacía (no NULL: vacía, que es lo que escribe una hoja). Para SQL
  // `''` no es NULL, así que el COALESCE pelado la tomaba como respuesta y devolvía el blanco.
  const fila = db
    .prepare(`SELECT fila_id, cliente_id FROM cuotas_mes WHERE pestana = 'AGOSTO' AND cliente_id IS NOT NULL LIMIT 1`)
    .get() as { fila_id: string; cliente_id: number }
  db.prepare(`UPDATE clientes SET sucursal_texto = ? WHERE id = ?`).run(CLIENTE_CON_SUCURSAL, fila.cliente_id)
  db.prepare(`UPDATE cuotas_mes SET sucursal_texto = '   ' WHERE fila_id = ?`).run(fila.fila_id)

  const planilla = planillaDelMes(null)
  const vista = planilla.filas.find((f) => f.filaId === fila.fila_id)
  assert.ok(vista, 'la fila sigue en la planilla')
  assert.equal(vista.sucursal, CLIENTE_CON_SUCURSAL, 'una celda en blanco no manda sobre lo que sabe el cliente')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// La reparación de las bases que ya se vaciaron
// ---------------------------------------------------------------------------
//
// Arreglar el importador no alcanza: las computadoras que ya perdieron la sucursal no la recuperan
// solas. La sincronización sólo aplica lo que CAMBIÓ en la hoja, y la sucursal en la hoja no cambió
// nunca, así que la fila se saltea por huella para siempre. La migración 14 la recupera de lo que la
// propia base todavía sabe: los meses anteriores del mismo cliente.

/** Una base como la de una PC rota: al día hasta la 13, con los clientes sin sucursal. */
function baseRotaHastaLa13(): BaseDeDatos {
  const db = new Database(':memory:') as BaseDeDatos
  db.pragma('foreign_keys = ON')
  for (const migracion of [...MIGRACIONES].sort((a, b) => a.version - b.version)) {
    if (migracion.version > 13) break
    db.exec(migracion.sql)
    db.pragma('user_version = ' + migracion.version)
  }
  const registrar = console.log
  console.log = () => undefined
  try {
    sembrarDatosIniciales(db)
  } finally {
    console.log = registrar
  }
  const ahora = '2026-08-28T00:00:00.000Z'
  db.prepare(
    `INSERT INTO clientes (id, clave, nombre, documento, sucursal_id, sucursal_texto, creado_en, actualizado_en)
     VALUES (1, 'doc:27345678', 'GONZALEZ MARIA LAURA', '27345678', NULL, NULL, ?, ?)`,
  ).run(ahora, ahora)
  // Julio todavía tiene la sucursal; agosto la perdió cuando se importó la pestaña sin la columna.
  const cuota = db.prepare(
    `INSERT INTO cuotas_mes (fila_id, periodo, pestana, cliente_id, cliente_nombre, sucursal_texto, creado_en, actualizado_en)
     VALUES (@fila_id, @periodo, @pestana, 1, 'GONZALEZ MARIA LAURA', @sucursal, @ahora, @ahora)`,
  )
  cuota.run({ fila_id: 'f-julio', periodo: '2026-07', pestana: 'JULIO', sucursal: 'DOCK SUD', ahora })
  cuota.run({ fila_id: 'f-agosto', periodo: '2026-08', pestana: 'AGOSTO', sucursal: null, ahora })
  return db
}

test('la migración le devuelve la sucursal a los clientes a los que se les había borrado', () => {
  const db = baseRotaHastaLa13()
  assert.equal(db.pragma('user_version', { simple: true }), 13, 'la base arranca como una PC sin actualizar')

  const registrar = console.log
  console.log = () => undefined
  try {
    ejecutarMigraciones(db)
  } finally {
    console.log = registrar
  }

  const cliente = db.prepare('SELECT sucursal_texto, sucursal_id FROM clientes WHERE id = 1').get() as {
    sucursal_texto: string | null
    sucursal_id: number | null
  }
  assert.equal(cliente.sucursal_texto, 'DOCK SUD', 'la recuperó del mes que todavía la tenía')
  assert.ok(cliente.sucursal_id !== null, 'y volvió a engancharse al catálogo, que es lo que usa el filtro')
  db.close()
})

test('la migración no pisa una sucursal que ya estaba cargada', () => {
  const db = baseRotaHastaLa13()
  db.prepare(`UPDATE clientes SET sucursal_texto = 'Lanús' WHERE id = 1`).run()

  const registrar = console.log
  console.log = () => undefined
  try {
    ejecutarMigraciones(db)
  } finally {
    console.log = registrar
  }

  const cliente = db.prepare('SELECT sucursal_texto FROM clientes WHERE id = 1').get() as { sucursal_texto: string }
  assert.equal(cliente.sucursal_texto, 'Lanús', 'sólo rellena huecos: nunca corrige una carga a mano')
  db.close()
})

test('cerrar el mes arrastra la sucursal resuelta, no el hueco de la fila', async () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(construirHojaDePrueba()))

  // Una fila de agosto sin sucursal propia, con el cliente que sí la sabe: es como quedan las filas en
  // una computadora que importó una pestaña sin la columna LOCAL.
  const fila = db
    .prepare(`SELECT fila_id, cliente_id FROM cuotas_mes WHERE pestana = 'AGOSTO' AND cliente_id IS NOT NULL LIMIT 1`)
    .get() as { fila_id: string; cliente_id: number }
  db.prepare(`UPDATE clientes SET sucursal_texto = ? WHERE id = ?`).run(CLIENTE_CON_SUCURSAL, fila.cliente_id)
  db.prepare(`UPDATE cuotas_mes SET sucursal_texto = NULL WHERE fila_id = ?`).run(fila.fila_id)

  cerrarMes(DANIEL_SUPER)

  const nueva = db
    .prepare(
      `SELECT sucursal_texto FROM cuotas_mes
        WHERE cliente_id = ? AND periodo = (SELECT MAX(periodo) FROM cuotas_mes)
        LIMIT 1`,
    )
    .get(fila.cliente_id) as { sucursal_texto: string | null } | undefined

  assert.ok(nueva, 'el mes nuevo tiene la fila de ese cliente')
  assert.equal(
    nueva.sucursal_texto,
    CLIENTE_CON_SUCURSAL,
    'el mes nuevo nace con la sucursal del cliente: si copiara el hueco, lo publicaría en la hoja de todos',
  )
  cerrarBaseDeDatos()
})
