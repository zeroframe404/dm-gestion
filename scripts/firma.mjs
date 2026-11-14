// La firma de código del instalador (punto 8). Sin firma, Windows muestra SmartScreen («Windows protegió
// su PC») al instalar. Todavía no hay certificado: esto deja todo listo para que, apenas se carguen los
// secretos en GitHub, el instalador salga firmado sin tocar nada más. Mientras falten, sale sin firmar,
// como siempre, y queda el aviso en el resumen de la corrida.
//
// Dos maneras, según qué secretos haya (detalle en el README, «Firma del instalador»):
//   - Un certificado .pfx: WIN_CSC_LINK (el .pfx en base64, o una URL https) y WIN_CSC_KEY_PASSWORD.
//     electron-builder los lee solo de las variables de entorno; acá sólo se reconoce que están.
//   - Azure Trusted Signing (Artifact Signing): AZURE_TENANT_ID, AZURE_CLIENT_ID y AZURE_CLIENT_SECRET (los
//     lee la herramienta de firma de Microsoft) más AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT,
//     AZURE_SIGN_PROFILE y AZURE_SIGN_PUBLISHER, que van como `-c.win.azureSignOptions.*`.
//
// OJO, una vez firmado: electron-builder anota el editor del certificado en el app-update.yml y el
// actualizador EXIGE que las versiones siguientes vengan firmadas por ese mismo editor. Si el certificado
// vence sin renovarse o cambia el nombre del titular, las computadoras dejan de aceptar actualizaciones
// (hay que reinstalar a mano). Renovar SIEMPRE con el mismo nombre de editor.
import { appendFileSync } from 'node:fs'

const AZURE_CREDENCIALES = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET']
const AZURE_OPCIONES = {
  AZURE_SIGN_ENDPOINT: 'endpoint',
  AZURE_SIGN_ACCOUNT: 'codeSigningAccountName',
  AZURE_SIGN_PROFILE: 'certificateProfileName',
  AZURE_SIGN_PUBLISHER: 'publisherName',
}

/**
 * Qué firma corresponde con estas variables y qué argumentos de más necesita electron-builder.
 * @param {Record<string, string | undefined>} entorno
 * @returns {{ modo: 'pfx' | 'azure' | 'ninguna', argumentos: string[], aviso: string | null }}
 */
export function firmaSegunEntorno(entorno) {
  const tiene = (nombre) => Boolean(entorno[nombre]?.trim())
  if (tiene('WIN_CSC_LINK') || tiene('CSC_LINK')) {
    if (!tiene('WIN_CSC_KEY_PASSWORD') && !tiene('CSC_KEY_PASSWORD')) {
      throw new Error('Está el certificado (WIN_CSC_LINK) pero falta su contraseña (WIN_CSC_KEY_PASSWORD).')
    }
    return { modo: 'pfx', argumentos: [], aviso: null }
  }
  const azure = [...AZURE_CREDENCIALES, ...Object.keys(AZURE_OPCIONES)]
  const presentes = azure.filter(tiene)
  if (presentes.length === azure.length) {
    const argumentos = Object.entries(AZURE_OPCIONES).map(([variable, opcion]) => `-c.win.azureSignOptions.${opcion}=${entorno[variable].trim()}`)
    return { modo: 'azure', argumentos, aviso: null }
  }
  if (presentes.length > 0) {
    const faltan = azure.filter((nombre) => !tiene(nombre))
    throw new Error(`Azure Trusted Signing a medias: faltan ${faltan.join(', ')}.`)
  }
  return {
    modo: 'ninguna',
    argumentos: [],
    aviso: '⚠ Instalador SIN FIRMAR: Windows va a mostrar SmartScreen al instalarlo. Para firmarlo, ver el README, «Firma del instalador».',
  }
}

/** Lo mismo, pero contra `process.env` y dejando el aviso en la consola y en el resumen de la corrida. */
export function argumentosDeFirma() {
  const firma = firmaSegunEntorno(process.env)
  if (firma.aviso) {
    console.warn(`[firma] ${firma.aviso}`)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${firma.aviso}\n`)
  } else {
    console.log(`[firma] El instalador sale firmado (${firma.modo === 'pfx' ? 'certificado .pfx' : 'Azure Trusted Signing'}).`)
  }
  return firma.argumentos
}
