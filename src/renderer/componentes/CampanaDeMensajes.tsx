// La campana de mensajes de la barra superior: el globito con lo que no leíste y el aviso sonoro.
//
// Acá es donde suena el aviso cuando llega un mensaje, y suena el MISMO sonido que el resto de las
// notificaciones del programa (la campana): la agencia pidió eso y además es lo correcto —un sonido
// nuevo para cada cosa termina en cuatro sonidos que nadie distingue—.
//
// Quién decide que suene: `useAvisoNuevo`, que ya resuelve lo difícil. Compara los IDENTIFICADORES de
// lo que no leíste, no la cantidad: un contador vuelve a cero cuando abrís la conversación y volvería
// a subir por el mismo mensaje de siempre. Y la primera consulta no suena nunca: al abrir el programa
// a la mañana hay mensajes sin leer y ninguno es una novedad.
//
// Lo que NO hace sonar nada: que se mueva un tilde (que el otro haya leído lo tuyo). Para eso está el
// segundo evento del proceso principal, que sólo redibuja. Un chat que suena cada vez que el otro lee
// algo es un chat que se termina silenciando.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AvisosDeMensajes } from '../../shared/tipos'
import { useNavegacion } from '../contexto/Navegacion'
import { useAvisoNuevo } from '../sonidos/useAvisoNuevo'
import { Icono } from './Icono'
import { cx, haceCuanto } from './ui'

export function CampanaDeMensajes() {
  const { ir } = useNavegacion()
  const [avisos, setAvisos] = useState<AvisosDeMensajes | null>(null)
  const [abierta, setAbierta] = useState(false)
  const contenedor = useRef<HTMLDivElement | null>(null)

  const consultar = useCallback(async () => {
    const respuesta = await window.dm.mensajes.avisos()
    // Un error acá no se muestra: es una campana, y sin permiso sobre el módulo simplemente no hay nada
    // que contar. La pantalla de Mensajes sí explica lo que pasa.
    if (respuesta.ok) setAvisos(respuesta.datos)
  }, [])

  useEffect(() => {
    // Sin reloj de respaldo (14.0). Existía porque el cartero era un long-poll que podía quedarse
    // colgado sin que nadie se enterara; ahora el servidor empuja `{t:'mensajes'}` por el canal y, si
    // el canal se cae, al reconectar se piden las novedades de una (`reconciliar()`). Los dos eventos
    // de acá abajo cubren todo lo que puede cambiar el globito.
    void consultar()
    const soltarLlegada = window.dm.mensajes.alLlegarAlguno(() => void consultar())
    const soltarCambio = window.dm.mensajes.alCambiarAlgo(() => void consultar())
    return () => {
      soltarLlegada()
      soltarCambio()
    }
  }, [consultar])

  // `null` mientras no llegó la primera respuesta: si no, la campana sonaría al abrir el programa por
  // los mensajes de ayer.
  useAvisoNuevo(avisos ? avisos.ids : null, 'campana')

  useEffect(() => {
    if (!abierta) return
    const alTocar = (evento: MouseEvent) => {
      if (contenedor.current && !contenedor.current.contains(evento.target as Node)) setAbierta(false)
    }
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAbierta(false)
    }
    document.addEventListener('mousedown', alTocar)
    window.addEventListener('keydown', alTeclear)
    return () => {
      document.removeEventListener('mousedown', alTocar)
      window.removeEventListener('keydown', alTeclear)
    }
  }, [abierta])

  const sinLeer = avisos?.sinLeer ?? 0

  return (
    <div className="relative" ref={contenedor}>
      <button
        type="button"
        onClick={() => setAbierta((antes) => !antes)}
        aria-label={sinLeer === 0 ? 'Mensajes: no tenés nada sin leer' : `Mensajes: ${sinLeer} sin leer`}
        aria-expanded={abierta}
        className={cx(
          'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-slate-600 transition-colors',
          'hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          abierta && 'bg-slate-100 text-slate-900',
        )}
      >
        <Icono nombre="mensaje" tamano={18} />
        {sinLeer > 0 && <span className="text-xs font-bold tabular-nums">{sinLeer}</span>}
        {sinLeer > 0 && (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
        )}
      </button>

      {abierta && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold text-slate-800">Mensajes sin leer</p>
          </div>
          {!avisos || avisos.conversaciones.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-500">No tenés mensajes sin leer.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {avisos.conversaciones.map((conversacion) => (
                <li key={conversacion.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAbierta(false)
                      ir('mensajes')
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-800">{conversacion.titulo}</span>
                        {conversacion.ultimoEn && (
                          <span className="shrink-0 text-xs text-slate-400">{haceCuanto(conversacion.ultimoEn)}</span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-slate-500">{conversacion.ultimoTexto}</span>
                        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-marino-700 px-1.5 text-xs font-bold text-white tabular-nums">
                          {conversacion.sinLeer}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-slate-100 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setAbierta(false)
                ir('mensajes')
              }}
              className="text-sm font-semibold text-marino-700 hover:underline"
            >
              Abrir Mensajes
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
