// Los "servicios de listas de valores para cotizar" del manual de Galeno: todo lo que alimenta un
// desplegable, tanto para cotizar como para emitir. Cada función es un llamado directo — nada se
// cachea acá adentro; quien llama (servicios/galeno.ts) decide si conviene guardar el resultado un
// rato (p. ej. las ramas, que casi no cambian) o pedirlo de nuevo cada vez (p. ej. modelos, que
// dependen de la marca elegida).
import type { CodigoPostalGaleno, OpcionGaleno, SubModeloGaleno } from '../../../shared/tipos'
import type { ClienteGaleno } from './cliente'

/**
 * Las respuestas de estas listas no son todas iguales: la mayoría es un arreglo `[...]` liso, pero
 * varias vienen envueltas en `{ codigo, mensaje, lista: [...] }` (Planes Comerciales, Cuentas
 * Corrientes, Detalle de Producción). Se contemplan las dos formas acá, en un solo lugar.
 */
function aArreglo(cruda: unknown): unknown[] {
  if (Array.isArray(cruda)) return cruda
  if (cruda && typeof cruda === 'object') {
    const lista = (cruda as { lista?: unknown }).lista
    if (Array.isArray(lista)) return lista
    for (const valor of Object.values(cruda as Record<string, unknown>)) {
      if (Array.isArray(valor)) return valor
    }
  }
  return []
}

function comoOpcion(cruda: unknown): OpcionGaleno | null {
  if (!cruda || typeof cruda !== 'object') return null
  const c = cruda as Record<string, unknown>
  const codigo = c.codigo
  const descripcion = c.descripcion
  if ((typeof codigo === 'string' || typeof codigo === 'number') && typeof descripcion === 'string') {
    return { codigo: String(codigo), descripcion }
  }
  return null
}

function aOpciones(cruda: unknown): OpcionGaleno[] {
  return aArreglo(cruda)
    .map(comoOpcion)
    .filter((opcion): opcion is OpcionGaleno => opcion !== null)
}

// --- Ramas y planes comerciales ----------------------------------------------

export async function ramas(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/ramas'))
}

export interface PlanComercialGaleno {
  codPlanComercial: string
  productorCodigo: string
  codRama: string
  descripcionPlanComercial: string | null
}

function comoPlanComercial(cruda: unknown): PlanComercialGaleno | null {
  if (!cruda || typeof cruda !== 'object') return null
  const c = cruda as Record<string, unknown>
  if (typeof c.codPlanComercial !== 'string' || typeof c.productorCodigo !== 'string' || typeof c.codRama !== 'string') return null
  return {
    codPlanComercial: c.codPlanComercial,
    productorCodigo: c.productorCodigo,
    codRama: c.codRama,
    descripcionPlanComercial: typeof c.descripcionPlanComercial === 'string' ? c.descripcionPlanComercial : null,
  }
}

export async function planesComerciales(cliente: ClienteGaleno, rama: number): Promise<PlanComercialGaleno[]> {
  const cruda = await cliente.pedirJson(`/api/administracion/usuario/planes/comerciales?rama=${rama}`)
  return aArreglo(cruda)
    .map(comoPlanComercial)
    .filter((plan): plan is PlanComercialGaleno => plan !== null)
}

export async function planesComercialesPorLegajo(cliente: ClienteGaleno, rama: number, nroLegajo: string): Promise<PlanComercialGaleno[]> {
  const cruda = await cliente.pedirJson(`/api/administracion/usuario/planes/comercialesXRamaLegajo/${rama}/${encodeURIComponent(nroLegajo)}`)
  return aArreglo(cruda)
    .map(comoPlanComercial)
    .filter((plan): plan is PlanComercialGaleno => plan !== null)
}

// --- Catálogo de vehículos (propio de Galeno, no el de InfoAuto) ------------

