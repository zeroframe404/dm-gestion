// Publica el instalador de la demo en el Release fijo «demo» del repositorio: un solo enlace para
// mandarle a una agencia interesada, que siempre lleva a la demo más nueva.
//
// Es prerelease y nunca «Latest», igual que el de la beta: la estable sólo mira el último Release que no
// es prerelease, así que no lo ve nunca. La demo no se actualiza sola (no hay .yml que publicar), y de
// cada demo anterior se borra el instalador después de subir el nuevo.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
const REPO = 'zeroframe404/dm-gestion'
const TAG = 'demo'

const instaladores = existsSync(path.join(raiz, 'release'))
  ? readdirSync(path.join(raiz, 'release')).filter((nombre) => /^DM-Gestion-Demo-Setup-.+-demo\.\d+\.exe$/.test(nombre))
  : []
if (instaladores.length !== 1) {
  console.error(`[publicar-demo] Tiene que haber exactamente un instalador de la demo en release/ (hay ${instaladores.length}). Corré «npm run dist:demo».`)
  process.exit(1)
}
const instalador = instaladores[0]
const version = instalador.replace('DM-Gestion-Demo-Setup-', '').replace(/\.exe$/, '')

function gh(args, opciones = {}) {
  return execFileSync('gh', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opciones })
}

const sha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
const notas = [
  `Demo ${version}`,
  '',
  'Versión de demostración de DM Gestión para mostrar a otras agencias: datos de ejemplo, servidor simulado adentro del programa y APIs de las compañías simuladas. No se conecta a ningún servidor real y vuelve a empezar cada vez que se abre.',
  '',
  'Se instala al lado del programa normal sin tocarlo. Usuario `demo`, contraseña `demo1234` (en la pantalla de ingreso están todos los usuarios de ejemplo).',
  '',
  `Compilación de ${sha.slice(0, 7)}.`,
].join('\n')

let existe = true
try {
  gh(['release', 'view', TAG, '-R', REPO, '--json', 'tagName'])
} catch {
  existe = false
}
if (existe) gh(['release', 'edit', TAG, '-R', REPO, '--title', `Demo ${version}`, '--notes', notas, '--prerelease', '--latest=false'])
else gh(['release', 'create', TAG, '-R', REPO, '--title', `Demo ${version}`, '--notes', notas, '--prerelease', '--latest=false', '--target', sha])

gh(['release', 'upload', TAG, path.join(raiz, 'release', instalador), '-R', REPO, '--clobber'], { stdio: 'inherit' })

const assets = JSON.parse(gh(['release', 'view', TAG, '-R', REPO, '--json', 'assets'])).assets ?? []
for (const asset of assets) {
  if (asset.name === instalador) continue
  console.log(`[publicar-demo] Borro ${asset.name} (de una demo anterior).`)
  gh(['release', 'delete-asset', TAG, asset.name, '-R', REPO, '--yes'], { stdio: 'inherit' })
}

console.log(`[publicar-demo] Listo: https://github.com/${REPO}/releases/tag/${TAG} (${version})`)
