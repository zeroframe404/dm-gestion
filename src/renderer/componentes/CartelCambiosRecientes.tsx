// El cartel «Cambios recientes»: al ingresar por primera vez después de una actualización muestra lo que
// cambió desde la última versión que esa persona vio. Lo visto se guarda por usuario en esta computadora.
import { useEffect, useState } from 'react'
import { cambiosPendientes, type VersionConCambios } from '../../shared/cambios'
import { useUsuarioActual } from '../contexto/Sesion'
import { ListaDeCambios } from './ListaDeCambios'
import { Boton, Dialogo } from './ui'

const clave = (usuarioId: number) => `dm-cambios-vistos:${usuarioId}`

function leer(usuarioId: number): string | null {
  try {
    return localStorage.getItem(clave(usuarioId))
  } catch {
    return null
  }
}

function guardar(usuarioId: number, version: string) {
  try {
    localStorage.setItem(clave(usuarioId), version)
  } catch {
    // Sin almacenamiento: el cartel volverá a aparecer, no pasa nada grave.
  }
}

export function CartelCambiosRecientes() {
  const usuario = useUsuarioActual()
  const [version, setVersion] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<VersionConCambios[]>([])

  useEffect(() => {
    let vigente = true
    void window.dm.app.info().then((resultado) => {
      if (!vigente || !resultado.ok) return
      const actual = resultado.datos.version
      const lista = cambiosPendientes(actual, leer(usuario.id))
      setVersion(actual)
      // Aunque no haya nada para mostrar se anota la versión, así no se acumula de más.
      if (lista.length === 0) guardar(usuario.id, actual)
      else setPendientes(lista)
    })
    return () => {
      vigente = false
    }
  }, [usuario.id])

  const cerrar = () => {
    if (version) guardar(usuario.id, version)
    setPendientes([])
  }

  return (
    <Dialogo
      abierto={pendientes.length > 0}
      titulo="Cambios recientes"
      descripcion={version ? `DM Gestión se actualizó a la versión ${version}. Esto es lo nuevo:` : undefined}
      alCerrar={cerrar}
      ancho="lg"
      pie={
        <Boton variante="primario" onClick={cerrar}>
          Entendido
        </Boton>
      }
    >
      <ListaDeCambios versiones={pendientes} />
    </Dialogo>
  )
}