export async function marcas(cliente: ClienteGaleno, rama: number): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson(`/api/cotizadores/auto/marcas?rama=${rama}`))
}

export async function modelos(cliente: ClienteGaleno, marcaCodigo: string): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson(`/api/cotizadores/auto/modelos/${encodeURIComponent(marcaCodigo)}`))
}

export async function anios(cliente: ClienteGaleno, marcaCodigo: string, modeloCodigo: string): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson(`/api/cotizadores/auto/anios/${encodeURIComponent(marcaCodigo)}/${encodeURIComponent(modeloCodigo)}`))
}

function comoSubModelo(cruda: unknown): SubModeloGaleno | null {
  if (!cruda || typeof cruda !== 'object') return null
  const c = cruda as Record<string, unknown>
  if (typeof c.version !== 'string' || typeof c.codigoMarca !== 'number' || typeof c.codigoModelo !== 'number' || typeof c.codigoSubModelo !== 'number') {
    return null
  }
  return { version: c.version, codigoMarca: c.codigoMarca, codigoModelo: c.codigoModelo, codigoSubModelo: c.codigoSubModelo }
}

export async function subModelos(cliente: ClienteGaleno, marcaCodigo: string, modeloCodigo: string, anio: string): Promise<SubModeloGaleno[]> {
  const ruta = `/api/cotizadores/auto/submodelos/${encodeURIComponent(marcaCodigo)}/${encodeURIComponent(modeloCodigo)}/${encodeURIComponent(anio)}`
  return aArreglo(await cliente.pedirJson(ruta))
    .map(comoSubModelo)
    .filter((s): s is SubModeloGaleno => s !== null)
}

// --- Datos comunes del tomador/asegurado -------------------------------------

export async function tiposDePersona(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/tiposPersona'))
}

function comoCodigoPostal(cruda: unknown): CodigoPostalGaleno | null {
  if (!cruda || typeof cruda !== 'object') return null
  const c = cruda as Record<string, unknown>
  // Los códigos pueden venir como texto o como número (el mismo desajuste que marca/modelo): los dos sirven.
  const esCodigo = (valor: unknown): valor is string | number => typeof valor === 'string' || typeof valor === 'number'
  if (!esCodigo(c.codigoPostal) || !esCodigo(c.subCodigoPostal) || typeof c.localidad !== 'string') return null
  return { codigoRama: String(c.codigoRama ?? ''), codigoPostal: String(c.codigoPostal), subCodigoPostal: String(c.subCodigoPostal), localidad: c.localidad }
}

/** Puede haber más de una localidad para el mismo código postal (distintos `subCodigoPostal`). */
export async function codigoPostal(cliente: ClienteGaleno, rama: number, codigoPostalBuscado: string): Promise<CodigoPostalGaleno[]> {
  const ruta = `/api/cotizadores/comun/codigoPostal/${rama}/${encodeURIComponent(codigoPostalBuscado)}`
  return aArreglo(await cliente.pedirJson(ruta))
    .map(comoCodigoPostal)
    .filter((c): c is CodigoPostalGaleno => c !== null)
}

export async function modosDeFacturacion(cliente: ClienteGaleno, rama: number, planComercial: string): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/modosDeFacturacion', { metodo: 'POST', body: { codigoRama: rama, planComercial } }))
}

export async function condicionesDePago(cliente: ClienteGaleno, rama: number, modoFacturacion: string): Promise<OpcionGaleno[]> {
  return aOpciones(
    await cliente.pedirJson('/api/cotizadores/comun/condicionesDePago', { metodo: 'POST', body: { codigoRama: rama, modoFacturacion } }),
  )
}

export async function formasDePago(cliente: ClienteGaleno, rama: number, modoFacturacion: string, planComercialCodigo: string): Promise<OpcionGaleno[]> {
  return aOpciones(
    await cliente.pedirJson('/api/cotizadores/comun/formasDePago', {
      metodo: 'POST',
      body: { codigoRama: rama, modoFacturacion, planComercialCodigo },
    }),
  )
}

