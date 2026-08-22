// Reglas de contraseñas y hashing bcrypt.
import { compare, hash } from 'bcryptjs'
import { LARGO_MINIMO_CLAVE } from '../../shared/tipos'
import { ErrorDeNegocio } from './errores'

/** Costo de bcrypt: 10 rondas es un buen equilibrio para una app de escritorio. */
export const COSTO_BCRYPT = 10

/** bcrypt sólo considera los primeros 72 bytes. */
const LARGO_MAXIMO_CLAVE = 72

export function validarClave(clave: unknown, nombreCampo = 'La contraseña'): string {
  if (typeof clave !== 'string') throw new ErrorDeNegocio(`${nombreCampo} no es válida.`)
  if (clave.trim().length === 0) throw new ErrorDeNegocio(`${nombreCampo} no puede estar vacía.`)
  if (clave.length < LARGO_MINIMO_CLAVE) {
    throw new ErrorDeNegocio(`${nombreCampo} tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`)
  }
  if (clave.length > LARGO_MAXIMO_CLAVE) {
    throw new ErrorDeNegocio(`${nombreCampo} no puede superar los ${LARGO_MAXIMO_CLAVE} caracteres.`)
  }
  return clave
}

export function hashearClave(clave: string): Promise<string> {
  return hash(clave, COSTO_BCRYPT)
}

export function verificarClave(clave: string, claveHash: string): Promise<boolean> {
  return compare(clave, claveHash)
}
