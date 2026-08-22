// Arranque de desarrollo:
//  - Vite sirve el renderer con recarga en caliente.
//  - El proceso principal y la precarga se compilan en modo "watch".
//  - Electron se lanza apuntando al servidor de Vite y se reinicia cuando cambia main/preload.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build, createServer } from 'vite'

const require = createRequire(import.meta.url)
/** El paquete `electron` exporta la ruta al ejecutable. */
const rutaElectron = require('electron')

let procesoElectron = null
let servidor = null
let cerrando = false
const observadores = []

function registrar(mensaje) {
  console.log('[dev] ' + mensaje)
}

/** Compila un target de Vite en modo watch y avisa en cada reconstrucción posterior a la primera. */
function observar(archivoConfig, alReconstruir) {
  return new Promise((resolver, rechazar) => {
    build({
      configFile: archivoConfig,
      mode: 'development',
      logLevel: 'warn',
      build: { watch: {} },
    }).then((observador) => {
      observadores.push(observador)
      let primeraVez = true
      observador.on('event', (evento) => {
        if (evento.code === 'ERROR') {
          console.error(evento.error)
          if (primeraVez) rechazar(evento.error)
        }
        if (evento.code === 'END') {
          if (primeraVez) {
            primeraVez = false
            resolver(observador)
          } else {
            alReconstruir()
          }
        }
      })
    }, rechazar)
  })
}

function lanzarElectron(urlServidor) {
  if (procesoElectron) {
    procesoElectron.removeAllListeners('exit')
    procesoElectron.kill()
    procesoElectron = null
  }
  procesoElectron = spawn(rutaElectron, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: urlServidor },
  })
  procesoElectron.on('exit', (codigo) => {
    // Si el usuario cerró la ventana, terminamos todo.
    if (!cerrando) terminar(codigo ?? 0)
  })
}

async function terminar(codigo) {
  if (cerrando) return
  cerrando = true
  if (procesoElectron) {
    procesoElectron.removeAllListeners('exit')
    procesoElectron.kill()
  }
  await Promise.allSettled(observadores.map((observador) => observador.close()))
  if (servidor) await servidor.close()
  process.exit(codigo)
}

process.on('SIGINT', () => terminar(0))
process.on('SIGTERM', () => terminar(0))

try {
  servidor = await createServer({ configFile: 'vite.config.mts', mode: 'development' })
  await servidor.listen()
  const url = servidor.resolvedUrls?.local[0]
  if (!url) throw new Error('Vite no informó la URL del servidor de desarrollo.')
  registrar('Renderer en ' + url)

  await observar('vite.preload.config.mts', () => {
    registrar('Precarga reconstruida, reiniciando Electron...')
    lanzarElectron(url)
  })
  await observar('vite.main.config.mts', () => {
    registrar('Proceso principal reconstruido, reiniciando Electron...')
    lanzarElectron(url)
  })

  registrar('Lanzando Electron...')
  lanzarElectron(url)
} catch (error) {
  console.error(error)
  await terminar(1)
}
