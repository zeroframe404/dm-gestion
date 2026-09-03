// Historial de cambios: todo lo que se toca desde la aplicación queda anotado con quién, cuándo,
// qué campo y qué valor tenía antes. Es la red de seguridad de la planilla compartida.
import type { EntradaHistorial, SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'

export type AccionHistorial =
  | 'edicion'
  | 'aviso'
  | 'pago'
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

export interface CambioARegistrar {
  accion: AccionHistorial
  tabla: string
  registroId?: number | null
  filaId?: string | null
  campo: string
  valorAnterior?: string | null
  valorNuevo?: string | null
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

/** Historial de una fila de la planilla, lo más nuevo primero. */
export function historialDeFila(filaId: string, limite = 100): EntradaHistorial[] {
  const filas = db()
    .prepare(
      `SELECT id, fecha, usuario_nombre, accion, tabla, fila_id, campo, valor_anterior, valor_nuevo
       FROM historial WHERE fila_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(filaId, limite) as Array<{
    id: number
    fecha: string
    usuario_nombre: string
    accion: string
    tabla: string
    fila_id: string | null
    campo: string
    valor_anterior: string | null
    valor_nuevo: string | null
  }>
  return filas.map((f) => ({
    id: f.id,
    fecha: f.fecha,
    usuarioNombre: f.usuario_nombre,
    accion: f.accion,
    tabla: f.tabla,
    filaId: f.fila_id,
    campo: f.campo,
    valorAnterior: f.valor_anterior,
    valorNuevo: f.valor_nuevo,
  }))
}
