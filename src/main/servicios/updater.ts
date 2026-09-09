// Actualizaciones automáticas: chequea el repositorio privado de GitHub al abrir la app y cada 15
// minutos (sólo pregunta si hay una versión nueva, no la baja) y avisa al renderer (mismo patrón
// `emitir` que sincronizacion.ts e importacion.ts) para que aparezca el cartel «Actualización
// disponible encontrada». Recién baja el instalador cuando alguien aprieta «Actualizar ahora»: antes
// se bajaba solo apenas se detectaba, sin preguntar nada.
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { EstadoActualizacion } from '../../shared/tipos'
import { ahoraIso } from '../importacion/normalizar'
import { reportarRechazo, reportarVersionPropia } from './estadoDeActualizaciones'
import { emitirATodas as emitir } from './avisos'

/**
 * Token de SOLO LECTURA para leer los Releases del repo privado `zeroframe404/dm-gestion`
 * (fine-grained personal access token, permiso "Contents: Read-only", limitado a ese repo).
 * NO sirve para hacer push. Lo genera el dueño del repositorio en
 * https://github.com/settings/tokens?type=beta y se reemplaza acá.
 */
export const UPDATE_TOKEN = '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'

const QUINCE_MINUTOS_MS = 15 * 60 * 1000

let estado: EstadoActualizacion = {
  situacion: 'deshabilitada',
  version: null,
  porcentaje: null,
  canal: 'estable',
  ultimoChequeo: null,
  ultimoError: null,
}

let temporizador: NodeJS.Timeout | null = null

/**
 * Se pone en `true` sólo cuando alguien apretó «Actualizar ahora»: ahí sí conviene instalar solo en
 * cuanto termine de bajar, sin esperar a que la persona cierre el programa. El chequeo automático de
 * cada 15 minutos nunca la prende: baja algo sin haberlo pedido nadie sería justo lo que esta mejora
 * vino a evitar.
 */
let instalarSolaAlTerminar = false

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
  // El chequeo automático ya no descarga solo: sólo pregunta si hay algo nuevo (liviano, una consulta
  // al servidor de GitHub) y es el cartel el que decide si se baja, cuando alguien aprieta «Actualizar
  // ahora». `autoInstallOnAppQuit` sigue en `true` por si alguien cierra el programa con la descarga
  // ya lista sin haber tocado «Reiniciar ahora».
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => cambiarEstado({ situacion: 'buscando', ultimoChequeo: ahoraIso() }))
  autoUpdater.on('update-not-available', () => cambiarEstado({ situacion: 'al-dia', version: null, porcentaje: null }))
  // Todavía no se baja nada acá: `disponible` es lo que dispara el cartel con sus dos botones.
  autoUpdater.on('update-available', (info) => cambiarEstado({ situacion: 'disponible', version: info.version, porcentaje: null }))
  autoUpdater.on('download-progress', (progreso) => cambiarEstado({ situacion: 'descargando', porcentaje: Math.round(progreso.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    cambiarEstado({ situacion: 'lista', version: info.version, porcentaje: 100 })
    // Se pidió «Actualizar ahora»: no tiene sentido esperar a que alguien cierre el programa solo.
    if (instalarSolaAlTerminar) instalarActualizacion()
  })
  // Sin internet u otro error: no se muestra ningún diálogo, sólo queda registrado y se reintenta
  // solo en el próximo chequeo (al abrir de nuevo o a los 15 minutos).
  autoUpdater.on('error', (error) => {
    console.error('[actualizaciones] Error buscando actualizaciones:', error)
    instalarSolaAlTerminar = false
    cambiarEstado({ situacion: 'error', ultimoError: error.message })
  })

  buscarActualizaciones()
  temporizador = setInterval(buscarActualizaciones, QUINCE_MINUTOS_MS)
  temporizador.unref()
}

export function detenerActualizaciones(): void {
  if (temporizador) clearInterval(temporizador)
  temporizador = null
}

/** El chequeo liviano: sólo pregunta si hay una versión nueva, nunca la baja. */
export function buscarActualizaciones(): void {
  if (!app.isPackaged) return
  reportarVersionPropia()
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    console.error('[actualizaciones] No se pudo chequear:', error)
  })
}

/** El «Actualizar ahora» del cartel: recién acá se baja el instalador. */
export function actualizarAhora(): void {
  instalarSolaAlTerminar = true
  cambiarEstado({ situacion: 'descargando', porcentaje: 0 })
  autoUpdater.downloadUpdate().catch((error: unknown) => {
    instalarSolaAlTerminar = false
    console.error('[actualizaciones] No se pudo descargar:', error)
    cambiarEstado({ situacion: 'error', ultimoError: error instanceof Error ? error.message : String(error) })
  })
}

/** El «Dejar para después»: no se baja nada, sólo queda anotado para que lo vea el superadministrador. */
export function posponerActualizacion(version: string): void {
  reportarRechazo(version)
}

export function instalarActualizacion(): void {
  autoUpdater.quitAndInstall()
}

export function estadoDeActualizacion(): EstadoActualizacion {
  return estado
}
