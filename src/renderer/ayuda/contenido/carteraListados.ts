import type { ContenidoDeAyuda } from '../tipos'

// La ayuda de los listados de Cartera. «cartera.planilla» (la planilla del mes) ya está en cartera.ts.
export const AYUDA_CARTERA_LISTADOS: Record<string, ContenidoDeAyuda> = {
  'cartera.asegurados': {
    clave: 'cartera.asegurados',
    titulo: 'Cartera → Asegurados',
    resumen: 'El listado de los clientes asegurados de la cartera, para buscarlos, exportarlos y abrir su ficha.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es la lista de todos los clientes de la agencia en formato de tabla: nombre completo, documento (con su tipo), email, celular y el productor que los atiende. Es la misma gente que ves en Clientes; acá sólo cambia la forma de mirarla.',
          'Arriba, «Filtros de Búsqueda» está plegado para que la tabla ocupe el lugar: tocá «Mostrar filtros» para buscar y «Ocultar filtros» para volver a achicarlo. Abajo de la tabla hay un paginador de diez en diez.',
        ],
      },
      {
        titulo: 'Qué podés hacer',
        parrafos: ['El nombre de cada cliente es un enlace: te lleva a su ficha en Clientes, con sus pólizas, pagos y siniestros.'],
        lista: [
          'Exportar Excel: baja a una planilla lo que estás viendo con los filtros puestos, no sólo la página actual.',
          'Crear Cliente: abre el mismo formulario de alta que Clientes.',
          'Fusionar: para juntar dos fichas que son la misma persona. Usa la misma lógica de Cartera → Duplicados; si no está habilitado, ahí mismo lo podés hacer.',
          'Asignar Vendedores: todavía no está disponible. El botón se ve apagado y explica por qué.',
        ],
      },
    ],
  },
  'cartera.grupos': {
    clave: 'cartera.grupos',
    titulo: 'Cartera → Grupos',
    resumen: 'Agrupar clientes que van juntos (una familia, una empresa y sus socios). Todavía no está disponible.',
    secciones: [
      {
        titulo: 'Por qué dice «Próximamente»',
        parrafos: [
          'La idea es poder armar grupos de clientes para verlos y renovarlos en conjunto. Para eso primero hay que definir cómo se arman esos grupos y cargarlos, y hoy el programa no tiene dónde guardarlos.',
          'Mientras tanto, cada cliente se sigue trabajando por separado desde Clientes. Cuando esté lista, esta entrada del menú se va a abrir sola, sin que tengas que hacer nada.',
        ],
      },
    ],
  },
  'cartera.polizas': {
    clave: 'cartera.polizas',
    titulo: 'Cartera → Pólizas',
    resumen: 'La cartera de pólizas en una tabla: compañía, número y ramo, cliente, riesgo, vigencia, estado y productor.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es un listado para consultar la cartera de pólizas. Cada renglón muestra la compañía, el número de póliza con su ramo debajo, el cliente, el riesgo asegurado (por ejemplo el vehículo), la vigencia con la fecha de inicio arriba y la de fin abajo, el estado y el productor.',
          'El estado se lee con un chip de color: «Vigente» en verde, «Programada» (empieza más adelante) en azul, y otros colores para las que ya no corren. Abrís «Mostrar filtros» para acotar la búsqueda y «Exportar Excel» para bajar lo que filtraste.',
        ],
      },
      {
        titulo: 'Qué no está todavía',
        parrafos: [
          '«Crear Endoso» se ve apagado: el programa todavía no guarda endosos como tales, así que no se puede ofrecer el botón de verdad. Para cargar o corregir una póliza, usá el módulo Pólizas.',
        ],
      },
    ],
  },
  'cartera.siniestros': {
    clave: 'cartera.siniestros',
    titulo: 'Cartera → Siniestros',
    resumen: 'Los siniestros de la cartera en una tabla, con su póliza, asegurado, estado y productor.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Lista los siniestros de toda la cartera: compañía, número de siniestro con su tipo debajo, la póliza (número y ramo), la fecha, el asegurado, el riesgo, el estado y el productor. El estado «Abierto» va en verde.',
          '«Exportar Excel» baja lo que estás viendo. «Crear Siniestro» abre el mismo alta que el módulo Siniestros, donde además están la ficha completa con observaciones, documentos y tareas.',
        ],
      },
    ],
  },
  'cartera.vencimientos': {
    clave: 'cartera.vencimientos',
    titulo: 'Cartera → Vencimientos',
    resumen: 'Pólizas próximas a vencer en un rango de fechas, para renovar o refacturar a tiempo.',
    secciones: [
      {
        titulo: 'Cómo se usa',
        parrafos: [
          'Lo primero es elegir el «Rango de Fechas de Vencimiento», que es obligatorio: sin él la tabla no muestra nada y te lo avisa. Los atajos de mes (por ejemplo «Mes siguiente») cargan las dos fechas de una.',
          'Después podés acotar por compañías, ramas, productores y formas de pago. Los filtros están desplegados desde el principio porque casi siempre se usan.',
        ],
      },
      {
        titulo: 'Opciones adicionales',
        parrafos: ['Son botones que se prenden y se apagan, y se combinan con los filtros de arriba.'],
        lista: [
          'Incluir pólizas anuladas: por defecto no aparecen.',
          'Excluir renovadas/refacturadas: deja sólo las que todavía no se renovaron, que son las que hay que trabajar.',
          'Solo renovadas/refacturadas: lo contrario, para ver qué ya se resolvió.',
          'Ojo con «Renovó»: se sabe por el enganche que deja el botón Renovar en la computadora donde se apretó, y ese dato no viaja por la hoja. Si la renovación se hizo en otra PC con número nuevo, acá puede figurar como «No».',
          'Excluir refacturación mensual y el filtro por Tipo de Vencimiento (Renovación o Refacturación): hoy no están disponibles y se ven apagados.',
          'El filtro por Grupos tampoco está todavía, porque los grupos de clientes aún no existen.',
        ],
      },
      {
        titulo: 'La tabla',
        parrafos: [
          'Muestra compañía, póliza, cliente, fecha de vencimiento, tipo, quién la renovó o refacturó, riesgo y productor. «Exportar Excel» baja lo que se ve.',
        ],
      },
    ],
    conceptos: [
      { termino: 'Renovación', explicacion: 'La póliza llega al final de su vigencia y se emite una nueva para el período siguiente.' },
      { termino: 'Refacturación', explicacion: 'Se vuelve a facturar una póliza dentro de su vigencia (por ejemplo cuando cambia el premio). Todavía no se distingue de la renovación en el programa.' },
    ],
  },
  'cartera.indiceAumentos': {
    clave: 'cartera.indiceAumentos',
    titulo: 'Cartera → Índice de Aumentos',
    resumen: 'Cuánto aumentó cada póliza en cada renovación. Todavía no está disponible.',
    secciones: [
      {
        titulo: 'Por qué dice «Próximamente»',
        parrafos: [
          'Para calcular cuánto subió cada póliza hace falta el historial de endosos y de premios de cada renovación, y el programa todavía no lo guarda. Sin esos datos cualquier número sería inventado, así que mejor no mostrar nada.',
          'Cuando se empiece a guardar ese historial, esta pantalla se va a poder armar.',
        ],
      },
    ],
  },
  'cartera.rubrica': {
    clave: 'cartera.rubrica',
    titulo: 'Cartera → Rúbrica Digital',
    resumen: 'El libro de rúbrica digital para la Superintendencia de Seguros. Todavía no está disponible.',
    secciones: [
      {
        titulo: 'Por qué dice «Próximamente»',
        parrafos: [
          'La Superintendencia de Seguros de la Nación pide un archivo con un formato oficial (XML). Hasta no tener esa especificación en la mano no se puede generar un archivo que la SSN acepte, y un archivo "parecido" sería peor que ninguno.',
          'Cuando esté la especificación, la rúbrica se va a poder armar desde acá.',
        ],
      },
    ],
  },
}
