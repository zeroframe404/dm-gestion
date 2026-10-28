// La Equidad en el multicotizador: traduce la solicitud común a su API GLM (`POST CotizarAutomotor`,
// ver aseguradoras/equidad/cotizacion.ts) y devuelve sus coberturas en la forma común. Por ahora sólo
// cotiza autos y no emite (la API sí emite: EmitirCotizacion → inspección → EmitirSolicitud; se suma
// después).
//
// La API GLM es la misma web de productores de Equidad hecha servicios: antes de cotizar hay que
// elegir, combo por combo y en el mismo orden que su pantalla, el tipo de póliza, el productor, la
// moneda, el plan comercial, el modo de facturación (la «vigencia»), la forma de pago y la condición de
// pago (las cuotas); cada lista depende de la anterior. Todo eso se decide solo con un criterio
// razonable y se devuelve como ajuste —lo comercial a la vista, lo técnico detrás de «Más ajustes»—,
// igual que en Galeno, ATM y Mercantil.
//
// EL VEHÍCULO: Equidad lo identifica por marca + modelo + submodelo (sus códigos), y además pide la
// «variante» (capítulo + variante RC + variante AIR: el tipo/uso). Se busca por nombre en su catálogo
// —`BuscarVehiculos` por año y marca— como en Galeno, y ante la duda se pregunta en vez de adivinar.
// Lo elegido a mano (o sin dudas, si Equidad cotizó) queda en la tabla de equivalencias para ese
// vehículo del catálogo.
import {
  categoriaDeCobertura,
  enPesos,
  fechaIsoDe,
  nombreDelTomador,
  normalizarTexto,
  rangoDePorcentajes,
  tieneRastreador,
  type AjusteDeAseguradora,
  type CoberturaCotizada,
  type UsoDelVehiculo,
} from '../../shared/multicotizador'
import type { TipoDeVehiculo } from '../../shared/tipos'
import {
  alarmasSatelitalesEquidad,
  buscarVehiculosEquidad,
  categoriasIbEquidad,
  categoriasIvaEquidad,
  claveDeVariante,
  claveDeVehiculo,
  clausulasDeAjusteEquidad,
  condicionesDePagoEquidad,
  cotizacionesEquidad,
  formasDePagoEquidad,
  localidadesEquidad,
  marcasEquidad,
  modosDeFacturacionEquidad,
  monedasEquidad,
  planesComercialesEquidad,
  productoresEquidad,
  sumaAseguradaEquidad,
  tiposDePolizaEquidad,
  variantesEquidad,
  type ContextoEquidad,
  type LocalidadEquidad,
  type OpcionEquidad,
  type VarianteEquidad,
  type VehiculoEquidad,
} from '../aseguradoras/equidad/catalogos'
import { crearClienteEquidad, ErrorDeEquidad, SERVICIOS_EQUIDAD, type ClienteEquidad, type CuentaEquidad } from '../aseguradoras/equidad/cliente'
import { cotizarEquidad, type DatosDeCotizacionEquidad } from '../aseguradoras/equidad/cotizacion'
import { credencialesEquidad } from '../servicios/config'
import type { CotizacionDeAseguradora, CotizacionDeLaApi, CotizadorDeAseguradora, PlanDeAseguradora, SolicitudResuelta } from './aseguradora'
import {
  bajoElFormulario,
  buscarLocalidad,
  buscarMarca,
  CLAVES_CONDICION_IIBB,
  CLAVES_CONDICION_IVA,
  CLAVES_MEDIO_DE_PAGO,
  claveDeCuotas,
  elegidoBajo,
  porClausula,
  porCuotas,
  porFacturacion,
  porPalabrasClave,
  porRastreador,
  porUso,
  rankear,
  sinDudas,
  type OpcionDeLista,
} from './equivalencias'
import { equivalenciaGuardada, guardarEquivalencia, olvidarEquivalencia } from './equivalenciasGuardadas'
import { opcionesDePorcentaje } from './galeno'

export const ID_EQUIDAD = 'EQUIDAD'
const NOMBRE = 'Equidad'

// --- Las listas, en memoria ----------------------------------------------------------------------------
//
// Los combos cambian muy de vez en cuando: guardarlos media hora hace que la segunda cotización no los
// vuelva a pedir (son ocho o nueve pedidos por cotización). Si un pedido falla no se guarda nada.

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
export function olvidarListasDeEquidad(): void {
  listas.clear()
}

type CredencialesEquidad = NonNullable<ReturnType<typeof credencialesEquidad>>
let cuentaDePrueba: CredencialesEquidad | null = null

/** Las pruebas (y el humo en vivo) corren sin Electron ni config.json: les pasan la cuenta acá. */
export function usarCuentaDeEquidadDePrueba(cuenta: CredencialesEquidad | null): void {
  cuentaDePrueba = cuenta
  listas.clear()
}

function cuentaActual(): CredencialesEquidad | null {
  return cuentaDePrueba ?? credencialesEquidad()
}

function cuentaDe(credenciales: CredencialesEquidad): CuentaEquidad {
  return {
    urlBase: credenciales.urlBase,
    usuario: credenciales.usuario,
    clave: credenciales.clave,
    usuarioDeServicio: credenciales.usuarioDeServicio,
    claveDeServicio: credenciales.claveDeServicio,
  }
}

