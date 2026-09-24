// El multicotizador: las reglas que no dependen de ninguna compañía.
//
// Lo que se prueba acá es lo que hace que una comparación entre compañías sea justa y que una compañía
// no arrastre a las demás: en qué categoría cae cada cobertura (si no, «la más barata» compara peras
// con manzanas), cómo se traduce lo que dice la agencia a las listas de cada compañía (una versión mal
// elegida es cotizar otro vehículo), qué se olvida al cambiar un ajuste, y que una compañía caída
// vuelva como una tarjeta con error en vez de tirar. Galeno en sí no se prueba acá: habla con la red.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { CotizadorDeAseguradora } from '../src/main/multicotizador/aseguradora'
import {
  buscarLocalidad,
  buscarMarca,
  CLAVES_MEDIO_DE_PAGO,
  codigoPostalDeCuatro,
  porPalabrasClave,
  rankear,
  similitud,
  sinDudas,
} from '../src/main/multicotizador/equivalencias'
import { usarAseguradorasDePrueba } from '../src/main/multicotizador/registro'
import {
  aseguradorasDelMulticotizador,
  cotizarEnAseguradora,
  localidadesDelMulticotizador,
  validarSolicitud,
} from '../src/main/servicios/multicotizador'
import {
  categoriaDeCobertura,
  coberturasOrdenadas,
  elegirAjuste,
  mejoresPorCategoria,
  type AjusteDeAseguradora,
  type CoberturaCotizada,
  type ResultadoDeAseguradora,
  type SolicitudDeCotizacion,
} from '../src/shared/multicotizador'

function solicitud(cambios: Partial<SolicitudDeCotizacion> = {}): SolicitudDeCotizacion {
  return {
    vehiculo: {
      tipo: 'AUTO',
      marca: 'Toyota',
      modelo: 'Corolla',
      version: '1.8 XEI CVT',
      anio: '2020',
      // Vacío a propósito: con código, el servicio consulta el catálogo de la base.
      codigoCatalogo: '',
      ceroKm: false,
      uso: 'PARTICULAR',
      gnc: false,
      valorGnc: null,
      rastreo: false,
      sumaAsegurada: null,
    },
    tomador: { nombre: '', documento: '', telefono: '', tipoPersona: 'FISICA', condicionIva: 'CONSUMIDOR_FINAL' },
    codigoPostal: '1870',
    localidad: 'Avellaneda',
    vigenciaDesde: '2026-10-01',
    medioDePago: 'TARJETA',
    ...cambios,
  }
}

function cobertura(aseguradora: string, codigo: string, nombre: string, premio: number): CoberturaCotizada {
  return {
    aseguradora,
    nombreAseguradora: aseguradora,
    codigo,
    nombre,
    categoria: categoriaDeCobertura(nombre, codigo),
    premio,
    prima: premio * 0.8,
    primeraCuota: null,
    cuota: null,
    franquicia: '',
    adicionales: [],
    comision: premio * 0.1,
    emision: null,
  }
}

function resultado(aseguradora: string, coberturas: CoberturaCotizada[]): ResultadoDeAseguradora {
  return { aseguradora, nombre: aseguradora, estado: 'OK', mensaje: null, descripcionVehiculo: '', coberturas, avisos: [], ajustes: [], duracionMs: 0 }
}

// --- Categorías y comparación -------------------------------------------------------------------------

test('multicotizador: cada compañía nombra distinto la misma cobertura y cae en la misma categoría', () => {
  assert.equal(categoriaDeCobertura('Responsabilidad Civil'), 'RC')
  assert.equal(categoriaDeCobertura('RESP. CIVIL hacia terceros'), 'RC')
  assert.equal(categoriaDeCobertura('Terceros con Pérdida Total'), 'TERCEROS_BASICO')
  assert.equal(categoriaDeCobertura('Robo e Incendio Total'), 'TERCEROS_BASICO')
  assert.equal(categoriaDeCobertura('Terceros Completo'), 'TERCEROS_COMPLETO')
  assert.equal(categoriaDeCobertura('Terc. Compl. c/ cristales y cerraduras'), 'TERCEROS_COMPLETO')
  assert.equal(categoriaDeCobertura('Terceros Completo Plus c/Granizo'), 'TERCEROS_PREMIUM')
  assert.equal(categoriaDeCobertura('Todo Riesgo c/Franq. $150.000'), 'TODO_RIESGO')
  assert.equal(categoriaDeCobertura('Daños parciales por accidente'), 'TODO_RIESGO')
})

