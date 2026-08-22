// Reglas de las pólizas: su estado, cuánto les falta para vencer, y la validación de antigüedad
// contra lo que acepta cada compañía. Vive en shared, como el semáforo, porque lo usan las tres
// pantallas nuevas y el proceso principal, y tiene que ser una sola regla para todos.

import type { AvisoDeCobertura, EstadoPoliza, ReglaDeCobertura } from './tipos'

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** 'AAAA-MM-DD' → días desde 1970. Devuelve null si el texto no es una fecha ISO válida. */
export function aDia(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const anio = Number(iso.slice(0, 4))
  const mes = Number(iso.slice(5, 7))
  const dia = Number(iso.slice(8, 10))
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  return Math.floor(Date.UTC(anio, mes - 1, dia) / 86_400_000)
}

/** Días desde 1970 → 'AAAA-MM-DD'. */
export function desdeDia(dias: number): string {
  return new Date(dias * 86_400_000).toISOString().slice(0, 10)
}

/** Días que hay entre dos fechas ISO (positivo si `hasta` es posterior). null si alguna no es válida. */
export function diasEntre(desde: string | null | undefined, hasta: string | null | undefined): number | null {
  const a = aDia(desde)
  const b = aDia(hasta)
  if (a === null || b === null) return null
  return b - a
}

/** Días que faltan para que venza la vigencia (negativo si ya venció). null si no hay fecha cargada. */
export function diasParaVencer(vigenciaHastaIso: string | null | undefined, hoy: string): number | null {
  return diasEntre(hoy, vigenciaHastaIso)
}

/**
 * La misma fecha un año después: es lo que la bandeja propone al renovar. El 29 de febrero de un año
 * bisiesto pasa al 28, que es lo que hacen las compañías.
 */
export function unAnioDespues(iso: string): string {
  const anio = Number(iso.slice(0, 4))
  const mes = Number(iso.slice(5, 7))
  const dia = Number(iso.slice(8, 10))
  const ultimoDelMes = new Date(Date.UTC(anio + 1, mes, 0)).getUTCDate()
  return `${anio + 1}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimoDelMes)).padStart(2, '0')}`
}

/** El lunes de la semana en la que cae esa fecha. Acá la semana arranca el lunes. */
export function lunesDe(iso: string): string {
  const dias = aDia(iso)
  if (dias === null) return iso
  // 1970-01-01 fue jueves: +3 alinea el lunes con el resto 0.
  const diaDeLaSemana = (((dias + 3) % 7) + 7) % 7
  return desdeDia(dias - diaDeLaSemana)
}

/**
 * '2027-04-27' → '27/4/2027', que es como están escritas las fechas en la hoja. Se usa al guardar lo
 * que se cargó con un selector de fecha (que siempre entrega 'AAAA-MM-DD'): la columna de la planilla
 * tiene que seguir viéndose como la escribió la agencia durante años, no en formato ISO.
 */
export function comoTextoDeFecha(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return `${Number(iso.slice(8, 10))}/${Number(iso.slice(5, 7))}/${iso.slice(0, 4)}`
}

/** true si el texto es una fecha 'AAAA-MM-DD' (la que entrega un <input type="date">). */
export function pareceIso(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor.trim())
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** '2026-09-08' → '8 de sep'. Para los títulos de las semanas y las columnas de fecha. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? ''
  const mes = MESES_CORTOS[Number(iso.slice(5, 7)) - 1] ?? ''
  return `${Number(iso.slice(8, 10))} de ${mes}`
}

/**
 * Cómo se titula cada semana de la bandeja de renovaciones. Las tres primeras se nombran solas
 * («Esta semana», «La semana que viene») porque son las que se miran todos los días.
 */
export function tituloDeSemana(lunesDeLaSemana: string, hoy: string): string {
  const distancia = diasEntre(lunesDe(hoy), lunesDeLaSemana)
  if (distancia === 0) return 'Esta semana'
  if (distancia === 7) return 'La semana que viene'
  const domingo = desdeDia((aDia(lunesDeLaSemana) ?? 0) + 6)
  return `Semana del ${fechaCorta(lunesDeLaSemana)} al ${fechaCorta(domingo)}`
}

// ---------------------------------------------------------------------------
// Estado de la póliza
// ---------------------------------------------------------------------------

/**
 * ACTIVA, BAJA o VENCIDA. La baja manda sobre todo: una póliza dada de baja no es «vencida» aunque
 * su vigencia haya pasado. Sin fecha de vigencia cargada no se puede afirmar que venció, así que
 * sigue ACTIVA (es lo que pasa con buena parte de lo importado, donde la vigencia viene vacía).
 */
export function estadoDePoliza(activa: boolean, vigenciaHastaIso: string | null | undefined, hoy: string): EstadoPoliza {
  if (!activa) return 'BAJA'
  const dias = diasParaVencer(vigenciaHastaIso, hoy)
  if (dias !== null && dias < 0) return 'VENCIDA'
  return 'ACTIVA'
}

export const NOMBRE_ESTADO_POLIZA: Record<EstadoPoliza, string> = {
  ACTIVA: 'Activa',
  BAJA: 'Baja',
  VENCIDA: 'Vencida',
}

/** Cuántos días antes del vencimiento entra una póliza en la bandeja de renovaciones. */
export const DIAS_DE_RENOVACION = 60

