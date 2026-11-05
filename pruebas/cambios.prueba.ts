// Qué versiones muestra el cartel «Cambios recientes» según la última que vio cada persona.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { cambiosPendientes, compararVersiones, HISTORIAL_DE_CAMBIOS, type VersionConCambios } from '../src/shared/cambios'

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

test('cada beta nueva del mismo número vuelve a mostrar la entrada de su versión', () => {
  const conBeta = [v('17.9.1'), v('17.9.0')]
  assert.deepEqual(cambiosPendientes('17.9.1-beta.6', '17.9.1-beta.5', conBeta).map((e) => e.version), ['17.9.1'])
  assert.deepEqual(cambiosPendientes('17.9.1-beta.6', '17.9.1-beta.6', conBeta), [])
  assert.deepEqual(cambiosPendientes('17.9.1-beta.2', '17.9.0', conBeta).map((e) => e.version), ['17.9.1'])
})

test('el historial tiene la entrada de la versión del package.json y está ordenado de la más nueva a la más vieja', () => {
  const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }
  assert.ok(
    HISTORIAL_DE_CAMBIOS.some((entrada) => compararVersiones(entrada.version, version) === 0),
    `Falta la entrada '${version}' en src/shared/cambios.ts: sin ella el cartel «Cambios recientes» no muestra nada al actualizar.`,
  )
  for (let i = 1; i < HISTORIAL_DE_CAMBIOS.length; i++) {
    assert.ok(compararVersiones(HISTORIAL_DE_CAMBIOS[i - 1]!.version, HISTORIAL_DE_CAMBIOS[i]!.version) > 0, 'la más nueva va primero')
  }
  for (const entrada of HISTORIAL_DE_CAMBIOS) assert.ok(entrada.cambios.length > 0, `la ${entrada.version} no dice qué cambió`)
})
