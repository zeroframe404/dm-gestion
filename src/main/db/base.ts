// Apertura de la base SQLite local y acceso a la instancia única.
import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import {
  huboReparacion,
  reconciliarEsquema,
  reparacionConProblemas,
  resumenDeReparacion,
  type ReparacionDeEsquema,
} from './esquema'
import { ejecutarMigraciones, MIGRACIONES } from './migraciones'
import { sembrarDatosIniciales } from './semilla'
import { recalcularVigencias } from './vigencias'

export type BaseDeDatos = Database.Database

let instancia: BaseDeDatos | null = null

/**
 * Cuánto espera la apertura si otro proceso está escribiendo, antes de darse por vencida.
 *
 * Por defecto better-sqlite3 espera 5 segundos y después tira «database is locked». Cinco segundos
 * alcanzan para una escritura normal, pero NO para el momento en que hacen falta: el de la
 * actualización, con la versión anterior todavía terminando de cerrar —o colgada— sobre la misma
 * base. Ahí, rendirse rápido significa que el programa nuevo no abre.
 */
const ESPERA_POR_LA_BASE_MS = 20_000

/**
 * La huella de las migraciones que trae esta versión del programa. Si la base ya fue revisada contra
 * esta misma huella, la revisión del esquema (que arma una base entera en memoria) se saltea: es el
 * paso más caro de la apertura y en una base sana no cambia nada de una vez a la otra.
 */
const HUELLA_DE_LAS_MIGRACIONES = createHash('sha256')
  .update(MIGRACIONES.map((m) => `${m.version}\n${m.sql}`).join('\n---\n'))
  .digest('hex')
  .slice(0, 16)

const MARCA_DE_ESQUEMA = 'esquema_verificado'

export function abrirBaseDeDatos(ruta: string): BaseDeDatos {
  const arranque = Date.now()
  const db = new Database(ruta, { timeout: ESPERA_POR_LA_BASE_MS })
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = ' + ESPERA_POR_LA_BASE_MS)
  db.pragma('foreign_keys = ON')
  // Con WAL, `synchronous = NORMAL` es seguro ante un corte de luz (lo último confirmado puede
  // perderse, la base no se rompe) y evita un fsync por transacción: la importación y la bajada
  // escriben miles de filas en transacciones chicas. La caché y el mapa en memoria hacen que la
  // planilla del mes y las métricas no vuelvan al disco por cada consulta.
  db.pragma('synchronous = NORMAL')
  db.pragma('cache_size = -65536')
  db.pragma('temp_store = MEMORY')
  db.pragma('mmap_size = 268435456')
  ejecutarMigraciones(db)
  // Red de seguridad contra bases que quedaron con columnas de menos porque una migración ya aplicada
  // se editó después (ver src/main/db/esquema.ts). En una base sana no toca nada. Va en try/catch porque
  // es una ayuda, no un requisito: si falla, la aplicación tiene que abrir igual (las migraciones, que sí
  // son obligatorias, ya pasaron). Se corre una vez por versión del programa: si esta base ya se revisó
  // contra estas mismas migraciones, no hay nada nuevo que pueda faltarle.
  try {
    if (leerMarcaDeEsquema(db) !== HUELLA_DE_LAS_MIGRACIONES) {
      const reparacion = reconciliarEsquema(db)
      if (huboReparacion(reparacion)) {
        console.warn('[db] Esquema reparado → ' + resumenDeReparacion(reparacion))
        anotarReparacion(db, reparacion)
      }
      if (!reparacionConProblemas(reparacion)) guardarMarcaDeEsquema(db)
    }
  } catch (error) {
    console.error('[db] No se pudo revisar el esquema:', error)
  }
  sembrarDatosIniciales(db)
  // Lo importado antes de la Fase 5 no tiene las vigencias como fecha: se completan acá, una sola vez.
  const vigencias = recalcularVigencias(db)
  if (vigencias.completadas > 0) console.log(`[db] Vigencias completadas en ${vigencias.completadas} pólizas`)
  instancia = db
  console.log(`[db] Base de datos abierta en ${ruta} (${Date.now() - arranque} ms)`)
  return db
}

function leerMarcaDeEsquema(db: BaseDeDatos): string | null {
  try {
    return (db.prepare('SELECT valor FROM estado_sync WHERE clave = ?').get(MARCA_DE_ESQUEMA) as { valor: string } | undefined)?.valor ?? null
  } catch {
    return null
  }
}

function guardarMarcaDeEsquema(db: BaseDeDatos): void {
  try {
    db.prepare(
      `INSERT INTO estado_sync (clave, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    ).run(MARCA_DE_ESQUEMA, HUELLA_DE_LAS_MIGRACIONES, new Date().toISOString())
  } catch (error) {
    console.error('[db] No se pudo anotar la revisión del esquema:', error)
  }
}

/** Devuelve la base abierta. Falla si se llama antes de `abrirBaseDeDatos`. */
export function db(): BaseDeDatos {
  if (!instancia) throw new Error('La base de datos todavía no está abierta.')
  return instancia
}

/**
 * Deja constancia de la reparación en la bitácora de Administración → Sincronización. Se escribe con el
 * handle local porque `db()` todavía no está disponible: la base recién se está abriendo.
 */
function anotarReparacion(db: BaseDeDatos, reparacion: ReparacionDeEsquema): void {
  try {
    db.prepare(`INSERT INTO eventos_sync (fecha, tipo, detalle, con_error) VALUES (?, 'esquema', ?, ?)`).run(
      new Date().toISOString(),
      'La base tenía partes del esquema sin aplicar y se completaron al abrir. ' + resumenDeReparacion(reparacion),
      reparacionConProblemas(reparacion) ? 1 : 0,
    )
  } catch (error) {
    console.error('[db] No se pudo anotar la reparación del esquema:', error)
  }
}

export function cerrarBaseDeDatos(): void {
  instancia?.close()
  instancia = null
}

/**
 * Cambia la base activa por otra ya abierta, sin cerrar la anterior. Lo usan las pruebas que simulan
 * dos computadoras contra la misma base de la agencia: cada una tiene su SQLite y se alternan.
 */
export function usarBaseDeDatos(db: BaseDeDatos): void {
  instancia = db
}
