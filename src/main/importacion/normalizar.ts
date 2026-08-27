// Limpieza e interpretación de valores de la hoja. Los valores se guardan tal cual están;
// estas funciones sólo sirven para COMPARAR (normalizar) y para derivar columnas auxiliares
// (monto numérico, fecha ISO) que no reemplazan al texto original.
import { randomInt } from 'node:crypto'

/** Quita espacios sobrantes (incluido el espacio duro de Excel, U+00A0). No toca nada más. */
export function limpiar(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor).replace(/ /g, ' ').trim()
}

/**
 * Forma canónica para comparar: mayúsculas, sin tildes ni eñes, sin puntuación, un solo espacio.
 * "Nº PÓLIZA" → "N POLIZA"; "OB. DE COBERTURAS" → "OB DE COBERTURAS"; "AÑO" → "ANO".
 */
export function normalizarTexto(valor: unknown): string {
  return limpiar(valor)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * Dos textos que la agencia lee como el mismo valor: «LANUS», «Lanús» y «lanus » son un solo local.
 * Es la comparación que tiene que usar TODO filtro de sucursal o compañía; con `===` sobre el texto
 * crudo, elegir del desplegable la forma que no escribió la hoja deja el listado vacío sin explicar
 * por qué (ver el comentario de servicios/polizas.ts).
 */
export function mismoTexto(a: unknown, b: unknown): boolean {
  return normalizarTexto(a) === normalizarTexto(b)
}

/**
 * Los valores distintos de una lista, sin repetir por mayúsculas ni tildes y ordenados como se leen.
 * Es lo que alimenta los desplegables: si «LANUS» y «Lanús» quedaran como dos opciones, elegir una
 * escondería las filas de la otra.
 */
export function sinRepetirTexto(valores: Array<string | null | undefined>): string[] {
  const vistos = new Map<string, string>()
  for (const valor of valores) {
    const limpio = limpiar(valor)
    if (!limpio) continue
    const clave = normalizarTexto(limpio)
    if (!vistos.has(clave)) vistos.set(clave, limpio)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

export function soloDigitos(valor: unknown): string {
  return limpiar(valor).replace(/\D+/g, '')
}

/**
 * Documento para unificar clientes. Si parece un CUIT/CUIL de persona física (20/23/24/27 + DNI + dígito)
 * se usa el DNI que lleva adentro, así "20-12345678-3" y "12345678" son la misma persona.
 */
export function normalizarDocumento(valor: unknown): string {
  const digitos = soloDigitos(valor)
  if (digitos.length === 11 && /^(20|23|24|27)/.test(digitos)) return digitos.slice(2, 10).replace(/^0+/, '')
  return digitos.replace(/^0+/, '')
}

/** Textos que la gente escribe en la columna de patente cuando no hay patente. */
const NO_ES_PATENTE = new Set(['SINPATENTE', 'SP', 'SN', 'ND', 'NA', 'NO', 'X', 'XX', 'XXX', '0KM', 'OKM', 'ENTRAMITE', 'TRAMITE', 'APATENTAR', 'PENDIENTE', 'SINDATOS', 'FALTA', 'VER', 'NOTIENE', 'SINCHAPA', 'AD', 'SD', 'SC'])

/**
 * Patente normalizada para comparar (sin espacios ni guiones, en mayúsculas). Devuelve '' si el texto no
 * parece una patente (sin dígitos, muy corta/larga, o un marcador tipo "SIN PATENTE", "0KM", "EN TRAMITE"),
 * así esos vehículos no se funden en uno solo.
 */
/** true si el texto es uno de los marcadores habituales de «no hay patente» («0KM», «SIN PATENTE»). */
export function esMarcadorDeSinPatente(valor: unknown): boolean {
  const compacta = limpiar(valor).toUpperCase().replace(/[^A-Z0-9]+/g, '')
  // Sin letras ni números («---», «--», «//») tampoco es un error de tipeo: es un lugar en blanco.
  return compacta === '' || NO_ES_PATENTE.has(compacta)
}

export function normalizarPatente(valor: unknown): string {
  const compacta = limpiar(valor).toUpperCase().replace(/[^A-Z0-9]+/g, '')
  if (!compacta || NO_ES_PATENTE.has(compacta)) return ''
  if (!/\d/.test(compacta) || !/[A-Z]/.test(compacta)) return ''
  if (compacta.length < 5 || compacta.length > 8) return ''
  return compacta
}

export function normalizarNumeroPoliza(valor: unknown): string {
  return normalizarTexto(valor).replace(/\s+/g, '')
}

/** Índice 0 → "A", 25 → "Z", 26 → "AA", 52 → "BA". */
export function letraColumna(indice: number): string {
  let n = indice + 1
  let letras = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    letras = String.fromCharCode(65 + resto) + letras
    n = Math.floor((n - 1) / 26)
  }
  return letras
}

export function indiceColumna(letras: string): number {
  let n = 0
  for (const letra of letras.toUpperCase()) n = n * 26 + (letra.charCodeAt(0) - 64)
  return n - 1
}

const ALFABETO_ID = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Identificador corto para la columna _ID: 12 caracteres alfanuméricos (~62 bits). */
export function generarId(): string {
  let id = ''
  for (let i = 0; i < 12; i++) id += ALFABETO_ID[randomInt(ALFABETO_ID.length)]
  return id
}

/** Valores que en la columna de cuota significan algo aunque no sean un número. */
const TEXTOS_DE_CUOTA_CONOCIDOS = new Set([
  'A/D',
  'AD',
  'A D',
  '---',
  '--',
  '-',
  'DEBITO',
  'DEBITO AUTOMATICO',
  'DEB',
  'DEB AUT',
  'S/C',
  'SC',
  'SIN CARGO',
  'BONIF',
  'BONIFICADA',
])

export function esTextoDeCuotaConocido(valor: unknown): boolean {
  const texto = limpiar(valor).toUpperCase()
  if (!texto) return true
  return TEXTOS_DE_CUOTA_CONOCIDOS.has(texto) || TEXTOS_DE_CUOTA_CONOCIDOS.has(normalizarTexto(texto))
}

/**
 * Número en formato argentino: "$ 15.300,00" → 15300; "15300,50" → 15300.5; "15.300" → 15300; "15.5" → 15.5.
 * Devuelve null si no es un número.
 */
export function interpretarNumero(valor: unknown): number | null {
  let texto = limpiar(valor)
    .replace(/\s+/g, '')
    .replace(/^(\$|ARS|U\$S|USD)/i, '')
    .replace(/(\$|ARS|USD)$/i, '')
    // Notación contable argentina: "15.300.-", "15.300,-", "15300-"
    .replace(/[.,]?-$/, '')
  if (!texto || !/^[-+]?[\d.,]+$/.test(texto) || !/\d/.test(texto)) return null

  const tieneComa = texto.includes(',')
  const tienePunto = texto.includes('.')
  if (tieneComa && tienePunto) {
    // El último separador es el decimal.
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) texto = texto.replace(/\./g, '').replace(',', '.')
    else texto = texto.replace(/,/g, '')
  } else if (tieneComa) {
    const partes = texto.split(',')
    texto = partes.length > 2 ? partes.join('') : partes.join('.')
  } else if (tienePunto) {
    const partes = texto.split('.')
    // "15.300" o "1.234.567" son miles; "15.5" es decimal.
    if (partes.length > 2 || partes[partes.length - 1]?.length === 3) texto = partes.join('')
  }
  const numero = Number(texto)
  return Number.isFinite(numero) ? numero : null
}

export function interpretarEntero(valor: unknown, minimo: number, maximo: number): number | null {
  const texto = limpiar(valor)
  if (!/^\d{1,4}$/.test(texto)) return null
  const numero = Number(texto)
  return numero >= minimo && numero <= maximo ? numero : null
}

/** Día de vencimiento: "10" → 10; "10/3" → 10; "vence el 15" → 15. */
export function interpretarDiaDeVencimiento(valor: unknown): number | null {
  const texto = limpiar(valor)
  if (!texto) return null
  const directo = interpretarEntero(texto, 1, 31)
  if (directo !== null) return directo
  const coincidencia = texto.match(/(?:^|\D)(\d{1,2})(?:\D|$)/)
  if (!coincidencia) return null
  const dia = Number(coincidencia[1])
  return dia >= 1 && dia <= 31 ? dia : null
}

const AVISO_POSITIVO = new Set(['SI', 'S', 'OK', 'X', 'ENVIADO', 'ENVIADA', 'AVISADO', 'AVISADA', 'WSP', 'WPP', 'WHATSAPP', 'MAIL', 'LISTO', '1', 'TRUE', 'V'])
const AVISO_NEGATIVO = new Set(['NO', 'N', '0', 'FALSE', 'PENDIENTE', 'FALTA'])

/** 1 = avisado, 0 = no, null = no se puede saber (texto libre o vacío). */
export function interpretarAviso(valor: unknown): 0 | 1 | null {
  const crudo = limpiar(valor)
  if (!crudo) return null
  if (/^[✓✔☑√]+$/.test(crudo)) return 1
  if (/^[✗✘×]+$/.test(crudo)) return 0
  // Una fecha en la columna de aviso es la fecha en que se avisó.
  if (/^\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(crudo)) return 1
  const texto = normalizarTexto(crudo)
  if (AVISO_POSITIVO.has(texto)) return 1
  if (AVISO_NEGATIVO.has(texto)) return 0
  if (/^(SI|OK|ENVIADO|AVISADO)\b/.test(texto)) return 1
  // "NO CONTESTA", "NO RESPONDE": se avisó pero no hubo respuesta; no se puede afirmar ni negar.
  return null
}

export interface FechaInterpretada {
  /** 'AAAA-MM-DD' si se pudo armar una fecha válida. */
  iso: string | null
  /** Motivo por el que no es una fecha válida, o null. Vacío o texto sin fecha no es problema. */
  problema: string | null
  /** true si el año venía escrito en el texto; false si se tomó el año por defecto. */
  anioExplicito: boolean
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/**
 * Busca una fecha dentro del texto: "12/03/2026", "12/3", "12-03-26", "pagó 15/3", "2026-03-12".
 * Sin año usa `anioPorDefecto` (el de la planilla). Detecta fechas imposibles (31/02) y fuera de rango.
 */
export function interpretarFecha(valor: unknown, anioPorDefecto: number | null, anioActual = new Date().getFullYear()): FechaInterpretada {
  const texto = limpiar(valor)
  if (!texto) return { iso: null, problema: null, anioExplicito: false }

  let anio: number | null = null
  let anioExplicito = false
  let mes: number
  let dia: number

  const iso = texto.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  const latina = texto.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?(?!\d)/)
  if (iso) {
    anio = Number(iso[1])
    mes = Number(iso[2])
    dia = Number(iso[3])
    anioExplicito = true
  } else if (latina) {
    dia = Number(latina[1])
    mes = Number(latina[2])
    if (latina[3] !== undefined) {
      anio = Number(latina[3])
      if (anio < 100) anio += 2000
      anioExplicito = true
    } else {
      anio = anioPorDefecto
    }
  } else {
    // Texto sin forma de fecha ("DEBITO", "pagó en efectivo"): se conserva, no es un problema.
    return { iso: null, problema: null, anioExplicito: false }
  }

  if (mes < 1 || mes > 12) return { iso: null, problema: `fecha imposible (mes ${mes}): "${texto}"`, anioExplicito }
  if (anio === null) return { iso: null, problema: null, anioExplicito }
  if (dia < 1 || dia > diasDelMes(anio, mes)) return { iso: null, problema: `fecha imposible (día ${dia} del mes ${mes}): "${texto}"`, anioExplicito }
  if (anio < 2000 || anio > anioActual + 1) return { iso: null, problema: `fecha fuera de rango (año ${anio}): "${texto}"`, anioExplicito }

  return { iso: `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`, problema: null, anioExplicito }
}

/**
 * Fecha sin año dentro de una planilla mensual: si el día/mes queda más de dos meses DESPUÉS del período
 * (un pago de "28/12" en la planilla de ENERO), corresponde al año anterior.
 */
export function interpretarFechaDePeriodo(valor: unknown, periodo: string | null, anioActual = new Date().getFullYear()): FechaInterpretada {
  const anio = periodo ? Number(periodo.slice(0, 4)) : null
  const resultado = interpretarFecha(valor, anio, anioActual)
  if (!resultado.iso || resultado.anioExplicito || !periodo || anio === null) return resultado
  const mesPeriodo = Number(periodo.slice(5, 7))
  const mesFecha = Number(resultado.iso.slice(5, 7))
  if (mesFecha - mesPeriodo > 2) return interpretarFecha(valor, anio - 1, anioActual)
  return resultado
}

export function ahoraIso(): string {
  return new Date().toISOString()
}
