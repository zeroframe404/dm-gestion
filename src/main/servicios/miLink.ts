// Mi link: la página pública de cada persona de la agencia (<dominio de Mi link>/p/<dirección>), las
// solicitudes y denuncias que le llegan desde ahí y sus métricas.
//
// TODO VIVE EN EL VPS (`/api/dmg/mi-link`). Esta computadora no guarda nada: ni la página, ni las
// solicitudes, ni una copia de las métricas. Es a propósito: la página la ve cualquiera en internet y
// las solicitudes entran a cualquier hora, con todas las PCs apagadas; el servidor es el único que
// está siempre. Por la misma razón no se toca la grilla ni los ajustes compartidos, y la versión normal
// (que no conoce Mi link) no se entera de nada de esto.
//
// QUIÉN ES EL DUEÑO. La SUCURSAL: hay una página por sucursal (cada una tiene su WhatsApp y sus redes) y
// todos los que trabajan en ella comparten página, solicitudes y métricas. Al VPS le viaja como «clave
// de dueño» la de la sucursal (`claveDeMiLinkDeSucursal`), así que el servidor no cambia. Sólo el
// SUPER_ADMIN puede abrir otra sucursal o mirar todas: acá se le ignora el pedido a cualquier otro rol
// (el servidor además deja ver lo de otros a ADMIN, pero la app no se lo ofrece ni se lo pide).
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app, shell } from 'electron'
import {
  ESTADOS_DE_DENUNCIA,
  ESTADOS_DE_SOLICITUD,
  PREFIJO_DE_MI_LINK,
  RANGOS_DE_METRICAS,
  claveDeMiLinkDeSucursal,
  URL_BASE_DE_MI_LINK,
  urlBaseDeMiLink,
  urlDeMiLinkDelCanal,
  type ArchivoDeDenuncia,
  type CambiosDeMiLink,
  type DenunciaDeMiLink,
  type EstadoDeDenuncia,
  type EstadoDeSolicitud,
  type FiltrosDeMiLink,
  type MetricasDeMiLink,
  type MiLink,
  type RangoDeMetricas,
  type SolicitudDeMiLink,
  type SucursalesDeMiLink,
} from '../../shared/miLink'
import { SUCURSALES, sucursalCanonica } from '../../shared/sucursales'
import type { SesionUsuario } from '../../shared/tipos'
import { esDemo } from '../canal'
import { ErrorDelServidorVps, type ActorDeMiLinkVps, type FuenteVps } from '../vps/fuenteVps'
import { ErrorDeNegocio, SinConexion } from './errores'
import { credencialesDelPuente, crearFuenteVps } from './sincronizacion'
import { esFallaDeRed } from './red'

const SIN_SERVIDOR = 'Mi link necesita conexión con el servidor de la agencia.'

/**
 * El VPS contestó que la página cambió desde que se leyó (otra computadora la guardó en el medio). Es
 * un `ErrorDeNegocio` como cualquier otro, pero viaja marcado (`codigo: 'version-vieja'`, ver ipc.ts)
 * porque la pantalla tiene que hacer algo distinto que mostrar el cartel: volver a cargar lo último.
 * La dirección tomada por otro también es un 409 y NO es esto: ahí se corrige la dirección y listo,
 * recargar le borraría a la persona lo que venía escribiendo.
 */
export class PaginaDesactualizada extends ErrorDeNegocio {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'PaginaDesactualizada'
  }
}

/**
 * El VPS no contestó (no hay internet, o el servidor está caído). Viaja como `SinConexion` para que ipc.ts
 * lo marque `codigo: 'sin-conexion'`: el editor no muestra «Reintentar» sino que espera y vuelve a
 * guardar solo. El texto es otro que el de la base compartida: acá no hay nada local que esperar.
 */
class ServidorSinRespuesta extends SinConexion {
  constructor() {
    super()
    this.message = 'No se pudo hablar con el servidor de la agencia. Fijate si hay internet y probá de nuevo.'
    this.name = 'ServidorSinRespuesta'
  }
}

/**
 * La sucursal que cada superadministrador abrió (por id de usuario). Vive en memoria: al cerrar la app
 * vuelve a su propia sucursal, que es lo esperable.
 */
const sucursalElegida = new Map<number, string>()

function esSuperadministrador(actor: SesionUsuario): boolean {
  return actor.rol === 'SUPER_ADMIN'
}

