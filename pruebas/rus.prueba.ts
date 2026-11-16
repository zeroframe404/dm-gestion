// Río Uruguay Seguros (RUS): el cliente de su API v2 (token y API-Key), sus listas, la cotización y su
// adaptador del multicotizador.
//
// Nada de esto sale a internet: la API se contesta reemplazando `fetch`. Las formas salen de los ejemplos
// de la documentación de Postman de RUS («API-RUS V2»): el token por `login/token`, el catálogo por
// `vehiculo/*`, las vigencias por `comunes/vigencias` (envueltas en `object`) y la cotización por
// `cotizaciones/automotores` y `cotizaciones/motos`. Lo que más importa: que la API-Key vaya en cada
// pedido y el token se reuse, que un rechazo diga qué revisar, que la cotización mande el vehículo que
// se eligió con la forma del ejemplo de RUS, y que ni la contraseña ni la API-Key se filtren.
import assert from 'node:assert/strict'
import test from 'node:test'
import { leerOpciones, listaDe, sinEnvoltorio } from '../src/main/aseguradoras/rus/catalogos'
import { crearClienteRus, ENCABEZADO_API_KEY, ErrorDeRus, erroresDeRus, leerToken, olvidarTokensDeRus, RUTA_TOKEN } from '../src/main/aseguradoras/rus/cliente'
import { armarPedidoDeCotizacion, categoriaRus, leerCoberturas, leerRespuestaDeCotizacion, sinHtml, sumarMeses } from '../src/main/aseguradoras/rus/cotizacion'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import {
  consejoParaElRechazo,
  cuotasDeLaVigencia,
  cuotasPorDefecto,
  ID_RUS,
  olvidarListasDeRus,
  rus,
  usarCuentaDeRusDePrueba,
  vigenciaPorDefecto,
} from '../src/main/multicotizador/rus'

type Prueba = { after: (fn: () => void) => void }

const CLAVE = 'contr&seña"de"prueba'
const API_KEY = 'k3y-de-prueba-0123456789abcdef'
const CUENTA = { ambiente: 'sandbox' as const, usuario: '20123456789ws', clave: CLAVE, apiKey: API_KEY, productor: '9466', solicitante: '' }
const TOKEN = { access_token: 'tok-rus-1', expires_in: 3599, refresh_expires_in: 1800, refresh_token: 'refresco' }
const BASE = 'https://api.rus.com.ar/sandbox'

interface PedidoHttp {
  url: string
  ruta: string
  consulta: URLSearchParams
  metodo: string
  headers: Record<string, string>
  cuerpo: string
}

/** Reemplaza `fetch` hasta que termine la prueba; anota cada pedido. La ruta es la de después del ambiente. */
function fetchFalso(t: Prueba, contestar: (pedido: PedidoHttp) => Response): PedidoHttp[] {
  const fetchOriginal = globalThis.fetch
  t.after(() => {
    globalThis.fetch = fetchOriginal
    olvidarTokensDeRus()
    olvidarListasDeRus()
  })
  olvidarTokensDeRus()
  olvidarListasDeRus()
  const pedidos: PedidoHttp[] = []
  globalThis.fetch = (async (url: string | URL | Request, opciones: RequestInit = {}) => {
    const texto = String(url)
    const u = new URL(texto)
    const pedido: PedidoHttp = {
      url: texto,
      ruta: u.pathname.replace(/^\/(sandbox|v2)\//, ''),
      consulta: u.searchParams,
      metodo: opciones.method ?? 'GET',
      headers: Object.fromEntries(Object.entries({ ...(opciones.headers as Record<string, string> | undefined) }).map(([k, v]) => [k.toLowerCase(), v])),
      cuerpo: typeof opciones.body === 'string' ? opciones.body : '',
    }
    pedidos.push(pedido)
    return contestar(pedido)
  }) as typeof fetch
  return pedidos
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { 'content-type': 'application/json' } })
}

const NEGADO = { Message: 'User is not authorized to access this resource with an explicit deny' }

// --- El cliente -------------------------------------------------------------------------------------

