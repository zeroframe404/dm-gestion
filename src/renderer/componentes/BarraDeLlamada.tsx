// La barra de la llamada en curso (14.0): «En llamada con Ana · 3:12», silenciar y cortar.
//
// Va arriba de la barra superior, con el mismo lugar y la misma forma que el banner de «sin conexión»,
// y por el mismo motivo: mientras se está hablando hay que poder cortar desde cualquier pantalla, y una
// barra de arriba de todo es lo único que no depende de en qué módulo esté la persona. Debajo del
// banner de la conexión a propósito: si se cortó internet, eso se lee primero (la llamada, en cambio,
// sigue: el audio va punto a punto y no pasa por el VPS).
//
// Con la llamada TIMBRANDO no se dibuja nada: eso lo cuenta la tarjeta de `AvisoDeLlamadaEntrante`,
// que tiene los botones de atender y rechazar. Acá arranca cuando la llamada es de esta computadora
// («Llamando a…») o cuando ya se está hablando.
//
// El botón de silenciar apaga el MICRÓFONO de esta computadora, no el parlante: es lo que hace el mute
// de cualquier teléfono. La otra punta no se entera —escucha silencio—, así que el estado tiene que
// quedar clarísimo de este lado: el botón cambia de texto, de ícono y de color.
//
// La franja roja de abajo es para lo único que la pantalla sabe y el proceso principal no: que el
// micrófono de ESTA computadora no se pudo usar. Se queda hasta que alguien la cierra porque es la
// explicación de una llamada que se cortó sola, y si se fuera a los cinco segundos nadie se enteraría
// de por qué.
//
// Y la franja gris es POR QUÉ se cortó la última (14.0). Una llamada que se cierra sola no deja
// rastro: el servidor contesta «ocupado» en menos de un segundo, la barra verde aparece y desaparece
// antes de que nadie llegue a leerla, y «está hablando con otro», «te rechazó» y «se cayó internet» se
// ven exactamente igual. Sin el cartel, lo que hace la persona es volver a apretar «Llamar».
import { useEffect, useRef, useState } from 'react'
import type { SituacionDeLlamada } from '../../shared/tipos'
import { duracionLegible, useLlamada } from '../contexto/Llamada'
import { fraseDelCorte } from './llamada-reglas'
import { Icono } from './Icono'
import { cx } from './ui'

/** Cuánto se queda el cartel del corte. Lo que tarda en leerse una frase y decidir si se vuelve a llamar. */
const LO_QUE_DURA_EL_CARTEL_MS = 8_000

export function BarraDeLlamada() {
  const { situacion, con, duracion, silenciada, silenciar, colgar, motivo, fallaDeAudio, olvidarLaFalla } = useLlamada()
  const hablando = situacion === 'en-llamada'
  const llamando = situacion === 'llamando'

  // El cartel se enciende con la TRANSICIÓN a «libre» y no con el motivo a secas: el motivo se queda
  // guardado en el proceso principal hasta la llamada siguiente, así que mirarlo solo haría aparecer el
  // cartel de la llamada de hace media hora cada vez que esta barra se vuelve a montar.
  const [cartel, setCartel] = useState<string | null>(null)
  const anterior = useRef<SituacionDeLlamada>(situacion)
  useEffect(() => {
    const antes = anterior.current
    anterior.current = situacion
    if (situacion !== 'libre' || antes === 'libre') return
    const frase = fraseDelCorte(motivo)
    if (!frase) return
    setCartel(frase)
    const reloj = setTimeout(() => setCartel(null), LO_QUE_DURA_EL_CARTEL_MS)
    return () => clearTimeout(reloj)
  }, [situacion, motivo])

  return (
    <>
      {(hablando || llamando) && con && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-center gap-3 bg-emerald-700 px-4 py-1.5 text-xs font-semibold text-white"
        >
          <span className="flex min-w-0 items-center gap-2">
            <Icono nombre="telefono" tamano={14} className={cx(llamando && 'animate-pulse')} />
            <span className="truncate">
              {llamando ? `Llamando a ${con.nombre}…` : `En llamada con ${con.nombre}`}
            </span>
            {hablando && <span className="tabular-nums text-emerald-100">· {duracionLegible(duracion)}</span>}
            {silenciada && hablando && <span className="text-amber-200">· micrófono apagado</span>}
          </span>

          {hablando && (
            <button
              type="button"
              onClick={() => silenciar(!silenciada)}
              aria-pressed={silenciada}
              title={
                silenciada
                  ? 'Volver a hablar: la otra persona te escucha de nuevo'
                  : 'Apagar el micrófono: la otra persona deja de escucharte (vos la seguís escuchando)'
              }
              className={cx(
                'inline-flex h-6 items-center gap-1.5 rounded-md px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                silenciada ? 'bg-amber-400 text-amber-950 hover:bg-amber-300' : 'bg-white/15 text-white hover:bg-white/25',
              )}
            >
              <Icono nombre={silenciada ? 'microfonoTachado' : 'microfono'} tamano={13} />
              {silenciada ? 'Hablar' : 'Silenciar'}
            </button>
          )}

          <button
            type="button"
            onClick={colgar}
            title={llamando ? 'Cancelar la llamada' : 'Cortar la llamada'}
            className="inline-flex h-6 items-center gap-1.5 rounded-md bg-red-600 px-2 text-white transition-colors hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Icono nombre="telefonoCortado" tamano={13} />
            {llamando ? 'Cancelar' : 'Cortar'}
          </button>
        </div>
      )}

      {cartel && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-slate-700 px-4 py-1.5 text-xs font-semibold text-white"
        >
          <Icono nombre="telefonoCortado" tamano={14} />
          <span className="min-w-0 truncate">{cartel}</span>
        </div>
      )}

      {fallaDeAudio && (
        <div
          role="alert"
          className="flex items-center justify-center gap-3 bg-red-700 px-4 py-1.5 text-xs font-semibold text-white"
        >
          <Icono nombre="alerta" tamano={14} />
          <span className="min-w-0">{fallaDeAudio}</span>
          <button
            type="button"
            onClick={olvidarLaFalla}
            aria-label="Cerrar el aviso del micrófono"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/15 transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <Icono nombre="cerrar" tamano={13} />
          </button>
        </div>
      )}
    </>
  )
}
