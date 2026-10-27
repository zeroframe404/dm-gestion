// El cartel que distingue la versión beta —y la demo— de la normal. Las tres pueden convivir en la
// misma computadora, con el mismo ícono y la misma pantalla: sin esto es cuestión de tiempo que alguien
// cargue un pago real en la que no era, o que pruebe una novedad creyendo que está en la de siempre.
//
// También le pone el título a la ventana (el `<title>` de la página manda sobre el de la ventana de
// Electron), así que el nombre de la beta o de la demo se ve en la barra de tareas.
import { useEffect } from 'react'
import { nombreDelPrograma } from '../../shared/canal'
import { useCanal } from '../canal'

export function InsigniaBeta({ className = '' }: { className?: string }) {
  const canal = useCanal()

  useEffect(() => {
    if (canal !== 'estable') document.title = nombreDelPrograma(canal)
  }, [canal])

  if (canal === 'beta') {
    return (
      <span
        title="Versión de pruebas: no es la que usa la agencia"
        className={`inline-block rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-900 ${className}`}
      >
        Beta
      </span>
    )
  }
  if (canal === 'demo') {
    return (
      <span
        title="Versión de demostración: datos ficticios, sin conexión con ningún servidor real"
        className={`inline-block rounded-md bg-emerald-400 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-900 ${className}`}
      >
        Demo
      </span>
    )
  }
  return null
}
