// Documentos adjuntos de una póliza, un siniestro o una tarea: las fotos del auto, la denuncia, el
// presupuesto del taller, el PDF que alguien dejó colgado de una tarea.
//
// Cómo viven (12.6):
//  - El archivo se guarda en esta computadora (%APPDATA%/dm-gestion/adjuntos/<grupo>/) para abrirse con
//    doble clic, como siempre.
//  - Se SUBE al VPS de la agencia (`PUT /api/dmg/adjuntos/<id>`), en segundo plano y con reintentos,
//    y su ficha viaja por la pestaña APP ADJUNTOS de la base (ver sincronizacion/anexos.ts). Así lo ve
//    cualquier computadora, que lo baja del servidor la primera vez que alguien lo abre allá.
//  - Si hay conexión con Google, además se sube una copia a la carpeta «Adjuntos DM» del Drive. Es una
//    copia y nada más: que falte Google nunca frena nada, pero desde la 12.6 se DICE que faltó, en vez
//    de quedarse callado como hasta la 12.5.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import {
  camposDeAdjunto,
  descripcionDelPadre,
  encolarBorradoDeAnexo,
  encolarSubidoDeAnexo,
  PREFIJO_DE_ADJUNTO,
  registrarAnexoEnLaCola,
  registrarComentarioNuevo,
  vinculoDelPadre,
  type TipoDeAnexo,
} from '../sincronizacion/anexos'
import { anotarEvento } from '../sincronizacion/cola'
import { subirArchivoADrive } from '../sincronizacion/respaldo'
import {
  copiarAdjuntoEn,
  guardarBytesEn,
  rutaDeAdjunto,
  tipoDeArchivo,
  borrarArchivoDeAdjunto,
  type AdjuntoCopiado,
} from './carpetaDeAdjuntos'
import { ErrorDeNegocio } from './errores'
import { miniaturaDe } from './miniaturas'
import { esFallaDeRed } from './red'

// Lo que ya existía sigue saliendo de acá: los servicios y las pruebas lo importan por este nombre.
export {
  TAMANO_MAXIMO,
  borrarArchivoDeAdjunto,
  carpetaDeAdjuntos,
  carpetaDelGrupo,
  carpetaDelSiniestro,
  copiarAdjunto,
  copiarAdjuntoEn,
  guardarBytesEn,
  nombreSeguro,
  rutaDeAdjunto,
  tipoDeArchivo,
  usarCarpetaDeAdjuntosDePrueba,
  type AdjuntoCopiado,
} from './carpetaDeAdjuntos'
export type { TipoDeAnexo } from '../sincronizacion/anexos'

export const CARPETA_DE_ADJUNTOS_EN_DRIVE = 'Adjuntos DM'
/** Lo que queda anotado junto al adjunto cuando esta PC no tiene las credenciales de Google. */
export const MENSAJE_SIN_DRIVE = 'Google Drive no está configurado en esta computadora.'
/** «Nunca»: la fecha del próximo intento de un archivo que el servidor rechazó para siempre. */
const NUNCA = '9999-12-31T00:00:00.000Z'
/**
 * Lo que queda anotado en `vps_error` cuando esta computadora contrastó el archivo contra el servidor
 * y el servidor NO lo tiene (12.7). Es una marca para adentro: la ficha no la muestra como error, sólo
 * deja de decir «está en el servidor».
 *
 * Hace falta porque el desmarcado no puede vivir sólo en `vps_subido_en`: `guardarAdjuntoDeLaHoja`
 * vuelve a copiar la columna SUBIDO de la fila en CADA importación completa, y sin la marca lo que
 * `verificarAdjuntosContraElServidor` había corregido al arrancar volvía a mentir apenas entraba una
 * importación (y la ficha volvía a dar 404 al abrir el adjunto).
 */
export const FALTA_EN_EL_SERVIDOR = 'El servidor no tiene este archivo.'

// ---------------------------------------------------------------------------
// El almacén: dónde se suben y de dónde se bajan los archivos
// ---------------------------------------------------------------------------

export interface FichaParaElAlmacen {
  id: string
  nombre: string
  tipo: string
  grupo: string
  subidoPor: string | null
  sha256: string
}

export interface ArchivoBajado {
  contenido: Buffer
  nombre: string
  tipo: string
  sha256: string | null
}

/** Lo que el servidor sabe de cada archivo que tiene, sin el archivo. */
export interface FichaEnElAlmacen {
  id: string
  tamano: number
  sha256: string | null
}

/** Lo que tiene que saber hacer quien guarda los archivos: el VPS (FuenteVps) o la hoja simulada en las pruebas. */
export interface AlmacenDeAdjuntos {
  subirAdjunto(ficha: FichaParaElAlmacen, contenido: Buffer): Promise<{ yaEstaba: boolean }>
  bajarAdjunto(id: string): Promise<ArchivoBajado>
  borrarAdjunto(id: string): Promise<void>
  /**
   * Todos los archivos que el servidor tiene (12.7). `completa` en false avisa que la lista se cortó
   * (el servidor devuelve de a 5.000) y no sirve para decidir que algo NO está.
   */
  listarAdjuntos(): Promise<{ fichas: FichaEnElAlmacen[]; completa: boolean }>
}

export function esAlmacenDeAdjuntos(valor: unknown): valor is AlmacenDeAdjuntos {
  const v = valor as Partial<AlmacenDeAdjuntos> | null
  return (
    !!v &&
    typeof v.subirAdjunto === 'function' &&
    typeof v.bajarAdjunto === 'function' &&
    typeof v.borrarAdjunto === 'function' &&
    typeof v.listarAdjuntos === 'function'
  )
}

let dameAlmacen: () => AlmacenDeAdjuntos | null = () => null

/** Lo registra sincronizacion.ts: el VPS configurado, o la hoja de prueba si la hay. */
export function usarAlmacenDeAdjuntos(dador: () => AlmacenDeAdjuntos | null): void {
  dameAlmacen = dador
}

/**
 * A quién avisarle que un archivo terminó de subir.
 *
 * Los adjuntos de las fichas se lo cuentan a las otras computadoras escribiendo la columna SUBIDO de
 * su fila de APP ADJUNTOS; los de un mensaje no tienen fila, así que la mensajería se engancha acá
 * para mandar su propio aviso. Es un dador y no un import directo para no atar este archivo al de
 * mensajería: el banco de pruebas importa los servicios sueltos.
 */
let avisarSubidaDelArchivo: ((tipo: TipoDeAdjunto, adjuntoId: number, vpsId: string, subidoEn: string) => void) | null = null

