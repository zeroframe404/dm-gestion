// El tablero de Métricas y Cartera → Estadísticas armados desde el payload del servidor: qué pasa
// cuando el caché no tiene nada todavía (cae al cálculo local), qué pasa cuando sí lo tiene (se usa
// ESE, con su cartel de frescura), y que el cotejo contra el cálculo local detecta cuando los dos
// números no coinciden —sin mostrárselo nunca al usuario, sólo por consola.
import assert from 'node:assert/strict'
import test from 'node:test'
import { usarBaseDeDatos } from '../src/main/db/base'
import { reiniciarCotejoParaPruebas } from '../src/main/servicios/cotejoDeMetricas'
import { guardarSnapshotDeMetrica } from '../src/main/servicios/metricasCache'
import {
  estadisticasConCache,
  estadisticasDesdeCache,
  tableroConCache,
  tableroDesdeCache,
  type MetricasPayloadCache,
} from '../src/main/servicios/metricasDesdeCache'
import type { FiltrosMetricas, ResumenDeCartera } from '../src/shared/tipos'
import { baseDePrueba } from './ayuda'

const SIN_CARTERA: ResumenDeCartera = { activas: 0, fueraDeVigencia: 0, dadasDeBaja: 0 }

/** Un payload chico pero con las tres piezas (celdas, bajas, pagos) y dos períodos, para probar el
 *  recorte por período/sucursal y la ventana de evolución. */
function payloadDePrueba(): MetricasPayloadCache {
  return {
    hoy: '2026-09-09',
    periodos: ['2026-08', '2026-09'],
    porPeriodo: {
      '2026-08': {
        hayMesAnterior: false,
        celdas: [
          { sucursal: 'Dock Sud', compania: 'ATM', activos: 2, altas: 0, bajas: 0, cuotasCobradas: 2, cuotasPendientes: 0, sinImporte: 0, pendiente: 0, pagos: 1, cobrado: 1500 },
        ],
        bajasPorMotivo: [],
        pagosPorMedio: [{ sucursal: 'Dock Sud', medio: 'EFECTIVO', pagos: 1, total: 1500 }],
      },
      '2026-09': {
        hayMesAnterior: true,
        celdas: [
          { sucursal: 'Dock Sud', compania: 'ATM', activos: 3, altas: 1, bajas: 1, cuotasCobradas: 2, cuotasPendientes: 1, sinImporte: 0, pendiente: 1200, pagos: 1, cobrado: 1000 },
          { sucursal: 'Lanús', compania: 'RUS', activos: 2, altas: 1, bajas: 0, cuotasCobradas: 0, cuotasPendientes: 2, sinImporte: 1, pendiente: 2000, pagos: 1, cobrado: 2000 },
        ],
        bajasPorMotivo: [{ sucursal: 'Dock Sud', motivo: 'NO RENUEVA', cantidad: 1 }],
        pagosPorMedio: [
          { sucursal: 'Dock Sud', medio: 'EFECTIVO', pagos: 1, total: 1000 },
          { sucursal: 'Lanús', medio: 'TRANSFERENCIA', pagos: 1, total: 2000 },
        ],
      },
    },
    siniestros: [{ sucursal: 'Dock Sud', compania: 'ATM', cantidad: 1 }],
  }
}

function conBase<T>(fn: () => T): T {
  usarBaseDeDatos(baseDePrueba())
  reiniciarCotejoParaPruebas()
  return fn()
}

test('tableroDesdeCache: null cuando el payload no tiene ningún período', () => {
  conBase(() => {
    const vacio: MetricasPayloadCache = { hoy: '2026-09-09', periodos: [], porPeriodo: {}, siniestros: [] }
    assert.equal(tableroDesdeCache(vacio, { periodo: null, sucursales: [] }, true), null)
  })
})

test('tableroDesdeCache: null cuando se pide un período que el payload no tiene', () => {
  conBase(() => {
    assert.equal(tableroDesdeCache(payloadDePrueba(), { periodo: '2025-01', sucursales: [] }, true), null)
  })
})

