// El espejo local de la base de usuarios de GitHub.
//
// La tabla `usuarios` no puede desaparecer: pagos, historial, tareas, siniestros y una docena de
// tablas más la referencian por id, y las pantallas listan «responsables» desde ahí. Entonces cada
// computadora conserva una fila por usuario, pero SIN contraseña (clave_hash = '') y enganchada al id
// de GitHub por `remoto_id`. El id local sigue siendo el que usan las claves foráneas; el remoto es el
// que une la misma persona en todas las computadoras.
import type { BaseDeDatos } from '../db/base'
import { buscarPorUsuario, type DocumentoUsuarios, type UsuarioRemoto } from './documento'

export interface ResultadoEspejo {
  /** Filas de antes de la Fase 11 que se engancharon a su usuario de GitHub por nombre de usuario. */
  enlazados: string[]
  /** Filas locales que no existen en GitHub: quedan desactivadas y sin contraseña. */
  desactivados: string[]
  total: number
}

function clave(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

/**
 * Devuelve el id de la sucursal por nombre sin distinguir mayúsculas ni tildes («Lanus» es «Lanús»:
 * el archivo se puede editar a mano en GitHub), creándola si esta computadora no la tenía.
 */
export function idDeSucursal(db: BaseDeDatos, nombre: string): number {
  const buscada = clave(nombre)
  const existentes = db.prepare('SELECT id, nombre FROM sucursales').all() as Array<{ id: number; nombre: string }>
  const igual = existentes.find((s) => clave(s.nombre) === buscada)
  if (igual) return igual.id
  console.log(`[usuarios] La sucursal «${nombre}» no existía en esta computadora: se crea.`)
  return Number(db.prepare('INSERT INTO sucursales (nombre) VALUES (?)').run(nombre.trim()).lastInsertRowid)
}

/** Prefijo de los nombres provisorios durante el volcado. El formato de usuario no admite «#». */
const PROVISORIO = '#'

export function reflejarDocumento(db: BaseDeDatos, documento: DocumentoUsuarios, ahora: string): ResultadoEspejo {
  return db.transaction((): ResultadoEspejo => {
    const enlazados: string[] = []
    const desactivados: string[] = []

    // 1. Las filas anteriores a esta versión (sin remoto_id) se enganchan por nombre de usuario.
    const heredadas = db.prepare('SELECT id, usuario FROM usuarios WHERE remoto_id IS NULL').all() as Array<{ id: number; usuario: string }>
    const enlazar = db.prepare('UPDATE usuarios SET remoto_id = ? WHERE id = ?')
    const yaEnlazado = db.prepare('SELECT id FROM usuarios WHERE remoto_id = ?')
    for (const fila of heredadas) {
      const remoto = buscarPorUsuario(documento, fila.usuario)
      if (remoto && !yaEnlazado.get(remoto.id)) {
        enlazar.run(remoto.id, fila.id)
        enlazados.push(fila.usuario)
      }
    }

    // 2. Nombres provisorios para TODAS las filas: dos usuarios renombrados en cruce («ana» pasa a ser
    //    «ana.b» y otra persona toma «ana») chocarían con el índice único si se actualizaran de a uno,
    //    y una fila suelta (sin remoto_id) también puede estar ocupando el nombre que GitHub le dio a otro.
    db.prepare(`UPDATE usuarios SET usuario = '${PROVISORIO}' || id || '${PROVISORIO}' || usuario`).run()

    // 3. Volcado: una fila por usuario de GitHub, sin contraseña.
    const buscarLocal = db.prepare('SELECT id FROM usuarios WHERE remoto_id = ?')
    const actualizar = db.prepare(
      `UPDATE usuarios SET nombre = ?, usuario = ?, clave_hash = '', rol = ?, sucursal_id = ?, activo = ?,
                           debe_cambiar_clave = ?, actualizado_en = ?
       WHERE id = ?`,
    )
    const insertar = db.prepare(
      `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave, remoto_id, creado_en, actualizado_en)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const u of documento.usuarios) {
      const sucursalId = idDeSucursal(db, u.sucursal)
      const local = buscarLocal.get(u.id) as { id: number } | undefined
      if (local) {
        actualizar.run(u.nombre, u.usuario, u.rol, sucursalId, u.activo ? 1 : 0, u.debeCambiarClave ? 1 : 0, u.actualizadoEn || ahora, local.id)
      } else {
        insertar.run(u.nombre, u.usuario, u.rol, sucursalId, u.activo ? 1 : 0, u.debeCambiarClave ? 1 : 0, u.id, u.creadoEn || ahora, u.actualizadoEn || ahora)
      }
    }

    // 4. Las filas que quedaron con nombre provisorio no están en el archivo: las espejo huérfanas (el
    //    archivo se editó a mano) y las locales sueltas (no se suben solas, ver baseDeUsuarios.ts: sería
    //    una puerta trasera; tampoco se borran, porque tienen historial colgado). Recuperan su nombre si
    //    sigue libre —GitHub pudo dárselo a otra persona— y si no, uno con sufijo: desactivadas y sin
    //    contraseña no pueden ingresar, así que el nombre ya no les importa.
    const provisorias = db
      .prepare(`SELECT id, usuario, activo, clave_hash FROM usuarios WHERE usuario LIKE '${PROVISORIO}%'`)
      .all() as Array<{ id: number; usuario: string; activo: number; clave_hash: string }>
    const ocupado = db.prepare('SELECT id FROM usuarios WHERE usuario = ? AND id <> ?')
    const restaurar = db.prepare(`UPDATE usuarios SET usuario = ?, activo = 0, clave_hash = '', actualizado_en = ? WHERE id = ?`)
    for (const fila of provisorias) {
      const original = fila.usuario.slice(fila.usuario.indexOf(PROVISORIO, 1) + 1)
      const nombre = ocupado.get(original, fila.id) ? `${original}~local${fila.id}` : original
      if (fila.activo === 1) desactivados.push(original)
      restaurar.run(nombre, ahora, fila.id)
    }

    return { enlazados, desactivados, total: documento.usuarios.length }
  })()
}

export function idLocalPorRemotoId(db: BaseDeDatos, remotoId: number): number | null {
  const fila = db.prepare('SELECT id FROM usuarios WHERE remoto_id = ?').get(remotoId) as { id: number } | undefined
  return fila?.id ?? null
}

export function remotoIdDeLocal(db: BaseDeDatos, id: number): number | null {
  const fila = db.prepare('SELECT remoto_id FROM usuarios WHERE id = ?').get(id) as { remoto_id: number | null } | undefined
  return fila?.remoto_id ?? null
}

/**
 * Los usuarios locales que todavía tienen contraseña: lo que sube al crear usuarios.json la primera
 * vez (bootstrap). Después de eso no queda ninguno, porque el espejo vacía los hashes.
 */
export function usuariosLocalesConClave(db: BaseDeDatos): Array<Omit<UsuarioRemoto, 'id'>> {
  const filas = db
    .prepare(
      `SELECT u.nombre, u.usuario, u.clave_hash, u.rol, s.nombre AS sucursal, u.activo, u.debe_cambiar_clave, u.creado_en, u.actualizado_en
       FROM usuarios u JOIN sucursales s ON s.id = u.sucursal_id
       WHERE u.remoto_id IS NULL AND u.clave_hash <> ''
       ORDER BY u.id`,
    )
    .all() as Array<{
    nombre: string
    usuario: string
    clave_hash: string
    rol: UsuarioRemoto['rol']
    sucursal: string
    activo: number
    debe_cambiar_clave: number
    creado_en: string
    actualizado_en: string
  }>
  return filas.map((f) => ({
    nombre: f.nombre,
    usuario: f.usuario,
    claveHash: f.clave_hash,
    rol: f.rol,
    sucursal: f.sucursal,
    activo: f.activo === 1,
    debeCambiarClave: f.debe_cambiar_clave === 1,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  }))
}

/**
 * Fila del espejo para una sesión sin internet. Normalmente ya existe (se creó en el ingreso en línea
 * que guardó la credencial); si la base local se recreó o se restauró un respaldo viejo, se crea desde
 * el snapshot de la credencial, así las claves foráneas tienen a quién apuntar.
 */
export function asegurarFilaDesdeCredencial(
  db: BaseDeDatos,
  credencial: { remotoId: number; usuario: string; nombre: string; rol: UsuarioRemoto['rol']; sucursal: string },
  ahora: string,
): number {
  const existente = idLocalPorRemotoId(db, credencial.remotoId)
  if (existente !== null) return existente
  const sucursalId = idDeSucursal(db, credencial.sucursal)
  // Si quedó una fila heredada con ese nombre de usuario (sin remoto_id), se la engancha en vez de chocar.
  const heredada = db.prepare('SELECT id FROM usuarios WHERE usuario = ? AND remoto_id IS NULL').get(credencial.usuario) as { id: number } | undefined
  if (heredada) {
    db.prepare(`UPDATE usuarios SET remoto_id = ?, nombre = ?, rol = ?, sucursal_id = ?, clave_hash = '', activo = 1, actualizado_en = ? WHERE id = ?`).run(
      credencial.remotoId, credencial.nombre, credencial.rol, sucursalId, ahora, heredada.id,
    )
    return heredada.id
  }
  return Number(
    db
      .prepare(
        `INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave, remoto_id, creado_en, actualizado_en)
         VALUES (?, ?, '', ?, ?, 1, 0, ?, ?, ?)`,
      )
      .run(credencial.nombre, credencial.usuario, credencial.rol, sucursalId, credencial.remotoId, ahora, ahora).lastInsertRowid,
  )
}
