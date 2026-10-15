// La cotización de autos en Mercantil Andina: `POST cotizaciones/v2/automotores`.
//
// La ruta está confirmada contra el gateway; la FORMA del pedido y de la respuesta sale de la
// documentación del producto Automotores del portal, que sólo se ve con la cuenta: por eso el pedido se
// arma en UN lugar (`armarPedidoDeCotizacion`) con los nombres de siempre de su API, y la respuesta se
// lee buscando las coberturas por lo que son (una lista de filas con un precio) y no por el nombre de
// una clave. Si Mercantil contesta algo que no se entiende, la tarjeta lo dice y «Copiar datos para
// Mercantil Andina» trae el pedido y la respuesta enteros para ajustar esto.
import { ErrorDeMercantil, type ClienteMercantil } from './cliente'
import { campo } from './catalogos'

export const RUTA_COTIZACION = 'cotizaciones/v2/automotores'

export interface DatosDeCotizacionMercantil {
  /** El código de productor (PAS). Si no se carga, Mercantil usa el del usuario. */
  productor?: string
  codigoInfoAuto: string
  anio: number
  ceroKm: boolean
  /** El código de uso de Mercantil (ver USOS_MERCANTIL en el adaptador). */
  uso: string
  gnc: boolean
  valorGnc?: number
  rastreo: boolean
  sumaAsegurada?: number
  codigoPostal: string
  localidad: string
  /** aaaa-mm-dd. */
  vigenciaDesde: string
  cuotas: number
  /** El código de forma de pago de Mercantil (ver FORMAS_DE_PAGO_MERCANTIL). */
  formaDePago: string
  /** F física, J jurídica. */
  tipoPersona: 'F' | 'J'
  /** El código de IVA de Mercantil (ver IVA_MERCANTIL). */
  iva: string
  /** Porcentaje de descuento comercial, si se pidió uno. */
  descuento?: number
}

/** El cuerpo del POST, con los nombres con que Mercantil nombra cada cosa en su API. */
export function armarPedidoDeCotizacion(d: DatosDeCotizacionMercantil): Record<string, unknown> {
  return {
    ...(d.productor ? { productor: Number(d.productor) || d.productor } : {}),
    cuotas: d.cuotas,
    formaPago: d.formaDePago,
    vigenciaDesde: d.vigenciaDesde,
    ...(d.descuento !== undefined ? { descuento: d.descuento } : {}),
    vehiculo: {
      infoauto: Number(d.codigoInfoAuto) || d.codigoInfoAuto,
      anio: d.anio,
      ceroKm: d.ceroKm,
      uso: Number(d.uso) || d.uso,
      gnc: d.gnc,
      ...(d.gnc && d.valorGnc ? { valorGnc: d.valorGnc } : {}),
      rastreador: d.rastreo,
      ...(d.sumaAsegurada ? { sumaAsegurada: d.sumaAsegurada } : {}),
    },
    localidad: {
      codigoPostal: Number(d.codigoPostal) || d.codigoPostal,
      ...(d.localidad ? { nombre: d.localidad } : {}),
    },
    persona: {
      tipo: d.tipoPersona,
      iva: d.iva,
    },
  }
}

export interface CoberturaMercantil {
  codigo: string
  descripcion: string
  premio: number
  prima: number
  /** El importe de cada cuota, si lo dice. */
  cuota: number | null
  cuotas: number | null
  franquicia: string
  sumaAsegurada: number | null
  /** La comisión del productor, si Mercantil la devuelve. */
  comision: number | null
}

export interface RespuestaDeCotizacionMercantil {
  ok: boolean
  /** El número de cotización en Mercantil, si lo dio. */
  id: string | null
  coberturas: CoberturaMercantil[]
  /** Lo que Mercantil dijo que estuvo mal, o sus observaciones. */
  mensajes: string[]
  /** La suma asegurada que aplicó, si la dice fuera de las coberturas. */
  sumaAsegurada: number | null
}

/** «$ 1.234,56», «1234.56», 1234.56 → 1234.56. Null si no es un número. */
export function numeroDeMercantil(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string') return null
  const limpio = valor.replace(/[^\d,.-]/g, '')
  if (!limpio) return null
  // Con coma y punto, el último separador es el decimal; con uno solo y tres dígitos atrás, es de miles.
  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  let normalizado: string
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    normalizado = ultimaComa > ultimoPunto ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '')
  } else if (ultimaComa >= 0) {
    normalizado = /,\d{3}$/.test(limpio) && limpio.split(',').length > 2 ? limpio.replace(/,/g, '') : limpio.replace(',', '.')
  } else {
    normalizado = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, '') : limpio
  }
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

const CLAVES_DE_PREMIO = ['premio', 'premioTotal', 'premio_total', 'importeTotal', 'importe', 'total', 'precio', 'valor']
const CLAVES_DE_PRIMA = ['prima', 'primaTotal', 'prima_total', 'primaNeta']
const CLAVES_DE_CUOTA = ['cuota', 'valorCuota', 'importeCuota', 'cuotaValor', 'importe_cuota', 'premioCuota']
const CLAVES_DE_CUOTAS = ['cuotas', 'cantidadCuotas', 'cantCuotas']
const CLAVES_DE_SUMA = ['sumaAsegurada', 'suma_asegurada', 'suma', 'valorAsegurado', 'valor_asegurado']
const CLAVES_DE_COMISION = ['comision', 'comisionProductor', 'comision_productor', 'importeComision']

