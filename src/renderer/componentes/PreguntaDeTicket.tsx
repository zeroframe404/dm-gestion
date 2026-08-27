// El cartel de «¿imprimo el comprobante?». Aparece después de registrar un pago cuando la
// ticketeadora está en modo pregunta (Administración → Impresora): hay compañías que no piden ticket
// y el rollo se gasta igual, así que el papel sale sólo si alguien dice que sí.
//
// Vive en el marco de la aplicación y no en cada diálogo de pago: se cobra desde la planilla, desde la
// ficha del cliente y desde la caja del día, y el aviso tiene que salir en los tres casos.
import { useEffect, useState } from 'react'
import type { PedidoDeTicket } from '../../shared/tipos'
import { Alerta, Boton, Dialogo } from './ui'

export function PreguntaDeTicket() {
  // Cola y no un solo pedido: si se cobran dos pagos seguidos, el segundo espera su turno en vez de
  // pisar al primero.
  const [pendientes, setPendientes] = useState<PedidoDeTicket[]>([])
  const [imprimiendo, setImprimiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return window.dm.impresora.alPedirTicket((pedido) => {
      setPendientes((cola) => [...cola, pedido])
    })
  }, [])

  const pedido = pendientes[0] ?? null
  if (!pedido) return null

  const siguiente = () => {
    setError(null)
    setPendientes((cola) => cola.slice(1))
  }

  const imprimir = async () => {
    setImprimiendo(true)
    setError(null)
    const resultado = await window.dm.impresora.imprimirPago(pedido.pagoId)
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
        {pendientes.length > 1 && (
          <p className="text-xs text-slate-500">
            Quedan {pendientes.length - 1} comprobante(s) más para decidir.
          </p>
        )}
      </div>
    </Dialogo>
  )
}
