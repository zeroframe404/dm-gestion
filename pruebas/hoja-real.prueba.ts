// Pruebas armadas con las formas que tiene la hoja REAL de Seguros Daniel Martínez, descubiertas al
// correr el importador contra una copia descargada: pestañas de bajas sin ninguna fila de encabezados,
// encabezados que no están en la fila 1, filas que repiten los títulos a mitad de la planilla,
// «DOCKSUD» sin espacio y la columna «VEHICULO» que es el tipo (AUTO/MOTO), no el modelo.
import assert from 'node:assert/strict'
import test from 'node:test'
import { HojaSimulada } from './hoja-simulada'
import { baseDePrueba, contar, filas, importar, problemasDeTipo, resumenDe, unico } from './ayuda'

/** Los encabezados de una planilla mensual real (con la columna vacía del medio y los espacios sobrantes). */
const ENC_MENSUAL_REAL = [
  'SUCURSAL',
  ' FECHA DE ALTA ',
  'NOMBRE Y APELLIDO',
  'TELÉFONO',
  'DNI/CUIT',
  'DIRECCIÓN',
  'C/POST',
  'LOCALIDAD',
  'FECHA DE VENC',
  '',
  '',
  'CUOTA',
  'FORMA DE PAGO ',
  'OB. AVISOS ',
  'VEHICULO',
  'MARCA',
  'MODELO',
  'MOTOR',
  'CHASIS',
  'PATENTE',
  'AÑO',
  'COBERTURA',
  'OBS',
  'COMPAÑIA',
  'PRODUCTOR',
  'POLIZA',
]

function filaReal(nombre: string, dni: string, patente: string, poliza: string, cuota: string): string[] {
  return [
    'DOCK SUD',
    '3/7/2025',
    nombre,
    '11 6422-3812',
    dni,
    'AYOLAS 123',
    '1871',
    'AVELLANEDA',
    '10',
    '',
    '',
    cuota,
    'CUPONERA',
    '',
    'AUTO',
    'FIAT',
    'CRONOS 1.3',
    'MOT1',
    'CHA1',
    patente,
    '2019',
    'TERCEROS COMPLETO',
    '',
    'SANCOR',
    'MARTINEZ',
    poliza,
  ]
}

/** Como en la hoja real: la pestaña de bajas arranca con datos, sin ninguna fila de encabezados. */
function hojaConBajasSinEncabezados(): HojaSimulada {
  return new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [ENC_MENSUAL_REAL, filaReal('ROSSI CESAR', '27.111.222', 'AB123CD', '500100', '$ 42.000'), filaReal('SOSA MARIA', '30.444.555', 'AC456EF', '500200', '$ 38.000')],
      columnas: ENC_MENSUAL_REAL.length,
    },
    {
      titulo: 'BAJAS AGOSTO',
      valores: [filaReal('TOLEDO ANTONIO', '26.398.984', 'EDR906', '400100', '$ 92.900'), filaReal('DIAZ HECTOR', '14.777.888', 'QWE789', '400200', '$ 31.500')],
      columnas: ENC_MENSUAL_REAL.length,
    },
  ])
}

test('una pestaña de bajas sin encabezados usa el layout de la mensual y guarda sus filas', async () => {
  const hoja = hojaConBajasSinEncabezados()
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(contar(db, 'bajas'), 2, 'las dos bajas tienen que entrar')
  assert.equal(unico<string>(db, `SELECT cliente_nombre FROM bajas WHERE numero_poliza = '400100'`), 'TOLEDO ANTONIO')
  assert.equal(unico<string>(db, `SELECT patente FROM bajas WHERE numero_poliza = '400100'`), 'EDR906')
  assert.ok(informe.avisos.some((a) => /no tiene fila de encabezados/.test(a)))
  // Sus datos arrancan en la fila 1: no se pierde la primera.
  assert.equal(resumenDe(informe, 'BAJAS AGOSTO').filasConDatos, 2)
  db.close()
})

test('volver a importar una pestaña sin encabezados no duplica: el _ID se reconoce por su contenido', async () => {
  const hoja = hojaConBajasSinEncabezados()
  const db = baseDePrueba()
  await importar(db, hoja)
  const antes = { bajas: contar(db, 'bajas'), crudas: contar(db, 'filas_crudas') }
  const idsAntes = hoja.filasDe('BAJAS AGOSTO').map((f) => f[f.length - 1])

  const { informe } = await importar(db, hoja)
  assert.equal(contar(db, 'bajas'), antes.bajas, 'la segunda corrida duplicó las bajas')
  assert.equal(contar(db, 'filas_crudas'), antes.crudas)
  assert.equal(resumenDe(informe, 'BAJAS AGOSTO').idsNuevos, 0, 'no puede generar _ID nuevos')
  assert.equal(resumenDe(informe, 'BAJAS AGOSTO').idsExistentes, 2)
  assert.deepEqual(
    hoja.filasDe('BAJAS AGOSTO').map((f) => f[f.length - 1]),
    idsAntes,
    'los _ID de la pestaña sin encabezados tienen que ser los mismos',
  )
  db.close()
})

