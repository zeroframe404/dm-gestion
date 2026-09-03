// Marketing → Redes: publicar en la Página de Facebook de la agencia y en su Instagram, y
// Administración → Redes sociales: vincular la cuenta de cada sucursal.
//
// Lo que hay que saber antes de tocar esto:
//
//   · La app de Meta la carga un SUPER_ADMIN en Administración → Redes sociales, y sigue viviendo en
//     config.json como cualquier credencial (eso no cambió). Sin eso, la pestaña abre igual y explica
//     qué falta.
//   · Lo que SÍ cambió: la Página vinculada y su token ya NO se guardan en esta computadora. Cada
//     sucursal tiene su propia cuenta, y el token vive cifrado en el servidor del VPS — de ahí en más
//     es el servidor el que habla con Meta (publicar, y en fases siguientes comentarios y mensajes).
//     Esta computadora sólo hace el login de Facebook (`redes/oauth.ts`, `redes/meta.ts`) y le manda
//     al servidor el token de la Página elegida, una única vez.
//   · Vincular una cuenta es sólo del SUPER_ADMIN. Publicar lo puede hacer cualquier rol con permiso
//     de editar Marketing, pero acotado a SU sucursal — salvo el SUPER_ADMIN, que puede elegir
//     cualquiera. El servidor vuelve a validar las dos cosas: acá sólo se evita el viaje si ya se sabe
//     que va a fallar.
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import {
  DESTINOS_DE_PUBLICACION,
  type ArchivoParaPublicar,
  type DestinoDePublicacion,
  type PanelDeRedes,
  type PedidoDePublicacion,
  type PublicacionDeRed,
  type SesionUsuario,
  type VinculacionPendiente,
  type VinculoConMeta,
} from '../../shared/tipos'
import type { ActorDeRedesVps, CuentaDeRedesVps, PublicacionDeRedVps } from '../vps/fuenteVps'
import { crearFuenteVps } from './sincronizacion'
import { limpiar } from '../importacion/normalizar'
import { tokenDesdeElCodigo, tokenDeLargaDuracion, paginasDelUsuario, type PaginaConToken } from '../redes/meta'
import { pedirCodigoDeMeta } from '../redes/oauth'
import { credencialesMeta, urlDeVueltaDeMeta } from './config'
import { ErrorDeNegocio } from './errores'
import { objeto, texto as validarTexto } from './validacion'

/**
 * Ocho megas. NO es el mismo tope que el de los adjuntos de un siniestro (25 MB): Instagram rechaza
 * más arriba de esto, y dejar pasar acá lo que Meta va a rechazar después es peor que no dejarlo
 * pasar, porque el error llega tarde y sin explicación.
 */
export const TAMANO_MAXIMO_DE_PUBLICACION = 8 * 1024 * 1024

const TIPOS_DE_IMAGEN: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

/** Instagram publica JPEG sin problemas; con PNG falla bastante seguido. */
const EXTENSIONES_DE_INSTAGRAM = ['.jpg', '.jpeg']

/**
 * Las Páginas que trajo el login, entre «vincular» y «elegir la página». No se guarda en disco a
 * propósito: sirve nada más que para leer la lista y elegir, y de ahí en adelante lo único que hace
 * falta —y lo único que se manda al servidor— es el token de la Página elegida.
 */
let vinculacionEnCurso: { sucursal: string; paginas: PaginaConToken[]; vence: number } | null = null

/** Cinco minutos: lo que tarda alguien en mirar la lista y elegir. */
const VALIDEZ_DE_LA_VINCULACION_MS = 5 * 60 * 1000

/** El último error, para poder explicarlo en la pantalla aunque no haya vínculo. */
let ultimoError: string | null = null

function actorVps(actor: SesionUsuario): ActorDeRedesVps {
  return { nombre: actor.nombre, rol: actor.rol, sucursal: actor.sucursal.nombre }
}

function exigirVps() {
  const vps = crearFuenteVps()
  if (!vps) {
    throw new ErrorDeNegocio('La base del VPS no está disponible en esta computadora: Redes sociales necesita conexión con el servidor.')
  }
  return vps
}

