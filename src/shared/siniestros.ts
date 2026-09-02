// Reglas del módulo Siniestros que usan a la vez el proceso principal y la pantalla, así que viven acá
// y tienen sus propias pruebas: el estado del trámite y la palabra ROBO destacada.

import { ESTADOS_DE_SINIESTRO, type EstadoSiniestro } from './tipos'

function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * Cómo se traducen al estado del trámite los textos que ya están en la columna ESTADO de la hoja.
 * La agencia escribió durante años lo que le pareció; la ficha tiene cuatro estados y cada texto viejo
 * tiene que caer en el que corresponde en vez de aparecer en blanco.
 */
const SINONIMOS_DE_ESTADO: Record<string, EstadoSiniestro> = {
  CARGADO: 'CARGADO',
  CARGADA: 'CARGADO',
  DENUNCIADO: 'CARGADO',
  DENUNCIADA: 'CARGADO',
  DENUNCIA: 'CARGADO',
  ABIERTO: 'CARGADO',
  ABIERTA: 'CARGADO',
  NUEVO: 'CARGADO',
  INICIADO: 'CARGADO',

  'EN TRAMITE': 'EN TRÁMITE',
  TRAMITE: 'EN TRÁMITE',
  TRAMITANDO: 'EN TRÁMITE',
  'EN GESTION': 'EN TRÁMITE',
  GESTION: 'EN TRÁMITE',
  'EN CURSO': 'EN TRÁMITE',
  'EN PROCESO': 'EN TRÁMITE',
  'EN ESTUDIO': 'EN TRÁMITE',
  'EN LA CIA': 'EN TRÁMITE',
  'EN LA COMPANIA': 'EN TRÁMITE',
  'CON EL PERITO': 'EN TRÁMITE',
  'A PERITAR': 'EN TRÁMITE',
  PERITADO: 'EN TRÁMITE',
  PERITADA: 'EN TRÁMITE',
  PERICIA: 'EN TRÁMITE',
  'EN PERICIA': 'EN TRÁMITE',
  'CON EL ABOGADO': 'EN TRÁMITE',

  'ESPERANDO DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'ESPERA DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'ESPERANDO DOC': 'ESPERANDO DOCUMENTACIÓN',
  'FALTA DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'FALTAN DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'FALTA DOC': 'ESPERANDO DOCUMENTACIÓN',
  'FALTAN DOC': 'ESPERANDO DOCUMENTACIÓN',
  'FALTA PAPELES': 'ESPERANDO DOCUMENTACIÓN',
  'FALTAN PAPELES': 'ESPERANDO DOCUMENTACIÓN',
  'ESPERA PAPELES': 'ESPERANDO DOCUMENTACIÓN',
  DOCUMENTACION: 'ESPERANDO DOCUMENTACIÓN',
  'PENDIENTE DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'PENDIENTE DE DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'DOCUMENTACION PENDIENTE': 'ESPERANDO DOCUMENTACIÓN',
  'ESPERANDO PAPELES': 'ESPERANDO DOCUMENTACIÓN',

  CERRADO: 'CERRADO',
  CERRADA: 'CERRADO',
  CERRO: 'CERRADO',
  'SE CERRO': 'CERRADO',
  FINALIZADO: 'CERRADO',
  FINALIZADA: 'CERRADO',
  TERMINADO: 'CERRADO',
  TERMINADA: 'CERRADO',
  PAGADO: 'CERRADO',
  PAGADA: 'CERRADO',
  LIQUIDADO: 'CERRADO',
  LIQUIDADA: 'CERRADO',
  COBRADO: 'CERRADO',
  COBRADA: 'CERRADO',
  RECHAZADO: 'CERRADO',
  RECHAZADA: 'CERRADO',
  DENEGADO: 'CERRADO',
  DENEGADA: 'CERRADO',
  'NO CUBIERTO': 'CERRADO',
  ANULADO: 'CERRADO',
  ANULADA: 'CERRADO',
}

