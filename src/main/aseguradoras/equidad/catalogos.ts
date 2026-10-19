// Las listas de la API GLM de Equidad: lo que la web de productores muestra en cada combo (tipo de
// póliza, productor, IVA, plan comercial, moneda, modo de facturación, forma y condición de pago),
// los códigos postales, y el catálogo de vehículos (marcas → búsqueda por año y descripción →
// variantes), más la suma asegurada por defecto.
//
// Cada función manda los query params en el orden exacto de su .docx (la documentación lo exige) y
// lee la respuesta por los nombres que documenta (`Codigo`/`Descripcion`, `MarcaCodigo`…), con
// tolerancia a mayúsculas y a venir envuelta (`{data: […]}`), que es lo que más cambia entre
// instalaciones de GeneXus. Si algo no se entiende, el error dice con qué vino, para corregirlo acá.
import type { ProductorDeEquidad } from '../../../shared/tipos'
import { campo, ErrorDeEquidad, fechaCompacta, type ClienteEquidad } from './cliente'

export interface OpcionEquidad {
  codigo: string
  descripcion: string
}

/** El contexto fijo de la cuenta que piden casi todas las listas. */
export interface ContextoEquidad {
  /** `UsuCod`: el código de usuario de aplicación que devolvió AutenticarUsuario. */
  usuario: string
  /** `EmpCod`. */
  empresa: string
  /** `RamCod`: la rama de automotores. */
  rama: string
}

const CLAVES_DE_LISTA = ['data', 'items', 'lista', 'resultado', 'resultados', 'sdt', 'value', 'content']

/** La lista adentro de la respuesta: suelta, o bajo alguna de las claves de siempre, o la única lista que haya. */
export function listaDe(respuesta: unknown): unknown[] | null {
  if (Array.isArray(respuesta)) return respuesta
  if (!respuesta || typeof respuesta !== 'object') return null
  const r = respuesta as Record<string, unknown>
  for (const clave of CLAVES_DE_LISTA) {
    const entrada = Object.entries(r).find(([nombre]) => nombre.toLowerCase() === clave)
    if (entrada && Array.isArray(entrada[1])) return entrada[1]
  }
  const listas = Object.values(r).filter((valor) => Array.isArray(valor))
  return listas.length === 1 ? (listas[0] as unknown[]) : null
}

function filas(respuesta: unknown, que: string): Record<string, unknown>[] {
  const lista = listaDe(respuesta)
  if (!lista) throw new ErrorDeEquidad(`Equidad contestó ${que} con un formato inesperado: ${JSON.stringify(respuesta ?? null).slice(0, 200)}`, false)
  return lista.filter((fila): fila is Record<string, unknown> => Boolean(fila) && typeof fila === 'object' && !Array.isArray(fila))
}

/** Una lista de opciones `{Codigo, Descripcion}` como la dan casi todos los «Listar…» de la API GLM. */
export function leerLista(respuesta: unknown, que: string, claves: { codigo?: string[]; descripcion?: string[] } = {}): OpcionEquidad[] {
  const deCodigo = [...(claves.codigo ?? []), 'Codigo', 'Code', 'Id']
  const deDescripcion = [...(claves.descripcion ?? []), 'Descripcion', 'Nombre', 'Desc']
  return filas(respuesta, que).flatMap((f) => {
    const codigo = campo(f, deCodigo)
    const descripcion = campo(f, deDescripcion) || codigo
    return codigo ? [{ codigo, descripcion }] : []
  })
}

export async function tiposDePolizaEquidad(cliente: ClienteEquidad, c: ContextoEquidad): Promise<OpcionEquidad[]> {
  return leerLista(await cliente.get('listarTipoDePoliza', [['UsuCod', c.usuario], ['RamCod', c.rama]]), 'los tipos de póliza')
}

export async function productoresEquidad(cliente: ClienteEquidad, c: ContextoEquidad): Promise<ProductorDeEquidad[]> {
  const lista = leerLista(await cliente.get('listarProductoresDeUsuario', [['EmpCod', c.empresa], ['UsuCod', c.usuario]]), 'los productores', { descripcion: ['Nombre'] })
  return lista.map((p) => ({ codigo: p.codigo, nombre: p.descripcion }))
}

export async function categoriasIvaEquidad(cliente: ClienteEquidad, c: ContextoEquidad, tipoPoliza: string): Promise<OpcionEquidad[]> {
  return leerLista(await cliente.get('listarCategoriaIVA', [['RamCod', c.rama], ['RamTipPolCod', tipoPoliza]]), 'las categorías de IVA')
}

