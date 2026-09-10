// Las llamadas de voz de la agencia (14.0): la máquina de estados de ESTA computadora.
//
// El servidor sólo REENVÍA la señalización (invitar, timbrar, aceptar, sdp, ice, colgar): el audio va
// derecho de una computadora a la otra por WebRTC, con el coturn del VPS como muleta cuando el router
// de una sucursal no deja pasar la conexión directa. Por eso `ConfiguracionIce` viaja en el saludo: es
// lo único que la computadora no puede saber sola.
//
// Y por eso esto vive en el proceso principal aunque el audio lo maneje el renderer: el canal es uno
// solo y es de acá; el renderer nunca abre sockets (ver la CSP en `vite.config.mts`). Acá se decide
// QUÉ pasa —quién llama a quién, cuándo se corta, por qué—; allá se hace SONAR.
//
// Una sola llamada por computadora:
//
//   libre → llamando  → en-llamada → terminando → libre     (la que sale de acá)
//   libre → timbrando → en-llamada → terminando → libre     (la que entra)
//
// El teléfono de la agencia tampoco atiende dos juntas, y una segunda mientras se está hablando sería
// un audio encima del otro. Invitar con otra en curso es un error de negocio, no una cola de espera.
//
// LO QUE PASA SI SE CAE EL CANAL EN EL MEDIO DE UNA LLAMADA: el audio NO se corta. Va punto a punto,
// así que no depende del VPS; lo único que se pierde es la señalización, que a esa altura ya hizo su
// trabajo. Se aguantan quince segundos —lo que tarda una reconexión normal— y recién si no vuelve se
// corta con motivo `desconexion`. Cortar en el acto sería tirar abajo una conversación que se sigue
// escuchando perfecto por un parpadeo del wifi.
import { randomUUID } from 'node:crypto'
import type { EstadoDeLlamada, SenalDeLlamada, SenalParaMandar, SesionUsuario } from '../../shared/tipos'
import { emitirATodas, llamarLaAtencion, notificarEnElSistema } from '../servicios/avisos'
import { ErrorDeNegocio } from '../servicios/errores'
import { directaParaLlamar } from '../servicios/mensajeria'
import { mandarPorElCanal } from './emisor'
import { TIMBRE_MS, type ConfiguracionIce, type EventoDeLlamada, type MotivoDeCorte } from './protocolo'

/**
 * Cuánto se aguanta una llamada con el canal caído antes de darla por cortada. Quince segundos es más
 * de lo que tarda una reconexión normal (el canal vuelve con espera creciente desde un segundo) y menos
 * de lo que una persona se queda hablándole a alguien que ya no está.
 */
export const ESPERA_DE_RECONEXION_MS = 15_000

interface LlamadaEnCurso {
  id: string
  /** El id REMOTO de la conversación: el que conocen las cinco computadoras y el servidor. */
  conversacionId: string
  con: { clave: string; nombre: string }
  /** true si la invitación salió de acá: es quien manda la oferta SDP. */
  saliente: boolean
  situacion: 'llamando' | 'timbrando' | 'en-llamada'
  desde: string
  hablandoDesde: string | null
}

let actual: LlamadaEnCurso | null = null
/** Por qué se cortó la última. Es lo que muestra el cartel cuando la llamada se cierra sola. */
let ultimoMotivo: MotivoDeCorte | null = null
let ultimoEvento: EventoDeLlamada | null = null
let ice: ConfiguracionIce | null = null
/** El corte por falta de respuesta, de los dos lados: el que llama y el que suena. */
let relojDelTimbre: ReturnType<typeof setTimeout> | null = null
/** El aguante de los quince segundos cuando el canal se cae con la llamada abierta. */
let relojDeReconexion: ReturnType<typeof setTimeout> | null = null

// ---------------------------------------------------------------------------
// Lo que se muestra
// ---------------------------------------------------------------------------

export function estadoDeLaLlamada(): EstadoDeLlamada {
  if (!actual) {
    return {
      situacion: 'libre',
      llamadaId: null,
      conversacionId: null,
      con: null,
      saliente: false,
      desde: null,
      hablandoDesde: null,
      motivo: ultimoMotivo,
    }
  }
  return {
    situacion: actual.situacion,
    llamadaId: actual.id,
    conversacionId: actual.conversacionId,
    con: { ...actual.con },
    saliente: actual.saliente,
    desde: actual.desde,
    hablandoDesde: actual.hablandoDesde,
    motivo: null,
  }
}

