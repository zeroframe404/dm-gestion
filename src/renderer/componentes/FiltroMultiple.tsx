// El filtro de una barra de filtros, ahora con varias opciones a la vez: «Compañía: ATM +1» en vez de
// tener que elegir ATM, mirar, volver, elegir Metropol y mirar de nuevo.
//
// Reemplaza a los seis `FiltroDesplegable` copiados y pegados que había (Planilla del mes, Pólizas,
// Clientes, Renovaciones, Mora y compañía). Eran casi idénticos, con un `<select>` de un solo valor
// adentro, y esa es justamente la parte que no se podía arreglar en un solo lugar: `<select multiple>`
// no sirve acá —se maneja con Ctrl, no se ve cuántas hay elegidas y no entra en una barra de una sola
// línea—, así que el control es un botón con un panel de casillas, igual que «Columnas».
//
// Lo que el resto de la aplicación tiene que saber:
//  - `valores` es una lista. Vacía significa TODAS, que es lo mismo que decía el `''` de antes: un
//    filtro sin nada elegido no filtra nada.
//  - `alCambiar` devuelve siempre una lista nueva, en el orden en que están las opciones (no en el
//    orden en que las fueron tocando), así dos filtros equivalentes se ven iguales.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Icono } from './Icono'
import { cx } from './ui'

/** Una opción con su texto en pantalla, cuando el valor guardado no es lo que se lee. */
export interface OpcionDeFiltro {
  valor: string
  texto: string
}

/** Las opciones se pueden pasar como textos sueltos o con su etiqueta. Adentro siempre son lo segundo. */
export type OpcionesDeFiltro = ReadonlyArray<string | OpcionDeFiltro>

function normalizarOpciones(opciones: OpcionesDeFiltro, textoDe?: (valor: string) => string): OpcionDeFiltro[] {
  return opciones.map((opcion) =>
    typeof opcion === 'string' ? { valor: opcion, texto: textoDe ? textoDe(opcion) : opcion } : opcion,
  )
}

