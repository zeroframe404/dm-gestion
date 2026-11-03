// Qué versiones muestra el cartel «Cambios recientes» según la última que vio cada persona.
import assert from 'node:assert/strict'
import test from 'node:test'
import { cambiosPendientes, compararVersiones, type VersionConCambios } from '../src/shared/cambios'

const v = (version: string): VersionConCambios => ({ version, fecha: '2026-01-01', cambios: [] })
const historial = [v('17.7.5'), v('17.7.3'), v('17.7.1')]

test('compararVersiones compara número a número e ignora el sufijo beta', () => {
  assert.ok(compararVersiones('17.10.0', '17.9.9') > 0)
  assert.equal(compararVersiones('17.7.5-beta.3', '17.7.5'), 0)
})

test('sin versión vista se muestra sólo la actual', () => {
  assert.deepEqual(cambiosPendientes('17.7.5', null, historial).map((e) => e.version), ['17.7.5'])
})

test('con versión vista se muestran las posteriores hasta la instalada', () => {
  assert.deepEqual(cambiosPendientes('17.7.5', '17.7.1', historial).map((e) => e.version), ['17.7.5', '17.7.3'])
  assert.deepEqual(cambiosPendientes('17.7.3', '17.7.1', historial).map((e) => e.version), ['17.7.3'])
  assert.deepEqual(cambiosPendientes('17.7.5', '17.7.5', historial), [])
})
