// Bajada: se leen las pestañas y se compara fila por fila contra lo último que sabíamos, usando el _ID
// como clave. Sólo se toca lo que cambió.
//
// Cómo se resuelven los cruces:
//  - Antes de bajar se vacía la cola de subida. Lo que igual no llegó a subir deja su fila afuera de la
//    bajada (`filasBloqueadas`), así el cambio más reciente —el local, que todavía no viajó— nunca se
//    pisa por accidente, y el resto de la hoja se actualiza igual.
//  - Si un campo cambió en la hoja y en la aplicación desde la última bajada, gana el de la hoja (es el
//    que no se subió porque el local ya había viajado) y el valor local queda en el historial marcado
//    como «pisado por sincronización».
//  - Si aparecen filas nuevas (a mano en la hoja, sin _ID) se corre la importación completa, que es la
//    que les escribe el _ID en la hoja y sabe crear clientes, vehículos y pólizas.
import type { Statement } from 'better-sqlite3'
import type { Campo } from '../importacion/encabezados'
import type { FuenteHoja } from '../importacion/fuente'
import {
  ahoraIso,
  interpretarAviso,
  interpretarDiaDeVencimiento,
  interpretarFecha,
  interpretarFechaDePeriodo,
  interpretarNumero,
  limpiar,
} from '../importacion/normalizar'
import { db, type BaseDeDatos } from '../db/base'
import { anotarEvento } from './cola'
import { repiteEncabezados } from '../importacion/encabezados'
import { esPestanaDeAnexos, guardarAnexoDeLaHoja } from './anexos'
import { refrescarLayoutSiCambio } from './columnas'
import { alDesaparecerDeLaHoja, alReaparecerEnLaHoja } from '../servicios/filas'
import { estaRevisado, normalizarEstadoDeCobro } from '../servicios/pagos'
import { tipoDeMovimientoDesdeTexto } from '../servicios/caja'
import { estadoDeTareaDesdeTexto, prioridadDeTareaDesdeTexto } from '../../shared/tareas'
import { normalizarDocumento, normalizarNumeroPoliza, normalizarPatente } from '../importacion/normalizar'
import { columnaDelId, huellaDeFila, type ContextoHoja, type PestanaSincronizable } from './hoja'
import {
  columnasDeVinculo,
  estadoDeLeadDesdeTexto,
  estadoDePresupuestoDesdeTexto,
  guardarOpcionesDePresupuesto,
  opcionesDesdeLaHoja,
  origenDeLeadDesdeTexto,
  resolverVinculoDeTarea,
} from './vinculos'

export interface ResultadoBajada {
  pestanasLeidas: number
  filasCambiadas: number
  filasNuevas: number
  filasQueYaNoEstan: number
  camposAplicados: number
  pisados: number
  /** true si aparecieron filas nuevas y hay que correr la importación completa para incorporarlas. */
  necesitaImportacion: boolean
  /** En qué pestañas aparecieron (12.7): la importación puede acotarse a ésas en vez de leer todo. */
  pestanasConFilasNuevas: string[]
  /**
   * Pestañas que volvieron vacías y por eso NO propagaron ningún borrado en este ciclo. Va en el
   * resultado, y no sólo en la bitácora, porque mientras dure eso la bajada está con los borrados
   * congelados y quien mire la sincronización tiene que poder enterarse en cualquier momento, no
   * sólo en el instante en que se anotó el evento.
   */
  pestanasVaciasIgnoradas: string[]
  llamadas: number
}

/**
 * Cada cuánto se REPITE el aviso de una pestaña que sigue volviendo vacía. Avisar una sola vez para
 * siempre era avisar por unos minutos y nunca más: la bitácora guarda 500 eventos y la pantalla
 * muestra 50, así que un respaldo restaurado un viernes el lunes ya no se veía en ninguna parte, con
 * los borrados de esa pestaña congelados sin que nadie lo supiera. Repetirlo en cada ciclo tampoco
 * sirve: desde la 13.1 el aviso en vivo puede disparar una bajada apenas alguien escribe, así que en
 * un rato movido la bitácora quedaría tapada con el mismo renglón.
 */
const MINUTOS_ENTRE_AVISOS_DE_PESTANA_VACIA = 15

interface DestinoDeBajada {
  tabla: string
  columna: string
  /**
   * Columnas derivadas que hay que recalcular al escribir. Los importes se guardan como texto tal
   * cual vienen de la hoja y aparte como número: si sólo se actualiza el texto, todas las sumas de
   * Cobranzas siguen mostrando el valor viejo.
   *
   * Recibe también el _ID de la fila: la fecha de CUANDO PAGO se interpreta con el año del período de
   * esa cuota (ver `pagoFechaDeLaCuota`), igual que hacen la importación y la edición en la planilla.
   */
  derivadas?: (valor: string, filaId: string) => Record<string, unknown>
  /** Cómo llevar lo que dice la hoja a lo que guarda la columna, cuando no es texto tal cual. */
  normalizar?: (valor: string) => string
}

