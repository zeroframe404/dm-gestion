// La cotización de autos en la API GLM de Equidad: `POST CotizarAutomotor` (docs/APIGLM V.1.11,
// «APIGLM - WS - CotizarAutomotor.docx»). El pedido se arma en UN lugar (`armarPedidoDeCotizacion`)
// con los nombres exactos del documento —incluida la errata `PorcenjateRecargoAdm`, que es como la API
// nombra el porcentaje de recargo administrativo— y la respuesta se lee por lo que documenta:
// `Coberturas` (con prima, bonificación, recargos, premio, cuotas y comisión), `Excepciones` (avisos
// sobre la cotización o sobre una cobertura) y `Errores`.
import { campo, type ClienteEquidad, ErrorDeEquidad } from './cliente'
import { listaDe, numeroDeEquidad } from './catalogos'

export interface DatosDeCotizacionEquidad {
  /** `Usuario`: el código de usuario de aplicación. */
  usuario: string
  rama: string
  /** Para recotizar: la solicitud e instalación de la cotización a recalcular. */
  solicitud?: string
  instalacion?: string
  tipoPoliza: string
  tomadorNombre: string
  tomadorCuit: string
  /** '1' física, '2' jurídica. */
  tomadorTipoPersona: '1' | '2'
  tomadorIva: string
  tomadorIibb: string
  /** aaaa-mm-dd. */
  vigenciaDesde: string
  vigenciaHasta?: string
  productor: string
  moneda: string
  planComercial: string
  formaDePago: string
  modoFacturacion: string
  condicionDePago: string
  bonificacionPorcentaje?: number
  recargoAdministrativoPorcentaje?: number
  riesgo: {
    codigoPostal: string
    subCodigoPostal: string
    marcaCodigo: string
    modeloCodigo: string
    subModeloCodigo: string
    anio: string
    ceroKm: boolean
    capitulo: string
    varianteRC: string
    varianteAIR: string
    clausulaAjuste: string
    /** Vacío si no se pide adicional de granizo (la API no lista los códigos). */
    adicionalGranizo: string
    rastreo: boolean
    alarmaSatelital: string
    gnc: boolean
    sumaAsegurada: number
    /** Bonificación por alarma. */
    alarma: boolean
    accesorios: Array<{ codigo: string; valorAsegurado?: number; identificacion?: string }>
  }
}

