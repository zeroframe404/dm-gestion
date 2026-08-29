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
  /** true cuando lo escrito tiene forma de fecha pero es imposible o está en el futuro. */
  problema: string | null
}

const SIN_FECHA: EdadCalculada = { iso: null, anios: null, esMenor: false, leyenda: '', problema: null }

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/**
 * Lo escrito, entendido como fecha de nacimiento. Acepta d/m/aaaa, d-m-aa y aaaa-mm-dd.
 *
 * Con dos dígitos de año hay que adivinar el siglo, y para un nacimiento la regla razonable es que
 * «80» es 1980 y no 2080: todo lo que caería en el futuro se manda cien años atrás.
 */
export function interpretarNacimiento(valor: unknown, hoy = new Date()): string | null {
  const texto = valor === null || valor === undefined ? '' : String(valor).trim()
  if (!texto) return null

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
      const siglo = Math.floor(hoy.getFullYear() / 100) * 100
      anio += siglo
      if (anio > hoy.getFullYear()) anio -= 100
    }
  } else {
    return null
  }

  if (mes < 1 || mes > 12) return null
  if (dia < 1 || dia > diasDelMes(anio, mes)) return null
  // Nadie que esté cargando un seguro nació antes de 1900, y nadie nació el año que viene.
  if (anio < 1900 || anio > hoy.getFullYear()) return null

  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
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
