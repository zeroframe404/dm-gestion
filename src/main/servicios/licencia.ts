// La licencia de DM Gestión de la agencia, del lado del programa.
//
// QUIÉN DECIDE. El servidor de la agencia: comprueba la firma, el vencimiento y los puestos, y con la
// licencia vencida no deja ingresar (ver Seguros_Daniel_Martinez, server/src/modules/dmg/licencia.*).
// Acá se pregunta el estado para mostrarlo (cartel de aviso, pantalla de bloqueo, Administración →
// Licencia) y se hace cumplir lo que el servidor no puede ver:
//
//   - SIN INTERNET. El ingreso sin conexión (con la credencial guardada) no pasa por el servidor. Por
//     eso se guarda lo último que se supo de la licencia: si ya no dejaba ingresar, o si la gracia ya
//     terminó según la fecha guardada, tampoco se entra sin conexión.
//   - CON LA SESIÓN ABIERTA. Cada hora se vuelve a preguntar; si la licencia dejó de permitir ingresar,
//     la sesión se cierra con el motivo.
//
// Un servidor sin control de licencias (el de siempre) contesta `exenta`, y uno anterior a las licencias
// no conoce la ruta: en los dos casos no cambia nada. La demo no habla con ningún servidor.
import { LICENCIA_EXENTA, normalizarEstadoDeLicencia, type EstadoDeLicencia, type PuestoOcupado } from '../../shared/licencia'
import type { SesionUsuario } from '../../shared/tipos'
import { esDemo } from '../canal'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import type { FuenteVps } from '../vps/fuenteVps'
import { emitirATodas } from './avisos'
import { cerrarSesionPorLicencia } from './baseDeUsuarios'
import { ErrorDeNegocio } from './errores'
import { crearFuenteVps } from './sincronizacion'
import { exigirRol, sesion } from './sesion'

const CLAVE_DE_CACHE = 'licencia_cache'
/** Cuánto se espera al servidor al ingresar: alguien está mirando la ruedita. */
const TOPE_DE_ESPERA_MS = 6_000
const CADA_MS = 60 * 60 * 1000

let ultimo: EstadoDeLicencia | null = null
let cargadoDeLaBase = false

/** Para las pruebas: otra fuente, otro emisor, otra forma de cerrar la sesión. */
let hacerFuente: () => FuenteVps | null = crearFuenteVps
let emitir: typeof emitirATodas = emitirATodas
let cerrar: (motivo: string) => void = cerrarSesionPorLicencia

export function usarFuenteDeLicencia(fuente: (() => FuenteVps | null) | null): void {
  hacerFuente = fuente ?? crearFuenteVps
}

export function usarEmisorDeLicencia(nuevo: typeof emitirATodas | null, cerrarSesion?: ((motivo: string) => void) | null): void {
  emitir = nuevo ?? emitirATodas
  cerrar = cerrarSesion ?? cerrarSesionPorLicencia
}

/** Para las pruebas: como si el programa recién arrancara (lo guardado se vuelve a leer de la base). */
export function reiniciarLicenciaParaPruebas(): void {
  ultimo = null
  cargadoDeLaBase = false
}

function leerDeLaBase(): EstadoDeLicencia | null {
  try {
    const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE_DE_CACHE) as { valor: string } | undefined
    return fila ? normalizarEstadoDeLicencia(JSON.parse(fila.valor)) : null
  } catch {
    return null
  }
}