/** Dónde vive cada campo del modelo, por tipo de pestaña. */
const DESTINOS: Record<string, Partial<Record<Campo, DestinoDeBajada>>> = {
  // Las columnas derivadas de la cuota se recalculan acá igual que en la importación y en la edición
  // de la planilla. Hasta la 15.4.2 la bajada escribía sólo el texto: el pago que se cargaba en
  // una sucursal llegaba a las otras como «CUANDO PAGO 22/09» pero sin `pago_fecha`, que es lo que la
  // planilla mira para dar la fila por paga, y la fila seguía figurando «Vencido» en todas las demás
  // computadoras. Lo mismo con el día de vencimiento (la alerta) y el aviso enviado.
  MENSUAL: {
    cuota: { tabla: 'cuotas_mes', columna: 'cuota', derivadas: (valor) => ({ cuota_monto: interpretarNumero(valor) }) },
    dia_vencimiento: {
      tabla: 'cuotas_mes',
      columna: 'dia_vencimiento',
      derivadas: (valor) => ({ dia_vencimiento_numero: interpretarDiaDeVencimiento(valor) }),
    },
    forma_pago: { tabla: 'cuotas_mes', columna: 'forma_pago' },
    aviso: { tabla: 'cuotas_mes', columna: 'aviso', derivadas: (valor) => ({ aviso_enviado: interpretarAviso(valor) }) },
    fecha_envio: { tabla: 'cuotas_mes', columna: 'fecha_envio' },
    avisar_vto: { tabla: 'cuotas_mes', columna: 'avisar_vto' },
    pago: { tabla: 'cuotas_mes', columna: 'pago', derivadas: (valor, filaId) => ({ pago_fecha: pagoFechaDeLaCuota(valor, filaId) }) },
    observaciones: { tabla: 'cuotas_mes', columna: 'observaciones' },
    // OBS PAGO (15.3) se subía pero hasta la 15.4.2 nunca se bajaba: la nota quedaba sólo en la
    // computadora que la escribió.
    obs_pago: { tabla: 'cuotas_mes', columna: 'obs_pago' },
    nombre: { tabla: 'cuotas_mes', columna: 'cliente_nombre' },
    documento: { tabla: 'cuotas_mes', columna: 'documento' },
    sucursal: { tabla: 'cuotas_mes', columna: 'sucursal_texto' },
    compania: { tabla: 'cuotas_mes', columna: 'compania' },
    numero_poliza: { tabla: 'cuotas_mes', columna: 'numero_poliza' },
    patente: { tabla: 'cuotas_mes', columna: 'patente' },
  },
  BAJAS: {
    motivo: { tabla: 'bajas', columna: 'motivo' },
    fecha_baja: { tabla: 'bajas', columna: 'fecha_baja' },
    observaciones: { tabla: 'bajas', columna: 'observaciones' },
    nombre: { tabla: 'bajas', columna: 'cliente_nombre' },
    documento: { tabla: 'bajas', columna: 'documento' },
    compania: { tabla: 'bajas', columna: 'compania' },
    numero_poliza: { tabla: 'bajas', columna: 'numero_poliza' },
    patente: { tabla: 'bajas', columna: 'patente' },
  },
  // Los riesgos varios: todo lo que la pantalla deja corregir con doble clic (12.7: hasta la 12.6
  // faltaban diez campos, y el teléfono lo interceptaba el atajo del cliente y nunca llegaba).
  RIESGOS_VARIOS: {
    tipo_riesgo: { tabla: 'riesgos_varios', columna: 'tipo_riesgo' },
    descripcion: { tabla: 'riesgos_varios', columna: 'descripcion' },
    cuota: { tabla: 'riesgos_varios', columna: 'cuota', derivadas: (valor) => ({ cuota_monto: interpretarNumero(valor) }) },
    observaciones: { tabla: 'riesgos_varios', columna: 'observaciones' },
    telefono: { tabla: 'riesgos_varios', columna: 'telefono' },
    compania: { tabla: 'riesgos_varios', columna: 'compania' },
    numero_poliza: { tabla: 'riesgos_varios', columna: 'numero_poliza' },
    sucursal: { tabla: 'riesgos_varios', columna: 'sucursal_texto' },
    emision: { tabla: 'riesgos_varios', columna: 'emision', derivadas: (valor) => ({ emision_iso: interpretarFecha(valor, null).iso }) },
    nombre: { tabla: 'riesgos_varios', columna: 'cliente_nombre' },
    documento: { tabla: 'riesgos_varios', columna: 'documento' },
    patente: { tabla: 'riesgos_varios', columna: 'patente' },
    prima: { tabla: 'riesgos_varios', columna: 'prima' },
    dia_vencimiento: { tabla: 'riesgos_varios', columna: 'dia_vencimiento' },
    forma_pago: { tabla: 'riesgos_varios', columna: 'forma_pago' },
    vigencia_desde: { tabla: 'riesgos_varios', columna: 'vigencia_desde' },
    vigencia_hasta: { tabla: 'riesgos_varios', columna: 'vigencia_hasta' },
    aviso: { tabla: 'riesgos_varios', columna: 'aviso' },
    pago: { tabla: 'riesgos_varios', columna: 'pago' },
  },
  // Los siniestros. Hasta la 12.6 sólo bajaban cinco campos: una corrección de la cobertura, la
  // patente, la sucursal o las fechas hecha en otra computadora no llegaba a la tabla de ésta hasta
  // una reimportación completa (quedaba en los datos crudos y nada más), y la ficha decía otra cosa
  // en cada mostrador. Ahora baja TODO lo que la ficha muestra, incluidos los datos del tercero y el
  // abogado, que desde la 12.7 tienen columna propia.
  SINIESTROS: {
    descripcion: { tabla: 'siniestros', columna: 'descripcion' },
    estado: { tabla: 'siniestros', columna: 'estado' },
    importe: { tabla: 'siniestros', columna: 'importe' },
    numero_siniestro: { tabla: 'siniestros', columna: 'numero_siniestro' },
    observaciones: { tabla: 'siniestros', columna: 'observaciones' },
    fecha: { tabla: 'siniestros', columna: 'fecha', derivadas: (valor) => ({ fecha_iso: interpretarFecha(valor, null).iso }) },
    fecha_carga: { tabla: 'siniestros', columna: 'fecha_carga', derivadas: (valor) => ({ fecha_carga_iso: interpretarFecha(valor, null).iso }) },
    nombre: { tabla: 'siniestros', columna: 'cliente_nombre' },
    documento: { tabla: 'siniestros', columna: 'documento' },
    sucursal: { tabla: 'siniestros', columna: 'sucursal_texto' },
    patente: { tabla: 'siniestros', columna: 'patente' },
    compania: { tabla: 'siniestros', columna: 'compania' },
    numero_poliza: { tabla: 'siniestros', columna: 'numero_poliza' },
    cobertura: { tabla: 'siniestros', columna: 'cobertura' },
    abogado: { tabla: 'siniestros', columna: 'abogado' },
    tercero_compania: { tabla: 'siniestros', columna: 'tercero_compania' },
    tercero_telefono: { tabla: 'siniestros', columna: 'tercero_telefono' },
    tercero_patente: { tabla: 'siniestros', columna: 'tercero_patente' },
    tercero_lesionados: { tabla: 'siniestros', columna: 'tercero_lesionados' },
    tercero_lesionados_detalle: { tabla: 'siniestros', columna: 'tercero_lesionados_detalle' },
  },
  PAGOS: {
    // La fecha cambia cuando se corrige un cobro, y sobre todo cuando un IMPUTADO pasa a PAGO: la
    // fecha de la imputación se reemplaza por la del día que el cliente pagó, y la caja de ese día
    // en las otras computadoras tiene que verlo.
    fecha: { tabla: 'pagos', columna: 'fecha', derivadas: (valor) => ({ fecha_iso: interpretarFecha(valor, null).iso }) },
    importe: { tabla: 'pagos', columna: 'importe', derivadas: (valor) => ({ importe_monto: interpretarNumero(valor) }) },
    medio_pago: { tabla: 'pagos', columna: 'medio' },
    observaciones: { tabla: 'pagos', columna: 'observaciones' },
    // El RESULTADO de la rendición: lo tocan tanto la aplicación como la contadora en la hoja.
    resultado: { tabla: 'pagos', columna: 'resultado' },
    // El estado del COBRO (PAGO / IMPUTADO): lo cambia la computadora que cobró, cuando el cliente
    // termina pagando lo que estaba imputado. Se guarda normalizado: la columna no admite vacío.
    cobro: { tabla: 'pagos', columna: 'estado_cobro', normalizar: (valor) => normalizarEstadoDeCobro(valor) },
    // 12.7: la sucursal del cobro y el mes de la cuota también se corrigen desde la otra computadora.
    sucursal: { tabla: 'pagos', columna: 'sucursal_texto' },
    mes: { tabla: 'pagos', columna: 'periodo_texto' },
    usuario: { tabla: 'pagos', columna: 'usuario_nombre' },
    // 12.10: las dos columnas de la planilla de caja. El número del comprobante lo escribe la
    // computadora que imprimió el ticket; el tilde, la que revisó el cobro.
    ticket: { tabla: 'pagos', columna: 'numero_ticket' },
    // El tilde viaja como «SI» o vacío: la hoja no lleva la hora exacta en que se tildó, así que al
    // llegar de otra computadora se guarda el momento en que llegó, que es lo más cerca que se puede
    // estar. Quién lo tildó se pierde en el viaje —no hay columna para eso— y por eso se limpia al
    // destildar: mejor sin nombre que con el de alguien que ya no tiene nada que ver.
    revisado: {
      tabla: 'pagos',
      columna: 'revisado_en',
      normalizar: (valor) => (estaRevisado(valor) ? ahoraIso() : ''),
      derivadas: (valor) => (estaRevisado(valor) ? {} : { revisado_por: null }),
    },
  },
  // La caja chica del mostrador (12.10). Lo que cambia después de cargado un renglón es su importe y
  // su detalle —se corrige la apertura, se arregla el concepto de un gasto, se cuenta de nuevo el
  // cierre— y eso lo toca la otra computadora del mismo mostrador.
  APP_CAJA: {
    importe: { tabla: 'caja_movimientos', columna: 'importe', normalizar: (valor) => String(interpretarNumero(valor) ?? 0) },
    detalle: { tabla: 'caja_movimientos', columna: 'detalle' },
    tipo_registro: { tabla: 'caja_movimientos', columna: 'tipo', normalizar: (valor) => tipoDeMovimientoDesdeTexto(valor) ?? 'GASTO' },
    sucursal: { tabla: 'caja_movimientos', columna: 'sucursal' },
    usuario: { tabla: 'caja_movimientos', columna: 'usuario_nombre' },
  },
  // Los avisos de rechazo del débito. Lo único que cambia después de creado el aviso es en qué anda
  // (PENDIENTE → VISTO → RESUELTO) y la nota: eso lo toca la sucursal avisada, desde su computadora.
  APP_RECHAZOS: {
    estado: { tabla: 'rechazos_debito', columna: 'estado' },
    observaciones: { tabla: 'rechazos_debito', columna: 'nota' },
    motivo: { tabla: 'rechazos_debito', columna: 'motivo' },
    sucursal: { tabla: 'rechazos_debito', columna: 'sucursal_texto' },
    telefono: { tabla: 'rechazos_debito', columna: 'telefono' },
    usuario: { tabla: 'rechazos_debito', columna: 'avisado_por' },
    forma_pago: { tabla: 'rechazos_debito', columna: 'forma_pago' },
    cuota: { tabla: 'rechazos_debito', columna: 'cuota' },
  },
  // Las tareas. Lo que cambia después de creada la tarea es de quién es, para cuándo, con qué urgencia
  // y en qué anda: todo eso lo toca la computadora de quien la está haciendo, que puede ser otra.
  //
  // `responsable` merece una nota: en la hoja va el NOMBRE, porque es lo que se lee, pero la campana y
  // el filtro «las mías» trabajan con `responsable_id`. Por eso se deriva el id del nombre en la misma
  // escritura; si el nombre no coincide con ningún usuario activo —o coincide con dos— la tarea queda
  // con el nombre a la vista y sin dueño, que es preferible a asignársela a la persona equivocada.
  APP_TAREAS: {
    titulo: { tabla: 'tareas', columna: 'titulo' },
    descripcion: { tabla: 'tareas', columna: 'detalle' },
    responsable: {
      tabla: 'tareas',
      columna: 'responsable_nombre',
      derivadas: (valor) => ({ responsable_id: idDeResponsablePorNombre(valor) }),
    },
    sucursal: { tabla: 'tareas', columna: 'sucursal_texto' },
    vence: { tabla: 'tareas', columna: 'vence_el' },
    // Los dos tienen CHECK en la tabla: lo que venga escrito a mano se acomoda o no entra.
    prioridad: { tabla: 'tareas', columna: 'prioridad', normalizar: (valor) => prioridadDeTareaDesdeTexto(valor) },
    estado: { tabla: 'tareas', columna: 'estado', normalizar: (valor) => estadoDeTareaDesdeTexto(valor) },
    // 12.7: la clave del vínculo; de ella salen los id locales de la ficha a la que la tarea pertenece.
    vinculo_clave: { tabla: 'tareas', columna: 'vinculo_clave', derivadas: (valor) => columnasDeVinculo(resolverVinculoDeTarea(db(), valor)) },
  },
  // Las consultas y los presupuestos (12.7): hasta la 12.6 no bajaban nunca a las otras computadoras.
  APP_LEADS: {
    nombre: { tabla: 'leads', columna: 'nombre' },
    telefono: { tabla: 'leads', columna: 'telefono' },
    documento: { tabla: 'leads', columna: 'documento', derivadas: (valor) => ({ documento_normalizado: normalizarDocumento(valor) || null }) },
    sucursal: { tabla: 'leads', columna: 'sucursal_texto' },
    interes: { tabla: 'leads', columna: 'interes' },
    tipo_vehiculo: { tabla: 'leads', columna: 'tipo_vehiculo' },
    origen: { tabla: 'leads', columna: 'origen', normalizar: (valor) => origenDeLeadDesdeTexto(valor) },
    estado: { tabla: 'leads', columna: 'estado', normalizar: (valor) => estadoDeLeadDesdeTexto(valor) },
  },
  APP_PRESUPUESTOS: {
    estado: { tabla: 'presupuestos', columna: 'estado', normalizar: (valor) => estadoDePresupuestoDesdeTexto(valor) },
    observaciones: { tabla: 'presupuestos', columna: 'observaciones' },
    sucursal: { tabla: 'presupuestos', columna: 'sucursal_texto' },
    nombre: { tabla: 'presupuestos', columna: 'cliente_nombre', normalizar: (valor) => limpiar(valor) || 'Sin nombre' },
    telefono: { tabla: 'presupuestos', columna: 'telefono' },
    documento: { tabla: 'presupuestos', columna: 'documento' },
    patente: { tabla: 'presupuestos', columna: 'patente' },
    marca: { tabla: 'presupuestos', columna: 'marca' },
    modelo: { tabla: 'presupuestos', columna: 'modelo' },
    anio: { tabla: 'presupuestos', columna: 'anio' },
    tipo_vehiculo: { tabla: 'presupuestos', columna: 'tipo_vehiculo' },
    vinculo_clave: { tabla: 'presupuestos', columna: 'vinculo_clave', derivadas: (valor) => columnasDeVinculo(soloLead(resolverVinculoDeTarea(db(), valor))) },
  },
  COBERTURA: {
    cobertura: { tabla: 'reglas_cobertura', columna: 'cobertura' },
    incluye: { tabla: 'reglas_cobertura', columna: 'incluye' },
    franquicia: { tabla: 'reglas_cobertura', columna: 'franquicia' },
    detalle: { tabla: 'reglas_cobertura', columna: 'detalle' },
    observaciones: { tabla: 'reglas_cobertura', columna: 'observaciones' },
  },
}