test('RUS: el token se pide como dice la documentación, con la API-Key, y se reusa', async (t) => {
  const pedidos = fetchFalso(t, (pedido) => {
    if (pedido.ruta === RUTA_TOKEN) return json(TOKEN)
    if (pedido.ruta === 'vehiculo/marcas') return json({ listMarcaVehiculo: [{ id: 21, descripcion: 'FIAT' }] })
    return json({ message: 'Not Found' }, 404)
  })
  const cliente = crearClienteRus(CUENTA)
  await cliente.get<unknown>('vehiculo/marcas', { TipoUnidad: '1' })
  await cliente.get<unknown>('vehiculo/marcas', { TipoUnidad: '2' })

  const token = pedidos[0]!
  assert.equal(token.metodo, 'POST')
  assert.equal(token.url, `${BASE}/${RUTA_TOKEN}`, 'sandbox va a api.rus.com.ar/sandbox')
  assert.equal(token.headers['content-type'], 'application/json')
  assert.equal(token.headers[ENCABEZADO_API_KEY], API_KEY, 'el token también lleva la API-Key')
  assert.deepEqual(JSON.parse(token.cuerpo), { password: CLAVE, username: CUENTA.usuario }, 'la contraseña llega tal cual, con sus signos')

  const get = pedidos[1]!
  assert.equal(get.url, `${BASE}/vehiculo/marcas?TipoUnidad=1`)
  assert.equal(get.headers.authorization, 'Bearer tok-rus-1')
  assert.equal(get.headers[ENCABEZADO_API_KEY], API_KEY)
  assert.equal(pedidos.filter((p) => p.ruta === RUTA_TOKEN).length, 1, 'el segundo GET usa el mismo token')
  assert.ok(!pedidos.some((p) => p.url.includes(API_KEY)), 'la API-Key va en el encabezado, nunca en la URL')
})

test('RUS: en producción se habla con api.rus.com.ar/v2', async (t) => {
  const pedidos = fetchFalso(t, () => json(TOKEN))
  await crearClienteRus({ ...CUENTA, ambiente: 'produccion' }).token()
  assert.equal(pedidos[0]!.url, `https://api.rus.com.ar/v2/${RUTA_TOKEN}`)
})

test('RUS: un «Forbidden» al pedir el token es la API-Key; un 401 es el usuario o la contraseña', async (t) => {
  let respuesta = json({ message: 'Forbidden' }, 403)
  fetchFalso(t, () => respuesta)
  await assert.rejects(crearClienteRus(CUENTA).token(), (error: unknown) => {
    assert.ok(error instanceof ErrorDeRus)
    assert.match(error.message, /API-Key/)
    assert.equal(error.status, 403)
    return true
  })
  respuesta = json({ error: 'invalid_grant', error_description: 'Invalid user credentials' }, 401)
  await assert.rejects(crearClienteRus(CUENTA).token(), /no aceptó el usuario o la contraseña \(Invalid user credentials\)/)
})

test('RUS: con el token vencido (403 «explicit deny») se pide otro y se reintenta una vez', async (t) => {
  let tokens = 0
  let marcas = 0
  const pedidos = fetchFalso(t, (pedido) => {
    if (pedido.ruta === RUTA_TOKEN) return json({ ...TOKEN, access_token: `tok-${++tokens}` })
    marcas++
    return marcas === 1 ? json(NEGADO, 403) : json({ listMarcaVehiculo: [] })
  })
  const respuesta = await crearClienteRus(CUENTA).get<unknown>('vehiculo/marcas')
  assert.deepEqual(respuesta, { listMarcaVehiculo: [] })
  assert.equal(tokens, 2)
  assert.equal(pedidos.at(-1)!.headers.authorization, 'Bearer tok-2')
})

test('RUS: el token dura lo que dice, con un margen para no vencer a mitad de un pedido', () => {
  const ahora = 1_000_000
  const token = leerToken(TOKEN, ahora)
  assert.equal(token.token, 'tok-rus-1')
  assert.equal(token.venceSegunRus, ahora + 3599 * 1000)
  assert.ok(token.venceEn < token.venceSegunRus! && token.venceEn > ahora)
  assert.throws(() => leerToken({ expires_in: 10 }), /sin un token/)
})

test('RUS: sin internet se dice que es la red', async (t) => {
  fetchFalso(t, () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.rus.com.ar'), { code: 'ENOTFOUND' }) })
  })
  await assert.rejects(crearClienteRus(CUENTA).token(), (error: unknown) => error instanceof ErrorDeRus && error.esDeRed && /internet/.test(error.message))
})

