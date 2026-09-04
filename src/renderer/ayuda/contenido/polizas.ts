import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_POLIZAS: Record<string, ContenidoDeAyuda> = {
  polizas: {
    clave: 'polizas',
    titulo: 'Pólizas',
    resumen:
      'Una fila por cada póliza de la cartera, con su vigencia y su estado a la vista, y el alta o la edición en la misma pantalla.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es el listado completo de pólizas de la agencia: cliente, compañía, número, cobertura, patente y vehículo, cuota, vigencia y estado. Hacé clic en cualquier fila para abrirla y corregir lo que haga falta. Arriba tenés un buscador (por cliente, DNI/CUIT, número de póliza o patente) y cuatro filtros —Estado, Compañía, Sucursal y Cobertura— que se pueden combinar entre sí.',
          'No es lo mismo que la Cartera: la Cartera muestra la planilla del mes con lo que hay que cobrar; Pólizas muestra el historial completo de cada póliza, esté vigente, vencida o dada de baja, sin importar el mes.',
        ],
      },
      {
        titulo: 'Fotos y documentos de la póliza',
        parrafos: [
          'Abajo a la derecha del formulario, en «Fotos y documentos», se le adjuntan a la póliza las fotos del auto o la moto, el frente de la póliza, la cédula, lo que haga falta: se arrastran a la ventana, se pegan con Ctrl+V o se eligen con «Elegir archivos». Sin límite de cantidad. Las fotos se achican solas antes de subir (una de 6 MB queda en menos de 1 MB) sin que se note la diferencia; los PDF y documentos van tal cual.',
          'Todo sube al servidor de la agencia y se ve desde cualquier computadora: una foto cargada en Lanús se abre en Dock Sud con un clic (la primera vez se baja del servidor). Las fotos se muestran como miniaturas y se abren con el visor de Windows. Borrar un archivo es definitivo y queda para administradores.',
        ],
      },
      {
        titulo: 'Los tres estados de una póliza',
        parrafos: [
          'El estado se calcula solo, no lo elige nadie a mano. Una póliza está Activa mientras no se le puso una fecha de baja y su vigencia no pasó (o no tiene vigencia cargada, en cuyo caso se la sigue considerando activa). Pasa a Vencida cuando su fecha de vigencia «hasta» ya quedó atrás pero nadie la dio de baja: sigue siendo parte de la cartera, sólo que hay que renovarla o resolverla, por eso se marca en ámbar y no en rojo. Pasa a Baja únicamente cuando alguien la dio de baja a propósito, con un motivo.',
          'Cuando a una póliza activa le quedan 60 días o menos para vencer, la fila muestra además un aviso tipo «vence en 12 días» (o «vence hoy», «vence mañana»): es la misma cuenta que usa la bandeja de Renovaciones, así que las dos pantallas van a decir siempre lo mismo.',
        ],
      },
      {
        titulo: 'Cargar o editar una póliza',
        parrafos: [
          'Con «Nueva póliza» arrancás una en blanco; haciendo clic en una fila entrás a editar esa póliza. Primero se elige el cliente (buscándolo por nombre o DNI, o ya viene elegido si entraste desde la ficha de un cliente) y después el riesgo asegurado: uno de los que ya tiene cargados (sus autos, su casa, su bicicleta…) o uno nuevo. Si el cliente no tiene nada cargado, la pantalla pasa sola a «Cargar uno nuevo».',
          'En «Cargar uno nuevo» lo primero es el tipo de riesgo. Auto y moto se cargan como siempre: marca, modelo, línea y año del catálogo (o a mano), patente, uso, color, motor y chasis. Bicicleta pide la marca y el número de cuadro. Accidente personal pide a cada persona cubierta: viene puesto el cliente como titular y con «Agregar integrante» se suman las demás, cada una con su nombre completo y su DNI. Hogar e integral de comercio piden la dirección del riesgo (la casa o el local) y a nombre de quién está la póliza. Otros pide sólo el nombre y el DNI de la persona asegurada.',
          'Después van los datos de la póliza en sí, iguales para cualquier riesgo: compañía, cobertura (obligatoria en un vehículo, opcional en el resto), forma de pago, cuota, día de vencimiento de la cuota, número de póliza y de propuesta, y la vigencia (desde y hasta). Las fechas de vigencia se escriben tal como están en la planilla de siempre, porque conviven fechas escritas de formas distintas y no tiene sentido forzarlas todas al mismo molde. El campo «Avisar vto.» se completa con AVISAR cuando esa póliza tiene que entrar en los avisos de vencimiento; y en «Observaciones» se puede anotar, por ejemplo, «20% aumentar cuando se renueva», que es justo el texto que hace aparecer el aviso de aumento en la bandeja de Renovaciones.',
        ],
      },
      {
        titulo: 'El aviso de antigüedad',
        parrafos: [
          'Mientras se completan la compañía, la cobertura y el año del vehículo, la pantalla avisa sola si esa compañía no acepta esa cobertura para un auto tan viejo (según lo que esté cargado en Cartera → Reglas de cobertura). Si no hay ninguna regla cargada para esa combinación, o el año del vehículo no se puede leer, no aparece ningún aviso: la ayuda es eso, una ayuda, nunca un impedimento por las dudas. El aviso es sólo para autos y motos: una casa, una bicicleta o un accidentes personales no tienen año que validar.',
          'Cuando el aviso sí aparece y es un problema real, un administrador o superadministrador puede tildar «Continuar igual» para guardar la póliza de todas formas (queda registrado que la confirmó esa persona); un empleado de mostrador ve el mismo aviso pero no puede destildarlo: tiene que pedirle a un administrador que la confirme.',
        ],
      },
      {
        titulo: 'Dar de baja una póliza',
        parrafos: [
          'Desde una póliza ya cargada, el botón «Dar de baja» pide un motivo (por ejemplo, vendió el auto, se cambió de compañía, anuló) y una nota, y saca la póliza de la cartera activa: pasa a verse en Cartera → Bajas y su estado queda en Baja. La baja se lleva una foto completa de la póliza, así que en Bajas se sigue viendo todo lo que tenía y no sólo el nombre y el motivo.',
          'Si esa persona vuelve no hace falta cargarla de nuevo: en Cartera → Bajas, el botón «Poner vigente» la devuelve a la planilla del mes con los últimos datos que tenía, y desde ahí se corrige lo que haya cambiado.',
        ],
      },
      {
        titulo: 'Avisar un rechazo del débito',
        parrafos: [
          'El botón «Avisar rechazo del débito», arriba de la póliza, es para cuando la compañía rebota el CBU o la tarjeta de ese cliente. Le manda un aviso a la sucursal que lo atiende —viene elegida la de la póliza, se puede cambiar— para que lo llamen y lo cobren a mano.',
          'A esa sucursal le aparece en la campana del triángulo, arriba a la derecha, apenas entran al programa, aunque trabajen en otra computadora. El seguimiento de todos los avisos se hace en Cartera → Rechazos.',
          'Funciona también con una póliza dada de baja: al que anularon por falta de pago igual hay que llamarlo, y muchas veces la baja es justamente la consecuencia del rechazo.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Activa',
        explicacion: 'La póliza está en la cartera y su vigencia todavía no pasó (o no tiene vigencia cargada).',
      },
      {
        termino: 'Vencida',
        explicacion: 'La fecha «vigencia hasta» ya pasó pero nadie la dio de baja: sigue siendo cartera, hay que renovarla.',
      },
      {
        termino: 'Baja',
        explicacion: 'Alguien la dio de baja a propósito, con un motivo. Es el único estado que se elige a mano.',
      },
      {
        termino: 'Riesgo asegurado',
        explicacion:
          'Lo que cubre la póliza: un auto o una moto, una bicicleta, las personas de un accidentes personales, una casa (hogar), un local (integral de comercio) u otra cosa. Cada uno pide sólo sus datos y queda cargado en la ficha del cliente, en la pestaña Vehículos y riesgos.',
      },
      {
        termino: 'Aviso de antigüedad',
        explicacion:
          'Mensaje que avisa si la compañía elegida no acepta esa cobertura para un vehículo tan viejo, según las reglas cargadas en Cartera → Reglas de cobertura. Sólo un administrador puede confirmar «Continuar igual» cuando hay un problema real.',
      },
      {
        termino: '«Vence en X días»',
        explicacion: 'Aviso que aparece cuando a una póliza activa le quedan 60 días o menos de vigencia: la misma cuenta que usa la bandeja de Renovaciones.',
      },
    ],
  },
}