/**
 * Las frases de arriba ordenadas de más larga a más corta. Con este orden «PENDIENTE DOCUMENTACION»
 * se prueba antes que «DOCUMENTACION» y «EN TRAMITE» antes que «TRAMITE»: la frase más específica gana
 * cuando las dos empiezan en el mismo lugar del texto.
 */
const FRASES_DE_ESTADO = Object.keys(SINONIMOS_DE_ESTADO).sort((a, b) => b.length - a.length)

/**
 * Lleva lo que haya guardado a uno de los cuatro estados. Un texto que no se reconoce se toma como
 * CARGADO —está denunciado y todavía no se sabe más— y el original se sigue mostrando al lado, igual
 * que hace la rendición de Imputados con su RESULTADO.
 *
 * La comparación no es palabra por palabra exacta: en la hoja nadie escribe «CERRADO» a secas, escribe
 * «CERRADO 15/08», «CERRADO SIN PAGO», «EN TRÁMITE - PERITO» o «ESPERANDO DOCUMENTACIÓN DEL CLIENTE».
 * Mientras la comparación fue exacta, TODOS esos textos caían en CARGADO y los contadores de EN
 * TRÁMITE, ESPERANDO DOCUMENTACIÓN y CERRADO marcaban cero aunque el trámite estuviera anotado.
 *
 * Se busca la frase que aparezca ANTES en el texto, y a igualdad de posición la más larga: la agencia
 * escribe el estado al principio y el detalle después, así que «CERRADO FALTA DOCUMENTACIÓN» es un
 * siniestro cerrado y no uno esperando papeles. La frase tiene que estar como palabras completas, para
 * que «DOCUMENTACION» no se enganche dentro de otra palabra.
 */
export function normalizarEstadoSiniestro(valor: string | null | undefined): EstadoSiniestro {
  const texto = normalizar(valor)
  if (!texto) return 'CARGADO'
  if ((ESTADOS_DE_SINIESTRO as readonly string[]).includes(texto)) return texto as EstadoSiniestro
  // «EN TRÁMITE» normalizado pierde la tilde: se compara contra la lista ya normalizada.
  const directo = ESTADOS_DE_SINIESTRO.find((estado) => normalizar(estado) === texto)
  if (directo) return directo
  const exacto = SINONIMOS_DE_ESTADO[texto]
  if (exacto) return exacto

  let elegida: string | null = null
  let dondeEmpieza = Number.POSITIVE_INFINITY
  for (const frase of FRASES_DE_ESTADO) {
    // Palabras completas: el texto ya viene normalizado a MAYÚSCULAS separadas por un solo espacio.
    const donde = ` ${texto} `.indexOf(` ${frase} `)
    if (donde === -1 || donde >= dondeEmpieza) continue
    dondeEmpieza = donde
    elegida = frase
  }
  return elegida ? SINONIMOS_DE_ESTADO[elegida]! : 'CARGADO'
}

/** true si el estado guardado dice algo que no es exactamente uno de los cuatro (para mostrarlo aparte). */
export function estadoTextoDiferente(guardado: string | null | undefined): boolean {
  const texto = (guardado ?? '').trim()
  if (!texto) return false
  return !ESTADOS_DE_SINIESTRO.some((estado) => normalizar(estado) === normalizar(texto))
}

/**
 * La palabra ROBO va destacada en rojo, como en la hoja: en la agencia un robo se mira distinto que un
 * choque. Se busca como palabra entera —ROBO, ROBOS, ROBADO, ROBARON, HURTO— para que «ROBOTIZADO» no
 * pinte una fila de rojo, y se ignoran tildes y mayúsculas.
 */
export function mencionaRobo(...textos: Array<string | null | undefined>): boolean {
  const junto = normalizar(textos.filter(Boolean).join(' '))
  if (!junto) return false
  return /\b(ROBO|ROBOS|ROBADO|ROBADA|ROBARON|HURTO|HURTOS)\b/.test(junto)
}
