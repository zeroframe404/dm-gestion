// La caja del día: qué se cobró hoy en esta sucursal, con qué medio y quién lo cobró. Es la pantalla
// que se mira al cerrar el mostrador, así que el total por medio de pago va arriba de todo.
import { useCallback, useEffect, useState } from 'react'
import type { CajaDelDia as DatosDeCaja } from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'
import { DialogoPagoManual } from './DialogoPagoManual'
import { numero, pesos } from './formato'
import { usePuedeEditar } from '../../contexto/Permisos'

export function CajaDelDia() {
  const puedeEditar = usePuedeEditar('cobranzas')
  const usuario = useUsuarioActual()
  const [datos, setDatos] = useState<DatosDeCaja | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abrirPago, setAbrirPago] = useState(false)
  const [exportando, setExportando] = useState(false)

  const cargar = useCallback(async (fecha: string | null, sucursal: string) => {
    setCargando(true)
    setError(null)
    // El aviso es de una acción puntual («pago registrado», «el día se guardó en…»): al cambiar de
    // día o de sucursal ya no habla de lo que se está mirando.
    setAviso(null)
    const resultado = await window.dm.cobranzas.caja(fecha, sucursal)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  // La primera vez se abre en el día de hoy y en la sucursal de quien entró: es el caso normal.
  useEffect(() => {
    void cargar(null, usuario.sucursal.nombre)
  }, [cargar, usuario.sucursal.nombre])

  const exportar = async () => {
    if (!datos) return
    setExportando(true)
    setError(null)
    const resultado = await window.dm.cobranzas.exportarCaja(datos.fecha, datos.sucursal)
    setExportando(false)
    if (!resultado.ok) setError(resultado.error)
    else if (resultado.datos.ruta) setAviso(`El día se guardó en ${resultado.datos.ruta}`)
  }

  if (cargando && !datos) return <Cargando texto="Abriendo la caja…" />
  if (!datos) return <div className="p-8">{error && <Alerta tono="error">{error}</Alerta>}</div>

  const esHoy = datos.fecha === datos.hoy
  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-semibold text-slate-700">
          Día
          <input
            type="date"
            value={datos.fecha}
            max={datos.hoy}
            onChange={(evento) => void cargar(evento.target.value || datos.hoy, datos.sucursal)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Sucursal
          <select
            value={datos.sucursal}
            onChange={(evento) => void cargar(datos.fecha, evento.target.value)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          >
            <option value="">Todas</option>
            {datos.sucursales.map((sucursal) => (
              <option key={sucursal} value={sucursal}>
                {sucursal}
              </option>
            ))}
          </select>
        </label>
        {!esHoy && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 text-xs font-semibold text-slate-600">
            <Icono nombre="reloj" tamano={13} />
            Día anterior
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Boton icono="cargando" onClick={() => void cargar(datos.fecha, datos.sucursal)} disabled={cargando}>
            Actualizar
          </Boton>
          <Boton icono="descargar" onClick={() => void exportar()} cargando={exportando} disabled={datos.pagos.length === 0}>
            Exportar el día
          </Boton>
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setAbrirPago(true)}>
              Registrar pago
            </Boton>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Tarjeta etiqueta="Total del día" valor={pesos(datos.total)} destacada />
        <Tarjeta etiqueta="Pagos" valor={numero(datos.pagos.length)} />
        {datos.totalesPorMedio.map((total) => (
          <Tarjeta key={total.medio} etiqueta={total.medio} valor={pesos(total.total)} nota={`${numero(total.pagos)} pago(s)`} />
        ))}
      </div>

      {datos.sinImporte > 0 && (
        <Alerta tono="aviso">
          {datos.sinImporte === 1
            ? 'Hay 1 pago sin importe numérico: no suma al total.'
            : `Hay ${datos.sinImporte} pagos sin importe numérico: no suman al total.`}
        </Alerta>
      )}
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={encabezado}>Hora</th>
              <th className={encabezado}>Cliente</th>
              <th className={encabezado}>DNI/CUIT</th>
              <th className={encabezado}>Compañía</th>
              <th className={encabezado}>Póliza</th>
              <th className={encabezado}>Patente</th>
              <th className={cx(encabezado, 'text-right')}>Importe</th>
              <th className={encabezado}>Medio</th>
              <th className={encabezado}>Sucursal</th>
              <th className={encabezado}>Cobró</th>
            </tr>
          </thead>
          <tbody>
            {datos.pagos.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-12 text-center text-slate-500">
                  {esHoy
                    ? 'Todavía no se registró ningún pago hoy. Se cargan desde acá o desde «Registrar pago» de la Cartera.'
                    : `Ese día no tiene pagos registrados${datos.sucursal ? ` en ${datos.sucursal}` : ''}.`}
                </td>
              </tr>
            )}
            {datos.pagos.map((pago) => (
              <tr key={pago.id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-3 py-2 tabular-nums whitespace-nowrap text-slate-600">{pago.hora ?? '—'}</td>
                <td className="px-3 py-2 font-medium text-slate-900">{pago.clienteNombre ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{pago.documento ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{pago.compania ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{pago.numeroPoliza ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{pago.patente ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                  {pago.importeMonto === null ? (pago.importe ?? '—') : pesos(pago.importeMonto)}
                </td>
                <td className="px-3 py-2 text-slate-700">{pago.medio ?? <span className="text-slate-400">sin especificar</span>}</td>
                <td className="px-3 py-2 text-slate-600">{pago.sucursal ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">
                  {pago.usuarioNombre ?? <span className="text-slate-400">de la planilla</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {abrirPago && (
        <DialogoPagoManual
          fecha={datos.fecha}
          sucursales={datos.sucursales}
          sucursalPorDefecto={datos.sucursal || usuario.sucursal.nombre}
          mediosDePago={datos.mediosDePago}
          alCerrar={() => setAbrirPago(false)}
          alGuardar={(caja, resumen) => {
            setDatos(caja)
            setAbrirPago(false)
            setAviso(resumen)
          }}
        />
      )}
    </div>
  )
}

function Tarjeta({ etiqueta, valor, nota, destacada }: { etiqueta: string; valor: string; nota?: string; destacada?: boolean }) {
  return (
    <div className={cx('rounded-lg border px-3 py-1.5', destacada ? 'border-marino-200 bg-marino-50 text-marino-900' : 'border-slate-200 bg-white text-slate-900')}>
      <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{etiqueta}</span>
      <span className="font-display text-lg font-extrabold tabular-nums">{valor}</span>
      {nota && <span className="ml-2 text-xs opacity-70">{nota}</span>}
    </div>
  )
}
