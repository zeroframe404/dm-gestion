// La Equidad: el cliente de su API GLM (autenticación, Bearer/Basic, query params en orden), sus
// listas, la cotización y su adaptador del multicotizador.
//
// Nada de esto sale a internet: la API se contesta reemplazando `fetch`. Lo que se sabe seguro de la
// API GLM es su documentación (docs/APIGLM V.1.11): el nombre de cada servicio, los parámetros en orden,
// los nombres de los campos del pedido y de la respuesta. Lo que más importa: que la autenticación se
// pida como dice el documento y se reuse, que los query params vayan en orden y los vacíos también,
// que el pedido de cotización lleve los nombres exactos (errata incluida), que un rechazo diga qué
// revisar, y que ninguna contraseña se filtre.
import assert from 'node:assert/strict'
import test from 'node:test'
import { claveDeVariante, claveDeVehiculo, leerLista, leerVehiculos, listaDe, numeroDeEquidad } from '../src/main/aseguradoras/equidad/catalogos'
import {
  consultaOrdenada,
  crearClienteEquidad,
  ErrorDeEquidad,
  fechaCompacta,
  fechaDeEquidad,
  leerSesion,
  mensajeDeError,
  normalizarUrlBase,
  olvidarSesionesDeEquidad,
  SERVICIOS_EQUIDAD,
  urlDeServicio,
} from '../src/main/aseguradoras/equidad/cliente'
import { armarPedidoDeCotizacion, leerRespuestaDeCotizacion } from '../src/main/aseguradoras/equidad/cotizacion'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import {
  consejoParaElRechazo,
  equidad,
  ID_EQUIDAD,
  iibbPorDefecto,
  monedaPorDefecto,
  olvidarListasDeEquidad,
  productorPorDefecto,
  tipoDePolizaPorDefecto,
  usarCuentaDeEquidadDePrueba,
} from '../src/main/multicotizador/equidad'

type Prueba = { after: (fn: () => void) => void }

const CLAVE = 'contr&seña<de>prueba'
const CLAVE_SERVICIO = 'PORTAL123'
const URL_BASE = 'https://pruebas.equidad.test/EQUIDAD_PRUE/servlet/'
const CUENTA = {
  ambiente: 'prueba' as const,
  urlBase: URL_BASE,
  usuario: 'GLM',
  clave: CLAVE,
  usuarioDeServicio: 'PORTAL',
  claveDeServicio: CLAVE_SERVICIO,
  productor: '',
  rama: '4',
  empresa: '1',
}

const SESION = { UsuCod: 'GLM', UsuNom: 'Usuario GLM', UsuarioDeServicio: 'PORTAL', Token: 'tok-123', Expiracion: '2099-01-01T00:00:00' }

interface PedidoHttp {
  url: string
  servicio: string
  consulta: string
  metodo: string
  headers: Record<string, string>
  cuerpo: string
}

