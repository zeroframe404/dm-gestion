// Pruebas del importador contra la hoja simulada que replica la estructura de la hoja real.
// Cada bloque verifica un punto del pedido de la Fase 2.
import assert from 'node:assert/strict'
import test from 'node:test'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { baseDePrueba, contar, filas, importar, problemasDeTipo, resumenDe, unico } from './ayuda'
import { generarTextoDeInforme } from '../src/main/importacion/informe'

const TITULOS_ESPERADOS = [
  'DICIEMBRE25',
  'BAJAS DICIEMBRE',
  'ENERO',
  'BAJAS ENERO',
  'FEBRERO',
  'BAJAS FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'BAJAS JULIO',
  'AGOSTO',
  'BAJAS AGOSTO',
  'AMP',
  'RIESGOS VARIOS',
  'IMPUTADOS',
  'SINIESTROS',
  'CONTADOR',
  'SEGUROS ACT',
  'COBERTURA',
]

function hojaCompleta(): HojaSimulada {
  return new HojaSimulada(construirHojaDePrueba())
}

// ---------------------------------------------------------------------------

test('la hoja de prueba tiene la misma forma que la real', () => {
  assert.deepEqual(hojaCompleta().titulos(), TITULOS_ESPERADOS)
})

test('clasifica cada pestaña y elige AGOSTO como la planilla más nueva', async () => {
  const db = baseDePrueba()
  const { informe } = await importar(db, hojaCompleta())

  assert.equal(informe.estado, 'COMPLETA', `estado inesperado: ${informe.error ?? ''}`)
  assert.equal(informe.pestanaMasNueva, 'AGOSTO')

  const tipoDe = (titulo: string) => resumenDe(informe, titulo).tipo
  assert.equal(tipoDe('DICIEMBRE25'), 'MENSUAL')
  assert.equal(tipoDe('ENERO'), 'MENSUAL')
  assert.equal(tipoDe('BAJAS JULIO'), 'BAJAS')
  assert.equal(tipoDe('RIESGOS VARIOS'), 'RIESGOS_VARIOS')
  assert.equal(tipoDe('IMPUTADOS'), 'PAGOS')
  assert.equal(tipoDe('SINIESTROS'), 'SINIESTROS')
  assert.equal(tipoDe('COBERTURA'), 'COBERTURA')
  assert.equal(tipoDe('CONTADOR'), 'CONTADOR')
  assert.equal(tipoDe('SEGUROS ACT'), 'SEGUROS_ACT')
  assert.equal(tipoDe('AMP'), 'AMP')

  // El año se deduce por el orden: DICIEMBRE25 es 2025 y de ENERO en adelante, 2026.
  assert.equal(resumenDe(informe, 'DICIEMBRE25').periodo, '2025-12')
  assert.equal(resumenDe(informe, 'ENERO').periodo, '2026-01')
  assert.equal(resumenDe(informe, 'AGOSTO').periodo, '2026-08')
  assert.equal(resumenDe(informe, 'BAJAS JULIO').periodo, '2026-07')

  db.close()
})

test('mapea por nombre de encabezado aunque las columnas cambien de lugar en cada mes', async () => {
  const db = baseDePrueba()
  await importar(db, hojaCompleta())

  // En ENERO la patente está en la columna U; en FEBRERO, en la R; en AGOSTO, en la V («DOMINIO»).
  const patenteEn = (periodo: string) =>
    unico<string>(db, 'SELECT patente FROM cuotas_mes WHERE periodo = ? AND numero_poliza = ?', periodo, CLIENTES.gonzalez.poliza)
  assert.equal(patenteEn('2026-01'), CLIENTES.gonzalez.patente)
  assert.equal(patenteEn('2026-02'), CLIENTES.gonzalez.patente)
  assert.equal(patenteEn('2026-08'), CLIENTES.gonzalez.patente)

  // La sucursal sale de «LOCAL» (ENERO), «SUCURSAL» (FEBRERO/AGOSTO) y «SUC» (MARZO…JULIO).
  for (const periodo of ['2025-12', '2026-01', '2026-02', '2026-05', '2026-08']) {
    assert.equal(
      unico<string>(db, 'SELECT sucursal_texto FROM cuotas_mes WHERE periodo = ? AND numero_poliza = ?', periodo, CLIENTES.lopez.poliza),
      'Sarandí',
      `la sucursal de ${periodo} no se mapeó`,
    )
  }

  // Las observaciones salen de «OB. DE COBERTURAS» en ENERO.
  assert.match(
    unico<string>(db, 'SELECT observaciones FROM cuotas_mes WHERE periodo = ? AND numero_poliza = ?', '2026-01', CLIENTES.rodriguez.poliza),
    /CONCESIONARIA/,
  )

  db.close()
})

