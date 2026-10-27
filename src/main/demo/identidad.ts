// Con qué nombre se presenta la agencia en lo que el programa genera: el mensaje y el PDF del
// presupuesto, el pie de los reportes y la firma de las plantillas de WhatsApp. En la versión de la
// agencia es la agencia; en la demo no es ninguna, y lo que se le muestra a otra agencia no puede salir
// firmado con el nombre de ésta.
//
// La pantalla hace lo mismo en `renderer/agencia.ts`, con las mismas dos constantes compartidas.
import { NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO } from '../../shared/demo'
import { FIRMA_DE_LOS_MENSAJES } from '../../shared/tipos'
import { esDemo } from '../canal'
import { db, type BaseDeDatos } from '../db/base'

export { NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO }

/**
 * Cómo se llama la agencia en lo que sale del programa. `demo` se puede pasar a mano para probarlo:
 * afuera de Electron (el banco de pruebas) el canal es siempre el estable.
 */
export function nombreDeLaAgencia(demo: boolean = esDemo()): string {
  return demo ? NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO : FIRMA_DE_LOS_MENSAJES
}

/**
 * Las plantillas de WhatsApp las siembra una migración ya publicada (no se edita), firmadas con el
 * nombre de la agencia. En la demo se cambia esa firma por la de demostración apenas se abre la base.
 * Sólo toca la firma de fábrica: si alguien escribió otra cosa en la plantilla, queda como está. Se
 * puede llamar todas las veces que haga falta; la segunda ya no encuentra nada que cambiar.
 *
 * Devuelve cuántas plantillas cambió.
 */
export function refirmarPlantillas(base: BaseDeDatos, firma: string): number {
  if (firma === FIRMA_DE_LOS_MENSAJES) return 0
  const cambio = base
    .prepare(
      `UPDATE plantillas_mensaje
          SET texto = REPLACE(texto, ?, ?), actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE INSTR(texto, ?) > 0`,
    )
    .run(`${FIRMA_DE_LOS_MENSAJES}.`, `${firma}.`, `${FIRMA_DE_LOS_MENSAJES}.`)
  return cambio.changes
}

/**
 * Lo que llama el arranque después de abrir la base local. En la versión de la agencia (y en la beta)
 * no hace nada.
 */
export function firmarPlantillasDeLaDemo(): void {
  if (!esDemo()) return
  refirmarPlantillas(db(), NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO)
}
