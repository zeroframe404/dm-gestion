// El lector de planillas del Alta desde Excel: .xlsx (armado por nuestro escritor y a mano, con lo que
// suelen traer los archivos de Excel de verdad) y .csv.
import assert from 'node:assert/strict'
import test from 'node:test'
import { claseDeFormato, fechaDeSerie, indiceDeColumna, leerLibro, partirCsv, textoDeNumero } from '../src/main/importacion/lectorDeLibro'
import { armarZip, construirXlsx } from '../src/main/servicios/xlsx'

function xlsxAMano(): Buffer {
  const archivos: Record<string, string> = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<workbookPr/><sheets><sheet name="Cartera &amp; más" sheetId="1" r:id="rId1"/><sheet name="Vieja" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/hoja1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/hoja2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/sharedStrings.xml':
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<si><t>Asegurado</t></si>' +
      '<si><r><rPr><b/></rPr><t>Fecha </t></r><r><t xml:space="preserve">alta</t></r></si>' +
      '<si><t>Pérez_x000D_, Ana</t><rPh><t>ペレス</t></rPh></si>' +
      '<si><t>Cuota</t></si></sst>',
    'xl/styles.xml':
      '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts>' +
      '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="14"/><xf numFmtId="4"/></cellXfs></styleSheet>',
    'xl/worksheets/hoja1.xml':
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>3</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" s="1"><v>45607</v></c><c r="C3" t="inlineStr"><is><t>en línea</t></is></c>' +
      '<c r="D3" s="3"><v>12500.5</v></c><c r="E3"><v>30123456</v></c><c r="F3" t="b"><v>1</v></c><c r="G3" t="e"><v>#N/A</v></c></row>' +
      '<row r="4"><c r="A4" t="str"><f>A3</f><v>fórmula</v></c><c r="B4" s="2"><v>45658</v></c><c r="D4"><v>0.30000000000000004</v></c></row>' +
      '</sheetData></worksheet>',
    'xl/worksheets/hoja2.xml':
      '<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
      '<x:row><x:c t="inlineStr"><x:is><x:t>oculta</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>',
  }
  return armarZip(
    Object.entries(archivos).map(([nombre, texto]) => ({ nombre, datos: Buffer.from(texto, 'utf8') })),
    new Date(2026, 0, 1),
  )
}

test('lector: un .xlsx de nuestro escritor vuelve con los mismos datos', () => {
  const bytes = construirXlsx([
    { nombre: 'Cartera', encabezados: ['NOMBRE', 'DNI', 'CUOTA'], filas: [['Ana', 30123456, 12500], ['Beto', '20.111.222', 9800.75]] },
    { nombre: 'Otra', encabezados: null, filas: [['x']] },
  ])
  const libro = leerLibro(bytes, 'cartera.xlsx')
  assert.deepEqual(
    libro.hojas.map((h) => h.nombre),
    ['Cartera', 'Otra'],
  )
  assert.deepEqual(libro.hojas[0]!.filas, [
    ['NOMBRE', 'DNI', 'CUOTA'],
    ['Ana', '30123456', '12500'],
    ['Beto', '20.111.222', '9800,75'],
  ])
})

test('lector: textos compartidos, celdas salteadas, fechas, hoja oculta y espacios de nombres', () => {
  const libro = leerLibro(xlsxAMano(), 'agencia.xlsx')
  assert.equal(libro.hojas.length, 2)
  const [cartera, vieja] = libro.hojas
  assert.equal(cartera!.nombre, 'Cartera & más')
  assert.equal(cartera!.oculta, false)
  assert.deepEqual(cartera!.filas[0], ['Asegurado', 'Fecha alta', '', 'Cuota'], 'el texto con formato se junta y la C1 vacía queda vacía')
  assert.deepEqual(cartera!.filas[1], [], 'la fila 2 no existe en el archivo y queda vacía')
  assert.deepEqual(cartera!.filas[2], ['Pérez\r, Ana', '11/11/2024', 'en línea', '12500,5', '30123456', 'VERDADERO'], 'sin la guía fonética y sin el #N/A')
  assert.deepEqual(cartera!.filas[3], ['fórmula', '01/01/2025', '', '0,3'], 'la fórmula usa su valor; el formato de fábrica 14 es fecha')
  assert.equal(vieja!.oculta, true)
  assert.deepEqual(vieja!.filas, [['oculta']])
})

test('lector: .csv con punto y coma, comillas, saltos de línea adentro y Latin-1', () => {
  const texto = 'Nombre;Dirección;Cuota\r\n"Pérez; Ana";"Calle 1\nPiso 2";1.500,50\r\n\r\nBeto;"dice ""hola""";900\r\n'
  const bytes = Buffer.from(texto, 'latin1')
  const libro = leerLibro(bytes, 'C:\\datos\\clientes.csv')
  assert.equal(libro.hojas.length, 1)
  assert.equal(libro.hojas[0]!.nombre, 'clientes')
  assert.deepEqual(libro.hojas[0]!.filas, [
    ['Nombre', 'Dirección', 'Cuota'],
    ['Pérez; Ana', 'Calle 1\nPiso 2', '1.500,50'],
    [],
    ['Beto', 'dice "hola"', '900'],
  ])
  assert.deepEqual(partirCsv('a,b\n1,2', ','), [['a', 'b'], ['1', '2']])
})

test('lector: un .xls viejo, un archivo vacío o un .zip que no es Excel dan un error claro', () => {
  const xls = Buffer.alloc(64)
  xls.writeUInt32BE(0xd0cf11e0, 0)
  assert.throws(() => leerLibro(xls, 'viejo.xls'), /\.xlsx/)
  assert.throws(() => leerLibro(Buffer.alloc(0), 'vacio.xlsx'), /vacío/)
  const zip = armarZip([{ nombre: 'word/document.xml', datos: Buffer.from('<w/>') }], new Date(2026, 0, 1))
  assert.throws(() => leerLibro(zip, 'carta.docx'), /Word/)
})

test('lector: piezas sueltas', () => {
  assert.equal(indiceDeColumna('A1'), 0)
  assert.equal(indiceDeColumna('AB12'), 27)
  assert.equal(claseDeFormato('dd/mm/yyyy;@'), 'fecha')
  assert.equal(claseDeFormato('[$-F800]dddd, mmmm dd, yyyy'), 'fecha')
  assert.equal(claseDeFormato('hh:mm'), 'hora')
  assert.equal(claseDeFormato('"$" #,##0.00'), null)
  assert.equal(claseDeFormato('General'), null)
  assert.equal(fechaDeSerie(45607.5, false, 'fecha'), '11/11/2024 12:00')
  assert.equal(fechaDeSerie(0, true, 'fecha'), '01/01/1904')
  assert.equal(textoDeNumero('2.0123456789E10'), '20123456789')
  assert.equal(textoDeNumero('1E-3'), '0,001')
})