test('multicotizador: si el nombre no dice nada, manda la letra del código', () => {
  assert.equal(categoriaDeCobertura('Plan A', 'A'), 'RC')
  assert.equal(categoriaDeCobertura('Plan B1', 'B1'), 'TERCEROS_BASICO')
  assert.equal(categoriaDeCobertura('Plan C', 'C'), 'TERCEROS_COMPLETO')
  assert.equal(categoriaDeCobertura('Plan C Gold', 'C3'), 'TERCEROS_PREMIUM')
  assert.equal(categoriaDeCobertura('Plan D', 'D2'), 'TODO_RIESGO')
  assert.equal(categoriaDeCobertura('Plan especial', 'Z'), 'OTRA')
})

test('multicotizador: el comparativo ordena por categoría y precio, y la más barata sale de cualquier compañía', () => {
  const resultados = [
    resultado('GALENO', [cobertura('GALENO', 'C', 'Terceros Completo', 90_000), cobertura('GALENO', 'A', 'Responsabilidad Civil', 30_000)]),
    resultado('OTRA', [
      cobertura('OTRA', 'C1', 'Terceros Completo', 80_000),
      cobertura('OTRA', 'C2', 'Terceros Completo', 0),
      cobertura('OTRA', 'D', 'Todo Riesgo', 200_000),
    ]),
  ]
  const orden = coberturasOrdenadas(resultados).map((c) => `${c.aseguradora}:${c.codigo}`)
  // RC primero; dentro de terceros completo, la más barata primero y la que vino sin precio al final.
  assert.deepEqual(orden, ['GALENO:A', 'OTRA:C1', 'GALENO:C', 'OTRA:C2', 'OTRA:D'])

  const mejores = mejoresPorCategoria(resultados)
  assert.equal(mejores.get('TERCEROS_COMPLETO')?.aseguradora, 'OTRA')
  assert.equal(mejores.get('TERCEROS_COMPLETO')?.codigo, 'C1')
  assert.equal(mejores.get('RC')?.aseguradora, 'GALENO')
  assert.equal(mejores.has('TERCEROS_BASICO'), false)
})

test('multicotizador: cambiar un ajuste olvida lo elegido a mano en todo lo que dependía de él', () => {
  const ajustes: AjusteDeAseguradora[] = [
    { campo: 'marca', titulo: 'Marca', opciones: [], valor: '1', obligatorio: true },
    { campo: 'modelo', titulo: 'Modelo', opciones: [], valor: '2', obligatorio: true, dependeDe: 'marca' },
    { campo: 'version', titulo: 'Versión', opciones: [], valor: '3', obligatorio: true, dependeDe: 'modelo' },
    { campo: 'plan', titulo: 'Plan', opciones: [], valor: '9', obligatorio: true },
  ]
  const antes = { marca: '1', modelo: '2', version: '3', plan: '9' }
  assert.deepEqual(elegirAjuste(antes, ajustes, 'marca', '5'), { marca: '5', plan: '9' })
  assert.deepEqual(elegirAjuste(antes, ajustes, 'version', '4'), { marca: '1', modelo: '2', version: '4', plan: '9' })
})

// --- Equivalencias ------------------------------------------------------------------------------------

test('multicotizador: las versiones se comparan por palabras, sin importar el orden ni las abreviaturas', () => {
  assert.equal(similitud('COROLLA 1.8 XEI', 'XEI 1,8 COROLLA'), 1)
  assert.ok(similitud('AMAROK 2.0 TDI TRENDLINE', 'AMAROK 2.0 TDI TRENDL') === 1)
  assert.ok(similitud('COROLLA 1.8 XEI', 'COROLLA 2.0 SEG') < 0.5)
  // «1.8» es una palabra: no puede coincidir con el «1» o el «8» sueltos de otra versión.
  assert.ok(similitud('GOL 1.6', 'GOL 1 6V') < 1)

  const versiones = ['COROLLA 1.8 XEI CVT', 'COROLLA 1.8 XEI MT', 'COROLLA 2.0 SEG CVT']
  assert.equal(sinDudas(rankear('1.8 XEI CVT', versiones, (v) => v)), 'COROLLA 1.8 XEI CVT')
  // Dos versiones igual de parecidas: ante la duda, pregunta.
  assert.equal(sinDudas(rankear('COROLLA 1.8 XEI', versiones, (v) => v)), null)
})

test('multicotizador: las marcas se encuentran con los alias de siempre', () => {
  const marcas = [
    { codigo: '10', descripcion: 'VOLKSWAGEN' },
    { codigo: '11', descripcion: 'CHEVROLET' },
    { codigo: '12', descripcion: 'MERCEDES BENZ' },
    { codigo: '13', descripcion: 'TOYOTA' },
  ]
  assert.equal(buscarMarca('VW', marcas)?.codigo, '10')
  assert.equal(buscarMarca('Volkswagen', marcas)?.codigo, '10')
  assert.equal(buscarMarca('Mercedes-Benz', marcas)?.codigo, '12')
  assert.equal(buscarMarca('Toyota', marcas)?.codigo, '13')
  assert.equal(buscarMarca('Ferrari', marcas), null)
})

