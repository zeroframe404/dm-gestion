// ATM Seguros: el cliente de su web service, sus tablas de parámetros y su adaptador del multicotizador.
//
// Nada de esto sale a internet: el SOAP y los REST se contestan reemplazando `fetch`, el FTP con
// `usarFtpDeAtmDePrueba` y el disco es una carpeta temporal. Las respuestas son las que dio ATM de
// verdad al probar contra producción (09/10/2026, ver la cabecera de aseguradoras/atm/cliente.ts): si
// ATM cambia algo, es acá donde hay que copiarlo. Lo que más importa: que el vehículo que se manda sea
// el que se pidió (su código de InfoAuto y su uso salen de las tablas), que un rechazo vuelva con el
// motivo y qué tocar, que unas tablas viejas o un FTP caído no frenen la cotización sin avisar, y que
// ni la comisión ni la clave se filtren. El humo en vivo contra ATM es aparte: `npm run humo:atm`.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { crc32, deflateRawSync, gzipSync } from 'node:zlib'
import { leerPlanes, leerVendedores, planesAtm, vendedoresAtm } from '../src/main/aseguradoras/atm/catalogos'
import { crearClienteAtm, ErrorDeAtm, resultadoDelSobre, sobreSoap, type ClienteAtm } from '../src/main/aseguradoras/atm/cliente'
import {
  armarPedidoDeCotizacion,
  cotizarAtm,
  fechaParaAtm,
  leerRespuestaDeCotizacion,
  METODO_COTIZAR,
  numeroDeAtm,
  sinClave,
  type CoberturaAtm,
  type DatosDeCotizacionAtm,
} from '../src/main/aseguradoras/atm/cotizacion'
import {
  actualizarTablasAtm,
  archivosEnDisco,
  estadoDeTablasAtm,
  guardarTablas,
  importarTablasAtm,
  tablasEnDisco,
  tablasParaCotizar,
  usarCarpetaDeTablasAtmDePrueba,
  usarFtpDeAtmDePrueba,
} from '../src/main/aseguradoras/atm/repositorio'
import {
  archivosDelZip,
  armarTablas,
  codigoSinCeros,
  decodificar,
  expandirArchivo,
  FormatoDeTablaNoReconocido,
  leerFilas,
  localidadesDeAtm,
  marcasDeAtm,
  partirLinea,
  separadorDe,
  sumasDeInfoAuto,
  tablaDelArchivo,
  versionesDeAtm,
  type ArchivoSuelto,
  type VehiculoAtm,
} from '../src/main/aseguradoras/atm/tablas'
import { aObjeto, buscar, desescaparXml, ErrorDeXml, escaparXml, hijo, hijos, leerXml, textoDe, type NodoXml } from '../src/main/aseguradoras/atm/xml'
import type { SolicitudResuelta } from '../src/main/multicotizador/aseguradora'
import {
  atm,
  consejoParaElRechazo,
  cuotasDe,
  franquiciaDe,
  ID_ATM,
  iibbPorDefecto,
  IVA_ATM,
  olvidarListasDeAtm,
  opcionesDeIibb,
  planPorDefecto,
  textoDePlan,
  usarCuentaDeAtmDePrueba,
  usoPorDefecto,
} from '../src/main/multicotizador/atm'
import { aseguradorasDelMulticotizador, cotizarEnAseguradora } from '../src/main/servicios/multicotizador'
import { enPesos, type CondicionIva, type SolicitudDeCotizacion } from '../src/shared/multicotizador'

type Prueba = { after: (fn: () => void) => void }

// --- Lo que contesta ATM de verdad ----------------------------------------------------------------------

/** Una clave con lo que más fácil rompe un XML: tiene que llegar a ATM tal cual y no verse en ningún lado. */
const CLAVE = 'cl&ve<de>prueba'
const CUENTA = { ambiente: 'produccion' as const, usuario: 'MARTINEZAD', clave: CLAVE, vendedor: '' }

const VENDEDORES = {
  error: false,
  errores: [],
  vendedores: [{ usuario: 'MARTINEZAD', prodlargo: '0956112663', apellido: '12663 - MARTINEZ DANIEL ADRIAN', inspeccion: 'S' }],
}

/** `get_plans` de producción, tal cual (autos y motos dan lo mismo). */
const PLANES = [
  { Descripcion: 'ANUAL/MENSUAL', FormaDePago: 'TARJETA', FormaDePagoCodigo: 3, Plan: '02' },
  { Descripcion: 'ANUAL/MENSUAL', FormaDePago: 'CBU', FormaDePagoCodigo: 4, Plan: '11' },
  { Descripcion: 'ANUAL/BIMESTRAL', FormaDePago: 'EFVO', FormaDePagoCodigo: 0, Plan: '22' },
  { Descripcion: 'ANUAL/SEMESTRAL', FormaDePago: 'TARJETA', FormaDePagoCodigo: 3, Plan: '24' },
  { Descripcion: 'ANUAL/TRIMESTRAL', FormaDePago: 'EFVO', FormaDePagoCodigo: 0, Plan: '21' },
  { Descripcion: 'ANUAL/BIMESTRAL 1 PAGO', FormaDePago: 'EFVO', FormaDePagoCodigo: 0, Plan: '03' },
  { Descripcion: 'ANUAL/BIMESTRAL 1 PAGO', FormaDePago: 'TARJETA', FormaDePagoCodigo: 3, Plan: '04' },
  { Descripcion: 'POLIZA CUATRIMESTRAL', FormaDePago: 'TARJETA', FormaDePagoCodigo: 3, Plan: '23' },
]

/** Las coberturas que dio ATM para un VW Tiguan 2012 (InfoAuto 460711), CP 1870, plan 02: código, nombre, prima, premio, comisión. */
const COBERTURAS_REALES: Array<[string, string, string, string, string]> = [
  ['A1', 'RESPONSABILIDAD CIVIL SIN ASISTENCIA', '71815', '89465.12', '10735.81'],
  ['A0', 'RESPONSABILIDAD CIVIL', '82749.17', '103086.61', '12370.39'],
  ['B5', 'ROBO E INCENDIO TOTAL SIN ASISTENCIA', '141120.22', '175803.62', '21096.43'],
  ['B1', 'ROBO E INCENDIO TOTAL', '141639.18', '176450.13', '21174.02'],
  ['B4', 'ROBO, INCENDIO Y ACCIDENTE TOTAL SIN ASISTENCIA', '147963.24', '184328.46', '22119.42'],
  ['B0', 'ROBO, INCENDIO Y ACCIDENTE TOTAL', '156810.53', '195350.17', '23442.02'],
  ['C1', 'ROBO E INCENDIO TOTAL Y/O PARCIAL', '161188.52', '200804.15', '24096.50'],
  ['C0', 'ROBO E INCENDIO TOTAL Y/O PARCIAL + ACCIDENTE TOTAL', '165567.23', '206259.02', '24751.08'],
  ['C3', 'TERCEROS COMPLETOS PLUS', '172667.67', '215104.56', '25812.55'],
  ['C2', 'TERCEROS COMPLETOS PREMIUM', '180343.09', '224666.38', '26959.97'],
]

function coberturaXml([codigo, descripcion, prima, premio, comision]: [string, string, string, string, string]): string {
  return (
    `<cobertura><codigo>${codigo}</codigo><descripcion>${descripcion}</descripcion><prima>${prima}</prima><premio>${premio}</premio>` +
    `<cuotas>01</cuotas><impcuotas>${premio}</impcuotas><ajuste/><formapago>TARJETA</formapago><plan_cot>02</plan_cot>` +
    `<comision>${comision}</comision><solicitud_glm>19517100</solicitud_glm></cobertura>`
  )
}

/** El `<auto>` de una cotización aceptada, como viene adentro del resultado. */
function autoCotizado(coberturas = COBERTURAS_REALES, datos = { suma: '21800000.00', uso: '0101', vehiculoblack: 'NO' }): string {
  return (
    `<auto xmlns=""><operacion>2645461</operacion><statusSuccess>TRUE</statusSuccess><statusText/><cotizacion>${coberturas.map(coberturaXml).join('')}</cotizacion>` +
    `<datos_cotiz><suma>${datos.suma}</suma><uso>${datos.uso}</uso><vehiculoblack>${datos.vehiculoblack}</vehiculoblack></datos_cotiz></auto>`
  )
}

/** Así rechaza ATM: 200, `statusSuccess` FALSE y un `<msg>` por motivo. */
function autoRechazado(...mensajes: string[]): string {
  return `<auto xmlns=""><operacion>0</operacion><statusSuccess>FALSE</statusSuccess><statusText>${mensajes.map((m) => `<msg>${escaparXml(m)}</msg>`).join('')}</statusText></auto>`
}

function respuestaSoap(auto: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://tempuri.org/"><SOAP-ENV:Body>' +
    `<ns1:AUTOS_Cotizar_PHPResponse><ns1:AUTOS_Cotizar_PHPResult>${auto}</ns1:AUTOS_Cotizar_PHPResult></ns1:AUTOS_Cotizar_PHPResponse>` +
    '</SOAP-ENV:Body></SOAP-ENV:Envelope>\n'
  )
}

/** La respuesta entera, byte a byte la que dio ATM. */
const RESPUESTA_REAL = respuestaSoap(autoCotizado())

// --- Ayudas ------------------------------------------------------------------------------------------------

interface PedidoHttp {
  url: string
  metodo: string
  headers: Record<string, string>
  cuerpo: string
}

/** Reemplaza `fetch` hasta que termine la prueba; anota cada pedido. */
function fetchFalso(t: Prueba, contestar: (pedido: PedidoHttp) => Response): PedidoHttp[] {
  const fetchOriginal = globalThis.fetch
  t.after(() => {
    globalThis.fetch = fetchOriginal
  })
  const pedidos: PedidoHttp[] = []
  globalThis.fetch = (async (url: string | URL | Request, opciones: RequestInit = {}) => {
    const pedido: PedidoHttp = {
      url: String(url),
      metodo: opciones.method ?? 'GET',
      headers: { ...(opciones.headers as Record<string, string> | undefined) },
      cuerpo: typeof opciones.body === 'string' ? opciones.body : '',
    }
    pedidos.push(pedido)
    return contestar(pedido)
  }) as typeof fetch
  return pedidos
}

function respuestaJson(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { 'content-type': 'application/json' } })
}

function clienteFalso(cambios: Partial<ClienteAtm>): ClienteAtm {
  return {
    cuenta: CUENTA,
    soap: async () => {
      throw new Error('no se esperaba un SOAP')
    },
    get: async () => {
      throw new Error('no se esperaba un GET')
    },
    post: async () => {
      throw new Error('no se esperaba un POST')
    },
    ...cambios,
  }
}

function archivo(nombre: string, texto: string): ArchivoSuelto {
  return { nombre, bytes: Buffer.from(texto, 'utf8') }
}

