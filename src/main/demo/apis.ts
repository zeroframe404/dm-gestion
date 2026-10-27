// Lo que contestan, en la versión de demostración, las pantallas que en el programa de verdad hablan con
// un tercero: API Aseguradoras (la cuenta de cada compañía, «Probar conexión», las tablas de ATM, emitir
// con ATM), el portal de novedades de Galeno, la consola del control remoto y «Reportar error».
//
// Todo dice que está configurado y anda —es lo que se quiere mostrar—, después de lo que tardaría de
// verdad, y siempre aclara en el texto que es una demostración: nadie tiene que creer que habló con ATM.
// Cada servicio llama a esto con un `if (esDemo())` al principio de la función (ver `// Demo:`).
import type {
  DatosDeEmisionAtm,
  EmisionAtm,
  EstadoDeAjusteCompartido,
  EstadoDeAtm,
  EstadoDeEquidad,
  EstadoDeGaleno,
  EstadoDeGalenoNovedades,
  EstadoDeMercantil,
  EstadoDeTablasAtm,
  EstadoDelMesh,
  OpcionesDeEmisionAtm,
  PruebaDeAtm,
  PruebaDeEquidad,
  PruebaDeGaleno,
  PruebaDeGalenoNovedades,
  PruebaDeMercantil,
  ReporteCreado,
  ResumenDePasadaDeGaleno,
} from '../../shared/tipos'
import { DESCRIPCION_TABLA_ATM, TABLAS_ATM, TABLAS_DE_VEHICULOS } from '../aseguradoras/atm/tablas'
import { LEGAJO_DE_LA_DEMO } from './galeno'
import { enteroDe, esperarComoLaApi, hashDe, localidadesDeEjemplo } from './simulacion'

const AVISO = 'Es una demostración: no se conectó con la compañía.'

/** Hace un rato, para que «actualizado» no diga «recién» ni «hace un año». */
function haceUnRato(minutos: number): string {
  return new Date(Date.now() - minutos * 60_000).toISOString()
}

/** La cuenta «publicada en el servidor» de la agencia de ejemplo: siempre al día. */
export function compartidoDeLaDemo(): EstadoDeAjusteCompartido {
  return { enElServidor: true, actualizadoEn: haceUnRato(60 * 24 * 12), actualizadoPor: 'Administrador de la demo', alDia: true, error: null }
}

// --- Galeno --------------------------------------------------------------------------------------------

export function estadoDeGalenoDemo(): EstadoDeGaleno {
  return { ...compartidoDeLaDemo(), productorCodigo: LEGAJO_DE_LA_DEMO }
}

export async function pruebaDeGalenoDemo(): Promise<PruebaDeGaleno> {
  await esperarComoLaApi(600, 1400)
  return { ok: true, detalle: `Conectado con Galeno Seguros: legajo ${LEGAJO_DE_LA_DEMO}. ${AVISO}`, ramasEncontradas: 3 }
}

// --- El portal de novedades de Galeno -------------------------------------------------------------------

const POLIZAS_VISTAS = 214

export function estadoDeNovedadesDemo(): EstadoDeGalenoNovedades {
  const pasada = haceUnRato(7)
  return {
    configurado: true,
    enCurso: false,
    pendientes: 0,
    version: 1,
    ultimaPasadaEn: pasada,
    ultimoExitoEn: pasada,
    ultimoError: null,
    legajos: [{ legajo: LEGAJO_DE_LA_DEMO, polizasVistas: POLIZAS_VISTAS, ultimoError: null, ultimoExitoEn: pasada }],
  }
}

export async function pasadaDeNovedadesDemo(): Promise<ResumenDePasadaDeGaleno> {
  await esperarComoLaApi(1500, 3000)
  return { legajos: 1, polizasVistas: POLIZAS_VISTAS, altas: 0, modificaciones: 0, anulaciones: 0, errores: [] }
}

export async function pruebaDeNovedadesDemo(): Promise<PruebaDeGalenoNovedades> {
  await esperarComoLaApi(800, 1600)
  return { ok: true, detalle: `El portal de Galeno aceptó el usuario: legajo ${LEGAJO_DE_LA_DEMO}. ${AVISO}`, legajosEncontrados: 1 }
}

// --- ATM -----------------------------------------------------------------------------------------------

