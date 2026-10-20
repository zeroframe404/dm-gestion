// Las listas de la API de Mercantil Andina: el productor asociado a la cuenta y su catálogo de
// vehículos (marcas → modelos del año → versiones, cada una con su código de InfoAuto).
//
// Las rutas se confirmaron contra el gateway (contesta 401 «falta la suscripción» en las que existen y
// 404 en las que no): `productores/v1/`, `vehiculos/v1/marcas`, `vehiculos/v1/marcas/{marca}/{anio}`,
// `vehiculos/v1/marcas/{marca}/{anio}/{modelo}` y `vehiculos/v1/infoauto/{codigo}`. La FORMA de lo que
// devuelven no se pudo ver sin credenciales: por eso todo se lee con `leerLista`, que entiende las
// variantes de siempre (`codigo`/`id` + `descripcion`/`desc`/`nombre`, sueltas o adentro de `data`),
// y cuando algo no se entiende se dice con qué vino, para corregirlo acá.
import type { ProductorDeMercantil } from '../../../shared/tipos'
import { ErrorDeMercantil, type ClienteMercantil } from './cliente'

export interface OpcionMercantil {
  codigo: string
  descripcion: string
}

/** Una versión del catálogo de Mercantil: lo que identifica al vehículo al cotizar es su código de InfoAuto. */
export interface VersionMercantil extends OpcionMercantil {
  codigoInfoAuto: string
}

function textoSuelto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : ''
}

/** El primer valor no vacío de esas claves, probadas en orden y sin importar mayúsculas. */
export function campo(objeto: Record<string, unknown>, claves: string[]): string {
  const entradas = Object.entries(objeto)
  for (const clave of claves) {
    const buscada = clave.toLowerCase()
    const entrada = entradas.find(([nombre]) => nombre.toLowerCase() === buscada)
    if (!entrada) continue
    const valor = textoSuelto(entrada[1])
    if (valor) return valor
  }
  return ''
}

const CLAVES_DE_LISTA = ['data', 'items', 'resultado', 'resultados', 'lista', 'value', 'marcas', 'modelos', 'versiones', 'vehiculos', 'productores', 'content']

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

export const CLAVES_DE_CODIGO = ['codigo', 'code', 'id', 'valor', 'value', 'key', 'clave']
export const CLAVES_DE_DESCRIPCION = ['descripcion', 'desc', 'nombre', 'name', 'texto', 'label', 'detalle', 'razonSocial']

/**
 * Una lista de opciones (código y descripción) como la da Mercantil, en cualquiera de sus formas:
 * objetos con `codigo` y `descripcion` (o sus sinónimos), o textos sueltos (el texto hace de código).
 * Las filas que no se entienden se saltan; una respuesta sin lista es un error que dice cómo vino.
 */
export function leerLista(respuesta: unknown, que: string, claves: { codigo?: string[]; descripcion?: string[] } = {}): OpcionMercantil[] {
  const lista = listaDe(respuesta)
  if (!lista) {
    const resumen = JSON.stringify(respuesta ?? null).slice(0, 200)
    throw new ErrorDeMercantil(`Mercantil contestó ${que} con un formato inesperado: ${resumen}`, false)
  }
  const deCodigo = [...(claves.codigo ?? []), ...CLAVES_DE_CODIGO]
  const deDescripcion = [...(claves.descripcion ?? []), ...CLAVES_DE_DESCRIPCION]
  return lista.flatMap((fila) => {
    if (typeof fila === 'string' || typeof fila === 'number') {
      const valor = textoSuelto(fila)
      return valor ? [{ codigo: valor, descripcion: valor }] : []
    }
    if (!fila || typeof fila !== 'object') return []
    const f = fila as Record<string, unknown>
    const codigo = campo(f, deCodigo)
    const descripcion = campo(f, deDescripcion) || codigo
    return codigo ? [{ codigo, descripcion }] : []
  })
}

