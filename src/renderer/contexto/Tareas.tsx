// Los avisos de tareas, en un solo lugar.
//
// Antes los pedía la campana de la barra superior y nadie más. Ahora también los necesita la barra
// lateral —el módulo Tareas lleva el círculo rojo con lo pendiente— y las dos tienen que decir el
// mismo número: dos consultas por su cuenta se habrían desfasado por el tiempo que va de un reloj al
// otro, y encima serían dos viajes al proceso principal para lo mismo.
//
// Cuándo se vuelve a preguntar (14.0: ya no hay reloj de respaldo, ver abajo):
//  - cuando bajan tareas de otra computadora (evento `tareas:cambiaron`): esto es lo que hace que una
//    tarea asignada desde otra sucursal aparezca sola, sin que nadie recargue nada;
//  - cuando alguien da una por terminada, acá o en otra máquina.
//
// El reloj de dos minutos se fue con la 14.0. Existía porque la bajada era por reloj y el aviso podía
// perderse entre dos ciclos; con el canal en vivo el aviso llega empujado en el momento y, si el canal
// se cae, al volver se reconcilia entero (`reconciliar()` en `vivo/canal.ts`) y vuelve a disparar el
// evento. Un reloj además de eso es consultar la base para escribir el mismo número que ya estaba.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AvisosDeTareas } from '../../shared/tipos'
import { usePermisos } from './Permisos'

interface ContextoTareas {
  /** null mientras no llegó la primera respuesta. Sirve para no hacer sonar la campana al abrir. */
  avisos: AvisosDeTareas | null
  pendientes: number
  refrescar: () => Promise<void>
  /** Enterarse apaga el punto rojo de lo que está a la vista. Devuelve los avisos ya actualizados. */
  marcarVistos: () => Promise<void>
}

const Contexto = createContext<ContextoTareas | null>(null)

export function ProveedorTareas({ children }: { children: ReactNode }) {
  const { puedeVer } = usePermisos()
  // El proceso principal acepta esta consulta a quien vea Tareas, Clientes o Siniestros: desde esas
  // tres pantallas se asignan tareas. Sin ninguna de las tres no hay nada que preguntar.
  const mira = puedeVer('tareas') || puedeVer('clientes') || puedeVer('siniestros')
  const [avisos, setAvisos] = useState<AvisosDeTareas | null>(null)

  const refrescar = useCallback(async () => {
    if (!mira) return
    const resultado = await window.dm.tareas.avisos()
    if (resultado.ok) setAvisos(resultado.datos)
  }, [mira])

  const marcarVistos = useCallback(async () => {
    if (!mira) return
    const resultado = await window.dm.tareas.marcarVistos()
    if (resultado.ok) setAvisos(resultado.datos)
  }, [mira])

  useEffect(() => {
    if (!mira) {
      setAvisos(null)
      return
    }
    void refrescar()
    const dejarDeEscucharCambios = window.dm.tareas.alCambiarDeAfuera(() => void refrescar())
    const dejarDeEscucharCompletadas = window.dm.tareas.alCompletarse(() => void refrescar())
    return () => {
      dejarDeEscucharCambios()
      dejarDeEscucharCompletadas()
    }
  }, [mira, refrescar])

  const valor = useMemo<ContextoTareas>(
    () => ({ avisos, pendientes: avisos?.pendientes ?? 0, refrescar, marcarVistos }),
    [avisos, refrescar, marcarVistos],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useAvisosDeTareas(): ContextoTareas {
  const valor = useContext(Contexto)
  if (!valor) throw new Error('useAvisosDeTareas se usa adentro de <ProveedorTareas>.')
  return valor
}
