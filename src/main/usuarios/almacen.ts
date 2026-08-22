// Dónde vive el archivo de usuarios. La implementación real habla con GitHub (github.ts); la de
// memoria sirve para las pruebas y se comporta igual, incluido el candado optimista del `sha`.

export interface LecturaRemota {
  texto: string
  /** Versión del archivo. Hay que devolverla al escribir: si cambió en el medio, la escritura se rechaza. */
  sha: string
}

export interface AlmacenRemoto {
  /** Cómo se muestra en la interfaz: «GitHub zeroframe404/dm-gestion-datos». */
  readonly descripcion: string
  /** null si el archivo todavía no existe. */
  leer(): Promise<LecturaRemota | null>
  /**
   * Escribe el archivo. `shaPrevio` es el de la lectura sobre la que se hizo el cambio (null para crear).
   * Devuelve el sha nuevo. Lanza ErrorDeConflicto si alguien escribió en el medio.
   */
  escribir(texto: string, shaPrevio: string | null, mensaje: string): Promise<string>
  /** Fecha (AAAA-MM-DD) en que vence la credencial con la que se accede, si el servicio la informa. */
  vencimientoDelToken(): string | null
}

/** Otra computadora escribió el archivo entre nuestra lectura y nuestra escritura: hay que releer. */
export class ErrorDeConflicto extends Error {
  constructor() {
    super('El archivo de usuarios cambió mientras se guardaba.')
    this.name = 'ErrorDeConflicto'
  }
}

/** GitHub respondió, pero mal (token vencido, repositorio inexistente, error del servidor…). */
export class ErrorDelAlmacen extends Error {
  constructor(
    mensaje: string,
    readonly estado: number | null = null,
    /** true si conviene reintentar en un rato (límite de pedidos, 5xx): se trata como «sin internet». */
    readonly temporal = false,
  ) {
    super(mensaje)
    this.name = 'ErrorDelAlmacen'
  }
}

// ---------------------------------------------------------------------------
// Sólo para las pruebas
// ---------------------------------------------------------------------------

export class AlmacenEnMemoria implements AlmacenRemoto {
  readonly descripcion = 'memoria (pruebas)'
  texto: string | null = null
  sha: string | null = null
  lecturas = 0
  escrituras = 0
  /** Si está, cada operación falla con ese error (para simular «sin internet» o un token vencido). */
  falla: (() => Error) | null = null
  /** Escrituras que van a fallar por conflicto antes de aceptar una (para probar los reintentos). */
  conflictosPendientes = 0
  /** Escrituras que se aplican pero «se cortan» antes de responder (para probar el PUT ambiguo). */
  escriturasSinRespuesta = 0
  vence: string | null = null
  private version = 0

  constructor(textoInicial: string | null = null) {
    if (textoInicial !== null) {
      this.texto = textoInicial
      this.sha = this.nuevoSha()
    }
  }

  private nuevoSha(): string {
    this.version += 1
    return `sha-${this.version}`
  }

  async leer(): Promise<LecturaRemota | null> {
    if (this.falla) throw this.falla()
    this.lecturas += 1
    if (this.texto === null || this.sha === null) return null
    return { texto: this.texto, sha: this.sha }
  }

  /** Se llama justo antes de cada escritura: para simular algo que pasa «mientras se guarda». */
  alEscribir: (() => void) | null = null

  async escribir(texto: string, shaPrevio: string | null, _mensaje: string): Promise<string> {
    if (this.falla) throw this.falla()
    this.alEscribir?.()
    if (this.conflictosPendientes > 0) {
      this.conflictosPendientes -= 1
      // Simula que otra computadora escribió en el medio: el sha cambia y la escritura se rechaza.
      this.sha = this.nuevoSha()
      throw new ErrorDeConflicto()
    }
    if (shaPrevio !== this.sha) throw new ErrorDeConflicto()
    this.escrituras += 1
    this.texto = texto
    this.sha = this.nuevoSha()
    if (this.escriturasSinRespuesta > 0) {
      this.escriturasSinRespuesta -= 1
      const error = new Error('fetch failed') as Error & { cause?: { code: string } }
      error.cause = { code: 'ECONNRESET' }
      throw error
    }
    return this.sha
  }

  vencimientoDelToken(): string | null {
    return this.vence
  }

  /** Como si otra computadora hubiera escrito el archivo: cambia el contenido y el sha. */
  escribirDirecto(texto: string): void {
    this.texto = texto
    this.sha = this.nuevoSha()
  }
}
