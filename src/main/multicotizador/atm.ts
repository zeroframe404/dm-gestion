// ATM en el multicotizador: traduce la solicitud común a su web service (SOAP `AUTOS_Cotizar_PHP`) y
// devuelve sus coberturas en la forma común. Por ahora sólo cotiza: no emite desde la aplicación.
//
// Lo que ATM pide y la solicitud común no trae —el plan (vigencia, facturación y forma de pago), su
// código del vehículo, el código de uso, ingresos brutos— sale de su REST (planes) y de sus tablas por
// FTP (vehículos, usos, localidades: ver aseguradoras/atm/tablas.ts). Como en Galeno, se elige SOLO con
// un criterio razonable y se devuelve como ajuste, para cambiarlo desde la tarjeta de ATM.
//
// EL VEHÍCULO: ATM lo identifica por su código de InfoAuto. Se busca en sus tablas por marca y por
// modelo + versión, igual que en el catálogo de Galeno, y ante la duda se pregunta en vez de adivinar.
import {
  categoriaDeCobertura,
  enPesos,
  normalizarTexto,
  type AjusteDeAseguradora,
  type CoberturaCotizada,
  type CondicionIva,
  type MedioDePago,
} from '../../shared/multicotizador'
import type { TipoDeVehiculo } from '../../shared/tipos'
import { SECCION_ATM, planesAtm, vendedoresAtm, type PlanAtm } from '../aseguradoras/atm/catalogos'
import { crearClienteAtm, ErrorDeAtm, type ClienteAtm, type CuentaAtm } from '../aseguradoras/atm/cliente'
import { cotizarAtm, type CoberturaAtm } from '../aseguradoras/atm/cotizacion'
import { tablasParaCotizar, tablasEnDisco } from '../aseguradoras/atm/repositorio'
import { localidadesDeAtm, marcasDeAtm, versionesDeAtm, type OpcionAtm, type TablasAtm, type VehiculoAtm } from '../aseguradoras/atm/tablas'
import { credencialesAtm } from '../servicios/config'
import type { CotizacionDeAseguradora, CotizadorDeAseguradora, SolicitudResuelta } from './aseguradora'
import { buscarLocalidad, buscarMarca, CLAVES_USO, porPalabrasClave, rankear, sinDudas, type OpcionDeLista } from './equivalencias'

export const ID_ATM = 'ATM'
const NOMBRE = 'ATM'

// --- Las listas REST, en memoria ---------------------------------------------------------------------
//
// Los planes y los vendedores cambian muy de vez en cuando: guardarlos media hora hace que la segunda
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
export function olvidarListasDeAtm(): void {
  listas.clear()
}

type CredencialesAtm = NonNullable<ReturnType<typeof credencialesAtm>>
let cuentaDePrueba: CredencialesAtm | null = null

/** Las pruebas (y el humo en vivo) corren sin Electron ni config.json: les pasan la cuenta acá. */
export function usarCuentaDeAtmDePrueba(cuenta: CredencialesAtm | null): void {
  cuentaDePrueba = cuenta
  listas.clear()
}

function cuentaActual(): CredencialesAtm | null {
  return cuentaDePrueba ?? credencialesAtm()
}

// --- Las decisiones, puras (se prueban solas) ---------------------------------------------------------

/** Qué forma de pago de ATM (`FormaDePagoCodigo`) corresponde a cada medio de pago de la solicitud. */
const FORMA_DE_PAGO_ATM: Record<MedioDePago, number> = { TARJETA: 3, DEBITO: 4, EFECTIVO: 0 }

