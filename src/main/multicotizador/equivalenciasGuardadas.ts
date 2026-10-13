// Las equivalencias aprendidas entre el vehículo del catálogo del formulario (hoy, el de Galeno) y el
// código de cada aseguradora que lo identifica de otra forma (ATM: su código de InfoAuto).
//
// Así lo resuelven los multicotizadores: un catálogo base y, por cada compañía, una tabla de
// homologación. Acá se arma sola: lo que la persona elige a mano manda siempre; lo que se eligió sin
// dudas y la compañía cotizó también queda, pero lo pisa cualquier elección a mano. Si la compañía
// después dice que no tiene ese código, se borra.
import { db, type BaseDeDatos } from '../db/base'

export type OrigenDeEquivalencia = 'MANUAL' | 'AUTOMATICA'

export interface Equivalencia {
  codigo: string
  origen: OrigenDeEquivalencia
}

/** La base, si está abierta: sin ella (pruebas del adaptador, el humo en vivo) no se recuerda nada. */
function base(): BaseDeDatos | null {
  try {
    return db()
  } catch {
    return null
  }
}

export function equivalenciaGuardada(aseguradora: string, catalogoCodigo: string): Equivalencia | null {
  if (!catalogoCodigo) return null
  const fila = base()
    ?.prepare('SELECT codigo, origen FROM equivalencias_vehiculos WHERE aseguradora = ? AND catalogo_codigo = ?')
    .get(aseguradora, catalogoCodigo) as Equivalencia | undefined
  return fila ?? null
}

/** Anota la equivalencia. Una automática no pisa una elegida a mano. */
export function guardarEquivalencia(
  aseguradora: string,
  catalogoCodigo: string,
  codigo: string,
  origen: OrigenDeEquivalencia,
  descripcion: string,
): void {
  if (!catalogoCodigo || !codigo) return
  const actual = equivalenciaGuardada(aseguradora, catalogoCodigo)
  if (actual && actual.codigo === codigo && (actual.origen === origen || origen === 'AUTOMATICA')) return
  if (actual?.origen === 'MANUAL' && origen === 'AUTOMATICA') return
  base()
    ?.prepare(
      `INSERT INTO equivalencias_vehiculos (aseguradora, catalogo_codigo, codigo, origen, descripcion, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (aseguradora, catalogo_codigo) DO UPDATE SET
         codigo = excluded.codigo, origen = excluded.origen, descripcion = excluded.descripcion, actualizado_en = excluded.actualizado_en`,
    )
    .run(aseguradora, catalogoCodigo, codigo, origen, descripcion, new Date().toISOString())
}

/** La compañía dijo que no tiene ese código: la equivalencia no sirve más. */
export function olvidarEquivalencia(aseguradora: string, catalogoCodigo: string, codigo: string): void {
  if (!catalogoCodigo) return
  base()?.prepare('DELETE FROM equivalencias_vehiculos WHERE aseguradora = ? AND catalogo_codigo = ? AND codigo = ?').run(aseguradora, catalogoCodigo, codigo)
}
