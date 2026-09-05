// Anexos: las filas de APP ADJUNTOS y APP COMENTARIOS, en los dos sentidos.
//
// Un adjunto (una foto del auto, la denuncia del siniestro, el PDF de una tarea) y un comentario (de
// una tarea) u observación (de un siniestro) son cosas que cuelgan de OTRA ficha. Hasta la 12.5 vivían
// sólo en la computadora donde se cargaron: la ficha viajaba por la base, lo que colgaba de ella no.
//
// Desde la 12.6 cada uno es una fila más de la base, en su propia pestaña, y lo que la ata a su ficha
// es la columna VINCULO: «POLIZA:<clave>», «SINIESTRO:<_ID>» o «TAREA:<_ID>». Son las identidades que
// TODAS las computadoras comparten —la clave de la póliza sale de la planilla, el _ID del siniestro y
// de la tarea es el de su fila—, nunca el id local de la tabla, que es distinto en cada PC.
//
// El archivo en sí no viaja por acá: va al disco del VPS con su propio id (columna ARCHIVO), y cada
// computadora lo baja cuando alguien lo abre. Esto sólo lleva la ficha.
import type { SesionUsuario, TipoPestana } from '../../shared/tipos'
import { db, type BaseDeDatos } from '../db/base'
import type { Campo } from '../importacion/encabezados'
import { ahoraIso, limpiar } from '../importacion/normalizar'
import { borrarArchivoDeAdjunto } from '../servicios/carpetaDeAdjuntos'
import { nombreDePestana } from '../servicios/hojas'
import { encolar } from './cola'
import { PESTANA_ADJUNTOS_APP, PESTANA_COMENTARIOS_APP } from './pestanasApp'

export type TipoDeAnexo = 'poliza' | 'siniestro' | 'tarea'
/** De qué fichas puede colgar un comentario: además de las tres, las consultas (leads, 12.7). */
export type TipoDeComentario = 'siniestro' | 'tarea' | 'lead'
/** Todo lo que puede ser «la ficha madre» de un anexo. */
export type TipoDePadre = TipoDeAnexo | 'lead'

/** Prefijos del `_ID`: lo que sigue es el id del archivo en el servidor o un id al azar del comentario. */
export const PREFIJO_DE_ADJUNTO = 'ADJ:'
export const PREFIJO_DE_COMENTARIO = 'COM:'

const ETIQUETA: Record<TipoDePadre, string> = { poliza: 'POLIZA', siniestro: 'SINIESTRO', tarea: 'TAREA', lead: 'LEAD' }
const TIPO_POR_ETIQUETA = new Map<string, TipoDePadre>(Object.entries(ETIQUETA).map(([tipo, etiqueta]) => [etiqueta, tipo as TipoDePadre]))

/** El nombre real de la pestaña (por si la agencia la renombró) o el de fábrica. */
export function pestanaDeAdjuntos(): string {
  return nombreDePestana('APP_ADJUNTOS', PESTANA_ADJUNTOS_APP)
}

export function pestanaDeComentarios(): string {
  return nombreDePestana('APP_COMENTARIOS', PESTANA_COMENTARIOS_APP)
}

// ---------------------------------------------------------------------------
// El vínculo: cómo se nombra la ficha madre en la base
// ---------------------------------------------------------------------------

/**
 * Con qué texto se nombra a la ficha en la columna VINCULO, o null si esa ficha no tiene todavía una
 * identidad que las otras computadoras conozcan (una tarea vieja sin fila en la base). En ese caso lo
 * que cuelga de ella se queda en esta PC, como hasta ahora.
 */
export function vinculoDelPadre(tipo: TipoDePadre, padreId: number, base: BaseDeDatos = db()): string | null {
  const clave = claveDelPadre(tipo, padreId, base)
  return clave ? `${ETIQUETA[tipo]}:${clave}` : null
}

