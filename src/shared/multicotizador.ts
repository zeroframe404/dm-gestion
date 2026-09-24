// El multicotizador: una sola carga de datos, cotizada en todas las compañías que tengan API.
//
// Todo lo de acá es independiente de la compañía. Cada aseguradora tiene su propio adaptador en
// `main/multicotizador/` que traduce la solicitud común a lo que pide su API (sus códigos de vehículo,
// de localidad, de forma de pago…) y devuelve las coberturas en la forma común de abajo. Sumar una
// compañía es escribir su adaptador: ni esta forma ni la pantalla cambian.
//
// Es puro y compartido (main, precarga y renderer), como semaforo.ts: las reglas de comparación —en
// qué categoría cae cada cobertura, cuál es la más barata— se deciden igual en los dos lados.
import type { CoberturaCotizadaGaleno, TipoDeVehiculo } from './tipos'

// ---------------------------------------------------------------------------
// La solicitud: lo que cualquier compañía necesita para cotizar un auto o una moto
// ---------------------------------------------------------------------------

/** El identificador de una compañía en el multicotizador ('GALENO' hoy; mañana las que se sumen). */
export type IdAseguradora = string

export const MEDIOS_DE_PAGO = ['TARJETA', 'DEBITO', 'EFECTIVO'] as const
export type MedioDePago = (typeof MEDIOS_DE_PAGO)[number]

export const NOMBRE_MEDIO_DE_PAGO: Record<MedioDePago, string> = {
  TARJETA: 'Tarjeta de crédito',
  DEBITO: 'Débito automático (CBU)',
  EFECTIVO: 'Efectivo / cupón de pago',
}

export const USOS_DEL_VEHICULO = ['PARTICULAR', 'COMERCIAL'] as const
export type UsoDelVehiculo = (typeof USOS_DEL_VEHICULO)[number]

export const NOMBRE_USO_DEL_VEHICULO: Record<UsoDelVehiculo, string> = {
  PARTICULAR: 'Particular',
  COMERCIAL: 'Comercial',
}

export const TIPOS_DE_PERSONA = ['FISICA', 'JURIDICA'] as const
export type TipoDePersona = (typeof TIPOS_DE_PERSONA)[number]

export const NOMBRE_TIPO_DE_PERSONA: Record<TipoDePersona, string> = {
  FISICA: 'Persona física',
  JURIDICA: 'Persona jurídica (empresa)',
}

export const CONDICIONES_IVA = ['CONSUMIDOR_FINAL', 'MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO', 'EXENTO'] as const
export type CondicionIva = (typeof CONDICIONES_IVA)[number]

export const NOMBRE_CONDICION_IVA: Record<CondicionIva, string> = {
  CONSUMIDOR_FINAL: 'Consumidor final',
  MONOTRIBUTO: 'Monotributista',
  RESPONSABLE_INSCRIPTO: 'Responsable inscripto',
  EXENTO: 'Exento',
}

export interface VehiculoACotizar {
  tipo: TipoDeVehiculo
  marca: string
  modelo: string
  /** La versión (línea) tal como la nombra el catálogo de la agencia o como se escribió. */
  version: string
  anio: string
  /** El código del catálogo de la agencia (`AUTO:<id>`), vacío si se cargó a mano. */
  codigoCatalogo: string
  ceroKm: boolean
  uso: UsoDelVehiculo
  gnc: boolean
  /** El valor del equipo de GNC, en pesos. Null si no se sabe. */
  valorGnc: number | null
  rastreo: boolean
  /** Null = la que diga cada compañía para ese vehículo (casi siempre la de InfoAuto). */
  sumaAsegurada: number | null
}

export interface TomadorACotizar {
  nombre: string
  documento: string
  telefono: string
  tipoPersona: TipoDePersona
  condicionIva: CondicionIva
}

export interface SolicitudDeCotizacion {
  vehiculo: VehiculoACotizar
  tomador: TomadorACotizar
  codigoPostal: string
  /** El nombre de la localidad: desempata los códigos postales que abarcan más de una. */
  localidad: string
  /** aaaa-mm-dd. */
  vigenciaDesde: string
  medioDePago: MedioDePago
}

