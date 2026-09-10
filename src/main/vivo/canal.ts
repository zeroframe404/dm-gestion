// El canal en vivo con la base de la agencia (14.0): un WebSocket contra el VPS, abierto de punta a
// punta de la jornada, que reemplaza a los relojes de la sincronización y a los dos long-polls.
//
// Qué cambia respecto de la 13.x. Antes cada computadora preguntaba: la cola subía cada 10 segundos,
// la bajada de seguridad corría cada 5 minutos y dos pedidos quedaban colgados esperando novedades.
// Ahora el servidor AVISA, y avisa señales, no datos: «la grilla cambió» (y esta computadora compara
// versiones y baja lo distinto), «tenés mensajes» (y el cartero los pide como siempre). Los datos
// siguen viajando por los endpoints de siempre; lo que se fue son las esperas.
//
// Y algo más importante que la velocidad: mientras el canal está caído NO SE ESCRIBE. Hasta la 13.x
// se guardaba local y la cola subía al volver, con «el último que llega gana»; eso pisaba trabajo
// ajeno de verdad, y quedaba anotado en el historial para que alguien lo descubriera dos días después.
// Desde la 14.0 la regla es «ver sí, tocar no»: `exigirConexion()` es el único portero, lo llama
// `permisos.ts` y todo lo que escribe pasa por ahí.
//
// EL TOKEN VIAJA EN EL PRIMER FRAME Y NUNCA EN LA URL. La API estándar de WebSocket no deja mandar
// cabeceras en el handshake, y la URL queda escrita en los registros del nginx de la agencia: por eso
// el saludo `hola` lleva el token adentro, que es lo mismo que hace el servidor del otro lado.
//
// POR QUÉ ES UNA CLASE Y NO CUATRO FUNCIONES SUELTAS: el banco de pruebas levanta DOS canales contra
// el simulador —una computadora escribe, la otra tiene que verlo— y necesita armarlos con sus propias
// credenciales, su propio actor y su propio motor, sin Electron alrededor. El resto del programa usa
// el `canal()` de siempre, que es uno solo por proceso.
import { app } from 'electron'
import { claveDeUsuario } from '../../shared/texto'
import type { EstadoDeConexion, SesionUsuario, SituacionDeConexion } from '../../shared/tipos'
import { emitirATodas } from '../servicios/avisos'
import { SinConexion } from '../servicios/errores'
import { esFallaDeRed } from '../servicios/red'
import { credencialesDelPuente, obtenerMotor } from '../servicios/sincronizacion'
import { anotarEvento } from '../sincronizacion/cola'
import type { MotorDeSincronizacion } from '../sincronizacion/motor'
import { generacionConocida, versionesConocidas } from '../sincronizacion/versiones'
import { aplicarFotoDeLaGrilla, reiniciarLaGrilla } from './grilla'
import { olvidarLasLlamadas, recibirConfiguracionIce, recibirEventoDeLlamada } from './llamadas'
import { alLlegarAvisoDeMensajes } from './mensajes'
import { olvidarLosPerfiles, recibirPerfil, recibirPerfiles } from './perfiles'
import { olvidarLaPresencia, recibirPresencia } from './presencia'
import { olvidarLasReacciones, recibirReaccion } from './reacciones'
import {
  LATIDO_MS,
  RUTA_DEL_CANAL,
  type ActorDelCanal,
  type DelCliente,
  type DelServidor,
  type FotoDeLaGrilla,
} from './protocolo'

/** El `readyState` de un socket abierto. Es 1 en todas las implementaciones (WebSocket.OPEN). */
const ABIERTO = 1

/** La primera espera antes de reintentar, que después se va duplicando. */
const ESPERA_INICIAL_MS = 1_000
/** El techo de la espera: un VPS que se está actualizando tarda un rato, y no vale la pena golpearlo. */
const ESPERA_MAXIMA_MS = 30_000
/**
 * Cuántos intentos seguidos fallidos hacen falta para pasar de «reconectando» a «sin conexión». Los
 * dos primeros no se le muestran a nadie como una falla: reiniciar el backend del VPS corta las cinco
 * conexiones y vuelven todas en un segundo, y un banner rojo cada vez que se despliega algo es un
 * banner que la gente aprende a ignorar.
 */
