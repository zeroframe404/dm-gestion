// «Eso ya lo había cambiado otro» (14.0): el cartel de cuando la base le gana a esta computadora.
//
// Hasta la 13.x el último que llegaba ganaba y el pisado quedaba anotado en el historial, donde no lo
// leía nadie. Desde la 14.0 cada celda viaja con el valor que tenía cuando se empezó a editar y el
// servidor la rechaza si cambió en el medio (409): gana la base, y lo que se cargó acá NO se guardó.
// Eso hay que decirlo en la cara, en el momento, o la persona se entera dentro de un mes cuando el
// número que ella cargó no está.
//
// Vive en el marco, fuera del módulo activo, por lo mismo que `AvisoDeTareaHecha`: el rechazo llega
// del ciclo de subida, que corre esté abierta la pantalla que esté.
//
// SIN SONIDO, a diferencia de la tarea completada: el aviso llega junto con la bajada de la pestaña,
// así que el valor que ganó ya se está dibujando solo delante de los ojos. Un sonido nuevo por cada
// celda rechazada de una tanda sería una ametralladora.
import { useEffect, useState } from 'react'
import { Icono } from './Icono'

/** Más que el de la tarea completada: acá hay que leer dos valores y entender cuál quedó. */
const DURACION_MS = 9_000

interface Aviso {
  campo: string
  valorLocal: string
  valorServidor: string
  /** Cuántas más llegaron mientras éste estaba a la vista. Una tanda rechazada puede traer varias. */
  otras: number
}

export function AvisoDePisado() {
  const [aviso, setAviso] = useState<Aviso | null>(null)

  useEffect(() => {
    return window.dm.sincronizacion.alPisarUnDato((pisada) => {
      // Se muestra la última y se cuentan las anteriores en vez de encolarlas: apilar carteles de
      // nueve segundos por una tanda de diez celdas taparía la pantalla justo cuando hay que mirarla.
      setAviso((antes) => ({
        campo: pisada.campo,
        valorLocal: pisada.valorLocal,
        valorServidor: pisada.valorServidor,
        otras: antes ? antes.otras + 1 : 0,
      }))
    })
  }, [])

  useEffect(() => {
    if (!aviso) return
    const reloj = setTimeout(() => setAviso(null), DURACION_MS)
    return () => clearTimeout(reloj)
  }, [aviso])

  if (!aviso) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-amber-200 bg-white px-4 py-3 shadow-media"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Icono nombre="alerta" tamano={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">Tu cambio no se guardó</span>
        <span className="block text-xs text-slate-600">
          «{aviso.campo}» ya lo había cambiado otra computadora. Quedó <strong className="font-semibold">{textoDeValor(aviso.valorServidor)}</strong>{' '}
          y no lo tuyo ({textoDeValor(aviso.valorLocal)}).
        </span>
        {aviso.otras > 0 && (
          <span className="mt-0.5 block text-xs text-slate-500">
            Y {aviso.otras} {aviso.otras === 1 ? 'cambio más' : 'cambios más'} en la misma situación: mirá Administración → Sincronización.
          </span>
        )}
      </span>
    </div>
  )
}

/** Una celda vacía tiene que leerse como algo; el hueco entre comillas no se distingue de un error. */
function textoDeValor(valor: string): string {
  return valor.trim() === '' ? '(vacío)' : `«${valor}»`
}
