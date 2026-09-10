// La mensajería interna de la agencia, del lado del programa.
//
// Qué resuelve. Hasta la 12.7, para avisarle algo a la otra sucursal había que llamar por teléfono o
// escribir por WhatsApp desde el celular personal. Lo que se dijo no quedaba en ningún lado: el que
// atiende al día siguiente no lo puede buscar, y si esa persona se va de la agencia se lleva la
// conversación con ella. Acá los mensajes son de la agencia, están en su base y el superadministrador
// los puede auditar.
//
// Cómo está armado, en tres piezas:
//
//   - **La verdad está en el VPS.** Postgres guarda las conversaciones, los mensajes y los dos acuses.
//     Esta base es un ESPEJO: sirve para leer sin internet y para que un mensaje escrito con la
//     conexión caída tenga dónde esperar. Nada de lo que hay acá es la última palabra sobre nada.
//   - **El cartero** (`mensajeria/cartero.ts`) es el que habla con el servidor: pregunta si hay algo
//     nuevo con un pedido que se queda esperando, y despacha lo que está en la cola.
//   - **Este archivo** es todo lo demás: guardar lo que llega, armar lo que la pantalla muestra y
//     decidir qué tilde le corresponde a cada mensaje.
//
// Dos decisiones que conviene tener presentes:
//
//   1. **Un mensaje con archivos sale recién cuando los archivos están arriba.** Mientras tanto se ve
//      en la pantalla del que lo escribió, con el reloj. Es a propósito: si el mensaje saliera primero,
//      el otro vería una burbuja con una foto que todavía no se puede abrir, y habría que inventar un
//      segundo camino para avisarle cuando llegara. Así, cuando el mensaje aparece del otro lado, todo
//      lo que tiene adentro se puede abrir.
//   2. **Abrir una conversación NUEVA necesita conexión**; mandar en una que ya existe, no. La
//      conversación directa entre dos personas es una sola en toda la agencia y quien decide cuál es,
//      es el servidor (ver `clave_directa`): dejar que dos computadoras sin internet la creen cada una
//      por su lado sería fabricar el problema de las dos conversaciones paralelas para después tener
//      que resolverlo.
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type {
  AcuseDeMensaje,
  AdjuntoDeMensaje,
  AvisosDeMensajes,
  ContactoDeMensajeria,
  ConversacionInterna,
  EstadoDeEnvio,
  EstadoDeMensajeria,
  FiltrosDelLogDeMensajes,
  HiloDeMensajes,
  LogDeMensajes,
  MensajeInterno,
  ParticipanteDeConversacion,
  ReaccionDeMensaje,
  SesionUsuario,
  TipoDeMensaje,
} from '../../shared/tipos'
import { claveDeUsuario, cuerpoDeMensajeLimpio, largoEnPuntos, resumenDeMensaje, MAXIMO_DE_UN_MENSAJE } from '../../shared/texto'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import type { ActorDelPuente, ConversacionRemota, MensajeRemoto } from '../mensajeria/puente'
import { puenteDeMensajes } from '../mensajeria/puente'
import type { ReaccionRemota } from '../vivo/protocolo'
import { adjuntosDe, asegurarAdjuntoLocal, borrarAdjuntoRegistrado, registrarAdjunto } from './adjuntos'
import { emitirATodas } from './avisos'
import { rutaDeAdjunto, tipoDeArchivo } from './carpetaDeAdjuntos'
import { ErrorDeNegocio } from './errores'
import { archivosParaAdjuntar } from './tareas'
import { enteroPositivo } from './validacion'

/** Cuántos mensajes trae el hilo de una vez. Más arriba se piden con «Ver anteriores». */
const MENSAJES_POR_PAGINA = 50
/** Cuántos renglones muestra por página el registro del superadministrador. */
const RENGLONES_DEL_LOG = 100
/**
 * Un GIF chico se manda entero a la pantalla para que se mueva; uno grande no. La miniatura de un GIF
 * es un JPEG del primer cuadro, o sea que se ve quieto, y un chat sin GIF que se mueva no es un chat.
 * Ocho megas es de sobra para cualquier GIF razonable y no llena la ventana de base64.
 */
const TOPE_DEL_GIF_ANIMADO = 8 * 1024 * 1024

// ---------------------------------------------------------------------------
// Quién es quién
// ---------------------------------------------------------------------------

export function actorDelPuente(actor: SesionUsuario): ActorDelPuente {
  return { clave: claveDeUsuario(actor.usuario), nombre: actor.nombre, rol: actor.rol }
}

interface FilaConversacion {
  id: number
  remoto_id: string
  clave: string | null
  tipo: 'DIRECTA' | 'GRUPO'
  titulo: string | null
  creado_por: string
  ultimo_mensaje_en: string | null
  creado_en: string
  actualizado_en: string
}

interface FilaMensaje {
  id: number
  remoto_id: string
  conversacion_id: number
  tipo: TipoDeMensaje
  orden: number | null
  autor_clave: string
  autor_nombre: string
  cuerpo: string
  estado: EstadoDeEnvio
  error: string | null
  intentos: number
  proximo_intento: string | null
  eliminado_en: string | null
  eliminado_por: string | null
  creado_en: string
  actualizado_en: string
}

// ---------------------------------------------------------------------------
// Guardar lo que llega del servidor
// ---------------------------------------------------------------------------

/**
 * Deja la conversación del servidor en esta base y devuelve su id local.
 *
 * `INSERT … ON CONFLICT(remoto_id) DO UPDATE`: la misma conversación puede llegar cien veces (viene en
 * cada vuelta del cartero) y tiene que actualizar, no duplicar.
 */
export function guardarConversacion(remota: ConversacionRemota): number {
  const ahora = ahoraIso()
  const base = db()
  const fila = base
    .prepare(
      `INSERT INTO conversaciones (remoto_id, clave, tipo, titulo, creado_por, ultimo_mensaje_en, creado_en, actualizado_en)
       VALUES (@remoto_id, @clave, @tipo, @titulo, @creado_por, @ultimo_mensaje_en, @creado_en, @actualizado_en)
       ON CONFLICT(remoto_id) DO UPDATE SET
         titulo = excluded.titulo,
         ultimo_mensaje_en = COALESCE(excluded.ultimo_mensaje_en, conversaciones.ultimo_mensaje_en),
         actualizado_en = excluded.actualizado_en
       RETURNING id`,
    )
    .get({
      remoto_id: remota.id,
      clave: remota.tipo === 'DIRECTA' ? [...remota.participantes.map((p) => p.clave)].sort().join('|') : null,
      tipo: remota.tipo,
      titulo: remota.titulo,
      creado_por: remota.creadoPor,
      ultimo_mensaje_en: remota.ultimoMensajeEn,
      creado_en: remota.creadoEn,
      actualizado_en: ahora,
    }) as { id: number }

  const guardarParticipante = base.prepare(
    `INSERT INTO conversacion_participantes (conversacion_id, usuario_clave, usuario_id, usuario_nombre, salio_en, creado_en)
     VALUES (@conversacion, @clave, @usuario_id, @nombre, @salio_en, @creado_en)
     ON CONFLICT(conversacion_id, usuario_clave) DO UPDATE SET
       usuario_nombre = excluded.usuario_nombre,
       usuario_id = COALESCE(excluded.usuario_id, conversacion_participantes.usuario_id),
       salio_en = excluded.salio_en`,
  )
  const buscarUsuario = base.prepare('SELECT id FROM usuarios WHERE usuario = ? COLLATE NOCASE')
  for (const participante of remota.participantes) {
    const local = buscarUsuario.get(participante.clave) as { id: number } | undefined
    guardarParticipante.run({
      conversacion: fila.id,
      clave: participante.clave,
      usuario_id: local?.id ?? null,
      nombre: participante.nombre,
      salio_en: participante.salioEn,
      creado_en: ahora,
    })
  }
  return fila.id
}

/**
 * Deja el mensaje del servidor en esta base y devuelve su id local, o null si la conversación todavía
 * no está acá (no debería pasar: el cartero guarda siempre las conversaciones primero).
 *
 * Lo que NO pisa nunca: el estado de un mensaje propio que todavía está en la cola. La computadora que
 * lo escribió sabe mejor que el servidor si ya salió de acá.
 */
