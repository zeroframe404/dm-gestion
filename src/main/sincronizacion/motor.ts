// El motor: vacía la cola contra la base de la agencia, baja lo que el canal en vivo le diga que
// cambió, y sabe estar sin internet.
//
// SIN RELOJES (14.0). Hasta la 13.x el motor tenía tres `setInterval`: la subida cada 10 segundos, la
// bajada de seguridad cada 5 minutos y el carril rápido de las tareas cada 30. Los tres se fueron.
//
//   · La subida sale por evento: `encolar` despierta al motor (ver `usarDespertadorDeLaCola` en
//     cola.ts) y `apurarSubida()` sube con 100 ms de respiro. Escribir una celda y verla en la otra
//     computadora pasó de «hasta diez segundos» a «lo que tarda el viaje».
//   · La bajada la pide el canal: el servidor avisa qué cambió y `vivo/grilla.ts` llama a
//     `ciclarBajadaDe` con esos títulos. La red de seguridad de los cinco minutos ya no hace falta
//     porque el canal reconcilia al conectar y al reconectar (ver `canal.reconciliar`).
//   · El carril rápido de las tareas era redundante desde la 13.1 (el aviso en vivo traía las tareas
//     igual de rápido y encima traía todo lo demás): se fue con los otros dos.
//
// Lo que queda de aquel presupuesto de llamadas a Google —«la bajada no mira todas las pestañas»—
// sigue vigente por otro motivo: bajar la hoja entera son varios MB y no hay ninguna razón para
// pedirlos cuando el servidor ya dijo qué pestaña cambió.
import type { EstadoSincronizacion, SesionUsuario, SituacionDeConexion, TipoPestana } from '../../shared/tipos'
import type { FuenteHoja } from '../importacion/fuente'
import { esFallaDeRed } from '../servicios/red'
import {
  anotarEvento,
  cuantasFallidas,
  cuantasListasParaSubir,
  cuantasPendientes,
  filasConPendientes,
  guardarMarca,
  leerMarca,
  limpiarImposibles,
  limpiarViejas,
  pestanasPendientes,
} from './cola'
import { bajarCambios, type ResultadoBajada } from './bajada'
import { leerContexto, type ContextoHoja } from './hoja'
import { asegurarPestanasDeLaApp, asegurarPestanasDelMes } from './pestanasApp'
import { subirTanda } from './subida'

/**
 * El respiro de `apurarSubida` (14.0). Guardar una ficha encola varias filas seguidas —el cliente, el
 * vehículo, la póliza— y sin este respiro cada una saldría en su propio pedido. Con 100 ms se juntan
 * en una tanda sola y nadie nota la diferencia.
 */
const RESPIRO_DE_LA_SUBIDA_MS = 100

/**
 * Cuántas vueltas seguidas puede dar la subida apurada. Cada vuelta sube lo que hay y vuelve a mirar
 * si entró algo mientras tanto; el tope es para que un mostrador que escribe sin parar no deje al
 * motor girando para siempre sin ceder el turno. Lo que quede espera al próximo `encolar`, que llega
 * enseguida por definición.
 */
const VUELTAS_SEGUIDAS_MAXIMAS = 5

/**
 * Arranca un ciclo del temporizador sin dejar la promesa suelta. Antes acá había un `void`: si el
 * ciclo fallaba —sin internet, la hoja movida de lugar, la base cerrada— la promesa quedaba rechazada
 * sin nadie que la atendiera, y eso en el proceso principal de Electron es un `unhandledRejection`.
 * Un ciclo que sale mal tiene que quedar anotado y esperar al siguiente, no tumbar nada.
 *
 * Se anota por consola y NO en la base: si justo lo que falló fue la base, anotar ahí volvería a
 * explotar, esta vez adentro del `catch`.
 */
function enSegundoPlano(ciclo: Promise<unknown>, cual: string): void {
  void ciclo.catch((error: unknown) => {
    console.error(`[motor] El ciclo de ${cual} falló; se reintenta en el próximo:`, error)
  })
}
/** La estructura de la hoja casi nunca cambia: se relee cada tanto, no en cada ciclo. */
const VIDA_DEL_CONTEXTO_MS = 5 * 60_000

export type EstadoConexion = 'sincronizado' | 'pendiente' | 'reconectando' | 'sin-conexion' | 'apagado' | 'trabajando'

