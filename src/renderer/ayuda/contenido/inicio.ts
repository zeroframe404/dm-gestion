import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_INICIO: Record<string, ContenidoDeAyuda> = {
  inicio: {
    clave: 'inicio',
    titulo: 'Inicio',
    resumen: 'La pantalla con la que arranca el día: el saludo, qué te toca a vos y el mapa de todos los módulos de la aplicación.',
    secciones: [
      {
        titulo: 'Qué se ve acá',
        parrafos: [
          'Es lo primero que aparece al ingresar. Arriba, un saludo que cambia según la hora del día y recuerda en qué sucursal y con qué rol estás trabajando en esta sesión. Debajo, si tenés algo pendiente, aparece «Tus tareas pendientes»; y más abajo, un mapa con todos los módulos de la aplicación y una frase corta de qué hace cada uno, para ubicarse rápido si todavía no conocés bien el sistema.',
        ],
      },
      {
        titulo: 'Tus tareas pendientes',
        parrafos: [
          'Muestra las tareas que te tocan a vos, no las de todo el equipo, ordenadas de la más urgente a la que menos apura: primero lo vencido, después lo que vence hoy, y así. Un punto rojo en la fila marca lo vencido y uno ámbar lo que vence hoy; si una tarea es de prioridad ALTA, lleva además su propia etiqueta roja. Al lado del título aparece de qué se trata: un cliente, una póliza, un siniestro o lo que corresponda.',
          'Si no tenés ninguna tarea pendiente en este momento, esta sección directamente no aparece: no ocupa lugar con un cartel vacío, así el mapa de módulos sube y la pantalla queda más liviana. Con «Ver todas» se va directo al módulo Tareas para ver el resto o cargar una nueva.',
        ],
      },
      {
        titulo: 'El podio de altas',
        parrafos: [
          'Debajo del saludo está la competencia del mes entre sucursales: quién metió más altas, con la medalla del primero. Un alta es una póliza que está en la planilla de este mes y no estaba en la del mes anterior. Una renovación NO cuenta como alta, aunque la compañía le haya cambiado el número: el cliente ya estaba y la cartera no creció. Se reconoce por la patente de la fila, así que da lo mismo en qué computadora se hizo la renovación. El podio lo ve cualquiera que entre, tenga o no habilitado Métricas, porque es una carrera y no un número de la agencia.',
          'Debajo del título dice de cuándo son los números: a qué hora se calcularon y a qué hora esta computadora bajó por última vez los datos del servidor. Si el podio de tu máquina no coincide con el de otra sucursal, lo primero es mirar esa hora: la que bajó más tarde tiene las altas que la otra todavía no vio. Con el aviso en vivo, apenas la otra sucursal carga algo el podio se vuelve a calcular solo (salvo que tengas abierto el detalle de una tarjeta, que espera a que lo cierres).',
          'Si además tenés permiso para ver Cartera, cada tarjeta se puede tocar: se abre la lista de esas altas, una por una, con el cliente, la compañía, el número de póliza y la patente. Es para poder controlar el número contra la planilla en vez de creerle al cartel; si un nombre de la lista es un cliente de toda la vida, avisá, porque ahí hay algo mal contado.',
          'Cuando todavía no hay un mes anterior cargado en el sistema, el podio no aparece: sin con qué comparar no hay altas que calcular y no habría carrera que mostrar.',
        ],
      },
      {
        titulo: 'Agrandar la pantalla y achicar el menú',
        parrafos: [
          'Arriba a la derecha, al lado del botón del sonido, están los controles de tamaño: «−» achica todo y «+» agranda todo (la letra, los botones, las tablas), y el número del medio vuelve al 100 %. También funcionan los atajos de siempre: Ctrl y «+», Ctrl y «−», Ctrl y «0» para volver al tamaño normal, y Ctrl con la rueda del mouse. Sirve para las dos puntas: en la notebook del mostrador se baja a 80 % y entran más columnas de la planilla; en el monitor grande de la oficina se sube a 125 % y se lee sin acercarse.',
          'La barra lateral azul se puede achicar a una tira de iconos con la flecha que está arriba de todo, al lado del nombre. Los módulos siguen estando: pasando el mouse por encima aparece el nombre de cada uno. Es lugar que gana la pantalla, que es lo que más se agradece en la planilla del mes.',
          'Las dos cosas se guardan en esa computadora y no en tu usuario: cada máquina se acuerda de cómo la dejaste, aunque entres con el mismo nombre en otra.',
        ],
      },
      {
        titulo: 'Reportar un error',
        parrafos: [
          'Al lado de «Descargar el manual» está el botón «Reportar error». Abre un cuadro con dos campos —qué falló, en una línea, y qué pasó, con más detalle— y la posibilidad de adjuntar hasta cuatro capturas de pantalla. Lo puede usar cualquiera, con el rol que sea: el que tiene el problema delante es el que lo puede contar.',
          'Para la captura, el camino corto: apretás «Impr Pant» (que copia la pantalla) y después «Ctrl+V» adentro del cuadro. También está el botón «Buscar», por si la imagen ya está guardada en la computadora. Las capturas son opcionales, pero son lo que más ayuda: la mitad de los problemas se entienden mirando la pantalla y no leyendo la descripción.',
          'El programa agrega solo tu nombre, tu sucursal, la versión que tenés instalada y la fecha. No hace falta que los escribas, y son justamente los datos que más se pedían de vuelta por teléfono. Al enviarlo, el reporte queda anotado con un número; si el problema te frena para trabajar, avisá además por teléfono, porque nadie está mirando la lista de reportes todo el día.',
        ],
      },
      {
        titulo: 'Sugerir una mejora',
        parrafos: [
          'Al lado de «Reportar error» está «Sugerir mejora», también para cualquier rol. Es el mismo cuadro, pero para lo que NO es un error: un botón que falta, un paso de más, algo que se hace a mano y podría hacerse solo. Contá cómo lo hacés hoy, qué te complica y cómo te lo imaginás.',
          'Las sugerencias quedan anotadas aparte de los errores, con su propia etiqueta, para que se puedan mirar y ordenar juntas. No todas se hacen, y las que sí llegan en una versión nueva del programa.',
        ],
      },
      {
        titulo: 'El mapa de módulos',
        parrafos: [
          'Cada tarjeta representa un módulo de la aplicación (Cartera, Clientes, Leads, Presupuestos, Pólizas, Renovaciones, Siniestros, Cobranzas, Métricas, Reportes, Marketing y Tareas) con una descripción de una línea de qué hace. Hacer clic en cualquiera te lleva directo a ese módulo, es un acceso rápido más que la barra lateral. Un módulo que todavía no está disponible en esta versión aparece marcado «Próximamente».',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Tarea',
        explicacion: 'Un pendiente asignado a una persona, con una fecha límite opcional y a veces vinculado a un cliente, una póliza o un siniestro. Se administran desde el módulo Tareas.',
      },
      {
        termino: 'Alta',
        explicacion: 'Una póliza que está en la planilla de este mes y no estaba en la del anterior. Una renovación no es un alta: es la misma póliza que sigue, aunque cambie de número.',
      },
      {
        termino: 'Módulo',
        explicacion: 'Cada una de las grandes secciones de la aplicación, como Cartera o Clientes, accesible desde la barra lateral o desde el mapa de Inicio.',
      },
    ],
  },
}
