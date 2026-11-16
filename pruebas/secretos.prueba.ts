// Los secretos no se escriben en el código (18.1.3).
//
// Este repositorio es público. Hasta la 18.1.2 tenía escritos el token del puente con el servidor de la
// agencia y un token de GitHub: con el primero se lee y se escribe la cartera entera. Ahora el del puente
// se pone al armar el instalador, desde los secretos de GitHub Actions (scripts/secretos-de-fabrica.mjs),
// y el de GitHub no existe más. Estas pruebas están para que no vuelvan: si alguien pega un token en el
// código «un momento, para probar», el banco de pruebas se cae antes de que llegue a GitHub.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DE_FABRICA, ponerSecretosDeFabrica, secretosDeFabricaQueFaltan, valorDeFabrica } from '../scripts/secretos-de-fabrica.mjs'

const raiz = process.cwd()
const leer = (archivo: string) => readFileSync(join(raiz, archivo), 'utf8')

function archivosDe(carpeta: string): string[] {
  return readdirSync(join(raiz, carpeta)).flatMap((nombre) => {
    const relativo = `${carpeta}/${nombre}`
    return statSync(join(raiz, relativo)).isDirectory() ? archivosDe(relativo) : [relativo]
  })
}

const TOKEN = 'token-de-mentira-0123456789abcdef'
const CONFIG = '/home/alguien/dm-gestion/src/main/servicios/config.ts'

test('en el código, las constantes de los tokens están vacías', () => {
  for (const { archivo, constante } of DE_FABRICA) {
    assert.match(leer(archivo), new RegExp(`\\bconst ${constante} = ''`), `${constante} tiene que estar vacía en ${archivo}: su valor es un secreto de GitHub Actions`)
  }
  const github = leer('src/main/usuarios/github.ts')
  assert.match(github, /export const TOKEN_DATOS = ''/)
  assert.match(github, /export const TOKEN_DATOS_ANTERIOR = ''/)
})

test('ningún archivo del programa trae algo con forma de token de GitHub', () => {
  // `github_pat_…` (fine-grained) y `ghp_…`/`gho_…`/`ghs_…` (los clásicos y los de las apps).
  const formaDeToken = /\b(github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{30,})/
  const conToken = ['src', 'scripts', 'pruebas', '.github']
    .flatMap(archivosDe)
    .filter((archivo) => /\.(ts|tsx|mts|mjs|js|json|yml|yaml)$/.test(archivo))
    .filter((archivo) => formaDeToken.test(leer(archivo)))
  assert.deepEqual(conToken, [])
})

test('al armar el instalador, el token sale del entorno y queda en su constante', () => {
  const codigo = "const VPS_URL_BASE = 'https://ejemplo.com'\nconst VPS_TOKEN = ''\nexport const otra = ''\n"

  const armado = ponerSecretosDeFabrica(CONFIG, codigo, { DMG_FABRICA_VPS_TOKEN: `  ${TOKEN}\n` })

  assert.equal(armado, `const VPS_URL_BASE = 'https://ejemplo.com'\nconst VPS_TOKEN = '${TOKEN}'\nexport const otra = ''\n`)
  // En Windows la ruta llega con barras invertidas.
  assert.ok(ponerSecretosDeFabrica('C:\\dm\\src\\main\\servicios\\config.ts', codigo, { DMG_FABRICA_VPS_TOKEN: TOKEN })?.includes(TOKEN))
})

test('sin la variable (desarrollo, pruebas) y en cualquier otro archivo, no toca nada', () => {
  const codigo = "const VPS_TOKEN = ''\n"
  assert.equal(ponerSecretosDeFabrica(CONFIG, codigo, {}), null)
  assert.equal(ponerSecretosDeFabrica(CONFIG, codigo, { DMG_FABRICA_VPS_TOKEN: '   ' }), null)
  assert.equal(ponerSecretosDeFabrica('/home/alguien/dm-gestion/src/main/otro.ts', codigo, { DMG_FABRICA_VPS_TOKEN: TOKEN }), null)
  assert.deepEqual(secretosDeFabricaQueFaltan({}).map((falta) => falta.secreto), ['DMG_VPS_TOKEN'])
  assert.deepEqual(secretosDeFabricaQueFaltan({ DMG_FABRICA_VPS_TOKEN: TOKEN }), [])
})

test('un valor que no tiene forma de token no entra al programa', () => {
  for (const malo of ["x'; require('child_process'); '", 'corto', 'con espacios en el medio 0123456789', 'con\\barra-0123456789abcdef', 'ñandú-0123456789-abcdef-0123']) {
    assert.throws(() => valorDeFabrica('DMG_FABRICA_VPS_TOKEN', { DMG_FABRICA_VPS_TOKEN: malo }), /no tiene forma de token/, malo)
    assert.throws(() => ponerSecretosDeFabrica(CONFIG, "const VPS_TOKEN = ''\n", { DMG_FABRICA_VPS_TOKEN: malo }), /no tiene forma de token/, malo)
  }
})

test('si alguien vuelve a escribir el token en el código, compilar falla', () => {
  assert.throws(
    () => ponerSecretosDeFabrica(CONFIG, `const VPS_TOKEN = '${TOKEN}'\n`, { DMG_FABRICA_VPS_TOKEN: TOKEN }),
    /tiene un valor escrito/,
  )
  // Y si la constante cambia de nombre, también: el instalador saldría sin token y nadie se enteraría.
  assert.throws(() => ponerSecretosDeFabrica(CONFIG, "const TOKEN_DEL_VPS = ''\n", { DMG_FABRICA_VPS_TOKEN: TOKEN }), /No se encontró VPS_TOKEN/)
})

test('los workflows que arman el instalador de la agencia le pasan el secreto, y el de la demo no', () => {
  const paso = 'DMG_FABRICA_VPS_TOKEN: ${{ secrets.DMG_VPS_TOKEN }}'
  for (const workflow of ['publicar.yml', 'publicar-beta.yml']) {
    const texto = leer(`.github/workflows/${workflow}`)
    assert.ok(texto.includes(paso), `${workflow} tiene que pasarle el secreto a la compilación`)
    assert.ok(texto.includes('node scripts/verificar-fabrica.mjs --antes'), `${workflow} comprueba el secreto antes de las pruebas`)
    assert.match(texto, /node scripts\/verificar-fabrica\.mjs\r?\n/, `${workflow} comprueba que el programa compilado lo lleve`)
  }
  assert.equal(leer('.github/workflows/publicar-demo.yml').includes('DMG_'), false, 'la demo se arma sin ningún secreto de la agencia')
})