/** Una pestaña que trajo datos nuevos. El título es de la hoja; el tipo es lo que entiende la pantalla. */
export interface PestanaQueCambio {
  titulo: string
  tipo: TipoPestana
}

export interface OpcionesMotor {
  /** Devuelve la fuente configurada, o null si todavía no hay conexión con Google configurada. */
  crearFuente: () => FuenteHoja | null
  /**
   * Corre la importación que incorpora filas nuevas. Con `pestanas` (12.7) se acota a ésas: la bajada
   * dice en cuáles aparecieron; sin lista, importa todo (el botón de Administración).
   */
  importar: (pestanas?: string[]) => Promise<void>
  /** Se llama cada vez que cambia el estado, para refrescar el indicador de la barra superior. */
  alCambiarEstado?: (estado: EstadoSincronizacion) => void
  /** Qué pestañas se miran en el ciclo automático; el resto sólo en la bajada completa. */
  pestanasDelCiclo?: (contexto: ContextoHoja) => string[]
  /** Se llama cuando se bajaron tareas nuevas o cambiadas, para avisar al renderer. */
  alCambiarLasTareas?: () => void
  /**
   * Se llama cuando una bajada trajo datos de otra computadora, con las pestañas que cambiaron. Es lo
   * que hace que la pantalla abierta se refresque sola en vez de seguir mostrando lo viejo hasta que
   * el usuario navegue a otro lado.
   */
  alCambiarLosDatos?: (pestanas: PestanaQueCambio[]) => void
  /**
   * En qué anda el canal en vivo (14.0). De acá sale el «sin conexión» del indicador de la barra: hasta
   * la 13.x se deducía de que la última llamada hubiera fallado por red, y eso llegaba tarde (sólo se
   * enteraba cuando había algo para subir) y se iba tarde (hasta la llamada siguiente). El canal lo
   * sabe en el momento, porque es el que tiene el socket.
   *
   * Sin esto puesto —un motor armado a mano en el banco de pruebas— se sigue mirando lo de siempre.
   */
  situacionDelCanal?: () => SituacionDeConexion
  /**
   * Los archivos adjuntos que todavía no llegaron al servidor (12.6). Se suben después de la cola, en
   * el mismo ciclo de subida; `hayArchivosPendientes` evita leer la base cuando no hay nada.
   */
  subirArchivos?: () => Promise<{ subidos: number; fallidos: number }>
  hayArchivosPendientes?: () => boolean
}

/**
 * Por defecto el ciclo mira lo que se usa todos los días: el mes abierto, sus bajas y los riesgos.
 *
 * «APP RECHAZOS» y «APP TAREAS» también entran, y son las dos únicas pestañas de la aplicación que lo
 * hacen: por una le llega a una sucursal el aviso de que a un cliente suyo le rebotó el débito, y por
 * la otra las tareas que le asignaron desde otro mostrador. Un aviso o una tarea que tardan hasta la
 * próxima bajada completa en aparecer no sirven para lo que se necesitan. Desde la 14.0 casi todo
 * llega antes por el canal, que dice exactamente qué pestaña cambió; esta lista es la que se mira
 * cuando alguien pide una sincronización a mano.
 */
function pestanasDeTodosLosDias(contexto: ContextoHoja): string[] {
  const mensuales = contexto.pestanas.filter((p) => p.tipo === 'MENSUAL' && p.periodo).sort((a, b) => (b.periodo ?? '').localeCompare(a.periodo ?? ''))
  const masNueva = mensuales[0]
  const titulos = new Set<string>()
  if (masNueva) {
    titulos.add(masNueva.titulo)
    for (const p of contexto.pestanas) {
      if (p.tipo === 'BAJAS' && p.periodo === masNueva.periodo) titulos.add(p.titulo)
    }
  }
  for (const p of contexto.pestanas) {
    if (
      p.tipo === 'RIESGOS_VARIOS' ||
      p.tipo === 'PAGOS' ||
      p.tipo === 'SINIESTROS' ||
      p.tipo === 'APP_RECHAZOS' ||
      p.tipo === 'APP_TAREAS' ||
      p.tipo === 'APP_ADJUNTOS' ||
      p.tipo === 'APP_COMENTARIOS' ||
      // 12.7: las consultas, los presupuestos, las ampliaciones y las reglas de cobertura también se
      // cargan desde cualquier mostrador; hasta la 12.6 sólo entraban con «Forzar bajada completa».
      p.tipo === 'APP_LEADS' ||
      p.tipo === 'APP_PRESUPUESTOS' ||
      // 12.10: la caja chica del mostrador. Dos personas atienden la misma caja desde dos
      // computadoras: el gasto que carga una tiene que estar en el arqueo que cierra la otra, y no
      // en la bajada completa de la noche.
      p.tipo === 'APP_CAJA' ||
      p.tipo === 'AMP' ||
      p.tipo === 'COBERTURA'
    ) {
      titulos.add(p.titulo)
    }
  }
  return [...titulos]
}

