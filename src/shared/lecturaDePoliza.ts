// Alta de cliente desde el PDF de la póliza: lo que la IA lee, cómo se interpreta y cómo llega al formulario.
//
// Todo lo de acá es puro (sin base, sin red, sin Electron) para poder probarlo: la llamada a la IA vive en
// `main/servicios/lecturaDePoliza.ts` y el alta en `main/servicios/altaDesdePoliza.ts`.
//
// Tres reglas que ordenan el archivo:
//
// 1. LA IA NO MANDA. Lo que devuelve es texto no confiable: `interpretarLectura` se queda solamente con las
//    claves del esquema, recorta cada campo y ante cualquier duda deja `null`. Nada de lo leído se guarda
//    sin pasar por la pantalla y por los validadores de siempre.
// 2. LO QUE NO ESTÁ, NO SE INVENTA. Un dato que el PDF no trae queda vacío y no figura como «leído»: es lo
//    que después se le pide a la persona.
// 3. SE ESCRIBE COMO ESCRIBE LA AGENCIA. En la hoja los clientes son `APELLIDO NOMBRES` en mayúsculas, y
//    la compañía, la marca y el modelo van en mayúsculas con el nombre del catálogo.
import { DIRECCION_VACIA, textoDeDireccion, type DireccionEstructurada } from './direccion'
import type { DatosDeCliente, FichaCliente, FilaCliente } from './tipos'

/** El PDF más grande que se manda a leer. La API acepta hasta 32 MB por pedido y el base64 pesa un tercio más. */
export const MAXIMO_DEL_PDF_EN_BYTES = 20 * 1024 * 1024
const LARGO_MAXIMO_DE_UN_CAMPO = 200

// ---------------------------------------------------------------------------
// Lo que devuelve la IA
// ---------------------------------------------------------------------------

type Texto = string | null

export interface LecturaDePoliza {
  esPolizaDeAuto: boolean
  /** Cuántos vehículos trae el PDF. Con más de uno (flotas) se carga a mano. */
  cantidadDeVehiculos: number
  /** El nombre del tomador cuando es otra persona distinta del asegurado. */
  tomadorDistinto: Texto
  asegurado: { apellido: Texto; nombres: Texto; documento: Texto; telefono: Texto; email: Texto }
  domicilio: { calle: Texto; altura: Texto; localidad: Texto; provincia: Texto; codigoPostal: Texto }
  vehiculo: { patente: Texto; marca: Texto; modelo: Texto; anio: Texto; motor: Texto; chasis: Texto; uso: Texto; color: Texto }
  poliza: { compania: Texto; numero: Texto; propuesta: Texto; cobertura: Texto; vigenciaDesde: Texto; vigenciaHasta: Texto; formaPago: Texto; cuota: Texto }
}

const CAMPOS_DEL_ASEGURADO = ['apellido', 'nombres', 'documento', 'telefono', 'email'] as const
const CAMPOS_DEL_DOMICILIO = ['calle', 'altura', 'localidad', 'provincia', 'codigoPostal'] as const
const CAMPOS_DEL_VEHICULO = ['patente', 'marca', 'modelo', 'anio', 'motor', 'chasis', 'uso', 'color'] as const
const CAMPOS_DE_LA_POLIZA = ['compania', 'numero', 'propuesta', 'cobertura', 'vigenciaDesde', 'vigenciaHasta', 'formaPago', 'cuota'] as const

const TEXTO_O_NULO = { anyOf: [{ type: 'string' }, { type: 'null' }] }

function objetoDelEsquema(campos: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [...campos],
    properties: Object.fromEntries(campos.map((campo) => [campo, TEXTO_O_NULO])),
  }
}

/** El formato fijo en el que se le pide la respuesta a la IA (salida estructurada). */
export const ESQUEMA_DE_LECTURA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['esPolizaDeAuto', 'cantidadDeVehiculos', 'tomadorDistinto', 'asegurado', 'domicilio', 'vehiculo', 'poliza'],
  properties: {
    esPolizaDeAuto: { type: 'boolean' },
    cantidadDeVehiculos: { type: 'integer' },
    tomadorDistinto: TEXTO_O_NULO,
    asegurado: objetoDelEsquema(CAMPOS_DEL_ASEGURADO),
    domicilio: objetoDelEsquema(CAMPOS_DEL_DOMICILIO),
    vehiculo: objetoDelEsquema(CAMPOS_DEL_VEHICULO),
    poliza: objetoDelEsquema(CAMPOS_DE_LA_POLIZA),
  },
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null
}

