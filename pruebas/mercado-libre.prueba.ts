// El adaptador de Mercado Libre y el puente de ajustes compartidos, sin tocar internet.
//
// Del adaptador se prueba lo que se puede romper solo: que pida el token con App ID y Clave secreta,
// que encadene marca → modelo → versión mandando `known_attributes`, que la categoría salga de la
// carrocería y no de una adivinanza, que un modelo sin versiones publicadas no deje el desplegable
// colgado, y que un token vencido se renueve sin que nadie tenga que volver a cargar nada.
//
// Del puente se prueba lo único que de verdad importa: que la huella que calcula el servidor sea la
// misma que calcula el programa. Si esas dos cuentas se separan, la pantalla dice «esta computadora
// está desactualizada» para siempre y nadie entiende por qué.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import test from 'node:test'
import { VpsSimulado } from '../scripts/vps-simulado.mjs'
import { FuenteVps } from '../src/main/vps/fuenteVps'
import { crearProveedorMercadoLibre } from '../src/main/vehiculos/mercadolibre'
import { ErrorDeProveedor } from '../src/main/vehiculos/proveedor'

const APP_ID = '1234567890123456'
const CLAVE = 'unaClaveSecretaDeMentira'

interface Pedido {
  metodo: string
  ruta: string
  autorizacion: string
  cuerpo: unknown
}

/**
 * Un Mercado Libre de mentira. Responde `/oauth/token` y los `top_values` de BRAND, MODEL, TRIM y
 * VEHICLE_BODY_TYPE con la misma forma que documenta Mercado Libre: un arreglo de `{id, name, metric}`.
 */
class MercadoLibreSimulado {
  readonly pedidos: Pedido[] = []
  private servidor: Server | null = null
  url = ''
  /** Cuántas veces se pidió un token. */
  tokensEntregados = 0
  /** Si está puesto, el primer pedido con este token responde 401 (token vencido). */
  tokenVencido: string | null = null

  async escuchar(): Promise<string> {
    this.servidor = createServer((peticion, respuesta) => {
      const trozos: Buffer[] = []
      peticion.on('data', (trozo: Buffer) => trozos.push(trozo))
      peticion.on('end', () => {
        const crudo = Buffer.concat(trozos).toString('utf8')
        const responder = (estado: number, json: unknown) => {
          respuesta.writeHead(estado, { 'content-type': 'application/json' })
          respuesta.end(JSON.stringify(json))
        }
        this.atender(peticion.method ?? 'GET', peticion.url ?? '/', peticion.headers.authorization ?? '', crudo, responder)
      })
    })
    await new Promise<void>((resolver) => this.servidor!.listen(0, '127.0.0.1', resolver))
    const direccion = this.servidor.address()
    this.url = `http://127.0.0.1:${typeof direccion === 'object' && direccion ? direccion.port : 0}`
    return this.url
  }

