// Tipos de secretos-de-la-agencia.mjs, para la configuración de Vite (que se chequea con TypeScript).
export const SECRETOS: Array<{ archivo: string; constante: string; reemplazo: string }>
export function valoresSecretos(leer: (archivo: string) => string): Array<{ constante: string; valor: string }>
export function quitarSecretos(rutaAbsoluta: string, codigo: string): string | null
