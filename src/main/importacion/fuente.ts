// Acceso a la hoja de cálculo. `FuenteHoja` es la interfaz que usa el importador; `FuenteGoogleSheets`
// la implementa con la API oficial de Google Sheets (cuenta de servicio). Sólo corre en el proceso principal.
import { auth as autenticacion, sheets, type sheets_v4 } from '@googleapis/sheets'
import { ErrorDeNegocio } from '../servicios/errores'
import { letraColumna } from './normalizar'

export interface PestanaDeHoja {
  sheetId: number
  titulo: string
  indice: number
  filas: number
  columnas: number
  /** La pestaña está oculta en Google: no puede definir la cartera actual. */
  oculta: boolean
}

/** Un bloque contiguo de celdas a escribir en una columna, empezando en `fila` (1 = encabezados). */
export interface TramoDeColumna {
  fila: number
  valores: string[]
}

/** Una celda suelta a escribir: fila y columna en base 1 y 0 respectivamente, como las usa el importador. */
export interface CeldaAEscribir {
  titulo: string
  /** Número de fila en la hoja (la 1 es la primera). */
  fila: number
  /** Índice de columna (0 = A). */
  columna: number
  valor: string
}

export interface LecturaDePestana {
  titulo: string
  valores: string[][]
}

export interface EstructuraHoja {
  hojaId: string
  titulo: string
  pestanas: PestanaDeHoja[]
}

export interface FuenteHoja {
  estructura(): Promise<EstructuraHoja>
  /** Todas las filas con datos de la pestaña, como texto tal cual se ve en la hoja. */
  leerValores(titulo: string): Promise<string[][]>
  /** Sólo las primeras filas: alcanza para averiguar dónde está la fila de encabezados. */
  leerPrimerasFilas(titulo: string, cantidad: number): Promise<string[][]>
  /** Garantiza que la grilla tenga al menos `cantidad` columnas (agrega si hace falta). */
  asegurarColumnas(sheetId: number, cantidad: number): Promise<void>
  /**
   * Escribe SÓLO los tramos indicados de una columna. No se pisa la columna entera a propósito: si
   * alguien insertó una fila mientras se leía, pisar todo correría los _ID de lugar.
   */
  escribirTramos(titulo: string, indiceColumna: number, tramos: TramoDeColumna[]): Promise<void>
  ocultarColumna(sheetId: number, indiceColumna: number): Promise<void>

  // --- Operaciones de la sincronización -------------------------------------
  /**
   * Lee varias pestañas de una sola llamada (batchGet): clave para no pasarse de la cuota.
   * Con `hastaFila` se leen sólo las primeras filas (para averiguar los encabezados).
   */
  leerVarias(titulos: string[], hastaFila?: number): Promise<LecturaDePestana[]>
  /** Escribe celdas sueltas de varias pestañas en una sola llamada. No toca formatos ni colores. */
  escribirCeldas(celdas: CeldaAEscribir[]): Promise<void>
  /** Agrega filas al final de la pestaña. Devuelve el número de la primera fila agregada. */
  agregarFilas(titulo: string, filas: string[][]): Promise<number>
  /** Borra filas de la pestaña (números de fila en base 1). */
  borrarFilas(sheetId: number, filas: number[]): Promise<void>
  /**
   * Crea una pestaña nueva AL FINAL de la hoja con esos encabezados en la fila 1. La usan las tres
   * pestañas de la Fase 8 (APP LEADS, APP PRESUPUESTOS, APP TAREAS), que no existen en el Excel de la
   * agencia. Nunca toca las pestañas que ya están: agrega una al final y nada más.
   */
  crearPestana(titulo: string, encabezados: string[]): Promise<PestanaDeHoja>
}

const ALCANCES = [
  'https://www.googleapis.com/auth/spreadsheets',
  // Para el respaldo diario: exportar la hoja a .xlsx y subirla a la carpeta «Respaldos DM».
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
]

/** Extrae el ID de una URL de Google Sheets. */
export function extraerIdDeHoja(url: string): string | null {
  const coincidencia = url.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)
  return coincidencia?.[1] ?? null
}

