// Lista de versiones con sus cambios, al estilo de las notas de parche de un juego. La usan el cartel
// «Cambios recientes» y la ventana «Históricos» de Acerca de.
import { ETIQUETA_DE_TIPO, type TipoDeCambio, type VersionConCambios } from '../../shared/cambios'

const COLOR_DE_TIPO: Record<TipoDeCambio, string> = {
  agregado: 'bg-emerald-100 text-emerald-800',
  modificado: 'bg-sky-100 text-sky-800',
  corregido: 'bg-amber-100 text-amber-800',
  eliminado: 'bg-rose-100 text-rose-800',
}

function fechaLarga(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  if (!anio || !mes || !dia) return fecha
  return new Date(anio, mes - 1, dia).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ListaDeCambios({ versiones }: { versiones: VersionConCambios[] }) {
  if (versiones.length === 0) return <p className="text-sm text-slate-500">Todavía no hay cambios registrados.</p>
  return (
    <ol className="space-y-6">
      {versiones.map((entrada) => (
        <li key={entrada.version}>
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 pb-1.5">
            <h3 className="font-display text-base font-bold text-slate-900">Versión {entrada.version}</h3>
            <time className="text-xs font-medium text-slate-500" dateTime={entrada.fecha}>
              {fechaLarga(entrada.fecha)}
            </time>
          </div>
          <ul className="mt-3 space-y-2">
            {entrada.cambios.map((cambio, indice) => (
              <li key={indice} className="flex items-start gap-3 text-sm text-slate-800">
                <span className={`mt-0.5 w-[5.5rem] shrink-0 rounded-md px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide ${COLOR_DE_TIPO[cambio.tipo]}`}>
                  {ETIQUETA_DE_TIPO[cambio.tipo]}
                </span>
                <span className="leading-relaxed">{cambio.texto}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
