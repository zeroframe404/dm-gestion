// Los listados del Multicotizador: Cotizaciones, Planes de Cotización y Emisiones.
//
// Salen de la API de cada compañía (ver servicios/listadosDelMulticotizador.ts). Lo que no sale de una
// API —la compañía no tiene, o no está configurada, o su API no da ese listado— viene de la base del
// VPS y se marca fila por fila con un ícono de advertencia: al pasar el mouse explica de dónde salió y
// por qué, para que nadie lo tome por lo que la compañía tiene registrado.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  enPesos,
  type CotizacionListada,
  type EmisionListada,
  type FiltrosDeListado,
  type FuenteDeListado,
  type ListadoDelMulticotizador,
  type PlanListado,
} from '../../../shared/multicotizador'
import type { Resultado, TipoDeVehiculo } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, cx, fechaCorta } from '../../componentes/ui'

// --- El ícono de advertencia ---------------------------------------------------------------------------

/**
 * El triángulo de «esto no viene de la API», con su explicación al pasar el mouse (o al llegar con el
 * teclado). La burbuja va con posición fija y no adentro de la celda: la tabla tiene scroll horizontal
 * y la recortaría.
 */
export function AvisoDeOrigen({ texto }: { texto: string }) {
  const ancla = useRef<HTMLSpanElement>(null)
  const burbuja = useRef<HTMLSpanElement>(null)
  const [posicion, setPosicion] = useState<{ x: number; y: number; arriba: boolean } | null>(null)

  const mostrar = () => {
    const caja = ancla.current?.getBoundingClientRect()
    if (!caja) return
    // Abajo del ícono, salvo que no entre: entonces arriba.
    setPosicion({ x: caja.left + caja.width / 2, y: caja.bottom, arriba: caja.bottom + 160 > window.innerHeight })
  }
  const ocultar = () => setPosicion(null)

  // Una vez dibujada, que no se salga de la ventana por los costados.
  useLayoutEffect(() => {
    const elemento = burbuja.current
    if (!elemento || !posicion) return
    const caja = elemento.getBoundingClientRect()
    if (caja.right > window.innerWidth - 8) elemento.style.transform = `translateX(${window.innerWidth - 8 - caja.right}px)`
    else if (caja.left < 8) elemento.style.transform = `translateX(${8 - caja.left}px)`
  }, [posicion])

  return (
    <span
      ref={ancla}
      tabIndex={0}
      role="img"
      aria-label={texto}
      onMouseEnter={mostrar}
      onMouseLeave={ocultar}
      onFocus={mostrar}
      onBlur={ocultar}
      className="inline-flex cursor-help rounded text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
    >
      <Icono nombre="alerta" tamano={16} />
      {posicion && (
        <span
          ref={burbuja}
          role="tooltip"
          className="pointer-events-none fixed z-50 block w-80 rounded-lg bg-slate-900 px-3 py-2 text-left text-xs leading-relaxed font-normal text-white shadow-lg"
          style={{
            left: posicion.x - 160,
            ...(posicion.arriba ? { bottom: window.innerHeight - posicion.y + 28 } : { top: posicion.y + 6 }),
          }}
        >
          {texto}
        </span>
      )}
    </span>
  )
}

/** La celda «Origen»: la etiqueta de la API, o la de la base con su advertencia. */
function Origen({ fila }: { fila: { origen: 'API' | 'VPS'; motivoVps: string | null } }) {
  if (fila.origen === 'API') return <Etiqueta tono="exito">API</Etiqueta>
  return (
    <span className="inline-flex items-center gap-1.5">
      <Etiqueta tono="aviso">Base VPS</Etiqueta>
      <AvisoDeOrigen texto={fila.motivoVps ?? 'Este dato no viene de la API de la compañía: sale de la base de datos del VPS de la agencia.'} />
    </span>
  )
}

// --- Lo común -------------------------------------------------------------------------------------------

function hoyIso(): string {
  const hoy = new Date()
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
}

function haceDiasIso(dias: number): string {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() - dias)
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

