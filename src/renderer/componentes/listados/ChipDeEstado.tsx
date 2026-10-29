// Estado como chip redondeado con un punto de color: «• Vigente».
//
// Uso:
//   <ChipDeEstado tono="verde">Vigente</ChipDeEstado>   // verde, azul, gris, rojo o ambar
// El tono es solo de presentación: quien arma la tabla decide qué estado va con qué color.
import type { ReactNode } from 'react'
import { cx } from '../ui'

export type TonoDeChip = 'verde' | 'azul' | 'gris' | 'rojo' | 'ambar'

// Pares fondo pálido + tinta oscura del mismo color: son los que el tema oscuro da vuelta solo.
const CLASES_CHIP: Record<TonoDeChip, { chip: string; punto: string }> = {
  verde: { chip: 'bg-green-50 text-green-700', punto: 'bg-green-500' },
  azul: { chip: 'bg-marino-50 text-marino-700', punto: 'bg-marino-500' },
  gris: { chip: 'bg-slate-100 text-slate-600', punto: 'bg-slate-400' },
  rojo: { chip: 'bg-red-50 text-red-700', punto: 'bg-red-500' },
  ambar: { chip: 'bg-amber-50 text-amber-700', punto: 'bg-amber-500' },
}

export function ChipDeEstado({ tono, children }: { tono: TonoDeChip; children: ReactNode }) {
  const clases = CLASES_CHIP[tono]
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', clases.chip)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', clases.punto)} aria-hidden="true" />
      {children}
    </span>
  )
}
