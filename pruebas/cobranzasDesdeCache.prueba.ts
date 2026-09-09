// Comisiones e Imputados armados desde el payload del servidor: caída al cálculo local sin caché,
// uso del caché cuando lo hay, y que el cotejo detecte una diferencia sin mostrarla nunca en pantalla.
// Mismo espíritu que pruebas/metricasDesdeCache.prueba.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { usarBaseDeDatos } from '../src/main/db/base'
import { hoyLocal } from '../src/shared/semaforo'
import { cajaConCache, comisionesConCache, imputadosConCache } from '../src/main/servicios/cobranzasDesdeCache'
import { reiniciarCotejoParaPruebas } from '../src/main/servicios/cotejoDeMetricas'
import { guardarSnapshotDeMetrica } from '../src/main/servicios/metricasCache'
import type { SesionUsuario } from '../src/shared/tipos'
import { baseDePrueba } from './ayuda'

const EMPLEADO_LANUS: SesionUsuario = { id: 2, nombre: 'Empleada Lanús', usuario: 'lanus', rol: 'EMPLEADO', sucursal: { id: 2, nombre: 'Lanús' }, debeCambiarClave: false }

function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return hoyLocal(d)
}

// El respiro entre cotejos es un `Map` a nivel de módulo (para no duplicar el cálculo local en cada
// tecla en producción): sin reiniciarlo, dos pruebas de esta corrida que cotejan la MISMA clave (mismo
// período) verían la segunda silenciada por el respiro que dejó la primera.
function conBase<T>(fn: () => T): T {
  usarBaseDeDatos(baseDePrueba())
  reiniciarCotejoParaPruebas()
  return fn()
}

function conConsoleErrorCapturado<T>(fn: () => T): { resultado: T; llamadas: unknown[][] } {
  const original = console.error
  const llamadas: unknown[][] = []
  console.error = (...args: unknown[]) => {
    llamadas.push(args)
  }
  try {
    return { resultado: fn(), llamadas }
  } finally {
    console.error = original
  }
}

// ---------------------------------------------------------------------------
// Comisiones
// ---------------------------------------------------------------------------

test('comisionesConCache: sin nada en el caché, cae al cálculo local', () => {
  conBase(() => {
    const resumen = comisionesConCache('2026-08')
    assert.equal(resumen.periodo, '2026-08')
    assert.equal(resumen.calculadoEn, undefined)
  })
})

test('comisionesConCache: con un cálculo del servidor para el período pedido, lo usa y viaja con frescura', () => {
  conBase(() => {
    guardarSnapshotDeMetrica('comisiones', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: {
        periodos: ['2026-08'],
        porPeriodo: {
          '2026-08': {
            filas: [{ compania: 'ATM', pagos: 3, cobrado: 1500, porcentaje: 5, comision: 75 }],
            cobrado: 1500,
            comision: 75,
            sinPorcentaje: [],
          },
        },
      },
    })
    const resumen = comisionesConCache('2026-08')
    assert.equal(resumen.cobrado, 1500)
    assert.equal(resumen.comision, 75)
    assert.equal(resumen.calculadoEn, '2026-09-09T12:00:00.000Z')
    assert.equal(resumen.frescura, 'AL_DIA')
  })
})

test('comisionesConCache: si el servidor y el cálculo local no coinciden, lo anota por consola sin mostrarlo', () => {
  conBase(() => {
    // Base local vacía: comisionesLocal('2026-08') da cobrado=0. El payload dice otra cosa a propósito.
    guardarSnapshotDeMetrica('comisiones', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: { periodos: ['2026-08'], porPeriodo: { '2026-08': { filas: [], cobrado: 5000, comision: 250, sinPorcentaje: [] } } },
    })
    const { resultado: resumen, llamadas } = conConsoleErrorCapturado(() => comisionesConCache('2026-08'))
    assert.equal(resumen.cobrado, 5000) // lo que ve la pantalla es el del servidor
    assert.equal(llamadas.length, 1)
    assert.match(String(llamadas[0]?.[0]), /no coincide con el local/)
  })
})

// ---------------------------------------------------------------------------
// Imputados
// ---------------------------------------------------------------------------

