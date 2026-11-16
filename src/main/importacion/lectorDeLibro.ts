// Lector de planillas para el «Alta desde Excel»: un .xlsx o un .csv que trae otra agencia → hojas con
// filas de texto, tal como se ven en Excel. Es PURO (recibe los bytes, no toca disco ni red) y no usa
// librerías: un .xlsx es un .zip (servicios/zip.ts) con unos XML adentro, y de esos XML sólo hacen falta
// cinco cosas (los nombres de las hojas, la tabla de textos, qué estilos son fechas, las celdas y si la
// hoja está oculta).
//
// Lo que devuelve es TEXTO, como lo devolvía Google: el importador ya sabe interpretar fechas, importes
// y documentos escritos. Por eso:
//   - una celda con formato de fecha sale «dd/mm/aaaa» (y la hora sólo si tiene);
//   - un número entero sale sin notación científica (un DNI de 8 cifras sigue siendo ese DNI);
//   - un número con decimales sale con coma decimal y sin separador de miles («1234,5»), que es la
//     única forma que `interpretarNumero` no confunde con miles.
import { ErrorDeNegocio } from '../servicios/errores'
import { archivosDelZip, decodificar } from '../servicios/zip'
import { desescaparXml } from '../aseguradoras/atm/xml'
import { separadorDe } from '../aseguradoras/atm/tablas'

export interface HojaLeida {
  nombre: string
  oculta: boolean
  /** Filas tal cual se ven, sin las celdas vacías del final de cada fila ni las filas vacías del final. */
  filas: string[][]
}

export interface LibroLeido {
  archivo: string
  hojas: HojaLeida[]
}

/** Topes: más que esto no es una cartera, y todo se arma en memoria. */
export const MAXIMO_DE_HOJAS = 60
export const MAXIMO_DE_FILAS = 200_000
export const MAXIMO_DE_COLUMNAS = 200
const MAXIMO_DE_BYTES = 80 * 1024 * 1024

export function leerLibro(bytes: Buffer, archivo: string): LibroLeido {
  if (bytes.length === 0) throw new ErrorDeNegocio('El archivo está vacío.')
  if (bytes.length > MAXIMO_DE_BYTES) throw new ErrorDeNegocio('El archivo es demasiado grande (más de 80 MB).')
  // El .xls de Excel 97-2003 es un «documento compuesto» de Windows (firma D0 CF 11 E0): otro formato entero.
  if (bytes.length >= 4 && bytes.readUInt32BE(0) === 0xd0cf11e0) {
    throw new ErrorDeNegocio(
      'Es un Excel viejo (.xls) o está protegido con contraseña. Abrilo en Excel, sacale la contraseña si tiene, y guardalo como «Libro de Excel (.xlsx)».',
    )
  }
  const hojas = bytes.length >= 4 && bytes.readUInt32LE(0) === 0x04034b50 ? leerXlsx(bytes) : [leerCsv(bytes, archivo)]
  if (hojas.length === 0) throw new ErrorDeNegocio('El archivo no tiene ninguna hoja.')
  return { archivo, hojas }
}

// ---------------------------------------------------------------------------
// .csv
// ---------------------------------------------------------------------------

/** Un .csv entero → filas, respetando los campos entre comillas (que pueden tener saltos de línea). */
export function partirCsv(texto: string, separador: string): string[][] {
  const filas: string[][] = []
  let fila: string[] = []
  let campo = ''
  let entreComillas = false
  let empezado = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]!
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') entreComillas = false
      else campo += c
      continue
    }
    if (c === '"' && campo.trim() === '') {
      entreComillas = true
      campo = ''
      empezado = true
    } else if (c === separador) {
      fila.push(campo.trim())
      campo = ''
      empezado = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++
      fila.push(campo.trim())
      filas.push(fila)
      fila = []
      campo = ''
      empezado = false
    } else {
      campo += c
      empezado = true
    }
  }
  if (empezado || campo !== '') {
    fila.push(campo.trim())
    filas.push(fila)
  }
  return filas
}

function leerCsv(bytes: Buffer, archivo: string): HojaLeida {
  const texto = decodificar(bytes)
  if (texto.includes('\u0000')) throw new ErrorDeNegocio('El archivo no es una planilla: no es un .xlsx ni un .csv.')
  const lineas = texto.split(/\r\n|\r|\n/).filter((linea) => linea.trim() !== '')
  const separador = separadorDe(lineas) ?? (lineas.some((l) => l.includes(';')) ? ';' : ',')
  const filas = partirCsv(texto, separador)
  if (filas.length > MAXIMO_DE_FILAS) throw new ErrorDeNegocio(`El archivo tiene demasiadas filas (${filas.length}).`)
  const nombre = archivo.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Hoja 1'
  return { nombre, oculta: false, filas: recortar(filas.map((f) => f.slice(0, MAXIMO_DE_COLUMNAS))) }
}

