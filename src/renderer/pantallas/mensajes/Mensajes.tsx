// El chat de la agencia: la lista de conversaciones a la izquierda y el hilo a la derecha.
//
// Tres cosas de las que depende que esto se sienta bien y que no son obvias:
//
//   1. **Las alturas.** El zoom del programa no es CSS: es `webFrame.setZoomFactor`, y escala todo,
//      píxeles incluidos. La ventana no scrollea (`body { overflow: hidden }`), así que nada puede
//      medirse en `vh` ni tener alto fijo: lo que se sale de la pantalla al 175 % no vuelve. Por eso
//      la caja de escribir es `shrink-0` y el hilo `min-h-0 flex-1 overflow-y-auto`. Sin el `min-h-0`,
//      flex no deja encoger el hilo y la caja de escribir se va abajo del borde de la ventana.
//   2. **Pegar con Ctrl+V.** El `SelectorDeAdjuntos` del resto del programa escucha el `paste` en la
//      ventana entera y se autoexcluye cuando el foco está en un campo de texto («pegar texto en un
//      campo sigue siendo pegar texto»). En un chat eso deja afuera justo el caso que importa: pegar
//      una captura mientras se escribe. Acá el `onPaste` va en el propio textarea y mira los archivos
//      del portapapeles.
//   3. **Marcar como leído.** Se hace al abrir la conversación y cada vez que llega algo con la
//      conversación abierta, no cuando la ventana está detrás de otra: leer es haber mirado.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ArchivoParaAdjuntar,
  ContactoDeMensajeria,
  ConversacionInterna,
  EstadoDeMensajeria,
  HiloDeMensajes,
} from '../../../shared/tipos'
import { largoEnPuntos, MAXIMO_DE_UN_MENSAJE } from '../../../shared/texto'
import { Icono } from '../../componentes/Icono'
import { Alerta, Boton, Campo, Cargando, cx, Dialogo, haceCuanto } from '../../componentes/ui'
import { prepararArchivos } from '../../imagenes'
import { usePermisos } from '../../contexto/Permisos'
import { Burbuja } from './Burbuja'
import { SelectorDeEmojis } from './SelectorDeEmojis'

/**
 * Cuánto hay que esperar entre dos zumbidos. Es el mismo número que tienen el proceso principal y el
 * servidor, escrito acá para que el botón lo pueda mostrar: los tres topes son el mismo tope, y el que
 * manda es el del servidor —éste sólo evita el error rojo—.
 */
const ESPERA_ENTRE_ZUMBIDOS_SEGUNDOS = 10

/** Un archivo elegido y todavía no mandado, con su vista previa si es una foto. */
interface ArchivoEnEspera {
  archivo: ArchivoParaAdjuntar
  clave: string
}