export class MotorDeSincronizacion {
  private opciones: OpcionesMotor
  /** El respiro de `apurarSubida`: uno solo a la vez, y lo que llegue mientras tanto se le suma. */
  private apuro: NodeJS.Timeout | null = null
  /** Entró algo en la cola mientras la subida estaba corriendo: hay que dar otra vuelta al terminar. */
  private hayMas = false
  /** Pestañas donde la base rechazó una escritura: se bajan apenas la subida suelta el turno (14.0). */
  private readonly pisadas = new Set<string>()
  private contexto: ContextoHoja | null = null
  private contextoLeidoEn = 0
  private trabajando = false
  /**
   * Una importación en curso (12.7). Es un candado distinto de `trabajando` a propósito: mientras la
   * importación corre (minutos, cuando es completa) la subida y los archivos siguen andando. Hasta la 12.6 todo quedaba congelado, y con cinco computadoras cargando la importación
   * corría casi todo el tiempo: nada subía y los adjuntos no llegaban.
   */
  private importando = false
  /** Lo que está corriendo ahora, para que «Sincronizar ahora» espere su turno en vez de no hacer nada. */
  private enCurso: Promise<unknown> | null = null
  private ultimoError: string | null = null
  private sinConexion = false
  private encendido = false

  constructor(opciones: OpcionesMotor) {
    this.opciones = opciones
  }

  encender(): void {
    if (this.encendido) return
    this.encendido = true
    // Las versiones anteriores dejaban entradas que no se podían subir nunca (ver `limpiarImposibles`):
    // se barren al encender, si no la cola queda con «no se pudo» para siempre.
    const barridas = limpiarImposibles()
    if (barridas > 0) anotarEvento('motor', `Se limpiaron ${barridas} entradas de la cola que no se podían subir nunca.`)
    // 14.0: acá se armaban los tres temporizadores. Ya no hay ninguno; encender es nada más dejar el
    // motor disponible y barrer lo que quedó imposible de versiones anteriores.
    anotarEvento('motor', 'Sincronización encendida.')
    this.avisar()
  }

  apagar(): void {
    if (this.apuro) clearTimeout(this.apuro)
    this.apuro = null
    this.hayMas = false
    this.encendido = false
    this.contexto = null
    this.avisar()
  }

  estaEncendido(): boolean {
    return this.encendido
  }

  /** Estado para el indicador de la barra superior y para la pantalla de Sincronización. */
  estado(): EstadoSincronizacion {
    const pendientes = cuantasPendientes()
    const fallidas = cuantasFallidas()
    // 14.0: quien sabe si hay internet es el canal, no la última llamada que falló. `sin-puente` (la
    // máquina de desarrollo, el banco de pruebas) no es una falla: ahí no hay a qué conectarse.
    const canal = this.opciones.situacionDelCanal?.() ?? null
    const sinConexion = canal === null ? this.sinConexion : canal === 'sin-conexion'
    let situacion: EstadoConexion = 'sincronizado'
    if (!this.encendido) situacion = 'apagado'
    // El corte manda sobre todo lo demás: mientras no vuelva, lo que se está haciendo no va a poder
    // terminar, y el indicador tiene que decir lo que le pasa a la persona («no se puede guardar»).
    else if (sinConexion) situacion = 'sin-conexion'
    else if (this.trabajando || this.importando) situacion = 'trabajando'
    else if (canal === 'reconectando') situacion = 'reconectando'
    else if (pendientes > 0 || fallidas > 0) situacion = 'pendiente'
    return {
      situacion,
      pendientes,
      fallidas,
      ultimaBajada: leerMarca('ultima_bajada'),
      ultimaSubida: leerMarca('ultima_subida'),
      ultimoError: this.ultimoError,
      configurada: this.opciones.crearFuente() !== null,
    }
  }

