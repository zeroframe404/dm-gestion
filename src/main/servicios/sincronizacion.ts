// Servicio de sincronización: arma el motor con las credenciales guardadas, avisa al renderer cuando
// cambia el estado y expone lo que muestra Administración → Sincronización.
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import type { DatosDeEvento, NombreEvento } from '../../shared/canales'
import { nombreDePeriodo } from '../../shared/semaforo'
import type {
  EntradaDeCola,
  EstadoSincronizacion,
  EventoSync,
  PanelSincronizacion,
  RespaldoGuardado,
  ResumenCierreDeMes,
  SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import { extraerIdDeHoja, FuenteGoogleSheets, type FuenteHoja } from '../importacion/fuente'
import { ejecutarImportacion } from '../importacion/importador'
import { ahoraIso } from '../importacion/normalizar'
import { carpetaDatos } from '../rutas'
import { anotarEvento, reintentarFallidas } from '../sincronizacion/cola'
import { leerContexto } from '../sincronizacion/hoja'
import { MotorDeSincronizacion } from '../sincronizacion/motor'
import { crearPestanaDelMesEstricta, tituloParaPestanaNueva } from '../sincronizacion/pestanasApp'
import {
  hacerRespaldo,
  listarRespaldos,
  servicioDeRespaldoDeGoogle,
  tocaRespaldar,
  type ServicioDeRespaldo,
} from '../sincronizacion/respaldo'
import { FuenteVps } from '../vps/fuenteVps'
import { cerrarMes, nombreDePestanaMensual, periodoACerrar } from './cartera'
import { credencialesGoogle, credencialesVps } from './config'
import { ErrorDeNegocio } from './errores'
import { repararAlArrancar, repararDuplicados } from './reparaciones'
import { construirXlsx, type HojaXlsx } from './xlsx'

let motor: MotorDeSincronizacion | null = null
/** En las pruebas se puede poner una hoja simulada acá y saltear las credenciales. */
let fuenteDePrueba: FuenteHoja | null = null
let servicioDeRespaldoDePrueba: ServicioDeRespaldo | null = null

function emitir<E extends NombreEvento>(evento: E, datos: DatosDeEvento<E>): void {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed()) ventana.webContents.send(evento, datos)
  }
}

export function carpetaDeRespaldos(): string {
  return path.join(carpetaDatos(), 'respaldos')
}

// v12: la base compartida vive en el VPS de la agencia; Google quedó sólo para la migración
// inicial (ver migracionVps.ts) y para Drive (respaldos y adjuntos), si sigue configurado.
export function crearFuente(): FuenteHoja | null {
  if (fuenteDePrueba) return fuenteDePrueba
  return crearFuenteVps()
}

export function crearFuenteVps(): FuenteVps | null {
  // En desarrollo (y en las pruebas, donde electron ni existe) NUNCA se toca el VPS real: sólo se
  // sincroniza si DM_GESTION_VPS_URL apunta a un servidor local (el simulador), igual que
  // DM_GESTION_GITHUB_API con la base de usuarios.
  const empaquetada = (app as typeof app | undefined)?.isPackaged ?? false
  if (!empaquetada) {
    const urlBase = process.env.DM_GESTION_VPS_URL
    if (!urlBase) return null
    // Nunca el token real en desarrollo: 'prueba' es el del simulador (scripts/vps-simulado.mjs).
    return new FuenteVps({ urlBase, token: process.env.DM_GESTION_VPS_TOKEN ?? 'prueba' })
  }
  return new FuenteVps(credencialesVps())
}

/** La conexión directa con Google, si la agencia todavía la tiene configurada (migración y Drive). */
export function fuenteGoogleDirecta(): FuenteGoogleSheets | null {
  // Con una fuente de prueba puesta no hay Google; y fuera de Electron (las pruebas)
  // ni siquiera se puede leer config.json (no existe app.getPath): ahí tampoco hay Google.
  if (fuenteDePrueba) return null
  let credenciales: ReturnType<typeof credencialesGoogle>
  try {
    credenciales = credencialesGoogle()
  } catch {
    return null
  }
  if (!credenciales) return null
  const hojaId = extraerIdDeHoja(credenciales.urlHoja)
  if (!hojaId) return null
  return new FuenteGoogleSheets({ hojaId, cuentaServicio: credenciales.cuentaServicio })
}

