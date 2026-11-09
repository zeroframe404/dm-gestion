// El horario laboral: quién puede estar adentro a cada hora de Argentina, en qué días, en qué sucursal, qué hace un
// feriado y qué hace una excepción.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  diaDeArgentina,
  esFechaReal,
  evaluarHorario,
  horaDeArgentina,
  horarioPorOmision,
  mensajeFueraDeHorario,
  minutosDeArgentina,
  motivoDeConfiguracionInvalida,
  normalizarConfiguracion,
  textoDeDias,
  type ConfiguracionDeHorario,
  type VeredictoDeHorario,
} from '../src/shared/horario'

const LUN_A_VIE = [1, 2, 3, 4, 5]
/** Dock Sud: usuarios de lunes a sábado de 10 a 20, administradores de lunes a viernes de 9 a 21, feriado el 25/12. Lanús: usuarios de 8 a 16. */
function armar(): ConfiguracionDeHorario {
  const config = horarioPorOmision()
  config.habilitado = true
  config.sucursales['Dock Sud'] = {
    ADMIN: { activo: true, desde: '09:00', hasta: '21:00', dias: LUN_A_VIE },
    EMPLEADO: { activo: true, desde: '10:00', hasta: '20:00', dias: [1, 2, 3, 4, 5, 6] },
    feriados: [{ fecha: '2026-12-25', motivo: 'Navidad' }],
  }
  config.sucursales['Lanús'] = {
    ADMIN: { activo: false, desde: '10:00', hasta: '20:00', dias: LUN_A_VIE },
    EMPLEADO: { activo: true, desde: '08:00', hasta: '16:00', dias: LUN_A_VIE },
    feriados: [],
  }
  return config
}
const config = armar()
/** Un instante a las HH:MM de Argentina (UTC-3). Por omisión, el lunes 9 de noviembre de 2026. */
const aLas = (hora: string, dia = '2026-11-09'): number => Date.parse(`${dia}T${hora}:00-03:00`)
const SABADO = '2026-11-14'
const DOMINGO = '2026-11-08'
const NAVIDAD = '2026-12-25'

function fuera(veredicto: VeredictoDeHorario) {
  assert.equal(veredicto.tipo, 'fuera')
  return veredicto as Extract<VeredictoDeHorario, { tipo: 'fuera' }>
}

test('apagado, sin regla activa, sucursal desconocida o superadministrador: a cualquier hora', () => {
  assert.equal(evaluarHorario(horarioPorOmision(), 'EMPLEADO', 'Dock Sud', aLas('03:00')).tipo, 'libre')
  assert.equal(evaluarHorario({ ...config, habilitado: false }, 'EMPLEADO', 'Dock Sud', aLas('03:00')).tipo, 'libre')
  assert.equal(evaluarHorario(config, 'ADMIN', 'Lanús', aLas('03:00')).tipo, 'libre') // regla inactiva
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Sucursal inventada', aLas('03:00')).tipo, 'libre')
  assert.equal(evaluarHorario(config, 'SUPER_ADMIN', 'Dock Sud', aLas('03:00', NAVIDAD)).tipo, 'libre')
})

test('dentro del turno dice a qué hora cierra; el borde de salida ya es fuera', () => {
  const dentro = evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('19:30'))
  assert.equal(dentro.tipo, 'dentro')
  if (dentro.tipo === 'dentro') {
    assert.equal(dentro.cierraEnMs, aLas('20:00'))
    assert.equal(dentro.cierraA, '20:00')
  }
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('10:00')).tipo, 'dentro')
  assert.equal(fuera(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('20:00'))).motivo, 'horario')
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('09:59')).tipo, 'fuera')
})

test('administradores y usuarios tienen horarios separados', () => {
  assert.equal(evaluarHorario(config, 'ADMIN', 'Dock Sud', aLas('20:30')).tipo, 'dentro')
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('20:30')).tipo, 'fuera')
})

test('cada sucursal tiene su propio horario', () => {
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('17:00')).tipo, 'dentro')
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Lanús', aLas('17:00')).tipo, 'fuera')
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Lanús', aLas('08:30')).tipo, 'dentro')
  // «Avellaneda» es el mismo mostrador que Dock Sud (ver shared/sucursales.ts).
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'AVELLANEDA', aLas('17:00')).tipo, 'dentro')
})

test('los días: un día que no es de trabajo está cerrado todo el día aunque la hora sea buena', () => {
  // Los usuarios de Dock Sud trabajan el sábado; los administradores no; el domingo ninguno.
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('12:00', SABADO)).tipo, 'dentro')
  const sabadoAdmin = fuera(evaluarHorario(config, 'ADMIN', 'Dock Sud', aLas('12:00', SABADO)))
  assert.equal(sabadoAdmin.motivo, 'dia')
  assert.match(mensajeFueraDeHorario(sabadoAdmin), /lunes a viernes, de 09:00 a 21:00/)
  assert.equal(fuera(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('12:00', DOMINGO))).motivo, 'dia')
})

test('un feriado cierra el día entero y dice cuál es; sólo en la sucursal que lo cargó', () => {
  const navidad = fuera(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('12:00', NAVIDAD)))
  assert.equal(navidad.motivo, 'feriado')
  assert.match(mensajeFueraDeHorario(navidad), /día no laborable \(Navidad\)/)
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Lanús', aLas('12:00', NAVIDAD)).tipo, 'dentro')
  // El día siguiente (sábado 26), vuelve a la normalidad.
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('12:00', '2026-12-26')).tipo, 'dentro')
})

