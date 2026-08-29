// Barra de pestañas de un módulo (Cartera, Cobranzas, Marketing, Reportes, Administración): la fila de
// solapas con su botón de ayuda a la derecha, contextual a la pestaña activa. Antes cada módulo tenía
// su propia copia de esta fila; se juntó acá para que las cinco se vean exactamente igual.
import type { NombreIcono } from './Icono'
import { Icono } from './Icono'
import { BotonAyuda } from './Ayuda'
import { BotonVerComoExcel } from './BotonVerComoExcel'
import { cx } from './ui'

export interface ItemDePestana<T extends string> {
  id: T
  nombre: string
  icono: NombreIcono
  /** Clave del contenido de ayuda (en `ayuda/contenido`) para esta pestaña. */
  ayuda: string
  /**
   * Id del listado equivalente en «General Excel». Con esto puesto, la barra dibuja «Ver como Excel»
   * al lado de la ayuda: la misma información de esta pestaña, en planilla. Sin esto, no.
   */
  excel?: string
}

interface PropsBarraDePestanas<T extends string> {
  /** aria-label del grupo de solapas. */
  etiqueta: string
  /** Prefijo para los ids de accesibilidad: `tab-${prefijo}-${id}` / `panel-${prefijo}-${id}`. */
  prefijo: string
  items: ItemDePestana<T>[]
  activa: T
  alElegir: (id: T) => void
}

export function BarraDePestanas<T extends string>({ etiqueta, prefijo, items, activa, alElegir }: PropsBarraDePestanas<T>) {
  const seccionActiva = items.find((item) => item.id === activa) ?? items[0]

  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-8">
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label={etiqueta} className="-mb-px flex flex-1 gap-6 overflow-x-auto">
          {items.map((candidata) => {
            const esActiva = candidata.id === activa
            return (
              <button
                key={candidata.id}
                type="button"
                role="tab"
                id={`tab-${prefijo}-${candidata.id}`}
                aria-selected={esActiva}
                aria-controls={esActiva ? `panel-${prefijo}-${candidata.id}` : undefined}
                onClick={() => alElegir(candidata.id)}
                className={cx(
                  'inline-flex shrink-0 items-center gap-2 border-b-2 px-1 py-3 text-sm font-semibold transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                  esActiva
                    ? 'border-marino-700 text-marino-800'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
                )}
              >
                <Icono nombre={candidata.icono} tamano={16} />
                {candidata.nombre}
              </button>
            )
          })}
        </div>
        {seccionActiva?.excel && (
          <div className="mb-1.5 shrink-0">
            <BotonVerComoExcel area={seccionActiva.excel} />
          </div>
        )}
        {seccionActiva && <BotonAyuda clave={seccionActiva.ayuda} className="mb-2 shrink-0" />}
      </div>
    </div>
  )
}
