import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_REPORTES: Record<string, ContenidoDeAyuda> = {
  'reportes.exportaciones': {
    clave: 'reportes.exportaciones',
    titulo: 'Reportes → Exportaciones',
    resumen: 'El centro para sacar cualquier listado de la aplicación a un archivo Excel o PDF, eligiendo filtros y columnas, con una vista previa antes de guardar.',
    secciones: [
      {
        titulo: 'Cómo se arma una exportación',
        parrafos: [
          'A la izquierda elegís de qué módulo querés el listado (Clientes, Pólizas, Cobranzas, Siniestros, y así con cada uno). Al elegirlo aparecen sus filtros propios: por ejemplo en Pólizas podés filtrar por sucursal, compañía o estado, y en Cobranzas por período. Cambiar de módulo borra los filtros y columnas del anterior, porque no tienen sentido para el nuevo.',
          'Debajo de los filtros está «Columnas», con una casilla por cada dato disponible: se destildan las que no hacen falta en el archivo final. «Todas» las vuelve a tildar todas, y «Sólo las primeras» dejan las seis más importantes. Siempre tiene que quedar al menos una tildada.',
        ],
      },
      {
        titulo: 'La vista previa',
        parrafos: [
          'Antes de generar nada, la pantalla muestra una vista previa con las primeras filas que van a salir, así se puede revisar que los filtros y las columnas sean los correctos antes de gastar tiempo esperando un archivo grande. La vista previa se actualiza sola apenas se cambia un filtro o una columna, con una breve pausa mientras se escribe.',
        ],
      },
      {
        titulo: 'Exportar a Excel o a PDF',
        parrafos: [
          '«Exportar a Excel» genera un archivo .xlsx con exactamente las filas y columnas que se ven en la vista previa, para trabajarlo, filtrarlo o armar cuentas en Excel. «Exportar a PDF» genera el mismo listado pero en un documento para imprimir o mandar tal cual, sin que se pueda editar. Los dos abren el diálogo de Windows para elegir dónde guardar el archivo.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Vista previa',
        explicacion: 'Las primeras filas del archivo que se va a generar, para revisar filtros y columnas antes de exportar de verdad.',
      },
      {
        termino: '.xlsx',
        explicacion: 'El formato de archivo de Excel: se puede abrir, ordenar y editar con esa aplicación.',
      },
    ],
  },
  'reportes.clasica': {
    clave: 'reportes.clasica',
    titulo: 'Reportes → Planilla clásica',
    resumen: 'El archivo Excel con el formato de siempre de la planilla mensual: las mismas columnas, en el mismo orden, listo para imprimir o mandar al contador.',
    secciones: [
      {
        titulo: 'En qué se diferencia de Exportaciones',
        parrafos: [
          'A diferencia de la pestaña Exportaciones, acá no se elige ninguna columna ni ningún formato: la gracia de la planilla clásica es justamente que sale siempre igual, con el mismo aspecto que tenía la planilla mensual de toda la vida. Lo único que se elige es qué meses incluir y, opcionalmente, una sola sucursal.',
        ],
      },
      {
        titulo: 'Cómo se genera',
        parrafos: [
          'Se tildan uno o varios meses de la lista, se elige una sucursal si hace falta (o «Todas» para traerlas juntas) y «Generar el archivo» arma un .xlsx con una pestaña por cada mes elegido y, al lado, su pestaña de bajas de ese mes. Con una sucursal elegida, la planilla sale sólo con las filas de ese local, y el nombre del archivo lo aclara.',
        ],
      },
      {
        titulo: 'Qué datos trae',
        parrafos: [
          'El archivo se arma con lo que hay en ese momento en DM Gestión, que es lo mismo que hay en la base del VPS: si hiciste cambios recién y todavía no se subieron, igual ya están en este archivo. Generar la planilla clásica no cambia nada ni en la base ni en la hoja de Google: es sólo una copia para imprimir o para mandarle al contador.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Planilla clásica',
        explicacion: 'El archivo Excel con el mismo formato que tenía siempre la planilla mensual en papel o en Google: una fila por póliza, con sus columnas de siempre.',
      },
    ],
  },
}
