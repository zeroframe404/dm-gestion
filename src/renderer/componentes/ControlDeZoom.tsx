// El zoom de la ventana, en la barra superior: «− 100 % +».
//
// Es sólo la parte que se ve. El valor, los atajos y la rueda viven en `../zoom`, fuera de React,
// porque tienen que andar también en la pantalla de ingreso, donde esta barra no existe.
//
// Agranda o achica TODO —la letra, los iconos, el alto de las filas y el ancho de las columnas—,
// porque lo hace el zoom de Chromium y no una hoja de estilos. Es lo que pide una agencia donde la
// misma pantalla se mira de cerca en una notebook de 14" y de lejos en el monitor de la oficina.
import { useEffect, useState } from 'react'
import { comoPorcentaje, ESCALAS, ESCALA_NORMAL, escalaAnterior, escalaSiguiente } from '../vista'
import { alCambiarZoom, cambiarZoom, zoomActual } from '../zoom'
import { Icono } from './Icono'
import { cx } from './ui'

const MINIMA = ESCALAS[0]!
const MAXIMA = ESCALAS[ESCALAS.length - 1]!

export function ControlDeZoom() {
  const [escala, setEscala] = useState(zoomActual)

  // Los atajos y la rueda cambian el zoom sin pasar por acá: el número que se muestra los sigue.
  useEffect(() => alCambiarZoom(setEscala), [])

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
        onClick={() => cambiarZoom(escalaAnterior(escala))}
      />
      <button
        type="button"
        onClick={() => cambiarZoom(ESCALA_NORMAL)}
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
        onClick={() => cambiarZoom(escalaSiguiente(escala))}
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