  private avisar(): void {
    this.opciones.alCambiarEstado?.(this.estado())
  }

  private async conContexto(fuente: FuenteHoja, forzar = false): Promise<ContextoHoja> {
    if (!forzar && this.contexto && Date.now() - this.contextoLeidoEn < VIDA_DEL_CONTEXTO_MS) return this.contexto
    this.contexto = await leerContexto(fuente)
    this.contextoLeidoEn = Date.now()
    return this.contexto
  }

  /** Deja anotado el trabajo en curso (para `esperarTurno`) y lo devuelve tal cual. */
  private seguir<T>(trabajo: Promise<T>): Promise<T> {
    const espera = trabajo.then(
      () => undefined,
      () => undefined,
    )
    this.enCurso = espera
    void espera.then(() => {
      if (this.enCurso === espera) this.enCurso = null
    })
    return trabajo
  }

  /** Espera a que termine lo que esté corriendo. Con tope, para que el botón no quede colgado. */
  private async esperarTurno(): Promise<void> {
    for (let vueltas = 0; this.enCurso && vueltas < 5; vueltas++) await this.enCurso
  }

  /**
   * Sube lo que espera en la cola, con 100 ms de respiro (14.0). Es lo que reemplazó al reloj de los
   * diez segundos: lo llama `encolar` a través del despertador de la cola, y el canal al reconciliar.
   *
   * No devuelve nada y no se espera: quien escribe una celda no tiene que quedarse esperando a que el
   * servidor conteste. Lo que salga mal queda anotado en la cola y en la bitácora, como siempre.
   */
  apurarSubida(): void {
    if (this.apuro) return
    this.apuro = setTimeout(() => {
      this.apuro = null
      enSegundoPlano(this.subirLoQueEspera(), 'la subida apurada')
    }, RESPIRO_DE_LA_SUBIDA_MS)
    // El respiro no tiene por qué mantener vivo el proceso al cerrar el programa.
    this.apuro.unref?.()
  }

  /**
   * Una vuelta de subida, y otra si mientras subía entró algo más.
   *
   * El motor puede estar en el medio de una bajada o de una importación cuando vence el respiro: en
   * ese caso se espera el turno en vez de perder el aviso, porque no va a haber otro —la cola avisa
   * cuando algo entra, no cada tanto—.
   */
  private async subirLoQueEspera(): Promise<void> {
    for (let vueltas = 0; vueltas < VUELTAS_SEGUIDAS_MAXIMAS; vueltas++) {
      this.hayMas = false
      await this.esperarTurno()
      await this.ciclarSubida()
      if (!this.hayMas) return
    }
  }

  /** Vacía la cola. Devuelve cuántas entradas se subieron. */
  async ciclarSubida(): Promise<number> {
    if (this.trabajando || !this.encendido) {
      // Ocupado: lo que espera no se pierde, se sube en la vuelta siguiente de `subirLoQueEspera`.
      if (this.trabajando) this.hayMas = true
      return 0
    }
    // Lo que se puede intentar AHORA: las que están esperando un reintento no cuentan, si no cada ciclo
    // leía la hoja para no escribir nada.
    const hayFilas = cuantasListasParaSubir() > 0
    const hayArchivos = this.opciones.hayArchivosPendientes?.() ?? false
    if (!hayFilas && !hayArchivos) return 0
    const fuente = this.opciones.crearFuente()
    if (!fuente) return 0
    const subidas = await this.seguir(this.correrSubida(fuente, hayFilas))
    // Recién acá, con `trabajando` ya en false, se pueden bajar las pestañas que la base rechazó: si
    // se pidiera adentro de la subida, `ciclarBajadaDe` se encontraría al motor ocupado consigo mismo
    // y contestaría null.
    await this.bajarLoQuePisoLaBase()
    return subidas
  }

  /**
   * Las pestañas donde la base rechazó una escritura de esta computadora (14.0): se bajan YA, para que
   * la pantalla muestre el valor que ganó en el mismo momento en que aparece el aviso de que el cambio
   * de acá no se guardó. Sin esto, la persona ve el cartel y en la pantalla sigue su propio número.
   *
   * El conjunto se vacía ANTES de bajar: la bajada arrastra una subida, y si esa subida vuelve a
   * rechazar algo tiene que poder anotar sus propias pestañas sin que ésta se las lleve por delante.
   */
  private async bajarLoQuePisoLaBase(): Promise<void> {
    if (this.pisadas.size === 0) return
    const titulos = [...this.pisadas]
    this.pisadas.clear()
    await this.ciclarBajadaDe(titulos)
  }

