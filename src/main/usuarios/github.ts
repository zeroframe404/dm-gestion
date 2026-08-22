// El archivo de usuarios en un repositorio privado de GitHub, leído y escrito con la API «Contents».
//
// Es una base de datos mínima: un solo archivo JSON. GitHub devuelve el contenido con un `sha` y
// exige ese mismo sha para sobreescribirlo; si otra computadora escribió en el medio responde 409 y
// el servicio relee y vuelve a aplicar el cambio. No hace falta ninguna librería: `fetch` viene con Node.
//
// Los mensajes de error nunca incluyen la URL ni las cabeceras del pedido: llevan el código de estado
// y, como mucho, el `message` que devuelve GitHub recortado.
import { ErrorDeConflicto, ErrorDelAlmacen, type AlmacenRemoto, type LecturaRemota } from './almacen'

/**
 * Repositorio de DATOS, aparte del repositorio del código (`zeroframe404/dm-gestion`, del que bajan
 * las actualizaciones). Tiene que ser otro a propósito: el token de acá puede ESCRIBIR, y si escribiera
 * en el repositorio del código cualquier computadora con el programa podría empujar código o publicar
 * una versión falsa que después instalarían todas las demás. En este repositorio sólo vive usuarios.json.
 */
export const REPO_DATOS = 'zeroframe404/dm-gestion-datos'
export const ARCHIVO_DATOS = 'usuarios.json'

/**
 * Token para leer y escribir usuarios.json: fine-grained personal access token limitado al repositorio
 * REPO_DATOS, con el permiso "Contents: Read and write" y NINGÚN otro. Lo genera el dueño del
 * repositorio en https://github.com/settings/tokens?type=beta (ver README, «Base de usuarios
 * compartida») y se pega acá antes de publicar. Vacío = versión publicada sin base compartida: el
 * programa avisa en el Login y trabaja con usuarios locales.
 *
 * Para rotarlo sin dejar a nadie afuera: el nuevo va en TOKEN_DATOS y el anterior pasa a
 * TOKEN_DATOS_ANTERIOR; las computadoras que todavía no se actualizaron siguen usando el viejo, y las
 * nuevas prueban el anterior si GitHub rechaza el nuevo. Una vez que todas se actualizaron, se revoca
 * el viejo y se vacía TOKEN_DATOS_ANTERIOR.
 *
 * En desarrollo los tokens NO se usan: la app arranca en modo local salvo que se defina la variable
 * de entorno DM_GESTION_TOKEN_DATOS (ver index.ts). Los scripts de humo usan un simulador.
 */
export const TOKEN_DATOS = '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'
export const TOKEN_DATOS_ANTERIOR = ''

export const URL_API_GITHUB = 'https://api.github.com'

/** Un ingreso no puede quedarse colgado: pasado este tiempo se considera que no hay internet. */
export const TIEMPO_MAXIMO_LECTURA_MS = 8_000
/** Reintentar una escritura no es gratis (puede haber quedado aplicada): se le da más margen. */
export const TIEMPO_MAXIMO_ESCRITURA_MS = 15_000

export interface OpcionesGitHub {
  repo: string
  /** Tokens a probar en orden: el vigente y, si GitHub lo rechaza, el anterior (rotación). */
  tokens: string[]
  archivo?: string
  urlBase?: string
  tiempoMaximoLecturaMs?: number
  tiempoMaximoEscrituraMs?: number
}

interface RespuestaContents {
  content?: string
  encoding?: string
  sha?: string
}

function mensajeDeGitHub(cuerpo: string): string {
  try {
    const json = JSON.parse(cuerpo) as { message?: unknown }
    if (typeof json.message === 'string') return json.message.slice(0, 160)
  } catch {
    // no era JSON
  }
  return cuerpo.slice(0, 160)
}

