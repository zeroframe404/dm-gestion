// La campana de las autorizaciones puntuales, en la barra superior.
//
// Para quien tiene tildado «puede solicitar» en su rol: el botón «Pedir autorización» (elige el módulo,
// si necesita sólo leer o leer y escribir, y puede explicar para qué) y la lista de sus pedidos con la
// respuesta y el mensaje de quien resolvió. Para quien tiene tildado «puede resolver»: los pedidos de
// los demás, con lo que puede contestar (permitido, solo lectura o denegar), por cuánto tiempo y con
// un mensaje. La regla de fondo vive en el proceso principal (servicios/autorizaciones.ts); acá sólo se
// muestra y se manda.
//
// Se refresca sola cada minuto: los pedidos viajan por la base de usuarios, que no tiene canal en vivo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DURACIONES,
  LARGO_MAXIMO_MENSAJE,
  NOMBRE_DURACION,
  type Duracion,
  type EstadoDeAutorizaciones,
  type SolicitudDeAutorizacion,
} from '../../shared/autorizaciones'
import { AREAS, DESCRIPCION_AREA, NOMBRE_NIVEL, alcanza, type Area, type Nivel } from '../../shared/permisos'
import { usePermisos } from '../contexto/Permisos'
import { reproducir } from '../sonidos'
import { Icono } from './Icono'
import { Alerta, AreaTexto, Boton, Dialogo, Selector, cx } from './ui'

const CADA_CUANTO_MS = 60_000

