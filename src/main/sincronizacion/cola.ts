// La cola de subida: todo lo que se toca en la aplicación se anota acá en la misma transacción, y el
// motor la va vaciando cuando hay internet. Si no hay, el trabajo sigue igual y la cola espera.
import type { Campo } from '../importacion/encabezados'
import { ahoraIso } from '../importacion/normalizar'
import { db } from '../db/base'
import type { SesionUsuario } from '../../shared/tipos'

export type OperacionSync = 'actualizar' | 'crear' | 'borrar'

export interface EntradaCola {
  id: number
  creadoEn: string
  operacion: OperacionSync
  pestana: string
  filaId: string
  campos: Partial<Record<Campo | '_id', string>>
  intentos: number
  proximoIntento: string | null
  ultimoError: string | null
  usuarioNombre: string | null
}

interface FilaCola {
  id: number
  creado_en: string
  operacion: OperacionSync
  pestana: string
  fila_id: string
  campos_json: string
  intentos: number
  proximo_intento: string | null
  ultimo_error: string | null
  usuario_nombre: string | null
}

function aEntrada(fila: FilaCola): EntradaCola {
  return {
    id: fila.id,
    creadoEn: fila.creado_en,
    operacion: fila.operacion,
    pestana: fila.pestana,
    filaId: fila.fila_id,
    campos: JSON.parse(fila.campos_json) as EntradaCola['campos'],
    intentos: fila.intentos,
    proximoIntento: fila.proximo_intento,
    ultimoError: fila.ultimo_error,
    usuarioNombre: fila.usuario_nombre,
  }
}

/**
 * Anota un cambio para subir. Si ya hay una entrada pendiente de «crear» o «actualizar» para la misma
 * fila, los campos se juntan en esa: subir dos veces la misma celda no sirve de nada y gasta cuota.
 *
 * Que también se junten contra un «crear» pendiente importa de verdad: si se registra un pago y se lo
 * corrige antes de que la cola se vacíe, el segundo cambio no puede ser un «actualizar» (la fila
 * todavía no existe en la hoja, así que se daría por perdido) ni otro «crear» (quedarían dos filas).
 */
export function encolar(
  entrada: { operacion: OperacionSync; pestana: string; filaId: string; campos: Partial<Record<Campo | '_id', string>> },
  actor?: SesionUsuario | null,
): void {
  const base = db()
  if (entrada.operacion !== 'borrar') {
    // Se mira la ÚLTIMA entrada pendiente de esa fila, sea de la operación que sea: si en el medio
    // quedó un «borrar» (una baja sin subir todavía), juntarse con algo anterior lo saltearía.
    const ultima = base
      .prepare(
        `SELECT id, operacion, campos_json FROM cola_sync
         WHERE estado = 'pendiente' AND fila_id = ? AND pestana = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(entrada.filaId, entrada.pestana) as { id: number; operacion: OperacionSync; campos_json: string } | undefined
    const seJuntan =
      ultima !== undefined &&
      (ultima.operacion === 'crear' || (ultima.operacion === 'actualizar' && entrada.operacion === 'actualizar'))
    if (ultima && seJuntan) {
      const juntos = { ...(JSON.parse(ultima.campos_json) as Record<string, string>), ...entrada.campos }
      base
        .prepare(`UPDATE cola_sync SET campos_json = ?, creado_en = ?, intentos = 0, proximo_intento = NULL, ultimo_error = NULL WHERE id = ?`)
        .run(JSON.stringify(juntos), ahoraIso(), ultima.id)
      return
    }
  }
  base
    .prepare(
      `INSERT INTO cola_sync (creado_en, operacion, pestana, fila_id, campos_json, usuario_nombre)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(ahoraIso(), entrada.operacion, entrada.pestana, entrada.filaId, JSON.stringify(entrada.campos), actor?.nombre ?? null)
}

/** Entradas listas para intentar ahora (las que fallaron esperan su turno). */
export function pendientes(limite = 200): EntradaCola[] {
  const ahora = ahoraIso()
  return (
    db()
      .prepare(
        `SELECT * FROM cola_sync
         WHERE estado = 'pendiente' AND (proximo_intento IS NULL OR proximo_intento <= ?)
         ORDER BY id LIMIT ?`,
      )
      .all(ahora, limite) as FilaCola[]
  ).map(aEntrada)
}

/** A qué pestañas apunta lo que está esperando en la cola. */
export function pestanasPendientes(): string[] {
  return (db().prepare(`SELECT DISTINCT pestana FROM cola_sync WHERE estado = 'pendiente'`).all() as Array<{ pestana: string }>).map(
    (fila) => fila.pestana,
  )
}

export function cuantasPendientes(): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM cola_sync WHERE estado = 'pendiente'`).get() as { n: number }).n
}

export function cuantasFallidas(): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM cola_sync WHERE estado = 'fallido'`).get() as { n: number }).n
}

