// Fase 9 de punta a punta: los números que hoy se calculan a mano, la planilla de siempre exportada y
// los mensajes de WhatsApp.
//
// Los cuatro criterios del pliego, en el mismo orden:
//   1. los activos por compañía coinciden (±1) con los COUNTIF de SEGUROS ACT de la hoja;
//   2. la «Planilla clásica» exportada abre en Excel y se ve como la planilla de siempre;
//   3. se edita la plantilla de aviso y el botón «Avisar» de Cartera usa el texto nuevo;
//   4. un segmento guardado devuelve la misma cantidad de filas que el filtro equivalente en Cartera.
import assert from 'node:assert/strict'
import test from 'node:test'

import Database from 'better-sqlite3'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarMigraciones, MIGRACIONES } from '../src/main/db/migraciones'
import { sembrarDatosIniciales } from '../src/main/db/semilla'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso, normalizarTexto } from '../src/main/importacion/normalizar'
import { planillaDelMes, prepararAviso } from '../src/main/servicios/cartera'
import { avisarDeSegmento, borrarSegmento, guardarSegmento, listarSegmentos, resultadoDeSegmento } from '../src/main/servicios/marketing'
import { estadisticasDeCartera, tableroDeMetricas } from '../src/main/servicios/metricas'
import {
  borrarPlantilla,
  crearPlantilla,
  editarPlantilla,
  guardarPlantillaDeAviso,
  listarPlantillas,
  plantillaDeAviso,
} from '../src/main/servicios/plantillas'
import {
  catalogoDeReportes,
  htmlDelReporte,
  vistaPreviaDeReporte,
  xlsxDePlanillaClasica,
  xlsxDelReporte,
} from '../src/main/servicios/reportes'
import { construirXlsx } from '../src/main/servicios/xlsx'
import { PLANTILLA_AVISO_POR_DEFECTO, SEGMENTO_SIN_FILTROS, type FiltrosDeSegmento, type SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { leerZip } from './ayuda'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

/** El mes abierto de la hoja de prueba. */
const AGOSTO = '2026-08'
const JULIO = '2026-07'

/** Un día fijo dentro de AGOSTO: las ventanas de vencimiento no pueden depender de cuándo se corre. */
const HOY = '2026-08-05'

let hoja: HojaSimulada

/**
 * Base nueva e importada. Cada prueba arranca con la suya, como en el resto del banco: varias de
 * acá escriben (marcan avisos, guardan segmentos, editan plantillas) y no pueden ensuciarse entre sí.
 */
async function prepararBase(): Promise<void> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  hoja = new HojaSimulada(construirHojaDePrueba())
  const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as {
    id: number
  }
  await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
}

// ---------------------------------------------------------------------------
// Criterio 1: los activos coinciden con los COUNTIF de la hoja
// ---------------------------------------------------------------------------

/**
 * Lo que haría un COUNTIF sobre la pestaña del mes: contar las filas cuya columna COMPAÑIA dice tal
 * cosa. Es la cuenta que hoy vive en SEGUROS ACT, hecha sobre la hoja misma y no sobre la base.
 */
function countifPorCompania(pestana: string): Map<string, number> {
  const filas = hoja.filasDe(pestana)
  const encabezados = filas[0]!.map((e) => normalizarTexto(e))
  const columna = encabezados.findIndex((e) => e === 'COMPANIA' || e === 'CIA')
  assert.ok(columna >= 0, `la pestaña ${pestana} tiene que tener columna de compañía`)

  const cuenta = new Map<string, number>()
  for (const fila of filas.slice(1)) {
    const compania = normalizarTexto(fila[columna] ?? '')
    if (!compania) continue
    cuenta.set(compania, (cuenta.get(compania) ?? 0) + 1)
  }
  return cuenta
}

