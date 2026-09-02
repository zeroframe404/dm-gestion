// Leads: las consultas que todavía no son clientes, en tarjetas.
//
// Tarjetas y no tabla a propósito: una consulta no son quince columnas, son cuatro datos y una charla.
// Lo que hay que ver de un vistazo es a quién falta contestarle y qué quería, y eso entra en una
// tarjeta. El estado se cambia desde la misma tarjeta, sin abrir nada.
import { useCallback, useEffect, useState } from 'react'
import {
  ESTADOS_DE_LEAD,
  NOMBRE_ORIGEN_LEAD,
  ORIGENES_DE_LEAD,
  type EstadoLead,
  type FilaLead,
  type FiltrosLeads,
  type ListadoLeads,
  type OrigenDeLead,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { BotonVerComoExcel } from '../../componentes/BotonVerComoExcel'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { useNavegacion } from '../../contexto/Navegacion'
import { DialogoLead } from './DialogoLead'
import { FichaLead } from './FichaLead'
import { usePuedeEditar } from '../../contexto/Permisos'

const FILTROS_VACIOS: FiltrosLeads = { busqueda: '', estado: '', origenes: [], sucursales: [], incluirCerrados: false }

/** El embudo con su color: se lee de un vistazo en qué está cada consulta. */
export const CLASES_ESTADO_LEAD: Record<EstadoLead, string> = {
  NUEVO: 'bg-marino-50 text-marino-800 border-marino-200',
  'EN CHARLA': 'bg-amber-50 text-amber-900 border-amber-200',
  COTIZADO: 'bg-violet-50 text-violet-800 border-violet-200',
  GANADO: 'bg-green-100 text-green-800 border-green-200',
  PERDIDO: 'bg-slate-100 text-slate-600 border-slate-200',
}

export function Leads() {
  const puedeEditar = usePuedeEditar('leads')
  const { parametros, limpiarParametros } = useNavegacion()
  const [datos, setDatos] = useState<ListadoLeads | null>(null)
  const [filtros, setFiltros] = useState<FiltrosLeads>(FILTROS_VACIOS)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [altaAbierta, setAltaAbierta] = useState(false)

  const cargar = useCallback(async (cuales: FiltrosLeads) => {
    setCargando(true)
    const resultado = await window.dm.leads.listar(cuales)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(filtros)
  }, [cargar, filtros])

  // Otro módulo puede mandar directo a una ficha (por ejemplo desde un presupuesto).
  useEffect(() => {
    if (parametros.leadId === undefined) return
    setAbierto(parametros.leadId)
    limpiarParametros()
  }, [parametros.leadId, limpiarParametros])

  const cambiar = (cambios: Partial<FiltrosLeads>) => setFiltros((previos) => ({ ...previos, ...cambios }))

  if (cargando && !datos) return <Cargando texto="Buscando las consultas…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  if (abierto !== null) {
    return (
      <FichaLead
        leadId={abierto}
        alVolver={() => {
          setAbierto(null)
          void cargar(filtros)
        }}
      />
    )
  }

  const abiertas = datos.porEstado.NUEVO + datos.porEstado['EN CHARLA'] + datos.porEstado.COTIZADO

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filtros.busqueda}
            onChange={(e) => cambiar({ busqueda: e.target.value })}
            placeholder="Nombre, teléfono o qué quería asegurar…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <FiltroMultiple
          etiqueta="Cómo llegó"
          valores={filtros.origenes}
          opciones={ORIGENES_DE_LEAD.map((origen) => ({ valor: origen, texto: NOMBRE_ORIGEN_LEAD[origen] }))}
          plural="todos"
          alCambiar={(v) => cambiar({ origenes: v as OrigenDeLead[] })}
        />

        <FiltroMultiple etiqueta="Sucursal" valores={filtros.sucursales} opciones={datos.sucursales} alCambiar={(v) => cambiar({ sucursales: v })} />

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={filtros.incluirCerrados}
            onChange={(e) => cambiar({ incluirCerrados: e.target.checked })}
            className="h-4 w-4"
          />
          Mostrar cerradas
        </label>

        <div className="ml-auto flex items-center gap-2">
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setAltaAbierta(true)}>
              Nueva consulta
            </Boton>
          )}
          <BotonVerComoExcel area="leads" />
          <BotonAyuda clave="leads" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Contador etiqueta="Abiertas" valor={abiertas} activo={filtros.estado === ''} alTocar={() => cambiar({ estado: '' })} />
        {ESTADOS_DE_LEAD.map((estado) => (
          <Contador
            key={estado}
            etiqueta={estado}
            valor={datos.porEstado[estado]}
            activo={filtros.estado === estado}
            alTocar={() => cambiar({ estado: filtros.estado === estado ? '' : estado })}
          />
        ))}
        <span className="ml-auto self-center text-sm text-slate-500">
          {datos.filas.length.toLocaleString('es-AR')} de {datos.total.toLocaleString('es-AR')} consultas
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {datos.filas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">
              {datos.total === 0
                ? 'Todavía no hay consultas cargadas. Con «Nueva consulta» entra la primera; después se le hace el presupuesto y, si cierra, se convierte en cliente sin volver a tipear nada.'
                : 'Ninguna consulta coincide con los filtros.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
            {datos.filas.map((lead) => (
              <TarjetaDeLead
                key={lead.id}
                lead={lead}
                puedeEditar={puedeEditar}
                alAbrir={() => setAbierto(lead.id)}
                alCambiarEstado={async (estado) => {
                  const resultado = await window.dm.leads.cambiarEstado(lead.id, estado)
                  if (resultado.ok) void cargar(filtros)
                  else setError(resultado.error)
                }}
              />
            ))}
          </div>
        )}
      </div>

      {altaAbierta && (
        <DialogoLead
          lead={null}
          sucursales={datos.sucursales}
          alCerrar={() => setAltaAbierta(false)}
          alGuardar={(ficha) => {
            setAltaAbierta(false)
            setAbierto(ficha.lead.id)
          }}
        />
      )}
    </div>
  )
}

