// Freno de `npm version`: no dejar publicar desde una copia que está atrasada respecto de GitHub.
//
// Pasó dos veces seguidas. Se mergea un arreglo en master desde la web, se corre `npm version patch`
// en la computadora sin haber hecho `git pull`, y el tag queda apuntando a un commit que NO tiene ese
// arreglo. El workflow compila y firma el instalador entero —seis minutos— y recién ahí se cae, con el
// Release sin crear y el número de versión ya quemado.
//
// El tag es lo que se publica: si la copia local está atrasada, lo que sale no es lo que dice master.
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..')

function git(...args) {
  return execFileSync('git', args, { cwd: raiz, encoding: 'utf8' }).trim()
}

function abortar(...lineas) {
  for (const linea of lineas) console.error(`[version] ${linea}`)
  process.exit(1)
}

try {
  git('fetch', 'origin', 'master', '--quiet')
} catch {
  // Sin internet no se puede comparar. Mejor frenar que publicar a ciegas: el instalador que sale de
  // acá se instala solo en las computadoras de la agencia.
  abortar('No se pudo consultar GitHub para ver si esta copia está al día.', 'Conectate y probá de nuevo.')
}

// `origin/master` tiene que ser ancestro de lo que estás por etiquetar. Estar ADELANTE está bien
// (commits locales todavía sin subir); estar ATRÁS o en una rama divergente, no.
try {
  git('merge-base', '--is-ancestor', 'origin/master', 'HEAD')
} catch {
  const faltan = git('rev-list', '--count', 'HEAD..origin/master')
  abortar(
    `Esta copia está atrasada: le faltan ${faltan} commit(s) que ya están en master.`,
    'Si etiquetás así, el tag va a apuntar a un commit sin esos cambios y la publicación va a salir mal.',
    'Corré:  git checkout master && git pull',
  )
}

console.log('[version] La copia está al día con master.')
