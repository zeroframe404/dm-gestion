// Proceso principal de Electron: ventana, base de datos e IPC.
import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from 'electron'
import path from 'node:path'
import {
  anotar,
  detalleDelError,
  fallaDeArranque,
  iniciarBitacora,
  marcarArranqueTerminado,
  paso,
  vigilarErroresSueltos,
} from './arranque'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from './db/base'
import { registrarIpc } from './ipc'
import { carpetaDatos, configurarCarpetaDatos, rutaBaseDeDatos } from './rutas'
import { adoptarAjustesAlArrancar } from './servicios/ajustesCompartidos'
import { configurarBaseDeUsuarios } from './servicios/baseDeUsuarios'
import { hayImportacionEnCurso, marcarImportacionesInterrumpidas } from './servicios/importacion'
import { detenerSincronizacion } from './servicios/sincronizacion'
import { detenerActualizaciones, iniciarActualizaciones } from './servicios/updater'
import { AlmacenDeVinculo, configurarAlmacenDeRedes } from './redes/almacen'
import { AlmacenDeCredencial } from './usuarios/credencial'
import { AlmacenGitHub, REPO_DATOS, TOKEN_DATOS, TOKEN_DATOS_ANTERIOR } from './usuarios/github'

/** En desarrollo, scripts/dev.mjs pasa la URL del servidor de Vite. */
const URL_DESARROLLO = process.env.VITE_DEV_SERVER_URL

/**
 * Cuánto se espera a que la pantalla dé señales de vida antes de mostrar la ventana igual.
 *
 * La ventana nace escondida (`show: false`) y se muestra recién en `ready-to-show`, para que no se
 * vea el destello blanco de una ventana vacía. El precio de eso es que si `ready-to-show` NO llega
 * —la pantalla no cargó, el proceso de dibujo se cayó, la placa de video se colgó— queda una ventana
 * escondida para siempre y un proceso vivo que nadie ve. Pasado este tiempo se muestra igual: una
 * ventana fea es mucho mejor que ninguna.
 */
const ESPERA_MAXIMA_DE_LA_PANTALLA_MS = 12_000

app.setName('DM Gestión')

// Antes que nada, porque lo que sigue ya puede fallar.
vigilarErroresSueltos()
try {
  configurarCarpetaDatos()
} catch (error) {
  fallaDeArranque('la preparación de la carpeta de datos', error)
}
iniciarBitacora(carpetaDatos())

let ventanaPrincipal: BrowserWindow | null = null
/** true en cuanto la base y el IPC están listos: recién ahí tiene sentido dibujar una ventana. */
let listoParaVentana = false

