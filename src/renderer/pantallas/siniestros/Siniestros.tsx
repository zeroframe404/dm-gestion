// Siniestros: el listado mensual con las mismas columnas de la hoja —sucursal, compañía, póliza,
// cobertura, asegurado, patente, fecha de carga, fecha del siniestro, N° y observaciones— y, detrás de
// cada fila, la ficha con el seguimiento.
//
// La lista es la que ya conocen; lo nuevo está adentro. Por eso la fila entera abre la ficha y la
// pantalla no se llena de botones.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import {
  ESTADOS_DE_SINIESTRO,
  type EstadoSiniestro,
  type FilaSiniestro,
  type FiltrosSiniestros,
  type ListadoSiniestros,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { BotonAyuda } from '../../componentes/Ayuda'
import { BotonVerComoExcel } from '../../componentes/BotonVerComoExcel'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { SelectorDeColumnas, useColumnasElegidas } from '../../componentes/SelectorDeColumnas'
import { useNavegacion } from '../../contexto/Navegacion'
import { DialogoAltaSiniestro } from './DialogoAltaSiniestro'
import { FichaSiniestro } from './FichaSiniestro'
import { usePuedeEditar } from '../../contexto/Permisos'

const FILTROS_VACIOS: FiltrosSiniestros = { periodo: '', busqueda: '', sucursales: [], companias: [], estado: '', soloRobos: false }

/**
 * Las columnas que se pueden apagar con «Columnas». El asegurado no: sin él la fila no se sabe de
 * quién es. La última —los clips y las tareas pendientes, con la flecha— tampoco: es la que dice que
 * la fila se abre.
 */
const COLUMNAS: Array<{ id: string; titulo: string; siempre?: boolean }> = [
  { id: 'sucursal', titulo: 'Sucursal' },
  { id: 'compania', titulo: 'Compañía' },
  { id: 'poliza', titulo: 'Póliza' },
  { id: 'cobertura', titulo: 'Cobertura' },
  { id: 'asegurado', titulo: 'Asegurado', siempre: true },
  { id: 'patente', titulo: 'Patente' },
  { id: 'carga', titulo: 'Carga' },
  { id: 'fecha', titulo: 'Siniestro' },
  { id: 'numero', titulo: 'N° siniestro' },
  { id: 'estado', titulo: 'Estado' },
  { id: 'observaciones', titulo: 'Observaciones' },
  { id: 'marcas', titulo: 'Adjuntos y tareas', siempre: true },
]

/** Cada estado con su color: el trámite se lee de un vistazo, sin leer la palabra. */
export const CLASES_ESTADO: Record<EstadoSiniestro, string> = {
  CARGADO: 'bg-slate-100 text-slate-700 border-slate-200',
  'EN TRÁMITE': 'bg-marino-50 text-marino-800 border-marino-200',
  'ESPERANDO DOCUMENTACIÓN': 'bg-amber-100 text-amber-900 border-amber-200',
  CERRADO: 'bg-green-100 text-green-800 border-green-200',
}