test('una excepción vigente deja entrar fuera de turno, en un día cerrado o en feriado, y extiende el cierre', () => {
  const fueraDeHora = evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('21:00'), aLas('22:00'))
  assert.deepEqual(fueraDeHora, { tipo: 'dentro', cierraEnMs: aLas('22:00'), cierraA: '22:00' })
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('12:00', NAVIDAD), aLas('13:00', NAVIDAD)).tipo, 'dentro')
  assert.equal(evaluarHorario(config, 'ADMIN', 'Dock Sud', aLas('12:00', DOMINGO), aLas('13:00', DOMINGO)).tipo, 'dentro')
  const antes = evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('19:45'), aLas('20:45'))
  assert.equal(antes.tipo === 'dentro' && antes.cierraEnMs, aLas('20:45'))
  // Una excepción más corta que el turno no lo acorta; vencida, no cuenta.
  const corta = evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('15:00'), aLas('15:30'))
  assert.equal(corta.tipo === 'dentro' && corta.cierraEnMs, aLas('20:00'))
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('21:00'), aLas('20:59')).tipo, 'fuera')
})

test('el instante de cierre es el mismo en cada consulta del día (si no, el aviso se repetiría)', () => {
  const a = evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('19:35') + 123)
  const b = evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('19:35') + 20_457)
  const c = evaluarHorario(config, 'EMPLEADO', 'Dock Sud', aLas('19:50') + 999)
  assert.ok(a.tipo === 'dentro' && b.tipo === 'dentro' && c.tipo === 'dentro')
  if (a.tipo === 'dentro' && b.tipo === 'dentro' && c.tipo === 'dentro') {
    assert.equal(a.cierraEnMs, aLas('20:00'))
    assert.equal(b.cierraEnMs, a.cierraEnMs)
    assert.equal(c.cierraEnMs, a.cierraEnMs)
  }
})

test('la hora y el día son los de Argentina aunque en UTC ya sea otro día', () => {
  const instante = Date.parse('2026-11-10T02:30:00Z') // lunes 9 a las 23:30 en Argentina
  assert.equal(horaDeArgentina(instante), '23:30')
  assert.equal(minutosDeArgentina(instante), 23 * 60 + 30)
  assert.deepEqual(diaDeArgentina(instante), { diaDeLaSemana: 1, fecha: '2026-11-09' })
  assert.equal(evaluarHorario(config, 'EMPLEADO', 'Dock Sud', instante).tipo, 'fuera')
})

test('no se puede guardar una salida anterior a la entrada, una hora inválida ni una regla sin días', () => {
  assert.equal(motivoDeConfiguracionInvalida(config), null)
  const mala = armar()
  mala.sucursales['Dock Sud'].EMPLEADO = { activo: true, desde: '20:00', hasta: '10:00', dias: LUN_A_VIE }
  assert.match(motivoDeConfiguracionInvalida(mala) ?? '', /posterior/)
  const otra = armar()
  otra.sucursales['Lanús'].ADMIN = { activo: true, desde: '9:00', hasta: '21:00', dias: LUN_A_VIE }
  assert.match(motivoDeConfiguracionInvalida(otra) ?? '', /entrada.*Lanús/)
  const sinDias = armar()
  sinDias.sucursales['Dock Sud'].ADMIN = { activo: true, desde: '09:00', hasta: '21:00', dias: [] }
  assert.match(motivoDeConfiguracionInvalida(sinDias) ?? '', /al menos un día/)
})

test('normalizar: lo viejo, lo que falta y lo roto nunca hacen fallar y siempre dejan las cuatro sucursales', () => {
  const vacia = normalizarConfiguracion(null)
  assert.equal(vacia.habilitado, false)
  assert.deepEqual(Object.keys(vacia.sucursales), ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
  // El formato anterior: un solo horario para toda la agencia, todos los días.
  const viejo = normalizarConfiguracion({
    habilitado: true,
    ADMIN: { activo: true, desde: '09:00', hasta: '21:00' },
    EMPLEADO: { activo: true, desde: '10:00', hasta: '20:00' },
  })
  assert.equal(viejo.habilitado, true)
  assert.deepEqual(viejo.sucursales['Sarandí'].EMPLEADO, { activo: true, desde: '10:00', hasta: '20:00', dias: [0, 1, 2, 3, 4, 5, 6] })
  // Una sucursal que no existe se ignora; un feriado con fecha imposible se descarta; los días se ordenan.
  const rota = normalizarConfiguracion({
    habilitado: true,
    sucursales: {
      'Dock Sud': { ADMIN: { activo: true, desde: '09:00', hasta: '21:00', dias: [5, 1, 1, 9] }, feriados: [{ fecha: '2026-02-30' }, { fecha: '2026-05-01', motivo: 'Trabajo' }] },
      Marte: { ADMIN: { activo: true } },
    },
  })
  assert.deepEqual(Object.keys(rota.sucursales), ['Dock Sud', 'Lanús', 'Sarandí', 'Daniel'])
  assert.deepEqual(rota.sucursales['Dock Sud'].ADMIN.dias, [1, 5])
  assert.deepEqual(rota.sucursales['Dock Sud'].feriados, [{ fecha: '2026-05-01', motivo: 'Trabajo' }])
})

test('textoDeDias y fechas reales', () => {
  assert.equal(textoDeDias([1, 2, 3, 4, 5]), 'lunes a viernes')
  assert.equal(textoDeDias([0, 1, 2, 3, 4, 5, 6]), 'todos los días')
  assert.equal(textoDeDias([1, 3, 6]), 'lunes, miércoles y sábado')
  assert.equal(textoDeDias([6]), 'sábado')
  assert.equal(textoDeDias([6, 0]), 'sábado y domingo')
  assert.equal(esFechaReal('2026-12-25'), true)
  assert.equal(esFechaReal('2026-02-30'), false)
  assert.equal(esFechaReal('25/12/2026'), false)
})