const INTENTOS_HASTA_SIN_CONEXION = 3
/**
 * Cuántos latidos de silencio hacen que la conexión se dé por muerta. Con 2,5 se aguanta perder un
 * latido entero (que pasa con una red mala) y no dos.
 *
 * Hace falta porque un socket puede quedar «abierto» para siempre del lado del cliente cuando el cable
 * se corta en el medio: nadie manda un FIN y el sistema operativo no se entera. La única forma de
 * saberlo es el silencio.
 */
const SILENCIO_QUE_MATA = 2.5

/**
 * Lo que esta clase usa de un WebSocket.
 *
 * Está declarado a mano y no tomado de `lib.dom` porque el proceso principal compila con
 * `tsconfig.node.json` (lib ES2022, sin DOM): el `WebSocket` global de Node 22 —el que trae Electron
 * 43— existe en tiempo de ejecución pero no en los tipos. De paso, esta forma mínima es la que
 * comparten el global de Node y el paquete `ws` del respaldo, y es la que el banco de pruebas puede
 * imitar sin abrir un socket de verdad.
 */
export interface SocketEnVivo {
  readonly readyState: number
  onopen: (() => void) | null
  onmessage: ((evento: { data: unknown }) => void) | null
  onerror: ((evento: { message?: string; error?: unknown }) => void) | null
  onclose: ((evento: { code?: number; reason?: string }) => void) | null
  send(datos: string): void
  close(codigo?: number, motivo?: string): void
}

export interface OpcionesDelCanal {
  /**
   * Con qué servidor se habla. Sin esto se usa `credencialesDelPuente()`, que es la misma regla que
   * usan la grilla y la mensajería (y que en desarrollo no toca nunca el VPS real).
   */
  credenciales?: { urlBase: string; token: string } | null
  /** Quién está sentado en la computadora. También se pasa en `arrancar(quien)`. */
  actor?: SesionUsuario | null
  /** La versión del programa. Afuera de Electron (el banco de pruebas) no hay `app.getVersion()`. */
  version?: string
  /**
   * Qué hacer con cada frame que llega. Sin esto, el reparto de siempre: la grilla a `grilla.ts`, los
   * mensajes al cartero, la presencia y los perfiles a sus buzones. El banco de pruebas lo reemplaza
   * para mirar los frames crudos.
   *
   * Ojo con usarlo para probar: lo REEMPLAZA. Una prueba que quiere ver los frames Y que el canal haga
   * lo suyo va con `espiar`, si no lo único que queda probado es el socket.
   */
  despachar?: (mensaje: DelServidor) => void
  /**
   * Se llama con cada frame ANTES de repartirlo, sin reemplazar nada (14.0). Existe para el banco de
   * pruebas: así una prueba puede afirmar qué llegó por el socket y, además, dejar correr el reparto
   * de verdad —el `case 'grilla'`, el `reconciliar()` de la bienvenida—, que es el renglón que une el
   * canal con el resto del programa y el que ninguna otra prueba toca.
   */
  espiar?: (mensaje: DelServidor) => void
  /**
   * Cómo se abre el socket. Sin esto, el `WebSocket` global. Existe para el banco de pruebas —que
   * puede enchufar un socket de mentira— y como el lugar por donde entraría un respaldo si algún día
   * tocara un Electron sin `WebSocket` global (hoy no hay ninguno: ver `abrirSocket`).
   */
  abrirSocket?: (url: string) => SocketEnVivo
  /** El motor al que se le piden las bajadas. El banco arma el suyo, con su base en memoria. */
  motor?: () => MotorDeSincronizacion
}

/** La URL del canal a partir de la del puente: el mismo servidor, en ws:// o wss:// según corresponda. */
function urlDelCanal(urlBase: string): string {
  return urlBase.replace(/\/+$/, '').replace(/^http/, 'ws') + RUTA_DEL_CANAL
}

/** El actor del canal a partir de la sesión abierta. La identidad entre computadoras es la clave. */
function actorDelCanal(quien: SesionUsuario): ActorDelCanal {
  return {
    clave: claveDeUsuario(quien.usuario),
    nombre: quien.nombre,
    rol: quien.rol,
    sucursal: quien.sucursal.nombre,
  }
}

