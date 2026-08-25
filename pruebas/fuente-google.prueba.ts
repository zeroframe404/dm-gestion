// Pruebas del cliente de Google Sheets: comprueban que se hablan bien la notación A1 (títulos con
// espacios), los rangos de escritura, el batchUpdate para agrandar y ocultar columnas, los reintentos
// y la traducción de los errores de Google a mensajes entendibles.
//
// Levanta un servidor HTTP local que simula la API v4. No sale a internet ni toca ninguna hoja real.
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import test from 'node:test'
import { extraerIdDeHoja, FuenteGoogleSheets, tramosDeFilas } from '../src/main/importacion/fuente'
import { ErrorDeNegocio } from '../src/main/servicios/errores'

interface PestanaFalsa {
  sheetId: number
  titulo: string
  indice: number
  columnas: number
  valores: string[][]
}

interface Guion {
  /** Códigos de estado a devolver antes de responder bien (para probar los reintentos). */
  fallasIniciales?: number[]
  /** Error permanente para todos los pedidos. */
  errorFijo?: { estado: number; mensaje: string }
}

class ApiSimulada {
  readonly servidor: Server
  readonly pestanas: PestanaFalsa[] = [
    { sheetId: 1, titulo: 'AGOSTO', indice: 0, columnas: 26, valores: [['NOMBRE', 'DNI'], ['GONZALEZ MARIA LAURA', '27345678']] },
    { sheetId: 2, titulo: 'RIESGOS VARIOS', indice: 1, columnas: 26, valores: [['NOMBRE', 'RIESGO'], ["O'BRIEN JUAN", 'INCENDIO']] },
  ]
  readonly pedidos: string[] = []
  readonly batchUpdates: unknown[] = []
  guion: Guion = {}
  private fallasUsadas = 0

  constructor() {
    this.servidor = createServer((pedido, respuesta) => void this.atender(pedido, respuesta))
  }

  async escuchar(): Promise<string> {
    await new Promise<void>((listo) => this.servidor.listen(0, '127.0.0.1', listo))
    const { port } = this.servidor.address() as AddressInfo
    return `http://127.0.0.1:${port}/`
  }

  async cerrar(): Promise<void> {
    await new Promise<void>((listo) => this.servidor.close(() => listo()))
  }

  private responder(respuesta: ServerResponse, estado: number, cuerpo: unknown): void {
    const texto = JSON.stringify(cuerpo)
    respuesta.writeHead(estado, { 'content-type': 'application/json; charset=utf-8' })
    respuesta.end(texto)
  }

  private error(respuesta: ServerResponse, estado: number, mensaje: string): void {
    this.responder(respuesta, estado, { error: { code: estado, message: mensaje, status: 'ERROR' } })
  }

  private async atender(pedido: IncomingMessage, respuesta: ServerResponse): Promise<void> {
    const url = new URL(pedido.url ?? '/', 'http://127.0.0.1')
    const ruta = decodeURIComponent(url.pathname)
    this.pedidos.push(`${pedido.method} ${ruta}`)

    if (this.guion.errorFijo) return this.error(respuesta, this.guion.errorFijo.estado, this.guion.errorFijo.mensaje)
    const fallas = this.guion.fallasIniciales ?? []
    if (this.fallasUsadas < fallas.length) {
      const estado = fallas[this.fallasUsadas++]!
      return this.error(respuesta, estado, 'Fallo transitorio simulado')
    }

    const cuerpo = await this.leerCuerpo(pedido)

    // GET /v4/spreadsheets/{id}
    const estructura = ruta.match(/^\/v4\/spreadsheets\/([^/:]+)$/)
    if (estructura && pedido.method === 'GET') {
      return this.responder(respuesta, 200, {
        spreadsheetId: estructura[1],
        properties: { title: 'GENERAL DE CLIENTES (PRUEBA)' },
        sheets: this.pestanas.map((p) => ({
          properties: { sheetId: p.sheetId, title: p.titulo, index: p.indice, gridProperties: { rowCount: 1000, columnCount: p.columnas } },
        })),
      })
    }

    // GET/PUT /v4/spreadsheets/{id}/values/{rango}
    const valores = ruta.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/)
    if (valores) {
      const rango = valores[2]!
      const titulo = (rango.match(/^'?(.*?)'?!/)?.[1] ?? rango).replace(/''/g, "'")
      const pestana = this.pestanas.find((p) => p.titulo === titulo)
      if (!pestana) return this.error(respuesta, 400, `Unable to parse range: ${rango}`)
      if (pedido.method === 'GET') return this.responder(respuesta, 200, { range: rango, majorDimension: 'ROWS', values: pestana.valores })
      if (pedido.method === 'PUT') {
        const datos = cuerpo as { majorDimension?: string; values?: string[][] }
        const columna = this.indiceDeColumna(rango)
        const celdas = datos.majorDimension === 'COLUMNS' ? (datos.values?.[0] ?? []) : (datos.values ?? []).map((f) => f[0] ?? '')
        if (columna >= pestana.columnas) return this.error(respuesta, 400, 'Range exceeds grid limits')
        celdas.forEach((valor, fila) => {
          while (pestana.valores.length <= fila) pestana.valores.push([])
          const destino = pestana.valores[fila]!
          while (destino.length <= columna) destino.push('')
          destino[columna] = valor
        })
        return this.responder(respuesta, 200, { updatedCells: celdas.length })
      }
    }

