// Rango de fechas «Desde – Hasta» con atajos de mes («Este mes», «Mes siguiente»…) para los filtros de
// los listados. Es el hermano de `RangoDeFecha` (el de la barra de filtros de Pólizas, con «Últimos N
// días»): mismas fechas 'AAAA-MM-DD', pero con la etiqueta arriba y la línea inferior del panel de filtros.
//
// Uso:
//   <RangoDeFechasConAtajos etiqueta="Rango de Fechas de Vencimiento" obligatorio
//     desde={desde} hasta={hasta} alCambiar={(d, h) => { setDesde(d); setHasta(h) }} />
import { aDia, desdeDia } from '../../../shared/polizas'
import { hoyLocal } from '../../../shared/semaforo'
import { cx } from '../ui'
import { CLASES_INPUT_DE_FILTRO } from './PanelDeFiltros'

/** Primer y último día del mes que está `desplazamiento` meses de hoy (0 = este mes, 1 = el que viene, -1 = el pasado). */
export function rangoDeMes(desplazamiento: number, hoy = hoyLocal()): { desde: string; hasta: string } {
  const anio = Number(hoy.slice(0, 4))
  const mes = Number(hoy.slice(5, 7)) - 1
  const iso = (fecha: Date) => fecha.toISOString().slice(0, 10)
  return {
    desde: iso(new Date(Date.UTC(anio, mes + desplazamiento, 1))),
    hasta: iso(new Date(Date.UTC(anio, mes + desplazamiento + 1, 0))),
  }
}

/** Desde hoy hasta dentro de `dias` días (contando hoy como el primero). */
export function proximosDias(dias: number, hoy = hoyLocal()): { desde: string; hasta: string } {
  const dia = aDia(hoy)
  return { desde: hoy, hasta: dia === null ? hoy : desdeDia(dia + dias - 1) }
}

interface PropsRangoDeFechasConAtajos {
  etiqueta: string
  desde: string
  hasta: string
  alCambiar: (desde: string, hasta: string) => void
  obligatorio?: boolean
}

export function RangoDeFechasConAtajos({ etiqueta, desde, hasta, alCambiar, obligatorio = false }: PropsRangoDeFechasConAtajos) {
  const atajos = [
    { texto: 'Mes anterior', rango: () => rangoDeMes(-1) },
    { texto: 'Este mes', rango: () => rangoDeMes(0) },
    { texto: 'Mes siguiente', rango: () => rangoDeMes(1) },
    { texto: 'Próximos 30 días', rango: () => proximosDias(30) },
  ]
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-bold text-slate-800">
        {etiqueta}
        {obligatorio && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      <div className="flex items-center gap-3">
        <input
          type="date"
          value={desde}
          max={hasta || undefined}
          aria-label={`${etiqueta}, desde`}
          onChange={(evento) => alCambiar(evento.target.value, hasta)}
          className={cx(CLASES_INPUT_DE_FILTRO, 'min-w-0 flex-1')}
        />
        <span className="text-slate-400" aria-hidden="true">
          –
        </span>
        <input
          type="date"
          value={hasta}
          min={desde || undefined}
          aria-label={`${etiqueta}, hasta`}
          onChange={(evento) => alCambiar(desde, evento.target.value)}
          className={cx(CLASES_INPUT_DE_FILTRO, 'min-w-0 flex-1')}
        />
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {atajos.map((atajo) => (
          <button
            key={atajo.texto}
            type="button"
            onClick={() => {
              const { desde: nuevoDesde, hasta: nuevoHasta } = atajo.rango()
              alCambiar(nuevoDesde, nuevoHasta)
            }}
            className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
          >
            {atajo.texto}
          </button>
        ))}
      </div>
    </div>
  )
}
