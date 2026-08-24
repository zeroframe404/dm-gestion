// Presupuestos: el listado de lo que se cotizó, con su estado y el precio más barato a la vista.
//
// Sólo se muestran las versiones vigentes: las anteriores están adentro de cada ficha, que es donde
// sirven. El tilde «con versiones anteriores» las trae para el caso en que haya que buscar un precio
// que se pasó hace dos semanas.
import { useCallback, useEffect, useState } from 'react'
import {
  ESTADOS_DE_PRESUPUESTO,
  type EstadoPresupuesto,
  type FilaPresupuesto,
  type FiltrosPresupuestos,
  type ListadoPresupuestos,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { useNavegacion } from '../../contexto/Navegacion'
import { FichaPresupuesto } from './FichaPresupuesto'
import { FormularioPresupuesto } from './FormularioPresupuesto'
import { usePuedeEditar } from '../../contexto/Permisos'

const FILTROS_VACIOS: FiltrosPresupuestos = { busqueda: '', estado: '', sucursal: '', incluirVersiones: false }

export const CLASES_ESTADO_PRESUPUESTO: Record<EstadoPresupuesto, string> = {
  BORRADOR: 'bg-slate-100 text-slate-700 border-slate-200',
  ENVIADO: 'bg-marino-50 text-marino-800 border-marino-200',
  ACEPTADO: 'bg-green-100 text-green-800 border-green-200',
  RECHAZADO: 'bg-red-50 text-red-700 border-red-200',
}

export function Presupuestos() {
  const puedeEditar = usePuedeEditar('presupuestos')
  const { parametros, limpiarParametros } = useNavegacion()
  const [datos, setDatos] = useState<ListadoPresupuestos | null>(null)
  const [filtros, setFiltros] = useState<FiltrosPresupuestos>(FILTROS_VACIOS)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [alta, setAlta] = useState<{ leadId: number | null; clienteId: number | null } | null>(null)
  const [catalogos, setCatalogos] = useState<{ companias: string[]; coberturas: string[] }>({ companias: [], coberturas: [] })

  const cargar = useCallback(async (cuales: FiltrosPresupuestos) => {
    setCargando(true)
    const resultado = await window.dm.presupuestos.listar(cuales)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(filtros)
  }, [cargar, filtros])

  // Las compañías y coberturas para el formulario salen de cualquier ficha; si todavía no hay ninguna,
  // el formulario igual deja escribirlas a mano.
  useEffect(() => {
    if (!datos || datos.filas.length === 0 || catalogos.companias.length > 0) return
    const traer = async () => {
      const resultado = await window.dm.presupuestos.ficha(datos.filas[0]!.id)
      if (resultado.ok) setCatalogos({ companias: resultado.datos.companias, coberturas: resultado.datos.coberturas })
    }
    void traer()
  }, [datos, catalogos.companias.length])

  // Se puede llegar acá desde la ficha de una consulta o de un cliente, con el alta ya apuntada.
  useEffect(() => {
    if (parametros.presupuestoId !== undefined) {
      setAbierto(parametros.presupuestoId)
      limpiarParametros()
      return
    }
    if (parametros.nuevoPresupuestoParaLead !== undefined) {
      setAlta({ leadId: parametros.nuevoPresupuestoParaLead, clienteId: null })
      limpiarParametros()
      return
    }
    if (parametros.nuevoPresupuestoParaCliente !== undefined) {
      setAlta({ leadId: null, clienteId: parametros.nuevoPresupuestoParaCliente })
      limpiarParametros()
    }
  }, [parametros.presupuestoId, parametros.nuevoPresupuestoParaLead, parametros.nuevoPresupuestoParaCliente, limpiarParametros])

  const cambiar = (cambios: Partial<FiltrosPresupuestos>) => setFiltros((previos) => ({ ...previos, ...cambios }))

  if (cargando && !datos) return <Cargando texto="Buscando los presupuestos…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  if (abierto !== null) {
    return (
      <FichaPresupuesto
        presupuestoId={abierto}
        alVolver={() => {
          setAbierto(null)
          void cargar(filtros)
        }}
      />
    )
  }

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'
  const selector = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filtros.busqueda}
            onChange={(e) => cambiar({ busqueda: e.target.value })}
            placeholder="Nombre, número, patente o vehículo…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <select value={filtros.sucursal} onChange={(e) => cambiar({ sucursal: e.target.value })} className={selector} aria-label="Sucursal">
          <option value="">Todas las sucursales</option>
          {datos.sucursales.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={filtros.incluirVersiones}
            onChange={(e) => cambiar({ incluirVersiones: e.target.checked })}
            className="h-4 w-4"
          />
          Con versiones anteriores
        </label>

        <div className="ml-auto flex items-center gap-2">
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setAlta({ leadId: null, clienteId: null })}>
              Nuevo presupuesto
            </Boton>
          )}
          <BotonAyuda clave="presupuestos" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Contador
          etiqueta="Todos"
          valor={Object.values(datos.porEstado).reduce((suma, n) => suma + n, 0)}
          activo={filtros.estado === ''}
          alTocar={() => cambiar({ estado: '' })}
        />
        {ESTADOS_DE_PRESUPUESTO.map((estado) => (
          <Contador
            key={estado}
            etiqueta={estado}
            valor={datos.porEstado[estado]}
            activo={filtros.estado === estado}
            alTocar={() => cambiar({ estado: filtros.estado === estado ? '' : estado })}
          />
        ))}
        <span className="ml-auto self-center text-sm text-slate-500">
          {datos.filas.length.toLocaleString('es-AR')} de {datos.total.toLocaleString('es-AR')} presupuestos
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>N.º</th>
              <th className={encabezado}>Cliente</th>
              <th className={encabezado}>Vehículo</th>
              <th className={encabezado}>Patente</th>
              <th className={encabezado}>Opciones</th>
              <th className={encabezado}>Desde</th>
              <th className={encabezado}>Sucursal</th>
              <th className={encabezado}>Estado</th>
              <th className={encabezado}>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {datos.filas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-12 text-center text-slate-500">
                  {datos.total === 0
                    ? 'Todavía no hay presupuestos. Con «Nuevo presupuesto» cargás las compañías que cotizaste y el mensaje de WhatsApp sale armado.'
                    : 'Ningún presupuesto coincide con los filtros.'}
                </td>
              </tr>
            )}
            {datos.filas.map((fila) => (
              <FilaDePresupuesto key={fila.id} fila={fila} alAbrir={() => setAbierto(fila.id)} />
            ))}
          </tbody>
        </table>
      </div>

      {alta && (
        <FormularioPresupuesto
          ficha={null}
          leadId={alta.leadId}
          clienteId={alta.clienteId}
          companias={catalogos.companias}
          coberturas={catalogos.coberturas}
          alCerrar={() => setAlta(null)}
          alGuardar={(ficha) => {
            setAlta(null)
            setAbierto(ficha.presupuesto.id)
          }}
        />
      )}
    </div>
  )
}

