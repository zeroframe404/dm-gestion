// Una planilla, con todo lo que eso quiere decir: letras arriba, números al costado, celdas
// rectangulares y el cursor que se mueve con las flechas.
//
// Por qué existe. La agencia trabajó veinte años sobre una hoja de cálculo y buena parte del equipo
// todavía piensa así: «bajá hasta la fila de Pérez», «mirá la columna H». Las pantallas del programa
// son mejores para trabajar —tienen fichas, botones, semáforo— pero para quien recién empieza son un
// lugar desconocido. Esta vista es el puente: los MISMOS datos, presentados como los venía viendo.
//
// Es de sólo lectura a propósito. Editar acá querría decir escribir en doce tablas distintas desde
// una grilla que no sabe qué es cada columna, y sobre todo salteándose las reglas que cada pantalla
// aplica al guardar (el duplicado de documento, el semáforo, la cola de sincronización). Para cambiar
// algo está la pantalla del módulo; esto es para mirar, buscar y copiar.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnaDeReporte } from '../../shared/tipos'
import { Icono } from './Icono'
import { cx } from './ui'

/** 0 → A, 25 → Z, 26 → AA. Como las columnas de cualquier planilla. */
export function letraDeColumna(indice: number): string {
  let resto = indice
  let letras = ''
  do {
    letras = String.fromCharCode(65 + (resto % 26)) + letras
    resto = Math.floor(resto / 26) - 1
  } while (resto >= 0)
  return letras
}

interface Celda {
  fila: number
  columna: number
}

interface Props {
  columnas: ColumnaDeReporte[]
  filas: string[][]
  /** Qué decir cuando no hay ninguna fila. */
  vacio: string
}