export function guardarMensaje(remoto: MensajeRemoto, miClave: string): number | null {
  const base = db()
  const conversacion = base.prepare('SELECT id FROM conversaciones WHERE remoto_id = ?').get(remoto.conversacionId) as
    | { id: number }
    | undefined
  if (!conversacion) return null

  const ahora = ahoraIso()
  const mio = remoto.autorClave === miClave
  const fila = base
    .prepare(
      `INSERT INTO mensajes (remoto_id, conversacion_id, tipo, orden, autor_clave, autor_nombre, cuerpo, estado,
                             eliminado_en, eliminado_por, creado_en, actualizado_en)
       VALUES (@remoto_id, @conversacion, @tipo, @orden, @autor_clave, @autor_nombre, @cuerpo, @estado,
               @eliminado_en, @eliminado_por, @creado_en, @actualizado_en)
       ON CONFLICT(remoto_id) DO UPDATE SET
         orden = COALESCE(excluded.orden, mensajes.orden),
         cuerpo = CASE WHEN excluded.eliminado_en IS NULL THEN excluded.cuerpo ELSE mensajes.cuerpo END,
         eliminado_en = COALESCE(excluded.eliminado_en, mensajes.eliminado_en),
         eliminado_por = COALESCE(excluded.eliminado_por, mensajes.eliminado_por),
         -- Un mensaje que salió de acá ya no vuelve a 'enviado' por lo que diga el servidor: su tilde
         -- lo mueven los acuses. Y uno que todavía está en la cola tampoco: si el servidor lo tiene,
         -- es porque lo mandamos y el acuse va a llegar en la misma vuelta.
         estado = CASE WHEN mensajes.estado = 'enCola' THEN 'enviado' ELSE mensajes.estado END,
         error = CASE WHEN mensajes.estado = 'enCola' THEN NULL ELSE mensajes.error END,
         actualizado_en = excluded.actualizado_en
       RETURNING id`,
    )
    .get({
      remoto_id: remoto.id,
      conversacion: conversacion.id,
      // Un servidor viejo no manda `tipo`: lo que llega sin él es un mensaje común, que es lo que era.
      // Y uno que llega con un tipo que esta versión no conoce entra como común y no rompe la bajada:
      // el CHECK de la tabla (migración 29) sólo acepta los tres que están acá.
      tipo: remoto.tipo === 'ZUMBIDO' || remoto.tipo === 'LLAMADA' ? remoto.tipo : 'NORMAL',
      orden: remoto.orden,
      autor_clave: remoto.autorClave,
      autor_nombre: remoto.autorNombre,
      cuerpo: remoto.cuerpo,
      estado: mio ? 'enviado' : 'entregado',
      eliminado_en: remoto.eliminadoEn,
      eliminado_por: null,
      creado_en: remoto.creadoEn,
      actualizado_en: ahora,
    }) as { id: number }

  guardarAcuses(fila.id, remoto)
  guardarAdjuntosDelMensaje(fila.id, remoto)
  // Sólo si el servidor las mandó: uno anterior a la 14.0 no las conoce, y borrar las que hay porque no
  // vinieron sería hacerlas desaparecer de la pantalla en cada vuelta del cartero.
  if (remoto.reacciones) guardarReacciones(fila.id, remoto.reacciones)
  return fila.id
}

/**
 * Deja las reacciones de un mensaje exactamente como las manda el servidor: borra las que ya no están y
 * pone las que llegaron.
 *
 * Se guarda la lista COMPLETA y no el cambio, por lo mismo que en el resto de la mensajería: la verdad
 * está en el VPS y esto es un espejo. Dos personas sacando y poniendo el pulgar en el mismo instante no
 * pueden dejar a esta computadora con una cuenta que no existe en ningún lado.
 */
function guardarReacciones(mensajeId: number, reacciones: ReaccionRemota[]): void {
  const base = db()
  const ahora = ahoraIso()
  base.transaction(() => {
    const claves: string[] = []
    const poner = base.prepare(
      `INSERT INTO mensaje_reacciones (mensaje_id, clave, emoji, creado_en)
       VALUES (@mensaje, @clave, @emoji, @creado_en)
       ON CONFLICT(mensaje_id, clave) DO UPDATE SET emoji = excluded.emoji`,
    )
    for (const reaccion of reacciones) {
      const emoji = typeof reaccion?.emoji === 'string' ? reaccion.emoji : ''
      if (!emoji) continue
      for (const cruda of reaccion.claves ?? []) {
        const clave = claveDeUsuario(cruda)
        if (!clave) continue
        claves.push(clave)
        poner.run({ mensaje: mensajeId, clave, emoji, creado_en: ahora })
      }
    }
    if (!claves.length) {
      base.prepare('DELETE FROM mensaje_reacciones WHERE mensaje_id = ?').run(mensajeId)
      return
    }
    base
      .prepare(`DELETE FROM mensaje_reacciones WHERE mensaje_id = ? AND clave NOT IN (${claves.map(() => '?').join(', ')})`)
      .run(mensajeId, ...claves)
  })()
}

/**
 * Las reacciones que llegaron por el canal en vivo, buscando el mensaje por su id remoto (14.0).
 *
 * Devuelve false si ese mensaje no está en esta computadora, que pasa y no es un error: el canal le
 * avisa a todos los participantes, y uno puede no haber bajado todavía el mensaje al que reaccionaron.
 * Cuando lo baje, va a venir con sus reacciones adentro.
 */
export function aplicarReaccionesRemotas(mensajeRemotoId: string, reacciones: ReaccionRemota[]): boolean {
  const fila = db().prepare('SELECT id FROM mensajes WHERE remoto_id = ?').get(mensajeRemotoId) as
    | { id: number }
    | undefined
  if (!fila) return false
  guardarReacciones(fila.id, reacciones)
  return true
}

function guardarAcuses(mensajeId: number, remoto: MensajeRemoto): void {
  if (!remoto.acuses.length) return
  const guardar = db().prepare(
    `INSERT INTO mensaje_acuses (mensaje_id, usuario_clave, entregado_en, leido_en)
     VALUES (@mensaje, @clave, @entregado, @leido)
     ON CONFLICT(mensaje_id, usuario_clave) DO UPDATE SET
       entregado_en = COALESCE(excluded.entregado_en, mensaje_acuses.entregado_en),
       leido_en = COALESCE(excluded.leido_en, mensaje_acuses.leido_en)`,
  )
  for (const acuse of remoto.acuses) {
    guardar.run({ mensaje: mensajeId, clave: acuse.usuarioClave, entregado: acuse.entregadoEn, leido: acuse.leidoEn })
  }
}

/**
 * Guarda la ficha de cada archivo del mensaje, sin el archivo.
 *
 * `archivo = ''` es lo que hace que el adjunto se muestre como «está en el servidor» y se baje recién
 * la primera vez que alguien lo abre (`asegurarAdjuntoLocal`). `vps_subido_en` viene puesto porque un
 * mensaje sale del otro lado recién cuando sus archivos ya subieron: si está el mensaje, están los
 * archivos.
 *
 * El `ON CONFLICT` respeta la regla de `guardarAdjuntoDeLaHoja`: la computadora que TIENE el archivo
 * sabe mejor que una fila entrante si lo subió. Sin eso, la fila que vuelve del servidor podría marcar
 * como subido algo que esta computadora todavía no terminó de subir, y no se subiría nunca más.
 */
function guardarAdjuntosDelMensaje(mensajeId: number, remoto: MensajeRemoto): void {
  if (!remoto.adjuntos.length) return
  const ahora = ahoraIso()
  const guardar = db().prepare(
    `INSERT INTO mensaje_adjuntos (mensaje_id, nombre, archivo, tipo, tamano, sha256, ancho, alto, miniatura,
                                   vps_id, vps_subido_en, usuario_id, usuario_nombre, creado_en)
     VALUES (@mensaje, @nombre, '', @tipo, @tamano, @sha256, @ancho, @alto, @miniatura,
             @vps_id, @vps_subido_en, NULL, @usuario, @creado_en)
     -- El WHERE va repetido a propósito: el índice único de \`vps_id\` es PARCIAL
     -- (\`WHERE vps_id IS NOT NULL\`) y SQLite exige que el objetivo del ON CONFLICT diga lo mismo,
     -- si no contesta «ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint».
     ON CONFLICT(vps_id) WHERE vps_id IS NOT NULL DO UPDATE SET
       vps_subido_en = CASE WHEN mensaje_adjuntos.archivo <> '' THEN mensaje_adjuntos.vps_subido_en
                            ELSE COALESCE(mensaje_adjuntos.vps_subido_en, excluded.vps_subido_en) END,
       miniatura = COALESCE(mensaje_adjuntos.miniatura, excluded.miniatura)`,
  )
  for (const adjunto of remoto.adjuntos) {
    guardar.run({
      mensaje: mensajeId,
      nombre: adjunto.nombre,
      tipo: adjunto.tipo,
      tamano: adjunto.tamano,
      sha256: adjunto.sha256 || null,
      ancho: adjunto.ancho,
      alto: adjunto.alto,
      miniatura: adjunto.miniatura ? `data:image/jpeg;base64,${adjunto.miniatura}` : null,
      vps_id: adjunto.id,
      vps_subido_en: ahora,
      usuario: remoto.autorNombre,
      creado_en: remoto.creadoEn,
    })
  }
}

