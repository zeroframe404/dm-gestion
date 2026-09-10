// El cajón de emojis de la caja de escribir.
//
// Es un desplegable y no un `Dialogo`: un diálogo se lleva el foco y hay que cerrarlo para seguir
// escribiendo, y acá lo normal es poner tres emojis seguidos y seguir tecleando. Por eso copia el
// molde de `CampanaDeTareas` —cerrar al tocar afuera o con Escape— y devuelve el foco a la caja
// después de cada elección.
//
// Lo que NO hace: reemplazar al teclado de emojis de Windows (Win + .). La caja de texto acepta
// cualquier carácter Unicode venga de donde venga; esto es un atajo para no tener que ir a buscarlo.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Icono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { ALTO_DEL_CAJON_DE_EMOJIS, buscarEmojis, CATEGORIAS_DE_EMOJIS, EMOJIS_RAPIDOS, haciaDondeSeAbre, type Emoji } from './emojis'

interface Props {
  /** Qué hacer con el emoji elegido: se inserta donde está el cursor de la caja. */
  alElegir: (emoji: string) => void
  disabled?: boolean
  /**
   * Qué se ve en el botón que abre el cajón (14.0). Por defecto la carita, que es lo que se lee como
   * «emojis» al lado de la caja de escribir; la barra de reacciones le pone un «más», porque ahí los
   * seis de siempre ya están a la vista y el cajón es «los otros».
   */
  cara?: ReactNode
  /** Cómo se llama el botón para quien no ve el dibujo. Acompaña a `cara`. */
  etiqueta?: string
  /** `sm` para el botón chico de la barra de reacciones, que va apretado entre seis emojis (14.0). */
  tamano?: 'md' | 'sm'
  /**
   * Hacia dónde se abre el panel, que mide 320 px de ancho (14.0). `derecha` lo pega al borde derecho
   * del botón y crece hacia la izquierda —lo que corresponde cuando el botón está sobre el margen
   * derecho de la pantalla, como en la caja de escribir o en una burbuja propia—; `izquierda` es al
   * revés, para las burbujas ajenas, que arrancan pegadas al margen izquierdo del hilo.
   */
  lado?: 'derecha' | 'izquierda'
}

