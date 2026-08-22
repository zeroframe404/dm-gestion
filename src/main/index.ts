// Proceso principal de Electron: ventana, base de datos e IPC.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import path from 'node:path'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from './db/base'
import { registrarIpc } from './ipc'
import { configurarCarpetaDatos, rutaBaseDeDatos } from './rutas'
import { hayImportacionEnCurso, marcarImportacionesInterrumpidas } from './servicios/importacion'
import { detenerSincronizacion } from './servicios/sincronizacion'
import { detenerActualizaciones, iniciarActualizaciones } from './servicios/updater'

/** En desarrollo, scripts/dev.mjs pasa la URL del servidor de Vite. */
const URL_DESARROLLO = process.env.VITE_DEV_SERVER_URL

app.setName('DM Gestión')
configurarCarpetaDatos()

let ventanaPrincipal: BrowserWindow | null = null

function crearVentana(): void {
  ventanaPrincipal = new BrowserWindow({
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

  ventanaPrincipal.once('ready-to-show', () => ventanaPrincipal?.show())
  ventanaPrincipal.on('closed', () => {
    ventanaPrincipal = null
  })

  // Cerrar en medio de una importación deja la corrida incompleta: se pide confirmación.
  const ventana = ventanaPrincipal
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
  ventanaPrincipal.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  ventanaPrincipal.webContents.on('will-navigate', (evento, url) => {
    if (url !== ventanaPrincipal?.webContents.getURL()) evento.preventDefault()
  })

  if (URL_DESARROLLO) {
    void ventanaPrincipal.loadURL(URL_DESARROLLO)
  } else {
    void ventanaPrincipal.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

// Una sola instancia: dos procesos escribiendo la misma base SQLite es buscarse problemas.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!ventanaPrincipal) return
    if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore()
    ventanaPrincipal.focus()
  })

  void app.whenReady().then(() => {
    // En producción no hay menú. En desarrollo se conserva el de Electron por las herramientas de desarrollo.
    if (app.isPackaged) Menu.setApplicationMenu(null)

    try {
      abrirBaseDeDatos(rutaBaseDeDatos())
    } catch (error) {
      console.error('[app] No se pudo abrir la base de datos:', error)
      dialog.showErrorBox(
        'DM Gestión',
        `No se pudo abrir la base de datos local.\n\n${error instanceof Error ? error.message : String(error)}`,
      )
      app.quit()
      return
    }

    marcarImportacionesInterrumpidas()
    registrarIpc()
    crearVentana()
    iniciarActualizaciones()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana()
    })
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
    detenerActualizaciones()
    detenerSincronizacion()
    cerrarBaseDeDatos()
  })
}