  private async correrSubida(fuente: FuenteHoja, hayFilas = true): Promise<number> {
    this.trabajando = true
    this.avisar()
    const arranque = Date.now()
    try {
      let subidas = hayFilas ? await this.subirLaCola(fuente, arranque) : 0
      // Los archivos van después de las filas: la ficha del adjunto ya está en la base cuando el
      // archivo llega al servidor, y si el servidor no está, la cola ya lo dijo.
      if (this.opciones.subirArchivos) {
        const archivos = await this.opciones.subirArchivos()
        if (archivos.subidos > 0) {
          anotarEvento('subida', `Se subieron ${archivos.subidos} archivos adjuntos al servidor.`, { filas: archivos.subidos })
          // 12.7: cada archivo que llegó dejó en la cola el «SUBIDO» de su fila. Sale ahora, en el
          // mismo ciclo, así las otras computadoras no lo ven como «cargado en otra computadora» un
          // rato de más.
          if (cuantasListasParaSubir() > 0) subidas += await this.subirLaCola(fuente, arranque)
        }
      }
      return subidas
    } catch (error) {
      this.registrarFalla(error, 'subida')
      return 0
    } finally {
      this.trabajando = false
      this.avisar()
    }
  }

  private async subirLaCola(fuente: FuenteHoja, arranque: number): Promise<number> {
    {
      let contexto = await this.conContexto(fuente)
      // Si lo que espera es para una pestaña que todavía no está en la base —una de la aplicación
      // (leads, presupuestos, tareas) o la del mes nuevo que dejó «Cerrar mes»— se crea ahora al
      // final y se relee la estructura: recién con la pestaña y sus encabezados leídos la subida
      // sabe qué columna es cada campo.
      const pendientesDeSubir = pestanasPendientes()
      const creadas = [
        ...(await asegurarPestanasDeLaApp(fuente, contexto, pendientesDeSubir)),
        ...(await asegurarPestanasDelMes(fuente, contexto, pendientesDeSubir)),
      ]
      if (creadas.length > 0) contexto = await this.conContexto(fuente, true)
      const resultado = await subirTanda(fuente, contexto)
      if (resultado.error) throw new Error(resultado.error)
      this.sinConexion = false
      this.ultimoError = null
      for (const titulo of resultado.pestanasPisadas) this.pisadas.add(titulo)
      if (resultado.subidas > 0 || resultado.pisadas > 0) {
        guardarMarca('ultima_subida', new Date().toISOString())
        anotarEvento(
          'subida',
          `Se subieron ${resultado.subidas} cambios${resultado.pisadas ? ` (${resultado.pisadas} celdas no se escribieron: la base ya decía otra cosa)` : ''}.`,
          { filas: resultado.subidas, duracionMs: Date.now() - arranque },
        )
      }
      return resultado.subidas
    }
  }

  /** Trae de la hoja lo que cambió. Con `completa` mira todas las pestañas. */
  async ciclarBajada(completa = false): Promise<ResultadoBajada | null> {
    if (this.trabajando || this.importando || !this.encendido) return null
    const fuente = this.opciones.crearFuente()
    if (!fuente) return null

    // Primero se sube lo que falta: bajar con cambios locales sin subir sería pisarlos.
    if (cuantasListasParaSubir() > 0) await this.ciclarSubida()
    if (this.trabajando) return null
    // Lo que aun así no llegó a subir ya no frena la bajada entera: se saltean nada más esas filas. Antes
    // se cortaba acá, y una sola entrada trabada dejaba a toda la aplicación sin actualizarse —la hoja
    // cambiaba, la pantalla no— hasta que alguien la destrabara a mano.
    const bloqueadas = filasConPendientes()

    return this.seguir(this.correrBajada(fuente, completa, bloqueadas))
  }