/** Lo que llegó, si tiene la forma de un frame del servidor. Basura adentro no puede tumbar el canal. */
function leerFrame(crudo: unknown): DelServidor | null {
  if (typeof crudo !== 'string') return null
  let json: unknown
  try {
    json = JSON.parse(crudo)
  } catch {
    return null
  }
  if (!json || typeof json !== 'object') return null
  if (typeof (json as { t?: unknown }).t !== 'string') return null
  return json as DelServidor
}

export class CanalEnVivo {
  private readonly opciones: OpcionesDelCanal
  private socket: SocketEnVivo | null = null
  private quien: SesionUsuario | null = null
  private situacion: SituacionDeConexion = 'sin-conexion'
  private desde = new Date().toISOString()
  private intentos = 0
  /** Cuándo llegó el último frame, sea cual sea: es el único signo de vida que tiene el socket. */
  private ultimoFrameEn = 0
  /** Cada cuánto latir. Lo dice el servidor en el saludo; hasta entonces, el del protocolo. */
  private latidoCadaMs = LATIDO_MS
  private latido: ReturnType<typeof setInterval> | null = null
  private reconexion: ReturnType<typeof setTimeout> | null = null
  /** El último error del socket, para poder distinguir «no hay internet» de «el servidor dijo que no». */
  private ultimoErrorDelSocket: unknown = null
  private readonly oyentes = new Set<(estado: EstadoDeConexion) => void>()
  /** Lo último que se avisó, para no repetir el mismo estado dos veces. */
  private ultimoAvisado: EstadoDeConexion | null = null

  constructor(opciones: OpcionesDelCanal = {}) {
    this.opciones = opciones
    this.quien = opciones.actor ?? null
  }

  /**
   * Abre el canal para la persona que acaba de ingresar. Si ya estaba abierto para ella no hace nada:
   * `alCambiarLaSesion` se dispara también cuando se refrescan los datos del usuario desde GitHub.
   */
  arrancar(quien: SesionUsuario): void {
    if (this.quien && claveDeUsuario(this.quien.usuario) === claveDeUsuario(quien.usuario) && this.socket) {
      this.quien = quien
      return
    }
    this.parar()
    this.quien = quien
    this.intentos = 0
    this.conectar()
  }

  /** Al cerrar sesión y al cerrar el programa. Deja todo apagado y sin relojes colgando. */
  parar(): void {
    this.quien = null
    this.cancelarReconexion()
    this.pararElLatido()
    this.cerrarSocket()
    this.ultimoFrameEn = 0
    this.intentos = 0
    reiniciarLaGrilla()
    olvidarLaPresencia()
    olvidarLosPerfiles()
    olvidarLasReacciones()
    olvidarLasLlamadas()
    this.cambiarA('sin-conexion')
  }

  /** Manda un frame. Devuelve false si no salió: sin socket abierto no hay nada que hacer. */
  enviar(mensaje: DelCliente): boolean {
    if (!this.socket || this.socket.readyState !== ABIERTO) return false
    try {
      this.socket.send(JSON.stringify(mensaje))
      return true
    } catch (error) {
      // Un socket que se cortó justo en el medio: no es un error de la operación que lo llamó.
      console.error('[vivo] No se pudo mandar un frame:', error instanceof Error ? error.message : error)
      return false
    }
  }

  estado(): EstadoDeConexion {
    // Sin puente configurado (la máquina de desarrollo, el banco de pruebas sin simulador) no hay nada
    // a lo que conectarse: se dice `sin-puente`, que la pantalla no muestra como una falla y que
    // `exigirConexion()` deja pasar. Estando conectado ni se pregunta: el puente existe, evidentemente,
    // y `credencialesDelPuente()` lee del disco en cada llamada.
    const hayPuente = this.situacion === 'conectado' || this.credenciales() !== null
    return {
      situacion: hayPuente ? this.situacion : 'sin-puente',
      desde: this.desde,
      intentos: this.intentos,
    }
  }

  /** Avisa cada vez que cambia el estado. Devuelve la función que desengancha. */
  alCambiar(oyente: (estado: EstadoDeConexion) => void): () => void {
    this.oyentes.add(oyente)
    return () => this.oyentes.delete(oyente)
  }

