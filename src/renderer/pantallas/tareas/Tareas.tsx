// Tareas: los pendientes del equipo, en una lista que se lee de arriba abajo.
//
// El orden no se elige: primero lo abierto, después lo urgente, después lo que vence antes. Es el
// orden en que hay que hacer las cosas, y por eso la pantalla arranca con «Las mías» puesto —lo
// primero que uno quiere saber al abrir el módulo es qué le toca a uno.
import { useCallback, useEffect, useState } from 'react'
import {
  ESTADOS_DE_TAREA,
  NOMBRE_ESTADO_TAREA,
  PRIORIDADES_DE_TAREA,
  type EstadoTarea,
  type FilaTarea,
  type FiltrosTareas,
  type ListadoTareas,
  type PrioridadTarea,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { BotonVerComoExcel } from '../../componentes/BotonVerComoExcel'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { RangoDeFecha } from '../../componentes/RangoDeFecha'
import { useNavegacion } from '../../contexto/Navegacion'
import { useUsuarioActual } from '../../contexto/Sesion'
import { DialogoNuevaTarea } from './DialogoNuevaTarea'
import { FichaTarea } from './FichaTarea'
import { usePuedeEditar } from '../../contexto/Permisos'

/** La urgencia con su color: ALTA se tiene que ver desde la otra punta de la pantalla. */
export const CLASES_PRIORIDAD: Record<PrioridadTarea, string> = {
  ALTA: 'bg-red-50 text-red-700 border-red-200',
  NORMAL: 'bg-slate-100 text-slate-600 border-slate-200',
  BAJA: 'bg-slate-50 text-slate-400 border-slate-200',
}

export function Tareas() {
  const puedeEditar = usePuedeEditar('tareas')
  const { parametros, limpiarParametros, ir } = useNavegacion()
  const usuario = useUsuarioActual()
  // Arranca en lo mío: es la pregunta con la que uno abre el módulo.
  const [filtros, setFiltros] = useState<FiltrosTareas>({
    busqueda: '',
    estado: '',
    prioridades: [],
    responsableIds: [usuario.id],
    sucursales: [],
    soloVencidas: false,
  })
  const [datos, setDatos] = useState<ListadoTareas | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [altaAbierta, setAltaAbierta] = useState(false)

  const cargar = useCallback(async (cuales: FiltrosTareas) => {
    setCargando(true)
    const resultado = await window.dm.tareas.listar(cuales)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(filtros)
  }, [cargar, filtros])

  // Una tarea que asignó otra sucursal baja por el carril rápido de la sincronización: el listado se
  // vuelve a pedir en el momento, sin que nadie tenga que salir y entrar al módulo.
  useEffect(() => {
    return window.dm.tareas.alCambiarDeAfuera(() => void cargar(filtros))
  }, [cargar, filtros])

  useEffect(() => {
    if (parametros.tareaId === undefined) return
    setAbierta(parametros.tareaId)
    limpiarParametros()
  }, [parametros.tareaId, limpiarParametros])

  const cambiar = (cambios: Partial<FiltrosTareas>) => setFiltros((previos) => ({ ...previos, ...cambios }))

  if (cargando && !datos) return <Cargando texto="Buscando las tareas…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  if (abierta !== null) {
    return (
      <FichaTarea
        tareaId={abierta}
        alVolver={() => {
          setAbierta(null)
          void cargar(filtros)
        }}
      />
    )
  }

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filtros.busqueda}
            onChange={(e) => cambiar({ busqueda: e.target.value })}
            placeholder="Qué hay que hacer, de quién es, de qué ficha cuelga…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>

        {/* El -1 es «sin responsable» y se puede tildar junto con personas: «las de Brenda y las que
            no son de nadie» era, hasta ahora, mirar dos veces. */}
        <FiltroMultiple
          etiqueta="Responsable"
          valores={filtros.responsableIds.map(String)}
          opciones={[
            { valor: String(usuario.id), texto: 'Las mías' },
            { valor: '-1', texto: 'Sin responsable' },
            ...datos.responsables.filter((r) => r.id !== usuario.id).map((r) => ({ valor: String(r.id), texto: r.nombre })),
          ]}
          plural="todos"
          alCambiar={(v) => cambiar({ responsableIds: v.map(Number) })}
        />

        <FiltroMultiple
          etiqueta="Prioridad"
          valores={filtros.prioridades}
          opciones={[...PRIORIDADES_DE_TAREA]}
          plural="todas"
          alCambiar={(v) => cambiar({ prioridades: v as PrioridadTarea[] })}
        />

        <FiltroMultiple etiqueta="Sucursal" valores={filtros.sucursales} opciones={datos.sucursales} alCambiar={(v) => cambiar({ sucursales: v })} />

        <RangoDeFecha
          etiqueta="Vence"
          desde={filtros.desde ?? ''}
          hasta={filtros.hasta ?? ''}
          alCambiar={(desde, hasta) => cambiar({ desde, hasta })}
        />

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={filtros.soloVencidas} onChange={(e) => cambiar({ soloVencidas: e.target.checked })} className="h-4 w-4" />
          Sólo vencidas y de hoy
        </label>

        <div className="ml-auto flex items-center gap-2">
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setAltaAbierta(true)}>
              Nueva tarea
            </Boton>
          )}
          <BotonVerComoExcel area="tareas" />
          <BotonAyuda clave="tareas" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Contador
          etiqueta="Todas"
          valor={Object.values(datos.porEstado).reduce((suma, n) => suma + n, 0)}
          activo={filtros.estado === ''}
          alTocar={() => cambiar({ estado: '' })}
        />
        {ESTADOS_DE_TAREA.map((estado) => (
          <Contador
            key={estado}
            etiqueta={NOMBRE_ESTADO_TAREA[estado]}
            valor={datos.porEstado[estado]}
            activo={filtros.estado === estado}
            alTocar={() => cambiar({ estado: filtros.estado === estado ? '' : estado })}
          />
        ))}
        {(datos.vencidas > 0 || datos.venceHoy > 0) && (
          <div className="self-center rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900">
            {datos.vencidas > 0 && <strong className="font-bold">{datos.vencidas} vencida(s)</strong>}
            {datos.vencidas > 0 && datos.venceHoy > 0 && ' · '}
            {datos.venceHoy > 0 && `${datos.venceHoy} vence(n) hoy`}
          </div>
        )}
        <span className="ml-auto self-center text-sm text-slate-500">
          {datos.filas.length.toLocaleString('es-AR')} de {datos.total.toLocaleString('es-AR')} tareas
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>Qué hay que hacer</th>
              <th className={encabezado}>De qué ficha</th>
              <th className={encabezado}>Asignada a</th>
              <th className={encabezado}>Sucursal</th>
              <th className={encabezado}>Vence</th>
              <th className={encabezado}>Prioridad</th>
              <th className={encabezado}>Estado</th>
              <th className={encabezado} aria-label="Comentarios y documentos" />
            </tr>
          </thead>
          <tbody>
            {datos.filas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-slate-500">
                  {datos.total === 0
                    ? 'Todavía no hay tareas. Se crean con «Nueva tarea» y también desde la ficha de un cliente, una póliza, un siniestro o una consulta.'
                    : filtros.responsableIds.length === 1 && filtros.responsableIds[0] === usuario.id
                      ? 'No tenés ninguna tarea con estos filtros. Sacá «Las mías» del filtro de responsable para ver las de todos.'
                      : 'Ninguna tarea coincide con los filtros.'}
                </td>
              </tr>
            )}
            {datos.filas.map((tarea) => (
              <FilaDeTarea
                key={tarea.id}
                tarea={tarea}
                puedeEditar={puedeEditar}
                alAbrir={() => setAbierta(tarea.id)}
                alIrAlVinculo={() => {
                  if (tarea.siniestroId !== null) return ir('siniestros', { siniestroId: tarea.siniestroId })
                  if (tarea.leadId !== null) return ir('leads', { leadId: tarea.leadId })
                  if (tarea.presupuestoId !== null) return ir('presupuestos', { presupuestoId: tarea.presupuestoId })
                  if (tarea.polizaId !== null) return ir('polizas', { polizaId: tarea.polizaId })
                  if (tarea.clienteId !== null) return ir('clientes', { clienteId: tarea.clienteId })
                }}
                alCambiarEstado={async (estado) => {
                  const resultado = await window.dm.tareas.cambiarEstado(tarea.id, estado)
                  if (resultado.ok) void cargar(filtros)
                  else setError(resultado.error)
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {altaAbierta && (
        <DialogoNuevaTarea
          responsables={datos.responsables}
          sucursales={datos.sucursales}
          alCerrar={() => setAltaAbierta(false)}
          alCrear={(tarea) => {
            setAltaAbierta(false)
            setAbierta(tarea.id)
          }}
        />
      )}
    </div>
  )
}

function FilaDeTarea({
  tarea,
  puedeEditar,
  alAbrir,
  alIrAlVinculo,
  alCambiarEstado,
}: {
  tarea: FilaTarea
  puedeEditar: boolean
  alAbrir: () => void
  alIrAlVinculo: () => void
  alCambiarEstado: (estado: EstadoTarea) => void | Promise<void>
}) {
  const celda = 'px-3 py-2 text-slate-600'
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50">
      <td className="px-3 py-2">
        <button type="button" onClick={alAbrir} className="text-left">
          <span className={cx('block font-medium', tarea.estado === 'hecha' ? 'text-slate-400 line-through' : 'text-slate-900 hover:underline')}>
            {tarea.titulo}
          </span>
          {tarea.detalle && <span className="block max-w-xl truncate text-xs text-slate-500">{tarea.detalle}</span>}
        </button>
      </td>
      <td className={celda}>
        {tarea.vinculoTexto ? (
          <button type="button" onClick={alIrAlVinculo} className="text-left text-xs text-marino-700 hover:underline">
            {tarea.vinculoTexto}
          </button>
        ) : (
          <span className="text-xs text-slate-400">Suelta</span>
        )}
      </td>
      <td className={celda}>{tarea.responsableNombre ?? <span className="text-slate-400">sin responsable</span>}</td>
      <td className={celda}>{tarea.sucursal ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <EtiquetaDeVencimiento tarea={tarea} />
      </td>
      <td className="px-3 py-2">
        <span className={cx('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', CLASES_PRIORIDAD[tarea.prioridad])}>
          {tarea.prioridad}
        </span>
      </td>
      <td className="px-3 py-2">
        <select
          value={tarea.estado}
          disabled={!puedeEditar}
          aria-label={`Estado de ${tarea.titulo}`}
          onChange={(e) => void alCambiarEstado(e.target.value as EstadoTarea)}
          className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-700 disabled:opacity-60"
        >
          {ESTADOS_DE_TAREA.map((estado) => (
            <option key={estado} value={estado}>
              {NOMBRE_ESTADO_TAREA[estado]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-slate-400">
        <span className="inline-flex items-center gap-2">
          {tarea.comentarios > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs" title={`${tarea.comentarios} comentario(s)`}>
              <Icono nombre="mensaje" tamano={13} />
              {tarea.comentarios}
            </span>
          )}
          {tarea.adjuntos > 0 && (
            <span className="inline-flex items-center gap-0.5 text-xs" title={`${tarea.adjuntos} documento(s)`}>
              <Icono nombre="clip" tamano={13} />
              {tarea.adjuntos}
            </span>
          )}
        </span>
      </td>
    </tr>
  )
}

/** La fecha de vencimiento dicha como se dice: «hoy», «hace 3 días», «en 5 días». */
export function EtiquetaDeVencimiento({ tarea }: { tarea: FilaTarea }) {
  if (!tarea.venceEl) return <span className="text-xs text-slate-400">sin fecha</span>
  const dias = tarea.diasParaVencer
  const texto =
    tarea.venceHoy
      ? 'vence hoy'
      : tarea.vencida
        ? `venció hace ${Math.abs(dias ?? 0)} día(s)`
        : dias !== null && dias <= 7
          ? `en ${dias} día(s)`
          : tarea.venceEl
  const tono = tarea.vencida ? 'bg-red-50 text-red-700' : tarea.venceHoy ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-600'
  return (
    <span className={cx('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap', tono)} title={tarea.venceEl}>
      {texto}
    </span>
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
