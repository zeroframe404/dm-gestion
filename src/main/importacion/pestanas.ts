// Clasificación de pestañas por su título e inferencia del período (año-mes) de cada planilla mensual.
import type { TipoPestana } from '../../shared/tipos'
import { normalizarTexto } from './normalizar'

export const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'] as const

/** Variantes y abreviaturas → número de mes (1-12). */
const ALIAS_MESES: Record<string, number> = {
  ENE: 1,
  FEB: 2,
  MAR: 3,
  ABR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AGO: 8,
  SEP: 9,
  SEPT: 9,
  SET: 9,
  SETIEMBRE: 9,
  OCT: 10,
  NOV: 11,
  DIC: 12,
}
MESES.forEach((mes, indice) => {
  ALIAS_MESES[mes] = indice + 1
})

export interface ClasificacionPestana {
  tipo: TipoPestana
  mes: number | null
  anio: number | null
}

function mesDesdePalabra(palabra: string): number | null {
  return ALIAS_MESES[palabra] ?? null
}

function anioDesdeDigitos(digitos: string | undefined): number | null {
  if (!digitos) return null
  const numero = Number(digitos)
  if (digitos.length === 4) return numero
  if (digitos.length === 2) return 2000 + numero
  return null
}

/** Busca un mes y un año dentro de un título ("BAJAS ENERO 26", "DICIEMBRE25", "MARZO 2024"). */
function mesYAnioEnTitulo(normalizado: string): { mes: number | null; anio: number | null } {
  let mes: number | null = null
  let anio: number | null = null
  for (const trozo of normalizado.split(' ')) {
    // "DICIEMBRE25" → palabra + dígitos pegados
    const pegado = trozo.match(/^([A-Z]+)(\d{2}|\d{4})$/)
    if (pegado) {
      const m = mesDesdePalabra(pegado[1] ?? '')
      if (m) {
        mes = m
        anio = anioDesdeDigitos(pegado[2])
        continue
      }
    }
    const m = mesDesdePalabra(trozo)
    if (m && mes === null) {
      mes = m
      continue
    }
    if (/^(\d{2}|\d{4})$/.test(trozo) && anio === null) anio = anioDesdeDigitos(trozo)
  }
  return { mes, anio }
}

export function clasificarPestana(titulo: string): ClasificacionPestana {
  const t = normalizarTexto(titulo)
  const { mes, anio } = mesYAnioEnTitulo(t)

  // Las pestañas que crea DM Gestión se reconocen primero y por su nombre exacto: son las únicas de la
  // hoja cuyos encabezados los escribió la aplicación, y no tienen que competir con ninguna otra regla
  // («APP TAREAS» no es una planilla mensual aunque alguien renombre algo parecido).
  if (t === 'APP LEADS') return { tipo: 'APP_LEADS', mes: null, anio: null }
  if (t === 'APP PRESUPUESTOS') return { tipo: 'APP_PRESUPUESTOS', mes: null, anio: null }
  if (t === 'APP TAREAS') return { tipo: 'APP_TAREAS', mes: null, anio: null }
  if (t === 'APP RECHAZOS') return { tipo: 'APP_RECHAZOS', mes: null, anio: null }
  if (t === 'APP ADJUNTOS') return { tipo: 'APP_ADJUNTOS', mes: null, anio: null }
  if (t === 'APP COMENTARIOS') return { tipo: 'APP_COMENTARIOS', mes: null, anio: null }
  // APP PAGOS es una pestaña de pagos como IMPUTADOS, sólo que la escribe la aplicación (ver
  // sincronizacion/pestanasApp.ts): se importa y se sincroniza con las mismas reglas que aquélla.
  if (t === 'APP PAGOS') return { tipo: 'PAGOS', mes: null, anio: null }

  if (/\bBAJAS?\b/.test(t)) return { tipo: 'BAJAS', mes, anio }
  if (t.includes('RIESGO')) return { tipo: 'RIESGOS_VARIOS', mes: null, anio: null }
  if (t.includes('SINIESTRO')) return { tipo: 'SINIESTROS', mes: null, anio: null }
  if (t.includes('IMPUTADO') || t.includes('IMPUTACION') || /^PAGOS?\b/.test(t)) return { tipo: 'PAGOS', mes: null, anio: null }
  if (t.includes('COBERTURA')) return { tipo: 'COBERTURA', mes: null, anio: null }
  if (t.includes('CONTADOR')) return { tipo: 'CONTADOR', mes: null, anio: null }
  if (t.startsWith('SEGUROS ACT') || t === 'SEGUROS ACTIVOS' || t === 'SEGUROS ACTUALES') return { tipo: 'SEGUROS_ACT', mes: null, anio: null }
  if (t === 'AMP') return { tipo: 'AMP', mes: null, anio: null }

  // Planilla mensual: el título nombra UN mes y ninguna palabra de los otros tipos. Así entran
  // «AGOSTO», «AGOSTO 2026», «Copia de ABRIL» y «SEPTIEMBRE 2026 EN CARGA», que antes caían en OTRA
  // y perdían todas sus cuotas. Con dos meses en el título («ENERO A MARZO») no se arriesga nada.
  if (mes !== null && contarMeses(t) === 1) return { tipo: 'MENSUAL', mes, anio }
  return { tipo: 'OTRA', mes: null, anio: null }
}

