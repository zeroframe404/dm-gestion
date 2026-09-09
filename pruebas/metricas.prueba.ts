// Métricas y Estadísticas: los números que la agencia compara contra CONTADOR y SEGUROS ACT. Lo que
// se prueba acá es sobre todo que los DUPLICADOS no los tuerzan: una póliza dos veces en la planilla
// (lo que dejaban las carreras de la sincronización) cuenta una sola vez, y sin mes anterior las altas
// son «no se sabe», no cero.
//
// Y, desde la 13.0.1, que una RENOVACIÓN NO SEA UN ALTA: era lo que le inflaba el podio a Dock Sud
// —la sucursal más grande y la que más renueva— con más de cien altas en un mes en el que no había
// entrado casi nadie.
import assert from 'node:assert/strict'
import test from 'node:test'
import { usarBaseDeDatos } from '../src/main/db/base'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { darDeBaja, periodosDisponibles, planillaDelMes } from '../src/main/servicios/cartera'
import { altasDelMes, estadisticasDeCartera, podioDelMes, tableroDeMetricas } from '../src/main/servicios/metricas'
import { listarPolizas } from '../src/main/servicios/polizas'
import { datosSugeridosDeRenovacion, renovar } from '../src/main/servicios/renovaciones'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import type { FiltrosPolizas, PolizaDeCliente, SesionUsuario } from '../src/shared/tipos'

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

// ---------------------------------------------------------------------------
// Renovar no es dar de alta (13.0.1)
// ---------------------------------------------------------------------------

const SIN_FILTROS_DE_POLIZA: FiltrosPolizas = { busqueda: '', estados: [], companias: [], sucursales: [], coberturas: [], ramas: [] }

function polizaDe(numero: string): PolizaDeCliente {
  const encontrada = listarPolizas({ ...SIN_FILTROS_DE_POLIZA, busqueda: numero }).filas[0]
  if (!encontrada) throw new Error(`No está la póliza ${numero}`)
  return encontrada
}

/** Las altas de una sucursal en el podio, que es donde el cliente vio el número mal. */
function altasEnElPodio(sucursal: string): number | null {
  const fila = podioDelMes().ranking.find((f) => f.etiqueta === sucursal)
  if (!fila) throw new Error(`El podio no trae a ${sucursal}`)
  return fila.altas
}

test('renovar una póliza NO es un alta: es la misma línea de cartera que sigue', async () => {
  const { db } = await baseImportada()
  // González es de Dock Sud y está en JULIO y en AGOSTO: renovarla no puede convertirla en un alta de
  // agosto, porque la clienta ya estaba. AGOSTO es el mes abierto, así que la fila nueva cae ahí.
  const antesActivos = estadisticasDeCartera('2026-08', [], true).totales.activos
  const antesAltas = altasEnElPodio('Dock Sud')

  const original = polizaDe(CLIENTES.gonzalez.poliza)
  // Con el MISMO número, que es lo normal: ahí la póliza nueva le saca la clave a la vieja y la vieja
  // pasa a ser «ANTERIOR:…». Era el caso que garantizaba un alta fantasma en todas las renovaciones.
  renovar(original.id, { ...datosSugeridosDeRenovacion(original.id), numero: CLIENTES.gonzalez.poliza }, DANIEL)

  const despues = estadisticasDeCartera('2026-08', [], true)
  assert.equal(despues.totales.activos, antesActivos, 'la cartera no creció: la fila vieja salió y entró la nueva')
  assert.equal(altasEnElPodio('Dock Sud'), antesAltas, 'y el podio de Dock Sud no se movió: renovar no es un alta')
  assert.equal(despues.totales.bajas, estadisticasDeCartera('2026-08', [], true).totales.bajas, 'tampoco es una baja')
  db.close()
})