test('imputadosConCache: sin nada en el caché, cae enteramente al cálculo local', () => {
  conBase(() => {
    const rendicion = imputadosConCache('2026-08', [], [], true)
    assert.equal(rendicion.periodo, '2026-08')
    assert.equal(rendicion.calculadoEn, undefined)
    assert.deepEqual(rendicion.pagos, [])
  })
})

test('imputadosConCache: con un cálculo del servidor, pisa los agregados pero la lista de pagos sigue local', () => {
  conBase(() => {
    guardarSnapshotDeMetrica('imputados', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: {
        periodos: ['2026-08'],
        porPeriodo: {
          '2026-08': {
            celdas: [
              {
                sucursal: 'Dock Sud',
                compania: 'ATM',
                contadores: { '': 1, IMPUTADO: 1, OK: 2, REVISAR: 0, MAL: 0 },
                total: 4,
                totalImporte: 4000,
                pendientes: 1,
                sinCobrar: 1,
              },
            ],
          },
        },
      },
    })
    const rendicion = imputadosConCache('2026-08', [], [], true)
    // La lista de pagos (vacía, porque la base local no tiene pagos cargados) sigue siendo la local.
    assert.deepEqual(rendicion.pagos, [])
    // Pero los agregados son los del servidor.
    assert.equal(rendicion.total, 4)
    assert.equal(rendicion.totalImporte, 4000)
    assert.equal(rendicion.pendientes, 1)
    assert.equal(rendicion.sinCobrar, 1)
    assert.deepEqual(rendicion.contadores, { '': 1, IMPUTADO: 1, OK: 2, REVISAR: 0, MAL: 0 })
    assert.equal(rendicion.calculadoEn, '2026-09-09T12:00:00.000Z')
  })
})

test('imputadosConCache: veLosNumeros=false anula totalImporte igual que el cálculo local', () => {
  conBase(() => {
    guardarSnapshotDeMetrica('imputados', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: {
        periodos: ['2026-08'],
        porPeriodo: {
          '2026-08': {
            celdas: [
              { sucursal: 'Dock Sud', compania: 'ATM', contadores: { '': 0, IMPUTADO: 0, OK: 1, REVISAR: 0, MAL: 0 }, total: 1, totalImporte: 1000, pendientes: 0, sinCobrar: 0 },
            ],
          },
        },
      },
    })
    const rendicion = imputadosConCache('2026-08', [], [], false)
    assert.equal(rendicion.totalImporte, null)
    assert.equal(rendicion.total, 1) // la cantidad se ve siempre, aunque la plata no
  })
})

test('imputadosConCache: si el servidor y el local no coinciden, lo anota por consola sin mostrarlo', () => {
  conBase(() => {
    // Base local vacía: imputados('2026-08', [], []) da total=0. El payload dice otra cosa.
    guardarSnapshotDeMetrica('imputados', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: {
        periodos: ['2026-08'],
        porPeriodo: {
          '2026-08': {
            celdas: [
              { sucursal: 'Dock Sud', compania: 'ATM', contadores: { '': 0, IMPUTADO: 0, OK: 5, REVISAR: 0, MAL: 0 }, total: 5, totalImporte: 5000, pendientes: 0, sinCobrar: 0 },
            ],
          },
        },
      },
    })
    const { llamadas } = conConsoleErrorCapturado(() => imputadosConCache('2026-08', [], [], true))
    assert.equal(llamadas.length, 1)
    assert.match(String(llamadas[0]?.[0]), /no coincide con el local/)
  })
})

// ---------------------------------------------------------------------------
// Caja del día
// ---------------------------------------------------------------------------

test('cajaConCache: sin nada en el caché, cae enteramente al cálculo local', () => {
  conBase(() => {
    const hoy = hoyLocal()
    const caja = cajaConCache(hoy, [], null)
    assert.equal(caja.fecha, hoy)
    assert.equal(caja.calculadoEn, undefined)
    assert.deepEqual(caja.pagos, [])
  })
})