test('el vehículo arranca en la columna R en ENERO y en la O en FEBRERO', async () => {
  const db = baseDePrueba()
  const { informe } = await importar(db, hojaCompleta())

  const columnaDe = (pestana: string, campo: string) => resumenDe(informe, pestana).columnas.find((c) => c.campo === campo)?.columna
  assert.equal(columnaDe('ENERO', 'marca'), 'R')
  assert.equal(columnaDe('FEBRERO', 'marca'), 'O')
  assert.equal(columnaDe('AGOSTO', 'marca'), 'S')

  db.close()
})

test('la planilla más nueva define clientes, vehículos y pólizas activas', async () => {
  const db = baseDePrueba()
  await importar(db, hojaCompleta())

  // Cinco clientes: González (con Martínez unificada por DNI), Pérez (auto y moto), Rodríguez, López y Suárez.
  assert.equal(contar(db, 'clientes'), 5)
  assert.equal(contar(db, 'polizas'), 7)
  assert.equal(contar(db, 'polizas', 'activa = 1'), 7)
  assert.equal(contar(db, 'vehiculos'), 7)

  // Fernández se dio de baja en julio: no está en AGOSTO, así que no es cliente actual…
  assert.equal(contar(db, 'clientes', `documento_normalizado = '${CLIENTES.fernandez.dniPlano}'`), 0)
  // …pero sus cuotas históricas sí quedaron guardadas.
  assert.equal(contar(db, 'cuotas_mes', `numero_poliza = '${CLIENTES.fernandez.poliza}'`), 8)
  assert.equal(contar(db, 'cuotas_mes', `numero_poliza = '${CLIENTES.fernandez.poliza}' AND periodo = '2026-08'`), 0)

  // Suárez es alta nueva de agosto: existe y sólo tiene la cuota de agosto.
  assert.equal(contar(db, 'clientes', `documento_normalizado = '${CLIENTES.suarez.dniPlano}'`), 1)
  assert.equal(contar(db, 'cuotas_mes', `numero_poliza = '${CLIENTES.suarez.poliza}'`), 1)

  db.close()
})

test('una fila por póliza y mes en cuotas_mes', async () => {
  const db = baseDePrueba()
  await importar(db, hojaCompleta())

  const porPeriodo = filas<{ periodo: string; total: number }>(db, 'SELECT periodo, COUNT(*) AS total FROM cuotas_mes GROUP BY periodo ORDER BY periodo')
  assert.deepEqual(
    porPeriodo.map((f) => f.periodo),
    ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'],
  )
  for (const fila of porPeriodo) assert.equal(fila.total, 7, `${fila.periodo} tendría que tener 7 filas`)

  // Ninguna póliza aparece dos veces en el mismo mes.
  const repetidas = filas(db, 'SELECT periodo, numero_poliza, COUNT(*) AS total FROM cuotas_mes GROUP BY periodo, numero_poliza HAVING total > 1')
  assert.deepEqual(repetidas, [])

  // Las cuotas de los meses viejos se enganchan con la póliza actual.
  const enganchadas = contar(db, 'cuotas_mes', `periodo = '2026-01' AND poliza_id IS NOT NULL`)
  assert.equal(enganchadas, 6, 'sólo Fernández (que ya no está en la cartera) puede quedar sin póliza')

  db.close()
})

