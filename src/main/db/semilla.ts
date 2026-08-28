// Datos iniciales: las cuatro sucursales y el usuario SUPER_ADMIN del primer arranque.
import type { Database } from 'better-sqlite3'
import { hashSync } from 'bcryptjs'
import { claveDeSucursal, sucursalCanonica, SUCURSALES } from '../../shared/sucursales'
import { COSTO_BCRYPT } from '../servicios/claves'

export const SUCURSALES_INICIALES = SUCURSALES

export const USUARIO_INICIAL = {
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  clave: 'cambiar123',
  rol: 'SUPER_ADMIN',
  sucursal: 'Daniel',
} as const

/**
 * Deja el catálogo con las cuatro sucursales y nada más. Corre en cada arranque porque las bases viejas
 * traen lo que se sembró o se creó en su momento: les falta Sarandí, y pueden tener una fila «Avellaneda»
 * creada por el usuarios.json de GitHub, que es el mismo mostrador que Dock Sud escrito de la otra forma.
 *
 * Las filas repetidas no se pueden borrar sin más: usuarios, clientes y leads las referencian por id. Se
 * repunta cada referencia a la fila que queda y recién ahí se borra la que sobra.
 */
export function ajustarCatalogoDeSucursales(db: Database): void {
  const insertarSucursal = db.prepare('INSERT OR IGNORE INTO sucursales (nombre) VALUES (?)')
  db.transaction(() => {
    for (const nombre of SUCURSALES) insertarSucursal.run(nombre)

    const filas = db.prepare('SELECT id, nombre FROM sucursales ORDER BY id').all() as Array<{ id: number; nombre: string }>
    const canonica = new Map<string, number>()
    for (const fila of filas) {
      if (fila.nombre === sucursalCanonica(fila.nombre)) canonica.set(claveDeSucursal(fila.nombre), fila.id)
    }

    for (const fila of filas) {
      const nombre = sucursalCanonica(fila.nombre)
      // Un nombre que no es ninguna de las cuatro no se toca: borrarlo dejaría sin sucursal a la gente
      // que lo tenga asignada, y no hay forma de adivinar cuál le corresponde.
      if (!nombre) continue
      const destino = canonica.get(claveDeSucursal(nombre))
      if (destino === undefined || destino === fila.id) continue
      for (const tabla of ['usuarios', 'clientes', 'leads']) {
        db.prepare(`UPDATE ${tabla} SET sucursal_id = ? WHERE sucursal_id = ?`).run(destino, fila.id)
      }
      db.prepare('DELETE FROM sucursales WHERE id = ?').run(fila.id)
      console.log(`[db] La sucursal «${fila.nombre}» es «${nombre}»: se unieron en una sola.`)
    }
  })()
}

export function sembrarDatosIniciales(db: Database): void {
  ajustarCatalogoDeSucursales(db)

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
