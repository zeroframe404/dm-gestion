// Cartera → Flotas: agrupa las pólizas vigentes por nombre del titular (sin mayúsculas, tildes ni espacios de
// más) y devuelve los grupos que llegan al mínimo. Es una vista calculada: no guarda nada, así que no toca
// al VPS ni a la versión normal.
import { MINIMO_DE_POLIZAS_DE_UNA_FLOTA, type Flota } from '../../shared/flotas'
import { db } from '../db/base'
import { normalizarTexto } from '../importacion/normalizar'

interface FilaDeFlota {
  poliza_id: number
  cliente_id: number
  nombre: string
  patente: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  compania: string | null
  numero: string | null
  cobertura: string | null
  vigencia_hasta: string | null
}

export function listarFlotas(): Flota[] {
  const filas = db()
    .prepare(
      `SELECT p.id AS poliza_id, p.cliente_id, c.nombre, v.patente, v.marca, v.modelo, v.anio,
              p.compania, p.numero, p.cobertura, p.vigencia_hasta
         FROM polizas p
         JOIN clientes c ON c.id = p.cliente_id
         LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
        WHERE p.activa = 1 AND p.vehiculo_id IS NOT NULL`,
    )
    .all() as FilaDeFlota[]

  const grupos = new Map<string, { nombre: string; clientes: Set<number>; filas: FilaDeFlota[] }>()
  for (const fila of filas) {
    const clave = normalizarTexto(fila.nombre)
    if (!clave) continue
    const grupo = grupos.get(clave) ?? { nombre: fila.nombre, clientes: new Set<number>(), filas: [] }
    grupo.clientes.add(fila.cliente_id)
    grupo.filas.push(fila)
    grupos.set(clave, grupo)
  }

  return [...grupos.values()]
    .filter((g) => g.filas.length >= MINIMO_DE_POLIZAS_DE_UNA_FLOTA)
    .map((g) => ({
      nombre: g.nombre,
      clientes: g.clientes.size,
      vehiculos: g.filas
        .map((f) => ({
          polizaId: f.poliza_id,
          clienteId: f.cliente_id,
          patente: f.patente,
          marca: f.marca,
          modelo: f.modelo,
          anio: f.anio,
          compania: f.compania,
          numero: f.numero,
          cobertura: f.cobertura,
          vigenciaHasta: f.vigencia_hasta,
        }))
        .sort((a, b) => (a.patente ?? '').localeCompare(b.patente ?? '', 'es')),
    }))
    .sort((a, b) => b.vehiculos.length - a.vehiculos.length || a.nombre.localeCompare(b.nombre, 'es'))
}