/**
 * Le avisa a la pantalla, con el estado adentro y —cuando corresponde— la señal que acaba de llegar.
 *
 * La señal va en el mismo aviso y no por un canal aparte a propósito: el orden importa. La oferta SDP
 * de la otra punta no se puede aplicar antes de saber que la llamada existe, y con dos avisos sueltos
 * ese orden dependería de cómo se despachen los eventos de Electron.
 */
function avisar(senal: SenalDeLlamada | null = null): void {
  emitirATodas('llamadas:evento', { estado: estadoDeLaLlamada(), senal })
}

// ---------------------------------------------------------------------------
// Los relojes
// ---------------------------------------------------------------------------

function pararElTimbre(): void {
  if (relojDelTimbre) clearTimeout(relojDelTimbre)
  relojDelTimbre = null
}

function pararLaEspera(): void {
  if (relojDeReconexion) clearTimeout(relojDeReconexion)
  relojDeReconexion = null
}

function arrancarElTimbre(llamadaId: string): void {
  pararElTimbre()
  relojDelTimbre = setTimeout(() => {
    relojDelTimbre = null
    if (!actual || actual.id !== llamadaId || actual.situacion === 'en-llamada') return
    // Nadie atendió. Se avisa del lado del que corta —el que llama cancela, el que suena rechaza— y el
    // servidor deja el «Llamada perdida» en la conversación.
    cortar('sin-respuesta', true)
  }, TIMBRE_MS)
  relojDelTimbre.unref?.()
}

// ---------------------------------------------------------------------------
// Cortar
// ---------------------------------------------------------------------------

/**
 * Termina la llamada que haya. `avisarAlOtro` manda el frame de corte; va en false cuando el que cortó
 * fue el otro (ya lo sabe) o cuando no hay canal por el que decírselo.
 */
function cortar(motivo: MotivoDeCorte, avisarAlOtro: boolean): void {
  const llamada = actual
  pararElTimbre()
  pararLaEspera()
  if (!llamada) return
  actual = null
  ultimoMotivo = motivo
  if (avisarAlOtro) {
    // El que todavía no atendió RECHAZA y el que estaba hablando CUELGA. Para el servidor es lo mismo
    // (los dos cierran la llamada), pero el registro cuenta dos cosas distintas.
    const tipo = llamada.situacion === 'timbrando' ? 'rechazar' : 'colgar'
    mandarPorElCanal({ t: 'llamada', evento: { tipo, llamadaId: llamada.id, motivo } })
  }
  avisar()
}

// ---------------------------------------------------------------------------
// Lo que hace esta computadora
// ---------------------------------------------------------------------------

/**
 * Llama a la otra persona de una conversación de a dos.
 *
 * Devuelve el estado con la llamada ya en «llamando»: el timbre del otro lado lo hace el servidor, que
 * es quien sabe si esa persona tiene alguna computadora conectada (si no la tiene, contesta al instante
 * con `sin-respuesta` y la llamada se cierra sola).
 */
export function invitarALlamar(actor: SesionUsuario, conversacionId: unknown): EstadoDeLlamada {
  if (actual) {
    throw new ErrorDeNegocio(
      actual.situacion === 'timbrando'
        ? 'Hay una llamada entrando: atendela o rechazala antes de llamar.'
        : 'Ya hay una llamada en curso en esta computadora.',
    )
  }
  const { remotoId, con } = directaParaLlamar(actor, conversacionId)

  const llamada: LlamadaEnCurso = {
    id: randomUUID(),
    conversacionId: remotoId,
    con,
    saliente: true,
    situacion: 'llamando',
    desde: new Date().toISOString(),
    hablandoDesde: null,
  }
  const salio = mandarPorElCanal({
    t: 'llamada',
    evento: { tipo: 'invitar', llamadaId: llamada.id, para: con.clave, conversacionId: remotoId },
  })
  if (!salio) {
    // No queda nada colgado: la llamada no llegó a existir para nadie más. El candado de la conexión ya
    // lo puso `exigirEdicion`; esto es la carrera de que el canal se caiga justo en el medio.
    throw new ErrorDeNegocio('Se cortó la conexión con la base de la agencia: la llamada no salió.')
  }

  actual = llamada
  ultimoMotivo = null
  arrancarElTimbre(llamada.id)
  avisar()
  return estadoDeLaLlamada()
}

/** Atiende la llamada que está sonando. */
export function aceptarLlamada(): EstadoDeLlamada {
  if (!actual || actual.situacion !== 'timbrando') throw new ErrorDeNegocio('No hay ninguna llamada sonando.')
  pararElTimbre()
  mandarPorElCanal({ t: 'llamada', evento: { tipo: 'aceptar', llamadaId: actual.id } })
  actual.situacion = 'en-llamada'
  actual.hablandoDesde = new Date().toISOString()
  avisar()
  return estadoDeLaLlamada()
}

