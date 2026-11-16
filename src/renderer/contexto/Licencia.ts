// El estado de la licencia de la agencia, para la pantalla de ingreso, el cartel de aviso y
// Administración → Licencia. Se pide al montar y se actualiza solo cuando el programa avisa que cambió
// (se renovó, venció, el servidor rechazó un ingreso por la licencia).
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeLicencia } from '../../shared/licencia'

export function useLicencia(): { estado: EstadoDeLicencia | null; releer: () => Promise<void>; usar: (nuevo: EstadoDeLicencia) => void } {
  const [estado, setEstado] = useState<EstadoDeLicencia | null>(null)

  const releer = useCallback(async () => {
    const resultado = await window.dm.licencia.estado()
    if (resultado.ok) setEstado(resultado.datos)
  }, [])

  useEffect(() => {
    void releer()
    return window.dm.licencia.alCambiar((nuevo) => setEstado(nuevo))
  }, [releer])

  return { estado, releer, usar: setEstado }
}
