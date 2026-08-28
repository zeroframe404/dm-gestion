// Publica la versión actual del package.json como GitHub Release del repositorio privado.
//
// No se usa "electron-builder --publish": en pruebas creaba dos objetos de Release para el
// mismo tag en paralelo (carrera interna de electron-builder) y repartía los archivos entre las
// dos copias al azar — a veces "latest.yml" quedaba en la que no tiene el instalador, y
// electron-updater no lo encontraba. "gh release create" en un solo llamado es atómico.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'))
const tag = `v${version}`
const REPO = 'zeroframe404/dm-gestion'

// Una versión publicada sin el token de la base de usuarios compartida deja a las computadoras
// trabajando con usuarios locales (y, si ya migraron, sin poder ingresar): no se publica así.
// Para publicar igual, a propósito: `node scripts/publicar.mjs --sin-base-de-usuarios`.
const fuenteGithub = readFileSync(path.join(raiz, 'src/main/usuarios/github.ts'), 'utf8')
const tokenVacio = /export const TOKEN_DATOS = ''/.test(fuenteGithub)
if (tokenVacio && !process.argv.includes('--sin-base-de-usuarios')) {
  console.error('[publicar] TOKEN_DATOS está vacío en src/main/usuarios/github.ts: la base de usuarios compartida no funcionaría en las PCs.')
  console.error('[publicar] Pegá el fine-grained PAT (ver README, «Base de usuarios compartida») o publicá con --sin-base-de-usuarios.')
  process.exit(1)
}

// Lo mismo con el puente del VPS (v12): una versión sin token deja a todas las PCs sin poder
// sincronizar la cartera contra la base del servidor.
const fuenteVpsConfig = readFileSync(path.join(raiz, 'src/main/servicios/config.ts'), 'utf8')
const vpsSinToken = /const VPS_TOKEN = ''/.test(fuenteVpsConfig) || /const VPS_URL_BASE = ''/.test(fuenteVpsConfig)
if (vpsSinToken && !process.argv.includes('--sin-base-vps')) {
  console.error('[publicar] VPS_TOKEN o VPS_URL_BASE están vacíos en src/main/servicios/config.ts: la cartera no podría sincronizar con el VPS.')
  console.error('[publicar] Completalos (ver README, «La base en el VPS») o publicá con --sin-base-vps.')
  process.exit(1)
}

const archivos = [
  `DM-Gestion-Setup-${version}.exe`,
  `DM-Gestion-Setup-${version}.exe.blockmap`,
  'latest.yml',
].map((nombre) => path.join(raiz, 'release', nombre))

for (const archivo of archivos) {
  if (!existsSync(archivo)) {
    console.error(`[publicar] Falta ${archivo}. Corré "npm run build" seguido de electron-builder antes de publicar.`)
    process.exit(1)
  }
}

function gh(args) {
  execFileSync('gh', args, { cwd: raiz, stdio: 'inherit' })
}

// Empuja el tag si todavía no está en GitHub: "gh release create" lo necesita para anclar el Release.
//
// Cuando la publicación la dispara el propio tag (`npm version patch` empuja el tag y eso arranca el
// workflow), el tag YA está en GitHub y no hay nada que empujar. Y empujarlo igual no era inofensivo:
// `npm version` crea un tag ANOTADO, mientras que el `git tag` de acá abajo crea uno liviano y
// `actions/checkout` deja en el runner el commit pelado. Los dos objetos no son el mismo, así que git
// rechazaba el push con «tag already exists» y se caía la publicación con el instalador ya compilado.
// Por eso se pregunta por el tag REMOTO, no por el local.
function estaEnGitHub() {
  const salida = execFileSync('git', ['ls-remote', '--tags', 'origin', tag], { cwd: raiz, encoding: 'utf8' })
  return salida.trim() !== ''
}

if (estaEnGitHub()) {
  console.log(`[publicar] El tag ${tag} ya está en GitHub.`)
} else {
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { cwd: raiz, stdio: 'ignore' })
  } catch {
    execFileSync('git', ['tag', tag], { cwd: raiz, stdio: 'inherit' })
  }
  execFileSync('git', ['push', 'origin', tag], { cwd: raiz, stdio: 'inherit' })
}

let yaExiste = true
try {
  execFileSync('gh', ['release', 'view', tag, '-R', REPO], { cwd: raiz, stdio: 'ignore' })
} catch {
  yaExiste = false
}

if (yaExiste) {
  console.log(`[publicar] El Release ${tag} ya existe: reemplazo los archivos.`)
  gh(['release', 'upload', tag, ...archivos, '-R', REPO, '--clobber'])
} else {
  gh(['release', 'create', tag, ...archivos, '-R', REPO, '--title', version, '--notes', `Versión ${version}.`])
}

console.log(`[publicar] Listo: https://github.com/${REPO}/releases/tag/${tag}`)