/** Cuántas palabras del título son un nombre de mes (contando «DICIEMBRE25»). */
function contarMeses(normalizado: string): number {
  let total = 0
  for (const trozo of normalizado.split(' ')) {
    const pegado = trozo.match(/^([A-Z]+)(\d{2}|\d{4})$/)
    if (pegado && mesDesdePalabra(pegado[1] ?? '')) total++
    else if (mesDesdePalabra(trozo)) total++
  }
  return total
}

export function formatearPeriodo(anio: number, mes: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}`
}

export interface PestanaAClasificar {
  titulo: string
  indice: number
}

export interface PestanaClasificada extends PestanaAClasificar {
  tipo: TipoPestana
  mes: number | null
  anio: number | null
  periodo: string | null
  /** true cuando el año no estaba en el título y se dedujo por el orden de las pestañas. */
  anioInferido: boolean
}

/**
 * Clasifica todas las pestañas y deduce el año de las mensuales que no lo dicen en el título.
 *
 * Regla: se recorren las planillas mensuales en el orden de la hoja (se detecta si van de más vieja a
 * más nueva o al revés); el primer año explícito ancla la serie y cada vez que el mes "vuelve atrás"
 * se suma un año. Si ninguna pestaña trae año, la última mensual se asume del año actual.
 */
export function clasificarPestanas(
  pestanas: PestanaAClasificar[],
  anioActual = new Date().getFullYear(),
  mesActual = new Date().getMonth() + 1,
): PestanaClasificada[] {
  const resultado: PestanaClasificada[] = pestanas.map((p) => {
    const c = clasificarPestana(p.titulo)
    return { ...p, ...c, periodo: null, anioInferido: false }
  })

  const mensuales = resultado.filter((p) => p.tipo === 'MENSUAL' && p.mes !== null).sort((a, b) => a.indice - b.indice)
  if (mensuales.length > 0) {
    // ¿La hoja va en orden cronológico ascendente o descendente? Diciembre → enero cuenta como avance
    // (distancia circular de 1 mes), no como retroceso de 11.
    let subas = 0
    let bajadas = 0
    for (let i = 1; i < mensuales.length; i++) {
      const anterior = mensuales[i - 1]!
      const actual = mensuales[i]!
      if (anterior.anio !== null && actual.anio !== null && anterior.anio !== actual.anio) {
        if (actual.anio > anterior.anio) subas++
        else bajadas++
      } else {
        const distancia = (actual.mes! - anterior.mes! + 12) % 12
        if (distancia === 0) continue
        if (distancia <= 6) subas++
        else bajadas++
      }
    }
    const ascendentes = bajadas > subas ? [...mensuales].reverse() : mensuales

    const anclaIndice = ascendentes.findIndex((p) => p.anio !== null)
    if (anclaIndice === -1) {
      // Sin ningún año escrito hay que anclar la serie al calendario. La planilla que más probablemente
      // sea del año en curso es la del mes de hoy o, si no está, la del mes anterior más cercano: en una
      // hoja que se lleva mes a mes, la última cargada es la del mes corriente. Si no hay ninguna anterior
      // a hoy, la de mes más alto es del año pasado.
      const candidatas = ascendentes.filter((p) => p.mes! <= mesActual)
      const ancla = candidatas.length > 0
        ? candidatas.reduce((mejor, p) => (p.mes! > mejor.mes! ? p : mejor))
        : ascendentes.reduce((mejor, p) => (p.mes! > mejor.mes! ? p : mejor))
      ancla.anio = candidatas.length > 0 ? anioActual : anioActual - 1
      ancla.anioInferido = true
    }
    const ancla = ascendentes.findIndex((p) => p.anio !== null)

    // Hacia adelante: si el mes no avanza respecto del anterior, cambió el año.
    for (let i = ancla + 1; i < ascendentes.length; i++) {
      const anterior = ascendentes[i - 1]!
      const actual = ascendentes[i]!
      if (actual.anio === null) {
        actual.anio = actual.mes! <= anterior.mes! ? anterior.anio! + 1 : anterior.anio!
        actual.anioInferido = true
      }
    }
    // Hacia atrás: si el mes no retrocede respecto del siguiente, es el año anterior.
    for (let i = ancla - 1; i >= 0; i--) {
      const siguiente = ascendentes[i + 1]!
      const actual = ascendentes[i]!
      if (actual.anio === null) {
        actual.anio = actual.mes! >= siguiente.mes! ? siguiente.anio! - 1 : siguiente.anio!
        actual.anioInferido = true
      }
    }
    for (const p of mensuales) p.periodo = formatearPeriodo(p.anio!, p.mes!)
  }

  // Bajas con mes en el título: el año sale de la planilla mensual de ese mes que esté MÁS CERCA en la
  // hoja. Tomar la de mayor período re-sellaba «BAJAS DICIEMBRE» de 2025 como 2026 apenas aparecía el
  // diciembre siguiente.
  for (const p of resultado) {
    if (p.tipo !== 'BAJAS' || p.mes === null) continue
    if (p.anio !== null) {
      p.periodo = formatearPeriodo(p.anio, p.mes)
      continue
    }
    let vecina: PestanaClasificada | null = null
    for (const m of mensuales) {
      if (m.mes !== p.mes) continue
      if (!vecina || Math.abs(m.indice - p.indice) < Math.abs(vecina.indice - p.indice)) vecina = m
    }
    p.periodo = vecina?.periodo ?? null
    p.anioInferido = p.periodo !== null
  }
  return resultado
}

/**
 * Revisa que los períodos deducidos cierren: que avancen siempre para el mismo lado en el orden de la
 * hoja, que no haya dos planillas del mismo período y que la más nueva no quede en el futuro. Devuelve
 * los avisos encontrados (vacío = todo bien). Es la red contra una solapa arrastrada de lugar o un año
 * mal tipeado, que corrían todos los períodos y podían hacer que «la más nueva» fuera en realidad vieja.
 */
export function revisarCoherenciaDePeriodos(
  pestanas: PestanaClasificada[],
  anioActual = new Date().getFullYear(),
  mesActual = new Date().getMonth() + 1,
): string[] {
  const mensuales = pestanas.filter((p) => p.tipo === 'MENSUAL' && p.periodo).sort((a, b) => a.indice - b.indice)
  if (mensuales.length === 0) return []
  const avisos: string[] = []

  const primero = mensuales[0]!.periodo!
  const ultimo = mensuales[mensuales.length - 1]!.periodo!
  const ascendente = ultimo >= primero
  for (let i = 1; i < mensuales.length; i++) {
    const anterior = mensuales[i - 1]!
    const actual = mensuales[i]!
    const avanza = ascendente ? actual.periodo! > anterior.periodo! : actual.periodo! < anterior.periodo!
    if (!avanza) {
      avisos.push(
        `Los períodos no siguen el orden de las pestañas: «${anterior.titulo}» quedó en ${anterior.periodo} y la siguiente, «${actual.titulo}», en ${actual.periodo}. Renombrá las pestañas con el año (por ejemplo «ENERO 2026») para que no queden dudas.`,
      )
      break
    }
  }

  const repetidos = new Map<string, string[]>()
  for (const m of mensuales) repetidos.set(m.periodo!, [...(repetidos.get(m.periodo!) ?? []), m.titulo])
  for (const [periodo, titulos] of repetidos) {
    if (titulos.length > 1) avisos.push(`Hay más de una planilla mensual para ${periodo}: ${titulos.map((t) => `«${t}»`).join(', ')}.`)
  }

  // Un mes en el futuro (más allá del próximo) casi siempre significa un año mal deducido.
  const limite = formatearPeriodo(mesActual === 12 ? anioActual + 1 : anioActual, mesActual === 12 ? 1 : mesActual + 1)
  const masNuevo = mensuales.reduce((maximo, m) => (m.periodo! > maximo ? m.periodo! : maximo), mensuales[0]!.periodo!)
  if (masNuevo > limite) {
    const titulo = mensuales.find((m) => m.periodo === masNuevo)!.titulo
    avisos.push(`La planilla «${titulo}» quedó en el período ${masNuevo}, que todavía no llegó (hoy es ${formatearPeriodo(anioActual, mesActual)}). Revisá el año del título.`)
  }
  return avisos
}

/** Período a partir de un texto de mes ("ENERO", "enero 26", "03/2026", "2026-03"), con ayuda de las mensuales. */
export function periodoDesdeTextoDeMes(texto: string, periodoPorMes: Map<number, string>, anioPorDefecto: number | null): string | null {
  const t = normalizarTexto(texto)
  if (!t) return null
  const numerico = t.match(/^(\d{1,2})\s(\d{2}|\d{4})$/) ?? t.match(/^(\d{4})\s(\d{1,2})$/)
  if (numerico) {
    const a = numerico[1]!.length === 4 ? Number(numerico[1]) : anioDesdeDigitos(numerico[2])
    const m = numerico[1]!.length === 4 ? Number(numerico[2]) : Number(numerico[1])
    if (a !== null && m >= 1 && m <= 12) return formatearPeriodo(a, m)
    return null
  }
  const { mes, anio } = mesYAnioEnTitulo(t)
  if (mes === null) return null
  if (anio !== null) return formatearPeriodo(anio, mes)
  const conocido = periodoPorMes.get(mes)
  if (conocido) return conocido
  return anioPorDefecto !== null ? formatearPeriodo(anioPorDefecto, mes) : null
}

/** Elige la planilla mensual más nueva (mayor período; a igual período, la de más a la derecha). */
export function elegirMasNueva<T extends { tipo: TipoPestana; periodo: string | null; indice: number }>(pestanas: T[]): T | null {
  let elegida: T | null = null
  for (const p of pestanas) {
    if (p.tipo !== 'MENSUAL' || !p.periodo) continue
    if (!elegida || p.periodo > elegida.periodo! || (p.periodo === elegida.periodo && p.indice > elegida.indice)) elegida = p
  }
  return elegida
}
