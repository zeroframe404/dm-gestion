// Qué errores son «no hay internet» y cuáles «el servidor dijo que no». Lo usan el motor de
// sincronización con Google y la base de usuarios en GitHub, que tienen que reaccionar distinto.

const MENSAJES_DE_RED = /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|network|socket hang up|No se pudo conectar|fetch failed|aborted/i
const CODIGOS_DE_RED = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR']

/** Errores que son «no hay internet» y no «Google/GitHub dijo que no». */
export function esFallaDeRed(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  const mensaje = error instanceof Error ? error.message : String(error)
  const causa = (error as { cause?: { code?: string; message?: string } } | null)?.cause
  const codigo = (error as { code?: string } | null)?.code ?? causa?.code ?? ''
  return (
    MENSAJES_DE_RED.test(mensaje) ||
    (typeof causa?.message === 'string' && MENSAJES_DE_RED.test(causa.message)) ||
    CODIGOS_DE_RED.includes(codigo)
  )
}
