// El adaptador de la DNRPA, sin tocar internet.
//
// Se prueba en dos niveles. Primero las funciones puras que leen las columnas del PDF —el corazón de
// todo esto—, con arreglos de ítems armados a mano: es lo único que hace falta para probar los rangos
// de X, la tolerancia de la columna de año más cercana y el «modelo es la primera palabra». Segundo, el
// proveedor de punta a punta contra un PDF de mentira servido por un servidor HTTP local: que la
// detección automática encuentre el enlace, que si falla caiga a la URL de respaldo (nunca a la DNRPA
// real), que `urlFuente` la pise sin ni siquiera consultar la página, que el PDF se baje una sola vez
// aunque se pidan marcas, modelos y líneas varias veces, y que una bajada que falló no deje la
// instancia pegada: la próxima tiene que volver a intentar.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import test from 'node:test'
import {
  anioDeLaUrl,
  columnasDeAnio,
  crearProveedorDnrpa,
  etiquetaDeMarca,
  filasDeLaPagina,
  itemsDeLaPagina,
  modeloBase,
  pisoDeLaTabla,
  type ItemDeTexto,
} from '../src/main/vehiculos/dnrpa'
import { ErrorDeProveedor } from '../src/main/vehiculos/proveedor'

// ---------------------------------------------------------------------------
// Las funciones puras
// ---------------------------------------------------------------------------

test('DNRPA: las columnas de año', () => {
  const columnas = columnasDeAnio(2026)
  assert.equal(columnas.length, 25)
  assert.deepEqual(columnas[0], { x: 231.3, anio: 2026 })
  assert.deepEqual(columnas[1], { x: 252.9, anio: 2025 })
  assert.deepEqual(columnas[24], { x: 758, anio: 2002 })
  assert.equal(pisoDeLaTabla(2026), 2002)
})

test('DNRPA: el año sale del nombre del archivo', () => {
  assert.equal(anioDeLaUrl('https://www.dnrpa.gov.ar/valuacion/informacion/01-08-2026.pdf'), 2026)
  assert.equal(anioDeLaUrl('https://www.dnrpa.gov.ar/valuacion/informacion/15-12-2027.pdf'), 2027)
  assert.equal(anioDeLaUrl('https://ejemplo.com/otra-cosa.pdf'), null)
})

test('DNRPA: el modelo es la primera palabra del submodelo', () => {
  assert.equal(modeloBase('HILUX 2.8 SRV 4X4 D/C'), 'HILUX')
  assert.equal(modeloBase('GOL'), 'GOL')
  assert.equal(modeloBase(''), '')
})

test('DNRPA: la marca se pasa a una forma legible', () => {
  assert.equal(etiquetaDeMarca('VOLKSWAGEN'), 'Volkswagen')
  assert.equal(etiquetaDeMarca('BMW'), 'BMW')
  assert.equal(etiquetaDeMarca('KIA'), 'Kia')
  assert.equal(etiquetaDeMarca('VW'), 'VW')
  assert.equal(etiquetaDeMarca('MERCEDES BENZ'), 'Mercedes Benz')
})