/** Aplica los acuses que llegaron sueltos (los de mis propios mensajes). Devuelve cuántos movieron algo. */
export function guardarAcusesSueltos(
  acuses: { mensajeId: string; usuarioClave: string; entregadoEn: string | null; leidoEn: string | null }[],
): number {
  if (!acuses.length) return 0
  const base = db()
  const buscar = base.prepare('SELECT id FROM mensajes WHERE remoto_id = ?')
  const guardar = base.prepare(
    `INSERT INTO mensaje_acuses (mensaje_id, usuario_clave, entregado_en, leido_en)
     VALUES (@mensaje, @clave, @entregado, @leido)
     ON CONFLICT(mensaje_id, usuario_clave) DO UPDATE SET
       entregado_en = COALESCE(excluded.entregado_en, mensaje_acuses.entregado_en),
       leido_en = COALESCE(excluded.leido_en, mensaje_acuses.leido_en)`,
  )
  let movidos = 0
  for (const acuse of acuses) {
    const mensaje = buscar.get(acuse.mensajeId) as { id: number } | undefined
    if (!mensaje) continue
    guardar.run({
      mensaje: mensaje.id,
      clave: acuse.usuarioClave,
      entregado: acuse.entregadoEn,
      leido: acuse.leidoEn,
    })
    movidos++
  }
  return movidos
}

// ---------------------------------------------------------------------------
// De la base a la pantalla
// ---------------------------------------------------------------------------

/**
 * En qué anda un mensaje propio, mirando los acuses de los demás.
 *
 * Vale el que MENOS avanzó: en un grupo de cuatro, si tres lo leyeron y uno todavía no lo recibió, el
 * mensaje está «enviado». Es lo que hace cualquier chat y es lo que la gente entiende: el tilde doble
 * en color significa «lo vieron todos», no «lo vio alguno».
 */
function estadoSegunAcuses(estadoGuardado: EstadoDeEnvio, acuses: AcuseDeMensaje[]): EstadoDeEnvio {
  if (estadoGuardado === 'enCola' || estadoGuardado === 'fallado') return estadoGuardado
  if (!acuses.length) return 'enviado'
  if (acuses.every((acuse) => acuse.leidoEn)) return 'leido'
  if (acuses.every((acuse) => acuse.entregadoEn)) return 'entregado'
  return 'enviado'
}

function adjuntosDelMensaje(mensajeId: number): AdjuntoDeMensaje[] {
  return adjuntosDe('mensaje', mensajeId).map((adjunto) => ({
    id: adjunto.id,
    nombre: adjunto.nombre,
    tipo: adjunto.tipo,
    tamano: adjunto.tamano,
    descargado: adjunto.descargado,
    enElServidor: adjunto.enElServidor,
    enOtraComputadora: adjunto.enOtraComputadora,
    error: adjunto.errorDelServidor,
    miniatura: adjunto.miniatura,
    ancho: adjunto.ancho,
    alto: adjunto.alto,
  }))
}

function acusesDelMensaje(mensajeId: number, conversacionId: number): AcuseDeMensaje[] {
  const filas = db()
    .prepare(
      `SELECT a.usuario_clave, a.entregado_en, a.leido_en,
              COALESCE(p.usuario_nombre, a.usuario_clave) AS nombre
         FROM mensaje_acuses a
         LEFT JOIN conversacion_participantes p
                ON p.conversacion_id = ? AND p.usuario_clave = a.usuario_clave
        WHERE a.mensaje_id = ?
        ORDER BY nombre`,
    )
    .all(conversacionId, mensajeId) as Array<{
    usuario_clave: string
    entregado_en: string | null
    leido_en: string | null
    nombre: string
  }>
  return filas.map((fila) => ({
    clave: fila.usuario_clave,
    nombre: fila.nombre,
    entregadoEn: fila.entregado_en,
    leidoEn: fila.leido_en,
  }))
}

/**
 * Las reacciones de un mensaje, ya agrupadas por emoji y con los nombres puestos.
 *
 * El nombre sale de los participantes de la conversación, igual que en los acuses: la tabla guarda la
 * clave (que es la identidad entre computadoras) y quien mira quiere leer «Ana», no «ana». Si la
 * persona ya no está en la conversación queda su clave, que es mejor que un renglón vacío.
 *
 * Se ordenan por cantidad y, a igual cantidad, por el orden en que aparecieron: así la pastilla más
 * puesta va primera y la fila no se reacomoda sola cada vez que alguien suma un pulgar.
 */
function reaccionesDelMensaje(mensajeId: number, conversacionId: number, miClave: string): ReaccionDeMensaje[] {
  const filas = db()
    .prepare(
      `SELECT r.clave, r.emoji, COALESCE(p.usuario_nombre, r.clave) AS nombre
         FROM mensaje_reacciones r
         LEFT JOIN conversacion_participantes p
                ON p.conversacion_id = ? AND p.usuario_clave = r.clave
        WHERE r.mensaje_id = ?
        ORDER BY r.creado_en, r.clave`,
    )
    .all(conversacionId, mensajeId) as Array<{ clave: string; emoji: string; nombre: string }>

  const porEmoji = new Map<string, ReaccionDeMensaje>()
  for (const fila of filas) {
    const grupo = porEmoji.get(fila.emoji) ?? { emoji: fila.emoji, claves: [], nombres: [], mia: false }
    grupo.claves.push(fila.clave)
    grupo.nombres.push(fila.nombre)
    if (fila.clave === miClave) grupo.mia = true
    porEmoji.set(fila.emoji, grupo)
  }
  return [...porEmoji.values()].sort((a, b) => b.claves.length - a.claves.length)
}

function aMensaje(fila: FilaMensaje, miClave: string): MensajeInterno {
  const mio = fila.autor_clave === miClave
  // Los acuses de un mensaje ajeno no son asunto de quien mira: sólo el autor ve quién le leyó qué.
  const acuses = mio ? acusesDelMensaje(fila.id, fila.conversacion_id) : []
  return {
    id: fila.id,
    tipo: fila.tipo,
    remotoId: fila.remoto_id,
    conversacionId: fila.conversacion_id,
    autorClave: fila.autor_clave,
    autorNombre: fila.autor_nombre,
    mio,
    cuerpo: fila.eliminado_en ? '' : fila.cuerpo,
    creadoEn: fila.creado_en,
    estado: mio ? estadoSegunAcuses(fila.estado, acuses) : 'entregado',
    error: fila.error,
    eliminadoEn: fila.eliminado_en,
    adjuntos: fila.eliminado_en ? [] : adjuntosDelMensaje(fila.id),
    acuses,
    // Un mensaje borrado no muestra reacciones: no queda nada a lo que estén pegadas.
    reacciones: fila.eliminado_en ? [] : reaccionesDelMensaje(fila.id, fila.conversacion_id, miClave),
  }
}

function participantesDe(conversacionId: number): ParticipanteDeConversacion[] {
  const filas = db()
    .prepare(
      `SELECT usuario_clave, usuario_id, usuario_nombre, salio_en
         FROM conversacion_participantes WHERE conversacion_id = ? ORDER BY usuario_nombre`,
    )
    .all(conversacionId) as Array<{ usuario_clave: string; usuario_id: number | null; usuario_nombre: string; salio_en: string | null }>
  return filas.map((fila) => ({
    clave: fila.usuario_clave,
    nombre: fila.usuario_nombre,
    usuarioId: fila.usuario_id,
    salioEn: fila.salio_en,
  }))
}

/** Cómo se llama la conversación en la lista: el nombre del grupo, o el de la otra persona. */
function tituloDe(fila: FilaConversacion, participantes: ParticipanteDeConversacion[], miClave: string): string {
  if (fila.tipo === 'GRUPO') return fila.titulo ?? 'Grupo'
  const otro = participantes.find((participante) => participante.clave !== miClave)
  return otro?.nombre ?? fila.titulo ?? 'Conversación'
}

