// Las llamadas de voz (14.0), del lado de la ventana: el audio de verdad.
//
// El reparto con el proceso principal es el mismo del zumbido y hay que tenerlo claro para no buscar
// las cosas donde no están:
//   - **QUÉ pasa** lo decide el proceso principal (`main/vivo/llamadas.ts`): quién llama a quién, si
//     está ocupado, cuándo se corta por falta de respuesta, qué sale por el canal. Es el único que
//     habla con el servidor; el renderer nunca abre sockets (ver la CSP en `vite.config.mts`).
//   - **SONAR** lo hace esto. Acá vive la `RTCPeerConnection`, el micrófono y el `<audio>` que
//     reproduce la voz de la otra punta. El audio NO pasa por el VPS: va punto a punto, con el coturn
//     del servidor de muleta cuando el router de una sucursal no deja pasar la conexión directa.
//
// UN SOLO PROVEEDOR, montado en `App.tsx`: hay una sola llamada por computadora (el teléfono de la
// agencia tampoco atiende dos juntas), la miran tres pantallas distintas —el aviso de la llamada que
// entra, la barra de arriba mientras dura y el botón «Llamar» de Mensajes— y la `RTCPeerConnection`
// tiene que sobrevivir a que se cambie de módulo en el medio de la charla. Si viviera en la pantalla
// de Mensajes, salir a Cartera cortaría la llamada.
//
// CÓMO SE ARMA LA CONEXIÓN (y por qué en ese orden):
//   1. El micrófono se pide recién cuando la llamada se ATENDIÓ, de los dos lados. Pedirlo al invitar
//      dejaría el foquito de grabación encendido durante un timbre que nadie contesta.
//   2. El que llamó manda la OFERTA; el que atendió contesta con la RESPUESTA. El rol no se negocia:
//      lo dice `saliente`, que viene del proceso principal, así que no hay dos ofertas cruzadas.
//   3. Los candidatos de red aparecen durante varios segundos DESPUÉS de la oferta y llegan mezclados
//      con ella. Los que llegan antes de tiempo se guardan y se aplican cuando hay dónde: WebRTC no
//      acepta un candidato antes de la descripción remota, y perderlos es una llamada muda.
//
// SI EL MICRÓFONO NO ESTÁ (negado en Windows, la ficha desenchufada, la computadora sin placa) la
// llamada se corta en el acto y queda dicho en la barra: una llamada donde uno de los dos no puede
// hablar es peor que ninguna, porque el otro se queda repitiendo «¿me escuchás?».
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  EstadoDeLlamada,
  MotivoDeCorteDeLlamada,
  SenalDeLlamada,
  SituacionDeLlamada,
} from '../../shared/tipos'
import { reproducir } from '../sonidos'

// El cronómetro y el cartel del corte viven en `componentes/llamada-reglas.ts`, sin nada del navegador
// adentro, para que el banco de pruebas pueda afirmarlos. Se reexporta desde acá porque es donde lo
// busca la barra de la llamada.
export { duracionLegible } from '../componentes/llamada-reglas'

interface ContextoLlamada {
  situacion: SituacionDeLlamada
  /** Con quién se está hablando, o quién está llamando. Null cuando no hay ninguna. */
  con: { clave: string; nombre: string } | null
  /** El id REMOTO de la conversación, para poder abrirla al atender. */
  conversacionId: string | null
  /** Segundos hablando. 0 mientras suena: el cronómetro arranca cuando se atiende. */
  duracion: number
  /** true si esta computadora tiene el micrófono apagado. La otra punta no se entera. */
  silenciada: boolean
  /** Por qué se cortó la última. */
  motivo: MotivoDeCorteDeLlamada | null
  /** true si hay algo en curso —llamando, timbrando o hablando—: no se puede empezar otra. */
  ocupada: boolean
  /** Lo que salió mal con el micrófono de ESTA computadora, para decirlo en la barra. */
  fallaDeAudio: string | null
  /** Llama a la otra persona de una directa. Devuelve el error para mostrar, o null si salió. */
  invitar: (conversacionId: number) => Promise<string | null>
  aceptar: () => void
  rechazar: () => void
  colgar: () => void
  silenciar: (silenciar: boolean) => void
  /** Cierra el cartel de la falla del micrófono. */
  olvidarLaFalla: () => void
}