test('tableroDesdeCache: sin período pedido, resuelve al más nuevo', () => {
  conBase(() => {
    const tablero = tableroDesdeCache(payloadDePrueba(), { periodo: null, sucursales: [] }, true)
    assert.equal(tablero?.periodo, '2026-09')
  })
})

test('tableroDesdeCache: sin mes anterior, altas viaja null aunque el payload lo tenga en 0', () => {
  conBase(() => {
    const tablero = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-08', sucursales: [] }, true)
    assert.equal(tablero?.hayMesAnterior, false)
    assert.equal(tablero?.altas, null)
    assert.equal(tablero?.activos, 2)
  })
})

test('tableroDesdeCache: suma activos/altas/bajas de todas las sucursales cuando no se filtra, y de una sola cuando sí', () => {
  conBase(() => {
    const todas = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-09', sucursales: [] }, true)
    assert.equal(todas?.activos, 5)
    assert.equal(todas?.altas, 2)
    assert.equal(todas?.bajas, 1)

    const soloLanus = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-09', sucursales: ['Lanús'] }, true)
    assert.equal(soloLanus?.activos, 2)
    assert.equal(soloLanus?.altas, 1)
    assert.equal(soloLanus?.bajas, 0)
    assert.deepEqual(soloLanus?.sucursalesElegidas, ['Lanús'])
  })
})

test('tableroDesdeCache: conNumeros=false anula la plata pero deja la cantidad de cuotas', () => {
  conBase(() => {
    const empleado = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-09', sucursales: [] }, false)
    assert.equal(empleado?.cobranza.cobrado, null)
    assert.equal(empleado?.cobranza.pendiente, null)
    assert.equal(empleado?.cobranza.porMedio, null)
    assert.equal(empleado?.cobranza.cuotasCobradas, 2)
    assert.equal(empleado?.cobranza.cuotasPendientes, 3)

    const admin = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-09', sucursales: [] }, true)
    assert.equal(admin?.cobranza.cobrado, 3000)
    assert.equal(admin?.cobranza.pendiente, 3200)
  })
})

test('tableroDesdeCache: la evolución cubre los períodos hasta el elegido, no los que vienen después', () => {
  conBase(() => {
    const tablero = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-08', sucursales: [] }, true)
    assert.deepEqual(
      tablero?.evolucion.map((m) => m.periodo),
      ['2026-08'],
    )
  })
})

test('tableroDesdeCache: agrupa bajas por motivo y siniestros abiertos por compañía, sólo de las sucursales elegidas', () => {
  conBase(() => {
    const tablero = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-09', sucursales: [] }, true)
    assert.deepEqual(tablero?.bajasPorMotivo, [{ motivo: 'NO RENUEVA', cantidad: 1 }])
    assert.equal(tablero?.siniestrosAbiertos, 1)
    assert.deepEqual(tablero?.siniestrosPorCompania, [{ etiqueta: 'ATM', cantidad: 1, porcentaje: 100 }])

    const soloLanus = tableroDesdeCache(payloadDePrueba(), { periodo: '2026-09', sucursales: ['Lanús'] }, true)
    assert.equal(soloLanus?.siniestrosAbiertos, 0)
  })
})

test('estadisticasDesdeCache: arma porCompania/porSucursal y totales, y pega el resumenCartera tal cual se lo pasan', () => {
  conBase(() => {
    const resumen: ResumenDeCartera = { activas: 40, fueraDeVigencia: 3, dadasDeBaja: 5 }
    const estadisticas = estadisticasDesdeCache(payloadDePrueba(), '2026-09', [], true, resumen)
    assert.equal(estadisticas?.totales.activos, 5)
    assert.equal(estadisticas?.totales.altas, 2)
    assert.equal(estadisticas?.totales.cobrado, 3000)
    assert.deepEqual(estadisticas?.resumenCartera, resumen)
    assert.ok(estadisticas?.porCompania.some((f) => f.etiqueta === 'ATM' && f.activos === 3))
    assert.ok(estadisticas?.porSucursal.some((f) => f.etiqueta === 'Lanús' && f.activos === 2))
  })
})

