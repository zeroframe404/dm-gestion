// La franja de la versión de demostración: siempre a la vista, porque quien la mira tiene que saber
// que lo que ve son datos inventados y que nada de esto sale de su computadora. Y es la puerta a lo que
// más pregunta un comprador: cómo se conecta el programa al servidor de SU agencia.
import { useEsDemo } from '../canal'
import { Icono } from './Icono'

export function BannerDemo({ alConectar }: { alConectar: () => void }) {
  const esDemo = useEsDemo()
  if (!esDemo) return null
  return (
    <div role="note" className="flex items-center justify-center gap-3 bg-emerald-700 px-4 py-1.5 text-xs font-semibold text-white">
      <Icono nombre="info" tamano={14} />
      <span className="truncate">Demostración: datos ficticios, servidor y APIs simulados. Todo vuelve a empezar al cerrar el programa.</span>
      <button
        type="button"
        onClick={alConectar}
        className="shrink-0 whitespace-nowrap rounded-md bg-white/15 px-2 py-0.5 font-bold text-white ring-1 ring-white/30 hover:bg-white/25"
      >
        Conectar a su servidor →
      </button>
    </div>
  )
}
