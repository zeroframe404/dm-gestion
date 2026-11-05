// Consulta del listado de Asegurados (ver el contrato en shared/listados/index.ts). Es de sólo lectura: nada de
// escribir en la base ni de mandar algo al servidor. Devuelve TODOS los que cumplen el filtro, ordenados por
// nombre; la paginación de a 10 la hace la pantalla.
//
// Qué se decidió, y por qué:
//  - Tipo de documento: se deduce del número con `detectarDocumento` (11 dígitos con prefijo 20/23/24/27 = CUIL,
//    30/33/34 = CUIT, 7-8 dígitos = DNI). No hay columna para eso y no se agrega.
//  - Celular: la ficha tiene un solo teléfono (el celular/WhatsApp), ése se muestra.
//  - Productor: un cliente puede tener pólizas con productores distintos. Se muestran TODOS, separados por coma
//    y con el que más pólizas vigentes tiene primero (empate: orden alfabético). Si no tiene ninguna vigente se
//    cuentan todas sus pólizas, para que una baja no quede sin productor.
//  - Aseguradoras: las de sus pólizas (misma regla que el productor: las vigentes, o todas si es una baja),
//    agrupadas por `claveDeAseguradora`. Cada una dice de dónde salió: «API» si la aseguradora la confirmó
//    por su API (caché de servicios/aseguradorasPorApi.ts, por documento o por número de póliza) y «VPS» si
//    sólo lo dice la cartera. Una que la API confirma y la cartera no tiene también se muestra (con «API»).
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { detectarDocumento } from '../../shared/documento'
import {
  ASEGURADORAS_CON_API,
  claveDeAseguradora,
  FUENTES_DE_ASEGURADORA,
  NOMBRE_DE_ASEGURADORA_CON_API,
  TIPOS_DE_DOCUMENTO_FILTRABLES,
  type AseguradoraConApi,
  type AseguradoraDelAsegurado,
  type FilaDeAsegurado,
  type FiltrosDeAsegurados,
  type TipoDeDocumentoFiltrable,
} from '../../shared/listados/asegurados'
import { mismaSucursal, normalizarNombreDeSucursal } from '../../shared/sucursales'
import { db } from '../db/base'
import { limpiar, mismoTexto, normalizarDocumento, normalizarTexto, soloDigitos } from '../importacion/normalizar'
import { confirmacionesDeApis, polizaComparable, type ConfirmacionesDeApis } from './aseguradorasPorApi'

interface ClienteCrudo {
  id: number
  nombre: string
  documento: string | null
  email: string | null
  telefono: string | null
  sucursal_texto: string | null
}

interface PolizaCruda {
  cliente_id: number
  productor: string | null
  compania: string | null
  numero: string | null
  activa: number
}

const LARGO_MAXIMO_DE_BUSQUEDA = 100

function sanearFiltros(crudos: unknown): FiltrosDeAsegurados {
  const origen = typeof crudos === 'object' && crudos !== null ? (crudos as Record<string, unknown>) : {}
  const tiposPedidos = listaDeFiltro(origen.tiposDeDocumento)
  const fuentesPedidas = listaDeFiltro(origen.fuentes)
  return {
    busqueda: limpiar(typeof origen.busqueda === 'string' ? origen.busqueda : '').slice(0, LARGO_MAXIMO_DE_BUSQUEDA),
    productores: listaDeFiltro(origen.productores),
    sucursales: listaDeFiltro(origen.sucursales),
    tiposDeDocumento: TIPOS_DE_DOCUMENTO_FILTRABLES.filter((tipo) => tiposPedidos.includes(tipo)),
    aseguradoras: listaDeFiltro(origen.aseguradoras),
    fuentes: FUENTES_DE_ASEGURADORA.filter((fuente) => fuentesPedidas.includes(fuente)),
  }
}

/** Un valor de las pólizas de un cliente (productor, compañía) con la grafía más usada en toda la base. */
interface Clasificado {
  clave: string
  nombre: string
}

/**
 * Los valores distintos de un campo de las pólizas de cada cliente, el que más pólizas tiene primero. Se
 * cuentan las vigentes; si el cliente no tiene ninguna vigente (una baja), todas las que tuvo. «MARCELO» y
 * «Marcelo » son el mismo: se agrupa por `claveDe` y se muestra la grafía más repetida de la base.
 */
