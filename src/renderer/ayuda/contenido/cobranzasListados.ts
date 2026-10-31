import type { ContenidoDeAyuda } from '../tipos'

// La ayuda de los listados de Cobranzas. Las pantallas de siempre (caja, mora, imputados y la pestaña
// Comisiones del panel) están en cobranzas.ts. Ojo con los nombres: «cobranzas.comisiones» es la pestaña
// del panel y «cobranzas.comisionesListado» es el listado nuevo; el manual agrupa por el prefijo «cobranzas».
export const AYUDA_COBRANZAS_LISTADOS: Record<string, ContenidoDeAyuda> = {
  'cobranzas.vencimientosCuotas': {
    clave: 'cobranzas.vencimientosCuotas',
    titulo: 'Cobranzas → Vencimientos Cuotas',
    resumen: 'Las cuotas de las pólizas que vencen en un rango de fechas o que ya vencieron, para saber qué hay que cobrar.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es un listado para buscar cuotas de pólizas próximas a vencer o ya vencidas. Primero elegís el rango de fechas de vencimiento (es obligatorio: sin rango la tabla no busca nada) y apretás «Buscar». Cada renglón muestra la compañía, el número de póliza, el cliente, la fecha de vencimiento de la cuota, su importe, el estado, el riesgo asegurado y el productor.',
          '«Filtros de Búsqueda» se puede plegar para darle más lugar a la tabla. Abajo hay un paginador de diez en diez, y «Exportar Excel» baja todo lo que filtraste, no sólo la página que estás mirando.',
        ],
      },
      {
        titulo: 'Opciones adicionales',
        parrafos: ['Son botones que se prenden y se apagan:'],
        lista: [
          'Incluir pólizas anuladas: por defecto no entran las cuotas de pólizas dadas de baja sin renovar, las que se dieron de baja de la planilla (Anulada) ni la fila vieja que reemplazó una renovación (Renovada).',
          'Excluir cuotas pagadas: saca las pagas y las adelantadas (cuya plata ya entró), así queda sólo lo que todavía hay que cobrar.',
          'Solo cuotas vencidas: deja sólo las cuotas cuya fecha ya pasó y siguen sin pagarse. Si la prendés junto con «Excluir cuotas pagadas» no pasa nada raro: una cuota vencida nunca está paga, así que da lo mismo que «Solo cuotas vencidas» sola.',
        ],
      },
      {
        titulo: 'Cómo se calcula cada columna',
        parrafos: [
          'Todo sale de la planilla mensual, la misma que ves en Cartera → Planilla del mes y que usa Cobranzas: cada renglón es una cuota de una póliza en un mes. No se inventa ningún dato. Una cuota sin día de vencimiento cargado no puede ubicarse en un rango, así que no aparece.',
          'Vencimiento: el día de vencimiento de la cuota dentro de su mes (si el mes es más corto, el último día). Importe: el monto de la cuota tal como está cargado; si no tiene, se ve «—». Debajo del importe figura el número de cuota. Riesgo: se describe igual que en el listado de Pólizas (marca y modelo, domicilio, integrantes…). Productor: el de la póliza.',
          'Estado, en este orden: Pagada si tiene fecha en CUANDO PAGO o un pago registrado en el programa (un texto que no es fecha, como «A/D», no cuenta); Adelantada si se cobró por adelantado y todavía no se imputó a la cuota; Anulada si la póliza está dada de baja sin renovarse o la cuota se dio de baja de la planilla (desapareció de la hoja o se borró en otra PC); Renovada si es la fila vieja que reemplazó una renovación (la póliza no se anuló, se renovó); Imputada si la agencia ya la pagó a la compañía y falta que el cliente pague; Vencida si su fecha es anterior a hoy y es una cuota que Cobranzas → Mora persigue (CUANDO PAGO vacío, sin pago que la cubra y que no sea de débito automático; no se descuenta la cobertura financiera de la compañía); Sin mora si la fecha pasó pero la Mora la descarta por alguno de esos motivos (débito automático, algo escrito en CUANDO PAGO como «A/D» o «DÉBITO», o un pago que la cubre); Pendiente si vence hoy o más adelante. Una diferencia con la Mora: ella sólo lista pólizas activas, este listado no descarta una póliza ya renovada que sigue con cuotas sin pagar.',
          'Los filtros «Vendedores» y «Grupos» se ven apagados: el programa todavía no guarda esos datos. En esta agencia el vendedor de una póliza es su productor, y para eso está el filtro «Productores».',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Cuota vencida',
        explicacion: 'Una cuota cuya fecha de vencimiento ya pasó (es anterior a hoy) y que todavía no figura paga. Las de débito automático, o con algo escrito en CUANDO PAGO, no cuentan como vencidas: salen como «Sin mora», igual que la Mora las deja aparte.',
      },
    ],
  },
  'cobranzas.rechazos': {
    clave: 'cobranzas.rechazos',
    titulo: 'Cobranzas → Rechazos',
    resumen: 'El historial de los débitos que el banco o la tarjeta rechazaron, con la causa y el productor de cada uno.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el historial de rechazos de débito de cuotas y pagos de pólizas. A diferencia de Vencimientos Cuotas, se carga sola al abrirla: no hace falta elegir un rango de fechas. Cada renglón muestra la fecha, la compañía, el número de póliza, el cliente, el importe, el tipo, la causa y el productor. Está ordenado por fecha, del más nuevo al más viejo, de a 10 por página.',
          '«Filtros de Búsqueda» arranca plegado. Abrilo para acotar por rango de fechas, compañías, ramas, productores, tipo, causa o nombre del cliente; «Limpiar» vuelve a mostrar todo. «Exportar Excel» baja el resultado completo con los filtros puestos.',
        ],
      },
      {
        titulo: 'De dónde sale cada dato',
        parrafos: [
          'Son los avisos de rechazo del débito automático que se cargan en Cartera → Rechazos. Este listado sólo los junta en una tabla y no cambia ninguno: para gestionar un rechazo o armar la campaña de recupero, seguí usando Cartera → Rechazos.',
          'Lo que no existe en los datos se muestra como «—» y nunca se completa con un valor inventado.',
        ],
      },
      {
        titulo: 'Cómo se calcula cada columna',
        parrafos: [
          'Fecha: el día en que se anotó el aviso de rechazo. Compañía y número de póliza: los que quedaron en el aviso y, si faltan, los de la póliza. Debajo del número se ve la cuota que rebotó y su mes. Tocando el número se abre la póliza.',
          'Importe: el monto de la cuota de la planilla del mes que rebotó (la atada al aviso o, si no la hay, la de esa póliza en ese mes). Si el aviso no quedó atado a una cuota con monto, muestra «—»: no se calcula ni se estima.',
          'Tipo: el estado del aviso. «Pendiente» es que la sucursal todavía no lo abrió, «Visto» que lo abrió pero el cobro sigue sin resolverse, y «Resuelto» que se cobró o se corrigió el CBU. El programa no distingue otros tipos de rechazo (por ejemplo cuota o pago) ni tiene estado «descartado». Causa: el motivo elegido al avisar (sin fondos, cuenta cerrada, tarjeta rechazada…).',
          'Productor y rama salen de la póliza del aviso; si el aviso no tiene póliza asociada, esas dos columnas quedan en «—» y no entran en los filtros de productor o rama.',
        ],
      },
    ],
  },
  'cobranzas.comisionesListado': {
    clave: 'cobranzas.comisionesListado',
    titulo: 'Cobranzas → Comisiones (listado)',
    resumen: 'Las comisiones que dejó cada pago de póliza en un rango de fechas de cobro, con el porcentaje y el productor.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el listado de las comisiones generadas por los pagos de pólizas. Elegís el rango de fechas de cobro (obligatorio) y apretás «Buscar». Cada renglón muestra la fecha del cobro, la compañía, la póliza, el cliente, el importe del pago, el porcentaje de comisión de la compañía, la base sobre la que se calcula, la comisión resultante y el productor.',
          'No es lo mismo que la pestaña «Comisiones» del Panel de cobranzas: esa suma por compañía y por mes; este baja hasta cada pago. Los dos son estimaciones internas, no la liquidación oficial que manda cada compañía.',
        ],
      },
      {
        titulo: 'Cómo se calcula cada columna',
        parrafos: [
          'Cada renglón es un pago registrado, y el rango se aplica a su fecha de cobro. La pestaña «Comisiones» del panel agrupa en cambio por el mes que paga el pago (un pago adelantado cuenta en el mes siguiente), así que los totales de un mes pueden diferir. Como esa pestaña, el listado cuenta todos los pagos, también los imputados.',
          '% Comisión PAS: el porcentaje que se carga para la compañía del pago en Administración → Compañías. Si todavía no está cargado (o está en 0) se ve «—» y ese pago queda sin comisión; arriba de la tabla se avisa qué compañías faltan.',
          'Base: el importe del pago, que es el monto sobre el que la pestaña «Comisiones» calcula la comisión (lo efectivamente cobrado). Por eso coincide con el Importe Pago: el programa no guarda otra base. Comisión: la base por el porcentaje, redondeada a centavos pago por pago; la pestaña redondea una sola vez por compañía, así que la suma de los renglones puede diferir de ella en unos centavos.',
          'Productor, ramo (debajo del número de póliza) y la forma de pago salen de la póliza y del pago: el productor y el ramo, de la póliza; «Formas de Pago» filtra por el medio con que se cobró cada pago (efectivo, transferencia…). Un pago sin póliza asociada se ve con «—» en productor y ramo. Los totales de arriba (pagos, cobrado y comisión estimada) suman todo el resultado, no sólo la página.',
          'Los filtros «Vendedores» y «Grupos» se ven apagados porque el programa todavía no guarda esos datos; el vendedor de una póliza es su productor.',
        ],
      },
      {
        titulo: 'Quién la ve',
        parrafos: ['Sólo los roles que no son Empleado: es información de la agencia, no del mostrador, igual que la pestaña Comisiones del panel.'],
      },
    ],
  },
}
