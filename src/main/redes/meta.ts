// El cliente de la Graph API de Meta: lo único de todo el programa que habla con Facebook.
//
// Sin librerías, con `fetch`, igual que `usuarios/github.ts`. Toda URL y la versión de la API viven
// acá para que subir de versión sea tocar una constante y no buscar cadenas por todo el proyecto.
//
// Regla que atraviesa el archivo: un error que vuelve de Meta se muestra con su código y su mensaje
// recortado, NUNCA con la URL ni con el token. Una URL de la Graph API lleva el `access_token` en la
// query, y un error copiado a un chat de WhatsApp para pedir ayuda regalaría la cuenta de la agencia.
import { esFallaDeRed } from '../servicios/red'

export const VERSION_GRAPH = 'v23.0'
export const BASE_GRAPH = `https://graph.facebook.com/${VERSION_GRAPH}`
export const BASE_LOGIN = `https://www.facebook.com/${VERSION_GRAPH}/dialog/oauth`

/**
 * Los permisos que hay que pedirle a la persona al vincular.
 *
 * Los cuatro últimos requieren Revisión de la app en developers.facebook.com para que los use alguien
 * que no tenga un rol en la app. Mientras la app esté en modo Desarrollo funcionan sólo para quienes
 * figuren ahí como Administrador, Desarrollador o Tester. Está dicho en la pantalla y en la ayuda a
 * propósito: es el motivo número uno por el que «no aparece ninguna página».
 */
export const PERMISOS_DE_META = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
] as const

/** Una Página de Facebook de la agencia, con su token y su Instagram si tiene uno vinculado. */
export interface PaginaConToken {
  id: string
  nombre: string
  token: string
  instagramId: string | null
  instagramUsuario: string | null
}

/** Meta contesta con 200 y un `error` adentro más seguido de lo que uno esperaría. */
interface ErrorDeMeta {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  error_user_msg?: string
}

export class ErrorDeMetaApi extends Error {
  constructor(
    mensaje: string,
    readonly codigo: number | null,
    readonly subcodigo: number | null,
  ) {
    super(mensaje)
    this.name = 'ErrorDeMetaApi'
  }
}

/**
 * true cuando Meta dice que el token ya no vale. El de Página no vence por tiempo, pero se cae si la
 * persona cambió la contraseña de Facebook, le sacó la app o perdió el rol de administrador de la
 * Página. Hay que distinguirlo de un error cualquiera: la salida es volver a vincular, no reintentar.
 */
export function esTokenRechazado(error: unknown): boolean {
  return error instanceof ErrorDeMetaApi && (error.codigo === 190 || error.codigo === 102 || error.codigo === 10)
}

/** Cuánto se espera a Meta antes de dar por perdida la llamada. */
const ESPERA_MAXIMA_MS = 60_000

function mensajeDelError(error: ErrorDeMeta | undefined, estado: number): string {
  const dicho = error?.error_user_msg?.trim() || error?.message?.trim()
  if (dicho) return dicho.length > 300 ? `${dicho.slice(0, 300)}…` : dicho
  return `Facebook respondió ${estado} sin explicar el motivo.`
}

async function interpretar(respuesta: Response): Promise<unknown> {
  const texto = await respuesta.text()
  let cuerpo: unknown = null
  try {
    cuerpo = texto ? JSON.parse(texto) : null
  } catch {
    cuerpo = null
  }
  const error = (cuerpo as { error?: ErrorDeMeta } | null)?.error
  if (!respuesta.ok || error) {
    throw new ErrorDeMetaApi(mensajeDelError(error, respuesta.status), error?.code ?? null, error?.error_subcode ?? null)
  }
  return cuerpo
}

async function llamar(url: string, opciones?: RequestInit): Promise<unknown> {
  const cortar = AbortSignal.timeout(ESPERA_MAXIMA_MS)
  try {
    return await interpretar(await fetch(url, { ...opciones, signal: cortar }))
  } catch (error) {
    if (error instanceof ErrorDeMetaApi) throw error
    if (esFallaDeRed(error)) throw new ErrorDeMetaApi('No se pudo conectar con Facebook. Fijate si hay internet y probá de nuevo.', null, null)
    throw error
  }
}