/** Para buscar dentro del panel: sin tildes, sin mayúsculas y sin puntuación, como en todas las pantallas. */
function normalizar(valor: string): string {
  return valor
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

interface PropsFiltroMultiple {
  /** «Sucursal», «Compañía»… Es lo que se lee en el botón y lo que oye un lector de pantalla. */
  etiqueta: string
  /** Lo elegido. Lista vacía = todas. */
  valores: readonly string[]
  opciones: OpcionesDeFiltro
  alCambiar: (valores: string[]) => void
  /** Cómo se lee un valor, cuando las opciones vienen como textos sueltos. */
  textoDe?: (valor: string) => string
  /** «todas» o «todos», para que el botón diga «Vehículo: todos» y no «todas». */
  plural?: 'todas' | 'todos'
  /** A partir de cuántas opciones aparece el buscador del panel. */
  buscarDesde?: number
  className?: string
}

export function FiltroMultiple({
  etiqueta,
  valores,
  opciones,
  alCambiar,
  textoDe,
  plural = 'todas',
  buscarDesde = 8,
  className,
}: PropsFiltroMultiple) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const contenedor = useRef<HTMLDivElement | null>(null)
  const boton = useRef<HTMLButtonElement | null>(null)
  const idPanel = useId()

  const lista = useMemo(() => normalizarOpciones(opciones, textoDe), [opciones, textoDe])

  // Lo elegido que YA NO está entre las opciones se sigue mostrando: la planilla de otro mes puede no
  // tener la compañía que quedó elegida, y borrarla sola dejaría la tabla filtrada por algo que el
  // botón no nombra. Igual que las cuatro sucursales, que están siempre aunque el mes no las tenga.
  const elegidas = useMemo(() => new Set(valores), [valores])
  const conHuerfanas = useMemo(() => {
    const conocidos = new Set(lista.map((o) => o.valor))
    const sueltas = valores.filter((v) => !conocidos.has(v)).map((v) => ({ valor: v, texto: textoDe ? textoDe(v) : v }))
    return [...lista, ...sueltas]
  }, [lista, textoDe, valores])

  const visibles = useMemo(() => {
    const texto = normalizar(busqueda)
    if (!texto) return conHuerfanas
    return conHuerfanas.filter((o) => normalizar(o.texto).includes(texto) || normalizar(o.valor).includes(texto))
  }, [busqueda, conHuerfanas])

  // Cerrar al tocar afuera o con Escape, y devolver el foco al botón: es el mismo desplegable que
  // «Columnas», y quien maneja con el teclado no tiene que volver a bajar hasta acá.
  useEffect(() => {
    if (!abierto) return
    const alTocar = (evento: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(evento.target as Node)) setAbierto(false)
    }
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return
      setAbierto(false)
      boton.current?.focus()
    }
    document.addEventListener('mousedown', alTocar)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alTocar)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  // El buscador arranca limpio cada vez que se abre: dejarlo escrito esconde opciones que el botón
  // dice tener elegidas.
  useEffect(() => {
    if (!abierto) setBusqueda('')
  }, [abierto])

  const alternar = useCallback(
    (valor: string) => {
      const siguientes = elegidas.has(valor)
        ? valores.filter((v) => v !== valor)
        : // En el orden de las opciones, no en el de los clics: así «ATM y Metropol» se lee igual sin
          // importar cuál se tocó primero.
          conHuerfanas.map((o) => o.valor).filter((v) => v === valor || elegidas.has(v))
      alCambiar([...siguientes])
    },
    [alCambiar, conHuerfanas, elegidas, valores],
  )

  const resumen = useMemo(() => {
    if (valores.length === 0) return `${etiqueta}: ${plural}`
    const primera = conHuerfanas.find((o) => o.valor === valores[0])
    const texto = primera?.texto ?? valores[0] ?? ''
    return valores.length === 1 ? `${etiqueta}: ${texto}` : `${etiqueta}: ${texto} +${valores.length - 1}`
  }, [conHuerfanas, etiqueta, plural, valores])

  /** El botón se corta cuando el nombre es largo; el globo dice todo lo que está filtrando. */
  const detalle = useMemo(() => {
    if (valores.length === 0) return `${etiqueta}: sin filtrar (${plural})`
    const textos = valores.map((v) => conHuerfanas.find((o) => o.valor === v)?.texto ?? v)
    return `${etiqueta}: ${textos.join(', ')}`
  }, [conHuerfanas, etiqueta, plural, valores])

  const hayBuscador = conHuerfanas.length >= buscarDesde

  return (
    <div className={cx('relative', className)} ref={contenedor}>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto((estaba) => !estaba)}
        aria-expanded={abierto}
        aria-haspopup="true"
        aria-controls={abierto ? idPanel : undefined}
        aria-label={detalle}
        title={detalle}
        className={cx(
          'inline-flex h-9 max-w-56 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-sm transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          valores.length > 0
            ? 'border-marino-400 font-semibold text-marino-800 hover:bg-marino-50'
            : 'border-slate-300 text-slate-700 hover:border-slate-400 hover:bg-slate-50',
        )}
      >
        <span className="truncate">{resumen}</span>
        <Icono nombre="desplegar" tamano={13} className={cx('shrink-0 opacity-60 transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <div
          id={idPanel}
          className="absolute left-0 z-40 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-media"
        >
          <header className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <p className="font-display text-sm font-bold tracking-tight text-slate-900">{etiqueta}</p>
            <span className="ml-auto text-[11px] tabular-nums text-slate-500">
              {valores.length === 0 ? plural : `${valores.length} de ${conHuerfanas.length}`}
            </span>
          </header>

          {hayBuscador && (
            <div className="relative border-b border-slate-100 px-3 py-2">
              <Icono nombre="lupa" tamano={14} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Buscar…"
                aria-label={`Buscar en ${etiqueta}`}
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-7 pr-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-marino-400 focus:outline-none"
              />
            </div>
          )}

          <ul className="max-h-72 overflow-y-auto py-1">
            {visibles.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-500">Ninguna opción coincide.</li>}
            {visibles.map((opcion) => (
              <li key={opcion.valor}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={elegidas.has(opcion.valor)}
                    onChange={() => alternar(opcion.valor)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-marino-700 focus:ring-marino-500/40"
                  />
                  <span className="truncate" title={opcion.texto}>
                    {opcion.texto}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <footer className="flex items-center gap-3 border-t border-slate-100 px-3 py-2">
            <button
              type="button"
              onClick={() => alCambiar(visibles.map((o) => o.valor))}
              className="text-xs font-semibold text-marino-700 hover:underline"
            >
              {busqueda ? 'Elegir las que se ven' : 'Elegir todas'}
            </button>
            <button
              type="button"
              onClick={() => alCambiar([])}
              disabled={valores.length === 0}
              className="ml-auto text-xs font-semibold text-slate-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
            >
              Limpiar
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
