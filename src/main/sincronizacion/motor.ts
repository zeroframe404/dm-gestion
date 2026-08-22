// El motor: sube cada 10 segundos si hay algo en la cola, baja cada 5 minutos, y sabe estar sin internet.
//
// Presupuesto de llamadas a Google (la cuota es de ~60 por minuto):
//   subida  → 1 lectura + 1 escritura + 1 agregado + 1 borrado = 4 como mucho, 6 veces por minuto = 24
//   bajada  → 1 estructura + 1 encabezados + 1 lectura = 3, una vez cada 5 minutos
// Total holgado por debajo de 50.
import type { EstadoSincronizacion, SesionUsuario } from '../../shared/tipos'
import type { FuenteHoja } from '../importacion/fuente'
import { anotarEvento, cuantasFallidas, cuantasPendientes, guardarMarca, leerMarca, limpiarViejas, pestanasPendientes } from './cola'
import { bajarCambios, type ResultadoBajada } from './bajada'
import { leerContexto, type ContextoHoja } from './hoja'
import { asegurarPestanasDeLaApp } from './pestanasApp'
import { subirTanda } from './subida'

export const INTERVALO_SUBIDA_MS = 10_000
export const INTERVALO_BAJADA_MS = 5 * 60_000
/** La estructura de la hoja casi nunca cambia: se relee cada tanto, no en cada ciclo. */
const VIDA_DEL_CONTEXTO_MS = 5 * 60_000

export type EstadoConexion = 'sincronizado' | 'pendiente' | 'sin-conexion' | 'apagado' | 'trabajando'

/** Errores que son «no hay internet» y no «Google dijo que no». */
function esFallaDeRed(error: unknown): boolean {
  const mensaje = error instanceof Error ? error.message : String(error)
  const codigo = (error as { code?: string } | null)?.code ?? ''
  return (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|network|socket hang up|No se pudo conectar/i.test(mensaje) ||
    ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT', 'ENETUNREACH'].includes(codigo)
  )
}

export interface OpcionesMotor {
  /** Devuelve la fuente configurada, o null si todavía no hay conexión con Google configurada. */
  crearFuente: () => FuenteHoja | null
  /** Corre la importación completa (la que sabe incorporar filas nuevas). */
  importar: () => Promise<void>
  /** Se llama cada vez que cambia el estado, para refrescar el indicador de la barra superior. */
  alCambiarEstado?: (estado: EstadoSincronizacion) => void
  /** Qué pestañas se miran en el ciclo automático; el resto sólo en la bajada completa. */
  pestanasDelCiclo?: (contexto: ContextoHoja) => string[]
}

/** Por defecto el ciclo mira lo que se usa todos los días: el mes abierto, sus bajas y los riesgos. */
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
    if (p.tipo === 'RIESGOS_VARIOS' || p.tipo === 'PAGOS' || p.tipo === 'SINIESTROS') titulos.add(p.titulo)
  }
  return [...titulos]
}

export class MotorDeSincronizacion {
  private opciones: OpcionesMotor
  private temporizadorSubida: NodeJS.Timeout | null = null
  private temporizadorBajada: NodeJS.Timeout | null = null
  private contexto: ContextoHoja | null = null
  private contextoLeidoEn = 0
  private trabajando = false
  private ultimoError: string | null = null
  private sinConexion = false
  private encendido = false

  constructor(opciones: OpcionesMotor) {
    this.opciones = opciones
  }

  encender(): void {
    if (this.encendido) return
    this.encendido = true
    this.temporizadorSubida = setInterval(() => void this.ciclarSubida(), INTERVALO_SUBIDA_MS)
    this.temporizadorBajada = setInterval(() => void this.ciclarBajada(), INTERVALO_BAJADA_MS)
    // Los temporizadores no tienen que impedir que el proceso termine: la aplicación se cierra cuando
    // el usuario cierra la ventana, no cuando la sincronización lo permite.
    this.temporizadorSubida.unref?.()
    this.temporizadorBajada.unref?.()
    anotarEvento('motor', 'Sincronización encendida.')
    this.avisar()
  }

  apagar(): void {
    if (this.temporizadorSubida) clearInterval(this.temporizadorSubida)
    if (this.temporizadorBajada) clearInterval(this.temporizadorBajada)
    this.temporizadorSubida = null
    this.temporizadorBajada = null
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
    else if (this.trabajando) situacion = 'trabajando'
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

  /** Vacía la cola. Devuelve cuántas entradas se subieron. */
  async ciclarSubida(): Promise<number> {
    if (this.trabajando || !this.encendido) return 0
    if (cuantasPendientes() === 0) return 0
    const fuente = this.opciones.crearFuente()
    if (!fuente) return 0

    this.trabajando = true
    this.avisar()
    const arranque = Date.now()
    try {
      let contexto = await this.conContexto(fuente)
      // Si lo que espera es para una pestaña de la aplicación (leads, presupuestos, tareas) y todavía
      // no está en la hoja, se crea ahora al final del archivo y se relee la estructura: recién con la
      // pestaña y sus encabezados leídos la subida sabe qué columna es cada campo.
      const creadas = await asegurarPestanasDeLaApp(fuente, contexto, pestanasPendientes())
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
    } catch (error) {
      this.registrarFalla(error, 'subida')
      return 0
    } finally {
      this.trabajando = false
      this.avisar()
    }
  }

  /** Trae de la hoja lo que cambió. Con `completa` mira todas las pestañas. */
  async ciclarBajada(completa = false): Promise<ResultadoBajada | null> {
    if (this.trabajando || !this.encendido) return null
    const fuente = this.opciones.crearFuente()
    if (!fuente) return null

    // Primero se sube lo que falta: bajar con cambios locales sin subir sería pisarlos.
    if (cuantasPendientes() > 0) {
      const subidas = await this.ciclarSubida()
      if (subidas === 0 && cuantasPendientes() > 0) return null
    }

    this.trabajando = true
    this.avisar()
    const arranque = Date.now()
    try {
      const contexto = await this.conContexto(fuente, completa)
      const titulos = completa ? contexto.pestanas.map((p) => p.titulo) : (this.opciones.pestanasDelCiclo ?? pestanasDeTodosLosDias)(contexto)
      const resultado = await bajarCambios(fuente, contexto, titulos)
      this.sinConexion = false
      this.ultimoError = null
      guardarMarca('ultima_bajada', new Date().toISOString())

      if (resultado.necesitaImportacion) {
        anotarEvento('bajada', `Aparecieron ${resultado.filasNuevas} filas nuevas en la hoja: se corre la importación completa para incorporarlas.`)
        await this.opciones.importar()
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
