// La cotización de ATM: el método SOAP `AUTOS_Cotizar_PHP` (capítulo 2 del manual).
//
// Lo que el manual no dice y se aprendió probando contra ATM (ver la cabecera de cliente.ts):
// - El `<plan>` es obligatorio en la práctica: sin él contesta «Ha ocurrido un error inesperado».
// - `<alarma>` también («Debe informar si posee alarma»).
// - El vehículo se identifica por su código de InfoAuto (`cod_infoauto`) más el código de uso
//   (`uso`, autos) o el tipo de uso (`tipo_uso`, motos: 1 particular, 2 comercial).
// - `<fecha>` tiene que ser HOY en la Argentina (ddmmAAAA), no la fecha de vigencia.
// - IVA: CF, IN (responsable inscripto), MT (monotributo), EX (exento). Ingresos brutos vacío para
//   consumidor final y obligatorio para inscripto y monotributo.
// - Cada cobertura trae su `<comision>`, que el manual no menciona.
import type { ClienteAtm } from './cliente'
import { aObjeto, escaparXml, hijo, hijos, textoDe, type NodoXml } from './xml'

export const METODO_COTIZAR = 'AUTOS_Cotizar_PHP'

export interface DatosDeCotizacionAtm {
  vendedor: string
  plan: string
  /** F física, J jurídica. */
  persona: 'F' | 'J'
  /** CF, IN, MT o EX. */
  iva: string
  /** I0, I1, I2, I4; vacío para consumidor final. */
  codigoIIBB: string
  /** Porcentaje de bonificación (0 a 50). Undefined = la de ATM. */
  bonificacion?: number
  seccion: '3' | '4'
  /** El código de InfoAuto del vehículo (lo que ATM llama `cod_infoauto`). */
  codigoInfoAuto: string
  anio: string
  ceroKm: boolean
  /** Undefined = la de ATM para ese vehículo y año. */
  sumaAsegurada?: number
  /** Autos: el código de uso de ATM (sale de su tabla de marcas y modelos). */
  uso?: string
  /** Motos: 1 particular, 2 comercial. */
  tipoUso?: '1' | '2'
  codigoPostal: string
  subCodigoPostal?: string
  /** Cláusula de ajuste en porcentaje (sólo autos). Undefined = no se manda. */
  ajuste?: number
  /** El código del equipo de rastreo, o undefined si no tiene. */
  rastreo?: string
  alarma: boolean
  gnc: boolean
  /** Para las pruebas: la fecha del pedido. Si no, ahora. */
  fecha?: Date
}