/**
 * Lo que la pantalla le manda al proceso principal para cotizar UNA compañía: la solicitud común más
 * lo que la persona haya elegido a mano en la tarjeta de esa compañía (el plan comercial, la versión en
 * su catálogo…). `elegidos` vacío = que la compañía decida sola con sus valores por defecto.
 */
export interface PedidoDeCotizacion {
  aseguradora: IdAseguradora
  solicitud: SolicitudDeCotizacion
  elegidos: Record<string, string>
}

// ---------------------------------------------------------------------------
// Las compañías
// ---------------------------------------------------------------------------

export interface AseguradoraDelMulticotizador {
  id: IdAseguradora
  nombre: string
  /** Qué tipos de vehículo cotiza su API. */
  tipos: TipoDeVehiculo[]
  /** true si una cobertura cotizada se puede emitir desde la aplicación. */
  emite: boolean
  /** Null = lista para cotizar. Si no, por qué no (sin credenciales, sin conexión con el servidor…). */
  noDisponible: string | null
}

/**
 * Una decisión propia de la compañía: cosas que sólo existen en SU API y que la solicitud común no
 * puede traer (el plan comercial de Galeno, su código de localidad, la versión del vehículo en su
 * catálogo…). La compañía elige sola un valor por defecto; la pantalla la muestra para poder cambiarla.
 * `valor` vacío con `obligatorio` = no pudo elegir sola y hay que elegirlo para poder cotizar.
 */
export interface AjusteDeAseguradora {
  campo: string
  titulo: string
  ayuda?: string
  opciones: Array<{ valor: string; texto: string }>
  valor: string
  obligatorio: boolean
  /**
   * El `campo` del ajuste del que depende: cambiar aquél invalida éste (el modelo depende de la marca;
   * las formas de pago, del modo de facturación). La pantalla lo usa para olvidar lo que se había
   * elegido a mano abajo cuando se cambia algo arriba.
   */
  dependeDe?: string
  /**
   * true si la elección sólo vale para ESTE vehículo o ESTE código postal (la versión en el catálogo de
   * la compañía, su código de localidad): la pantalla la olvida al cotizar otro vehículo u otra zona.
   * Lo demás —el plan comercial, la forma de pago— se conserva entre cotizaciones.
   */
  porSolicitud?: boolean
}

/**
 * Lo que queda elegido a mano después de cambiar `campo`: el nuevo valor, y sin nada de lo que dependía
 * de él (directa o indirectamente), que la compañía vuelve a decidir sola con el valor nuevo.
 */
export function elegirAjuste(
  elegidos: Record<string, string>,
  ajustes: AjusteDeAseguradora[],
  campo: string,
  valor: string,
): Record<string, string> {
  const siguientes = { ...elegidos, [campo]: valor }
  const aBorrar = new Set<string>([campo])
  let cambio = true
  while (cambio) {
    cambio = false
    for (const ajuste of ajustes) {
      if (ajuste.dependeDe && aBorrar.has(ajuste.dependeDe) && !aBorrar.has(ajuste.campo)) {
        aBorrar.add(ajuste.campo)
        delete siguientes[ajuste.campo]
        cambio = true
      }
    }
  }
  return siguientes
}

// ---------------------------------------------------------------------------
// El resultado
// ---------------------------------------------------------------------------

/**
 * Las categorías con las que se comparan coberturas de compañías distintas. Cada compañía llama a las
 * suyas como quiere («C1», «Terceros Completo Plus», «Todo Riesgo F.$150.000»): sin una categoría común
 * no hay forma de decir cuál es la más barata «del mismo tipo». Son los escalones de siempre del
 * mercado argentino, de menos a más cubierto.
 */
export const CATEGORIAS_DE_COBERTURA = ['RC', 'TERCEROS_BASICO', 'TERCEROS_COMPLETO', 'TERCEROS_PREMIUM', 'TODO_RIESGO', 'OTRA'] as const
export type CategoriaDeCobertura = (typeof CATEGORIAS_DE_COBERTURA)[number]