test('RUS: los errores se leen en sus dos formas, con la descripción que se entiende', () => {
  assert.deepEqual(
    erroresDeRus({
      errors: [
        { message: 'WebService.cotizacion.fechaInicioNoValida', code: 'ERROR_INTERNO_DEL_SERVIDOR', description: 'Fecha de inicio de vigencia no valida' },
        { message: '#/vehiculos/0/cpLocalidadGuarda', code: 'ERROR_DE_VALIDACION', description: '#/vehiculos/0/cpLocalidadGuarda: expected type: Integer, found: String' },
      ],
      status: 400,
    }),
    ['Fecha de inicio de vigencia no valida', '#/vehiculos/0/cpLocalidadGuarda: expected type: Integer, found: String'],
  )
  assert.deepEqual(erroresDeRus({ errores: { listError: [{ atributo: 'vehiculo', descripcion: 'No se encontro el vehiculo' }], empty: false } }), ['No se encontro el vehiculo'], 'el atributo no se repite si ya está en el texto')
  assert.deepEqual(erroresDeRus({ errores: { listError: [{ atributo: 'patente', descripcion: 'Formato inválido' }] } }), ['patente: Formato inválido'])
  assert.deepEqual(erroresDeRus({ cotizaciones: [] }), [])
})

// --- Las listas -------------------------------------------------------------------------------------

test('RUS: las listas se leen sueltas o envueltas en `object`, y un error del catálogo dice el motivo', () => {
  const vigencias = { object: { listVigencia: [{ id: 3, descripcion: 'TRIMESTRAL', cantidadMeses: 3 }] }, exceptionResponse: false }
  assert.deepEqual(listaDe(vigencias, 'listVigencia'), [{ id: 3, descripcion: 'TRIMESTRAL', cantidadMeses: 3 }])
  assert.deepEqual(sinEnvoltorio({ listUso: [] }), { listUso: [] })
  assert.deepEqual(leerOpciones({ listMarcaVehiculo: [{ id: 5, descripcion: 'AUDI' }, { descripcion: 'sin id' }] }, 'listMarcaVehiculo', 'las marcas'), [{ codigo: '5', descripcion: 'AUDI' }])
  assert.throws(() => leerOpciones({ errores: { listError: [{ atributo: 'vehiculo', descripcion: 'No se encontro el vehiculo' }] } }, 'listUso', 'las versiones'), /No se encontro el vehiculo/)
  assert.throws(() => leerOpciones({ raro: 1, otro: 'x' }, 'listUso', 'las versiones'), /formato inesperado/)
})

// --- La cotización ----------------------------------------------------------------------------------

/** Filas como las del ejemplo de respuesta de RUS (recortadas). */
const COTIZACIONES = [
  { descripcionComercial: 'T34 2% de la SA (T34)', codigoRC: 'RCA', codigoCasco: 'T34', prima: 333662, premio: 695964, cuotas: 6, valorCuota: 115994, franquicia: 447780, sumaAsegurada: '22389000.0', auxilioMecanico: 'SI', paisesLimitrofes: 'SI', coberturaVida: 'SI', ajustesAutomaticosPosibles: ['20,00', '40,00', '30,00'] },
  { descripcionComercial: 'Tercero Completo Full (S)', codigoRC: 'RCA', codigoCasco: 'S', prima: 226995, premio: 479232, cuotas: 6, valorCuota: 79872, franquicia: 0, sumaAsegurada: '22389000.0' },
  { descripcionComercial: 'C2-80 (C2-80)', codigoRC: 'RCA', codigoCasco: 'C2-80', prima: 205987, premio: 434880, cuotas: 6, valorCuota: 72480, franquicia: 0, sumaAsegurada: '22389000.0' },
  { descripcionComercial: 'Daños Totales (B-80)', codigoRC: 'RCA', codigoCasco: 'B-80', prima: 183138, premio: 386640, cuotas: 6, valorCuota: 64440, franquicia: 0, sumaAsegurada: '22389000.0' },
  { descripcionComercial: null, codigoRC: 'RCA', codigoCasco: null, prima: 123592, premio: 260928, cuotas: 6, valorCuota: 43488, franquicia: 0, sumaAsegurada: null },
  { descripcionComercial: null, codigoRC: 'RCA C/GRUA', codigoCasco: null, prima: 99015, premio: 209040, cuotas: 6, valorCuota: 34840, franquicia: 0, sumaAsegurada: null },
]