export function alSubirUnAdjunto(
  avisar: ((tipo: TipoDeAdjunto, adjuntoId: number, vpsId: string, subidoEn: string) => void) | null,
): void {
  avisarSubidaDelArchivo = avisar
}

// ---------------------------------------------------------------------------
// Las cuatro tablas, con la misma forma
// ---------------------------------------------------------------------------

/**
 * De qué cuelga un adjunto. Los tres primeros cuelgan de una ficha que tiene fila en la planilla y por
 * eso su ficha viaja por APP ADJUNTOS (`TipoDeAnexo`); el cuarto no.
 *
 * Un adjunto de un mensaje (12.8) va al mismo disco, sube al mismo servidor y se baja igual —de eso se
 * trata reusar esto— pero NO tiene fila en la planilla: su ficha viaja adentro del propio mensaje, por
 * los endpoints de mensajería. Todo lo que en este archivo mira `fila_id` lo saltea solo.
 */
export type TipoDeAdjunto = TipoDeAnexo | 'mensaje'

const TABLAS: Record<TipoDeAdjunto, { tabla: string; padre: string; grupo: (padreId: number) => string; etiqueta: string }> = {
  poliza: { tabla: 'poliza_adjuntos', padre: 'poliza_id', grupo: (id) => `poliza-${id}`, etiqueta: 'poliza' },
  // Los siniestros usan el número a secas: así quedaron los de la Fase 7 y no se les mueve el piso.
  siniestro: { tabla: 'siniestro_adjuntos', padre: 'siniestro_id', grupo: (id) => String(id), etiqueta: 'siniestro' },
  tarea: { tabla: 'tarea_adjuntos', padre: 'tarea_id', grupo: (id) => `tarea-${id}`, etiqueta: 'tarea' },
  mensaje: { tabla: 'mensaje_adjuntos', padre: 'mensaje_id', grupo: (id) => `mensaje-${id}`, etiqueta: 'mensaje' },
}

/** Los que además tienen ficha en APP ADJUNTOS. Un mensaje no: por eso este angostamiento existe. */
function comoAnexo(tipo: TipoDeAdjunto): TipoDeAnexo | null {
  return tipo === 'mensaje' ? null : tipo
}

export function grupoDeAdjuntos(tipo: TipoDeAdjunto, padreId: number): string {
  return TABLAS[tipo].grupo(padreId)
}

interface FilaAdjunto {
  id: number
  padre_id: number
  fila_id: string | null
  nombre: string
  archivo: string
  tipo: string | null
  tamano: number
  sha256: string | null
  ancho: number | null
  alto: number | null
  miniatura: string | null
  drive_id: string | null
  drive_error: string | null
  vps_id: string | null
  vps_subido_en: string | null
  vps_error: string | null
  vps_intentos: number
  vps_proximo_intento: string | null
  usuario_nombre: string
  creado_en: string
  categoria?: string | null
  categoria_detalle?: string | null
}

function selectDe(tipo: TipoDeAdjunto): string {
  const { tabla, padre } = TABLAS[tipo]
  return `SELECT id, ${padre} AS padre_id, fila_id, nombre, archivo, tipo, tamano, sha256, ancho, alto, miniatura,
                 drive_id, drive_error, vps_id, vps_subido_en, vps_error, vps_intentos, vps_proximo_intento,
                 usuario_nombre, creado_en${tipo === 'siniestro' ? ', categoria, categoria_detalle' : ''}
          FROM ${tabla}`
}

/** Lo que hace falta para subir, verificar o volver a registrar un adjunto: todo menos la miniatura y lo de Drive. */
type FilaAdjuntoLiviana = Omit<FilaAdjunto, 'miniatura' | 'ancho' | 'alto' | 'drive_id' | 'drive_error'>

/**
 * El mismo SELECT sin la miniatura (12.7). Es un base64 de 15 a 40 KB por foto, y los recorridos en
 * segundo plano (la subida cada 10 s, la verificación al arrancar sobre TODAS las filas con vps_id)
 * no la necesitan para nada: con `selectDe` se leían megabytes por vuelta.
 */
function selectLivianoDe(tipo: TipoDeAdjunto): string {
  const { tabla, padre } = TABLAS[tipo]
  return `SELECT id, ${padre} AS padre_id, fila_id, nombre, archivo, tipo, tamano, sha256,
                 vps_id, vps_subido_en, vps_error, vps_intentos, vps_proximo_intento,
                 usuario_nombre, creado_en${tipo === 'siniestro' ? ', categoria, categoria_detalle' : ''}
          FROM ${tabla}`
}

function leerFila(tipo: TipoDeAdjunto, adjuntoId: number): FilaAdjunto {
  const fila = db().prepare(`${selectDe(tipo)} WHERE id = ?`).get(adjuntoId) as FilaAdjunto | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró ese documento.')
  return fila
}

/** Lo que las tres fichas muestran de un adjunto. Los siniestros agregan la categoría por su cuenta. */
export interface AdjuntoGenerico {
  id: number
  nombre: string
  tipo: string
  tamano: number
  creadoEn: string
  usuarioNombre: string
  enDrive: boolean
  errorDeDrive: string | null
  enElServidor: boolean
  errorDelServidor: string | null
  descargado: boolean
  /**
   * Lo cargó otra computadora y todavía no se sabe si terminó de subirlo (12.7). Se distingue de «en
   * el servidor» a propósito: hasta la 12.6 los dos estados se mostraban igual, y abrir uno de éstos
   * terminaba en «ese adjunto no existe».
   */
  enOtraComputadora: boolean
  miniatura: string | null
  ancho: number | null
  alto: number | null
  categoria: string | null
  categoriaDetalle: string | null
}

function aGenerico(fila: FilaAdjunto): AdjuntoGenerico {
  // Esta computadora ya le preguntó al servidor y el archivo no estaba: aunque la fila de la base
  // vuelva a traer la columna SUBIDO en la próxima importación, acá se sabe que no está.
  const faltaEnElServidor = fila.vps_error === FALTA_EN_EL_SERVIDOR
  return {
    id: fila.id,
    nombre: fila.nombre,
    tipo: fila.tipo ?? tipoDeArchivo(fila.nombre),
    tamano: fila.tamano,
    creadoEn: fila.creado_en,
    usuarioNombre: fila.usuario_nombre,
    enDrive: fila.drive_id !== null,
    errorDeDrive: fila.drive_error,
    enElServidor: fila.vps_subido_en !== null && !faltaEnElServidor,
    // La marca no es un error para mostrar: si se mostrara, la ficha diría «no subió» en rojo en vez
    // de «cargado en otra computadora», que es lo que pasa de verdad.
    errorDelServidor: faltaEnElServidor ? null : fila.vps_error,
    descargado: fila.archivo !== '' && existsSync(rutaDeAdjunto(fila.archivo)),
    enOtraComputadora: fila.archivo === '' && fila.vps_id !== null && (fila.vps_subido_en === null || faltaEnElServidor),
    miniatura: fila.miniatura,
    ancho: fila.ancho,
    alto: fila.alto,
    categoria: fila.categoria ?? null,
    categoriaDetalle: fila.categoria_detalle ?? null,
  }
}

