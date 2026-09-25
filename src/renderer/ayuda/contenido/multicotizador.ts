import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_MULTICOTIZADOR: Record<string, ContenidoDeAyuda> = {
  multicotizador: {
    clave: 'multicotizador',
    titulo: 'Multicotizador',
    resumen: 'Un auto o una moto cotizados en todas las compañías con API al mismo tiempo, comparados por lo que cubre cada cobertura.',
    secciones: [
      {
        titulo: 'Qué hace',
        parrafos: [
          'Se cargan los datos del vehículo, la zona y el pago una sola vez, y el programa le pide precio a cada compañía que tenga API cargada en API Aseguradoras, todas a la vez. Cada compañía tiene su tarjeta: se llena apenas contesta, sin esperar a la más lenta, y si una está caída las demás cotizan igual.',
          'Hoy la única compañía con API es Galeno. Cada compañía que se sume aparece sola en la lista de «Compañías» y en los resultados, sin cambiar nada de cómo se usa esta pantalla.',
        ],
      },
      {
        titulo: 'Los datos que se piden',
        parrafos: ['Son los que cualquier compañía necesita para cotizar un auto o una moto:'],
        lista: [
          'El vehículo, elegido del catálogo de la agencia (Administración → Catálogo de vehículos, la tabla de la DNRPA). Cada compañía lo busca en su propio catálogo. Si se carga a mano, conviene escribir también la versión (por ejemplo «1.6 XEI CVT»).',
          'Uso, 0 km, GNC y rastreo satelital: cambian la prima.',
          'La suma asegurada, sólo si se quiere una distinta de la que dice cada compañía para ese vehículo.',
          'El código postal y la localidad donde se guarda el vehículo: definen la zona de riesgo. Al escribir el código postal aparecen las localidades que conocen las compañías.',
          'La vigencia y el medio de pago (tarjeta, débito automático o efectivo): cada compañía elige sola su forma de pago que coincide.',
          'Para quién: es opcional para mirar precios, y hace falta el nombre para armar el presupuesto. Si ya es cliente, conviene buscarlo: el presupuesto queda en su ficha.',
        ],
      },
      {
        titulo: 'La tarjeta de cada compañía y sus ajustes',
        parrafos: [
          'Cada compañía pide cosas que sólo existen en su sistema: su plan comercial, su modo de facturación, su código de localidad, la versión del vehículo en su catálogo. No se preguntan en el formulario: cada una las elige sola con un criterio razonable (la forma de pago que coincide con el medio elegido, el modo mensual, la localidad con ese nombre).',
          'Con «Ajustes de …» se ve qué eligió y se puede cambiar cualquiera: al cambiarlo se vuelve a cotizar sólo en esa compañía. Si una compañía no puede decidir algo sola —por ejemplo, hay dos versiones parecidas y no sabe cuál es—, la tarjeta se pone amarilla y pide elegirlo; no adivina, porque cotizar otra versión es cotizar otro vehículo.',
          'Lo que se elige a mano se conserva para la próxima cotización, salvo lo que depende del vehículo o de la zona (la versión, la localidad), que se olvida al cotizar otro vehículo.',
        ],
      },
      {
        titulo: 'El comparativo',
        parrafos: [
          'Todas las coberturas de todas las compañías van juntas, agrupadas por lo que cubren y de la más barata a la más cara. Cada compañía llama distinto a lo mismo («C1», «Terceros Completo Plus»…), así que el programa las ordena en las categorías de siempre: responsabilidad civil, terceros con pérdida total, terceros completo, terceros completo premium y todo riesgo. La más barata de cada categoría va marcada, y arriba hay un resumen con el mejor precio de cada una.',
          'La categoría la decide el programa leyendo el nombre de la cobertura. Si alguna cae en «Otras», es que la compañía la nombra de una forma que no se reconoce: se compara igual, pero conviene mirarla.',
        ],
      },
      {
        titulo: 'Armar el presupuesto o emitir',
        parrafos: [
          'Tildando las coberturas que se le quieren ofrecer al cliente (hasta doce) aparece abajo «Armar presupuesto»: crea el presupuesto de siempre, con esas opciones y los datos del vehículo, y lo abre en Presupuestos, donde salen el mensaje de WhatsApp y el PDF como con cualquier otro.',
          'En las compañías que lo permiten (hoy, Galeno) cada cobertura tiene «Emitir…»: emite la póliza en la compañía sin salir de la pantalla, con el mismo formulario que se usa desde Presupuestos. Armar el presupuesto y emitir piden permiso para editar Presupuestos; cotizar, sólo para ver el Multicotizador.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Categoría de cobertura',
        explicacion:
          'El escalón de lo que cubre, igual para todas las compañías: responsabilidad civil, terceros con pérdida total, terceros completo, terceros completo premium (con granizo u otros adicionales) y todo riesgo.',
      },
      {
        termino: 'Premio',
        explicacion: 'Lo que paga el cliente por toda la vigencia, con impuestos. Es el número que se compara entre compañías.',
      },
      {
        termino: 'Ajustes de la compañía',
        explicacion: 'Lo que sólo existe en el sistema de cada compañía (su plan comercial, su código de localidad, su versión del vehículo). Lo elige sola y se puede cambiar desde su tarjeta.',
      },
    ],
  },
}