function aConversacion(fila: FilaConversacion, miClave: string): ConversacionInterna {
  const participantes = participantesDe(fila.id)
  const ultimo = db()
    .prepare(
      `SELECT tipo, cuerpo, autor_clave, creado_en, eliminado_en,
              (SELECT COUNT(*) FROM mensaje_adjuntos WHERE mensaje_id = m.id) AS adjuntos
         FROM mensajes m WHERE conversacion_id = ?
        ORDER BY COALESCE(orden, 9223372036854775807) DESC, id DESC LIMIT 1`,
    )
    .get(fila.id) as
    | {
        tipo: TipoDeMensaje
        cuerpo: string
        autor_clave: string
        creado_en: string
        eliminado_en: string | null
        adjuntos: number
      }
    | undefined

  const sinLeer = (
    db()
      .prepare(
        `SELECT COUNT(*) AS cuantos FROM mensajes m
          WHERE m.conversacion_id = ? AND m.autor_clave <> ? AND m.eliminado_en IS NULL
            AND m.tipo <> 'ZUMBIDO'
            AND NOT EXISTS (SELECT 1 FROM mensaje_acuses a WHERE a.mensaje_id = m.id AND a.usuario_clave = ? AND a.leido_en IS NOT NULL)`,
      )
      .get(fila.id, miClave, miClave) as { cuantos: number }
  ).cuantos

  const texto = !ultimo
    ? ''
    : ultimo.eliminado_en
      ? 'Se eliminó este mensaje'
      : // Un zumbido no tiene texto: sin este renglón la lista diría «0 archivos», que no dice nada.
        ultimo.tipo === 'ZUMBIDO'
        ? 'Zumbido'
        : ultimo.cuerpo
          ? resumenDeMensaje(ultimo.cuerpo)
          : ultimo.adjuntos === 1
            ? 'Un archivo'
            : `${ultimo.adjuntos} archivos`

  return {
    id: fila.id,
    remotoId: fila.remoto_id,
    tipo: fila.tipo,
    titulo: tituloDe(fila, participantes, miClave),
    participantes,
    ultimoTexto: texto,
    ultimoEn: ultimo?.creado_en ?? fila.ultimo_mensaje_en,
    ultimoMio: ultimo?.autor_clave === miClave,
    sinLeer,
  }
}

// ---------------------------------------------------------------------------
// Lo que pide la pantalla
// ---------------------------------------------------------------------------

function miClaveDe(actor: SesionUsuario): string {
  return claveDeUsuario(actor.usuario)
}

export function conversacionesDe(actor: SesionUsuario): ConversacionInterna[] {
  const miClave = miClaveDe(actor)
  const filas = db()
    .prepare(
      `SELECT c.* FROM conversaciones c
         JOIN conversacion_participantes p ON p.conversacion_id = c.id
        WHERE p.usuario_clave = ? AND p.salio_en IS NULL
        ORDER BY COALESCE(c.ultimo_mensaje_en, c.creado_en) DESC`,
    )
    .all(miClave) as FilaConversacion[]
  return filas.map((fila) => aConversacion(fila, miClave))
}

/** Con quién se puede hablar: los usuarios activos de la agencia, menos uno mismo. */
export function contactosDe(actor: SesionUsuario): ContactoDeMensajeria[] {
  const filas = db()
    .prepare(
      `SELECT u.nombre, u.usuario, u.rol, s.nombre AS sucursal
         FROM usuarios u LEFT JOIN sucursales s ON s.id = u.sucursal_id
        WHERE u.activo = 1 AND u.usuario <> ? COLLATE NOCASE
        ORDER BY u.nombre`,
    )
    .all(actor.usuario) as Array<{ nombre: string; usuario: string; rol: ContactoDeMensajeria['rol']; sucursal: string | null }>
  return filas.map((fila) => ({
    clave: claveDeUsuario(fila.usuario),
    nombre: fila.nombre,
    usuario: fila.usuario,
    rol: fila.rol,
    sucursal: fila.sucursal,
  }))
}

function conversacionLocal(conversacionId: number, miClave: string): FilaConversacion {
  const fila = db().prepare('SELECT * FROM conversaciones WHERE id = ?').get(conversacionId) as FilaConversacion | undefined
  if (!fila) throw new ErrorDeNegocio('Esa conversación no existe en esta computadora.')
  const participa = db()
    .prepare('SELECT 1 FROM conversacion_participantes WHERE conversacion_id = ? AND usuario_clave = ? AND salio_en IS NULL')
    .get(conversacionId, miClave)
  if (!participa) throw new ErrorDeNegocio('No participás de esa conversación.')
  return fila
}

/**
 * Trae del servidor la página de mensajes que corresponde y la guarda acá.
 *
 * Hace falta porque el reparto sólo entrega lo que está PENDIENTE para esta persona: una computadora
 * recién instalada, o una a la que alguien entra por primera vez, no tiene nada de lo que se habló
 * antes, y sin esto la conversación se vería vacía. También es lo que trae los mensajes que esa misma
 * persona escribió desde otra computadora, que tampoco vienen por el reparto (quien los escribió no
 * tiene acuse propio).
 *
 * Es «lo mejor que se pueda»: sin conexión no falla, sólo no trae nada. Lo que ya está guardado acá se
 * sigue leyendo igual, que es la razón de que exista el espejo local.
 */
async function traerHistorial(actor: SesionUsuario, conversacionId: number, antesDeOrden: number | null): Promise<void> {
  const puente = puenteDeMensajes()
  if (!puente) return
  const fila = db().prepare('SELECT remoto_id FROM conversaciones WHERE id = ?').get(conversacionId) as
    | { remoto_id: string }
    | undefined
  if (!fila) return
  try {
    const { mensajes } = await puente.historial(actorDelPuente(actor), {
      conversacion: fila.remoto_id,
      antesDe: antesDeOrden ?? undefined,
      limite: MENSAJES_POR_PAGINA,
    })
    const miClave = miClaveDe(actor)
    for (const remoto of mensajes) guardarMensaje(remoto, miClave)
  } catch (error) {
    // Sin internet, o el servidor caído: se muestra lo que hay guardado. No es un error de la pantalla.
    console.error('[mensajería] No se pudo traer el historial:', error instanceof Error ? error.message : error)
  }
}

export async function hiloDe(
  actor: SesionUsuario,
  conversacionId: number,
  antesDeId: number | null = null,
): Promise<HiloDeMensajes> {
  const miClave = miClaveDe(actor)
  const id = enteroPositivo(conversacionId, 'La conversación')
  conversacionLocal(id, miClave)

  // Antes de dibujar, se le pide al servidor la página que corresponde: es lo que hace que una
  // computadora nueva vea la conversación entera y no sólo lo que llegó desde que se instaló.
  const desde = antesDeId
    ? ((db().prepare('SELECT orden FROM mensajes WHERE id = ?').get(antesDeId) as { orden: number | null } | undefined)?.orden ?? null)
    : null
  await traerHistorial(actor, id, desde)

  const fila = conversacionLocal(id, miClave)

  // Se piden uno más que los que se muestran: si viene, es que arriba hay más.
  // Se pagina por el mismo `orden` con el que se ordena y NO por el `id` local: cuando el historial
  // trae mensajes viejos del servidor, esos quedan con ids locales altos, y paginar por id se saltearía
  // justo los que se acaban de traer.
  const filas = db()
    .prepare(
      `SELECT * FROM mensajes
        WHERE conversacion_id = @conversacion
          ${antesDeId ? 'AND COALESCE(orden, 9223372036854775807) < (SELECT COALESCE(orden, 9223372036854775807) FROM mensajes WHERE id = @antesDe)' : ''}
        ORDER BY COALESCE(orden, 9223372036854775807) DESC, id DESC
        LIMIT @limite`,
    )
    .all({ conversacion: id, antesDe: antesDeId ?? 0, limite: MENSAJES_POR_PAGINA + 1 }) as FilaMensaje[]

  const hayMas = filas.length > MENSAJES_POR_PAGINA
  const visibles = (hayMas ? filas.slice(0, MENSAJES_POR_PAGINA) : filas).reverse()
  return {
    conversacion: aConversacion(fila, miClave),
    mensajes: visibles.map((mensaje) => aMensaje(mensaje, miClave)),
    hayMas,
  }
}