test('renovar con OTRO número de póliza tampoco es un alta', async () => {
  const { db } = await baseImportada()
  const antes = altasEnElPodio('Dock Sud')
  const original = polizaDe(CLIENTES.gonzalez.poliza)

  // Hay compañías que al renovar cambian el número. La póliza nueva nace con otra clave y, sin seguir
  // la cadena de renovaciones, no se parecía en nada a la de julio.
  renovar(original.id, { ...datosSugeridosDeRenovacion(original.id), numero: `${CLIENTES.gonzalez.poliza}-R` }, DANIEL)

  assert.equal(altasEnElPodio('Dock Sud'), antes, 'el número cambió, la clienta no')
  db.close()
})

test('renovar dejando la anterior ACTIVA sí suma un alta: son dos pólizas vivas', async () => {
  const { db } = await baseImportada()
  const antesActivos = estadisticasDeCartera('2026-08', [], true).totales.activos
  const antes = altasEnElPodio('Dock Sud')
  const original = polizaDe(CLIENTES.gonzalez.poliza)

  renovar(
    original.id,
    { ...datosSugeridosDeRenovacion(original.id), numero: `${CLIENTES.gonzalez.poliza}-B`, destinoDeLaAnterior: 'activa' },
    DANIEL,
  )

  // Acá la planilla del mes queda con las dos filas a propósito, así que la cartera SÍ creció en una y
  // las altas tienen que acompañar: si no, activos y altas contarían cosas distintas.
  assert.equal(estadisticasDeCartera('2026-08', [], true).totales.activos, antesActivos + 1, 'quedan las dos vigentes')
  assert.equal(altasEnElPodio('Dock Sud'), (antes ?? 0) + 1, 'la segunda fila de la misma línea sí es un alta')
  db.close()
})

// ---------------------------------------------------------------------------
// La renovación hecha en OTRA computadora (13.0.2, issue #79)
// ---------------------------------------------------------------------------

/**
 * Lo que ve la computadora que NO apretó «Renovar»: la fila de AGOSTO le llega por la hoja con lo que
 * cambió (el número, la compañía, la patente…) y sin ninguna cadena de renovaciones. Se arma la hoja
 * con la fila de González de AGOSTO ya cambiada y se importa desde cero, que es exactamente eso.
 */
async function baseConGonzalezCambiadaEnAgosto(cambios: Record<string, string>) {
  const pestanas = construirHojaDePrueba()
  const agosto = pestanas.find((p) => p.titulo === 'AGOSTO')
  if (!agosto) throw new Error('La hoja de prueba no tiene AGOSTO')
  const encabezados = agosto.valores[0]!
  const fila = agosto.valores.find((valores) => valores[encabezados.indexOf('APELLIDO Y NOMBRE')] === CLIENTES.gonzalez.nombre)
  if (!fila) throw new Error('González no está en AGOSTO')
  for (const [columna, valor] of Object.entries(cambios)) {
    const indice = encabezados.indexOf(columna)
    if (indice < 0) throw new Error(`AGOSTO no tiene la columna ${columna}`)
    fila[indice] = valor
  }
  const hoja = new HojaSimulada(pestanas)
  const db = baseDePrueba()
  await importar(db, hoja)
  usarBaseDeDatos(db)
  return db
}

test('la renovación con número nuevo hecha en OTRA computadora tampoco es un alta: se reconoce por lo escrito', async () => {
  // Sin cadena que seguir, la fila de agosto de González trae otro número y la misma patente que la de
  // julio. Antes esta máquina la contaba como alta y el podio de Dock Sud no coincidía con el de la
  // computadora que renovó.
  const db = await baseConGonzalezCambiadaEnAgosto({ 'NRO DE POLIZA': `${CLIENTES.gonzalez.poliza}-R` })
  const sinCadena = db.prepare('SELECT COUNT(*) AS n FROM polizas WHERE poliza_anterior_id IS NOT NULL').get() as { n: number }
  assert.equal(sinCadena.n, 0, 'la prueba vale porque acá no hay ninguna cadena de renovaciones')

  assert.equal(altasEnElPodio('Dock Sud'), 1, 'la única alta de Dock Sud sigue siendo Suárez')
  assert.equal(estadisticasDeCartera('2026-08', [], true).totales.altas, 1, 'y Estadísticas cuenta lo mismo')
  const detalle = altasDelMes('2026-08', 'Dock Sud')
  assert.deepEqual(
    detalle.filas.map((f) => f.cliente),
    [CLIENTES.suarez.nombre],
    'González no está en la lista: es la renovación, no un alta',
  )
  db.close()
})

