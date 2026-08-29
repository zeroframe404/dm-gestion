// El aviso de «tarea terminada»: el sonido y un cartelito que se va solo.
//
// La notificación de Windows la manda el proceso principal —esa es la que se ve con la aplicación
// detrás de otra ventana—. Este componente es la otra mitad: cuando la aplicación SÍ está a la vista,
// una notificación del sistema encima de la propia ventana es ruido, y lo que corresponde es el
// sonido más una confirmación discreta de que se guardó.
//
// Vive en el marco, fuera del módulo activo, porque una tarea se puede cerrar desde tres pantallas
// distintas y hasta desde otra computadora del equipo.
import { useEffect, useState } from 'react'
import type { TareaCompletada } from '../../shared/tipos'
import { reproducir } from '../sonidos'
import { Icono } from './Icono'

/** Cuánto queda el cartel a la vista. Lo suficiente para leerlo sin que estorbe. */
const DURACION_MS = 4_000

export function AvisoDeTareaHecha() {
  const [aviso, setAviso] = useState<TareaCompletada | null>(null)

  useEffect(() => {
    const dejarDeEscuchar = window.dm.tareas.alCompletarse((datos) => {
      reproducir('tareaHecha')
      setAviso(datos)
    })
    return dejarDeEscuchar
  }, [])

  useEffect(() => {
    if (!aviso) return
    const reloj = setTimeout(() => setAviso(null), DURACION_MS)
    return () => clearTimeout(reloj)
  }, [aviso])

  if (!aviso) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-green-200 bg-white px-4 py-3 shadow-media"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
        <Icono nombre="ok" tamano={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">Tarea completada</span>
        <span className="block truncate text-xs text-slate-600">
          {aviso.titulo}
          {aviso.porQuien ? ` · ${aviso.porQuien}` : ''}
        </span>
      </span>
    </div>
  )
}
