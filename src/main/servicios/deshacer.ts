// Deshacer un cambio desde el historial de una fila (15.x): el «me equivoqué» de siempre, pero para
// cualquier edición de celda o aviso marcado a mano, no sólo para la baja (que ya tenía el suyo).
//
// Sólo dos tipos de acción son reversibles desde acá —ver `ACCIONES_REVERSIBLES_DESDE_HISTORIAL` en
// `historial.ts`, que es la lista que también usa la pantalla para decidir si dibuja el botón—: son
// los únicos donde el historial ya guarda exactamente lo que hace falta para volver atrás («esta fila,
// esta columna, el valor de antes») sin arrastrar nada más. El resto de las acciones (pagos, bajas,
// cierres de mes, fusiones, borrados, permisos…) NO pasan por acá: mueven otras filas, plata o la hoja
// entera, y una reversión a ciegas ahí es más peligrosa que el error que se quiere arreglar. Bajas ya
// tiene su propio «Deshacer» en Cartera → Bajas (`deshacerBaja`), que conoce el id exacto en vez de
// tener que adivinarlo a partir del historial.
import type { FilaCartera, SesionUsuario } from '../../shared/tipos'
import { ErrorDeNegocio } from './errores'
import { ACCIONES_REVERSIBLES_DESDE_HISTORIAL, buscarEntradaDeHistorial, marcarEntradaDeshecha, type EntradaHistorialCruda } from './historial'
import { campoEditableDesdeEtiqueta, deshacerAviso, editarCelda } from './cartera'

function revertir(entrada: EntradaHistorialCruda, actor: SesionUsuario): FilaCartera {
  const filaId = entrada.filaId
  if (!filaId) throw new ErrorDeNegocio('Ese cambio no tiene una fila de la planilla asociada, así que no se puede deshacer.')

  if (entrada.accion === 'aviso') return deshacerAviso(filaId, entrada.valorAnterior, actor)

  // 'edicion': el rótulo que quedó anotado (p. ej. «FECHA DE VENC») tiene que resolver a un campo
  // editable de verdad. Si no —una columna que se dejó de editar desde acá entre que se anotó el
  // cambio y ahora—, se corta con un error claro en vez de escribir cualquier cosa.
  const campo = campoEditableDesdeEtiqueta(entrada.campo)
  if (!campo) throw new ErrorDeNegocio(`«${entrada.campo}» ya no se puede editar desde la planilla, así que no se puede deshacer desde acá.`)
  return editarCelda(filaId, campo, entrada.valorAnterior ?? '', actor)
}

/**
 * Deshace la entrada `entradaId` del historial y devuelve la fila ya actualizada.
 *
 * La marca de «deshecho» se pone recién DESPUÉS de revertir bien: si `revertir` tira (mes cerrado,
 * campo que ya no existe, lo que sea), la entrada queda como estaba y se puede reintentar. Y se pone
 * con `marcarEntradaDeshecha`, que exige `deshecho_en IS NULL`: si dos clics llegan casi juntos, el
 * segundo revierte igual (no hace daño repetir la misma escritura) pero no deja un segundo cartel de
 * «deshecho por»; gana el primero que llega.
 */
export function deshacerEntradaDeHistorial(entradaId: number, actor: SesionUsuario): FilaCartera {
  const entrada = buscarEntradaDeHistorial(entradaId)
  if (!entrada) throw new ErrorDeNegocio('No se encontró ese cambio en el historial.')
  if (entrada.deshechoEn) throw new ErrorDeNegocio(`Ese cambio ya lo había deshecho ${entrada.deshechoPor ?? 'otra persona'}.`)
  if (!ACCIONES_REVERSIBLES_DESDE_HISTORIAL.has(entrada.accion)) {
    throw new ErrorDeNegocio('Este tipo de cambio todavía no se puede deshacer desde acá.')
  }

  const fila = revertir(entrada, actor)
  marcarEntradaDeshecha(entradaId, actor)
  return fila
}
