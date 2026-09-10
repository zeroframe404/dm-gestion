// Caché local de las métricas que ahora calcula el servidor: el podio de sucursales, primero (ver
// vivo/grilla.ts, que es quien la llena). Esta computadora ya no hace la cuenta; guarda acá
// lo último que el servidor le mandó y lo relee al toque, sin ir a buscarlo de nuevo.
import { ahoraIso } from '../importacion/normalizar'
import { db } from '../db/base'

export interface SnapshotDeMetrica {
  payload: unknown
  /** La versión con la que el servidor identifica este cálculo: sube cada vez que lo vuelve a hacer. */
  servidorVersion: number
  /** Cuándo el SERVIDOR hizo esta cuenta (ISO), no cuándo esta computadora la recibió. */
  servidorCalculadoEn: string
  /** Cuándo ESTA computadora guardó este snapshot (ISO). */
  recibidoEn: string
}

interface FilaMetricaCache {
  payload_json: string
  servidor_version: number
  servidor_calculado_en: string
  recibido_en: string
}

/** Guarda (o pisa) lo último que el servidor contestó para esta métrica. */
export function guardarSnapshotDeMetrica(clave: string, servidor: { version: number; calculadoEn: string; payload: unknown }): void {
  db()
    .prepare(
      `INSERT INTO metricas_cache (clave, payload_json, servidor_version, servidor_calculado_en, recibido_en)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET
         payload_json = excluded.payload_json,
         servidor_version = excluded.servidor_version,
         servidor_calculado_en = excluded.servidor_calculado_en,
         recibido_en = excluded.recibido_en`,
    )
    .run(clave, JSON.stringify(servidor.payload), servidor.version, servidor.calculadoEn, ahoraIso())
}

/** Lo último que se guardó de esta métrica, o null si esta computadora todavía no bajó nada. */
export function leerSnapshotDeMetrica(clave: string): SnapshotDeMetrica | null {
  const fila = db()
    .prepare(`SELECT payload_json, servidor_version, servidor_calculado_en, recibido_en FROM metricas_cache WHERE clave = ?`)
    .get(clave) as FilaMetricaCache | undefined
  if (!fila) return null
  return {
    payload: JSON.parse(fila.payload_json) as unknown,
    servidorVersion: fila.servidor_version,
    servidorCalculadoEn: fila.servidor_calculado_en,
    recibidoEn: fila.recibido_en,
  }
}
