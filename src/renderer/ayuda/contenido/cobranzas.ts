import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_COBRANZAS: Record<string, ContenidoDeAyuda> = {
  'cobranzas.caja': {
    clave: 'cobranzas.caja',
    titulo: 'Cobranzas → Caja del día',
    resumen: 'Qué se cobró hoy (o en el día que elijas) en una sucursal, con qué medio de pago y quién lo cobró.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es la pantalla para mirar al cerrar el mostrador: todos los pagos de un día, en una sucursal, con hora, cliente, compañía, póliza, patente, importe, medio de pago y quién lo cobró. Por defecto se abre en el día de hoy y en la sucursal de quien inició sesión, y se puede cambiar el día con el selector de fecha.',
          'Quién puede mirar las otras sucursales depende del rol: los administradores (SUPER_ADMIN y ADMIN) tildan las sucursales que quieran —una, varias o ninguna, que son todas—; un empleado ve la caja de su propio mostrador y en vez del filtro se le muestra el nombre. Lo que cobra un compañero de la misma sucursal, en otra computadora, aparece en la caja en cuanto sincroniza (unos segundos con internet).',
          'Arriba de la tabla hay tarjetas con el total del día, la cantidad de pagos y un total por cada medio de pago (efectivo, tarjeta, transferencia, etc.), para saber de un vistazo cuánto entró y de qué forma.',
        ],
      },
      {
        titulo: 'De dónde salen los pagos',
        parrafos: [
          'Un pago llega a esta lista de dos maneras: porque se cobró desde la Cartera del mes (el botón «Registrar pago» de una fila) o desde acá mismo con «Registrar pago», o porque ya venía cargado en la planilla de la agencia al importar. La sucursal que cuenta es siempre la del mostrador donde se cobró, no la sucursal donde vive el cliente: alguien de una localidad que paga en otra sucursal suma a la caja de esa sucursal, no a la suya.',
          'Los pagos que se cobran en la aplicación viajan a la base de la agencia por la pestaña «APP PAGOS», con la sucursal y quién cobró, y de ahí llegan a las demás computadoras: la caja de un día es la misma se la mire desde donde se la mire.',
        ],
      },
      {
        titulo: 'Registrar un pago y exportar el día',
        parrafos: [
          '«Registrar pago» carga un cobro nuevo sin tener que ir a buscar la fila en la Cartera: se elige el cliente o la cuota, el importe, el medio de pago y la sucursal. Abajo están las mismas opciones que en la Cartera: el estado del cobro («Pagó» o «Imputado», para cuando se le paga a la compañía y el cliente transfiere después) y, si se eligió una cuota del mes, qué cuota se paga (la de este mes, la del mes que viene por adelantado, o las dos).',
          'Un pago imputado se ve en la lista con la marca «Imputado · falta cobrar» y no suma al total del día: es plata que la agencia adelantó y que todavía tiene que entrar. Cuando el cliente paga, se registra de nuevo como «Pagó» sobre la misma cuota y recién ahí suma. Un pago adelantado se ve con la marca «Adelantado» y el mes que paga: suma hoy en la caja, pero se rinde en el mes que viene.',
          'Si el mostrador tiene la ticketeadora térmica configurada, al guardar el pago aparece un cartel que pregunta si imprimir el comprobante: «Imprimir» saca el ticket y «No imprimir» lo saltea, que es lo que conviene con las compañías que no lo piden. El pago queda registrado igual en los dos casos. Ese cartel se puede apagar (y volver a la impresión automática) en Administración → Impresora.',
          '«Exportar el día» genera un archivo con todos los pagos del día elegido, para guardar o imprimir. Si hay pagos sin un importe numérico cargado, aparece un aviso: esos pagos no suman al total.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Sucursal del mostrador',
        explicacion: 'La caja se ordena por dónde se cobró el pago, no por la sucursal habitual del cliente. Alguien que paga en otra sucursal aparece en la caja de esa sucursal.',
      },
    ],
  },
  'cobranzas.mora': {
    clave: 'cobranzas.mora',
    titulo: 'Cobranzas → Mora',
    resumen: 'Todas las cuotas vencidas sin pagar, de cualquier mes, ordenadas por cuánto atraso tienen: la lista de a quién hay que llamar hoy.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'A diferencia de la Planilla del mes, que sólo mira el mes abierto, Mora junta las cuotas vencidas sin pagar de TODOS los meses: si alguien no pagó hace tres meses, sigue apareciendo acá hasta que pague o se le dé de baja.',
          'No entran las pólizas dadas de baja, porque ya no son cartera activa, ni las que se pagan con débito automático, salvo que se tilde «Incluir débito automático»: a esas normalmente no hace falta perseguirlas porque se cobran solas.',
        ],
      },
      {
        titulo: 'Los tres rangos de atraso',
        parrafos: [
          'Las tarjetas de arriba separan la mora en tres rangos según cuántos días de atraso tiene cada cuota: de 1 a 7 días, de 8 a 30, y más de 30. Tocando una tarjeta se filtra la lista a ese rango, y se pueden tener varias tocadas a la vez (de 1 a 7 y más de 30, por ejemplo); volviendo a tocar una se la saca. El rango de «más de 30 días» es el más urgente: cuanta más plata acumulada ahí, peor.',
        ],
      },
      {
        titulo: 'Avisar y buscar',
        parrafos: [
          'Cada fila tiene su botón «Avisar» que abre WhatsApp con el mensaje de mora ya armado para ese cliente. Si la cuota es de un mes que ya se cerró, el aviso se manda igual, pero la planilla de ese mes no se toca (queda de sólo lectura); el aviso se anota en el historial del cliente de todas formas.',
          'El buscador encuentra por nombre, DNI, póliza o patente; los filtros de sucursal, compañía y días de atraso dejan tildar varias opciones a la vez.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Rangos de mora',
        explicacion: 'Tres franjas según los días de atraso de la cuota: 1 a 7 días, 8 a 30 días y más de 30 días. Cuanto más alto el rango, más urgente el llamado.',
      },
      {
        termino: 'Mes cerrado',
        explicacion: 'Un mes anterior ya archivado: se le puede avisar igual a un cliente con deuda de ese mes, pero la planilla de ese mes no se modifica.',
      },
      {
        termino: 'Débito automático',
        explicacion: 'Formas de pago que se cobran solas: por defecto quedan afuera de la lista de mora, porque no hace falta perseguirlas.',
      },
    ],
  },
  'cobranzas.comisiones': {
    clave: 'cobranzas.comisiones',
    titulo: 'Cobranzas → Comisiones',
    resumen: 'Una estimación de cuánta comisión deja cada compañía según lo cobrado en el mes, para tener una idea antes de que llegue la liquidación real.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Muestra, por compañía, cuántos pagos entraron en el mes elegido, cuánto se cobró en total, el porcentaje de comisión de esa compañía y la comisión estimada que resulta de multiplicar una cosa por la otra. Al pie quedan los totales de todas las compañías juntas.',
          'Es una estimación, no la liquidación oficial: cada compañía manda su propio resumen de comisiones aparte, y ese número puede diferir un poco del que se ve acá (por ejemplo, por anulaciones o ajustes que todavía no llegaron a esta planilla).',
        ],
      },
      {
        titulo: 'De dónde sale el porcentaje',
        parrafos: [
          'El porcentaje de cada compañía se carga en Administración → Compañías, y sólo lo pueden ver y cargar los roles administradores. Si a alguna compañía todavía no se le cargó el porcentaje, esta pantalla lo avisa arriba y esa fila queda sin estimar (aparece «sin cargar» en vez de un número).',
        ],
      },
      {
        titulo: 'Quién la ve',
        parrafos: ['Esta pestaña sólo aparece para los roles que no son Empleado: es información de la agencia, no del mostrador.'],
      },
    ],
    conceptos: [
      {
        termino: 'Comisión estimada',
        explicacion: 'Lo cobrado en el mes de una compañía multiplicado por su porcentaje de comisión. Es un cálculo interno para tener una idea, no reemplaza la liquidación que manda la compañía.',
      },
      {
        termino: 'Porcentaje de comisión',
        explicacion: 'El porcentaje que cada compañía paga sobre lo cobrado, cargado en Administración → Compañías. Sin ese dato cargado, esa compañía no se puede estimar.',
      },
    ],
  },
  // Se usa desde acá y desde Cartera → Imputados: es la misma pantalla vista desde dos módulos.
  imputados: {
    clave: 'imputados',
    titulo: 'Imputados',
    resumen: 'La rendición del mes contra cada compañía: por cada pago cobrado, si la compañía ya lo dio por bueno o hay algo para revisar.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Se llega a esta misma pantalla tanto desde Cobranzas → Imputados como desde Cartera → Imputados: es una sola pantalla, no dos. Lista todos los pagos de un mes (y, si se quiere, de una sola compañía) con fecha, cliente, compañía, póliza, importe, medio de pago, de dónde salió el pago y, a la derecha, su «Resultado»: cómo quedó ese pago frente a la compañía.',
          'Sirve para la rendición mensual: cruzar lo que la agencia cobró contra lo que cada compañía reconoce, y dejar anotado el estado de cada pago para no tener que volver a revisarlo todos los meses.',
        ],
      },
      {
        titulo: 'El campo Resultado',
        parrafos: [
          'Cada pago arranca sin resultado cargado (pendiente). Desde el desplegable de esa fila se elige uno: Imputado (la compañía ya lo tiene reconocido), OK (está todo en orden), Revisar (hay algo dudoso que hay que chequear) o Mal (no coincide, hay un problema). El cambio se guarda solo, sin botón aparte, y las tarjetas de arriba (Pendientes, Imputado, OK, Revisar, Mal) van contando cuántos pagos hay de cada resultado.',
          'Si ese pago ya traía un resultado escrito en la planilla de la agencia antes de tener el desplegable, se ve abajo del selector como «en la planilla dice…», de referencia.',
        ],
      },
      {
        titulo: 'Filtrar y lo que puede faltar',
        parrafos: [
          'Arriba se elige el mes y, opcionalmente, una compañía y una sucursal para ver sólo esos pagos. Los dos filtros dejan tildar varias opciones a la vez, y sin tildar nada entran todas. Si algunos pagos no tienen fecha ni mes legible, aparece un aviso: esos quedan afuera de cualquier rendición hasta corregir el dato de origen.',
          'La rendición la ven ENTERA los tres roles, con las cuatro sucursales, y cualquiera puede cargar el resultado de cualquier pago. Es a propósito distinto de la caja del día, donde un empleado sigue viendo sólo su mostrador: la caja es plata que entró, y esto es la planilla de control contra la compañía, que la agencia cierra una vez por mes entre todos. Partida por mostrador nadie veía cuántos pendientes quedaban de verdad.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Resultado',
        explicacion: 'El estado de un pago frente a la compañía: Imputado, OK, Revisar o Mal. Se carga a mano, pago por pago, desde el desplegable de la fila.',
      },
      {
        termino: 'Rendición',
        explicacion: 'El proceso mensual de cruzar lo que la agencia cobró contra lo que cada compañía reconoce como cobrado, para detectar diferencias.',
      },
      {
        termino: 'De la planilla / de la app',
        explicacion: 'Marca de origen del pago: si vino cargado en la planilla de la agencia («de la planilla») o se registró desde DM Gestión («de la app», con el nombre de quien lo cobró).',
      },
    ],
  },
}
