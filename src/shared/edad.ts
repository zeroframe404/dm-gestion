// La edad de un cliente a partir de la fecha de nacimiento que se escribió a mano.
//
// Hace falta por dos motivos que no son el mismo: en Argentina se es mayor de edad a los 18, y una
// póliza a nombre de un menor no se puede emitir sin más. Que la pantalla lo diga en el momento del
// alta evita la llamada de la compañía tres días después.
//
// La fecha se escribe libre («12/05/1980», «12-5-80», «1980-05-12»). `interpretarFecha` de la
// importación no sirve acá: vive en el proceso principal, importa `node:crypto` y además descarta
// todo lo anterior al año 2000 —que para una cuota es correcto y para un nacimiento es justo al
// revés—. Por eso esta versión es propia, y vive en `shared` para que la usen los dos lados.

/** Desde qué edad se es mayor en Argentina. */
export const MAYORIA_DE_EDAD = 18

export interface EdadCalculada {
  /** La fecha entendida, en ISO. null si lo escrito no es una fecha. */
  iso: string | null
  /** Años cumplidos al día de hoy. null si no se pudo entender la fecha. */
  anios: number | null
  esMenor: boolean
  /** Vacío si no hay nada que decir. Con un menor, la leyenda que pidió la agencia. */
  leyenda: string
  /** Qué le pasa a lo escrito cuando ya parece una fecha completa pero no sirve. null si no pasa nada. */
  problema: string | null
}

const SIN_FECHA: EdadCalculada = { iso: null, anios: null, esMenor: false, leyenda: '', problema: null }

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

function armarIso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Hoy, en ISO y con la hora del reloj de la máquina. Se arma a mano y no con `toISOString()` porque
 * `aniosCumplidos` también mira el reloj local: si una se fuera a UTC y la otra no, un alta cargada
 * de noche en Argentina compararía contra el día siguiente.
 */
function isoDeHoy(hoy: Date): string {
  return armarIso(hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate())
}

interface PartesDeFecha {
  anio: number
  mes: number
  dia: number
  iso: string
}

/**
 * Lo escrito, partido en año, mes y día. Vale como fecha del calendario y nada más: el 31 de febrero
 * no llega hasta acá, el 31 de diciembre del año que viene sí. Quién decide si eso sirve como
 * nacimiento es el que llama, y así la pantalla puede decir «esa fecha no existe» o «esa fecha
 * todavía no pasó», que no son el mismo error ni se corrigen igual.
 *
 * Acepta d/m/aaaa, d-m-aa y aaaa-mm-dd. Con dos dígitos de año hay que adivinar el siglo, y para un
 * nacimiento la regla razonable es que «80» es 1980 y no 2080: lo que caería en el futuro se manda
 * cien años atrás.
 */
function partesDeFecha(texto: string, hoy: Date): PartesDeFecha | null {
  let anio: number
  let mes: number
  let dia: number

  const iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const latina = texto.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (iso) {
    anio = Number(iso[1])
    mes = Number(iso[2])
    dia = Number(iso[3])
  } else if (latina) {
    dia = Number(latina[1])
    mes = Number(latina[2])
    anio = Number(latina[3])
    if (anio < 100) {
      anio += Math.floor(hoy.getFullYear() / 100) * 100
      // Se compara la fecha entera y no sólo el año: un «31/12/26» escrito en 2026 es alguien de 99
      // años, no un nacimiento de diciembre que todavía no pasó.
      if (armarIso(anio, mes, dia) > isoDeHoy(hoy)) anio -= 100
    }
  } else {
    return null
  }

  if (mes < 1 || mes > 12) return null
  if (dia < 1 || dia > diasDelMes(anio, mes)) return null

  return { anio, mes, dia, iso: armarIso(anio, mes, dia) }
}

/** Lo escrito, entendido como fecha de nacimiento. En ISO, o null si no sirve como nacimiento. */
export function interpretarNacimiento(valor: unknown, hoy = new Date()): string | null {
  const texto = valor === null || valor === undefined ? '' : String(valor).trim()
  if (!texto) return null

  const partes = partesDeFecha(texto, hoy)
  if (!partes) return null
  // Nadie que esté cargando un seguro nació antes de 1900.
  if (partes.anio < 1900) return null
  // Y nadie nació mañana. Acá antes se miraba nada más que el año, así que cualquier fecha posterior
  // a hoy pero dentro de este mismo año pasaba: `aniosCumplidos` devolvía -1 y la pantalla del alta
  // mostraba «Usuario menor de edad · -1 años» en vez de avisar que la fecha está mal.
  if (partes.iso > isoDeHoy(hoy)) return null

  return partes.iso
}

/** Años cumplidos entre una fecha ISO de nacimiento y hoy. */
export function aniosCumplidos(nacimientoIso: string, hoy = new Date()): number {
  const anio = Number(nacimientoIso.slice(0, 4))
  const mes = Number(nacimientoIso.slice(5, 7))
  const dia = Number(nacimientoIso.slice(8, 10))
  let edad = hoy.getFullYear() - anio
  // El cumpleaños de este año todavía no llegó: falta un año.
  const yaCumplio = hoy.getMonth() + 1 > mes || (hoy.getMonth() + 1 === mes && hoy.getDate() >= dia)
  if (!yaCumplio) edad -= 1
  return edad
}

/** Lo que la pantalla necesita saber de la fecha de nacimiento que se está escribiendo. */
export function calcularEdad(valor: unknown, hoy = new Date()): EdadCalculada {
  const texto = valor === null || valor === undefined ? '' : String(valor).trim()
  if (!texto) return SIN_FECHA

  const iso = interpretarNacimiento(texto, hoy)
  if (!iso) {
    const partes = partesDeFecha(texto, hoy)
    // Una fecha que existe pero no sirve como nacimiento se explica por lo que le pasa, no con un
    // «no existe» que manda a revisar el día cuando lo que está mal es el año.
    if (partes && partes.iso > isoDeHoy(hoy)) return { ...SIN_FECHA, problema: 'Esa fecha todavía no pasó. Revisá el año.' }
    if (partes && partes.anio < 1900) return { ...SIN_FECHA, problema: 'Revisá el año: esa fecha es demasiado vieja.' }
    // Mientras se está tipeando, media fecha no es un error: sólo se avisa cuando ya parece completa.
    const pareceCompleta = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(texto) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(texto)
    return { ...SIN_FECHA, problema: pareceCompleta ? 'Esa fecha no existe. Escribila como 12/05/1980.' : null }
  }

  const anios = aniosCumplidos(iso, hoy)
  const esMenor = anios < MAYORIA_DE_EDAD
  return {
    iso,
    anios,
    esMenor,
    leyenda: esMenor ? 'Usuario menor de edad' : '',
    problema: null,
  }
}
