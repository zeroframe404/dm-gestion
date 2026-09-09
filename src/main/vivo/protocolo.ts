// El protocolo del canal en vivo (14.0): lo que viaja por el WebSocket entre cada computadora y el
// VPS. Este archivo es una COPIA EXACTA de `server/src/modules/dmg/vivo/vivo.types.ts` del
// repositorio web (Seguros_Daniel_Martinez): los dos repos no comparten código, así que el contrato
// se mantiene a mano en los dos lados. Si se cambia acá, se cambia allá.
//
// Los frames son JSON con un discriminador corto `t`. Todo lo que el cliente manda es chico y poco
// frecuente (un foco por cambio de celda, un latido cada 20 s); lo que el servidor manda es una
// SEÑAL, no los datos: «la grilla cambió» (y el cliente compara versiones y baja lo distinto),
// «tenés mensajes» (y el cliente pide las novedades por HTTP como siempre). Los datos siguen viajando
// por los endpoints de siempre; el canal sólo reemplaza a los relojes y a los long-polls.

export type RolDelCanal = 'SUPER_ADMIN' | 'ADMIN' | 'EMPLEADO'

/** Quién está usando la computadora que se conecta. La identidad es la clave de usuario (login en minúscula). */
export interface ActorDelCanal {
  clave: string
  nombre: string
  rol: RolDelCanal
  sucursal: string
}

/** En qué está trabajando una persona. Es lo que se dibuja con el glow en las otras computadoras. */
export type Foco =
  | { tipo: 'celda'; pestana: string; filaId: string; campo: string; editando: boolean }
  | {
      tipo: 'objeto'
      objeto: 'cliente' | 'poliza' | 'siniestro' | 'tarea' | 'lead' | 'presupuesto' | 'fila'
      filaId: string
      editando: boolean
    }
  | { tipo: 'modulo'; modulo: string }

/** Una conexión viva, tal como la ven las demás. */
export interface Presente {
  conexionId: string
  clave: string
  nombre: string
  sucursal: string
  /** Índice 0-11 en la paleta (`src/shared/paleta.ts`). */
  color: number
  foco: Foco | null
  /** ISO: desde cuándo está conectada. */
  desde: string
}

/** La foto y el color de una persona. Es de la agencia entera, no de una computadora. */
export interface Perfil {
  clave: string
  /** Índice 0-11 en la paleta. Único por persona. */
  color: number
  /** `data:image/jpeg;base64,…` de 256 px (≤ 40 KB), o null si no cargó foto. */
  foto: string | null
  version: number
  actualizadoEn: string
}

export interface ReaccionRemota {
  emoji: string
  /** Las claves de quienes reaccionaron con este emoji. */
  claves: string[]
}

/** Lo que el cliente necesita para armar la RTCPeerConnection de una llamada. */
export interface ConfiguracionIce {
  stun: string[]
  turn: { urls: string[]; username: string; credential: string; venceEn: string } | null
}

export type MotivoDeCorte =
  | 'ocupado'
  | 'sin-respuesta'
  | 'cancelada'
  | 'desconexion'
  | 'rechazada'
  | 'terminada'

/** La señalización de una llamada de voz. El servidor sólo reenvía; el audio va por WebRTC. */
export type EventoDeLlamada =
  | { tipo: 'invitar'; llamadaId: string; para: string; conversacionId: string }
  | { tipo: 'timbrar'; llamadaId: string; de: { clave: string; nombre: string }; conversacionId: string }
  | { tipo: 'aceptar'; llamadaId: string }
  | { tipo: 'rechazar'; llamadaId: string; motivo?: MotivoDeCorte }
  | { tipo: 'colgar'; llamadaId: string; motivo?: MotivoDeCorte }
  | { tipo: 'sdp'; llamadaId: string; sdp: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string } }
  | {
      tipo: 'ice'
      llamadaId: string
      candidato: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null }
    }

/** Cliente → servidor. */
export type DelCliente =
  | {
      t: 'hola'
      /** El token del puente (DMG_SYNC_TOKEN). Va acá y no en la URL: la URL queda en los logs de nginx. */
      token: string
      actor: ActorDelCanal
      /** La versión del programa (package.json). */
      app: string
      /** Lo que esta computadora ya tiene: el servidor no lo usa, el cliente lo compara contra `bienvenida`. */
      versiones: Record<string, number>
      generacion: number | null
    }
  | { t: 'foco'; foco: Foco | null }
  | { t: 'latido' }
  | { t: 'llamada'; evento: EventoDeLlamada }

export interface FotoDeLaGrilla {
  generacion: number
  versiones: Record<string, number>
  metricasVersiones: Record<string, number>
}

/** Servidor → cliente. */
export type DelServidor =
  | ({
      t: 'bienvenida'
      conexionId: string
      perfiles: Perfil[]
      presencia: Presente[]
      ice: ConfiguracionIce
      latidoCadaMs: number
    } & FotoDeLaGrilla)
  /** Algo de la grilla (o una métrica del servidor) cambió: el cliente compara y baja sólo lo distinto. */
  | ({ t: 'grilla' } & FotoDeLaGrilla)
  /** Hay algo de mensajería para esta persona: pedir `GET /mensajes/novedades?espera=0`. */
  | { t: 'mensajes' }
  /** Foto completa de quién está conectado y en qué. Con cinco computadoras no vale la pena mandar deltas. */
  | { t: 'presencia'; presentes: Presente[] }
  | { t: 'perfil'; perfil: Perfil }
  | { t: 'reaccion'; mensajeId: string; conversacionId: string; reacciones: ReaccionRemota[] }
  | { t: 'llamada'; evento: EventoDeLlamada }
  | { t: 'latido' }
  /** Después de un error el servidor cierra con 4401 (token/actor) o 4400 (protocolo). */
  | { t: 'error'; codigo: 'token' | 'actor' | 'protocolo'; mensaje: string }

/** La ruta del canal, relativa a la base del puente. */
export const RUTA_DEL_CANAL = '/api/dmg/vivo'
/** Cada cuánto manda un latido cada lado. Sin ningún frame en `LATIDO_MS * 2.5` la conexión se da por muerta. */
export const LATIDO_MS = 20_000
export const CIERRE_NO_AUTORIZADO = 4401
export const CIERRE_PROTOCOLO = 4400
/** Cuánto se espera el `hola` antes de cerrar una conexión que no se presentó. */
export const ESPERA_DEL_HOLA_MS = 5_000
/** Cuánto timbra una llamada antes de darse por «sin respuesta». */
export const TIMBRE_MS = 45_000
