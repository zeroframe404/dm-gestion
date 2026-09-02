// Las reglas de la vista: los pasos del zoom y qué columnas quedan a la vista.
//
// Son dos preferencias que se guardan en cada computadora, así que lo que se prueba acá es lo que
// pasa cuando lo guardado no coincide con el programa de hoy: un zoom raro escrito a mano, una
// columna que cambió de nombre entre dos versiones, o alguien que apagó todas las columnas.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acumularRueda,
  alternarOculta,
  columnasVisibles,
  comoPorcentaje,
  ESCALAS,
  ESCALA_NORMAL,
  escalaAnterior,
  escalaGuardada,
  escalaMasCercana,
  escalaSiguiente,
  RUEDA_POR_PASO,
  sanearOcultas,
  type ColumnaElegible,
} from '../src/renderer/vista'

// --- Zoom -------------------------------------------------------------------

test('los pasos del zoom van de menor a mayor y el 100 % es uno de ellos', () => {
  const ordenados = [...ESCALAS].sort((a, b) => a - b)
  assert.deepEqual(ESCALAS, ordenados, 'los pasos tienen que estar ordenados: los botones avanzan por índice')
  assert.ok(ESCALAS.includes(ESCALA_NORMAL), 'el tamaño normal tiene que ser un paso, si no «Ctrl 0» deja el botón en un valor que no existe')
  assert.equal(new Set(ESCALAS).size, ESCALAS.length, 'no puede haber pasos repetidos')
})

test('un zoom guardado a mano se acomoda al paso más parecido', () => {
  assert.equal(escalaMasCercana(1), 1)
  assert.equal(escalaMasCercana(0.91), 0.9)
  assert.equal(escalaMasCercana(1.2), 1.25)
  // Fuera de rango se queda en el extremo: es lo que ve alguien que editó el localStorage.
  assert.equal(escalaMasCercana(9), ESCALAS[ESCALAS.length - 1])
  assert.equal(escalaMasCercana(0.01), ESCALAS[0])
  // Y un valor que no es un número no puede dejar la ventana en cualquier tamaño.
  assert.equal(escalaMasCercana(Number.NaN), ESCALA_NORMAL)
  assert.equal(escalaMasCercana(Number.POSITIVE_INFINITY), ESCALA_NORMAL)
})

test('los botones avanzan de a un paso y se quedan en los extremos', () => {
  assert.equal(escalaSiguiente(1), 1.1)
  assert.equal(escalaAnterior(1), 0.9)
  // Desde un valor que no es un paso, primero se acomoda y después avanza.
  assert.equal(escalaSiguiente(1.19), 1.5)
  assert.equal(escalaAnterior(1.19), 1.1)
  // En el tope y en el piso no se rompe: se queda donde está (los botones se apagan solos).
  const maxima = ESCALAS[ESCALAS.length - 1]!
  const minima = ESCALAS[0]!
  assert.equal(escalaSiguiente(maxima), maxima)
  assert.equal(escalaAnterior(minima), minima)
})

test('ir y volver por todos los pasos no se pierde en el camino', () => {
  let escala = ESCALAS[0]!
  for (let i = 1; i < ESCALAS.length; i++) {
    escala = escalaSiguiente(escala)
    assert.equal(escala, ESCALAS[i], `subiendo se salteó el paso ${i}`)
  }
  for (let i = ESCALAS.length - 2; i >= 0; i--) {
    escala = escalaAnterior(escala)
    assert.equal(escala, ESCALAS[i], `bajando se salteó el paso ${i}`)
  }
})

test('lo que quedó guardado se lee con desconfianza', () => {
  assert.equal(escalaGuardada('1.25'), 1.25)
  assert.equal(escalaGuardada('0.9'), 0.9)
  // Nunca estuvo guardado: el tamaño de siempre.
  assert.equal(escalaGuardada(null), ESCALA_NORMAL)
  // Y esto es lo que importa: vacío NO puede terminar en 70 %. `Number('')` es 0, y 0 acomodado al
  // paso más cercano sería el más chico de todos; la ventana abriría chiquita por una clave a medio
  // escribir.
  assert.equal(escalaGuardada(''), ESCALA_NORMAL)
  assert.equal(escalaGuardada('   '), ESCALA_NORMAL)
  for (const basura of ['abc', 'null', '{}', '[1,2]', '1e999', '-5', '0', 'NaN', 'Infinity']) {
    assert.equal(escalaGuardada(basura), ESCALA_NORMAL, `«${basura}» tendría que volver al 100 %`)
  }
})

