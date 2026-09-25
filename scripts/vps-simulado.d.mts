// Tipos del simulador del puente /api/dmg del VPS (vps-simulado.mjs), para las pruebas en TypeScript.
export interface PestanaSimulada {
  titulo: string
  valores?: string[][]
  oculta?: boolean
  columnasOcultas?: number[]
}

export class VpsSimulado {
  constructor(opciones?: { token?: string; pestanas?: PestanaSimulada[] })
  token: string
  inicializada: boolean
  url: string
  /** Respuestas forzadas antes de responder bien. */
  fallasIniciales: Array<{ estado: number; mensaje?: string }>
  errorFijo: { estado: number; mensaje: string } | null
  colgar: boolean
  intercambios: Array<{ metodo: string | undefined; ruta: string; autorizacion: string | null }>
  llamadas: Record<
    | 'estructura'
    | 'leer'
    | 'celdas'
    | 'agregar'
    | 'borrar'
    | 'pestanas'
    | 'tramos'
    | 'estado'
    | 'novedades'
    | 'metricasLeidas'
    | 'ajusteLeido'
    | 'ajusteConsultado'
    | 'ajusteGuardado'
    | 'usuariosLeidos'
    | 'usuariosGuardados'
    | 'respaldosListados'
    | 'respaldosCreados'
    | 'respaldosRestaurados'
    | 'adjuntosSubidos'
    | 'adjuntosBajados'
    | 'mensajesConversaciones'
    | 'mensajesEnviados'
    | 'mensajesNovedades'
    | 'mensajesEntregados'
    | 'mensajesLeidos'
    | 'mensajesRegistro'
    | 'mensajesReaccionados'
    | 'perfilesLeidos'
    | 'perfilesGuardados',
    number
  >
  /** Los respaldos guardados, del más nuevo al más viejo. */
  respaldos: Array<{ id: number; dia: string; motivo: string; fecha: string; hechoPor: string | null }>
  /** Los adjuntos subidos (12.6): id → ficha + bytes. */
  adjuntos: Map<string, { ficha: { id: string; nombre: string; tipo: string; tamano: number; sha256: string; grupo: string; subidoPor: string | null; creadoEn: string }; contenido: Buffer }>
  /** El tope por archivo del servidor simulado, en bytes (8 MB por defecto; se baja para probar el 413). */
  topeDeAdjunto: number
  /** La base de usuarios de la agencia, tal como quedó en el servidor. */
  usuarios: { texto: string; version: number; actualizadoEn: string; actualizadoPor: string | null; mensaje: string | null } | null
  /** Los mensajes con los que se guardó la base de usuarios, en orden. */
  mensajesDeUsuarios: string[]
  /** Mensajería interna (12.8): las conversaciones que tiene el servidor simulado. */
  conversaciones: Map<
    string,
    {
      id: string
      tipo: 'DIRECTA' | 'GRUPO'
      titulo: string | null
      claveDirecta: string | null
      creadoPor: string
      creadoEn: string
      ultimoMensajeEn: string | null
      participantes: Array<{ clave: string; nombre: string; salioEn: string | null }>
    }
  >
  /**
   * El freno del zumbido, en milisegundos (el servidor de verdad usa diez segundos). La prueba lo baja
   * a cero para verificar los dos lados: que frena, y que después de la espera deja pasar.
   */
  esperaEntreZumbidosMs: number
  /** Los mensajes guardados, en el orden en que llegaron. */
  mensajes: Array<{
    id: string
    conversacionId: string
    tipo: 'NORMAL' | 'ZUMBIDO' | 'LLAMADA'
    orden: number
    autorClave: string
    autorNombre: string
    cuerpo: string
    creadoEn: string
    enviadoEn: string | null
    eliminadoEn: string | null
    eliminadoPor: string | null
    adjuntos: Array<{ id: string; nombre: string; tipo: string; tamano: number; sha256: string; miniatura: string | null }>
  }>
  /** Los dos acuses, por mensaje y por persona: `${mensajeId}|${usuarioClave}`. */
  acuses: Map<string, { entregadoEn: string | null; leidoEn: string | null }>
  /** Las reacciones (14.0): mensajeId → (clave de la persona → emoji). Una por persona y por mensaje. */
  reacciones: Map<string, Map<string, string>>
  /** Las reacciones de un mensaje, agrupadas por emoji, tal como viajan por el canal y por HTTP. */
  reaccionesDe(mensajeId: string): Array<{ emoji: string; claves: string[] }>
  escuchar(puerto?: number): Promise<string>
  cerrar(): Promise<void>

