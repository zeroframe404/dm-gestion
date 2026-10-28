// Qué canal es ESTE ejecutable (ver `shared/canal.ts`) y lo que cambia por serlo: la carpeta de datos,
// el nombre y de dónde se actualiza.
//
// La beta y la estable conviven en la misma computadora, así que no pueden compartir NADA que escriba el
// programa: ni la base local (una migración de la beta dejaría a la estable con un esquema que no
// conoce), ni el config.json, ni el cerrojo de «una sola instancia», ni la credencial cifrada.
import { app } from 'electron'
import { esVersionBeta, esVersionDemo, nombreDelPrograma, type Canal } from '../shared/canal'

/** Repositorio y Release fijo de donde la beta se actualiza (ver `.github/workflows/publicar-beta.yml`). */
export const URL_DE_ACTUALIZACIONES_BETA = 'https://github.com/zeroframe404/dm-gestion/releases/download/beta-canal'

export function canalActual(): Canal {
  // Afuera de Electron (el banco de pruebas corre en Node pelado) no hay `app`: ahí no hay canal que valga.
  const electron = app as typeof app | undefined
  if (!electron?.getVersion) return 'estable'
  if (esVersionDemo(electron.getVersion())) return 'demo'
  if (esVersionBeta(electron.getVersion())) return 'beta'
  // En desarrollo no hay instalador del que sacar la versión: se pide a mano para probar la beta o la demo.
  if (!electron.isPackaged && process.env.DM_GESTION_CANAL === 'beta') return 'beta'
  if (!electron.isPackaged && process.env.DM_GESTION_CANAL === 'demo') return 'demo'
  return 'estable'
}

export function esBeta(): boolean {
  return canalActual() === 'beta'
}

/**
 * La versión de demostración (ver `main/demo/`): datos ficticios, un servidor simulado adentro del
 * propio programa y las APIs de las compañías respondiendo con cotizaciones inventadas. Nunca habla con
 * el VPS de la agencia, ni con GitHub, ni con ninguna compañía de verdad.
 */
export function esDemo(): boolean {
  return canalActual() === 'demo'
}

export function nombreActual(): string {
  return nombreDelPrograma(canalActual())
}