  private atender(
    metodo: string,
    url: string,
    autorizacion: string,
    crudo: string,
    responder: (estado: number, json: unknown) => void,
  ): void {
    const ruta = url.split('?')[0] ?? url
    let cuerpo: unknown = null
    try {
      cuerpo = crudo ? JSON.parse(crudo) : null
    } catch {
      cuerpo = crudo
    }
    this.pedidos.push({ metodo, ruta, autorizacion, cuerpo })

    if (ruta === '/oauth/token') {
      const parametros = new URLSearchParams(String(crudo))
      if (parametros.get('grant_type') !== 'client_credentials') {
        return responder(400, { error: 'unsupported_grant_type' })
      }
      if (parametros.get('client_id') !== APP_ID || parametros.get('client_secret') !== CLAVE) {
        return responder(400, { error: 'invalid_client', message: 'invalid client_id or client_secret' })
      }
      this.tokensEntregados++
      return responder(200, {
        access_token: `APP_USR-pedido-${this.tokensEntregados}`,
        token_type: 'bearer',
        expires_in: 21600,
        scope: 'offline_access read write',
        user_id: 8035443,
      })
    }

    const token = autorizacion.startsWith('Bearer ') ? autorizacion.slice(7) : ''
    if (this.tokenVencido && token === this.tokenVencido) {
      // Una sola vez: el reintento del adaptador tiene que pedir uno nuevo y salir bien.
      this.tokenVencido = null
      return responder(401, { message: 'invalid_token', error: 'not_found', status: 401 })
    }
    if (!token) return responder(401, { message: 'invalid_token' })

    const conocidos = (cuerpo as { known_attributes?: Array<{ id: string; value_id: string }> } | null)?.known_attributes ?? []
    const valorDe = (id: string) => conocidos.find((conocido) => conocido.id === id)?.value_id ?? ''

    if (ruta === '/catalog_domains/MLA-MOTORCYCLES/attributes/BRAND/top_values') {
      return responder(403, { message: 'Resource not available for this domain', status: 403 })
    }
    if (ruta === '/catalog_domains/MLA-CARS_AND_VANS/attributes/BRAND/top_values') {
      return responder(200, [
        { id: '60249', name: 'Volkswagen', metric: 7987 },
        { id: '66432', name: 'Ford', metric: 5619 },
      ])
    }
    if (ruta === '/catalog_domains/MLA-CARS_AND_VANS/attributes/MODEL/top_values') {
      if (valorDe('BRAND') === '66432') {
        return responder(200, [
          { id: '71012', name: 'Ranger', metric: 900 },
          // Este no tiene versiones publicadas: es el caso del desplegable que quedaría colgado.
          { id: '71099', name: 'Falcon', metric: 12 },
        ])
      }
      return responder(200, [{ id: '70001', name: 'Amarok', metric: 800 }])
    }
    if (ruta === '/catalog_domains/MLA-CARS_AND_VANS/attributes/TRIM/top_values') {
      if (valorDe('MODEL') === '71099') return responder(200, [])
      return responder(200, [{ id: '90001', name: '3.2 Limited 4x4 AT', metric: 120 }])
    }
    if (ruta === '/catalog_domains/MLA-CARS_AND_VANS/attributes/VEHICLE_BODY_TYPE/top_values') {
      if (valorDe('MODEL') === '71099') return responder(500, { message: 'boom' })
      return responder(200, [{ id: '2000', name: 'Pick-Up', metric: 500 }])
    }
    return responder(404, { message: `Ruta desconocida: ${metodo} ${ruta}`, status: 404 })
  }

  async cerrar(): Promise<void> {
    if (!this.servidor) return
    await new Promise<void>((resolver) => this.servidor!.close(() => resolver()))
    this.servidor = null
  }
}

test('Mercado Libre: el catálogo de punta a punta', async (t) => {
  const ml = new MercadoLibreSimulado()
  await ml.escuchar()
  const proveedor = crearProveedorMercadoLibre({ appId: APP_ID, claveSecreta: CLAVE, urlBase: ml.url })

  try {
    await t.test('entra con App ID y Clave secreta, y una sola vez', async () => {
      const marcas = await proveedor.marcas('AUTO')
      assert.deepEqual(
        marcas.map((marca) => marca.nombre),
        ['Volkswagen', 'Ford'],
      )
      await proveedor.marcas('AUTO')
      // El token dura seis horas: el segundo pedido tiene que reusarlo y no volver a /oauth/token.
      assert.equal(ml.tokensEntregados, 1, 'pidió el token más de una vez')
    })

    await t.test('los modelos se piden encadenados a la marca', async () => {
      const modelos = await proveedor.modelos('AUTO', '66432')
      assert.deepEqual(
        modelos.map((modelo) => modelo.nombre),
        ['Ranger', 'Falcon'],
      )
      const ultimo = ml.pedidos.filter((pedido) => pedido.ruta.endsWith('/MODEL/top_values')).at(-1)
      assert.deepEqual((ultimo?.cuerpo as { known_attributes: unknown }).known_attributes, [
        { id: 'BRAND', value_id: '66432' },
      ])
    })

    await t.test('la categoría sale de la carrocería, no de una adivinanza', async () => {
      const lineas = await proveedor.lineas('AUTO', '66432', '71012')
      assert.equal(lineas.length, 1)
      const linea = lineas[0]!
      assert.equal(linea.nombre, '3.2 Limited 4x4 AT')
      assert.equal(linea.categoriaCruda, 'Pick-Up')
      assert.equal(linea.categoria, 'PICKUP')
      // Mercado Libre no publica ni años ni precio: se dejan en null en vez de inventarlos.
      assert.equal(linea.anioDesde, null)
      assert.equal(linea.anioHasta, null)
      assert.equal(linea.precioLista, null)
    })

    await t.test('un modelo sin versiones no deja el desplegable colgado', async () => {
      // El nombre lo tiene de haber pedido los modelos de Ford recién: no vuelve a salir a buscarlo.
      const lineas = await proveedor.lineas('AUTO', '66432', '71099')
      assert.equal(lineas.length, 1)
      assert.equal(lineas[0]!.nombre, 'Falcon')
      // La carrocería falló (500) y aun así la bajada sigue: sin categoría, no con una inventada.
      assert.equal(lineas[0]!.categoria, null)
    })

    await t.test('sirve autos y avisa que las motos no están', async () => {
      assert.deepEqual(proveedor.tiposQueSirve(), ['AUTO'])
      await assert.rejects(proveedor.marcas('MOTO'), (error: Error) => {
        assert.ok(error instanceof ErrorDeProveedor)
        assert.match(error.message, /motos/i)
        return true
      })
    })

    await t.test('un token vencido se renueva solo', async () => {
      ml.tokenVencido = 'APP_USR-pedido-1'
      const marcas = await proveedor.marcas('AUTO')
      assert.equal(marcas.length, 2, 'el reintento con token nuevo no trajo las marcas')
      assert.equal(ml.tokensEntregados, 2)
    })

    await t.test('probar dice qué pasa cuando la clave está mal', async () => {
      const mal = crearProveedorMercadoLibre({ appId: APP_ID, claveSecreta: 'otra', urlBase: ml.url })
      const prueba = await mal.probar()
      assert.equal(prueba.ok, false)
      assert.match(prueba.detalle, /App ID o la Clave secreta/)
    })

    await t.test('un Access Token pegado a mano entra sin pedir nada', async () => {
      const antes = ml.tokensEntregados
      const conToken = crearProveedorMercadoLibre({
        appId: '',
        claveSecreta: '',
        accessToken: 'APP_USR-pegado-a-mano',
        urlBase: ml.url,
      })
      assert.equal((await conToken.marcas('AUTO')).length, 2)
      assert.equal(ml.tokensEntregados, antes, 'pidió un token teniendo uno pegado')
    })
  } finally {
    await ml.cerrar()
  }
})

