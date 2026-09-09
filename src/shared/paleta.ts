// La paleta de presencia (14.0): los doce colores con los que cada persona de la agencia se ve en las
// otras computadoras —el anillo alrededor de la celda que está editando, la burbuja con su foto, el
// borde de su avatar—. Son DOCE y son fijos: el usuario elige uno de acá, no un color cualquiera, y
// el servidor garantiza que no haya dos personas con el mismo (`dmg_perfiles.color` es único). Lo que
// viaja y se guarda es el ÍNDICE, nunca el hexadecimal: si algún día se retoca un tono, cambia acá y
// en todos lados a la vez.
//
// Elegidos para distinguirse entre sí sobre fondo blanco y sobre el tema oscuro, y para que ninguno
// se confunda con los del semáforo de la planilla (verde/amarillo/naranja/rojo de las cuotas): por eso
// no hay un amarillo puro ni un verde semáforo.

export interface ColorDePaleta {
  /** 0..11. Es lo que se guarda. */
  indice: number
  nombre: string
  /** El color del anillo y del fondo del avatar sin foto. */
  hex: string
  /** Color del texto de las iniciales sobre `hex`. */
  texto: '#ffffff' | '#0b1f3b'
}

export const PALETA: readonly ColorDePaleta[] = [
  { indice: 0, nombre: 'Marino', hex: '#235ba8', texto: '#ffffff' },
  { indice: 1, nombre: 'Coral', hex: '#e8593c', texto: '#ffffff' },
  { indice: 2, nombre: 'Esmeralda', hex: '#0f9d76', texto: '#ffffff' },
  { indice: 3, nombre: 'Violeta', hex: '#7c4dff', texto: '#ffffff' },
  { indice: 4, nombre: 'Ámbar', hex: '#e09a1c', texto: '#0b1f3b' },
  { indice: 5, nombre: 'Cielo', hex: '#0ea5e9', texto: '#ffffff' },
  { indice: 6, nombre: 'Fucsia', hex: '#d63384', texto: '#ffffff' },
  { indice: 7, nombre: 'Oliva', hex: '#7a8a1f', texto: '#ffffff' },
  { indice: 8, nombre: 'Turquesa', hex: '#12a5a5', texto: '#ffffff' },
  { indice: 9, nombre: 'Ladrillo', hex: '#a3412a', texto: '#ffffff' },
  { indice: 10, nombre: 'Lavanda', hex: '#9b7bd6', texto: '#ffffff' },
  { indice: 11, nombre: 'Grafito', hex: '#4b5563', texto: '#ffffff' },
]

export const CANTIDAD_DE_COLORES = PALETA.length

export function esIndiceDePaleta(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 && valor < CANTIDAD_DE_COLORES
}

/** El color de un índice; con uno fuera de rango (una versión más nueva con más colores) cae al último. */
export function colorDePaleta(indice: number): ColorDePaleta {
  return PALETA[esIndiceDePaleta(indice) ? indice : CANTIDAD_DE_COLORES - 1]!
}