function aVinculo(cuenta: CuentaDeRedesVps): VinculoConMeta {
  return {
    sucursal: cuenta.sucursal,
    paginaId: cuenta.facebookPaginaId,
    paginaNombre: cuenta.facebookPaginaNombre,
    instagramId: cuenta.instagramId,
    instagramUsuario: cuenta.instagramUsuario,
    estado: cuenta.estado,
    puedePublicarEnInstagram: cuenta.puedePublicarEnInstagram,
    vinculadoPor: cuenta.vinculadoPor,
    vinculadoEn: cuenta.vinculadoEn,
  }
}

function aPublicacionDeRed(publicacion: PublicacionDeRedVps): PublicacionDeRed {
  return {
    id: publicacion.id,
    sucursal: publicacion.sucursal,
    destino: publicacion.destino,
    estado: publicacion.estado,
    texto: publicacion.texto,
    url: publicacion.url,
    error: publicacion.error,
    creadoPor: publicacion.creadoPor,
    publicadoEn: publicacion.publicadoEn,
    creadoEn: publicacion.creadoEn,
  }
}

// ---------------------------------------------------------------------------
// El estado
// ---------------------------------------------------------------------------

function exigirCredenciales(): { appId: string; appSecret: string } {
  const credenciales = credencialesMeta()
  if (!credenciales) {
    throw new ErrorDeNegocio(
      'Todavía no está cargada la app de Meta en esta computadora. Un superadministrador la carga en Administración → Redes sociales.',
    )
  }
  return credenciales
}

/**
 * Todo lo que la pestaña necesita. NUNCA lanza por falta de credenciales, de conexión con el VPS o de
 * vínculo: la pestaña tiene que abrir igual y explicar qué falta. Un empleado no entra a
 * Administración, así que el texto de la pantalla le dice a quién pedírselo en vez de mandarlo a una
 * pantalla que no puede abrir.
 */
export async function panelDeRedes(actor: SesionUsuario): Promise<PanelDeRedes> {
  const base: Omit<PanelDeRedes, 'cuentas' | 'ultimoError'> = {
    appConfigurada: credencialesMeta() !== null,
    puedeVincular: actor.rol === 'SUPER_ADMIN',
    sucursalPropia: actor.sucursal.nombre,
  }
  const vps = crearFuenteVps()
  if (!vps) {
    return { ...base, cuentas: [], ultimoError: 'La base del VPS no está disponible en esta computadora.' }
  }
  try {
    const cuentas = await vps.redesCuentas(actorVps(actor))
    return { ...base, cuentas: cuentas.map(aVinculo), ultimoError }
  } catch (error) {
    return { ...base, cuentas: [], ultimoError: error instanceof Error ? error.message : String(error) }
  }
}

