// Cartera → Estadísticas: los mismos números del módulo Métricas, pero en tabla.
//
// Existe para una cosa muy concreta: poner esta pantalla al lado de la hoja de Google y comprobar,
// fila por fila, que los activos por compañía coinciden con los COUNTIF de SEGUROS ACT. Por eso es
// tabular, sin gráficos y con los totales abajo: para comparar, no para mirar.
import { Fragment, useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { NOMBRE_RAMA_DE_METRICA, type EstadisticasDeCartera, type FilaEstadistica, type ResumenDeCartera } from '../../../shared/tipos'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { Alerta, Cargando, cx } from '../../componentes/ui'
import { momento, numero, pesos } from '../cobranzas/formato'

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
          Sin el mes anterior cargado no se pueden deducir las altas: la columna muestra un guion hasta que se importe.
        </Alerta>
      )}
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

      <ResumenCartera resumen={datos.resumenCartera} />

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
        baja —lo mismo que cuenta SEGUROS ACT—, más los riesgos varios de la pestaña RIESGOS VARIOS cuya vigencia cubre el mes.{' '}
        <strong className="font-semibold text-slate-600">Altas</strong> son las que están este mes y no estaban el anterior: una
        renovación no cuenta, porque el cliente ya estaba y la cartera no creció. Un riesgo vario de la pestaña RIESGOS VARIOS es alta en
        el mes de su emisión.{' '}
        <strong className="font-semibold text-slate-600">Bajas</strong> salen de la pestaña de bajas de ese mes.{' '}
        <strong className="font-semibold text-slate-600">Pagos</strong> son los cobros imputados a ese mes.
      </p>
    </div>
  )
}

/**
 * El estado de toda la cartera, sin filtrar por mes ni sucursal: cada póliza en una sola de las tres
 * columnas. Va aparte de la tabla de abajo a propósito —esa es la reconciliación mes a mes contra la
 * hoja de Google, y mezclar ahí un total de toda la cartera la haría dar otro número—.
 */
