// La campana de la barra superior: avisa cuando te asignan una tarea o cuando algo vence hoy.
//
// El punto rojo lo enciende sólo lo que todavía no viste; el número que se ve al lado es lo pendiente.
// Son dos cosas distintas a propósito: tener ocho tareas abiertas es normal y no tiene que gritar,
// que te acaben de asignar una sí.
//
// Se refresca sola cada dos minutos. No hay evento del proceso principal para esto: una tarea la
// asigna otra persona desde otra computadora y llega por la sincronización, así que preguntar cada
// tanto es lo único que puede enterarse.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AvisosDeTareas } from '../../shared/tipos'
import { useNavegacion } from '../contexto/Navegacion'
import { Icono } from './Icono'
import { cx } from './ui'

/** Cada cuánto se vuelve a preguntar. Dos minutos alcanza: no es un chat. */
const CADA_CUANTO_MS = 2 * 60_000

export function CampanaDeTareas() {
  const { ir } = useNavegacion()
  const [avisos, setAvisos] = useState<AvisosDeTareas | null>(null)
  const [abierta, setAbierta] = useState(false)
  const contenedor = useRef<HTMLDivElement | null>(null)

  const traer = useCallback(async () => {
    const resultado = await window.dm.tareas.avisos()
    if (resultado.ok) setAvisos(resultado.datos)
  }, [])

  useEffect(() => {
    void traer()
    const reloj = setInterval(() => void traer(), CADA_CUANTO_MS)
    return () => clearInterval(reloj)
  }, [traer])

  // Cerrar al tocar afuera o con Escape: es un desplegable, no un diálogo.
  useEffect(() => {
    if (!abierta) return
    const alTocar = (evento: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(evento.target as Node)) setAbierta(false)
    }
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAbierta(false)
    }
    document.addEventListener('mousedown', alTocar)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alTocar)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierta])

  const abrir = async () => {
    const siguiente = !abierta
    setAbierta(siguiente)
    // Abrirla cuenta como enterarse: se apaga el punto de lo que está a la vista.
    if (siguiente) {
      const resultado = await window.dm.tareas.marcarVistos()
      if (resultado.ok) setAvisos(resultado.datos)
    }
  }

  const pendientes = avisos?.pendientes ?? 0
  const hayNovedad = (avisos?.nuevas ?? 0) > 0 || (avisos?.venceHoy ?? 0) > 0 || (avisos?.vencidas ?? 0) > 0

  return (
    <div className="relative" ref={contenedor}>
      <button
        type="button"
        onClick={() => void abrir()}
        aria-label={
          pendientes === 0
            ? 'Tareas: no tenés nada pendiente'
            : `Tareas: ${pendientes} pendiente(s)${avisos?.nuevas ? `, ${avisos.nuevas} sin ver` : ''}`
        }
        aria-expanded={abierta}
        className={cx(
          'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-slate-600 transition-colors',
          'hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          abierta && 'bg-slate-100 text-slate-900',
        )}
      >
        <Icono nombre="campana" tamano={18} />
        {pendientes > 0 && <span className="text-xs font-bold tabular-nums">{pendientes}</span>}
        {hayNovedad && (
          <span
            className={cx(
              'absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-white',
              (avisos?.vencidas ?? 0) > 0 ? 'bg-red-500' : 'bg-amber-500',
            )}
            aria-hidden="true"
          />
        )}
      </button>

      {abierta && avisos && (
        <div className="absolute right-0 z-40 mt-2 w-96 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-media">
          <header className="border-b border-slate-100 px-4 py-3">
            <p className="font-display text-sm font-bold tracking-tight text-slate-900">Tus tareas</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {pendientes === 0
                ? 'No tenés nada pendiente.'
                : [
                    `${pendientes} pendiente(s)`,
                    avisos.vencidas > 0 ? `${avisos.vencidas} vencida(s)` : null,
                    avisos.venceHoy > 0 ? `${avisos.venceHoy} vence(n) hoy` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </p>
          </header>

          <ul className="max-h-80 overflow-y-auto">
            {avisos.filas.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">Nada por ahora.</li>}
            {avisos.filas.map((tarea) => (
              <li key={tarea.id} className="border-b border-slate-100 last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    setAbierta(false)
                    ir('tareas', { tareaId: tarea.id })
                  }}
                  className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-slate-50"
                >
                  <span
                    className={cx(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      tarea.vencida ? 'bg-red-500' : tarea.venceHoy ? 'bg-amber-500' : 'bg-slate-300',
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{tarea.titulo}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {[
                        tarea.vencida ? 'vencida' : tarea.venceHoy ? 'vence hoy' : tarea.venceEl ? `vence ${tarea.venceEl}` : 'sin fecha',
                        tarea.vinculoTexto,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <footer className="border-t border-slate-100 px-4 py-2">
            <button
              type="button"
              onClick={() => {
                setAbierta(false)
                ir('tareas')
              }}
              className="text-sm font-semibold text-marino-700 hover:underline"
            >
              Ver todas las tareas
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
