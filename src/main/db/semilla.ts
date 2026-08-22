// Datos iniciales: las tres sucursales y el usuario SUPER_ADMIN del primer arranque.
import type { Database } from 'better-sqlite3'
import { hashSync } from 'bcryptjs'
import { COSTO_BCRYPT } from '../servicios/claves'

export const SUCURSALES_INICIALES = ['Dock Sud', 'Lanús', 'Daniel'] as const

export const USUARIO_INICIAL = {
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  clave: 'cambiar123',
  rol: 'SUPER_ADMIN',
  sucursal: 'Daniel',
} as const

export function sembrarDatosIniciales(db: Database): void {
  const insertarSucursal = db.prepare('INSERT OR IGNORE INTO sucursales (nombre) VALUES (?)')
  db.transaction(() => {
    for (const nombre of SUCURSALES_INICIALES) insertarSucursal.run(nombre)
  })()

  const { total } = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get() as { total: number }
  if (total > 0) return

  const sucursal = db
    .prepare('SELECT id FROM sucursales WHERE nombre = ?')
    .get(USUARIO_INICIAL.sucursal) as { id: number }

  db.prepare(
    `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
  ).run(
    USUARIO_INICIAL.nombre,
    USUARIO_INICIAL.usuario,
    hashSync(USUARIO_INICIAL.clave, COSTO_BCRYPT),
    USUARIO_INICIAL.rol,
    sucursal.id,
  )
  console.log('[db] Usuario inicial "' + USUARIO_INICIAL.usuario + '" creado. Debe cambiar la contraseña al ingresar.')
}
