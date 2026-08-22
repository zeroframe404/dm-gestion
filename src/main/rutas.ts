// Rutas de los datos locales de la aplicación.
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

/** Nombre de la carpeta dentro de %APPDATA%. */
export const NOMBRE_CARPETA_DATOS = 'dm-gestion'

/**
 * Fija la carpeta de datos en %APPDATA%/dm-gestion. Tiene que ejecutarse antes del evento
 * `ready`, porque Electron resuelve `userData` en cuanto arranca.
 */
export function configurarCarpetaDatos(): void {
  // Sólo en desarrollo: permite abrir la aplicación contra otra carpeta de datos (por ejemplo la copia
  // descargada de la hoja) sin tocar los datos de verdad.
  const aparte = !app.isPackaged ? process.env.DM_GESTION_CARPETA_DATOS : undefined
  const carpeta = aparte ? path.resolve(aparte) : path.join(app.getPath('appData'), NOMBRE_CARPETA_DATOS)
  mkdirSync(carpeta, { recursive: true })
  app.setPath('userData', carpeta)
  // La caché de Chromium va aparte para no mezclarla con la base y la configuración.
  app.setPath('sessionData', path.join(carpeta, 'sesion'))
}

export function carpetaDatos(): string {
  return app.getPath('userData')
}

export function rutaBaseDeDatos(): string {
  return path.join(carpetaDatos(), 'dm.db')
}

export function rutaConfig(): string {
  return path.join(carpetaDatos(), 'config.json')
}
