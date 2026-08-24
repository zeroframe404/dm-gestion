// La base de usuarios compartida: GitHub como fuente de verdad, el espejo local para las claves
// foráneas y una credencial cifrada por computadora para ingresar sin internet.
//
// No importa Electron a propósito: index.ts le inyecta el almacén (GitHub o nada), el cifrador
// (safeStorage) y la versión, y las pruebas le inyectan un almacén en memoria y un cifrador de mentira.
//
// Cómo se decide el camino de cada ingreso (ver ModoDeAcceso en shared/tipos.ts):
//   - sin almacén                      → «local»: los usuarios de esta computadora, como siempre.
//   - con almacén y sin usuarios.json  → «sin-inicializar»: todavía local; un SUPER_ADMIN los sube
//                                        desde Usuarios (nunca automático: una PC recién instalada
//                                        subiría la semilla daniel/cambiar123 y pisaría a los de verdad).
//   - con almacén y archivo            → se valida contra GitHub; si no se llega, con la credencial guardada.
import os from 'node:os'
import type { MatrizPermisos } from '../../shared/permisos'
import type { EstadoDeAcceso, EstadoDeUsuarios, ModoDeAcceso, Rol, SesionUsuario, Usuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ErrorDeConflicto, ErrorDelAlmacen, type AlmacenRemoto } from '../usuarios/almacen'
import { estaVencida, type AlmacenDeCredencial } from '../usuarios/credencial'
import {
  agregarExistentes,
  agregarUsuario,
  buscarPorId,
  buscarPorUsuario,
  cambiarActivo as cambiarActivoEnDocumento,
  cambiarClaveHash,
  documentoVacio,
  editarUsuario as editarUsuarioEnDocumento,
  escribirDocumento,
  guardarPermisos as guardarPermisosEnDocumento,
  leerDocumento,
  tieneSuperAdminActivo,
  type DocumentoUsuarios,
  type UsuarioRemoto,
} from '../usuarios/documento'
import { asegurarFilaDesdeCredencial, idDeSucursal, idLocalPorRemotoId, reflejarDocumento, remotoIdDeLocal, usuariosLocalesConClave } from '../usuarios/espejo'
import { aUsuario, buscarFilaPorId, buscarFilaPorRemotoId, type FilaUsuario } from '../usuarios/filas'
import { hashearClave, hashSenuelo, verificarClave } from './claves'
import { guardarCopiaLocal, leerCopiaLocal, olvidarCopiaEnMemoria } from './copiaDePermisos'
import { ErrorDeNegocio } from './errores'
import { esFallaDeRed } from './red'
import { establecerSesion, sesion } from './sesion'
import { obtenerSucursal } from './sucursales'

// ---------------------------------------------------------------------------
// Configuración y estado
// ---------------------------------------------------------------------------

export interface ConfiguracionBaseDeUsuarios {
  /** null = sin base compartida (desarrollo sin token, pruebas, o versión publicada sin token). */
  almacen: AlmacenRemoto | null
  credenciales: AlmacenDeCredencial | null
  /** true si es un ejecutable publicado que salió sin token: se avisa, porque no es lo esperado. */
  sinTokenEnProduccion?: boolean
  version?: string
  nombreDeEquipo?: string
  /** Reloj inyectable (pruebas). */
  ahora?: () => Date
  /** Cuánto se recuerda un «sin internet» antes de volver a probar (pruebas: 0). */
  memoriaSinInternetMs?: number
  /** Dónde contar lo que hace (enlaces, reintentos, bootstrap). Por defecto, la consola. */
  registrar?: (mensaje: string) => void
}

interface Emisor {
  estado: (estado: EstadoDeAcceso) => void
  /** La sesión abierta cambió de datos (rol, nombre, sucursal) al confirmarse contra GitHub. */
  sesionActualizada: (sesion: SesionUsuario) => void
  sesionCerrada: (motivo: string) => void
}

/** Quién está logueado, según GitHub o la credencial: nunca según la tabla local editable. */
interface Identidad {
  remotoId: number | null
  modo: ModoDeAcceso
  /** Hash con el que se validó el ingreso; si GitHub tiene otro, alguien cambió la contraseña desde otra PC. */
  claveHash: string | null
}

type Lectura =
  | { tipo: 'documento'; documento: DocumentoUsuarios; sha: string }
  | { tipo: 'sin-archivo' }
  | { tipo: 'sin-internet'; error: string }
  | { tipo: 'error-remoto'; error: string }

const CLAVE_MODO = 'usuarios_modo'
const CLAVE_ULTIMA_LECTURA = 'usuarios_ultima_lectura'
/** Después de una falla de red no se vuelve a salir a internet por este tiempo: el Login y el ingreso comparten el veredicto. */
const MEMORIA_SIN_INTERNET_POR_DEFECTO_MS = 15_000
let memoriaSinInternetMs = MEMORIA_SIN_INTERNET_POR_DEFECTO_MS
const INTENTOS_DE_ESCRITURA = 4
const REVALIDAR_SIN_CONFIRMAR_MS = 2 * 60_000
const REVALIDAR_EN_LINEA_MS = 15 * 60_000
const MENSAJE_SIN_INTERNET_PARA_ADMINISTRAR =
  'Necesitás conexión a internet para esto: los usuarios se guardan en la base compartida, no en esta computadora.'

let almacen: AlmacenRemoto | null = null
let credenciales: AlmacenDeCredencial | null = null
let sinTokenEnProduccion = false
let version = ''
let nombreDeEquipo = os.hostname()
let ahora: () => Date = () => new Date()
let registrar: (mensaje: string) => void = (mensaje) => console.log(mensaje)
let emisor: Emisor | null = null

