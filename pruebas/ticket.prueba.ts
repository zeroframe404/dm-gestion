// La ticketeadora del mostrador: cuándo pregunta antes de imprimir, de dónde sale la dirección que
// encabeza el comprobante y que lo impreso entre en el papel. Lo que habla con Electron —mandar el
// trabajo a la impresora— no entra en el banco de pruebas; el armado del HTML sí, que es una función
// pura y es donde se decide qué se ve y qué se pierde por el borde.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db } from '../src/main/db/base'
import {
  anchoDeLineaMm,
  anchoUtilDelTicket,
  htmlDelTicket,
  puntosDelEncabezado,
  SANGRIA_DEL_TICKET_MM,
  type DatosDeTicket,
} from '../src/main/servicios/ticket'
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

// ---------------------------------------------------------------------------
// Que lo impreso entre en el papel
// ---------------------------------------------------------------------------

/** Un comprobante cualquiera, con los datos más largos que se ven en el mostrador. */
function ticketDeEjemplo(cambios: Partial<DatosDeTicket> = {}): DatosDeTicket {
  return {
    numero: 'N° 000123',
    direccion: 'Centenario Uruguayo N° 1217',
    telefono: '11 4083-0416',
    fecha: '2/9/2026',
    hora: '11:45',
    importe: '$88.300',
    periodo: 'SEPTIEMBRE',
    titular: 'PRUEBA DE IMPRESIÓN',
    domicilio: 'CALLE FALSA 123',
    compania: 'PRUEBA',
    patente: 'AA000AA',
    poliza: '000000',
    cobertura: 'RC',
    proximoVencimiento: '02/10/2026',
    ...cambios,
  }
}

test('el ticket se compone más angosto que el rollo: la térmica no imprime hasta el borde', () => {
  // Una POS-80 tiene 80 mm de papel, pero el cabezal cubre unos 72: lo que se dibuje más allá no sale.
  // Es lo que en Lanús le comía la hora y el final del teléfono.
  assert.ok(anchoUtilDelTicket(80) + SANGRIA_DEL_TICKET_MM <= 72)
  // Y sigue siendo un comprobante y no una tira de dos dedos.
  assert.ok(anchoUtilDelTicket(80) >= 60)
})

test('un papel angosto no deja el ticket en nada', () => {
  assert.equal(anchoUtilDelTicket(40), 30)
})

test('la letra del encabezado se achica lo justo para que la línea más larga entre entera', () => {
  const util = anchoUtilDelTicket(80)
  // La línea más larga del encabezado es la del inicio de actividades, con el número de inscripción.
  const largo = 'Inicio de actividades 08-2005 N 0000015865'.length
  const puntos = puntosDelEncabezado(util, largo)
  assert.ok(anchoDeLineaMm(largo, puntos) <= util)
  // Achicada lo justo: no se baja a lo ilegible por las dudas.
  assert.ok(puntos >= 7)
  // Y en un papel donde entra holgada no se achica nada.
  assert.equal(puntosDelEncabezado(anchoUtilDelTicket(110), largo), 8)
})

test('por más que no entre, la letra del encabezado nunca baja de lo legible', () => {
  assert.equal(puntosDelEncabezado(anchoUtilDelTicket(58), 42), 6)
})

test('la hora sale entera: ya no va empujada contra el borde que se recorta', () => {
  const html = htmlDelTicket(ticketDeEjemplo({ fecha: '22/12/2026', hora: '11:45' }), 80)
  assert.ok(html.includes('HORA: 11:45'))
  // Fecha y hora arrancan las dos desde la izquierda, con una separación fija: nada de mandarlas a los
  // extremos, que es lo que dejaba la hora sobre el borde que la térmica recorta.
  const reglaDeLaFechaYLaHora = /\.cuando \{([^}]*)\}/.exec(html)?.[1] ?? ''
  assert.ok(reglaDeLaFechaYLaHora !== '')
  assert.ok(!reglaDeLaFechaYLaHora.includes('justify-content'))
  // Y ninguna de las dos se parte al medio.
  assert.ok(html.includes('<span class="junto">HORA: 11:45</span>'))
  // Las dos juntas, con la separación del medio, entran en una línea.
  assert.ok(anchoDeLineaMm('FECHA: 22/12/2026HORA: 11:45'.length, 9) + 6 <= anchoUtilDelTicket(80))
})

test('el teléfono sale entero o baja de renglón, pero nunca cortado a la mitad', () => {
  const html = htmlDelTicket(ticketDeEjemplo({ telefono: '11 4083-0416' }), 80)
  assert.ok(html.includes('<span class="junto">Tel: 11 4083-0416</span>'))
  // Con el teléfono borrado la línea queda con la provincia sola, sin el guion colgando.
  const sinTelefono = htmlDelTicket(ticketDeEjemplo({ telefono: '' }), 80)
  assert.ok(sinTelefono.includes('<p>Pcia de Buenos Aires</p>'))
  assert.ok(!sinTelefono.includes('Tel:'))
})

test('un teléfono que no entra baja entero de renglón: la provincia queda arriba y el número abajo', () => {
  // Dos números en la misma sucursal es la línea más larga que se ve en el mostrador: ahí ni achicando
  // la letra hasta el mínimo legible entra junto con la provincia. Que baje de renglón se lee igual;
  // que se corte por el borde, no.
  const util = anchoUtilDelTicket(80)
  const telefono = '11 4083-0416 / 11 4083-0417'
  const html = htmlDelTicket(ticketDeEjemplo({ telefono }), 80)
  const puntos = Number(/\.encabezado \{ font-size: ([\d.]+)pt/.exec(html)?.[1])
  assert.ok(Number.isFinite(puntos))
  assert.ok(html.includes(`<span class="junto">Tel: ${telefono}</span>`))
  // El teléfono solo, en su renglón, entra holgado.
  assert.ok(anchoDeLineaMm(`Tel: ${telefono}`.length, puntos) <= util)
})

test('el comprobante entra en el papel de punta a punta', () => {
  // Las líneas fijas del ticket, con el tamaño de letra que les toca. Ninguna puede pasarse del ancho
  // útil: lo que se pasa no se imprime cortado, directamente no sale.
  const util = anchoUtilDelTicket(80)
  const html = htmlDelTicket(ticketDeEjemplo(), 80)
  const puntosDeAgencia = Number(/\.encabezado \{ font-size: ([\d.]+)pt/.exec(html)?.[1])
  const fijas: Array<[string, number]> = [
    ['Centenario Uruguayo N° 1217', 10],
    ['Pcia de Buenos Aires - Tel: 11 4083-0416', puntosDeAgencia],
    ['C.U.I.T  30-70839042-5', puntosDeAgencia],
    ['Inicio de actividades 08-2005 N 0000015865', puntosDeAgencia],
    ['Sección/Ramo: 04 – AUTOMOTOR', 10],
    ['PRÓXIMO VENCIMIENTO 02/10/2026', 10],
    ['NO EXPONER A LA LUZ Y AL CALOR', 7.5],
  ]
  for (const [texto, puntos] of fijas) {
    assert.ok(anchoDeLineaMm(texto.length, puntos) <= util, `no entra en el papel: ${texto}`)
  }
})

test('un dato largo baja de renglón en vez de salirse del papel', () => {
  const html = htmlDelTicket(ticketDeEjemplo({ titular: 'MARIA DE LOS ANGELES RODRIGUEZ DE FERNANDEZ' }), 80)
  assert.ok(html.includes('overflow-wrap: anywhere'))
  assert.ok(html.includes('MARIA DE LOS ANGELES RODRIGUEZ DE FERNANDEZ'))
})
