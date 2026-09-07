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
 * (macOS) hasta que alguien le dé el foco a la ventana.
 *
 * Se llama junto con `notificarEnElSistema`, no en su lugar: el cartel dice QUÉ pasó, esto hace que
 * se note que pasó algo aunque el cartel ya se haya cerrado solo y la persona ni siquiera esté mirando
 * la barra de tareas en ese instante.
 *
 * No es el zumbido —para eso está `sacudirLaVentana`, más abajo—, y sirve donde el zumbido no llega:
 * la ventana minimizada o detrás de otra, que no se puede sacudir porque no se ve.
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

/**
 * Sacude la ventana: el zumbido de Messenger, el que movía la ventana del otro para que la mirara.
 *
 * Cómo está hecho, y por qué así. No hay ninguna API de «sacudir»: se mueve la ventana a mano unos
 * píxeles y se la devuelve. La amplitud baja en cada paso, que es lo que hace que se lea como un
 * sacudón y no como una ventana que se volvió loca, y al terminar vuelve EXACTAMENTE a donde estaba
 * (la posición se guarda antes de empezar, no se calcula al final).
 *
 * Lo que NO sacude, a propósito:
 *   - una ventana maximizada o en pantalla completa: moverla la saca de ese estado, y quien la dejó
 *     así no quiere que un mensaje se la desacomode;
 *   - una minimizada: no se ve, y moverla no la trae al frente (para eso está `llamarLaAtencion`);
 *   - una que ya se está sacudiendo: dos zumbidos juntos se pisarían y la ventana quedaría corrida.
 *
 * Nunca falla hacia afuera: si algo sale mal, el mensaje ya llegó igual y eso es lo que importa.
 */
let sacudiendo = false

export function sacudirLaVentana(): void {
  if (sacudiendo) return
  try {
    const elegidas = ventanas().filter(
      (ventana) =>
        !ventana.isDestroyed() && !ventana.isMinimized() && !ventana.isMaximized() && !ventana.isFullScreen(),
    )
    if (!elegidas.length) return

    const origen = elegidas.map((ventana) => ({ ventana, posicion: ventana.getPosition() }))
    // Doce pasos de 45 ms: poco más de medio segundo, lo mismo que dura el sonido.
    const PASOS = 12
    const MILISEGUNDOS = 45
    const DESVIO = 14
    sacudiendo = true

    let paso = 0
    const mover = () => {
      // El try va ACÁ ADENTRO y no sólo afuera: el de afuera no cubre lo que pasa dentro de un
      // `setTimeout`, y si un paso lanzara —la ventana se cerró entre el `isDestroyed()` y el
      // `setPosition()`, que es la carrera real— el `sacudiendo` quedaría en true para siempre y no
      // volvería a sacudirse nunca más en toda la sesión.
      try {
        paso++
        const queda = 1 - paso / PASOS
        for (const { ventana, posicion } of origen) {
          if (ventana.isDestroyed()) continue
          if (paso >= PASOS) {
            // El último paso devuelve la ventana a donde estaba, sin cuentas de por medio.
            ventana.setPosition(posicion[0], posicion[1])
            continue
          }
          const lado = paso % 2 === 0 ? 1 : -1
          ventana.setPosition(
            posicion[0] + Math.round(DESVIO * queda) * lado,
            posicion[1] + Math.round((DESVIO / 2) * queda) * (paso % 4 < 2 ? 1 : -1),
          )
        }
        if (paso >= PASOS) {
          sacudiendo = false
          return
        }
        setTimeout(mover, MILISEGUNDOS)
      } catch (error) {
        sacudiendo = false
        console.error('[avisos] Se cortó el sacudón de la ventana:', error)
      }
    }
    setTimeout(mover, MILISEGUNDOS)
  } catch (error) {
    sacudiendo = false
    console.error('[avisos] No se pudo sacudir la ventana:', error)
  }
}