/**
 * Lo que la bajada recuerda de cada base abierta: las sentencias ya preparadas y las pestañas que
 * vinieron vacías y ya se avisaron. Va por instancia de base —no en variables del módulo— porque
 * las pruebas alternan varias bases sobre el mismo módulo (`usarBaseDeDatos`) y una sentencia
 * preparada sirve sólo para la base donde se preparó.
 */
interface MemoriaDeLaBase {
  sentencias: Map<string, Statement>
  /** Título de la pestaña → cuándo se avisó por última vez que volvió vacía (milisegundos). */
  pestanasVaciasAvisadas: Map<string, number>
}
const memoriaPorBase = new WeakMap<BaseDeDatos, MemoriaDeLaBase>()

function memoria(base: BaseDeDatos = db()): MemoriaDeLaBase {
  let m = memoriaPorBase.get(base)
  if (!m) {
    m = { sentencias: new Map(), pestanasVaciasAvisadas: new Map() }
    memoriaPorBase.set(base, m)
  }
  return m
}

/**
 * La sentencia preparada para ese SQL, sobre la base activa. Preparar cuesta más que correr: el
 * carril rápido pasa cada 30 segundos por APP TAREAS, COMENTARIOS y ADJUNTOS, y hasta la 12.6 cada
 * campo aplicado y cada fila desaparecida preparaba la suya de nuevo.
 */