  /**
   * El portero de «ver sí, tocar no»: lanza `SinConexion` si esto no se puede escribir ahora.
   *
   * No alcanza con que el socket diga «abierto»: un cable cortado deja el socket abierto para siempre
   * (nadie manda un FIN), así que además se exige que haya llegado algo hace poco. Es la misma cuenta
   * que usa el latido para dar la conexión por muerta, y por eso el peor caso son los ~50 segundos que
   * tarda el silencio en notarse.
   *
   * Sin puente configurado no exige nada: en desarrollo y en las pruebas no hay servidor, y trabar
   * todo el programa ahí no protege a nadie.
   */
  exigirConexion(): void {
    if (this.estado().situacion === 'sin-puente') return
    const abierto = this.socket?.readyState === ABIERTO
    const fresco = Date.now() - this.ultimoFrameEn <= this.latidoCadaMs * SILENCIO_QUE_MATA
    if (!abierto || !fresco) throw new SinConexion()
  }

  // -------------------------------------------------------------------------
  // La conexión
  // -------------------------------------------------------------------------

  private credenciales(): { urlBase: string; token: string } | null {
    if (this.opciones.credenciales !== undefined) return this.opciones.credenciales
    return credencialesDelPuente()
  }

  private conectar(): void {
    if (!this.quien || this.socket) return
    const credenciales = this.credenciales()
    if (!credenciales) {
      // Puede aparecer más tarde: el superadministrador carga las credenciales con el programa abierto.
      this.cambiarA('sin-puente')
      this.programarReconexion(ESPERA_MAXIMA_MS)
      return
    }

    let socket: SocketEnVivo
    try {
      socket = this.abrirSocket(urlDelCanal(credenciales.urlBase))
    } catch (error) {
      this.ultimoErrorDelSocket = error
      this.alCerrarse()
      return
    }

    this.socket = socket
    this.ultimoErrorDelSocket = null
    socket.onopen = () => this.saludar(credenciales.token)
    socket.onmessage = (evento) => this.recibir(evento.data)
    // El `error` no cierra nada por sí solo: siempre viene un `close` atrás. Se guarda nada más para
    // poder distinguir «se cayó internet» —que no es una falla que valga la pena anotar— de un
    // rechazo del servidor.
    socket.onerror = (evento) => {
      this.ultimoErrorDelSocket = evento.error ?? evento.message ?? null
    }
    socket.onclose = () => this.alCerrarse()
  }

  private abrirSocket(url: string): SocketEnVivo {
    if (this.opciones.abrirSocket) return this.opciones.abrirSocket(url)
    const Constructor = (globalThis as { WebSocket?: new (url: string) => SocketEnVivo }).WebSocket
    if (!Constructor) {
      // Electron 43 corre sobre Node 22, que lo trae, y `index.ts` lo comprueba al arrancar y lo deja
      // anotado en la bitácora (ver `engancharElCanal`). No hay respaldo con el paquete `ws`: hoy `ws`
      // está sólo entre las dependencias de desarrollo (lo usa el simulador del banco de pruebas) y
      // meterlo en lo que se publica sería cargar el instalador para un caso que no existe. Si algún
      // día existiera, se enchufa por `abrirSocket` sin tocar esta clase.
      throw new Error('Esta versión de Electron no tiene WebSocket: el canal en vivo no puede abrirse.')
    }
    return new Constructor(url)
  }

  private saludar(token: string): void {
    if (!this.quien) return
    this.ultimoFrameEn = Date.now()
    this.enviar({
      t: 'hola',
      token,
      actor: actorDelCanal(this.quien),
      app: this.version(),
      // Lo que esta computadora ya tiene. El servidor no lo usa: viaja para que el saludo de vuelta se
      // pueda comparar contra algo y la reconciliación empiece con la primera respuesta.
      versiones: versionesConocidas(),
      generacion: generacionConocida(),
    })
    this.arrancarElLatido()
  }

  private version(): string {
    if (this.opciones.version) return this.opciones.version
    // Afuera de Electron no hay `app`: el banco de pruebas importa esto sin proceso de Electron.
    return (app as typeof app | undefined)?.getVersion?.() ?? '0.0.0'
  }

  private alCerrarse(): void {
    this.pararElLatido()
    this.socket = null
    // Cerramos nosotros (cierre de sesión o del programa): no hay nada que reintentar.
    if (!this.quien) return

    this.intentos += 1
    // Sin internet no se pasa por «reconectando»: no hay nada que reconectar y el banner tiene que
    // decir la verdad desde el primer intento. Un servidor que se está reiniciando, en cambio, se
    // aguanta dos intentos callado.
    const cortoLaRed = esFallaDeRed(this.ultimoErrorDelSocket)
    this.cambiarA(this.intentos >= INTENTOS_HASTA_SIN_CONEXION || cortoLaRed ? 'sin-conexion' : 'reconectando')
    this.programarReconexion()
  }

