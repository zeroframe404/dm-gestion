// La dirección de la página (lo que va después de dmartinezseguros.com/p/): el campo con el prefijo,
// el chequeo de si está libre mientras se escribe, y el diálogo «Dirección» del editor. El campo lo usa
// también la bienvenida, para elegir la dirección antes de crear la página.
import { useEffect, useId, useState, type FormEvent } from 'react'
import { PREFIJO_DE_MI_LINK, URL_BASE_DE_MI_LINK } from '../../../../shared/miLink'
import { Icono } from '../../../componentes/Icono'
import { Alerta, Boton, Dialogo, cx } from '../../../componentes/ui'
import { direccionEscrita, motivoDeDireccion } from './reglas'

/** «dmartinezseguros.com/p/»: lo que se ve fijo delante del campo. */
export const PREFIJO_VISIBLE = `${URL_BASE_DE_MI_LINK.replace(/^https?:\/\//, '')}${PREFIJO_DE_MI_LINK}`

/** Lo que espera el chequeo antes de preguntarle al servidor: no se pregunta por cada letra. */
const DEMORA_DEL_CHEQUEO_MS = 450

export type ChequeoDeDireccion =
  | { estado: 'invalida'; motivo: string }
  | { estado: 'revisando' }
  | { estado: 'libre' }
  | { estado: 'actual' }
  | { estado: 'tomada'; motivo: string }
  /** No se pudo preguntar (sin conexión): no se sabe, y guardar lo va a decir. */
  | { estado: 'sin-respuesta'; motivo: string }

/**
 * Si la dirección se puede usar. La forma se mira acá (al toque); si la forma está bien, se le pregunta
 * al servidor con una demora. `actual` es la de la página: esa siempre está «libre» para su dueño, y se
 * la muestra distinto para que no parezca que hay algo que guardar.
 */
export function useChequeoDeDireccion(direccion: string, actual: string | null): ChequeoDeDireccion {
  const motivo = motivoDeDireccion(direccion)
  const [respuesta, setRespuesta] = useState<{ direccion: string; chequeo: ChequeoDeDireccion } | null>(null)

  useEffect(() => {
    if (motivo || direccion === actual) return
    let vigente = true
    const espera = window.setTimeout(() => {
      void window.dm.miLink.direccionLibre(direccion).then((resultado) => {
        if (!vigente) return
        const chequeo: ChequeoDeDireccion = !resultado.ok
          ? { estado: 'sin-respuesta', motivo: resultado.error }
          : resultado.datos.libre
            ? { estado: 'libre' }
            : { estado: 'tomada', motivo: resultado.datos.motivo ?? 'Esa dirección ya la tiene otra persona. Probá con otra.' }
        setRespuesta({ direccion, chequeo })
      })
    }, DEMORA_DEL_CHEQUEO_MS)
    return () => {
      vigente = false
      window.clearTimeout(espera)
    }
  }, [direccion, actual, motivo])

  if (motivo) return { estado: 'invalida', motivo }
  if (direccion === actual) return { estado: 'actual' }
  // Una respuesta vieja (de lo que había antes de la última letra) no vale para lo que hay ahora.
  if (!respuesta || respuesta.direccion !== direccion) return { estado: 'revisando' }
  return respuesta.chequeo
}

/** Si con ese chequeo se puede tocar «Guardar». Sin respuesta se deja: el servidor dirá que no si no va. */
export function chequeoPermiteGuardar(chequeo: ChequeoDeDireccion): boolean {
  return chequeo.estado === 'libre' || chequeo.estado === 'sin-respuesta'
}

