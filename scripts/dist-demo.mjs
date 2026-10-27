// Arma el instalador de la DEMO: el mismo programa, con datos de ejemplo y un servidor simulado
// adentro, para mostrárselo a otras agencias. Ver README, «Versión de demostración».
//
// Lo que cambia respecto de `npm run dist`:
//   - Se compila con DM_GESTION_DEMO=1, que saca del proceso principal el token y la dirección del VPS
//     de la agencia y el token de GitHub (ver scripts/secretos-de-la-agencia.mjs). Después se revisa el
//     resultado: si alguno de esos valores sigue adentro, NO se arma el instalador.
//   - La versión lleva el sufijo `-demo.N` (17.7.3-demo.12), que es lo que hace que el programa se sepa
//     demo (ver src/shared/canal.ts). No se toca el package.json: va por `extraMetadata`.
//   - appId, nombre, accesos directos y archivo propios: se instala al lado de la normal y de la beta
//     sin pisarlas, con su carpeta de datos `dm-gestion-demo`.
//   - No se publica en ningún lado ni se actualiza sola: el instalador queda en release/.
//
// Uso: `npm run dist:demo` (en Windows). `-- --sin-instalador` compila y revisa sin llamar a
// electron-builder (para comprobarlo en cualquier sistema). N sale de GITHUB_RUN_NUMBER o de `-- --numero 5`.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { valoresSecretos } from './secretos-de-la-agencia.mjs'

const raiz = path.resolve(import.meta.dirname, '..')
const leer = (archivo) => readFileSync(path.join(raiz, archivo), 'utf8')
const argumentos = process.argv.slice(2)
const sinInstalador = argumentos.includes('--sin-instalador')
const indiceNumero = argumentos.indexOf('--numero')
const numero = Number(indiceNumero >= 0 ? argumentos[indiceNumero + 1] : (process.env.GITHUB_RUN_NUMBER ?? 1))
if (!Number.isInteger(numero) || numero < 1) {
  console.error('[dist-demo] El número de la demo tiene que ser un entero positivo.')
  process.exit(1)
}

const { version: base } = JSON.parse(leer('package.json'))
const partes = /^(\d+)\.(\d+)\.(\d+)/.exec(base)
if (!partes) {
  console.error(`[dist-demo] La versión del package.json («${base}») no tiene la forma X.Y.Z.`)
  process.exit(1)
}
const version = `${partes[1]}.${partes[2]}.${Number(partes[3]) + 1}-demo.${numero}`

const vite = path.join(raiz, 'node_modules', 'vite', 'bin', 'vite.js')
const correr = (args, env = {}) => execFileSync(process.execPath, args, { cwd: raiz, stdio: 'inherit', env: { ...process.env, ...env } })

console.log(`[dist-demo] Compilando la demo ${version} sin los datos de la agencia…`)
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'typecheck'], { cwd: raiz, stdio: 'inherit', shell: process.platform === 'win32' })
for (const config of ['vite.preload.config.mts', 'vite.main.config.mts', 'vite.config.mts']) {
  correr([vite, 'build', '-c', config], { DM_GESTION_DEMO: '1' })
}

// La revisión: ningún valor secreto puede haber sobrevivido en lo que va adentro del instalador.
const secretos = valoresSecretos(leer)
const paquete = ['dist/main/index.js', 'dist/preload/index.js'].map((archivo) => ({ archivo, texto: leer(archivo) }))
const filtrados = secretos.flatMap(({ constante, valor }) =>
  paquete.filter(({ texto }) => texto.includes(valor)).map(({ archivo }) => `${constante} en ${archivo}`),
)
if (filtrados.length > 0) {
  console.error(`[dist-demo] El paquete todavía lleva datos de la agencia: ${filtrados.join(', ')}. No se arma el instalador.`)
  process.exit(1)
}
console.log(`[dist-demo] Revisado: el paquete no lleva ninguno de los ${secretos.length} valores de la agencia.`)

if (sinInstalador) {
  console.log('[dist-demo] --sin-instalador: listo, sin llamar a electron-builder.')
  process.exit(0)
}

const electronBuilder = path.join(raiz, 'node_modules', 'electron-builder', 'cli.js')
console.log(`[dist-demo] Armando el instalador de la demo ${version}`)
correr([
  electronBuilder,
  '--win',
  '--config', 'electron-builder.yml',
  '--publish', 'never',
  `-c.extraMetadata.version=${version}`,
  '-c.appId=ar.com.dmartinezseguros.gestion.demo',
  '-c.productName=DM Gestión (Demo)',
  '-c.artifactName=DM-Gestion-Demo-Setup-${version}.${ext}',
  '-c.nsis.shortcutName=DM Gestión (Demo)',
  '-c.copyright=Copyright © 2026 DM Gestión',
])