test('los seguros activos por compañía coinciden con los COUNTIF de la hoja', async () => {
  await prepararBase()

  const esperado = countifPorCompania('AGOSTO')
  const tablero = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, true)

  const total = [...esperado.values()].reduce((suma, n) => suma + n, 0)
  assert.equal(tablero.activos, total, 'el total de activos tiene que ser el de las filas de la pestaña')
  assert.equal(tablero.periodo, AGOSTO)

  for (const [compania, cantidad] of esperado) {
    const fila = tablero.activosPorCompania.find((f) => normalizarTexto(f.etiqueta) === compania)
    assert.ok(fila, `falta la compañía ${compania} en el tablero`)
    assert.ok(Math.abs(fila.cantidad - cantidad) <= 1, `${compania}: el tablero dice ${fila.cantidad} y la hoja ${cantidad}`)
  }
  assert.equal(tablero.activosPorCompania.length, esperado.size, 'no puede sobrar ninguna compañía')

  // Los porcentajes tienen que sumar 100 (con el redondeo a un decimal).
  const suma = tablero.activosPorCompania.reduce((total, fila) => total + fila.porcentaje, 0)
  assert.ok(Math.abs(suma - 100) < 0.5, `los porcentajes suman ${suma}`)
})

test('el filtro de sucursal recorta el tablero sin romper los porcentajes', async () => {
  await prepararBase()

  const completo = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, true)
  const lanus = tableroDeMetricas({ periodo: AGOSTO, sucursal: 'Lanús' }, true)

  // En AGOSTO Lanús tiene las dos pólizas de Pérez (el auto y la moto).
  assert.equal(lanus.activos, 2)
  assert.ok(lanus.activos < completo.activos)
  assert.equal(lanus.activosPorSucursal.length, 1, 'filtrando por una sucursal sólo puede quedar esa')
  assert.equal(lanus.activosPorSucursal[0]!.porcentaje, 100)
})

test('altas, bajas y evolución cuentan lo mismo que comparar dos pestañas a mano', async () => {
  await prepararBase()

  const tablero = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, true)

  // En AGOSTO entró Suárez (no estaba en JULIO) y no se fue nadie: la baja de Fernández es de JULIO.
  assert.equal(tablero.hayMesAnterior, true)
  assert.equal(tablero.altas, 1, 'la única alta de agosto es Suárez')
  assert.equal(tablero.bajas, 0, 'BAJAS AGOSTO está vacía')

  const julio = tableroDeMetricas({ periodo: JULIO, sucursal: '' }, true)
  assert.equal(julio.bajas, 1, 'en julio se dio de baja Fernández')
  assert.equal(julio.bajasPorMotivo[0]!.motivo, 'SE PASO A OTRO PRODUCTOR')

  const ultimo = tablero.evolucion.at(-1)!
  assert.equal(ultimo.periodo, AGOSTO)
  assert.equal(ultimo.activos, tablero.activos)
  assert.equal(ultimo.altas, tablero.altas)
  assert.ok(tablero.evolucion.length > 1 && tablero.evolucion.length <= 12)
  // La evolución va del mes más viejo al más nuevo: es como se lee un gráfico de línea.
  assert.deepEqual(
    tablero.evolucion.map((mes) => mes.periodo),
    [...tablero.evolucion.map((mes) => mes.periodo)].sort(),
  )
})

test('la cobranza del mes separa lo cobrado de lo pendiente', async () => {
  await prepararBase()

  const { cobranza } = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, true)

  // Tres filas de AGOSTO están sin pagar (Martínez, Suárez y Rodríguez); las otras cuatro, pagas.
  assert.equal(cobranza.cuotasPendientes, 3)
  assert.equal(cobranza.cuotasCobradas, 4)
  assert.ok((cobranza.cobrado ?? 0) > 0, 'la pestaña IMPUTADOS trae pagos de agosto')
  assert.ok((cobranza.pendiente ?? 0) > 0)
  assert.ok((cobranza.porMedio ?? []).length > 0)
  assert.equal(
    (cobranza.porMedio ?? []).reduce((suma, medio) => suma + medio.total, 0),
    cobranza.cobrado,
    'los medios de pago tienen que sumar lo cobrado',
  )
})

