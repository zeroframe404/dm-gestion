// Paginador de los listados: «‹ 1 2 3 4 … 18 ›», con la página actual resaltada y 10 filas por página.
//
// Uso (suele no hacer falta: `TablaDeListado` ya lo trae adentro):
//   const { filasDeLaPagina, totalDePaginas } = paginar(filas, pagina)
//   <Paginador pagina={pagina} totalDePaginas={totalDePaginas} alCambiar={setPagina} />
// No se dibuja si hay una sola página.
import { cx } from '../ui'

export const FILAS_POR_PAGINA = 10

/** Corta la lista en la página pedida (empieza en 1; una página fuera de rango se ajusta al borde). */
export function paginar<T>(filas: readonly T[], pagina: number, porPagina = FILAS_POR_PAGINA) {
  const totalDePaginas = Math.max(1, Math.ceil(filas.length / porPagina))
  const actual = Math.min(Math.max(1, Math.trunc(pagina) || 1), totalDePaginas)
  return { pagina: actual, totalDePaginas, filasDeLaPagina: filas.slice((actual - 1) * porPagina, actual * porPagina) }
}

/**
 * Qué números se muestran. Hasta 7 páginas, todas; con más, el principio o el final con un salto
 * («…») y siempre la última: 1 2 3 4 … 18 / 1 … 8 9 10 … 18 / 1 … 15 16 17 18.
 */
export function paginasVisibles(actual: number, total: number): Array<number | 'salto'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  if (actual <= 4) return [1, 2, 3, 4, 'salto', total]
  if (actual >= total - 3) return [1, 'salto', total - 3, total - 2, total - 1, total]
  return [1, 'salto', actual - 1, actual, actual + 1, 'salto', total]
}

interface PropsPaginador {
  pagina: number
  totalDePaginas: number
  alCambiar: (pagina: number) => void
}

export function Paginador({ pagina, totalDePaginas, alCambiar }: PropsPaginador) {
  if (totalDePaginas <= 1) return null
  const boton = 'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors'
  const enfoque = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40'
  return (
    <nav aria-label="Paginación" className="flex items-center justify-center gap-1 border-t border-slate-100 px-4 py-3">
      <button
        type="button"
        onClick={() => alCambiar(pagina - 1)}
        disabled={pagina <= 1}
        aria-label="Página anterior"
        className={cx(boton, enfoque, 'text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent')}
      >
        ‹
      </button>
      {paginasVisibles(pagina, totalDePaginas).map((item, indice) =>
        item === 'salto' ? (
          <span key={`salto-${indice}`} className="px-1 text-slate-400" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => alCambiar(item)}
            aria-label={`Página ${item}`}
            aria-current={item === pagina ? 'page' : undefined}
            className={cx(boton, enfoque, 'tabular-nums', item === pagina ? 'bg-marino-700 text-white' : 'text-slate-700 hover:bg-slate-100')}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => alCambiar(pagina + 1)}
        disabled={pagina >= totalDePaginas}
        aria-label="Página siguiente"
        className={cx(boton, enfoque, 'text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent')}
      >
        ›
      </button>
    </nav>
  )
}