/** Título de pestaña en notación A1: las comillas simples internas se duplican. */
function rangoDePestana(titulo: string, rango?: string): string {
  const escapado = `'${titulo.replace(/'/g, "''")}'`
  return rango ? `${escapado}!${rango}` : escapado
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms))
}

interface ErrorHttp {
  status?: number
  code?: number | string
  message?: string
  response?: { status?: number; data?: { error?: { message?: string } } }
}

function estadoHttp(error: unknown): number | null {
  const e = error as ErrorHttp
  const candidato = e.status ?? e.response?.status ?? (typeof e.code === 'number' ? e.code : Number(e.code))
  return Number.isFinite(candidato) ? Number(candidato) : null
}

function mensajeDeError(error: unknown): string {
  const e = error as ErrorHttp
  return e.response?.data?.error?.message ?? e.message ?? String(error)
}

/** Problemas con la clave privada o el cliente OAuth: reintentar no sirve. */
function esErrorDeCredenciales(mensaje: string): boolean {
  return /invalid_grant|invalid_client|unauthorized_client|DECODER routines|PEM|private key|private_key|No key or keyFile|ERR_OSSL/i.test(mensaje)
}

/** Milisegundos sugeridos por el encabezado Retry-After (gaxios expone Headers o un objeto plano). */
function esperaRetryAfter(error: unknown): number {
  const cabeceras = (error as { response?: { headers?: unknown } }).response?.headers
  let valor: string | null | undefined
  if (cabeceras && typeof (cabeceras as Headers).get === 'function') valor = (cabeceras as Headers).get('retry-after')
  else if (cabeceras && typeof cabeceras === 'object') valor = (cabeceras as Record<string, string | undefined>)['retry-after']
  const segundos = Number(valor)
  return Number.isFinite(segundos) && segundos > 0 ? segundos * 1000 : 0
}

/** Tiempo máximo por pedido a Google; sin esto una conexión colgada bloquea la importación. */
const TIEMPO_MAXIMO_MS = 90_000

type OpcionesGoogleAuth = NonNullable<ConstructorParameters<typeof autenticacion.GoogleAuth>[0]>

export interface OpcionesFuenteGoogle {
  hojaId: string
  cuentaServicio: Record<string, unknown>
  /** Sólo para pruebas locales contra un servidor que simula la API (sin autenticación). */
  urlBase?: string
}

export class FuenteGoogleSheets implements FuenteHoja {
  private readonly api: sheets_v4.Sheets
  private readonly hojaId: string
  private readonly clientEmail: string
  private columnasPorSheetId = new Map<number, number>()
  private readonly autenticacion: InstanceType<typeof autenticacion.GoogleAuth> | null

  constructor(opciones: OpcionesFuenteGoogle) {
    this.hojaId = opciones.hojaId
    this.clientEmail = typeof opciones.cuentaServicio.client_email === 'string' ? opciones.cuentaServicio.client_email : '(sin client_email)'
    if (opciones.urlBase) {
      this.api = sheets({ version: 'v4', auth: 'simulada', rootUrl: opciones.urlBase, timeout: TIEMPO_MAXIMO_MS })
      this.autenticacion = null
    } else {
      const auth = new autenticacion.GoogleAuth({
        credentials: opciones.cuentaServicio as OpcionesGoogleAuth['credentials'],
        scopes: ALCANCES,
      })
      this.autenticacion = auth
      this.api = sheets({ version: 'v4', auth, timeout: TIEMPO_MAXIMO_MS })
    }
  }

