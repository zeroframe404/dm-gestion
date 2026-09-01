// Barra lateral azul marino con los módulos que el usuario puede ver y, separada al pie, Administración.
//
// Se puede achicar a una tira de iconos con el botón de arriba. No es un adorno: la planilla del mes
// tiene veintidós columnas y en la notebook del mostrador esos 272 píxeles de menú son dos columnas
// menos a la vista. La elección se guarda en esta computadora (ver `preferencias.ts`), así que la
// notebook puede quedar siempre angosta y el monitor de la oficina siempre ancho.
import { useMemo, useState } from 'react'
import { usePermisos } from '../contexto/Permisos'
import { esAreaDePermisos, MODULO_ADMINISTRACION, MODULOS, type IdModulo, type Modulo } from '../modulos'
import { barraLateralColapsada, guardarBarraLateralColapsada } from '../preferencias'
import { Icono } from './Icono'
import { cx } from './ui'

interface PropsBarraLateral {
  moduloActivo: IdModulo
  alElegir: (id: IdModulo) => void
}

export function BarraLateral({ moduloActivo, alElegir }: PropsBarraLateral) {
  const { puedeVer } = usePermisos()
  const [colapsada, setColapsada] = useState(barraLateralColapsada)
  // Inicio siempre está; el resto, según los permisos del rol. Administración también, porque «Acerca
  // de» la ve todo el mundo: adentro se muestran sólo las secciones que correspondan.
  const visibles = useMemo(
    () => MODULOS.filter((modulo) => !esAreaDePermisos(modulo.id) || puedeVer(modulo.id)),
    [puedeVer],
  )

  const alternar = () => {
    const siguiente = !colapsada
    guardarBarraLateralColapsada(siguiente)
    setColapsada(siguiente)
  }

  return (
    <aside
      className={cx(
        'flex shrink-0 flex-col bg-marino-950 text-white/75 transition-[width] duration-150',
        colapsada ? 'w-16' : 'w-68',
      )}
    >
      <div
        className={cx(
          'flex border-b border-white/10',
          colapsada ? 'flex-col items-center gap-2 px-2 py-4' : 'items-center gap-3 px-5 py-5',
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-cielo-200 ring-1 ring-white/15">
          <Icono nombre="escudo" tamano={18} />
        </div>
        {!colapsada && (
          <div className="min-w-0">
            {/* Menos tracking que un rótulo normal: con más, el nombre no entra en el ancho de la barra. */}
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.06em] text-cielo-200">Seguros Daniel Martínez</p>
            <p className="font-display text-xl font-bold tracking-tight text-white">DM Gestión</p>
          </div>
        )}
        <button
          type="button"
          onClick={alternar}
          title={colapsada ? 'Agrandar el menú' : 'Achicar el menú a iconos'}
          aria-label={colapsada ? 'Agrandar el menú' : 'Achicar el menú a iconos'}
          className={cx(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-cielo-200 transition-colors',
            'hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cielo-100/60',
            !colapsada && 'ml-auto -mr-1',
          )}
        >
          <Icono nombre={colapsada ? 'flechaDerecha' : 'flechaIzquierda'} tamano={16} />
        </button>
      </div>

      <nav className={cx('flex-1 overflow-y-auto py-4', colapsada ? 'px-2' : 'px-3')} aria-label="Módulos">
        {!colapsada && <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-cielo-200">Principal</p>}
        <ul className="flex flex-col gap-0.5">
          {visibles.map((modulo) => (
            <li key={modulo.id}>
              <ItemMenu modulo={modulo} activo={modulo.id === moduloActivo} colapsada={colapsada} alElegir={alElegir} />
            </li>
          ))}
        </ul>
      </nav>

      <div className={cx('border-t border-white/10 py-3', colapsada ? 'px-2' : 'px-3')}>
        <ItemMenu
          modulo={MODULO_ADMINISTRACION}
          activo={MODULO_ADMINISTRACION.id === moduloActivo}
          colapsada={colapsada}
          alElegir={alElegir}
        />
      </div>
    </aside>
  )
}

interface PropsItemMenu {
  modulo: Modulo
  activo: boolean
  colapsada: boolean
  alElegir: (id: IdModulo) => void
}

function ItemMenu({ modulo, activo, colapsada, alElegir }: PropsItemMenu) {
  return (
    <button
      type="button"
      onClick={() => alElegir(modulo.id)}
      aria-current={activo ? 'page' : undefined}
      // Achicada no se lee ningún nombre: el título del navegador es la única forma de saber cuál es
      // cuál sin volver a agrandarla, y el aria-label es lo que lee el lector de pantalla.
      title={colapsada ? modulo.nombre : undefined}
      aria-label={colapsada ? modulo.nombre : undefined}
      className={cx(
        'relative flex w-full items-center rounded-lg py-2 text-left text-sm font-medium transition-colors',
        colapsada ? 'justify-center px-2' : 'gap-3 px-3',
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
      {!colapsada && <span className="truncate">{modulo.nombre}</span>}
    </button>
  )
}