function claveDelPadre(tipo: TipoDePadre, padreId: number, base: BaseDeDatos): string | null {
  if (tipo === 'poliza') {
    const fila = base.prepare('SELECT clave FROM polizas WHERE id = ?').get(padreId) as { clave: string | null } | undefined
    return fila?.clave ?? null
  }
  const tabla = tipo === 'siniestro' ? 'siniestros' : tipo === 'lead' ? 'leads' : 'tareas'
  const fila = base.prepare(`SELECT fila_id FROM ${tabla} WHERE id = ?`).get(padreId) as { fila_id: string | null } | undefined
  return fila?.fila_id ?? null
}

/**
 * Lo que dice la columna DESCRIPCION: para quien mira la pestaña en la base o en Google, y para la
 * computadora que recibe la fila antes de tener la ficha (por ejemplo, la póliza todavía no llegó).
 */
export function descripcionDelPadre(tipo: TipoDePadre, padreId: number, base: BaseDeDatos = db()): string {
  if (tipo === 'poliza') {
    const p = base
      .prepare(
        `SELECT p.compania, p.numero, cl.nombre AS cliente, COALESCE(v.patente, '') AS patente
         FROM polizas p LEFT JOIN clientes cl ON cl.id = p.cliente_id LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
         WHERE p.id = ?`,
      )
      .get(padreId) as { compania: string | null; numero: string | null; cliente: string | null; patente: string } | undefined
    if (!p) return `Póliza ${padreId}`
    return ['Póliza', [p.compania, p.numero].filter(Boolean).join(' '), p.cliente, p.patente].filter((x) => limpiar(x ?? '')).join(' · ')
  }
  if (tipo === 'siniestro') {
    const s = base
      .prepare('SELECT numero_siniestro, cliente_nombre, patente FROM siniestros WHERE id = ?')
      .get(padreId) as { numero_siniestro: string | null; cliente_nombre: string | null; patente: string | null } | undefined
    if (!s) return `Siniestro ${padreId}`
    return ['Siniestro', s.numero_siniestro, s.cliente_nombre, s.patente].filter((x) => limpiar(x ?? '')).join(' · ')
  }
  if (tipo === 'lead') {
    const l = base.prepare('SELECT nombre FROM leads WHERE id = ?').get(padreId) as { nombre: string } | undefined
    return l ? `Consulta de ${l.nombre}` : `Consulta ${padreId}`
  }
  const t = base.prepare('SELECT titulo FROM tareas WHERE id = ?').get(padreId) as { titulo: string } | undefined
  return t ? `Tarea: ${t.titulo}` : `Tarea ${padreId}`
}

export interface PadreDeAnexo {
  tipo: TipoDePadre
  /** El id local de la ficha, o null si esta computadora todavía no la tiene. */
  id: number | null
}

/** Lee «TIPO:clave» y busca la ficha en esta computadora. null si el texto no es un vínculo. */
export function padreDelVinculo(vinculo: string, base: BaseDeDatos = db()): PadreDeAnexo | null {
  const separador = vinculo.indexOf(':')
  if (separador <= 0) return null
  const tipo = TIPO_POR_ETIQUETA.get(limpiar(vinculo.slice(0, separador)).toUpperCase())
  const clave = vinculo.slice(separador + 1).trim()
  if (!tipo || !clave) return null
  return { tipo, id: idDelPadre(tipo, clave, base) }
}

function idDelPadre(tipo: TipoDePadre, clave: string, base: BaseDeDatos): number | null {
  const sql =
    tipo === 'poliza'
      ? 'SELECT id FROM polizas WHERE clave = ? OR fila_id = ? ORDER BY id LIMIT 1'
      : tipo === 'siniestro'
        ? 'SELECT id FROM siniestros WHERE fila_id = ? OR fila_id = ? LIMIT 1'
        : tipo === 'lead'
          ? 'SELECT id FROM leads WHERE fila_id = ? OR fila_id = ? LIMIT 1'
          : 'SELECT id FROM tareas WHERE fila_id = ? OR fila_id = ? LIMIT 1'
  const fila = base.prepare(sql).get(clave, clave) as { id: number } | undefined
  return fila?.id ?? null
}

