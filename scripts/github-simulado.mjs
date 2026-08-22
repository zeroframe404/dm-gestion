// Simulador mínimo de la API «Contents» de GitHub, para las pruebas y el script de humo de la base
// de usuarios. Reproduce lo que usa el programa: GET del repositorio, GET del archivo (con ETag y
// 304), PUT con el candado del sha (409 si cambió, 422 si se crea algo que ya existe), el 401 por
// token inválido y el header de vencimiento del token. No sale a internet.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

function responder(respuesta, estado, cuerpo, cabeceras = {}) {
  respuesta.writeHead(estado, { 'content-type': 'application/json; charset=utf-8', ...cabeceras })
  respuesta.end(cuerpo === null ? '' : JSON.stringify(cuerpo))
  return estado
}

function leerCuerpo(pedido) {
  return new Promise((resolver) => {
    const partes = []
    pedido.on('data', (parte) => partes.push(parte))
    pedido.on('end', () => resolver(Buffer.concat(partes).toString('utf8')))
  })
}

export class GitHubSimulado {
  constructor({ repo = 'zeroframe404/dm-gestion-datos', archivo = 'usuarios.json', tokens = ['prueba'], vence = null } = {}) {
    this.repo = repo
    this.archivo = archivo
    this.tokensValidos = tokens
    this.vence = vence
    this.texto = null
    this.sha = null
    this.etag = null
    this.pedidos = []
    this.intercambios = []
    this.commits = []
    this.guion = {}
    this.fallasUsadas = 0
    this.servidor = createServer((pedido, respuesta) => void this.atender(pedido, respuesta))
  }

  /** Puerto 0 = uno libre. El humo usa uno fijo para poder «cortar internet» y volver a levantarlo en la misma URL. */
  async escuchar(puerto = 0) {
    await new Promise((listo) => this.servidor.listen(puerto, '127.0.0.1', listo))
    this.url = `http://127.0.0.1:${this.servidor.address().port}`
    return this.url
  }

  async cerrar() {
    this.servidor.closeAllConnections?.()
    await new Promise((listo) => this.servidor.close(() => listo()))
  }

  /** Como si otra computadora hubiera escrito el archivo. */
  escribirDirecto(texto) {
    this.texto = texto
    this.sha = createHash('sha1').update(`${Date.now()}-${Math.random()}-${texto}`).digest('hex')
    this.etag = `"${this.sha}"`
    return this.sha
  }

  borrarArchivo() {
    this.texto = null
    this.sha = null
    this.etag = null
  }

  /** Registra cada intercambio (método, ruta, query, cabeceras del pedido y estado de la respuesta) y responde. */
  async atender(pedido, respuesta) {
    const url = new URL(pedido.url ?? '/', 'http://127.0.0.1')
    const ruta = decodeURIComponent(url.pathname)
    this.pedidos.push(`${pedido.method} ${ruta}`)
    const intercambio = { metodo: pedido.method, ruta, busqueda: url.search, cabeceras: { ...pedido.headers }, estado: null }
    this.intercambios.push(intercambio)
    const cuerpo = await leerCuerpo(pedido)
    intercambio.estado = (await this.responderA(pedido, respuesta, ruta, cuerpo)) ?? null
  }

  async responderA(pedido, respuesta, ruta, cuerpo) {
    if (this.guion.colgar) return // nunca responde: para probar el tiempo máximo

    const fallas = this.guion.fallasIniciales ?? []
    if (this.fallasUsadas < fallas.length) {
      const falla = fallas[this.fallasUsadas++]
      const estado = typeof falla === 'number' ? falla : falla.estado
      const cabeceras = typeof falla === 'number' ? {} : (falla.cabeceras ?? {})
      return responder(respuesta, estado, { message: typeof falla === 'number' ? 'Fallo simulado' : (falla.mensaje ?? 'Fallo simulado') }, cabeceras)
    }

    const autorizacion = pedido.headers.authorization ?? ''
    const token = autorizacion.replace(/^Bearer\s+/i, '')
    if (!this.tokensValidos.includes(token)) {
      return responder(respuesta, 401, { message: 'Bad credentials' })
    }
    const comunes = {
      'x-ratelimit-remaining': '4999',
      ...(this.vence ? { 'github-authentication-token-expiration': `${this.vence} 00:00:00 UTC` } : {}),
    }

    if (ruta === `/repos/${this.repo}` && pedido.method === 'GET') {
      if (this.guion.sinRepo) return responder(respuesta, 404, { message: 'Not Found' }, comunes)
      return responder(respuesta, 200, { full_name: this.repo, private: true }, comunes)
    }

    if (ruta !== `/repos/${this.repo}/contents/${this.archivo}`) {
      return responder(respuesta, 404, { message: 'Not Found' }, comunes)
    }

    if (pedido.method === 'GET') {
      if (this.texto === null) return responder(respuesta, 404, { message: 'Not Found' }, comunes)
      if (pedido.headers['if-none-match'] === this.etag) return responder(respuesta, 304, null, { ...comunes, etag: this.etag })
      // GitHub parte el base64 en líneas de 60 caracteres.
      const base64 = Buffer.from(this.texto, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n')
      return responder(respuesta, 200, { name: this.archivo, path: this.archivo, sha: this.sha, encoding: 'base64', content: base64 }, { ...comunes, etag: this.etag })
    }

    if (pedido.method === 'PUT') {
      let datos
      try {
        datos = JSON.parse(cuerpo)
      } catch {
        return responder(respuesta, 400, { message: 'Problems parsing JSON' }, comunes)
      }
      if (this.texto !== null && !datos.sha) {
        return responder(respuesta, 422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }, comunes)
      }
      if (this.texto !== null && datos.sha !== this.sha) {
        return responder(respuesta, 409, { message: `${this.archivo} does not match ${datos.sha}` }, comunes)
      }
      const creando = this.texto === null
      const sha = this.escribirDirecto(Buffer.from(datos.content, 'base64').toString('utf8'))
      this.commits.push(datos.message)
      return responder(respuesta, creando ? 201 : 200, { content: { sha, path: this.archivo }, commit: { message: datos.message } }, comunes)
    }

    return responder(respuesta, 405, { message: 'Method not allowed' }, comunes)
  }
}
