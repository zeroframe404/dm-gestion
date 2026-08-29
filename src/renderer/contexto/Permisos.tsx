// Qué puede ver y qué puede tocar el usuario que tiene la sesión abierta.
//
// Igual que la sesión: la verdad vive en el proceso principal, que vuelve a controlar cada llamado.
// Acá sólo se refleja, para no ofrecer botones que después van a fallar. Se actualiza sola cuando un
// superadministrador cambia la matriz (evento `permisos:cambiaron`, que llega también cuando el cambio
// se hizo en otra computadora y bajó de GitHub).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { alcanza, type Area, type Nivel } from '../../shared/permisos'
import type { MisPermisos } from '../../shared/tipos'

interface ContextoPermisos {
  /** null mientras se consulta al proceso principal. */
  permisos: MisPermisos | null
  cargando: boolean
  nivel: (area: Area) => Nivel
  puedeVer: (area: Area) => boolean
  puedeEditar: (area: Area) => boolean
  /**
   * Si ve los números agregados de la agencia (lo recaudado del mes, la comisión estimada, el
   * porcentaje de cada compañía). El proceso principal ya no manda esos datos a quien no corresponde;
   * esto es para que la pantalla no dibuje huecos donde no va a llegar nada.
   */
  veNumerosDeLaAgencia: boolean
}

const Contexto = createContext<ContextoPermisos | null>(null)

export function ProveedorPermisos({ children }: { children: ReactNode }) {
  const [permisos, setPermisos] = useState<MisPermisos | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    const pedir = () => {
      void window.dm.permisos.mios().then((resultado) => {
        if (vigente && resultado.ok) setPermisos(resultado.datos)
      })
    }
    void window.dm.permisos
      .mios()
      .then((resultado) => {
        if (vigente && resultado.ok) setPermisos(resultado.datos)
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    const dejarDeEscuchar = window.dm.permisos.alCambiar((nuevos) => {
      if (vigente) setPermisos(nuevos)
    })
    // Al confirmarse la sesión contra GitHub el rol puede haber cambiado, y con él los permisos.
    const dejarDeEscucharSesion = window.dm.auth.alActualizarSesion(pedir)
    return () => {
      vigente = false
      dejarDeEscuchar()
      dejarDeEscucharSesion()
    }
  }, [])

  const nivel = useCallback(
    (area: Area): Nivel => {
      // Mientras no se sepa, nada de escribir: es preferible un botón apagado de más que uno que falla.
      if (!permisos) return 'ver'
      return permisos.areas[area]
    },
    [permisos],
  )

  const valor = useMemo<ContextoPermisos>(
    () => ({
      permisos,
      cargando,
      nivel,
      puedeVer: (area) => alcanza(nivel(area), 'ver'),
      puedeEditar: (area) => alcanza(nivel(area), 'editar'),
      // Mientras no se sepa, se asume que NO: es preferible una tarjeta de menos por un segundo que
      // un número de la agencia que aparece y desaparece delante de quien no tenía que verlo.
      veNumerosDeLaAgencia: permisos?.veNumerosDeLaAgencia === true,
    }),
    [permisos, cargando, nivel],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function usePermisos(): ContextoPermisos {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('usePermisos tiene que usarse dentro de <ProveedorPermisos>.')
  return contexto
}

/** Atajo para las pantallas que sólo necesitan saber si pueden editar su propio módulo. */
export function usePuedeEditar(area: Area): boolean {
  return usePermisos().puedeEditar(area)
}

/** Atajo para las pantallas que muestran plata agregada de la agencia. */
export function useVeNumerosDeLaAgencia(): boolean {
  return usePermisos().veNumerosDeLaAgencia
}
