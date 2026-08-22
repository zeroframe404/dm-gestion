// Barra fina arriba de todo: sólo aparece cuando ya se descargó una versión nueva y queda lista
// para instalarse en cuanto se cierre el programa.
import { useEffect, useState } from 'react'
import type { EstadoActualizacion } from '../../shared/tipos'
import { Icono } from './Icono'

export function AvisoActualizacion() {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null)
  const [reiniciando, setReiniciando] = useState(false)

  useEffect(() => {
    void window.dm.actualizaciones.estado().then((resultado) => {
      if (resultado.ok) setEstado(resultado.datos)
    })
    return window.dm.actualizaciones.alCambiarEstado((nuevo) => setEstado(nuevo))
  }, [])

  if (!estado || estado.situacion !== 'lista') return null

  return (
    <div className="flex items-center justify-center gap-3 bg-marino-900 px-4 py-1.5 text-xs font-medium text-cielo-100">
      <Icono nombre="nubeBajada" tamano={14} />
      <span>
        Hay una versión nueva{estado.version ? ` (${estado.version})` : ''}. Se instalará al cerrar el programa.
      </span>
      <button
        type="button"
        disabled={reiniciando}
        onClick={() => {
          setReiniciando(true)
          void window.dm.actualizaciones.instalarAhora()
        }}
        className="rounded-md bg-white/10 px-2.5 py-0.5 font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
      >
        {reiniciando ? 'Reiniciando…' : 'Reiniciar ahora'}
      </button>
    </div>
  )
}