const LIBRE: EstadoDeLlamada = {
  situacion: 'libre',
  llamadaId: null,
  conversacionId: null,
  con: null,
  saliente: false,
  desde: null,
  hablandoDesde: null,
  motivo: null,
}

/**
 * Lo que se ve sin proveedor arriba: nunca hay ninguna llamada y las acciones no hacen nada.
 *
 * No tira error (a diferencia de `usePermisos`) por lo mismo que `Conexion` y `Presencia`: el botón
 * «Llamar» vive en Mensajes, y el banco de pruebas monta pantallas sueltas sin el marco del escritorio.
 */
const SIN_LLAMADA: ContextoLlamada = {
  situacion: 'libre',
  con: null,
  conversacionId: null,
  duracion: 0,
  silenciada: false,
  motivo: null,
  ocupada: false,
  fallaDeAudio: null,
  invitar: async () => 'No hay teléfono en esta pantalla.',
  aceptar: () => {},
  rechazar: () => {},
  colgar: () => {},
  silenciar: () => {},
  olvidarLaFalla: () => {},
}

const Contexto = createContext<ContextoLlamada>(SIN_LLAMADA)

/** Lo que está armado en esta computadora para UNA llamada. Se tira entero al cortar. */
interface SesionDeAudio {
  llamadaId: string
  pc: RTCPeerConnection
  /** El micrófono. Se apaga track por track al silenciar y se suelta al colgar. */
  local: MediaStream
}

