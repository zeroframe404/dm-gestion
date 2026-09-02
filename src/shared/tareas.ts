// Cómo se leen de vuelta el estado y la prioridad de una tarea que viene de la base compartida.
//
// La aplicación escribe en la pestaña APP TAREAS lo que se LEE en pantalla («En curso»), no lo que
// guarda la columna (`en gestion`). Mientras la pestaña era de ida nada más eso no importaba; desde
// que las tareas también se leen de vuelta —es lo que hace que una tarea asignada en Lanús aparezca en
// Dock Sud— hay que saber volver del texto de la hoja al valor de la tabla.
//
// Los dos valores tienen un `CHECK` en la base, así que esto no puede devolver «lo que venga»: un
// estado escrito a mano en la hoja que no se entienda cae en `pendiente`, que es el prudente porque es
// el único de los tres que sigue a la vista, y una prioridad rara cae en `NORMAL`.
//
// Es puro y compartido a propósito: lo usan el importador (que incorpora las tareas nuevas) y la
// bajada (que aplica los cambios de las que ya conocíamos), y ninguno de los dos puede depender del
// servicio de tareas sin cerrar un círculo de imports.
import { ESTADOS_DE_TAREA, NOMBRE_ESTADO_TAREA, PRIORIDADES_DE_TAREA, type EstadoTarea, type PrioridadTarea } from './tipos'

function sinAcentos(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase()
}

/** «En curso» → `en gestion`. Acepta también el valor crudo, por si la fila la escribió otra versión. */
export function estadoDeTareaDesdeTexto(valor: string): EstadoTarea {
  const buscado = sinAcentos(valor)
  if (!buscado) return 'pendiente'
  const porNombre = ESTADOS_DE_TAREA.find((estado) => sinAcentos(NOMBRE_ESTADO_TAREA[estado]) === buscado)
  if (porNombre) return porNombre
  const crudo = ESTADOS_DE_TAREA.find((estado) => sinAcentos(estado) === buscado)
  return crudo ?? 'pendiente'
}

/** ALTA / NORMAL / BAJA. Cualquier otra cosa es NORMAL: no hay por qué gritar por un texto raro. */
export function prioridadDeTareaDesdeTexto(valor: string): PrioridadTarea {
  const buscada = sinAcentos(valor)
  return (PRIORIDADES_DE_TAREA as readonly string[]).includes(buscada) ? (buscada as PrioridadTarea) : 'NORMAL'
}
