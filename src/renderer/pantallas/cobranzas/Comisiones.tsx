// Comisiones: por mes y compañía, cuánto se cobró y cuánta comisión deja. Es una estimación —la
// liquidación de verdad la manda cada compañía—, y el porcentaje se carga en Administración → Compañías.
import { useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import type { ResumenComisiones } from '../../../shared/tipos'
import { Alerta, Cargando, cx } from '../../componentes/ui'
import { momento, numero, pesos } from './formato'

export function Comisiones() {
  const [datos, setDatos] = useState<ResumenComisiones | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async (periodo: string | null) => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.cobranzas.comisiones(periodo)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(null)
  }, [cargar])

  if (cargando && !datos) return <Cargando texto="Calculando las comisiones…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select
            value={datos.periodo}
            onChange={(evento) => void cargar(evento.target.value)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            {datos.periodos.length === 0 && <option value={datos.periodo}>{nombreDePeriodo(datos.periodo)}</option>}
            {datos.periodos.map((periodo) => (
              <option key={periodo} value={periodo}>
                {nombreDePeriodo(periodo)}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex gap-2">
          <Tarjeta etiqueta="Cobrado en el mes" valor={pesos(datos.cobrado)} />
          <Tarjeta etiqueta="Comisión estimada" valor={pesos(datos.comision)} destacada />
        </div>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {datos.calculadoEn && (
        <p className="-mt-1 text-xs text-slate-500">
          Calculado por el servidor el {momento(datos.calculadoEn)}
          {datos.recibidoEnEstaComputadora && <> · recibido acá el {momento(datos.recibidoEnEstaComputadora)}</>}.
          {datos.frescura && datos.frescura !== 'AL_DIA' && (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-800">
              Sin conexión con el servidor: mostrando el último cálculo recibido.
            </span>
          )}
        </p>
      )}
      {datos.sinPorcentaje.length > 0 && (
        <Alerta tono="aviso">
          Sin porcentaje de comisión cargado: {datos.sinPorcentaje.join(', ')}. Cargalo en{' '}
          <strong className="font-semibold">Administración → Compañías</strong> para que entren en el cálculo.
        </Alerta>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>Compañía</th>
              <th className={cx(encabezado, 'text-right')}>Pagos</th>
              <th className={cx(encabezado, 'text-right')}>Cobrado</th>
              <th className={cx(encabezado, 'text-right')}>Comisión</th>
              <th className={cx(encabezado, 'text-right')}>Estimada</th>
            </tr>
          </thead>
          <tbody>
            {datos.filas.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-12 text-center text-slate-500">
                  No hay cobranza registrada en {nombreDePeriodo(datos.periodo)}.
                </td>
              </tr>
            )}
            {datos.filas.map((fila) => (
              <tr key={fila.compania} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 font-medium text-slate-900">{fila.compania}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{numero(fila.pagos)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{pesos(fila.cobrado)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                  {fila.porcentaje > 0 ? `${fila.porcentaje.toLocaleString('es-AR')} %` : <span className="text-slate-400">sin cargar</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                  {fila.porcentaje > 0 ? pesos(fila.comision) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          {datos.filas.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-900">Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{numero(datos.filas.reduce((suma, f) => suma + f.pagos, 0))}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{pesos(datos.cobrado)}</td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{pesos(datos.comision)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-slate-500">
        La comisión se estima sobre lo efectivamente cobrado en el mes, con el porcentaje de cada compañía. La liquidación real la
        manda la compañía y puede diferir.
      </p>
    </div>
  )
}

function Tarjeta({ etiqueta, valor, destacada }: { etiqueta: string; valor: string; destacada?: boolean }) {
  return (
    <div className={cx('rounded-lg border px-3 py-1.5', destacada ? 'border-marino-200 bg-marino-50 text-marino-900' : 'border-slate-200 bg-white text-slate-900')}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="font-display text-lg font-extrabold tabular-nums">{valor}</span>
    </div>
  )
}
