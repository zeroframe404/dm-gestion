// Estado de la base de usuarios compartida (GitHub) tal como lo informa el proceso principal.
// Lo usan el Login, la barra superior, Usuarios y Acerca de; todos ven el mismo estado y se enteran
// de los cambios por el evento `auth:estadoDeAcceso`.
import { useCallback, useEffect, useState } from 'react'
import type { EstadoDeAcceso } from '../../shared/tipos'

interface Acceso {
  acceso: EstadoDeAcceso | null
  /** true mientras se sale a GitHub (hasta 8 segundos). */
  comprobando: boolean
  /** Sale a GitHub y refresca el estado. */
  comprobar: () => Promise<EstadoDeAcceso | null>
}

export function useAcceso(comprobarAlMontar: boolean): Acceso {
  const [acceso, setAcceso] = useState<EstadoDeAcceso | null>(null)
  const [comprobando, setComprobando] = useState(comprobarAlMontar)

  const comprobar = useCallback(async () => {
    setComprobando(true)
    try {
      const resultado = await window.dm.auth.estadoDeAcceso(true)
      if (resultado.ok) {
        setAcceso(resultado.datos)
        return resultado.datos
      }
      return null
    } finally {
      setComprobando(false)
    }
  }, [])

  useEffect(() => {
    let vigente = true
    if (comprobarAlMontar) {
      void comprobar()
    } else {
      void window.dm.auth.estadoDeAcceso(false).then((resultado) => {
        if (vigente && resultado.ok) setAcceso(resultado.datos)
      })
    }
    const dejarDeEscuchar = window.dm.auth.alCambiarAcceso((nuevo) => {
      if (vigente) setAcceso(nuevo)
    })
    return () => {
      vigente = false
      dejarDeEscuchar()
    }
  }, [comprobarAlMontar, comprobar])

  return { acceso, comprobando, comprobar }
}

/** Texto para el vencimiento del token: sólo si falta un mes o menos (o ya venció). */
export function avisoDeVencimiento(acceso: EstadoDeAcceso | null): string | null {
  if (!acceso?.tokenVence) return null
  const vence = new Date(`${acceso.tokenVence}T00:00:00`)
  const dias = Math.ceil((vence.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (dias > 30) return null
  const fecha = vence.toLocaleDateString('es-AR')
  if (dias < 0) return `El acceso a la base de usuarios compartida venció el ${fecha}. Hay que generar un token nuevo y publicar una versión del programa.`
  return `El acceso a la base de usuarios compartida vence el ${fecha}${dias <= 1 ? '' : ` (en ${dias} días)`}. Hay que generar un token nuevo y publicar una versión del programa antes de esa fecha.`
}