function TarjetaDeLead({
  lead,
  puedeEditar,
  alAbrir,
  alCambiarEstado,
}: {
  lead: FilaLead
  puedeEditar: boolean
  alAbrir: () => void
  alCambiarEstado: (estado: EstadoLead) => void | Promise<void>
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-suave transition-shadow hover:shadow-media">
      <div className="flex items-start gap-2">
        <button type="button" onClick={alAbrir} className="min-w-0 flex-1 text-left focus-visible:outline-none">
          <p className="truncate font-semibold text-slate-900 hover:underline">{lead.nombre}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {[lead.telefono, lead.sucursal].filter(Boolean).join(' · ') || 'Sin teléfono'}
          </p>
        </button>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {NOMBRE_ORIGEN_LEAD[lead.origen]}
        </span>
      </div>

      <p className="min-h-10 text-sm leading-relaxed text-slate-700">
        {lead.interes || <span className="text-slate-400">Sin anotar qué quería asegurar.</span>}
        {lead.tipoVehiculo && <span className="ml-1 text-xs text-slate-500">({lead.tipoVehiculo})</span>}
      </p>

      {lead.ultimaNota && (
        <p className="truncate rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600" title={lead.ultimaNota}>
          {lead.ultimaNota}
        </p>
      )}

      {/* mt-auto: las tarjetas de una fila miden lo mismo, así que el estado queda a la misma altura
          en todas aunque una tenga nota y la otra no. */}
      <div className="mt-auto flex items-center gap-2">
        <select
          value={lead.estado}
          disabled={!puedeEditar}
          aria-label={`Estado de ${lead.nombre}`}
          onChange={(e) => void alCambiarEstado(e.target.value as EstadoLead)}
          className={cx('h-8 rounded-lg border px-2 text-xs font-semibold disabled:opacity-60', CLASES_ESTADO_LEAD[lead.estado])}
        >
          {ESTADOS_DE_LEAD.map((estado) => (
            <option key={estado} value={estado}>
              {estado}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1 text-slate-400">
          {lead.presupuestos > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs" title={`${lead.presupuestos} presupuesto(s)`}>
              <Icono nombre="presupuestos" tamano={13} />
              {lead.presupuestos}
            </span>
          )}
          {lead.tareasPendientes > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs text-amber-600" title={`${lead.tareasPendientes} tarea(s) pendiente(s)`}>
              <Icono nombre="tareas" tamano={13} />
              {lead.tareasPendientes}
            </span>
          )}
          {lead.urlWhatsapp && (
            <button
              type="button"
              aria-label={`Escribirle por WhatsApp a ${lead.nombre}`}
              title="Escribirle por WhatsApp"
              onClick={() => void window.dm.sistema.abrirEnlace(lead.urlWhatsapp!)}
              className="rounded-lg p-1.5 text-green-600 hover:bg-green-50"
            >
              <Icono nombre="mensaje" tamano={16} />
            </button>
          )}
        </div>
      </div>
    </article>
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