export function adjuntosDe(tipo: TipoDeAdjunto, padreId: number): AdjuntoGenerico[] {
  const { padre } = TABLAS[tipo]
  return (db().prepare(`${selectDe(tipo)} WHERE ${padre} = ? ORDER BY id DESC`).all(padreId) as FilaAdjunto[]).map(aGenerico)
}

export function adjuntoPorId(tipo: TipoDeAdjunto, adjuntoId: number): AdjuntoGenerico & { padreId: number } {
  const fila = leerFila(tipo, adjuntoId)
  return { ...aGenerico(fila), padreId: fila.padre_id }
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

/** Un archivo que entra: los bytes (vinieron de la pantalla o del servidor) o una ruta del disco. */
export interface ArchivoEntrante {
  nombre: string
  tipo?: string | null
  contenido?: Buffer | Uint8Array | null
  ruta?: string | null
  ancho?: number | null
  alto?: number | null
}

export interface OpcionesDeAlta {
  categoria?: string | null
  categoriaDetalle?: string | null
}

function sha256De(contenido: Buffer): string {
  return createHash('sha256').update(contenido).digest('hex')
}

/**
 * Guarda el archivo, lo anota en la tabla del tipo que sea, deja la ficha en camino a APP ADJUNTOS y
 * el archivo en la cola de subida al servidor. Devuelve el adjunto tal como lo ve la ficha.
 *
 * Es la única puerta de entrada: la usan los siniestros, las tareas y las pólizas, con bytes que
 * vienen de la pantalla (arrastrar, pegar, elegir) o con una ruta (el explorador de archivos).
 */
export function registrarAdjunto(
  tipo: TipoDeAdjunto,
  padreId: number,
  archivo: ArchivoEntrante,
  actor: SesionUsuario,
  opciones: OpcionesDeAlta = {},
): AdjuntoGenerico {
  const nombre = (archivo.nombre ?? '').trim()
  if (!nombre) throw new ErrorDeNegocio('El archivo no tiene nombre.')
  const grupo = grupoDeAdjuntos(tipo, padreId)

  let copia: AdjuntoCopiado
  let contenido: Buffer
  if (archivo.contenido && archivo.contenido.length > 0) {
    contenido = Buffer.isBuffer(archivo.contenido) ? archivo.contenido : Buffer.from(archivo.contenido)
    copia = guardarBytesEn(grupo, nombre, contenido)
  } else if (archivo.ruta) {
    copia = copiarAdjuntoEn(grupo, archivo.ruta)
    contenido = readFileSync(rutaDeAdjunto(copia.archivo))
  } else {
    throw new ErrorDeNegocio(`«${nombre}» llegó vacío.`)
  }

  const tipoMime = archivo.tipo && archivo.tipo.includes('/') ? archivo.tipo.toLowerCase() : tipoDeArchivo(copia.nombre)
  const sha256 = sha256De(contenido)
  const medidas = miniaturaDe(rutaDeAdjunto(copia.archivo), tipoMime)
  const vpsId = randomBytes(16).toString('hex')
  const filaId = `${PREFIJO_DE_ADJUNTO}${vpsId}`
  const ahora = ahoraIso()
  const { tabla, padre } = TABLAS[tipo]
  const conCategoria = tipo === 'siniestro'
  // Si la ficha madre todavía no tiene identidad en la base (una tarea vieja sin fila), la fila de APP
  // ADJUNTOS no puede salir: el `fila_id` entra en NULL desde el vamos para que `registrarLoQueNoViajo`
  // lo vuelva a intentar cuando la ficha la gane. Se pregunta ANTES del INSERT y no se arregla después
  // con un UPDATE: entre las dos sentencias no hay transacción, y una caída ahí en el medio dejaba
  // justo el estado que esto evita (un fila_id puesto que nadie encoló, invisible para siempre). El
  // `vps_id` se pone igual: el archivo puede ir subiendo mientras tanto.
  // Un mensaje no tiene ficha en la planilla: no se le pregunta por el vínculo (preguntar lo llevaría
  // a consultar la tabla equivocada con el id del mensaje, en silencio y mal).
  const anexo = comoAnexo(tipo)
  const conVinculo = anexo !== null && vinculoDelPadre(anexo, padreId) !== null

  const { id } = db()
    .prepare(
      `INSERT INTO ${tabla} (${padre}, fila_id, nombre, archivo, tipo, tamano, sha256, ancho, alto, miniatura,
                             vps_id, usuario_id, usuario_nombre, creado_en${conCategoria ? ', categoria, categoria_detalle' : ''})
       VALUES (@padre, @fila_id, @nombre, @archivo, @tipo, @tamano, @sha256, @ancho, @alto, @miniatura,
               @vps_id, @usuario_id, @usuario_nombre, @creado_en${conCategoria ? ', @categoria, @categoria_detalle' : ''})
       RETURNING id`,
    )
    .get({
      padre: padreId,
      fila_id: conVinculo ? filaId : null,
      nombre: copia.nombre,
      archivo: copia.archivo,
      tipo: tipoMime,
      tamano: copia.tamano,
      sha256,
      ancho: archivo.ancho ?? medidas.ancho,
      alto: archivo.alto ?? medidas.alto,
      miniatura: medidas.miniatura,
      vps_id: vpsId,
      usuario_id: actor.id > 0 ? actor.id : null,
      usuario_nombre: actor.nombre,
      creado_en: ahora,
      ...(conCategoria ? { categoria: opciones.categoria ?? null, categoria_detalle: opciones.categoriaDetalle ?? null } : {}),
    }) as { id: number }

  // `conVinculo` sólo puede ser true cuando `anexo` no es null (un mensaje nunca lo tiene): se
  // comprueban los dos para que el compilador lo vea igual que se lee.
  if (conVinculo && anexo) {
    encolarFichaDelAdjunto(anexo, padreId, filaId, {
      fecha: ahora,
      nombre: copia.nombre,
      categoria: conCategoria ? nombreDeCategoria(opciones.categoria ?? null, opciones.categoriaDetalle ?? null) : null,
      vpsId,
      tamano: copia.tamano,
      sha256,
      usuario: actor.nombre,
      subidoEn: null,
    }, actor)
  }

  return aGenerico(leerFila(tipo, id))
}

function nombreDeCategoria(categoria: string | null, detalle: string | null): string | null {
  if (!categoria) return null
  return detalle ? `${categoria}: ${detalle}` : categoria
}

/** La fila de APP ADJUNTOS, si la ficha madre tiene identidad en la base. Si no, el adjunto queda local. */
function encolarFichaDelAdjunto(
  tipo: TipoDeAnexo,
  padreId: number,
  filaId: string,
  datos: { fecha: string; nombre: string; categoria: string | null; vpsId: string; tamano: number; sha256: string | null; usuario: string; subidoEn: string | null },
  actor: SesionUsuario | null,
): boolean {
  const vinculo = vinculoDelPadre(tipo, padreId)
  if (!vinculo) return false
  registrarAnexoEnLaCola(
    {
      filaId,
      tipoPestana: 'APP_ADJUNTOS',
      campos: camposDeAdjunto({ ...datos, tipo, vinculo, descripcion: descripcionDelPadre(tipo, padreId) }),
    },
    actor,
  )
  return true
}

// ---------------------------------------------------------------------------
// Baja
// ---------------------------------------------------------------------------

/**
 * Borra el adjunto de esta computadora, de la base (la fila de APP ADJUNTOS) y del servidor. Devuelve
 * de qué ficha era, para que el servicio la vuelva a leer. El borrado en el servidor es lo mejor
 * posible: si no hay conexión queda el archivo huérfano allá, que es preferible a un borrado que no
 * se puede hacer.
 */
export function borrarAdjuntoRegistrado(tipo: TipoDeAdjunto, adjuntoId: number, actor: SesionUsuario): { padreId: number; nombre: string } {
  const fila = leerFila(tipo, adjuntoId)
  db().prepare(`DELETE FROM ${TABLAS[tipo].tabla} WHERE id = ?`).run(fila.id)
  borrarArchivoDeAdjunto(fila.archivo)
  if (fila.fila_id) encolarBorradoDeAnexo(fila.fila_id, 'APP_ADJUNTOS', actor)
  if (fila.vps_id && fila.vps_subido_en) borrarAdjuntosDelServidor([{ vpsId: fila.vps_id, nombre: fila.nombre }])
  return { padreId: fila.padre_id, nombre: fila.nombre }
}

/**
 * Saca del servidor los archivos de fichas que ya no existen acá, lo mejor posible y sin esperar:
 * si no hay conexión queda el archivo huérfano allá, que es preferible a un borrado que no se puede
 * hacer. Lo usa el borrado de un adjunto suelto y el de una ficha entera con sus adjuntos (12.7:
 * hasta la 12.6 eliminar un siniestro dejaba sus fotos en el servidor para siempre).
 */
export function borrarAdjuntosDelServidor(lista: Array<{ vpsId: string; nombre: string }>): void {
  if (lista.length === 0) return
  const almacen = dameAlmacen()
  if (!almacen) return
  for (const { vpsId, nombre } of lista) {
    void almacen.borrarAdjunto(vpsId).catch((error: unknown) => {
      anotarEvento('error', `No se pudo borrar «${nombre}» del servidor: ${error instanceof Error ? error.message : String(error)}`, { conError: true })
    })
  }
}

// ---------------------------------------------------------------------------
// Abrir: si el archivo no está en esta PC, se baja del servidor
// ---------------------------------------------------------------------------

/** La ruta local del archivo, bajándolo del servidor si hace falta (lo cargó otra computadora). */
export async function asegurarAdjuntoLocal(tipo: TipoDeAdjunto, adjuntoId: number): Promise<string> {
  const fila = leerFila(tipo, adjuntoId)
  if (fila.archivo && existsSync(rutaDeAdjunto(fila.archivo))) return rutaDeAdjunto(fila.archivo)
  if (!fila.vps_id) {
    throw new ErrorDeNegocio('Este archivo quedó sólo en la computadora donde se cargó y no se subió al servidor.')
  }
  const almacen = dameAlmacen()
  if (!almacen) throw new ErrorDeNegocio('Sin conexión con la base de la agencia no se puede bajar el archivo.')

  let bajado: ArchivoBajado
  try {
    bajado = await almacen.bajarAdjunto(fila.vps_id)
  } catch (error) {
    if (error instanceof ErrorDeNegocio && /no existe/i.test(error.message)) {
      throw new ErrorDeNegocio(
        `«${fila.nombre}» todavía no llegó al servidor: la computadora que lo cargó (${fila.usuario_nombre}) no lo terminó de subir, o está apagada. ` +
          'Se sube solo cuando esa computadora está prendida y con internet; probá en un rato.',
      )
    }
    if (error instanceof ErrorDeNegocio && /ya no está en el disco/i.test(error.message)) {
      throw new ErrorDeNegocio(
        `«${fila.nombre}» se perdió en el servidor. La computadora que lo cargó (${fila.usuario_nombre}) lo vuelve a subir sola la próxima vez que abra el programa, si todavía lo tiene.`,
      )
    }
    // 12.7: un corte o una descarga que tardó más de lo que se espera (ver `pedirCrudo`) no es un
    // «error inesperado»: se dice qué pasó y qué hacer.
    if (esTimeout(error) || esFallaDeRed(error)) {
      throw new ErrorDeNegocio(`La descarga de «${fila.nombre}» se cortó o tardó demasiado; probá de nuevo con mejor conexión.`)
    }
    throw error
  }
  if (fila.sha256 && bajado.sha256 && bajado.sha256 !== fila.sha256) {
    throw new ErrorDeNegocio(`«${fila.nombre}» bajó dañado del servidor (la huella no coincide). Volvé a intentar.`)
  }
  const copia = guardarBytesEn(grupoDeAdjuntos(tipo, fila.padre_id), fila.nombre, bajado.contenido)
  const tipoMime = fila.tipo ?? (bajado.tipo.includes('/') ? bajado.tipo : tipoDeArchivo(fila.nombre))
  const medidas = miniaturaDe(rutaDeAdjunto(copia.archivo), tipoMime)
  db()
    .prepare(
      // El archivo bajó del servidor: cualquier cosa que dijera `vps_error` de este archivo y el
      // servidor (la marca de «no lo tiene», un rechazo viejo) quedó desmentida por los hechos.
      `UPDATE ${TABLAS[tipo].tabla}
       SET archivo = ?, tipo = ?, tamano = ?, sha256 = COALESCE(sha256, ?), ancho = COALESCE(ancho, ?), alto = COALESCE(alto, ?),
           miniatura = COALESCE(miniatura, ?), vps_subido_en = COALESCE(vps_subido_en, ?), vps_error = NULL
       WHERE id = ?`,
    )
    .run(copia.archivo, tipoMime, copia.tamano, sha256De(bajado.contenido), medidas.ancho, medidas.alto, medidas.miniatura, ahoraIso(), fila.id)
  return rutaDeAdjunto(copia.archivo)
}

// ---------------------------------------------------------------------------
// La subida al servidor, en segundo plano
// ---------------------------------------------------------------------------

const CONDICION_PENDIENTE = `vps_id IS NOT NULL AND vps_subido_en IS NULL AND archivo <> '' AND (vps_proximo_intento IS NULL OR vps_proximo_intento <= ?)`

export function hayAdjuntosPendientes(): boolean {
  const ahora = ahoraIso()
  for (const { tabla } of Object.values(TABLAS)) {
    const fila = db().prepare(`SELECT 1 FROM ${tabla} WHERE ${CONDICION_PENDIENTE} LIMIT 1`).get(ahora)
    if (fila) return true
  }
  return false
}

/** Cuántos adjuntos todavía no llegaron al servidor (para la pantalla de Sincronización). */
export function adjuntosSinSubir(): number {
  let total = 0
  for (const { tabla } of Object.values(TABLAS)) {
    total += (db().prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE vps_id IS NOT NULL AND vps_subido_en IS NULL AND archivo <> ''`).get() as { n: number }).n
  }
  return total
}

/** Espera creciente: 1, 2, 4, 8… minutos, con tope de una hora. */
function proximoIntento(intentos: number): string {
  const minutos = Math.min(60, 2 ** Math.max(0, intentos - 1))
  return new Date(Date.now() + minutos * 60_000).toISOString()
}

export interface ResultadoDeSubidaDeAdjuntos {
  subidos: number
  fallidos: number
}

/** El pedido se cortó por el reloj (`AbortSignal.timeout`): el servidor no dijo nada, pero el tiempo pasó. */
function esTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/**
 * Si el servidor rechazó el ARCHIVO en sí (demasiado grande, tipo no admitido, vacío, dañado, sin
 * nombre): reintentarlo no cambia nada y al tercer rechazo se deja de intentar. Todo lo demás que el
 * servidor conteste (token vencido, 429, 409, 503, un 5xx) se arregla sin tocar el archivo, así que
 * nunca es definitivo: hasta la 12.6 cualquier 4xx mandaba el archivo a «nunca» aunque la culpa fuera
 * del token. Con `status` se decide por el código; sin él (el almacén de las pruebas), por el mensaje.
 */
const PALABRAS_DE_RECHAZO = /vac[ií]o|nombre|hash|sha256|dañad|supera el m[aá]ximo|demasiado grande|tipo no admitido/i

function esRechazoDelArchivo(error: unknown): boolean {
  if (!(error instanceof ErrorDeNegocio)) return false
  const status = (error as { status?: unknown }).status
  if (typeof status === 'number') {
    if (status === 413 || status === 415 || status === 422) return true
    if (status !== 400) return false
  }
  // Por palabras se mira el DETALLE del servidor, no el mensaje armado: el mensaje lleva adentro el
  // nombre del archivo («…(subir el adjunto «hash.pdf»): el cuerpo no se pudo leer»), y con eso un
  // adjunto llamado «hash.pdf» o «dañado.pdf» se daba por rechazado con cualquier 400 transitorio.
  const detalle = (error as { detalle?: unknown }).detalle
  return PALABRAS_DE_RECHAZO.test(typeof detalle === 'string' ? detalle : error.message)
}

/**
 * El 409 («ya hay un adjunto con ese id y otro contenido: un adjunto no se reescribe») no se arregla
 * esperando: ni el id ni el sha256 de la fila cambian nunca, así que el mismo PUT —que puede ser de
 * decenas de MB— volvería cada hora para siempre. Al tercero se para. Si algún día ese archivo
 * desaparece del servidor, `verificarAdjuntosContraElServidor` lo vuelve a poner en la cola.
 */
function esConflictoDeId(error: unknown): boolean {
  return error instanceof ErrorDeNegocio && (error as { status?: unknown }).status === 409
}

/**
 * Sube al servidor los archivos que todavía no están, de a pocos por vuelta (la llama el motor cada
 * diez segundos). Un fallo de red no cuenta como intento: ESA fila espera un minuto y se sigue con la
 * siguiente, y sólo con dos fallas de red seguidas se corta la vuelta (ahí sí no hay conexión). Un
 * timeout cuenta como intento, con espera creciente. Un rechazo del servidor cuenta, y si es del
 * archivo en sí (ver `esRechazoDelArchivo`), al tercero se deja de intentar para siempre, con el motivo
 * a la vista en la ficha. Nunca lanza: lo que falla queda anotado en la fila y en la bitácora.
 *
 * Hasta la 12.6 la primera falla de red cortaba la vuelta entera sin contar el intento, y como los
 * pendientes salían por fecha, el mismo archivo (uno que siempre tardaba más de diez minutos, por
 * ejemplo) volvía a ser el primero en cada vuelta: los que vinieron después no se intentaban jamás.
 */
export async function subirAdjuntosPendientes(dameToken: (() => Promise<string>) | null = null, limite = 10): Promise<ResultadoDeSubidaDeAdjuntos> {
  const resultado: ResultadoDeSubidaDeAdjuntos = { subidos: 0, fallidos: 0 }
  const almacen = dameAlmacen()
  if (!almacen) return resultado
  const ahora = ahoraIso()
  // Hasta la 12.6 eran tres por ciclo: las seis fotos del choque tardaban medio minuto en llegar, y con
  // una importación completa en el medio, mucho más. Ahora van de a diez, y la vuelta se corta a los
  // veinte segundos para no comerse el ciclo siguiente.
  const arranque = Date.now()
  const hayTiempo = () => Date.now() - arranque < 20_000
  // Fallas de red seguidas en esta vuelta: con dos, no hay conexión y no vale la pena seguir.
  let fallasDeRedSeguidas = 0

  for (const [tipo, { tabla, grupo }] of Object.entries(TABLAS) as Array<[TipoDeAdjunto, (typeof TABLAS)[TipoDeAdjunto]]>) {
    // Los que ya fallaron van al fondo: un archivo que no pasa no puede tapar a los que vinieron después.
    const pendientes = db()
      .prepare(`${selectLivianoDe(tipo)} WHERE ${CONDICION_PENDIENTE} ORDER BY vps_intentos, creado_en LIMIT ?`)
      .all(ahora, limite) as FilaAdjuntoLiviana[]
    for (const fila of pendientes) {
      if (!hayTiempo()) return resultado
      const ruta = rutaDeAdjunto(fila.archivo)
      if (!existsSync(ruta)) {
        db().prepare(`UPDATE ${tabla} SET vps_error = ?, vps_proximo_intento = ? WHERE id = ?`).run('El archivo ya no está en esta computadora.', NUNCA, fila.id)
        resultado.fallidos++
        continue
      }
      let contenido: Buffer
      try {
        contenido = readFileSync(ruta)
      } catch (error) {
        // Abierto por otro programa (EBUSY), sin permiso (EPERM): es un fallo de ESTE archivo, con su
        // espera creciente. Hasta la 12.6 la excepción tumbaba la vuelta entera, cada diez segundos.
        const intentos = fila.vps_intentos + 1
        const mensaje = `No se pudo leer el archivo: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
        db()
          .prepare(`UPDATE ${tabla} SET vps_intentos = ?, vps_error = ?, vps_proximo_intento = ? WHERE id = ?`)
          .run(intentos, mensaje, proximoIntento(intentos), fila.id)
        anotarEvento('error', `No se pudo subir «${fila.nombre}» al servidor: ${mensaje}`, { conError: true })
        resultado.fallidos++
        continue
      }
      const sha256 = fila.sha256 ?? sha256De(contenido)
      try {
        await almacen.subirAdjunto(
          {
            id: fila.vps_id!,
            nombre: fila.nombre,
            tipo: fila.tipo ?? tipoDeArchivo(fila.nombre),
            grupo: grupo(fila.padre_id),
            subidoPor: fila.usuario_nombre,
            sha256,
          },
          contenido,
        )
        const subidoEn = ahoraIso()
        db()
          .prepare(`UPDATE ${tabla} SET vps_subido_en = ?, vps_error = NULL, vps_proximo_intento = NULL, sha256 = COALESCE(sha256, ?) WHERE id = ?`)
          .run(subidoEn, sha256, fila.id)
        // 12.7: se lo cuenta a las otras computadoras por la columna SUBIDO de su fila.
        if (fila.fila_id) encolarSubidoDeAnexo(fila.fila_id, subidoEn)
        // 12.8: y el que no tiene fila (el adjunto de un mensaje) avisa por su propio camino.
        try {
          avisarSubidaDelArchivo?.(tipo, fila.id, fila.vps_id ?? '', subidoEn)
        } catch (errorDelAviso) {
          // El archivo YA subió: que el aviso falle no puede deshacer eso ni cortar la vuelta.
          console.error('[adjuntos] No se pudo avisar que el archivo subió:', errorDelAviso)
        }
        resultado.subidos++
        fallasDeRedSeguidas = 0
      } catch (error) {
        const timeout = esTimeout(error)
        // El timeout matchea `esFallaDeRed` («aborted»), pero se mira primero: el servidor estaba ahí y
        // el archivo no llegó a tiempo, así que cuenta como intento. Si no contara, el que siempre
        // tarda más de diez minutos volvería a ser el primero de cada vuelta.
        if (!timeout && esFallaDeRed(error)) {
          // Sin conexión: ESTA fila se vuelve a mirar en un minuto, no cuenta como intento fallido, y
          // se sigue con la siguiente. Dos seguidas es que no hay internet, y ahí se corta.
          db().prepare(`UPDATE ${tabla} SET vps_proximo_intento = ? WHERE id = ?`).run(proximoIntento(1), fila.id)
          fallasDeRedSeguidas++
          if (fallasDeRedSeguidas >= 2) return resultado
          continue
        }
        fallasDeRedSeguidas = 0
        const mensaje = (timeout
          ? 'La subida tardó más de diez minutos y se cortó; se vuelve a intentar más tarde.'
          : error instanceof Error
            ? error.message
            : String(error)
        ).slice(0, 300)
        const intentos = fila.vps_intentos + 1
        const definitivo = (esRechazoDelArchivo(error) || esConflictoDeId(error)) && intentos >= 3
        db()
          .prepare(`UPDATE ${tabla} SET vps_intentos = ?, vps_error = ?, vps_proximo_intento = ? WHERE id = ?`)
          .run(intentos, mensaje, definitivo ? NUNCA : proximoIntento(intentos), fila.id)
        anotarEvento('error', `No se pudo subir «${fila.nombre}» al servidor${definitivo ? ' (no se vuelve a intentar)' : ''}: ${mensaje}`, { conError: true })
        resultado.fallidos++
      }
    }
  }

  // La copia a Drive de lo que quedó sin ella por falta de credenciales: si ahora hay, se sube.
  if (dameToken) await reintentarDrive(dameToken, limite)
  return resultado
}

