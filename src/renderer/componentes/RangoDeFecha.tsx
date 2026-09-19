// El filtro de rango de fechas de dos puntas (Pólizas, Reportes…), con accesos rápidos para no tener
// que tipear las dos fechas a mano cuando lo que se quiere es «lo de esta última semana» o «el último
// mes»: el pedido de Daniel en la sugerencia #124.
import { useEffect, useId, useRef, useState } from 'react'
import { aDia, desdeDia } from '../../shared/polizas'
import { hoyLocal } from '../../shared/semaforo'
import { Icono } from './Icono'
import { cx } from './ui'

/** Cuántos días atrás ofrece el desplegable, contando hoy. */
const ATAJOS_DE_DIAS = [7, 15, 30, 90] as const

interface PropsRangoDeFecha {
  /** «Emitida», «Vence»… Es lo que se lee en el rótulo y lo que oye un lector de pantalla. */
  etiqueta: string
  desde: string
  hasta: string
  alCambiar: (desde: string, hasta: string) => void
}

/**
 * Un rango de fechas de dos puntas, cada una opcional: vacío no filtra, así que arranca igual que el
 * resto de los filtros del listado. El botón de flecha abre los accesos rápidos, que cargan las dos
 * puntas de una y cierran el panel solos.
 */
export function RangoDeFecha({ etiqueta, desde, hasta, alCambiar }: PropsRangoDeFecha) {
  const [abierto, setAbierto] = useState(false)
  const contenedor = useRef<HTMLDivElement | null>(null)
  const idPanel = useId()
  const activo = Boolean(desde || hasta)
  const campo = 'h-7 rounded border border-slate-200 bg-white px-1 text-xs text-slate-700'

  // Cerrar al tocar afuera o con Escape, igual que el panel de «Filtro múltiple».
  useEffect(() => {
    if (!abierto) return
    const alTocar = (evento: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(evento.target as Node)) setAbierto(false)
    }
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', alTocar)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alTocar)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])

  const elegirAtajo = (dias: number) => {
    const hoy = hoyLocal()
    const diaDeHoy = aDia(hoy)
    if (diaDeHoy === null) return
    // -1 porque el día de hoy ya cuenta como uno de los N días.
    alCambiar(desdeDia(diaDeHoy - (dias - 1)), hoy)
    setAbierto(false)
  }

  return (
    <div className="relative" ref={contenedor}>
      <div
        className={cx(
          'flex h-9 items-center gap-1.5 rounded-lg border px-2 text-sm',
          activo ? 'border-marino-400 bg-marino-50' : 'border-slate-300 bg-white',
        )}
      >
        <span className="text-xs font-semibold text-slate-500">{etiqueta}</span>
        <input
          type="date"
          value={desde}
          aria-label={`${etiqueta}, desde`}
          onChange={(evento) => alCambiar(evento.target.value, hasta)}
          className={campo}
        />
        <span className="text-slate-300">–</span>
        <input
          type="date"
          value={hasta}
          aria-label={`${etiqueta}, hasta`}
          onChange={(evento) => alCambiar(desde, evento.target.value)}
          className={campo}
        />
        <button
          type="button"
          onClick={() => setAbierto((estaba) => !estaba)}
          aria-expanded={abierto}
          aria-haspopup="true"
          aria-controls={abierto ? idPanel : undefined}
          aria-label={`${etiqueta}, elegir una cantidad de días`}
          title="Últimos N días"
          className="-mr-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <Icono nombre="desplegar" tamano={13} className={cx('transition-transform', abierto && 'rotate-180')} />
        </button>
      </div>

      {abierto && (
        <div
          id={idPanel}
          className="absolute left-0 z-40 mt-1 flex flex-col rounded-lg border border-slate-200 bg-white py-1 shadow-media"
        >
          {ATAJOS_DE_DIAS.map((dias) => (
            <button
              key={dias}
              type="button"
              onClick={() => elegirAtajo(dias)}
              className="whitespace-nowrap px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Últimos {dias} días
            </button>
          ))}
          {activo && (
            <button
              type="button"
              onClick={() => {
                alCambiar('', '')
                setAbierto(false)
              }}
              className="whitespace-nowrap border-t border-slate-100 px-3 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50"
            >
              Limpiar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
