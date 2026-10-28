// Un desplegable que se puede escribir para buscar: para las listas largas (los más de cien accesorios
// del multicotizador), donde un `<select>` obliga a bajar a ciegas hasta encontrar la opción.
//
// Sólo se puede elegir una opción de la lista: lo que se escribe es para buscar. Si se sale del campo
// con un texto que no es ninguna opción, vuelve a la que estaba elegida.
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from './ui'

/** Para buscar: sin tildes, sin mayúsculas y sin puntuación, como en todas las pantallas. */
function normalizar(valor: string): string {
  return valor
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

interface Props {
  etiqueta: string
  valor: string
  opciones: readonly string[]
  alCambiar: (valor: string) => void
  placeholder?: string
  error?: string | null
  deshabilitado?: boolean
  /** La etiqueta sólo para lectores de pantalla: cuando una fila de títulos ya dice qué es cada columna. */
  ocultarEtiqueta?: boolean
}

export function SelectorConBusqueda({
  etiqueta,
  valor,
  opciones,
  alCambiar,
  placeholder = 'Escribí para buscar…',
  error,
  deshabilitado = false,
  ocultarEtiqueta = false,
}: Props) {
  const id = useId()
  const idLista = `${id}-lista`
  const [texto, setTexto] = useState<string | null>(null)
  const [abierto, setAbierto] = useState(false)
  const [resaltada, setResaltada] = useState(0)
  const lista = useRef<HTMLUListElement>(null)

  const buscado = texto ?? ''
  const filtradas = useMemo(() => {
    const clave = normalizar(buscado)
    if (!clave) return [...opciones]
    // Primero las que empiezan con lo escrito, después las que lo tienen en el medio.
    const empiezan = opciones.filter((opcion) => normalizar(opcion).startsWith(clave))
    const contienen = opciones.filter((opcion) => !normalizar(opcion).startsWith(clave) && normalizar(opcion).includes(clave))
    return [...empiezan, ...contienen]
  }, [buscado, opciones])

  const elegir = (opcion: string) => {
    alCambiar(opcion)
    setTexto(null)
    setAbierto(false)
  }

  const mover = (paso: number) => {
    if (!abierto) setAbierto(true)
    setResaltada((actual) => {
      const siguiente = Math.min(Math.max(actual + paso, 0), Math.max(filtradas.length - 1, 0))
      lista.current?.children[siguiente]?.scrollIntoView({ block: 'nearest' })
      return siguiente
    })
  }

  const alTeclear = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault()
      mover(1)
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault()
      mover(-1)
    } else if (evento.key === 'Enter' && abierto && filtradas[resaltada]) {
      evento.preventDefault()
      elegir(filtradas[resaltada]!)
    } else if (evento.key === 'Escape' && abierto) {
      evento.stopPropagation()
      setTexto(null)
      setAbierto(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={ocultarEtiqueta ? 'sr-only' : 'text-sm font-medium text-slate-700'}>
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={abierto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          disabled={deshabilitado}
          value={texto ?? valor}
          placeholder={placeholder}
          onFocus={(evento) => {
            evento.target.select()
            setAbierto(true)
            setResaltada(0)
          }}
          onChange={(evento) => {
            setTexto(evento.target.value)
            setAbierto(true)
            setResaltada(0)
          }}
          onKeyDown={alTeclear}
          // Se cierra después del clic en la lista: el `mousedown` de la opción ya eligió.
          onBlur={() => {
            setTexto(null)
            setAbierto(false)
          }}
          className={cx(
            'h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400',
            'transition-colors focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25',
            'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
            error && 'border-red-400',
          )}
        />
        {abierto && (
          <ul
            id={idLista}
            ref={lista}
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-media"
          >
            {filtradas.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500">No hay ninguno con «{buscado}».</li>
            ) : (
              filtradas.map((opcion, indice) => (
                <li
                  key={opcion}
                  role="option"
                  aria-selected={opcion === valor}
                  onMouseDown={(evento) => {
                    evento.preventDefault()
                    elegir(opcion)
                  }}
                  onMouseEnter={() => setResaltada(indice)}
                  className={cx(
                    'cursor-pointer px-3 py-1.5 text-sm',
                    indice === resaltada ? 'bg-marino-50 text-marino-800' : 'text-slate-700',
                    opcion === valor && 'font-semibold',
                  )}
                >
                  {opcion}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