export interface ResultadoDeVerificacionDeAdjuntos {
  /**
   * Archivos que vuelven a la cola de subida: los que esta computadora daba por subidos y el servidor
   * no tiene, y los que una versión anterior dio por perdidos sin que la culpa fuera del archivo.
   */
  reencolados: number
  /** Archivos de otras computadoras que el servidor sí tiene: la ficha ya puede decir «en el servidor». */
  confirmados: number
  /**
   * Archivos de otras computadoras que figuraban «en el servidor» y el servidor no tiene (12.7): la
   * ficha vuelve a decir «cargado en otra computadora», que es la verdad, en vez de dar un 404 al abrir.
   */
  desmarcados: number
}

/**
 * Contrasta lo que esta computadora cree de cada archivo con lo que el servidor tiene de verdad (12.7).
 * Corre al arrancar, una vez, en segundo plano. Es la red de seguridad para lo que dejó la 12.6: los
 * archivos que quedaron marcados como subidos sin estarlo (ver `guardarAdjuntoDeLaHoja`) vuelven a
 * subir solos, y los que cargó otra computadora y ya llegaron dejan de decir «cargado en otra
 * computadora». Nunca lanza por un archivo; una falla de red la propaga (quien llama la anota).
 */
export async function verificarAdjuntosContraElServidor(): Promise<ResultadoDeVerificacionDeAdjuntos> {
  const resultado: ResultadoDeVerificacionDeAdjuntos = { reencolados: 0, confirmados: 0, desmarcados: 0 }
  const almacen = dameAlmacen()
  if (!almacen) return resultado
  const { fichas, completa } = await almacen.listarAdjuntos()
  const enElServidor = new Set(fichas.map((ficha) => ficha.id))
  const ahora = ahoraIso()

  for (const { tabla } of Object.values(TABLAS)) {
    // Sólo lo que hace falta para decidir: son TODAS las filas con vps_id, en cada arranque.
    const filas = db()
      .prepare(`SELECT id, vps_id, archivo, vps_subido_en, vps_error, vps_proximo_intento FROM ${tabla} WHERE vps_id IS NOT NULL`)
      .all() as Array<Pick<FilaAdjunto, 'id' | 'vps_id' | 'archivo' | 'vps_subido_en' | 'vps_error' | 'vps_proximo_intento'>>
    for (const fila of filas) {
      const esta = enElServidor.has(fila.vps_id!)
      const tieneElArchivo = fila.archivo !== '' && existsSync(rutaDeAdjunto(fila.archivo))
      if (esta) {
        if (fila.vps_subido_en === null) {
          // Está en el servidor aunque acá no figurara: se confirma, y si se había dado por perdido se olvida el motivo.
          db().prepare(`UPDATE ${tabla} SET vps_subido_en = ?, vps_error = NULL, vps_proximo_intento = NULL WHERE id = ?`).run(ahora, fila.id)
          resultado.confirmados++
        } else if (fila.vps_error === FALTA_EN_EL_SERVIDOR) {
          // La marca quedó vieja: cuando se desmarcó el archivo no estaba y ahora sí (la computadora
          // que lo tenía terminó de subirlo). Se saca la marca y la ficha vuelve a decir «en el servidor».
          db().prepare(`UPDATE ${tabla} SET vps_error = NULL WHERE id = ?`).run(fila.id)
          resultado.confirmados++
        }
        continue
      }
      // Sólo con la lista entera se puede afirmar que algo NO está.
      if (!completa) continue
      if (fila.vps_subido_en === null && fila.vps_proximo_intento === NUNCA && tieneElArchivo && !PALABRAS_DE_RECHAZO.test(fila.vps_error ?? '')) {
        // El rescate de lo que la 12.6 dio por perdido: tres 401 con el token vencido (o tres 503)
        // mandaban el archivo a «nunca» aunque la culpa no fuera del archivo, y ahí quedaba muerto para
        // siempre con el archivo sano en el disco. Si el servidor no lo tiene y acá está, se vuelve a
        // intentar desde cero. Lo que el servidor rechazó por el archivo en sí (413, 415, 422, un 400
        // por el nombre o la huella) no se rescata: volvería a fallar igual.
        db().prepare(`UPDATE ${tabla} SET vps_error = NULL, vps_intentos = 0, vps_proximo_intento = NULL WHERE id = ?`).run(fila.id)
        resultado.reencolados++
        continue
      }
      if (fila.vps_subido_en !== null) {
        // Sólo tiene sentido reencolar lo que esta computadora puede volver a subir: el archivo tiene
        // que estar en su disco.
        if (tieneElArchivo) {
          db()
            .prepare(`UPDATE ${tabla} SET vps_subido_en = NULL, vps_error = NULL, vps_intentos = 0, vps_proximo_intento = NULL WHERE id = ?`)
            .run(fila.id)
          resultado.reencolados++
        } else if (fila.archivo === '') {
          // Lo cargó otra computadora y la columna SUBIDO decía que estaba, pero no está (se borró del
          // servidor, o la otra PC lo dio por subido sin estarlo). Sin el archivo acá no hay nada que
          // reencolar: sólo se deja de afirmar «en el servidor», con la marca que aguanta la próxima
          // importación completa (ver `FALTA_EN_EL_SERVIDOR`).
          db().prepare(`UPDATE ${tabla} SET vps_subido_en = NULL, vps_error = ? WHERE id = ?`).run(FALTA_EN_EL_SERVIDOR, fila.id)
          resultado.desmarcados++
        }
        // Si el archivo es de esta computadora (`archivo <> ''`) y ya no está en el disco, no se toca:
        // desmarcarlo lo dejaba pendiente de subida y en la vuelta siguiente iba a «nunca» con «el
        // archivo ya no está en esta computadora», contado para siempre como adjunto sin subir.
      }
    }
  }
  if (resultado.reencolados > 0) {
    anotarEvento(
      'reparacion',
      `${resultado.reencolados} archivos adjuntos figuraban como subidos pero el servidor no los tenía: vuelven a subir solos.`,
      { filas: resultado.reencolados },
    )
  }
  if (resultado.desmarcados > 0) {
    anotarEvento(
      'reparacion',
      `${resultado.desmarcados} archivos adjuntos de otras computadoras figuraban en el servidor y no están: la ficha vuelve a decir «cargado en otra computadora».`,
      { filas: resultado.desmarcados },
    )
  }
  return resultado
}