function FilaDePresupuesto({ fila, alAbrir }: { fila: FilaPresupuesto; alAbrir: () => void }) {
  const celda = 'px-3 py-2 text-slate-600'
  const vehiculo = [fila.marca, fila.modelo, fila.anio].filter(Boolean).join(' ')
  return (
    <tr
      onClick={alAbrir}
      tabIndex={0}
      onKeyDown={(evento) => {
        if (evento.key === 'Enter' || evento.key === ' ') {
          evento.preventDefault()
          alAbrir()
        }
      }}
      className={cx(
        'cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none',
        !fila.vigente && 'text-slate-400',
      )}
    >
      <td className={cx(celda, 'font-mono text-xs font-semibold whitespace-nowrap')}>
        {fila.numero}
        {fila.version > 1 && <span className="ml-1 text-slate-400">v{fila.version}</span>}
      </td>
      <td className="px-3 py-2 font-medium text-slate-900">{fila.clienteNombre}</td>
      <td className={celda}>{vehiculo || fila.tipoVehiculo || '—'}</td>
      <td className={cx(celda, 'font-mono text-xs font-semibold')}>{fila.patente ?? '—'}</td>
      <td className={cx(celda, 'tabular-nums')}>{fila.opciones}</td>
      <td className={cx(celda, 'font-semibold tabular-nums text-slate-900')}>{fila.desde ?? '—'}</td>
      <td className={celda}>{fila.sucursal ?? '—'}</td>
      <td className="px-3 py-2">
        <span className={cx('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', CLASES_ESTADO_PRESUPUESTO[fila.estado])}>
          {fila.estado}
        </span>
      </td>
      <td className={cx(celda, 'whitespace-nowrap tabular-nums')}>{fila.creadoEn.slice(0, 10)}</td>
    </tr>
  )
}

function Contador({ etiqueta, valor, activo, alTocar }: { etiqueta: string; valor: number; activo: boolean; alTocar: () => void }) {
  return (
    <button
      type="button"
      onClick={alTocar}
      aria-pressed={activo}
      className={cx(
        'rounded-lg border px-3 py-1.5 text-left transition-colors',
        activo ? 'border-marino-500 bg-marino-50 text-marino-900' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300',
      )}
    >
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="font-display text-lg font-extrabold tabular-nums">{valor.toLocaleString('es-AR')}</span>
    </button>
  )
}