test('ajustes compartidos: la huella del servidor y la del programa tienen que ser la misma', async (t) => {
  const simulador = new VpsSimulado({ pestanas: [{ titulo: 'AGOSTO', valores: [['NOMBRE', '_ID']] }] })
  await simulador.escuchar()
  const fuente = new FuenteVps({ urlBase: simulador.url, token: 'prueba' })

  try {
    await t.test('sin nada cargado, el servidor dice que no hay', async () => {
      assert.equal(await fuente.estadoAjuste('vehiculos'), null)
      assert.equal(await fuente.leerAjuste('vehiculos'), null)
    })

    await t.test('lo que se guarda vuelve igual y con la huella que calcula el programa', async () => {
      // El mismo orden de claves que arma `valorCompartidoDeVehiculos`: si se separan, la pantalla
      // diría «desactualizada» para siempre aunque las credenciales fueran idénticas.
      const valor = { proveedor: 'MERCADO_LIBRE', usuario: APP_ID, clave: CLAVE, accessToken: null }
      const ficha = await fuente.guardarAjuste('vehiculos', valor, 'Daniel')
      assert.equal(ficha.actualizadoPor, 'Daniel')
      assert.equal(ficha.huella, createHash('sha256').update(JSON.stringify(valor)).digest('hex'))

      const leido = await fuente.leerAjuste('vehiculos')
      assert.deepEqual(leido?.valor, valor)
      assert.equal(leido?.huella, ficha.huella)

      // La consulta de estado no trae el secreto: alcanza con la huella para saber si está al día.
      const consultado = await fuente.estadoAjuste('vehiculos')
      assert.equal(consultado?.huella, ficha.huella)
      assert.equal((consultado as { valor?: unknown }).valor, undefined)
    })

    await t.test('guardar de nuevo pisa lo anterior: la última carga manda', async () => {
      const otro = { proveedor: 'INFOAUTO', usuario: 'agencia', clave: 'otra', accessToken: null }
      await fuente.guardarAjuste('vehiculos', otro, 'Sofía')
      const leido = await fuente.leerAjuste('vehiculos')
      assert.deepEqual(leido?.valor, otro)
      assert.equal(leido?.actualizadoPor, 'Sofía')
    })

    await t.test('el puente no es un almacén de cualquier cosa', async () => {
      await assert.rejects(fuente.guardarAjuste('lo-que-sea', { a: 1 }, null), /lo-que-sea/)
    })

    await t.test('borrarlo lo saca para todas las computadoras', async () => {
      await fuente.borrarAjuste('vehiculos')
      assert.equal(await fuente.estadoAjuste('vehiculos'), null)
    })
  } finally {
    await simulador.cerrar()
  }
})
