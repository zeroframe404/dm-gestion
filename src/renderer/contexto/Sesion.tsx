// Estado de sesión del renderer. La verdad vive en el proceso principal; acá sólo se refleja.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CredencialesIngreso, SesionUsuario } from '../../shared/tipos'

interface ContextoSesion {
  usuario: SesionUsuario | null
  /** true mientras se consulta al proceso principal si ya hay una sesión abierta. */
  cargando: boolean
  /** Devuelve el mensaje de error o null si el ingreso fue correcto. */
  ingresar: (datos: CredencialesIngreso) => Promise<string | null>
  salir: () => Promise<void>
  /** Reemplaza los datos de la sesión (por ejemplo, después de cambiar la contraseña). */
  actualizar: (sesion: SesionUsuario) => void
}

const Contexto = createContext<ContextoSesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<SesionUsuario | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    window.dm.auth
      .sesion()
      .then((resultado) => {
        if (vigente && resultado.ok) setUsuario(resultado.datos)
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [])

  const ingresar = useCallback(async (datos: CredencialesIngreso) => {
    const resultado = await window.dm.auth.ingresar(datos)
    if (!resultado.ok) return resultado.error
    setUsuario(resultado.datos)
    return null
  }, [])

  const salir = useCallback(async () => {
    await window.dm.auth.salir()
    setUsuario(null)
  }, [])

  const actualizar = useCallback((sesion: SesionUsuario) => setUsuario(sesion), [])

  const valor = useMemo<ContextoSesion>(
    () => ({ usuario, cargando, ingresar, salir, actualizar }),
    [usuario, cargando, ingresar, salir, actualizar],
  )

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useSesion(): ContextoSesion {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('useSesion tiene que usarse dentro de <ProveedorSesion>.')
  return contexto
}

/** Versión para pantallas que sólo se muestran con sesión abierta. */
export function useUsuarioActual(): SesionUsuario {
  const { usuario } = useSesion()
  if (!usuario) throw new Error('No hay sesión abierta.')
  return usuario
}
