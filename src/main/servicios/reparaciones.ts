// Arreglos de lo que dejaron versiones anteriores y hoy se sabe hacer bien. Corren al arrancar la
// sincronización y después de cada importación completa; en una base sana no tocan nada.
//
// Dos cosas, las dos de la 12.2:
//  - Los PAGOS que nunca viajaron. Hasta la 12.1, sin una pestaña IMPUTADOS que fuera una tabla por
//    fila, el pago quedaba sólo en la computadora que lo cobró; ahora viaja por «APP PAGOS» (ver
//    pagos.ts), y los que ya estaban se encolan una vez para que lleguen a las otras computadoras.
//  - Las BAJAS duplicadas. Cuando la misma fila se agregaba dos veces a BAJAS (ver `subirTanda`), la
//    importación le inventaba un _ID nuevo al segundo renglón y la póliza aparecía dos veces en la
//    pantalla de Bajas. Ya no se agrega dos veces; lo que quedó repetido se saca acá, de la base local
//    y de la base de la agencia.
import { db } from '../db/base'
import { anotarEvento, encolar } from '../sincronizacion/cola'
import { filasConCambiosSinSubir, PESTANA_APP, PREFIJO_DE_BAJA } from './filas'
import { subirPagosRezagados } from './pagos'

interface BajaRepetida {
  id: number
  fila_id: string
  poliza_id: number
  periodo: string
  hecha_en_la_app: number
  /** Dónde vive el renglón en la hoja, si está en ella; null si nunca viajó o ya no está. */
  pestana: string | null
}

/**
 * Elige cuál de las bajas repetidas de una póliza en un mes es la de verdad: la que hizo la aplicación,
 * si no la que lleva el _ID con el que la aplicación nombra a sus bajas, y si no la más vieja. Las
 * demás son copias.
 */
export function elegirBajaQueQueda<T extends { id: number; fila_id: string; hecha_en_la_app: number }>(grupo: T[]): T {
  const puntaje = (baja: T) => (baja.hecha_en_la_app === 1 ? 2 : 0) + (baja.fila_id.startsWith(PREFIJO_DE_BAJA) ? 1 : 0)
  return [...grupo].sort((a, b) => puntaje(b) - puntaje(a) || a.id - b.id)[0]!
}

/**
 * Saca las bajas repetidas: misma póliza y mismo mes más de una vez, cuando alguna de ellas es de la
 * aplicación (las repetidas que vienen de la hoja vieja de la agencia no se tocan: no son nuestras).
 * La copia se borra de acá y se encola su borrado en la hoja, así desaparece también en las otras
 * computadoras con la próxima bajada. Devuelve cuántas sacó.
 */
export function repararBajasDuplicadas(): number {
  const repetidas = db()
    .prepare(
      `SELECT b.id, b.fila_id, b.poliza_id, b.periodo, b.hecha_en_la_app,
              CASE WHEN fc.en_la_hoja = 1 THEN fc.pestana ELSE NULL END AS pestana
       FROM bajas b
       LEFT JOIN filas_crudas fc ON fc.fila_id = b.fila_id
       WHERE b.poliza_id IS NOT NULL AND b.periodo IS NOT NULL
         AND EXISTS (SELECT 1 FROM bajas o WHERE o.poliza_id = b.poliza_id AND o.periodo = b.periodo AND o.id <> b.id)
       ORDER BY b.poliza_id, b.periodo, b.id`,
    )
    .all() as BajaRepetida[]
  if (repetidas.length === 0) return 0

  const grupos = new Map<string, BajaRepetida[]>()
  for (const baja of repetidas) {
    const clave = `${baja.poliza_id}|${baja.periodo}`
    grupos.set(clave, [...(grupos.get(clave) ?? []), baja])
  }
  const sinSubir = filasConCambiosSinSubir()
  let sacadas = 0
  db().transaction(() => {
    for (const grupo of grupos.values()) {
      if (!grupo.some((baja) => baja.hecha_en_la_app === 1 || baja.fila_id.startsWith(PREFIJO_DE_BAJA))) continue
      const queda = elegirBajaQueQueda(grupo)
      for (const copia of grupo) {
        if (copia.id === queda.id || sinSubir.has(copia.fila_id)) continue
        db().prepare('DELETE FROM bajas WHERE id = ?').run(copia.id)
        if (copia.pestana && copia.pestana !== PESTANA_APP) {
          encolar({ operacion: 'borrar', pestana: copia.pestana, filaId: copia.fila_id, campos: {} })
        }
        sacadas++
      }
    }
  })()
  if (sacadas > 0) {
    anotarEvento('reparacion', `Se sacaron ${sacadas} bajas que estaban repetidas (misma póliza y mismo mes); el renglón de más se borra de la base.`)
  }
  return sacadas
}

/**
 * Las entradas de la cola que apuntan a «(cargado en DM Gestión)», que no es ninguna pestaña. Hasta la
 * 12.1, deshacer o poner vigente una baja encolaba el borrado contra esa pestaña (la de la tabla, no
 * la del renglón) y la entrada quedaba en «no se pudo» para siempre, con la fila todavía en BAJAS en
 * todas las computadoras. Se les pone la pestaña donde el renglón vive de verdad y vuelven a la cola;
 * las que no tienen renglón conocido no se pueden subir nunca y se sacan. Devuelve cuántas se recuperaron.
 */
export function repararColaContraPestanaInexistente(): number {
  const rotas = db()
    .prepare(
      `SELECT c.id, fc.pestana AS real
       FROM cola_sync c LEFT JOIN filas_crudas fc ON fc.fila_id = c.fila_id
       WHERE c.estado IN ('pendiente', 'fallido') AND c.pestana = ?`,
    )
    .all(PESTANA_APP) as Array<{ id: number; real: string | null }>
  if (rotas.length === 0) return 0
  let recuperadas = 0
  db().transaction(() => {
    for (const rota of rotas) {
      if (rota.real && rota.real !== PESTANA_APP) {
        db()
          .prepare(`UPDATE cola_sync SET pestana = ?, estado = 'pendiente', intentos = 0, proximo_intento = NULL, ultimo_error = NULL WHERE id = ?`)
          .run(rota.real, rota.id)
        recuperadas++
      } else {
        db().prepare('DELETE FROM cola_sync WHERE id = ?').run(rota.id)
      }
    }
  })()
  if (recuperadas > 0) anotarEvento('reparacion', `${recuperadas} cambios que apuntaban a una pestaña inexistente vuelven a la cola, ahora hacia la pestaña donde vive el renglón.`)
  return recuperadas
}

/** Lo que se repara cada vez que arranca la sincronización. */
export function repararAlArrancar(): void {
  repararColaContraPestanaInexistente()
  const pagos = subirPagosRezagados()
  if (pagos > 0) anotarEvento('reparacion', `${pagos} pagos que habían quedado sólo en esta computadora se encolaron hacia la base.`)
  repararBajasDuplicadas()
}
