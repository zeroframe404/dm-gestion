// Qué es lo que se escribió en «DNI / CUIT»: un documento de una persona o una clave fiscal.
//
// En la agencia los dos entran por el mismo campo y así tiene que seguir siendo: quien carga un
// cliente copia lo que dice el papel que tiene delante y no le corresponde a él decidir la etiqueta.
// La decide esta función, y la pantalla la muestra al lado del campo para que se vea que el sistema
// entendió lo mismo que la persona.
//
// Va en `shared` porque lo necesitan los dos lados: el renderer para el cartelito en vivo, y el
// proceso principal para no aceptar un CUIT con el dígito verificador cambiado. `normalizar.ts` no
// servía: importa `node:crypto` y el renderer no puede cargarlo.
//
// Un CUIT/CUIL argentino son once dígitos: dos de prefijo, ocho del documento y uno verificador que
// se calcula por módulo 11. Los prefijos que existen son 20/23/24/27 (personas físicas: 20 y 23 para
// varones, 27 y 23 para mujeres, 24 para casos con documentos repetidos) y 30/33/34 (personas
// jurídicas). Un número de once dígitos con otro prefijo no es un CUIT: es un error de tipeo.

export type ClaseDeDocumento = 'DNI' | 'CUIT' | 'CUIL' | 'DESCONOCIDO'

export interface DocumentoDetectado {
  /** Qué resultó ser. 'DESCONOCIDO' es lo que no llega a ninguna de las dos formas. */
  clase: ClaseDeDocumento
  /** Sólo los dígitos de lo que se escribió. */
  digitos: string
  /** true si la forma cierra: largo correcto y, en el CUIT, dígito verificador correcto. */
  valido: boolean
  /** Cómo se escribe de vuelta: '20-12345678-9' para un CUIT, '12.345.678' para un DNI. */
  formateado: string
  /**
   * El DNI que hay adentro: el número tal cual si es un DNI, y los ocho dígitos del medio si es un
   * CUIT de persona física. null cuando es una sociedad o no se entiende.
   */
  dni: string | null
  /** Qué mostrarle a quien está cargando. Vacío mientras el campo está vacío. */
  leyenda: string
}

/** Prefijos de CUIT de persona física; el resto (30, 33, 34) son sociedades. */
const PREFIJOS_PERSONA = ['20', '23', '24', '27']
const PREFIJOS_EMPRESA = ['30', '33', '34']

/** Los pesos del módulo 11, en el orden en que se leen los diez primeros dígitos. */
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

const VACIO: DocumentoDetectado = {
  clase: 'DESCONOCIDO',
  digitos: '',
  valido: false,
  formateado: '',
  dni: null,
  leyenda: '',
}

export function soloDigitosDeDocumento(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor).replace(/\D+/g, '')
}

/**
 * El dígito verificador que le corresponde a los diez primeros dígitos de un CUIT.
 * El resto de dividir por 11 se transforma así: 0 → 0, 1 → 9, y cualquier otro → 11 menos el resto.
 */
export function digitoVerificadorDeCuit(diezDigitos: string): number | null {
  if (!/^\d{10}$/.test(diezDigitos)) return null
  let suma = 0
  for (let i = 0; i < 10; i++) suma += Number(diezDigitos[i]) * PESOS[i]!
  const resto = suma % 11
  if (resto === 0) return 0
  if (resto === 1) return 9
  return 11 - resto
}

export function esCuitValido(valor: unknown): boolean {
  const digitos = soloDigitosDeDocumento(valor)
  if (digitos.length !== 11) return false
  const esperado = digitoVerificadorDeCuit(digitos.slice(0, 10))
  return esperado !== null && esperado === Number(digitos[10])
}

/** '20123456789' → '20-12345678-9'. */
export function formatearCuit(digitos: string): string {
  if (digitos.length !== 11) return digitos
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`
}

/** '12345678' → '12.345.678'. Es como se lee un DNI en Argentina. */
export function formatearDni(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/**
 * Lo que se escribió, resuelto. No corrige ni completa nada: sólo dice qué entendió, para que la
 * pantalla lo muestre y quien carga se dé cuenta en el momento si se le fue un dígito.
 */
export function detectarDocumento(valor: unknown): DocumentoDetectado {
  const digitos = soloDigitosDeDocumento(valor)
  if (digitos.length === 0) return VACIO

  // Once dígitos sólo puede querer ser un CUIT. Si el prefijo o el verificador no cierran, se dice
  // cuál de las dos cosas falló: «no es válido» a secas manda a contar dígitos a mano.
  if (digitos.length === 11) {
    const prefijo = digitos.slice(0, 2)
    const esPersona = PREFIJOS_PERSONA.includes(prefijo)
    const esEmpresa = PREFIJOS_EMPRESA.includes(prefijo)
    if (!esPersona && !esEmpresa) {
      return {
        clase: 'CUIT',
        digitos,
        valido: false,
        formateado: formatearCuit(digitos),
        dni: null,
        leyenda: `CUIT con un comienzo que no existe (${prefijo}). Los CUIT empiezan con 20, 23, 24, 27, 30, 33 o 34.`,
      }
    }
    const valido = esCuitValido(digitos)
    const clase: ClaseDeDocumento = esPersona ? 'CUIL' : 'CUIT'
    const nombre = esPersona ? 'CUIL' : 'CUIT'
    return {
      clase,
      digitos,
      valido,
      formateado: formatearCuit(digitos),
      dni: esPersona ? digitos.slice(2, 10).replace(/^0+/, '') : null,
      leyenda: valido
        ? `${nombre} ${formatearCuit(digitos)}${esPersona ? ` · DNI ${formatearDni(digitos.slice(2, 10).replace(/^0+/, ''))}` : ' · empresa'}`
        : `${nombre} con el último dígito equivocado. Revisá el número.`,
    }
  }

  // De siete a nueve dígitos es un DNI. Siete son los documentos viejos y nueve aparece cuando
  // alguien pega el número con un cero adelante; los dos se aceptan y se muestran sin el relleno.
  if (digitos.length >= 7 && digitos.length <= 9) {
    const limpio = digitos.replace(/^0+/, '')
    if (limpio.length >= 7 && limpio.length <= 8) {
      return {
        clase: 'DNI',
        digitos: limpio,
        valido: true,
        formateado: formatearDni(limpio),
        dni: limpio,
        leyenda: `DNI ${formatearDni(limpio)}`,
      }
    }
  }

  return {
    clase: 'DESCONOCIDO',
    digitos,
    valido: false,
    formateado: digitos,
    dni: null,
    leyenda:
      digitos.length < 7
        ? 'Todavía faltan números: un DNI tiene 7 u 8 y un CUIT tiene 11.'
        : 'No parece ni un DNI (7 u 8 números) ni un CUIT (11 números).',
  }
}
