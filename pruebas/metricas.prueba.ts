// Métricas y Estadísticas: los números que la agencia compara contra CONTADOR y SEGUROS ACT. Lo que
// se prueba acá es sobre todo que los DUPLICADOS no los tuerzan: una póliza dos veces en la planilla
// (lo que dejaban las carreras de la sincronización) cuenta una sola vez, y sin mes anterior las altas
// son «no se sabe», no cero.
import assert from 'node:assert/strict'
import test from 'node:test'
import { usarBaseDeDatos } from '../src/main/db/base'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { darDeBaja, periodosDisponibles, planillaDelMes } from '../src/main/servicios/cartera'
import { estadisticasDeCartera, podioDelMes, tableroDeMetricas } from '../src/main/servicios/metricas'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import type { SesionUsuario } from '../src/shared/tipos'

const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 4, nombre: 'Daniel' }, debeCambiarClave: false }
import { baseDePrueba, contar, importar } from './ayuda'

async function baseImportada() {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  await importar(db, hoja)
  usarBaseDeDatos(db)
  return { db, hoja }
}

/** Copia una cuota con otro _ID: lo que dejaba la sincronización cuando dos computadoras se pisaban. */
function duplicarCuota(db: ReturnType<typeof baseDePrueba>, nombre: string): string {
  const original = db.prepare(`SELECT fila_id FROM cuotas_mes WHERE periodo = '2026-08' AND cliente_nombre = ?`).get(nombre) as { fila_id: string }
  const copia = `${original.fila_id}COPIA`
  const ahora = ahoraIso()
  db.prepare(
    `INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania,
                             numero_poliza, patente, sucursal_texto, cuota, cuota_monto, dia_vencimiento,
                             dia_vencimiento_numero, aviso, pago, pago_fecha, observaciones, forma_pago, creado_en, actualizado_en)
     SELECT ?, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania,
            numero_poliza, patente, sucursal_texto, cuota, cuota_monto, dia_vencimiento,
            dia_vencimiento_numero, aviso, pago, pago_fecha, observaciones, forma_pago, ?, ?
       FROM cuotas_mes WHERE fila_id = ?`,
  ).run(copia, ahora, ahora, original.fila_id)
  return copia
}

