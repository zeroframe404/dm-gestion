// Las listas de la API v2 de RUS: el catálogo de vehículos (marcas del tipo de unidad → modelos del año
// → versiones, cada una con su número de «modelo de vehículo», que es lo que se manda al cotizar), los
// usos por tipo de unidad y las vigencias por ramo.
//
// Las rutas y las formas salen de los ejemplos de la documentación de Postman de RUS:
// - `vehiculo/marcas?TipoUnidad=1`                                   → `{ listMarcaVehiculo: [{ id, descripcion }] }`
// - `vehiculo/modelos?idMarca&anio&idTipoUnidad`                     → `{ listGrupoModelo: [{ id, descripcion }] }`
// - `vehiculo/versiones?idMarca&anio&idTipoUnidad&idGrupoModelo`     → `{ listUso: [{ id, descripcion, valor, … }] }`
//   (sí, la lista de versiones también se llama `listUso`)
// - `vehiculo/usos?idTipoUnidad`                                     → `{ listUso: [{ id, descripcion }] }`
// - `comunes/vigencias?ramo=4`                                       → `{ object: { listVigencia: [{ id, descripcion, cantidadMeses, porDefecto, … }] } }`
// Los servicios «comunes» vienen envueltos en `object`; los de vehículo, sueltos. Un vehículo que no
// existe vuelve con 200 y `errores.listError`. Todo se lee con `leerOpciones`, que entiende las dos
// formas y, si algo no se entiende, dice con qué vino.
import { ErrorDeRus, erroresDeRus, textoSuelto, type ClienteRus } from './cliente'

export interface OpcionRus {
  codigo: string
  descripcion: string
}

/** Una versión del catálogo de RUS: su `id` es el «modelo de vehículo» que pide la cotización. */
export interface VersionRus extends OpcionRus {
  /** El valor de la tabla de RUS para ese año, si lo dice. */
  valor: number | null
}

export interface VigenciaRus extends OpcionRus {
  /** Cuántos meses dura la póliza. */
  meses: number
  /** Cada cuánto se factura («TRIMESTRAL», «MENSUAL»…), tal como lo dice RUS. */
  facturacion: string
  porDefecto: boolean
}

/** Los tipos de unidad de RUS que el multicotizador usa (ver `vehiculo/tipos-unidades`). */
export const TIPOS_DE_UNIDAD_RUS = {
  AUTO: '1',
  PICKUP_A: '2',
  PICKUP_B: '3',
  MOTO_MENOS_50: '7',
  MOTO_MAS_50: '8',
} as const

/** Las respuestas de los servicios «comunes» vienen envueltas en `object`. */
export function sinEnvoltorio(respuesta: unknown): unknown {
  if (respuesta && typeof respuesta === 'object' && !Array.isArray(respuesta)) {
    const r = respuesta as Record<string, unknown>
    if (r.object && typeof r.object === 'object') return r.object
  }
  return respuesta
}

/** La lista adentro de la respuesta: bajo la clave esperada, o la única lista que haya. */
export function listaDe(respuesta: unknown, clave: string): unknown[] | null {
  const r = sinEnvoltorio(respuesta)
  if (Array.isArray(r)) return r
  if (!r || typeof r !== 'object') return null
  const objeto = r as Record<string, unknown>
  const exacta = Object.entries(objeto).find(([nombre]) => nombre.toLowerCase() === clave.toLowerCase())
  if (exacta && Array.isArray(exacta[1])) return exacta[1]
  const listas = Object.values(objeto).filter((valor) => Array.isArray(valor))
  return listas.length === 1 ? (listas[0] as unknown[]) : null
}

/**
 * Las filas de una lista de RUS (`id` o `codigo`, y `descripcion`). Las que no se entienden se saltan. Si
 * RUS contestó con sus errores (`errores.listError`), tira con el motivo; una respuesta sin lista también,
 * diciendo cómo vino.
 */
export function leerFilas(respuesta: unknown, clave: string, que: string): Array<Record<string, unknown> & OpcionRus> {
  const lista = listaDe(respuesta, clave)
  if (!lista) {
    const errores = erroresDeRus(sinEnvoltorio(respuesta))
    if (errores.length > 0) throw new ErrorDeRus(`RUS no devolvió ${que}: ${errores.join(' · ')}`, false)
    // Sin errores y sin la lista: no hay ninguna (RUS a veces omite la lista vacía).
    if (respuesta && typeof respuesta === 'object' && !Array.isArray(respuesta) && Object.keys(sinEnvoltorio(respuesta) as object).length === 0) return []
    throw new ErrorDeRus(`RUS contestó ${que} con un formato inesperado: ${JSON.stringify(respuesta ?? null).slice(0, 200)}`, false)
  }
  return lista.flatMap((fila) => {
    if (!fila || typeof fila !== 'object') return []
    const f = fila as Record<string, unknown>
    const codigo = textoSuelto(f.id) || textoSuelto(f.codigo)
    const descripcion = textoSuelto(f.descripcion) || codigo
    return codigo ? [{ ...f, codigo, descripcion }] : []
  })
}

export function leerOpciones(respuesta: unknown, clave: string, que: string): OpcionRus[] {
  return leerFilas(respuesta, clave, que).map((f) => ({ codigo: f.codigo, descripcion: f.descripcion }))
}

function numero(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor.replace(',', '.')) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function marcasRus(cliente: ClienteRus, tipoUnidad: string): Promise<OpcionRus[]> {
  return leerOpciones(await cliente.get<unknown>('vehiculo/marcas', { TipoUnidad: tipoUnidad }), 'listMarcaVehiculo', 'las marcas')
}

export async function modelosRus(cliente: ClienteRus, marca: string, anio: string, tipoUnidad: string): Promise<OpcionRus[]> {
  return leerOpciones(await cliente.get<unknown>('vehiculo/modelos', { idMarca: marca, anio, idTipoUnidad: tipoUnidad }), 'listGrupoModelo', 'los modelos')
}

export async function versionesRus(cliente: ClienteRus, marca: string, anio: string, tipoUnidad: string, modelo: string): Promise<VersionRus[]> {
  const respuesta = await cliente.get<unknown>('vehiculo/versiones', { idMarca: marca, anio, idTipoUnidad: tipoUnidad, idGrupoModelo: modelo })
  return leerFilas(respuesta, 'listUso', 'las versiones').map((f) => ({ codigo: f.codigo, descripcion: f.descripcion.replace(/\s+/g, ' '), valor: numero(f.valor) }))
}

export async function usosRus(cliente: ClienteRus, tipoUnidad: string): Promise<OpcionRus[]> {
  return leerOpciones(await cliente.get<unknown>('vehiculo/usos', { idTipoUnidad: tipoUnidad }), 'listUso', 'los usos')
}

export async function vigenciasRus(cliente: ClienteRus, ramo: string): Promise<VigenciaRus[]> {
  const respuesta = await cliente.get<unknown>('comunes/vigencias', { ramo })
  return leerFilas(respuesta, 'listVigencia', 'las vigencias').map((f) => ({
    codigo: f.codigo,
    descripcion: f.descripcion,
    meses: numero(f.cantidadMeses) ?? 0,
    facturacion: textoSuelto(f.descripcionPeriodoFacturacion) || f.descripcion,
    porDefecto: f.porDefecto === true,
  }))
}
