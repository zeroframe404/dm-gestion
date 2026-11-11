// Deja la entrada de «Cambios recientes» con el número de la versión que se está publicando.
//
// En `beta` los renglones se escriben en la entrada del próximo PARCHE (con 18.0.0 en el package.json,
// la entrada es '18.0.1'). Si después se publica con `minor` o `major`, la versión sale 18.1.0 o 19.0.0
// y la entrada '18.0.1' no coincide: el banco de pruebas lo rechaza y, si pasara, el cartel no mostraría
// nada al actualizar. Pasó el 11 de noviembre de 2026 (la 18.1.0 se cayó por esto).
//
// Este script corre al subir la versión (`npm version`, script "version", o el paso «Subir la versión»
// del workflow), con el package.json ya cambiado y antes del commit:
//   - si la primera entrada ya es la versión nueva, no hace nada;
//   - si la primera entrada es una versión pendiente (mayor que la que había), la renombra a la nueva
//     y le pone la fecha de hoy;
//   - si no hay entrada pendiente, frena: no se publica una versión sin decir qué cambió.
//
// Uso: node scripts/ajustar-cambios.mjs <versión anterior>
//      (sin argumento toma la del package.json del último commit).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')
const archivo = path.join(raiz, 'src', 'shared', 'cambios.ts')

const partes = (v) => v.split('-')[0].split('.').map((n) => Number(n) || 0)
function comparar(a, b) {
  const x = partes(a)
  const y = partes(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function abortar(...lineas) {
  for (const linea of lineas) console.error(`[cambios] ${linea}`)
  process.exit(1)
}

const nueva = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8')).version
const anterior =
  process.argv[2] ??
  JSON.parse(execFileSync('git', ['show', 'HEAD:package.json'], { cwd: raiz, encoding: 'utf8' })).version

const fuente = readFileSync(archivo, 'utf8')
const inicio = fuente.indexOf('HISTORIAL_DE_CAMBIOS')
const patron = /version: '([^']+)',\s*\n(\s*)fecha: '([^']+)'/g
patron.lastIndex = inicio
const primera = patron.exec(fuente)
if (inicio < 0 || !primera) abortar(`No encontré el historial en ${archivo}.`)

const [completo, version, sangria] = primera
if (comparar(version, nueva) === 0) {
  console.log(`[cambios] La entrada ${nueva} ya está.`)
  process.exit(0)
}
if (comparar(version, anterior) <= 0) {
  abortar(
    `No hay renglones nuevos en src/shared/cambios.ts para la ${nueva} (la última entrada es la ${version}).`,
    'Cada actualización tiene que decir qué cambió: agregá la entrada arriba de todo y volvé a publicar.',
  )
}
if (comparar(version, nueva) > 0) {
  abortar(`La primera entrada de cambios.ts es la ${version}, más nueva que la ${nueva} que se publica.`)
}

const hoy = new Date().toISOString().slice(0, 10)
const reemplazo = `version: '${nueva}',\n${sangria}fecha: '${hoy}'`
const nuevaFuente = fuente.slice(0, primera.index) + reemplazo + fuente.slice(primera.index + completo.length)
writeFileSync(archivo, nuevaFuente)
console.log(`[cambios] La entrada ${version} pasa a ser la ${nueva} (${hoy}).`)

// Con `npm version`, lo que se agrega acá entra en el mismo commit que el package.json.
try {
  execFileSync('git', ['add', archivo], { cwd: raiz, stdio: 'ignore' })
} catch {
  // Fuera de un repositorio no hay nada que agregar.
}
