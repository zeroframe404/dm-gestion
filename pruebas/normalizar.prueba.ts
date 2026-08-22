// Pruebas de las funciones que interpretan lo que la gente escribe en la planilla.
import assert from 'node:assert/strict'
import test from 'node:test'
import { clasificarPestana, clasificarPestanas } from '../src/main/importacion/pestanas'
import { mapearEncabezados, primeraColumnaLibre, columnaLibreParaId } from '../src/main/importacion/encabezados'
import {
  esTextoDeCuotaConocido,
  interpretarAviso,
  interpretarDiaDeVencimiento,
  interpretarFecha,
  interpretarFechaDePeriodo,
  interpretarNumero,
  letraColumna,
  limpiar,
  normalizarDocumento,
  normalizarPatente,
  normalizarTexto,
} from '../src/main/importacion/normalizar'

test('limpiar saca sólo los espacios sobrantes (incluido el espacio duro)', () => {
  assert.equal(limpiar('  GONZALEZ  '), 'GONZALEZ')
  assert.equal(limpiar(' AB123CD '), 'AB123CD')
  assert.equal(limpiar('A/D'), 'A/D')
  assert.equal(limpiar('---'), '---')
  assert.equal(limpiar(null), '')
})

test('normalizarTexto ignora tildes, puntuación y espacios repetidos', () => {
  assert.equal(normalizarTexto('N° PÓLIZA'), 'N POLIZA')
  assert.equal(normalizarTexto('OB. DE COBERTURAS'), 'OB DE COBERTURAS')
  assert.equal(normalizarTexto('AÑO'), 'ANO')
  assert.equal(normalizarTexto('  D.N.I.  '), 'D N I')
  assert.equal(normalizarTexto('Compañía   Aseguradora'), 'COMPANIA ASEGURADORA')
})

test('normalizarDocumento unifica DNI y CUIT de la misma persona', () => {
  assert.equal(normalizarDocumento('27.345.678'), '27345678')
  assert.equal(normalizarDocumento('20-30111222-3'), '30111222')
  assert.equal(normalizarDocumento('27 30111222 4'), '30111222')
  assert.equal(normalizarDocumento('030111222'), '30111222')
  // Un CUIT de empresa no es un DNI: se conserva entero.
  assert.equal(normalizarDocumento('30-71234567-9'), '30712345679')
})

test('normalizarPatente no funde los vehículos sin patente', () => {
  assert.equal(normalizarPatente('AB 123 CD'), 'AB123CD')
  assert.equal(normalizarPatente('ab123cd'), 'AB123CD')
  assert.equal(normalizarPatente('XYZ-123'), 'XYZ123')
  assert.equal(normalizarPatente('SIN PATENTE'), '')
  assert.equal(normalizarPatente('0KM'), '')
  assert.equal(normalizarPatente('EN TRAMITE'), '')
  assert.equal(normalizarPatente(''), '')
})

test('interpretarNumero entiende los importes como se escriben acá', () => {
  assert.equal(interpretarNumero('$ 15.300,00'), 15300)
  assert.equal(interpretarNumero('15.300'), 15300)
  assert.equal(interpretarNumero('15300,50'), 15300.5)
  assert.equal(interpretarNumero('1.234.567'), 1234567)
  assert.equal(interpretarNumero('15.300.-'), 15300)
  assert.equal(interpretarNumero('A/D'), null)
  assert.equal(interpretarNumero('---'), null)
  assert.equal(interpretarNumero('PREGUNTAR A DANIEL'), null)
})

test('esTextoDeCuotaConocido distingue lo raro de lo habitual', () => {
  assert.equal(esTextoDeCuotaConocido('A/D'), true)
  assert.equal(esTextoDeCuotaConocido('---'), true)
  assert.equal(esTextoDeCuotaConocido('DEBITO'), true)
  assert.equal(esTextoDeCuotaConocido(''), true)
  assert.equal(esTextoDeCuotaConocido('PREGUNTAR A DANIEL'), false)
})

test('interpretarDiaDeVencimiento y interpretarAviso', () => {
  assert.equal(interpretarDiaDeVencimiento('10'), 10)
  assert.equal(interpretarDiaDeVencimiento('10/3'), 10)
  assert.equal(interpretarDiaDeVencimiento('vence el 15'), 15)
  assert.equal(interpretarDiaDeVencimiento('no sabe'), null)

  assert.equal(interpretarAviso('SI'), 1)
  assert.equal(interpretarAviso('NO'), 0)
  assert.equal(interpretarAviso('✔'), 1)
  assert.equal(interpretarAviso('12/08'), 1)
  assert.equal(interpretarAviso('NO CONTESTA'), null)
  assert.equal(interpretarAviso(''), null)
})

test('interpretarFecha detecta las fechas imposibles', () => {
  assert.equal(interpretarFecha('12/03/2026', null).iso, '2026-03-12')
  assert.equal(interpretarFecha('12-03-26', null).iso, '2026-03-12')
  assert.equal(interpretarFecha('2026-03-12', null).iso, '2026-03-12')
  assert.equal(interpretarFecha('12/3', 2026).iso, '2026-03-12')
  assert.match(interpretarFecha('31/02/2026', null).problema ?? '', /imposible/)
  assert.match(interpretarFecha('12/13/2026', null).problema ?? '', /imposible/)
  assert.match(interpretarFecha('12/03/1899', null).problema ?? '', /fuera de rango/)
  // Un texto que no tiene forma de fecha no es un problema: se guarda tal cual.
  assert.equal(interpretarFecha('DEBITO AUTOMATICO', null).problema, null)
})

