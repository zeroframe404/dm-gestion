// El ticket en el idioma propio de la ticketeadora: ESC/POS, el protocolo de Epson (EPOS) que hablan
// casi todas las térmicas de 58 y 80 mm (XP-80, POS-80, Epson TM, etc.).
//
// Con esto el programa NO dibuja el ticket: manda texto y órdenes («negrita», «centrar», «cortar») y
// la impresora usa su propia tipografía interna. Se acabaron los problemas de fuente, de escala del
// driver, de márgenes corridos y de letras con huecos que traía imprimir una página gráfica por el
// driver de Windows. Las funciones de este archivo son puras (devuelven bytes): el envío a la
// impresora está en `impresionCruda.ts`.

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

/** Cuántos caracteres entran en una línea con la letra normal (fuente A) según el ancho del papel. */
export function columnasDelPapel(anchoMm: number): number {
  // 80 mm imprimen 72 mm útiles (576 puntos, 48 columnas); se dejan 42 por margen: hay modelos que
  // sólo cubren 512 puntos y cortarían la punta de cada línea. 58 mm → 32.
  return anchoMm >= 70 ? 42 : 32
}

/** Caracteres con acento y signos del castellano en la página de códigos CP858 (la que se elige con ESC t 19). */
const CP858: Record<string, number> = {
  á: 0xa0, é: 0x82, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5, ü: 0x81,
  Á: 0xb5, É: 0x90, Í: 0xd6, Ó: 0xe0, Ú: 0xe9, Ü: 0x9a, '¿': 0xa8, '¡': 0xad,
  '°': 0xf8, 'º': 0xa7, 'ª': 0xa6, '€': 0xd5,
}
const SUSTITUTOS: Record<string, string> = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '•': '*', ' ': ' ' }

/** Texto → bytes en CP858. Lo que la impresora no puede escribir sale como «?», nunca como basura. */
export function codificarTexto(texto: string): number[] {
  const bytes: number[] = []
  for (const original of texto) {
    const caracter = SUSTITUTOS[original] ?? original
    for (const c of caracter) {
      const codigo = c.codePointAt(0) ?? 63
      if (codigo >= 0x20 && codigo < 0x7f) bytes.push(codigo)
      else if (CP858[c] !== undefined) bytes.push(CP858[c] as number)
      else {
        // Una letra acentuada rara (ç, ô…) se cae a su base sin el acento.
        const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '')
        const b = base.codePointAt(0) ?? 63
        bytes.push(base.length === 1 && b >= 0x20 && b < 0x7f ? b : 63)
      }
    }
  }
  return bytes
}

/** Parte un texto en renglones de como mucho `ancho` caracteres, cortando en espacios cuando se puede. */
export function partirEnRenglones(texto: string, ancho: number): string[] {
  const salida: string[] = []
  for (const parrafo of texto.split(/\r?\n/)) {
    let resto = parrafo.trim()
    if (!resto) {
      salida.push('')
      continue
    }
    while (resto.length > ancho) {
      let corte = resto.lastIndexOf(' ', ancho)
      if (corte <= 0) corte = ancho
      salida.push(resto.slice(0, corte).trimEnd())
      resto = resto.slice(corte).trimStart()
    }
    salida.push(resto)
  }
  return salida
}

export type Alineacion = 'izquierda' | 'centro' | 'derecha'

export interface OpcionesDeRenglon {
  alineacion?: Alineacion
  negrita?: boolean
  /** Letra chica (fuente B de la impresora): entran un tercio más de caracteres por línea. */
  chica?: boolean
  /** Letra al doble de alto (y ancho si `ancha`). */
  grande?: boolean
}

/** Armado de un comprobante, renglón por renglón. */
export class TicketEscPos {
  private readonly bytes: number[] = []
  readonly columnas: number

  constructor(anchoMm: number, private readonly negritaGeneral = false) {
    this.columnas = columnasDelPapel(anchoMm)
    // ESC @ reinicia la impresora; ESC t 19 elige CP858 (acentos del castellano).
    this.bytes.push(ESC, 0x40, ESC, 0x74, 19)
    this.bytes.push(ESC, 0x32) // interlineado estándar
  }

  private columnasDe(o: OpcionesDeRenglon): number {
    if (o.grande) return Math.floor(this.columnas / 2)
    if (o.chica) return Math.floor((this.columnas * 4) / 3)
    return this.columnas
  }

  /** Escribe un texto (con saltos de renglón automáticos). */
  texto(contenido: string, opciones: OpcionesDeRenglon = {}): this {
    const alineacion = { izquierda: 0, centro: 1, derecha: 2 }[opciones.alineacion ?? 'izquierda']
    this.bytes.push(ESC, 0x61, alineacion)
    this.bytes.push(ESC, 0x4d, opciones.chica ? 1 : 0)
    this.bytes.push(ESC, 0x45, opciones.negrita || this.negritaGeneral ? 1 : 0)
    this.bytes.push(GS, 0x21, opciones.grande ? 0x11 : 0)
    for (const renglon of partirEnRenglones(contenido, this.columnasDe(opciones))) {
      this.bytes.push(...codificarTexto(renglon), LF)
    }
    // Se vuelve a lo normal: un renglón no hereda el estilo del anterior.
    this.bytes.push(GS, 0x21, 0, ESC, 0x45, 0, ESC, 0x4d, 0, ESC, 0x61, 0)
    return this
  }

  /** Línea de guiones de lado a lado. */
  separador(): this {
    this.bytes.push(ESC, 0x61, 0, ESC, 0x4d, 0)
    this.bytes.push(...codificarTexto('-'.repeat(this.columnas)), LF)
    return this
  }

  espacio(renglones = 1): this {
    this.bytes.push(ESC, 0x64, Math.min(Math.max(renglones, 0), 20))
    return this
  }

  /** Avanza el papel y corta (corte parcial, el que dejan las guillotinas de las térmicas). */
  cortar(): this {
    // GS V 66 n: avanza hasta la posición de corte + n puntos y corta. Antes, unos renglones de aire.
    this.bytes.push(ESC, 0x64, 3, GS, 0x56, 66, 0)
    return this
  }

  aBytes(): Buffer {
    return Buffer.from(this.bytes)
  }
}
