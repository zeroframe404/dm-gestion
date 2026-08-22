// Escribir un .xlsx sin librerías: un .xlsx es un ZIP con unos pocos XML adentro, y Node ya trae el
// compresor (zlib) y todo lo demás. Se hace acá para no sumar una dependencia entera —y su cadena de
// dependencias— para lo único que hace falta: volcar filas de texto y números en una planilla que la
// agencia pueda abrir, imprimir y mandarle al contador.
//
// Lo que soporta, que es lo que usan Reportes y la «Planilla clásica»:
//   - varias pestañas, con nombre saneado y único;
//   - una fila de título opcional arriba de todo;
//   - fila de encabezados en negrita, congelada y con filtro;
//   - celdas de texto (cadenas en línea, sin tabla de cadenas compartidas) y celdas numéricas con
//     formato de miles.
//
// Lo que NO soporta a propósito: fórmulas, colores por celda, imágenes, fechas como tipo. Las fechas
// van como texto tal cual están en la hoja de la agencia, que es como las escribe y como las quiere.
import { deflateRawSync } from 'node:zlib'

export type ValorDeCelda = string | number | null

export interface HojaXlsx {
  nombre: string
  /** Fila de título que va arriba de todo. null = la hoja arranca por los encabezados. */
  titulo?: string | null
  /** Fila de encabezados. null = la hoja no tiene (la planilla clásica sí tiene). */
  encabezados: string[] | null
  filas: ValorDeCelda[][]
  /** Ancho de cada columna, en caracteres. Lo que falte usa el ancho por defecto. */
  anchos?: number[]
}

const ANCHO_POR_DEFECTO = 16
const ANCHO_MAXIMO = 60

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const tabla = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[n] = c
  }
  return tabla
})()

function crc32(datos: Buffer): number {
  let c = -1
  for (let i = 0; i < datos.length; i++) c = (c >>> 8) ^ TABLA_CRC[(c ^ datos[i]!) & 0xff]!
  return (c ^ -1) >>> 0
}

interface EntradaZip {
  nombre: string
  datos: Buffer
}

