// La cotización de autos en Mercantil Andina: `POST cotizaciones/v2/auto`.
//
// La ruta, la forma del pedido y la de la respuesta salen de la colección de Postman que mandó el
// equipo de APIs de Mercantil (20/10/2026): el pedido va en snake_case (`codigo_postal`, `tipo_pago`,
// `ajuste_suma`) con el productor como `{id}`, y la respuesta trae las coberturas en `resultado`, cada
// una con su `codigo_producto`, su `costo` (el premio) y, con `desglose: true`, la prima y las cuotas.
// Si Mercantil contesta algo que no se entiende, la tarjeta lo dice y «Copiar datos para Mercantil
// Andina» trae el pedido y la respuesta enteros para ajustar esto.
import { ErrorDeMercantil, type ClienteMercantil } from './cliente'
import { campo } from './catalogos'

export const RUTA_COTIZACION = 'cotizaciones/v2/auto'

export interface DatosDeCotizacionMercantil {
  /** El código de productor (PAS). Si no se carga, Mercantil usa el del usuario. */
  productor?: string
  codigoInfoAuto: string
  anio: number
  /** El código de uso de Mercantil (ver USOS_MERCANTIL en el adaptador). */
  uso: string
  gnc: boolean
  rastreo: boolean
  codigoPostal: string
  cuotas: number
  /** El `tipo_pago` de Mercantil (ver FORMAS_DE_PAGO_MERCANTIL). */
  formaDePago: string
  /** El código de inscripción de IVA de Mercantil (ver IVA_MERCANTIL): 5 es consumidor final. */
  iva: string
  /** Porcentaje de bonificación (descuento comercial), si se pidió uno. */
  descuento?: number
}

