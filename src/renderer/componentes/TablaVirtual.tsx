// Tabla virtualizada: dibuja sólo las filas que se ven. Con 2.300 filas y 20 columnas, pintar todo
// deja la pantalla pegajosa; así siempre hay ~40 filas en el DOM y el desplazamiento va fluido.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cx } from './ui'

export interface ColumnaTabla<T> {
  id: string
  titulo: string
  /** Ancho fijo en píxeles: hace falta para poder calcular el desplazamiento. */
  ancho: number
  /** Se queda pegada a la izquierda al desplazar en horizontal. */
  fija?: boolean
  alinear?: 'izquierda' | 'derecha' | 'centro'
  celda: (fila: T, indice: number) => ReactNode
}

interface PropsTablaVirtual<T> {
  filas: T[]
  columnas: Array<ColumnaTabla<T>>
  claveDe: (fila: T) => string
  alturaFila?: number
  /** Cuántas filas de más se dibujan arriba y abajo, para que no parpadee al desplazar. */
  margen?: number
  claseDeFila?: (fila: T) => string
  alHacerClic?: (fila: T) => void
  filaSeleccionada?: string | null
  vacio?: ReactNode
}

const ALINEACION = { izquierda: 'justify-start text-left', derecha: 'justify-end text-right', centro: 'justify-center text-center' }

export function TablaVirtual<T>({
  filas,
  columnas,
  claveDe,
  alturaFila = 34,
  margen = 8,
  claseDeFila,
  alHacerClic,
  filaSeleccionada,
  vacio,
}: PropsTablaVirtual<T>) {
  const contenedor = useRef<HTMLDivElement | null>(null)
  const [desplazamiento, setDesplazamiento] = useState(0)
  const [alto, setAlto] = useState(600)

  useLayoutEffect(() => {
    const elemento = contenedor.current
    if (!elemento) return
    const medir = () => setAlto(elemento.clientHeight)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [])

  // Al cambiar de mes o de filtro se vuelve arriba: si no, se queda mirando un vacío. Se mira el
  // CONTENIDO (cuántas filas hay y cuál es la primera), no el arreglo: editar una celda o avisarle a
  // alguien devuelve una lista nueva con las mismas filas, y ahí volver arriba sería perder el lugar.
  const cuantas = filas.length
  const primeraClave = cuantas > 0 ? claveDe(filas[0]!) : ''
  useEffect(() => {
    contenedor.current?.scrollTo({ top: 0 })
    setDesplazamiento(0)
  }, [cuantas, primeraClave])

  const anchoTotal = columnas.reduce((suma, c) => suma + c.ancho, 0)
  const primera = Math.max(0, Math.floor(desplazamiento / alturaFila) - margen)
  const ultima = Math.min(filas.length, Math.ceil((desplazamiento + alto) / alturaFila) + margen)
  const visibles = filas.slice(primera, ultima)

  // Posición horizontal de cada columna fija.
  const izquierdaDe = new Map<string, number>()
  let acumulado = 0
  for (const columna of columnas) {
    if (columna.fija) izquierdaDe.set(columna.id, acumulado)
    acumulado += columna.ancho
  }

  return (
    <div
      ref={contenedor}
      onScroll={(evento) => setDesplazamiento(evento.currentTarget.scrollTop)}
      className="relative min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white"
    >
      <div style={{ width: anchoTotal, minWidth: '100%' }}>
        <div className="sticky top-0 z-20 flex border-b border-slate-200 bg-slate-50">
          {columnas.map((columna) => (
            <div
              key={columna.id}
              style={{
                width: columna.ancho,
                ...(columna.fija ? { position: 'sticky', left: izquierdaDe.get(columna.id), zIndex: 21 } : {}),
              }}
              className={cx(
                'flex shrink-0 items-center px-2 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500',
                columna.fija && 'bg-slate-50',
                ALINEACION[columna.alinear ?? 'izquierda'],
              )}
              title={columna.titulo}
            >
              <span className="truncate">{columna.titulo}</span>
            </div>
          ))}
        </div>

        {filas.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">{vacio ?? 'No hay filas para mostrar.'}</div>
        ) : (
          <div style={{ height: filas.length * alturaFila, position: 'relative' }}>
            <div style={{ transform: `translateY(${primera * alturaFila}px)` }}>
              {visibles.map((fila, posicion) => {
                const clave = claveDe(fila)
                const seleccionada = filaSeleccionada === clave
                return (
                  <div
                    key={clave}
                    style={{ height: alturaFila }}
                    onClick={alHacerClic ? () => alHacerClic(fila) : undefined}
                    className={cx(
                      'group flex border-b border-slate-100',
                      seleccionada ? 'bg-marino-50' : 'bg-white hover:bg-slate-50',
                      alHacerClic && 'cursor-pointer',
                      claseDeFila?.(fila),
                    )}
                  >
                    {columnas.map((columna) => (
                      <div
                        key={columna.id}
                        style={{
                          width: columna.ancho,
                          ...(columna.fija ? { position: 'sticky', left: izquierdaDe.get(columna.id), zIndex: 1 } : {}),
                        }}
                        className={cx(
                          'flex shrink-0 items-center px-2 text-sm text-slate-700',
                          columna.fija && (seleccionada ? 'bg-marino-50' : 'bg-white group-hover:bg-slate-50'),
                          ALINEACION[columna.alinear ?? 'izquierda'],
                        )}
                      >
                        {columna.celda(fila, primera + posicion)}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
