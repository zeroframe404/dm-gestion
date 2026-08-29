// Las tres reglas nuevas del formulario de cliente: qué es un DNI y qué un CUIT, cómo se arma una
// dirección cargada en partes, y cuándo alguien es menor de edad.
//
// Son funciones puras de `shared`, así que se prueban sin base de datos y sin Electron. Van juntas
// porque las tres viven en la misma pantalla y las tres se rompen del mismo modo: en silencio.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DIRECCION_VACIA,
  direccionCompleta,
  direccionEstaVacia,
  faltantesDeDireccion,
  sanearDireccion,
  textoDeDireccion,
  textoDeLocalidad,
} from '../src/shared/direccion'
import { detectarDocumento, digitoVerificadorDeCuit, esCuitValido, formatearCuit } from '../src/shared/documento'
import { aniosCumplidos, calcularEdad, interpretarNacimiento } from '../src/shared/edad'

// ---------------------------------------------------------------------------
// DNI o CUIT
// ---------------------------------------------------------------------------

test('siete y ocho dígitos son un DNI, con o sin puntos', () => {
  assert.equal(detectarDocumento('12345678').clase, 'DNI')
  assert.equal(detectarDocumento('12.345.678').clase, 'DNI')
  assert.equal(detectarDocumento('1234567').clase, 'DNI')
  // Un cero adelante es de haberlo pegado de otro lado: se acepta y se muestra sin el relleno.
  assert.equal(detectarDocumento('012345678').digitos, '12345678')
  assert.equal(detectarDocumento('12.345.678').formateado, '12.345.678')
})

test('el verificador es el del módulo 11 de verdad', () => {
  // El CUIT de la agencia, que está impreso en el ticket: 30-70839042-5. Si el algoritmo estuviera mal,
  // este número —que se sabe correcto porque lo emitió la AFIP— no cerraría.
  assert.equal(digitoVerificadorDeCuit('3070839042'), 5)
  assert.equal(esCuitValido('30-70839042-5'), true)
  assert.equal(digitoVerificadorDeCuit('2012345678'), 6)
  // Menos de diez dígitos no tiene verificador que calcular.
  assert.equal(digitoVerificadorDeCuit('20123456'), null)
})

test('once dígitos con un prefijo de persona son un CUIL y traen el DNI adentro', () => {
  const detectado = detectarDocumento('20-12345678-6')
  assert.equal(detectado.clase, 'CUIL')
  assert.equal(detectado.valido, true)
  assert.equal(detectado.dni, '12345678')
  assert.equal(detectado.formateado, '20-12345678-6')
  // La leyenda le muestra a quien carga el DNI que hay adentro: es lo que va a buscar en el papel.
  assert.ok(detectado.leyenda.includes('12.345.678'))
})

test('un prefijo de empresa da CUIT y no tiene DNI adentro', () => {
  const digitos = `30123456${''}`
  // 30-12345678-? : se arma con el verificador que corresponda para no inventar un número inválido.
  const verificador = digitoVerificadorDeCuit('3012345678')
  assert.notEqual(verificador, null)
  const cuit = `3012345678${verificador}`
  const detectado = detectarDocumento(cuit)
  assert.equal(detectado.clase, 'CUIT')
  assert.equal(detectado.valido, true)
  assert.equal(detectado.dni, null)
  assert.ok(detectado.leyenda.includes('empresa'))
  assert.ok(digitos.startsWith('30'))
})

test('el verificador equivocado se avisa pero sigue siendo un CUIT', () => {
  // Como los que hay escritos a mano hace años en la hoja: el dígito no cierra y el cliente existe
  // igual. La pantalla lo avisa; el proceso principal lo guarda lo mismo, a propósito.
  const detectado = detectarDocumento('20-12345678-3')
  assert.equal(detectado.clase, 'CUIL')
  assert.equal(detectado.valido, false)
  assert.ok(detectado.leyenda.includes('último dígito'))
  assert.equal(esCuitValido('20-12345678-3'), false)
})

test('un comienzo que no existe se nombra como tal', () => {
  const detectado = detectarDocumento('99123456789')
  assert.equal(detectado.valido, false)
  assert.ok(detectado.leyenda.includes('99'))
})

test('lo que no llega a ninguna de las dos formas se dice sin adivinar', () => {
  assert.equal(detectarDocumento('').leyenda, '')
  assert.equal(detectarDocumento('123').clase, 'DESCONOCIDO')
  assert.ok(detectarDocumento('123').leyenda.includes('faltan'))
  assert.equal(detectarDocumento('1234567890').clase, 'DESCONOCIDO')
  assert.equal(formatearCuit('20123456784'), '20-12345678-4')
})

// ---------------------------------------------------------------------------
// La dirección en partes
// ---------------------------------------------------------------------------

test('la dirección en partes se arma en el renglón de siempre', () => {
  const direccion = sanearDireccion({
    calle: 'Mitre',
    calle2: 'Belgrano',
    altura: '1234',
    sinAltura: false,
    provincia: 'Buenos Aires',
    localidad: 'Lanús',
    codigoPostal: 'B1824',
  })
  assert.equal(textoDeDireccion(direccion), 'Mitre 1234, esq. Belgrano')
  assert.equal(textoDeLocalidad(direccion), 'Lanús, Buenos Aires (B1824)')
  assert.equal(direccionCompleta(direccion), 'Mitre 1234, esq. Belgrano · Lanús, Buenos Aires (B1824)')
})