test('la rueda junta antes de mover un paso', () => {
  // Con el mouse, una muesca es un evento grande: un paso, como siempre.
  assert.deepEqual(acumularRueda(0, -RUEDA_POR_PASO), { acumulado: 0, paso: 1 })
  assert.deepEqual(acumularRueda(0, RUEDA_POR_PASO), { acumulado: 0, paso: -1 })

  // Con el touchpad, Chromium manda el pellizco en pedacitos: se juntan y recién ahí se mueve. Antes
  // de esto, cada uno de estos eventos valía un paso entero y un solo gesto se comía toda la escala.
  let acumulado = 0
  let pasos = 0
  for (let i = 0; i < 30; i++) {
    const resultado = acumularRueda(acumulado, -4)
    acumulado = resultado.acumulado
    pasos += resultado.paso
  }
  assert.equal(pasos, 1, `120 px de gesto tendrían que valer un paso, no ${pasos}`)
})

test('cambiar de sentido con la rueda arranca de cero', () => {
  // Si no, achicar después de agrandar tiene que remontar primero todo lo que se había juntado.
  const juntado = acumularRueda(0, -60)
  assert.deepEqual(juntado, { acumulado: -60, paso: 0 })
  assert.deepEqual(acumularRueda(juntado.acumulado, 60), { acumulado: 60, paso: 0 })
  // Y un evento de cero, o uno raro, no mueve ni ensucia lo juntado.
  assert.deepEqual(acumularRueda(-60, 0), { acumulado: -60, paso: 0 })
  assert.deepEqual(acumularRueda(-60, Number.NaN), { acumulado: -60, paso: 0 })
})

test('el porcentaje se muestra redondeado y con el signo', () => {
  assert.equal(comoPorcentaje(1), '100 %')
  assert.equal(comoPorcentaje(0.7), '70 %')
  assert.equal(comoPorcentaje(1.25), '125 %')
})

// --- Columnas ---------------------------------------------------------------

const COLUMNAS: ColumnaElegible[] = [
  { id: 'nombre', titulo: 'Nombre y apellido', siempre: true },
  { id: 'alerta', titulo: 'Alerta' },
  { id: 'sucursal', titulo: 'Sucursal' },
  { id: 'patente', titulo: 'Patente' },
]

test('lo guardado se limpia contra las columnas que existen hoy', () => {
  // «modelo» ya no existe (una versión le cambió el id) y «nombre» no se puede esconder: las dos se caen.
  assert.deepEqual(sanearOcultas(COLUMNAS, ['modelo', 'nombre', 'patente']), ['patente'])
  // Repetidos y desordenados entran igual y salen prolijos: dos listas iguales se escriben igual.
  assert.deepEqual(sanearOcultas(COLUMNAS, ['patente', 'alerta', 'patente']), ['alerta', 'patente'])
  assert.deepEqual(sanearOcultas(COLUMNAS, []), [])
})

test('apagar y prender una columna', () => {
  const conPatente = alternarOculta(COLUMNAS, [], 'patente')
  assert.deepEqual(conPatente, ['patente'])
  assert.deepEqual(alternarOculta(COLUMNAS, conPatente, 'patente'), [], 'volver a tocarla la prende')
  assert.deepEqual(alternarOculta(COLUMNAS, conPatente, 'alerta'), ['alerta', 'patente'])
})

test('el nombre no se puede apagar, ni pidiéndolo dos veces', () => {
  assert.deepEqual(alternarOculta(COLUMNAS, [], 'nombre'), [])
  assert.deepEqual(alternarOculta(COLUMNAS, ['patente'], 'nombre'), ['patente'])
  // Ni una columna inventada: llega de una preferencia vieja y no tiene que agregar nada.
  assert.deepEqual(alternarOculta(COLUMNAS, [], 'inventada'), [])
})

test('las visibles salen en el orden en que están declaradas', () => {
  const visibles = columnasVisibles(COLUMNAS, ['sucursal'])
  assert.deepEqual(
    visibles.map((columna) => columna.id),
    ['nombre', 'alerta', 'patente'],
  )
})

test('apagarlas todas no deja la pantalla en blanco', () => {
  // No se llega acá tocando el desplegable (el nombre no se apaga), pero sí editando el localStorage
  // a mano o si una versión futura dejara todas las columnas escondibles. Una tabla sin columnas es
  // una pantalla de la que no se sale más.
  const todas = COLUMNAS.map((columna) => columna.id)
  const visibles = columnasVisibles([{ id: 'a', titulo: 'A' }], ['a'])
  assert.deepEqual(
    visibles.map((columna) => columna.id),
    ['a'],
  )
  // Y con el nombre presente, apagar «todas» lo deja a él y a nadie más.
  assert.deepEqual(
    columnasVisibles(COLUMNAS, todas).map((columna) => columna.id),
    ['nombre'],
  )
})