function guardarEnLaBase(estado: EstadoDeLicencia): void {
  try {
    db()
      .prepare(
        `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
         ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
      )
      .run(CLAVE_DE_CACHE, JSON.stringify(estado), ahoraIso())
  } catch (error) {
    console.error('[licencia] No se pudo guardar lo último que se supo de la licencia:', error)
  }
}

function recordado(): EstadoDeLicencia | null {
  if (!cargadoDeLaBase) {
    cargadoDeLaBase = true
    ultimo = leerDeLaBase()
  }
  return ultimo
}

function recordar(estado: EstadoDeLicencia): EstadoDeLicencia {
  const cambio = JSON.stringify(estado) !== JSON.stringify(ultimo)
  ultimo = estado
  cargadoDeLaBase = true
  if (cambio) {
    guardarEnLaBase(estado)
    try {
      emitir('licencia:cambio', estado)
    } catch {
      // Sin ventanas (las pruebas, el arranque): nadie a quien avisarle.
    }
  }
  return estado
}

function conTope<T>(promesa: Promise<T>, milisegundos: number): Promise<T> {
  return new Promise<T>((resolver, rechazar) => {
    const reloj = setTimeout(() => rechazar(new Error('El servidor no contestó a tiempo.')), milisegundos)
    promesa.then(
      (valor) => {
        clearTimeout(reloj)
        resolver(valor)
      },
      (error: unknown) => {
        clearTimeout(reloj)
        rechazar(error)
      },
    )
  })
}

/** Pregunta al servidor. Null si no hay servidor o no contestó. */
async function preguntar(tope = TOPE_DE_ESPERA_MS): Promise<EstadoDeLicencia | null> {
  if (esDemo()) return LICENCIA_EXENTA
  const vps = hacerFuente()
  if (!vps) return LICENCIA_EXENTA
  try {
    // Un servidor anterior a las licencias (null) no controla nada.
    return recordar((await conTope(vps.licenciaEstado(), tope)) ?? LICENCIA_EXENTA)
  } catch (error) {
    console.error('[licencia] No se pudo leer la licencia del servidor:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Lo guardado, mirado con el reloj de esta PC: si la gracia ya pasó, la licencia está vencida aunque
 * la última vez que se habló con el servidor todavía no lo estuviera.
 */
function vistoSinConexion(estado: EstadoDeLicencia, ahora = Date.now()): EstadoDeLicencia {
  if (!estado.permiteIngresar || !estado.graciaHasta) return estado
  if (Date.parse(estado.graciaHasta) >= ahora) return estado
  return { ...estado, estado: 'vencida', permiteIngresar: false, mensaje: 'La licencia de DM Gestión de esta agencia venció.' }
}

/** El estado de la licencia: del servidor si contesta, si no lo último que se supo. */
export async function estadoDeLaLicencia(): Promise<EstadoDeLicencia> {
  const leido = await preguntar()
  if (leido) return leido
  const guardado = recordado()
  return guardado ? vistoSinConexion(guardado) : LICENCIA_EXENTA
}

/**
 * Antes de abrir una sesión (el gancho `permitirIngreso`). Con servidor, ya lo controló él al ingresar
 * y esto sólo confirma; sin servidor, es lo único que frena un ingreso con la licencia vencida.
 */
export async function verificarIngresoPorLicencia(_candidata: SesionUsuario): Promise<void> {
  const estado = await estadoDeLaLicencia()
  if (!estado.permiteIngresar) throw new ErrorDeNegocio(estado.mensaje || 'La licencia de DM Gestión de esta agencia no permite ingresar.')
}

/** El servidor rechazó un ingreso por la licencia: se relee para que la pantalla muestre el bloqueo. */
export function releerLicencia(): void {
  void preguntar()
}

export async function instalarLicencia(texto: unknown): Promise<EstadoDeLicencia> {
  const licencia = typeof texto === 'string' ? texto.replace(/\s+/g, '') : ''
  if (!licencia.startsWith('dmgl1.')) throw new ErrorDeNegocio('Eso no es una licencia de DM Gestión: tiene que empezar con «dmgl1.».')
  if (esDemo()) throw new ErrorDeNegocio('La demo no usa licencias.')
  const vps = hacerFuente()
  if (!vps) throw new ErrorDeNegocio('Este programa no está conectado a un servidor.')
  const estado = await vps.licenciaInstalar(licencia)
  return recordar(estado ?? LICENCIA_EXENTA)
}

export async function puestosDeLaLicencia(): Promise<PuestoOcupado[]> {
  exigirRol('SUPER_ADMIN')
  const vps = hacerFuente()
  if (!vps || esDemo()) return []
  return vps.licenciaPuestos()
}

export async function liberarPuestoDeLaLicencia(clave: unknown): Promise<EstadoDeLicencia> {
  exigirRol('SUPER_ADMIN')
  if (typeof clave !== 'string' || !clave) throw new ErrorDeNegocio('Falta qué computadora liberar.')
  const vps = hacerFuente()
  if (!vps || esDemo()) throw new ErrorDeNegocio('Este programa no está conectado a un servidor.')
  await vps.licenciaLiberar(clave)
  return (await preguntar()) ?? recordado() ?? LICENCIA_EXENTA
}

/** Una vuelta del reloj: relee y, si la licencia ya no deja ingresar, cierra la sesión abierta. */
export async function revisarLicencia(): Promise<void> {
  const leido = await preguntar(30_000)
  const estado = leido ?? (recordado() ? vistoSinConexion(recordado()!) : null)
  if (estado && !estado.permiteIngresar && sesion()) cerrar(estado.mensaje)
}

let reloj: ReturnType<typeof setInterval> | null = null

export function arrancarRelojDeLicencia(): void {
  if (reloj || esDemo()) return
  reloj = setInterval(() => void revisarLicencia(), CADA_MS)
  reloj.unref?.()
  void revisarLicencia()
}