  /**
   * Reintenta ante límites de cuota (429, respetando Retry-After y con esperas largas porque la cuota es por
   * minuto), errores 5xx y fallas de red; los errores de credenciales y los 4xx se traducen sin reintentar.
   * `reintentarSinRespuesta: false` es para operaciones no idempotentes (agregar columnas).
   */
  private async conReintentos<T>(descripcion: string, accion: () => Promise<T>, opciones: { reintentarSinRespuesta?: boolean } = {}): Promise<T> {
    const reintentarSinRespuesta = opciones.reintentarSinRespuesta ?? true
    let intento = 0
    for (;;) {
      try {
        return await accion()
      } catch (error) {
        intento++
        const estado = estadoHttp(error)
        const mensaje = mensajeDeError(error)
        if (esErrorDeCredenciales(mensaje)) throw this.traducirError(error, descripcion)
        // Una operación no idempotente (agregar columnas) no se repite ni ante 5xx: puede haberse
        // aplicado igual y quedarían columnas de más a la derecha del _ID.
        const transitorio = reintentarSinRespuesta ? estado === 429 || (estado !== null && estado >= 500) || estado === null : estado === 429
        if (!transitorio || intento >= 5) throw this.traducirError(error, descripcion)
        const espera = estado === 429 ? Math.min(60_000, Math.max(esperaRetryAfter(error), 5_000 * 2 ** (intento - 1))) : 600 * 2 ** intento
        await esperar(espera)
      }
    }
  }

  private traducirError(error: unknown, descripcion: string): Error {
    const estado = estadoHttp(error)
    const detalle = mensajeDeError(error)
    if (esErrorDeCredenciales(detalle)) {
      return new ErrorDeNegocio(`Google rechazó la clave de la cuenta de servicio (${this.clientEmail}). Volvé a pegar el JSON completo en «Conexión con Google» o generá una clave nueva en Google Cloud. Detalle: ${detalle}`)
    }
    if (estado === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(detalle)) {
      return new ErrorDeNegocio(`La API de Google Sheets no está habilitada en el proyecto de la cuenta de servicio. Habilitala en Google Cloud (APIs y servicios → Google Sheets API). Detalle: ${detalle}`)
    }
    if (estado === 403) {
      return new ErrorDeNegocio(`La cuenta de servicio (${this.clientEmail}) no tiene acceso a la hoja. Compartí la hoja con ese correo como editor. Detalle: ${detalle}`)
    }
    if (estado === 404) return new ErrorDeNegocio(`No se encontró la hoja de cálculo (ID ${this.hojaId}). Revisá la URL guardada en Conexión con Google.`)
    if (estado === 401) return new ErrorDeNegocio(`Google rechazó las credenciales de la cuenta de servicio. Volvé a pegar el JSON en Conexión con Google. Detalle: ${detalle}`)
    if (estado === 429) return new ErrorDeNegocio(`Google limitó la cantidad de pedidos (cuota) al ${descripcion}. Esperá un minuto y volvé a correr la importación: continúa donde quedó.`)
    if (estado === 400) return new ErrorDeNegocio(`Google rechazó la operación (${descripcion}): ${detalle}`)
    if (estado === null) return new Error(`No se pudo conectar con Google (${descripcion}): ${detalle}`)
    return new Error(`Error ${estado} de Google al ${descripcion}: ${detalle}`)
  }

  /** Token de la cuenta de servicio, para hablar con Drive (respaldos) sin otra librería. */
  async obtenerToken(): Promise<string> {
    if (!this.autenticacion) throw new ErrorDeNegocio('La conexión simulada no tiene token: el respaldo necesita la cuenta de servicio real.')
    const token = await this.autenticacion.getAccessToken()
    if (!token) throw new ErrorDeNegocio('Google no devolvió un token para la cuenta de servicio.')
    return token
  }

  async estructura(): Promise<EstructuraHoja> {
    const respuesta = await this.conReintentos('leer la estructura de la hoja', () =>
      this.api.spreadsheets.get({
        spreadsheetId: this.hojaId,
        fields: 'spreadsheetId,properties.title,sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount)))',
      }),
    )
    const hoja = respuesta.data
    const pestanas: PestanaDeHoja[] = (hoja.sheets ?? []).map((s, posicion) => {
      const p = s.properties ?? {}
      const pestana: PestanaDeHoja = {
        sheetId: p.sheetId ?? posicion,
        titulo: p.title ?? `Hoja ${posicion + 1}`,
        indice: p.index ?? posicion,
        filas: p.gridProperties?.rowCount ?? 0,
        columnas: p.gridProperties?.columnCount ?? 0,
        oculta: p.hidden === true,
      }
      this.columnasPorSheetId.set(pestana.sheetId, pestana.columnas)
      return pestana
    })
    return { hojaId: hoja.spreadsheetId ?? this.hojaId, titulo: hoja.properties?.title ?? '(sin título)', pestanas }
  }

