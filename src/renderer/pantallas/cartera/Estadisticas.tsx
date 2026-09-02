// Cartera → Estadísticas: los mismos números del módulo Métricas, pero en tabla.
//
// Existe para una cosa muy concreta: poner esta pantalla al lado de la hoja de Google y comprobar,
// fila por fila, que los activos por compañía coinciden con los COUNTIF de SEGUROS ACT. Por eso es
// tabular, sin gráficos y con los totales abajo: para comparar, no para mirar.
import { useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import type { EstadisticasDeCartera, FilaEstadistica } from '../../../shared/tipos'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { Alerta, Cargando, cx } from '../../componentes/ui'
import { numero, pesos } from '../cobranzas/formato'

export function Estadisticas() {
  const [datos, setDatos] = useState<EstadisticasDeCartera | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async (periodo: string | null, sucursales: string[]) => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.metricas.estadisticas(periodo, sucursales)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(null, [])
  }, [cargar])

  if (cargando && !datos) return <Cargando texto="Calculando las estadísticas…" />
  if (!datos) {
    return (
      <div className="p-8">
        <Alerta tono="error">{error ?? 'No se pudieron calcular las estadísticas.'}</Alerta>
      </div>
    )
  }

  const seleccion = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select value={datos.periodo} onChange={(e) => void cargar(e.target.value, datos.sucursalesElegidas)} className={`ml-2 ${seleccion}`}>
            {datos.periodos.length === 0 && <option value={datos.periodo}>{nombreDePeriodo(datos.periodo)}</option>}
            {datos.periodos.map((periodo) => (
              <option key={periodo} value={periodo}>
                {nombreDePeriodo(periodo)}
              </option>
            ))}
          </select>
        </label>
        <FiltroMultiple
          etiqueta="Sucursal"
          valores={datos.sucursalesElegidas}
          opciones={datos.sucursales}
          alCambiar={(v) => void cargar(datos.periodo, v)}
        />
        {cargando && <span className="text-xs text-slate-500">Actualizando…</span>}
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {!datos.hayMesAnterior && (
        <Alerta tono="info">
          Sin el mes anterior cargado no se pueden deducir las altas: la columna queda en cero hasta que se importe.
        </Alerta>
      )}

      <TablaDeEstadisticas
        titulo="Por compañía"
        encabezadoDeFila="Compañía"
        filas={datos.porCompania}
        totales={datos.totales}
        vacio={`No hay pólizas en la planilla de ${nombreDePeriodo(datos.periodo)}.`}
      />
      <TablaDeEstadisticas
        titulo="Por sucursal"
        encabezadoDeFila="Sucursal"
        filas={datos.porSucursal}
        totales={datos.totales}
        vacio={`No hay pólizas en la planilla de ${nombreDePeriodo(datos.periodo)}.`}
      />

      <p className="shrink-0 text-xs leading-relaxed text-slate-500">
        <strong className="font-semibold text-slate-600">Activos</strong> son las filas de la planilla del mes que no están dadas de
        baja —lo mismo que cuenta SEGUROS ACT—. <strong className="font-semibold text-slate-600">Altas</strong> son las que están este
        mes y no estaban el anterior. <strong className="font-semibold text-slate-600">Bajas</strong> salen de la pestaña de bajas de
        ese mes. <strong className="font-semibold text-slate-600">Pagos</strong> son los cobros imputados a ese mes.
      </p>
    </div>
  )
}

interface PropsTabla {
  titulo: string
  encabezadoDeFila: string
  filas: FilaEstadistica[]
  totales: FilaEstadistica
  vacio: string
}

function TablaDeEstadisticas({ titulo, encabezadoDeFila, filas, totales, vacio }: PropsTabla) {
  // La columna de plata sólo existe si el proceso principal la mandó: a un empleado le llega en null.
  const conCobrado = totales.cobrado !== null

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'
  return (
    <section className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-suave">
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 className="font-display text-base font-bold tracking-tight text-slate-900">{titulo}</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>{encabezadoDeFila}</th>
              <th className={cx(encabezado, 'text-right')}>Activos</th>
              <th className={cx(encabezado, 'text-right')}>Altas</th>
              <th className={cx(encabezado, 'text-right')}>Bajas</th>
              <th className={cx(encabezado, 'text-right')}>Pagos</th>
              {conCobrado && <th className={cx(encabezado, 'text-right')}>Cobrado</th>}
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={conCobrado ? 6 : 5} className="px-3 py-10 text-center text-slate-500">
                  {vacio}
                </td>
              </tr>
            )}
            {filas.map((fila) => (
              <tr key={fila.etiqueta} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 font-medium text-slate-900">{fila.etiqueta}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{numero(fila.activos)}</td>
                <td className={cx('px-3 py-2 text-right tabular-nums', fila.altas > 0 ? 'text-green-700' : 'text-slate-300')}>
                  {fila.altas > 0 ? numero(fila.altas) : '—'}
                </td>
                <td className={cx('px-3 py-2 text-right tabular-nums', fila.bajas > 0 ? 'text-red-700' : 'text-slate-300')}>
                  {fila.bajas > 0 ? numero(fila.bajas) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{numero(fila.pagos)}</td>
                {fila.cobrado !== null && <td className="px-3 py-2 text-right tabular-nums text-slate-900">{pesos(fila.cobrado)}</td>}
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-900">Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{numero(totales.activos)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{numero(totales.altas)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{numero(totales.bajas)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{numero(totales.pagos)}</td>
                {totales.cobrado !== null && <td className="px-3 py-2 text-right tabular-nums text-slate-900">{pesos(totales.cobrado)}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}