async function reintentarDrive(dameToken: () => Promise<string>, limite: number): Promise<void> {
  for (const [tipo, { tabla, etiqueta }] of Object.entries(TABLAS) as Array<[TipoDeAdjunto, (typeof TABLAS)[TipoDeAdjunto]]>) {
    const sinDrive = db()
      .prepare(`${selectLivianoDe(tipo)} WHERE drive_id IS NULL AND drive_error = ? AND archivo <> '' ORDER BY creado_en LIMIT ?`)
      .all(MENSAJE_SIN_DRIVE, limite) as FilaAdjuntoLiviana[]
    for (const fila of sinDrive) {
      if (!existsSync(rutaDeAdjunto(fila.archivo))) continue
      const drive = await subirAdjuntoADriveComo(dameToken, `${etiqueta}-${fila.padre_id}`, { nombre: fila.nombre, archivo: fila.archivo, tamano: fila.tamano })
      db().prepare(`UPDATE ${tabla} SET drive_id = ?, drive_error = ? WHERE id = ?`).run(drive.driveId, drive.error, fila.id)
      if (!drive.driveId) return
    }
  }
}

// ---------------------------------------------------------------------------
// Drive: la copia opcional
// ---------------------------------------------------------------------------

export interface ResultadoDeDrive {
  driveId: string | null
  error: string | null
}