test('guarda los valores tal cual: A/D, ---, textos en la cuota', async () => {
  const db = baseDePrueba()
  const { informe } = await importar(db, hojaCompleta())

  const cuotaDe = (periodo: string, poliza: string) => unico<string>(db, 'SELECT cuota FROM cuotas_mes WHERE periodo = ? AND numero_poliza = ?', periodo, poliza)
  assert.equal(cuotaDe('2026-02', CLIENTES.gonzalez.poliza), 'A/D')
  assert.equal(cuotaDe('2026-01', CLIENTES.rodriguez.poliza), '---')
  assert.equal(cuotaDe('2026-08', CLIENTES.lopez.poliza), 'PREGUNTAR A DANIEL')

  // El importe se guarda con su formato original y además se interpreta el número.
  const enero = filas<{ cuota: string; cuota_monto: number }>(db, `SELECT cuota, cuota_monto FROM cuotas_mes WHERE periodo = '2026-01' AND numero_poliza = ?`, CLIENTES.gonzalez.poliza)[0]!
  assert.match(enero.cuota, /^\$ 19\.240$/)
  assert.equal(enero.cuota_monto, 19240)

  // «A/D» y «---» son textos conocidos: no se informan como dato raro.
  const cuotasRaras = problemasDeTipo(informe, 'cuota no numérica')
  assert.equal(cuotasRaras.length, 1)
  assert.match(cuotasRaras[0]!.detalle, /PREGUNTAR A DANIEL/)

  db.close()
})

test('cliente único por DNI/CUIT: unifica y guarda todas sus pólizas', async () => {
  const db = baseDePrueba()
  const { informe } = await importar(db, hojaCompleta())

  // El CUIT 20-30111222-3 y el DNI 30111222 son la misma persona: un cliente, dos pólizas.
  const perez = filas<{ id: number; nombre: string }>(db, 'SELECT id, nombre FROM clientes WHERE documento_normalizado = ?', CLIENTES.perezAuto.dniPlano)
  assert.equal(perez.length, 1)
  assert.equal(contar(db, 'polizas', `cliente_id = ${perez[0]!.id}`), 2)

  // Dos personas distintas con el mismo DNI: se unifican y queda avisado en el informe.
  const repetidos = problemasDeTipo(informe, 'DNI/CUIT repetido')
  assert.ok(repetidos.some((r) => /MARTINEZ SILVIA/.test(r.detalle)), 'tiene que nombrar a las dos personas con el mismo DNI')
  assert.equal(contar(db, 'clientes', `documento_normalizado = '${CLIENTES.gonzalez.dniPlano}'`), 1)

  db.close()
})

test('escribe la columna _ID al final de cada pestaña y la oculta', async () => {
  const hoja = hojaCompleta()
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  for (const titulo of TITULOS_ESPERADOS) {
    const encabezados = hoja.encabezadosDe(titulo)
    const columnaId = hoja.columnaIdDe(titulo)
    assert.ok(columnaId >= 0, `«${titulo}» no tiene columna _ID`)
    assert.equal(columnaId, encabezados.length - 1, `en «${titulo}» el _ID no quedó al final`)
    assert.ok(hoja.columnasOcultasDe(titulo).includes(columnaId), `en «${titulo}» no se ocultó el _ID`)

    const ids = [...hoja.idsDe(titulo).values()]
    assert.equal(new Set(ids).size, ids.length, `hay _ID repetidos en «${titulo}»`)
    for (const id of ids) assert.match(id, /^[a-z0-9]{12}$/, `_ID con formato raro en «${titulo}»`)
  }

  // AGOSTO tiene 32 columnas de datos: el _ID va en la AG y hubo que agrandar la grilla.
  assert.equal(resumenDe(informe, 'AGOSTO').columnaId, 'AG')
  assert.ok(hoja.llamadas.asegurarColumnas > 0)

  // Todas las filas con datos tienen su _ID, y ese _ID es la clave de filas_crudas.
  const idsAgosto = hoja.idsDe('AGOSTO')
  assert.equal(idsAgosto.size, 7)
  for (const id of idsAgosto.values()) {
    assert.equal(contar(db, 'filas_crudas', `fila_id = '${id}'`), 1, `el _ID ${id} no está en filas_crudas`)
  }

  db.close()
})