test('cambiar de vehículo SÍ es un alta; cambiar de compañía con el mismo auto, no', async () => {
  // Otro auto en la misma compañía: es otro riesgo, la póliza del auto viejo se fue y entró una nueva.
  const otroAuto = await baseConGonzalezCambiadaEnAgosto({ DOMINIO: 'AG333NN', 'NRO DE POLIZA': '3030303' })
  assert.equal(altasEnElPodio('Dock Sud'), 2, 'Suárez y el auto nuevo de González')
  otroAuto.close()

  // Otra compañía con el mismo auto: la misma patente sigue asegurada, la cartera no creció. Es además
  // lo que ve una computadora instalada de cero, que engancha julio por la patente: las dos tienen que
  // contar lo mismo.
  const otraCompania = await baseConGonzalezCambiadaEnAgosto({ COMPAÑIA: 'ZURICH', 'NRO DE POLIZA': '2020202' })
  assert.equal(altasEnElPodio('Dock Sud'), 1, 'sólo Suárez: González cambió de compañía, no entró')
  otraCompania.close()
})

test('el podio dice de cuándo son sus números', async () => {
  const { db } = await baseImportada()
  const podio = podioDelMes()
  assert.equal(podio.periodo, '2026-08')
  assert.equal(podio.periodoAnterior, '2026-07', 'contra qué mes se compararon las altas')
  assert.ok(!Number.isNaN(new Date(podio.calculadoEn).getTime()), 'calculadoEn es un instante ISO')
  assert.ok(Date.now() - new Date(podio.calculadoEn).getTime() < 60_000, 'y es de recién')
  // Superada (13.2): el campo ya no puede ser null (ver PodioMensual en shared/tipos.ts), así que acá
  // alcanza con que sea un instante ISO válido, igual que calculadoEn.
  assert.ok(!Number.isNaN(new Date(podio.recibidoEnEstaComputadora).getTime()), 'recibidoEnEstaComputadora es un instante ISO')
  db.close()
})

// ---------------------------------------------------------------------------
// El detalle del podio: qué pólizas son esas altas
// ---------------------------------------------------------------------------

test('el detalle de cada sucursal suma exactamente lo que dice su tarjeta del podio', async () => {
  const { db } = await baseImportada()
  const podio = podioDelMes()
  assert.ok(podio.ranking.length > 0, 'hay podio que mirar')

  // Es la garantía que hace útil al detalle: si la lista no suma el número de la tarjeta, el detalle no
  // sirve para controlar nada. Por eso sale de las mismas filas y por eso se prueba sucursal por sucursal.
  for (const fila of podio.ranking) {
    const detalle = altasDelMes(podio.periodo, fila.etiqueta)
    assert.equal(detalle.filas.length, fila.altas ?? 0, `${fila.etiqueta}: la lista tiene que sumar lo que dice la tarjeta`)
    assert.equal(detalle.periodo, podio.periodo)
    assert.ok(
      detalle.filas.every((alta) => alta.sucursal === fila.etiqueta),
      `${fila.etiqueta}: no se cuela ninguna fila de otra sucursal`,
    )
  }
  db.close()
})

