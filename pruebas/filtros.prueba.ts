// El contrato de los filtros ahora que eligen de a varias opciones, y las dos cosas que no se pueden
// romper al soltarlo:
//
//  1. **La lista vacía es «todas»**, que es exactamente lo que quería decir el `''` de antes. Una
//     pantalla sin nada elegido tiene que seguir mostrando todo.
//  2. **Elegir de a uno tiene que traer lo mismo que traía antes.** Si al pasar a listas se afloja la
//     comparación, aparecen filas que antes no estaban y nadie lo nota hasta que un reporte da mal.
//
// Y la tercera, que es la más cara si se rompe: un segmento de marketing guardado ANTES de este
// cambio tiene `"sucursal": "Dock Sud"` en su `filtros_json`. Si se leyera sólo la clave nueva, el
// segmento quedaría sin filtro y el WhatsApp saldría para la cartera entera en vez de para un
// mostrador. Eso no se puede arreglar después de mandarlo.
import assert from 'node:assert/strict'
import test from 'node:test'
import { sanearFiltrosDeSegmento } from '../src/main/servicios/marketing'
import {
  coincideAlguno,
  dentroDelRango,
  diaDeFecha,
  limiteDeFecha,
  listaDeFiltro,
  mismoTextoDeFiltro,
  normalizarParaFiltro,
  numerosDeFiltro,
} from '../src/shared/filtros'
import { mismaSucursal } from '../src/shared/sucursales'

// ---------------------------------------------------------------------------
// Lo que llega de la pantalla
// ---------------------------------------------------------------------------

test('la lista vacía, el vacío y el nulo quieren decir los tres «todas»', () => {
  assert.deepEqual(listaDeFiltro([]), [])
  assert.deepEqual(listaDeFiltro(''), [])
  assert.deepEqual(listaDeFiltro(null), [])
  assert.deepEqual(listaDeFiltro(undefined), [])
  assert.deepEqual(listaDeFiltro(['', '  ']), [])
})

test('un texto suelto sigue queriendo decir «sólo ése»', () => {
  // Los filtros viajaban como `string`. Aceptar la forma vieja es lo que hace que un `filtros_json`
  // guardado, o una computadora a medio actualizar, no se quede sin filtro en silencio.
  assert.deepEqual(listaDeFiltro('ATM'), ['ATM'])
  assert.deepEqual(listaDeFiltro('Dock Sud'), ['Dock Sud'])
})

test('la lista llega limpia: sin vacíos, sin repetidos y en el orden en que vino', () => {
  assert.deepEqual(listaDeFiltro([' ATM ', 'METROPOL', 'ATM', '', null, 'METROPOL']), ['ATM', 'METROPOL'])
  // Lo que no es un texto ni un número se descarta en vez de romper la pantalla.
  assert.deepEqual(listaDeFiltro([{ a: 1 }, ['x'], 'ATM']), ['ATM'])
})

test('los filtros de números descartan lo que no es entero', () => {
  assert.deepEqual(numerosDeFiltro([3, '1', -1]), [-1, 1, 3])
  assert.deepEqual(numerosDeFiltro(['hola', null, 2.5, NaN]), [])
  assert.deepEqual(numerosDeFiltro(7), [7])
  assert.deepEqual(numerosDeFiltro([]), [])
})

// ---------------------------------------------------------------------------
// Cómo se aplica
// ---------------------------------------------------------------------------

test('sin nada elegido no se filtra nada, ni siquiera lo vacío', () => {
  assert.equal(coincideAlguno([], 'ATM'), true)
  assert.equal(coincideAlguno([], null), true)
  assert.equal(coincideAlguno(undefined, 'ATM'), true)
})

test('elegir de a uno trae lo mismo que traía el filtro de un solo valor', () => {
  assert.equal(coincideAlguno(['ATM'], 'ATM'), true)
  assert.equal(coincideAlguno(['ATM'], 'atm'), true, 'sin mayúsculas')
  assert.equal(coincideAlguno(['RIO URUGUAY'], 'Río Uruguay'), true, 'sin tildes')
  assert.equal(coincideAlguno(['ATM'], 'METROPOL'), false)
  assert.equal(coincideAlguno(['ATM'], null), false)
})

test('elegir de a varias es la unión, no la intersección', () => {
  const elegidas = ['ATM', 'METROPOL']
  assert.equal(coincideAlguno(elegidas, 'ATM'), true)
  assert.equal(coincideAlguno(elegidas, 'Metropol'), true)
  assert.equal(coincideAlguno(elegidas, 'SANCOR'), false)
})

test('la sucursal se compara con `mismaSucursal`, que sabe que Avellaneda es Dock Sud', () => {
  // Es lo que hace que toda opción del desplegable traiga sus filas y toda fila tenga su opción. Con
  // el texto pelado, elegir «Dock Sud» dejaba afuera las filas que dicen «AVELLANEDA» y no quedaba
  // ninguna opción que las trajera: la fila sigue en la base y no hay forma de verla.
  assert.equal(coincideAlguno(['Dock Sud'], 'AVELLANEDA', mismaSucursal), true)
  assert.equal(coincideAlguno(['Dock Sud'], 'DOCKSUD', mismaSucursal), true)
  assert.equal(coincideAlguno(['Dock Sud', 'Daniel'], 'DANIEL', mismaSucursal), true)
  assert.equal(coincideAlguno(['Dock Sud'], 'Lanús', mismaSucursal), false)
})

