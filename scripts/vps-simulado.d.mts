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
    | 'ajusteLeido'
    | 'ajusteConsultado'
    | 'ajusteGuardado'
    | 'usuariosLeidos'
    | 'usuariosGuardados',
    number
  >
  /** La base de usuarios de la agencia, tal como quedó en el servidor. */
  usuarios: { texto: string; version: number; actualizadoEn: string; actualizadoPor: string | null; mensaje: string | null } | null
  /** Los mensajes con los que se guardó la base de usuarios, en orden. */
  mensajesDeUsuarios: string[]
  escuchar(puerto?: number): Promise<string>
  cerrar(): Promise<void>
  /** Lee los valores actuales de una pestaña (para asserts). */
  valoresDe(titulo: string, hastaFila?: number): string[][] | null
  /** «Otra computadora» cambió una celda directamente en la base. */
  editarDirecto(titulo: string, fila: number, columna: number, valor: string): void
  cargarPestanaDirecto(pestana: PestanaSimulada): void
}