test('RUS: las coberturas se leen de `cotizaciones`, con su categoría por el código de casco', () => {
  const coberturas = leerCoberturas({ cotizaciones: COTIZACIONES })
  assert.deepEqual(
    coberturas.map((c) => [c.codigo, c.categoria, c.premio, c.cuota]),
    [
      ['RCA|T34', 'TODO_RIESGO', 695964, 115994],
      ['RCA|S', 'TERCEROS_PREMIUM', 479232, 79872],
      ['RCA|C2-80', 'TERCEROS_COMPLETO', 434880, 72480],
      ['RCA|B-80', 'TERCEROS_BASICO', 386640, 64440],
      ['RCA', 'RC', 260928, 43488],
      ['RCA C/GRUA', 'RC', 209040, 34840],
    ],
  )
  const [t34] = coberturas
  assert.equal(t34!.descripcion, 'T34 2% de la SA (T34)')
  assert.equal(t34!.sumaAsegurada, 22389000)
  assert.match(t34!.franquicia, /447\.780/)
  assert.deepEqual(t34!.adicionales, ['Auxilio mecánico', 'Países limítrofes', 'Cobertura de vida'])
  assert.deepEqual(t34!.ajustesPosibles, ['20', '40', '30'])
  assert.equal(coberturas[4]!.descripcion, 'Responsabilidad civil (RCA)')
  assert.equal(coberturas[5]!.descripcion, 'Responsabilidad civil con grúa (RCA C/GRUA)')
  assert.equal(categoriaRus('B-80 MOTO AG', 'B-80 Moto'), 'TERCEROS_BASICO', 'las de motos también')
  assert.equal(categoriaRus('B2', 'B2 (B2)'), 'TERCEROS_BASICO')
  assert.equal(sinHtml('<p>\n\tP&eacute;rd. Total por Da&ntilde;os</p>'), 'Pérd. Total por Daños')
})

test('RUS: un 400 con `errors` es un rechazo con sus motivos, no un error del programa', () => {
  const r = leerRespuestaDeCotizacion(400, { errors: [{ message: 'x', code: 'ERROR_INTERNO_DEL_SERVIDOR', description: 'Fecha de inicio de vigencia no valida' }] }, '')
  assert.equal(r.ok, false)
  assert.deepEqual(r.mensajes, ['Fecha de inicio de vigencia no valida'])
  assert.equal(leerRespuestaDeCotizacion(200, { cotizaciones: [] }, '').ok, false)
})

test('RUS: el pedido tiene la forma del ejemplo «Cotización» de la documentación', () => {
  const pedido = armarPedidoDeCotizacion({
    tipo: 'AUTO',
    productor: '9466',
    solicitante: '',
    condicionFiscal: 'CF',
    vigenciaDesde: '2026-02-24',
    vigenciaHasta: '2026-08-24',
    vigenciaId: '1',
    cuotas: 6,
    ajusteAutomatico: 20,
    paisesLimitrofes: false,
    anio: '2019',
    gnc: false,
    codigoPostal: '3260',
    modeloVehiculo: '92102',
    uso: 'PARTICULAR',
    numeroSolicitud: 1,
  })
  assert.deepEqual(pedido, {
    codigoSolicitante: 9466,
    codigoProductor: 9466,
    numeroSolicitud: 1,
    codigoRamoPoliza: 4,
    codigoTipoInteres: 'VEHICULO',
    condicionFiscal: 'CF',
    vigencia: { desde: '2026-02-24', hasta: '2026-08-24' },
    cuotas: 6,
    ajusteAutomatico: 20,
    vehiculos: [{ anio: '2019', gnc: 'NO', cpLocalidadGuarda: 3260, modeloVehiculo: 92102, uso: 'PARTICULAR' }],
    aumentoRCPaisesLimitrofes: 'NO',
    vigenciaPolizaId: 1,
  })
})

test('RUS: la vigencia termina tantos meses después, aunque el mes sea más corto', () => {
  assert.equal(sumarMeses('2026-02-24', 6), '2026-08-24')
  assert.equal(sumarMeses('2026-08-31', 6), '2027-02-28')
  assert.equal(sumarMeses('2026-11-16', 12), '2027-11-16')
})

test('RUS: la vigencia arranca en la facturación del formulario, o en la que RUS marca por defecto', () => {
  const vigencias = [
    { codigo: '3', descripcion: 'TRIMESTRAL', meses: 3, facturacion: 'TRIMESTRAL', porDefecto: false },
    { codigo: '1', descripcion: 'SEMESTRAL', meses: 6, facturacion: 'SEMESTRAL', porDefecto: true },
    { codigo: '2', descripcion: 'ANUAL', meses: 12, facturacion: 'MENSUAL', porDefecto: false },
  ]
  assert.equal(vigenciaPorDefecto(vigencias, 'TRIMESTRAL')?.codigo, '3')
  assert.equal(vigenciaPorDefecto(vigencias, 'MENSUAL')?.codigo, '2', 'la anual factura mensual')
  assert.equal(vigenciaPorDefecto(vigencias, 'MEJOR_COSTO')?.codigo, '1')
  assert.equal(vigenciaPorDefecto(vigencias, 'CUATRIMESTRAL')?.codigo, '1', 'si RUS no la tiene, la suya por defecto')
  const cuotas = cuotasDeLaVigencia(vigencias[1]!)
  assert.deepEqual(cuotas.map((c) => c.codigo), ['1', '2', '3', '4', '5', '6'])
  assert.equal(cuotasPorDefecto(cuotas, 'MAXIMA'), '6')
  assert.equal(cuotasPorDefecto(cuotas, 3), '3')
  assert.equal(cuotasPorDefecto(cuotas, 12), '6', 'más cuotas que meses: la mayor posible')
  assert.equal(cuotasPorDefecto(cuotas, null), '6')
})

