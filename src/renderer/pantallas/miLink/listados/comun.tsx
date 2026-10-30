// Lo que comparten los dos listados de Mi link (Solicitudes y Siniestros) y, en parte, Métricas: el
// encabezado con el ícono en el cuadrado violeta, la barrita del estado, la fecha con la hora debajo,
// el botón de WhatsApp, el panel de filtros y la carga con refresco.
//
// Los dos listados son la misma pantalla con otras columnas: lo que llega desde la página pública vive
// en el VPS y se pide con los mismos filtros (`FiltrosDeMiLink`). No hay canal en vivo para esto, así
// que el refresco es por reloj mientras la pantalla está abierta.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { EstadoDeDenuncia, EstadoDeSolicitud, FiltrosDeMiLink, SolicitudDeMiLink } from '../../../../shared/miLink'
import type { Resultado } from '../../../../shared/tipos'
import { BotonAyuda } from '../../../componentes/Ayuda'
import { Icono, type NombreIcono } from '../../../componentes/Icono'
import { CampoDeFiltro, CLASES_INPUT_DE_FILTRO, GrillaDeFiltros, PanelDeFiltros } from '../../../componentes/listados'
import { cx } from '../../../componentes/ui'
import { useUsuarioActual } from '../../../contexto/Sesion'

/** Cada cuánto se vuelve a pedir el listado mientras la pantalla está abierta. */
export const REFRESCO_DE_LISTADOS_MS = 60_000

// ---------------------------------------------------------------------------
// Encabezado
// ---------------------------------------------------------------------------

interface PropsEncabezado {
  icono: NombreIcono
  titulo: string
  descripcion: string
  /** La clave de la ayuda de la pantalla. */
  ayuda: string
  acciones?: ReactNode
}

/**
 * El encabezado de las pantallas de Mi link. Es el de los listados (`EncabezadoDePantalla`) con el
 * ícono sobre violeta claro: Mi link es lo que llega de afuera, y el color lo separa a simple vista
 * de los listados de la cartera, que son de adentro.
 */
export function EncabezadoDeMiLink({ icono, titulo, descripcion, ayuda, acciones }: PropsEncabezado) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-800">
        <Icono nombre={icono} tamano={24} />
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-slate-900">{titulo}</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{descripcion}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {acciones}
        <BotonAyuda clave={ayuda} />
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// La barrita del estado
// ---------------------------------------------------------------------------

export type TonoDeAvance = 'ambar' | 'rojo' | 'gris'

/** Las clases del relleno: son de las que el tema oscuro ya sabe leer (tintas plenas). */
const RELLENO: Record<TonoDeAvance, string> = {
  ambar: 'bg-amber-500',
  rojo: 'bg-red-500',
  gris: 'bg-slate-400',
}

/**
 * El estado como una barrita que se llena a medida que avanza el trámite, con el nombre debajo. Se lee
 * de un vistazo en una columna de muchas filas: cuánto falta, no sólo en qué paso está.
 */
export function BarraDeEstado({ avance, tono, texto }: { avance: number; tono: TonoDeAvance; texto: string }) {
  return (
    <div className="mx-auto flex w-24 flex-col items-center gap-1" title={texto}>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <span className={cx('block h-full rounded-full', RELLENO[tono])} style={{ width: `${Math.round(Math.min(Math.max(avance, 0), 1) * 100)}%` }} />
      </span>
      <span className="text-xs font-semibold whitespace-nowrap text-slate-700">{texto}</span>
    </div>
  )
}

/** Cuánto del trámite está hecho y de qué color: lo abierto en ámbar, lo cerrado en rojo, lo descartado en gris. */
export const AVANCE_DE_SOLICITUD: Record<EstadoDeSolicitud, { avance: number; tono: TonoDeAvance }> = {
  NUEVA: { avance: 0.25, tono: 'ambar' },
  CONTACTADA: { avance: 0.5, tono: 'ambar' },
  COTIZADA: { avance: 0.75, tono: 'ambar' },
  CERRADA: { avance: 1, tono: 'rojo' },
  DESCARTADA: { avance: 1, tono: 'gris' },
}

