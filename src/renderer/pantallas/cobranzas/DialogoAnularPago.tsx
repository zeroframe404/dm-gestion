// Anular un pago cargado por error: pide el motivo (queda en el historial de la fila) y listo. No
// hay «deshacer un anular»: por eso pide confirmar con un motivo en vez de un botón de un solo click,
// como el tilde de revisión o el número de ticket.
import { useState } from 'react'
import type { PagoRegistrado } from '../../../shared/tipos'
import { Alerta, AreaTexto, Boton, Dialogo } from '../../componentes/ui'
import { pesos } from './formato'

interface Props {
  pago: PagoRegistrado
  alCerrar: () => void
  alAnular: (motivo: string) => Promise<void>
}

export function DialogoAnularPago({ pago, alCerrar, alAnular }: Props) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmar = async () => {
    if (motivo.trim().length < 3) {
      setError('Contá en pocas palabras por qué se anula: queda anotado en el historial de la fila.')
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await alAnular(motivo.trim())
    } catch (excepcion) {
      setError(excepcion instanceof Error ? excepcion.message : 'No se pudo anular el pago.')
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      abierto
      titulo="Anular este pago"
      descripcion="Lo saca de la caja del día, de la rendición y de la hoja compartida. Si había dejado paga una cuota de la planilla, vuelve a quedar sin pagar."
      alCerrar={alCerrar}
      ancho="md"
      pie={
        <>
          <Boton onClick={alCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton variante="peligro" icono="basura" onClick={() => void confirmar()} cargando={enviando}>
            Anular el pago
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alerta tono="error">{error}</Alerta>}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-display text-base font-bold text-slate-900">{pago.clienteNombre ?? 'Pago suelto'}</p>
          <p className="mt-1 text-slate-600">
            {pago.fecha ?? '—'} · {pago.importeMonto === null ? (pago.importe ?? '—') : pesos(pago.importeMonto)}
            {pago.medio ? ` · ${pago.medio}` : ''}
          </p>
        </div>
        <AreaTexto
          etiqueta="Motivo de la anulación"
          rows={3}
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          ayuda="Por ejemplo: «se cargó en la fila de otro cliente por error»."
          autoFocus
        />
      </div>
    </Dialogo>
  )
}