/** El historial de publicaciones de una sucursal (la propia del actor, si no se pide otra). */
export async function publicaciones(actor: SesionUsuario, sucursal?: string): Promise<PublicacionDeRed[]> {
  try {
    const lista = await exigirVps().redesPublicaciones(actorVps(actor), sucursal)
    return lista.map(aPublicacionDeRed)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Vincular
// ---------------------------------------------------------------------------

function exigirSuperAdmin(actor: SesionUsuario): void {
  if (actor.rol !== 'SUPER_ADMIN') {
    throw new ErrorDeNegocio('Vincular o desvincular la cuenta de una sucursal es sólo del superadministrador.')
  }
}

/**
 * Abre el ingreso de Facebook y trae las Páginas que administra esa persona, para vincular una a la
 * sucursal indicada.
 *
 * Con una sola Página se vincula sola: preguntar «cuál de esta única opción» es una pregunta que no es
 * una pregunta. Con varias, la pantalla muestra la lista y `elegirPaginaVinculada` termina el trabajo.
 */
export async function vincularConMeta(padre: BrowserWindow | null, actor: SesionUsuario, sucursal: string): Promise<VinculacionPendiente> {
  exigirSuperAdmin(actor)
  const sucursalLimpia = limpiar(sucursal)
  if (!sucursalLimpia) throw new ErrorDeNegocio('Elegí para qué sucursal es.')
  const vps = exigirVps()
  const { appId, appSecret } = exigirCredenciales()

  // La misma dirección que muestra la pantalla y que viajó con el ajuste: si acá se usara otra, el
  // login de Facebook fallaría con un mensaje que no explica nada.
  const vuelta = urlDeVueltaDeMeta()
  const codigo = await pedirCodigoDeMeta(appId, vuelta, padre)
  const tokenCorto = await tokenDesdeElCodigo(appId, appSecret, vuelta, codigo)
  // Sin este paso el token de Página que sale después vencería a las dos horas.
  const tokenLargo = await tokenDeLargaDuracion(appId, appSecret, tokenCorto)
  const paginas = await paginasDelUsuario(tokenLargo)

  if (paginas.length === 0) {
    throw new ErrorDeNegocio(
      'Esa cuenta de Facebook no administra ninguna Página que la app pueda usar. Si la app todavía está en modo Desarrollo, sólo funciona para las personas que figuren como Administrador, Desarrollador o Tester en developers.facebook.com.',
    )
  }

  vinculacionEnCurso = { sucursal: sucursalLimpia, paginas, vence: Date.now() + VALIDEZ_DE_LA_VINCULACION_MS }

  if (paginas.length === 1) {
    return { sucursal: sucursalLimpia, paginas: [], vinculada: await guardarPagina(vps, sucursalLimpia, paginas[0]!, actor) }
  }
  return {
    sucursal: sucursalLimpia,
    paginas: paginas.map((pagina) => ({ id: pagina.id, nombre: pagina.nombre, instagramUsuario: pagina.instagramUsuario })),
    vinculada: null,
  }
}

async function guardarPagina(vps: ReturnType<typeof exigirVps>, sucursal: string, pagina: PaginaConToken, actor: SesionUsuario): Promise<VinculoConMeta> {
  const cuenta = await vps.redesVincular(actorVps(actor), {
    sucursal,
    facebookPaginaId: pagina.id,
    facebookPaginaNombre: pagina.nombre,
    instagramId: pagina.instagramId,
    instagramUsuario: pagina.instagramUsuario,
    paginaToken: pagina.token,
  })
  vinculacionEnCurso = null
  ultimoError = null
  return aVinculo(cuenta)
}

export async function elegirPaginaVinculada(paginaId: string, actor: SesionUsuario): Promise<VinculoConMeta> {
  exigirSuperAdmin(actor)
  const id = limpiar(paginaId)
  if (!vinculacionEnCurso || vinculacionEnCurso.vence < Date.now()) {
    vinculacionEnCurso = null
    throw new ErrorDeNegocio('Pasó demasiado tiempo desde que ingresaste en Facebook. Volvé a tocar «Vincular cuenta».')
  }
  const pagina = vinculacionEnCurso.paginas.find((candidata) => candidata.id === id)
  if (!pagina) throw new ErrorDeNegocio('Esa página no está entre las que trajo Facebook. Volvé a vincular.')
  return guardarPagina(exigirVps(), vinculacionEnCurso.sucursal, pagina, actor)
}

export async function desvincularDeMeta(actor: SesionUsuario, sucursal: string): Promise<void> {
  exigirSuperAdmin(actor)
  const vps = exigirVps()
  await vps.redesDesvincular(actorVps(actor), limpiar(sucursal))
  vinculacionEnCurso = null
  ultimoError = null
}

// ---------------------------------------------------------------------------
// El archivo a publicar
// ---------------------------------------------------------------------------

/**
 * Mira el archivo elegido y dice si sirve. Devuelve además la vista previa en data: URI, porque el
 * renderer no puede leer del disco y mostrar la foto antes de publicarla evita el posteo equivocado,
 * que en una red social no se puede deshacer sin que alguien lo haya visto.
 */
export async function revisarArchivoParaPublicar(ruta: string): Promise<ArchivoParaPublicar> {
  const elegida = limpiar(ruta)
  if (!elegida) throw new ErrorDeNegocio('No se eligió ningún archivo.')

  const extension = path.extname(elegida).toLowerCase()
  const tipo = TIPOS_DE_IMAGEN[extension]
  if (!tipo) {
    throw new ErrorDeNegocio(
      'Por ahora se publican fotos: .jpg o .png. Los videos y los reels necesitan otro camino y todavía no están.',
    )
  }

  let bytes: number
  try {
    bytes = statSync(elegida).size
  } catch {
    throw new ErrorDeNegocio('No se pudo leer ese archivo. Fijate si sigue estando donde estaba.')
  }
  if (bytes > TAMANO_MAXIMO_DE_PUBLICACION) {
    throw new ErrorDeNegocio(
      `La foto pesa ${(bytes / 1024 / 1024).toFixed(1)} MB y el máximo son ${TAMANO_MAXIMO_DE_PUBLICACION / 1024 / 1024} MB. Achicala y probá de nuevo.`,
    )
  }

  const contenido = await readFile(elegida)
  return {
    ruta: elegida,
    nombre: path.basename(elegida),
    tipo,
    bytes,
    vistaPrevia: `data:${tipo};base64,${contenido.toString('base64')}`,
    // No bloquea: Facebook publica el PNG sin problema y es Instagram el que se pone difícil.
    avisoDeInstagram: EXTENSIONES_DE_INSTAGRAM.includes(extension)
      ? ''
      : 'Instagram rechaza los PNG bastante seguido. Si es para Instagram, conviene guardarla como .jpg.',
  }
}

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

function validarPedido(pedido: unknown): PedidoDePublicacion {
  const p = objeto(pedido, 'El pedido de publicación')
  const destino = limpiar(p.destino) as DestinoDePublicacion
  if (!DESTINOS_DE_PUBLICACION.includes(destino)) throw new ErrorDeNegocio('Elegí Facebook o Instagram.')
  const cuerpo = typeof p.texto === 'string' ? p.texto.trim() : ''
  if (cuerpo.length > 2_200) throw new ErrorDeNegocio('El texto es muy largo: el máximo son 2.200 caracteres.')
  const ruta = typeof p.ruta === 'string' ? p.ruta.trim() : ''
  if (!cuerpo && !ruta) throw new ErrorDeNegocio('Escribí algo o elegí una foto: no se puede publicar nada vacío.')
  if (destino === 'INSTAGRAM' && !ruta) throw new ErrorDeNegocio('Instagram no publica sin imagen: elegí una foto.')
  // El texto se valida sólo por largo: lo escribe la agencia y va tal cual.
  if (cuerpo) validarTexto(cuerpo, 'El texto', 1, 2_200)
  return { sucursal: limpiar(p.sucursal), destino, texto: cuerpo, ruta }
}

/**
 * Publica (vía el servidor, que es quien tiene el token) y anota el resultado, salga bien o mal. Que
 * quede anotado lo fallido es el punto de la tabla: el error de Meta se pierde apenas se cierra la
 * pantalla, y sin él nadie puede averiguar qué pasó.
 */
export async function publicarEnRed(pedido: unknown, actor: SesionUsuario): Promise<PanelDeRedes> {
  const { sucursal, destino, texto: cuerpo, ruta } = validarPedido(pedido)
  const vps = exigirVps()
  const archivo = ruta ? await revisarArchivoParaPublicar(ruta) : null

  try {
    await vps.redesPublicar(actorVps(actor), {
      sucursal: sucursal || undefined,
      destino,
      texto: cuerpo,
      archivo: archivo ? { nombre: archivo.nombre, tipo: archivo.tipo, contenidoBase64: (await readFile(archivo.ruta)).toString('base64') } : null,
    })
    ultimoError = null
  } catch (error) {
    ultimoError = error instanceof Error ? error.message : String(error)
    throw error instanceof ErrorDeNegocio ? error : new ErrorDeNegocio(ultimoError)
  }

  return panelDeRedes(actor)
}

/** Cuántas publicaciones más admite Instagram hoy en la cuenta de esa sucursal (o la propia). null si no se pudo averiguar. */
export async function cuotaDeInstagram(actor: SesionUsuario, sucursal?: string): Promise<number | null> {
  try {
    return await exigirVps().redesCuotaInstagram(actorVps(actor), sucursal)
  } catch {
    return null
  }
}
