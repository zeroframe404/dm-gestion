// El asistente con IA: el círculo de abajo a la derecha, en cualquier pantalla.
//
// Contesta consultas sobre los datos del programa y sugiere qué hacer, sin tocar nada: es sólo de lectura.
// Lo que la IA llega a ver lo decide el proceso principal (servicios/asistente.ts) con los mismos permisos
// de cada pantalla; acá sólo se dibuja la conversación. La historia completa (con lo que consultó) vive en
// el proceso principal: la pantalla guarda sólo el texto para mostrarlo.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  LARGO_MAXIMO_DE_LA_PREGUNTA,
  NOMBRE_DEL_ESFUERZO,
  type EsfuerzoDelAsistente,
  type EstadoDelAsistente,
} from '../../shared/asistente'
import { Icono } from './Icono'
import { Alerta, Boton, CampoClave, cx } from './ui'

interface Mensaje {
  de: 'persona' | 'asistente'
  texto: string
  esfuerzo?: EsfuerzoDelAsistente
  consultas?: string[]
  error?: boolean
}

const SUGERENCIAS = [
  '¿Cuántos clientes activos con deuda hay?',
  '¿Qué pólizas vencen esta semana?',
  '¿Cómo viene la mora de mi sucursal?',
  '¿Qué tareas están vencidas?',
]

