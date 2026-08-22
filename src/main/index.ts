// Proceso principal de Electron: ventana, base de datos e IPC.
import { app, BrowserWindow, dialog, Menu, safeStorage, shell } from 'electron'
import path from 'node:path'
import { abrirBaseDeDatos, cerrarBaseDeDatos } from './db/base'
import { registrarIpc } from './ipc'
import { carpetaDatos, configurarCarpetaDatos, rutaBaseDeDatos } from './rutas'
import { configurarBaseDeUsuarios } from './servicios/baseDeUsuarios'
import { hayImportacionEnCurso, marcarImportacionesInterrumpidas } from './servicios/importacion'
import { detenerSincronizacion } from './servicios/sincronizacion'
import { detenerActualizaciones, iniciarActualizaciones } from './servicios/updater'
import { AlmacenDeCredencial } from './usuarios/credencial'
import { AlmacenGitHub, REPO_DATOS, TOKEN_DATOS, TOKEN_DATOS_ANTERIOR } from './usuarios/github'

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
  if (!hayToken) console.log(enDesarrollo ? '[usuarios] Desarrollo sin DM_GESTION_TOKEN_DATOS: usuarios locales.' : '[usuarios] Versión publicada sin TOKEN_DATOS: usuarios locales.')
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
    prepararBaseDeUsuarios()
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
