// El cartel «Actualización disponible encontrada»: aparece apenas el chequeo automático (cada 15
// minutos) o el manual de Acerca de encuentran una versión nueva, con dos botones. «Actualizar ahora»
// la baja e instala solo; «Dejar para después» no baja nada y sólo lo anota para que lo vea el
// superadministrador desde la pantalla de Usuarios. Si se deja para después, este mismo cartel vuelve
// a aparecer la próxima vez que se abra el programa (no antes: mientras esta ventana siga abierta no
// insiste con la misma versión).
import { useEffect, useState } from 'react'
import type { EstadoActualizacion } from '../../shared/tipos'
import { Boton, Dialogo } from './ui'

export function CartelActualizacionDisponible() {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null)
  // La versión que ya se dejó «para después» en esta apertura del programa: no se vuelve a mostrar el
  // cartel para esa misma versión hasta el próximo arranque (ahí el estado de este componente nace de
  // nuevo). Es justo lo que pidió la sugerencia: insiste al reabrir, no cada 15 minutos.
  const [pospuestaEnEstaSesion, setPospuestaEnEstaSesion] = useState<string | null>(null)
  const [actualizando, setActualizando] = useState(false)
  const [posponiendo, setPosponiendo] = useState(false)

  useEffect(() => {
    void window.dm.actualizaciones.estado().then((resultado) => {
      if (resultado.ok) setEstado(resultado.datos)
    })
    return window.dm.actualizaciones.alCambiarEstado((nuevo) => setEstado(nuevo))
  }, [])

  const abierto = estado?.situacion === 'disponible' && estado.version !== null && estado.version !== pospuestaEnEstaSesion

  const dejarParaDespues = async () => {
    if (!estado?.version) return
    setPosponiendo(true)
    await window.dm.actualizaciones.posponer(estado.version)
    setPospuestaEnEstaSesion(estado.version)
    setPosponiendo(false)
  }

  return (
    <Dialogo
      abierto={abierto}
      titulo="Actualización disponible encontrada"
      alCerrar={() => void dejarParaDespues()}
      pie={
        <>
          <Boton variante="fantasma" cargando={posponiendo} disabled={actualizando} onClick={() => void dejarParaDespues()}>
            Dejar para después
          </Boton>
          <Boton
            variante="primario"
            icono="descargar"
            cargando={actualizando}
            disabled={posponiendo}
            onClick={() => {
              setActualizando(true)
              void window.dm.actualizaciones.actualizarAhora()
            }}
          >
            Actualizar ahora
          </Boton>
        </>
      }
    >
      <p className="text-sm text-slate-700">
        Hay una versión nueva del programa{estado?.version ? ` (${estado.version})` : ''} lista para instalar.
        {actualizando
          ? ' Se está descargando: el programa se va a reiniciar solo apenas termine.'
          : ' Se puede instalar ahora (el programa se reinicia solo al terminar de bajarla) o dejarla para después: en ese caso este aviso va a volver a aparecer la próxima vez que se abra el programa.'}
      </p>
    </Dialogo>
  )
}
