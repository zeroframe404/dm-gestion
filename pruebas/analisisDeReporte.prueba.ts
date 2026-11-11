// El análisis con IA de los reportes: cómo queda pegado al cuerpo del issue.
import assert from 'node:assert/strict'
import test from 'node:test'
import { cuerpoConAnalisis, LARGO_MAXIMO_DEL_CUERPO } from '../src/shared/asistente'

test('sin análisis, el cuerpo sale tal cual lo escribió la persona', () => {
  assert.equal(cuerpoConAnalisis('No guarda la póliza', null), 'No guarda la póliza')
})

test('el análisis va abajo, separado de lo que escribió la persona', () => {
  const cuerpo = cuerpoConAnalisis('No guarda la póliza', '**Qué pasa**: no se guarda.')
  assert.ok(cuerpo.startsWith('No guarda la póliza\n\n---'))
  assert.match(cuerpo, /Análisis automático \(IA\)/)
  assert.ok(cuerpo.endsWith('**Qué pasa**: no se guarda.'))
})

test('si no entra, se recorta el análisis y nunca lo que escribió la persona', () => {
  const largo = 'x'.repeat(15_000)
  const cuerpo = cuerpoConAnalisis(largo, 'y'.repeat(10_000))
  assert.ok(cuerpo.startsWith(largo))
  assert.ok(cuerpo.length <= LARGO_MAXIMO_DEL_CUERPO)
  assert.equal(cuerpoConAnalisis('z'.repeat(19_400), 'análisis'), 'z'.repeat(19_400))
})