  /**
   * El canal en vivo avisó que estas pestañas cambiaron: se bajan sólo ésas, ya.
   *
   * Es el camino por el que llega lo que escribió otra sucursal. Hace lo mismo que `ciclarBajada`
   * —sube primero lo pendiente, porque bajar con cambios locales sin subir los pisaría— pero en vez de
   * mirar las pestañas del día mira exactamente las que cambiaron.
   *
   * Devuelve `null` si no se pudo bajar ahora (el motor estaba trabajando o importando). Quien llamó
   * se queda con los títulos y los vuelve a intentar (ver `vivo/grilla.ts`): darlos por bajados sin
   * haberlos bajado perdería el cambio hasta que alguien vuelva a escribir, que puede ser mañana.
   */
  async ciclarBajadaDe(titulos: string[]): Promise<ResultadoBajada | null> {
    if (titulos.length === 0) return null
    if (this.trabajando || this.importando || !this.encendido) return null
    const fuente = this.opciones.crearFuente()
    if (!fuente) return null

    if (cuantasListasParaSubir() > 0) await this.ciclarSubida()
    if (this.trabajando) return null

    return this.seguir(this.correrBajada(fuente, false, filasConPendientes(), { soloEstasPestanas: titulos }))
  }

  /**
   * Le avisa al renderer que estas pestañas trajeron datos de otra computadora, para que la pantalla
   * abierta se refresque sola. Manda el título Y el tipo: la pantalla no sabe de «AGOSTO 2026», sabe
   * de MENSUAL.
   *
   * El aviso de tareas sigue saliendo aparte —lo escuchan la campana y el contador de la barra, que
   * son anteriores a esto— y sale venga la bajada del carril que venga.
   */
  private avisarQueCambiaronLosDatos(contexto: ContextoHoja, titulos: string[]): void {
    const pestanas: PestanaQueCambio[] = []
    for (const titulo of titulos) {
      const pestana = contexto.porTitulo.get(titulo)
      if (pestana) pestanas.push({ titulo, tipo: pestana.tipo })
    }
    if (pestanas.length === 0) return
    if (pestanas.some((p) => p.tipo === 'APP_TAREAS' || p.tipo === 'APP_COMENTARIOS' || p.tipo === 'APP_ADJUNTOS')) {
      this.opciones.alCambiarLasTareas?.()
    }
    this.opciones.alCambiarLosDatos?.(pestanas)
  }

  /** La importación acotada a las pestañas donde aparecieron filas nuevas, con su propio candado. */
  private async importarAcotada(pestanas: string[] | undefined, filasNuevas: number): Promise<void> {
    anotarEvento(
      'bajada',
      `Aparecieron ${filasNuevas} filas nuevas en la base: se importan ${pestanas && pestanas.length > 0 ? `las pestañas ${pestanas.map((p) => `«${p}»`).join(', ')}` : 'todas las pestañas'} para incorporarlas.`,
    )
    this.trabajando = false
    this.importando = true
    this.avisar()
    try {
      await this.opciones.importar(pestanas)
    } finally {
      this.importando = false
      this.trabajando = true
    }
  }