/** La sucursal del usuario, escrita como la escribe el catálogo (y tal cual si no es ninguna de las cuatro). */
function sucursalPropia(actor: SesionUsuario): string {
  return sucursalCanonica(actor.sucursal.nombre) ?? actor.sucursal.nombre
}

/** La sucursal sobre la que se trabaja: la propia, o la que el superadministrador abrió. */
function sucursalDeTrabajo(actor: SesionUsuario): string {
  return (esSuperadministrador(actor) ? sucursalElegida.get(actor.id) : undefined) ?? sucursalPropia(actor)
}

function actorDeSucursal(actor: SesionUsuario, sucursal: string): ActorDeMiLinkVps {
  return { clave: claveDeMiLinkDeSucursal(sucursal), nombre: sucursal, rol: actor.rol }
}

function actorDeMiLink(actor: SesionUsuario): ActorDeMiLinkVps {
  return actorDeSucursal(actor, sucursalDeTrabajo(actor))
}

/**
 * Corre un pedido contra el VPS y deja los «no» del servidor con SU texto. `FuenteVps` envuelve los 4xx
 * en «El servidor del VPS rechazó la operación (…): …», que sirve para la grilla (ahí el que lee es
 * quien tiene que llamar al soporte); acá el servidor ya contesta en castellano y para la persona
 * («Esa dirección ya la tiene otra persona», «Solo un administrador puede ver…»), así que se muestra
 * eso solo.
 */
async function conElServidor<T>(hacer: (vps: FuenteVps) => Promise<T>): Promise<T> {
  const vps = crearFuenteVps()
  if (!vps) throw new ErrorDeNegocio(SIN_SERVIDOR)
  try {
    return await hacer(vps)
  } catch (error) {
    if (error instanceof ErrorDelServidorVps && [400, 403, 404, 409].includes(error.status)) {
      if (error.status === 409 && /otra computadora/i.test(error.detalle)) throw new PaginaDesactualizada(error.detalle)
      throw new ErrorDelServidorVps(error.detalle, error.status, error.detalle)
    }
    if (esFallaDeRed(error)) throw new ServidorSinRespuesta()
    throw error
  }
}

// --- Lo que llega de la pantalla ----------------------------------------------------------------
//
// El proceso principal no confía en la forma de lo que manda el renderer: se arma de nuevo con lo que
// sirve. El contenido de la página NO se valida acá: lo valida el servidor entero (es el mismo
// contrato, `shared/miLink.ts`) y contesta un 400 con el motivo, que llega tal cual a la pantalla.

function textoDe(valor: unknown, maximo = 200): string {
  return typeof valor === 'string' ? valor.trim().slice(0, maximo) : ''
}

/**
 * El filtro «Sucursal» que el servidor entiende: '' = la del actor (la de trabajo), 'todos', o la clave
 * de dueño de otra sucursal. Sólo el superadministrador puede pedir algo distinto de la suya: a cualquier
 * otro rol se le ignora el pedido y ve la propia.
 */
function duenoDelFiltro(actor: SesionUsuario, pedido: unknown): string {
  if (!esSuperadministrador(actor)) return ''
  const texto = textoDe(pedido, 60)
  if (!texto) return ''
  if (texto.toLowerCase() === 'todos') return 'todos'
  const sucursal = sucursalCanonica(texto)
  return sucursal ? claveDeMiLinkDeSucursal(sucursal) : ''
}

function filtrosLimpios(actor: SesionUsuario, crudo: unknown): FiltrosDeMiLink {
  const filtros = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>
  return {
    desde: textoDe(filtros.desde, 10),
    hasta: textoDe(filtros.hasta, 10),
    estado: textoDe(filtros.estado, 20),
    texto: textoDe(filtros.texto, 100),
    usuario: duenoDelFiltro(actor, filtros.usuario),
  }
}

function idDe(valor: unknown, que: string): string {
  const id = textoDe(valor, 64)
  if (!id) throw new ErrorDeNegocio(`Falta ${que}.`)
  return id
}

function cambiosDeSeguimiento<E extends string>(crudo: unknown, estados: readonly E[]): { estado?: E; nota?: string } {
  const datos = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>
  const cambios: { estado?: E; nota?: string } = {}
  if (datos.estado !== undefined) {
    if (!(estados as readonly unknown[]).includes(datos.estado)) throw new ErrorDeNegocio('Ese estado no existe.')
    cambios.estado = datos.estado as E
  }
  if (datos.nota !== undefined) {
    if (typeof datos.nota !== 'string') throw new ErrorDeNegocio('La nota tiene que ser un texto.')
    cambios.nota = datos.nota
  }
  return cambios
}

