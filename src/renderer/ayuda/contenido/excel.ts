import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_EXCEL: Record<string, ContenidoDeAyuda> = {
  excel: {
    clave: 'excel',
    titulo: 'General Excel',
    resumen: 'Todas las áreas del programa en un solo lugar y en formato planilla, como se venía trabajando en la hoja.',
    secciones: [
      {
        titulo: 'Para qué está',
        parrafos: [
          'La agencia trabajó muchos años sobre una hoja de cálculo, y buena parte del equipo sigue pensando así: «bajá hasta la fila de Pérez», «mirá la columna H». Las pantallas del programa son mejores para trabajar —tienen la ficha completa, el semáforo, los botones para cobrar o avisar— pero para quien recién empieza son un lugar desconocido. Esta pantalla es el puente: los mismos datos de siempre, presentados como los venías viendo.',
          'A la izquierda está la lista de áreas (la planilla del mes, las bajas, los clientes, las pólizas, las renovaciones, los siniestros, los pagos, la mora, los riesgos varios, las consultas, los presupuestos y las tareas). Elegís una y a la derecha aparece esa área entera como una planilla, con las letras arriba, los números de fila al costado y el cursor que se mueve con las flechas.',
        ],
      },
      {
        titulo: 'Cómo se usa',
        parrafos: [
          'Se mueve como cualquier planilla: las flechas mueven el cursor, Shift con las flechas selecciona un rango, Ctrl+C copia lo seleccionado. Lo copiado se pega tal cual en Excel o en Google Sheets, cada celda en su celda. También se puede arrastrar con el mouse para seleccionar.',
          'Arriba están los filtros que entiende cada área: el mes, la sucursal, la compañía, el estado y el buscador. Son los mismos que en la pantalla del módulo, y como allá dejan tildar varias opciones a la vez. Abajo de todo, la barra dice en qué celda estás, cómo se llama esa columna y cuántas celdas tenés seleccionadas.',
        ],
        lista: [
          'Flechas: moverse de celda en celda.',
          'Shift + flechas: seleccionar un rango.',
          'Ctrl+C: copiar la selección (se pega directo en Excel).',
          'Ctrl+A: seleccionar toda la planilla.',
          'Inicio y Fin: al principio y al final de la fila. Con Ctrl, de toda la planilla.',
        ],
      },
      {
        titulo: 'Acá se mira, no se edita',
        parrafos: [
          'Esta pantalla es de sólo lectura, a propósito. Cada módulo tiene sus reglas al guardar —que no haya dos clientes con el mismo documento, que el cambio viaje a la hoja, que el semáforo se recalcule— y escribir desde una grilla se las saltearía todas. Cuando encontrás lo que buscabas, el botón «Abrir el módulo» te lleva a la pantalla que sí lo puede modificar.',
          'El botón «Bajar el Excel» guarda un archivo .xlsx con lo mismo que estás viendo, con los filtros puestos y sin el tope de filas de la pantalla. Es el mismo archivo que sale de Reportes.',
        ],
      },
      {
        titulo: 'Qué áreas ves acá',
        parrafos: [
          'Sólo las de los módulos que ya podés ver. Si un administrador te sacó Siniestros de la barra lateral, tampoco los vas a ver acá: no es una puerta de atrás, es la misma información con los mismos permisos, en otra forma. Si no tenés ningún módulo a la vista, la pantalla te lo dice.',
          'Y desde cada módulo hay un botón «Ver como Excel» que te trae directo acá con esa área abierta, para no tener que buscarla.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Área',
        explicacion: 'Cada uno de los listados del programa: la planilla del mes, los clientes, las pólizas, la mora… Es lo que en la hoja de la agencia era una pestaña.',
      },
      {
        termino: 'Rango',
        explicacion: 'Un bloque de celdas seleccionadas. Se marca con Shift y las flechas, o arrastrando el mouse, y se copia con Ctrl+C.',
      },
    ],
  },
}
