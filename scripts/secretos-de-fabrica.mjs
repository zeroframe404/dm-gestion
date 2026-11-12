// Lo que el programa necesita para hablar con el servidor de la agencia y que NO está escrito en el
// código: se le pone al armar el instalador.
//
// POR QUÉ. Este repositorio es público. Hasta la 18.1.2 el token del puente con el VPS estaba escrito en
// `src/main/servicios/config.ts`, a la vista de cualquiera que abriera GitHub: con él se lee y se
// escribe la cartera entera de la agencia. Ahora en el código la constante está vacía, y el valor de
// verdad vive en los secretos de GitHub Actions (Settings → Secrets and variables → Actions). Los
// workflows que arman un instalador (`Publicar`, `Publicar beta`) se lo pasan a Vite por una variable de
// entorno, y este archivo lo pone en su lugar al compilar el proceso principal.
//
// QUÉ NO RESUELVE. El valor sigue viajando adentro del .exe, y el .exe se publica: quien lo quiera lo
// saca de ahí. Lo que hace que ese token valga poco es el servidor (`DMG_EXIGIR_SESION`: con él sólo se
// puede pedir ingresar, y para eso hace falta la contraseña de alguien). Esto evita lo otro: que esté en
// el código, en el historial y en cada copia del repositorio.
//
// La demo no pasa por acá: se arma con `DM_GESTION_DEMO=1` y sin ningún secreto (ver
// secretos-de-la-agencia.mjs, que es el que le SACA las direcciones de la agencia).

/** Archivo → constante que en el código está vacía, y de qué variable de entorno sale su valor al armar. */
export const DE_FABRICA = [
  {
    archivo: 'src/main/servicios/config.ts',
    constante: 'VPS_TOKEN',
    variable: 'DMG_FABRICA_VPS_TOKEN',
    secreto: 'DMG_VPS_TOKEN',
    queEs: 'el token del puente con el servidor de la agencia (el DMG_SYNC_TOKEN del .env del VPS)',
  },
]

/**
 * Lo que puede llevar un token: letras, números y la puntuación de un token en base64 o hexadecimal.
 * Va a quedar escrito entre comillas adentro del programa, así que nada de comillas, barras invertidas
 * ni saltos de línea; y con menos de 16 caracteres no es un token, es un error de tipeo.
 */
const FORMA_DE_UN_TOKEN = /^[A-Za-z0-9._~+/=-]{16,200}$/

function patron(constante) {
  return new RegExp(`(\\bconst ${constante}\\s*=\\s*)'([^']*)'`)
}

/** El valor de fábrica de una constante según el entorno, o '' si no se definió. Lanza si está mal formado. */
export function valorDeFabrica(variable, entorno = process.env) {
  const valor = (entorno[variable] ?? '').trim()
  if (valor === '') return ''
  if (!FORMA_DE_UN_TOKEN.test(valor)) {
    throw new Error(`${variable} no tiene forma de token (de 16 a 200 letras, números o . _ ~ + / = -): no se arma nada con eso.`)
  }
  return valor
}

/**
 * Pone los valores de fábrica en un archivo, si es uno de los que los llevan. Devuelve null si no tocó
 * nada (no es el archivo, o la variable no está definida: en desarrollo y en las pruebas queda vacío).
 */
export function ponerSecretosDeFabrica(rutaAbsoluta, codigo, entorno = process.env) {
  const normalizada = rutaAbsoluta.replaceAll('\\', '/')
  let resultado = codigo
  let toco = false
  for (const { archivo, constante, variable } of DE_FABRICA) {
    if (!normalizada.endsWith(archivo)) continue
    const escrito = patron(constante).exec(resultado)
    // Que no esté la constante es un error (alguien la renombró y el instalador saldría sin token).
    if (!escrito) throw new Error(`No se encontró ${constante} en ${archivo}: revisá scripts/secretos-de-fabrica.mjs.`)
    // Y que tenga algo escrito, también: ese valor quedaría publicado en GitHub.
    if (escrito[2] !== '') {
      throw new Error(`${constante} tiene un valor escrito en ${archivo}. En el código va vacía: el valor se carga como secreto de GitHub Actions.`)
    }
    const valor = valorDeFabrica(variable, entorno)
    if (valor === '') continue
    resultado = resultado.replace(patron(constante), (_todo, inicio) => `${inicio}'${valor}'`)
    toco = true
  }
  return toco ? resultado : null
}

/** Las variables de fábrica que faltan en este entorno, con lo necesario para explicar cómo cargarlas. */
export function secretosDeFabricaQueFaltan(entorno = process.env) {
  return DE_FABRICA.filter(({ variable }) => valorDeFabrica(variable, entorno) === '')
}
