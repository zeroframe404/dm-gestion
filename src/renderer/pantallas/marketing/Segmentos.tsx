// Marketing → Segmentos: un filtro guardado sobre la cartera del mes abierto y la lista de gente a la
// que hay que escribirle, con el mensaje ya armado.
//
// El envío es de a uno, con un clic por persona. No hay botón de «avisar a todos» y no va a haberlo:
// WhatsApp bloquea las cuentas que mandan tandas automáticas, y la cuenta de la agencia es la misma
// con la que atiende todo el día. Lo que ahorra el segmento es buscar a quién le toca, no el clic.
import { useCallback, useEffect, useState } from 'react'
import { nombreDePeriodo } from '../../../shared/semaforo'
import {
  SEGMENTO_SIN_FILTROS,
  VENTANAS_DE_VENCIMIENTO,
  type FilaDeSegmento,
  type FiltrosDeSegmento,
  type ResultadoDeSegmento,
  type VentanaDeVencimiento,
} from '../../../shared/tipos'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Cargando, cx, Dialogo, Etiqueta, Tarjeta } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'
import { pesos } from '../cobranzas/formato'

export function Segmentos() {
  const usuario = useUsuarioActual()
  const puedeBorrar = usuario.rol !== 'EMPLEADO'

  const [datos, setDatos] = useState<ResultadoDeSegmento | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [avisando, setAvisando] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)

  const cargar = useCallback(async (segmentoId: number | null, filtros: FiltrosDeSegmento | null, plantillaClave: string) => {
    setCargando(true)
    const resultado = await window.dm.marketing.segmento(segmentoId, filtros, plantillaClave)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar(null, null, '')
  }, [cargar])

  if (!datos) {
    return error ? (
      <div className="p-8">
        <Alerta tono="error">{error}</Alerta>
      </div>
    ) : (
      <Cargando texto="Armando el segmento…" />
    )
  }

  const cambiarFiltros = (cambio: Partial<FiltrosDeSegmento>) => void cargar(datos.segmentoId, { ...datos.filtros, ...cambio }, datos.plantillaClave)
  const segmentoActual = datos.segmentos.find((s) => s.id === datos.segmentoId) ?? null

  async function avisar(fila: FilaDeSegmento) {
    setAvisando(fila.filaId)
    setError(null)
    setAviso(null)
    const resultado = await window.dm.marketing.avisar(fila.filaId, datos!.segmentoId, datos!.filtros, datos!.plantillaClave)
    if (!resultado.ok) {
      setError(resultado.error)
      setAvisando(null)
      return
    }
    const abierto = await window.dm.sistema.abrirEnlace(resultado.datos.url)
    setAvisando(null)
    if (!abierto.ok) {
      setError(abierto.error)
      return
    }
    setAviso(`WhatsApp abierto para ${fila.nombre ?? 'el cliente'}. Van ${resultado.datos.avisados} de ${datos!.total} avisados.`)
    // La fila puede haberse ido de la lista (si el segmento pide «sin avisar»): se recarga entera.
    void cargar(datos!.segmentoId, datos!.filtros, datos!.plantillaClave)
  }

  async function borrarSegmento() {
    if (!segmentoActual) return
    setGuardando(true)
    const resultado = await window.dm.marketing.borrarSegmento(segmentoActual.id)
    if (resultado.ok) {
      setDatos(resultado.datos)
      setAviso(`Segmento «${segmentoActual.nombre}» borrado.`)
      setError(null)
    } else {
      setError(resultado.error)
    }
    setGuardando(false)
    setBorrando(false)
  }

  const control = 'h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800'
  const etiqueta = 'block text-xs font-semibold text-slate-600'
  const encabezado = 'px-3 py-2 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 whitespace-nowrap'

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-6">
      <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-suave">
        <h2 className="border-b border-slate-200 px-4 py-3 font-display text-sm font-bold tracking-tight text-slate-900">Segmentos</h2>
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          <li>
            <button
              type="button"
              onClick={() => void cargar(null, SEGMENTO_SIN_FILTROS, '')}
              aria-current={datos.segmentoId === null}
              className={cx(
                'w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                datos.segmentoId === null ? 'bg-marino-50 text-marino-800' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              Filtro nuevo
            </button>
          </li>
          {datos.segmentos.map((segmento) => (
            <li key={segmento.id}>
              <button
                type="button"
                onClick={() => void cargar(segmento.id, null, '')}
                aria-current={segmento.id === datos.segmentoId}
                className={cx(
                  'w-full rounded-lg px-3 py-2 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
                  segmento.id === datos.segmentoId ? 'bg-marino-50 text-marino-800' : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <span className="block truncate text-sm font-semibold">{segmento.nombre}</span>
                {segmento.descripcion && <span className="mt-0.5 block truncate text-xs text-slate-500">{segmento.descripcion}</span>}
              </button>
            </li>
          ))}
          {datos.segmentos.length === 0 && (
            <li className="px-3 py-4 text-xs leading-relaxed text-slate-500">
              Todavía no hay ninguno guardado. Armá un filtro acá al lado y guardalo con un nombre.
            </li>
          )}
        </ul>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
        <Tarjeta
          className="shrink-0"
          titulo={segmentoActual ? segmentoActual.nombre : 'Filtro nuevo'}
          descripcion={
            datos.periodo
              ? `Sobre la planilla de ${nombreDePeriodo(datos.periodo)}, que es el mes abierto.`
              : 'Todavía no hay ninguna planilla cargada: importá la hoja de Google desde Administración.'
          }
          acciones={
            <>
              {segmentoActual && puedeBorrar && (
                <Boton tamano="sm" variante="peligro" icono="basura" onClick={() => setBorrando(true)}>
                  Borrar
                </Boton>
              )}
              <Boton tamano="sm" variante="primario" icono="ok" onClick={() => setGuardando(true)}>
                {segmentoActual ? 'Guardar cambios' : 'Guardar como segmento'}
              </Boton>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={etiqueta}>
              Sucursal
              <select value={datos.filtros.sucursal} onChange={(e) => cambiarFiltros({ sucursal: e.target.value })} className={`mt-1 ${control}`}>
                <option value="">Todas</option>
                {datos.sucursales.map((sucursal) => (
                  <option key={sucursal} value={sucursal}>
                    {sucursal}
                  </option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              Compañía
              <select value={datos.filtros.compania} onChange={(e) => cambiarFiltros({ compania: e.target.value })} className={`mt-1 ${control}`}>
                <option value="">Todas</option>
                {datos.companias.map((compania) => (
                  <option key={compania} value={compania}>
                    {compania}
                  </option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              Forma de pago
              <select value={datos.filtros.formaPago} onChange={(e) => cambiarFiltros({ formaPago: e.target.value })} className={`mt-1 ${control}`}>
                <option value="">Todas</option>
                {datos.formasDePago.map((forma) => (
                  <option key={forma} value={forma}>
                    {forma}
                  </option>
                ))}
              </select>
            </label>
            <label className={etiqueta}>
              Vencimiento
              <select
                value={datos.filtros.vence}
                onChange={(e) => cambiarFiltros({ vence: e.target.value as VentanaDeVencimiento })}
                className={`mt-1 ${control}`}
              >
                {VENTANAS_DE_VENCIMIENTO.map((ventana) => (
                  <option key={ventana || 'todas'} value={ventana}>
                    {ventana === '' ? 'Cuando sea' : ventana === 'ESTA SEMANA' ? 'Vence esta semana' : ventana === 'ESTE MES' ? 'Vence este mes' : 'Ya vencidas'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Interruptor etiqueta="Sólo las impagas" activo={datos.filtros.soloImpagas} alCambiar={(v) => cambiarFiltros({ soloImpagas: v })} />
            <Interruptor
              etiqueta="Sólo a las que todavía no se les avisó"
              activo={datos.filtros.soloSinAvisar}
              alCambiar={(v) => cambiarFiltros({ soloSinAvisar: v })}
            />
            <Interruptor
              etiqueta="Dejar afuera el débito automático"
              activo={datos.filtros.excluirDebito}
              alCambiar={(v) => cambiarFiltros({ excluirDebito: v })}
            />
          </div>

          <div className="mt-3">
            <label className={etiqueta}>
              {/* El texto va en su propio bloque: el selector no ocupa todo el ancho y si no se le sienta al lado. */}
              <span className="block">Mensaje con el que se avisa</span>
              <select
                value={datos.plantillaClave}
                onChange={(e) => void cargar(datos.segmentoId, datos.filtros, e.target.value)}
                className={`mt-1 ${control} sm:max-w-sm`}
              >
                {datos.plantillas.map((plantilla) => (
                  <option key={plantilla.clave} value={plantilla.clave}>
                    {plantilla.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Tarjeta>

        {error && <Alerta tono="error">{error}</Alerta>}
        {aviso && <Alerta tono="exito">{aviso}</Alerta>}

        <Tarjeta
          className="shrink-0"
          titulo="A quiénes hay que escribirles"
          descripcion={
            <>
              {datos.total.toLocaleString('es-AR')} en la lista · <strong className="font-semibold text-slate-800">{datos.avisados} avisados</strong>
              {datos.sinTelefono > 0 && ` · ${datos.sinTelefono} sin teléfono cargado`}
              {cargando && ' · actualizando…'}
            </>
          }
          alRas
        >
          <div className="max-h-[26rem] overflow-auto border-t border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="border-b border-slate-200">
                  <th className={encabezado}>Cliente</th>
                  <th className={encabezado}>Sucursal</th>
                  <th className={encabezado}>Compañía</th>
                  <th className={encabezado}>Patente</th>
                  <th className={encabezado}>Forma de pago</th>
                  <th className={`${encabezado} text-right`}>Cuota</th>
                  <th className={encabezado}>Vence</th>
                  <th className={encabezado}>Aviso</th>
                  <th className={encabezado} />
                </tr>
              </thead>
              <tbody>
                {datos.filas.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-12 text-center text-slate-500">
                      Con estos filtros no queda nadie. Aflojá alguno y probá de nuevo.
                    </td>
                  </tr>
                )}
                {datos.filas.map((fila) => (
                  <tr key={fila.filaId} className="border-b border-slate-100 last:border-b-0 align-top">
                    <td className="px-3 py-2">
                      <span className="block font-medium text-slate-900">{fila.nombre ?? '—'}</span>
                      <span className="block text-xs text-slate-500">{fila.telefono ?? 'sin teléfono'}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{fila.sucursal ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{fila.compania ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700">{fila.patente ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{fila.formaPago ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                      {fila.cuotaMonto !== null ? pesos(fila.cuotaMonto) : (fila.cuota ?? '—')}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                      {fila.vencimiento ?? '—'}
                      {fila.diasParaVencer !== null && (
                        <span className={cx('ml-1.5 text-xs', fila.diasParaVencer < 0 ? 'text-red-600' : 'text-slate-400')}>
                          {fila.diasParaVencer < 0
                            ? `hace ${-fila.diasParaVencer} d`
                            : fila.diasParaVencer === 0
                              ? 'hoy'
                              : `en ${fila.diasParaVencer} d`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {fila.avisado ? <Etiqueta tono="exito">Avisado</Etiqueta> : <span className="text-xs text-slate-400">sin avisar</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Boton
                        tamano="sm"
                        variante={fila.avisado ? 'secundario' : 'primario'}
                        icono="mensaje"
                        onClick={() => void avisar(fila)}
                        cargando={avisando === fila.filaId}
                        disabled={!fila.tieneTelefono || avisando !== null}
                        title={fila.tieneTelefono ? fila.mensaje : 'No tiene teléfono cargado: completalo en la ficha del cliente.'}
                      >
                        Avisar
                      </Boton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>

        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
          <Icono nombre="info" tamano={14} className="mt-0.5 shrink-0" />
          No hay envío masivo a propósito: WhatsApp bloquea las cuentas que mandan tandas automáticas, y ésta es la cuenta con la que la
          agencia atiende todo el día. Cada «Avisar» abre el chat con el mensaje escrito y lo manda una persona.
        </p>
      </div>

      <DialogoDeGuardado
        abierto={guardando}
        datos={datos}
        alCerrar={() => setGuardando(false)}
        alGuardar={(nuevo) => {
          setDatos(nuevo)
          setGuardando(false)
          setAviso('Segmento guardado.')
        }}
      />

      <Dialogo
        abierto={borrando}
        titulo={`¿Borrar «${segmentoActual?.nombre ?? ''}»?`}
        descripcion="Se borra el filtro guardado. Los clientes y sus avisos no se tocan."
        alCerrar={() => setBorrando(false)}
        ancho="sm"
        pie={
          <>
            <Boton onClick={() => setBorrando(false)}>Cancelar</Boton>
            <Boton variante="peligro" onClick={() => void borrarSegmento()}>
              Borrar
            </Boton>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">No se puede deshacer.</p>
      </Dialogo>
    </div>
  )
}

function Interruptor({ etiqueta, activo, alCambiar }: { etiqueta: string; activo: boolean; alCambiar: (valor: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={activo}
        onChange={(evento) => alCambiar(evento.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-marino-700 focus-visible:ring-2 focus-visible:ring-marino-500/40"
      />
      {etiqueta}
    </label>
  )
}

interface PropsGuardado {
  abierto: boolean
  datos: ResultadoDeSegmento
  alCerrar: () => void
  alGuardar: (datos: ResultadoDeSegmento) => void
}

function DialogoDeGuardado({ abierto, datos, alCerrar, alGuardar }: PropsGuardado) {
  const actual = datos.segmentos.find((s) => s.id === datos.segmentoId) ?? null
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setNombre(actual?.nombre ?? '')
    setDescripcion(actual?.descripcion ?? '')
    setError(null)
  }, [abierto, actual?.nombre, actual?.descripcion])

  async function guardar() {
    setGuardando(true)
    setError(null)
    const resultado = await window.dm.marketing.guardarSegmento(datos.segmentoId, {
      nombre,
      descripcion,
      filtros: datos.filtros,
      plantillaClave: datos.plantillaClave,
    })
    if (resultado.ok) alGuardar(resultado.datos)
    else setError(resultado.error)
    setGuardando(false)
  }

  return (
    <Dialogo
      abierto={abierto}
      titulo={actual ? 'Guardar los cambios' : 'Guardar como segmento'}
      descripcion="Se guarda el filtro, no la lista: cada vez que se abra vuelve a calcularse sobre la cartera del momento."
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar}>Cancelar</Boton>
          <Boton variante="primario" onClick={() => void guardar()} cargando={guardando} disabled={nombre.trim().length < 2}>
            Guardar
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        <Campo
          etiqueta="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Cuponera que vence esta semana - Lanús"
          maxLength={60}
        />
        <Campo
          etiqueta="Para qué sirve"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Opcional"
          maxLength={200}
        />
        <p className="text-xs leading-relaxed text-slate-500">
          Hoy este filtro devuelve <strong className="font-semibold text-slate-700">{datos.total}</strong> fila(s).
        </p>
      </div>
    </Dialogo>
  )
}
