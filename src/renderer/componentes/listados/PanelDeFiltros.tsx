// Tarjeta «Filtros de Búsqueda»: título a la izquierda y, a la derecha, el enlace «Mostrar filtros» /
// «Ocultar filtros». Plegada por defecto (los listados simples); `abiertoPorDefecto` la deja abierta
// (Vencimientos, donde el filtro es obligatorio).
//
// Uso:
//   <PanelDeFiltros alBuscar={buscar} alLimpiar={limpiar} buscando={cargando}
//     opcionesAdicionales={<BotonPildora activo={x} alAlternar={() => setX(!x)}>Incluir anuladas</BotonPildora>}>
//     <GrillaDeFiltros columnas={4}>
//       <CampoDeFiltro etiqueta="Nombre"><input className={CLASES_INPUT_DE_FILTRO} … /></CampoDeFiltro>
//       <FiltroMultiple variante="chips" etiqueta="Compañías" … />
//     </GrillaDeFiltros>
//   </PanelDeFiltros>
// «Limpiar» y «Buscar» aparecen sólo si se pasa su manejador; Enter dentro de un campo busca.
import { useState, type FormEvent, type ReactNode } from 'react'
import { Boton } from '../ui'
import { Icono } from '../Icono'

/** Clases del `<input>`/`<select>` de un filtro: sin caja, sólo la línea inferior. */
export const CLASES_INPUT_DE_FILTRO =
  'h-9 w-full border-0 border-b border-slate-300 bg-transparent px-0 text-sm text-slate-800 placeholder:text-slate-400 ' +
  'focus:border-marino-500 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-400'

interface PropsPanelDeFiltros {
  titulo?: string
  /** Arranca desplegado. Por defecto, plegado. */
  abiertoPorDefecto?: boolean
  alBuscar?: () => void
  alLimpiar?: () => void
  /** Deshabilita «Buscar» y le pone el cargando (hay una consulta en curso). */
  buscando?: boolean
  /** Deja «Buscar» apagado (sin cargando) con el motivo de `motivoSinBuscar` en el globo: falta un filtro obligatorio. */
  buscarDeshabilitado?: boolean
  motivoSinBuscar?: string
  /** Botones tipo píldora de «Opciones adicionales» (ver `BotonPildora`). */
  opcionesAdicionales?: ReactNode
  children: ReactNode
}

export function PanelDeFiltros({
  titulo = 'Filtros de Búsqueda',
  abiertoPorDefecto = false,
  alBuscar,
  alLimpiar,
  buscando = false,
  buscarDeshabilitado = false,
  motivoSinBuscar,
  opcionesAdicionales,
  children,
}: PropsPanelDeFiltros) {
  const [abierto, setAbierto] = useState(abiertoPorDefecto)

  const enviar = (evento: FormEvent) => {
    evento.preventDefault()
    if (buscarDeshabilitado) return
    alBuscar?.()
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-suave">
      <header className="flex items-center gap-4 px-6 py-4">
        <h2 className="font-display text-base font-bold tracking-tight text-slate-900">{titulo}</h2>
        <button
          type="button"
          onClick={() => setAbierto((estaba) => !estaba)}
          aria-expanded={abierto}
          className="ml-auto inline-flex items-center gap-1 rounded text-sm font-semibold text-marino-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
        >
          {abierto ? 'Ocultar filtros' : 'Mostrar filtros'}
          <Icono nombre="desplegar" tamano={15} className={abierto ? 'rotate-180' : ''} />
        </button>
      </header>

      {abierto && (
        <form onSubmit={enviar} className="flex flex-col gap-5 border-t border-slate-100 px-6 pt-5 pb-5">
          {children}

          {opcionesAdicionales && (
            <div>
              <p className="mb-2 text-sm font-bold text-slate-800">Opciones adicionales</p>
              <div className="flex flex-wrap gap-2">{opcionesAdicionales}</div>
            </div>
          )}

          {(alLimpiar || alBuscar) && (
            <div className="flex justify-end gap-2">
              {alLimpiar && (
                <Boton icono="cerrar" onClick={alLimpiar}>
                  Limpiar
                </Boton>
              )}
              {alBuscar && (
                <Boton type="submit" variante="primario" icono="lupa" cargando={buscando} disabled={buscando || buscarDeshabilitado} title={buscarDeshabilitado ? motivoSinBuscar : undefined}>
                  Buscar
                </Boton>
              )}
            </div>
          )}
        </form>
      )}
    </section>
  )
}

/** Los campos del panel en una grilla que se acomoda sola: 1 columna en pantalla angosta, hasta `columnas` en ancha. */
export function GrillaDeFiltros({ columnas = 3, children }: { columnas?: 2 | 3 | 4; children: ReactNode }) {
  const clase = columnas === 4 ? 'lg:grid-cols-4' : columnas === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
  return <div className={`grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 ${clase}`}>{children}</div>
}

interface PropsCampoDeFiltro {
  etiqueta: string
  /** Muestra el asterisco de campo obligatorio. */
  obligatorio?: boolean
  children: ReactNode
}

/** Un campo del panel: etiqueta arriba en negrita y, debajo, el control (con `CLASES_INPUT_DE_FILTRO`). */
export function CampoDeFiltro({ etiqueta, obligatorio = false, children }: PropsCampoDeFiltro) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-bold text-slate-800">
        {etiqueta}
        {obligatorio && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
    </label>
  )
}
