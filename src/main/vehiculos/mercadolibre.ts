// El adaptador de Mercado Libre, que es la API que la agencia contrató desde el panel de
// desarrolladores de Mercado Pago.
//
// Igual que el de InfoAuto: nada de lo de acá sale de este archivo, el servicio sólo ve la interfaz
// `ProveedorDeVehiculos`.
//
// Cómo autentica: el panel de Mercado Pago / Mercado Libre da un App ID (`client_id`) y una Clave
// secreta (`client_secret`), y con ese par se pide un token por `client_credentials` —el mismo
// endpoint `POST /oauth/token` que documenta Mercado Libre— que dura seis horas. También se acepta un
// Access Token pegado a mano (los `APP_USR-…` que muestra el panel en «Credenciales de producción»):
// es el camino más corto para probar, y cuando se vence se cae solo al par App ID + Clave secreta,
// que sí se renueva sin intervención. El token vive en memoria y nada de esto se guarda en la base.
//
// De dónde salen los datos: del recurso «valores más utilizados» del catálogo,
// `POST /catalog_domains/{dominio}/attributes/{atributo}/top_values`, que acepta `known_attributes`
// para encadenar. La jerarquía de Mercado Libre es marca (BRAND) → modelo (MODEL) → versión (TRIM), y
// coincide una a una con la que usa la agencia. La categoría —pick-up, SUV, furgón— sale de
// VEHICLE_BODY_TYPE del mismo modelo, que es el dato que la agencia no quiere que se elija a mano.
//
// Lo que Mercado Libre NO da: el recurso top_values existe sólo para el dominio CARS_AND_VANS (así lo
// dice su documentación), así que las motos quedan fuera y `tiposQueSirve` devuelve sólo AUTO. Tampoco
// hay años de fabricación ni precio de lista: el selector de años cae a la ventana de siempre y el
// precio queda en null, que es lo que ya hace el resto del programa cuando no lo sabe.
import { esFallaDeRed } from '../servicios/red'
import type { CategoriaDeVehiculo, TipoDeVehiculo } from '../../shared/tipos'
import { categoriaDeCatalogo } from './mapeo'
import { ErrorDeProveedor, type LineaCruda, type MarcaCruda, type ModeloCrudo, type ProveedorDeVehiculos, type PruebaDeProveedor } from './proveedor'

/** El sitio de Mercado Libre. Argentina es MLA y es el único que usa la agencia. */
const SITIO_POR_DEFECTO = 'MLA'

/**
 * El dominio del catálogo por tipo de vehículo. El de autos es el único que sirve `top_values`; el de
 * motos está acá igual para que un intento explícito falle con el motivo de Mercado Libre y no con un
 * «no implementado» nuestro.
 */
const SUFIJO_DE_DOMINIO: Record<TipoDeVehiculo, string> = {
  AUTO: 'CARS_AND_VANS',
  MOTO: 'MOTORCYCLES',
}

const URL_API = 'https://api.mercadolibre.com'

/** El máximo que admite `top_values`. Las marcas de un país entran holgadas. */
const TOPE_DE_VALORES = 1000

const ESPERA_MAXIMA_MS = 45_000

/** Se renueva diez minutos antes de que venza: un token que muere a mitad de la bajada la arruina. */
const MARGEN_DE_RENOVACION_MS = 10 * 60_000

export interface CredencialesMercadoLibre {
  /** El App ID de la aplicación creada en el panel (`client_id`). */
  appId: string
  /** La Clave secreta que el panel muestra una sola vez (`client_secret`). */
  claveSecreta: string
  /** Opcional: un Access Token `APP_USR-…` pegado a mano. Se usa mientras siga vivo. */
  accessToken?: string | null
  /** El sitio; MLA por defecto. */
  sitio?: string
  /** Sólo para las pruebas: apuntar a un servidor local en vez de a Mercado Libre. */
  urlBase?: string
}

interface ValorDeAtributo {
  id: string
  nombre: string
}

function esArreglo(valor: unknown): valor is Array<Record<string, unknown>> {
  return Array.isArray(valor)
}