  /**
   * La espera antes del intento siguiente: arranca en un segundo, se duplica hasta treinta y lleva un
   * poco de azar. El azar no es adorno: cuando el VPS se reinicia se caen las cinco computadoras al
   * mismo tiempo, y sin él las cinco vuelven a golpear en el mismo milisegundo, una y otra vez.
   */
  private programarReconexion(esperaFija?: number): void {
    if (this.reconexion) return
    const escalada = Math.min(ESPERA_INICIAL_MS * 2 ** Math.max(0, this.intentos - 1), ESPERA_MAXIMA_MS)
    const base = esperaFija ?? escalada
    const espera = Math.round(base * (0.8 + Math.random() * 0.4))
    this.reconexion = setTimeout(() => {
      this.reconexion = null
      this.conectar()
    }, espera)
    // Un reintento pendiente no tiene por qué mantener vivo el proceso al cerrar el programa.
    this.reconexion.unref?.()
  }

  private cancelarReconexion(): void {
    if (this.reconexion) clearTimeout(this.reconexion)
    this.reconexion = null
  }

  private cerrarSocket(): void {
    const socket = this.socket
    this.socket = null
    if (!socket) return
    // Primero se desenganchan los oyentes: si no, el `close` que viene después dispararía una
    // reconexión que justamente venimos a evitar.
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    try {
      socket.close()
    } catch {
      // Un socket que ya estaba cerrado. No hay nada que hacer ni nada que anotar.
    }
  }

  // -------------------------------------------------------------------------
  // El latido
  // -------------------------------------------------------------------------

  private arrancarElLatido(): void {
    this.pararElLatido()
    this.latido = setInterval(() => {
      if (Date.now() - this.ultimoFrameEn > this.latidoCadaMs * SILENCIO_QUE_MATA) {
        this.matarPorSilencio()
        return
      }
      this.enviar({ t: 'latido' })
    }, this.latidoCadaMs)
    this.latido.unref?.()
  }

  private pararElLatido(): void {
    if (this.latido) clearInterval(this.latido)
    this.latido = null
  }

  /**
   * Nadie del otro lado hace rato. Se cierra y se reconecta a mano —sin esperar el `close`— porque un
   * socket muerto por un cable cortado puede no avisar nunca: el `close()` se queda esperando el saludo
   * de despedida de alguien que ya no está.
   */
  private matarPorSilencio(): void {
    this.ultimoErrorDelSocket = new Error('El canal en vivo se quedó sin latido: se vuelve a conectar.')
    this.cerrarSocket()
    this.alCerrarse()
  }

  // -------------------------------------------------------------------------
  // Lo que llega
  // -------------------------------------------------------------------------

  private recibir(crudo: unknown): void {
    // Cualquier frame sirve como signo de vida, incluso uno que no entendemos.
    this.ultimoFrameEn = Date.now()
    const mensaje = leerFrame(crudo)
    if (!mensaje) return

    if (mensaje.t === 'bienvenida') {
      this.intentos = 0
      if (typeof mensaje.latidoCadaMs === 'number' && mensaje.latidoCadaMs > 0) {
        this.latidoCadaMs = mensaje.latidoCadaMs
        this.arrancarElLatido()
      }
      this.cambiarA('conectado')
    }

    if (mensaje.t === 'error') {
      // El servidor cierra el socket enseguida; el `close` se encarga de la reconexión. Un token o un
      // actor rechazados no se arreglan reintentando, pero sí se arreglan solos cuando el
      // superadministrador corrige las credenciales, así que se anota y se sigue intentando.
      anotarEvento('conexion', `El canal en vivo fue rechazado (${mensaje.codigo}): ${mensaje.mensaje}`, {
        conError: true,
      })
      return
    }

    this.despachar(mensaje)
  }

