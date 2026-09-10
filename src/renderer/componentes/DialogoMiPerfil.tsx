// «Mi perfil» (14.0): la foto y el color con los que esta persona se ve en las otras cuatro
// computadoras de la agencia.
//
// EL MISMO BLOQUE EN DOS LADOS. `BloqueDePerfil` es el formulario; el diálogo de acá lo usa para el
// perfil propio (`perfiles:guardarMio`) y Administración → Usuarios lo usa para ponerle foto y color
// a otra persona (`perfiles:guardarDe`, sólo administradores). Es el mismo dibujo y la misma
// validación porque es el mismo dato: si estuviera escrito dos veces, la grilla de colores tomados se
// arreglaría en uno y quedaría mal en el otro.
//
// POR QUÉ SE RECORTA ACÁ Y NO SE MANDA EL ARCHIVO. La foto viaja por el canal a las otras
// computadoras y se guarda en `dmg_perfiles`, que es una tabla y no un depósito de archivos: una foto
// de teléfono de 4 MB multiplicada por cinco personas y bajada en cada saludo del canal no es una
// opción. Entra cualquier imagen y sale un cuadrado de 256×256 en JPEG de unos 20 KB, siempre.
//
// POR QUÉ CON ARRASTRE Y ZOOM Y NO UN RECORTE AUTOMÁTICO. Las fotos que trae la gente son verticales
// y con la cara arriba; un recorte centrado a ciegas devuelve un torso. Arrastrar y acercar es lo que
// ya sabe hacer cualquiera que puso una foto en WhatsApp.
//
// LOS COLORES TOMADOS NO SE PUEDEN ELEGIR. El servidor tiene `UNIQUE` en la columna y contesta 409
// —dos personas del mismo color harían del glow un adorno inútil—, así que la grilla los muestra
// marcados y apagados. Igual puede pasar que dos elijan el mismo en el mismo segundo: para eso el
// error del servidor se muestra tal como viene, que es el que sabe quién llegó primero.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CANTIDAD_DE_COLORES, PALETA, colorDePaleta } from '../../shared/paleta'
import type { DatosDePerfil } from '../../shared/tipos'
import { usePerfiles } from '../contexto/Perfiles'
import { useUsuarioActual } from '../contexto/Sesion'
import { claveDeUsuario } from '../../shared/texto'
import { Avatar } from './Avatar'
import { Icono } from './Icono'
import { Alerta, Boton, Dialogo, cx } from './ui'

/** El lado del recorte, en píxeles. Lo mismo que espera el servidor y lo que se guarda. */
const LADO_DEL_RECORTE = 256

/**
 * Hasta cuánto puede pesar la data URL. El protocolo dice 40 KB y el proceso principal corta en 64;
 * se apunta a 36 para dejar aire, porque el que rebota es el servidor y ahí ya se perdió el viaje.
 */
const TOPE_DE_LA_FOTO = 36 * 1024

/** Las calidades que se prueban, de mejor a peor, hasta que el JPEG entra en el tope. */
const CALIDADES = [0.82, 0.7, 0.6, 0.5, 0.4]

/** Cuánto se puede acercar la foto dentro del recorte. */
const ZOOM_MINIMO = 1
const ZOOM_MAXIMO = 3

/** Lo grande que se dibuja el recorte en pantalla. El canvas siempre exporta 256; esto es sólo el CSS. */
const LADO_EN_PANTALLA = 224