/** Las denuncias, con la misma lectura: ámbar mientras se tramita, rojo lleno al cerrarse. */
export const AVANCE_DE_DENUNCIA: Record<EstadoDeDenuncia, { avance: number; tono: TonoDeAvance }> = {
  NUEVA: { avance: 0.25, tono: 'ambar' },
  'EN CURSO': { avance: 0.5, tono: 'ambar' },
  CARGADA: { avance: 0.75, tono: 'ambar' },
  CERRADA: { avance: 1, tono: 'rojo' },
}

/** «Fiat Cronos 1.3 Drive - 2022» o, si no es de vehículo, el título de la tarjeta que tocó. */
export function riesgoDeSolicitud(solicitud: SolicitudDeMiLink): string {
  const v = solicitud.vehiculo
  if (!v) return solicitud.coberturaTitulo
  const nombre = [v.marca, v.modelo, v.version].map((parte) => parte.trim()).filter(Boolean).join(' ')
  return v.anio ? `${nombre} - ${v.anio}` : nombre
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/**
 * En hora de Argentina, la misma con la que el VPS corta los filtros «desde» y «hasta»: una solicitud
 * de las 23:30 no puede verse de un día en la tabla y caer en el otro al filtrar.
 */
const ZONA = 'America/Argentina/Buenos_Aires'

export function fechaDeIso(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return '—'
  return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZONA })
}

export function horaDeIso(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA })
}

/** «29/10/2026 18:45»: para el Excel, donde no hay renglón de abajo. */
export function fechaYHoraDeIso(iso: string): string {
  return [fechaDeIso(iso), horaDeIso(iso)].filter(Boolean).join(' ')
}

/** 'aaaa-mm-dd' → 'dd/mm/aaaa'. Es la fecha que dijo el cliente, no la del envío: no tiene hora. */
export function fechaDelSiniestro(fecha: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha)
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : ''
}

