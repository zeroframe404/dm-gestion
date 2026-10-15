// Mercantil Andina: el cliente de su API (token y suscripción), sus listas, la cotización y su
// adaptador del multicotizador.
//
// Nada de esto sale a internet: la API se contesta reemplazando `fetch`. Lo que se sabe seguro de
// Mercantil es cómo se pide el token (su guía, en docs/) y cómo contesta su gateway sin suscripción
// (probado en vivo el 15/10/2026); la forma de las listas y de la cotización sale de la documentación
// del portal, así que acá se prueba que se entiendan sus variantes. Lo que más importa: que el token
// se pida como dice la guía y se reuse, que un rechazo diga qué revisar, que la cotización mande el
// vehículo que se eligió, y que ni la contraseña ni la clave de suscripción se filtren.
import assert from 'node:assert/strict'
import test from 'node:test'
import { campo, leerLista, leerProductores, listaDe } from '../src/main/aseguradoras/mercantil/catalogos'
import {
  CLIENT_ID,
  crearClienteMercantil,
  ENCABEZADO_SUSCRIPCION,
  ErrorDeMercantil,
  erroresDeNegocio,
  leerToken,
  mensajeDeError,
  olvidarTokensDeMercantil,
  RUTA_TOKEN,
} from '../src/main/aseguradoras/mercantil/cliente'
import { armarPedidoDeCotizacion, leerRespuestaDeCotizacion, listaDeCoberturas, numeroDeMercantil, RUTA_COTIZACION } from '../src/main/aseguradoras/mercantil/cotizacion'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import { consejoParaElRechazo, cuotasPorDefecto, ID_MERCANTIL, mercantil, olvidarListasDeMercantil, usarCuentaDeMercantilDePrueba } from '../src/main/multicotizador/mercantil'

type Prueba = { after: (fn: () => void) => void }

const CLAVE = 'contr&seña<de>prueba'
const SUSCRIPCION = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
const CUENTA = { ambiente: 'desarrollo' as const, usuario: 'agencia@ejemplo.com.ar', clave: CLAVE, claveDeSuscripcion: SUSCRIPCION, productor: '' }

const TOKEN = { access_token: 'tok-123', expires_in: 300, refresh_expires_in: 1800, token_type: 'Bearer' }

interface PedidoHttp {
  url: string
  ruta: string
  metodo: string
  headers: Record<string, string>
  cuerpo: string
}