/** Corre la importación completa: es la que sabe incorporar filas nuevas creadas a mano en la hoja. */
async function importarTodo(): Promise<void> {
  const fuente = crearFuente()
  if (!fuente) return
  const { id } = db()
    .prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`)
    .get(ahoraIso()) as { id: number }
  const informe = await ejecutarImportacion({ db: db(), fuente, importacionId: id })
  db()
    .prepare('UPDATE importaciones SET terminada_en = ?, estado = ?, informe_json = ? WHERE id = ?')
    .run(informe.terminadaEn, informe.estado, JSON.stringify(informe), id)
  // Si la base traía una baja repetida (dos renglones con el mismo _ID, de antes de la 12.2), la
  // importación le acaba de inventar un _ID al segundo: se saca acá, antes de que alguien lo vea. Lo
  // mismo con las cuotas —un renglón repetido dentro de la planilla del mes deja la póliza dos veces—
  // y con los clientes que quedaron dos veces con el mismo DNI.
  repararDuplicados()
}

export function obtenerMotor(): MotorDeSincronizacion {
  if (!motor) {
    motor = new MotorDeSincronizacion({
      crearFuente,
      importar: importarTodo,
      alCambiarEstado: (estado) => emitir('sincronizacion:estado', estado),
      // El carril rápido de las tareas: cuando trae algo, la campana y el contador de la barra lateral
      // se enteran en el momento en vez de esperar a su propio reloj.
      alCambiarLasTareas: () => emitir('tareas:cambiaron', null),
    })
  }
  return motor
}

/** Se llama al abrir sesión: enciende el motor y baja lo que haya. */
export async function arrancarSincronizacion(): Promise<void> {
  const motor = obtenerMotor()
  if (!crearFuente()) return
  motor.encender()
  // Lo que quedó de versiones anteriores y hoy se sabe arreglar: los pagos que nunca salieron de esta
  // computadora y las bajas y las cuotas que la base tiene dos veces. Antes de bajar, así viajan en el
  // mismo ciclo.
  repararAlArrancar()
  await motor.sincronizarAhora()
  await respaldarSiCorresponde()
}

export function detenerSincronizacion(): void {
  motor?.apagar()
}

export function estadoDeSincronizacion(): EstadoSincronizacion {
  return obtenerMotor().estado()
}

export async function sincronizarAhora(completa = false): Promise<EstadoSincronizacion> {
  const motor = obtenerMotor()
  if (!crearFuente()) throw new ErrorDeNegocio('La sincronización no está disponible en este momento.')
  if (!motor.estaEncendido()) motor.encender()
  await motor.sincronizarAhora(completa)
  return motor.estado()
}

export interface OpcionesDeCierreConLaBase {
  /** La fuente contra la que se cierra; por defecto la del programa. Las pruebas pasan la suya. */
  fuente?: FuenteHoja | null
  /** Cómo sincronizar antes de mirar la base; por defecto el motor del programa. */
  sincronizar?: () => Promise<unknown>
}

/**
 * «Cerrar mes» con la base como árbitro (12.6). Hasta la 12.5 el único freno contra cerrar el mes dos
 * veces —una computadora en cada mostrador— eran los períodos que ESTA computadora conocía: si la
 * otra había cerrado hace un rato y la bajada todavía no lo había traído, o si ésta estaba sin
 * conexión, se creaba la planilla entera por segunda vez con otros _ID y septiembre aparecía con
 * cada póliza dos veces.
 *
 * Ahora, en orden: los frenos locales de siempre; una sincronización completa (sin conexión no se
 * cierra: es un cambio deliberado, y el mensaje lo dice); la base a la vista, para ver si el mes ya
 * está abierto y decidir el título; y la creación ESTRICTA de la pestaña, que es el candado — si dos
 * computadoras llegan hasta acá a la vez, sólo una crea la pestaña y la otra recibe «ya existe».
 * Recién con la pestaña creada se copian las filas localmente y se encolan.
 */
export async function cerrarMesConLaBase(actor: SesionUsuario, opciones: OpcionesDeCierreConLaBase = {}): Promise<ResumenCierreDeMes> {
  const fuente = opciones.fuente === undefined ? crearFuente() : opciones.fuente
  if (!fuente) {
    throw new ErrorDeNegocio(
      'Sin conexión con la base de la agencia no se puede cerrar el mes: el mes nuevo se crea en la base para que las otras computadoras no lo cierren también. Probá cuando vuelva internet.',
    )
  }
  periodoACerrar()
  try {
    await (opciones.sincronizar ?? (() => sincronizarAhora(true)))()
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    throw new ErrorDeNegocio(`No se pudo sincronizar con la base antes de cerrar el mes (${motivo}). Cerrar el mes necesita conexión: probá de nuevo en un rato.`)
  }
  // Después de sincronizar, los frenos locales ya saben lo que la otra computadora hizo hace un rato.
  const { nuevo } = periodoACerrar()
  const contexto = await leerContexto(fuente)
  const abierta = contexto.pestanas.find((p) => p.tipo === 'MENSUAL' && p.periodo === nuevo)
  if (abierta) {
    throw new ErrorDeNegocio(
      `El mes ${nombreDePeriodo(nuevo)} ya está abierto en la base (la pestaña «${abierta.titulo}»): lo cerró otra computadora. Sincronizá y volvé a mirar la planilla.`,
    )
  }
  const titulo = tituloParaPestanaNueva(contexto, nombreDePestanaMensual(nuevo), nuevo)
  await crearPestanaDelMesEstricta(fuente, contexto, titulo)
  return cerrarMes(actor, { pestana: titulo })
}

export function panelDeSincronizacion(): PanelSincronizacion {
  const cola = (
    db()
      .prepare(
        `SELECT id, creado_en, operacion, pestana, fila_id, campos_json, intentos, ultimo_error, estado, usuario_nombre
         FROM cola_sync WHERE estado <> 'listo' ORDER BY id LIMIT 200`,
      )
      .all() as Array<{
      id: number
      creado_en: string
      operacion: EntradaDeCola['operacion']
      pestana: string
      fila_id: string
      campos_json: string
      intentos: number
      ultimo_error: string | null
      estado: EntradaDeCola['estado']
      usuario_nombre: string | null
    }>
  ).map((f) => ({
    id: f.id,
    creadoEn: f.creado_en,
    operacion: f.operacion,
    pestana: f.pestana,
    filaId: f.fila_id,
    campos: Object.keys(JSON.parse(f.campos_json) as Record<string, string>),
    intentos: f.intentos,
    ultimoError: f.ultimo_error,
    estado: f.estado,
    usuarioNombre: f.usuario_nombre,
  }))

  const eventos = (
    db()
      .prepare('SELECT id, fecha, tipo, detalle, filas, duracion_ms, con_error FROM eventos_sync ORDER BY id DESC LIMIT 50')
      .all() as Array<{ id: number; fecha: string; tipo: string; detalle: string; filas: number | null; duracion_ms: number | null; con_error: number }>
  ).map((e) => ({
    id: e.id,
    fecha: e.fecha,
    tipo: e.tipo,
    detalle: e.detalle,
    filas: e.filas,
    duracionMs: e.duracion_ms,
    conError: e.con_error === 1,
  })) satisfies EventoSync[]

  return { estado: estadoDeSincronizacion(), cola, eventos, respaldos: respaldos() }
}

export function volverAIntentar(): number {
  const cuantas = reintentarFallidas()
  if (cuantas > 0) anotarEvento('motor', `${cuantas} cambios vuelven a la cola para reintentar.`)
  return cuantas
}

export function respaldos(): RespaldoGuardado[] {
  return listarRespaldos(carpetaDeRespaldos())
}

/**
 * Cómo pedir un token de la cuenta de servicio para hablar con Drive, o null si Google no está
 * configurado. Lo usan los adjuntos de los siniestros para subir su copia; sigue funcionando
 * después del corte al VPS mientras la cuenta de servicio quede cargada.
 */
export function dadorDeTokenDeGoogle(): (() => Promise<string>) | null {
  const fuente = fuenteGoogleDirecta()
  if (!fuente) return null
  return () => fuente.obtenerToken()
}

/**
 * v12: el respaldo diario se arma desde la base del VPS (la fuente de verdad) con el generador de
 * .xlsx propio. La copia a Drive se mantiene sólo si la cuenta de Google sigue configurada.
 */
function servicioDeRespaldo(): ServicioDeRespaldo | null {
  if (servicioDeRespaldoDePrueba) return servicioDeRespaldoDePrueba
  const fuente = crearFuente()
  if (!fuente) return null
  return {
    exportarXlsx: async () => {
      const estructura = await fuente.estructura()
      const hojas: HojaXlsx[] = []
      // De a una pestaña por pedido: la base entera en una sola respuesta puede pasarse
      // del tiempo máximo por pedido; así cada llamada es chica y reintentable.
      for (const pestana of estructura.pestanas) {
        const [lectura] = await fuente.leerVarias([pestana.titulo])
        hojas.push({ nombre: pestana.titulo, encabezados: null, filas: lectura?.valores ?? [] })
      }
      return construirXlsx(hojas)
    },
    subirADrive: async (nombre, contenido) => {
      const google = fuenteGoogleDirecta()
      if (!google) return null
      return servicioDeRespaldoDeGoogle(() => google.obtenerToken()).subirADrive(nombre, contenido)
    },
  }
}

/** El respaldo del día, si ya pasaron las 20:00 y todavía no se hizo. */
export async function respaldarSiCorresponde(ahora = new Date()): Promise<boolean> {
  if (!tocaRespaldar(ahora)) return false
  return respaldarAhora(ahora)
}

export async function respaldarAhora(ahora = new Date()): Promise<boolean> {
  const servicio = servicioDeRespaldo()
  if (!servicio) return false
  const resultado = await hacerRespaldo(servicio, 'vps', carpetaDeRespaldos(), ahora)
  return resultado.hecho
}

// ---------------------------------------------------------------------------
// Sólo para las pruebas
// ---------------------------------------------------------------------------

export function usarFuenteDePrueba(fuente: FuenteHoja | null): void {
  fuenteDePrueba = fuente
  motor = null
}

export function usarServicioDeRespaldoDePrueba(servicio: ServicioDeRespaldo | null): void {
  servicioDeRespaldoDePrueba = servicio
}