function esFilaDeCobertura(fila: unknown): fila is Record<string, unknown> {
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return false
  const f = fila as Record<string, unknown>
  return numeroDeMercantil(campo(f, CLAVES_DE_PREMIO)) !== null && Boolean(campo(f, ['codigo', 'code', 'id', 'producto', 'plan', 'cobertura', 'descripcion', 'desc', 'nombre']))
}

/** La primera lista de filas con precio que haya en la respuesta, buscando hasta cuatro niveles adentro. */
export function listaDeCoberturas(valor: unknown, profundidad = 0): Record<string, unknown>[] | null {
  if (profundidad > 4 || !valor || typeof valor !== 'object') return null
  if (Array.isArray(valor)) {
    const filas = valor.filter(esFilaDeCobertura)
    if (filas.length > 0 && filas.length === valor.filter((v) => v && typeof v === 'object').length) return filas
    for (const elemento of valor) {
      const adentro = listaDeCoberturas(elemento, profundidad + 1)
      if (adentro) return adentro
    }
    return null
  }
  for (const [, hijo] of Object.entries(valor as Record<string, unknown>)) {
    const adentro = listaDeCoberturas(hijo, profundidad + 1)
    if (adentro) return adentro
  }
  return null
}

function textosDe(valor: unknown): string[] {
  if (typeof valor === 'string') return valor.trim() ? [valor.trim()] : []
  if (Array.isArray(valor)) return valor.flatMap(textosDe)
  if (valor && typeof valor === 'object') {
    const v = valor as Record<string, unknown>
    const texto = campo(v, ['texto', 'mensaje', 'message', 'descripcion', 'detalle', 'error'])
    return texto ? [texto] : []
  }
  return []
}

/** Los mensajes de Mercantil (errores, observaciones, avisos), estén donde estén en el primer nivel. */
export function mensajesDe(cruda: unknown): string[] {
  if (!cruda || typeof cruda !== 'object' || Array.isArray(cruda)) return []
  const c = cruda as Record<string, unknown>
  const mensajes: string[] = []
  for (const [nombre, valor] of Object.entries(c)) {
    if (/^(errores?|mensajes?|observaciones?|avisos?|warnings?|messages?|errors?)$/i.test(nombre)) mensajes.push(...textosDe(valor))
  }
  return [...new Set(mensajes)]
}

export function leerRespuestaDeCotizacion(cruda: unknown): RespuestaDeCotizacionMercantil {
  const mensajes = mensajesDe(cruda)
  const c = cruda && typeof cruda === 'object' && !Array.isArray(cruda) ? (cruda as Record<string, unknown>) : {}
  const id = campo(c, ['id', 'cotizacion', 'numero', 'numeroCotizacion', 'idCotizacion', 'nroCotizacion']) || null
  const filas = listaDeCoberturas(cruda) ?? []
  const coberturas = filas.map((f) => {
    const codigo = campo(f, ['codigo', 'code', 'id', 'producto', 'plan', 'cobertura'])
    const descripcion = campo(f, ['descripcion', 'desc', 'nombre', 'name', 'cobertura', 'producto', 'plan', 'titulo', 'detalle']) || codigo
    const franquicia = campo(f, ['franquicia', 'franquiciaDescripcion', 'franquicia_descripcion'])
    return {
      codigo: codigo || descripcion,
      descripcion,
      premio: numeroDeMercantil(campo(f, CLAVES_DE_PREMIO)) ?? 0,
      prima: numeroDeMercantil(campo(f, CLAVES_DE_PRIMA)) ?? 0,
      cuota: numeroDeMercantil(campo(f, CLAVES_DE_CUOTA)),
      cuotas: numeroDeMercantil(campo(f, CLAVES_DE_CUOTAS)),
      franquicia: franquicia && !/^0+([.,]0+)?$/.test(franquicia) ? franquicia : '',
      sumaAsegurada: numeroDeMercantil(campo(f, CLAVES_DE_SUMA)),
      comision: numeroDeMercantil(campo(f, CLAVES_DE_COMISION)),
    }
  })
  const sumaAsegurada = numeroDeMercantil(campo(c, CLAVES_DE_SUMA)) ?? (c.vehiculo && typeof c.vehiculo === 'object' ? numeroDeMercantil(campo(c.vehiculo as Record<string, unknown>, CLAVES_DE_SUMA)) : null)
  return { ok: coberturas.length > 0, id, coberturas, mensajes, sumaAsegurada }
}

export interface CotizacionMercantil extends RespuestaDeCotizacionMercantil {
  /** El cuerpo exacto que se mandó. */
  pedido: Record<string, unknown>
  /** Lo que contestó Mercantil, sin tocar. */
  cruda: unknown
}

/**
 * Cotiza. Un rechazo de Mercantil (un 400 con `errores`) no tira: vuelve con `ok: false` y sus
 * mensajes, como cualquier otra respuesta sin coberturas. Lo que sí tira es lo que no es de la
 * cotización: sin internet, la cuenta rechazada, la ruta que no existe.
 */
export async function cotizarMercantil(cliente: ClienteMercantil, datos: DatosDeCotizacionMercantil): Promise<CotizacionMercantil> {
  const pedido = armarPedidoDeCotizacion(datos)
  let cruda: unknown
  try {
    cruda = await cliente.post(RUTA_COTIZACION, pedido)
  } catch (error) {
    if (error instanceof ErrorDeMercantil && !error.esDeRed && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 404) {
      return { ok: false, id: null, coberturas: [], mensajes: [error.message.replace(/^Mercantil respondió \d+ a [^:]+: /, '')], sumaAsegurada: null, pedido, cruda: null }
    }
    throw error
  }
  const leida = leerRespuestaDeCotizacion(cruda)
  return { ...leida, pedido, cruda }
}