// --- Las decisiones, puras (se prueban solas) ---------------------------------------------------------

function valido(valor: string | undefined, lista: OpcionDeLista[]): string | null {
  return valor && lista.some((opcion) => opcion.codigo === valor) ? valor : null
}

function opcionesDe(lista: OpcionDeLista[]): Array<{ valor: string; texto: string }> {
  return lista.map((opcion) => ({ valor: opcion.codigo, texto: opcion.descripcion }))
}

/** El texto con que se busca el vehículo: modelo y versión del catálogo de la agencia. */
export function textoParaBuscar(solicitud: SolicitudResuelta): string {
  const v = solicitud.vehiculo
  return `${v.modelo} ${v.version}`.trim()
}

/** El tipo de póliza con que se arranca: el que nombre a los autos; si ninguno, el primero. */
export function tipoDePolizaPorDefecto(tipos: OpcionEquidad[]): string {
  return porPalabrasClave(tipos, ['AUTO', 'AUTOMOTOR', 'AUTOMOVIL', 'VEHIC'])?.codigo ?? tipos[0]?.codigo ?? ''
}

/** El productor: el cargado en la cuenta si la API lo lista (o si no lista ninguno); si no, el primero de la lista. */
export function productorPorDefecto(configurado: string, productores: OpcionDeLista[]): string {
  if (configurado && (productores.length === 0 || productores.some((p) => p.codigo === configurado))) return configurado
  return productores[0]?.codigo ?? configurado
}

/** La moneda: pesos. */
export function monedaPorDefecto(monedas: OpcionEquidad[]): string {
  return porPalabrasClave(monedas, ['PESO', 'ARS', 'NACIONAL'])?.codigo ?? monedas[0]?.codigo ?? ''
}

/** La categoría de ingresos brutos: la de «no inscripto» / consumidor final, que es la del particular; si no, la primera. */
export function iibbPorDefecto(categorias: OpcionEquidad[]): string {
  return porPalabrasClave(categorias, ['NO', 'EXENT', 'CONSUMIDOR'])?.codigo ?? categorias[0]?.codigo ?? ''
}

/** La variante (tipo/uso): la que nombre el uso de la solicitud; si ninguna, la primera (la API dice que va por defecto). */
export function variantePorDefecto(variantes: VarianteEquidad[], uso: UsoDelVehiculo): VarianteEquidad | null {
  const opciones = variantes.map((v) => ({ codigo: claveDeVariante(v), descripcion: v.descripcion }))
  const delUso = porUso(opciones, uso)
  return (delUso ? variantes.find((v) => claveDeVariante(v) === delUso.codigo) : null) ?? variantes[0] ?? null
}

/** Lo que conviene revisar según lo que dijo Equidad al rechazar. */
export function consejoParaElRechazo(mensaje: string): string {
  const texto = normalizarTexto(mensaje)
  if (/CREDENCIAL|TOKEN|AUTORIZ|AUTENTIC|USUARIO/.test(texto)) return 'Revisá la cuenta en API Aseguradoras → Equidad («Probar conexión»).'
  if (/PRODUCTOR/.test(texto)) return 'Revisá el productor en los ajustes de Equidad (o el cargado en API Aseguradoras → Equidad).'
  if (/VEHICULO|MARCA|MODELO|SUBMODELO|VARIANTE|CAPITULO/.test(texto)) return 'Elegí otra versión o variante en los ajustes de Equidad.'
  if (/POSTAL|LOCALIDAD|ZONA/.test(texto)) return 'Revisá el código postal y la localidad.'
  if (/SUMA|VALOR ASEGURADO/.test(texto)) return 'Cargá la suma asegurada en el formulario.'
  if (/CUOTA|PAGO|FACTURACION|PLAN/.test(texto)) return 'Probá con otro plan, modo de facturación, forma o condición de pago en los ajustes de Equidad.'
  if (/VIGENCIA|FECHA/.test(texto)) return 'Revisá la fecha de inicio de vigencia.'
  return ''
}

/** El código con que se recuerda y se elige una localidad: `cp:subcódigo`. */
function claveDeLocalidad(l: LocalidadEquidad): string {
  return `${l.codigoPostal}:${l.subCodigo}`
}

// --- Cotizar ----------------------------------------------------------------------------------------

interface VehiculoElegido {
  marca: OpcionEquidad | null
  vehiculo: VehiculoEquidad | null
  /** true si se eligió sola con dudas (hay otras parecidas): se avisa y se abre el ajuste. */
  dudosa: boolean
  /** true si salió de la tabla de equivalencias de esta computadora. */
  guardada: boolean
}