/** Un .zip mínimo: método 0 (sin comprimir), 8 (deflate) o cualquier otro para probar uno que no se lee. */
function armarZip(entradas: Array<{ nombre: string; bytes: Buffer; metodo?: number }>): Buffer {
  const partes: Buffer[] = []
  const directorio: Buffer[] = []
  let posicion = 0
  for (const entrada of entradas) {
    const nombre = Buffer.from(entrada.nombre, 'utf8')
    const metodo = entrada.metodo ?? 0
    const datos = metodo === 8 ? deflateRawSync(entrada.bytes) : entrada.bytes
    const suma = crc32(entrada.bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(0x5549, 12)
    local.writeUInt32LE(suma, 14)
    local.writeUInt32LE(datos.length, 18)
    local.writeUInt32LE(entrada.bytes.length, 22)
    local.writeUInt16LE(nombre.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(metodo, 10)
    central.writeUInt16LE(0x5549, 14)
    central.writeUInt32LE(suma, 16)
    central.writeUInt32LE(datos.length, 20)
    central.writeUInt32LE(entrada.bytes.length, 24)
    central.writeUInt16LE(nombre.length, 28)
    central.writeUInt32LE(posicion, 42)
    partes.push(local, nombre, datos)
    directorio.push(central, nombre)
    posicion += local.length + nombre.length + datos.length
  }
  const central = Buffer.concat(directorio)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(entradas.length, 8)
  fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(central.length, 12)
  fin.writeUInt32LE(posicion, 16)
  return Buffer.concat([...partes, central, fin])
}

/** Una carpeta temporal para las tablas, que se borra al terminar la prueba. */
function carpetaDeTablas(t: Prueba): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-atm-'))
  t.after(() => {
    usarCarpetaDeTablasAtmDePrueba(null)
    usarFtpDeAtmDePrueba(null)
    rmSync(carpeta, { recursive: true, force: true })
  })
  usarCarpetaDeTablasAtmDePrueba(carpeta)
  return carpeta
}

/** Hace que las tablas guardadas parezcan bajadas hace `dias` días. */
function envejecer(carpeta: string, dias: number): void {
  const ruta = path.join(carpeta, 'produccion', 'estado.json')
  const estado = JSON.parse(readFileSync(ruta, 'utf8')) as { bajadasEn: string }
  estado.bajadasEn = new Date(Date.now() - dias * 24 * 60 * 60_000).toISOString()
  writeFileSync(ruta, JSON.stringify(estado), 'utf8')
}

// Las tablas con que cotiza el adaptador en estas pruebas: dos versiones de Tiguan que se parecen (para
// la duda), un Gol que ATM no tiene para 2012 y una moto. Como podrían venir del FTP: con encabezado,
// coma decimal y fin de línea de Windows.
const MARCAS = 'Codigo;Descripcion;Seccion\r\n1;VOLKSWAGEN;3\r\n2;HONDA;4\r\n'
const MARCA_MODELO = [
  'cod_marca;marca;cod_modelo;modelo;tau_codia;cod_uso;tipo_uso',
  '1;VOLKSWAGEN;10;TIGUAN 2.0 TSI 4MOTION;460711;4262;1',
  '1;VOLKSWAGEN;10;TIGUAN 2.0 TSI 4MOTION;460711;4263;2',
  '1;VOLKSWAGEN;11;TIGUAN 2.0 TSI EXCLUSIVE;460712;4262;1',
  '1;VOLKSWAGEN;12;GOL TREND 1.6 PACK I;460100;4262;1',
  '2;HONDA;20;CG 150 TITAN;9900131;;1',
].join('\r\n')
const INFOAUTO = [
  'tau_nmarc;tau_marca;tau_nmode;tau_model;tau_codia;tau_cgrup;tau_creas;tau_anioe;tau_pre01;tau_pre02',
  '1;VOLKSWAGEN;10;TIGUAN 2.0 TSI 4MOTION;460711;1;1;2013;23000000,00;21800000,00',
  '1;VOLKSWAGEN;11;TIGUAN 2.0 TSI EXCLUSIVE;460712;1;1;2013;24000000,00;22500000,00',
  '1;VOLKSWAGEN;12;GOL TREND 1.6 PACK I;460100;1;1;2020;9000000,00;0',
  '2;HONDA;20;CG 150 TITAN;9900131;1;1;2020;3000000,00;2800000,00',
].join('\r\n')
const LOCALIDADES = [
  'codpos;localidad;provincia;codpro;subcodpos',
  '1870;AVELLANEDA;BUENOS AIRES;1;1',
  '1870;PIÑEYRO;BUENOS AIRES;1;2',
  '1000;AV CORRIENTES 1 AL 100;CAPITAL FEDERAL;0;1',
  '1000;AV CORRIENTES 101 AL 200;CAPITAL FEDERAL;0;2',
].join('\r\n')
const USOS = 'codigo;descripcion\r\n4262;PARTICULAR\r\n4263;COMERCIAL\r\n'
const RASTREOS = 'codigo;descripcion\r\n7;LO JACK\r\n8;PROTEGIDO GPS\r\n'

const TABLAS_DE_PRUEBA: ArchivoSuelto[] = [
  archivo('WS_AU_MARCAS.TXT', MARCAS),
  archivo('ws_au_marca_modelo_20261009.txt', MARCA_MODELO),
  archivo('ws_au_infoauto_20261009.txt', INFOAUTO),
  archivo('ws_au_localidades.txt', LOCALIDADES),
  archivo('ws_au_usos.txt', USOS),
  archivo('ws_au_rastreo_satelital.txt', RASTREOS),
]

function solicitud(cambios: Partial<SolicitudDeCotizacion> = {}): SolicitudDeCotizacion {
  return {
    vehiculo: {
      tipo: 'AUTO',
      marca: 'Volkswagen',
      modelo: 'Tiguan',
      version: '2.0 TSI 4Motion',
      anio: '2012',
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
    vigenciaDesde: '2026-10-10',
    medioDePago: 'TARJETA',
    ...cambios,
  }
}

function resuelta(cambios: Partial<SolicitudDeCotizacion> = {}): SolicitudResuelta {
  return { ...solicitud(cambios), codigoInfoAuto: null }
}

function conVehiculo(cambios: Partial<SolicitudDeCotizacion['vehiculo']>, otros: Partial<SolicitudDeCotizacion> = {}): SolicitudResuelta {
  return resuelta({ ...otros, vehiculo: { ...solicitud().vehiculo, ...cambios } })
}

function conIva(condicionIva: CondicionIva): SolicitudResuelta {
  return resuelta({ tomador: { ...solicitud().tomador, condicionIva } })
}

interface AtmFalso {
  pedidos: PedidoHttp[]
  /** Los `doc_in` que llegaron al SOAP, ya leídos. */
  cotizados: NodoXml[]
  bajadasDelFtp: () => number
}

/**
 * ATM entero de mentira: la cuenta cargada, las tablas de hoy en una carpeta temporal (así no se va al
 * FTP, que si se usa queda anotado), y `fetch` contestando vendedores, planes y el SOAP.
 */
function atmFalso(t: Prueba, opciones: { contestar?: (docIn: NodoXml) => string; vendedores?: unknown; cuenta?: typeof CUENTA } = {}): AtmFalso {
  carpetaDeTablas(t)
  t.after(() => {
    usarCuentaDeAtmDePrueba(null)
    olvidarListasDeAtm()
  })
  guardarTablas('produccion', TABLAS_DE_PRUEBA, 'ftp', true)
  let bajadas = 0
  usarFtpDeAtmDePrueba(async () => {
    bajadas++
    throw new Error('las tablas son de hoy: no se tendría que ir al FTP')
  })
  usarCuentaDeAtmDePrueba(opciones.cuenta ?? CUENTA)
  olvidarListasDeAtm()
  const cotizados: NodoXml[] = []
  const pedidos = fetchFalso(t, ({ url, cuerpo }) => {
    if (url.endsWith('/api/v1/ws_vendedores')) return respuestaJson(opciones.vendedores ?? VENDEDORES)
    if (url.includes('/api/v1/get_plans?')) return respuestaJson(PLANES)
    if (url.endsWith('/index.php/soap')) {
      const docIn = leerXml(buscar(leerXml(cuerpo), 'doc_in')?.texto ?? '')
      cotizados.push(docIn)
      const contestar = opciones.contestar ?? (() => RESPUESTA_REAL)
      return new Response(contestar(docIn), { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } })
    }
    return new Response('Not Found', { status: 404 })
  })
  return { pedidos, cotizados, bajadasDelFtp: () => bajadas }
}

/** true si la clave aparece en algún lado, tal cual o escapada. */
function sinLaClave(valor: unknown): boolean {
  const texto = JSON.stringify(valor)
  return texto.includes(CLAVE) || texto.includes(escaparXml(CLAVE))
}

/** Un campo del último pedido de cotización: `campo(falso, 'bien', 'uso')`. */
function campo(falso: AtmFalso, parte: 'usuario' | 'asegurado' | 'bien', nombre: string): string | undefined {
  return hijo(hijo(falso.cotizados.at(-1), parte), nombre)?.texto
}

// --- XML -----------------------------------------------------------------------------------------------

test('ATM: el lector de XML ignora los prefijos y entiende entidades, CDATA, comentarios e instrucciones', () => {
  const raiz = leerXml(
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE sobre>\n' +
      '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://tempuri.org/">' +
      '<!-- un comentario con <etiquetas> adentro --><SOAP-ENV:Body>' +
      '<ns1:Dato tipo="a>b">Pe&#241;a &amp; Mu&#xF1;oz &lt;3&gt; &quot;x&quot; &apos;y&apos; &raro;</ns1:Dato>' +
      '<ns1:Crudo><![CDATA[<b>no es etiqueta</b> & tampoco]]></ns1:Crudo><vacio/><otro a="1" /><?php echo 1; ?></SOAP-ENV:Body></SOAP-ENV:Envelope>',
  )
  assert.equal(raiz.nombre, 'Envelope')
  const cuerpo = hijo(raiz, 'BODY')
  assert.deepEqual(
    cuerpo?.hijos.map((h) => h.nombre),
    ['Dato', 'Crudo', 'vacio', 'otro'],
    'sin prefijos, sin el comentario ni la instrucción',
  )
  assert.equal(textoDe(cuerpo, 'dato'), `Peña & Muñoz <3> "x" 'y' &raro;`, 'una entidad desconocida queda como vino')
  assert.equal(textoDe(cuerpo, 'Crudo'), '<b>no es etiqueta</b> & tampoco')
  assert.deepEqual(hijo(cuerpo, 'vacio'), { nombre: 'vacio', texto: '', hijos: [] })
  assert.equal(buscar(raiz, 'crudo')?.nombre, 'Crudo')
  assert.equal(buscar(raiz, 'nada'), undefined)
  assert.deepEqual(hijos(cuerpo, 'nada'), [])
  assert.equal(textoDe(cuerpo, 'nada'), '')
  assert.equal(textoDe(undefined, 'nada'), '')
})

test('ATM: un XML mal formado tira ErrorDeXml en vez de devolver media respuesta', () => {
  const malos = [
    '<a><b></a>',
    '<a><b>',
    '</a>',
    '<a/><b/>',
    '',
    'Internal Server Error',
    '<a><!-- sin cerrar</a>',
    '<a><![CDATA[sin cerrar</a>',
    '<a x="1></a>',
    '<?xml version="1.0"',
    '<a>< /a>',
  ]
  for (const malo of malos) assert.throws(() => leerXml(malo), ErrorDeXml, JSON.stringify(malo))
})

test('ATM: escapar y desescapar XML va y vuelve, también escapado dos veces', () => {
  const texto = `Peña & "Muñoz" <3> 'x'`
  assert.equal(escaparXml(`a&b<c>"'`), 'a&amp;b&lt;c&gt;&quot;&apos;')
  assert.equal(desescaparXml(escaparXml(texto)), texto)
  // Así viaja el pedido: escapado adentro de un XML que va escapado adentro del sobre.
  assert.equal(desescaparXml(desescaparXml(escaparXml(escaparXml(texto)))), texto)
  assert.equal(desescaparXml('&#0; &#x110000; &AMP; &#65;'), '&#0; &#x110000; & A')
})

test('ATM: aObjeto deja las hojas como texto y los elementos repetidos como lista', () => {
  const nodo = leerXml(
    '<auto><operacion> 7 </operacion><statusText/><cotizacion><cobertura><codigo>A1</codigo></cobertura>' +
      '<cobertura><codigo>A0</codigo></cobertura></cotizacion><datos><suma>1</suma></datos></auto>',
  )
  assert.deepEqual(aObjeto(nodo), {
    operacion: '7',
    statusText: '',
    cotizacion: { cobertura: [{ codigo: 'A1' }, { codigo: 'A0' }] },
    datos: { suma: '1' },
  })
})

// --- El cliente ----------------------------------------------------------------------------------------

test('ATM: el sobre SOAP lleva el pedido como texto escapado en doc_in', () => {
  const docIn = '<auto><usuario><pass>a&amp;b&lt;c</pass></usuario></auto>'
  const sobre = sobreSoap(METODO_COTIZAR, docIn)
  assert.ok(sobre.startsWith('<?xml version="1.0" encoding="utf-8"?><soap:Envelope'))
  assert.ok(sobre.includes('<soap:Body><tns:AUTOS_Cotizar_PHP><tns:doc_in>&lt;auto&gt;&lt;usuario&gt;&lt;pass&gt;a&amp;amp;b&amp;lt;c&lt;/pass&gt;'))
  // Del otro lado, el doc_in vuelve a ser el pedido tal cual.
  assert.equal(buscar(leerXml(sobre), 'doc_in')?.texto, docIn)
})

test('ATM: el resultado del SOAP se lee anidado o como texto escapado, y un Fault es un error', () => {
  const auto = resultadoDelSobre(METODO_COTIZAR, RESPUESTA_REAL)
  assert.equal(auto.nombre, 'auto')
  assert.equal(textoDe(auto, 'operacion'), '2645461')

  const escapado = resultadoDelSobre(
    'Metodo',
    '<s:Envelope xmlns:s="x"><s:Body><MetodoResponse><MetodoResult>&lt;auto&gt;&lt;ok&gt;S&lt;/ok&gt;&lt;/auto&gt;</MetodoResult></MetodoResponse></s:Body></s:Envelope>',
  )
  assert.equal(escapado.nombre, 'auto')
  assert.equal(textoDe(escapado, 'ok'), 'S')

  assert.throws(
    () =>
      resultadoDelSobre(
        METODO_COTIZAR,
        "<SOAP-ENV:Envelope xmlns:SOAP-ENV='x'><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Server</faultcode><faultstring>Procedure 'X' not present</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>",
      ),
    (error: unknown) =>
      error instanceof ErrorDeAtm && !error.esDeRed && error.message === "ATM rechazó el pedido (AUTOS_Cotizar_PHP): Procedure 'X' not present",
  )
  assert.throws(() => resultadoDelSobre('Metodo', '<Envelope><Body><Otra/></Body></Envelope>'), /ATM contestó a Metodo sin el resultado esperado/)
  assert.throws(() => resultadoDelSobre('Metodo', '<Envelope><Body><MetodoResult>  </MetodoResult></Body></Envelope>'), /resultado vacío/)
})

test('ATM: el cliente manda el SOAP a /index.php/soap con su SOAPAction y devuelve lo de adentro del resultado', async (t) => {
  const pedidos = fetchFalso(t, () => new Response(RESPUESTA_REAL, { status: 200, headers: { 'content-type': 'text/xml; charset=utf-8' } }))
  const auto = await crearClienteAtm(CUENTA, { urlBase: 'https://atm.ejemplo/' }).soap(METODO_COTIZAR, '<auto><x>1</x></auto>')
  assert.equal(textoDe(auto, 'statusSuccess'), 'TRUE')
  assert.equal(pedidos.length, 1)
  assert.equal(pedidos[0]!.url, 'https://atm.ejemplo/index.php/soap')
  assert.equal(pedidos[0]!.metodo, 'POST')
  assert.equal(pedidos[0]!.headers.SOAPAction, '"http://tempuri.org/AUTOS_Cotizar_PHP"')
  assert.equal(pedidos[0]!.headers['content-type'], 'text/xml; charset=utf-8')
  assert.equal(pedidos[0]!.cuerpo, sobreSoap(METODO_COTIZAR, '<auto><x>1</x></auto>'))

  // Sin urlBase, la del ambiente de la cuenta.
  await crearClienteAtm({ ...CUENTA, ambiente: 'desarrollo' }).soap(METODO_COTIZAR, '<auto/>')
  await crearClienteAtm(CUENTA).soap(METODO_COTIZAR, '<auto/>')
  assert.deepEqual(
    pedidos.slice(1).map((p) => p.url),
    ['https://wsatm-dev.atmseguros.com.ar/index.php/soap', 'https://wsatm.atmseguros.com.ar/index.php/soap'],
  )
})

test('ATM: una página de error, una caída de red o una demora vuelven como ErrorDeAtm con el motivo', async (t) => {
  let falla: 'php' | 'texto' | 'red' | 'demora' = 'php'
  fetchFalso(t, () => {
    if (falla === 'red') throw new TypeError('fetch failed')
    if (falla === 'demora') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    if (falla === 'texto') return new Response('Service Unavailable', { status: 503 })
    return new Response(
      '<br />\n<b>Fatal error</b>:  Uncaught SoapFault exception: [Client] looks like we got no XML document in /var/www/index.php:12<br />',
      { status: 500, headers: { 'content-type': 'text/html' } },
    )
  })
  const cliente = crearClienteAtm(CUENTA, { urlBase: 'https://atm.ejemplo' })
  await assert.rejects(
    cliente.soap(METODO_COTIZAR, '<auto/>'),
    (error: unknown) =>
      error instanceof ErrorDeAtm &&
      error.status === 500 &&
      !error.esDeRed &&
      error.message === 'ATM respondió 500 a AUTOS_Cotizar_PHP: Fatal error : Uncaught SoapFault exception: [Client] looks like we got no XML document in /var/www/index.php:12',
  )
  falla = 'texto'
  await assert.rejects(
    cliente.soap(METODO_COTIZAR, '<auto/>'),
    (error: unknown) => error instanceof ErrorDeAtm && error.status === 503 && error.message === 'ATM respondió 503 a AUTOS_Cotizar_PHP: Service Unavailable',
  )
  falla = 'red'
  await assert.rejects(
    cliente.soap(METODO_COTIZAR, '<auto/>'),
    (error: unknown) => error instanceof ErrorDeAtm && error.esDeRed && error.status === undefined && /No se pudo conectar con ATM/.test(error.message),
  )
  await assert.rejects(cliente.get('get_plans', {}), (error: unknown) => error instanceof ErrorDeAtm && error.esDeRed)
  falla = 'demora'
  await assert.rejects(
    cliente.soap(METODO_COTIZAR, '<auto/>'),
    (error: unknown) => error instanceof ErrorDeAtm && error.esDeRed && error.message === 'ATM no contestó la cotización en 90 segundos.',
  )
})

test('ATM: los REST arman la consulta, mandan JSON y un error que no es JSON dice qué contestó', async (t) => {
  let contestar: () => Response = () => respuestaJson(PLANES)
  const pedidos = fetchFalso(t, () => contestar())
  const cliente = crearClienteAtm(CUENTA, { urlBase: 'https://atm.ejemplo' })

  assert.deepEqual(await cliente.get('get_plans', { usa: 'MARTINEZAD', seccion: '3', vendedor: '0956102698' }), PLANES)
  assert.equal(pedidos[0]!.url, 'https://atm.ejemplo/api/v1/get_plans?usa=MARTINEZAD&seccion=3&vendedor=0956102698')
  assert.equal(pedidos[0]!.metodo, 'GET')
  assert.equal(pedidos[0]!.headers.accept, 'application/json')

  contestar = () => respuestaJson(VENDEDORES)
  assert.deepEqual(await cliente.post('ws_vendedores', { usuario: 'MARTINEZAD', password: CLAVE }), VENDEDORES)
  assert.equal(pedidos[1]!.url, 'https://atm.ejemplo/api/v1/ws_vendedores')
  assert.equal(pedidos[1]!.metodo, 'POST')
  assert.equal(pedidos[1]!.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(pedidos[1]!.cuerpo), { usuario: 'MARTINEZAD', password: CLAVE })

  contestar = () => new Response('<html><body><h1>405 Method Not Allowed</h1></body></html>', { status: 405, headers: { 'content-type': 'text/html' } })
  await assert.rejects(
    cliente.post('ws_vendedores', {}),
    (error: unknown) => error instanceof ErrorDeAtm && error.status === 405 && error.message === 'ATM respondió 405 a ws_vendedores: 405 Method Not Allowed',
  )
  contestar = () => respuestaJson({ message: 'The given data was invalid.' }, 422)
  await assert.rejects(cliente.get('get_plans', {}), (error: unknown) => error instanceof ErrorDeAtm && error.message === 'ATM respondió 422 a get_plans: The given data was invalid.')
  contestar = () => new Response('mantenimiento', { status: 200 })
  await assert.rejects(cliente.get('get_plans', {}), (error: unknown) => error instanceof ErrorDeAtm && error.status === 200 && /get_plans: mantenimiento/.test(error.message))
})

// --- Vendedores y planes -------------------------------------------------------------------------------

test('ATM: la lista de vendedores, como la contesta ATM', async () => {
  assert.deepEqual(leerVendedores(VENDEDORES), [{ codigo: '0956112663', nombre: '12663 - MARTINEZ DANIEL ADRIAN', puedeInspeccionar: true }])
  assert.deepEqual(leerVendedores({ error: false, vendedores: [{ prodlargo: '' }, null, { prodlargo: '0956102698', inspeccion: 'N' }] }), [
    { codigo: '0956102698', nombre: '0956102698', puedeInspeccionar: false },
  ])
  assert.throws(
    () => leerVendedores({ error: true, errores: ['Usuario inválido'] }),
    (error: unknown) => error instanceof ErrorDeAtm && error.message === 'ATM no aceptó la cuenta: Usuario inválido.',
  )
  assert.throws(() => leerVendedores(['Usuario inválido']), /formato inesperado/)

  const pedidos: unknown[] = []
  const cliente = clienteFalso({
    post: async (ruta: string, cuerpo: unknown) => {
      pedidos.push([ruta, cuerpo])
      return VENDEDORES as never
    },
  })
  assert.equal((await vendedoresAtm(cliente))[0]?.codigo, '0956112663')
  assert.deepEqual(pedidos, [['ws_vendedores', { usuario: 'MARTINEZAD', password: CLAVE }]])
})

test('ATM: la lista de planes, y sus dos formas de decir que no', async () => {
  const planes = leerPlanes(PLANES)
  assert.equal(planes.length, 8)
  assert.deepEqual(planes[0], { codigo: '02', descripcion: 'ANUAL/MENSUAL', formaDePago: 'TARJETA', formaDePagoCodigo: 3 })
  assert.deepEqual(planes[2], { codigo: '22', descripcion: 'ANUAL/BIMESTRAL', formaDePago: 'EFVO', formaDePagoCodigo: 0 })
  // Un usuario que no existe: un array de textos, con 200.
  assert.throws(
    () => leerPlanes(['Error usuario: NOEXISTE no encontrado']),
    (error: unknown) => error instanceof ErrorDeAtm && error.message === 'ATM no devolvió los planes: Error usuario: NOEXISTE no encontrado.',
  )
  // Un parámetro mal (en mayúsculas, por ejemplo): la validación de Laravel.
  assert.throws(
    () => leerPlanes({ success: false, response: { usa: ['The usa field is required.'], seccion: ['The seccion field is required.'] } }),
    /^ErrorDeAtm: ATM no devolvió los planes: The usa field is required\. · The seccion field is required\.$/,
  )
  assert.throws(() => leerPlanes(null), /^ErrorDeAtm: ATM no devolvió los planes\.$/)

  const pedidos: unknown[] = []
  const cliente = clienteFalso({
    get: async (ruta: string, parametros: Record<string, string>) => {
      pedidos.push([ruta, parametros])
      return PLANES as never
    },
  })
  assert.equal((await planesAtm(cliente, 'MOTO', '0956102698')).length, 8)
  assert.deepEqual(pedidos, [['get_plans', { usa: 'MARTINEZAD', seccion: '4', vendedor: '0956102698' }]], 'en minúscula: con mayúsculas ATM no los reconoce')
})

// --- El pedido de cotización ---------------------------------------------------------------------------

function datosDeCotizacion(cambios: Partial<DatosDeCotizacionAtm> = {}): DatosDeCotizacionAtm {
  return {
    vendedor: '0956102698',
    plan: '02',
    persona: 'F',
    iva: 'CF',
    codigoIIBB: '',
    seccion: '3',
    codigoInfoAuto: '460711',
    anio: '2012',
    ceroKm: false,
    uso: '4262',
    codigoPostal: '1870',
    ajuste: 10,
    alarma: false,
    gnc: false,
    fecha: new Date('2026-10-09T15:00:00Z'),
    ...cambios,
  }
}

test('ATM: el pedido de un auto es el que ATM aceptó al probar, en el mismo orden', () => {
  assert.equal(
    armarPedidoDeCotizacion({ usuario: 'MARTINEZAD', clave: 'clave' }, datosDeCotizacion()),
    '<auto><usuario><usa>MARTINEZAD</usa><pass>clave</pass><fecha>09102026</fecha><vendedor>0956102698</vendedor><origen>WS</origen><plan>02</plan></usuario>' +
      '<asegurado><persona>F</persona><iva>CF</iva><codigo_iibb/></asegurado>' +
      '<bien><cod_infoauto>460711</cod_infoauto><anofab>2012</anofab><cerokm>N</cerokm><uso>4262</uso><codpostal>1870</codpostal><ajuste>10</ajuste>' +
      '<rastreo>N</rastreo><alarma>0</alarma><seccion>3</seccion><gnc>0</gnc></bien></auto>',
  )
})

test('ATM: el pedido manda sólo lo que corresponde a cada caso', () => {
  const cuenta = { usuario: 'MARTINEZAD', clave: 'a&b<c' }
  const pedido = (cambios: Partial<DatosDeCotizacionAtm>) => armarPedidoDeCotizacion(cuenta, datosDeCotizacion(cambios))

  // La clave se escapa: si no, un & o un < rompen el XML y ATM contesta «error inesperado».
  const conClave = leerXml(pedido({}))
  assert.deepEqual(conClave.hijos.map((h) => h.nombre), ['usuario', 'asegurado', 'bien'])
  assert.deepEqual(hijo(conClave, 'usuario')?.hijos.map((h) => h.nombre), ['usa', 'pass', 'fecha', 'vendedor', 'origen', 'plan'])
  assert.equal(textoDe(hijo(conClave, 'usuario'), 'pass'), 'a&b<c')
  assert.ok(pedido({}).includes('<pass>a&amp;b&lt;c</pass>'))

  // Bonificación: sin elegir (o en cero) no viaja, así ATM aplica la suya.
  assert.ok(!pedido({ bonificacion: undefined }).includes('bonificacion'))
  assert.ok(!pedido({ bonificacion: 0 }).includes('bonificacion'))
  assert.ok(pedido({ bonificacion: 15 }).includes('<codigo_iibb/><bonificacion>15</bonificacion></asegurado>'))
  assert.ok(pedido({ bonificacion: 12.5 }).includes('<bonificacion>12.50</bonificacion>'))

  // Inscripto: ingresos brutos con su código.
  assert.ok(pedido({ iva: 'IN', codigoIIBB: 'I0' }).includes('<iva>IN</iva><codigo_iibb>I0</codigo_iibb>'))

  // Moto: tipo de uso en vez de uso, y sin cláusula de ajuste (aunque venga).
  const moto = pedido({ seccion: '4', codigoInfoAuto: '9900131', anio: '2020', uso: undefined, tipoUso: '1', ajuste: 10 })
  assert.ok(moto.includes('<tipo_uso>1</tipo_uso>'))
  assert.ok(!moto.includes('<uso>') && !moto.includes('<ajuste>'))
  assert.ok(moto.includes('<seccion>4</seccion>'))
  // Auto: uso y cláusula, nunca tipo de uso; la cláusula en cero también viaja (es «sin cláusula»).
  assert.ok(!pedido({ tipoUso: '2' }).includes('tipo_uso'))
  assert.ok(pedido({ ajuste: 0 }).includes('<ajuste>0</ajuste>'))
  assert.ok(!pedido({ ajuste: undefined }).includes('<ajuste>'))

  // Rastreo: N si no tiene; si no, el código del equipo.
  assert.ok(pedido({ rastreo: undefined }).includes('<rastreo>N</rastreo>'))
  assert.ok(pedido({ rastreo: '' }).includes('<rastreo>N</rastreo>'))
  assert.ok(pedido({ rastreo: '7' }).includes('<rastreo>7</rastreo>'))

  // Suma, sub-código postal, 0 km, alarma y GNC.
  assert.ok(!pedido({}).includes('<suma>'))
  assert.ok(pedido({ sumaAsegurada: 21_800_000 }).includes('<cerokm>N</cerokm><suma>21800000</suma><uso>4262</uso>'))
  assert.ok(pedido({ subCodigoPostal: '2' }).includes('<codpostal>1870</codpostal><sub_cp>2</sub_cp>'))
  assert.ok(pedido({ ceroKm: true, alarma: true, gnc: true }).includes('<cerokm>S</cerokm>'))
  assert.ok(pedido({ alarma: true, gnc: true }).includes('<alarma>1</alarma><seccion>3</seccion><gnc>1</gnc>'))
})

test('ATM: la fecha del pedido es la de hoy en la Argentina, no la de UTC', () => {
  // 23:30 del 9 en Buenos Aires ya es el 10 en UTC: ATM rechaza una fecha que no sea la de su día.
  assert.equal(fechaParaAtm(new Date('2026-10-10T02:30:00Z')), '09102026')
  assert.equal(fechaParaAtm(new Date('2026-10-10T03:00:00Z')), '10102026')
  assert.equal(fechaParaAtm(new Date('2027-01-01T02:59:00Z')), '31122026')
  assert.match(fechaParaAtm(), /^\d{8}$/)
})

test('ATM: sinClave tapa la clave del pedido y numeroDeAtm lee los importes', () => {
  const pedido = armarPedidoDeCotizacion({ usuario: 'MARTINEZAD', clave: 'a&b<c' }, datosDeCotizacion())
  const tapado = sinClave(pedido)
  assert.ok(tapado.includes('<usa>MARTINEZAD</usa><pass>***</pass><fecha>'))
  assert.ok(!tapado.includes('a&amp;b'))
  assert.equal(sinClave('<pass>\nuno\n</pass><pass>dos</pass>'), '<pass>***</pass><pass>***</pass>')

  assert.equal(numeroDeAtm('89465.12'), 89465.12)
  assert.equal(numeroDeAtm('21800000.00'), 21_800_000)
  assert.equal(numeroDeAtm('1.234,56'), 1234.56)
  assert.equal(numeroDeAtm(' $ 1.234.567,5 '), 1_234_567.5)
  assert.equal(numeroDeAtm('1,234.56'), 1234.56)
  assert.equal(numeroDeAtm('01'), 1)
  assert.equal(numeroDeAtm(''), null)
  assert.equal(numeroDeAtm('   '), null)
  assert.equal(numeroDeAtm('abc'), null)
})

test('ATM: la respuesta real se lee entera: diez coberturas con su comisión, la suma y el uso', () => {
  const r = leerRespuestaDeCotizacion(resultadoDelSobre(METODO_COTIZAR, RESPUESTA_REAL))
  assert.equal(r.ok, true)
  assert.equal(r.operacion, '2645461')
  assert.deepEqual(r.mensajes, [])
  assert.equal(r.coberturas.length, 10)
  assert.deepEqual(
    r.coberturas.map((c) => c.codigo),
    ['A1', 'A0', 'B5', 'B1', 'B4', 'B0', 'C1', 'C0', 'C3', 'C2'],
  )
  assert.deepEqual(r.coberturas[0], {
    codigo: 'A1',
    descripcion: 'RESPONSABILIDAD CIVIL SIN ASISTENCIA',
    prima: 71815,
    premio: 89465.12,
    cuotas: 1,
    importeCuota: 89465.12,
    ajuste: '',
    formaDePago: 'TARJETA',
    plan: '02',
    comision: 10735.81,
    solicitud: '19517100',
  })
  assert.equal(r.coberturas[9]!.comision, 26959.97)
  assert.ok(r.coberturas.every((c) => c.premio > c.prima && c.comision !== null))
  assert.equal(r.suma, 21_800_000)
  assert.equal(r.uso, '0101')
  assert.equal(r.vehiculoBlack, false)
  // La cruda es para el detalle técnico: todo lo que vino, como objeto.
  const cruda = r.cruda as { cotizacion: { cobertura: unknown[] }; datos_cotiz: unknown }
  assert.equal(cruda.cotizacion.cobertura.length, 10)
  assert.deepEqual(cruda.datos_cotiz, { suma: '21800000.00', uso: '0101', vehiculoblack: 'NO' })
})

test('ATM: un rechazo trae cada motivo; sin <msg>, el texto suelto', () => {
  const rechazo = leerRespuestaDeCotizacion(leerXml(autoRechazado('Debe informar el uso', 'Vendedor inválido', '  ')))
  assert.equal(rechazo.ok, false)
  assert.equal(rechazo.operacion, '0')
  assert.deepEqual(rechazo.mensajes, ['Debe informar el uso', 'Vendedor inválido'])
  assert.deepEqual(rechazo.coberturas, [])
  assert.equal(rechazo.suma, null)
  assert.equal(rechazo.uso, '')

  const suelto = leerRespuestaDeCotizacion(leerXml('<auto><statusSuccess>FALSE</statusSuccess><statusText>Ha ocurrido un error inesperado</statusText></auto>'))
  assert.deepEqual(suelto.mensajes, ['Ha ocurrido un error inesperado'])

  const black = leerRespuestaDeCotizacion(leerXml(autoCotizado(COBERTURAS_REALES.slice(0, 1), { suma: '1.000.000,00', uso: '0101', vehiculoblack: 'SI' })))
  assert.equal(black.vehiculoBlack, true)
  assert.equal(black.suma, 1_000_000)
})

test('ATM: cotizarAtm manda el pedido con la clave y devuelve el pedido sin ella', async () => {
  const llamados: Array<[string, string]> = []
  const cliente = clienteFalso({
    soap: async (metodo: string, docIn: string) => {
      llamados.push([metodo, docIn])
      return resultadoDelSobre(metodo, RESPUESTA_REAL)
    },
  })
  const r = await cotizarAtm(cliente, datosDeCotizacion())
  assert.equal(llamados.length, 1)
  assert.equal(llamados[0]![0], 'AUTOS_Cotizar_PHP')
  assert.equal(textoDe(hijo(leerXml(llamados[0]![1]), 'usuario'), 'pass'), CLAVE)
  assert.ok(r.pedido.includes('<pass>***</pass>'))
  assert.ok(!r.pedido.includes('cl&amp;ve'))
  assert.equal(r.coberturas.length, 10)
})

// --- Las tablas: los archivos --------------------------------------------------------------------------

test('ATM: cada archivo se reconoce por el nombre de su tabla, sin confundir marcas con marca_modelo', () => {
  assert.equal(tablaDelArchivo('WS_AU_MARCA_MODELO.TXT'), 'ws_au_marca_modelo')
  assert.equal(tablaDelArchivo('ws_au_marcas.csv'), 'ws_au_marcas')
  assert.equal(tablaDelArchivo('ws_au_infoauto_20261009.txt'), 'ws_au_infoauto')
  assert.equal(tablaDelArchivo('C:\\Descargas\\ATM\\ws_au_localidades.txt'), 'ws_au_localidades')
  assert.equal(tablaDelArchivo('tablas/2026-10-09/ws-au-usos.txt'), 'ws_au_usos')
  assert.equal(tablaDelArchivo('WS AU RASTREO SATELITAL.zip'), 'ws_au_rastreo_satelital')
  assert.equal(tablaDelArchivo('ws_au_marcas/leeme.txt'), null, 'cuenta el nombre del archivo, no el de la carpeta')
  assert.equal(tablaDelArchivo('ws_au_accesorios.txt'), null)
  assert.equal(tablaDelArchivo('leeme.txt'), null)
})

test('ATM: los archivos se leen en UTF-8 (con o sin BOM) o, si no lo son, en Latin-1', () => {
  assert.equal(decodificar(Buffer.from('PIÑEYRO', 'utf8')), 'PIÑEYRO')
  assert.equal(decodificar(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('PIÑEYRO', 'utf8')])), 'PIÑEYRO')
  assert.equal(decodificar(Buffer.from([0x50, 0x49, 0xd1, 0x45, 0x59, 0x52, 0x4f])), 'PIÑEYRO')
})