export function Mensajes() {
  const permisos = usePermisos()
  const puedeEscribir = permisos.puedeEditar('mensajes')

  const [conversaciones, setConversaciones] = useState<ConversacionInterna[] | null>(null)
  const [elegida, setElegida] = useState<number | null>(null)
  const [hilo, setHilo] = useState<HiloDeMensajes | null>(null)
  const [estado, setEstado] = useState<EstadoDeMensajeria | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buscando, setBuscando] = useState('')
  const [nuevaAbierta, setNuevaAbierta] = useState(false)

  const [texto, setTexto] = useState('')
  const [enEspera, setEnEspera] = useState<ArchivoEnEspera[]>([])
  const [mandando, setMandando] = useState(false)
  const [zumbando, setZumbando] = useState(false)
  /** Cuántos segundos faltan para poder zumbar de nuevo. 0 = se puede. */
  const [esperaDelZumbido, setEsperaDelZumbido] = useState(0)

  const caja = useRef<HTMLTextAreaElement | null>(null)
  const fondoDelHilo = useRef<HTMLDivElement | null>(null)

  const cargarConversaciones = useCallback(async () => {
    const respuesta = await window.dm.mensajes.conversaciones()
    if (respuesta.ok) setConversaciones(respuesta.datos)
    else setError(respuesta.error)
  }, [])

  const cargarEstado = useCallback(async () => {
    const respuesta = await window.dm.mensajes.estado()
    if (respuesta.ok) setEstado(respuesta.datos)
  }, [])

  const cargarHilo = useCallback(async (conversacionId: number) => {
    const respuesta = await window.dm.mensajes.hilo(conversacionId, null)
    if (!respuesta.ok) {
      setError(respuesta.error)
      return
    }
    setHilo(respuesta.datos)
    // Abrir la conversación es haberla leído: se apaga el globito acá y se le avisa al servidor, que
    // es lo que mueve el tilde en la pantalla del que escribió.
    await window.dm.mensajes.marcarLeidos(conversacionId)
    await cargarConversaciones()
  }, [cargarConversaciones])

  useEffect(() => {
    void cargarConversaciones()
    void cargarEstado()
  }, [cargarConversaciones, cargarEstado])

  useEffect(() => {
    if (elegida === null) return
    void cargarHilo(elegida)
  }, [elegida, cargarHilo])

  // La suscripción a los avisos del proceso principal se monta UNA vez y lee la conversación abierta
  // de un ref: si dependiera del estado, cada tecla escrita quitaría y volvería a poner el oyente.
  const elegidaAhora = useRef<number | null>(null)
  elegidaAhora.current = elegida
  useEffect(() => {
    const refrescar = () => {
      void cargarConversaciones()
      void cargarEstado()
      if (elegidaAhora.current !== null) void cargarHilo(elegidaAhora.current)
    }
    const soltarLlegada = window.dm.mensajes.alLlegarAlguno(refrescar)
    const soltarCambio = window.dm.mensajes.alCambiarAlgo(refrescar)
    return () => {
      soltarLlegada()
      soltarCambio()
    }
  }, [cargarConversaciones, cargarEstado, cargarHilo])

  // La cuenta regresiva del zumbido, en la pantalla. El tope de verdad lo ponen el servicio y el
  // servidor; esto es para que el botón se vea apagado y diga cuánto falta, en vez de dejar que
  // alguien lo toque cinco veces y reciba cinco errores rojos.
  useEffect(() => {
    if (esperaDelZumbido <= 0) return
    const reloj = setTimeout(() => setEsperaDelZumbido((antes) => Math.max(0, antes - 1)), 1000)
    return () => clearTimeout(reloj)
  }, [esperaDelZumbido])

  // Cambiar de conversación limpia la espera: el tope es por conversación, no por persona que escribe.
  useEffect(() => {
    setEsperaDelZumbido(0)
  }, [elegida])

  // Bajar del todo cuando cambia el hilo: un chat que abre mostrando lo de hace tres días no sirve.
  useEffect(() => {
    fondoDelHilo.current?.scrollIntoView({ block: 'end' })
  }, [hilo])

  const visibles = useMemo(() => {
    const aguja = buscando.trim().toLowerCase()
    if (!aguja || !conversaciones) return conversaciones ?? []
    return conversaciones.filter(
      (conversacion) =>
        conversacion.titulo.toLowerCase().includes(aguja) ||
        conversacion.participantes.some((participante) => participante.nombre.toLowerCase().includes(aguja)),
    )
  }, [conversaciones, buscando])

  const sumarArchivos = async (archivos: File[]) => {
    if (!archivos.length) return
    const preparados = await prepararArchivos(archivos)
    setEnEspera((antes) => [
      ...antes,
      ...preparados.map((preparado, indice) => ({
        archivo: preparado.archivo,
        clave: `${Date.now()}-${antes.length + indice}-${preparado.archivo.nombre}`,
      })),
    ])
  }

  const mandar = async () => {
    if (elegida === null || mandando) return
    const cuerpo = texto.trim()
    if (!cuerpo && !enEspera.length) return
    setMandando(true)
    setError(null)
    const respuesta = await window.dm.mensajes.enviar(
      elegida,
      cuerpo,
      enEspera.map((espera) => espera.archivo),
    )
    setMandando(false)
    if (!respuesta.ok) {
      setError(respuesta.error)
      return
    }
    setTexto('')
    setEnEspera([])
    await cargarHilo(elegida)
    await cargarConversaciones()
    caja.current?.focus()
  }

  /**
   * El clip: abre el diálogo del sistema y manda en el mismo mensaje lo elegido ahí, el texto escrito
   * y lo que ya se había arrastrado o pegado. Los archivos del diálogo se leen en el proceso principal
   * y no cruzan el puente: es lo que permite mandar un video sin congelar la ventana.
   */
  const elegirYMandar = async () => {
    if (elegida === null || mandando) return
    setMandando(true)
    setError(null)
    const respuesta = await window.dm.mensajes.enviarConArchivos(
      elegida,
      texto.trim(),
      null,
      enEspera.map((espera) => espera.archivo),
    )
    setMandando(false)
    if (!respuesta.ok) {
      // Cancelar el diálogo no es un error que valga la pena pintar de rojo.
      if (respuesta.error !== 'No se eligió ningún archivo.') setError(respuesta.error)
      return
    }
    setTexto('')
    setEnEspera([])
    await cargarHilo(elegida)
    await cargarConversaciones()
  }

  /**
   * El zumbido: del otro lado suena fuerte y se le mueve la ventana.
   *
   * A diferencia de mandar un mensaje, esto SÍ espera al servidor: un zumbido no se encola, porque uno
   * que sale media hora después no llama la atención sobre nada. Por eso puede fallar por falta de
   * conexión, y por eso el error se muestra.
   */
  const zumbar = async () => {
    if (elegida === null || zumbando || esperaDelZumbido > 0) return
    setZumbando(true)
    setError(null)
    const respuesta = await window.dm.mensajes.zumbar(elegida)
    setZumbando(false)
    if (!respuesta.ok) {
      setError(respuesta.error)
      return
    }
    setEsperaDelZumbido(ESPERA_ENTRE_ZUMBIDOS_SEGUNDOS)
    await cargarHilo(elegida)
    await cargarConversaciones()
    caja.current?.focus()
  }

  const insertarEmoji = (emoji: string) => {
    const campo = caja.current
    if (!campo) {
      setTexto((antes) => antes + emoji)
      return
    }
    // Se inserta donde está el cursor, no al final: si no, agregar una carita en el medio de una
    // frase obliga a cortar y pegar.
    const desde = campo.selectionStart ?? campo.value.length
    const hasta = campo.selectionEnd ?? desde
    setTexto((antes) => antes.slice(0, desde) + emoji + antes.slice(hasta))
    requestAnimationFrame(() => {
      campo.focus()
      const nuevaPosicion = desde + emoji.length
      campo.setSelectionRange(nuevaPosicion, nuevaPosicion)
    })
  }

  const abrirCon = async (clave: string) => {
    setNuevaAbierta(false)
    const respuesta = await window.dm.mensajes.abrirCon(clave)
    if (!respuesta.ok) {
      setError(respuesta.error)
      return
    }
    await cargarConversaciones()
    setElegida(respuesta.datos.id)
  }

  const borrar = async (mensajeId: number) => {
    const respuesta = await window.dm.mensajes.borrar(mensajeId)
    if (!respuesta.ok) setError(respuesta.error)
    if (elegida !== null) await cargarHilo(elegida)
  }

  const reintentar = async (mensajeId: number) => {
    const respuesta = await window.dm.mensajes.reintentar(mensajeId)
    if (!respuesta.ok) setError(respuesta.error)
    if (elegida !== null) await cargarHilo(elegida)
  }

  const verAnteriores = async () => {
    if (!hilo || !hilo.mensajes.length || elegida === null) return
    const respuesta = await window.dm.mensajes.hilo(elegida, hilo.mensajes[0].id)
    if (!respuesta.ok) {
      setError(respuesta.error)
      return
    }
    setHilo((antes) =>
      antes
        ? { ...antes, mensajes: [...respuesta.datos.mensajes, ...antes.mensajes], hayMas: respuesta.datos.hayMas }
        : respuesta.datos,
    )
  }

  const largo = largoEnPuntos(texto)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {estado && !estado.configurada && (
        <Alerta tono="aviso">
          Esta computadora no tiene configurada la conexión con el servidor de la agencia: se ven los mensajes que ya
          están, y lo que se escriba va a esperar hasta que la conexión esté.
        </Alerta>
      )}
      {estado?.ultimoError && <Alerta tono="aviso">{estado.ultimoError}</Alerta>}
      {error && <Alerta tono="error">{error}</Alerta>}

      <div className="flex min-h-0 flex-1 gap-3">
        {/* ---------------------------------------------------------------- lista */}
        <aside className="flex w-72 shrink-0 flex-col rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 p-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">
                <Icono nombre="lupa" tamano={14} />
              </span>
              <input
                value={buscando}
                onChange={(evento) => setBuscando(evento.target.value)}
                placeholder="Buscar"
                className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-marino-400 focus:outline-none"
              />
            </div>
            <Boton
              tamano="sm"
              variante="primario"
              icono="mas"
              disabled={!puedeEscribir}
              onClick={() => setNuevaAbierta(true)}
              title={puedeEscribir ? 'Escribirle a alguien' : 'No tenés permiso para escribir mensajes'}
            >
              Nueva
            </Boton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {conversaciones === null ? (
              <Cargando texto="Buscando las conversaciones…" />
            ) : visibles.length === 0 ? (
              <p className="p-4 text-center text-sm text-slate-500">
                {buscando.trim() ? 'No hay ninguna con ese nombre.' : 'Todavía no hablaste con nadie. Tocá «Nueva».'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {visibles.map((conversacion) => (
                  <li key={conversacion.id}>
                    <button
                      type="button"
                      onClick={() => setElegida(conversacion.id)}
                      className={cx(
                        'flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-50',
                        elegida === conversacion.id && 'bg-marino-50',
                      )}
                    >
                      <span className="mt-0.5 shrink-0 text-slate-400">
                        <Icono nombre={conversacion.tipo === 'GRUPO' ? 'clientes' : 'usuario'} tamano={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-800">{conversacion.titulo}</span>
                          {conversacion.ultimoEn && (
                            <span className="shrink-0 text-xs text-slate-400">{haceCuanto(conversacion.ultimoEn)}</span>
                          )}
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-slate-500">
                            {conversacion.ultimoMio ? 'Vos: ' : ''}
                            {conversacion.ultimoTexto || 'Sin mensajes'}
                          </span>
                          {conversacion.sinLeer > 0 && (
                            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-marino-700 px-1.5 text-xs font-bold text-white tabular-nums">
                              {conversacion.sinLeer}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {estado && (estado.enCola > 0 || (estado.configurada && !estado.enLinea)) && (
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              {/* Por qué las dos cosas juntas: «hay tres esperando» sin decir que no hay conexión deja a
                  la persona preguntándose si el programa se colgó. Y «sin conexión» sin la cola no
                  aclara que lo que escribió no se perdió. */}
              {estado.configurada && !estado.enLinea && 'Sin conexión con el servidor. '}
              {estado.enCola === 1
                ? 'Hay 1 mensaje esperando para salir.'
                : estado.enCola > 1
                  ? `Hay ${estado.enCola} mensajes esperando para salir.`
                  : 'Los mensajes nuevos van a llegar cuando vuelva.'}
            </p>
          )}
        </aside>

        {/* ---------------------------------------------------------------- hilo */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-slate-50">
          {!hilo ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <p className="max-w-sm text-sm text-slate-500">
                Elegí una conversación de la izquierda, o tocá «Nueva» para escribirle a alguien de la agencia.
              </p>
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
                <span className="text-slate-400">
                  <Icono nombre={hilo.conversacion.tipo === 'GRUPO' ? 'clientes' : 'usuario'} tamano={20} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{hilo.conversacion.titulo}</p>
                  {hilo.conversacion.tipo === 'GRUPO' && (
                    <p className="truncate text-xs text-slate-500">
                      {hilo.conversacion.participantes.map((participante) => participante.nombre).join(', ')}
                    </p>
                  )}
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                {hilo.hayMas && (
                  <div className="mb-3 flex justify-center">
                    <Boton tamano="sm" variante="secundario" onClick={() => void verAnteriores()}>
                      Ver mensajes anteriores
                    </Boton>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {hilo.mensajes.map((mensaje) => (
                    <Burbuja
                      key={mensaje.id}
                      mensaje={mensaje}
                      mostrarAutor={hilo.conversacion.tipo === 'GRUPO'}
                      alBorrar={(id) => void borrar(id)}
                      alReintentar={(id) => void reintentar(id)}
                    />
                  ))}
                  {hilo.mensajes.length === 0 && (
                    <p className="py-8 text-center text-sm text-slate-500">Todavía no se dijeron nada. Escribí abajo.</p>
                  )}
                </div>
                <div ref={fondoDelHilo} />
              </div>

              {/* ------------------------------------------------------- escribir */}
              <div
                className="shrink-0 border-t border-slate-200 bg-white p-2"
                onDragOver={(evento) => evento.preventDefault()}
                onDrop={(evento) => {
                  evento.preventDefault()
                  void sumarArchivos(Array.from(evento.dataTransfer?.files ?? []))
                }}
              >
                {enEspera.length > 0 && (
                  <ul className="mb-2 flex flex-wrap gap-1.5">
                    {enEspera.map((espera) => (
                      <li
                        key={espera.clave}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-2 pr-1 text-xs text-slate-700"
                      >
                        <Icono nombre="clip" tamano={13} />
                        <span className="max-w-40 truncate">{espera.archivo.nombre}</span>
                        <button
                          type="button"
                          onClick={() => setEnEspera((antes) => antes.filter((cada) => cada.clave !== espera.clave))}
                          aria-label={`Sacar ${espera.archivo.nombre}`}
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        >
                          <Icono nombre="cerrar" tamano={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-end gap-1.5">
                  <button
                    type="button"
                    disabled={!puedeEscribir}
                    onClick={() => void elegirYMandar()}
                    aria-label="Adjuntar archivos"
                    title="Adjuntar archivos del disco"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Icono nombre="clip" tamano={18} />
                  </button>

                  <SelectorDeEmojis alElegir={insertarEmoji} disabled={!puedeEscribir} />

                  <button
                    type="button"
                    disabled={!puedeEscribir || zumbando || esperaDelZumbido > 0}
                    onClick={() => void zumbar()}
                    aria-label="Mandar un zumbido"
                    title={
                      !puedeEscribir
                        ? 'No tenés permiso para escribir mensajes'
                        : esperaDelZumbido > 0
                          ? `Esperá ${esperaDelZumbido} segundos para mandar otro zumbido`
                          : 'Zumbido: del otro lado suena fuerte y se le mueve la ventana'
                    }
                    className={cx(
                      'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                      'hover:bg-amber-50 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40',
                      'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
                      zumbando ? 'text-amber-700' : 'text-slate-600',
                    )}
                  >
                    {esperaDelZumbido > 0 ? (
                      <span className="text-xs font-bold tabular-nums">{esperaDelZumbido}</span>
                    ) : (
                      <Icono nombre="altavoz" tamano={18} />
                    )}
                  </button>

                  <textarea
                    ref={caja}
                    value={texto}
                    disabled={!puedeEscribir}
                    onChange={(evento) => setTexto(evento.target.value)}
                    onPaste={(evento) => {
                      // Acá y no en el oyente global: pegar una captura mientras se escribe es el caso
                      // normal de un chat, y el oyente global se excluye justamente cuando el foco está
                      // en un campo de texto.
                      const archivos = Array.from(evento.clipboardData?.files ?? [])
                      if (!archivos.length) return
                      evento.preventDefault()
                      void sumarArchivos(archivos)
                    }}
                    onKeyDown={(evento) => {
                      // Enter manda; Shift+Enter hace un renglón. Es lo que espera cualquiera que haya
                      // usado un chat, y escribir dos renglones es mucho menos frecuente que mandar.
                      if (evento.key === 'Enter' && !evento.shiftKey) {
                        evento.preventDefault()
                        void mandar()
                      }
                    }}
                    rows={1}
                    placeholder={puedeEscribir ? 'Escribí un mensaje…' : 'Tenés permiso para leer, no para escribir'}
                    className="max-h-40 min-h-9 flex-1 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-marino-400 focus:outline-none disabled:bg-slate-50"
                  />

                  <Boton
                    variante="primario"
                    icono="enlace"
                    cargando={mandando}
                    disabled={!puedeEscribir || (!texto.trim() && !enEspera.length)}
                    onClick={() => void mandar()}
                  >
                    Mandar
                  </Boton>
                </div>

                {largo > MAXIMO_DE_UN_MENSAJE * 0.9 && (
                  <p className={cx('mt-1 text-right text-xs', largo > MAXIMO_DE_UN_MENSAJE ? 'text-red-700' : 'text-slate-500')}>
                    {largo} de {MAXIMO_DE_UN_MENSAJE} caracteres
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <DialogoNuevaConversacion abierto={nuevaAbierta} alCerrar={() => setNuevaAbierta(false)} alElegir={(clave) => void abrirCon(clave)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// A quién escribirle
// ---------------------------------------------------------------------------

function DialogoNuevaConversacion({
  abierto,
  alCerrar,
  alElegir,
}: {
  abierto: boolean
  alCerrar: () => void
  alElegir: (clave: string) => void
}) {
  const [contactos, setContactos] = useState<ContactoDeMensajeria[] | null>(null)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    if (!abierto) return
    void window.dm.mensajes.contactos().then((respuesta) => {
      if (respuesta.ok) setContactos(respuesta.datos)
    })
  }, [abierto])

  const visibles = (contactos ?? []).filter((contacto) => {
    const aguja = busqueda.trim().toLowerCase()
    if (!aguja) return true
    return (
      contacto.nombre.toLowerCase().includes(aguja) ||
      contacto.usuario.toLowerCase().includes(aguja) ||
      (contacto.sucursal ?? '').toLowerCase().includes(aguja)
    )
  })

  return (
    <Dialogo abierto={abierto} titulo="Escribirle a alguien" descripcion="Los usuarios activos de la agencia." alCerrar={alCerrar}>
      <div className="flex flex-col gap-3">
        <Campo etiqueta="Buscar" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Nombre, usuario o sucursal" />
        {contactos === null ? (
          <Cargando texto="Buscando a la gente de la agencia…" />
        ) : visibles.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No hay nadie con ese nombre.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {visibles.map((contacto) => (
              <li key={contacto.clave}>
                <button
                  type="button"
                  onClick={() => alElegir(contacto.clave)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <span className="text-slate-400">
                    <Icono nombre="usuario" tamano={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{contacto.nombre}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {contacto.usuario}
                      {contacto.sucursal ? ` · ${contacto.sucursal}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialogo>
  )
}
