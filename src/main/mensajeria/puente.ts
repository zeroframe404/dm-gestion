// El cliente de `/api/dmg/mensajes`: lo único de la aplicación que le habla al servidor de mensajes.
//
// Está aparte de `FuenteVps` a propósito. `FuenteVps` implementa la interfaz `FuenteHoja` —pestañas,
// filas, celdas— y su régimen de reintentos y de tiempos está pensado para una tanda de
// sincronización de 64 MB. La mensajería no es una grilla: pide poco, pide seguido y tiene un pedido
// que se queda ESPERANDO hasta medio minuto a que aparezca algo. Meterla adentro de la otra clase
// habría contaminado las dos.
//
// Cómo llega un mensaje «en el momento» sin websockets: el long-poll de `novedades`. La computadora
// pregunta «¿hay algo para mí?» y el servidor, si no hay nada, NO contesta enseguida: se queda con el
// pedido abierto hasta 25 segundos y contesta apenas aparece algo. Si no aparece nada, contesta vacío
// y la computadora vuelve a preguntar. El resultado se siente instantáneo y no hace falta tocar el
// nginx de la agencia (que ya deja pasar pedidos de hasta 300 segundos), ni abrir un puerto, ni pelear
// con los antivirus de las cinco máquinas, que es lo que suele pasar con un websocket.
import type { Rol, TipoDeMensaje } from '../../shared/tipos'
import { ErrorDeNegocio } from '../servicios/errores'
import { credencialesDelPuente } from '../servicios/sincronizacion'
// El mismo tipo que viaja por el canal en vivo (14.0): una reacción llega por los dos caminos —en el
// mensaje que baja el cartero y en el frame `{t:'reaccion'}`— y tiene que significar lo mismo en los dos.
import type { ReaccionRemota } from '../vivo/protocolo'

/** Un pedido normal: si el servidor tarda más que esto, algo está mal. */
const TIEMPO_MAXIMO_MS = 30_000
/**
 * Cuánto se le pide al servidor que espere antes de contestar vacío. Menos que el tiempo de la
 * conexión de abajo, para que corte siempre el servidor y no el cliente.
 */
export const ESPERA_DEL_LONG_POLL_SEGUNDOS = 25
/** El tope del long-poll: la espera que pidió más un margen para el viaje de ida y vuelta. */
const TIEMPO_MAXIMO_DEL_LONG_POLL_MS = (ESPERA_DEL_LONG_POLL_SEGUNDOS + 15) * 1000

/** Quién dice ser el que pide. El puente entero comparte un token; esto dice qué persona lo usa. */
export interface ActorDelPuente {
  clave: string
  nombre: string
  rol: Rol
}

export interface AcuseRemoto {
  mensajeId: string
  usuarioClave: string
  entregadoEn: string | null
  leidoEn: string | null
}

export interface AdjuntoRemoto {
  id: string
  nombre: string
  tipo: string
  tamano: number
  sha256: string
  ancho: number | null
  alto: number | null
  duracion: number | null
  /** La miniatura en base64 pelado (sin el `data:image/jpeg;base64,`). */
  miniatura: string | null
}

export interface MensajeRemoto {
  id: string
  /**
   * NORMAL o ZUMBIDO. Viene opcional porque un servidor anterior a la 12.8.1 no lo manda: ahí todo lo
   * que llega es un mensaje común, que es exactamente lo que era. Se resuelve al guardarlo.
   */
  tipo?: TipoDeMensaje
  conversacionId: string
  orden: number
  autorClave: string
  autorNombre: string
  cuerpo: string
  creadoEn: string
  enviadoEn: string | null
  eliminadoEn: string | null
  adjuntos: AdjuntoRemoto[]
  acuses: AcuseRemoto[]
  /**
   * Las reacciones del mensaje, agrupadas por emoji (14.0). Viene opcional porque un servidor anterior
   * no la manda: ahí un mensaje no tiene ninguna, que es exactamente lo que era.
   */
  reacciones?: ReaccionRemota[]
}

export interface ConversacionRemota {
  id: string
  tipo: 'DIRECTA' | 'GRUPO'
  titulo: string | null
  participantes: { clave: string; nombre: string; salioEn: string | null }[]
  creadoPor: string
  creadoEn: string
  ultimoMensajeEn: string | null
}

export interface NovedadesRemotas {
  mensajes: MensajeRemoto[]
  acuses: AcuseRemoto[]
  conversaciones: ConversacionRemota[]
  cursorAcuses: string
}

