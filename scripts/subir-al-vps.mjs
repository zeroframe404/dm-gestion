// Sube una versión ya armada al servidor de la agencia (punto 8), para que las computadoras la bajen de
// ahí y no de GitHub. La llaman `publicar.mjs` (canal `estable`) y `publicar-beta.mjs` (canal `beta`)
// DESPUÉS de publicar en GitHub, que sigue siendo el respaldo.
//
//   node scripts/subir-al-vps.mjs <estable|beta> <instalador.exe> <instalador.exe.blockmap> <latest.yml|beta.yml>
//
// Va con `DMG_PUBLICADOR_TOKEN` (secreto de GitHub Actions; el mismo valor que en el `.env` del VPS). No
// es el token del puente: ese viaja dentro de cada instalador. El orden es fijo: instalador, blockmap y
// por último el .yml, que el servidor rechaza si el instalador al que apunta no está o no coincide.
//
// NUNCA tira abajo la publicación: si falta el token o el servidor no contesta, deja el aviso (en la
// consola y en el resumen de la corrida) y las computadoras siguen actualizándose desde GitHub.
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Para probar contra el simulador local (`scripts/vps-simulado.mjs`); en la publicación, el VPS real. */
export const URL_DE_ACTUALIZACIONES = process.env.DM_GESTION_ACTUALIZACIONES_URL || 'https://dmartinezseguros.com/api/dmg-actualizaciones'

function resumen(linea) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${linea}\n`)
}

async function subirUno(base, canal, ruta, token, intentos = 3) {
  const nombre = path.basename(ruta)
  const contenido = readFileSync(ruta)
  for (let intento = 1; ; intento++) {
    try {
      const respuesta = await fetch(`${base}/${canal}/${encodeURIComponent(nombre)}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
        body: contenido,
      })
      if (respuesta.ok) return
      const texto = await respuesta.text().catch(() => '')
      // 4xx: reintentar no cambia nada (token, nombre, yml sin instalador).
      if (respuesta.status < 500 || intento >= intentos) throw new Error(`${respuesta.status} ${texto.slice(0, 300)}`)
    } catch (error) {
      if (intento >= intentos || /^4\d\d /.test(error.message)) throw new Error(`«${nombre}»: ${error.message}`)
    }
    console.warn(`[subir-al-vps] Falló «${nombre}» (intento ${intento} de ${intentos}); se reintenta en ${5 * intento} s.`)
    await new Promise((r) => setTimeout(r, 5000 * intento))
  }
}

/**
 * Sube los tres archivos en orden. Devuelve `true` si quedó publicada en el servidor; nunca tira error.
 * @param {{ canal: 'estable' | 'beta', instalador: string, blockmap: string, yml: string, token?: string, base?: string }} opciones
 */
export async function subirAlVps({ canal, instalador, blockmap, yml, token = process.env.DMG_PUBLICADOR_TOKEN, base = URL_DE_ACTUALIZACIONES }) {
  if (!token) {
    const aviso = '⚠ No se subió la actualización al servidor de la agencia: falta el secreto DMG_PUBLICADOR_TOKEN. Las computadoras la bajan de GitHub, como antes.'
    console.warn(`[subir-al-vps] ${aviso}`)
    resumen(aviso)
    return false
  }
  try {
    for (const ruta of [instalador, blockmap, yml]) {
      console.log(`[subir-al-vps] Subiendo ${path.basename(ruta)} a ${base}/${canal}/`)
      await subirUno(base, canal, ruta, token)
    }
    console.log(`[subir-al-vps] Listo: el servidor de la agencia ya ofrece ${path.basename(instalador)}.`)
    resumen(`✅ Actualización subida al servidor de la agencia (${canal}): ${path.basename(instalador)}.`)
    return true
  } catch (error) {
    const aviso = `⚠ No se pudo subir la actualización al servidor de la agencia (${error.message}). Las computadoras la bajan de GitHub mientras tanto.`
    console.warn(`[subir-al-vps] ${aviso}`)
    resumen(aviso)
    return false
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [canal, instalador, blockmap, yml] = process.argv.slice(2)
  if (!['estable', 'beta'].includes(canal) || !instalador || !blockmap || !yml) {
    console.error('Uso: node scripts/subir-al-vps.mjs <estable|beta> <instalador.exe> <instalador.exe.blockmap> <yml>')
    process.exit(2)
  }
  // Sin `await` de nivel superior: el banco de pruebas empaqueta este archivo como CommonJS.
  void subirAlVps({ canal, instalador, blockmap, yml })
}
