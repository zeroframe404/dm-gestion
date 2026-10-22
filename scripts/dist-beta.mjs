// Arma el instalador de la BETA: el mismo programa, pero instalable al lado del normal sin pisarlo.
//
// Lo que cambia respecto de `npm run dist` (que sigue siendo el de la estable, sin tocarlo):
//   - appId distinto → Windows lo ve como OTRO programa: su propio desinstalador, su propio registro y su
//     propia carpeta de instalación. Instalar la beta no actualiza ni desinstala la estable, ni al revés.
//   - Nombre y accesos directos propios («DM Gestión (Beta)»), y el ejecutable se llama como el producto,
//     así que el instalador de una no cierra ni reemplaza el programa abierto de la otra.
//   - Archivos `DM-Gestion-Beta-Setup-<versión>.exe` y el archivo de actualización `beta.yml` (no
//     `latest.yml`, que es el de la estable).
//
// La versión (17.7.3-beta.41) ya tiene que estar puesta en el package.json de la copia de trabajo: la
// estampa el workflow (ver `scripts/version-beta.mjs`). Si no trae `-beta`, esto se niega a seguir, para
// no generar jamás un instalador «beta» con una versión estable que después se actualice solo desde el
// Release equivocado.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'))

if (!/-beta\.\d+$/.test(version)) {
  console.error(`[dist-beta] El package.json dice ${version}: para la beta tiene que ser X.Y.Z-beta.N (corré antes «node scripts/version-beta.mjs <corrida>» y estampalo con «npm version … --no-git-tag-version»).`)
  process.exit(1)
}

const electronBuilder = path.join(raiz, 'node_modules', 'electron-builder', 'cli.js')
const args = [
  electronBuilder,
  '--win',
  '--config', 'electron-builder.yml',
  '--publish', 'never',
  '-c.appId=ar.com.dmartinezseguros.gestion.beta',
  '-c.productName=DM Gestión (Beta)',
  '-c.artifactName=DM-Gestion-Beta-Setup-${version}.${ext}',
  '-c.nsis.shortcutName=DM Gestión (Beta)',
  '-c.publish.channel=beta',
]

console.log(`[dist-beta] Armando el instalador de la beta ${version}`)
execFileSync(process.execPath, args, { cwd: raiz, stdio: 'inherit' })
