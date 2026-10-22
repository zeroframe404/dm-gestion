// El cartel que distingue la versión beta de la normal. Las dos conviven en la misma computadora, con
// el mismo ícono y la misma pantalla: sin esto es cuestión de tiempo que alguien cargue un pago real
// en la que no era, o que pruebe una novedad creyendo que está en la de siempre.
//
// También le pone el título a la ventana (el `<title>` de la página manda sobre el de la ventana de
// Electron), así que el nombre de la beta se ve en la barra de tareas.
import { useEffect, useState } from 'react'
import { NOMBRE_BETA } from '../../shared/canal'

let consultaDeCanal: Promise<boolean> | null = null

/** Se pregunta una sola vez por ejecución: el canal no cambia mientras el programa está abierto. */
function esBeta(): Promise<boolean> {
  consultaDeCanal ??= window.dm.app
    .info()
    .then((resultado) => resultado.ok && resultado.datos.canal === 'beta')
    .catch(() => false)
  return consultaDeCanal
}

export function InsigniaBeta({ className = '' }: { className?: string }) {
  const [beta, setBeta] = useState(false)

  useEffect(() => {
    let vigente = true
    void esBeta().then((valor) => {
      if (!vigente || !valor) return
      document.title = NOMBRE_BETA
      setBeta(true)
    })
    return () => {
      vigente = false
    }
  }, [])

  if (!beta) return null
  return (
    <span
      title="Versión de pruebas: no es la que usa la agencia"
      className={`inline-block rounded-md bg-amber-400 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-900 ${className}`}
    >
      Beta
    </span>
  )
}
