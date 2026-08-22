// Módulo Marketing: las plantillas de los mensajes de WhatsApp y los segmentos de la cartera.
import { useEffect, useState } from 'react'
import { Icono, type NombreIcono } from '../../componentes/Icono'
import { cx } from '../../componentes/ui'
import { useNavegacion } from '../../contexto/Navegacion'
import { Plantillas } from './Plantillas'
import { Segmentos } from './Segmentos'

type IdSeccion = 'segmentos' | 'plantillas'

const SECCIONES: Array<{ id: IdSeccion; nombre: string; icono: NombreIcono }> = [
  { id: 'segmentos', nombre: 'Segmentos', icono: 'clientes' },
  { id: 'plantillas', nombre: 'Plantillas', icono: 'mensaje' },
]

export function Marketing() {
  const [seccion, setSeccion] = useState<IdSeccion>('segmentos')
  const { parametros, limpiarParametros } = useNavegacion()

  // Otro módulo puede abrir Marketing pidiendo una subpestaña puntual.
  useEffect(() => {
    const pedida = parametros.seccion
    if (!pedida) return
    if (SECCIONES.some((s) => s.id === pedida)) setSeccion(pedida as IdSeccion)
    limpiarParametros()
  }, [parametros.seccion, limpiarParametros])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-8">
        <div role="tablist" aria-label="Secciones de marketing" className="-mb-px flex gap-6">
          {SECCIONES.map((candidata) => {
            const activa = candidata.id === seccion
            return (
              <button
                key={candidata.id}
                type="button"
                role="tab"
                id={`tab-marketing-${candidata.id}`}
                aria-selected={activa}
                aria-controls={activa ? `panel-marketing-${candidata.id}` : undefined}
                onClick={() => setSeccion(candidata.id)}
                className={cx(
                  'inline-flex items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                  activa ? 'border-marino-700 text-marino-800' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
                )}
              >
                <Icono nombre={candidata.icono} tamano={16} />
                {candidata.nombre}
              </button>
            )
          })}
        </div>
      </div>

      <div
        id={`panel-marketing-${seccion}`}
        role="tabpanel"
        aria-labelledby={`tab-marketing-${seccion}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {seccion === 'segmentos' ? <Segmentos /> : <Plantillas />}
      </div>
    </div>
  )
}