// ---------------------------------------------------------------------------
// .xlsx
// ---------------------------------------------------------------------------

/** Atributos de una etiqueta XML («name="X" r:id="rId1"» → {name, 'r:id'}), ya desescapados. */
function atributos(texto: string): Record<string, string> {
  const salida: Record<string, string> = {}
  for (const m of texto.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) salida[m[1]!] = desescaparXml(m[2] ?? m[3] ?? '')
  return salida
}

/** Un atributo sin importar el prefijo del espacio de nombres («r:id» o «id» con otro prefijo). */
function atributo(attrs: Record<string, string>, nombre: string): string | undefined {
  if (attrs[nombre] !== undefined) return attrs[nombre]
  const sufijo = `:${nombre}`
  for (const [clave, valor] of Object.entries(attrs)) if (clave.endsWith(sufijo)) return valor
  return undefined
}

interface Etiqueta {
  attrs: Record<string, string>
  /** Lo de adentro; '' para las que se cierran solas. */
  cuerpo: string
}

/**
 * Todas las etiquetas `nombre` de un XML (con cualquier prefijo: «x:c» también es «c»). Sirve para
 * etiquetas que no se anidan consigo mismas, que son todas las que se leen acá.
 */
function etiquetas(xml: string, nombre: string): Etiqueta[] {
  const patron = new RegExp(`<(?:[\\w.-]+:)?${nombre}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${nombre}\\s*>)`, 'g')
  const salida: Etiqueta[] = []
  for (const m of xml.matchAll(patron)) salida.push({ attrs: atributos(m[1] ?? ''), cuerpo: m[2] ?? '' })
  return salida
}

/** El texto de un `<si>` o un `<is>`: todos sus `<t>` juntos, salvo la guía fonética (`<rPh>`). */
function textoDeCadena(cuerpo: string): string {
  const sinFonetica = cuerpo.replace(/<(?:[\w.-]+:)?rPh\b[\s\S]*?<\/(?:[\w.-]+:)?rPh\s*>/g, '')
  return etiquetas(sinFonetica, 't')
    .map((t) => desescaparTexto(t.cuerpo))
    .join('')
}

/** Desescapa el texto de una celda, incluidos los `_x000D_` con los que Excel guarda caracteres de control. */
function desescaparTexto(texto: string): string {
  return desescaparXml(texto).replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}

/** Índice (base 0) de la columna de una referencia «AB12» → 27. */
export function indiceDeColumna(referencia: string): number {
  const letras = /^([A-Za-z]+)/.exec(referencia)?.[1]?.toUpperCase()
  if (!letras) return -1
  let indice = 0
  for (const letra of letras) indice = indice * 26 + (letra.charCodeAt(0) - 64)
  return indice - 1
}

/** Formatos de fábrica que son fecha (con o sin hora) y los que son sólo hora. */
const FORMATOS_DE_FECHA = new Set([14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58])
const FORMATOS_DE_HORA = new Set([18, 19, 20, 21, 32, 33, 45, 46, 47, 55, 56])

type ClaseDeFormato = 'fecha' | 'hora' | null

/** Qué es un formato propio: «dd/mm/yyyy» es fecha, «hh:mm» hora, «#,##0.00» y «"$" 0» nada. */
export function claseDeFormato(codigo: string): ClaseDeFormato {
  const limpio = codigo
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .toLowerCase()
  if (/general/.test(limpio)) return null
  if (/[dy]/.test(limpio) || /m{3,}/.test(limpio)) return 'fecha'
  if (/[hs]/.test(limpio)) return 'hora'
  return null
}

const DOS = (n: number): string => String(n).padStart(2, '0')

/** Número de serie de Excel → «dd/mm/aaaa» (con «hh:mm» si tiene hora). */
export function fechaDeSerie(serie: number, sistema1904: boolean, clase: 'fecha' | 'hora'): string {
  const dias = Math.floor(serie)
  const fraccion = serie - dias
  const minutosDelDia = Math.round(fraccion * 24 * 60)
  const hora = `${DOS(Math.floor(minutosDelDia / 60) % 24)}:${DOS(minutosDelDia % 60)}`
  if (clase === 'hora') return hora
  // Sistema 1900: el día 1 es el 1/1/1900 y Excel cuenta un 29/2/1900 que no existió (heredado de Lotus):
  // desde el día 61 la cuenta arranca el 30/12/1899.
  const base = sistema1904 ? Date.UTC(1904, 0, 1) : dias >= 61 ? Date.UTC(1899, 11, 30) : Date.UTC(1899, 11, 31)
  const fecha = new Date(base + dias * 86_400_000)
  const texto = `${DOS(fecha.getUTCDate())}/${DOS(fecha.getUTCMonth() + 1)}/${fecha.getUTCFullYear()}`
  return minutosDelDia > 0 ? `${texto} ${hora}` : texto
}