function sentencia(sql: string): Statement {
  const base = db()
  const { sentencias } = memoria(base)
  let preparada = sentencias.get(sql)
  if (!preparada) {
    preparada = base.prepare(sql)
    sentencias.set(sql, preparada)
  }
  return preparada
}

/**
 * El id del usuario que se llama así, si hay exactamente uno activo. Con ninguno o con dos devuelve
 * null: una tarea sin dueño se ve igual en el listado y se puede reasignar; una asignada a la persona
 * equivocada desaparece de la vista de quien tenía que hacerla.
 */
function idDeResponsablePorNombre(nombre: string): number | null {
  const buscado = limpiar(nombre)
  if (!buscado) return null
  const iguales = sentencia('SELECT id FROM usuarios WHERE activo = 1 AND nombre = ?').all(buscado) as Array<{ id: number }>
  return iguales.length === 1 ? (iguales[0]?.id ?? null) : null
}

/** Campos del cliente: se guardan en la ficha del cliente, no en la fila del mes. */
const DESTINOS_DEL_CLIENTE: Partial<Record<Campo, string>> = {
  telefono: 'telefono',
  email: 'email',
  direccion: 'direccion',
  localidad: 'localidad',
  provincia: 'provincia',
  codigo_postal: 'codigo_postal',
  fecha_nacimiento: 'fecha_nacimiento',
}

/**
 * Lo que se sabe de una fila sin su JSON: `datos_json` (las 40 columnas de cada una de miles de
 * filas) se lee aparte y sólo para las que cambiaron, que en un ciclo normal son ninguna o un puñado.
 */
interface FilaConocida {
  fila_id: string
  numero_fila: number
  sheet_id: number | null
  huella: string | null
  en_la_hoja: number
}

/**
 * Aplica a la base local lo que cambió en la hoja. `titulos` acota qué pestañas se miran: el ciclo
 * automático mira las que se usan todos los días y «Forzar bajada completa» las mira todas.
 *
 * `filasBloqueadas` son las filas que todavía tienen cambios sin subir: se saltean para no pisarlos. Es
 * más fino que frenar la bajada entera, que era lo que hacía que una sola entrada trabada dejara a toda
 * la aplicación sin actualizarse.
 */
export async function bajarCambios(
  fuente: FuenteHoja,
  contexto: ContextoHoja,
  titulos: string[],
  filasBloqueadas: Set<string> = new Set(),
): Promise<ResultadoBajada> {
  const resultado: ResultadoBajada = {
    pestanasLeidas: 0,
    filasCambiadas: 0,
    filasNuevas: 0,
    filasQueYaNoEstan: 0,
    camposAplicados: 0,
    pisados: 0,
    necesitaImportacion: false,
    pestanasConFilasNuevas: [],
    pestanasVaciasIgnoradas: [],
    llamadas: 0,
  }
  const aLeer = titulos.filter((t) => contexto.porTitulo.has(t))
  if (aLeer.length === 0) return resultado

  const lecturas = await fuente.leerVarias(aLeer)
  resultado.llamadas++
  resultado.pestanasLeidas = lecturas.length

  for (const lectura of lecturas) {
    const pestana = contexto.porTitulo.get(lectura.titulo)
    if (!pestana) continue
    aplicarPestana(pestana, lectura.valores, resultado, filasBloqueadas)
  }
  return resultado
}