export function VistaExcel({ columnas, filas, vacio }: Props) {
  const [cursor, setCursor] = useState<Celda>({ fila: 0, columna: 0 })
  // El otro extremo del rango, cuando se arrastra o se usa Shift. null = está seleccionada una sola.
  const [ancla, setAncla] = useState<Celda | null>(null)
  const [copiado, setCopiado] = useState(false)
  const contenedor = useRef<HTMLDivElement | null>(null)

  const rango = useMemo(() => {
    const otro = ancla ?? cursor
    return {
      filaDesde: Math.min(cursor.fila, otro.fila),
      filaHasta: Math.max(cursor.fila, otro.fila),
      columnaDesde: Math.min(cursor.columna, otro.columna),
      columnaHasta: Math.max(cursor.columna, otro.columna),
    }
  }, [cursor, ancla])

  /**
   * El cursor tiene que quedar siempre adentro de la grilla.
   *
   * `filas` cambia sin que el componente se desmonte —alcanza con escribir en el buscador— y el
   * cursor es estado de acá. Sin esto, quien estaba parado en la fila 700 y filtra a cinco filas se
   * queda con el cursor en una celda que ya no existe: no se ve ninguna celda marcada, la barra de
   * abajo dice «A700» y Ctrl+C no copia NADA sin decirlo, que es lo peor de todo: la persona se va a
   * Excel y pega lo que tenía de antes creyendo que pegó lo que acababa de filtrar.
   */
  useEffect(() => {
    const ultimaFila = Math.max(filas.length - 1, 0)
    const ultimaColumna = Math.max(columnas.length - 1, 0)
    setCursor((previo) => {
      const fila = Math.min(previo.fila, ultimaFila)
      const columna = Math.min(previo.columna, ultimaColumna)
      return fila === previo.fila && columna === previo.columna ? previo : { fila, columna }
    })
    // La selección también se pierde: el rango que había marcado ya no señala las mismas filas.
    setAncla(null)
  }, [filas.length, columnas.length])

  const estaEnElRango = useCallback(
    (fila: number, columna: number) =>
      fila >= rango.filaDesde && fila <= rango.filaHasta && columna >= rango.columnaDesde && columna <= rango.columnaHasta,
    [rango],
  )

  /**
   * Copiar al portapapeles separando con tabulaciones: pegado en Excel o en Google Sheets, cada celda
   * cae en su celda. Es el formato que esperan las dos, y es la razón principal por la que alguien
   * abre esta pantalla en vez de bajarse el .xlsx.
   */
  const copiar = useCallback(async () => {
    const lineas: string[] = []
    for (let f = rango.filaDesde; f <= rango.filaHasta; f++) {
      const fila = filas[f]
      if (!fila) continue
      const celdas: string[] = []
      for (let c = rango.columnaDesde; c <= rango.columnaHasta; c++) celdas.push(fila[c] ?? '')
      lineas.push(celdas.join('\t'))
    }
    if (lineas.length === 0) return
    try {
      await navigator.clipboard.writeText(lineas.join('\n'))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1_500)
    } catch {
      // Sin permiso de portapapeles no se puede hacer nada mejor que no romper nada.
    }
  }, [filas, rango])

  const mover = useCallback(
    (df: number, dc: number, extendiendo: boolean) => {
      setCursor((previo) => {
        const fila = Math.min(Math.max(previo.fila + df, 0), Math.max(filas.length - 1, 0))
        const columna = Math.min(Math.max(previo.columna + dc, 0), Math.max(columnas.length - 1, 0))
        return { fila, columna }
      })
      // Sin Shift, mover el cursor deshace la selección: es lo que hace cualquier planilla.
      if (!extendiendo) setAncla(null)
    },
    [columnas.length, filas.length],
  )

  useEffect(() => {
    const elemento = contenedor.current
    if (!elemento) return
    const alTeclear = (evento: KeyboardEvent) => {
      // Sólo cuando el foco está adentro: si no, las flechas dejarían de scrollear el resto.
      if (!elemento.contains(document.activeElement)) return
      const extendiendo = evento.shiftKey
      if (extendiendo && ancla === null) setAncla(cursor)

      switch (evento.key) {
        case 'ArrowDown':
          mover(1, 0, extendiendo)
          break
        case 'ArrowUp':
          mover(-1, 0, extendiendo)
          break
        case 'ArrowRight':
          mover(0, 1, extendiendo)
          break
        case 'ArrowLeft':
          mover(0, -1, extendiendo)
          break
        case 'PageDown':
          mover(20, 0, extendiendo)
          break
        case 'PageUp':
          mover(-20, 0, extendiendo)
          break
        case 'Home':
          setCursor((previo) => (evento.ctrlKey ? { fila: 0, columna: 0 } : { ...previo, columna: 0 }))
          if (!extendiendo) setAncla(null)
          break
        case 'End':
          setCursor((previo) =>
            evento.ctrlKey
              ? { fila: Math.max(filas.length - 1, 0), columna: Math.max(columnas.length - 1, 0) }
              : { ...previo, columna: Math.max(columnas.length - 1, 0) },
          )
          if (!extendiendo) setAncla(null)
          break
        case 'a':
          if (!evento.ctrlKey) return
          setCursor({ fila: 0, columna: 0 })
          setAncla({ fila: Math.max(filas.length - 1, 0), columna: Math.max(columnas.length - 1, 0) })
          break
        case 'c':
          if (!evento.ctrlKey) return
          void copiar()
          break
        default:
          return
      }
      evento.preventDefault()
    }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [ancla, columnas.length, copiar, cursor, filas.length, mover])

  // Que el cursor siempre quede a la vista: si no, bajar con las flechas lo pierde en dos segundos.
  useEffect(() => {
    const celda = contenedor.current?.querySelector<HTMLElement>(`[data-celda="${cursor.fila}-${cursor.columna}"]`)
    celda?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [cursor])

  const seleccionadas = (rango.filaHasta - rango.filaDesde + 1) * (rango.columnaHasta - rango.columnaDesde + 1)

  if (filas.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        {vacio}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={contenedor}
        tabIndex={0}
        role="grid"
        aria-label="Planilla"
        aria-rowcount={filas.length + 1}
        aria-colcount={columnas.length + 1}
        className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-300 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
      >
        <table className="border-separate border-spacing-0 text-[13px] leading-tight">
          <thead>
            {/* La fila de las letras. Es lo que hace que esto se lea como una planilla y no como una
                tabla más del programa: quien está acostumbrado busca «la columna F». */}
            <tr>
              <th className="sticky left-0 top-0 z-30 w-12 border-b border-r border-slate-300 bg-slate-200 px-2 py-1 text-center text-[11px] font-bold text-slate-500" />
              {columnas.map((columna, indice) => (
                <th
                  key={columna.id}
                  className={cx(
                    'sticky top-0 z-20 border-b border-r border-slate-300 bg-slate-200 px-2 py-1 text-center text-[11px] font-bold text-slate-600',
                    indice >= rango.columnaDesde && indice <= rango.columnaHasta && 'bg-marino-200 text-marino-900',
                  )}
                >
                  {letraDeColumna(indice)}
                </th>
              ))}
            </tr>
            {/* La fila 1 es la de los títulos, como en la hoja de la agencia. */}
            <tr>
              <th className="sticky left-0 top-[25px] z-30 border-b border-r border-slate-300 bg-slate-100 px-2 py-1.5 text-center text-[11px] font-bold text-slate-500">
                1
              </th>
              {columnas.map((columna) => (
                <th
                  key={columna.id}
                  scope="col"
                  className={cx(
                    'sticky top-[25px] z-20 whitespace-nowrap border-b border-r border-slate-300 bg-slate-100 px-2 py-1.5 font-bold text-slate-800',
                    columna.numerica ? 'text-right' : 'text-left',
                  )}
                  style={{ minWidth: `${Math.min(Math.max(columna.ancho, 8), 40)}ch` }}
                >
                  {columna.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila, indiceFila) => (
              <tr key={indiceFila}>
                <th
                  scope="row"
                  className={cx(
                    'sticky left-0 z-10 border-b border-r border-slate-300 px-2 py-1 text-center text-[11px] font-semibold tabular-nums',
                    indiceFila >= rango.filaDesde && indiceFila <= rango.filaHasta
                      ? 'bg-marino-200 text-marino-900'
                      : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {indiceFila + 2}
                </th>
                {columnas.map((columna, indiceColumna) => {
                  const esCursor = cursor.fila === indiceFila && cursor.columna === indiceColumna
                  const enRango = estaEnElRango(indiceFila, indiceColumna)
                  return (
                    <td
                      key={columna.id}
                      data-celda={`${indiceFila}-${indiceColumna}`}
                      onMouseDown={(evento) => {
                        if (evento.shiftKey) setAncla(cursor)
                        else setAncla(null)
                        setCursor({ fila: indiceFila, columna: indiceColumna })
                        contenedor.current?.focus()
                      }}
                      onMouseEnter={(evento) => {
                        // Arrastrar con el botón apretado extiende la selección, como en Excel.
                        if (evento.buttons === 1) {
                          setAncla((previa) => previa ?? cursor)
                          setCursor({ fila: indiceFila, columna: indiceColumna })
                        }
                      }}
                      className={cx(
                        'max-w-[40ch] cursor-cell overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-slate-200 px-2 py-1',
                        columna.numerica ? 'text-right tabular-nums' : 'text-left',
                        indiceFila % 2 === 1 && !enRango && 'bg-slate-50/60',
                        enRango && !esCursor && 'bg-marino-50',
                        esCursor && 'bg-white outline outline-2 -outline-offset-1 outline-marino-600',
                      )}
                      title={fila[indiceColumna] || undefined}
                    >
                      {fila[indiceColumna] ?? ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* La barra de estado de abajo, como la de una planilla: dónde estoy y qué tengo seleccionado. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        <span className="font-semibold tabular-nums text-slate-800">
          {letraDeColumna(cursor.columna)}
          {cursor.fila + 2}
        </span>
        <span>{columnas[cursor.columna]?.titulo}</span>
        {seleccionadas > 1 && <span className="tabular-nums">{seleccionadas.toLocaleString('es-AR')} celdas seleccionadas</span>}
        <button
          type="button"
          onClick={() => void copiar()}
          className="ml-auto inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-semibold text-marino-700 hover:bg-marino-50"
        >
          <Icono nombre={copiado ? 'ok' : 'tabla'} tamano={13} />
          {copiado ? 'Copiado' : 'Copiar (Ctrl+C)'}
        </button>
        <span className="text-slate-400">Flechas para moverte · Shift para seleccionar · Ctrl+C para copiar</span>
      </div>
    </div>
  )
}
