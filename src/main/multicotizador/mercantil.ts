// Mercantil Andina en el multicotizador: traduce la solicitud común a su API REST (`POST
// cotizaciones/v2/automotores`, ver aseguradoras/mercantil/cotizacion.ts) y devuelve sus coberturas en
// la forma común. Sólo cotiza autos; no emite (la póliza se emite desde la web de Mercantil).
//
// Lo que Mercantil pide y la solicitud común no trae —las cuotas, su forma de pago, su código de uso y
// de IVA, y sobre todo SU código del vehículo— se elige solo con un criterio razonable y se devuelve
// como ajuste, para cambiarlo desde la tarjeta de Mercantil, igual que en Galeno y en ATM.
//
// EL VEHÍCULO: Mercantil lo identifica por su código de InfoAuto, y su catálogo (vehiculos/v1) va por
// marca → modelos del año → versiones. Se busca por nombre como en Galeno —marca, modelo y versión del
// catálogo de la agencia— y ante la duda se pregunta en vez de adivinar. Lo elegido a mano (o sin
// dudas, si Mercantil cotizó) queda en la tabla de equivalencias para ese vehículo del catálogo.
import {
  categoriaDeCobertura,
  enPesos,
  normalizarTexto,
  type AjusteDeAseguradora,
  type CoberturaCotizada,
  type CondicionIva,
  type MedioDePago,
  type UsoDelVehiculo,
} from '../../shared/multicotizador'
import { marcasMercantil, modelosMercantil, versionesMercantil, type OpcionMercantil, type VersionMercantil } from '../aseguradoras/mercantil/catalogos'
import { crearClienteMercantil, ErrorDeMercantil, type ClienteMercantil, type CuentaMercantil } from '../aseguradoras/mercantil/cliente'
import { cotizarMercantil, RUTA_COTIZACION, type DatosDeCotizacionMercantil } from '../aseguradoras/mercantil/cotizacion'
import { credencialesMercantil } from '../servicios/config'
import type { CotizacionDeAseguradora, CotizadorDeAseguradora, SolicitudResuelta } from './aseguradora'
import { buscarMarca, rankear, sinDudas, type OpcionDeLista } from './equivalencias'
import { equivalenciaGuardada, guardarEquivalencia, olvidarEquivalencia } from './equivalenciasGuardadas'

export const ID_MERCANTIL = 'MERCANTIL'
const NOMBRE = 'Mercantil Andina'

// --- Las listas, en memoria ----------------------------------------------------------------------------
//
// Las marcas y los modelos cambian muy de vez en cuando: guardarlos media hora hace que la segunda
// cotización no los vuelva a pedir. Si un pedido falla no se guarda nada.

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
export function olvidarListasDeMercantil(): void {
  listas.clear()
}

type CredencialesMercantil = NonNullable<ReturnType<typeof credencialesMercantil>>
let cuentaDePrueba: CredencialesMercantil | null = null

/** Las pruebas (y el humo en vivo) corren sin Electron ni config.json: les pasan la cuenta acá. */
export function usarCuentaDeMercantilDePrueba(cuenta: CredencialesMercantil | null): void {
  cuentaDePrueba = cuenta
  listas.clear()
}

function cuentaActual(): CredencialesMercantil | null {
  return cuentaDePrueba ?? credencialesMercantil()
}

// --- Las decisiones, puras (se prueban solas) ---------------------------------------------------------

/** Las formas de pago de la API de Mercantil, por medio de pago de la solicitud. */
export const FORMAS_DE_PAGO_MERCANTIL: OpcionDeLista[] = [
  { codigo: 'TC', descripcion: 'Tarjeta de crédito' },
  { codigo: 'CBU', descripcion: 'Débito automático (CBU)' },
  { codigo: 'EF', descripcion: 'Efectivo / cupón de pago' },
]
export const FORMA_DE_PAGO_POR_MEDIO: Record<MedioDePago, string> = { TARJETA: 'TC', DEBITO: 'CBU', EFECTIVO: 'EF' }

/** Las cuotas que se pueden pedir. Con tarjeta o CBU la póliza anual se compara en 12 cuotas; en efectivo, de contado. */
export const CUOTAS_MERCANTIL: OpcionDeLista[] = [
  { codigo: '1', descripcion: '1 pago' },
  { codigo: '3', descripcion: '3 cuotas' },
  { codigo: '6', descripcion: '6 cuotas' },
  { codigo: '12', descripcion: '12 cuotas' },
]

