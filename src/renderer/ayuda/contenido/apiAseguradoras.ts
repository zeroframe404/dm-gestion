import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_API_ASEGURADORAS: Record<string, ContenidoDeAyuda> = {
  'apiAseguradoras.galeno': {
    clave: 'apiAseguradoras.galeno',
    titulo: 'API Aseguradoras → Galeno',
    resumen: 'La cuenta de Galeno Seguros y los reportes de sólo lectura de su API: pólizas, cuotas, endosos, cuenta corriente y contratos de ART.',
    secciones: [
      {
        titulo: 'Qué se puede hacer con esto',
        parrafos: [
          'Con la cuenta cargada, Presupuestos puede cotizar con Galeno en el momento —en vez de anotar la cobertura y el precio a mano— y, si el cliente acepta esa opción, emitir la póliza sin salir de la app.',
          'Acá abajo, en «Consultas, Cuenta Corriente y ART», se puede mirar lo que Galeno ya tiene cargado: pólizas por legajo, los riesgos y el detalle de una póliza, la producción de automotores, las cuotas impagas y cobradas, las pólizas vigentes, los endosos, la cuenta corriente (de Seguros y de ART) y los contratos de ART.',
        ],
      },
      {
        titulo: 'Por qué habla el servidor y no esta computadora',
        parrafos: [
          'Galeno sólo acepta pedidos que salgan de la IP que la agencia le dio de alta, y esa es la del VPS —no la de ninguna de las cinco sucursales, que además suelen ser dinámicas—. Por eso la cuenta que se carga acá no la usa esta computadora: viaja al servidor y es el servidor el que le habla a Galeno directo, exactamente el mismo circuito que ya usaba la credencial de Galeno (novedades).',
          'Por eso tampoco se muestra el usuario ya cargado, ni «probar la conexión» necesita nada escrito en los campos: prueba lo que YA está usando el servidor.',
        ],
      },
      {
        titulo: 'De fábrica ya funciona',
        parrafos: [
          'DM Gestión trae cargada de fábrica la cuenta de producción de Galeno, con la IP del VPS ya autorizada, así que cotizar, emitir y consultar andan sin que nadie tenga que cargar nada acá. Esta pantalla sirve para cambiarla el día que haga falta —otro usuario, otro ambiente, o Galeno rotando la clave— y para volver a la de fábrica con «Sacarlas».',
        ],
      },
      {
        titulo: 'Pruebas y producción',
        parrafos: [
          'El manual de Galeno sólo documenta un ambiente de pruebas: mientras se trabaje ahí, alcanza con el usuario y la clave. Para producción, Galeno da aparte una URL y un «Authorization» distintos —no están en el manual—, y hay que cargarlos acá antes de pasar el ambiente a «Producción».',
          'Si al probar la conexión Galeno dice algo como «Usuario no habilitado» o que la IP no fue informada, revisá con Galeno que la IP dada de alta sea la del VPS de la agencia, no la de una computadora.',
        ],
      },
      {
        titulo: 'El legajo del productor',
        parrafos: [
          'Casi todos los reportes de acá abajo piden el legajo del productor conectado. No hay que cargarlo a mano: se completa solo la primera vez que se prueba la conexión o se cotiza, tomado de la lista de planes comerciales que devuelve Galeno.',
          'Para cotizar no se usa este legajo sino el del plan comercial elegido: cada plan es de un legajo, y con otro legajo Galeno aplica otra bonificación y el precio no coincide con su web.',
        ],
      },
    ],
  },

  'apiAseguradoras.galenonovedades': {
    clave: 'apiAseguradoras.galenonovedades',
    titulo: 'API Aseguradoras → Galeno (novedades)',
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

  'apiAseguradoras.atm': {
    clave: 'apiAseguradoras.atm',
    titulo: 'API Aseguradoras → ATM',
    resumen: 'La cuenta del web service de ATM Seguros y las tablas que ATM publica por FTP: con las dos, el Multicotizador cotiza en ATM.',
    secciones: [
      {
        titulo: 'Qué se puede hacer con esto',
        parrafos: [
          'Con la cuenta cargada y las tablas bajadas, el Multicotizador cotiza autos y motos en ATM al mismo tiempo que en las demás compañías, y sus coberturas entran al comparativo y al presupuesto como las de cualquiera.',
          'Desde el multicotizador también se emite en ATM («Emitir…» en cada cobertura). Para eso usa más tablas del FTP (tipos de documento, formas de pago, tarjetas…): si el diálogo dice que faltan, tocá «Actualizar tablas».',
        ],
      },
      {
        titulo: 'La cuenta vive en cada computadora',
        parrafos: [
          'A diferencia de Galeno, ATM no pide que los pedidos salgan de una IP dada de alta, así que cada computadora le habla directo, sin pasar por el servidor. Por eso la cuenta sí se guarda en esta computadora.',
          'Se carga una sola vez: al guardar viaja cifrada al servidor y el resto de las computadoras la adopta al abrir el programa, igual que la app de Meta. El renglón de abajo de la cuenta dice si esta computadora tiene lo mismo que el servidor; si no, «Traer del servidor» la toma ya, sin esperar a volver a abrir el programa.',
          'La carga un administrador. «Sacarla» la borra de esta computadora y del servidor: sin cuenta, ATM deja de cotizar. Las tablas ya bajadas no se borran.',
        ],
      },
      {
        titulo: 'Los cuatro campos',
        parrafos: ['Son los datos que ATM le dio a la agencia para su web service.'],
        lista: [
          'Ambiente: Producción es el de todos los días. Desarrollo es el ambiente de pruebas de ATM: anda sólo de lunes a viernes de 8 a 18 y lo que cotiza no vale para el cliente. El usuario y la clave son los mismos en los dos.',
          'Usuario y clave: los del web service de ATM, que también sirven para su FTP. La clave nunca vuelve a la pantalla: con la cuenta ya cargada, dejar el campo vacío conserva la que está (sirve para cambiar sólo el vendedor).',
          'Vendedor: el código de 10 números con que se cotiza. Es opcional: vacío, se usa el primero que ATM tenga para la cuenta. Conviene cargar el que ATM le dio a la agencia, porque de él dependen los planes con que se cotiza.',
        ],
      },
      {
        titulo: 'Probar conexión',
        parrafos: [
          'Prueba la cuenta YA guardada en esta computadora, no lo que está escrito en los campos: primero se guarda y después se prueba. Dice si ATM aceptó el usuario y la clave, con qué vendedor se va a cotizar y cuántos planes tiene para autos y para motos.',
          'También muestra los vendedores que ATM lista para la cuenta, con «Usar este» para pasarlo al campo (después hay que guardar). La lista es una ayuda: ATM puede cotizar con un vendedor que no figura ahí. Si al cotizar contesta «Vendedor inválido», usá uno de la lista.',
          'Si falla en desarrollo fuera de horario, no es la cuenta: ese ambiente sólo anda de lunes a viernes de 8 a 18.',
        ],
      },
      {
        titulo: 'Las tablas por FTP',
        parrafos: [
          'ATM no da su catálogo de vehículos por la API: lo publica todas las noches en un FTP, en tablas (marcas y modelos con su código de InfoAuto, sumas aseguradas, usos, localidades…). Sin ellas el Multicotizador no tiene cómo pedirle el vehículo a ATM, así que son obligatorias.',
          'No hay que hacer nada para tenerlas: cada computadora las baja sola la primera vez que cotiza en ATM y después una vez por día. Si el FTP no anda, sigue con las que tenga y lo avisa en la tarjeta de ATM. «Actualizar tablas (FTP)» las baja en el momento.',
          'La lista de abajo dice, tabla por tabla, de qué archivo salió y cuántas filas se leyeron, o por qué no se pudo leer. Las marcadas «Para cotizar» son las de vehículos: con una de las dos alcanza. Si ATM no cotiza diciendo que faltan las tablas, es lo primero que hay que mirar, junto con el último error del FTP.',
        ],
      },
      {
        titulo: 'Si el FTP está bloqueado en esta red',
        parrafos: [
          'Algunas redes no dejan salir al FTP, y entonces el error dice que no se pudo conectar. Se pueden bajar las tablas desde otra conexión con un programa de FTP (FileZilla, por ejemplo) y traerlas con «Importar desde archivos…», eligiendo todos los archivos juntos (sueltos o en un .zip).',
        ],
        lista: [
          'Producción: servidor wsatm.atmseguros.com.ar, puerto 2113.',
          'Desarrollo: servidor wsatm-dev.atmseguros.com.ar, puerto 2111.',
          'Usuario y clave: los mismos de la cuenta de ATM.',
          'Cada ambiente tiene sus tablas: lo que se importa va al ambiente de la cuenta cargada, y las tablas que no vengan en los archivos conservan las que ya había.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Tablas de ATM',
        explicacion:
          'Los archivos que ATM publica todas las noches en su FTP con su catálogo de vehículos y otras listas. El Multicotizador los necesita para cotizar en ATM; cada computadora los baja sola una vez por día.',
      },
      {
        termino: 'Vendedor de ATM',
        explicacion: 'El código de 10 números con que la agencia cotiza en ATM. Define qué planes se pueden usar.',
      },
    ],
  },
  'apiAseguradoras.mercantil': {
    clave: 'apiAseguradoras.mercantil',
    titulo: 'API Aseguradoras → Mercantil',
    resumen: 'La cuenta de la API de Mercantil Andina (usuario, contraseña y clave de suscripción del portal): con ella, el Multicotizador cotiza autos en Mercantil.',
    secciones: [
      {
        titulo: 'Qué se puede hacer con esto',
        parrafos: [
          'Con la cuenta cargada, el Multicotizador cotiza autos en Mercantil Andina al mismo tiempo que en las demás compañías, y sus coberturas entran al comparativo y al presupuesto como las de cualquiera. La póliza se emite desde la web de Mercantil: la cotización queda en su sistema con el número que muestra «Copiar datos para Mercantil Andina».',
        ],
      },
      {
        titulo: 'La cuenta vive en cada computadora',
        parrafos: [
          'Como ATM, Mercantil no pide que los pedidos salgan de una IP dada de alta, así que cada computadora le habla directo, sin pasar por el servidor. Por eso la cuenta sí se guarda en esta computadora.',
          'Se carga una sola vez: al guardar viaja cifrada al servidor y el resto de las computadoras la adopta al abrir el programa. El renglón de abajo de la cuenta dice si esta computadora tiene lo mismo que el servidor; si no, «Traer del servidor» la toma ya.',
          'La carga un administrador. «Sacarla» la borra de esta computadora y del servidor: sin cuenta, Mercantil deja de cotizar.',
        ],
      },
      {
        titulo: 'Los datos que pide, y de dónde salen',
        parrafos: ['Son tres secretos y los tres hacen falta: sin cualquiera de ellos Mercantil no da el token con el que se hace todo lo demás. Sale de la «Guía para la conexión a las APIs de Mercantil Andina» (está en la carpeta docs del programa).'],
        lista: [
          'Ambiente: Desarrollo es el de las credenciales de test que Mercantil manda primero (apidev.mercantilandina.com.ar): lo que cotiza no vale para el cliente. Producción es el de todos los días, con las credenciales que Mercantil da después.',
          'Usuario y contraseña: los de la API, que Mercantil manda por correo cuando vincula el código de PAS. Para pedirlos hay que mandarle a Mercantil el código de PAS a vincular, el nombre, CUIT, correo y teléfono de la agencia, para qué es la integración y qué se va a usar (cotización de autos). No son los del portal de APIs.',
          'Clave de suscripción: la «subscription key» que aparece en el Perfil del portal de APIs (apiportal.mercantilandina.com.ar) después de registrarse y suscribirse a los productos (Automotores). Viaja en todos los pedidos como Ocp-Apim-Subscription-Key.',
          'Código de productor (opcional): el PAS con el que se cotiza. Vacío, se usa el que Mercantil asoció al usuario; «Probar conexión» muestra cuál es.',
          'La contraseña y la clave de suscripción nunca vuelven a la pantalla: con la cuenta ya cargada, dejar los campos vacíos conserva las que están (sirve para cambiar sólo el productor o el ambiente).',
        ],
      },
      {
        titulo: 'Probar conexión',
        parrafos: [
          'Prueba la cuenta YA guardada en esta computadora, no lo que está escrito en los campos: primero se guarda y después se prueba. Hace tres cosas, que son los tres secretos: pide el token (prueba el usuario, la contraseña y la clave de suscripción), lee el productor asociado al usuario y cuenta las marcas del catálogo de vehículos (prueba que la suscripción incluya el producto de automotores).',
          'Si Mercantil dice que la clave de suscripción falta o no vale, es la del portal: revisá el Perfil y que la suscripción esté activa. Si no acepta el usuario o la contraseña, son los que mandó Mercantil por correo, y tienen que ser del mismo ambiente que el elegido.',
        ],
      },
    ],
  },
  'apiAseguradoras.equidad': {
    clave: 'apiAseguradoras.equidad',
    titulo: 'API Aseguradoras → Equidad',
    resumen: 'La cuenta de la API GLM de La Equidad (URL base, usuario de la API y, si lo hay, usuario de servicio): con ella, el Multicotizador cotiza autos en Equidad.',
    secciones: [
      {
        titulo: 'Qué se puede hacer con esto',
        parrafos: [
          'Con la cuenta cargada, el Multicotizador cotiza autos en Equidad al mismo tiempo que en las demás compañías, y sus coberturas entran al comparativo y al presupuesto como las de cualquiera. Por ahora la póliza se emite desde la web de Equidad: la cotización queda en su sistema con el número de solicitud que muestra «Copiar datos para Equidad».',
        ],
      },
      {
        titulo: 'La cuenta vive en cada computadora',
        parrafos: [
          'Como ATM y Mercantil, Equidad no pide que los pedidos salgan de una IP dada de alta, así que cada computadora le habla directo, sin pasar por el servidor. Por eso la cuenta sí se guarda en esta computadora.',
          'Se carga una sola vez: al guardar viaja cifrada al servidor y el resto de las computadoras la adopta al abrir el programa. El renglón de abajo de la cuenta dice si esta computadora tiene lo mismo que el servidor; si no, «Traer del servidor» la toma ya.',
          'La carga un administrador. «Sacarla» la borra de esta computadora y del servidor: sin cuenta, Equidad deja de cotizar.',
        ],
      },
      {
        titulo: 'Los datos que pide, y de dónde salen',
        parrafos: ['Salen de lo que manda Equidad junto con la documentación de su API GLM (la carpeta «APIGLM» en docs del programa).'],
        lista: [
          'Ambiente y URL base: la dirección del ambiente (prueba o producción) hasta /servlet/ inclusive; cada servicio de la API cuelga de ahí con su nombre (ar.com.glmsa.seguros.comercial.apiglm…).',
          'Usuario de la API y contraseña: el «usuario de aplicación» con el que la API autentica (AutenticarUsuario) y que devuelve el código de usuario que usan todas las listas.',
          'Usuario de servicio y contraseña (opcional): el par del encabezado Authorization Basic, si Equidad lo manda aparte. Si no, vacío.',
          'Código de productor (opcional): con el que se cotiza. Vacío, se usa el que la API lista para el usuario; «Probar conexión» muestra cuáles son.',
          'Rama de automotores y código de empresa: los códigos que piden las listas de la API. Si Equidad no indica otros, 4 y 1.',
          'Las contraseñas nunca vuelven a la pantalla: con la cuenta ya cargada, dejar los campos vacíos conserva las que están.',
        ],
      },
      {
        titulo: 'Probar conexión',
        parrafos: [
          'Prueba la cuenta YA guardada en esta computadora, no lo que está escrito en los campos: primero se guarda y después se prueba. Se autentica (prueba la URL base y los usuarios), lee los productores del usuario, los tipos de póliza de la rama (si no son de autos, la rama es otra) y cuenta las marcas del catálogo de vehículos.',
          'Si Equidad no acepta las credenciales, son las que mandó con la documentación y tienen que ser del mismo ambiente que la URL base. Si contesta que el servicio no existe (404), la URL base no termina en /servlet/ o es de otro ambiente.',
        ],
      },
    ],
  },
}