function consulta(parametros: Record<string, string>): string {
  return new URLSearchParams(parametros).toString()
}

// ---------------------------------------------------------------------------
// El baile de OAuth
// ---------------------------------------------------------------------------

/**
 * La dirección del diálogo de Facebook Login. `estado` es el valor al azar que después se compara al
 * volver: sin eso, cualquier redirección a la misma URL pasaría por buena.
 */
export function urlDeAutorizacion(appId: string, urlDeRedireccion: string, estado: string): string {
  return `${BASE_LOGIN}?${consulta({
    client_id: appId,
    redirect_uri: urlDeRedireccion,
    state: estado,
    response_type: 'code',
    scope: PERMISOS_DE_META.join(','),
  })}`
}

/** El código que vuelve del diálogo, cambiado por un token de usuario (dura unas dos horas). */
export async function tokenDesdeElCodigo(
  appId: string,
  appSecret: string,
  urlDeRedireccion: string,
  codigo: string,
): Promise<string> {
  const cuerpo = (await llamar(
    `${BASE_GRAPH}/oauth/access_token?${consulta({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: urlDeRedireccion,
      code: codigo,
    })}`,
  )) as { access_token?: string }
  if (!cuerpo?.access_token) throw new ErrorDeMetaApi('Facebook no devolvió el permiso de acceso.', null, null)
  return cuerpo.access_token
}

/**
 * El token corto, estirado a uno de sesenta días. Importa: el token de PÁGINA que se saca de uno
 * largo no vence, y el que se saca de uno corto sí. Saltearse este paso haría que la vinculación se
 * caiga sola a las dos horas.
 */
export async function tokenDeLargaDuracion(appId: string, appSecret: string, tokenCorto: string): Promise<string> {
  const cuerpo = (await llamar(
    `${BASE_GRAPH}/oauth/access_token?${consulta({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: tokenCorto,
    })}`,
  )) as { access_token?: string }
  if (!cuerpo?.access_token) throw new ErrorDeMetaApi('Facebook no devolvió el permiso de acceso de larga duración.', null, null)
  return cuerpo.access_token
}

/**
 * Las Páginas que administra la persona, con el token de cada una y su Instagram Business si lo
 * tiene. Una lista vacía casi siempre quiere decir que la app está en modo Desarrollo y esa persona
 * no figura con un rol en developers.facebook.com; la pantalla lo dice con esas palabras.
 */
export async function paginasDelUsuario(tokenDeUsuario: string): Promise<PaginaConToken[]> {
  const cuerpo = (await llamar(
    `${BASE_GRAPH}/me/accounts?${consulta({
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      limit: '100',
      access_token: tokenDeUsuario,
    })}`,
  )) as {
    data?: Array<{
      id?: string
      name?: string
      access_token?: string
      instagram_business_account?: { id?: string; username?: string }
    }>
  }
  return (cuerpo?.data ?? [])
    .filter((pagina): pagina is { id: string; name: string; access_token: string; instagram_business_account?: { id?: string; username?: string } } =>
      Boolean(pagina.id && pagina.access_token),
    )
    .map((pagina) => ({
      id: pagina.id,
      nombre: pagina.name || `Página ${pagina.id}`,
      token: pagina.access_token,
      instagramId: pagina.instagram_business_account?.id ?? null,
      instagramUsuario: pagina.instagram_business_account?.username ?? null,
    }))
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

/** Sólo texto, sin imagen: va al muro de la Página. Devuelve el id del posteo. */
export async function publicarTextoEnLaPagina(paginaId: string, token: string, texto: string): Promise<string> {
  const cuerpo = (await llamar(`${BASE_GRAPH}/${paginaId}/feed`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: consulta({ message: texto, access_token: token }),
  })) as { id?: string }
  if (!cuerpo?.id) throw new ErrorDeMetaApi('Facebook aceptó el posteo pero no dijo cuál es.', null, null)
  return cuerpo.id
}

/**
 * Sube una foto a la Página. Con `publicada` en false queda cargada pero NO sale en la Página: así se
 * usa para Instagram, que necesita una URL pública de la imagen y no acepta el archivo directo.
 */
