// Marketing → Redes → Comentarios: la bandeja de comentarios de la cuenta de una sucursal.
//
// Se arma con lo que ya juntó el webhook del servidor (no hay «actualizar»: los nuevos aparecen
// solos la próxima vez que se abre o se refresca la pestaña). Contestar, ocultar/mostrar y eliminar
// pegan directo contra Meta; cuando Meta no deja hacer alguna de esas tres cosas con un comentario
// puntual, el motivo real que dio Meta queda guardado en el comentario y esta pantalla lo muestra
// como el aviso amarillo, en vez de dejar el botón ahí sin explicar por qué no funciona.
import { useCallback, useEffect, useState } from 'react'
import type { ComentarioDeRed } from '../../../shared/tipos'
import { AvisoLimitacionMeta } from '../../componentes/AvisoLimitacionMeta'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Cargando, Dialogo, cx } from '../../componentes/ui'

function cuando(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : fecha.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

interface Props {
  sucursal: string
  puedeEditar: boolean
}

export function Comentarios({ sucursal, puedeEditar }: Props) {
  const [comentarios, setComentarios] = useState<ComentarioDeRed[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [soloSinResponder, setSoloSinResponder] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [respuestas, setRespuestas] = useState<Record<string, string>>({})
  const [aEliminar, setAEliminar] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const resultado = await window.dm.redes.comentarios(sucursal, soloSinResponder)
    if (resultado.ok) {
      setComentarios(resultado.datos)
      setError(null)
    } else {
      setError(resultado.error)
    }
  }, [sucursal, soloSinResponder])

  useEffect(() => {
    setComentarios(null)
    void cargar()
  }, [cargar])

  const reemplazar = (actualizado: ComentarioDeRed) => {
    setComentarios((actuales) => (actuales ? actuales.map((c) => (c.id === actualizado.id ? actualizado : c)) : actuales))
  }

  const responder = async (comentario: ComentarioDeRed) => {
    const mensaje = (respuestas[comentario.id] ?? '').trim()
    if (!mensaje) return
    setOcupado(`responder-${comentario.id}`)
    setError(null)
    const resultado = await window.dm.redes.comentarioResponder(comentario.id, mensaje)
    if (resultado.ok) {
      reemplazar(resultado.datos)
      setRespuestas((actuales) => ({ ...actuales, [comentario.id]: '' }))
    } else {
      setError(resultado.error)
    }
    setOcupado(null)
  }

  const cambiarVisibilidad = async (comentario: ComentarioDeRed) => {
    setOcupado(`ocultar-${comentario.id}`)
    setError(null)
    const ocultar = comentario.estado !== 'OCULTO'
    const resultado = ocultar ? await window.dm.redes.comentarioOcultar(comentario.id) : await window.dm.redes.comentarioMostrar(comentario.id)
    if (resultado.ok) reemplazar(resultado.datos)
    else setError(resultado.error)
    setOcupado(null)
  }

  const eliminar = async (comentarioId: string) => {
    setOcupado(`eliminar-${comentarioId}`)
    setError(null)
    const resultado = await window.dm.redes.comentarioEliminar(comentarioId)
    setAEliminar(null)
    if (resultado.ok) setComentarios((actuales) => actuales?.filter((c) => c.id !== comentarioId) ?? actuales)
    else setError(resultado.error)
    setOcupado(null)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-8">
      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">Comentarios de {sucursal}</h2>
          <p className="text-xs text-slate-400">Las respuestas a una Historia no entran acá: Meta no las expone como comentarios.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={soloSinResponder} onChange={(evento) => setSoloSinResponder(evento.target.checked)} />
          Sólo sin responder
        </label>
      </div>

      {comentarios === null ? (
        <Cargando />
      ) : comentarios.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
          {soloSinResponder ? 'No hay comentarios sin responder.' : 'Todavía no llegó ningún comentario.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comentarios.map((comentario) => {
            const oculto = comentario.estado === 'OCULTO'
            return (
              <li key={comentario.id} className={cx('rounded-xl border border-slate-200 bg-white p-4', oculto && 'opacity-60')}>
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-marino-700 text-white">
                    <Icono nombre={comentario.plataforma === 'FACEBOOK' ? 'facebook' : 'instagram'} tamano={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold text-slate-900">{comentario.autorNombre}</span>{' '}
                      <span className="text-xs text-slate-400">{cuando(comentario.creadoEnMeta)}</span>
                      {oculto && <span className="ml-2 text-xs font-semibold text-amber-700">Oculto</span>}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-700">{comentario.mensaje}</p>

                    {comentario.respuestas.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1.5 border-l-2 border-slate-100 pl-3">
                        {comentario.respuestas.map((respuesta) => (
                          <li key={respuesta.id} className="text-xs text-slate-600">
                            <span className="font-semibold text-slate-700">{respuesta.respondidoPor}:</span> {respuesta.mensaje}
                          </li>
                        ))}
                      </ul>
                    )}

                    {puedeEditar && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {comentario.puedeOcultar && (
                          <Boton
                            tamano="sm"
                            icono={oculto ? 'ojo' : 'ojoTachado'}
                            onClick={() => void cambiarVisibilidad(comentario)}
                            cargando={ocupado === `ocultar-${comentario.id}`}
                          >
                            {oculto ? 'Mostrar' : 'Ocultar'}
                          </Boton>
                        )}
                        {comentario.puedeEliminar && (
                          <Boton tamano="sm" icono="basura" onClick={() => setAEliminar(comentario.id)}>
                            Eliminar
                          </Boton>
                        )}
                      </div>
                    )}

                    {comentario.motivoSiNoPuede && (!comentario.puedeResponder || !comentario.puedeOcultar || !comentario.puedeEliminar) && (
                      <div className="mt-2">
                        <AvisoLimitacionMeta motivo={comentario.motivoSiNoPuede} />
                      </div>
                    )}

                    {puedeEditar && comentario.puedeResponder && (
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="text"
                          value={respuestas[comentario.id] ?? ''}
                          onChange={(evento) => setRespuestas((actuales) => ({ ...actuales, [comentario.id]: evento.target.value }))}
                          onKeyDown={(evento) => {
                            if (evento.key === 'Enter') void responder(comentario)
                          }}
                          placeholder="Escribí una respuesta…"
                          maxLength={2_200}
                          className="h-9 flex-1 rounded-lg border border-slate-300 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
                        />
                        <Boton
                          tamano="sm"
                          variante="primario"
                          onClick={() => void responder(comentario)}
                          cargando={ocupado === `responder-${comentario.id}`}
                          disabled={!(respuestas[comentario.id] ?? '').trim()}
                        >
                          Responder
                        </Boton>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialogo
        abierto={aEliminar !== null}
        titulo="¿Eliminar este comentario?"
        descripcion="Se borra de Facebook o Instagram. No se puede deshacer."
        alCerrar={() => setAEliminar(null)}
        ancho="sm"
        pie={
          <>
            <Boton onClick={() => setAEliminar(null)}>Cancelar</Boton>
            <Boton variante="peligro" onClick={() => aEliminar && void eliminar(aEliminar)} cargando={ocupado === `eliminar-${aEliminar}`}>
              Eliminar
            </Boton>
          </>
        }
      >
        <p className="text-sm text-slate-600">Esta acción es igual a eliminarlo desde la red social: no queda ningún rastro.</p>
      </Dialogo>
    </div>
  )
}
