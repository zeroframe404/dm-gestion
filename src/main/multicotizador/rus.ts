// Río Uruguay Seguros (RUS) en el multicotizador: traduce la solicitud común a su API v2 (`POST
// cotizaciones/automotores` y `cotizaciones/motos`, ver aseguradoras/rus/cotizacion.ts) y devuelve sus
// coberturas en la forma común. Cotiza autos y motos; no emite (la API tiene propuestas y emisión, y
// quedan para una fase siguiente).
//
// Lo que RUS pide y la solicitud común no trae —su vigencia (`vigenciaPolizaId`), las cuotas, el
// ajuste automático, su condición fiscal, el uso por su nombre, el tipo de unidad y sobre todo SU número
// de modelo del vehículo— se elige solo con un criterio razonable y se devuelve como ajuste, para
// cambiarlo desde la tarjeta de RUS, igual que en las otras compañías.
//
// EL VEHÍCULO: RUS lo identifica por el id de la versión en su catálogo (`modeloVehiculo`), que va por
// tipo de unidad → marca → modelos del año → versiones. Se busca por nombre como en Mercantil —marca,
// modelo y versión del catálogo de la agencia— y ante la duda se pregunta en vez de adivinar. Las pick-ups
// son otro tipo de unidad en RUS («PICK-UP A/B»): si el modelo no aparece entre los autos, se busca ahí.
// Lo elegido a mano (o sin dudas, si RUS cotizó) queda en la tabla de equivalencias para ese vehículo.
import {
  enPesos,
  normalizarTexto,
  type AjusteDeAseguradora,
  type CoberturaCotizada,
  type CondicionIva,
} from '../../shared/multicotizador'
import type { TipoDeVehiculo } from '../../shared/tipos'
import { marcasRus, modelosRus, TIPOS_DE_UNIDAD_RUS, usosRus, versionesRus, vigenciasRus, type OpcionRus, type VersionRus, type VigenciaRus } from '../aseguradoras/rus/catalogos'
import { crearClienteRus, ErrorDeRus, type ClienteRus, type CuentaRus } from '../aseguradoras/rus/cliente'
import { cotizarRus, RAMO_RUS, RUTA_COTIZACION, sumarMeses, type DatosDeCotizacionRus } from '../aseguradoras/rus/cotizacion'
import { credencialesRus } from '../servicios/config'
import type { CotizacionDeAseguradora, CotizadorDeAseguradora, SolicitudResuelta } from './aseguradora'
import {
  bajoElFormulario,
  buscarMarca,
  claveDeCuotas,
  codigoPostalDeCuatro,
  elegidoBajo,
  periodoDeFacturacion,
  porUso,
  rankear,
  sinDudas,
  textoDeVehiculo,
  type OpcionDeLista,
} from './equivalencias'
import { equivalenciaGuardada, guardarEquivalencia, olvidarEquivalencia } from './equivalenciasGuardadas'

export const ID_RUS = 'RUS'
const NOMBRE = 'Río Uruguay'

// --- Las listas, en memoria ----------------------------------------------------------------------------
//
// Las marcas, los modelos y las vigencias cambian muy de vez en cuando: guardarlos media hora hace que la
// segunda cotización no los vuelva a pedir. Si un pedido falla no se guarda nada.

const DURACION_MS = 30 * 60_000
const listas = new Map<string, { vence: number; valor: Promise<unknown> }>()

function enMemoria<T>(clave: string, traer: () => Promise<T>): Promise<T> {
  const guardada = listas.get(clave)
  if (guardada && guardada.vence > Date.now()) return guardada.valor as Promise<T>
  const valor = traer()
  listas.set(clave, { vence: Date.now() + DURACION_MS, valor })
  valor.catch(() => listas.delete(clave))
  return valor
}

/** Para las pruebas, y al cambiar la cuenta: que nada quede de la anterior. */
export function olvidarListasDeRus(): void {
  listas.clear()
}

type CredencialesRus = NonNullable<ReturnType<typeof credencialesRus>>
let cuentaDePrueba: CredencialesRus | null = null

/** Las pruebas (y el humo en vivo) corren sin Electron ni config.json: les pasan la cuenta acá. */
export function usarCuentaDeRusDePrueba(cuenta: CredencialesRus | null): void {
  cuentaDePrueba = cuenta
  listas.clear()
}

