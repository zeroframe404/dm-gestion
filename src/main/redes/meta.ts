// El login de Facebook: lo único de todo el programa que todavía habla directo con Meta.
//
// Desde que las cuentas quedaron por sucursal y centralizadas en el servidor, publicar (y, más
// adelante, comentarios y mensajes) lo hace el VPS — ver `server/src/modules/redes-sociales/` en
// Seguros_Daniel_Martinez. Acá queda sólo el primer tramo: abrir el ingreso de Facebook, cambiar el
// código por un token y listar las Páginas que esa persona administra. El SUPER_ADMIN elige una y
// `servicios/redes.ts` manda el token elegido al servidor una única vez — de ahí en más esta
// computadora no lo vuelve a ver.
//
// Sin librerías, con `fetch`, igual que `usuarios/github.ts`. Toda URL y la versión de la API viven
// acá para que subir de versión sea tocar una constante y no buscar cadenas por todo el proyecto.
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
