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
    | 'mensajesRegistro',
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
    tipo: 'NORMAL' | 'ZUMBIDO'
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
  escuchar(puerto?: number): Promise<string>
  cerrar(): Promise<void>
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
