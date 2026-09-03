import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_MARKETING: Record<string, ContenidoDeAyuda> = {
  'marketing.segmentos': {
    clave: 'marketing.segmentos',
    titulo: 'Marketing → Segmentos',
    resumen: 'Un filtro guardado sobre la cartera del mes, para encontrar rápido a quién avisarle algo y mandarle el mensaje con un clic.',
    secciones: [
      {
        titulo: 'Para qué sirve',
        parrafos: [
          'Un segmento es un filtro sobre la cartera del mes abierto: por ejemplo «los que pagan con débito y vencen esta semana en Lanús», o «los que todavía no pagaron y no se les avisó». Armás el filtro una vez, le ponés un nombre y lo guardás; la próxima vez que lo abrís, se vuelve a calcular sobre los datos de ese momento, así que siempre trae la lista actualizada, no una lista congelada del día que la guardaste.',
        ],
      },
      {
        titulo: 'Cómo se arma un filtro',
        parrafos: [
          'A la izquierda está la lista de segmentos guardados, y arriba de todo «Filtro nuevo» para empezar uno desde cero. Los filtros disponibles son Sucursal, Compañía, Forma de pago, Rama (auto, moto, pick up, camión, scooter, moto eléctrica y trailer) y Vencimiento (esta semana, este mes, o ya vencidas), más tres interruptores: «Sólo las impagas», «Sólo a las que todavía no se les avisó» y «Dejar afuera el débito automático» (a quien paga solo con débito no tiene sentido escribirle para que pague).',
          'Los cuatro primeros dejan tildar varias opciones a la vez: «ATM y Metropol en Dock Sud y Daniel» es un solo segmento, no cuatro. Sin tildar nada, ese filtro no filtra. Y la Rama es la que deja mandarle una campaña a los de moto y a nadie más.',
          'Abajo del filtro elegís con qué mensaje se va a avisar, de los que están guardados en Marketing → Plantillas. Cuando estás conforme con el resultado, «Guardar como segmento» le pone nombre y lo deja disponible para la próxima vez. Si abriste uno guardado y le cambiaste algo, «Guardar cambios» lo actualiza.',
        ],
      },
      {
        titulo: 'La lista y el aviso',
        parrafos: [
          'Abajo aparece la lista de gente que cumple el filtro, con sucursal, compañía, patente, forma de pago, cuánto debe, cuándo vence y si ya se le avisó o no. Cada fila tiene su botón «Avisar», que abre WhatsApp con el mensaje ya escrito, listo para mandar; si a alguien le falta el teléfono cargado, el botón queda apagado y lo dice al pasar el mouse por arriba.',
          'No hay ningún botón para avisarle a todos de una sola vez, y es a propósito: WhatsApp bloquea las cuentas que mandan muchos mensajes seguidos de forma automática, y la que usa la agencia es la misma con la que se atiende todo el día por chat. El segmento ahorra el trabajo de buscar a quién le toca escribirle; el envío en sí sigue siendo un clic por persona, uno por uno.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Segmento',
        explicacion: 'Un filtro guardado sobre la cartera del mes abierto, con un nombre. Cada vez que se abre, se vuelve a calcular con los datos de ese momento.',
      },
      {
        termino: 'Sólo a las que todavía no se les avisó',
        explicacion: 'Deja afuera de la lista a quien ya recibió el mensaje de ese segmento, para no escribirle dos veces sin querer.',
      },
      {
        termino: 'Dejar afuera el débito automático',
        explicacion: 'Excluye a quien paga con débito o tarjeta automática: a esas personas la cuota se les cobra sola y no hace falta avisarles para que paguen.',
      },
    ],
  },
  'marketing.plantillas': {
    clave: 'marketing.plantillas',
    titulo: 'Marketing → Plantillas',
    resumen: 'Los mensajes de WhatsApp que la agencia manda una y otra vez, guardados para no escribirlos de nuevo cada vez.',
    secciones: [
      {
        titulo: 'Qué es una plantilla',
        parrafos: [
          'Es un texto que se reutiliza, con algunos datos que se completan solos según a quién se le manda: el nombre de la persona, la cuota, el vencimiento, la patente o la compañía. Esos datos se escriben entre llaves, por ejemplo «Hola {nombre}, te recordamos que tu cuota de {cuota} vence el {vencimiento}», y al momento de mandar el mensaje la aplicación los reemplaza por los datos reales de esa persona.',
        ],
      },
      {
        titulo: 'La plantilla del aviso de vencimiento',
        parrafos: [
          'Hay una plantilla marcada con la etiqueta «La usa "Avisar"»: es el mensaje que se manda desde el botón «Avisar» de la Cartera y de la Mora. No se puede borrar, porque siempre tiene que haber una; si le cambiás el texto, el «Avisar» de esas pantallas manda el texto nuevo desde el próximo clic. Las demás plantillas se usan desde Marketing → Segmentos, eligiéndolas en el desplegable «Mensaje con el que se avisa».',
        ],
      },
      {
        titulo: 'Cómo se edita y se prueba',
        parrafos: [
          'Cada plantilla tiene su nombre, el texto del mensaje y, al lado, una vista previa que muestra cómo le va a llegar a un cliente inventado, para revisar que quede bien antes de guardar. «Nueva plantilla» crea una para un uso puntual (por ejemplo, un saludo de cumpleaños o un aviso de una promoción). Sólo un administrador o un superadministrador puede crear, editar o borrar plantillas; el resto del equipo las puede ver y usarlas desde los segmentos, pero no cambiarlas.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Variable de plantilla',
        explicacion: 'Un dato entre llaves, como {nombre} o {cuota}, que se reemplaza solo por el dato real de cada persona al momento de escribirle.',
      },
      {
        termino: 'Plantilla fija',
        explicacion: 'La plantilla del aviso de vencimiento, marcada con «La usa "Avisar"»: no se puede borrar porque la usan la Cartera y la Mora.',
      },
    ],
  },

  'marketing.redes': {
    clave: 'marketing.redes',
    titulo: 'Marketing → Redes',
    resumen: 'Publicar en la página de Facebook de una sucursal y en su Instagram, desde el programa.',
    secciones: [
      {
        titulo: 'Qué se hace acá',
        parrafos: [
          'Se elige una foto o un video, se escribe el texto, se marca si va a Facebook o a Instagram, si es para el Feed, un Reel o una Historia, y se publica (o se programa para más adelante). Sale en nombre de la sucursal, igual que si lo publicara alguien desde el teléfono: la diferencia es que queda anotado quién lo publicó y cuándo, y que se puede hacer desde la misma pantalla donde ya estás trabajando.',
          'Cada sucursal tiene su propia cuenta de Facebook e Instagram, separada de las demás. Un administrador o un empleado publica siempre en la de su sucursal; el superadministrador puede elegir cualquiera desde el selector de arriba.',
          'Es de a una publicación por vez, a propósito. No hay envíos masivos: eso es lo que hace que una cuenta termine bloqueada, y la de cada sucursal es la que se usa todo el día.',
        ],
      },
      {
        titulo: 'Vincular la cuenta de una sucursal',
        parrafos: [
          'Sólo lo hace el superadministrador, y sólo una vez por sucursal (no por computadora): el permiso queda guardado y cifrado en el servidor de la agencia, así que cualquier admin o empleado de esa sucursal puede publicar apenas está vinculada, sin tener que hacer nada más.',
          'Al tocar «Vincular cuenta» se abre una ventana de Facebook para ingresar; después, si la cuenta administra más de una página, el programa pregunta cuál usar para esa sucursal.',
          'Para que esto funcione hace falta, antes, que un superadministrador cargue la app de Meta en Administración → Redes sociales. Si todavía no está, esta pantalla te lo dice y no te deja seguir.',
        ],
      },
      {
        titulo: 'Facebook e Instagram no son lo mismo',
        parrafos: [
          'Facebook acepta un posteo de texto solo, texto con una foto, o texto con un video. Instagram siempre necesita una foto o un video: sin archivo no publica, y por eso el botón queda apagado. En el Feed de Instagram sólo se publican fotos; para un video en Instagram hay que elegir Reel o Historia.',
          'Además, Instagram sólo se puede publicar por programa si la cuenta es Business y está vinculada a la página de Facebook. Eso se configura una vez desde Facebook, no desde acá. Si la página no tiene una cuenta así, la pantalla lo dice y el botón de Instagram queda apagado en vez de fallar al publicar.',
          'Las fotos son .jpg o .png de hasta 8 MB; los videos son .mp4 o .mov de hasta 40 MB. Un Reel siempre lleva video; una Historia acepta foto o video, pero dura sólo 24 horas y no se puede programar: sale apenas se toca «Publicar».',
        ],
      },
      {
        titulo: 'Reels, Historias y programar',
        parrafos: [
          'Un Reel es siempre un video, en Facebook o en Instagram. En Instagram, Meta tarda un rato en procesar el video antes de poder publicarlo: por eso un Reel de Instagram siempre queda «Programada» en la lista de abajo un momento, aunque no se haya elegido ninguna fecha, hasta que el servidor termina de subirlo solo.',
          'Programar (el interruptor debajo del texto) deja elegir una fecha y hora futura en vez de publicar al toque: en Facebook lo programa Meta directamente; en Instagram, que no tiene programación propia, el archivo se sube apenas se pide y el servidor lo publica solo cuando llega la hora. Una Historia no se puede programar en ninguna de las dos: son 24 horas, y elegir un horario para eso no tiene sentido.',
        ],
      },
      {
        titulo: 'Cuando algo no sale',
        parrafos: [
          'Todo lo que se intenta queda en la lista de abajo, incluidas las publicaciones que fallaron y el motivo que dio Facebook. Eso es a propósito: el error se pierde apenas cerrás la pantalla, y sin él nadie puede averiguar qué pasó tres días después.',
          'Si aparece «se cortó la conexión con Meta», un superadministrador tiene que volver a vincular la cuenta de esa sucursal: pasa cuando alguien cambió la contraseña de Facebook, le sacó el permiso a la app, o dejó de ser administrador de la página. La vinculación no se borra sola para que se pueda ver el motivo.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Página de Facebook',
        explicacion: 'La cuenta pública de una sucursal, distinta del perfil personal de quien la administra. Es donde se publica.',
      },
      {
        termino: 'Cuenta Business de Instagram',
        explicacion: 'Un tipo de cuenta de Instagram, gratuita, que se vincula a una página de Facebook. Es la única desde la que se puede publicar por programa.',
      },
      {
        termino: 'Vincular',
        explicacion: 'Darle permiso al programa para publicar en nombre de una sucursal. Lo hace el superadministrador, una vez por sucursal, ingresando en Facebook.',
      },
      {
        termino: 'Reel',
        explicacion: 'Una publicación de video corto, pensada para el descubrimiento (le puede llegar a gente que no sigue la cuenta). Siempre lleva un video, nunca una foto.',
      },
      {
        termino: 'Historia',
        explicacion: 'Una foto o un video que dura 24 horas y después desaparece solo. No se puede programar: se publica apenas se toca «Publicar».',
      },
    ],
  },

  'marketing.redes.comentarios': {
    clave: 'marketing.redes.comentarios',
    titulo: 'Marketing → Redes → Comentarios',
    resumen: 'Ver y contestar los comentarios de las publicaciones de Facebook e Instagram de la sucursal.',
    secciones: [
      {
        titulo: 'Cómo llegan los comentarios',
        parrafos: [
          'Los comentarios nuevos aparecen solos, apenas alguien los escribe en Facebook o Instagram: Meta le avisa al servidor de la agencia y de ahí pasan a esta bandeja. No hace falta actualizar nada a mano.',
          'Sólo se ven los comentarios de la cuenta de tu sucursal (el superadministrador puede elegir cualquiera desde el selector de arriba). Contestar, ocultar o eliminar un comentario pide el mismo permiso que publicar.',
        ],
      },
      {
        titulo: 'Contestar, ocultar o eliminar',
        parrafos: [
          'Contestar manda la respuesta directo a Facebook o Instagram, igual que si se escribiera desde ahí. Ocultar no borra el comentario: sólo deja de mostrarse en la publicación, y se puede volver a mostrar en cualquier momento. Eliminar sí lo borra de la red social, y no se puede deshacer.',
          'Cuando Meta no deja hacer alguna de estas tres cosas con un comentario puntual (pasa, por ejemplo, con comentarios muy viejos o de ciertos tipos de publicación), la pantalla lo avisa con un cartel amarillo y dice que hay que hacerlo directamente desde Facebook o Instagram.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Ocultar',
        explicacion: 'Deja de mostrar el comentario en la publicación, sin borrarlo. Se puede volver a mostrar en cualquier momento.',
      },
    ],
  },

  'marketing.redes.mensajes': {
    clave: 'marketing.redes.mensajes',
    titulo: 'Marketing → Redes → Mensajes',
    resumen: 'Ver y contestar los mensajes privados (Messenger e Instagram) de la sucursal.',
    secciones: [
      {
        titulo: 'Cómo funciona',
        parrafos: [
          'A la izquierda está la lista de conversaciones, ordenada por la más reciente; a la derecha, la conversación abierta. Los mensajes nuevos llegan solos, igual que los comentarios: no hace falta actualizar nada a mano.',
          'Sólo se ven las conversaciones de la cuenta de tu sucursal (el superadministrador puede elegir cualquiera desde el selector de arriba). Contestar pide el mismo permiso que publicar.',
        ],
      },
      {
        titulo: 'La ventana de 24 horas',
        parrafos: [
          'Es una regla de Meta, no del programa: si pasaron más de 24 horas desde el último mensaje que mandó la persona, ya no se puede mandar un mensaje libre por acá. Cuando pasa esto, la conversación queda marcada en la lista y aparece un cartel amarillo en vez del cuadro para escribir, diciendo que hay que responder directamente desde Facebook o Instagram.',
          'Apenas la persona vuelve a escribir, la ventana se abre de nuevo sola.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Ventana de 24 horas',
        explicacion: 'El tiempo que da Meta para contestar un mensaje libremente, contado desde el último mensaje que mandó la persona (no desde el último mensaje nuestro).',
      },
    ],
  },

}
