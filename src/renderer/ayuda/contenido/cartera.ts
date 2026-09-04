import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_CARTERA: Record<string, ContenidoDeAyuda> = {
  'cartera.planilla': {
    clave: 'cartera.planilla',
    titulo: 'Cartera → Planilla del mes',
    resumen: 'La planilla de siempre, con el semáforo de vencimientos calculado solo y tres acciones de un clic por fila.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es la hoja de cálculo mensual de toda la vida, una fila por póliza. Arriba a la izquierda elegís el mes con el selector «Mes»: cada mes tiene su propia planilla, y el mes que está trabajándose ahora dice «(abierto)» al lado.',
          'Un mes que ya se cerró queda sólo para consultar: aparece la etiqueta «Mes cerrado · sólo lectura» y no se puede editar ni cobrar sobre esas filas. Es información histórica, no algo para tocar.',
          'Para corregir un dato hacés doble clic en la celda (nombre, teléfono, DNI, forma de pago, compañía, cobertura, patente, etc.) y escribís el valor nuevo. Al apretar Enter o hacer clic afuera se guarda solo; con Escape se cancela. Todo lo que se corrige acá también se corrige en la ficha del cliente y viceversa, así que no hace falta cargar dos veces.',
        ],
      },
      {
        titulo: 'El semáforo',
        parrafos: [
          'La columna «Alerta» es lo primero que se mira: un color por fila que dice qué tan urgente es esa cuota, calculado solo a partir del día de vencimiento y de si está paga.',
          'Verde es «al día» (ya está paga). Azul es débito automático: se cobra sola con tarjeta, CBU o débito, así que no hay que avisar ni perseguirla. Amarillo es «vence pronto» (entre 4 y 7 días, o recién vencida pero todavía dentro de la cobertura financiera de la compañía). Naranja es más urgente (1 a 3 días, o el último día de cobertura). Rojo es lo más grave: vence hoy sin pago, o ya venció y se terminó la cobertura de la compañía.',
          'Violeta es «hay un pago dando vueltas»: o la cuota está imputada (la agencia ya se la pagó a la compañía y falta cobrársela al cliente), o tiene un pago adelantado del mes pasado esperando que alguien lo impute. En los dos casos la compañía ya está cubierta; lo que falta es un paso en la agencia.',
          'Pasando el mouse por la etiqueta de color se ve el detalle exacto (fecha de vencimiento y, si corresponde, hasta cuándo cubre la compañía).',
        ],
      },
      {
        titulo: 'Las cinco acciones por fila',
        parrafos: [
          'En la columna «Acciones» hay cinco botones chiquitos para cada fila: avisar por WhatsApp, marcar como avisado, registrar un pago, avisar un rechazo del débito y dar de baja.',
          '«Avisar» (el globito) abre WhatsApp con un mensaje ya armado para ese cliente y deja la fila marcada como avisada. «Avisado» (el tilde) hace lo mismo con la planilla —deja la fila en ENVIADO con la fecha de hoy y la suma a «Avisados hoy»— pero sin abrir WhatsApp: es para cuando ya se le avisó por otro lado, por teléfono, en el mostrador o desde el celular. No hace falta que el cliente tenga teléfono cargado.',
          '«Registrar pago» abre un formulario para cargar cómo y cuándo se pagó esa cuota, sin salir de la planilla. «Avisar rechazo del débito» (el triángulo) le manda un aviso a la sucursal que atiende al cliente para que lo llame y lo cobre a mano: es para cuando la compañía rebota el CBU o la tarjeta. «Dar de baja» saca la póliza de la cartera activa y la manda a Cartera → Bajas, pidiendo el motivo.',
          'Las cinco acciones quedan deshabilitadas en un mes cerrado (sólo lectura). En la fila que tiene un pago adelantado esperando aparece un sexto botón (el calendario): «Imputar el pago adelantado» deja la cuota paga con la fecha en que se cobró.',
        ],
      },
      {
        titulo: 'Pago adelantado: dos cuotas el mismo mes',
        parrafos: [
          'Cuando alguien viene a pagar la cuota de este mes y también la del mes que viene, en «Registrar pago» se elige «La de este mes y la del mes que viene» (o «Sólo la del mes que viene», si la de este mes ya estaba paga). El importe de la cuota adelantada viene cargado con la cuota de la fila y se puede cambiar. La plata entra hoy en la caja del día; en Imputados, ese pago se rinde en el mes que paga, no en el que se cobró.',
          'De la cuota adelantada se elige qué hacer cuando se arme el mes siguiente con «Cerrar mes»: «Acreditarla al mes siguiente» hace que la fila nueva nazca paga, con la fecha del cobro en CUANDO PAGO; «Dejarla pendiente para imputar» hace que la fila nazca sin pagar y en violeta («Adelanto sin imputar»), para imputarla a mano cuando se controle el general del mes. El contador «Adelantos sin imputar» junta esas filas, y el botón del calendario de cada una las deja pagas.',
          'Adelantar dos veces la misma cuota corrige el adelanto, no lo duplica: es el mismo pago.',
        ],
      },
      {
        titulo: 'Cobro imputado: se paga a la compañía y el cliente transfiere después',
        parrafos: [
          'Con algunas compañías (AGS, en Dock Sud) primero se imputa la cuota —la paga la agencia— y el cliente manda la plata después. Para eso, en «Registrar pago» el estado del cobro se marca como «Imputado» en vez de «Pagó». La fila NO queda paga: pasa a violeta («Imputado · falta cobrar»), suma en el contador «Imputados a cobrar» y sigue apareciendo en Mora con la marca «Imputado», porque lo que hay que perseguir es el pago del cliente. En la caja del día el pago se ve con la marca «Imputado · falta cobrar» y no suma al total.',
          'Cuando el cliente paga, se vuelve a registrar el pago sobre la misma fila, esta vez como «Pagó»: recién ahí la fila queda paga, con la fecha de ese día, y la caja lo cuenta.',
        ],
      },
      {
        titulo: 'Buscar y filtrar',
        parrafos: [
          'El buscador de arriba encuentra por nombre, patente, número de póliza o DNI. Al lado hay filtros por sucursal, forma de pago, compañía, rama y color de alerta, y una casilla «Sólo con AVISAR VTO» para ver nada más que las filas marcadas para avisar antes del vencimiento.',
          'Cada filtro deja elegir VARIAS opciones a la vez: se toca y se abre un panel con una casilla por opción. Tildando ATM y Metropol se ven las dos compañías juntas, y tildando Dock Sud y Daniel, los dos mostradores. El botón dice qué está filtrando («Compañía: ATM +1»), y sin tildar nada entran todas, que es lo mismo que no filtrar. Adentro del panel hay «Elegir todas» y «Limpiar», y cuando las opciones son muchas, un buscador.',
          'La RAMA es cómo vende la agencia: auto, moto, pick up, camión, scooter, moto eléctrica y trailer. No hace falta que la celda VEHICULO diga la palabra exacta: una camioneta cargada desde «Nueva póliza» entra en «Pick up» aunque en la planilla figure como AUTO, porque la rama sale del vehículo y de la categoría que le puso el catálogo. Si la planilla trae un vehículo que no es de ninguna de las siete (un hogar, una bicicleta), queda listado aparte en el mismo filtro para poder encontrarlo igual.',
          'Las tarjetas de arriba (Total, Vencen hoy, Vencidos, Avisados hoy, Se les termina la cobertura, Pagados hoy) son contadores del día: se actualizan solos con lo que va pasando. Además funcionan como filtro: tocá una y la tabla queda sólo con esas filas; tocala de nuevo (o tocá Total) para volver a ver el mes entero. Los números siguen contando sobre todo el mes aunque haya un filtro puesto.',
        ],
      },
      {
        titulo: 'Elegir qué columnas se ven',
        parrafos: [
          'La planilla tiene veintidós columnas y nadie las usa todas al mismo tiempo. Con el botón «Columnas», al lado de los filtros, se apagan las que no hacen falta: quedan tildadas las que se ven y se destildan las demás. Lo que elijas se guarda en esa computadora —no en tu usuario ni en la agencia—, así que la notebook del mostrador puede quedar con seis columnas y el monitor de la oficina con todas. «Mostrar todas» las vuelve a prender.',
          'La columna «Nombre y apellido» es la primera y no se puede apagar: queda pegada a la izquierda y no se mueve mientras corrés la tabla para el costado. Es lo que evita perder de vista de quién es la fila cuando estás mirando la patente o la póliza, allá a la derecha.',
        ],
      },
      {
        titulo: '«Se les termina la cobertura»',
        parrafos: [
          'Es la tarjeta que está al lado de «Avisados hoy». Cuenta las cuotas que ya vencieron sin pago pero que la compañía todavía sigue cubriendo por unos días: son las que hay que llamar ahora, porque cuando esos días se terminan el cliente queda sin seguro.',
          'Cuántos días cubre cada compañía después del vencimiento lo pone la compañía: ATM 7, Rivadavia 7, Río Uruguay 7, Euroamérica 7, Galeno 7, Equidad 5 y Metropol 3. Se cuentan desde la fecha de vencimiento de la cuota y se cambian en Administración → Compañías, así que si una compañía modifica su plazo se corrige en un solo lugar y la tarjeta lo toma enseguida.',
          'Tocándola quedan en la tabla nada más que esas filas. En la columna «Alerta» cada una dice cuántos días le quedan («Cubierto 3 d», «Último día cob.»). Los que se cobran solos (débito, CBU, tarjeta) y los que ya pagaron no entran acá: no hay nada que perseguir.',
        ],
      },
      {
        titulo: 'La columna «Propuesta»',
        parrafos: [
          'Al lado de «Póliza» está la columna «Propuesta», para el número que dan algunas compañías mientras la póliza todavía no está emitida. Se carga con doble clic, igual que el resto.',
          'La propuesta se guarda en la póliza —se ve también en Pólizas y en la ficha del cliente, y sigue estando el mes que viene— pero no viaja a la base compartida: es un dato interno de la agencia.',
        ],
      },
      {
        titulo: 'Cerrar el mes',
        parrafos: [
          'El botón «Cerrar mes» (visible para todos menos el rol Empleado) abre el mes siguiente con las pólizas que correspondan, y deja el mes actual como archivo de sólo lectura. Es una acción de fin de mes, no algo que se toque todos los días.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Semáforo',
        explicacion:
          'El color de la columna «Alerta»: verde (paga), azul (débito automático, se cobra sola), amarillo (vence pronto o recién vencida y todavía cubierta), naranja (muy próxima a vencer o último día de cobertura) y rojo (vence hoy sin pago, o venció y ya no hay cobertura).',
      },
      {
        termino: 'Cobertura financiera',
        explicacion:
          'Los días que cada compañía sigue cubriendo al asegurado después de que venció la cuota sin pagar, aunque todavía no se haya cobrado. Cada compañía tiene su propio número (se configura en Administración → Compañías); mientras dura, la fila se ve amarilla o naranja en vez de roja.',
      },
      {
        termino: 'Débito automático',
        explicacion: 'Formas de pago que se cobran solas (tarjeta, CBU, débito): no hace falta avisarle a ese cliente ni perseguirlo, por eso van en azul.',
      },
      {
        termino: 'Mes cerrado',
        explicacion: 'Un mes anterior queda archivado: se puede mirar y buscar, pero no se puede editar, cobrar ni dar de baja sobre esas filas.',
      },
      {
        termino: 'AVISAR VTO',
        explicacion: 'Una marca en la fila que dice que a ese cliente hay que avisarle antes de que venza, no sólo cuando ya venció.',
      },
    ],
  },
  'cartera.bajas': {
    clave: 'cartera.bajas',
    titulo: 'Cartera → Bajas',
    resumen: 'Quién dejó de ser cliente en el mes elegido, con todos sus datos, y el botón para volver a ponerlo vigente.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el listado de las pólizas que se dieron de baja en un mes. La tabla muestra lo que se lee de un vistazo —nombre, DNI, compañía, número de póliza, patente, vehículo, cuota, sucursal, motivo y fecha— y se elige el mes con el selector de arriba, igual que en la Planilla.',
          'Una baja se puede originar de dos maneras: apretando «Dar de baja» en una fila de la Planilla del mes (con motivo y nota opcional), o porque ya venía así cargada en la hoja de la agencia al importar.',
        ],
      },
      {
        titulo: 'Ver todos los datos de una baja',
        parrafos: [
          'Haciendo clic en cualquier fila se abre a la derecha el panel con TODO lo que esa póliza tenía en la cartera el día que se fue: teléfono, email, dirección y localidad; el vehículo completo (marca, modelo, año, motor, chasis, uso, color); la póliza (cobertura, propuesta, prima, productor, vigencias, alta); cómo estaba el mes (cuota, día de vencimiento, forma de pago, observaciones) y la baja en sí (motivo, nota y fecha).',
          'Es una foto del momento de la baja, no lo que diga la póliza hoy: si después se corrige algo, la baja sigue mostrando cómo estaba cuando el cliente se fue. En las bajas viejas que vinieron de la hoja puede haber datos que la hoja nunca tuvo; lo que falta se completa desde la ficha del cliente y del vehículo, y lo que no se sepa simplemente no aparece.',
          'Desde el pie del panel se salta a la ficha del cliente con «Ver el cliente».',
        ],
      },
      {
        titulo: 'Buscar una baja',
        parrafos: [
          'El buscador de arriba (la lupa) filtra la lista del mes por nombre, patente, número de póliza, DNI, compañía, sucursal o teléfono, igual que en Siniestros. Sirve para encontrar rápido a alguien puntual sin recorrer toda la lista.',
        ],
      },
      {
        titulo: 'Poner vigente una póliza',
        parrafos: [
          'Es el caso del cliente que se dio de baja en julio y en septiembre vuelve: no hay que cargarlo de nuevo. Con el botón «Poner vigente» la póliza vuelve a estar activa y se le arma su fila en la planilla del mes abierto con los últimos datos que tenía; la baja sale de esta lista y también de la pestaña BAJAS de la base.',
          'Lo que haya cambiado —la cuota, la compañía, el vehículo— se corrige después en la planilla o en la póliza, con doble clic, como cualquier otro dato.',
          'Funciona también con las bajas que venían de la hoja, siempre que la baja esté enlazada a una póliza conocida. Si el cliente se fue hace tanto que ya no queda ninguna póliza suya cargada, el botón no aparece: en ese caso hay que darla de alta desde Pólizas → Nueva póliza.',
          'Sólo lo pueden hacer los roles con más permisos (no el Empleado), porque mueve la planilla que están mirando todos.',
        ],
      },
      {
        titulo: 'Deshacer una baja',
        parrafos: [
          '«Deshacer», en el panel de la derecha, es otra cosa: es el «me equivoqué» del momento. Deja la fila exactamente como estaba, en el mes del que salió, y sólo sirve para las bajas hechas desde la aplicación.',
          'Cuando la baja es de un mes anterior o vino de la hoja, lo que corresponde es «Poner vigente», que la trae al mes que se está trabajando.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Deshacer / Poner vigente',
        explicacion:
          '«Deshacer» revierte una baja recién hecha en la aplicación y devuelve la fila al mes del que salió. «Poner vigente» trae la póliza al mes abierto: es para el cliente que se fue y volvió.',
      },
      {
        termino: 'Motivo',
        explicacion: 'La razón de la baja (por ejemplo, cambio de compañía o vehículo vendido), si se cargó al darla de baja. Puede venir vacío si la hoja original no tenía esa columna.',
      },
      {
        termino: 'Eliminar la baja',
        explicacion:
          'El botón rojo de la papelera, que sólo ve un superadministrador: borra el registro de la baja para siempre, también de la pestaña BAJAS de la base. No devuelve nada a la cartera: para eso están «Deshacer» y «Poner vigente». Sirve para la baja cargada por error, no para el cliente que volvió.',
      },
    ],
  },
  'cartera.rechazos': {
    clave: 'cartera.rechazos',
    titulo: 'Cartera → Rechazos',
    resumen: 'Los débitos que rebotaron y la sucursal que tiene que llamar al cliente para cobrarlos a mano.',
    secciones: [
      {
        titulo: 'Para qué sirve',
        parrafos: [
          'Cuando la compañía rebota un débito —el CBU no tiene fondos, la cuenta se cerró, la tarjeta no pasó— esa cuota deja de cobrarse sola y hay que llamar al cliente. El problema de siempre es que quien se entera del rechazo no es quien lo atiende: el archivo lo mira la administración y al cliente lo conoce su sucursal.',
          'Esta pantalla es el puente. Quien ve el rechazo aprieta un botón en la póliza, elige a qué sucursal avisarle y escribe qué pasó; en esa sucursal aparece un aviso en la campana de la barra de arriba, apenas entran al programa. El aviso viaja por la base del VPS, así que llega aunque la sucursal trabaje en otra computadora.',
        ],
      },
      {
        titulo: 'Cómo se avisa un rechazo',
        parrafos: [
          'Hay dos lugares, y los dos hacen exactamente lo mismo: el botón «Avisar rechazo del débito» arriba de una póliza (Pólizas → abrir la póliza) y el botón del triángulo en la columna «Acciones» de la Planilla del mes.',
          'Se abre un cuadro con tres cosas: a qué sucursal avisarle (viene puesta la del cliente), qué pasó (se rechazó el CBU, sin fondos, cuenta cerrada, CBU mal cargado, la tarjeta no pasó, u otro) y una nota libre para lo que la sucursal necesite saber.',
          'Si se aprieta el botón dos veces no se manda el aviso dos veces: se actualiza el que ya estaba y vuelve a quedar pendiente.',
        ],
      },
      {
        titulo: 'Los tres estados',
        parrafos: [
          'Pendiente es un aviso que en la sucursal todavía no abrió nadie: es el que enciende el punto rojo de la campana. Visto quiere decir que lo abrieron, pero que el cobro sigue sin resolverse: abrir la campana no es haber cobrado. Resuelto es cuando ya se cobró o se corrigió el CBU, y deja de aparecer en lo pendiente.',
          'Se marca como resuelto desde la propia campana o desde esta pantalla. Si se marcó de más, «Volver a abrir» lo devuelve a pendiente.',
        ],
      },
      {
        titulo: 'Qué se ve acá',
        parrafos: [
          'La pantalla abre filtrada por la sucursal de quien entró, que es lo que esa persona tiene que cobrar; sacando el filtro se ven los de todas, que es como la administración controla que se hayan resuelto.',
          'De cada aviso se ve el estado, el cliente con su teléfono para llamarlo, la compañía y la póliza, la patente, la cuota y el mes que rebotó, qué pasó con la nota, la sucursal avisada, quién avisó y cuándo, y quién lo resolvió.',
          'Las tarjetas de arriba cuentan cuántos hay en cada estado y además filtran: tocá una y quedan sólo esos.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Débito rechazado',
        explicacion:
          'Una cuota que se cobraba sola (CBU, débito o tarjeta) y que la compañía no pudo cobrar. Deja de estar «al día» y hay que perseguirla como cualquier otra deuda.',
      },
      {
        termino: 'La campana del triángulo',
        explicacion:
          'La de la izquierda en la barra de arriba: muestra los rechazos sin resolver de tu sucursal. La otra campana es la de tus tareas, que son tuyas y no de la sucursal.',
      },
    ],
  },
  'cartera.riesgos': {
    clave: 'cartera.riesgos',
    titulo: 'Cartera → Riesgos varios',
    resumen: 'Las pólizas que no son de auto (hogar, comercio, vida y demás), en una tabla que se edita igual que la planilla.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Reúne todo lo que la agencia asegura fuera del automotor: combinado familiar, incendio, comercio, y cualquier otro riesgo cargado como «varios». Cada fila tiene sucursal, titular, tipo de riesgo, día de vencimiento, forma de pago, compañía, número de póliza, cuota, vigencias, teléfono y observaciones.',
          'A diferencia de la Planilla del mes, acá no hay un mes para elegir: es una sola tabla que se va corrigiendo con el tiempo, sin abrir y cerrar meses.',
        ],
      },
      {
        titulo: 'Cómo se edita',
        parrafos: [
          'Igual que en la Planilla: doble clic en cualquier celda para escribir el valor nuevo, Enter para guardar y Escape para cancelar. En columnas como sucursal, compañía o forma de pago aparecen sugerencias con lo que ya se usó antes, aunque siempre se puede escribir algo distinto.',
          'El puntito azul a la izquierda de una fila significa que esa forma de pago es débito automático (tarjeta o CBU): se cobra sola, igual que en el semáforo de la Planilla.',
          'Cada cambio que se hace acá también sube a la base del VPS, y de ahí el servidor lo refleja en la hoja de Google para quien la siga mirando desde allá.',
        ],
      },
      {
        titulo: 'Cargar un riesgo nuevo',
        parrafos: ['El botón «Nuevo riesgo» abre un formulario para dar de alta una póliza de este tipo sin pasar por la hoja.'],
      },
    ],
    conceptos: [
      {
        termino: 'Riesgo vario',
        explicacion: 'Cualquier póliza que no sea de un vehículo: hogar, comercio, vida, combinado familiar, etc.',
      },
      {
        termino: 'Débito automático',
        explicacion: 'Forma de pago que se cobra sola (tarjeta o CBU), marcada con un puntito azul: no hace falta perseguirla.',
      },
    ],
  },
  'cartera.amp': {
    clave: 'cartera.amp',
    titulo: 'Cartera → AMP',
    resumen: 'Las ampliaciones de póliza pendientes de emitir, para no perder de vista ninguna hasta que la compañía la resuelva.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Una «ampliación» es un cambio que se pidió sobre una póliza ya emitida (por ejemplo, sumar un vehículo, corregir un dato o extender una cobertura) y que todavía está en trámite en la compañía. Esta pantalla lista esas ampliaciones pendientes: sucursal, fecha, nombre del cliente, forma de pago, patente, marca, modelo, fecha de vencimiento y el detalle de la ampliación.',
          'Es a propósito la lista más chica y simple de toda la Cartera: no tiene edición de celdas ni alta manual, porque su única función es no perder de vista lo que falta emitir.',
        ],
      },
      {
        titulo: 'Marcar una ampliación como resuelta',
        parrafos: [
          'Cuando la compañía ya emitió la ampliación, se tilda la casilla «Resuelto» de esa fila y desaparece de la lista de pendientes. Nada se borra: si hace falta, con «Ver también las resueltas» se ve el historial completo, con quién la marcó como resuelta.',
          'Destildar una fila resuelta la devuelve a pendiente, por si se marcó por error.',
        ],
      },
      {
        titulo: 'Buscar y filtrar',
        parrafos: ['El buscador encuentra por nombre, patente, marca o modelo; el desplegable de sucursal acota la lista a una sola oficina.'],
      },
    ],
    conceptos: [
      {
        termino: 'AMP / Ampliación',
        explicacion: 'Un cambio pedido sobre una póliza ya emitida (agregar algo, corregir un dato, extender cobertura) que está en trámite en la compañía hasta que se emite.',
      },
      {
        termino: 'Resuelto',
        explicacion: 'Marca que indica que la compañía ya emitió la ampliación. Se puede destildar si se marcó por error; nunca se borra la fila.',
      },
    ],
  },
  'cartera.reglas': {
    clave: 'cartera.reglas',
    titulo: 'Cartera → Reglas de cobertura',
    resumen: 'Qué antigüedad de vehículo acepta cada compañía para cada cobertura, para avisar antes de cargar una póliza que no corresponde.',
    secciones: [
      {
        titulo: 'Por qué arranca vacía',
        parrafos: [
          'A diferencia del resto de la Cartera, esta matriz no se completa sola al traer la hoja de la agencia: el cuadro de coberturas de la planilla original es un resumen con celdas combinadas, no una tabla fila por fila, así que no hay forma de leerlo automáticamente. Por eso el superadministrador la carga a mano, regla por regla.',
          'Mientras se carga, en «Lo que dice la hoja» (al pie de la pantalla) queda visible el cuadro original tal cual está en la planilla, para copiar los valores de referencia.',
        ],
      },
      {
        titulo: 'Lo que falta cargar',
        parrafos: [
          'Arriba de la matriz aparece, si hay alguna, la lista de combinaciones de compañía y cobertura que ya se usan en pólizas reales de la cartera pero todavía no tienen regla cargada. Están ordenadas por cantidad de pólizas: conviene empezar por las de arriba, porque son las que más gente afectan si falta la regla.',
          'Sin una regla cargada, al dar de alta una póliza de esa compañía y esa cobertura la aplicación no va a poder avisar si el vehículo es demasiado viejo para esa combinación.',
        ],
      },
      {
        titulo: 'Cómo se carga una regla',
        parrafos: [
          'Cada regla tiene compañía, cobertura y un límite de antigüedad, que se carga de una sola manera: o bien «años de antigüedad» (por ejemplo, hasta 20 años), o bien un «año mínimo» fijo de fabricación (por ejemplo, modelo 2006 en adelante). No se cargan los dos juntos. Dejando los dos vacíos, la regla queda sin límite.',
          'Además se puede anotar qué incluye la cobertura, la franquicia, un detalle libre y observaciones.',
        ],
      },
      {
        titulo: 'Quién puede editar',
        parrafos: [
          'Sólo el superadministrador carga, edita y borra reglas. El resto del equipo puede consultar la matriz mientras atiende: si falta una compañía o una cobertura, hay que pedirle al superadministrador que la cargue.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Antigüedad máxima vs. año mínimo',
        explicacion:
          'Dos formas de escribir el mismo límite: «antigüedad máxima» son años contados desde hoy (se recalcula solo con el paso del tiempo); «año mínimo» es un año de fabricación fijo que no cambia. Se carga sólo una de las dos.',
      },
      {
        termino: 'Sin límite cargado',
        explicacion: 'Una regla sin antigüedad máxima ni año mínimo: esa compañía acepta cualquier antigüedad para esa cobertura, o todavía no se cargó el límite real.',
      },
      {
        termino: 'Lo que dice la hoja',
        explicacion: 'El cuadro de coberturas tal cual está en la planilla original de la agencia, mostrado como referencia porque no se puede leer solo.',
      },
    ],
  },
  'cartera.duplicados': {
    clave: 'cartera.duplicados',
    titulo: 'Cartera → Duplicados',
    resumen: 'Lo que quedó repetido en la base —fichas de cliente, renglones de la planilla, bajas— a la vista y con el botón para juntarlo o sacarlo.',
    secciones: [
      {
        titulo: 'Qué muestra',
        parrafos: [
          'Cuatro listas. Fichas de cliente que son (o pueden ser) la misma persona: mismo DNI, mismo nombre sin documento, mismo nombre con la misma patente, o un CUIT que contiene el DNI de otra ficha. La misma póliza dos veces en el mismo mes. La misma baja dos veces. Y la póliza que está en la planilla y en Bajas a la vez, que es una baja (o una reactivación) que quedó a medio camino.',
          'Cada grupo dice cuál dejaría el programa: la ficha que tiene la clave del DNI o la que más arrastra, el renglón que tiene un cobro colgando o el de más arriba en la base, la baja que se hizo en el programa.',
        ],
      },
      {
        titulo: 'Qué se arregla solo y qué no',
        parrafos: [
          'Las fichas con el mismo DNI y el mismo nombre se juntan solas al arrancar el programa y después de cada importación, y lo mismo pasa con los renglones y las bajas repetidas que no tienen nada colgando. Lo que queda en esta pantalla es lo que necesita una decisión: dos nombres iguales pueden ser dos personas, y un renglón con un cobro no se saca sin mirar.',
          'Lo puede usar cualquiera que edite la Cartera (o Clientes, para las fichas): la agencia pidió no depender del superadministrador para sacar una ficha cargada dos veces. Lo que se junta o se saca acá viaja a las otras computadoras con la sincronización.',
        ],
        lista: [
          '«Fusionar»: todo lo de una ficha (pólizas, cuotas, pagos, siniestros, tareas, notas) pasa a la otra y la que sobra se borra. Se elige cuál queda con el círculo de al lado del nombre.',
          '«Sacar este renglón» y «Sacar esta baja»: el mismo cartel y los mismos cinco segundos que la papelera, con la cuenta de lo que se lleva puesto.',
          'En «los dos lados» hay que decidir: si la póliza se fue, se saca de la planilla; si sigue, se saca la baja. Si acaban de darla de baja o de reactivarla, esperá un minuto y volvé a revisar.',
        ],
      },
    ],
    glosario: [
      {
        termino: 'Duplicado',
        explicacion: 'Dos registros para una sola cosa del mundo real: la misma persona, la misma póliza en el mismo mes, la misma baja. Los dejaba la sincronización cuando dos computadoras se pisaban; desde la 12.6 eso no vuelve a pasar, y esta pantalla es para limpiar lo que quedó.',
      },
    ],
  },
  'cartera.estadisticas': {
    clave: 'cartera.estadisticas',
    titulo: 'Cartera → Estadísticas',
    resumen: 'Los mismos números del módulo Métricas, pero en tabla, para comparar fila por fila con la planilla de la agencia.',
    secciones: [
      {
        titulo: 'Para qué sirve',
        parrafos: [
          'Es la versión tabular de Métricas: en vez de tarjetas y gráficos, muestra los totales en filas y columnas para poder ponerla al lado de la hoja de Google y comprobar que los números coinciden, uno por uno. No tiene nada para cargar ni editar: es sólo para mirar y comparar.',
          'Se puede elegir el mes y la sucursal con los selectores de arriba, igual que en Métricas.',
        ],
      },
      {
        titulo: 'Qué se compara',
        parrafos: [
          'Muestra activos y altas por compañía (y por otros cortes según lo que traiga la pantalla), con los totales al pie. Si el mes elegido no tiene un mes anterior importado, las altas muestran un guion (no un cero), porque para calcular una alta hace falta comparar contra el mes de antes; en cuanto se importe ese mes anterior, el número aparece solo. Cada póliza se cuenta una sola vez aunque figure en dos renglones.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Activos',
        explicacion: 'Las pólizas que estuvieron vigentes ese mes, sin importar si hoy siguen activas o no: es una foto de ese mes puntual, no del presente.',
      },
      {
        termino: 'Altas',
        explicacion: 'Pólizas que aparecen en el mes elegido y no estaban en el mes anterior. Necesita el mes anterior importado para poder calcularse.',
      },
    ],
  },
}
