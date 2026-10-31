// Pedido de exportación a Excel genérico: la pantalla manda lo que ya calculó y el proceso principal
// sólo lo vuelca en un .xlsx y lo guarda con el diálogo «Guardar como». No consulta la base.

/** Una celda del Excel: texto, número o vacía. Las fechas van como texto, como en el resto de la app. */
export type CeldaDeExcel = string | number | null

export interface PedidoDeExcel {
  /** Título del listado: va arriba de la hoja, en el nombre de la pestaña y del archivo. */
  titulo: string
  /** Encabezados de columna, en el orden en que se muestran. */
  columnas: string[]
  /** Una fila por renglón, con tantas celdas como columnas. */
  filas: CeldaDeExcel[][]
}
