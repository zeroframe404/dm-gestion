// Las tablas de ATM en ESTA computadora: bajarlas del FTP de ATM (o importarlas de archivos que se
// bajaron a mano), guardarlas en disco y tenerlas en memoria para el multicotizador.
//
// Cuándo se bajan: ATM las regenera todas las noches. El multicotizador las pide al cotizar y, si las
// que hay tienen más de un día (o no hay), prueba bajarlas antes; si el FTP no anda, sigue con las que
// tenga y lo avisa en la tarjeta. Para no hacer esperar cada cotización con un FTP bloqueado, después
// de una falla no vuelve a probar solo por media hora: para eso está «Actualizar tablas» en API
// Aseguradoras → ATM.
//
// Dónde quedan: `%APPDATA%/dm-gestion/atm/<ambiente>/`, los archivos tal como vinieron más un
// `estado.json` con la fecha y de qué tabla es cada uno. No van a la base ni viajan a otras
// computadoras: cada una las baja con la cuenta compartida.
import { Client, type FileInfo } from 'basic-ftp'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import type { AmbienteAtm, EstadoDeTablasAtm, TablaDeAtmEnDisco } from '../../../shared/tipos'
import { carpetaDatos } from '../../rutas'
import { esFallaDeRed } from '../../servicios/red'
import { ErrorDeAtm, type CuentaAtm } from './cliente'
import {
  armarTablas,
  decodificar,
  DESCRIPCION_TABLA_ATM,
  expandirArchivo,
  leerFilas,
  TABLAS_ATM,
  TABLAS_DE_VEHICULOS,
  tablaDelArchivo,
  type ArchivoSuelto,
  type FilaDeTabla,
  type TablaAtm,
  type TablasAtm,
} from './tablas'

/** El FTP de cada ambiente (capítulo 1 del manual). */
export const FTP_ATM: Record<AmbienteAtm, { host: string; puerto: number }> = {
  produccion: { host: 'wsatm.atmseguros.com.ar', puerto: 2113 },
  desarrollo: { host: 'wsatm-dev.atmseguros.com.ar', puerto: 2111 },
}

const VIGENCIA_MS = 24 * 60 * 60_000
const ESPERA_ENTRE_INTENTOS_MS = 30 * 60_000
const ESPERA_FTP_MS = 30_000
/** Ninguna tabla razonable pesa esto; más es otra cosa y no se baja. */
const MAXIMO_BYTES = 300 * 1024 * 1024

// ---------------------------------------------------------------------------
// La carpeta
// ---------------------------------------------------------------------------

let carpetaDePrueba: string | null = null

/** Las pruebas corren sin Electron: les dan una carpeta temporal. */
export function usarCarpetaDeTablasAtmDePrueba(ruta: string | null): void {
  carpetaDePrueba = ruta
  memoria.clear()
  ultimoFallo.clear()
}

function carpeta(ambiente: AmbienteAtm): string {
  return path.join(carpetaDePrueba ?? path.join(carpetaDatos(), 'atm'), ambiente)
}

interface ArchivoGuardado {
  /** El nombre en disco (dentro de la carpeta del ambiente). */
  nombre: string
  /** Cómo se llamaba en el FTP o en la computadora de donde se importó. */
  original: string
  tabla: TablaAtm
  bytes: number
}

interface EstadoGuardado {
  bajadasEn: string
  origen: 'ftp' | 'archivos'
  archivos: ArchivoGuardado[]
}

/**
 * Si un cambio de carpeta quedó a mitad de camino (se cortó la luz entre los dos renombres), las
 * tablas están en `.vieja` y no en su lugar: se las devuelve antes de leer nada.
 */
function recuperarCambioCortado(destino: string): void {
  const vieja = `${destino}.vieja`
  if (existsSync(destino) || !existsSync(vieja)) return
  try {
    renameSync(vieja, destino)
  } catch (error) {
    console.error('[atm] No se pudo recuperar la carpeta de las tablas:', error)
  }
}

