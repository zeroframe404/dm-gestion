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
import { arrancarCartero, apurarAlCartero, pararCartero } from './mensajeria/cartero'
import { carpetaDatos, configurarCarpetaDatos, rutaBaseDeDatos } from './rutas'
import { adoptarAjustesAlArrancar } from './servicios/ajustesCompartidos'
import { configurarBaseDeUsuarios } from './servicios/baseDeUsuarios'
import { credencialesVps } from './servicios/config'
import { hayImportacionEnCurso, marcarImportacionesInterrumpidas } from './servicios/importacion'
import { alSubirUnAdjunto } from './servicios/adjuntos'
import { reportarVersionPropia } from './servicios/estadoDeActualizaciones'
import { detenerSincronizacion } from './servicios/sincronizacion'
import { alCambiarLaSesion } from './servicios/sesion'
import { detenerActualizaciones, iniciarActualizaciones } from './servicios/updater'
import { AlmacenDeCredencial } from './usuarios/credencial'
import { AlmacenGitHub, REPO_DATOS, TOKEN_DATOS, TOKEN_DATOS_ANTERIOR } from './usuarios/github'
import { AlmacenVps } from './usuarios/vps'

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
 * El almacén de GitHub, si esta versión todavía lo tiene configurado.
 *
 * Desde la v12.4 no es la casa de la base de usuarios: es la SEMILLA de la mudanza al VPS y nada más
 * (ver usuarios/vps.ts). Se conserva para que la primera computadora que abra el programa después de
 * actualizar pueda copiar el usuarios.json que hoy está en el repositorio; cuando la agencia ya esté
 * migrada, TOKEN_DATOS se puede vaciar y revocar el token.
 */
function almacenDeGitHub(enDesarrollo: boolean): AlmacenGitHub | null {
  const tokens = enDesarrollo ? [process.env.DM_GESTION_TOKEN_DATOS ?? ''] : [TOKEN_DATOS, TOKEN_DATOS_ANTERIOR]
  if (!tokens.some((t) => t.trim() !== '')) return null
  return new AlmacenGitHub({
    repo: REPO_DATOS,
    tokens,
    urlBase: enDesarrollo ? process.env.DM_GESTION_GITHUB_API : undefined,
    archivo: enDesarrollo ? process.env.DM_GESTION_ARCHIVO_DATOS : undefined,
  })
}

/**
 * La base de usuarios en el VPS, que es donde vive desde la v12.4.
 *
 * En desarrollo NUNCA se toca el VPS real, igual que con la base del GENERAL DE CLIENTES: sólo se
 * habla con un servidor si `DM_GESTION_VPS_URL` apunta a uno (el simulador). Así `npm run dev`,
 * `sembrar` y los scripts de humo no pueden escribir la lista de usuarios de la agencia.
 */
function almacenDelVps(enDesarrollo: boolean, semilla: AlmacenGitHub | null): AlmacenVps | null {
  const credenciales = enDesarrollo
    ? process.env.DM_GESTION_VPS_URL
      ? { urlBase: process.env.DM_GESTION_VPS_URL, token: process.env.DM_GESTION_VPS_TOKEN ?? 'prueba' }
      : null
    : credencialesVps()
  if (!credenciales) return null
  try {
    return new AlmacenVps({ ...credenciales, semilla })
  } catch (error) {
    // Una URL mal escrita en el config.json no puede dejar el programa sin abrir: se anota y se sigue
    // con lo que haya (GitHub durante la mudanza, o usuarios locales).
    console.error('[usuarios] No se pudo preparar la base de usuarios del VPS:', detalleDelError(error))
    return null
  }
}

/**
 * Base de usuarios compartida. Desde la v12.4 la casa es el VPS de la agencia y GitHub queda sólo como
 * semilla de la mudanza; en desarrollo arranca en modo local salvo que se pida lo contrario por
 * variable de entorno, para que `npm run dev`, `sembrar` y los scripts de humo nunca toquen nada real.
 *   DM_GESTION_VPS_URL        servidor del puente (sólo desarrollo: el simulador)
 *   DM_GESTION_VPS_TOKEN      token del puente (sólo desarrollo; por defecto el del simulador)
 *   DM_GESTION_TOKEN_DATOS    token de GitHub para la semilla (sólo desarrollo)
 *   DM_GESTION_GITHUB_API     URL base de la API de GitHub (sólo desarrollo: simulador local o puerto cerrado = «sin internet»)
 *   DM_GESTION_ARCHIVO_DATOS  otro archivo dentro del repo (sólo desarrollo: probar contra GitHub real sin tocar usuarios.json)
 */
function prepararBaseDeUsuarios(): void {
  const enDesarrollo = !app.isPackaged
  const github = almacenDeGitHub(enDesarrollo)
  const vps = almacenDelVps(enDesarrollo, github)
  // El VPS manda. GitHub sólo sigue siendo el almacén mientras el VPS no esté disponible en esta
  // versión (desarrollo sin simulador), y en ese caso se comporta exactamente como antes.
  const almacen = vps ?? github

  const cifrador = {
    disponible: () => safeStorage.isEncryptionAvailable(),
    cifrar: (texto: string) => safeStorage.encryptString(texto),
    descifrar: (datos: Buffer) => safeStorage.decryptString(datos),
  }
  configurarBaseDeUsuarios({
    almacen,
    credenciales: new AlmacenDeCredencial(path.join(carpetaDatos(), 'credencial.bin'), cifrador),
    sinTokenEnProduccion: !enDesarrollo && !almacen,
    version: app.getVersion(),
  })
  if (almacen) console.log(`[usuarios] Base de usuarios: ${almacen.descripcion}.`)
  else console.log(enDesarrollo ? '[usuarios] Desarrollo sin DM_GESTION_VPS_URL: usuarios locales.' : '[usuarios] Versión publicada sin servidor de usuarios: usuarios locales.')
}

/**
 * Engancha la mensajería a las dos cosas de las que depende para andar sola: la sesión (el cartero
 * reparte para quien está usando el programa, así que arranca al ingresar y para al salir) y la
 * subida de archivos (un mensaje con adjuntos sale recién cuando sus archivos están arriba: cuando
 * termina de subir el último, hay que despertar al cartero para que el mensaje salga ahora y no en
 * la vuelta siguiente).
 */
function engancharLaMensajeria(): void {
  alCambiarLaSesion((quien) => {
    if (quien) {
      arrancarCartero(quien)
      // Recién con sesión hay a qué sucursal atribuirle el reporte: se manda apenas se ingresa, sin
      // esperar al próximo chequeo de los 15 minutos, para que el superadministrador vea la versión
      // al día ni bien alguien abre el programa.
      reportarVersionPropia()
    } else pararCartero()
  })
  alSubirUnAdjunto((tipo) => {
    if (tipo === 'mensaje') apurarAlCartero()
  })
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
  if (!paso('la mensajería interna', engancharLaMensajeria)) return
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
      // El cartero puede estar esperando hasta veinticinco segundos en el long-poll: sin este corte,
      // cerrar el programa esperaría a que el pedido termine solo.
      ['la mensajería', pararCartero],
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
