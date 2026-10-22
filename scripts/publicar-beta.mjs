// Publica el instalador de la beta en el Release fijo «beta-canal» del repositorio.
//
// A diferencia de `publicar.mjs` (un Release por versión), la beta usa UN solo Release, marcado como
// prerelease, cuyos archivos se reemplazan en cada publicación. Es lo que hace la actualización de la
// beta tan simple y tan a prueba de tontos: el programa beta siempre mira la misma dirección
// (`.../releases/download/beta-canal/beta.yml`) y no le importa qué versiones estables se publiquen
// alrededor. Y como es prerelease, la estable —que sólo mira «el último Release que no es prerelease»—
// no lo ve nunca. Ver `src/main/canal.ts` y `src/main/servicios/updater.ts`.
//
// El ORDEN de subida importa: primero el instalador y el .blockmap, y recién al final `beta.yml`, que es
// lo que apunta a ellos. Si algo se corta a mitad, `beta.yml` sigue apuntando al instalador anterior,
// que todavía existe; los archivos viejos se borran DESPUÉS de que el nuevo ya está en su lugar.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'))
const REPO = 'zeroframe404/dm-gestion'
const TAG = 'beta-canal'

if (!/-beta\.\d+$/.test(version)) {
  console.error(`[publicar-beta] El package.json dice ${version}: la beta sólo publica versiones X.Y.Z-beta.N.`)
  process.exit(1)
}

const instalador = `DM-Gestion-Beta-Setup-${version}.exe`
const archivos = [instalador, `${instalador}.blockmap`, 'beta.yml'].map((nombre) => path.join(raiz, 'release', nombre))
for (const archivo of archivos) {
  if (!existsSync(archivo)) {
    console.error(`[publicar-beta] Falta ${archivo}. Corré «npm run dist:beta» antes de publicar.`)
    process.exit(1)
  }
}

function gh(args, opciones = {}) {
  return execFileSync('gh', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opciones })
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: raiz, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

// Qué trae esta beta: los últimos cambios de la rama, para que el Release diga algo útil.
const sha = process.env.GITHUB_SHA || git(['rev-parse', 'HEAD'])
const cambios = git(['log', '-10', '--no-merges', '--pretty=format:- %s']) || '- (sin detalle)'
const notas = `Beta ${version}\n\nCompilación automática de la rama \`beta\` (${sha.slice(0, 7)}). No es la versión de la agencia.\n\nÚltimos cambios:\n${cambios}\n`

let existe = true
try {
  gh(['release', 'view', TAG, '-R', REPO, '--json', 'tagName'])
} catch {
  existe = false
}

if (existe) {
  // Siempre prerelease y nunca «Latest»: si alguien lo tocara a mano, la estable empezaría a ofrecerlo.
  gh(['release', 'edit', TAG, '-R', REPO, '--title', `Beta ${version}`, '--notes', notas, '--prerelease', '--latest=false'])
} else {
  gh(['release', 'create', TAG, '-R', REPO, '--title', `Beta ${version}`, '--notes', notas, '--prerelease', '--latest=false', '--target', sha])
}

const [rutaInstalador, rutaBlockmap, rutaYml] = archivos
gh(['release', 'upload', TAG, rutaInstalador, rutaBlockmap, '-R', REPO, '--clobber'], { stdio: 'inherit' })
gh(['release', 'upload', TAG, rutaYml, '-R', REPO, '--clobber'], { stdio: 'inherit' })

// Con la beta nueva en su lugar, se borran los instaladores de las anteriores: el Release no es un
// historial, y cada uno pesa unos 130 MB.
const vigentes = new Set([instalador, `${instalador}.blockmap`, 'beta.yml'])
const assets = JSON.parse(gh(['release', 'view', TAG, '-R', REPO, '--json', 'assets'])).assets ?? []
for (const asset of assets) {
  if (vigentes.has(asset.name) || !asset.name.startsWith('DM-Gestion-Beta-Setup-')) continue
  console.log(`[publicar-beta] Borro ${asset.name} (de una beta anterior).`)
  gh(['release', 'delete-asset', TAG, asset.name, '-R', REPO, '--yes'], { stdio: 'inherit' })
}

console.log(`[publicar-beta] Listo: https://github.com/${REPO}/releases/tag/${TAG} (${version})`)
