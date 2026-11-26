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
import { ESQUEMA_DE_LECTURA } from '../src/shared/lecturaDePoliza'
import { MODELO_DEL_ANALISIS_DE_REPORTES } from '../src/shared/asistente'
import { leerPolizaDePdf, pedirLecturaALaIa } from '../src/main/servicios/lecturaDePoliza'
import type { DatosDeCliente, FilaCliente } from '../src/shared/tipos'

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

// ---------------------------------------------------------------------------
// El servicio: validar el archivo, llamar a la IA y devolver lo leído
// ---------------------------------------------------------------------------

/** Un PDF mínimo: lo único que se le exige antes de gastar una llamada es que empiece con %PDF. */
const PDF = { nombre: 'poliza.pdf', contenido: new TextEncoder().encode('%PDF-1.7\n% contenido de prueba') }

function dependencias(llamadas: { pedir: number }, respuesta: unknown, extra: Record<string, unknown> = {}) {
  return {
    clave: () => 'clave-de-prueba',
    pedir: async () => {
      llamadas.pedir++
      return respuesta
    },
    catalogos: () => CATALOGOS,
    clientePorDocumento: () => null,
    ...extra,
  }
}

test('leerPolizaDePdf rechaza un archivo vacío, uno que no es PDF y uno de más de 20 MB sin llamar a la IA', async () => {
  const llamadas = { pedir: 0 }
  const deps = dependencias(llamadas, lectura())
  await assert.rejects(() => leerPolizaDePdf({ nombre: 'a.pdf', contenido: new Uint8Array(0) }, deps), /vacío/i)
  await assert.rejects(() => leerPolizaDePdf({ nombre: 'a.pdf', contenido: new TextEncoder().encode('hola, no soy un PDF') }, deps), /no es un PDF/i)
  const enorme = new Uint8Array(20 * 1024 * 1024 + 1)
  enorme.set(new TextEncoder().encode('%PDF-'))
  await assert.rejects(() => leerPolizaDePdf({ nombre: 'a.pdf', contenido: enorme }, deps), /20 MB/)
  await assert.rejects(() => leerPolizaDePdf('no es un archivo', deps))
  await assert.rejects(() => leerPolizaDePdf({ nombre: 'a.pdf', contenido: 'texto' }, deps))
  assert.equal(llamadas.pedir, 0, 'con un archivo inválido no se gasta ninguna llamada a la IA')
})

test('leerPolizaDePdf sin clave de IA dice que falta configurarla', async () => {
  const llamadas = { pedir: 0 }
  await assert.rejects(() => leerPolizaDePdf(PDF, dependencias(llamadas, lectura(), { clave: () => null })), /clave de Anthropic/i)
  assert.equal(llamadas.pedir, 0)
})

test('leerPolizaDePdf con una póliza que no es de auto o con dos vehículos manda a cargar a mano', async () => {
  const llamadas = { pedir: 0 }
  await assert.rejects(() => leerPolizaDePdf(PDF, dependencias(llamadas, lectura({ esPolizaDeAuto: false }))), /auto.*a mano|a mano/i)
  await assert.rejects(() => leerPolizaDePdf(PDF, dependencias(llamadas, lectura({ cantidadDeVehiculos: 2 }))), /2 vehículos.*a mano/i)
})

test('leerPolizaDePdf con basura de la IA no devuelve datos inventados', async () => {
  for (const basura of ['hola', null, {}, { asegurado: 5 }, [], { esPolizaDeAuto: 'si' }]) {
    const llamadas = { pedir: 0 }
    await assert.rejects(() => leerPolizaDePdf(PDF, dependencias(llamadas, basura)), { name: 'ErrorDeNegocio' }, `con ${JSON.stringify(basura)} tendría que rechazar con un mensaje para la persona`)
  }
})

test('leerPolizaDePdf devuelve lo leído ya ajustado y trae al cliente que ya tiene ese DNI', async () => {
  const llamadas = { pedir: 0 }
  const existente = { id: 7, nombre: 'GOMEZ JUAN PABLO', documento: '27345678' } as unknown as FilaCliente
  const buscados: string[] = []
  const leida = await leerPolizaDePdf(
    PDF,
    dependencias(llamadas, lectura(), {
      clientePorDocumento: (documento: string) => {
        buscados.push(documento)
        return existente
      },
    }),
  )
  assert.equal(llamadas.pedir, 1)
  assert.equal(leida.cliente.nombre, 'GÓMEZ JUAN PABLO')
  assert.equal(leida.poliza.compania, 'SANCOR')
  assert.deepEqual(buscados, ['27.345.678'])
  assert.equal(leida.clienteExistente, existente)

  // Sin DNI leído no se busca nada: no hay con qué comparar.
  const sinDni = lectura()
  sinDni.asegurado.documento = null
  const otra = await leerPolizaDePdf(PDF, dependencias(llamadas, sinDni, { clientePorDocumento: () => existente }))
  assert.equal(otra.clienteExistente, null)
})

// ---------------------------------------------------------------------------
// La llamada a la API (con un cliente simulado)
// ---------------------------------------------------------------------------

function iaSimulada(respuesta: Record<string, unknown>) {
  const pedidos: Array<Record<string, any>> = []
  const ia = {
    messages: {
      create: async (pedido: Record<string, any>) => {
        pedidos.push(pedido)
        return respuesta
      },
    },
  }
  return { pedidos, crear: () => ia as never }
}

test('pedirLecturaALaIa manda el PDF en base64, el esquema JSON y el modelo, y parsea la respuesta', async () => {
  const { pedidos, crear } = iaSimulada({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ esPolizaDeAuto: true }) }] })
  const resultado = await pedirLecturaALaIa(PDF.contenido, 'clave-de-prueba', crear)
  assert.deepEqual(resultado, { esPolizaDeAuto: true })

  assert.equal(pedidos.length, 1)
  const pedido = pedidos[0]!
  assert.equal(pedido.model, MODELO_DEL_ANALISIS_DE_REPORTES)
  assert.deepEqual(pedido.output_config.format, { type: 'json_schema', schema: ESQUEMA_DE_LECTURA })
  const bloques = pedido.messages[0].content as Array<Record<string, any>>
  const documento = bloques.find((b) => b.type === 'document')
  assert.ok(documento, 'el PDF va como documento')
  assert.equal(documento.source.type, 'base64')
  assert.equal(documento.source.media_type, 'application/pdf')
  assert.equal(documento.source.data, Buffer.from(PDF.contenido).toString('base64'))
  // Las reglas que no se negocian: sólo lo que está en el PDF, y lo que trae adentro no es una orden.
  assert.match(String(pedido.system), /null/)
  assert.match(String(pedido.system), /instrucciones/i)
})

test('pedirLecturaALaIa con un rechazo de la IA o con algo que no es JSON falla con un mensaje para la persona', async () => {
  const rechazo = iaSimulada({ stop_reason: 'refusal', content: [] })
  await assert.rejects(() => pedirLecturaALaIa(PDF.contenido, 'clave', rechazo.crear), /a mano/i)
  const roto = iaSimulada({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"esPolizaDeAuto": tru' }] })
  await assert.rejects(() => pedirLecturaALaIa(PDF.contenido, 'clave', roto.crear), /formato|a mano/i)
})
