// La base del GENERAL DE CLIENTES en el VPS de la agencia (v12). Implementa la misma interfaz
// `FuenteHoja` que usaba Google Sheets, contra los endpoints /api/dmg del servidor de
// dmartinezseguros.com: el importador y el motor de sincronización no cambian nada.
// Sólo corre en el proceso principal, igual que la fuente de Google.
import type { EstadoBaseVps } from '../../shared/tipos'
import {
  numerosDeFilas,
  type CeldaAEscribir,
  type EstructuraHoja,
  type FilaABorrar,
  type FuenteHoja,
  type LecturaDePestana,
  type PestanaDeHoja,
  type ResultadoDeAgregado,
  type ResultadoDeBorrado,
  type ResultadoDeCeldas,
  type ResultadoDeTramos,
  type TramoDeColumna,
} from '../importacion/fuente'
import { ErrorDeNegocio } from '../servicios/errores'

/** Tiempo máximo por pedido; sin esto una conexión colgada bloquea la importación. */
const TIEMPO_MAXIMO_MS = 90_000
const MAXIMO_INTENTOS = 5

export interface OpcionesFuenteVps {
  urlBase: string
  token: string
  /**
   * A quién avisarle (una sola vez) que el servidor es anterior a la 12.6 y todavía escribe por
   * posición: la app sigue funcionando como hasta ahora, pero conviene actualizar el VPS.
   */
  avisar?: (mensaje: string) => void
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

/**
 * Quién pide la acción de Redes sociales. A diferencia de los ajustes (que cualquiera con acceso al
 * puente puede leer/guardar), acá el servidor decide con esto si se puede vincular una cuenta (sólo
 * SUPER_ADMIN) o en qué sucursal se puede publicar — por eso viaja en cada pedido.
 */
/** La ficha de un respaldo del servidor, sin el volcado adentro: es lo que se dibuja en la pantalla. */
export interface RespaldoVps {
  id: number
  /** AAAA-MM-DD en la zona de la agencia. */
  dia: string
  motivo: 'DIARIO' | 'A_MANO' | 'ANTES_DE_RESTAURAR'
  fecha: string
  tamano: number
  pestanas: number
  filas: number
  /** Quién lo pidió, o null cuando lo hizo el reloj del servidor. */
  hechoPor: string | null
}

export interface ResumenDeRestauracionVps {
  pestanas: number
  filas: number
  /**
   * La foto que el servidor sacó del estado anterior antes de pisarlo, para poder deshacer. Viene en
   * null en el único caso en que no había nada que fotografiar: la base del servidor estaba vacía.
   */
  respaldoPrevio: RespaldoVps | null
}

export interface ActorDeRedesVps {
  nombre: string
  rol: 'SUPER_ADMIN' | 'ADMIN' | 'EMPLEADO'
  sucursal: string | null
}

export interface CuentaDeRedesVps {
  sucursal: string
  facebookPaginaId: string
  facebookPaginaNombre: string
  instagramId: string | null
  instagramUsuario: string | null
  estado: 'ACTIVA' | 'DESVINCULADA' | 'TOKEN_RECHAZADO'
  puedePublicarEnInstagram: boolean
  vinculadoPor: string
  vinculadoEn: string
}

export interface DatosDeVinculoParaVps {
  sucursal: string
  facebookPaginaId: string
  facebookPaginaNombre: string
  instagramId: string | null
  instagramUsuario: string | null
  paginaToken: string
}

export interface ArchivoParaVps {
  nombre: string
  tipo: string
  contenidoBase64: string
}

export interface PedidoDePublicacionParaVps {
  sucursal?: string
  destino: 'FACEBOOK' | 'INSTAGRAM'
  tipoDeContenido?: 'FEED' | 'REEL' | 'STORIA'
  texto: string
  archivo?: ArchivoParaVps | null
  /** Fecha/hora ISO a la que tiene que salir sola. Vacío/null = publicar ya. */
  programarPara?: string | null
}

export interface PublicacionDeRedVps {
  id: string
  sucursal: string
  destino: 'FACEBOOK' | 'INSTAGRAM'
  tipoDeContenido: 'FEED' | 'REEL' | 'STORIA'
  estado: 'BORRADOR' | 'PROGRAMADA' | 'PUBLICADA' | 'FALLIDA'
  texto: string
  idEnLaRed: string | null
  url: string | null
  error: string | null
  creadoPor: string
  programadoPara: string | null
  publicadoEn: string | null
  creadoEn: string
}

export interface ComentarioRespuestaDeRedVps {
  id: string
  mensaje: string
  respondidoPor: string
  respondidoEn: string
}

export interface ComentarioDeRedVps {
  id: string
  sucursal: string
  plataforma: 'FACEBOOK' | 'INSTAGRAM'
  autorNombre: string
  mensaje: string
  creadoEnMeta: string
  estado: 'VISIBLE' | 'OCULTO' | 'ELIMINADO'
  respondido: boolean
  puedeResponder: boolean
  puedeOcultar: boolean
  puedeEliminar: boolean
  motivoSiNoPuede: string | null
  respuestas: ComentarioRespuestaDeRedVps[]
}

export interface ConversacionDeRedVps {
  id: string
  sucursal: string
  plataforma: 'FACEBOOK' | 'INSTAGRAM'
  participanteNombre: string
  ultimoMensajeEn: string
  puedeResponder: boolean
  motivoSiNoPuedeResponder: string | null
}

export interface MensajeDeRedVps {
  id: string
  direccion: 'ENTRANTE' | 'SALIENTE'
  mensaje: string
  creadoEnMeta: string
  enviadoPor: string | null
}

function consultaDeActor(actor: ActorDeRedesVps): string {
  const parametros = new URLSearchParams({ actorNombre: actor.nombre, actorRol: actor.rol })
  if (actor.sucursal) parametros.set('actorSucursal', actor.sucursal)
  return parametros.toString()
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
  private readonly avisar: ((mensaje: string) => void) | null
  private servidorViejoAvisado = false

  constructor(opciones: OpcionesFuenteVps) {
    this.urlBase = opciones.urlBase.replace(/\/+$/, '')
    this.token = opciones.token
    this.avisar = opciones.avisar ?? null
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

  /**
   * Un servidor anterior a la 12.6 no contesta `noEncontradas`/`saltadas`: escribe por posición, como
   * siempre. La app sigue andando (los campos viejos van en cada pedido), pero se avisa una vez.
   */
  private comprobarServidorAlDia(contesta: boolean, hacianFaltaIds: boolean): void {
    if (contesta || !hacianFaltaIds || this.servidorViejoAvisado) return
    this.servidorViejoAvisado = true
    this.avisar?.(
      'El servidor del VPS es anterior a la 12.6 y todavía escribe por número de renglón. Funciona, pero dos computadoras ' +
        'sincronizando a la vez pueden pisarse: conviene actualizar el servidor.',
    )
  }

  async escribirCeldas(celdas: CeldaAEscribir[], columnaIdPorTitulo: Record<string, number> = {}): Promise<ResultadoDeCeldas> {
    if (celdas.length === 0) return { noEncontradas: [] }
    const datos = (await this.pedir('escribir celdas', 'POST', '/api/dmg/celdas', { celdas, columnaId: columnaIdPorTitulo })) as {
      escritas?: number
      noEncontradas?: Array<{ titulo?: unknown; id?: unknown }>
    } | null
    const contesta = Array.isArray(datos?.noEncontradas)
    this.comprobarServidorAlDia(contesta, celdas.some((celda) => Boolean(celda.id)))
    return {
      noEncontradas: contesta
        ? datos!.noEncontradas!.map((fila) => ({ titulo: String(fila.titulo ?? ''), id: String(fila.id ?? '') }))
        : [],
    }
  }

  async agregarFilas(titulo: string, filas: string[][]): Promise<ResultadoDeAgregado> {
    if (filas.length === 0) return { primeraFila: 0, numeros: [] }
    const datos = (await this.pedir('agregar filas', 'POST', '/api/dmg/filas/agregar', { titulo, filas }, {
      reintentarSinRespuesta: false,
    })) as { primeraFila: number; numeros?: Array<number | null> }
    const primeraFila = Number(datos.primeraFila) || 0
    // Un servidor viejo no dice en qué renglón quedó cada una: se supone «primeraFila + i», como antes.
    const numeros = Array.isArray(datos.numeros)
      ? filas.map((_, indice) => (Number.isInteger(datos.numeros![indice]) ? Number(datos.numeros![indice]) : null))
      : filas.map((_, indice) => (primeraFila > 0 ? primeraFila + indice : null))
    return { primeraFila, numeros }
  }

  async borrarFilas(sheetId: number, filas: Array<number | FilaABorrar>, columnaId: number | null = null): Promise<ResultadoDeBorrado> {
    if (filas.length === 0) return { noEncontradas: [] }
    // Los dos campos viajan juntos: `filas` (números) para un servidor viejo, `objetivos` (número + _ID)
    // para el de la 12.6, que los resuelve contra la pestaña tal como está en ese momento y con eso
    // ignora `filas`. Un renglón sin _ID va con id '' y el servidor lo borra por posición.
    const objetivos = filas.map((fila) => (typeof fila === 'number' ? { numero: fila, id: '' } : { numero: fila.numero, id: fila.id ?? '' }))
    const datos = (await this.pedir(
      'borrar filas',
      'POST',
      '/api/dmg/filas/borrar',
      { sheetId, filas: numerosDeFilas(filas), objetivos, columnaId },
      { reintentarSinRespuesta: false },
    )) as { borradas?: number; noEncontradas?: unknown[] } | null
    const contesta = Array.isArray(datos?.noEncontradas)
    this.comprobarServidorAlDia(contesta, objetivos.some((objetivo) => objetivo.id !== ''))
    return { noEncontradas: contesta ? datos!.noEncontradas!.map(String) : [] }
  }

  async crearPestana(titulo: string, encabezados: string[]): Promise<PestanaDeHoja> {
    return (await this.pedir('crear la pestaña', 'POST', '/api/dmg/pestanas', { titulo, encabezados }, {
      reintentarSinRespuesta: false,
    })) as PestanaDeHoja
  }

  async asegurarColumnas(sheetId: number, cantidad: number): Promise<void> {
    await this.pedir('agrandar la grilla', 'POST', '/api/dmg/columnas/asegurar', { sheetId, cantidad })
  }

  async escribirTramos(titulo: string, indiceColumna: number, tramos: TramoDeColumna[]): Promise<ResultadoDeTramos> {
    if (tramos.length === 0) return { saltadas: [] }
    const datos = (await this.pedir('escribir la columna _ID', 'POST', '/api/dmg/tramos', { titulo, indiceColumna, tramos })) as {
      escritas?: number
      saltadas?: unknown[]
    } | null
    const contesta = Array.isArray(datos?.saltadas)
    this.comprobarServidorAlDia(contesta, tramos.some((tramo) => Array.isArray(tramo.previos)))
    return { saltadas: contesta ? datos!.saltadas!.map(Number).filter(Number.isInteger) : [] }
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

  // --- Respaldos del estado de la base ---------------------------------------
  //
  // Los hace y los guarda el SERVIDOR, no esta computadora: la copia .xlsx de %APPDATA% depende de que
  // alguien abra el programa después de las 20:00, y encima queda en la máquina de la que justamente
  // hay que tener copia. Acá sólo se los mira y, si hace falta, se pide rebobinar.

  async respaldos(cuantos = 3): Promise<RespaldoVps[]> {
    const datos = (await this.pedir(
      'listar los respaldos del servidor',
      'GET',
      `/api/dmg/respaldos?cuantos=${encodeURIComponent(String(cuantos))}`,
      undefined,
      // Dibuja una pantalla: si el servidor no está, se dice y listo, no se la deja cargando medio
      // minuto mientras reintenta.
      { reintentarSinRespuesta: false },
    )) as { respaldos: RespaldoVps[] }
    return datos?.respaldos ?? []
  }

  async crearRespaldo(hechoPor: string | null): Promise<{ respaldo: RespaldoVps; yaEstaba: boolean }> {
    return (await this.pedir(
      'guardar el respaldo en el servidor',
      'POST',
      '/api/dmg/respaldos',
      { hechoPor },
      // Es idempotente por día: repetirlo tras un corte sin respuesta deja exactamente lo mismo.
      { reintentarSinRespuesta: true },
    )) as { respaldo: RespaldoVps; yaEstaba: boolean }
  }

  /**
   * Rebobina la base del servidor a ese respaldo. NUNCA se reintenta solo: pisa el GENERAL DE CLIENTES
   * de la agencia entera, y repetirlo por las dudas después de un corte es exactamente lo que no hay
   * que hacer. Si no vuelve respuesta, lo correcto es mirar cómo quedó y decidir a mano.
   */
  async restaurarRespaldo(id: number, hechoPor: string | null): Promise<ResumenDeRestauracionVps> {
    return (await this.pedir(
      'restaurar el respaldo',
      'POST',
      `/api/dmg/respaldos/${encodeURIComponent(String(id))}/restaurar`,
      { hechoPor },
      { reintentarSinRespuesta: false },
    )) as ResumenDeRestauracionVps
  }

  // --- Redes sociales por sucursal -------------------------------------------
  //
  // El token de la Página vive cifrado en el servidor: esta computadora nunca lo ve ni lo vuelve a
  // mandar. Lo único que sale de acá, una sola vez, es el token recién elegido en el login de
  // Facebook (ver `redesVincular`); de ahí en más el servidor es quien habla con Meta.

  async redesCuentas(actor: ActorDeRedesVps): Promise<CuentaDeRedesVps[]> {
    const datos = (await this.pedir(
      'listar las cuentas de redes sociales',
      'GET',
      `/api/dmg/redes/cuentas?${consultaDeActor(actor)}`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { cuentas: CuentaDeRedesVps[] }
    return datos?.cuentas ?? []
  }

  async redesVincular(actor: ActorDeRedesVps, datos: DatosDeVinculoParaVps): Promise<CuentaDeRedesVps> {
    const respuesta = (await this.pedir(
      'vincular la cuenta de redes sociales',
      'POST',
      '/api/dmg/redes/cuentas',
      { actor, ...datos },
      { reintentarSinRespuesta: false },
    )) as { cuenta: CuentaDeRedesVps }
    return respuesta.cuenta
  }

  async redesDesvincular(actor: ActorDeRedesVps, sucursal: string): Promise<void> {
    await this.pedir(
      'desvincular la cuenta de redes sociales',
      'POST',
      `/api/dmg/redes/cuentas/${encodeURIComponent(sucursal)}/desvincular`,
      { actor },
      { reintentarSinRespuesta: false },
    )
  }

  /**
   * Publicar sube una foto: puede tardar. Va SIN reintentos automáticos a propósito — repetir un
   * pedido que sí llegó a publicarse pero se cortó en la respuesta duplicaría la publicación, y eso
   * es peor que pedirle a la persona que apriete «Publicar» de nuevo si hace falta.
   */
  async redesPublicar(actor: ActorDeRedesVps, pedido: PedidoDePublicacionParaVps): Promise<PublicacionDeRedVps> {
    const respuesta = (await this.pedir(
      'publicar en redes sociales',
      'POST',
      '/api/dmg/redes/publicaciones',
      { actor, ...pedido },
      { reintentarSinRespuesta: false },
    )) as { publicacion: PublicacionDeRedVps }
    return respuesta.publicacion
  }

  async redesPublicaciones(actor: ActorDeRedesVps, sucursal?: string): Promise<PublicacionDeRedVps[]> {
    const parametros = new URLSearchParams(consultaDeActor(actor))
    if (sucursal) parametros.set('sucursal', sucursal)
    const datos = (await this.pedir(
      'listar publicaciones de redes sociales',
      'GET',
      `/api/dmg/redes/publicaciones?${parametros}`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { publicaciones: PublicacionDeRedVps[] }
    return datos?.publicaciones ?? []
  }

  /** Cuántas publicaciones más admite Instagram hoy en la cuenta de esa sucursal; null si no se pudo averiguar. */
  async redesCuotaInstagram(actor: ActorDeRedesVps, sucursal?: string): Promise<number | null> {
    const parametros = new URLSearchParams(consultaDeActor(actor))
    const objetivo = sucursal ?? actor.sucursal ?? ''
    const datos = (await this.pedir(
      'consultar la cuota de Instagram',
      'GET',
      `/api/dmg/redes/cuentas/${encodeURIComponent(objetivo)}/cuota-instagram?${parametros}`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { cuota: number | null }
    return datos?.cuota ?? null
  }

  // --- Comentarios -----------------------------------------------------------
  //
  // La bandeja se lee de lo que ya juntó el webhook del servidor, no de una llamada a Meta en cada
  // pedido: por eso `redesComentarios` es liviano y se puede llamar seguido.

  async redesComentarios(actor: ActorDeRedesVps, sucursal?: string, soloSinResponder?: boolean): Promise<ComentarioDeRedVps[]> {
    const parametros = new URLSearchParams(consultaDeActor(actor))
    if (sucursal) parametros.set('sucursal', sucursal)
    if (soloSinResponder) parametros.set('soloSinResponder', '1')
    const datos = (await this.pedir(
      'listar los comentarios',
      'GET',
      `/api/dmg/redes/comentarios?${parametros}`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { comentarios: ComentarioDeRedVps[] }
    return datos?.comentarios ?? []
  }

  async redesComentarioResponder(actor: ActorDeRedesVps, comentarioId: string, mensaje: string): Promise<ComentarioDeRedVps> {
    const respuesta = (await this.pedir(
      'responder el comentario',
      'POST',
      `/api/dmg/redes/comentarios/${encodeURIComponent(comentarioId)}/responder`,
      { actor, mensaje },
      { reintentarSinRespuesta: false },
    )) as { comentario: ComentarioDeRedVps }
    return respuesta.comentario
  }

  async redesComentarioOcultar(actor: ActorDeRedesVps, comentarioId: string, ocultar: boolean): Promise<ComentarioDeRedVps> {
    const accion = ocultar ? 'ocultar' : 'mostrar'
    const respuesta = (await this.pedir(
      `${accion} el comentario`,
      'POST',
      `/api/dmg/redes/comentarios/${encodeURIComponent(comentarioId)}/${accion}`,
      { actor },
      { reintentarSinRespuesta: false },
    )) as { comentario: ComentarioDeRedVps }
    return respuesta.comentario
  }

  async redesComentarioEliminar(actor: ActorDeRedesVps, comentarioId: string): Promise<void> {
    await this.pedir(
      'eliminar el comentario',
      'POST',
      `/api/dmg/redes/comentarios/${encodeURIComponent(comentarioId)}/eliminar`,
      { actor },
      { reintentarSinRespuesta: false },
    )
  }

  // --- Mensajes privados -------------------------------------------------------

  async redesConversaciones(actor: ActorDeRedesVps, sucursal?: string): Promise<ConversacionDeRedVps[]> {
    const parametros = new URLSearchParams(consultaDeActor(actor))
    if (sucursal) parametros.set('sucursal', sucursal)
    const datos = (await this.pedir(
      'listar las conversaciones',
      'GET',
      `/api/dmg/redes/conversaciones?${parametros}`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { conversaciones: ConversacionDeRedVps[] }
    return datos?.conversaciones ?? []
  }

  async redesConversacionMensajes(actor: ActorDeRedesVps, conversacionId: string): Promise<MensajeDeRedVps[]> {
    const datos = (await this.pedir(
      'leer los mensajes de la conversación',
      'GET',
      `/api/dmg/redes/conversaciones/${encodeURIComponent(conversacionId)}/mensajes?${consultaDeActor(actor)}`,
      undefined,
      { reintentarSinRespuesta: false },
    )) as { mensajes: MensajeDeRedVps[] }
    return datos?.mensajes ?? []
  }

  async redesConversacionResponder(actor: ActorDeRedesVps, conversacionId: string, mensaje: string): Promise<MensajeDeRedVps> {
    const respuesta = (await this.pedir(
      'responder el mensaje',
      'POST',
      `/api/dmg/redes/conversaciones/${encodeURIComponent(conversacionId)}/responder`,
      { actor, mensaje },
      { reintentarSinRespuesta: false },
    )) as { mensaje: MensajeDeRedVps }
    return respuesta.mensaje
  }
}