// ---------------------------------------------------------------------------
// Orquestación: caché primero, cálculo local como respaldo y cotejo silencioso
// ---------------------------------------------------------------------------

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

test('tableroConCache: sin nada en el caché, cae al cálculo local y no viaja frescura', () => {
  conBase(() => {
    const filtros: FiltrosMetricas = { periodo: '2026-08', sucursales: [] }
    const tablero = tableroConCache(filtros, true)
    assert.equal(tablero.periodo, '2026-08')
    assert.equal(tablero.calculadoEn, undefined)
    assert.equal(tablero.frescura, undefined)
  })
})

test('tableroConCache: con un cálculo del servidor para el período pedido, lo usa y viaja con frescura', () => {
  conBase(() => {
    guardarSnapshotDeMetrica('metricas', { version: 1, calculadoEn: '2026-09-09T12:00:00.000Z', payload: payloadDePrueba() })
    const tablero = tableroConCache({ periodo: '2026-09', sucursales: [] }, true)
    assert.equal(tablero.periodo, '2026-09')
    assert.equal(tablero.activos, 5)
    assert.equal(tablero.calculadoEn, '2026-09-09T12:00:00.000Z')
    assert.equal(tablero.frescura, 'AL_DIA')
  })
})

test('tableroConCache: si el servidor y el cálculo local no coinciden, lo anota por consola y nunca lo muestra en el resultado', () => {
  conBase(() => {
    // La base local está vacía: para el período 2026-08 el cálculo local da activos=0, altas=null (sin
    // mes anterior). El payload del servidor dice otra cosa a propósito, para que el cotejo lo note.
    guardarSnapshotDeMetrica('metricas', { version: 1, calculadoEn: '2026-09-09T12:00:00.000Z', payload: payloadDePrueba() })

    const { resultado: tablero, llamadas } = conConsoleErrorCapturado(() => tableroConCache({ periodo: '2026-08', sucursales: [] }, true))

    // El resultado que ve la pantalla es el del servidor, sin rastro del cotejo.
    assert.equal(tablero.activos, 2)
    // Pero quedó anotado que no coincidían.
    assert.equal(llamadas.length, 1)
    assert.match(String(llamadas[0]?.[0]), /no coincide con el local/)
  })
})

test('tableroConCache: si coinciden, no anota nada', () => {
  conBase(() => {
    // Un payload cuyo único período (2026-08, sin mes anterior) da exactamente lo mismo que una base
    // local vacía: activos 0, sin altas.
    const payload: MetricasPayloadCache = {
      hoy: '2026-09-09',
      periodos: ['2026-08'],
      porPeriodo: {
        '2026-08': { hayMesAnterior: false, celdas: [], bajasPorMotivo: [], pagosPorMedio: [] },
      },
      siniestros: [],
    }
    guardarSnapshotDeMetrica('metricas', { version: 1, calculadoEn: '2026-09-09T12:00:00.000Z', payload })

    const { llamadas } = conConsoleErrorCapturado(() => tableroConCache({ periodo: '2026-08', sucursales: [] }, true))
    assert.equal(llamadas.length, 0)
  })
})

test('estadisticasConCache: sin nada en el caché, cae al cálculo local; con el servidor calculado, lo usa y mantiene el resumen de cartera', () => {
  conBase(() => {
    const sinCache = estadisticasConCache('2026-08', [], true)
    assert.equal(sinCache.calculadoEn, undefined)
    assert.deepEqual(sinCache.resumenCartera, SIN_CARTERA)

    guardarSnapshotDeMetrica('metricas', { version: 1, calculadoEn: '2026-09-09T12:00:00.000Z', payload: payloadDePrueba() })
    const conCache = estadisticasConCache('2026-09', [], true)
    assert.equal(conCache.totales.activos, 5)
    assert.equal(conCache.calculadoEn, '2026-09-09T12:00:00.000Z')
    // El resumen de cartera es de la base local siempre, cache o no: acá también da la cartera vacía.
    assert.deepEqual(conCache.resumenCartera, SIN_CARTERA)
  })
})
