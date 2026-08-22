// El semáforo de la planilla: la regla que la gente mira todo el día. Los casos están escritos como
// se leen en la agencia, con los días de cobertura reales de cada compañía (ATM 7, EQUIDAD 5,
// METROPOL 3, AGROSALTA 0).
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calcularAlerta,
  esDebitoAutomatico,
  fechaDeVencimiento,
  hoyLocal,
  nombreDePeriodo,
  periodoSiguiente,
  type ColorAlerta,
} from '../src/shared/semaforo'

/** Atajo: color de una fila que vence el día `dia` del mes, mirada el día `hoy` del mismo mes. */
function color(opciones: {
  dia: number | null
  hoy: number
  pagada?: boolean
  formaPago?: string | null
  diasCobertura?: number
  periodo?: string
}): ColorAlerta {
  const periodo = opciones.periodo ?? '2026-08'
  return calcularAlerta(
    {
      periodo,
      diaVencimiento: opciones.dia,
      pagada: opciones.pagada ?? false,
      formaPago: opciones.formaPago ?? 'CUPONERA',
      diasCobertura: opciones.diasCobertura ?? 0,
    },
    `${periodo}-${String(opciones.hoy).padStart(2, '0')}`,
  ).color
}

test('verde: la cuota del mes está paga', () => {
  assert.equal(color({ dia: 11, hoy: 20, pagada: true }), 'verde')
  // Aunque ya haya vencido hace rato.
  assert.equal(color({ dia: 1, hoy: 28, pagada: true, diasCobertura: 0 }), 'verde')
  // El verde gana incluso sobre el débito automático.
  assert.equal(color({ dia: 11, hoy: 20, pagada: true, formaPago: 'TARJETA' }), 'verde')
})

test('azul: se cobra solo por tarjeta o CBU', () => {
  for (const forma of ['TARJETA', 'CBU', 'tarjeta', 'Débito automático', 'DEBITO']) {
    assert.equal(color({ dia: 11, hoy: 28, formaPago: forma }), 'azul', `«${forma}» tendría que ser azul`)
  }
  assert.equal(esDebitoAutomatico('CUPONERA'), false)
  assert.equal(esDebitoAutomatico('LOCAL'), false)
  assert.equal(esDebitoAutomatico(null), false)
})

test('amarillo, naranja y rojo según los días que faltan', () => {
  // Vence el 11: del 4 al 7 de antelación es amarillo, del 1 al 3 naranja, el mismo día rojo.
  assert.equal(color({ dia: 11, hoy: 1 }), 'neutro', 'faltando 10 días todavía no se avisa')
  assert.equal(color({ dia: 11, hoy: 3 }), 'neutro')
  assert.equal(color({ dia: 11, hoy: 4 }), 'amarillo')
  assert.equal(color({ dia: 11, hoy: 7 }), 'amarillo')
  assert.equal(color({ dia: 11, hoy: 8 }), 'naranja')
  assert.equal(color({ dia: 11, hoy: 10 }), 'naranja')
  assert.equal(color({ dia: 11, hoy: 11 }), 'rojo', 'el día del vencimiento ya es rojo')
})

test('con cobertura financiera el rojo se corre hasta que la compañía deja de cubrir', () => {
  // ATM da 7 días: vence el 11, cubre hasta el 18.
  const atm = (hoy: number) => color({ dia: 11, hoy, diasCobertura: 7 })
  assert.equal(atm(11), 'rojo', 'el día del vencimiento es rojo igual')
  assert.equal(atm(12), 'amarillo', 'todavía lo cubre')
  assert.equal(atm(17), 'amarillo')
  assert.equal(atm(18), 'naranja', 'último día de cobertura')
  assert.equal(atm(19), 'rojo', 'se terminó la cobertura')

  // AGROSALTA no da días: rojo desde el mismo día del vencimiento y ya no vuelve.
  const agrosalta = (hoy: number) => color({ dia: 11, hoy, diasCobertura: 0 })
  assert.equal(agrosalta(11), 'rojo')
  assert.equal(agrosalta(12), 'rojo')

  // METROPOL da 3.
  assert.equal(color({ dia: 11, hoy: 13, diasCobertura: 3 }), 'amarillo')
  assert.equal(color({ dia: 11, hoy: 14, diasCobertura: 3 }), 'naranja')
  assert.equal(color({ dia: 11, hoy: 15, diasCobertura: 3 }), 'rojo')
})

test('una fila sin día de vencimiento no inventa un color', () => {
  assert.equal(color({ dia: null, hoy: 20 }), 'neutro')
  assert.equal(calcularAlerta({ periodo: '2026-08', diaVencimiento: null, pagada: false, formaPago: 'CUPONERA', diasCobertura: 7 }, '2026-08-20').etiqueta, 'Sin vencimiento')
})

test('el día 31 en un mes que no lo tiene cae en el último día', () => {
  assert.equal(fechaDeVencimiento('2026-02', 31), '2026-02-28')
  assert.equal(fechaDeVencimiento('2026-08', 31), '2026-08-31')
  assert.equal(fechaDeVencimiento('2026-08', 11), '2026-08-11')
  assert.equal(fechaDeVencimiento('2026-08', null), null)
  // Febrero de un año bisiesto.
  assert.equal(fechaDeVencimiento('2028-02', 30), '2028-02-29')
})

test('la alerta explica en palabras lo que muestra el color', () => {
  const alerta = calcularAlerta({ periodo: '2026-08', diaVencimiento: 11, pagada: false, formaPago: 'CUPONERA', diasCobertura: 7 }, '2026-08-14')
  assert.equal(alerta.color, 'amarillo')
  assert.equal(alerta.finCobertura, '2026-08-18')
  assert.equal(alerta.diasParaVencer, -3)
  assert.match(alerta.detalle, /cubre hasta el 2026-08-18/)
})

test('mirar un mes viejo desde hoy deja todo vencido, como en la hoja', () => {
  // Una cuota de julio mirada en agosto: venció y no hay cobertura que aguante.
  assert.equal(color({ periodo: '2026-07', dia: 11, hoy: 20, diasCobertura: 7, ...{} }), 'rojo')
})

test('ayudas de período', () => {
  assert.equal(periodoSiguiente('2026-08'), '2026-09')
  assert.equal(periodoSiguiente('2026-12'), '2027-01')
  assert.equal(nombreDePeriodo('2026-08'), 'Agosto 2026')
  assert.match(hoyLocal(new Date(2026, 7, 21, 15, 30)), /^2026-08-21$/)
})
