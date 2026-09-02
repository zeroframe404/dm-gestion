// Marketing → Redes: publicar en la Página de Facebook de la agencia y en su Instagram.
//
// (Ojo con el nombre: `red.ts`, en singular, es otra cosa —clasifica errores de conexión—. El plural
// es a propósito y las dos van a seguir existiendo.)
//
// Lo que hay que saber antes de tocar esto:
//
//   · La app de Meta la carga un administrador en Administración → Redes sociales, y vive en
//     config.json como cualquier credencial. Sin eso, la pestaña abre igual y explica qué falta.
//   · El vínculo (la Página elegida y su token) va cifrado en redes.bin, no en la base.
//   · Un token de Página NO VENCE, pero se cae si cambian la contraseña de Facebook, sacan la app o
//     esa persona pierde el rol de administrador de la Página. Meta contesta con el código 190 y ahí
//     la salida es volver a vincular, no reintentar.
//   · Instagram NO acepta el archivo: sólo toma una URL que Meta pueda descargar. Por eso la foto se
//     sube primero a la Página SIN publicar y se usa la dirección del CDN de esa foto. Es la parte más
//     frágil de todo esto y está explicada en `meta.ts`.
//   · Video y reels quedan afuera de esta versión, y la pantalla lo dice: un reel necesita esperar a
//     que Meta lo procese (minutos) y un video en Facebook, subida en tres pasos.
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import {
  DESTINOS_DE_PUBLICACION,
  NOMBRE_DESTINO,
  type ArchivoParaPublicar,
  type DestinoDePublicacion,
  type PanelDeRedes,
  type PedidoDePublicacion,
  type PublicacionDeRed,
  type SesionUsuario,
  type VinculacionPendiente,
  type VinculoConMeta,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, limpiar } from '../importacion/normalizar'
import { almacenDeRedes } from '../redes/almacen'
import {
  ErrorDeMetaApi,
  borrarFotoDeLaPagina,
  cuotaDeInstagram,
  esTokenRechazado,
  paginasDelUsuario,
  publicarEnInstagram,
  publicarTextoEnLaPagina,
  subirFotoALaPagina,
  tokenDeLargaDuracion,
  tokenDesdeElCodigo,
  urlPublicaDeLaFoto,
} from '../redes/meta'
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

/** Cuántas publicaciones se muestran en el historial de la pantalla. */
const TOPE_DE_HISTORIAL = 30

/**
 * El token de usuario de larga duración entre «vincular» y «elegir la página». No se guarda en disco a
 * propósito: sirve nada más que para leer la lista de Páginas, y de ahí en adelante lo único que hace
 * falta —y lo único que se guarda— es el token de la Página elegida.
 */
let vinculacionEnCurso: { token: string; vence: number; paginas: Awaited<ReturnType<typeof paginasDelUsuario>> } | null = null

/** Cinco minutos: lo que tarda alguien en mirar la lista y elegir. */
const VALIDEZ_DE_LA_VINCULACION_MS = 5 * 60 * 1000

/** El último error de Meta, para poder explicar por qué dejó de andar. */
let ultimoError: string | null = null

// ---------------------------------------------------------------------------
// El estado
// ---------------------------------------------------------------------------

function aVinculo(): VinculoConMeta | null {
  const guardado = almacenDeRedes()?.leer()
  if (!guardado) return null
  return {
    paginaId: guardado.paginaId,
    paginaNombre: guardado.paginaNombre,
    instagramUsuario: guardado.instagramUsuario,
    vinculadoPor: guardado.vinculadoPor,
    vinculadoEn: guardado.vinculadoEn,
  }
}

/**
 * Todo lo que la pestaña necesita. NUNCA lanza por falta de credenciales o de vínculo: la pestaña
 * tiene que abrir igual y explicar qué falta. Un empleado no entra a Administración, así que el texto
 * de la pantalla le dice a quién pedírselo en vez de mandarlo a una pantalla que no puede abrir.
 */
export async function panelDeRedes(): Promise<PanelDeRedes> {
  const guardado = almacenDeRedes()?.leer() ?? null
  const cuota = guardado?.instagramId ? await cuotaDeInstagram(guardado.instagramId, guardado.paginaToken) : null
  return {
    appConfigurada: credencialesMeta() !== null,
    puedeGuardar: almacenDeRedes()?.puedeCifrar() ?? false,
    vinculo: aVinculo(),
    puedePublicarEnInstagram: Boolean(guardado?.instagramId),
    cuotaDeInstagram: cuota,
    ultimoError,
    historial: historialDePublicaciones(),
  }
}

// ---------------------------------------------------------------------------
// Vincular
// ---------------------------------------------------------------------------

