// El zoom de la ventana, en la barra superior: «− 100 % +».
//
// Agranda o achica TODO —la letra, los iconos, el alto de las filas y el ancho de las columnas—,
// porque lo hace el zoom de Chromium y no una hoja de estilos. Es lo que pide una agencia donde la
// misma pantalla se mira de cerca en una notebook de 14" y de lejos en el monitor de la oficina.
//
// Los atajos van acá y no en el proceso principal porque la versión publicada arranca sin menú
// (`Menu.setApplicationMenu(null)`), y sin menú Chromium se queda sin los Ctrl + / − / 0 de fábrica.
import { useCallback, useEffect, useState } from 'react'
import { aplicarZoom, guardarZoom, zoomGuardado } from '../preferencias'
import { comoPorcentaje, ESCALAS, ESCALA_NORMAL, escalaAnterior, escalaSiguiente } from '../vista'
import { Icono } from './Icono'
import { cx } from './ui'

const MINIMA = ESCALAS[0]!
const MAXIMA = ESCALAS[ESCALAS.length - 1]!

export function ControlDeZoom() {
  const [escala, setEscala] = useState(zoomGuardado)

  const cambiar = useCallback((nueva: number) => {
    aplicarZoom(nueva)
    guardarZoom(nueva)
    setEscala(nueva)
  }, [])

  // Ctrl + / Ctrl − / Ctrl 0, y Ctrl + rueda. Los dos son lo que cualquiera prueba primero, así que
  // tienen que estar aunque el control se vea a un costado.
  useEffect(() => {
    // Sólo Ctrl, no la tecla de Windows: Win + «+» es la lupa del sistema y no tiene que hacer las dos
    // cosas a la vez. Es lo mismo que promete la ayuda, que habla de Ctrl y nada más.
    //
    // Alt queda afuera aparte: en el teclado español AltGr es Ctrl + Alt, y sin esta salida cualquier
    // símbolo escrito con AltGr haría zoom en el medio de una celda.
    const alTeclear = (evento: KeyboardEvent) => {
      if (!evento.ctrlKey || evento.altKey) return
      // Se mira `code` además de `key`: en el teclado numérico y con la distribución latinoamericana
      // el «+» sale de teclas distintas, y quien agranda la pantalla suele usar el pavé.
      const mas = evento.key === '+' || evento.key === '=' || evento.code === 'NumpadAdd'
      const menos = evento.key === '-' || evento.key === '_' || evento.code === 'NumpadSubtract'
      const normal = evento.key === '0' || evento.code === 'Numpad0'
      if (!mas && !menos && !normal) return
      evento.preventDefault()
      cambiar(mas ? escalaSiguiente(escala) : menos ? escalaAnterior(escala) : ESCALA_NORMAL)
    }
    // `passive: false` porque hay que cancelar el desplazamiento: si no, la planilla se mueve
    // mientras se hace zoom y se pierde la fila que se estaba mirando.
    const alRodar = (evento: WheelEvent) => {
      if (!evento.ctrlKey || evento.deltaY === 0) return
      evento.preventDefault()
      cambiar(evento.deltaY < 0 ? escalaSiguiente(escala) : escalaAnterior(escala))
    }
    window.addEventListener('keydown', alTeclear)
    window.addEventListener('wheel', alRodar, { passive: false })
    return () => {
      window.removeEventListener('keydown', alTeclear)
      window.removeEventListener('wheel', alRodar)
    }
  }, [cambiar, escala])

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-slate-200 p-0.5"
      role="group"
      aria-label={`Zoom de la pantalla: ${comoPorcentaje(escala)}`}
    >
      <BotonDeZoom
        titulo="Achicar todo (Ctrl −)"
        icono="menos"
        disabled={escala <= MINIMA}
        onClick={() => cambiar(escalaAnterior(escala))}
      />
      <button
        type="button"
        onClick={() => cambiar(ESCALA_NORMAL)}
        disabled={escala === ESCALA_NORMAL}
        title="Volver al tamaño normal (Ctrl 0)"
        className={cx(
          'h-7 min-w-14 rounded-md px-1 text-xs font-semibold tabular-nums transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          escala === ESCALA_NORMAL ? 'cursor-default text-slate-500' : 'text-marino-700 hover:bg-slate-100',
        )}
      >
        {comoPorcentaje(escala)}
      </button>
      <BotonDeZoom
        titulo="Agrandar todo (Ctrl +)"
        icono="mas"
        disabled={escala >= MAXIMA}
        onClick={() => cambiar(escalaSiguiente(escala))}
      />
    </div>
  )
}

function BotonDeZoom({
  titulo,
  icono,
  disabled,
  onClick,
}: {
  titulo: string
  icono: 'mas' | 'menos'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={titulo}
      aria-label={titulo}
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors',
        'hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      <Icono nombre={icono} tamano={14} />
    </button>
  )
}
