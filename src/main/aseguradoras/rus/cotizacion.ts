// La cotización de autos y motos en RUS: `POST cotizaciones/automotores` (ramo 4) y `POST
// cotizaciones/motos` (ramo 20).
//
// La forma del pedido y la de la respuesta salen de la documentación de Postman de RUS: el pedido lleva
// el productor (y el solicitante), el ramo, el tipo de interés, la condición fiscal, la vigencia (desde,
// hasta y su `vigenciaPolizaId`), las cuotas, el ajuste automático y el vehículo (año, GNC, código postal
// de guarda, `modeloVehiculo` —el id de la versión del catálogo de RUS— y el uso por su nombre). La
// respuesta trae `cotizaciones`: una por combinación de responsabilidad civil y casco, con `premio`,
// `prima`, `valorCuota`, `franquicia` y `sumaAsegurada`. Un rechazo es un 400 con `errors`.
import { categoriaDeCobertura, enPesos, normalizarTexto, type CategoriaDeCobertura } from '../../../shared/multicotizador'
import type { TipoDeVehiculo } from '../../../shared/tipos'
import { ErrorDeRus, erroresDeRus, textoSuelto, type ClienteRus } from './cliente'

export const RUTA_COTIZACION: Record<TipoDeVehiculo, string> = { AUTO: 'cotizaciones/automotores', MOTO: 'cotizaciones/motos' }
export const RAMO_RUS: Record<TipoDeVehiculo, string> = { AUTO: '4', MOTO: '20' }
export const TIPO_DE_INTERES_RUS: Record<TipoDeVehiculo, string> = { AUTO: 'VEHICULO', MOTO: 'MOTOVEHICULO' }

export interface DatosDeCotizacionRus {
  tipo: TipoDeVehiculo
  productor: string
  solicitante: string
  /** El código de condición fiscal de RUS (CF, RI, RMT, EX…). */
  condicionFiscal: string
  /** aaaa-mm-dd. */
  vigenciaDesde: string
  vigenciaHasta: string
  vigenciaId: string
  cuotas: number
  /** El porcentaje del ajuste automático (20, 30 o 40). */
  ajusteAutomatico: number
  paisesLimitrofes: boolean
  anio: string
  gnc: boolean
  codigoPostal: string
  /** El id de la versión en el catálogo de RUS. */
  modeloVehiculo: string
  /** El uso por su nombre en RUS («PARTICULAR», «COMERCIAL»…). */
  uso: string
  /** El número de solicitud desde el origen: cualquier número que identifique el pedido. */
  numeroSolicitud: number
}

/** «2026-10-20» + 6 meses → «2027-04-20». Si el día no existe en el mes de llegada, el último del mes. */
export function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number]
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate()
  destino.setUTCDate(Math.min(d, ultimo))
  return destino.toISOString().slice(0, 10)
}

/** El cuerpo del POST, como el ejemplo «Cotización» de la documentación de RUS. */
export function armarPedidoDeCotizacion(d: DatosDeCotizacionRus): Record<string, unknown> {
  const comoNumero = (valor: string) => (/^\d+$/.test(valor) ? Number(valor) : valor)
  return {
    codigoSolicitante: comoNumero(d.solicitante || d.productor),
    codigoProductor: comoNumero(d.productor),
    numeroSolicitud: d.numeroSolicitud,
    codigoRamoPoliza: Number(RAMO_RUS[d.tipo]),
    codigoTipoInteres: TIPO_DE_INTERES_RUS[d.tipo],
    condicionFiscal: d.condicionFiscal,
    vigencia: { desde: d.vigenciaDesde, hasta: d.vigenciaHasta },
    cuotas: d.cuotas,
    ajusteAutomatico: d.ajusteAutomatico,
    vehiculos: [
      {
        // Como en el ejemplo de RUS: el año va como texto; el código postal y el modelo, como números.
        anio: d.anio,
        gnc: d.gnc ? 'SI' : 'NO',
        cpLocalidadGuarda: comoNumero(d.codigoPostal),
        modeloVehiculo: comoNumero(d.modeloVehiculo),
        uso: d.uso,
      },
    ],
    aumentoRCPaisesLimitrofes: d.paisesLimitrofes ? 'SI' : 'NO',
    vigenciaPolizaId: comoNumero(d.vigenciaId),
  }
}

