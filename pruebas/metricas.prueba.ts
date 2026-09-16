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
import { ahoraIso, normalizarTexto } from '../src/main/importacion/normalizar'
import { darDeBaja, periodosDisponibles, planillaDelMes } from '../src/main/servicios/cartera'
import { altasDelMes, estadisticasDeCarteraLocal, podioDelMes, tableroDeMetricasLocal } from '../src/main/servicios/metricas'
import { listarPolizas } from '../src/main/servicios/polizas'
import { datosSugeridosDeRenovacion, renovar } from '../src/main/servicios/renovaciones'
import { campoDeRama } from '../src/shared/riesgos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { RAMAS_DE_METRICA, type FiltrosPolizas, type PolizaDeCliente, type SesionUsuario } from '../src/shared/tipos'

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
  const tablero = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(tablero.periodo, '2026-08')
  assert.equal(tablero.hayMesAnterior, true)
  // Más los dos riesgos varios de la pestaña RIESGOS VARIOS: no tienen fechas, así que están vigentes todos los meses.
  assert.equal(
    tablero.activos,
    contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 0`) + contar(db, 'riesgos_varios'),
    'una fila por póliza en agosto, más los riesgos varios vigentes',
  )
  // Suárez es la única alta de agosto: está en AGOSTO y no estaba en JULIO.
  assert.equal(tablero.altas, 1)
  const estadisticas = estadisticasDeCarteraLocal('2026-08', [], true)
  assert.equal(estadisticas.totales.activos, tablero.activos)
  assert.equal(estadisticas.totales.altas, 1)
  assert.equal(estadisticas.totales.bajas, tablero.bajas)
  db.close()
})

test('una póliza repetida en la planilla cuenta una sola vez en activos, altas y estadísticas', async () => {
  const { db } = await baseImportada()
  const antes = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  duplicarCuota(db, CLIENTES.suarez.nombre)
  duplicarCuota(db, CLIENTES.lopez.nombre)
  // `activos` suma también los riesgos varios de la pestaña RIESGOS VARIOS, que no están en `cuotas_mes`.
  assert.equal(
    contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 0`) + contar(db, 'riesgos_varios'),
    antes.activos + 2,
    'la base tiene dos renglones de más',
  )

  const despues = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(despues.activos, antes.activos, 'activos no cambia: cada póliza cuenta una vez')
  assert.equal(despues.altas, antes.altas, 'ni las altas: Suárez sigue siendo una sola alta')
  assert.deepEqual(despues.activosPorCompania, antes.activosPorCompania)
  const evolucionAgosto = despues.evolucion.find((mes) => mes.periodo === '2026-08')!
  assert.equal(evolucionAgosto.activos, antes.activos)
  assert.equal(evolucionAgosto.altas, antes.altas)

  const estadisticas = estadisticasDeCarteraLocal('2026-08', [], true)
  assert.equal(estadisticas.totales.activos, antes.activos)
  assert.equal(estadisticas.totales.altas, antes.altas)
  db.close()
})

test('una baja repetida (misma póliza, mismo mes) cuenta una sola vez', async () => {
  const { db } = await baseImportada()
  const lopez = planillaDelMes('2026-08').filas.find((f) => f.nombre === CLIENTES.lopez.nombre)!
  darDeBaja(lopez.filaId, { motivo: 'VENDIO', nota: '' }, DANIEL)
  const antes = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.ok(antes.bajas >= 1)

  // La misma baja anotada dos veces, con otro _ID: lo que dejaba la sincronización cuando dos
  // computadoras daban de baja la misma póliza.
  const baja = db.prepare(`SELECT * FROM bajas WHERE fila_id = ?`).get(`BAJA:${lopez.filaId}`) as Record<string, unknown>
  assert.ok(baja.poliza_id !== null, 'la baja está enlazada a su póliza')
  const columnas = Object.keys(baja).filter((c) => c !== 'id')
  db.prepare(`INSERT INTO bajas (${columnas.join(', ')}) VALUES (${columnas.map((c) => `@${c}`).join(', ')})`).run({ ...baja, fila_id: 'BAJA:copia-de-prueba', hecha_en_la_app: 0 })
  assert.equal(contar(db, 'bajas', `periodo = '2026-08'`), antes.bajas + 1, 'la base tiene un renglón de más')

  const despues = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(despues.bajas, antes.bajas, 'la misma póliza no es dos bajas')
  assert.deepEqual(despues.bajasPorMotivo, antes.bajasPorMotivo)
  assert.equal(despues.activos, antes.activos, 'y López tampoco vuelve a los activos')
  assert.equal(estadisticasDeCarteraLocal('2026-08', [], true).totales.bajas, antes.bajas)
  db.close()
})