test('«no tiene» altura se escribe s/n y borra el número que hubiera quedado', () => {
  const direccion = sanearDireccion({ calle: 'Pasaje Los Álamos', altura: '999', sinAltura: true })
  assert.equal(direccion.altura, '')
  assert.equal(textoDeDireccion(direccion), 'Pasaje Los Álamos s/n')
})

test('una dirección vacía no reclama nada; una a medias dice qué le falta', () => {
  assert.equal(direccionEstaVacia(DIRECCION_VACIA), true)
  assert.deepEqual(faltantesDeDireccion(DIRECCION_VACIA), [])

  const aMedias = sanearDireccion({ calle: 'Mitre' })
  assert.equal(direccionEstaVacia(aMedias), false)
  const faltan = faltantesDeDireccion(aMedias)
  assert.ok(faltan.some((falta) => falta.includes('altura')))
  assert.ok(faltan.includes('la localidad'))
  assert.ok(faltan.includes('la provincia'))
})

test('lo que venga guardado de una versión anterior no rompe nada', () => {
  const direccion = sanearDireccion(null)
  assert.deepEqual(direccion, DIRECCION_VACIA)
  assert.deepEqual(sanearDireccion({ calle: 42 as unknown as string }), { ...DIRECCION_VACIA, calle: '42' })
})

// ---------------------------------------------------------------------------
// Mayoría de edad
// ---------------------------------------------------------------------------

const HOY = new Date('2026-08-29T12:00:00Z')

test('la fecha de nacimiento se entiende escrita como se escribe en la agencia', () => {
  assert.equal(interpretarNacimiento('12/05/1980', HOY), '1980-05-12')
  assert.equal(interpretarNacimiento('12-5-1980', HOY), '1980-05-12')
  assert.equal(interpretarNacimiento('1980-05-12', HOY), '1980-05-12')
  // Con dos dígitos, «80» es 1980: nadie que esté cargando un seguro nació en 2080.
  assert.equal(interpretarNacimiento('12/05/80', HOY), '1980-05-12')
  assert.equal(interpretarNacimiento('12/05/10', HOY), '2010-05-12')
})

test('lo que no es una fecha no se fuerza a serlo', () => {
  assert.equal(interpretarNacimiento('', HOY), null)
  assert.equal(interpretarNacimiento('no sabe', HOY), null)
  assert.equal(interpretarNacimiento('31/02/1980', HOY), null)
  assert.equal(interpretarNacimiento('12/13/1980', HOY), null)
  assert.equal(interpretarNacimiento('12/05/2030', HOY), null)
})

test('una fecha de este mismo año pero que todavía no pasó no es un nacimiento', () => {
  // Mirar sólo el año dejaba entrar todo lo que faltaba del año en curso, y con eso la pantalla
  // mostraba «Usuario menor de edad · -1 años» a quien se equivocó tipeando el año.
  assert.equal(interpretarNacimiento('30/08/2026', HOY), null)
  assert.equal(interpretarNacimiento('31/12/2026', HOY), null)
  assert.equal(interpretarNacimiento('2026-12-31', HOY), null)

  const futura = calcularEdad('31/12/2026', HOY)
  assert.equal(futura.esMenor, false)
  assert.equal(futura.leyenda, '')
  assert.equal(futura.anios, null)
  assert.equal(futura.problema, 'Esa fecha todavía no pasó. Revisá el año.')

  // Un recién nacido de hoy sí entra: el corte es mañana, no este año.
  assert.equal(interpretarNacimiento('29/08/2026', HOY), '2026-08-29')
  assert.equal(calcularEdad('29/08/2026', HOY).anios, 0)
})

test('con dos dígitos, el año que caería en el futuro se va cien años atrás', () => {
  // «31/12/26» escrito en agosto de 2026 es alguien de 99 años, no un nacimiento de diciembre.
  assert.equal(interpretarNacimiento('31/12/26', HOY), '1926-12-31')
  // El que ya pasó este año se queda donde está.
  assert.equal(interpretarNacimiento('01/01/26', HOY), '2026-01-01')
})

test('el año demasiado viejo se explica por lo que le pasa', () => {
  assert.equal(interpretarNacimiento('12/05/1850', HOY), null)
  assert.equal(calcularEdad('12/05/1850', HOY).problema, 'Revisá el año: esa fecha es demasiado vieja.')
})

test('los años cumplidos cuentan si el cumpleaños ya pasó', () => {
  assert.equal(aniosCumplidos('1980-05-12', HOY), 46)
  // Cumple en diciembre: todavía no los cumplió.
  assert.equal(aniosCumplidos('1980-12-31', HOY), 45)
  // Cumple hoy mismo: los cumplió.
  assert.equal(aniosCumplidos('2008-08-29', HOY), 18)
})

test('menor de edad muestra la leyenda que pidió la agencia, y mayor no muestra ninguna', () => {
  const menor = calcularEdad('12/05/2010', HOY)
  assert.equal(menor.esMenor, true)
  assert.equal(menor.leyenda, 'Usuario menor de edad')
  assert.equal(menor.anios, 16)

  const mayor = calcularEdad('12/05/1980', HOY)
  assert.equal(mayor.esMenor, false)
  assert.equal(mayor.leyenda, '')

  // Justo el día que los cumple ya no es menor.
  assert.equal(calcularEdad('29/08/2008', HOY).esMenor, false)
  assert.equal(calcularEdad('30/08/2008', HOY).esMenor, true)
})

test('media fecha mientras se tipea no es un error; una fecha completa e imposible sí', () => {
  assert.equal(calcularEdad('12/0', HOY).problema, null)
  assert.notEqual(calcularEdad('31/02/1980', HOY).problema, null)
})