test('activos, altas y bajas de agosto salen de la planilla como los contaría el contador', async () => {
  const { db } = await baseImportada()
  const tablero = tableroDeMetricas({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(tablero.periodo, '2026-08')
  assert.equal(tablero.hayMesAnterior, true)
  assert.equal(tablero.activos, contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 0`), 'una fila por póliza en agosto')
  // Suárez es la única alta de agosto: está en AGOSTO y no estaba en JULIO.
  assert.equal(tablero.altas, 1)
  const estadisticas = estadisticasDeCartera('2026-08', [], true)
  assert.equal(estadisticas.totales.activos, tablero.activos)
  assert.equal(estadisticas.totales.altas, 1)
  assert.equal(estadisticas.totales.bajas, tablero.bajas)
  db.close()
})

test('una póliza repetida en la planilla cuenta una sola vez en activos, altas y estadísticas', async () => {
  const { db } = await baseImportada()
  const antes = tableroDeMetricas({ periodo: '2026-08', sucursales: [] }, true)
  duplicarCuota(db, CLIENTES.suarez.nombre)
  duplicarCuota(db, CLIENTES.lopez.nombre)
  assert.equal(contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 0`), antes.activos + 2, 'la base tiene dos renglones de más')

  const despues = tableroDeMetricas({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(despues.activos, antes.activos, 'activos no cambia: cada póliza cuenta una vez')
  assert.equal(despues.altas, antes.altas, 'ni las altas: Suárez sigue siendo una sola alta')
  assert.deepEqual(despues.activosPorCompania, antes.activosPorCompania)
  const evolucionAgosto = despues.evolucion.find((mes) => mes.periodo === '2026-08')!
  assert.equal(evolucionAgosto.activos, antes.activos)
  assert.equal(evolucionAgosto.altas, antes.altas)

  const estadisticas = estadisticasDeCartera('2026-08', [], true)
  assert.equal(estadisticas.totales.activos, antes.activos)
  assert.equal(estadisticas.totales.altas, antes.altas)
  db.close()
})

test('una baja repetida (misma póliza, mismo mes) cuenta una sola vez', async () => {
  const { db } = await baseImportada()
  const lopez = planillaDelMes('2026-08').filas.find((f) => f.nombre === CLIENTES.lopez.nombre)!
  darDeBaja(lopez.filaId, { motivo: 'VENDIO', nota: '' }, DANIEL)
  const antes = tableroDeMetricas({ periodo: '2026-08', sucursales: [] }, true)
  assert.ok(antes.bajas >= 1)

  // La misma baja anotada dos veces, con otro _ID: lo que dejaba la sincronización cuando dos
  // computadoras daban de baja la misma póliza.
  const baja = db.prepare(`SELECT * FROM bajas WHERE fila_id = ?`).get(`BAJA:${lopez.filaId}`) as Record<string, unknown>
  assert.ok(baja.poliza_id !== null, 'la baja está enlazada a su póliza')
  const columnas = Object.keys(baja).filter((c) => c !== 'id')
  db.prepare(`INSERT INTO bajas (${columnas.join(', ')}) VALUES (${columnas.map((c) => `@${c}`).join(', ')})`).run({ ...baja, fila_id: 'BAJA:copia-de-prueba', hecha_en_la_app: 0 })
  assert.equal(contar(db, 'bajas', `periodo = '2026-08'`), antes.bajas + 1, 'la base tiene un renglón de más')

  const despues = tableroDeMetricas({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(despues.bajas, antes.bajas, 'la misma póliza no es dos bajas')
  assert.deepEqual(despues.bajasPorMotivo, antes.bajasPorMotivo)
  assert.equal(despues.activos, antes.activos, 'y López tampoco vuelve a los activos')
  assert.equal(estadisticasDeCartera('2026-08', [], true).totales.bajas, antes.bajas)
  db.close()
})

test('sin mes anterior cargado las altas son «no se sabe» (null), nunca cero', async () => {
  const { db } = await baseImportada()
  const primero = periodosDisponibles().map((p) => p.periodo).sort()[0]!
  const tablero = tableroDeMetricas({ periodo: primero, sucursales: [] }, true)
  assert.equal(tablero.hayMesAnterior, false)
  assert.equal(tablero.altas, null)
  assert.ok(tablero.activos > 0)
  const evolucion = tablero.evolucion.find((mes) => mes.periodo === primero)!
  assert.equal(evolucion.altas, null, 'en la evolución también')
  const estadisticas = estadisticasDeCartera(primero, [], true)
  assert.equal(estadisticas.hayMesAnterior, false)
  assert.equal(estadisticas.totales.altas, null)
  for (const fila of estadisticas.porCompania) assert.equal(fila.altas, null)
  db.close()
})

test('el podio del mes ordena las sucursales por altas, sin la fila «(sin sucursal)» y sin plata', async () => {
  const { db } = await baseImportada()
  const estadisticas = estadisticasDeCartera('2026-08', [], false)
  const podio = podioDelMes()

  assert.equal(podio.periodo, estadisticas.periodo, 'el podio mira el mismo período que Estadísticas por defecto')
  assert.equal(podio.hayMesAnterior, estadisticas.hayMesAnterior)
  assert.ok(podio.ranking.every((fila) => fila.etiqueta !== '(sin sucursal)'), 'la fila sin sucursal no compite')

  // Las mismas sucursales de estadisticasDeCartera, sólo reordenadas para el podio.
  const porNombre = (filas: typeof podio.ranking) => [...filas].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'))
  assert.deepEqual(
    porNombre(podio.ranking),
    porNombre(estadisticas.porSucursal.filter((fila) => fila.etiqueta !== '(sin sucursal)')),
  )

  // De mayor a menor altas, que es la carrera que pidió el cliente.
  for (let i = 1; i < podio.ranking.length; i++) {
    assert.ok((podio.ranking[i - 1]!.altas ?? 0) >= (podio.ranking[i]!.altas ?? 0), 'cada fila trae igual o más altas que la siguiente')
  }

  // Es competencia por altas y bajas, no por plata: nunca trae cobrado.
  for (const fila of podio.ranking) assert.equal(fila.cobrado, null)
  db.close()
})