// ---------------------------------------------------------------------------
// Lo que viaja a la base
// ---------------------------------------------------------------------------

export interface AdjuntoParaLaHoja {
  fecha: string
  tipo: TipoDeAnexo
  vinculo: string
  descripcion: string
  nombre: string
  categoria: string | null
  /** El id del archivo en el servidor (columna ARCHIVO). */
  vpsId: string
  tamano: number
  sha256: string | null
  usuario: string
  /**
   * Cuándo llegó el archivo al servidor (columna SUBIDO, 12.7), o null si todavía no. La ficha viaja
   * apenas se adjunta; el archivo, en los ciclos siguientes. Hasta la 12.6 la otra computadora daba el
   * archivo por subido con sólo ver la fila, y al abrirlo el servidor contestaba que no existía.
   */
  subidoEn: string | null
}

export function camposDeAdjunto(datos: AdjuntoParaLaHoja): Partial<Record<Campo, string>> {
  return {
    fecha: datos.fecha,
    tipo_registro: ETIQUETA[datos.tipo],
    vinculo: datos.vinculo,
    descripcion: datos.descripcion,
    archivo_nombre: datos.nombre,
    categoria: datos.categoria ?? '',
    archivo: datos.vpsId,
    tamano: String(datos.tamano),
    sha256: datos.sha256 ?? '',
    usuario: datos.usuario,
    subido: datos.subidoEn ?? '',
  }
}

/**
 * El archivo acaba de llegar al servidor: se anota en su fila de APP ADJUNTOS, así las otras
 * computadoras pasan de «cargado en otra computadora» a «en el servidor» y lo pueden abrir. Si la
 * fila todavía no viajó (el «crear» sigue en la cola), el campo se junta con ella.
 */
export function encolarSubidoDeAnexo(filaId: string, subidoEn: string, actor: SesionUsuario | null = null, base: BaseDeDatos = db()): void {
  const conocida = base.prepare('SELECT pestana FROM filas_crudas WHERE fila_id = ?').get(filaId) as { pestana: string } | undefined
  encolar({ operacion: 'actualizar', pestana: conocida?.pestana ?? pestanaDeAdjuntos(), filaId, campos: { subido: subidoEn } }, actor)
}

export interface ComentarioParaLaHoja {
  fecha: string
  tipo: TipoDeComentario
  vinculo: string
  usuario: string
  texto: string
}

export function camposDeComentario(datos: ComentarioParaLaHoja): Partial<Record<Campo, string>> {
  return {
    fecha: datos.fecha,
    tipo_registro: ETIQUETA[datos.tipo],
    vinculo: datos.vinculo,
    usuario: datos.usuario,
    texto: datos.texto,
  }
}

/**
 * Anota la fila como nacida en la aplicación (igual que `registrarFilaDeLaApp`, sin importar filas.ts
 * para no armar un ciclo) y la deja en la cola para que la subida la agregue a la pestaña.
 */
export function registrarAnexoEnLaCola(
  datos: { filaId: string; tipoPestana: 'APP_ADJUNTOS' | 'APP_COMENTARIOS'; campos: Partial<Record<Campo, string>> },
  actor: SesionUsuario | null,
  base: BaseDeDatos = db(),
): void {
  const pestana = datos.tipoPestana === 'APP_ADJUNTOS' ? pestanaDeAdjuntos() : pestanaDeComentarios()
  const ahora = ahoraIso()
  base
    .prepare(
      `INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, periodo, numero_fila, datos_json, en_la_hoja, huella, creado_en, actualizado_en)
       VALUES (?, ?, ?, NULL, 0, '{}', 0, NULL, ?, ?)
       ON CONFLICT(fila_id) DO NOTHING`,
    )
    .run(datos.filaId, pestana, datos.tipoPestana, ahora, ahora)
  encolar({ operacion: 'crear', pestana, filaId: datos.filaId, campos: datos.campos }, actor)
}

