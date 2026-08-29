// El manual en PDF desde la línea de comandos, sin abrir la aplicación.
//
// Sirve para dos cosas: sacar una copia para imprimir sin tener que entrar al programa, y poder
// revisar cómo quedó el manual mientras se lo escribe. Dentro de la aplicación el camino es otro
// —el botón «Descargar el manual», que usa printToPDF de Electron—, pero el HTML es exactamente el
// mismo archivo, así que lo que se ve acá es lo que va a salir allá.
//
//   npm run manual              → release/DM Gestion - Manual <version>.pdf
//   npm run manual -- salida.pdf
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const raiz = path.dirname(fileURLToPath(new URL('.', import.meta.url)))
const requerir = createRequire(import.meta.url)

const empaquetado = path.join(raiz, 'dist/manual/manual.js')
if (!existsSync(empaquetado)) {
  console.error('Falta dist/manual/manual.js. Corré primero: npx vite build -c vite.manual.config.mts')
  process.exit(1)
}

const { htmlDelManual, nombreDelManual } = requerir(empaquetado)
const paquete = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'))

// El logo va embebido y no por ruta: la ventana que imprime carga el HTML desde otra carpeta y una
// imagen que no carga sale peor que no ponerla.
const rutaDelLogo = path.join(raiz, 'recursos/icon.png')
const logo = existsSync(rutaDelLogo) ? `data:image/png;base64,${readFileSync(rutaDelLogo).toString('base64')}` : ''

const fecha = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
const html = htmlDelManual({ version: paquete.version, fecha, logo })

const salida = process.argv[2] ?? path.join(raiz, 'release', nombreDelManual(paquete.version))
mkdirSync(path.dirname(salida), { recursive: true })

const temporal = path.join(raiz, 'dist/manual/manual.html')
writeFileSync(temporal, html, 'utf8')

// Chromium: el de Playwright si está (entornos de desarrollo Linux), y si no, el del sistema.
const candidatos = [
  process.env.CHROMIUM_BIN,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean)
const navegador = candidatos.find((candidato) => existsSync(candidato))
if (!navegador) {
  console.error('No se encontró Chromium. Poné la ruta en CHROMIUM_BIN, o usá el botón «Descargar el manual» del programa.')
  process.exit(1)
}

execFileSync(
  navegador,
  [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-pdf-header-footer',
    `--print-to-pdf=${salida}`,
    `file://${temporal}`,
  ],
  { stdio: 'inherit' },
)
rmSync(temporal, { force: true })
console.log(`Manual generado: ${salida}`)
