// La ticketeadora del mostrador: cuándo pregunta antes de imprimir y de dónde sale la dirección que
// encabeza el comprobante. El armado del ticket en sí vive en ticket.ts, que habla con Electron y por
// eso no entra en el banco de pruebas; lo que se prueba acá es lo que decide qué sale impreso.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db } from '../src/main/db/base'
import {
  direccionDeSucursal,
  direccionesGuardadas,
  establecerProximoNumeroDeTicket,
  guardarDirecciones,
  guardarImpresora,
  impresoraGuardada,
  proximoNumeroDeTicket,
  telefonoDeSucursal,
  tomarNumeroDeTicket,
} from '../src/main/servicios/preferencias'
import { ErrorDeNegocio } from '../src/main/servicios/errores'

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
  guardarImpresora({ habilitada: true, preguntar: false, impresora: 'POS-80', anchoMm: 80, copias: 1 })
  assert.equal(impresoraGuardada().preguntar, false)

  guardarImpresora({ habilitada: true, preguntar: true, impresora: 'POS-80', anchoMm: 80, copias: 1 })
  assert.equal(impresoraGuardada().preguntar, true)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Cantidad de copias
// ---------------------------------------------------------------------------

test('sin configurar nada, sale una sola copia', () => {
  baseDePrueba()
  assert.equal(impresoraGuardada().copias, 1)
  cerrarBaseDeDatos()
})

test('una configuración guardada antes de que existieran las copias trae una sola', () => {
  baseDePrueba()
  guardarCrudo('impresora_ticket', JSON.stringify({ habilitada: true, preguntar: true, impresora: 'POS-80', anchoMm: 80 }))
  assert.equal(impresoraGuardada().copias, 1)
  cerrarBaseDeDatos()
})

test('se puede guardar 1 o 2 copias', () => {
  baseDePrueba()
  guardarImpresora({ habilitada: true, preguntar: true, impresora: 'POS-80', anchoMm: 80, copias: 2 })
  assert.equal(impresoraGuardada().copias, 2)

  guardarImpresora({ habilitada: true, preguntar: true, impresora: 'POS-80', anchoMm: 80, copias: 1 })
  assert.equal(impresoraGuardada().copias, 1)
  cerrarBaseDeDatos()
})

test('una cantidad de copias fuera de 1 o 2 se rechaza', () => {
  baseDePrueba()
  assert.throws(
    () => guardarImpresora({ habilitada: true, preguntar: true, impresora: 'POS-80', anchoMm: 80, copias: 0 }),
    ErrorDeNegocio,
  )
  assert.throws(
    () => guardarImpresora({ habilitada: true, preguntar: true, impresora: 'POS-80', anchoMm: 80, copias: 3 }),
    ErrorDeNegocio,
  )
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Numeración de los tickets
// ---------------------------------------------------------------------------

test('el correlativo arranca en 1 y sube de a uno con cada ticket', () => {
  baseDePrueba()
  assert.equal(proximoNumeroDeTicket(), 1)
  assert.equal(tomarNumeroDeTicket(), 1)
  assert.equal(tomarNumeroDeTicket(), 2)
  assert.equal(tomarNumeroDeTicket(), 3)
  assert.equal(proximoNumeroDeTicket(), 4)
  cerrarBaseDeDatos()
})

test('el correlativo se puede corregir a mano', () => {
  baseDePrueba()
  tomarNumeroDeTicket()
  tomarNumeroDeTicket()
  establecerProximoNumeroDeTicket(500)
  assert.equal(proximoNumeroDeTicket(), 500)
  assert.equal(tomarNumeroDeTicket(), 500)
  assert.equal(proximoNumeroDeTicket(), 501)
  cerrarBaseDeDatos()
})

test('el correlativo no admite un número inválido', () => {
  baseDePrueba()
  assert.throws(() => establecerProximoNumeroDeTicket(0), ErrorDeNegocio)
  assert.throws(() => establecerProximoNumeroDeTicket(-5), ErrorDeNegocio)
  assert.throws(() => establecerProximoNumeroDeTicket(1.5), ErrorDeNegocio)
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

// ---------------------------------------------------------------------------
// Teléfono del encabezado, uno por sucursal
// ---------------------------------------------------------------------------

test('sin cargar nada, las cuatro sucursales encabezan con el teléfono de la agencia', () => {
  baseDePrueba()
  assert.equal(telefonoDeSucursal('Avellaneda'), '11 4083-0416')
  assert.equal(telefonoDeSucursal('Sarandí'), '11 4083-0416')
  assert.equal(telefonoDeSucursal('Lanús'), '11 4083-0416')
  assert.equal(telefonoDeSucursal('Daniel'), '11 4083-0416')
  cerrarBaseDeDatos()
})

test('cada local puede tener su propio teléfono sin tocar el de las demás', () => {
  baseDePrueba()
  guardarDirecciones([
    { sucursal: 'Sarandí', direccion: 'Av. Bartolomé Mitre 2588', telefono: '11 2222-3333' },
    { sucursal: 'Lanús', direccion: 'Centenario Uruguayo 1217', telefono: '11 4444-5555' },
  ])
  assert.equal(telefonoDeSucursal('Sarandí'), '11 2222-3333')
  assert.equal(telefonoDeSucursal('LANUS'), '11 4444-5555')
  // La que nadie tocó sigue con el de la agencia.
  assert.equal(telefonoDeSucursal('Avellaneda'), '11 4083-0416')
  cerrarBaseDeDatos()
})

test('borrar el teléfono es una decisión: el ticket sale sin él', () => {
  baseDePrueba()
  guardarDirecciones([{ sucursal: 'Sarandí', direccion: 'Av. Bartolomé Mitre 2588', telefono: '' }])
  assert.equal(telefonoDeSucursal('Sarandí'), '')
  cerrarBaseDeDatos()
})

test('lo guardado por una versión sin teléfonos conserva el de la agencia', () => {
  baseDePrueba()
  // Así quedaban guardadas las direcciones antes de que el teléfono fuera por sucursal.
  guardarCrudo('direcciones_ticket', JSON.stringify([{ sucursal: 'Sarandí', direccion: 'Belgrano 500' }]))
  assert.equal(direccionDeSucursal('Sarandí'), 'Belgrano 500')
  assert.equal(telefonoDeSucursal('Sarandí'), '11 4083-0416')
  cerrarBaseDeDatos()
})

test('guardar una dirección sin mandar el teléfono no borra el que ya estaba', () => {
  baseDePrueba()
  guardarDirecciones([{ sucursal: 'Sarandí', direccion: 'Av. Bartolomé Mitre 2588', telefono: '11 2222-3333' }])
  // Una pantalla vieja manda la fila sin teléfono: no hay decisión que guardar, se conserva el suyo.
  guardarDirecciones([{ sucursal: 'Sarandí', direccion: 'Belgrano 500' }])
  assert.equal(direccionDeSucursal('Sarandí'), 'Belgrano 500')
  assert.equal(telefonoDeSucursal('Sarandí'), '11 2222-3333')
  cerrarBaseDeDatos()
})

test('una sucursal fuera del catálogo arranca sin teléfono', () => {
  baseDePrueba()
  assert.equal(telefonoDeSucursal('Quilmes'), '')
  guardarDirecciones([{ sucursal: 'Quilmes', direccion: 'Rivadavia 100', telefono: '11 9999-0000' }])
  assert.equal(telefonoDeSucursal('Quilmes'), '11 9999-0000')
  cerrarBaseDeDatos()
})
