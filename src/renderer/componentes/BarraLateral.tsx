// Barra lateral azul marino con los módulos que el usuario puede ver y, separada al pie, Administración.
//
// Se puede achicar a una tira de iconos con el botón de arriba. No es un adorno: la planilla del mes
// tiene veintitrés columnas y en la notebook del mostrador esos 272 píxeles de menú son dos columnas
// menos a la vista. La elección se guarda en esta computadora (ver `preferencias.ts`), así que la
// notebook puede quedar siempre angosta y el monitor de la oficina siempre ancho.
import { useEffect, useMemo, useState } from 'react'
import { useNavegacion } from '../contexto/Navegacion'
import { usePermisos } from '../contexto/Permisos'
import { useAvisosDeTareas } from '../contexto/Tareas'
import { useUsuarioActual } from '../contexto/Sesion'
import {
  MODULO_ADMINISTRACION,
  MODULO_API_ASEGURADORAS,
  MODULOS,
  moduloVisible,
  primeraSeccionVisible,
  seccionesVisibles,
  type IdModulo,
  type Modulo,
  type SeccionDeModulo,
} from '../modulos'
import { barraLateralColapsada, guardarBarraLateralColapsada } from '../preferencias'
import { Icono } from './Icono'
import { useNombreDeLaAgencia } from '../canal'
import { InsigniaBeta } from './InsigniaBeta'
import { cx } from './ui'

interface PropsBarraLateral {
  moduloActivo: IdModulo
  alElegir: (id: IdModulo) => void
}

