// La ventana donde la persona ingresa a Facebook.
//
// Va en una BrowserWindow PROPIA y no en la principal, y no es un capricho: la ventana principal
// tiene un `setWindowOpenHandler` que manda cualquier http(s) al navegador del sistema y un
// `will-navigate` que cancela toda navegación (ver src/main/index.ts). Si el diálogo de Facebook se
// intentara abrir ahí, se abriría en Chrome y el código de autorización nunca volvería al programa.
// Una ventana nueva tiene su propio webContents y no hereda esos manejadores.
//
// La ventana va sin preload y con sandbox: adentro se escribe la contraseña de Facebook de la
// agencia, y no hay ningún motivo para que esa página tenga acceso a nada del programa.
import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { ErrorDeNegocio } from '../servicios/errores'
import { urlDeAutorizacion } from './meta'

/** Si en cinco minutos nadie terminó de ingresar, se cierra sola: no puede quedar una ventana viva. */
export const TIEMPO_MAXIMO_DE_INGRESO_MS = 5 * 60 * 1000

/**
 * Abre el diálogo de Facebook y devuelve el código de autorización.
 *
 * `urlDeRedireccion` tiene que ser exactamente la que está registrada en el panel de Meta. No se
 * navega a ella nunca: se atrapa el intento y se cancela, así que puede ser una dirección que ni
 * siquiera exista. Es el error de configuración más común y por eso la pantalla la muestra con un
 * botón para copiarla.
 */
export async function pedirCodigoDeMeta(appId: string, urlDeRedireccion: string, padre: BrowserWindow | null): Promise<string> {
  // El `state` es contra el falseo de la vuelta: si el que llega no es el que se mandó, no se acepta.
  const estadoEsperado = randomUUID()

  const ventana = new BrowserWindow({
    width: 620,
    height: 760,
    parent: padre ?? undefined,
    modal: Boolean(padre),
    title: 'Ingresar en Facebook',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'meta-login' },
  })

  return new Promise<string>((resolver, rechazar) => {
    let terminado = false

    const cerrar = () => {
      if (!ventana.isDestroyed()) ventana.destroy()
    }

    const terminar = (error: Error | null, codigo?: string) => {
      if (terminado) return
      terminado = true
      clearTimeout(reloj)
      cerrar()
      if (error) rechazar(error)
      else resolver(codigo ?? '')
    }

    const reloj = setTimeout(
      () => terminar(new ErrorDeNegocio('Se agotó el tiempo para ingresar en Facebook. Probá de nuevo.')),
      TIEMPO_MAXIMO_DE_INGRESO_MS,
    )

    /** ¿Esta navegación es la vuelta a nuestra dirección de redirección? */
    const mirar = (evento: { preventDefault: () => void }, url: string) => {
      if (!url.startsWith(urlDeRedireccion)) return
      // No se navega: la dirección puede no existir, y además ahí viaja el código.
      evento.preventDefault()
      let parametros: URLSearchParams
      try {
        const analizada = new URL(url)
        // Facebook puede devolver los datos en la query o en el fragmento según el flujo.
        parametros = new URLSearchParams(analizada.search || analizada.hash.replace(/^#/, ''))
      } catch {
        terminar(new ErrorDeNegocio('Facebook devolvió una respuesta que no se pudo leer.'))
        return
      }

      const errorDicho = parametros.get('error_description') || parametros.get('error')
      if (errorDicho) {
        terminar(new ErrorDeNegocio(`Facebook no autorizó la vinculación: ${errorDicho}`))
        return
      }
      if (parametros.get('state') !== estadoEsperado) {
        terminar(new ErrorDeNegocio('La respuesta de Facebook no coincide con el pedido. Por seguridad no se aceptó; probá de nuevo.'))
        return
      }
      const codigo = parametros.get('code')
      if (!codigo) {
        terminar(new ErrorDeNegocio('Facebook no devolvió el código para vincular la cuenta.'))
        return
      }
      terminar(null, codigo)
    }

    ventana.webContents.on('will-redirect', (evento, url) => mirar(evento, url))
    ventana.webContents.on('will-navigate', (evento, url) => mirar(evento, url))
    // Cerrarla a mano es cancelar: no es un error del programa, es alguien que se arrepintió.
    ventana.on('closed', () => terminar(new ErrorDeNegocio('Se cerró la ventana antes de terminar de vincular la cuenta.')))

    void ventana.loadURL(urlDeAutorizacion(appId, urlDeRedireccion, estadoEsperado)).catch(() => {
      terminar(new ErrorDeNegocio('No se pudo abrir el ingreso de Facebook. Fijate si hay internet.'))
    })
  })
}