test('ATM: el separador se adivina y los campos entre comillas o con coma decimal no se parten', () => {
  assert.deepEqual(partirLinea('"ROBO, INCENDIO";"21800000,50"; 3 ', ';'), ['ROBO, INCENDIO', '21800000,50', '3'])
  assert.deepEqual(partirLinea('"Dice ""hola""",2,', ','), ['Dice "hola"', '2', ''])
  assert.deepEqual(partirLinea('a|b', ';'), ['a|b'])
  assert.equal(separadorDe(['codigo;descripcion;suma', '1;A;1,5', '2;B;2,5']), ';', 'la coma decimal no le gana al punto y coma')
  assert.equal(separadorDe(['1|A|1,5', '2|B|2,5']), '|')
  assert.equal(separadorDe(['1\tA', '2\tB']), '\t')
  assert.equal(separadorDe(['1,A', '2,B']), ',')
  assert.equal(separadorDe(['"A;B",C', '"D;E",F']), ',', 'lo que está entre comillas no cuenta')
  assert.equal(separadorDe(['VOLKSWAGEN', 'HONDA']), null)
})

test('ATM: las tablas se leen con encabezado en ; | tabulador o coma, o sin encabezado en el orden del manual', () => {
  const esperada = [
    { codigo: '1', descripcion: 'VOLKSWAGEN', seccion: '3' },
    { codigo: '2', descripcion: 'HONDA', seccion: '4' },
  ]
  assert.deepEqual(leerFilas('Codigo;Descripcion;Seccion\r\n1;VOLKSWAGEN;3\r\n2;HONDA;4\r\n', 'ws_au_marcas'), esperada)
  assert.deepEqual(leerFilas('CODIGO|DESCRIPCIÓN|SECCION\n1|VOLKSWAGEN|3\n2|HONDA|4', 'ws_au_marcas'), esperada, 'en mayúsculas y con tilde')
  assert.deepEqual(leerFilas('codigo\tdescripcion\tseccion\n1\tVOLKSWAGEN\t3\n\n2\tHONDA\t4\n', 'ws_au_marcas'), esperada)
  assert.deepEqual(leerFilas('"Codigo","Descripcion","Seccion"\n"1","VOLKSWAGEN","3"\n"2","HONDA","4"', 'ws_au_marcas'), esperada)
  assert.deepEqual(leerFilas('\uFEFF1;VOLKSWAGEN;3\n2;HONDA;4', 'ws_au_marcas'), esperada, 'sin encabezado (y con BOM)')
  // Con encabezado, el orden de las columnas es el del archivo y lo que falta queda vacío.
  assert.deepEqual(leerFilas('seccion;codigo;descripcion\n3;1;VOLKSWAGEN\n4;2\n', 'ws_au_marcas'), [
    { seccion: '3', codigo: '1', descripcion: 'VOLKSWAGEN' },
    { seccion: '4', codigo: '2', descripcion: '' },
  ])
  // Los importes con coma decimal quedan como texto: los lee armarTablas.
  assert.deepEqual(leerFilas('tau_codia;tau_anioe;tau_pre01;tau_pre02\n0460711;2013;"23.000.000,00";21800000,50', 'ws_au_infoauto'), [
    { tau_codia: '0460711', tau_anioe: '2013', tau_pre01: '23.000.000,00', tau_pre02: '21800000,50' },
  ])
  // Sin encabezado, las columnas del manual.
  assert.deepEqual(leerFilas('1;VOLKSWAGEN;10;TIGUAN 2.0 TSI;0460711;4262;1', 'ws_au_marca_modelo'), [
    { cod_marca: '1', marca: 'VOLKSWAGEN', cod_modelo: '10', modelo: 'TIGUAN 2.0 TSI', tau_codia: '0460711', cod_uso: '4262', tipo_uso: '1' },
  ])
})