/** El cuerpo del POST, como el ejemplo «Cotizar Auto» de la colección de Mercantil. */
export function armarPedidoDeCotizacion(d: DatosDeCotizacionMercantil): Record<string, unknown> {
  return {
    localidad: { codigo_postal: Number(d.codigoPostal) || d.codigoPostal },
    vehiculo: {
      infoauto: Number(d.codigoInfoAuto) || d.codigoInfoAuto,
      anio: d.anio,
      uso: Number(d.uso) || d.uso,
      gnc: d.gnc,
      rastreo: d.rastreo ? 1 : 0,
    },
    ...(d.descuento !== undefined ? { bonificacion: d.descuento } : {}),
    periodo: 1,
    cuotas: d.cuotas,
    pago: { tipo_pago: d.formaDePago },
    ajuste_suma: 0,
    iva: Number(d.iva) || d.iva,
    desglose: true,
    ...(d.productor ? { productor: { id: Number(d.productor) || d.productor } } : {}),
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

const CLAVES_DE_PREMIO = ['costo', 'premio', 'premioTotal', 'premio_total', 'importeTotal', 'importe', 'total', 'precio', 'valor']
const CLAVES_DE_PRIMA = ['prima', 'primaTotal', 'prima_total', 'primaNeta']
const CLAVES_DE_CUOTA = ['cuota', 'valorCuota', 'importeCuota', 'cuotaValor', 'importe_cuota', 'premioCuota']
const CLAVES_DE_CUOTAS = ['cantidad_cuotas', 'cuotas', 'cantidadCuotas', 'cantCuotas']
const CLAVES_DE_SUMA = ['suma_asegurada', 'sumaAsegurada', 'suma_asegurada', 'suma', 'valorAsegurado', 'valor_asegurado']
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

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null
}

/**
 * Una fila de `resultado`, la forma que muestra la colección de Mercantil: `costo` es el premio y, con
 * `desglose`, `desglose.total` trae la prima y `desglose.cuotas` el importe de cada cuota. Una fila con
 * `error` no es una cobertura: es Mercantil diciendo por qué no la cotizó.
 */
function coberturaDeResultado(fila: Record<string, unknown>): CoberturaMercantil {
  const total = objeto(objeto(fila.desglose)?.total) ?? {}
  const cuotas = objeto(fila.desglose)?.cuotas
  const primeraCuota = Array.isArray(cuotas) ? objeto(cuotas[0]) : null
  const codigo = campo(fila, ['codigo_producto', 'producto', 'titulo'])
  const descripcion = campo(fila, ['descripcion', 'texto', 'titulo', 'producto']) || codigo
  const franquicia = campo(fila, ['franquicia'])
  const cantidad = numeroDeMercantil(fila.cantidad_cuotas)
  return {
    codigo: codigo || descripcion,
    descripcion: descripcion.replace(/\s+/g, ' ').trim(),
    premio: numeroDeMercantil(fila.costo) ?? numeroDeMercantil(total.premio) ?? 0,
    prima: numeroDeMercantil(total.prima) ?? 0,
    cuota: cantidad && cantidad > 1 && primeraCuota ? numeroDeMercantil(primeraCuota.premio) : null,
    cuotas: cantidad,
    franquicia: franquicia && !/^0+([.,]0+)?$/.test(franquicia) ? franquicia : '',
    sumaAsegurada: null,
    comision: null,
  }
}

export function leerRespuestaDeCotizacion(cruda: unknown): RespuestaDeCotizacionMercantil {
  const resultado = objeto(cruda)?.resultado
  if (Array.isArray(resultado)) {
    const c = cruda as Record<string, unknown>
    const filas = resultado.map(objeto).filter((f): f is Record<string, unknown> => f !== null)
    const conError = filas.filter((f) => campo(f, ['error']))
    const coberturas = filas.filter((f) => !campo(f, ['error'])).map(coberturaDeResultado).filter((cobertura) => cobertura.premio > 0)
    const mensajes = [
      ...new Set([
        ...mensajesDe(cruda),
        ...textosDe(c.advertencia),
        ...conError.map((f) => `${campo(f, ['descripcion', 'texto', 'producto'])}: ${campo(f, ['error'])}`.replace(/^: /, '')),
      ]),
    ]
    return {
      ok: coberturas.length > 0,
      id: campo(c, ['id']) || null,
      coberturas,
      mensajes,
      sumaAsegurada: numeroDeMercantil(c.suma_asegurada) ?? numeroDeMercantil(objeto(c.vehiculo)?.valor),
    }
  }
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
  /** El `tipo_pago` con que cotizó al final: el pedido, o «C» si con el pedido Mercantil no cotizó. */
  formaDePago: string
}

/** El `tipo_pago` del único ejemplo de cotización de la colección de Mercantil (cupón). */
export const FORMA_DE_PAGO_DEL_EJEMPLO = 'C'

async function intentar(cliente: ClienteMercantil, datos: DatosDeCotizacionMercantil): Promise<CotizacionMercantil> {
  const pedido = armarPedidoDeCotizacion(datos)
  let cruda: unknown
  try {
    cruda = await cliente.post(RUTA_COTIZACION, pedido)
  } catch (error) {
    if (error instanceof ErrorDeMercantil && !error.esDeRed && error.status !== undefined && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 404) {
      return { ok: false, id: null, coberturas: [], mensajes: [error.message.replace(/^Mercantil respondió \d+ a [^:]+: /, '')], sumaAsegurada: null, pedido, cruda: null, formaDePago: datos.formaDePago }
    }
    throw error
  }
  return { ...leerRespuestaDeCotizacion(cruda), pedido, cruda, formaDePago: datos.formaDePago }
}

/**
 * Cotiza. Un rechazo de Mercantil (un 400 con `errores`) no tira: vuelve con `ok: false` y sus
 * mensajes, como cualquier otra respuesta sin coberturas. Lo que sí tira es lo que no es de la
 * cotización: sin internet, la cuenta rechazada, la ruta que no existe.
 *
 * La colección de Mercantil cotiza sólo con `tipo_pago` «C»; «DEBITO» aparece al suscribir, con el
 * canal y el número de tarjeta. Si con otra forma de pago Mercantil rechaza la cotización (con
 * «DEBITO» contestó `MCA500`, sin explicación), se vuelve a pedir con «C» y se avisa.
 */
export async function cotizarMercantil(cliente: ClienteMercantil, datos: DatosDeCotizacionMercantil): Promise<CotizacionMercantil> {
  const primera = await intentar(cliente, datos)
  if (primera.ok || primera.cruda !== null || datos.formaDePago === FORMA_DE_PAGO_DEL_EJEMPLO) return primera
  const conCupon = await intentar(cliente, { ...datos, formaDePago: FORMA_DE_PAGO_DEL_EJEMPLO })
  if (!conCupon.ok) return primera
  const motivo = primera.mensajes.join(' · ')
  return {
    ...conCupon,
    mensajes: [
      `Mercantil no cotizó con la forma de pago «${datos.formaDePago}»${motivo ? ` (${motivo})` : ''}: se cotizó con cupón («${FORMA_DE_PAGO_DEL_EJEMPLO}»), como en su ejemplo. El débito se elige al suscribir.`,
      ...conCupon.mensajes,
    ],
  }
}
