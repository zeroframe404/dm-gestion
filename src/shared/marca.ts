// La marca configurable: cómo se llama el programa, con qué nombre firma la agencia lo que sale (mensajes,
// presupuestos, reportes), el color principal y el logo. Sin Electron ni Node: lo usan el proceso principal,
// la pantalla y el banco de pruebas.
//
// Lo que NO se configura acá: el `appId` y el nombre del instalador. Eso sale del build (electron-builder),
// porque el sistema operativo los usa para distinguir un programa de otro. La demo tiene marca propia fija
// (Cobertia, ver `canal.ts`) y no pasa por acá.
import { FIRMA_DE_LOS_MENSAJES } from './tipos'

export interface Marca {
  /** El nombre del programa: barra lateral, ingreso, «Acerca de», título de la ventana. */
  nombre: string
  /** Con qué nombre firma la agencia: plantillas de WhatsApp, presupuesto, pie de los reportes. */
  agencia: string
  /** Color principal `#rrggbb`, o null para el azul de siempre. */
  color: string | null
  /** El logo como `data:image/...`, o null para el escudo de siempre. */
  logo: string | null
}

export const MARCA_DE_FABRICA: Marca = { nombre: 'DM Gestión', agencia: FIRMA_DE_LOS_MENSAJES, color: null, logo: null }

export const MAXIMO_DE_NOMBRE = 40
/** El logo viaja al servidor dentro del ajuste: se le pone un tope para no hinchar la base. */
export const MAXIMO_DE_LOGO_EN_BYTES = 200 * 1024
const TIPOS_DE_LOGO = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/

export function esColorHex(valor: unknown): valor is string {
  return typeof valor === 'string' && /^#[0-9a-fA-F]{6}$/.test(valor)
}

/** Los bytes que ocupa el logo ya decodificado (el base64 pesa un tercio más). */
export function bytesDelLogo(logo: string): number {
  const base64 = logo.slice(logo.indexOf(',') + 1)
  return Math.floor((base64.length * 3) / 4)
}

export function esLogoValido(valor: unknown): valor is string {
  return typeof valor === 'string' && TIPOS_DE_LOGO.test(valor) && bytesDelLogo(valor) <= MAXIMO_DE_LOGO_EN_BYTES
}

/**
 * Lo que llegue de afuera (el disco, el servidor, la pantalla) se limpia acá: lo que no sirve vuelve a la
 * marca de fábrica en vez de romper nada. Nunca tira.
 */
export function normalizarMarca(crudo: unknown): Marca {
  const c = (crudo && typeof crudo === 'object' ? crudo : {}) as Record<string, unknown>
  const texto = (valor: unknown, defecto: string): string => {
    const limpio = typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, MAXIMO_DE_NOMBRE) : ''
    return limpio || defecto
  }
  return {
    nombre: texto(c.nombre, MARCA_DE_FABRICA.nombre),
    agencia: texto(c.agencia, MARCA_DE_FABRICA.agencia),
    color: esColorHex(c.color) ? c.color.toLowerCase() : null,
    logo: esLogoValido(c.logo) ? c.logo : null,
  }
}

export function esMarcaDeFabrica(marca: Marca): boolean {
  return (
    marca.nombre === MARCA_DE_FABRICA.nombre && marca.agencia === MARCA_DE_FABRICA.agencia && marca.color === null && marca.logo === null
  )
}

// ---------------------------------------------------------------------------
// La paleta: de un solo color a la escala completa que usa el CSS (`--color-marino-50 … 950`)
// ---------------------------------------------------------------------------

const ESCALA = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
/** Cuánto se acerca cada tono al blanco (positivo) o al negro (negativo). El 600 es el color elegido. */
const MEZCLA: Record<(typeof ESCALA)[number], number> = {
  50: 0.92, 100: 0.84, 200: 0.7, 300: 0.52, 400: 0.3, 500: 0.14, 600: 0, 700: -0.28, 800: -0.42, 900: -0.58, 950: -0.7,
}

function aRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function aHex(rgb: number[]): string {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** Mezcla con blanco (`k` > 0) o con negro (`k` < 0). */
function mezclar(hex: string, k: number): string {
  const destino = k >= 0 ? 255 : 0
  return aHex(aRgb(hex).map((v) => v + (destino - v) * Math.abs(k)))
}

/** `{ '--color-marino-50': '#…', … }`: lo que se escribe en el `<html>` para repintar el programa. */
export function variablesDeColor(color: string): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const paso of ESCALA) variables[`--color-marino-${paso}`] = mezclar(color, MEZCLA[paso])
  return variables
}