let identidad: Identidad | null = null
let ultimoDocumento: { documento: DocumentoUsuarios; sha: string } | null = null
let lecturaEnCurso: Promise<Lectura> | null = null
let sinInternetHasta = 0
let temporizador: NodeJS.Timeout | null = null
let proximaRevalidacion = 0

let estado: EstadoDeAcceso = estadoInicial()

function estadoInicial(): EstadoDeAcceso {
  return {
    configurada: false,
    repo: null,
    modo: 'local',
    sinTokenEnProduccion: false,
    usuarioGuardado: null,
    puedeGuardarCredencial: false,
    cantidad: null,
    ultimaComprobacion: null,
    ultimaLecturaBuena: null,
    ultimoError: null,
    tokenVence: null,
    sesionSinConfirmar: false,
  }
}

export function configurarBaseDeUsuarios(config: ConfiguracionBaseDeUsuarios): void {
  almacen = config.almacen
  credenciales = config.credenciales
  sinTokenEnProduccion = config.sinTokenEnProduccion === true
  version = config.version ?? ''
  nombreDeEquipo = config.nombreDeEquipo ?? os.hostname()
  ahora = config.ahora ?? (() => new Date())
  memoriaSinInternetMs = config.memoriaSinInternetMs ?? MEMORIA_SIN_INTERNET_POR_DEFECTO_MS
  registrar = config.registrar ?? ((mensaje) => console.log(mensaje))
  identidad = null
  ultimoDocumento = null
  lecturaEnCurso = null
  sinInternetHasta = 0
  // Se está configurando el acceso de cero (arranque del programa, o una prueba con otra base):
  // lo que se recuerde de la copia local de permisos era de la base anterior.
  olvidarCopiaEnMemoria()
  detenerRevalidacion()
  estado = {
    ...estadoInicial(),
    configurada: almacen !== null,
    repo: almacen?.descripcion ?? null,
    sinTokenEnProduccion,
    modo: almacen ? (modoPersistido() === 'github' ? 'sin-internet' : 'sin-inicializar') : 'local',
    usuarioGuardado: credenciales?.usuarioGuardado() ?? null,
    puedeGuardarCredencial: credenciales?.puedeCifrar() ?? false,
    ultimaLecturaBuena: almacen ? leerConfiguracion(CLAVE_ULTIMA_LECTURA) : null,
  }
}

export function conectarEmisor(nuevo: Emisor | null): void {
  emisor = nuevo
}

export function estaConfigurada(): boolean {
  return almacen !== null
}

/** true cuando esta computadora ya trabaja contra GitHub (hubo al menos una sincronización). */
export function usaBaseCompartida(): boolean {
  return almacen !== null && modoPersistido() === 'github'
}

export function estadoDeAcceso(): EstadoDeAcceso {
  return { ...estado, usuarioGuardado: credenciales?.usuarioGuardado() ?? null }
}

function ahoraIso(): string {
  return ahora().toISOString()
}

function modoPersistido(): 'github' | null {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(CLAVE_MODO) as { valor: string } | undefined
  return fila?.valor === 'github' ? 'github' : null
}

function persistirModo(): void {
  guardarConfiguracion(CLAVE_MODO, 'github')
}

