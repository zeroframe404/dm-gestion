// Lo común a todo lo que la versión de demostración simula en lugar de salir a internet: las APIs de
// las compañías (ver aseguradoras.ts y galeno.ts), Meta (redes.ts) y los servicios sueltos (apis.ts).
//
// Dos reglas para que la demo se sienta de verdad y no «de juguete»:
//   · LO MISMO DA LO MISMO. Todo lo inventado sale de un hash de lo que se pidió, nunca de Math.random:
//     cotizar dos veces el mismo auto da el mismo precio, y otro auto da otro. Así una demostración se
//     puede repetir delante del cliente sin que los números bailen.
//   · TARDA LO QUE TARDARÍA. Una compañía que contesta en 0 ms delata la simulación; cada respuesta
//     espera un rato parecido al de la API de verdad. Las pruebas apagan la espera.

/** Un número de 32 bits estable para un texto (FNV-1a). */
export function hashDe(texto: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Un número entre 0 (incluido) y 1 (excluido), siempre el mismo para la misma semilla. */
export function azarDe(semilla: string): number {
  return hashDe(semilla) / 0x1_0000_0000
}

/** Un entero entre `minimo` y `maximo` (los dos incluidos), siempre el mismo para la misma semilla. */
export function enteroDe(semilla: string, minimo: number, maximo: number): number {
  return minimo + Math.floor(azarDe(semilla) * (maximo - minimo + 1))
}

/** Uno de la lista, siempre el mismo para la misma semilla. */
export function unoDe<T>(semilla: string, lista: readonly T[]): T {
  return lista[hashDe(semilla) % lista.length]!
}

let conDemoras = true

/** Para las pruebas: que la demo conteste al instante. */
export function demorasDeLaDemo(activas: boolean): void {
  conDemoras = activas
}

/** Espera lo que tardaría la API de verdad: entre `minimoMs` y `maximoMs`. */
export function esperarComoLaApi(minimoMs: number, maximoMs: number): Promise<void> {
  if (!conDemoras) return Promise.resolve()
  const ms = minimoMs + Math.random() * Math.max(0, maximoMs - minimoMs)
  return new Promise((resolver) => setTimeout(resolver, ms))
}

export function redondear(monto: number): number {
  return Math.round(monto * 100) / 100
}

// --- Fechas ---------------------------------------------------------------------------------------------

/** aaaa-mm-dd de la fecha local. */
export function fechaIso(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

export function sumarDias(iso: string, dias: number): string {
  const fecha = new Date(`${iso}T12:00:00`)
  fecha.setDate(fecha.getDate() + dias)
  return fechaIso(fecha)
}

export function sumarMeses(iso: string, meses: number): string {
  const fecha = new Date(`${iso}T12:00:00`)
  fecha.setMonth(fecha.getMonth() + meses)
  return fechaIso(fecha)
}

/** aaaa-mm-dd → dd/mm/aaaa, como lo devuelven casi todas las APIs de las compañías. */
export function fechaArgentina(iso: string): string {
  const [anio, mes, dia] = iso.split('-')
  return `${dia}/${mes}/${anio}`
}

/** Los días entre `desde` y `hasta` (incluidos), sin pasarse de hoy: nadie cotizó en el futuro. */
export function diasDelRango(desde: string, hasta: string): string[] {
  const hoy = fechaIso(new Date())
  const tope = hasta < hoy ? hasta : hoy
  const dias: string[] = []
  for (let dia = desde; dia <= tope && dias.length < 400; dia = sumarDias(dia, 1)) dias.push(dia)
  return dias
}

// --- Gente, vehículos y lugares de ejemplo -------------------------------------------------------------
//
// Inventados: ningún nombre ni documento es de un cliente real.

const NOMBRES = ['Juan', 'María', 'Carlos', 'Laura', 'Diego', 'Florencia', 'Martín', 'Valeria', 'Pablo', 'Natalia', 'Sergio', 'Carolina', 'Lucas', 'Romina', 'Gustavo', 'Silvina', 'Federico', 'Paula', 'Hernán', 'Gabriela']
const APELLIDOS = ['GÓMEZ', 'FERNÁNDEZ', 'RODRÍGUEZ', 'LÓPEZ', 'MARTÍNEZ', 'GONZÁLEZ', 'PÉREZ', 'SÁNCHEZ', 'ROMERO', 'DÍAZ', 'ÁLVAREZ', 'TORRES', 'RUIZ', 'RAMÍREZ', 'FLORES', 'BENÍTEZ', 'ACOSTA', 'MEDINA', 'HERRERA', 'SUÁREZ']

/** «PÉREZ JUAN», como lo escriben las compañías. */
export function personaDe(semilla: string): string {
  return `${unoDe(`${semilla}:apellido`, APELLIDOS)} ${unoDe(`${semilla}:nombre`, NOMBRES).toUpperCase()}`
}

export interface VehiculoDeEjemplo {
  tipo: 'AUTO' | 'MOTO'
  marca: string
  modelo: string
  version: string
}

export const VEHICULOS_DE_EJEMPLO: readonly VehiculoDeEjemplo[] = [
  { tipo: 'AUTO', marca: 'VOLKSWAGEN', modelo: 'GOL TREND', version: '1.6 TRENDLINE 5P' },
  { tipo: 'AUTO', marca: 'VOLKSWAGEN', modelo: 'AMAROK', version: '2.0 TDI 4X2 HIGHLINE' },
  { tipo: 'AUTO', marca: 'TOYOTA', modelo: 'COROLLA', version: '1.8 XEI CVT' },
  { tipo: 'AUTO', marca: 'TOYOTA', modelo: 'HILUX', version: '2.8 DC 4X4 SRV' },
  { tipo: 'AUTO', marca: 'FIAT', modelo: 'CRONOS', version: '1.3 DRIVE GSE' },
  { tipo: 'AUTO', marca: 'PEUGEOT', modelo: '208', version: '1.6 ALLURE' },
  { tipo: 'AUTO', marca: 'CHEVROLET', modelo: 'ONIX', version: '1.2 LT' },
  { tipo: 'AUTO', marca: 'FORD', modelo: 'RANGER', version: '3.2 DC 4X4 XLT' },
  { tipo: 'AUTO', marca: 'RENAULT', modelo: 'SANDERO', version: '1.6 STEPWAY INTENS' },
  { tipo: 'AUTO', marca: 'FORD', modelo: 'FOCUS', version: '2.0 SE PLUS' },
  { tipo: 'MOTO', marca: 'HONDA', modelo: 'WAVE', version: '110 S' },
  { tipo: 'MOTO', marca: 'MOTOMEL', modelo: 'BLITZ', version: '110 V8 FULL' },
  { tipo: 'MOTO', marca: 'YAMAHA', modelo: 'FZ', version: 'FZ-S FI 150' },
  { tipo: 'MOTO', marca: 'CORVEN', modelo: 'ENERGY', version: '110' },
]

/** Una patente con el formato que corresponde al año: AB123CD desde 2016, ABC123 antes (motos: A123BCD / 123ABC). */
export function patenteDe(semilla: string, anio: number, tipo: 'AUTO' | 'MOTO' = 'AUTO'): string {
  const letra = (i: number) => String.fromCharCode(65 + enteroDe(`${semilla}:l${i}`, 0, 25))
  const numero = (i: number) => String(enteroDe(`${semilla}:n${i}`, 0, 9))
  if (tipo === 'MOTO') return anio >= 2016 ? `${letra(1)}${numero(1)}${numero(2)}${numero(3)}${letra(2)}${letra(3)}${letra(4)}` : `${numero(1)}${numero(2)}${numero(3)}${letra(1)}${letra(2)}${letra(3)}`
  return anio >= 2016 ? `${letra(1)}${letra(2)}${numero(1)}${numero(2)}${numero(3)}${letra(3)}${letra(4)}` : `${letra(1)}${letra(2)}${letra(3)}${numero(1)}${numero(2)}${numero(3)}`
}

export interface LocalidadDeEjemplo {
  localidad: string
  provincia: string
  /** El código de provincia como lo usa ATM en sus tablas. */
  codigoProvincia: string
}

const BUENOS_AIRES = { provincia: 'BUENOS AIRES', codigoProvincia: '1' }

function deBuenosAires(...localidades: string[]): LocalidadDeEjemplo[] {
  return localidades.map((localidad) => ({ localidad, ...BUENOS_AIRES }))
}

/** Los códigos postales que más se cotizan, con sus localidades. Lo que no está acá se arma por zona. */
const LOCALIDADES_POR_CP: Record<string, LocalidadDeEjemplo[]> = {
  '1870': deBuenosAires('AVELLANEDA', 'PIÑEYRO'),
  '1871': deBuenosAires('DOCK SUD'),
  '1872': deBuenosAires('SARANDI'),
  '1874': deBuenosAires('VILLA DOMINICO'),
  '1875': deBuenosAires('WILDE'),
  '1824': deBuenosAires('LANUS OESTE', 'LANUS ESTE'),
  '1828': deBuenosAires('BANFIELD'),
  '1832': deBuenosAires('LOMAS DE ZAMORA'),
  '1842': deBuenosAires('MONTE GRANDE', 'EL JAGUEL'),
  '1846': deBuenosAires('ADROGUE', 'JOSE MARMOL'),
  '1878': deBuenosAires('QUILMES', 'QUILMES OESTE'),
  '1884': deBuenosAires('BERAZATEGUI'),
  '1888': deBuenosAires('FLORENCIO VARELA'),
  '1900': deBuenosAires('LA PLATA'),
  '1636': deBuenosAires('OLIVOS', 'LA LUCILA'),
  '1642': deBuenosAires('SAN ISIDRO'),
  '1646': deBuenosAires('SAN FERNANDO'),
  '1648': deBuenosAires('TIGRE'),
  '1650': deBuenosAires('SAN MARTIN', 'VILLA BALLESTER'),
  '1629': deBuenosAires('PILAR'),
  '1663': deBuenosAires('SAN MIGUEL'),
  '1704': deBuenosAires('RAMOS MEJIA'),
  '1708': deBuenosAires('MORON'),
  '1712': deBuenosAires('CASTELAR'),
  '1714': deBuenosAires('ITUZAINGO'),
  '1744': deBuenosAires('MORENO'),
  '1754': deBuenosAires('SAN JUSTO'),
  '7600': deBuenosAires('MAR DEL PLATA'),
  '8000': deBuenosAires('BAHIA BLANCA'),
  '2000': [{ localidad: 'ROSARIO', provincia: 'SANTA FE', codigoProvincia: '12' }],
  '3000': [{ localidad: 'SANTA FE', provincia: 'SANTA FE', codigoProvincia: '12' }],
  '5000': [{ localidad: 'CORDOBA', provincia: 'CORDOBA', codigoProvincia: '3' }],
  '5500': [{ localidad: 'MENDOZA', provincia: 'MENDOZA', codigoProvincia: '7' }],
  '4000': [{ localidad: 'SAN MIGUEL DE TUCUMAN', provincia: 'TUCUMAN', codigoProvincia: '14' }],
}

const CAPITAL = { provincia: 'CAPITAL FEDERAL', codigoProvincia: '0' }

/** Las localidades de un código postal de cuatro números. Vacío si es uno que la demo no conoce. */
export function localidadesDeEjemplo(codigoPostal: string): LocalidadDeEjemplo[] {
  const conocidas = LOCALIDADES_POR_CP[codigoPostal]
  if (conocidas) return conocidas
  const numero = Number(codigoPostal)
  // En Capital cada código postal es un pedazo de la ciudad: las compañías lo listan por calle.
  if (numero >= 1000 && numero <= 1499) {
    return ['AV RIVADAVIA 4000-4999', 'AV CORRIENTES 3000-3999', 'AV SANTA FE 2000-2999'].map((localidad) => ({ localidad, ...CAPITAL }))
  }
  return []
}

/**
 * Cuánto pesa la zona en el precio: el robo y la siniestralidad del Gran Buenos Aires no son los de una
 * ciudad del interior. Es lo primero que cambia entre dos cotizaciones del mismo auto.
 */
export function factorDeZona(codigoPostal: string): number {
  const numero = Number(codigoPostal)
  if (numero >= 1000 && numero <= 1499) return 1.3
  if (numero >= 1600 && numero <= 1899) return 1.22
  if (numero >= 1900 && numero <= 1999) return 1.08
  if (numero >= 2000 && numero <= 2199) return 1.12
  if (numero >= 5000 && numero <= 5099) return 1.1
  if (numero === 4000 || numero === 5500 || numero === 7600) return 1.02
  return 0.86 + enteroDe(`zona:${codigoPostal}`, 0, 9) / 100
}
