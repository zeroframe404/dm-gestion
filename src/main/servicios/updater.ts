// Actualizaciones automáticas: chequea el servidor de la agencia (y, si no contesta, los Releases de
// GitHub; ver origenesDeActualizacion.ts) al abrir la app y cada 15
// minutos (sólo pregunta si hay una versión nueva, no la baja) y avisa al renderer (mismo patrón
// `emitir` que sincronizacion.ts e importacion.ts) para que aparezca el cartel «Actualización
// disponible encontrada». Recién baja el instalador cuando alguien aprieta «Actualizar ahora»: antes
// se bajaba solo apenas se detectaba, sin preguntar nada.
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { EstadoActualizacion } from '../../shared/tipos'
import { canalActual } from '../canal'
import { ahoraIso } from '../importacion/normalizar'
import { reportarRechazo, reportarVersionPropia } from './estadoDeActualizaciones'
import { emitirATodas as emitir } from './avisos'
import { origenesDeActualizacion, type OpcionDeActualizacion } from './origenesDeActualizacion'

const QUINCE_MINUTOS_MS = 15 * 60 * 1000

/**
 * Lo que queda dicho si en la demo alguien aprieta «Buscar actualizaciones» o «Actualizar ahora». La
 * demo se reparte como un instalador suelto: no tiene canal de novedades y no sale a GitHub.
 */
const SIN_ACTUALIZACIONES_EN_LA_DEMO = 'La demostración no busca actualizaciones: se reparte como un instalador aparte y no se conecta a internet.'

/** Demo: deja el estado «deshabilitada» con el motivo, sin tocar electron-updater. */
function avisarQueLaDemoNoSeActualiza(): void {
  cambiarEstado({ situacion: 'deshabilitada', canal: 'demo', version: null, porcentaje: null, ultimoError: SIN_ACTUALIZACIONES_EN_LA_DEMO })
}

let estado: EstadoActualizacion = {
  situacion: 'deshabilitada',
  version: null,
  porcentaje: null,
  canal: 'estable',
  ultimoChequeo: null,
  ultimoError: null,
}

let temporizador: NodeJS.Timeout | null = null

/** De dónde se busca, en orden (ver origenesDeActualizacion.ts), y cuál se está usando ahora. */
let origenes: OpcionDeActualizacion[] = []
let indiceDeOrigen = 0

/** `true` mientras hay un chequeo en curso: un error ahí pasa al siguiente origen en vez de mostrarse. */
let chequeando = false

/**
 * Se pone en `true` sólo cuando alguien apretó «Actualizar ahora»: ahí sí conviene instalar solo en
 * cuanto termine de bajar, sin esperar a que la persona cierre el programa. El chequeo automático de
 * cada 15 minutos nunca la prende: baja algo sin haberlo pedido nadie sería justo lo que esta mejora
 * vino a evitar.
 */
let instalarSolaAlTerminar = false

/**
 * El mensaje de error de electron-updater trae la URL, el volcado de la respuesta de GitHub, todas las
 * cabeceras HTTP y el stack: media pantalla de jeroglíficos en el cartel de Acerca de. Se guarda sólo
 * la primera línea, recortada, que es la única parte que le dice algo a alguien.
 */
function mensajeCorto(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error)
  const primeraLinea = texto.split('\n')[0].trim()
  if (!primeraLinea) return 'Error desconocido.'
  return primeraLinea.length > 200 ? `${primeraLinea.slice(0, 200)}…` : primeraLinea
}

function cambiarEstado(cambios: Partial<EstadoActualizacion>): void {
  estado = { ...estado, ...cambios }
  emitir('actualizaciones:estado', estado)
}