test('ATM: las tablas también se leen en JSON o en XML', () => {
  const esperada = [
    { codigo: '1', descripcion: 'VOLKSWAGEN', seccion: '3' },
    { codigo: '2', descripcion: 'HONDA', seccion: '4' },
  ]
  assert.deepEqual(
    leerFilas('[{"Codigo":"1","Descripcion":"VOLKSWAGEN","Seccion":3},{"Codigo":"2","Descripcion":"HONDA","Seccion":4}]', 'ws_au_marcas'),
    esperada,
  )
  assert.deepEqual(
    leerFilas('{"total":2,"data":[{"codigo":1,"descripcion":"VOLKSWAGEN","seccion":"3"},{"codigo":2,"descripcion":"HONDA","seccion":"4","otro":{"x":1}}]}', 'ws_au_marcas'),
    esperada,
    'la lista adentro de un objeto; lo que no es un valor suelto se ignora',
  )
  assert.deepEqual(
    leerFilas(
      '<?xml version="1.0" encoding="utf-8"?><ws_au_marcas><fila><Codigo>1</Codigo><Descripcion>VOLKSWAGEN</Descripcion><Seccion>3</Seccion></fila>' +
        '<fila><Codigo>2</Codigo><Descripcion>HONDA</Descripcion><Seccion>4</Seccion></fila></ws_au_marcas>',
      'ws_au_marcas',
    ),
    esperada,
  )
  assert.deepEqual(
    leerFilas(
      '<respuesta><filas><fila><codigo>1</codigo><descripcion>VOLKSWAGEN</descripcion><seccion>3</seccion></fila>' +
        '<fila><codigo>2</codigo><descripcion>HONDA</descripcion><seccion>4</seccion></fila></filas></respuesta>',
      'ws_au_marcas',
    ),
    esperada,
    'con un envoltorio más',
  )
  assert.deepEqual(leerFilas('<tabla><fila><codigo>1</codigo><descripcion>VOLKSWAGEN</descripcion></fila></tabla>', 'ws_au_marcas'), [
    { codigo: '1', descripcion: 'VOLKSWAGEN' },
  ])
})

test('ATM: una tabla que no se puede leer dice por qué', () => {
  assert.throws(
    () => leerFilas('1;VOLKSWAGEN;10;TIGUAN', 'ws_au_marca_modelo'),
    (error: unknown) =>
      error instanceof FormatoDeTablaNoReconocido && error.message === 'no trae encabezado y tiene menos columnas (4) que las del manual (7)',
  )
  assert.throws(() => leerFilas('VOLKSWAGEN\nHONDA', 'ws_au_marcas'), /no se encontró el separador/)
  assert.throws(() => leerFilas('[{"codigo":', 'ws_au_marcas'), /parece JSON pero no se puede leer/)
  assert.throws(() => leerFilas('{"total":0}', 'ws_au_marcas'), /el JSON no trae una lista de filas/)
  assert.throws(() => leerFilas('<tabla><fila></tabla>', 'ws_au_marcas'), /parece XML pero no se puede leer/)
  assert.deepEqual(leerFilas('  \r\n ', 'ws_au_marcas'), [])
})

test('ATM: las tablas pueden venir en un .zip (sin comprimir o con deflate) o en un .gz', () => {
  const iva = 'codigo;descripcion\nCF;CONSUMIDOR FINAL\n'
  const zip = armarZip([
    { nombre: 'tablas/', bytes: Buffer.alloc(0) },
    { nombre: 'tablas/WS_AU_MARCAS.txt', bytes: Buffer.from(MARCAS) },
    { nombre: 'tablas/ws_au_usos.txt', bytes: Buffer.from(USOS), metodo: 8 },
    { nombre: 'ws_au_iva.txt.gz', bytes: gzipSync(iva) },
  ])
  const adentro = archivosDelZip(zip)
  assert.deepEqual(
    adentro.map((a) => a.nombre),
    ['tablas/WS_AU_MARCAS.txt', 'tablas/ws_au_usos.txt', 'ws_au_iva.txt.gz'],
    'sin la carpeta',
  )
  assert.equal(adentro[0]!.bytes.toString('utf8'), MARCAS)
  assert.equal(adentro[1]!.bytes.toString('utf8'), USOS)

  // Expandido: el .gz de adentro del .zip también se abre.
  const expandidos = expandirArchivo({ nombre: 'tablas.zip', bytes: zip })
  assert.deepEqual(
    expandidos.map((a) => a.nombre),
    ['tablas/WS_AU_MARCAS.txt', 'tablas/ws_au_usos.txt', 'ws_au_iva.txt'],
  )
  assert.equal(expandidos[2]!.bytes.toString('utf8'), iva)

  assert.deepEqual(
    expandirArchivo({ nombre: 'ws_au_localidades.TXT.GZ', bytes: gzipSync(LOCALIDADES) }).map((a) => [a.nombre, a.bytes.toString('utf8')]),
    [['ws_au_localidades.TXT', LOCALIDADES]],
  )
  const suelto = archivo('ws_au_usos.txt', USOS)
  assert.deepEqual(expandirArchivo(suelto), [suelto])

  assert.throws(() => expandirArchivo({ nombre: 'roto.zip', bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]) }), /\.zip está dañado/)
  assert.throws(() => archivosDelZip(armarZip([{ nombre: 'ws_au_usos.txt', bytes: Buffer.from(USOS), metodo: 12 }])), /compresión que no se puede leer \(ws_au_usos\.txt\)/)
})