/** La fecha de HOY en la Argentina, como la pide ATM: ddmmAAAA. */
export function fechaParaAtm(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(ahora)
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${parte('day')}${parte('month')}${parte('year')}`
}

/** Un número como lo escribe ATM en un pedido: sin separador de miles, punto decimal sólo si hace falta. */
function numeroParaAtm(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2)
}

function etiqueta(nombre: string, valor: string | undefined): string {
  if (valor === undefined) return ''
  return valor === '' ? `<${nombre}/>` : `<${nombre}>${escaparXml(valor)}</${nombre}>`
}

/** El `doc_in` del pedido, sin escapar (cliente.ts lo escapa al meterlo en el sobre). */
export function armarPedidoDeCotizacion(cuenta: { usuario: string; clave: string }, datos: DatosDeCotizacionAtm): string {
  const esAuto = datos.seccion === '3'
  const usuario = [
    etiqueta('usa', cuenta.usuario),
    etiqueta('pass', cuenta.clave),
    etiqueta('fecha', fechaParaAtm(datos.fecha)),
    etiqueta('vendedor', datos.vendedor),
    etiqueta('origen', 'WS'),
    etiqueta('plan', datos.plan),
  ].join('')
  const asegurado = [
    etiqueta('persona', datos.persona),
    etiqueta('iva', datos.iva),
    etiqueta('codigo_iibb', datos.codigoIIBB),
    datos.bonificacion !== undefined && datos.bonificacion > 0 ? etiqueta('bonificacion', numeroParaAtm(datos.bonificacion)) : '',
  ].join('')
  const bien = [
    etiqueta('cod_infoauto', datos.codigoInfoAuto),
    etiqueta('anofab', datos.anio),
    etiqueta('cerokm', datos.ceroKm ? 'S' : 'N'),
    datos.sumaAsegurada !== undefined && datos.sumaAsegurada > 0 ? etiqueta('suma', numeroParaAtm(datos.sumaAsegurada)) : '',
    esAuto ? etiqueta('uso', datos.uso) : etiqueta('tipo_uso', datos.tipoUso),
    etiqueta('codpostal', datos.codigoPostal),
    datos.subCodigoPostal ? etiqueta('sub_cp', datos.subCodigoPostal) : '',
    esAuto && datos.ajuste !== undefined ? etiqueta('ajuste', numeroParaAtm(datos.ajuste)) : '',
    etiqueta('rastreo', datos.rastreo || 'N'),
    etiqueta('alarma', datos.alarma ? '1' : '0'),
    etiqueta('seccion', datos.seccion),
    etiqueta('gnc', datos.gnc ? '1' : '0'),
  ].join('')
  return `<auto><usuario>${usuario}</usuario><asegurado>${asegurado}</asegurado><bien>${bien}</bien></auto>`
}

/** El mismo pedido con la clave tapada, para mostrarlo o guardarlo en el detalle técnico. */
export function sinClave(docIn: string): string {
  return docIn.replace(/<pass>[\s\S]*?<\/pass>/g, '<pass>***</pass>')
}

/** «89465.12» → 89465.12; «1.234,56» → 1234.56; vacío o basura → null. */
export function numeroDeAtm(valor: string): number | null {
  const limpio = valor.trim().replace(/\s/g, '').replace(/^\$/, '')
  if (!limpio) return null
  const normalizado = /,\d{1,2}$/.test(limpio) ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '')
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

export interface CoberturaAtm {
  codigo: string
  descripcion: string
  prima: number
  premio: number
  cuotas: number
  /** El importe de cada cuota. */
  importeCuota: number
  /** La cláusula de ajuste aplicada, como la escribe ATM («10%»), o ''. */
  ajuste: string
  formaDePago: string
  plan: string
  comision: number | null
  solicitud: string
}

export interface RespuestaDeCotizacionAtm {
  operacion: string
  ok: boolean
  /** Los motivos del rechazo, cuando `ok` es false. */
  mensajes: string[]
  coberturas: CoberturaAtm[]
  /** La suma asegurada con que cotizó ATM. */
  suma: number | null
  /** El uso con que cotizó, en el código interno de ATM («0101»). */
  uso: string
  /** `vehiculoblack` = SI. */
  vehiculoBlack: boolean
  /** La respuesta entera como objeto, para el detalle técnico. */
  cruda: unknown
}

export function leerRespuestaDeCotizacion(auto: NodoXml): RespuestaDeCotizacionAtm {
  const ok = textoDe(auto, 'statusSuccess').toUpperCase() === 'TRUE'
  const mensajes = hijos(hijo(auto, 'statusText'), 'msg')
    .map((msg) => msg.texto.trim())
    .filter(Boolean)
  const textoDeEstado = hijo(auto, 'statusText')?.texto.trim() ?? ''
  if (!ok && mensajes.length === 0 && textoDeEstado) mensajes.push(textoDeEstado)
  const coberturas = hijos(hijo(auto, 'cotizacion'), 'cobertura').map((c): CoberturaAtm => {
    const cuotas = Number(textoDe(c, 'cuotas'))
    const comision = textoDe(c, 'comision')
    return {
      codigo: textoDe(c, 'codigo'),
      descripcion: textoDe(c, 'descripcion'),
      prima: numeroDeAtm(textoDe(c, 'prima')) ?? 0,
      premio: numeroDeAtm(textoDe(c, 'premio')) ?? 0,
      cuotas: Number.isFinite(cuotas) && cuotas > 0 ? cuotas : 1,
      // El manual la llama `impcuota`; ATM manda `impcuotas`.
      importeCuota: numeroDeAtm(textoDe(c, 'impcuotas') || textoDe(c, 'impcuota')) ?? 0,
      ajuste: textoDe(c, 'ajuste'),
      formaDePago: textoDe(c, 'formapago') || textoDe(c, 'forma_pago'),
      plan: textoDe(c, 'plan_cot'),
      comision: comision ? numeroDeAtm(comision) : null,
      solicitud: textoDe(c, 'solicitud_glm'),
    }
  })
  const datos = hijo(auto, 'datos_cotiz')
  return {
    operacion: textoDe(auto, 'operacion'),
    ok,
    mensajes,
    coberturas: coberturas.filter((c) => c.codigo),
    suma: numeroDeAtm(textoDe(datos, 'suma')),
    uso: textoDe(datos, 'uso'),
    vehiculoBlack: /^(SI|S|TRUE|1)$/i.test(textoDe(datos, 'vehiculoblack')),
    cruda: aObjeto(auto),
  }
}

export interface CotizacionAtm extends RespuestaDeCotizacionAtm {
  /** El pedido que se mandó, sin la clave. */
  pedido: string
}

export async function cotizarAtm(cliente: ClienteAtm, datos: DatosDeCotizacionAtm): Promise<CotizacionAtm> {
  const docIn = armarPedidoDeCotizacion(cliente.cuenta, datos)
  const respuesta = leerRespuestaDeCotizacion(await cliente.soap(METODO_COTIZAR, docIn))
  return { ...respuesta, pedido: sinClave(docIn) }
}