/** El borrado de la fila viaja a la base; las otras computadoras sacan lo suyo al verla desaparecer. */
export function encolarBorradoDeAnexo(filaId: string, tipoPestana: 'APP_ADJUNTOS' | 'APP_COMENTARIOS', actor: SesionUsuario | null, base: BaseDeDatos = db()): void {
  const conocida = base.prepare('SELECT pestana FROM filas_crudas WHERE fila_id = ?').get(filaId) as { pestana: string } | undefined
  const pestana = conocida?.pestana ?? (tipoPestana === 'APP_ADJUNTOS' ? pestanaDeAdjuntos() : pestanaDeComentarios())
  // 12.7: la fila de un adjunto sale en el ciclo siguiente, sin la ventana de agrupado de un minuto.
  // El archivo ya se borró del servidor, y si esta computadora se cierra en ese minuto las otras
  // siguen viendo la fila «en el servidor» y reciben un 404 al abrirla.
  encolar({ operacion: 'borrar', pestana, filaId, campos: {} }, actor, { sinEspera: tipoPestana === 'APP_ADJUNTOS' })
}

/**
 * Un comentario recién escrito en esta computadora: recibe su `_ID` y sale hacia APP COMENTARIOS. Si la
 * ficha madre no tiene identidad en la base (una tarea vieja), el comentario se queda local y sin id,
 * y `registrarLoQueNoViajo` lo vuelve a intentar cuando la ficha la tenga.
 */
export function registrarComentarioNuevo(
  tipo: TipoDeComentario,
  padreId: number,
  comentarioId: number,
  actor: SesionUsuario | null,
  base: BaseDeDatos = db(),
): string | null {
  const tabla = TABLA_DE_COMENTARIOS[tipo].tabla
  const fila = base.prepare(`SELECT id, fila_id, texto, usuario_nombre, creado_en FROM ${tabla} WHERE id = ?`).get(comentarioId) as
    | { id: number; fila_id: string | null; texto: string; usuario_nombre: string; creado_en: string }
    | undefined
  if (!fila) return null
  if (fila.fila_id) return fila.fila_id
  const vinculo = vinculoDelPadre(tipo, padreId, base)
  if (!vinculo) return null
  const filaId = `${PREFIJO_DE_COMENTARIO}${idAlAzar()}`
  base.prepare(`UPDATE ${tabla} SET fila_id = ? WHERE id = ?`).run(filaId, comentarioId)
  registrarAnexoEnLaCola(
    {
      filaId,
      tipoPestana: 'APP_COMENTARIOS',
      campos: camposDeComentario({ fecha: fila.creado_en, tipo, vinculo, usuario: fila.usuario_nombre, texto: fila.texto }),
    },
    actor,
    base,
  )
  return filaId
}

/** 32 hexadecimales al azar: el mismo formato que el id de un archivo en el servidor. */
export function idAlAzar(): string {
  let salida = ''
  for (let i = 0; i < 32; i++) salida += Math.floor(Math.random() * 16).toString(16)
  return salida
}

// ---------------------------------------------------------------------------
// Lo que llega de la base (lo escribió otra computadora)
// ---------------------------------------------------------------------------

/** Cómo lee la fila quien la trae: por campo (importador) o por celda ya mapeada (bajada). */
export interface FilaDeAnexo {
  filaId: string
  pestana: string
  valor: (campo: Campo) => string
}

export type ResultadoDeAnexo = 'guardado' | 'sin-padre' | 'ignorado'

const TABLA_DE_ADJUNTOS: Record<TipoDeAnexo, { tabla: string; padre: string }> = {
  poliza: { tabla: 'poliza_adjuntos', padre: 'poliza_id' },
  siniestro: { tabla: 'siniestro_adjuntos', padre: 'siniestro_id' },
  tarea: { tabla: 'tarea_adjuntos', padre: 'tarea_id' },
}

