// Rutas de los datos locales de la aplicación.
import { app } from 'electron'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { esBeta, esDemo } from './canal'

/** Nombre de la carpeta dentro de %APPDATA%. */
export const NOMBRE_CARPETA_DATOS = 'dm-gestion'

/**
 * La beta tiene su propia carpeta: base local, config.json, credencial y bitácora aparte. Compartirla
 * con la estable dejaría a una versión pisando (o migrando) los datos de la otra.
 */
export const NOMBRE_CARPETA_DATOS_BETA = 'dm-gestion-beta'

/** La demo también tiene la suya, y es la única que se vacía sola: ver `limpiarDatosDeLaDemo`. */
export const NOMBRE_CARPETA_DATOS_DEMO = 'dm-gestion-demo'

/**
 * Lo que la demo deja en su carpeta y se borra en cada arranque: la base local, la credencial del
 * último ingreso, los adjuntos y los informes. Así cada demostración empieza igual que la anterior, con
 * los datos de ejemplo recién armados (el servidor de la demo tampoco guarda nada en disco). La bitácora
 * y la caché de Chromium se conservan: no tienen datos y sirven para ver qué pasó.
 */
const QUE_SE_LIMPIA_EN_LA_DEMO = [
  'dm.db',
  'dm.db-wal',
  'dm.db-shm',
  'dm.db-journal',
  'credencial.bin',
  'config.json',
  'adjuntos',
  'informes',
  'respaldos',
  'capturas',
  'tickets',
  'impresiones',
  'temp',
  'atm',
]

/**
 * Fija la carpeta de datos en %APPDATA%/dm-gestion (%APPDATA%/dm-gestion-beta en la beta). Tiene que ejecutarse antes del evento
 * `ready`, porque Electron resuelve `userData` en cuanto arranca.
 */
export function configurarCarpetaDatos(): void {
  // Sólo en desarrollo: permite abrir la aplicación contra otra carpeta de datos (por ejemplo la copia
  // descargada de la hoja) sin tocar los datos de verdad.
  // La demo no: su carpeta se vacía al arrancar, y vaciar una carpeta elegida a mano sería un desastre.
  const aparte = !app.isPackaged && !esDemo() ? process.env.DM_GESTION_CARPETA_DATOS : undefined
  const carpeta = aparte ? path.resolve(aparte) : path.join(app.getPath('appData'), nombreDeLaCarpeta())
  mkdirSync(carpeta, { recursive: true })
  app.setPath('userData', carpeta)
  // La caché de Chromium va aparte para no mezclarla con la base y la configuración.
  app.setPath('sessionData', path.join(carpeta, 'sesion'))
}

function nombreDeLaCarpeta(): string {
  if (esDemo()) return NOMBRE_CARPETA_DATOS_DEMO
  return esBeta() ? NOMBRE_CARPETA_DATOS_BETA : NOMBRE_CARPETA_DATOS
}

/**
 * Vacía la carpeta de la demo (ver QUE_SE_LIMPIA_EN_LA_DEMO). Sólo en la demo, y recién con el cerrojo de
 * instancia única en la mano: un doble click con la demo abierta no puede borrarle la base a la que ya
 * está corriendo.
 */
export function limpiarDatosDeLaDemo(): void {
  if (!esDemo()) return
  const carpeta = carpetaDatos()
  // Doble seguro: jamás se borra nada fuera de la carpeta de la demo.
  if (path.basename(carpeta) !== NOMBRE_CARPETA_DATOS_DEMO) return
  for (const nombre of QUE_SE_LIMPIA_EN_LA_DEMO) {
    rmSync(path.join(carpeta, nombre), { recursive: true, force: true })
  }
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
