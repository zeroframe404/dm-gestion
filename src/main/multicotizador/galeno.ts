// Galeno en el multicotizador: traduce la solicitud común a su API REST (la misma que usa «Cotizar con
// Galeno» en Presupuestos, vía servicios/galeno.ts y el proxy del VPS) y devuelve sus coberturas en la
// forma común.
//
// Galeno pide cosas que la solicitud común no trae —plan comercial, modo de facturación, condición y
// forma de pago, su propio código de localidad—, y todas salen de listas que su API ya da. Acá se
// eligen SOLAS con un criterio razonable (la forma de pago que coincide con el medio elegido, el modo
// mensual, la localidad con ese nombre) y se devuelven como ajustes, para que la persona pueda cambiar
// cualquiera desde la tarjeta de Galeno sin volver a cargar nada.
//
// EL VEHÍCULO: si el catálogo de la agencia es el de InfoAuto, alcanza con su código (Galeno lo acepta
// en lugar del propio y es exacto). Si no, se busca en el catálogo de Galeno por nombre —marca, modelo y
// versión—, y cuando hay dudas se pregunta en vez de adivinar: cotizar otra versión es cotizar otro auto.
import {
  categoriaDeCobertura,
  type AjusteDeAseguradora,
  type CoberturaCotizada,
} from '../../shared/multicotizador'
import type { OpcionGaleno, SubModeloGaleno, TipoDeVehiculo } from '../../shared/tipos'
import {
  categoriasIvaGaleno,
  codigoPostalGaleno,
  condicionesDePagoGaleno,
  cotizarGaleno,
  equiposDeRastreoGaleno,
  formasDePagoGaleno,
  marcasGaleno,
  modelosGaleno,
  modosDeFacturacionGaleno,
  planesComercialesGaleno,
  subModelosGaleno,
  tiposDePersonaGaleno,
  tiposDeUsoGaleno,
} from '../servicios/galeno'
import type { CotizacionDeAseguradora, CotizadorDeAseguradora, SolicitudResuelta } from './aseguradora'
import {
  buscarLocalidad,
  buscarMarca,
  CLAVES_CONDICION_IVA,
  CLAVES_MEDIO_DE_PAGO,
  CLAVES_TIPO_DE_PERSONA,
  CLAVES_USO,
  porPalabrasClave,
  rankear,
  sinDudas,
  type OpcionDeLista,
} from './equivalencias'

const ID = 'GALENO'
const NOMBRE = 'Galeno'

// --- Las listas, en memoria ------------------------------------------------------------------------
//
// Las listas de valores de Galeno (planes, marcas, formas de pago…) cambian muy de vez en cuando, y el
// multicotizador las pide en cada cotización. Guardarlas media hora hace que la segunda cotización del
// mismo mostrador salga en lo que tarda UN pedido a Galeno en vez de diez. Si un pedido falla, no se
// guarda nada: el próximo vuelve a probar.

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

/** Para las pruebas: que cada una arranque sin lo que dejó la anterior. */
export function olvidarListasDeGaleno(): void {
  listas.clear()
}

// --- Los ajustes --------------------------------------------------------------------------------------

function opciones(lista: OpcionDeLista[]): AjusteDeAseguradora['opciones'] {
  return lista.map((opcion) => ({ valor: opcion.codigo, texto: opcion.descripcion }))
}

/** El elegido a mano, si todavía es una de las opciones (un cambio más arriba lo puede haber dejado afuera). */
function valido(elegido: string | undefined, lista: Array<{ codigo: string }>): string | null {
  return elegido && lista.some((opcion) => opcion.codigo === elegido) ? elegido : null
}

interface VehiculoParaGaleno {
  idInfoAuto: string | null
  version: SubModeloGaleno | null
}