function aplicarPestana(
  pestana: PestanaSincronizable,
  valores: string[][],
  resultado: ResultadoBajada,
  filasBloqueadas: Set<string>,
): void {
  // 12.7: si otra computadora le agregó una columna a la pestaña desde que se leyó la estructura, la
  // fila de encabezados recién leída lo dice. El mapeo se rehace ANTES de mirar las filas, si no el
  // dato de la columna nueva quedaba en los datos crudos y nunca llegaba a su tabla.
  //
  // Salvo que la fila de encabezados venga VACÍA: eso es una pestaña recreada o un respaldo a medio
  // restaurar, la misma lectura que más abajo se decide ignorar. Rehacer el mapeo con eso dejaba el
  // layout compartido de `contexto.porTitulo` —que dura cinco minutos y también usa la subida— sin
  // encabezados ni columna _ID, por una lectura en la que no se confía.
  const filaDeEncabezados = valores[pestana.layout?.filaEncabezados ?? 0] ?? []
  if (filaDeEncabezados.some((celda) => limpiar(celda) !== '')) refrescarLayoutSiCambio(pestana, valores)
  const columnaId = columnaDelId(pestana, valores)
  // Todas las columnas tituladas _ID, no sólo la que manda: si una pestaña arrastra una segunda columna
  // _ID de cuando la duplicaron, sus valores no son datos de la fila. El importador usa el mismo criterio,
  // y si acá fuera más laxo la bajada vería filas «con datos y sin _ID» que la importación descarta, y
  // pediría una importación completa en cada ciclo sin que la hoja cambiara nunca.
  const columnasId = new Set<number>(pestana.layout?.mapeo.columnasId ?? [])
  if (columnaId !== null) columnasId.add(columnaId)
  const primeraFila = (pestana.layout?.filaEncabezados ?? 0) + 2
  const conocidas = new Map(
    // Sin `pestana`: es la columna del WHERE, así que su valor ya se sabe, y ésta es justamente la
    // consulta que corre cada 30 segundos sobre miles de filas.
    (sentencia('SELECT fila_id, numero_fila, sheet_id, huella, en_la_hoja FROM filas_crudas WHERE pestana = ?').all(pestana.titulo) as FilaConocida[]).map(
      (f) => [f.fila_id, f],
    ),
  )
  const vistas = new Set<string>()
  const ahora = ahoraIso()

  const leerDatos = sentencia('SELECT datos_json FROM filas_crudas WHERE fila_id = ?')
  const actualizarCruda = sentencia(
    `UPDATE filas_crudas SET datos_json = ?, huella = ?, numero_fila = ?, sheet_id = ?, en_la_hoja = 1, vista_en = ?, actualizado_en = ? WHERE fila_id = ?`,
  )
  const refrescarLugar = sentencia(`UPDATE filas_crudas SET numero_fila = ?, sheet_id = ? WHERE fila_id = ?`)
  const marcarDesaparecida = sentencia('UPDATE filas_crudas SET en_la_hoja = 0, actualizado_en = ? WHERE fila_id = ?')

  db().transaction(() => {
    for (let r = primeraFila - 1; r < valores.length; r++) {
      const celdas = valores[r] ?? []
      const tieneDatos = celdas.some((valor, i) => !columnasId.has(i) && limpiar(valor) !== '')
      if (!tieneDatos) continue
      // Los títulos repetidos a mitad de la planilla no son filas de datos.
      if (repiteEncabezados(celdas, pestana.layout?.mapeo.encabezados ?? [])) continue

      const id = columnaId === null ? '' : limpiar(celdas[columnaId])
      if (!id) {
        // Fila cargada a mano en la hoja. El _ID lo escribe la importación completa, que corre a
        // continuación por `necesitaImportacion`: es la única que sabe en qué fila va y, de paso, crea
        // el cliente, el vehículo y la póliza. Acá no se encola nada: el _ID que inventáramos ahora no
        // estaría en ninguna fila de la hoja y la subida no tendría dónde escribirlo.
        resultado.filasNuevas++
        resultado.necesitaImportacion = true
        if (!resultado.pestanasConFilasNuevas.includes(pestana.titulo)) resultado.pestanasConFilasNuevas.push(pestana.titulo)
        continue
      }
      vistas.add(id)
      // Con cambios locales sin subir, esta fila no se toca: bajarla ahora los pisaría. Queda para el
      // ciclo siguiente, cuando su entrada de la cola ya haya viajado.
      if (filasBloqueadas.has(id)) continue

      const conocida = conocidas.get(id)
      const huella = huellaDeFila(celdas, columnaId)
      if (!conocida) {
        // Tiene _ID pero no la conocemos: vino de otra computadora. La incorpora la importación… salvo
        // que sea un adjunto o un comentario (12.6): ésos se guardan acá mismo, así un comentario
        // escrito en la otra sucursal aparece con el carril rápido y no con la importación completa.
        if (esPestanaDeAnexos(pestana.tipo) && incorporarAnexo(pestana, id, celdas, huella, r + 1, ahora)) {
          resultado.filasNuevas++
          continue
        }
        resultado.filasNuevas++
        resultado.necesitaImportacion = true
        if (!resultado.pestanasConFilasNuevas.includes(pestana.titulo)) resultado.pestanasConFilasNuevas.push(pestana.titulo)
        continue
      }
      if (conocida.huella === huella && conocida.en_la_hoja === 1) {
        // Sin cambios en el contenido, pero si otra computadora borró un renglón más arriba la fila
        // ahora está en otro número: se anota, porque el número es lo que las reparaciones y los
        // desempates usan para saber cuál es el renglón original. No cuenta como fila cambiada.
        if (conocida.numero_fila !== r + 1 || conocida.sheet_id !== pestana.sheetId) {
          refrescarLugar.run(r + 1, pestana.sheetId, id)
        }
        continue
      }

      resultado.filasCambiadas++
      // Estaba marcada como fuera de la hoja y volvió: la deshicieron desde otra computadora.
      if (conocida.en_la_hoja === 0) alReaparecerEnLaHoja(db(), id, pestana.tipo)
      const anteriores = JSON.parse((leerDatos.get(id) as { datos_json: string } | undefined)?.datos_json ?? '{}') as Record<string, string>
      const encabezados = pestana.layout?.mapeo.encabezados ?? []
      const nuevos: Record<string, string> = { ...anteriores }

      let opcionesCambiadas = false
      for (const [campo, columna] of pestana.layout?.mapeo.porCampo ?? []) {
        const encabezado = encabezados[columna] ?? ''
        if (!encabezado) continue
        const remoto = limpiar(celdas[columna])
        const anterior = limpiar(anteriores[encabezado] ?? '')
        if (remoto === anterior) continue
        nuevos[encabezado] = remoto
        if (pestana.tipo === 'APP_PRESUPUESTOS' && (campo === 'opciones_json' || campo === 'opciones')) opcionesCambiadas = true
        const pisado = aplicarCampo(pestana, id, campo, remoto)
        resultado.camposAplicados++
        // «pisado» es lo que había en la columna ANTES de este `aplicarCampo`. Si ya era igual a lo
        // que se está bajando, no hubo nada que pisar: pasa con el teléfono, el email o la dirección
        // del cliente (15.4), que desde acá viajan a DOS filas —la cuota del mes y la fila propia en
        // APP CLIENTES— y la segunda encuentra la columna que la primera, en el mismo ciclo, ya dejó
        // con el valor nuevo. Sin este chequeo, ese caso normal salía como un conflicto falso.
        if (pisado !== null && limpiar(pisado) !== anterior && limpiar(pisado) !== remoto) {
          anotarPisado(pestana.titulo, id, campo, pisado, remoto)
          resultado.pisados++
        }
      }
      if (opcionesCambiadas) {
        const porCampo = pestana.layout?.mapeo.porCampo
        const valorDe = (campo: Campo): string => {
          const columna = porCampo?.get(campo)
          return columna === undefined ? '' : limpiar(celdas[columna])
        }
        aplicarOpcionesDePresupuesto(id, valorDe('opciones_json'), valorDe('opciones'))
      }
      // Las columnas sin mapeo también se guardan: los datos crudos son la red de seguridad.
      encabezados.forEach((encabezado, i) => {
        if (encabezado && i !== columnaId) nuevos[encabezado] = limpiar(celdas[i])
      })
      // Un adjunto o un comentario cuya fila cambió (12.7: la computadora que subió el archivo anota
      // cuándo llegó al servidor) se vuelve a guardar entero: sus tablas no están en DESTINOS.
      if (esPestanaDeAnexos(pestana.tipo)) incorporarAnexo(pestana, id, celdas, huella, r + 1, ahora, false)

      actualizarCruda.run(JSON.stringify(nuevos), huella, r + 1, pestana.sheetId, ahora, ahora, id)
    }

    // Una pestaña que vuelve VACÍA —ni una fila con _ID— cuando acá se conocían varias no es que
    // se borraron todas: es un respaldo restaurado o una pestaña recreada. Darlas por desaparecidas
    // sería borrar en TODAS las computadoras lo que representaban (los archivos de APP ADJUNTOS, los
    // siniestros, las tareas) por un accidente del servidor. Se avisa y se sigue; cuando la pestaña
    // vuelva con sus filas, las huellas dirán qué cambió. Con UNA sola fila conocida no se distingue
    // de un borrado común (la última tarea, el último adjunto, el último siniestro de la pestaña) y
    // perder un registro no es grave; con `> 0`, en cambio, ese borrado no viajaría NUNCA más, porque
    // la pestaña quedaría vacía para siempre: ahí sí se aplica. El importador usa `> 0` porque él
    // corre después y sobre lo que la bajada ya dejó marcado.
    const presentes = [...conocidas.values()].filter((c) => c.en_la_hoja === 1).length
    const { pestanasVaciasAvisadas } = memoria()
    if (vistas.size === 0 && presentes > 1) {
      // El aviso viaja SIEMPRE en el resultado; en la bitácora se repite cada tanto, no una sola vez.
      if (!resultado.pestanasVaciasIgnoradas.includes(pestana.titulo)) resultado.pestanasVaciasIgnoradas.push(pestana.titulo)
      const ultimoAviso = pestanasVaciasAvisadas.get(pestana.titulo) ?? 0
      if (Date.now() - ultimoAviso >= MINUTOS_ENTRE_AVISOS_DE_PESTANA_VACIA * 60_000) {
        pestanasVaciasAvisadas.set(pestana.titulo, Date.now())
        anotarEvento(
          'bajada',
          `La pestaña «${pestana.titulo}» vino vacía y acá se conocían ${presentes} filas: no se da ninguna por borrada (parece un respaldo restaurado o una pestaña recreada).`,
          { conError: true },
        )
      }
      return
    }
    pestanasVaciasAvisadas.delete(pestana.titulo)

    // Filas que estaban y ya no: quedan marcadas, nunca se borran. Lo que sí cambia es lo que la
    // fila representaba (la cuota sale de la planilla, la baja deshecha se olvida): ver filas.ts.
    const desaparecidas: string[] = []
    for (const [id, conocida] of conocidas) {
      if (vistas.has(id) || conocida.en_la_hoja === 0) continue
      marcarDesaparecida.run(ahora, id)
      resultado.filasQueYaNoEstan++
      desaparecidas.push(id)
    }
    alDesaparecerDeLaHoja(
      db(),
      desaparecidas.map((filaId) => ({ filaId, tipo: pestana.tipo })),
      filasBloqueadas,
    )
  })()
}