/** Los productores (PAS) de la cuenta: `productores/v1/` devuelve uno o varios; se entienden los dos casos. */
export function leerProductores(respuesta: unknown): ProductorDeMercantil[] {
  const lista = listaDe(respuesta) ?? (respuesta && typeof respuesta === 'object' ? [respuesta] : null)
  if (!lista) throw new ErrorDeMercantil(`Mercantil contestó el productor con un formato inesperado: ${JSON.stringify(respuesta ?? null).slice(0, 200)}`, false)
  return lista.flatMap((fila) => {
    if (!fila || typeof fila !== 'object') return []
    const f = fila as Record<string, unknown>
    // Si viene envuelto («{productor: {…}}»), se mira adentro.
    const adentro = Object.entries(f).find(([nombre, valor]) => /^productor$/i.test(nombre) && valor && typeof valor === 'object' && !Array.isArray(valor))
    const p = adentro ? (adentro[1] as Record<string, unknown>) : f
    const codigo = campo(p, ['cuenta', 'codigo', 'productor', 'codigoProductor', 'pas', 'numero', 'id', 'code'])
    const nombre = campo(p, ['nombre', 'razonSocial', 'descripcion', 'desc', 'name', 'apellido'])
    return codigo ? [{ codigo, nombre: nombre || codigo }] : []
  })
}

export async function productoresMercantil(cliente: ClienteMercantil): Promise<ProductorDeMercantil[]> {
  return leerProductores(await cliente.get('productores/v1/'))
}

export async function marcasMercantil(cliente: ClienteMercantil, anio: string): Promise<OpcionMercantil[]> {
  return leerLista(await cliente.get('vehiculos/v1/marcas', { anio }), 'las marcas')
}

export async function modelosMercantil(cliente: ClienteMercantil, marca: string, anio: string): Promise<OpcionMercantil[]> {
  return leerLista(await cliente.get(`vehiculos/v1/marcas/${encodeURIComponent(marca)}/${encodeURIComponent(anio)}`), `los modelos de la marca ${marca}`)
}

/** Las versiones del modelo en ese año. El código de InfoAuto es lo que después identifica al vehículo al cotizar. */
export async function versionesMercantil(cliente: ClienteMercantil, marca: string, anio: string, modelo: string): Promise<VersionMercantil[]> {
  const respuesta = await cliente.get(`vehiculos/v1/marcas/${encodeURIComponent(marca)}/${encodeURIComponent(anio)}/${encodeURIComponent(modelo)}`)
  const lista = listaDe(respuesta)
  if (!lista) throw new ErrorDeMercantil(`Mercantil contestó las versiones con un formato inesperado: ${JSON.stringify(respuesta ?? null).slice(0, 200)}`, false)
  return lista.flatMap((fila) => {
    if (!fila || typeof fila !== 'object') return []
    const f = fila as Record<string, unknown>
    const codigoInfoAuto = campo(f, ['infoauto', 'codigoInfoauto', 'codigoInfoAuto', 'codia', 'infoAuto', 'codigo', 'code', 'id'])
    const descripcion = campo(f, ['version', 'descripcion', 'desc', 'nombre', 'name', 'modelo', 'texto'])
    return codigoInfoAuto ? [{ codigo: codigoInfoAuto, codigoInfoAuto, descripcion: descripcion || codigoInfoAuto }] : []
  })
}

/** Lo que Mercantil sabe de un código de InfoAuto (su descripción y, si la da, la suma asegurada). Null si no lo tiene. */
export async function vehiculoPorInfoAutoMercantil(cliente: ClienteMercantil, codigo: string): Promise<Record<string, unknown> | null> {
  try {
    const respuesta = await cliente.get(`vehiculos/v1/infoauto/${encodeURIComponent(codigo)}`)
    return respuesta && typeof respuesta === 'object' && !Array.isArray(respuesta) ? (respuesta as Record<string, unknown>) : null
  } catch (error) {
    if (error instanceof ErrorDeMercantil && error.status === 404) return null
    throw error
  }
}