// ---------------------------------------------------------------------------
// «20% aumentar cuando se renueva»
// ---------------------------------------------------------------------------

/**
 * La agencia deja escrito en las observaciones de algunas pólizas que al renovar hay que aumentar la
 * cuota. Se busca la idea, no el texto exacto: «20% aumentar cuando se renueva», «aumentar 20 % al
 * renovar» y «SUBE 15% EN LA RENOVACION» valen todas, porque nadie lo escribe siempre igual.
 */
export function pideAumentoAlRenovar(observaciones: string | null | undefined): boolean {
  if (!observaciones) return false
  const texto = observaciones
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (!/\d\s*%|\bPOR\s?CIENTO\b/.test(texto)) return false
  if (!/\bAUMENT|\bSUBE\b|\bSUBIR\b|\bINCREMENT|\bAJUST/.test(texto)) return false
  // Ojo con la raíz: el verbo cambia la o por ue al conjugarse, así que «renovar» y «renovación»
  // llevan RENOV pero «se renueva» —que es justo como está escrito en la planilla— lleva RENUEV.
  return /\bRENOV|\bRENUEV/.test(texto)
}

/** El porcentaje que pide la observación, si se puede leer («20% aumentar…» → 20). */
export function porcentajeDeAumento(observaciones: string | null | undefined): number | null {
  if (!pideAumentoAlRenovar(observaciones)) return null
  const encontrado = (observaciones ?? '').match(/(\d{1,3})\s*%/)
  if (!encontrado) return null
  const numero = Number(encontrado[1])
  return numero > 0 && numero <= 100 ? numero : null
}

// ---------------------------------------------------------------------------
// Antigüedad del vehículo contra lo que acepta la compañía
// ---------------------------------------------------------------------------

/**
 * Año del vehículo a partir del texto de la hoja. Ahí hay de todo: «2018», «18», «---», «0KM» y
 * celdas vacías. Devuelve null cuando no se puede afirmar un año, y entonces no se valida nada:
 * es preferible no advertir a advertir de más.
 */
export function anioDeVehiculo(texto: string | null | undefined, anioActual: number): number | null {
  const limpio = (texto ?? '').trim()
  if (!limpio) return null
  const encontrado = limpio.match(/(?:^|\D)(\d{2}|\d{4})(?:\D|$)/)
  if (!encontrado) return null
  let anio = Number(encontrado[1])
  // Dos dígitos: «98» es 1998 y «18» es 2018. El corte es el año que viene.
  if (anio < 100) anio += anio <= (anioActual + 1) % 100 ? 2000 : 1900
  if (anio < 1900 || anio > anioActual + 1) return null
  return anio
}

/** El año más viejo que acepta esa regla, o null si la regla no pone límite. */
export function anioMinimoDe(regla: ReglaDeCobertura, anioActual: number): number | null {
  if (regla.anioMinimo !== null && regla.anioMinimo > 1900) return regla.anioMinimo
  if (regla.antiguedadMaxima !== null && regla.antiguedadMaxima >= 0) return anioActual - regla.antiguedadMaxima
  return null
}

/**
 * Compara el año del vehículo contra la regla de la compañía. Degrada bien a propósito: si no hay
 * regla cargada para esa compañía y cobertura, o la regla no tiene límite, o el año del vehículo no
 * se entiende, NO se advierte nada y la póliza se guarda normal. La advertencia aparece sólo cuando
 * las tres cosas están y el vehículo no llega.
 */
export function validarAntiguedad(
  regla: ReglaDeCobertura | null,
  anioTexto: string | null | undefined,
  anioActual: number,
): AvisoDeCobertura {
  if (!regla) return { hayProblema: false, mensaje: '', regla: null }

  const limite = anioMinimoDe(regla, anioActual)
  if (limite === null) return { hayProblema: false, mensaje: '', regla }

  const anio = anioDeVehiculo(anioTexto, anioActual)
  if (anio === null) {
    return {
      hayProblema: false,
      mensaje: `${regla.compania ?? 'La compañía'} acepta ${regla.cobertura ?? 'esta cobertura'} desde el modelo ${limite}, pero el año del vehículo no está cargado: revisalo antes de emitir.`,
      regla,
    }
  }
  if (anio >= limite) return { hayProblema: false, mensaje: '', regla }

  const antiguedad = anioActual - anio
  return {
    hayProblema: true,
    mensaje:
      `${regla.compania ?? 'La compañía'} no acepta ${regla.cobertura ?? 'esta cobertura'} para un vehículo modelo ${anio} ` +
      `(${antiguedad} ${antiguedad === 1 ? 'año' : 'años'} de antigüedad): toma desde el modelo ${limite}.`,
    regla,
  }
}

/** Busca en la matriz la regla de esa compañía y esa cobertura. Compara normalizando, como todo acá. */
export function buscarRegla(reglas: ReglaDeCobertura[], compania: string | null, cobertura: string | null): ReglaDeCobertura | null {
  const clave = (valor: string | null | undefined) =>
    (valor ?? '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()
  const c = clave(compania)
  const b = clave(cobertura)
  if (!c || !b) return null
  return reglas.find((regla) => clave(regla.compania) === c && clave(regla.cobertura) === b) ?? null
}