test('sin sucursal, el detalle trae todas las altas del mes, incluidas las que no tienen sucursal', async () => {
  const { db } = await baseImportada()
  const estadisticas = estadisticasDeCartera('2026-08', [], false)
  const detalle = altasDelMes('2026-08', null)
  assert.equal(detalle.sucursal, null)
  assert.equal(detalle.filas.length, estadisticas.totales.altas, 'el total del detalle es el total de Estadísticas')

  // Y trae con qué reconocer cada póliza en la planilla: un listado sin el número ni la patente no se
  // puede mirar contra la hoja, que es para lo único que existe.
  const suarez = detalle.filas.find((alta) => alta.cliente === CLIENTES.suarez.nombre)
  assert.ok(suarez, 'Suárez es el alta de agosto y tiene que estar')
  assert.equal(suarez.numeroPoliza, CLIENTES.suarez.poliza)
  assert.equal(suarez.patente, CLIENTES.suarez.patente)
  assert.equal(suarez.compania, CLIENTES.suarez.cia)
  db.close()
})

test('una póliza renovada no aparece en el detalle de altas', async () => {
  const { db } = await baseImportada()
  const antes = altasDelMes('2026-08', 'Dock Sud')
  assert.ok(!antes.filas.some((alta) => alta.cliente === CLIENTES.gonzalez.nombre), 'González no era un alta antes de renovar')

  const original = polizaDe(CLIENTES.gonzalez.poliza)
  renovar(original.id, { ...datosSugeridosDeRenovacion(original.id), numero: `${CLIENTES.gonzalez.poliza}-R` }, DANIEL)

  const despues = altasDelMes('2026-08', 'Dock Sud')
  assert.equal(despues.filas.length, antes.filas.length, 'renovar no agrega una fila al detalle')
  assert.ok(!despues.filas.some((alta) => alta.cliente === CLIENTES.gonzalez.nombre), 'y González sigue sin estar')
  // El detalle y la tarjeta siguen cerrando después de renovar, que es cuando antes se despegaban.
  const enElPodio = podioDelMes().ranking.find((f) => f.etiqueta === 'Dock Sud')
  assert.equal(despues.filas.length, enElPodio?.altas ?? 0)
  db.close()
})

test('con dos pólizas vivas de la misma línea, el detalle lista sólo la que es alta', async () => {
  const { db } = await baseImportada()
  const antes = altasDelMes('2026-08', 'Dock Sud')
  const original = polizaDe(CLIENTES.gonzalez.poliza)

  // El caso incómodo: la línea de González queda con DOS filas vivas en agosto y sólo una de las dos es
  // alta. Es donde el detalle y la tarjeta se pueden despegar más fácil, porque hay que elegir cuál de
  // las dos filas es la que cuenta y las dos cuentas tienen que elegir la misma.
  renovar(
    original.id,
    { ...datosSugeridosDeRenovacion(original.id), numero: `${CLIENTES.gonzalez.poliza}-B`, destinoDeLaAnterior: 'activa' },
    DANIEL,
  )

  const despues = altasDelMes('2026-08', 'Dock Sud')
  const enElPodio = podioDelMes().ranking.find((f) => f.etiqueta === 'Dock Sud')
  assert.equal(despues.filas.length, antes.filas.length + 1, 'la cartera creció en una y el detalle lo muestra')
  assert.equal(despues.filas.length, enElPodio?.altas ?? 0, 'y la lista sigue sumando lo que dice la tarjeta')
  assert.equal(
    despues.filas.filter((alta) => alta.cliente === CLIENTES.gonzalez.nombre).length,
    1,
    'González aparece UNA vez: tiene dos pólizas vivas, pero una sola es el alta',
  )
  db.close()
})

test('sin mes anterior cargado el detalle va vacío, no con la cartera entera adentro', async () => {
  const { db } = await baseImportada()
  const primero = periodosDisponibles().map((p) => p.periodo).sort()[0]!
  const detalle = altasDelMes(primero, null)
  assert.equal(detalle.hayMesAnterior, false)
  assert.equal(detalle.filas.length, 0, 'sin con qué comparar no hay altas que listar')
  db.close()
})
