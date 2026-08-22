// Recálculo de las vigencias en formato fecha. Las pólizas guardan la vigencia como texto, tal cual
// viene de la hoja («27/4/2026»), y además una copia interpretada en `vigencia_desde_iso` /
// `vigencia_hasta_iso` que es la que usan la bandeja de renovaciones y el estado de la póliza.
//
// El importador las deriva al guardar, pero todo lo que se importó antes de la Fase 5 las tiene en
// blanco. Esta función las completa sin tocar el texto original y se puede correr todas las veces que
// haga falta: sólo mira las filas donde hay texto y todavía no hay fecha.
import type { BaseDeDatos } from './base'
import { interpretarFecha } from '../importacion/normalizar'

interface FilaPendiente {
  id: number
  vigencia_desde: string | null
  vigencia_hasta: string | null
  vigencia_desde_iso: string | null
  vigencia_hasta_iso: string | null
  periodo_origen: string | null
}

export interface ResultadoRecalculo {
  revisadas: number
  completadas: number
}

/**
 * Completa `vigencia_desde_iso` y `vigencia_hasta_iso` donde falten. Las que no se puedan interpretar
 * («A/D», «ANUAL», una celda con un guión) quedan en blanco a propósito: sin fecha no entran en la
 * bandeja de renovaciones, que es preferible a colarlas con una fecha inventada.
 */
export function recalcularVigencias(db: BaseDeDatos, anioActual = new Date().getFullYear()): ResultadoRecalculo {
  const pendientes = db
    .prepare(
      `SELECT id, vigencia_desde, vigencia_hasta, vigencia_desde_iso, vigencia_hasta_iso, periodo_origen
       FROM polizas
       WHERE (vigencia_desde_iso IS NULL AND vigencia_desde IS NOT NULL AND TRIM(vigencia_desde) <> '')
          OR (vigencia_hasta_iso IS NULL AND vigencia_hasta IS NOT NULL AND TRIM(vigencia_hasta) <> '')`,
    )
    .all() as FilaPendiente[]

  if (pendientes.length === 0) return { revisadas: 0, completadas: 0 }

  const actualizar = db.prepare('UPDATE polizas SET vigencia_desde_iso = ?, vigencia_hasta_iso = ? WHERE id = ?')
  let completadas = 0

  db.transaction(() => {
    for (const fila of pendientes) {
      // El año de la planilla de la que salió la póliza es el mejor supuesto para las fechas que
      // vienen sin año («27/4»). Una vigencia que termina el año que viene es lo normal, así que para
      // la de HASTA se corre un año la ventana de años aceptados.
      const anioBase = fila.periodo_origen ? Number(fila.periodo_origen.slice(0, 4)) : null
      const base = Number.isFinite(anioBase) ? anioBase : null
      const desde = fila.vigencia_desde_iso ?? interpretarFecha(fila.vigencia_desde, base, anioActual).iso
      const hasta = fila.vigencia_hasta_iso ?? interpretarFecha(fila.vigencia_hasta, base, anioActual + 1).iso
      if (desde === fila.vigencia_desde_iso && hasta === fila.vigencia_hasta_iso) continue
      actualizar.run(desde, hasta, fila.id)
      completadas++
    }
  })()

  return { revisadas: pendientes.length, completadas }
}