export const NOMBRE_CATEGORIA_DE_COBERTURA: Record<CategoriaDeCobertura, string> = {
  RC: 'Responsabilidad civil',
  TERCEROS_BASICO: 'Terceros (pérdida total)',
  TERCEROS_COMPLETO: 'Terceros completo',
  TERCEROS_PREMIUM: 'Terceros completo premium',
  TODO_RIESGO: 'Todo riesgo',
  OTRA: 'Otras',
}

export const DETALLE_CATEGORIA_DE_COBERTURA: Record<CategoriaDeCobertura, string> = {
  RC: 'Sólo los daños a terceros. Es el mínimo obligatorio.',
  TERCEROS_BASICO: 'Terceros más robo, incendio o destrucción TOTAL del vehículo.',
  TERCEROS_COMPLETO: 'Suma robo e incendio PARCIAL, cristales y cerraduras.',
  TERCEROS_PREMIUM: 'Terceros completo con granizo u otros adicionales de gama alta.',
  TODO_RIESGO: 'Cubre también los daños propios por choque, con o sin franquicia.',
  OTRA: 'Lo que la compañía no nombra de una forma reconocible.',
}

/** Lo que hace falta para emitir después, desde la aplicación, una cobertura de Galeno. */
export interface EmisionPosibleGaleno {
  tipo: 'GALENO'
  rama: number
  solicitud: number
  instalacion: number
  cobertura: CoberturaCotizadaGaleno
  codigoPostal: string
  subCodigoPostal: string
}

/** Por ahora sólo Galeno emite desde la app: cada compañía que sume emisión agrega su variante acá. */
export type EmisionPosible = EmisionPosibleGaleno

export interface CoberturaCotizada {
  aseguradora: IdAseguradora
  nombreAseguradora: string
  /** El código de la cobertura en la compañía. Junto con `aseguradora` la identifica. */
  codigo: string
  nombre: string
  categoria: CategoriaDeCobertura
  /** Lo que paga el cliente por toda la vigencia, impuestos incluidos. */
  premio: number
  prima: number
  primeraCuota: number | null
  /** El importe de cada una de las cuotas siguientes. */
  cuota: number | null
  franquicia: string
  adicionales: string[]
  /** Null para quien no ve los números de la agencia. */
  comision: number | null
  emision: EmisionPosible | null
}

export const ESTADOS_DE_COTIZACION = ['OK', 'FALTAN_DATOS', 'ERROR', 'NO_APLICA'] as const
export type EstadoDeCotizacion = (typeof ESTADOS_DE_COTIZACION)[number]

export interface ResultadoDeAseguradora {
  aseguradora: IdAseguradora
  nombre: string
  estado: EstadoDeCotizacion
  /** El error, lo que falta, o por qué no aplica. Null cuando cotizó bien. */
  mensaje: string | null
  /** Cómo entendió la compañía el vehículo (su propia descripción). */
  descripcionVehiculo: string
  coberturas: CoberturaCotizada[]
  /** Observaciones de la compañía que no impiden cotizar (inspección previa, suma fuera de rango…). */
  avisos: string[]
  /** Todas las decisiones propias de la compañía que se usaron, con sus opciones, para poder cambiarlas. */
  ajustes: AjusteDeAseguradora[]
  duracionMs: number
}

// ---------------------------------------------------------------------------
// Las reglas de comparación
// ---------------------------------------------------------------------------