test('sin mes anterior cargado las altas son «no se sabe» (null), nunca cero', async () => {
  const { db } = await baseImportada()
  const primero = periodosDisponibles().map((p) => p.periodo).sort()[0]!
  const tablero = tableroDeMetricasLocal({ periodo: primero, sucursales: [] }, true)
  assert.equal(tablero.hayMesAnterior, false)
  assert.equal(tablero.altas, null)
  assert.ok(tablero.activos > 0)
  const evolucion = tablero.evolucion.find((mes) => mes.periodo === primero)!
  assert.equal(evolucion.altas, null, 'en la evolución también')
  const estadisticas = estadisticasDeCarteraLocal(primero, [], true)
  assert.equal(estadisticas.hayMesAnterior, false)
  assert.equal(estadisticas.totales.altas, null)
  for (const fila of estadisticas.porCompania) assert.equal(fila.altas, null)
  db.close()
})

test('el podio del mes ordena las sucursales por altas, sin la fila «(sin sucursal)» y sin plata', async () => {
  const { db } = await baseImportada()
  const estadisticas = estadisticasDeCarteraLocal('2026-08', [], false)
  const podio = podioDelMes()

  assert.equal(podio.periodo, estadisticas.periodo, 'el podio mira el mismo período que Estadísticas por defecto')
  assert.equal(podio.hayMesAnterior, estadisticas.hayMesAnterior)
  assert.ok(podio.ranking.every((fila) => fila.etiqueta !== '(sin sucursal)'), 'la fila sin sucursal no compite')

  // Las mismas sucursales de estadisticasDeCarteraLocal, sólo reordenadas para el podio.
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
  const antesActivos = estadisticasDeCarteraLocal('2026-08', [], true).totales.activos
  const antesAltas = altasEnElPodio('Dock Sud')

  const original = polizaDe(CLIENTES.gonzalez.poliza)
  // Con el MISMO número, que es lo normal: ahí la póliza nueva le saca la clave a la vieja y la vieja
  // pasa a ser «ANTERIOR:…». Era el caso que garantizaba un alta fantasma en todas las renovaciones.
  renovar(original.id, { ...datosSugeridosDeRenovacion(original.id), numero: CLIENTES.gonzalez.poliza }, DANIEL)

  const despues = estadisticasDeCarteraLocal('2026-08', [], true)
  assert.equal(despues.totales.activos, antesActivos, 'la cartera no creció: la fila vieja salió y entró la nueva')
  assert.equal(altasEnElPodio('Dock Sud'), antesAltas, 'y el podio de Dock Sud no se movió: renovar no es un alta')
  assert.equal(despues.totales.bajas, estadisticasDeCarteraLocal('2026-08', [], true).totales.bajas, 'tampoco es una baja')
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
  const antesActivos = estadisticasDeCarteraLocal('2026-08', [], true).totales.activos
  const antes = altasEnElPodio('Dock Sud')
  const original = polizaDe(CLIENTES.gonzalez.poliza)

  renovar(
    original.id,
    { ...datosSugeridosDeRenovacion(original.id), numero: `${CLIENTES.gonzalez.poliza}-B`, destinoDeLaAnterior: 'activa' },
    DANIEL,
  )

  // Acá la planilla del mes queda con las dos filas a propósito, así que la cartera SÍ creció en una y
  // las altas tienen que acompañar: si no, activos y altas contarían cosas distintas.
  assert.equal(estadisticasDeCarteraLocal('2026-08', [], true).totales.activos, antesActivos + 1, 'quedan las dos vigentes')
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
  assert.equal(estadisticasDeCarteraLocal('2026-08', [], true).totales.altas, 1, 'y Estadísticas cuenta lo mismo')
  const detalle = altasDelMes('2026-08', 'Dock Sud')
  assert.deepEqual(
    detalle.filas.map((f) => f.cliente),
    [CLIENTES.suarez.nombre],
    'González no está en la lista: es la renovación, no un alta',
  )
  db.close()
})