/**
 * Una fila nueva de APP ADJUNTOS / APP COMENTARIOS: se guarda el registro y la fila cruda sin pasar
 * por la importación completa. Devuelve false si la ficha madre todavía no está en esta computadora:
 * ahí sí hace falta la importación (que trae la ficha y, con ella, el anexo).
 */
function incorporarAnexo(
  pestana: PestanaSincronizable,
  id: string,
  celdas: string[],
  huella: string,
  numeroFila: number,
  ahora: string,
  anotarFilaCruda = true,
): boolean {
  if (pestana.tipo !== 'APP_ADJUNTOS' && pestana.tipo !== 'APP_COMENTARIOS') return false
  const porCampo = pestana.layout?.mapeo.porCampo ?? new Map<Campo, number>()
  const valor = (campo: Campo): string => {
    const columna = porCampo.get(campo)
    return columna === undefined ? '' : limpiar(celdas[columna])
  }
  const resultado = guardarAnexoDeLaHoja(pestana.tipo, { filaId: id, pestana: pestana.titulo, valor }, db())
  if (resultado === 'sin-padre') return false
  // Una fila ya conocida que cambió: quien llama actualiza los datos crudos por su cuenta.
  if (!anotarFilaCruda) return true
  const encabezados = pestana.layout?.mapeo.encabezados ?? []
  const datos: Record<string, string> = {}
  encabezados.forEach((encabezado, i) => {
    if (encabezado) datos[encabezado] = limpiar(celdas[i])
  })
  sentencia(
    `INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, periodo, numero_fila, datos_json, en_la_hoja, vista_en, sheet_id, huella, creado_en, actualizado_en)
       VALUES (?, ?, ?, NULL, ?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(fila_id) DO UPDATE SET pestana = excluded.pestana, numero_fila = excluded.numero_fila, datos_json = excluded.datos_json,
         en_la_hoja = 1, vista_en = excluded.vista_en, sheet_id = excluded.sheet_id, huella = excluded.huella, actualizado_en = excluded.actualizado_en`,
  ).run(id, pestana.titulo, pestana.tipo, numeroFila, JSON.stringify(datos), ahora, pestana.sheetId, huella, ahora, ahora)
  return true
}