function cuentaActual(): CredencialesRus | null {
  return cuentaDePrueba ?? credencialesRus()
}

/** El número de solicitud de cada cotización: RUS lo pide para identificar el pedido en el origen. */
let ultimaSolicitud = 0
function numeroDeSolicitud(): number {
  ultimaSolicitud = Math.max(ultimaSolicitud + 1, Math.floor(Date.now() / 1000) % 1_000_000_000)
  return ultimaSolicitud
}

// --- Las decisiones, puras (se prueban solas) ---------------------------------------------------------

/** Las condiciones fiscales de RUS (`comunes/condiciones-fiscales`). */
export const CONDICIONES_FISCALES_RUS: OpcionDeLista[] = [
  { codigo: 'CF', descripcion: 'Consumidor final' },
  { codigo: 'RI', descripcion: 'Responsable inscripto' },
  { codigo: 'RMT', descripcion: 'Responsable monotributo' },
  { codigo: 'EX', descripcion: 'Exento' },
  { codigo: 'RNI', descripcion: 'No inscripto' },
  { codigo: 'FM', descripcion: 'Resp. inscripto factura M' },
  { codigo: 'GC', descripcion: 'Gran contribuyente' },
  { codigo: 'SSF', descripcion: 'Sin situación fiscal' },
]
export const CONDICION_FISCAL_RUS: Record<CondicionIva, string> = {
  CONSUMIDOR_FINAL: 'CF',
  RESPONSABLE_INSCRIPTO: 'RI',
  MONOTRIBUTO: 'RMT',
  EXENTO: 'EX',
}

/** El ajuste automático de la suma asegurada que acepta la cotización de RUS. */
export const AJUSTES_AUTOMATICOS_RUS: OpcionDeLista[] = [
  { codigo: '20', descripcion: '20 %' },
  { codigo: '30', descripcion: '30 %' },
  { codigo: '40', descripcion: '40 %' },
]
export const AJUSTE_AUTOMATICO_POR_DEFECTO = '20'

/** Los tipos de unidad de RUS que se ofrecen, por tipo de vehículo de la agencia. El primero es el de siempre. */
export const TIPOS_DE_UNIDAD: Record<TipoDeVehiculo, OpcionDeLista[]> = {
  AUTO: [
    { codigo: TIPOS_DE_UNIDAD_RUS.AUTO, descripcion: 'Auto' },
    { codigo: TIPOS_DE_UNIDAD_RUS.PICKUP_A, descripcion: 'Pick-up «A»' },
    { codigo: TIPOS_DE_UNIDAD_RUS.PICKUP_B, descripcion: 'Pick-up «B»' },
  ],
  MOTO: [
    { codigo: TIPOS_DE_UNIDAD_RUS.MOTO_MAS_50, descripcion: 'Moto de más de 50 cc' },
    { codigo: TIPOS_DE_UNIDAD_RUS.MOTO_MENOS_50, descripcion: 'Moto de hasta 50 cc' },
  ],
}

/** Si RUS no devuelve sus usos, los dos de siempre (los nombres son los de su lista). */
export const USOS_RUS_POR_DEFECTO: OpcionDeLista[] = [
  { codigo: 'PARTICULAR', descripcion: 'PARTICULAR' },
  { codigo: 'COMERCIAL', descripcion: 'COMERCIAL' },
]

/** Si RUS no devuelve sus vigencias, la de su ejemplo de cotización: id 1, seis meses. */
export const VIGENCIA_DEL_EJEMPLO: VigenciaRus = { codigo: '1', descripcion: 'SEMESTRAL', meses: 6, facturacion: 'SEMESTRAL', porDefecto: true }

function valido(valor: string | undefined, lista: OpcionDeLista[]): string | null {
  return valor && lista.some((opcion) => opcion.codigo === valor) ? valor : null
}

function opcionesDe(lista: OpcionDeLista[]): Array<{ valor: string; texto: string }> {
  return lista.map((opcion) => ({ valor: opcion.codigo, texto: opcion.descripcion }))
}

function mesesDe(vigencia: VigenciaRus): number {
  return vigencia.meses > 0 ? vigencia.meses : 6
}