test('correr la importación de nuevo no duplica nada y reusa los _ID', async () => {
  const hoja = hojaCompleta()
  const db = baseDePrueba()

  const primera = await importar(db, hoja)
  const antes = {
    clientes: contar(db, 'clientes'),
    vehiculos: contar(db, 'vehiculos'),
    polizas: contar(db, 'polizas'),
    cuotas: contar(db, 'cuotas_mes'),
    bajas: contar(db, 'bajas'),
    riesgos: contar(db, 'riesgos_varios'),
    siniestros: contar(db, 'siniestros'),
    pagos: contar(db, 'pagos'),
    reglas: contar(db, 'reglas_cobertura'),
    crudas: contar(db, 'filas_crudas'),
  }
  const idsPrimera = hoja.idsDe('AGOSTO')

  const segunda = await importar(db, hoja)
  assert.equal(segunda.informe.estado, 'COMPLETA')

  assert.deepEqual(
    {
      clientes: contar(db, 'clientes'),
      vehiculos: contar(db, 'vehiculos'),
      polizas: contar(db, 'polizas'),
      cuotas: contar(db, 'cuotas_mes'),
      bajas: contar(db, 'bajas'),
      riesgos: contar(db, 'riesgos_varios'),
      siniestros: contar(db, 'siniestros'),
      pagos: contar(db, 'pagos'),
      reglas: contar(db, 'reglas_cobertura'),
      crudas: contar(db, 'filas_crudas'),
    },
    antes,
    'la segunda corrida duplicó registros',
  )

  // Los _ID de la hoja son los mismos y la segunda corrida no generó ninguno nuevo.
  assert.deepEqual([...hoja.idsDe('AGOSTO')], [...idsPrimera])
  for (const resumen of segunda.informe.pestanas) {
    assert.equal(resumen.idsNuevos, 0, `«${resumen.titulo}» generó _ID nuevos en la segunda corrida`)
  }
  // Y todas las pólizas siguen activas: nada se dio de baja por error.
  assert.equal(contar(db, 'polizas', 'activa = 1'), primera.informe.totales.polizas)

  db.close()
})

test('una fila nueva en la hoja se agrega sin tocar las demás', async () => {
  const hoja = hojaCompleta()
  const db = baseDePrueba()
  await importar(db, hoja)
  const cuotasAntes = contar(db, 'cuotas_mes')

  // Alta cargada a mano en AGOSTO, sin _ID (como haría el usuario).
  const fila = new Array(32).fill('')
  fila[0] = 'IBARRA LUCIA'
  fila[1] = '35.888.999'
  fila[6] = 'DANIEL'
  fila[8] = 'SANCOR'
  fila[9] = '666333'
  fila[18] = 'FIAT'
  fila[19] = 'MOBI'
  fila[20] = '2022'
  fila[21] = 'AG333NN'
  fila[27] = '$ 19.900'
  fila[28] = '10'
  hoja.agregarFila('AGOSTO', fila)

  const { informe } = await importar(db, hoja)
  assert.equal(resumenDe(informe, 'AGOSTO').idsNuevos, 1)
  assert.equal(contar(db, 'cuotas_mes'), cuotasAntes + 1)
  assert.equal(contar(db, 'clientes', `documento_normalizado = '35888999'`), 1)
  assert.equal(contar(db, 'polizas', 'activa = 1'), 8)

  db.close()
})

test('las pólizas que dejan de estar en la planilla más nueva quedan inactivas', async () => {
  const hoja = hojaCompleta()
  const db = baseDePrueba()

  // Primera corrida sin AGOSTO: la planilla más nueva es JULIO y Fernández todavía está en la cartera.
  const agosto = hoja.quitarPestana('AGOSTO')
  const bajasAgosto = hoja.quitarPestana('BAJAS AGOSTO')
  const primera = await importar(db, hoja)
  assert.equal(primera.informe.pestanaMasNueva, 'JULIO')
  assert.equal(contar(db, 'polizas', 'activa = 1'), 7)
  assert.equal(contar(db, 'polizas', `numero = '${CLIENTES.fernandez.poliza}' AND activa = 1`), 1)

  // Segunda corrida con AGOSTO: Fernández ya no está y su póliza deja de estar activa (no se borra).
  hoja.restaurarPestana(agosto)
  hoja.restaurarPestana(bajasAgosto)
  const segunda = await importar(db, hoja)
  assert.equal(segunda.informe.pestanaMasNueva, 'AGOSTO')
  assert.equal(contar(db, 'polizas', `numero = '${CLIENTES.fernandez.poliza}' AND activa = 0`), 1)
  assert.equal(contar(db, 'polizas', 'activa = 1'), 7)
  assert.equal(contar(db, 'polizas'), 8)
  assert.equal(segunda.informe.totales.polizasInactivadas, 1)

  // La baja de julio quedó registrada con su motivo y su mes.
  const baja = filas<{ motivo: string; periodo: string; mes_texto: string }>(db, 'SELECT motivo, periodo, mes_texto FROM bajas WHERE numero_poliza = ?', CLIENTES.fernandez.poliza)[0]!
  assert.equal(baja.motivo, 'SE PASO A OTRO PRODUCTOR')
  assert.equal(baja.periodo, '2026-07')
  assert.equal(baja.mes_texto, 'JULIO')

  db.close()
})

