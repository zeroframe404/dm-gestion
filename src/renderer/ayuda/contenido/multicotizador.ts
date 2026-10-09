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
          'Hoy cotizan Galeno y ATM, cada una con la cuenta cargada en API Aseguradoras. Cada compañía que se sume aparece sola en la lista de «Compañías» y en los resultados, sin cambiar nada de cómo se usa esta pantalla.',
        ],
      },
      {
        titulo: 'Los datos que se piden',
        parrafos: ['Son los que cualquier compañía necesita para cotizar un auto o una moto:'],
        lista: [
          'El vehículo, elegido del catálogo de la agencia (Administración → Catálogo de vehículos, que sale de las APIs de las aseguradoras). Si el vehículo salió del catálogo de una compañía, esa compañía cotiza la versión exacta; las demás lo buscan en su propio catálogo. Si se carga a mano, conviene escribir también la versión (por ejemplo «1.6 XEI CVT»).',
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
          'Los ajustes comerciales —el modo de facturación, las cuotas, la forma de pago, la bonificación, el recargo administrativo (RA) y la cláusula de ajuste— están siempre a la vista en la tarjeta de la compañía: son lo que define el precio y lo mismo que su web pide arriba de la grilla. Al cambiar cualquiera se vuelve a cotizar sólo en esa compañía.',
          'Con «Más ajustes de …» se ve el resto, lo técnico: el plan comercial, el tipo de persona, el IVA, el uso, la localidad y la versión del vehículo en su catálogo. Si una compañía no puede decidir algo sola —por ejemplo, hay dos versiones parecidas y no sabe cuál es—, la tarjeta se pone amarilla y pide elegirlo; no adivina, porque cotizar otra versión es cotizar otro vehículo.',
          'Lo que se elige a mano se recuerda en esta computadora: la próxima vez que se entre al Multicotizador, aunque se haya cerrado el programa, cada compañía arranca con lo mismo. Sólo se olvida lo que dependía del vehículo o de la zona (la versión, la localidad) al cotizar otro vehículo.',
          'En Galeno, cada plan comercial es de un legajo, y la bonificación del productor va atada a esa combinación: se cotiza siempre con el legajo del plan elegido, que se ve debajo del plan. Si la cuenta tiene planes de más de un legajo, la lista los muestra con su legajo al lado.',
          'Para que Galeno dé igual que en su web hay que usar lo mismo que ahí: el «Modo de facturación» (la web arranca en «Anual c/ refacturación trimestral»; el Multicotizador, en mensual), las cuotas, la forma de pago («Pago manual» en la web), la cláusula de ajuste, y los dos números de arriba de la grilla, «% Bonificación Prima» y «% RA». Si no se eligen la bonificación y el RA, Galeno aplica los suyos por defecto para ese legajo y plan, que pueden ser distintos por cobertura: la tarjeta dice cuáles aplicó y cada fila del comparativo muestra los suyos.',
          'El premio y las cuotas de Galeno son del período que factura el modo elegido: con mensual es lo que se paga por mes; con «Anual c/ refacturación trimestral» es el trimestre en tres cuotas. Con modos distintos los premios no se pueden comparar aunque todo lo demás coincida.',
          'En ATM, el «Plan» junta tres cosas: la vigencia, cada cuánto se factura y la forma de pago (por ejemplo, «ANUAL/MENSUAL · tarjeta de crédito»). Si no se elige, toma el de la forma de pago que coincide con el medio elegido que factura más seguido. Igual que en Galeno, el premio y la cuota son los del período que factura el plan: con «ANUAL/MENSUAL», lo de cada mes. Para que dé igual que en la web de ATM hay que usar el mismo plan.',
          'Los otros ajustes de ATM a la vista: la bonificación (hasta 50 %; si no se elige, ATM aplica la que tiene por defecto para el vendedor) y la cláusula de ajuste de los autos (sin cláusula, 10 % o 20 %; arranca en 10 %, como dice el manual de ATM). En «Más ajustes de ATM» están la condición de IVA y, para inscriptos, monotributistas y exentos, los ingresos brutos (salen del formulario; cambiarlos ahí vale sólo para esta cotización), la versión en ATM (su código del vehículo), el uso en ATM, la localidad, el rastreo y la alarma.',
          'ATM busca el vehículo en sus propias tablas, que publica todas las noches por FTP y que cada computadora baja sola una vez por día. Si faltan o no se pudieron bajar, la tarjeta de ATM lo dice: se resuelven en API Aseguradoras → ATM, con «Actualizar tablas (FTP)» o importándolas de archivos.',
          'Si un precio no coincide con el de la web de la compañía, «Copiar datos para …» copia el pedido exacto que recibió su sistema y lo que contestó. Eso es lo que hay que pegarle a la compañía para que lo revise: ahí ven el legajo, el plan y cada dato con que se cotizó.',
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
          'En las compañías que lo permiten (hoy, Galeno) cada cobertura tiene «Emitir…»: emite la póliza en la compañía sin salir de la pantalla, con el mismo formulario que se usa desde Presupuestos. ATM por ahora sólo cotiza: sus coberturas entran al presupuesto, pero la póliza se emite por fuera del programa. Armar el presupuesto y emitir piden permiso para editar Presupuestos; cotizar, sólo para ver el Multicotizador.',
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