test('RUS: el consejo para un rechazo apunta a lo que hay que revisar', () => {
  assert.match(consejoParaElRechazo('Fecha de inicio de vigencia no valida'), /vigencia/)
  assert.match(consejoParaElRechazo('El productor no pertenece al usuario'), /código de productor/)
  assert.match(consejoParaElRechazo('#/vehiculos/0/cpLocalidadGuarda: expected type'), /código postal/)
  assert.equal(consejoParaElRechazo('algo que no se reconoce'), '')
})

// --- El adaptador -----------------------------------------------------------------------------------

function solicitud(cambios: Partial<SolicitudResuelta['vehiculo']> = {}, resto: Partial<SolicitudResuelta> = {}): SolicitudResuelta {
  return {
    vehiculo: {
      tipo: 'AUTO',
      marca: 'Chevrolet',
      modelo: 'Cruze',
      version: '1.4 4 Ptas LTZ AT',
      anio: '2020',
      codigoCatalogo: 'AUTO:777',
      ceroKm: false,
      uso: 'PARTICULAR',
      gnc: false,
      valorGnc: null,
      rastreador: 'SIN_RASTREADOR',
      scoring: { grua: false, alarma: false, garaje: false },
      accesorios: [],
      sumaAsegurada: null,
      ...cambios,
    },
    tomador: {
      nombre: '',
      apellido: '',
      dni: '',
      cuit: '',
      telefono: '',
      tipoPersona: 'FISICA',
      condicionIva: 'CONSUMIDOR_FINAL',
      ingresosBrutos: 'CONSUMIDOR_FINAL',
      sexo: null,
      fechaNacimiento: '',
    },
    provincia: 'Buenos Aires',
    codigoPostal: 'B1870ABC',
    localidad: 'Avellaneda',
    vigenciaDesde: '2026-11-20',
    medioDePago: 'TARJETA',
    condiciones: { plan: 'SIN_PLAN', tarifa: 'SIN_DESCUENTO', comision: 'ESTANDAR', facturacion: 'MEJOR_COSTO', clausulaAjuste: '30', cuotas: 'MAXIMA' },
    codigoInfoAuto: null,
    ...resto,
  }
}

const VIGENCIAS = {
  object: {
    listVigencia: [
      { id: 3, descripcion: 'TRIMESTRAL', cantidadMeses: 3, descripcionPeriodoFacturacion: 'TRIMESTRAL', porDefecto: false },
      { id: 1, descripcion: 'SEMESTRAL', cantidadMeses: 6, descripcionPeriodoFacturacion: 'SEMESTRAL', porDefecto: true },
    ],
  },
  exceptionResponse: false,
}
const MARCAS = { listMarcaVehiculo: [{ id: 11, descripcion: 'CHEVROLET' }, { id: 56, descripcion: 'TOYOTA' }, { id: 24, descripcion: 'HONDA' }] }
const USOS = { listUso: [{ id: 2, descripcion: 'COMERCIAL' }, { id: 1, descripcion: 'PARTICULAR' }, { id: 3, descripcion: 'TAXI' }] }

interface ApiFalsa {
  pedidos: PedidoHttp[]
  cotizaciones: Array<Record<string, unknown>>
}

