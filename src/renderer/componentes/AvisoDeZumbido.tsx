// El zumbido, del lado de la ventana: el sonido y el cartelito de quién fue.
//
// El reparto de tareas con el proceso principal es el mismo de siempre y conviene tenerlo claro:
//   - **Mover la ventana** lo hace el proceso principal (`sacudirLaVentana`). Es el único que puede:
//     el renderer vive adentro de la ventana y no la puede correr de lugar.
//   - **El sonido** lo hace esto. Es donde vive el `<audio>` del programa, con el volumen y el
//     interruptor de silencio de esta computadora. Que el zumbido respete ese interruptor es a
//     propósito: el botón sirve para llamar la atención de alguien, no para saltearle las preferencias.
//
// Vive en el marco y no en la pantalla de Mensajes porque un zumbido llega estando en Cartera, en la
// caja o en cualquier otro lado —que es justamente cuando hace falta—.
//
// El cartel dice de quién fue. Sin eso, en una agencia de cinco personas, un zumbido es una ventana
// que se movió sola y un ruido: nadie sabe a quién contestarle.
import { useEffect, useState } from 'react'
import { reproducir } from '../sonidos'
import { Icono } from './Icono'

/** Cuánto queda el cartel a la vista: lo que dura leer un nombre, y se va solo. */
const DURACION_MS = 5_000

export function AvisoDeZumbido() {
  const [quien, setQuien] = useState<string | null>(null)

  useEffect(() => {
    const dejarDeEscuchar = window.dm.mensajes.alZumbar((datos) => {
      reproducir('zumbido')
      setQuien(datos.autor)
    })
    return dejarDeEscuchar
  }, [])

  useEffect(() => {
    if (!quien) return
    const reloj = setTimeout(() => setQuien(null), DURACION_MS)
    return () => clearTimeout(reloj)
  }, [quien])

  if (!quien) return null

  return (
    <div
      role="status"
      aria-live="assertive"
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-amber-300 bg-white px-4 py-3 shadow-media"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Icono nombre="altavoz" tamano={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">{quien} te mandó un zumbido</span>
        <span className="block text-xs text-slate-600">Quiere que mires los mensajes ahora.</span>
      </span>
    </div>
  )
}
