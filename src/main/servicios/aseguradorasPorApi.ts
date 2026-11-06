// Con qué aseguradora está cada asegurado, según la PROPIA aseguradora (Cartera → Asegurados).
//
// La cartera de la agencia (el VPS) dice la compañía de cada póliza, pero la escribe una persona y se
// desactualiza. Las aseguradoras que tienen API lo saben de primera mano, así que el listado las usa como
// fuente principal y deja el VPS para lo que ninguna API confirma. Lo que hay hoy en «API Aseguradoras»:
//
//  - Galeno: `POST /api/polizas/vigentes` (manual de Servicios REST, pág. 70) trae TODAS las pólizas vigentes
//    del legajo, con el documento del tomador, en una sola consulta. Pasa por el VPS como el resto de Galeno.
//  - ATM: `GET /api/v1/policiesByDni` (manual, capítulo 10) trae las pólizas de UN documento. Preguntar por
//    los miles de clientes de la cartera sería martillar su API, así que sólo se pregunta por los que la
//    cartera dice que están en ATM: confirma lo del VPS, no descubre clientes nuevos.
//  - Equidad: `VehiculoVigente` (APIGLM) dice si UNA patente tiene póliza vigente y de quién. Igual que ATM:
//    se pregunta por las patentes que la cartera tiene en Equidad.
//  - Mercantil Andina: la integración sólo cotiza; no tiene un servicio de cartera para preguntar.
//
// Lo que contestan queda en una caché de ESTA computadora (migración 40) y nada viaja al VPS: la beta y la
// normal comparten el servidor, y esto es lectura de las APIs, no un cambio en la cartera. Las consultas por
// cliente se reparten: cada pasada pregunta como mucho MAXIMO_POR_PASADA y no vuelve a preguntar por el
// mismo documento o patente antes de VIGENCIA_DE_CONSULTA_MS.
import {
  ASEGURADORAS_CON_API,
  claveDeAseguradora,
  NOMBRE_DE_ASEGURADORA_CON_API,
  type AseguradoraConApi,
  type EstadoDeApiDeAsegurados,
  type EstadoDeApisDeAsegurados,
  type ModoDeConsultaDeApi,
} from '../../shared/listados/asegurados'
import { crearClienteAtm, ErrorDeAtm, type ClienteAtm } from '../aseguradoras/atm/cliente'
import { crearClienteEquidad, ErrorDeEquidad, type ClienteEquidad } from '../aseguradoras/equidad/cliente'
import { esDemo } from '../canal'
import { db } from '../db/base'
import { ahoraIso, limpiar, normalizarDocumento, soloDigitos } from '../importacion/normalizar'
import { credencialesAtm, credencialesEquidad } from './config'
import { cuentaDe as cuentaDeEquidad } from './equidad'
import { reporteGaleno } from './galeno'

/** Galeno trae la cartera entera en una consulta: se vuelve a pedir si lo último tiene más de esto. */
const VIGENCIA_DE_CARTERA_MS = 6 * 60 * 60_000
/** Un documento o una patente ya preguntados no se vuelven a preguntar antes de esto. */
const VIGENCIA_DE_CONSULTA_MS = 24 * 60 * 60_000
/** Tope de consultas por cliente en una pasada (por aseguradora): el resto queda para la siguiente. */
const MAXIMO_POR_PASADA = 300
/** Consultas por cliente en paralelo. */
const EN_PARALELO = 3
/** Fallos seguidos (sin conexión, cuenta rechazada) con los que se corta la pasada de esa aseguradora. */
const FALLOS_PARA_CORTAR = 3

const MODO: Record<AseguradoraConApi, ModoDeConsultaDeApi> = {
  GALENO: 'CARTERA',
  ATM: 'POR_CLIENTE',
  EQUIDAD: 'POR_CLIENTE',
  MERCANTIL: 'SIN_CONSULTA',
}

