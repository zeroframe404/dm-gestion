// La dirección de un cliente, en partes.
//
// Hasta ahora la dirección era un renglón de texto libre y la localidad, otro campo suelto. Con eso
// alcanzaba para imprimirla en un ticket, pero no para buscar por localidad, ni para saber si falta
// el código postal, ni para que dos personas escriban la misma calle igual. Desde acá la dirección
// se carga en partes y el renglón de siempre se ARMA con ellas: lo que ya está cargado sigue
// funcionando y lo que se cargue de ahora en más queda ordenado.
//
// «altura» tiene su propio «no tiene» a propósito: en el conurbano hay direcciones que de verdad no
// tienen número (una casa en un pasaje, un barrio sin nomenclar), y dejar el campo vacío no distingue
// entre «no tiene» y «me falta preguntarlo».

export interface DireccionEstructurada {
  /** La calle principal. Es lo único obligatorio. */
  calle: string
  /** La otra calle de la esquina, o entre qué calles está. Opcional. */
  calle2: string
  /** El número de la puerta. Vacío si `sinAltura` está marcado. */
  altura: string
  /** La dirección no tiene número de puerta: no es lo mismo que no haberlo preguntado. */
  sinAltura: boolean
  provincia: string
  localidad: string
  codigoPostal: string
}

export const DIRECCION_VACIA: DireccionEstructurada = {
  calle: '',
  calle2: '',
  altura: '',
  sinAltura: false,
  provincia: '',
  localidad: '',
  codigoPostal: '',
}

/**
 * Las 24 jurisdicciones del país. La agencia trabaja casi todo en Buenos Aires y CABA, así que esas
 * dos van primero; el resto queda en orden alfabético.
 */
export const PROVINCIAS = [
  'Buenos Aires',
  'Ciudad Autónoma de Buenos Aires',
  'Catamarca',
  'Chaco',
  'Chubut',
  'Córdoba',
  'Corrientes',
  'Entre Ríos',
  'Formosa',
  'Jujuy',
  'La Pampa',
  'La Rioja',
  'Mendoza',
  'Misiones',
  'Neuquén',
  'Río Negro',
  'Salta',
  'San Juan',
  'San Luis',
  'Santa Cruz',
  'Santa Fe',
  'Santiago del Estero',
  'Tierra del Fuego',
  'Tucumán',
] as const

function limpiarParte(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor).replace(/ /g, ' ').trim()
}

/** Deja la dirección en forma canónica venga de donde venga (la pantalla, la base, un JSON viejo). */
export function sanearDireccion(bruto: unknown): DireccionEstructurada {
  const datos = (bruto ?? {}) as Partial<DireccionEstructurada>
  const sinAltura = datos.sinAltura === true
  return {
    calle: limpiarParte(datos.calle),
    calle2: limpiarParte(datos.calle2),
    // Marcar «no tiene» y además dejar un número escrito sería una contradicción guardada.
    altura: sinAltura ? '' : limpiarParte(datos.altura),
    sinAltura,
    provincia: limpiarParte(datos.provincia),
    localidad: limpiarParte(datos.localidad),
    codigoPostal: limpiarParte(datos.codigoPostal),
  }
}

export function direccionEstaVacia(direccion: DireccionEstructurada): boolean {
  return (
    !direccion.calle &&
    !direccion.calle2 &&
    !direccion.altura &&
    !direccion.provincia &&
    !direccion.localidad &&
    !direccion.codigoPostal
  )
}

/**
 * El renglón de siempre: «Mitre 1234, entre Belgrano y San Martín». Es lo que se guarda en la columna
 * `direccion`, lo que sube a la hoja y lo que sale impreso en el ticket, así que no puede cambiar de
 * forma según quién la haya cargado.
 */
export function textoDeDireccion(direccion: DireccionEstructurada): string {
  const saneada = sanearDireccion(direccion)
  const partes: string[] = []
  const calleConAltura = [saneada.calle, saneada.altura].filter(Boolean).join(' ')
  if (calleConAltura) partes.push(saneada.sinAltura && saneada.calle ? `${saneada.calle} s/n` : calleConAltura)
  if (saneada.calle2) partes.push(`esq. ${saneada.calle2}`)
  return partes.join(', ')
}

/** «Lanús, Buenos Aires (B1824)». Va debajo del renglón de la calle en el ticket y en la ficha. */
export function textoDeLocalidad(direccion: DireccionEstructurada): string {
  const saneada = sanearDireccion(direccion)
  const partes = [saneada.localidad, saneada.provincia].filter(Boolean)
  const base = partes.join(', ')
  if (!saneada.codigoPostal) return base
  return base ? `${base} (${saneada.codigoPostal})` : `(${saneada.codigoPostal})`
}

/** Todo junto, en un renglón. Para listados y buscadores. */
export function direccionCompleta(direccion: DireccionEstructurada): string {
  return [textoDeDireccion(direccion), textoDeLocalidad(direccion)].filter(Boolean).join(' · ')
}

/**
 * Lo que falta para que la dirección sirva. No bloquea el alta —un cliente cargado a las apuradas con
 * el nombre y el teléfono vale más que un cliente que no se cargó—, sólo se muestra.
 */
export function faltantesDeDireccion(direccion: DireccionEstructurada): string[] {
  const saneada = sanearDireccion(direccion)
  if (direccionEstaVacia(saneada)) return []
  const faltan: string[] = []
  if (!saneada.calle) faltan.push('la calle')
  if (!saneada.altura && !saneada.sinAltura) faltan.push('la altura (o marcá «no tiene»)')
  if (!saneada.localidad) faltan.push('la localidad')
  if (!saneada.provincia) faltan.push('la provincia')
  return faltan
}
