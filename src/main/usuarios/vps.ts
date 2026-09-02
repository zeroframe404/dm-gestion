// La base de usuarios en el VPS de la agencia, con la misma interfaz que tenía la de GitHub.
//
// Por qué se mudó. El archivo de usuarios vivía en un repositorio privado de GitHub, y para llegar a
// él cada computadora llevaba embebido en el .exe un token con permiso de ESCRITURA sobre ese
// repositorio (ver github.ts). Andaba, pero repartía una credencial de GitHub por máquina para leer
// un archivo que desde la v12 podía viajar por el puente que ya lleva el GENERAL DE CLIENTES entero.
// Cinco computadoras con un token de escritura es una superficie que no hacía falta tener.
//
// Qué cambia y qué no. Nada del servicio de usuarios: `AlmacenRemoto` es la misma interfaz, con el
// mismo candado optimista. Lo único que cambia es de dónde sale el documento y qué significa el
// `sha`: en GitHub era el hash del blob, acá es el número de versión que devuelve el servidor. Para
// el programa es igual de opaco.
//
// La mudanza de los datos. La primera computadora que abre el programa después de esta versión
// encuentra el VPS sin documento; si todavía hay un almacén de GitHub configurado, lo lee y lo sube
// tal cual. De ahí en más el VPS es el que manda y GitHub no se vuelve a tocar. Es automático a
// propósito: pedirle a alguien que apriete un botón de migración es pedirle que se acuerde de hacerlo
// antes de que alguien más intente ingresar.
import { esFallaDeRed } from '../servicios/red'
import { ErrorDeConflicto, ErrorDelAlmacen, type AlmacenRemoto, type LecturaRemota } from './almacen'

/** Un ingreso no puede quedarse colgado: pasado este tiempo se considera que no hay internet. */
export const TIEMPO_MAXIMO_LECTURA_MS = 8_000
/** Reintentar una escritura no es gratis (puede haber quedado aplicada): se le da más margen. */
export const TIEMPO_MAXIMO_ESCRITURA_MS = 15_000

export interface OpcionesAlmacenVps {
  urlBase: string
  token: string
  /**
   * De dónde copiar el documento la primera vez, si el VPS todavía no tiene ninguno. Es el almacén de
   * GitHub durante la mudanza; una vez que el servidor tiene el documento no se vuelve a mirar.
   */
  semilla?: AlmacenRemoto | null
  /** Para anotar en el registro qué se hizo con la semilla. */
  registrar?: (mensaje: string) => void
  tiempoMaximoLecturaMs?: number
  tiempoMaximoEscrituraMs?: number
}

interface RespuestaDelServidor {
  status: number
  json: unknown
}

function mensajeDelServidor(json: unknown, porDefecto: string): string {
  if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
    return (json as { error: string }).error
  }
  return porDefecto
}

export class AlmacenVps implements AlmacenRemoto {
  readonly descripcion: string
  private readonly urlBase: string
  private readonly token: string
  private readonly semilla: AlmacenRemoto | null
  private readonly registrar: (mensaje: string) => void
  private readonly tiempoLecturaMs: number
  private readonly tiempoEscrituraMs: number
  /** La mudanza se intenta una sola vez por arranque: si falló, no tiene sentido reintentarla en bucle. */
  private semillaIntentada = false

  constructor(opciones: OpcionesAlmacenVps) {
    this.urlBase = opciones.urlBase.replace(/\/+$/, '')
    this.token = opciones.token
    this.semilla = opciones.semilla ?? null
    this.registrar = opciones.registrar ?? ((mensaje) => console.log(mensaje))
    this.tiempoLecturaMs = opciones.tiempoMaximoLecturaMs ?? TIEMPO_MAXIMO_LECTURA_MS
    this.tiempoEscrituraMs = opciones.tiempoMaximoEscrituraMs ?? TIEMPO_MAXIMO_ESCRITURA_MS
    // Igual que la fuente de la base: el token viaja como Bearer, así que por http plano sólo contra
    // esta misma máquina (el simulador de las pruebas).
    if (!/^https:/i.test(this.urlBase) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(this.urlBase)) {
      throw new Error(`La URL de la base de usuarios del VPS tiene que ser https (o http://127.0.0.1 para pruebas): ${this.urlBase}`)
    }
    this.descripcion = `VPS ${this.urlBase.replace(/^https?:\/\//i, '')}`
  }

  /** El token del puente no vence: no hay nada que avisar en la pantalla de Usuarios. */
  vencimientoDelToken(): string | null {
    return null
  }

  private async pedir(metodo: 'GET' | 'POST', ruta: string, cuerpo: unknown, tiempoMs: number): Promise<RespuestaDelServidor> {
    const bruta = await fetch(this.urlBase + ruta, {
      method: metodo,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(tiempoMs),
    })
    let json: unknown = null
    try {
      json = await bruta.json()
    } catch (errorDeCuerpo) {
      // Una respuesta buena con el cuerpo ilegible es una conexión cortada a la mitad. Se trata como
      // falla de red y no como éxito con null: el servicio la lee como «sin internet» y no toca nada.
      if (bruta.ok) {
        const corte = new Error(
          `La respuesta del VPS se cortó a la mitad: ${errorDeCuerpo instanceof Error ? errorDeCuerpo.message : errorDeCuerpo}`,
        ) as Error & { code?: string }
        corte.code = 'ECONNRESET'
        throw corte
      }
    }
    return { status: bruta.status, json }
  }

