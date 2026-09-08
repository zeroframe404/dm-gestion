// Lo que se puede probar sin Electron ni un VPS de verdad: la comparación de versiones (de la que
// depende si la pantalla de Usuarios dice «Al día» o «Desactualizado») y el saneamiento de lo que baja
// del servidor para el reporte de cada sucursal. El publicado/mezclado en sí (igual que el del
// encabezado del ticket) habla con `crearFuenteVps()` y no se prueba acá.
import assert from 'node:assert/strict'
import test from 'node:test'
import { compararVersiones, filasDesde } from '../src/main/servicios/estadoDeActualizaciones'

test('compararVersiones compara por tramo numérico, no alfabéticamente', () => {
  assert.ok(compararVersiones('13.0.1', '9.2.0') > 0, '13 tiene que ganarle a 9 aunque "13" < "9" como texto')
  assert.ok(compararVersiones('9.2.0', '13.0.1') < 0)
  assert.equal(compararVersiones('13.0.1', '13.0.1'), 0)
  assert.ok(compararVersiones('13.1.0', '13.0.9') > 0, 'el segundo tramo pesa más que el tercero')
  assert.ok(compararVersiones('13.0', '13.0.0') === 0, 'a un tramo que falta se lo trata como 0')
})

test('filasDesde ignora lo que no tiene forma de reporte de sucursal', () => {
  assert.deepEqual(filasDesde(null), [])
  assert.deepEqual(filasDesde({}), [])
  assert.deepEqual(filasDesde({ sucursales: 'no es una lista' }), [])
  assert.deepEqual(
    filasDesde({ sucursales: [{ sucursal: 'Lanús' }, { version: '13.0.1' }, null, 'no es un objeto'] }),
    [],
    'sin sucursal o sin versión, la fila se descarta entera',
  )
})

test('filasDesde conserva el rechazo y de dónde reportó cada sucursal', () => {
  const filas = filasDesde({
    sucursales: [
      { sucursal: 'Lanús', version: '13.0.1', reportadoEn: '2026-09-08T10:00:00.000Z', rechazoVersion: null, rechazadoEn: null },
      { sucursal: 'Dock Sud', version: '12.9.0', reportadoEn: '2026-09-08T09:00:00.000Z', rechazoVersion: '13.0.1', rechazadoEn: '2026-09-08T09:01:00.000Z' },
    ],
  })
  assert.equal(filas.length, 2)
  assert.equal(filas[1]!.rechazoVersion, '13.0.1')
  assert.equal(filas[1]!.rechazadoEn, '2026-09-08T09:01:00.000Z')
})