/** El texto de una vigencia en el desplegable: «SEMESTRAL (6 meses)», y cada cuánto se factura si no es lo mismo. */
export function textoDeVigencia(vigencia: VigenciaRus): string {
  const meses = mesesDe(vigencia)
  const factura = normalizarTexto(vigencia.facturacion) !== normalizarTexto(vigencia.descripcion) ? `, factura ${vigencia.facturacion.toLowerCase()}` : ''
  return `${vigencia.descripcion} (${meses} ${meses === 1 ? 'mes' : 'meses'}${factura})`
}

/**
 * La vigencia que corresponde a la facturación del formulario: la que factura con ese período o, si
 * ninguna, la que RUS marca por defecto. «Mejor costo» no elige: arranca en la de RUS.
 */
export function vigenciaPorDefecto(vigencias: VigenciaRus[], facturacion: SolicitudResuelta['condiciones']['facturacion']): VigenciaRus | null {
  if (facturacion !== 'MEJOR_COSTO') {
    const porPeriodo =
      vigencias.find((v) => periodoDeFacturacion(v.facturacion) === facturacion) ?? vigencias.find((v) => periodoDeFacturacion(v.descripcion) === facturacion)
    if (porPeriodo) return porPeriodo
  }
  return vigencias.find((v) => v.porDefecto) ?? vigencias[0] ?? null
}

/** Las cuotas posibles para una vigencia: de 1 a la cantidad de meses (como máximo 12). */
export function cuotasDeLaVigencia(vigencia: VigenciaRus): OpcionDeLista[] {
  const maximo = Math.min(mesesDe(vigencia), 12)
  return Array.from({ length: maximo }, (_, i) => ({ codigo: String(i + 1), descripcion: i === 0 ? '1 pago' : `${i + 1} cuotas` }))
}

/** Lo pedido en el formulario, en esa lista; la máxima si se pidió la máxima o nada. */
export function cuotasPorDefecto(opciones: OpcionDeLista[], pedidas: SolicitudResuelta['condiciones']['cuotas']): string {
  if (typeof pedidas === 'number') {
    const exacta = opciones.find((o) => Number(o.codigo) === pedidas)
    if (exacta) return exacta.codigo
  }
  return opciones[opciones.length - 1]?.codigo ?? '1'
}

/** El ajuste automático pedido en el formulario, si RUS lo tiene; si no, el 20 % de su ejemplo. */
export function ajusteAutomaticoPorDefecto(clausula: SolicitudResuelta['condiciones']['clausulaAjuste']): string {
  return valido(clausula, AJUSTES_AUTOMATICOS_RUS) ?? AJUSTE_AUTOMATICO_POR_DEFECTO
}

/** El texto con que se busca la versión: modelo y versión del catálogo de la agencia. */
export function textoParaBuscar(solicitud: SolicitudResuelta): string {
  const v = solicitud.vehiculo
  return textoDeVehiculo(v.modelo, v.version)
}

/**
 * Los (hasta) tres modelos de la lista de RUS que más se parecen al de la agencia. Se compara el NOMBRE
 * del modelo, no «modelo + versión» (ver la misma función en mercantil.ts); sólo si por el nombre no
 * aparece ninguno se prueba con el texto completo.
 */
export function modelosCandidatos(solicitud: SolicitudResuelta, modelos: OpcionRus[]): OpcionRus[] {
  const masParecidos = (texto: string): OpcionRus[] =>
    rankear(texto, modelos, (modelo) => modelo.descripcion)
      .filter((candidato) => candidato.puntaje >= 0.3)
      .slice(0, 3)
      .map((candidato) => candidato.opcion)
  const porNombre = masParecidos(solicitud.vehiculo.modelo)
  return porNombre.length > 0 ? porNombre : masParecidos(textoParaBuscar(solicitud))
}

/** La equivalencia se guarda con el tipo de unidad adelante («2:94727»): así se vuelve a buscar donde estaba. */
export function codigoDeEquivalencia(tipoUnidad: string, version: string): string {
  return `${tipoUnidad}:${version}`
}
function leerEquivalencia(codigo: string | undefined): { tipoUnidad: string; version: string } | null {
  const partes = /^(\d+):(\d+)$/.exec(codigo ?? '')
  return partes ? { tipoUnidad: partes[1]!, version: partes[2]! } : null
}