function crearVentana(): void {
  const ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'DM Gestión',
    backgroundColor: '#0b1f3b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  ventanaPrincipal = ventana

  // --- Que la ventana aparezca sí o sí -------------------------------------------------------
  let mostrada = false
  // A propósito SIN `unref()`: este temporizador es justamente la red que evita el proceso escondido,
  // así que tiene que pesar en el bucle de eventos hasta que dispare. Se cancela al mostrar la
  // ventana y al cerrarla, que son los dos únicos finales posibles.
  const reloj = setTimeout(
    () => mostrar('la pantalla tardó demasiado en dar señales'),
    ESPERA_MAXIMA_DE_LA_PANTALLA_MS,
  )

  function mostrar(motivo: string): void {
    if (mostrada) return
    mostrada = true
    clearTimeout(reloj)
    if (ventana.isDestroyed()) return
    if (motivo !== 'ready-to-show') anotar(`[ventana] Se muestra igual: ${motivo}.`)
    ventana.show()
    marcarArranqueTerminado()
  }

  ventana.once('ready-to-show', () => mostrar('ready-to-show'))

  // Si la pantalla no carga, el programa no sirve para nada: se dice qué pasó y se sale, en vez de
  // dejar una ventana en blanco o —peor— un proceso escondido. `-3` es una carga que se abandonó
  // sola (una recarga que pisó a otra) y no es una falla.
  ventana.webContents.on('did-fail-load', (_evento, codigo, descripcion, url, esLaPrincipal) => {
    if (!esLaPrincipal || codigo === -3) return
    if (mostrada) {
      console.error(`[ventana] No se pudo cargar ${url}: ${descripcion} (${codigo})`)
      return
    }
    fallaDeArranque('la carga de la pantalla', new Error(`${descripcion} (${codigo}) al cargar ${url}`))
  })

  ventana.webContents.on('render-process-gone', (_evento, detalles) => {
    const motivo = `${detalles.reason}${detalles.exitCode ? ` (código ${detalles.exitCode})` : ''}`
    if (!mostrada) {
      fallaDeArranque('el dibujado de la pantalla', new Error(`El proceso de la pantalla se cayó: ${motivo}`))
      return
    }
    console.error(`[ventana] El proceso de la pantalla se cayó: ${motivo}`)
  })

  ventana.on('unresponsive', () => console.warn('[ventana] La pantalla dejó de responder.'))

  ventana.on('closed', () => {
    clearTimeout(reloj)
    ventanaPrincipal = null
  })

  // --- Lo de siempre --------------------------------------------------------------------------
  // Cerrar en medio de una importación deja la corrida incompleta: se pide confirmación.
  ventana.on('close', (evento) => {
    if (!hayImportacionEnCurso()) return
    const respuesta = dialog.showMessageBoxSync(ventana, {
      type: 'warning',
      title: 'Importación en curso',
      message: 'Hay una importación desde Google en curso.',
      detail: 'Si cerrás ahora, la importación queda incompleta y vas a tener que volver a correrla.',
      buttons: ['Seguir importando', 'Cerrar igual'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (respuesta === 0) evento.preventDefault()
  })

  // Los enlaces externos se abren en el navegador; nunca en una ventana de la app.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  ventana.webContents.on('will-navigate', (evento, url) => {
    if (url !== ventana.webContents.getURL()) evento.preventDefault()
  })

  const cargar = URL_DESARROLLO
    ? ventana.loadURL(URL_DESARROLLO)
    : ventana.loadFile(path.join(__dirname, '../renderer/index.html'))
  // Sin este `catch` el rechazo queda suelto: en Electron eso no abre ningún cartel ni corta nada, y
  // el programa se queda vivo con la ventana escondida. `did-fail-load` ya contó el motivo.
  cargar.catch((error) => console.error('[ventana] No se pudo cargar la pantalla:', detalleDelError(error)))
}

/**
 * Base de usuarios compartida (Fase 11). El token y el repositorio son constantes del programa; en
 * desarrollo arranca en modo local salvo que se pida lo contrario por variable de entorno, para que
 * `npm run dev`, `sembrar` y los scripts de humo nunca toquen el repositorio de verdad.
 *   DM_GESTION_TOKEN_DATOS    token a usar (sólo desarrollo)
 *   DM_GESTION_GITHUB_API     URL base de la API (sólo desarrollo: simulador local o puerto cerrado = «sin internet»)
 *   DM_GESTION_ARCHIVO_DATOS  otro archivo dentro del repo (sólo desarrollo: probar contra GitHub real sin tocar usuarios.json)
 */
function prepararBaseDeUsuarios(): void {
  const enDesarrollo = !app.isPackaged
  const tokens = enDesarrollo
    ? [process.env.DM_GESTION_TOKEN_DATOS ?? '']
    : [TOKEN_DATOS, TOKEN_DATOS_ANTERIOR]
  const hayToken = tokens.some((t) => t.trim() !== '')
  const urlBase = enDesarrollo ? process.env.DM_GESTION_GITHUB_API : undefined
  const archivo = enDesarrollo ? process.env.DM_GESTION_ARCHIVO_DATOS : undefined

  const cifrador = {
    disponible: () => safeStorage.isEncryptionAvailable(),
    cifrar: (texto: string) => safeStorage.encryptString(texto),
    descifrar: (datos: Buffer) => safeStorage.decryptString(datos),
  }
  configurarBaseDeUsuarios({
    almacen: hayToken ? new AlmacenGitHub({ repo: REPO_DATOS, tokens, urlBase, archivo }) : null,
    credenciales: new AlmacenDeCredencial(path.join(carpetaDatos(), 'credencial.bin'), cifrador),
    sinTokenEnProduccion: !enDesarrollo && !hayToken,
    version: app.getVersion(),
  })
  // El vínculo con Meta usa el mismo cifrador: adentro va el token de la Página, que no vence y
  // publica en nombre de la agencia.
  configurarAlmacenDeRedes(new AlmacenDeVinculo(path.join(carpetaDatos(), 'redes.bin'), cifrador))
  if (!hayToken) console.log(enDesarrollo ? '[usuarios] Desarrollo sin DM_GESTION_TOKEN_DATOS: usuarios locales.' : '[usuarios] Versión publicada sin TOKEN_DATOS: usuarios locales.')
}

function arrancar(): void {
  // En producción no hay menú. En desarrollo se conserva el de Electron por las herramientas de desarrollo.
  if (app.isPackaged) Menu.setApplicationMenu(null)

  try {
    abrirBaseDeDatos(rutaBaseDeDatos())
  } catch (error) {
    console.error('[app] No se pudo abrir la base de datos:', detalleDelError(error))
    dialog.showErrorBox(
      'DM Gestión',
      `No se pudo abrir la base de datos local.\n\n${error instanceof Error ? error.message : String(error)}`,
    )
    app.exit(1)
    return
  }

  // Cada paso avisa con su nombre si falla, en vez de dejar el programa a medio abrir y en silencio.
  if (!paso('la revisión de las importaciones a medio hacer', marcarImportacionesInterrumpidas)) return
  if (!paso('la preparación de la base de usuarios', prepararBaseDeUsuarios)) return
  if (!paso('el registro de los canales internos', registrarIpc)) return
  if (!paso('la creación de la ventana', crearVentana)) return
  listoParaVentana = true

  // De acá para abajo, nada es imprescindible para que el programa abra: si algo falla, se anota y
  // la ventana —que ya está creada— sigue su camino.
  paso('el arranque de las actualizaciones', iniciarActualizaciones)
  // Las credenciales que cargó el superadministrador. No se espera: si el VPS no contesta, el
  // programa abre igual con lo que ya tenía guardado.
  paso('la adopción de los ajustes compartidos', adoptarAjustesAlArrancar)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana()
  })
}

