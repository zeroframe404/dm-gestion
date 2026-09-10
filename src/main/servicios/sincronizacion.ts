// Servicio de sincronización: arma el motor con las credenciales guardadas, avisa al renderer cuando
// cambia el estado y expone lo que muestra Administración → Sincronización.
import { app } from 'electron'
import path from 'node:path'
import { nombreDePeriodo } from '../../shared/semaforo'
import type {
  EntradaDeCola,
  EstadoSincronizacion,
  EventoSync,
  PanelSincronizacion,
  RespaldoGuardado,
  ResumenCierreDeMes,
  SesionUsuario,
  SituacionDeConexion,
} from '../../shared/tipos'
import { db } from '../db/base'
import { extraerIdDeHoja, FuenteGoogleSheets, type FuenteHoja } from '../importacion/fuente'
import { ejecutarImportacion } from '../importacion/importador'
import { ahoraIso } from '../importacion/normalizar'
import { clasificarPestana } from '../importacion/pestanas'
import { carpetaDatos } from '../rutas'
import { anotarEvento, reintentarFallidas, usarDespertadorDeLaCola } from '../sincronizacion/cola'
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
import { esAlmacenDeAdjuntos, hayAdjuntosPendientes, subirAdjuntosPendientes, usarAlmacenDeAdjuntos, verificarAdjuntosContraElServidor } from './adjuntos'
import { credencialesGoogle, credencialesParaDrive, credencialesVps } from './config'
import { ErrorDeNegocio } from './errores'
import { reservarImportacionAutomatica, tipoDeImportacionEnCurso } from './importacion'
import { repararAlArrancar, repararDuplicados, repararSiniestrosSinCliente } from './reparaciones'
import { construirXlsx, type HojaXlsx } from './xlsx'
import { emitirATodas as emitir } from './avisos'

let motor: MotorDeSincronizacion | null = null
/** En las pruebas se puede poner una hoja simulada acá y saltear las credenciales. */
let fuenteDePrueba: FuenteHoja | null = null
let servicioDeRespaldoDePrueba: ServicioDeRespaldo | null = null

export function carpetaDeRespaldos(): string {
  return path.join(carpetaDatos(), 'respaldos')
}

// v12: la base compartida vive en el VPS de la agencia; Google quedó sólo para la migración
// inicial (ver migracionVps.ts) y para Drive (respaldos y adjuntos), si sigue configurado.
export function crearFuente(): FuenteHoja | null {
  if (fuenteDePrueba) return fuenteDePrueba
  return crearFuenteVps()
}

/**
 * La URL y el token con los que esta computadora habla con el puente del VPS, o null si en esta
 * computadora no hay puente.
 *
 * Está separado de `crearFuenteVps` porque el puente lo usan dos cosas distintas: la grilla del
 * GENERAL DE CLIENTES (que es lo que devuelve `FuenteVps`) y la mensajería, que tiene sus propios
 * endpoints y su propio cliente. Las dos tienen que elegir el servidor con la MISMA regla, y la
 * regla es la que importa: en desarrollo y en las pruebas nunca se toca el VPS real.
 */
export function credencialesDelPuente(): { urlBase: string; token: string } | null {
  // En desarrollo (y en las pruebas, donde electron ni existe) NUNCA se toca el VPS real: sólo se
  // sincroniza si DM_GESTION_VPS_URL apunta a un servidor local (el simulador), igual que
  // DM_GESTION_GITHUB_API con la base de usuarios.
  const empaquetada = (app as typeof app | undefined)?.isPackaged ?? false
  if (!empaquetada) {
    const urlBase = process.env.DM_GESTION_VPS_URL
    if (!urlBase) return null
    // Nunca el token real en desarrollo: 'prueba' es el del simulador (scripts/vps-simulado.mjs).
    return { urlBase, token: process.env.DM_GESTION_VPS_TOKEN ?? 'prueba' }
  }
  return credencialesVps()
}