function tablasDeAtmDemo(origen: 'ftp' | 'archivos', bajadasEn: string): EstadoDeTablasAtm {
  return {
    ambiente: 'produccion',
    bajadasEn,
    origen,
    tablas: TABLAS_ATM.map((tabla) => ({
      tabla,
      descripcion: DESCRIPCION_TABLA_ATM[tabla],
      archivo: `${tabla}.txt`,
      filas: enteroDe(`atm:${tabla}`, 12, tabla === 'ws_au_infoauto' || tabla === 'ws_au_marca_modelo' ? 24_000 : tabla === 'ws_au_localidades' ? 9_000 : 60),
      error: null,
      necesaria: TABLAS_DE_VEHICULOS.includes(tabla),
    })),
    vehiculos: 18_432,
    listasParaCotizar: true,
    ultimoError: null,
  }
}

let tablasDeAtm: EstadoDeTablasAtm | null = null

export function estadoDeAtmDemo(): EstadoDeAtm {
  tablasDeAtm ??= tablasDeAtmDemo('ftp', haceUnRato(60 * 5))
  return {
    configurada: true,
    ambiente: 'produccion',
    usuario: 'agencia-demo',
    vendedor: '0000084512',
    actualizadoEn: haceUnRato(60 * 24 * 12),
    compartido: compartidoDeLaDemo(),
    tablas: tablasDeAtm,
  }
}

export async function pruebaDeAtmDemo(): Promise<PruebaDeAtm> {
  await esperarComoLaApi(700, 1500)
  return {
    ok: true,
    detalle: `ATM (producción) aceptó el usuario agencia-demo. El vendedor 0000084512 es de la cuenta (AGENCIA DE DEMOSTRACIÓN). Planes del vendedor 0000084512: autos, 2 planes; motos, 2 planes. ${AVISO}`,
    vendedores: [{ codigo: '0000084512', nombre: 'AGENCIA DE DEMOSTRACIÓN' }],
    planesAuto: 2,
    planesMoto: 2,
  }
}

export async function actualizarTablasDeAtmDemo(origen: 'ftp' | 'archivos'): Promise<EstadoDeTablasAtm> {
  await esperarComoLaApi(1500, 3000)
  tablasDeAtm = tablasDeAtmDemo(origen, new Date().toISOString())
  return tablasDeAtm
}

const opcion = (codigo: string, descripcion: string) => ({ codigo, descripcion })

export async function opcionesDeEmisionAtmDemo(codigoPostal: string): Promise<OpcionesDeEmisionAtm> {
  await esperarComoLaApi(150, 400)
  const cp = codigoPostal.trim()
  const conocidas = localidadesDeEjemplo(cp)
  // El sub-código postal es la posición en la lista, igual que en el ajuste «Localidad» de la cotización.
  const localidades = (conocidas.length > 0 ? conocidas : [{ localidad: `LOCALIDAD DEL CP ${cp}`, provincia: 'BUENOS AIRES', codigoProvincia: '1' }]).map((l, i) => ({
    codigoPostal: cp,
    subCodigoPostal: String(i + 1),
    ...l,
  }))
  return {
    tiposDeDocumento: [opcion('1', 'DNI'), opcion('2', 'CUIT'), opcion('3', 'CUIL'), opcion('4', 'LE'), opcion('5', 'LC'), opcion('6', 'PASAPORTE')],
    sexos: [opcion('M', 'MASCULINO'), opcion('F', 'FEMENINO')],
    estadosCiviles: [opcion('S', 'SOLTERO/A'), opcion('C', 'CASADO/A'), opcion('D', 'DIVORCIADO/A'), opcion('V', 'VIUDO/A')],
    nacionalidades: [opcion('1', 'ARGENTINA'), opcion('2', 'BOLIVIANA'), opcion('3', 'BRASILEÑA'), opcion('4', 'CHILENA'), opcion('5', 'PARAGUAYA'), opcion('6', 'URUGUAYA')],
    actividades: [opcion('01', 'EMPLEADO EN RELACIÓN DE DEPENDENCIA'), opcion('02', 'COMERCIANTE'), opcion('03', 'PROFESIONAL INDEPENDIENTE'), opcion('04', 'JUBILADO'), opcion('05', 'ESTUDIANTE'), opcion('06', 'AMA DE CASA')],
    formasDePago: [opcion('T', 'TARJETA DE CRÉDITO'), opcion('D', 'DÉBITO POR CBU'), opcion('E', 'EFECTIVO')],
    tarjetas: [opcion('1', 'VISA'), opcion('2', 'MASTERCARD'), opcion('3', 'AMERICAN EXPRESS'), opcion('4', 'CABAL'), opcion('5', 'NARANJA')],
    responsablesDeInspeccion: [opcion('P', 'PRODUCTOR'), opcion('A', 'ATM (INSPECCIÓN A DOMICILIO)'), opcion('C', 'CLIENTE (APP DE ATM)')],
    provincias: [opcion('0', 'CAPITAL FEDERAL'), opcion('1', 'BUENOS AIRES'), opcion('3', 'CÓRDOBA'), opcion('7', 'MENDOZA'), opcion('12', 'SANTA FE'), opcion('14', 'TUCUMÁN')],
    localidades,
    faltan: [],
  }
}

