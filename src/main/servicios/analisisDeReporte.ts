// El análisis con IA de lo que llega por «Reportar error» (y «Sugerir mejora»).
//
// Cuando alguien manda un reporte, antes de abrir el issue Sonnet lo lee —el texto y las capturas— y
// escribe qué puede estar pasando, qué conviene revisar primero y qué dato falta preguntar. Eso va al
// final del cuerpo del issue, separado de lo que escribió la persona, para que quien lo tome en GitHub
// arranque con una pista y no desde cero.
//
// Dos reglas:
//
// 1. NUNCA FRENA EL REPORTE. Sin clave de Anthropic, sin internet, si tarda o si la IA no quiere
//    contestar, el reporte sale igual, sin el análisis. Avisar del error es lo que importa.
//
// 2. SÓLO LO QUE YA VA AL ISSUE. La IA recibe lo mismo que termina en GitHub (título, descripción,
//    capturas, versión, sucursal) y nada más: ningún dato del programa, de clientes ni de la base.
import Anthropic from '@anthropic-ai/sdk'
import { ESFUERZO_DEL_ANALISIS_DE_REPORTES, MODELO_DEL_ANALISIS_DE_REPORTES, tacharSecretos } from '../../shared/asistente'

export { cuerpoConAnalisis } from '../../shared/asistente'
import { AREAS, DESCRIPCION_AREA } from '../../shared/permisos'
import type { TipoDeReporte } from '../../shared/tipos'
import { claveDelAsistente } from './config'

export interface ReporteParaAnalizar {
  tipo: TipoDeReporte
  titulo: string
  cuerpo: string
  imagenes: { tipo: string; contenidoBase64: string }[]
  version: string
  sucursal: string
  sistema: string
}

/** La API no acepta imágenes de más de 5 MB (en base64): las que pasan van al issue igual, sin análisis. */
const MAXIMO_BASE64_POR_IMAGEN = 5 * 1024 * 1024
const TIPOS_DE_IMAGEN = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const LARGO_MAXIMO_DEL_ANALISIS = 8_000

function instrucciones(tipo: TipoDeReporte): string {
  const modulos = AREAS.map((area) => `- ${DESCRIPCION_AREA[area].nombre}: ${DESCRIPCION_AREA[area].detalle}`).join('\n')
  const queEs =
    tipo === 'mejora'
      ? 'una SUGERENCIA DE MEJORA que alguien de la agencia mandó desde el programa'
      : 'un REPORTE DE ERROR que alguien de la agencia mandó desde el programa'
  const queEscribir =
    tipo === 'mejora'
      ? [
          '**Qué se pide**: en una o dos líneas, lo que la persona quiere lograr.',
          '**Dónde tocaría**: qué módulo o pantalla del programa se vería afectado.',
          '**Cómo se podría hacer**: uno a tres enfoques posibles, del más simple al más completo.',
          '**Qué preguntar**: lo que falta saber para hacerlo bien (si no falta nada, decilo).',
        ]
      : [
          '**Qué pasa**: en una o dos líneas, el problema tal como se entiende del reporte y las capturas.',
          '**Dónde mirar**: qué módulo o pantalla está involucrado.',
          '**Posibles causas**: de la más probable a la menos, cada una con por qué lo pensás.',
          '**Qué revisar primero**: pasos concretos para reproducirlo o confirmarlo.',
          '**Qué preguntar**: lo que falta para reproducirlo (si no falta nada, decilo).',
        ]
  return [
    'Sos el analista técnico de DM Gestión, el programa de escritorio (Electron + React + SQLite, sincronizado con un servidor VPS) que usa Seguros Daniel Martínez, una agencia de seguros de Argentina con varias sucursales.',
    `Vas a leer ${queEs}. Lo que escribas va al final del issue de GitHub, para el programador que lo tome.`,
    '',
    'Módulos del programa:',
    modulos,
    '',
    'Escribí en español rioplatense, en Markdown, breve y concreto, con estas secciones:',
    ...queEscribir.map((linea) => `- ${linea}`),
    '',
    'Reglas:',
    '- Basate sólo en el reporte y las capturas. Si algo es una suposición, decilo; no inventes datos ni nombres de archivos.',
    '- Si en las capturas hay datos personales de clientes (nombres, DNI, teléfonos), no los repitas.',
    '- No escribas un título ni repitas el reporte entero: arrancá directo por la primera sección.',
  ].join('\n')
}

function contenidoDelPedido(reporte: ReporteParaAnalizar): Anthropic.Beta.BetaContentBlockParam[] {
  const imagenes: Anthropic.Beta.BetaContentBlockParam[] = reporte.imagenes
    .filter((imagen) => TIPOS_DE_IMAGEN.has(imagen.tipo) && imagen.contenidoBase64.length <= MAXIMO_BASE64_POR_IMAGEN)
    .map((imagen) => ({
      type: 'image',
      source: { type: 'base64', media_type: imagen.tipo as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: imagen.contenidoBase64 },
    }))
  const capturasAfuera = reporte.imagenes.length - imagenes.length
  const texto = [
    `Tipo: ${reporte.tipo === 'mejora' ? 'sugerencia de mejora' : 'reporte de error'}`,
    `Versión del programa: ${reporte.version}`,
    `Sucursal: ${reporte.sucursal}`,
    `Sistema: ${reporte.sistema}`,
    `Capturas adjuntas: ${imagenes.length}${capturasAfuera > 0 ? ` (y ${capturasAfuera} que no se pudieron analizar por tamaño o formato)` : ''}`,
    '',
    `Título: ${tacharSecretos(reporte.titulo)}`,
    '',
    'Descripción:',
    tacharSecretos(reporte.cuerpo.trim()) || '(sin descripción)',
  ].join('\n')
  return [...imagenes, { type: 'text', text: texto }]
}

/**
 * El análisis en Markdown, o null si no se pudo hacer (no hay clave, falló, tardó o la IA no quiso).
 * Nunca tira: el que llama manda el reporte igual.
 */
export async function analizarReporte(reporte: ReporteParaAnalizar): Promise<string | null> {
  const clave = claveDelAsistente()
  if (!clave) return null
  try {
    // Un minuto de tope: es lo que la persona espera con el botón «Enviar» girando.
    const cliente = new Anthropic({ apiKey: clave, maxRetries: 1, timeout: 60_000 })
    const respuesta = await cliente.beta.messages.create({
      model: MODELO_DEL_ANALISIS_DE_REPORTES,
      max_tokens: 8000,
      output_config: { effort: ESFUERZO_DEL_ANALISIS_DE_REPORTES },
      // Si Sonnet rechaza por un falso positivo (una captura con algo que parece sensible), la API reintenta
      // sola con el modelo de respaldo que corresponda.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: instrucciones(reporte.tipo),
      messages: [{ role: 'user', content: contenidoDelPedido(reporte) }],
    })
    if (respuesta.stop_reason === 'refusal') return null
    const texto = respuesta.content
      .filter((bloque): bloque is Anthropic.Beta.BetaTextBlock => bloque.type === 'text')
      .map((bloque) => bloque.text)
      .join('\n')
      .trim()
    if (!texto) return null
    return tacharSecretos(texto.length > LARGO_MAXIMO_DEL_ANALISIS ? `${texto.slice(0, LARGO_MAXIMO_DEL_ANALISIS)}…` : texto)
  } catch (error) {
    console.error('[soporte] No se pudo analizar el reporte con IA:', error instanceof Error ? error.message : error)
    return null
  }
}