test('multicotizador: las listas cortas de cada compañía se eligen por palabras clave', () => {
  const formas = [
    { codigo: '1', descripcion: 'Cupón de pago (Pago Fácil / Rapipago)' },
    { codigo: '2', descripcion: 'Tarjeta de Crédito VISA' },
    { codigo: '3', descripcion: 'Débito automático en cuenta bancaria (CBU)' },
  ]
  assert.equal(porPalabrasClave(formas, CLAVES_MEDIO_DE_PAGO.TARJETA)?.codigo, '2')
  assert.equal(porPalabrasClave(formas, CLAVES_MEDIO_DE_PAGO.DEBITO)?.codigo, '3')
  assert.equal(porPalabrasClave(formas, CLAVES_MEDIO_DE_PAGO.EFECTIVO)?.codigo, '1')
  assert.equal(porPalabrasClave(formas, ['TRANSFERENCIA']), null)
})

test('multicotizador: la localidad se elige sola sólo cuando no hay dudas', () => {
  const nombre = (l: string) => l
  assert.equal(buscarLocalidad('lo que sea', ['AVELLANEDA'], nombre), 'AVELLANEDA')
  assert.equal(buscarLocalidad('Villa Domínico', ['AVELLANEDA', 'VILLA DOMINICO', 'SARANDI'], nombre), 'VILLA DOMINICO')
  assert.equal(buscarLocalidad('', ['AVELLANEDA', 'SARANDI'], nombre), null)
  assert.equal(buscarLocalidad('Wilde', ['AVELLANEDA', 'SARANDI'], nombre), null)
  assert.equal(codigoPostalDeCuatro('B1870ABC'), '1870')
  assert.equal(codigoPostalDeCuatro('CP 1870'), '1870')
})

// --- La solicitud -------------------------------------------------------------------------------------

test('multicotizador: la solicitud se valida antes de salir a ninguna compañía', () => {
  const buena = validarSolicitud({ ...solicitud(), codigoPostal: 'B1870ABC' })
  assert.equal(buena.codigoPostal, '1870')
  assert.equal(buena.vehiculo.valorGnc, null)

  const conGnc = validarSolicitud({ ...solicitud(), vehiculo: { ...solicitud().vehiculo, gnc: true, valorGnc: 850_000.4 } })
  assert.equal(conGnc.vehiculo.valorGnc, 850_000)

  assert.throws(() => validarSolicitud({ ...solicitud(), codigoPostal: '18' }), /cuatro números/)
  assert.throws(() => validarSolicitud({ ...solicitud(), vigenciaDesde: '01/10/2026' }), /vigencia/)
  assert.throws(() => validarSolicitud({ ...solicitud(), medioDePago: 'BITCOIN' }), /medio de pago/)
  assert.throws(() => validarSolicitud({ ...solicitud(), vehiculo: { ...solicitud().vehiculo, anio: '1900' } }), /año/)
  assert.throws(() => validarSolicitud({ ...solicitud(), vehiculo: { ...solicitud().vehiculo, marca: '' } }), /marca/)
  assert.throws(
    () => validarSolicitud({ ...solicitud(), vehiculo: { ...solicitud().vehiculo, sumaAsegurada: -5 } }),
    /suma asegurada/,
  )
})

// --- Cotizar con compañías de mentira -----------------------------------------------------------------

function aseguradoraDePrueba(cambios: Partial<CotizadorDeAseguradora>): CotizadorDeAseguradora {
  return {
    id: 'PRUEBA',
    nombre: 'Prueba',
    tipos: ['AUTO'],
    emite: false,
    noDisponible: () => null,
    async cotizar() {
      return {
        estado: 'OK',
        mensaje: null,
        descripcionVehiculo: 'TOYOTA COROLLA 1.8 XEI CVT',
        coberturas: [cobertura('PRUEBA', 'C', 'Terceros Completo', 100_000)],
        avisos: [],
        ajustes: [],
      }
    },
    ...cambios,
  }
}