  // --- El canal en vivo (14.0): un WebSocket en /api/dmg/vivo sobre el mismo servidor http ---------
  /** Las conexiones ya saludadas, por conexionId. Una computadora = una conexión. */
  conexiones: Map<
    string,
    { id: string; socket: unknown; actor: ActorDelCanalSimulado; color: number; foco: FocoSimulado | null; desde: string }
  >
  /** El color (y la foto, cuando la Fase C la cargue) de cada persona, por clave. */
  perfiles: Map<string, PerfilSimulado>
  /** La señalización de llamadas que llegó por el canal, en orden. Ver `llamadas` para los contadores HTTP. */
  llamadasDeVoz: Array<{ de: string; evento: unknown }>
  /** Las llamadas de voz abiertas (14.0), por `llamadaId`. Vacío quiere decir que nadie está hablando. */
  llamadasAbiertas: Map<string, LlamadaSimulada>
  /**
   * Cuánto suena el teléfono antes de darlo por perdido, en milisegundos (45 s en el servidor de
   * verdad). Las pruebas lo suben o lo bajan: nadie corre un banco que espera cuarenta y cinco segundos.
   */
  timbreDeLlamadaMs: number
  /** Le manda un frame a TODAS las computadoras de una persona. Devuelve a cuántas les llegó. */
  mandarleA(clave: string, mensaje: unknown): number
  /** Lo que el saludo manda como configuración de WebRTC. Sin TURN, igual que un VPS sin secreto. */
  ice: { stun: string[]; turn: { urls: string[]; username: string; credential: string; venceEn: string } | null }
  /** Quién está conectado y en qué: la foto completa que difunde el canal. */
  presencia(): PresenteSimulado[]
  /** La foto que viaja por el canal y que contesta `/novedades`: generación + versiones + métricas. */
  fotoDeLaGrilla(): { generacion: number; versiones: Record<string, number>; metricasVersiones: Record<string, number> }
  /** Difunde «algo de la grilla cambió». Sale solo desde `marcarCambiada` y compañía. */
  avisarGrilla(): void
  /** Le dice «hay algo tuyo» a las computadoras de esas personas. */
  avisarMensajes(claves: string[]): void
  /** Le corta el canal a una persona sin saludo, como el cable desenchufado. Devuelve cuántas cortó. */
  cerrarConexionesDe(clave: string): number
  /** El color que le toca a una clave, creando el perfil si es la primera vez. */
  asegurarPerfil(clave: string): PerfilSimulado
  /** Escribe una celda sin avisar por el canal: los manejadores avisan una vez, al subir la versión. */
  ponerCelda(titulo: string, fila: number, columna: number, valor: string): void
  /** Lee los valores actuales de una pestaña (para asserts). */
  valoresDe(titulo: string, hastaFila?: number): string[][] | null
  /** «Otra computadora» cambió una celda directamente en la base. */
  /** El aviso en vivo: la versión de cada pestaña y la generación de la hoja. */
  versiones: Map<string, number>
  generacion: number
  /** Las pestañas bajadas ENTERAS (sin `hastaFila`), en orden: para afirmar qué se bajó y qué no. */
  pestanasLeidas: string[]
  /** Sube la versión de una pestaña y la devuelve, como una escritura del servidor real. */
  marcarCambiada(titulo: string): number
  mapaDeVersiones(): Record<string, number>
  /** Las métricas que el servidor ya calculó (13.2): clave → {version, calculadoEn, payload}. */
  metricas: Map<string, { version: number; calculadoEn: string; payload: unknown }>
  /** «El servidor terminó de recalcular esta métrica»: sube su versión y guarda el resultado nuevo. */
  cargarMetricaDirecto(clave: string, payload: unknown): number
  /** Publica vehículos en el catálogo maestro simulado, con una revisión nueva. */
  cargarVehiculos(
    vehiculos: Array<{
      mtm: string
      tipo: string
      origen: string
      marca: string
      modelo: string
      version: string
      carroceria: string | null
      anios: number[]
      activo?: boolean
    }>,
    edicion?: string,
  ): void
  mapaDeVersionesDeMetricas(): Record<string, number>
  /** La hoja se reemplazó entera (restaurar un respaldo, la migración inicial). */
  subirGeneracion(): void
  editarDirecto(titulo: string, fila: number, columna: number, valor: string): void
  cargarPestanaDirecto(pestana: PestanaSimulada): void
  /** Guarda una foto de cómo están las pestañas ahora, como hace el reloj del servidor. */
  guardarRespaldo(
    motivo: 'DIARIO' | 'A_MANO' | 'ANTES_DE_RESTAURAR',
    hechoPor: string | null,
  ): { respaldo: { id: number; dia: string; motivo: string }; yaEstaba: boolean }
}

/** Quién se conectó al canal en vivo, tal como llegó en el saludo. */
export interface ActorDelCanalSimulado {
  clave: string
  nombre: string
  rol: string
  sucursal: string
}

/**
 * En qué está trabajando alguien. Es el mismo `Foco` de `src/main/vivo/protocolo.ts`, declarado suelto
 * acá porque el simulador no lo mira por dentro: lo guarda y lo vuelve a difundir tal cual llegó.
 */
export type FocoSimulado =
  | { tipo: 'celda'; pestana: string; filaId: string; campo: string; editando: boolean }
  | { tipo: 'objeto'; objeto: string; filaId: string; editando: boolean }
  | { tipo: 'modulo'; modulo: string }

export interface PresenteSimulado {
  conexionId: string
  clave: string
  nombre: string
  sucursal: string
  color: number
  foco: FocoSimulado | null
  desde: string
}

export interface PerfilSimulado {
  clave: string
  color: number
  foto: string | null
  version: number
  actualizadoEn: string
}

/** Una llamada de voz abierta en el servidor simulado. */
export interface LlamadaSimulada {
  id: string
  de: string
  deNombre: string
  para: string
  conversacionId: string
  situacion: 'timbrando' | 'en-llamada'
  desde: number
  hablandoDesde: number | null
  reloj: ReturnType<typeof setTimeout> | null
}
