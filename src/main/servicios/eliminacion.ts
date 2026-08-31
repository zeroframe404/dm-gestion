// Borrado definitivo y puntual de un registro. Es del SUPER_ADMIN y de nadie más (ver ipc.ts, que es el
// que exige el rol, y shared/eliminacion.ts, que explica por qué no es un permiso configurable).
//
// Cómo está armado. Cada tipo tiene un PLAN: qué se llama esto, qué se lleva puesto, qué renglones hay
// que sacar de la hoja de Google, qué archivos hay que borrar de esta computadora, qué conviene avisar
// antes, y las sentencias que hacen el trabajo. El plan se arma dos veces con el mismo código:
//   · `vistaPreviaDeEliminacion` lo arma y NO lo ejecuta: es lo que el cartel muestra antes de confirmar;
//   · `eliminarRegistro` lo arma y lo ejecuta.
// De ahí que lo que el cartel promete y lo que el borrado hace no puedan separarse: son la misma cuenta.
//
// Cuatro reglas que atraviesan todos los planes:
//
//   1. Se borra lo que existe SÓLO por el registro (sus notas, sus cuotas, sus adjuntos) y se
//      DESENLAZA lo que tiene vida propia (el lead del que salió la venta, el presupuesto que se le
//      hizo a esa póliza). Cada plan dice cuál es cuál y por qué.
//
//   2. El historial NO se toca nunca. Es la red de seguridad de la agencia: si alguien pregunta qué
//      pasó con la póliza de fulano, la respuesta tiene que seguir estando. Se le agrega, además, una
//      entrada con la foto completa de lo que se borró.
//
//   3. `filas_crudas` tampoco se toca. Es lo que la bajada usa para reconocer un `_ID` de la hoja: si se
//      borrara, la fila que todavía está en Google se vería como «vino de otra computadora» y dispararía
//      una importación completa que volvería a crear todo lo que se acaba de borrar. Queda como lápida:
//      cuando la subida saque el renglón, la bajada la marca `en_la_hoja = 0` y ahí termina.
//
//   4. Las claves foráneas están en ON (ver db/base.ts). Es a favor: si un plan se olvidara de una tabla
//      que apunta al registro, la transacción entera se cae y no se borra NADA. Un borrado a medias sería
//      mucho peor que uno que no se hizo.
import { existsSync } from 'node:fs'
import {
  NOMBRE_ELIMINABLE,
  conArticulo,
  esTipoEliminable,
  resumenDeLoBorrado,
  type LoQueArrastra,
  type ResultadoDeEliminacion,
  type TipoEliminable,
  type VistaPreviaDeEliminacion,
} from '../../shared/eliminacion'
import type { SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { periodosDisponibles } from './cartera'
import { ahoraIso } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { borrarArchivoDeAdjunto, rutaDeAdjunto } from './adjuntos'
import { ErrorDeNegocio } from './errores'
import { PESTANA_APP } from './filas'
import { registrarCambio } from './historial'
import { enteroPositivo } from './validacion'

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

/** Un renglón de la hoja de Google que hay que sacar. */
interface Renglon {
  filaId: string
  pestana: string
}

interface Plan {
  /** Tabla principal, para el historial. */
  tabla: string
  /** El `_ID` del registro en la hoja, si tiene. */
  filaId: string | null
  /** Cómo se llama esto en criollo: «Juan Pérez · DNI 20.123.456». */
  titulo: string
  detalle: string[]
  arrastra: LoQueArrastra[]
  renglones: Renglon[]
  /**
   * Los borrados que se encolan de verdad, que son MÁS que `renglones`.
   *
   * Una fila que todavía no viajó no tiene renglón que sacar y por eso no se cuenta en el cartel. Pero
   * el proceso principal es de un solo hilo y este borrado puede entrar justo mientras `subirTanda`
   * está esperando la respuesta de Google con esa fila ya en la mano: cancelarle la entrada de la cola
   * no le saca los datos que ya leyó, así que la va a escribir igual y `marcarListas` no va a encontrar
   * nada que marcar. Ese renglón quedaría en la hoja para siempre. Encolar el borrado igual no cuesta
   * nada —si la fila nunca llegó, la subida lo da por hecho en el ciclo siguiente— y tapa la carrera.
   */
  paraSacar: Renglon[]
  /**
   * TODOS los `_ID` que toca el borrado, tengan renglón en la hoja o no. No es lo mismo que
   * `renglones`: una fila creada en la aplicación y todavía sin subir no tiene renglón que sacar, pero
   * sí tiene un «crear» esperando en la cola que hay que cancelar. Si no se cancelara, la subida
   * escribiría en Google una fila que acá ya no existe y que nadie va a sacar nunca.
   */
  filas: string[]
  /** Rutas relativas de los adjuntos, tal como las guarda `adjuntos.ts`. */
  archivos: string[]
  advertencias: string[]
  /** La foto del registro antes de borrarlo: va al historial. */
  instantanea: Record<string, unknown>
  /** Las sentencias, de hijos a padres. Corre dentro de una transacción. */
  ejecutar: () => void
}

type FilaCualquiera = Record<string, unknown>

function una(sql: string, ...parametros: unknown[]): FilaCualquiera | undefined {
  return db().prepare(sql).get(...parametros) as FilaCualquiera | undefined
}

function todas(sql: string, ...parametros: unknown[]): FilaCualquiera[] {
  return db().prepare(sql).all(...parametros) as FilaCualquiera[]
}

function ids(sql: string, ...parametros: unknown[]): number[] {
  return (db().prepare(sql).all(...parametros) as Array<{ id: number }>).map((f) => f.id)
}

function cuantos(sql: string, ...parametros: unknown[]): number {
  return (db().prepare(sql).get(...parametros) as { n: number }).n
}

function corre(sql: string, ...parametros: unknown[]): void {
  db().prepare(sql).run(...parametros)
}

/** `(?, ?, ?)` para un `IN`. better-sqlite3 no toma arreglos. */
function enLista(cuantosHay: number): string {
  return `(${Array.from({ length: cuantosHay }, () => '?').join(',')})`
}

/** Texto que sirve para mostrar, o null si vino vacío. */
function algo(valor: unknown): string | null {
  if (typeof valor !== 'string') return valor === null || valor === undefined ? null : String(valor)
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/** Arma «Compañía · Póliza · Patente» salteando lo que no está. */
function juntar(...partes: Array<string | null | undefined>): string {
  return partes.filter((p) => algo(p) !== null).join(' · ')
}

function linea(que: string, cuantosHay: number): LoQueArrastra | null {
  return cuantosHay > 0 ? { que, cuantos: cuantosHay } : null
}

function soloLasQueHay(lineas: Array<LoQueArrastra | null>): LoQueArrastra[] {
  return lineas.filter((l): l is LoQueArrastra => l !== null)
}

/**
 * Dónde vive este `_ID` en la hoja. Manda `filas_crudas`, no la columna `pestana` de la tabla: una baja
 * hecha en la aplicación se guarda con la pestaña `(cargado en DM Gestión)` mientras que su renglón real
 * está en «BAJAS …» (ver `darDeBaja` en cartera.ts). Devuelve null si nunca tuvo lugar en la hoja.
 */
function renglon(filaId: unknown, pestanaDeLaTabla: unknown): Renglon | null {
  const id = algo(filaId)
  if (id === null) return null
  const cruda = una('SELECT pestana, numero_fila, en_la_hoja FROM filas_crudas WHERE fila_id = ?', id)
  const pestana = algo(cruda?.pestana) ?? algo(pestanaDeLaTabla)
  if (pestana === null || pestana === PESTANA_APP) return null
  // Sólo cuenta como renglón lo que HOY está en la hoja. Quedan afuera los dos casos de `en_la_hoja = 0`:
  // la fila que nació acá y todavía no viajó (`registrarFilaDeLaApp` la deja en 0, y la subida le pone
  // el 1 al escribirla) y la que estuvo y ya no está (la sacó una baja, o alguien la borró a mano). En
  // los dos, prometer en el cartel un borrado en Google sería prometer algo que no va a pasar.
  // Encolarlo igual sí se hace, por las dudas: eso es `paraSacar`, no esto.
  if (cruda && Number(cruda.en_la_hoja) !== 1) return null
  return { filaId: id, pestana }
}

/**
 * La pestaña que le toca a este `_ID`, esté hoy en la hoja o no. Es lo que hace falta para encolar un
 * borrado defensivo: ver `deLaHoja` y el comentario de `paraSacar`.
 */
function dondeIria(filaId: unknown, pestanaDeLaTabla: unknown): Renglon | null {
  const id = algo(filaId)
  if (id === null) return null
  const cruda = una('SELECT pestana FROM filas_crudas WHERE fila_id = ?', id)
  const pestana = algo(cruda?.pestana) ?? algo(pestanaDeLaTabla)
  if (pestana === null || pestana === PESTANA_APP) return null
  return { filaId: id, pestana }
}

/** Los adjuntos de un grupo de siniestros o de tareas, con la ruta relativa que guarda `adjuntos.ts`. */
function archivosDe(tabla: 'siniestro_adjuntos' | 'tarea_adjuntos', columna: string, listaIds: number[]): string[] {
  if (listaIds.length === 0) return []
  return todas(`SELECT archivo FROM ${tabla} WHERE ${columna} IN ${enLista(listaIds.length)}`, ...listaIds)
    .map((f) => algo(f.archivo))
    .filter((a): a is string => a !== null)
}

// ---------------------------------------------------------------------------
// Los planes, uno por tipo
// ---------------------------------------------------------------------------

function planDe(tipo: TipoEliminable, id: number): Plan {
  switch (tipo) {
    case 'cliente':
      return planDeCliente(id)
    case 'poliza':
      return planDePoliza(id)
    case 'cuota':
      return planDeCuota(id)
    case 'baja':
      return planDeBaja(id)
    case 'rechazo':
      return planDeRechazo(id)
    case 'lead':
      return planDeLead(id)
    case 'presupuesto':
      return planDePresupuesto(id)
    case 'siniestro':
      return planDeSiniestro(id)
    case 'riesgo':
      return planDeRiesgo(id)
    case 'amp':
      return planDeAmp(id)
    case 'tarea':
      return planDeTarea(id)
  }
}

function noSeEncontro(tipo: TipoEliminable): never {
  throw new ErrorDeNegocio(`No se encontró ${conArticulo(tipo)} que se quiere borrar. Puede que ya lo haya borrado otra persona.`)
}

// ---------------------------------------------------------------------------
// Condiciones: se arman en JavaScript y no a mano dentro del SQL
// ---------------------------------------------------------------------------
//
// Los planes grandes (un cliente con sus pólizas, sus siniestros y sus presupuestos) necesitan
// condiciones como «las tareas de este cliente, o de alguna de sus pólizas, o de alguno de sus
// siniestros». Escrito a mano, el orden de los interrogantes y el de los parámetros se desincronizan al
// primer descuido y el error no salta: devuelve otra cosa. Con estas tres piezas, cada condición viaja
// con sus propios parámetros pegados.

interface Condicion {
  /** El WHERE, sin la palabra WHERE. */
  donde: string
  parametros: unknown[]
}

function igual(columna: string, valor: unknown): Condicion {
  return { donde: `${columna} = ?`, parametros: [valor] }
}

/** `columna IN (…)`. Con la lista vacía da una condición que no puede cumplirse. */
function dentroDe(columna: string, listaIds: number[]): Condicion {
  if (listaIds.length === 0) return { donde: '0 = 1', parametros: [] }
  return { donde: `${columna} IN ${enLista(listaIds.length)}`, parametros: [...listaIds] }
}

/** `(a) AND (b)`. */
function ambas(a: Condicion, b: Condicion): Condicion {
  return { donde: `(${a.donde}) AND (${b.donde})`, parametros: [...a.parametros, ...b.parametros] }
}

/** `(a) AND NOT (b)`. */
function salvo(a: Condicion, b: Condicion): Condicion {
  return { donde: `(${a.donde}) AND NOT (${b.donde})`, parametros: [...a.parametros, ...b.parametros] }
}

function alguna(...condiciones: Condicion[]): Condicion {
  return {
    donde: condiciones.map((c) => `(${c.donde})`).join(' OR '),
    parametros: condiciones.flatMap((c) => c.parametros),
  }
}

// ---------------------------------------------------------------------------
// Grupos: contar y sacar de la hoja sin repetir el mismo SQL dos veces
// ---------------------------------------------------------------------------

/**
 * Un conjunto de filas que se van con el registro. El mismo descriptor sirve para contarlas (el cartel
 * que se ve antes) y para juntar sus renglones de la hoja (el borrado): así lo que se promete y lo que
 * se hace no pueden separarse.
 */
interface Grupo {
  /** En singular; `resumenDeLoBorrado` lo pone en plural cuando hace falta. */
  que: string
  tabla: string
  condicion: Condicion
  /** Si la tabla tiene columnas `fila_id` y `pestana`, o sea, renglón propio en la hoja. */
  enLaHoja: boolean
}

function grupo(que: string, tabla: string, condicion: Condicion, enLaHoja = true): Grupo {
  return { que, tabla, condicion, enLaHoja }
}

function contarGrupos(grupos: Grupo[]): LoQueArrastra[] {
  return soloLasQueHay(
    grupos.map((g) =>
      linea(g.que, cuantos(`SELECT COUNT(*) AS n FROM ${g.tabla} WHERE ${g.condicion.donde}`, ...g.condicion.parametros)),
    ),
  )
}

/**
 * Lo que estos grupos tienen en la hoja: los renglones que hay que sacar y todos los `_ID` que tocan.
 * Se devuelven juntos porque salen de la misma consulta y porque separarlos fue exactamente el error
 * que este comentario evita: cancelar la cola sólo de las filas con renglón dejaba viva la entrada de
 * «crear» de una fila que todavía no había viajado.
 */
function deLaHoja(grupos: Grupo[]): { renglones: Renglon[]; paraSacar: Renglon[]; filas: string[] } {
  const renglones: Renglon[] = []
  const paraSacar: Renglon[] = []
  const filas: string[] = []
  const vistos = new Set<string>()
  for (const g of grupos) {
    if (!g.enLaHoja) continue
    for (const f of todas(`SELECT fila_id, pestana FROM ${g.tabla} WHERE ${g.condicion.donde}`, ...g.condicion.parametros)) {
      const id = algo(f.fila_id)
      if (id === null) continue
      // Un mismo _ID no se toca dos veces: borrar corre las filas de abajo, y pedir el mismo renglón
      // dos veces sacaría de la hoja el que quedó en su lugar.
      if (vistos.has(id)) continue
      vistos.add(id)
      filas.push(id)
      const enLaHoja = renglon(id, f.pestana)
      if (enLaHoja) renglones.push(enLaHoja)
      const iria = dondeIria(id, f.pestana)
      if (iria) paraSacar.push(iria)
    }
  }
  return { renglones, paraSacar, filas }
}

/**
 * Saca de la cola lo que todavía no viajó de esas filas. Va ANTES de encolar los borrados y no es un
 * detalle de prolijidad: `subirTanda` recorre la cola por id, así que un «crear» pendiente se aplicaría
 * primero, y el «borrar» que va detrás busca la fila en el mapa de la hoja tal como estaba al empezar la
 * tanda —donde la recién creada todavía no figura— y se da por hecho sin borrar nada. La fila quedaría
 * en Google para siempre. Se sacan también las que habían quedado en «no se pudo»: `reintentarFallidas`
 * las volvería a poner en cola.
 */
function cancelarPendientes(filaIds: string[]): void {
  if (filaIds.length === 0) return
  corre(
    `DELETE FROM cola_sync WHERE estado IN ('pendiente', 'fallido') AND fila_id IN ${enLista(filaIds.length)}`,
    ...filaIds,
  )
}

// ---------------------------------------------------------------------------
// Cascadas reutilizables. Van SIEMPRE de hijos a padres: las claves foráneas están en ON.
// ---------------------------------------------------------------------------

function borrarTareas(listaIds: number[]): void {
  if (listaIds.length === 0) return
  const marca = enLista(listaIds.length)
  corre(`DELETE FROM tarea_comentarios WHERE tarea_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM tarea_adjuntos WHERE tarea_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM tareas WHERE id IN ${marca}`, ...listaIds)
}

function borrarSiniestros(listaIds: number[]): void {
  if (listaIds.length === 0) return
  const marca = enLista(listaIds.length)
  borrarTareas(ids(`SELECT id FROM tareas WHERE siniestro_id IN ${marca}`, ...listaIds))
  corre(`DELETE FROM siniestro_observaciones WHERE siniestro_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM siniestro_adjuntos WHERE siniestro_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM siniestros WHERE id IN ${marca}`, ...listaIds)
}

function borrarPresupuestos(listaIds: number[]): void {
  if (listaIds.length === 0) return
  const marca = enLista(listaIds.length)
  borrarTareas(ids(`SELECT id FROM tareas WHERE presupuesto_id IN ${marca}`, ...listaIds))
  corre(`DELETE FROM presupuesto_opciones WHERE presupuesto_id IN ${marca}`, ...listaIds)
  // Las versiones se apuntan entre sí: primero se desenlaza lo que quede afuera del grupo.
  corre(`UPDATE presupuestos SET presupuesto_anterior_id = NULL WHERE presupuesto_anterior_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM presupuestos WHERE id IN ${marca}`, ...listaIds)
}

function borrarPolizas(listaIds: number[]): void {
  if (listaIds.length === 0) return
  const marca = enLista(listaIds.length)
  borrarTareas(ids(`SELECT id FROM tareas WHERE poliza_id IN ${marca}`, ...listaIds))
  borrarSiniestros(ids(`SELECT id FROM siniestros WHERE poliza_id IN ${marca}`, ...listaIds))
  // La renovación de OTRA póliza que terminó en ésta no se borra: se le saca la póliza nueva y queda
  // como estaba antes de renovar. Lo que sí se va es el seguimiento de las pólizas que se borran.
  corre(`UPDATE renovaciones SET poliza_nueva_id = NULL WHERE poliza_nueva_id IN ${marca}`, ...listaIds)
  borrarTareas(
    ids(`SELECT id FROM tareas WHERE renovacion_id IN (SELECT id FROM renovaciones WHERE poliza_id IN ${marca})`, ...listaIds),
  )
  corre(`DELETE FROM renovaciones WHERE poliza_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM rechazos_debito WHERE poliza_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM amp WHERE poliza_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM pagos WHERE poliza_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM bajas WHERE poliza_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM cuotas_mes WHERE poliza_id IN ${marca}`, ...listaIds)
  // El presupuesto que terminó en esta póliza no se borra: es la cotización que le hicimos a alguien.
  corre(`UPDATE presupuestos SET poliza_id = NULL WHERE poliza_id IN ${marca}`, ...listaIds)
  corre(`UPDATE polizas SET poliza_anterior_id = NULL WHERE poliza_anterior_id IN ${marca}`, ...listaIds)
  corre(`DELETE FROM polizas WHERE id IN ${marca}`, ...listaIds)
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

/**
 * Es la cascada más grande: se va la persona y con ella sus vehículos, sus pólizas, cada mes que pagó y
 * cada mes que no, sus siniestros con los documentos que se les adjuntaron, y lo que se le presupuestó.
 *
 * Lo único que NO se va es el lead del que salió: queda sin cliente asociado. Un lead es de dónde vino
 * una venta, y borrarlo mentiría sobre el mes en que entró y sobre el canal que lo trajo.
 */
function planDeCliente(id: number): Plan {
  const c = una('SELECT * FROM clientes WHERE id = ?', id)
  if (!c) noSeEncontro('cliente')

  const delCliente = igual('cliente_id', id)
  // El auto que este cliente vendió y que el comprador aseguró acá es LA MISMA fila (la clave de un
  // vehículo es la patente a secas): ése no se borra, se desenlaza. Y por eso tampoco se cuenta entre
  // lo que se borra: el cartel promete lo que va a pasar, ni uno más.
  const vehiculoDeOtro: Condicion = {
    donde:
      'EXISTS (SELECT 1 FROM polizas p WHERE p.vehiculo_id = vehiculos.id AND p.cliente_id <> ?)' +
      ' OR EXISTS (SELECT 1 FROM bajas b WHERE b.vehiculo_id = vehiculos.id AND b.cliente_id IS NOT NULL AND b.cliente_id <> ?)',
    parametros: [id, id],
  }
  const polizaIds = ids('SELECT id FROM polizas WHERE cliente_id = ?', id)
  const dePoliza = dentroDe('poliza_id', polizaIds)
  const suyo = alguna(delCliente, dePoliza)

  const siniestroIds = ids(`SELECT id FROM siniestros WHERE ${suyo.donde}`, ...suyo.parametros)
  const presupuestoIds = ids('SELECT id FROM presupuestos WHERE cliente_id = ?', id)
  const renovacionIds = ids(`SELECT id FROM renovaciones WHERE ${dePoliza.donde}`, ...dePoliza.parametros)
  const deTareas = alguna(
    delCliente,
    dePoliza,
    dentroDe('siniestro_id', siniestroIds),
    dentroDe('presupuesto_id', presupuestoIds),
    dentroDe('renovacion_id', renovacionIds),
  )
  const tareaIds = ids(`SELECT id FROM tareas WHERE ${deTareas.donde}`, ...deTareas.parametros)

  const grupos = [
    grupo('póliza', 'polizas', delCliente, false),
    grupo('vehículo', 'vehiculos', salvo(delCliente, vehiculoDeOtro), false),
    grupo('cuota del mes', 'cuotas_mes', suyo),
    grupo('baja', 'bajas', suyo),
    grupo('pago', 'pagos', suyo),
    grupo('riesgo vario', 'riesgos_varios', delCliente),
    grupo('ampliación', 'amp', suyo),
    grupo('siniestro', 'siniestros', suyo),
    grupo('aviso de rechazo', 'rechazos_debito', suyo),
    grupo('presupuesto', 'presupuestos', delCliente),
    grupo('tarea', 'tareas', dentroDe('id', tareaIds)),
    grupo('nota', 'notas', delCliente, false),
    grupo('renovación en seguimiento', 'renovaciones', dePoliza, false),
  ]

  const advertencias: string[] = []

  const polizasVigentes = cuantos('SELECT COUNT(*) AS n FROM polizas WHERE cliente_id = ? AND activa = 1', id)
  if (polizasVigentes > 0) {
    advertencias.push(
      `Esta persona está asegurada HOY: ${resumenDeLoBorrado([{ que: 'póliza', cuantos: polizasVigentes }])} vigentes. ` +
        'Si lo que pasó es que se fue, lo que corresponde es darla de baja, no borrarla.',
    )
  }

  // La misma condición que decide el grupo de arriba, del otro lado: los que sobreviven. Sale de
  // `vehiculoDeOtro` y no de un SQL escrito de nuevo justamente para que las dos cuentas no puedan
  // separarse (los que se borran + los que quedan = todos los del cliente, siempre).
  const compartidos = ambas(delCliente, vehiculoDeOtro)
  const vehiculosCompartidos = cuantos(`SELECT COUNT(*) AS n FROM vehiculos WHERE ${compartidos.donde}`, ...compartidos.parametros)
  if (vehiculosCompartidos > 0) {
    advertencias.push(
      `${resumenDeLoBorrado([{ que: 'vehículo', cuantos: vehiculosCompartidos }])} figuran también en la póliza de ` +
        'otro cliente (el auto se vendió y el comprador se aseguró acá): ésos no se borran, quedan sin dueño.',
    )
  }

  const leadsQueQuedan = cuantos('SELECT COUNT(*) AS n FROM leads WHERE cliente_id = ?', id)
  if (leadsQueQuedan > 0) {
    advertencias.push(
      `${resumenDeLoBorrado([{ que: 'lead', cuantos: leadsQueQuedan }])} que terminaron en este cliente NO se borran: ` +
        'quedan sin cliente asociado. Un lead es de dónde salió una venta y las métricas del mes lo cuentan.',
    )
  }

  return {
    tabla: 'clientes',
    filaId: algo(c.fila_id),
    titulo: juntar(algo(c.nombre) ?? 'Sin nombre', algo(c.documento) ? `DNI/CUIT ${String(c.documento)}` : null),
    detalle: [
      juntar(algo(c.telefono), algo(c.email)),
      juntar(algo(c.sucursal_texto), algo(c.localidad), algo(c.direccion)),
    ].filter((l) => l !== ''),
    arrastra: contarGrupos(grupos),
    ...deLaHoja(grupos),
    archivos: [
      ...archivosDe('siniestro_adjuntos', 'siniestro_id', siniestroIds),
      ...archivosDe('tarea_adjuntos', 'tarea_id', tareaIds),
    ],
    advertencias,
    instantanea: { cliente: c },
    ejecutar: () => {
      borrarTareas(tareaIds)
      borrarSiniestros(siniestroIds)
      borrarPresupuestos(presupuestoIds)
      borrarPolizas(polizaIds)
      // Lo que quedó colgando del cliente y no de una póliza suya (lo importado de la hoja sin póliza
      // enlazada, sobre todo).
      corre('DELETE FROM rechazos_debito WHERE cliente_id = ?', id)
      corre('DELETE FROM amp WHERE cliente_id = ?', id)
      corre('DELETE FROM riesgos_varios WHERE cliente_id = ?', id)
      corre('DELETE FROM pagos WHERE cliente_id = ?', id)
      corre('DELETE FROM bajas WHERE cliente_id = ?', id)
      corre('DELETE FROM cuotas_mes WHERE cliente_id = ?', id)
      corre('DELETE FROM notas WHERE cliente_id = ?', id)
      corre('UPDATE leads SET cliente_id = NULL, convertido_en = NULL WHERE cliente_id = ?', id)
      // Los vehículos, al final y en dos pasos. La clave de un vehículo es la patente a secas
      // (`PAT:AB123CD`, ver `claveDeVehiculo` en polizas.ts), no lleva el cliente adentro: el auto que
      // esta persona vendió y que el comprador aseguró en la agencia es LA MISMA fila. Borrarla le
      // dejaría la póliza sin vehículo al otro, así que la que todavía nombra alguien se desenlaza y se
      // borran nada más las que ya no le sirven a nadie. Para acá las pólizas y las bajas de este
      // cliente ya no existen: lo que quede apuntando es de otro.
      corre(
        `UPDATE vehiculos SET cliente_id = NULL, actualizado_en = ?
         WHERE cliente_id = ?
           AND (id IN (SELECT vehiculo_id FROM polizas WHERE vehiculo_id IS NOT NULL)
             OR id IN (SELECT vehiculo_id FROM bajas WHERE vehiculo_id IS NOT NULL))`,
        ahoraIso(),
        id,
      )
      corre('DELETE FROM vehiculos WHERE cliente_id = ?', id)
      corre('DELETE FROM clientes WHERE id = ?', id)
    },
  }
}

// ---------------------------------------------------------------------------
// Póliza
// ---------------------------------------------------------------------------

function planDePoliza(id: number): Plan {
  const p = una(
    `SELECT p.*, c.nombre AS de_quien, c.documento AS documento, v.patente AS patente
     FROM polizas p
     LEFT JOIN clientes c ON c.id = p.cliente_id
     LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
     WHERE p.id = ?`,
    id,
  )
  if (!p) noSeEncontro('poliza')

  const dePoliza = igual('poliza_id', id)
  const siniestroIds = ids('SELECT id FROM siniestros WHERE poliza_id = ?', id)
  const renovacionIds = ids('SELECT id FROM renovaciones WHERE poliza_id = ?', id)
  const deTareas = alguna(dePoliza, dentroDe('siniestro_id', siniestroIds), dentroDe('renovacion_id', renovacionIds))
  const tareaIds = ids(`SELECT id FROM tareas WHERE ${deTareas.donde}`, ...deTareas.parametros)

  const grupos = [
    grupo('cuota del mes', 'cuotas_mes', dePoliza),
    grupo('baja', 'bajas', dePoliza),
    grupo('pago', 'pagos', dePoliza),
    grupo('ampliación', 'amp', dePoliza),
    grupo('siniestro', 'siniestros', dePoliza),
    grupo('aviso de rechazo', 'rechazos_debito', dePoliza),
    grupo('tarea', 'tareas', dentroDe('id', tareaIds)),
    grupo('renovación en seguimiento', 'renovaciones', dePoliza, false),
  ]

  const presupuestosQueQuedan = cuantos('SELECT COUNT(*) AS n FROM presupuestos WHERE poliza_id = ?', id)
  const advertencias: string[] = ['El cliente y su vehículo NO se borran: sigue en la cartera, sin esta póliza.']
  if (presupuestosQueQuedan > 0) {
    advertencias.push(
      `${resumenDeLoBorrado([{ que: 'presupuesto', cuantos: presupuestosQueQuedan }])} que terminaron en esta póliza ` +
        'quedan sin póliza asociada. No se borran: son las cotizaciones que se le hicieron.',
    )
  }

  return {
    tabla: 'polizas',
    filaId: algo(p.fila_id),
    titulo: juntar(algo(p.de_quien) ?? 'Sin cliente', algo(p.compania), algo(p.numero), algo(p.patente)),
    detalle: [
      juntar(algo(p.cobertura), algo(p.forma_pago), algo(p.prima) ? `prima ${String(p.prima)}` : null),
      juntar(
        algo(p.vigencia_desde) ? `desde ${String(p.vigencia_desde)}` : null,
        algo(p.vigencia_hasta) ? `hasta ${String(p.vigencia_hasta)}` : null,
        Number(p.activa) === 1 ? 'activa' : 'dada de baja',
      ),
    ].filter((l) => l !== ''),
    arrastra: contarGrupos(grupos),
    ...deLaHoja(grupos),
    archivos: [
      ...archivosDe('siniestro_adjuntos', 'siniestro_id', siniestroIds),
      ...archivosDe('tarea_adjuntos', 'tarea_id', tareaIds),
    ],
    advertencias,
    instantanea: { poliza: p },
    ejecutar: () => {
      borrarTareas(tareaIds)
      borrarPolizas([id])
    },
  }
}

// ---------------------------------------------------------------------------
// Fila de la planilla del mes
// ---------------------------------------------------------------------------

function planDeCuota(id: number): Plan {
  // El nombre se lee igual que en la pantalla de la que salió el botón: la fila importada puede no
  // traerlo y tenerlo sólo en la ficha del cliente. Un cartel que dice «Sin nombre» sobre un registro
  // que en la tabla de al lado se ve con nombre y apellido es exactamente el que nadie lee.
  const q = una(
    `SELECT c.*, COALESCE(c.cliente_nombre, cl.nombre) AS cliente_nombre
     FROM cuotas_mes c LEFT JOIN clientes cl ON cl.id = c.cliente_id WHERE c.id = ?`,
    id,
  )
  if (!q) noSeEncontro('cuota')
  const filaId = algo(q.fila_id)
  const deLaFila = igual('cuota_fila_id', filaId)

  const grupos = [
    grupo('pago', 'pagos', deLaFila),
    grupo('baja', 'bajas', deLaFila),
    grupo('aviso de rechazo', 'rechazos_debito', deLaFila),
  ]
  const arrastra = contarGrupos(grupos)

  /**
   * El caso que hay que decir entero: ésta es la ÚNICA fila viva que la póliza tiene en el mes ABIERTO
   * y la póliza está vigente.
   *
   * `cerrarMes` arma el mes que viene copiando desde las filas del mes abierto (ver el JOIN con
   * `polizas.activa = 1` en cartera.ts). Una póliza que se queda sin fila en ese mes no tiene de dónde
   * copiarse, así que no se copia nunca más: desaparece de la planilla, de la mora, de la caja y de los
   * deudores, mientras en Pólizas se la sigue viendo activa. Nadie le cobra y nadie se entera.
   *
   * La condición es fina a propósito. No alcanza con «la póliza está vigente»: la planilla puede tener
   * DOS filas de la misma póliza —dos renglones en la hoja con distinto _ID— y sacar la que sobra es
   * justamente para lo que está la papelera. Y en un mes ya cerrado no corresponde ningún aviso, porque
   * el cierre sólo mira el mes más nuevo.
   */
  const mesAbierto = periodosDisponibles()[0]?.periodo ?? null
  const ultimaDelMesAbierto =
    algo(q.poliza_id) !== null &&
    algo(q.periodo) === mesAbierto &&
    Number(q.dada_de_baja) === 0 &&
    cuantos(
      'SELECT COUNT(*) AS n FROM cuotas_mes WHERE poliza_id = ? AND periodo = ? AND dada_de_baja = 0',
      q.poliza_id,
      q.periodo,
    ) === 1 &&
    cuantos('SELECT COUNT(*) AS n FROM polizas WHERE id = ? AND activa = 1', q.poliza_id) === 1

  const advertencias = ultimaDelMesAbierto
    ? [
        'Ésta es la única fila que la póliza tiene en el mes abierto, y la póliza está VIGENTE. La póliza no se ' +
          'borra, pero queda fuera de la planilla: el cierre de mes copia el mes que viene desde estas filas, así ' +
          'que no se la va a copiar nunca más y no se le va a cobrar, aunque en Pólizas se siga viendo como activa. ' +
          'Si lo que pasó es que se fue, lo que corresponde es Dar de baja, que deja constancia. Si igual la borrás, ' +
          'para devolverla hay que darla de baja desde Pólizas y después «Poner vigente» en Bajas.',
      ]
    : ['La póliza y el cliente no se tocan: esto borra la fila de ESTE mes y nada más.']
  if (arrastra.some((l) => l.que === 'pago')) {
    advertencias.push(
      'Entre lo que se borra hay plata ya cobrada: el pago desaparece también de la caja del día y de la rendición de imputados.',
    )
  }
  if (Number(q.dada_de_baja) === 1) {
    advertencias.push('Esta fila ya estaba dada de baja, así que no se ve en la planilla. Su baja también se borra.')
  }

  return {
    tabla: 'cuotas_mes',
    filaId,
    titulo: juntar(algo(q.cliente_nombre) ?? 'Sin nombre', algo(q.compania), algo(q.numero_poliza), algo(q.patente)),
    detalle: [
      juntar(algo(q.periodo), algo(q.cuota) ? `cuota ${String(q.cuota)}` : null, algo(q.dia_vencimiento) ? `vence ${String(q.dia_vencimiento)}` : null),
      juntar(algo(q.sucursal_texto), algo(q.pago) ? `pago: ${String(q.pago)}` : 'sin pagar'),
    ].filter((l) => l !== ''),
    arrastra,
    ...deLaHoja([grupo('la fila', 'cuotas_mes', igual('id', id)), ...grupos]),
    archivos: [],
    advertencias,
    instantanea: { cuota: q },
    ejecutar: () => {
      corre('DELETE FROM pagos WHERE cuota_fila_id = ?', filaId)
      corre('DELETE FROM bajas WHERE cuota_fila_id = ?', filaId)
      corre('DELETE FROM rechazos_debito WHERE cuota_fila_id = ?', filaId)
      corre('DELETE FROM cuotas_mes WHERE id = ?', id)
    },
  }
}

// ---------------------------------------------------------------------------
// Baja
// ---------------------------------------------------------------------------

function planDeBaja(id: number): Plan {
  // El nombre se lee igual que en la pantalla de la que salió el botón: la fila importada puede no
  // traerlo y tenerlo sólo en la ficha del cliente. Un cartel que dice «Sin nombre» sobre un registro
  // que en la tabla de al lado se ve con nombre y apellido es exactamente el que nadie lee.
  const b = una(
    `SELECT j.*, COALESCE(j.cliente_nombre, cl.nombre) AS cliente_nombre
     FROM bajas j LEFT JOIN clientes cl ON cl.id = j.cliente_id WHERE j.id = ?`,
    id,
  )
  if (!b) noSeEncontro('baja')

  const advertencias = [
    'Borrar la baja NO devuelve nada a la cartera: para eso están «Deshacer» y «Poner vigente», que son otro ' +
      'botón. Acá sólo se borra el registro de que esta póliza se dio de baja.',
  ]
  if (algo(b.poliza_id) !== null) {
    advertencias.push(
      'La póliza queda dada de baja pero sin motivo ni fecha a la vista: el listado de Pólizas los saca de ' +
        'esta misma baja. Tampoco va a estar en el reporte de bajas ni en las métricas del mes.',
    )
  }
  if (algo(b.cuota_fila_id) !== null) {
    advertencias.push(
      'Su fila del mes queda marcada como dada de baja y sin baja que lo explique: deja de verse en los dos ' +
        'lados, ni en la planilla ni acá.',
    )
  }

  return {
    tabla: 'bajas',
    filaId: algo(b.fila_id),
    titulo: juntar(algo(b.cliente_nombre) ?? 'Sin nombre', algo(b.compania), algo(b.numero_poliza), algo(b.patente)),
    detalle: [
      juntar(algo(b.motivo) ?? 'sin motivo', algo(b.fecha_baja), algo(b.periodo)),
      juntar(algo(b.sucursal_texto), algo(b.nota)),
    ].filter((l) => l !== ''),
    arrastra: [],
    ...deLaHoja([grupo('la baja', 'bajas', igual('id', id))]),
    archivos: [],
    advertencias,
    instantanea: { baja: b },
    ejecutar: () => {
      corre('DELETE FROM bajas WHERE id = ?', id)
    },
  }
}

// ---------------------------------------------------------------------------
// Aviso de rechazo del débito
// ---------------------------------------------------------------------------

function planDeRechazo(id: number): Plan {
  // El nombre se lee igual que en la pantalla de la que salió el botón: la fila importada puede no
  // traerlo y tenerlo sólo en la ficha del cliente. Un cartel que dice «Sin nombre» sobre un registro
  // que en la tabla de al lado se ve con nombre y apellido es exactamente el que nadie lee.
  const r = una(
    `SELECT d.*, COALESCE(d.cliente_nombre, cl.nombre) AS cliente_nombre
     FROM rechazos_debito d LEFT JOIN clientes cl ON cl.id = d.cliente_id WHERE d.id = ?`,
    id,
  )
  if (!r) noSeEncontro('rechazo')

  return {
    tabla: 'rechazos_debito',
    filaId: algo(r.fila_id),
    titulo: juntar(algo(r.cliente_nombre) ?? 'Sin nombre', algo(r.compania), algo(r.numero_poliza), algo(r.patente)),
    detalle: [
      juntar(algo(r.motivo) ?? 'sin motivo', algo(r.estado), algo(r.fecha)),
      juntar(algo(r.sucursal_texto), algo(r.telefono), algo(r.nota)),
    ].filter((l) => l !== ''),
    arrastra: [],
    ...deLaHoja([grupo('el aviso', 'rechazos_debito', igual('id', id))]),
    archivos: [],
    advertencias: [
      'La computadora de la sucursal avisada ya tiene su propia copia del aviso: sacarlo de la hoja no lo borra ' +
        'allá. Si molesta, hay que borrarlo también desde esa computadora.',
    ],
    instantanea: { rechazo: r },
    ejecutar: () => {
      corre('DELETE FROM rechazos_debito WHERE id = ?', id)
    },
  }
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

function planDeLead(id: number): Plan {
  const l = una('SELECT * FROM leads WHERE id = ?', id)
  if (!l) noSeEncontro('lead')

  const tareaIds = ids('SELECT id FROM tareas WHERE lead_id = ?', id)
  const grupos = [
    grupo('nota del lead', 'lead_notas', igual('lead_id', id), false),
    grupo('tarea', 'tareas', dentroDe('id', tareaIds)),
  ]

  const advertencias: string[] = []
  const presupuestosQueQuedan = cuantos('SELECT COUNT(*) AS n FROM presupuestos WHERE lead_id = ?', id)
  if (presupuestosQueQuedan > 0) {
    advertencias.push(
      `${resumenDeLoBorrado([{ que: 'presupuesto', cuantos: presupuestosQueQuedan }])} hechos para este lead NO se borran: ` +
        'quedan sin lead asociado.',
    )
  }
  if (algo(l.cliente_id) !== null) {
    advertencias.push('Este lead ya se había convertido en cliente. El cliente NO se borra: sigue en la cartera.')
  }

  return {
    tabla: 'leads',
    filaId: algo(l.fila_id),
    titulo: juntar(algo(l.nombre) ?? 'Sin nombre', algo(l.telefono), algo(l.documento) ? `DNI/CUIT ${String(l.documento)}` : null),
    detalle: [
      juntar(algo(l.estado), algo(l.origen), algo(l.sucursal_texto)),
      juntar(algo(l.interes), algo(l.usuario_nombre) ? `cargó ${String(l.usuario_nombre)}` : null),
    ].filter((l2) => l2 !== ''),
    arrastra: contarGrupos(grupos),
    ...deLaHoja([grupo('el lead', 'leads', igual('id', id)), ...grupos]),
    archivos: archivosDe('tarea_adjuntos', 'tarea_id', tareaIds),
    advertencias,
    instantanea: { lead: l },
    ejecutar: () => {
      borrarTareas(tareaIds)
      corre('DELETE FROM lead_notas WHERE lead_id = ?', id)
      corre('UPDATE presupuestos SET lead_id = NULL WHERE lead_id = ?', id)
      corre('DELETE FROM leads WHERE id = ?', id)
    },
  }
}

// ---------------------------------------------------------------------------
// Presupuesto
// ---------------------------------------------------------------------------

/**
 * Se va el presupuesto ENTERO, con todas sus versiones: las versiones son el mismo presupuesto contado
 * de nuevo (comparten el número, ver la migración 9), y dejar la versión 1 colgando de una versión 2 que
 * ya no existe sería dejar algo que ninguna pantalla muestra y que nadie puede borrar después.
 */
function planDePresupuesto(id: number): Plan {
  const p = una('SELECT * FROM presupuestos WHERE id = ?', id)
  if (!p) noSeEncontro('presupuesto')

  const numero = algo(p.numero)
  const versionIds = ids('SELECT id FROM presupuestos WHERE numero = ?', numero)
  const deLasVersiones = dentroDe('presupuesto_id', versionIds)
  const tareaIds = ids(`SELECT id FROM tareas WHERE ${dentroDe('presupuesto_id', versionIds).donde}`, ...versionIds)

  const grupos = [
    grupo('versión del presupuesto', 'presupuestos', dentroDe('id', versionIds)),
    grupo('opción del presupuesto', 'presupuesto_opciones', deLasVersiones, false),
    grupo('tarea', 'tareas', dentroDe('id', tareaIds)),
  ]

  return {
    tabla: 'presupuestos',
    filaId: algo(p.fila_id),
    titulo: juntar(`${numero ?? 'Sin número'}`, algo(p.cliente_nombre), algo(p.patente), algo(p.marca), algo(p.modelo)),
    detalle: [
      juntar(algo(p.estado), `versión ${String(p.version)}`, algo(p.sucursal_texto)),
      juntar(algo(p.telefono), algo(p.usuario_nombre) ? `cargó ${String(p.usuario_nombre)}` : null),
    ].filter((l) => l !== ''),
    arrastra: contarGrupos(grupos),
    ...deLaHoja(grupos),
    archivos: archivosDe('tarea_adjuntos', 'tarea_id', tareaIds),
    advertencias: [
      ...(versionIds.length > 1 ? [`Se borran las ${versionIds.length} versiones de ${numero}, no sólo la que estás mirando.`] : []),
      // `siguienteNumero()` en presupuestos.ts sale del máximo que hay en la tabla: borrando el último,
      // el próximo presupuesto nace con el mismo número. Es un número visible, que la gente anota.
      `Si ${numero} era el último número dado, el próximo presupuesto va a volver a llamarse ${numero}.`,
      // `marcarLeadCotizado` lo puso en COTIZADO al crearlo y el borrado no lo revierte: volver a
      // adivinar en qué estado estaba antes sería inventar.
      ...(algo(p.lead_id) !== null
        ? ['El lead del que salió queda marcado como COTIZADO aunque ya no tenga ningún presupuesto: revisalo.']
        : []),
    ],
    instantanea: { presupuesto: p, versiones: versionIds.length },
    ejecutar: () => {
      borrarTareas(tareaIds)
      borrarPresupuestos(versionIds)
    },
  }
}

// ---------------------------------------------------------------------------
// Siniestro
// ---------------------------------------------------------------------------

function planDeSiniestro(id: number): Plan {
  // El nombre se lee igual que en la pantalla de la que salió el botón: la fila importada puede no
  // traerlo y tenerlo sólo en la ficha del cliente. Un cartel que dice «Sin nombre» sobre un registro
  // que en la tabla de al lado se ve con nombre y apellido es exactamente el que nadie lee.
  const s = una(
    `SELECT n.*, COALESCE(n.cliente_nombre, cl.nombre) AS cliente_nombre
     FROM siniestros n LEFT JOIN clientes cl ON cl.id = n.cliente_id WHERE n.id = ?`,
    id,
  )
  if (!s) noSeEncontro('siniestro')

  const tareaIds = ids('SELECT id FROM tareas WHERE siniestro_id = ?', id)
  const grupos = [
    grupo('observación del siniestro', 'siniestro_observaciones', igual('siniestro_id', id), false),
    grupo('documento adjunto', 'siniestro_adjuntos', igual('siniestro_id', id), false),
    grupo('tarea', 'tareas', dentroDe('id', tareaIds)),
  ]

  return {
    tabla: 'siniestros',
    filaId: algo(s.fila_id),
    titulo: juntar(algo(s.cliente_nombre) ?? 'Sin nombre', algo(s.compania), algo(s.numero_siniestro), algo(s.patente)),
    detalle: [
      juntar(algo(s.estado), algo(s.fecha), algo(s.sucursal_texto)),
      juntar(algo(s.descripcion), algo(s.importe)),
    ].filter((l) => l !== ''),
    arrastra: contarGrupos(grupos),
    ...deLaHoja([grupo('el siniestro', 'siniestros', igual('id', id)), ...grupos]),
    archivos: [
      ...archivosDe('siniestro_adjuntos', 'siniestro_id', [id]),
      ...archivosDe('tarea_adjuntos', 'tarea_id', tareaIds),
    ],
    advertencias: [],
    instantanea: { siniestro: s },
    ejecutar: () => {
      borrarTareas(tareaIds)
      borrarSiniestros([id])
    },
  }
}

// ---------------------------------------------------------------------------
// Riesgo vario y AMP
// ---------------------------------------------------------------------------

function planDeRiesgo(id: number): Plan {
  // El nombre se lee igual que en la pantalla de la que salió el botón: la fila importada puede no
  // traerlo y tenerlo sólo en la ficha del cliente. Un cartel que dice «Sin nombre» sobre un registro
  // que en la tabla de al lado se ve con nombre y apellido es exactamente el que nadie lee.
  const r = una(
    `SELECT v.*, COALESCE(v.cliente_nombre, cl.nombre) AS cliente_nombre
     FROM riesgos_varios v LEFT JOIN clientes cl ON cl.id = v.cliente_id WHERE v.id = ?`,
    id,
  )
  if (!r) noSeEncontro('riesgo')
  return {
    tabla: 'riesgos_varios',
    filaId: algo(r.fila_id),
    titulo: juntar(algo(r.cliente_nombre) ?? 'Sin nombre', algo(r.tipo_riesgo), algo(r.compania), algo(r.numero_poliza)),
    detalle: [
      juntar(algo(r.descripcion), algo(r.cuota) ? `cuota ${String(r.cuota)}` : null, algo(r.dia_vencimiento)),
      juntar(algo(r.sucursal_texto), algo(r.telefono), algo(r.observaciones)),
    ].filter((l) => l !== ''),
    arrastra: [],
    ...deLaHoja([grupo('el riesgo', 'riesgos_varios', igual('id', id))]),
    archivos: [],
    advertencias: [],
    instantanea: { riesgo: r },
    ejecutar: () => {
      corre('DELETE FROM riesgos_varios WHERE id = ?', id)
    },
  }
}

function planDeAmp(id: number): Plan {
  // El nombre se lee igual que en la pantalla de la que salió el botón: la fila importada puede no
  // traerlo y tenerlo sólo en la ficha del cliente. Un cartel que dice «Sin nombre» sobre un registro
  // que en la tabla de al lado se ve con nombre y apellido es exactamente el que nadie lee.
  const a = una(
    `SELECT m.*, COALESCE(m.cliente_nombre, cl.nombre) AS cliente_nombre
     FROM amp m LEFT JOIN clientes cl ON cl.id = m.cliente_id WHERE m.id = ?`,
    id,
  )
  if (!a) noSeEncontro('amp')
  return {
    tabla: 'amp',
    filaId: algo(a.fila_id),
    titulo: juntar(algo(a.cliente_nombre) ?? 'Sin nombre', algo(a.compania), algo(a.numero_poliza), algo(a.patente)),
    detalle: [
      juntar(algo(a.detalle), algo(a.fecha), algo(a.vencimiento) ? `vence ${String(a.vencimiento)}` : null),
      juntar(algo(a.sucursal_texto), Number(a.resuelto) === 1 ? 'resuelta' : 'pendiente', algo(a.observaciones)),
    ].filter((l) => l !== ''),
    arrastra: [],
    ...deLaHoja([grupo('la ampliación', 'amp', igual('id', id))]),
    archivos: [],
    advertencias: [
      'Si lo que querés es sacarla de la lista sin perderla, tildá «Resuelta»: para eso está esa columna.',
    ],
    instantanea: { amp: a },
    ejecutar: () => {
      corre('DELETE FROM amp WHERE id = ?', id)
    },
  }
}

// ---------------------------------------------------------------------------
// Tarea
// ---------------------------------------------------------------------------

function planDeTarea(id: number): Plan {
  const t = una('SELECT * FROM tareas WHERE id = ?', id)
  if (!t) noSeEncontro('tarea')

  const grupos = [
    grupo('comentario de la tarea', 'tarea_comentarios', igual('tarea_id', id), false),
    grupo('archivo adjunto', 'tarea_adjuntos', igual('tarea_id', id), false),
  ]

  return {
    tabla: 'tareas',
    filaId: algo(t.fila_id),
    titulo: algo(t.titulo) ?? 'Sin título',
    detalle: [
      juntar(algo(t.estado), algo(t.prioridad), algo(t.vence_el) ? `vence ${String(t.vence_el)}` : null),
      juntar(algo(t.responsable_nombre) ? `de ${String(t.responsable_nombre)}` : null, algo(t.sucursal_texto), algo(t.detalle)),
    ].filter((l) => l !== ''),
    arrastra: contarGrupos(grupos),
    ...deLaHoja([grupo('la tarea', 'tareas', igual('id', id))]),
    archivos: archivosDe('tarea_adjuntos', 'tarea_id', [id]),
    advertencias: [],
    instantanea: { tarea: t },
    ejecutar: () => {
      borrarTareas([id])
    },
  }
}

// ---------------------------------------------------------------------------
// Lo que se llama desde afuera
// ---------------------------------------------------------------------------

/** Cuánto de la foto del registro entra en el historial. Es un archivo, no una pantalla. */
const LARGO_MAXIMO_DE_LA_FOTO = 4000

/**
 * El rol se controla dos veces a propósito. `ipc.ts` ya exige SUPER_ADMIN antes de llamar acá —es lo que
 * hace con Usuarios y con Permisos— pero un borrado definitivo se merece que la regla esté también en el
 * servicio: así queda escrita al lado de lo que borra, no en otro archivo, y una prueba puede
 * comprobarla sin levantar el proceso de Electron entero.
 */
function exigirSuperAdmin(actor: SesionUsuario): void {
  if (actor.rol !== 'SUPER_ADMIN') {
    throw new ErrorDeNegocio('Borrar registros de la base es sólo del superadministrador.')
  }
}

/** El renderer no es confiable: lo que llega por IPC se revisa acá, como en todos los servicios. */
function pedido(tipoCrudo: unknown, idCrudo: unknown): { tipo: TipoEliminable; id: number } {
  if (!esTipoEliminable(tipoCrudo)) throw new ErrorDeNegocio('No se sabe qué tipo de registro se quiere borrar.')
  const nombre = NOMBRE_ELIMINABLE[tipoCrudo]
  return { tipo: tipoCrudo, id: enteroPositivo(idCrudo, `${nombre.articulo === 'el' ? 'El' : 'La'} ${nombre.singular}`) }
}

/**
 * El renglón que quede en la hoja de Google es la única forma de que lo borrado vuelva: la importación
 * completa lee la hoja, no la base. Mientras la subida no lo saque, conviene no reimportar.
 */
/**
 * Qué pestañas sabe reconstruir la importación completa. Importa para no mentir en el cartel: una
 * reimportación vuelve a crear el cliente, la póliza, la cuota, la baja, el riesgo, la ampliación, el
 * siniestro y el aviso de rechazo desde la hoja —APP RECHAZOS es la única pestaña de la aplicación que
 * el importador lee de vuelta a su tabla (ver el switch de `importador.ts`)— pero NO los leads, los
 * presupuestos ni las tareas: de esas pestañas sólo guarda las filas crudas.
 */
const VUELVE_CON_LA_REIMPORTACION: Record<TipoEliminable, boolean> = {
  cliente: true,
  poliza: true,
  cuota: true,
  baja: true,
  rechazo: true,
  riesgo: true,
  amp: true,
  siniestro: true,
  lead: false,
  presupuesto: false,
  tarea: false,
}

function avisosDeLaSincronizacion(tipo: TipoEliminable, renglones: number, archivos: number): string[] {
  const avisos: string[] = []
  if (renglones > 0) {
    if (VUELVE_CON_LA_REIMPORTACION[tipo]) {
      avisos.push(
        'Los renglones salen de la hoja de Google recién cuando la sincronización llegue a subirlos, y hasta ' +
          'entonces una importación completa de la hoja volvería a crear lo que se borró. Fijate que la cola ' +
          'quede vacía en Administración → Sincronización antes de reimportar.',
      )
    }
    // Cada computadora tiene su propia base y lo único que viaja es la hoja. Cuando una fila desaparece
    // de la hoja, la bajada de la otra PC la marca como «ya no está» (bajada.ts) pero NO borra lo que ya
    // había guardado. Decirlo es parte del trabajo: quien borra tiene que saber dónde sigue estando.
    avisos.push(
      'Las otras computadoras de la agencia conservan su propia copia: el renglón desaparece de la hoja, ' +
        'pero lo que cada una ya tenía guardado sigue ahí hasta que se borre también desde esa computadora.',
    )
  }
  if (archivos > 0) {
    avisos.push('La copia de los adjuntos que esté en el Drive no se borra: eso hay que sacarlo desde Google.')
  }
  return avisos
}

/** Lo que el cartel muestra antes de confirmar. No toca nada. */
export function vistaPreviaDeEliminacion(tipoCrudo: unknown, idCrudo: unknown, actor: SesionUsuario): VistaPreviaDeEliminacion {
  exigirSuperAdmin(actor)
  const { tipo, id } = pedido(tipoCrudo, idCrudo)
  const plan = planDe(tipo, id)
  return {
    tipo,
    id,
    titulo: plan.titulo,
    detalle: plan.detalle,
    arrastra: plan.arrastra,
    filasDeLaHoja: plan.renglones.length,
    archivos: plan.archivos.length,
    advertencias: [...plan.advertencias, ...avisosDeLaSincronizacion(tipo, plan.renglones.length, plan.archivos.length)],
  }
}

/**
 * Borra de verdad. El orden importa:
 *   1. la base local, en UNA transacción: o se va todo o no se va nada;
 *   2. los renglones de la hoja, encolados después de que la transacción cerró bien (igual que
 *      `darDeBaja` en cartera.ts): si el borrado local falla, no se le pide a Google que borre nada;
 *   3. los archivos del disco, al final: son lo único que no se puede deshacer con un ROLLBACK.
 */
export function eliminarRegistro(tipoCrudo: unknown, idCrudo: unknown, actor: SesionUsuario): ResultadoDeEliminacion {
  exigirSuperAdmin(actor)
  const { tipo, id } = pedido(tipoCrudo, idCrudo)
  const plan = planDe(tipo, id)
  const nombre = NOMBRE_ELIMINABLE[tipo]
  const resumen = resumenDeLoBorrado(plan.arrastra)

  try {
    db().transaction(() => {
      plan.ejecutar()
      cancelarPendientes(plan.filas)
      // Los borrados de la hoja se anotan DENTRO de la transacción, como dice el encabezado de cola.ts:
      // si el borrado local se cae, no queda nadie pidiéndole a Google que saque nada; y si sale bien,
      // no hay ninguna ventana en la que la aplicación pueda cerrarse con lo local borrado y la hoja
      // intacta.
      for (const salida of plan.paraSacar) {
        encolar({ operacion: 'borrar', pestana: salida.pestana, filaId: salida.filaId, campos: {} }, actor)
      }
      registrarCambio(actor, {
        accion: 'eliminacion',
        tabla: plan.tabla,
        registroId: id,
        filaId: plan.filaId,
        campo: `ELIMINÓ ${nombre.singular.toUpperCase()}`,
        // La foto completa del registro va detrás del resumen: nadie la lee todos los días, pero el día
        // que alguien pregunte «¿qué decía la póliza que borramos?» la respuesta tiene que existir.
        valorAnterior: `${plan.titulo}${resumen ? ` · con ${resumen}` : ''}\n${JSON.stringify(plan.instantanea)}`.slice(
          0,
          LARGO_MAXIMO_DE_LA_FOTO,
        ),
        valorNuevo: null,
      })
    })()
  } catch (error) {
    throw new ErrorDeNegocio(porQueNoSePudo(tipo, error))
  }

  // Los archivos, al final y sin poder voltear nada: el registro YA se borró y la transacción cerró.
  // En Windows un adjunto abierto en otro programa hace fallar el borrado del archivo (EBUSY), y dejar
  // que esa excepción suba diría «no se pudo borrar» sobre algo que sí se borró. Se cuenta y se sigue.
  let archivos = 0
  for (const relativa of plan.archivos) {
    try {
      if (existsSync(rutaDeAdjunto(relativa))) archivos++
      borrarArchivoDeAdjunto(relativa)
    } catch (error) {
      console.error(`[eliminacion] No se pudo borrar el adjunto ${relativa}:`, error)
    }
  }

  return {
    tipo,
    id,
    titulo: plan.titulo,
    borrado: plan.arrastra,
    filasDeLaHoja: plan.renglones.length,
    archivos,
  }
}

/**
 * Por qué se cayó. La que más va a aparecer es la de clave foránea: alguna tabla apunta al registro y el
 * plan no la contempló. Es exactamente lo que las claves foráneas están para evitar —la base quedó como
 * estaba— pero el mensaje tiene que decirle a quien lo lea que esto se arregla en el programa, no
 * intentándolo de nuevo.
 */
function porQueNoSePudo(tipo: TipoEliminable, error: unknown): string {
  if (error instanceof ErrorDeNegocio) return error.message
  const mensaje = error instanceof Error ? error.message : String(error)
  if (/FOREIGN KEY/i.test(mensaje)) {
    return (
      `No se pudo borrar ${conArticulo(tipo)}: hay algo más en la base que todavía lo nombra y que este borrado ` +
      'no contempla. No se borró nada. Avisá de este mensaje, que se arregla en el programa.'
    )
  }
  console.error(`[eliminacion] No se pudo borrar ${tipo}:`, error)
  return `No se pudo borrar ${conArticulo(tipo)}. No se borró nada. Revisá el registro de la aplicación.`
}