function ResumenCartera({ resumen }: { resumen: ResumenDeCartera }) {
  const tarjetas: Array<{ etiqueta: string; valor: number; nota: string; tono: string }> = [
    { etiqueta: 'Activas', valor: resumen.activas, nota: 'En vigencia y sin baja.', tono: 'text-emerald-700' },
    {
      etiqueta: 'Fuera de vigencia',
      valor: resumen.fueraDeVigencia,
      nota: 'Vencidas, todavía sin dar de baja.',
      tono: 'text-amber-700',
    },
    { etiqueta: 'Dadas de baja', valor: resumen.dadasDeBaja, nota: 'Histórico de bajas de la cartera.', tono: 'text-red-700' },
  ]
  return (
    <section className="shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-suave">
      <header className="border-b border-slate-200 px-4 py-3">
        <h2 className="font-display text-base font-bold tracking-tight text-slate-900">Toda la cartera, por estado</h2>
        <p className="text-xs text-slate-500">Cada póliza cuenta una sola vez: activa, fuera de vigencia o dada de baja.</p>
      </header>
      <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {tarjetas.map((tarjeta) => (
          <div key={tarjeta.etiqueta} className="flex flex-col gap-1 px-4 py-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{tarjeta.etiqueta}</span>
            <span className={cx('text-2xl font-bold tabular-nums', tarjeta.tono)}>{numero(tarjeta.valor)}</span>
            <span className="text-xs text-slate-500">{tarjeta.nota}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

interface PropsTabla {
  titulo: string
  encabezadoDeFila: string
  filas: FilaEstadistica[]
  totales: FilaEstadistica
  vacio: string
}

/** Las tres cifras que se separan por rama, en el orden de las columnas. */
const CIFRAS_POR_RAMA = [
  { campo: 'activos', titulo: 'Activos' },
  { campo: 'altas', titulo: 'Altas' },
  { campo: 'bajas', titulo: 'Bajas' },
] as const

type CampoPorRama = (typeof CIFRAS_POR_RAMA)[number]['campo']

/**
 * Una cifra de una fila: los activos siempre con su número; las altas en verde y las bajas en rojo, y
 * en cero o sin dato con un guion gris, que en una columna larga se saltea más rápido que un cero.
 */
function Cifra({ campo, valor, sutil = false }: { campo: CampoPorRama; valor: number | null; sutil?: boolean }) {
  if (campo === 'activos') {
    return <td className={cx('px-3 py-2 text-right tabular-nums', sutil ? 'text-slate-600' : 'text-slate-900')}>{numero(valor ?? 0)}</td>
  }
  const hayAlgo = valor !== null && valor > 0
  const tono = !hayAlgo ? 'text-slate-300' : campo === 'altas' ? 'text-green-700' : 'text-red-700'
  return <td className={cx('px-3 py-2 text-right tabular-nums', tono, sutil && hayAlgo && 'opacity-80')}>{hayAlgo ? numero(valor) : '—'}</td>
}

function TablaDeEstadisticas({ titulo, encabezadoDeFila, filas, totales, vacio }: PropsTabla) {
  // La columna de plata sólo existe si el proceso principal la mandó: a un empleado le llega en null.
  const conCobrado = totales.cobrado !== null
  // Activos, altas y bajas se abren en autos y motos y riesgos varios sólo si el cálculo trae la
  // separación: uno guardado por una versión anterior del servidor no la tiene, y ahí la tabla es la de
  // siempre en vez de mostrar columnas en cero.
  const porRama = totales.porRama
  const columnas = 1 + CIFRAS_POR_RAMA.length * (porRama ? 3 : 1) + 1 + (conCobrado ? 1 : 0)
  const filasDeEncabezado = porRama ? 2 : 1

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
              <th rowSpan={filasDeEncabezado} className={encabezado}>
                {encabezadoDeFila}
              </th>
              {CIFRAS_POR_RAMA.map(({ campo, titulo: tituloDeCifra }) => (
                <th
                  key={campo}
                  colSpan={porRama ? 3 : 1}
                  className={cx(encabezado, porRama ? 'border-l border-slate-200 text-center' : 'text-right')}
                >
                  {tituloDeCifra}
                </th>
              ))}
              <th rowSpan={filasDeEncabezado} className={cx(encabezado, 'text-right', porRama && 'border-l border-slate-200')}>
                Pagos
              </th>
              {conCobrado && (
                <th rowSpan={filasDeEncabezado} className={cx(encabezado, 'text-right')}>
                  Cobrado
                </th>
              )}
            </tr>
            {porRama && (
              <tr className="border-b border-slate-200">
                {CIFRAS_POR_RAMA.map(({ campo }) => (
                  <Fragment key={campo}>
                    <th className={cx(encabezado, 'border-l border-slate-200 text-right')}>Total</th>
                    <th className={cx(encabezado, 'text-right normal-case tracking-normal')}>{NOMBRE_RAMA_DE_METRICA.AUTOS_MOTOS}</th>
                    <th className={cx(encabezado, 'text-right normal-case tracking-normal')}>{NOMBRE_RAMA_DE_METRICA.RIESGOS_VARIOS}</th>
                  </Fragment>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr>
                <td colSpan={columnas} className="px-3 py-10 text-center text-slate-500">
                  {vacio}
                </td>
              </tr>
            )}
            {filas.map((fila) => (
              <tr key={fila.etiqueta} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 font-medium text-slate-900">{fila.etiqueta}</td>
                {CIFRAS_POR_RAMA.map(({ campo }) => (
                  <Fragment key={campo}>
                    <Cifra campo={campo} valor={fila[campo]} />
                    {porRama && (
                      <>
                        <Cifra campo={campo} valor={fila.porRama?.autosMotos[campo] ?? null} sutil />
                        <Cifra campo={campo} valor={fila.porRama?.riesgosVarios[campo] ?? null} sutil />
                      </>
                    )}
                  </Fragment>
                ))}
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{numero(fila.pagos)}</td>
                {fila.cobrado !== null && <td className="px-3 py-2 text-right tabular-nums text-slate-900">{pesos(fila.cobrado)}</td>}
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                <td className="px-3 py-2 text-slate-900">Total</td>
                {CIFRAS_POR_RAMA.map(({ campo }) => (
                  <Fragment key={campo}>
                    {[totales[campo], ...(porRama ? [porRama.autosMotos[campo], porRama.riesgosVarios[campo]] : [])].map((valor, indice) => (
                      <td key={indice} className="px-3 py-2 text-right tabular-nums text-slate-900">
                        {valor === null ? '—' : numero(valor)}
                      </td>
                    ))}
                  </Fragment>
                ))}
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
