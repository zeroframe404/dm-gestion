// Las reglas puras de src/shared/polizas.ts, sin base de datos: el estado de una póliza, la aritmética
// de semanas y vencimientos, la detección del «20% aumentar cuando se renueva» y la validación de
// antigüedad. Son las que usan por igual la pantalla y el proceso principal, así que van solas.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anioDeVehiculo,
  anioMinimoDe,
  buscarRegla,
  diasEntre,
  diasParaVencer,
  estadoDePoliza,
  fechaCorta,
  lunesDe,
  mesesDespues,
  mesesDeVigencia,
  pideAumentoAlRenovar,
  porcentajeDeAumento,
  tituloDeSemana,
  unAnioDespues,
  validarAntiguedad,
} from '../src/shared/polizas'
import type { ReglaDeCobertura } from '../src/shared/tipos'

function regla(cambios: Partial<ReglaDeCobertura> = {}): ReglaDeCobertura {
  return {
    id: 1,
    compania: 'SANCOR',
    cobertura: 'TERCEROS COMPLETO',
    incluye: null,
    franquicia: null,
    detalle: null,
    observaciones: null,
    antiguedadMaxima: null,
    anioMinimo: null,
    editable: true,
    ...cambios,
  }
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

test('los días entre dos fechas se cuentan bien, incluso cruzando meses y años', () => {
  assert.equal(diasEntre('2026-08-21', '2026-08-21'), 0)
  assert.equal(diasEntre('2026-08-21', '2026-08-31'), 10)
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1)
  assert.equal(diasEntre('2026-08-31', '2026-08-21'), -10, 'hacia atrás da negativo')
  // Un año bisiesto tiene 366 días: 2028 lo es.
  assert.equal(diasEntre('2028-01-01', '2029-01-01'), 366)
})

test('un texto que no es una fecha ISO no se interpreta: devuelve null', () => {
  for (const raro of ['', '27/4/2026', 'ANUAL', '2026-13-01', '2026-08', null, undefined]) {
    assert.equal(diasEntre('2026-08-21', raro), null, `«${raro}» no debería interpretarse`)
  }
})

test('un año después es la misma fecha del año que viene, y el 29 de febrero pasa al 28', () => {
  assert.equal(unAnioDespues('2026-09-01'), '2027-09-01')
  assert.equal(unAnioDespues('2026-12-31'), '2027-12-31')
  // 2028 es bisiesto y 2029 no: el 29 no existe y se toma el último día del mes, como las compañías.
  assert.equal(unAnioDespues('2028-02-29'), '2029-02-28')
})

test('los plazos que no son de un año se corren por meses, respetando el fin de mes', () => {
  // Agrosalta renueva cada 4 meses, Río Uruguay cada 6.
  assert.equal(mesesDespues('2026-09-09', 4), '2027-01-09', 'el plazo puede cruzar el año')
  assert.equal(mesesDespues('2026-09-30', 6), '2027-03-30')
  assert.equal(mesesDespues('2026-08-31', 6), '2027-02-28', 'el 31 de febrero no existe: se toma el último día')
  assert.equal(mesesDespues('2026-12-15', 1), '2027-01-15')
  assert.equal(mesesDespues('2027-01-15', -6), '2026-07-15', 'y para atrás también')
})

test('cuánto duró una vigencia sale de sus propias fechas', () => {
  assert.equal(mesesDeVigencia('2026-01-09', '2027-01-09'), 12)
  assert.equal(mesesDeVigencia('2026-09-09', '2027-03-09'), 6)
  assert.equal(mesesDeVigencia('2026-09-09', '2027-01-09'), 4)
  assert.equal(mesesDeVigencia('2026-09-09', '2026-09-20'), null, 'once días no es un plazo de póliza')
  assert.equal(mesesDeVigencia('2027-01-09', '2026-01-09'), null, 'al revés tampoco')
  assert.equal(mesesDeVigencia(null, '2027-01-09'), null, 'sin las dos fechas no se puede afirmar nada')
})