/** Lo que conviene revisar según lo que dijo RUS al rechazar. */
export function consejoParaElRechazo(mensaje: string): string {
  const texto = normalizarTexto(mensaje)
  if (/PRODUCTOR|SOLICITANTE/.test(texto)) return 'Revisá el código de productor cargado en API Aseguradoras → RUS: tiene que ser un PAS del usuario.'
  if (/VIGENCIA|FECHA/.test(texto)) return 'Probá con otra vigencia en los ajustes de RUS, o con otra fecha de inicio.'
  if (/POSTAL|LOCALIDAD|GUARDA/.test(texto)) return 'Revisá el código postal: RUS cotiza con el de la localidad de guarda.'
  if (/MODELO|VEHICULO|VERSION|ANIO|ANO\b/.test(texto)) return 'Elegí otra versión (o tipo de unidad) en los ajustes de RUS.'
  if (/CUOTA/.test(texto)) return 'Probá con otras cuotas en los ajustes de RUS.'
  if (/USO\b/.test(texto)) return 'Probá con otro uso en los ajustes de RUS.'
  if (/AJUSTE/.test(texto)) return 'Probá con otro ajuste automático en los ajustes de RUS.'
  return ''
}

// --- El vehículo ----------------------------------------------------------------------------------------

interface Version {
  modelo: OpcionRus
  version: VersionRus
  texto: string
}

interface BusquedaEnTipo {
  tipoUnidad: string
  marcas: OpcionRus[]
  marca: OpcionRus | null
  modelos: OpcionRus[]
  candidatos: OpcionRus[]
  versiones: Version[]
}

async function buscarEnTipo(cliente: ClienteRus, solicitud: SolicitudResuelta, tipoUnidad: string, elegidos: Record<string, string>): Promise<BusquedaEnTipo> {
  const v = solicitud.vehiculo
  const anio = v.anio
  const marcas = await enMemoria(`marcas:${tipoUnidad}`, () => marcasRus(cliente, tipoUnidad))
  const marcaCodigo = valido(elegidos.marca, marcas) ?? buscarMarca(v.marca, marcas)?.codigo ?? ''
  const marca = marcas.find((m) => m.codigo === marcaCodigo) ?? null
  if (!marca) return { tipoUnidad, marcas, marca: null, modelos: [], candidatos: [], versiones: [] }
  const modelos = await enMemoria(`modelos:${tipoUnidad}:${marca.codigo}:${anio}`, () => modelosRus(cliente, marca.codigo, anio, tipoUnidad)).catch(() => [] as OpcionRus[])
  const modeloElegido = valido(elegidos.modelo, modelos)
  // Sin modelo elegido a mano, se miran los tres que más se parecen: el catálogo suele partir un modelo en
  // varios y la versión buscada puede estar en cualquiera.
  const candidatos = modeloElegido ? modelos.filter((m) => m.codigo === modeloElegido) : modelosCandidatos(solicitud, modelos)
  const versiones: Version[] = []
  for (const modelo of candidatos) {
    const lista = await enMemoria(`versiones:${tipoUnidad}:${marca.codigo}:${anio}:${modelo.codigo}`, () => versionesRus(cliente, marca.codigo, anio, tipoUnidad, modelo.codigo)).catch(
      () => [] as VersionRus[],
    )
    for (const version of lista) versiones.push({ modelo, version, texto: `${modelo.descripcion} · ${version.descripcion}` })
  }
  return { tipoUnidad, marcas, marca, modelos, candidatos, versiones }
}

interface VehiculoElegido {
  tipoUnidad: string
  marca: OpcionRus | null
  modelo: OpcionRus | null
  version: VersionRus | null
  /** true si hay versiones parecidas y ninguna sin dudas: se avisa y se abre el ajuste. */
  dudosa: boolean
  /** true si salió de la tabla de equivalencias de esta computadora. */
  guardada: boolean
}