/**
 * Sube la copia a Drive. Nunca lanza: el archivo local ya está guardado y el motivo del fallo queda
 * anotado junto al adjunto para que se vea en la ficha.
 */
export async function subirAdjuntoADrive(
  dameToken: (() => Promise<string>) | null,
  siniestroId: number,
  copia: AdjuntoCopiado,
): Promise<ResultadoDeDrive> {
  return subirAdjuntoADriveComo(dameToken, `siniestro-${siniestroId}`, copia)
}

/** La misma subida, con la etiqueta que lleva el archivo en el Drive («siniestro-12», «tarea-40», «poliza-7»). */
export async function subirAdjuntoADriveComo(
  dameToken: (() => Promise<string>) | null,
  etiqueta: string,
  copia: AdjuntoCopiado,
): Promise<ResultadoDeDrive> {
  // Hasta la 12.5 esto devolvía error null y el adjunto quedaba «sólo local» sin decir por qué: parecía
  // que había subido. Ahora se dice, y `subirAdjuntosPendientes` lo reintenta si Google aparece.
  if (!dameToken) return { driveId: null, error: MENSAJE_SIN_DRIVE }
  try {
    const token = await dameToken()
    const contenido = readFileSync(rutaDeAdjunto(copia.archivo))
    const nombre = `${etiqueta} — ${copia.nombre}`
    const driveId = await subirArchivoADrive(token, CARPETA_DE_ADJUNTOS_EN_DRIVE, nombre, contenido, tipoDeArchivo(copia.nombre))
    return { driveId, error: driveId ? null : 'No se pudo crear la carpeta «Adjuntos DM» en el Drive.' }
  } catch (error) {
    return { driveId: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) }
  }
}

