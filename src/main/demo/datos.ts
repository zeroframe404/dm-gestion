// Los datos de la versión de demostración: el «GENERAL DE CLIENTES» de una agencia inventada, listo
// para cargarse en el VPS simulado (ver servidor.ts) y entrar por el camino de siempre: ingreso →
// sincronización → importación. El programa no sabe que es una demo.
//
// Es lo contrario de pruebas/hoja-de-prueba.ts. Aquélla junta a propósito todas las mañas de la hoja
// real para que el importador las aguante; ésta es limpia, abundante y verosímil, porque es lo primero
// que ve una agencia que mira el programa. Cada encabezado y cada valor está escrito con el vocabulario
// que el importador entiende (importacion/encabezados.ts, los `...DesdeTexto` de los estados, las
// fechas dd/mm/aaaa de la planilla y las ISO de las pestañas APP): un valor que no entiende se descarta
// o va al informe como «dato raro», y la demostración se vería rota.
//
// Todo es relativo a `hoy`: las planillas son las de los últimos diez meses hasta el mes en curso, hay
// cuotas que vencen hoy y esta semana, pólizas que se renuevan en los próximos días, la caja de los
// últimos días. Y es determinista: el mismo día da la misma grilla (salvo la hora de los comentarios de
// hoy). El azar sale de un generador con semilla fija (nada de Math.random ni del reloj), y cada decisión usa su propia semilla
// derivada de lo que decide, así los clientes son los mismos todos los días y sólo corren las fechas.
//
// No importa nada de Electron ni del disco: corre en el proceso principal y en las pruebas de Node.
import { createHash } from 'node:crypto'
import { USUARIOS_DE_LA_DEMO } from '../../shared/demo'
import type { Rama } from '../../shared/ramas'
import { esDebitoAutomatico } from '../../shared/semaforo'
import { claveDeSucursal, type NombreDeSucursal } from '../../shared/sucursales'
import { normalizarDocumento, normalizarNumeroPoliza, normalizarTexto } from '../importacion/normalizar'

export interface PestanaDeLaDemo {
  titulo: string
  valores: string[][]
}

export interface DatosDeLaDemo {
  /** Las pestañas de la grilla, en el orden en que van en la base (el importador deduce el año de las planillas mensuales por el orden). */
  pestanas: PestanaDeLaDemo[]
  /** El catálogo maestro de vehículos, en la forma que acepta `VpsSimulado.cargarVehiculos` (ver pruebas/catalogo-vehiculos.prueba.ts y src/main/servicios/catalogoVehiculos.ts para los campos). */
  vehiculos: Array<Record<string, unknown>>
}

/** Cuántas planillas mensuales tiene la grilla, contando la del mes en curso. */
export const MESES_DE_LA_DEMO = 10

// ---------------------------------------------------------------------------
// El azar con semilla
// ---------------------------------------------------------------------------

const SEMILLA = 0x5eed_2026

