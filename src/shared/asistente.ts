// El asistente con IA (el círculo de abajo a la derecha): contesta preguntas sobre los datos del programa
// y sugiere qué hacer. Es SÓLO DE LECTURA: no tiene ninguna herramienta que escriba, borre o mande nada.
//
// Este archivo es puro y compartido (main y renderer), como permisos.ts: los tipos que viajan por IPC, la
// elección automática del esfuerzo y el filtro que saca datos sensibles. El que manda es el proceso
// principal (servicios/asistente.ts): ahí se decide qué herramientas ve cada uno según su rol y sus
// permisos, y por ahí pasa todo lo que la IA lee antes de mandarlo a Anthropic.
import type { Rol } from './tipos'

/** Haiku: rápido y barato, alcanza de sobra para consultas de mostrador. */
export const MODELO_DEL_ASISTENTE = 'claude-haiku-5-5'

/**
 * El esfuerzo se elige solo según la consulta. Nunca pasa de `high` (pedido de la agencia): `xhigh` y
 * `max` no existen para el asistente.
 */
export const ESFUERZOS = ['low', 'medium', 'high'] as const
export type EsfuerzoDelAsistente = (typeof ESFUERZOS)[number]

export const NOMBRE_DEL_ESFUERZO: Record<EsfuerzoDelAsistente, string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
}

/** Lo que ve cualquiera que tenga sesión: si el asistente está listo, sin ningún secreto. */
export interface EstadoDelAsistente {
  /** Hay una clave de Anthropic cargada en esta computadora. */
  configurado: boolean
  /** Sólo el superadministrador carga o cambia la clave. */
  puedeConfigurar: boolean
  /** Los últimos 4 caracteres de la clave, para reconocerla. Sólo al superadministrador; si no, ''. */
  finDeLaClave: string
  actualizadoEn: string | null
}

export interface PreguntaAlAsistente {
  /** null = conversación nueva. La historia completa vive en el proceso principal, no en la pantalla. */
  conversacionId: string | null
  texto: string
}

export interface RespuestaDelAsistente {
  conversacionId: string
  texto: string
  esfuerzo: EsfuerzoDelAsistente
  /** Qué consultó para contestar, en palabras de la agencia («Buscó clientes», «Miró la mora»…). */
  consultas: string[]
}

export const LARGO_MAXIMO_DE_LA_PREGUNTA = 2000

// ---------------------------------------------------------------------------
// Las dos respuestas fijas
// ---------------------------------------------------------------------------

/** Lo que contesta, palabra por palabra, cuando la consulta no tiene nada que ver con el programa. */
export const RESPUESTA_FUERA_DE_TEMA = 'No puedo responder eso porque no tiene que ver con el software.'

/** Lo que contesta, palabra por palabra, cuando la consulta va contra las políticas de uso de Claude. */
export const RESPUESTA_CONTRA_LOS_TERMINOS = 'Esa pregunta viola los términos y condiciones de Claude.'

