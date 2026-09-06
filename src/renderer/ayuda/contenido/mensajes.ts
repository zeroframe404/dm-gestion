import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_MENSAJES: Record<string, ContenidoDeAyuda> = {
  mensajes: {
    clave: 'mensajes',
    titulo: 'Mensajes',
    resumen: 'El chat de la agencia: hablarle a un compañero o a un grupo sin salir del programa, con fotos y documentos.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el chat interno de la agencia. A la izquierda están las conversaciones, ordenadas por la última que se movió; a la derecha, la conversación abierta, y abajo la caja para escribir. «Nueva» abre la lista de la gente de la agencia para empezar a hablar con alguien.',
          'Para qué sirve, y por qué no alcanzaba con el celular: lo que se habla por WhatsApp desde el teléfono personal no queda en ningún lado. El que atiende al día siguiente no lo puede buscar, y si esa persona deja la agencia se lleva la conversación con ella. Acá los mensajes son de la agencia: están en su servidor y se ven desde cualquiera de las computadoras.',
        ],
      },
      {
        titulo: 'Entregado y leído',
        parrafos: [
          'Al lado de la hora de cada mensaje propio hay una marca que dice hasta dónde llegó. Un reloj: todavía no salió de esta computadora, porque no hay internet o porque se están subiendo los archivos. Un tilde: el servidor de la agencia ya lo tiene. Dos tildes: la computadora del otro lo bajó. Dos tildes en color: el otro abrió la conversación y lo vio.',
          'En un grupo vale el que menos avanzó: los dos tildes en color quieren decir que lo vieron todos, no que lo vio alguno. Pasando el mouse por encima de la marca aparece el detalle, persona por persona, con la hora.',
          'Un mensaje escrito sin internet no se pierde: queda con el reloj y sale solo cuando la conexión vuelve. Si el servidor lo rechaza, la burbuja lo dice y aparece un «Volver a intentar».',
        ],
      },
      {
        titulo: 'Fotos, videos, audios y documentos',
        parrafos: [
          'Se puede mandar cualquier archivo: fotos, GIF, videos, audios, PDF, planillas, lo que sea. Hay tres formas de sumarlos: arrastrarlos sobre la caja de escribir, pegarlos con Ctrl+V (sirve para las capturas de pantalla) o elegirlos con el clip.',
          'Las fotos se achican antes de mandarse, así una foto de 6 MB sacada con el celular viaja en menos de 1 MB sin que se note la diferencia. Los GIF, los videos, los audios y los documentos van tal cual, sin tocarlos: un GIF achicado dejaría de moverse.',
          'Las fotos y los GIF se ven adentro de la conversación; los videos, los audios y los documentos se muestran con su nombre y su peso, y se abren con el programa de siempre de la computadora. La primera vez que alguien abre un archivo que mandó otra persona, se baja del servidor; después ya queda en esa computadora.',
          'Un mensaje con archivos sale recién cuando los archivos terminaron de subir. Mientras tanto se ve con el reloj. Es a propósito: si saliera antes, del otro lado aparecería una foto que todavía no se puede abrir.',
        ],
      },
      {
        titulo: 'Emojis',
        parrafos: [
          'La carita al lado de la caja abre un cajón de emojis con buscador: escribir «auto», «listo» o «gracias» filtra los que sirven. También se puede usar el teclado de emojis de Windows (la tecla Windows y el punto) o pegar cualquier emoji de otro lado: la caja acepta todo.',
          'Un mensaje que es sólo emojis (hasta seis) se muestra en grande, como en cualquier chat: un pulgar solo en tamaño de texto normal casi no se ve.',
        ],
      },
      {
        titulo: 'Quién ve qué',
        parrafos: [
          'Cada persona ve solamente las conversaciones en las que está. El superadministrador tiene además, en Administración → Registro de mensajes, el registro de todos los mensajes de la agencia, con buscador por persona, por fecha y por texto.',
          'Borrar un mensaje lo saca de la conversación de todos, y en su lugar queda «Se eliminó este mensaje». El texto original sigue en el registro del superadministrador: si borrar borrara de verdad, el registro no serviría para nada.',
          'El módulo se puede limitar por rol desde Administración → Permisos. Con «Sólo ver», una persona lee lo que le mandan y no puede contestar.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Entregado',
        explicacion: 'El mensaje llegó a la computadora de la otra persona y quedó guardado ahí. Se ve como dos tildes.',
      },
      {
        termino: 'Leído',
        explicacion: 'La otra persona abrió la conversación con el mensaje a la vista. Se ve como dos tildes en color.',
      },
      {
        termino: 'En la cola',
        explicacion:
          'El mensaje está escrito y todavía no salió de esta computadora: falta internet o falta que terminen de subir sus archivos. Sale solo, sin que nadie tenga que volver a escribirlo.',
      },
      {
        termino: 'Registro de mensajes',
        explicacion:
          'La pantalla del superadministrador con todos los mensajes de todas las conversaciones de la agencia, incluidos los que se borraron.',
      },
    ],
  },
}
