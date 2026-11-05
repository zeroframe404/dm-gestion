// Publica el instalador de la demo en el Release fijo «demo» del repositorio: un solo enlace para
// mandarle a una agencia interesada, que siempre lleva a la demo más nueva.
//
// Por defecto va al repositorio público de la demo (zeroframe404/cobertia-demo), con su guía como README.
// Si se publica en el del programa (DEMO_REPO, desde Actions) es prerelease y nunca «Latest». La demo no se actualiza sola (no hay .yml que publicar), y de
// cada demo anterior se borra el instalador después de subir el nuevo.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
// Repositorio público propio de la demo: el enlace que se le pasa a un cliente no dice «dm-gestion».
// Desde Actions (sin permiso sobre otro repositorio) se puede pisar con DEMO_REPO.
const REPO = process.env.DEMO_REPO || 'zeroframe404/cobertia-demo'
const TAG = 'demo'

const instaladores = existsSync(path.join(raiz, 'release'))
  ? readdirSync(path.join(raiz, 'release')).filter((nombre) => /^Cobertia-Demo-Setup-.+-demo\.\d+\.exe$/.test(nombre))
  : []
if (instaladores.length !== 1) {
  console.error(`[publicar-demo] Tiene que haber exactamente un instalador de la demo en release/ (hay ${instaladores.length}). Corré «npm run dist:demo».`)
  process.exit(1)
}
const instalador = instaladores[0]
const version = instalador.replace('Cobertia-Demo-Setup-', '').replace(/\.exe$/, '')

function gh(args, opciones = {}) {
  return execFileSync('gh', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opciones })
}

const sha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
// El repositorio del programa de la agencia. Cualquier otro es el público de la demo, que no tiene el
// código: ahí un `--target <sha>` apunta a un commit que no existe y `gh release create` falla.
const REPO_DEL_PROGRAMA = 'zeroframe404/dm-gestion'
const esElRepoDelPrograma = REPO === REPO_DEL_PROGRAMA

// Las notas las lee la agencia a la que se le manda el enlace: hablan de Cobertia, nunca del programa
// de la agencia, y sin el hash del commit cuando el Release vive en el repositorio público de la demo.
// La guía vive en docs/ del repositorio del programa; en el de la demo es su README.
const GUIA = esElRepoDelPrograma ? `https://github.com/${REPO}/blob/HEAD/docs/GUIA-COBERTIA-DEMO.md` : `https://github.com/${REPO}#readme`
// En el repositorio del programa la demo es prerelease y nunca «Latest» (la estable mira el último
// Release que no lo es). En el público de la demo es lo único que hay: va como «Latest».
const marcas = esElRepoDelPrograma ? ['--prerelease', '--latest=false'] : ['--latest']
const notas = [
  `Cobertia (Demo) ${version}`,
  '',
  'Versión de demostración de Cobertia, el programa de gestión para agencias y productores de seguros: cartera, cobranzas, renovaciones, siniestros, multicotizador y más, con datos de ejemplo.',
  '',
  'No se conecta a internet: el servidor y las APIs de las compañías están simulados adentro del propio programa, así que no se manda ni se baja nada. Cada vez que se abre vuelve a empezar con los mismos datos de ejemplo.',
  '',
  'Para entrar: usuario `test`, contraseña `admin` (en la pantalla de ingreso están también los demás usuarios de ejemplo, uno por rol).',
  '',
  `Guía de la demo: ${GUIA}`,
  ...(esElRepoDelPrograma ? ['', `Compilación de ${sha.slice(0, 7)}.`] : []),
].join('\n')

let existe = true
try {
  gh(['release', 'view', TAG, '-R', REPO, '--json', 'tagName'])
} catch {
  existe = false
}
if (existe) gh(['release', 'edit', TAG, '-R', REPO, '--title', `Cobertia (Demo) ${version}`, '--notes', notas, ...marcas])
else {
  // Sin --target, gh crea la etiqueta en la rama por defecto del repositorio destino (ver arriba).
  const destino = esElRepoDelPrograma ? ['--target', sha] : []
  gh(['release', 'create', TAG, '-R', REPO, '--title', `Cobertia (Demo) ${version}`, '--notes', notas, ...marcas, ...destino])
}

gh(['release', 'upload', TAG, path.join(raiz, 'release', instalador), '-R', REPO, '--clobber'], { stdio: 'inherit' })

const assets = JSON.parse(gh(['release', 'view', TAG, '-R', REPO, '--json', 'assets'])).assets ?? []
for (const asset of assets) {
  if (asset.name === instalador) continue
  console.log(`[publicar-demo] Borro ${asset.name} (de una demo anterior).`)
  gh(['release', 'delete-asset', TAG, asset.name, '-R', REPO, '--yes'], { stdio: 'inherit' })
}

console.log(`[publicar-demo] Listo: https://github.com/${REPO}/releases/tag/${TAG} (${version})`)
