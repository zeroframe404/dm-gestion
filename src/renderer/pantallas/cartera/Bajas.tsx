// Bajas del mes elegido, igual que la hoja BAJAS: quién se fue, por qué y cuándo.
import { useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { NOMBRE_MOTIVO_BAJA, type FilaBaja, type MotivoDeBaja, type PeriodoCartera } from '../../../shared/tipos'
import { Alerta, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'
import { useUsuarioActual } from '../../contexto/Sesion'

export function Bajas() {
  const usuario = useUsuarioActual()
  const puedeEditarCartera = usePuedeEditar('cartera')
  const puedeDeshacer = usuario.rol !== 'EMPLEADO' && puedeEditarCartera

  const [periodos, setPeriodos] = useState<PeriodoCartera[]>([])
  const [periodo, setPeriodo] = useState<string | null>(null)
  const [filas, setFilas] = useState<FilaBaja[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async (elegido: string | null) => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.cartera.bajas(elegido)
    if (resultado.ok) setFilas(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    let vigente = true
    void window.dm.cartera.planilla(null).then((resultado) => {
      if (!vigente) return
      if (resultado.ok) {
        setPeriodos(resultado.datos.periodos)
        const inicial = resultado.datos.periodo
        setPeriodo(inicial)
        void cargar(inicial)
      } else {
        setError(resultado.error)
        setCargando(false)
      }
    })
    return () => {
      vigente = false
    }
  }, [cargar])

  const deshacer = async (baja: FilaBaja) => {
    const resultado = await window.dm.cartera.deshacerBaja(baja.id)
    if (resultado.ok) setFilas(resultado.datos)
    else setError(resultado.error)
  }

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select
            value={periodo ?? ''}
            onChange={(evento) => {
              setPeriodo(evento.target.value)
              void cargar(evento.target.value)
            }}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            {periodos.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {nombreDePeriodo(p.periodo)}
              </option>
            ))}
          </select>
        </label>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Bajas del mes</span>
          <span className="ml-2 font-display text-lg font-extrabold tabular-nums text-slate-900">{filas.length.toLocaleString('es-AR')}</span>
        </div>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {cargando ? (
        <Cargando />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className={encabezado}>Nombre</th>
                <th className={encabezado}>DNI/CUIT</th>
                <th className={encabezado}>Compañía</th>
                <th className={encabezado}>Póliza</th>
                <th className={encabezado}>Patente</th>
                <th className={encabezado}>Sucursal</th>
                <th className={encabezado}>Motivo</th>
                <th className={encabezado}>Fecha</th>
                <th className={encabezado} />
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                    No hay bajas cargadas en {periodo ? nombreDePeriodo(periodo) : 'este mes'}.
                  </td>
                </tr>
              )}
              {filas.map((baja) => (
                <tr key={baja.id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 font-medium text-slate-900">{baja.clienteNombre ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{baja.documento ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{baja.compania ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{baja.numeroPoliza ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{baja.patente ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{baja.sucursal ?? '—'}</td>
                  <td className={cx('px-3 py-2 text-slate-700')}>
                    {baja.motivo ? (NOMBRE_MOTIVO_BAJA[baja.motivo as MotivoDeBaja] ?? baja.motivo) : <span className="text-slate-400">sin motivo</span>}
                    {baja.nota && <p className="text-xs text-slate-500">{baja.nota}</p>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{baja.fechaBaja ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {baja.hechaEnLaApp ? (
                      puedeDeshacer ? (
                        <Boton tamano="sm" variante="fantasma" onClick={() => void deshacer(baja)}>
                          Deshacer
                        </Boton>
                      ) : (
                        <Etiqueta tono="neutro">En la app</Etiqueta>
                      )
                    ) : (
                      <Etiqueta tono="neutro">De la hoja</Etiqueta>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