test('dos altas nuevas sin número de póliza, patente ni documento no se confunden entre sí', async () => {
  // Una venta nueva típica: la compañía todavía no emitió el número de póliza y el cliente recién
  // cargado no tiene el DNI puesto en la planilla del mes. Sin ninguno de los tres datos que arma la
  // clave escrita (`claveEscrita`), dos altas SIN NINGUNA RELACIÓN entre sí pisaban la misma identidad
  // («X:||») y `unaPorIdentidad` se quedaba con una sola: el podio de Sarandí mostraba menos altas de
  // las que la sucursal realmente había hecho (issue #103, «Contador»).
  const db = baseDePrueba()
  usarBaseDeDatos(db)
  const ahora = ahoraIso()
  const insertar = db.prepare(
    `INSERT INTO cuotas_mes (fila_id, periodo, pestana, cliente_nombre, sucursal_texto, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, 'Sarandí', ?, ?)`,
  )
  // Julio sólo hace falta para que haya «mes anterior»: ningún dato suyo se relaciona con las altas de agosto.
  insertar.run('f-julio-base', '2026-07', 'JULIO', 'CLIENTE DE JULIO', ahora, ahora)
  insertar.run('f-agosto-uno', '2026-08', 'AGOSTO', 'ROMERO ESTEBAN EZEQUIEL', ahora, ahora)
  insertar.run('f-agosto-dos', '2026-08', 'AGOSTO', 'CAÑETE SEBASTIAN SILVESTRE', ahora, ahora)

  const detalle = altasDelMes('2026-08', 'Sarandí')
  assert.deepEqual(
    detalle.filas.map((f) => f.cliente).sort(),
    ['CAÑETE SEBASTIAN SILVESTRE', 'ROMERO ESTEBAN EZEQUIEL'],
    'las dos altas cuentan, aunque ninguna tenga número de póliza, patente ni documento',
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
  const estadisticas = estadisticasDeCarteraLocal('2026-08', [], false)
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

// ---------------------------------------------------------------------------
// Autos y motos / riesgos varios: la separación por rama
// ---------------------------------------------------------------------------

interface RiesgoVarioDePrueba {
  fila: string
  nombre: string
  sucursal: string
  compania: string
  numero: string | null
  tipo: string
  patente?: string | null
  documento?: string | null
  emisionIso?: string | null
  desde?: string | null
  hasta?: string | null
}

/** Una fila de la pestaña RIESGOS VARIOS, escrita directo en la base como la dejaría la importación. */
function insertarRiesgoVario(db: ReturnType<typeof baseDePrueba>, riesgo: RiesgoVarioDePrueba): void {
  const ahora = ahoraIso()
  db.prepare(
    `INSERT INTO riesgos_varios (fila_id, pestana, cliente_nombre, sucursal_texto, compania, numero_poliza, patente, documento, tipo_riesgo,
                                 emision_iso, vigencia_desde, vigencia_hasta, creado_en, actualizado_en)
     VALUES (@fila, 'RIESGOS VARIOS', @nombre, @sucursal, @compania, @numero, @patente, @documento, @tipo, @emisionIso, @desde, @hasta, @ahora, @ahora)`,
  ).run({ patente: null, documento: null, emisionIso: null, desde: null, hasta: null, ...riesgo, ahora })
}

/**
 * Le engancha a la fila de un mes una póliza con un vehículo de ese TIPO, que es de donde la planilla
 * mensual saca la rama. Hace falta porque la hoja de prueba deja SIN póliza enganchada al que ya estaba
 * dado de baja (Fernández, que se fue en julio), y una fila sin póliza no tiene tipo que mirar.
 */
function tiparLaFilaDelMes(db: ReturnType<typeof baseDePrueba>, periodo: string, nombre: string, tipo: string): void {
  const ahora = ahoraIso()
  const clave = `${periodo}|${nombre}`
  const vehiculo = db
    .prepare(`INSERT INTO vehiculos (clave, tipo, creado_en, actualizado_en) VALUES (?, ?, ?, ?) RETURNING id`)
    .get(`VEH:${clave}`, tipo, ahora, ahora) as { id: number }
  const cliente = db
    .prepare(`INSERT INTO clientes (clave, nombre, creado_en, actualizado_en) VALUES (?, ?, ?, ?) RETURNING id`)
    .get(`CLI:${clave}`, nombre, ahora, ahora) as { id: number }
  const poliza = db
    .prepare(
      `INSERT INTO polizas (clave, cliente_id, vehiculo_id, periodo_origen, pestana_origen, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(`POL:${clave}`, cliente.id, vehiculo.id, periodo, periodo, ahora, ahora) as { id: number }
  const cambio = db.prepare(`UPDATE cuotas_mes SET poliza_id = ? WHERE periodo = ? AND cliente_nombre = ?`).run(poliza.id, periodo, nombre)
  assert.equal(cambio.changes, 1, `${nombre} tiene una sola fila en la planilla de ${periodo}`)
}

test('activos, altas y bajas se separan en autos y motos y riesgos varios, y siempre suman el total', async () => {
  const { db } = await baseImportada()
  const tablero = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.ok(tablero.porRama, 'el cálculo local siempre trae la separación')
  // La hoja de prueba tiene dos riesgos varios sin fechas en RIESGOS VARIOS y ningún TIPO de riesgo vario en la planilla.
  assert.deepEqual(tablero.porRama, {
    autosMotos: { activos: contar(db, 'cuotas_mes', `periodo = '2026-08' AND dada_de_baja = 0`), altas: 1, bajas: 0 },
    riesgosVarios: { activos: 2, altas: 0, bajas: 0 },
  })
  assert.equal(tablero.porRama.autosMotos.activos + tablero.porRama.riesgosVarios.activos, tablero.activos)

  // La evolución separa cada mes con la misma cuenta que las tarjetas.
  assert.deepEqual(tablero.evolucion.find((mes) => mes.periodo === '2026-08')?.porRama, tablero.porRama, 'agosto en la evolución dice lo mismo que las tarjetas')
  for (const mes of tablero.evolucion) {
    assert.ok(mes.porRama, `${mes.periodo}: el cálculo local siempre trae la separación`)
    assert.equal(mes.porRama.autosMotos.activos + mes.porRama.riesgosVarios.activos, mes.activos, `${mes.periodo}: activos`)
    assert.equal(mes.porRama.autosMotos.bajas + mes.porRama.riesgosVarios.bajas, mes.bajas, `${mes.periodo}: bajas`)
  }

  const estadisticas = estadisticasDeCarteraLocal('2026-08', [], true)
  assert.deepEqual(estadisticas.totales.porRama, tablero.porRama, 'Estadísticas dice lo mismo que Métricas, por rama')
  for (const fila of [...estadisticas.porCompania, ...estadisticas.porSucursal]) {
    assert.equal(fila.porRama!.autosMotos.activos + fila.porRama!.riesgosVarios.activos, fila.activos, `${fila.etiqueta}: activos`)
    assert.equal((fila.porRama!.autosMotos.altas ?? 0) + (fila.porRama!.riesgosVarios.altas ?? 0), fila.altas, `${fila.etiqueta}: altas`)
  }
  db.close()
})

test('un riesgo vario de RIESGOS VARIOS es alta en el mes de su emisión, o de su vigencia desde si no tiene emisión', async () => {
  const { db } = await baseImportada()
  insertarRiesgoVario(db, { fila: 'rv-emitido', nombre: 'ACOSTA MARIA', sucursal: 'Sarandí', compania: 'SANCOR', numero: 'HOG-1', tipo: 'HOGAR', emisionIso: '2026-08-12', hasta: '12/08/2027' })
  insertarRiesgoVario(db, { fila: 'rv-desde', nombre: 'BENITEZ LUIS', sucursal: 'Sarandí', compania: 'RIVADAVIA', numero: 'AP-2', tipo: 'ACCIDENTE PERSONAL', desde: '03/08/2026' })
  // Terminó en junio: en agosto ya no está activo, y su emisión de 2025 tampoco lo hace alta.
  insertarRiesgoVario(db, { fila: 'rv-vencido', nombre: 'CASTRO ANA', sucursal: 'Sarandí', compania: 'SANCOR', numero: 'HOG-3', tipo: 'HOGAR', emisionIso: '2025-06-01', hasta: '01/06/2026' })

  const agosto = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(agosto.porRama!.riesgosVarios.altas, 2)
  assert.equal(agosto.altas, 3, 'Suárez y los dos riesgos varios nuevos')
  assert.equal(agosto.porRama!.riesgosVarios.activos, 4, 'los dos sin fechas y los dos nuevos; el vencido no')

  const julio = tableroDeMetricasLocal({ periodo: '2026-07', sucursales: [] }, true)
  assert.equal(julio.porRama!.riesgosVarios.altas, 0)
  assert.equal(julio.porRama!.riesgosVarios.activos, 2, 'en julio los nuevos todavía no empezaron y el vencido ya terminó')

  // El detalle lista esas mismas altas con su rama, y cada rama cierra con su cifra de la tarjeta del podio.
  const detalle = altasDelMes('2026-08', 'Sarandí')
  assert.deepEqual(
    detalle.filas.filter((alta) => alta.rama === 'RIESGOS_VARIOS').map((alta) => [alta.cliente, alta.tipo]),
    [
      ['ACOSTA MARIA', 'HOGAR'],
      ['BENITEZ LUIS', 'ACCIDENTE PERSONAL'],
    ],
  )
  const tarjeta = podioDelMes().ranking.find((fila) => normalizarTexto(fila.etiqueta) === 'SARANDI')
  assert.ok(tarjeta?.porRama, 'Sarandí compite y su tarjeta trae la separación')
  for (const rama of RAMAS_DE_METRICA) {
    assert.equal(detalle.filas.filter((alta) => alta.rama === rama).length, tarjeta.porRama[campoDeRama(rama)].altas ?? 0, `Sarandí · ${rama}`)
  }
  db.close()
})

test('una póliza que ya está en la planilla del mes no se cuenta otra vez desde RIESGOS VARIOS', async () => {
  const { db } = await baseImportada()
  const antes = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  // La misma compañía y el mismo número que la fila de Suárez en AGOSTO, escrito con otro formato.
  insertarRiesgoVario(db, {
    fila: 'rv-repetido',
    nombre: CLIENTES.suarez.nombre,
    sucursal: 'Dock Sud',
    compania: CLIENTES.suarez.cia.toLowerCase(),
    numero: ` ${CLIENTES.suarez.poliza} `,
    tipo: 'HOGAR',
    emisionIso: '2026-08-01',
  })
  const despues = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(despues.activos, antes.activos, 'es la misma póliza, no dos')
  assert.equal(despues.altas, antes.altas)
  assert.deepEqual(despues.porRama, antes.porRama)
  db.close()
})

test('una fila de la planilla con TIPO de riesgo vario cuenta en riesgos varios, con la regla del mes anterior', async () => {
  const { db } = await baseImportada()
  db.prepare(
    `UPDATE vehiculos SET tipo = 'BICICLETA'
      WHERE id = (SELECT p.vehiculo_id FROM cuotas_mes c JOIN polizas p ON p.id = c.poliza_id
                   WHERE c.periodo = '2026-08' AND c.cliente_nombre = ?)`,
  ).run(CLIENTES.suarez.nombre)

  const tablero = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(tablero.porRama!.riesgosVarios.altas, 1, 'Suárez es alta y ahora es de riesgos varios')
  assert.equal(tablero.porRama!.autosMotos.altas, 0)
  assert.equal(tablero.porRama!.riesgosVarios.activos, 3)
  assert.equal(tablero.altas, 1, 'el total no cambia: sólo cambió de rama')
  const suarez = altasDelMes('2026-08', null).filas.find((alta) => alta.cliente === CLIENTES.suarez.nombre)
  assert.equal(suarez?.rama, 'RIESGOS_VARIOS')
  db.close()
})

test('una baja es de riesgos varios si su número de póliza o su patente aparece como riesgo vario; si no, de autos y motos', async () => {
  const { db } = await baseImportada()
  const ahora = ahoraIso()
  const insertar = db.prepare(
    `INSERT INTO bajas (fila_id, pestana, periodo, cliente_nombre, compania, numero_poliza, patente, sucursal_texto, motivo, creado_en, actualizado_en)
     VALUES (?, 'BAJAS AGOSTO', '2026-08', ?, ?, ?, ?, 'Dock Sud', 'VENDIO', ?, ?)`,
  )
  // CF-4455 es el combinado familiar de González en RIESGOS VARIOS.
  insertar.run('baja-rv', CLIENTES.gonzalez.nombre, 'SANCOR', 'CF-4455', null, ahora, ahora)
  insertar.run('baja-desconocida', 'ALGUIEN SIN POLIZA', 'ATM', '999999', null, ahora, ahora)
  // Un número que no aparece en ningún lado, pero la patente de un riesgo vario de RIESGOS VARIOS escrita con otro formato.
  insertarRiesgoVario(db, { fila: 'rv-con-patente', nombre: 'GIMENEZ LUCIA', sucursal: 'Dock Sud', compania: 'SANCOR', numero: 'OT-77', tipo: 'OTRO', patente: 'AA999ZZ' })
  insertar.run('baja-por-patente', 'GIMENEZ LUCIA', 'SANCOR', '888888', 'aa 999 zz', ahora, ahora)
  // Fernández está SÓLO en la planilla de JULIO, el mes anterior, y su TIPO es una bicicleta: la baja de
  // agosto se reconoce mirando también el mes anterior, no nada más el mes de la baja.
  tiparLaFilaDelMes(db, '2026-07', CLIENTES.fernandez.nombre, 'BICICLETA')
  insertar.run('baja-planilla-rv', CLIENTES.fernandez.nombre, CLIENTES.fernandez.cia, CLIENTES.fernandez.poliza, null, ahora, ahora)
  // Un número que no aparece en ningún lado y la patente de un auto de la planilla: autos y motos.
  insertar.run('baja-patente-auto', CLIENTES.lopez.nombre, CLIENTES.lopez.cia, '777000', CLIENTES.lopez.patente, ahora, ahora)

  const tablero = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true)
  assert.equal(tablero.bajas, 5)
  assert.equal(tablero.porRama!.riesgosVarios.bajas, 3, 'por número en RIESGOS VARIOS, por patente en RIESGOS VARIOS y por número en la planilla de julio')
  assert.equal(tablero.porRama!.autosMotos.bajas, 2, 'la que no aparece y la de la patente del auto')
  assert.deepEqual(estadisticasDeCarteraLocal('2026-08', [], true).totales.porRama, tablero.porRama)
  assert.deepEqual(tablero.evolucion.find((mes) => mes.periodo === '2026-08')?.porRama, tablero.porRama)
  db.close()
})

test('con emisión y vigencia desde en meses distintos, manda la emisión', async () => {
  const { db } = await baseImportada()
  const antesJulio = tableroDeMetricasLocal({ periodo: '2026-07', sucursales: [] }, true).porRama!
  const antesAgosto = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  // Emitida en agosto, con una vigencia que ya arrancaba a mediados de julio.
  insertarRiesgoVario(db, { fila: 'rv-dos-fechas', nombre: 'ROMERO JULIA', sucursal: 'Sarandí', compania: 'SANCOR', numero: 'HOG-8', tipo: 'HOGAR', emisionIso: '2026-08-10', desde: '15/07/2026' })

  const agosto = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  assert.equal(agosto.riesgosVarios.altas, (antesAgosto.riesgosVarios.altas ?? 0) + 1, 'es alta en el mes de su emisión')
  assert.equal(agosto.riesgosVarios.activos, antesAgosto.riesgosVarios.activos + 1)
  const julio = tableroDeMetricasLocal({ periodo: '2026-07', sucursales: [] }, true).porRama!
  assert.deepEqual(julio, antesJulio, 'en julio no es alta ni está activa, aunque la vigencia desde caiga en julio')
  db.close()
})

test('una póliza repetida dentro de la pestaña RIESGOS VARIOS cuenta una sola vez', async () => {
  const { db } = await baseImportada()
  const antes = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  // La misma compañía y el mismo número en dos renglones, escritos con otro formato.
  insertarRiesgoVario(db, { fila: 'rv-hog-a', nombre: 'ACOSTA MARIA', sucursal: 'Sarandí', compania: 'SANCOR', numero: 'HOG-1', tipo: 'HOGAR', emisionIso: '2026-08-12' })
  insertarRiesgoVario(db, { fila: 'rv-hog-b', nombre: 'ACOSTA MARIA', sucursal: 'Sarandí', compania: 'Sancor', numero: ' hog-1 ', tipo: 'HOGAR', emisionIso: '2026-08-12' })

  const despues = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  assert.equal(despues.riesgosVarios.activos, antes.riesgosVarios.activos + 1, 'es una póliza, no dos')
  assert.equal(despues.riesgosVarios.altas, (antes.riesgosVarios.altas ?? 0) + 1)
  assert.equal(altasDelMes('2026-08', null).filas.filter((alta) => alta.cliente === 'ACOSTA MARIA').length, 1, 'el detalle la lista una vez')
  db.close()
})

test('la misma póliza de RIESGOS VARIOS cuenta una sola vez aunque sólo un renglón traiga la patente', async () => {
  const { db } = await baseImportada()
  const antes = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  // Mismo número de póliza: la identidad se arma con el número, no con la patente, así que la patente
  // de más en un renglón no separa esta póliza en dos.
  insertarRiesgoVario(db, { fila: 'rv-sin-patente', nombre: 'NUÑEZ CARLA', sucursal: 'Sarandí', compania: 'SANCOR', numero: 'OT-90', tipo: 'OTRO', emisionIso: '2026-08-05' })
  insertarRiesgoVario(db, { fila: 'rv-con-patente-b', nombre: 'NUÑEZ CARLA', sucursal: 'Sarandí', compania: 'SANCOR', numero: 'OT-90', tipo: 'OTRO', patente: 'AC123DE', emisionIso: '2026-08-05' })

  const despues = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  assert.equal(despues.riesgosVarios.activos, antes.riesgosVarios.activos + 1, 'es una póliza, no dos')
  assert.equal(despues.riesgosVarios.altas, (antes.riesgosVarios.altas ?? 0) + 1)
  db.close()
})

test('dos riesgos varios del mismo cliente sin número de póliza cuentan por separado si el tipo de riesgo es distinto', async () => {
  const { db } = await baseImportada()
  const antes = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  // Mismo documento y sin número de póliza: sin el tipo en la identidad, el hogar y el accidente
  // personal del mismo cliente se pisarían entre sí y quedaría uno solo de los dos.
  insertarRiesgoVario(db, { fila: 'rv-hogar-doc', nombre: 'PEREYRA SOFIA', sucursal: 'Sarandí', compania: 'SANCOR', numero: null, documento: '30111222', tipo: 'HOGAR', emisionIso: '2026-08-06' })
  insertarRiesgoVario(db, { fila: 'rv-ap-doc', nombre: 'PEREYRA SOFIA', sucursal: 'Sarandí', compania: 'SANCOR', numero: null, documento: '30111222', tipo: 'ACCIDENTE PERSONAL', emisionIso: '2026-08-06' })

  const despues = tableroDeMetricasLocal({ periodo: '2026-08', sucursales: [] }, true).porRama!
  assert.equal(despues.riesgosVarios.activos, antes.riesgosVarios.activos + 2, 'son dos riesgos distintos del mismo cliente')
  assert.equal(despues.riesgosVarios.altas, (antes.riesgosVarios.altas ?? 0) + 2)
  db.close()
})

test('sin mes anterior, las altas de autos y motos son «no se sabe» pero las de RIESGOS VARIOS sí se cuentan', async () => {
  const { db } = await baseImportada()
  const primero = periodosDisponibles().map((p) => p.periodo).sort()[0]!
  insertarRiesgoVario(db, { fila: 'rv-primero', nombre: 'DIAZ PEDRO', sucursal: 'Lanús', compania: 'SANCOR', numero: 'COM-9', tipo: 'INTEGRAL DE COMERCIO', emisionIso: `${primero}-05` })

  const tablero = tableroDeMetricasLocal({ periodo: primero, sucursales: [] }, true)
  assert.equal(tablero.altas, null, 'el total sigue en null: sin mes anterior no se puede deducir')
  assert.equal(tablero.porRama!.autosMotos.altas, null)
  assert.equal(tablero.porRama!.riesgosVarios.altas, 1)
  const detalle = altasDelMes(primero, null)
  assert.deepEqual(
    detalle.filas.map((alta) => [alta.cliente, alta.rama]),
    [['DIAZ PEDRO', 'RIESGOS_VARIOS']],
  )
  db.close()
})
