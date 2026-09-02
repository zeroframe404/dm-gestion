// Los avisos de tareas, en un solo lugar.
//
// Antes los pedía la campana de la barra superior y nadie más. Ahora también los necesita la barra
// lateral —el módulo Tareas lleva el círculo rojo con lo pendiente— y las dos tienen que decir el
// mismo número: dos consultas por su cuenta se habrían desfasado por el tiempo que va de un reloj al
// otro, y encima serían dos viajes al proceso principal para lo mismo.
//
// Cuándo se vuelve a preguntar:
//  - cada dos minutos, como red de contención;
//  - cuando la sincronización baja tareas de otra computadora (evento `tareas:cambiaron`, que dispara
//    el carril rápido del motor cada 30 segundos): esto es lo que hace que una tarea asignada desde
//    otra sucursal aparezca sola, sin que nadie recargue nada;
//  - cuando alguien da una por terminada, acá o en otra máquina.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AvisosDeTareas } from '../../shared/tipos'
import { usePermisos } from './Permisos'

/** La red de contención. No es lo que hace que las tareas lleguen rápido: eso es `tareas:cambiaron`. */
const CADA_CUANTO_MS = 2 * 60_000

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
    const reloj = setInterval(() => void refrescar(), CADA_CUANTO_MS)
    const dejarDeEscucharCambios = window.dm.tareas.alCambiarDeAfuera(() => void refrescar())
    const dejarDeEscucharCompletadas = window.dm.tareas.alCompletarse(() => void refrescar())
    return () => {
      clearInterval(reloj)
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
