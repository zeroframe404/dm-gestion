// Validaciones de entrada. El renderer no es confiable: todo lo que llega por IPC se revisa acá.
import { ROLES, type Rol } from '../../shared/tipos'
import { ErrorDeNegocio } from './errores'

export function texto(valor: unknown, campo: string, minimo: number, maximo: number): string {
  if (typeof valor !== 'string') throw new ErrorDeNegocio(`${campo} no es válido.`)
  const limpio = valor.trim()
  if (limpio.length < minimo) {
    throw new ErrorDeNegocio(
      minimo === 1 ? `${campo} es obligatorio.` : `${campo} tiene que tener al menos ${minimo} caracteres.`,
    )
  }
  if (limpio.length > maximo) throw new ErrorDeNegocio(`${campo} no puede superar los ${maximo} caracteres.`)
  return limpio
}

export function enteroPositivo(valor: unknown, campo: string): number {
  if (typeof valor !== 'number' || !Number.isInteger(valor) || valor <= 0) {
    throw new ErrorDeNegocio(`${campo} no es válido.`)
  }
  return valor
}

export function booleano(valor: unknown, campo: string): boolean {
  if (typeof valor !== 'boolean') throw new ErrorDeNegocio(`${campo} no es válido.`)
  return valor
}

export function rol(valor: unknown): Rol {
  if (typeof valor !== 'string' || !(ROLES as readonly string[]).includes(valor)) {
    throw new ErrorDeNegocio('El rol no es válido.')
  }
  return valor as Rol
}

export function objeto(valor: unknown, campo = 'Los datos'): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
    throw new ErrorDeNegocio(`${campo} no son válidos.`)
  }
  return valor as Record<string, unknown>
}

const FORMATO_USUARIO = /^[a-z0-9][a-z0-9._-]{2,31}$/

/** Normaliza el nombre de usuario: minúsculas, sin espacios, 3 a 32 caracteres. */
export function nombreDeUsuario(valor: unknown): string {
  const limpio = texto(valor, 'El nombre de usuario', 3, 32).toLowerCase()
  if (!FORMATO_USUARIO.test(limpio)) {
    throw new ErrorDeNegocio(
      'El nombre de usuario sólo puede tener letras minúsculas, números, punto, guion y guion bajo (3 a 32 caracteres).',
    )
  }
  return limpio
}