/** FNV-1a: de un texto a un número, para derivar una semilla por decisión. */
function hashDeTexto(texto: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 con una semilla derivada del nombre: la misma secuencia siempre para el mismo nombre. */
class Azar {
  private estado: number

  constructor(nombre: string) {
    this.estado = (hashDeTexto(nombre) ^ SEMILLA) >>> 0
  }

  num(): number {
    this.estado = (this.estado + 0x6d2b79f5) >>> 0
    let t = this.estado
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Entero entre `min` y `max`, los dos incluidos. */
  entero(min: number, max: number): number {
    return min + Math.floor(this.num() * (max - min + 1))
  }

  si(probabilidad: number): boolean {
    return this.num() < probabilidad
  }

  elegir<T>(lista: readonly T[]): T {
    return lista[Math.floor(this.num() * lista.length)]
  }

  pesado<T>(opciones: ReadonlyArray<readonly [T, number]>): T {
    const total = opciones.reduce((suma, [, peso]) => suma + peso, 0)
    let resto = this.num() * total
    for (const [valor, peso] of opciones) {
      resto -= peso
      if (resto < 0) return valor
    }
    return opciones[opciones.length - 1][0]
  }

  mezclar<T>(lista: readonly T[]): T[] {
    const copia = [...lista]
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(this.num() * (i + 1))
      ;[copia[i], copia[j]] = [copia[j], copia[i]]
    }
    return copia
  }
}

const ALFABETO_ID = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Los `_ID` de la grilla: 12 caracteres como los de `generarId`, pero derivados de qué fila son (la
 * cuota de tal póliza en tal mes), no del azar del sistema. Así la grilla del mismo día es idéntica y
 * el importador no tiene nada que escribir. Salen de un SHA-1 y no del generador de 32 bits: con unos
 * miles de filas por día, 32 bits ya chocan de vez en cuando. Un choque igual corta en seco.
 */
class Identificadores {
  private readonly usados = new Set<string>()

  de(...partes: Array<string | number>): string {
    const huella = createHash('sha1').update(`dm-demo|${partes.join('|')}`).digest()
    let id = ''
    for (let i = 0; i < 12; i++) id += ALFABETO_ID[huella[i] % ALFABETO_ID.length]
    if (this.usados.has(id)) throw new Error(`Identificador repetido en los datos de la demo: ${id} (${partes.join('|')})`)
    this.usados.add(id)
    return id
  }
}

// ---------------------------------------------------------------------------
// Fechas: días corridos desde 1970 (UTC), sin reloj ni zona horaria de por medio
// ---------------------------------------------------------------------------

const MS_POR_DIA = 86_400_000

function diaDe(anio: number, mes: number, dia: number): number {
  return Math.floor(Date.UTC(anio, mes - 1, dia) / MS_POR_DIA)
}

function partesDe(dia: number): { anio: number; mes: number; dia: number } {
  const fecha = new Date(dia * MS_POR_DIA)
  return { anio: fecha.getUTCFullYear(), mes: fecha.getUTCMonth() + 1, dia: fecha.getUTCDate() }
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/** 'AAAA-MM-DD', como escribe la aplicación en sus pestañas. */
function isoDe(dia: number): string {
  return new Date(dia * MS_POR_DIA).toISOString().slice(0, 10)
}

/** 'DD/MM/AAAA', como se escriben las fechas en la planilla de la agencia. */
function textoDe(dia: number): string {
  const p = partesDe(dia)
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.anio}`
}

/** El 1/1/1970 fue jueves. */
function esDomingo(dia: number): boolean {
  return (((dia + 4) % 7) + 7) % 7 === 0
}

function sumarMeses(dia: number, meses: number): number {
  const p = partesDe(dia)
  const total = p.anio * 12 + (p.mes - 1) + meses
  const anio = Math.floor(total / 12)
  const mes = (total % 12) + 1
  return diaDe(anio, mes, Math.min(p.dia, diasDelMes(anio, mes)))
}

/** Los meses se numeran corridos (año × 12 + mes − 1): restar dos da cuántos meses los separan. */
function indiceDeMes(anio: number, mes: number): number {
  return anio * 12 + mes - 1
}

function mesDelIndice(indice: number): { anio: number; mes: number } {
  return { anio: Math.floor(indice / 12), mes: (indice % 12) + 1 }
}

function indiceDelDia(dia: number): number {
  const p = partesDe(dia)
  return indiceDeMes(p.anio, p.mes)
}

function primerDiaDelMes(indice: number): number {
  const { anio, mes } = mesDelIndice(indice)
  return diaDe(anio, mes, 1)
}

function ultimoDiaDelMes(indice: number): number {
  const { anio, mes } = mesDelIndice(indice)
  return diaDe(anio, mes, diasDelMes(anio, mes))
}

/** El vencimiento de la cuota: el día pedido dentro del mes, o el último si el mes es más corto. */
function vencimientoEn(indice: number, diaDelMes: number): number {
  const { anio, mes } = mesDelIndice(indice)
  return diaDe(anio, mes, Math.min(diaDelMes, diasDelMes(anio, mes)))
}

/** Un día hábil para el mostrador: el domingo está cerrado y el cobro queda del sábado. */
function sinDomingo(dia: number): number {
  return esDomingo(dia) ? dia - 1 : dia
}

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

function nombreDelMes(indice: number): string {
  return MESES[mesDelIndice(indice).mes - 1]
}

/** 'AAAA-MM', como escribe la aplicación el MES de un aviso de rechazo. */
function periodoDe(indice: number): string {
  const { anio, mes } = mesDelIndice(indice)
  return `${anio}-${String(mes).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Números y documentos
// ---------------------------------------------------------------------------

function conPuntos(numero: number): string {
  return String(Math.round(numero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** «$ 45.300»: la forma en que la agencia escribe un importe. */
function pesos(numero: number): string {
  return `$ ${conPuntos(numero)}`
}

function redondear(numero: number, paso: number): number {
  return Math.max(paso, Math.round(numero / paso) * paso)
}

function digitoVerificador(once: string): number {
  const pesosDelCuit = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let suma = 0
  for (let i = 0; i < 10; i++) suma += Number(once[i]) * pesosDelCuit[i]
  const resto = 11 - (suma % 11)
  return resto === 11 ? 0 : resto
}

/** Un CUIT/CUIL válido: si el dígito da 10 se pasa al prefijo 23 (personas) o 33 (empresas), como hace la AFIP. */
function cuitDe(prefijo: '20' | '27' | '30', numero: number): string {
  const cuerpo = String(numero).padStart(8, '0')
  let pre: string = prefijo
  let dv = digitoVerificador(pre + cuerpo)
  if (dv === 10) {
    pre = prefijo === '30' ? '33' : '23'
    dv = digitoVerificador(pre + cuerpo)
    if (dv === 10) dv = prefijo === '27' ? 4 : 9
  }
  return `${pre}-${cuerpo}-${dv}`
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** «GONZALEZ MARIA LAURA» → «María Laura González»: como se tipea una consulta en el mostrador. */
function comoSeEscribe(texto: string): string {
  return texto
    .toLowerCase()
    .split(' ')
    // Las siglas societarias («S.A.», «S.R.L.») quedan en mayúscula.
    .map((palabra) => (palabra.includes('.') ? palabra.toUpperCase() : palabra ? palabra[0].toUpperCase() + palabra.slice(1) : palabra))
    .join(' ')
}

// ---------------------------------------------------------------------------
// Catálogos fijos de la agencia inventada
// ---------------------------------------------------------------------------

interface LocalidadDemo {
  nombre: string
  codigoPostal: string
}

interface SucursalDemo {
  nombre: NombreDeSucursal
  /** Como lo escribe la agencia en la columna LOCAL de la planilla. */
  enLaPlanilla: string
  peso: number
  localidades: LocalidadDemo[]
  /** Quiénes atienden ese mostrador (nombres de USUARIOS_DE_LA_DEMO). */
  usuarios: string[]
  productor: string
}

const L = (nombre: string, codigoPostal: string): LocalidadDemo => ({ nombre, codigoPostal })

function usuariosDe(sucursal: NombreDeSucursal): string[] {
  return USUARIOS_DE_LA_DEMO.filter((u) => u.sucursal === sucursal).map((u) => u.nombre)
}

const SUCURSALES_DEMO: SucursalDemo[] = [
  {
    nombre: 'Dock Sud',
    enLaPlanilla: 'DOCK SUD',
    peso: 34,
    localidades: [L('DOCK SUD', '1871'), L('AVELLANEDA', '1870'), L('WILDE', '1875'), L('VILLA DOMINICO', '1874')],
    usuarios: usuariosDe('Dock Sud'),
    productor: 'MARTINA DEMO',
  },
  {
    nombre: 'Lanús',
    enLaPlanilla: 'LANUS',
    peso: 30,
    localidades: [L('LANUS OESTE', '1824'), L('LANUS ESTE', '1824'), L('VALENTIN ALSINA', '1822'), L('REMEDIOS DE ESCALADA', '1826'), L('GERLI', '1869'), L('MONTE CHINGOLO', '1825')],
    usuarios: usuariosDe('Lanús'),
    productor: 'CARLOS FERREYRA',
  },
  {
    nombre: 'Sarandí',
    enLaPlanilla: 'SARANDI',
    peso: 21,
    localidades: [L('SARANDI', '1872'), L('VILLA DOMINICO', '1874'), L('WILDE', '1875'), L('AVELLANEDA', '1870')],
    usuarios: usuariosDe('Sarandí'),
    productor: 'LUCIA GOMEZ',
  },
  {
    nombre: 'Daniel',
    enLaPlanilla: 'DANIEL',
    peso: 15,
    localidades: [L('AVELLANEDA', '1870'), L('BERNAL', '1876'), L('QUILMES', '1878'), L('LANUS OESTE', '1824'), L('GERLI', '1869')],
    usuarios: usuariosDe('Daniel'),
    productor: 'DANIEL RUIZ',
  },
]

const CALLES = [
  'AV. MITRE', 'AV. BELGRANO', 'AV. PAVON', 'AV. HIPOLITO YRIGOYEN', 'AV. GALICIA', 'AMEGHINO', 'LAVALLE', 'SARMIENTO', 'ALSINA',
  'LAS FLORES', 'ITALIA', 'COLON', '9 DE JULIO', '25 DE MAYO', 'RIVADAVIA', 'GÜEMES', 'PASCO', 'OYUELA', 'MINISTRO BRIN',
  'DEBENEDETTI', 'ESTANISLAO DEL CAMPO', 'GRAL. PAZ', 'AV. ROSALES', 'AV. EVA PERON', 'MARGARITA WEILD', 'BUSTAMANTE', 'ITUZAINGO',
  'TUCUMAN', 'CNEL. LYNCH', 'RAMON FRANCO', 'AV. SAN MARTIN', 'MOLINEDO', 'CONESA', 'SITIO DE MONTEVIDEO', 'AV. 25 DE MAYO',
  'DONATO ALVAREZ', 'HUMBERTO PRIMO', 'CABRERA', 'CHILE', 'MEXICO', 'FLORIDA', 'ESPAÑA', 'MAZA', 'JUJUY', 'PIEDRAS',
]

const APELLIDOS = [
  'GONZALEZ', 'RODRIGUEZ', 'GOMEZ', 'FERNANDEZ', 'LOPEZ', 'DIAZ', 'MARTINEZ', 'PEREZ', 'GARCIA', 'SANCHEZ', 'ROMERO', 'SOSA',
  'ALVAREZ', 'TORRES', 'RAMIREZ', 'FLORES', 'ACOSTA', 'MEDINA', 'SUAREZ', 'HERRERA', 'AGUIRRE', 'PEREYRA', 'GUTIERREZ',
  'GIMENEZ', 'MOLINA', 'SILVA', 'CASTRO', 'ROJAS', 'ORTIZ', 'NUÑEZ', 'LUNA', 'JUAREZ', 'CABRERA', 'RIOS', 'GODOY', 'MORALES',
  'DOMINGUEZ', 'MOREIRA', 'QUIROGA', 'VERA', 'PERALTA', 'CARDOZO', 'PONCE', 'VEGA', 'CORREA', 'BRUNO', 'ROMANO', 'FERRARI',
  'RUSSO', 'COSTA', 'ESPOSITO', 'LOMBARDI', 'CAPUTO', 'GALLO', 'MARINO', 'RICCI', 'COLOMBO', 'VAZQUEZ', 'BLANCO', 'CASTILLO',
  'IBARRA', 'LEDESMA', 'VILLALBA', 'OJEDA', 'ARIAS', 'MANSILLA', 'PAEZ', 'CORONEL', 'FIGUEROA', 'MIRANDA', 'ZARATE', 'BARRIOS',
  'CAMPOS', 'SALAZAR', 'MAIDANA', 'OLIVERA', 'BUSTOS', 'CENTURION', 'ESCOBAR', 'FARIAS', 'ROLDAN', 'TOLEDO', 'AVILA', 'CHAVEZ',
  'LUCERO', 'FRANCO', 'IGLESIAS', 'VIDAL', 'SOTO', 'MENDEZ', 'ARGAÑARAZ', 'D\'ANGELO', 'DE LUCA', 'SPINELLI', 'GALEANO',
]

const NOMBRES_MASCULINOS = [
  'JUAN CARLOS', 'JORGE', 'CARLOS ALBERTO', 'LUIS', 'MIGUEL ANGEL', 'JOSE LUIS', 'RICARDO', 'ROBERTO', 'MARCELO', 'GUSTAVO',
  'SERGIO', 'DIEGO', 'PABLO', 'MARTIN', 'LUCAS', 'MATIAS', 'NICOLAS', 'FEDERICO', 'SEBASTIAN', 'GONZALO', 'MAXIMILIANO',
  'LEANDRO', 'CRISTIAN', 'HERNAN', 'FACUNDO', 'AGUSTIN', 'TOMAS', 'FRANCO', 'EZEQUIEL', 'RAMON', 'HECTOR', 'OSVALDO', 'ALEJANDRO',
  'FERNANDO', 'DARIO', 'EMILIANO', 'JULIAN', 'RODRIGO', 'WALTER', 'HUGO',
]

const NOMBRES_FEMENINOS = [
  'MARIA LAURA', 'SILVIA', 'GRACIELA', 'MONICA', 'PATRICIA', 'CLAUDIA', 'ANA MARIA', 'LAURA', 'ANDREA', 'VALERIA', 'CAROLINA',
  'NATALIA', 'ROMINA', 'FLORENCIA', 'CAMILA', 'SOFIA', 'MICAELA', 'AGUSTINA', 'LUCIANA', 'PAULA', 'GABRIELA', 'VANESA', 'LORENA',
  'MARIANA', 'VIRGINIA', 'NOELIA', 'BRENDA', 'MELINA', 'ROCIO', 'JULIETA', 'NORMA', 'SUSANA', 'BEATRIZ', 'ALEJANDRA', 'CECILIA',
  'VERONICA', 'DANIELA', 'MILAGROS', 'YAMILA', 'ESTEFANIA',
]

const RUBROS = ['TRANSPORTES', 'DISTRIBUIDORA', 'FERRETERIA', 'CONSTRUCCIONES', 'LOGISTICA', 'CORRALON', 'FLETES', 'MUDANZAS', 'AUTOPARTES', 'REFRIGERACION', 'PANIFICADORA', 'SERVICIOS ELECTRICOS']
const NOMBRES_DE_FANTASIA = ['DEL SUD', 'AVELLANEDA', 'LANUS', 'SARANDI', 'DOCK', 'RIACHUELO', 'WILDE', 'LA RIBERA', 'GERLI', 'ESCALADA', 'EL PUERTO', 'LOS ANDES', 'SAN JOSE', 'LA COSTA']
const TIPOS_SOCIETARIOS = ['S.R.L.', 'S.A.', 'SRL', 'S.A.S.']

const DOMINIOS_DE_MAIL = ['gmail.com', 'gmail.com', 'gmail.com', 'hotmail.com', 'hotmail.com', 'yahoo.com.ar', 'outlook.com', 'live.com.ar']

// --- Compañías ----------------------------------------------------------------

interface CompaniaDemo {
  nombre: string
  peso: number
  /** Cada cuántos meses renueva la póliza. Las de renovación manual son las de compañias.ts. */
  vigencias: number[]
  /** Cómo arma el número de póliza: prefijo y cantidad de dígitos. */
  prefijo: string
  digitos: number
  /** Cuánto más cara o más barata que el promedio. */
  factor: number
  /** Franquicia de su todo riesgo. */
  franquicia: number
}

const COMPANIAS: CompaniaDemo[] = [
  { nombre: 'SANCOR', peso: 14, vigencias: [6, 12], prefijo: '41', digitos: 6, factor: 1.06, franquicia: 480_000 },
  { nombre: 'ATM', peso: 12, vigencias: [6], prefijo: '7', digitos: 6, factor: 0.92, franquicia: 420_000 },
  { nombre: 'RIVADAVIA', peso: 12, vigencias: [6, 12], prefijo: '21-', digitos: 7, factor: 0.97, franquicia: 450_000 },
  { nombre: 'SAN CRISTOBAL', peso: 10, vigencias: [6, 12], prefijo: '01-', digitos: 8, factor: 1.04, franquicia: 500_000 },
  { nombre: 'FEDERACION PATRONAL', peso: 9, vigencias: [6, 12], prefijo: '12', digitos: 7, factor: 1.02, franquicia: 470_000 },
  { nombre: 'MERCANTIL ANDINA', peso: 8, vigencias: [6, 12], prefijo: '15-', digitos: 6, factor: 1.0, franquicia: 460_000 },
  { nombre: 'GALENO', peso: 8, vigencias: [6], prefijo: '9', digitos: 7, factor: 0.98, franquicia: 440_000 },
  { nombre: 'ZURICH', peso: 6, vigencias: [12], prefijo: '00', digitos: 8, factor: 1.12, franquicia: 550_000 },
  { nombre: 'EQUIDAD', peso: 7, vigencias: [6], prefijo: '3', digitos: 6, factor: 0.9, franquicia: 400_000 },
  { nombre: 'RIO URUGUAY', peso: 6, vigencias: [6], prefijo: '50', digitos: 6, factor: 0.93, franquicia: 410_000 },
  { nombre: 'AGROSALTA', peso: 5, vigencias: [4], prefijo: '8', digitos: 5, factor: 0.88, franquicia: 380_000 },
  { nombre: 'METROPOL', peso: 4, vigencias: [12], prefijo: '6', digitos: 6, factor: 0.91, franquicia: 390_000 },
]

/** Los nombres de las compañías de la cartera, como van en la planilla: el servidor de la demo les siembra la comisión. */
export const COMPANIAS_DE_LA_DEMO: readonly string[] = COMPANIAS.map((c) => c.nombre)

/** Las que la agencia renueva a mano (servicios/companias.ts): son las que llenan la bandeja de renovaciones. */
const COMPANIAS_DE_RENOVACION_MANUAL = ['AGROSALTA', 'RIO URUGUAY', 'METROPOL']

function compania(nombre: string): CompaniaDemo {
  const encontrada = COMPANIAS.find((c) => c.nombre === nombre)
  if (!encontrada) throw new Error(`Compañía desconocida en la demo: ${nombre}`)
  return encontrada
}

/** Qué compañías toman cada rama. */
const COMPANIAS_POR_RAMA: Record<Rama, string[]> = {
  AUTO: COMPANIAS.map((c) => c.nombre),
  'PICK UP': ['SANCOR', 'FEDERACION PATRONAL', 'RIVADAVIA', 'SAN CRISTOBAL', 'MERCANTIL ANDINA', 'ZURICH', 'ATM', 'GALENO', 'AGROSALTA'],
  CAMION: ['FEDERACION PATRONAL', 'SANCOR', 'RIVADAVIA', 'SAN CRISTOBAL'],
  MOTO: ['ATM', 'RIVADAVIA', 'RIO URUGUAY', 'EQUIDAD', 'SAN CRISTOBAL', 'GALENO', 'METROPOL', 'AGROSALTA'],
  SCOOTER: ['ATM', 'RIVADAVIA', 'RIO URUGUAY', 'EQUIDAD', 'SAN CRISTOBAL', 'METROPOL'],
  'MOTO ELÉCTRICA': ['ATM', 'RIVADAVIA', 'SAN CRISTOBAL', 'EQUIDAD'],
  TRAILER: ['FEDERACION PATRONAL', 'SANCOR', 'RIVADAVIA', 'ATM'],
}

// --- Coberturas ----------------------------------------------------------------

const RC = 'RC'
const TC = 'TERCEROS COMPLETO'
const TCP = 'TERCEROS COMPLETO PREMIUM'
const TR = 'TODO RIESGO C/FRANQUICIA'
const RC_ROBO = 'RC + ROBO TOTAL'

const DETALLE_DE_COBERTURA: Record<string, { incluye: string; detalle: string }> = {
  [RC]: { incluye: 'RESPONSABILIDAD CIVIL HASTA EL LIMITE LEGAL, ASISTENCIA MECANICA Y GRUA', detalle: 'COBERTURA MINIMA OBLIGATORIA' },
  [TC]: { incluye: 'RC + ROBO E INCENDIO TOTAL Y PARCIAL, DESTRUCCION TOTAL POR ACCIDENTE, CRISTALES', detalle: 'HASTA 20 AÑOS DE ANTIGUEDAD' },
  [TCP]: { incluye: 'TERCEROS COMPLETO + GRANIZO, CERRADURAS, RUEDAS Y CRISTALES SIN LIMITE', detalle: 'HASTA 15 AÑOS DE ANTIGUEDAD' },
  [TR]: { incluye: 'TERCEROS COMPLETO PREMIUM + DAÑOS PARCIALES POR ACCIDENTE', detalle: 'HASTA 10 AÑOS DE ANTIGUEDAD, CON INSPECCION PREVIA' },
  [RC_ROBO]: { incluye: 'RC + ROBO E INCENDIO TOTAL DE LA UNIDAD', detalle: 'MOTOS HASTA 10 AÑOS DE ANTIGUEDAD' },
}

// --- Vehículos ------------------------------------------------------------------

interface ModeloDemo {
  rama: Rama
  marca: string
  modelo: string
  versiones: string[]
  /** La carrocería como la trae el catálogo maestro (de ahí sale la categoría). */
  carroceria: string | null
  desde: number
  hasta: number
  /** Precio aproximado de un 0 km, en millones de pesos de hoy. */
  precio: number
  origen: 'NACIONAL' | 'IMPORTADO'
  peso: number
}

function M(
  rama: Rama,
  marca: string,
  modelo: string,
  versiones: string[],
  carroceria: string | null,
  desde: number,
  hasta: number,
  precio: number,
  origen: 'NACIONAL' | 'IMPORTADO',
  peso: number,
): ModeloDemo {
  return { rama, marca, modelo, versiones, carroceria, desde, hasta, precio, origen, peso }
}

const S5 = 'SEDAN 5 PUERTAS'
const S4 = 'SEDAN 4 PUERTAS'
const TT = 'TODO TERRENO'
const RU = 'RURAL 5 PUERTAS'
const PUD = 'PICK-UP CABINA DOBLE'
const PUS = 'PICK-UP CABINA SIMPLE'
const CH = 'CHASIS C/CABINA'
const MOT = 'MOTOCICLETA'
const SCO = 'SCOOTER'

const MODELOS: ModeloDemo[] = [
  // Autos
  M('AUTO', 'VOLKSWAGEN', 'GOL TREND', ['GOL TREND 1.6 TRENDLINE', 'GOL TREND 1.6 COMFORTLINE'], S5, 2009, 2023, 21, 'IMPORTADO', 8),
  M('AUTO', 'VOLKSWAGEN', 'VOYAGE', ['VOYAGE 1.6 TRENDLINE'], S4, 2009, 2023, 22, 'IMPORTADO', 3),
  M('AUTO', 'VOLKSWAGEN', 'POLO', ['POLO 1.6 MSI TRENDLINE', 'POLO 1.0 TSI HIGHLINE'], S5, 2018, 2026, 30, 'IMPORTADO', 4),
  M('AUTO', 'VOLKSWAGEN', 'VIRTUS', ['VIRTUS 1.6 MSI COMFORTLINE'], S4, 2018, 2026, 33, 'IMPORTADO', 2),
  M('AUTO', 'VOLKSWAGEN', 'T-CROSS', ['T-CROSS 1.6 MSI TRENDLINE', 'T-CROSS 1.4 TSI HIGHLINE'], TT, 2020, 2026, 38, 'IMPORTADO', 3),
  M('AUTO', 'VOLKSWAGEN', 'SURAN', ['SURAN 1.6 COMFORTLINE'], RU, 2010, 2019, 20, 'NACIONAL', 2),
  M('AUTO', 'FIAT', 'CRONOS', ['CRONOS 1.3 DRIVE', 'CRONOS 1.3 PRECISION CVT'], S4, 2018, 2026, 27, 'NACIONAL', 7),
  M('AUTO', 'FIAT', 'ARGO', ['ARGO 1.3 DRIVE'], S5, 2018, 2026, 25, 'IMPORTADO', 3),
  M('AUTO', 'FIAT', 'PALIO', ['PALIO 1.4 FIRE ATTRACTIVE'], S5, 2008, 2017, 18, 'IMPORTADO', 4),
  M('AUTO', 'FIAT', 'SIENA', ['SIENA 1.4 EL'], S4, 2008, 2017, 19, 'NACIONAL', 3),
  M('AUTO', 'FIAT', 'MOBI', ['MOBI 1.0 EASY'], S5, 2017, 2023, 19, 'IMPORTADO', 2),
  M('AUTO', 'FIAT', 'PULSE', ['PULSE 1.3 DRIVE', 'PULSE 1.0 T200 AUDACE'], TT, 2022, 2026, 32, 'IMPORTADO', 2),
  M('AUTO', 'CHEVROLET', 'ONIX', ['ONIX 1.4 LT', 'ONIX 1.2 LT'], S5, 2013, 2026, 26, 'IMPORTADO', 6),
  M('AUTO', 'CHEVROLET', 'PRISMA', ['PRISMA 1.4 LT'], S4, 2013, 2019, 22, 'IMPORTADO', 3),
  M('AUTO', 'CHEVROLET', 'CRUZE', ['CRUZE 1.4 T LT', 'CRUZE 1.4 T PREMIER'], S4, 2017, 2024, 36, 'NACIONAL', 2),
  M('AUTO', 'CHEVROLET', 'TRACKER', ['TRACKER 1.2 T LT'], TT, 2017, 2026, 38, 'IMPORTADO', 2),
  M('AUTO', 'CHEVROLET', 'CORSA CLASSIC', ['CORSA CLASSIC 1.4 LS'], S4, 2008, 2016, 16, 'NACIONAL', 4),
  M('AUTO', 'CHEVROLET', 'AGILE', ['AGILE 1.4 LT'], S5, 2010, 2016, 17, 'NACIONAL', 2),
  M('AUTO', 'FORD', 'KA', ['KA 1.5 S', 'KA 1.5 SEL'], S5, 2015, 2021, 20, 'IMPORTADO', 4),
  M('AUTO', 'FORD', 'FIESTA', ['FIESTA KINETIC 1.6 SE'], S5, 2011, 2019, 22, 'IMPORTADO', 3),
  M('AUTO', 'FORD', 'FOCUS', ['FOCUS 2.0 SE'], S5, 2013, 2019, 30, 'NACIONAL', 2),
  M('AUTO', 'FORD', 'ECOSPORT', ['ECOSPORT 1.6 SE', 'ECOSPORT 1.5 FREESTYLE'], TT, 2013, 2021, 30, 'IMPORTADO', 3),
  M('AUTO', 'RENAULT', 'SANDERO', ['SANDERO 1.6 LIFE', 'SANDERO 1.6 INTENS'], S5, 2012, 2026, 23, 'IMPORTADO', 5),
  M('AUTO', 'RENAULT', 'LOGAN', ['LOGAN 1.6 LIFE'], S4, 2014, 2026, 24, 'IMPORTADO', 3),
  M('AUTO', 'RENAULT', 'KWID', ['KWID 1.0 ZEN', 'KWID 1.0 OUTSIDER'], S5, 2018, 2026, 20, 'IMPORTADO', 3),
  M('AUTO', 'RENAULT', 'DUSTER', ['DUSTER 1.6 PH2 4X2 INTENS'], TT, 2012, 2026, 34, 'IMPORTADO', 3),
  M('AUTO', 'RENAULT', 'CLIO MIO', ['CLIO MIO 1.2 CONFORT'], S5, 2013, 2016, 15, 'NACIONAL', 2),
  M('AUTO', 'RENAULT', 'KANGOO', ['KANGOO 1.6 EXPRESSION 5 ASIENTOS'], RU, 2010, 2026, 28, 'NACIONAL', 3),
  M('AUTO', 'PEUGEOT', '208', ['208 1.6 ACTIVE', '208 1.6 ALLURE'], S5, 2017, 2026, 28, 'NACIONAL', 5),
  M('AUTO', 'PEUGEOT', '2008', ['2008 1.6 ALLURE'], TT, 2017, 2026, 35, 'IMPORTADO', 2),
  M('AUTO', 'PEUGEOT', '207 COMPACT', ['207 COMPACT 1.4 XS'], S5, 2008, 2016, 17, 'NACIONAL', 3),
  M('AUTO', 'PEUGEOT', '308', ['308 1.6 ALLURE'], S5, 2013, 2020, 28, 'NACIONAL', 2),
  M('AUTO', 'TOYOTA', 'ETIOS', ['ETIOS 1.5 XS', 'ETIOS 1.5 XLS'], S5, 2014, 2023, 22, 'IMPORTADO', 5),
  M('AUTO', 'TOYOTA', 'YARIS', ['YARIS 1.5 XLS CVT'], S5, 2018, 2026, 30, 'IMPORTADO', 3),
  M('AUTO', 'TOYOTA', 'COROLLA', ['COROLLA 2.0 XEI CVT', 'COROLLA 1.8 XLI'], S4, 2014, 2026, 40, 'IMPORTADO', 3),
  M('AUTO', 'TOYOTA', 'COROLLA CROSS', ['COROLLA CROSS 2.0 XEI CVT'], TT, 2021, 2026, 45, 'IMPORTADO', 2),
  M('AUTO', 'CITROEN', 'C3', ['C3 1.6 FEEL', 'C3 1.2 PURETECH SHINE'], S5, 2013, 2026, 24, 'IMPORTADO', 3),
  M('AUTO', 'CITROEN', 'C4 CACTUS', ['C4 CACTUS 1.6 FEEL'], TT, 2018, 2026, 32, 'IMPORTADO', 2),
  M('AUTO', 'NISSAN', 'VERSA', ['VERSA 1.6 SENSE', 'VERSA 1.6 ADVANCE CVT'], S4, 2020, 2026, 32, 'IMPORTADO', 2),
  M('AUTO', 'NISSAN', 'KICKS', ['KICKS 1.6 SENSE'], TT, 2017, 2026, 38, 'IMPORTADO', 2),
  M('AUTO', 'HONDA', 'FIT', ['FIT 1.5 LX'], S5, 2009, 2020, 26, 'IMPORTADO', 2),
  M('AUTO', 'HONDA', 'HR-V', ['HR-V 1.8 LX CVT'], TT, 2016, 2026, 42, 'IMPORTADO', 1),
  M('AUTO', 'JEEP', 'RENEGADE', ['RENEGADE 1.8 SPORT', 'RENEGADE 1.3 T270 LONGITUDE'], TT, 2016, 2026, 40, 'IMPORTADO', 2),
  // Pick ups
  M('PICK UP', 'TOYOTA', 'HILUX', ['HILUX 2.4 DX 4X2 D/C', 'HILUX 2.8 SRV 4X4 D/C AT'], PUD, 2016, 2026, 52, 'NACIONAL', 6),
  M('PICK UP', 'FORD', 'RANGER', ['RANGER 2.2 XL 4X2 D/C', 'RANGER 3.2 XLT 4X4 D/C'], PUD, 2013, 2026, 48, 'NACIONAL', 5),
  M('PICK UP', 'VOLKSWAGEN', 'AMAROK', ['AMAROK 2.0 TDI TRENDLINE 4X2 D/C', 'AMAROK 3.0 V6 HIGHLINE 4X4 D/C'], PUD, 2011, 2026, 50, 'NACIONAL', 4),
  M('PICK UP', 'CHEVROLET', 'S10', ['S10 2.8 LS 4X2 D/C'], PUD, 2012, 2026, 47, 'IMPORTADO', 3),
  M('PICK UP', 'FIAT', 'STRADA', ['STRADA 1.4 ENDURANCE C/S', 'STRADA 1.3 VOLCANO D/C'], PUS, 2014, 2026, 26, 'IMPORTADO', 4),
  M('PICK UP', 'FIAT', 'TORO', ['TORO 1.8 FREEDOM 4X2'], PUD, 2017, 2026, 38, 'IMPORTADO', 2),
  M('PICK UP', 'NISSAN', 'FRONTIER', ['FRONTIER 2.3 S 4X2 D/C'], PUD, 2016, 2026, 46, 'NACIONAL', 2),
  M('PICK UP', 'RENAULT', 'OROCH', ['OROCH 1.6 DYNAMIQUE'], PUD, 2016, 2026, 33, 'NACIONAL', 2),
  // Camiones
  M('CAMION', 'MERCEDES BENZ', 'ACCELO', ['ACCELO 815 CHASIS'], CH, 2012, 2024, 80, 'NACIONAL', 3),
  M('CAMION', 'IVECO', 'DAILY', ['DAILY 70C17 CHASIS'], CH, 2012, 2025, 70, 'IMPORTADO', 3),
  M('CAMION', 'FORD', 'CARGO', ['CARGO 1723 CHASIS'], CH, 2010, 2022, 95, 'NACIONAL', 2),
  M('CAMION', 'VOLKSWAGEN', 'DELIVERY', ['DELIVERY 9.170 CHASIS'], CH, 2013, 2025, 75, 'IMPORTADO', 2),
  // Motos
  M('MOTO', 'HONDA', 'WAVE', ['WAVE 110 S'], MOT, 2010, 2026, 2.2, 'NACIONAL', 8),
  M('MOTO', 'HONDA', 'CG 150', ['CG 150 TITAN'], MOT, 2010, 2026, 3.5, 'NACIONAL', 4),
  M('MOTO', 'HONDA', 'XR 150', ['XR 150 L'], MOT, 2015, 2026, 4.2, 'NACIONAL', 4),
  M('MOTO', 'HONDA', 'CB 190', ['CB 190 R'], MOT, 2016, 2026, 4.8, 'IMPORTADO', 3),
  M('MOTO', 'YAMAHA', 'YBR', ['YBR 125 ED'], MOT, 2008, 2026, 3.1, 'NACIONAL', 4),
  M('MOTO', 'YAMAHA', 'FZ', ['FZ-S 2.0 150', 'FZ 25'], MOT, 2014, 2026, 4.5, 'NACIONAL', 3),
  M('MOTO', 'YAMAHA', 'XTZ', ['XTZ 125'], MOT, 2010, 2026, 3.6, 'NACIONAL', 2),
  M('MOTO', 'MOTOMEL', 'BLITZ', ['BLITZ 110 V8 BASE'], MOT, 2010, 2026, 1.4, 'NACIONAL', 5),
  M('MOTO', 'MOTOMEL', 'SKUA', ['SKUA 150 V6'], MOT, 2012, 2026, 2.2, 'NACIONAL', 3),
  M('MOTO', 'CORVEN', 'ENERGY', ['ENERGY 110'], MOT, 2010, 2026, 1.3, 'NACIONAL', 3),
  M('MOTO', 'CORVEN', 'TRIAX', ['TRIAX 150 R3'], MOT, 2014, 2026, 2.3, 'NACIONAL', 2),
  M('MOTO', 'GILERA', 'SMASH', ['SMASH 110 VS'], MOT, 2008, 2026, 1.3, 'NACIONAL', 4),
  M('MOTO', 'ZANELLA', 'ZB', ['ZB 110 Z1'], MOT, 2010, 2026, 1.3, 'NACIONAL', 2),
  M('MOTO', 'BAJAJ', 'ROUSER', ['ROUSER NS 200', 'ROUSER NS 160'], MOT, 2016, 2026, 5.0, 'NACIONAL', 2),
  // Scooters
  M('SCOOTER', 'HONDA', 'ELITE', ['ELITE 125'], SCO, 2018, 2026, 3.3, 'IMPORTADO', 3),
  M('SCOOTER', 'YAMAHA', 'RAY', ['RAY ZR 125'], SCO, 2017, 2026, 3.0, 'IMPORTADO', 2),
  M('SCOOTER', 'ZANELLA', 'STYLER', ['STYLER 150 EXCLUSIVE'], SCO, 2013, 2026, 2.1, 'NACIONAL', 2),
  M('SCOOTER', 'MOTOMEL', 'STRATO', ['STRATO 150 ALPINO'], SCO, 2013, 2026, 2.0, 'NACIONAL', 2),
  // Motos eléctricas
  M('MOTO ELÉCTRICA', 'SUNRA', 'LEO', ['LEO ELECTRICA 1200W'], MOT, 2019, 2026, 2.6, 'IMPORTADO', 3),
  M('MOTO ELÉCTRICA', 'SUNRA', 'HAWK', ['HAWK ELECTRICA 1500W'], MOT, 2020, 2026, 3.2, 'IMPORTADO', 2),
  M('MOTO ELÉCTRICA', 'SUPER SOCO', 'CPX', ['CPX ELECTRICA 4000W'], MOT, 2021, 2026, 6.5, 'IMPORTADO', 2),
  // Trailers: no están en el catálogo maestro (que es de autos y motos), como en la agencia.
  M('TRAILER', 'MONTENEGRO', 'NAUTICO', ['TRAILER NAUTICO 1 EJE'], null, 2008, 2026, 4.5, 'NACIONAL', 3),
  M('TRAILER', 'TRAILERS DEL SUR', 'PLAYO', ['PLAYO 2 EJES 1500 KG'], null, 2010, 2026, 6.0, 'NACIONAL', 2),
]

/** Cuántas pólizas de cada rama: fijo, así las siete ramas tienen siempre con qué mostrarse. */
const POLIZAS_POR_RAMA: Array<[Rama, number]> = [
  ['AUTO', 198],
  ['MOTO', 58],
  ['PICK UP', 34],
  ['CAMION', 11],
  ['SCOOTER', 17],
  ['MOTO ELÉCTRICA', 12],
  ['TRAILER', 15],
]

const COLORES = ['BLANCO', 'BLANCO', 'GRIS PLATA', 'GRIS PLATA', 'NEGRO', 'ROJO', 'AZUL', 'GRIS OSCURO', 'BORDO', 'VERDE']

/** El fabricante del chasis (primeras tres letras del VIN). */
const WMI: Record<string, string> = {
  VOLKSWAGEN: '9BW', FIAT: '8AP', CHEVROLET: '8AG', FORD: '8AF', RENAULT: '93Y', PEUGEOT: '8AD', TOYOTA: '8AJ', CITROEN: '935',
  NISSAN: '3N1', HONDA: '93H', JEEP: '988', 'MERCEDES BENZ': '8AC', IVECO: '93Z',
}

const ALFANUMERICO_VIN = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'

const FORMAS_DE_PAGO: Array<[string, number]> = [
  ['EFECTIVO', 30],
  ['TARJETA', 17],
  ['CBU', 15],
  ['TRANSFERENCIA', 14],
  ['MERCADO PAGO', 10],
  ['CUPONERA', 8],
  ['LOCAL', 6],
]

/** Las formas de pago que se cobran en el mostrador (con cobrador y ticket); el resto, débito o cuponera, entra igual a APP PAGOS pero sin eso. */
const COBRADAS_EN_EL_MOSTRADOR = new Set(['EFECTIVO', 'LOCAL', 'TRANSFERENCIA', 'MERCADO PAGO'])

/** Cuántos meses de cuotas pagadas (contando el actual) viajan por APP PAGOS: el historial de la ficha y de las comisiones. */
const MESES_DE_PAGOS = 6

const OBSERVACIONES_DE_POLIZA = [
  'TIENE GNC',
  'CLIENTE DE HACE AÑOS, BUEN PAGADOR',
  'AVISAR POR WHATSAPP, NO ATIENDE LLAMADAS',
  'PIDE COTIZAR TODO RIESGO',
  'INSPECCION HECHA',
  'ACREEDOR PRENDARIO: BANCO PROVINCIA',
  'USO PARTICULAR Y LABORAL',
  'TIENE OTRO AUTO EN OTRA COMPAÑIA, OFRECER',
  'CAMBIO DE DOMICILIO PENDIENTE DE ENDOSO',
  'PIDE QUE LE MANDEN LA POLIZA POR MAIL',
]

const MOTIVOS_DE_BAJA_DEMO: Array<[string, number, string]> = [
  ['VENDIO', 30, 'VENDIO EL VEHICULO'],
  ['ANULA POR FALTA DE PAGO', 24, 'DEBIA 3 CUOTAS, NO CONTESTA'],
  ['ANULA POR DECISION DEL CLIENTE', 14, 'DICE QUE NO LE ALCANZA'],
  ['CAMBIO DE COMPANIA', 16, 'SE PASO A UNA COMPAÑIA MAS BARATA'],
  ['VOLVIO CON OTRO VEHICULO', 6, 'VA A TRAER EL AUTO NUEVO'],
  ['OTRO', 10, 'SE MUDO AL INTERIOR'],
]

// ---------------------------------------------------------------------------
// Los modelos de la demo
// ---------------------------------------------------------------------------

interface Cliente {
  indice: number
  /** «APELLIDO NOMBRE», como lo escribe la agencia. */
  nombre: string
  esEmpresa: boolean
  documento: string
  clave: string
  telefono: string
  email: string
  direccion: string
  localidad: LocalidadDemo
  sucursal: SucursalDemo
  nacimiento: string
}

interface Poliza {
  indice: number
  cliente: Cliente
  rama: Rama
  modelo: ModeloDemo
  version: string
  anio: number
  patente: string
  motor: string
  chasis: string
  color: string
  uso: string
  sumaAsegurada: number
  compania: CompaniaDemo
  numero: string
  cobertura: string
  cuotaBase: number
  formaPago: string
  automatica: boolean
  diaDeVencimiento: number
  vigenciaMeses: number
  alta: number
  altaMes: number
  bajaMes: number | null
  bajaDia: number | null
  motivoBaja: [string, number, string] | null
  /** Desde qué mes no paga (índice de mes), o null si está al día. */
  deudaDesde: number | null
  /** La cuota del mes en curso está IMPUTADA: la agencia la pagó y falta cobrarle al cliente. */
  imputada: boolean
  /** El mes en que le rebotó el débito, o null. */
  rechazoMes: number | null
  /** Vence hoy y no pagó: para que el contador «vencen hoy» tenga qué mostrar. */
  venceHoy: boolean
  /** La vigencia ya terminó y la renovación (manual) está pendiente. */
  renovacionPendiente: boolean
  noAvisar: boolean
  observaciones: string
}

interface Pago {
  dia: number
  /** El cobro pasó por el mostrador (va a APP PAGOS) y no por débito o cuponera. */
  enElMostrador: boolean
}

interface Fila {
  [encabezado: string]: string
}

function armar(encabezados: readonly string[], filas: Fila[]): string[][] {
  return [[...encabezados], ...filas.map((fila) => encabezados.map((encabezado) => fila[encabezado] ?? ''))]
}

// --- Encabezados ------------------------------------------------------------------

const ENC_MENSUAL = [
  'APELLIDO Y NOMBRE', 'DNI', 'TELEFONO', 'EMAIL', 'DOMICILIO', 'LOCALIDAD', 'LOCAL', 'FECHA DE NACIMIENTO', 'COMPAÑIA', 'N° POLIZA',
  'COBERTURA', 'PRIMA', 'FORMA DE PAGO', 'PRODUCTOR', 'ESTADO', 'VIGENCIA DESDE', 'VIGENCIA HASTA', 'ALTA', 'TIPO', 'MARCA', 'MODELO',
  'AÑO', 'PATENTE', 'MOTOR', 'CHASIS', 'USO', 'COLOR', 'SUMA ASEGURADA', 'CUOTA', 'DIA DE VTO', 'AVISO', 'FECHA DE ENVIO',
  'AVISAR VTO', 'PAGO', 'OBS PAGO', 'OBSERVACIONES', '_ID',
]
const ENC_BAJAS = ['APELLIDO Y NOMBRE', 'DNI', 'TELEFONO', 'LOCAL', 'CIA', 'N° POLIZA', 'COBERTURA', 'PATENTE', 'MARCA', 'MODELO', 'CUOTA', 'MOTIVO', 'MES', 'FECHA DE BAJA', 'OBSERVACIONES', '_ID']
const ENC_AMP = ['LOCAL', 'FECHA', 'APELLIDO Y NOMBRE', 'DNI', 'TELEFONO', 'FORMA DE PAGO', 'PATENTE', 'MARCA', 'MODELO', 'CIA', 'N° POLIZA', 'AMPLIACION', 'FECHA DE VTO', 'OBSERVACIONES', 'RESUELTO', '_ID']
const ENC_RIESGOS = [
  'APELLIDO Y NOMBRE', 'DNI', 'TELEFONO', 'EMAIL', 'DOMICILIO', 'LOCALIDAD', 'LOCAL', 'FECHA', 'RIESGO', 'DETALLE', 'CIA', 'N° POLIZA',
  'PRIMA', 'CUOTA', 'VIGENCIA DESDE', 'VIGENCIA HASTA', 'FORMA DE PAGO', 'VTO', 'AVISO', 'PAGO', 'PRODUCTOR', 'ESTADO', 'OBSERVACIONES', '_ID',
]
const ENC_SINIESTROS = [
  'LOCAL', 'FECHA DE CARGA', 'FECHA', 'APELLIDO Y NOMBRE', 'DNI', 'TELEFONO', 'PATENTE', 'MARCA', 'MODELO', 'CIA', 'N° POLIZA', 'COBERTURA',
  'N° SINIESTRO', 'DESCRIPCION', 'ESTADO', 'IMPORTE', 'ABOGADO', 'CIA DEL TERCERO', 'TEL DEL TERCERO', 'PATENTE DEL TERCERO', 'LESIONADOS',
  'DETALLE DE LESIONADOS', 'OBSERVACIONES', '_ID',
]
const ENC_COBERTURA = ['CIA', 'COBERTURA', 'INCLUYE', 'FRANQUICIA', 'DETALLE', '_ID']

// Las pestañas que escribe la aplicación, con los encabezados de `PESTANAS_DE_LA_APP`
// (sincronizacion/pestanasApp.ts). Van copiados y no importados porque aquel archivo arrastra la cola de
// la sincronización; la prueba (pruebas/demo-datos.prueba.ts) verifica que sigan siendo los mismos.
const ENC_APP_LEADS = ['FECHA', 'LOCAL', 'NOMBRE', 'TELEFONO', 'DNI/CUIT', 'ORIGEN', 'QUE ASEGURA', 'TIPO', 'ESTADO', 'NOTAS', 'CARGADO POR', '_ID']
const ENC_APP_PRESUPUESTOS = [
  'FECHA', 'NUMERO', 'VERSION', 'LOCAL', 'NOMBRE', 'TELEFONO', 'DNI/CUIT', 'PATENTE', 'MARCA', 'MODELO', 'AÑO', 'OPCIONES', 'PRECIO DESDE',
  'ESTADO', 'OBSERVACIONES', 'CARGADO POR', 'VINCULO ID', 'OPCIONES JSON', '_ID',
]
const ENC_APP_TAREAS = ['FECHA', 'TITULO', 'DESCRIPCION', 'ASIGNADO A', 'LOCAL', 'VENCE', 'PRIORIDAD', 'ESTADO', 'VINCULO', 'CREADO POR', 'VINCULO ID', '_ID']
const ENC_APP_RECHAZOS = [
  'FECHA', 'LOCAL', 'NOMBRE', 'DNI/CUIT', 'TELEFONO', 'COMPAÑIA', 'POLIZA', 'PATENTE', 'FORMA DE PAGO', 'CUOTA', 'MES', 'MOTIVO',
  'OBSERVACIONES', 'ESTADO', 'CARGADO POR', '_ID',
]
const ENC_APP_PAGOS = [
  'FECHA', 'LOCAL', 'NOMBRE', 'DNI/CUIT', 'COMPAÑIA', 'POLIZA', 'PATENTE', 'IMPORTE', 'MEDIO DE PAGO', 'MES', 'OBSERVACIONES', 'RESULTADO',
  'COBRADO POR', 'COBRO', 'NRO TICKET', 'REVISIÓN DE PAGO', '_ID',
]
const ENC_APP_CAJA = ['FECHA', 'LOCAL', 'TIPO', 'DETALLE', 'IMPORTE', 'CARGADO POR', '_ID']
const ENC_APP_COMENTARIOS = ['FECHA', 'TIPO', 'VINCULO', 'USUARIO', 'TEXTO', '_ID']
const ENC_APP_CLIENTES = ['NOMBRE', 'DNI/CUIT', 'TELEFONO', 'EMAIL', 'DIRECCION', 'LOCALIDAD', 'PROVINCIA', 'CODIGO POSTAL', 'LOCAL', 'FECHA DE NACIMIENTO', '_ID']

/** Los encabezados de las pestañas APP de la demo, por título (los usa la prueba). */
export const ENCABEZADOS_APP_DE_LA_DEMO: Record<string, readonly string[]> = {
  'APP LEADS': ENC_APP_LEADS,
  'APP PRESUPUESTOS': ENC_APP_PRESUPUESTOS,
  'APP TAREAS': ENC_APP_TAREAS,
  'APP RECHAZOS': ENC_APP_RECHAZOS,
  'APP PAGOS': ENC_APP_PAGOS,
  'APP CAJA': ENC_APP_CAJA,
  'APP COMENTARIOS': ENC_APP_COMENTARIOS,
  'APP CLIENTES': ENC_APP_CLIENTES,
}

// ---------------------------------------------------------------------------
// El generador
// ---------------------------------------------------------------------------

class GeneradorDeLaDemo {
  private readonly ids = new Identificadores()
  private readonly hoy: number
  private readonly hoyPartes: { anio: number; mes: number; dia: number }
  private readonly mesActual: number
  private readonly primerMes: number

  private readonly nombresUsados = new Set<string>()
  private readonly documentosUsados = new Set<string>()
  private readonly patentesUsadas = new Set<string>()
  private readonly numerosUsados = new Set<string>()

  private clientes: Cliente[] = []
  private polizas: Poliza[] = []
  /** El _ID de la fila de cada póliza en cada mes. */
  private readonly idDeCuota = new Map<string, string>()
  /** El pago de cada cuota pagada, por póliza y mes. */
  private readonly pagos = new Map<string, Pago>()

  // Lo que unas pestañas le pasan a las otras.
  private leads: Array<{ id: string; nombre: string; telefono: string; documento: string; sucursal: SucursalDemo; dia: number; estado: string; tipo: string; marca: string; modelo: string; anio: number; usuario: string; notas: string[] }> = []
  private presupuestos: Array<{ id: string; numero: string; nombre: string; sucursal: SucursalDemo; dia: number; estado: string; usuario: string }> = []
  private siniestros: Array<{
    id: string
    poliza: Poliza
    numero: string
    estado: string
    dia: number
    /** El día en que se cargó la denuncia: ahí arranca la línea de tiempo. */
    carga: number
    observacion: string
    /** Qué pasó: un robo, un reclamo de un tercero (la RC no cubre el daño propio) o un daño del propio vehículo. */
    tipo: 'ROBO' | 'TERCERO' | 'PROPIO'
    conTercero: boolean
  }> = []
  private comentarios: Fila[] = []
  /** El instante en que se arma la demo (ms), y la medianoche local de ese día: los comentarios de hoy se miden contra esto. */
  private readonly ahora: number
  private readonly inicioDelDia: number
  /** El `_ID` del siniestro de la Hilux de Sarandí (ver `siniestroDeLaHilux`), o null si no se armó. */
  private idDeLaHilux: string | null = null
  private filasDePagos: Array<{ fila: Fila; dia: number; sucursal: SucursalDemo; medio: string; importe: number; imputado: boolean }> = []
  private clientesSoloRiesgo: Cliente[] = []

  constructor(hoy: Date) {
    this.ahora = hoy.getTime()
    this.inicioDelDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()
    this.hoy = diaDe(hoy.getFullYear(), hoy.getMonth() + 1, hoy.getDate())
    this.hoyPartes = partesDe(this.hoy)
    this.mesActual = indiceDeMes(this.hoyPartes.anio, this.hoyPartes.mes)
    this.primerMes = this.mesActual - (MESES_DE_LA_DEMO - 1)
  }

  armar(): DatosDeLaDemo {
    this.armarCartera()
    const pestanas: PestanaDeLaDemo[] = []
    for (let mes = this.primerMes; mes <= this.mesActual; mes++) {
      pestanas.push({ titulo: this.tituloDelMes(mes), valores: this.planillaDelMes(mes) })
      const bajas = this.bajasDelMes(mes)
      if (bajas) pestanas.push(bajas)
    }
    // Primero las que REFERENCIAN a otras: los siniestros y los leads tienen que existir para que las
    // tareas, los presupuestos y los comentarios los nombren. El orden de las pestañas es otro (abajo).
    const amp = this.pestanaAmp()
    const riesgos = this.pestanaRiesgos()
    const siniestros = this.pestanaSiniestros()
    const cobertura = this.pestanaCobertura()
    const leads = this.pestanaLeads()
    const presupuestos = this.pestanaPresupuestos()
    const rechazos = this.pestanaRechazos()
    const tareas = this.pestanaTareas()
    const pagos = this.pestanaPagos()
    const caja = this.pestanaCaja()
    const clientes = this.pestanaClientes()
    const comentarios = { titulo: 'APP COMENTARIOS', valores: armar(ENC_APP_COMENTARIOS, this.comentarios) }

    // Las de la agencia después de las planillas, y las de la aplicación al final, en el orden de
    // PESTANAS_DE_LA_APP (así las crea el programa: nunca en el medio).
    pestanas.push(amp, riesgos, siniestros, cobertura, leads, presupuestos, tareas, rechazos, pagos, caja, comentarios, clientes)
    return { pestanas, vehiculos: this.catalogoDeVehiculos() }
  }

  // -------------------------------------------------------------------------
  // Títulos
  // -------------------------------------------------------------------------

  /**
   * «OCTUBRE» para los meses de este año y «DICIEMBRE25» para los del año pasado, como titula la
   * agencia. El importador ancla el año en la primera que lo dice y deduce el resto por el orden.
   */
  private tituloDelMes(indice: number): string {
    const { anio } = mesDelIndice(indice)
    return nombreDelMes(indice) + (anio < this.hoyPartes.anio ? String(anio).slice(2) : '')
  }

  // -------------------------------------------------------------------------
  // Clientes y pólizas
  // -------------------------------------------------------------------------

  private nuevoNombreDePersona(azar: Azar): { nombre: string; femenino: boolean; apellido: string; nombres: string } {
    for (;;) {
      const femenino = azar.si(0.48)
      const apellido = azar.elegir(APELLIDOS)
      const nombres = azar.elegir(femenino ? NOMBRES_FEMENINOS : NOMBRES_MASCULINOS)
      const nombre = `${apellido} ${nombres}`
      if (this.nombresUsados.has(nombre)) continue
      this.nombresUsados.add(nombre)
      return { nombre, femenino, apellido, nombres }
    }
  }

  private nuevoNombreDeEmpresa(azar: Azar): string {
    for (;;) {
      const nombre = `${azar.elegir(RUBROS)} ${azar.elegir(NOMBRES_DE_FANTASIA)} ${azar.elegir(TIPOS_SOCIETARIOS)}`
      if (this.nombresUsados.has(nombre)) continue
      this.nombresUsados.add(nombre)
      return nombre
    }
  }

  /** Un DNI que corresponda a la edad: los de los setenta andan por los 10 millones, los del 2000 por los 42. */
  private nuevoDni(azar: Azar, anioDeNacimiento: number): number {
    for (;;) {
      const base =
        anioDeNacimiento < 1960
          ? 4_000_000 + (anioDeNacimiento - 1940) * 300_000
          : anioDeNacimiento < 2000
            ? 10_500_000 + (anioDeNacimiento - 1960) * 760_000
            : 41_000_000 + (anioDeNacimiento - 2000) * 900_000
      const dni = base + azar.entero(0, 650_000)
      const clave = String(dni)
      if (this.documentosUsados.has(clave)) continue
      this.documentosUsados.add(clave)
      return dni
    }
  }

  private telefono(azar: Azar): string {
    return `11-${azar.entero(2, 6)}${azar.entero(100, 999)}-${azar.entero(1000, 9999)}`
  }

  private nuevoCliente(azar: Azar, indice: number, esEmpresa: boolean): Cliente {
    const sucursal = azar.pesado(SUCURSALES_DEMO.map((s) => [s, s.peso] as const))
    const localidad = azar.elegir(sucursal.localidades)
    const direccion = `${azar.elegir(CALLES)} ${azar.entero(100, 4800)}${azar.si(0.12) ? ` DTO ${azar.entero(1, 8)}${azar.elegir(['A', 'B', 'C'])}` : ''}`
    if (esEmpresa) {
      const nombre = this.nuevoNombreDeEmpresa(azar)
      let documento = ''
      for (;;) {
        documento = cuitDe('30', azar.entero(70_000_000, 71_999_999))
        if (!this.documentosUsados.has(normalizarDocumento(documento))) break
      }
      this.documentosUsados.add(normalizarDocumento(documento))
      const palabras = nombre.split(' ').filter((palabra) => !TIPOS_SOCIETARIOS.includes(palabra))
      const usuarioMail = sinTildes(palabras.join('')).toLowerCase().replace(/[^a-z]/g, '')
      return {
        indice,
        nombre,
        esEmpresa: true,
        documento,
        clave: normalizarDocumento(documento),
        telefono: `11-4${azar.entero(200, 399)}-${azar.entero(1000, 9999)}`,
        email: `administracion@${usuarioMail}.com.ar`,
        direccion,
        localidad,
        sucursal,
        nacimiento: '',
      }
    }
    const persona = this.nuevoNombreDePersona(azar)
    const edad = azar.pesado<[number, number]>([
      [[19, 29], 22],
      [[30, 44], 34],
      [[45, 59], 28],
      [[60, 78], 16],
    ])
    const anioDeNacimiento = this.hoyPartes.anio - azar.entero(edad[0], edad[1])
    const nacimiento = diaDe(anioDeNacimiento, azar.entero(1, 12), azar.entero(1, 28))
    const dni = this.nuevoDni(azar, anioDeNacimiento)
    // Uno de cada siete trae el CUIT/CUIL entero (monotributistas): el importador lo reduce al mismo DNI.
    const documento = azar.si(0.14) ? cuitDe(persona.femenino ? '27' : '20', dni) : conPuntos(dni)
    const nombreMail = sinTildes(persona.nombres.split(' ')[0]).toLowerCase()
    const apellidoMail = sinTildes(persona.apellido).toLowerCase().replace(/[^a-z]/g, '')
    const email = azar.si(0.78)
      ? `${azar.si(0.5) ? `${nombreMail}.${apellidoMail}` : `${apellidoMail}${nombreMail[0]}`}${azar.si(0.45) ? azar.entero(1, 99) : ''}@${azar.elegir(DOMINIOS_DE_MAIL)}`
      : ''
    return {
      indice,
      nombre: persona.nombre,
      esEmpresa: false,
      documento,
      clave: String(dni),
      telefono: this.telefono(azar),
      email,
      direccion,
      localidad,
      sucursal,
      nacimiento: textoDe(nacimiento),
    }
  }

  private nuevaPatente(azar: Azar, rama: Rama, anio: number): string {
    const letra = () => String.fromCharCode(65 + azar.entero(0, 25))
    const digitos = (n: number) => Array.from({ length: n }, () => String(azar.entero(0, 9))).join('')
    const esMoto = rama === 'MOTO' || rama === 'SCOOTER' || rama === 'MOTO ELÉCTRICA'
    for (;;) {
      let patente: string
      if (anio >= 2016) {
        // Mercosur: AB123CD en autos (la segunda letra avanza con los años) y A123BCD en motos.
        const serie = String.fromCharCode(65 + Math.min(25, Math.max(0, anio - 2016 + azar.entero(0, 1))))
        patente = esMoto ? `A${digitos(3)}${serie}${letra()}${letra()}` : `A${serie}${digitos(3)}${letra()}${letra()}`
      } else if (esMoto) {
        patente = `${digitos(3)}${String.fromCharCode(65 + Math.min(25, Math.max(0, anio - 1995)))}${letra()}${letra()}`
      } else {
        // La serie vieja arrancó en AAA000 en 1995 y llegó a la P en 2016.
        const primera = String.fromCharCode(65 + Math.min(15, Math.max(0, Math.floor((anio - 1995) * 0.75))))
        patente = `${primera}${letra()}${letra()}${digitos(3)}`
      }
      if (this.patentesUsadas.has(patente)) continue
      this.patentesUsadas.add(patente)
      return patente
    }
  }

  private nuevoNumeroDePoliza(azar: Azar, cia: CompaniaDemo): string {
    for (;;) {
      const digitos = Array.from({ length: cia.digitos }, (_, i) => String(i === 0 ? azar.entero(1, 9) : azar.entero(0, 9))).join('')
      const numero = `${cia.prefijo}${digitos}`
      const clave = normalizarNumeroPoliza(numero)
      if (this.numerosUsados.has(clave)) continue
      this.numerosUsados.add(clave)
      return numero
    }
  }

  private coberturaPara(azar: Azar, rama: Rama, antiguedad: number): string {
    switch (rama) {
      case 'AUTO':
      case 'PICK UP':
        if (antiguedad <= 5) return azar.pesado([[TR, 35], [TCP, 35], [TC, 25], [RC, 5]])
        if (antiguedad <= 12) return azar.pesado([[TCP, 25], [TC, 50], [RC, 25]])
        return azar.pesado([[TC, 40], [RC, 60]])
      case 'CAMION':
        return azar.pesado([[TC, 50], [RC, 50]])
      case 'TRAILER':
        return RC
      default:
        return antiguedad <= 5 ? azar.pesado([[RC_ROBO, 55], [RC, 45]]) : azar.pesado([[RC_ROBO, 20], [RC, 80]])
    }
  }

  /** La cuota mensual de hoy, en pesos de hoy. */
  private cuotaPara(azar: Azar, rama: Rama, cobertura: string, suma: number, cia: CompaniaDemo): number {
    const esMoto = rama === 'MOTO' || rama === 'SCOOTER' || rama === 'MOTO ELÉCTRICA'
    let monto: number
    if (cobertura === RC) {
      monto =
        rama === 'CAMION'
          ? azar.entero(72, 96) * 1000
          : rama === 'PICK UP'
            ? azar.entero(34, 44) * 1000
            : rama === 'TRAILER'
              ? azar.entero(8, 12) * 1000
              : esMoto
                ? azar.entero(11, 17) * 1000
                : azar.entero(26, 36) * 1000
    } else if (cobertura === RC_ROBO) {
      monto = suma * 0.006 + 9_000
    } else if (cobertura === TR) {
      monto = suma * 0.0055 + 20_000
    } else {
      monto = rama === 'CAMION' ? suma * 0.002 + 60_000 : suma * 0.0024 + 18_000
      if (cobertura === TCP) monto *= 1.25
    }
    return redondear(monto * cia.factor * (0.95 + azar.num() * 0.1), 100)
  }

  private armarCartera(): void {
    const azarRamas = new Azar('ramas')
    const ramas = azarRamas.mezclar(POLIZAS_POR_RAMA.flatMap(([rama, cantidad]) => Array.from({ length: cantidad }, () => rama)))
    const anioActual = this.hoyPartes.anio

    ramas.forEach((rama, indice) => {
      const azar = new Azar(`poliza|${indice}`)
      const esEmpresa =
        rama === 'CAMION' || (rama === 'PICK UP' && azar.si(0.25)) || (rama === 'TRAILER' && azar.si(0.2)) || (rama === 'AUTO' && azar.si(0.02))
      const cliente = this.nuevoCliente(azar, indice, esEmpresa)
      this.clientes.push(cliente)

      const modelo = azar.pesado(MODELOS.filter((m) => m.rama === rama).map((m) => [m, m.peso] as const))
      const version = azar.elegir(modelo.versiones)
      const desde = Math.max(modelo.desde, anioActual - (rama === 'CAMION' || rama === 'TRAILER' ? 22 : 18))
      const hasta = Math.min(modelo.hasta, anioActual)
      // Más autos nuevos que viejos, pero de todo.
      const anio = Math.round(hasta - Math.pow(azar.num(), 1.3) * (hasta - desde))
      const antiguedad = anioActual - anio
      const sumaAsegurada = redondear(modelo.precio * 1_000_000 * Math.pow(0.92, antiguedad), 50_000)
      const cia = compania(azar.pesado(COMPANIAS_POR_RAMA[rama].map((nombre) => [nombre, compania(nombre).peso] as const)))
      const cobertura = this.coberturaPara(azar, rama, antiguedad)
      const formaPago = esEmpresa ? azar.pesado([['CBU', 5], ['TRANSFERENCIA', 4], ['EFECTIVO', 1]]) : azar.pesado(FORMAS_DE_PAGO)
      const chasisWmi = WMI[modelo.marca]
      const vin = chasisWmi
        ? chasisWmi + Array.from({ length: 14 }, () => ALFANUMERICO_VIN[azar.entero(0, ALFANUMERICO_VIN.length - 1)]).join('')
        : ''
      const conMotorYChasis = rama !== 'TRAILER' && azar.si(0.7)
      const alta = azar.si(0.22)
        ? // Alta dentro de las planillas que se ven: la cartera crece mes a mes.
          azar.entero(primerDiaDelMes(this.primerMes), this.hoy)
        : this.hoy - azar.entero(420, 2600)
      const diaDeVencimiento = azar.si(0.5) ? azar.elegir([5, 10, 15, 20, 25]) : azar.entero(1, 28)

      this.polizas.push({
        indice,
        cliente,
        rama,
        modelo,
        version,
        anio,
        patente: this.nuevaPatente(azar, rama, anio),
        motor: conMotorYChasis ? `${modelo.marca.slice(0, 2)}${azar.entero(100000, 999999)}${azar.si(0.3) ? 'X' : ''}` : '',
        chasis: conMotorYChasis ? vin : '',
        color: azar.elegir(COLORES),
        uso: esEmpresa ? 'COMERCIAL' : 'PARTICULAR',
        sumaAsegurada,
        compania: cia,
        numero: this.nuevoNumeroDePoliza(azar, cia),
        cobertura,
        cuotaBase: this.cuotaPara(azar, rama, cobertura, sumaAsegurada, cia),
        formaPago,
        automatica: esDebitoAutomatico(formaPago),
        diaDeVencimiento,
        vigenciaMeses: azar.elegir(cia.vigencias),
        alta,
        altaMes: indiceDelDia(alta),
        bajaMes: null,
        bajaDia: null,
        motivoBaja: null,
        deudaDesde: null,
        imputada: false,
        rechazoMes: null,
        venceHoy: false,
        renovacionPendiente: false,
        noAvisar: azar.si(0.05),
        // El GNC y el acreedor prendario son cosa de autos y camionetas.
        observaciones: azar.si(0.12)
          ? azar.elegir(rama === 'AUTO' || rama === 'PICK UP' ? OBSERVACIONES_DE_POLIZA : OBSERVACIONES_DE_POLIZA.filter((o) => !/GNC|PRENDARIO/.test(o)))
          : '',
      })
    })

    this.elegirBajas()
    this.marcarCasosDelMes()
  }

  /** Tres bajas por mes, de pólizas que ya estaban: quedan en las planillas anteriores y en BAJAS. */
  private elegirBajas(): void {
    const azar = new Azar('bajas')
    const candidatas = azar.mezclar(this.polizas)
    let cursor = 0
    for (let mes = this.primerMes + 1; mes <= this.mesActual; mes++) {
      let elegidas = 0
      while (elegidas < 3 && cursor < candidatas.length) {
        const poliza = candidatas[cursor++]
        if (poliza.altaMes >= mes - 1 || poliza.bajaMes !== null) continue
        const desde = primerDiaDelMes(mes)
        const hasta = Math.min(ultimoDiaDelMes(mes), this.hoy)
        poliza.bajaMes = mes
        const dia = sinDomingo(azar.entero(desde, hasta))
        poliza.bajaDia = dia < desde ? desde : dia
        poliza.motivoBaja = azar.pesado(MOTIVOS_DE_BAJA_DEMO.map((m) => [m, m[1]] as const))
        elegidas++
      }
    }
  }

  /**
   * Los casos que hacen que cada pantalla tenga algo que mostrar hoy: cuotas que vencen hoy y esta
   * semana, deudores, cuotas imputadas, débitos rechazados y renovaciones manuales que vencen pronto o
   * ya vencieron. Se eligen entre las pólizas vigentes y se fuerzan, en vez de esperar que el azar los dé.
   */
  private marcarCasosDelMes(): void {
    const azar = new Azar('casos')
    const vigentes = this.polizas.filter((p) => p.bajaMes === null)
    const antiguas = (p: Poliza) => p.altaMes <= this.mesActual - 4
    const manuales = azar.mezclar(vigentes.filter((p) => !p.automatica && antiguas(p) && p.formaPago !== 'CUPONERA'))
    const usadas = new Set<Poliza>()
    const tomar = (lista: Poliza[], cantidad: number, filtro: (p: Poliza) => boolean = () => true): Poliza[] => {
      const elegidas: Poliza[] = []
      for (const p of lista) {
        if (elegidas.length >= cantidad) break
        if (usadas.has(p) || !filtro(p)) continue
        usadas.add(p)
        elegidas.push(p)
      }
      return elegidas
    }

    // Vencen hoy y no pagaron.
    for (const p of tomar(manuales, 8)) {
      p.diaDeVencimiento = this.hoyPartes.dia
      p.venceHoy = true
    }
    // Vencen en los próximos días (si el mes da: el último día del mes no tiene «próximos»).
    for (const p of tomar(manuales, 12)) p.diaDeVencimiento = Math.min(31, this.hoyPartes.dia + azar.entero(1, 6))
    // Deudores: dejaron de pagar este mes, hace uno, dos o tres.
    const atrasos = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3]
    for (const [i, p] of tomar(manuales, atrasos.length).entries()) {
      p.deudaDesde = this.mesActual - atrasos[i]
      // Los que deben sólo este mes ya tienen que estar vencidos, si no no deben nada.
      if (atrasos[i] === 0 && vencimientoEn(this.mesActual, p.diaDeVencimiento) >= this.hoy) p.diaDeVencimiento = Math.max(1, this.hoyPartes.dia - azar.entero(3, 15))
      if (p.diaDeVencimiento < 1) p.diaDeVencimiento = 1
    }
    // Imputadas: la agencia pagó la cuota a la compañía y el cliente todavía no transfirió.
    for (const p of tomar(manuales, 4, (x) => x.formaPago === 'TRANSFERENCIA' || x.formaPago === 'MERCADO PAGO' || x.formaPago === 'EFECTIVO')) {
      p.imputada = true
    }
    // Débitos rechazados: el del mes si ya se debitó, si no el del mes pasado. Se reparten POR SUCURSAL y
    // no al azar sobre toda la cartera: la campana y la pestaña Rechazos arrancan filtradas por el local
    // de quien entra, y Martina (Dock Sud) o Lucía (Sarandí) no pueden abrirlas vacías. Sarandí lleva dos
    // porque el chat de ejemplo lo dice (ver `CONVERSACIONES` en servidor.ts).
    const automaticas = azar.mezclar(vigentes.filter((p) => p.automatica && antiguas(p)))
    const RECHAZOS_POR_SUCURSAL: Record<NombreDeSucursal, number> = { 'Dock Sud': 3, Lanús: 2, Sarandí: 2, Daniel: 1 }
    for (const sucursal of SUCURSALES_DEMO) {
      for (const p of tomar(automaticas, RECHAZOS_POR_SUCURSAL[sucursal.nombre] ?? 1, (x) => x.cliente.sucursal === sucursal)) {
        p.rechazoMes = vencimientoEn(this.mesActual, p.diaDeVencimiento) < this.hoy ? this.mesActual : this.mesActual - 1
      }
    }
    // Renovaciones manuales: unas vencidas sin renovar y otras que vencen en las próximas semanas.
    const deRenovacionManual = azar.mezclar(vigentes.filter((p) => COMPANIAS_DE_RENOVACION_MANUAL.includes(p.compania.nombre) && p.altaMes < this.primerMes))
    const vueltas = (p: Poliza) => Math.ceil(16 / p.vigenciaMeses)
    for (const p of tomar(deRenovacionManual, 4)) {
      p.alta = sumarMeses(this.hoy - azar.entero(2, 20), -p.vigenciaMeses * vueltas(p))
      p.altaMes = indiceDelDia(p.alta)
      p.renovacionPendiente = true
    }
    for (const p of tomar(deRenovacionManual, 6)) {
      p.alta = sumarMeses(this.hoy + azar.entero(3, 40), -p.vigenciaMeses * vueltas(p))
      p.altaMes = indiceDelDia(p.alta)
    }
    // Y un par con el aumento anotado para la renovación, que la bandeja destaca.
    const proximas = vigentes.filter((p) => {
      const { hasta } = this.vigenciaEn(p, this.hoy, true)
      return hasta > this.hoy && hasta <= this.hoy + 45 && !p.observaciones
    })
    for (const p of azar.mezclar(proximas).slice(0, 3)) p.observaciones = `${azar.elegir([15, 20, 25])}% AUMENTAR CUANDO SE RENUEVA`
  }

  /** La vigencia que corría ese día: cortes cada `vigenciaMeses` desde el alta. */
  private vigenciaEn(p: Poliza, dia: number, esElMesEnCurso: boolean): { desde: number; hasta: number } {
    let k = 0
    while (sumarMeses(p.alta, (k + 1) * p.vigenciaMeses) <= dia) k++
    // La renovación pendiente sigue mostrando la vigencia que ya terminó: nadie la renovó todavía.
    if (esElMesEnCurso && p.renovacionPendiente && k > 0) k--
    return { desde: sumarMeses(p.alta, k * p.vigenciaMeses), hasta: sumarMeses(p.alta, (k + 1) * p.vigenciaMeses) }
  }

  private estaEnElMes(p: Poliza, mes: number): boolean {
    return p.altaMes <= mes && (p.bajaMes === null || mes < p.bajaMes)
  }

  private cuotaDelMes(p: Poliza, mes: number): number {
    return redondear(p.cuotaBase * (1 - 0.021 * (this.mesActual - mes)), 100)
  }

  private claveDeCuota(p: Poliza, mes: number): string {
    return `${p.indice}|${mes}`
  }

  private idDeLaCuota(p: Poliza, mes: number): string {
    const clave = this.claveDeCuota(p, mes)
    let id = this.idDeCuota.get(clave)
    if (!id) {
      id = this.ids.de('cuota', p.indice, mes - this.mesActual, this.hoy)
      this.idDeCuota.set(clave, id)
    }
    return id
  }

  /** Si pagó la cuota de ese mes, cuándo y por dónde. */
  private pagoDe(p: Poliza, mes: number): Pago | null {
    const azar = new Azar(`pago|${p.indice}|${mes - this.mesActual}`)
    const vencimiento = vencimientoEn(mes, p.diaDeVencimiento)
    const enCurso = mes === this.mesActual
    // Nunca antes del alta (la primera cuota se paga al emitir) ni después de hoy.
    const tope = (dia: number) => Math.min(this.hoy, Math.max(p.alta, dia))

    if (p.automatica) {
      if (p.rechazoMes === mes) return null
      if (vencimiento >= this.hoy) return null
      if (enCurso && azar.si(0.06)) return null
      return { dia: tope(vencimiento), enElMostrador: false }
    }
    if (p.deudaDesde !== null && mes >= p.deudaDesde) return null
    if (enCurso && (p.imputada || p.venceHoy)) return null
    const mostrador = COBRADAS_EN_EL_MOSTRADOR.has(p.formaPago)

    if (enCurso) {
      if (vencimiento < this.hoy) {
        if (!azar.si(0.86)) return null
        return { dia: sinDomingo(tope(Math.max(primerDiaDelMes(mes) - 2, vencimiento + azar.entero(-5, 2)))), enElMostrador: mostrador }
      }
      if (!azar.si(0.25)) return null
      const desde = Math.min(this.hoy, Math.max(primerDiaDelMes(mes), vencimiento - 10))
      return { dia: tope(sinDomingo(azar.entero(desde, this.hoy))), enElMostrador: mostrador }
    }
    const atraso = azar.si(0.06) ? azar.entero(8, 25) : azar.entero(-6, 3)
    return { dia: sinDomingo(tope(vencimiento + atraso)), enElMostrador: mostrador }
  }

  // -------------------------------------------------------------------------
  // Planillas mensuales y bajas
  // -------------------------------------------------------------------------

  private planillaDelMes(mes: number): string[][] {
    const enCurso = mes === this.mesActual
    const referencia = enCurso ? this.hoy : Math.min(this.hoy, ultimoDiaDelMes(mes))
    const filas: Array<{ nombre: string; fila: Fila }> = []
    for (const p of this.polizas) {
      if (!this.estaEnElMes(p, mes)) continue
      const azar = new Azar(`fila|${p.indice}|${mes - this.mesActual}`)
      const vigencia = this.vigenciaEn(p, Math.max(p.alta, referencia), enCurso)
      const cuota = this.cuotaDelMes(p, mes)
      const pago = this.pagoDe(p, mes)
      if (pago) this.pagos.set(this.claveDeCuota(p, mes), pago)
      const vencimiento = vencimientoEn(mes, p.diaDeVencimiento)

      // El aviso de vencimiento: en el mes en curso a los que están por vencer o vencidos sin pagar.
      let aviso = ''
      let fechaDeEnvio = ''
      if (!p.automatica && !p.noAvisar) {
        if (enCurso && !pago && vencimiento - this.hoy <= 3 && azar.si(0.7)) {
          aviso = 'SI'
          fechaDeEnvio = textoDe(Math.max(primerDiaDelMes(mes), Math.min(this.hoy, vencimiento - 3)))
        } else if (!enCurso && azar.si(0.45)) {
          aviso = 'SI'
        }
      }
      let obsPago = ''
      if (p.deudaDesde !== null && mes >= p.deudaDesde) {
        const debe = Math.min(mes, this.mesActual) - p.deudaDesde + 1
        obsPago = debe > 1 ? `DEBE ${debe} CUOTAS` : `DEBE ${nombreDelMes(mes)}`
      } else if (p.imputada && enCurso) {
        obsPago = 'IMPUTADA, FALTA QUE TRANSFIERA'
      } else if (p.rechazoMes === mes) {
        obsPago = 'REBOTO EL DEBITO'
      }
      const c = p.cliente
      filas.push({
        nombre: c.nombre,
        fila: {
          'APELLIDO Y NOMBRE': c.nombre,
          DNI: c.documento,
          TELEFONO: c.telefono,
          EMAIL: c.email,
          DOMICILIO: c.direccion,
          LOCALIDAD: c.localidad.nombre,
          LOCAL: c.sucursal.enLaPlanilla,
          'FECHA DE NACIMIENTO': c.nacimiento,
          COMPAÑIA: p.compania.nombre,
          'N° POLIZA': p.numero,
          COBERTURA: p.cobertura,
          PRIMA: pesos(cuota),
          'FORMA DE PAGO': p.formaPago,
          PRODUCTOR: c.sucursal.productor,
          ESTADO: 'VIGENTE',
          'VIGENCIA DESDE': textoDe(vigencia.desde),
          'VIGENCIA HASTA': textoDe(vigencia.hasta),
          ALTA: textoDe(p.alta),
          TIPO: p.rama,
          MARCA: p.modelo.marca,
          MODELO: p.version,
          AÑO: String(p.anio),
          PATENTE: p.patente,
          MOTOR: p.motor,
          CHASIS: p.chasis,
          USO: p.uso,
          COLOR: p.color,
          'SUMA ASEGURADA': p.rama === 'TRAILER' ? '' : pesos(p.sumaAsegurada),
          CUOTA: pesos(cuota),
          'DIA DE VTO': String(p.diaDeVencimiento),
          AVISO: aviso,
          'FECHA DE ENVIO': fechaDeEnvio,
          'AVISAR VTO': p.noAvisar ? 'NO AVISAR' : '',
          PAGO: pago ? textoDe(pago.dia) : '',
          'OBS PAGO': obsPago,
          OBSERVACIONES: p.observaciones,
          _ID: this.idDeLaCuota(p, mes),
        },
      })
    }
    filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    return armar(
      ENC_MENSUAL,
      filas.map((f) => f.fila),
    )
  }

  private bajasDelMes(mes: number): PestanaDeLaDemo | null {
    const dadas = this.polizas.filter((p) => p.bajaMes === mes).sort((a, b) => (a.bajaDia ?? 0) - (b.bajaDia ?? 0))
    if (dadas.length === 0) return null
    const filas = dadas.map((p): Fila => {
      const [motivo, , nota] = p.motivoBaja ?? MOTIVOS_DE_BAJA_DEMO[0]
      return {
        'APELLIDO Y NOMBRE': p.cliente.nombre,
        DNI: p.cliente.documento,
        TELEFONO: p.cliente.telefono,
        LOCAL: p.cliente.sucursal.enLaPlanilla,
        CIA: p.compania.nombre,
        'N° POLIZA': p.numero,
        COBERTURA: p.cobertura,
        PATENTE: p.patente,
        MARCA: p.modelo.marca,
        MODELO: p.version,
        CUOTA: pesos(this.cuotaDelMes(p, mes)),
        MOTIVO: motivo,
        MES: nombreDelMes(mes),
        'FECHA DE BAJA': textoDe(p.bajaDia ?? primerDiaDelMes(mes)),
        OBSERVACIONES: nota,
        // Las del mes en curso las dio de baja el programa: su _ID nombra a la fila de la planilla que
        // sacó, como hace `darDeBaja`. Las de antes las cargó la agencia a mano.
        _ID: mes === this.mesActual ? `BAJA:${this.idDeLaCuota(p, mes)}` : this.ids.de('baja', p.indice, this.hoy),
      }
    })
    return { titulo: `BAJAS ${this.tituloDelMes(mes)}`, valores: armar(ENC_BAJAS, filas) }
  }

  // -------------------------------------------------------------------------
  // AMP, riesgos varios, siniestros y cobertura
  // -------------------------------------------------------------------------

  private vigentes(filtro: (p: Poliza) => boolean = () => true): Poliza[] {
    return this.polizas.filter((p) => p.bajaMes === null && filtro(p))
  }

  private pestanaAmp(): PestanaDeLaDemo {
    const azar = new Azar('amp')
    const AMPLIACIONES: Array<[string, string]> = [
      ['GRANIZO', 'SE AGREGA COBERTURA DE GRANIZO'],
      ['CRISTALES', 'CRISTALES SIN LIMITE'],
      ['GNC', 'DECLARAR EQUIPO DE GNC 5TA GENERACION'],
      ['CERRADURAS', 'CERRADURAS Y LLAVES'],
      ['ACCESORIOS', 'DECLARAR STEREO Y LLANTAS DE ALEACION'],
      ['AUMENTO DE SUMA ASEGURADA', 'ACTUALIZAR SUMA A VALOR DE MERCADO'],
      ['RUEDA DE AUXILIO', 'ROBO DE RUEDAS'],
    ]
    const candidatas = azar.mezclar(this.vigentes((p) => p.rama === 'AUTO' || p.rama === 'PICK UP'))
    const filas = candidatas.slice(0, 15).map((p, i): Fila => {
      const dia = this.hoy - azar.entero(0, 70)
      const [ampliacion, observacion] = azar.elegir(AMPLIACIONES)
      // Las viejas ya están hechas; de las nuevas, la mitad.
      const resuelto = this.hoy - dia > 25 ? azar.si(0.85) : azar.si(0.3)
      return {
        LOCAL: p.cliente.sucursal.enLaPlanilla,
        FECHA: textoDe(dia),
        'APELLIDO Y NOMBRE': p.cliente.nombre,
        DNI: p.cliente.documento,
        TELEFONO: p.cliente.telefono,
        'FORMA DE PAGO': p.formaPago,
        PATENTE: p.patente,
        MARCA: p.modelo.marca,
        MODELO: p.version,
        CIA: p.compania.nombre,
        'N° POLIZA': p.numero,
        AMPLIACION: ampliacion,
        'FECHA DE VTO': textoDe(dia + 30),
        OBSERVACIONES: observacion,
        RESUELTO: resuelto ? 'SI' : '',
        _ID: this.ids.de('amp', i, this.hoy),
      }
    })
    filas.sort((a, b) => a.FECHA.split('/').reverse().join('').localeCompare(b.FECHA.split('/').reverse().join('')))
    return { titulo: 'AMP', valores: armar(ENC_AMP, filas) }
  }

  private pestanaRiesgos(): PestanaDeLaDemo {
    const azar = new Azar('riesgos')
    const RIESGOS: Array<{ tipo: string; detalle: (c: Cliente) => string; cias: string[]; cuota: [number, number]; empresa?: boolean }> = [
      { tipo: 'COMBINADO FAMILIAR', detalle: (c) => `VIVIENDA EN ${c.direccion}, ${c.localidad.nombre}. INCENDIO EDIFICIO $ 80.000.000`, cias: ['SANCOR', 'FEDERACION PATRONAL', 'SAN CRISTOBAL', 'ZURICH'], cuota: [14, 32] },
      { tipo: 'HOGAR', detalle: (c) => `DEPARTAMENTO EN ${c.localidad.nombre}. CONTENIDO GENERAL Y ROBO`, cias: ['SANCOR', 'MERCANTIL ANDINA', 'ZURICH'], cuota: [9, 18] },
      { tipo: 'INTEGRAL DE COMERCIO', detalle: () => azar.elegir(['KIOSCO Y ALMACEN', 'PELUQUERIA', 'VERDULERIA', 'TALLER MECANICO', 'LIBRERIA']) + '. INCENDIO, ROBO Y RC', cias: ['SANCOR', 'FEDERACION PATRONAL', 'SAN CRISTOBAL'], cuota: [22, 48] },
      { tipo: 'ACCIDENTES PERSONALES', detalle: () => `MUERTE E INVALIDEZ $ 10.000.000. ACTIVIDAD: ${azar.elegir(['ALBAÑIL', 'DELIVERY EN MOTO', 'ELECTRICISTA', 'PINTOR'])}`, cias: ['SAN CRISTOBAL', 'GALENO', 'FEDERACION PATRONAL'], cuota: [6, 12] },
      { tipo: 'VIDA', detalle: () => 'VIDA INDIVIDUAL, CAPITAL $ 15.000.000', cias: ['GALENO', 'SAN CRISTOBAL', 'ZURICH'], cuota: [8, 16] },
      { tipo: 'BICICLETA', detalle: () => `BICICLETA RODADO 29 ${azar.elegir(['VENZO', 'TOPMEGA', 'SBK'])}`, cias: ['SANCOR', 'ZURICH'], cuota: [5, 9] },
      { tipo: 'SEGURO TECNICO', detalle: () => azar.elegir(['CELULAR SAMSUNG GALAXY A55', 'NOTEBOOK LENOVO IDEAPAD', 'CELULAR MOTOROLA EDGE']), cias: ['SANCOR', 'MERCANTIL ANDINA'], cuota: [4, 8] },
      { tipo: 'ART', detalle: () => `ART PARA ${azar.entero(3, 12)} EMPLEADOS`, cias: ['FEDERACION PATRONAL', 'GALENO'], cuota: [90, 260], empresa: true },
      { tipo: 'INCENDIO', detalle: () => 'DEPOSITO Y MERCADERIA. SUMA $ 120.000.000', cias: ['FEDERACION PATRONAL', 'SANCOR'], cuota: [35, 70], empresa: true },
    ]

    // Ocho clientes que sólo tienen riesgos varios: no están en la planilla del mes y su ficha viaja
    // por APP CLIENTES (15.4), que es lo que los deja como clientes de la cartera.
    for (let i = 0; i < 8; i++) {
      const azarCliente = new Azar(`cliente-riesgo|${i}`)
      this.clientesSoloRiesgo.push(this.nuevoCliente(azarCliente, 1000 + i, false))
    }
    const deLaCartera = azar.mezclar(this.vigentes()).slice(0, 20)
    const titulares: Array<{ cliente: Cliente; formaPago: string }> = [
      ...deLaCartera.map((p) => ({ cliente: p.cliente, formaPago: p.formaPago })),
      ...this.clientesSoloRiesgo.map((cliente) => ({ cliente, formaPago: azar.pesado(FORMAS_DE_PAGO) })),
    ]
    const filas = titulares.map(({ cliente, formaPago }, i): Fila => {
      const opciones = RIESGOS.filter((r) => (r.empresa ? cliente.esEmpresa : true))
      const riesgo = cliente.esEmpresa ? azar.elegir(opciones.filter((r) => r.empresa || r.tipo === 'INTEGRAL DE COMERCIO')) : azar.elegir(opciones.filter((r) => !r.empresa))
      const cia = compania(azar.elegir(riesgo.cias))
      const emision = this.hoy - azar.entero(10, 340)
      const hasta = sumarMeses(emision, 12)
      const cuota = azar.entero(riesgo.cuota[0], riesgo.cuota[1]) * 1000
      const dia = azar.elegir([5, 10, 15, 20])
      const vencimiento = vencimientoEn(this.mesActual, dia)
      const automatica = esDebitoAutomatico(formaPago)
      const pagada = vencimiento < this.hoy ? azar.si(0.85) : azar.si(0.2)
      return {
        'APELLIDO Y NOMBRE': cliente.nombre,
        DNI: cliente.documento,
        TELEFONO: cliente.telefono,
        EMAIL: cliente.email,
        DOMICILIO: cliente.direccion,
        LOCALIDAD: cliente.localidad.nombre,
        LOCAL: cliente.sucursal.enLaPlanilla,
        FECHA: textoDe(emision),
        RIESGO: riesgo.tipo,
        DETALLE: riesgo.detalle(cliente),
        CIA: cia.nombre,
        'N° POLIZA': this.nuevoNumeroDePoliza(azar, { ...cia, prefijo: `${riesgo.tipo.slice(0, 2)}-${cia.prefijo}`, digitos: 6 }),
        PRIMA: pesos(cuota * 12),
        CUOTA: pesos(cuota),
        'VIGENCIA DESDE': textoDe(emision),
        'VIGENCIA HASTA': textoDe(hasta),
        'FORMA DE PAGO': formaPago,
        VTO: String(dia),
        AVISO: !automatica && !pagada && azar.si(0.5) ? 'SI' : '',
        PAGO: pagada ? textoDe(sinDomingo(Math.min(this.hoy, Math.max(primerDiaDelMes(this.mesActual), vencimiento - azar.entero(0, 4))))) : '',
        PRODUCTOR: cliente.sucursal.productor,
        ESTADO: 'VIGENTE',
        OBSERVACIONES: i % 5 === 0 ? 'RENUEVA AUTOMATICAMENTE' : '',
        _ID: this.ids.de('riesgo', i, this.hoy),
      }
    })
    return { titulo: 'RIESGOS VARIOS', valores: armar(ENC_RIESGOS, filas) }
  }

  private pestanaSiniestros(): PestanaDeLaDemo {
    const azar = new Azar('siniestros')
    const CHOQUES = [
      'CHOQUE EN ESQUINA, DAÑO EN PARAGOLPE DELANTERO Y OPTICA',
      'LO CHOCARON DE ATRAS EN AV. MITRE, DAÑO EN BAUL',
      'CHOQUE CON MOTO EN AV. PAVON',
      'ROCE EN ESTACIONAMIENTO, DAÑO EN PUERTA TRASERA',
      'CHOQUE EN CADENA EN EL PUENTE PUEYRREDON',
      'DAÑO POR TERCERO MIENTRAS ESTABA ESTACIONADO',
      'CHOQUE EN ROTONDA, DAÑO EN GUARDABARRO',
    ]
    const ROBOS = ['ROBO TOTAL EN LA VIA PUBLICA', 'ROBO DE RUEDA DE AUXILIO', 'ROBO DE ESPEJOS LATERALES', 'INTENTO DE ROBO, ROTURA DE CERRADURA']
    const DANOS = ['GRANIZO, ABOLLADURAS EN CAPOT Y TECHO', 'ROTURA DE PARABRISAS POR PIEDRA EN LA AUTOPISTA', 'CAIDA DE RAMA SOBRE EL TECHO', 'INCENDIO PARCIAL EN EL VANO MOTOR']
    // Las motos de la demo sólo tienen RC o RC + robo total: el daño de la propia moto no se cubre, lo que se
    // denuncia es lo que le pasó al tercero.
    const MOTOS = ['CAIDA EN MOTO, DAÑO A UN AUTO ESTACIONADO', 'RECLAMO DE TERCERO: ROCE EN UN SEMAFORO, DAÑO EN EL PARAGOLPE DE SU AUTO']
    const ROBO_MOTO = ['ROBO TOTAL DE LA MOTO FRENTE AL DOMICILIO']
    const ABOGADOS = ['DRA. ROMINA SALAS', 'DR. PABLO ITURRASPE', 'ESTUDIO PEREYRA & ASOC.']
    // Lo que dice la observación tiene que cuadrar con lo que pasó: no hay perito para un robo ni «reparado en
    // taller» para un reclamo de tercero, y sin tercero no falta «el registro del tercero».
    const observacionesDe = (estado: string, tipo: 'ROBO' | 'TERCERO' | 'PROPIO', conTercero: boolean): string[] => {
      switch (estado) {
        case 'SIN RESPONDER':
          return ['SE LE MANDO EL CUESTIONARIO POR WHATSAPP', 'NO CONTESTA, VOLVER A LLAMAR']
        case 'CARGADO':
          // Ya tiene número de siniestro (sólo el SIN RESPONDER no lo tiene todavía).
          return tipo === 'PROPIO' ? ['DENUNCIA CARGADA EN LA WEB DE LA COMPAÑIA', 'ESPERANDO QUE LA COMPAÑIA ASIGNE EL PERITO'] : ['DENUNCIA CARGADA EN LA WEB DE LA COMPAÑIA']
        case 'EN TRAMITE':
          return tipo === 'PROPIO' ? ['EL PERITO PASA ESTA SEMANA', 'PRESUPUESTO DEL TALLER ENVIADO', 'EN ANALISIS DE LA COMPAÑIA'] : ['EN ANALISIS DE LA COMPAÑIA']
        case 'ESPERANDO DOCUMENTACION':
          if (tipo === 'ROBO') return ['FALTA DENUNCIA POLICIAL']
          return conTercero ? ['FALTA REGISTRO DEL TERCERO', 'FALTA DENUNCIA POLICIAL', 'FALTAN FOTOS DEL DAÑO'] : ['FALTA PRESUPUESTO DEL TALLER', 'FALTAN FOTOS DEL DAÑO']
        default:
          return tipo === 'PROPIO'
            ? ['PAGADO POR LA COMPAÑIA', 'REPARADO EN TALLER DE LA COMPAÑIA', 'RECHAZADO POR FALTA DE COBERTURA']
            : ['PAGADO POR LA COMPAÑIA', 'PAGADO POR LA COMPAÑIA', 'PAGADO POR LA COMPAÑIA', 'RECHAZADO POR FALTA DE COBERTURA']
      }
    }
    const candidatas = azar.mezclar(this.vigentes((p) => p.rama !== 'TRAILER' && p.altaMes <= this.mesActual - 1))
    const filas: Array<{ dia: number; fila: Fila }> = []
    for (let i = 0; i < 32; i++) {
      const p = candidatas[i]
      const esMoto = p.rama === 'MOTO' || p.rama === 'SCOOTER' || p.rama === 'MOTO ELÉCTRICA'
      const dia = Math.min(this.hoy - 1, Math.max(p.alta + 5, this.hoy - Math.floor(Math.pow(azar.num(), 1.4) * 280) - 1))
      const edad = this.hoy - dia
      const estado =
        edad > 120
          ? azar.pesado([['CERRADO', 85], ['EN TRAMITE', 15]])
          : edad > 30
            ? azar.pesado([['EN TRAMITE', 40], ['ESPERANDO DOCUMENTACION', 25], ['CERRADO', 35]])
            : azar.pesado([['SIN RESPONDER', 25], ['CARGADO', 30], ['EN TRAMITE', 30], ['ESPERANDO DOCUMENTACION', 15]])
      let descripcion: string
      if (esMoto) descripcion = p.cobertura === RC_ROBO && azar.si(0.35) ? azar.elegir(ROBO_MOTO) : azar.elegir(MOTOS)
      else if (p.cobertura === RC) descripcion = `RECLAMO DE TERCERO: ${azar.elegir(CHOQUES)}`
      else descripcion = azar.pesado([[azar.elegir(CHOQUES), 55], [azar.elegir(ROBOS), 25], [azar.elegir(DANOS), p.cobertura === TC ? 5 : 20]])
      const conTercero = /CHOQUE|CHOCARON|ROCE|TERCERO|CAIDA EN MOTO/.test(descripcion)
      const lesionados = conTercero && azar.si(0.2)
      const robo = /ROBO TOTAL/.test(descripcion)
      const tipo = /ROBO/.test(descripcion) ? 'ROBO' : p.cobertura === RC || esMoto ? 'TERCERO' : 'PROPIO'
      const observacion = azar.elegir(observacionesDe(estado, tipo, conTercero))
      const importe =
        // Un rechazo no liquida nada: sin importe.
        (estado === 'CERRADO' && !observacion.startsWith('RECHAZADO')) || estado === 'EN TRAMITE'
          ? robo
            ? pesos(p.sumaAsegurada)
            : pesos(azar.entero(18, 260) * 10_000)
          : ''
      const numero =
        estado === 'SIN RESPONDER'
          ? ''
          : p.compania.nombre === 'SANCOR'
            ? `S-${partesDe(dia).anio}-${azar.entero(10000, 99999)}`
            : String(azar.entero(1_000_000, 9_999_999))
      const id = this.ids.de('siniestro', i, this.hoy)
      const carga = Math.min(this.hoy, dia + azar.entero(0, 3))
      this.siniestros.push({ id, poliza: p, numero, estado, dia, carga, observacion, tipo, conTercero })
      filas.push({
        dia,
        fila: {
          LOCAL: p.cliente.sucursal.enLaPlanilla,
          'FECHA DE CARGA': textoDe(carga),
          FECHA: textoDe(dia),
          'APELLIDO Y NOMBRE': p.cliente.nombre,
          DNI: p.cliente.documento,
          TELEFONO: p.cliente.telefono,
          PATENTE: p.patente,
          MARCA: p.modelo.marca,
          MODELO: p.version,
          CIA: p.compania.nombre,
          'N° POLIZA': p.numero,
          COBERTURA: p.cobertura,
          'N° SINIESTRO': numero,
          DESCRIPCION: descripcion,
          ESTADO: estado,
          IMPORTE: importe,
          ABOGADO: lesionados || (conTercero && azar.si(0.15)) ? azar.elegir(ABOGADOS) : '',
          'CIA DEL TERCERO': conTercero ? azar.elegir(COMPANIAS).nombre : '',
          'TEL DEL TERCERO': conTercero ? this.telefono(azar) : '',
          'PATENTE DEL TERCERO': conTercero ? this.nuevaPatente(azar, 'AUTO', azar.entero(2008, this.hoyPartes.anio)) : '',
          LESIONADOS: conTercero ? (lesionados ? 'SI' : 'NO') : '',
          'DETALLE DE LESIONADOS': lesionados ? azar.elegir(['EL CONDUCTOR DE LA MOTO, GOLPE EN LA RODILLA', 'ACOMPAÑANTE DEL OTRO AUTO, CERVICALGIA']) : '',
          OBSERVACIONES: observacion,
          _ID: id,
        },
      })
    }

    // El de la Hilux de Sarandí, que entró hoy: es del que habla el chat de ejemplo entre Lucía y Martina
    // (servidor.ts), y del que cuelga la tarea que Lucía le dejó a Martina (`pestanaTareas`). Va aparte y
    // con su propio azar para no correr los 32 de arriba.
    const hilux = this.siniestroDeLaHilux()
    if (hilux) filas.push(hilux)
    filas.sort((a, b) => a.dia - b.dia)
    return { titulo: 'SINIESTROS', valores: armar(ENC_SINIESTROS, filas.map((f) => f.fila)) }
  }

  /**
   * Un choque de una Hilux de Sarandí cargado hoy, todavía sin número de siniestro. Se prefiere una con
   * cobertura de daño propio (todo riesgo, y si no terceros completo): con una RC el perito de la tarea no
   * tendría qué mirar. Si la cartera no tuviera una Hilux vigente en Sarandí (no pasa con la semilla de
   * hoy) se usa otra pick-up del local, y si tampoco hay, cualquier póliza del local: que falte el auto
   * exacto es mejor que una tarea suelta.
   */
  private siniestroDeLaHilux(): { dia: number; fila: Fila } | null {
    const azar = new Azar('siniestro-hilux')
    const libres = this.vigentes(
      (p) => p.cliente.sucursal.nombre === 'Sarandí' && p.altaMes <= this.mesActual - 1 && !this.siniestros.some((s) => s.poliza === p),
    )
    const hiluxes = libres.filter((x) => x.modelo.modelo === 'HILUX')
    const p =
      [TR, TCP, TC].map((cobertura) => hiluxes.find((x) => x.cobertura === cobertura)).find((x) => x) ??
      hiluxes[0] ??
      libres.find((x) => x.rama === 'PICK UP' && x.cobertura !== RC) ??
      libres.find((x) => x.rama === 'PICK UP') ??
      libres[0]
    if (!p) return null
    const propio = p.cobertura !== RC
    const dia = this.hoy
    const id = this.ids.de('siniestro', 'hilux', this.hoy)
    this.siniestros.push({ id, poliza: p, numero: '', estado: 'CARGADO', dia, carga: dia, observacion: '', tipo: propio ? 'PROPIO' : 'TERCERO', conTercero: true })
    this.idDeLaHilux = id
    return {
      dia,
      fila: {
        LOCAL: p.cliente.sucursal.enLaPlanilla,
        'FECHA DE CARGA': textoDe(dia),
        FECHA: textoDe(dia - 1),
        'APELLIDO Y NOMBRE': p.cliente.nombre,
        DNI: p.cliente.documento,
        TELEFONO: p.cliente.telefono,
        PATENTE: p.patente,
        MARCA: p.modelo.marca,
        MODELO: p.version,
        CIA: p.compania.nombre,
        'N° POLIZA': p.numero,
        COBERTURA: p.cobertura,
        'N° SINIESTRO': '',
        DESCRIPCION: `${propio ? '' : 'RECLAMO DE TERCERO: '}CHOQUE EN ESQUINA, DAÑO EN PARAGOLPE DELANTERO Y OPTICA`,
        ESTADO: 'CARGADO',
        IMPORTE: '',
        ABOGADO: '',
        'CIA DEL TERCERO': azar.elegir(COMPANIAS).nombre,
        'TEL DEL TERCERO': this.telefono(azar),
        'PATENTE DEL TERCERO': this.nuevaPatente(azar, 'AUTO', azar.entero(2012, this.hoyPartes.anio)),
        LESIONADOS: 'NO',
        'DETALLE DE LESIONADOS': '',
        OBSERVACIONES: 'DENUNCIA CARGADA, FOTOS DEL ASEGURADO POR WHATSAPP, ESPERANDO NUMERO DE SINIESTRO',
        _ID: id,
      },
    }
  }

  private pestanaCobertura(): PestanaDeLaDemo {
    const filas: Fila[] = []
    for (const cia of COMPANIAS) {
      const ramas = Object.entries(COMPANIAS_POR_RAMA).filter(([, nombres]) => nombres.includes(cia.nombre)).map(([rama]) => rama)
      const coberturas = new Set<string>()
      if (ramas.some((r) => r === 'AUTO' || r === 'PICK UP' || r === 'CAMION' || r === 'TRAILER')) [RC, TC, TCP, TR].forEach((c) => coberturas.add(c))
      if (ramas.some((r) => r === 'MOTO' || r === 'SCOOTER' || r === 'MOTO ELÉCTRICA')) [RC, RC_ROBO].forEach((c) => coberturas.add(c))
      for (const cobertura of coberturas) {
        filas.push({
          CIA: cia.nombre,
          COBERTURA: cobertura,
          INCLUYE: DETALLE_DE_COBERTURA[cobertura].incluye,
          FRANQUICIA: cobertura === TR ? pesos(cia.franquicia) : '---',
          DETALLE: DETALLE_DE_COBERTURA[cobertura].detalle,
          _ID: this.ids.de('cobertura', cia.nombre, cobertura),
        })
      }
    }
    return { titulo: 'COBERTURA', valores: armar(ENC_COBERTURA, filas) }
  }

  // -------------------------------------------------------------------------
  // Las pestañas de la aplicación
  // -------------------------------------------------------------------------

  /**
   * `paso` ordena los comentarios de una misma línea de tiempo que caen el mismo día: cada paso va más
   * tarde que el anterior. Los de HOY se cuentan hacia atrás desde la hora a la que se arma la demo (entre
   * 10 minutos y poco más de una hora antes, o `haceMin` si es uno puntual): quedan en orden con el chat de
   * ejemplo y nunca con una hora que todavía no llegó, abra la demo a la hora que la abra.
   */
  private comentario(tipo: 'LEAD' | 'SINIESTRO' | 'TAREA', vinculo: string, dia: number, usuario: string, texto: string, clave: string, paso = 0, haceMin?: number): void {
    const azar = new Azar(`hora|${clave}`)
    let fecha: string
    if (dia >= this.hoy) {
      const atras = haceMin ?? Math.max(1, 10 - Math.min(paso, 9)) * 7 + azar.entero(0, 6)
      // Ni antes de que empiece el día (con la demo abierta de madrugada) ni después de ahora.
      const ts = Math.min(this.ahora, Math.max(this.inicioDelDia, this.ahora - atras * 60_000))
      fecha = new Date(ts).toISOString()
    } else {
      const horas = Math.min(21, 12 + paso * 3 + azar.entero(0, 2))
      const hora = `${String(horas).padStart(2, '0')}:${String(azar.entero(0, 59)).padStart(2, '0')}`
      fecha = `${isoDe(dia)}T${hora}:00.000Z`
    }
    this.comentarios.push({
      FECHA: fecha,
      TIPO: tipo,
      VINCULO: `${tipo}:${vinculo}`,
      USUARIO: usuario,
      TEXTO: texto,
      _ID: `COM:${this.ids.de('comentario', clave, this.hoy)}`,
    })
  }

  private pestanaLeads(): PestanaDeLaDemo {
    const azar = new Azar('leads')
    const autos = MODELOS.filter((m) => m.rama !== 'TRAILER' && m.rama !== 'CAMION')
    const filas: Fila[] = []
    const NOTAS_POR_ESTADO: Record<string, string[]> = {
      NUEVO: ['Escribió por la tarde, todavía no le contestamos', 'Pidió que lo llamen después de las 18'],
      'EN CHARLA': ['Le pedí fotos de la cédula y del auto', 'Quiere comparar con lo que paga hoy', 'Pregunta si cubre granizo'],
      COTIZADO: ['Le pasé tres opciones por WhatsApp', 'Le pareció cara la de todo riesgo, ver terceros completo'],
      GANADO: ['Aceptó, se emitió la póliza', 'Pasó por el local a firmar y pagó la primera cuota'],
      PERDIDO: ['Se quedó con su compañía actual', 'Consiguió más barato por internet', 'No contestó más'],
    }
    for (let i = 0; i < 46; i++) {
      const dia = this.hoy - Math.floor(Math.pow(azar.num(), 1.6) * 75)
      const edad = this.hoy - dia
      const estado =
        edad <= 3
          ? azar.pesado([['NUEVO', 6], ['EN CHARLA', 2]])
          : edad <= 15
            ? azar.pesado([['NUEVO', 2], ['EN CHARLA', 4], ['COTIZADO', 4]])
            : azar.pesado([['EN CHARLA', 1], ['COTIZADO', 3], ['GANADO', 3], ['PERDIDO', 3]])
      const origen = azar.pesado([['WHATSAPP', 35], ['REDES', 25], ['RECOMENDADO', 15], ['LOCAL', 15], ['OTRO', 10]])
      const sucursal = azar.pesado(SUCURSALES_DEMO.map((s) => [s, s.peso] as const))
      const usuario = azar.elegir(sucursal.usuarios)
      const persona = this.nuevoNombreDePersona(azar)
      const nombre = comoSeEscribe(`${persona.nombres} ${persona.apellido}`)
      const queAsegura = azar.pesado([['VEHICULO', 85], ['HOGAR', 8], ['COMERCIO', 7]])
      let interes: string
      let tipo = ''
      let marca = ''
      let modelo = ''
      let anio = 0
      if (queAsegura === 'VEHICULO') {
        const m = azar.pesado(autos.map((x) => [x, x.peso] as const))
        anio = azar.entero(Math.max(m.desde, this.hoyPartes.anio - 12), Math.min(m.hasta, this.hoyPartes.anio))
        tipo = m.rama
        marca = m.marca
        modelo = azar.elegir(m.versiones)
        interes = `${comoSeEscribe(m.marca)} ${comoSeEscribe(m.modelo)} ${anio}`
      } else if (queAsegura === 'HOGAR') {
        interes = `Casa en ${comoSeEscribe(azar.elegir(sucursal.localidades).nombre)}`
      } else {
        interes = `${azar.elegir(['Kiosco', 'Peluquería', 'Almacén', 'Taller'])} en ${comoSeEscribe(azar.elegir(sucursal.localidades).nombre)}`
      }
      const procedencia: Record<string, string> = {
        REDES: azar.elegir(['Vino por Instagram', 'Escribió por Facebook', 'Vio la publicidad en Instagram']),
        RECOMENDADO: 'Lo recomendó un cliente',
        LOCAL: 'Se acercó al mostrador',
        WHATSAPP: '',
        OTRO: 'Llamó por teléfono',
      }
      const id = this.ids.de('lead', i, this.hoy)
      const notas = [procedencia[origen], ...(estado === 'NUEVO' && azar.si(0.5) ? [] : [azar.elegir(NOTAS_POR_ESTADO[estado])])].filter(Boolean)
      notas.forEach((texto, n) => this.comentario('LEAD', id, Math.min(this.hoy, dia + n * azar.entero(0, 3)), usuario, texto, `lead|${i}|${n}`, n))
      const telefono = this.telefono(azar)
      const documento = azar.si(0.35) ? String(this.nuevoDni(azar, this.hoyPartes.anio - azar.entero(20, 60))) : ''
      this.leads.push({ id, nombre, telefono, documento, sucursal, dia, estado, tipo, marca, modelo, anio, usuario, notas })
      filas.push({
        FECHA: isoDe(dia),
        LOCAL: sucursal.nombre,
        NOMBRE: nombre,
        TELEFONO: telefono,
        'DNI/CUIT': documento,
        ORIGEN: origen,
        'QUE ASEGURA': interes,
        TIPO: tipo,
        ESTADO: estado,
        NOTAS: notas.join(' · '),
        'CARGADO POR': usuario,
        _ID: id,
      })
    }
    return { titulo: 'APP LEADS', valores: armar(ENC_APP_LEADS, filas) }
  }

  /** Tres opciones de compañías distintas para un vehículo, con el precio de cada una. */
  private opcionesPara(azar: Azar, rama: Rama, anio: number, precioDelModelo: number): Array<{ c: string; b: string; p: string; n: string; monto: number }> {
    const antiguedad = this.hoyPartes.anio - anio
    const suma = redondear(precioDelModelo * 1_000_000 * Math.pow(0.92, antiguedad), 50_000)
    const cobertura = this.coberturaPara(azar, rama, antiguedad)
    const cias = azar.mezclar(COMPANIAS_POR_RAMA[rama]).slice(0, 3)
    return cias
      .map((nombre) => {
        const cia = compania(nombre)
        const monto = this.cuotaPara(azar, rama, cobertura, suma, cia)
        return { c: nombre, b: cobertura, p: pesos(monto), n: '', monto }
      })
      .sort((a, b) => a.monto - b.monto)
  }

  private pestanaPresupuestos(): PestanaDeLaDemo {
    const azar = new Azar('presupuestos')
    const ESTADO_POR_LEAD: Record<string, string> = { COTIZADO: 'ENVIADO', GANADO: 'ACEPTADO', PERDIDO: 'RECHAZADO' }
    type Pedido = { dia: number; nombre: string; telefono: string; documento: string; sucursal: SucursalDemo; usuario: string; rama: Rama; marca: string; modelo: string; anio: number; patente: string; estado: string; vinculo: string; precio: number; observaciones: string }
    const pedidos: Pedido[] = []
    for (const lead of this.leads) {
      const estado = ESTADO_POR_LEAD[lead.estado]
      if (!estado || !lead.tipo) continue
      const modelo = MODELOS.find((m) => m.marca === lead.marca && m.versiones.includes(lead.modelo))
      pedidos.push({
        dia: Math.min(this.hoy, lead.dia + azar.entero(0, 3)),
        nombre: lead.nombre,
        telefono: lead.telefono,
        documento: lead.documento,
        sucursal: lead.sucursal,
        usuario: lead.usuario,
        rama: lead.tipo as Rama,
        marca: lead.marca,
        modelo: lead.modelo,
        anio: lead.anio,
        patente: '',
        estado,
        vinculo: `LEAD:${lead.id}`,
        precio: modelo?.precio ?? 25,
        observaciones: lead.estado === 'PERDIDO' ? 'NO LE CERRO EL PRECIO' : '',
      })
    }
    // Y clientes de la cartera que piden pasar a una cobertura mejor.
    for (const p of azar.mezclar(this.vigentes((x) => (x.rama === 'AUTO' || x.rama === 'PICK UP') && x.cobertura !== TR)).slice(0, 7)) {
      pedidos.push({
        dia: this.hoy - azar.entero(0, 40),
        nombre: p.cliente.nombre,
        telefono: p.cliente.telefono,
        documento: p.cliente.documento,
        sucursal: p.cliente.sucursal,
        usuario: azar.elegir(p.cliente.sucursal.usuarios),
        rama: p.rama,
        marca: p.modelo.marca,
        modelo: p.version,
        anio: p.anio,
        patente: p.patente,
        estado: azar.pesado([['ENVIADO', 5], ['BORRADOR', 2], ['ACEPTADO', 1]]),
        vinculo: '',
        precio: p.modelo.precio,
        observaciones: 'CLIENTE DE LA CARTERA, QUIERE MEJORAR LA COBERTURA',
      })
    }
    pedidos.sort((a, b) => a.dia - b.dia)

    const filas: Fila[] = []
    pedidos.forEach((pedido, i) => {
      const numero = `P-${String(i + 1).padStart(4, '0')}`
      // Uno de cada cuatro tuvo una segunda versión: se recotizó con otra cobertura o compañía.
      const versiones = azar.si(0.25) && pedido.estado !== 'BORRADOR' ? 2 : 1
      for (let version = 1; version <= versiones; version++) {
        const opciones = this.opcionesPara(azar, pedido.rama, pedido.anio, pedido.precio)
        const dia = version === 1 ? pedido.dia : Math.min(this.hoy, pedido.dia + azar.entero(1, 4))
        const estado = version < versiones ? 'ENVIADO' : pedido.estado
        const id = this.ids.de('presupuesto', i, version, this.hoy)
        if (version === versiones) this.presupuestos.push({ id, numero, nombre: pedido.nombre, sucursal: pedido.sucursal, dia, estado, usuario: pedido.usuario })
        filas.push({
          FECHA: isoDe(dia),
          NUMERO: numero,
          VERSION: String(version),
          LOCAL: pedido.sucursal.nombre,
          NOMBRE: pedido.nombre,
          TELEFONO: pedido.telefono,
          'DNI/CUIT': pedido.documento,
          PATENTE: pedido.patente,
          MARCA: pedido.marca,
          MODELO: pedido.modelo,
          AÑO: String(pedido.anio),
          OPCIONES: opciones.map((o) => `${o.c} ${o.b} ${o.p}`).join(' · '),
          'PRECIO DESDE': opciones[0].p,
          ESTADO: estado,
          OBSERVACIONES: version > 1 ? 'SE RECOTIZO CON OTRA COBERTURA' : pedido.observaciones,
          'CARGADO POR': pedido.usuario,
          'VINCULO ID': pedido.vinculo,
          'OPCIONES JSON': JSON.stringify(opciones.map(({ c, b, p, n }) => ({ c, b, p, n }))),
          _ID: id,
        })
      }
    })
    return { titulo: 'APP PRESUPUESTOS', valores: armar(ENC_APP_PRESUPUESTOS, filas) }
  }

  private pestanaRechazos(): PestanaDeLaDemo {
    const azar = new Azar('rechazos')
    /** El primero de cada sucursal queda PENDIENTE aunque sea viejo: es el que enciende la campana del local. */
    const conAviso = new Set<SucursalDemo>()
    const filas = this.polizas
      .filter((p) => p.rechazoMes !== null)
      .map((p, i): Fila => {
        const primeroDelLocal = !conAviso.has(p.cliente.sucursal)
        conAviso.add(p.cliente.sucursal)
        const mes = p.rechazoMes ?? this.mesActual
        const dia = Math.min(this.hoy, vencimientoEn(mes, p.diaDeVencimiento) + azar.entero(2, 5))
        const motivo = p.formaPago === 'TARJETA' ? 'TARJETA RECHAZADA' : azar.elegir(['SIN FONDOS', 'CBU RECHAZADO', 'CUENTA CERRADA'])
        return {
          FECHA: isoDe(dia),
          LOCAL: p.cliente.sucursal.nombre,
          NOMBRE: p.cliente.nombre,
          'DNI/CUIT': p.cliente.documento,
          TELEFONO: p.cliente.telefono,
          COMPAÑIA: p.compania.nombre,
          POLIZA: p.numero,
          PATENTE: p.patente,
          'FORMA DE PAGO': p.formaPago,
          CUOTA: pesos(this.cuotaDelMes(p, mes)),
          MES: periodoDe(mes),
          MOTIVO: motivo,
          OBSERVACIONES: motivo === 'TARJETA RECHAZADA' ? 'Pedirle otra tarjeta' : 'Avisarle que pague en el local',
          ESTADO: primeroDelLocal || this.hoy - dia <= 6 ? 'PENDIENTE' : 'VISTO',
          // Lo carga alguien del mismo mostrador, que es quien ve el rebote en el resumen del banco.
          'CARGADO POR': azar.elegir(p.cliente.sucursal.usuarios),
          _ID: this.ids.de('rechazo', i, this.hoy),
        }
      })
    return { titulo: 'APP RECHAZOS', valores: armar(ENC_APP_RECHAZOS, filas) }
  }

  private pestanaTareas(): PestanaDeLaDemo {
    const azar = new Azar('tareas')
    const usuarios = USUARIOS_DE_LA_DEMO.map((u) => u.nombre)
    const sucursalDe = (nombre: string): NombreDeSucursal => (USUARIOS_DE_LA_DEMO.find((u) => u.nombre === nombre)?.sucursal ?? 'Dock Sud') as NombreDeSucursal
    type Pedido = { titulo: string; descripcion: string; responsable: string; vinculo: string; vinculoId: string; prioridad: string }
    const pedidos: Pedido[] = []
    const responsableDe = (sucursal: SucursalDemo) => azar.elegir(sucursal.usuarios)

    for (const s of this.siniestros.filter((x) => x.estado === 'ESPERANDO DOCUMENTACION' || x.estado === 'SIN RESPONDER').slice(0, 6)) {
      pedidos.push({
        titulo: s.estado === 'SIN RESPONDER' ? 'Conseguir el cuestionario del siniestro' : 'Reclamar documentación del siniestro',
        descripcion: s.estado === 'SIN RESPONDER' ? `Llamar a ${comoSeEscribe(s.poliza.cliente.nombre)} para cargar la denuncia` : s.observacion ? `${s.observacion.charAt(0)}${s.observacion.slice(1).toLowerCase()}` : 'Falta documentación del asegurado',
        responsable: responsableDe(s.poliza.cliente.sucursal),
        vinculo: `Siniestro ${s.numero || s.poliza.patente}`,
        vinculoId: `SINIESTRO:${s.id}`,
        prioridad: 'ALTA',
      })
    }
    for (const lead of this.leads.filter((l) => l.estado === 'NUEVO' || l.estado === 'EN CHARLA').slice(0, 7)) {
      pedidos.push({
        titulo: `Llamar a ${lead.nombre}`,
        descripcion: lead.tipo ? `Cotizar ${comoSeEscribe(lead.marca)} ${lead.anio}` : 'Consulta por seguro de hogar o comercio',
        responsable: lead.usuario,
        vinculo: `Consulta de ${lead.nombre}`,
        vinculoId: `LEAD:${lead.id}`,
        prioridad: azar.pesado([['NORMAL', 3], ['ALTA', 1]]),
      })
    }
    for (const presupuesto of this.presupuestos.filter((p) => p.estado === 'ENVIADO').slice(0, 5)) {
      pedidos.push({
        titulo: `Seguimiento del presupuesto ${presupuesto.numero}`,
        descripcion: 'Preguntar si lo vio y si tiene dudas',
        responsable: presupuesto.usuario,
        vinculo: `Presupuesto ${presupuesto.numero} · ${presupuesto.nombre}`,
        vinculoId: `PRESUPUESTO:${presupuesto.id}`,
        prioridad: 'NORMAL',
      })
    }
    const clavePoliza = (p: Poliza) => `POL:${normalizarTexto(p.compania.nombre)}|${normalizarNumeroPoliza(p.numero)}`
    for (const p of this.vigentes((x) => x.renovacionPendiente || (x.deudaDesde !== null && x.deudaDesde < this.mesActual)).slice(0, 7)) {
      pedidos.push({
        titulo: p.renovacionPendiente ? `Renovar póliza de ${comoSeEscribe(p.cliente.nombre)}` : `Cobrar cuotas atrasadas a ${comoSeEscribe(p.cliente.nombre)}`,
        descripcion: p.renovacionPendiente ? `${p.compania.nombre} renueva a mano: pedir la renovación y avisar el nuevo valor` : p.cliente.telefono,
        responsable: responsableDe(p.cliente.sucursal),
        vinculo: `Póliza ${p.compania.nombre} ${p.numero} · ${p.cliente.nombre}`,
        vinculoId: `POLIZA:${clavePoliza(p)}`,
        prioridad: p.renovacionPendiente ? 'ALTA' : 'NORMAL',
      })
    }
    for (const p of this.vigentes((x) => x.rechazoMes !== null).slice(0, 3)) {
      pedidos.push({
        titulo: 'Pedir nuevo medio de pago',
        descripcion: `Le rebotó el débito por ${p.formaPago}`,
        responsable: responsableDe(p.cliente.sucursal),
        vinculo: p.cliente.nombre,
        vinculoId: `CLIENTE:DOC:${p.cliente.clave}`,
        prioridad: 'NORMAL',
      })
    }
    const SUELTAS: Array<[string, string]> = [
      ['Ordenar cupones de RIO URUGUAY', 'Separar los del mes y llamar a los que no pasaron'],
      ['Mandar el resumen de caja de la semana', 'A Martina, por mail'],
      ['Rendición mensual con SANCOR', 'Controlar los imputados contra el listado de la compañía'],
      ['Reponer resmas y tóner', ''],
      ['Actualizar los precios de la vidriera', 'Con los valores nuevos de terceros completo'],
    ]
    for (const [titulo, descripcion] of SUELTAS) {
      pedidos.push({ titulo, descripcion, responsable: azar.elegir(usuarios), vinculo: '', vinculoId: '', prioridad: azar.pesado([['NORMAL', 3], ['BAJA', 2]]) })
    }

    // Que todos tengan algo: una tarea suelta más para quien haya quedado con menos de tres.
    for (const usuario of usuarios) {
      while (pedidos.filter((p) => p.responsable === usuario).length < 3) {
        pedidos.push({ titulo: 'Llamar a los clientes que vencen esta semana', descripcion: 'Los del semáforo amarillo', responsable: usuario, vinculo: '', vinculoId: '', prioridad: 'NORMAL' })
      }
    }

    const COMENTARIOS_DE_TAREA = ['Le dejé mensaje, no contesta', 'Ya le mandé el mail, espero respuesta', 'Mañana paso por la compañía', 'Hablado, queda para la semana que viene']
    const filas = pedidos.map((pedido, i): Fila => {
      // Las primeras vencidas y pendientes, después las de hoy, las que vienen y algunas hechas.
      const tipo = i % 6
      const dia = this.hoy - azar.entero(tipo === 0 ? 6 : 0, tipo === 0 ? 25 : 12)
      const vence =
        tipo === 0 ? this.hoy - azar.entero(1, 5) : tipo === 1 ? this.hoy : tipo === 2 ? this.hoy + 1 : this.hoy + azar.entero(1, 10)
      const estado = tipo === 5 || (tipo === 4 && azar.si(0.4)) ? 'Hecha' : tipo === 3 ? 'En curso' : 'Pendiente'
      const creador = azar.si(0.5) ? 'Martina Demo' : azar.elegir(usuarios)
      const id = this.ids.de('tarea', i, this.hoy)
      if (azar.si(0.35)) this.comentario('TAREA', id, Math.min(this.hoy, dia + azar.entero(0, 3)), pedido.responsable, azar.elegir(COMENTARIOS_DE_TAREA), `tarea|${i}`)
      return {
        FECHA: isoDe(Math.min(dia, vence)),
        TITULO: pedido.titulo,
        DESCRIPCION: pedido.descripcion,
        'ASIGNADO A': pedido.responsable,
        LOCAL: sucursalDe(pedido.responsable),
        VENCE: isoDe(vence),
        PRIORIDAD: pedido.prioridad,
        ESTADO: estado,
        VINCULO: pedido.vinculo,
        'CREADO POR': creador,
        'VINCULO ID': pedido.vinculoId,
        _ID: id,
      }
    })

    // La que Lucía le dejó a Martina por el siniestro de la Hilux («te quedó en Tareas con vencimiento el
    // viernes», en el chat de ejemplo de servidor.ts). Fija y sin azar: si el chat la promete, tiene que estar.
    const hilux = this.siniestros.find((s) => s.id === this.idDeLaHilux)
    if (hilux) {
      const diaDeLaSemana = (((this.hoy + 4) % 7) + 7) % 7
      const viernes = this.hoy + ((5 - diaDeLaSemana + 7) % 7 || 7)
      filas.push({
        FECHA: isoDe(this.hoy),
        TITULO: 'Seguir el siniestro de la Hilux con la compañía',
        DESCRIPCION: `Lo cargó Lucía con las fotos que mandó el asegurado. Pedir el número de siniestro a ${hilux.poliza.compania.nombre} y el turno con el perito.`,
        'ASIGNADO A': 'Martina Demo',
        LOCAL: sucursalDe('Martina Demo'),
        VENCE: isoDe(viernes),
        PRIORIDAD: 'ALTA',
        ESTADO: 'Pendiente',
        VINCULO: `Siniestro ${hilux.poliza.patente} · ${hilux.poliza.cliente.nombre}`,
        'CREADO POR': 'Lucía Gómez',
        'VINCULO ID': `SINIESTRO:${hilux.id}`,
        _ID: this.ids.de('tarea', 'hilux', this.hoy),
      })
    }

    // Los siniestros también tienen su línea de tiempo: todos, no unos pocos, porque la ficha que abra
    // quien mira la demo no puede decir «Todavía no hay observaciones». Una a tres, según cuánto anduvo el
    // trámite, en orden y nunca después de hoy.
    const DENUNCIA = 'Se cargó la denuncia en la web de la compañía'
    const LO_QUE_FALTA: Record<string, string> = {
      'FALTA REGISTRO DEL TERCERO': 'Falta el registro del tercero: se lo pedimos',
      'FALTA DENUNCIA POLICIAL': 'Falta la denuncia policial: se le avisó al asegurado',
      'FALTAN FOTOS DEL DAÑO': 'Faltan las fotos del daño: se las pedimos al asegurado',
      'FALTA PRESUPUESTO DEL TALLER': 'Falta el presupuesto del taller: se lo pedimos al asegurado',
    }
    // Los pasos cuentan lo mismo que la fila: sin perito en un robo ni en un reclamo de tercero, y sólo se
    // espera lo que de verdad falta.
    const pasosDe = (s: (typeof this.siniestros)[number]): string[] => {
      const propio = s.tipo === 'PROPIO'
      switch (s.estado) {
        case 'SIN RESPONDER':
          return ['Se le mandó el cuestionario por WhatsApp', 'No contesta: volver a llamar mañana']
        case 'CARGADO':
          return [DENUNCIA, `La compañía dio el número de siniestro ${s.numero}`]
        case 'EN TRAMITE':
          return propio
            ? [DENUNCIA, 'El perito pasa el jueves a la mañana', 'La compañía pidió el presupuesto del taller']
            : [DENUNCIA, s.tipo === 'ROBO' ? 'La compañía pidió la denuncia policial y la póliza' : 'La compañía pidió los datos del tercero', 'El caso está en análisis de la compañía']
        case 'ESPERANDO DOCUMENTACION':
          return [DENUNCIA, 'La compañía pidió documentación para seguir', LO_QUE_FALTA[s.observacion] ?? 'Falta documentación del asegurado: se la pedimos']
        default:
          if (s.observacion.startsWith('RECHAZADO')) {
            return [DENUNCIA, 'La compañía pidió la póliza y la documentación', 'La compañía lo rechazó por falta de cobertura: se le avisó al asegurado']
          }
          return [
            DENUNCIA,
            propio ? 'El perito aprobó la reparación' : s.tipo === 'ROBO' ? 'La compañía aprobó la denuncia policial' : 'La compañía aceptó el reclamo del tercero',
            'La compañía liquidó el siniestro: cerrado',
          ]
      }
    }
    this.siniestros.forEach((s, i) => {
      if (s === hilux) {
        this.comentario('SINIESTRO', s.id, this.hoy, 'Lucía Gómez', 'Cargué la denuncia con las fotos que mandó el asegurado por WhatsApp. Le pasé el seguimiento a Martina.', 'siniestro|hilux', 0, 10)
        return
      }
      const pasos = pasosDe(s)
      // Un CERRADO cuenta todo el trámite hasta el cierre (liquidación o rechazo); el resto, lo que lleva hecho.
      const cuantas = s.estado === 'CERRADO' ? pasos.length : Math.min(pasos.length, 1 + azar.entero(0, 2))
      // Arranca el día que se cargó la denuncia, no el del hecho.
      let dia = s.carga
      for (let n = 0; n < cuantas; n++) {
        if (n > 0) dia = Math.min(this.hoy, dia + azar.entero(1, 6))
        this.comentario('SINIESTRO', s.id, dia, azar.elegir(s.poliza.cliente.sucursal.usuarios), pasos[n]!, `siniestro|${i}|${n}`, n)
      }
    })
    return { titulo: 'APP TAREAS', valores: armar(ENC_APP_TAREAS, filas) }
  }

  private pestanaPagos(): PestanaDeLaDemo {
    const azar = new Azar('app-pagos')
    // El historial de los últimos meses (no sólo de los últimos días): la ficha del cliente y las
    // comisiones de Cobranzas leen de acá, y un cliente «Al día» tiene que mostrar sus cuotas pagadas.
    const mesDesde = Math.max(this.primerMes, this.mesActual - MESES_DE_PAGOS + 1)
    const tickets = new Map<string, number>()
    const ticket = (sucursal: SucursalDemo) => {
      const n = (tickets.get(sucursal.nombre) ?? azar.entero(3000, 9000)) + 1
      tickets.set(sucursal.nombre, n)
      return `000${SUCURSALES_DEMO.indexOf(sucursal) + 1}-${String(n).padStart(8, '0')}`
    }
    const cobros: Array<{ p: Poliza; mes: number; dia: number; imputado: boolean; mostrador: boolean }> = []
    // Las pólizas ya dadas de baja no: su cliente ya no está en la cartera y el cobro quedaría suelto.
    for (const p of this.vigentes()) {
      for (let mes = mesDesde; mes <= this.mesActual; mes++) {
        const pago = this.pagos.get(this.claveDeCuota(p, mes))
        if (pago && pago.dia <= this.hoy) cobros.push({ p, mes, dia: pago.dia, imputado: false, mostrador: pago.enElMostrador })
      }
      if (p.imputada) cobros.push({ p, mes: this.mesActual, dia: sinDomingo(Math.max(primerDiaDelMes(this.mesActual), this.hoy - azar.entero(0, 5))), imputado: true, mostrador: true })
    }
    cobros.sort((a, b) => a.dia - b.dia || a.p.indice - b.p.indice)

    const filas = cobros.map(({ p, mes, dia, imputado, mostrador }): Fila => {
      const sucursal = azar.si(0.08) ? azar.elegir(SUCURSALES_DEMO) : p.cliente.sucursal
      const medio =
        p.formaPago === 'EFECTIVO' ? (azar.si(0.15) ? 'TARJETA' : 'EFECTIVO') : p.formaPago === 'LOCAL' ? 'EFECTIVO' : p.formaPago
      const importe = this.cuotaDelMes(p, mes)
      const viejo = this.hoy - dia > 7
      // El débito automático y la cuponera no pasan por el mostrador: nadie los cobra ni les da ticket,
      // pero la plata entró y el cliente tiene que verla en su historial.
      const resultado = imputado
        ? 'IMPUTADO'
        : !mostrador || mes < this.mesActual
          ? // Los meses cerrados ya se rindieron: sin cobros pendientes de revisar de hace meses.
            azar.pesado([['OK', 9], ['IMPUTADO', 1]])
          : viejo
            ? azar.pesado([['OK', 5], ['IMPUTADO', 3], ['', 2]])
            : ''
      const fila: Fila = {
        FECHA: isoDe(dia),
        LOCAL: sucursal.nombre,
        NOMBRE: p.cliente.nombre,
        'DNI/CUIT': p.cliente.documento,
        COMPAÑIA: p.compania.nombre,
        POLIZA: p.numero,
        PATENTE: p.patente,
        IMPORTE: pesos(importe),
        'MEDIO DE PAGO': imputado ? 'TRANSFERENCIA' : medio,
        MES: nombreDelMes(mes),
        OBSERVACIONES: imputado ? 'Imputada a la compañía, el cliente transfiere a fin de mes' : '',
        RESULTADO: resultado,
        'COBRADO POR': mostrador ? azar.elegir(sucursal.usuarios) : '',
        COBRO: imputado ? 'IMPUTADO' : '',
        'NRO TICKET': !imputado && mostrador && (medio === 'EFECTIVO' || medio === 'TARJETA') && azar.si(0.7) ? ticket(sucursal) : '',
        'REVISIÓN DE PAGO': !imputado && mostrador && this.hoy - dia > 2 && azar.si(0.6) ? 'SI' : '',
        _ID: `PAGO:${this.idDeLaCuota(p, mes)}`,
      }
      this.filasDePagos.push({ fila, dia, sucursal, medio: fila['MEDIO DE PAGO'], importe, imputado })
      return fila
    })
    return { titulo: 'APP PAGOS', valores: armar(ENC_APP_PAGOS, filas) }
  }

  /**
   * La caja chica de cada mostrador en los últimos días hábiles: la apertura (el cierre del día
   * anterior), los gastos, lo que baja a la caja fuerte y el cierre contado. Cuadra con el efectivo
   * cobrado en APP PAGOS, salvo un par de días con una diferencia chica, que es lo que pasa.
   */
  private pestanaCaja(): PestanaDeLaDemo {
    const azar = new Azar('caja')
    const GASTOS: Array<[string, number, number]> = [
      ['Nafta para trámites', 8, 15],
      ['Librería y resmas', 4, 9],
      ['Artículos de limpieza', 3, 7],
      ['Café, yerba y azúcar', 3, 6],
      ['Envío de documentación a la compañía', 4, 8],
      ['Fotocopias', 1, 3],
      ['Cadete', 5, 10],
    ]
    const filas: Fila[] = []
    for (const sucursal of SUCURSALES_DEMO) {
      let apertura = azar.entero(50, 80) * 500
      for (let dia = this.hoy - 11; dia <= this.hoy; dia++) {
        if (esDomingo(dia)) continue
        const usuario = azar.elegir(sucursal.usuarios)
        const fecha = isoDe(dia)
        const fila = (tipo: string, detalle: string, importe: number, id: string): void => {
          filas.push({ FECHA: fecha, LOCAL: sucursal.nombre, TIPO: tipo, DETALLE: detalle, IMPORTE: String(importe), 'CARGADO POR': usuario, _ID: id })
        }
        const clave = claveDeSucursal(sucursal.nombre)
        fila('APERTURA', '', apertura, `CAJA:${fecha}:${clave}:APERTURA`)
        let gastos = 0
        const cuantos = azar.pesado([[0, 3], [1, 4], [2, 2]])
        for (let g = 0; g < cuantos; g++) {
          const [detalle, min, max] = azar.elegir(GASTOS)
          const importe = azar.entero(min * 2, max * 2) * 500
          gastos += importe
          fila('GASTO', detalle, importe, this.ids.de('caja', sucursal.nombre, dia - this.hoy, g, this.hoy))
        }
        if (azar.si(0.08)) fila('OBSERVACION', 'Se cobró con un billete roto, se cambió en el banco', 0, this.ids.de('caja-obs', sucursal.nombre, dia - this.hoy, this.hoy))
        const efectivo = this.filasDePagos
          .filter((p) => p.dia === dia && p.sucursal === sucursal && p.medio === 'EFECTIVO' && !p.imputado)
          .reduce((suma, p) => suma + p.importe, 0)
        let enElCajon = apertura + efectivo - gastos
        if (enElCajon > 60_000) {
          const aLaCajaFuerte = Math.floor((enElCajon - 30_000) / 10_000) * 10_000
          enElCajon -= aLaCajaFuerte
          fila('CAJA FUERTE', '', aLaCajaFuerte, this.ids.de('caja-fuerte', sucursal.nombre, dia - this.hoy, this.hoy))
        }
        // El día de hoy sigue abierto: todavía no se contó.
        if (dia === this.hoy) continue
        const diferencia = azar.si(0.1) ? azar.elegir([-500, -200, 300, 500]) : 0
        const contado = Math.max(0, enElCajon + diferencia)
        fila('CIERRE', diferencia === 0 ? '' : diferencia < 0 ? 'Faltante chico, se anotó' : 'Sobrante, se anotó', contado, `CAJA:${fecha}:${clave}:CIERRE`)
        apertura = contado
      }
    }
    return { titulo: 'APP CAJA', valores: armar(ENC_APP_CAJA, filas) }
  }

  /** La ficha propia de los clientes que alguien editó en el programa, y de los que sólo tienen riesgos varios. */
  private pestanaClientes(): PestanaDeLaDemo {
    const azar = new Azar('app-clientes')
    const editados = azar.mezclar(this.vigentes()).slice(0, 60).map((p) => p.cliente)
    const filas = [...editados, ...this.clientesSoloRiesgo].map((c): Fila => ({
      NOMBRE: c.nombre,
      'DNI/CUIT': c.documento,
      TELEFONO: c.telefono,
      EMAIL: c.email,
      DIRECCION: c.direccion,
      LOCALIDAD: c.localidad.nombre,
      PROVINCIA: 'BUENOS AIRES',
      'CODIGO POSTAL': c.localidad.codigoPostal,
      LOCAL: c.sucursal.nombre,
      'FECHA DE NACIMIENTO': c.nacimiento,
      _ID: this.ids.de('cliente', c.indice),
    }))
    return { titulo: 'APP CLIENTES', valores: armar(ENC_APP_CLIENTES, filas) }
  }

  // -------------------------------------------------------------------------
  // El catálogo maestro de vehículos
  // -------------------------------------------------------------------------

  private catalogoDeVehiculos(): Array<Record<string, unknown>> {
    const vehiculos: Array<Record<string, unknown>> = []
    let n = 0
    for (const modelo of MODELOS) {
      if (modelo.rama === 'TRAILER') continue
      const tipo = modelo.rama === 'MOTO' || modelo.rama === 'SCOOTER' || modelo.rama === 'MOTO ELÉCTRICA' ? 'MOTO' : 'AUTO'
      for (const version of modelo.versiones) {
        n++
        const anios: number[] = []
        for (let anio = modelo.desde; anio <= modelo.hasta; anio++) anios.push(anio)
        vehiculos.push({
          // Códigos con la forma de los de la tabla (siete cifras), inventados pero fijos.
          mtm: tipo === 'MOTO' ? `048${String(1000 + n * 37).padStart(4, '0')}` : `13${String(10000 + n * 211).padStart(5, '0')}`,
          tipo,
          origen: modelo.origen,
          marca: modelo.marca,
          modelo: modelo.modelo,
          version,
          carroceria: modelo.carroceria,
          anios,
          activo: true,
        })
      }
    }
    return vehiculos
  }
}

/**
 * Arma la grilla entera de la demo para ese día: las planillas de los últimos MESES_DE_LA_DEMO meses
 * con sus bajas, AMP, RIESGOS VARIOS, SINIESTROS, COBERTURA y las pestañas APP (sin APP ADJUNTOS: no
 * hay archivos), más el catálogo maestro de vehículos. Sólo mira el día de `hoy`, salvo la hora de los
 * comentarios de ese mismo día, que se cuentan hacia atrás desde ahí (para el mismo `hoy`, la misma salida).
 */
export function armarDatosDeLaDemo(hoy: Date): DatosDeLaDemo {
  return new GeneradorDeLaDemo(hoy).armar()
}