export async function categoriasIbEquidad(cliente: ClienteEquidad): Promise<OpcionEquidad[]> {
  return leerLista(await cliente.get('listarCategoriaIB', []), 'las categorías de ingresos brutos')
}

export async function monedasEquidad(cliente: ClienteEquidad, c: ContextoEquidad): Promise<OpcionEquidad[]> {
  return leerLista(await cliente.get('listarMoneda', [['UsuCod', c.usuario]]), 'las monedas')
}

export async function planesComercialesEquidad(cliente: ClienteEquidad, c: ContextoEquidad, tipoPoliza: string, productor: string, vigenciaDesde: string): Promise<OpcionEquidad[]> {
  return leerLista(
    await cliente.get('listarPlanComercial', [
      ['EmpCod', c.empresa],
      ['UsuCod', c.usuario],
      ['RamCod', c.rama],
      ['RamTipPolCod', tipoPoliza],
      ['ProCod', productor],
      ['VigenciaDesde', fechaCompacta(vigenciaDesde)],
      ['EsFlota', false],
    ]),
    'los planes comerciales',
  )
}

export async function modosDeFacturacionEquidad(
  cliente: ClienteEquidad,
  c: ContextoEquidad,
  datos: { tipoPoliza: string; productor: string; vigenciaDesde: string; planComercial: string; moneda: string },
): Promise<OpcionEquidad[]> {
  return leerLista(
    await cliente.get('listarModoDeFacturacion', [
      ['EmpCod', c.empresa],
      ['UsuCod', c.usuario],
      ['RamCod', c.rama],
      ['RamTipPolCod', datos.tipoPoliza],
      ['ProCod', datos.productor],
      ['VigenciaDesde', fechaCompacta(datos.vigenciaDesde)],
      ['PCCod', datos.planComercial],
      ['MonCod', datos.moneda],
    ]),
    'los modos de facturación',
  )
}

export async function formasDePagoEquidad(cliente: ClienteEquidad, c: ContextoEquidad, datos: { planComercial: string; modoFacturacion: string; moneda: string }): Promise<OpcionEquidad[]> {
  return leerLista(
    await cliente.get('listarFormaDePago', [
      ['UsuCod', c.usuario],
      ['RamCod', c.rama],
      ['PCCod', datos.planComercial],
      ['MFacCod', datos.modoFacturacion],
      ['MonCod', datos.moneda],
    ]),
    'las formas de pago',
  )
}

export interface CondicionDePagoEquidad extends OpcionEquidad {
  porDefecto: boolean
}

export async function condicionesDePagoEquidad(
  cliente: ClienteEquidad,
  c: ContextoEquidad,
  datos: { vigenciaDesde: string; productor: string; planComercial: string; modoFacturacion: string; moneda: string; tipoPoliza: string; formaDePago: string },
): Promise<CondicionDePagoEquidad[]> {
  const respuesta = await cliente.get('listarCondicionDePago', [
    ['EmpCod', c.empresa],
    ['UsuCod', c.usuario],
    ['RamCod', c.rama],
    ['VigenciaDesde', fechaCompacta(datos.vigenciaDesde)],
    ['ProCod', datos.productor],
    ['PCCod', datos.planComercial],
    ['MFacCod', datos.modoFacturacion],
    ['MonCod', datos.moneda],
    ['RamTipPolCod', datos.tipoPoliza],
    ['ForPagCod', datos.formaDePago],
  ])
  return filas(respuesta, 'las condiciones de pago').flatMap((f) => {
    const codigo = campo(f, ['Codigo'])
    if (!codigo) return []
    const porDefecto = Object.entries(f).find(([nombre]) => nombre.toLowerCase() === 'pordefecto')?.[1]
    return [{ codigo, descripcion: campo(f, ['Descripcion']) || codigo, porDefecto: porDefecto === true || porDefecto === 'true' || porDefecto === 'S' }]
  })
}

// --- Código postal -------------------------------------------------------------------------------

export interface LocalidadEquidad {
  codigoPostal: string
  subCodigo: string
  localidad: string
  descripcion: string
  provincia: string
}

