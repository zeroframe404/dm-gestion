import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_COMPANIAS: Record<string, ContenidoDeAyuda> = {
  'companias.organizadores': {
    clave: 'companias.organizadores',
    titulo: 'Compañías → Organizadores',
    resumen: 'La lista de gente a la que hay que escribirle para pedir un precio, en el orden en que se le escribe.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Cuando entra una consulta y hay que cotizar, el mensaje con los datos del vehículo se le manda a varios organizadores, uno atrás del otro. Esta pantalla es esa lista: quién es cada uno, qué compañías cotiza, a qué teléfono se le escribe, en qué horario contesta y qué conviene recordar antes de mandarle el mensaje.',
          'La lista se lee de arriba abajo. El número de la izquierda es el orden en que se les escribe, y lo decide la agencia: quién contesta más rápido, quién viene con mejor precio este mes. No es alfabético a propósito.',
        ],
      },
      {
        titulo: 'Escribirle a uno',
        parrafos: [
          'En la columna del teléfono, el botón verde «Escribir» abre WhatsApp con ese organizador. No manda ningún mensaje solo: abre la charla y el mensaje lo escribe quien está atendiendo, porque cada cotización pide datos distintos.',
          'Si un organizador no tiene teléfono cargado, el botón no aparece y en su lugar queda una raya: ahí falta el dato, no está roto.',
        ],
      },
      {
        titulo: 'Cargar, ordenar y apagar',
        parrafos: [
          'Los organizadores los carga el superadministrador con «Nuevo organizador». Las flechas de cada fila lo suben o lo bajan de lugar. Con el buscador puesto las flechas desaparecen: mover una fila de una lista filtrada la movería respecto de otras que no están a la vista.',
          'Cuando se deja de trabajar con alguien conviene editarlo y destildar «Se le pide precio» en lugar de borrarlo: queda en la lista, apagado y tachado, con su teléfono, para el día que haya que volver a buscarlo. Borrar es para el que se cargó por error.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Organizador',
        explicacion:
          'La persona o la oficina por la que la agencia cotiza y coloca pólizas de una compañía. No es la compañía: es quien atiende del otro lado y a quien se le pide el precio.',
      },
    ],
  },

  'companias.precios': {
    clave: 'companias.precios',
    titulo: 'Compañías → Precios',
    resumen: 'La lista de precios de todas las compañías, cobertura por cobertura, con la más barata siempre arriba.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es la lista de precios de referencia: cuánto sale cada cobertura en cada compañía. Arriba de la tabla están las coberturas cargadas como botones; se toca una y la tabla queda con los precios de esa cobertura. La pantalla abre en RESPONSABILIDAD CIVIL, que es la que más se consulta.',
          'Las filas van de la más barata a la más cara, y la primera lleva la etiqueta verde «el más barato». Es la respuesta a la pregunta que llega de verdad: no «cuánto sale en tal compañía», sino «cuál es la más barata para esto».',
          'La columna «Rama» dice a qué se le cotiza ese precio (AUTO, MOTO, PICK UP). Vacía quiere decir que el precio vale para cualquiera.',
        ],
      },
      {
        titulo: 'Desde cuándo rige cada precio',
        parrafos: [
          'La columna «Rige desde» es la más importante de la pantalla. Un precio de hace cuatro meses se lee exactamente igual que uno de hoy, y pasarlo por bueno es el error caro de acá.',
          'Un precio cargado hace más de sesenta días aparece con la etiqueta amarilla «hace tantos días»: antes de pasarlo, conviene volver a preguntar. Un precio sin fecha aparece con la etiqueta «sin fecha», que significa lo mismo: no se puede saber si sigue sirviendo.',
        ],
      },
      {
        titulo: 'Cargar y corregir',
        parrafos: [
          'Los precios los carga el superadministrador. Cuando una compañía cambia el importe, lo que corresponde es EDITAR la fila que ya está, no cargar otra: al editarla se pone la fecha nueva y queda a la vista que el precio es de hoy. Cargar una segunda fila para la misma compañía y la misma cobertura no se puede: la aplicación avisa y ofrece editar la que ya existe.',
          'El importe se escribe como venga: «18500» y «18500,50» valen los dos.',
        ],
      },
    ],
  },

  'companias.antiguedad': {
    clave: 'companias.antiguedad',
    titulo: 'Compañías → Antigüedad',
    resumen: 'Se escribe el año del vehículo y sale, compañía por compañía, qué coberturas le pueden vender.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Se pone el año del vehículo que se está por cotizar y abajo aparece una tarjeta por compañía: arriba, en verde, las coberturas que le toman a ese modelo; abajo, tachadas, las que no. Es la pantalla que se mira con el cliente esperando del otro lado del teléfono.',
          'El año se puede escribir con las cuatro cifras («2011») o con las dos últimas («11»). Mientras el año esté a medias, o si no se entiende, las tarjetas muestran la oferta entera de cada compañía sin marcar nada: sirve igual para saber qué vende cada una.',
          'Las compañías vienen ordenadas por cuántas coberturas le ofrecen a ese vehículo: la de arriba es por la que conviene empezar a llamar.',
        ],
      },
      {
        titulo: 'De dónde salen los límites',
        parrafos: [
          'De la misma matriz que avisa al cargar una póliza, que se llena en Cartera → Reglas de cobertura. Es a propósito: si esta pantalla tuviera su propia lista, habría dos respuestas distintas para la misma pregunta y la que frena una emisión sería la otra.',
          'Por eso acá no se carga nada. Si un límite está mal o falta, el enlace del pie abre directamente esa pantalla de Cartera.',
        ],
      },
      {
        titulo: 'Las compañías que no aparecen',
        parrafos: [
          'Cuando una compañía trabaja en la cartera y no tiene ninguna regla cargada, no puede aparecer en las tarjetas: no hay con qué contestar por ella. En vez de dejarla en silencio, la pantalla la nombra arriba en un aviso amarillo.',
          'Que una compañía esté en ese aviso NO quiere decir que no tome el vehículo: quiere decir que nadie cargó todavía hasta qué modelo lo toma. Es la diferencia entre «no» y «no sé», y confundirlas hace perder una venta.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Antigüedad',
        explicacion:
          'Los años que tiene el vehículo, contados desde el año de fabricación hasta hoy. Cada compañía pone su tope por cobertura: cuanto más completa la cobertura, menos antigüedad acepta.',
      },
    ],
  },

  'companias.gruas': {
    clave: 'companias.gruas',
    titulo: 'Compañías → Grúas',
    resumen: 'Cuántos kilómetros de remolque da cada compañía según la cobertura contratada.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Una tabla con las compañías en las filas y las coberturas en las columnas. En cada cruce, los kilómetros de grúa que da esa compañía con esa cobertura contratada, y debajo lo que entra además del remolque (cambio de rueda, batería, cerrajería).',
          'Está armada así, y no como un listado, porque lo que se compara es una compañía contra otra: «ésta te da 200 kilómetros, aquélla 50». Sirve para vender y sirve el día del problema, cuando llaman desde la ruta preguntando hasta dónde los llevan.',
        ],
      },
      {
        titulo: 'Ilimitada no es lo mismo que sin cargar',
        parrafos: [
          'Una celda que dice «ilimitada» significa que esa compañía no pone tope de kilómetros en esa cobertura. Una celda que dice «sin cargar» significa que nadie preguntó todavía: no se sabe.',
          'Son dos cosas distintas y la pantalla las escribe distinto a propósito. Prometer un remolque que no existe es peor que decir «déjame que averiguo».',
        ],
      },
      {
        titulo: 'Cargar y corregir',
        parrafos: [
          'Las carga el superadministrador. En cada celda vacía hay un botón «Cargar» que abre el formulario con la compañía y la cobertura ya puestas; en las cargadas, los botones de editar y borrar.',
          'Para que una grúa quede como ilimitada, el campo de kilómetros se deja vacío. Si una compañía dejó de dar remolque en una cobertura, conviene dejar la fila con la aclaración en observaciones en vez de borrarla: así queda escrito que la pregunta ya se hizo.',
        ],
      },
    ],
  },

  'companias.cobertura': {
    clave: 'companias.cobertura',
    titulo: 'Compañías → Cobertura',
    resumen: 'Qué ampara cada cobertura y qué deja afuera, cláusula por cláusula.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es la lista que contesta la pregunta más común del mostrador: «¿esto lo cubre?». Se elige la cobertura arriba y aparecen dos columnas: a la izquierda, en verde, lo que ampara; a la derecha, en rojo, lo que NO.',
          'Las exclusiones están en la misma pantalla a propósito y son la mitad de la respuesta útil. Decir «terceros completo no cubre el granizo» en el momento evita un siniestro rechazado seis meses después.',
          'Debajo de cada cláusula puede haber un detalle: el límite, la franquicia o la condición. Es lo que hay que aclarar al contestar.',
        ],
      },
      {
        titulo: 'Buscar en todas las coberturas',
        parrafos: [
          'Con el buscador se busca en TODAS las coberturas a la vez, no sólo en la elegida: escribiendo «granizo» aparece dónde está amparado y dónde no, y cada cláusula muestra de qué cobertura es. Es la manera rápida de contestar cuando la pregunta llega al revés («¿en cuál me cubre el granizo?»).',
        ],
      },
      {
        titulo: 'Cláusulas de todas y cláusulas de una compañía',
        parrafos: [
          'Una cláusula sin compañía vale para todas: es el caso normal, porque las coberturas se arman casi igual en todo el mercado. Cargar la misma lista de quince cláusulas para cada una de las catorce compañías la volvería imposible de mantener al día, que es la manera más segura de que termine mintiendo.',
          'La compañía se carga sólo cuando es la excepción, y esas cláusulas aparecen marcadas con una etiqueta amarilla «sólo tal compañía».',
        ],
      },
      {
        titulo: 'Si la pantalla está vacía',
        parrafos: [
          'Esta lista arranca vacía y se llena a mano, cláusula por cláusula: no se importa de ningún lado. Mientras esté vacía, la pantalla lo dice en lugar de aparentar que esa cobertura no ampara nada.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Cláusula',
        explicacion:
          'Cada cosa concreta que una cobertura ampara o deja afuera: robo total, robo parcial, incendio, granizo, cristales, daños por accidente.',
      },
      {
        termino: 'Exclusión',
        explicacion: 'Lo que la cobertura NO ampara. Se carga en esta misma lista, marcado como «No ampara».',
      },
    ],
  },
}
