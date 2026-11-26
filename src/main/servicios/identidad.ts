// Las claves de identidad: el nombre con el que las cinco computadoras reconocen al mismo registro.
// Están acá, y no dentro del servicio que las usa, porque todos los que escriben el dato tienen que
// armar exactamente la misma —el alta y la edición de la ficha, la corrección desde la planilla del
// mes— y del otro lado la vuelve a armar el importador cuando lee la hoja. Dos formas distintas de
// calcularla son dos pólizas donde hay una sola.
import { db } from '../db/base'
import { FRASE_DE_FLOTA } from '../../shared/flotas'
import { ErrorDeNegocio } from './errores'
import { normalizarDocumento, normalizarNumeroPoliza, normalizarPatente, normalizarTexto } from '../importacion/normalizar'

/**
 * La clave con la que el importador reconoce una póliza de un mes al otro (la misma que arma
 * `guardarPoliza` en importador.ts). Se calcula igual acá para que una póliza cargada o corregida en
 * la aplicación y después leída de la hoja sea la misma póliza y no dos.
 */
export function claveDePoliza(compania: string, numero: string, documento: string | null, nombre: string | null, patente: string | null, filaId: string): string {
  const numeroNormalizado = normalizarNumeroPoliza(numero)
  if (numeroNormalizado.length >= 3 && /\d/.test(numeroNormalizado)) {
    return `POL:${normalizarTexto(compania)}|${numeroNormalizado}`
  }
  const patenteNormalizada = normalizarPatente(patente)
  const documentoNormalizado = normalizarDocumento(documento)
  const documentoValido = documentoNormalizado.length >= 6 && documentoNormalizado.length <= 11
  if (documentoValido && patenteNormalizada) return `DOCPAT:${documentoNormalizado}|${patenteNormalizada}`
  const nombreNormalizado = normalizarTexto(nombre)
  if (nombreNormalizado && patenteNormalizada) return `NOMPAT:${nombreNormalizado}|${patenteNormalizada}`
  return `FILA:${filaId}`
}

/**
 * La clave de una póliza que comparte número con otras de la misma flota: la de siempre más la patente
 * del vehículo ('POL:<cía>|<número>|<patente>'). Sin número válido o sin patente no hay forma de
 * distinguirla de las otras, así que devuelve null y el número repetido sigue bloqueado.
 */
export function claveDePolizaDeFlota(compania: string, numero: string, patente: string | null): string | null {
  const numeroNormalizado = normalizarNumeroPoliza(numero)
  const patenteNormalizada = normalizarPatente(patente)
  if (numeroNormalizado.length < 3 || !/\d/.test(numeroNormalizado) || !patenteNormalizada) return null
  return `POL:${normalizarTexto(compania)}|${numeroNormalizado}|${patenteNormalizada}`
}

export interface DatosParaLaClave {
  /** La clave que tiene hoy la póliza (null si es una póliza nueva). */
  claveActual: string | null
  /** El id de la póliza que se está editando (null si es nueva). */
  polizaId: number | null
  clienteId: number
  compania: string
  numero: string
  documento: string | null
  nombre: string | null
  patente: string | null
  filaId: string
  /** El usuario confirmó que es una flota (mismo número en varios vehículos del mismo cliente). */
  confirmadoFlota: boolean
}

/**
 * La clave con la que se guarda la póliza. Es la de siempre, salvo que ya la tenga OTRA póliza:
 *   - si esa otra es del mismo cliente (y la compañía va dentro de la clave, así que es la misma), es
 *     una flota: se pide confirmación y, confirmada, la clave lleva además la patente;
 *   - en cualquier otro caso (otro cliente, o sin patente que la distinga) sigue siendo un error.
 */
export function claveLibreParaLaPoliza(d: DatosParaLaClave): string {
  const base = claveDePoliza(d.compania, d.numero, d.documento, d.nombre, d.patente, d.filaId)
  const deFlota = claveDePolizaDeFlota(d.compania, d.numero, d.patente)
  // Ya era una póliza de flota y no cambió lo que la identifica: sigue como está, sin volver a preguntar.
  if (d.claveActual !== null && deFlota !== null && d.claveActual === deFlota) return deFlota
  if (d.claveActual === base) return base

  const ocupar = db().prepare(
    `SELECT p.cliente_id, v.patente_normalizada AS patente FROM polizas p LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
      WHERE p.clave = ? AND (? IS NULL OR p.id <> ?)`,
  )
  const duena = ocupar.get(base, d.polizaId, d.polizaId) as { cliente_id: number | null; patente: string | null } | undefined
  if (!duena) return base

  const mensaje = base.startsWith('POL:')
    ? `Ya hay otra póliza cargada con el número ${d.numero} en ${d.compania}.`
    : 'Sin número, esta póliza queda con la misma identidad que otra del mismo cliente. Escribí el número que le corresponde.'
  // Misma patente: es la misma póliza cargada dos veces, no una flota.
  const mismaPatente = !!duena.patente && duena.patente === normalizarPatente(d.patente)
  if (!base.startsWith('POL:') || deFlota === null || duena.cliente_id !== d.clienteId || mismaPatente) throw new ErrorDeNegocio(mensaje)
  if (!d.confirmadoFlota) throw new ErrorDeNegocio(`${mensaje} ${FRASE_DE_FLOTA}`)
  if (ocupar.get(deFlota, d.polizaId, d.polizaId)) {
    throw new ErrorDeNegocio(`Ya hay otra póliza cargada con el número ${d.numero} en ${d.compania} para la patente ${d.patente}.`)
  }
  return deFlota
}