test('a un empleado los números de la agencia no le llegan: viajan en null, no en cero', async () => {
  await prepararBase()

  const conNumeros = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, true)
  const sinNumeros = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, false)

  // Lo agregado de plata no viaja. En null y no en cero a propósito: un cero se lee «no se cobró
  // nada», que sería mentira, y además haría que la pantalla dibujara una tarjeta con $ 0.
  assert.equal(sinNumeros.cobranza.cobrado, null)
  assert.equal(sinNumeros.cobranza.pendiente, null)
  assert.equal(sinNumeros.cobranza.porMedio, null)
  assert.ok(sinNumeros.evolucion.length > 0)
  assert.ok(sinNumeros.evolucion.every((mes) => mes.cobrado === null))

  // Todo lo demás sí: es lo que necesita para trabajar. Cuántas cuotas cobró y cuántas le faltan es
  // trabajo hecho y trabajo por hacer, no la plata de la agencia.
  assert.equal(sinNumeros.activos, conNumeros.activos)
  assert.equal(sinNumeros.altas, conNumeros.altas)
  assert.equal(sinNumeros.bajas, conNumeros.bajas)
  assert.equal(sinNumeros.cobranza.cuotasCobradas, conNumeros.cobranza.cuotasCobradas)
  assert.equal(sinNumeros.cobranza.cuotasPendientes, conNumeros.cobranza.cuotasPendientes)
  assert.equal(sinNumeros.siniestrosAbiertos, conNumeros.siniestrosAbiertos)
  assert.deepEqual(sinNumeros.activosPorCompania, conNumeros.activosPorCompania)

  // Y lo mismo en la versión en tabla, incluido el total: que el total no sume nulls y dé cero.
  const tabla = estadisticasDeCartera(AGOSTO, '', false)
  assert.equal(tabla.totales.cobrado, null)
  assert.ok(tabla.porCompania.length > 0)
  assert.ok(tabla.porCompania.every((fila) => fila.cobrado === null))
  assert.equal(tabla.totales.activos, estadisticasDeCartera(AGOSTO, '', true).totales.activos)
  assert.ok((estadisticasDeCartera(AGOSTO, '', true).totales.cobrado ?? 0) > 0, 'con permiso el total sí tiene que venir')
})

test('los siniestros abiertos dejan afuera los cerrados', async () => {
  await prepararBase()

  const tablero = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, true)
  // De los tres de la hoja, uno está CERRADO: quedan el de granizo y el robo.
  assert.equal(tablero.siniestrosAbiertos, 2)
  assert.equal(
    tablero.siniestrosPorCompania.reduce((suma, fila) => suma + fila.cantidad, 0),
    2,
  )
})

test('Estadísticas dice lo mismo que Métricas, en tabla', async () => {
  await prepararBase()

  const tablero = tableroDeMetricas({ periodo: AGOSTO, sucursal: '' }, true)
  const tabla = estadisticasDeCartera(AGOSTO, '', true)

  assert.equal(tabla.totales.activos, tablero.activos)
  assert.equal(tabla.totales.altas, tablero.altas)
  assert.equal(tabla.totales.bajas, tablero.bajas)
  assert.equal(
    tabla.porSucursal.reduce((suma, fila) => suma + fila.activos, 0),
    tablero.activos,
    'por sucursal tiene que dar el mismo total que por compañía',
  )
  for (const porcion of tablero.activosPorCompania) {
    const fila = tabla.porCompania.find((f) => f.etiqueta === porcion.etiqueta)
    assert.ok(fila, `falta ${porcion.etiqueta} en la tabla`)
    assert.equal(fila.activos, porcion.cantidad)
  }
})

// ---------------------------------------------------------------------------
// Criterio 2: la planilla clásica
// ---------------------------------------------------------------------------

/** Los textos de una fila del XML de una hoja, en orden. Las celdas vacías no se escriben. */
function celdasDeLaFila(xml: string, fila: number): string[] {
  const bloque = new RegExp(`<row r="${fila}">(.*?)</row>`, 's').exec(xml)
  if (!bloque) return []
  return [...bloque[1]!.matchAll(/<t[^>]*>(.*?)<\/t>/g)].map((c) => c[1]!)
}

/** El texto de una celda por su referencia ('AF2'), o '' si está vacía. */
function celdaDe(xml: string, referencia: string): string {
  return new RegExp(`<c r="${referencia}"[^>]*><is><t[^>]*>([^<]*)<`).exec(xml)?.[1] ?? ''
}

const ENCABEZADOS_CLASICOS = [
  'APELLIDO Y NOMBRE',
  'DNI',
  'TELEFONO',
  'EMAIL',
  'DOMICILIO',
  'LOCALIDAD',
  'SUCURSAL',
  'FECHA DE NACIMIENTO',
  'COMPAÑIA',
  'NRO DE POLIZA',
  'COBERTURA',
  'PRIMA',
  'FORMA DE PAGO',
  'PRODUCTOR',
  'ESTADO',
  'VIGENCIA DESDE',
  'VIGENCIA HASTA',
  'ALTA',
  'MARCA',
  'MODELO',
  'AÑO',
  'DOMINIO',
  'MOTOR',
  'CHASIS',
  'USO',
  'COLOR',
  'SUMA ASEGURADA',
  'CUOTA',
  'DIA DE VTO',
  'AVISO',
  'PAGO',
  'OBS',
]