  private despachar(mensaje: DelServidor): void {
    if (this.opciones.espiar) {
      try {
        this.opciones.espiar(mensaje)
      } catch (error) {
        console.error('[vivo] El espía de los frames falló:', error instanceof Error ? error.message : error)
      }
    }
    if (this.opciones.despachar) {
      this.opciones.despachar(mensaje)
      return
    }
    switch (mensaje.t) {
      case 'bienvenida':
        recibirPerfiles(mensaje.perfiles)
        recibirPresencia(mensaje.presencia)
        recibirConfiguracionIce(mensaje.ice)
        void this.reconciliar(mensaje)
        break
      case 'grilla':
        void this.aplicarLaGrilla(mensaje)
        break
      case 'mensajes':
        void alLlegarAvisoDeMensajes(this.quien)
        break
      case 'presencia':
        recibirPresencia(mensaje.presentes)
        break
      case 'perfil':
        recibirPerfil(mensaje.perfil)
        break
      case 'reaccion':
        recibirReaccion(mensaje)
        break
      case 'llamada':
        recibirEventoDeLlamada(mensaje.evento)
        break
      case 'latido':
        // Nada que hacer: el signo de vida ya se anotó arriba.
        break
    }
  }

  /**
   * Lo que se hace al conectar (y al reconectar), que es lo que antes hacía el reloj de los cinco
   * minutos: ponerse al día con lo que pasó mientras el canal estuvo caído.
   *
   * El orden es el de siempre: primero se BAJA lo que cambió del otro lado y recién después se SUBE lo
   * que quedó esperando acá. Subir primero mandaría a la base valores calculados sobre una copia local
   * vieja; bajando primero, la escritura que salga va a viajar con el `previo` recién bajado y la base
   * la va a poder rechazar si en el medio la tocó otro (ver `sincronizacion/subida.ts`).
   *
   * Los mensajes van al final porque no compiten con nada: ni la cola ni la grilla los tocan.
   */
  private async reconciliar(foto: FotoDeLaGrilla): Promise<void> {
    await this.aplicarLaGrilla(foto)
    this.motor().apurarSubida()
    await alLlegarAvisoDeMensajes(this.quien)
  }

  /** El motor de esta computadora: el del programa, o el que armó el banco de pruebas. */
  private motor(): MotorDeSincronizacion {
    return this.opciones.motor ? this.opciones.motor() : obtenerMotor()
  }

  private async aplicarLaGrilla(foto: FotoDeLaGrilla): Promise<void> {
    try {
      await aplicarFotoDeLaGrilla(foto, this.motor())
    } catch (error) {
      // Una foto que no se pudo aplicar no puede tumbar el canal: los títulos quedan pendientes y se
      // reintentan solos (ver `grilla.ts`).
      if (!esFallaDeRed(error)) {
        console.error('[vivo] No se pudo aplicar la foto de la grilla:', error instanceof Error ? error.message : error)
      }
    }
  }

  // -------------------------------------------------------------------------
  // El estado
  // -------------------------------------------------------------------------

  private cambiarA(situacion: SituacionDeConexion): void {
    if (this.situacion !== situacion) {
      this.situacion = situacion
      this.desde = new Date().toISOString()
    }
    this.avisar()
  }

  /**
   * Avisa a quien esté escuchando, pero sólo si de verdad cambió algo. Se compara contra lo ÚLTIMO
   * QUE SE AVISÓ y no contra lo anterior a la línea de arriba: los intentos suben antes de decidir la
   * situación, así que de la otra forma un tercer intento fallido —el que enciende el banner rojo— se
   * vería igual que el segundo y no se avisaría nunca.
   */
  private avisar(): void {
    const estado = this.estado()
    const avisado = this.ultimoAvisado
    if (avisado && avisado.situacion === estado.situacion && avisado.intentos === estado.intentos) return
    this.ultimoAvisado = estado
    for (const oyente of this.oyentes) {
      try {
        oyente(estado)
      } catch (error) {
        console.error('[vivo] Un oyente del estado del canal falló:', error instanceof Error ? error.message : error)
      }
    }
    emitirATodas('conexion:estado', estado)
  }
}

let unico: CanalEnVivo | null = null

/** El canal del proceso: uno solo, como una sola es la sesión abierta. */
export function canal(): CanalEnVivo {
  if (!unico) unico = new CanalEnVivo()
  return unico
}

/** Sólo para el banco de pruebas: poner otro canal (o ninguno) en lugar del del proceso. */
export function usarCanal(otro: CanalEnVivo | null): void {
  unico?.parar()
  unico = otro
}