test('llena riesgos varios, siniestros, pagos y reglas de cobertura', async () => {
  const db = baseDePrueba()
  await importar(db, hojaCompleta())

  assert.equal(contar(db, 'riesgos_varios'), 2)
  assert.equal(unico<string>(db, `SELECT tipo_riesgo FROM riesgos_varios WHERE numero_poliza = 'CF-4455'`), 'COMBINADO FAMILIAR')

  assert.equal(contar(db, 'siniestros'), 3)
  assert.equal(unico<string>(db, `SELECT fecha_iso FROM siniestros WHERE numero_siniestro = 'S-2026-0412'`), '2026-04-12')

  assert.equal(contar(db, 'pagos'), 3)
  assert.equal(unico<number>(db, `SELECT importe_monto FROM pagos WHERE numero_poliza = '998877'`), 16236)
  assert.equal(unico<string>(db, `SELECT medio FROM pagos WHERE numero_poliza = '998877'`), 'EFECTIVO')

  assert.equal(contar(db, 'reglas_cobertura'), 3)
  assert.equal(unico<string>(db, `SELECT franquicia FROM reglas_cobertura WHERE cobertura = 'TODO RIESGO'`), '$ 350.000')

  // Las pestañas sin mapeo a una tabla igual quedan completas en filas crudas.
  assert.equal(contar(db, 'filas_crudas', `pestana = 'CONTADOR'`), 2)
  assert.equal(contar(db, 'filas_crudas', `pestana = 'SEGUROS ACT'`), 2)
  assert.equal(contar(db, 'filas_crudas', `pestana = 'AMP'`), 2)

  db.close()
})

test('informa los datos raros sin frenar la importación', async () => {
  const db = baseDePrueba()
  const { informe } = await importar(db, hojaCompleta())

  assert.equal(informe.estado, 'COMPLETA')
  for (const resumen of informe.pestanas) {
    assert.ok(resumen.estado === 'lista' || resumen.estado === 'omitida', `«${resumen.titulo}» quedó en estado ${resumen.estado}`)
  }

  const tipos = informe.problemasPorTipo
  // Fechas imposibles: 31/02 en MARZO, 32/08 en IMPUTADOS y 30/02 en SINIESTROS.
  assert.ok((tipos['fecha de pago inválida'] ?? 0) >= 2, 'faltan las fechas de pago imposibles')
  assert.equal(tipos['fecha de siniestro inválida'], 1)
  assert.match(problemasDeTipo(informe, 'fecha de siniestro inválida')[0]!.detalle, /30\/02\/2026/)
  // Cuota no numérica y año de vehículo mal tipeado.
  assert.equal(tipos['cuota no numérica'], 1)
  assert.equal(tipos['año de vehículo dudoso'], 1)
  assert.equal(tipos['importe no numérico'], 1)
  // Vencimiento ilegible: «no sabe» en las planillas de marzo a julio.
  assert.equal(tipos['vencimiento ilegible'], 5)
  // DNI repetido con dos nombres distintos.
  assert.equal(tipos['DNI/CUIT repetido'], 2, 'González/Martínez comparten DNI y Pérez tiene dos pólizas')
  // Filas de TOTAL al pie: no son pólizas.
  assert.equal(tipos['fila de totales'], 2)

  // Sucursales fuera de catálogo: sólo BRENDA. «SARANDI» sí es del catálogo —es una de las cuatro— y
  // se guarda como «Sarandí», así que no aparece acá.
  assert.deepEqual(Object.keys(informe.sucursalesDesconocidas).sort(), ['BRENDA'])
  assert.equal(informe.sucursalesDesconocidas['BRENDA'], 9)

  db.close()
})

