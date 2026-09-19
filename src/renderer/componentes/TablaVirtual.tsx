// Tabla virtualizada: dibuja sólo las filas que se ven. Con 2.300 filas y 20 columnas, pintar todo
// deja la pantalla pegajosa; así siempre hay ~40 filas en el DOM y el desplazamiento va fluido.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ColumnaElegible } from '../vista'
import { cx } from './ui'

/**
 * Hereda de `ColumnaElegible` el id, el título y `siempre`, que son lo que mira el desplegable de
 * «Columnas» para poder apagarla. Acá se agrega lo que hace falta para dibujarla.
 */
export interface ColumnaTabla<T> extends ColumnaElegible {
  /** Ancho fijo en píxeles: hace falta para poder calcular el desplazamiento. */
  ancho: number
  /**
   * Se queda pegada a la izquierda al desplazar en horizontal.
   *
   * Las fijas se apilan en el orden en que están declaradas y tienen que ser las primeras: una fija
   * declarada después de una suelta se dibujaría encima de otra. Hoy es una sola por tabla —el
   * nombre—, que es justamente lo que se quiere leer sin soltar la barra horizontal.
   */
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
  /**
   * La calcomanía que se apoya encima de una celda (14.0): el anillo del glow de quien está editando
   * ahí, y la burbuja con su cara. Devolver `null` es lo normal —casi ninguna celda tiene a nadie— y
   * no cuesta nada; lo que se dibuja se posiciona `absolute` porque la celda pasa a `relative`.
   *
   * Es un decorado y no una columna a propósito: el glow no ocupa lugar y no puede correr el texto ni
   * cambiar el ancho, y la planilla ya tiene veintitrés columnas peleando por el espacio.
   */
  decorarCelda?: (fila: T, columna: ColumnaTabla<T>) => ReactNode
  /** Ídem para el renglón entero: el anillo alrededor de la fila de Mora que alguien está tocando. */
  decorarFila?: (fila: T) => ReactNode
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
  decorarCelda,
  decorarFila,
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
                // El borde marca dónde termina lo que queda quieto y dónde empieza lo que se corre.
                columna.fija && 'border-r border-slate-200 bg-slate-50',
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
                      seleccionada ? 'bg-slate-200' : 'bg-white hover:bg-slate-50',
                      alHacerClic && 'cursor-pointer',
                      // `relative` sólo cuando hay algo que decorar: las tablas que no usan el glow
                      // quedan exactamente como estaban, con las columnas fijas apoyadas en el
                      // contenedor que scrollea y no en el renglón.
                      decorarFila && 'relative',
                      claseDeFila?.(fila),
                    )}
                  >
                    {decorarFila?.(fila)}
                    {columnas.map((columna) => (
                      <div
                        key={columna.id}
                        style={{
                          width: columna.ancho,
                          ...(columna.fija ? { position: 'sticky', left: izquierdaDe.get(columna.id), zIndex: 1 } : {}),
                        }}
                        className={cx(
                          'flex shrink-0 items-center px-2 text-sm text-slate-700',
                          columna.fija && 'border-r border-slate-200',
                          columna.fija && (seleccionada ? 'bg-slate-200' : 'bg-white group-hover:bg-slate-50'),
                          decorarCelda && 'relative',
                          ALINEACION[columna.alinear ?? 'izquierda'],
                        )}
                      >
                        {columna.celda(fila, primera + posicion)}
                        {decorarCelda?.(fila, columna)}
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