async function vehiculoEnEquidad(cliente: ClienteEquidad, c: ContextoEquidad, solicitud: SolicitudResuelta, elegidos: Record<string, string>, ajustes: AjusteDeAseguradora[]): Promise<VehiculoElegido> {
  const v = solicitud.vehiculo
  const marcas = await enMemoria(`marcas:${c.rama}`, () => marcasEquidad(cliente, c))
  const marcaCodigo = valido(elegidos.marca, marcas) ?? buscarMarca(v.marca, marcas)?.codigo ?? ''
  ajustes.push({
    campo: 'marca',
    titulo: 'Marca en Equidad',
    ayuda: marcas.length === 0 ? 'Equidad no devolvió marcas.' : undefined,
    opciones: opcionesDe(marcas),
    valor: marcaCodigo,
    obligatorio: true,
    porSolicitud: true,
  })
  const marca = marcas.find((m) => m.codigo === marcaCodigo) ?? null
  if (!marca) return { marca: null, vehiculo: null, dudosa: false, guardada: false }

  const vehiculos = await enMemoria(`vehiculos:${c.rama}:${v.anio}:${marca.codigo}`, () => buscarVehiculosEquidad(cliente, c, v.anio, marca.codigo))
  const ranking = rankear(textoParaBuscar(solicitud), vehiculos, (vehiculo) => vehiculo.descripcion)
  const recordada = equivalenciaGuardada(ID_EQUIDAD, v.codigoCatalogo)
  const aMano = vehiculos.find((vehiculo) => claveDeVehiculo(vehiculo) === elegidos.version)
  const porEquivalencia = !aMano && recordada ? vehiculos.find((vehiculo) => claveDeVehiculo(vehiculo) === recordada.codigo) : undefined
  const sinDuda = sinDudas(ranking, 0.5, 0.1)
  const elegido = aMano ?? porEquivalencia ?? sinDuda ?? (vehiculos.length === 1 ? vehiculos[0]! : null)
  const dudosa = !aMano && !porEquivalencia && !sinDuda && elegido === null && ranking.length > 0

  // Las más parecidas primero: la que se busca casi siempre está entre las tres de arriba.
  const ordenados = [...ranking.map((candidato) => candidato.opcion), ...vehiculos.filter((vehiculo) => !ranking.some((candidato) => candidato.opcion === vehiculo))]
  ajustes.push({
    campo: 'version',
    titulo: 'Versión en Equidad',
    ayuda:
      vehiculos.length === 0
        ? `Equidad no tiene vehículos de ${marca.descripcion} para el año ${v.anio}.`
        : 'La que identifica al vehículo en Equidad (marca, modelo y submodelo). Cotizar otra versión es cotizar otro auto.',
    opciones: ordenados.map((vehiculo) => ({ valor: claveDeVehiculo(vehiculo), texto: `${vehiculo.descripcion} (${claveDeVehiculo(vehiculo)})` })),
    valor: elegido ? claveDeVehiculo(elegido) : '',
    obligatorio: true,
    dependeDe: 'marca',
    porSolicitud: true,
  })
  return { marca, vehiculo: elegido, dudosa, guardada: Boolean(porEquivalencia) }
}

