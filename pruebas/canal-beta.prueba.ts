// El canal beta se reconoce por la versión, y la versión de cada beta se calcula siempre igual. Lo que
// no se puede probar acá (la instalación lado a lado, el feed de actualización) está explicado en el
// README, «Versión beta».
import assert from 'node:assert/strict'
import test from 'node:test'
import { esVersionBeta, nombreDelPrograma } from '../src/shared/canal'
import { versionDeBeta } from '../scripts/version-beta.mjs'

test('esVersionBeta distingue la beta de la estable por el sufijo', () => {
  assert.equal(esVersionBeta('17.7.3-beta.12'), true)
  assert.equal(esVersionBeta('17.7.3-beta'), true)
  assert.equal(esVersionBeta('17.7.2'), false)
  assert.equal(esVersionBeta('17.7.2-rc.1'), false, 'sólo «beta» es la beta')
  assert.equal(esVersionBeta('1.0.0-alphabeta.1'), false, '«beta» pegado a otra palabra no cuenta')
})

test('el nombre del programa lleva «(Beta)» sólo en la beta', () => {
  assert.equal(nombreDelPrograma('estable'), 'DM Gestión')
  assert.equal(nombreDelPrograma('beta'), 'DM Gestión (Beta)')
})

test('versionDeBeta es el próximo parche con el número de corrida', () => {
  assert.equal(versionDeBeta('17.7.2', 41), '17.7.3-beta.41')
  assert.equal(versionDeBeta('17.7.9', '3'), '17.7.10-beta.3')
  assert.equal(versionDeBeta('17.7.2-beta.5', 6), '17.7.3-beta.6', 'si la base ya trae sufijo se usa su número base')
  assert.equal(esVersionBeta(versionDeBeta('17.7.2', 1)), true)
})

test('versionDeBeta rechaza lo que no tiene sentido', () => {
  assert.throws(() => versionDeBeta('v17', 1), /X\.Y\.Z/)
  assert.throws(() => versionDeBeta('17.7.2', 0), /entero positivo/)
  assert.throws(() => versionDeBeta('17.7.2', 'abc'), /entero positivo/)
})

test('el número de corrida viaja como número, no como texto', () => {
  // electron-updater compara «-beta.10» contra «-beta.9» como números (semver); mientras el sufijo sea un
  // entero sin ceros a la izquierda, la beta más nueva siempre es la mayor.
  assert.match(versionDeBeta('17.7.2', 9), /-beta\.9$/)
  assert.match(versionDeBeta('17.7.2', 10), /-beta\.10$/)
  assert.match(versionDeBeta('17.7.2', '007'), /-beta\.7$/, 'los ceros a la izquierda se normalizan')
})
