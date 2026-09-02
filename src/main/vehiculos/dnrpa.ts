// El adaptador de la DNRPA: la Tabla de Valuación de Automotores y Motovehículos que el organismo
// publica gratis, sin usuario ni clave. Es la fuente que ya usa el sitio de Seguros Daniel Martínez
// para armar los desplegables de marca/modelo de las pólizas (`scripts/generate-vehicle-catalog.mjs`
// de ese repositorio); acá se porta el mismo enfoque de lectura del PDF, pero como un proveedor más
// del catálogo, no como un archivo generado a mano.
//
// Por qué existe: InfoAuto cubre autos y motos pero es pago, y Mercado Libre es gratis pero sólo
// publica autos por esta API. La DNRPA es la única fuente gratuita de las tres que trae los dos tipos,
// y además es un registro oficial del Estado argentino: los vehículos que aparecen ya están filtrados
// al mercado argentino, sin que haga falta ningún filtro aparte.
//
// Cómo se llega a la tabla vigente: la DNRPA no tiene una API, publica un PDF cuyo nombre de archivo
// cambia con cada edición (`.../informacion/DD-MM-YYYY.pdf`). Como este programa no se reconstruye
// cada vez que sale una edición nueva —a diferencia del script del sitio, que un desarrollador corre a
// mano—, la URL se DETECTA sola leyendo el link «Tabla de Valuación Actual» de
// https://www.dnrpa.gov.ar/portal_dnrpa/valuaciones2.php. Si la detección falla (cambió la página, no
// hay red en ese momento) se cae a `URL_DE_RESPALDO`, la última edición conocida; y si eso tampoco
// alcanza, `urlFuente` en las credenciales deja que el superadministrador pegue la URL a mano sin
// esperar una versión nueva del programa.
//
// Cómo se lee el PDF: con posiciones de columna fijas —las mismas que ya probó el script del sitio—,
// leyendo con `pdfjs-dist` el texto de cada página y agrupándolo por fila (misma altura) y por rango
// de X (marca, submodelo, marcador A/M de auto o moto, columnas de año). El «modelo» de la agencia es
// la primera palabra del submodelo, igual que en el script de referencia: es lo que hace que «HILUX
// 2.8 SRV 4X4 D/C» caiga bajo el modelo «HILUX».
//
// El PDF entero se descarga y se parsea UNA sola vez por instancia del proveedor, no una vez por
// marca: es la diferencia entre una bajada de un archivo y miles de pedidos, como hacen InfoAuto y
// Mercado Libre. Si esa primera lectura falla, se descarta para que el próximo intento —el de motos,
// en un «Refrescar todo» que ya falló con autos— vuelva a probar en vez de quedar pegado al mismo
// error.
//
// Lo que la tabla NO da: ninguna carrocería explícita (`categoriaCruda` siempre null; la categoría
// sale de la tabla de palabras de `mapeo.ts` sobre marca y submodelo, igual que cuando a los otros
// proveedores les falta el dato) y ningún id numérico (se usa el texto tal cual, que ya es único por
// construcción). La tabla SÍ tiene valores de valuación fiscal por celda, pero acá no se leen: ningún
// cálculo de la aplicación usa el precio de lista del catálogo, así que `precioLista` queda en null
// igual que en Mercado Libre.
import { esFallaDeRed } from '../servicios/red'
import type { TipoDeVehiculo } from '../../shared/tipos'
import { categoriaDeCatalogo } from './mapeo'
import { ErrorDeProveedor, type LineaCruda, type MarcaCruda, type ModeloCrudo, type ProveedorDeVehiculos, type PruebaDeProveedor } from './proveedor'

const URL_DE_DESCUBRIMIENTO = 'https://www.dnrpa.gov.ar/portal_dnrpa/valuaciones2.php'

/** La última edición conocida, por si la detección automática deja de encontrar el enlace vigente. */
const URL_DE_RESPALDO = 'https://www.dnrpa.gov.ar/valuacion/informacion/01-08-2026.pdf'

const ESPERA_MAXIMA_MS = 60_000

export interface CredencialesDnrpa {
  /** Pisa la detección automática. Vacío o no puesto = detectar sola la tabla vigente. */
  urlFuente?: string | null
  /** Sólo para las pruebas: apuntar la página de descubrimiento a un servidor local. */
  urlDescubrimiento?: string
  /** Sólo para las pruebas: no tocar el sitio real de la DNRPA si la detección falla. */
  urlDeRespaldo?: string
}