test('el informe descargable trae los totales por pestaña y el detalle', async () => {
  const db = baseDePrueba()
  const { informe } = await importar(db, hojaCompleta())
  const texto = generarTextoDeInforme(informe)

  assert.match(texto, /INFORME DE IMPORTACIÓN/)
  assert.match(texto, /Planilla más nueva.*AGOSTO/)
  for (const titulo of TITULOS_ESPERADOS) assert.ok(texto.includes(`«${titulo}»`), `el informe no menciona «${titulo}»`)
  assert.match(texto, /SUCURSALES FUERA DE CATÁLOGO/)
  assert.match(texto, /BRENDA/)
  assert.match(texto, /COLUMNAS RECONOCIDAS POR PESTAÑA/)
  assert.match(texto, /DETALLE DE FILAS CON DATOS RAROS/)
  // Cada pestaña informa cuántas filas entraron.
  assert.match(texto, /Filas leídas: \d+ \| con datos: \d+/)

  db.close()
})

test('el progreso avisa pestaña por pestaña y termina en 100', async () => {
  const db = baseDePrueba()
  const { progresos } = await importar(db, hojaCompleta())

  assert.ok(progresos.length > TITULOS_ESPERADOS.length)
  assert.equal(progresos[0]!.fase, 'preparando')
  const ultimo = progresos[progresos.length - 1]!
  assert.equal(ultimo.fase, 'terminada')
  assert.equal(ultimo.porcentaje, 100)

  // Todas las pestañas pasaron por «leyendo» y terminaron «lista».
  const estados = new Map<string, Set<string>>()
  for (const progreso of progresos) {
    for (const p of progreso.pestanas) {
      if (!estados.has(p.titulo)) estados.set(p.titulo, new Set())
      estados.get(p.titulo)!.add(p.estado)
    }
  }
  for (const titulo of TITULOS_ESPERADOS) {
    const vistos = estados.get(titulo)
    assert.ok(vistos, `«${titulo}» nunca apareció en el progreso`)
    assert.ok(vistos.has('leyendo'), `«${titulo}» nunca informó que se estaba leyendo`)
    assert.ok(vistos.has('lista'), `«${titulo}» nunca informó que terminó`)
  }
  // El porcentaje nunca retrocede.
  let maximo = 0
  for (const progreso of progresos) {
    assert.ok(progreso.porcentaje >= maximo - 1, `el porcentaje retrocedió de ${maximo} a ${progreso.porcentaje}`)
    maximo = Math.max(maximo, progreso.porcentaje)
  }

  db.close()
})

test('se puede cancelar a mitad de camino sin romper la base', async () => {
  const db = baseDePrueba()
  // Se cancela recién cuando ya entraron dos pestañas completas, así la prueba no depende de cuántas
  // veces se consulte la cancelación.
  const { informe } = await importar(db, hojaCompleta(), {
    estaCancelada: () => unico<number>(db, 'SELECT COUNT(DISTINCT pestana) FROM filas_crudas') >= 2,
  })

  assert.equal(informe.estado, 'CANCELADA')
  assert.ok(informe.avisos.some((a) => /canceló/.test(a)))
  assert.ok(informe.pestanas.some((p) => p.estado === 'lista'))
  // Lo que alcanzó a entrar quedó bien guardado y se puede volver a correr.
  assert.ok(contar(db, 'filas_crudas') > 0)
  assert.equal(contar(db, 'polizas', 'activa = 0'), 0, 'una cancelación no puede dar de baja pólizas')

  db.close()
})

test('una pestaña vacía o sin encabezados conocidos no frena ni define la cartera', async () => {
  const pestanas = construirHojaDePrueba()
  // Alguien creó la planilla del mes que viene con sólo los títulos.
  pestanas.push({ titulo: 'SEPTIEMBRE', valores: [['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'CUOTA']] })
  const hoja = new HojaSimulada(pestanas)
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(informe.pestanaMasNueva, 'AGOSTO', 'una planilla vacía no puede definir la cartera')
  assert.ok(informe.avisos.some((a) => /SEPTIEMBRE/.test(a)))
  assert.equal(contar(db, 'polizas', 'activa = 1'), 7)

  db.close()
})