const OPCIONES_DE_TIPO = [
  { valor: '', texto: 'Autos y motos' },
  { valor: 'AUTO', texto: 'Autos' },
  { valor: 'MOTO', texto: 'Motos' },
]

function Encabezado({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">{titulo}</h1>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">{children}</p>
    </div>
  )
}

/** De dónde salió lo de cada compañía: una línea por compañía, arriba de la tabla. */
function Fuentes({ fuentes }: { fuentes: FuenteDeListado[] }) {
  if (fuentes.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2">
      {fuentes.map((fuente) => (
        <li
          key={fuente.aseguradora}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
            fuente.origen === 'API' && !fuente.error ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-900',
          )}
        >
          <span className="font-semibold">{fuente.nombre}</span>
          <span>·</span>
          <span>{fuente.origen === 'API' && !fuente.error ? 'API' : 'Base del VPS'}</span>
          <span className="tabular-nums">({fuente.filas})</span>
          {(fuente.origen === 'VPS' || fuente.error) && (
            <AvisoDeOrigen
              texto={
                fuente.origen === 'VPS'
                  ? `Lo de ${fuente.nombre} no sale de su API sino de la base de datos del VPS de la agencia. ${fuente.motivoVps ?? ''}`.trim()
                  : `${fuente.nombre}: ${fuente.error}`
              }
            />
          )}
        </li>
      ))}
    </ul>
  )
}

interface PropsListadoConFiltros<T> {
  titulo: string
  descripcion: ReactNode
  pedir: (filtros: FiltrosDeListado) => Promise<Resultado<ListadoDelMulticotizador<T>>>
  vacio: string
  tabla: (filas: T[]) => ReactNode
}

/** Cotizaciones y Emisiones: el mismo esqueleto de filtros, fuentes y tabla. */
function ListadoConFiltros<T>({ titulo, descripcion, pedir, vacio, tabla }: PropsListadoConFiltros<T>) {
  const [filtros, setFiltros] = useState<FiltrosDeListado>(() => ({ desde: haceDiasIso(30), hasta: hoyIso(), tipo: null }))
  const [listado, setListado] = useState<ListadoDelMulticotizador<T> | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pedido = useRef(0)

  const buscar = useCallback(
    async (con: FiltrosDeListado) => {
      const numero = ++pedido.current
      setCargando(true)
      setError(null)
      const resultado = await pedir(con)
      if (numero !== pedido.current) return
      setCargando(false)
      if (resultado.ok) setListado(resultado.datos)
      else setError(resultado.error)
    },
    [pedir],
  )

  // La primera vez se busca solo, con los últimos 30 días.
  useEffect(() => {
    void buscar(filtros)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deLaBase = listado?.filas.filter((fila) => (fila as { origen: string }).origen === 'VPS').length ?? 0

  return (
    <div className="flex flex-col gap-6 p-8">
      <Encabezado titulo={titulo}>{descripcion}</Encabezado>

      <Tarjeta>
        <form
          className="flex flex-wrap items-end gap-4"
          onSubmit={(evento) => {
            evento.preventDefault()
            void buscar(filtros)
          }}
        >
          <div className="w-44">
            <Campo etiqueta="Desde" type="date" value={filtros.desde} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })} />
          </div>
          <div className="w-44">
            <Campo etiqueta="Hasta" type="date" value={filtros.hasta} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })} />
          </div>
          <div className="w-44">
            <Selector
              etiqueta="Vehículo"
              value={filtros.tipo ?? ''}
              onChange={(e) => setFiltros({ ...filtros, tipo: (e.target.value || null) as TipoDeVehiculo | null })}
              opciones={OPCIONES_DE_TIPO}
            />
          </div>
          <Boton type="submit" variante="primario" icono="lupa" cargando={cargando}>
            Buscar
          </Boton>
        </form>
      </Tarjeta>

      {error && <Alerta tono="error">{error}</Alerta>}

      {!listado && cargando && <Cargando texto="Consultando a cada compañía…" />}

      {listado && (
        <>
          <Fuentes fuentes={listado.fuentes} />
          {deLaBase > 0 && (
            <Alerta tono="aviso">
              {deLaBase === 1 ? 'Una fila no sale' : `${deLaBase} filas no salen`} de la API de su compañía sino de la base de datos del VPS: están
              marcadas con el ícono de advertencia. Pasá el mouse por el ícono para ver por qué.
            </Alerta>
          )}
          <Tarjeta alRas className={cx(cargando && 'opacity-60')}>
            {listado.filas.length === 0 ? <p className="px-6 py-10 text-center text-sm text-slate-500">{vacio}</p> : tabla(listado.filas)}
          </Tarjeta>
        </>
      )}
    </div>
  )
}