export interface AdjuntoParaMandar {
  id: string
  nombre: string
  tipo: string
  tamano: number
  sha256: string
  ancho?: number | null
  alto?: number | null
  miniatura?: string | null
}

/**
 * Lo que el servidor contestó con un código HTTP. Igual que `ErrorDelServidorVps`, conserva el
 * `status` porque no es lo mismo un 403 («no participás de esa conversación»: no se arregla
 * reintentando) que un 502 (el servidor: se arregla solo).
 */
export class ErrorDelPuenteDeMensajes extends ErrorDeNegocio {
  readonly status: number

  constructor(mensaje: string, status: number) {
    super(mensaje)
    this.name = 'ErrorDelPuenteDeMensajes'
    this.status = status
  }
}

/** ¿Este error es «no se puede arreglar reintentando»? Con uno de éstos, el mensaje se da por fallado. */
export function esRechazoDefinitivo(error: unknown): boolean {
  if (!(error instanceof ErrorDelPuenteDeMensajes)) return false
  // 408 y 429 son «probá más tarde»; el resto de los 4xx son «así como está, no».
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429
}

function mensajeDelServidor(json: unknown, siNoDice: string): string {
  if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
    return (json as { error: string }).error
  }
  return siNoDice
}

export class PuenteDeMensajes {
  private readonly urlBase: string
  private readonly token: string

  constructor(credenciales: { urlBase: string; token: string }) {
    this.urlBase = credenciales.urlBase.replace(/\/+$/, '')
    this.token = credenciales.token
  }

