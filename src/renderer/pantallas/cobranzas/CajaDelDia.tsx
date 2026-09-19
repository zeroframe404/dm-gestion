// La caja del día: qué se cobró hoy en esta sucursal, con qué medio y quién lo cobró. Es la pantalla
// que se mira al cerrar el mostrador, así que el total por medio de pago va arriba de todo.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CajaDelDia as DatosDeCaja, PagoRegistrado } from '../../../shared/tipos'
import { nombreDePeriodo } from '../../../shared/semaforo'
import { Icono } from '../../componentes/Icono'
import { FiltroMultiple } from '../../componentes/FiltroMultiple'
import { SelectorDeColumnas, useColumnasElegidas } from '../../componentes/SelectorDeColumnas'
import { Alerta, Boton, Cargando, cx, Etiqueta } from '../../componentes/ui'
import { useUsuarioActual } from '../../contexto/Sesion'
import { ArqueoDeCaja } from './ArqueoDeCaja'
import { DialogoAnularPago } from './DialogoAnularPago'
import { DialogoPagoManual } from './DialogoPagoManual'
import { momento, numero, pesos } from './formato'
import { usePuedeEditar } from '../../contexto/Permisos'

/** Las que se pueden apagar con «Columnas». El cliente no: sin él el renglón no se sabe de quién es. */
const COLUMNAS: Array<{ id: string; titulo: string; siempre?: boolean }> = [
  // Las tres primeras son las columnas A, B y C de la planilla de caja de la agencia.
  { id: 'ticket', titulo: 'N° ticket' },
  { id: 'hora', titulo: 'Hora' },
  { id: 'cliente', titulo: 'Cliente', siempre: true },
  { id: 'documento', titulo: 'DNI/CUIT' },
  { id: 'compania', titulo: 'Compañía' },
  { id: 'poliza', titulo: 'Póliza' },
  { id: 'patente', titulo: 'Patente' },
  { id: 'importe', titulo: 'Importe' },
  { id: 'medio', titulo: 'Medio' },
  // La columna REVISIÓN DE PAGO de la planilla: el tilde de «lo miré y está bien».
  { id: 'revisado', titulo: 'Revisado' },
  { id: 'observaciones', titulo: 'Observaciones' },
  { id: 'sucursal', titulo: 'Sucursal' },
  { id: 'cobro_usuario', titulo: 'Cobró' },
  { id: 'cobro_estado', titulo: 'Cobro' },
  { id: 'anular', titulo: 'Anular' },
]

