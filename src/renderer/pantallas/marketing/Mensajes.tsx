// Marketing → Redes → Mensajes: la bandeja de mensajes privados (Messenger e Instagram) de la cuenta
// de una sucursal.
//
// Dos paneles: la lista de conversaciones a la izquierda, la conversación abierta a la derecha. Cada
// conversación ya viene con `puedeResponder` resuelto por el servidor —junta la ventana de 24 horas
// de Meta (no se puede mandar un mensaje libre si pasaron más de 24 horas desde el último mensaje que
// mandó la persona) con lo que Meta ya rechazó antes—, así que acá no hace falta recalcular nada: si
// viene en false, se muestra el aviso amarillo con el motivo tal cual lo mandó el servidor.
import { useCallback, useEffect, useState } from 'react'
import type { ConversacionDeRed, MensajeDeRed } from '../../../shared/tipos'
import { AvisoLimitacionMeta } from '../../componentes/AvisoLimitacionMeta'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, cx } from '../../componentes/ui'

function cuando(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

interface Props {
  sucursal: string
  puedeEditar: boolean
}

export function Mensajes({ sucursal, puedeEditar }: Props) {
  const [conversaciones, setConversaciones] = useState<ConversacionDeRed[] | null>(null)
  const [seleccionada, setSeleccionada] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<MensajeDeRed[] | null>(null)
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const cargarConversaciones = useCallback(async () => {
    const resultado = await window.dm.redes.conversaciones(sucursal)
    if (resultado.ok) {
      setConversaciones(resultado.datos)
      setSeleccionada((actual) => actual ?? resultado.datos[0]?.id ?? null)
    } else {
      setError(resultado.error)
    }
  }, [sucursal])

  useEffect(() => {
    setConversaciones(null)
    setSeleccionada(null)
    void cargarConversaciones()
  }, [cargarConversaciones])

  const cargarMensajes = useCallback(async () => {
    if (!seleccionada) {
      setMensajes(null)
      return
    }
    const resultado = await window.dm.redes.conversacionMensajes(seleccionada)
    if (resultado.ok) setMensajes(resultado.datos)
    else setError(resultado.error)
  }, [seleccionada])

  useEffect(() => {
    setMensajes(null)
    void cargarMensajes()
  }, [cargarMensajes])

  const conversacionActual = conversaciones?.find((c) => c.id === seleccionada) ?? null

  const responder = async () => {
    if (!seleccionada || !texto.trim()) return
    setOcupado(true)
    setError(null)
    const resultado = await window.dm.redes.conversacionResponder(seleccionada, texto.trim())
    if (resultado.ok) {
      setMensajes((actuales) => (actuales ? [...actuales, resultado.datos] : actuales))
      setTexto('')
      await cargarConversaciones()
    } else {
      setError(resultado.error)
    }
    setOcupado(false)
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-4 p-8">
      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* --- La lista de conversaciones ------------------------------------ */}
        <div className="w-64 shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {conversaciones === null ? (
            <Cargando />
          ) : conversaciones.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-500">Todavía no llegó ningún mensaje.</p>
          ) : (
            <ul>
              {conversaciones.map((conversacion) => (
                <li key={conversacion.id}>
                  <button
                    type="button"
                    onClick={() => setSeleccionada(conversacion.id)}
                    className={cx(
                      'flex w-full items-start gap-2 border-b border-slate-100 px-3 py-3 text-left transition-colors',
                      conversacion.id === seleccionada ? 'bg-marino-50' : 'hover:bg-slate-50',
                    )}
                  >
                    <Icono
                      nombre={conversacion.plataforma === 'FACEBOOK' ? 'facebook' : 'instagram'}
                      tamano={15}
                      className="mt-0.5 shrink-0 text-marino-700"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{conversacion.participanteNombre}</p>
                      <p className="text-xs text-slate-400">{cuando(conversacion.ultimoMensajeEn)}</p>
                    </div>
                    {!conversacion.puedeResponder && <Icono nombre="alerta" tamano={14} className="mt-0.5 shrink-0 text-amber-700" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* --- La conversación abierta ---------------------------------------- */}
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white">
          {!conversacionActual ? (
            <p className="flex flex-1 items-center justify-center text-sm text-slate-500">
              {conversaciones === null ? '' : 'Elegí una conversación de la lista.'}
            </p>
          ) : (
            <>
              <div className="border-b border-slate-200 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">{conversacionActual.participanteNombre}</p>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
                {mensajes === null ? (
                  <Cargando />
                ) : (
                  mensajes.map((mensaje) => (
                    <div key={mensaje.id} className={cx('flex', mensaje.direccion === 'SALIENTE' ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cx(
                          'max-w-[75%] rounded-xl px-3 py-2 text-sm',
                          mensaje.direccion === 'SALIENTE' ? 'bg-marino-700 text-white' : 'bg-slate-100 text-slate-800',
                        )}
                      >
                        <p>{mensaje.mensaje}</p>
                        <p className={cx('mt-1 text-[10px]', mensaje.direccion === 'SALIENTE' ? 'text-marino-100' : 'text-slate-400')}>
                          {cuando(mensaje.creadoEnMeta)}
                          {mensaje.enviadoPor ? ` · ${mensaje.enviadoPor}` : ''}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-slate-200 p-3">
                {!puedeEditar ? (
                  <Alerta tono="aviso">Tenés Marketing en sólo lectura: podés ver los mensajes pero no responder.</Alerta>
                ) : !conversacionActual.puedeResponder ? (
                  <AvisoLimitacionMeta motivo={conversacionActual.motivoSiNoPuedeResponder ?? 'No se puede responder esta conversación desde acá.'} />
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={texto}
                      onChange={(evento) => setTexto(evento.target.value)}
                      onKeyDown={(evento) => {
                        if (evento.key === 'Enter') void responder()
                      }}
                      placeholder="Escribí un mensaje…"
                      maxLength={2_000}
                      className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
                    />
                    <Boton variante="primario" onClick={() => void responder()} cargando={ocupado} disabled={!texto.trim()}>
                      Enviar
                    </Boton>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