function leerEstadoGuardado(ambiente: AmbienteAtm): EstadoGuardado | null {
  recuperarCambioCortado(carpeta(ambiente))
  const ruta = path.join(carpeta(ambiente), 'estado.json')
  if (!existsSync(ruta)) return null
  try {
    const estado = JSON.parse(readFileSync(ruta, 'utf8')) as EstadoGuardado
    return estado && typeof estado.bajadasEn === 'string' && Array.isArray(estado.archivos) ? estado : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Leer lo guardado
// ---------------------------------------------------------------------------

interface Leidas {
  estado: EstadoDeTablasAtm
  tablas: TablasAtm
}

/** Lo leído de disco, por ambiente, hasta que cambie lo guardado. */
const memoria = new Map<AmbienteAtm, { bajadasEn: string | null; leidas: Leidas }>()
/** La última vez que falló la bajada automática, para no reintentar en cada cotización. */
const ultimoFallo = new Map<AmbienteAtm, { cuando: number; motivo: string }>()

function leerDelDisco(ambiente: AmbienteAtm): Leidas {
  const guardado = leerEstadoGuardado(ambiente)
  const enMemoria = memoria.get(ambiente)
  if (enMemoria && enMemoria.bajadasEn === (guardado?.bajadasEn ?? null)) {
    return { ...enMemoria.leidas, estado: { ...enMemoria.leidas.estado, ultimoError: ultimoFallo.get(ambiente)?.motivo ?? null } }
  }

  const filas: Partial<Record<TablaAtm, FilaDeTabla[]>> = {}
  const porTabla: TablaDeAtmEnDisco[] = TABLAS_ATM.map((tabla) => {
    const archivo = guardado?.archivos.find((a) => a.tabla === tabla)
    const base: TablaDeAtmEnDisco = {
      tabla,
      descripcion: DESCRIPCION_TABLA_ATM[tabla],
      archivo: archivo?.original ?? null,
      filas: null,
      error: null,
      necesaria: TABLAS_DE_VEHICULOS.includes(tabla),
    }
    if (!archivo) return base
    try {
      const texto = decodificar(readFileSync(path.join(carpeta(ambiente), archivo.nombre)))
      filas[tabla] = leerFilas(texto, tabla)
      return { ...base, filas: filas[tabla]!.length }
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) }
    }
  })
  const tablas = armarTablas(filas)
  const leidas: Leidas = {
    tablas,
    estado: {
      ambiente,
      bajadasEn: guardado?.bajadasEn ?? null,
      origen: guardado?.origen ?? null,
      tablas: porTabla,
      vehiculos: tablas.vehiculos.length,
      listasParaCotizar: tablas.vehiculos.length > 0,
      ultimoError: ultimoFallo.get(ambiente)?.motivo ?? null,
    },
  }
  memoria.set(ambiente, { bajadasEn: guardado?.bajadasEn ?? null, leidas })
  return leidas
}

export function estadoDeTablasAtm(ambiente: AmbienteAtm): EstadoDeTablasAtm {
  return leerDelDisco(ambiente).estado
}

/** Las tablas que hay en disco, sin salir a buscar nuevas; null si no sirven para cotizar. */
export function tablasEnDisco(ambiente: AmbienteAtm): TablasAtm | null {
  const leidas = leerDelDisco(ambiente)
  return leidas.estado.listasParaCotizar ? leidas.tablas : null
}

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

/** Un nombre de archivo que se puede escribir en disco sin sorpresas. */
function nombreSeguro(nombre: string): string {
  const base = nombre.replace(/\\/g, '/').split('/').pop() ?? 'tabla'
  return base.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'tabla'
}

/**
 * Guarda los archivos (expandiendo .zip y .gz) que correspondan a alguna tabla. Lo que no es de una
 * tabla conocida se ignora. Las tablas que no vinieron conservan el archivo anterior, salvo que
 * `reemplazarTodo` (una bajada completa del FTP), que deja sólo lo nuevo.
 */