// --- Las tablas: el catálogo ---------------------------------------------------------------------------

test('ATM: las sumas de InfoAuto van del año de la fila para atrás, sin los años en cero', () => {
  const sumas = sumasDeInfoAuto({ tau_anioe: '2026', tau_pre01: '30000000,00', tau_pre02: '0', tau_pre03: '25.000.000,50', tau_pre04: '', tau_pre30: '1000' })
  assert.deepEqual([...sumas], [
    [2026, 30_000_000],
    [2024, 25_000_000.5],
    [1997, 1000],
  ])
  assert.equal(sumasDeInfoAuto({ tau_anioe: '', tau_pre01: '1000' }).size, 0)
  assert.equal(sumasDeInfoAuto({ tau_anioe: '26', tau_pre01: '1000' }).size, 0)
})

test('ATM: el catálogo junta marcas y modelos con InfoAuto y las marcas por código, sin importar los ceros', () => {
  const tablas = armarTablas({
    ws_au_marcas: [
      { codigo: '001', descripcion: 'VOLKSWAGEN', seccion: '03' },
      { codigo: '2', descripcion: 'HONDA', seccion: '4' },
    ],
    ws_au_marca_modelo: [
      { cod_marca: '1', marca: 'VOLKSWAGEN', cod_modelo: '10', modelo: 'TIGUAN 2.0 TSI', tau_codia: '0460711', cod_uso: '4262', tipo_uso: '1' },
      { cod_marca: '1', marca: 'VOLKSWAGEN', cod_modelo: '10', modelo: 'TIGUAN 2.0 TSI', tau_codia: '460711', cod_uso: '4263', tipo_uso: '02' },
      { cod_marca: '1', marca: 'VOLKSWAGEN', cod_modelo: '10', modelo: 'TIGUAN 2.0 TSI', tau_codia: '460711', cod_uso: '4262', tipo_uso: '1' },
      { cod_marca: '2', marca: 'HONDA', cod_modelo: '20', modelo: 'CG 150 TITAN', tau_codia: '9900131', cod_uso: '', tipo_uso: '1' },
      { cod_marca: '9', marca: '', cod_modelo: '', modelo: '', tau_codia: '123', cod_uso: '1', tipo_uso: '1' },
      { cod_marca: '1', marca: 'VOLKSWAGEN', cod_modelo: '13', modelo: 'SIN CODIGO', tau_codia: '' },
    ],
    ws_au_infoauto: [
      { tau_marca: 'VOLKSWAGEN', tau_model: 'TIGUAN 2.0 TSI', tau_codia: '460711', tau_anioe: '2013', tau_pre01: '23000000,00', tau_pre02: '21800000.00' },
      { tau_marca: 'FORD', tau_model: 'KA 1.5 S', tau_codia: '0170001', tau_anioe: '2020', tau_pre01: '9000000' },
      { tau_marca: 'Volkswagen', tau_model: 'AMAROK 2.0', tau_codia: '460999', tau_anioe: '2020', tau_pre01: '30000000' },
    ],
    ws_au_localidades: [
      { codpos: '1870', localidad: 'AVELLANEDA', provincia: 'BUENOS AIRES', codpro: '1', subcodpos: '1' },
      { codpos: '870', localidad: 'VILLA X', provincia: 'MENDOZA', codpro: '12', subcodpos: '' },
      { codpos: 'ABCD', localidad: 'NO', provincia: '', codpro: '', subcodpos: '' },
      { codpos: '1871', localidad: '', provincia: '', codpro: '', subcodpos: '' },
    ],
    ws_au_usos: [
      { codigo: '4262', descripcion: 'PARTICULAR' },
      { codigo: '', descripcion: 'SIN CÓDIGO' },
    ],
    ws_au_iva: [{ codigo: 'CF', descripcion: 'CONSUMIDOR FINAL' }],
  })

  assert.deepEqual(
    tablas.vehiculos.map((v) => v.codigoInfoAuto),
    ['460711', '9900131', '170001', '460999'],
    'las de InfoAuto que no están en marcas y modelos también; las sin marca o sin código, no',
  )
  const tiguan = tablas.vehiculos[0]!
  assert.equal(tiguan.marca, 'VOLKSWAGEN')
  assert.equal(tiguan.seccion, '3')
  assert.deepEqual(tiguan.usos, [
    { codigo: '4262', tipoUso: '1' },
    { codigo: '4263', tipoUso: '2' },
  ])
  assert.deepEqual([...(tiguan.sumas ?? [])], [
    [2013, 23_000_000],
    [2012, 21_800_000],
  ])
  const honda = tablas.vehiculos[1]!
  assert.equal(honda.seccion, '4')
  assert.deepEqual(honda.usos, [])
  assert.equal(honda.sumas, null, 'sin fila de InfoAuto no se sabe la suma')
  const ford = tablas.vehiculos[2]!
  assert.deepEqual([ford.marca, ford.modelo, ford.seccion, ford.usos], ['FORD', 'KA 1.5 S', null, []])

  assert.deepEqual(tablas.localidades, [
    { codigoPostal: '1870', subCodigoPostal: '1', localidad: 'AVELLANEDA', provincia: 'BUENOS AIRES' },
    { codigoPostal: '0870', subCodigoPostal: '', localidad: 'VILLA X', provincia: 'MENDOZA' },
  ])
  assert.deepEqual(tablas.usos, [{ codigo: '4262', descripcion: 'PARTICULAR' }])
  assert.deepEqual(tablas.ivas, [{ codigo: 'CF', descripcion: 'CONSUMIDOR FINAL' }])
  assert.deepEqual([tablas.rastreos, tablas.personas], [[], []])
  assert.equal(codigoSinCeros(' 0460711 '), '460711')
  assert.equal(codigoSinCeros('A01'), 'A01')
  assert.equal(codigoSinCeros(undefined), '')

  // Marcas por sección: las que no dicen sección valen para las dos; sin repetir por mayúsculas.
  assert.deepEqual(marcasDeAtm(tablas, '3'), ['FORD', 'VOLKSWAGEN'])
  assert.deepEqual(marcasDeAtm(tablas, '4'), ['FORD', 'HONDA', 'Volkswagen'], 'para motos, la Volkswagen que no dice sección')

  // Versiones: de esa marca y sección y, si se saben las sumas, sólo las que ATM tiene para ese año.
  const versiones = (seccion: '3' | '4', marca: string, anio: number) => versionesDeAtm(tablas, seccion, marca, anio).map((v) => v.modelo)
  assert.deepEqual(versiones('3', 'volkswagen', 2012), ['TIGUAN 2.0 TSI'])
  assert.deepEqual(versiones('3', 'VOLKSWAGEN', 2020), ['AMAROK 2.0'])
  assert.deepEqual(versiones('3', 'VOLKSWAGEN', 2005), [])
  assert.deepEqual(versiones('3', 'HONDA', 2020), [], 'una marca de motos no tiene versiones de autos')
  assert.deepEqual(versiones('4', 'Honda', 1990), ['CG 150 TITAN'], 'sin sumas, cualquier año')

  assert.deepEqual(
    localidadesDeAtm(tablas, '1870').map((l) => l.localidad),
    ['AVELLANEDA'],
  )
  assert.equal(localidadesDeAtm(tablas, '0870').length, 1)
  assert.deepEqual(localidadesDeAtm(tablas, '9999'), [])
})

// --- Las tablas en disco y el FTP ----------------------------------------------------------------------

test('ATM: guardar tablas deja los archivos y el estado de cada tabla, con su error si no se pudo leer', (t) => {
  const carpeta = carpetaDeTablas(t)
  const estado = guardarTablas(
    'produccion',
    [
      archivo('WS_AU_MARCA_MODELO.TXT', MARCA_MODELO),
      archivo('ws_au_infoauto.csv', INFOAUTO),
      archivo('ws_au_localidades.txt', '1870;AVELLANEDA'),
      archivo('LEEME.txt', 'estas son las tablas de hoy'),
    ],
    'ftp',
    true,
  )
  assert.equal(estado.ambiente, 'produccion')
  assert.equal(estado.origen, 'ftp')
  assert.ok(estado.bajadasEn && Date.now() - new Date(estado.bajadasEn).getTime() < 60_000)
  assert.equal(estado.ultimoError, null)
  assert.equal(estado.vehiculos, 4)
  assert.equal(estado.listasParaCotizar, true)
  const porTabla = Object.fromEntries(estado.tablas.map((tabla) => [tabla.tabla, tabla]))
  assert.equal(estado.tablas.length, 8, 'todas las tablas, aunque no hayan venido')
  assert.deepEqual(
    [porTabla.ws_au_marca_modelo?.archivo, porTabla.ws_au_marca_modelo?.filas, porTabla.ws_au_marca_modelo?.error, porTabla.ws_au_marca_modelo?.necesaria],
    ['WS_AU_MARCA_MODELO.TXT', 5, null, true],
  )
  assert.deepEqual([porTabla.ws_au_infoauto?.filas, porTabla.ws_au_infoauto?.necesaria], [4, true])
  assert.equal(porTabla.ws_au_localidades?.filas, null)
  assert.match(porTabla.ws_au_localidades?.error ?? '', /no trae encabezado/)
  assert.equal(porTabla.ws_au_localidades?.necesaria, false)
  assert.deepEqual([porTabla.ws_au_usos?.archivo, porTabla.ws_au_usos?.filas, porTabla.ws_au_usos?.error], [null, null, null])

  assert.deepEqual(archivosEnDisco('produccion'), [
    'estado.json',
    'ws_au_infoauto__ws_au_infoauto.csv',
    'ws_au_localidades__ws_au_localidades.txt',
    'ws_au_marca_modelo__WS_AU_MARCA_MODELO.TXT',
  ])
  assert.deepEqual(readdirSync(carpeta), ['produccion'], 'sin carpetas a medio cambiar')
  assert.deepEqual(estadoDeTablasAtm('produccion'), estado)
  // El otro ambiente no tiene nada.
  const desarrollo = estadoDeTablasAtm('desarrollo')
  assert.deepEqual([desarrollo.bajadasEn, desarrollo.origen, desarrollo.vehiculos, desarrollo.listasParaCotizar], [null, null, 0, false])
  assert.equal(tablasEnDisco('desarrollo'), null)
})

test('ATM: importar archivos suma a lo que había; bajar del FTP lo reemplaza todo', (t) => {
  carpetaDeTablas(t)
  guardarTablas('produccion', [archivo('ws_au_marca_modelo.txt', MARCA_MODELO), archivo('ws_au_infoauto.txt', INFOAUTO)], 'archivos', false)
  const sumadas = guardarTablas('produccion', [archivo('ws_au_localidades.txt', LOCALIDADES)], 'archivos', false)
  const conArchivo = (estado: typeof sumadas) => estado.tablas.filter((tabla) => tabla.archivo).map((tabla) => tabla.tabla)
  assert.deepEqual(conArchivo(sumadas), ['ws_au_marca_modelo', 'ws_au_infoauto', 'ws_au_localidades'])
  assert.equal(sumadas.origen, 'archivos')
  assert.equal(tablasEnDisco('produccion')?.localidades.length, 4)
  assert.equal(tablasEnDisco('produccion')?.vehiculos.length, 4)

  // Una de nuevo pisa sólo ésa.
  const pisada = guardarTablas('produccion', [archivo('ws_au_infoauto_2.txt', INFOAUTO.split('\r\n').slice(0, 2).join('\n'))], 'archivos', false)
  assert.equal(pisada.tablas.find((tabla) => tabla.tabla === 'ws_au_infoauto')?.filas, 1)
  assert.equal(pisada.tablas.find((tabla) => tabla.tabla === 'ws_au_marca_modelo')?.filas, 5)

  const reemplazadas = guardarTablas('produccion', [archivo('ws_au_marca_modelo.txt', MARCA_MODELO)], 'ftp', true)
  assert.deepEqual(conArchivo(reemplazadas), ['ws_au_marca_modelo'])
  assert.equal(reemplazadas.origen, 'ftp')
  assert.deepEqual(archivosEnDisco('produccion'), ['estado.json', 'ws_au_marca_modelo__ws_au_marca_modelo.txt'])
  assert.deepEqual(tablasEnDisco('produccion')?.localidades, [])
})

test('ATM: importar tablas desde archivos de la computadora, sueltos, en .zip o en .gz', (t) => {
  carpetaDeTablas(t)
  const origen = mkdtempSync(path.join(tmpdir(), 'dm-atm-origen-'))
  t.after(() => rmSync(origen, { recursive: true, force: true }))
  const zip = path.join(origen, 'tablas_atm.zip')
  writeFileSync(
    zip,
    armarZip([
      { nombre: 'tablas/ws_au_marca_modelo.txt', bytes: Buffer.from(MARCA_MODELO), metodo: 8 },
      { nombre: 'tablas/ws_au_marcas.txt', bytes: Buffer.from(MARCAS) },
    ]),
  )
  const gz = path.join(origen, 'ws_au_infoauto.txt.gz')
  writeFileSync(gz, gzipSync(INFOAUTO))
  const suelto = path.join(origen, 'WS_AU_LOCALIDADES.csv')
  // Latin-1, como lo guardaría un sistema viejo.
  writeFileSync(suelto, Buffer.from(LOCALIDADES, 'latin1'))

  const estado = importarTablasAtm('produccion', [zip, gz, suelto])
  assert.equal(estado.origen, 'archivos')
  const porTabla = Object.fromEntries(estado.tablas.map((tabla) => [tabla.tabla, tabla]))
  assert.deepEqual(
    [porTabla.ws_au_marca_modelo?.archivo, porTabla.ws_au_marca_modelo?.filas],
    ['tablas/ws_au_marca_modelo.txt', 5],
  )
  assert.deepEqual([porTabla.ws_au_marcas?.filas, porTabla.ws_au_infoauto?.filas, porTabla.ws_au_localidades?.filas], [2, 4, 4])
  assert.equal(porTabla.ws_au_infoauto?.archivo, 'ws_au_infoauto.txt')
  assert.equal(estado.listasParaCotizar, true)
  assert.ok(tablasEnDisco('produccion')?.localidades.some((l) => l.localidad === 'PIÑEYRO'))
  assert.equal(tablasEnDisco('produccion')?.vehiculos.find((v) => v.codigoInfoAuto === '9900131')?.seccion, '4')
})