export function Siniestros() {
  const puedeEditar = usePuedeEditar('siniestros')
  const { parametros, limpiarParametros } = useNavegacion()
  const [datos, setDatos] = useState<ListadoSiniestros | null>(null)
  const [filtros, setFiltros] = useState<FiltrosSiniestros>(FILTROS_VACIOS)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<number | null>(null)
  const [altaAbierta, setAltaAbierta] = useState(false)
  const { visibles, ocultas, alternar: alternarColumna, mostrarTodas } = useColumnasElegidas('siniestros', COLUMNAS)
  const ve = useMemo(() => new Set(visibles.map((columna) => columna.id)), [visibles])

  const cargar = useCallback(async (cuales: FiltrosSiniestros) => {
    setCargando(true)
    const resultado = await window.dm.siniestros.listar(cuales)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(filtros)
  }, [cargar, filtros])

  // Otro módulo puede mandar directo a una ficha (por ejemplo desde la ficha del cliente).
  useEffect(() => {
    if (parametros.siniestroId === undefined) return
    setAbierto(parametros.siniestroId)
    limpiarParametros()
  }, [parametros.siniestroId, limpiarParametros])

  const cambiar = (cambios: Partial<FiltrosSiniestros>) => setFiltros((previos) => ({ ...previos, ...cambios }))

  if (cargando && !datos) return <Cargando texto="Buscando los siniestros…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  if (abierto !== null) {
    return (
      <FichaSiniestro
        siniestroId={abierto}
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
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select value={filtros.periodo} onChange={(e) => cambiar({ periodo: e.target.value })} className={cx('ml-2', selector)}>
            <option value="">Todos</option>
            {datos.periodos.map((periodo) => (
              <option key={periodo} value={periodo}>
                {nombreDePeriodo(periodo)}
              </option>
            ))}
          </select>
        </label>

        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filtros.busqueda}
            onChange={(e) => cambiar({ busqueda: e.target.value })}
            placeholder="Asegurado, patente, N° de siniestro o póliza…"
            className="h-9 w-80 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>

        <FiltroMultiple etiqueta="Sucursal" valores={filtros.sucursales} opciones={datos.sucursales} alCambiar={(v) => cambiar({ sucursales: v })} />

        <FiltroMultiple etiqueta="Compañía" valores={filtros.companias} opciones={datos.companias} alCambiar={(v) => cambiar({ companias: v })} />

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={filtros.soloRobos} onChange={(e) => cambiar({ soloRobos: e.target.checked })} className="h-4 w-4" />
          Sólo robos
        </label>

        <div className="ml-auto flex items-center gap-2">
          <SelectorDeColumnas columnas={COLUMNAS} ocultas={ocultas} alAlternar={alternarColumna} alMostrarTodas={mostrarTodas} />
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setAltaAbierta(true)}>
              Cargar siniestro
            </Boton>
          )}
          <BotonVerComoExcel area="siniestros" />
          <BotonAyuda clave="siniestros" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Contador
          etiqueta="Todos"
          valor={Object.values(datos.porEstado).reduce((suma, n) => suma + n, 0)}
          activo={filtros.estado === ''}
          alTocar={() => cambiar({ estado: '' })}
        />
        {ESTADOS_DE_SINIESTRO.map((estado) => (
          <Contador
            key={estado}
            etiqueta={estado}
            valor={datos.porEstado[estado]}
            activo={filtros.estado === estado}
            alTocar={() => cambiar({ estado: filtros.estado === estado ? '' : estado })}
          />
        ))}
        <span className="ml-auto self-center text-sm text-slate-500">
          {datos.filas.length.toLocaleString('es-AR')} de {datos.total.toLocaleString('es-AR')} siniestros
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              {visibles.map((columna) => (
                <th
                  key={columna.id}
                  className={encabezado}
                  {...(columna.id === 'marcas' ? { 'aria-label': columna.titulo } : {})}
                >
                  {columna.id === 'marcas' ? null : columna.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {datos.filas.length === 0 && (
              <tr>
                <td colSpan={visibles.length} className="px-3 py-12 text-center text-slate-500">
                  {datos.total === 0
                    ? 'Todavía no hay siniestros. Se cargan con «Cargar siniestro» y también entran solos al importar la pestaña SINIESTROS de la hoja.'
                    : 'Ningún siniestro coincide con los filtros.'}
                </td>
              </tr>
            )}
            {datos.filas.map((fila) => (
              <FilaDeSiniestro key={fila.id} fila={fila} ve={ve} alAbrir={() => setAbierto(fila.id)} />
            ))}
          </tbody>
        </table>
      </div>

      {altaAbierta && (
        <DialogoAltaSiniestro
          alCerrar={() => setAltaAbierta(false)}
          alCargar={(ficha) => {
            setAltaAbierta(false)
            setAbierto(ficha.siniestro.id)
          }}
        />
      )}
    </div>
  )
}

function FilaDeSiniestro({ fila, ve, alAbrir }: { fila: FilaSiniestro; ve: Set<string>; alAbrir: () => void }) {
  const celda = 'px-3 py-2 text-slate-600'
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
      className="cursor-pointer border-b border-slate-100 last:border-b-0 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
    >
      {ve.has('sucursal') && <td className={celda}>{fila.sucursal ?? '—'}</td>}
      {ve.has('compania') && <td className={celda}>{fila.compania ?? '—'}</td>}
      {ve.has('poliza') && <td className={cx(celda, 'font-mono text-xs')}>{fila.numeroPoliza ?? '—'}</td>}
      {ve.has('cobertura') && <td className={celda}>{fila.cobertura ?? '—'}</td>}
      {ve.has('asegurado') && <td className="px-3 py-2 font-medium text-slate-900">{fila.clienteNombre ?? '—'}</td>}
      {ve.has('patente') && <td className={cx(celda, 'font-mono text-xs font-semibold')}>{fila.patente ?? '—'}</td>}
      {ve.has('carga') && <td className={cx(celda, 'whitespace-nowrap tabular-nums')}>{fila.fechaCarga ?? '—'}</td>}
      {ve.has('fecha') && <td className={cx(celda, 'whitespace-nowrap tabular-nums')}>{fila.fecha ?? '—'}</td>}
      {ve.has('numero') && <td className={cx(celda, 'font-mono text-xs')}>{fila.numeroSiniestro ?? '—'}</td>}
      {ve.has('estado') && (
        <td className="px-3 py-2">
          <span className={cx('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold', CLASES_ESTADO[fila.estado])}>
            {fila.estado}
          </span>
        </td>
      )}
      {ve.has('observaciones') && (
        <td className="max-w-80 px-3 py-2 text-slate-600">
          {/* Una línea sola: `observaciones` es la línea de tiempo entera (cada adjunto que se sube deja
              su propia entrada), y sin achicarla a una línea un siniestro con muchas fotos estira la
              fila hasta tapar el resto de la tabla. El texto entero sigue disponible al pasar el mouse
              y, sobre todo, al abrir la ficha. */}
          <div className="flex min-w-0 items-center gap-1.5">
            {/* ROBO va en rojo, igual que en la hoja: en la agencia un robo se mira distinto que un choque. */}
            {fila.esRobo && (
              <span className="inline-flex shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-extrabold tracking-wide text-red-700">
                ROBO
              </span>
            )}
            <span className="min-w-0 flex-1 truncate" title={fila.descripcion ?? fila.observaciones ?? undefined}>
              {fila.descripcion ?? fila.observaciones ?? ''}
            </span>
          </div>
        </td>
      )}
      {ve.has('marcas') && (
        <td className="px-3 py-2 whitespace-nowrap text-slate-400">
          <span className="inline-flex items-center gap-2">
            {fila.adjuntos > 0 && (
              <span className="inline-flex items-center gap-0.5 text-xs" title={`${fila.adjuntos} documento(s)`}>
                <Icono nombre="clip" tamano={13} />
                {fila.adjuntos}
              </span>
            )}
            {fila.tareasPendientes > 0 && (
              <span className="inline-flex items-center gap-0.5 text-xs text-amber-600" title={`${fila.tareasPendientes} tarea(s) pendiente(s)`}>
                <Icono nombre="tareas" tamano={13} />
                {fila.tareasPendientes}
              </span>
            )}
            <Icono nombre="flechaDerecha" tamano={14} />
          </span>
        </td>
      )}
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

/** La usa la ficha para mostrar el estado con el mismo color que el listado. */
export function EtiquetaDeEstado({ estado }: { estado: EstadoSiniestro }) {
  return <span className={cx('inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold', CLASES_ESTADO[estado])}>{estado}</span>
}