/** Las localidades de un código postal (`BuscarCodigoPostal` sólo con `CPCod`). */
export async function localidadesEquidad(cliente: ClienteEquidad, codigoPostal: string): Promise<LocalidadEquidad[]> {
  const respuesta = await cliente.get('buscarCodigoPostal', [['CPCod', codigoPostal], ['CPSub', ''], ['CPLoc', ''], ['PrvCod', '']])
  return filas(respuesta, `el código postal ${codigoPostal}`).flatMap((f) => {
    const cp = campo(f, ['Codigo', 'CodigoPostal', 'CPCod'])
    const subCodigo = campo(f, ['SubCodigo', 'CPSub']) || '0'
    if (!cp) return []
    return [
      {
        codigoPostal: cp,
        subCodigo,
        localidad: campo(f, ['Localidad', 'CPLoc']) || campo(f, ['Descripcion']),
        descripcion: campo(f, ['Descripcion']) || campo(f, ['Localidad']),
        provincia: campo(f, ['ProvinciaDescripcion', 'Provincia']),
      },
    ]
  })
}

// --- Vehículos -----------------------------------------------------------------------------------

export async function marcasEquidad(cliente: ClienteEquidad, c: ContextoEquidad): Promise<OpcionEquidad[]> {
  return leerLista(await cliente.get('listarMarcaDeVehiculo', [['Rama', c.rama], ['EnTransito', false]]), 'las marcas')
}

/** Un vehículo del catálogo de Equidad: marca + modelo + submodelo lo identifican. */
export interface VehiculoEquidad {
  anio: string
  marcaCodigo: string
  marcaDescripcion: string
  modeloCodigo: string
  subModeloCodigo: string
  descripcion: string
}

/** La clave con que el multicotizador recuerda un vehículo de Equidad: `marca:modelo:submodelo`. */
export function claveDeVehiculo(v: Pick<VehiculoEquidad, 'marcaCodigo' | 'modeloCodigo' | 'subModeloCodigo'>): string {
  return `${v.marcaCodigo}:${v.modeloCodigo}:${v.subModeloCodigo}`
}

export function leerVehiculos(respuesta: unknown, que: string): VehiculoEquidad[] {
  return filas(respuesta, que).flatMap((f) => {
    const marcaCodigo = campo(f, ['MarcaCodigo', 'MarCod'])
    const modeloCodigo = campo(f, ['ModeloCodigo', 'ModCod'])
    const subModeloCodigo = campo(f, ['SubModeloCodigo', 'SubModCod']) || '0'
    if (!marcaCodigo || !modeloCodigo) return []
    return [
      {
        anio: campo(f, ['Anio', 'Año']),
        marcaCodigo,
        marcaDescripcion: campo(f, ['MarcaDescripcion', 'Marca']),
        modeloCodigo,
        subModeloCodigo,
        descripcion: campo(f, ['Descripcion', 'VehiculoDescripcion', 'Modelo']),
      },
    ]
  })
}

/**
 * Los vehículos de una marca y un año (`BuscarVehiculos`). `MarCod` 0 = todas las marcas; la
 * descripción se busca con comodines a los dos lados, así que vacía trae todo.
 */
export async function buscarVehiculosEquidad(cliente: ClienteEquidad, c: ContextoEquidad, anio: string, marcaCodigo: string, descripcion = ''): Promise<VehiculoEquidad[]> {
  const respuesta = await cliente.get('buscarVehiculos', [
    ['UsuCod', c.usuario],
    ['RamCod', c.rama],
    ['Anio', anio],
    ['MarCod', marcaCodigo || '0'],
    ['VehiculoDescripcion', descripcion],
  ])
  return leerVehiculos(respuesta, `los vehículos de ${anio}`)
}

/** El vehículo de una patente, o null si Equidad no la tiene (404). */
export async function vehiculoPorPatenteEquidad(cliente: ClienteEquidad, c: ContextoEquidad, patente: string): Promise<VehiculoEquidad | null> {
  try {
    const respuesta = await cliente.get('obtenerVehiculoPorPatente', [['UsuCod', c.usuario], ['RamCod', c.rama], ['Patente', patente]])
    const lista = Array.isArray(respuesta) ? respuesta : [respuesta]
    return leerVehiculos(lista, `la patente ${patente}`)[0] ?? null
  } catch (error) {
    if (error instanceof ErrorDeEquidad && error.status === 404) return null
    throw error
  }
}

/** Una variante (tipo/uso) del vehículo: capítulo + variante RC + variante AIR van en el pedido de cotización. */
export interface VarianteEquidad {
  capitulo: string
  varianteRC: string
  varianteAIR: string
  descripcion: string
}