function clasificarPorCliente(
  polizas: PolizaCruda[],
  valorDe: (poliza: PolizaCruda) => string | null,
  claveDe: (texto: string) => string,
): { porCliente: Map<number, Clasificado[]>; nombreDe: Map<string, string> } {
  const grafias = new Map<string, Map<string, number>>()
  const cuentas = new Map<number, Map<string, { vigentes: number; total: number }>>()
  for (const poliza of polizas) {
    const texto = limpiar(valorDe(poliza))
    const clave = texto ? claveDe(texto) : ''
    if (!clave) continue
    const variantes = grafias.get(clave) ?? new Map<string, number>()
    variantes.set(texto, (variantes.get(texto) ?? 0) + 1)
    grafias.set(clave, variantes)

    const delCliente = cuentas.get(poliza.cliente_id) ?? new Map<string, { vigentes: number; total: number }>()
    const cuenta = delCliente.get(clave) ?? { vigentes: 0, total: 0 }
    cuenta.total++
    if (poliza.activa === 1) cuenta.vigentes++
    delCliente.set(clave, cuenta)
    cuentas.set(poliza.cliente_id, delCliente)
  }
  const nombreDe = new Map<string, string>()
  for (const [clave, variantes] of grafias) {
    const [mejor] = [...variantes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    nombreDe.set(clave, mejor![0])
  }

  const porCliente = new Map<number, Clasificado[]>()
  for (const [clienteId, delCliente] of cuentas) {
    const hayVigentes = [...delCliente.values()].some((cuenta) => cuenta.vigentes > 0)
    const medida = (cuenta: { vigentes: number; total: number }) => (hayVigentes ? cuenta.vigentes : cuenta.total)
    porCliente.set(
      clienteId,
      [...delCliente.entries()]
        .filter(([, cuenta]) => medida(cuenta) > 0)
        .map(([clave, cuenta]) => ({ clave, nombre: nombreDe.get(clave) ?? clave, cantidad: medida(cuenta) }))
        .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'))
        .map(({ clave, nombre }) => ({ clave, nombre })),
    )
  }
  return { porCliente, nombreDe }
}

/** Las pólizas de cada cliente, agrupadas, para sacar los números y contar las vigentes. */
function polizasPorCliente(polizas: PolizaCruda[]): Map<number, PolizaCruda[]> {
  const resultado = new Map<number, PolizaCruda[]>()
  for (const poliza of polizas) {
    const lista = resultado.get(poliza.cliente_id) ?? []
    lista.push(poliza)
    resultado.set(poliza.cliente_id, lista)
  }
  return resultado
}

/** Las aseguradoras del cliente: primero las que confirmó una API, después las que sólo dice la cartera. */
function aseguradorasDelCliente(
  documento: string | null,
  segunLaCartera: Clasificado[],
  polizas: PolizaCruda[],
  confirmaciones: ConfirmacionesDeApis,
  nombreDe: Map<string, string>,
): AseguradoraDelAsegurado[] {
  const porApi = new Set(confirmaciones.porDocumento.get(normalizarDocumento(documento)) ?? [])
  for (const poliza of polizas) {
    const clave = claveDeAseguradora(poliza.compania)
    const numero = polizaComparable(poliza.numero)
    if (clave && numero && confirmaciones.porPoliza.has(`${clave}|${numero}`)) porApi.add(clave)
  }
  const deLaCartera = new Set(segunLaCartera.map((item) => item.clave))
  const soloPorApi = [...porApi]
    .filter((clave) => !deLaCartera.has(clave))
    .map((clave) => ({ clave, nombre: nombreDe.get(clave) ?? NOMBRE_DE_ASEGURADORA_CON_API[clave as AseguradoraConApi] ?? clave }))
  const todas = [...segunLaCartera, ...soloPorApi].map((item) => ({ nombre: item.nombre, fuente: porApi.has(item.clave) ? ('API' as const) : ('VPS' as const) }))
  return [...todas.filter((a) => a.fuente === 'API'), ...todas.filter((a) => a.fuente === 'VPS')]
}

/** El cliente entra si tiene ALGUNA de las aseguradoras elegidas, sacada de alguna de las fuentes elegidas. */
function coincideAseguradora(filtros: FiltrosDeAsegurados, aseguradoras: AseguradoraDelAsegurado[]): boolean {
  if (filtros.aseguradoras.length === 0 && filtros.fuentes.length === 0) return true
  const claves = new Set(filtros.aseguradoras.map(claveDeAseguradora))
  return aseguradoras.some(
    (a) => (claves.size === 0 || claves.has(claveDeAseguradora(a.nombre))) && (filtros.fuentes.length === 0 || filtros.fuentes.includes(a.fuente)),
  )
}

function tipoFiltrable(tipo: string | null): TipoDeDocumentoFiltrable {
  return tipo === 'DNI' || tipo === 'CUIT' || tipo === 'CUIL' ? tipo : 'OTRO'
}

/** Todo lo que se puede buscar de un cliente, ya normalizado, y sus números sueltos (documento y teléfono). */
function indiceDeBusqueda(cliente: ClienteCrudo, fila: FilaDeAsegurado): { texto: string; digitos: string[] } {
  const documentoCrudo = limpiar(cliente.documento)
  return {
    texto: normalizarTexto(`${fila.nombreCompleto} ${documentoCrudo} ${fila.email ?? ''} ${fila.celular ?? ''}`),
    digitos: [soloDigitos(documentoCrudo), soloDigitos(fila.celular)].filter(Boolean),
  }
}

function coincideBusqueda(busqueda: string, indice: { texto: string; digitos: string[] }): boolean {
  const normalizada = normalizarTexto(busqueda)
  if (!normalizada) return true
  // Sólo números («12.345.678», «20-12345678-9», «11 4567-8901»): se compara contra el documento y el teléfono sin puntuación.
  if (!/[A-Z]/.test(normalizada)) {
    const digitos = soloDigitos(busqueda)
    return digitos.length > 0 && indice.digitos.some((numero) => numero.includes(digitos))
  }
  // Con letras: todas las palabras tienen que estar (en cualquier orden), así «perez juan» encuentra «PEREZ JUAN CARLOS».
  return normalizada.split(' ').every((palabra) => indice.texto.includes(palabra))
}

export function listarAsegurados(filtrosCrudos: FiltrosDeAsegurados): FilaDeAsegurado[] {
  const filtros = sanearFiltros(filtrosCrudos)
  const polizas = db()
    .prepare(`SELECT cliente_id, productor, compania, numero, activa FROM polizas`)
    .all() as PolizaCruda[]
  const productores = clasificarPorCliente(polizas, (poliza) => poliza.productor, normalizarTexto).porCliente
  const companias = clasificarPorCliente(polizas, (poliza) => poliza.compania, claveDeAseguradora)
  const polizasDe = polizasPorCliente(polizas)
  const confirmaciones = confirmacionesDeApis()
  // Una aseguradora que sólo conoce la API se muestra con la grafía de la cartera si alguna vez apareció.
  for (const clave of ASEGURADORAS_CON_API) if (!companias.nombreDe.has(clave)) companias.nombreDe.set(clave, NOMBRE_DE_ASEGURADORA_CON_API[clave].toUpperCase())
  const clientes = db()
    .prepare(`SELECT id, nombre, documento, email, telefono, sucursal_texto FROM clientes`)
    .all() as ClienteCrudo[]

  const filas: FilaDeAsegurado[] = []
  for (const cliente of clientes) {
    const detectado = detectarDocumento(cliente.documento)
    const reconocido = detectado.clase !== 'DESCONOCIDO'
    const documentoCrudo = limpiar(cliente.documento)
    const delCliente = (productores.get(cliente.id) ?? []).map((item) => item.nombre)
    const susPolizas = polizasDe.get(cliente.id) ?? []
    const sucursal = limpiar(cliente.sucursal_texto)

    const fila: FilaDeAsegurado = {
      clienteId: cliente.id,
      nombreCompleto: limpiar(cliente.nombre),
      tipoDocumento: reconocido ? detectado.clase : null,
      documento: reconocido ? detectado.formateado : documentoCrudo || null,
      email: limpiar(cliente.email) || null,
      celular: limpiar(cliente.telefono) || null,
      productor: delCliente.length > 0 ? delCliente.join(', ') : null,
      productores: delCliente,
      sucursal: sucursal ? normalizarNombreDeSucursal(sucursal) : null,
      aseguradoras: aseguradorasDelCliente(cliente.documento, companias.porCliente.get(cliente.id) ?? [], susPolizas, confirmaciones, companias.nombreDe),
      polizasVigentes: susPolizas.filter((poliza) => poliza.activa === 1).length,
    }

    if (filtros.tiposDeDocumento.length > 0 && !filtros.tiposDeDocumento.includes(tipoFiltrable(fila.tipoDocumento))) continue
    if (filtros.sucursales.length > 0 && !coincideAlguno(filtros.sucursales, fila.sucursal, mismaSucursal)) continue
    if (filtros.productores.length > 0 && !fila.productores.some((productor) => coincideAlguno(filtros.productores, productor, mismoTexto))) continue
    if (!coincideAseguradora(filtros, fila.aseguradoras)) continue
    if (filtros.busqueda && !coincideBusqueda(filtros.busqueda, indiceDeBusqueda(cliente, fila))) continue
    filas.push(fila)
  }

  filas.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es') || a.clienteId - b.clienteId)
  return filas
}