  async leerPrimerasFilas(titulo: string, cantidad: number): Promise<string[][]> {
    return this.leerRango(titulo, `A1:ZZ${cantidad}`, `leer los encabezados de «${titulo}»`)
  }

  async leerValores(titulo: string): Promise<string[][]> {
    return this.leerRango(titulo, 'A1:ZZ', `leer la pestaña «${titulo}»`)
  }

  private async leerRango(titulo: string, rango: string, descripcion: string): Promise<string[][]> {
    const respuesta = await this.conReintentos(descripcion, () =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.hojaId,
        range: rangoDePestana(titulo, rango),
        // Texto tal cual se ve en la hoja: fechas, montos y "A/D" llegan como los escribió la persona.
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
        majorDimension: 'ROWS',
      }),
    )
    const filas = (respuesta.data.values ?? []) as unknown[][]
    return filas.map((fila) => fila.map((celda) => (celda === null || celda === undefined ? '' : String(celda))))
  }

  async asegurarColumnas(sheetId: number, cantidad: number): Promise<void> {
    const actuales = this.columnasPorSheetId.get(sheetId) ?? 0
    if (cantidad <= actuales) return
    // appendDimension no es idempotente: si no hubo respuesta no se reintenta a ciegas (podría agregar de más).
    await this.conReintentos(
      'agregar columnas a la pestaña',
      () =>
        this.api.spreadsheets.batchUpdate({
          spreadsheetId: this.hojaId,
          requestBody: { requests: [{ appendDimension: { sheetId, dimension: 'COLUMNS', length: cantidad - actuales } }] },
        }),
      { reintentarSinRespuesta: false },
    )
    this.columnasPorSheetId.set(sheetId, cantidad)
  }

  async escribirTramos(titulo: string, indiceColumna: number, tramos: TramoDeColumna[]): Promise<void> {
    const utiles = tramos.filter((t) => t.valores.length > 0)
    if (utiles.length === 0) return
    const letra = letraColumna(indiceColumna)
    await this.conReintentos(`escribir la columna ${letra} de «${titulo}»`, () =>
      this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.hojaId,
        requestBody: {
          valueInputOption: 'RAW',
          data: utiles.map((tramo) => ({
            range: rangoDePestana(titulo, `${letra}${tramo.fila}:${letra}${tramo.fila + tramo.valores.length - 1}`),
            majorDimension: 'COLUMNS',
            values: [tramo.valores],
          })),
        },
      }),
    )
  }

  async leerVarias(titulos: string[], hastaFila?: number): Promise<LecturaDePestana[]> {
    if (titulos.length === 0) return []
    const rango = hastaFila ? `A1:ZZ${hastaFila}` : 'A1:ZZ'
    const respuesta = await this.conReintentos(`leer ${titulos.length} pestañas`, () =>
      this.api.spreadsheets.values.batchGet({
        spreadsheetId: this.hojaId,
        ranges: titulos.map((titulo) => rangoDePestana(titulo, rango)),
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
        majorDimension: 'ROWS',
      }),
    )
    const rangos = respuesta.data.valueRanges ?? []
    return titulos.map((titulo, i) => ({
      titulo,
      valores: ((rangos[i]?.values ?? []) as unknown[][]).map((fila) => fila.map((celda) => (celda === null || celda === undefined ? '' : String(celda)))),
    }))
  }

  async escribirCeldas(celdas: CeldaAEscribir[]): Promise<void> {
    if (celdas.length === 0) return
    await this.conReintentos(`escribir ${celdas.length} celdas`, () =>
      this.api.spreadsheets.values.batchUpdate({
        spreadsheetId: this.hojaId,
        requestBody: {
          valueInputOption: 'RAW',
          data: celdas.map((celda) => {
            const letra = letraColumna(celda.columna)
            return { range: rangoDePestana(celda.titulo, `${letra}${celda.fila}`), values: [[celda.valor]] }
          }),
        },
      }),
    )
  }

  async agregarFilas(titulo: string, filas: string[][]): Promise<number> {
    if (filas.length === 0) return 0
    const respuesta = await this.conReintentos(
      `agregar ${filas.length} filas a «${titulo}»`,
      () =>
        this.api.spreadsheets.values.append({
          spreadsheetId: this.hojaId,
          range: rangoDePestana(titulo, 'A1'),
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: filas },
        }),
      // Agregar no es idempotente: si no hubo respuesta, no se repite a ciegas.
      { reintentarSinRespuesta: false },
    )
    const rango = respuesta.data.updates?.updatedRange ?? ''
    const primera = Number(rango.match(/![A-Z]+(d+)/)?.[1] ?? '0')
    return primera
  }

  async borrarFilas(sheetId: number, filas: number[]): Promise<void> {
    if (filas.length === 0) return
    // De abajo hacia arriba: borrar una fila corre las de abajo.
    const ordenadas = [...new Set(filas)].sort((a, b) => b - a)
    await this.conReintentos(
      `borrar ${ordenadas.length} filas`,
      () =>
        this.api.spreadsheets.batchUpdate({
          spreadsheetId: this.hojaId,
          requestBody: {
            requests: ordenadas.map((fila) => ({
              deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: fila - 1, endIndex: fila } },
            })),
          },
        }),
      { reintentarSinRespuesta: false },
    )
  }

  /**
   * Crea la pestaña al final del archivo y le escribe los encabezados. Dos llamadas: el addSheet, que
   * ya devuelve el sheetId y el índice, y la escritura de la fila 1.
   *
   * No se reintenta a ciegas: crear una pestaña no es idempotente y Google rechaza el nombre repetido
   * con un 400, que es justamente lo que hay que dejar salir para no terminar con dos «APP LEADS».
   */
  async crearPestana(titulo: string, encabezados: string[]): Promise<PestanaDeHoja> {
    const respuesta = await this.conReintentos(
      `crear la pestaña «${titulo}»`,
      () =>
        this.api.spreadsheets.batchUpdate({
          spreadsheetId: this.hojaId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: titulo,
                    gridProperties: { rowCount: 1000, columnCount: Math.max(encabezados.length + 4, 26), frozenRowCount: 1 },
                  },
                },
              },
            ],
          },
          fields: 'replies(addSheet(properties(sheetId,title,index,gridProperties(rowCount,columnCount))))',
        }),
      { reintentarSinRespuesta: false },
    )
    const propiedades = respuesta.data.replies?.[0]?.addSheet?.properties
    if (!propiedades || propiedades.sheetId === null || propiedades.sheetId === undefined) {
      throw new ErrorDeNegocio(`Google no devolvió los datos de la pestaña «${titulo}» recién creada. Volvé a intentar la sincronización.`)
    }
    const pestana: PestanaDeHoja = {
      sheetId: propiedades.sheetId,
      titulo: propiedades.title ?? titulo,
      indice: propiedades.index ?? 0,
      filas: propiedades.gridProperties?.rowCount ?? 1000,
      columnas: propiedades.gridProperties?.columnCount ?? encabezados.length,
      oculta: false,
    }
    this.columnasPorSheetId.set(pestana.sheetId, pestana.columnas)

    await this.conReintentos(`escribir los encabezados de «${titulo}»`, () =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.hojaId,
        range: rangoDePestana(pestana.titulo, `A1:${letraColumna(encabezados.length - 1)}1`),
        valueInputOption: 'RAW',
        requestBody: { values: [encabezados] },
      }),
    )
    return pestana
  }

  async ocultarColumna(sheetId: number, indiceColumna: number): Promise<void> {
    await this.conReintentos('ocultar la columna _ID', () =>
      this.api.spreadsheets.batchUpdate({
        spreadsheetId: this.hojaId,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: { sheetId, dimension: 'COLUMNS', startIndex: indiceColumna, endIndex: indiceColumna + 1 },
                properties: { hiddenByUser: true },
                fields: 'hiddenByUser',
              },
            },
          ],
        },
      }),
    )
  }
}