  private async pedir(
    descripcion: string,
    metodo: 'GET' | 'POST' | 'PUT',
    ruta: string,
    opciones: { cuerpo?: unknown; senal?: AbortSignal; tiempoMaximoMs?: number } = {},
  ): Promise<unknown> {
    const tiempo = opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_MS
    // Dos motivos para cortar: que se acabe el tiempo o que alguien cierre la aplicación / cierre
    // sesión. `AbortSignal.any` los junta; sin el segundo, cerrar el programa se quedaría esperando
    // los 40 segundos del long-poll antes de apagarse.
    const senal = opciones.senal
      ? AbortSignal.any([AbortSignal.timeout(tiempo), opciones.senal])
      : AbortSignal.timeout(tiempo)

    const bruta = await fetch(this.urlBase + ruta, {
      method: metodo,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(opciones.cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      signal: senal,
    })

    let json: unknown = null
    try {
      json = await bruta.json()
    } catch (errorDeCuerpo) {
      // Igual que en FuenteVps: en una respuesta buena, un cuerpo ilegible es una conexión cortada a
      // la mitad. Se trata como falla de red y no como un éxito con null.
      if (bruta.ok) {
        const corte = new Error(
          `La respuesta del servidor de mensajes se cortó a la mitad (${descripcion}): ${
            errorDeCuerpo instanceof Error ? errorDeCuerpo.message : errorDeCuerpo
          }`,
        )
        ;(corte as Error & { code?: string }).code = 'ECONNRESET'
        throw corte
      }
    }

    if (bruta.status >= 200 && bruta.status < 300) return json

    const detalle = mensajeDelServidor(json, `error ${bruta.status}`)
    if (bruta.status === 401) {
      throw new ErrorDelPuenteDeMensajes(
        'El servidor rechazó el token de DM Gestión. El token del programa y el DMG_SYNC_TOKEN del servidor tienen que ser el mismo.',
        401,
      )
    }
    throw new ErrorDelPuenteDeMensajes(`El servidor de mensajes rechazó el pedido (${descripcion}): ${detalle}`, bruta.status)
  }

  private consulta(actor: ActorDelPuente, extra: Record<string, string | number | undefined> = {}): string {
    const parametros = new URLSearchParams({
      actorClave: actor.clave,
      actorNombre: actor.nombre,
      actorRol: actor.rol,
    })
    for (const [clave, valor] of Object.entries(extra)) {
      if (valor !== undefined && valor !== '') parametros.set(clave, String(valor))
    }
    return `?${parametros.toString()}`
  }

  async conversaciones(actor: ActorDelPuente): Promise<ConversacionRemota[]> {
    const respuesta = (await this.pedir('listar las conversaciones', 'GET', `/api/dmg/mensajes/conversaciones${this.consulta(actor)}`)) as {
      conversaciones?: ConversacionRemota[]
    }
    return respuesta?.conversaciones ?? []
  }

  async abrirDirecta(
    actor: ActorDelPuente,
    destino: { clave: string; nombre: string },
    id: string,
  ): Promise<ConversacionRemota> {
    const respuesta = (await this.pedir('abrir la conversación', 'POST', '/api/dmg/mensajes/conversaciones/directa', {
      cuerpo: { actor, clave: destino.clave, nombre: destino.nombre, id },
    })) as { conversacion: ConversacionRemota }
    return respuesta.conversacion
  }

  async crearGrupo(
    actor: ActorDelPuente,
    datos: { titulo: string; participantes: { clave: string; nombre: string }[]; id: string },
  ): Promise<ConversacionRemota> {
    const respuesta = (await this.pedir('crear el grupo', 'POST', '/api/dmg/mensajes/conversaciones/grupo', {
      cuerpo: { actor, ...datos },
    })) as { conversacion: ConversacionRemota }
    return respuesta.conversacion
  }

  /**
   * Manda un mensaje. Es idempotente por el `id`: reintentar uno que se cortó a mitad de camino
   * devuelve el que ya está guardado en vez de escribir otro.
   */
  async enviar(
    actor: ActorDelPuente,
    datos: {
      id: string
      conversacionId: string
      cuerpo: string
      enviadoEn: string
      adjuntos: AdjuntoParaMandar[]
      tipo?: TipoDeMensaje
    },
  ): Promise<{ mensaje: MensajeRemoto; yaEstaba: boolean }> {
    const respuesta = (await this.pedir('mandar el mensaje', 'POST', '/api/dmg/mensajes', {
      cuerpo: { actor, ...datos },
    })) as { mensaje: MensajeRemoto; yaEstaba: boolean }
    return respuesta
  }

  /**
   * Lo que haya para esta persona. Con `esperaSegundos: 0` (14.0) contesta al instante con lo que
   * tenga: es como lo pide el cartero desde que el canal en vivo es el que avisa que hay algo. Con
   * una espera mayor es el long-poll de la 12.8, que se queda con el pedido abierto hasta que aparezca
   * algo; se conserva porque el servidor lo sigue soportando y porque una computadora sin canal (un
   * VPS anterior a la 14.0) tiene que poder volver a ese camino.
   *
   * `senal` NO la pasa nadie hoy (14.0): era la del bucle del cartero, que se disparaba al cerrar
   * sesión para no dejar colgado el long-poll de 25 segundos. Sin bucle y con `espera: 0` no hay nada
   * colgado que cortar. Se conserva el parámetro porque es lo que haría falta para volver al long-poll
   * contra un servidor anterior a la 14.0, que es el otro motivo por el que la espera sigue existiendo.
   */
  async novedades(
    actor: ActorDelPuente,
    opciones: { desdeAcuses: string | null; esperaSegundos: number },
    senal?: AbortSignal,
  ): Promise<NovedadesRemotas> {
    const ruta = `/api/dmg/mensajes/novedades${this.consulta(actor, {
      desdeAcuses: opciones.desdeAcuses ?? undefined,
      espera: opciones.esperaSegundos,
    })}`
    const respuesta = (await this.pedir('preguntar por mensajes nuevos', 'GET', ruta, {
      senal,
      // Sin espera, el pedido es uno más: darle el tope del long-poll sería esperar cuarenta segundos
      // a un servidor que se colgó cuando lo normal es que conteste en el acto.
      tiempoMaximoMs: opciones.esperaSegundos > 0 ? TIEMPO_MAXIMO_DEL_LONG_POLL_MS : TIEMPO_MAXIMO_MS,
    })) as NovedadesRemotas
    return {
      mensajes: respuesta?.mensajes ?? [],
      acuses: respuesta?.acuses ?? [],
      conversaciones: respuesta?.conversaciones ?? [],
      cursorAcuses: respuesta?.cursorAcuses ?? new Date().toISOString(),
    }
  }

  /** Confirmación de llegada: esta computadora bajó y guardó estos mensajes. */
  async avisarEntregados(actor: ActorDelPuente, ids: string[]): Promise<void> {
    if (!ids.length) return
    await this.pedir('confirmar la llegada', 'POST', '/api/dmg/mensajes/entregados', { cuerpo: { actor, ids } })
  }

  /** Confirmación de lectura: esta persona abrió la conversación con estos mensajes a la vista. */
  async avisarLeidos(actor: ActorDelPuente, ids: string[]): Promise<void> {
    if (!ids.length) return
    await this.pedir('confirmar la lectura', 'POST', '/api/dmg/mensajes/leidos', { cuerpo: { actor, ids } })
  }

  async historial(
    actor: ActorDelPuente,
    opciones: { conversacion: string; antesDe?: number; limite?: number },
  ): Promise<{ mensajes: MensajeRemoto[]; hayMas: boolean }> {
    const ruta = `/api/dmg/mensajes/historial${this.consulta(actor, {
      conversacion: opciones.conversacion,
      antesDe: opciones.antesDe,
      limite: opciones.limite,
    })}`
    const respuesta = (await this.pedir('traer los mensajes anteriores', 'GET', ruta)) as {
      mensajes?: MensajeRemoto[]
      hayMas?: boolean
    }
    return { mensajes: respuesta?.mensajes ?? [], hayMas: Boolean(respuesta?.hayMas) }
  }

  async eliminar(actor: ActorDelPuente, id: string): Promise<void> {
    await this.pedir('borrar el mensaje', 'POST', `/api/dmg/mensajes/${id}/eliminar`, { cuerpo: { actor } })
  }

  /**
   * Pone, cambia o saca MI reacción a un mensaje (14.0). Con `emoji: null` —o con el mismo que ya
   * estaba— la saca; con otro, la reemplaza: una persona reacciona UNA vez a cada mensaje.
   *
   * Devuelve la lista COMPLETA del mensaje, no el cambio: dos personas reaccionando en el mismo
   * instante no pueden dejar a nadie con una cuenta a medias. El servidor, además, se lo difunde por el
   * canal a los participantes, así que del otro lado aparece sin que nadie pregunte.
   */
  async reaccionar(
    actor: ActorDelPuente,
    mensajeId: string,
    emoji: string | null,
  ): Promise<{ mensajeId: string; conversacionId: string; reacciones: ReaccionRemota[] }> {
    const respuesta = (await this.pedir('poner la reacción', 'PUT', `/api/dmg/mensajes/${encodeURIComponent(mensajeId)}/reaccion`, {
      cuerpo: { actor, emoji },
    })) as { mensajeId?: string; conversacionId?: string; reacciones?: ReaccionRemota[] }
    return {
      mensajeId: respuesta?.mensajeId ?? mensajeId,
      conversacionId: respuesta?.conversacionId ?? '',
      reacciones: respuesta?.reacciones ?? [],
    }
  }

  /** El registro de todos los mensajes de todos. El servidor lo corta por rol; acá no se decide nada. */
  async log(
    actor: ActorDelPuente,
    filtros: { usuario?: string; desde?: string; hasta?: string; texto?: string; pagina?: number; porPagina?: number },
  ): Promise<{
    renglones: {
      mensaje: MensajeRemoto
      conversacion: { id: string; tipo: 'DIRECTA' | 'GRUPO'; titulo: string | null; participantes: { clave: string; nombre: string }[] }
      eliminadoPor: string | null
    }[]
    total: number
    pagina: number
    porPagina: number
  }> {
    const ruta = `/api/dmg/mensajes/log${this.consulta(actor, {
      usuario: filtros.usuario,
      desde: filtros.desde,
      hasta: filtros.hasta,
      texto: filtros.texto,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
    })}`
    return (await this.pedir('abrir el registro de mensajes', 'GET', ruta)) as Awaited<ReturnType<PuenteDeMensajes['log']>>
  }
}

/**
 * El puente de esta computadora, o null si acá no hay servidor configurado (desarrollo sin simulador,
 * o el banco de pruebas). Sin puente la mensajería sigue abriendo: se ven los mensajes que ya están y
 * lo que se escriba espera en la cola.
 */
export function crearPuenteDeMensajes(): PuenteDeMensajes | null {
  const credenciales = credencialesDelPuente()
  return credenciales ? new PuenteDeMensajes(credenciales) : null
}

/** Para el banco de pruebas: apuntar la mensajería a un puente simulado. */
let puenteDePrueba: PuenteDeMensajes | null = null

export function usarPuenteDeMensajesDePrueba(puente: PuenteDeMensajes | null): void {
  puenteDePrueba = puente
}

export function puenteDeMensajes(): PuenteDeMensajes | null {
  return puenteDePrueba ?? crearPuenteDeMensajes()
}