test('DNRPA: las filas de una página', async (t) => {
  const columnas = columnasDeAnio(2026)

  await t.test('lee el marcador, la marca, el submodelo y los años por su columna de X', () => {
    const items: ItemDeTexto[] = [
      { str: 'A', x: 50, y: 100 },
      { str: 'TOYOTA', x: 100, y: 100 },
      { str: 'HILUX', x: 140, y: 100 },
      { str: 'PICKUP', x: 160, y: 100 },
      { str: '1500000', x: 231, y: 100 },
      { str: '1400000', x: 253, y: 100 },
    ]
    const filas = filasDeLaPagina(items, columnas)
    assert.equal(filas.length, 1)
    assert.equal(filas[0]!.tipo, 'AUTO')
    assert.equal(filas[0]!.marca, 'TOYOTA')
    // Dos ítems en el rango del submodelo se unen con un espacio.
    assert.equal(filas[0]!.subModelo, 'HILUX PICKUP')
    assert.deepEqual(filas[0]!.anios, [2026, 2025])
  })

  await t.test('«M» en la columna del marcador es moto', () => {
    const filas = filasDeLaPagina(
      [
        { str: 'M', x: 50, y: 100 },
        { str: 'HONDA', x: 100, y: 100 },
        { str: 'WAVE', x: 140, y: 100 },
      ],
      columnas,
    )
    assert.equal(filas[0]!.tipo, 'MOTO')
  })

  await t.test('sin marcador A/M la fila se descarta', () => {
    const filas = filasDeLaPagina(
      [
        { str: 'TOYOTA', x: 100, y: 100 },
        { str: 'HILUX', x: 140, y: 100 },
      ],
      columnas,
    )
    assert.equal(filas.length, 0)
  })

  await t.test('un número lejos de toda columna de año no cuenta', () => {
    const filas = filasDeLaPagina(
      [
        { str: 'A', x: 50, y: 100 },
        { str: 'TOYOTA', x: 100, y: 100 },
        { str: 'HILUX', x: 140, y: 100 },
        // A más de 12 puntos de la columna más cercana (231.3): no es un año, es otra cosa.
        { str: '999999', x: 215, y: 100 },
      ],
      columnas,
    )
    assert.deepEqual(filas[0]!.anios, [])
  })

  await t.test('el encabezado y el pie de página quedan afuera', () => {
    const arriba = filasDeLaPagina([{ str: 'A', x: 50, y: 540 }, { str: 'TOYOTA', x: 100, y: 540 }], columnas)
    const abajo = filasDeLaPagina([{ str: 'A', x: 50, y: 10 }, { str: 'TOYOTA', x: 100, y: 10 }], columnas)
    assert.equal(arriba.length, 0)
    assert.equal(abajo.length, 0)
  })

  await t.test('itemsDeLaPagina descarta lo que no trae texto o posición', () => {
    const items = itemsDeLaPagina([
      { str: 'TOYOTA', transform: [1, 0, 0, 1, 100, 100] },
      { str: '   ', transform: [1, 0, 0, 1, 50, 100] },
      { str: 'HILUX', transform: [1, 0, 0, 1] },
      { transform: [1, 0, 0, 1, 140, 100] },
      'no es un objeto',
      null,
    ])
    assert.deepEqual(items, [{ str: 'TOYOTA', x: 100, y: 100 }])
  })
})

// ---------------------------------------------------------------------------
// El proveedor de punta a punta, contra un PDF de mentira
// ---------------------------------------------------------------------------

function bytesLen(texto: string): number {
  return Buffer.byteLength(texto, 'latin1')
}