/** La celda FECHA: el día y, debajo y en gris, la hora. */
export function CeldaDeFecha({ iso }: { iso: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 tabular-nums">
      <span className="font-medium whitespace-nowrap text-slate-800">{fechaDeIso(iso)}</span>
      <span className="text-xs text-slate-500">{horaDeIso(iso)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * El teléfono como lo espera wa.me: sólo dígitos y con 54 9 adelante si es de acá. Es la misma regla
 * que `telefonoParaWhatsapp` del proceso principal (servicios/cartera.ts), que desde la pantalla no se
 * puede importar. El visitante lo escribe como le sale («011 15 …», «+54 9 11 …»).
 */
export function enlaceDeWhatsapp(telefono: string): string | null {
  const digitos = telefono.replace(/\D+/g, '')
  if (digitos.length < 6) return null
  let numero: string
  if (digitos.startsWith('54')) numero = digitos.length >= 12 && !digitos.startsWith('549') ? `549${digitos.slice(2)}` : digitos
  else if (digitos.startsWith('0')) numero = `549${digitos.slice(1)}`
  else numero = `549${digitos}`
  return `https://wa.me/${numero}`
}

export function abrirWhatsapp(telefono: string): void {
  const url = enlaceDeWhatsapp(telefono)
  if (url) void window.dm.sistema.abrirEnlace(url)
}

/**
 * El ícono verde de la columna TEL.: abre la charla sin pasar por el seguimiento. Frena el clic para
 * que no abra además el diálogo de la fila.
 */
export function BotonDeWhatsapp({ telefono }: { telefono: string }) {
  const url = enlaceDeWhatsapp(telefono)
  if (!url) return <span className="text-slate-400">—</span>
  return (
    <button
      type="button"
      onClick={(evento) => {
        evento.stopPropagation()
        abrirWhatsapp(telefono)
      }}
      title={`Escribirle por WhatsApp al ${telefono}`}
      aria-label={`Escribirle por WhatsApp al ${telefono}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-green-600 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
    >
      <Icono nombre="whatsapp" tamano={20} />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Quién ve qué
// ---------------------------------------------------------------------------

/**
 * Los que pueden mirar lo de los demás. Es la misma regla que aplica el VPS (pedir 'todos' u otra
 * clave siendo empleado da 403): acá sólo se usa para no ofrecer un filtro que va a fallar.
 */
export function useVeTodoMiLink(): boolean {
  const { rol } = useUsuarioActual()
  return rol === 'ADMIN' || rol === 'SUPER_ADMIN'
}

export interface UsuarioDeMiLink {
  clave: string
  nombre: string
}

/** Los usuarios para el filtro «Usuario». Sólo se piden si se van a mostrar. */
export function useUsuariosDeMiLink(habilitado: boolean): UsuarioDeMiLink[] {
  const [usuarios, setUsuarios] = useState<UsuarioDeMiLink[]>([])
  useEffect(() => {
    if (!habilitado) return
    let vigente = true
    void window.dm.miLink.usuarios().then((resultado) => {
      if (vigente && resultado.ok) setUsuarios([...resultado.datos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')))
    })
    return () => {
      vigente = false
    }
  }, [habilitado])
  return usuarios
}

/** Las opciones del filtro «Usuario»: las propias, todas, y una por persona. */
export function opcionesDeUsuario(usuarios: UsuarioDeMiLink[], propias: string): Array<{ valor: string; texto: string }> {
  return [
    { valor: '', texto: propias },
    { valor: 'todos', texto: 'Toda la agencia' },
    ...usuarios.map((usuario) => ({ valor: usuario.clave, texto: usuario.nombre || usuario.clave })),
  ]
}

// ---------------------------------------------------------------------------
// La carga del listado
// ---------------------------------------------------------------------------

interface ListadoDeMiLink<T> {
  filas: T[]
  cargando: boolean
  error: string | null
  /** Vuelve a pedir; `enSilencio` no muestra el «Cargando…» (el refresco por reloj). */
  recargar: (enSilencio?: boolean) => Promise<void>
  /** Reemplaza una fila por la que devolvió el VPS al guardarla, sin volver a pedir todo. */
  reemplazar: (fila: T) => void
}

/**
 * Pide el listado con los filtros aplicados, al entrar y cada `REFRESCO_DE_LISTADOS_MS` mientras la
 * pantalla está montada. Cada pedido lleva número: si llega una respuesta vieja después de una nueva
 * (se cambió el filtro con un pedido en vuelo), se descarta.
 */
export function useListadoDeMiLink<T extends { id: string }>(
  pedir: (filtros: FiltrosDeMiLink) => Promise<Resultado<T[]>>,
  filtros: FiltrosDeMiLink,
): ListadoDeMiLink<T> {
  const [filas, setFilas] = useState<T[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const peticion = useRef(0)
  /** Si ya hay algo a la vista: decide si el error de un refresco silencioso se muestra. */
  const hayFilas = useRef(false)

  const recargar = useCallback(
    async (enSilencio = false) => {
      const mia = ++peticion.current
      if (!enSilencio) setCargando(true)
      const resultado = await pedir(filtros)
      if (mia !== peticion.current) return
      if (resultado.ok) {
        setFilas(resultado.datos)
        hayFilas.current = resultado.datos.length > 0
        setError(null)
      } else if (!enSilencio || !hayFilas.current) {
        // Un refresco silencioso que falla (se cortó internet un minuto) no tapa lo que ya se ve con un
        // cartel rojo; si no había nada a la vista, sí se avisa.
        setError(resultado.error)
      }
      setCargando(false)
    },
    [pedir, filtros],
  )

  useEffect(() => {
    void recargar()
  }, [recargar])

  useEffect(() => {
    const reloj = setInterval(() => void recargar(true), REFRESCO_DE_LISTADOS_MS)
    return () => clearInterval(reloj)
  }, [recargar])

  const reemplazar = useCallback((fila: T) => setFilas((previas) => previas.map((previa) => (previa.id === fila.id ? fila : previa))), [])

  return { filas, cargando, error, recargar, reemplazar }
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

interface PropsFiltros {
  borrador: FiltrosDeMiLink
  alCambiar: (cambios: Partial<FiltrosDeMiLink>) => void
  estados: ReadonlyArray<{ valor: string; texto: string }>
  /** Qué se puede escribir en «Buscar». */
  ayudaDeTexto: string
  /** null = no se ofrece el filtro «Usuario» (empleados). */
  usuarios: Array<{ valor: string; texto: string }> | null
  alBuscar: () => void
  alLimpiar: () => void
  buscando: boolean
}

/** El panel «Filtros de Búsqueda» de los dos listados: fechas, estado, texto y, para administradores, usuario. */
export function FiltrosDeMiLinkPanel({ borrador, alCambiar, estados, ayudaDeTexto, usuarios, alBuscar, alLimpiar, buscando }: PropsFiltros) {
  return (
    <PanelDeFiltros alBuscar={alBuscar} alLimpiar={alLimpiar} buscando={buscando}>
      <GrillaDeFiltros columnas={usuarios ? 3 : 2}>
        <CampoDeFiltro etiqueta="Buscar">
          <input
            className={CLASES_INPUT_DE_FILTRO}
            value={borrador.texto}
            onChange={(e) => alCambiar({ texto: e.target.value })}
            placeholder={ayudaDeTexto}
          />
        </CampoDeFiltro>
        <CampoDeFiltro etiqueta="Estado">
          <select className={CLASES_INPUT_DE_FILTRO} value={borrador.estado} onChange={(e) => alCambiar({ estado: e.target.value })}>
            <option value="">Todos</option>
            {estados.map((estado) => (
              <option key={estado.valor} value={estado.valor}>
                {estado.texto}
              </option>
            ))}
          </select>
        </CampoDeFiltro>
        {usuarios && (
          <CampoDeFiltro etiqueta="Usuario">
            <select className={CLASES_INPUT_DE_FILTRO} value={borrador.usuario} onChange={(e) => alCambiar({ usuario: e.target.value })}>
              {usuarios.map((usuario) => (
                <option key={usuario.valor} value={usuario.valor}>
                  {usuario.texto}
                </option>
              ))}
            </select>
          </CampoDeFiltro>
        )}
        <CampoDeFiltro etiqueta="Fecha desde">
          <input type="date" className={CLASES_INPUT_DE_FILTRO} value={borrador.desde} onChange={(e) => alCambiar({ desde: e.target.value })} />
        </CampoDeFiltro>
        <CampoDeFiltro etiqueta="Fecha hasta">
          <input type="date" className={CLASES_INPUT_DE_FILTRO} value={borrador.hasta} onChange={(e) => alCambiar({ hasta: e.target.value })} />
        </CampoDeFiltro>
      </GrillaDeFiltros>
    </PanelDeFiltros>
  )
}

// ---------------------------------------------------------------------------
// El diálogo de seguimiento
// ---------------------------------------------------------------------------

/** Un dato del seguimiento: la etiqueta chica arriba y el valor debajo. Sin valor, un guion. */
export function Dato({ etiqueta, children, ancho = false }: { etiqueta: string; children: ReactNode; ancho?: boolean }) {
  const vacio = children === null || children === undefined || children === ''
  return (
    <div className={cx('min-w-0', ancho && 'sm:col-span-2')}>
      <dt className="text-[11px] font-bold tracking-[0.1em] text-slate-500 uppercase">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm break-words whitespace-pre-line text-slate-800">{vacio ? '—' : children}</dd>
    </div>
  )
}
