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
// EL VEHÍCULO: si salió del catálogo de la agencia con un código de Galeno («GALENO:rama:marca:modelo:
// versión», con el modelo de la versión; ver catalogoVehiculos.ts), ése es el vehículo exacto en Galeno. Si no, se busca en el
// catálogo de Galeno por nombre —marca, modelo y versión—, y cuando hay dudas se pregunta en vez de
// adivinar: cotizar otra versión es cotizar otro auto.
import {
  categoriaDeCobertura,
  enPesos,
  normalizarTexto,
  rangoDePorcentajes,
  type AjusteDeAseguradora,
  type CoberturaCotizada,
} from '../../shared/multicotizador'
import { RAMA_GALENO_DE_TIPO, type OpcionGaleno, type PlanComercialDeGaleno, type SubModeloGaleno, type TipoDeVehiculo } from '../../shared/tipos'
import {
  categoriasIvaGaleno,
  clausulasDeAjusteGaleno,
  codigoPostalGaleno,
  codigosIIBBGaleno,
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

/** La opción de un plan comercial: «legajo|plan», porque el mismo código de plan puede estar en dos legajos. */
export function claveDePlan(plan: PlanComercialDeGaleno): string {
  return `${plan.productorCodigo}|${plan.codigo}`
}

/**
 * El plan con el que se cotiza: el elegido a mano (por su clave «legajo|plan», o por el código solo si
 * se eligió antes de que la opción llevara el legajo) o, si no, el primero de la lista.
 */
export function planDeLaLista(planes: PlanComercialDeGaleno[], elegido: string | undefined): PlanComercialDeGaleno | undefined {
  return (elegido ? (planes.find((p) => claveDePlan(p) === elegido) ?? planes.find((p) => p.codigo === elegido)) : undefined) ?? planes[0]
}

/** Las opciones de un porcentaje que en la web de Galeno se escribe a mano: de 0 a `hasta`, de `paso` en `paso`. */
export function opcionesDePorcentaje(hasta: number, paso: number): AjusteDeAseguradora['opciones'] {
  const lista: AjusteDeAseguradora['opciones'] = []
  for (let n = 0; n <= hasta; n += paso) lista.push({ valor: String(n), texto: `${n} %` })
  return lista
}

/**
 * Qué porcentajes aplicó Galeno de verdad, leídos de los importes de una cobertura: la bonificación
 * sobre la prima, y el recargo administrativo sobre la prima ya bonificada (así los calcula su web).
 * `null` cuando la cobertura no trae con qué calcularlo.
 */
export function porcentajesAplicados(cobertura: { prima: number; bonificacion: number; recargoAdministrativo: number }): {
  bonificacion: number | null
  recargoAdministrativo: number | null
} {
  const redondeado = (n: number) => Math.round(n * 100) / 100
  if (!(cobertura.prima > 0)) return { bonificacion: null, recargoAdministrativo: null }
  const bonificacion = redondeado((cobertura.bonificacion / cobertura.prima) * 100)
  const base = cobertura.prima - cobertura.bonificacion
  const recargoAdministrativo = base > 0 ? redondeado((cobertura.recargoAdministrativo / base) * 100) : null
  return { bonificacion, recargoAdministrativo }
}

/**
 * La suma asegurada que Galeno dice haber usado, si su respuesta la trae. El manual no documenta el
 * nombre del campo, así que se busca cualquier número positivo cuya clave hable de suma o valor
 * asegurado, primero en el cuerpo y después en la primera cobertura. Null si no viene: entonces lo
 * único que se sabe es si se la mandó la agencia o la eligió Galeno.
 */
export function sumaAseguradaDeLaRespuesta(cruda: unknown): number | null {
  const buscar = (objeto: unknown): number | null => {
    if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return null
    for (const [clave, valor] of Object.entries(objeto as Record<string, unknown>)) {
      if (!/suma.*aseg|valor.*aseg|sumaaseg/i.test(clave)) continue
      const numero = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor.replace(/\./g, '').replace(',', '.')) : NaN
      if (Number.isFinite(numero) && numero > 0) return numero
    }
    return null
  }
  const enElCuerpo = buscar(cruda)
  if (enElCuerpo !== null) return enElCuerpo
  const coberturas = cruda && typeof cruda === 'object' ? (cruda as { coberturas?: unknown }).coberturas : undefined
  return Array.isArray(coberturas) ? buscar(coberturas[0]) : null
}

