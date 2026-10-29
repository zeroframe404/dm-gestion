// Botón tipo píldora que se enciende y se apaga: las «Opciones adicionales» de un panel de filtros.
//
// Uso:
//   <BotonPildora activo={incluirAnuladas} alAlternar={() => setIncluirAnuladas((v) => !v)}>
//     Incluir pólizas anuladas
//   </BotonPildora>
// Con `title` + `disabled` sirve también para una opción que todavía no tiene soporte.
import type { ReactNode } from 'react'
import { cx } from '../ui'

interface PropsBotonPildora {
  activo: boolean
  alAlternar: () => void
  disabled?: boolean
  title?: string
  children: ReactNode
}

export function BotonPildora({ activo, alAlternar, disabled = false, title, children }: PropsBotonPildora) {
  return (
    <button
      type="button"
      onClick={alAlternar}
      aria-pressed={activo}
      disabled={disabled}
      title={title}
      className={cx(
        'inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40 disabled:cursor-not-allowed disabled:opacity-60',
        activo
          ? 'border-marino-700 bg-marino-700 text-white hover:bg-marino-600'
          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  )
}