  /** Traduce lo que responde el servidor a los errores que el servicio de usuarios sabe manejar. */
  private errorDe(respuesta: RespuestaDelServidor, accion: string): ErrorDelAlmacen {
    const detalle = mensajeDelServidor(respuesta.json, `error ${respuesta.status}`)
    if (respuesta.status === 401) {
      return new ErrorDelAlmacen(
        'El servidor del VPS rechazó el token de DM Gestión al pedir la base de usuarios. El token del programa y el DMG_SYNC_TOKEN del servidor tienen que ser el mismo: actualizá la aplicación o corregí el .env del VPS.',
        401,
      )
    }
    if (respuesta.status === 503) {
      // Falta DMG_SYNC_TOKEN en el servidor. No es temporal: reintentar no lo arregla, y tratarlo como
      // «sin internet» escondería el único mensaje que dice qué hay que hacer.
      return new ErrorDelAlmacen(detalle, 503)
    }
    if (respuesta.status === 429 || respuesta.status >= 500) {
      return new ErrorDelAlmacen(`El servidor del VPS no está respondiendo bien (HTTP ${respuesta.status}). Probá en unos minutos.`, respuesta.status, true)
    }
    return new ErrorDelAlmacen(`El servidor del VPS devolvió ${respuesta.status} al ${accion}: ${detalle}`, respuesta.status)
  }

  async leer(): Promise<LecturaRemota | null> {
    const respuesta = await this.pedir('GET', '/api/dmg/usuarios', undefined, this.tiempoLecturaMs)
    if (respuesta.status < 200 || respuesta.status >= 300) throw this.errorDe(respuesta, 'leer la base de usuarios')
    const documento = (respuesta.json as { documento?: { texto?: unknown; sha?: unknown } | null } | null)?.documento
    if (documento && typeof documento.texto === 'string' && typeof documento.sha === 'string') {
      return { texto: documento.texto, sha: documento.sha }
    }
    // El servidor no tiene documento. Puede ser una agencia que todavía no inicializó la base (y ahí
    // «no hay archivo» es la respuesta correcta) o una que lo tenía en GitHub: eso lo decide la semilla.
    return await this.mudarDesdeLaSemilla()
  }

  /**
   * La mudanza de GitHub al VPS, una sola vez.
   *
   * Se hace acá adentro y no en un botón porque el momento en que hace falta es exactamente éste: la
   * primera lectura después de actualizar, cuando alguien está en la pantalla de ingreso. Si algo sale
   * mal se anota y se devuelve «no hay documento», que es lo mismo que habría pasado sin la mudanza:
   * nadie queda sin poder trabajar por esto.
   */
  private async mudarDesdeLaSemilla(): Promise<LecturaRemota | null> {
    if (!this.semilla || this.semillaIntentada) return null
    this.semillaIntentada = true
    let deGitHub: LecturaRemota | null
    try {
      deGitHub = await this.semilla.leer()
    } catch (error) {
      // Sin internet no hay nada que mudar y tampoco hay que gritar: la próxima vez que abra el
      // programa se vuelve a intentar. Cualquier otro error sí queda anotado.
      if (!esFallaDeRed(error)) {
        this.registrar(`[usuarios] No se pudo leer ${this.semilla.descripcion} para mudar la base al VPS: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.semillaIntentada = false
      return null
    }
    if (!deGitHub) return null

    try {
      const sha = await this.escribir(deGitHub.texto, null, 'Usuarios: mudanza de la base de GitHub al VPS')
      this.registrar(`[usuarios] La base de usuarios se mudó de ${this.semilla.descripcion} al VPS. Desde ahora manda el VPS.`)
      return { texto: deGitHub.texto, sha }
    } catch (error) {
      // Otra computadora la mudó en este mismo momento: no es un problema, es la carrera esperada.
      if (error instanceof ErrorDeConflicto) return await this.leer()
      this.registrar(`[usuarios] No se pudo subir la base al VPS durante la mudanza: ${error instanceof Error ? error.message : String(error)}`)
      this.semillaIntentada = false
      return null
    }
  }

  async escribir(texto: string, shaPrevio: string | null, mensaje: string): Promise<string> {
    const respuesta = await this.pedir(
      'POST',
      '/api/dmg/usuarios',
      // `actualizadoPor` no se manda aparte: el mensaje ya dice quién y desde qué computadora, con el
      // mismo texto que antes iba al mensaje del commit de GitHub.
      { texto, shaPrevio, mensaje },
      this.tiempoEscrituraMs,
    )
    if (respuesta.status === 409) throw new ErrorDeConflicto()
    if (respuesta.status < 200 || respuesta.status >= 300) throw this.errorDe(respuesta, 'guardar la base de usuarios')
    const sha = (respuesta.json as { sha?: unknown } | null)?.sha
    if (typeof sha !== 'string') {
      throw new ErrorDelAlmacen('El servidor del VPS guardó la base de usuarios pero no devolvió la versión nueva.', respuesta.status)
    }
    return sha
  }
}
