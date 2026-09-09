// El cliente del aviso en vivo: lo único de la aplicación que le pregunta al servidor «¿cambió algo
// en la hoja?».
//
// Está aparte de `FuenteVps` por la misma razón que el puente de mensajes: `FuenteVps` implementa la
// interfaz `FuenteHoja` —pestañas, filas, celdas— y su régimen de tiempos está pensado para una tanda
// de sincronización de 64 MB (90 segundos de tope, cinco reintentos con espera exponencial). Esto
// pide poquísimo, pide seguido, y tiene un pedido que se queda ESPERANDO hasta medio minuto. Y sobre
// todo: necesita poder cortarse desde afuera, porque si no cerrar el programa esperaría los 25
// segundos del pedido abierto antes de apagarse.
//
// Cómo se entera de un cambio «en el momento» sin websockets: el long-poll. La computadora manda el
// mapa `{pestaña: versión}` que conoce y el servidor, si no cambió nada, NO contesta enseguida: se
// queda con el pedido abierto y contesta apenas alguien escribe. Si no aparece nada, contesta con lo
// mismo y la computadora vuelve a preguntar. El nginx de la agencia ya deja pasar pedidos de hasta
// 300 segundos, así que no hay nada que configurar, ni puerto que abrir, ni pelea con los antivirus
// de las cinco máquinas.
import { ErrorDeNegocio } from '../servicios/errores'
import { credencialesDelPuente } from '../servicios/sincronizacion'

/** Cuánto se le pide al servidor que espere antes de contestar sin novedades. */
export const ESPERA_DEL_VIGIA_SEGUNDOS = 25
/** El tope del long-poll: la espera que pidió más un margen para el viaje de ida y vuelta. */
const TIEMPO_MAXIMO_DEL_LONG_POLL_MS = (ESPERA_DEL_VIGIA_SEGUNDOS + 15) * 1000

export interface NovedadesDeLaGrilla {
  generacion: number
  versiones: Record<string, number>
  cambiaron: string[]
  /**
   * Las métricas que el servidor sabe calcular, con su versión actual: `{"podio": 3}`. Un servidor
   * anterior a esto no manda la clave y queda vacío, que es lo mismo que decir «nada para traer»: el
   * vigía (ver vigia.ts) compara cada versión contra la que ya tiene guardada, y ausente o sin cambios
   * es lo mismo, nada nuevo para esa métrica.
   */
  metricasVersiones: Record<string, number>
}

/**
 * Lo que el servidor contestó con un código HTTP. Conserva el `status` porque el vigía necesita
 * distinguir un 404 —«este servidor todavía no sabe avisar», que no se arregla reintentando— de un
 * 502, que se arregla solo.
 */
export class ErrorDelPuenteDeGrilla extends ErrorDeNegocio {
  readonly status: number

  constructor(mensaje: string, status: number) {
    super(mensaje)
    this.name = 'ErrorDelPuenteDeGrilla'
    this.status = status
  }
}

/** ¿El servidor es de antes del aviso en vivo? Entonces no hay nada que reintentar por ahora. */
export function esServidorSinAviso(error: unknown): boolean {
  if (!(error instanceof ErrorDelPuenteDeGrilla)) return false
  return error.status === 404 || error.status === 501
}

function mensajeDelServidor(json: unknown, siNoDice: string): string {
  if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
    return (json as { error: string }).error
  }
  return siNoDice
}

/** Un mapa `{clave: versión}`, quedándose sólo con las entradas que de verdad son un número. */
function mapaDeVersiones(valor: unknown): Record<string, number> {
  const mapa: Record<string, number> = {}
  if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
    for (const [clave, version] of Object.entries(valor as Record<string, unknown>)) {
      if (typeof version === 'number' && Number.isFinite(version)) mapa[clave] = version
    }
  }
  return mapa
}

/** Lo que llegó, quedándose sólo con lo que tiene la forma esperada. */
function novedadesDeLaRespuesta(json: unknown): NovedadesDeLaGrilla {
  const cuerpo = (json ?? {}) as {
    generacion?: unknown
    versiones?: unknown
    cambiaron?: unknown
    metricasVersiones?: unknown
  }
  return {
    generacion: typeof cuerpo.generacion === 'number' ? cuerpo.generacion : 1,
    versiones: mapaDeVersiones(cuerpo.versiones),
    cambiaron: Array.isArray(cuerpo.cambiaron) ? cuerpo.cambiaron.filter((t): t is string => typeof t === 'string') : [],
    metricasVersiones: mapaDeVersiones(cuerpo.metricasVersiones),
  }
}

export class PuenteDeGrilla {
  private readonly urlBase: string
  private readonly token: string

  constructor(credenciales: { urlBase: string; token: string }) {
    this.urlBase = credenciales.urlBase.replace(/\/+$/, '')
    this.token = credenciales.token
  }

  /**
   * Pregunta qué cambió, esperando hasta `esperaSegundos` si por ahora no cambió nada.
   *
   * `senal` es la de cerrar sesión o cerrar el programa: sin ella, apagar la aplicación se quedaría
   * esperando a que el servidor conteste.
   */
  async novedades(
    versiones: Record<string, number>,
    generacion: number | null,
    esperaSegundos: number,
    senal?: AbortSignal,
  ): Promise<NovedadesDeLaGrilla> {
    // Dos motivos para cortar: que se acabe el tiempo o que alguien cierre la aplicación.
    const corte = senal
      ? AbortSignal.any([AbortSignal.timeout(TIEMPO_MAXIMO_DEL_LONG_POLL_MS), senal])
      : AbortSignal.timeout(TIEMPO_MAXIMO_DEL_LONG_POLL_MS)

    const bruta = await fetch(this.urlBase + '/api/dmg/novedades', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ versiones, generacion, espera: esperaSegundos }),
      signal: corte,
    })

    let json: unknown = null
    try {
      json = await bruta.json()
    } catch (errorDeCuerpo) {
      // Igual que en FuenteVps y en el puente de mensajes: en una respuesta buena, un cuerpo ilegible
      // es una conexión que se cortó a la mitad. Se trata como falla de red, no como un éxito vacío.
      if (bruta.ok) {
        const cortada = new Error(
          `La respuesta del aviso en vivo se cortó a la mitad: ${
            errorDeCuerpo instanceof Error ? errorDeCuerpo.message : errorDeCuerpo
          }`,
        )
        ;(cortada as Error & { code?: string }).code = 'ECONNRESET'
        throw cortada
      }
    }

    if (bruta.status >= 200 && bruta.status < 300) return novedadesDeLaRespuesta(json)

    if (bruta.status === 401) {
      throw new ErrorDelPuenteDeGrilla(
        'El servidor rechazó el token de DM Gestión. El token del programa y el DMG_SYNC_TOKEN del servidor tienen que ser el mismo.',
        401,
      )
    }
    throw new ErrorDelPuenteDeGrilla(
      `El servidor rechazó el pedido del aviso en vivo: ${mensajeDelServidor(json, `error ${bruta.status}`)}`,
      bruta.status,
    )
  }
}

let puenteDePrueba: PuenteDeGrilla | null = null

/** El banco de pruebas pone acá un puente contra el simulador. */
export function usarPuenteDeGrillaDePrueba(puente: PuenteDeGrilla | null): void {
  puenteDePrueba = puente
}

export function puenteDeGrilla(): PuenteDeGrilla | null {
  if (puenteDePrueba) return puenteDePrueba
  const credenciales = credencialesDelPuente()
  return credenciales ? new PuenteDeGrilla(credenciales) : null
}
