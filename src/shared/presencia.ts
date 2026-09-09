// La clave de foco (14.0): el texto con el que el renderer y el proceso principal nombran «este lugar
// de la pantalla» para saber si alguien más está ahí. Es una sola función para los dos lados a
// propósito: una celda se llama igual cuando se reporta desde la planilla y cuando se busca desde la
// tabla que dibuja el glow.
//
//   celda:<filaId>:<campo>       una celda de la planilla, por el _ID de la fila y el campo lógico
//   objeto:<objeto>:<filaId>     una ficha (cliente, póliza, siniestro, tarea…), por el _ID
//   modulo:<modulo>              una pantalla entera (Inicio, Cartera…), sin nada elegido
//
// Siempre por `_ID` y nunca por el id local de SQLite: el id local es distinto en cada computadora y
// el foco tiene que coincidir entre las cinco.
import type { Foco } from '../main/vivo/protocolo'

export type ClaveDeFoco = string

export function claveDeFoco(foco: Foco): ClaveDeFoco {
  switch (foco.tipo) {
    case 'celda':
      return `celda:${foco.filaId}:${foco.campo}`
    case 'objeto':
      return `objeto:${foco.objeto}:${foco.filaId}`
    case 'modulo':
      return `modulo:${foco.modulo}`
  }
}

export function claveDeCelda(filaId: string, campo: string): ClaveDeFoco {
  return `celda:${filaId}:${campo}`
}

export function claveDeObjeto(objeto: Extract<Foco, { tipo: 'objeto' }>['objeto'], filaId: string): ClaveDeFoco {
  return `objeto:${objeto}:${filaId}`
}

/** La clave de la fila entera de una celda: sirve para marcar el renglón aunque el glow vaya en la celda. */
export function claveDeFilaDeCelda(filaId: string): ClaveDeFoco {
  return `objeto:fila:${filaId}`
}