/** Un PDF de una sola página, con el texto puesto en posiciones exactas vía Tm + Tj. */
function construirPdf(comandos: string): Buffer {
  const streamBody = `${comandos}\n`
  const largo = bytesLen(streamBody)
  const objetos = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 850 600] /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${largo} >>\nstream\n${streamBody}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ]
  const cabecera = '%PDF-1.4\n'
  let offset = bytesLen(cabecera)
  const offsets: number[] = []
  for (const objeto of objetos) {
    offsets.push(offset)
    offset += bytesLen(objeto)
  }
  const inicioXref = offset
  let xref = `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const unOffset of offsets) xref += `${String(unOffset).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF`
  return Buffer.from(cabecera + objetos.join('') + xref + trailer, 'latin1')
}

function campo(x: number, y: number, texto: string): string {
  return `BT\n/F1 8 Tf\n1 0 0 1 ${x} ${y} Tm (${texto}) Tj\nET`
}

/**
 * Tres filas: un auto con una palabra clave de categoría y sin años, un auto con años y sin palabra
 * clave, y una moto sin ninguna palabra clave —para probar que igual cae en «MOTO»—. Los submodelos se
 * mantienen cortos a propósito: con un submodelo largo, pdfjs a veces pega el número de la columna de
 * año siguiente al texto de al lado si no hay una separación bien grande, y esa es una rareza de cómo
 * arma el texto seleccionable, no algo de lo que dependa el parseo por columnas.
 */
const PDF_DE_PRUEBA = construirPdf(
  [
    campo(50, 100, 'A'),
    campo(100, 100, 'TOYOTA'),
    campo(140, 100, 'HILUX PICKUP'),
    campo(50, 150, 'M'),
    campo(100, 150, 'HONDA'),
    campo(140, 150, 'WAVE'),
    campo(50, 200, 'A'),
    campo(100, 200, 'VW'),
    campo(140, 200, 'GOL'),
    campo(231, 200, '1500000'),
    campo(253, 200, '1400000'),
  ].join('\n'),
)

class DnrpaSimulado {
  readonly pedidos: string[] = []
  private servidor: Server | null = null
  url = ''
  /** Cuántas veces se pidió el PDF: es la prueba de que el proveedor lo baja una sola vez. */
  pedidosDePdf = 0
  /** Si está puesto, la página de descubrimiento responde este código en vez del HTML normal. */
  fallaDescubrimiento: number | null = null
  /** Si está puesto, el pedido del PDF responde este código en vez del archivo. */
  fallaPdf: number | null = null

  async escuchar(): Promise<string> {
    this.servidor = createServer((peticion, respuesta) => {
      const ruta = (peticion.url ?? '/').split('?')[0]!
      this.pedidos.push(ruta)

      if (ruta === '/portal_dnrpa/valuaciones2.php') {
        if (this.fallaDescubrimiento) {
          respuesta.writeHead(this.fallaDescubrimiento)
          respuesta.end('error')
          return
        }
        respuesta.writeHead(200, { 'content-type': 'text/html' })
        respuesta.end(
          '<html><body><a href="../valuacion/informacion/01-08-2026.pdf">Tabla de Valuación Actual</a></body></html>',
        )
        return
      }

      if (ruta === '/valuacion/informacion/01-08-2026.pdf') {
        this.pedidosDePdf++
        if (this.fallaPdf) {
          respuesta.writeHead(this.fallaPdf)
          respuesta.end('error')
          return
        }
        respuesta.writeHead(200, { 'content-type': 'application/pdf' })
        respuesta.end(PDF_DE_PRUEBA)
        return
      }

      respuesta.writeHead(404)
      respuesta.end('no encontrado')
    })
    await new Promise<void>((resolver) => this.servidor!.listen(0, '127.0.0.1', resolver))
    const direccion = this.servidor.address()
    this.url = `http://127.0.0.1:${typeof direccion === 'object' && direccion ? direccion.port : 0}`
    return this.url
  }

  async cerrar(): Promise<void> {
    if (!this.servidor) return
    await new Promise<void>((resolver) => this.servidor!.close(() => resolver()))
    this.servidor = null
  }
}