/** Se llama una sola vez, al arrancar la app. En desarrollo no hay instalador del que actualizar. */
export function iniciarActualizaciones(): void {
  if (!app.isPackaged) return
  // La demo no se actualiza sola: se reparte como un instalador suelto y no tiene canal de novedades.
  if (canalActual() === 'demo') return

  // La beta NO mira los Releases de versiones de GitHub: lee un Release fijo («beta-canal», marcado como
  // prerelease) que cada publicación de la rama `beta` reemplaza, y en el servidor su propia carpeta
  // (`/beta`). Dos razones:
  //  - La estable usa «el último Release que no sea prerelease», así que jamás ve esta beta.
  //  - La beta no depende de cuál sea el Release más nuevo del repositorio: con el proveedor `github`,
  //    en cuanto se publicara una estable por encima de la última beta, buscaría `beta.yml` en ese
  //    Release, no lo encontraría y se quedaría sin actualizar.
  //
  // La estable, en GitHub, lee el repositorio PÚBLICO sin credenciales: no va ningún token. Hasta la
  // v15.3.2 iba `private: true` con un token de lectura embebido; cuando venció, GitHub contestó «401 Bad
  // credentials» a TODAS las computadoras y el programa dejó de ver versiones nuevas. Sin token no vence
  // nada. Si el repositorio vuelve a ser privado, el servidor de la agencia sigue andando; el respaldo de
  // GitHub habría que llevarlo a un repositorio público aparte en vez de volver a embeber un token.
  const canal = canalActual() === 'beta' ? 'beta' : 'estable'
  origenes = origenesDeActualizacion(canal)
  usarOrigen(0)
  if (canal === 'beta') cambiarEstado({ canal: 'beta' })
  // El chequeo automático ya no descarga solo: sólo pregunta si hay algo nuevo (liviano, una consulta
  // al servidor de GitHub) y es el cartel el que decide si se baja, cuando alguien aprieta «Actualizar
  // ahora». `autoInstallOnAppQuit` sigue en `true` por si alguien cierra el programa con la descarga
  // ya lista sin haber tocado «Reiniciar ahora».
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => cambiarEstado({ situacion: 'buscando', ultimoChequeo: ahoraIso() }))
  autoUpdater.on('update-not-available', () => {
    chequeando = false
    cambiarEstado({ situacion: 'al-dia', version: null, porcentaje: null })
  })
  // Todavía no se baja nada acá: `disponible` es lo que dispara el cartel con sus dos botones. La descarga
  // sale del mismo origen que contestó el chequeo.
  autoUpdater.on('update-available', (info) => {
    chequeando = false
    cambiarEstado({ situacion: 'disponible', version: info.version, porcentaje: null })
  })
  autoUpdater.on('download-progress', (progreso) => cambiarEstado({ situacion: 'descargando', porcentaje: Math.round(progreso.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    cambiarEstado({ situacion: 'lista', version: info.version, porcentaje: 100 })
    // Se pidió «Actualizar ahora»: no tiene sentido esperar a que alguien cierre el programa solo.
    if (instalarSolaAlTerminar) instalarActualizacion()
  })
  // Sin internet u otro error: no se muestra ningún diálogo, sólo queda registrado y se reintenta
  // solo en el próximo chequeo (al abrir de nuevo o a los 15 minutos).
  autoUpdater.on('error', (error) => {
    console.error(`[actualizaciones] Error buscando actualizaciones (${origenes[indiceDeOrigen]?.origen ?? '?'}):`, error)
    // Falló el CHEQUEO contra el servidor de la agencia: se prueba en el acto con el siguiente (GitHub),
    // sin mostrar ningún error. Uno de descarga no cambia de origen: se muestra y se reintenta después.
    if (chequeando && indiceDeOrigen + 1 < origenes.length) {
      usarOrigen(indiceDeOrigen + 1)
      chequear()
      return
    }
    chequeando = false
    instalarSolaAlTerminar = false
    cambiarEstado({ situacion: 'error', ultimoError: mensajeCorto(error) })
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
  // Demo: ni el chequeo ni el reporte de la versión (que en la agencia va al superadministrador).
  // Sin este corte, electron-updater leería el app-update.yml del instalador y saldría a GitHub.
  if (canalActual() === 'demo') {
    avisarQueLaDemoNoSeActualiza()
    return
  }
  if (!app.isPackaged) return
  reportarVersionPropia()
  if (origenes.length === 0) return
  // Cada chequeo vuelve a probar primero el servidor de la agencia. Salvo con una descarga en curso o ya
  // lista: cambiar de origen en el medio la dejaría sin de dónde terminar de bajar.
  if (estado.situacion !== 'descargando' && estado.situacion !== 'lista') usarOrigen(0)
  chequear()
}

function chequear(): void {
  chequeando = true
  autoUpdater.checkForUpdates().catch((error: unknown) => {
    console.error('[actualizaciones] No se pudo chequear:', error)
  })
}

/** Apunta electron-updater al origen `indice` de la lista (0 = el servidor de la agencia). */
function usarOrigen(indice: number): void {
  const opcion: OpcionDeActualizacion | undefined = origenes[indice]
  if (!opcion) return
  indiceDeOrigen = indice
  autoUpdater.setFeedURL(opcion.feed)
  if (opcion.canal) {
    autoUpdater.channel = opcion.canal
    // Asignar el canal prende `allowDowngrade`; acá no tiene que bajar nunca a una beta más vieja.
    autoUpdater.allowDowngrade = false
  }
  cambiarEstado({ origen: opcion.origen })
}

/** El «Actualizar ahora» del cartel: recién acá se baja el instalador. */
export function actualizarAhora(): void {
  if (canalActual() === 'demo') {
    avisarQueLaDemoNoSeActualiza()
    return
  }
  instalarSolaAlTerminar = true
  cambiarEstado({ situacion: 'descargando', porcentaje: 0 })
  autoUpdater.downloadUpdate().catch((error: unknown) => {
    instalarSolaAlTerminar = false
    console.error('[actualizaciones] No se pudo descargar:', error)
    cambiarEstado({ situacion: 'error', ultimoError: mensajeCorto(error) })
  })
}

/** El «Dejar para después»: no se baja nada, sólo queda anotado para que lo vea el superadministrador. */
export function posponerActualizacion(version: string): void {
  reportarRechazo(version)
}

export function instalarActualizacion(): void {
  // Demo: no hay nada bajado que instalar (ver `buscarActualizaciones`).
  if (canalActual() === 'demo') return
  autoUpdater.quitAndInstall()
}

export function estadoDeActualizacion(): EstadoActualizacion {
  return estado
}