test('la Planilla clásica sale con las columnas y el orden de la hoja de siempre', async () => {
  await prepararBase()

  const archivo = xlsxDePlanillaClasica({ periodos: [AGOSTO], sucursal: '' })
  assert.match(archivo.nombre, /\.xlsx$/)

  const partes = leerZip(archivo.contenido)
  // Las piezas que un .xlsx necesita para que Excel lo abra en vez de decir que está dañado.
  for (const parte of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) {
    assert.ok(partes.has(parte), `falta ${parte} en el archivo`)
  }

  const libro = partes.get('xl/workbook.xml')!
  assert.match(libro, /name="AGOSTO"/, 'la pestaña del mes se llama como en la hoja')
  assert.match(libro, /name="BAJAS AGOSTO"/, 'al lado va su pestaña de bajas')

  const mes = partes.get('xl/worksheets/sheet1.xml')!
  // Fila 1 = encabezados, sin fila de título arriba: la planilla clásica arranca como la de siempre.
  assert.deepEqual(celdasDeLaFila(mes, 1), ENCABEZADOS_CLASICOS)

  const filasDeDatos = [...mes.matchAll(/<row r="/g)].length - 1
  assert.equal(filasDeDatos, planillaDelMes(AGOSTO).filas.length, 'tiene que traer las mismas filas que la planilla del mes')

  // Y cada dato cae en SU columna, que es lo que hace que la planilla se reconozca de un vistazo:
  // A el nombre, I la compañía, V el dominio, AF las observaciones.
  const dela = planillaDelMes(AGOSTO).filas
  assert.ok(
    dela.some((fila) => fila.nombre === celdaDe(mes, 'A2')),
    'en la columna A va el apellido y nombre',
  )
  assert.ok(
    dela.some((fila) => fila.compania === celdaDe(mes, 'I2')),
    'en la columna I va la compañía',
  )
  assert.equal(celdaDe(mes, 'Y2'), 'PARTICULAR', 'en la columna Y va el uso del vehículo')
  const suarez = dela.find((fila) => fila.nombre === CLIENTES.suarez.nombre)!
  const filaDeSuarez = [...mes.matchAll(/<c r="A(\d+)"[^>]*><is><t[^>]*>([^<]*)</g)].find((c) => c[2] === suarez.nombre)
  assert.ok(filaDeSuarez, 'Suárez tiene que estar en la planilla exportada')
  assert.equal(celdaDe(mes, `V${filaDeSuarez[1]}`), CLIENTES.suarez.patente, 'en la columna V va el dominio')
  assert.equal(celdaDe(mes, `AF${filaDeSuarez[1]}`), 'ALTA NUEVA', 'en la columna AF van las observaciones')
})

test('la Planilla clásica de varios meses trae una pestaña por mes y su BAJAS', async () => {
  await prepararBase()

  const partes = leerZip(xlsxDePlanillaClasica({ periodos: [JULIO, AGOSTO], sucursal: '' }).contenido)
  const libro = partes.get('xl/workbook.xml')!
  assert.equal([...libro.matchAll(/<sheet /g)].length, 4, 'dos meses son cuatro pestañas')
  assert.match(libro, /name="JULIO"/)
  assert.match(libro, /name="AGOSTO"/)
  assert.ok(partes.has('xl/worksheets/sheet4.xml'))
})

test('la Planilla clásica filtrada por sucursal trae sólo ese local', async () => {
  await prepararBase()

  const partes = leerZip(xlsxDePlanillaClasica({ periodos: [AGOSTO], sucursal: 'Lanús' }).contenido)
  const mes = partes.get('xl/worksheets/sheet1.xml')!
  assert.equal([...mes.matchAll(/<row r="/g)].length - 1, 2, 'en Lanús hay dos pólizas')
})

test('el escritor de Excel escapa lo que la hoja tiene escrito y no rompe el XML', async () => {
  await prepararBase()

  const partes = leerZip(
    construirXlsx([
      { nombre: 'Prueba', encabezados: ['A'], filas: [['GONZÁLEZ & CÍA <"S.A.">'], [12345]] },
    ]),
  )
  const hojaXml = partes.get('xl/worksheets/sheet1.xml')!
  assert.match(hojaXml, /GONZÁLEZ &amp; CÍA &lt;&quot;S.A.&quot;&gt;/)
  assert.match(hojaXml, /<v>12345<\/v>/, 'un número va como número, no como texto')
})

// ---------------------------------------------------------------------------
// Reportes
// ---------------------------------------------------------------------------

const FILTROS_VACIOS = { periodo: '', sucursal: '', compania: '', estado: '', busqueda: '', desde: '', hasta: '' }

test('el catálogo de reportes ofrece los módulos con sus filtros y columnas', async () => {
  await prepararBase()

  const catalogo = catalogoDeReportes()
  assert.ok(catalogo.reportes.length >= 10, 'tiene que haber un reporte por listado del programa')
  assert.ok(catalogo.periodos.includes(AGOSTO))
  for (const reporte of catalogo.reportes) {
    assert.ok(reporte.columnas.length > 0, `${reporte.id} sin columnas`)
    assert.ok(reporte.nombre.length > 0)
  }
})

test('el reporte de la planilla del mes devuelve las filas del mes y respeta los filtros', async () => {
  await prepararBase()

  const todas = vistaPreviaDeReporte({ reporteId: 'cartera', filtros: { ...FILTROS_VACIOS, periodo: AGOSTO }, columnas: [] })
  assert.equal(todas.total, planillaDelMes(AGOSTO).filas.length)
  assert.ok(todas.nombre.includes('Agosto'), 'el título dice de qué mes es')

  const lanus = vistaPreviaDeReporte({
    reporteId: 'cartera',
    filtros: { ...FILTROS_VACIOS, periodo: AGOSTO, sucursal: 'Lanús' },
    columnas: [],
  })
  assert.equal(lanus.total, 2)

  const impagas = vistaPreviaDeReporte({
    reporteId: 'cartera',
    filtros: { ...FILTROS_VACIOS, periodo: AGOSTO, estado: 'IMPAGA' },
    columnas: [],
  })
  assert.equal(impagas.total, 3)

  const buscada = vistaPreviaDeReporte({
    reporteId: 'cartera',
    filtros: { ...FILTROS_VACIOS, periodo: AGOSTO, busqueda: 'suarez' },
    columnas: [],
  })
  assert.equal(buscada.total, 1, 'la búsqueda ignora tildes y mayúsculas')
})

test('elegir columnas cambia el archivo y no la cantidad de filas', async () => {
  await prepararBase()

  const completo = vistaPreviaDeReporte({ reporteId: 'cartera', filtros: { ...FILTROS_VACIOS, periodo: AGOSTO }, columnas: [] })
  const recortado = vistaPreviaDeReporte({
    reporteId: 'cartera',
    filtros: { ...FILTROS_VACIOS, periodo: AGOSTO },
    columnas: ['nombre', 'compania'],
  })
  assert.equal(recortado.total, completo.total)
  assert.deepEqual(
    recortado.columnas.map((c) => c.id),
    ['nombre', 'compania'],
  )
  assert.equal(recortado.filas[0]!.length, 2)

  // Pedir columnas que no existen no puede dar un archivo vacío: se devuelven todas.
  const inventadas = vistaPreviaDeReporte({ reporteId: 'cartera', filtros: { ...FILTROS_VACIOS, periodo: AGOSTO }, columnas: ['nada'] })
  assert.equal(inventadas.columnas.length, completo.columnas.length)
})

test('un reporte sale igual a Excel que a PDF', async () => {
  await prepararBase()

  const pedido = { reporteId: 'siniestros', filtros: FILTROS_VACIOS, columnas: [] }
  const vista = vistaPreviaDeReporte(pedido)
  assert.equal(vista.total, 3)

  const excel = xlsxDelReporte(pedido)
  assert.match(excel.nombre, /\.xlsx$/)
  const mes = leerZip(excel.contenido).get('xl/worksheets/sheet1.xml')!
  // Fila 1 el título, fila 2 los encabezados, y una por siniestro.
  assert.equal([...mes.matchAll(/<row r="/g)].length, 2 + vista.total)

  const papel = htmlDelReporte(pedido)
  assert.match(papel.nombre, /\.pdf$/)
  assert.match(papel.html, /<table>/)
  assert.equal([...papel.html.matchAll(/<tr>/g)].length, 1 + vista.total)
})

test('el reporte de mora usa la misma definición que Cobranzas', async () => {
  await prepararBase()

  const vista = vistaPreviaDeReporte({ reporteId: 'mora', filtros: FILTROS_VACIOS, columnas: [] })
  assert.ok(vista.total > 0, 'la hoja de prueba deja cuotas vencidas sin pagar')
  // El débito automático no se persigue: no puede aparecer en la mora.
  const columnaFormaPago = vista.columnas.findIndex((c) => c.id === 'formaPago')
  for (const fila of vista.filas) assert.notEqual(normalizarTexto(fila[columnaFormaPago] ?? ''), 'DEBITO')
})

// ---------------------------------------------------------------------------
// Criterio 3: la plantilla de aviso
// ---------------------------------------------------------------------------

/** Una fila de la planilla del mes que sirva para avisar: la de Rodríguez, que paga por cuponera. */
function filaDeRodriguez() {
  const fila = planillaDelMes(AGOSTO).filas.find((f) => f.nombre === CLIENTES.rodriguez.nombre)
  assert.ok(fila, 'la planilla de agosto tiene que tener a Rodríguez')
  return fila
}

test('editar la plantilla de aviso cambia lo que manda el botón «Avisar» de Cartera', async () => {
  await prepararBase()

  const fila = filaDeRodriguez()

  // Antes: el mensaje de fábrica.
  const antes = prepararAviso(fila.filaId, DANIEL)
  assert.match(antes.mensaje, /vence la cuota de tu seguro/)

  guardarPlantillaDeAviso('Hola {nombre}: la cuota de {compania} por {patente} vence el {vencimiento} y sale {cuota}. Pasá por el local.')
  assert.match(plantillaDeAviso(), /^Hola \{nombre\}: la cuota/)

  const despues = prepararAviso(fila.filaId, DANIEL)
  assert.match(despues.mensaje, /^Hola ANA: la cuota de FEDERACION PATRONAL por 0KM vence el 10 y sale /)
  assert.ok(!despues.mensaje.includes('{'), 'no puede quedar ninguna variable sin reemplazar')
  assert.match(despues.url, /^https:\/\/wa\.me\/549/)
  assert.equal(despues.fila.aviso, 'ENVIADO', 'agosto es el mes abierto: la fila queda como ENVIADO')

  // Y vuelve a quedar como estaba para las pruebas que siguen.
  guardarPlantillaDeAviso('Hola {nombre}, te recordamos que el {vencimiento} vence la cuota de tu seguro por ${cuota}. Cualquier duda escribinos. Seguros Daniel Martínez.')
})

test('las plantillas se crean, se editan y la del aviso no se puede borrar', async () => {
  await prepararBase()

  const iniciales = listarPlantillas()
  assert.ok(iniciales.some((p) => p.clave === 'aviso_vencimiento' && p.fija))
  assert.ok(iniciales.every((p) => !p.ejemplo.includes('{')), 'el ejemplo se muestra con los datos ya puestos')

  const conNueva = crearPlantilla({ nombre: 'Cumpleaños', descripcion: 'Saludo', texto: '¡Feliz cumple, {nombre}!' })
  assert.equal(conNueva.length, iniciales.length + 1)
  const nueva = conNueva.find((p) => p.nombre === 'Cumpleaños')!
  assert.equal(nueva.clave, 'cumpleanos')
  assert.equal(nueva.ejemplo, '¡Feliz cumple, María!')

  const editadas = editarPlantilla(nueva.clave, { nombre: 'Cumpleaños', descripcion: 'Saludo', texto: 'Que los cumplas, {nombre}.' })
  assert.equal(editadas.find((p) => p.clave === nueva.clave)!.texto, 'Que los cumplas, {nombre}.')

  assert.throws(() => crearPlantilla({ nombre: 'Cumpleaños', descripcion: '', texto: 'x' }), /Ya hay una plantilla/)
  assert.throws(
    () => editarPlantilla(nueva.clave, { nombre: 'Cumpleaños', descripcion: '', texto: 'Hola {apellido}' }),
    /no es una variable válida/,
  )
  assert.throws(() => borrarPlantilla('aviso_vencimiento'), /no borrar/)

  assert.equal(borrarPlantilla(nueva.clave).length, iniciales.length)
})

// ---------------------------------------------------------------------------
// Criterio 4: los segmentos
// ---------------------------------------------------------------------------

/** El filtro equivalente aplicado a mano sobre la planilla del mes, que es contra lo que se compara. */
function equivalenteEnCartera(filtros: FiltrosDeSegmento): number {
  return planillaDelMes(AGOSTO).filas.filter((fila) => {
    if (filtros.sucursal && normalizarTexto(fila.sucursal) !== normalizarTexto(filtros.sucursal)) return false
    if (filtros.compania && normalizarTexto(fila.compania) !== normalizarTexto(filtros.compania)) return false
    if (filtros.formaPago && normalizarTexto(fila.formaPago) !== normalizarTexto(filtros.formaPago)) return false
    if (filtros.soloImpagas && ((fila.pago ?? '').trim() !== '' || fila.pagoRegistrado)) return false
    return true
  }).length
}

test('un segmento guardado devuelve lo mismo que el filtro equivalente en Cartera', async () => {
  await prepararBase()

  const filtros: FiltrosDeSegmento = { ...SEGMENTO_SIN_FILTROS, formaPago: 'CUPONERA', soloImpagas: true, excluirDebito: true }

  const suelto = resultadoDeSegmento(null, filtros, '', HOY)
  assert.equal(suelto.periodo, AGOSTO, 'el segmento trabaja sobre el mes abierto')
  assert.equal(suelto.total, equivalenteEnCartera(filtros))
  assert.equal(suelto.total, 1, 'la única cuponera impaga de agosto es Rodríguez')
  assert.equal(suelto.filas[0]!.nombre, CLIENTES.rodriguez.nombre)
  assert.equal(suelto.segmentoId, null)

  const guardado = guardarSegmento(null, { nombre: 'Cuponeras impagas', descripcion: '', filtros, plantillaClave: '' }, DANIEL)
  assert.ok(guardado.segmentoId)
  assert.equal(guardado.total, suelto.total, 'guardarlo no puede cambiar la lista')

  // Y volver a abrirlo por su id, con los filtros leídos de la base, da lo mismo.
  const reabierto = resultadoDeSegmento(guardado.segmentoId, null, '', HOY)
  assert.equal(reabierto.total, suelto.total)
  assert.deepEqual(reabierto.filtros, filtros)
  assert.equal(listarSegmentos().length, 1)

  borrarSegmento(guardado.segmentoId!)
  assert.equal(listarSegmentos().length, 0)
})

test('los filtros del segmento recortan la cartera de a uno', async () => {
  await prepararBase()

  const sinFiltros = resultadoDeSegmento(null, { ...SEGMENTO_SIN_FILTROS, soloImpagas: false, excluirDebito: false }, '', HOY)
  assert.equal(sinFiltros.total, planillaDelMes(AGOSTO).filas.length)

  const sinDebito = resultadoDeSegmento(null, { ...SEGMENTO_SIN_FILTROS, soloImpagas: false, excluirDebito: true }, '', HOY)
  assert.ok(sinDebito.total < sinFiltros.total, 'casi toda la cartera de prueba paga por débito')

  const impagas = resultadoDeSegmento(null, { ...SEGMENTO_SIN_FILTROS, soloImpagas: true, excluirDebito: false }, '', HOY)
  assert.equal(impagas.total, 3)

  // El día 5 de agosto, las cuotas que vencen el 10 caen dentro de la semana; las del 15, no.
  const estaSemana = resultadoDeSegmento(
    null,
    { ...SEGMENTO_SIN_FILTROS, soloImpagas: true, excluirDebito: false, vence: 'ESTA SEMANA' },
    '',
    HOY,
  )
  assert.equal(estaSemana.total, 2, 'Suárez vence el 15 y queda afuera')
  const esteMes = resultadoDeSegmento(
    null,
    { ...SEGMENTO_SIN_FILTROS, soloImpagas: true, excluirDebito: false, vence: 'ESTE MES' },
    '',
    HOY,
  )
  assert.equal(esteMes.total, 3, 'dentro del mes entran también las del 15')
  const vencidas = resultadoDeSegmento(
    null,
    { ...SEGMENTO_SIN_FILTROS, soloImpagas: true, excluirDebito: false, vence: 'VENCIDAS' },
    '',
    HOY,
  )
  assert.equal(vencidas.total, 0, 'el 5 de agosto todavía no venció ninguna')
})

test('avisar en un segmento usa su plantilla, marca la fila y mueve el contador', async () => {
  await prepararBase()

  const plantillas = crearPlantilla({ nombre: 'Recordatorio corto', descripcion: '', texto: '{nombre}, vence el {vencimiento}.' })
  const clave = plantillas.find((p) => p.nombre === 'Recordatorio corto')!.clave

  const filtros: FiltrosDeSegmento = { ...SEGMENTO_SIN_FILTROS, formaPago: 'TRANSFERENCIA', soloImpagas: true }
  const antes = resultadoDeSegmento(null, filtros, clave, HOY)
  assert.equal(antes.total, 1, 'la única por transferencia impaga es Suárez')
  assert.equal(antes.plantillaClave, clave)
  assert.equal(antes.filas[0]!.mensaje, 'NATALIA, vence el 15.')
  assert.equal(antes.avisados, 0)
  assert.equal(antes.filas[0]!.tieneTelefono, true)

  const aviso = avisarDeSegmento(antes.filas[0]!.filaId, null, filtros, clave, DANIEL)
  assert.equal(aviso.mensaje, 'NATALIA, vence el 15.')
  assert.match(aviso.url, /^https:\/\/wa\.me\/549\d+\?text=/)
  assert.equal(aviso.marcada, true)
  assert.equal(aviso.avisados, 1, 'el contador de avisados subió')
  assert.equal(aviso.fila.avisado, true)

  // Y con el filtro «sólo a las que no se les avisó» la fila sale de la lista.
  const sinAvisar = resultadoDeSegmento(null, { ...filtros, soloSinAvisar: true }, clave, HOY)
  assert.equal(sinAvisar.total, 0)

  borrarPlantilla(clave)
  // Al borrar la plantilla el segmento vuelve a la de vencimiento en vez de quedarse sin ninguna.
  assert.equal(resultadoDeSegmento(null, filtros, clave, HOY).plantillaClave, 'aviso_vencimiento')
})

// ---------------------------------------------------------------------------
// Actualización desde la fase anterior
// ---------------------------------------------------------------------------

test('una base de la Fase 8 se actualiza a la Fase 9 sin perder el aviso que ya tenía escrito', () => {
  const db = new Database(':memory:') as BaseDeDatos
  db.pragma('foreign_keys = ON')
  const registrar = console.log
  console.log = () => undefined
  try {
    for (const migracion of MIGRACIONES.filter((m) => m.version <= 9)) {
      db.exec(migracion.sql)
      db.pragma('user_version = ' + migracion.version)
    }
    sembrarDatosIniciales(db)
    // La agencia ya se había escrito su propio mensaje en Administración → Compañías.
    db.prepare(`INSERT INTO configuracion (clave, valor, actualizado_en) VALUES ('plantilla_aviso', ?, '2026-06-01T10:00:00.000Z')`).run(
      'Buenas {nombre}! Te vence el {vencimiento}. Daniel.',
    )
    ejecutarMigraciones(db)
  } finally {
    console.log = registrar
  }

  assert.equal(db.pragma('user_version', { simple: true }), MIGRACIONES[MIGRACIONES.length - 1]!.version)

  const aviso = db.prepare(`SELECT nombre, texto, fija FROM plantillas_mensaje WHERE clave = 'aviso_vencimiento'`).get() as {
    nombre: string
    texto: string
    fija: number
  }
  assert.equal(aviso.texto, 'Buenas {nombre}! Te vence el {vencimiento}. Daniel.', 'nadie tiene que volver a escribir su mensaje')
  assert.equal(aviso.fija, 1, 'la del botón «Avisar» queda marcada como fija')

  // Y llegan las demás plantillas de fábrica, más la tabla de segmentos vacía y lista.
  const total = (db.prepare('SELECT COUNT(*) AS n FROM plantillas_mensaje').get() as { n: number }).n
  assert.ok(total >= 4, 'además del aviso vienen las plantillas de fábrica')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM segmentos').get() as { n: number }).n, 0)
})

test('una base sin plantilla escrita arranca con el mensaje de fábrica', () => {
  const db = new Database(':memory:') as BaseDeDatos
  const registrar = console.log
  console.log = () => undefined
  try {
    ejecutarMigraciones(db)
  } finally {
    console.log = registrar
  }
  const texto = (db.prepare(`SELECT texto FROM plantillas_mensaje WHERE clave = 'aviso_vencimiento'`).get() as { texto: string }).texto
  assert.equal(texto, PLANTILLA_AVISO_POR_DEFECTO, 'el mensaje de fábrica es el mismo de siempre, con sus variables')
})