/** Fecha y hora en el formato MS-DOS que usan las cabeceras del ZIP. */
function fechaDos(fecha: Date): { dia: number; hora: number } {
  const anio = Math.max(1980, fecha.getFullYear())
  return {
    dia: ((anio - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate(),
    hora: (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2),
  }
}

function armarZip(entradas: EntradaZip[], fecha: Date): Buffer {
  const { dia, hora } = fechaDos(fecha)
  const partes: Buffer[] = []
  const central: Buffer[] = []
  let desplazamiento = 0

  for (const entrada of entradas) {
    const nombre = Buffer.from(entrada.nombre, 'utf8')
    const crudo = entrada.datos
    const comprimido = deflateRawSync(crudo, { level: 9 })
    // Si comprimir no achica (archivos diminutos), se guarda tal cual: es válido y más rápido de abrir.
    const usarDeflate = comprimido.length < crudo.length
    const cuerpo = usarDeflate ? comprimido : crudo
    const metodo = usarDeflate ? 8 : 0
    const suma = crc32(crudo)

    const cabecera = Buffer.alloc(30)
    cabecera.writeUInt32LE(0x04034b50, 0)
    cabecera.writeUInt16LE(20, 4)
    // Bandera 0x0800: el nombre del archivo está en UTF-8.
    cabecera.writeUInt16LE(0x0800, 6)
    cabecera.writeUInt16LE(metodo, 8)
    cabecera.writeUInt16LE(hora, 10)
    cabecera.writeUInt16LE(dia, 12)
    cabecera.writeUInt32LE(suma, 14)
    cabecera.writeUInt32LE(cuerpo.length, 18)
    cabecera.writeUInt32LE(crudo.length, 22)
    cabecera.writeUInt16LE(nombre.length, 26)
    cabecera.writeUInt16LE(0, 28)
    partes.push(cabecera, nombre, cuerpo)

    const ficha = Buffer.alloc(46)
    ficha.writeUInt32LE(0x02014b50, 0)
    ficha.writeUInt16LE(20, 4)
    ficha.writeUInt16LE(20, 6)
    ficha.writeUInt16LE(0x0800, 8)
    ficha.writeUInt16LE(metodo, 10)
    ficha.writeUInt16LE(hora, 12)
    ficha.writeUInt16LE(dia, 14)
    ficha.writeUInt32LE(suma, 16)
    ficha.writeUInt32LE(cuerpo.length, 20)
    ficha.writeUInt32LE(crudo.length, 24)
    ficha.writeUInt16LE(nombre.length, 28)
    ficha.writeUInt32LE(desplazamiento, 42)
    central.push(ficha, nombre)

    desplazamiento += cabecera.length + nombre.length + cuerpo.length
  }

  const directorio = Buffer.concat(central)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(entradas.length, 8)
  fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(directorio.length, 12)
  fin.writeUInt32LE(desplazamiento, 16)
  return Buffer.concat([...partes, directorio, fin])
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

/** Escapa lo que va adentro de un nodo XML y saca los caracteres de control, que rompen Excel. */
export function escaparXml(valor: string): string {
  return valor
    // Los caracteres de control no son XML válido: Excel se niega a abrir el archivo entero por uno.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 0 → A, 25 → Z, 26 → AA, 31 → AF. */
export function letraDeColumna(indice: number): string {
  let n = indice + 1
  let letra = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    letra = String.fromCharCode(65 + resto) + letra
    n = Math.floor((n - resto) / 26)
  }
  return letra
}

/**
 * Nombre de pestaña que Excel acepta: hasta 31 caracteres, sin : \ / ? * [ ], sin apóstrofo al
 * principio ni al final, y único dentro del archivo.
 */
function nombreDePestana(bruto: string, usados: Set<string>): string {
  let nombre = (bruto || 'Hoja').replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Hoja'
  if (usados.has(nombre.toLowerCase())) {
    for (let n = 2; ; n++) {
      const sufijo = ` (${n})`
      const candidato = nombre.slice(0, 31 - sufijo.length) + sufijo
      if (!usados.has(candidato.toLowerCase())) {
        nombre = candidato
        break
      }
    }
  }
  usados.add(nombre.toLowerCase())
  return nombre
}

/** Estilos: 0 normal, 1 encabezado, 2 número con dos decimales, 3 entero, 4 título. */
const ESTILO_NORMAL = 0
const ESTILO_ENCABEZADO = 1
const ESTILO_NUMERO = 2
const ESTILO_TITULO = 4

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF0F2C4C"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function celda(referencia: string, valor: ValorDeCelda, estilo: number): string {
  if (valor === null || valor === undefined || valor === '') {
    return estilo === ESTILO_NORMAL ? '' : `<c r="${referencia}" s="${estilo}"/>`
  }
  const atributoEstilo = estilo === ESTILO_NORMAL ? '' : ` s="${estilo}"`
  if (typeof valor === 'number') {
    // Un número que no es finito no puede ir como número: iría como #NUM! y nadie sabría por qué.
    if (!Number.isFinite(valor)) return `<c r="${referencia}"${atributoEstilo} t="inlineStr"><is><t>${escaparXml(String(valor))}</t></is></c>`
    return `<c r="${referencia}"${atributoEstilo}><v>${valor}</v></c>`
  }
  // `xml:space="preserve"` conserva los espacios del principio y del final, que en los nombres y las
  // observaciones de la hoja aparecen todo el tiempo.
  return `<c r="${referencia}"${atributoEstilo} t="inlineStr"><is><t xml:space="preserve">${escaparXml(valor)}</t></is></c>`
}

function fila(numero: number, valores: ValorDeCelda[], estilo: number): string {
  const celdas = valores
    .map((valor, columna) => celda(`${letraDeColumna(columna)}${numero}`, valor, typeof valor === 'number' && estilo === ESTILO_NORMAL ? ESTILO_NUMERO : estilo))
    .join('')
  return `<row r="${numero}">${celdas}</row>`
}

function xmlDeHoja(hoja: HojaXlsx): string {
  const columnas = Math.max(
    hoja.encabezados?.length ?? 0,
    ...hoja.filas.map((f) => f.length),
    1,
  )
  const anchos: string[] = []
  for (let i = 0; i < columnas; i++) {
    const ancho = Math.min(hoja.anchos?.[i] ?? ANCHO_POR_DEFECTO, ANCHO_MAXIMO)
    anchos.push(`<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`)
  }

  const partes: string[] = []
  let numero = 1
  if (hoja.titulo) {
    partes.push(fila(numero, [hoja.titulo], ESTILO_TITULO))
    numero++
  }
  const filaDelEncabezado = hoja.encabezados ? numero : 0
  if (hoja.encabezados) {
    partes.push(fila(numero, hoja.encabezados, ESTILO_ENCABEZADO))
    numero++
  }
  for (const valores of hoja.filas) {
    partes.push(fila(numero, valores, ESTILO_NORMAL))
    numero++
  }

  const ultimaFila = Math.max(numero - 1, 1)
  const dimension = `A1:${letraDeColumna(columnas - 1)}${ultimaFila}`
  // Se congela lo que está arriba de los datos: el título y el encabezado quedan siempre a la vista.
  const congeladas = (hoja.titulo ? 1 : 0) + (hoja.encabezados ? 1 : 0)
  const vista = congeladas
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${congeladas}" topLeftCell="A${congeladas + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  const filtro =
    filaDelEncabezado > 0 && hoja.filas.length > 0
      ? `<autoFilter ref="A${filaDelEncabezado}:${letraDeColumna(columnas - 1)}${ultimaFila}"/>`
      : ''

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/>${vista}<sheetFormatPr defaultRowHeight="15"/><cols>${anchos.join('')}</cols><sheetData>${partes.join('')}</sheetData>${filtro}</worksheet>`
}

/**
 * Arma el archivo entero. `fecha` es sólo la que queda estampada adentro del ZIP; se puede fijar para
 * que dos corridas iguales den el mismo archivo, que es lo que hacen las pruebas.
 */
export function construirXlsx(hojas: HojaXlsx[], fecha = new Date()): Buffer {
  if (hojas.length === 0) throw new Error('Un archivo de Excel necesita al menos una pestaña.')
  const usados = new Set<string>()
  const nombres = hojas.map((hoja) => nombreDePestana(hoja.nombre, usados))

  const tipos = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...hojas.map(
      (_hoja, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ),
    '</Types>',
  ].join('')

  const relacionesRaiz = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  const libro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres
    .map((nombre, i) => `<sheet name="${escaparXml(nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets></workbook>`

  const relacionesLibro = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nombres
    .map(
      (_nombre, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('')}<Relationship Id="rId${nombres.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

  const entradas: EntradaZip[] = [
    { nombre: '[Content_Types].xml', datos: Buffer.from(tipos, 'utf8') },
    { nombre: '_rels/.rels', datos: Buffer.from(relacionesRaiz, 'utf8') },
    { nombre: 'xl/workbook.xml', datos: Buffer.from(libro, 'utf8') },
    { nombre: 'xl/_rels/workbook.xml.rels', datos: Buffer.from(relacionesLibro, 'utf8') },
    { nombre: 'xl/styles.xml', datos: Buffer.from(ESTILOS, 'utf8') },
    ...hojas.map((hoja, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, datos: Buffer.from(xmlDeHoja(hoja), 'utf8') })),
  ]
  return armarZip(entradas, fecha)
}