/** Sube la copia a Drive de un adjunto ya registrado y anota el resultado en su fila. */
export async function copiarADrive(tipo: TipoDeAnexo, adjuntoId: number, dameToken: (() => Promise<string>) | null): Promise<ResultadoDeDrive> {
  const fila = leerFila(tipo, adjuntoId)
  const drive = await subirAdjuntoADriveComo(dameToken, `${TABLAS[tipo].etiqueta}-${fila.padre_id}`, {
    nombre: fila.nombre,
    archivo: fila.archivo,
    tamano: fila.tamano,
  })
  db().prepare(`UPDATE ${TABLAS[tipo].tabla} SET drive_id = ?, drive_error = ? WHERE id = ?`).run(drive.driveId, drive.error, fila.id)
  return drive
}

// ---------------------------------------------------------------------------
// Lo que quedó de antes de la 12.6
// ---------------------------------------------------------------------------

/**
 * Los adjuntos y comentarios cargados con versiones anteriores no tienen fila en la base: quedaron en
 * la PC donde se cargaron. Al arrancar se les da identidad y se los manda, igual que a los nuevos. Se
 * llama desde `repararAlArrancar`, sin actor (es la aplicación, no una persona).
 */
export function registrarLoQueNoViajo(): { adjuntos: number; comentarios: number } {
  let adjuntos = 0
  for (const [tipo, { tabla, padre }] of Object.entries(TABLAS) as Array<[TipoDeAdjunto, (typeof TABLAS)[TipoDeAdjunto]]>) {
    // Los adjuntos de un mensaje no viajan por APP ADJUNTOS: su ficha va adentro del mensaje. Acá no
    // hay nada que rescatar (y `fila_id` en ellos es NULL siempre, no «todavía no viajó»).
    const anexo = comoAnexo(tipo)
    if (anexo === null) continue
    const viejos = db()
      .prepare(`${selectDe(tipo)} WHERE fila_id IS NULL AND archivo <> '' ORDER BY id`)
      .all() as FilaAdjunto[]
    for (const fila of viejos) {
      const ruta = rutaDeAdjunto(fila.archivo)
      if (!existsSync(ruta)) continue
      // Si la ficha madre todavía no tiene identidad en la base, no hay nada que mandar: se lo deja
      // como está (sin fila_id) y se vuelve a mirar en el próximo arranque. Hasta la 12.6 se le ponía
      // el fila_id igual y quedaba para siempre como «ya registrado» sin haber viajado.
      if (!vinculoDelPadre(anexo, fila.padre_id)) continue
      let contenido: Buffer
      try {
        contenido = readFileSync(ruta)
      } catch (error) {
        // Un archivo ilegible (abierto por otro programa, sin permiso) no puede frenar el registro de los demás.
        anotarEvento('error', `No se pudo leer «${fila.nombre}» para registrarlo: ${error instanceof Error ? error.message : String(error)}`, { conError: true })
        continue
      }
      const sha256 = fila.sha256 ?? sha256De(contenido)
      const tipoMime = fila.tipo ?? tipoDeArchivo(fila.nombre)
      const medidas = fila.miniatura ? { miniatura: fila.miniatura, ancho: fila.ancho, alto: fila.alto } : miniaturaDe(ruta, tipoMime)
      // Un adjunto que ya tenía id en el servidor (lo cargó esta PC cuando su ficha madre todavía no
      // tenía identidad, ver `registrarAdjunto`) lo conserva: pudo haber subido con ese id, y su ficha
      // tiene que decirlo.
      const vpsId = fila.vps_id ?? randomBytes(16).toString('hex')
      const filaId = `${PREFIJO_DE_ADJUNTO}${vpsId}`
      db()
        .prepare(`UPDATE ${tabla} SET fila_id = ?, vps_id = ?, sha256 = ?, tipo = ?, tamano = ?, miniatura = ?, ancho = ?, alto = ? WHERE id = ?`)
        .run(filaId, vpsId, sha256, tipoMime, contenido.length, medidas.miniatura, medidas.ancho, medidas.alto, fila.id)
      const enCamino = encolarFichaDelAdjunto(
        anexo,
        fila.padre_id,
        filaId,
        {
          fecha: fila.creado_en,
          nombre: fila.nombre,
          categoria: tipo === 'siniestro' ? nombreDeCategoria(fila.categoria ?? null, fila.categoria_detalle ?? null) : null,
          vpsId,
          tamano: contenido.length,
          sha256,
          usuario: fila.usuario_nombre,
          subidoEn: fila.vps_subido_en,
        },
        null,
      )
      if (enCamino) adjuntos++
    }
    void padre
  }

  let comentarios = 0
  const tareas = db()
    .prepare(`SELECT c.id, c.tarea_id FROM tarea_comentarios c JOIN tareas t ON t.id = c.tarea_id WHERE c.fila_id IS NULL AND t.fila_id IS NOT NULL ORDER BY c.id`)
    .all() as Array<{ id: number; tarea_id: number }>
  for (const c of tareas) if (registrarComentarioNuevo('tarea', c.tarea_id, c.id, null)) comentarios++
  const siniestros = db()
    .prepare(`SELECT o.id, o.siniestro_id FROM siniestro_observaciones o JOIN siniestros s ON s.id = o.siniestro_id WHERE o.fila_id IS NULL AND s.fila_id IS NOT NULL ORDER BY o.id`)
    .all() as Array<{ id: number; siniestro_id: number }>
  for (const o of siniestros) if (registrarComentarioNuevo('siniestro', o.siniestro_id, o.id, null)) comentarios++
  // 12.7: las notas de las consultas también viajan.
  const notas = db()
    .prepare(`SELECT n.id, n.lead_id FROM lead_notas n JOIN leads l ON l.id = n.lead_id WHERE n.fila_id IS NULL AND l.fila_id IS NOT NULL ORDER BY n.id`)
    .all() as Array<{ id: number; lead_id: number }>
  for (const n of notas) if (registrarComentarioNuevo('lead', n.lead_id, n.id, null)) comentarios++

  return { adjuntos, comentarios }
}