async function vehiculoEnRus(cliente: ClienteRus, solicitud: SolicitudResuelta, elegidos: Record<string, string>, ajustes: AjusteDeAseguradora[]): Promise<VehiculoElegido> {
  const v = solicitud.vehiculo
  const tipos = TIPOS_DE_UNIDAD[v.tipo]
  const recordada = leerEquivalencia(equivalenciaGuardada(ID_RUS, v.codigoCatalogo)?.codigo)
  const tipoElegido = valido(elegidos.tipoUnidad, tipos)

  // El tipo de unidad: el elegido a mano, el recordado, o se prueba en orden hasta encontrar el modelo
  // (un auto que RUS tiene como pick-up no aparece entre los autos).
  let busqueda: BusquedaEnTipo | null = null
  const aProbar = tipoElegido ? [tipoElegido] : recordada && valido(recordada.tipoUnidad, tipos) ? [recordada.tipoUnidad] : tipos.map((t) => t.codigo)
  for (const tipoUnidad of aProbar) {
    // Lo elegido a mano (marca, modelo) se aplica en cada tipo si existe ahí: los ids de marca de RUS son los mismos en todos.
    const enEste = await buscarEnTipo(cliente, solicitud, tipoUnidad, elegidos)
    if (!busqueda) busqueda = enEste
    if (enEste.versiones.length > 0) {
      busqueda = enEste
      break
    }
  }
  const b = busqueda!

  ajustes.push({
    campo: 'tipoUnidad',
    titulo: 'Tipo de unidad en RUS',
    ayuda: 'Cómo clasifica RUS al vehículo. Las pick-ups están aparte de los autos: si no aparece el modelo, probá con «Pick-up».',
    opciones: opcionesDe(tipos),
    valor: b.tipoUnidad,
    obligatorio: true,
    porSolicitud: true,
  })
  ajustes.push({
    campo: 'marca',
    titulo: 'Marca en RUS',
    ayuda: b.marcas.length === 0 ? 'RUS no devolvió marcas para ese tipo de unidad.' : undefined,
    opciones: opcionesDe(b.marcas),
    valor: b.marca?.codigo ?? '',
    obligatorio: true,
    dependeDe: 'tipoUnidad',
    porSolicitud: true,
  })
  if (!b.marca) return { tipoUnidad: b.tipoUnidad, marca: null, modelo: null, version: null, dudosa: false, guardada: false }

  const ranking = rankear(textoParaBuscar(solicitud), b.versiones, (version) => `${version.modelo.descripcion} ${version.version.descripcion}`)
  const aMano = b.versiones.find((version) => version.version.codigo === elegidos.version)
  const porEquivalencia = !aMano && recordada ? b.versiones.find((version) => version.version.codigo === recordada.version) : undefined
  const sinDuda = sinDudas(ranking, 0.5, 0.1)
  const elegida = aMano ?? porEquivalencia ?? sinDuda ?? (b.versiones.length === 1 ? b.versiones[0]! : null)
  const dudosa = elegida === null && ranking.length > 0

  ajustes.push({
    campo: 'modelo',
    titulo: 'Modelo en RUS',
    ayuda: b.modelos.length === 0 ? `RUS no tiene modelos de esa marca para el año ${v.anio} en este tipo de unidad.` : undefined,
    opciones: opcionesDe(b.modelos),
    valor: valido(elegidos.modelo, b.modelos) ?? elegida?.modelo.codigo ?? b.candidatos[0]?.codigo ?? '',
    obligatorio: true,
    dependeDe: 'marca',
    porSolicitud: true,
  })
  // Las más parecidas primero: la que se busca casi siempre está entre las tres de arriba.
  const ordenadas = [...ranking.map((candidato) => candidato.opcion), ...b.versiones.filter((version) => !ranking.some((c) => c.opcion === version))]
  ajustes.push({
    campo: 'version',
    titulo: 'Versión en RUS',
    ayuda:
      b.versiones.length === 0
        ? `RUS no tiene versiones de ese modelo para el año ${v.anio}: probá con otro modelo o con otro tipo de unidad.`
        : 'La que identifica al vehículo en RUS (su número de modelo). Cotizar otra versión es cotizar otro vehículo.',
    opciones: ordenadas.map((version) => ({
      valor: version.version.codigo,
      texto: `${version.texto}${version.version.valor ? ` — ${enPesos(version.version.valor)}` : ''}`,
    })),
    valor: elegida?.version.codigo ?? '',
    obligatorio: true,
    dependeDe: 'modelo',
    porSolicitud: true,
  })

  return {
    tipoUnidad: b.tipoUnidad,
    marca: b.marca,
    modelo: elegida?.modelo ?? null,
    version: elegida?.version ?? null,
    dudosa,
    guardada: Boolean(porEquivalencia),
  }
}

// --- Cotizar ----------------------------------------------------------------------------------------