export function claveDeVariante(v: Pick<VarianteEquidad, 'capitulo' | 'varianteRC' | 'varianteAIR'>): string {
  return `${v.capitulo}:${v.varianteRC}:${v.varianteAIR}`
}

export async function variantesEquidad(cliente: ClienteEquidad, c: ContextoEquidad, vehiculo: Pick<VehiculoEquidad, 'marcaCodigo' | 'modeloCodigo' | 'subModeloCodigo'>): Promise<VarianteEquidad[]> {
  const respuesta = await cliente.get('listarVariantesDeVehiculo', [
    ['UsuCod', c.usuario],
    ['MarcaCodigo', vehiculo.marcaCodigo],
    ['ModeloCodigo', vehiculo.modeloCodigo],
    ['SubModeloCodigo', vehiculo.subModeloCodigo],
  ])
  return filas(respuesta, 'las variantes del vehículo').flatMap((f) => {
    const capitulo = campo(f, ['CapituloCodigo', 'Capitulo'])
    const varianteRC = campo(f, ['VarianteRC'])
    const varianteAIR = campo(f, ['VarianteAIR'])
    if (!capitulo && !varianteRC && !varianteAIR) return []
    return [{ capitulo: capitulo || '0', varianteRC: varianteRC || '0', varianteAIR: varianteAIR || '0', descripcion: campo(f, ['Descripcion']) }]
  })
}

export async function clausulasDeAjusteEquidad(cliente: ClienteEquidad, c: ContextoEquidad, anio: string, ceroKm: boolean): Promise<OpcionEquidad[]> {
  return leerLista(await cliente.get('listarClausulaDeAjuste', [['UsuCod', c.usuario], ['Anio', anio], ['CeroKM', ceroKm ? 'S' : 'N']]), 'las cláusulas de ajuste')
}

export async function alarmasSatelitalesEquidad(cliente: ClienteEquidad, c: ContextoEquidad): Promise<OpcionEquidad[]> {
  return leerLista(await cliente.get('listarAlarmaSatelital', [['UsuCod', c.usuario]]), 'las alarmas satelitales')
}

/** «1234567.89», «1.234.567,89», 1234567.89 → número; null si no es un número. */
export function numeroDeEquidad(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor !== 'string') return null
  const limpio = valor.replace(/[^\d,.-]/g, '')
  if (!limpio) return null
  const ultimaComa = limpio.lastIndexOf(',')
  const ultimoPunto = limpio.lastIndexOf('.')
  let normalizado: string
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    normalizado = ultimaComa > ultimoPunto ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '')
  } else if (ultimaComa >= 0) {
    normalizado = limpio.replace(',', '.')
  } else {
    normalizado = /^\d{1,3}(\.\d{3})+$/.test(limpio) ? limpio.replace(/\./g, '') : limpio
  }
  const numero = Number(normalizado)
  return Number.isFinite(numero) ? numero : null
}

/** La suma asegurada por defecto del vehículo (`ObtenerSumaAseguradaDeVehiculo`), o null si Equidad no la da. */
export async function sumaAseguradaEquidad(
  cliente: ClienteEquidad,
  c: ContextoEquidad,
  datos: { moneda: string; codigoPostal: string; subCodigoPostal: string; productor: string; vehiculo: Pick<VehiculoEquidad, 'marcaCodigo' | 'modeloCodigo' | 'subModeloCodigo'>; anio: string; ceroKm: boolean },
): Promise<number | null> {
  const respuesta = await cliente.post('obtenerSumaAseguradaDeVehiculo', {
    Usuario: c.usuario,
    Rama: Number(c.rama),
    MonedaCodigo: datos.moneda,
    CodigoPostal: datos.codigoPostal,
    SubCodigoPostal: Number(datos.subCodigoPostal) || 0,
    ProductorCodigo: Number(datos.productor) || 0,
    MarcaCodigo: Number(datos.vehiculo.marcaCodigo),
    ModeloCodigo: Number(datos.vehiculo.modeloCodigo),
    SubModeloCodigo: Number(datos.vehiculo.subModeloCodigo) || 0,
    AnioFabricacion: Number(datos.anio),
    CeroKM: datos.ceroKm,
  })
  const r = respuesta && typeof respuesta === 'object' && !Array.isArray(respuesta) ? (respuesta as Record<string, unknown>) : {}
  const valor = numeroDeEquidad(campo(r, ['ValorAsegurado', 'SumaAsegurada']))
  return valor && valor > 0 ? valor : null
}