export function BarraLateral({ moduloActivo, alElegir }: PropsBarraLateral) {
  const usuario = useUsuarioActual()
  const { puedeVer } = usePermisos()
  // Lo pendiente de esta persona, para el círculo rojo del módulo Tareas. Es el mismo número que
  // muestra la campana de la barra superior: los dos salen del mismo contexto.
  const { pendientes } = useAvisosDeTareas()
  const nombreDeLaAgencia = useNombreDeLaAgencia()
  const [colapsada, setColapsada] = useState(barraLateralColapsada)
  // API Aseguradoras no es un área de permisos (no está en `puedeVer`/`AREAS`): son credenciales de un
  // tercero, no algo que necesite el mostrador, así que se esconde directamente por rol, igual que las
  // secciones de Galeno y del catálogo de vehículos dentro de Administración.
  const veApiAseguradoras = usuario.rol !== 'EMPLEADO' && puedeVer('administracion')
  // Inicio siempre está; el resto, según los permisos del rol. Administración también, porque «Acerca
  // de» la ve todo el mundo: adentro se muestran sólo las secciones que correspondan.
  // Un módulo con sublista (Cartera) se ve si alguna de sus sub-entradas se puede abrir.
  const visibles = useMemo(() => MODULOS.filter((modulo) => moduloVisible(modulo, puedeVer)), [puedeVer])
  const { ir } = useNavegacion()

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
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.06em] text-cielo-200">{nombreDeLaAgencia}</p>
            <p className="font-display text-xl font-bold tracking-tight text-white">
              DM Gestión <InsigniaBeta className="ml-1 align-middle" />
            </p>
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
              {modulo.secciones && !colapsada ? (
                <GrupoMenu modulo={modulo} activo={modulo.id === moduloActivo} />
              ) : (
                <>
                  <ItemMenu
                    modulo={modulo}
                    activo={modulo.id === moduloActivo}
                    colapsada={colapsada}
                    // Un módulo con sublista abre en la primera sección que esta persona puede ver; si ya
                    // está adentro, el ícono no la saca de la sección en la que está.
                    alElegir={(id) => {
                      if (modulo.secciones && id === moduloActivo) return
                      if (modulo.secciones) ir(id, { seccion: primeraSeccionVisible(modulo, puedeVer) })
                      else alElegir(id)
                    }}
                    pendientes={modulo.id === 'tareas' ? pendientes : 0}
                  />
                  {/* Achicada la barra no hay lugar para la lista, pero Cartera tiene siete pantallas que
                      sólo se abren desde ahí: con el módulo abierto, sus secciones quedan como íconos
                      debajo, con el nombre en el globo. */}
                  {modulo.secciones && colapsada && modulo.id === moduloActivo && (
                    <SeccionesAchicadas modulo={modulo} secciones={seccionesVisibles(modulo, puedeVer)} />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {veApiAseguradoras && (
        <div className={cx('border-t border-white/10 py-3', colapsada ? 'px-2' : 'px-3')}>
          <ItemMenu
            modulo={MODULO_API_ASEGURADORAS}
            activo={MODULO_API_ASEGURADORAS.id === moduloActivo}
            colapsada={colapsada}
            alElegir={alElegir}
          />
        </div>
      )}

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

/**
 * Un módulo con sublista (el Multicotizador): el renglón del módulo abre y cierra la lista, y cada
 * renglón de la lista abre el módulo en esa sección. Achicada la barra no hay lugar para la lista: el
 * módulo vuelve a ser un ícono suelto que abre la primera sección.
 */
function GrupoMenu({ modulo, activo }: { modulo: Modulo; activo: boolean }) {
  const { seccion, ir } = useNavegacion()
  const { puedeVer } = usePermisos()
  // Sólo las sub-entradas que esta persona puede abrir (Cartera pide un permiso distinto por renglón).
  const secciones = seccionesVisibles(modulo, puedeVer)
  const [abierto, setAbierto] = useState(activo)
  // Si se llega al módulo por otro lado (Inicio, un atajo), la lista se abre sola para que se vea dónde se está.
  useEffect(() => {
    if (activo) setAbierto(true)
  }, [activo])
  const actual = activo ? seccionActual(modulo, secciones, seccion) : null

  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierto((previo) => !previo)}
        aria-expanded={abierto}
        className={cx(
          'relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cielo-100/60',
          activo ? 'text-white' : 'text-white/80 hover:bg-white/10 hover:text-white',
        )}
      >
        <Icono nombre={modulo.icono} tamano={18} className={activo ? 'text-white' : 'text-cielo-200'} />
        <span className="truncate">{modulo.nombre}</span>
        <Icono
          nombre="flechaAbajo"
          tamano={16}
          className={cx('ml-auto shrink-0 text-cielo-200 transition-transform duration-150', abierto ? 'rotate-180' : '')}
        />
      </button>
      {abierto && (
        <ul className="mt-0.5 ml-5 flex flex-col gap-0.5 border-l border-white/15 pl-2">
          {secciones.map((item) => {
            const esLaActual = item.id === actual
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => ir(modulo.id, { seccion: item.id })}
                  aria-current={esLaActual ? 'page' : undefined}
                  className={cx(
                    'relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cielo-100/60',
                    esLaActual ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {esLaActual && (
                    <span className="absolute top-1/2 -left-[9px] h-3/5 w-[3px] -translate-y-1/2 rounded-r bg-cielo-500" aria-hidden="true" />
                  )}
                  <Icono nombre={item.icono} tamano={16} className={esLaActual ? 'text-white' : 'text-cielo-200'} />
                  <span className="truncate">{item.nombre}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Qué renglón de la sublista está marcado. La navegación puede traer una sección que no es un renglón:
 * en Cartera, las pestañas internas de la planilla ('rechazos', 'reglas'…) o nada. Eso es la planilla.
 */
function seccionActual(modulo: Modulo, secciones: SeccionDeModulo[], seccion: string | null): string | undefined {
  if (secciones.some((item) => item.id === seccion)) return seccion ?? undefined
  return modulo.id === 'cartera' ? 'planilla' : secciones[0]?.id
}

/** La sublista de un módulo con la barra achicada: un ícono por sección, debajo del ícono del módulo. */
function SeccionesAchicadas({ modulo, secciones }: { modulo: Modulo; secciones: SeccionDeModulo[] }) {
  const { seccion, ir } = useNavegacion()
  const actual = seccionActual(modulo, secciones, seccion)
  return (
    <ul className="mt-0.5 flex flex-col items-center gap-0.5" aria-label={`Secciones de ${modulo.nombre}`}>
      {secciones.map((item) => {
        const esLaActual = item.id === actual
        const nombre = `${modulo.nombre} · ${item.nombre}`
        return (
          <li key={item.id} className="w-full">
            <button
              type="button"
              onClick={() => ir(modulo.id, { seccion: item.id })}
              title={nombre}
              aria-label={nombre}
              aria-current={esLaActual ? 'page' : undefined}
              className={cx(
                'relative flex w-full items-center justify-center rounded-lg py-1.5 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cielo-100/60',
                esLaActual ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
              )}
            >
              {esLaActual && (
                <span className="absolute top-1/2 left-0 h-3/5 w-[3px] -translate-y-1/2 rounded-r bg-cielo-500" aria-hidden="true" />
              )}
              <Icono nombre={item.icono} tamano={15} className={esLaActual ? 'text-white' : 'text-cielo-200'} />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

interface PropsItemMenu {
  modulo: Modulo
  activo: boolean
  colapsada: boolean
  alElegir: (id: IdModulo) => void
  /** Cuántas tareas pendientes tiene esta persona. 0 = no se dibuja ningún círculo. */
  pendientes?: number
}

function ItemMenu({ modulo, activo, colapsada, alElegir, pendientes = 0 }: PropsItemMenu) {
  // Más de 99 no entra en el círculo y tampoco cambia lo que hay que hacer: «+99» y a trabajar.
  const cuenta = pendientes > 99 ? '+99' : String(pendientes)
  return (
    <button
      type="button"
      onClick={() => alElegir(modulo.id)}
      aria-current={activo ? 'page' : undefined}
      // Achicada no se lee ningún nombre: el título del navegador es la única forma de saber cuál es
      // cuál sin volver a agrandarla, y el aria-label es lo que lee el lector de pantalla. El número
      // del círculo entra en los dos: un lector de pantalla no ve el globito rojo.
      title={colapsada ? nombreConPendientes(modulo.nombre, pendientes) : undefined}
      aria-label={pendientes > 0 || colapsada ? nombreConPendientes(modulo.nombre, pendientes) : undefined}
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
      {/* Achicada la barra es una tira de iconos: el círculo se pega al icono, arriba a la derecha.
          Ancha va al final del renglón, que es donde se lo busca. */}
      {pendientes > 0 &&
        (colapsada ? (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-4 text-white ring-2 ring-marino-950"
          >
            {cuenta}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className="ml-auto inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[11px] font-bold tabular-nums leading-none text-white"
          >
            {cuenta}
          </span>
        ))}
    </button>
  )
}

/** «Tareas · 3 pendientes», para el tooltip y para el lector de pantalla. */
function nombreConPendientes(nombre: string, pendientes: number): string {
  if (pendientes <= 0) return nombre
  return `${nombre} · ${pendientes} pendiente${pendientes === 1 ? '' : 's'}`
}
