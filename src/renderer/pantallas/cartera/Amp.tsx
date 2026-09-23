// AMP: las ampliaciones pendientes. La lista más chica de la hoja, y a propósito la pantalla más
// simple: sucursal, fecha, nombre, forma de pago, patente, marca, modelo y fecha de vencimiento, con un
// tilde que la saca de la lista cuando ya está emitida.
//
// Nada se borra: destildar la devuelve, y «Ver también las resueltas» muestra el histórico completo.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BotonEliminar, usePuedeEliminar } from '../../componentes/BotonEliminar'
import { coincideAlguno, dentroDelRango } from '../../../shared/filtros'
import { mismaSucursal } from '../../../shared/sucursales'
import type { ListadoAmp } from '../../../shared/tipos'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { RangoDeFecha } from '../../componentes/RangoDeFecha'
import { Icono } from '../../componentes/Icono'
import { Alerta, Cargando, cx } from '../../componentes/ui'
import { usePuedeEditar } from '../../contexto/Permisos'

function normalizar(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

export function Amp() {
  const puedeEditar = usePuedeEditar('cartera')
  const puedeBorrar = usePuedeEliminar('amp')
  const [datos, setDatos] = useState<ListadoAmp | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  // Una LISTA, no un valor: se pueden mirar Dock Sud y Daniel a la vez. Vacía = todas.
  const [sucursales, setSucursales] = useState<string[]>([])
  const [rango, setRango] = useState({ desde: '', hasta: '' })
  const [verResueltas, setVerResueltas] = useState(false)
  const [guardando, setGuardando] = useState<number | null>(null)

  const cargar = useCallback(async (incluirResueltas: boolean) => {
    const resultado = await window.dm.amp.listar(incluirResueltas)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else setError(resultado.error)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(verResueltas)
  }, [cargar, verResueltas])

  const filtradas = useMemo(() => {
    if (!datos) return []
    const texto = normalizar(busqueda)
    return datos.filas.filter((f) => {
      // La sucursal se compara con `mismaSucursal`, que es con lo que el servicio arma el desplegable:
      // además de las tildes y las mayúsculas sabe que «AVELLANEDA» y «DOCKSUD» son Dock Sud. Con el
      // texto pelado, elegir una opción que pliega dos grafías dejaba el listado vacío.
      if (!coincideAlguno(sucursales, f.sucursal, mismaSucursal)) return false
      if (!dentroDelRango(f.fechaIso, rango.desde, rango.hasta)) return false
      if (!texto) return true
      return [f.clienteNombre, f.patente, f.marca, f.modelo, f.detalle].some((valor) => normalizar(valor).includes(texto))
    })
  }, [datos, busqueda, sucursales, rango])

  const cambiar = async (id: number, resuelto: boolean) => {
    setGuardando(id)
    const resultado = await window.dm.amp.cambiarResuelto(id, resuelto, verResueltas)
    setGuardando(null)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else setError(resultado.error)
  }

  if (cargando || !datos) return <Cargando />

  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Icono nombre="lupa" tamano={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
            placeholder="Nombre, patente o ampliación…"
            className="h-9 w-72 rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400"
          />
        </div>
        <FiltroMultiple etiqueta="Sucursal" valores={sucursales} opciones={datos.sucursales} alCambiar={setSucursales} />
        <RangoDeFecha
          etiqueta="Fecha"
          desde={rango.desde}
          hasta={rango.hasta}
          alCambiar={(desde, hasta) => setRango({ desde, hasta })}
        />
        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" checked={verResueltas} onChange={(evento) => setVerResueltas(evento.target.checked)} className="h-4 w-4" />
          Ver también las resueltas
        </label>
        <span className="ml-auto text-sm text-slate-500">
          {datos.pendientes.toLocaleString('es-AR')} pendientes
          {datos.resueltas > 0 && ` · ${datos.resueltas.toLocaleString('es-AR')} resueltas`}
        </span>
      </div>

      {error && <Alerta tono="error">{error}</Alerta>}
      {datos.avisoDeSincronizacion && <Alerta tono="aviso">{datos.avisoDeSincronizacion}</Alerta>}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className={cx(encabezado, 'w-20 text-center')}>Resuelto</th>
              <th className={encabezado}>Sucursal</th>
              <th className={encabezado}>Fecha</th>
              <th className={encabezado}>Nombre</th>
              <th className={encabezado}>Forma de pago</th>
              <th className={encabezado}>Patente</th>
              <th className={encabezado}>Marca</th>
              <th className={encabezado}>Modelo</th>
              <th className={encabezado}>Fecha de vto</th>
              <th className={encabezado}>Ampliación</th>
              {/* La columna de acciones no se dibuja para quien no puede borrar: una columna vacía de
                  más, que el lector de pantalla además anuncia fila por fila, es peor que nada. */}
              {puedeBorrar && <th className={encabezado} aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {filtradas.length === 0 && (
              <tr>
                <td colSpan={puedeBorrar ? 11 : 10} className="px-3 py-10 text-center text-slate-500">
                  {datos.pendientes === 0 && datos.resueltas === 0
                    ? 'Todavía no se importó la pestaña AMP de la hoja.'
                    : datos.pendientes === 0 && !verResueltas
                      ? 'No queda ninguna ampliación pendiente. 👏'
                      : 'Ninguna ampliación coincide con la búsqueda.'}
                </td>
              </tr>
            )}
            {filtradas.map((fila) => (
              <tr key={fila.id} className={cx('border-b border-slate-100 last:border-b-0', fila.resuelto && 'bg-slate-50 text-slate-400')}>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={fila.resuelto}
                    disabled={guardando === fila.id || !puedeEditar}
                    onChange={(evento) => void cambiar(fila.id, evento.target.checked)}
                    aria-label={`Marcar como resuelta la ampliación de ${fila.clienteNombre ?? 'este cliente'}`}
                    title={fila.resuelto ? `Resuelta por ${fila.resueltoPor ?? 'alguien'}` : 'Marcar como resuelta'}
                    className="h-4 w-4"
                  />
                </td>
                <td className="px-3 py-2">{fila.sucursal ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fila.fecha ?? '—'}</td>
                <td className={cx('px-3 py-2', fila.resuelto ? 'line-through' : 'font-medium text-slate-900')}>{fila.clienteNombre ?? '—'}</td>
                <td className="px-3 py-2">{fila.formaPago ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs font-semibold">{fila.patente ?? '—'}</td>
                <td className="px-3 py-2">{fila.marca ?? '—'}</td>
                <td className="px-3 py-2">{fila.modelo ?? '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fila.vencimiento ?? '—'}</td>
                <td className="px-3 py-2">{[fila.detalle, fila.observaciones].filter(Boolean).join(' · ') || '—'}</td>
                {puedeBorrar && (
                  <td className="px-3 py-2 text-right">
                    <BotonEliminar tipo="amp" id={fila.id} etiqueta={false} alBorrar={() => void cargar(verResueltas)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
