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
          'A la izquierda está la lista de segmentos guardados, y arriba de todo «Filtro nuevo» para empezar uno desde cero. Los filtros disponibles son Sucursal, Compañía, Forma de pago y Vencimiento (esta semana, este mes, o ya vencidas), más tres interruptores: «Sólo las impagas», «Sólo a las que todavía no se les avisó» y «Dejar afuera el débito automático» (a quien paga solo con débito no tiene sentido escribirle para que pague).',
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
}