test('ATM: importar archivos que no son tablas lo dice y deja las de antes', (t) => {
  carpetaDeTablas(t)
  guardarTablas('produccion', TABLAS_DE_PRUEBA, 'ftp', true)
  const antes = estadoDeTablasAtm('produccion')
  const origen = mkdtempSync(path.join(tmpdir(), 'dm-atm-origen-'))
  t.after(() => rmSync(origen, { recursive: true, force: true }))
  const notas = path.join(origen, 'notas.txt')
  writeFileSync(notas, 'nada que ver')
  const roto = path.join(origen, 'ws_au_marcas.zip')
  writeFileSync(roto, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]))

  assert.throws(
    () => importarTablasAtm('produccion', [notas]),
    (error: unknown) => error instanceof ErrorDeAtm && /^Ninguno de los archivos es una tabla de ATM \(se buscan nombres como «ws_au_marca_modelo»/.test(error.message),
  )
  assert.throws(() => importarTablasAtm('produccion', [notas, roto]), /Ninguno de los archivos es una tabla de ATM.*ws_au_marcas\.zip: El \.zip está dañado/)
  assert.throws(() => importarTablasAtm('produccion', [path.join(origen, 'no-existe.txt')]), /No se pudo leer no-existe\.txt/)
  assert.deepEqual(estadoDeTablasAtm('produccion'), antes)
})

const CUENTA_FTP = { ambiente: 'produccion' as const, usuario: 'MARTINEZAD', clave: CLAVE }

/** Un FTP de mentira: cuenta cuántas veces se lo usó y contesta lo que diga `contestar`. */
function ftpFalso(contestar: () => ArchivoSuelto[]): { veces: () => number } {
  let veces = 0
  usarFtpDeAtmDePrueba(async (cuenta) => {
    veces++
    assert.deepEqual(cuenta, CUENTA_FTP)
    return contestar()
  })
  return { veces: () => veces }
}

test('ATM: con tablas de hoy se cotiza sin ir al FTP; viejas o sin tablas, primero se bajan', async (t) => {
  const carpeta = carpetaDeTablas(t)
  const ftp = ftpFalso(() => [...TABLAS_DE_PRUEBA, archivo('ws_au_iva.txt', 'codigo;descripcion\nCF;CONSUMIDOR FINAL')])

  // Sin tablas: se bajan.
  const primera = await tablasParaCotizar(CUENTA_FTP)
  assert.equal(ftp.veces(), 1)
  assert.equal(primera.aviso, null)
  assert.equal(primera.tablas.vehiculos.length, 4)
  assert.equal(estadoDeTablasAtm('produccion').origen, 'ftp')

  // De hoy: no.
  await tablasParaCotizar(CUENTA_FTP)
  assert.equal(ftp.veces(), 1)

  // De anteayer: sí, y quedan las nuevas.
  envejecer(carpeta, 2)
  const vieja = estadoDeTablasAtm('produccion').bajadasEn
  const renovada = await tablasParaCotizar(CUENTA_FTP)
  assert.equal(ftp.veces(), 2)
  assert.equal(renovada.aviso, null)
  assert.notEqual(estadoDeTablasAtm('produccion').bajadasEn, vieja)
  assert.deepEqual(renovada.tablas.ivas, [{ codigo: 'CF', descripcion: 'CONSUMIDOR FINAL' }])
})