export function crearFuenteVps(): FuenteVps | null {
  const credenciales = credencialesDelPuente()
  return credenciales ? new FuenteVps(credenciales) : null
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

/**
 * Corre la importación que incorpora filas nuevas. Sin `pestanas` es la completa (lo que sabe crear
 * clientes, vehículos y pólizas a partir de la hoja); con `pestanas` (12.7) se guardan sólo ésas.
 */
async function importarTodo(pestanas?: string[]): Promise<void> {
  const fuente = crearFuente()
  if (!fuente) return
  // Con «Reimportar la base» andando no se arranca otra encima (12.7): las dos escribirían la misma
  // base y la misma hoja a la vez. Se saltea; si las filas siguen sin conocerse, la próxima bajada
  // vuelve a pedirla. Y mientras ésta corre, es el botón el que se rechaza (ver `iniciarImportacion`).
  const yaCorriendo = tipoDeImportacionEnCurso()
  if (yaCorriendo) {
    const cual = yaCorriendo === 'manual' ? 'hay una importación manual en curso' : 'la anterior todavía está corriendo'
    anotarEvento('bajada', `La importación automática se salteó: ${cual}. Se vuelve a intentar en la próxima bajada.`)
    return
  }
  const { id } = db()
    .prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`)
    .get(ahoraIso()) as { id: number }
  // Entre la pregunta de arriba y esta reserva no se cede el hilo, así que no puede fallar; el tipo lo
  // pide. Si algún día pasara, la fila recién insertada se cierra: una que queda en EN_CURSO se vuelve
  // una FALLIDA fantasma en el próximo arranque (ver `marcarImportacionesInterrumpidas`) y la pantalla
  // la muestra como «última importación».
  const reserva = reservarImportacionAutomatica(id)
  if (!reserva) {
    db().prepare(`UPDATE importaciones SET estado = 'CANCELADA', terminada_en = ? WHERE id = ?`).run(ahoraIso(), id)
    return
  }
  try {
    const informe = await ejecutarImportacion({ db: db(), fuente, importacionId: id, soloPestanas: pestanas, estaCancelada: reserva.estaCancelada })
    db()
      .prepare('UPDATE importaciones SET terminada_en = ?, estado = ?, informe_json = ? WHERE id = ?')
      .run(informe.terminadaEn, informe.estado, JSON.stringify(informe), id)
    // Tras una importación acotada (12.7), sólo las reparaciones que tocan lo que se guardó: buscar
    // clientes repetidos carga la cartera entera, y después de incorporar dos siniestros es trabajo
    // pesado para nada. Sin lista (la completa) corren todas, como siempre.
    // Lista vacía = completa, la misma regla que usa el importador (`soloPestanas`): si no, una
    // importarTodo([]) correría la completa sin ninguna reparación.
    const tipos = pestanas && pestanas.length > 0 ? new Set(pestanas.map((titulo) => clasificarPestana(titulo).tipo)) : null
    // Si la base traía una baja repetida (dos renglones con el mismo _ID, de antes de la 12.2), la
    // importación le acaba de inventar un _ID al segundo: se saca acá, antes de que alguien lo vea. Lo
    // mismo con las cuotas —un renglón repetido dentro de la planilla del mes deja la póliza dos veces—
    // y con los clientes que quedaron dos veces con el mismo DNI.
    if (tipos === null || tipos.has('MENSUAL') || tipos.has('BAJAS')) repararDuplicados()
    // Un siniestro que entró con la póliza pero sin cliente toma el titular de la póliza (12.7).
    if (tipos === null || tipos.has('SINIESTROS')) {
      try {
        repararSiniestrosSinCliente()
      } catch (error) {
        console.error('[sincronizacion] No se pudieron reparar los siniestros sin cliente:', error)
      }
    }
  } finally {
    reserva.liberar()
  }
}

/**
 * En qué anda el canal en vivo. Lo pone `index.ts` al arrancar, apuntando a `canal().estado()`.
 *
 * Va por acá y no con un `import` directo del canal a propósito: el canal necesita `obtenerMotor()` y
 * `credencialesDelPuente()`, y si además la sincronización lo importara a él quedaría un círculo entre
 * los dos módulos. Es el mismo motivo por el que el cartero de la mensajería se engancha desde
 * `index.ts` y no desde acá.
 *
 * Por defecto dice `sin-puente`, que es «no hay canal y tampoco tiene por qué haberlo»: es lo que
 * corresponde en el banco de pruebas y en la máquina de desarrollo, donde el motor tiene que seguir
 * deduciendo el corte de las fallas de red como hasta la 13.x.
 */
let situacionDelCanal: (() => SituacionDeConexion) | null = null

export function usarSituacionDelCanal(mirar: () => SituacionDeConexion): void {
  situacionDelCanal = mirar
}

export function obtenerMotor(): MotorDeSincronizacion {
  if (!motor) {
    motor = new MotorDeSincronizacion({
      crearFuente,
      importar: importarTodo,
      alCambiarEstado: (estado) => emitir('sincronizacion:estado', estado),
      // Cuando la bajada trae tareas, la campana y el contador de la barra lateral se enteran en el
      // momento en vez de esperar a su propio reloj.
      alCambiarLasTareas: () => emitir('tareas:cambiaron', null),
      // Y cuando trae cualquier otra cosa, la pantalla que la esté mostrando se recarga sola: hasta la
      // 13.0 el dato entraba en la base y la pantalla abierta seguía mostrando lo viejo.
      alCambiarLosDatos: (pestanas) =>
        emitir('datos:cambiaron', {
          pestanas: pestanas.map((p) => p.titulo),
          tipos: [...new Set(pestanas.map((p) => p.tipo))],
        }),
      situacionDelCanal: () => situacionDelCanal?.() ?? 'sin-puente',
      // 12.6: los adjuntos suben al servidor en el mismo ciclo que la cola, después de ella.
      hayArchivosPendientes: hayAdjuntosPendientes,
      subirArchivos: () => subirAdjuntosPendientes(dadorDeTokenDeGoogle()),
    })
    // 14.0: el reloj de los diez segundos se fue y lo reemplaza esto. Cada `encolar` —los 57 lugares
    // del programa que anotan un cambio, sin tocar ninguno— despierta al motor, que sube con 100 ms de
    // respiro. Se registra acá, al armar el motor, porque acá es donde existe el motor de verdad; el
    // banco de pruebas arma el suyo y le pide las subidas a mano.
    usarDespertadorDeLaCola(() => motor?.apurarSubida())
  }
  return motor
}

/**
 * Dónde se guardan los archivos adjuntos: el VPS (que sabe subir y bajar archivos), o la hoja de
 * prueba si tiene almacén (la simulada lo tiene). Google Sheets nunca lo tuvo: sin VPS los adjuntos
 * quedan en esta PC, como hasta la 12.5.
 */
usarAlmacenDeAdjuntos(() => {
  if (fuenteDePrueba) return esAlmacenDeAdjuntos(fuenteDePrueba) ? fuenteDePrueba : null
  return crearFuenteVps()
})

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
  // 12.7: lo que esta computadora cree de cada archivo adjunto se contrasta con lo que el servidor
  // tiene de verdad, en segundo plano. Lo que figuraba subido sin estarlo vuelve a subir solo.
  void verificarAdjuntosContraElServidor().catch((error: unknown) => {
    console.error('[sincronizacion] No se pudieron verificar los adjuntos contra el servidor:', error)
  })
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
  // Para Drive no hace falta la URL de la hoja: alcanza con la cuenta de servicio. Hasta la 12.5 una
  // PC con la cuenta pero sin URL quedaba sin Drive, y sin decirlo.
  if (fuenteDePrueba) return null
  let credenciales: ReturnType<typeof credencialesParaDrive>
  try {
    credenciales = credencialesParaDrive()
  } catch {
    return null
  }
  if (!credenciales) return null
  const fuente = new FuenteGoogleSheets({
    hojaId: (credenciales.urlHoja && extraerIdDeHoja(credenciales.urlHoja)) || 'sin-hoja',
    cuentaServicio: credenciales.cuentaServicio,
  })
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