export function CajaDelDia() {
  const puedeEditar = usePuedeEditar('cobranzas')
  const usuario = useUsuarioActual()
  const [datos, setDatos] = useState<DatosDeCaja | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abrirPago, setAbrirPago] = useState(false)
  const [pagoAAnular, setPagoAAnular] = useState<PagoRegistrado | null>(null)
  const [exportando, setExportando] = useState(false)
  const { visibles, ocultas, alternar: alternarColumna, mostrarTodas } = useColumnasElegidas('cobranzas-caja', COLUMNAS)
  const ve = useMemo(() => new Set(visibles.map((columna) => columna.id)), [visibles])

  const cargar = useCallback(async (fecha: string | null, sucursales: string[]) => {
    setCargando(true)
    setError(null)
    // El aviso es de una acción puntual («pago registrado», «el día se guardó en…»): al cambiar de
    // día o de sucursal ya no habla de lo que se está mirando.
    setAviso(null)
    const resultado = await window.dm.cobranzas.caja(fecha, sucursales)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
    setCargando(false)
  }, [])

  // La primera vez se abre en el día de hoy y en la sucursal de quien entró: es el caso normal.
  useEffect(() => {
    void cargar(null, [usuario.sucursal.nombre])
  }, [cargar, usuario.sucursal.nombre])

  /** El tilde de REVISIÓN DE PAGO. La caja vuelve rehecha: el arqueo puede haber cambiado. */
  const revisar = async (pago: PagoRegistrado) => {
    setError(null)
    const resultado = await window.dm.cobranzas.revisarPago(pago.id, !pago.revisado)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
  }

  /** El número del comprobante escrito a mano (el de la ticketeadora se guarda solo al imprimir). */
  const anotarTicket = async (pago: PagoRegistrado, numero: string) => {
    setError(null)
    const resultado = await window.dm.cobranzas.numeroDeTicket(pago.id, numero)
    if (resultado.ok) setDatos(resultado.datos)
    else setError(resultado.error)
  }

  /** Anula el pago y, si salió bien, cierra el diálogo. El error queda en el diálogo, no acá. */
  const anular = async (pago: PagoRegistrado, motivo: string) => {
    const resultado = await window.dm.cobranzas.anularPago(pago.id, motivo)
    if (!resultado.ok) throw new Error(resultado.error)
    setDatos(resultado.datos)
    setPagoAAnular(null)
    setAviso('El pago quedó anulado.')
  }

  const exportar = async () => {
    if (!datos) return
    setExportando(true)
    setError(null)
    const resultado = await window.dm.cobranzas.exportarCaja(datos.fecha, datos.sucursalesElegidas)
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
            onChange={(evento) => void cargar(evento.target.value || datos.hoy, datos.sucursalesElegidas)}
            className="ml-2 h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm font-medium text-slate-800"
          />
        </label>
        {/* Un empleado ve la caja de su mostrador y nada más: en vez del desplegable se le muestra el
            nombre, que es la verdad de lo que está mirando. Las otras sucursales las mira quien
            administra la agencia (SUPER_ADMIN y ADMIN), y puede elegir varias a la vez. */}
        {datos.sucursalFija ? (
          <span
            className="inline-flex h-9 items-center rounded-lg border border-slate-300 bg-slate-100 px-3 text-sm font-semibold text-slate-600"
            title="Las cajas de las otras sucursales las ven los administradores."
          >
            Sucursal: {datos.sucursalesElegidas.join(', ') || '—'}
          </span>
        ) : (
          <FiltroMultiple
            etiqueta="Sucursal"
            valores={datos.sucursalesElegidas}
            opciones={datos.sucursales}
            alCambiar={(v) => void cargar(datos.fecha, v)}
          />
        )}
        {!esHoy && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 px-2.5 text-xs font-semibold text-slate-600">
            <Icono nombre="reloj" tamano={13} />
            Día anterior
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SelectorDeColumnas columnas={COLUMNAS} ocultas={ocultas} alAlternar={alternarColumna} alMostrarTodas={mostrarTodas} />
          <Boton icono="cargando" onClick={() => void cargar(datos.fecha, datos.sucursalesElegidas)} disabled={cargando}>
            Actualizar
          </Boton>
          <Boton
            icono="descargar"
            onClick={() => void exportar()}
            cargando={exportando}
            disabled={datos.pagos.length === 0 && !datos.arqueo}
            title="Guarda el día en un Excel con la forma de la planilla de caja de siempre."
          >
            Exportar el día
          </Boton>
          {puedeEditar && (
            <Boton variante="primario" icono="mas" onClick={() => setAbrirPago(true)}>
              Registrar pago
            </Boton>
          )}
        </div>
      </div>

      {/* Sólo los totales de arriba pueden venir del servidor (nunca la lista de abajo ni el arqueo), y
          sólo para hoy y ayer — ver la cabecera de servicios/cobranzasDesdeCache.ts. */}
      {datos.calculadoEn && (
        <p className="-mb-1 text-xs text-slate-500">
          Los totales los calculó el servidor el {momento(datos.calculadoEn)}
          {datos.recibidoEnEstaComputadora && <> · recibido acá el {momento(datos.recibidoEnEstaComputadora)}</>}.
          {datos.frescura && datos.frescura !== 'AL_DIA' && (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-800">
              Sin conexión con el servidor: mostrando el último cálculo recibido.
            </span>
          )}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Tarjeta etiqueta="Total del día" valor={pesos(datos.total)} destacada />
        <Tarjeta etiqueta="Pagos" valor={numero(datos.pagos.length - datos.imputados)} />
        {datos.imputados > 0 && <Tarjeta etiqueta="Imputados sin cobrar" valor={numero(datos.imputados)} nota="no suman al total" />}
        {datos.totalesPorMedio.map((total) => (
          <Tarjeta key={total.medio} etiqueta={total.medio} valor={pesos(total.total)} nota={`${numero(total.pagos)} pago(s)`} />
        ))}
      </div>

      {datos.arqueo ? (
        <ArqueoDeCaja arqueo={datos.arqueo} puedeEditar={puedeEditar} alCambiar={setDatos} />
      ) : (
        <Alerta tono="info">
          La caja chica —el cambio del cajón, los gastos y el arqueo del cierre— se lleva por mostrador. Elegí una sola
          sucursal para verla y cerrarla.
        </Alerta>
      )}

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
              {visibles.map((columna) => (
                <th key={columna.id} className={cx(encabezado, columna.id === 'importe' && 'text-right')}>
                  {columna.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {datos.pagos.length === 0 && (
              <tr>
                <td colSpan={visibles.length} className="px-3 py-12 text-center text-slate-500">
                  {esHoy
                    ? 'Todavía no se registró ningún pago hoy. Se cargan desde acá o desde «Registrar pago» de la Cartera.'
                    : `Ese día no tiene pagos registrados${datos.sucursalesElegidas.length > 0 ? ` en ${datos.sucursalesElegidas.join(', ')}` : ''}.`}
                </td>
              </tr>
            )}
            {datos.pagos.map((pago) => (
              <tr key={pago.id} className="border-b border-slate-100 last:border-b-0">
                {ve.has('ticket') && (
                  <td className="px-3 py-2">
                    {puedeEditar ? (
                      <input
                        // La clave lleva el número: al recargar la caja, el valor de la casilla se
                        // rehace con lo que quedó guardado en vez de conservar lo tipeado.
                        key={pago.numeroTicket ?? ''}
                        defaultValue={pago.numeroTicket ?? ''}
                        onBlur={(evento) => {
                          if (evento.target.value.trim() !== (pago.numeroTicket ?? '')) void anotarTicket(pago, evento.target.value)
                        }}
                        placeholder="—"
                        aria-label={`Número de ticket de ${pago.clienteNombre ?? 'el pago'}`}
                        className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs text-slate-600 hover:border-slate-300 focus:border-marino-500 focus:bg-white focus:outline-none"
                      />
                    ) : (
                      <span className="font-mono text-xs text-slate-600">{pago.numeroTicket ?? '—'}</span>
                    )}
                  </td>
                )}
                {ve.has('hora') && <td className="px-3 py-2 tabular-nums whitespace-nowrap text-slate-600">{pago.hora ?? '—'}</td>}
                {ve.has('cliente') && <td className="px-3 py-2 font-medium text-slate-900">{pago.clienteNombre ?? '—'}</td>}
                {ve.has('documento') && <td className="px-3 py-2 text-slate-600">{pago.documento ?? '—'}</td>}
                {ve.has('compania') && <td className="px-3 py-2 text-slate-600">{pago.compania ?? '—'}</td>}
                {ve.has('poliza') && <td className="px-3 py-2 font-mono text-xs text-slate-600">{pago.numeroPoliza ?? '—'}</td>}
                {ve.has('patente') && <td className="px-3 py-2 font-mono text-xs text-slate-600">{pago.patente ?? '—'}</td>}
                {ve.has('importe') && (
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                    {pago.importeMonto === null ? (pago.importe ?? '—') : pesos(pago.importeMonto)}
                  </td>
                )}
                {ve.has('medio') && (
                  <td className="px-3 py-2 text-slate-700">{pago.medio ?? <span className="text-slate-400">sin especificar</span>}</td>
                )}
                {ve.has('revisado') && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void revisar(pago)}
                      disabled={!puedeEditar}
                      title={
                        pago.revisado
                          ? `Revisado${pago.revisadoPor ? ` por ${pago.revisadoPor}` : ''}. Tocá para sacar el tilde.`
                          : 'Tocá cuando hayas mirado el cobro y esté todo bien.'
                      }
                      className={cx(
                        'flex h-6 w-6 items-center justify-center rounded border text-xs font-bold',
                        pago.revisado ? 'border-green-300 bg-green-50 text-green-700' : 'border-slate-300 text-slate-300',
                        puedeEditar && 'hover:border-green-400 hover:text-green-700',
                      )}
                      aria-label={pago.revisado ? 'Sacar el tilde de revisión' : 'Marcar como revisado'}
                    >
                      {pago.revisado ? '✔' : ''}
                    </button>
                  </td>
                )}
                {ve.has('observaciones') && (
                  <td className="max-w-[18rem] truncate px-3 py-2 text-slate-600" title={pago.observaciones ?? ''}>
                    {pago.observaciones ?? '—'}
                  </td>
                )}
                {ve.has('sucursal') && <td className="px-3 py-2 text-slate-600">{pago.sucursal ?? '—'}</td>}
                {ve.has('cobro_usuario') && (
                  <td className="px-3 py-2 text-slate-600">
                    {pago.usuarioNombre ?? <span className="text-slate-400">de la planilla</span>}
                  </td>
                )}
                {ve.has('cobro_estado') && (
                  <td className="px-3 py-2">
                    <EstadoDelCobro pago={pago} />
                  </td>
                )}
                {ve.has('anular') && (
                  <td className="px-3 py-2">
                    {puedeEditar && (
                      <button
                        type="button"
                        onClick={() => setPagoAAnular(pago)}
                        disabled={Boolean(pago.adelantoModo) || Boolean(pago.resultado)}
                        title={
                          pago.adelantoModo
                            ? 'Un pago adelantado todavía no se puede anular desde acá.'
                            : pago.resultado
                              ? 'Ya tiene un resultado de rendición cargado: no se puede anular desde acá.'
                              : 'Anular este pago: lo saca de la caja, la rendición y la hoja.'
                        }
                        className="rounded px-1.5 py-0.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                      >
                        Anular
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagoAAnular && (
        <DialogoAnularPago pago={pagoAAnular} alCerrar={() => setPagoAAnular(null)} alAnular={(motivo) => anular(pagoAAnular, motivo)} />
      )}

      {abrirPago && (
        <DialogoPagoManual
          fecha={datos.fecha}
          sucursales={datos.sucursales}
          sucursalPorDefecto={datos.sucursalesElegidas[0] ?? usuario.sucursal.nombre}
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

/**
 * Qué es el pago además de un pago: IMPUTADO (la agencia le pagó a la compañía y falta cobrarle al
 * cliente: no suma) o ADELANTADO (la cuota del mes que viene, cobrada hoy).
 */
export function EstadoDelCobro({ pago }: { pago: PagoRegistrado }) {
  if (pago.estadoCobro === 'IMPUTADO') {
    return (
      <span title="Se le imputó la cuota a la compañía y el cliente todavía no pagó: no suma a la caja.">
        <Etiqueta tono="aviso">Imputado · falta cobrar</Etiqueta>
      </span>
    )
  }
  if (pago.adelantoModo) {
    return (
      <span
        title={
          pago.adelantoImputado
            ? 'Pago adelantado, ya imputado a la cuota del mes que pagaba.'
            : pago.adelantoModo === 'ACREDITAR'
              ? 'Pago adelantado: se acredita solo cuando se arme el mes que paga.'
              : 'Pago adelantado: queda pendiente de imputar cuando se arme el mes que paga.'
        }
      >
        <Etiqueta tono="marca">Adelantado{pago.periodo ? ` · ${nombreDePeriodo(pago.periodo)}` : ''}</Etiqueta>
      </span>
    )
  }
  return <span className="text-xs text-slate-400">Pagó</span>
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
