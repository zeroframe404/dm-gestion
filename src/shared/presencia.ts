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
import type { Foco, Presente } from '../main/vivo/protocolo'

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

/**
 * La foto de la presencia indexada por clave de foco: «¿quién está en este lugar de la pantalla?».
 *
 * Vive acá y no en el contexto del renderer porque es la vuelta de `claveDeFoco` y tiene que quedar
 * al lado suyo: si algún día una clave cambia de forma, el que indexa y el que pregunta cambian
 * juntos. Además así se puede probar sin montar React.
 *
 * UNA CELDA SE ANOTA DOS VECES: con su propia clave (`celda:<filaId>:<campo>`) y con la de la fila
 * entera (`objeto:fila:<filaId>`). Es lo que hace que el renglón de Mora, el de Deudores y el panel de
 * detalle de la planilla se enciendan cuando alguien está editando CUALQUIER celda de esa fila —que es
 * lo que la persona necesita saber antes de tocarla— sin que la planilla tenga que reportar dos focos.
 */
export function indexarPresencia(presentes: readonly Presente[]): Map<ClaveDeFoco, Presente[]> {
  const porClave = new Map<ClaveDeFoco, Presente[]>()
  const anotar = (clave: ClaveDeFoco, presente: Presente) => {
    const lista = porClave.get(clave)
    if (lista) lista.push(presente)
    else porClave.set(clave, [presente])
  }
  for (const presente of presentes) {
    if (!presente.foco) continue
    anotar(claveDeFoco(presente.foco), presente)
    if (presente.foco.tipo === 'celda') anotar(claveDeFilaDeCelda(presente.foco.filaId), presente)
  }
  return porClave
}

/**
 * ¿La foto que llegó dice algo distinto de la que ya está?
 *
 * El servidor manda la foto ENTERA en cada cambio, y la mayoría de esos cambios no cambian nada de lo
 * que la pantalla dibuja: «Ana pasó de Inicio a Cartera», el reenvío del foco de una reconexión, o
 * alguien que entra y sale del mismo lugar. Sin esta comparación, cada una de ésas armaba un arreglo
 * nuevo y hacía redibujar todas las celdas del glow para dejarlas exactamente igual, y con dos personas
 * moviéndose son hasta diez por segundo.
 *
 * Se comparan las cuatro cosas que la pantalla usa —quién es, cómo se llama, con qué color y en qué
 * está— y no el objeto entero: `desde` es una hora y vuelve distinta en cada reconexión, así que
 * incluirla haría que la comparación no sirviera para nada.
 */
export function mismaFoto(antes: readonly Presente[], ahora: readonly Presente[]): boolean {
  if (antes.length !== ahora.length) return false
  return antes.every((viejo, posicion) => {
    const nuevo = ahora[posicion]!
    return (
      viejo.conexionId === nuevo.conexionId &&
      viejo.clave === nuevo.clave &&
      viejo.nombre === nuevo.nombre &&
      viejo.color === nuevo.color &&
      claveOVacio(viejo) === claveOVacio(nuevo) &&
      editandoDe(viejo) === editandoDe(nuevo)
    )
  })
}

/** El lugar donde está parada una persona, o vacío si no está en ninguno. */
function claveOVacio(presente: Presente): string {
  return presente.foco ? claveDeFoco(presente.foco) : ''
}

/** Si está escribiendo o nada más mirando: cambia el anillo y cambia si algo se traba. */
function editandoDe(presente: Presente): boolean {
  return presente.foco !== null && presente.foco.tipo !== 'modulo' && presente.foco.editando
}