async function vehiculoEnGaleno(
  solicitud: SolicitudResuelta,
  elegidos: Record<string, string>,
  ajustes: AjusteDeAseguradora[],
): Promise<VehiculoParaGaleno> {
  const v = solicitud.vehiculo
  const tipo: TipoDeVehiculo = v.tipo

  if (solicitud.codigoInfoAuto) {
    const origenes = [
      { codigo: 'INFOAUTO', descripcion: 'Por el código de InfoAuto (exacto)' },
      { codigo: 'CATALOGO', descripcion: 'Buscarlo en el catálogo de Galeno' },
    ]
    const origen = valido(elegidos.origenVehiculo, origenes) ?? 'INFOAUTO'
    ajustes.push({
      campo: 'origenVehiculo',
      titulo: 'Cómo identificar el vehículo',
      ayuda: 'El código de InfoAuto es exacto. Usá el catálogo de Galeno sólo si Galeno no reconoce el vehículo por su código.',
      opciones: opciones(origenes),
      valor: origen,
      obligatorio: true,
      porSolicitud: true,
    })
    if (origen === 'INFOAUTO') return { idInfoAuto: solicitud.codigoInfoAuto, version: null }
  }

  const dependeDeOrigen = solicitud.codigoInfoAuto ? 'origenVehiculo' : undefined
  const marcas = await enMemoria(`marcas:${tipo}`, () => marcasGaleno(tipo))
  const marca = valido(elegidos.marca, marcas) ?? buscarMarca(v.marca, marcas)?.codigo ?? ''
  ajustes.push({
    campo: 'marca',
    titulo: 'Marca en Galeno',
    opciones: opciones(marcas),
    valor: marca,
    obligatorio: true,
    porSolicitud: true,
    ...(dependeDeOrigen ? { dependeDe: dependeDeOrigen } : {}),
  })
  if (!marca) return { idInfoAuto: null, version: null }

  const modelos = await enMemoria(`modelos:${marca}`, () => modelosGaleno(marca))
  const modeloElegido = valido(elegidos.modelo, modelos)
  // Sin modelo elegido a mano, se miran los tres que más se parecen: el catálogo de Galeno suele
  // partir un modelo en varios («COROLLA», «COROLLA CROSS», «COROLLA 4P») y la versión buscada puede
  // estar en cualquiera.
  const candidatos = modeloElegido
    ? modelos.filter((modelo) => modelo.codigo === modeloElegido)
    : rankear(`${v.modelo} ${v.version}`, modelos, (modelo) => modelo.descripcion)
        .filter((candidato) => candidato.puntaje >= 0.3)
        .slice(0, 3)
        .map((candidato) => candidato.opcion)

  interface Version {
    modelo: OpcionGaleno
    sub: SubModeloGaleno
    clave: string
    texto: string
  }
  const versiones: Version[] = []
  for (const modelo of candidatos) {
    const subs = await enMemoria(`versiones:${marca}:${modelo.codigo}:${v.anio}`, () => subModelosGaleno(marca, modelo.codigo, v.anio)).catch(
      () => [] as SubModeloGaleno[],
    )
    for (const sub of subs) {
      versiones.push({
        modelo,
        sub,
        clave: `${sub.codigoMarca}|${sub.codigoModelo}|${sub.codigoSubModelo}`,
        texto: `${modelo.descripcion} · ${sub.version}`,
      })
    }
  }

  const ranking = rankear(`${v.modelo} ${v.version}`, versiones, (version) => `${version.modelo.descripcion} ${version.sub.version}`)
  const elegida =
    versiones.find((version) => version.clave === elegidos.version) ??
    sinDudas(ranking, 0.5, 0.1) ??
    (versiones.length === 1 ? versiones[0]! : null)

  ajustes.push({
    campo: 'modelo',
    titulo: 'Modelo en Galeno',
    opciones: opciones(modelos),
    valor: modeloElegido ?? elegida?.modelo.codigo ?? candidatos[0]?.codigo ?? '',
    obligatorio: true,
    dependeDe: 'marca',
    porSolicitud: true,
  })
  // Las más parecidas primero: la que se busca casi siempre está entre las tres de arriba.
  const ordenadas = [...ranking.map((candidato) => candidato.opcion), ...versiones.filter((version) => !ranking.some((c) => c.opcion === version))]
  ajustes.push({
    campo: 'version',
    titulo: 'Versión en Galeno',
    ayuda: versiones.length === 0 ? `Galeno no tiene versiones de ese modelo para el año ${v.anio}: probá con otro modelo de su lista.` : undefined,
    opciones: ordenadas.map((version) => ({ valor: version.clave, texto: version.texto })),
    valor: elegida?.clave ?? '',
    obligatorio: true,
    dependeDe: 'modelo',
    porSolicitud: true,
  })
  return { idInfoAuto: null, version: elegida?.sub ?? null }
}