/** La API entera, con lo que contesta cada ruta; `cotizar` decide la respuesta al POST. */
function apiFalsa(t: Prueba, cotizar: (cuerpo: Record<string, unknown>) => Response = () => json({ cotizaciones: COTIZACIONES })): ApiFalsa {
  usarCuentaDeRusDePrueba(CUENTA)
  t.after(() => usarCuentaDeRusDePrueba(null))
  const cotizaciones: Array<Record<string, unknown>> = []
  const pedidos = fetchFalso(t, (pedido) => {
    const q = (clave: string) => pedido.consulta.get(clave) ?? ''
    if (pedido.ruta === RUTA_TOKEN) return json(TOKEN)
    if (pedido.ruta === 'comunes/vigencias') return json(VIGENCIAS)
    if (pedido.ruta === 'vehiculo/marcas') return json(MARCAS)
    if (pedido.ruta === 'vehiculo/usos') return json(USOS)
    if (pedido.ruta === 'vehiculo/modelos') {
      if (q('idMarca') === '11' && q('idTipoUnidad') === '1') return json({ listGrupoModelo: [{ id: 3125, descripcion: 'CRUZE' }, { id: 5591, descripcion: 'ONIX' }] })
      if (q('idMarca') === '56' && q('idTipoUnidad') === '2') return json({ listGrupoModelo: [{ id: 4100, descripcion: 'HILUX' }] })
      if (q('idMarca') === '24' && q('idTipoUnidad') === '8') return json({ listGrupoModelo: [{ id: 900, descripcion: 'CB 250 TWISTER' }] })
      return json({ listGrupoModelo: [] })
    }
    if (pedido.ruta === 'vehiculo/versiones') {
      if (q('idGrupoModelo') === '3125')
        return json({
          listUso: [
            { id: 94727, descripcion: 'CRUZE 1.4 4 PTAS LT AT', valor: 27900000, idTipoUnidad: 1 },
            { id: 88229, descripcion: 'CRUZE 1.4 4 PTAS LTZ  AT', valor: 31100000, idTipoUnidad: 1 },
          ],
        })
      if (q('idGrupoModelo') === '4100') return json({ listUso: [{ id: 70001, descripcion: 'HILUX 2.8 TDI DC 4X4 SRX AT', valor: 52000000 }] })
      if (q('idGrupoModelo') === '900') return json({ listUso: [{ id: 60001, descripcion: 'CB 250 TWISTER', valor: 5893500 }] })
      return json({ listUso: [] })
    }
    if (pedido.metodo === 'POST' && /^cotizaciones\//.test(pedido.ruta)) {
      const cuerpo = JSON.parse(pedido.cuerpo) as Record<string, unknown>
      cotizaciones.push(cuerpo)
      return cotizar(cuerpo)
    }
    return json({ message: 'Not Found' }, 404)
  })
  return { pedidos, cotizaciones }
}

test('RUS: cotiza un auto buscando su versión en el catálogo de RUS y manda la forma de su ejemplo', async (t) => {
  const api = apiFalsa(t)
  const resultado = await rus.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'OK', resultado.mensaje ?? '')
  assert.equal(resultado.descripcionVehiculo, 'CHEVROLET CRUZE 1.4 4 PTAS LTZ AT 2020 (modelo 88229 en RUS)')
  assert.equal(resultado.coberturas.length, COTIZACIONES.length)
  assert.ok(resultado.coberturas.every((c) => c.aseguradora === ID_RUS && c.nombreAseguradora === 'Río Uruguay' && c.emision === null), 'RUS no se emite desde la app')
  assert.match(resultado.mensaje ?? '', /vigencia semestral en 6 cuotas, ajuste automático 30 %, productor 9466/)

  const [cuerpo] = api.cotizaciones
  assert.ok(cuerpo)
  assert.equal(api.pedidos.find((p) => p.metodo === 'POST' && p.ruta.startsWith('cotizaciones/'))!.ruta, 'cotizaciones/automotores')
  assert.equal(cuerpo.codigoProductor, 9466)
  assert.equal(cuerpo.codigoSolicitante, 9466, 'sin solicitante, el mismo productor')
  assert.equal(cuerpo.codigoRamoPoliza, 4)
  assert.equal(cuerpo.codigoTipoInteres, 'VEHICULO')
  assert.equal(cuerpo.condicionFiscal, 'CF')
  assert.equal(cuerpo.vigenciaPolizaId, 1, 'la semestral, que RUS marca por defecto')
  assert.deepEqual(cuerpo.vigencia, { desde: '2026-11-20', hasta: '2027-05-20' })
  assert.equal(cuerpo.cuotas, 6, 'la máxima de la vigencia')
  assert.equal(cuerpo.ajusteAutomatico, 30, 'la cláusula del formulario')
  assert.deepEqual(cuerpo.vehiculos, [{ anio: '2020', gnc: 'NO', cpLocalidadGuarda: 1870, modeloVehiculo: 88229, uso: 'PARTICULAR' }])

  const ajustes = Object.fromEntries(resultado.ajustes.map((a) => [a.campo, a]))
  assert.equal(ajustes.vigencia!.valor, 'MEJOR_COSTO|1')
  assert.equal(ajustes.vigencia!.destacado, true)
  assert.equal(ajustes.cuotas!.valor, 'MAXIMA|6')
  assert.equal(ajustes.ajusteAutomatico!.valor, '30|30')
  assert.equal(ajustes.tipoUnidad!.valor, '1')
  assert.equal(ajustes.marca!.valor, '11')
  assert.equal(ajustes.modelo!.valor, '3125')
  assert.equal(ajustes.version!.valor, '88229')
  assert.equal(ajustes.version!.porSolicitud, true)
  assert.match(ajustes.version!.opciones[0]!.texto, /^CRUZE · CRUZE 1\.4 4 PTAS LTZ AT/, 'la más parecida primero')
  assert.equal(ajustes.uso!.valor, 'PARTICULAR|PARTICULAR', 'el uso va por su nombre')

  const pedidosEnTexto = JSON.stringify(api.pedidos.map((p) => p.url))
  const detalle = JSON.stringify(resultado.detalleTecnico)
  assert.ok(!detalle.includes(CLAVE) && !detalle.includes(API_KEY) && !detalle.includes('tok-rus-1'), 'ni los secretos ni el token se filtran')
  assert.ok(!pedidosEnTexto.includes(API_KEY))
  assert.match(detalle, /POST cotizaciones\/automotores/)
})

