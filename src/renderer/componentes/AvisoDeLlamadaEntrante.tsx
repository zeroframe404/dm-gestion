// La llamada que entra (14.0): la tarjeta con la cara de quien llama y los dos botones.
//
// Vive en el marco y no en la pantalla de Mensajes, por lo mismo que el aviso del zumbido: una llamada
// llega estando en Cartera, en la caja o en cualquier otro lado —que es justamente cuando hace falta—.
// El proceso principal además mueve la ventana y saca la notificación del sistema (`atender` en
// `main/vivo/llamadas.ts`); acá se hace lo que sólo se puede hacer desde la ventana: el TONO y la cara.
//
// El tono suena EN BUCLE mientras la tarjeta está a la vista y se corta solo cuando se desmonta —al
// atender, al rechazar, cuando el que llama se cansa (45 segundos, los cuenta el proceso principal) o
// si se cae el canal—. No hay ningún `setTimeout` acá: la tarjeta no decide cuánto suena, se cuelga de
// la máquina de estados, que es la única que sabe si la llamada todavía existe.
//
// Los dos botones son grandes y de colores opuestos a propósito: se aprietan apurado, mirando el
// teléfono de la mano o al cliente del mostrador, y equivocarse es cortarle a alguien en la cara.
import { useEffect } from 'react'
import { useLlamada } from '../contexto/Llamada'
import { reproducirEnBucle } from '../sonidos'
import { Avatar } from './Avatar'
import { Icono } from './Icono'

export function AvisoDeLlamadaEntrante() {
  const { situacion, con, aceptar, rechazar } = useLlamada()
  const timbrando = situacion === 'timbrando'

  useEffect(() => {
    if (!timbrando) return
    return reproducirEnBucle('tonoDeLlamada')
  }, [timbrando])

  if (!timbrando || !con) return null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={`${con.nombre} te está llamando`}
      className="fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-3 rounded-xl border border-marino-200 bg-white p-4 shadow-media"
    >
      <div className="flex items-center gap-3">
        <Avatar clave={con.clave} nombre={con.nombre} tamano="lg" anillo />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{con.nombre}</p>
          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            {/* El ícono acompañando el texto y no solo: «te está llamando» sin nada más se lee como un
                mensaje escrito, que es lo que la persona acaba de dejar de mirar. */}
            <Icono nombre="telefono" tamano={13} className="animate-pulse" />
            Te está llamando
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={aceptar}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
          <Icono nombre="telefono" tamano={16} />
          Atender
        </button>
        <button
          type="button"
          onClick={rechazar}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          <Icono nombre="telefonoCortado" tamano={16} />
          Rechazar
        </button>
      </div>
    </div>
  )
}
