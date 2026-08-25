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
          'Pasando el mouse por la etiqueta de color se ve el detalle exacto (fecha de vencimiento y, si corresponde, hasta cuándo cubre la compañía).',
        ],
      },
      {
        titulo: 'Las cuatro acciones por fila',
        parrafos: [
          'En la columna «Acciones» hay cuatro botones chiquitos para cada fila: avisar por WhatsApp, marcar como avisado, registrar un pago y dar de baja.',
          '«Avisar» (el globito) abre WhatsApp con un mensaje ya armado para ese cliente y deja la fila marcada como avisada. «Avisado» (el tilde) hace lo mismo con la planilla —deja la fila en ENVIADO con la fecha de hoy y la suma a «Avisados hoy»— pero sin abrir WhatsApp: es para cuando ya se le avisó por otro lado, por teléfono, en el mostrador o desde el celular. No hace falta que el cliente tenga teléfono cargado.',
          '«Registrar pago» abre un formulario para cargar cómo y cuándo se pagó esa cuota, sin salir de la planilla. «Dar de baja» saca la póliza de la cartera activa y la manda a Cartera → Bajas, pidiendo el motivo.',
          'Las cuatro acciones quedan deshabilitadas en un mes cerrado (sólo lectura).',
        ],
      },
      {
        titulo: 'Buscar y filtrar',
        parrafos: [
          'El buscador de arriba encuentra por nombre, patente, número de póliza o DNI. Al lado hay desplegables para filtrar por sucursal, forma de pago, compañía, tipo de vehículo (auto, moto, pick up…) y color de alerta, y una casilla «Sólo con AVISAR VTO» para ver nada más que las filas marcadas para avisar antes del vencimiento.',
          'Las tarjetas de arriba (Total, Vencen hoy, Vencidos, Avisados hoy, Pagados hoy) son contadores del día: se actualizan solos con lo que va pasando. Además funcionan como filtro: tocá una y la tabla queda sólo con esas filas; tocala de nuevo (o tocá Total) para volver a ver el mes entero. Los números siguen contando sobre todo el mes aunque haya un filtro puesto.',
        ],
      },
      {
        titulo: 'La columna «Propuesta»',
        parrafos: [
          'Al lado de «Póliza» está la columna «Propuesta», para el número que dan algunas compañías mientras la póliza todavía no está emitida. Se carga con doble clic, igual que el resto.',
          'La propuesta se guarda en la póliza —se ve también en Pólizas y en la ficha del cliente, y sigue estando el mes que viene— pero no viaja a la hoja de Google: es un dato interno de la agencia y la hoja no tiene esa columna.',
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
    resumen: 'Quién dejó de ser cliente en el mes elegido, con el motivo y la fecha.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el listado de las pólizas que se dieron de baja en un mes, con el nombre, DNI, compañía, número de póliza, patente, sucursal, motivo y fecha de la baja. Se elige el mes con el selector de arriba, igual que en la Planilla.',
          'Una baja se puede originar de dos maneras: apretando «Dar de baja» en una fila de la Planilla del mes (con motivo y nota opcional), o porque ya venía así cargada en la hoja de la agencia al importar. Las etiquetas «En la app» y «De la hoja», a la derecha de cada fila, dicen de cuál de las dos vino.',
        ],
      },
      {
        titulo: 'Buscar una baja',
        parrafos: [
          'El buscador de arriba (la lupa) filtra la lista del mes por nombre, patente, número de póliza, DNI, compañía o sucursal, igual que en Siniestros. Sirve para encontrar rápido a alguien puntual sin recorrer toda la lista.',
        ],
      },
      {
        titulo: 'Qué pasa con los datos de una baja',
        parrafos: [
          'Dar de baja no borra nada: el cliente, el vehículo (patente, marca, modelo, motor, chasis) y la póliza siguen guardados. Lo que cambia es que la póliza deja de estar activa, sale de la planilla del mes y aparece acá con su motivo.',
          'Si esa persona vuelve dentro de un mes o de un año, se abre su ficha en Clientes y está todo: se le carga una póliza nueva eligiendo el vehículo que ya tiene cargado, sin volver a tipear nada. Y si la baja fue un error, se deshace con el botón «Deshacer» de esta misma pantalla.',
        ],
      },
      {
        titulo: 'Deshacer una baja',
        parrafos: [
          'Las bajas hechas desde la aplicación (etiqueta «En la app») se pueden deshacer con el botón «Deshacer»: la póliza vuelve a la cartera activa como si nunca se hubiera dado de baja. Sólo lo pueden hacer los roles con más permisos (no el Empleado).',
          'Las bajas que ya venían de la hoja («De la hoja») no tienen botón de deshacer acá: si hay que revertirlas hay que corregirlo en el origen.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'En la app / De la hoja',
        explicacion:
          'Marca de origen de la baja: «En la app» es una baja hecha con el botón «Dar de baja» desde DM Gestión (se puede deshacer); «De la hoja» ya venía cargada así en la planilla de la agencia (no se deshace desde acá).',
      },
      {
        termino: 'Motivo',
        explicacion: 'La razón de la baja (por ejemplo, cambio de compañía o vehículo vendido), si se cargó al darla de baja. Puede venir vacío si la hoja original no tenía esa columna.',
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
          'Cada cambio que se hace acá también sube a la hoja de la agencia, así que queda sincronizado para quien la mire desde Google.',
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
          'Muestra activos y altas por compañía (y por otros cortes según lo que traiga la pantalla), con los totales al pie. Si el mes elegido no tiene un mes anterior importado, las altas quedan en cero, porque para calcular una alta hace falta comparar contra el mes de antes; en cuanto se importe ese mes anterior, el número aparece solo.',
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