export function cuotasPorDefecto(medio: MedioDePago): string {
  return medio === 'EFECTIVO' ? '1' : '12'
}

/** Las condiciones de IVA con los códigos de Mercantil. */
export const IVA_MERCANTIL: Record<CondicionIva, string> = {
  CONSUMIDOR_FINAL: 'CF',
  RESPONSABLE_INSCRIPTO: 'RI',
  MONOTRIBUTO: 'MT',
  EXENTO: 'EX',
}
export const IVAS_MERCANTIL: OpcionDeLista[] = [
  { codigo: 'CF', descripcion: 'Consumidor final' },
  { codigo: 'RI', descripcion: 'Responsable inscripto' },
  { codigo: 'MT', descripcion: 'Monotributo' },
  { codigo: 'EX', descripcion: 'Exento' },
]

/** Los usos de Mercantil. */
export const USOS_MERCANTIL: OpcionDeLista[] = [
  { codigo: '1', descripcion: 'Particular' },
  { codigo: '2', descripcion: 'Comercial' },
]
export const USO_POR_DEFECTO: Record<UsoDelVehiculo, string> = { PARTICULAR: '1', COMERCIAL: '2' }

function valido(valor: string | undefined, lista: OpcionDeLista[]): string | null {
  return valor && lista.some((opcion) => opcion.codigo === valor) ? valor : null
}

function opcionesDe(lista: OpcionDeLista[]): Array<{ valor: string; texto: string }> {
  return lista.map((opcion) => ({ valor: opcion.codigo, texto: opcion.descripcion }))
}

/** El texto con que se busca la versión: modelo y versión del catálogo de la agencia. */
export function textoParaBuscar(solicitud: SolicitudResuelta): string {
  const v = solicitud.vehiculo
  return `${v.modelo} ${v.version}`.trim()
}

interface VehiculoElegido {
  marca: OpcionMercantil | null
  modelo: OpcionMercantil | null
  version: VersionMercantil | null
  /** true si se eligió sola con dudas (hay otras parecidas): se avisa y se abre el ajuste. */
  dudosa: boolean
  /** true si salió de la tabla de equivalencias de esta computadora. */
  guardada: boolean
}