async function cotizar(solicitud: SolicitudResuelta, elegidos: Record<string, string>): Promise<CotizacionDeAseguradora> {
  const cuenta = cuentaActual()
  if (!cuenta) throw new ErrorDeEquidad('Falta cargar la cuenta de Equidad en API Aseguradoras → Equidad.', false)
  const cliente = crearClienteEquidad(cuentaDe(cuenta))
  const sesion = await cliente.sesion()
  const c: ContextoEquidad = { usuario: sesion.usuarioCodigo, empresa: cuenta.empresa, rama: cuenta.rama }
  const v = solicitud.vehiculo
  const ajustes: AjusteDeAseguradora[] = []
  const avisos: string[] = []
  const vigencia = solicitud.vigenciaDesde

  // Lo que no depende de nada, todo a la vez.
  const [tipos, productores, monedas, iibbs, clausulas, alarmas, localidades] = await Promise.all([
    enMemoria(`tipos:${c.rama}`, () => tiposDePolizaEquidad(cliente, c)),
    enMemoria(`productores:${c.empresa}`, () => productoresEquidad(cliente, c)).catch(() => []),
    enMemoria('monedas', () => monedasEquidad(cliente, c)),
    enMemoria('iibb', () => categoriasIbEquidad(cliente)).catch(() => [] as OpcionEquidad[]),
    enMemoria(`clausulas:${v.anio}:${v.ceroKm}`, () => clausulasDeAjusteEquidad(cliente, c, v.anio, v.ceroKm)).catch(() => [] as OpcionEquidad[]),
    tieneRastreador(v) ? enMemoria('alarmas', () => alarmasSatelitalesEquidad(cliente, c)).catch(() => [] as OpcionEquidad[]) : Promise.resolve([] as OpcionEquidad[]),
    enMemoria(`cp:${solicitud.codigoPostal}`, () => localidadesEquidad(cliente, solicitud.codigoPostal)).catch(() => [] as LocalidadEquidad[]),
  ])

  // 1. Tipo de póliza y productor: de ellos dependen los planes.
  const tipoPoliza = valido(elegidos.tipoPoliza, tipos) ?? tipoDePolizaPorDefecto(tipos)
  ajustes.push({
    campo: 'tipoPoliza',
    titulo: 'Tipo de póliza',
    ayuda: tipos.length === 0 ? `Equidad no devolvió tipos de póliza para la rama ${c.rama}: revisá la rama en API Aseguradoras → Equidad.` : 'El tipo de póliza de la rama automotor (el primer combo de la web de Equidad).',
    opciones: opcionesDe(tipos),
    valor: tipoPoliza,
    obligatorio: true,
  })
  const productoresComoLista: OpcionDeLista[] = productores.map((p) => ({ codigo: p.codigo, descripcion: `${p.codigo} — ${p.nombre}` }))
  const productor = valido(elegidos.productor, productoresComoLista) ?? productorPorDefecto(cuenta.productor, productoresComoLista)
  ajustes.push({
    campo: 'productor',
    titulo: 'Productor',
    ayuda: productores.length === 0 ? 'Equidad no listó productores para el usuario: se usa el cargado en API Aseguradoras → Equidad.' : undefined,
    opciones: productoresComoLista.length > 0 ? opcionesDe(productoresComoLista) : productor ? [{ valor: productor, texto: productor }] : [],
    valor: productor,
    obligatorio: true,
  })
  const moneda = valido(elegidos.moneda, monedas) ?? monedaPorDefecto(monedas)
  ajustes.push({ campo: 'moneda', titulo: 'Moneda', opciones: opcionesDe(monedas), valor: moneda, obligatorio: true })

  // 2. Lo comercial, en cadena y a la vista: plan → modo de facturación → forma de pago → condición de pago.
  const planes = tipoPoliza && productor ? await enMemoria(`planes:${c.rama}:${tipoPoliza}:${productor}:${vigencia}`, () => planesComercialesEquidad(cliente, c, tipoPoliza, productor, vigencia)) : []
  const planComercial = valido(elegidos.planComercial, planes) ?? planes[0]?.codigo ?? ''
  ajustes.push({
    campo: 'planComercial',
    titulo: 'Plan comercial',
    ayuda: 'El «Plan comercial» de la web de Equidad para este productor y tipo de póliza. Cada plan tiene sus coberturas y sus precios.',
    opciones: opcionesDe(planes),
    valor: planComercial,
    obligatorio: true,
    dependeDe: 'productor',
    destacado: true,
  })
  const modos =
    planComercial && moneda
      ? await enMemoria(`modos:${c.rama}:${tipoPoliza}:${productor}:${vigencia}:${planComercial}:${moneda}`, () => modosDeFacturacionEquidad(cliente, c, { tipoPoliza, productor, vigenciaDesde: vigencia, planComercial, moneda }))
      : []
  const { facturacion, cuotas, clausulaAjuste: clausulaPedida } = solicitud.condiciones
  const modoFacturacion = valido(elegidoBajo(elegidos.modoFacturacion, facturacion), modos) ?? porFacturacion(modos, facturacion)?.codigo ?? modos[0]?.codigo ?? ''
  ajustes.push(bajoElFormulario(facturacion, {
    campo: 'modoFacturacion',
    titulo: 'Vigencia / modo de facturación',
    ayuda: 'La «Vigencia» de la web de Equidad (anual, semestral, mensual…). Cambia las cuotas disponibles y el precio.',
    opciones: opcionesDe(modos),
    valor: modoFacturacion,
    obligatorio: true,
    dependeDe: 'planComercial',
    destacado: true,
  }))
  const formas = modoFacturacion ? await enMemoria(`formas:${c.rama}:${planComercial}:${modoFacturacion}:${moneda}`, () => formasDePagoEquidad(cliente, c, { planComercial, modoFacturacion, moneda })) : []
  const formaDePago =
    valido(elegidoBajo(elegidos.formaDePago, solicitud.medioDePago), formas) ??
    porPalabrasClave(formas, CLAVES_MEDIO_DE_PAGO[solicitud.medioDePago])?.codigo ??
    formas[0]?.codigo ??
    ''
  ajustes.push(bajoElFormulario(solicitud.medioDePago, {
    campo: 'formaDePago',
    titulo: 'Forma de pago',
    ayuda: 'Arranca en la que corresponde a la forma de pago del formulario. Cada una lleva su propio recargo financiero.',
    opciones: opcionesDe(formas),
    valor: formaDePago,
    obligatorio: true,
    dependeDe: 'modoFacturacion',
    destacado: true,
  }))
  const condiciones = formaDePago
    ? await enMemoria(`condiciones:${c.rama}:${tipoPoliza}:${productor}:${vigencia}:${planComercial}:${modoFacturacion}:${moneda}:${formaDePago}`, () =>
        condicionesDePagoEquidad(cliente, c, { vigenciaDesde: vigencia, productor, planComercial, modoFacturacion, moneda, tipoPoliza, formaDePago }),
      )
    : []
  const condicionDePago =
    valido(elegidoBajo(elegidos.condicionDePago, claveDeCuotas(cuotas)), condiciones) ??
    porCuotas(condiciones, cuotas)?.codigo ??
    condiciones.find((cond) => cond.porDefecto)?.codigo ??
    condiciones[0]?.codigo ??
    ''
  ajustes.push(bajoElFormulario(claveDeCuotas(cuotas), {
    campo: 'condicionDePago',
    titulo: 'Cuotas / condición de pago',
    ayuda: 'Las «Cuotas» de la web de Equidad. Arranca en las del formulario; si Equidad no tiene esa cantidad, en la que marca por defecto para esta forma de pago.',
    opciones: opcionesDe(condiciones),
    valor: condicionDePago,
    obligatorio: true,
    dependeDe: 'formaDePago',
    destacado: true,
  }))

  // La bonificación y el recargo administrativo, como en Galeno: sin elegirlos, Equidad aplica los del plan.
  const opcionesDeBonificacion = opcionesDePorcentaje(60, 5)
  const bonificacion = valido(elegidos.bonificacion, opcionesDeBonificacion.map((o) => ({ codigo: o.valor, descripcion: o.texto }))) ?? ''
  const ajusteBonificacion: AjusteDeAseguradora = {
    campo: 'bonificacion',
    titulo: '% Bonificación',
    ayuda: 'El porcentaje de bonificación del pedido. Si no se elige, Equidad aplica el del plan comercial.',
    opciones: opcionesDeBonificacion,
    valor: bonificacion,
    obligatorio: false,
    destacado: true,
  }
  ajustes.push(ajusteBonificacion)
  const opcionesDeRecargo = opcionesDePorcentaje(40, 5)
  const recargoAdministrativo = valido(elegidos.recargoAdministrativo, opcionesDeRecargo.map((o) => ({ codigo: o.valor, descripcion: o.texto }))) ?? ''
  const ajusteRecargo: AjusteDeAseguradora = {
    campo: 'recargoAdministrativo',
    titulo: '% Recargo administrativo',
    ayuda: 'El porcentaje de recargo administrativo del pedido. Si no se elige, Equidad aplica el suyo.',
    opciones: opcionesDeRecargo,
    valor: recargoAdministrativo,
    obligatorio: false,
    destacado: true,
  }
  ajustes.push(ajusteRecargo)

  // La cláusula de ajuste, a la vista: cambia el precio de todo lo que depende de la suma asegurada.
  const clausulaAjuste =
    valido(elegidoBajo(elegidos.clausulaAjuste, clausulaPedida), clausulas) ?? porClausula(clausulas, clausulaPedida)?.codigo ?? clausulas[0]?.codigo ?? ''
  ajustes.push(bajoElFormulario(clausulaPedida, {
    campo: 'clausulaAjuste',
    titulo: 'Cláusula de ajuste',
    ayuda: clausulas.length === 0 ? 'Equidad no devolvió cláusulas de ajuste para este año: se cotiza sin cláusula.' : 'La «Cláusula de ajuste» de la web de Equidad para el año del vehículo.',
    opciones: opcionesDe(clausulas),
    valor: clausulaAjuste,
    obligatorio: false,
    destacado: true,
  }))

  // 3. Lo técnico: IVA, ingresos brutos, alarma satelital.
  const ivas = tipoPoliza ? await enMemoria(`ivas:${c.rama}:${tipoPoliza}`, () => categoriasIvaEquidad(cliente, c, tipoPoliza)).catch(() => [] as OpcionEquidad[]) : []
  const { condicionIva, ingresosBrutos } = solicitud.tomador
  const iva = valido(elegidoBajo(elegidos.iva, condicionIva), ivas) ?? porPalabrasClave(ivas, CLAVES_CONDICION_IVA[condicionIva])?.codigo ?? ivas[0]?.codigo ?? ''
  ajustes.push(bajoElFormulario(condicionIva, { campo: 'iva', titulo: 'Categoría de IVA', opciones: opcionesDe(ivas), valor: iva, obligatorio: true, dependeDe: 'tipoPoliza' }))
  const iibb = valido(elegidoBajo(elegidos.iibb, ingresosBrutos), iibbs) ?? porPalabrasClave(iibbs, CLAVES_CONDICION_IIBB[ingresosBrutos])?.codigo ?? iibbPorDefecto(iibbs)
  ajustes.push(bajoElFormulario(ingresosBrutos, { campo: 'iibb', titulo: 'Ingresos brutos', opciones: opcionesDe(iibbs), valor: iibb, obligatorio: iibbs.length > 0 }))
  const conRastreo = tieneRastreador(v)
  const alarmaSatelital = conRastreo
    ? (valido(elegidoBajo(elegidos.alarmaSatelital, v.rastreador), alarmas) ?? porRastreador(alarmas, v.rastreador)?.codigo ?? alarmas[0]?.codigo ?? '')
    : ''
  if (conRastreo) {
    ajustes.push(bajoElFormulario(v.rastreador, {
      campo: 'alarmaSatelital',
      titulo: 'Equipo de rastreo en Equidad',
      ayuda: alarmas.length === 0 ? 'Equidad no devolvió alarmas satelitales: se cotiza con rastreo sin indicar cuál.' : 'Qué equipo de rastreo lleva, de la lista de Equidad.',
      opciones: opcionesDe(alarmas),
      valor: alarmaSatelital,
      obligatorio: false,
      porSolicitud: true,
    }))
  }

  // 4. La localidad y el vehículo.
  const localidadesComoLista = localidades.map((l) => ({ codigo: claveDeLocalidad(l), descripcion: `${l.localidad}${l.provincia ? ` (${l.provincia})` : ''}` }))
  const localidadElegida =
    valido(elegidos.localidad, localidadesComoLista) ?? (buscarLocalidad(solicitud.localidad, localidades, (l) => l.localidad) ? claveDeLocalidad(buscarLocalidad(solicitud.localidad, localidades, (l) => l.localidad)!) : '')
  ajustes.push({
    campo: 'localidad',
    titulo: 'Localidad en Equidad',
    ayuda: localidades.length === 0 ? `Equidad no reconoce el código postal ${solicitud.codigoPostal}.` : 'La localidad del código postal, como la tiene Equidad (su subcódigo postal).',
    opciones: opcionesDe(localidadesComoLista),
    valor: localidadElegida,
    obligatorio: true,
    porSolicitud: true,
  })
  const localidad = localidades.find((l) => claveDeLocalidad(l) === localidadElegida) ?? null

  const elegido = await vehiculoEnEquidad(cliente, c, solicitud, elegidos, ajustes)
  const variantes = elegido.vehiculo ? await enMemoria(`variantes:${claveDeVehiculo(elegido.vehiculo)}`, () => variantesEquidad(cliente, c, elegido.vehiculo!)).catch(() => [] as VarianteEquidad[]) : []
  const variantesComoLista = variantes.map((variante) => ({ codigo: claveDeVariante(variante), descripcion: variante.descripcion || claveDeVariante(variante) }))
  const delUso = variantePorDefecto(variantes, v.uso)
  const varianteCodigo = valido(elegidoBajo(elegidos.variante, v.uso), variantesComoLista) ?? (delUso ? claveDeVariante(delUso) : '')
  ajustes.push(bajoElFormulario(v.uso, {
    campo: 'variante',
    titulo: 'Tipo / uso en Equidad',
    ayuda: elegido.vehiculo && variantes.length === 0 ? 'Equidad no devolvió variantes para ese vehículo: elegí otra versión.' : 'La variante (tipo/uso) del vehículo en Equidad: la primera es la que su web pone por defecto.',
    opciones: opcionesDe(variantesComoLista),
    valor: varianteCodigo,
    obligatorio: true,
    dependeDe: 'version',
    porSolicitud: true,
  }))
  const variante = variantes.find((variante) => claveDeVariante(variante) === varianteCodigo) ?? null

  const faltan = ajustes.filter((ajuste) => ajuste.obligatorio && !ajuste.valor)
  if (faltan.length > 0 || !elegido.vehiculo || !variante || !localidad) {
    if (elegido.dudosa) avisos.push('Hay varias versiones parecidas en Equidad y ninguna se parece lo suficiente: elegí la que corresponde.')
    const revisar = faltan.find((a) => a.campo === 'version' || a.campo === 'localidad' || a.campo === 'variante')?.campo ?? faltan[0]?.campo ?? 'version'
    return {
      estado: 'FALTAN_DATOS',
      mensaje: `Para cotizar, elegí: ${(faltan.length > 0 ? faltan : ajustes.filter((a) => a.campo === 'version')).map((a) => a.titulo.toLowerCase()).join(', ')}.`,
      descripcionVehiculo: '',
      coberturas: [],
      avisos,
      ajustes,
      revisar,
    }
  }
  const vehiculo = elegido.vehiculo

  // 5. La suma asegurada: la del formulario o la que Equidad da por defecto para el vehículo.
  let sumaAsegurada = v.sumaAsegurada
  if (sumaAsegurada === null) {
    sumaAsegurada = await enMemoria(`suma:${moneda}:${claveDeLocalidad(localidad)}:${productor}:${claveDeVehiculo(vehiculo)}:${v.anio}:${v.ceroKm}`, () =>
      sumaAseguradaEquidad(cliente, c, { moneda, codigoPostal: localidad.codigoPostal, subCodigoPostal: localidad.subCodigo, productor, vehiculo, anio: v.anio, ceroKm: v.ceroKm }),
    ).catch(() => null)
    if (sumaAsegurada === null) {
      return {
        estado: 'ERROR',
        mensaje: 'Equidad no dio una suma asegurada por defecto para ese vehículo: cargá la suma asegurada en el formulario.',
        descripcionVehiculo: vehiculo.descripcion,
        coberturas: [],
        avisos,
        ajustes,
        revisar: 'version',
      }
    }
  }

  const datos: DatosDeCotizacionEquidad = {
    usuario: c.usuario,
    rama: c.rama,
    tipoPoliza,
    tomadorNombre: nombreDelTomador(solicitud.tomador) || 'A COTIZAR',
    tomadorCuit: solicitud.tomador.tipoPersona === 'JURIDICA' ? solicitud.tomador.cuit.replace(/\D/g, '') : '',
    tomadorTipoPersona: solicitud.tomador.tipoPersona === 'JURIDICA' ? '2' : '1',
    tomadorIva: iva,
    tomadorIibb: iibb,
    vigenciaDesde: vigencia,
    productor,
    moneda,
    planComercial,
    formaDePago,
    modoFacturacion,
    condicionDePago,
    bonificacionPorcentaje: bonificacion ? Number(bonificacion) : undefined,
    recargoAdministrativoPorcentaje: recargoAdministrativo ? Number(recargoAdministrativo) : undefined,
    riesgo: {
      codigoPostal: localidad.codigoPostal,
      subCodigoPostal: localidad.subCodigo,
      marcaCodigo: vehiculo.marcaCodigo,
      modeloCodigo: vehiculo.modeloCodigo,
      subModeloCodigo: vehiculo.subModeloCodigo,
      anio: v.anio,
      ceroKm: v.ceroKm,
      capitulo: variante.capitulo,
      varianteRC: variante.varianteRC,
      varianteAIR: variante.varianteAIR,
      clausulaAjuste,
      adicionalGranizo: '',
      rastreo: conRastreo,
      alarmaSatelital,
      gnc: v.gnc,
      sumaAsegurada,
      alarma: v.scoring.alarma,
      accesorios: [],
    },
  }
  const cotizacion = await cotizarEquidad(cliente, datos)

  const descripcionVehiculo = (cotizacion.descripcionVehiculo || `${elegido.marca?.descripcion ?? v.marca} ${vehiculo.descripcion} ${v.anio}`).replace(/\s+/g, ' ').trim()
  const detalleTecnico = {
    ambiente: cuenta.ambiente,
    usuario: c.usuario,
    productor,
    endpoint: `POST ${SERVICIOS_EQUIDAD.cotizarAutomotor}`,
    solicitud: cotizacion.solicitud || null,
    instalacion: cotizacion.instalacion || null,
    pedido: cotizacion.pedido,
    respuesta: cotizacion.cruda,
    vehiculoEnEquidad: {
      marca: elegido.marca ? `${elegido.marca.codigo} — ${elegido.marca.descripcion}` : null,
      vehiculo: `${claveDeVehiculo(vehiculo)} — ${vehiculo.descripcion}`,
      variante: `${claveDeVariante(variante)} — ${variante.descripcion}`,
      localidad: `${claveDeLocalidad(localidad)} — ${localidad.localidad}`,
    },
  }

  if (!cotizacion.ok) {
    const motivos = cotizacion.errores.length > 0 ? cotizacion.errores : cotizacion.excepciones.length > 0 ? cotizacion.excepciones.map((e) => e.detalle) : ['no devolvió coberturas']
    const consejo = motivos.map(consejoParaElRechazo).find(Boolean)
    const sinEntender = cotizacion.cruda !== null && cotizacion.errores.length === 0 && cotizacion.excepciones.length === 0
    if (sinEntender) olvidarEquivalencia(ID_EQUIDAD, v.codigoCatalogo, claveDeVehiculo(vehiculo))
    return {
      estado: 'ERROR',
      mensaje: `Equidad no cotizó: ${motivos.join(' · ')}.${consejo ? ` ${consejo}` : ''}${sinEntender ? ' Si la respuesta trae precios, «Copiar datos para Equidad» muestra con qué forma vinieron.' : ''}`,
      descripcionVehiculo,
      coberturas: [],
      avisos,
      ajustes,
      ...(/VEHICULO|MARCA|MODELO|VARIANTE/.test(normalizarTexto(motivos.join(' '))) ? { revisar: 'version' } : {}),
      detalleTecnico,
    }
  }

  // La tabla de equivalencias: lo elegido a mano, o lo elegido sin dudas, queda para este vehículo del
  // catálogo ahora que Equidad lo cotizó.
  const descripcion = `${elegido.marca?.descripcion ?? ''} ${vehiculo.descripcion}`.trim()
  if (elegidos.version === claveDeVehiculo(vehiculo)) guardarEquivalencia(ID_EQUIDAD, v.codigoCatalogo, claveDeVehiculo(vehiculo), 'MANUAL', descripcion)
  else if (!elegido.guardada) guardarEquivalencia(ID_EQUIDAD, v.codigoCatalogo, claveDeVehiculo(vehiculo), 'AUTOMATICA', descripcion)

  const coberturas: CoberturaCotizada[] = cotizacion.coberturas.map((cob) => ({
    aseguradora: ID_EQUIDAD,
    nombreAseguradora: NOMBRE,
    codigo: cob.codigo,
    nombre: cob.descripcion,
    categoria: categoriaDeCobertura(cob.descripcion, cob.codigo),
    premio: cob.premio,
    prima: cob.prima,
    primeraCuota: cob.importeCuota1,
    cuota: cob.importeRestoCuotas ?? cob.importeCuota1,
    franquicia: '',
    adicionales: [],
    comision: cob.comision,
    bonificacionPorcentaje: cob.bonificacionPorcentaje,
    recargoAdministrativoPorcentaje: cob.recargoAdministrativoPorcentaje,
    // Por ahora no se emite desde la app: la cotización queda en Equidad con el número de solicitud de abajo.
    emision: null,
  }))
  // Las excepciones son advertencias: las de una cobertura van con su nombre adelante.
  for (const excepcion of cotizacion.excepciones) {
    const cob = excepcion.item ? cotizacion.coberturas.find((cob) => cob.item === excepcion.item) : undefined
    avisos.push(`${cob ? `${cob.descripcion}: ` : ''}${excepcion.detalle}${excepcion.estado ? ` (${excepcion.estado})` : ''}`)
  }
  const bonificacionAplicada = rangoDePorcentajes(cotizacion.coberturas.map((cob) => cob.bonificacionPorcentaje))
  const recargoAplicado = rangoDePorcentajes(cotizacion.coberturas.map((cob) => cob.recargoAdministrativoPorcentaje))
  if (bonificacionAplicada) ajusteBonificacion.ayuda = `${ajusteBonificacion.ayuda} En esta cotización Equidad aplicó ${bonificacionAplicada}.`
  if (recargoAplicado) ajusteRecargo.ayuda = `${ajusteRecargo.ayuda} En esta cotización Equidad aplicó ${recargoAplicado}.`

  const textoDe = (lista: OpcionDeLista[], codigo: string) => lista.find((o) => o.codigo === codigo)?.descripcion ?? codigo
  const sumaUsada = cotizacion.sumaAsegurada ?? sumaAsegurada
  const resumen = [
    `Cotizado con el plan ${textoDe(planes, planComercial)}, ${textoDe(modos, modoFacturacion).toLowerCase()}, ${textoDe(condiciones, condicionDePago).toLowerCase()} con ${textoDe(formas, formaDePago).toLowerCase()}`,
    `productor ${productor}`,
    v.sumaAsegurada !== null ? `suma asegurada ${enPesos(v.sumaAsegurada)} (la cargada en el formulario)` : `suma asegurada ${enPesos(sumaUsada)} (la de Equidad)`,
    bonificacionAplicada ? `bonificación ${bonificacionAplicada}${bonificacion ? '' : ' (la del plan)'}` : '',
    recargoAplicado ? `RA ${recargoAplicado}${recargoAdministrativo ? '' : ' (el de Equidad)'}` : '',
    cotizacion.solicitud ? `solicitud ${cotizacion.solicitud}${cotizacion.instalacion ? `/${cotizacion.instalacion}` : ''} en Equidad` : '',
  ]
    .filter(Boolean)
    .join(', ')

  return { estado: 'OK', mensaje: `${resumen}.`, descripcionVehiculo, coberturas, avisos, ajustes, detalleTecnico }
}

