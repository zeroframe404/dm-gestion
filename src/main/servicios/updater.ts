// Actualizaciones automáticas: chequea el repositorio privado de GitHub al abrir la app y cada 4
// horas, descarga en segundo plano y avisa al renderer (mismo patrón `emitir` que sincronizacion.ts
// e importacion.ts) para que la barra fina de arriba muestre cuándo hay una versión lista.
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { DatosDeEvento, NombreEvento } from '../../shared/canales'
import type { EstadoActualizacion } from '../../shared/tipos'
import { ahoraIso } from '../importacion/normalizar'

/**
 * Token de SOLO LECTURA para leer los Releases del repo privado `zeroframe404/dm-gestion`
 * (fine-grained personal access token, permiso "Contents: Read-only", limitado a ese repo).
 * NO sirve para hacer push. Lo genera el dueño del repositorio en
 * https://github.com/settings/tokens?type=beta y se reemplaza acá.
 */
export const UPDATE_TOKEN = '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'

const CUATRO_HORAS_MS = 4 * 60 * 60 * 1000

let estado: EstadoActualizacion = {
  situacion: 'deshabilitada',
  version: null,
  porcentaje: null,
  canal: 'estable',
  ultimoChequeo: null,
  ultimoError: null,
}

let temporizador: NodeJS.Timeout | null = null

function emitir<E extends NombreEvento>(evento: E, datos: DatosDeEvento<E>): void {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed()) ventana.webContents.send(evento, datos)
  }
}

function cambiarEstado(cambios: Partial<EstadoActualizacion>): void {
  estado = { ...estado, ...cambios }
  emitir('actualizaciones:estado', estado)
}

/** Se llama una sola vez, al arrancar la app. En desarrollo no hay instalador del que actualizar. */
export function iniciarActualizaciones(): void {
  if (!app.isPackaged) return

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'zeroframe404',
    repo: 'dm-gestion',
    private: true,
    token: UPDATE_TOKEN,
  })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => cambiarEstado({ situacion: 'buscando', ultimoChequeo: ahoraIso() }))
  autoUpdater.on('update-not-available', () => cambiarEstado({ situacion: 'al-dia', version: null, porcentaje: null }))
  autoUpdater.on('update-available', (info) => cambiarEstado({ situacion: 'descargando', version: info.version, porcentaje: 0 }))
  autoUpdater.on('download-progress', (progreso) => cambiarEstado({ porcentaje: Math.round(progreso.percent) }))
  autoUpdater.on('update-downloaded', (info) => cambiarEstado({ situacion: 'lista', version: info.version, porcentaje: 100 }))
  // Sin internet u otro error: no se muestra ningún diálogo, sólo queda registrado y se reintenta
  // solo en el próximo chequeo (al abrir de nuevo o a las 4 horas).
  autoUpdater.on('error', (error) => {
    console.error('[actualizaciones] Error buscando actualizaciones:', error)
    cambiarEstado({ situacion: 'error', ultimoError: error.message })
  })

  buscarActualizaciones()
  temporizador = setInterval(buscarActualizaciones, CUATRO_HORAS_MS)
  temporizador.unref()
}

export function detenerActualizaciones(): void {
  if (temporizador) clearInterval(temporizador)
  temporizador = null
}

export function buscarActualizaciones(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    console.error('[actualizaciones] No se pudo chequear:', error)
  })
}

export function instalarActualizacion(): void {
  autoUpdater.quitAndInstall()
}

export function estadoDeActualizacion(): EstadoActualizacion {
  return estado
}
