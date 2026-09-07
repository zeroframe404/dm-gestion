// El motor: sube cada 10 segundos si hay algo en la cola, baja cada 5 minutos, y sabe estar sin internet.
//
// Presupuesto de llamadas a Google (la cuota es de ~60 por minuto):
//   subida  → 1 lectura + 1 escritura + 1 agregado + 1 borrado = 4 como mucho, 6 veces por minuto = 24
//   bajada  → 1 estructura + 1 encabezados + 1 lectura = 3, una vez cada 5 minutos
// Total holgado por debajo de 50.
//
// Hay un tercer temporizador, el CARRIL RÁPIDO: cada 30 segundos baja una sola pestaña, APP TAREAS.
// Cinco minutos son una eternidad para una tarea que alguien acaba de asignar desde otra sucursal —el
// pedido fue justamente que lleguen en el momento—, y una pestaña sola es un pedido chico contra el VPS
// de la agencia, que es donde vive la base desde la v12 y no tiene la cuota de Google. Si el carril
// rápido encuentra algo, avisa al renderer para que la campana y el listado se refresquen sin esperar
// a su propio reloj.
import type { EstadoSincronizacion, SesionUsuario } from '../../shared/tipos'
import type { FuenteHoja } from '../importacion/fuente'
import { esFallaDeRed } from '../servicios/red'
import {
  anotarEvento,
  apurarAgrupadas,
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

export const INTERVALO_SUBIDA_MS = 10_000
export const INTERVALO_BAJADA_MS = 5 * 60_000
/** El carril rápido de las tareas. Medio minuto es lo más parecido a «en el momento» sin ser un chat. */
export const INTERVALO_TAREAS_MS = 30_000

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

export type EstadoConexion = 'sincronizado' | 'pendiente' | 'sin-conexion' | 'apagado' | 'trabajando'

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
  /** Se llama cuando el carril rápido trajo tareas nuevas o cambiadas, para avisar al renderer. */
  alCambiarLasTareas?: () => void
  /**
   * Los archivos adjuntos que todavía no llegaron al servidor (12.6). Se suben después de la cola,
   * en el mismo ciclo de diez segundos; `hayArchivosPendientes` evita leer la base cuando no hay nada.
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
 * próxima bajada completa en aparecer no sirven para lo que se necesitan. Las tareas además tienen su
 * propio carril rápido cada 30 segundos; entran igual acá para el caso en que el rápido no haya podido
 * correr (sin internet un rato, la cola trabada).
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

/**
 * Las pestañas del carril rápido: las tareas y, desde la 12.6, los comentarios y los adjuntos, que
 * son la conversación alrededor de una tarea o un siniestro y merecen la misma inmediatez. Vacío = la
 * base todavía no tiene ninguna de las tres y no hay nada que bajar.
 */
function pestanasDeTareas(contexto: ContextoHoja): string[] {
  return contexto.pestanas
    .filter((p) => p.tipo === 'APP_TAREAS' || p.tipo === 'APP_COMENTARIOS' || p.tipo === 'APP_ADJUNTOS')
    .map((p) => p.titulo)
}

export class MotorDeSincronizacion {
  private opciones: OpcionesMotor
  private temporizadorSubida: NodeJS.Timeout | null = null
  private temporizadorBajada: NodeJS.Timeout | null = null
  private temporizadorTareas: NodeJS.Timeout | null = null
  private contexto: ContextoHoja | null = null
  private contextoLeidoEn = 0
  private trabajando = false
  /**
   * Una importación en curso (12.7). Es un candado distinto de `trabajando` a propósito: mientras la
   * importación corre (minutos, cuando es completa) la subida, el carril rápido y los archivos siguen
   * andando. Hasta la 12.6 todo quedaba congelado, y con cinco computadoras cargando la importación
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
    this.temporizadorSubida = setInterval(() => enSegundoPlano(this.ciclarSubida(), 'subida'), INTERVALO_SUBIDA_MS)
    // Los tres relojes con períodos múltiplos vencían juntos y se saltaban entre sí (el carril rápido
    // no corre si la subida ya está trabajando); corridos unos segundos, cada uno tiene su momento.
    this.temporizadorBajada = setInterval(() => enSegundoPlano(this.ciclarBajada(), 'bajada'), INTERVALO_BAJADA_MS + 7_000)
    this.temporizadorTareas = setInterval(() => enSegundoPlano(this.ciclarTareas(), 'las tareas'), INTERVALO_TAREAS_MS + 3_000)
    // Los temporizadores no tienen que impedir que el proceso termine: la aplicación se cierra cuando
    // el usuario cierra la ventana, no cuando la sincronización lo permite.
    this.temporizadorSubida.unref?.()
    this.temporizadorBajada.unref?.()
    this.temporizadorTareas.unref?.()
    anotarEvento('motor', 'Sincronización encendida.')
    this.avisar()
  }

  apagar(): void {
    if (this.temporizadorSubida) clearInterval(this.temporizadorSubida)
    if (this.temporizadorBajada) clearInterval(this.temporizadorBajada)
    if (this.temporizadorTareas) clearInterval(this.temporizadorTareas)
    this.temporizadorSubida = null
    this.temporizadorBajada = null
    this.temporizadorTareas = null
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
    let situacion: EstadoConexion = 'sincronizado'
    if (!this.encendido) situacion = 'apagado'
    else if (this.trabajando || this.importando) situacion = 'trabajando'
    else if (this.sinConexion) situacion = 'sin-conexion'
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

  /** Vacía la cola. Devuelve cuántas entradas se subieron. */
  async ciclarSubida(): Promise<number> {
    if (this.trabajando || !this.encendido) return 0
    // Lo que se puede intentar AHORA: las que están esperando un reintento no cuentan, si no cada ciclo
    // leía la hoja para no escribir nada.
    const hayFilas = cuantasListasParaSubir() > 0
    const hayArchivos = this.opciones.hayArchivosPendientes?.() ?? false
    if (!hayFilas && !hayArchivos) return 0
    const fuente = this.opciones.crearFuente()
    if (!fuente) return 0
    return this.seguir(this.correrSubida(fuente, hayFilas))
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
          // mismo ciclo, así las otras computadoras no lo ven como «cargado en otra computadora»
          // diez segundos de más.
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
      if (resultado.subidas > 0) {
        guardarMarca('ultima_subida', new Date().toISOString())
        anotarEvento('subida', `Se subieron ${resultado.subidas} cambios${resultado.conflictos ? ` (${resultado.conflictos} conflictos)` : ''}.`, {
          filas: resultado.subidas,
          duracionMs: Date.now() - arranque,
        })
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
   * El carril rápido: baja SÓLO la pestaña de las tareas, cada 30 segundos.
   *
   * No sube nada antes (eso lo hace su propio ciclo cada 10 segundos) y no toca la marca de «última
   * bajada»: no es la bajada de la aplicación, es una pestaña sola. Como cualquier otra bajada saltea
   * las filas con cambios locales sin subir, así una tarea que se está escribiendo acá no se pisa con
   * la versión vieja del servidor.
   */
  async ciclarTareas(): Promise<ResultadoBajada | null> {
    // Con una importación en curso el carril rápido espera: la importación ya trae esas pestañas y
    // las dos escribirían las mismas filas al mismo tiempo.
    if (this.trabajando || this.importando || !this.encendido) return null
    const fuente = this.opciones.crearFuente()
    if (!fuente) return null
    return this.seguir(this.correrBajada(fuente, false, filasConPendientes(), { soloLasTareas: true }))
  }

  private async correrBajada(
    fuente: FuenteHoja,
    completa: boolean,
    bloqueadas: Set<string>,
    opciones: { soloLasTareas?: boolean } = {},
  ): Promise<ResultadoBajada | null> {
    const soloLasTareas = opciones.soloLasTareas === true
    this.trabajando = true
    this.avisar()
    const arranque = Date.now()
    try {
      const contexto = await this.conContexto(fuente, completa)
      const titulos = soloLasTareas
        ? pestanasDeTareas(contexto)
        : completa
          ? contexto.pestanas.map((p) => p.titulo)
          : (this.opciones.pestanasDelCiclo ?? pestanasDeTodosLosDias)(contexto)
      // Todavía no hay pestaña de tareas en la base: no hay nada que bajar y tampoco nada que anotar.
      if (soloLasTareas && titulos.length === 0) return null
      const resultado = await bajarCambios(fuente, contexto, titulos, bloqueadas)
      this.sinConexion = false
      this.ultimoError = null
      if (soloLasTareas) {
        if (resultado.filasCambiadas > 0 || resultado.filasNuevas > 0 || resultado.filasQueYaNoEstan > 0) {
          this.opciones.alCambiarLasTareas?.()
        }
        // Filas escritas a mano en la pestaña (sin _ID) piden la importación completa, y ésa no se
        // dispara desde acá: correrla cada medio minuto sería peor que esperar. La bajada de los cinco
        // minutos también mira APP TAREAS y es la que la corre.
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
      if (resultado.filasCambiadas > 0 || resultado.filasNuevas > 0 || resultado.filasQueYaNoEstan > 0 || completa) {
        anotarEvento(
          'bajada',
          `${resultado.filasCambiadas} filas cambiadas, ${resultado.filasNuevas} nuevas, ${resultado.filasQueYaNoEstan} que ya no están` +
            `${resultado.pisados ? ` · ${resultado.pisados} valores locales pisados` : ''}.`,
          { filas: resultado.filasCambiadas, duracionMs: Date.now() - arranque },
        )
      }
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
    // Las bajas que estaban esperando para viajar juntas salen ahora: acá hay alguien mirando el botón.
    apurarAgrupadas()
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
