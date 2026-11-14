export const URL_DE_ACTUALIZACIONES: string
export function subirAlVps(opciones: {
  canal: 'estable' | 'beta'
  instalador: string
  blockmap: string
  yml: string
  token?: string
  base?: string
}): Promise<boolean>
