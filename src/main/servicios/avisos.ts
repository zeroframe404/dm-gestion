// Los avisos que salen de la aplicación hacia afuera: la notificación del sistema operativo y el
// empujón al renderer para que suene el aviso que corresponda.
//
// Va acá y no en `tareas.ts` porque una tarea se puede dar por terminada desde tres pantallas
// distintas —el módulo Tareas, la ficha de un cliente y la de un siniestro— y las tres tienen que
// avisar igual. Poniéndolo en el servicio, el aviso sale una sola vez y desde un solo lugar, en vez
// de repetirse en cada manejador con la posibilidad de que uno quede desactualizado.
//
// La notificación del sistema es la de Windows: aparece en la esquina aunque la aplicación esté
// detrás de otra ventana, que es justamente cuando hace falta. Si el sistema no las tiene habilitadas
// (`Notification.isSupported()` en false, o el usuario las apagó en Windows) no pasa nada: el sonido
// y el refresco de la pantalla siguen funcionando igual.
import { BrowserWindow, Notification } from 'electron'
import type { DatosDeEvento, NombreEvento } from '../../shared/canales'
import type { TareaCompletada } from '../../shared/tipos'

/**
 * Las ventanas abiertas, o ninguna si no hay Electron alrededor. El banco de pruebas importa los
 * servicios directamente, sin proceso de Electron: ahí `BrowserWindow` no existe, y un aviso que no se
 * puede mostrar no puede hacer fallar la operación que lo generó.
 */
function ventanas(): BrowserWindow[] {
  try {
    return typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : []
  } catch {
    return []
  }
}

function emitir<E extends NombreEvento>(evento: E, datos: DatosDeEvento<E>): void {
  for (const ventana of ventanas()) {
    if (!ventana.isDestroyed()) ventana.webContents.send(evento, datos)
  }
}

/**
 * Muestra una notificación del sistema. Nunca falla hacia afuera: un aviso que no se pudo mostrar no
 * puede hacer fracasar la operación que lo generó (guardar la tarea es lo importante; el cartel, no).
 */
export function notificarEnElSistema(titulo: string, cuerpo: string): void {
  try {
    if (typeof Notification?.isSupported !== 'function' || !Notification.isSupported()) return
    const notificacion = new Notification({ title: titulo, body: cuerpo, silent: true })
    // `silent: true` a propósito: el sonido lo pone la aplicación (check.mp3), no Windows. Con los dos
    // se escucharían dos avisos pisados y el de Windows es el mismo para todo.
    notificacion.on('click', () => {
      const ventana = ventanas().find((candidata) => !candidata.isDestroyed())
      if (!ventana) return
      if (ventana.isMinimized()) ventana.restore()
      ventana.focus()
    })
    notificacion.show()
  } catch (error) {
    console.error('[avisos] No se pudo mostrar la notificación del sistema:', error)
  }
}

/**
 * Hace parpadear el ícono de la aplicación en la barra de tareas (Windows) o saltar el del dock
 * (macOS) hasta que alguien le dé el foco a la ventana. Es el «nudge» de siempre —el de Messenger,
 * el que hacía vibrar la ventana del chat— adaptado a lo que un programa de escritorio puede sacudir
 * hoy sin asustar a nadie: no la pantalla, sino el ícono de la barra de tareas.
 *
 * Se llama junto con `notificarEnElSistema`, no en su lugar: el cartel dice QUÉ pasó, esto hace que
 * se note que pasó algo aunque el cartel ya se haya cerrado solo y la persona ni siquiera esté mirando
 * la barra de tareas en ese instante.
 *
 * Nunca falla hacia afuera, y no hace nada con una ventana que ya tiene el foco: ahí no hay ícono que
 * hacer parpadear, porque ya se está mirando.
 */
export function llamarLaAtencion(): void {
  try {
    for (const ventana of ventanas()) {
      if (ventana.isDestroyed() || ventana.isFocused()) continue
      ventana.flashFrame(true)
      // En Windows el parpadeo se apaga solo al recuperar el foco; en Linux hay que apagarlo a mano.
      // `once` no está de más en Windows: Electron no vuelve a llamarlo, así que se pone siempre igual.
      ventana.once('focus', () => ventana.flashFrame(false))
    }
  } catch (error) {
    console.error('[avisos] No se pudo hacer parpadear la ventana:', error)
  }
}

/**
 * Una tarea se dio por terminada: notificación del sistema, parpadeo del ícono y aviso al renderer
 * para que suene. Se llama sólo cuando el estado CAMBIÓ a «hecha»; volver a guardar una tarea que ya
 * estaba hecha no vuelve a avisar.
 */
export function avisarTareaCompletada(datos: TareaCompletada): void {
  // La notificación de Windows sale SÓLO con la aplicación detrás de otra ventana, que es cuando
  // sirve. Con la ventana a la vista sería un cartel del sistema encima de la propia pantalla, más el
  // cartel de la aplicación, más una entrada permanente en el Centro de actividades, y todo eso por
  // cada tarea que alguien tilda mirando la lista. El sonido y el cartel de adentro salen siempre.
  const aLaVista = ventanas().some((ventana) => !ventana.isDestroyed() && ventana.isFocused())
  if (!aLaVista) {
    notificarEnElSistema('Tarea completada', `«${datos.titulo}» quedó marcada como hecha${datos.porQuien ? ` por ${datos.porQuien}` : ''}.`)
    llamarLaAtencion()
  }
  emitir('tareas:completada', datos)
}
