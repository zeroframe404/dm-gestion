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
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { catalogos, planillaDelMes } from '../src/main/servicios/cartera'
import { cajaDelDia } from '../src/main/servicios/cobranzas'
import { listarLeads } from '../src/main/servicios/leads'
import { idDeSucursalPorNombre } from '../src/main/servicios/sucursales'
import { construirHojaDePrueba } from './hoja-de-prueba'
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
