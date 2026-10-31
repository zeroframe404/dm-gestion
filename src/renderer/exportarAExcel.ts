// Exportar a Excel desde un listado: manda lo que la pantalla YA muestra ({titulo, columnas, filas}) al
// proceso principal, que arma el .xlsx y abre el diálogo «Guardar como». No consulta nada: lo que
// se baja es exactamente lo que se ve (filtros aplicados), con las columnas y el orden de la tabla.
//
// Uso:
//   const r = await exportarAExcel({ titulo: 'Listado de Pólizas', columnas: ['Póliza', 'Cliente'], filas })
//   if (r.ok && r.datos.ruta) avisar(`Se guardó en ${r.datos.ruta}`)   // ruta null = canceló el diálogo
//   if (!r.ok) mostrarError(r.error)
import type { PedidoDeExcel } from '../shared/listados'
import type { Resultado } from '../shared/tipos'

export type { CeldaDeExcel, PedidoDeExcel } from '../shared/listados'

export function exportarAExcel(pedido: PedidoDeExcel): Promise<Resultado<{ ruta: string | null }>> {
  return window.dm.listados.exportarExcel(pedido)
}
