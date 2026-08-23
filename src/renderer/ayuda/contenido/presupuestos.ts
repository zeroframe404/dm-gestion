import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_PRESUPUESTOS: Record<string, ContenidoDeAyuda> = {
  presupuestos: {
    clave: 'presupuestos',
    titulo: 'Presupuestos',
    resumen: 'Las compañías cotizadas para cada vehículo, el mensaje de WhatsApp listo para mandar y el PDF para imprimir.',
    secciones: [
      {
        titulo: 'El listado',
        parrafos: [
          'Cada fila es un presupuesto: para quién es, el vehículo, cuántas opciones se cotizaron, el precio más barato de todas y en qué estado está. El buscador encuentra por cliente, patente o número de presupuesto; los filtros acotan por estado y sucursal. Por defecto sólo se ven las versiones vigentes de cada presupuesto: la casilla «Con versiones anteriores» trae también las viejas, para cuando hace falta encontrar un precio que se pasó hace un tiempo.',
          '«Nuevo presupuesto» arranca uno desde cero; también se puede empezar uno desde la ficha de una consulta o de un cliente con «Nuevo presupuesto» o «Presupuestar», y en ese caso ya viene con los datos de esa persona puestos.',
        ],
      },
      {
        titulo: 'Cargar las opciones cotizadas',
        parrafos: [
          'El formulario tiene los datos de quién es (nombre, teléfono, DNI) y del vehículo (patente, marca, modelo, año, tipo de uso), y abajo una fila por cada compañía cotizada: nombre de la compañía, cobertura, precio y un comentario opcional. Se va agregando una fila atrás de otra sin tener que tocar ningún botón de «agregar»: siempre queda una fila vacía lista para completar.',
        ],
      },
      {
        titulo: 'La ficha: mandar, imprimir y marcar la elegida',
        parrafos: [
          'Adentro de un presupuesto ya cargado, «Enviar por WhatsApp» arma el mensaje completo (con el saludo, el vehículo y cada opción con su precio) y lo abre listo para mandar por WhatsApp, sin tener que escribir nada a mano: nunca se manda solo, siempre lo revisás antes de apretar enviar en WhatsApp. «Guardar en PDF» y «Imprimir» generan el mismo presupuesto en papel A4, prolijo, para el cliente que lo prefiere así.',
          'Cuando el cliente elige una opción, «Aceptar» en esa fila la marca como la ganadora y deja el presupuesto en estado ACEPTADO; si además esa persona todavía no era cliente, se ofrece convertirla. Si en cambio no prospera, «No lo tomó» pide un motivo y lo pasa a RECHAZADO.',
        ],
      },
      {
        titulo: 'Las versiones',
        parrafos: [
          'Mientras un presupuesto está en BORRADOR, guardar los cambios pisa lo que había: todavía no se le mandó nada al cliente, así que no hace falta guardar historial. Pero apenas se envió una vez (quedó en ENVIADO, ACEPTADO o RECHAZADO) y se necesita corregir algo, guardar crea una versión nueva en vez de pisar la anterior: la de ayer queda intacta, con el mismo número de presupuesto y un «v2» al lado. Así, si el cliente dice «pero el precio que me mandaste era otro», se puede abrir la versión vieja y compararla con la de hoy sin que ninguna de las dos se haya perdido.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'BORRADOR',
        explicacion: 'El presupuesto se está armando y todavía no se le mandó nada al cliente. Guardar en este estado pisa los cambios sin crear versión nueva.',
      },
      {
        termino: 'ENVIADO',
        explicacion: 'Ya se le mandó el mensaje de WhatsApp al cliente. A partir de acá, cualquier corrección crea una versión nueva en vez de pisar ésta.',
      },
      {
        termino: 'ACEPTADO / RECHAZADO',
        explicacion: 'El cliente eligió una de las opciones cotizadas (ACEPTADO, con la opción ganadora marcada) o no avanzó con ninguna (RECHAZADO, con el motivo cargado).',
      },
      {
        termino: 'Versión',
        explicacion: 'Cada corrección de un presupuesto ya enviado queda guardada como una versión nueva (v2, v3…), sin borrar la anterior, para poder comparar precios de distintos momentos.',
      },
      {
        termino: 'Vigente',
        explicacion: 'La versión más reciente de un presupuesto, la que se sigue editando. Las versiones anteriores quedan de sólo consulta.',
      },
    ],
  },
}
