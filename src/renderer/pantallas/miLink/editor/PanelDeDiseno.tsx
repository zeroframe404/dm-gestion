// El panel «Diseño» de la derecha: color, estilo, lo de detrás del avatar y las dos opciones.
//
// Las miniaturas de Estilo y de Detrás del avatar NO son dibujos fijos: son la vista previa de la
// página de la persona, en chico, con esa opción puesta. Así se elige mirando la página propia (con su
// nombre, sus coberturas y su color) y no un ejemplo genérico que después se ve distinto.
import type { ReactNode } from 'react'
import {
  COLORES_DE_PAGINA,
  DESCRIPCION_ESTILO,
  ESTILOS_DE_PAGINA,
  FONDOS_DE_AVATAR,
  NOMBRE_ESTILO,
  NOMBRE_FONDO,
  type ContenidoDeMiLink,
  type DisenoDePagina,
} from '../../../../shared/miLink'
import { Icono } from '../../../componentes/Icono'
import { cx } from '../../../componentes/ui'
import { VistaPrevia } from './VistaPrevia'

interface PropsPanelDeDiseno {
  contenido: ContenidoDeMiLink
  /** La foto del perfil (data URL), si tiene. Las miniaturas la usan si `usarFoto`. */
  fotoDelPerfil: string | null
  editable: boolean
  alCambiar: (cambio: (previo: ContenidoDeMiLink) => ContenidoDeMiLink) => void
}

/** Ancho al que se dibuja la página antes de achicarla: el de un celular, como la va a ver casi todo el mundo. */
const ANCHO_DE_LA_MINIATURA = 420

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-slate-200 pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-bold tracking-wider text-slate-500 uppercase">{titulo}</h3>
      {children}
    </section>
  )
}

/**
 * La página en chico. `inert` la saca del teclado y de los lectores de pantalla: es un dibujo, y sin
 * eso cada miniatura sumaría sus links y botones al recorrido con Tab.
 */
function Miniatura({ contenido, foto, ancho, alto }: { contenido: ContenidoDeMiLink; foto: string | null; ancho: number; alto: number }) {
  const escala = ancho / ANCHO_DE_LA_MINIATURA
  return (
    <div className="relative overflow-hidden rounded-lg" style={{ width: ancho, height: alto }} aria-hidden="true">
      <div inert className="pointer-events-none absolute top-0 left-0 origin-top-left" style={{ width: ANCHO_DE_LA_MINIATURA, transform: `scale(${escala})` }}>
        <VistaPrevia contenido={contenido} foto={foto} />
      </div>
    </div>
  )
}

function Opcion({
  elegida,
  nombre,
  alElegir,
  editable,
  children,
}: {
  elegida: boolean
  nombre: string
  alElegir: () => void
  editable: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={alElegir}
      disabled={!editable}
      aria-pressed={elegida}
      className={cx(
        'group flex flex-col items-center gap-1.5 rounded-xl p-1 text-xs font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40 disabled:cursor-default',
        elegida ? 'text-slate-900' : 'text-slate-500 enabled:hover:text-slate-800',
      )}
    >
      <span
        className={cx(
          'block rounded-[10px] border-2 p-0.5 transition-colors',
          elegida ? 'border-violet-500' : 'border-slate-200 group-enabled:group-hover:border-slate-300',
        )}
      >
        {children}
      </span>
      {nombre}
    </button>
  )
}