/** Reemplaza `fetch` hasta que termine la prueba; anota cada pedido. */
function fetchFalso(t: Prueba, contestar: (pedido: PedidoHttp) => Response): PedidoHttp[] {
  const fetchOriginal = globalThis.fetch
  t.after(() => {
    globalThis.fetch = fetchOriginal
    olvidarSesionesDeEquidad()
    olvidarListasDeEquidad()
  })
  olvidarSesionesDeEquidad()
  olvidarListasDeEquidad()
  const pedidos: PedidoHttp[] = []
  globalThis.fetch = (async (url: string | URL | Request, opciones: RequestInit = {}) => {
    const texto = String(url)
    const u = new URL(texto)
    const pedido: PedidoHttp = {
      url: texto,
      servicio: u.pathname.split('/').pop()!,
      consulta: u.search.replace(/^\?/, ''),
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

const esServicio = (pedido: PedidoHttp, nombre: keyof typeof SERVICIOS_EQUIDAD) => pedido.servicio === SERVICIOS_EQUIDAD[nombre]
const BASIC_ESPERADO = `Basic ${Buffer.from(`PORTAL:${CLAVE_SERVICIO}`).toString('base64')}`

// --- El cliente -------------------------------------------------------------------------------------

test('Equidad: la URL de cada servicio es la base más su nombre de clase, como en los ejemplos de la documentación', () => {
  assert.equal(normalizarUrlBase('http://10.0.8.2/ATM_COM_PRUE/servlet'), 'http://10.0.8.2/ATM_COM_PRUE/servlet/')
  assert.equal(normalizarUrlBase('servidor/EQ/servlet//'), 'https://servidor/EQ/servlet/')
  assert.equal(normalizarUrlBase('  '), '')
  assert.equal(urlDeServicio('http://10.0.8.2/ATM_COM_PRUE/servlet', 'autenticarUsuario'), 'http://10.0.8.2/ATM_COM_PRUE/servlet/ar.com.glmsa.seguros.comercial.apiglm.seguridad.awsautenticarusuario')
  assert.equal(SERVICIOS_EQUIDAD.cotizarAutomotor, 'ar.com.glmsa.seguros.comercial.apiglm.emision.automotores.awscotizarautomotor', 'sin el espacio que tiene la errata del documento')
})

test('Equidad: los query params van en el orden dado y los vacíos también, y las fechas AAAAMMDD', () => {
  assert.equal(consultaOrdenada([['CPCod', '1870'], ['CPSub', ''], ['CPLoc', ''], ['PrvCod', '']]), 'CPCod=1870&CPSub=&CPLoc=&PrvCod=')
  assert.equal(consultaOrdenada([['EsFlota', false], ['Anio', 2020]]), 'EsFlota=false&Anio=2020')
  assert.equal(consultaOrdenada([['VehiculoDescripcion', 'CRONOS 1.3 & co']]), 'VehiculoDescripcion=CRONOS%201.3%20%26%20co')
  assert.equal(fechaCompacta('2026-10-20'), '20261020')
})

test('Equidad: la autenticación va como dice AutenticarUsuario (Basic del usuario de servicio + JSON del de aplicación) y se reusa', async (t) => {
  const pedidos = fetchFalso(t, (pedido) => {
    if (esServicio(pedido, 'autenticarUsuario')) return json(SESION)
    if (esServicio(pedido, 'listarMoneda')) return json([{ Codigo: '1', Descripcion: 'PESOS' }])
    return json({ status: 404, Description: 'No existe' }, 404)
  })
  const cliente = crearClienteEquidad(CUENTA)
  const monedas = await cliente.get<unknown>('listarMoneda', [['UsuCod', 'GLM']])
  await cliente.get<unknown>('listarMoneda', [['UsuCod', 'GLM']])

  const auth = pedidos[0]!
  assert.equal(auth.metodo, 'POST')
  assert.equal(auth.url, `${URL_BASE}${SERVICIOS_EQUIDAD.autenticarUsuario}`)
  assert.equal(auth.headers['content-type'], 'application/json')
  assert.equal(auth.headers.authorization, BASIC_ESPERADO, 'el Basic es el usuario de servicio')
  assert.deepEqual(JSON.parse(auth.cuerpo), { Usuario: 'GLM', Password: CLAVE }, 'la contraseña llega tal cual, con sus signos')

  const get = pedidos[1]!
  assert.equal(get.url, `${URL_BASE}${SERVICIOS_EQUIDAD.listarMoneda}?UsuCod=GLM`)
  assert.equal(get.headers.authorization, 'Bearer tok-123', 'después de autenticar va el token')
  assert.deepEqual(monedas, [{ Codigo: '1', Descripcion: 'PESOS' }])
  assert.equal(pedidos.filter((p) => esServicio(p, 'autenticarUsuario')).length, 1, 'el segundo GET usa la misma sesión')
  assert.equal(pedidos.length, 3)
})

test('Equidad: sin usuario de servicio no va Authorization en la autenticación, y sin token las listas van con nada', async (t) => {
  const pedidos = fetchFalso(t, (pedido) => (esServicio(pedido, 'autenticarUsuario') ? json({ UsuCod: 'GLM', UsuNom: 'GLM' }) : json([])))
  const cliente = crearClienteEquidad({ ...CUENTA, usuarioDeServicio: '', claveDeServicio: '' })
  await cliente.get('listarMoneda', [['UsuCod', 'GLM']])
  assert.equal('authorization' in pedidos[0]!.headers, false)
  assert.equal('authorization' in pedidos[1]!.headers, false)
  const sesion = await cliente.sesion()
  assert.equal(sesion.token, '')
  assert.equal(sesion.usuarioCodigo, 'GLM')
})

test('Equidad: si un servicio rechaza el Bearer se autentica de nuevo y, si sigue en 401, se prueba con el Basic', async (t) => {
  let autenticaciones = 0
  const pedidos = fetchFalso(t, (pedido) => {
    if (esServicio(pedido, 'autenticarUsuario')) return json({ ...SESION, Token: `tok-${++autenticaciones}` })
    if (pedido.headers.authorization?.startsWith('Bearer')) return json({ status: 401, Description: 'Falló la autenticación' }, 401)
    return json([{ Codigo: 1, Nombre: 'MARTINEZ DANIEL' }])
  })
  const cliente = crearClienteEquidad(CUENTA)
  const productores = await cliente.get<unknown>('listarProductoresDeUsuario', [['EmpCod', '1'], ['UsuCod', 'GLM']])
  assert.deepEqual(productores, [{ Codigo: 1, Nombre: 'MARTINEZ DANIEL' }])
  assert.equal(autenticaciones, 2)
  assert.equal(pedidos.at(-1)!.headers.authorization, BASIC_ESPERADO)
  assert.equal(pedidos.length, 5)
})

test('Equidad: los errores de la API se dicen con su JSON Error, y un 404 apunta a la URL base', async (t) => {
  assert.match(mensajeDeError(401, JSON.stringify({ status: 401, Description: 'Falló la autenticación', Detail: 'usuario inválido' }), 'la autenticación').mensaje, /no aceptó las credenciales en la autenticación \(401\): Falló la autenticación: usuario inválido/)
  assert.match(mensajeDeError(404, '<html>Not found</html>', 'awslistarmoneda').mensaje, /no tiene el servicio awslistarmoneda \(404\): revisá la URL base/)
  assert.match(mensajeDeError(400, JSON.stringify({ status: 400, Description: 'Faltan parámetros' }), 'awsbuscarvehiculos').mensaje, /le faltan parámetros \(400\): Faltan parámetros/)
  assert.match(mensajeDeError(503, '', 'la cotización').mensaje, /no está disponible ahora/)
  assert.equal(mensajeDeError(500, JSON.stringify({ Codigo: 12, Mensaje: 'Error interno' }), 'x').codigo, '12')

  fetchFalso(t, () => json({ Codigo: 5, Mensaje: 'Usuario o contraseña incorrectos' }))
  await assert.rejects(crearClienteEquidad(CUENTA).sesion(), (error: unknown) => {
    assert.ok(error instanceof ErrorDeEquidad)
    assert.match(error.message, /no aceptó el usuario de la API: Usuario o contraseña incorrectos/)
    assert.equal(error.codigo, '5')
    return true
  })
})

test('Equidad: la sesión se lee de AutenticarUsuario, con su vencimiento en cualquiera de sus formas', () => {
  const ahora = Date.UTC(2026, 9, 19, 12, 0, 0)
  const conVencimiento = leerSesion({ UsuCod: 'GLM', UsuNom: 'Usuario', Token: 'abc', Expiracion: new Date(ahora + 3_600_000).toISOString() }, 'glm', ahora)
  assert.equal(conVencimiento.usuarioCodigo, 'GLM')
  assert.equal(conVencimiento.token, 'abc')
  assert.equal(conVencimiento.venceSegunEquidad, ahora + 3_600_000)
  assert.ok(conVencimiento.venceEn < conVencimiento.venceSegunEquidad!, 'se renueva un rato antes de que venza')
  const sinVencimiento = leerSesion({ Token: 'xyz' }, 'glm', ahora)
  assert.equal(sinVencimiento.usuarioCodigo, 'glm', 'sin UsuCod se usa el usuario configurado')
  assert.equal(sinVencimiento.venceSegunEquidad, null)
  assert.ok(sinVencimiento.venceEn > ahora)
  assert.equal(fechaDeEquidad('19/10/2026 10:30'), new Date(2026, 9, 19, 10, 30).getTime())
  assert.equal(fechaDeEquidad('2026-10-19 10:30:00'), new Date('2026-10-19T10:30:00').getTime())
  assert.equal(fechaDeEquidad('nada'), null)
})

test('Equidad: sin internet o sin respuesta a tiempo, se dice que es la red', async (t) => {
  fetchFalso(t, () => {
    throw new TypeError('fetch failed')
  })
  await assert.rejects(crearClienteEquidad(CUENTA).sesion(), (error: unknown) => {
    assert.ok(error instanceof ErrorDeEquidad && error.esDeRed)
    assert.match(error.message, /No se pudo conectar con la API de Equidad/)
    return true
  })
})

// --- Las listas ---------------------------------------------------------------------------------------

test('Equidad: las listas {Codigo, Descripcion} se entienden sueltas, envueltas o con otras mayúsculas', () => {
  assert.deepEqual(leerLista([{ Codigo: 1, Descripcion: 'FIAT' }], 'las marcas'), [{ codigo: '1', descripcion: 'FIAT' }])
  assert.deepEqual(leerLista({ data: [{ codigo: 'AU', descripcion: 'AUTOMOTORES' }] }, 'los tipos'), [{ codigo: 'AU', descripcion: 'AUTOMOTORES' }])
  assert.deepEqual(leerLista([{ Codigo: 7, Nombre: 'MARTINEZ' }], 'los productores', { descripcion: ['Nombre'] }), [{ codigo: '7', descripcion: 'MARTINEZ' }])
  assert.deepEqual(leerLista([{ sinCodigo: true }, null], 'las marcas'), [], 'lo que no se entiende se salta')
  assert.throws(() => leerLista({ ok: true }, 'las marcas'), /contestó las marcas con un formato inesperado: \{"ok":true\}/)
  assert.equal(listaDe({ a: [1], b: [2] }), null, 'con dos listas sin nombre conocido no se adivina')
})

test('Equidad: los vehículos de BuscarVehiculos se identifican por marca, modelo y submodelo', () => {
  const lista = leerVehiculos([{ Anio: 2020, MarcaCodigo: 7, MarcaDescripcion: 'FIAT', ModeloCodigo: 12, SubModeloCodigo: 3, Descripcion: 'CRONOS 1.3 DRIVE' }, { MarcaCodigo: 7 }], 'los vehículos')
  assert.equal(lista.length, 1)
  assert.equal(claveDeVehiculo(lista[0]!), '7:12:3')
  assert.equal(claveDeVariante({ capitulo: '1', varianteRC: '2', varianteAIR: '0' }), '1:2:0')
})

test('Equidad: los importes vienen como vengan', () => {
  assert.equal(numeroDeEquidad(1234.5), 1234.5)
  assert.equal(numeroDeEquidad('1234.56'), 1234.56)
  assert.equal(numeroDeEquidad('1.234.567,89'), 1234567.89)
  assert.equal(numeroDeEquidad('12.345'), 12345)
  assert.equal(numeroDeEquidad('12,5'), 12.5)
  assert.equal(numeroDeEquidad('sin número'), null)
})

// --- La cotización -------------------------------------------------------------------------------------

test('Equidad: el pedido de CotizarAutomotor lleva los nombres exactos del documento, errata incluida', () => {
  const pedido = armarPedidoDeCotizacion({
    usuario: 'GLM',
    rama: '4',
    tipoPoliza: 'AU',
    tomadorNombre: 'A COTIZAR',
    tomadorCuit: '',
    tomadorTipoPersona: '1',
    tomadorIva: 'CF',
    tomadorIibb: 'NI',
    vigenciaDesde: '2026-10-20',
    productor: '1234',
    moneda: '1',
    planComercial: 'PL1',
    formaDePago: '2',
    modoFacturacion: 'ANU',
    condicionDePago: 'C12',
    bonificacionPorcentaje: 20,
    recargoAdministrativoPorcentaje: 10,
    riesgo: {
      codigoPostal: '1870',
      subCodigoPostal: '2',
      marcaCodigo: '7',
      modeloCodigo: '12',
      subModeloCodigo: '3',
      anio: '2020',
      ceroKm: false,
      capitulo: '1',
      varianteRC: '2',
      varianteAIR: '0',
      clausulaAjuste: '10',
      adicionalGranizo: '',
      rastreo: true,
      alarmaSatelital: 'LJ',
      gnc: false,
      sumaAsegurada: 25_000_000,
      alarma: false,
      accesorios: [{ codigo: '5', valorAsegurado: 100 }],
    },
  })
  assert.equal(pedido.Usuario, 'GLM')
  assert.equal(pedido.Rama, 4)
  assert.equal(pedido.TomadorTipoPersona, '1')
  assert.equal(pedido.TomadoCategoriaIVACodigo, 'CF', 'sic: así lo nombra el documento')
  assert.equal(pedido.VigenciaDesde, '2026-10-20')
  assert.equal(pedido.ProductorCodigo, 1234)
  assert.equal(pedido.FormaPagoCodigo, 2)
  assert.equal(pedido.PorcentajeBonificacion, 20)
  assert.equal(pedido.PorcenjateRecargoAdm, 10, 'sic: la errata es el nombre que la API espera')
  assert.equal('Solicitud' in pedido, false)
  const riesgo = pedido.RiesgoAUT as Record<string, unknown>
  assert.equal(riesgo.SubCodigoPostal, 2)
  assert.equal(riesgo.MarcaCodigo, 7)
  assert.equal(riesgo.CeroKM, 'N')
  assert.equal(riesgo.PoseeEquipoRastreo, '2')
  assert.equal(riesgo.EquipoRastreoCodigo, 'LJ')
  assert.equal(riesgo.PoseeEquipoGNC, ' ')
  assert.equal(riesgo.SumaAsegurada, 25_000_000)
  assert.deepEqual(riesgo.Accesorios, [{ Codigo: 5, ValorAsegurado: 100, Identificacion: '' }])
})

const COTIZACION = {
  Rama: 4,
  Solicitud: 123456,
  Instalacion: 1,
  DescripcionVehiculo: 'FIAT CRONOS 1.3 DRIVE 2020',
  FechaInicioVigencia: '2026-10-20',
  FechaFinVigencia: '2027-10-20',
  ValorAseguradoVehic: 25000000,
  Coberturas: [
    { Item: 1, Cobertura: 'A', CoberturaDesc: 'RESPONSABILIDAD CIVIL', Prima: 100000, PorcBonificacion: 20, Bonificacion: 20000, PorcRecargoAdministrativo: 10, RecargoAdministrativo: 8000, Premio: 120000, ImporteCuota1: 12000, ImporteRestoCuotas: 10000, Comision: 15000 },
    { Item: 2, Cobertura: 'C', CoberturaDesc: 'TERCEROS COMPLETO', Prima: 200000, Premio: 240000, ImporteCuota1: 24000, ImporteRestoCuotas: 20000 },
    { Item: 3, Cobertura: 'D', CoberturaDesc: 'TODO RIESGO FRANQUICIA 500000', Prima: 400000, Premio: 480000, ImporteCuota1: 48000, ImporteRestoCuotas: 40000 },
  ],
  Excepciones: [{ Item: 3, Tipo: 'INS', Motivo: 1, Detalle: 'Requiere inspección previa', Estado: 'PENDIENTE' }],
  Errores: [],
}

test('Equidad: la respuesta de la cotización se lee por lo que documenta: coberturas, excepciones y errores', () => {
  const leida = leerRespuestaDeCotizacion(COTIZACION)
  assert.equal(leida.ok, true)
  assert.equal(leida.solicitud, '123456')
  assert.equal(leida.instalacion, '1')
  assert.equal(leida.sumaAsegurada, 25_000_000)
  assert.equal(leida.coberturas.length, 3)
  assert.deepEqual(leida.coberturas[0], {
    item: '1',
    codigo: 'A',
    descripcion: 'RESPONSABILIDAD CIVIL',
    prima: 100000,
    bonificacionPorcentaje: 20,
    bonificacion: 20000,
    recargoAdministrativoPorcentaje: 10,
    recargoAdministrativo: 8000,
    recargoFinanciero: null,
    derechoEmision: null,
    impuestos: null,
    premio: 120000,
    importeCuota1: 12000,
    importeRestoCuotas: 10000,
    comision: 15000,
  })
  assert.deepEqual(leida.excepciones, [{ item: '3', tipo: 'INS', motivo: '1', detalle: 'Requiere inspección previa', estado: 'PENDIENTE' }])
  const rechazo = leerRespuestaDeCotizacion({ Coberturas: [], Errores: [{ Descripcion: 'Vehículo inexistente' }] })
  assert.equal(rechazo.ok, false)
  assert.deepEqual(rechazo.errores, ['Vehículo inexistente'])
  assert.equal(leerRespuestaDeCotizacion({ Coberturas: COTIZACION.Coberturas, Errores: [{ Descripcion: 'Productor inhabilitado' }] }).ok, false, 'con errores no cotizó aunque traiga coberturas')
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
    tomador: { nombre: 'Juan Pérez', documento: '20123456', telefono: '', tipoPersona: 'FISICA', condicionIva: 'CONSUMIDOR_FINAL' },
    codigoPostal: '1870',
    localidad: 'Avellaneda',
    vigenciaDesde: '2026-10-20',
    medioDePago: 'TARJETA',
    codigoInfoAuto: null,
    ...resto,
  }
}

const VEHICULOS = [
  { Anio: 2020, MarcaCodigo: 7, MarcaDescripcion: 'FIAT', ModeloCodigo: 12, SubModeloCodigo: 1, Descripcion: 'CRONOS 1.3 DRIVE' },
  { Anio: 2020, MarcaCodigo: 7, MarcaDescripcion: 'FIAT', ModeloCodigo: 12, SubModeloCodigo: 2, Descripcion: 'CRONOS 1.8 PRECISION' },
]

/** La API entera, con lo que contesta cada servicio; `cotizar` decide la respuesta al POST. */
function apiFalsa(t: Prueba, cotizar: (cuerpo: Record<string, unknown>) => Response = () => json(COTIZACION), vehiculos: unknown = VEHICULOS): PedidoHttp[] {
  usarCuentaDeEquidadDePrueba(CUENTA)
  t.after(() => usarCuentaDeEquidadDePrueba(null))
  return fetchFalso(t, (pedido) => {
    if (esServicio(pedido, 'autenticarUsuario')) return json(SESION)
    if (esServicio(pedido, 'listarTipoDePoliza')) return json([{ Rama: 4, Codigo: 'AU', Descripcion: 'AUTOMOTORES' }, { Rama: 4, Codigo: 'MO', Descripcion: 'MOTOVEHICULOS' }])
    if (esServicio(pedido, 'listarProductoresDeUsuario')) return json([{ Codigo: 1234, Nombre: 'MARTINEZ DANIEL' }])
    if (esServicio(pedido, 'listarCategoriaIVA')) return json([{ Codigo: 'RI', Descripcion: 'RESPONSABLE INSCRIPTO' }, { Codigo: 'CF', Descripcion: 'CONSUMIDOR FINAL' }])
    if (esServicio(pedido, 'listarCategoriaIB')) return json([{ Codigo: 'IN', Descripcion: 'INSCRIPTO' }, { Codigo: 'NI', Descripcion: 'NO INSCRIPTO' }])
    if (esServicio(pedido, 'listarPlanComercial')) return json([{ Rama: 4, Codigo: 'PL1', Descripcion: 'PLAN PRODUCTORES' }])
    if (esServicio(pedido, 'listarMoneda')) return json([{ Codigo: '2', Descripcion: 'DOLARES' }, { Codigo: '1', Descripcion: 'PESOS' }])
    if (esServicio(pedido, 'listarModoDeFacturacion')) return json([{ Codigo: 'ANU', Descripcion: 'ANUAL' }, { Codigo: 'SEM', Descripcion: 'SEMESTRAL' }])
    if (esServicio(pedido, 'listarFormaDePago')) return json([{ Codigo: 1, Descripcion: 'EFECTIVO' }, { Codigo: 2, Descripcion: 'TARJETA DE CREDITO' }, { Codigo: 3, Descripcion: 'DEBITO CBU' }])
    if (esServicio(pedido, 'listarCondicionDePago')) return json([{ Rama: 4, Codigo: 'C01', Descripcion: 'CONTADO', PorDefecto: false }, { Rama: 4, Codigo: 'C12', Descripcion: '12 CUOTAS', PorDefecto: true }])
    if (esServicio(pedido, 'buscarCodigoPostal')) return json([{ Codigo: '1870', SubCodigo: 1, Localidad: 'AVELLANEDA', Descripcion: '1870 AVELLANEDA', ProvinciaCodigo: 'B', ProvinciaDescripcion: 'BUENOS AIRES' }, { Codigo: '1870', SubCodigo: 2, Localidad: 'PIÑEYRO', ProvinciaDescripcion: 'BUENOS AIRES' }])
    if (esServicio(pedido, 'listarMarcaDeVehiculo')) return json([{ Codigo: 7, Descripcion: 'FIAT' }, { Codigo: 9, Descripcion: 'FORD' }])
    if (esServicio(pedido, 'buscarVehiculos')) return json(vehiculos)
    if (esServicio(pedido, 'listarVariantesDeVehiculo')) return json([{ CapituloCodigo: 1, VarianteRC: 1, VarianteAIR: 0, Descripcion: 'AUTOMOVIL PARTICULAR' }, { CapituloCodigo: 1, VarianteRC: 2, VarianteAIR: 0, Descripcion: 'AUTOMOVIL COMERCIAL' }])
    if (esServicio(pedido, 'listarClausulaDeAjuste')) return json([{ Codigo: '10', Descripcion: 'AJUSTE AUTOMATICO 10%' }])
    if (esServicio(pedido, 'listarAlarmaSatelital')) return json([{ Codigo: 'LJ', Descripcion: 'LOJACK' }])
    if (esServicio(pedido, 'obtenerSumaAseguradaDeVehiculo')) return json({ ValorAsegurado: 25000000 })
    if (esServicio(pedido, 'cotizarAutomotor') && pedido.metodo === 'POST') return cotizar(JSON.parse(pedido.cuerpo) as Record<string, unknown>)
    return json({ status: 404, Description: 'No existe' }, 404)
  })
}

test('Equidad: cotiza eligiendo cada combo como la web (tipo de póliza, productor, plan, vigencia, pago, cuotas) y el vehículo por nombre', async (t) => {
  const pedidos = apiFalsa(t)
  const resultado = await equidad.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'OK', resultado.mensaje ?? '')
  assert.equal(resultado.descripcionVehiculo, 'FIAT CRONOS 1.3 DRIVE 2020')
  assert.deepEqual(
    resultado.coberturas.map((c) => [c.codigo, c.categoria, c.premio, c.primeraCuota, c.cuota, c.comision, c.bonificacionPorcentaje]),
    [
      ['A', 'RC', 120000, 12000, 10000, 15000, 20],
      ['C', 'TERCEROS_COMPLETO', 240000, 24000, 20000, null, null],
      ['D', 'TODO_RIESGO', 480000, 48000, 40000, null, null],
    ],
  )
  assert.ok(resultado.coberturas.every((c) => c.aseguradora === ID_EQUIDAD && c.emision === null), 'por ahora Equidad no se emite desde la app')
  assert.deepEqual(resultado.avisos, ['TODO RIESGO FRANQUICIA 500000: Requiere inspección previa (PENDIENTE)'])
  assert.match(resultado.mensaje ?? '', /plan PLAN PRODUCTORES, anual, 12 cuotas con tarjeta de credito/)
  assert.match(resultado.mensaje ?? '', /solicitud 123456\/1 en Equidad/)
  assert.match(resultado.mensaje ?? '', /suma asegurada \$ 25\.000\.000,00 \(la de Equidad\)/)

  const post = pedidos.find((p) => esServicio(p, 'cotizarAutomotor'))!
  const cuerpo = JSON.parse(post.cuerpo) as Record<string, unknown> & { RiesgoAUT: Record<string, unknown> }
  assert.equal(cuerpo.Usuario, 'GLM')
  assert.equal(cuerpo.Rama, 4)
  assert.equal(cuerpo.TipoPolizaCodigo, 'AU', 'el tipo de póliza que nombra a los autos')
  assert.equal(cuerpo.ProductorCodigo, 1234)
  assert.equal(cuerpo.MonedaCodigo, '1', 'pesos')
  assert.equal(cuerpo.PlanComercialCodigo, 'PL1')
  assert.equal(cuerpo.ModoFacturacionCodigo, 'ANU')
  assert.equal(cuerpo.FormaPagoCodigo, 2, 'la forma de pago que corresponde a la tarjeta')
  assert.equal(cuerpo.CondicionPagoCodigo, 'C12', 'la condición por defecto de Equidad')
  assert.equal(cuerpo.TomadoCategoriaIVACodigo, 'CF')
  assert.equal(cuerpo.TomadorIIBBCodigo, 'NI')
  assert.equal(cuerpo.TomadorNombre, 'Juan Pérez')
  assert.equal(cuerpo.TomadorTipoPersona, '1')
  assert.equal('PorcentajeBonificacion' in cuerpo, false, 'sin elegir, Equidad aplica la suya')
  assert.equal(cuerpo.RiesgoAUT.CodigoPostal, '1870')
  assert.equal(cuerpo.RiesgoAUT.SubCodigoPostal, 1, 'la localidad de la solicitud')
  assert.equal(cuerpo.RiesgoAUT.MarcaCodigo, 7)
  assert.equal(cuerpo.RiesgoAUT.ModeloCodigo, 12)
  assert.equal(cuerpo.RiesgoAUT.SubModeloCodigo, 1)
  assert.equal(cuerpo.RiesgoAUT.CapituloCodigo, 1)
  assert.equal(cuerpo.RiesgoAUT.VarianteRC, 1, 'la variante que nombra el uso particular')
  assert.equal(cuerpo.RiesgoAUT.ClausulaAjusteCodigo, '10')
  assert.equal(cuerpo.RiesgoAUT.SumaAsegurada, 25000000)

  // Los query params de las listas, en el orden del documento y con los vacíos.
  const cp = pedidos.find((p) => esServicio(p, 'buscarCodigoPostal'))!
  assert.equal(cp.consulta, 'CPCod=1870&CPSub=&CPLoc=&PrvCod=')
  const planes = pedidos.find((p) => esServicio(p, 'listarPlanComercial'))!
  assert.equal(planes.consulta, 'EmpCod=1&UsuCod=GLM&RamCod=4&RamTipPolCod=AU&ProCod=1234&VigenciaDesde=20261020&EsFlota=false')
  const condiciones = pedidos.find((p) => esServicio(p, 'listarCondicionDePago'))!
  assert.equal(condiciones.consulta, 'EmpCod=1&UsuCod=GLM&RamCod=4&VigenciaDesde=20261020&ProCod=1234&PCCod=PL1&MFacCod=ANU&MonCod=1&RamTipPolCod=AU&ForPagCod=2')
  const vehiculos = pedidos.find((p) => esServicio(p, 'buscarVehiculos'))!
  assert.equal(vehiculos.consulta, 'UsuCod=GLM&RamCod=4&Anio=2020&MarCod=7&VehiculoDescripcion=')
  assert.ok(pedidos.every((p) => p.metodo === 'GET' || esServicio(p, 'autenticarUsuario') || esServicio(p, 'cotizarAutomotor') || esServicio(p, 'obtenerSumaAseguradaDeVehiculo')))

  const ajustes = Object.fromEntries(resultado.ajustes.map((a) => [a.campo, a]))
  assert.equal(ajustes.planComercial!.destacado, true)
  assert.equal(ajustes.modoFacturacion!.valor, 'ANU')
  assert.equal(ajustes.formaDePago!.valor, '2')
  assert.equal(ajustes.condicionDePago!.valor, 'C12')
  assert.equal(ajustes.condicionDePago!.dependeDe, 'formaDePago')
  assert.equal(ajustes.tipoPoliza!.destacado, undefined)
  assert.equal(ajustes.localidad!.valor, '1870:1')
  assert.equal(ajustes.localidad!.porSolicitud, true)
  assert.equal(ajustes.marca!.valor, '7')
  assert.equal(ajustes.version!.valor, '7:12:1')
  assert.equal(ajustes.version!.opciones[0]!.texto, 'CRONOS 1.3 DRIVE (7:12:1)', 'la más parecida primero')
  assert.equal(ajustes.variante!.valor, '1:1:0')
  assert.match(ajustes.bonificacion!.ayuda ?? '', /En esta cotización Equidad aplicó 20 %/)

  const detalle = JSON.stringify(resultado.detalleTecnico)
  assert.ok(!detalle.includes(CLAVE) && !detalle.includes(CLAVE_SERVICIO) && !detalle.includes('tok-123'), 'ni las contraseñas ni el token se filtran')
  assert.match(detalle, /awscotizarautomotor/)
  assert.ok(!JSON.stringify(pedidos.map((p) => p.url)).includes(CLAVE), 'las contraseñas nunca van en la URL')
})

test('Equidad: con dos versiones igual de parecidas se pregunta en vez de adivinar, y lo elegido a mano manda', async (t) => {
  const pedidos = apiFalsa(t, undefined, [
    { ...VEHICULOS[0], SubModeloCodigo: 1, Descripcion: 'CRONOS 1.3 DRIVE MT' },
    { ...VEHICULOS[0], SubModeloCodigo: 3, Descripcion: 'CRONOS 1.3 DRIVE AT' },
  ])
  const conDudas = await equidad.cotizar(solicitud(), {})
  assert.equal(conDudas.estado, 'FALTAN_DATOS')
  assert.equal(conDudas.revisar, 'version')
  assert.match(conDudas.mensaje ?? '', /versión en equidad/)
  assert.ok(pedidos.every((p) => !esServicio(p, 'cotizarAutomotor')), 'sin versión no se cotiza')

  const elegida = await equidad.cotizar(solicitud(), { version: '7:12:3', variante: '1:2:0', condicionDePago: 'C01', bonificacion: '15' })
  assert.equal(elegida.estado, 'OK', elegida.mensaje ?? '')
  const post = pedidos.find((p) => esServicio(p, 'cotizarAutomotor'))!
  const cuerpo = JSON.parse(post.cuerpo) as Record<string, unknown> & { RiesgoAUT: Record<string, unknown> }
  assert.equal(cuerpo.RiesgoAUT.SubModeloCodigo, 3)
  assert.equal(cuerpo.RiesgoAUT.VarianteRC, 2)
  assert.equal(cuerpo.CondicionPagoCodigo, 'C01')
  assert.equal(cuerpo.PorcentajeBonificacion, 15)
  assert.equal(pedidos.filter((p) => esServicio(p, 'listarMarcaDeVehiculo')).length, 1, 'las listas se guardan en memoria entre cotizaciones')
  assert.equal(pedidos.filter((p) => esServicio(p, 'autenticarUsuario')).length, 1, 'y la sesión también')
})

test('Equidad: la suma asegurada del formulario manda, y sin ella se pide la de Equidad', async (t) => {
  const pedidos = apiFalsa(t)
  await equidad.cotizar(solicitud({ sumaAsegurada: 30_000_000, rastreo: true }), {})
  assert.ok(pedidos.every((p) => !esServicio(p, 'obtenerSumaAseguradaDeVehiculo')), 'con suma cargada no se pide la de Equidad')
  const cuerpo = JSON.parse(pedidos.find((p) => esServicio(p, 'cotizarAutomotor'))!.cuerpo) as { RiesgoAUT: Record<string, unknown> }
  assert.equal(cuerpo.RiesgoAUT.SumaAsegurada, 30_000_000)
  assert.equal(cuerpo.RiesgoAUT.PoseeEquipoRastreo, '2')
  assert.equal(cuerpo.RiesgoAUT.EquipoRastreoCodigo, 'LJ', 'con rastreo, la primera alarma de la lista')
})

test('Equidad: un rechazo vuelve como error en la tarjeta, con el motivo y qué revisar', async (t) => {
  apiFalsa(t, () => json({ Coberturas: [], Errores: [{ Descripcion: 'Vehículo no habilitado para el año' }] }))
  const resultado = await equidad.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'ERROR')
  assert.match(resultado.mensaje ?? '', /Equidad no cotizó: Vehículo no habilitado para el año\. Elegí otra versión/)
  assert.equal(resultado.revisar, 'version')
  assert.ok(resultado.detalleTecnico, 'el detalle técnico también cuando no cotizó')
  assert.equal(consejoParaElRechazo('El productor no está habilitado'), 'Revisá el productor en los ajustes de Equidad (o el cargado en API Aseguradoras → Equidad).')
  assert.equal(consejoParaElRechazo('otra cosa'), '')
})

test('Equidad: un 400 de la API en la cotización también es un rechazo, no una caída', async (t) => {
  apiFalsa(t, () => json({ status: 400, Description: 'Faltan parámetros', Detail: 'CondicionPagoCodigo' }, 400))
  const resultado = await equidad.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'ERROR')
  assert.match(resultado.mensaje ?? '', /Faltan parámetros: CondicionPagoCodigo/)
})

test('Equidad: una respuesta sin coberturas ni errores lo dice, y «Copiar datos» la trae entera', async (t) => {
  apiFalsa(t, () => json({ resultado: 'ok', algo: { raro: true } }))
  const resultado = await equidad.cotizar(solicitud(), {})
  assert.equal(resultado.estado, 'ERROR')
  assert.match(resultado.mensaje ?? '', /no devolvió coberturas/)
  assert.match(resultado.mensaje ?? '', /Copiar datos para Equidad/)
  assert.deepEqual((resultado.detalleTecnico as { respuesta: unknown }).respuesta, { resultado: 'ok', algo: { raro: true } })
})

test('Equidad: lo que no es de la cotización (la cuenta rechazada, sin internet) sí tira', async (t) => {
  usarCuentaDeEquidadDePrueba(CUENTA)
  t.after(() => usarCuentaDeEquidadDePrueba(null))
  fetchFalso(t, () => json({ status: 401, Description: 'Falló la autenticación' }, 401))
  await assert.rejects(equidad.cotizar(solicitud(), {}), /no aceptó las credenciales/)
})

test('Equidad: las decisiones por defecto, solas', () => {
  assert.equal(tipoDePolizaPorDefecto([{ codigo: 'MO', descripcion: 'MOTOS' }, { codigo: 'AU', descripcion: 'AUTOMOVILES' }]), 'AU')
  assert.equal(tipoDePolizaPorDefecto([{ codigo: 'X', descripcion: 'OTRA' }]), 'X')
  assert.equal(productorPorDefecto('99', [{ codigo: '1', descripcion: 'A' }]), '1', 'el cargado que la API no lista no se usa')
  assert.equal(productorPorDefecto('99', []), '99', 'sin lista, el cargado')
  assert.equal(productorPorDefecto('1', [{ codigo: '1', descripcion: 'A' }, { codigo: '2', descripcion: 'B' }]), '1')
  assert.equal(monedaPorDefecto([{ codigo: '2', descripcion: 'DOLARES' }, { codigo: '1', descripcion: 'PESOS' }]), '1')
  assert.equal(iibbPorDefecto([{ codigo: 'IN', descripcion: 'INSCRIPTO' }, { codigo: 'NI', descripcion: 'NO INSCRIPTO' }]), 'NI')
})

test('Equidad: sin cuenta cargada no está disponible, sólo cotiza autos y no emite', () => {
  usarCuentaDeEquidadDePrueba(null)
  assert.match(equidad.noDisponible() ?? '', /Falta cargar la cuenta de Equidad/)
  assert.deepEqual([...equidad.tipos], ['AUTO'])
  assert.equal(equidad.emite, false)
  usarCuentaDeEquidadDePrueba(CUENTA)
  assert.equal(equidad.noDisponible(), null)
  usarCuentaDeEquidadDePrueba(null)
})

test('Equidad: las localidades de un código postal salen de BuscarCodigoPostal', async (t) => {
  apiFalsa(t)
  assert.deepEqual(await equidad.localidades!('AUTO', '1870'), ['AVELLANEDA', 'PIÑEYRO'])
})
