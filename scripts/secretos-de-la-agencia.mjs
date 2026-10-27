// Lo que el programa de la agencia trae escrito en el código y que NO puede viajar en el instalador de
// la demo, que se le entrega a otras empresas: el token del puente con el VPS de la agencia, su
// dirección, la del control remoto y el token de GitHub de la semilla de usuarios.
//
// La demo no los usa (habla con su servidor interno, ver src/main/demo/servidor.ts), pero estando en
// el código fuente quedarían igual adentro del .exe, a la vista de cualquiera que lo abra. El armado de
// la demo (scripts/dist-demo.mjs) compila el proceso principal con estos valores reemplazados y después
// revisa el resultado: si alguno sobrevivió, no arma el instalador.

/** Archivo (relativo a la raíz) → constantes cuyo valor literal se reemplaza, y por qué. */
export const SECRETOS = [
  { archivo: 'src/main/servicios/config.ts', constante: 'VPS_TOKEN', reemplazo: '' },
  { archivo: 'src/main/servicios/config.ts', constante: 'VPS_URL_BASE', reemplazo: 'https://vps.invalid' },
  { archivo: 'src/main/servicios/config.ts', constante: 'MESH_URL', reemplazo: 'https://mesh.invalid' },
  { archivo: 'src/main/servicios/config.ts', constante: 'URL_DE_REDIRECCION_DE_META', reemplazo: 'https://vps.invalid/meta/vuelta' },
  { archivo: 'src/main/usuarios/github.ts', constante: 'TOKEN_DATOS', reemplazo: '' },
  { archivo: 'src/main/usuarios/github.ts', constante: 'TOKEN_DATOS_ANTERIOR', reemplazo: '' },
]

function patron(constante) {
  // `const X = '...'` o `export const X = '...'`, con comillas simples, como está escrito.
  return new RegExp(`(\\bconst ${constante}\\s*=\\s*)'([^']*)'`)
}

/** El valor que tiene hoy cada constante en el código fuente: es lo que no puede aparecer en el paquete. */
export function valoresSecretos(leer) {
  const valores = []
  for (const { archivo, constante } of SECRETOS) {
    const encontrado = patron(constante).exec(leer(archivo))
    if (!encontrado) throw new Error(`No encontré la constante ${constante} en ${archivo}: revisá scripts/secretos-de-la-agencia.mjs.`)
    if (encontrado[2].length >= 8) valores.push({ constante, valor: encontrado[2] })
  }
  return valores
}

/** Reemplaza las constantes de un archivo, si es uno de los que las tiene. Devuelve null si no tocó nada. */
export function quitarSecretos(rutaAbsoluta, codigo) {
  const normalizada = rutaAbsoluta.replaceAll('\\', '/')
  let resultado = codigo
  let toco = false
  for (const { archivo, constante, reemplazo } of SECRETOS) {
    if (!normalizada.endsWith(archivo)) continue
    // Que no esté la constante es un error (alguien la renombró y el secreto pasaría de largo); que ya
    // valga lo mismo que el reemplazo (TOKEN_DATOS_ANTERIOR vacío), no.
    if (!patron(constante).test(resultado)) throw new Error(`No se encontró ${constante} en ${archivo}.`)
    resultado = resultado.replace(patron(constante), (_todo, inicio) => `${inicio}'${reemplazo}'`)
    toco = true
  }
  return toco ? resultado : null
}
