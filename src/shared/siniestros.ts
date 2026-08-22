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
  'EN GESTION': 'EN TRÁMITE',
  GESTION: 'EN TRÁMITE',
  'EN CURSO': 'EN TRÁMITE',
  'EN PROCESO': 'EN TRÁMITE',
  PERITADO: 'EN TRÁMITE',
  PERICIA: 'EN TRÁMITE',
  'EN PERICIA': 'EN TRÁMITE',

  'ESPERANDO DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'ESPERA DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'FALTA DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'FALTAN PAPELES': 'ESPERANDO DOCUMENTACIÓN',
  DOCUMENTACION: 'ESPERANDO DOCUMENTACIÓN',
  'PENDIENTE DOCUMENTACION': 'ESPERANDO DOCUMENTACIÓN',
  'ESPERANDO PAPELES': 'ESPERANDO DOCUMENTACIÓN',

  CERRADO: 'CERRADO',
  CERRADA: 'CERRADO',
  FINALIZADO: 'CERRADO',
  TERMINADO: 'CERRADO',
  PAGADO: 'CERRADO',
  PAGADA: 'CERRADO',
  LIQUIDADO: 'CERRADO',
  COBRADO: 'CERRADO',
  RECHAZADO: 'CERRADO',
  RECHAZADA: 'CERRADO',
  ANULADO: 'CERRADO',
}

/**
 * Lleva lo que haya guardado a uno de los cuatro estados. Un texto que no se reconoce se toma como
 * CARGADO —está denunciado y todavía no se sabe más— y el original se sigue mostrando al lado, igual
 * que hace la rendición de Imputados con su RESULTADO.
 */
export function normalizarEstadoSiniestro(valor: string | null | undefined): EstadoSiniestro {
  const texto = normalizar(valor)
  if (!texto) return 'CARGADO'
  if ((ESTADOS_DE_SINIESTRO as readonly string[]).includes(texto)) return texto as EstadoSiniestro
  // «EN TRÁMITE» normalizado pierde la tilde: se compara contra la lista ya normalizada.
  const directo = ESTADOS_DE_SINIESTRO.find((estado) => normalizar(estado) === texto)
  if (directo) return directo
  return SINONIMOS_DE_ESTADO[texto] ?? 'CARGADO'
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