export function marcarListas(ids: number[]): void {
  if (ids.length === 0) return
  const marcar = db().prepare(`UPDATE cola_sync SET estado = 'listo', subido_en = ?, ultimo_error = NULL WHERE id = ?`)
  const ahora = ahoraIso()
  db().transaction(() => {
    for (const id of ids) marcar.run(ahora, id)
  })()
}

/** Después de 8 intentos fallidos la entrada queda para que alguien la mire, no reintentando para siempre. */
const MAXIMO_INTENTOS = 8

/** Espera exponencial: 10 s, 20 s, 40 s… hasta 10 minutos. */
export function esperaDeReintento(intentos: number): number {
  return Math.min(10 * 60_000, 10_000 * 2 ** Math.max(0, intentos - 1))
}

/** Errores que no se arreglan reintentando: la pestaña no existe, la columna no está. */
export function marcarSinArreglo(ids: number[], error: string): void {
  if (ids.length === 0) return
  const marcar = db().prepare(`UPDATE cola_sync SET estado = 'fallido', ultimo_error = ?, proximo_intento = NULL WHERE id = ?`)
  db().transaction(() => {
    for (const id of ids) marcar.run(error.slice(0, 500), id)
  })()
}

export function marcarFallidas(ids: number[], error: string): void {
  if (ids.length === 0) return
  const base = db()
  const leer = base.prepare('SELECT intentos FROM cola_sync WHERE id = ?')
  const actualizar = base.prepare(
    `UPDATE cola_sync SET intentos = ?, proximo_intento = ?, ultimo_error = ?, estado = ? WHERE id = ?`,
  )
  base.transaction(() => {
    for (const id of ids) {
      const intentos = ((leer.get(id) as { intentos: number } | undefined)?.intentos ?? 0) + 1
      const agotada = intentos >= MAXIMO_INTENTOS
      const proximo = new Date(Date.now() + esperaDeReintento(intentos)).toISOString()
      actualizar.run(intentos, agotada ? null : proximo, error.slice(0, 500), agotada ? 'fallido' : 'pendiente', id)
    }
  })()
}

/** Vuelve a poner en la cola las entradas que se habían dado por perdidas. */
export function reintentarFallidas(): number {
  return db()
    .prepare(`UPDATE cola_sync SET estado = 'pendiente', intentos = 0, proximo_intento = NULL WHERE estado = 'fallido'`)
    .run().changes
}

/** Limpia las entradas ya subidas hace más de una semana: la cola no es un archivo histórico. */
export function limpiarViejas(): number {
  const limite = new Date(Date.now() - 7 * 86_400_000).toISOString()
  return db().prepare(`DELETE FROM cola_sync WHERE estado = 'listo' AND subido_en < ?`).run(limite).changes
}

// ---------------------------------------------------------------------------
// Bitácora y marcas de estado
// ---------------------------------------------------------------------------

export function anotarEvento(tipo: string, detalle: string, extra: { filas?: number; duracionMs?: number; conError?: boolean } = {}): void {
  db()
    .prepare(`INSERT INTO eventos_sync (fecha, tipo, detalle, filas, duracion_ms, con_error) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(ahoraIso(), tipo, detalle, extra.filas ?? null, extra.duracionMs ?? null, extra.conError ? 1 : 0)
  // Se conservan los últimos 500; la pantalla muestra 50.
  db().prepare(`DELETE FROM eventos_sync WHERE id <= (SELECT MAX(id) - 500 FROM eventos_sync)`).run()
}

export function leerMarca(clave: string): string | null {
  return (db().prepare('SELECT valor FROM estado_sync WHERE clave = ?').get(clave) as { valor: string } | undefined)?.valor ?? null
}

export function guardarMarca(clave: string, valor: string): void {
  db()
    .prepare(
      `INSERT INTO estado_sync (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    )
    .run(clave, valor, ahoraIso())
}