// --- La página ------------------------------------------------------------------------------------

/**
 * El dominio de Mi link de este programa: el de la agencia, o en la demo el de ejemplo
 * (`suagencia.com.ar`), que es el que se le muestra a otra agencia.
 */
function urlBaseDeEstePrograma(): string {
  return urlBaseDeMiLink(esDemo() ? 'demo' : 'estable')
}

/**
 * La página con la URL escrita con el dominio de este programa. El servidor (también el simulado de la
 * demo) la contesta siempre con el de la agencia; en la estable y la beta esto no cambia nada.
 */
function conElDominioDelCanal(link: MiLink): MiLink
function conElDominioDelCanal(link: MiLink | null): MiLink | null
function conElDominioDelCanal(link: MiLink | null): MiLink | null {
  if (!link || !esDemo()) return link
  return { ...link, url: urlDeMiLinkDelCanal(link.url, 'demo') }
}

export async function miLinkPropio(actor: SesionUsuario): Promise<MiLink | null> {
  return conElDominioDelCanal(await conElServidor((vps) => vps.miLinkMia(actorDeMiLink(actor))))
}

export async function direccionLibreDeMiLink(actor: SesionUsuario, direccion: unknown): Promise<{ libre: boolean; motivo: string | null }> {
  return conElServidor((vps) => vps.miLinkDireccionLibre(actorDeMiLink(actor), textoDe(direccion, 60).toLowerCase()))
}

export async function guardarMiLink(actor: SesionUsuario, crudo: unknown): Promise<MiLink> {
  const cambios = (crudo && typeof crudo === 'object' ? crudo : {}) as Partial<CambiosDeMiLink>
  const limpios: CambiosDeMiLink = {
    version: typeof cambios.version === 'number' ? cambios.version : null,
    direccion: textoDe(cambios.direccion, 60).toLowerCase(),
    publicada: cambios.publicada === true,
    contenido: cambios.contenido as CambiosDeMiLink['contenido'],
  }
  return conElDominioDelCanal(await conElServidor((vps) => vps.miLinkGuardar(actorDeMiLink(actor), limpios)))
}

// --- Solicitudes y denuncias ----------------------------------------------------------------------

export async function solicitudesDeMiLink(actor: SesionUsuario, filtros: unknown): Promise<SolicitudDeMiLink[]> {
  return conElServidor((vps) => vps.miLinkSolicitudes(actorDeMiLink(actor), filtrosLimpios(actor, filtros)))
}

export async function actualizarSolicitudDeMiLink(actor: SesionUsuario, id: unknown, cambios: unknown): Promise<SolicitudDeMiLink> {
  const limpios = cambiosDeSeguimiento<EstadoDeSolicitud>(cambios, ESTADOS_DE_SOLICITUD)
  return conElServidor((vps) => vps.miLinkActualizarSolicitud(actorDeMiLink(actor), idDe(id, 'la solicitud'), limpios))
}

export async function denunciasDeMiLink(actor: SesionUsuario, filtros: unknown): Promise<DenunciaDeMiLink[]> {
  return conElServidor((vps) => vps.miLinkDenuncias(actorDeMiLink(actor), filtrosLimpios(actor, filtros)))
}

export async function actualizarDenunciaDeMiLink(actor: SesionUsuario, id: unknown, cambios: unknown): Promise<DenunciaDeMiLink> {
  const limpios = cambiosDeSeguimiento<EstadoDeDenuncia>(cambios, ESTADOS_DE_DENUNCIA)
  return conElServidor((vps) => vps.miLinkActualizarDenuncia(actorDeMiLink(actor), idDe(id, 'la denuncia'), limpios))
}

/** La carpeta donde se bajan los adjuntos para abrirlos. La temporal: no es un archivo de la agencia. */
function carpetaTemporalDeMiLink(): string {
  // Fuera de Electron (las pruebas) no hay `app`: la temporal del sistema es la misma idea.
  const temporal = (app as typeof app | undefined)?.getPath?.('temp') ?? tmpdir()
  return path.join(temporal, 'dm-gestion-mi-link')
}

