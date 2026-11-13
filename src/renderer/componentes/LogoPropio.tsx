// El logo que la agencia cargó en Administración → Marca. Si no cargó ninguno, se dibuja lo de siempre
// (`hijos`: el escudo). Sólo para la versión de la agencia: la demo tiene su isotipo (LogoDeLaMarca).
import type { ReactNode } from 'react'
import { cx } from './ui'

export function LogoPropio({ logo, tamano, className, hijos }: { logo: string | null; tamano: number; className?: string; hijos: ReactNode }) {
  if (!logo) return <>{hijos}</>
  return <img src={logo} alt="" width={tamano} height={tamano} style={{ width: tamano, height: tamano }} className={cx('object-contain', className)} />
}