function exigirCredenciales(): { appId: string; appSecret: string } {
  const credenciales = credencialesMeta()
  if (!credenciales) {
    throw new ErrorDeNegocio(
      'Todavía no está cargada la app de Meta en esta computadora. Un administrador la carga en Administración → Redes sociales.',
    )
  }
  return credenciales
}

/**
 * Abre el ingreso de Facebook y trae las Páginas que administra esa persona.
 *
 * Con una sola Página se vincula sola: preguntar «cuál de esta única opción» es una pregunta que no es
 * una pregunta. Con varias, la pantalla muestra la lista y `elegirPaginaVinculada` termina el trabajo.
 */
export async function vincularConMeta(padre: BrowserWindow | null, actor: SesionUsuario): Promise<VinculacionPendiente> {
  const almacen = almacenDeRedes()
  if (!almacen) throw new ErrorDeNegocio('No se puede guardar la vinculación en esta computadora.')
  if (!almacen.puedeCifrar()) {
    throw new ErrorDeNegocio(
      'Windows no puede cifrar en esta computadora, así que el permiso de Facebook no se puede guardar de forma segura. Sin eso no se vincula: sería dejar la cuenta de la agencia escrita en un archivo.',
    )
  }
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

  vinculacionEnCurso = { token: tokenLargo, vence: Date.now() + VALIDEZ_DE_LA_VINCULACION_MS, paginas }
  ultimoError = null

  if (paginas.length === 1) {
    return { paginas: [], vinculada: guardarPagina(paginas[0]!, actor) }
  }
  return {
    paginas: paginas.map((pagina) => ({ id: pagina.id, nombre: pagina.nombre, instagramUsuario: pagina.instagramUsuario })),
    vinculada: null,
  }
}

function guardarPagina(pagina: Awaited<ReturnType<typeof paginasDelUsuario>>[number], actor: SesionUsuario): VinculoConMeta {
  const almacen = almacenDeRedes()
  if (!almacen) throw new ErrorDeNegocio('No se puede guardar la vinculación en esta computadora.')
  const guardado = almacen.guardar({
    paginaId: pagina.id,
    paginaNombre: pagina.nombre,
    paginaToken: pagina.token,
    instagramId: pagina.instagramId,
    instagramUsuario: pagina.instagramUsuario,
    vinculadoPor: actor.nombre,
    vinculadoEn: ahoraIso(),
  })
  if (!guardado) throw new ErrorDeNegocio('No se pudo guardar la vinculación de forma segura en esta computadora.')
  vinculacionEnCurso = null
  const vinculo = aVinculo()
  if (!vinculo) throw new ErrorDeNegocio('No se pudo leer la vinculación recién guardada.')
  return vinculo
}

export function elegirPaginaVinculada(paginaId: string, actor: SesionUsuario): VinculoConMeta {
  const id = limpiar(paginaId)
  if (!vinculacionEnCurso || vinculacionEnCurso.vence < Date.now()) {
    vinculacionEnCurso = null
    throw new ErrorDeNegocio('Pasó demasiado tiempo desde que ingresaste en Facebook. Volvé a tocar «Vincular cuenta».')
  }
  const pagina = vinculacionEnCurso.paginas.find((candidata) => candidata.id === id)
  if (!pagina) throw new ErrorDeNegocio('Esa página no está entre las que trajo Facebook. Volvé a vincular.')
  return guardarPagina(pagina, actor)
}

export function desvincularDeMeta(): void {
  almacenDeRedes()?.borrar()
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

function anotar(datos: {
  destino: DestinoDePublicacion
  estado: 'PUBLICADA' | 'FALLIDA'
  texto: string
  archivo: string | null
  idEnLaRed: string | null
  url: string | null
  error: string | null
  actor: SesionUsuario
}): void {
  db()
    .prepare(
      `INSERT INTO publicaciones_redes (destino, estado, texto, archivo, id_en_la_red, url, error, usuario_id, publicado_por, publicado_en)
       VALUES (@destino, @estado, @texto, @archivo, @id_en_la_red, @url, @error, @usuario_id, @publicado_por, @publicado_en)`,
    )
    .run({
      destino: datos.destino,
      estado: datos.estado,
      texto: datos.texto,
      archivo: datos.archivo,
      id_en_la_red: datos.idEnLaRed,
      url: datos.url,
      error: datos.error,
      usuario_id: datos.actor.id,
      publicado_por: datos.actor.nombre,
      publicado_en: ahoraIso(),
    })
}

export function historialDePublicaciones(limite = TOPE_DE_HISTORIAL): PublicacionDeRed[] {
  const filas = db()
    .prepare(
      `SELECT id, destino, estado, texto, archivo, url, error, publicado_por, publicado_en
         FROM publicaciones_redes ORDER BY id DESC LIMIT ?`,
    )
    .all(limite) as Array<{
    id: number
    destino: DestinoDePublicacion
    estado: 'PUBLICADA' | 'FALLIDA'
    texto: string
    archivo: string | null
    url: string | null
    error: string | null
    publicado_por: string
    publicado_en: string
  }>
  return filas.map((fila) => ({
    id: fila.id,
    destino: fila.destino,
    estado: fila.estado,
    texto: fila.texto,
    archivo: fila.archivo,
    url: fila.url,
    error: fila.error,
    publicadoPor: fila.publicado_por,
    publicadoEn: fila.publicado_en,
  }))
}

/** La dirección para abrir un posteo de Facebook. Instagram devuelve la suya en otro campo. */
function urlDeFacebook(postId: string): string {
  return `https://www.facebook.com/${postId}`
}

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
  return { destino, texto: cuerpo, ruta }
}

