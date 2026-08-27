// La ticketeadora del mostrador: cuándo pregunta antes de imprimir y de dónde sale la dirección que
// encabeza el comprobante. El armado del ticket en sí vive en ticket.ts, que habla con Electron y por
// eso no entra en el banco de pruebas; lo que se prueba acá es lo que decide qué sale impreso.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db } from '../src/main/db/base'
import {
  direccionDeSucursal,
  direccionesGuardadas,
  guardarDirecciones,
  guardarImpresora,
  impresoraGuardada,
} from '../src/main/servicios/preferencias'

function baseDePrueba(): void {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  abrirBaseDeDatos(':memory:')
  console.log = registrar
}

/** Escribe la preferencia a mano, para simular lo que dejó una versión anterior del programa. */
function guardarCrudo(clave: string, valor: string): void {
  db()
    .prepare(`INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)`)
    .run(clave, valor, new Date().toISOString())
}

// ---------------------------------------------------------------------------
// Preguntar antes de imprimir
// ---------------------------------------------------------------------------

test('sin impresora configurada no se imprime nada, pero se arranca preguntando', () => {
  baseDePrueba()
  const config = impresoraGuardada()
  assert.equal(config.habilitada, false)
  assert.equal(config.preguntar, true)
  cerrarBaseDeDatos()
})

test('una configuración guardada antes de que existiera la pregunta pasa a preguntar', () => {
  baseDePrueba()
  // Así quedaba guardada la impresora en las versiones anteriores: sin la clave «preguntar».
  guardarCrudo('impresora_ticket', JSON.stringify({ habilitada: true, impresora: 'POS-80', anchoMm: 80 }))
  const config = impresoraGuardada()
  assert.equal(config.habilitada, true)
  assert.equal(config.impresora, 'POS-80')
  assert.equal(config.preguntar, true)
  cerrarBaseDeDatos()
})

test('apagar la pregunta queda guardado: el ticket vuelve a salir solo', () => {
  baseDePrueba()
  guardarImpresora({ habilitada: true, preguntar: false, impresora: 'POS-80', anchoMm: 80 })
  assert.equal(impresoraGuardada().preguntar, false)

  guardarImpresora({ habilitada: true, preguntar: true, impresora: 'POS-80', anchoMm: 80 })
  assert.equal(impresoraGuardada().preguntar, true)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Direcciones del encabezado
// ---------------------------------------------------------------------------

test('las tres direcciones de la agencia salen sin configurar nada', () => {
  baseDePrueba()
  assert.equal(direccionDeSucursal('Avellaneda'), 'Manuel Estévez N° 1234 Avellaneda')
  assert.equal(direccionDeSucursal('Sarandí'), 'Av. Bartolomé Mitre 2588')
  assert.equal(direccionDeSucursal('Lanús'), 'Centenario Uruguayo 1217')
  cerrarBaseDeDatos()
})

test('el nombre de la sucursal se compara sin acentos ni mayúsculas', () => {
  baseDePrueba()
  assert.equal(direccionDeSucursal('LANUS'), 'Centenario Uruguayo 1217')
  assert.equal(direccionDeSucursal('  sarandi  '), 'Av. Bartolomé Mitre 2588')
  cerrarBaseDeDatos()
})

test('una sucursal nueva empieza sin dirección y se le carga la suya', () => {
  baseDePrueba()
  assert.equal(direccionDeSucursal('Quilmes'), '')

  guardarDirecciones([{ sucursal: 'Quilmes', direccion: 'Rivadavia 100' }])
  assert.equal(direccionDeSucursal('Quilmes'), 'Rivadavia 100')
  assert.equal(direccionDeSucursal('QUILMES'), 'Rivadavia 100')
  cerrarBaseDeDatos()
})

test('lo cargado a mano le gana a la dirección que viene de fábrica, incluso vacío', () => {
  baseDePrueba()
  guardarDirecciones([{ sucursal: 'Avellaneda', direccion: 'Belgrano 500' }])
  assert.equal(direccionDeSucursal('Avellaneda'), 'Belgrano 500')

  // Borrar la dirección es una decisión: no puede volver la de fábrica en el siguiente ticket.
  guardarDirecciones([{ sucursal: 'Avellaneda', direccion: '' }])
  assert.equal(direccionDeSucursal('Avellaneda'), '')
  cerrarBaseDeDatos()
})

test('una sucursal repetida o sin nombre no se guarda dos veces', () => {
  baseDePrueba()
  guardarDirecciones([
    { sucursal: 'Lanús', direccion: 'Centenario Uruguayo 1217' },
    { sucursal: 'LANUS', direccion: 'otra distinta' },
    { sucursal: '   ', direccion: 'sin sucursal' },
  ])
  const guardadas = direccionesGuardadas()
  assert.equal(guardadas.size, 1)
  assert.equal(direccionDeSucursal('Lanús'), 'Centenario Uruguayo 1217')
  cerrarBaseDeDatos()
})
