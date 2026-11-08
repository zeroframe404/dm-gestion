// El horario laboral: quién puede estar adentro a cada hora de Argentina y qué hace una excepción.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  evaluarHorario,
  HORARIO_POR_OMISION,
  horaDeArgentina,
  minutosDeArgentina,
  motivoDeConfiguracionInvalida,
  type ConfiguracionDeHorario,
} from '../src/shared/horario'

const config: ConfiguracionDeHorario = {
  habilitado: true,
  ADMIN: { activo: true, desde: '09:00', hasta: '21:00' },
  EMPLEADO: { activo: true, desde: '10:00', hasta: '20:00' },
}
/** Un instante a las HH:MM de Argentina (UTC-3) del 8 de noviembre de 2026. */
const aLas = (hora: string): number => Date.parse(`2026-11-08T${hora}:00-03:00`)

test('apagado, sin regla activa o superadministrador: a cualquier hora', () => {
  assert.equal(evaluarHorario(HORARIO_POR_OMISION, 'EMPLEADO', aLas('03:00')).tipo, 'libre')
  assert.equal(evaluarHorario({ ...config, EMPLEADO: { ...config.EMPLEADO, activo: false } }, 'EMPLEADO', aLas('03:00')).tipo, 'libre')
  assert.equal(evaluarHorario(config, 'SUPER_ADMIN', aLas('03:00')).tipo, 'libre')
})

test('dentro del turno dice a qué hora cierra; el borde de salida ya es fuera', () => {
  const dentro = evaluarHorario(config, 'EMPLEADO', aLas('19:30'))
  assert.equal(dentro.tipo, 'dentro')
  if (dentro.tipo === 'dentro') {
    assert.equal(dentro.cierraEnMs, aLas('20:00'))
    assert.equal(dentro.cierraA, '20:00')
  }
  assert.equal(evaluarHorario(config, 'EMPLEADO', aLas('10:00')).tipo, 'dentro')
  assert.equal(evaluarHorario(config, 'EMPLEADO', aLas('20:00')).tipo, 'fuera')
  assert.equal(evaluarHorario(config, 'EMPLEADO', aLas('09:59')).tipo, 'fuera')
})

test('el instante de cierre es el mismo en cada consulta del día (si no, el aviso se repetiría)', () => {
  const a = evaluarHorario(config, 'EMPLEADO', aLas('19:35') + 123)
  const b = evaluarHorario(config, 'EMPLEADO', aLas('19:35') + 20_457)
  const c = evaluarHorario(config, 'EMPLEADO', aLas('19:50') + 999)
  assert.ok(a.tipo === 'dentro' && b.tipo === 'dentro' && c.tipo === 'dentro')
  if (a.tipo === 'dentro' && b.tipo === 'dentro' && c.tipo === 'dentro') {
    assert.equal(a.cierraEnMs, aLas('20:00'))
    assert.equal(b.cierraEnMs, a.cierraEnMs)
    assert.equal(c.cierraEnMs, a.cierraEnMs)
  }
})

test('administradores y usuarios tienen horarios separados', () => {
  assert.equal(evaluarHorario(config, 'ADMIN', aLas('20:30')).tipo, 'dentro')
  assert.equal(evaluarHorario(config, 'EMPLEADO', aLas('20:30')).tipo, 'fuera')
})

test('una excepción vigente deja entrar fuera de turno y extiende el cierre', () => {
  const fuera = evaluarHorario(config, 'EMPLEADO', aLas('21:00'), aLas('22:00'))
  assert.deepEqual(fuera, { tipo: 'dentro', cierraEnMs: aLas('22:00'), cierraA: '22:00' })
  const antes = evaluarHorario(config, 'EMPLEADO', aLas('19:45'), aLas('20:45'))
  assert.equal(antes.tipo === 'dentro' && antes.cierraEnMs, aLas('20:45'))
  // Una excepción más corta que el turno no lo acorta.
  const corta = evaluarHorario(config, 'EMPLEADO', aLas('15:00'), aLas('15:30'))
  assert.equal(corta.tipo === 'dentro' && corta.cierraEnMs, aLas('20:00'))
  // Vencida: no cuenta.
  assert.equal(evaluarHorario(config, 'EMPLEADO', aLas('21:00'), aLas('20:59')).tipo, 'fuera')
})

test('la hora es la de Argentina aunque en UTC ya sea otro día', () => {
  const instante = Date.parse('2026-11-09T02:30:00Z')
  assert.equal(horaDeArgentina(instante), '23:30')
  assert.equal(minutosDeArgentina(instante), 23 * 60 + 30)
  assert.equal(evaluarHorario(config, 'EMPLEADO', instante).tipo, 'fuera')
})

test('no se puede guardar una salida anterior a la entrada ni una hora inválida', () => {
  assert.equal(motivoDeConfiguracionInvalida(config), null)
  assert.match(motivoDeConfiguracionInvalida({ ...config, EMPLEADO: { activo: true, desde: '20:00', hasta: '10:00' } }) ?? '', /posterior/)
  assert.match(motivoDeConfiguracionInvalida({ ...config, ADMIN: { activo: true, desde: '9:00', hasta: '21:00' } }) ?? '', /entrada/)
})
