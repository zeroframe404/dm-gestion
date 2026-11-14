export function firmaSegunEntorno(entorno: Record<string, string | undefined>): {
  modo: 'pfx' | 'azure' | 'ninguna'
  argumentos: string[]
  aviso: string | null
}
export function argumentosDeFirma(): string[]