function cuando(iso: string | null): string {
  if (!iso) return ''
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return fecha.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function estaVigente(s: SolicitudDeAutorizacion): boolean {
  return s.estado === 'concedida' && s.venceEn !== null && Date.parse(s.venceEn) > Date.now()
}

function textoDeEstado(s: SolicitudDeAutorizacion): { texto: string; clase: string } {
  if (s.estado === 'pendiente') return { texto: 'Pendiente', clase: 'text-amber-700' }
  if (s.estado === 'denegada') return { texto: 'Denegada', clase: 'text-red-700' }
  const nivel = NOMBRE_NIVEL[s.nivelOtorgado ?? 'ver']
  return estaVigente(s)
    ? { texto: `${nivel} hasta ${cuando(s.venceEn)}`, clase: 'text-green-700' }
    : { texto: `${nivel} (venció)`, clase: 'text-slate-500' }
}

export function CampanaDeAutorizaciones() {
  const { permisos } = usePermisos()
  const [estado, setEstado] = useState<EstadoDeAutorizaciones | null>(null)
  const [abierta, setAbierta] = useState(false)
  const [pidiendo, setPidiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const contenedor = useRef<HTMLDivElement | null>(null)
  const conocidos = useRef<Set<string> | null>(null)

  const traer = useCallback(async (actualizar: boolean) => {
    const resultado = await window.dm.autorizaciones.estado(actualizar)
    if (resultado.ok) setEstado(resultado.datos)
  }, [])

  useEffect(() => {
    void traer(true)
    const reloj = window.setInterval(() => void traer(true), CADA_CUANTO_MS)
    return () => window.clearInterval(reloj)
  }, [traer])

  // Suena cuando aparece algo que antes no estaba: un pedido nuevo para resolver, o una respuesta
  // nueva a lo que pedí. La primera lectura no suena (es lo que había al abrir el programa).
  useEffect(() => {
    if (!estado) return
    const actuales = new Set<string>([
      ...estado.pendientes.map((s) => `p:${s.id}`),
      ...estado.mias.filter((s) => s.estado !== 'pendiente' && !s.vista).map((s) => `r:${s.id}`),
    ])
    const anteriores = conocidos.current
    conocidos.current = actuales
    if (anteriores && [...actuales].some((id) => !anteriores.has(id))) reproducir('campana')
  }, [estado])

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

  const sinLeer = useMemo(() => estado?.mias.filter((s) => s.estado !== 'pendiente' && !s.vista).length ?? 0, [estado])
  const porResolver = estado?.pendientes.length ?? 0
  const conAlgo = sinLeer + porResolver > 0

  const abrir = async () => {
    const siguiente = !abierta
    setAbierta(siguiente)
    setError(null)
    // Abrirla cuenta como enterarse de las respuestas: se apaga el puntito.
    if (siguiente) {
      await traer(true)
      if (sinLeer > 0) {
        const resultado = await window.dm.autorizaciones.marcarVistas()
        if (resultado.ok) setEstado(resultado.datos)
      }
    }
  }

  if (!permisos || (!permisos.puedeSolicitar && !permisos.puedeResolver && !estado?.mias.length)) return null

  return (
    <div className="relative" ref={contenedor}>
      <button
        type="button"
        onClick={() => void abrir()}
        aria-label={
          conAlgo
            ? `Autorizaciones puntuales: ${porResolver} por resolver, ${sinLeer} respuestas nuevas`
            : 'Autorizaciones puntuales'
        }
        aria-expanded={abierta}
        title="Autorizaciones puntuales"
        className={cx(
          'relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marino-500/40',
          conAlgo ? 'text-marino-700 hover:bg-marino-50' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
          abierta && 'bg-slate-100',
        )}
      >
        <Icono nombre="llave" tamano={18} />
        {porResolver + sinLeer > 0 && <span className="text-xs font-bold tabular-nums">{porResolver + sinLeer}</span>}
        {conAlgo && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" aria-hidden="true" />}
      </button>

      {abierta && estado && (
        <div className="absolute right-0 z-40 mt-2 w-[28rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-media">
          <header className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold tracking-tight text-slate-900">Autorizaciones puntuales</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {estado.puedeResolver ? 'Pedidos de acceso de tus compañeros y tus propios pedidos.' : 'Pedí acceso a un módulo que tu rol no tiene.'}
              </p>
            </div>
            {estado.puedeSolicitar && (
              <Boton tamano="sm" variante="primario" icono="mas" onClick={() => setPidiendo(true)}>
                Pedir
              </Boton>
            )}
          </header>

          {error && <p className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-800">{error}</p>}

          <div className="max-h-[28rem] overflow-y-auto">
            {estado.puedeResolver && (
              <section>
                <h3 className="bg-slate-50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Para resolver</h3>
                {estado.pendientes.length === 0 && <p className="px-4 py-4 text-center text-sm text-slate-500">No hay pedidos pendientes.</p>}
                <ul>
                  {estado.pendientes.map((pedido) => (
                    <li key={pedido.id} className="border-b border-slate-100 last:border-b-0">
                      <FilaPorResolver
                        pedido={pedido}
                        alResolver={async (datos) => {
                          const resultado = await window.dm.autorizaciones.resolver(datos)
                          if (resultado.ok) {
                            setEstado(resultado.datos)
                            setError(null)
                            return null
                          }
                          return resultado.error
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3 className="bg-slate-50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Mis pedidos</h3>
              {estado.mias.length === 0 && <p className="px-4 py-4 text-center text-sm text-slate-500">Todavía no pediste nada.</p>}
              <ul>
                {estado.mias.map((pedido) => (
                  <li key={pedido.id} className="border-b border-slate-100 px-4 py-2.5 last:border-b-0">
                    <FilaDeMiPedido pedido={pedido} />
                  </li>
                ))}
              </ul>
            </section>

            {estado.puedeResolver && estado.resueltasRecientes.length > 0 && (
              <section>
                <h3 className="bg-slate-50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Resueltos hace poco</h3>
                <ul>
                  {estado.resueltasRecientes.map((pedido) => {
                    const { texto, clase } = textoDeEstado(pedido)
                    return (
                      <li key={pedido.id} className="border-b border-slate-100 px-4 py-2 text-xs last:border-b-0">
                        <p className="text-slate-800">
                          <span className="font-semibold">{pedido.nombre}</span> · {DESCRIPCION_AREA[pedido.area].nombre} ·{' '}
                          <span className={clase}>{texto}</span>
                        </p>
                        <p className="text-slate-400">Resolvió {pedido.resueltaPor ?? '—'} · {cuando(pedido.resueltaEn)}</p>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}

      {pidiendo && (
        <DialogoDePedido
          alCerrar={() => setPidiendo(false)}
          alPedir={(nuevo) => {
            setEstado(nuevo)
            setPidiendo(false)
          }}
        />
      )}
    </div>
  )
}

function FilaDeMiPedido({ pedido }: { pedido: SolicitudDeAutorizacion }) {
  const { texto, clase } = textoDeEstado(pedido)
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', pedido.estado !== 'pendiente' && !pedido.vista ? 'bg-red-500' : 'bg-slate-300')}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">
          {DESCRIPCION_AREA[pedido.area].nombre}
          <span className="font-normal text-slate-500"> · pediste «{NOMBRE_NIVEL[pedido.nivelPedido].toLowerCase()}»</span>
        </p>
        <p className={cx('text-xs font-semibold', clase)}>{texto}</p>
        {pedido.motivo && <p className="mt-0.5 text-xs text-slate-500">Tu mensaje: {pedido.motivo}</p>}
        {pedido.estado !== 'pendiente' && (
          <p className="mt-0.5 text-xs text-slate-700">
            {pedido.resueltaPor ?? 'Un administrador'} respondió{pedido.mensaje ? `: «${pedido.mensaje}»` : '.'}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-slate-400">Pedido el {cuando(pedido.creadaEn)}</p>
      </div>
    </div>
  )
}

function FilaPorResolver({
  pedido,
  alResolver,
}: {
  pedido: SolicitudDeAutorizacion
  alResolver: (datos: { id: string; decision: Nivel; mensaje: string; duracion: Duracion }) => Promise<string | null>
}) {
  const [respondiendo, setRespondiendo] = useState(false)
  const [decision, setDecision] = useState<Nivel>(pedido.nivelPedido)
  const [duracion, setDuracion] = useState<Duracion>('hoy')
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async () => {
    setEnviando(true)
    const falla = await alResolver({ id: pedido.id, decision, mensaje, duracion })
    setEnviando(false)
    setError(falla)
  }

  return (
    <div className="px-4 py-2.5">
      <p className="text-sm font-medium text-slate-900">
        {pedido.nombre}
        <span className="font-normal text-slate-500"> pide «{NOMBRE_NIVEL[pedido.nivelPedido].toLowerCase()}» en </span>
        {DESCRIPCION_AREA[pedido.area].nombre}
      </p>
      {pedido.motivo && <p className="mt-0.5 text-xs text-slate-600">«{pedido.motivo}»</p>}
      <p className="mt-0.5 text-[11px] text-slate-400">{cuando(pedido.creadaEn)}</p>

      {!respondiendo ? (
        <button type="button" onClick={() => setRespondiendo(true)} className="mt-1.5 text-xs font-semibold text-marino-700 hover:underline">
          Responder
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Selector
              etiqueta="Respuesta"
              value={decision}
              onChange={(evento) => setDecision(evento.target.value as Nivel)}
              opciones={[
                { valor: 'editar', texto: 'Permitido (lectura y escritura)' },
                { valor: 'ver', texto: 'Solo lectura' },
                { valor: 'ninguno', texto: 'Denegar' },
              ]}
            />
            {decision !== 'ninguno' && (
              <Selector
                etiqueta="Dura"
                value={duracion}
                onChange={(evento) => setDuracion(evento.target.value as Duracion)}
                opciones={DURACIONES.map((valor) => ({ valor, texto: NOMBRE_DURACION[valor] }))}
              />
            )}
          </div>
          <AreaTexto
            etiqueta="Mensaje (opcional)"
            rows={2}
            maxLength={LARGO_MAXIMO_MENSAJE}
            value={mensaje}
            onChange={(evento) => setMensaje(evento.target.value)}
            placeholder="Le llega a quien pidió."
          />
          {error && <Alerta tono="error">{error}</Alerta>}
          <div className="flex justify-end gap-2">
            <Boton tamano="sm" onClick={() => setRespondiendo(false)} disabled={enviando}>
              Cancelar
            </Boton>
            <Boton tamano="sm" variante={decision === 'ninguno' ? 'peligro' : 'primario'} cargando={enviando} onClick={() => void enviar()}>
              {decision === 'ninguno' ? 'Denegar' : 'Autorizar'}
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}

function DialogoDePedido({ alCerrar, alPedir }: { alCerrar: () => void; alPedir: (estado: EstadoDeAutorizaciones) => void }) {
  const { permisos } = usePermisos()
  // Sólo los módulos donde todavía falta algo: no tiene sentido pedir lo que ya se tiene.
  const pedibles = useMemo<Area[]>(
    () => AREAS.filter((area) => !permisos || !alcanza(permisos.areas[area], 'editar')),
    [permisos],
  )
  const [area, setArea] = useState<Area>(pedibles[0] ?? AREAS[0]!)
  const [nivel, setNivel] = useState<'ver' | 'editar'>('ver')
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const nivelActual: Nivel = permisos?.areas[area] ?? 'ninguno'
  // Si ya puede leer, lo único que tiene sentido pedir es poder escribir.
  const opcionesDeNivel = nivelActual === 'ver' ? ([['editar', 'Lectura y escritura']] as const) : ([['ver', 'Solo lectura'], ['editar', 'Lectura y escritura']] as const)
  useEffect(() => {
    if (nivelActual === 'ver') setNivel('editar')
  }, [nivelActual])

  const enviar = async () => {
    setEnviando(true)
    setError(null)
    const resultado = await window.dm.autorizaciones.pedir({ area, nivel, motivo })
    setEnviando(false)
    if (resultado.ok) alPedir(resultado.datos)
    else setError(resultado.error)
  }

  return (
    <Dialogo
      abierto
      titulo="Pedir autorización"
      descripcion="Elegí el módulo y qué necesitás hacer. Alguien con permiso lo va a ver, decidir y contestarte con un mensaje. Es un acceso temporal."
      alCerrar={alCerrar}
      pie={
        <>
          <Boton onClick={alCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton variante="primario" cargando={enviando} disabled={pedibles.length === 0} onClick={() => void enviar()}>
            Enviar pedido
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {pedibles.length === 0 ? (
          <Alerta tono="info">Ya tenés acceso completo a todos los módulos.</Alerta>
        ) : (
          <>
            <Selector
              etiqueta="Módulo"
              value={area}
              onChange={(evento) => setArea(evento.target.value as Area)}
              opciones={pedibles.map((valor) => ({ valor, texto: `${DESCRIPCION_AREA[valor].nombre}${permisos && permisos.areas[valor] === 'ver' ? ' (hoy: solo lectura)' : ''}` }))}
              ayuda={DESCRIPCION_AREA[area].detalle}
            />
            <Selector
              etiqueta="Qué necesitás"
              value={nivel}
              onChange={(evento) => setNivel(evento.target.value as 'ver' | 'editar')}
              opciones={opcionesDeNivel.map(([valor, texto]) => ({ valor, texto }))}
            />
            <AreaTexto
              etiqueta="Mensaje (opcional)"
              rows={3}
              maxLength={LARGO_MAXIMO_MENSAJE}
              value={motivo}
              onChange={(evento) => setMotivo(evento.target.value)}
              placeholder="Contá para qué lo necesitás."
            />
          </>
        )}
        {error && <Alerta tono="error">{error}</Alerta>}
      </div>
    </Dialogo>
  )
}