test('la semana arranca el lunes', () => {
  // 2026-08-21 es viernes; su lunes es el 17.
  assert.equal(lunesDe('2026-08-21'), '2026-08-17')
  assert.equal(lunesDe('2026-08-17'), '2026-08-17', 'un lunes es su propio lunes')
  assert.equal(lunesDe('2026-08-23'), '2026-08-17', 'el domingo todavía es de la semana que arrancó el lunes')
  assert.equal(lunesDe('2026-08-24'), '2026-08-24')
})

test('las semanas cercanas se nombran solas y las lejanas por su fecha', () => {
  const hoy = '2026-08-21'
  assert.equal(tituloDeSemana('2026-08-17', hoy), 'Esta semana')
  assert.equal(tituloDeSemana('2026-08-24', hoy), 'La semana que viene')
  assert.ok(tituloDeSemana('2026-09-07', hoy).includes('7 de sep'), 'la lejana dice desde cuándo')
})

test('la fecha corta se lee de un vistazo', () => {
  assert.equal(fechaCorta('2026-09-08'), '8 de sep')
  assert.equal(fechaCorta('2026-01-31'), '31 de ene')
  assert.equal(fechaCorta(null), '')
})

// ---------------------------------------------------------------------------
// Estado de la póliza
// ---------------------------------------------------------------------------

test('la baja manda sobre el vencimiento', () => {
  const hoy = '2026-08-21'
  assert.equal(estadoDePoliza(true, '2027-01-01', hoy), 'ACTIVA')
  assert.equal(estadoDePoliza(true, '2026-08-21', hoy), 'ACTIVA', 'el último día todavía está vigente')
  assert.equal(estadoDePoliza(true, '2026-08-20', hoy), 'VENCIDA')
  // Una póliza dada de baja no es «vencida» aunque su vigencia haya pasado: se dio de baja.
  assert.equal(estadoDePoliza(false, '2026-08-20', hoy), 'BAJA')
  assert.equal(estadoDePoliza(false, '2027-01-01', hoy), 'BAJA')
})

test('sin fecha de vigencia no se puede afirmar que venció: sigue activa', () => {
  // Buena parte de lo importado viene sin vigencia cargada; marcarlas vencidas sería mentir.
  assert.equal(estadoDePoliza(true, null, '2026-08-21'), 'ACTIVA')
  assert.equal(estadoDePoliza(true, 'ANUAL', '2026-08-21'), 'ACTIVA')
  assert.equal(diasParaVencer(null, '2026-08-21'), null)
})

// ---------------------------------------------------------------------------
// «20% aumentar cuando se renueva»
// ---------------------------------------------------------------------------

test('se reconoce el pedido de aumento aunque esté escrito de distintas formas', () => {
  const síes = [
    '20% aumentar cuando se renueva',
    '20 % AUMENTAR CUANDO SE RENUEVA',
    'Aumentar 20% al renovar',
    'SUBE 15% EN LA RENOVACION',
    'ojo: incrementar un 10 % cuando renueve',
  ]
  for (const texto of síes) assert.equal(pideAumentoAlRenovar(texto), true, `debería reconocer «${texto}»`)
})

test('no se enciende la etiqueta con cualquier observación que tenga un número', () => {
  const noes = [
    '',
    null,
    'Llamar por la mañana',
    'Debe 2 cuotas',
    'Aumentar la suma asegurada', // habla de aumentar, pero no de renovar ni de un porcentaje
    '20% de descuento por buen conductor', // tiene el porcentaje, pero no pide aumentar al renovar
    'Renovar en enero',
  ]
  for (const texto of noes) assert.equal(pideAumentoAlRenovar(texto), false, `no debería reconocer «${texto}»`)
})

test('el porcentaje se lee cuando está, y si no queda en null', () => {
  assert.equal(porcentajeDeAumento('20% aumentar cuando se renueva'), 20)
  assert.equal(porcentajeDeAumento('SUBE 15% EN LA RENOVACION'), 15)
  assert.equal(porcentajeDeAumento('aumentar un por ciento al renovar'), null, 'sin número no hay porcentaje')
  assert.equal(porcentajeDeAumento('Llamar por la mañana'), null)
})

