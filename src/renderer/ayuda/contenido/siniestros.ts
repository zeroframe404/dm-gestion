import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_SINIESTROS: Record<string, ContenidoDeAyuda> = {
  siniestros: {
    clave: 'siniestros',
    titulo: 'Siniestros',
    resumen:
      'El listado mensual de siniestros, con las mismas columnas de la planilla de siempre, y detrás de cada fila la ficha con todo el seguimiento del trámite.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el listado de siniestros del mes elegido: sucursal, compañía, póliza, cobertura, asegurado, patente, fecha de carga, fecha del siniestro, número y observaciones, exactamente como se ve en la planilla de siempre. La fila entera es clicable y abre la ficha completa: la pantalla no se llena de botones sueltos porque lo importante está adentro.',
          'Un siniestro marcado como robo se destaca con una etiqueta roja «ROBO», tanto en el listado como en la ficha: en la agencia un robo se sigue distinto que un choque, y conviene verlo de un vistazo.',
        ],
      },
      {
        titulo: 'Filtrar y contar',
        parrafos: [
          'Arriba se elige el mes, se busca por asegurado, patente, número de siniestro o de póliza, y se puede acotar por sucursal, compañía o «Sólo robos». Debajo, una fila de contadores por estado del trámite (Cargado, En trámite, Esperando documentación, Cerrado) funciona también como filtro: tocar uno de ellos muestra sólo los siniestros en ese estado, y tocarlo de nuevo lo vuelve a mostrar todos.',
        ],
      },
      {
        titulo: 'Cargar un siniestro nuevo',
        parrafos: [
          'Con «Cargar siniestro» se abre un formulario rápido, pensado para el momento en que alguien llama recién chocado: se busca al cliente por nombre o por patente y, apenas se elige, la compañía, el número de póliza, la cobertura y la sucursal se completan solas desde esa póliza, para confirmarlas, no para volver a tipearlas. Lo único que hay que escribir es qué pasó (la descripción), el número de siniestro si ya lo tenés, el importe si corresponde, y las dos fechas: la fecha del siniestro (cuándo ocurrió el hecho) y la fecha de carga (por defecto, hoy). El mes en el que aparece el siniestro en el listado es el de la fecha de carga, no el del hecho, así que un choque de fin de mes que se carga unos días después va a figurar en el mes en que se cargó.',
        ],
      },
      {
        titulo: 'La ficha: estado, línea de tiempo, documentos y tareas',
        parrafos: [
          'El estado del trámite tiene cuatro valores fijos: Cargado, En trámite, Esperando documentación y Cerrado. Cambiarlo desde el desplegable de arriba actualiza también la planilla de siempre. Si el siniestro venía con un texto de estado distinto en la planilla original, un aviso lo muestra tal cual estaba, junto a en cuál de los cuatro estados quedó traducido.',
          'La línea de tiempo, en el medio de la ficha, es el relato del trámite: cada observación que se agrega queda fechada y firmada con quién la escribió, y no se puede editar ni borrar después, sólo sumar una nueva. Es lo que hay que mirar para contestar «¿cómo viene lo de tal cliente?» sin tener que llamar a nadie.',
          'Documentos guarda los archivos del siniestro (fotos, denuncia, presupuestos) con «Adjuntar»; quedan guardados en esta computadora y, si hay conexión con Google configurada, se suben además a una carpeta compartida en la nube (si esa subida falla por algún motivo, el archivo local queda igual y la ficha avisa «sólo local»). Tareas junta los pendientes de ese trámite (por ejemplo, «pedir el presupuesto del taller»), con su responsable y su estado, y «Nueva tarea» agrega uno sin salir de la ficha.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Cargado',
        explicacion: 'El siniestro recién se anotó, es el primer estado del trámite.',
      },
      {
        termino: 'En trámite',
        explicacion: 'Se está gestionando con la compañía (peritaje, presupuestos, etcétera).',
      },
      {
        termino: 'Esperando documentación',
        explicacion: 'El trámite está frenado hasta que el cliente entregue algún papel que falta.',
      },
      {
        termino: 'Cerrado',
        explicacion: 'El trámite terminó, sea porque se pagó o porque se resolvió de otra forma.',
      },
      {
        termino: 'Fecha de carga vs. fecha del siniestro',
        explicacion: 'La fecha del siniestro es cuándo ocurrió el hecho; la fecha de carga es cuándo se anotó en el sistema. El listado mensual agrupa por fecha de carga, igual que la planilla de siempre.',
      },
      {
        termino: 'Línea de tiempo',
        explicacion: 'El historial de observaciones del trámite, cada una fechada y firmada. Sólo se agrega, nunca se corrige ni se borra una anterior.',
      },
    ],
  },
}
