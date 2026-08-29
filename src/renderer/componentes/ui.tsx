// Piezas de interfaz reutilizables: botones, campos, alertas, diálogos, etiquetas y tarjetas.
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Icono, type NombreIcono } from './Icono'

/** Une clases ignorando valores falsos. */
/** «recién», «hace 5 minutos», «hace 2 horas»: para los indicadores de la barra y de Administración. */
export function haceCuanto(iso: string | null): string {
  if (!iso) return 'todavía nunca'
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutos < 1) return 'recién'
  if (minutos === 1) return 'hace 1 minuto'
  if (minutos < 60) return `hace ${minutos} minutos`
  const horas = Math.floor(minutos / 60)
  if (horas < 48) return horas === 1 ? 'hace 1 hora' : `hace ${horas} horas`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} días`
}

export function cx(...clases: Array<string | false | null | undefined>): string {
  return clases.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Botón
// ---------------------------------------------------------------------------
type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'invertido'

interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBoton
  tamano?: 'md' | 'sm'
  icono?: NombreIcono
  cargando?: boolean
}

const CLASES_VARIANTE: Record<VarianteBoton, string> = {
  primario: 'bg-marino-700 text-white shadow-marca hover:bg-marino-600 focus-visible:ring-marino-500/40',
  secundario:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 focus-visible:ring-marino-500/40',
  fantasma: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-marino-500/40',
  peligro: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 focus-visible:ring-red-500/40',
  invertido: 'bg-white/10 text-white border border-white/20 hover:bg-white/15 focus-visible:ring-cielo-100/60',
}

export const Boton = forwardRef<HTMLButtonElement, PropsBoton>(function Boton(
  { variante = 'secundario', tamano = 'md', icono, cargando = false, className, children, disabled, type = 'button', ...resto },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || cargando}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60',
        tamano === 'md' ? 'h-10 px-4 text-sm' : 'h-8 px-3 text-xs',
        CLASES_VARIANTE[variante],
        className,
      )}
      {...resto}
    >
      {cargando ? (
        <Icono nombre="cargando" tamano={tamano === 'md' ? 16 : 14} className="animate-spin" />
      ) : (
        icono && <Icono nombre={icono} tamano={tamano === 'md' ? 16 : 14} />
      )}
      {children}
    </button>
  )
})

// ---------------------------------------------------------------------------
// Campos de formulario
// ---------------------------------------------------------------------------
const CLASES_CONTROL =
  'w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'transition-colors focus:border-marino-500 focus:outline-none focus:ring-2 focus:ring-marino-500/25 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500'

interface PropsEnvoltorio {
  etiqueta: string
  ayuda?: ReactNode
  error?: string | null
  children: (id: string, describedBy: string | undefined) => ReactNode
}

function Envoltorio({ etiqueta, ayuda, error, children }: PropsEnvoltorio) {
  const id = useId()
  const idAyuda = `${id}-ayuda`
  const describedBy = ayuda || error ? idAyuda : undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={idAyuda} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : ayuda ? (
        <p id={idAyuda} className="text-xs text-slate-500">
          {ayuda}
        </p>
      ) : null}
    </div>
  )
}

interface PropsCampo extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string
  ayuda?: ReactNode
  error?: string | null
}

export function Campo({ etiqueta, ayuda, error, className, ...resto }: PropsCampo) {
  return (
    <Envoltorio etiqueta={etiqueta} ayuda={ayuda} error={error}>
      {(id, describedBy) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(CLASES_CONTROL, 'h-10', error && 'border-red-400', className)}
          {...resto}
        />
      )}
    </Envoltorio>
  )
}

/** Campo de contraseña con botón para mostrarla u ocultarla. */
export function CampoClave({ etiqueta, ayuda, error, className, ...resto }: PropsCampo) {
  const [visible, setVisible] = useState(false)
  return (
    <Envoltorio etiqueta={etiqueta} ayuda={ayuda} error={error}>
      {(id, describedBy) => (
        <div className="relative">
          <input
            id={id}
            type={visible ? 'text' : 'password'}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={cx(CLASES_CONTROL, 'h-10 pr-10', error && 'border-red-400', className)}
            {...resto}
          />
          <button
            type="button"
            onClick={() => setVisible((valor) => !valor)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:text-marino-700"
            aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            tabIndex={-1}
          >
            <Icono nombre={visible ? 'ojoTachado' : 'ojo'} tamano={16} />
          </button>
        </div>
      )}
    </Envoltorio>
  )
}

interface PropsSelector extends SelectHTMLAttributes<HTMLSelectElement> {
  etiqueta: string
  ayuda?: ReactNode
  error?: string | null
  opciones: Array<{ valor: string | number; texto: string }>
}

export function Selector({ etiqueta, ayuda, error, opciones, className, ...resto }: PropsSelector) {
  return (
    <Envoltorio etiqueta={etiqueta} ayuda={ayuda} error={error}>
      {(id, describedBy) => (
        <select
          id={id}
          aria-describedby={describedBy}
          className={cx(CLASES_CONTROL, 'h-10', error && 'border-red-400', className)}
          {...resto}
        >
          {opciones.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.texto}
            </option>
          ))}
        </select>
      )}
    </Envoltorio>
  )
}

interface PropsAreaTexto extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  etiqueta: string
  ayuda?: ReactNode
  error?: string | null
}

export function AreaTexto({ etiqueta, ayuda, error, className, ...resto }: PropsAreaTexto) {
  return (
    <Envoltorio etiqueta={etiqueta} ayuda={ayuda} error={error}>
      {(id, describedBy) => (
        <textarea
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cx(CLASES_CONTROL, 'py-2 leading-relaxed', error && 'border-red-400', className)}
          {...resto}
        />
      )}
    </Envoltorio>
  )
}

// ---------------------------------------------------------------------------
// Alerta
// ---------------------------------------------------------------------------
type TonoAlerta = 'error' | 'exito' | 'info' | 'aviso'

const CLASES_ALERTA: Record<TonoAlerta, { caja: string; icono: NombreIcono }> = {
  error: { caja: 'border-red-200 bg-red-50 text-red-800', icono: 'alerta' },
  exito: { caja: 'border-green-200 bg-green-50 text-green-800', icono: 'ok' },
  info: { caja: 'border-marino-200 bg-marino-50 text-marino-800', icono: 'info' },
  aviso: { caja: 'border-amber-200 bg-amber-50 text-amber-800', icono: 'alerta' },
}

export function Alerta({ tono = 'info', children }: { tono?: TonoAlerta; children: ReactNode }) {
  const estilo = CLASES_ALERTA[tono]
  return (
    <div role={tono === 'error' ? 'alert' : 'status'} className={cx('flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm', estilo.caja)}>
      <Icono nombre={estilo.icono} tamano={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Etiqueta de estado
// ---------------------------------------------------------------------------
type TonoEtiqueta = 'neutro' | 'marca' | 'exito' | 'aviso' | 'peligro'

const CLASES_ETIQUETA: Record<TonoEtiqueta, string> = {
  neutro: 'bg-slate-100 text-slate-600',
  marca: 'bg-marino-50 text-marino-700',
  exito: 'bg-green-50 text-green-700',
  aviso: 'bg-amber-50 text-amber-700',
  peligro: 'bg-red-50 text-red-700',
}

export function Etiqueta({ tono = 'neutro', children }: { tono?: TonoEtiqueta; children: ReactNode }) {
  return (
    <span
      className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', CLASES_ETIQUETA[tono])}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------
interface PropsTarjeta {
  titulo?: string
  descripcion?: ReactNode
  acciones?: ReactNode
  /** Sin relleno interno: para tablas que llegan al borde. */
  alRas?: boolean
  className?: string
  children: ReactNode
}

export function Tarjeta({ titulo, descripcion, acciones, alRas = false, className, children }: PropsTarjeta) {
  return (
    <section className={cx('overflow-hidden rounded-xl border border-slate-200 bg-white shadow-suave', className)}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-start gap-4 px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            {titulo && <h2 className="font-display text-lg font-bold tracking-tight text-slate-900">{titulo}</h2>}
            {descripcion && <p className="mt-1 text-sm leading-relaxed text-slate-600">{descripcion}</p>}
          </div>
          {acciones && <div className="flex items-center gap-2">{acciones}</div>}
        </header>
      )}
      <div className={alRas ? '' : cx('px-6 pb-6', titulo || acciones ? '' : 'pt-6')}>{children}</div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Diálogo modal
// ---------------------------------------------------------------------------
interface PropsDialogo {
  abierto: boolean
  titulo: string
  descripcion?: ReactNode
  alCerrar: () => void
  /** Botones del pie. */
  pie?: ReactNode
  ancho?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
}

const ANCHOS_DIALOGO = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-7xl' }

/**
 * Los diálogos abiertos, del primero al último. Hace falta desde que hay diálogos adentro de otro
 * diálogo —la dirección del cliente, por ejemplo—: sin esto, un Escape cerraría los dos de una vez y
 * quien estaba corrigiendo la calle perdería además todo el alta.
 *
 * Es una lista de módulo y no un contexto a propósito: un contexto obligaría a envolver cada pantalla
 * que abra un diálogo, y son casi todas.
 */
const DIALOGOS_ABIERTOS: string[] = []

export function Dialogo({ abierto, titulo, descripcion, alCerrar, pie, ancho = 'md', children }: PropsDialogo) {
  const idTitulo = useId()
  const [profundidad, setProfundidad] = useState(0)

  // `alCerrar` casi siempre es una función nueva en cada render (una flecha escrita en el JSX). Si
  // estuviera en las dependencias, cualquier re-render del padre —por ejemplo cuando llega
  // `permisos:cambiaron` desde otra computadora— volvería a correr el efecto: se sacaría este diálogo
  // de la pila y se lo volvería a poner ARRIBA. Con la dirección abierta encima del alta, el Escape
  // siguiente cerraría el alta entera y no la ventanita. Guardado en un ref, el efecto depende sólo
  // de abrir y cerrar, que es cuando la pila tiene que cambiar de verdad.
  const cerrar = useRef(alCerrar)
  cerrar.current = alCerrar

  useEffect(() => {
    if (!abierto) return
    DIALOGOS_ABIERTOS.push(idTitulo)
    setProfundidad(DIALOGOS_ABIERTOS.length - 1)
    const alTeclear = (evento: KeyboardEvent) => {
      // Sólo el de más arriba se cierra con Escape. El de abajo sigue abierto, que es lo que espera
      // cualquiera que abrió una ventanita encima de un formulario a medio llenar.
      if (evento.key === 'Escape' && DIALOGOS_ABIERTOS[DIALOGOS_ABIERTOS.length - 1] === idTitulo) cerrar.current()
    }
    window.addEventListener('keydown', alTeclear)
    return () => {
      window.removeEventListener('keydown', alTeclear)
      const posicion = DIALOGOS_ABIERTOS.lastIndexOf(idTitulo)
      if (posicion !== -1) DIALOGOS_ABIERTOS.splice(posicion, 1)
    }
  }, [abierto, idTitulo])

  if (!abierto) return null

  return (
    <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex: 50 + profundidad * 10 }}>
      <div className="absolute inset-0 bg-marino-950/55 backdrop-blur-[2px]" onClick={alCerrar} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        // El diálogo no puede pasarse de alto: la ventana no scrollea (body tiene overflow oculto) y
        // los botones del pie quedarían fuera de la pantalla. Se limita el alto y scrollea el cuerpo.
        className={cx('relative flex max-h-full w-full flex-col rounded-2xl bg-white shadow-media', ANCHOS_DIALOGO[ancho])}
      >
        <header className="flex shrink-0 items-start gap-4 px-6 pt-6 pb-2">
          <div className="min-w-0 flex-1">
            <h2 id={idTitulo} className="font-display text-xl font-bold tracking-tight text-slate-900">
              {titulo}
            </h2>
            {descripcion && <p className="mt-1 text-sm leading-relaxed text-slate-600">{descripcion}</p>}
          </div>
          <button
            type="button"
            onClick={alCerrar}
            className="-mr-2 -mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40"
            aria-label="Cerrar"
          >
            <Icono nombre="cerrar" tamano={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {pie && <footer className="flex shrink-0 justify-end gap-2 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-6 py-4">{pie}</footer>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Indicador de carga
// ---------------------------------------------------------------------------
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status">
      <Icono nombre="cargando" tamano={18} className="animate-spin text-marino-600" />
      {texto}
    </div>
  )
}
