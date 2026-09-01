// La base del GENERAL DE CLIENTES en el VPS de la agencia (v12). Implementa la misma interfaz
// `FuenteHoja` que usaba Google Sheets, contra los endpoints /api/dmg del servidor de
// dmartinezseguros.com: el importador y el motor de sincronización no cambian nada.
// Sólo corre en el proceso principal, igual que la fuente de Google.
import type { EstadoBaseVps } from '../../shared/tipos'
import type {
  CeldaAEscribir,
  EstructuraHoja,
  FuenteHoja,
  LecturaDePestana,
  PestanaDeHoja,
  TramoDeColumna,
} from '../importacion/fuente'
import { ErrorDeNegocio } from '../servicios/errores'

/** Tiempo máximo por pedido; sin esto una conexión colgada bloquea la importación. */
const TIEMPO_MAXIMO_MS = 90_000
const MAXIMO_INTENTOS = 5

export interface OpcionesFuenteVps {
  urlBase: string
  token: string
}

export type { EstadoBaseVps }

/** La ficha de un ajuste compartido, sin el secreto: cuándo se cargó, quién y con qué huella. */
export interface FichaDeAjusteVps {
  clave: string
  /** Hash del valor en claro: dos computadoras con la misma huella tienen lo mismo. */
  huella: string
  actualizadoEn: string
  actualizadoPor: string | null
}

export interface AjusteVps extends FichaDeAjusteVps {
  valor: unknown
}

export interface PestanaParaMigrar {
  titulo: string
  oculta: boolean
  columnasOcultas?: number[]
  valores: string[][]
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms))
}

interface RespuestaHttp {
  status: number
  json: unknown
}

function mensajeDelServidor(json: unknown, porDefecto: string): string {
  if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
    return (json as { error: string }).error
  }
  return porDefecto
}

export class FuenteVps implements FuenteHoja {
  private readonly urlBase: string
  private readonly token: string

  constructor(opciones: OpcionesFuenteVps) {
    this.urlBase = opciones.urlBase.replace(/\/+$/, '')
    this.token = opciones.token
    // El token viaja como Bearer: por http plano sólo contra esta misma máquina (el simulador).
    if (!/^https:/i.test(this.urlBase) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(this.urlBase)) {
      throw new ErrorDeNegocio(
        `La URL de la base del VPS tiene que ser https (o http://127.0.0.1 para pruebas locales): ${this.urlBase}`,
      )
    }
  }

  /** Para mostrar en Administración (nunca el token). */
  urlDelServidor(): string {
    return this.urlBase
  }

