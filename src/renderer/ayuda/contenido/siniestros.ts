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
      {
        titulo: 'El abogado y los datos del tercero',
        parrafos: [
          'Debajo de los datos del siniestro está «Abogado»: un renglón libre para el estudio, el nombre y el teléfono de quien lleve lo legal, si hay alguien. Se corrige con doble clic, igual que el resto.',
          'Al lado, la tarjeta «El tercero» junta lo que hace falta para reclamarle al otro auto: su compañía, un teléfono y la patente. «Terceros lesionados» es un desplegable de tres posiciones —«Todavía no se sabe», «No hubo lesionados» y «Sí, hubo lesionados»— porque de eso depende que el legajo lleve constancia médica; cuando se marca que sí, aparece un renglón más para anotar quién se lesionó y a qué hospital fue.',
          'Estos datos no tienen columna en la planilla de siempre, así que viven en DM Gestión: cada vez que se cambia uno queda su renglón en la línea de tiempo, que es lo que sí viaja a la columna OBSERVACIONES y llega a las demás computadoras.',
        ],
      },
      {
        titulo: 'Adjuntar documentos por categoría',
        parrafos: [
          '«Adjuntar» pregunta primero de qué documento se trata y después abre el explorador de archivos. Las categorías son las que pide la compañía para armar el legajo: Denuncia, Certificado de cobertura, Fotos del siniestro, Registro de conducir, DNI, Cédula verde, Denuncia policial, Constancia médica y Otras documentaciones. La categoría elegida vale para todos los archivos de esa tanda, así que las seis fotos del choque se eligen juntas y quedan las seis como «Fotos del siniestro».',
          '«Otras documentaciones» pide además escribir cuál (un presupuesto del taller, un telegrama, un acta de la compañía): un archivo sin nombre propio, dentro de un mes, es un archivo que nadie sabe para qué está. Cada documento muestra su categoría al costado en la lista, y los que se habían adjuntado antes de que existieran las categorías figuran como «Sin categoría».',
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
        termino: 'Terceros lesionados',
        explicacion:
          'Si hubo heridos en el otro auto. Queda en «Todavía no se sabe» hasta que alguien lo confirme, y un «Sí» es lo que obliga a pedir la constancia médica.',
      },
      {
        termino: 'Categoría del documento',
        explicacion:
          'Qué es cada archivo adjunto (denuncia, cédula verde, constancia médica…). Se elige antes de subirlo y sirve para ver de un vistazo qué papel falta en el legajo.',
      },
      {
        termino: 'Línea de tiempo',
        explicacion: 'El historial de observaciones del trámite, cada una fechada y firmada. Sólo se agrega, nunca se corrige ni se borra una anterior.',
      },
    ],
  },
}