// --- Los listados ---------------------------------------------------------------------------------------

/** El cliente, el contexto y el productor de la cuenta: lo que piden los dos listados. */
async function contextoDeListados(): Promise<{ cliente: ClienteEquidad; c: ContextoEquidad; productor: string }> {
  const cuenta = cuentaActual()
  if (!cuenta) throw new ErrorDeEquidad('Falta cargar la cuenta de Equidad en API Aseguradoras → Equidad.', false)
  const cliente = crearClienteEquidad(cuentaDe(cuenta))
  const sesion = await cliente.sesion()
  const c: ContextoEquidad = { usuario: sesion.usuarioCodigo, empresa: cuenta.empresa, rama: cuenta.rama }
  const productores = await enMemoria(`productores:${c.empresa}`, () => productoresEquidad(cliente, c)).catch(() => [])
  const productor = productorPorDefecto(
    cuenta.productor,
    productores.map((p) => ({ codigo: p.codigo, descripcion: p.nombre })),
  )
  if (!productor) throw new ErrorDeEquidad('Equidad no listó productores para el usuario: cargá el productor en API Aseguradoras → Equidad.', false)
  return { cliente, c, productor }
}

/** Los planes comerciales de hoy, para el tipo de póliza con que se cotiza por defecto. */
async function planes(): Promise<PlanDeAseguradora[]> {
  const { cliente, c, productor } = await contextoDeListados()
  const tipos = await enMemoria(`tipos:${c.rama}`, () => tiposDePolizaEquidad(cliente, c))
  const tipoPoliza = tipoDePolizaPorDefecto(tipos)
  if (!tipoPoliza) return []
  const hoy = new Date().toISOString().slice(0, 10)
  const lista = await enMemoria(`planes:${c.rama}:${tipoPoliza}:${productor}:${hoy}`, () => planesComercialesEquidad(cliente, c, tipoPoliza, productor, hoy))
  const nombreDelTipo = tipos.find((t) => t.codigo === tipoPoliza)?.descripcion ?? tipoPoliza
  return lista.map((plan) => ({ codigo: plan.codigo, descripcion: plan.descripcion, detalle: `Productor ${productor} · ${nombreDelTipo}` }))
}