/**
 * Lo que mira la campana de la barra: los mensajes sin leer.
 *
 * **El zumbido no cuenta**, por dos motivos. Uno: ya se anunció mucho más fuerte que un globito rojo
 * —sonó, sacudió la ventana, salió el cartel de Windows y parpadeó el ícono—, y dejar un «1 sin leer»
 * obliga a abrir la conversación para apagar un aviso de algo que no tiene nada para leer. Dos: la
 * campana suena sola cuando aparece un id nuevo (`useAvisoNuevo`), así que un zumbido contado acá
 * haría sonar la campana ENCIMA del zumbido, dos avisos pisados por una sola cosa.
 *
 * Sí se marca como leído junto con el resto al abrir la conversación: el que lo mandó tiene que ver el
 * tilde cuando el otro efectivamente miró.
 */
export function avisosDe(actor: SesionUsuario): AvisosDeMensajes {
  const miClave = miClaveDe(actor)
  const ids = (
    db()
      .prepare(
        `SELECT m.id FROM mensajes m
           JOIN conversacion_participantes p ON p.conversacion_id = m.conversacion_id AND p.usuario_clave = @yo AND p.salio_en IS NULL
          WHERE m.autor_clave <> @yo AND m.eliminado_en IS NULL
            AND m.tipo <> 'ZUMBIDO'
            AND NOT EXISTS (SELECT 1 FROM mensaje_acuses a WHERE a.mensaje_id = m.id AND a.usuario_clave = @yo AND a.leido_en IS NOT NULL)
          ORDER BY m.id`,
      )
      .all({ yo: miClave }) as Array<{ id: number }>
  ).map((fila) => fila.id)

  const conversaciones = conversacionesDe(actor).filter((conversacion) => conversacion.sinLeer > 0)
  return { sinLeer: ids.length, ids, conversaciones }
}

// ---------------------------------------------------------------------------
// Abrir una conversación
// ---------------------------------------------------------------------------

function exigirPuente() {
  const puente = puenteDeMensajes()
  if (!puente) {
    throw new ErrorDeNegocio(
      'La mensajería necesita la conexión con el servidor de la agencia, y en esta computadora no está configurada.',
    )
  }
  return puente
}

export async function abrirConversacionCon(actor: SesionUsuario, claveDestino: unknown): Promise<ConversacionInterna> {
  const miClave = miClaveDe(actor)
  const destino = claveDeUsuario(claveDestino)
  if (!destino) throw new ErrorDeNegocio('Elegí a quién le querés escribir.')
  if (destino === miClave) throw new ErrorDeNegocio('No se puede abrir una conversación con uno mismo.')

  const contacto = contactosDe(actor).find((candidato) => candidato.clave === destino)
  if (!contacto) throw new ErrorDeNegocio('Esa persona no está en el listado de usuarios de la agencia.')

  const remota = await exigirPuente().abrirDirecta(
    actorDelPuente(actor),
    { clave: destino, nombre: contacto.nombre },
    randomUUID(),
  )
  const id = guardarConversacion(remota)
  return aConversacion(db().prepare('SELECT * FROM conversaciones WHERE id = ?').get(id) as FilaConversacion, miClave)
}

export async function crearGrupoDeMensajes(
  actor: SesionUsuario,
  titulo: unknown,
  claves: unknown,
): Promise<ConversacionInterna> {
  const miClave = miClaveDe(actor)
  const nombre = typeof titulo === 'string' ? titulo.trim() : ''
  if (!nombre) throw new ErrorDeNegocio('El grupo necesita un nombre.')

  const contactos = contactosDe(actor)
  const pedidas = Array.isArray(claves) ? claves.map(claveDeUsuario).filter(Boolean) : []
  const participantes = contactos.filter((contacto) => pedidas.includes(contacto.clave))
  if (!participantes.length) throw new ErrorDeNegocio('Elegí por lo menos una persona para el grupo.')

  const remota = await exigirPuente().crearGrupo(actorDelPuente(actor), {
    titulo: nombre,
    participantes: participantes.map((contacto) => ({ clave: contacto.clave, nombre: contacto.nombre })),
    id: randomUUID(),
  })
  const id = guardarConversacion(remota)
  return aConversacion(db().prepare('SELECT * FROM conversaciones WHERE id = ?').get(id) as FilaConversacion, miClave)
}

/**
 * La conversación de a dos que se quiere llamar por voz, con quién está del otro lado (14.0).
 *
 * Vive acá y no en `vivo/llamadas.ts` porque quién participa de una conversación es asunto de la
 * mensajería: la llamada sólo necesita saber a quién invitar y con qué id de conversación —el REMOTO,
 * el que conocen las cinco computadoras y el servidor—.
 *
 * Sólo DIRECTA: una llamada de a dos es una conversación con una sola persona del otro lado. Los grupos
 * quedan para cuando haya con qué mezclar tres audios.
 */
export function directaParaLlamar(
  actor: SesionUsuario,
  conversacionId: unknown,
): { remotoId: string; con: { clave: string; nombre: string } } {
  const miClave = miClaveDe(actor)
  const id = enteroPositivo(conversacionId, 'La conversación')
  const fila = conversacionLocal(id, miClave)
  if (fila.tipo !== 'DIRECTA') {
    throw new ErrorDeNegocio('Las llamadas de voz son de a dos: en un grupo todavía no se puede.')
  }
  const otro = participantesDe(fila.id).find((participante) => participante.clave !== miClave && !participante.salioEn)
  if (!otro) throw new ErrorDeNegocio('Esa conversación no tiene a nadie del otro lado.')
  return { remotoId: fila.remoto_id, con: { clave: otro.clave, nombre: otro.nombre } }
}

// ---------------------------------------------------------------------------
// Mandar
// ---------------------------------------------------------------------------

/**
 * Deja el mensaje en la cola de salida y devuelve cómo se ve en la pantalla.
 *
 * No habla con el servidor: eso lo hace el cartero en la vuelta siguiente (o en el momento, si está
 * despierto). Así, escribir un mensaje nunca se queda esperando a la red, y uno escrito sin internet
 * se manda solo cuando vuelve.
 */
export function encolarMensaje(
  actor: SesionUsuario,
  datos: { conversacionId: unknown; cuerpo: unknown; archivos?: unknown; rutas?: unknown },
): MensajeInterno {
  const miClave = miClaveDe(actor)
  const conversacionId = enteroPositivo(datos.conversacionId, 'La conversación')
  conversacionLocal(conversacionId, miClave)

  const cuerpo = cuerpoDeMensajeLimpio(datos.cuerpo)
  if (largoEnPuntos(typeof datos.cuerpo === 'string' ? datos.cuerpo : '') > MAXIMO_DE_UN_MENSAJE) {
    throw new ErrorDeNegocio(`El mensaje no puede pasar de ${MAXIMO_DE_UN_MENSAJE} caracteres.`)
  }
  // Una lista VACÍA es «sin archivos», que en un chat es el caso normal: casi todos los mensajes son
  // sólo texto. `archivosParaAdjuntar` es el validador de las pantallas donde adjuntar es la acción
  // (una tarea, un siniestro) y ahí una lista vacía sí es un error —«No elegiste ningún archivo»—, así
  // que hay que preguntar antes de llamarlo. Sin esto no salía NINGÚN mensaje: la pantalla siempre
  // manda la lista, vacía cuando no se arrastró nada, y el envío moría antes de mirar el texto.
  const sinArchivos = datos.archivos === undefined || (Array.isArray(datos.archivos) && datos.archivos.length === 0)
  const archivos = sinArchivos ? [] : archivosParaAdjuntar(datos.archivos)
  const rutas = Array.isArray(datos.rutas) ? datos.rutas.filter((ruta): ruta is string => typeof ruta === 'string') : []
  if (!cuerpo && !archivos.length && !rutas.length) throw new ErrorDeNegocio('El mensaje está vacío.')

  const ahora = ahoraIso()
  const { id } = db()
    .prepare(
      `INSERT INTO mensajes (remoto_id, conversacion_id, orden, autor_clave, autor_nombre, cuerpo, estado, creado_en, actualizado_en)
       VALUES (@remoto_id, @conversacion, NULL, @clave, @nombre, @cuerpo, 'enCola', @ahora, @ahora)
       RETURNING id`,
    )
    .get({
      remoto_id: randomUUID(),
      conversacion: conversacionId,
      clave: miClave,
      nombre: actor.nombre,
      cuerpo,
      ahora,
    }) as { id: number }

  for (const archivo of archivos) registrarAdjunto('mensaje', id, archivo, actor)
  for (const ruta of rutas) {
    if (!existsSync(ruta)) throw new ErrorDeNegocio(`No se encontró el archivo «${ruta}».`)
    const nombre = ruta.split(/[\\/]/).pop() ?? 'archivo'
    registrarAdjunto('mensaje', id, { nombre, tipo: tipoDeArchivo(nombre), contenido: readFileSync(ruta) }, actor)
  }

  db().prepare('UPDATE conversaciones SET ultimo_mensaje_en = ?, actualizado_en = ? WHERE id = ?').run(ahora, ahora, conversacionId)
  return aMensaje(db().prepare('SELECT * FROM mensajes WHERE id = ?').get(id) as FilaMensaje, miClave)
}