export function DialogoMiPerfil({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const usuario = useUsuarioActual()
  return (
    <Dialogo
      abierto={abierto}
      titulo="Mi perfil"
      descripcion="Tu foto y tu color: es lo que ven los demás cuando estás trabajando en la misma fila que ellos."
      alCerrar={alCerrar}
    >
      <BloqueDePerfil clave={claveDeUsuario(usuario.usuario)} nombre={usuario.nombre} esMio />
    </Dialogo>
  )
}

/**
 * El formulario del perfil de una persona.
 *
 * `esMio` decide a qué canal va: el propio no pide permisos y el de otra persona exige ADMIN o
 * SUPER_ADMIN (lo cuida el proceso principal, acá sólo se elige el canal). Los dos exigen conexión:
 * el perfil vive en el servidor y sin canal no hay dónde guardarlo.
 */
export function BloqueDePerfil({
  clave,
  nombre,
  esMio = false,
}: {
  clave: string
  nombre: string
  esMio?: boolean
}) {
  const { perfilDe, coloresTomados, recargar } = usePerfiles()
  const perfil = perfilDe(clave)

  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [recortando, setRecortando] = useState<ImageBitmap | null>(null)

  // Los colores que tiene alguien MÁS: el propio no se apaga, si no la grilla mostraría el color
  // elegido como prohibido y parecería un error.
  const ajenos = new Set(coloresTomados)
  if (perfil) ajenos.delete(perfil.color)

  const guardar = useCallback(
    async (datos: DatosDePerfil, textoDelAviso: string) => {
      setGuardando(true)
      setError(null)
      setAviso(null)
      const resultado = esMio
        ? await window.dm.perfiles.guardarMio(datos)
        : await window.dm.perfiles.guardarDe(clave, datos)
      setGuardando(false)
      if (!resultado.ok) {
        // Tal como viene: cuando es el 409 de un color tomado, el servidor dice quién lo tiene.
        setError(resultado.error)
        // Y se relee la lista: el color que rebotó tiene que aparecer marcado enseguida.
        recargar()
        return false
      }
      setAviso(textoDelAviso)
      recargar()
      return true
    },
    [clave, esMio, recargar],
  )

  return (
    <div className="flex flex-col gap-5">
      {error && <Alerta tono="error">{error}</Alerta>}
      {aviso && <Alerta tono="exito">{aviso}</Alerta>}

      {/* --- La foto ------------------------------------------------------- */}
      <section className="flex items-start gap-4">
        <Avatar clave={clave} nombre={nombre} tamano="lg" anillo />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Foto</p>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            Se recorta cuadrada a 256 píxeles y se guarda como JPEG, así viaja liviana a las otras computadoras. Sin foto
            se dibujan tus iniciales sobre tu color.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ElegirArchivo alElegir={(imagen) => { setError(null); setAviso(null); setRecortando(imagen) }} alFallar={setError} />
            {perfil?.foto && (
              <Boton
                tamano="sm"
                variante="fantasma"
                icono="basura"
                escribe
                disabled={guardando}
                onClick={() => void guardar({ foto: null }, 'Se sacó la foto: volvés a verte con tus iniciales.')}
              >
                Sacar la foto
              </Boton>
            )}
          </div>
        </div>
      </section>

      {recortando && (
        <Recortador
          imagen={recortando}
          guardando={guardando}
          alCancelar={() => setRecortando(null)}
          alRecortar={async (foto) => {
            const salioBien = await guardar({ foto }, 'Foto guardada: los demás la ven en el momento.')
            if (salioBien) setRecortando(null)
          }}
        />
      )}

      {/* --- El color ------------------------------------------------------ */}
      <section>
        <p className="text-sm font-semibold text-slate-800">Color</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          Es el anillo con el que los demás te ven en la celda o la ficha que estás tocando. Son doce y no se repiten: los
          que tienen un candado ya los eligió otra persona.
        </p>
        <div className="mt-3 grid grid-cols-6 gap-2">
          {PALETA.map((color) => {
            const tomado = ajenos.has(color.indice)
            const elegido = perfil?.color === color.indice
            return (
              <button
                key={color.indice}
                type="button"
                disabled={tomado || guardando || elegido}
                onClick={() => void guardar({ color: color.indice }, `Tu color ahora es ${color.nombre}.`)}
                title={tomado ? `${color.nombre}: ya lo tiene otra persona.` : color.nombre}
                aria-label={color.nombre}
                aria-pressed={elegido}
                style={{ backgroundColor: color.hex, color: color.texto }}
                className={cx(
                  'flex h-11 items-center justify-center rounded-lg text-xs font-bold transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/50',
                  elegido && 'ring-2 ring-slate-900 ring-offset-2',
                  tomado && 'cursor-not-allowed opacity-40',
                  !tomado && !elegido && 'hover:scale-105',
                )}
              >
                {elegido ? <Icono nombre="ok" tamano={16} /> : tomado ? <Icono nombre="candado" tamano={14} /> : null}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          El tuyo es <strong className="font-semibold">{colorDePaleta(perfil?.color ?? -1).nombre}</strong>
          {perfil ? '' : ' (todavía no elegiste: te toca el neutro hasta que elijas)'}.
          {ajenos.size === CANTIDAD_DE_COLORES - 1 && ' Son los últimos que quedan libres.'}
        </p>
      </section>
    </div>
  )
}

/**
 * El botón que abre el diálogo del sistema y devuelve la imagen ya decodificada.
 *
 * `createImageBitmap` y no un `<img>` con `onload`: decodifica fuera del hilo de la pantalla (una foto
 * de 12 megapíxeles con un `<img>` congela la ventana un segundo) y da el ancho y el alto reales,
 * incluida la orientación que traen las fotos de teléfono.
 */
function ElegirArchivo({ alElegir, alFallar }: { alElegir: (imagen: ImageBitmap) => void; alFallar: (error: string) => void }) {
  const entrada = useRef<HTMLInputElement | null>(null)

  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(evento) => {
          const archivo = evento.currentTarget.files?.[0]
          // El valor se limpia siempre: sin esto, elegir la misma foto dos veces seguidas no dispara
          // el evento y parece que el botón dejó de funcionar.
          evento.currentTarget.value = ''
          if (!archivo) return
          void createImageBitmap(archivo).then(alElegir, () =>
            alFallar('No se pudo abrir esa imagen. Probá con un JPG o un PNG común.'),
          )
        }}
      />
      <Boton tamano="sm" icono="clip" onClick={() => entrada.current?.click()}>
        Elegir una imagen
      </Boton>
    </>
  )
}

/**
 * El recorte: la foto en un canvas cuadrado, se arrastra para centrarla y se acerca con la barra.
 *
 * El canvas es el de 256×256 que se exporta, dibujado más grande por CSS. Dibujar en uno del tamaño
 * de la pantalla y volver a escalar al exportar pierde nitidez dos veces.
 */
function Recortador({
  imagen,
  guardando,
  alRecortar,
  alCancelar,
}: {
  imagen: ImageBitmap
  guardando: boolean
  alRecortar: (foto: string) => void
  alCancelar: () => void
}) {
  const lienzo = useRef<HTMLCanvasElement | null>(null)
  const [zoom, setZoom] = useState(ZOOM_MINIMO)
  // El desplazamiento del centro de la imagen, en píxeles del recorte (no de la pantalla).
  const [centro, setCentro] = useState({ x: 0, y: 0 })
  const arrastre = useRef<{ x: number; y: number; desde: { x: number; y: number } } | null>(null)

  /**
   * La escala mínima para que la imagen TAPE el cuadrado (el `cover` de CSS): con la que la haría
   * entrar entera quedarían franjas transparentes que el JPEG guarda en negro.
   */
  const escalaBase = Math.max(LADO_DEL_RECORTE / imagen.width, LADO_DEL_RECORTE / imagen.height)

  // Cuánto se puede correr sin descubrir un borde. Se recalcula con el zoom: al alejar, una foto que
  // estaba corrida tiene que volver sola hacia el centro.
  const escala = escalaBase * zoom
  const margenX = Math.max(0, (imagen.width * escala - LADO_DEL_RECORTE) / 2)
  const margenY = Math.max(0, (imagen.height * escala - LADO_DEL_RECORTE) / 2)
  const x = Math.min(margenX, Math.max(-margenX, centro.x))
  const y = Math.min(margenY, Math.max(-margenY, centro.y))

  useEffect(() => {
    const canvas = lienzo.current
    const pincel = canvas?.getContext('2d')
    if (!canvas || !pincel) return
    // Fondo blanco: el JPEG no tiene transparencia y un PNG con fondo transparente saldría negro.
    pincel.fillStyle = '#ffffff'
    pincel.fillRect(0, 0, LADO_DEL_RECORTE, LADO_DEL_RECORTE)
    const ancho = imagen.width * escala
    const alto = imagen.height * escala
    pincel.drawImage(imagen, LADO_DEL_RECORTE / 2 - ancho / 2 + x, LADO_DEL_RECORTE / 2 - alto / 2 + y, ancho, alto)
  }, [imagen, escala, x, y])

  const exportar = () => {
    const canvas = lienzo.current
    if (!canvas) return
    // Se prueba de mejor a peor hasta que entra en el tope. Casi siempre entra en la primera; una foto
    // con mucho detalle fino (un grupo, un paisaje) puede necesitar la segunda.
    for (const calidad of CALIDADES) {
      const foto = canvas.toDataURL('image/jpeg', calidad)
      if (foto.length <= TOPE_DE_LA_FOTO) {
        alRecortar(foto)
        return
      }
    }
    alRecortar(canvas.toDataURL('image/jpeg', CALIDADES[CALIDADES.length - 1]))
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-slate-800">Acomodá la foto</p>
      <p className="mt-0.5 text-xs text-slate-500">Arrastrala para centrar la cara y usá la barra para acercarla.</p>
      <div className="mt-3 flex flex-col items-center gap-3">
        <canvas
          ref={lienzo}
          width={LADO_DEL_RECORTE}
          height={LADO_DEL_RECORTE}
          style={{ width: LADO_EN_PANTALLA, height: LADO_EN_PANTALLA, touchAction: 'none' }}
          // Con eventos de puntero y no de mouse: `setPointerCapture` hace que el arrastre siga
          // funcionando cuando el dedo o el puntero se van del canvas, que es lo que pasa siempre al
          // acomodar una foto muy acercada.
          onPointerDown={(evento) => {
            evento.currentTarget.setPointerCapture(evento.pointerId)
            arrastre.current = { x: evento.clientX, y: evento.clientY, desde: { x, y } }
          }}
          onPointerMove={(evento) => {
            const tomado = arrastre.current
            if (!tomado) return
            // Los píxeles de la pantalla se convierten a píxeles del recorte: el canvas se dibuja más
            // grande, así que sin esto la foto se movería más despacio que el puntero.
            const factor = LADO_DEL_RECORTE / LADO_EN_PANTALLA
            setCentro({
              x: tomado.desde.x + (evento.clientX - tomado.x) * factor,
              y: tomado.desde.y + (evento.clientY - tomado.y) * factor,
            })
          }}
          onPointerUp={() => {
            arrastre.current = null
          }}
          className="cursor-move rounded-full border-2 border-white bg-white shadow-media"
        />
        <label className="flex w-full max-w-xs items-center gap-2 text-xs text-slate-600">
          <Icono nombre="lupa" tamano={14} />
          <input
            type="range"
            min={ZOOM_MINIMO}
            max={ZOOM_MAXIMO}
            step={0.02}
            value={zoom}
            onChange={(evento) => setZoom(Number(evento.currentTarget.value))}
            className="w-full accent-marino-600"
            aria-label="Acercar la foto"
          />
        </label>
        <div className="flex gap-2">
          <Boton tamano="sm" variante="fantasma" onClick={alCancelar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton tamano="sm" variante="primario" icono="ok" escribe cargando={guardando} onClick={exportar}>
            Usar esta foto
          </Boton>
        </div>
      </div>
    </section>
  )
}