test('cajaConCache: con el día calculado por el servidor, pisa los totales pero la lista y el arqueo siguen locales', () => {
  conBase(() => {
    const hoy = hoyLocal()
    guardarSnapshotDeMetrica('caja', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: {
        hoy,
        dias: [
          {
            fecha: hoy,
            celdas: [
              { sucursal: 'Dock Sud', totalesPorMedio: [{ medio: 'EFECTIVO', pagos: 2, total: 1500 }], total: 1500, sinImporte: 0, imputados: 1 },
              { sucursal: 'Lanús', totalesPorMedio: [{ medio: 'TRANSFERENCIA', pagos: 1, total: 2000 }], total: 2000, sinImporte: 0, imputados: 0 },
            ],
          },
        ],
      },
    })
    const caja = cajaConCache(hoy, [], null)
    // La lista de pagos (vacía, base local sin pagos) y el arqueo siguen siendo los locales.
    assert.deepEqual(caja.pagos, [])
    assert.equal(caja.arqueo, null)
    // Los totales son la suma de las dos sucursales del servidor (sin filtro de sucursal, un admin ve todo).
    assert.equal(caja.total, 3500)
    assert.equal(caja.imputados, 1)
    assert.equal(caja.calculadoEn, '2026-09-09T12:00:00.000Z')
  })
})

test('cajaConCache: un empleado sólo ve el total de SU sucursal, aunque el payload traiga todas', () => {
  conBase(() => {
    const hoy = hoyLocal()
    guardarSnapshotDeMetrica('caja', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: {
        hoy,
        dias: [
          {
            fecha: hoy,
            celdas: [
              { sucursal: 'Dock Sud', totalesPorMedio: [], total: 9999, sinImporte: 0, imputados: 0 },
              { sucursal: 'Lanús', totalesPorMedio: [{ medio: 'EFECTIVO', pagos: 1, total: 500 }], total: 500, sinImporte: 0, imputados: 0 },
            ],
          },
        ],
      },
    })
    // Sin sucursal pedida: `sucursalObligadaDe` fuerza la del empleado (Lanús) de todos modos.
    const caja = cajaConCache(hoy, [], EMPLEADO_LANUS)
    assert.deepEqual(caja.sucursalesElegidas, ['Lanús'])
    assert.equal(caja.total, 500) // nunca los 9999 de Dock Sud
  })
})

test('cajaConCache: un día que no es hoy ni ayer nunca usa el caché, aunque el servidor lo tenga', () => {
  conBase(() => {
    guardarSnapshotDeMetrica('caja', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: { hoy: '2020-01-01', dias: [{ fecha: '2020-01-01', celdas: [{ sucursal: 'Dock Sud', totalesPorMedio: [], total: 9999, sinImporte: 0, imputados: 0 }] }] },
    })
    const caja = cajaConCache('2020-01-01', [], null)
    assert.equal(caja.calculadoEn, undefined)
    assert.equal(caja.total, 0) // el cálculo local de siempre, no el del caché
  })
})

test('cajaConCache: ayer también puede venir del servidor', () => {
  conBase(() => {
    const ayer = diaAnterior(hoyLocal())
    guardarSnapshotDeMetrica('caja', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: { hoy: hoyLocal(), dias: [{ fecha: ayer, celdas: [{ sucursal: 'Dock Sud', totalesPorMedio: [], total: 1234, sinImporte: 0, imputados: 0 }] }] },
    })
    const caja = cajaConCache(ayer, [], null)
    assert.equal(caja.total, 1234)
    assert.equal(caja.calculadoEn, '2026-09-09T12:00:00.000Z')
  })
})

test('cajaConCache: si el servidor y el local no coinciden, lo anota por consola sin mostrarlo', () => {
  conBase(() => {
    const hoy = hoyLocal()
    guardarSnapshotDeMetrica('caja', {
      version: 1,
      calculadoEn: '2026-09-09T12:00:00.000Z',
      payload: { hoy, dias: [{ fecha: hoy, celdas: [{ sucursal: 'Dock Sud', totalesPorMedio: [], total: 5000, sinImporte: 0, imputados: 0 }] }] },
    })
    const { llamadas } = conConsoleErrorCapturado(() => cajaConCache(hoy, [], null))
    assert.equal(llamadas.length, 1)
    assert.match(String(llamadas[0]?.[0]), /no coincide con el local/)
  })
})