/**
 * Cuánto hay que esperar entre dos zumbidos propios en la misma conversación.
 *
 * El zumbido es la única cosa del programa que le mueve la ventana a otra persona, así que es también
 * la única que se puede usar para hacerle la vida imposible a alguien. Diez segundos alcanzan para que
 * sirva —se manda uno, se espera a que conteste— y no para mandar veinte seguidos. El servidor tiene el
 * mismo tope y es el que manda: éste es para que el «esperá» salga en el momento, sin ida y vuelta.
 */
export const ESPERA_ENTRE_ZUMBIDOS_MS = 10_000

/**
 * El zumbido: el de Messenger, el que suena fuerte y le mueve la ventana al otro.
 *
 * **No pasa por la cola.** Es lo único de la mensajería que habla con el servidor en el momento, y es
 * a propósito: un zumbido sirve para decir «mirá esto AHORA». Uno que sale de la cola veinte minutos
 * después, cuando volvió el internet, no llama la atención sobre nada —sacude una ventana por algo que
 * ya pasó—. Sin conexión, entonces, no se manda y se dice por qué; el mensaje escrito, en cambio, sigue
 * esperando en la cola como siempre.
 *
 * Queda guardado igual que cualquier otro mensaje: se ve en el hilo de los dos, cuenta en los acuses y
 * está en el registro del superadministrador. Un zumbido es algo que una persona le hizo a otra en el
 * trabajo, y eso se audita como todo lo demás.
 */
export async function zumbar(actor: SesionUsuario, conversacionId: unknown): Promise<MensajeInterno> {
  const miClave = miClaveDe(actor)
  const id = enteroPositivo(conversacionId, 'La conversación')
  const conversacion = conversacionLocal(id, miClave)

  const ultimo = db()
    .prepare(
      `SELECT creado_en FROM mensajes
        WHERE conversacion_id = ? AND autor_clave = ? AND tipo = 'ZUMBIDO'
        ORDER BY id DESC LIMIT 1`,
    )
    .get(id, miClave) as { creado_en: string } | undefined
  if (ultimo) {
    const faltan = ESPERA_ENTRE_ZUMBIDOS_MS - (Date.now() - new Date(ultimo.creado_en).getTime())
    if (faltan > 0) throw new ErrorDeNegocio(`Esperá ${Math.ceil(faltan / 1000)} segundos para mandar otro zumbido.`)
  }

  const { mensaje } = await exigirPuente().enviar(actorDelPuente(actor), {
    id: randomUUID(),
    conversacionId: conversacion.remoto_id,
    tipo: 'ZUMBIDO',
    cuerpo: '',
    enviadoEn: ahoraIso(),
    adjuntos: [],
  })
  const local = guardarMensaje(mensaje, miClave)
  if (local === null) throw new ErrorDeNegocio('El zumbido salió, pero esta computadora no pudo guardarlo.')

  const ahora = ahoraIso()
  db().prepare('UPDATE conversaciones SET ultimo_mensaje_en = ?, actualizado_en = ? WHERE id = ?').run(ahora, ahora, id)
  return aMensaje(db().prepare('SELECT * FROM mensajes WHERE id = ?').get(local) as FilaMensaje, miClave)
}

/** Cuánto puede medir un emoji de reacción. Alcanza para una bandera o una familia; no para un texto. */
const TOPE_DEL_EMOJI = 16

/**
 * Pone, cambia o saca MI reacción a un mensaje (14.0): el pulgar de WhatsApp.
 *
 * **No pasa por la cola**, igual que el zumbido: habla con el servidor en el momento y, sin conexión,
 * no se manda y se dice por qué. Una reacción que sale de la cola veinte minutos después llegaría a una
 * conversación que ya siguió de largo, y sobre todo: la cola es para lo que se ESCRIBIÓ, y una reacción
 * es un tilde sobre algo de otro. El candado de la conexión lo pone `exigirEdicion` en `ipc.ts`.
 *
 * Con `emoji` en null —o con el mismo que ya estaba— la saca; con otro, la reemplaza. Quien decide es
 * el servidor: acá se aplica lo que contesta, que es la lista completa del mensaje.
 *
 * El aviso a la pantalla es `mensajes:cambiaron` y no `mensajes:llegaron`: la conversación se redibuja
 * SIN sonar y sin saltar arriba de la lista. Una reacción no es un mensaje.
 */
export async function reaccionarA(actor: SesionUsuario, mensajeId: unknown, emoji: unknown): Promise<MensajeInterno> {
  const miClave = miClaveDe(actor)
  const id = enteroPositivo(mensajeId, 'El mensaje')
  const fila = db().prepare('SELECT * FROM mensajes WHERE id = ?').get(id) as FilaMensaje | undefined
  if (!fila) throw new ErrorDeNegocio('Ese mensaje ya no está en esta computadora.')
  conversacionLocal(fila.conversacion_id, miClave)
  if (fila.eliminado_en) throw new ErrorDeNegocio('Ese mensaje se borró: ya no se le puede reaccionar.')
  if (!fila.remoto_id || fila.estado === 'enCola' || fila.estado === 'fallado') {
    throw new ErrorDeNegocio('Ese mensaje todavía no salió de esta computadora: esperá a que se mande.')
  }

  let elegido: string | null = null
  if (emoji !== null && emoji !== undefined && emoji !== '') {
    if (typeof emoji !== 'string') throw new ErrorDeNegocio('Esa reacción no se entiende.')
    const limpio = emoji.trim()
    if (largoEnPuntos(limpio) > TOPE_DEL_EMOJI) throw new ErrorDeNegocio('Una reacción es un emoji, no un texto.')
    elegido = limpio || null
  }

  const respuesta = await exigirPuente().reaccionar(actorDelPuente(actor), fila.remoto_id, elegido)
  guardarReacciones(id, respuesta.reacciones)
  emitirATodas('mensajes:cambiaron', null)
  return aMensaje(db().prepare('SELECT * FROM mensajes WHERE id = ?').get(id) as FilaMensaje, miClave)
}

/**
 * Los mensajes propios que están esperando salir, con sus archivos ya arriba.
 *
 * La condición del `NOT EXISTS` es la que sostiene la decisión de arriba: mientras a un mensaje le
 * quede un archivo sin subir, el mensaje no sale. Los archivos los sube la tubería de siempre
 * (`subirAdjuntosPendientes`), con sus reintentos y sus esperas crecientes.
 */
export function mensajesListosParaSalir(miClave: string, ahora: string): FilaMensaje[] {
  return db()
    .prepare(
      `SELECT m.* FROM mensajes m
        WHERE m.estado = 'enCola' AND m.autor_clave = @yo
          AND (m.proximo_intento IS NULL OR m.proximo_intento <= @ahora)
          AND NOT EXISTS (
            SELECT 1 FROM mensaje_adjuntos a WHERE a.mensaje_id = m.id AND a.vps_subido_en IS NULL
          )
        ORDER BY m.id
        LIMIT 20`,
    )
    .all({ yo: miClave, ahora }) as FilaMensaje[]
}

/** Cuántos mensajes hay esperando salir (los que tienen archivos a medio subir, también). */
export function cuantosEnCola(miClave: string): number {
  return (
    db().prepare("SELECT COUNT(*) AS cuantos FROM mensajes WHERE estado = 'enCola' AND autor_clave = ?").get(miClave) as {
      cuantos: number
    }
  ).cuantos
}