/**
 * Un valor de atributo tal como lo devuelve `top_values`: `{ id, name, metric }`. El id es el
 * `value_id` que hay que volver a mandar en `known_attributes` para encadenar el siguiente nivel.
 */
function valorDe(crudo: Record<string, unknown>): ValorDeAtributo | null {
  const id = typeof crudo.id === 'string' ? crudo.id.trim() : typeof crudo.id === 'number' ? String(crudo.id) : ''
  const nombre = typeof crudo.name === 'string' ? crudo.name.trim() : ''
  if (!id || !nombre) return null
  return { id, nombre }
}

/** El mensaje que manda Mercado Libre cuando dice que no, para no tapar el motivo real. */
function mensajeDeMercadoLibre(cuerpo: unknown): string {
  if (!cuerpo || typeof cuerpo !== 'object') return ''
  const c = cuerpo as { message?: unknown; error?: unknown; error_description?: unknown }
  for (const campo of [c.error_description, c.message, c.error]) {
    if (typeof campo === 'string' && campo.trim()) return campo.trim()
  }
  return ''
}

export function crearProveedorMercadoLibre(credenciales: CredencialesMercadoLibre): ProveedorDeVehiculos {
  const base = (credenciales.urlBase ?? URL_API).replace(/\/+$/, '')
  const sitio = (credenciales.sitio ?? SITIO_POR_DEFECTO).trim().toUpperCase() || SITIO_POR_DEFECTO
  const appId = credenciales.appId.trim()
  const claveSecreta = credenciales.claveSecreta.trim()

  // El token pegado a mano se usa tal cual hasta que Mercado Libre lo rechace; el pedido por
  // client_credentials se guarda con su vencimiento. Los dos viven sólo en memoria.
  let tokenPegado = credenciales.accessToken?.trim() || null
  let tokenPedido: string | null = null
  let venceEn = 0

  // El nombre de cada modelo, para no tener que volver a pedirlo. El refresco pide los modelos de la
  // marca justo antes de pedir las versiones de cada uno, así que cuando hace falta ya está acá.
  const nombresDeModelo = new Map<string, string>()

  // Cuántas veces seguidas falló el pedido de la carrocería. Si la cuenta no tiene ese atributo, va a
  // fallar en LOS TRES MIL modelos: son tres mil pedidos de más en una bajada que ya tarda veinte
  // minutos. Después de unos cuantos seguidos se deja de preguntar. Un 500 suelto no cuenta: se
  // reinicia con el primero que sale bien.
  let fallasSeguidasDeCarroceria = 0
  const TOLERANCIA_DE_CARROCERIA = 5

  const dominio = (tipo: TipoDeVehiculo): string => `${sitio}-${SUFIJO_DE_DOMINIO[tipo]}`

  async function pedir(url: string, opciones: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...opciones, signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) })
    } catch (error) {
      if (esFallaDeRed(error)) {
        throw new ErrorDeProveedor('No se pudo conectar con Mercado Libre. Fijate si hay internet.', true)
      }
      throw new ErrorDeProveedor(error instanceof Error ? error.message : String(error), false)
    }
  }

  /**
   * Pide un token con App ID y Clave secreta. Es el flujo `client_credentials`: la aplicación entra
   * por sus propias credenciales y no en nombre de una persona, así que no hay pantalla de permiso ni
   * refresh token que administrar.
   */
  async function pedirToken(): Promise<string> {
    if (!appId || !claveSecreta) {
      throw new ErrorDeProveedor(
        'Falta el App ID o la Clave secreta de Mercado Libre. Se copian del panel de desarrolladores de Mercado Pago.',
        false,
      )
    }
    const cuerpo = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: claveSecreta,
    })
    const respuesta = await pedir(`${base}/oauth/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
    })
    const json = (await respuesta.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; error?: string; message?: string }
      | null

    if (!respuesta.ok) {
      // `invalid_client` es literalmente «el App ID o la Clave secreta están mal»: vale la pena
      // decirlo con esas palabras, porque es el error número uno al cargar las credenciales.
      if (json?.error === 'invalid_client') {
        throw new ErrorDeProveedor('Mercado Libre rechazó el App ID o la Clave secreta. Revisalos en Administración.', false)
      }
      const detalle = mensajeDeMercadoLibre(json)
      throw new ErrorDeProveedor(
        `Mercado Libre respondió ${respuesta.status} al pedir el permiso de acceso${detalle ? `: ${detalle}` : '.'}`,
        false,
      )
    }
    if (!json?.access_token) throw new ErrorDeProveedor('Mercado Libre no devolvió el permiso de acceso.', false)

    tokenPedido = json.access_token
    const duracion = typeof json.expires_in === 'number' && json.expires_in > 0 ? json.expires_in * 1000 : 6 * 60 * 60_000
    venceEn = Date.now() + Math.max(duracion - MARGEN_DE_RENOVACION_MS, 60_000)
    return tokenPedido
  }

  async function token(): Promise<string> {
    if (tokenPegado) return tokenPegado
    if (tokenPedido && Date.now() < venceEn) return tokenPedido
    return pedirToken()
  }

  /** Deja de usar el token que Mercado Libre acaba de rechazar, para que el reintento pida uno nuevo. */
  function descartarToken(): void {
    // El pegado a mano se descarta del todo: si venció, no vuelve solo. El pedido se renueva.
    tokenPegado = null
    tokenPedido = null
    venceEn = 0
  }

  /**
   * Los valores más usados de un atributo, encadenados por los que ya se eligieron.
   *
   * Un 401 se reintenta una vez con token nuevo: pasa cuando el Access Token pegado a mano venció, y
   * ahí el reintento ya sale por App ID + Clave secreta.
   */
  async function valores(
    tipo: TipoDeVehiculo,
    atributo: string,
    conocidos: Array<{ id: string; value_id: string }>,
  ): Promise<ValorDeAtributo[]> {
    const url = `${base}/catalog_domains/${encodeURIComponent(dominio(tipo))}/attributes/${encodeURIComponent(atributo)}/top_values?limit=${TOPE_DE_VALORES}`
    const enviar = async (): Promise<Response> =>
      pedir(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${await token()}`,
        },
        body: JSON.stringify(conocidos.length > 0 ? { known_attributes: conocidos } : {}),
      })

    let respuesta = await enviar()
    if (respuesta.status === 401) {
      descartarToken()
      respuesta = await enviar()
    }
    if (respuesta.status === 403 || respuesta.status === 404) {
      const detalle = mensajeDeMercadoLibre(await respuesta.json().catch(() => null))
      throw new ErrorDeProveedor(
        tipo === 'MOTO'
          ? 'Mercado Libre no publica el catálogo de motos por esta API: el recurso de valores más usados existe sólo para autos y camionetas.'
          : `Mercado Libre no dejó consultar el catálogo (${respuesta.status})${detalle ? `: ${detalle}` : '.'}`,
        false,
      )
    }
    if (respuesta.status === 429) {
      throw new ErrorDeProveedor('Mercado Libre está limitando los pedidos por cantidad. Probá de nuevo en un rato.', false)
    }
    if (!respuesta.ok) {
      const detalle = mensajeDeMercadoLibre(await respuesta.json().catch(() => null))
      throw new ErrorDeProveedor(`Mercado Libre respondió ${respuesta.status}${detalle ? `: ${detalle}` : '.'}`, false)
    }

    const cuerpo = (await respuesta.json().catch(() => null)) as unknown
    // La respuesta documentada es un arreglo pelado; algunas respuestas vienen envueltas en `values`.
    const adentro = (cuerpo as { values?: unknown } | null)?.values
    const crudos = esArreglo(cuerpo) ? cuerpo : esArreglo(adentro) ? adentro : []
    const salida: ValorDeAtributo[] = []
    for (const crudo of crudos) {
      const valor = valorDe(crudo)
      if (valor) salida.push(valor)
    }
    return salida
  }

  /**
   * La carrocería del modelo, que es de dónde sale la categoría.
   *
   * Va aparte y tolera el error: si Mercado Libre no la sabe para ese modelo, la categoría se deduce
   * del nombre con la tabla de palabras de siempre, y si tampoco alcanza queda en null. Una categoría
   * inventada llega hasta la póliza y ahí ya nadie sabe cuál revisar.
   */
  async function carroceria(tipo: TipoDeVehiculo, marcaId: string, modeloId: string): Promise<string | null> {
    if (fallasSeguidasDeCarroceria >= TOLERANCIA_DE_CARROCERIA) return null
    try {
      const encontradas = await valores(tipo, 'VEHICLE_BODY_TYPE', [
        { id: 'BRAND', value_id: marcaId },
        { id: 'MODEL', value_id: modeloId },
      ])
      fallasSeguidasDeCarroceria = 0
      return encontradas[0]?.nombre ?? null
    } catch (error) {
      // Una falla de red sí importa: es la misma que va a tirar el pedido siguiente y conviene que
      // corte la bajada acá y no después de mil modelos. No cuenta como falla de la carrocería.
      if (error instanceof ErrorDeProveedor && error.esDeRed) throw error
      fallasSeguidasDeCarroceria++
      return null
    }
  }

  return {
    nombre: 'Mercado Libre',

    // Sólo autos: el recurso de valores más usados existe únicamente para CARS_AND_VANS. Devolver
    // MOTO acá haría que «Refrescar todo» perdiera minutos para terminar en un 403.
    tiposQueSirve: () => ['AUTO'],

    async probar(): Promise<PruebaDeProveedor> {
      try {
        const marcas = await valores('AUTO', 'BRAND', [])
        return {
          ok: marcas.length > 0,
          detalle:
            marcas.length > 0
              ? `Conectado con Mercado Libre (${sitio}) con la aplicación ${appId || 'del Access Token cargado'}.`
              : 'Mercado Libre contestó, pero no devolvió ninguna marca. Revisá que la aplicación tenga habilitado el catálogo de vehículos.',
          marcasEncontradas: marcas.length,
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
      return (await valores(tipo, 'BRAND', [])).map((valor) => ({ id: valor.id, nombre: valor.nombre }))
    },

    async modelos(tipo: TipoDeVehiculo, marcaId: string): Promise<ModeloCrudo[]> {
      const encontrados = await valores(tipo, 'MODEL', [{ id: 'BRAND', value_id: marcaId }])
      for (const valor of encontrados) nombresDeModelo.set(`${tipo}:${valor.id}`, valor.nombre)
      return encontrados.map((valor) => ({ id: valor.id, marcaId, nombre: valor.nombre }))
    },

    async lineas(tipo: TipoDeVehiculo, marcaId: string, modeloId: string): Promise<LineaCruda[]> {
      const conocidos = [
        { id: 'BRAND', value_id: marcaId },
        { id: 'MODEL', value_id: modeloId },
      ]
      const versiones = await valores(tipo, 'TRIM', conocidos)
      const cruda = await carroceria(tipo, marcaId, modeloId)

      const armar = (id: string, nombre: string): LineaCruda => ({
        id,
        marcaId,
        modeloId,
        nombre,
        // Mercado Libre no publica los años de fabricación de la versión: el selector de años cae a
        // la ventana de siempre en vez de inventar un rango.
        anioDesde: null,
        anioHasta: null,
        categoriaCruda: cruda,
        categoria: categoriaDeCatalogo(tipo, cruda, nombre) as CategoriaDeVehiculo | null,
        precioLista: null,
      })

      // Un modelo sin versiones publicadas existe igual —pasa con los modelos viejos o muy nuevos— y
      // dejarlo sin ninguna línea sería dejar un desplegable que no se puede terminar de completar.
      // Se arma una sola línea con el nombre del modelo, que en la póliza se lee bien.
      if (versiones.length === 0) {
        const nombreDelModelo = nombresDeModelo.get(`${tipo}:${modeloId}`)
        return nombreDelModelo ? [armar(`modelo:${modeloId}`, nombreDelModelo)] : []
      }
      return versiones.map((version) => armar(version.id, version.nombre))
    },
  }
}