/** «Ahora no puedo»: la llamada que suena se corta y del otro lado queda el «Llamada perdida». */
export function rechazarLlamada(): EstadoDeLlamada {
  if (!actual || actual.situacion !== 'timbrando') throw new ErrorDeNegocio('No hay ninguna llamada sonando.')
  cortar('rechazada', true)
  return estadoDeLaLlamada()
}

/** Corta: la que se está hablando y también la que todavía está llamando (ahí es «cancelada»). */
export function colgarLlamada(): EstadoDeLlamada {
  if (!actual) return estadoDeLaLlamada()
  cortar(actual.situacion === 'en-llamada' ? 'terminada' : 'cancelada', true)
  return estadoDeLaLlamada()
}

/**
 * Le pasa a la otra punta lo que produjo la `RTCPeerConnection` del renderer: la oferta o la respuesta
 * SDP, y cada candidato de red.
 *
 * Se controla el `llamadaId` porque los candidatos siguen apareciendo un rato después de que la llamada
 * se cerró (así funciona WebRTC): sin esto, los de la llamada anterior se le meterían a la siguiente.
 */
export function mandarSenalDeLlamada(llamadaId: unknown, senal: SenalParaMandar): void {
  if (!actual || typeof llamadaId !== 'string' || llamadaId !== actual.id) return
  if ('sdp' in senal && senal.sdp) {
    mandarPorElCanal({ t: 'llamada', evento: { tipo: 'sdp', llamadaId: actual.id, sdp: senal.sdp } })
    return
  }
  if ('ice' in senal && senal.ice) {
    mandarPorElCanal({ t: 'llamada', evento: { tipo: 'ice', llamadaId: actual.id, candidato: senal.ice } })
  }
}

// ---------------------------------------------------------------------------
// Lo que llega por el canal
// ---------------------------------------------------------------------------

/** Llegó `{t:'llamada'}`. */
export function recibirEventoDeLlamada(evento: EventoDeLlamada): void {
  ultimoEvento = evento

  switch (evento.tipo) {
    case 'timbrar':
      atender(evento)
      return
    case 'aceptar':
      if (!actual || actual.id !== evento.llamadaId || actual.situacion !== 'llamando') return
      pararElTimbre()
      actual.situacion = 'en-llamada'
      actual.hablandoDesde = new Date().toISOString()
      avisar()
      return
    case 'rechazar':
    case 'colgar':
      // Cortó el otro (o el servidor por él: `ocupado` cuando ya estaba hablando, `sin-respuesta`
      // cuando no tiene ninguna computadora conectada). No hay a quién avisarle.
      if (!actual || actual.id !== evento.llamadaId) return
      cortar(evento.motivo ?? 'terminada', false)
      return
    case 'sdp':
    case 'ice':
      // La señalización no se toca acá: se la pasa entera al renderer, que es el dueño de la
      // `RTCPeerConnection`. Este proceso no sabe nada de SDP y no tiene por qué aprender.
      if (!actual || actual.id !== evento.llamadaId) return
      avisar(evento)
      return
    case 'invitar':
      // El servidor no reenvía la invitación tal cual: la convierte en `timbrar` para el destinatario.
      return
  }
}

/** Entra una llamada. */
function atender(evento: Extract<EventoDeLlamada, { tipo: 'timbrar' }>): void {
  if (actual) {
    // Ocupado: se rechaza al instante y sin tocar la llamada que ya está. El servidor lo cuenta como
    // `ocupado`, que es lo que hace que del otro lado se escuche el tono corto en vez del timbre.
    mandarPorElCanal({ t: 'llamada', evento: { tipo: 'rechazar', llamadaId: evento.llamadaId, motivo: 'ocupado' } })
    return
  }

  actual = {
    id: evento.llamadaId,
    conversacionId: evento.conversacionId,
    con: { clave: evento.de.clave, nombre: evento.de.nombre },
    saliente: false,
    situacion: 'timbrando',
    desde: new Date().toISOString(),
    hablandoDesde: null,
  }
  ultimoMotivo = null
  arrancarElTimbre(evento.llamadaId)

  // El mismo aviso que el zumbido, y por el mismo motivo: puede estar la ventana detrás de otra o el
  // programa minimizado, y una llamada que suena treinta segundos y nadie ve es una llamada perdida.
  // El tono lo hace el renderer (`tono-llamada.mp3` en bucle), como todos los sonidos del programa.
  notificarEnElSistema(evento.de.nombre, 'Te está llamando.')
  llamarLaAtencion()
  avisar()
}

