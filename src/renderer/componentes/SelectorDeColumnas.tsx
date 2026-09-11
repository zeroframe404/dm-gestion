// «Columnas»: el desplegable que decide qué se ve en una tabla, y el enganche que se acuerda de la
// elección en esta computadora.
//
// La planilla del mes tiene veintitrés columnas y en el mostrador se trabaja con seis. Antes había que
// arrastrar la barra de abajo hasta encontrar la que se necesitaba; ahora se apagan las que no se
// usan y el nombre —que nunca se puede apagar— queda a la izquierda, pegado, mientras se mira el
// resto.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { columnasOcultas, guardarColumnasOcultas } from '../preferencias'
import { alternarOculta, columnasVisibles, type ColumnaElegible } from '../vista'
import { Icono } from './Icono'
import { cx } from './ui'

interface ColumnasElegidas<C extends ColumnaElegible> {
  /** Las que se dibujan, en el orden en que están declaradas. */
  visibles: C[]
  /** Los ids apagados, ya saneados contra las columnas que existen hoy. */
  ocultas: string[]
  alternar: (id: string) => void
  mostrarTodas: () => void
}

/**
 * `tabla` es el nombre corto y estable de la pantalla («cartera», «clientes»): es lo que separa la
 * elección de una tabla de la de otra dentro de la misma computadora. Cambiarlo es empezar de cero.
 */
export function useColumnasElegidas<C extends ColumnaElegible>(tabla: string, columnas: C[]): ColumnasElegidas<C> {
  const [ocultas, setOcultas] = useState<string[]>(() => columnasOcultas(tabla, columnas))

  const alternar = useCallback(
    (id: string) => {
      const siguientes = alternarOculta(columnas, ocultas, id)
      guardarColumnasOcultas(tabla, siguientes)
      setOcultas(siguientes)
    },
    [columnas, ocultas, tabla],
  )

  const mostrarTodas = useCallback(() => {
    guardarColumnasOcultas(tabla, [])
    setOcultas([])
  }, [tabla])

  const visibles = useMemo(() => columnasVisibles(columnas, ocultas), [columnas, ocultas])

  return { visibles, ocultas, alternar, mostrarTodas }
}

interface PropsSelectorDeColumnas {
  /** Todas las columnas de la tabla, incluidas las apagadas. */
  columnas: ColumnaElegible[]
  ocultas: readonly string[]
  alAlternar: (id: string) => void
  alMostrarTodas: () => void
}

export function SelectorDeColumnas({ columnas, ocultas, alAlternar, alMostrarTodas }: PropsSelectorDeColumnas) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement | null>(null)
  const boton = useRef<HTMLButtonElement | null>(null)

  // Cerrar al tocar afuera o con Escape: es un desplegable, no un diálogo. Igual que la campana.
  useEffect(() => {
    if (!abierto) return
    const alTocar = (evento: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(evento.target as Node)) setAbierto(false)
    }
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return
      setAbierto(false)
      // El foco estaba en una casilla que se acaba de ir con el panel: sin esto se cae al principio
      // de la página y quien maneja con el teclado tiene que volver a bajar hasta acá.
      boton.current?.focus()
    }
    document.addEventListener('mousedown', alTocar)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alTocar)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  const cuantasOcultas = ocultas.length

  return (
    <div className="relative" ref={contenedor}>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto((estaba) => !estaba)}
        aria-expanded={abierto}
        aria-haspopup="true"
        title="Elegir qué columnas se ven"
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          cuantasOcultas > 0
            ? 'border-marino-300 bg-marino-50 text-marino-700 hover:bg-marino-100'
            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400',
        )}
      >
        <Icono nombre="columnas" tamano={14} />
        Columnas
        {cuantasOcultas > 0 && <span className="tabular-nums">· {cuantasOcultas} sin mostrar</span>}
      </button>

      {abierto && (
        <div className="absolute left-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-media">
          <header className="border-b border-slate-100 px-4 py-3">
            <p className="font-display text-sm font-bold tracking-tight text-slate-900">Columnas</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Lo que apagues acá se guarda en esta computadora. El nombre queda siempre a la izquierda.
            </p>
          </header>

          <ul className="max-h-80 overflow-y-auto py-1">
            {columnas.map((columna) => {
              const visible = !ocultas.includes(columna.id)
              return (
                <li key={columna.id}>
                  <label
                    className={cx(
                      'flex items-center gap-2.5 px-4 py-1.5 text-sm',
                      columna.siempre ? 'text-slate-400' : 'cursor-pointer text-slate-700 hover:bg-slate-50',
                    )}
                    title={columna.siempre ? 'Esta columna no se puede esconder' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={visible || columna.siempre === true}
                      disabled={columna.siempre}
                      onChange={() => alAlternar(columna.id)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-marino-700 focus:ring-marino-500/40 disabled:opacity-60"
                    />
                    <span className="truncate">{columna.titulo}</span>
                    {columna.siempre && <span className="ml-auto shrink-0 text-[11px] uppercase tracking-wide">fija</span>}
                  </label>
                </li>
              )
            })}
          </ul>

          <footer className="border-t border-slate-100 px-4 py-2">
            <button
              type="button"
              onClick={alMostrarTodas}
              disabled={cuantasOcultas === 0}
              className="text-xs font-semibold text-marino-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            >
              Mostrar todas
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
