// Barra lateral azul marino con los módulos que el usuario puede ver y, separada al pie, Administración.
import { useMemo } from 'react'
import { usePermisos } from '../contexto/Permisos'
import { esAreaDePermisos, MODULO_ADMINISTRACION, MODULOS, type IdModulo, type Modulo } from '../modulos'
import { Icono } from './Icono'
import { cx } from './ui'

interface PropsBarraLateral {
  moduloActivo: IdModulo
  alElegir: (id: IdModulo) => void
}

export function BarraLateral({ moduloActivo, alElegir }: PropsBarraLateral) {
  const { puedeVer } = usePermisos()
  // Inicio siempre está; el resto, según los permisos del rol. Administración también, porque «Acerca
  // de» la ve todo el mundo: adentro se muestran sólo las secciones que correspondan.
  const visibles = useMemo(
    () => MODULOS.filter((modulo) => !esAreaDePermisos(modulo.id) || puedeVer(modulo.id)),
    [puedeVer],
  )

  return (
    <aside className="flex w-68 shrink-0 flex-col bg-marino-950 text-white/75">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-cielo-200 ring-1 ring-white/15">
          <Icono nombre="escudo" tamano={18} />
        </div>
        <div className="min-w-0">
          {/* Menos tracking que un rótulo normal: con más, el nombre no entra en el ancho de la barra. */}
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.06em] text-cielo-200">Seguros Daniel Martínez</p>
          <p className="font-display text-xl font-bold tracking-tight text-white">DM Gestión</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Módulos">
        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cielo-200">Principal</p>
        <ul className="flex flex-col gap-0.5">
          {visibles.map((modulo) => (
            <li key={modulo.id}>
              <ItemMenu modulo={modulo} activo={modulo.id === moduloActivo} alElegir={alElegir} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-white/10 px-3 py-3">
        <ItemMenu
          modulo={MODULO_ADMINISTRACION}
          activo={MODULO_ADMINISTRACION.id === moduloActivo}
          alElegir={alElegir}
        />
      </div>
    </aside>
  )
}

interface PropsItemMenu {
  modulo: Modulo
  activo: boolean
  alElegir: (id: IdModulo) => void
}

function ItemMenu({ modulo, activo, alElegir }: PropsItemMenu) {
  return (
    <button
      type="button"
      onClick={() => alElegir(modulo.id)}
      aria-current={activo ? 'page' : undefined}
      className={cx(
        'relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cielo-100/60',
        activo ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white',
      )}
    >
      {activo && (
        <span
          className="absolute top-1/2 left-0 h-3/5 w-[3px] -translate-y-1/2 rounded-r bg-cielo-500"
          aria-hidden="true"
        />
      )}
      <Icono nombre={modulo.icono} tamano={18} className={activo ? 'text-white' : 'text-cielo-200'} />
      <span className="truncate">{modulo.nombre}</span>
    </button>
  )
}
