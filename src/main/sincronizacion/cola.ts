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
 * Cuánto espera un borrado antes de subir, para que varios se junten en una sola llamada.
 *
 * Borrar una fila en Google no es como escribir una celda: corre todas las filas de abajo y obliga a
 * la planilla entera a recalcularse. Dando de baja pólizas una atrás de otra, cada baja salía sola en
 * su ciclo de diez segundos y la hoja se recalculaba una vez por baja: a quien tenía «el general»
 * abierto se le trababa. Con esta espera, las bajas de un mismo minuto viajan juntas y la hoja se
 * reacomoda una sola vez. El botón «Sincronizar ahora» no espera nada (ver `apurarAgrupadas`).
 */
export const ESPERA_DE_AGRUPADO_MS = 60_000

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
  opciones: { sinEspera?: boolean } = {},
): void {
  const base = db()
  if (entrada.operacion === 'borrar') {
    // Un «borrar» de una fila cuyo «crear» todavía está esperando en la cola (12.7): ese «crear» no
    // tiene que salir —la fila se está borrando— así que se saca de la cola, y con él los «actualizar»
    // que se le habían juntado adentro (eran cambios de una fila que ya no existe, es lo correcto).
    // Sin esto, adjuntar un archivo y borrarlo sin internet dejaba una ficha fantasma: las dos entradas
    // caían en la misma tanda, el «borrar» no encontraba la fila (todavía no estaba) y se daba por
    // hecho, y recién después se ejecutaba el agregado, que la dejaba en la base para siempre.
    //
    // El «borrar» se encola IGUAL, y es a propósito: es el mismo criterio que eliminacion.ts documenta
    // para esta carrera. Sacar la entrada de la cola no le saca los datos a una subida que está en
    // vuelo con esa fila en la mano (el proceso es de un solo hilo y este borrado puede entrar justo
    // mientras `subirTanda` espera la respuesta del servidor), y tampoco deshace un «crear» que ya se
    // aplicó y cuya respuesta se perdió: en los dos casos el renglón queda en la base y, sin el
    // «borrar», no queda nadie que lo saque. Si el «crear» de verdad nunca salió, el «borrar» no cuesta
    // nada: no encuentra la fila y se da por hecho en el mismo ciclo (ver `subirTanda`).
    //
    // Lo que NO se usa es `intentos` para adivinar si el «crear» salió alguna vez: al juntarle campos,
    // más abajo, los intentos vuelven a cero, así que un cero no prueba nada.
    base
      .prepare(`DELETE FROM cola_sync WHERE estado = 'pendiente' AND operacion = 'crear' AND fila_id = ? AND pestana = ?`)
      .run(entrada.filaId, entrada.pestana)
  } else {
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
  // Los borrados esperan su ventana de agrupado; el resto sale en el ciclo siguiente, como siempre.
  // `sinEspera` (12.7): el borrado de una ficha de adjunto sale en el ciclo siguiente, sin la ventana de
  // agrupado, porque el archivo ya se borró del servidor y cada segundo que la fila siga en la hoja las
  // otras computadoras la muestran «en el servidor» sin poder abrirla.
  const espera = entrada.operacion === 'borrar' && !opciones.sinEspera ? new Date(Date.now() + ESPERA_DE_AGRUPADO_MS).toISOString() : null
  base
    .prepare(
      `INSERT INTO cola_sync (creado_en, operacion, pestana, fila_id, campos_json, proximo_intento, usuario_nombre)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(ahoraIso(), entrada.operacion, entrada.pestana, entrada.filaId, JSON.stringify(entrada.campos), espera, actor?.nombre ?? null)
}

/**
 * Tope provisorio de la tanda, cuando el servidor rechazó una tanda de varias entradas (12.7).
 *
 * Cuando el servidor rechaza el CONTENIDO (un 400: un valor que la base no acepta) el problema casi
 * siempre es de UNA celda, pero venía en una tanda de hasta 200 y hasta la 12.6 se les sumaba un
 * intento a todas: a la octava vuelta las 200 pasaban a «no se pudo», con la mala adentro y las buenas
 * también. Ahora esa tanda no cuenta como intento de nadie: se anota el error y la próxima sale con la
 * mitad de entradas. Si esa pasa, el tope vuelve a lo normal y la mitad siguiente se intenta sola; si
 * no pasa, se vuelve a partir. En pocos ciclos la entrada mala queda sola en su tanda, se le suma el
 * intento a ella nada más y las buenas siguen viajando.
 *
 * Ojo: esto vale SÓLO para el rechazo del contenido (ver `esRechazoDelContenido` en subida.ts). Un
 * corte de red, un 5xx, un token vencido o un 429 de cuota son del pedido entero y piden esperar: ahí
 * se marca fallida la tanda como siempre, para que la espera exponencial entre.
 */
let topeProvisorio: number | null = null

/**
 * Cuántas veces seguidas se puede partir la tanda sin que ninguna llegue a pasar. Si se llega a este
 * número, la bisección no está identificando nada (el rechazo no era de una celda sola) y hay que
 * contar el intento igual: si no, la cola reintentaría cada diez segundos para siempre, sin espera.
 */
const MAXIMO_DE_BISECCIONES = 6
let biseccionesSeguidas = 0

/** Después de que el servidor rechazó el contenido de una tanda de `cuantas`: la próxima sale con la mitad. */
export function achicarProximaTanda(cuantas: number): void {
  topeProvisorio = Math.max(1, Math.floor(cuantas / 2))
  biseccionesSeguidas++
}

/** Vuelve al tope normal y da por terminada la bisección: la llama toda tanda que salió bien. */
export function restablecerTanda(): void {
  topeProvisorio = null
  biseccionesSeguidas = 0
}

/** La bisección no progresa: hay que contar el intento y dejar que la espera exponencial haga lo suyo. */
export function biseccionAtascada(): boolean {
  return biseccionesSeguidas >= MAXIMO_DE_BISECCIONES
}

/** Entradas listas para intentar ahora (las que fallaron esperan su turno). */
export function pendientes(limite = 200): EntradaCola[] {
  if (topeProvisorio !== null) limite = Math.min(limite, topeProvisorio)
  const ahora = ahoraIso()
  const listas = db()
    .prepare(
      `SELECT * FROM cola_sync
       WHERE estado = 'pendiente' AND (proximo_intento IS NULL OR proximo_intento <= ?)
       ORDER BY id LIMIT ?`,
    )
    .all(ahora, limite) as FilaCola[]

  // Si en esta tanda ya va un borrado, se suman los otros borrados que sólo están esperando su ventana
  // de agrupado (intentos = 0: no son reintentos de algo que falló). Así todas las bajas de la seguidilla
  // se aplican en una sola pasada y la hoja se reacomoda una vez, en vez de una por baja.
  if (!listas.some((f) => f.operacion === 'borrar') || listas.length >= limite) return listas.map(aEntrada)
  const yaEstan = new Set(listas.map((f) => f.id))
  const esperando = db()
    .prepare(
      `SELECT * FROM cola_sync
       WHERE estado = 'pendiente' AND operacion = 'borrar' AND intentos = 0 AND proximo_intento > ?
       ORDER BY id LIMIT ?`,
    )
    .all(ahora, limite - listas.length) as FilaCola[]
  return [...listas, ...esperando.filter((f) => !yaEstan.has(f.id))].sort((a, b) => a.id - b.id).map(aEntrada)
}

/**
 * Saca la espera de agrupado de lo que está esperando nada más por eso: lo usa «Sincronizar ahora»,
 * donde alguien está mirando el botón y no tiene por qué esperar el minuto. No toca los reintentos de
 * entradas que fallaron (intentos > 0), que esperan por otro motivo.
 */
export function apurarAgrupadas(): number {
  return db()
    .prepare(`UPDATE cola_sync SET proximo_intento = NULL WHERE estado = 'pendiente' AND intentos = 0 AND proximo_intento IS NOT NULL`)
    .run().changes
}

/**
 * A qué pestañas hay que ESCRIBIR algo de lo que está esperando en la cola. Es lo único para lo que se
 * usa (ver `asegurarPestanasDeLaApp` y `asegurarPestanasDelMes` en el motor), y por eso deja afuera las
 * pestañas donde lo único pendiente es un borrado.
 *
 * La diferencia no es cosmética. Si la agencia archivó las planillas viejas —las sacó de la hoja— y
 * después se borra un cliente de esa época, sus filas siguen anotadas contra «MARZO 2021» y compañía.
 * Encolar esos borrados hacía que el motor viera pestañas pendientes que no existen y las CREARA
 * vacías, una por cada mes, nada más que para sacarles una fila que tampoco está. Un borrado no puede
 * agregarle pestañas a la base de la agencia: si la pestaña no existe, no hay nada que borrar ahí.
 */
export function pestanasPendientes(): string[] {
  return (
    db()
      .prepare(`SELECT DISTINCT pestana FROM cola_sync WHERE estado = 'pendiente' AND operacion <> 'borrar'`)
      .all() as Array<{ pestana: string }>
  ).map((fila) => fila.pestana)
}

export function cuantasPendientes(): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM cola_sync WHERE estado = 'pendiente'`).get() as { n: number }).n
}

