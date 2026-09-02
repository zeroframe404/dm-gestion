import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_CLIENTES: Record<string, ContenidoDeAyuda> = {
  clientes: {
    clave: 'clientes',
    titulo: 'Clientes',
    resumen: 'Toda la cartera en una sola tabla: buscá a cualquiera en segundos y entrá a su ficha con un clic.',
    secciones: [
      {
        titulo: 'El listado',
        parrafos: [
          'Acá está cada persona dada de alta en la agencia, con su nombre, DNI o CUIT, teléfono, sucursal, cuántas pólizas activas y cuántos vehículos tiene, y si está al día o debe algo. El buscador de arriba encuentra por nombre, DNI, patente, número de póliza o teléfono: no hace falta escribirlo entero, con el apellido o los últimos números de la patente ya aparece. Los filtros de «Sucursal» y «Compañía» acotan más todavía, y cada uno deja tildar varias a la vez —Dock Sud y Daniel juntas, por ejemplo—; «Limpiar» los saca a todos de una vez.',
          'Tocar el nombre de cualquiera (o hacer clic en cualquier parte de la fila) abre su ficha completa. «Actualizar» vuelve a traer el listado por si alguien acaba de cargar algo desde otra computadora.',
        ],
      },
      {
        titulo: 'Los cuatro estados',
        parrafos: [
          'Arriba de la tabla hay cuatro botones que separan la cartera sin superponerse; el número al lado de cada uno dice cuántos clientes va a traer si lo tocás. Sirven para responder de un vistazo preguntas como «¿a quién le tengo que cobrar hoy?» o «¿quién se nos fue?».',
        ],
        lista: [
          'Activos sin deuda: tienen alguna póliza activa y ninguna cuota del mes abierto sin pagar.',
          'Activos con deuda: tienen alguna cuota del mes abierto sin pagar, de las que no se cobran solas (no cuenta débito automático, CBU ni tarjeta: a ésas no hace falta reclamarles).',
          'Bajas: tuvieron pólizas alguna vez y hoy no les queda ninguna activa.',
          'Sin pólizas: están dados de alta pero todavía no se les cargó ninguna póliza (por ejemplo, se acaba de crear el cliente y falta cargarle el vehículo). Este botón sólo aparece si hay alguno.',
        ],
      },
      {
        titulo: 'Buscar deudores',
        parrafos: [
          'Es una búsqueda aparte, más fina que el listado general: se abre con el botón «Buscar deudores» y arma una lista de morosos filtrando por sucursal, compañía, forma de pago y hasta por el día del mes en que vence la cuota (por ejemplo, «todos los que vencen el día 10»). Sirve para armar una tanda de llamados o de avisos bien puntual, y la lista se puede exportar a un archivo.',
        ],
      },
      {
        titulo: 'Nuevo cliente',
        parrafos: [
          'El botón «Nuevo cliente» da de alta a una persona con sus datos básicos. Apenas se crea, la aplicación abre directamente su ficha para cargarle la primera póliza: un cliente sin ninguna póliza cargada todavía va a aparecer en el grupo «Sin pólizas» hasta que se la carguen.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Cuota del mes abierto',
        explicacion: 'La cuota del mes que está corriendo ahora. Los estados «con deuda» y «sin deuda» sólo miran esa cuota, no las de meses anteriores.',
      },
      {
        termino: 'Baja',
        explicacion: 'Un cliente que tuvo pólizas y hoy no le queda ninguna activa. Es distinto de «Sin pólizas», que nunca llegó a tener una.',
      },
      {
        termino: 'Eliminar cliente',
        explicacion:
          'El botón rojo de la ficha, que sólo ve un superadministrador: borra a la persona de la base con sus vehículos, sus pólizas, sus cuotas, sus pagos y sus siniestros, para siempre. Si el cliente simplemente se fue, lo que corresponde es dar de baja sus pólizas, no borrarlo.',
      },
      {
        termino: 'Sin pólizas',
        explicacion: 'Un cliente recién dado de alta al que todavía no se le cargó ninguna póliza. No es lo mismo que una baja: nunca tuvo cobertura, no la perdió.',
      },
    ],
  },
  'clientes.datos': {
    clave: 'clientes.datos',
    titulo: 'Ficha del cliente → Datos',
    resumen: 'Los datos personales del cliente: el único lugar de la ficha donde se edita directamente, con «Guardar cambios» y «Descartar».',
    secciones: [
      {
        titulo: 'Qué se carga acá',
        parrafos: [
          'Nombre y apellido, DNI o CUIT, teléfono, email, dirección, localidad, sucursal y fecha de nacimiento. El DNI o CUIT es lo que identifica al cliente: dos personas no pueden compartir el mismo. El campo «Sucursal» sugiere las sucursales de la agencia mientras se escribe, pero deja escribir cualquier otra cosa, porque a veces la planilla de toda la vida trae variantes que no conviene pisar sin preguntar antes.',
          'El botón «Guardar cambios» sólo se activa cuando hay algo tipeado distinto de lo que ya había, y «Descartar» vuelve todo a como estaba sin guardar nada. Un cartelito abajo avisa si hay cambios sin guardar.',
        ],
      },
    ],
  },
  'clientes.vehiculos': {
    clave: 'clientes.vehiculos',
    titulo: 'Ficha del cliente → Vehículos y riesgos',
    resumen:
      'Todo lo que el cliente tiene asegurado: sus autos y motos con patente, marca, modelo y año, y también su casa, su comercio, su bicicleta o las personas de un accidentes personales, con cuántas pólizas tiene cada uno.',
    secciones: [
      {
        titulo: 'Cómo se carga un vehículo o un riesgo',
        parrafos: [
          'Esta pestaña es sólo para consultar: no hay ningún botón para agregar un vehículo suelto. Los vehículos y los demás riesgos se dan de alta junto con la póliza, así que si el cliente compró un auto nuevo o contrató un seguro de hogar, la forma de cargarlo es «Nueva póliza» desde el encabezado de la ficha: ahí se elige el tipo de riesgo y se completa con su patente, su dirección o sus integrantes al mismo tiempo que la póliza.',
          'La columna «Detalle» muestra lo que distingue a los riesgos que no son vehículos: la dirección de la casa o del local, las personas cubiertas, o a nombre de quién está.',
        ],
      },
    ],
  },
  'clientes.polizas': {
    clave: 'clientes.polizas',
    titulo: 'Ficha del cliente → Pólizas',
    resumen: 'Las pólizas del cliente separadas en dos grupos: las activas arriba y el histórico de bajas abajo.',
    secciones: [
      {
        titulo: 'Activas e histórico',
        parrafos: [
          'Arriba están las pólizas vigentes o vencidas (una póliza vencida sigue en este grupo, en ámbar, porque sigue siendo cartera: hay que renovarla, no se dio de baja). Abajo está el histórico, con el motivo y la fecha de cada baja cuando se cargaron. Tocar cualquier fila abre esa póliza en el módulo Pólizas, con todos sus datos y el botón para editarla.',
        ],
      },
    ],
    conceptos: [
      { termino: 'Vencida', explicacion: 'La póliza ya pasó su fecha de vigencia pero no se dio de baja: sigue siendo cartera y hay que gestionar la renovación.' },
    ],
  },
  'clientes.pagos': {
    clave: 'clientes.pagos',
    titulo: 'Ficha del cliente → Pagos',
    resumen: 'El historial de cuotas pagadas por este cliente, con fecha, importe, medio de pago, compañía y período.',
    secciones: [
      {
        titulo: 'De dónde salen estos pagos',
        parrafos: [
          'Es una pantalla de sólo consulta. Los pagos se cargan desde la Planilla del mes, sobre la cuota que se está cobrando, y también aparecen acá los que ya venían imputados en la hoja de siempre. Si un cliente todavía no tiene ningún pago cargado, la pestaña lo dice y explica dónde cargarlo.',
        ],
      },
    ],
  },
  'clientes.siniestros': {
    clave: 'clientes.siniestros',
    titulo: 'Ficha del cliente → Siniestros',
    resumen: 'Los siniestros vinculados a este cliente, con la fecha, el estado y una descripción corta.',
    secciones: [
      {
        titulo: 'Qué se ve acá y dónde se hace el seguimiento',
        parrafos: [
          'Esta pestaña junta los siniestros que vinieron de la planilla de siempre y los que se cargaron desde «Cargar siniestro», en el encabezado de la ficha. Tocar cualquier fila lleva a la ficha completa de ese siniestro, en el módulo Siniestros, que es donde está el seguimiento entero: el estado, las observaciones con fecha, los documentos adjuntos y las tareas relacionadas.',
        ],
      },
    ],
  },
  'clientes.notas': {
    clave: 'clientes.notas',
    titulo: 'Ficha del cliente → Notas y tareas',
    resumen: 'Un cuaderno de bitácora del cliente (notas que quedan para siempre) y sus tareas pendientes.',
    secciones: [
      {
        titulo: 'Notas',
        parrafos: [
          'Cualquiera del equipo puede escribir una nota sobre este cliente: quedan con el nombre de quien la escribió y la fecha, y no se pueden borrar ni editar, sólo se van sumando. Sirven para que quien atienda la próxima llamada sepa qué pasó la vez anterior, aunque no haya sido quien atendió esa vez.',
        ],
      },
      {
        titulo: 'Tareas',
        parrafos: [
          'Al lado están las tareas de este cliente, con «Nueva tarea» para crear una vinculada (por ejemplo «llamar por la renovación» o «pedir la cédula verde»). Se pueden marcar como pendiente, en curso o hecha directamente desde acá, sin tener que ir al módulo Tareas.',
        ],
      },
    ],
  },
}