// Una sola instancia: dos procesos escribiendo la misma base SQLite es buscarse problemas.
if (!app.requestSingleInstanceLock()) {
  anotar('[app] Ya había otra instancia abierta: este arranque se cierra y le pasa el foco.')
  app.exit(0)
} else {
  app.on('second-instance', () => {
    // Otro doble click. Si esta instancia se quedó sin ventana (algo falló después de abrir la base,
    // o la ventana se destruyó), el doble click tiene que RESCATARLA en vez de no hacer nada: sin
    // esto, el proceso se queda con el cerrojo y ningún doble click vuelve a abrir el programa.
    if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) {
      if (!listoParaVentana) {
        anotar('[app] Otro doble click mientras esta instancia todavía está abriendo: se lo ignora.')
        return
      }
      anotar('[app] Otro doble click y esta instancia no tenía ventana: se crea una de nuevo.')
      paso('la creación de la ventana', crearVentana)
      return
    }
    if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore()
    if (!ventanaPrincipal.isVisible()) ventanaPrincipal.show()
    ventanaPrincipal.focus()
  })

  // Que se caiga la GPU no cierra el programa, pero es lo primero que hay que mirar si una
  // computadora abre en blanco o no abre: queda anotado.
  app.on('child-process-gone', (_evento, detalles) => {
    console.error(`[app] Se cayó un proceso hijo (${detalles.type}): ${detalles.reason}`)
  })

  app
    .whenReady()
    .then(arrancar)
    .catch((error) => fallaDeArranque('el arranque', error))

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    // Cada cierre por separado: uno que falle no puede dejar el programa colgado a medio salir. Un
    // cierre que no termina es justamente lo que deja el proceso fantasma que después se queda con
    // el cerrojo de instancia única y no deja abrir de nuevo.
    for (const [nombre, cerrar] of [
      ['las actualizaciones', detenerActualizaciones],
      ['la sincronización', detenerSincronizacion],
      ['la base de datos', cerrarBaseDeDatos],
    ] as const) {
      try {
        cerrar()
      } catch (error) {
        console.error(`[app] No se pudo cerrar ${nombre}:`, detalleDelError(error))
      }
    }
  })
}
