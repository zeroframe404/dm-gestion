// Módulo Reportes: el centro de exportación.
//
// Se elige el módulo, se ajustan los filtros, se marcan las columnas que van y sale un .xlsx o un
// PDF. La vista previa muestra las primeras filas antes de guardar nada: exportar 4.000 filas y
// descubrir en Excel que faltaba un filtro es el trabajo que esto viene a sacarse de encima.
//
// La subpestaña «Planilla clásica» es otra cosa: no elige columnas ni formato, porque su gracia es
// justamente salir siempre igual, con el formato de la hoja mensual de siempre.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import type {
  CatalogoDeReportes,
  DefinicionDeReporte,
  FiltrosDeReporte,
  FormatoDeReporte,
  VistaPreviaDeReporte,
} from '../../../shared/tipos'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { Alerta, Boton, Cargando, cx, Tarjeta } from '../../componentes/ui'
import { BarraDePestanas, type ItemDePestana } from '../../componentes/BarraDePestanas'

const FILTROS_VACIOS: FiltrosDeReporte = { periodo: '', sucursales: [], companias: [], estados: [], busqueda: '', desde: '', hasta: '' }

type IdSeccion = 'exportaciones' | 'clasica'

const SECCIONES: ItemDePestana<IdSeccion>[] = [
  { id: 'exportaciones', nombre: 'Exportaciones', icono: 'descargar', ayuda: 'reportes.exportaciones' },
  { id: 'clasica', nombre: 'Planilla clásica', icono: 'tabla', ayuda: 'reportes.clasica' },
]

