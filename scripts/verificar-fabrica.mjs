// Antes de publicar un instalador: que lleve adentro lo que necesita para hablar con el servidor, y que
// el código no lleve nada.
//
//   node scripts/verificar-fabrica.mjs --antes    sólo que los secretos estén cargados (para fallar al
//                                                 principio, antes de los cinco minutos de pruebas)
//   node scripts/verificar-fabrica.mjs            además, que hayan quedado en dist/main/index.js
//
// Un instalador sin el token del puente deja a todas las computadoras sin poder ingresar ni sincronizar,
// y se instala solo: por eso esto corta la publicación en vez de avisar. Nunca imprime un valor.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { DE_FABRICA, secretosDeFabricaQueFaltan, valorDeFabrica } from './secretos-de-fabrica.mjs'

const raiz = path.resolve(import.meta.dirname, '..')
const soloAntes = process.argv.includes('--antes')

function cortar(...lineas) {
  for (const linea of lineas) console.error(`[fabrica] ${linea}`)
  process.exit(1)
}

let faltan
try {
  faltan = secretosDeFabricaQueFaltan()
} catch (error) {
  cortar(error instanceof Error ? error.message : String(error))
}
if (faltan.length > 0) {
  cortar(
    ...faltan.map(({ secreto, queEs }) => `Falta el secreto «${secreto}»: ${queEs}.`),
    'Se cargan en GitHub: Settings → Secrets and variables → Actions → New repository secret.',
    'Sin eso el instalador saldría sin poder hablar con el servidor, así que no se arma.',
  )
}

// El código no puede traer un valor escrito: es lo que este mecanismo vino a sacar.
for (const { archivo, constante } of DE_FABRICA) {
  const escrito = new RegExp(`\\bconst ${constante}\\s*=\\s*'([^']*)'`).exec(readFileSync(path.join(raiz, archivo), 'utf8'))
  if (!escrito) cortar(`No encontré ${constante} en ${archivo}.`)
  if (escrito[1] !== '') cortar(`${constante} tiene un valor escrito en ${archivo}. En el código va vacía.`)
}

if (soloAntes) {
  console.log(`[fabrica] Secretos de fábrica cargados: ${DE_FABRICA.length}.`)
  process.exit(0)
}

const compilado = path.join(raiz, 'dist', 'main', 'index.js')
if (!existsSync(compilado)) cortar('Falta dist/main/index.js: primero hay que compilar (npm run build).')
const texto = readFileSync(compilado, 'utf8')
for (const { constante, variable } of DE_FABRICA) {
  if (!texto.includes(`'${valorDeFabrica(variable)}'`) && !texto.includes(`"${valorDeFabrica(variable)}"`)) {
    cortar(`El programa compilado no lleva ${constante}: se compiló sin el secreto. No se publica.`)
  }
}
console.log('[fabrica] El programa compilado lleva los secretos de fábrica, y el código no trae ninguno escrito.')