function guardarConfiguracion(clave: string, valor: string): void {
  db()
    .prepare(
      `INSERT INTO configuracion (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
    .run(clave, valor, ahoraIso())
}

function leerConfiguracion(clave: string): string | null {
  const fila = db().prepare('SELECT valor FROM configuracion WHERE clave = ?').get(clave) as { valor: string } | undefined
  return fila?.valor ?? null
}

/** Cuándo se leyó bien GitHub por última vez: sobrevive al reinicio, para decir «actualizada hace 2 horas». */
function anotarLecturaBuena(iso: string): void {
  guardarConfiguracion(CLAVE_ULTIMA_LECTURA, iso)
}

function cambiarEstado(cambios: Partial<EstadoDeAcceso>): void {
  estado = { ...estado, ...cambios, tokenVence: almacen?.vencimientoDelToken() ?? estado.tokenVence }
  emisor?.estado(estadoDeAcceso())
}

function igualSinMayusculas(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

// ---------------------------------------------------------------------------
// Leer GitHub
// ---------------------------------------------------------------------------

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Una sola lectura en vuelo: el Login al montarse, el ingreso y la pantalla Usuarios comparten el
 * resultado en vez de esperar 8 segundos cada uno. Nunca lanza: devuelve qué pasó.
 */
async function leerRemoto(): Promise<Lectura> {
  if (!almacen) throw new Error('La base de usuarios compartida no está configurada.')
  if (lecturaEnCurso) return lecturaEnCurso
  if (Date.now() < sinInternetHasta) return { tipo: 'sin-internet', error: estado.ultimoError ?? 'Sin conexión a internet.' }
  const fuente = almacen
  lecturaEnCurso = (async (): Promise<Lectura> => {
    const comprobadoEn = ahoraIso()
    try {
      const lectura = await fuente.leer()
      if (!lectura) {
        anotarLecturaBuena(comprobadoEn)
        cambiarEstado({ ultimaComprobacion: comprobadoEn, ultimaLecturaBuena: comprobadoEn, ultimoError: null, cantidad: 0 })
        return { tipo: 'sin-archivo' }
      }
      const documento = leerDocumento(lectura.texto)
      if (!tieneSuperAdminActivo(documento)) {
        throw new ErrorDeNegocio('La base de usuarios compartida no tiene ningún superadministrador activo: hay que corregir usuarios.json en GitHub.')
      }
      ultimoDocumento = { documento, sha: lectura.sha }
      anotarLecturaBuena(comprobadoEn)
      cambiarEstado({ ultimaComprobacion: comprobadoEn, ultimaLecturaBuena: comprobadoEn, ultimoError: null, cantidad: documento.usuarios.length })
      return { tipo: 'documento', documento, sha: lectura.sha }
    } catch (error) {
      const temporal = error instanceof ErrorDelAlmacen && error.temporal
      if (esFallaDeRed(error) || temporal) {
        sinInternetHasta = Date.now() + memoriaSinInternetMs
        const mensaje = temporal ? mensajeDe(error) : 'Sin conexión a internet.'
        cambiarEstado({ ultimaComprobacion: comprobadoEn, ultimoError: mensaje })
        return { tipo: 'sin-internet', error: mensaje }
      }
      const mensaje = error instanceof ErrorDelAlmacen || error instanceof ErrorDeNegocio ? error.message : `No se pudo leer la base de usuarios: ${mensajeDe(error)}`
      console.error('[usuarios] GitHub respondió con error:', mensaje)
      cambiarEstado({ ultimaComprobacion: comprobadoEn, ultimoError: mensaje })
      return { tipo: 'error-remoto', error: mensaje }
    } finally {
      lecturaEnCurso = null
    }
  })()
  return lecturaEnCurso
}

/**
 * Vuelca el documento al espejo y deja la computadora en modo compartido. Si el espejo falla (un caso
 * que el espejo no previó), no puede impedir el ingreso: el documento ya leído alcanza para validar la
 * contraseña. Devuelve false y deja el error a la vista del administrador.
 */
function reflejar(documento: DocumentoUsuarios): boolean {
  try {
    // La matriz de permisos viaja en el mismo archivo y se copia acá para que valga también cuando se
    // ingresa sin internet, antes de haber podido leer GitHub.
    guardarCopiaLocal(documento.permisos, ahoraIso())
    const resultado = reflejarDocumento(db(), documento, ahoraIso())
    if (modoPersistido() !== 'github') persistirModo()
    if (resultado.enlazados.length > 0) registrar(`[usuarios] Enlazados con GitHub por nombre de usuario: ${resultado.enlazados.join(', ')}`)
    if (resultado.desactivados.length > 0) {
      registrar(`[usuarios] No están en la base compartida y quedan desactivados en esta computadora: ${resultado.desactivados.join(', ')}`)
    }
    return true
  } catch (error) {
    const mensaje = `No se pudo actualizar la lista local de usuarios: ${mensajeDe(error)}`
    console.error('[usuarios]', mensaje)
    cambiarEstado({ ultimoError: mensaje })
    return false
  }
}

/**
 * Sale a GitHub, refresca el espejo y, si hay una sesión abierta, la vuelve a comprobar. Es lo que
 * corre el Login al montarse, la pantalla Usuarios, Acerca de («Probar conexión») y el temporizador.
 */
export async function comprobarAcceso(): Promise<EstadoDeAcceso> {
  if (!almacen) return estadoDeAcceso()
  sinInternetHasta = 0
  const lectura = await leerRemoto()
  if (lectura.tipo === 'documento') {
    const reflejado = reflejar(lectura.documento)
    revalidarSesion(lectura.documento)
    cambiarEstado({ modo: reflejado ? 'en-linea' : 'error-remoto' })
  } else if (lectura.tipo === 'sin-archivo') {
    cambiarEstado({ modo: modoPersistido() === 'github' ? 'error-remoto' : 'sin-inicializar', ultimoError: modoPersistido() === 'github' ? 'El archivo usuarios.json ya no está en GitHub. Hay que restaurarlo desde el historial del repositorio.' : null })
  } else {
    cambiarEstado({ modo: lectura.tipo })
  }
  return estadoDeAcceso()
}

/** Con el documento recién leído: confirma o cierra la sesión abierta. */
function revalidarSesion(documento: DocumentoUsuarios): void {
  const actual = sesion()
  if (!actual || !identidad) return
  if (identidad.remotoId === null) {
    // Sesión abierta con la tabla local mientras otra computadora inicializaba la base compartida: ya no
    // se puede confiar en ella (su usuario puede no estar en GitHub) y no puede administrar nada.
    if (identidad.modo === 'sin-inicializar') {
      cerrarSesionDesdeAfuera('La base de usuarios compartida se inicializó desde otra computadora. Volvé a ingresar con tu usuario.')
    }
    return
  }
  const remoto = buscarPorId(documento, identidad.remotoId)
  if (!remoto || !remoto.activo) {
    cerrarSesionDesdeAfuera('Tu usuario fue desactivado desde otra computadora. Si te parece un error, consultá con un administrador.')
    return
  }
  if (identidad.claveHash !== null && remoto.claveHash !== identidad.claveHash) {
    cerrarSesionDesdeAfuera('La contraseña de tu usuario cambió desde otra computadora. Volvé a iniciar sesión con la contraseña nueva.')
    return
  }
  const fila = buscarFilaPorRemotoId(remoto.id)
  if (!fila) return
  // Confirmada: la sesión pasa a tener los permisos de GitHub (puede haber cambiado el rol o la sucursal).
  identidad = { remotoId: remoto.id, modo: 'en-linea', claveHash: remoto.claveHash }
  const confirmada: SesionUsuario = {
    id: fila.id,
    nombre: remoto.nombre,
    usuario: remoto.usuario,
    rol: remoto.rol,
    sucursal: { id: fila.sucursal_id, nombre: fila.sucursal_nombre },
    debeCambiarClave: remoto.debeCambiarClave,
  }
  establecerSesion(confirmada)
  if (JSON.stringify(confirmada) !== JSON.stringify(actual)) emisor?.sesionActualizada(confirmada)
  if (!remoto.debeCambiarClave) guardarCredencial(remoto)
  cambiarEstado({ sesionSinConfirmar: false })
  proximaRevalidacion = Date.now() + REVALIDAR_EN_LINEA_MS
}

function cerrarSesionDesdeAfuera(motivo: string): void {
  const actual = sesion()
  if (actual && credenciales && igualSinMayusculas(credenciales.usuarioGuardado() ?? '', actual.usuario)) credenciales.borrar()
  cerrarSesion()
  emisor?.sesionCerrada(motivo)
}

// ---------------------------------------------------------------------------
// Credencial para ingresar sin internet
// ---------------------------------------------------------------------------

function guardarCredencial(remoto: UsuarioRemoto): void {
  if (!credenciales) return
  credenciales.guardar({
    remotoId: remoto.id,
    usuario: remoto.usuario,
    claveHash: remoto.claveHash,
    nombre: remoto.nombre,
    rol: remoto.rol,
    sucursal: remoto.sucursal,
    guardadoEn: ahoraIso(),
  })
  cambiarEstado({ usuarioGuardado: remoto.usuario })
}

function borrarCredencialDe(usuario: string): void {
  if (!credenciales) return
  const guardado = credenciales.usuarioGuardado()
  if (guardado && igualSinMayusculas(guardado, usuario)) {
    credenciales.borrar()
    cambiarEstado({ usuarioGuardado: null })
  }
}

// ---------------------------------------------------------------------------
// Ingreso
// ---------------------------------------------------------------------------

function sesionDesdeRemoto(remoto: UsuarioRemoto, fila: FilaUsuario): SesionUsuario {
  return {
    id: fila.id,
    nombre: remoto.nombre,
    usuario: remoto.usuario,
    rol: remoto.rol,
    sucursal: { id: fila.sucursal_id, nombre: fila.sucursal_nombre },
    debeCambiarClave: remoto.debeCambiarClave,
  }
}

/**
 * Ingreso contra la base compartida. `usuario` ya viene validado y en minúsculas; la contraseña, sin
 * validar (no hace falta: sólo se compara).
 */
export async function ingresar(usuario: string, clave: string): Promise<SesionUsuario> {
  if (!almacen) throw new Error('ingresar() de la base compartida se llamó sin almacén.')
  const lectura = await leerRemoto()

  if (lectura.tipo === 'documento') {
    const reflejado = reflejar(lectura.documento)
    const remoto = buscarPorUsuario(lectura.documento, usuario)
    const claveCorrecta = await verificarClave(clave, remoto ? remoto.claveHash : hashSenuelo())
    if (!remoto || !claveCorrecta) {
      // Si la contraseña que conoce esta computadora ya no es la de GitHub, la credencial guardada no sirve más.
      if (remoto && credenciales && igualSinMayusculas(credenciales.usuarioGuardado() ?? '', remoto.usuario)) {
        const guardada = credenciales.leer()
        if (guardada && guardada.claveHash !== remoto.claveHash) borrarCredencialDe(remoto.usuario)
      }
      throw new ErrorDeNegocio('Usuario o contraseña incorrectos.')
    }
    if (!remoto.activo) {
      borrarCredencialDe(remoto.usuario)
      throw new ErrorDeNegocio('Tu usuario está desactivado. Consultá con un administrador.')
    }
    const fila = buscarFilaPorRemotoId(remoto.id)
    if (!fila) {
      // El espejo no pudo volcarse y este usuario nunca tuvo fila acá: sin fila no hay a quién apuntar.
      throw new ErrorDeNegocio(
        `${estado.ultimoError ?? 'No se pudo actualizar la lista local de usuarios.'} Avisale al administrador.`,
      )
    }

    identidad = { remotoId: remoto.id, modo: 'en-linea', claveHash: remoto.claveHash }
    const nueva = sesionDesdeRemoto(remoto, fila)
    establecerSesion(nueva)
    // La credencial se guarda recién cuando la contraseña es propia: con una temporal de otro, no.
    if (remoto.debeCambiarClave) borrarCredencialDe(remoto.usuario)
    else guardarCredencial(remoto)
    cambiarEstado({ modo: reflejado ? 'en-linea' : 'error-remoto', sesionSinConfirmar: false })
    iniciarRevalidacion(REVALIDAR_EN_LINEA_MS)
    return nueva
  }

  // GitHub no está disponible (sin internet, o respondió con error): la credencial guardada.
  const modo: ModoDeAcceso = lectura.tipo === 'sin-internet' ? 'sin-internet' : 'error-remoto'
  const detalle = lectura.tipo === 'sin-archivo' ? 'El archivo usuarios.json ya no está en GitHub.' : lectura.error
  if (lectura.tipo === 'sin-archivo') cambiarEstado({ ultimoError: detalle })
  cambiarEstado({ modo })
  const sinInternet = modo === 'sin-internet'
  const porque = sinInternet ? 'Sin internet.' : 'Hay internet, pero el programa no pudo acceder a la base de usuarios. Avisale al administrador.'

  const guardada = credenciales?.leer() ?? null
  if (!guardada) {
    throw new ErrorDeNegocio(
      sinInternet
        ? 'Sin internet. Para ingresar por primera vez en esta computadora hace falta conexión. Probá de nuevo cuando vuelva.'
        : `${porque} Y en esta computadora no hay ninguna credencial guardada para ingresar mientras tanto.`,
    )
  }
  if (!igualSinMayusculas(guardada.usuario, usuario)) {
    await verificarClave(clave, hashSenuelo())
    throw new ErrorDeNegocio(
      `${porque} En esta computadora sólo puede ingresar «${guardada.usuario}», que fue quien ingresó por última vez con conexión. Cuando vuelva el acceso vas a poder entrar con tu usuario.`,
    )
  }
  if (estaVencida(guardada, ahora())) {
    await verificarClave(clave, hashSenuelo())
    throw new ErrorDeNegocio('Pasaron más de 30 días desde el último ingreso con internet en esta computadora: hace falta conexión para validar tu acceso.')
  }
  if (!(await verificarClave(clave, guardada.claveHash))) throw new ErrorDeNegocio('Usuario o contraseña incorrectos.')

  const localId = asegurarFilaDesdeCredencial(db(), guardada, ahoraIso())
  const fila = buscarFilaPorId(localId)
  // El espejo sólo RESTRINGE (si otra sesión en línea ya lo vio desactivado o reseteado); nunca otorga.
  if (fila && fila.activo !== 1) {
    borrarCredencialDe(guardada.usuario)
    throw new ErrorDeNegocio('Tu usuario está desactivado. Consultá con un administrador.')
  }
  if (fila && fila.debe_cambiar_clave === 1) {
    throw new ErrorDeNegocio('Un administrador reseteó tu contraseña: tenés que ingresar con internet para elegir la nueva.')
  }

  identidad = { remotoId: guardada.remotoId, modo, claveHash: guardada.claveHash }
  const nueva: SesionUsuario = {
    id: localId,
    nombre: guardada.nombre,
    usuario: guardada.usuario,
    rol: guardada.rol,
    sucursal: { id: idDeSucursal(db(), guardada.sucursal), nombre: fila?.sucursal_nombre ?? guardada.sucursal },
    debeCambiarClave: false,
  }
  establecerSesion(nueva)
  cambiarEstado({ sesionSinConfirmar: true })
  iniciarRevalidacion(REVALIDAR_SIN_CONFIRMAR_MS)
  return nueva
}

/** Para el camino local (sin base compartida o sin inicializar): deja anotado cómo se ingresó. */
export function anotarIngresoLocal(): void {
  identidad = { remotoId: null, modo: almacen ? 'sin-inicializar' : 'local', claveHash: null }
  cambiarEstado({ sesionSinConfirmar: false })
}

export function cerrarSesion(): void {
  establecerSesion(null)
  identidad = null
  detenerRevalidacion()
  cambiarEstado({ sesionSinConfirmar: false })
}

/**
 * Antes de decidir si el ingreso va por GitHub o por la tabla local: si la computadora todavía no
 * sincronizó nunca pero el archivo ya existe en GitHub, se refleja y pasa a modo compartido acá mismo.
 */
export async function prepararIngreso(): Promise<'compartida' | 'local'> {
  if (!almacen) return 'local'
  if (modoPersistido() === 'github') return 'compartida'
  const lectura = await leerRemoto()
  if (lectura.tipo === 'documento') {
    const reflejado = reflejar(lectura.documento)
    cambiarEstado({ modo: reflejado ? 'en-linea' : 'error-remoto' })
    return reflejado ? 'compartida' : 'local'
  }
  cambiarEstado({ modo: lectura.tipo === 'sin-archivo' ? 'sin-inicializar' : lectura.tipo })
  // Sin llegar a GitHub: si hay una credencial guardada, esta computadora ya sincronizó alguna vez
  // (aunque la base local se haya recreado) y el ingreso va por la credencial, no por la tabla.
  if (lectura.tipo !== 'sin-archivo' && credenciales?.usuarioGuardado()) return 'compartida'
  return 'local'
}

/**
 * Para el camino local cuando la base compartida está configurada pero no se pudo leer: si el usuario
 * tipeado no existe en esta computadora, el mensaje tiene que explicar la falta de acceso, no
 * «usuario o contraseña incorrectos».
 */
export function motivoSinAccesoLocal(): string | null {
  if (!almacen) return null
  if (estado.modo === 'sin-internet') return 'Sin internet. Para ingresar por primera vez en esta computadora hace falta conexión. Probá de nuevo cuando vuelva.'
  if (estado.modo === 'error-remoto') return 'Hay internet, pero el programa no pudo acceder a la base de usuarios. Avisale al administrador.'
  return null
}

// ---------------------------------------------------------------------------
// Revalidación en segundo plano
// ---------------------------------------------------------------------------

function iniciarRevalidacion(primeraEsperaMs: number): void {
  proximaRevalidacion = Date.now() + primeraEsperaMs
  if (temporizador) return
  temporizador = setInterval(() => {
    if (Date.now() < proximaRevalidacion) return
    proximaRevalidacion = Date.now() + (identidad?.modo === 'en-linea' ? REVALIDAR_EN_LINEA_MS : REVALIDAR_SIN_CONFIRMAR_MS)
    void comprobarAcceso().catch((error) => console.error('[usuarios] No se pudo revalidar la sesión:', error))
  }, 30_000)
  temporizador.unref()
}

function detenerRevalidacion(): void {
  if (temporizador) clearInterval(temporizador)
  temporizador = null
}

/** Sólo para las pruebas: dispara ya la revalidación que haría el temporizador. */
export async function revalidarAhora(): Promise<EstadoDeAcceso> {
  return comprobarAcceso()
}

// ---------------------------------------------------------------------------
// Escribir GitHub
// ---------------------------------------------------------------------------

function traducirFallaDeEscritura(error: unknown): never {
  if (error instanceof ErrorDeNegocio) throw error
  if (esFallaDeRed(error) || (error instanceof ErrorDelAlmacen && error.temporal)) {
    sinInternetHasta = Date.now() + memoriaSinInternetMs
    cambiarEstado({ modo: 'sin-internet', ultimoError: error instanceof ErrorDelAlmacen ? error.message : 'Sin conexión a internet.' })
    throw new ErrorDeNegocio(MENSAJE_SIN_INTERNET_PARA_ADMINISTRAR)
  }
  if (error instanceof ErrorDelAlmacen) {
    cambiarEstado({ modo: 'error-remoto', ultimoError: error.message })
    throw new ErrorDeNegocio(`No se pudo guardar en la base de usuarios: ${error.message}`)
  }
  throw error
}

function exigirEnLinea(): number {
  if (!identidad || identidad.remotoId === null) throw new ErrorDeNegocio('Esta sesión no está validada contra la base compartida. Cerrá sesión y volvé a ingresar.')
  if (identidad.modo !== 'en-linea') {
    throw new ErrorDeNegocio('Ingresaste sin conexión y la sesión todavía no se confirmó contra la base compartida. Cuando vuelva internet se confirma sola; si ya volvió, cerrá sesión y volvé a ingresar.')
  }
  return identidad.remotoId
}

interface Mutacion {
  accion: string
  actor: SesionUsuario
  /** Qué tiene que cumplir el actor en el documento recién leído. */
  exigir: 'super-admin' | 'activo'
  aplicar: (documento: DocumentoUsuarios, actorRemoto: UsuarioRemoto, ahoraIso: string) => Promise<DocumentoUsuarios> | DocumentoUsuarios
}

/**
 * Lee, aplica la mutación, escribe con el sha de la lectura. Si otra computadora escribió en el medio
 * (409), relee y vuelve a aplicar; si la escritura se corta sin respuesta, relee y se fija si quedó.
 */
async function mutarRemoto(mutacion: Mutacion): Promise<DocumentoUsuarios> {
  if (!almacen) throw new ErrorDeNegocio('La base de usuarios compartida no está configurada.')
  const actorRemotoId = exigirEnLinea()
  const marca = ahoraIso()
  const mensaje = `Usuarios: ${mutacion.accion} · ${mutacion.actor.usuario} en ${nombreDeEquipo} · DM Gestión ${version}`.trim()

  for (let intento = 0; intento < INTENTOS_DE_ESCRITURA; intento++) {
    if (intento > 0) await new Promise((listo) => setTimeout(listo, 300 * 2 ** (intento - 1)))
    sinInternetHasta = 0
    const lectura = await leerRemoto()
    if (lectura.tipo === 'sin-internet') throw new ErrorDeNegocio(MENSAJE_SIN_INTERNET_PARA_ADMINISTRAR)
    if (lectura.tipo === 'error-remoto') throw new ErrorDeNegocio(`No se pudo acceder a la base de usuarios: ${lectura.error}`)
    if (lectura.tipo === 'sin-archivo') throw new ErrorDeNegocio('El archivo usuarios.json ya no está en GitHub. Hay que restaurarlo desde el historial del repositorio.')

    const actorRemoto = buscarPorId(lectura.documento, actorRemotoId)
    if (!actorRemoto || !actorRemoto.activo) {
      cerrarSesionDesdeAfuera('Tu usuario fue desactivado desde otra computadora.')
      throw new ErrorDeNegocio('Tu usuario ya no está activo en la base compartida.')
    }
    if (mutacion.exigir === 'super-admin' && actorRemoto.rol !== 'SUPER_ADMIN') {
      throw new ErrorDeNegocio('No tenés permisos para realizar esta acción.')
    }

    const nuevo = await mutacion.aplicar(lectura.documento, actorRemoto, marca)
    const texto = escribirDocumento(nuevo)
    try {
      const sha = await almacen.escribir(texto, lectura.sha, mensaje)
      ultimoDocumento = { documento: nuevo, sha }
      reflejar(nuevo)
      anotarLecturaBuena(ahoraIso())
      cambiarEstado({ modo: 'en-linea', cantidad: nuevo.usuarios.length, ultimaLecturaBuena: ahoraIso(), ultimoError: null })
      return nuevo
    } catch (error) {
      if (error instanceof ErrorDeConflicto) {
        registrar(`[usuarios] Otra computadora escribió usuarios.json en el medio; se reintenta (${intento + 1}).`)
        continue
      }
      if (esFallaDeRed(error)) {
        // La escritura pudo haber llegado igual: se relee y se compara con lo que se quiso escribir.
        const relectura = await almacen.leer().catch(() => null)
        if (relectura && relectura.texto === texto) {
          ultimoDocumento = { documento: nuevo, sha: relectura.sha }
          reflejar(nuevo)
          anotarLecturaBuena(ahoraIso())
      cambiarEstado({ modo: 'en-linea', cantidad: nuevo.usuarios.length, ultimaLecturaBuena: ahoraIso(), ultimoError: null })
          return nuevo
        }
      }
      traducirFallaDeEscritura(error)
    }
  }
  throw new ErrorDeNegocio('Otra computadora modificó la lista de usuarios al mismo tiempo. Revisá la lista y volvé a intentar.')
}

function nombreDeSucursal(sucursalId: number): string {
  const sucursal = obtenerSucursal(sucursalId)
  if (!sucursal) throw new ErrorDeNegocio('La sucursal elegida no existe.')
  return sucursal.nombre
}

function usuarioDelEspejo(remotoId: number): Usuario {
  const fila = buscarFilaPorRemotoId(remotoId)
  if (!fila) throw new Error(`El espejo local no tiene al usuario remoto ${remotoId}.`)
  return aUsuario(fila)
}

function exigirRemotoDeLocal(idLocal: number): number {
  const remotoId = remotoIdDeLocal(db(), idLocal)
  if (remotoId === null) throw new ErrorDeNegocio('Ese usuario no está en la base compartida: sólo existe en esta computadora y ya no se puede administrar.')
  return remotoId
}

/** Si la mutación tocó al propio actor, la sesión y la credencial guardada tienen que reflejarlo. */
function actualizarActor(actor: SesionUsuario, documento: DocumentoUsuarios, remotoId: number): void {
  if (!identidad || identidad.remotoId !== remotoId) return
  const remoto = buscarPorId(documento, remotoId)
  const fila = buscarFilaPorRemotoId(remotoId)
  if (!remoto || !fila) return
  identidad = { ...identidad, claveHash: remoto.claveHash }
  const actualizada: SesionUsuario = { ...sesionDesdeRemoto(remoto, fila), debeCambiarClave: remoto.debeCambiarClave && actor.debeCambiarClave }
  establecerSesion(actualizada)
  emisor?.sesionActualizada(actualizada)
  if (remoto.debeCambiarClave) borrarCredencialDe(remoto.usuario)
  else guardarCredencial(remoto)
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------

export async function cambiarClave(actor: SesionUsuario, claveActual: string, claveNueva: string): Promise<SesionUsuario> {
  const remotoId = exigirEnLinea()
  const claveHash = await hashearClave(claveNueva)
  const documento = await mutarRemoto({
    accion: 'cambiar contraseña',
    actor,
    exigir: 'activo',
    aplicar: async (doc, actorRemoto, marca) => {
      if (!(await verificarClave(claveActual, actorRemoto.claveHash))) throw new ErrorDeNegocio('La contraseña actual no es correcta.')
      return cambiarClaveHash(doc, remotoId, claveHash, false, marca).documento
    },
  })
  const remoto = buscarPorId(documento, remotoId)
  const fila = buscarFilaPorRemotoId(remotoId)
  if (!remoto || !fila) throw new Error('El usuario desapareció de la base compartida al cambiar la contraseña.')
  // Si mientras se guardaba se cerró la sesión (botón «Cerrar sesión», o el temporizador), no se reabre.
  if (!sesion() || identidad?.remotoId !== remotoId) {
    throw new ErrorDeNegocio('La contraseña se cambió, pero la sesión se cerró mientras se guardaba. Volvé a ingresar con la contraseña nueva.')
  }
  identidad = { remotoId, modo: 'en-linea', claveHash: remoto.claveHash }
  const nueva = sesionDesdeRemoto(remoto, fila)
  establecerSesion(nueva)
  guardarCredencial(remoto)
  return nueva
}

export async function crearUsuario(actor: SesionUsuario, datos: { nombre: string; usuario: string; rol: Rol; sucursalId: number }, clave: string): Promise<Usuario> {
  exigirEnLinea()
  const sucursal = nombreDeSucursal(datos.sucursalId)
  const claveHash = await hashearClave(clave)
  let remotoId = 0
  await mutarRemoto({
    accion: `alta de ${datos.usuario}`,
    actor,
    exigir: 'super-admin',
    aplicar: (doc, _actor, marca) => {
      const cambio = agregarUsuario(doc, { nombre: datos.nombre, usuario: datos.usuario, claveHash, rol: datos.rol, sucursal, debeCambiarClave: true }, marca)
      remotoId = cambio.usuario.id
      return cambio.documento
    },
  })
  return usuarioDelEspejo(remotoId)
}

export async function editarUsuario(actor: SesionUsuario, idLocal: number, datos: { nombre: string; usuario: string; rol: Rol; sucursalId: number }): Promise<Usuario> {
  exigirEnLinea()
  const remotoId = exigirRemotoDeLocal(idLocal)
  const sucursal = nombreDeSucursal(datos.sucursalId)
  const documento = await mutarRemoto({
    accion: `edición de ${datos.usuario}`,
    actor,
    exigir: 'super-admin',
    aplicar: (doc, actorRemoto, marca) =>
      editarUsuarioEnDocumento(doc, remotoId, { nombre: datos.nombre, usuario: datos.usuario, rol: datos.rol, sucursal }, actorRemoto.id, marca).documento,
  })
  actualizarActor(actor, documento, remotoId)
  return usuarioDelEspejo(remotoId)
}

export async function cambiarActivo(actor: SesionUsuario, idLocal: number, activo: boolean): Promise<Usuario> {
  exigirEnLinea()
  const remotoId = exigirRemotoDeLocal(idLocal)
  const documento = await mutarRemoto({
    accion: `${activo ? 'activación' : 'desactivación'} del usuario ${remotoId}`,
    actor,
    exigir: 'super-admin',
    aplicar: (doc, actorRemoto, marca) => cambiarActivoEnDocumento(doc, remotoId, activo, actorRemoto.id, marca).documento,
  })
  // Si se desactivó al que tiene la credencial guardada en esta computadora, ya no puede entrar sin internet.
  if (!activo) {
    const remoto = buscarPorId(documento, remotoId)
    if (remoto) borrarCredencialDe(remoto.usuario)
  }
  return usuarioDelEspejo(remotoId)
}

export async function resetearClave(actor: SesionUsuario, idLocal: number, claveTemporal: string): Promise<Usuario> {
  exigirEnLinea()
  const remotoId = exigirRemotoDeLocal(idLocal)
  const claveHash = await hashearClave(claveTemporal)
  // Si el superadministrador resetea su propia contraseña, la eligió él: no hace falta forzar el cambio.
  const esPropia = identidad?.remotoId === remotoId
  const documento = await mutarRemoto({
    accion: `reseteo de contraseña del usuario ${remotoId}`,
    actor,
    exigir: 'super-admin',
    aplicar: (doc, _actor, marca) => cambiarClaveHash(doc, remotoId, claveHash, !esPropia, marca).documento,
  })
  if (esPropia) actualizarActor(actor, documento, remotoId)
  else {
    // Con una contraseña temporal elegida por otro, la credencial guardada de esa persona deja de valer.
    const remoto = buscarPorId(documento, remotoId)
    if (remoto) borrarCredencialDe(remoto.usuario)
  }
  return usuarioDelEspejo(remotoId)
}

/**
 * Guarda la matriz de permisos por rol en `usuarios.json`. Va en el mismo archivo que los usuarios
 * porque tiene que valer para toda la agencia, y por el mismo camino que las demás mutaciones: se
 * relee, se aplica y se escribe con el sha, así dos computadoras no se pisan.
 */
export async function guardarPermisos(actor: SesionUsuario, permisos: MatrizPermisos): Promise<MatrizPermisos> {
  exigirEnLinea()
  const documento = await mutarRemoto({
    accion: 'cambio de permisos por rol',
    actor,
    exigir: 'super-admin',
    aplicar: (doc) => guardarPermisosEnDocumento(doc, permisos),
  })
  return documento.permisos
}

// ---------------------------------------------------------------------------
// Pantalla Usuarios: estado y bootstrap
// ---------------------------------------------------------------------------

export async function estadoDeUsuarios(comprobar: boolean): Promise<EstadoDeUsuarios> {
  if (comprobar && almacen) await comprobarAcceso()
  const acceso = estadoDeAcceso()
  let origen: EstadoDeUsuarios['origen']
  if (!almacen) origen = 'local'
  else if (modoPersistido() !== 'github') origen = 'sin-inicializar'
  else origen = acceso.modo === 'en-linea' ? 'github' : 'copia-local'
  return {
    acceso,
    origen,
    localesParaSubir: origen === 'sin-inicializar' ? usuariosLocalesConClave(db()).map((u) => u.usuario) : [],
  }
}

/**
 * Inicializa usuarios.json con los usuarios de esta computadora. Es una acción explícita del
 * superadministrador y se niega a subir una base que sólo tenga la semilla sin cambiar: eso dejaría
 * a toda la agencia con daniel/cambiar123 como única puerta.
 */
export async function subirLocales(actor: SesionUsuario): Promise<EstadoDeUsuarios> {
  if (!almacen) throw new ErrorDeNegocio('La base de usuarios compartida no está configurada en esta versión del programa.')
  if (modoPersistido() === 'github') throw new ErrorDeNegocio('Esta computadora ya trabaja con la base compartida.')
  const locales = usuariosLocalesConClave(db())
  if (locales.length === 0) throw new ErrorDeNegocio('No hay usuarios locales con contraseña para subir.')
  const soloSemilla = locales.length === 1 && locales[0]!.usuario === 'daniel' && locales[0]!.debeCambiarClave
  if (soloSemilla) {
    throw new ErrorDeNegocio('El único usuario de esta computadora es «daniel» con la contraseña inicial. Cambiala primero (Usuarios → Cambiar mi contraseña) y después subí los usuarios.')
  }
  if (!locales.some((u) => u.rol === 'SUPER_ADMIN' && u.activo)) {
    throw new ErrorDeNegocio('Entre los usuarios de esta computadora no hay ningún superadministrador activo: la base compartida quedaría sin administrador.')
  }

  sinInternetHasta = 0
  const lectura = await leerRemoto()
  if (lectura.tipo === 'sin-internet') throw new ErrorDeNegocio(MENSAJE_SIN_INTERNET_PARA_ADMINISTRAR)
  if (lectura.tipo === 'error-remoto') throw new ErrorDeNegocio(`No se pudo acceder a la base de usuarios: ${lectura.error}`)
  if (lectura.tipo === 'documento') {
    reflejar(lectura.documento)
    cambiarEstado({ modo: 'en-linea' })
    throw new ErrorDeNegocio('La base compartida ya fue inicializada desde otra computadora. Esta computadora acaba de sincronizarse: cerrá sesión y volvé a ingresar con tu usuario de la base compartida.')
  }

  const marca = ahoraIso()
  // Si en esta computadora ya se configuraron permisos (todavía en modo local), suben con los usuarios:
  // sería raro inicializar la base compartida y que la matriz volviera sola a los valores por defecto.
  const documento = agregarExistentes({ ...documentoVacio(), permisos: leerCopiaLocal() }, locales, marca)
  const texto = escribirDocumento(documento)
  const mensaje = `Usuarios: inicialización con ${locales.length} usuario(s) · ${actor.usuario} en ${nombreDeEquipo} · DM Gestión ${version}`.trim()
  try {
    const sha = await almacen.escribir(texto, null, mensaje)
    ultimoDocumento = { documento, sha }
  } catch (error) {
    if (error instanceof ErrorDeConflicto) {
      throw new ErrorDeNegocio('Otra computadora inicializó la base compartida en este mismo momento. Cerrá sesión y volvé a ingresar.')
    }
    traducirFallaDeEscritura(error)
  }
  reflejar(documento)

  // El actor pasa a ser un usuario de la base compartida, con sesión en línea (si todavía está: si cerró
  // sesión mientras se subía, el archivo quedó creado igual y va a ingresar de nuevo contra GitHub).
  const remoto = buscarPorUsuario(documento, actor.usuario)
  const fila = remoto ? buscarFilaPorRemotoId(remoto.id) : null
  if (remoto && fila && sesion()?.id === actor.id) {
    identidad = { remotoId: remoto.id, modo: 'en-linea', claveHash: remoto.claveHash }
    const nueva = sesionDesdeRemoto(remoto, fila)
    establecerSesion(nueva)
    emisor?.sesionActualizada(nueva)
    if (!remoto.debeCambiarClave) guardarCredencial(remoto)
    iniciarRevalidacion(REVALIDAR_EN_LINEA_MS)
  }
  cambiarEstado({ modo: 'en-linea', cantidad: documento.usuarios.length, ultimaLecturaBuena: ahoraIso(), ultimoError: null })
  registrar(`[usuarios] Base compartida inicializada con ${locales.length} usuario(s): ${locales.map((u) => u.usuario).join(', ')}`)
  return estadoDeUsuarios(false)
}

/** Sólo para las pruebas. */
export function identidadActual(): { remotoId: number | null; modo: ModoDeAcceso } | null {
  return identidad ? { remotoId: identidad.remotoId, modo: identidad.modo } : null
}

export function ultimoDocumentoLeido(): DocumentoUsuarios | null {
  return ultimoDocumento?.documento ?? null
}

export function idLocalDelRemoto(remotoId: number): number | null {
  return idLocalPorRemotoId(db(), remotoId)
}
