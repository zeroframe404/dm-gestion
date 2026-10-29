// Tabla de los listados, dentro de una tarjeta redondeada: encabezados en MAYÚSCULAS centrados, filas
// separadas por una línea fina, textos centrados, estado vacío con ícono (i) y paginador de 10 filas al pie.
//
// Uso:
//   const columnas: ColumnaDeListado<FilaDePoliza>[] = [
//     { id: 'compania', encabezado: 'Compañía', celda: (f) => f.compania ?? '—' },
//     { id: 'poliza', encabezado: 'Póliza', celda: (f) => <CeldaDoble principal={f.numero} secundario={f.ramo} /> },
//     { id: 'estado', encabezado: 'Estado', celda: (f) => <ChipDeEstado tono="verde">Vigente</ChipDeEstado> },
//   ]
//   <TablaDeListado columnas={columnas} filas={filas} clave={(f) => f.polizaId}
//     vacio="No se encontraron pólizas" alHacerClic={(f) => ir('polizas', { polizaId: f.polizaId })} />
//
// Se le pasan TODAS las filas: la paginación (10 por página) es de acá. Si una celda lleva un enlace o
// un botón propio, que frene el clic (`evento.stopPropagation()`) para no disparar `alHacerClic` de la fila.
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icono } from '../Icono'
import { Cargando, cx } from '../ui'
import { FILAS_POR_PAGINA, paginar, Paginador } from './Paginador'

export interface ColumnaDeListado<F> {
  id: string
  /** Se muestra en mayúsculas. */
  encabezado: string
  celda: (fila: F) => ReactNode
  /** Por defecto, centrado. */
  alineacion?: 'centro' | 'izquierda'
}

interface PropsTablaDeListado<F> {
  columnas: ColumnaDeListado<F>[]
  filas: readonly F[]
  /** Identifica cada fila (un id estable, no el índice). */
  clave: (fila: F) => string | number
  /** Hace clicable toda la fila (con Enter también). */
  alHacerClic?: (fila: F) => void
  /** Texto del estado vacío, con el ícono (i) arriba. */
  vacio?: string
  cargando?: boolean
  /** Para el lector de pantalla. */
  etiqueta?: string
  porPagina?: number
}

export function TablaDeListado<F>({
  columnas,
  filas,
  clave,
  alHacerClic,
  vacio = 'No se encontraron resultados',
  cargando = false,
  etiqueta,
  porPagina = FILAS_POR_PAGINA,
}: PropsTablaDeListado<F>) {
  const [pedida, setPedida] = useState(1)
  // Una búsqueda nueva vuelve a la primera página. Se mira la «firma» de la lista y no su identidad: si
  // la pantalla arma el arreglo en cada render, el paginador no se resetearía a cada clic.
  const firma = `${filas.length}|${filas.length > 0 ? clave(filas[0]!) : ''}|${filas.length > 0 ? clave(filas[filas.length - 1]!) : ''}`
  useEffect(() => setPedida(1), [firma])
  const { pagina, totalDePaginas, filasDeLaPagina } = paginar(filas, pedida, porPagina)

  const alTeclear = (evento: KeyboardEvent<HTMLTableRowElement>, fila: F) => {
    if (evento.target !== evento.currentTarget) return
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault()
      alHacerClic?.(fila)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-suave">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label={etiqueta}>
          <thead>
            <tr className="border-b border-slate-200">
              {columnas.map((columna) => (
                <th
                  key={columna.id}
                  scope="col"
                  className={cx(
                    'px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap text-slate-500',
                    columna.alineacion === 'izquierda' ? 'text-left' : 'text-center',
                  )}
                >
                  {columna.encabezado}
                </th>
              ))}
            </tr>
          </thead>
          {!cargando && filas.length > 0 && (
            <tbody>
              {filasDeLaPagina.map((fila) => (
                <tr
                  key={clave(fila)}
                  onClick={alHacerClic ? () => alHacerClic(fila) : undefined}
                  onKeyDown={alHacerClic ? (evento) => alTeclear(evento, fila) : undefined}
                  tabIndex={alHacerClic ? 0 : undefined}
                  className={cx(
                    'border-b border-slate-100 last:border-b-0',
                    alHacerClic && 'cursor-pointer hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none',
                  )}
                >
                  {columnas.map((columna) => (
                    <td
                      key={columna.id}
                      className={cx('px-4 py-3 align-middle text-slate-700', columna.alineacion === 'izquierda' ? 'text-left' : 'text-center')}
                    >
                      {columna.celda(fila)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      {cargando && <Cargando />}
      {!cargando && filas.length === 0 && (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-slate-500">
          <Icono nombre="info" tamano={28} className="text-slate-400" />
          <p className="text-sm">{vacio}</p>
        </div>
      )}

      {!cargando && <Paginador pagina={pagina} totalDePaginas={totalDePaginas} alCambiar={setPedida} />}
    </section>
  )
}

interface PropsCeldaDoble {
  principal: ReactNode
  /** La línea gris, más chica, debajo: tipo y número de documento, ramo, hasta… */
  secundario?: ReactNode
  /** Si viene, la línea principal es un enlace de color de acento. */
  alHacerClic?: () => void
}

/** Una celda con la línea principal y, debajo, el dato secundario en gris. */
export function CeldaDoble({ principal, secundario, alHacerClic }: PropsCeldaDoble) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {alHacerClic ? (
        <button
          type="button"
          onClick={(evento) => {
            evento.stopPropagation()
            alHacerClic()
          }}
          className="rounded font-semibold text-marino-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
        >
          {principal}
        </button>
      ) : (
        <span className="font-medium text-slate-800">{principal}</span>
      )}
      {secundario != null && secundario !== '' && <span className="text-xs text-slate-500">{secundario}</span>}
    </div>
  )
}