/** Un número de una celda → texto: enteros sin notación científica, decimales con coma y sin miles. */
export function textoDeNumero(valor: string): string {
  const numero = Number(valor)
  if (!Number.isFinite(numero)) return valor.trim()
  if (Number.isInteger(numero)) return Math.abs(numero) < 1e21 ? numero.toFixed(0) : String(numero)
  // 15 cifras significativas sacan el ruido del punto flotante (0.30000000000000004 → 0,3).
  const redondeado = Number(numero.toPrecision(15))
  let texto = String(redondeado)
  if (/e/i.test(texto)) texto = redondeado.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  return texto.replace('.', ',')
}

function resolverRuta(base: string, destino: string): string {
  if (destino.startsWith('/')) return destino.slice(1)
  const partes = base.split('/').filter(Boolean)
  for (const trozo of destino.split('/')) {
    if (trozo === '..') partes.pop()
    else if (trozo !== '.' && trozo !== '') partes.push(trozo)
  }
  return partes.join('/')
}

function leerXlsx(bytes: Buffer): HojaLeida[] {
  let archivos: Map<string, Buffer>
  try {
    archivos = new Map(archivosDelZip(bytes).map((a) => [a.nombre.replace(/\\/g, '/').replace(/^\//, ''), a.bytes]))
  } catch {
    throw new ErrorDeNegocio('El .xlsx está dañado o no se puede abrir. Abrilo en Excel y guardalo de nuevo como .xlsx.')
  }
  const texto = (ruta: string): string | null => {
    const encontrado = archivos.get(ruta) ?? [...archivos].find(([nombre]) => nombre.toLowerCase() === ruta.toLowerCase())?.[1]
    return encontrado ? encontrado.toString('utf8') : null
  }

  // Dónde está el libro: lo dice _rels/.rels; casi siempre es xl/workbook.xml.
  let rutaLibro = 'xl/workbook.xml'
  const relsRaiz = texto('_rels/.rels')
  if (relsRaiz) {
    const principal = etiquetas(relsRaiz, 'Relationship').find((r) => /officeDocument$/.test(r.attrs.Type ?? ''))
    if (principal?.attrs.Target) rutaLibro = resolverRuta('', principal.attrs.Target)
  }
  const libro = texto(rutaLibro)
  if (!libro) {
    if ([...archivos.keys()].some((n) => n.startsWith('word/'))) throw new ErrorDeNegocio('Es un documento de Word, no una planilla de Excel.')
    throw new ErrorDeNegocio('El archivo es un .zip pero no un Excel (.xlsx): no tiene libro adentro.')
  }
  const carpetaLibro = rutaLibro.includes('/') ? rutaLibro.slice(0, rutaLibro.lastIndexOf('/')) : ''
  const nombreLibro = rutaLibro.slice(rutaLibro.lastIndexOf('/') + 1)

  const propiedades = etiquetas(libro, 'workbookPr')[0]?.attrs ?? {}
  const sistema1904 = ['1', 'true'].includes((propiedades.date1904 ?? '').toLowerCase())

  const destinos = new Map<string, string>()
  const relsLibro = texto(`${carpetaLibro ? `${carpetaLibro}/` : ''}_rels/${nombreLibro}.rels`)
  if (relsLibro) {
    for (const r of etiquetas(relsLibro, 'Relationship')) {
      if (r.attrs.Id && r.attrs.Target) destinos.set(r.attrs.Id, resolverRuta(carpetaLibro, r.attrs.Target))
    }
  }
  const rutaDeTipo = (tipo: RegExp, porDefecto: string): string => {
    for (const r of etiquetas(relsLibro ?? '', 'Relationship')) {
      if (tipo.test(r.attrs.Type ?? '') && r.attrs.Target) return resolverRuta(carpetaLibro, r.attrs.Target)
    }
    return resolverRuta(carpetaLibro, porDefecto)
  }

  // Tabla de textos compartidos.
  const compartidos = etiquetas(texto(rutaDeTipo(/sharedStrings$/, 'sharedStrings.xml')) ?? '', 'si').map((si) => textoDeCadena(si.cuerpo))

  // Qué estilo de celda (el «s» de cada celda) es una fecha o una hora.
  const estilos = texto(rutaDeTipo(/styles$/, 'styles.xml')) ?? ''
  const propios = new Map<number, ClaseDeFormato>()
  for (const f of etiquetas(estilos, 'numFmt')) propios.set(Number(f.attrs.numFmtId), claseDeFormato(f.attrs.formatCode ?? ''))
  const xfs = etiquetas(estilos, 'cellXfs')[0]?.cuerpo ?? ''
  const clasePorEstilo: ClaseDeFormato[] = etiquetas(xfs, 'xf').map((xf) => {
    const id = Number(xf.attrs.numFmtId ?? 0)
    if (propios.has(id)) return propios.get(id) ?? null
    if (FORMATOS_DE_FECHA.has(id)) return 'fecha'
    if (FORMATOS_DE_HORA.has(id)) return 'hora'
    return null
  })

  const hojas: HojaLeida[] = []
  const definiciones = etiquetas(etiquetas(libro, 'sheets')[0]?.cuerpo ?? '', 'sheet')
  for (const [indice, definicion] of definiciones.entries()) {
    if (hojas.length >= MAXIMO_DE_HOJAS) break
    const id = atributo(definicion.attrs, 'id')
    const ruta = (id && destinos.get(id)) ?? resolverRuta(carpetaLibro, `worksheets/sheet${indice + 1}.xml`)
    const xml = texto(ruta)
    // Las hojas de gráficos y de macros no tienen celdas: no son datos.
    if (xml === null || !/<(?:[\w.-]+:)?sheetData\b/.test(xml)) continue
    const estado = (definicion.attrs.state ?? '').toLowerCase()
    hojas.push({
      nombre: definicion.attrs.name?.trim() || `Hoja ${indice + 1}`,
      oculta: estado === 'hidden' || estado === 'veryhidden',
      filas: leerCeldas(xml, compartidos, clasePorEstilo, sistema1904),
    })
  }
  return hojas
}

function leerCeldas(xml: string, compartidos: string[], clasePorEstilo: ClaseDeFormato[], sistema1904: boolean): string[][] {
  const filas: string[][] = []
  let siguienteFila = 0
  for (const fila of etiquetas(xml, 'row')) {
    const numero = Number(fila.attrs.r)
    const indiceFila = Number.isInteger(numero) && numero > 0 ? numero - 1 : siguienteFila
    siguienteFila = indiceFila + 1
    if (indiceFila >= MAXIMO_DE_FILAS) {
      throw new ErrorDeNegocio(`Una hoja tiene más de ${MAXIMO_DE_FILAS.toLocaleString('es-AR')} filas: es demasiado para importar de una vez.`)
    }
    const valores: string[] = []
    let siguienteColumna = 0
    for (const celda of etiquetas(fila.cuerpo, 'c')) {
      const referencia = celda.attrs.r
      const columna = referencia ? indiceDeColumna(referencia) : siguienteColumna
      siguienteColumna = columna + 1
      if (columna < 0 || columna >= MAXIMO_DE_COLUMNAS) continue
      const valor = valorDeCelda(celda, compartidos, clasePorEstilo, sistema1904)
      if (valor === '') continue
      while (valores.length < columna) valores.push('')
      valores[columna] = valor
    }
    filas[indiceFila] = valores
  }
  for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = []
  return recortar(filas)
}

function valorDeCelda(celda: Etiqueta, compartidos: string[], clasePorEstilo: ClaseDeFormato[], sistema1904: boolean): string {
  const tipo = celda.attrs.t ?? 'n'
  if (tipo === 'inlineStr') {
    const is = etiquetas(celda.cuerpo, 'is')[0]
    return (is ? textoDeCadena(is.cuerpo) : '').trim()
  }
  const crudo = etiquetas(celda.cuerpo, 'v')[0]?.cuerpo
  if (crudo === undefined) return ''
  const v = desescaparTexto(crudo)
  switch (tipo) {
    case 's':
      return (compartidos[Number(v)] ?? '').trim()
    case 'str':
      return v.trim()
    case 'b':
      return v === '1' ? 'VERDADERO' : 'FALSO'
    case 'e':
      // #N/A, #REF!: no es un dato de la agencia.
      return ''
    case 'd':
      // Fecha ISO (la escriben algunos programas que no son Excel).
      return /^(\d{4})-(\d{2})-(\d{2})/.test(v) ? v.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3/$2/$1') : v.trim()
    default: {
      const estilo = Number(celda.attrs.s ?? 0)
      const clase = clasePorEstilo[estilo] ?? null
      const numero = Number(v)
      if (clase && Number.isFinite(numero) && numero >= 0) return fechaDeSerie(numero, sistema1904, clase)
      return textoDeNumero(v)
    }
  }
}

/** Saca las celdas vacías del final de cada fila y las filas vacías del final. */
function recortar(filas: string[][]): string[][] {
  const salida = filas.map((fila) => {
    const copia = fila.map((v) => v ?? '')
    while (copia.length > 0 && copia[copia.length - 1]!.trim() === '') copia.pop()
    return copia
  })
  while (salida.length > 0 && salida[salida.length - 1]!.length === 0) salida.pop()
  return salida
}
