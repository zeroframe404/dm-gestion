// «¿Esto que acaba de llegar es nuevo?», que es la única pregunta difícil de los sonidos de aviso.
//
// Las dos campanas de la barra superior vuelven a preguntar cada dos minutos y reciben la lista
// entera, no las novedades. Sin memoria de lo anterior, sonarían cada dos minutos mientras haya algo
// pendiente —que es exactamente la forma de que a los tres días alguien apague los parlantes—.
//
// La regla es: suena cuando aparece un aviso que antes no estaba. Se comparan los identificadores y
// no los contadores, porque un contador vuelve a cero cuando alguien abre la campana y volvería a
// subir por el mismo aviso de siempre.
//
// La primera consulta nunca suena. Al abrir el programa a la mañana hay ocho tareas pendientes y
// ninguna es una novedad: son el trabajo del día.
import { useEffect, useRef } from 'react'
import { reproducir, type NombreDeSonido } from './index'

/**
 * @param ids   Los identificadores de lo que hay ahora, o null mientras no se cargó nada todavía.
 * @param sonido Qué suena cuando aparece alguno que antes no estaba.
 */
export function useAvisoNuevo(ids: number[] | null, sonido: NombreDeSonido): void {
  const conocidos = useRef<Set<number> | null>(null)

  useEffect(() => {
    if (ids === null) return

    const actuales = new Set(ids)
    const anteriores = conocidos.current
    conocidos.current = actuales

    // Primera carga: se toma nota de lo que hay y no suena nada.
    if (anteriores === null) return

    const hayAlgunoNuevo = ids.some((id) => !anteriores.has(id))
    if (hayAlgunoNuevo) reproducir(sonido)
  }, [ids, sonido])
}
