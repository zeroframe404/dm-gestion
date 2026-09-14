import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_ADMINISTRACION: Record<string, ContenidoDeAyuda> = {
  'administracion.usuarios': {
    clave: 'administracion.usuarios',
    titulo: 'Administración → Usuarios',
    resumen: 'Quién puede entrar a DM Gestión, con qué rol y en qué sucursal. Sólo la ve un superadministrador.',
    secciones: [
      {
        titulo: 'Qué se hace acá',
        parrafos: [
          'Esta pantalla es donde se crean, editan y desactivan los usuarios de la agencia, se les asigna un rol y una sucursal, y se resetean contraseñas cuando alguien se olvida la suya. Es la única sección que ve exclusivamente el superadministrador: ni un administrador ni un empleado pueden entrar acá.',
          'Los usuarios se comparten automáticamente entre todas las computadoras y todas las sucursales: si creás o editás a alguien desde una PC, ese cambio vale para todas las demás sin tener que repetir nada. Con «Nuevo usuario» se da de alta a alguien, con una contraseña inicial que va a tener que cambiar la primera vez que ingrese; «Editar» cambia nombre, usuario, rol o sucursal; «Resetear contraseña» define una contraseña temporal para cuando alguien se la olvidó; y el botón de encendido activa o desactiva a una persona (desactivarla no borra sus datos, sólo le impide iniciar sesión).',
        ],
      },
      {
        titulo: 'Los tres roles',
        parrafos: [
          'EMPLEADO ve y usa el día a día de la agencia (cartera, clientes, cobranzas, siniestros, etcétera) y de Administración entra a «Compañías», «Impresora», «Sincronizar» y «Acerca de», que las ve todo el mundo. Lo que no ve un empleado son los números agregados de la agencia: lo recaudado del mes, el porcentaje de comisión de cada compañía y la estimación de comisiones. Sí ve todo lo que necesita para trabajar: la caja de su sucursal, la mora que tiene que cobrar y la cuota de la persona que tiene delante. ADMIN ve además Base de datos, Sincronización, Reimportar la base y Google Drive, y sí ve los números de la agencia. SUPER_ADMIN tiene todo lo anterior más esta pantalla, Usuarios, y es el único que puede resolver un problema serio con la lista compartida de usuarios si llegara a aparecer.',
          'Eso es lo que trae cada rol de fábrica, y se puede recortar módulo por módulo en Administración → Permisos: por ejemplo, dejar a los empleados con Cobranzas en «sólo ver» o sin Marketing. Lo que ahí se configura vale para todas las computadoras de la agencia.',
        ],
      },
      {
        titulo: 'Ingresar sin conexión a internet',
        parrafos: [
          'Cada computadora recuerda, de forma segura, la última persona que entró ahí con internet, para que pueda seguir trabajando aunque se corte la conexión: alcanza con la misma contraseña que usó la última vez. En cuanto vuelve internet, esa sesión se vuelve a confirmar sola contra la lista compartida, sin que haga falta hacer nada. Si en un mostrador varias personas usan la misma computadora, sólo la última que entró con conexión queda guardada para entrar sin internet ahí.',
          'Si la lista compartida todavía está vacía (una agencia recién configurada), un cartel lo avisa y ofrece «Subir usuarios»: se hace una sola vez, desde la computadora que ya tiene cargada la gente real, para que a partir de ahí todas las demás compartan la misma lista.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Rol',
        explicacion: 'Qué partes de la aplicación puede ver y usar cada persona: EMPLEADO, ADMIN o SUPER_ADMIN, de menos a más permisos.',
      },
      {
        termino: 'Ingresar sin internet',
        explicacion: 'Cada computadora puede dejar entrar, sin conexión, a la última persona que se conectó ahí con internet, usando su última contraseña válida. Al volver la conexión, se revalida sola.',
      },
      {
        termino: 'Subir usuarios',
        explicacion: 'El paso único, desde la computadora con la lista real de gente, para que todas las sucursales empiecen a compartir la misma lista de usuarios.',
      },
      {
        termino: 'Desactivar',
        explicacion: 'Le impide a una persona iniciar sesión, sin borrar nada de lo que cargó antes. Se puede reactivar en cualquier momento.',
      },
    ],
  },
  'administracion.registromensajes': {
    clave: 'administracion.registromensajes',
    titulo: 'Administración → Registro de mensajes',
    resumen: 'Todo lo que se habló por el chat interno de la agencia. Sólo la ve el superadministrador.',
    secciones: [
      {
        titulo: 'Qué muestra',
        parrafos: [
          'Todos los mensajes del chat interno, de todas las conversaciones, incluidas aquellas en las que el superadministrador no participa. Se puede buscar por persona (los mensajes que escribió y los de las conversaciones donde estuvo), por texto, y acotar por fechas.',
          'Los mensajes borrados aparecen igual, con el texto original y una marca roja que dice quién los borró y cuándo. Borrar un mensaje lo saca de la conversación de la gente, no del registro: si lo sacara de acá también, esta pantalla no serviría para lo único para lo que sirve.',
          'La columna «Llegada y lectura» dice a cuántos les llegó y cuántos lo leyeron, que es la misma información que ve como tildes quien lo escribió.',
        ],
      },
      {
        titulo: 'Quién puede entrar',
        parrafos: [
          'Sólo el superadministrador, y no se puede delegar desde la pantalla de Permisos. El control está en tres lugares: la pestaña no se dibuja para los demás roles, el programa lo vuelve a pedir antes de consultar y el servidor de la agencia —que es el que tiene los mensajes— lo pide por tercera vez. Los tres hacen falta: esconder un botón no protege nada.',
          'Es información de conversaciones entre compañeros de trabajo. Está para lo que tiene que estar —una discusión sobre lo que se dijo, un reclamo, una auditoría— y conviene tratarla así.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Entregado y leído',
        explicacion:
          'Entregado es que el mensaje llegó a la computadora de la otra persona; leído, que abrió la conversación con el mensaje a la vista.',
      },
    ],
  },
  'administracion.permisos': {
    clave: 'administracion.permisos',
    titulo: 'Administración → Permisos',
    resumen: 'Qué módulos ve y cuáles puede modificar cada rol. Sólo la ve y la cambia un superadministrador.',
    secciones: [
      {
        titulo: 'Cómo se lee la tabla',
        parrafos: [
          'Hay una fila por cada módulo de la barra lateral y una columna por rol: Administrador y Empleado. En cada cruce se elige una de tres opciones. «Sin acceso» hace que ese módulo directamente no aparezca en la barra lateral de esa persona (y si intenta entrar igual, no se le abre). «Sólo ver» le deja abrir el módulo y mirar todo, pero los botones que cambian algo quedan apagados. «Ver y editar» es lo de siempre: trabaja el módulo como hasta ahora.',
          'El superadministrador no tiene columna porque siempre tiene acceso completo a todo. Es a propósito: si pudiera sacarse permisos a sí mismo, la agencia se quedaría sin nadie que pueda devolvérselos.',
        ],
      },
      {
        titulo: 'Qué NO cambia con esto',
        parrafos: [
          'Los controles que ya existían por rol siguen valiendo igual, encima de lo que diga esta tabla. Cerrar el mes, deshacer una baja, ver las comisiones, borrar un documento de un siniestro o de una tarea, y administrar usuarios siguen pidiendo administrador o superadministrador aunque a un empleado se le dé «ver y editar» en ese módulo. En otras palabras: esta pantalla sirve para recortar, nunca para dar más de lo que el rol ya tenía.',
          '«Acerca de» se ve siempre, aunque Administración quede en «sin acceso»: ahí está la versión del programa y el estado de la conexión, que es lo primero que se pregunta cuando algo falla. Inicio tampoco se puede sacar: es la pantalla que queda cuando alguien no tiene ningún otro módulo.',
        ],
      },
      {
        titulo: 'El botón de eliminar',
        parrafos: [
          'Hay un botón rojo con una papelera que borra un registro de la base para siempre: un cliente, una póliza, una fila de la planilla, una baja, un aviso de rechazo, un lead, un presupuesto, un siniestro, un riesgo vario, una ampliación o una tarea. Quién puede borrar qué depende de cuál sea: EL CLIENTE lo borran los tres roles —superadministrador, administradores y empleados—, y TODO LO DEMÁS sigue siendo únicamente del superadministrador. Para quien no puede borrar ese tipo, el botón no existe: no aparece apagado ni con un cartel, directamente no está.',
          'El cliente se abrió porque el caso de todos los días es el alta cargada dos veces o el DNI mal tipeado, y esperar a otra persona para sacar una fila que nadie quería la dejaba apareciendo en la planilla, en la mora y en los avisos de WhatsApp. Además hace falta poder EDITAR el módulo de donde sale el registro: a quien tiene Clientes en «sólo ver» tampoco se le abre la papelera de un cliente.',
          'El resto no se puede dar por esta pantalla ni por ninguna otra, y es a propósito. Una póliza, una baja o una fila de la planilla son piezas de la cartera: se dan de baja, se deshacen, se ponen vigentes o se corrigen, y todo eso un administrador ya lo tiene. Borrarlas es otra cosa y no se revierte.',
          'Antes de borrar, la aplicación abre un cartel que dice exactamente qué se lleva puesto («3 pólizas, 42 cuotas del mes, 12 pagos»), qué renglones se sacan de la hoja de Google y qué conviene saber antes. El botón de confirmar arranca apagado y se enciende recién a los cinco segundos, con la cuenta a la vista: es el rato que se tarda en leer esa lista. Todo borrado queda anotado en el historial con quién lo hizo, cuándo y qué decía el registro.',
        ],
      },
      {
        titulo: 'Dónde se guardan',
        parrafos: [
          'Los permisos viajan junto con la lista compartida de usuarios, así que valen igual en todas las computadoras de la agencia: se configuran una vez desde cualquier PC y el resto los toma la próxima vez que lee la lista (como mucho, unos minutos; en el momento, si la persona vuelve a entrar). Si todavía no se subió la lista compartida, valen sólo en esta computadora y suben con ella cuando se inicialice.',
          'Cada cambio queda anotado en el historial con quién lo hizo y qué cambió, igual que cualquier otro cambio de la aplicación.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Sin acceso',
        explicacion: 'El módulo no aparece en la barra lateral de ese rol y no se puede abrir.',
      },
      {
        termino: 'Sólo ver',
        explicacion: 'Puede abrir el módulo y consultarlo, pero no cargar, editar ni borrar nada ahí adentro.',
      },
      {
        termino: 'Ver y editar',
        explicacion: 'Trabaja el módulo con normalidad, siempre dentro de lo que ya permitía su rol.',
      },
      {
        termino: 'Eliminar',
        explicacion:
          'Borrar un registro de la base para siempre, con todo lo que cuelga de él. Es del superadministrador y no se puede dar por permisos. No es lo mismo que dar de baja: la baja guarda la historia, esto la saca.',
      },
    ],
  },
  'administracion.companias': {
    clave: 'administracion.companias',
    titulo: 'Administración → Compañías',
    resumen: 'Los días de cobertura financiera de cada aseguradora, cada cuánto se renueva y el mensaje del aviso de vencimiento. La miran todos; la editan los administradores.',
    secciones: [
      {
        titulo: 'Días de cobertura financiera',
        parrafos: [
          'Cada compañía sigue cubriendo al cliente durante unos días después del vencimiento de la cuota, aunque todavía no haya pagado; eso son los «días de cobertura financiera», y varían de una aseguradora a otra. Mientras corren esos días, la fila de esa póliza se ve amarilla en la planilla de la Cartera; el último día se ve naranja; y una vez que se acaban, sin pago, la fila pasa a roja. Este número se edita a mano en la columna «Días de cobertura»: se hace clic en el número, se escribe el nuevo y se guarda solo al salir del campo.',
        ],
      },
      {
        titulo: 'Quién ve y quién toca esta pantalla',
        parrafos: [
          'La mira todo el equipo, con el rol que sea: los días de cobertura de cada compañía son los que explican por qué la fila que tenés delante está amarilla y no roja, y saber si una compañía renueva sola o a mano es la mitad de una llamada. Cambiar los números sigue siendo cosa de administradores, porque un cambio acá repinta la planilla de todas las sucursales.',
          'Y las repinta de verdad: lo que se guarda acá sale para todas las computadoras de la agencia apenas se guarda, junto con el mensaje del aviso. Antes había que cargarlo máquina por máquina, y dos sucursales podían ver la misma póliza de dos colores distintos y discutir cuál tenía razón.',
        ],
      },
      {
        titulo: 'Porcentaje de comisión',
        parrafos: [
          'Es lo que la aseguradora le reconoce a la agencia por cada póliza. Se usa en Cobranzas → Comisiones para estimar cuánto deja cada mes según lo que se cobró. Se edita igual que los días de cobertura: clic en el número de la fila de esa compañía, escribir el nuevo porcentaje y listo.',
          'Esta columna la ven sólo los administradores: es lo que gana la agencia, no algo que haga falta para atender. A un empleado la tabla le aparece sin ella.',
        ],
      },
      {
        titulo: 'Renovación (meses)',
        parrafos: [
          'La mayoría de las compañías renueva sola y la agencia no tiene que hacer nada: esas pólizas no aparecen en la bandeja de Renovaciones y esta columna queda vacía. Las que sí hay que renovar a mano llevan acá cada cuántos meses: Agrosalta 4, Río Uruguay 6 y Metropol 12, que vienen cargadas de fábrica.',
          'Ese número hace dos cosas: decide qué pólizas se ven en Renovaciones y cuánto dura la vigencia que el sistema propone al renovar (por ejemplo, en Agrosalta propone cuatro meses después, no un año). Para sacar una compañía de la bandeja alcanza con borrar el número y dejar la celda vacía.',
        ],
      },
      {
        titulo: 'El mensaje del aviso de vencimiento',
        parrafos: [
          'Es el texto que se manda cuando se toca «Avisar» en la Cartera o en la Mora, con {nombre}, {cuota} y {vencimiento} que se completan solos con los datos de cada persona. Se puede editar libremente y, si algo sale mal, «Restaurar el original» lo vuelve a dejar como viene de fábrica. Abajo del cuadro de texto se ve cómo queda el mensaje con un ejemplo, antes de guardar.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Días de cobertura financiera',
        explicacion: 'Los días que una compañía sigue cubriendo al cliente después del vencimiento sin haber cobrado. Definen cuándo la fila de la planilla pasa de amarilla a naranja y a roja.',
      },
      {
        termino: 'Comisión',
        explicacion: 'El porcentaje que la aseguradora le paga a la agencia por cada póliza, usado para estimar lo que deja el mes en Cobranzas → Comisiones.',
      },
      {
        termino: 'Renovación (meses)',
        explicacion:
          'Cada cuántos meses hay que renovar a mano en esa compañía (Agrosalta 4, Río Uruguay 6, Metropol 12). Vacío quiere decir que la compañía renueva sola y sus pólizas no van a la bandeja de Renovaciones.',
      },
    ],
  },
  'administracion.impresora': {
    clave: 'administracion.impresora',
    titulo: 'Administración → Impresora',
    resumen: 'La configuración de la ticketeadora térmica del mostrador y el encabezado —dirección y teléfono— del comprobante de cada sucursal. La abre cualquiera, con el rol que sea.',
    secciones: [
      {
        titulo: 'Para qué sirve',
        parrafos: [
          'Si el mostrador de una sucursal tiene una impresora térmica de las que usan rollo angosto (80 mm, las típicas de los comercios), esta pantalla la configura para que, al registrar un pago en Cobranzas, salga el comprobante. Es completamente opcional: sin configurar nada, cobrar y registrar pagos funciona exactamente igual, simplemente no sale ningún papel.',
          'La pantalla la ve y la usa cualquier persona con sesión abierta, sea EMPLEADO, ADMIN o SUPER_ADMIN: la impresora es la que tiene esa computadora delante, y quien cobra es quien se da cuenta de que hay que cambiarla, apagarla o dejar de gastar papel, sin tener que esperar a un administrador.',
        ],
      },
      {
        titulo: 'Cómo se configura',
        parrafos: [
          'Se tilda «Imprimir un comprobante al registrar un pago», se elige la impresora de la lista que detecta esta computadora (o se escribe el nombre a mano si Windows no encuentra ninguna) y se confirma el ancho del papel, que en una POS-80 es 80 milímetros. «Guardar» aplica los cambios, y «Imprimir una prueba» manda un comprobante de prueba para confirmar que todo funciona antes de usarla con un cliente delante; ese botón sólo se habilita una vez guardados los cambios.',
          '«Cantidad de tickets por pago» deja elegir si sale 1 comprobante o 2 (por ejemplo, uno para el cliente y otro para la agencia). Con «preguntar antes de imprimir» activado, esa cantidad es sólo lo que viene marcado de entrada en el cartel: ahí se puede cambiar a 1 o a 2 para ese pago en particular, sin tocar esta pantalla.',
        ],
      },
      {
        titulo: 'Preguntar antes de imprimir',
        parrafos: [
          'El segundo tilde, «Preguntar antes de imprimir cada comprobante», hace que después de guardar el pago aparezca un cartel con el cliente, la compañía y el importe, cuántos tickets salen, y dos botones: «Imprimir» y «No imprimir». Sirve para las compañías que no piden ticket: se cierra el cartel y no se gasta papel. Viene activado, y funciona igual se cobre desde la planilla de Cartera, desde la ficha del cliente o desde la caja del día.',
          'Destildarlo vuelve al comportamiento anterior: el comprobante sale solo, sin ningún cartel que interrumpa. Cerrar el cartel con la cruz o con Escape cuenta como «No imprimir»: no sale papel, y el pago queda registrado igual en los dos casos.',
        ],
      },
      {
        titulo: 'Numeración de tickets',
        parrafos: [
          'Cada comprobante impreso lleva un número correlativo («N° 000123») que sube solo, uno por pago: si se piden 2 tickets del mismo pago, las dos copias salen con el mismo número, porque son el mismo comprobante. Salen una después de la otra, como dos impresiones separadas, para que la ticketeadora corte el papel entre las dos y no queden pegadas en la misma tira. La tarjeta «Numeración de tickets» muestra qué número le toca al próximo y deja corregirlo a mano, por ejemplo después de cambiar el rollo o de una prueba hecha por error con la numeración real.',
        ],
      },
      {
        titulo: 'El encabezado del ticket',
        parrafos: [
          'El comprobante encabeza con la dirección y el teléfono de la sucursal donde se cobró; el resto del encabezado (provincia, CUIT e inicio de actividades) es el mismo para toda la agencia. Se cargan en la tarjeta «Encabezado del ticket», una fila por sucursal, y vienen puestas las tres direcciones de siempre —la de Dock Sud (Avellaneda), la de Sarandí y la de Lanús— con el teléfono de la agencia. Si un local atiende por otro número, se cambia ahí y sus comprobantes salen con ese.',
          'Si mañana abre una sucursal nueva, se escribe su nombre en «Agregar una sucursal», se le cargan la dirección y el teléfono y se guarda: desde el próximo ticket salen los suyos, sin tocar el programa.',
          'Cada uno ve y cambia el encabezado de la sucursal en la que está asignado y ninguna otra: la impresora que tiene delante imprime esa dirección y ninguna más, y poder tocar la de Lanús desde Dock Sud sólo sirve para romper el ticket de un mostrador en el que uno no está. Vale igual para un administrador; el superadministrador es la única excepción y las ve todas.',
          'Lo que se guarda acá vale para TODAS las computadoras de la agencia. Antes el encabezado era de cada máquina, así que cambiar el teléfono de un local significaba cargarlo en cada una de sus computadoras, y con que una quedara vieja salían comprobantes con un número que ya no atiende nadie. Ahora se corrige una vez y el resto lo adopta al abrir el programa. Al guardar sólo viaja el renglón de tu sucursal: el de las otras queda como lo dejaron ellas.',
        ],
      },
      {
        titulo: 'Si algo sale mal',
        parrafos: [
          'El comprobante nunca puede frenar un cobro: si la impresora falla, el pago se guarda igual y sólo el papel es lo que no sale. Si el último ticket no se pudo imprimir, esta pantalla muestra el motivo en un aviso, para poder revisar el cable, el papel o el nombre de la impresora sin perder ningún pago.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Ticketeadora térmica',
        explicacion: 'Una impresora de recibo angosto (80 mm), como las de un comercio, que imprime sin tinta usando papel especial.',
      },
    ],
  },
  'administracion.basededatos': {
    clave: 'administracion.basededatos',
    titulo: 'Administración → Base de datos',
    resumen: 'Desde la versión 12, el GENERAL DE CLIENTES vive en la base de datos del servidor de la agencia (el VPS). Esta pantalla muestra si la conexión está bien y es donde se hace la migración inicial.',
    secciones: [
      {
        titulo: 'Qué cambió con la versión 12',
        parrafos: [
          'Antes, la planilla de Google era el lugar donde vivía la información y las computadoras se sincronizaban a través de ella. Ahora la información vive en la base de datos del servidor de la agencia, y todas las computadoras se mantienen iguales contra esa base. El trabajo diario no cambia en nada: las pantallas son las mismas, y si se corta internet se sigue trabajando local igual que siempre.',
        ],
      },
      {
        titulo: 'La migración inicial',
        parrafos: [
          'Se hace una sola vez, desde una sola computadora, y la hace el superadministrador. El botón lee la planilla de Google completa por última vez y la publica en la base del servidor. A partir de ese momento todas las computadoras sincronizan contra el servidor y la planilla de Google queda de recuerdo (nadie la borra, pero ya no manda).',
        ],
      },
      {
        titulo: 'Probar conexión',
        parrafos: [
          'Consulta el servidor y dice si la base está migrada, cuántas pestañas y filas tiene. Si falla, el mensaje explica si es un problema de internet, del token o del servidor.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'VPS',
        explicacion: 'El servidor propio de la agencia en internet (el mismo donde está la página web). Ahí adentro vive ahora la base de datos del GENERAL DE CLIENTES.',
      },
    ],
  },
  'administracion.google': {
    clave: 'administracion.google',
    titulo: 'Administración → Google Drive',
    resumen: 'La credencial de Google que queda sólo para Drive: los respaldos diarios y los adjuntos de siniestros. Es OBLIGATORIA: la carga el superadministrador una vez, viaja al servidor y la adoptan solas las cinco computadoras, sea quien sea el que las use.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Desde la versión 12 el GENERAL DE CLIENTES vive en la base del VPS y el programa no sincroniza más con la planilla de Google (el servidor la mantiene actualizado como copia de lectura). Esta credencial de Google queda para lo único que sigue usando Google: subir los respaldos diarios a Drive y guardar los adjuntos de los siniestros.',
          'Desde la 12.5 es OBLIGATORIA. El programa abre igual sin ella —nada de esto puede frenar el mostrador— pero mientras falte aparece un cartel en Inicio para TODO el equipo, porque lo que se pierde no se nota hasta que hace falta: el día que hay que buscar el documento de un siniestro o volver la base a como estaba el martes. La carga el superadministrador una sola vez; viaja cifrada al servidor y las demás computadoras la adoptan solas al arrancar, sin que nadie tenga que ir máquina por máquina.',
        ],
      },
      {
        titulo: 'Los dos datos que se cargan',
        parrafos: [
          'El primer campo es el contenido del archivo de credenciales que entrega Google al crear el acceso técnico; se pega tal cual, completo. El segundo es la dirección (URL) de la hoja de cálculo de la agencia (sólo se usó para la migración inicial). Para los respaldos hace falta que la carpeta «Respaldos DM» del Drive esté compartida como editor con el correo de la credencial; para los adjuntos, lo mismo con la carpeta «Adjuntos DM».',
        ],
      },
      {
        titulo: 'Dónde queda guardado y quién lo carga',
        parrafos: [
          'La carga el superadministrador, una sola vez: lo que se guarda acá viaja al servidor de la agencia —cifrado— y el resto de las computadoras lo adopta al abrir el programa. Hasta la versión 12.3 había que cargarla máquina por máquina, y con que una quedara sin configurar esa sucursal no subía los adjuntos de sus siniestros y nadie se enteraba hasta que hacían falta.',
          'La clave privada nunca vuelve a esta pantalla y nunca se copia al repositorio ni a la base de la cartera. El aviso de arriba dice si esta computadora tiene lo mismo que el servidor.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Credencial técnica (cuenta de servicio)',
        explicacion: 'Un acceso especial que entrega Google para que un programa, y no una persona, pueda leer y escribir en una hoja de cálculo.',
      },
    ],
  },
  'administracion.importar': {
    clave: 'administracion.importar',
    titulo: 'Administración → Reimportar la base',
    resumen: 'Vuelve a leer completa la base del VPS y recarga la copia local: clientes, vehículos, pólizas, cuotas, bajas, siniestros y más.',
    secciones: [
      {
        titulo: 'Para qué sirve',
        parrafos: [
          'Esta pantalla lee completa la base del GENERAL DE CLIENTES en el VPS y carga (o actualiza) con eso la copia local de esta computadora: clientes, vehículos, pólizas, cuotas de cada mes, bajas, riesgos varios, siniestros, reglas de cobertura y pagos. Se puede correr todas las veces que haga falta: la aplicación reconoce cada fila por su _ID y no la duplica. Normalmente no hace falta, porque la sincronización mantiene todo al día sola; sirve si una computadora quedó mucho tiempo apagada o algo no cuadra.',
        ],
      },
      {
        titulo: 'Analizar antes de importar',
        parrafos: [
          '«Analizar la base» revisa la base sin cambiar nada todavía, y muestra qué pestañas encontró, de qué tipo es cada una (planilla mensual, bajas, siniestros, etcétera) y cuál parece ser la más nueva. Conviene analizar primero para confirmar que está todo como se espera antes de tocar «Reimportar», que sí trae los datos de verdad y actualiza la aplicación.',
        ],
      },
      {
        titulo: 'Mientras corre y al terminar',
        parrafos: [
          'Con la importación en marcha se ve el progreso pestaña por pestaña, y se puede cancelar en cualquier momento: lo que ya se guardó queda guardado, no se pierde. Al terminar aparece un informe con los totales de cada tipo de dato y, si los hubo, los datos raros que encontró (fechas imposibles, un DNI repetido, una sucursal que no está en la lista, y cosas así) sin que eso frene el resto de la importación. El informe se puede descargar o abrir su carpeta para guardarlo como constancia.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Importar',
        explicacion: 'Volver a traer los datos de la base del VPS hacia esta computadora. Se puede repetir sin duplicar nada.',
      },
      {
        termino: 'Datos raros',
        explicacion: 'Filas con algo que no se pudo interpretar del todo (una fecha rara, un dato faltante). Quedan anotadas en el informe, pero no frenan la importación.',
      },
    ],
  },
  'administracion.sincronizacion': {
    clave: 'administracion.sincronizacion',
    titulo: 'Administración → Sincronización',
    resumen: 'Mantiene a esta computadora y a la base del VPS al día en los dos sentidos, y muestra qué está esperando para subir.',
    secciones: [
      {
        titulo: 'Cómo funciona',
        parrafos: [
          'Cualquier cambio que se hace en DM Gestión (un pago, una baja, un dato editado) se sube solo a la base del VPS cada pocos segundos, y lo que cargaron las otras computadoras se trae de vuelta cada algunos minutos. No hace falta hacer nada manual para que esto funcione: pasa solo, todo el tiempo, mientras haya conexión.',
          '«Sincronizar ahora» fuerza un ciclo inmediato en lugar de esperar al próximo automático. «Forzar bajada completa» vuelve a traer la base entera desde cero, útil si algo quedó desactualizado y se quiere estar seguro de que todo coincide.',
        ],
      },
      {
        titulo: 'La cola de subida',
        parrafos: [
          'Es la lista de cambios hechos en DM Gestión que todavía no llegaron a la base del VPS, por ejemplo porque se cortó internet. No se pierde nada: apenas vuelve la conexión, la cola se vacía sola. Si algún cambio no se pudo subir por un problema puntual, queda marcado «No se pudo» y el botón «Volver a intentar los que fallaron» lo reintenta.',
        ],
      },
      {
        titulo: 'Últimos movimientos',
        parrafos: [
          'Más abajo se ve un historial de lo último que pasó (subidas, bajadas, algún conflicto resuelto), útil para entender qué pasó si algo no cuadra.',
        ],
      },
      {
        titulo: 'Los respaldos son dos cosas distintas',
        parrafos: [
          'Los del SERVIDOR son los que sirven para volver atrás. El servidor guarda solo, todos los días, una copia completa de la base de la agencia; no hace falta que nadie encienda ninguna computadora. Se muestran los últimos tres, con el día, cuántas pestañas y filas tiene cada uno, y quién lo hizo. «Respaldar ahora» guarda el de hoy en el momento (si ya está, no lo duplica).',
          '«Restaurar» deja la base exactamente como estaba ese día, en TODAS las computadoras, y descarta todo lo que se cargó desde entonces. Es lo más fuerte que hace el programa: sólo lo puede hacer el superadministrador, el cartel dice qué se lleva puesto y el botón de confirmar se enciende recién a los cinco segundos. Antes de tocar nada, el servidor guarda una foto de cómo está la base en ese momento, así que si se restauró el respaldo equivocado hay con qué volver. Las otras computadoras quedan al día solas en su próxima sincronización.',
          'Las copias de ESTA computadora son otra cosa: todos los días después de las ocho de la noche se guarda un archivo Excel con la base entera (y una copia en Drive, si la conexión con Google está cargada), y se conservan las últimas 30. Sirven para abrir en Excel y mirar; para volver atrás están los del servidor.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Sincronización',
        explicacion: 'El proceso automático que mantiene a esta computadora y a la base del VPS iguales en los dos sentidos, sin necesidad de reimportar a mano.',
      },
      {
        termino: 'Cola de subida',
        explicacion: 'Los cambios hechos en DM Gestión que todavía no llegaron a la base del VPS, normalmente porque se está esperando conexión.',
      },
      {
        termino: 'Respaldo',
        explicacion: 'Una copia guardada aparte de toda la base, por si alguna vez hace falta recuperar información. Hay dos: los del servidor, que se hacen solos todos los días y se pueden restaurar, y las copias en Excel de esta computadora, para mirar.',
      },
      {
        termino: 'Restaurar',
        explicacion: 'Volver la base de toda la agencia a como estaba el día de un respaldo, descartando lo que se cargó después. Sólo lo puede hacer el superadministrador, y antes de hacerlo el servidor guarda una foto de cómo está ahora, por si hubo que volver.',
      },
    ],
  },
  'administracion.sincronizar': {
    clave: 'administracion.sincronizar',
    titulo: 'Administración → Sincronizar',
    resumen: 'El botón para forzar una sincronización completa cuando algo no aparece. Lo puede usar cualquiera del equipo.',
    secciones: [
      {
        titulo: 'Para qué está',
        parrafos: [
          'DM Gestión sincroniza solo cada tanto: sube lo que cargaste y baja lo que cargaron en las otras sucursales. El 99 % de los días nadie tiene que hacer nada. Esta pantalla es para el otro 1 %: tenés gente en el mostrador, alguien pregunta por una cuota que se cargó ayer en otra sucursal y acá no aparece, o cargaste un pago y ves que quedó «esperando para subir».',
          'El botón «Sincronizar todo» fuerza una vuelta completa: sube todo lo que estaba en la cola y vuelve a bajar los datos de la hoja. No configura nada ni cambia nada de las otras computadoras, sólo apura lo que la aplicación iba a hacer sola. Por eso lo puede tocar cualquiera, con el rol que sea.',
        ],
      },
      {
        titulo: 'Qué dicen los tres números',
        parrafos: [
          '«Esperando para subir» son los cambios que hiciste en esta computadora y que todavía no llegaron a la hoja. En cero está todo bien. Con un número, la aplicación va a seguir intentando sola; el botón apura ese intento.',
          '«Última subida» y «Última bajada» son los momentos en que esta computadora habló con la hoja por última vez. Si son de hace mucho —horas, o de ayer— y sincronizar no los mueve, es un problema de conexión o de la hoja y ahí sí hay que avisarle a un administrador, que tiene la pantalla «Sincronización» con el detalle.',
        ],
      },
      {
        titulo: 'Qué hacer si no alcanza',
        parrafos: [
          'Sincronizar de más no rompe nada: si no hay novedades, no pasa nada. Si después de sincronizar sigue faltando algo, o quedan cambios esperando, avisale a un administrador con lo que dice esta pantalla: con la última subida, la última bajada y cuántos cambios quedaron pendientes ya se sabe por dónde empezar a mirar.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Sincronizar',
        explicacion: 'Poner de acuerdo lo que hay en esta computadora con lo que hay en la hoja de la agencia: subir lo tuyo y bajar lo de los demás.',
      },
      {
        termino: 'Cambio pendiente',
        explicacion: 'Algo que cargaste o corregiste acá y que todavía no llegó a la hoja. No se pierde: la aplicación lo reintenta sola.',
      },
    ],
  },

  'administracion.redessociales': {
    clave: 'administracion.redessociales',
    titulo: 'Administración → Redes sociales',
    resumen: 'La app de Meta que el programa usa para publicar en Facebook e Instagram. La carga el superadministrador una vez y la adoptan todas las computadoras.',
    secciones: [
      {
        titulo: 'Qué es esto',
        parrafos: [
          'Para que el programa pueda publicar en la página de Facebook de la agencia y en su Instagram, Meta exige que exista una «app» a nombre de la agencia. Se crea una sola vez en developers.facebook.com y de ahí salen dos datos: el App ID (un número) y el App Secret (una clave). Los dos se cargan acá.',
          'Los carga el superadministrador una sola vez: viajan al servidor de la agencia —cifrados— y el resto de las computadoras los adopta al abrir el programa. Antes había que cargarlos en cada máquina que fuera a publicar. Es el mismo criterio que la cuenta de Google.',
        ],
      },
      {
        titulo: 'La dirección de vuelta',
        parrafos: [
          'Es lo que más falla. En el panel de Meta, en «Facebook Login → Configuración», hay que pegar exactamente la dirección que muestra esta pantalla, en «URI de redireccionamiento de OAuth válidos». Si no coincide letra por letra, Facebook rechaza el ingreso con un error que no explica nada. El botón «Copiar» la deja lista para pegar.',
          'El programa nunca abre esa dirección: atrapa el intento y lo cancela. No hace falta que la página exista.',
          'Se puede cambiar, por si algún día cambia el dominio de la agencia, y viaja junto con la app: las cinco computadoras usan la misma. Con que una tuviera otra, el login de Facebook fallaría ahí y en ningún otro lado, que es exactamente el problema que esto evita.',
        ],
      },
      {
        titulo: 'Tres cosas que Meta exige y no dependen del programa',
        parrafos: [
          'Primero, la app tiene que salir de «modo Desarrollo» para que la use cualquiera. Mientras esté en Desarrollo funciona sólo para las personas dadas de alta como Administrador, Desarrollador o Tester en el panel de Meta. Es el motivo número uno de «no aparece ninguna página» al vincular.',
          'Segundo, los permisos de publicación piden Revisión de la app y verificación del negocio. Es un trámite de Meta, con formularios y un video de demostración.',
          'Y tercero, para Instagram la cuenta tiene que ser Business y estar vinculada a la página de Facebook. Una cuenta personal no se puede publicar por programa, sin importar cómo esté configurada la app.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'App de Meta',
        explicacion: 'Un registro gratuito en developers.facebook.com que identifica al programa ante Facebook. Sin esto, Meta no acepta ninguna publicación automática.',
      },
      {
        termino: 'App Secret',
        explicacion: 'La clave de esa app. Meta la muestra una sola vez al crearla; si se pierde, hay que generar otra desde el panel.',
      },
    ],
  },

  'administracion.galenonovedades': {
    clave: 'administracion.galenonovedades',
    titulo: 'Administración → Galeno (novedades)',
    resumen: 'El usuario y la clave con los que el servidor consulta el portal de productores de Galeno.',
    secciones: [
      {
        titulo: 'Qué cambia con esto',
        parrafos: [
          'Con estas credenciales cargadas, el servidor del VPS consulta el portal de Galeno cada quince minutos y trae las pólizas que se cargaron, se modificaron o se anularon con ese usuario. Lo que se puede resolver solo entra a la cartera sin que nadie haga nada; el resto espera en Cartera → Galeno.',
          'Sin ellas no pasa nada malo: el resto del programa funciona igual y las pólizas de Galeno se siguen cargando a mano, como siempre.',
        ],
      },
      {
        titulo: 'Dónde vive la clave',
        parrafos: [
          'La clave NO se guarda en esta computadora. Va derecho al servidor, que la guarda cifrada, porque el que la usa es el servidor. Por eso tampoco hay un botón de «traer del servidor» como en el catálogo de vehículos: acá no hay nada que traer.',
          'Y por eso el campo de la clave aparece siempre vacío, aunque ya esté cargada: el servidor no la devuelve. Escribir una nueva la reemplaza; dejar el campo vacío no la toca.',
          'La carga sólo el superadministrador. Con ese usuario se ve la cartera entera de la compañía, así que no es una credencial de mostrador.',
        ],
      },
      {
        titulo: 'Los tres campos',
        parrafos: ['Son los mismos datos con los que se entra al portal de Galeno desde el navegador, más un filtro opcional.'],
        lista: [
          'Usuario: el del portal de productores. El de la agencia empieza con «USWS»: son los que Galeno genera desde su propia pantalla de Administración → Usuarios WS, pensados justamente para que un sistema de gestión se conecte.',
          'Clave: la de ese usuario. Viaja por https al servidor y ahí queda cifrada; nunca se escribe en el disco de esta computadora.',
          'Legajos: cuáles legajos PAS sincronizar, separados por coma. Dejarlo vacío es lo normal y quiere decir «todos los que Galeno declare para este usuario»: así, si mañana Galeno le suma un legajo a la agencia, entra solo en vez de quedar sin sincronizar sin que nadie se entere.',
        ],
      },
      {
        titulo: 'Probar conexión',
        parrafos: [
          'Prueba lo que YA está guardado en el servidor, no lo que está escrito en los campos: primero se guarda y después se prueba. Si anda, dice qué legajos encontró.',
          'Si contesta que Galeno rechazó el usuario o la clave, lo primero es volver a cargarlos. Si con las credenciales correctas sigue fallando, puede ser que el usuario «USWS…» no sirva contra el portal y haga falta el web service para sistemas de gestión: se pide a serviciosalproductor@galenoseguros.com.ar, o al 0-800-333-7784.',
        ],
      },
    ],
  },

  'administracion.vehiculos': {
    clave: 'administracion.vehiculos',
    titulo: 'Administración → Catálogo de vehículos',
    resumen: 'La conexión con el catálogo de autos y motos, y la copia local que usa el alta de pólizas.',
    secciones: [
      {
        titulo: 'Qué cambia con esto',
        parrafos: [
          'Sin catálogo, al cargar una póliza hay que escribir la marca, el modelo y el año a mano, y así en la base terminan conviviendo «FORD», «Ford» y «FRD», y «FIESTA» sin saber cuál de las catorce versiones es. Con el catálogo cargado, el formulario los ofrece en listas encadenadas: se elige la marca y aparecen sus modelos, se elige el modelo y aparecen sus versiones (líneas), y después el año.',
          'Y algo más importante: la CATEGORÍA —pick-up, SUV, furgón, camión, sedán— la decide el catálogo con lo ya elegido y no se puede tocar. De la categoría dependen la prima y qué coberturas se pueden emitir, y quien está cargando no tiene por qué saber si una Amarok es camioneta o pick-up.',
        ],
      },
      {
        titulo: 'El proveedor y sus credenciales',
        parrafos: [
          'Se elige uno de dos. InfoAuto es el catálogo clásico de las aseguradoras argentinas y pide usuario y clave. Mercado Libre es la API que se contrata desde el panel de desarrolladores de Mercado Pago y pide el App ID y la Clave secreta de la aplicación que se creó ahí; también acepta un Access Token pegado a mano, que es más rápido para probar pero vence —con App ID y Clave secreta el permiso se renueva solo.',
          'Los códigos de marca y de modelo de un proveedor no tienen nada que ver con los del otro, así que cambiar de proveedor obliga a volver a bajar el catálogo. Y Mercado Libre publica por esta API los autos y camionetas únicamente: para motos hace falta InfoAuto.',
          'El botón «Probar la conexión» dice enseguida si las credenciales son correctas, sin bajar nada.',
        ],
      },
      {
        titulo: 'Se cargan una vez, no una por computadora',
        parrafos: [
          'El superadministrador las carga y en el mismo movimiento viajan al servidor de la agencia; el resto de las computadoras las toma sola al abrir el programa. Antes había que ir máquina por máquina, y con que una quedara sin cargar esa persona atendía el mostrador sin los desplegables.',
          'En el servidor se guardan cifradas. En cada computadora quedan en su archivo de configuración local, que no se sincroniza ni sale en los respaldos. La tarjeta «Las mismas credenciales en todas las computadoras» dice si esta máquina está al día, y tiene los botones para mandarlas o para traerlas a mano sin esperar al próximo arranque.',
          'Si el servidor no contesta cuando se guardan, no se pierde nada: quedan bien guardadas en esta computadora y la pantalla ofrece el reintento.',
        ],
      },
      {
        titulo: 'La copia local',
        parrafos: [
          'Los desplegables del formulario salen SIEMPRE de una copia guardada en esta computadora, y nunca de internet. Es a propósito: elegir un vehículo en el mostrador tiene que ser instantáneo, y tiene que funcionar aunque se corte la conexión, que es justo cuando más se cobra.',
          '«Refrescar todo» baja el catálogo entero. Son decenas de miles de versiones y puede tardar varios minutos; mientras tanto se puede seguir usando el programa. Conviene hacerlo una vez por mes: los modelos nuevos salen todo el año. La pantalla marca «Conviene refrescarlo» cuando pasó un mes.',
          'La agencia puede tener contratada una sola mitad del catálogo (los autos y no las motos, por ejemplo). Si una falla, la otra se baja igual y el motivo queda escrito en su tarjeta.',
        ],
      },
      {
        titulo: 'Qué pasa con lo que ya está cargado',
        parrafos: [
          'Nada. Las pólizas y los vehículos que ya están en la base siguen con su marca y su modelo tal como se escribieron, y no se toca ninguno. Sólo se completan la línea y la categoría si alguien vuelve a elegir ese vehículo del catálogo.',
          'Eso es a propósito: emparejar automáticamente «FORD FIESTA» contra el catálogo obligaría a elegir una de catorce versiones por la agencia, y elegir mal es peor que dejar el dato como está.',
          'Y si un vehículo no aparece en el catálogo —un importado, un modelo del año que todavía no cargaron—, el formulario tiene el botón «Cargarlo a mano» de siempre. El catálogo nunca puede frenar una póliza.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Línea',
        explicacion: 'La versión exacta dentro de un modelo: «Corolla 2.0 XEI CVT» es una línea del modelo Corolla. Es la que define la categoría.',
      },
      {
        termino: 'Categoría',
        explicacion: 'Qué clase de vehículo es (sedán, SUV, pick-up, furgón, camión…). La decide el catálogo y no se puede elegir a mano.',
      },
    ],
  },

  'administracion.galeno': {
    clave: 'administracion.galeno',
    titulo: 'Administración → Galeno',
    resumen: 'La cuenta de Galeno Seguros y los reportes de sólo lectura de su API: pólizas, cuotas, endosos, cuenta corriente y contratos de ART.',
    secciones: [
      {
        titulo: 'Qué se puede hacer con esto',
        parrafos: [
          'Con las credenciales cargadas, Presupuestos puede cotizar con Galeno en el momento —en vez de anotar la cobertura y el precio a mano— y, si el cliente acepta esa opción, emitir la póliza sin salir de la app.',
          'Acá abajo, en «Consultas, Cuenta Corriente y ART», se puede mirar lo que Galeno ya tiene cargado: pólizas por legajo, los riesgos y el detalle de una póliza, la producción de automotores, las cuotas impagas y cobradas, las pólizas vigentes, los endosos, la cuenta corriente (de Seguros y de ART) y los contratos de ART.',
        ],
      },
      {
        titulo: 'Pruebas y producción',
        parrafos: [
          'El manual de Galeno sólo documenta un ambiente de pruebas: mientras se trabaje ahí, alcanza con el usuario y la clave. Para producción, Galeno da aparte una URL y un «Authorization» distintos —no están en el manual—, y hay que cargarlos acá antes de pasar el ambiente a «Producción».',
          'Si al probar la conexión Galeno dice algo como «Usuario no registrado», casi siempre es que esas credenciales son de producción y todavía está elegido el ambiente de pruebas (o al revés).',
        ],
      },
      {
        titulo: 'El legajo del productor',
        parrafos: [
          'Casi todos los reportes de acá abajo piden el legajo del productor conectado. No hay que cargarlo a mano: se completa solo la primera vez que se prueba la conexión o se cotiza, tomado de la lista de planes comerciales que devuelve Galeno.',
        ],
      },
    ],
  },

  'administracion.controlremoto': {
    clave: 'administracion.controlremoto',
    titulo: 'Administración → Control remoto',
    resumen: 'La consola con la que se entra a las computadoras de las sucursales sin ir hasta el local.',
    secciones: [
      {
        titulo: 'Para qué es',
        parrafos: [
          'Es el jueves a la mañana, en Sarandí no anda la impresora de tickets y hay gente esperando. Desde esta consola se ve qué computadoras de la agencia están prendidas y se puede tomar el control de cualquiera de ellas para resolverlo en el momento, sin viajar y sin explicarle a nadie por teléfono dónde hacer clic.',
          'La pantalla prueba la consola apenas se abre y dice si está en línea. Eso es la mitad de lo que sirve: si está caída, se sabe acá en dos segundos y no después de tres minutos mirando una pestaña del navegador en blanco.',
        ],
      },
      {
        titulo: 'Cómo se entra',
        parrafos: [
          'El botón «Abrir la consola» la abre en el navegador, no dentro de DM Gestión, y ahí pide su propio usuario y clave, que NO son los del programa. Es a propósito: desde esa consola se entra a todas las computadoras de la agencia, y ese acceso conviene que tenga su puerta aparte en vez de quedar abierto porque alguien dejó DM Gestión iniciado.',
          '«Copiar la dirección» sirve para mandársela a alguien por mensaje, o para abrirla desde un celular.',
        ],
      },
      {
        titulo: 'Cuando dice que no contesta',
        parrafos: [
          'El servicio se reinicia solo, así que lo primero es «Probar de nuevo» al minuto. Si sigue igual, es algo del servidor y no se arregla desde el programa: hay que avisarle a quien administra el VPS.',
          'Que la consola esté caída no afecta nada del trabajo diario: las pólizas, la cartera y la sincronización van por otro lado y siguen andando igual.',
        ],
      },
      {
        titulo: 'Las computadoras que aparecen',
        parrafos: [
          'Para que una máquina figure en la lista tiene que tener instalado el agente, que se baja de la misma consola y se instala una sola vez por computadora. Las que ya lo tenían vuelven a aparecer solas cuando el servidor está en línea: el agente reintenta hasta encontrarlo.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Agente',
        explicacion: 'El programita que se instala una vez en cada computadora y es lo que la hace aparecer en la consola. Sin agente, esa máquina no se ve.',
      },
    ],
  },

  'administracion.acerca': {
    clave: 'administracion.acerca',
    titulo: 'Administración → Acerca de',
    resumen: 'La versión instalada, si hay una actualización disponible y el estado de la base de usuarios compartida.',
    secciones: [
      {
        titulo: 'Versión y actualizaciones',
        parrafos: [
          'DM Gestión se actualiza sola: busca versiones nuevas al abrirse y cada cuatro horas mientras está en uso, y cuando encuentra una la descarga sin interrumpir el trabajo. Cuando está lista, aparece una barra arriba de la pantalla avisando que hay una versión nueva, con un botón «Reiniciar ahora» para instalarla en el momento (si no se toca, se instala sola la próxima vez que se cierra el programa). Desde esta pantalla, el botón «Buscar actualizaciones» chequea a mano en cualquier momento, sin esperar al chequeo automático.',
        ],
      },
      {
        titulo: 'Estado de la base de usuarios',
        parrafos: [
          'Acá se ve si esta computadora está usando la lista de usuarios compartida entre sucursales o todavía no, cuándo fue la última vez que se confirmó contra esa lista, y si hay alguien guardado para poder ingresar sin conexión a internet en esta computadora en particular. «Probar conexión» vuelve a comprobar el acceso en el momento, útil si hubo un problema de internet hace poco y se quiere confirmar que ya se resolvió.',
        ],
      },
      {
        titulo: 'Datos para soporte técnico',
        parrafos: [
          'Más abajo figuran datos técnicos (versión de los componentes internos, carpeta donde se guarda la información) que normalmente no hacen falta para el trabajo diario, pero que sirven si en algún momento hay que llamar a soporte técnico y piden esos números.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Actualización automática',
        explicacion: 'DM Gestión revisa sola si hay una versión nueva y la instala con un aviso y un botón, sin necesidad de descargar nada a mano.',
      },
    ],
  },
}