export function guardarTablas(ambiente: AmbienteAtm, entrada: ArchivoSuelto[], origen: 'ftp' | 'archivos', reemplazarTodo: boolean): EstadoDeTablasAtm {
  const porTabla = new Map<TablaAtm, ArchivoSuelto>()
  const ilegibles: string[] = []
  for (const archivo of entrada) {
    let expandidos: ArchivoSuelto[]
    try {
      expandidos = expandirArchivo(archivo)
    } catch (error) {
      ilegibles.push(`${archivo.nombre}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    for (const suelto of expandidos) {
      const tabla = tablaDelArchivo(suelto.nombre)
      if (tabla) porTabla.set(tabla, suelto)
    }
  }
  if (porTabla.size === 0) {
    throw new ErrorDeAtm(
      `Ninguno de los archivos es una tabla de ATM (se buscan nombres como «ws_au_marca_modelo» o «ws_au_infoauto»).${ilegibles.length > 0 ? ` ${ilegibles.join(' · ')}` : ''}`,
      false,
    )
  }

  const destino = carpeta(ambiente)
  const nueva = `${destino}.nueva`
  rmSync(nueva, { recursive: true, force: true })
  mkdirSync(nueva, { recursive: true })
  const guardado = leerEstadoGuardado(ambiente)
  const previo = reemplazarTodo ? null : guardado
  const archivos: ArchivoGuardado[] = []
  for (const tabla of TABLAS_ATM) {
    const nuevo = porTabla.get(tabla)
    // Un archivo nuevo que no se puede leer (o que viene vacío) no pisa uno que andaba: mejor las
    // tablas de ayer que ninguna. Pasa con una bajada cortada o un formato que cambió de un día al otro.
    const anteriorLegible = guardado?.archivos.find((a) => a.tabla === tabla)
    if (nuevo && anteriorLegible && !tieneFilas(nuevo, tabla) && archivoTieneFilas(path.join(destino, anteriorLegible.nombre), tabla)) {
      writeFileSync(path.join(nueva, anteriorLegible.nombre), readFileSync(path.join(destino, anteriorLegible.nombre)))
      archivos.push(anteriorLegible)
      continue
    }
    if (nuevo) {
      const nombre = `${tabla}__${nombreSeguro(nuevo.nombre)}`
      writeFileSync(path.join(nueva, nombre), nuevo.bytes)
      archivos.push({ nombre, original: nuevo.nombre, tabla, bytes: nuevo.bytes.length })
      continue
    }
    const anterior = previo?.archivos.find((a) => a.tabla === tabla)
    if (anterior && existsSync(path.join(destino, anterior.nombre))) {
      writeFileSync(path.join(nueva, anterior.nombre), readFileSync(path.join(destino, anterior.nombre)))
      archivos.push(anterior)
    }
  }
  const estado: EstadoGuardado = { bajadasEn: new Date().toISOString(), origen, archivos }
  writeFileSync(path.join(nueva, 'estado.json'), JSON.stringify(estado, null, 2), 'utf8')
  // El cambio de carpeta es lo último: si algo falló antes, quedan las tablas de antes, enteras. Y si
  // falla el cambio en sí (un antivirus que tiene tomado un archivo, en Windows), se vuelve atrás.
  const vieja = `${destino}.vieja`
  rmSync(vieja, { recursive: true, force: true })
  const habia = existsSync(destino)
  if (habia) renameSync(destino, vieja)
  try {
    renameSync(nueva, destino)
  } catch (error) {
    if (habia && !existsSync(destino)) renameSync(vieja, destino)
    throw error
  }
  try {
    rmSync(vieja, { recursive: true, force: true })
  } catch (error) {
    // Las tablas nuevas ya quedaron; lo viejo se borra la próxima vez.
    console.error('[atm] No se pudo borrar la carpeta anterior de las tablas:', error)
  }

  memoria.delete(ambiente)
  ultimoFallo.delete(ambiente)
  return estadoDeTablasAtm(ambiente)
}

function tieneFilas(archivo: ArchivoSuelto, tabla: TablaAtm): boolean {
  try {
    return leerFilas(decodificar(archivo.bytes), tabla).length > 0
  } catch {
    return false
  }
}

function archivoTieneFilas(ruta: string, tabla: TablaAtm): boolean {
  try {
    return tieneFilas({ nombre: ruta, bytes: readFileSync(ruta) }, tabla)
  } catch {
    return false
  }
}

/** Importa tablas desde archivos de esta computadora (bajados del FTP a mano). */
export function importarTablasAtm(ambiente: AmbienteAtm, rutas: string[]): EstadoDeTablasAtm {
  const archivos = rutas.map((ruta) => {
    try {
      return { nombre: path.basename(ruta), bytes: readFileSync(ruta) }
    } catch (error) {
      throw new ErrorDeAtm(`No se pudo leer ${path.basename(ruta)}: ${error instanceof Error ? error.message : String(error)}`, false)
    }
  })
  return guardarTablas(ambiente, archivos, 'archivos', false)
}

/** Al cambiar la cuenta: la falla anterior del FTP era de otro usuario o de otra clave. */
export function olvidarFallosDeTablasAtm(): void {
  ultimoFallo.clear()
}

/** Borra las tablas de un ambiente (al borrar la cuenta). */
export function borrarTablasAtm(ambiente: AmbienteAtm): void {
  rmSync(carpeta(ambiente), { recursive: true, force: true })
  memoria.delete(ambiente)
  ultimoFallo.delete(ambiente)
}

// ---------------------------------------------------------------------------
// El FTP
// ---------------------------------------------------------------------------

function esRechazoDeCuenta(error: unknown): boolean {
  const codigo = (error as { code?: unknown } | null)?.code
  return codigo === 530 || /^530\b/.test(error instanceof Error ? error.message : String(error))
}

function motivoDeFtp(error: unknown, cuenta: CuentaAtm): string {
  const { host, puerto } = FTP_ATM[cuenta.ambiente]
  const mensaje = error instanceof Error ? error.message : String(error)
  const codigo = (error as { code?: unknown } | null)?.code
  if (codigo === 530 || /^530\b/.test(mensaje)) return `El FTP de ATM no aceptó el usuario y la clave (${mensaje}).`
  if (esFallaDeRed(error) || /timeout|timed out/i.test(mensaje)) {
    return `No se pudo conectar al FTP de ATM (${host}, puerto ${puerto}): ${mensaje}. Si en esta red el FTP está bloqueado, bajá las tablas desde otra conexión e importalas desde archivos.`
  }
  return `El FTP de ATM falló: ${mensaje}`
}

async function conectar(cuenta: CuentaAtm): Promise<Client> {
  const { host, puerto } = FTP_ATM[cuenta.ambiente]
  const intentar = async (secure: boolean): Promise<Client> => {
    const cliente = new Client(ESPERA_FTP_MS)
    try {
      await cliente.access({ host, port: puerto, user: cuenta.usuario, password: cuenta.clave, secure, secureOptions: { servername: host } })
      return cliente
    } catch (error) {
      cliente.close()
      throw error
    }
  }
  // Primero con TLS, así el usuario y la clave (los mismos del web service) no viajan en claro. Si el
  // servidor no lo ofrece, sin cifrar: es el FTP que publica ATM y no hay otro. Un usuario o una clave
  // mal (530) no se reintenta: daría lo mismo.
  // Si ni siquiera hubo conexión (FTP bloqueado), probar otra vez sin cifrar sólo duplicaría la espera.
  try {
    return await intentar(true)
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error)
    if (esRechazoDeCuenta(error) || esFallaDeRed(error) || /timeout|timed out/i.test(mensaje)) throw error
    return await intentar(false)
  }
}

async function bajarArchivo(cliente: Client, ruta: string): Promise<Buffer> {
  const partes: Buffer[] = []
  let total = 0
  const destino = new Writable({
    write(parte: Buffer, _codificacion, listo) {
      total += parte.length
      if (total > MAXIMO_BYTES) return listo(new Error(`${ruta} pesa más de ${MAXIMO_BYTES / 1024 / 1024} MB.`))
      partes.push(parte)
      listo()
    },
  })
  await cliente.downloadTo(destino, ruta)
  return Buffer.concat(partes)
}

interface Candidato {
  ruta: string
  info: FileInfo
  tabla: TablaAtm | null
}

function esComprimido(nombre: string): boolean {
  return /\.(zip|gz)$/i.test(nombre)
}

/** El archivo más nuevo de cada tabla (por fecha si el FTP la da; si no, por nombre). */
function masNuevo(a: Candidato, b: Candidato): Candidato {
  const fa = a.info.modifiedAt?.getTime() ?? 0
  const fb = b.info.modifiedAt?.getTime() ?? 0
  if (fa !== fb) return fa > fb ? a : b
  return a.ruta.localeCompare(b.ruta) >= 0 ? a : b
}

/** Baja del FTP las tablas que reconozca (en la raíz o una carpeta adentro). */
export async function bajarTablasPorFtp(cuenta: CuentaAtm): Promise<ArchivoSuelto[]> {
  let cliente: Client | null = null
  try {
    cliente = await conectar(cuenta)
    const candidatos: Candidato[] = []
    const raiz = await cliente.list()
    for (const info of raiz) {
      if (info.isFile) candidatos.push({ ruta: info.name, info, tabla: tablaDelArchivo(info.name) })
    }
    // Si en la raíz no hay ninguna tabla, se mira un nivel adentro (una carpeta por ambiente o por día).
    if (!candidatos.some((c) => c.tabla)) {
      for (const carpetaRemota of raiz.filter((info) => info.isDirectory && !/^\.\.?$/.test(info.name))) {
        for (const info of await cliente.list(carpetaRemota.name)) {
          const ruta = `${carpetaRemota.name}/${info.name}`
          if (info.isFile) candidatos.push({ ruta, info, tabla: tablaDelArchivo(info.name) })
        }
      }
    }

    const porTabla = new Map<TablaAtm, Candidato>()
    for (const candidato of candidatos) {
      if (!candidato.tabla) continue
      const previo = porTabla.get(candidato.tabla)
      porTabla.set(candidato.tabla, previo ? masNuevo(previo, candidato) : candidato)
    }
    // Sin tablas sueltas, los comprimidos (un .zip con todo adentro, por ejemplo).
    const aBajar = porTabla.size > 0 ? [...porTabla.values()] : candidatos.filter((c) => esComprimido(c.info.name))
    if (aBajar.length === 0) {
      const vistos = candidatos.map((c) => c.ruta).slice(0, 15)
      throw new ErrorDeAtm(
        `En el FTP de ATM no se encontró ninguna tabla conocida.${vistos.length > 0 ? ` Hay: ${vistos.join(', ')}${candidatos.length > 15 ? '…' : ''}.` : ' Está vacío.'}`,
        false,
      )
    }
    const archivos: ArchivoSuelto[] = []
    for (const candidato of aBajar) archivos.push({ nombre: candidato.info.name, bytes: await bajarArchivo(cliente, candidato.ruta) })
    return archivos
  } catch (error) {
    if (error instanceof ErrorDeAtm) throw error
    throw new ErrorDeAtm(motivoDeFtp(error, cuenta), esFallaDeRed(error))
  } finally {
    cliente?.close()
  }
}

/** Una bajada a la vez por ambiente: si ya hay una en curso, se espera ésa. */
const enCurso = new Map<AmbienteAtm, Promise<EstadoDeTablasAtm>>()

let ftpDePrueba: ((cuenta: CuentaAtm) => Promise<ArchivoSuelto[]>) | null = null

/** Las pruebas no salen a internet: reemplazan el FTP por una función que devuelve los archivos. */
export function usarFtpDeAtmDePrueba(bajar: ((cuenta: CuentaAtm) => Promise<ArchivoSuelto[]>) | null): void {
  ftpDePrueba = bajar
}

/** Baja todas las tablas del FTP y las guarda. Es lo que hace el botón «Actualizar tablas». */
export function actualizarTablasAtm(cuenta: CuentaAtm): Promise<EstadoDeTablasAtm> {
  const previa = enCurso.get(cuenta.ambiente)
  if (previa) return previa
  const bajada = (ftpDePrueba ?? bajarTablasPorFtp)(cuenta)
    .then((archivos) => guardarTablas(cuenta.ambiente, archivos, 'ftp', true))
    .catch((error: unknown) => {
      ultimoFallo.set(cuenta.ambiente, { cuando: Date.now(), motivo: error instanceof Error ? error.message : String(error) })
      throw error
    })
    .finally(() => enCurso.delete(cuenta.ambiente))
  enCurso.set(cuenta.ambiente, bajada)
  return bajada
}

function fechaCorta(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Las tablas para cotizar. Si las guardadas tienen más de un día (o no hay), primero prueba bajarlas;
 * si no puede, sigue con las que tenga y devuelve el aviso. Sin ninguna, tira `ErrorDeAtm`.
 */
export async function tablasParaCotizar(cuenta: CuentaAtm): Promise<{ tablas: TablasAtm; aviso: string | null }> {
  let leidas = leerDelDisco(cuenta.ambiente)
  const vencidas = !leidas.estado.bajadasEn || Date.now() - new Date(leidas.estado.bajadasEn).getTime() > VIGENCIA_MS
  const fallo = ultimoFallo.get(cuenta.ambiente)
  const puedeReintentar = !fallo || Date.now() - fallo.cuando > ESPERA_ENTRE_INTENTOS_MS
  let motivo: string | null = fallo?.motivo ?? null
  if (vencidas && puedeReintentar) {
    try {
      await actualizarTablasAtm(cuenta)
      motivo = null
    } catch (error) {
      motivo = error instanceof Error ? error.message : String(error)
    }
    leidas = leerDelDisco(cuenta.ambiente)
  }
  if (!leidas.estado.listasParaCotizar) {
    const ilegibles = leidas.estado.tablas.filter((t) => t.necesaria && t.error).map((t) => `${t.tabla}: ${t.error}`)
    throw new ErrorDeAtm(
      'Faltan las tablas de vehículos de ATM, que ATM publica por FTP y hacen falta para saber su código del vehículo. ' +
        (ilegibles.length > 0 ? `No se pudieron leer: ${ilegibles.join(' · ')}. ` : motivo ? `${motivo} ` : '') +
        'Se bajan desde API Aseguradoras → ATM («Actualizar tablas» o «Importar desde archivos»).',
      false,
    )
  }
  const aviso =
    vencidas && motivo && leidas.estado.bajadasEn
      ? `Se cotizó con las tablas de ATM del ${fechaCorta(leidas.estado.bajadasEn)}: no se pudieron actualizar (${motivo}).`
      : null
  return { tablas: leidas.tablas, aviso }
}

/** Para las pruebas: los archivos que quedaron en disco. */
export function archivosEnDisco(ambiente: AmbienteAtm): string[] {
  const ruta = carpeta(ambiente)
  return existsSync(ruta) ? readdirSync(ruta).sort() : []
}