/**
 * Escribe el valor que vino de la hoja en la tabla que corresponde. Devuelve el valor que había en la
 * base local (para saber si se pisó un cambio hecho acá), o null si el campo no se guarda en ninguna tabla.
 */
/** Sólo el lead: un presupuesto no cambia de cliente por la clave (ver DESTINOS.APP_PRESUPUESTOS). */
function soloLead(ids: ReturnType<typeof resolverVinculoDeTarea>): ReturnType<typeof resolverVinculoDeTarea> {
  return ids?.lead_id ? { lead_id: ids.lead_id } : null
}

/**
 * Campos de la planilla del mes que además describen la póliza o el vehículo (12.7). Hasta la 12.6
 * la bajada los escribía sólo en la fila del mes: la ficha de la póliza, la bandeja de renovaciones
 * y la búsqueda por patente de la otra computadora quedaban con lo viejo hasta una reimportación.
 * Se aplican sólo desde la planilla del mes más nuevo, que es la que define la cartera.
 */
const DESTINOS_DE_LA_POLIZA: Partial<Record<Campo, { columna: string; derivadas?: (valor: string) => Record<string, unknown> }>> = {
  cobertura: { columna: 'cobertura' },
  prima: { columna: 'prima', derivadas: (valor) => ({ prima_monto: interpretarNumero(valor) }) },
  productor: { columna: 'productor' },
  forma_pago: { columna: 'forma_pago' },
  vigencia_desde: { columna: 'vigencia_desde', derivadas: (valor) => ({ vigencia_desde_iso: interpretarFecha(valor, null).iso }) },
  vigencia_hasta: { columna: 'vigencia_hasta', derivadas: (valor) => ({ vigencia_hasta_iso: interpretarFecha(valor, null).iso }) },
  compania: { columna: 'compania' },
  numero_poliza: { columna: 'numero', derivadas: (valor) => ({ numero_normalizado: normalizarNumeroPoliza(valor) || null }) },
  avisar_vto: { columna: 'avisar_vto' },
}
const DESTINOS_DEL_VEHICULO: Partial<Record<Campo, { columna: string; derivadas?: (valor: string) => Record<string, unknown> }>> = {
  patente: { columna: 'patente', derivadas: (valor) => ({ patente_normalizada: normalizarPatente(valor) || null }) },
  marca: { columna: 'marca' },
  modelo: { columna: 'modelo' },
  anio: { columna: 'anio', derivadas: (valor) => ({ anio_numero: /^\d{4}$/.test(limpiar(valor)) ? Number(limpiar(valor)) : null }) },
  tipo_vehiculo: { columna: 'tipo' },
  motor: { columna: 'motor' },
  chasis: { columna: 'chasis' },
  uso: { columna: 'uso' },
  color: { columna: 'color' },
  suma_asegurada: { columna: 'suma_asegurada' },
}

function aplicarALaPolizaDelMes(filaId: string, campo: Campo, valor: string): void {
  const enPoliza = DESTINOS_DE_LA_POLIZA[campo]
  const enVehiculo = DESTINOS_DEL_VEHICULO[campo]
  if (!enPoliza && !enVehiculo) return
  const cuota = sentencia(
    `SELECT c.poliza_id, p.vehiculo_id FROM cuotas_mes c JOIN polizas p ON p.id = c.poliza_id
       WHERE c.fila_id = ? AND c.periodo = (SELECT MAX(periodo) FROM cuotas_mes)`,
  ).get(filaId) as { poliza_id: number; vehiculo_id: number | null } | undefined
  if (!cuota) return
  const ahora = ahoraIso()
  if (enPoliza) {
    const derivadas = enPoliza.derivadas?.(valor) ?? {}
    const asignaciones = [`${enPoliza.columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`), 'actualizado_en = @ahora']
    sentencia(`UPDATE polizas SET ${asignaciones.join(', ')} WHERE id = @id`).run({ valor: valor || null, ...derivadas, ahora, id: cuota.poliza_id })
  }
  if (enVehiculo && cuota.vehiculo_id !== null) {
    const derivadas = enVehiculo.derivadas?.(valor) ?? {}
    const asignaciones = [`${enVehiculo.columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`), 'actualizado_en = @ahora']
    sentencia(`UPDATE vehiculos SET ${asignaciones.join(', ')} WHERE id = @id`).run({ valor: valor || null, ...derivadas, ahora, id: cuota.vehiculo_id })
  }
}

/**
 * La fecha ISO de CUANDO PAGO, con la misma regla que la importación: un «22/09» sin año toma el del
 * período de la cuota (y el anterior si la fecha cae varios meses después, ver
 * `interpretarFechaDePeriodo`). Un texto que no es fecha («A/D», «DÉBITO») deja `pago_fecha` vacío,
 * igual que al importar.
 */