/** Negritas (**así**) y renglones con viñeta; nada de HTML crudo. */
function conFormato(texto: string): ReactNode {
  return texto.split('\n').map((renglon, i) => {
    const vineta = /^\s*[-*•]\s+/.test(renglon)
    const limpio = vineta ? renglon.replace(/^\s*[-*•]\s+/, '') : renglon
    const partes = limpio.split(/(\*\*[^*]+\*\*)/g).map((parte, j) =>
      parte.startsWith('**') && parte.endsWith('**') ? <strong key={j}>{parte.slice(2, -2)}</strong> : parte.replace(/^#+\s*/, ''),
    )
    if (!limpio.trim()) return <div key={i} className="h-2" />
    return (
      <div key={i} className={vineta ? 'flex gap-1.5 pl-1' : undefined}>
        {vineta && <span aria-hidden>•</span>}
        <span>{partes}</span>
      </div>
    )
  })
}

export function AsistenteIA() {
  const [abierto, setAbierto] = useState(false)
  const [estado, setEstado] = useState<EstadoDelAsistente | null>(null)
  const [configurando, setConfigurando] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [conversacionId, setConversacionId] = useState<string | null>(null)
  const [pregunta, setPregunta] = useState('')
  const [pensando, setPensando] = useState(false)
  const fondo = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!abierto) return
    void window.dm.asistente.estado().then((r) => {
      if (r.ok) setEstado(r.datos)
    })
  }, [abierto])

  useEffect(() => {
    fondo.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes, pensando])

  useEffect(() => {
    if (abierto && !configurando) campo.current?.focus()
  }, [abierto, configurando, estado])

  async function preguntar(texto: string) {
    const limpio = texto.trim()
    if (!limpio || pensando) return
    setPregunta('')
    setMensajes((previos) => [...previos, { de: 'persona', texto: limpio }])
    setPensando(true)
    const r = await window.dm.asistente.preguntar({ conversacionId, texto: limpio })
    setPensando(false)
    if (r.ok) {
      setConversacionId(r.datos.conversacionId)
      setMensajes((previos) => [...previos, { de: 'asistente', texto: r.datos.texto, esfuerzo: r.datos.esfuerzo, consultas: r.datos.consultas }])
    } else {
      setMensajes((previos) => [...previos, { de: 'asistente', texto: r.error, error: true }])
    }
  }

  function alTeclear(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault()
      void preguntar(pregunta)
    }
  }

  function nueva() {
    setMensajes([])
    setConversacionId(null)
    setPregunta('')
  }

  const listo = estado?.configurado === true

  return (
    <>
      {abierto && (
        <section
          aria-label="Asistente con IA"
          className="fixed bottom-24 right-6 z-40 flex h-[600px] max-h-[calc(100vh-8rem)] w-[420px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-media"
        >
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-marino-700 text-white">
              <Icono nombre="chispa" tamano={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">Asistente IA</div>
              <div className="text-xs text-slate-500">Sólo consulta: no modifica nada</div>
            </div>
            {listo && !configurando && mensajes.length > 0 && (
              <button type="button" onClick={nueva} className="rounded-md px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100" title="Empezar una conversación nueva">
                Nueva
              </button>
            )}
            {estado?.puedeConfigurar && (
              <button
                type="button"
                onClick={() => setConfigurando((v) => !v)}
                className={cx('rounded-md p-1.5 text-slate-600 hover:bg-slate-100', configurando && 'bg-slate-100')}
                title="Configurar la clave de Anthropic"
              >
                <Icono nombre="llave" tamano={16} />
              </button>
            )}
            <button type="button" onClick={() => setAbierto(false)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100" title="Cerrar">
              <Icono nombre="cerrar" tamano={16} />
            </button>
          </header>

          {!estado ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Cargando…</div>
          ) : configurando || (!listo && estado.puedeConfigurar) ? (
            <ConfiguracionDeLaClave estado={estado} alGuardar={(nuevo) => { setEstado(nuevo); if (nuevo.configurado) setConfigurando(false) }} />
          ) : !listo ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-600">
              <Icono nombre="info" tamano={22} className="text-slate-400" />
              El asistente todavía no está configurado. Lo activa el superadministrador cargando la clave de Anthropic.
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                {mensajes.length === 0 && (
                  <div className="space-y-3 pt-2">
                    <p className="text-sm text-slate-600">
                      Preguntame sobre clientes, pólizas, renovaciones, siniestros, cobranzas o tareas, o cómo se hace algo en el programa. Veo lo mismo que vos podés ver.
                    </p>
                    <div className="flex flex-col gap-2">
                      {SUGERENCIAS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void preguntar(s)}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {mensajes.map((m, i) =>
                  m.de === 'persona' ? (
                    <div key={i} className="ml-10 rounded-2xl rounded-br-sm bg-marino-700 px-3 py-2 text-sm whitespace-pre-wrap text-white">
                      {m.texto}
                    </div>
                  ) : (
                    <div key={i} className="mr-6 space-y-1">
                      <div
                        className={cx(
                          'rounded-2xl rounded-bl-sm px-3 py-2 text-sm',
                          m.error ? 'border border-red-200 bg-red-50 text-red-700' : 'bg-slate-100 text-slate-800',
                        )}
                      >
                        {m.error ? m.texto : conFormato(m.texto)}
                      </div>
                      {m.esfuerzo && (
                        <div className="px-1 text-[11px] text-slate-500">
                          Esfuerzo: {NOMBRE_DEL_ESFUERZO[m.esfuerzo]}
                          {m.consultas && m.consultas.length > 0 ? ` · ${m.consultas.join(' · ')}` : ''}
                        </div>
                      )}
                    </div>
                  ),
                )}
                {pensando && (
                  <div className="mr-6 flex items-center gap-2 rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-500">
                    <Icono nombre="cargando" tamano={14} className="animate-spin" /> Pensando…
                  </div>
                )}
                <div ref={fondo} />
              </div>
              <div className="flex items-end gap-2 border-t border-slate-200 p-3">
                <textarea
                  ref={campo}
                  value={pregunta}
                  onChange={(e) => setPregunta(e.target.value)}
                  onKeyDown={alTeclear}
                  rows={2}
                  maxLength={LARGO_MAXIMO_DE_LA_PREGUNTA}
                  placeholder="Escribí tu consulta…"
                  className="min-h-10 flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-marino-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void preguntar(pregunta)}
                  disabled={pensando || !pregunta.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marino-700 text-white hover:bg-marino-600 disabled:opacity-50"
                  title="Enviar (Enter)"
                >
                  <Icono nombre="enviar" tamano={16} />
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={abierto ? 'Cerrar el asistente con IA' : 'Abrir el asistente con IA'}
        title="Asistente IA"
        className={cx(
          'fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-media transition-transform',
          'bg-marino-700 hover:scale-105 hover:bg-marino-600 focus-visible:ring-2 focus-visible:ring-marino-500/40 focus-visible:outline-none',
        )}
      >
        <Icono nombre={abierto ? 'cerrar' : 'chispa'} tamano={24} />
      </button>
    </>
  )
}

function ConfiguracionDeLaClave({ estado, alGuardar }: { estado: EstadoDelAsistente; alGuardar: (estado: EstadoDelAsistente) => void }) {
  const [clave, setClave] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    setGuardando(true)
    setError(null)
    const r = await window.dm.asistente.guardarClave(clave)
    setGuardando(false)
    if (r.ok) {
      setClave('')
      alGuardar(r.datos)
    } else setError(r.error)
  }

  async function borrar() {
    setGuardando(true)
    const r = await window.dm.asistente.borrarClave()
    setGuardando(false)
    if (r.ok) alGuardar(r.datos)
    else setError(r.error)
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm text-slate-700">
      <p>
        El asistente usa <strong>Claude Haiku</strong> de Anthropic. Cargá la clave de la API (empieza con «sk-ant-»); se guarda una sola vez y
        viaja cifrada al servidor para que la tengan todas las computadoras.
      </p>
      {estado.configurado && (
        <Alerta tono="exito">
          Hay una clave cargada (termina en …{estado.finDeLaClave}). Para cambiarla, cargá la nueva.
        </Alerta>
      )}
      <CampoClave etiqueta="Clave de Anthropic" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
      {error && <Alerta tono="error">{error}</Alerta>}
      <div className="flex gap-2">
        <Boton variante="primario" onClick={() => void guardar()} cargando={guardando} disabled={!clave.trim()}>
          Guardar clave
        </Boton>
        {estado.configurado && (
          <Boton variante="peligro" onClick={() => void borrar()} disabled={guardando}>
            Quitar
          </Boton>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Qué puede ver: lo mismo que la persona que pregunta, según su rol y sus permisos. Nunca ve claves, usuarios, permisos ni configuración, y a
        los usuarios no les muestra la plata de la agencia (sólo la de su sucursal). No puede modificar nada.
      </p>
    </div>
  )
}
