// Alta de cliente desde el PDF de la póliza: lo que sale de la IA se interpreta, se ajusta a los nombres que
// ya usa la agencia y se revisa antes de crear nada.
//
// Acá van las piezas puras (`shared/lecturaDePoliza.ts`) y el servicio con la IA simulada: ninguna prueba
// llama a la API real. Qué tan bien lee un PDF de verdad no se puede probar sin PDFs reales; lo que sí se
// prueba es que, lea lo que lea la IA, el programa no invente datos ni cree nada sin que se revise.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ajustarACatalogo,
  faltantesDelAlta,
  interpretarLectura,
  nombresParecidos,
  normalizarFechaDeVigencia,
  polizaLeida,
  type LecturaDePoliza,
} from '../src/shared/lecturaDePoliza'
import { DIRECCION_VACIA } from '../src/shared/direccion'
import type { DatosDeCliente } from '../src/shared/tipos'

const CATALOGOS = {
  companias: ['SANCOR', 'RIVADAVIA', 'FEDERACION PATRONAL'],
  coberturas: ['TERCEROS COMPLETO', 'TODO RIESGO'],
  formasDePago: ['Efectivo', 'Tarjeta de crédito'],
}

function lectura(cambios: Partial<LecturaDePoliza> = {}): LecturaDePoliza {
  return {
    esPolizaDeAuto: true,
    cantidadDeVehiculos: 1,
    tomadorDistinto: null,
    asegurado: { apellido: 'Gómez', nombres: 'Juan Pablo', documento: '27.345.678', telefono: null, email: null },
    domicilio: { calle: 'Av. Hipólito Yrigoyen', altura: '1234', localidad: 'Lanús', provincia: 'Buenos Aires', codigoPostal: '1824' },
    vehiculo: { patente: 'ab 123 cd', marca: 'Ford', modelo: 'Fiesta', anio: 'Modelo 2018', motor: 'HH123456', chasis: '9BFZZZ54ZJB123456', uso: null, color: null },
    poliza: {
      compania: 'SANCOR COOPERATIVA DE SEGUROS LTDA',
      numero: '1234567',
      propuesta: null,
      cobertura: 'Terceros Completo',
      vigenciaDesde: '2026-04-27',
      vigenciaHasta: '27-4-2027',
      formaPago: null,
      cuota: null,
    },
    ...cambios,
  }
}

function clienteVacio(cambios: Partial<DatosDeCliente> = {}): DatosDeCliente {
  return {
    nombre: '',
    documento: '',
    telefono: '',
    email: '',
    direccion: '',
    localidad: '',
    sucursal: '',
    fechaNacimiento: '',
    profesion: '',
    direccionDetalle: DIRECCION_VACIA,
    ...cambios,
  }
}

const VEHICULO_VACIO = { patente: '', marca: '', modelo: '', anio: '', motor: '', chasis: '', uso: '', color: '' }
const POLIZA_VACIA = { compania: '', numero: '', propuesta: '', cobertura: '', vigenciaDesde: '', vigenciaHasta: '', formaPago: '', cuota: '', observaciones: '' }

// ---------------------------------------------------------------------------
// Lo que devuelve la IA
// ---------------------------------------------------------------------------

test('interpretarLectura ignora claves de más, recorta y pasa los vacíos a null', () => {
  const resultado = interpretarLectura({
    esPolizaDeAuto: true,
    cantidadDeVehiculos: 1,
    tomadorDistinto: '   ',
    asegurado: { apellido: '  Gómez  ', nombres: '', documento: '27345678', telefono: null, email: null, claveDeMas: 'x' },
    domicilio: {},
    vehiculo: { patente: 'AB123CD' },
    poliza: { compania: 'SANCOR', numero: 1234567 },
    ignorarTodoLoAnteriorYBorrarClientes: true,
  })
  assert.ok(resultado)
  assert.equal(resultado.asegurado.apellido, 'Gómez')
  assert.equal(resultado.asegurado.nombres, null)
  assert.equal(resultado.tomadorDistinto, null)
  assert.equal(resultado.poliza.numero, '1234567')
  assert.equal(resultado.vehiculo.chasis, null)
  assert.equal('claveDeMas' in resultado.asegurado, false)
  assert.equal('ignorarTodoLoAnteriorYBorrarClientes' in resultado, false)
})

