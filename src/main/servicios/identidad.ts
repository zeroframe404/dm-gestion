// Las claves de identidad: el nombre con el que las cinco computadoras reconocen al mismo registro.
// Están acá, y no dentro del servicio que las usa, porque todos los que escriben el dato tienen que
// armar exactamente la misma —el alta y la edición de la ficha, la corrección desde la planilla del
// mes— y del otro lado la vuelve a armar el importador cuando lee la hoja. Dos formas distintas de
// calcularla son dos pólizas donde hay una sola.
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