export async function subirFotoALaPagina(
  paginaId: string,
  token: string,
  imagen: Buffer,
  nombreDelArchivo: string,
  tipo: string,
  texto: string,
  publicada: boolean,
): Promise<{ fotoId: string; postId: string | null }> {
  const formulario = new FormData()
  formulario.append('access_token', token)
  formulario.append('published', publicada ? 'true' : 'false')
  if (texto) formulario.append(publicada ? 'caption' : 'message', texto)
  formulario.append('source', new Blob([new Uint8Array(imagen)], { type: tipo }), nombreDelArchivo)

  const cuerpo = (await llamar(`${BASE_GRAPH}/${paginaId}/photos`, { method: 'POST', body: formulario })) as {
    id?: string
    post_id?: string
  }
  if (!cuerpo?.id) throw new ErrorDeMetaApi('Facebook no devolvió la foto que se subió.', null, null)
  return { fotoId: cuerpo.id, postId: cuerpo.post_id ?? null }
}

/**
 * La URL pública de una foto ya subida, para dársela a Instagram.
 *
 * Es la parte más frágil de todo esto y conviene tenerlo escrito: Instagram NO acepta el binario. Su
 * endpoint sólo toma `image_url` y es Meta quien baja el archivo desde sus propios servidores, así que
 * hace falta una dirección que Meta pueda leer. La que se usa es la del CDN de la foto que se acaba de
 * subir a la Página sin publicar: no agrega credenciales, no necesita un servidor de la agencia y no
 * deja nada visible en Facebook. Si algún día Meta deja de servirlas, el plan B es el campo «URL de la
 * imagen» que la pantalla ya permite escribir a mano.
 */
export async function urlPublicaDeLaFoto(fotoId: string, token: string): Promise<string> {
  const cuerpo = (await llamar(`${BASE_GRAPH}/${fotoId}?${consulta({ fields: 'images', access_token: token })}`)) as {
    images?: Array<{ source?: string; width?: number }>
  }
  // La primera es la más grande; Instagram achica sola si hace falta.
  const fuente = (cuerpo?.images ?? []).find((imagen) => typeof imagen.source === 'string')?.source
  if (!fuente) throw new ErrorDeMetaApi('No se pudo obtener la dirección de la imagen para Instagram.', null, null)
  return fuente
}

/** Borra la foto intermedia que se usó para llegar a Instagram. Que falle no es un problema. */
export async function borrarFotoDeLaPagina(fotoId: string, token: string): Promise<void> {
  try {
    await llamar(`${BASE_GRAPH}/${fotoId}?${consulta({ access_token: token })}`, { method: 'DELETE' })
  } catch (error) {
    console.error('[redes] No se pudo borrar la foto intermedia de la Página:', error instanceof Error ? error.message : error)
  }
}

/** Publicar en Instagram son dos pasos: se arma un contenedor y después se publica. */
export async function publicarEnInstagram(
  instagramId: string,
  token: string,
  urlDeLaImagen: string,
  texto: string,
): Promise<string> {
  const contenedor = (await llamar(`${BASE_GRAPH}/${instagramId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: consulta({ image_url: urlDeLaImagen, caption: texto, access_token: token }),
  })) as { id?: string }
  if (!contenedor?.id) throw new ErrorDeMetaApi('Instagram no aceptó la imagen.', null, null)

  const publicado = (await llamar(`${BASE_GRAPH}/${instagramId}/media_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: consulta({ creation_id: contenedor.id, access_token: token }),
  })) as { id?: string }
  if (!publicado?.id) throw new ErrorDeMetaApi('Instagram no devolvió la publicación.', null, null)
  return publicado.id
}

/**
 * Cuántas publicaciones más admite Instagram en las próximas 24 horas (el tope son 50 por cuenta).
 * Devuelve null si no se pudo averiguar: que esto falle nunca puede impedir publicar.
 */
export async function cuotaDeInstagram(instagramId: string, token: string): Promise<number | null> {
  try {
    const cuerpo = (await llamar(
      `${BASE_GRAPH}/${instagramId}/content_publishing_limit?${consulta({ fields: 'quota_usage', access_token: token })}`,
    )) as { data?: Array<{ quota_usage?: number }> }
    const usadas = cuerpo?.data?.[0]?.quota_usage
    return typeof usadas === 'number' ? Math.max(0, 50 - usadas) : null
  } catch {
    return null
  }
}
