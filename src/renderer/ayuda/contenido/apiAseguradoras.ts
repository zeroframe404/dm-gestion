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
}
