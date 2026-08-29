// El adaptador de InfoAuto, que es el catálogo que usan las aseguradoras en Argentina.
//
// Nada de lo de acá sale de este archivo: el servicio sólo ve la interfaz `ProveedorDeVehiculos`.
//
// Cómo autentica: se manda usuario y clave con Basic a /auth/login y devuelve un `access_token` que
// dura alrededor de una hora y un `refresh_token` que dura veinticuatro. El de acceso vive en memoria
// y el de refresco se guarda en config.json, para no tener que volver a mandar la clave en cada
// arranque del programa.
//
// La jerarquía de InfoAuto es marca → grupo → modelo. Se mapea así: la marca es la marca, el «grupo»
// es lo que la agencia llama modelo (Corolla, Hilux) y el «modelo» de InfoAuto —con su código CODIA,
// que es el que usan las compañías— es lo que la agencia llama línea (Corolla 2.0 XEI CVT). Es el
// mapeo natural y además el único que hace que «línea» sea un dato distinto de «modelo».
import { esFallaDeRed } from '../servicios/red'
import type { CategoriaDeVehiculo, TipoDeVehiculo } from '../../shared/tipos'
import { anioDesdeHasta, categoriaCrudaDe, categoriaDeCatalogo, descripcionDe, primerTextoDe } from './mapeo'
import { ErrorDeProveedor, type LineaCruda, type MarcaCruda, type ModeloCrudo, type ProveedorDeVehiculos, type PruebaDeProveedor } from './proveedor'

/** Las dos mitades del catálogo. Se pueden contratar por separado. */
const URL_POR_TIPO: Record<TipoDeVehiculo, string> = {
  AUTO: 'https://api.infoauto.com.ar/cars/pub',
  MOTO: 'https://api.infoauto.com.ar/motos/pub',
}

/** Cuántos registros por página pide. InfoAuto permite hasta 100. */
const POR_PAGINA = 100

/** Más que esto y algo está mal: es un freno contra una paginación que no termina nunca. */
const PAGINAS_MAXIMAS = 500

const ESPERA_MAXIMA_MS = 45_000

export interface CredencialesInfoauto {
  usuario: string
  clave: string
  refreshToken: string | null
  /** Sólo para las pruebas: apuntar a un servidor local en vez de a InfoAuto. */
  urlAutos?: string
  urlMotos?: string
}

function esArreglo(valor: unknown): valor is Array<Record<string, unknown>> {
  return Array.isArray(valor)
}

/** El id de un registro, que InfoAuto manda como número. */
function idDe(crudo: Record<string, unknown>): string {
  const valor = crudo.id ?? crudo.codia ?? crudo.brand_id ?? crudo.group_id
  if (typeof valor === 'number') return String(valor)
  if (typeof valor === 'string' && valor.trim()) return valor.trim()
  return ''
}

function nombreDe(crudo: Record<string, unknown>): string {
  return primerTextoDe(crudo, ['name', 'nombre', 'description', 'descripcion']) || idDe(crudo)
}

