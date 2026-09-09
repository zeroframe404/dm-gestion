// Barra de arriba de todo cuando se cortó el canal en vivo (14.0).
//
// Va ARRIBA del aviso de actualización a propósito: que se esté por instalar una versión nueva puede
// esperar; que no se pueda guardar nada, no. Es lo primero que tiene que leer quien está por cargar
// una póliza.
//
// El texto dice las dos cosas que hacen falta —que no se puede trabajar y que sí se puede seguir
// mirando— porque la 13.x hacía lo contrario (se trabajaba local y se subía después), y quien viene
// de esa versión va a asumir que sigue siendo así hasta que alguien se lo diga.
//
// Con el canal en pie no se dibuja nada: una barra permanente que dice «todo bien» deja de leerse a
// los dos días y roba una línea de la planilla.
import { useConexion } from '../contexto/Conexion'
import { Icono } from './Icono'

export function BannerSinConexion() {
  const { situacion } = useConexion()

  if (situacion === 'sin-conexion') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-3 bg-red-700 px-4 py-1.5 text-xs font-semibold text-white"
      >
        <Icono nombre="alerta" tamano={14} />
        <span>Sin conexión: no se puede trabajar hasta que vuelva internet. Podés seguir mirando.</span>
      </div>
    )
  }

  if (situacion === 'reconectando') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-amber-950"
      >
        <Icono nombre="cargando" tamano={14} className="animate-spin" />
        <span>Reconectando…</span>
      </div>
    )
  }

  return null
}
