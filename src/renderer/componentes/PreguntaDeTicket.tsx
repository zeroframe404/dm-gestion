// El cartel de «¿imprimo el comprobante?». Aparece después de registrar un pago cuando la
// ticketeadora está en modo pregunta (Administración → Impresora): hay compañías que no piden ticket
// y el rollo se gasta igual, así que el papel sale sólo si alguien dice que sí.
//
// Vive en el marco de la aplicación y no en cada diálogo de pago: se cobra desde la planilla, desde la
// ficha del cliente y desde la caja del día, y el aviso tiene que salir en los tres casos.
import { useEffect, useState } from 'react'
import type { PedidoDeTicket } from '../../shared/tipos'
import { Alerta, Boton, Dialogo, cx } from './ui'

export function PreguntaDeTicket() {
  // Cola y no un solo pedido: si se cobran dos pagos seguidos, el segundo espera su turno en vez de
  // pisar al primero.
  const [pendientes, setPendientes] = useState<PedidoDeTicket[]>([])
  const [copias, setCopias] = useState(1)
  const [imprimiendo, setImprimiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return window.dm.impresora.alPedirTicket((pedido) => {
      setPendientes((cola) => [...cola, pedido])
    })
  }, [])

  const pedido = pendientes[0] ?? null

  // Cada pedido nuevo arranca con la cantidad que quedó guardada en Administración → Impresora: si
  // alguien pidió un duplicado para el pago anterior, el siguiente no hereda esa elección sin querer.
  useEffect(() => {
    if (pedido) setCopias(pedido.copiasPorDefecto)
  }, [pedido])

  if (!pedido) return null

  const siguiente = () => {
    setError(null)
    setPendientes((cola) => cola.slice(1))
  }

  const imprimir = async () => {
    setImprimiendo(true)
    setError(null)
    const resultado = await window.dm.impresora.imprimirPago(pedido.pagoId, copias)
    setImprimiendo(false)
    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    if (!resultado.datos) {
      // El pago está guardado igual: lo único que falló es el papel. El motivo queda en
      // Administración → Impresora.
      setError('No se pudo imprimir el comprobante. Revisá la impresora en Administración → Impresora.')
      return
    }
    siguiente()
  }

  const detalle = [pedido.compania, pedido.poliza].filter(Boolean).join(' ')

  return (
    <Dialogo
      abierto
      titulo="¿Imprimir el comprobante?"
      descripcion="El pago ya quedó registrado. El ticket sale sólo si lo pedís."
      alCerrar={siguiente}
      ancho="sm"
      pie={
        <>
          <Boton onClick={siguiente} disabled={imprimiendo}>
            No imprimir
          </Boton>
          <Boton variante="primario" icono="impresora" onClick={() => void imprimir()} cargando={imprimiendo} autoFocus>
            Imprimir
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <Alerta tono="error">{error}</Alerta>}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm">
          <p className="font-semibold text-slate-900">{pedido.cliente || 'Sin nombre'}</p>
          {detalle && <p className="text-slate-600">{detalle}</p>}
          {pedido.importe && <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">{pedido.importe}</p>}
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Cantidad de tickets</span>
          <div className="flex gap-2">
            {[1, 2].map((cantidad) => (
              <button
                key={cantidad}
                type="button"
                onClick={() => setCopias(cantidad)}
                disabled={imprimiendo}
                className={cx(
                  'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  copias === cantidad ? 'border-marino-500 bg-marino-50 text-marino-900 ring-2 ring-marino-500/20' : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                )}
              >
                {cantidad} {cantidad === 1 ? 'ticket' : 'tickets'}
              </button>
            ))}
          </div>
        </div>
        {pendientes.length > 1 && (
          <p className="text-xs text-slate-500">
            Quedan {pendientes.length - 1} comprobante(s) más para decidir.
          </p>
        )}
      </div>
    </Dialogo>
  )
}