export function CampoDeDireccion({
  valor,
  alCambiar,
  chequeo,
  autoFocus = false,
}: {
  valor: string
  alCambiar: (valor: string) => void
  chequeo: ChequeoDeDireccion
  autoFocus?: boolean
}) {
  const mal = chequeo.estado === 'invalida' || chequeo.estado === 'tomada'
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        Dirección de tu página
      </label>
      <div
        className={cx(
          'flex h-11 items-center overflow-hidden rounded-lg border bg-white text-sm transition-colors',
          'focus-within:ring-2',
          mal ? 'border-red-300 focus-within:ring-red-500/25' : 'border-slate-300 focus-within:border-marino-500 focus-within:ring-marino-500/25',
        )}
      >
        <span className="flex h-full shrink-0 items-center border-r border-slate-200 bg-slate-50 px-3 text-slate-500 select-none">{PREFIJO_VISIBLE}</span>
        <input
          id={id}
          value={valor}
          onChange={(evento) => alCambiar(direccionEscrita(evento.target.value))}
          maxLength={40}
          spellCheck={false}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={mal || undefined}
          aria-describedby={`${id}-estado`}
          className="h-full min-w-0 flex-1 bg-transparent px-3 font-medium text-slate-900 outline-none"
        />
      </div>
      <p id={`${id}-estado`} className="flex min-h-5 items-center gap-1.5 text-xs" aria-live="polite">
        {chequeo.estado === 'revisando' && (
          <span className="flex items-center gap-1.5 text-slate-500">
            <Icono nombre="cargando" tamano={13} className="animate-spin" /> Fijándome si está libre…
          </span>
        )}
        {chequeo.estado === 'libre' && (
          <span className="flex items-center gap-1.5 font-semibold text-green-700">
            <Icono nombre="ok" tamano={13} /> Está libre.
          </span>
        )}
        {chequeo.estado === 'actual' && <span className="text-slate-500">Es la dirección que tiene tu página ahora.</span>}
        {(chequeo.estado === 'invalida' || chequeo.estado === 'tomada') && <span className="text-red-600">{chequeo.motivo}</span>}
        {chequeo.estado === 'sin-respuesta' && <span className="text-amber-700">No pude fijarme si está libre: {chequeo.motivo}</span>}
      </p>
    </div>
  )
}

export function DialogoDireccion({
  actual,
  publicada,
  alGuardar,
  alCerrar,
}: {
  actual: string
  publicada: boolean
  /** Guarda la dirección nueva. Devuelve el error para mostrar, o null si se guardó. */
  alGuardar: (direccion: string) => Promise<string | null>
  alCerrar: () => void
}) {
  const [direccion, setDireccion] = useState(actual)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chequeo = useChequeoDeDireccion(direccion, actual)

  const guardar = async (evento?: FormEvent) => {
    evento?.preventDefault()
    if (!chequeoPermiteGuardar(chequeo) || guardando) return
    setGuardando(true)
    setError(null)
    const problema = await alGuardar(direccion)
    setGuardando(false)
    if (problema) setError(problema)
    else alCerrar()
  }

  return (
    <Dialogo
      abierto
      titulo="Dirección de tu página"
      descripcion="Es el link que vas a compartir. Cortita y fácil de dictar por teléfono es mejor."
      alCerrar={alCerrar}
      ancho="lg"
      pie={
        <>
          <Boton variante="fantasma" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" escribe cargando={guardando} disabled={!chequeoPermiteGuardar(chequeo)} onClick={() => void guardar()}>
            Guardar dirección
          </Boton>
        </>
      }
    >
      <form onSubmit={(evento) => void guardar(evento)} className="flex flex-col gap-4">
        <CampoDeDireccion valor={direccion} alCambiar={setDireccion} chequeo={chequeo} autoFocus />
        {/* El link viejo deja de andar en el momento: quien lo tenga guardado ve «no disponible». */}
        {publicada && direccion !== actual && (
          <Alerta tono="aviso">
            Si ya compartiste <strong>{PREFIJO_VISIBLE + actual}</strong>, ese link deja de funcionar apenas guardes la nueva.
          </Alerta>
        )}
        {error && <Alerta tono="error">{error}</Alerta>}
      </form>
    </Dialogo>
  )
}