test('RUS: lo elegido a mano manda (vigencia, cuotas, ajuste, condición fiscal y países limítrofes)', async (t) => {
  const api = apiFalsa(t)
  const resultado = await rus.cotizar(solicitud({}, { tomador: { ...solicitud().tomador, condicionIva: 'MONOTRIBUTO' } }), {
    vigencia: 'MEJOR_COSTO|3',
    cuotas: 'MAXIMA|2',
    ajusteAutomatico: '30|40',
    paisesLimitrofes: 'SI',
  })
  assert.equal(resultado.estado, 'OK', resultado.mensaje ?? '')
  const [cuerpo] = api.cotizaciones
  assert.equal(cuerpo!.vigenciaPolizaId, 3)
  assert.deepEqual(cuerpo!.vigencia, { desde: '2026-11-20', hasta: '2027-02-20' })
  assert.equal(cuerpo!.cuotas, 2)
  assert.equal(cuerpo!.ajusteAutomatico, 40)
  assert.equal(cuerpo!.condicionFiscal, 'RMT', 'monotributo')
  assert.equal(cuerpo!.aumentoRCPaisesLimitrofes, 'SI')
})

test('RUS: una pick-up que no está entre los autos se busca sola entre las pick-ups', async (t) => {
  const api = apiFalsa(t)
  const resultado = await rus.cotizar(solicitud({ marca: 'Toyota', modelo: 'Hilux', version: '2.8 TDI DC 4x4 SRX AT' }), {})
  assert.equal(resultado.estado, 'OK', resultado.mensaje ?? '')
  const ajustes = Object.fromEntries(resultado.ajustes.map((a) => [a.campo, a]))
  assert.equal(ajustes.tipoUnidad!.valor, '2')
  assert.equal(ajustes.version!.valor, '70001')
  assert.equal((api.cotizaciones[0]!.vehiculos as Array<{ modeloVehiculo: number }>)[0]!.modeloVehiculo, 70001)
  assert.ok(api.pedidos.some((p) => p.ruta === 'vehiculo/usos' && p.consulta.get('idTipoUnidad') === '2'), 'los usos, del tipo de unidad donde estaba')
})

test('RUS: una moto va al ramo 20, a cotizaciones/motos y como motovehículo', async (t) => {
  const api = apiFalsa(t, () =>
    json({
      cotizaciones: [
        { descripcionComercial: 'B-80  Moto (B-80 Moto)', codigoRC: 'RCM', codigoCasco: 'B-80 MOTO AG', prima: 98470, premio: 177372, cuotas: 6, valorCuota: 29562, franquicia: 0, sumaAsegurada: '5893500.0' },
        { descripcionComercial: null, codigoRC: 'RCM', codigoCasco: null, prima: 38272, premio: 71352, cuotas: 6, valorCuota: 11892, franquicia: 0 },
      ],
    }),
  )
  const resultado = await rus.cotizar(solicitud({ tipo: 'MOTO', marca: 'Honda', modelo: 'CB 250 Twister', version: '' }), {})
  assert.equal(resultado.estado, 'OK', resultado.mensaje ?? '')
  assert.deepEqual(resultado.coberturas.map((c) => [c.codigo, c.categoria]), [['RCM|B-80 MOTO AG', 'TERCEROS_BASICO'], ['RCM', 'RC']])
  const post = api.pedidos.find((p) => p.metodo === 'POST' && p.ruta.startsWith('cotizaciones/'))!
  assert.equal(post.ruta, 'cotizaciones/motos')
  assert.equal(api.cotizaciones[0]!.codigoRamoPoliza, 20)
  assert.equal(api.cotizaciones[0]!.codigoTipoInteres, 'MOTOVEHICULO')
  assert.ok(api.pedidos.some((p) => p.ruta === 'comunes/vigencias' && p.consulta.get('ramo') === '20'))
  assert.ok(api.pedidos.some((p) => p.ruta === 'vehiculo/marcas' && p.consulta.get('TipoUnidad') === '8'), 'moto de más de 50 cc')
})