// ---------------------------------------------------------------------------
// Las columnas de año
// ---------------------------------------------------------------------------
// Las posiciones en X son un dato de diseño del PDF y no cambian de edición a edición; lo que cambia
// es a qué año corresponde cada una. Por eso acá sólo se listan las 25 posiciones —tal como las probó
// el script del sitio— y el año de cada columna se calcula con el año de la edición vigente, en vez de
// tipearlo a mano cada vez que la DNRPA publica una tabla nueva.
const X_COLUMNAS_DE_ANIO = [
  231.3, 252.9, 274.9, 296.8, 318.8, 340.7, 362.7, 384.7, 406.6, 428.6, 450.6, 472.5, 494.5, 516.4, 538.4, 560.4, 582.3, 604.3,
  626.3, 648.2, 670.2, 692.1, 714.1, 736.1, 758,
]

export function columnasDeAnio(anioVigente: number): Array<{ x: number; anio: number }> {
  return X_COLUMNAS_DE_ANIO.map((x, indice) => ({ x, anio: anioVigente - indice }))
}

/** El año más viejo que la edición puede mostrar: tocar este borde es una limitación de la tabla. */
export function pisoDeLaTabla(anioVigente: number): number {
  return anioVigente - (X_COLUMNAS_DE_ANIO.length - 1)
}

const PATRON_DE_ARCHIVO = /informacion\/(\d{2})-(\d{2})-(\d{4})\.pdf/i

export function anioDeLaUrl(url: string): number | null {
  const coincidencia = PATRON_DE_ARCHIVO.exec(url)
  return coincidencia ? Number(coincidencia[3]) : null
}

// ---------------------------------------------------------------------------
// Cómo se ve la marca en la pantalla
// ---------------------------------------------------------------------------
// La tabla trae todo en mayúsculas. Estas dos funciones —portadas tal cual del script del sitio— la
// pasan a una forma más legible («Volkswagen» en vez de «VOLKSWAGEN»), con una lista de siglas que no
// se tocan porque no son una palabra («BMW», «KTM», «JAC»…).
const ETIQUETAS_DE_MARCA = new Map<string, string>([
  ['BMW', 'BMW'],
  ['BYD', 'BYD'],
  ['DS', 'DS'],
  ['DSFK', 'DSFK'],
  ['FCA', 'FCA'],
  ['JAC', 'JAC'],
  ['JMC', 'JMC'],
  ['KIA', 'Kia'],
  ['KTM', 'KTM'],
  ['MINI', 'MINI'],
  ['MG', 'MG'],
  ['RAM', 'RAM'],
  ['UAZ', 'UAZ'],
])

function palabraDeMarca(palabra: string): string {
  const forzada = ETIQUETAS_DE_MARCA.get(palabra)
  if (forzada) return forzada
  if (palabra.length <= 2) return palabra
  return `${palabra.charAt(0)}${palabra.slice(1).toLowerCase()}`
}

export function etiquetaDeMarca(marca: string): string {
  return marca
    .split(/([\s/-]+)/)
    .map((parte) => (/^[A-Z0-9]+$/.test(parte) ? palabraDeMarca(parte) : parte))
    .join('')
}

export function modeloBase(subModelo: string): string {
  return subModelo.split(' ')[0] || subModelo
}

// ---------------------------------------------------------------------------
// Leer una página del PDF
// ---------------------------------------------------------------------------

export interface ItemDeTexto {
  str: string
  x: number
  y: number
}

/** El texto de `getTextContent()`, quedándose sólo con lo que trae posición: alguna entrada rara no. */
export function itemsDeLaPagina(items: unknown[]): ItemDeTexto[] {
  const salida: ItemDeTexto[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const posible = item as { str?: unknown; transform?: unknown }
    const texto = typeof posible.str === 'string' ? posible.str.replace(/\s+/g, ' ').trim() : ''
    if (!texto) continue
    const transform = posible.transform
    if (!Array.isArray(transform) || transform.length < 6) continue
    const x = Number(transform[4])
    const y = Number(transform[5])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    salida.push({ str: texto, x, y })
  }
  return salida
}

export interface FilaDnrpa {
  tipo: TipoDeVehiculo
  marca: string
  subModelo: string
  anios: number[]
}

/**
 * Las filas de una página, agrupando por altura (misma fila) y leyendo cada columna por su rango de X:
 * el marcador A/M de tipo de vehículo, la marca, el submodelo y las columnas de año que tengan algo
 * escrito. Portado del script del sitio (`parsePageRows`), que ya probó estas posiciones contra la
 * tabla real.
 */
