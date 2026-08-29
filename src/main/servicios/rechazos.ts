// Avisos de rechazo del débito automático.
//
// El caso real: la agencia manda el archivo de débitos, la compañía le rebota unos cuantos (el CBU no
// tiene fondos, la cuenta se cerró, la tarjeta no pasó) y quien lo ve —normalmente en la administración—
// tiene que avisarle a la sucursal que atiende a ese cliente para que lo llame y lo cobre a mano. Antes
// eso era un WhatsApp suelto; ahora es un botón en la póliza y un aviso que la sucursal ve al entrar.
//
// El aviso viaja a la hoja por la pestaña «APP RECHAZOS». Es la única de las pestañas que escribe la
// aplicación que además se lee de vuelta a su tabla (ver `guardarRechazo` en importacion/importador.ts):
// tiene que serlo, porque la sucursal avisada trabaja en otra computadora y ése es el único camino que
// hay entre las dos. Lo que la sucursal cambia después —el estado y la nota— vuelve por la bajada.
import { hoyLocal, periodoDeHoy } from '../../shared/semaforo'
import { mismaSucursal } from '../../shared/sucursales'
import {
  ESTADOS_DE_RECHAZO,
  MOTIVOS_DE_RECHAZO,
  type AvisosDeRechazos,
  type DatosDeRechazo,
  type EstadoDeRechazo,
  type FilaRechazo,
  type FiltrosRechazos,
  type ListadoRechazos,
  type SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, generarId, limpiar, normalizarTexto } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { PESTANAS_DE_LA_APP } from '../sincronizacion/pestanasApp'
import { periodosDisponibles } from './cartera'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { nombreDePestana } from './hojas'
import { sucursalesParaElegir } from './sucursales'
import { enteroPositivo, objeto } from './validacion'

const PESTANA_POR_DEFECTO = PESTANAS_DE_LA_APP.find((p) => p.tipo === 'APP_RECHAZOS')!.titulo

export function pestanaDeRechazos(): string {
  return nombreDePestana('APP_RECHAZOS', PESTANA_POR_DEFECTO)
}

/**
 * El estado guardado, llevado a los tres que la aplicación entiende. La columna viaja a la hoja y
 * cualquiera puede escribir ahí «resuelto» en minúscula o vaciar la celda: lo que no se reconoce se
 * toma como PENDIENTE, que es el único de los tres que sigue a la vista y por lo tanto el prudente.
 */