export function crearProveedorInfoauto(
  credenciales: CredencialesInfoauto,
  alGuardarRefresh: (token: string | null) => void,
): ProveedorDeVehiculos {
  // El de acceso vive sólo en memoria: dura una hora y volver a pedirlo cuesta una llamada.
  let tokenDeAcceso: string | null = null
  let venceEn = 0
  let refresco = credenciales.refreshToken

  const base = (tipo: TipoDeVehiculo): string =>
    (tipo === 'AUTO' ? credenciales.urlAutos : credenciales.urlMotos) ?? URL_POR_TIPO[tipo]

  async function pedir(url: string, opciones: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...opciones, signal: AbortSignal.timeout(ESPERA_MAXIMA_MS) })
    } catch (error) {
      if (esFallaDeRed(error)) throw new ErrorDeProveedor('No se pudo conectar con el catálogo de vehículos. Fijate si hay internet.', true)
      throw new ErrorDeProveedor(error instanceof Error ? error.message : String(error), false)
    }
  }

  /** Entra con usuario y clave. Devuelve los dos tokens; el de refresco se guarda para la próxima. */
  async function ingresar(): Promise<void> {
    const autorizacion = Buffer.from(`${credenciales.usuario}:${credenciales.clave}`).toString('base64')
    const respuesta = await pedir(`${base('AUTO')}/auth/login`, {
      method: 'POST',
      headers: { authorization: `Basic ${autorizacion}` },
    })
    if (respuesta.status === 401) {
      throw new ErrorDeProveedor('El catálogo de vehículos rechazó el usuario o la clave. Revisalos en Administración.', false)
    }
    if (!respuesta.ok) {
      throw new ErrorDeProveedor(`El catálogo de vehículos respondió ${respuesta.status} al ingresar.`, false)
    }
    const cuerpo = (await respuesta.json()) as { access_token?: string; refresh_token?: string }
    if (!cuerpo?.access_token) throw new ErrorDeProveedor('El catálogo de vehículos no devolvió el permiso de acceso.', false)
    tokenDeAcceso = cuerpo.access_token
    // Se renueva a los cincuenta minutos aunque diga una hora: un token que vence a mitad de una
    // bajada de setenta mil filas obliga a empezar de nuevo.
    venceEn = Date.now() + 50 * 60_000
    if (cuerpo.refresh_token) {
      refresco = cuerpo.refresh_token
      alGuardarRefresh(cuerpo.refresh_token)
    }
  }

  /** Con el token de refresco, sin volver a mandar la clave. */
  async function refrescar(): Promise<boolean> {
    if (!refresco) return false
    const respuesta = await pedir(`${base('AUTO')}/auth/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${refresco}` },
    })
    if (!respuesta.ok) {
      // El de refresco dura un día: vencido, se vuelve a entrar con la clave y no es un error.
      refresco = null
      alGuardarRefresh(null)
      return false
    }
    const cuerpo = (await respuesta.json()) as { access_token?: string }
    if (!cuerpo?.access_token) return false
    tokenDeAcceso = cuerpo.access_token
    venceEn = Date.now() + 50 * 60_000
    return true
  }

  async function token(): Promise<string> {
    if (tokenDeAcceso && Date.now() < venceEn) return tokenDeAcceso
    if (!(await refrescar())) await ingresar()
    if (!tokenDeAcceso) throw new ErrorDeProveedor('No se pudo entrar al catálogo de vehículos.', false)
    return tokenDeAcceso
  }

  /** Una página. Reintenta una vez si el token se cayó a mitad de camino. */
  async function traer(tipo: TipoDeVehiculo, ruta: string, pagina: number): Promise<Array<Record<string, unknown>>> {
    const url = `${base(tipo)}${ruta}${ruta.includes('?') ? '&' : '?'}page=${pagina}&page_size=${POR_PAGINA}`
    let respuesta = await pedir(url, { headers: { authorization: `Bearer ${await token()}` } })
    if (respuesta.status === 401) {
      tokenDeAcceso = null
      respuesta = await pedir(url, { headers: { authorization: `Bearer ${await token()}` } })
    }
    if (respuesta.status === 403) {
      throw new ErrorDeProveedor(
        `La cuenta del catálogo no tiene contratada la parte de ${tipo === 'AUTO' ? 'autos' : 'motos'}.`,
        false,
      )
    }
    if (!respuesta.ok) throw new ErrorDeProveedor(`El catálogo de vehículos respondió ${respuesta.status}.`, false)
    const cuerpo = (await respuesta.json()) as unknown
    if (esArreglo(cuerpo)) return cuerpo
    // Algunas respuestas vienen envueltas: { data: [...] }.
    const adentro = (cuerpo as { data?: unknown } | null)?.data
    return esArreglo(adentro) ? adentro : []
  }

  /** Todas las páginas de una ruta, hasta que venga una corta o vacía. */
  async function traerTodo(tipo: TipoDeVehiculo, ruta: string): Promise<Array<Record<string, unknown>>> {
    const todas: Array<Record<string, unknown>> = []
    for (let pagina = 1; pagina <= PAGINAS_MAXIMAS; pagina++) {
      const lote = await traer(tipo, ruta, pagina)
      todas.push(...lote)
      if (lote.length < POR_PAGINA) break
    }
    return todas
  }

  return {
    nombre: 'InfoAuto',

    tiposQueSirve: () => ['AUTO', 'MOTO'],

    async probar(): Promise<PruebaDeProveedor> {
      try {
        const primeras = await traer('AUTO', '/brands/', 1)
        return {
          ok: true,
          detalle: `Conectado con InfoAuto como «${credenciales.usuario}».`,
          marcasEncontradas: primeras.length,
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
      return (await traerTodo(tipo, '/brands/'))
        .map((crudo) => ({ id: idDe(crudo), nombre: nombreDe(crudo) }))
        .filter((marca) => marca.id !== '')
    },

    async modelos(tipo: TipoDeVehiculo, marcaId: string): Promise<ModeloCrudo[]> {
      return (await traerTodo(tipo, `/brands/${encodeURIComponent(marcaId)}/groups/`))
        .map((crudo) => ({ id: idDe(crudo), marcaId, nombre: nombreDe(crudo) }))
        .filter((modelo) => modelo.id !== '')
    },

    async lineas(tipo: TipoDeVehiculo, marcaId: string, modeloId: string): Promise<LineaCruda[]> {
      const crudas = await traerTodo(tipo, `/brands/${encodeURIComponent(marcaId)}/groups/${encodeURIComponent(modeloId)}/models/`)
      return crudas
        .map((crudo): LineaCruda => {
          const descripcion = descripcionDe(crudo)
          const cruda = categoriaCrudaDe(crudo)
          const anios = anioDesdeHasta(crudo)
          const precio = crudo.list_price
          return {
            id: idDe(crudo),
            marcaId,
            modeloId,
            nombre: descripcion || idDe(crudo),
            anioDesde: anios.desde,
            anioHasta: anios.hasta,
            categoriaCruda: cruda,
            categoria: categoriaDeCatalogo(tipo, cruda, descripcion) as CategoriaDeVehiculo | null,
            precioLista: typeof precio === 'number' && Number.isFinite(precio) ? Math.trunc(precio) : null,
          }
        })
        .filter((linea) => linea.id !== '')
    },
  }
}