async function cotizar(solicitud: SolicitudResuelta, elegidos: Record<string, string>): Promise<CotizacionDeAseguradora> {
  const tipo = solicitud.vehiculo.tipo
  const ajustes: AjusteDeAseguradora[] = []

  // Plan comercial → modo de facturación → condición y forma de pago: cada lista depende de la anterior.
  const planes = await enMemoria(`planes:${tipo}`, () => planesComercialesGaleno(tipo))
  const plan = valido(elegidos.planComercial, planes) ?? planes[0]?.codigo ?? ''
  ajustes.push({ campo: 'planComercial', titulo: 'Plan comercial', opciones: opciones(planes), valor: plan, obligatorio: true })

  const modos = plan ? await enMemoria(`modos:${tipo}:${plan}`, () => modosDeFacturacionGaleno(tipo, plan)) : []
  // Mensual es lo que se vende en el mostrador casi siempre; si Galeno no lo ofrece, el primero.
  const modo = valido(elegidos.modoFacturacion, modos) ?? porPalabrasClave(modos, ['MENSUAL'])?.codigo ?? modos[0]?.codigo ?? ''
  ajustes.push({ campo: 'modoFacturacion', titulo: 'Modo de facturación', opciones: opciones(modos), valor: modo, obligatorio: true, dependeDe: 'planComercial' })

  const [condiciones, formas] = modo
    ? await Promise.all([
        enMemoria(`condiciones:${tipo}:${modo}`, () => condicionesDePagoGaleno(tipo, modo)),
        enMemoria(`formas:${tipo}:${modo}:${plan}`, () => formasDePagoGaleno(tipo, modo, plan)),
      ])
    : [[], []]
  const condicion = valido(elegidos.condicionPago, condiciones) ?? condiciones[0]?.codigo ?? ''
  ajustes.push({ campo: 'condicionPago', titulo: 'Condición de pago', opciones: opciones(condiciones), valor: condicion, obligatorio: true, dependeDe: 'modoFacturacion' })
  const forma =
    valido(elegidos.formaPago, formas) ?? porPalabrasClave(formas, CLAVES_MEDIO_DE_PAGO[solicitud.medioDePago])?.codigo ?? formas[0]?.codigo ?? ''
  ajustes.push({ campo: 'formaPago', titulo: 'Forma de pago', opciones: opciones(formas), valor: forma, obligatorio: true, dependeDe: 'modoFacturacion' })

  // Las listas cortas: tipo de persona, IVA y uso. El IVA y el uso son opcionales en la API de Galeno —si
  // no se reconocen se mandan sin ellos y Galeno usa los suyos por defecto.
  const [personas, ivas, usos] = await Promise.all([
    enMemoria('personas', () => tiposDePersonaGaleno()),
    enMemoria('ivas', () => categoriasIvaGaleno()),
    enMemoria('usos', () => tiposDeUsoGaleno()),
  ])
  const persona =
    valido(elegidos.tipoPersona, personas) ??
    porPalabrasClave(personas, CLAVES_TIPO_DE_PERSONA[solicitud.tomador.tipoPersona])?.codigo ??
    personas[0]?.codigo ??
    ''
  ajustes.push({ campo: 'tipoPersona', titulo: 'Tipo de persona', opciones: opciones(personas), valor: persona, obligatorio: true })
  const iva = valido(elegidos.categoriaIva, ivas) ?? porPalabrasClave(ivas, CLAVES_CONDICION_IVA[solicitud.tomador.condicionIva])?.codigo ?? ''
  ajustes.push({ campo: 'categoriaIva', titulo: 'Condición de IVA', opciones: opciones(ivas), valor: iva, obligatorio: false })
  const uso = valido(elegidos.tipoUso, usos) ?? porPalabrasClave(usos, CLAVES_USO[solicitud.vehiculo.uso])?.codigo ?? ''
  ajustes.push({ campo: 'tipoUso', titulo: 'Uso del vehículo', opciones: opciones(usos), valor: uso, obligatorio: false })

  // La localidad: Galeno tiene su propio sub-código por localidad dentro del código postal.
  const localidades = await enMemoria(`cp:${tipo}:${solicitud.codigoPostal}`, () => codigoPostalGaleno(tipo, solicitud.codigoPostal))
  const listaDeLocalidades = localidades.map((l) => ({ codigo: l.subCodigoPostal, descripcion: l.localidad }))
  const localidad =
    valido(elegidos.localidad, listaDeLocalidades) ??
    buscarLocalidad(solicitud.localidad, listaDeLocalidades, (l) => l.descripcion)?.codigo ??
    ''
  ajustes.push({
    campo: 'localidad',
    titulo: 'Localidad en Galeno',
    ayuda: localidades.length === 0 ? `Galeno no reconoce el código postal ${solicitud.codigoPostal}.` : undefined,
    opciones: opciones(listaDeLocalidades),
    valor: localidad,
    obligatorio: true,
    porSolicitud: true,
  })

  let rastreo = ''
  if (solicitud.vehiculo.rastreo) {
    const equipos = await enMemoria('rastreo', () => equiposDeRastreoGaleno())
    rastreo = valido(elegidos.equipoRastreo, equipos) ?? equipos[0]?.codigo ?? ''
    ajustes.push({ campo: 'equipoRastreo', titulo: 'Equipo de rastreo', opciones: opciones(equipos), valor: rastreo, obligatorio: false })
  }

  const vehiculo = await vehiculoEnGaleno(solicitud, elegidos, ajustes)

  const faltan = ajustes.filter((ajuste) => ajuste.obligatorio && !ajuste.valor)
  if (faltan.length > 0) {
    return {
      estado: 'FALTAN_DATOS',
      mensaje: `Para cotizar, elegí: ${faltan.map((ajuste) => ajuste.titulo.toLowerCase()).join(', ')}.`,
      descripcionVehiculo: '',
      coberturas: [],
      avisos: [],
      ajustes,
    }
  }

  const v = solicitud.vehiculo
  const cotizacion = await cotizarGaleno({
    tipoVehiculo: tipo,
    planComercialCodigo: plan,
    ceroKm: v.ceroKm,
    idInfoAuto: vehiculo.idInfoAuto,
    marcaCodigo: vehiculo.version ? String(vehiculo.version.codigoMarca) : undefined,
    // El modelo que se cotiza es el de la VERSIÓN: cada sub-modelo trae su propio código de modelo.
    modeloCodigo: vehiculo.version ? String(vehiculo.version.codigoModelo) : undefined,
    subModeloCodigo: vehiculo.version ? String(vehiculo.version.codigoSubModelo) : undefined,
    anioFabricacion: v.anio,
    tomadorTipoPersona: persona,
    // Galeno exige un nombre para abrir la solicitud; para una cotización rápida alcanza con uno genérico.
    tomadorNombre: solicitud.tomador.nombre || 'COTIZACION',
    codigoPostal: solicitud.codigoPostal,
    subCodigoPostal: localidad,
    condicionPagoCodigo: condicion,
    vigenciaDesde: solicitud.vigenciaDesde,
    modoFacturacionCodigo: modo,
    formaPagoCodigo: forma,
    sumaAsegurada: v.sumaAsegurada ?? undefined,
    tipoUso: uso || undefined,
    poseeEquipoGnc: v.gnc,
    equipoGncValor: v.gnc && v.valorGnc !== null ? v.valorGnc : undefined,
    poseeEquipoRastreo: v.rastreo,
    equipoRastreoCodigo: rastreo || undefined,
    tomadorCategoriaIVACodigo: iva || undefined,
  })

  const coberturas: CoberturaCotizada[] = cotizacion.coberturas.map((c) => ({
    aseguradora: ID,
    nombreAseguradora: NOMBRE,
    codigo: c.cobertura,
    nombre: c.descripcionCobertura,
    categoria: categoriaDeCobertura(c.descripcionCobertura, c.cobertura),
    premio: c.premio,
    prima: c.prima,
    primeraCuota: c.importeCuota1 > 0 ? c.importeCuota1 : null,
    cuota: c.importeRestoCuotas > 0 ? c.importeRestoCuotas : null,
    franquicia: c.franquicia,
    adicionales: c.listaAdicionales.filter((adicional) => adicional.trim()),
    comision: c.comision,
    // El número de solicitud es de ESTA cotización: es lo que Galeno necesita para emitir sin volver a
    // cotizar. Sin él no hay emisión posible desde acá.
    emision:
      cotizacion.solicitud > 0
        ? {
            tipo: 'GALENO',
            rama: cotizacion.rama,
            solicitud: cotizacion.solicitud,
            instalacion: cotizacion.instalacion,
            cobertura: c,
            codigoPostal: solicitud.codigoPostal,
            subCodigoPostal: localidad,
          }
        : null,
  }))

  const avisos = [
    ...cotizacion.excepciones.map((excepcion) => excepcion.detalle || excepcion.observaciones || '').filter((aviso) => aviso.trim()),
    ...(cotizacion.errores ?? []),
  ]

  return {
    estado: 'OK',
    mensaje: coberturas.length === 0 ? 'Galeno no devolvió coberturas para estos datos.' : null,
    descripcionVehiculo: cotizacion.descripcionVehiculo,
    coberturas,
    avisos,
    ajustes,
  }
}

export const galeno: CotizadorDeAseguradora = {
  id: ID,
  nombre: NOMBRE,
  tipos: ['AUTO', 'MOTO'],
  emite: true,
  // La cuenta vive en el VPS y trae una de fábrica: desde esta computadora siempre se puede intentar.
  // Si el servidor no contesta, el error sale en la tarjeta de Galeno, no acá.
  noDisponible: () => null,
  async localidades(tipo, codigoPostal) {
    const lista = await enMemoria(`cp:${tipo}:${codigoPostal}`, () => codigoPostalGaleno(tipo, codigoPostal))
    return lista.map((localidad) => localidad.localidad)
  },
  cotizar,
}
