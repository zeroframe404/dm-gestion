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
    resumen: 'La configuración de la ticketeadora térmica del mostrador y las direcciones que encabezan el comprobante. La abre cualquiera, con el rol que sea.',
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
        ],
      },
      {
        titulo: 'Preguntar antes de imprimir',
        parrafos: [
          'El segundo tilde, «Preguntar antes de imprimir cada comprobante», hace que después de guardar el pago aparezca un cartel con el cliente, la compañía y el importe, y dos botones: «Imprimir» y «No imprimir». Sirve para las compañías que no piden ticket: se cierra el cartel y no se gasta papel. Viene activado, y funciona igual se cobre desde la planilla de Cartera, desde la ficha del cliente o desde la caja del día.',
          'Destildarlo vuelve al comportamiento anterior: el comprobante sale solo, sin ningún cartel que interrumpa. Cerrar el cartel con la cruz o con Escape cuenta como «No imprimir»: no sale papel, y el pago queda registrado igual en los dos casos.',
        ],
      },
      {
        titulo: 'Las direcciones del ticket',
        parrafos: [
          'El comprobante encabeza con la dirección de la sucursal donde se cobró; el resto del encabezado (provincia y teléfono, CUIT e inicio de actividades) es el mismo para toda la agencia. Las direcciones se cargan en la tarjeta «Direcciones del ticket», una por sucursal, y vienen puestas las tres de siempre: la de Dock Sud (Avellaneda), la de Sarandí y la de Lanús.',
          'Si mañana abre una sucursal nueva, se escribe su nombre en «Agregar una sucursal», se le carga la dirección y se guarda: desde el próximo ticket sale con la suya, sin tocar el programa.',
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
    resumen: 'La credencial de Google que queda sólo para Drive: los respaldos diarios y los adjuntos de siniestros. La base vive en el VPS.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Desde la versión 12 el GENERAL DE CLIENTES vive en la base del VPS y el programa no sincroniza más con la planilla de Google (el servidor la mantiene actualizado como copia de lectura). Esta credencial de Google queda para lo único que sigue usando Google: subir los respaldos diarios a Drive y guardar los adjuntos de los siniestros. Si no se configura, la aplicación funciona igual; sólo se pierden esas copias en Drive.',
        ],
      },
      {
        titulo: 'Los dos datos que se cargan',
        parrafos: [
          'El primer campo es el contenido del archivo de credenciales que entrega Google al crear el acceso técnico; se pega tal cual, completo. El segundo es la dirección (URL) de la hoja de cálculo de la agencia (sólo se usó para la migración inicial). Para los respaldos hace falta que la carpeta «Respaldos DM» del Drive esté compartida como editor con el correo de la credencial; para los adjuntos, lo mismo con la carpeta «Adjuntos DM».',
        ],
      },
      {
        titulo: 'Dónde queda guardado',
        parrafos: [
          'Estos datos se guardan únicamente en esta computadora, nunca viajan a ningún otro lado ni se comparten con las demás sucursales. Alcanza con tenerla configurada en las computadoras que hacen los respaldos o cargan adjuntos de siniestros.',
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
        titulo: 'Últimos movimientos y respaldos',
        parrafos: [
          'Más abajo se ve un historial de lo último que pasó (subidas, bajadas, algún conflicto resuelto), útil para entender qué pasó si algo no cuadra. Y todos los días, después de las ocho de la noche, se guarda automáticamente una copia completa de la base en un archivo Excel aparte (y en Drive, si la cuenta de Google sigue cargada), por si alguna vez hiciera falta volver atrás; se conservan las últimas 30 copias, y «Respaldar ahora» genera una en el momento.',
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
        explicacion: 'Una copia guardada aparte de toda la base, por si alguna vez hace falta recuperar información.',
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
