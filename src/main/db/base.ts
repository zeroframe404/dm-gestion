// Apertura de la base SQLite local y acceso a la instancia única.
import Database from 'better-sqlite3'
import {
  huboReparacion,
  reconciliarEsquema,
  reparacionConProblemas,
  resumenDeReparacion,
  type ReparacionDeEsquema,
} from './esquema'
import { ejecutarMigraciones } from './migraciones'
import { sembrarDatosIniciales } from './semilla'
import { recalcularVigencias } from './vigencias'

export type BaseDeDatos = Database.Database

let instancia: BaseDeDatos | null = null

export function abrirBaseDeDatos(ruta: string): BaseDeDatos {
  const db = new Database(ruta)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  ejecutarMigraciones(db)
  // Red de seguridad contra bases que quedaron con columnas de menos porque una migración ya aplicada
  // se editó después (ver src/main/db/esquema.ts). En una base sana no toca nada. Va en try/catch porque
  // es una ayuda, no un requisito: si falla, la aplicación tiene que abrir igual (las migraciones, que sí
  // son obligatorias, ya pasaron).
  try {
    const reparacion = reconciliarEsquema(db)
    if (huboReparacion(reparacion)) {
      console.warn('[db] Esquema reparado → ' + resumenDeReparacion(reparacion))
      anotarReparacion(db, reparacion)
    }
  } catch (error) {
    console.error('[db] No se pudo revisar el esquema:', error)
  }
  sembrarDatosIniciales(db)
  // Lo importado antes de la Fase 5 no tiene las vigencias como fecha: se completan acá, una sola vez.
  const vigencias = recalcularVigencias(db)
  if (vigencias.completadas > 0) console.log(`[db] Vigencias completadas en ${vigencias.completadas} pólizas`)
  instancia = db
  console.log('[db] Base de datos abierta en ' + ruta)
  return db
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
