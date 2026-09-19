// Historial de cambios: todo lo que se toca desde la aplicación queda anotado con quién, cuándo,
// qué campo y qué valor tenía antes. Es la red de seguridad de la planilla compartida.
import type { EntradaHistorial, SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'

export type AccionHistorial =
  | 'edicion'
  | 'aviso'
  | 'pago'
  // Anular un pago cargado por error (ver servicios/pagos.ts): a diferencia de 'pago', esto lo saca
  // de la caja y de la rendición en vez de registrarlo.
  | 'pago_anulado'
  | 'baja'
  | 'reactivacion'
  | 'cierre_mes'
  | 'compania'
  // Fase 5: clientes, pólizas y renovaciones.
  | 'alta_cliente'
  | 'alta_poliza'
  | 'renovacion'
  | 'seguimiento'
  | 'nota'
  | 'tarea'
  | 'cobertura'
  | 'siniestro'
  // Fase 6: cobranzas.
  | 'imputacion'
  // Fase 8: lo comercial.
  | 'lead'
  | 'presupuesto'
  // Permisos por rol (Administración → Permisos).
  | 'permisos'
  // Avisos de rechazo del débito automático.
  | 'rechazo_debito'
  // Las listas de consulta del módulo Compañías: organizadores, precios, grúas y cláusulas.
  | 'referencia'
  // Borrado definitivo de un registro (ver shared/eliminacion.ts). El historial NO se borra nunca:
  // esta entrada es lo único que queda de lo que se fue.
  | 'eliminacion'
  // Rebobinar la base a un respaldo del servidor (sólo el SUPER_ADMIN). Igual que el borrado, esta
  // entrada es lo único que queda de lo que se pisó: quién restauró, cuándo y a qué respaldo.
  | 'restauracion'
  // Dos fichas de la misma persona que se juntan en una (Cartera → Duplicados, 12.6): queda anotado
  // qué ficha se fue y adónde pasó todo lo suyo.
  | 'fusion'
  // La caja chica del mostrador (12.10): el cambio del día, un gasto, lo que bajó a la caja fuerte y
  // el arqueo del cierre. Es plata, así que quién la tocó y cuánto puso queda anotado como todo lo demás.
  | 'caja'

export interface CambioARegistrar {
  accion: AccionHistorial
  tabla: string
  registroId?: number | null
  filaId?: string | null
  campo: string
  valorAnterior?: string | null
  valorNuevo?: string | null
}

/**
 * Qué acciones se pueden deshacer con un clic desde el historial (ver `servicios/deshacer.ts`).
 *
 * Sólo entran las que son «esta fila, esta columna, el valor de antes»: una edición de celda y el
 * aviso marcado a mano, que es lo mismo con dos columnas más (fecha de envío y la marca de enviado).
 * Bajas, pagos, cierres de mes, fusiones y borrados quedan afuera a propósito: arrastran otras filas,
 * plata o la hoja entera, y ya tienen (o necesitan) su propia reversión cuidada en vez de una genérica
 * a ciegas. Dar de baja, por ejemplo, se deshace desde Cartera → Bajas, que ya conoce el id exacto.
 */
export const ACCIONES_REVERSIBLES_DESDE_HISTORIAL: ReadonlySet<AccionHistorial> = new Set(['edicion', 'aviso'])

export interface EntradaHistorialCruda {
  id: number
  fecha: string
  usuarioNombre: string
  accion: AccionHistorial
  tabla: string
  registroId: number | null
  filaId: string | null
  campo: string
  valorAnterior: string | null
  valorNuevo: string | null
  deshechoEn: string | null
  deshechoPor: string | null
}

export function registrarCambio(actor: SesionUsuario, cambio: CambioARegistrar): void {
  db()
    .prepare(
      `INSERT INTO historial (fecha, usuario_id, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo)
       VALUES (@fecha, @usuario_id, @usuario_nombre, @accion, @tabla, @registro_id, @fila_id, @campo, @valor_anterior, @valor_nuevo)`,
    )
    .run({
      fecha: ahoraIso(),
      usuario_id: actor.id,
      usuario_nombre: actor.nombre,
      accion: cambio.accion,
      tabla: cambio.tabla,
      registro_id: cambio.registroId ?? null,
      fila_id: cambio.filaId ?? null,
      campo: cambio.campo,
      valor_anterior: cambio.valorAnterior ?? null,
      valor_nuevo: cambio.valorNuevo ?? null,
    })
}

interface FilaDeHistorial {
  id: number
  fecha: string
  usuario_nombre: string
  accion: string
  tabla: string
  registro_id: number | null
  fila_id: string | null
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  deshecho_en: string | null
  deshecho_por: string | null
}

function aEntradaCruda(f: FilaDeHistorial): EntradaHistorialCruda {
  return {
    id: f.id,
    fecha: f.fecha,
    usuarioNombre: f.usuario_nombre,
    accion: f.accion as AccionHistorial,
    tabla: f.tabla,
    registroId: f.registro_id,
    filaId: f.fila_id,
    campo: f.campo,
    valorAnterior: f.valor_anterior,
    valorNuevo: f.valor_nuevo,
    deshechoEn: f.deshecho_en,
    deshechoPor: f.deshecho_por,
  }
}

/** Historial de una fila de la planilla, lo más nuevo primero. */
export function historialDeFila(filaId: string, limite = 100): EntradaHistorial[] {
  const filas = db()
    .prepare(
      `SELECT id, fecha, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo,
              deshecho_en, deshecho_por
       FROM historial WHERE fila_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(filaId, limite) as FilaDeHistorial[]
  return filas.map((f) => {
    const cruda = aEntradaCruda(f)
    return {
      id: cruda.id,
      fecha: cruda.fecha,
      usuarioNombre: cruda.usuarioNombre,
      accion: cruda.accion,
      tabla: cruda.tabla,
      filaId: cruda.filaId,
      campo: cruda.campo,
      valorAnterior: cruda.valorAnterior,
      valorNuevo: cruda.valorNuevo,
      deshechoEn: cruda.deshechoEn,
      deshechoPor: cruda.deshechoPor,
      puedeDeshacerse: cruda.deshechoEn === null && ACCIONES_REVERSIBLES_DESDE_HISTORIAL.has(cruda.accion),
    }
  })
}

/** Una entrada puntual del historial, cruda, para que `servicios/deshacer.ts` sepa qué revertir. */
export function buscarEntradaDeHistorial(id: number): EntradaHistorialCruda | undefined {
  const fila = db()
    .prepare(
      `SELECT id, fecha, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo,
              deshecho_en, deshecho_por
       FROM historial WHERE id = ?`,
    )
    .get(id) as FilaDeHistorial | undefined
  return fila ? aEntradaCruda(fila) : undefined
}

/**
 * Marca una entrada como deshecha. `WHERE deshecho_en IS NULL` de paso: si dos clics llegan casi
 * juntos (dos pestañas, dos computadoras) el segundo no encuentra nada para marcar y `deshacer.ts`
 * lo corta ahí, en vez de deshacer el mismo cambio dos veces.
 */
export function marcarEntradaDeshecha(id: number, actor: SesionUsuario): boolean {
  const resultado = db()
    .prepare(`UPDATE historial SET deshecho_en = ?, deshecho_por = ? WHERE id = ? AND deshecho_en IS NULL`)
    .run(ahoraIso(), actor.nombre, id)
  return resultado.changes > 0
}
