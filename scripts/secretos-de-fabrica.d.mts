// Tipos de secretos-de-fabrica.mjs, para la configuración de Vite y el banco de pruebas.
type Entorno = Record<string, string | undefined>
export const DE_FABRICA: Array<{ archivo: string; constante: string; variable: string; secreto: string; queEs: string }>
export function valorDeFabrica(variable: string, entorno?: Entorno): string
export function ponerSecretosDeFabrica(rutaAbsoluta: string, codigo: string, entorno?: Entorno): string | null
export function secretosDeFabricaQueFaltan(entorno?: Entorno): Array<{ archivo: string; constante: string; variable: string; secreto: string; queEs: string }>