async function cotizar(solicitud: SolicitudResuelta, elegidos: Record<string, string>): Promise<CotizacionDeAseguradora> {
  const cuenta = cuentaActual()
  if (!cuenta) throw new ErrorDeRus('Falta cargar la cuenta de RUS en API Aseguradoras → RUS.', false)
  const cliente = crearClienteRus(cuentaDe(cuenta))
  const v = solicitud.vehiculo
  const ramo = RAMO_RUS[v.tipo]
  const ajustes: AjusteDeAseguradora[] = []
  const avisos: string[] = []
  const { facturacion, cuotas: cuotasPedidas, clausulaAjuste } = solicitud.condiciones

  // 1. Lo comercial, a la vista: vigencia, cuotas y ajuste automático. Arrancan en lo que dice el formulario.
  let vigencias = await enMemoria(`vigencias:${ramo}`, () => vigenciasRus(cliente, ramo)).catch((error: unknown) => {
    if (error instanceof ErrorDeRus && (error.esDeRed || error.status === 401 || error.status === 403)) throw error
    return [] as VigenciaRus[]
  })
  if (vigencias.length === 0) {
    vigencias = [VIGENCIA_DEL_EJEMPLO]
    avisos.push('RUS no devolvió sus vigencias: se cotizó con la de su ejemplo (semestral).')
  }
  const opcionesDeVigencia = vigencias.map((vig) => ({ codigo: vig.codigo, descripcion: textoDeVigencia(vig) }))
  const vigenciaCodigo = valido(elegidoBajo(elegidos.vigencia, facturacion), opcionesDeVigencia) ?? vigenciaPorDefecto(vigencias, facturacion)?.codigo ?? vigencias[0]!.codigo
  const vigencia = vigencias.find((vig) => vig.codigo === vigenciaCodigo)!
  ajustes.push(bajoElFormulario(facturacion, {
    campo: 'vigencia',
    titulo: 'Vigencia',
    ayuda: 'La vigencia de la póliza en RUS (trimestral, semestral, anual…). Cambia las cuotas posibles y el precio.',
    opciones: opcionesDe(opcionesDeVigencia),
    valor: vigenciaCodigo,
    obligatorio: true,
    destacado: true,
  }))

  const opcionesDeCuotas = cuotasDeLaVigencia(vigencia)
  const cuotas = valido(elegidoBajo(elegidos.cuotas, claveDeCuotas(cuotasPedidas)), opcionesDeCuotas) ?? cuotasPorDefecto(opcionesDeCuotas, cuotasPedidas)
  ajustes.push(bajoElFormulario(claveDeCuotas(cuotasPedidas), {
    campo: 'cuotas',
    titulo: 'Cuotas',
    ayuda: 'Las del formulario, si la vigencia las permite; si no, la mayor cantidad (una por mes de vigencia).',
    opciones: opcionesDe(opcionesDeCuotas),
    valor: cuotas,
    obligatorio: true,
    dependeDe: 'vigencia',
    destacado: true,
  }))

  const ajusteAutomatico = valido(elegidoBajo(elegidos.ajusteAutomatico, clausulaAjuste), AJUSTES_AUTOMATICOS_RUS) ?? ajusteAutomaticoPorDefecto(clausulaAjuste)
  ajustes.push(bajoElFormulario(clausulaAjuste, {
    campo: 'ajusteAutomatico',
    titulo: 'Ajuste automático',
    ayuda: 'El ajuste automático de la suma asegurada (la «cláusula de ajuste»). RUS cotiza con 20, 30 o 40 %.',
    opciones: opcionesDe(AJUSTES_AUTOMATICOS_RUS),
    valor: ajusteAutomatico,
    obligatorio: true,
    destacado: true,
  }))

  // 2. Lo técnico: condición fiscal, uso, países limítrofes y el vehículo.
  const { condicionIva } = solicitud.tomador
  const condicionFiscal = valido(elegidoBajo(elegidos.condicionFiscal, condicionIva), CONDICIONES_FISCALES_RUS) ?? CONDICION_FISCAL_RUS[condicionIva]
  ajustes.push(bajoElFormulario(condicionIva, {
    campo: 'condicionFiscal',
    titulo: 'Condición fiscal',
    opciones: opcionesDe(CONDICIONES_FISCALES_RUS),
    valor: condicionFiscal,
    obligatorio: true,
  }))

  const elegido = await vehiculoEnRus(cliente, solicitud, elegidos, ajustes)

  let usos = await enMemoria(`usos:${elegido.tipoUnidad}`, () => usosRus(cliente, elegido.tipoUnidad)).catch(() => [] as OpcionRus[])
  // RUS cotiza con el NOMBRE del uso («PARTICULAR»): es lo que va de código.
  usos = usos.length > 0 ? usos.map((uso) => ({ codigo: uso.descripcion, descripcion: uso.descripcion })) : USOS_RUS_POR_DEFECTO
  const uso = valido(elegidoBajo(elegidos.uso, v.uso), usos) ?? porUso(usos, v.uso)?.codigo ?? usos[0]!.codigo
  ajustes.push(bajoElFormulario(v.uso, {
    campo: 'uso',
    titulo: 'Uso en RUS',
    opciones: opcionesDe(usos),
    valor: uso,
    obligatorio: true,
    dependeDe: 'tipoUnidad',
  }))

  const limitrofes = elegidos.paisesLimitrofes === 'SI' ? 'SI' : 'NO'
  ajustes.push({
    campo: 'paisesLimitrofes',
    titulo: 'RC en países limítrofes',
    ayuda: 'Suma la cláusula de aumento de responsabilidad civil para viajar a países limítrofes.',
    opciones: [
      { valor: 'NO', texto: 'No' },
      { valor: 'SI', texto: 'Sí' },
    ],
    valor: limitrofes,
    obligatorio: false,
  })

  const codigoPostal = codigoPostalDeCuatro(solicitud.codigoPostal)
  const faltan = ajustes.filter((ajuste) => ajuste.obligatorio && !ajuste.valor)
  if (faltan.length > 0 || !elegido.version || !codigoPostal) {
    if (elegido.dudosa) avisos.push('Hay varias versiones parecidas en RUS y ninguna se parece lo suficiente: elegí la que corresponde.')
    const enMinuscula = (titulo: string) => titulo.charAt(0).toLowerCase() + titulo.slice(1)
    return {
      estado: 'FALTAN_DATOS',
      mensaje: faltan.length > 0 ? `Para cotizar, elegí: ${faltan.map((a) => enMinuscula(a.titulo)).join(', ')}.` : 'Para cotizar en RUS falta el código postal.',
      descripcionVehiculo: '',
      coberturas: [],
      avisos,
      ajustes,
      revisar: 'version',
    }
  }
  const version = elegido.version

  const datos: DatosDeCotizacionRus = {
    tipo: v.tipo,
    productor: cuenta.productor,
    solicitante: cuenta.solicitante,
    condicionFiscal,
    vigenciaDesde: solicitud.vigenciaDesde,
    vigenciaHasta: sumarMeses(solicitud.vigenciaDesde, mesesDe(vigencia)),
    vigenciaId: vigencia.codigo,
    cuotas: Number(cuotas),
    ajusteAutomatico: Number(ajusteAutomatico),
    paisesLimitrofes: limitrofes === 'SI',
    anio: v.anio,
    gnc: v.gnc,
    codigoPostal,
    modeloVehiculo: version.codigo,
    uso,
    numeroSolicitud: numeroDeSolicitud(),
  }
  const cotizacion = await cotizarRus(cliente, datos)

  const descripcionVehiculo = `${elegido.marca?.descripcion ?? v.marca} ${version.descripcion} ${v.anio} (modelo ${version.codigo} en RUS)`.replace(/\s+/g, ' ').trim()
  const detalleTecnico = {
    ambiente: cuenta.ambiente,
    productor: cuenta.productor,
    solicitante: cuenta.solicitante || cuenta.productor,
    endpoint: `POST ${RUTA_COTIZACION[v.tipo]}`,
    status: cotizacion.status,
    pedido: cotizacion.pedido,
    respuesta: cotizacion.cruda,
    vehiculoEnRus: {
      tipoUnidad: elegido.tipoUnidad,
      marca: elegido.marca ? `${elegido.marca.codigo} — ${elegido.marca.descripcion}` : null,
      modelo: elegido.modelo ? `${elegido.modelo.codigo} — ${elegido.modelo.descripcion}` : null,
      version: `${version.codigo} — ${version.descripcion}`,
    },
  }

  if (!cotizacion.ok) {
    const motivos = cotizacion.mensajes.length > 0 ? cotizacion.mensajes : ['no devolvió coberturas']
    const consejo = motivos.map(consejoParaElRechazo).find(Boolean)
    const porElVehiculo = /MODELO|VEHICULO|VERSION/.test(normalizarTexto(motivos.join(' ')))
    if (porElVehiculo) olvidarEquivalencia(ID_RUS, v.codigoCatalogo, codigoDeEquivalencia(elegido.tipoUnidad, version.codigo))
    return {
      estado: 'ERROR',
      mensaje: `RUS no cotizó: ${motivos.join(' · ')}.${consejo ? ` ${consejo}` : ''}`,
      descripcionVehiculo,
      coberturas: [],
      avisos,
      ajustes,
      ...(porElVehiculo ? { revisar: 'version' } : {}),
      detalleTecnico,
    }
  }

  // La tabla de equivalencias: lo elegido a mano, o lo elegido sin dudas, queda para este vehículo del
  // catálogo ahora que RUS lo cotizó.
  const descripcion = `${elegido.marca?.descripcion ?? ''} ${version.descripcion}`.trim()
  const equivalencia = codigoDeEquivalencia(elegido.tipoUnidad, version.codigo)
  if (elegidos.version === version.codigo) guardarEquivalencia(ID_RUS, v.codigoCatalogo, equivalencia, 'MANUAL', descripcion)
  else if (!elegido.guardada) guardarEquivalencia(ID_RUS, v.codigoCatalogo, equivalencia, 'AUTOMATICA', descripcion)

  const cantidadDeCuotas = Number(cuotas)
  const enCuotas = (premio: number) => (cantidadDeCuotas > 0 && premio > 0 ? Math.round((premio / cantidadDeCuotas) * 100) / 100 : null)
  const coberturas: CoberturaCotizada[] = cotizacion.coberturas.map((c) => ({
    aseguradora: ID_RUS,
    nombreAseguradora: NOMBRE,
    codigo: c.codigo,
    nombre: c.descripcion,
    categoria: c.categoria,
    premio: c.premio,
    prima: c.prima,
    primeraCuota: c.cuota ?? enCuotas(c.premio),
    cuota: c.cuota ?? enCuotas(c.premio),
    franquicia: c.franquicia,
    adicionales: c.adicionales,
    comision: null,
    bonificacionPorcentaje: null,
    recargoAdministrativoPorcentaje: null,
    // RUS se emite desde su web (la API de propuestas queda para más adelante).
    emision: null,
  }))

  // RUS cotiza con el valor de su tabla para la versión y el año.
  const sumaUsada = cotizacion.coberturas.find((c) => c.sumaAsegurada)?.sumaAsegurada ?? version.valor
  if (v.sumaAsegurada !== null && sumaUsada !== null && sumaUsada !== v.sumaAsegurada) {
    avisos.push(`RUS cotizó con su suma asegurada (${enPesos(sumaUsada)}), no con la del formulario (${enPesos(v.sumaAsegurada)}).`)
  }
  const resumen = [
    `Cotizado con vigencia ${vigencia.descripcion.toLowerCase()} en ${cantidadDeCuotas === 1 ? '1 pago' : `${cantidadDeCuotas} cuotas`}`,
    `ajuste automático ${ajusteAutomatico} %`,
    `productor ${cuenta.productor}`,
    `suma asegurada: la de RUS${sumaUsada ? ` (${enPesos(sumaUsada)})` : ''}`,
  ].join(', ')

  return {
    estado: 'OK',
    mensaje: `${resumen}.`,
    descripcionVehiculo,
    coberturas,
    avisos,
    ajustes,
    detalleTecnico,
  }
}

function cuentaDe(credenciales: CredencialesRus): CuentaRus {
  return { ambiente: credenciales.ambiente, usuario: credenciales.usuario, clave: credenciales.clave, apiKey: credenciales.apiKey }
}

export const rus: CotizadorDeAseguradora = {
  id: ID_RUS,
  nombre: NOMBRE,
  tipos: ['AUTO', 'MOTO'],
  emite: false,
  noDisponible: () => (cuentaActual() ? null : 'Falta cargar la cuenta de RUS en API Aseguradoras → RUS.'),
  cotizar,
}