/** Mayúsculas, sin tildes ni signos: «Todo Riesgo c/Franq.» y «TODO RIESGO C FRANQ» son lo mismo. */
export function normalizarTexto(valor: string): string {
  return valor
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

const ES_PREMIUM = /\b(GRANIZO|PREMIUM|PLUS|FULL|MAX|MAXI|ORO|GOLD|PLATINO|PLATINUM|SUPERIOR|ELITE|TOP|VIP)\b/

/**
 * En qué categoría cae una cobertura, leyendo cómo la nombra la compañía. Primero el nombre —es lo que
 * de verdad dice qué cubre— y recién si no dice nada reconocible, la letra del código, que en casi
 * todas las compañías argentinas sigue la escala de siempre (A responsabilidad civil, B pérdida total,
 * C terceros completo, D todo riesgo).
 */
export function categoriaDeCobertura(nombre: string, codigo = ''): CategoriaDeCobertura {
  const texto = normalizarTexto(nombre)

  if (/\bTODO RIESGO\b|\bTODO RIESGOS\b|\bT R\b|\bDANOS? PARCIAL(ES)? POR ACCIDENTE\b|\bFRANQUICIA\b|\bFRANQ\b/.test(texto)) return 'TODO_RIESGO'

  const completo = /\bTERCEROS? COMPLETOS?\b|\bTERC COMPL\b|\bTERCEROS? COMP\b|\bROBO (E|Y) INCENDIO PARCIAL\b|\bPARCIAL(ES)?\b|\bCRISTALES\b|\bCERRADURAS?\b/.test(texto)
  if (completo) return ES_PREMIUM.test(texto) ? 'TERCEROS_PREMIUM' : 'TERCEROS_COMPLETO'

  if (/\bPERDIDA TOTAL\b|\bDESTRUCCION TOTAL\b|\bINCENDIO TOTAL\b|\bROBO TOTAL\b|\bROBO (E|Y) INCENDIO\b/.test(texto)) return 'TERCEROS_BASICO'

  // Antes que «terceros» suelto: «Responsabilidad civil hacia terceros» es sólo RC.
  if (/\bRESPONSABILIDAD CIVIL\b|\bRESP CIV(IL)?\b|\bR C\b|\bRC\b/.test(texto)) return 'RC'

  if (/\bTERCEROS?\b/.test(texto)) return 'TERCEROS_BASICO'

  const letra = normalizarTexto(codigo).charAt(0)
  if (letra === 'A') return 'RC'
  if (letra === 'B') return 'TERCEROS_BASICO'
  if (letra === 'C') return ES_PREMIUM.test(texto) ? 'TERCEROS_PREMIUM' : 'TERCEROS_COMPLETO'
  if (letra === 'D') return 'TODO_RIESGO'
  return 'OTRA'
}

/** El orden de las categorías en pantalla: de menos a más cubierto, y «Otras» al final. */
export function ordenDeCategoria(categoria: CategoriaDeCobertura): number {
  return CATEGORIAS_DE_COBERTURA.indexOf(categoria)
}

/** La clave de una cobertura en toda la comparación: compañía + código. */
export function claveDeCobertura(cobertura: Pick<CoberturaCotizada, 'aseguradora' | 'codigo'>): string {
  return `${cobertura.aseguradora}:${cobertura.codigo}`
}

/**
 * Todas las coberturas de todas las compañías, ordenadas por categoría y, dentro de cada una, de la
 * más barata a la más cara. Las que vienen con premio 0 (la compañía no la cotizó para este vehículo)
 * van al final de su categoría: no son «la más barata».
 */
export function coberturasOrdenadas(resultados: ResultadoDeAseguradora[]): CoberturaCotizada[] {
  return resultados
    .flatMap((resultado) => resultado.coberturas)
    .sort((a, b) => {
      const porCategoria = ordenDeCategoria(a.categoria) - ordenDeCategoria(b.categoria)
      if (porCategoria !== 0) return porCategoria
      const aSinPrecio = a.premio <= 0
      const bSinPrecio = b.premio <= 0
      if (aSinPrecio !== bSinPrecio) return aSinPrecio ? 1 : -1
      return a.premio - b.premio
    })
}

/** La cobertura más barata de cada categoría, entre todas las compañías. Sólo las que tienen precio. */
export function mejoresPorCategoria(resultados: ResultadoDeAseguradora[]): Map<CategoriaDeCobertura, CoberturaCotizada> {
  const mejores = new Map<CategoriaDeCobertura, CoberturaCotizada>()
  for (const cobertura of resultados.flatMap((resultado) => resultado.coberturas)) {
    if (cobertura.premio <= 0) continue
    const actual = mejores.get(cobertura.categoria)
    if (!actual || cobertura.premio < actual.premio) mejores.set(cobertura.categoria, cobertura)
  }
  return mejores
}

/** «$ 123.456,78», como en el resto de la aplicación. */
export function enPesos(monto: number): string {
  return `$ ${monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** El máximo de opciones que acepta un presupuesto (ver `validarOpciones` en servicios/presupuestos.ts). */
export const MAXIMO_OPCIONES_POR_PRESUPUESTO = 12
