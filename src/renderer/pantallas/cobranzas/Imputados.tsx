// Imputados: la rendición mensual contra las compañías. Es el equivalente de la hoja IMPUTADOS —
// por cada pago del mes, qué dijo la compañía— y el RESULTADO se sincroniza con la hoja.
//
// La misma pantalla se ve en Cobranzas → Imputados y en Cartera → Imputados.
import { useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import {
  NOMBRE_RESULTADO_IMPUTACION,
  RESULTADOS_DE_IMPUTACION,
  type PagoRegistrado,
  type RendicionImputados,
  type ResultadoImputacion,
} from '../../../shared/tipos'
import { Alerta, Cargando, cx } from '../../componentes/ui'
import { usePermisos } from '../../contexto/Permisos'
import { EstadoDelCobro } from './CajaDelDia'
import { numero, pesos } from './formato'

const CLASES_RESULTADO: Record<ResultadoImputacion, string> = {
  '': 'border-slate-300 bg-white text-slate-600',
  IMPUTADO: 'border-marino-300 bg-marino-50 text-marino-800 font-semibold',
  OK: 'border-green-300 bg-green-50 text-green-800 font-semibold',
  REVISAR: 'border-amber-300 bg-amber-50 text-amber-900 font-semibold',
  MAL: 'border-red-300 bg-red-50 text-red-800 font-semibold',
}

export function Imputados() {
  // La rendición se mira desde Cartera y desde Cobranzas: alcanza con poder editar cualquiera.
  const { puedeEditar } = usePermisos()
  const puedeImputar = puedeEditar('cartera') || puedeEditar('cobranzas')
  const [datos, setDatos] = useState<RendicionImputados | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<number | null>(null)

  const cargar = useCallback(async (periodo: string | null, compania: string) => {
    setCargando(true)
    setError(null)
    const resultado = await window.dm.cobranzas.imputados(periodo, compania)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(null, '')
  }, [cargar])

  const cambiar = async (pago: PagoRegistrado, resultado: ResultadoImputacion) => {
    if (!datos) return
    setGuardando(pago.id)
    setError(null)
    const respuesta = await window.dm.cobranzas.cambiarResultado(pago.id, resultado, datos.compania)
    setGuardando(null)
    if (respuesta.ok) setDatos(respuesta.datos)
    else setError(respuesta.error)
  }

  if (cargando && !datos) return <Cargando texto="Armando la rendición…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  if (datos.periodos.length === 0) {
    return (
      <div className="p-8">
        <Alerta tono="info">
          Todavía no hay pagos cargados. Se van sumando solos al registrar cobros desde la Cartera o desde la caja del día, y también
          al importar la pestaña IMPUTADOS de la base.
        </Alerta>
      </div>
    )
  }

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Mes
          <select
            value={datos.periodo}
            onChange={(evento) => void cargar(evento.target.value, datos.compania)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            {datos.periodos.map((periodo) => (
              <option key={periodo} value={periodo}>
                {nombreDePeriodo(periodo)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Compañía
          <select
            value={datos.compania}
            onChange={(evento) => void cargar(datos.periodo, evento.target.value)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            <option value="">Todas</option>
            {datos.companias.map((compania) => (
              <option key={compania} value={compania}>
                {compania}
              </option>
            ))}
          </select>
        </label>
        {datos.sucursal && (
          <span
            className="inline-flex h-9 items-center rounded-full border border-slate-300 bg-slate-100 px-2.5 text-xs font-semibold text-slate-600"
            title="La rendición de las otras sucursales la ven los administradores."
          >
            Sólo {datos.sucursal}
          </span>
        )}
        <span className="ml-auto text-sm text-slate-500">
          {numero(datos.total)} pagos · {pesos(datos.totalImporte)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Contador etiqueta="Pendientes" valor={datos.pendientes} destacada={datos.pendientes > 0} />
        {(['IMPUTADO', 'OK', 'REVISAR', 'MAL'] as const).map((resultado) => (
          <Contador key={resultado} etiqueta={NOMBRE_RESULTADO_IMPUTACION[resultado]} valor={datos.contadores[resultado]} />
        ))}
        {datos.sinCobrar > 0 && <Contador etiqueta="Sin cobrar al cliente" valor={datos.sinCobrar} destacada />}
      </div>

      {datos.avisoDeSincronizacion && <Alerta tono="aviso">{datos.avisoDeSincronizacion}</Alerta>}
      {datos.sinMes > 0 && (
        <Alerta tono="aviso">
          {datos.sinMes === 1
            ? 'Hay 1 pago de la planilla sin fecha ni MES que se puedan leer: no entra en ninguna rendición.'
            : `Hay ${numero(datos.sinMes)} pagos de la planilla sin fecha ni MES que se puedan leer: no entran en ninguna rendición.`}{' '}
          Corregí la columna FECHA o la columna MES de esas filas en la pestaña IMPUTADOS y volvé a importar.
        </Alerta>
      )}
      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>Fecha</th>
              <th className={encabezado}>Cliente</th>
              <th className={encabezado}>DNI/CUIT</th>
              <th className={encabezado}>Compañía</th>
              <th className={encabezado}>Póliza</th>
              <th className={cx(encabezado, 'text-right')}>Importe</th>
              <th className={encabezado}>Medio</th>
              <th className={encabezado}>Origen</th>
              <th className={encabezado}>Cobro</th>
              <th className={encabezado}>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {datos.pagos.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-slate-500">
                  No hay pagos de {nombreDePeriodo(datos.periodo)}
                  {datos.compania ? ` de ${datos.compania}` : ''}.
                </td>
              </tr>
            )}
            {datos.pagos.map((pago) => (
              <tr key={pago.id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{pago.fecha ?? pago.fechaIso ?? '—'}</td>
                <td className="px-3 py-2 font-medium text-slate-900">{pago.clienteNombre ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{pago.documento ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{pago.compania ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{pago.numeroPoliza ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                  {pago.importeMonto === null ? (pago.importe ?? '—') : pesos(pago.importeMonto)}
                </td>
                <td className="px-3 py-2 text-slate-700">{pago.medio ?? <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{pago.hechoEnLaApp ? (pago.usuarioNombre ?? 'DM Gestión') : 'de la planilla'}</td>
                <td className="px-3 py-2">
                  <EstadoDelCobro pago={pago} />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={pago.resultado}
                    disabled={guardando === pago.id || !puedeImputar}
                    aria-label={`Resultado de ${pago.clienteNombre ?? 'el pago'}`}
                    onChange={(evento) => void cambiar(pago, evento.target.value as ResultadoImputacion)}
                    className={cx('h-8 rounded-lg border px-2 text-xs disabled:opacity-50', CLASES_RESULTADO[pago.resultado])}
                  >
                    {RESULTADOS_DE_IMPUTACION.map((resultado) => (
                      <option key={resultado || 'pendiente'} value={resultado}>
                        {NOMBRE_RESULTADO_IMPUTACION[resultado]}
                      </option>
                    ))}
                  </select>
                  {pago.resultado === '' && pago.resultadoTexto && (
                    <p className="mt-0.5 text-[11px] text-slate-500">en la planilla dice «{pago.resultadoTexto}»</p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Contador({ etiqueta, valor, destacada }: { etiqueta: string; valor: number; destacada?: boolean }) {
  return (
    <div className={cx('rounded-lg border px-3 py-1.5', destacada ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-900')}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="font-display text-lg font-extrabold tabular-nums">{numero(valor)}</span>
    </div>
  )
}