const TH = 'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap'
const TD = 'px-4 py-2.5 text-sm text-slate-700 whitespace-nowrap'

function Tabla({ columnas, children }: { columnas: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            {columnas.map((columna) => (
              <th key={columna} className={TH}>
                {columna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  )
}

function nombreDeTipo(tipo: TipoDeVehiculo | null): string {
  return tipo === 'MOTO' ? 'Moto' : tipo === 'AUTO' ? 'Auto' : '—'
}

// --- Cotizaciones ---------------------------------------------------------------------------------------

const pedirCotizaciones = (filtros: FiltrosDeListado) => window.dm.multicotizador.cotizaciones(filtros)

export function Cotizaciones() {
  return (
    <ListadoConFiltros<CotizacionListada>
      titulo="Cotizaciones"
      descripcion="Las cotizaciones registradas en cada compañía, traídas de su API. Las de compañías sin API, o cuya API no da este listado, salen de los presupuestos guardados en la base del VPS y se marcan con una advertencia."
      pedir={pedirCotizaciones}
      vacio="No hay cotizaciones en ese rango."
      tabla={(filas) => (
        <Tabla columnas={['Origen', 'Compañía', 'Fecha', 'Número', 'Tomador', 'Vehículo', 'Patente', 'Tipo', 'Cobertura', 'Premio', 'Suma asegurada']}>
          {filas.map((fila, i) => (
            <tr key={`${fila.aseguradora}:${fila.numero}:${i}`} className={fila.origen === 'VPS' ? 'bg-amber-50/60' : undefined}>
              <td className={TD}>
                <Origen fila={fila} />
              </td>
              <td className={cx(TD, 'font-medium text-slate-900')}>{fila.nombreAseguradora}</td>
              <td className={TD}>{fila.fecha ? fechaCorta(fila.fecha) : '—'}</td>
              <td className={cx(TD, 'tabular-nums')}>{fila.numero || '—'}</td>
              <td className={TD}>{fila.tomador || '—'}</td>
              <td className={cx(TD, 'max-w-72 truncate')} title={fila.vehiculo}>
                {fila.vehiculo || '—'}
              </td>
              <td className={TD}>{fila.patente || '—'}</td>
              <td className={TD}>{nombreDeTipo(fila.tipo)}</td>
              <td className={TD}>{fila.cobertura || '—'}</td>
              <td className={cx(TD, 'text-right tabular-nums')}>{fila.premio !== null ? enPesos(fila.premio) : '—'}</td>
              <td className={cx(TD, 'text-right tabular-nums')}>{fila.sumaAsegurada !== null ? enPesos(fila.sumaAsegurada) : '—'}</td>
            </tr>
          ))}
        </Tabla>
      )}
    />
  )
}

// --- Emisiones ------------------------------------------------------------------------------------------

const pedirEmisiones = (filtros: FiltrosDeListado) => window.dm.multicotizador.emisiones(filtros)

export function Emisiones() {
  return (
    <ListadoConFiltros<EmisionListada>
      titulo="Emisiones"
      descripcion="Las pólizas emitidas en cada compañía, traídas de su API. Las de compañías sin API, o con API pero sin configurar o sin este listado, salen de la base de datos del VPS y se marcan con una advertencia."
      pedir={pedirEmisiones}
      vacio="No hay pólizas emitidas en ese rango."
      tabla={(filas) => (
        <Tabla columnas={['Origen', 'Compañía', 'Emisión', 'Póliza', 'Tomador', 'Patente', 'Tipo', 'Cobertura', 'Vigencia', 'Estado']}>
          {filas.map((fila, i) => (
            <tr key={`${fila.aseguradora}:${fila.poliza}:${i}`} className={fila.origen === 'VPS' ? 'bg-amber-50/60' : undefined}>
              <td className={TD}>
                <Origen fila={fila} />
              </td>
              <td className={cx(TD, 'font-medium text-slate-900')}>{fila.nombreAseguradora}</td>
              <td className={TD}>{fila.fechaEmision ? fechaCorta(fila.fechaEmision) : '—'}</td>
              <td className={cx(TD, 'tabular-nums')}>{fila.poliza || '—'}</td>
              <td className={TD}>{fila.tomador || '—'}</td>
              <td className={TD}>{fila.patente || '—'}</td>
              <td className={TD}>{nombreDeTipo(fila.tipo)}</td>
              <td className={TD}>{fila.cobertura || '—'}</td>
              <td className={TD}>
                {fila.vigenciaDesde || fila.vigenciaHasta ? `${fechaCorta(fila.vigenciaDesde, '…')} → ${fechaCorta(fila.vigenciaHasta, '…')}` : '—'}
              </td>
              <td className={TD}>{fila.estado || '—'}</td>
            </tr>
          ))}
        </Tabla>
      )}
    />
  )
}

// --- Planes de cotización -------------------------------------------------------------------------------

export function PlanesDeCotizacion() {
  const [tipo, setTipo] = useState<TipoDeVehiculo>('AUTO')
  const [listado, setListado] = useState<ListadoDelMulticotizador<PlanListado> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const pedido = useRef(0)

  useEffect(() => {
    const numero = ++pedido.current
    setCargando(true)
    setError(null)
    void window.dm.multicotizador.planes(tipo).then((resultado) => {
      if (numero !== pedido.current) return
      setCargando(false)
      if (resultado.ok) setListado(resultado.datos)
      else setError(resultado.error)
    })
  }, [tipo])

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <Encabezado titulo="Planes de Cotización">
            Los planes comerciales con los que cotiza cada compañía, traídos de su API: son las opciones del ajuste «Plan» de cada tarjeta del
            cotizador. La base del VPS no guarda planes, así que una compañía sin API (o sin configurar) no muestra ninguno.
          </Encabezado>
        </div>
        <div className="w-44">
          <Selector
            etiqueta="Vehículo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoDeVehiculo)}
            opciones={OPCIONES_DE_TIPO.filter((opcion) => opcion.valor)}
          />
        </div>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {!listado && cargando && <Cargando texto="Consultando a cada compañía…" />}

      {listado && (
        <div className={cx('grid gap-6 lg:grid-cols-2', cargando && 'opacity-60')}>
          {listado.fuentes.map((fuente) => {
            const planes = listado.filas.filter((plan) => plan.aseguradora === fuente.aseguradora)
            return (
              <Tarjeta key={fuente.aseguradora} titulo={fuente.nombre} alRas acciones={!fuente.error && <Etiqueta tono="exito">API · {planes.length}</Etiqueta>}>
                {fuente.error ? (
                  <p className="flex items-start gap-2 px-6 pb-6 text-sm text-slate-600">
                    <Icono nombre="info" tamano={16} className="mt-0.5 shrink-0 text-slate-400" />
                    {fuente.error}
                  </p>
                ) : planes.length === 0 ? (
                  <p className="px-6 pb-6 text-sm text-slate-500">La API no devolvió planes para {tipo === 'MOTO' ? 'motos' : 'autos'}.</p>
                ) : (
                  <Tabla columnas={['Código', 'Plan', 'Detalle']}>
                    {planes.map((plan) => (
                      <tr key={`${plan.codigo}:${plan.detalle}`}>
                        <td className={cx(TD, 'tabular-nums')}>{plan.codigo}</td>
                        <td className={cx(TD, 'font-medium whitespace-normal text-slate-900')}>{plan.descripcion}</td>
                        <td className={cx(TD, 'whitespace-normal text-slate-500')}>{plan.detalle || '—'}</td>
                      </tr>
                    ))}
                  </Tabla>
                )}
              </Tarjeta>
            )
          })}
        </div>
      )}
    </div>
  )
}
