// Apertura de la base SQLite local y acceso a la instancia única.
import Database from 'better-sqlite3'
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

export function cerrarBaseDeDatos(): void {
  instancia?.close()
  instancia = null
}
