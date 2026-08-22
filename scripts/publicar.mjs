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
try {
  execFileSync('git', ['rev-parse', tag], { cwd: raiz, stdio: 'ignore' })
} catch {
  execFileSync('git', ['tag', tag], { cwd: raiz, stdio: 'inherit' })
}
execFileSync('git', ['push', 'origin', tag], { cwd: raiz, stdio: 'inherit' })

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