/** Cuanto más corto el período que factura el plan, más se parece a lo que se compara en el mostrador. */
const PERIODOS = ['MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'CUATRIMESTRAL', 'SEMESTRAL', 'ANUAL']

function rangoDePeriodo(plan: PlanAtm): number {
  const texto = normalizarTexto(plan.descripcion).replace(/\bANUAL\b/, '')
  const indice = PERIODOS.findIndex((periodo) => new RegExp(`\\b${periodo}\\b`).test(texto))
  // «1 PAGO» paga el período entero de una vez: va después de los que se pagan por mes.
  return (indice >= 0 ? indice : PERIODOS.length) * 2 + (/\b1 PAGO\b/.test(normalizarTexto(plan.descripcion)) ? 1 : 0)
}

/**
 * El plan con que se cotiza si no se eligió otro: de la forma de pago del medio elegido, el que factura
 * más seguido («ANUAL/MENSUAL» con tarjeta o con CBU). Sin ninguno de esa forma de pago, el primero.
 */
export function planPorDefecto(planes: PlanAtm[], medio: MedioDePago): PlanAtm | undefined {
  const deEseMedio = planes.filter((plan) => plan.formaDePagoCodigo === FORMA_DE_PAGO_ATM[medio])
  const candidatos = deEseMedio.length > 0 ? deEseMedio : planes
  return [...candidatos].sort((a, b) => rangoDePeriodo(a) - rangoDePeriodo(b))[0]
}

const NOMBRE_FORMA_DE_PAGO: Record<string, string> = { TARJETA: 'tarjeta de crédito', CBU: 'débito por CBU', EFVO: 'efectivo / cupón' }

export function textoDePlan(plan: PlanAtm): string {
  return `${plan.descripcion} · ${NOMBRE_FORMA_DE_PAGO[plan.formaDePago.toUpperCase()] ?? plan.formaDePago} (plan ${plan.codigo})`
}

/** Las condiciones de IVA de ATM (probadas contra su web service: RI no existe, es IN). */
export const IVA_ATM: Record<CondicionIva, string> = {
  CONSUMIDOR_FINAL: 'CF',
  RESPONSABLE_INSCRIPTO: 'IN',
  MONOTRIBUTO: 'MT',
  EXENTO: 'EX',
}

const NOMBRE_IVA_ATM: Record<string, string> = {
  CF: 'Consumidor final',
  IN: 'Responsable inscripto',
  MT: 'Monotributo',
  EX: 'Exento',
}

/** Las categorías de ingresos brutos del manual (capítulo 2, `codigo_iibb`). */
export const IIBB_ATM: OpcionAtm[] = [
  { codigo: 'I0', descripcion: 'Inscripto local' },
  { codigo: 'I1', descripcion: 'Convenio multilateral' },
  { codigo: 'I2', descripcion: 'Exento' },
  { codigo: 'I4', descripcion: 'Régimen simplificado (sólo monotributo)' },
]

/**
 * Ingresos brutos: consumidor final no lleva (ATM lo rechaza si viene); inscripto y monotributo lo
 * llevan sí o sí. Por defecto, el más común para cada uno.
 */
export function iibbPorDefecto(iva: string): string {
  if (iva === 'IN') return 'I0'
  if (iva === 'MT') return 'I4'
  if (iva === 'EX') return 'I2'
  return ''
}

/** Las opciones de ingresos brutos que admite cada condición de IVA (según el manual). */
export function opcionesDeIibb(iva: string): OpcionAtm[] {
  if (iva === 'CF' || !iva) return []
  return iva === 'MT' ? IIBB_ATM : IIBB_ATM.filter((opcion) => opcion.codigo !== 'I4')
}

/** Particular → 1, comercial → 2: así distingue ATM los usos (columna `tipo_uso`). */
const TIPO_USO_ATM = { PARTICULAR: '1', COMERCIAL: '2' } as const

/** El uso de ATM con que se cotiza el vehículo: el del tipo pedido; si las tablas no lo dicen, por su nombre. */
export function usoPorDefecto(vehiculo: VehiculoAtm | null, usos: OpcionAtm[], uso: 'PARTICULAR' | 'COMERCIAL'): string {
  const delTipo = vehiculo?.usos.find((u) => u.tipoUso === TIPO_USO_ATM[uso])
  if (delTipo) return delTipo.codigo
  const lista = vehiculo && vehiculo.usos.length > 0 ? vehiculo.usos.map((u) => usos.find((o) => o.codigo === u.codigo) ?? { codigo: u.codigo, descripcion: u.codigo }) : usos
  return porPalabrasClave(lista, CLAVES_USO[uso])?.codigo ?? (lista.length === 1 ? lista[0]!.codigo : '')
}

/**
 * La primera cuota y las siguientes. ATM da cuántas cuotas y el importe de cada una (todas iguales):
 * con una sola, es la primera; con más, la primera y las siguientes valen lo mismo.
 */
export function cuotasDe(cobertura: CoberturaAtm): { primeraCuota: number | null; cuota: number | null } {
  const importe = cobertura.importeCuota > 0 ? cobertura.importeCuota : null
  return { primeraCuota: importe, cuota: cobertura.cuotas > 1 ? importe : null }
}

/**
 * La franquicia de un todo riesgo, leída de cómo la nombra ATM: «TODO RIESGO C/FCIA.VARIABLE 6% SUMA
 * ASEGURADA» → «6 % de la suma asegurada»; «… FRANQUICIA $ 500.000» → «$ 500.000». '' si no dice.
 */
export function franquiciaDe(descripcion: string): string {
  const texto = descripcion.toUpperCase()
  if (!/\bFCIA\b|\bFRANQ/.test(texto)) return ''
  const porcentaje = /(\d+(?:[.,]\d+)?)\s*%/.exec(texto)
  if (porcentaje) return `${porcentaje[1]!.replace('.', ',')} %${/SUMA/.test(texto) ? ' de la suma asegurada' : ''}`
  const importe = /\$\s*([\d.,]+)/.exec(texto)
  return importe ? `$ ${importe[1]}` : ''
}

/** Una ayuda para los rechazos más comunes de ATM: qué tocar para que cotice. */
export function consejoParaElRechazo(mensaje: string, anio: string): string | null {
  const texto = normalizarTexto(mensaje)
  if (/RELACION VEHICULO ANO/.test(texto)) return `ATM no tiene esa versión para el año ${anio}: probá con otra versión en los ajustes de ATM.`
  if (/NO TIENE REGISTRADO EL VEHICULO/.test(texto)) return 'Probá con otra versión o con otro uso en los ajustes de ATM.'
  if (/USUARIO INEXISTENTE|USUARIO NO ES VALIDO/.test(texto)) return 'Revisá el usuario y la clave en API Aseguradoras → ATM.'
  if (/VENDEDOR/.test(texto)) return 'Revisá el código de vendedor en API Aseguradoras → ATM.'
  if (/CONDICION IMPOSITIVA/.test(texto)) return 'Revisá «Ingresos brutos» en los ajustes de ATM.'
  if (/CONDICION DE IVA Y TIPO DE PERSONA/.test(texto)) return 'Una persona jurídica no puede ser consumidor final: cambiá la condición de IVA.'
  if (/NO EXISTEN COBERTURAS/.test(texto)) return 'ATM no tiene productos para ese código postal o ese vehículo.'
  return null
}

// --- Los ajustes --------------------------------------------------------------------------------------

function opcionesDe(lista: OpcionDeLista[]): AjusteDeAseguradora['opciones'] {
  return lista.map((opcion) => ({ valor: opcion.codigo, texto: opcion.descripcion }))
}

function valido(elegido: string | undefined, lista: Array<{ codigo: string }>): string | null {
  return elegido && lista.some((opcion) => opcion.codigo === elegido) ? elegido : null
}

function opcionesDePorcentaje(hasta: number, paso: number): OpcionDeLista[] {
  const lista: OpcionDeLista[] = []
  for (let n = 0; n <= hasta; n += paso) lista.push({ codigo: String(n), descripcion: `${n} %` })
  return lista
}

/** La cláusula de ajuste: ATM sólo distingue 0, 10 y 20 (otros valores los ignora o los redondea). */
const CLAUSULAS_ATM: OpcionDeLista[] = [
  { codigo: '0', descripcion: 'Sin cláusula de ajuste' },
  { codigo: '10', descripcion: '10 %' },
  { codigo: '20', descripcion: '20 %' },
]

interface VehiculoElegido {
  vehiculo: VehiculoAtm | null
}

function vehiculoEnAtm(solicitud: SolicitudResuelta, elegidos: Record<string, string>, tablas: TablasAtm, ajustes: AjusteDeAseguradora[]): VehiculoElegido {
  const v = solicitud.vehiculo
  const seccion = SECCION_ATM[v.tipo]
  const anio = Number(v.anio)

  const marcas = marcasDeAtm(tablas, seccion).map((marca) => ({ codigo: marca, descripcion: marca }))
  const marca = valido(elegidos.marca, marcas) ?? buscarMarca(v.marca, marcas)?.codigo ?? ''
  ajustes.push({ campo: 'marca', titulo: 'Marca en ATM', opciones: opcionesDe(marcas), valor: marca, obligatorio: true, porSolicitud: true })
  if (!marca) return { vehiculo: null }

  // Un 0 km del año (o del que viene) puede no tener suma todavía en la tabla de InfoAuto de ATM, que
  // sale una vez por noche: ahí se ofrecen todas las versiones de la marca en vez de ninguna. Para un
  // año viejo no: si no está en la tabla, ATM no lo cotiza.
  const delAnio = versionesDeAtm(tablas, seccion, marca, anio)
  const sinSumaTodavia = delAnio.length === 0 && (v.ceroKm || anio >= new Date().getFullYear())
  const versiones = sinSumaTodavia ? versionesDeAtm(tablas, seccion, marca, null) : delAnio
  const ranking = rankear(`${v.modelo} ${v.version}`, versiones, (version) => version.modelo)
  const elegida =
    versiones.find((version) => version.codigoInfoAuto === elegidos.version) ??
    (solicitud.codigoInfoAuto ? versiones.find((version) => version.codigoInfoAuto === solicitud.codigoInfoAuto) : undefined) ??
    sinDudas(ranking, 0.5, 0.1) ??
    (versiones.length === 1 ? versiones[0]! : null)
  // Las más parecidas primero: la que se busca casi siempre está entre las de arriba.
  const ordenadas = [...ranking.map((candidato) => candidato.opcion), ...versiones.filter((version) => !ranking.some((c) => c.opcion === version))]
  ajustes.push({
    campo: 'version',
    titulo: 'Versión en ATM',
    ayuda:
      versiones.length === 0
        ? `ATM no tiene versiones de ${marca} para el año ${v.anio}.`
        : sinSumaTodavia
          ? `Las tablas de ATM todavía no tienen sumas para el año ${v.anio}: están todas las versiones de ${marca}. Si ATM no tiene la elegida para ese año, lo va a decir al cotizar.`
          : undefined,
    opciones: ordenadas.map((version) => {
      const suma = version.sumas?.get(anio)
      return { valor: version.codigoInfoAuto, texto: `${version.modelo}${suma ? ` · ${enPesos(suma)}` : ''}` }
    }),
    valor: elegida?.codigoInfoAuto ?? '',
    obligatorio: true,
    dependeDe: 'marca',
    porSolicitud: true,
  })
  return { vehiculo: elegida }
}

async function cotizar(solicitud: SolicitudResuelta, elegidos: Record<string, string>): Promise<CotizacionDeAseguradora> {
  const credenciales = cuentaActual()
  if (!credenciales) throw new ErrorDeAtm('Falta cargar la cuenta de ATM en API Aseguradoras → ATM.', false)
  const cuenta: CuentaAtm = { ambiente: credenciales.ambiente, usuario: credenciales.usuario, clave: credenciales.clave }
  const cliente: ClienteAtm = crearClienteAtm(cuenta)
  const v = solicitud.vehiculo
  const tipo: TipoDeVehiculo = v.tipo
  const esAuto = tipo === 'AUTO'
  const ajustes: AjusteDeAseguradora[] = []
  const avisos: string[] = []
  const clave = `${cuenta.ambiente}:${cuenta.usuario}`

  // El vendedor: el cargado en API Aseguradoras; si no, el primero de la cuenta.
  const vendedor =
    credenciales.vendedor || (await enMemoria(`vendedores:${clave}`, () => vendedoresAtm(cliente)))[0]?.codigo || ''
  if (!vendedor) throw new ErrorDeAtm('ATM no tiene vendedores para esta cuenta: cargá el código de vendedor en API Aseguradoras → ATM.', false)

  // El plan: vigencia, facturación, cuotas y forma de pago, todo junto.
  const planes = await enMemoria(`planes:${clave}:${tipo}:${vendedor}`, () => planesAtm(cliente, tipo, vendedor))
  const plan = planes.find((p) => p.codigo === elegidos.plan) ?? planPorDefecto(planes, solicitud.medioDePago)
  ajustes.push({
    campo: 'plan',
    titulo: 'Plan',
    ayuda:
      'El plan de ATM junta la vigencia, cada cuánto se factura y la forma de pago. El premio y la cuota son los del período que factura el plan: con «ANUAL/MENSUAL», lo de cada mes. Para comparar con la web de ATM hay que usar el mismo plan.',
    opciones: planes.map((p) => ({ valor: p.codigo, texto: textoDePlan(p) })),
    valor: plan?.codigo ?? '',
    obligatorio: true,
    destacado: true,
  })

  const bonificaciones = opcionesDePorcentaje(50, 5)
  const bonificacion = valido(elegidos.bonificacion, bonificaciones) ?? ''
  ajustes.push({
    campo: 'bonificacion',
    titulo: '% Bonificación',
    ayuda: 'El descuento sobre la prima (ATM acepta hasta 50 %). Si no se elige, ATM aplica el que tiene por defecto para el vendedor.',
    opciones: opcionesDe(bonificaciones),
    valor: bonificacion,
    obligatorio: false,
    destacado: true,
  })

  let clausula = ''
  if (esAuto) {
    clausula = valido(elegidos.clausulaAjuste, CLAUSULAS_ATM) ?? '10'
    ajustes.push({
      campo: 'clausulaAjuste',
      titulo: 'Cláusula de ajuste',
      ayuda: 'Cuánto puede subir la suma asegurada durante la vigencia. El manual de ATM cotiza por defecto con 10 %.',
      opciones: opcionesDe(CLAUSULAS_ATM),
      valor: clausula,
      obligatorio: false,
      destacado: true,
    })
  }

  // Las tablas (vehículos, usos, localidades). Sin ellas no hay con qué identificar el vehículo.
  const { tablas, aviso: avisoDeTablas } = await tablasParaCotizar(cuenta)
  if (avisoDeTablas) avisos.push(avisoDeTablas)

  // El IVA y los ingresos brutos.
  const ivas: OpcionDeLista[] = Object.entries(NOMBRE_IVA_ATM).map(([codigo, descripcion]) => ({
    codigo,
    descripcion: tablas.ivas.find((o) => o.codigo === codigo)?.descripcion || descripcion,
  }))
  for (const otra of tablas.ivas) if (!ivas.some((o) => o.codigo === otra.codigo)) ivas.push(otra)
  // Es del cliente, no de la agencia: lo cambiado a mano vale mientras el formulario diga la misma
  // condición de IVA. Por eso cada opción lleva adelante la del formulario («CONSUMIDOR_FINAL|EX»): si
  // ahí se elige otra, lo de antes deja de ser una opción y vuelve a mandar el formulario.
  const delFormulario = solicitud.tomador.condicionIva
  const elegidoIva = elegidos.iva?.startsWith(`${delFormulario}|`) ? elegidos.iva.slice(delFormulario.length + 1) : undefined
  const iva = valido(elegidoIva, ivas) ?? IVA_ATM[delFormulario]
  ajustes.push({
    campo: 'iva',
    titulo: 'Condición de IVA',
    opciones: ivas.map((o) => ({ valor: `${delFormulario}|${o.codigo}`, texto: o.descripcion })),
    valor: `${delFormulario}|${iva}`,
    obligatorio: true,
    porSolicitud: true,
  })
  const iibbs = opcionesDeIibb(iva)
  const iibb = iibbs.length > 0 ? (valido(elegidos.iibb, iibbs) ?? iibbPorDefecto(iva)) : ''
  if (iibbs.length > 0) {
    ajustes.push({
      campo: 'iibb',
      titulo: 'Ingresos brutos',
      ayuda: 'ATM lo pide para inscriptos, monotributistas y exentos (para consumidor final no va).',
      opciones: opcionesDe(iibbs),
      valor: iibb,
      obligatorio: iva === 'IN' || iva === 'MT',
      dependeDe: 'iva',
      porSolicitud: true,
    })
  }

  // El vehículo y su uso.
  const { vehiculo } = vehiculoEnAtm(solicitud, elegidos, tablas, ajustes)
  let uso = ''
  if (esAuto && vehiculo) {
    const delVehiculo: OpcionDeLista[] =
      vehiculo.usos.length > 0
        ? vehiculo.usos.map((u) => {
            const nombre = tablas.usos.find((o) => o.codigo === u.codigo)?.descripcion
            const tipoDeUso = u.tipoUso === '1' ? 'particular' : u.tipoUso === '2' ? 'comercial' : ''
            return { codigo: u.codigo, descripcion: [nombre, tipoDeUso && !nombre ? tipoDeUso : '', `(${u.codigo})`].filter(Boolean).join(' ') }
          })
        : tablas.usos
    uso = valido(elegidos.uso, delVehiculo) ?? usoPorDefecto(vehiculo, tablas.usos, v.uso)
    // ATM puede tener el vehículo sólo con el otro uso (un utilitario, sólo comercial): se cotiza con
    // ése, que es el único que acepta, pero a la vista.
    const tipoDelUso = vehiculo.usos.find((u) => u.codigo === uso)?.tipoUso
    if (!elegidos.uso && tipoDelUso && tipoDelUso !== TIPO_USO_ATM[v.uso]) {
      avisos.push(`ATM tiene este vehículo sólo con uso ${tipoDelUso === '2' ? 'comercial' : 'particular'}: se cotizó con ése.`)
    }
    ajustes.push({
      campo: 'uso',
      titulo: 'Uso en ATM',
      ayuda: delVehiculo.length === 0 ? 'Las tablas de ATM no traen los usos de este vehículo.' : undefined,
      opciones: opcionesDe(delVehiculo),
      valor: uso,
      obligatorio: true,
      dependeDe: 'version',
      porSolicitud: true,
    })
  }

  // La localidad: ATM tiene un sub-código por localidad dentro del código postal. Es opcional.
  const localidades = localidadesDeAtm(tablas, solicitud.codigoPostal).map((l) => ({
    codigo: l.subCodigoPostal,
    descripcion: l.provincia ? `${l.localidad} (${l.provincia})` : l.localidad,
    // Se busca por el nombre solo: con la provincia, «Avellaneda» no coincidía con «AVELLANEDA (BUENOS AIRES)».
    nombre: l.localidad,
  }))
  const subCodigos = localidades.filter((l, i) => l.codigo && localidades.findIndex((o) => o.codigo === l.codigo) === i)
  let subCodigoPostal = ''
  if (subCodigos.length > 1) {
    subCodigoPostal = valido(elegidos.localidad, subCodigos) ?? buscarLocalidad(solicitud.localidad, subCodigos, (l) => l.nombre)?.codigo ?? ''
    ajustes.push({
      campo: 'localidad',
      titulo: 'Localidad en ATM',
      ayuda: 'Opcional: si no se elige, ATM cotiza con el código postal solo.',
      opciones: opcionesDe(subCodigos),
      valor: subCodigoPostal,
      obligatorio: false,
      porSolicitud: true,
    })
  }

  // El rastreo: ATM pide el código de su equipo. Sin elegirlo se cotiza como sin rastreo.
  let rastreo = ''
  if (v.rastreo) {
    if (tablas.rastreos.length > 0) {
      rastreo = valido(elegidos.rastreo, tablas.rastreos) ?? ''
      ajustes.push({
        campo: 'rastreo',
        titulo: 'Equipo de rastreo',
        ayuda: 'Si no se elige, ATM cotiza como si no tuviera rastreo.',
        opciones: opcionesDe(tablas.rastreos),
        valor: rastreo,
        obligatorio: false,
        porSolicitud: true,
      })
      if (!rastreo) avisos.push('Tiene rastreo satelital: elegí el equipo en los ajustes de ATM para que lo tenga en cuenta. Mientras tanto se cotizó sin rastreo.')
    } else {
      avisos.push('Tiene rastreo satelital, pero las tablas de ATM no traen sus equipos: se cotizó sin rastreo.')
    }
  }

  const alarmas: OpcionDeLista[] = [
    { codigo: '0', descripcion: 'No tiene' },
    { codigo: '1', descripcion: 'Tiene alarma' },
  ]
  const alarma = valido(elegidos.alarma, alarmas) ?? '0'
  // Es del vehículo: no se arrastra a la próxima cotización.
  ajustes.push({ campo: 'alarma', titulo: 'Alarma', opciones: opcionesDe(alarmas), valor: alarma, obligatorio: false, porSolicitud: true })

  const faltan = ajustes.filter((ajuste) => ajuste.obligatorio && !ajuste.valor)
  if (faltan.length > 0 || !plan || !vehiculo) {
    return {
      estado: 'FALTAN_DATOS',
      mensaje: `Para cotizar, elegí: ${(faltan.length > 0 ? faltan : ajustes.filter((a) => a.campo === 'plan' || a.campo === 'version')).map((a) => a.titulo.toLowerCase()).join(', ')}.`,
      descripcionVehiculo: '',
      coberturas: [],
      avisos,
      ajustes,
    }
  }

  const anio = Number(v.anio)
  const sumaDeAtm = vehiculo.sumas?.get(anio) ?? null
  const cotizacion = await cotizarAtm(cliente, {
    vendedor,
    plan: plan.codigo,
    persona: solicitud.tomador.tipoPersona === 'JURIDICA' ? 'J' : 'F',
    iva,
    codigoIIBB: iibb,
    bonificacion: bonificacion ? Number(bonificacion) : undefined,
    seccion: SECCION_ATM[tipo],
    codigoInfoAuto: vehiculo.codigoInfoAuto,
    anio: v.anio,
    ceroKm: v.ceroKm,
    sumaAsegurada: v.sumaAsegurada ?? undefined,
    uso: esAuto ? uso : undefined,
    tipoUso: esAuto ? undefined : TIPO_USO_ATM[v.uso],
    codigoPostal: solicitud.codigoPostal,
    subCodigoPostal: subCodigoPostal || undefined,
    ajuste: esAuto ? Number(clausula) : undefined,
    rastreo: rastreo || undefined,
    alarma: alarma === '1',
    gnc: v.gnc,
  })

  const descripcionVehiculo = `${vehiculo.marca} ${vehiculo.modelo} ${v.anio} (InfoAuto ${vehiculo.codigoInfoAuto})`
  const detalleTecnico = {
    ambiente: cuenta.ambiente,
    vendedor,
    plan: `${plan.codigo} — ${plan.descripcion} (${plan.formaDePago})`,
    metodo: 'SOAP AUTOS_Cotizar_PHP',
    operacion: cotizacion.operacion,
    pedido: cotizacion.pedido,
    respuesta: cotizacion.cruda,
  }

  if (!cotizacion.ok) {
    const motivos = cotizacion.mensajes.length > 0 ? cotizacion.mensajes : ['sin detalle']
    const consejo = motivos.map((motivo) => consejoParaElRechazo(motivo, v.anio)).find(Boolean)
    return {
      estado: 'ERROR',
      mensaje: `ATM no cotizó: ${motivos.join(' · ')}.${consejo ? ` ${consejo}` : ''}`,
      descripcionVehiculo,
      coberturas: [],
      avisos,
      ajustes,
      detalleTecnico,
    }
  }

  // Siempre se pide UN plan; si ATM devolviera de varios, sólo las del pedido.
  const delPlan = cotizacion.coberturas.some((c) => c.plan === plan.codigo) ? cotizacion.coberturas.filter((c) => c.plan === plan.codigo) : cotizacion.coberturas
  const coberturas: CoberturaCotizada[] = delPlan.map((c) => ({
    aseguradora: ID_ATM,
    nombreAseguradora: NOMBRE,
    codigo: c.codigo,
    nombre: c.descripcion,
    categoria: categoriaDeCobertura(c.descripcion, c.codigo),
    premio: c.premio,
    prima: c.prima,
    ...cuotasDe(c),
    franquicia: franquiciaDe(c.descripcion),
    adicionales: [],
    comision: c.comision,
    // ATM no devuelve el porcentaje aplicado; el pedido sí (y si no lo acepta, rechaza la cotización).
    bonificacionPorcentaje: bonificacion ? Number(bonificacion) : null,
    recargoAdministrativoPorcentaje: null,
    emision: null,
  }))

  if (cotizacion.vehiculoBlack) avisos.push('ATM marca este vehículo como «vehículo black» (de su lista de vehículos con restricciones).')
  if (v.sumaAsegurada !== null && coberturas.length > 0 && coberturas.every((c) => c.categoria === 'RC')) {
    avisos.push(
      `Con la suma asegurada cargada (${enPesos(v.sumaAsegurada)}) ATM sólo cotizó responsabilidad civil: suele pasar cuando se va del desvío que permite sobre su valor${sumaDeAtm ? ` (para este vehículo usa ${enPesos(sumaDeAtm)})` : ''}. Dejá la suma vacía para que use la suya.`,
    )
  }

  const textoDe = (lista: OpcionDeLista[], codigo: string) => lista.find((o) => o.codigo === codigo)?.descripcion ?? codigo
  const sumaUsada = v.sumaAsegurada ?? cotizacion.suma ?? sumaDeAtm
  const resumen = [
    `Cotizado con el plan «${plan.descripcion}» (${NOMBRE_FORMA_DE_PAGO[plan.formaDePago.toUpperCase()] ?? plan.formaDePago}, plan ${plan.codigo}) y el vendedor ${vendedor}`,
    esAuto ? `cláusula de ajuste «${textoDe(CLAUSULAS_ATM, clausula)}»` : '',
    bonificacion ? `bonificación ${bonificacion} %` : 'bonificación: la de ATM por defecto',
    v.sumaAsegurada !== null
      ? `suma asegurada ${enPesos(v.sumaAsegurada)} (la cargada en el formulario)`
      : `suma asegurada: la de ATM${sumaUsada ? ` (${enPesos(sumaUsada)})` : ''}`,
  ]
    .filter(Boolean)
    .join(', ')

  return {
    estado: 'OK',
    mensaje: coberturas.length === 0 ? 'ATM no devolvió coberturas para estos datos.' : `${resumen}.`,
    descripcionVehiculo,
    coberturas,
    avisos,
    ajustes,
    detalleTecnico,
  }
}

export const atm: CotizadorDeAseguradora = {
  id: ID_ATM,
  nombre: NOMBRE,
  tipos: ['AUTO', 'MOTO'],
  emite: false,
  noDisponible: () => (cuentaActual() ? null : 'Falta cargar la cuenta de ATM en API Aseguradoras → ATM.'),
  async localidades(_tipo, codigoPostal) {
    const credenciales = cuentaActual()
    if (!credenciales) return []
    const tablas = tablasEnDisco(credenciales.ambiente)
    if (!tablas) return []
    // En Capital ATM no lista localidades sino calles con alturas: no sirven para elegir la localidad.
    return localidadesDeAtm(tablas, codigoPostal)
      .filter((l) => !/CAPITAL|C\s*A\s*B\s*A|CIUDAD AUT/i.test(normalizarTexto(l.provincia)))
      .map((l) => l.localidad)
  },
  cotizar,
}
