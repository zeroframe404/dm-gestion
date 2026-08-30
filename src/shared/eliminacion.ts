// Borrado definitivo y puntual de un registro: el botón de la papelera.
//
// Es del SUPER_ADMIN y de nadie más. No es un permiso configurable a propósito —igual que
// `veLosNumerosDeLaAgencia` en permisos.ts—: si se pudiera encender desde una pantalla, alcanzaría con
// que alguien se distraiga una vez y la agencia se quedaría sin el cliente, sus pólizas y sus pagos, y
// sin nadie a quien reclamárselos. Un ADMIN sigue teniendo todo lo demás: dar de baja, deshacer, poner
// vigente, corregir. Lo que no tiene es la papelera.
//
// «Puntual» es la palabra que importa: se borra UN registro elegido a mano, con su nombre delante y
// después de leer todo lo que se lleva puesto. No hay borrado en lote y no lo va a haber.
//
// Es puro y compartido (main, precarga y renderer) como permisos.ts: el proceso principal lo usa para
// aceptar o rechazar el llamado y el renderer, para dibujar el botón. El que manda es el proceso
// principal; el renderer sólo evita ofrecer un botón que después va a fallar.

/**
 * Qué se puede borrar. El orden es el de la barra lateral, para que la lista se lea como el programa.
 *
 * No están: usuarios (se desactivan, que es lo correcto: su nombre queda en el historial y en cada pago
 * que cobraron), compañías, sucursales, reglas de cobertura ni plantillas —ésas ya tienen su propio
 * borrado, con sus propias reglas— ni nada del catálogo de vehículos, que se vuelve a bajar solo.
 */
export const TIPOS_ELIMINABLES = [
  'cliente',
  'poliza',
  'cuota',
  'baja',
  'rechazo',
  'lead',
  'presupuesto',
  'siniestro',
  'riesgo',
  'amp',
  'tarea',
] as const

export type TipoEliminable = (typeof TIPOS_ELIMINABLES)[number]

/**
 * Cuántos segundos hay que esperar con el cartel abierto antes de que se habilite el botón de borrar.
 *
 * No es una traba: son los cinco segundos que separan «me equivoqué de fila» de «esto lo quise borrar».
 * El cartel dice mientras tanto qué se lleva puesto el borrado, que es lo que hay que leer en ese rato.
 */
export const SEGUNDOS_PARA_CONFIRMAR = 5

export interface NombreDeTipo {
  /** «el cliente», «la póliza»: para armar frases sin quedar en masculino genérico. */
  articulo: 'el' | 'la'
  singular: string
  plural: string
  /** De qué pantalla salió, para el historial y para el cartel. */
  modulo: string
}

export const NOMBRE_ELIMINABLE: Record<TipoEliminable, NombreDeTipo> = {
  cliente: { articulo: 'el', singular: 'cliente', plural: 'clientes', modulo: 'Clientes' },
  poliza: { articulo: 'la', singular: 'póliza', plural: 'pólizas', modulo: 'Pólizas' },
  cuota: { articulo: 'la', singular: 'fila de la planilla', plural: 'filas de la planilla', modulo: 'Cartera → Planilla del mes' },
  baja: { articulo: 'la', singular: 'baja', plural: 'bajas', modulo: 'Cartera → Bajas' },
  rechazo: { articulo: 'el', singular: 'aviso de rechazo', plural: 'avisos de rechazo', modulo: 'Cartera → Rechazos' },
  lead: { articulo: 'el', singular: 'lead', plural: 'leads', modulo: 'Leads' },
  presupuesto: { articulo: 'el', singular: 'presupuesto', plural: 'presupuestos', modulo: 'Presupuestos' },
  siniestro: { articulo: 'el', singular: 'siniestro', plural: 'siniestros', modulo: 'Siniestros' },
  riesgo: { articulo: 'el', singular: 'riesgo vario', plural: 'riesgos varios', modulo: 'Cartera → Riesgos varios' },
  amp: { articulo: 'la', singular: 'ampliación', plural: 'ampliaciones', modulo: 'Cartera → AMP' },
  tarea: { articulo: 'la', singular: 'tarea', plural: 'tareas', modulo: 'Tareas' },
}