export function SelectorDeEmojis({
  alElegir,
  disabled = false,
  cara,
  etiqueta = 'Elegir un emoji',
  tamano = 'md',
  lado = 'derecha',
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const [categoria, setCategoria] = useState(CATEGORIAS_DE_EMOJIS[0].id)
  const [busqueda, setBusqueda] = useState('')
  const [haciaDonde, setHaciaDonde] = useState<'arriba' | 'abajo'>('arriba')
  const contenedor = useRef<HTMLDivElement | null>(null)
  const campoDeBusqueda = useRef<HTMLInputElement | null>(null)

  // De qué lado se abre se mide al abrirlo, contra lo que RECORTA. El cajón puede estar colgado de la
  // caja de escribir (donde arriba siempre sobra lugar) o de la fila de acciones de un mensaje, que
  // vive adentro del hilo, y el hilo es una caja que scrollea: lo que se sale por arriba de su borde no
  // se puede alcanzar de ninguna manera. Ver `haciaDondeSeAbre`.
  useLayoutEffect(() => {
    if (!abierto || !contenedor.current) return
    const caja = contenedor.current.getBoundingClientRect()
    const marco = loQueRecorta(contenedor.current)
    setHaciaDonde(haciaDondeSeAbre(caja.top - marco.arriba, marco.abajo - caja.bottom, ALTO_DEL_CAJON_DE_EMOJIS))
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const alTocar = (evento: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(evento.target as Node)) setAbierto(false)
    }
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') {
        evento.stopPropagation()
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', alTocar)
    window.addEventListener('keydown', alTeclear)
    // El foco va al buscador: abrir el cajón y escribir «auto» es más rápido que buscar con el ojo
    // entre doscientos dibujos.
    campoDeBusqueda.current?.focus()
    return () => {
      document.removeEventListener('mousedown', alTocar)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  const visibles: Emoji[] = busqueda.trim()
    ? buscarEmojis(busqueda)
    : (CATEGORIAS_DE_EMOJIS.find((cada) => cada.id === categoria) ?? CATEGORIAS_DE_EMOJIS[0]).emojis

  return (
    <div className="relative" ref={contenedor}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAbierto((antes) => !antes)}
        aria-label={etiqueta}
        title={etiqueta}
        aria-expanded={abierto}
        className={cx(
          'inline-flex items-center justify-center rounded-lg text-slate-600 transition-colors',
          tamano === 'md' ? 'h-9 w-9' : 'h-6 w-6',
          'hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          'disabled:cursor-not-allowed disabled:opacity-60',
          abierto && 'bg-slate-100 text-slate-900',
        )}
      >
        {cara ?? <span className="text-lg leading-none">🙂</span>}
      </button>

      {abierto && (
        <div
          className={cx(
            'absolute z-30 w-80 rounded-xl border border-slate-200 bg-white shadow-lg',
            haciaDonde === 'arriba' ? 'bottom-full mb-2' : 'top-full mt-2',
            lado === 'derecha' ? 'right-0' : 'left-0',
          )}
        >
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">
                <Icono nombre="lupa" tamano={14} />
              </span>
              <input
                ref={campoDeBusqueda}
                value={busqueda}
                onChange={(evento) => setBusqueda(evento.target.value)}
                placeholder="Buscar: auto, listo, gracias…"
                className="h-8 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-marino-400 focus:outline-none"
              />
            </div>
          </div>

          {!busqueda.trim() && (
            <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-1.5">
              {/* Los seis de siempre, sin tener que buscar: «recibido», «gracias», «me río», «qué
                  bueno», «uh» y «ojo con esto» resuelven la mayoría de las respuestas de trabajo. */}
              {EMOJIS_RAPIDOS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => alElegir(emoji)}
                  className="rounded-lg px-1 py-0.5 text-lg leading-none transition-colors hover:bg-slate-100"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {!busqueda.trim() && (
            <div className="flex gap-1 border-b border-slate-100 px-2 py-1.5">
              {CATEGORIAS_DE_EMOJIS.map((cada) => (
                <button
                  key={cada.id}
                  type="button"
                  onClick={() => setCategoria(cada.id)}
                  title={cada.nombre}
                  className={cx(
                    'flex-1 rounded-lg py-1 text-base transition-colors hover:bg-slate-100',
                    categoria === cada.id && 'bg-marino-50',
                  )}
                >
                  {cada.icono}
                </button>
              ))}
            </div>
          )}

          <div className="grid max-h-56 grid-cols-8 gap-0.5 overflow-y-auto p-2">
            {visibles.map((cada) => (
              <button
                key={cada.emoji}
                type="button"
                title={cada.nombre}
                onClick={() => alElegir(cada.emoji)}
                className="rounded-lg py-1 text-xl leading-none transition-colors hover:bg-slate-100"
              >
                {cada.emoji}
              </button>
            ))}
            {visibles.length === 0 && (
              <p className="col-span-8 px-1 py-4 text-center text-xs text-slate-500">
                No hay ninguno con esa palabra. Con el teclado de Windows (Win + punto) están todos.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Los bordes de arriba y de abajo de lo primero que recorta al cajón: la caja que scrollea más cercana
 * o, si no hay ninguna, la ventana.
 *
 * Se mira `overflow-y` y no el tamaño: una caja con `overflow-y: auto` que hoy entra entera igual va a
 * recortar en cuanto tenga tres mensajes más, y el cajón se abre una vez y se queda ahí.
 */
function loQueRecorta(desde: HTMLElement): { arriba: number; abajo: number } {
  for (let actual = desde.parentElement; actual; actual = actual.parentElement) {
    const desborde = getComputedStyle(actual).overflowY
    if (desborde === 'auto' || desborde === 'scroll' || desborde === 'hidden') {
      const caja = actual.getBoundingClientRect()
      return { arriba: caja.top, abajo: caja.bottom }
    }
  }
  return { arriba: 0, abajo: window.innerHeight }
}