/** Lo que hay que mandarle al servidor de un mensaje de la cola: su texto y las fichas de sus archivos. */
export function paraMandar(fila: FilaMensaje): {
  id: string
  conversacionId: string
  tipo: TipoDeMensaje
  cuerpo: string
  enviadoEn: string
  adjuntos: { id: string; nombre: string; tipo: string; tamano: number; sha256: string; ancho: number | null; alto: number | null; miniatura: string | null }[]
} {
  const conversacion = db().prepare('SELECT remoto_id FROM conversaciones WHERE id = ?').get(fila.conversacion_id) as
    | { remoto_id: string }
    | undefined
  if (!conversacion) throw new ErrorDeNegocio('La conversación del mensaje desapareció de esta computadora.')

  const adjuntos = db()
    .prepare(
      `SELECT vps_id, nombre, tipo, tamano, sha256, ancho, alto, miniatura
         FROM mensaje_adjuntos WHERE mensaje_id = ? AND vps_id IS NOT NULL ORDER BY id`,
    )
    .all(fila.id) as Array<{
    vps_id: string
    nombre: string
    tipo: string | null
    tamano: number
    sha256: string | null
    ancho: number | null
    alto: number | null
    miniatura: string | null
  }>

  return {
    id: fila.remoto_id,
    conversacionId: conversacion.remoto_id,
    tipo: fila.tipo,
    cuerpo: fila.cuerpo,
    enviadoEn: fila.creado_en,
    adjuntos: adjuntos.map((adjunto) => ({
      id: adjunto.vps_id,
      nombre: adjunto.nombre,
      tipo: adjunto.tipo ?? 'application/octet-stream',
      tamano: adjunto.tamano,
      sha256: adjunto.sha256 ?? '',
      ancho: adjunto.ancho,
      alto: adjunto.alto,
      // La miniatura se guarda como data: URL para la pantalla; al servidor va el base64 pelado.
      miniatura: adjunto.miniatura?.replace(/^data:[^,]*,/, '') ?? null,
    })),
  }
}

export function marcarComoEnviado(mensajeId: number, orden: number): void {
  db()
    .prepare("UPDATE mensajes SET estado = 'enviado', error = NULL, orden = ?, proximo_intento = NULL, actualizado_en = ? WHERE id = ?")
    .run(orden, ahoraIso(), mensajeId)
}

/** Un rechazo que no se arregla reintentando: el mensaje queda con el motivo a la vista. */
export function marcarComoFallado(mensajeId: number, motivo: string): void {
  db().prepare("UPDATE mensajes SET estado = 'fallado', error = ?, actualizado_en = ? WHERE id = ?").run(motivo, ahoraIso(), mensajeId)
}

/** Un tropiezo que sí se puede reintentar: se cuenta el intento y se espera 1, 2, 4… hasta 60 minutos. */
export function posponerEnvio(mensajeId: number, intentos: number, motivo: string): void {
  const minutos = Math.min(60, 2 ** Math.max(0, intentos))
  const cuando = new Date(Date.now() + minutos * 60_000).toISOString()
  db()
    .prepare('UPDATE mensajes SET intentos = intentos + 1, proximo_intento = ?, error = ?, actualizado_en = ? WHERE id = ?')
    .run(cuando, motivo, ahoraIso(), mensajeId)
}

/** Volver a intentar ya mismo un mensaje que se había dado por perdido. */
export function reintentarMensaje(actor: SesionUsuario, mensajeId: unknown): MensajeInterno {
  const miClave = miClaveDe(actor)
  const id = enteroPositivo(mensajeId, 'El mensaje')
  const fila = db().prepare('SELECT * FROM mensajes WHERE id = ?').get(id) as FilaMensaje | undefined
  if (!fila) throw new ErrorDeNegocio('Ese mensaje no existe.')
  if (fila.autor_clave !== miClave) throw new ErrorDeNegocio('Sólo se puede reintentar un mensaje propio.')
  db()
    .prepare("UPDATE mensajes SET estado = 'enCola', error = NULL, intentos = 0, proximo_intento = NULL, actualizado_en = ? WHERE id = ?")
    .run(ahoraIso(), id)
  return aMensaje(db().prepare('SELECT * FROM mensajes WHERE id = ?').get(id) as FilaMensaje, miClave)
}

// ---------------------------------------------------------------------------
// Los dos acuses, del lado de acá
// ---------------------------------------------------------------------------

/** Los mensajes recibidos que todavía no se le confirmaron al servidor. */
export function pendientesDeConfirmarLlegada(miClave: string): { id: number; remoto_id: string }[] {
  return db()
    .prepare(
      `SELECT m.id, m.remoto_id FROM mensajes m
         JOIN conversacion_participantes p ON p.conversacion_id = m.conversacion_id AND p.usuario_clave = @yo
        WHERE m.autor_clave <> @yo
          AND NOT EXISTS (SELECT 1 FROM mensaje_acuses a WHERE a.mensaje_id = m.id AND a.usuario_clave = @yo AND a.entregado_en IS NOT NULL)
        ORDER BY m.id
        LIMIT 200`,
    )
    .all({ yo: miClave }) as Array<{ id: number; remoto_id: string }>
}

/** Anota acá el acuse propio, para que la pantalla no espere a que el servidor conteste. */
export function anotarAcusePropio(mensajeIds: number[], miClave: string, campo: 'entregado_en' | 'leido_en'): void {
  if (!mensajeIds.length) return
  const ahora = ahoraIso()
  const guardar = db().prepare(
    `INSERT INTO mensaje_acuses (mensaje_id, usuario_clave, entregado_en, leido_en)
     VALUES (@mensaje, @clave, @entregado, @leido)
     ON CONFLICT(mensaje_id, usuario_clave) DO UPDATE SET
       entregado_en = COALESCE(mensaje_acuses.entregado_en, excluded.entregado_en),
       leido_en = COALESCE(mensaje_acuses.leido_en, excluded.leido_en)`,
  )
  for (const mensajeId of mensajeIds) {
    guardar.run({
      mensaje: mensajeId,
      clave: miClave,
      entregado: ahora,
      leido: campo === 'leido_en' ? ahora : null,
    })
  }
}

/**
 * «Ya lo vi»: marca leídos los mensajes de esa conversación y se lo cuenta al servidor.
 *
 * El aviso al servidor se manda pero no se espera: la pantalla tiene que apagar el globito ahora, y si
 * el aviso no llega, el cartero lo vuelve a intentar en la vuelta siguiente (el acuse local ya está,
 * pero la consulta de pendientes mira el del servidor).
 */
export function marcarConversacionLeida(actor: SesionUsuario, conversacionId: unknown): AvisosDeMensajes {
  const miClave = miClaveDe(actor)
  const id = enteroPositivo(conversacionId, 'La conversación')
  conversacionLocal(id, miClave)

  const sinLeer = db()
    .prepare(
      `SELECT m.id, m.remoto_id FROM mensajes m
        WHERE m.conversacion_id = @conversacion AND m.autor_clave <> @yo
          AND NOT EXISTS (SELECT 1 FROM mensaje_acuses a WHERE a.mensaje_id = m.id AND a.usuario_clave = @yo AND a.leido_en IS NOT NULL)`,
    )
    .all({ conversacion: id, yo: miClave }) as Array<{ id: number; remoto_id: string }>

  if (sinLeer.length) {
    anotarAcusePropio(
      sinLeer.map((fila) => fila.id),
      miClave,
      'leido_en',
    )
    const puente = puenteDeMensajes()
    if (puente) {
      // Sin `await` a propósito, y con el catch puesto: que el aviso no salga no puede hacer fallar
      // «marcar como leído», que es una acción de pantalla y tiene que ser instantánea.
      void puente.avisarLeidos(actorDelPuente(actor), sinLeer.map((fila) => fila.remoto_id)).catch((error) => {
        console.error('[mensajería] No se pudo avisar la lectura:', error)
      })
    }
  }
  return avisosDe(actor)
}

// ---------------------------------------------------------------------------
// Adjuntos, borrado y registro
// ---------------------------------------------------------------------------

export async function rutaDelAdjuntoDeMensaje(adjuntoId: unknown): Promise<string> {
  return asegurarAdjuntoLocal('mensaje', enteroPositivo(adjuntoId, 'El adjunto'))
}

/**
 * El contenido de una imagen como `data:` URL, para dibujarla adentro de la burbuja.
 *
 * Existe por los GIF animados: la miniatura es un JPEG del primer cuadro, o sea que se ve quieto. Para
 * que se mueva hay que mandar el archivo entero, y por eso hay un tope: un video no pasa por acá
 * —se abre con el programa del sistema, igual que un PDF—, porque un mp4 de 40 MB en base64 son 53 MB
 * de texto cruzando el puente y la ventana se congela.
 */