/**
 * Cuántas se pueden intentar AHORA. No es lo mismo que `cuantasPendientes()`: una entrada que falló está
 * pendiente pero esperando su turno, y contarla como si se pudiera subir dejaba la bajada trabada (nadie
 * la subía y nadie bajaba nada hasta que se destrabara).
 */
export function cuantasListasParaSubir(): number {
  return (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM cola_sync WHERE estado = 'pendiente' AND (proximo_intento IS NULL OR proximo_intento <= ?)`)
      .get(ahoraIso()) as { n: number }
  ).n
}

/**
 * Filas con cambios locales sin subir: la bajada no las toca para no pisarlos. Cuentan también las
 * entradas dadas por perdidas (`fallido`, 12.7): hasta la 12.6 sólo contaban las pendientes, así que
 * la bajada pisaba la fila de una entrada fallida y, al apretar «Volver a intentar», el valor viejo
 * de esta computadora pisaba en silencio el más nuevo de la otra. Es el mismo criterio que usa la
 * importación (`filasConCambiosSinSubir`).
 */
export function filasConPendientes(): Set<string> {
  return new Set(
    (db().prepare(`SELECT DISTINCT fila_id FROM cola_sync WHERE estado IN ('pendiente', 'fallido')`).all() as Array<{ fila_id: string }>).map(
      (fila) => fila.fila_id,
    ),
  )
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

/**
 * Deja anotado el error en las entradas SIN sumarles un intento ni hacerlas esperar: es para la tanda
 * de varias que el servidor rechazó, donde todavía no se sabe cuál fue la mala (ver `achicarProximaTanda`).
 */
export function anotarErrorSinContar(ids: number[], error: string): void {
  if (ids.length === 0) return
  const anotar = db().prepare(`UPDATE cola_sync SET ultimo_error = ? WHERE id = ?`)
  db().transaction(() => {
    for (const id of ids) anotar.run(error.slice(0, 500), id)
  })()
}

/** Vuelve a poner en la cola las entradas que se habían dado por perdidas. */
export function reintentarFallidas(): number {
  return db()
    .prepare(`UPDATE cola_sync SET estado = 'pendiente', intentos = 0, proximo_intento = NULL WHERE estado = 'fallido'`)
    .run().changes
}

/**
 * Barre las entradas que nacieron rotas y no se pueden subir nunca.
 *
 * Hasta la 1.0.5, cuando la bajada encontraba una fila cargada a mano en la hoja (sin _ID) inventaba un
 * _ID y encolaba un «actualizar» para escribirlo. Ese identificador todavía no estaba en ninguna fila de
 * la hoja, así que la subida no encontraba dónde escribirlo y la entrada quedaba en «no se pudo» para
 * siempre; el _ID de verdad lo escribía la importación completa, que corre a continuación. Cada ciclo
 * dejaba una entrada muerta más, y el indicador de arriba nunca volvía a ponerse en verde.
 *
 * Se borran sólo las de esa forma exacta —un «actualizar» cuyo único campo es un _id igual al fila_id, y
 * cuya fila no existe en la base— así que ningún cambio real se pierde acá.
 */
export function limpiarImposibles(): number {
  return db()
    .prepare(
      `DELETE FROM cola_sync
       WHERE estado IN ('pendiente', 'fallido')
         AND operacion = 'actualizar'
         AND campos_json = '{"_id":"' || fila_id || '"}'
         AND fila_id NOT IN (SELECT fila_id FROM filas_crudas)`,
    )
    .run().changes
}

/**
 * Tira TODO lo que todavía no subió. Se usa en un solo lugar y es a propósito: al restaurar un
 * respaldo, lo que esperaba en la cola son justamente los cambios de después de esa foto —los que se
 * quieren descartar— y dejarlos ahí haría que el motor se los mandara al servidor recién restaurado y
 * deshiciera la restauración a los treinta segundos.
 *
 * Lo ya subido (`listo`) no se toca: eso es la bitácora de lo que sí viajó.
 */
export function vaciarCola(): number {
  return db().prepare(`DELETE FROM cola_sync WHERE estado IN ('pendiente', 'fallido')`).run().changes
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