export function filasDeLaPagina(items: ItemDeTexto[], columnas: Array<{ x: number; anio: number }>): FilaDnrpa[] {
  const porAltura = new Map<number, ItemDeTexto[]>()
  for (const item of items) {
    const y = Math.round(item.y * 2) / 2
    const fila = porAltura.get(y)
    if (fila) fila.push(item)
    else porAltura.set(y, [item])
  }

  const filas: FilaDnrpa[] = []
  for (const [y, itemsDeLaFila] of porAltura) {
    if (y >= 533 || y <= 20) continue
    const ordenados = [...itemsDeLaFila].sort((a, b) => a.x - b.x)
    const marcador = ordenados.find((item) => item.x >= 45 && item.x <= 55 && /^(A|M)$/.test(item.str))?.str
    if (!marcador) continue

    const marca = ordenados
      .filter((item) => item.x >= 94 && item.x < 128)
      .map((item) => item.str)
      .join(' ')
    const subModelo = ordenados
      .filter((item) => item.x >= 128 && item.x < 178)
      .map((item) => item.str)
      .join(' ')
    if (!marca || !subModelo) continue

    const anios = Array.from(
      new Set(
        ordenados
          .filter((item) => item.x >= 220 && /^\d+$/.test(item.str))
          .map((item) => columnaMasCercana(item.x, columnas))
          .filter((anio): anio is number => anio !== null),
      ),
    )

    filas.push({ tipo: marcador === 'M' ? 'MOTO' : 'AUTO', marca: marca.toUpperCase(), subModelo, anios })
  }
  return filas
}

function columnaMasCercana(x: number, columnas: Array<{ x: number; anio: number }>): number | null {
  let mejor: { anio: number; distancia: number } | null = null
  for (const columna of columnas) {
    const distancia = Math.abs(columna.x - x)
    if (!mejor || distancia < mejor.distancia) mejor = { anio: columna.anio, distancia }
  }
  return mejor && mejor.distancia <= 12 ? mejor.anio : null
}

// ---------------------------------------------------------------------------
// El índice completo: marca → modelo → submodelo → años vistos
// ---------------------------------------------------------------------------

type IndicePorTipo = Record<TipoDeVehiculo, Map<string, Map<string, Map<string, Set<number>>>>>

interface CatalogoDnrpa {
  porTipo: IndicePorTipo
  anioVigente: number
}

async function descubrirUrl(paginaUrl: string, pedir: (url: string) => Promise<Response>): Promise<string> {
  const respuesta = await pedir(paginaUrl)
  if (!respuesta.ok) throw new Error(`La DNRPA respondió ${respuesta.status} al buscar la tabla vigente.`)
  const html = await respuesta.text()
  const coincidencia = /href="([^"]*informacion\/\d{2}-\d{2}-\d{4}\.pdf)"/i.exec(html)
  if (!coincidencia) throw new Error('No se encontró el enlace a la tabla vigente en la página de la DNRPA.')
  return new URL(coincidencia[1]!, paginaUrl).toString()
}

async function resolverUrl(credenciales: CredencialesDnrpa, pedir: (url: string) => Promise<Response>): Promise<string> {
  const pisada = credenciales.urlFuente?.trim()
  if (pisada) return pisada
  try {
    return await descubrirUrl(credenciales.urlDescubrimiento ?? URL_DE_DESCUBRIMIENTO, pedir)
  } catch {
    // No se pudo detectar sola: se sigue con la última edición conocida en vez de cortar acá. Si
    // tampoco hay red, el pedido del PDF de abajo va a fallar con el motivo real.
    return credenciales.urlDeRespaldo ?? URL_DE_RESPALDO
  }
}

async function construirCatalogo(credenciales: CredencialesDnrpa): Promise<CatalogoDnrpa> {
  async function pedir(url: string): Promise<Response> {
    try {
      return await fetch(url, { signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) })
    } catch (error) {
      if (esFallaDeRed(error)) throw new ErrorDeProveedor('No se pudo conectar con la DNRPA. Fijate si hay internet.', true)
      throw new ErrorDeProveedor(error instanceof Error ? error.message : String(error), false)
    }
  }

  const url = await resolverUrl(credenciales, pedir)
  const anioVigente = anioDeLaUrl(url) ?? new Date().getFullYear()
  const columnas = columnasDeAnio(anioVigente)

  const respuesta = await pedir(url)
  if (!respuesta.ok) throw new ErrorDeProveedor(`La DNRPA respondió ${respuesta.status} al bajar la tabla de valuación.`, false)
  const datos = new Uint8Array(await respuesta.arrayBuffer())

  // pdfjs-dist es ESM puro; el proceso principal compila a CommonJS, así que hace falta el import()
  // dinámico acá adentro. La build «legacy» corre en Node sin necesitar un worker aparte.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const documento = await getDocument({ data: datos }).promise

  const porTipo: IndicePorTipo = { AUTO: new Map(), MOTO: new Map() }
  for (let pagina = 1; pagina <= documento.numPages; pagina++) {
    const hoja = await documento.getPage(pagina)
    const contenido = await hoja.getTextContent()
    for (const fila of filasDeLaPagina(itemsDeLaPagina(contenido.items), columnas)) {
      const modelo = modeloBase(fila.subModelo)
      if (!fila.marca || !modelo || !fila.subModelo) continue

      const porMarca = porTipo[fila.tipo]
      const porModelo = porMarca.get(fila.marca) ?? new Map<string, Map<string, Set<number>>>()
      porMarca.set(fila.marca, porModelo)
      const porSubModelo = porModelo.get(modelo) ?? new Map<string, Set<number>>()
      porModelo.set(modelo, porSubModelo)
      const anios = porSubModelo.get(fila.subModelo) ?? new Set<number>()
      porSubModelo.set(fila.subModelo, anios)
      for (const anio of fila.anios) anios.add(anio)
    }
  }

  return { porTipo, anioVigente }
}