/**
 * Las únicas extensiones con que se escribe un adjunto en la PC, según el tipo que guardó el servidor.
 * La extensión decide qué hace Windows al abrirlo (`shell.openPath`), así que no puede salir del nombre:
 * ese lo eligió un desconocido y «foto.jpg.exe» declarado como image/jpeg se ejecutaría.
 */
const EXTENSION_POR_TIPO: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['application/pdf', '.pdf'],
])

/**
 * El nombre con el que se guarda en la temporal. Lo eligió un desconocido (es el nombre del archivo
 * que subió desde la página pública), así que se lo deja sin barras ni caracteres que Windows no
 * acepta, siempre con el id adelante (dos fotos «IMG_0001.jpg» de dos denuncias no se pisan) y con la
 * extensión del tipo, nunca la que traía. Un tipo fuera de la lista no se baja.
 */
export function nombreTemporalDeArchivo(archivo: Pick<ArchivoDeDenuncia, 'id' | 'nombre' | 'tipo'>): string {
  // Un Map y no un objeto: «constructor» o «toString» no tienen que dar una extensión.
  const extension = EXTENSION_POR_TIPO.get(archivo.tipo.toLowerCase())
  if (!extension) throw new ErrorDeNegocio('Ese adjunto no es una imagen ni un PDF: no se abre por seguridad.')
  const id = archivo.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || 'archivo'
  const base = path.basename(archivo.nombre.replace(/\\/g, '/'))
  const limpio = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '')
  // Fuera la extensión que traía (sólo la última: «foto.jpg.exe» queda «foto.jpg» y se le suma «.jpg»).
  const cuerpo = limpio.replace(/\.[^.]*$/, '').replace(/[.\s]+$/g, '').slice(0, 80)
  return `${id}-${cuerpo || 'archivo'}${extension}`
}

/** Baja el adjunto de una denuncia a la carpeta temporal y devuelve dónde quedó. */
export async function bajarArchivoDeMiLink(actor: SesionUsuario, crudo: unknown, carpeta = carpetaTemporalDeMiLink()): Promise<string> {
  const datos = (crudo && typeof crudo === 'object' ? crudo : {}) as Partial<ArchivoDeDenuncia>
  const id = idDe(datos.id, 'el archivo')
  const { contenido, tipo } = await conElServidor((vps) => vps.miLinkBajarArchivo(actorDeMiLink(actor), id))
  // El tipo es el que contesta el VPS, no el que manda el renderer: se calcula antes de escribir nada.
  const nombre = nombreTemporalDeArchivo({ id, nombre: textoDe(datos.nombre, 200) || 'archivo', tipo })
  await mkdir(carpeta, { recursive: true })
  const ruta = path.join(carpeta, nombre)
  await writeFile(ruta, contenido)
  return ruta
}

export async function abrirArchivoDeMiLink(actor: SesionUsuario, archivo: unknown): Promise<void> {
  const ruta = await bajarArchivoDeMiLink(actor, archivo)
  const error = await shell.openPath(ruta)
  if (error) throw new ErrorDeNegocio(`No se pudo abrir el archivo: ${error}`)
}

// --- Métricas -------------------------------------------------------------------------------------

export async function metricasDeMiLink(actor: SesionUsuario, dias: unknown, usuario: unknown): Promise<MetricasDeMiLink> {
  const rango: RangoDeMetricas = (RANGOS_DE_METRICAS as readonly unknown[]).includes(dias) ? (dias as RangoDeMetricas) : 30
  return conElServidor((vps) => vps.miLinkMetricas(actorDeMiLink(actor), rango, duenoDelFiltro(actor, usuario)))
}

// --- Abrir la página en el navegador --------------------------------------------------------------

const RUTA_DE_PAGINA = /^\/p\/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

/**
 * La dirección a abrir como dueño (`?vista=duenio`: la página no cuenta esa visita), o null si no es
 * una página de Mi link. Sólo se abren las del dominio de Mi link o las del servidor configurado (el
 * de pruebas, o el de la demo): este canal termina en `shell.openExternal`, y un renderer engañado no
 * tiene que poder abrir cualquier cosa con él.
 */
