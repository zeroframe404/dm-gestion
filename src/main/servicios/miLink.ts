// Mi link: la página pública de cada persona de la agencia (dmartinezseguros.com/p/<dirección>), las
// solicitudes y denuncias que le llegan desde ahí y sus métricas.
//
// TODO VIVE EN EL VPS (`/api/dmg/mi-link`). Esta computadora no guarda nada: ni la página, ni las
// solicitudes, ni una copia de las métricas. Es a propósito: la página la ve cualquiera en internet y
// las solicitudes entran a cualquier hora, con todas las PCs apagadas; el servidor es el único que
// está siempre. Por la misma razón no se toca la grilla ni los ajustes compartidos, y la versión normal
// (que no conoce Mi link) no se entera de nada de esto.
//
// QUIÉN ES EL DUEÑO. La clave de usuario (`claveDeUsuario`, el login en minúscula), la misma de los
// perfiles: el `id` de la base local no sirve, porque cada computadora numera a su manera. El rol viaja
// en cada pedido y con él el servidor decide si se puede mirar lo de otro (sólo ADMIN y SUPER_ADMIN):
// la pantalla esconde el filtro «Usuario», pero el que dice que no es el servidor.
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { app, shell } from 'electron'
import {
  ESTADOS_DE_DENUNCIA,
  ESTADOS_DE_SOLICITUD,
  PREFIJO_DE_MI_LINK,
  RANGOS_DE_METRICAS,
  URL_BASE_DE_MI_LINK,
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
} from '../../shared/miLink'
import { claveDeUsuario } from '../../shared/texto'
import type { SesionUsuario } from '../../shared/tipos'
import { ErrorDelServidorVps, type ActorDeMiLinkVps, type FuenteVps } from '../vps/fuenteVps'
import { ErrorDeNegocio, SinConexion } from './errores'
import { credencialesDelPuente, crearFuenteVps } from './sincronizacion'
import { esFallaDeRed } from './red'
import { listarUsuarios } from './usuarios'

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

function actorDeMiLink(actor: SesionUsuario): ActorDeMiLinkVps {
  return { clave: claveDeUsuario(actor.usuario), nombre: actor.nombre, rol: actor.rol }
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

function filtrosLimpios(crudo: unknown): FiltrosDeMiLink {
  const filtros = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>
  return {
    desde: textoDe(filtros.desde, 10),
    hasta: textoDe(filtros.hasta, 10),
    estado: textoDe(filtros.estado, 20),
    texto: textoDe(filtros.texto, 100),
    usuario: claveDeUsuario(filtros.usuario),
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

export async function miLinkPropio(actor: SesionUsuario): Promise<MiLink | null> {
  return conElServidor((vps) => vps.miLinkMia(actorDeMiLink(actor)))
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
  return conElServidor((vps) => vps.miLinkGuardar(actorDeMiLink(actor), limpios))
}

// --- Solicitudes y denuncias ----------------------------------------------------------------------

export async function solicitudesDeMiLink(actor: SesionUsuario, filtros: unknown): Promise<SolicitudDeMiLink[]> {
  return conElServidor((vps) => vps.miLinkSolicitudes(actorDeMiLink(actor), filtrosLimpios(filtros)))
}

export async function actualizarSolicitudDeMiLink(actor: SesionUsuario, id: unknown, cambios: unknown): Promise<SolicitudDeMiLink> {
  const limpios = cambiosDeSeguimiento<EstadoDeSolicitud>(cambios, ESTADOS_DE_SOLICITUD)
  return conElServidor((vps) => vps.miLinkActualizarSolicitud(actorDeMiLink(actor), idDe(id, 'la solicitud'), limpios))
}

export async function denunciasDeMiLink(actor: SesionUsuario, filtros: unknown): Promise<DenunciaDeMiLink[]> {
  return conElServidor((vps) => vps.miLinkDenuncias(actorDeMiLink(actor), filtrosLimpios(filtros)))
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
  return conElServidor((vps) => vps.miLinkMetricas(actorDeMiLink(actor), rango, claveDeUsuario(usuario)))
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
  const permitidos = new Set([new URL(URL_BASE_DE_MI_LINK).origin])
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
  // El servidor contesta siempre la dirección pública (dmartinezseguros.com/p/…), también el de pruebas
  // y el de la demo, que no la publican ahí: contra esos se abre la misma página en el servidor que la
  // tiene, que es el único que la puede mostrar.
  if (servidor && !servidor.startsWith(URL_BASE_DE_MI_LINK)) {
    const pedida = new URL(destino)
    if (pedida.origin === new URL(URL_BASE_DE_MI_LINK).origin) {
      destino = `${servidor.replace(/\/+$/, '')}${PREFIJO_DE_MI_LINK}${pedida.pathname.slice(PREFIJO_DE_MI_LINK.length)}${pedida.search}`
    }
  }
  await shell.openExternal(destino)
}

// --- El filtro «Usuario» --------------------------------------------------------------------------

/**
 * Los usuarios activos de esta computadora, para que un administrador elija de quién mirar. Salen de
 * la base local de usuarios (el espejo de la compartida), no del VPS: el servidor no puede leer la
 * base de usuarios —va cifrada— y la clave es la misma que usa para las páginas.
 */
export function usuariosDeMiLink(): Array<{ clave: string; nombre: string }> {
  return listarUsuarios()
    .filter((usuario) => usuario.activo)
    .map((usuario) => ({ clave: claveDeUsuario(usuario.usuario), nombre: usuario.nombre }))
    .sort((uno, otro) => uno.nombre.localeCompare(otro.nombre, 'es'))
}