export class AlmacenGitHub implements AlmacenRemoto {
  readonly descripcion: string
  private readonly urlRepo: string
  private readonly urlArchivo: string
  private readonly tokens: string[]
  private tokenActual = 0
  private readonly tiempoLecturaMs: number
  private readonly tiempoEscrituraMs: number
  /** Última lectura buena, para pedir con If-None-Match: un 304 no consume cuota. */
  private cache: { etag: string; lectura: LecturaRemota } | null = null
  private vence: string | null = null

  constructor(opciones: OpcionesGitHub) {
    const archivo = opciones.archivo ?? ARCHIVO_DATOS
    const base = (opciones.urlBase ?? URL_API_GITHUB).replace(/\/+$/, '')
    this.urlRepo = `${base}/repos/${opciones.repo}`
    this.urlArchivo = `${this.urlRepo}/contents/${archivo}`
    this.tokens = opciones.tokens.filter((t) => t.trim() !== '')
    if (this.tokens.length === 0) throw new Error('AlmacenGitHub necesita al menos un token.')
    this.tiempoLecturaMs = opciones.tiempoMaximoLecturaMs ?? TIEMPO_MAXIMO_LECTURA_MS
    this.tiempoEscrituraMs = opciones.tiempoMaximoEscrituraMs ?? TIEMPO_MAXIMO_ESCRITURA_MS
    this.descripcion = `GitHub ${opciones.repo}`
  }

  vencimientoDelToken(): string | null {
    return this.vence
  }