test('DNRPA: el proveedor de punta a punta', async (t) => {
  const dnrpa = new DnrpaSimulado()
  await dnrpa.escuchar()

  try {
    await t.test('detecta la tabla vigente, la baja una sola vez y arma marcas, modelos y líneas', async () => {
      const proveedor = crearProveedorDnrpa({ urlDescubrimiento: `${dnrpa.url}/portal_dnrpa/valuaciones2.php` })

      assert.deepEqual(proveedor.tiposQueSirve(), ['AUTO', 'MOTO'])

      const marcasAuto = await proveedor.marcas('AUTO')
      assert.deepEqual(
        marcasAuto.map((marca) => marca.nombre).sort(),
        ['Toyota', 'VW'],
      )
      const marcasMoto = await proveedor.marcas('MOTO')
      assert.deepEqual(marcasMoto.map((marca) => marca.nombre), ['Honda'])

      const modelosToyota = await proveedor.modelos('AUTO', 'TOYOTA')
      assert.deepEqual(modelosToyota.map((modelo) => modelo.nombre), ['HILUX'])

      const lineasHilux = await proveedor.lineas('AUTO', 'TOYOTA', 'HILUX')
      assert.equal(lineasHilux.length, 1)
      assert.equal(lineasHilux[0]!.nombre, 'HILUX PICKUP')
      assert.equal(lineasHilux[0]!.categoria, 'PICKUP')
      // Sin ninguna columna de año marcada: no se inventa ningún año.
      assert.equal(lineasHilux[0]!.anioDesde, null)
      assert.equal(lineasHilux[0]!.anioHasta, null)
      assert.equal(lineasHilux[0]!.precioLista, null)

      const lineasGol = await proveedor.lineas('AUTO', 'VW', 'GOL')
      assert.equal(lineasGol.length, 1)
      // «GOL» no tiene ninguna palabra de la tabla de categorías: queda sin determinar, no inventada.
      assert.equal(lineasGol[0]!.categoria, null)
      assert.equal(lineasGol[0]!.anioDesde, 2025)
      assert.equal(lineasGol[0]!.anioHasta, 2026)

      const lineasWave = await proveedor.lineas('MOTO', 'HONDA', 'WAVE')
      assert.equal(lineasWave.length, 1)
      // Una moto sin scooter ni cuatriciclo es simplemente una moto.
      assert.equal(lineasWave[0]!.categoria, 'MOTO')

      // Todo lo anterior salió de UN solo PDF: cinco llamadas, un solo pedido de red.
      assert.equal(dnrpa.pedidosDePdf, 1, 'bajó el PDF más de una vez')
    })

    await t.test('probar cuenta las marcas de los dos tipos', async () => {
      const proveedor = crearProveedorDnrpa({ urlDescubrimiento: `${dnrpa.url}/portal_dnrpa/valuaciones2.php` })
      const prueba = await proveedor.probar()
      assert.equal(prueba.ok, true)
      assert.equal(prueba.marcasEncontradas, 3)
      assert.match(prueba.detalle, /2 marcas de auto y 1 de moto/)
    })

    await t.test('si la detección falla, cae a la URL de respaldo y nunca toca la DNRPA real', async () => {
      dnrpa.fallaDescubrimiento = 500
      try {
        const proveedor = crearProveedorDnrpa({
          urlDescubrimiento: `${dnrpa.url}/portal_dnrpa/valuaciones2.php`,
          urlDeRespaldo: `${dnrpa.url}/valuacion/informacion/01-08-2026.pdf`,
        })
        const marcas = await proveedor.marcas('AUTO')
        assert.equal(marcas.length, 2)
      } finally {
        dnrpa.fallaDescubrimiento = null
      }
    })

    await t.test('urlFuente pisa la detección: ni siquiera consulta la página de descubrimiento', async () => {
      const antesDePdf = dnrpa.pedidosDePdf
      const pedidosAntes = dnrpa.pedidos.length
      const proveedor = crearProveedorDnrpa({ urlFuente: `${dnrpa.url}/valuacion/informacion/01-08-2026.pdf` })
      const marcas = await proveedor.marcas('AUTO')
      assert.equal(marcas.length, 2)
      assert.equal(dnrpa.pedidosDePdf, antesDePdf + 1)
      // Ni un solo pedido nuevo tocó la página de descubrimiento: fue directo al PDF pisado.
      const pedidosNuevos = dnrpa.pedidos.slice(pedidosAntes)
      assert.deepEqual(pedidosNuevos, ['/valuacion/informacion/01-08-2026.pdf'])
    })

    await t.test('una bajada que falló no deja la instancia pegada: la próxima vuelve a intentar', async () => {
      const proveedor = crearProveedorDnrpa({ urlFuente: `${dnrpa.url}/valuacion/informacion/01-08-2026.pdf` })
      dnrpa.fallaPdf = 500
      await assert.rejects(proveedor.marcas('AUTO'))
      dnrpa.fallaPdf = null
      const marcas = await proveedor.marcas('AUTO')
      assert.equal(marcas.length, 2)
    })

    await t.test('sin conexión, el error dice que es de red', async () => {
      const proveedor = crearProveedorDnrpa({ urlFuente: 'http://127.0.0.1:1/no-existe' })
      await assert.rejects(proveedor.marcas('AUTO'), (error: unknown) => {
        assert.ok(error instanceof ErrorDeProveedor)
        assert.equal(error.esDeRed, true)
        return true
      })
    })
  } finally {
    await dnrpa.cerrar()
  }
})