  /**
   * Un pedido con reintentos: 429 y 5xx y fallas de red se reintentan con espera exponencial; los 4xx
   * se traducen a mensajes de negocio. Las operaciones NO idempotentes (agregar filas, borrar filas,
   * crear pestañas, migración) sólo se reintentan ante 429: ante un corte sin respuesta pueden haberse
   * aplicado igual y repetirlas duplicaría filas o correría las que no eran.
   */
  private async pedir(
    descripcion: string,
    metodo: 'GET' | 'POST',
    ruta: string,
    cuerpo?: unknown,
    opciones: { reintentarSinRespuesta?: boolean } = {},
  ): Promise<unknown> {
    const reintentarSinRespuesta = opciones.reintentarSinRespuesta ?? true
    let intento = 0
    for (;;) {
      let respuesta: RespuestaHttp
      try {
        const bruta = await fetch(this.urlBase + ruta, {
          method: metodo,
          headers: {
            authorization: `Bearer ${this.token}`,
            ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        })
        let json: unknown = null
        try {
          json = await bruta.json()
        } catch (errorDeCuerpo) {
          // En una respuesta buena, un cuerpo ilegible es una conexión que se cortó a la mitad:
          // se trata como falla de red (con su régimen de reintentos), nunca como éxito con null.
          if (bruta.ok) {
            const corte = new Error(
              `La respuesta del VPS se cortó a la mitad (${descripcion}): ${errorDeCuerpo instanceof Error ? errorDeCuerpo.message : errorDeCuerpo}`,
            )
            ;(corte as Error & { code?: string }).code = 'ECONNRESET'
            throw corte
          }
          json = null
        }
        respuesta = { status: bruta.status, json }
      } catch (error) {
        // Falla de red o timeout: se propaga tal cual (con su `code`/`cause`) para que el motor
        // la reconozca como «sin conexión» y la cola espere sin quemar reintentos.
        intento++
        if (reintentarSinRespuesta && intento < MAXIMO_INTENTOS) {
          await esperar(600 * 2 ** intento)
          continue
        }
        throw error
      }

      if (respuesta.status >= 200 && respuesta.status < 300) return respuesta.json

      // El 503 del puente es un error de configuración del servidor (falta DMG_SYNC_TOKEN):
      // reintentarlo no lo arregla y demora el mensaje que sí explica qué hacer.
      if (respuesta.status === 503) throw this.traducirError(respuesta, descripcion)

      intento++
      const transitorio = respuesta.status === 429 || (reintentarSinRespuesta && respuesta.status >= 500)
      if (transitorio && intento < MAXIMO_INTENTOS) {
        await esperar(respuesta.status === 429 ? Math.min(60_000, 5_000 * 2 ** (intento - 1)) : 600 * 2 ** intento)
        continue
      }
      throw this.traducirError(respuesta, descripcion)
    }
  }

  private traducirError(respuesta: RespuestaHttp, descripcion: string): Error {
    const detalle = mensajeDelServidor(respuesta.json, `error ${respuesta.status}`)
    if (respuesta.status === 401) {
      return new ErrorDeNegocio(
        'El servidor del VPS rechazó el token de DM Gestión. El token del programa y el DMG_SYNC_TOKEN del servidor tienen que ser el mismo: actualizá la aplicación o corregí el .env del VPS.',
      )
    }
    if (respuesta.status === 503) return new ErrorDeNegocio(detalle)
    if (respuesta.status === 409) return new ErrorDeNegocio(detalle)
    if (respuesta.status >= 400 && respuesta.status < 500) {
      return new ErrorDeNegocio(`El servidor del VPS rechazó la operación (${descripcion}): ${detalle}`)
    }
    return new Error(`Error ${respuesta.status} del VPS al ${descripcion}: ${detalle}`)
  }

  // --- FuenteHoja -----------------------------------------------------------

  async estructura(): Promise<EstructuraHoja> {
    const datos = (await this.pedir('leer la estructura de la base', 'GET', '/api/dmg/estructura')) as {
      titulo: string
      pestanas: Array<PestanaDeHoja & { columnasOcultas?: number[] }>
    }
    return {
      hojaId: 'vps',
      titulo: datos.titulo,
      pestanas: datos.pestanas.map((pestana) => ({
        sheetId: pestana.sheetId,
        titulo: pestana.titulo,
        indice: pestana.indice,
        filas: pestana.filas,
        columnas: pestana.columnas,
        oculta: pestana.oculta,
      })),
    }
  }

  async leerValores(titulo: string): Promise<string[][]> {
    const lecturas = await this.leerVarias([titulo])
    return lecturas[0]?.valores ?? []
  }

  async leerPrimerasFilas(titulo: string, cantidad: number): Promise<string[][]> {
    const lecturas = await this.leerVarias([titulo], cantidad)
    return lecturas[0]?.valores ?? []
  }

  async leerVarias(titulos: string[], hastaFila?: number): Promise<LecturaDePestana[]> {
    if (titulos.length === 0) return []
    const datos = (await this.pedir('leer la base', 'POST', '/api/dmg/leer', {
      titulos,
      ...(hastaFila ? { hastaFila } : {}),
    })) as { pestanas: LecturaDePestana[] }
    const porTitulo = new Map(datos.pestanas.map((lectura) => [lectura.titulo, lectura.valores]))
    // Coerción defensiva a texto, igual que la fuente de Google: todo el pipeline asume strings.
    return titulos.map((titulo) => ({
      titulo,
      valores: (porTitulo.get(titulo) ?? []).map((fila) =>
        Array.isArray(fila) ? fila.map((celda) => (celda === null || celda === undefined ? '' : String(celda))) : [],
      ),
    }))
  }

  async escribirCeldas(celdas: CeldaAEscribir[]): Promise<void> {
    if (celdas.length === 0) return
    await this.pedir('escribir celdas', 'POST', '/api/dmg/celdas', { celdas })
  }

  async agregarFilas(titulo: string, filas: string[][]): Promise<number> {
    if (filas.length === 0) return 0
    const datos = (await this.pedir('agregar filas', 'POST', '/api/dmg/filas/agregar', { titulo, filas }, {
      reintentarSinRespuesta: false,
    })) as { primeraFila: number }
    return datos.primeraFila
  }

  async borrarFilas(sheetId: number, filas: number[]): Promise<void> {
    if (filas.length === 0) return
    await this.pedir('borrar filas', 'POST', '/api/dmg/filas/borrar', { sheetId, filas }, { reintentarSinRespuesta: false })
  }

  async crearPestana(titulo: string, encabezados: string[]): Promise<PestanaDeHoja> {
    return (await this.pedir('crear la pestaña', 'POST', '/api/dmg/pestanas', { titulo, encabezados }, {
      reintentarSinRespuesta: false,
    })) as PestanaDeHoja
  }

  async asegurarColumnas(sheetId: number, cantidad: number): Promise<void> {
    await this.pedir('agrandar la grilla', 'POST', '/api/dmg/columnas/asegurar', { sheetId, cantidad })
  }

  async escribirTramos(titulo: string, indiceColumna: number, tramos: TramoDeColumna[]): Promise<void> {
    if (tramos.length === 0) return
    await this.pedir('escribir la columna _ID', 'POST', '/api/dmg/tramos', { titulo, indiceColumna, tramos })
  }

  async ocultarColumna(sheetId: number, indiceColumna: number): Promise<void> {
    await this.pedir('ocultar la columna _ID', 'POST', '/api/dmg/columnas/ocultar', { sheetId, indiceColumna })
  }

  // --- Estado y migración inicial (fuera de FuenteHoja) ---------------------

  async estadoBase(): Promise<EstadoBaseVps> {
    return (await this.pedir('consultar el estado de la base', 'GET', '/api/dmg/estado')) as EstadoBaseVps
  }

  async migracionComenzar(): Promise<void> {
    await this.pedir('comenzar la migración', 'POST', '/api/dmg/inicializar/comenzar', {}, { reintentarSinRespuesta: false })
  }

  async migracionCargarPestana(pestana: PestanaParaMigrar): Promise<void> {
    await this.pedir(`migrar la pestaña «${pestana.titulo}»`, 'POST', '/api/dmg/inicializar/pestana', { pestana }, {
      reintentarSinRespuesta: false,
    })
  }

  async migracionConfirmar(): Promise<{ pestanas: number; filas: number }> {
    const datos = (await this.pedir('confirmar la migración', 'POST', '/api/dmg/inicializar/confirmar', {}, {
      reintentarSinRespuesta: false,
    })) as { pestanas: number; filas: number }
    return datos
  }

  // --- Ajustes compartidos --------------------------------------------------
  //
  // Credenciales que el superadministrador carga UNA vez y todas las computadoras adoptan. El
  // servidor las guarda cifradas; acá viajan en claro por el mismo canal https y con el mismo token
  // que ya lleva el GENERAL DE CLIENTES entero.

  //
  // Las dos lecturas van SIN reintentos: son consultas de estado que dibujan una pantalla o corren al
  // arrancar, y esperar cuatro reintentos con espera exponencial contra un servidor caído sería dejar
  // colgada la pantalla medio minuto para terminar diciendo lo mismo.

  async leerAjuste(clave: string): Promise<AjusteVps | null> {
    const datos = (await this.pedir(
      `leer el ajuste «${clave}»`,
      'GET',
      `/api/dmg/ajustes/${encodeURIComponent(clave)}`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { ajuste: AjusteVps | null }
    return datos?.ajuste ?? null
  }

  /** La ficha sin el secreto: alcanza para saber si esta computadora está al día. */
  async estadoAjuste(clave: string): Promise<FichaDeAjusteVps | null> {
    const datos = (await this.pedir(
      `consultar el ajuste «${clave}»`,
      'GET',
      `/api/dmg/ajustes/${encodeURIComponent(clave)}/estado`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { ajuste: FichaDeAjusteVps | null }
    return datos?.ajuste ?? null
  }

  async guardarAjuste(clave: string, valor: unknown, actualizadoPor: string | null): Promise<FichaDeAjusteVps> {
    const datos = (await this.pedir(
      `guardar el ajuste «${clave}»`,
      'POST',
      `/api/dmg/ajustes/${encodeURIComponent(clave)}`,
      { valor, actualizadoPor },
      // Guardar es idempotente: es un upsert por clave, así que repetirlo tras un corte sin
      // respuesta deja exactamente lo mismo y conviene reintentarlo.
      { reintentarSinRespuesta: true },
    )) as { ajuste: FichaDeAjusteVps }
    return datos.ajuste
  }

  async borrarAjuste(clave: string): Promise<void> {
    await this.pedir(`borrar el ajuste «${clave}»`, 'POST', `/api/dmg/ajustes/${encodeURIComponent(clave)}/borrar`, {})
  }
}