/**
 * Publica y anota el resultado, salga bien o mal. Que se anote lo fallido es el punto de la tabla: el
 * error de Meta se pierde apenas se cierra la pantalla, y sin él nadie puede averiguar qué pasó.
 */
export async function publicarEnRed(pedido: unknown, actor: SesionUsuario): Promise<PanelDeRedes> {
  const { destino, texto: cuerpo, ruta } = validarPedido(pedido)
  const guardado = almacenDeRedes()?.leer()
  if (!guardado) throw new ErrorDeNegocio('Todavía no hay ninguna cuenta vinculada. Tocá «Vincular cuenta» primero.')
  if (destino === 'INSTAGRAM' && !guardado.instagramId) {
    throw new ErrorDeNegocio(
      `La página «${guardado.paginaNombre}» no tiene una cuenta de Instagram Business vinculada. Se vincula desde la configuración de la página en Facebook.`,
    )
  }

  const archivo = ruta ? await revisarArchivoParaPublicar(ruta) : null
  const nombreDelArchivo = archivo?.nombre ?? null

  try {
    if (destino === 'FACEBOOK') {
      if (!archivo) {
        const postId = await publicarTextoEnLaPagina(guardado.paginaId, guardado.paginaToken, cuerpo)
        anotar({ destino, estado: 'PUBLICADA', texto: cuerpo, archivo: null, idEnLaRed: postId, url: urlDeFacebook(postId), error: null, actor })
      } else {
        const contenido = await readFile(archivo.ruta)
        const { fotoId, postId } = await subirFotoALaPagina(
          guardado.paginaId,
          guardado.paginaToken,
          contenido,
          archivo.nombre,
          archivo.tipo,
          cuerpo,
          true,
        )
        const id = postId ?? fotoId
        anotar({ destino, estado: 'PUBLICADA', texto: cuerpo, archivo: nombreDelArchivo, idEnLaRed: id, url: urlDeFacebook(id), error: null, actor })
      }
    } else {
      // Instagram: la foto va primero a la Página SIN publicar, sólo para tener una dirección que Meta
      // pueda descargar. Al terminar se borra: no tiene por qué quedar dando vueltas en Facebook.
      const contenido = await readFile(archivo!.ruta)
      const { fotoId } = await subirFotoALaPagina(
        guardado.paginaId,
        guardado.paginaToken,
        contenido,
        archivo!.nombre,
        archivo!.tipo,
        '',
        false,
      )
      try {
        const urlDeLaImagen = await urlPublicaDeLaFoto(fotoId, guardado.paginaToken)
        const publicacionId = await publicarEnInstagram(guardado.instagramId!, guardado.paginaToken, urlDeLaImagen, cuerpo)
        anotar({
          destino,
          estado: 'PUBLICADA',
          texto: cuerpo,
          archivo: nombreDelArchivo,
          idEnLaRed: publicacionId,
          url: guardado.instagramUsuario ? `https://www.instagram.com/${guardado.instagramUsuario}/` : null,
          error: null,
          actor,
        })
      } finally {
        await borrarFotoDeLaPagina(fotoId, guardado.paginaToken)
      }
    }
    ultimoError = null
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    anotar({ destino, estado: 'FALLIDA', texto: cuerpo, archivo: nombreDelArchivo, idEnLaRed: null, url: null, error: motivo, actor })

    if (esTokenRechazado(error)) {
      // El vínculo NO se borra solo: borrarlo escondería el motivo y la pantalla diría «no hay cuenta
      // vinculada», que manda a buscar el problema donde no está.
      ultimoError = `Se cortó la conexión con Meta: ${motivo} Hay que volver a vincular la cuenta.`
      throw new ErrorDeNegocio(ultimoError)
    }
    ultimoError = motivo
    if (error instanceof ErrorDeMetaApi) throw new ErrorDeNegocio(`${NOMBRE_DESTINO[destino]} no aceptó la publicación: ${motivo}`)
    throw error
  }

  return panelDeRedes()
}