  private async pedirUnaVez(metodo: 'GET' | 'PUT', url: string, cabeceras: Record<string, string>, cuerpo: unknown, tiempoMs: number): Promise<Response> {
    const control = new AbortController()
    const temporizador = setTimeout(() => control.abort(), tiempoMs)
    try {
      return await fetch(url, {
        method: metodo,
        signal: control.signal,
        headers: {
          Authorization: `Bearer ${this.tokens[this.tokenActual]}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'dm-gestion',
          ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...cabeceras,
        },
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      })
    } finally {
      clearTimeout(temporizador)
    }
  }

  /** Hace el pedido y, si el token vigente fue rechazado (401), prueba una vez con el anterior. */
  private async pedir(metodo: 'GET' | 'PUT', url: string, cabeceras: Record<string, string> = {}, cuerpo?: unknown, tiempoMs = this.tiempoLecturaMs): Promise<Response> {
    let respuesta = await this.pedirUnaVez(metodo, url, cabeceras, cuerpo, tiempoMs)
    if (respuesta.status === 401 && this.tokenActual + 1 < this.tokens.length) {
      await respuesta.text().catch(() => '')
      this.tokenActual += 1
      respuesta = await this.pedirUnaVez(metodo, url, cabeceras, cuerpo, tiempoMs)
    }
    // Los fine-grained tokens informan su vencimiento en cada respuesta.
    const vencimiento = respuesta.headers.get('github-authentication-token-expiration')
    if (vencimiento) {
      const fecha = new Date(vencimiento)
      if (!Number.isNaN(fecha.getTime())) this.vence = fecha.toISOString().slice(0, 10)
    }
    return respuesta
  }

  /** Traduce los errores de GitHub a algo que un administrador pueda entender. */
  private async errorDe(respuesta: Response, accion: string): Promise<ErrorDelAlmacen> {
    const detalle = mensajeDeGitHub(await respuesta.text().catch(() => ''))
    const sinCuota = respuesta.headers.get('x-ratelimit-remaining') === '0' || respuesta.headers.has('retry-after')
    switch (respuesta.status) {
      case 401:
        return new ErrorDelAlmacen('GitHub rechazó el token de la base de usuarios: no es válido o venció (HTTP 401).', 401)
      case 403:
      case 429:
        if (sinCuota || /rate limit/i.test(detalle)) {
          return new ErrorDelAlmacen('GitHub limitó temporalmente los pedidos de la base de usuarios. Probá de nuevo en unos minutos.', respuesta.status, true)
        }
        return new ErrorDelAlmacen('El token de la base de usuarios no tiene permiso sobre el repositorio de datos (HTTP 403).', 403)
      case 404:
        return new ErrorDelAlmacen('GitHub no encuentra el repositorio de datos (HTTP 404): revisá que exista y que el token tenga acceso.', 404)
      default:
        if (respuesta.status >= 500) {
          return new ErrorDelAlmacen(`GitHub no está respondiendo bien (HTTP ${respuesta.status}). Suele pasar solo; probá en unos minutos.`, respuesta.status, true)
        }
        return new ErrorDelAlmacen(`GitHub devolvió ${respuesta.status} al ${accion}: ${detalle || 'sin detalle'}`, respuesta.status)
    }
  }

  async leer(): Promise<LecturaRemota | null> {
    // Se retiene la caché con la que se pidió: una escritura en el medio la vacía, y el 304 tiene que
    // responderse con la lectura que GitHub confirmó como vigente, no con «nada».
    const cache = this.cache
    const condicional: Record<string, string> = cache ? { 'If-None-Match': cache.etag } : {}
    const respuesta = await this.pedir('GET', this.urlArchivo, condicional)
    if (respuesta.status === 304 && cache) {
      await respuesta.text().catch(() => '')
      return cache.lectura
    }
    if (respuesta.status === 404) {
      await respuesta.text().catch(() => '')
      // «El archivo todavía no existe» (primera vez) y «el repositorio no existe o el token no lo ve»
      // son los dos un 404 con el mismo cuerpo. Se pregunta por el repositorio para distinguirlos:
      // sólo si el repositorio responde bien se asume archivo nuevo y se deja crearlo.
      const repo = await this.pedir('GET', this.urlRepo)
      if (repo.ok) {
        await repo.text().catch(() => '')
        this.cache = null
        return null
      }
      throw await this.errorDe(repo, 'leer usuarios.json')
    }
    if (!respuesta.ok) throw await this.errorDe(respuesta, 'leer usuarios.json')

    const datos = (await respuesta.json()) as RespuestaContents
    if (typeof datos.sha !== 'string' || typeof datos.content !== 'string') {
      throw new ErrorDelAlmacen('GitHub devolvió usuarios.json sin contenido o sin sha.', respuesta.status)
    }
    if (datos.encoding && datos.encoding !== 'base64') {
      throw new ErrorDelAlmacen(`GitHub devolvió usuarios.json con una codificación inesperada (${datos.encoding}).`, respuesta.status)
    }
    // GitHub parte el base64 en líneas de 60 caracteres; Buffer las ignora solo.
    const lectura = { texto: Buffer.from(datos.content, 'base64').toString('utf8'), sha: datos.sha }
    const etag = respuesta.headers.get('etag')
    this.cache = etag ? { etag, lectura } : null
    return lectura
  }

  async escribir(texto: string, shaPrevio: string | null, mensaje: string): Promise<string> {
    const cuerpo = {
      message: mensaje,
      content: Buffer.from(texto, 'utf8').toString('base64'),
      ...(shaPrevio ? { sha: shaPrevio } : {}),
    }
    const respuesta = await this.pedir('PUT', this.urlArchivo, {}, cuerpo, this.tiempoEscrituraMs)
    // 409: el sha ya no es el actual. 422 sin sha: el archivo ya existía (lo creó otra computadora
    // entre nuestra lectura y nuestra escritura). Los dos son «releer y volver a intentar».
    if (respuesta.status === 409 || (respuesta.status === 422 && shaPrevio === null)) {
      await respuesta.text().catch(() => '')
      throw new ErrorDeConflicto()
    }
    if (!respuesta.ok) throw await this.errorDe(respuesta, 'guardar usuarios.json')
    const datos = (await respuesta.json()) as { content?: { sha?: string } }
    const sha = datos.content?.sha
    if (typeof sha !== 'string') throw new ErrorDelAlmacen('GitHub guardó usuarios.json pero no devolvió el sha nuevo.', respuesta.status)
    // La próxima lectura va a pedir con el ETag viejo y GitHub va a devolver el contenido nuevo entero.
    this.cache = null
    return sha
  }
}