test('multicotizador: cada compañía contesta por su cuenta; una caída vuelve como error, no tira', async (t) => {
  t.after(() => usarAseguradorasDePrueba(null))
  usarAseguradorasDePrueba([
    aseguradoraDePrueba({ id: 'ANDA', nombre: 'Anda' }),
    aseguradoraDePrueba({
      id: 'CAIDA',
      nombre: 'Caída',
      async cotizar() {
        throw new Error('503 Service Unavailable')
      },
    }),
    aseguradoraDePrueba({ id: 'SIN_CLAVE', nombre: 'Sin clave', noDisponible: () => 'Faltan las credenciales.' }),
    aseguradoraDePrueba({ id: 'SOLO_AUTOS', nombre: 'Sólo autos' }),
  ])

  assert.deepEqual(
    aseguradorasDelMulticotizador().map((a) => [a.id, a.noDisponible]),
    [
      ['ANDA', null],
      ['CAIDA', null],
      ['SIN_CLAVE', 'Faltan las credenciales.'],
      ['SOLO_AUTOS', null],
    ],
  )

  const anda = await cotizarEnAseguradora({ aseguradora: 'ANDA', solicitud: solicitud(), elegidos: {} }, true)
  assert.equal(anda.estado, 'OK')
  assert.equal(anda.nombre, 'Anda')
  assert.equal(anda.coberturas[0]?.comision, 10_000)

  const caida = await cotizarEnAseguradora({ aseguradora: 'CAIDA', solicitud: solicitud(), elegidos: {} }, true)
  assert.equal(caida.estado, 'ERROR')
  assert.match(caida.mensaje ?? '', /503/)
  assert.deepEqual(caida.coberturas, [])

  const sinClave = await cotizarEnAseguradora({ aseguradora: 'SIN_CLAVE', solicitud: solicitud(), elegidos: {} }, true)
  assert.equal(sinClave.estado, 'NO_APLICA')
  assert.equal(sinClave.mensaje, 'Faltan las credenciales.')

  const moto = solicitud({ vehiculo: { ...solicitud().vehiculo, tipo: 'MOTO' } })
  const soloAutos = await cotizarEnAseguradora({ aseguradora: 'SOLO_AUTOS', solicitud: moto, elegidos: {} }, true)
  assert.equal(soloAutos.estado, 'NO_APLICA')
  assert.match(soloAutos.mensaje ?? '', /motos/)

  // Una solicitud mal armada sí tira: es un error de la pantalla, no de la compañía.
  await assert.rejects(cotizarEnAseguradora({ aseguradora: 'ANDA', solicitud: { ...solicitud(), codigoPostal: '' }, elegidos: {} }, true))
  await assert.rejects(cotizarEnAseguradora({ aseguradora: 'NO_EXISTE', solicitud: solicitud(), elegidos: {} }, true), /no está/)
})

test('multicotizador: la comisión no viaja a quien no ve los números de la agencia', async (t) => {
  t.after(() => usarAseguradorasDePrueba(null))
  let recibidos: Record<string, string> = {}
  usarAseguradorasDePrueba([
    aseguradoraDePrueba({
      async cotizar(_solicitud, elegidos) {
        recibidos = elegidos
        const conEmision = cobertura('PRUEBA', 'C', 'Terceros Completo', 100_000)
        return {
          estado: 'OK',
          mensaje: null,
          descripcionVehiculo: '',
          coberturas: [
            {
              ...conEmision,
              emision: {
                tipo: 'GALENO',
                rama: 4,
                solicitud: 123,
                instalacion: 1,
                codigoPostal: '1870',
                subCodigoPostal: '0',
                cobertura: { comision: 7_500 } as never,
              },
            },
          ],
          avisos: [],
          ajustes: [],
        }
      },
    }),
  ])

  const pedido = { aseguradora: 'PRUEBA', solicitud: solicitud(), elegidos: { planComercial: ' 12 ', vacio: '  ', numero: 5 } }
  const sinNumeros = await cotizarEnAseguradora(pedido, false)
  assert.equal(sinNumeros.coberturas[0]?.comision, null)
  assert.equal((sinNumeros.coberturas[0]?.emision?.cobertura as { comision: number }).comision, 0)
  // Lo elegido a mano llega limpio: sin espacios, sin vacíos y sin lo que no es texto.
  assert.deepEqual(recibidos, { planComercial: '12' })

  const conNumeros = await cotizarEnAseguradora(pedido, true)
  assert.equal(conNumeros.coberturas[0]?.comision, 10_000)
  assert.equal((conNumeros.coberturas[0]?.emision?.cobertura as { comision: number }).comision, 7_500)
})

test('multicotizador: las localidades de todas las compañías se juntan sin repetir', async (t) => {
  t.after(() => usarAseguradorasDePrueba(null))
  usarAseguradorasDePrueba([
    aseguradoraDePrueba({ id: 'UNA', localidades: async () => ['Avellaneda', 'Sarandí'] }),
    aseguradoraDePrueba({ id: 'OTRA', localidades: async () => ['AVELLANEDA', 'Villa Domínico'] }),
    aseguradoraDePrueba({
      id: 'CAIDA',
      localidades: async () => {
        throw new Error('sin conexión')
      },
    }),
  ])
  assert.deepEqual(await localidadesDelMulticotizador('AUTO', '1870'), ['Avellaneda', 'Sarandí', 'Villa Domínico'])
  assert.deepEqual(await localidadesDelMulticotizador('AUTO', '18'), [])
})