/** Una póliza vigente según la API. */
interface Confirmacion {
  documento: string
  poliza: string
  nombre: string | null
}

// ---------------------------------------------------------------------------
// Caché local
// ---------------------------------------------------------------------------

/** El número de póliza para comparar: sólo dígitos y sin ceros adelante («0011111» = «11111»). */
export function polizaComparable(valor: unknown): string {
  return soloDigitos(valor).replace(/^0+/, '')
}

function guardarConsulta(aseguradora: AseguradoraConApi, clave: string, confirmaciones: Confirmacion[]): void {
  const base = db()
  const ahora = ahoraIso()
  base.transaction(() => {
    base.prepare('DELETE FROM api_aseguradoras_confirmados WHERE aseguradora = ? AND clave_consulta = ?').run(aseguradora, clave)
    const insertar = base.prepare(
      `INSERT OR REPLACE INTO api_aseguradoras_confirmados (aseguradora, documento, poliza, nombre, clave_consulta, consultado_en)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const c of confirmaciones) {
      if (c.documento || c.poliza) insertar.run(aseguradora, c.documento, c.poliza, c.nombre, clave, ahora)
    }
    base
      .prepare(
        `INSERT OR REPLACE INTO api_aseguradoras_consultas (aseguradora, clave, consultado_en, error, encontrados) VALUES (?, ?, ?, NULL, ?)`,
      )
      .run(aseguradora, clave, ahora, confirmaciones.length)
  })()
}

/** El resumen de la pasada de una aseguradora (clave ''). Un error no borra lo que ya se sabía. */
function anotarPasada(aseguradora: AseguradoraConApi, error: string | null): void {
  const base = db()
  const previa = base
    .prepare(`SELECT consultado_en FROM api_aseguradoras_consultas WHERE aseguradora = ? AND clave = ''`)
    .get(aseguradora) as { consultado_en: string } | undefined
  // Con error se conserva la fecha de la última pasada buena ('' si nunca hubo una: la pantalla dice «nunca»).
  base
    .prepare(`INSERT OR REPLACE INTO api_aseguradoras_consultas (aseguradora, clave, consultado_en, error, encontrados) VALUES (?, '', ?, ?, 0)`)
    .run(aseguradora, error ? (previa?.consultado_en ?? '') : ahoraIso(), error)
}

function consultadasHace(aseguradora: AseguradoraConApi, desde: number): Set<string> {
  const filas = db()
    .prepare(`SELECT clave, consultado_en FROM api_aseguradoras_consultas WHERE aseguradora = ? AND clave <> ''`)
    .all(aseguradora) as Array<{ clave: string; consultado_en: string }>
  return new Set(filas.filter((f) => Date.parse(f.consultado_en) >= desde).map((f) => f.clave))
}

/** Lo que las APIs confirmaron, listo para cruzar con la cartera. */
export interface ConfirmacionesDeApis {
  /** Documento normalizado (DNI de persona, CUIT de empresa) → aseguradoras que lo confirmaron. */
  porDocumento: Map<string, Set<string>>
  /** «ASEGURADORA|póliza comparable» de cada póliza confirmada. */
  porPoliza: Set<string>
}

export function confirmacionesDeApis(): ConfirmacionesDeApis {
  const porDocumento = new Map<string, Set<string>>()
  const porPoliza = new Set<string>()
  let filas: Array<{ aseguradora: string; documento: string; poliza: string }>
  try {
    filas = db().prepare('SELECT aseguradora, documento, poliza FROM api_aseguradoras_confirmados').all() as typeof filas
  } catch {
    return { porDocumento, porPoliza }
  }
  for (const fila of filas) {
    if (fila.documento) {
      const set = porDocumento.get(fila.documento) ?? new Set<string>()
      set.add(fila.aseguradora)
      porDocumento.set(fila.documento, set)
    }
    if (fila.poliza) porPoliza.add(`${fila.aseguradora}|${fila.poliza}`)
  }
  return { porDocumento, porPoliza }
}

// ---------------------------------------------------------------------------
// Qué preguntar (las consultas por cliente)
// ---------------------------------------------------------------------------

interface Candidato {
  /** Lo que se le pregunta a la API: el documento (ATM) o la patente (Equidad). */
  clave: string
  /** El documento del cliente de la cartera, por si la API no lo devuelve. */
  documento: string
}

/** Las pólizas vigentes de la cartera con esa compañía: sus clientes (ATM) o sus patentes (Equidad). */
function candidatosDe(aseguradora: 'ATM' | 'EQUIDAD'): Candidato[] {
  const filas = db()
    .prepare(
      `SELECT p.compania AS compania, c.documento AS documento, v.patente_normalizada AS patente
         FROM polizas p
         JOIN clientes c ON c.id = p.cliente_id
         LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
        WHERE p.activa = 1 AND p.compania IS NOT NULL AND TRIM(p.compania) <> ''`,
    )
    .all() as Array<{ compania: string; documento: string | null; patente: string | null }>
  const vistos = new Map<string, Candidato>()
  for (const fila of filas) {
    if (claveDeAseguradora(fila.compania) !== aseguradora) continue
    const documento = normalizarDocumento(fila.documento)
    const clave = aseguradora === 'ATM' ? documento : limpiar(fila.patente).toUpperCase()
    if (aseguradora === 'ATM' ? clave.length < 6 : clave.length < 5) continue
    if (!vistos.has(clave)) vistos.set(clave, { clave, documento })
  }
  return [...vistos.values()]
}

function pendientesDe(aseguradora: 'ATM' | 'EQUIDAD'): Candidato[] {
  const frescas = consultadasHace(aseguradora, Date.now() - VIGENCIA_DE_CONSULTA_MS)
  return candidatosDe(aseguradora).filter((c) => !frescas.has(c.clave))
}

/** Pregunta por cada candidato, de a EN_PARALELO, y corta si la API falla FALLOS_PARA_CORTAR veces seguidas. */
async function preguntarPorCadaUno(
  aseguradora: 'ATM' | 'EQUIDAD',
  candidatos: Candidato[],
  preguntar: (candidato: Candidato) => Promise<Confirmacion[]>,
): Promise<string | null> {
  let indice = 0
  let fallosSeguidos = 0
  let ultimoError: string | null = null
  let cortar = false
  const trabajador = async () => {
    while (!cortar && indice < candidatos.length) {
      const candidato = candidatos[indice++]!
      try {
        guardarConsulta(aseguradora, candidato.clave, await preguntar(candidato))
        fallosSeguidos = 0
      } catch (error) {
        ultimoError = error instanceof Error ? error.message : String(error)
        if (++fallosSeguidos >= FALLOS_PARA_CORTAR) cortar = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(EN_PARALELO, candidatos.length) }, trabajador))
  return cortar ? ultimoError : null
}

// ---------------------------------------------------------------------------
// Cada API
// ---------------------------------------------------------------------------

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : typeof valor === 'number' ? String(valor) : ''
}

/** Una fecha «dd/mm/aaaa» ya pasada. Si no se entiende, se la da por vigente (la API dijo que lo es). */
function yaVencio(fecha: string, hoy = Date.now()): boolean {
  const partes = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(fecha.trim())
  if (!partes) return false
  const fin = Date.UTC(Number(partes[3]), Number(partes[2]) - 1, Number(partes[1]), 23, 59, 59)
  return Number.isFinite(fin) && fin < hoy
}

/** Las filas de `polizas/vigentes` de Galeno (el reporte conserva todos los campos que vinieron). */
export function confirmacionesDeGaleno(filas: Array<Record<string, string | number | null>>): Confirmacion[] {
  return filas.flatMap((fila) => {
    if (texto(fila.fechaAnulacion)) return []
    const documento = normalizarDocumento(
      texto(fila.numeroDocumentoTomador) || texto(fila.cuitTomador) || texto(fila.nroDocTomador) || texto(fila.cuilTomador),
    )
    const poliza = polizaComparable(fila.poliza ?? fila.nroPoliza)
    if (!documento && !poliza) return []
    return [{ documento, poliza, nombre: texto(fila.tomador) || texto(fila.nombreAsegurado) || null }]
  })
}

async function consultarGaleno(forzar: boolean): Promise<void> {
  const ultima = db()
    .prepare(`SELECT consultado_en FROM api_aseguradoras_consultas WHERE aseguradora = 'GALENO' AND clave = '*'`)
    .get() as { consultado_en: string } | undefined
  if (!forzar && ultima && Date.now() - Date.parse(ultima.consultado_en) < VIGENCIA_DE_CARTERA_MS) return
  try {
    const reporte = await reporteGaleno('POLIZAS_VIGENTES', {})
    guardarConsulta('GALENO', '*', confirmacionesDeGaleno(reporte.filas))
    anotarPasada('GALENO', null)
  } catch (error) {
    anotarPasada('GALENO', error instanceof Error ? error.message : String(error))
  }
}

/** Lo que contesta `policiesByDni` de ATM. Un `error: true` sin pólizas es «ese documento no tiene nada». */
export function confirmacionesDeAtm(respuesta: unknown, documentoPedido: string): Confirmacion[] {
  if (!respuesta || typeof respuesta !== 'object') throw new ErrorDeAtm('ATM contestó las pólizas por DNI con un formato inesperado.', false)
  const r = respuesta as { code?: unknown; response?: unknown }
  const codigo = Number(r.code)
  if (codigo === 401 || codigo === 403) throw new ErrorDeAtm('ATM no aceptó la cuenta para consultar pólizas por DNI.', false, codigo)
  const lista = Array.isArray(r.response) ? r.response : []
  return lista.flatMap((cruda) => {
    if (!cruda || typeof cruda !== 'object') return []
    const p = cruda as Record<string, unknown>
    if (yaVencio(texto(p.VigFin))) return []
    const documento = normalizarDocumento(texto(p.NumDoc) || texto(p.CUIT)) || documentoPedido
    return [{ documento, poliza: polizaComparable(p.Poliza), nombre: texto(p.Asegurado) || null }]
  })
}

async function consultarAtm(): Promise<void> {
  const credenciales = credencialesAtm()
  if (!credenciales) {
    anotarPasada('ATM', 'No hay una cuenta de ATM cargada en esta computadora (API Aseguradoras → ATM).')
    return
  }
  const cliente: ClienteAtm = crearClienteAtm({ ambiente: credenciales.ambiente, usuario: credenciales.usuario, clave: credenciales.clave })
  const candidatos = pendientesDe('ATM').slice(0, MAXIMO_POR_PASADA)
  const error = await preguntarPorCadaUno('ATM', candidatos, async (candidato) =>
    confirmacionesDeAtm(await cliente.get('policiesByDni', { usuario: credenciales.usuario, dni: candidato.clave }), candidato.documento),
  )
  anotarPasada('ATM', error)
}

/** Lo que contesta `VehiculoVigente` de Equidad para una patente. */
export function confirmacionesDeEquidad(respuesta: unknown, documentoDeLaCartera: string): Confirmacion[] {
  const r = (Array.isArray(respuesta) ? respuesta[0] : respuesta) as Record<string, unknown> | undefined
  if (!r || typeof r !== 'object') return []
  const vigente = r.Vigente === true || /^(true|s|si|1)$/i.test(texto(r.Vigente))
  if (!vigente) return []
  const asegurado = (r.Asegurado && typeof r.Asegurado === 'object' ? r.Asegurado : {}) as Record<string, unknown>
  const vehiculo = (r.Vehiculo && typeof r.Vehiculo === 'object' ? r.Vehiculo : {}) as Record<string, unknown>
  if (yaVencio(texto(vehiculo.VigenciaFin))) return []
  const documento = normalizarDocumento(texto(asegurado.DocumentoNumero) || texto(asegurado.CUIT)) || documentoDeLaCartera
  return [{ documento, poliza: polizaComparable(vehiculo.Poliza), nombre: texto(asegurado.Nombre) || null }]
}

async function consultarEquidad(): Promise<void> {
  const credenciales = credencialesEquidad()
  if (!credenciales) {
    anotarPasada('EQUIDAD', 'No hay una cuenta de Equidad cargada en esta computadora (API Aseguradoras → Equidad).')
    return
  }
  const cliente: ClienteEquidad = crearClienteEquidad(cuentaDeEquidad(credenciales))
  const candidatos = pendientesDe('EQUIDAD').slice(0, MAXIMO_POR_PASADA)
  const error = await preguntarPorCadaUno('EQUIDAD', candidatos, async (candidato) => {
    try {
      return confirmacionesDeEquidad(await cliente.post('vehiculoVigente', { Patente: candidato.clave }), candidato.documento)
    } catch (error) {
      // 404: Equidad no tiene esa patente. Es una respuesta («no está»), no un fallo.
      if (error instanceof ErrorDeEquidad && error.status === 404) return []
      throw error
    }
  })
  anotarPasada('EQUIDAD', error)
}

// ---------------------------------------------------------------------------
// Lo que ve la pantalla
// ---------------------------------------------------------------------------

let enCurso: Promise<void> | null = null

export function estadoDeApisDeAsegurados(): EstadoDeApisDeAsegurados {
  const base = db()
  const apis = ASEGURADORAS_CON_API.map((aseguradora): EstadoDeApiDeAsegurados => {
    const modo = MODO[aseguradora]
    const nombre = NOMBRE_DE_ASEGURADORA_CON_API[aseguradora]
    if (modo === 'SIN_CONSULTA') {
      return { aseguradora, nombre, modo, consultadoEn: null, confirmados: 0, error: null, pendientes: 0 }
    }
    const resumen = base
      .prepare(`SELECT consultado_en, error FROM api_aseguradoras_consultas WHERE aseguradora = ? AND clave = ''`)
      .get(aseguradora) as { consultado_en: string; error: string | null } | undefined
    const { cantidad } = base
      .prepare(`SELECT COUNT(DISTINCT documento) AS cantidad FROM api_aseguradoras_confirmados WHERE aseguradora = ? AND documento <> ''`)
      .get(aseguradora) as { cantidad: number }
    const pendientes = aseguradora === 'ATM' || aseguradora === 'EQUIDAD' ? pendientesDe(aseguradora).length : 0
    return {
      aseguradora,
      nombre,
      modo,
      consultadoEn: resumen?.consultado_en || null,
      confirmados: cantidad,
      error: resumen?.error ?? null,
      pendientes,
    }
  })
  return { enCurso: enCurso !== null, apis }
}

/**
 * Una pasada por las APIs. Galeno se vuelve a pedir si lo que hay es viejo (o si `forzar`); ATM y Equidad
 * preguntan por los clientes que todavía no se preguntaron hoy. Dos pedidos a la vez comparten la pasada.
 */
export async function consultarApisDeAsegurados(opciones: { forzar?: boolean } = {}): Promise<EstadoDeApisDeAsegurados> {
  if (esDemo()) return estadoDeApisDeAsegurados()
  if (!enCurso) {
    enCurso = Promise.all([consultarGaleno(Boolean(opciones.forzar)), consultarAtm(), consultarEquidad()])
      .then(() => undefined)
      .catch((error) => console.error('[asegurados] La consulta a las APIs falló:', error))
      .finally(() => {
        enCurso = null
      })
  }
  await enCurso
  return estadoDeApisDeAsegurados()
}
