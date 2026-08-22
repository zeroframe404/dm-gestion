// Tipos del simulador de la API Contents de GitHub (github-simulado.mjs), para usarlo desde las pruebas en TypeScript.
export interface FallaSimulada {
  estado: number
  mensaje?: string
  cabeceras?: Record<string, string>
}

export interface GuionSimulado {
  /** GET del repositorio responde 404 (repo inexistente o token sin acceso). */
  sinRepo?: boolean
  /** Estados a devolver antes de responder bien. */
  fallasIniciales?: Array<number | FallaSimulada>
  /** No responder nunca (para probar el tiempo máximo). */
  colgar?: boolean
}

export class GitHubSimulado {
  constructor(opciones?: { repo?: string; archivo?: string; tokens?: string[]; vence?: string | null })
  repo: string
  archivo: string
  tokensValidos: string[]
  vence: string | null
  texto: string | null
  sha: string | null
  etag: string | null
  url: string
  pedidos: string[]
  /** Cada pedido con su query, sus cabeceras y el estado con el que se respondió. */
  intercambios: Array<{ metodo: string; ruta: string; busqueda: string; cabeceras: Record<string, string | string[] | undefined>; estado: number | null }>
  commits: string[]
  guion: GuionSimulado
  fallasUsadas: number
  escuchar(puerto?: number): Promise<string>
  cerrar(): Promise<void>
  escribirDirecto(texto: string): string
  borrarArchivo(): void
}