test('una fecha sin año dentro de una planilla mensual cae en el año correcto', () => {
  // Un pago del 28/12 anotado en la planilla de ENERO 2026 es de diciembre de 2025.
  assert.equal(interpretarFechaDePeriodo('28/12', '2026-01').iso, '2025-12-28')
  assert.equal(interpretarFechaDePeriodo('08/01', '2026-01').iso, '2026-01-08')
  assert.equal(interpretarFechaDePeriodo('08/08', '2026-08').iso, '2026-08-08')
})

test('clasificarPestana reconoce las pestañas de la hoja real', () => {
  assert.deepEqual(clasificarPestana('DICIEMBRE25'), { tipo: 'MENSUAL', mes: 12, anio: 2025 })
  assert.deepEqual(clasificarPestana('ENERO'), { tipo: 'MENSUAL', mes: 1, anio: null })
  assert.deepEqual(clasificarPestana('SEPTIEMBRE'), { tipo: 'MENSUAL', mes: 9, anio: null })
  assert.equal(clasificarPestana('BAJAS ENERO').tipo, 'BAJAS')
  assert.equal(clasificarPestana('ENERO BAJAS').tipo, 'BAJAS')
  assert.equal(clasificarPestana('RIESGOS VARIOS').tipo, 'RIESGOS_VARIOS')
  assert.equal(clasificarPestana('IMPUTADOS').tipo, 'PAGOS')
  assert.equal(clasificarPestana('SINIESTROS').tipo, 'SINIESTROS')
  assert.equal(clasificarPestana('CONTADOR').tipo, 'CONTADOR')
  assert.equal(clasificarPestana('SEGUROS ACT').tipo, 'SEGUROS_ACT')
  assert.equal(clasificarPestana('COBERTURA').tipo, 'COBERTURA')
  assert.equal(clasificarPestana('AMP').tipo, 'AMP')
  assert.equal(clasificarPestana('Hoja 1').tipo, 'OTRA')
})

test('deduce el año de las planillas que no lo dicen, en orden y al revés', () => {
  const enOrden = clasificarPestanas(
    [
      { titulo: 'DICIEMBRE25', indice: 0 },
      { titulo: 'ENERO', indice: 1 },
      { titulo: 'FEBRERO', indice: 2 },
      { titulo: 'DICIEMBRE', indice: 3 },
      { titulo: 'ENERO', indice: 4 },
    ],
    2027,
    3,
  )
  assert.deepEqual(
    enOrden.map((p) => p.periodo),
    ['2025-12', '2026-01', '2026-02', '2026-12', '2027-01'],
  )

  // Hoja al revés: la más nueva primero.
  const alReves = clasificarPestanas(
    [
      { titulo: 'MARZO', indice: 0 },
      { titulo: 'FEBRERO', indice: 1 },
      { titulo: 'ENERO', indice: 2 },
      { titulo: 'DICIEMBRE25', indice: 3 },
    ],
    2026,
    8,
  )
  assert.deepEqual(
    alReves.map((p) => p.periodo),
    ['2026-03', '2026-02', '2026-01', '2025-12'],
  )
})

test('mapearEncabezados asigna por nombre y avisa de las columnas repetidas', () => {
  const mapeo = mapearEncabezados(['APELLIDO Y NOMBRE', 'D.N.I.', 'LOCAL', 'N° PÓLIZA', 'OB. DE COBERTURAS', 'OBS', 'CUOTA', 'CUOTA'], 'MENSUAL')
  assert.equal(mapeo.porCampo.get('nombre'), 0)
  assert.equal(mapeo.porCampo.get('documento'), 1)
  assert.equal(mapeo.porCampo.get('sucursal'), 2)
  assert.equal(mapeo.porCampo.get('numero_poliza'), 3)
  assert.equal(mapeo.porCampo.get('observaciones'), 4)
  // Dos columnas de observaciones se suman; dos de cuota no se pisan: gana la primera.
  assert.deepEqual(mapeo.extras.get('observaciones'), [5])
  assert.equal(mapeo.porCampo.get('cuota'), 6)
  assert.match(mapeo.columnas[7]!.nota ?? '', /repite el campo cuota/)
})

test('la columna del _ID es la primera libre después del último encabezado', () => {
  assert.equal(primeraColumnaLibre(['A', 'B', 'C']), 3)
  assert.equal(primeraColumnaLibre(['A', '', 'C']), 3)
  assert.equal(primeraColumnaLibre(['A', 'B', '', '']), 2)
  // Si una columna sin encabezado tiene datos más abajo, el _ID se corre a la siguiente.
  assert.equal(columnaLibreParaId([['A', 'B'], ['1', '2', 'nota suelta'], ['3', '4']]), 3)
  assert.equal(columnaLibreParaId([['A', 'B'], ['1', '2'], ['3', '4']]), 2)
  assert.equal(letraColumna(26), 'AA')
  assert.equal(letraColumna(32), 'AG')
  assert.equal(letraColumna(52), 'BA')
})