/** Dónde viven los comentarios de cada ficha: las observaciones del siniestro, los de la tarea, las notas del lead. */
const TABLA_DE_COMENTARIOS: Record<TipoDeComentario, { tabla: string; padre: string }> = {
  siniestro: { tabla: 'siniestro_observaciones', padre: 'siniestro_id' },
  tarea: { tabla: 'tarea_comentarios', padre: 'tarea_id' },
  lead: { tabla: 'lead_notas', padre: 'lead_id' },
}

/** Una fecha usable como `creado_en`: el ISO completo si vino así, si no el día con hora cero. */
function fechaDeLaFila(texto: string, ahora: string): string {
  const limpio = limpiar(texto)
  if (/^\d{4}-\d{2}-\d{2}T/.test(limpio)) return limpio
  if (/^\d{4}-\d{2}-\d{2}$/.test(limpio)) return `${limpio}T00:00:00.000Z`
  const partes = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(limpio)
  if (partes) return `${partes[3]}-${partes[2]!.padStart(2, '0')}-${partes[1]!.padStart(2, '0')}T00:00:00.000Z`
  return ahora
}

/**
 * Una fila de APP ADJUNTOS que escribió otra computadora: se guarda la ficha del archivo colgando de
 * su póliza, siniestro o tarea, SIN el archivo (`archivo` queda vacío hasta que alguien lo abra y se
 * baje). Si la ficha madre todavía no está en esta PC, no hay dónde colgarlo: `sin-padre`, y la fila
 * vuelve a intentarse en la próxima bajada, cuando la importación ya haya traído la ficha.
 */
export function guardarAdjuntoDeLaHoja(fila: FilaDeAnexo, base: BaseDeDatos = db()): ResultadoDeAnexo {
  if (!fila.filaId.startsWith(PREFIJO_DE_ADJUNTO)) return 'ignorado'
  const padre = padreDelVinculo(fila.valor('vinculo'), base)
  if (!padre || padre.tipo === 'lead') return 'ignorado'
  if (padre.id === null) return 'sin-padre'
  const { tabla, padre: columnaPadre } = TABLA_DE_ADJUNTOS[padre.tipo]
  const ahora = ahoraIso()
  const nombre = limpiar(fila.valor('archivo_nombre')) || 'adjunto'
  const vpsId = limpiar(fila.valor('archivo')) || null
  const tamano = Number.parseInt(limpiar(fila.valor('tamano')), 10)
  const sha256 = limpiar(fila.valor('sha256')).toLowerCase() || null
  const categoriaEscrita = limpiar(fila.valor('categoria'))
  const separador = categoriaEscrita.indexOf(': ')
  const categoria = separador > 0 ? categoriaEscrita.slice(0, separador) : categoriaEscrita || null
  const categoriaDetalle = separador > 0 ? categoriaEscrita.slice(separador + 2) : null
  const conCategoria = padre.tipo === 'siniestro'
  // 12.7: la columna SUBIDO la escribe la computadora que subió el archivo, después de subirlo. Hasta
  // la 12.6 acá se daba por subido con sólo ver la fila (la fecha de la fila hacía de fecha de subida),
  // y con eso pasaban dos cosas: la otra computadora decía «en el servidor» de un archivo que todavía
  // no había llegado, y —peor— la PROPIA computadora que lo cargó, al correr una importación completa
  // antes de terminar de subirlo, lo marcaba como subido y no lo subía nunca más.
  const subidoEscrito = limpiar(fila.valor('subido'))
  const subidoEn = vpsId && subidoEscrito ? fechaDeLaFila(subidoEscrito, ahora) : null

  base
    .prepare(
      `INSERT INTO ${tabla} (${columnaPadre}, fila_id, nombre, archivo, tipo, tamano, sha256, vps_id, vps_subido_en,
                             usuario_id, usuario_nombre, creado_en${conCategoria ? ', categoria, categoria_detalle' : ''})
       VALUES (@padre, @fila_id, @nombre, '', @tipo, @tamano, @sha256, @vps_id, @vps_subido_en,
               NULL, @usuario, @creado_en${conCategoria ? ', @categoria, @categoria_detalle' : ''})
       ON CONFLICT(fila_id) WHERE fila_id IS NOT NULL DO UPDATE SET
         ${columnaPadre} = excluded.${columnaPadre},
         nombre = excluded.nombre,
         tipo = COALESCE(excluded.tipo, ${tabla}.tipo),
         tamano = CASE WHEN excluded.tamano > 0 THEN excluded.tamano ELSE ${tabla}.tamano END,
         sha256 = COALESCE(excluded.sha256, ${tabla}.sha256),
         vps_id = COALESCE(excluded.vps_id, ${tabla}.vps_id),
         -- La computadora que tiene el archivo (lo cargó, o ya lo bajó) sabe mejor que la fila si lo
         -- subió: la fila nunca le cambia ese dato. Las que no lo tienen toman lo que diga SUBIDO.
         vps_subido_en = CASE WHEN ${tabla}.archivo <> '' THEN ${tabla}.vps_subido_en ELSE COALESCE(${tabla}.vps_subido_en, excluded.vps_subido_en) END,
         usuario_nombre = excluded.usuario_nombre${conCategoria ? ', categoria = excluded.categoria, categoria_detalle = excluded.categoria_detalle' : ''}`,
    )
    .run({
      padre: padre.id,
      fila_id: fila.filaId,
      nombre,
      tipo: null,
      tamano: Number.isFinite(tamano) && tamano > 0 ? tamano : 0,
      sha256,
      vps_id: vpsId,
      vps_subido_en: subidoEn,
      usuario: limpiar(fila.valor('usuario')) || 'Otra computadora',
      creado_en: fechaDeLaFila(fila.valor('fecha'), ahora),
      ...(conCategoria ? { categoria, categoria_detalle: categoriaDetalle } : {}),
    })
  return 'guardado'
}