// ---------------------------------------------------------------------------
// Antigüedad del vehículo
// ---------------------------------------------------------------------------

test('el año del vehículo se lee de lo que haya escrito en la hoja', () => {
  assert.equal(anioDeVehiculo('2018', 2026), 2018)
  assert.equal(anioDeVehiculo('  2018 ', 2026), 2018)
  assert.equal(anioDeVehiculo('18', 2026), 2018, 'dos dígitos cercanos son de este siglo')
  assert.equal(anioDeVehiculo('98', 2026), 1998, 'y los lejanos, del anterior')
  assert.equal(anioDeVehiculo('MODELO 2010', 2026), 2010)
})

test('lo que no es un año no se inventa', () => {
  for (const raro of ['', '---', '0KM', 'S/D', null, undefined, '3050', '1800']) {
    assert.equal(anioDeVehiculo(raro, 2026), null, `«${raro}» no es un año`)
  }
})

test('el año mínimo sale de la antigüedad máxima o del año mínimo, lo que esté cargado', () => {
  assert.equal(anioMinimoDe(regla({ antiguedadMaxima: 15 }), 2026), 2011)
  assert.equal(anioMinimoDe(regla({ anioMinimo: 2005 }), 2026), 2005)
  assert.equal(anioMinimoDe(regla(), 2026), null, 'sin límite cargado no hay año mínimo')
  // Si están los dos, manda el año explícito: es el dato más preciso.
  assert.equal(anioMinimoDe(regla({ antiguedadMaxima: 15, anioMinimo: 2008 }), 2026), 2008)
})

test('la advertencia aparece sólo cuando hay regla, hay límite y el vehículo no llega', () => {
  const conLimite = regla({ antiguedadMaxima: 15 })

  const viejo = validarAntiguedad(conLimite, '1995', 2026)
  assert.equal(viejo.hayProblema, true)
  assert.ok(viejo.mensaje.includes('1995'), 'dice qué modelo es')
  assert.ok(viejo.mensaje.includes('2011'), 'y desde cuál toma la compañía')
  assert.ok(viejo.mensaje.includes('SANCOR'))

  assert.equal(validarAntiguedad(conLimite, '2011', 2026).hayProblema, false, 'justo en el límite entra')
  assert.equal(validarAntiguedad(conLimite, '2024', 2026).hayProblema, false)
})

test('la validación degrada bien: sin regla, sin límite o con el año ilegible no molesta', () => {
  assert.equal(validarAntiguedad(null, '1995', 2026).hayProblema, false, 'sin regla no se puede afirmar nada')
  assert.equal(validarAntiguedad(regla(), '1995', 2026).hayProblema, false, 'la regla sin límite tampoco advierte')

  // Año ilegible: no bloquea, pero deja un mensaje para que alguien lo mire.
  const ilegible = validarAntiguedad(regla({ antiguedadMaxima: 15 }), '---', 2026)
  assert.equal(ilegible.hayProblema, false)
  assert.ok(ilegible.mensaje.length > 0, 'avisa que falta el año, sin frenar el alta')
})

test('la regla se busca normalizando, porque en la hoja está escrito de cualquier forma', () => {
  const reglas = [regla({ id: 1 }), regla({ id: 2, compania: 'FEDERACION PATRONAL', cobertura: 'TODO RIESGO' })]

  assert.equal(buscarRegla(reglas, 'SANCOR', 'TERCEROS COMPLETO')?.id, 1)
  assert.equal(buscarRegla(reglas, 'sancor', 'terceros completo')?.id, 1, 'sin importar mayúsculas')
  assert.equal(buscarRegla(reglas, 'Federación Patronal', 'Todo Riesgo')?.id, 2, 'ni tildes')
  assert.equal(buscarRegla(reglas, 'SANCOR', 'TODO RIESGO'), null, 'la compañía sola no alcanza')
  assert.equal(buscarRegla(reglas, '', 'TERCEROS COMPLETO'), null)
})