export interface CoberturaRus {
  /** Lo que la identifica en la comparación: el código de RC y, si tiene, el de casco («RCA|T34»). */
  codigo: string
  codigoRC: string
  codigoCasco: string
  descripcion: string
  categoria: CategoriaDeCobertura
  premio: number
  prima: number
  cuota: number | null
  cuotas: number | null
  franquicia: string
  sumaAsegurada: number | null
  adicionales: string[]
  ajustesPosibles: string[]
}

export interface RespuestaDeCotizacionRus {
  ok: boolean
  coberturas: CoberturaRus[]
  /** Lo que RUS dijo que estuvo mal. */
  mensajes: string[]
  status: number
}

/** 260928, «22389000.0», «20,00» → número. Null si no es un número. */
export function numeroDeRus(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string' || !valor.trim()) return null
  const limpio = valor.trim()
  const n = Number(/^\d+,\d+$/.test(limpio) ? limpio.replace(',', '.') : limpio)
  return Number.isFinite(n) ? n : null
}

/** El texto de RUS sin etiquetas ni entidades HTML («P&eacute;rdida» → «Pérdida»). */
export function sinHtml(texto: string): string {
  const entidades: Record<string, string> = { aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', ordm: 'º', ordf: 'ª', nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>' }
  return texto
    .replace(/<[^>]+>/g, ' ')
    .replace(/&([a-zA-Z]+);/g, (todo, nombre: string) => entidades[nombre] ?? todo)
    .replace(/&#(\d+);/g, (_t, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * En qué categoría cae una cobertura de RUS, por su código de casco, que es la escala de RUS: sin casco es
 * sólo responsabilidad civil; B (B2, B1-80, B-80) es pérdida total; C (C1-80, C2-80) suma lo parcial de
 * incendio y robo; S es su «Tercero Completo Full»; T (T31, T34, T44…) es todo riesgo con franquicia. Lo
 * que no se reconoce por el código se lee por el nombre, como en el resto de las compañías.
 */
export function categoriaRus(codigoCasco: string, descripcion: string): CategoriaDeCobertura {
  const casco = normalizarTexto(codigoCasco)
  if (!casco) return 'RC'
  if (/^T\d/.test(casco)) return 'TODO_RIESGO'
  if (/^S(\s|$)/.test(casco)) return 'TERCEROS_PREMIUM'
  if (/^C(\d|\s|$)/.test(casco)) return 'TERCEROS_COMPLETO'
  if (/^B(\d|\s|$)/.test(casco)) return 'TERCEROS_BASICO'
  return categoriaDeCobertura(descripcion, codigoCasco)
}

/** El nombre de la cobertura como se muestra: el comercial de RUS, o el de su RC si es sólo RC. */
function nombreDeCobertura(fila: Record<string, unknown>, codigoRC: string, codigoCasco: string): string {
  const comercial = textoSuelto(fila.nombreComercialCobertura) || textoSuelto(fila.descripcionComercial)
  if (comercial) return comercial.replace(/\s+/g, ' ')
  if (codigoCasco) return sinHtml(textoSuelto(fila.descripcionCasco)).split(/[.:]/)[0]?.trim() || codigoCasco
  const conGrua = /C\/\s*GRUA/i.test(codigoRC) ? ' con grúa' : /S\/\s*GRUA/i.test(codigoRC) ? ' sin grúa' : ''
  return `Responsabilidad civil${conGrua} (${codigoRC})`
}

function siONo(valor: unknown): boolean {
  return /^S/i.test(textoSuelto(valor))
}

/** Las coberturas de la respuesta. Cada fila es una combinación de RC y casco con su precio. */
export function leerCoberturas(datos: unknown): CoberturaRus[] {
  if (!datos || typeof datos !== 'object') return []
  const lista = (datos as Record<string, unknown>).cotizaciones
  if (!Array.isArray(lista)) return []
  const vistas = new Set<string>()
  return lista.flatMap((elemento) => {
    if (!elemento || typeof elemento !== 'object') return []
    const fila = elemento as Record<string, unknown>
    const premio = numeroDeRus(fila.premio)
    if (premio === null || premio <= 0) return []
    const codigoRC = textoSuelto(fila.codigoRC)
    const codigoCasco = textoSuelto(fila.codigoCasco)
    let codigo = codigoCasco ? `${codigoRC}|${codigoCasco}` : codigoRC || 'RC'
    // Dos filas con los mismos códigos (no debería pasar) no se pisan en la comparación.
    for (let n = 2; vistas.has(codigo); n++) codigo = `${codigo.replace(/#\d+$/, '')}#${n}`
    vistas.add(codigo)
    const descripcion = nombreDeCobertura(fila, codigoRC, codigoCasco)
    const franquicia = numeroDeRus(fila.franquicia)
    const adicionales = [
      siONo(fila.auxilioMecanico) ? 'Auxilio mecánico' : '',
      siONo(fila.paisesLimitrofes) ? 'Países limítrofes' : '',
      siONo(fila.coberturaVida) ? 'Cobertura de vida' : '',
    ].filter(Boolean)
    const posibles = Array.isArray(fila.ajustesAutomaticosPosibles) ? fila.ajustesAutomaticosPosibles.map((a) => numeroDeRus(a)).filter((a): a is number => a !== null) : []
    return [
      {
        codigo,
        codigoRC,
        codigoCasco,
        descripcion,
        categoria: categoriaRus(codigoCasco, `${descripcion} ${textoSuelto(fila.detalleCoberturaCasco)}`),
        premio,
        prima: numeroDeRus(fila.prima) ?? 0,
        cuota: numeroDeRus(fila.valorCuota),
        cuotas: numeroDeRus(fila.cuotas),
        franquicia: franquicia && franquicia > 0 ? enPesos(franquicia) : '',
        sumaAsegurada: numeroDeRus(fila.sumaAsegurada),
        adicionales,
        ajustesPosibles: posibles.map((a) => String(Math.round(a))),
      },
    ]
  })
}

/** Lo que contestó RUS, entendido: coberturas con precio, o los motivos del rechazo. */
export function leerRespuestaDeCotizacion(status: number, datos: unknown, texto: string): RespuestaDeCotizacionRus {
  const coberturas = status >= 200 && status < 300 ? leerCoberturas(datos) : []
  const mensajes = erroresDeRus(datos)
  if (mensajes.length === 0 && (status < 200 || status >= 300)) {
    const d = datos && typeof datos === 'object' ? (datos as Record<string, unknown>) : {}
    const suelto = textoSuelto(d.message) || textoSuelto(d.Message) || texto.replace(/\s+/g, ' ').trim().slice(0, 200)
    mensajes.push(`RUS respondió ${status}${suelto ? `: ${suelto}` : ''}`)
  }
  return { ok: coberturas.length > 0, coberturas, mensajes, status }
}

export interface CotizacionRus extends RespuestaDeCotizacionRus {
  pedido: Record<string, unknown>
  /** La respuesta tal cual vino, para «Copiar datos para RUS». */
  cruda: unknown
}

export async function cotizarRus(cliente: ClienteRus, datos: DatosDeCotizacionRus): Promise<CotizacionRus> {
  const pedido = armarPedidoDeCotizacion(datos)
  const respuesta = await cliente.enviar(RUTA_COTIZACION[datos.tipo], pedido, 'la cotización')
  if (respuesta.status >= 500 && respuesta.datos === undefined) {
    throw new ErrorDeRus(`RUS respondió ${respuesta.status} a la cotización, sin explicación: probá de nuevo en un rato.`, false, respuesta.status)
  }
  return { ...leerRespuestaDeCotizacion(respuesta.status, respuesta.datos, respuesta.texto), pedido, cruda: respuesta.datos ?? respuesta.texto }
}