// --- Datos del vehículo -------------------------------------------------------

export async function equipoGnc(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/auto/equipoGnc'))
}

export async function equiposDeRastreo(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/codigosAlarma'))
}

export async function clausulasDeAjuste(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/auto/clausulasDeAjuste'))
}

export async function adicionalesDeGranizo(cliente: ClienteGaleno, rama: number): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/auto/adicionalesGranizo', { metodo: 'POST', body: { codigoRama: rama } }))
}

export async function accesorios(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/auto/accesorios'))
}

export async function coberturasAdicionales(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/auto/coberturasAdicionales'))
}

// --- Impositivo y forma de uso -------------------------------------------------

export async function categoriasIva(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/categoriasIva'))
}

export async function codigosIIBB(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/codigosIIBB'))
}

export async function tiposDeUso(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  const cruda = await cliente.pedirJson<unknown>('/api/cotizadores/comun/tiposDeUso')
  return aArreglo(cruda)
    .map((c) => {
      if (!c || typeof c !== 'object') return null
      const o = c as Record<string, unknown>
      if (typeof o.codigoUsoVehiculo !== 'number' && typeof o.codigoUsoVehiculo !== 'string') return null
      if (typeof o.descripcionUsoVehiculo !== 'string') return null
      return { codigo: String(o.codigoUsoVehiculo), descripcion: o.descripcionUsoVehiculo }
    })
    .filter((o): o is OpcionGaleno => o !== null)
}

// --- Coberturas (catálogo de referencia; el detalle real llega con cada cotización) -----------

export interface CoberturaDeGaleno {
  codigoCobertura: string
  coberturaFantasia: string
  descripcionCoberturaGLM: string
  textoCobertura: string
  franquicia: string | null
  listaAdicionales: string[]
}

function comoCobertura(cruda: unknown): CoberturaDeGaleno | null {
  if (!cruda || typeof cruda !== 'object') return null
  const c = cruda as Record<string, unknown>
  if (typeof c.codigoCobertura !== 'string') return null
  return {
    codigoCobertura: c.codigoCobertura,
    coberturaFantasia: typeof c.coberturaFantasia === 'string' ? c.coberturaFantasia : '',
    descripcionCoberturaGLM: typeof c.descripcionCoberturaGLM === 'string' ? c.descripcionCoberturaGLM : '',
    textoCobertura: typeof c.textoCobertura === 'string' ? c.textoCobertura : '',
    franquicia: typeof c.franquicia === 'string' ? c.franquicia : null,
    listaAdicionales: Array.isArray(c.listaAdicionales) ? c.listaAdicionales.filter((a): a is string => typeof a === 'string') : [],
  }
}

export async function coberturas(cliente: ClienteGaleno, rama: number, anio?: string, codigoCobertura?: string): Promise<CoberturaDeGaleno[]> {
  const body: Record<string, unknown> = { rama }
  if (anio) body.anio = anio
  if (codigoCobertura) body.codigoCobertura = codigoCobertura
  return aArreglo(await cliente.pedirJson('/api/cotizadores/auto/coberturas', { metodo: 'POST', body }))
    .map(comoCobertura)
    .filter((c): c is CoberturaDeGaleno => c !== null)
}

// --- Listas comunes para la emisión --------------------------------------------

export async function tiposDeDocumento(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/comunes/tiposDocumentos'))
}

export async function nacionalidades(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/nacionalidades'))
}

export async function sexos(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/sexos'))
}

export async function estadosCiviles(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/estadosCiviles'))
}

export async function bancos(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/bancos'))
}

export async function tarjetasDeCredito(cliente: ClienteGaleno): Promise<OpcionGaleno[]> {
  return aOpciones(await cliente.pedirJson('/api/cotizadores/comun/tarjetasDeCreditos'))
}