export function Reportes() {
  const [seccion, setSeccion] = useState<IdSeccion>('exportaciones')
  const [catalogo, setCatalogo] = useState<CatalogoDeReportes | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const resultado = await window.dm.reportes.catalogo()
      if (resultado.ok) setCatalogo(resultado.datos)
      else setError(resultado.error)
    })()
  }, [])

  if (!catalogo) {
    return error ? (
      <div className="p-8">
        <Alerta tono="error">{error}</Alerta>
      </div>
    ) : (
      <Cargando texto="Preparando los reportes…" />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BarraDePestanas etiqueta="Secciones de reportes" prefijo="reportes" items={SECCIONES} activa={seccion} alElegir={setSeccion} />

      <div
        id={`panel-reportes-${seccion}`}
        role="tabpanel"
        aria-labelledby={`tab-reportes-${seccion}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {seccion === 'exportaciones' ? <CentroDeExportacion catalogo={catalogo} /> : <PlanillaClasica catalogo={catalogo} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Centro de exportación
// ---------------------------------------------------------------------------

function CentroDeExportacion({ catalogo }: { catalogo: CatalogoDeReportes }) {
  const [reporteId, setReporteId] = useState(catalogo.reportes[0]?.id ?? '')
  const [filtros, setFiltros] = useState<FiltrosDeReporte>(FILTROS_VACIOS)
  const [columnas, setColumnas] = useState<string[]>([])
  const [vista, setVista] = useState<VistaPreviaDeReporte | null>(null)
  const [cargando, setCargando] = useState(false)
  const [exportando, setExportando] = useState<FormatoDeReporte | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const reporte = useMemo(
    () => catalogo.reportes.find((candidato) => candidato.id === reporteId) ?? catalogo.reportes[0],
    [catalogo.reportes, reporteId],
  )

  // Cambiar de reporte deja los filtros y las columnas del anterior, que no tienen sentido acá.
  const elegirReporte = useCallback((id: string) => {
    setReporteId(id)
    setFiltros(FILTROS_VACIOS)
    setColumnas([])
    setVista(null)
    setAviso(null)
  }, [])

  const pedido = useMemo(() => ({ reporteId: reporte?.id ?? '', filtros, columnas }), [reporte?.id, filtros, columnas])

  // La vista previa se recalcula sola, con una pausa: escribir en el buscador no puede disparar una
  // consulta por tecla.
  const ultimoPedido = useRef(0)
  useEffect(() => {
    if (!reporte) return
    const numeroDePedido = ++ultimoPedido.current
    setCargando(true)
    const reloj = setTimeout(async () => {
      const resultado = await window.dm.reportes.vistaPrevia(pedido)
      // Una respuesta vieja no puede pisar a una nueva.
      if (numeroDePedido !== ultimoPedido.current) return
      if (resultado.ok) {
        setVista(resultado.datos)
        setError(null)
      } else {
        setError(resultado.error)
      }
      setCargando(false)
    }, 250)
    return () => clearTimeout(reloj)
  }, [pedido, reporte])

  async function exportar(formato: FormatoDeReporte) {
    if (!reporte) return
    setExportando(formato)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.reportes.exportar(pedido, formato, null)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Guardado en ${resultado.datos.ruta}`)
    setExportando(null)
  }

  if (!reporte) return <div className="p-8">No hay reportes disponibles.</div>

  const elegidas = columnas.length > 0 ? columnas : reporte.columnas.map((columna) => columna.id)

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-6">
      <aside className="w-64 shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-suave">
        <h2 className="border-b border-slate-200 px-4 py-3 font-display text-sm font-bold tracking-tight text-slate-900">Módulo</h2>
        <ul className="p-2">
          {catalogo.reportes.map((candidato) => (
            <li key={candidato.id}>
              <button
                type="button"
                onClick={() => elegirReporte(candidato.id)}
                aria-current={candidato.id === reporte.id}
                className={cx(
                  'w-full rounded-lg px-3 py-2 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                  candidato.id === reporte.id ? 'bg-marino-50 text-marino-800' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="block text-sm font-semibold">{candidato.nombre}</span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">{candidato.descripcion}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        <Tarjeta className="shrink-0" titulo={reporte.nombre} descripcion={reporte.descripcion}>
          <FiltrosDelReporte reporte={reporte} catalogo={catalogo} filtros={filtros} alCambiar={setFiltros} />
        </Tarjeta>

        <Tarjeta
          className="shrink-0"
          titulo="Columnas"
          descripcion={`${elegidas.length} de ${reporte.columnas.length} van al archivo, en este orden.`}
          acciones={
            <>
              <Boton tamano="sm" onClick={() => setColumnas([])}>
                Todas
              </Boton>
              <Boton
                tamano="sm"
                onClick={() => setColumnas(reporte.columnas.slice(0, 6).map((columna) => columna.id))}
                disabled={reporte.columnas.length <= 6}
              >
                Sólo las primeras
              </Boton>
            </>
          }
        >
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {reporte.columnas.map((columna) => {
              const marcada = elegidas.includes(columna.id)
              return (
                <label key={columna.id} className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={marcada}
                    // La última que queda no se puede destildar: un archivo sin columnas no es un archivo.
                    disabled={marcada && elegidas.length === 1}
                    onChange={() =>
                      setColumnas(
                        // Se rearma en el orden del reporte, no en el orden en que se fue tildando.
                        reporte.columnas
                          .map((candidata) => candidata.id)
                          .filter((id) => (id === columna.id ? !marcada : elegidas.includes(id))),
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300 text-marino-700 focus-visible:ring-2 focus-visible:ring-marino-500/40 disabled:opacity-50"
                  />
                  {columna.titulo}
                </label>
              )
            })}
          </div>
        </Tarjeta>

        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}

        <Tarjeta
          className="shrink-0"
          titulo="Vista previa"
          descripcion={
            vista
              ? vista.total === 0
                ? 'No hay filas con esos filtros.'
                : `${vista.total.toLocaleString('es-AR')} fila(s); se muestran las primeras ${vista.mostradas}.`
              : 'Calculando…'
          }
          acciones={
            <>
              <Boton
                variante="primario"
                icono="descargar"
                onClick={() => void exportar('xlsx')}
                cargando={exportando === 'xlsx'}
                disabled={!vista || vista.total === 0 || exportando !== null}
              >
                Exportar a Excel
              </Boton>
              <Boton
                icono="impresora"
                onClick={() => void exportar('pdf')}
                cargando={exportando === 'pdf'}
                disabled={!vista || vista.total === 0 || exportando !== null}
              >
                Exportar a PDF
              </Boton>
            </>
          }
          alRas
        >
          <div className="max-h-96 overflow-auto border-t border-slate-200">
            {cargando && !vista ? (
              <Cargando texto="Buscando las filas…" />
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200">
                    {(vista?.columnas ?? []).map((columna) => (
                      <th
                        key={columna.id}
                        className={cx(
                          'px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] whitespace-nowrap text-slate-500',
                          columna.numerica ? 'text-right' : 'text-left',
                        )}
                      >
                        {columna.titulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(vista?.filas ?? []).length === 0 && (
                    <tr>
                      <td colSpan={Math.max(vista?.columnas.length ?? 1, 1)} className="px-3 py-12 text-center text-slate-500">
                        No hay filas con esos filtros.
                      </td>
                    </tr>
                  )}
                  {(vista?.filas ?? []).map((fila, indice) => (
                    <tr key={indice} className="border-b border-slate-100 last:border-b-0">
                      {fila.map((celda, columna) => (
                        <td
                          key={columna}
                          className={cx(
                            'max-w-[24rem] truncate px-3 py-1.5 text-slate-700',
                            vista?.columnas[columna]?.numerica && 'text-right tabular-nums',
                          )}
                          title={celda}
                        >
                          {celda}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Tarjeta>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

interface PropsFiltros {
  reporte: DefinicionDeReporte
  catalogo: CatalogoDeReportes
  filtros: FiltrosDeReporte
  alCambiar: (filtros: FiltrosDeReporte) => void
}

function FiltrosDelReporte({ reporte, catalogo, filtros, alCambiar }: PropsFiltros) {
  const cambiar = (campo: keyof FiltrosDeReporte, valor: string) => alCambiar({ ...filtros, [campo]: valor })
  const cambiarLista = (campo: 'sucursales' | 'companias' | 'estados', valores: string[]) => alCambiar({ ...filtros, [campo]: valores })
  const control = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800'
  const etiqueta = 'block text-xs font-semibold text-slate-600'

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {reporte.filtros.includes('periodo') && (
        <label className={etiqueta}>
          Mes
          <select value={filtros.periodo} onChange={(e) => cambiar('periodo', e.target.value)} className={`mt-1 ${control}`}>
            <option value="">{reporte.id === 'cartera' ? 'El mes abierto' : 'Todos'}</option>
            {catalogo.periodos.map((periodo) => (
              <option key={periodo} value={periodo}>
                {nombreDePeriodo(periodo)}
              </option>
            ))}
          </select>
        </label>
      )}
      {reporte.filtros.includes('fechas') && (
        <>
          <label className={etiqueta}>
            Desde
            <input type="date" value={filtros.desde} onChange={(e) => cambiar('desde', e.target.value)} className={`mt-1 ${control}`} />
          </label>
          <label className={etiqueta}>
            Hasta
            <input type="date" value={filtros.hasta} onChange={(e) => cambiar('hasta', e.target.value)} className={`mt-1 ${control}`} />
          </label>
        </>
      )}
      {reporte.filtros.includes('sucursal') && (
        <div className={etiqueta}>
          Sucursal
          <FiltroMultiple
            etiqueta="Sucursal"
            valores={filtros.sucursales}
            opciones={catalogo.sucursales}
            alCambiar={(v) => cambiarLista('sucursales', v)}
            className="mt-1"
          />
        </div>
      )}
      {reporte.filtros.includes('compania') && (
        <div className={etiqueta}>
          Compañía
          <FiltroMultiple
            etiqueta="Compañía"
            valores={filtros.companias}
            opciones={catalogo.companias}
            alCambiar={(v) => cambiarLista('companias', v)}
            className="mt-1"
          />
        </div>
      )}
      {reporte.filtros.includes('estado') && reporte.estados.length > 0 && (
        <div className={etiqueta}>
          {reporte.etiquetaDeEstado}
          <FiltroMultiple
            etiqueta={reporte.etiquetaDeEstado}
            valores={filtros.estados}
            opciones={reporte.estados}
            plural="todos"
            alCambiar={(v) => cambiarLista('estados', v)}
            className="mt-1"
          />
        </div>
      )}
      {reporte.filtros.includes('busqueda') && (
        <label className={etiqueta}>
          Buscar
          <input
            type="search"
            value={filtros.busqueda}
            onChange={(e) => cambiar('busqueda', e.target.value)}
            placeholder="Nombre, DNI, póliza o patente"
            className={`mt-1 ${control}`}
          />
        </label>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Planilla clásica
// ---------------------------------------------------------------------------

function PlanillaClasica({ catalogo }: { catalogo: CatalogoDeReportes }) {
  const [elegidos, setElegidos] = useState<string[]>(catalogo.periodos.slice(0, 1))
  const [sucursales, setSucursales] = useState<string[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function exportar() {
    setGuardando(true)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.reportes.planillaClasica({ periodos: elegidos, sucursales }, null)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`Guardado en ${resultado.datos.ruta}`)
    setGuardando(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <Tarjeta
        className="shrink-0"
        titulo="Planilla clásica"
        descripcion="Un .xlsx con el formato exacto de la hoja mensual de siempre: las mismas columnas y en el mismo orden, una pestaña por mes elegido y su pestaña de BAJAS al lado. Es lo que se imprime y lo que se le manda al contador."
        acciones={
          <Boton variante="primario" icono="descargar" onClick={() => void exportar()} cargando={guardando} disabled={elegidos.length === 0}>
            Generar el archivo
          </Boton>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <fieldset>
            <legend className="text-xs font-semibold text-slate-600">Meses ({elegidos.length} elegido(s))</legend>
            {catalogo.periodos.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                Todavía no hay ninguna planilla cargada. Reimportá la base desde Administración y volvé.
              </p>
            ) : (
              <div className="mt-2 flex max-h-56 flex-wrap gap-x-5 gap-y-2 overflow-y-auto">
                {catalogo.periodos.map((periodo) => (
                  <label key={periodo} className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={elegidos.includes(periodo)}
                      onChange={() =>
                        setElegidos((previos) =>
                          previos.includes(periodo) ? previos.filter((p) => p !== periodo) : [...previos, periodo],
                        )
                      }
                      className="h-4 w-4 rounded border-slate-300 text-marino-700 focus-visible:ring-2 focus-visible:ring-marino-500/40"
                    />
                    {nombreDePeriodo(periodo)}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="block text-xs font-semibold text-slate-600">
            Sucursal
            <FiltroMultiple
              etiqueta="Sucursal"
              valores={sucursales}
              opciones={catalogo.sucursales}
              alCambiar={setSucursales}
              className="mt-1"
            />
            <span className="mt-2 block text-xs leading-relaxed font-normal text-slate-500">
              Con sucursales elegidas la planilla sale con las filas de esos locales nada más, y el nombre del archivo las dice.
            </span>
          </div>
        </div>
      </Tarjeta>

      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <Alerta tono="info">
        Este archivo se genera a partir de lo que hay hoy en DM Gestión, que es lo mismo que hay en la base del VPS: los cambios que todavía no
        se subieron ya están acá. No toca la base ni la hoja de Google: es una copia para imprimir o mandar.
      </Alerta>
    </div>
  )
}