export function PanelDeDiseno({ contenido, fotoDelPerfil, editable, alCambiar }: PropsPanelDeDiseno) {
  const { diseno } = contenido
  const foto = contenido.usarFoto ? fotoDelPerfil : null
  const cambiarDiseno = (cambios: Partial<DisenoDePagina>) => alCambiar((previo) => ({ ...previo, diseno: { ...previo.diseno, ...cambios } }))
  const colorElegido = diseno.color.toLowerCase()
  const esDeLaLista = COLORES_DE_PAGINA.some((color) => color.hex === colorElegido)

  return (
    <div className="flex flex-col gap-5">
      <Seccion titulo="Color">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-1 gap-y-3">
          {COLORES_DE_PAGINA.map((color) => {
            const elegido = color.hex === colorElegido
            return (
              <button
                key={color.hex}
                type="button"
                disabled={!editable}
                onClick={() => cambiarDiseno({ color: color.hex })}
                aria-pressed={elegido}
                title={color.nombre}
                className="group flex flex-col items-center gap-1.5 rounded-lg p-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40 disabled:cursor-default"
              >
                <span
                  className="block h-8 w-8 rounded-full transition-transform group-enabled:group-hover:scale-110"
                  style={{
                    backgroundColor: color.hex,
                    // El anillo con box-shadow: el primero, del color del fondo del panel, separa el círculo
                    // del anillo; con un borde comería el color y el elegido se vería más chico.
                    boxShadow: elegido ? `0 0 0 2px var(--mlv-panel, #ffffff), 0 0 0 4px ${color.hex}` : undefined,
                  }}
                />
                <span className={cx('text-[11px] leading-tight', elegido ? 'font-semibold text-slate-900' : 'text-slate-500')}>{color.nombre}</span>
              </button>
            )
          })}
        </div>
        <label
          className={cx(
            'flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700',
            editable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-default opacity-70',
          )}
        >
          <span
            className="block h-6 w-6 shrink-0 rounded-full border border-slate-300"
            style={{ background: esDeLaLista ? 'conic-gradient(#dc2626,#c2410c,#4d7c0f,#15803d,#0e7490,#2563eb,#7c4dff,#db2777,#dc2626)' : colorElegido }}
          />
          <span className="flex-1">{esDeLaLista ? 'Elegir otro color' : `Otro color: ${colorElegido}`}</span>
          <Icono nombre="lapiz" tamano={14} className="text-slate-400" />
          <input
            type="color"
            className="sr-only"
            value={colorElegido}
            disabled={!editable}
            onChange={(evento) => cambiarDiseno({ color: evento.target.value.toLowerCase() })}
          />
        </label>
      </Seccion>

      <Seccion titulo="Estilo">
        <div className="grid grid-cols-3 justify-items-center gap-1">
          {ESTILOS_DE_PAGINA.map((estilo) => (
            <Opcion key={estilo} elegida={diseno.estilo === estilo} nombre={NOMBRE_ESTILO[estilo]} editable={editable} alElegir={() => cambiarDiseno({ estilo })}>
              <Miniatura contenido={{ ...contenido, diseno: { ...diseno, estilo } }} foto={foto} ancho={84} alto={120} />
            </Opcion>
          ))}
        </div>
        <p className="text-sm leading-relaxed text-slate-600">{DESCRIPCION_ESTILO[diseno.estilo]}</p>
      </Seccion>

      <Seccion titulo="Detrás del avatar">
        <div className="grid grid-cols-3 justify-items-center gap-1">
          {FONDOS_DE_AVATAR.map((fondo) => (
            <Opcion key={fondo} elegida={diseno.fondo === fondo} nombre={NOMBRE_FONDO[fondo]} editable={editable} alElegir={() => cambiarDiseno({ fondo })}>
              {/* Sólo la parte de arriba: es la única que cambia con esto. */}
              <Miniatura contenido={{ ...contenido, diseno: { ...diseno, fondo } }} foto={foto} ancho={84} alto={64} />
            </Opcion>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Opciones">
        <Interruptor
          etiqueta="Usar mi foto de perfil"
          ayuda={
            fotoDelPerfil
              ? 'Si la sacás, van tus iniciales en el círculo.'
              : 'Todavía no tenés foto: la cargás tocando tu círculo de arriba a la derecha («Mi perfil»). Mientras tanto van tus iniciales.'
          }
          activo={contenido.usarFoto}
          editable={editable}
          alCambiar={(usarFoto) => alCambiar((previo) => ({ ...previo, usarFoto }))}
        />
        <Interruptor
          etiqueta="Botón «Denunciar un siniestro»"
          ayuda="Abre un formulario para contar qué pasó y mandar fotos. Las denuncias llegan a Mi link → Siniestros."
          activo={contenido.siniestros}
          editable={editable}
          alCambiar={(siniestros) => alCambiar((previo) => ({ ...previo, siniestros }))}
        />
      </Seccion>
    </div>
  )
}

function Interruptor({
  etiqueta,
  ayuda,
  activo,
  editable,
  alCambiar,
}: {
  etiqueta: string
  ayuda: string
  activo: boolean
  editable: boolean
  alCambiar: (activo: boolean) => void
}) {
  return (
    <label className={cx('flex items-start gap-3', editable ? 'cursor-pointer' : 'cursor-default')}>
      <input type="checkbox" className="peer sr-only" checked={activo} disabled={!editable} onChange={(evento) => alCambiar(evento.target.checked)} />
      <span
        aria-hidden="true"
        className={cx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-marino-500/40',
          activo ? 'bg-violet-600' : 'bg-slate-300',
        )}
      >
        {/* El botoncito blanco va con estilo y no con `bg-white`: el tema oscuro da vuelta esa clase. */}
        <span
          className={cx('absolute top-0.5 h-4 w-4 rounded-full shadow transition-transform', activo ? 'translate-x-[18px]' : 'translate-x-0.5')}
          style={{ backgroundColor: '#ffffff' }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{etiqueta}</span>
        <span className="block text-xs leading-relaxed text-slate-500">{ayuda}</span>
      </span>
    </label>
  )
}