/** Los códigos de Galeno de un vehículo elegido del catálogo, si salió de la API de Galeno para ese tipo. */
export function codigosDeGaleno(codigoCatalogo: string, tipo: TipoDeVehiculo): { marca: string; modelo: string; subModelo: string } | null {
  const partes = /^GALENO:(\d+):([^:]+):([^:]+):([^:]+)$/.exec(codigoCatalogo.trim())
  if (!partes || Number(partes[1]) !== RAMA_GALENO_DE_TIPO[tipo]) return null
  return { marca: partes[2]!, modelo: partes[3]!, subModelo: partes[4]! }
}

/**
 * En qué modelo de la lista de Galeno buscar la versión de un código del catálogo: en el que se llama
 * como el modelo del catálogo, que es de donde salió. El modelo del código es el de la VERSIÓN y casi
 * nunca está en la lista: los de la lista son familias («COROLLA CROSS») y cada versión trae el suyo
 * (ver fuentes/galeno.ts en el servidor). Si ninguno se llama así, el del código, si está.
 */
export function modeloDeLaLista(modelos: OpcionGaleno[], nombreDelModelo: string, exacto: { modelo: string }): string | null {
  const buscado = normalizarTexto(nombreDelModelo)
  return modelos.find((modelo) => normalizarTexto(modelo.descripcion) === buscado)?.codigo ?? valido(exacto.modelo, modelos)
}

