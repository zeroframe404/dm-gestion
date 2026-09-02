// Preferencias de interfaz de ESTA computadora: el zoom, la barra lateral y qué columnas se ven.
//
// Van en `localStorage` y no en la base ni en el VPS, por el mismo motivo que el volumen de los
// avisos (ver `sonidos/index.ts`): no son de la persona ni de la agencia, son de la máquina. En el
// mostrador hay una notebook de 14" donde la planilla se mira al 80 % y sin la barra lateral; en la
// oficina, un monitor grande donde se mira al 125 %. El mismo usuario entra en las dos y espera que
// cada una se acuerde de lo suyo.
//
// Ninguna de estas funciones puede romper una pantalla: si `localStorage` está bloqueado se trabaja
// con los valores por defecto y listo. Es una preferencia, no un dato.
import type { Tema } from './tema-valores'
import { escalaGuardada, sanearOcultas, type ColumnaElegible } from './vista'

const CLAVE_ZOOM = 'dm.vista.zoom'
const CLAVE_BARRA_LATERAL = 'dm.vista.barraLateral'
const CLAVE_TEMA = 'dm.vista.tema'
const PREFIJO_COLUMNAS = 'dm.vista.columnas.'

function leer(clave: string): string | null {
  try {
    return window.localStorage.getItem(clave)
  } catch {
    return null
  }
}

function escribir(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    /* sin localStorage la preferencia vale hasta cerrar la ventana */
  }
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** Lo último que se eligió en esta computadora, saneado contra los pasos que existen hoy. */
export function zoomGuardado(): number {
  return escalaGuardada(leer(CLAVE_ZOOM))
}

export function guardarZoom(escala: number): void {
  escribir(CLAVE_ZOOM, String(escala))
}

/**
 * Agranda o achica TODO: la letra, los iconos, el alto de las filas y el ancho de las columnas.
 *
 * Lo hace el zoom de Chromium (`webFrame.setZoomFactor`, del otro lado de la precarga) y no una
 * transformación de CSS, justamente para que no quede nada afuera: los anchos de la tabla virtual
 * están en píxeles y los diálogos se posicionan con `fixed`, así que escalar por CSS dejaría la
 * planilla igual de ancha y los carteles fuera de lugar.
 */
export function aplicarZoom(escala: number): void {
  try {
    window.dm.vista.fijarZoom(escala)
  } catch {
    /* fuera de Electron (o con una precarga vieja) no hay zoom: la app funciona igual */
  }
}

// ---------------------------------------------------------------------------
// Barra lateral
// ---------------------------------------------------------------------------

export function barraLateralColapsada(): boolean {
  return leer(CLAVE_BARRA_LATERAL) === '1'
}

export function guardarBarraLateralColapsada(colapsada: boolean): void {
  escribir(CLAVE_BARRA_LATERAL, colapsada ? '1' : '0')
}

// ---------------------------------------------------------------------------
// Tema (claro / oscuro)
// ---------------------------------------------------------------------------

// El tipo vive en `tema-valores.ts`, junto al valor que se escribe en el `<html>`; se re-exporta
// desde acá porque el resto de la interfaz lo pide junto con el resto de las preferencias.
export type { Tema }

/** Sin nada guardado todavía se abre en claro: es el tema con el que se diseñó cada pantalla. */
export function temaGuardado(): Tema {
  return leer(CLAVE_TEMA) === 'oscuro' ? 'oscuro' : 'claro'
}

export function guardarTema(tema: Tema): void {
  escribir(CLAVE_TEMA, tema)
}

// ---------------------------------------------------------------------------
// Columnas escondidas, por tabla
// ---------------------------------------------------------------------------

/**
 * Qué columnas están escondidas en esa tabla. `tabla` es un nombre corto y estable («cartera»,
 * «clientes»): es lo que separa las preferencias de una pantalla de las de otra.
 */
export function columnasOcultas(tabla: string, columnas: ColumnaElegible[]): string[] {
  const guardado = leer(PREFIJO_COLUMNAS + tabla)
  if (!guardado) return []
  try {
    const leidas: unknown = JSON.parse(guardado)
    if (!Array.isArray(leidas)) return []
    return sanearOcultas(columnas, leidas.filter((id): id is string => typeof id === 'string'))
  } catch {
    // Alguien editó el localStorage a mano o quedó a medio escribir: se empieza de nuevo.
    return []
  }
}

export function guardarColumnasOcultas(tabla: string, ocultas: readonly string[]): void {
  escribir(PREFIJO_COLUMNAS + tabla, JSON.stringify([...ocultas]))
}
