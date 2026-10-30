import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_MI_LINK: Record<string, ContenidoDeAyuda> = {
  miLink: {
    clave: 'miLink',
    titulo: 'Mi link',
    resumen: 'Tu página propia en internet, con tus contactos y las coberturas que ofrecés, y todo lo que te llega desde ella.',
    secciones: [
      {
        titulo: 'Qué es',
        parrafos: [
          'Cada persona de la agencia tiene una página pública en dmartinezseguros.com/p/ y la dirección que elija. Ahí van su nombre, una línea sobre ella, sus contactos y links, y las coberturas que ofrece. El cliente puede pedir una cotización de auto o moto, pedir presupuesto de otro seguro o denunciar un siniestro con fotos, y todo eso llega acá.',
        ],
      },
      {
        titulo: 'La sublista de la barra lateral',
        parrafos: [
          '«Mi página» es el editor: lo que se cambia se guarda solo y se ve tal cual va a quedar. «Solicitudes» son las cotizaciones y presupuestos que te pidieron; «Siniestros», las denuncias, con sus fotos y PDF; «Métricas», cuánta gente entró y qué tocó.',
          'Cada uno ve lo suyo. Un administrador puede elegir en el filtro «Usuario» las de otra persona o las de todos.',
        ],
      },
      {
        titulo: 'Dónde vive',
        parrafos: [
          'La página, las solicitudes y las métricas están en el servidor de la agencia, no en esta computadora: la página la ve cualquiera a cualquier hora, aunque todas las PC estén apagadas. Por eso Mi link necesita conexión: sin internet no se puede editar ni mirar lo que llegó.',
        ],
      },
    ],
    conceptos: [
      { termino: 'Dirección', explicacion: 'Lo que va después de /p/ en tu link. Minúsculas, números y guiones; es única en la agencia.' },
      { termino: 'Publicada', explicacion: 'Si la página se ve en internet. Sin publicar, el link contesta «Esta página no está disponible».' },
    ],
  },
  'miLink.pagina': {
    clave: 'miLink.pagina',
    titulo: 'Mi link → Mi página',
    resumen: 'El editor de tu página: a la izquierda cómo se ve, a la derecha el diseño.',
    secciones: [
      {
        titulo: 'Cómo se edita',
        parrafos: [
          'La vista previa es la página misma: tocá el nombre o la línea de abajo para cambiarlos ahí. Cada bloque (un contacto, una cobertura, un link) se edita, se borra o se mueve desde el propio bloque, y con «+ Agregar» se suman nuevos.',
          'No hay botón de guardar: cada cambio se guarda solo al rato, y arriba dice «Guardando…», «Todo guardado» o «Sin guardar». Si la misma página se estaba editando en otra computadora, el programa avisa y vuelve a cargar lo último guardado.',
        ],
      },
      {
        titulo: 'El diseño',
        parrafos: [
          'El panel «Diseño» elige el color, el estilo (Sello, Botones o Marca) y lo que va detrás de la foto o las iniciales. También si se usa la foto del perfil y si se muestra el botón «Denunciar un siniestro».',
        ],
      },
      {
        titulo: 'Publicar y compartir',
        parrafos: [
          'Mientras no se publica, sólo la ves vos. «Publicar» la pone en internet; «Despublicar» la saca sin borrar nada. «Compartir» copia el link para mandarlo por WhatsApp o ponerlo en Instagram, y «Ver mi página» la abre en el navegador sin contar la visita.',
          'La dirección se puede cambiar con «Dirección», pero el link viejo deja de funcionar: conviene elegirla bien la primera vez.',
        ],
      },
    ],
  },
  'miLink.solicitudes': {
    clave: 'miLink.solicitudes',
    titulo: 'Mi link → Solicitudes',
    resumen: 'Las cotizaciones y presupuestos que te pidieron desde tu página.',
    secciones: [
      {
        titulo: 'El listado',
        parrafos: [
          'Cada fila es un pedido: de auto o moto (por el cotizador de la página, con marca, modelo, versión y año) o de otro seguro (por el formulario). Se filtra por fecha, estado y texto; un administrador también por usuario.',
        ],
      },
      {
        titulo: 'El seguimiento',
        parrafos: [
          'Al tocar una fila se abre el pedido completo. Ahí se cambia el estado (Nueva, Contactada, Cotizado, Cerrado, Descartada) y se anota lo que haga falta; lo ve cualquiera de la agencia que pueda verlo.',
          '«WhatsApp» abre la conversación con el cliente, «Cotizar en el Multicotizador» lo abre con el vehículo ya cargado (sólo auto y moto) y «Pasar a Leads» lo suma como lead.',
        ],
      },
    ],
  },
  'miLink.siniestros': {
    clave: 'miLink.siniestros',
    titulo: 'Mi link → Siniestros',
    resumen: 'Las denuncias de siniestro que te mandaron desde tu página, con sus fotos y PDF.',
    secciones: [
      {
        titulo: 'Qué llega',
        parrafos: [
          'El cliente completa qué pasó, cuándo y dónde, la patente, si hubo un tercero o lesionados, y adjunta fotos o PDF. Al tocar una fila se ve todo lo que respondió; cada adjunto se abre con el programa de la computadora.',
          'Estas denuncias no son todavía siniestros de la cartera: una vez cargado en la compañía y en el módulo Siniestros, se marca «Cargada».',
        ],
      },
    ],
  },
  'miLink.metricas': {
    clave: 'miLink.metricas',
    titulo: 'Mi link → Métricas',
    resumen: 'Cómo le va a tu página: visitas, clicks y de dónde vienen.',
    secciones: [
      {
        titulo: 'Qué se cuenta',
        parrafos: [
          'Las visitas a la página en los últimos 7, 30 o 90 días, los visitantes (el mismo que vuelve el mismo día cuenta una vez) y los clicks en cada contacto, cobertura o link. Abajo, qué tocan, de dónde llegan (Google, Instagram, WhatsApp…) y con qué entran (celular o computadora).',
          'Las veces que la abrís vos con «Ver mi página» no cuentan, y tampoco los programas que leen la página para armar la vista previa de un link.',
        ],
      },
    ],
  },
}
