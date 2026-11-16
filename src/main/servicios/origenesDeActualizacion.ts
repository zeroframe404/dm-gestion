// De dónde se baja cada canal, en orden (punto 8): primero el servidor de la agencia, después GitHub.
//
// Hasta la 18.1.2 las actualizaciones salían sólo de GitHub. Ahora el workflow de publicación sube lo
// mismo también al VPS (`/api/dmg-actualizaciones/<canal>/`, ver el módulo `actualizaciones` del repo
// web) y el programa lo busca ahí primero. GitHub se sigue publicando igual y es el respaldo: si el
// servidor no contesta, o todavía no tiene nada (antes de desplegarlo, o si la subida falló), el
// chequeo se repite en el acto contra GitHub, como siempre.
//
// Sin imports de Electron a propósito: es lo que prueba `pruebas/canal-beta.prueba.ts`.

/** El servidor que publica DM Gestión. Fijo: no es el de cada agencia, es el de quien hace el programa. */
export const URL_DEL_SERVIDOR_DE_ACTUALIZACIONES = 'https://dmartinezseguros.com/api/dmg-actualizaciones'

/** Repositorio y Release fijo de donde la beta se actualiza desde GitHub (ver `.github/workflows/publicar-beta.yml`). */
export const URL_DE_ACTUALIZACIONES_BETA = 'https://github.com/zeroframe404/dm-gestion/releases/download/beta-canal'

export type OrigenDeActualizacion = 'servidor' | 'github'

export type FeedDeActualizacion =
  | { provider: 'generic'; url: string; channel?: string }
  | { provider: 'github'; owner: string; repo: string }

export interface OpcionDeActualizacion {
  origen: OrigenDeActualizacion
  feed: FeedDeActualizacion
  /** El canal de electron-updater (`beta` lee `beta.yml`); sin canal lee `latest.yml`. */
  canal: 'beta' | null
}

export function origenesDeActualizacion(canal: 'estable' | 'beta'): OpcionDeActualizacion[] {
  if (canal === 'beta') {
    return [
      { origen: 'servidor', feed: { provider: 'generic', url: `${URL_DEL_SERVIDOR_DE_ACTUALIZACIONES}/beta`, channel: 'beta' }, canal: 'beta' },
      { origen: 'github', feed: { provider: 'generic', url: URL_DE_ACTUALIZACIONES_BETA, channel: 'beta' }, canal: 'beta' },
    ]
  }
  return [
    { origen: 'servidor', feed: { provider: 'generic', url: `${URL_DEL_SERVIDOR_DE_ACTUALIZACIONES}/estable` }, canal: null },
    // El repositorio es PÚBLICO: los Releases se leen sin credenciales y no va ningún token (ver updater.ts).
    { origen: 'github', feed: { provider: 'github', owner: 'zeroframe404', repo: 'dm-gestion' }, canal: null },
  ]
}