function entero(valor: string): number {
  const n = Number(valor)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** El cuerpo del POST, con los nombres con que la API GLM nombra cada cosa. */
export function armarPedidoDeCotizacion(d: DatosDeCotizacionEquidad): Record<string, unknown> {
  const r = d.riesgo
  return {
    SistemaOrigen: '',
    Usuario: d.usuario,
    Rama: entero(d.rama),
    ...(d.solicitud ? { Solicitud: entero(d.solicitud) } : {}),
    ...(d.instalacion ? { Instalacion: entero(d.instalacion) } : {}),
    TipoPolizaCodigo: d.tipoPoliza,
    TomadorNombre: d.tomadorNombre.slice(0, 60),
    TomadorCUIT: d.tomadorCuit.slice(0, 20),
    TomadorTipoPersona: d.tomadorTipoPersona,
    // Sic: así (sin la «r») nombra el documento la categoría de IVA del tomador.
    TomadoCategoriaIVACodigo: d.tomadorIva,
    TomadorIIBBCodigo: d.tomadorIibb,
    VigenciaDesde: d.vigenciaDesde,
    ProductorCodigo: entero(d.productor),
    MonedaCodigo: d.moneda,
    PlanComercialCodigo: d.planComercial,
    FormaPagoCodigo: entero(d.formaDePago),
    ModoFacturacionCodigo: d.modoFacturacion,
    CondicionPagoCodigo: d.condicionDePago,
    VigenciaHasta: d.vigenciaHasta ?? '',
    ...(d.bonificacionPorcentaje !== undefined ? { PorcentajeBonificacion: d.bonificacionPorcentaje } : {}),
    // Sic: la errata es de la documentación de la API, y es el nombre que la API espera.
    ...(d.recargoAdministrativoPorcentaje !== undefined ? { PorcenjateRecargoAdm: d.recargoAdministrativoPorcentaje } : {}),
    RiesgoAUT: {
      CodigoPostal: r.codigoPostal,
      SubCodigoPostal: entero(r.subCodigoPostal),
      MarcaCodigo: entero(r.marcaCodigo),
      ModeloCodigo: entero(r.modeloCodigo),
      SubModeloCodigo: entero(r.subModeloCodigo),
      AnioFabricacion: entero(r.anio),
      CeroKM: r.ceroKm ? 'S' : 'N',
      CapituloCodigo: entero(r.capitulo),
      VarianteRC: entero(r.varianteRC),
      VarianteAIR: entero(r.varianteAIR),
      ClausulaAjusteCodigo: r.clausulaAjuste,
      AdicionalGranizoCodigo: r.adicionalGranizo,
      // «2 = Posee y ' ' = No posee», según el documento.
      PoseeEquipoRastreo: r.rastreo ? '2' : ' ',
      EquipoRastreoCodigo: r.rastreo ? r.alarmaSatelital : '',
      PoseeEquipoGNC: r.gnc ? '2' : ' ',
      SumaAsegurada: r.sumaAsegurada,
      PoseeAlarma: r.alarma ? 'S' : '',
      Accesorios: r.accesorios.slice(0, 5).map((a) => ({
        Codigo: entero(a.codigo),
        ValorAsegurado: a.valorAsegurado ?? 0,
        Identificacion: a.identificacion ?? '',
      })),
    },
  }
}

export interface CoberturaEquidad {
  item: string
  codigo: string
  descripcion: string
  prima: number
  bonificacionPorcentaje: number | null
  bonificacion: number | null
  recargoAdministrativoPorcentaje: number | null
  recargoAdministrativo: number | null
  recargoFinanciero: number | null
  derechoEmision: number | null
  impuestos: number | null
  premio: number
  importeCuota1: number | null
  importeRestoCuotas: number | null
  comision: number | null
}

export interface ExcepcionEquidad {
  /** El ítem de la cobertura a la que se refiere, o vacío si es de toda la cotización. */
  item: string
  tipo: string
  motivo: string
  detalle: string
  estado: string
}

export interface RespuestaDeCotizacionEquidad {
  ok: boolean
  rama: string
  solicitud: string
  instalacion: string
  descripcionVehiculo: string
  vigenciaDesde: string
  vigenciaHasta: string
  sumaAsegurada: number | null
  coberturas: CoberturaEquidad[]
  excepciones: ExcepcionEquidad[]
  errores: string[]
}

function textosDe(valor: unknown, claves: string[]): string[] {
  const lista = Array.isArray(valor) ? valor : valor ? [valor] : []
  return lista.flatMap((e) => {
    if (typeof e === 'string') return e.trim() ? [e.trim()] : []
    if (!e || typeof e !== 'object') return []
    const texto = campo(e as Record<string, unknown>, claves)
    return texto ? [texto] : []
  })
}

export function leerRespuestaDeCotizacion(cruda: unknown): RespuestaDeCotizacionEquidad {
  const c = cruda && typeof cruda === 'object' && !Array.isArray(cruda) ? (cruda as Record<string, unknown>) : {}
  const de = (nombre: string): unknown => Object.entries(c).find(([n]) => n.toLowerCase() === nombre.toLowerCase())?.[1]
  const filasDeCoberturas = (listaDe(de('Coberturas')) ?? []).filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
  const coberturas: CoberturaEquidad[] = filasDeCoberturas.flatMap((f) => {
    const codigo = campo(f, ['Cobertura', 'CoberturaCodigo', 'Codigo'])
    const descripcion = campo(f, ['CoberturaDesc', 'CoberturaDescripcion', 'Descripcion']) || codigo
    if (!codigo && !descripcion) return []
    return [
      {
        item: campo(f, ['Item']),
        codigo: codigo || descripcion,
        descripcion,
        prima: numeroDeEquidad(campo(f, ['Prima'])) ?? 0,
        bonificacionPorcentaje: numeroDeEquidad(campo(f, ['PorcBonificacion'])),
        bonificacion: numeroDeEquidad(campo(f, ['Bonificacion'])),
        recargoAdministrativoPorcentaje: numeroDeEquidad(campo(f, ['PorcRecargoAdministrativo'])),
        recargoAdministrativo: numeroDeEquidad(campo(f, ['RecargoAdministrativo'])),
        recargoFinanciero: numeroDeEquidad(campo(f, ['RecargoFinanciero'])),
        derechoEmision: numeroDeEquidad(campo(f, ['DerechoEmision'])),
        impuestos: numeroDeEquidad(campo(f, ['Impuestos'])),
        premio: numeroDeEquidad(campo(f, ['Premio'])) ?? 0,
        importeCuota1: numeroDeEquidad(campo(f, ['ImporteCuota1'])),
        importeRestoCuotas: numeroDeEquidad(campo(f, ['ImporteRestoCuotas'])),
        comision: numeroDeEquidad(campo(f, ['Comision'])),
      },
    ]
  })
  const excepciones: ExcepcionEquidad[] = (listaDe(de('Excepciones')) ?? [])
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .flatMap((f) => {
      const detalle = campo(f, ['Detalle', 'Descripcion'])
      return detalle ? [{ item: campo(f, ['Item']), tipo: campo(f, ['Tipo']), motivo: campo(f, ['Motivo']), detalle, estado: campo(f, ['Estado']) }] : []
    })
  const errores = textosDe(de('Errores'), ['Descripcion', 'Mensaje', 'Detalle'])
  return {
    ok: coberturas.length > 0 && errores.length === 0,
    rama: campo(c, ['Rama']),
    solicitud: campo(c, ['Solicitud']),
    instalacion: campo(c, ['Instalacion']),
    descripcionVehiculo: campo(c, ['DescripcionVehiculo']),
    vigenciaDesde: campo(c, ['FechaInicioVigencia']),
    vigenciaHasta: campo(c, ['FechaFinVigencia']),
    sumaAsegurada: numeroDeEquidad(campo(c, ['ValorAseguradoVehic', 'ValorAsegurado', 'SumaAsegurada'])),
    coberturas,
    excepciones,
    errores,
  }
}

export interface CotizacionEquidad extends RespuestaDeCotizacionEquidad {
  /** El cuerpo exacto que se mandó. */
  pedido: Record<string, unknown>
  /** Lo que contestó Equidad, sin tocar. */
  cruda: unknown
}

/**
 * Cotiza. Un rechazo de Equidad (un 400 con su JSON Error, o un 200 con `Errores`) no tira: vuelve con
 * `ok: false` y sus mensajes. Lo que sí tira es lo que no es de la cotización: sin internet, la
 * cuenta rechazada, el servicio que no existe.
 */
export async function cotizarEquidad(cliente: ClienteEquidad, datos: DatosDeCotizacionEquidad): Promise<CotizacionEquidad> {
  const pedido = armarPedidoDeCotizacion(datos)
  let cruda: unknown
  try {
    cruda = await cliente.post('cotizarAutomotor', pedido)
  } catch (error) {
    if (error instanceof ErrorDeEquidad && !error.esDeRed && (error.status === 400 || error.status === 500)) {
      return { ...leerRespuestaDeCotizacion({}), errores: [error.message.replace(/^Equidad (dice que a la cotización le faltan parámetros \(400\)|respondió 500 a la cotización)[: ]*/, '')], pedido, cruda: null }
    }
    throw error
  }
  return { ...leerRespuestaDeCotizacion(cruda), pedido, cruda }
}

/** Recalcula una cotización ya hecha con otros porcentajes de bonificación y recargo administrativo (`CotizarConNuevosPorcentajes`, GET). */
export async function recalcularConPorcentajesEquidad(
  cliente: ClienteEquidad,
  datos: { usuario: string; rama: string; solicitud: string; instalacion: string; recargoAdministrativo: number; bonificacion: number },
): Promise<CotizacionEquidad> {
  const parametros: Array<[string, string | number | boolean]> = [
    ['Usuario', datos.usuario],
    ['Rama', datos.rama],
    ['Solicitud', datos.solicitud],
    ['Instalacion', datos.instalacion],
    ['NuevoPorcRecargoAdministrativo', datos.recargoAdministrativo],
    ['NuevoPorcBonificacion', datos.bonificacion],
  ]
  const cruda = await cliente.get('cotizarConNuevosPorcentajes', parametros)
  return { ...leerRespuestaDeCotizacion(cruda), pedido: Object.fromEntries(parametros), cruda }
}