function estadoNormalizado(valor: string | null): EstadoDeRechazo {
  const escrito = normalizarTexto(valor)
  return (ESTADOS_DE_RECHAZO as readonly string[]).includes(escrito) ? (escrito as EstadoDeRechazo) : 'PENDIENTE'
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

interface FilaCruda {
  id: number
  fila_id: string | null
  poliza_id: number | null
  cliente_id: number | null
  cliente_nombre: string | null
  documento: string | null
  telefono: string | null
  compania: string | null
  numero_poliza: string | null
  patente: string | null
  forma_pago: string | null
  cuota: string | null
  periodo: string | null
  sucursal_texto: string | null
  motivo: string | null
  nota: string | null
  estado: string | null
  fecha: string
  avisado_por: string | null
  visto_en: string | null
  visto_por: string | null
  resuelto_en: string | null
  resuelto_por: string | null
  creado_en: string
}

const SELECT_RECHAZOS = `
  SELECT id, fila_id, poliza_id, cliente_id, cliente_nombre, documento, telefono, compania, numero_poliza,
         patente, forma_pago, cuota, periodo, sucursal_texto, motivo, nota, estado, fecha, avisado_por,
         visto_en, visto_por, resuelto_en, resuelto_por, creado_en
  FROM rechazos_debito
`

/** Lo sin resolver primero y, dentro de eso, lo más nuevo arriba: es el orden en que hay que llamar. */
const ORDEN = `
  ORDER BY CASE WHEN UPPER(COALESCE(estado, '')) = 'RESUELTO' THEN 1 ELSE 0 END,
           fecha DESC, id DESC
`

function aFila(f: FilaCruda): FilaRechazo {
  return {
    id: f.id,
    filaId: f.fila_id,
    polizaId: f.poliza_id,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    documento: f.documento,
    telefono: f.telefono,
    compania: f.compania,
    numeroPoliza: f.numero_poliza,
    patente: f.patente,
    formaPago: f.forma_pago,
    cuota: f.cuota,
    periodo: f.periodo,
    sucursal: f.sucursal_texto,
    motivo: f.motivo,
    nota: f.nota,
    estado: estadoNormalizado(f.estado),
    fecha: f.fecha,
    avisadoPor: f.avisado_por,
    vistoEn: f.visto_en,
    vistoPor: f.visto_por,
    resueltoEn: f.resuelto_en,
    resueltoPor: f.resuelto_por,
    creadoEn: f.creado_en,
  }
}

function todos(): FilaRechazo[] {
  return (db().prepare(`${SELECT_RECHAZOS} ${ORDEN}`).all() as FilaCruda[]).map(aFila)
}

/**
 * La sucursal de la fila, para comparar. `mismaSucursal` de shared da true con dos vacíos —dos filas
 * sin sucursal son «la misma nada»—, y acá eso avisaría a todo el mundo de un rechazo que no tiene
 * sucursal cargada, así que la fila sin sucursal no empata con nadie.
 */
function esDeLaSucursal(fila: FilaRechazo, sucursal: string | null): boolean {
  return limpiar(fila.sucursal) !== '' && mismaSucursal(fila.sucursal, sucursal)
}

function coincideConLaBusqueda(fila: FilaRechazo, busqueda: string): boolean {
  if (!busqueda) return true
  return [fila.clienteNombre, fila.documento, fila.numeroPoliza, fila.patente, fila.compania, fila.telefono].some((valor) =>
    normalizarTexto(valor).replace(/ /g, '').includes(busqueda),
  )
}

export function listarRechazos(filtros: unknown): ListadoRechazos {
  const f = objeto(filtros, 'Los filtros')
  const busqueda = normalizarTexto(f.busqueda).replace(/ /g, '')
  const sucursal = limpiar(f.sucursal)
  const estado = limpiar(f.estado) as FiltrosRechazos['estado']

  const filas = todos()
  // El contador de cada estado se calcula con todos los filtros MENOS el de estado: si no, tocar
  // «Resueltos» dejaría los otros dos en cero y no se sabría a qué se está volviendo.
  const sinEstado = filas.filter((fila) => (!sucursal || esDeLaSucursal(fila, sucursal)) && coincideConLaBusqueda(fila, busqueda))
  const porEstado: Record<EstadoDeRechazo, number> = { PENDIENTE: 0, VISTO: 0, RESUELTO: 0 }
  for (const fila of sinEstado) porEstado[fila.estado]++

  // Las cuatro de la agencia más las que traigan los avisos. Antes salían sólo las que ya tenían algún
  // rechazo, y la pantalla le prependía a mano la sucursal de quien entró —que puede no tener ninguno
  // todavía y aun así ser la que uno quiere mirar—: media lista acá y media allá. Armada entera desde
  // acá, ese parche de Rechazos.tsx se pudo sacar. Además el `new Set` era sobre el texto crudo, así
  // que «LANUS» y «Lanús» eran dos opciones para el mismo mostrador.
  const sucursales = sucursalesParaElegir(filas.map((fila) => fila.sucursal))

  return {
    filas: estado ? sinEstado.filter((fila) => fila.estado === estado) : sinEstado,
    porEstado,
    total: filas.length,
    sucursales,
    hoy: hoyLocal(),
  }
}

/** Cuántos avisos sin resolver tiene la sucursal de quien entró: es lo que mira la campana. */
export function avisosDeRechazos(actor: SesionUsuario): AvisosDeRechazos {
  const sucursal = actor.sucursal.nombre
  const suyos = todos().filter((fila) => fila.estado !== 'RESUELTO' && esDeLaSucursal(fila, sucursal))
  return {
    nuevos: suyos.filter((fila) => fila.estado === 'PENDIENTE').length,
    // Sin tope, a diferencia de `filas`: son los que deciden si suena el aviso.
    idsNuevos: suyos.filter((fila) => fila.estado === 'PENDIENTE').map((fila) => fila.id),
    sinResolver: suyos.length,
    filas: suyos.slice(0, 12),
    sucursal,
    hoy: hoyLocal(),
  }
}

/** Abrir la campana cuenta como enterarse: lo PENDIENTE de la sucursal pasa a VISTO. */
export function marcarRechazosVistos(actor: SesionUsuario): AvisosDeRechazos {
  const pendientes = todos().filter((fila) => fila.estado === 'PENDIENTE' && esDeLaSucursal(fila, actor.sucursal.nombre))
  for (const fila of pendientes) escribirEstado(fila, 'VISTO', actor, { anotarEnHistorial: false })
  return avisosDeRechazos(actor)
}

// ---------------------------------------------------------------------------
// Alta del aviso
// ---------------------------------------------------------------------------

/** Los datos de la póliza y los de su fila del mes abierto, que es donde están la cuota y la forma de pago. */
interface DatosParaElAviso {
  poliza_id: number
  cliente_id: number | null
  cliente_nombre: string | null
  documento: string | null
  telefono: string | null
  compania: string | null
  numero_poliza: string | null
  patente: string | null
  forma_pago: string | null
  cuota: string | null
  periodo: string | null
  cuota_fila_id: string | null
  sucursal: string | null
}

function datosDeLaPoliza(polizaId: number): DatosParaElAviso {
  // El mes abierto sale de la cartera y no de una consulta propia: si hubiera dos definiciones de
  // «el mes que se está trabajando», tarde o temprano dirían cosas distintas.
  const periodo = periodosDisponibles()[0]?.periodo ?? null
  const fila = db()
    .prepare(
      `SELECT p.id AS poliza_id, p.cliente_id,
              COALESCE(q.cliente_nombre, cl.nombre) AS cliente_nombre,
              COALESCE(q.documento, cl.documento) AS documento,
              cl.telefono,
              COALESCE(q.compania, p.compania) AS compania,
              COALESCE(q.numero_poliza, p.numero) AS numero_poliza,
              COALESCE(q.patente, v.patente) AS patente,
              COALESCE(q.forma_pago, p.forma_pago) AS forma_pago,
              q.cuota, q.periodo, q.fila_id AS cuota_fila_id,
              COALESCE(q.sucursal_texto, cl.sucursal_texto) AS sucursal
       FROM polizas p
       LEFT JOIN clientes cl ON cl.id = p.cliente_id
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       LEFT JOIN cuotas_mes q ON q.id = (
         SELECT id FROM cuotas_mes WHERE poliza_id = p.id AND periodo = @periodo AND dada_de_baja = 0 ORDER BY id LIMIT 1
       )
       WHERE p.id = @poliza`,
    )
    .get({ poliza: polizaId, periodo }) as DatosParaElAviso | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa póliza. Actualizá la pantalla y probá de nuevo.')
  return fila
}

/** Los campos del aviso con los nombres que entiende la sincronización (los de `Campo`). */
function camposParaLaHoja(fila: FilaRechazo): Record<string, string> {
  return {
    fecha: fila.fecha,
    sucursal: fila.sucursal ?? '',
    nombre: fila.clienteNombre ?? '',
    documento: fila.documento ?? '',
    telefono: fila.telefono ?? '',
    compania: fila.compania ?? '',
    numero_poliza: fila.numeroPoliza ?? '',
    patente: fila.patente ?? '',
    forma_pago: fila.formaPago ?? '',
    cuota: fila.cuota ?? '',
    mes: fila.periodo ?? '',
    motivo: fila.motivo ?? '',
    observaciones: fila.nota ?? '',
    estado: fila.estado,
    usuario: fila.avisadoPor ?? '',
  }
}

function buscarPorId(id: number): FilaRechazo {
  const fila = db().prepare(`${SELECT_RECHAZOS} WHERE id = ?`).get(id) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró ese aviso.')
  return aFila(fila)
}

/**
 * En qué pestaña de la hoja vive el aviso. No va en `FilaRechazo` porque es cosa de la sincronización y
 * no tiene nada que hacer en la pantalla; la de por defecto cubre las filas viejas sin pestaña anotada.
 */
function pestanaDelAviso(id: number): string {
  const fila = db().prepare('SELECT pestana FROM rechazos_debito WHERE id = ?').get(id) as { pestana: string | null } | undefined
  return fila?.pestana ?? pestanaDeRechazos()
}

/**
 * Avisa a la sucursal de que a esta póliza le rebotó el débito.
 *
 * Si la póliza ya tiene un aviso sin resolver del mismo mes no se crea otro: se actualiza el que hay y
 * vuelve a quedar PENDIENTE. Apretar el botón dos veces es lo más fácil del mundo, y a la sucursal le
 * tiene que llegar el aviso una vez, no una por clic.
 */
export function avisarRechazo(polizaId: number, datos: DatosDeRechazo, actor: SesionUsuario): FilaRechazo {
  const id = enteroPositivo(polizaId, 'La póliza')
  const d = objeto(datos, 'Los datos del aviso')
  const motivo = limpiar(d.motivo).toUpperCase()
  if (!(MOTIVOS_DE_RECHAZO as readonly string[]).includes(motivo)) {
    throw new ErrorDeNegocio('Elegí un motivo de rechazo de la lista.')
  }
  const nota = limpiar(d.nota).slice(0, 500)
  const poliza = datosDeLaPoliza(id)
  // Sin sucursal el aviso no le llega a nadie: se cae a la de la póliza y, si tampoco, a la de quien avisa.
  const sucursal = limpiar(d.sucursal) || limpiar(poliza.sucursal) || actor.sucursal.nombre
  const periodo = poliza.periodo ?? periodoDeHoy()
  const hoy = hoyLocal()
  const ahora = ahoraIso()

  const existente = db()
    .prepare(
      `SELECT id FROM rechazos_debito
       WHERE poliza_id = ? AND periodo IS ? AND UPPER(COALESCE(estado, '')) <> 'RESUELTO'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(id, periodo) as { id: number } | undefined

  const rechazoId = existente
    ? existente.id
    : Number(
        db()
          .prepare(
            `INSERT INTO rechazos_debito (poliza_id, cliente_id, cuota_fila_id, cliente_nombre, documento, telefono,
                                          compania, numero_poliza, patente, forma_pago, cuota, periodo,
                                          sucursal_texto, motivo, nota, estado, fecha, avisado_por, avisado_por_id,
                                          creado_en, actualizado_en)
             VALUES (@poliza_id, @cliente_id, @cuota_fila_id, @cliente_nombre, @documento, @telefono,
                     @compania, @numero_poliza, @patente, @forma_pago, @cuota, @periodo,
                     @sucursal, @motivo, @nota, 'PENDIENTE', @fecha, @avisado_por, @avisado_por_id,
                     @ahora, @ahora)`,
          )
          .run({
            poliza_id: poliza.poliza_id,
            cliente_id: poliza.cliente_id,
            cuota_fila_id: poliza.cuota_fila_id,
            cliente_nombre: poliza.cliente_nombre,
            documento: poliza.documento,
            telefono: poliza.telefono,
            compania: poliza.compania,
            numero_poliza: poliza.numero_poliza,
            patente: poliza.patente,
            forma_pago: poliza.forma_pago,
            cuota: poliza.cuota,
            periodo,
            sucursal,
            motivo,
            nota: nota || null,
            fecha: hoy,
            avisado_por: actor.nombre,
            avisado_por_id: actor.id,
            ahora,
          }).lastInsertRowid,
      )

  if (existente) {
    db()
      .prepare(
        `UPDATE rechazos_debito SET sucursal_texto = @sucursal, motivo = @motivo, nota = @nota, estado = 'PENDIENTE',
                                    fecha = @fecha, avisado_por = @avisado_por, avisado_por_id = @avisado_por_id,
                                    visto_en = NULL, visto_por = NULL, actualizado_en = @ahora
         WHERE id = @id`,
      )
      .run({ id: rechazoId, sucursal, motivo, nota: nota || null, fecha: hoy, avisado_por: actor.nombre, avisado_por_id: actor.id, ahora })
  }

  subirALaHoja(rechazoId, actor)
  const fila = buscarPorId(rechazoId)
  registrarCambio(actor, {
    accion: 'rechazo_debito',
    tabla: 'rechazos_debito',
    registroId: rechazoId,
    filaId: fila.filaId,
    campo: 'RECHAZO',
    valorAnterior: null,
    valorNuevo: `${motivo} · ${sucursal}${nota ? ` · ${nota}` : ''}`,
  })
  return fila
}

/**
 * Anota la fila para la hoja la primera vez y encola lo que haya que subir. Un aviso que ya tenía fila
 * (el que se reusó porque se apretó el botón dos veces) va como `actualizar`: `crear` de nuevo la
 * duplicaría en la pestaña.
 */
function subirALaHoja(rechazoId: number, actor: SesionUsuario): void {
  const actual = buscarPorId(rechazoId)
  if (!actual.filaId) {
    const filaId = generarId()
    const pestana = pestanaDeRechazos()
    db().transaction(() => {
      db().prepare('UPDATE rechazos_debito SET fila_id = ?, pestana = ? WHERE id = ?').run(filaId, pestana, rechazoId)
      registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'APP_RECHAZOS', periodo: null })
    })()
    encolar({ operacion: 'crear', pestana, filaId, campos: camposParaLaHoja(buscarPorId(rechazoId)) }, actor)
    return
  }
  encolar(
    { operacion: 'actualizar', pestana: pestanaDelAviso(rechazoId), filaId: actual.filaId, campos: camposParaLaHoja(actual) },
    actor,
  )
}

// ---------------------------------------------------------------------------
// Seguimiento
// ---------------------------------------------------------------------------

function escribirEstado(fila: FilaRechazo, estado: EstadoDeRechazo, actor: SesionUsuario, opciones = { anotarEnHistorial: true }): void {
  const ahora = ahoraIso()
  db()
    .prepare(
      `UPDATE rechazos_debito SET estado = @estado, actualizado_en = @ahora,
              visto_en = CASE WHEN @estado = 'PENDIENTE' THEN NULL ELSE COALESCE(visto_en, @ahora) END,
              visto_por = CASE WHEN @estado = 'PENDIENTE' THEN NULL ELSE COALESCE(visto_por, @quien) END,
              resuelto_en = CASE WHEN @estado = 'RESUELTO' THEN @ahora ELSE NULL END,
              resuelto_por = CASE WHEN @estado = 'RESUELTO' THEN @quien ELSE NULL END
       WHERE id = @id`,
    )
    .run({ id: fila.id, estado, ahora, quien: actor.nombre })

  if (fila.filaId) {
    encolar({ operacion: 'actualizar', pestana: pestanaDelAviso(fila.id), filaId: fila.filaId, campos: { estado } }, actor)
  }
  if (!opciones.anotarEnHistorial) return
  registrarCambio(actor, {
    accion: 'rechazo_debito',
    tabla: 'rechazos_debito',
    registroId: fila.id,
    filaId: fila.filaId,
    campo: 'ESTADO DEL RECHAZO',
    valorAnterior: fila.estado,
    valorNuevo: estado,
  })
}

export function cambiarEstadoDeRechazo(rechazoId: number, estado: unknown, filtros: unknown, actor: SesionUsuario): ListadoRechazos {
  const id = enteroPositivo(rechazoId, 'El aviso')
  const escrito = limpiar(estado).toUpperCase()
  if (!(ESTADOS_DE_RECHAZO as readonly string[]).includes(escrito)) throw new ErrorDeNegocio('Ese estado no es válido.')
  const fila = buscarPorId(id)
  escribirEstado(fila, escrito as EstadoDeRechazo, actor)
  return listarRechazos(filtros)
}

/** Igual que el anterior pero devolviendo lo que mira la campana: es lo que usa el desplegable. */
export function resolverRechazoDesdeLaCampana(rechazoId: number, actor: SesionUsuario): AvisosDeRechazos {
  const fila = buscarPorId(enteroPositivo(rechazoId, 'El aviso'))
  escribirEstado(fila, 'RESUELTO', actor)
  return avisosDeRechazos(actor)
}