/** Reemplaza `fetch` hasta que termine la prueba; anota cada pedido. */
function fetchFalso(t: Prueba, contestar: (pedido: PedidoHttp) => Response): PedidoHttp[] {
  const fetchOriginal = globalThis.fetch
  t.after(() => {
    globalThis.fetch = fetchOriginal
    olvidarTokensDeMercantil()
    olvidarListasDeMercantil()
  })
  olvidarTokensDeMercantil()
  olvidarListasDeMercantil()
  const pedidos: PedidoHttp[] = []
  globalThis.fetch = (async (url: string | URL | Request, opciones: RequestInit = {}) => {
    const texto = String(url)
    const pedido: PedidoHttp = {
      url: texto,
      ruta: new URL(texto).pathname.replace(/^\//, ''),
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

const SIN_SUSCRIPCION = { statusCode: 401, message: 'Access denied due to missing subscription key. Make sure to include subscription key when making requests to an API.' }
const SUSCRIPCION_INVALIDA = { statusCode: 401, message: 'Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription.' }
const NO_EXISTE = { statusCode: 404, message: 'Resource not found' }

// --- El cliente -------------------------------------------------------------------------------------

test('Mercantil: el token se pide como dice la guía y se reusa hasta que vence', async (t) => {
  const pedidos = fetchFalso(t, (pedido) => {
    if (pedido.ruta === RUTA_TOKEN) return json(TOKEN)
    if (pedido.ruta === 'vehiculos/v1/marcas') return json([{ codigo: 1, desc: 'FIAT' }])
    return json(NO_EXISTE, 404)
  })
  const cliente = crearClienteMercantil(CUENTA)
  const marcas = await cliente.get<unknown>('vehiculos/v1/marcas', { anio: '2020' })
  await cliente.get<unknown>('vehiculos/v1/marcas', { anio: '2021' })

  const token = pedidos[0]!
  assert.equal(token.metodo, 'POST')
  assert.equal(token.url, `https://apidev.mercantilandina.com.ar/${RUTA_TOKEN}`, 'desarrollo va a apidev, con la barra final de la guía')
  assert.equal(token.headers['content-type'], 'application/x-www-form-urlencoded')
  assert.equal(token.headers[ENCABEZADO_SUSCRIPCION.toLowerCase()], SUSCRIPCION, 'el token también lleva la clave de suscripción')
  const cuerpo = new URLSearchParams(token.cuerpo)
  assert.equal(cuerpo.get('client_id'), CLIENT_ID)
  assert.equal(cuerpo.get('username'), CUENTA.usuario)
  assert.equal(cuerpo.get('password'), CLAVE, 'la contraseña llega tal cual, con sus signos')
  assert.equal(cuerpo.get('grant_type'), 'password')

  const get = pedidos[1]!
  assert.equal(get.url, 'https://apidev.mercantilandina.com.ar/vehiculos/v1/marcas?anio=2020')
  assert.equal(get.headers.authorization, 'Bearer tok-123')
  assert.equal(get.headers[ENCABEZADO_SUSCRIPCION.toLowerCase()], SUSCRIPCION)
  assert.deepEqual(marcas, [{ codigo: 1, desc: 'FIAT' }])
  assert.equal(pedidos.filter((p) => p.ruta === RUTA_TOKEN).length, 1, 'el segundo GET usa el mismo token')
  assert.equal(pedidos.length, 3)
})

test('Mercantil: en producción se habla con api.mercantilandina.com.ar', async (t) => {
  const pedidos = fetchFalso(t, () => json(TOKEN))
  await crearClienteMercantil({ ...CUENTA, ambiente: 'produccion' }).token()
  assert.equal(pedidos[0]!.url, `https://api.mercantilandina.com.ar/${RUTA_TOKEN}`)
})

test('Mercantil: la clave de suscripción que falta o no vale se dice como lo que es, la del portal', async (t) => {
  fetchFalso(t, () => json(SUSCRIPCION_INVALIDA, 401))
  await assert.rejects(crearClienteMercantil(CUENTA).token(), (error: unknown) => {
    assert.ok(error instanceof ErrorDeMercantil)
    assert.match(error.message, /clave de suscripción/)
    assert.match(error.message, /perfil del portal/)
    assert.equal(error.status, 401)
    return true
  })
  assert.match(mensajeDeError(401, JSON.stringify(SIN_SUSCRIPCION), 'el token').mensaje, /pide la clave de suscripción/)
  assert.match(mensajeDeError(404, JSON.stringify(NO_EXISTE), 'vehiculos/v9/marcas').mensaje, /no tiene la ruta vehiculos\/v9\/marcas/)
})

test('Mercantil: un usuario o contraseña rechazados se dicen aparte de la suscripción', async (t) => {
  fetchFalso(t, () => json({ error: 'invalid_grant', error_description: 'Invalid user credentials' }, 401))
  await assert.rejects(crearClienteMercantil(CUENTA).token(), /no aceptó el usuario o la contraseña \(Invalid user credentials\)/)
})

test('Mercantil: los errores de negocio vienen como «errores: [{id, texto}]»', () => {
  const texto = JSON.stringify({ errores: [{ id: 'SEG001', texto: 'Credenciales no válidas' }, { id: 'X', texto: 'Otra cosa' }] })
  const leido = mensajeDeError(401, texto, 'productores/v1/')
  assert.equal(leido.codigo, 'SEG001')
  assert.match(leido.mensaje, /Credenciales no válidas · Otra cosa/)
  assert.deepEqual(erroresDeNegocio({}), { texto: '' })
  assert.equal(erroresDeNegocio({ errores: ['suelto'] }).texto, 'suelto')
})

test('Mercantil: con un 401 que no es de la suscripción se pide otro token y se reintenta una vez', async (t) => {
  let tokens = 0
  const pedidos = fetchFalso(t, (pedido) => {
    if (pedido.ruta === RUTA_TOKEN) return json({ ...TOKEN, access_token: `tok-${++tokens}` })
    if (pedido.headers.authorization === 'Bearer tok-1') return json({ errores: [{ id: 'SEG001', texto: 'Credenciales no válidas' }] }, 401)
    return json({ productor: { codigo: 12663, nombre: 'MARTINEZ DANIEL' } })
  })
  const cliente = crearClienteMercantil(CUENTA)
  const productor = await cliente.get<unknown>('productores/v1/')
  assert.deepEqual(productor, { productor: { codigo: 12663, nombre: 'MARTINEZ DANIEL' } })
  assert.equal(tokens, 2)
  assert.equal(pedidos.length, 4)
})

test('Mercantil: el token se lee con la forma de siempre de OAuth, y sin vencimiento se renueva solo', () => {
  const ahora = 1_000_000
  const conVencimiento = leerToken({ access_token: 'abc', expires_in: 300 }, ahora)
  assert.equal(conVencimiento.token, 'abc')
  assert.equal(conVencimiento.venceSegunMercantil, ahora + 300_000)
  assert.ok(conVencimiento.venceEn < conVencimiento.venceSegunMercantil!, 'se renueva un rato antes de que venza')
  const sinVencimiento = leerToken({ token: 'xyz' }, ahora)
  assert.equal(sinVencimiento.token, 'xyz')
  assert.equal(sinVencimiento.venceSegunMercantil, null)
  assert.ok(sinVencimiento.venceEn > ahora)
  assert.throws(() => leerToken({ ok: true }), /sin un token adentro/)
})

test('Mercantil: sin internet o sin respuesta a tiempo, se dice que es la red', async (t) => {
  fetchFalso(t, () => {
    throw new TypeError('fetch failed')
  })
  await assert.rejects(crearClienteMercantil(CUENTA).token(), (error: unknown) => {
    assert.ok(error instanceof ErrorDeMercantil && error.esDeRed)
    assert.match(error.message, /No se pudo conectar con Mercantil/)
    return true
  })
})

// --- Las listas ---------------------------------------------------------------------------------------

test('Mercantil: las listas se entienden en cualquiera de sus formas', () => {
  assert.deepEqual(leerLista([{ codigo: 1, descripcion: 'FIAT' }], 'las marcas'), [{ codigo: '1', descripcion: 'FIAT' }])
  assert.deepEqual(leerLista([{ id: 'VW', nombre: 'VOLKSWAGEN' }], 'las marcas'), [{ codigo: 'VW', descripcion: 'VOLKSWAGEN' }])
  assert.deepEqual(leerLista({ data: [{ Codigo: 7, Desc: 'TOYOTA' }] }, 'las marcas'), [{ codigo: '7', descripcion: 'TOYOTA' }])
  assert.deepEqual(leerLista({ marcas: ['FORD'] }, 'las marcas'), [{ codigo: 'FORD', descripcion: 'FORD' }])
  assert.deepEqual(leerLista([{ sinCodigo: true }, null, 'x'], 'las marcas'), [{ codigo: 'x', descripcion: 'x' }], 'lo que no se entiende se salta')
  assert.throws(() => leerLista({ ok: true }, 'las marcas'), /contestó las marcas con un formato inesperado: \{"ok":true\}/)
  assert.equal(listaDe({ a: [1], b: [2] }), null, 'con dos listas sin nombre conocido no se adivina')
  assert.equal(campo({ Descripcion: ' Hola ' }, ['descripcion']), 'Hola')
})

test('Mercantil: los productores se leen sueltos, en lista o envueltos', () => {
  assert.deepEqual(leerProductores({ codigo: 12663, nombre: 'MARTINEZ DANIEL' }), [{ codigo: '12663', nombre: 'MARTINEZ DANIEL' }])
  assert.deepEqual(leerProductores({ productor: { codigo: '12663', razonSocial: 'SEGUROS DM' } }), [{ codigo: '12663', nombre: 'SEGUROS DM' }])
  assert.deepEqual(leerProductores([{ productor: 1, nombre: 'A' }, { productor: 2 }]), [
    { codigo: '1', nombre: 'A' },
    { codigo: '2', nombre: '2' },
  ])
  assert.throws(() => leerProductores('nada'), /formato inesperado/)
})

// --- La cotización -------------------------------------------------------------------------------------

test('Mercantil: los importes vienen como vengan', () => {
  assert.equal(numeroDeMercantil(1234.5), 1234.5)
  assert.equal(numeroDeMercantil('1234.56'), 1234.56)
  assert.equal(numeroDeMercantil('$ 1.234,56'), 1234.56)
  assert.equal(numeroDeMercantil('1,234.56'), 1234.56)
  assert.equal(numeroDeMercantil('12.345'), 12345, 'un solo punto con tres dígitos atrás es de miles')
  assert.equal(numeroDeMercantil('12,5'), 12.5)
  assert.equal(numeroDeMercantil('sin número'), null)
  assert.equal(numeroDeMercantil(null), null)
})

test('Mercantil: la cotización se entiende por sus precios, estén donde estén', () => {
  const cruda = {
    id: 98765,
    vehiculo: { infoauto: 320001, sumaAsegurada: '25.000.000' },
    productos: [
      { codigo: 'A', descripcion: 'Responsabilidad Civil', premio: '12.345,67', prima: 10000, cuotas: 12, cuota: 1028.81 },
      { codigo: 'C', descripcion: 'Terceros Completo c/ granizo', premio: 30000, prima: 25000, franquicia: '0', comision: 3000 },
      { codigo: 'D', descripcion: 'Todo Riesgo', premio: 50000, prima: 40000, franquicia: '$ 500.000' },
    ],
    observaciones: ['Inspección previa'],
  }
  const leida = leerRespuestaDeCotizacion(cruda)
  assert.equal(leida.ok, true)
  assert.equal(leida.id, '98765')
  assert.equal(leida.sumaAsegurada, 25_000_000)
  assert.deepEqual(leida.mensajes, ['Inspección previa'])
  assert.equal(leida.coberturas.length, 3)
  assert.deepEqual(leida.coberturas[0], { codigo: 'A', descripcion: 'Responsabilidad Civil', premio: 12345.67, prima: 10000, cuota: 1028.81, cuotas: 12, franquicia: '', sumaAsegurada: null, comision: null })
  assert.equal(leida.coberturas[1]!.franquicia, '', 'una franquicia en cero no es franquicia')
  assert.equal(leida.coberturas[1]!.comision, 3000)
  assert.equal(leida.coberturas[2]!.franquicia, '$ 500.000')

  // Más adentro también: la lista puede venir anidada en un plan.
  const anidada = { cotizacion: { numero: 'C-1', planes: [{ nombre: 'Plan 1', coberturas: [{ id: 'B', nombre: 'Terceros', importe: 100 }] }] } }
  assert.equal(listaDeCoberturas(anidada)?.length, 1)
  assert.deepEqual(leerRespuestaDeCotizacion(anidada).coberturas.map((c) => [c.codigo, c.descripcion, c.premio]), [['B', 'Terceros', 100]])

  const rechazo = leerRespuestaDeCotizacion({ errores: [{ id: 'VEH001', texto: 'Vehículo no válido' }] })
  assert.equal(rechazo.ok, false)
  assert.deepEqual(rechazo.mensajes, ['Vehículo no válido'])
})

test('Mercantil: el pedido lleva el vehículo por su código de InfoAuto, y lo opcional sólo si está', () => {
  const pedido = armarPedidoDeCotizacion({
    productor: '12663',
    codigoInfoAuto: '320001',
    anio: 2020,
    ceroKm: false,
    uso: '1',
    gnc: true,
    valorGnc: 800000,
    rastreo: false,
    codigoPostal: '1870',
    localidad: 'Avellaneda',
    vigenciaDesde: '2026-10-20',
    cuotas: 12,
    formaDePago: 'TC',
    tipoPersona: 'F',
    iva: 'CF',
  })
  assert.deepEqual(pedido, {
    productor: 12663,
    cuotas: 12,
    formaPago: 'TC',
    vigenciaDesde: '2026-10-20',
    vehiculo: { infoauto: 320001, anio: 2020, ceroKm: false, uso: 1, gnc: true, valorGnc: 800000, rastreador: false },
    localidad: { codigoPostal: 1870, nombre: 'Avellaneda' },
    persona: { tipo: 'F', iva: 'CF' },
  })
  const minimo = armarPedidoDeCotizacion({ codigoInfoAuto: '1', anio: 2019, ceroKm: true, uso: '1', gnc: false, rastreo: true, codigoPostal: '5000', localidad: '', vigenciaDesde: '2026-01-01', cuotas: 1, formaDePago: 'EF', tipoPersona: 'J', iva: 'RI' })
  assert.equal('productor' in minimo, false)
  assert.deepEqual(minimo.localidad, { codigoPostal: 5000 })
  assert.equal('valorGnc' in (minimo.vehiculo as object), false)
})

// --- El adaptador ----------------------------------------------------------------------------------------

function solicitud(cambios: Partial<SolicitudResuelta['vehiculo']> = {}, resto: Partial<SolicitudResuelta> = {}): SolicitudResuelta {
  return {
    vehiculo: {
      tipo: 'AUTO',
      marca: 'Fiat',
      modelo: 'Cronos',
      version: '1.3 Drive',
      anio: '2020',
      codigoCatalogo: 'AUTO:555',
      ceroKm: false,
      uso: 'PARTICULAR',
      gnc: false,
      valorGnc: null,
      rastreo: false,
      sumaAsegurada: null,
      ...cambios,
    },
    tomador: { nombre: '', documento: '', telefono: '', tipoPersona: 'FISICA', condicionIva: 'CONSUMIDOR_FINAL' },
    codigoPostal: '1870',
    localidad: 'Avellaneda',
    vigenciaDesde: '2026-10-20',
    medioDePago: 'TARJETA',
    codigoInfoAuto: null,
    ...resto,
  }
}

const MARCAS = [
  { codigo: 7, descripcion: 'FIAT' },
  { codigo: 9, descripcion: 'FORD' },
]
const MODELOS = [
  { codigo: 12, descripcion: 'CRONOS' },
  { codigo: 13, descripcion: 'ARGO' },
]
const VERSIONES = [
  { infoauto: 320001, version: '1.3 DRIVE' },
  { infoauto: 320002, version: '1.8 PRECISION' },
]
const COTIZACION = {
  id: 4711,
  productos: [
    { codigo: 'A', descripcion: 'RESPONSABILIDAD CIVIL', premio: 120000, prima: 100000 },
    { codigo: 'C', descripcion: 'TERCEROS COMPLETO', premio: 240000, prima: 200000 },
    { codigo: 'D', descripcion: 'TODO RIESGO FRANQUICIA 500000', premio: 480000, prima: 400000, franquicia: '500000' },
  ],
}

/** La API entera, con lo que contesta cada ruta; `cotizar` decide la respuesta al POST. */
function apiFalsa(t: Prueba, cotizar: (cuerpo: Record<string, unknown>) => Response = () => json(COTIZACION), versiones: unknown = VERSIONES): PedidoHttp[] {
  usarCuentaDeMercantilDePrueba(CUENTA)
  t.after(() => usarCuentaDeMercantilDePrueba(null))
  return fetchFalso(t, (pedido) => {
    if (pedido.ruta === RUTA_TOKEN) return json(TOKEN)
    if (pedido.ruta === 'vehiculos/v1/marcas') return json(MARCAS)
    if (pedido.ruta === 'vehiculos/v1/marcas/7/2020') return json(MODELOS)
    if (pedido.ruta === 'vehiculos/v1/marcas/7/2020/12') return json(versiones)
    if (pedido.ruta === 'vehiculos/v1/marcas/7/2020/13') return json([])
    if (pedido.ruta === RUTA_COTIZACION && pedido.metodo === 'POST') return cotizar(JSON.parse(pedido.cuerpo) as Record<string, unknown>)
    return json(NO_EXISTE, 404)
  })
}

test('Mercantil: cotiza buscando el vehículo por marca, modelos del año y versiones, y manda su código de InfoAuto', async (t) => {
  const pedidos = apiFalsa(t)
  const resultado = await mercantil.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'OK', resultado.mensaje ?? '')
  assert.equal(resultado.descripcionVehiculo, 'FIAT CRONOS 1.3 DRIVE 2020 (InfoAuto 320001)')
  assert.deepEqual(
    resultado.coberturas.map((c) => [c.codigo, c.categoria, c.premio, c.cuota, c.franquicia]),
    [
      ['A', 'RC', 120000, 10000, ''],
      ['C', 'TERCEROS_COMPLETO', 240000, 20000, ''],
      ['D', 'TODO_RIESGO', 480000, 40000, '500000'],
    ],
  )
  assert.ok(resultado.coberturas.every((c) => c.aseguradora === ID_MERCANTIL && c.emision === null), 'Mercantil no se emite desde la app')
  assert.match(resultado.mensaje ?? '', /12 cuotas con tarjeta de crédito/)
  assert.match(resultado.mensaje ?? '', /cotización 4711 en Mercantil/)

  const post = pedidos.find((p) => p.ruta === RUTA_COTIZACION)!
  const cuerpo = JSON.parse(post.cuerpo) as { vehiculo: Record<string, unknown>; cuotas: number; formaPago: string; persona: Record<string, unknown>; localidad: Record<string, unknown> }
  assert.equal(cuerpo.vehiculo.infoauto, 320001)
  assert.equal(cuerpo.vehiculo.anio, 2020)
  assert.equal(cuerpo.vehiculo.uso, 1)
  assert.equal(cuerpo.cuotas, 12, 'con tarjeta se compara en 12 cuotas')
  assert.equal(cuerpo.formaPago, 'TC')
  assert.deepEqual(cuerpo.persona, { tipo: 'F', iva: 'CF' })
  assert.deepEqual(cuerpo.localidad, { codigoPostal: 1870, nombre: 'Avellaneda' })

  const ajustes = Object.fromEntries(resultado.ajustes.map((a) => [a.campo, a]))
  assert.equal(ajustes.cuotas!.valor, '12')
  assert.equal(ajustes.cuotas!.destacado, true)
  assert.equal(ajustes.formaDePago!.valor, 'TC')
  assert.equal(ajustes.marca!.valor, '7')
  assert.equal(ajustes.modelo!.valor, '12')
  assert.equal(ajustes.version!.valor, '320001')
  assert.equal(ajustes.version!.porSolicitud, true)
  assert.equal(ajustes.version!.opciones[0]!.texto, 'CRONOS · 1.3 DRIVE (InfoAuto 320001)', 'la más parecida primero')

  const detalle = JSON.stringify(resultado.detalleTecnico)
  assert.ok(!detalle.includes(CLAVE) && !detalle.includes(SUSCRIPCION) && !detalle.includes('tok-123'), 'ni los secretos ni el token se filtran')
  assert.match(detalle, /POST cotizaciones\/v2\/automotores/)
  assert.ok(!JSON.stringify(pedidos.map((p) => p.url)).includes(SUSCRIPCION), 'la clave de suscripción va en el encabezado, nunca en la URL')
})

test('Mercantil: con dos versiones igual de parecidas se pregunta en vez de adivinar, y lo elegido a mano manda', async (t) => {
  const pedidos = apiFalsa(t, undefined, [
    { infoauto: 320001, version: '1.3 DRIVE MT' },
    { infoauto: 320003, version: '1.3 DRIVE AT' },
  ])
  const conDudas = await mercantil.cotizar(solicitud(), {})
  assert.equal(conDudas.estado, 'FALTAN_DATOS')
  assert.equal(conDudas.revisar, 'version')
  assert.match(conDudas.mensaje ?? '', /versión en mercantil/)
  assert.ok(pedidos.every((p) => p.ruta !== RUTA_COTIZACION), 'sin versión no se cotiza')

  const elegida = await mercantil.cotizar(solicitud(), { version: '320003' })
  assert.equal(elegida.estado, 'OK', elegida.mensaje ?? '')
  assert.equal(elegida.descripcionVehiculo, 'FIAT CRONOS 1.3 DRIVE AT 2020 (InfoAuto 320003)')
  const post = pedidos.find((p) => p.ruta === RUTA_COTIZACION)!
  assert.equal((JSON.parse(post.cuerpo) as { vehiculo: { infoauto: number } }).vehiculo.infoauto, 320003)
  assert.equal(pedidos.filter((p) => p.ruta === 'vehiculos/v1/marcas').length, 1, 'las listas se guardan en memoria entre cotizaciones')
})

test('Mercantil: en efectivo se cotiza de contado, y las cuotas o la forma de pago elegidas a mano valen', async (t) => {
  const pedidos = apiFalsa(t)
  assert.equal(cuotasPorDefecto('EFECTIVO'), '1')
  assert.equal(cuotasPorDefecto('DEBITO'), '12')
  const contado = await mercantil.cotizar(solicitud({}, { medioDePago: 'EFECTIVO' }), {})
  assert.equal(contado.estado, 'OK')
  type Cuerpo = { cuotas: number; formaPago: string; persona: { iva: string } }
  let cuerpo = JSON.parse(pedidos.at(-1)!.cuerpo) as Cuerpo
  assert.equal(cuerpo.cuotas, 1)
  assert.equal(cuerpo.formaPago, 'EF')
  assert.equal(contado.coberturas[0]!.cuota, 120000, 'de contado, la cuota es el premio')

  await mercantil.cotizar(solicitud(), { cuotas: '6', formaDePago: 'CBU', iva: 'RI' })
  cuerpo = JSON.parse(pedidos.at(-1)!.cuerpo) as Cuerpo
  assert.equal(cuerpo.cuotas, 6)
  assert.equal(cuerpo.formaPago, 'CBU')
  assert.equal(cuerpo.persona.iva, 'RI')
})

test('Mercantil: un rechazo vuelve como error en la tarjeta, con el motivo y qué revisar', async (t) => {
  apiFalsa(t, () => json({ errores: [{ id: 'VEH001', texto: 'Vehículo no válido para el año' }] }, 400))
  const resultado = await mercantil.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'ERROR')
  assert.match(resultado.mensaje ?? '', /Mercantil no cotizó: Vehículo no válido para el año\. Elegí otra versión/)
  assert.equal(resultado.revisar, 'version')
  assert.ok(resultado.detalleTecnico, 'el detalle técnico también cuando no cotizó')
  assert.equal(consejoParaElRechazo('El productor no está habilitado'), 'Revisá el código de productor cargado en API Aseguradoras → Mercantil: tiene que ser el PAS vinculado al usuario.')
  assert.equal(consejoParaElRechazo('otra cosa'), '')
})

test('Mercantil: una respuesta sin precios que no se entiende lo dice, y «Copiar datos» la trae entera', async (t) => {
  apiFalsa(t, () => json({ resultado: 'ok', algo: { raro: true } }))
  const resultado = await mercantil.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'ERROR')
  assert.match(resultado.mensaje ?? '', /no devolvió coberturas/)
  assert.match(resultado.mensaje ?? '', /Copiar datos para Mercantil Andina/)
  assert.deepEqual((resultado.detalleTecnico as { respuesta: unknown }).respuesta, { resultado: 'ok', algo: { raro: true } })
})

test('Mercantil: lo que no es de la cotización (la cuenta rechazada, sin internet) sí tira, y el servicio lo muestra en la tarjeta', async (t) => {
  usarCuentaDeMercantilDePrueba(CUENTA)
  t.after(() => usarCuentaDeMercantilDePrueba(null))
  fetchFalso(t, () => json(SUSCRIPCION_INVALIDA, 401))
  await assert.rejects(mercantil.cotizar(solicitud(), {}), /clave de suscripción/)
})

test('Mercantil: sin cuenta cargada no está disponible, y sólo cotiza autos', () => {
  usarCuentaDeMercantilDePrueba(null)
  assert.match(mercantil.noDisponible() ?? '', /Falta cargar la cuenta de Mercantil Andina/)
  assert.deepEqual([...mercantil.tipos], ['AUTO'])
  assert.equal(mercantil.emite, false)
  usarCuentaDeMercantilDePrueba(CUENTA)
  assert.equal(mercantil.noDisponible(), null)
  usarCuentaDeMercantilDePrueba(null)
})
