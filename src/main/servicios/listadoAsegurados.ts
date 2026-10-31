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
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { detectarDocumento } from '../../shared/documento'
import {
  TIPOS_DE_DOCUMENTO_FILTRABLES,
  type FilaDeAsegurado,
  type FiltrosDeAsegurados,
  type TipoDeDocumentoFiltrable,
} from '../../shared/listados/asegurados'
import { mismaSucursal, normalizarNombreDeSucursal } from '../../shared/sucursales'
import { db } from '../db/base'
import { limpiar, mismoTexto, normalizarTexto, soloDigitos } from '../importacion/normalizar'

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
  activa: number
}

const LARGO_MAXIMO_DE_BUSQUEDA = 100

function sanearFiltros(crudos: unknown): FiltrosDeAsegurados {
  const origen = typeof crudos === 'object' && crudos !== null ? (crudos as Record<string, unknown>) : {}
  const tiposPedidos = listaDeFiltro(origen.tiposDeDocumento)
  return {
    busqueda: limpiar(typeof origen.busqueda === 'string' ? origen.busqueda : '').slice(0, LARGO_MAXIMO_DE_BUSQUEDA),
    productores: listaDeFiltro(origen.productores),
    sucursales: listaDeFiltro(origen.sucursales),
    tiposDeDocumento: TIPOS_DE_DOCUMENTO_FILTRABLES.filter((tipo) => tiposPedidos.includes(tipo)),
  }
}

/** Productores de cada cliente, y la grafía más usada de cada uno en toda la base (para que el filtro y la tabla digan lo mismo). */
function productoresPorCliente(): Map<number, string[]> {
  const polizas = db()
    .prepare(`SELECT cliente_id, productor, activa FROM polizas WHERE productor IS NOT NULL AND TRIM(productor) <> ''`)
    .all() as PolizaCruda[]

  // «MARCELO» y «Marcelo » son el mismo productor: se agrupa por texto normalizado y se muestra la grafía más repetida.
  const grafias = new Map<string, Map<string, number>>()
  for (const poliza of polizas) {
    const texto = limpiar(poliza.productor)
    const clave = normalizarTexto(texto)
    if (!clave) continue
    const variantes = grafias.get(clave) ?? new Map<string, number>()
    variantes.set(texto, (variantes.get(texto) ?? 0) + 1)
    grafias.set(clave, variantes)
  }
  const nombreDe = new Map<string, string>()
  for (const [clave, variantes] of grafias) {
    const [mejor] = [...variantes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
    nombreDe.set(clave, mejor![0])
  }

  // Por cliente: cuántas pólizas vigentes y cuántas en total tiene con cada productor.
  const cuentas = new Map<number, Map<string, { vigentes: number; total: number }>>()
  for (const poliza of polizas) {
    const clave = normalizarTexto(poliza.productor)
    if (!clave) continue
    const delCliente = cuentas.get(poliza.cliente_id) ?? new Map<string, { vigentes: number; total: number }>()
    const cuenta = delCliente.get(clave) ?? { vigentes: 0, total: 0 }
    cuenta.total++
    if (poliza.activa === 1) cuenta.vigentes++
    delCliente.set(clave, cuenta)
    cuentas.set(poliza.cliente_id, delCliente)
  }

  const resultado = new Map<number, string[]>()
  for (const [clienteId, delCliente] of cuentas) {
    const hayVigentes = [...delCliente.values()].some((cuenta) => cuenta.vigentes > 0)
    const medida = (cuenta: { vigentes: number; total: number }) => (hayVigentes ? cuenta.vigentes : cuenta.total)
    const ordenados = [...delCliente.entries()]
      .filter(([, cuenta]) => medida(cuenta) > 0)
      .map(([clave, cuenta]) => ({ nombre: nombreDe.get(clave) ?? clave, cantidad: medida(cuenta) }))
      .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, 'es'))
    resultado.set(
      clienteId,
      ordenados.map((item) => item.nombre),
    )
  }
  return resultado
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
  const productores = productoresPorCliente()
  const clientes = db()
    .prepare(`SELECT id, nombre, documento, email, telefono, sucursal_texto FROM clientes`)
    .all() as ClienteCrudo[]

  const filas: FilaDeAsegurado[] = []
  for (const cliente of clientes) {
    const detectado = detectarDocumento(cliente.documento)
    const reconocido = detectado.clase !== 'DESCONOCIDO'
    const documentoCrudo = limpiar(cliente.documento)
    const delCliente = productores.get(cliente.id) ?? []
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
    }

    if (filtros.tiposDeDocumento.length > 0 && !filtros.tiposDeDocumento.includes(tipoFiltrable(fila.tipoDocumento))) continue
    if (filtros.sucursales.length > 0 && !coincideAlguno(filtros.sucursales, fila.sucursal, mismaSucursal)) continue
    if (filtros.productores.length > 0 && !fila.productores.some((productor) => coincideAlguno(filtros.productores, productor, mismoTexto))) continue
    if (filtros.busqueda && !coincideBusqueda(filtros.busqueda, indiceDeBusqueda(cliente, fila))) continue
    filas.push(fila)
  }

  filas.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es') || a.clienteId - b.clienteId)
  return filas
}