function sinPuntuacion(texto: string): string {
  return sinTildes(texto)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Si la IA usó una de las dos respuestas fijas, la pantalla muestra SÓLO esa frase, tal cual: aunque la
 * IA le haya agregado una explicación, la haya escrito sin tilde o con otro signo al final. Así nunca
 * pasa que diga «eso no tiene que ver con el programa» y después lo conteste igual.
 */
export function normalizarRespuesta(texto: string): string {
  const limpio = sinPuntuacion(texto)
  for (const fija of [RESPUESTA_CONTRA_LOS_TERMINOS, RESPUESTA_FUERA_DE_TEMA]) {
    if (limpio.includes(sinPuntuacion(fija))) return fija
  }
  return texto
}

// ---------------------------------------------------------------------------
// El análisis de los reportes de error
// ---------------------------------------------------------------------------

/**
 * Al mandar un reporte de error (o una sugerencia), Sonnet lo lee con las capturas y deja en el issue qué
 * puede estar pasando y qué conviene revisar. Es más que una consulta de mostrador, por eso no es Haiku.
 */
export const MODELO_DEL_ANALISIS_DE_REPORTES = 'claude-sonnet-5-5'
export const ESFUERZO_DEL_ANALISIS_DE_REPORTES: EsfuerzoDelAsistente = 'medium'

/** El servidor corta el cuerpo del issue en 20.000 caracteres: el análisis tiene que entrar con lo demás. */
export const LARGO_MAXIMO_DEL_CUERPO = 19_500

/**
 * Lo que escribió la persona, y abajo el análisis bien separado: quien lee el issue tiene que distinguir
 * de un vistazo qué contó el mostrador y qué supuso la IA. Si no entra todo, se recorta el análisis,
 * nunca lo que escribió la persona.
 */
export function cuerpoConAnalisis(cuerpo: string, analisis: string | null): string {
  if (!analisis) return cuerpo
  // Línea en blanco antes del «---»: pegado al texto, Markdown lo convierte en título.
  const encabezado = [
    '',
    '',
    '---',
    '',
    '### 🤖 Análisis automático (IA)',
    '',
    '_Lo escribió Claude Sonnet al mandar el reporte, sólo con lo de arriba y las capturas. Es una pista para empezar a mirar, no un diagnóstico._',
    '',
    '',
  ].join('\n')
  const base = cuerpo.trim() || '_(sin descripción)_'
  const lugar = LARGO_MAXIMO_DEL_CUERPO - base.length - encabezado.length
  if (lugar < 200) return cuerpo
  return `${base}${encabezado}${analisis.length > lugar ? `${analisis.slice(0, lugar - 1)}…` : analisis}`
}

// ---------------------------------------------------------------------------
// Esfuerzo automático
// ---------------------------------------------------------------------------

const PISTAS_DE_ANALISIS = [
  'analiz',
  'compar',
  'por que',
  'porque',
  'estrategi',
  'suger',
  'recomend',
  'conviene',
  'tendencia',
  'evolucion',
  'explica',
  'diagnost',
  'prioriz',
  'plan ',
  'que hago',
  'que deberia',
  'mejorar',
  'resumen del mes',
  'informe',
]

const PISTAS_DE_CONSULTA = [
  'cuant',
  'cual',
  'quien',
  'busca',
  'lista',
  'mostra',
  'dame',
  'tiene',
  'deuda',
  'mora',
  'poliza',
  'cliente',
  'siniestro',
  'renov',
  'caja',
  'tarea',
  'lead',
  'presupuesto',
  'vence',
  'cobr',
]

function sinTildes(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Elige el esfuerzo sin gastar una llamada: un saludo o una pregunta de ayuda va en bajo, una consulta de
 * datos en medio y un pedido de análisis o sugerencia (o una pregunta larga, con varias partes) en alto.
 */
export function esfuerzoParaLaConsulta(texto: string): EsfuerzoDelAsistente {
  const limpio = sinTildes(texto).trim()
  const palabras = limpio.split(/\s+/).filter(Boolean).length
  const preguntas = (limpio.match(/\?/g) ?? []).length
  if (PISTAS_DE_ANALISIS.some((pista) => limpio.includes(pista)) || palabras > 60 || preguntas > 2) return 'high'
  if (PISTAS_DE_CONSULTA.some((pista) => limpio.includes(pista)) || palabras > 15) return 'medium'
  return 'low'
}

// ---------------------------------------------------------------------------
// El filtro: lo que la IA nunca recibe
// ---------------------------------------------------------------------------

/**
 * Campos que NO viajan a la IA para nadie, ni siquiera para el superadministrador: credenciales, claves,
 * tokens, rutas de la computadora. El asistente no necesita nada de eso para contestar, y lo que no se
 * manda no se puede filtrar.
 */
const CAMPOS_SECRETOS =
  /(clave|password|contrasen|token|secret|apikey|api_key|hash|cuentaservicio|private|credencial|authorization|ruta|carpeta|archivo|ip$|^ip|direccionip)/i

/**
 * Campos de plata de la agencia (lo que se gana, no lo que se cobra en el mostrador). Para quien no ve
 * los números de la agencia (`veLosNumerosDeLaAgencia`) no viajan, igual que no le llegan a la pantalla.
 */
const CAMPOS_DE_LA_AGENCIA = /(comision|ganancia|bruto|recaudaci|rendicion|porcentajeDeLaCompania|margen|liquidaci)/i

const MAXIMO_DE_FILAS = 30
const MAXIMO_DE_TEXTO = 600
const PROFUNDIDAD_MAXIMA = 6

/**
 * Deja un resultado listo para la IA: sin secretos, sin los números de la agencia si el rol no los ve, y
 * recortado (las listas largas quedan en las primeras filas más el total, para no mandar miles de
 * renglones en cada consulta).
 */
export function filtrarParaLaIa(valor: unknown, rol: Rol, profundidad = 0): unknown {
  if (valor === null || valor === undefined) return valor ?? null
  if (typeof valor === 'string') return valor.length > MAXIMO_DE_TEXTO ? `${valor.slice(0, MAXIMO_DE_TEXTO)}…` : tacharSecretos(valor)
  if (typeof valor !== 'object') return valor
  if (profundidad >= PROFUNDIDAD_MAXIMA) return '…'
  if (Array.isArray(valor)) {
    const filas = valor.slice(0, MAXIMO_DE_FILAS).map((fila) => filtrarParaLaIa(fila, rol, profundidad + 1))
    if (valor.length > MAXIMO_DE_FILAS) {
      filas.push(`… y ${valor.length - MAXIMO_DE_FILAS} más (total: ${valor.length}). Pedí una búsqueda más precisa para verlas.`)
    }
    return filas
  }
  const conNumeros = rol !== 'EMPLEADO'
  const salida: Record<string, unknown> = {}
  for (const [clave, dato] of Object.entries(valor as Record<string, unknown>)) {
    if (CAMPOS_SECRETOS.test(clave)) continue
    if (!conNumeros && CAMPOS_DE_LA_AGENCIA.test(clave)) continue
    salida[clave] = filtrarParaLaIa(dato, rol, profundidad + 1)
  }
  return salida
}

/**
 * Tacha lo que tenga forma de credencial en un texto libre (una nota de un cliente donde alguien pegó una
 * clave, o la respuesta de la IA). Es la última red: lo normal es que nunca llegue nada de esto.
 */
export function tacharSecretos(texto: string): string {
  return texto
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[clave oculta]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, '[clave oculta]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[token oculto]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[clave privada oculta]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP oculta]')
}

/** ¿La clave tiene la forma de una de Anthropic? Sólo una comprobación de tipeo, no la valida contra nadie. */
export function pareceClaveDeAnthropic(clave: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(clave.trim())
}