test('ATM: si el FTP falla, se cotiza con las tablas viejas avisando, y no se reintenta en cada cotización', async (t) => {
  const carpeta = carpetaDeTablas(t)
  guardarTablas('produccion', TABLAS_DE_PRUEBA, 'ftp', true)
  envejecer(carpeta, 3)
  const motivo = 'No se pudo conectar al FTP de ATM (wsatm.atmseguros.com.ar, puerto 2113): connect ETIMEDOUT.'
  const ftp = ftpFalso(() => {
    throw new ErrorDeAtm(motivo, true)
  })

  const conAviso = await tablasParaCotizar(CUENTA_FTP)
  assert.equal(ftp.veces(), 1)
  assert.equal(conAviso.tablas.vehiculos.length, 4)
  assert.match(conAviso.aviso ?? '', /^Se cotizó con las tablas de ATM del \d{2}\/\d{2}\/\d{4}: no se pudieron actualizar \(No se pudo conectar al FTP de ATM/)
  assert.equal(estadoDeTablasAtm('produccion').ultimoError, motivo, 'API Aseguradoras → ATM muestra la falla')

  // La siguiente cotización no espera otra vez al FTP, pero sigue avisando.
  const otra = await tablasParaCotizar(CUENTA_FTP)
  assert.equal(ftp.veces(), 1)
  assert.equal(otra.aviso, conAviso.aviso)

  // «Actualizar tablas» sí prueba de nuevo; si anda, la falla se olvida.
  await assert.rejects(actualizarTablasAtm(CUENTA_FTP), (error: unknown) => error instanceof ErrorDeAtm && error.message === motivo)
  assert.equal(ftp.veces(), 2)
  ftpFalso(() => TABLAS_DE_PRUEBA)
  const estado = await actualizarTablasAtm(CUENTA_FTP)
  assert.equal(estado.ultimoError, null)
  assert.equal((await tablasParaCotizar(CUENTA_FTP)).aviso, null)
})

test('ATM: sin tablas y con el FTP caído no se puede cotizar, y el error dice dónde se arregla', async (t) => {
  carpetaDeTablas(t)
  const ftp = ftpFalso(() => {
    throw new ErrorDeAtm('El FTP de ATM no aceptó el usuario y la clave (530 Login incorrect.).', false)
  })
  const esperado = (error: unknown) =>
    error instanceof ErrorDeAtm &&
    /^Faltan las tablas de vehículos de ATM/.test(error.message) &&
    /530 Login incorrect/.test(error.message) &&
    /API Aseguradoras → ATM \(«Actualizar tablas» o «Importar desde archivos»\)/.test(error.message)
  await assert.rejects(tablasParaCotizar(CUENTA_FTP), esperado)
  await assert.rejects(tablasParaCotizar(CUENTA_FTP), esperado)
  assert.equal(ftp.veces(), 1, 'después de una falla no se reintenta solo por media hora')
})

test('ATM: unas tablas de vehículos que no se pueden leer no dejan cotizar y dicen por qué', async (t) => {
  carpetaDeTablas(t)
  const ftp = ftpFalso(() => [])
  guardarTablas('produccion', [archivo('ws_au_marca_modelo.txt', '1;VOLKSWAGEN;10;TIGUAN')], 'ftp', true)
  await assert.rejects(tablasParaCotizar(CUENTA_FTP), /No se pudieron leer: ws_au_marca_modelo: no trae encabezado/)
  assert.equal(ftp.veces(), 0, 'son de hoy: bajarlas de nuevo daría lo mismo')
})

test('ATM: dos pedidos de «Actualizar tablas» a la vez bajan una sola vez', async (t) => {
  carpetaDeTablas(t)
  const ftp = ftpFalso(() => TABLAS_DE_PRUEBA)
  const [una, otra] = await Promise.all([actualizarTablasAtm(CUENTA_FTP), actualizarTablasAtm(CUENTA_FTP)])
  assert.equal(ftp.veces(), 1)
  assert.deepEqual(una, otra)
})

// --- El adaptador: las decisiones ----------------------------------------------------------------------

test('ATM: el plan por defecto es el de la forma de pago elegida que factura más seguido', () => {
  const planes = leerPlanes(PLANES)
  assert.equal(planPorDefecto(planes, 'TARJETA')?.codigo, '02')
  assert.equal(planPorDefecto(planes, 'DEBITO')?.codigo, '11')
  // En efectivo: el bimestral, no el bimestral «1 PAGO» (que paga el período entero de una vez) ni el trimestral.
  assert.equal(planPorDefecto(planes, 'EFECTIVO')?.codigo, '22')
  assert.equal(planPorDefecto(planes.filter((p) => p.codigo !== '22'), 'EFECTIVO')?.codigo, '03', 'sin el 22, el bimestral en un pago le gana al trimestral')
  // Sin planes de esa forma de pago, el que factura más seguido de todos.
  assert.equal(planPorDefecto(planes.filter((p) => p.formaDePago !== 'CBU'), 'DEBITO')?.codigo, '02')
  assert.equal(planPorDefecto([], 'TARJETA'), undefined)
  assert.equal(textoDePlan(planes[0]!), 'ANUAL/MENSUAL · tarjeta de crédito (plan 02)')
  assert.equal(textoDePlan(planes[2]!), 'ANUAL/BIMESTRAL · efectivo / cupón (plan 22)')
})

test('ATM: IVA e ingresos brutos con los códigos que ATM acepta', () => {
  assert.deepEqual(IVA_ATM, { CONSUMIDOR_FINAL: 'CF', RESPONSABLE_INSCRIPTO: 'IN', MONOTRIBUTO: 'MT', EXENTO: 'EX' })
  assert.equal(iibbPorDefecto('CF'), '')
  assert.equal(iibbPorDefecto('IN'), 'I0')
  assert.equal(iibbPorDefecto('MT'), 'I4')
  assert.equal(iibbPorDefecto('EX'), 'I2')
  assert.deepEqual(opcionesDeIibb('CF'), [])
  assert.deepEqual(opcionesDeIibb(''), [])
  assert.deepEqual(opcionesDeIibb('MT').map((o) => o.codigo), ['I0', 'I1', 'I2', 'I4'])
  assert.deepEqual(opcionesDeIibb('IN').map((o) => o.codigo), ['I0', 'I1', 'I2'], 'régimen simplificado es sólo para monotributo')
  assert.deepEqual(opcionesDeIibb('EX').map((o) => o.codigo), ['I0', 'I1', 'I2'])
})

test('ATM: el uso por defecto sale del vehículo y, si no lo dice, del nombre del uso', () => {
  const vehiculo = (usos: VehiculoAtm['usos']): VehiculoAtm => ({ codigoInfoAuto: '460711', marca: 'VW', modelo: 'TIGUAN', seccion: '3', usos, sumas: null })
  const usos = [
    { codigo: '4262', descripcion: 'PARTICULAR' },
    { codigo: '4263', descripcion: 'COMERCIAL / TRABAJO' },
  ]
  const conTipo = vehiculo([
    { codigo: '4262', tipoUso: '1' },
    { codigo: '4263', tipoUso: '2' },
  ])
  assert.equal(usoPorDefecto(conTipo, usos, 'PARTICULAR'), '4262')
  assert.equal(usoPorDefecto(conTipo, usos, 'COMERCIAL'), '4263')
  // Sin tipo de uso en la tabla: por el nombre del uso.
  const sinTipo = vehiculo([
    { codigo: '4262', tipoUso: '' },
    { codigo: '4263', tipoUso: '' },
  ])
  assert.equal(usoPorDefecto(sinTipo, usos, 'COMERCIAL'), '4263')
  // Sin usos del vehículo: los de la tabla de usos.
  assert.equal(usoPorDefecto(null, usos, 'PARTICULAR'), '4262')
  assert.equal(usoPorDefecto(vehiculo([]), usos, 'COMERCIAL'), '4263')
  // Uno solo que no dice nada: ése. Varios que no dicen nada: no se adivina.
  assert.equal(usoPorDefecto(vehiculo([{ codigo: '99', tipoUso: '' }]), [], 'COMERCIAL'), '99')
  assert.equal(usoPorDefecto(null, [{ codigo: '1', descripcion: 'A' }, { codigo: '2', descripcion: 'B' }], 'PARTICULAR'), '')
})

test('ATM: las cuotas y los consejos para los rechazos', () => {
  const cobertura = (cuotas: number, importeCuota: number): CoberturaAtm => ({
    codigo: 'A0',
    descripcion: 'RESPONSABILIDAD CIVIL',
    prima: 1,
    premio: 1,
    cuotas,
    importeCuota,
    ajuste: '',
    formaDePago: 'TARJETA',
    plan: '02',
    comision: null,
    solicitud: '',
  })
  assert.deepEqual(cuotasDe(cobertura(1, 89465.12)), { primeraCuota: 89465.12, cuota: null })
  assert.deepEqual(cuotasDe(cobertura(6, 15000)), { primeraCuota: 15000, cuota: 15000 })
  assert.deepEqual(cuotasDe(cobertura(3, 0)), { primeraCuota: null, cuota: null })

  const consejo = (mensaje: string) => consejoParaElRechazo(mensaje, '2012')
  assert.equal(consejo('La relación vehículo - año de fabricación no es válida'), 'ATM no tiene esa versión para el año 2012: probá con otra versión en los ajustes de ATM.')
  assert.match(consejo('ATM no tiene registrado el vehiculo que intenta cotizar') ?? '', /otra versión o con otro uso/)
  assert.match(consejo('Usuario Inexistente') ?? '', /usuario y la clave en API Aseguradoras/)
  assert.match(consejo('Vendedor inválido') ?? '', /código de vendedor/)
  assert.match(consejo('La condición impositiva ingresada no es válida') ?? '', /Ingresos brutos/)
  assert.match(consejo('La combinación de Condición de IVA y Tipo de Persona es incorrecta') ?? '', /persona jurídica no puede ser consumidor final/)
  assert.match(consejo('No existen Coberturas/Productos habilitados para cotizar') ?? '', /código postal/)
  assert.equal(consejo('Ha ocurrido un error inesperado'), null)
})

// --- El adaptador: de punta a punta, con ATM de mentira -------------------------------------------------

test('ATM: sin la cuenta cargada no está disponible y no sale a internet', async (t) => {
  usarCuentaDeAtmDePrueba(null)
  const pedidos = fetchFalso(t, () => respuestaJson({}))
  assert.equal(atm.noDisponible(), 'Falta cargar la cuenta de ATM en API Aseguradoras → ATM.')
  await assert.rejects(atm.cotizar(resuelta(), {}), (error: unknown) => error instanceof ErrorDeAtm && /Falta cargar la cuenta/.test(error.message))
  assert.deepEqual(await atm.localidades?.('AUTO', '1870'), [])
  const r = await cotizarEnAseguradora({ aseguradora: 'ATM', solicitud: solicitud(), elegidos: {} }, true)
  assert.equal(r.estado, 'NO_APLICA')
  assert.equal(r.mensaje, 'Falta cargar la cuenta de ATM en API Aseguradoras → ATM.')
  assert.equal(pedidos.length, 0)
})

test('ATM: el multicotizador lista ATM junto a Galeno, para autos y motos y sin emitir', (t) => {
  t.after(() => usarCuentaDeAtmDePrueba(null))
  usarCuentaDeAtmDePrueba(CUENTA)
  const lista = aseguradorasDelMulticotizador()
  assert.deepEqual(
    lista.map((a) => a.id),
    ['GALENO', 'ATM'],
  )
  assert.deepEqual(lista[1], { id: ID_ATM, nombre: 'ATM', tipos: ['AUTO', 'MOTO'], emite: false, noDisponible: null })
  usarCuentaDeAtmDePrueba(null)
  assert.equal(aseguradorasDelMulticotizador()[1]?.noDisponible, 'Falta cargar la cuenta de ATM en API Aseguradoras → ATM.')
})

test('ATM: cotiza un auto de punta a punta y devuelve sus coberturas en la forma común', async (t) => {
  const falso = atmFalso(t)
  const r = await atm.cotizar(resuelta(), {})
  assert.equal(r.estado, 'OK', r.mensaje ?? '')

  // Lo que se le pidió a ATM: la cuenta, el vendedor de la cuenta y el plan de tarjeta más corto.
  assert.deepEqual(
    falso.pedidos.map((p) => `${p.metodo} ${p.url}`),
    [
      'POST https://wsatm.atmseguros.com.ar/api/v1/ws_vendedores',
      'GET https://wsatm.atmseguros.com.ar/api/v1/get_plans?usa=MARTINEZAD&seccion=3&vendedor=0956112663',
      'POST https://wsatm.atmseguros.com.ar/index.php/soap',
    ],
  )
  assert.deepEqual(JSON.parse(falso.pedidos[0]!.cuerpo), { usuario: 'MARTINEZAD', password: CLAVE })
  assert.equal(falso.pedidos[2]!.headers.SOAPAction, '"http://tempuri.org/AUTOS_Cotizar_PHP"')
  assert.equal(falso.bajadasDelFtp(), 0)

  // El pedido: el vehículo y su uso salieron de las tablas.
  assert.equal(campo(falso, 'usuario', 'usa'), 'MARTINEZAD')
  assert.equal(campo(falso, 'usuario', 'pass'), CLAVE, 'la clave llega entera aunque tenga & y <')
  assert.equal(campo(falso, 'usuario', 'fecha'), fechaParaAtm())
  assert.equal(campo(falso, 'usuario', 'vendedor'), '0956112663')
  assert.equal(campo(falso, 'usuario', 'plan'), '02')
  assert.equal(campo(falso, 'asegurado', 'persona'), 'F')
  assert.equal(campo(falso, 'asegurado', 'iva'), 'CF')
  assert.equal(campo(falso, 'asegurado', 'codigo_iibb'), '')
  assert.equal(campo(falso, 'asegurado', 'bonificacion'), undefined)
  assert.equal(campo(falso, 'bien', 'cod_infoauto'), '460711')
  assert.equal(campo(falso, 'bien', 'anofab'), '2012')
  assert.equal(campo(falso, 'bien', 'uso'), '4262')
  assert.equal(campo(falso, 'bien', 'tipo_uso'), undefined)
  assert.equal(campo(falso, 'bien', 'ajuste'), '10', 'la cláusula del manual por defecto')
  assert.equal(campo(falso, 'bien', 'codpostal'), '1870')
  assert.equal(campo(falso, 'bien', 'sub_cp'), '1', 'Avellaneda dentro del 1870')
  assert.equal(campo(falso, 'bien', 'suma'), undefined, 'sin suma cargada, la de ATM')
  assert.equal(campo(falso, 'bien', 'rastreo'), 'N')
  assert.equal(campo(falso, 'bien', 'alarma'), '0')
  assert.equal(campo(falso, 'bien', 'seccion'), '3')

  // La respuesta, en la forma común.
  assert.equal(r.descripcionVehiculo, 'VOLKSWAGEN TIGUAN 2.0 TSI 4MOTION 2012 (InfoAuto 460711)')
  assert.equal(r.coberturas.length, 10)
  assert.deepEqual(
    r.coberturas.map((c) => [c.codigo, c.categoria]),
    [
      ['A1', 'RC'],
      ['A0', 'RC'],
      ['B5', 'TERCEROS_BASICO'],
      ['B1', 'TERCEROS_BASICO'],
      ['B4', 'TERCEROS_BASICO'],
      ['B0', 'TERCEROS_BASICO'],
      ['C1', 'TERCEROS_COMPLETO'],
      ['C0', 'TERCEROS_COMPLETO'],
      ['C3', 'TERCEROS_PREMIUM'],
      ['C2', 'TERCEROS_PREMIUM'],
    ],
  )
  assert.deepEqual(r.coberturas[1], {
    aseguradora: 'ATM',
    nombreAseguradora: 'ATM',
    codigo: 'A0',
    nombre: 'RESPONSABILIDAD CIVIL',
    categoria: 'RC',
    premio: 103086.61,
    prima: 82749.17,
    primeraCuota: 103086.61,
    cuota: null,
    franquicia: '',
    adicionales: [],
    comision: 12370.39,
    bonificacionPorcentaje: null,
    recargoAdministrativoPorcentaje: null,
    emision: null,
  })
  assert.deepEqual(r.avisos, [])
  assert.match(r.mensaje ?? '', /^Cotizado con el plan «ANUAL\/MENSUAL» \(tarjeta de crédito, plan 02\) y el vendedor 0956112663, /)
  assert.ok((r.mensaje ?? '').includes('cláusula de ajuste «10 %»'))
  assert.ok((r.mensaje ?? '').includes('bonificación: la de ATM por defecto'))
  assert.ok((r.mensaje ?? '').includes(`suma asegurada: la de ATM (${enPesos(21_800_000)})`))

  // Los ajustes: lo que se eligió solo, para cambiarlo desde la tarjeta.
  assert.deepEqual(
    r.ajustes.map((a) => [a.campo, a.valor]),
    [
      ['plan', '02'],
      ['bonificacion', ''],
      ['clausulaAjuste', '10'],
      ['iva', 'CONSUMIDOR_FINAL|CF'],
      ['marca', 'VOLKSWAGEN'],
      ['version', '460711'],
      ['uso', '4262'],
      ['localidad', '1'],
      ['alarma', '0'],
    ],
  )
  const ajuste = (nombre: string) => r.ajustes.find((a) => a.campo === nombre)!
  assert.equal(ajuste('plan').opciones.length, 8)
  assert.equal(ajuste('version').opciones[0]?.texto, `TIGUAN 2.0 TSI 4MOTION · ${enPesos(21_800_000)}`)
  assert.ok(!ajuste('version').opciones.some((o) => o.valor === '460100'), 'el Gol no está para 2012')
  assert.deepEqual(ajuste('uso').opciones, [
    { valor: '4262', texto: 'PARTICULAR (4262)' },
    { valor: '4263', texto: 'COMERCIAL (4263)' },
  ])
  assert.deepEqual(
    r.ajustes.filter((a) => a.porSolicitud).map((a) => a.campo),
    ['iva', 'marca', 'version', 'uso', 'localidad', 'alarma'],
    'lo que depende del cliente, del vehículo o del lugar se olvida al cambiar la solicitud',
  )

  // El detalle técnico: lo que se mandó (sin la clave) y lo que contestó.
  const detalle = r.detalleTecnico as { ambiente: string; vendedor: string; plan: string; operacion: string; pedido: string; respuesta: unknown }
  assert.equal(detalle.ambiente, 'produccion')
  assert.equal(detalle.plan, '02 — ANUAL/MENSUAL (TARJETA)')
  assert.equal(detalle.operacion, '2645461')
  assert.ok(detalle.pedido.includes('<pass>***</pass>'))
  assert.ok(!sinLaClave(r), 'la clave no aparece en ningún lado')

  // La segunda cotización no vuelve a pedir vendedores ni planes.
  await atm.cotizar(resuelta(), { clausulaAjuste: '0', bonificacion: '15', alarma: '1', localidad: '2' })
  assert.equal(falso.pedidos.length, 4)
  assert.equal(campo(falso, 'bien', 'ajuste'), '0')
  assert.equal(campo(falso, 'asegurado', 'bonificacion'), '15')
  assert.equal(campo(falso, 'bien', 'alarma'), '1')
  assert.equal(campo(falso, 'bien', 'sub_cp'), '2')
})

test('ATM: el plan sale del medio de pago, salvo que se elija otro; con vendedor cargado no se pide la lista', async (t) => {
  const falso = atmFalso(t, { cuenta: { ...CUENTA, vendedor: '0956102698' } })
  const plan = async (cambios: Partial<SolicitudDeCotizacion>, elegidos: Record<string, string> = {}) => {
    const r = await atm.cotizar(resuelta(cambios), elegidos)
    assert.equal(r.estado, 'OK', r.mensaje ?? '')
    return campo(falso, 'usuario', 'plan')
  }
  assert.equal(await plan({ medioDePago: 'TARJETA' }), '02')
  assert.equal(await plan({ medioDePago: 'DEBITO' }), '11')
  assert.equal(await plan({ medioDePago: 'EFECTIVO' }), '22')
  assert.equal(await plan({ medioDePago: 'TARJETA' }, { plan: '24' }), '24')
  assert.equal(await plan({ medioDePago: 'TARJETA' }, { plan: '99' }), '02', 'uno que no está en la lista vuelve al de por defecto')
  assert.equal(campo(falso, 'usuario', 'vendedor'), '0956102698')
  assert.ok(!falso.pedidos.some((p) => p.url.endsWith('ws_vendedores')))
})

test('ATM: la condición de IVA va con el código de ATM y los ingresos brutos que corresponden', async (t) => {
  const falso = atmFalso(t)
  const casos: Array<[CondicionIva, string, string]> = [
    ['CONSUMIDOR_FINAL', 'CF', ''],
    ['RESPONSABLE_INSCRIPTO', 'IN', 'I0'],
    ['MONOTRIBUTO', 'MT', 'I4'],
    ['EXENTO', 'EX', 'I2'],
  ]
  for (const [condicion, iva, iibb] of casos) {
    const r = await atm.cotizar(conIva(condicion), {})
    assert.equal(r.estado, 'OK', `${condicion}: ${r.mensaje}`)
    assert.equal(campo(falso, 'asegurado', 'iva'), iva, condicion)
    assert.equal(campo(falso, 'asegurado', 'codigo_iibb'), iibb, `${condicion}: el código de ingresos brutos va siempre, vacío para consumidor final`)
    const ajuste = r.ajustes.find((a) => a.campo === 'iibb')
    if (!iibb) {
      assert.equal(ajuste, undefined, 'consumidor final no elige ingresos brutos')
    } else {
      assert.equal(ajuste?.valor, iibb)
      assert.equal(ajuste?.obligatorio, iva !== 'EX', condicion)
    }
  }
  // Elegido a mano.
  await atm.cotizar(conIva('RESPONSABLE_INSCRIPTO'), { iibb: 'I1' })
  assert.equal(campo(falso, 'asegurado', 'codigo_iibb'), 'I1')
  // Régimen simplificado no es para un inscripto: vuelve al de por defecto.
  await atm.cotizar(conIva('RESPONSABLE_INSCRIPTO'), { iibb: 'I4' })
  assert.equal(campo(falso, 'asegurado', 'codigo_iibb'), 'I0')
  // Cambiar el IVA desde la tarjeta cambia también los ingresos brutos. La opción lleva adelante la
  // condición del formulario: mientras el formulario diga lo mismo, vale lo elegido en la tarjeta.
  const aMano = await atm.cotizar(conIva('CONSUMIDOR_FINAL'), { iva: 'CONSUMIDOR_FINAL|MT' })
  assert.deepEqual([campo(falso, 'asegurado', 'iva'), campo(falso, 'asegurado', 'codigo_iibb')], ['MT', 'I4'])
  assert.equal(aMano.ajustes.find((a) => a.campo === 'iva')?.valor, 'CONSUMIDOR_FINAL|MT', 'devuelve lo aplicado, así se recuerda')
  // Si el formulario cambia de condición, lo elegido para la anterior deja de valer.
  await atm.cotizar(conIva('EXENTO'), { iva: 'CONSUMIDOR_FINAL|MT' })
  assert.deepEqual([campo(falso, 'asegurado', 'iva'), campo(falso, 'asegurado', 'codigo_iibb')], ['EX', 'I2'])
  // Lo guardado antes de que la opción llevara la condición del formulario («MT» solo) no se aplica.
  await atm.cotizar(conIva('CONSUMIDOR_FINAL'), { iva: 'MT' })
  assert.equal(campo(falso, 'asegurado', 'iva'), 'CF')
  // Persona jurídica.
  await atm.cotizar(resuelta({ tomador: { ...solicitud().tomador, tipoPersona: 'JURIDICA', condicionIva: 'RESPONSABLE_INSCRIPTO' } }), {})
  assert.equal(campo(falso, 'asegurado', 'persona'), 'J')
})

test('ATM: ante dos versiones parecidas pregunta en vez de adivinar, y con la elegida cotiza', async (t) => {
  const falso = atmFalso(t)
  const dudosa = conVehiculo({ version: '2.0 TSI' })
  const r = await atm.cotizar(dudosa, {})
  assert.equal(r.estado, 'FALTAN_DATOS')
  assert.equal(r.mensaje, 'Para cotizar, elegí: versión en atm.')
  assert.deepEqual(r.coberturas, [])
  assert.equal(falso.cotizados.length, 0, 'no se cotiza otro vehículo')
  const version = r.ajustes.find((a) => a.campo === 'version')!
  assert.equal(version.valor, '')
  assert.equal(version.obligatorio, true)
  assert.equal(version.porSolicitud, true)
  assert.equal(version.dependeDe, 'marca')
  assert.deepEqual(
    version.opciones.map((o) => o.valor).sort(),
    ['460711', '460712'],
  )

  const elegida = await atm.cotizar(dudosa, { version: '460712' })
  assert.equal(elegida.estado, 'OK', elegida.mensaje ?? '')
  assert.equal(campo(falso, 'bien', 'cod_infoauto'), '460712')
  assert.equal(elegida.descripcionVehiculo, 'VOLKSWAGEN TIGUAN 2.0 TSI EXCLUSIVE 2012 (InfoAuto 460712)')

  // Una marca que ATM no tiene: se pide la marca.
  const sinMarca = await atm.cotizar(conVehiculo({ marca: 'Lada', modelo: 'Niva' }), {})
  assert.equal(sinMarca.estado, 'FALTAN_DATOS')
  assert.match(sinMarca.mensaje ?? '', /marca en atm/)
  // Un año que ATM no tiene para esa marca: el ajuste lo explica.
  const sinAnio = await atm.cotizar(conVehiculo({ anio: '1995' }), {})
  assert.equal(sinAnio.estado, 'FALTAN_DATOS')
  assert.equal(sinAnio.ajustes.find((a) => a.campo === 'version')?.ayuda, 'ATM no tiene versiones de VOLKSWAGEN para el año 1995.')
  assert.equal(falso.cotizados.length, 1)
})

test('ATM: un 0 km sin suma todavía en sus tablas ofrece todas las versiones de la marca; un año viejo, ninguna', async (t) => {
  const falso = atmFalso(t)
  // Las tablas de prueba llegan hasta 2020 (Gol Trend) y 2013 (Tiguan): un 0 km de este año no figura.
  const esteAnio = String(new Date().getFullYear())
  const ceroKm = await atm.cotizar(conVehiculo({ modelo: 'Tiguan', version: '2.0 TSI Exclusive', anio: esteAnio, ceroKm: true }), {})
  const version = ceroKm.ajustes.find((a) => a.campo === 'version')!
  assert.deepEqual(version.opciones.map((o) => o.valor).sort(), ['460100', '460711', '460712'])
  assert.equal(version.valor, '460712', 'la más parecida, sin dudas')
  assert.match(version.ayuda ?? '', new RegExp(`todavía no tienen sumas para el año ${esteAnio}`))
  assert.equal(ceroKm.estado, 'OK', ceroKm.mensaje ?? '')
  assert.equal(campo(falso, 'bien', 'cerokm'), 'S')
  // Un usado de un año que la tabla no tiene sigue sin versiones: ATM no lo cotizaría.
  const viejo = await atm.cotizar(conVehiculo({ anio: '2001' }), {})
  assert.equal(viejo.estado, 'FALTAN_DATOS')
  assert.deepEqual(viejo.ajustes.find((a) => a.campo === 'version')?.opciones, [])
})

test('ATM: la franquicia del todo riesgo sale de cómo la nombra ATM', () => {
  assert.equal(franquiciaDe('TODO RIESGO C/FCIA.VARIABLE 6% SUMA ASEGURADA'), '6 % de la suma asegurada')
  assert.equal(franquiciaDe('TODO RIESGO C/FCIA.VARIABLE 1.5 % SUMA ASEGURADA'), '1,5 % de la suma asegurada')
  assert.equal(franquiciaDe('TODO RIESGO CON FRANQUICIA $ 500.000'), '$ 500.000')
  assert.equal(franquiciaDe('TERCEROS COMPLETOS PREMIUM'), '')
  assert.equal(franquiciaDe('TODO RIESGO SIN DETALLE'), '')
})

test('ATM: un rechazo vuelve como error con el motivo y qué tocar, sin perder los ajustes', async (t) => {
  atmFalso(t, { contestar: () => respuestaSoap(autoRechazado('La relación vehículo - año de fabricación no es válida', 'Debe informar el uso')) })
  const r = await atm.cotizar(resuelta(), {})
  assert.equal(r.estado, 'ERROR')
  assert.equal(
    r.mensaje,
    'ATM no cotizó: La relación vehículo - año de fabricación no es válida · Debe informar el uso. ATM no tiene esa versión para el año 2012: probá con otra versión en los ajustes de ATM.',
  )
  assert.deepEqual(r.coberturas, [])
  assert.ok(r.ajustes.some((a) => a.campo === 'version' && a.valor === '460711'), 'para cambiar la versión desde la tarjeta')
  assert.equal(r.descripcionVehiculo, 'VOLKSWAGEN TIGUAN 2.0 TSI 4MOTION 2012 (InfoAuto 460711)')
  assert.ok((r.detalleTecnico as { pedido: string }).pedido.includes('<cod_infoauto>460711</cod_infoauto>'))
})

test('ATM: una cuenta que ATM no acepta vuelve como error en su tarjeta', async (t) => {
  atmFalso(t, { vendedores: { error: true, errores: ['Usuario inválido'] } })
  const r = await cotizarEnAseguradora({ aseguradora: 'ATM', solicitud: solicitud(), elegidos: {} }, true)
  assert.equal(r.estado, 'ERROR')
  assert.equal(r.mensaje, 'ATM no aceptó la cuenta: Usuario inválido.')
})

test('ATM: avisa cuando la suma cargada lo deja sólo en responsabilidad civil y cuando el vehículo es «black»', async (t) => {
  let respuesta = respuestaSoap(autoCotizado(COBERTURAS_REALES.slice(0, 2)))
  const falso = atmFalso(t, { contestar: () => respuesta })
  const fuera = await atm.cotizar(conVehiculo({ sumaAsegurada: 40_000_000 }), {})
  assert.equal(fuera.estado, 'OK')
  assert.equal(campo(falso, 'bien', 'suma'), '40000000')
  assert.deepEqual(fuera.coberturas.map((c) => c.codigo), ['A1', 'A0'])
  assert.equal(fuera.avisos.length, 1)
  assert.ok(fuera.avisos[0]!.startsWith(`Con la suma asegurada cargada (${enPesos(40_000_000)}) ATM sólo cotizó responsabilidad civil`))
  assert.ok(fuera.avisos[0]!.includes(`(para este vehículo usa ${enPesos(21_800_000)})`))
  assert.ok((fuera.mensaje ?? '').includes(`suma asegurada ${enPesos(40_000_000)} (la cargada en el formulario)`))

  // Sin suma cargada, que ATM devuelva sólo RC no es por la suma: no se avisa eso.
  assert.deepEqual((await atm.cotizar(resuelta(), {})).avisos, [])

  respuesta = respuestaSoap(autoCotizado(COBERTURAS_REALES, { suma: '21800000.00', uso: '0101', vehiculoblack: 'SI' }))
  const black = await atm.cotizar(resuelta(), {})
  assert.deepEqual(black.avisos, ['ATM marca este vehículo como «vehículo black» (de su lista de vehículos con restricciones).'])
})

test('ATM: una bajada del FTP con un archivo ilegible no pisa la tabla que andaba', async (t) => {
  carpetaDeTablas(t)
  guardarTablas('produccion', TABLAS_DE_PRUEBA, 'ftp', true)
  const antes = estadoDeTablasAtm('produccion')
  assert.ok(antes.listasParaCotizar)
  // Al otro día: la de marcas y modelos vino cortada (sin separador) y la de usos, vacía.
  guardarTablas('produccion', [archivo('ws_au_marca_modelo.txt', 'basura sin columnas'), archivo('ws_au_usos.txt', '')], 'ftp', true)
  const despues = estadoDeTablasAtm('produccion')
  assert.ok(despues.listasParaCotizar, 'se sigue pudiendo cotizar')
  assert.equal(despues.tablas.find((x) => x.tabla === 'ws_au_marca_modelo')?.filas, antes.tablas.find((x) => x.tabla === 'ws_au_marca_modelo')?.filas)
  assert.equal(despues.tablas.find((x) => x.tabla === 'ws_au_usos')?.filas, 2)
  // Las que no vinieron en una bajada completa sí se van (la bajada las reemplaza todas).
  assert.equal(despues.tablas.find((x) => x.tabla === 'ws_au_infoauto')?.archivo, null)
  // Sin una anterior que ande, el archivo nuevo queda igual, con su error a la vista.
  guardarTablas('produccion', [archivo('ws_au_marcas.txt', 'basura sin columnas')], 'archivos', false)
  assert.match(estadoDeTablasAtm('produccion').tablas.find((x) => x.tabla === 'ws_au_marcas')?.error ?? '', /separador/)
})

test('ATM: si el cambio de carpeta de las tablas quedó cortado, se recuperan las anteriores', (t) => {
  const carpeta = carpetaDeTablas(t)
  guardarTablas('produccion', TABLAS_DE_PRUEBA, 'ftp', true)
  const vehiculos = estadoDeTablasAtm('produccion').vehiculos
  // Como si se hubiera cortado la luz entre los dos renombres: las tablas quedaron en «.vieja».
  renameSync(path.join(carpeta, 'produccion'), path.join(carpeta, 'produccion.vieja'))
  usarCarpetaDeTablasAtmDePrueba(carpeta) // olvida lo que tenía en memoria
  assert.equal(estadoDeTablasAtm('produccion').vehiculos, vehiculos)
  assert.ok(existsSync(path.join(carpeta, 'produccion', 'estado.json')))
})

test('ATM: si sólo tiene el vehículo con el otro uso, cotiza con ése y lo avisa', async (t) => {
  const falso = atmFalso(t)
  const r = await atm.cotizar(conVehiculo({ uso: 'COMERCIAL' }), {})
  assert.equal(r.estado, 'OK', r.mensaje ?? '')
  assert.equal(campo(falso, 'bien', 'uso'), '4263', 'el comercial que tiene')
  assert.ok(!r.avisos.some((a) => /sólo con uso/.test(a)))
  // Un vehículo que ATM tiene sólo como particular, pedido como comercial.
  const gol = await atm.cotizar(conVehiculo({ modelo: 'Gol Trend', version: '1.6 Pack I', anio: '2020', uso: 'COMERCIAL' }), {})
  assert.equal(gol.estado, 'OK', gol.mensaje ?? '')
  assert.equal(campo(falso, 'bien', 'uso'), '4262')
  assert.ok(gol.avisos.includes('ATM tiene este vehículo sólo con uso particular: se cotizó con ése.'), gol.avisos.join(' | '))
  // Elegido a mano, no se avisa: la persona ya lo sabe.
  const aMano = await atm.cotizar(conVehiculo({ modelo: 'Gol Trend', version: '1.6 Pack I', anio: '2020', uso: 'COMERCIAL' }), { uso: '4262' })
  assert.ok(!aMano.avisos.some((a) => /sólo con uso/.test(a)))
})

test('ATM: con rastreo satelital se elige el equipo; si no, se cotiza sin rastreo y se avisa', async (t) => {
  const falso = atmFalso(t)
  const conRastreo = conVehiculo({ rastreo: true })
  const sinElegir = await atm.cotizar(conRastreo, {})
  assert.equal(campo(falso, 'bien', 'rastreo'), 'N')
  assert.match(sinElegir.avisos.join(' '), /elegí el equipo en los ajustes de ATM/)
  assert.deepEqual(
    sinElegir.ajustes.find((a) => a.campo === 'rastreo')?.opciones,
    [
      { valor: '7', texto: 'LO JACK' },
      { valor: '8', texto: 'PROTEGIDO GPS' },
    ],
  )
  const elegido = await atm.cotizar(conRastreo, { rastreo: '7' })
  assert.equal(campo(falso, 'bien', 'rastreo'), '7')
  assert.deepEqual(elegido.avisos, [])
})

test('ATM: una moto va con su tipo de uso, sin uso de auto ni cláusula de ajuste', async (t) => {
  const falso = atmFalso(t)
  const moto = conVehiculo({ tipo: 'MOTO', marca: 'Honda', modelo: 'CG 150 Titan', version: '', anio: '2020', uso: 'COMERCIAL' })
  const r = await atm.cotizar(moto, {})
  assert.equal(r.estado, 'OK', r.mensaje ?? '')
  assert.ok(falso.pedidos.some((p) => p.url.includes('get_plans?usa=MARTINEZAD&seccion=4&')))
  assert.equal(campo(falso, 'bien', 'seccion'), '4')
  assert.equal(campo(falso, 'bien', 'cod_infoauto'), '9900131')
  assert.equal(campo(falso, 'bien', 'tipo_uso'), '2')
  assert.equal(campo(falso, 'bien', 'uso'), undefined)
  assert.equal(campo(falso, 'bien', 'ajuste'), undefined)
  assert.ok(!r.ajustes.some((a) => a.campo === 'clausulaAjuste' || a.campo === 'uso'))
  assert.ok(!(r.mensaje ?? '').includes('cláusula'))
})

test('ATM: las localidades del código postal salen de sus tablas, salvo en Capital', async (t) => {
  atmFalso(t)
  assert.deepEqual(await atm.localidades?.('AUTO', '1870'), ['AVELLANEDA', 'PIÑEYRO'])
  assert.deepEqual(await atm.localidades?.('AUTO', '1000'), [], 'en Capital ATM lista calles, no localidades')
  assert.deepEqual(await atm.localidades?.('AUTO', '9999'), [])
})

test('ATM: quien no ve los números de la agencia no recibe la comisión ni en el detalle técnico', async (t) => {
  atmFalso(t)
  const pedido = { aseguradora: 'ATM', solicitud: solicitud(), elegidos: {} }

  const sinNumeros = await cotizarEnAseguradora(pedido, false)
  assert.equal(sinNumeros.estado, 'OK', sinNumeros.mensaje ?? '')
  assert.equal(sinNumeros.aseguradora, 'ATM')
  assert.equal(sinNumeros.coberturas.length, 10)
  assert.ok(sinNumeros.coberturas.every((c) => c.comision === null))
  assert.ok(!JSON.stringify(sinNumeros.detalleTecnico).includes('comision'), 'ni en la respuesta cruda de ATM')
  assert.ok((sinNumeros.detalleTecnico as { pedido: string }).pedido.includes('<pass>***</pass>'))
  assert.ok(!sinLaClave(sinNumeros))

  const conNumeros = await cotizarEnAseguradora(pedido, true)
  assert.equal(conNumeros.coberturas[0]?.comision, 10735.81)
  assert.ok(JSON.stringify(conNumeros.detalleTecnico).includes('"comision":"10735.81"'))
})