export function esTipoEliminable(valor: unknown): valor is TipoEliminable {
  return typeof valor === 'string' && (TIPOS_ELIMINABLES as readonly string[]).includes(valor)
}

/** «el cliente», «la póliza». */
export function conArticulo(tipo: TipoEliminable): string {
  const nombre = NOMBRE_ELIMINABLE[tipo]
  return `${nombre.articulo} ${nombre.singular}`
}

/** Una línea del «esto también se va»: «3 pólizas», «1 pago». */
export interface LoQueArrastra {
  /** En singular; el número decide cómo se lee. */
  que: string
  cuantos: number
}

/**
 * Lo que el cartel muestra ANTES de borrar. Se pide al proceso principal, que es el único que sabe qué
 * cuelga de qué: contar en el renderer sería contar sobre lo que la pantalla tenía cargado, que casi
 * nunca es todo.
 */
export interface VistaPreviaDeEliminacion {
  tipo: TipoEliminable
  id: number
  /** Cómo se llama esto en criollo: «Juan Pérez · DNI 20.123.456». */
  titulo: string
  /** Dos o tres líneas más de contexto, para no borrar al homónimo. */
  detalle: string[]
  /** Todo lo que se va con él, ya contado. Vacío si no arrastra nada. */
  arrastra: LoQueArrastra[]
  /** Cuántos renglones se sacan de la hoja de Google. */
  filasDeLaHoja: number
  /** Archivos adjuntos que se borran de esta computadora. */
  archivos: number
  /** Lo que hay que leer sí o sí antes de confirmar. */
  advertencias: string[]
}

/** Lo que efectivamente se borró. Es lo que la pantalla le dice al usuario después. */
export interface ResultadoDeEliminacion {
  tipo: TipoEliminable
  id: number
  titulo: string
  borrado: LoQueArrastra[]
  filasDeLaHoja: number
  archivos: number
}

/** «3 pólizas y 12 filas de la planilla»: para el aviso de después y para el historial. */
export function resumenDeLoBorrado(lineas: LoQueArrastra[]): string {
  const partes = lineas
    .filter((linea) => linea.cuantos > 0)
    .map((linea) => `${linea.cuantos} ${linea.cuantos === 1 ? linea.que : pluralDe(linea.que)}`)
  if (partes.length === 0) return ''
  if (partes.length === 1) return partes[0]!
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/**
 * Plural del castellano, el que alcanza para las palabras que usamos acá. No pretende ser general: las
 * que no caen en las dos reglas —«…ión» pasa a «…iones», y una vocal al final suma una ese— están
 * escritas una por una. Si aparece otra, se la agrega acá y listo.
 */
const PLURALES: Record<string, string> = {
  lead: 'leads',
  'riesgo vario': 'riesgos varios',
  'fila de la planilla': 'filas de la planilla',
  'cuota del mes': 'cuotas del mes',
  'nota del lead': 'notas del lead',
  'aviso de rechazo': 'avisos de rechazo',
  'opción del presupuesto': 'opciones del presupuesto',
  'versión del presupuesto': 'versiones del presupuesto',
  'observación del siniestro': 'observaciones del siniestro',
  'comentario de la tarea': 'comentarios de la tarea',
  'renovación en seguimiento': 'renovaciones en seguimiento',
  'renglón de la hoja': 'renglones de la hoja',
  'archivo adjunto': 'archivos adjuntos',
  'documento adjunto': 'documentos adjuntos',
}

export function pluralDe(palabra: string): string {
  const escrito = PLURALES[palabra]
  if (escrito) return escrito
  if (/ión$/i.test(palabra)) return `${palabra.slice(0, -3)}iones`
  if (/[aeiouáéíóú]$/i.test(palabra)) return `${palabra}s`
  if (/z$/i.test(palabra)) return `${palabra.slice(0, -1)}ces`
  return `${palabra}es`
}