/** Un campo de texto de la IA: sin espacios de más, con tope de largo, y `null` si no quedó nada. */
function textoLimpio(valor: unknown): Texto {
  const crudo = typeof valor === 'string' ? valor : typeof valor === 'number' && Number.isFinite(valor) ? String(valor) : ''
  const limpio = crudo.replace(/\s+/g, ' ').trim().slice(0, LARGO_MAXIMO_DE_UN_CAMPO).trim()
  return limpio === '' ? null : limpio
}

function grupo<C extends string>(bruto: unknown, campos: readonly C[]): Record<C, Texto> {
  const origen = comoObjeto(bruto) ?? {}
  return Object.fromEntries(campos.map((campo) => [campo, textoLimpio(origen[campo])])) as Record<C, Texto>
}

/**
 * Lo que devolvió la IA, reducido a lo que se espera. `null` si ni siquiera es un objeto.
 * Las claves que no están en el esquema se descartan: lo que venga dentro del PDF no puede agregar nada.
 */
export function interpretarLectura(bruto: unknown): LecturaDePoliza | null {
  const origen = comoObjeto(bruto)
  if (!origen) return null
  const cantidad = typeof origen.cantidadDeVehiculos === 'number' && Number.isFinite(origen.cantidadDeVehiculos) ? Math.trunc(origen.cantidadDeVehiculos) : 0
  return {
    esPolizaDeAuto: origen.esPolizaDeAuto === true,
    cantidadDeVehiculos: Math.max(0, cantidad),
    tomadorDistinto: textoLimpio(origen.tomadorDistinto),
    asegurado: grupo(origen.asegurado, CAMPOS_DEL_ASEGURADO),
    domicilio: grupo(origen.domicilio, CAMPOS_DEL_DOMICILIO),
    vehiculo: grupo(origen.vehiculo, CAMPOS_DEL_VEHICULO),
    poliza: grupo(origen.poliza, CAMPOS_DE_LA_POLIZA),
  }
}

// ---------------------------------------------------------------------------
// Normalizar lo leído
// ---------------------------------------------------------------------------

