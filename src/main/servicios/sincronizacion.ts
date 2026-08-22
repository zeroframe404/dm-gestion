// Servicio de sincronización: arma el motor con las credenciales guardadas, avisa al renderer cuando
// cambia el estado y expone lo que muestra Administración → Sincronización.
import { BrowserWindow } from 'electron'
import path from 'node:path'
import type { DatosDeEvento, NombreEvento } from '../../shared/canales'
import type {
  EntradaDeCola,
  EstadoSincronizacion,
  EventoSync,
  PanelSincronizacion,
  RespaldoGuardado,
} from '../../shared/tipos'
import { db } from '../db/base'
import { extraerIdDeHoja, FuenteGoogleSheets, type FuenteHoja } from '../importacion/fuente'
import { ejecutarImportacion } from '../importacion/importador'
import { ahoraIso } from '../importacion/normalizar'
import { carpetaDatos } from '../rutas'
import { anotarEvento, reintentarFallidas } from '../sincronizacion/cola'
import { MotorDeSincronizacion } from '../sincronizacion/motor'
import {
  hacerRespaldo,
  listarRespaldos,
  servicioDeRespaldoDeGoogle,
  tocaRespaldar,
  type ServicioDeRespaldo,
} from '../sincronizacion/respaldo'
import { credencialesGoogle } from './config'
import { ErrorDeNegocio } from './errores'

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

function crearFuente(): FuenteHoja | null {
  if (fuenteDePrueba) return fuenteDePrueba
  const credenciales = credencialesGoogle()
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
}

export function obtenerMotor(): MotorDeSincronizacion {
  if (!motor) {
    motor = new MotorDeSincronizacion({
      crearFuente,
      importar: importarTodo,
      alCambiarEstado: (estado) => emitir('sincronizacion:estado', estado),
    })
  }
  return motor
}

/** Se llama al abrir sesión: enciende el motor y baja lo que haya. */
export async function arrancarSincronizacion(): Promise<void> {
  const motor = obtenerMotor()
  if (!crearFuente()) return
  motor.encender()
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
  if (!crearFuente()) throw new ErrorDeNegocio('Primero cargá la cuenta de servicio y la hoja en «Conexión con Google».')
  if (!motor.estaEncendido()) motor.encender()
  await motor.sincronizarAhora(completa)
  return motor.estado()
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
 * Cómo pedir un token de la cuenta de servicio para hablar con Drive, o null si Google todavía no está
 * configurado. Lo usan los adjuntos de los siniestros para subir su copia.
 */
export function dadorDeTokenDeGoogle(): (() => Promise<string>) | null {
  const fuente = crearFuente()
  if (!(fuente instanceof FuenteGoogleSheets)) return null
  return () => fuente.obtenerToken()
}

function servicioDeRespaldo(): ServicioDeRespaldo | null {
  if (servicioDeRespaldoDePrueba) return servicioDeRespaldoDePrueba
  const fuente = crearFuente()
  if (!(fuente instanceof FuenteGoogleSheets)) return null
  return servicioDeRespaldoDeGoogle(() => fuente.obtenerToken())
}

/** El respaldo del día, si ya pasaron las 20:00 y todavía no se hizo. */
export async function respaldarSiCorresponde(ahora = new Date()): Promise<boolean> {
  if (!tocaRespaldar(ahora)) return false
  return respaldarAhora(ahora)
}

export async function respaldarAhora(ahora = new Date()): Promise<boolean> {
  const servicio = servicioDeRespaldo()
  const credenciales = credencialesGoogle()
  const hojaId = credenciales ? extraerIdDeHoja(credenciales.urlHoja) : null
  if (!servicio || !hojaId) return false
  const resultado = await hacerRespaldo(servicio, hojaId, carpetaDeRespaldos(), ahora)
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
