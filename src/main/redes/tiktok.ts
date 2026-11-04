// El ingreso de TikTok: lo único de TikTok que pasa por esta computadora.
//
// Igual que con Facebook (`redes/meta.ts`), publicar lo hace el VPS — ver
// `server/src/modules/redes-sociales/tiktok.*.ts` en Seguros_Daniel_Martinez. Acá queda sólo abrir el
// ingreso de TikTok en su ventana y traer el código de autorización; el servidor lo canjea con el
// Client Secret de la sucursal, que nunca baja a esta computadora.
import type { BrowserWindow } from 'electron'
import { pedirCodigoDeAutorizacion } from './oauth'

export const URL_DE_AUTORIZACION_DE_TIKTOK = 'https://www.tiktok.com/v2/auth/authorize/'

/**
 * Los permisos que se piden. `video.publish` es «publicar directo» (Content Posting API → Direct
 * Post): hay que agregar ese producto en developers.tiktok.com, y mientras la app no pase la revisión
 * de TikTok todo lo que publique sale en privado.
 */
export const PERMISOS_DE_TIKTOK = ['user.info.basic', 'video.publish'] as const

export function urlDeAutorizacionDeTikTok(clientKey: string, urlDeRedireccion: string, estado: string): string {
  return `${URL_DE_AUTORIZACION_DE_TIKTOK}?${new URLSearchParams({
    client_key: clientKey,
    scope: PERMISOS_DE_TIKTOK.join(','),
    response_type: 'code',
    redirect_uri: urlDeRedireccion,
    state: estado,
  }).toString()}`
}

export function pedirCodigoDeTikTok(clientKey: string, urlDeRedireccion: string, padre: BrowserWindow | null): Promise<string> {
  return pedirCodigoDeAutorizacion({
    urlDelIngreso: (estado) => urlDeAutorizacionDeTikTok(clientKey, urlDeRedireccion, estado),
    urlDeRedireccion,
    red: 'TikTok',
    particion: 'tiktok-login',
    padre,
  })
}