function pagoFechaDeLaCuota(valor: string, filaId: string): string | null {
  const cuota = sentencia('SELECT periodo FROM cuotas_mes WHERE fila_id = ?').get(filaId) as { periodo: string } | undefined
  // «sin-periodo» es lo que guarda la importación para una planilla sin mes reconocible: ahí no hay año.
  const periodo = cuota && /^\d{4}-\d{2}$/.test(cuota.periodo) ? cuota.periodo : null
  return interpretarFechaDePeriodo(valor, periodo).iso
}

function aplicarCampo(pestana: PestanaSincronizable, filaId: string, campo: Campo, valor: string): string | null {
  // Los datos del cliente viajan en la planilla del mes. En las otras pestañas, «telefono» es el
  // teléfono de ESA fila (el riesgo, el aviso), no el de la ficha del cliente: hasta la 12.6 el atajo
  // se los comía y nunca llegaban a su tabla.
  //
  // Desde la 15.4 hay DOS caminos hacia la misma columna, según la pestaña: la del mes resuelve el
  // cliente por su cuota (join con `cuotas_mes`, como siempre); APP CLIENTES lo resuelve directo por
  // `fila_id_app_clientes`, porque esa fila es del cliente y no de ninguna póliza en particular.
  const columnaCliente = pestana.tipo === 'MENSUAL' || pestana.tipo === 'APP_CLIENTES' ? DESTINOS_DEL_CLIENTE[campo] : undefined
  if (columnaCliente) {
    const cliente =
      pestana.tipo === 'APP_CLIENTES'
        ? (sentencia(`SELECT id, ${columnaCliente} AS valor FROM clientes WHERE fila_id_app_clientes = ?`).get(filaId) as
            | { id: number; valor: string | null }
            | undefined)
        : (sentencia(
            `SELECT c.id, c.${columnaCliente} AS valor FROM clientes c
               JOIN cuotas_mes q ON q.cliente_id = c.id WHERE q.fila_id = ?`,
          ).get(filaId) as { id: number; valor: string | null } | undefined)
    if (!cliente) return null
    sentencia(`UPDATE clientes SET ${columnaCliente} = ?, actualizado_en = ? WHERE id = ?`).run(valor || null, ahoraIso(), cliente.id)
    return cliente.valor ?? ''
  }

  // Nombre, documento y sucursal son del cliente en ESTA pestaña, a diferencia de MENSUAL: ahí son la
  // copia de la cuota (ver DESTINOS.MENSUAL, más abajo) y `clientes` recién los recibe en la próxima
  // importación completa, que reconcilia desde la planilla. Acá no hay ninguna cuota de la que
  // copiarlos —la fila ES el cliente—, así que si no se aplican ahora quedan sin sincronizar hasta esa
  // importación completa, que es justo la demora que esta pestaña existe para evitar.
  if (pestana.tipo === 'APP_CLIENTES' && (campo === 'nombre' || campo === 'documento' || campo === 'sucursal')) {
    const columna = campo === 'sucursal' ? 'sucursal_texto' : campo
    const cliente = sentencia(`SELECT id, ${columna} AS valor FROM clientes WHERE fila_id_app_clientes = ?`).get(filaId) as
      | { id: number; valor: string | null }
      | undefined
    if (!cliente) return null
    const extra = campo === 'documento' ? ', documento_normalizado = @documento_normalizado' : ''
    // El nombre nunca se pone en null: es NOT NULL en la tabla, y un valor vacío no puede pasar de
    // todas formas (la ficha lo exige al cargar y al editar).
    const valorAGuardar = campo === 'nombre' ? valor : valor || null
    sentencia(`UPDATE clientes SET ${columna} = @valor${extra}, actualizado_en = @ahora WHERE id = @id`).run({
      valor: valorAGuardar,
      documento_normalizado: campo === 'documento' ? normalizarDocumento(valor) || null : null,
      ahora: ahoraIso(),
      id: cliente.id,
    })
    return cliente.valor ?? ''
  }

  const destino = DESTINOS[pestana.tipo]?.[campo]
  if (!destino) {
    if (pestana.tipo === 'MENSUAL') aplicarALaPolizaDelMes(filaId, campo, valor)
    return null
  }
  const actual = sentencia(`SELECT ${destino.columna} AS valor FROM ${destino.tabla} WHERE fila_id = ?`).get(filaId) as
    | { valor: string | null }
    | undefined
  if (!actual) return null
  const derivadas = destino.derivadas?.(valor, filaId) ?? {}
  const guardado = destino.normalizar ? destino.normalizar(valor) : valor
  const asignaciones = [`${destino.columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`), 'actualizado_en = @ahora']
  sentencia(`UPDATE ${destino.tabla} SET ${asignaciones.join(', ')} WHERE fila_id = @fila_id`).run({ valor: destino.normalizar ? guardado : valor || null, ...derivadas, ahora: ahoraIso(), fila_id: filaId })
  if (pestana.tipo === 'MENSUAL') aplicarALaPolizaDelMes(filaId, campo, valor)
  return actual.valor ?? ''
}

/**
 * Las opciones de un presupuesto viajan enteras en OPCIONES JSON (12.7): cuando esa celda cambia se
 * reemplazan las de acá. No entra en DESTINOS porque no es una columna, es una tabla.
 */
function aplicarOpcionesDePresupuesto(filaId: string, json: string, textoLegible: string): void {
  const presupuesto = sentencia('SELECT id FROM presupuestos WHERE fila_id = ?').get(filaId) as { id: number } | undefined
  if (!presupuesto) return
  const companias = (sentencia('SELECT DISTINCT compania FROM polizas WHERE compania IS NOT NULL').all() as Array<{ compania: string }>).map((c) => c.compania)
  guardarOpcionesDePresupuesto(db(), presupuesto.id, opcionesDesdeLaHoja(json, textoLegible, companias))
}

function anotarPisado(pestana: string, filaId: string, campo: string, valorLocal: string, valorRemoto: string): void {
  sentencia(
    `INSERT INTO historial (fecha, usuario_id, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo)
       VALUES (?, NULL, 'Sincronización', 'sincronizacion', ?, NULL, ?, ?, ?, ?)`,
  ).run(ahoraIso(), pestana, filaId, `${campo} (pisado por sincronización)`, valorLocal, valorRemoto)
  anotarEvento('conflicto', `«${campo}» de la fila ${filaId} cambió en la base: se pisó el valor local («${valorLocal}» → «${valorRemoto}»).`)
}