/**
 * Los renglones de la línea de tiempo que hasta la 12.6 eran la ÚNICA forma en que viajaban el abogado
 * y los datos del tercero («Abogado: Dr. Pérez», «Patente del tercero: AB123CD»). Desde la 12.7 esos
 * campos tienen columna propia en la pestaña SINIESTROS, pero el renglón se sigue escribiendo con
 * cada cambio, así que aplicarlos en orden deja la ficha como el último cambio: es lo que hace que
 * lo cargado con la 12.6 (que sólo dejó renglones) aparezca en las otras computadoras, y que una
 * computadora con el programa viejo siga contando lo suyo. «(se borró)» vacía el campo.
 */
const CAMPO_POR_RENGLON: Array<{ etiqueta: string; columna: string }> = [
  { etiqueta: 'Abogado', columna: 'abogado' },
  { etiqueta: 'Compañía del tercero', columna: 'tercero_compania' },
  { etiqueta: 'Teléfono del tercero', columna: 'tercero_telefono' },
  { etiqueta: 'Patente del tercero', columna: 'tercero_patente' },
  { etiqueta: 'Terceros lesionados', columna: 'tercero_lesionados' },
  { etiqueta: 'Quién se lesionó', columna: 'tercero_lesionados_detalle' },
]

export function aplicarRenglonALaFicha(siniestroId: number, texto: string, base: BaseDeDatos = db()): boolean {
  const separador = texto.indexOf(': ')
  if (separador <= 0) return false
  const etiqueta = texto.slice(0, separador)
  const destino = CAMPO_POR_RENGLON.find((c) => c.etiqueta === etiqueta)
  if (!destino) return false
  const valor = texto.slice(separador + 2).trim()
  const nuevo = !valor || valor === '(se borró)' ? null : valor.slice(0, 500)
  const cambio = base
    .prepare(`UPDATE siniestros SET ${destino.columna} = ? WHERE id = ? AND ${destino.columna} IS NOT ?`)
    .run(nuevo, siniestroId, nuevo)
  return cambio.changes > 0
}