export async function contenidoDeAdjuntoDeMensaje(adjuntoId: unknown): Promise<string> {
  const id = enteroPositivo(adjuntoId, 'El adjunto')
  const fila = db().prepare('SELECT nombre, tipo, tamano FROM mensaje_adjuntos WHERE id = ?').get(id) as
    | { nombre: string; tipo: string | null; tamano: number }
    | undefined
  if (!fila) throw new ErrorDeNegocio('Ese archivo no existe.')
  const tipo = fila.tipo ?? tipoDeArchivo(fila.nombre)
  if (!tipo.startsWith('image/')) throw new ErrorDeNegocio('Sólo se pueden mostrar imágenes de esta forma.')
  if (fila.tamano > TOPE_DEL_GIF_ANIMADO) {
    throw new ErrorDeNegocio('La imagen es demasiado grande para mostrarla acá; abrila con el botón.')
  }
  const ruta = await asegurarAdjuntoLocal('mensaje', id)
  return `data:${tipo};base64,${readFileSync(ruta).toString('base64')}`
}

export function borrarAdjuntoDeMensaje(actor: SesionUsuario, adjuntoId: unknown): AdjuntoDeMensaje[] {
  const id = enteroPositivo(adjuntoId, 'El adjunto')
  const fila = db().prepare('SELECT mensaje_id FROM mensaje_adjuntos WHERE id = ?').get(id) as { mensaje_id: number } | undefined
  if (!fila) throw new ErrorDeNegocio('Ese archivo no existe.')
  const mensaje = db().prepare('SELECT autor_clave, estado FROM mensajes WHERE id = ?').get(fila.mensaje_id) as
    | { autor_clave: string; estado: EstadoDeEnvio }
    | undefined
  if (!mensaje) throw new ErrorDeNegocio('Ese mensaje no existe.')
  if (mensaje.autor_clave !== miClaveDe(actor)) throw new ErrorDeNegocio('Sólo se pueden sacar los archivos de un mensaje propio.')
  if (mensaje.estado !== 'enCola' && mensaje.estado !== 'fallado') {
    throw new ErrorDeNegocio('El mensaje ya salió: para sacar el archivo hay que borrar el mensaje entero.')
  }
  borrarAdjuntoRegistrado('mensaje', id, actor)
  return adjuntosDelMensaje(fila.mensaje_id)
}

export async function eliminarMensajePropio(actor: SesionUsuario, mensajeId: unknown): Promise<void> {
  const miClave = miClaveDe(actor)
  const id = enteroPositivo(mensajeId, 'El mensaje')
  const fila = db().prepare('SELECT * FROM mensajes WHERE id = ?').get(id) as FilaMensaje | undefined
  if (!fila) throw new ErrorDeNegocio('Ese mensaje no existe.')
  if (fila.autor_clave !== miClave && actor.rol !== 'SUPER_ADMIN') {
    throw new ErrorDeNegocio('Sólo se puede borrar un mensaje propio.')
  }

  // Uno que nunca salió de acá se borra y listo: el servidor no lo conoce.
  if (fila.estado === 'enCola' || fila.estado === 'fallado') {
    const base = db()
    base.transaction(() => {
      for (const adjunto of adjuntosDe('mensaje', id)) borrarAdjuntoRegistrado('mensaje', adjunto.id, actor)
      base.prepare('DELETE FROM mensaje_acuses WHERE mensaje_id = ?').run(id)
      base.prepare('DELETE FROM mensajes WHERE id = ?').run(id)
    })()
    return
  }

  await exigirPuente().eliminar(actorDelPuente(actor), fila.remoto_id)
  db()
    .prepare('UPDATE mensajes SET eliminado_en = ?, eliminado_por = ?, actualizado_en = ? WHERE id = ?')
    .run(ahoraIso(), miClave, ahoraIso(), id)
}

/**
 * El registro de todos los mensajes de todo el mundo. Sólo SUPER_ADMIN.
 *
 * Sale del servidor y no de esta base a propósito: esta computadora sólo tiene las conversaciones en
 * las que está quien la usa, y el registro es justamente de las otras. El corte por rol lo hace el
 * servidor; acá se pide y se ordena para la tabla.
 */
export async function registroDeMensajes(actor: SesionUsuario, filtros: FiltrosDelLogDeMensajes): Promise<LogDeMensajes> {
  if (actor.rol !== 'SUPER_ADMIN') throw new ErrorDeNegocio('El registro de mensajes es sólo del superadministrador.')

  const respuesta = await exigirPuente().log(actorDelPuente(actor), {
    usuario: filtros.usuario ? claveDeUsuario(filtros.usuario) : undefined,
    desde: filtros.desde ?? undefined,
    hasta: filtros.hasta ?? undefined,
    texto: filtros.texto || undefined,
    pagina: Math.max(1, Math.trunc(filtros.pagina) || 1),
    porPagina: RENGLONES_DEL_LOG,
  })

  return {
    total: respuesta.total,
    pagina: respuesta.pagina,
    porPagina: respuesta.porPagina,
    renglones: respuesta.renglones.map((renglon) => {
      const acuses = renglon.mensaje.acuses
      const leidos = acuses.filter((acuse) => acuse.leidoEn).length
      const entregados = acuses.filter((acuse) => acuse.entregadoEn).length
      return {
        remotoId: renglon.mensaje.id,
        conversacion:
          renglon.conversacion.tipo === 'GRUPO'
            ? (renglon.conversacion.titulo ?? 'Grupo')
            : renglon.conversacion.participantes.map((participante) => participante.nombre).join(' ↔ '),
        tipo: renglon.conversacion.tipo,
        claseDeMensaje:
          renglon.mensaje.tipo === 'ZUMBIDO' || renglon.mensaje.tipo === 'LLAMADA' ? renglon.mensaje.tipo : 'NORMAL',
        participantes: renglon.conversacion.participantes.map((participante) => participante.nombre).join(', '),
        autorClave: renglon.mensaje.autorClave,
        autorNombre: renglon.mensaje.autorNombre,
        cuerpo: renglon.mensaje.cuerpo,
        creadoEn: renglon.mensaje.creadoEn,
        eliminadoEn: renglon.mensaje.eliminadoEn,
        eliminadoPor: renglon.eliminadoPor,
        adjuntos: renglon.mensaje.adjuntos.map((adjunto) => adjunto.nombre).join(', '),
        acuse: !acuses.length
          ? '—'
          : leidos === acuses.length
            ? `Leído por ${leidos}`
            : `Entregado a ${entregados} de ${acuses.length}, leído por ${leidos}`,
        // Del servidor y no del espejo: el registro es de TODA la agencia, y esta computadora sólo tiene
        // guardadas las conversaciones de las que participa quien está mirando.
        reacciones: (renglon.mensaje.reacciones ?? [])
          .map((reaccion) => `${reaccion.emoji} ${reaccion.claves.length}`)
          .join(', '),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// Estado de la conexión
// ---------------------------------------------------------------------------

let ultimoErrorDelCartero: string | null = null
let ultimaVueltaBien = false

export function anotarVueltaDelCartero(error: string | null): void {
  ultimoErrorDelCartero = error
  ultimaVueltaBien = error === null
  db()
    .prepare(
      `INSERT INTO mensajeria_estado (id, ultimo_error, actualizado_en) VALUES (1, @error, @ahora)
       ON CONFLICT(id) DO UPDATE SET ultimo_error = excluded.ultimo_error, actualizado_en = excluded.actualizado_en`,
    )
    .run({ error, ahora: ahoraIso() })
}

export function cursorDeAcuses(): string | null {
  const fila = db().prepare('SELECT cursor_acuses FROM mensajeria_estado WHERE id = 1').get() as
    | { cursor_acuses: string | null }
    | undefined
  return fila?.cursor_acuses ?? null
}

export function guardarCursorDeAcuses(cursor: string): void {
  db()
    .prepare(
      `INSERT INTO mensajeria_estado (id, cursor_acuses, actualizado_en) VALUES (1, @cursor, @ahora)
       ON CONFLICT(id) DO UPDATE SET cursor_acuses = excluded.cursor_acuses, actualizado_en = excluded.actualizado_en`,
    )
    .run({ cursor, ahora: ahoraIso() })
}

export function estadoDeMensajeria(actor: SesionUsuario): EstadoDeMensajeria {
  return {
    configurada: puenteDeMensajes() !== null,
    enLinea: ultimaVueltaBien,
    enCola: cuantosEnCola(miClaveDe(actor)),
    ultimoError: ultimoErrorDelCartero,
  }
}

/** Para las pruebas: volver a arrancar de cero el estado de la conexión. */
export function olvidarEstadoDeMensajeria(): void {
  ultimoErrorDelCartero = null
  ultimaVueltaBien = false
}

export { aConversacion, aMensaje, miClaveDe, rutaDeAdjunto }