    // POST /v4/spreadsheets/{id}/values:batchUpdate — escritura de varios tramos de una vez.
    if (/\/values:batchUpdate$/.test(ruta) && pedido.method === 'POST') {
      const datos = cuerpo as { data?: Array<{ range?: string; majorDimension?: string; values?: string[][] }> }
      for (const tramo of datos.data ?? []) {
        const rango = tramo.range ?? ''
        const titulo = (rango.match(/^'?(.*?)'?!/)?.[1] ?? rango).replace(/''/g, "'")
        const pestana = this.pestanas.find((p) => p.titulo === titulo)
        if (!pestana) return this.error(respuesta, 400, `Unable to parse range: ${rango}`)
        const columna = this.indiceDeColumna(rango)
        if (columna >= pestana.columnas) return this.error(respuesta, 400, 'Range exceeds grid limits')
        const primeraFila = Number(rango.split('!')[1]?.match(/^[A-Z]+(\d+)/)?.[1] ?? '1')
        const celdas = tramo.majorDimension === 'COLUMNS' ? (tramo.values?.[0] ?? []) : (tramo.values ?? []).map((f) => f[0] ?? '')
        celdas.forEach((valor, desplazamiento) => {
          const fila = primeraFila - 1 + desplazamiento
          while (pestana.valores.length <= fila) pestana.valores.push([])
          const destino = pestana.valores[fila]!
          while (destino.length <= columna) destino.push('')
          destino[columna] = valor
        })
      }
      return this.responder(respuesta, 200, { totalUpdatedCells: (datos.data ?? []).length })
    }

    // POST /v4/spreadsheets/{id}:batchUpdate
    if (/:batchUpdate$/.test(ruta) && pedido.method === 'POST') {
      const datos = cuerpo as { requests?: Array<Record<string, any>> }
      for (const solicitud of datos.requests ?? []) {
        this.batchUpdates.push(solicitud)
        if (solicitud.appendDimension) {
          const pestana = this.pestanas.find((p) => p.sheetId === solicitud.appendDimension.sheetId)
          if (pestana) pestana.columnas += solicitud.appendDimension.length
        }
      }
      return this.responder(respuesta, 200, { replies: (datos.requests ?? []).map(() => ({})) })
    }

    return this.error(respuesta, 404, `Requested entity was not found: ${ruta}`)
  }

  /** «'RIESGOS VARIOS'!C1:C5» → 2 */
  private indiceDeColumna(rango: string): number {
    const letras = rango.split('!')[1]?.match(/^([A-Z]+)/)?.[1] ?? 'A'
    let n = 0
    for (const letra of letras) n = n * 26 + (letra.charCodeAt(0) - 64)
    return n - 1
  }

  private leerCuerpo(pedido: IncomingMessage): Promise<unknown> {
    return new Promise((listo) => {
      const trozos: Buffer[] = []
      pedido.on('data', (trozo: Buffer) => trozos.push(trozo))
      pedido.on('end', () => {
        const texto = Buffer.concat(trozos).toString('utf8')
        if (!texto) return listo(null)
        try {
          listo(JSON.parse(texto))
        } catch {
          listo(null)
        }
      })
    })
  }
}

const CUENTA_FALSA = { type: 'service_account', client_email: 'dm-gestion@proyecto.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nfalsa\n-----END PRIVATE KEY-----\n' }

async function conApi(guion: Guion, accion: (fuente: FuenteGoogleSheets, api: ApiSimulada) => Promise<void>): Promise<void> {
  const api = new ApiSimulada()
  api.guion = guion
  const urlBase = await api.escuchar()
  try {
    const fuente = new FuenteGoogleSheets({ hojaId: 'HOJA_DE_PRUEBA', cuentaServicio: CUENTA_FALSA, urlBase })
    await accion(fuente, api)
  } finally {
    await api.cerrar()
  }
}

test('extraerIdDeHoja acepta las URL que copia y pega la gente', () => {
  assert.equal(extraerIdDeHoja('https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0'), '1AbC-dEf_123')
  assert.equal(extraerIdDeHoja('https://docs.google.com/spreadsheets/d/1AbC-dEf_123'), '1AbC-dEf_123')
  assert.equal(extraerIdDeHoja('https://drive.google.com/file/d/1AbC/view'), null)
})