/** Una fila de APP COMENTARIOS que escribió otra computadora: un comentario o una observación más. */
export function guardarComentarioDeLaHoja(fila: FilaDeAnexo, base: BaseDeDatos = db()): ResultadoDeAnexo {
  if (!fila.filaId.startsWith(PREFIJO_DE_COMENTARIO)) return 'ignorado'
  const padre = padreDelVinculo(fila.valor('vinculo'), base)
  if (!padre || padre.tipo === 'poliza') return 'ignorado'
  if (padre.id === null) return 'sin-padre'
  const texto = limpiar(fila.valor('texto'))
  if (!texto) return 'ignorado'
  const ahora = ahoraIso()
  const { tabla, padre: columnaPadre } = TABLA_DE_COMENTARIOS[padre.tipo]
  base
    .prepare(
      `INSERT INTO ${tabla} (${columnaPadre}, fila_id, texto, usuario_id, usuario_nombre, creado_en)
       VALUES (@padre, @fila_id, @texto, NULL, @usuario, @creado_en)
       ON CONFLICT(fila_id) WHERE fila_id IS NOT NULL DO UPDATE SET
         ${columnaPadre} = excluded.${columnaPadre}, texto = excluded.texto, usuario_nombre = excluded.usuario_nombre`,
    )
    .run({
      padre: padre.id,
      fila_id: fila.filaId,
      texto,
      usuario: limpiar(fila.valor('usuario')) || 'Otra computadora',
      creado_en: fechaDeLaFila(fila.valor('fecha'), ahora),
    })
  if (padre.tipo === 'tarea') base.prepare('UPDATE tareas SET actualizado_en = ? WHERE id = ?').run(ahora, padre.id)
  else if (padre.tipo === 'lead') base.prepare('UPDATE leads SET actualizado_en = ? WHERE id = ?').run(ahora, padre.id)
  else aplicarRenglonALaFicha(padre.id, texto, base)
  return 'guardado'
}

/**
 * La fila desapareció de la base (la borraron desde otra computadora): lo que representaba se va de
 * esta PC, archivo incluido. Lo llama `alDesaparecerDeLaHoja` para APP ADJUNTOS y APP COMENTARIOS.
 */
export function borrarAnexoLocal(filaId: string, base: BaseDeDatos = db()): boolean {
  if (filaId.startsWith(PREFIJO_DE_ADJUNTO)) {
    let borrado = false
    for (const { tabla } of Object.values(TABLA_DE_ADJUNTOS)) {
      const fila = base.prepare(`SELECT id, archivo FROM ${tabla} WHERE fila_id = ?`).get(filaId) as { id: number; archivo: string } | undefined
      if (!fila) continue
      base.prepare(`DELETE FROM ${tabla} WHERE id = ?`).run(fila.id)
      borrarArchivoDeAdjunto(fila.archivo)
      borrado = true
    }
    return borrado
  }
  if (filaId.startsWith(PREFIJO_DE_COMENTARIO)) {
    let borrados = 0
    for (const { tabla } of Object.values(TABLA_DE_COMENTARIOS)) borrados += base.prepare(`DELETE FROM ${tabla} WHERE fila_id = ?`).run(filaId).changes
    return borrados > 0
  }
  return false
}

/** true si es una de las dos pestañas de anexos, para que quien recorre filas sepa a quién dárselas. */
export function esPestanaDeAnexos(tipo: TipoPestana): tipo is 'APP_ADJUNTOS' | 'APP_COMENTARIOS' {
  return tipo === 'APP_ADJUNTOS' || tipo === 'APP_COMENTARIOS'
}

/** Reparte una fila de anexo según su pestaña. */
export function guardarAnexoDeLaHoja(tipo: 'APP_ADJUNTOS' | 'APP_COMENTARIOS', fila: FilaDeAnexo, base: BaseDeDatos = db()): ResultadoDeAnexo {
  return tipo === 'APP_ADJUNTOS' ? guardarAdjuntoDeLaHoja(fila, base) : guardarComentarioDeLaHoja(fila, base)
}
