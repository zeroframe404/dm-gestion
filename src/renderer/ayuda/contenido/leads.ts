import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_LEADS: Record<string, ContenidoDeAyuda> = {
  leads: {
    clave: 'leads',
    titulo: 'Leads',
    resumen: 'Las consultas que todavía no son clientes: quién preguntó, qué quería asegurar y en qué quedó la charla.',
    secciones: [
      {
        titulo: 'Qué es un lead y por qué no está mezclado con Clientes',
        parrafos: [
          'Un lead es una consulta: alguien llamó, escribió por WhatsApp o se acercó preguntando un precio, pero todavía no es cliente de la agencia. Se separa de Clientes a propósito, porque cargar a alguien como cliente sin que todavía haya contratado nada ensucia la cartera con gente que nunca compró. El módulo Leads es justamente el lugar para esas consultas: se cargan livianas (nombre, teléfono y qué quería) y, si la venta se concreta, se convierten en cliente sin volver a tipear nada.',
        ],
      },
      {
        titulo: 'Las tarjetas y sus filtros',
        parrafos: [
          'Cada consulta es una tarjeta, no una fila de tabla: alcanza con mirarla para saber a quién le falta contestarle y qué quería. El buscador encuentra por nombre, teléfono o lo que se escribió que quería asegurar; los filtros de cómo llegó la consulta y de sucursal dejan tildar varias opciones a la vez. La casilla «Mostrar cerradas» trae también las que ya se ganaron o se perdieron, que por defecto quedan afuera para no ensuciar la vista del día a día.',
          'El estado de cada tarjeta se puede cambiar ahí mismo, sin abrir nada: es lo primero que conviene actualizar apenas cambia algo en la charla.',
        ],
      },
      {
        titulo: 'Nueva consulta y la ficha',
        parrafos: [
          'El formulario de alta es corto a propósito: nombre, teléfono, cómo llegó la consulta, sucursal y qué quiere asegurar alcanza para cargarla; el resto se completa charla a charla. Dentro de la ficha de una consulta se agregan notas con fecha (no se editan ni se borran, sólo se suman, así queda el historial completo de la charla) y se ven los presupuestos y las tareas vinculados a esa persona.',
          'El botón de WhatsApp abre directamente una conversación con el teléfono cargado, y «Editar» corrige cualquier dato sin perder el historial de notas.',
        ],
      },
      {
        titulo: 'Convertir en cliente',
        parrafos: [
          'Es el botón más importante del módulo: cuando la consulta se concreta, «Convertir en cliente» crea el cliente con el nombre, teléfono y demás datos que ya están cargados en el lead, sin tener que volver a escribir nada. Después de convertir, la aplicación ofrece ir directo a cargar la póliza en la ficha de ese cliente recién creado. La consulta original queda marcada como vinculada a ese cliente, con un acceso directo para abrir su ficha.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Estado de la consulta',
        explicacion: 'El momento del embudo en el que está la charla: NUEVO (recién entró), EN CHARLA (se está negociando), COTIZADO (ya se le pasó un precio), GANADO (se convirtió en cliente) o PERDIDO (no prosperó).',
      },
      {
        termino: 'Origen',
        explicacion: 'Cómo llegó la consulta a la agencia: WhatsApp, teléfono, referido de otro cliente, redes sociales, o el que corresponda.',
      },
      {
        termino: 'Convertir en cliente',
        explicacion: 'Crea un cliente nuevo con los datos ya cargados en la consulta, sin volver a tipearlos, y deja la consulta vinculada a esa ficha.',
      },
    ],
  },
}