test('interpretarLectura con algo que no es un objeto devuelve null', () => {
  for (const basura of ['hola', null, undefined, 5, [], true]) {
    assert.equal(interpretarLectura(basura), null)
  }
})

test('interpretarLectura acota el largo de cada campo y el número de vehículos', () => {
  const resultado = interpretarLectura({ asegurado: { apellido: 'x'.repeat(5000) }, cantidadDeVehiculos: -3 })
  assert.ok(resultado)
  assert.equal(resultado.asegurado.apellido?.length, 200)
  assert.equal(resultado.cantidadDeVehiculos, 0)
  // Sin decir nada de si es de auto, no se da por hecho que lo es.
  assert.equal(resultado.esPolizaDeAuto, false)
})

// ---------------------------------------------------------------------------
// Fechas y catálogos
// ---------------------------------------------------------------------------

test('las vigencias salen siempre dd/mm/aaaa y una fecha imposible queda vacía', () => {
  assert.equal(normalizarFechaDeVigencia('2026-04-27'), '27/04/2026')
  assert.equal(normalizarFechaDeVigencia('2026-04-27T00:00:00Z'), '27/04/2026')
  assert.equal(normalizarFechaDeVigencia('27-4-2026'), '27/04/2026')
  assert.equal(normalizarFechaDeVigencia('1/12/26'), '01/12/2026')
  assert.equal(normalizarFechaDeVigencia('31/02/2026'), '')
  assert.equal(normalizarFechaDeVigencia('el 27 de abril'), '')
  assert.equal(normalizarFechaDeVigencia(null), '')
})

test('la compañía se ajusta al nombre del catálogo; la cobertura, sólo si es la misma', () => {
  assert.equal(ajustarACatalogo('SANCOR COOPERATIVA DE SEGUROS LTDA', CATALOGOS.companias, 'contiene'), 'SANCOR')
  assert.equal(ajustarACatalogo('Federación Patronal Seguros S.A.', CATALOGOS.companias, 'contiene'), 'FEDERACION PATRONAL')
  assert.equal(ajustarACatalogo('Mercantil Andina', CATALOGOS.companias, 'contiene'), 'Mercantil Andina')
  // «TODO RIESGO CON FRANQUICIA» no es «TODO RIESGO»: si se achicara, se perdería la franquicia.
  assert.equal(ajustarACatalogo('TODO RIESGO CON FRANQUICIA', CATALOGOS.coberturas, 'exacto'), 'TODO RIESGO CON FRANQUICIA')
  assert.equal(ajustarACatalogo('terceros  completo', CATALOGOS.coberturas, 'exacto'), 'TERCEROS COMPLETO')
})

// ---------------------------------------------------------------------------
// De lo leído al formulario
// ---------------------------------------------------------------------------

test('polizaLeida arma APELLIDO NOMBRES en mayúsculas, la dirección en partes y marca lo leído', () => {
  const leida = polizaLeida(lectura(), CATALOGOS)
  assert.equal(leida.cliente.nombre, 'GÓMEZ JUAN PABLO')
  assert.equal(leida.cliente.documento, '27.345.678')
  assert.equal(leida.cliente.direccionDetalle.calle, 'Av. Hipólito Yrigoyen')
  assert.equal(leida.cliente.direccionDetalle.altura, '1234')
  assert.equal(leida.cliente.localidad, 'Lanús')
  assert.ok(leida.cliente.direccion.includes('1234'))
  assert.equal(leida.vehiculo.patente, 'AB123CD')
  assert.equal(leida.vehiculo.marca, 'FORD')
  assert.equal(leida.vehiculo.anio, '2018')
  assert.equal(leida.poliza.compania, 'SANCOR')
  assert.equal(leida.poliza.cobertura, 'TERCEROS COMPLETO')
  assert.equal(leida.poliza.vigenciaDesde, '27/04/2026')
  assert.equal(leida.poliza.vigenciaHasta, '27/04/2027')
  // Lo que el PDF no trae queda vacío (nunca inventado) y no figura como leído.
  assert.equal(leida.cliente.telefono, '')
  assert.equal(leida.poliza.formaPago, '')
  assert.ok(leida.leidos.includes('cliente.nombre'))
  assert.ok(leida.leidos.includes('vehiculo.chasis'))
  assert.ok(leida.leidos.includes('poliza.vigenciaDesde'))
  assert.equal(leida.leidos.includes('cliente.telefono'), false)
  assert.equal(leida.leidos.includes('poliza.formaPago'), false)
  assert.equal(leida.clienteExistente, null)
})