test('RUS: con dos versiones igual de parecidas pregunta en vez de adivinar, y lo elegido a mano manda', async (t) => {
  const api = apiFalsa(t)
  const dudosa = await rus.cotizar(solicitud({ version: '1.4 4 Ptas AT' }), {})
  assert.equal(dudosa.estado, 'FALTAN_DATOS')
  assert.match(dudosa.mensaje ?? '', /versión en RUS/)
  assert.equal(dudosa.revisar, 'version')
  assert.equal(api.cotizaciones.length, 0, 'no cotiza otro vehículo por las dudas')
  const elegida = await rus.cotizar(solicitud({ version: '1.4 4 Ptas AT' }), { version: '94727' })
  assert.equal(elegida.estado, 'OK', elegida.mensaje ?? '')
  assert.equal((api.cotizaciones[0]!.vehiculos as Array<{ modeloVehiculo: number }>)[0]!.modeloVehiculo, 94727)
})

test('RUS: un rechazo vuelve como error en la tarjeta, con el motivo y qué revisar', async (t) => {
  apiFalsa(t, () => json({ errors: [{ message: 'WebService.cotizacion.fechaInicioNoValida', code: 'ERROR_INTERNO_DEL_SERVIDOR', description: 'Fecha de inicio de vigencia no valida' }], status: 400 }, 400))
  const resultado = await rus.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'ERROR')
  assert.match(resultado.mensaje ?? '', /^RUS no cotizó: Fecha de inicio de vigencia no valida\. Probá con otra vigencia/)
  assert.equal((resultado.detalleTecnico as { status: number }).status, 400)
  assert.ok(resultado.ajustes.length > 0, 'los ajustes quedan para cambiar algo y volver a probar')
})

test('RUS: sin vigencias de RUS se cotiza con la de su ejemplo y se avisa', async (t) => {
  usarCuentaDeRusDePrueba(CUENTA)
  t.after(() => usarCuentaDeRusDePrueba(null))
  const cotizaciones: Array<Record<string, unknown>> = []
  fetchFalso(t, (pedido) => {
    if (pedido.ruta === RUTA_TOKEN) return json(TOKEN)
    if (pedido.ruta === 'comunes/vigencias') return json({ message: 'Internal server error' }, 500)
    if (pedido.ruta === 'vehiculo/marcas') return json(MARCAS)
    if (pedido.ruta === 'vehiculo/usos') return json({ listUso: [] })
    if (pedido.ruta === 'vehiculo/modelos') return json({ listGrupoModelo: [{ id: 3125, descripcion: 'CRUZE' }] })
    if (pedido.ruta === 'vehiculo/versiones') return json({ listUso: [{ id: 88229, descripcion: 'CRUZE 1.4 4 PTAS LTZ AT' }] })
    cotizaciones.push(JSON.parse(pedido.cuerpo) as Record<string, unknown>)
    return json({ cotizaciones: COTIZACIONES })
  })
  const resultado = await rus.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'OK', resultado.mensaje ?? '')
  assert.ok(resultado.avisos.some((a) => /no devolvió sus vigencias/.test(a)))
  assert.equal(cotizaciones[0]!.vigenciaPolizaId, 1)
  assert.equal((cotizaciones[0]!.vehiculos as Array<{ uso: string }>)[0]!.uso, 'PARTICULAR', 'sin usos de RUS, los de siempre')
})

test('RUS: lo que no es de la cotización (la API-Key rechazada) sí tira, y el servicio lo muestra en la tarjeta', async (t) => {
  usarCuentaDeRusDePrueba(CUENTA)
  t.after(() => usarCuentaDeRusDePrueba(null))
  fetchFalso(t, () => json({ message: 'Forbidden' }, 403))
  await assert.rejects(rus.cotizar(solicitud(), {}), /API-Key/)
})

test('RUS: sin cuenta cargada no está disponible; cotiza autos y motos y no emite', () => {
  usarCuentaDeRusDePrueba(null)
  assert.match(rus.noDisponible() ?? '', /Falta cargar la cuenta de RUS/)
  assert.deepEqual([...rus.tipos], ['AUTO', 'MOTO'])
  assert.equal(rus.emite, false)
  usarCuentaDeRusDePrueba(CUENTA)
  assert.equal(rus.noDisponible(), null)
  usarCuentaDeRusDePrueba(null)
})