/** Emite «de mentira»: la operación queda como póliza, con un número que no existe en ATM. */
export async function emisionDeAtmDemo(datos: DatosDeEmisionAtm): Promise<EmisionAtm> {
  await esperarComoLaApi(1200, 2500)
  return {
    operacion: datos.operacion,
    estado: 'POL',
    propuesta: null,
    poliza: `30${String(hashDe(`atm:poliza:${datos.operacion}:${datos.cobertura}`) % 1_000_000).padStart(6, '0')}`,
    inspeccionUrl: null,
    inspeccionNumero: null,
    linkDePago: null,
    avisoDeInspeccion: null,
  }
}

// --- Mercantil Andina y La Equidad -----------------------------------------------------------------------

export function estadoDeMercantilDemo(): EstadoDeMercantil {
  return {
    configurada: true,
    ambiente: 'produccion',
    usuario: 'agencia-demo',
    finDeClaveDeSuscripcion: '4f2a',
    productor: '84512',
    actualizadoEn: haceUnRato(60 * 24 * 12),
    compartido: compartidoDeLaDemo(),
  }
}

function enUnaHora(): string {
  return new Date(Date.now() + 60 * 60_000).toISOString()
}

export async function pruebaDeMercantilDemo(): Promise<PruebaDeMercantil> {
  await esperarComoLaApi(700, 1500)
  return {
    ok: true,
    detalle: `Mercantil (producción) aceptó el usuario agencia-demo y la clave de suscripción. El productor 84512 es de la cuenta (AGENCIA DE DEMOSTRACIÓN). Catálogo de vehículos: 62 marcas para ${new Date().getFullYear()}. ${AVISO}`,
    productores: [{ codigo: '84512', nombre: 'AGENCIA DE DEMOSTRACIÓN' }],
    marcas: 62,
    tokenVenceEn: enUnaHora(),
  }
}

export function estadoDeEquidadDemo(): EstadoDeEquidad {
  return {
    configurada: true,
    ambiente: 'produccion',
    urlBase: 'https://glm.demo.invalid/servlet/',
    usuario: 'AGENCIADEMO',
    usuarioDeServicio: '',
    productor: '1043',
    rama: '4',
    empresa: '1',
    actualizadoEn: haceUnRato(60 * 24 * 12),
    compartido: compartidoDeLaDemo(),
  }
}

export async function pruebaDeEquidadDemo(): Promise<PruebaDeEquidad> {
  await esperarComoLaApi(900, 1800)
  const tiposDePoliza = [opcion('1', 'AUTOMOTORES PARTICULARES'), opcion('2', 'AUTOMOTORES COMERCIALES')]
  return {
    ok: true,
    detalle: `Equidad (producción) aceptó el usuario AGENCIADEMO (AGENCIA DE DEMOSTRACIÓN): código de usuario 77. El productor 1043 es del usuario (AGENCIA DE DEMOSTRACIÓN). Rama 4: ${tiposDePoliza.map((t) => `${t.codigo} ${t.descripcion}`).join(', ')}. Catálogo de vehículos: 58 marcas. ${AVISO}`,
    usuarioCodigo: '77',
    usuarioNombre: 'AGENCIA DE DEMOSTRACIÓN',
    tokenVenceEn: enUnaHora(),
    productores: [{ codigo: '1043', nombre: 'AGENCIA DE DEMOSTRACIÓN' }],
    tiposDePoliza,
    marcas: 58,
  }
}

// --- El control remoto y el reporte de errores ----------------------------------------------------------

export async function estadoDelMeshDemo(): Promise<EstadoDelMesh> {
  const desde = Date.now()
  await esperarComoLaApi(150, 450)
  return {
    // La página del producto, no una consola de verdad: en la demo no hay computadoras que controlar.
    url: 'https://meshcentral.com/',
    enLinea: true,
    detalle: 'La consola está en línea. (En la demostración el botón abre la página de MeshCentral: no hay computadoras de una agencia que controlar.)',
    tardanzaMs: Date.now() - desde,
  }
}

/** El reporte «queda anotado» con un número inventado: en la demo no se abre ningún issue. */
export async function reporteDeErrorDemo(titulo: string, imagenes: number): Promise<ReporteCreado> {
  await esperarComoLaApi(800, 1800)
  const numero = 300 + (hashDe(`${titulo}:${Date.now()}`) % 700)
  return { numero, url: `https://example.com/dm-gestion-demo/reportes/${numero}`, imagenesSubidas: imagenes }
}