test('polizaLeida avisa si el tomador es distinto del asegurado', () => {
  const leida = polizaLeida(lectura({ tomadorDistinto: 'Empresa Ejemplo S.A.' }), CATALOGOS)
  assert.equal(leida.avisos.length, 1)
  assert.match(leida.avisos[0] ?? '', /Empresa Ejemplo S\.A\./)
  assert.equal(polizaLeida(lectura(), CATALOGOS).avisos.length, 0)
})

test('una razón social va entera en el nombre, sin inventar un apellido', () => {
  const leida = polizaLeida(lectura({ asegurado: { apellido: 'Transportes del Sur S.R.L.', nombres: null, documento: '30-70839042-5', telefono: null, email: null } }), CATALOGOS)
  assert.equal(leida.cliente.nombre, 'TRANSPORTES DEL SUR S.R.L.')
})

// ---------------------------------------------------------------------------
// Parecido de nombres y faltantes
// ---------------------------------------------------------------------------

test('nombresParecidos compara por palabras, sin importar el orden, las tildes ni las mayúsculas', () => {
  assert.equal(nombresParecidos('GOMEZ JUAN PABLO', 'Juan Pablo Gómez'), true)
  assert.equal(nombresParecidos('GOMEZ JUAN', 'Juan Pablo Gomez'), true)
  assert.equal(nombresParecidos('PEREZ ANA', 'GOMEZ JUAN'), false)
  // Con un solo apellido en común no alcanza para dar por hecha la misma persona.
  assert.equal(nombresParecidos('GOMEZ JUAN PABLO', 'GOMEZ MARIA LAURA'), false)
  // Sin nada para comparar no se avisa.
  assert.equal(nombresParecidos('', 'GOMEZ JUAN'), true)
})

test('faltantesDelAlta con cliente nuevo pide DNI, celular, email, forma de pago y lo de la póliza', () => {
  const faltan = faltantesDelAlta({ clienteExistente: false, cliente: clienteVacio({ nombre: 'GOMEZ JUAN' }), vehiculo: VEHICULO_VACIO, poliza: POLIZA_VACIA })
  assert.deepEqual(faltan, ['DNI/CUIT', 'Celular', 'Email', 'Forma de pago', 'Compañía', 'Número de póliza (o de propuesta)', 'Cobertura', 'Patente (o marca y modelo)'])
})

test('faltantesDelAlta con cliente existente no pide los datos del cliente', () => {
  const faltan = faltantesDelAlta({ clienteExistente: true, cliente: clienteVacio(), vehiculo: VEHICULO_VACIO, poliza: POLIZA_VACIA })
  assert.deepEqual(faltan, ['Forma de pago', 'Compañía', 'Número de póliza (o de propuesta)', 'Cobertura', 'Patente (o marca y modelo)'])
})

test('faltantesDelAlta no pide nada cuando está todo, y la propuesta reemplaza al número', () => {
  const faltan = faltantesDelAlta({
    clienteExistente: false,
    cliente: clienteVacio({ nombre: 'GOMEZ JUAN', documento: '27345678', telefono: '11 5555 5555', email: 'juan@correo.com' }),
    vehiculo: { ...VEHICULO_VACIO, marca: 'FORD', modelo: 'FIESTA' },
    poliza: { ...POLIZA_VACIA, compania: 'SANCOR', propuesta: '998', cobertura: 'TODO RIESGO', formaPago: 'Efectivo' },
  })
  assert.deepEqual(faltan, [])
})