/** Si una fila de Sub-modelos es la versión que nombra el código: por el modelo y el sub-modelo de la fila. */
export function esLaVersionDelCodigo(sub: SubModeloGaleno, exacto: { modelo: string; subModelo: string }): boolean {
  return String(sub.codigoModelo) === exacto.modelo && String(sub.codigoSubModelo) === exacto.subModelo
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
  const exacto = codigosDeGaleno(v.codigoCatalogo, tipo)
  const marca =
    valido(elegidos.marca, marcas) ?? (exacto ? valido(exacto.marca, marcas) : null) ?? buscarMarca(v.marca, marcas)?.codigo ?? ''
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
  const exactoDeLaMarca = exacto && exacto.marca === marca ? exacto : null
  const modeloExacto = exactoDeLaMarca ? modeloDeLaLista(modelos, v.modelo, exactoDeLaMarca) : null
  const candidatos = modeloElegido
    ? modelos.filter((modelo) => modelo.codigo === modeloElegido)
    : modeloExacto
      ? modelos.filter((modelo) => modelo.codigo === modeloExacto)
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
    (modeloExacto && exactoDeLaMarca
      ? versiones.find((version) => version.modelo.codigo === modeloExacto && esLaVersionDelCodigo(version.sub, exactoDeLaMarca))
      : undefined) ??
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
  // Cada plan es de UN legajo y la bonificación del productor va atada a esa combinación: la opción
  // lleva los dos («legajo|plan») y se cotiza con el legajo del plan elegido, no con uno fijo.
  const planes = await enMemoria(`planes:${tipo}`, () => planesComercialesGaleno(tipo))
  const variosLegajos = new Set(planes.map((p) => p.productorCodigo)).size > 1
  const opcionesDePlan = planes.map((p) => ({
    codigo: claveDePlan(p),
    descripcion: variosLegajos ? `${p.descripcion} (legajo ${p.productorCodigo})` : p.descripcion,
  }))
  const planElegido = planDeLaLista(planes, elegidos.planComercial)
  const plan = planElegido?.codigo ?? ''
  ajustes.push({
    campo: 'planComercial',
    titulo: 'Plan comercial',
    ayuda: planElegido ? `Legajo ${planElegido.productorCodigo}` : undefined,
    opciones: opciones(opcionesDePlan),
    valor: planElegido ? claveDePlan(planElegido) : '',
    obligatorio: true,
  })

  const modos = plan ? await enMemoria(`modos:${tipo}:${plan}`, () => modosDeFacturacionGaleno(tipo, plan)) : []
  // Mensual es lo que se vende en el mostrador casi siempre; si Galeno no lo ofrece, el primero.
  const modo = valido(elegidos.modoFacturacion, modos) ?? porPalabrasClave(modos, ['MENSUAL'])?.codigo ?? modos[0]?.codigo ?? ''
  ajustes.push({
    campo: 'modoFacturacion',
    titulo: 'Modo de facturación',
    ayuda: 'El premio y las cuotas son del período que factura este modo: con mensual, lo que se paga por mes; con «anual c/ refacturación trimestral», el trimestre en cuotas. Para comparar con la web de Galeno hay que usar el mismo «Modo de Facturación» que ahí.',
    opciones: opciones(modos),
    valor: modo,
    obligatorio: true,
    dependeDe: 'planComercial',
    destacado: true,
  })

  const [condiciones, formas] = modo
    ? await Promise.all([
        enMemoria(`condiciones:${tipo}:${modo}`, () => condicionesDePagoGaleno(tipo, modo)),
        enMemoria(`formas:${tipo}:${modo}:${plan}`, () => formasDePagoGaleno(tipo, modo, plan)),
      ])
    : [[], []]
  const condicion = valido(elegidos.condicionPago, condiciones) ?? condiciones[0]?.codigo ?? ''
  ajustes.push({
    campo: 'condicionPago',
    titulo: 'Condición de pago (cuotas)',
    ayuda: 'Las «Cuotas» de la web de Galeno: en cuántas se paga el período que factura el modo elegido.',
    opciones: opciones(condiciones),
    valor: condicion,
    obligatorio: true,
    dependeDe: 'modoFacturacion',
    destacado: true,
  })
  const forma =
    valido(elegidos.formaPago, formas) ?? porPalabrasClave(formas, CLAVES_MEDIO_DE_PAGO[solicitud.medioDePago])?.codigo ?? formas[0]?.codigo ?? ''
  ajustes.push({
    campo: 'formaPago',
    titulo: 'Forma de pago',
    ayuda: 'La «Forma de pago» de la web de Galeno. Cada una lleva su propio recargo financiero: con otra forma, otro premio.',
    opciones: opciones(formas),
    valor: forma,
    obligatorio: true,
    dependeDe: 'modoFacturacion',
    destacado: true,
  })

  // La bonificación y el recargo administrativo: los dos números que en la web de Galeno se escriben a
  // mano arriba de la grilla («% Bonificación Prima» y «% RA»). Sin elegirlos, Galeno aplica los suyos
  // por defecto para el legajo y el plan, que no tienen por qué ser los que el productor pone en su
  // web: ésa es la diferencia de precio más común entre esta pantalla y la web. Lo elegido se conserva
  // entre cotizaciones (no es por solicitud), así se carga una vez el porcentaje que la agencia usa.
  const opcionesDeBonificacion = opcionesDePorcentaje(60, 5)
  const bonificacion = valido(elegidos.bonificacion, opcionesDeBonificacion.map((o) => ({ codigo: o.valor }))) ?? ''
  const ajusteBonificacion: AjusteDeAseguradora = {
    campo: 'bonificacion',
    titulo: '% Bonificación prima',
    ayuda: 'El «% Bonificación Prima» de la web de Galeno. Si no se elige, Galeno aplica el que tiene por defecto para este legajo y plan.',
    opciones: opcionesDeBonificacion,
    valor: bonificacion,
    obligatorio: false,
    destacado: true,
  }
  ajustes.push(ajusteBonificacion)
  const opcionesDeRecargo = opcionesDePorcentaje(40, 5)
  const recargoAdministrativo = valido(elegidos.recargoAdministrativo, opcionesDeRecargo.map((o) => ({ codigo: o.valor }))) ?? ''
  const ajusteRecargo: AjusteDeAseguradora = {
    campo: 'recargoAdministrativo',
    titulo: '% Recargo administrativo (RA)',
    ayuda: 'El «% RA» de la web de Galeno. Si no se elige, Galeno aplica el suyo por defecto.',
    opciones: opcionesDeRecargo,
    valor: recargoAdministrativo,
    obligatorio: false,
    destacado: true,
  }
  ajustes.push(ajusteRecargo)

  // La cláusula de ajuste: la web de Galeno la pide en el formulario del vehículo y arranca en
  // «Cláusula de ajuste automático 10 %». Acá se arranca en la misma, si Galeno la lista, porque es con
  // la que compara la agencia; sin ella, Galeno aplica la suya por defecto, que puede ser otra y
  // cambia el precio de todo lo que depende de la suma asegurada (robo, incendio, todo riesgo).
  const clausulas = await enMemoria(`clausulas:${tipo}`, () => clausulasDeAjusteGaleno()).catch(() => [] as OpcionGaleno[])
  const clausula = valido(elegidos.clausulaAjuste, clausulas) ?? porPalabrasClave(clausulas, ['AUTOMATIC', '10'])?.codigo ?? ''
  ajustes.push({
    campo: 'clausulaAjuste',
    titulo: 'Cláusula de ajuste',
    ayuda: 'La «Cláusula de ajuste» de la web de Galeno. Si no se elige, Galeno aplica la suya por defecto.',
    opciones: opciones(clausulas),
    valor: clausula,
    obligatorio: false,
    destacado: true,
  })

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
  // Ingresos brutos: la web de Galeno lo pide junto al IVA («Ing. Brutos: CONSUMIDOR FINAL») y cambia
  // los impuestos del premio. Sus categorías se llaman como las de IVA, así que se elige con las mismas
  // palabras clave; si no se reconoce, se manda sin él y Galeno usa el suyo.
  const iibbs = await enMemoria('iibb', () => codigosIIBBGaleno()).catch(() => [] as OpcionGaleno[])
  const iibb = valido(elegidos.codigoIIBB, iibbs) ?? porPalabrasClave(iibbs, CLAVES_CONDICION_IVA[solicitud.tomador.condicionIva])?.codigo ?? ''
  ajustes.push({ campo: 'codigoIIBB', titulo: 'Ingresos brutos', opciones: opciones(iibbs), valor: iibb, obligatorio: false })
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
    productorCodigo: planElegido?.productorCodigo,
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
    tomadorIIBBCodigo: iibb || undefined,
    clausulaAjusteCodigo: clausula || undefined,
    bonificacionPorcentaje: bonificacion ? Number(bonificacion) : undefined,
    recargoAdministrativoPorcentaje: recargoAdministrativo ? Number(recargoAdministrativo) : undefined,
  })

  // Lo que Galeno aplicó de verdad en cada cobertura, leído de sus importes: es lo que hay que mirar al
  // lado de la web cuando el precio no coincide (su grilla trae «% Bonificación Prima» y «% RA» por
  // fila, y no tienen por qué ser iguales en todas). Si se pidió un porcentaje y Galeno aplicó otro, es
  // que no lo permite para este legajo y plan (su web lo topea igual).
  const aplicadosPorCobertura = cotizacion.coberturas.map((c) => porcentajesAplicados(c))
  const bonificacionAplicada = rangoDePorcentajes(aplicadosPorCobertura.map((a) => a.bonificacion))
  const recargoAplicado = rangoDePorcentajes(aplicadosPorCobertura.map((a) => a.recargoAdministrativo))
  if (bonificacionAplicada) ajusteBonificacion.ayuda = `${ajusteBonificacion.ayuda} En esta cotización Galeno aplicó ${bonificacionAplicada}.`
  if (recargoAplicado) ajusteRecargo.ayuda = `${ajusteRecargo.ayuda} En esta cotización Galeno aplicó ${recargoAplicado}.`

  // Con qué se cotizó, en una línea: todo lo que la web de Galeno pide en su formulario y arriba de su
  // grilla, para compararlo de un vistazo sin abrir nada.
  const textoDe = (lista: OpcionDeLista[], codigo: string) => lista.find((opcion) => opcion.codigo === codigo)?.descripcion ?? codigo
  const sumaAplicada = sumaAseguradaDeLaRespuesta(cotizacion.respuestaDeGaleno)
  const resumen = [
    `Cotizado con el plan ${planElegido?.descripcion ?? plan} (legajo ${cotizacion.productorCodigo})`,
    `modo de facturación «${textoDe(modos, modo)}»`,
    `cuotas «${textoDe(condiciones, condicion)}»`,
    `forma de pago «${textoDe(formas, forma)}»`,
    clausula ? `cláusula de ajuste «${textoDe(clausulas, clausula)}»` : 'cláusula de ajuste: la de Galeno por defecto',
    v.sumaAsegurada !== null
      ? `suma asegurada ${enPesos(v.sumaAsegurada)} (la cargada en el formulario)`
      : `suma asegurada: la de Galeno${sumaAplicada !== null ? ` (${enPesos(sumaAplicada)})` : ''}`,
    bonificacionAplicada ? `bonificación ${bonificacionAplicada}${bonificacion ? '' : ' (la que Galeno aplica por defecto)'}` : '',
    recargoAplicado ? `RA ${recargoAplicado}${recargoAdministrativo ? '' : ' (el de Galeno por defecto)'}` : '',
  ]
    .filter(Boolean)
    .join(', ')

  const coberturas: CoberturaCotizada[] = cotizacion.coberturas.map((c, indice) => ({
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
    bonificacionPorcentaje: aplicadosPorCobertura[indice]?.bonificacion ?? null,
    recargoAdministrativoPorcentaje: aplicadosPorCobertura[indice]?.recargoAdministrativo ?? null,
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
    // Con qué se cotizó, a la vista: es lo primero que se compara contra la web.
    mensaje: coberturas.length === 0 ? 'Galeno no devolvió coberturas para estos datos.' : `${resumen}.`,
    descripcionVehiculo: cotizacion.descripcionVehiculo,
    coberturas,
    avisos,
    ajustes,
    detalleTecnico: {
      legajo: cotizacion.productorCodigo,
      planComercial: planElegido ? `${planElegido.codigo} — ${planElegido.descripcion}` : plan,
      endpoint: 'POST /api/cotizadores/auto/cotizar',
      pedido: cotizacion.pedidoEnviado,
      respuesta: cotizacion.respuestaDeGaleno,
    },
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