async function cotizaciones(filtros: { desde: string; hasta: string }): Promise<CotizacionDeLaApi[]> {
  const { cliente, c, productor } = await contextoDeListados()
  const lista = await cotizacionesEquidad(cliente, c, productor, filtros.desde, filtros.hasta)
  return lista.map((cotizacion) => ({
    // Equidad cotiza sólo autos por API (la rama automotor).
    tipo: 'AUTO',
    numero: cotizacion.solicitud,
    fecha: fechaIsoDe(cotizacion.fechaIngreso),
    tomador: cotizacion.tomador,
    vehiculo: cotizacion.esFlota ? 'Flota' : cotizacion.riesgo,
    patente: cotizacion.patente,
    cobertura: '',
    premio: null,
    sumaAsegurada: cotizacion.sumaAsegurada,
    vigenciaDesde: fechaIsoDe(cotizacion.inicioVigencia),
    vigenciaHasta: fechaIsoDe(cotizacion.finVigencia),
  }))
}

export const equidad: CotizadorDeAseguradora = {
  id: ID_EQUIDAD,
  nombre: NOMBRE,
  tipos: ['AUTO'] as readonly TipoDeVehiculo[],
  emite: false,
  noDisponible: () => (cuentaActual() ? null : 'Falta cargar la cuenta de Equidad en API Aseguradoras → Equidad.'),
  async localidades(_tipo, codigoPostal) {
    const cuenta = cuentaActual()
    if (!cuenta) return []
    const cliente = crearClienteEquidad(cuentaDe(cuenta))
    const lista = await enMemoria(`cp:${codigoPostal}`, () => localidadesEquidad(cliente, codigoPostal))
    return [...new Set(lista.map((l) => l.localidad).filter(Boolean))]
  },
  cotizar,
  planes,
  cotizaciones,
  // La API GLM no tiene un listado de pólizas emitidas.
}