/** Lo último que pasó por el canal, tal cual. Sirve para la bitácora y para el humo. */
export function ultimoEventoDeLlamada(): EventoDeLlamada | null {
  return ultimoEvento
}

// ---------------------------------------------------------------------------
// El canal se cae y vuelve
// ---------------------------------------------------------------------------

/**
 * Se cortó el canal. Lo llama `canal.ts` en cada cierre del socket.
 *
 * Si la llamada ya está hablándose, el audio SIGUE: va punto a punto y no pasa por el VPS. Se esperan
 * quince segundos a que la señalización vuelva y recién ahí se corta. Si todavía estaba sonando, en
 * cambio, no hay nada que esperar: sin canal no puede llegar el «atendí» ni la oferta SDP, así que la
 * llamada no va a existir nunca.
 */
export function elCanalSeCorto(): void {
  if (!actual) return
  if (actual.situacion !== 'en-llamada') {
    cortar('desconexion', false)
    return
  }
  if (relojDeReconexion) return
  relojDeReconexion = setTimeout(() => {
    relojDeReconexion = null
    if (actual?.situacion === 'en-llamada') cortar('desconexion', false)
  }, ESPERA_DE_RECONEXION_MS)
  relojDeReconexion.unref?.()
}

/**
 * Volvió el canal. Si había una llamada esperando, se corta: NO sobrevive a la reconexión.
 *
 * Parece al revés de lo que dice el aguante de los quince segundos, y no lo es. Lo que aguanta esos
 * quince segundos es el AUDIO, que va punto a punto; la llamada, en cambio, vive pegada a la conexión
 * del servidor: cuando el socket se cierra, el hub la cierra, libera el «ocupado» y le manda
 * `colgar {desconexion}` a la otra punta, que ahí mismo tira abajo su `RTCPeerConnection`. La
 * reconexión trae un `conexionId` nuevo y el saludo no dice una palabra de llamadas (ver `bienvenida`
 * en `protocolo.ts`), así que no hay nada que retomar: del otro lado ya no hay nadie.
 *
 * Cancelar el corte acá dejaba a esta computadora sola, creyendo que hablaba: la barra verde con el
 * cronómetro corriendo, sin voz de nadie, sin poder llamar (`ocupada`) y rechazando por «ocupado» todo
 * lo que entrara, hasta que la persona se diera cuenta y apretara «Cortar» a mano.
 *
 * El aguante sigue sirviendo para lo que fue pensado: el parpadeo de wifi que se arregla ANTES de que
 * el servidor note el cierre no llega hasta acá, porque el socket nunca se cerró.
 */
export function elCanalVolvio(): void {
  const esperaba = relojDeReconexion !== null
  pararLaEspera()
  // `avisarAlOtro` en false: el otro ya lo sabe (se lo dijo el servidor) y ese `llamadaId` para el hub
  // nuevo no existe, así que el frame no llegaría a ningún lado.
  if (esperaba && actual) cortar('desconexion', false)
}

// ---------------------------------------------------------------------------
// El ICE del saludo
// ---------------------------------------------------------------------------

/**
 * La configuración de STUN/TURN que vino en el saludo. Se guarda tal cual: las credenciales del TURN
 * vencen (doce horas) y se renuevan solas en el saludo de la reconexión siguiente.
 */
export function recibirConfiguracionIce(configuracion: ConfiguracionIce): void {
  ice = configuracion
}

export function configuracionIce(): ConfiguracionIce | null {
  return ice
}

// ---------------------------------------------------------------------------
// Cerrar
// ---------------------------------------------------------------------------

/**
 * Cierre de sesión o del programa: se cuelga.
 *
 * Va ANTES de que el canal cierre el socket (lo llama `canal.parar()` en su primer renglón) porque el
 * «colgué» tiene que salir todavía: si no, del otro lado quedaría alguien hablándole a una computadora
 * que ya se apagó hasta que se cumplieran los quince segundos del aguante.
 */
export function colgarPorCierre(): void {
  if (!actual) return
  cortar(actual.situacion === 'en-llamada' ? 'terminada' : 'cancelada', true)
}

/** Al cerrar sesión o al perder el canal: sin canal no hay señalización, así que no hay llamada. */
export function olvidarLasLlamadas(): void {
  pararElTimbre()
  pararLaEspera()
  actual = null
  ultimoMotivo = null
  ultimoEvento = null
  ice = null
}
