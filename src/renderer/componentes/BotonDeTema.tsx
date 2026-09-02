// El interruptor de tema claro / oscuro, en la barra superior.
//
// El valor vive fuera de React (ver `../tema`), igual que el zoom: se aplica antes de dibujar nada
// para que la ventana no arranque en claro y salte a oscuro delante de quien la está mirando. La
// preferencia es de esta computadora (localStorage), no de la persona: el mostrador y la oficina de
// al lado pueden querer cada uno el suyo con el mismo usuario.
import { useEffect, useState } from 'react'
import { alCambiarTema, cambiarTema, temaActual } from '../tema'
import { Icono } from './Icono'
import { cx } from './ui'

export function BotonDeTema() {
  const [tema, setTema] = useState(temaActual)

  useEffect(() => alCambiarTema(setTema), [])

  const oscuro = tema === 'oscuro'
  const alternar = () => cambiarTema(oscuro ? 'claro' : 'oscuro')

  return (
    <button
      type="button"
      onClick={alternar}
      aria-pressed={oscuro}
      aria-label={oscuro ? 'Tema oscuro activado. Cambiar a tema claro.' : 'Tema claro activado. Cambiar a tema oscuro.'}
      title={oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      className={cx(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors',
        'hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
      )}
    >
      <Icono nombre={oscuro ? 'luna' : 'sol'} tamano={18} />
    </button>
  )
}