  private async correrBajada(
    fuente: FuenteHoja,
    completa: boolean,
    bloqueadas: Set<string>,
    opciones: { soloEstasPestanas?: string[] } = {},
  ): Promise<ResultadoBajada | null> {
    // La bajada acotada del canal: las pestañas que el servidor dijo que cambiaron.
    const acotada = opciones.soloEstasPestanas
    this.trabajando = true
    this.avisar()
    const arranque = Date.now()
    try {
      let contexto = await this.conContexto(fuente, completa)
      // Una pestaña que el servidor nombró y que acá no figura es una recién creada del otro lado: el
      // cierre de mes de otra sucursal. La estructura se cachea cinco minutos, así que sin releerla
      // ahora el mes nuevo no aparecería hasta que el caché venza —justo el caso en que la sucursal
      // está esperando ver el mes abierto—.
      if (acotada && acotada.some((titulo) => !contexto.porTitulo.has(titulo))) {
        contexto = await this.conContexto(fuente, true)
      }
      const titulos = acotada
        ? // Lo que sigue sin figurar ya no está en la hoja: se borró entre el aviso y la bajada.
          acotada.filter((titulo) => contexto.porTitulo.has(titulo))
        : completa
          ? contexto.pestanas.map((p) => p.titulo)
          : (this.opciones.pestanasDelCiclo ?? pestanasDeTodosLosDias)(contexto)
      // Las pestañas que nombró el canal ya no están en la base: no hay nada que bajar ni que anotar.
      if (acotada && titulos.length === 0) return null
      const resultado = await bajarCambios(fuente, contexto, titulos, bloqueadas)
      this.sinConexion = false
      this.ultimoError = null
      const trajoAlgo =
        resultado.filasCambiadas > 0 || resultado.filasNuevas > 0 || resultado.filasQueYaNoEstan > 0
      if (acotada) {
        // Acá la importación SÍ corre. El canal no avisa «cada tanto» sino cuando de verdad cambió
        // algo, así que no hay riesgo de estarla disparando todo el tiempo; y sin ella una póliza
        // cargada en una sucursal no aparecería en las otras hasta que alguien reimportara a mano.
        // Corre acotada a las pestañas donde aparecieron filas, con su propio candado.
        if (resultado.necesitaImportacion) await this.importarAcotada(resultado.pestanasConFilasNuevas, resultado.filasNuevas)
        // La marca de última bajada también se corre acá (13.0.2): esto SÍ es una bajada de la hoja
        // —trae las pestañas que cambiaron, con importación incluida— y es la que trae casi todo. Sin
        // esto el podio de Inicio decía «datos bajados a las 10» a las 12, con las altas de la otra
        // sucursal ya adentro, y la barra seguía diciendo «sincronizado hace dos horas».
        guardarMarca('ultima_bajada', new Date().toISOString())
        if (trajoAlgo) this.avisarQueCambiaronLosDatos(contexto, titulos)
        return resultado
      }
      guardarMarca('ultima_bajada', new Date().toISOString())

      if (resultado.necesitaImportacion) {
        // La importación se acota a las pestañas donde aparecieron filas (12.7) y corre con su propio
        // candado: la subida y los archivos siguen mientras tanto. Una bajada completa (el botón) sigue
        // importando todo, que es lo que quien lo aprieta espera.
        const pestanas = completa ? undefined : resultado.pestanasConFilasNuevas
        anotarEvento(
          'bajada',
          `Aparecieron ${resultado.filasNuevas} filas nuevas en la base: se importan ${pestanas && pestanas.length > 0 ? `las pestañas ${pestanas.map((p) => `«${p}»`).join(', ')}` : 'todas las pestañas'} para incorporarlas.`,
        )
        this.trabajando = false
        this.importando = true
        this.avisar()
        try {
          await this.opciones.importar(pestanas)
        } finally {
          this.importando = false
        }
      }
      if (trajoAlgo || completa) {
        anotarEvento(
          'bajada',
          `${resultado.filasCambiadas} filas cambiadas, ${resultado.filasNuevas} nuevas, ${resultado.filasQueYaNoEstan} que ya no están` +
            `${resultado.pisados ? ` · ${resultado.pisados} valores locales pisados` : ''}.`,
          { filas: resultado.filasCambiadas, duracionMs: Date.now() - arranque },
        )
      }
      if (trajoAlgo) this.avisarQueCambiaronLosDatos(contexto, titulos)
      limpiarViejas()
      return resultado
    } catch (error) {
      this.registrarFalla(error, 'bajada')
      return null
    } finally {
      this.trabajando = false
      this.avisar()
    }
  }

  /** El botón «Sincronizar ahora»: sube lo pendiente y baja lo que haya. */
  async sincronizarAhora(completa = false): Promise<ResultadoBajada | null> {
    // Si el ciclo automático justo estaba corriendo, el botón no hacía nada: mostraba «Sincronizando…»
    // por un instante y volvía a lo mismo. Ahora espera a que termine y recién ahí trabaja.
    await this.esperarTurno()
    // 14.0: acá se apuraban las bajas que estaban esperando su ventana de agrupado. Ya no espera
    // ninguna (ver `encolar`), así que no hay nada que apurar.
    await this.ciclarSubida()
    return this.ciclarBajada(completa)
  }

  private registrarFalla(error: unknown, momento: string): void {
    const mensaje = error instanceof Error ? error.message : String(error)
    if (esFallaDeRed(error)) {
      if (!this.sinConexion) anotarEvento('conexion', 'Sin conexión: se sigue trabajando local y la cola espera.', { conError: true })
      this.sinConexion = true
      this.ultimoError = null
    } else {
      this.sinConexion = false
      this.ultimoError = mensaje
      anotarEvento('error', `Falló la ${momento}: ${mensaje}`, { conError: true })
    }
  }
}

/** Usuario que hizo el cambio, sólo para la bitácora. */
export type ActorSync = SesionUsuario | null