async function vehiculoEnMercantil(
  cliente: ClienteMercantil,
  solicitud: SolicitudResuelta,
  elegidos: Record<string, string>,
  ajustes: AjusteDeAseguradora[],
): Promise<VehiculoElegido> {
  const v = solicitud.vehiculo
  const anio = v.anio
  const marcas = await enMemoria(`marcas:${anio}`, () => marcasMercantil(cliente, anio))
  const marcaCodigo = valido(elegidos.marca, marcas) ?? buscarMarca(v.marca, marcas)?.codigo ?? ''
  ajustes.push({
    campo: 'marca',
    titulo: 'Marca en Mercantil',
    ayuda: marcas.length === 0 ? `Mercantil no devolvió marcas para el año ${anio}.` : undefined,
    opciones: opcionesDe(marcas),
    valor: marcaCodigo,
    obligatorio: true,
    porSolicitud: true,
  })
  const marca = marcas.find((m) => m.codigo === marcaCodigo) ?? null
  if (!marca) return { marca: null, modelo: null, version: null, dudosa: false, guardada: false }

  const modelos = await enMemoria(`modelos:${marca.codigo}:${anio}`, () => modelosMercantil(cliente, marca.codigo, anio))
  const modeloElegido = valido(elegidos.modelo, modelos)
  // Sin modelo elegido a mano, se miran los tres que más se parecen: el catálogo suele partir un
  // modelo en varios («COROLLA», «COROLLA CROSS») y la versión buscada puede estar en cualquiera.
  const candidatos = modeloElegido
    ? modelos.filter((modelo) => modelo.codigo === modeloElegido)
    : rankear(textoParaBuscar(solicitud), modelos, (modelo) => modelo.descripcion)
        .filter((candidato) => candidato.puntaje >= 0.3)
        .slice(0, 3)
        .map((candidato) => candidato.opcion)

  interface Version {
    modelo: OpcionMercantil
    version: VersionMercantil
    texto: string
  }
  const versiones: Version[] = []
  for (const modelo of candidatos) {
    const lista = await enMemoria(`versiones:${marca.codigo}:${anio}:${modelo.codigo}`, () => versionesMercantil(cliente, marca.codigo, anio, modelo.codigo)).catch(
      () => [] as VersionMercantil[],
    )
    for (const version of lista) versiones.push({ modelo, version, texto: `${modelo.descripcion} · ${version.descripcion}` })
  }

  const ranking = rankear(textoParaBuscar(solicitud), versiones, (version) => `${version.modelo.descripcion} ${version.version.descripcion}`)
  const recordada = equivalenciaGuardada(ID_MERCANTIL, v.codigoCatalogo)
  const aMano = versiones.find((version) => version.version.codigoInfoAuto === elegidos.version)
  const porEquivalencia = !aMano && recordada ? versiones.find((version) => version.version.codigoInfoAuto === recordada.codigo) : undefined
  const sinDuda = sinDudas(ranking, 0.5, 0.1)
  const elegida = aMano ?? porEquivalencia ?? sinDuda ?? (versiones.length === 1 ? versiones[0]! : null)
  const dudosa = !aMano && !porEquivalencia && !sinDuda && elegida === null && ranking.length > 0

  ajustes.push({
    campo: 'modelo',
    titulo: 'Modelo en Mercantil',
    opciones: opcionesDe(modelos),
    valor: modeloElegido ?? elegida?.modelo.codigo ?? candidatos[0]?.codigo ?? '',
    obligatorio: true,
    dependeDe: 'marca',
    porSolicitud: true,
  })
  // Las más parecidas primero: la que se busca casi siempre está entre las tres de arriba.
  const ordenadas = [...ranking.map((candidato) => candidato.opcion), ...versiones.filter((version) => !ranking.some((c) => c.opcion === version))]
  ajustes.push({
    campo: 'version',
    titulo: 'Versión en Mercantil',
    ayuda:
      versiones.length === 0
        ? `Mercantil no tiene versiones de ese modelo para el año ${anio}: probá con otro modelo de su lista.`
        : 'La que identifica al vehículo en Mercantil (su código de InfoAuto). Cotizar otra versión es cotizar otro auto.',
    opciones: ordenadas.map((version) => ({ valor: version.version.codigoInfoAuto, texto: `${version.texto} (InfoAuto ${version.version.codigoInfoAuto})` })),
    valor: elegida?.version.codigoInfoAuto ?? '',
    obligatorio: true,
    dependeDe: 'modelo',
    porSolicitud: true,
  })

  return {
    marca,
    modelo: elegida?.modelo ?? null,
    version: elegida?.version ?? null,
    dudosa,
    guardada: Boolean(porEquivalencia),
  }
}

/** Lo que conviene revisar según lo que dijo Mercantil al rechazar. */
export function consejoParaElRechazo(mensaje: string): string {
  const texto = normalizarTexto(mensaje)
  if (/CREDENCIAL|TOKEN|AUTORIZ|NO AUTENTICADO/.test(texto)) return 'Revisá la cuenta en API Aseguradoras → Mercantil («Probar conexión»).'
  if (/PRODUCTOR|PAS\b/.test(texto)) return 'Revisá el código de productor cargado en API Aseguradoras → Mercantil: tiene que ser el PAS vinculado al usuario.'
  if (/VEHICULO|INFOAUTO|VERSION|MODELO/.test(texto)) return 'Elegí otra versión en los ajustes de Mercantil.'
  if (/POSTAL|LOCALIDAD|ZONA/.test(texto)) return 'Revisá el código postal y la localidad.'
  if (/CUOTA|PAGO/.test(texto)) return 'Probá con otras cuotas o forma de pago en los ajustes de Mercantil.'
  return ''
}

// --- Cotizar ----------------------------------------------------------------------------------------