test('la comparación del renderer borra la puntuación entera', () => {
  // La del proceso principal (`mismoTexto` de importacion/normalizar) deja un espacio en su lugar, así
  // que para ésa «RIO URUGUAY» y «RIOURUGUAY» son distintas. La diferencia es chica pero real: cada
  // lado usa la suya, y por eso `coincideAlguno` recibe el comparador en vez de fijar uno.
  assert.equal(normalizarParaFiltro('Río Uruguay'), 'RIOURUGUAY')
  assert.equal(mismoTextoDeFiltro('RIO URUGUAY', 'RIOURUGUAY'), true)
  assert.equal(mismoTextoDeFiltro(' pick-up ', 'PICK UP'), true)
})

// ---------------------------------------------------------------------------
// Los segmentos guardados: la forma vieja se sigue leyendo
// ---------------------------------------------------------------------------

test('un segmento guardado con la forma vieja conserva su filtro', () => {
  // Esto es un `filtros_json` tal cual quedó guardado antes de que los filtros eligieran de a varios.
  const guardadoAntes = JSON.parse(
    '{"sucursal":"Dock Sud","compania":"ATM","formaPago":"CUPONERA","vence":"ESTE MES","soloImpagas":true,"soloSinAvisar":false,"excluirDebito":true}',
  ) as unknown

  const filtros = sanearFiltrosDeSegmento(guardadoAntes)
  assert.deepEqual(filtros.sucursales, ['Dock Sud'], 'la sucursal guardada no se puede perder')
  assert.deepEqual(filtros.companias, ['ATM'])
  assert.deepEqual(filtros.formasDePago, ['CUPONERA'])
  assert.deepEqual(filtros.ramas, [], 'la rama no existía: queda en «todas»')
  assert.equal(filtros.vence, 'ESTE MES')
  assert.equal(filtros.soloImpagas, true)
  assert.equal(filtros.excluirDebito, true)
})

test('un segmento guardado con la forma nueva se lee igual', () => {
  const filtros = sanearFiltrosDeSegmento({
    sucursales: ['Dock Sud', 'Daniel'],
    companias: ['ATM', 'METROPOL'],
    formasDePago: [],
    ramas: ['MOTO'],
    vence: '',
    soloImpagas: false,
    soloSinAvisar: true,
    excluirDebito: false,
  })
  assert.deepEqual(filtros.sucursales, ['Dock Sud', 'Daniel'])
  assert.deepEqual(filtros.companias, ['ATM', 'METROPOL'])
  assert.deepEqual(filtros.ramas, ['MOTO'])
  assert.equal(filtros.soloImpagas, false)
  assert.equal(filtros.soloSinAvisar, true)
})

test('un segmento roto no rompe la pantalla: queda sin filtrar', () => {
  const filtros = sanearFiltrosDeSegmento({ sucursal: null, compania: 42, vence: 'CUANDO SEA' })
  assert.deepEqual(filtros.sucursales, [])
  assert.deepEqual(filtros.companias, ['42'], 'un número se lee como su texto, que es lo que hacía antes')
  assert.equal(filtros.vence, '', 'una ventana inventada no filtra')
  assert.deepEqual(sanearFiltrosDeSegmento(null).sucursales, [])
  assert.deepEqual(sanearFiltrosDeSegmento('cualquier cosa').companias, [])
})

// ---------------------------------------------------------------------------
// Rangos de fecha (#121)
// ---------------------------------------------------------------------------

test('un rango sin límites no filtra, ni siquiera lo que no tiene fecha', () => {
  assert.equal(dentroDelRango(null, '', ''), true)
  assert.equal(dentroDelRango('a confirmar', undefined, null), true)
  assert.equal(dentroDelRango('2026-09-18', '', ''), true)
})

test('las dos puntas del rango entran', () => {
  assert.equal(dentroDelRango('2026-08-15', '2026-08-15', '2026-10-18'), true)
  assert.equal(dentroDelRango('2026-10-18', '2026-08-15', '2026-10-18'), true)
  assert.equal(dentroDelRango('2026-08-14', '2026-08-15', '2026-10-18'), false)
  assert.equal(dentroDelRango('2026-10-19', '2026-08-15', '2026-10-18'), false)
  // Con una sola punta: «vence hasta el 18/10» y «emitidas desde el 15/8».
  assert.equal(dentroDelRango('2026-01-01', '', '2026-10-18'), true)
  assert.equal(dentroDelRango('2027-01-01', '2026-08-15', ''), true)
})

test('con un límite puesto, lo que no tiene fecha (o no se entiende) queda afuera', () => {
  assert.equal(dentroDelRango(null, '2026-08-15', ''), false)
  assert.equal(dentroDelRango('', '', '2026-10-18'), false)
  assert.equal(dentroDelRango('18/9/2026', '2026-08-15', ''), false, 'el texto de la hoja no se adivina')
})

test('un límite mal formado es lo mismo que uno vacío', () => {
  assert.equal(limiteDeFecha('15/8/2026'), '')
  assert.equal(limiteDeFecha(20260815), '')
  assert.equal(limiteDeFecha(' 2026-08-15 '), '2026-08-15')
  assert.equal(dentroDelRango(null, 'ayer', '15/8/2026'), true)
})

test('una marca de tiempo se compara por su día en hora local', () => {
  const instante = new Date(2026, 8, 18, 23, 30) // 18/9 a las 23:30, en el huso de la máquina
  assert.equal(diaDeFecha(instante.toISOString()), '2026-09-18')
  assert.equal(dentroDelRango(instante.toISOString(), '2026-09-18', '2026-09-18'), true)
  assert.equal(diaDeFecha('2026-09-18'), '2026-09-18')
  assert.equal(diaDeFecha('cualquier cosa'), null)
})