test('los encabezados que no están en la fila 1 se detectan igual', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'SINIESTROS',
      valores: [
        ['SINIESTROS 2026', '', ''],
        ['', '', ''],
        ['FECHA', 'NOMBRE', 'DNI', 'PATENTE', 'CIA', 'N° SINIESTRO', 'DESCRIPCION'],
        ['12/04/2026', 'PEREZ JUAN', '25.111.222', 'AB123CD', 'SANCOR', 'S-1', 'CHOQUE'],
        ['15/05/2026', 'GOMEZ ANA', '30.444.555', 'AC456EF', 'RIVADAVIA', 'S-2', 'GRANIZO'],
      ],
    },
  ])
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(contar(db, 'siniestros'), 2)
  assert.equal(unico<string>(db, `SELECT descripcion FROM siniestros WHERE numero_siniestro = 'S-1'`), 'CHOQUE')
  assert.ok(informe.avisos.some((a) => /encabezados están en la fila 3/.test(a)))
  db.close()
})

test('las filas que repiten los encabezados a mitad de la planilla no son clientes', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ENC_MENSUAL_REAL,
        filaReal('ROSSI CESAR', '27.111.222', 'AB123CD', '500100', '$ 42.000'),
        [...ENC_MENSUAL_REAL],
        filaReal('SOSA MARIA', '30.444.555', 'AC456EF', '500200', '$ 38.000'),
      ],
      columnas: ENC_MENSUAL_REAL.length,
    },
  ])
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.equal(contar(db, 'clientes'), 2, 'la fila repetida de encabezados no puede ser un cliente')
  assert.equal(contar(db, 'cuotas_mes'), 2)
  assert.equal(problemasDeTipo(informe, 'encabezados repetidos en el medio').length, 1)
  db.close()
})

test('«DOCKSUD» sin espacio es Dock Sud, y «A/D» en la patente no es un error', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'SUCURSAL', 'PATENTE', 'CIA', 'NRO DE POLIZA', 'CUOTA', 'DIA DE VTO'],
        ['ROSSI CESAR', '27.111.222', 'DOCKSUD', 'A/D', 'SANCOR', '500100', '$ 42.000', '10'],
        ['SOSA MARIA', '30.444.555', 'LANUS', 'jona', 'SANCOR', '500200', '$ 38.000', '10'],
      ],
    },
  ])
  const db = baseDePrueba()
  const { informe } = await importar(db, hoja)

  assert.deepEqual(informe.sucursalesDesconocidas, {}, '«DOCKSUD» es la misma sucursal que «DOCK SUD»')
  assert.ok(unico<number>(db, `SELECT sucursal_id FROM clientes WHERE nombre = 'ROSSI CESAR'`) > 0)
  // «A/D» es un marcador conocido; «jona» sí es un error de tipeo.
  const ilegibles = problemasDeTipo(informe, 'patente ilegible')
  assert.equal(ilegibles.length, 1)
  assert.match(ilegibles[0]!.detalle, /jona/)
  db.close()
})

test('«VEHICULO» es el tipo (AUTO/MOTO) cuando la planilla ya tiene MARCA y MODELO', async () => {
  const hoja = new HojaSimulada([
    {
      titulo: 'AGOSTO',
      valores: [
        ['APELLIDO Y NOMBRE', 'DNI', 'CIA', 'NRO DE POLIZA', 'VEHICULO', 'MARCA', 'MODELO', 'PATENTE', 'CUOTA', 'DIA DE VTO'],
        ['ROSSI CESAR', '27.111.222', 'SANCOR', '500100', 'AUTO', 'FIAT', 'CRONOS 1.3', 'AB123CD', '$ 42.000', '10'],
      ],
    },
  ])
  const db = baseDePrueba()
  await importar(db, hoja)
  const vehiculo = filas<{ tipo: string; marca: string; modelo: string }>(db, 'SELECT tipo, marca, modelo FROM vehiculos')[0]!
  assert.equal(vehiculo.tipo, 'AUTO')
  assert.equal(vehiculo.marca, 'FIAT')
  assert.equal(vehiculo.modelo, 'CRONOS 1.3')
  db.close()
})