test('lee la estructura y los valores, con títulos que tienen espacios', async () => {
  await conApi({}, async (fuente) => {
    const estructura = await fuente.estructura()
    assert.equal(estructura.titulo, 'GENERAL DE CLIENTES (PRUEBA)')
    assert.deepEqual(
      estructura.pestanas.map((p) => p.titulo),
      ['AGOSTO', 'RIESGOS VARIOS'],
    )

    const valores = await fuente.leerValores('RIESGOS VARIOS')
    assert.deepEqual(valores[0], ['NOMBRE', 'RIESGO'])
    assert.deepEqual(valores[1], ["O'BRIEN JUAN", 'INCENDIO'])
  })
})

test('agranda la grilla, escribe la columna _ID y la oculta', async () => {
  await conApi({}, async (fuente, api) => {
    await fuente.estructura()
    await fuente.asegurarColumnas(1, 30)
    await fuente.escribirTramos('AGOSTO', 29, [
      { fila: 1, valores: ['_ID'] },
      { fila: 2, valores: ['abc123def456'] },
    ])
    await fuente.ocultarColumna(1, 29)

    const agosto = api.pestanas[0]!
    assert.equal(agosto.columnas, 30)
    assert.equal(agosto.valores[0]![29], '_ID')
    assert.equal(agosto.valores[1]![29], 'abc123def456')

    const ocultar = api.batchUpdates.find((s) => (s as Record<string, unknown>).updateDimensionProperties) as any
    assert.ok(ocultar, 'no se pidió ocultar la columna')
    assert.equal(ocultar.updateDimensionProperties.range.startIndex, 29)
    assert.equal(ocultar.updateDimensionProperties.properties.hiddenByUser, true)
  })
})

test('las filas a borrar se agrupan en tramos, de abajo hacia arriba', () => {
  // Cada pedido de borrado hace que Google recalcule la hoja entera: cuantos menos, mejor. Y el orden
  // importa: borrar una fila corre para arriba a las de abajo.
  assert.deepEqual(tramosDeFilas([5, 6, 7]), [{ desde: 5, hasta: 7 }], 'tres seguidas son un solo tramo')
  assert.deepEqual(tramosDeFilas([7, 5, 6, 2]), [
    { desde: 5, hasta: 7 },
    { desde: 2, hasta: 2 },
  ])
  assert.deepEqual(tramosDeFilas([4, 4, 9]), [
    { desde: 9, hasta: 9 },
    { desde: 4, hasta: 4 },
  ], 'la repetida no se borra dos veces')
  assert.deepEqual(tramosDeFilas([]), [])
})

test('borrar filas seguidas es un solo pedido a Google', async () => {
  await conApi({}, async (fuente, api) => {
    await fuente.borrarFilas(1, [12, 10, 11, 4])
    const borrados = api.batchUpdates.filter((s) => (s as Record<string, unknown>).deleteDimension) as any[]
    assert.equal(borrados.length, 2, 'las tres seguidas van juntas y la suelta aparte')
    assert.deepEqual(
      borrados.map((b) => [b.deleteDimension.range.startIndex, b.deleteDimension.range.endIndex]),
      [
        [9, 12],
        [3, 4],
      ],
      'de abajo hacia arriba, con los índices en base 0 que espera Google',
    )
  })
})

test('reintenta los errores transitorios de Google', async () => {
  await conApi({ fallasIniciales: [503] }, async (fuente, api) => {
    const estructura = await fuente.estructura()
    assert.equal(estructura.pestanas.length, 2)
    assert.equal(api.pedidos.length, 2, 'tendría que haber reintentado una vez')
  })
})

test('traduce los errores de Google a mensajes para el usuario', async () => {
  await conApi({ errorFijo: { estado: 403, mensaje: 'The caller does not have permission' } }, async (fuente) => {
    await assert.rejects(
      () => fuente.estructura(),
      (error: unknown) => {
        assert.ok(error instanceof ErrorDeNegocio)
        assert.match(error.message, /no tiene acceso a la hoja/)
        assert.match(error.message, /dm-gestion@proyecto\.iam\.gserviceaccount\.com/)
        return true
      },
    )
  })

  await conApi({ errorFijo: { estado: 404, mensaje: 'Requested entity was not found' } }, async (fuente) => {
    await assert.rejects(
      () => fuente.estructura(),
      (error: unknown) => {
        assert.ok(error instanceof ErrorDeNegocio)
        assert.match(error.message, /No se encontró la hoja/)
        return true
      },
    )
  })

  await conApi({ errorFijo: { estado: 403, mensaje: 'Google Sheets API has not been used in project 123 before or it is disabled' } }, async (fuente) => {
    await assert.rejects(
      () => fuente.estructura(),
      (error: unknown) => {
        assert.ok(error instanceof ErrorDeNegocio)
        assert.match(error.message, /no está habilitada/)
        return true
      },
    )
  })
})
