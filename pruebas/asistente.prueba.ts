// El asistente con IA: la elección del esfuerzo y el filtro de lo que nunca le llega a la IA.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ESFUERZOS,
  esfuerzoParaLaConsulta,
  filtrarParaLaIa,
  normalizarRespuesta,
  pareceClaveDeAnthropic,
  RESPUESTA_CONTRA_LOS_TERMINOS,
  RESPUESTA_FUERA_DE_TEMA,
  tacharSecretos,
} from '../src/shared/asistente'

test('el esfuerzo se elige según la consulta y nunca pasa de alto', () => {
  assert.equal(esfuerzoParaLaConsulta('hola'), 'low')
  assert.equal(esfuerzoParaLaConsulta('¿Cuántos clientes con deuda hay?'), 'medium')
  assert.equal(esfuerzoParaLaConsulta('Analizá la mora y sugerí a quién llamar primero'), 'high')
  assert.deepEqual([...ESFUERZOS], ['low', 'medium', 'high'])
})

test('los secretos no viajan a la IA para nadie', () => {
  const crudo = { nombre: 'Ana', claveApi: 'x', token: 'y', claveHash: 'z', rutaDelArchivo: 'C:/a', nota: 'mi clave es sk-ant-abcdefghijklmnopqrstuvwxyz' }
  const filtrado = filtrarParaLaIa(crudo, 'SUPER_ADMIN') as Record<string, unknown>
  assert.deepEqual(Object.keys(filtrado).sort(), ['nombre', 'nota'])
  assert.equal(filtrado.nota, 'mi clave es [clave oculta]')
})

test('a un usuario no le llegan los números de la agencia; a un administrador sí', () => {
  const tablero = { altas: 10, comisionEstimada: 5000, brutoCobrado: 90000 }
  assert.deepEqual(filtrarParaLaIa(tablero, 'EMPLEADO'), { altas: 10 })
  assert.deepEqual(filtrarParaLaIa(tablero, 'ADMIN'), tablero)
})

test('las listas largas se recortan con el total', () => {
  const filas = filtrarParaLaIa(Array.from({ length: 50 }, (_, i) => i), 'ADMIN') as unknown[]
  assert.equal(filas.length, 31)
  assert.match(String(filas[30]), /total: 50/)
})

test('tacharSecretos y la forma de la clave', () => {
  assert.equal(tacharSecretos('servidor 192.168.0.10'), 'servidor [IP oculta]')
  assert.ok(pareceClaveDeAnthropic('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'))
  assert.ok(!pareceClaveDeAnthropic('hola'))
})

test('las dos respuestas fijas salen tal cual, aunque la IA les agregue algo', () => {
  assert.equal(normalizarRespuesta('No puedo responder eso porque no tiene que ver con el software'), RESPUESTA_FUERA_DE_TEMA)
  assert.equal(
    normalizarRespuesta('No puedo responder eso porque no tiene que ver con el software. Igual te cuento: un puntero es…'),
    RESPUESTA_FUERA_DE_TEMA,
  )
  assert.equal(normalizarRespuesta('**Esa pregunta viola los terminos y condiciones de Claude**'), RESPUESTA_CONTRA_LOS_TERMINOS)
  assert.equal(normalizarRespuesta('Hay **3 pólizas** que vencen esta semana.'), 'Hay **3 pólizas** que vencen esta semana.')
})
