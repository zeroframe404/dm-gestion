// La versión con la que se arma cada instalador beta. No se commitea nunca: el workflow
// `publicar-beta.yml` la estampa en el package.json de SU copia de trabajo antes de compilar, y el
// package.json de la rama sigue diciendo la versión estable.
//
//   17.7.2 (última estable) + corrida 41 del workflow  →  17.7.3-beta.41
//
// Es el PRÓXIMO parche con sufijo `-beta.N`, que es lo que dice la verdad: esa beta es lo que va a
// salir como 17.7.3 cuando se promueva. N es el número de corrida del workflow, que sólo crece, así que
// cada beta es mayor que la anterior para electron-updater (que compara `-beta.9` < `-beta.10` como
// números) y, cuando sale una estable nueva, el próximo parche sube con ella.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** `versionDeBeta('17.7.2', 41)` → `'17.7.3-beta.41'`. Si la base ya trae sufijo se parte de su número base. */
export function versionDeBeta(base, numeroDeCorrida) {
  const coincidencia = /^(\d+)\.(\d+)\.(\d+)/.exec(String(base).trim())
  if (!coincidencia) throw new Error(`La versión base «${base}» no tiene la forma X.Y.Z.`)
  const numero = Number(numeroDeCorrida)
  if (!Number.isInteger(numero) || numero < 1) throw new Error(`El número de corrida «${numeroDeCorrida}» tiene que ser un entero positivo.`)
  const [, mayor, menor, parche] = coincidencia
  return `${mayor}.${menor}.${Number(parche) + 1}-beta.${numero}`
}

// Sólo cuando se lo llama a mano: `node scripts/version-beta.mjs <corrida>` imprime la versión.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const raiz = path.resolve(import.meta.dirname, '..')
  const { version } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'))
  const corrida = process.argv[2] ?? process.env.GITHUB_RUN_NUMBER
  try {
    console.log(versionDeBeta(version, corrida))
  } catch (error) {
    console.error(`[version-beta] ${error.message}`)
    process.exit(1)
  }
}