export function direccionParaAbrir(url: unknown, urlDelServidor: string | null): string | null {
  if (typeof url !== 'string') return null
  let pedida: URL
  try {
    pedida = new URL(url)
  } catch {
    return null
  }
  if (!RUTA_DE_PAGINA.test(pedida.pathname) || pedida.username || pedida.password) return null
  // El dominio de la agencia siempre (es el que contesta el servidor) y, en la demo, también el de
  // ejemplo, que es el que la pantalla tiene escrito.
  const permitidos = new Set([new URL(URL_BASE_DE_MI_LINK).origin, new URL(urlBaseDeEstePrograma()).origin])
  if (urlDelServidor) {
    try {
      permitidos.add(new URL(urlDelServidor).origin)
    } catch {
      // Una URL de servidor rota no habilita nada: quedan las del dominio de Mi link.
    }
  }
  if (!permitidos.has(pedida.origin)) return null
  const salida = new URL(pedida.origin + pedida.pathname)
  salida.searchParams.set('vista', 'duenio')
  return salida.toString()
}

export async function abrirMiLinkEnElNavegador(url: unknown): Promise<void> {
  const servidor = credencialesDelPuente()?.urlBase ?? null
  let destino = direccionParaAbrir(url, servidor)
  if (!destino) throw new ErrorDeNegocio('Esa no es una dirección de Mi link.')
  // El servidor contesta siempre la dirección pública (la del dominio de la agencia), también el de
  // pruebas y el de la demo, que no la publican ahí: contra esos se abre la misma página en el servidor
  // que la tiene, que es el único que la puede mostrar. En la demo la pantalla tiene escrita la del
  // dominio de ejemplo: esa tampoco existe en internet y se abre igual, en el servidor simulado.
  if (servidor && !servidor.startsWith(URL_BASE_DE_MI_LINK)) {
    const pedida = new URL(destino)
    const publicos = new Set([new URL(URL_BASE_DE_MI_LINK).origin, new URL(urlBaseDeEstePrograma()).origin])
    if (publicos.has(pedida.origin)) {
      destino = `${servidor.replace(/\/+$/, '')}${PREFIJO_DE_MI_LINK}${pedida.pathname.slice(PREFIJO_DE_MI_LINK.length)}${pedida.search}`
    }
  }
  // La demo nunca sale a internet: si no hay servidor simulado andando, la dirección sigue siendo la
  // pública (que en la demo además es de ejemplo) y no se abre.
  if (esDemo() && new URL(destino).origin !== new URL(servidor ?? 'http://127.0.0.1').origin) {
    throw new ErrorDeNegocio('En la demo la página se abre desde el servidor de demostración, y no está andando.')
  }
  await shell.openExternal(destino)
}

// --- Las sucursales -------------------------------------------------------------------------------

/**
 * Las sucursales para el filtro «Sucursal» del superadministrador. Se identifican por su nombre (es lo
 * que viaja en el filtro y lo que `duenoDelFiltro` vuelve a validar contra el catálogo).
 */
export function sucursalesParaElFiltro(actor: SesionUsuario): Array<{ clave: string; nombre: string }> {
  if (!esSuperadministrador(actor)) return []
  return SUCURSALES.map((nombre) => ({ clave: nombre, nombre }))
}

/**
 * Con qué sucursal se trabaja y, al superadministrador, la lista de las cuatro con su página (una
 * consulta al VPS por sucursal; los otros roles no hacen ninguna de más).
 */
export async function sucursalesDeMiLink(actor: SesionUsuario): Promise<SucursalesDeMiLink> {
  const elegida = sucursalDeTrabajo(actor)
  if (!esSuperadministrador(actor)) return { elegida, puedeElegir: false, sucursales: [] }
  const sucursales = await Promise.all(
    SUCURSALES.map(async (nombre) => ({
      nombre,
      link: conElDominioDelCanal(await conElServidor((vps) => vps.miLinkMia(actorDeSucursal(actor, nombre)))),
    })),
  )
  return { elegida, puedeElegir: true, sucursales }
}

/** El superadministrador abre otra sucursal. Cualquier otro rol no puede: tiene la suya y nada más. */
export async function elegirSucursalDeMiLink(actor: SesionUsuario, nombre: unknown): Promise<SucursalesDeMiLink> {
  if (!esSuperadministrador(actor)) throw new ErrorDeNegocio('Solo el superadministrador puede trabajar con otra sucursal.')
  const sucursal = sucursalCanonica(textoDe(nombre, 60))
  if (!sucursal) throw new ErrorDeNegocio('Esa sucursal no existe.')
  sucursalElegida.set(actor.id, sucursal)
  return sucursalesDeMiLink(actor)
}