export function ProveedorLlamada({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDeLlamada>(LIBRE)
  const [silenciada, setSilenciada] = useState(false)
  const [duracion, setDuracion] = useState(0)
  const [fallaDeAudio, setFallaDeAudio] = useState<string | null>(null)

  // Todo lo de WebRTC va en refs y no en estado: cambiar de candidato no redibuja nada, y con estado
  // cada uno de los treinta candidatos de una llamada re-renderizaría el escritorio entero.
  const sesion = useRef<SesionDeAudio | null>(null)
  /** Lo que llegó antes de que hubiera dónde aplicarlo. Ver el punto 3 del comentario de arriba. */
  const guardadas = useRef<SenalDeLlamada[]>([])
  /**
   * Las señales se aplican DE A UNA. Casi todo lo de `RTCPeerConnection` es asincrónico y dos señales
   * pisándose (la respuesta y un candidato) dejan la conexión en un estado que no se puede arreglar.
   */
  const turno = useRef<Promise<void>>(Promise.resolve())
  /** El `<audio>` que hace sonar la voz de la otra punta. */
  const parlante = useRef<HTMLAudioElement | null>(null)
  /** El estado y el silencio de ahora mismo, para lo que corre adentro de una promesa. */
  const estadoAhora = useRef<EstadoDeLlamada>(LIBRE)
  estadoAhora.current = estado
  const silenciadaAhora = useRef(false)
  silenciadaAhora.current = silenciada

  // --- El audio -------------------------------------------------------------

  const cerrarElAudio = useCallback(() => {
    const abierta = sesion.current
    sesion.current = null
    guardadas.current = []
    if (!abierta) return
    // El orden importa poco, pero soltar el micrófono sí: sin `stop()` el foquito de grabación de
    // Windows queda encendido después de colgar y la persona cree que la siguen escuchando.
    try {
      abierta.pc.onicecandidate = null
      abierta.pc.ontrack = null
      abierta.pc.onconnectionstatechange = null
      abierta.pc.close()
    } catch {
      /* cerrar dos veces no es un problema que valga la pena contarle a nadie */
    }
    for (const pista of abierta.local.getTracks()) {
      try {
        pista.stop()
      } catch {
        /* ídem */
      }
    }
    if (parlante.current) parlante.current.srcObject = null
  }, [])

  /**
   * Los servidores de STUN y TURN, tal como los mandó el servidor en el saludo del canal.
   *
   * Sin ellos la llamada se intenta igual, sólo con las direcciones de la propia red: entre dos
   * computadoras de la misma sucursal alcanza, y es mejor que negarse a llamar por algo que el
   * servidor todavía no contestó.
   */
  const servidoresDeIce = useCallback(async (): Promise<RTCIceServer[]> => {
    const respuesta = await window.dm.llamadas.ice()
    if (!respuesta.ok || !respuesta.datos) return []
    const servidores: RTCIceServer[] = []
    if (respuesta.datos.stun.length > 0) servidores.push({ urls: respuesta.datos.stun })
    const turn = respuesta.datos.turn
    if (turn && turn.urls.length > 0) {
      servidores.push({ urls: turn.urls, username: turn.username, credential: turn.credential })
    }
    return servidores
  }, [])

  /** Aplica una señal de la otra punta. Corre con el turno tomado: nunca dos a la vez. */
  const aplicar = useCallback(async (senal: SenalDeLlamada): Promise<void> => {
    const abierta = sesion.current
    // Todavía no hay conexión armada (o la señal es de una llamada anterior): se guarda o se descarta.
    if (!abierta || abierta.llamadaId !== senal.llamadaId) {
      if (senal.llamadaId === estadoAhora.current.llamadaId) guardadas.current.push(senal)
      return
    }

    if (senal.tipo === 'ice') {
      // Un candidato antes de la descripción remota lanza: se guarda para cuando llegue la oferta.
      if (!abierta.pc.remoteDescription) {
        guardadas.current.push(senal)
        return
      }
      await abierta.pc.addIceCandidate(senal.candidato)
      return
    }

    await abierta.pc.setRemoteDescription(senal.sdp)
    if (senal.sdp.type === 'offer') {
      // El que atendió: contesta con la respuesta. El micrófono ya está agregado desde `armarElAudio`,
      // así que la respuesta sale con audio en los dos sentidos.
      const respuesta = await abierta.pc.createAnswer()
      await abierta.pc.setLocalDescription(respuesta)
      void window.dm.llamadas.senal(abierta.llamadaId, {
        sdp: { type: respuesta.type, sdp: respuesta.sdp },
      })
    }

    // Ya hay descripción remota: los candidatos que estaban esperando por eso se pueden aplicar. Se
    // sacan de la lista de a uno y no se vuelve a llamar a esta función para no anidar promesas: el
    // turno ya está tomado por esta señal.
    const esperando: Array<Extract<SenalDeLlamada, { tipo: 'ice' }>> = []
    const resto: SenalDeLlamada[] = []
    for (const guardada of guardadas.current) {
      if (guardada.tipo === 'ice' && guardada.llamadaId === abierta.llamadaId) esperando.push(guardada)
      else resto.push(guardada)
    }
    guardadas.current = resto
    for (const candidato of esperando) {
      try {
        await abierta.pc.addIceCandidate(candidato.candidato)
      } catch (error) {
        // Un camino de red que ya no existe: la llamada sigue por los otros.
        console.error('[llamada] Un candidato guardado no se pudo aplicar:', error)
      }
    }
  }, [])

  const encolar = useCallback(
    (senal: SenalDeLlamada) => {
      turno.current = turno.current.then(() => aplicar(senal)).catch((error) => {
        // Una señal que no se pudo aplicar no corta la llamada: puede ser un candidato de un camino de
        // red que no existe. Si lo que falló fue la oferta, la llamada se queda muda y se cuelga a mano,
        // que es lo mismo que hace cualquier teléfono cuando no se escucha.
        console.error('[llamada] No se pudo aplicar una señal:', error)
      })
    },
    [aplicar],
  )

  /** Prende el micrófono y arma la conexión. Se llama una sola vez por llamada, al atenderse. */
  const armarElAudio = useCallback(
    async (llamadaId: string, saliente: boolean): Promise<void> => {
      let local: MediaStream
      try {
        // Sólo audio, a propósito: la agencia habla por teléfono, no hace videollamadas, y el permiso
        // del proceso principal (`blindarLosPermisos` en `main/index.ts`) niega cualquier pedido que
        // traiga video.
        local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      } catch (error) {
        setFallaDeAudio(
          `No se pudo usar el micrófono de esta computadora (${error instanceof Error ? error.message : String(error)}). ` +
            'Revisá que esté enchufado y que Windows le deje usarlo al programa.',
        )
        void window.dm.llamadas.colgar()
        return
      }

      const servidores = await servidoresDeIce()

      // Pudo cortarse mientras Windows preguntaba por el micrófono: se suelta y no se arma nada. La
      // comprobación va acá, DESPUÉS de las dos esperas y pegada a la línea que guarda la sesión: si
      // quedara antes, una conexión creada en el medio no la cerraría nadie y el micrófono se quedaría
      // prendido para siempre.
      if (estadoAhora.current.llamadaId !== llamadaId || estadoAhora.current.situacion !== 'en-llamada') {
        for (const pista of local.getTracks()) pista.stop()
        return
      }

      const pc = new RTCPeerConnection({ iceServers: servidores })
      sesion.current = { llamadaId, pc, local }

      for (const pista of local.getAudioTracks()) {
        // Si se apretó «Silenciar» mientras se pedía el micrófono, nace apagado.
        pista.enabled = !silenciadaAhora.current
        pc.addTrack(pista, local)
      }

      pc.onicecandidate = (evento) => {
        if (!evento.candidate) return
        void window.dm.llamadas.senal(llamadaId, { ice: evento.candidate.toJSON() })
      }

      // El vigía de la conexión de verdad (14.0). La señalización puede haber terminado perfecta y el
      // audio no llegar a ningún lado: el router de una sucursal que no deja pasar nada, el TURN
      // vencido, la otra computadora apagada de un tirón. `failed` es el estado del que WebRTC ya NO
      // vuelve solo, así que quedarse ahí es dejar a la persona hablándole a un silencio con el
      // cronómetro corriendo. `disconnected` no se toca a propósito: es el parpadeo de wifi de todos
      // los días y se arregla solo en unos segundos.
      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== 'failed') return
        setFallaDeAudio('Se perdió la conexión de audio con la otra computadora y la llamada se cortó.')
        void window.dm.llamadas.colgar()
      }

      pc.ontrack = (evento) => {
        const remoto = evento.streams[0]
        if (!remoto || !parlante.current) return
        parlante.current.srcObject = remoto
        // `autoPlay` alcanza casi siempre; el `play()` es para cuando Chromium todavía no vio un clic
        // en la ventana. Si lo rechaza, la voz aparece en cuanto la persona toca cualquier cosa.
        const promesa = parlante.current.play()
        if (promesa && typeof promesa.catch === 'function') promesa.catch(() => undefined)
      }

      if (saliente) {
        const oferta = await pc.createOffer()
        await pc.setLocalDescription(oferta)
        void window.dm.llamadas.senal(llamadaId, { sdp: { type: oferta.type, sdp: oferta.sdp } })
      }

      // Lo que llegó mientras se pedía el micrófono (la oferta de la otra punta, sus candidatos).
      const esperando = guardadas.current
      guardadas.current = []
      for (const guardada of esperando) encolar(guardada)
    },
    [encolar, servidoresDeIce],
  )

  // --- Lo que dice el proceso principal -------------------------------------

  useEffect(() => {
    let vigente = true
    // Si ya llegó un aviso, la respuesta de la consulta inicial es más vieja que lo que se sabe: se
    // descarta. Sin esto, atender en el primer segundo de vida de la pantalla podía volver a «libre».
    const yaLlegoAlgo = { valor: false }
    void window.dm.llamadas.estado().then((respuesta) => {
      if (vigente && !yaLlegoAlgo.valor && respuesta.ok) setEstado(respuesta.datos)
    })
    const dejarDeEscuchar = window.dm.llamadas.alPasarAlgo(({ estado: nuevo, senal }) => {
      if (!vigente) return
      yaLlegoAlgo.valor = true
      estadoAhora.current = nuevo
      setEstado(nuevo)
      // La señal viaja en el mismo aviso que el estado justamente para esto: primero se sabe que la
      // llamada existe y sólo después se aplica su oferta.
      if (senal) encolar(senal)
    })
    return () => {
      vigente = false
      dejarDeEscuchar()
    }
  }, [encolar])

  // Al desmontarse (cierre de sesión, recarga de la ventana) se suelta el micrófono.
  useEffect(() => cerrarElAudio, [cerrarElAudio])

  const situacion = estado.situacion
  const llamadaId = estado.llamadaId
  const saliente = estado.saliente

  useEffect(() => {
    if (situacion !== 'en-llamada' || !llamadaId) {
      cerrarElAudio()
      return
    }
    if (sesion.current?.llamadaId === llamadaId) return
    void armarElAudio(llamadaId, saliente).catch((error) => {
      // Casi siempre es la carrera de colgar mientras se armaba (la oferta sobre una conexión que ya
      // se cerró): ahí `colgar` no hace nada porque la llamada ya no existe. Si fue otra cosa, la
      // llamada quedaría muda y es mejor cortarla que dejar a los dos diciendo «hola».
      console.error('[llamada] No se pudo armar el audio:', error)
      void window.dm.llamadas.colgar()
    })
  }, [situacion, llamadaId, saliente, armarElAudio, cerrarElAudio])

  // El silencio y el cronómetro son de cada llamada: la siguiente arranca hablando y en cero.
  useEffect(() => {
    if (situacion !== 'libre') return
    setSilenciada(false)
    setDuracion(0)
  }, [situacion])

  // El «clac» del tubo. Suena cuando se termina algo que estaba en curso de este lado —hablando o
  // llamando—, no cuando se rechaza lo que entraba: ahí el silencio del timbre ya lo dice todo.
  const situacionAnterior = useRef<SituacionDeLlamada>('libre')
  useEffect(() => {
    const antes = situacionAnterior.current
    situacionAnterior.current = situacion
    if (situacion === 'libre' && (antes === 'en-llamada' || antes === 'llamando')) reproducir('colgar')
  }, [situacion])

  // El cronómetro de la barra. Un intervalo de un segundo y no un contador propio: si la ventana se
  // queda dormida (la computadora suspendida), la cuenta se corrige sola porque se calcula de la hora
  // en que se atendió, que la dice el proceso principal.
  const hablandoDesde = estado.hablandoDesde
  useEffect(() => {
    if (situacion !== 'en-llamada' || !hablandoDesde) {
      setDuracion(0)
      return
    }
    const arranque = new Date(hablandoDesde).getTime()
    const poner = () => setDuracion(Math.max(0, Math.floor((Date.now() - arranque) / 1000)))
    poner()
    const reloj = setInterval(poner, 1000)
    return () => clearInterval(reloj)
  }, [situacion, hablandoDesde])

  // --- Las acciones ---------------------------------------------------------

  const invitar = useCallback(async (conversacionId: number): Promise<string | null> => {
    setFallaDeAudio(null)
    const respuesta = await window.dm.llamadas.invitar(conversacionId)
    if (!respuesta.ok) return respuesta.error
    setEstado(respuesta.datos)
    return null
  }, [])

  const aceptar = useCallback(() => {
    setFallaDeAudio(null)
    void window.dm.llamadas.aceptar().then((respuesta) => {
      if (respuesta.ok) setEstado(respuesta.datos)
    })
  }, [])

  const rechazar = useCallback(() => {
    void window.dm.llamadas.rechazar().then((respuesta) => {
      if (respuesta.ok) setEstado(respuesta.datos)
    })
  }, [])

  const colgar = useCallback(() => {
    void window.dm.llamadas.colgar().then((respuesta) => {
      if (respuesta.ok) setEstado(respuesta.datos)
    })
  }, [])

  const silenciar = useCallback((apagar: boolean) => {
    setSilenciada(apagar)
    // `enabled = false` deja la conexión en pie y manda silencio: es lo que hace el botón de mute de
    // cualquier teléfono. Sacar la pista obligaría a renegociar la llamada entera.
    for (const pista of sesion.current?.local.getAudioTracks() ?? []) pista.enabled = !apagar
  }, [])

  const olvidarLaFalla = useCallback(() => setFallaDeAudio(null), [])

  const valor = useMemo<ContextoLlamada>(
    () => ({
      situacion,
      con: estado.con,
      conversacionId: estado.conversacionId,
      duracion,
      silenciada,
      motivo: estado.motivo,
      ocupada: situacion !== 'libre',
      fallaDeAudio,
      invitar,
      aceptar,
      rechazar,
      colgar,
      silenciar,
      olvidarLaFalla,
    }),
    [
      situacion,
      estado.con,
      estado.conversacionId,
      estado.motivo,
      duracion,
      silenciada,
      fallaDeAudio,
      invitar,
      aceptar,
      rechazar,
      colgar,
      silenciar,
      olvidarLaFalla,
    ],
  )

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/* La voz de la otra punta. Vive acá y no en la barra de la llamada porque la barra se desmonta
          al cambiar de módulo si algún día se la mueve de lugar, y un `<audio>` desmontado es una
          llamada que se queda muda. Sin controles y sin `muted`: lo único que hace es sonar. */}
      <audio ref={parlante} autoPlay className="hidden" />
    </Contexto.Provider>
  )
}

export function useLlamada(): ContextoLlamada {
  return useContext(Contexto)
}