/** Sin tildes, sin puntuación, en minúsculas y con un solo espacio entre palabras. */
function comparable(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Lleva un nombre leído al que ya usa la agencia, si se parece de verdad.
 *  - `exacto`: es el mismo texto (sin tildes ni mayúsculas). Para coberturas y formas de pago, donde achicar
 *    «TODO RIESGO CON FRANQUICIA» a «TODO RIESGO» perdería información.
 *  - `contiene`: alcanza con que el nombre del catálogo esté dentro de lo leído («SANCOR COOPERATIVA DE
 *    SEGUROS LTDA» es SANCOR). Si hay más de una candidata gana la más larga; si empatan, no se toca.
 * Sin parecido, devuelve lo leído tal cual.
 */
export function ajustarACatalogo(valor: string, catalogo: readonly string[], modo: 'exacto' | 'contiene'): string {
  const buscado = comparable(valor)
  if (buscado === '') return valor
  const igual = catalogo.find((entrada) => comparable(entrada) === buscado)
  if (igual !== undefined) return igual
  if (modo === 'exacto') return valor

  const candidatas = catalogo.filter((entrada) => {
    const clave = comparable(entrada)
    return clave.length >= 3 && ` ${buscado} `.includes(` ${clave} `)
  })
  if (candidatas.length === 0) return valor
  const largo = Math.max(...candidatas.map((entrada) => comparable(entrada).length))
  const ganadoras = candidatas.filter((entrada) => comparable(entrada).length === largo)
  return ganadoras.length === 1 ? (ganadoras[0] as string) : valor
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate()
}

/** Una vigencia a `dd/mm/aaaa` (el formato de la planilla). Una fecha que no existe queda vacía. */
export function normalizarFechaDeVigencia(valor: string | null): string {
  if (valor === null) return ''
  const texto = valor.trim()
  let anio: number
  let mes: number
  let dia: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(texto)
  const local = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(texto)
  if (iso) {
    anio = Number(iso[1])
    mes = Number(iso[2])
    dia = Number(iso[3])
  } else if (local) {
    dia = Number(local[1])
    mes = Number(local[2])
    anio = Number(local[3])
    if ((local[3] as string).length === 2) anio += 2000
  } else {
    return ''
  }
  if (anio < 1990 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > diasDelMes(anio, mes)) return ''
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`
}

function mayusculas(valor: Texto): string {
  return valor === null ? '' : valor.toLocaleUpperCase('es-AR')
}

function patenteLimpia(valor: Texto): string {
  return valor === null ? '' : valor.toLocaleUpperCase('es-AR').replace(/[\s-]+/g, '')
}

/** El año del modelo: cuatro dígitos de 19xx o 20xx. Si no aparece, vacío (no se adivina). */
function anioLimpio(valor: Texto): string {
  const coincidencia = valor === null ? null : /(?:19|20)\d{2}/.exec(valor)
  return coincidencia ? coincidencia[0] : ''
}

function nombreDeLaAgencia(apellido: Texto, nombres: Texto): string {
  return [apellido, nombres]
    .filter((parte): parte is string => parte !== null)
    .join(' ')
    .toLocaleUpperCase('es-AR')
}

// ---------------------------------------------------------------------------
// De lo leído al formulario
// ---------------------------------------------------------------------------

export interface VehiculoDeAlta {
  patente: string
  marca: string
  modelo: string
  anio: string
  motor: string
  chasis: string
  uso: string
  color: string
}

export interface PolizaDeAlta {
  compania: string
  numero: string
  propuesta: string
  cobertura: string
  vigenciaDesde: string
  vigenciaHasta: string
  formaPago: string
  cuota: string
  observaciones: string
}

export interface CatalogosParaAjustar {
  companias: string[]
  coberturas: string[]
  formasDePago: string[]
}

export interface PolizaLeida {
  cliente: DatosDeCliente
  vehiculo: VehiculoDeAlta
  poliza: PolizaDeAlta
  /** Qué campos vinieron del PDF, con la forma `cliente.nombre`, `vehiculo.chasis`, `poliza.vigenciaDesde`. */
  leidos: string[]
  /** Avisos para mostrar arriba del formulario. */
  avisos: string[]
  /** El cliente que ya tiene ese DNI, si lo hay. Lo completa el proceso principal. */
  clienteExistente: FilaCliente | null
}

export function polizaLeida(lectura: LecturaDePoliza, catalogos: CatalogosParaAjustar): PolizaLeida {
  const detalle: DireccionEstructurada = {
    ...DIRECCION_VACIA,
    calle: lectura.domicilio.calle ?? '',
    altura: lectura.domicilio.altura ?? '',
    localidad: lectura.domicilio.localidad ?? '',
    provincia: lectura.domicilio.provincia ?? '',
    codigoPostal: lectura.domicilio.codigoPostal ?? '',
  }
  const conCalle = detalle.calle !== ''
  const cliente: DatosDeCliente = {
    nombre: nombreDeLaAgencia(lectura.asegurado.apellido, lectura.asegurado.nombres),
    documento: lectura.asegurado.documento ?? '',
    telefono: lectura.asegurado.telefono ?? '',
    email: lectura.asegurado.email ?? '',
    direccion: conCalle ? textoDeDireccion(detalle) : '',
    localidad: detalle.localidad,
    sucursal: '',
    fechaNacimiento: '',
    profesion: '',
    direccionDetalle: detalle,
  }
  const vehiculo: VehiculoDeAlta = {
    patente: patenteLimpia(lectura.vehiculo.patente),
    marca: mayusculas(lectura.vehiculo.marca),
    modelo: mayusculas(lectura.vehiculo.modelo),
    anio: anioLimpio(lectura.vehiculo.anio),
    motor: lectura.vehiculo.motor ?? '',
    chasis: lectura.vehiculo.chasis ?? '',
    uso: lectura.vehiculo.uso ?? '',
    color: lectura.vehiculo.color ?? '',
  }
  const compania = lectura.poliza.compania
  const cobertura = lectura.poliza.cobertura
  const formaPago = lectura.poliza.formaPago
  const poliza: PolizaDeAlta = {
    compania: compania === null ? '' : mayusculas(ajustarACatalogo(compania, catalogos.companias, 'contiene')),
    numero: lectura.poliza.numero ?? '',
    propuesta: lectura.poliza.propuesta ?? '',
    cobertura: cobertura === null ? '' : mayusculas(ajustarACatalogo(cobertura, catalogos.coberturas, 'exacto')),
    vigenciaDesde: normalizarFechaDeVigencia(lectura.poliza.vigenciaDesde),
    vigenciaHasta: normalizarFechaDeVigencia(lectura.poliza.vigenciaHasta),
    formaPago: formaPago === null ? '' : ajustarACatalogo(formaPago, catalogos.formasDePago, 'exacto'),
    cuota: lectura.poliza.cuota ?? '',
    observaciones: '',
  }

  const leidos: string[] = []
  const anotar = (prefijo: string, grupoLeido: object) => {
    for (const [campo, valor] of Object.entries(grupoLeido)) {
      if (typeof valor === 'string' && valor !== '') leidos.push(`${prefijo}.${campo}`)
    }
  }
  anotar('cliente', { nombre: cliente.nombre, documento: cliente.documento, telefono: cliente.telefono, email: cliente.email, direccion: cliente.direccion, localidad: cliente.localidad })
  anotar('vehiculo', vehiculo)
  anotar('poliza', poliza)

  const avisos: string[] = []
  if (lectura.tomadorDistinto !== null) {
    avisos.push(`En el PDF el tomador es «${lectura.tomadorDistinto}», distinto del asegurado. Se cargó el asegurado: revisá que sea quien corresponde.`)
  }
  return { cliente, vehiculo, poliza, leidos, avisos, clienteExistente: null }
}

// ---------------------------------------------------------------------------
// Comparar nombres y qué falta
// ---------------------------------------------------------------------------

const PALABRAS_SUELTAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])

function palabrasDelNombre(nombre: string): Set<string> {
  return new Set(comparable(nombre).split(' ').filter((palabra) => palabra.length > 1 && !PALABRAS_SUELTAS.has(palabra)))
}

/**
 * ¿Es razonable que sean la misma persona? Se comparan palabras sueltas (el orden, las tildes y las
 * mayúsculas no cuentan) y hace falta coincidir en dos, o en todas si alguno tiene una sola. Sirve para
 * avisar cuando el DNI leído es de otro nombre: un DNI mal leído no tiene que terminar agregándole la
 * póliza a la persona equivocada. Sin nada para comparar no se avisa.
 */
export function nombresParecidos(a: string, b: string): boolean {
  const palabrasA = palabrasDelNombre(a)
  const palabrasB = palabrasDelNombre(b)
  if (palabrasA.size === 0 || palabrasB.size === 0) return true
  let comunes = 0
  for (const palabra of palabrasA) if (palabrasB.has(palabra)) comunes++
  return comunes >= Math.min(2, palabrasA.size, palabrasB.size)
}

const vacio = (valor: string) => valor.trim() === ''

/**
 * Lo que todavía falta para poder crear (con etiquetas para mostrar). Con cliente existente no se piden
 * los datos del cliente: ya los tiene y la póliza nueva no los toca.
 */
export function faltantesDelAlta(entrada: { clienteExistente: boolean; cliente: DatosDeCliente; vehiculo: VehiculoDeAlta; poliza: PolizaDeAlta }): string[] {
  const { clienteExistente, cliente, vehiculo, poliza } = entrada
  const faltan: string[] = []
  if (!clienteExistente) {
    if (vacio(cliente.nombre)) faltan.push('Nombre y apellido')
    if (vacio(cliente.documento)) faltan.push('DNI/CUIT')
    if (vacio(cliente.telefono)) faltan.push('Celular')
    if (vacio(cliente.email)) faltan.push('Email')
  }
  if (vacio(poliza.formaPago)) faltan.push('Forma de pago')
  if (vacio(poliza.compania)) faltan.push('Compañía')
  if (vacio(poliza.numero) && vacio(poliza.propuesta)) faltan.push('Número de póliza (o de propuesta)')
  if (vacio(poliza.cobertura)) faltan.push('Cobertura')
  if (vacio(vehiculo.patente) && (vacio(vehiculo.marca) || vacio(vehiculo.modelo))) faltan.push('Patente (o marca y modelo)')
  return faltan
}

// ---------------------------------------------------------------------------
// El alta combinada
// ---------------------------------------------------------------------------

export interface DatosDeAltaDesdePoliza {
  /** El cliente al que se le agrega la póliza, si ya existía. null = cliente nuevo. */
  clienteExistenteId: number | null
  /** Los datos del cliente nuevo. Con `clienteExistenteId` no se usan ni se tocan. */
  cliente: DatosDeCliente
  vehiculo: VehiculoDeAlta
  poliza: PolizaDeAlta
  /** Se siguió pese al aviso de antigüedad de la cobertura (lo puede confirmar solo un administrador). */
  confirmadoPeseAlAviso: boolean
  /** Se reusa una patente que otro cliente dio de baja. */
  confirmadoPatenteDeBaja: boolean
  /** El PDF que se leyó: queda como adjunto de la póliza. */
  adjunto: { nombre: string; contenido: Uint8Array } | null
}

export type ResultadoDeAltaDesdePoliza =
  | { creado: true; cliente: FichaCliente; polizaId: number; adjuntoGuardado: boolean }
  | { creado: false; yaExiste: FilaCliente; motivo: string }