async function cotizar(solicitud: SolicitudResuelta, elegidos: Record<string, string>): Promise<CotizacionDeAseguradora> {
  const cuenta = cuentaActual()
  if (!cuenta) throw new ErrorDeMercantil('Falta cargar la cuenta de Mercantil Andina en API Aseguradoras → Mercantil.', false)
  const cliente = crearClienteMercantil(cuentaDe(cuenta))
  const v = solicitud.vehiculo
  const ajustes: AjusteDeAseguradora[] = []
  const avisos: string[] = []

  // Lo comercial, a la vista: cuotas y forma de pago.
  const cuotas = valido(elegidos.cuotas, CUOTAS_MERCANTIL) ?? cuotasPorDefecto(solicitud.medioDePago)
  ajustes.push({
    campo: 'cuotas',
    titulo: 'Cuotas',
    ayuda: 'Con tarjeta o débito se compara en 12 cuotas, como en la web de Mercantil; en efectivo, de contado.',
    opciones: opcionesDe(CUOTAS_MERCANTIL),
    valor: cuotas,
    obligatorio: true,
    destacado: true,
  })
  const formaDePago = valido(elegidos.formaDePago, FORMAS_DE_PAGO_MERCANTIL) ?? FORMA_DE_PAGO_POR_MEDIO[solicitud.medioDePago]
  ajustes.push({
    campo: 'formaDePago',
    titulo: 'Forma de pago',
    opciones: opcionesDe(FORMAS_DE_PAGO_MERCANTIL),
    valor: formaDePago,
    obligatorio: true,
    destacado: true,
  })

  // Lo técnico: IVA, uso.
  const iva = valido(elegidos.iva, IVAS_MERCANTIL) ?? IVA_MERCANTIL[solicitud.tomador.condicionIva]
  ajustes.push({ campo: 'iva', titulo: 'Condición de IVA', opciones: opcionesDe(IVAS_MERCANTIL), valor: iva, obligatorio: false })
  const uso = valido(elegidos.uso, USOS_MERCANTIL) ?? USO_POR_DEFECTO[v.uso]
  ajustes.push({ campo: 'uso', titulo: 'Uso en Mercantil', opciones: opcionesDe(USOS_MERCANTIL), valor: uso, obligatorio: false })

  const elegido = await vehiculoEnMercantil(cliente, solicitud, elegidos, ajustes)

  const faltan = ajustes.filter((ajuste) => ajuste.obligatorio && !ajuste.valor)
  if (faltan.length > 0 || !elegido.version) {
    if (elegido.dudosa) avisos.push('Hay varias versiones parecidas en Mercantil y ninguna se parece lo suficiente: elegí la que corresponde.')
    return {
      estado: 'FALTAN_DATOS',
      mensaje: `Para cotizar, elegí: ${(faltan.length > 0 ? faltan : ajustes.filter((a) => a.campo === 'version')).map((a) => a.titulo.toLowerCase()).join(', ')}.`,
      descripcionVehiculo: '',
      coberturas: [],
      avisos,
      ajustes,
      revisar: 'version',
    }
  }
  const version = elegido.version

  const datos: DatosDeCotizacionMercantil = {
    productor: cuenta.productor || undefined,
    codigoInfoAuto: version.codigoInfoAuto,
    anio: Number(v.anio),
    ceroKm: v.ceroKm,
    uso,
    gnc: v.gnc,
    valorGnc: v.gnc && v.valorGnc !== null ? v.valorGnc : undefined,
    rastreo: v.rastreo,
    sumaAsegurada: v.sumaAsegurada ?? undefined,
    codigoPostal: solicitud.codigoPostal,
    localidad: solicitud.localidad,
    vigenciaDesde: solicitud.vigenciaDesde,
    cuotas: Number(cuotas),
    formaDePago,
    tipoPersona: solicitud.tomador.tipoPersona === 'JURIDICA' ? 'J' : 'F',
    iva,
  }
  const cotizacion = await cotizarMercantil(cliente, datos)

  const descripcionVehiculo = `${elegido.marca?.descripcion ?? v.marca} ${elegido.modelo?.descripcion ?? ''} ${version.descripcion} ${v.anio} (InfoAuto ${version.codigoInfoAuto})`.replace(/\s+/g, ' ').trim()
  const detalleTecnico = {
    ambiente: cuenta.ambiente,
    productor: cuenta.productor || '(el del usuario)',
    endpoint: `POST ${RUTA_COTIZACION}`,
    cotizacion: cotizacion.id,
    pedido: cotizacion.pedido,
    respuesta: cotizacion.cruda,
    vehiculoEnMercantil: {
      marca: elegido.marca ? `${elegido.marca.codigo} — ${elegido.marca.descripcion}` : null,
      modelo: elegido.modelo ? `${elegido.modelo.codigo} — ${elegido.modelo.descripcion}` : null,
      version: `${version.codigoInfoAuto} — ${version.descripcion}`,
    },
  }

  if (!cotizacion.ok) {
    const motivos = cotizacion.mensajes.length > 0 ? cotizacion.mensajes : ['no devolvió coberturas']
    const consejo = motivos.map(consejoParaElRechazo).find(Boolean)
    const sinEntender = cotizacion.cruda !== null && cotizacion.mensajes.length === 0
    if (sinEntender) olvidarEquivalencia(ID_MERCANTIL, v.codigoCatalogo, version.codigoInfoAuto)
    return {
      estado: 'ERROR',
      mensaje: `Mercantil no cotizó: ${motivos.join(' · ')}.${consejo ? ` ${consejo}` : ''}${sinEntender ? ' Si la respuesta trae precios, «Copiar datos para Mercantil Andina» muestra con qué forma vinieron.' : ''}`,
      descripcionVehiculo,
      coberturas: [],
      avisos,
      ajustes,
      ...(/VEHICULO|INFOAUTO|VERSION/.test(normalizarTexto(motivos.join(' '))) ? { revisar: 'version' } : {}),
      detalleTecnico,
    }
  }

  // La tabla de equivalencias: lo elegido a mano, o lo elegido sin dudas, queda para este vehículo del
  // catálogo ahora que Mercantil lo cotizó.
  const descripcion = `${elegido.marca?.descripcion ?? ''} ${elegido.modelo?.descripcion ?? ''} ${version.descripcion}`.trim()
  if (elegidos.version === version.codigoInfoAuto) guardarEquivalencia(ID_MERCANTIL, v.codigoCatalogo, version.codigoInfoAuto, 'MANUAL', descripcion)
  else if (!elegido.guardada) guardarEquivalencia(ID_MERCANTIL, v.codigoCatalogo, version.codigoInfoAuto, 'AUTOMATICA', descripcion)

  const cantidadDeCuotas = Number(cuotas)
  const enCuotas = (premio: number) => (cantidadDeCuotas > 0 && premio > 0 ? Math.round((premio / cantidadDeCuotas) * 100) / 100 : null)
  const coberturas: CoberturaCotizada[] = cotizacion.coberturas.map((c) => ({
    aseguradora: ID_MERCANTIL,
    nombreAseguradora: NOMBRE,
    codigo: c.codigo,
    nombre: c.descripcion,
    categoria: categoriaDeCobertura(c.descripcion, c.codigo),
    premio: c.premio,
    prima: c.prima,
    primeraCuota: c.cuota ?? enCuotas(c.premio),
    cuota: c.cuota ?? enCuotas(c.premio),
    franquicia: c.franquicia,
    adicionales: [],
    comision: c.comision,
    bonificacionPorcentaje: null,
    recargoAdministrativoPorcentaje: null,
    // Mercantil se emite desde su web: la cotización queda en su sistema con el número de abajo.
    emision: null,
  }))
  avisos.push(...cotizacion.mensajes)

  const textoDe = (lista: OpcionDeLista[], codigo: string) => lista.find((o) => o.codigo === codigo)?.descripcion ?? codigo
  const sumaUsada = v.sumaAsegurada ?? cotizacion.sumaAsegurada ?? cotizacion.coberturas.find((c) => c.sumaAsegurada)?.sumaAsegurada ?? null
  const resumen = [
    `Cotizado en ${textoDe(CUOTAS_MERCANTIL, cuotas)} con ${textoDe(FORMAS_DE_PAGO_MERCANTIL, formaDePago).toLowerCase()}`,
    cuenta.productor ? `productor ${cuenta.productor}` : 'con el productor del usuario',
    v.sumaAsegurada !== null
      ? `suma asegurada ${enPesos(v.sumaAsegurada)} (la cargada en el formulario)`
      : `suma asegurada: la de Mercantil${sumaUsada ? ` (${enPesos(sumaUsada)})` : ''}`,
    cotizacion.id ? `cotización ${cotizacion.id} en Mercantil` : '',
  ]
    .filter(Boolean)
    .join(', ')

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

function cuentaDe(credenciales: CredencialesMercantil): CuentaMercantil {
  return { ambiente: credenciales.ambiente, usuario: credenciales.usuario, clave: credenciales.clave, claveDeSuscripcion: credenciales.claveDeSuscripcion }
}

export const mercantil: CotizadorDeAseguradora = {
  id: ID_MERCANTIL,
  nombre: NOMBRE,
  tipos: ['AUTO'],
  emite: false,
  noDisponible: () => (cuentaActual() ? null : 'Falta cargar la cuenta de Mercantil Andina en API Aseguradoras → Mercantil.'),
  cotizar,
}