export function crearProveedorDnrpa(credenciales: CredencialesDnrpa = {}): ProveedorDeVehiculos {
  // Se baja y se parsea el PDF una sola vez por instancia, no una vez por marca: «Refrescar todo» pide
  // marcas, modelos y líneas de a miles de combinaciones, y acá todas esas llamadas comparten la misma
  // lectura. Si la primera lectura falla se descarta la promesa, para que el intento siguiente —autos
  // y motos comparten la misma instancia dentro de un mismo refresco— vuelva a probar en vez de quedar
  // pegado al mismo error.
  let promesa: Promise<CatalogoDnrpa> | null = null
  function catalogo(): Promise<CatalogoDnrpa> {
    if (!promesa) {
      promesa = construirCatalogo(credenciales).catch((error: unknown) => {
        promesa = null
        throw error
      })
    }
    return promesa
  }

  return {
    nombre: 'DNRPA',

    // El registro de la DNRPA alcanza a autos y motos por igual: es la única fuente gratuita de las
    // tres que puede reemplazar a InfoAuto entero.
    tiposQueSirve: () => ['AUTO', 'MOTO'],

    async probar(): Promise<PruebaDeProveedor> {
      try {
        const { porTipo } = await catalogo()
        const autos = porTipo.AUTO.size
        const motos = porTipo.MOTO.size
        return {
          ok: autos + motos > 0,
          detalle:
            autos + motos > 0
              ? `Conectado con la DNRPA: ${autos} marcas de auto y ${motos} de moto en la tabla vigente.`
              : 'La DNRPA contestó pero no se pudo leer ninguna fila de la tabla vigente. Puede haber cambiado el formato del PDF.',
          marcasEncontradas: autos + motos,
        }
      } catch (error) {
        return {
          ok: false,
          detalle: error instanceof Error ? error.message : String(error),
          marcasEncontradas: 0,
        }
      }
    },

    async marcas(tipo: TipoDeVehiculo): Promise<MarcaCruda[]> {
      const { porTipo } = await catalogo()
      return Array.from(porTipo[tipo].keys()).map((marca) => ({ id: marca, nombre: etiquetaDeMarca(marca) }))
    },

    async modelos(tipo: TipoDeVehiculo, marcaId: string): Promise<ModeloCrudo[]> {
      const { porTipo } = await catalogo()
      const porModelo = porTipo[tipo].get(marcaId)
      if (!porModelo) return []
      return Array.from(porModelo.keys()).map((modelo) => ({ id: modelo, marcaId, nombre: modelo }))
    },

    async lineas(tipo: TipoDeVehiculo, marcaId: string, modeloId: string): Promise<LineaCruda[]> {
      const { porTipo, anioVigente } = await catalogo()
      const porSubModelo = porTipo[tipo].get(marcaId)?.get(modeloId)
      if (!porSubModelo) return []
      const piso = pisoDeLaTabla(anioVigente)

      const salida: LineaCruda[] = []
      for (const [subModelo, aniosVistos] of porSubModelo) {
        const anios = Array.from(aniosVistos).sort((a, b) => a - b)
        const minimo = anios.length > 0 ? anios[0]! : null
        const maximo = anios.length > 0 ? anios[anios.length - 1]! : null
        salida.push({
          id: subModelo,
          marcaId,
          modeloId,
          nombre: subModelo,
          // Tocar el borde de la ventana de columnas no es evidencia de que ahí empezó a fabricarse:
          // sólo se fija un piso cuando el mínimo detectado queda estrictamente adentro de la tabla.
          anioDesde: minimo !== null && minimo > piso ? minimo : null,
          anioHasta: maximo,
          // La tabla no trae una carrocería aparte: la categoría sale de la tabla de palabras sobre
          // marca y submodelo, igual que cuando a otro proveedor le falta el dato.
          categoriaCruda: null,
          categoria: categoriaDeCatalogo(tipo, null, subModelo),
          precioLista: null,
        })
      }
      return salida
    },
  }
}
