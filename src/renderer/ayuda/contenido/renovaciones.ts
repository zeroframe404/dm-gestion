import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_RENOVACIONES: Record<string, ContenidoDeAyuda> = {
  renovaciones: {
    clave: 'renovaciones',
    titulo: 'Renovaciones',
    resumen:
      'Lo que hay que renovar a mano en los próximos 60 días, agrupado semana por semana, para gestionarlo sin salir de la tabla y cerrar cada trámite con «Renovar» o «No renueva».',
    secciones: [
      {
        titulo: 'Qué es esta bandeja',
        parrafos: [
          'Es una pantalla de trabajo, no un informe: junta las pólizas activas que vencen dentro de los próximos 60 días y las agrupa por semana («Esta semana», «La semana que viene», y así siguiendo). Cada semana se puede plegar o desplegar haciendo clic en su título, y trae la cantidad de pólizas y cuántas de ellas son urgentes.',
          'La bandeja muestra sólo las compañías que se renuevan a mano: Agrosalta (cada 4 meses), Río Uruguay (cada 6) y Metropol (cada 12). Las demás renuevan solas, así que no hay nada que hacer con ellas y no molestan en la lista; al costado del contador de la derecha se avisa cuántas quedaron afuera, y con el primer desplegable («Todas las compañías») se ven igual cuando hace falta mirar una en particular.',
          'Cada cuánto renueva cada compañía se carga en Administración → Compañías, en la columna «Renovación (meses)»: dejarla vacía quiere decir que esa compañía renueva sola. Debajo del nombre de la compañía, cada fila dice cuál es su plazo.',
          'Arriba de todo hay tres contadores: «Vencen en 60 días» es el total de lo que hay que renovar a mano; «Vencidas o en 7 días», en rojo, son las que hay que llamar hoy o ya vencieron; «Sin empezar», en ámbar, son las que todavía están en estado Pendiente, sin que nadie las haya tocado.',
        ],
      },
      {
        titulo: 'Filtrar y encontrar lo tuyo',
        parrafos: [
          'El primer desplegable elige qué compañías se miran: «Sólo las que se renuevan a mano» (lo normal) o «Todas las compañías». Después se puede filtrar por Responsable (incluyendo «Sin responsable», para encontrar las que nadie tomó todavía) y por Estado del trámite. La casilla «Ocultar las ya resueltas» esconde las que ya están Renovadas o marcadas No renueva, para que la bandeja muestre sólo lo que sigue pendiente de gestionar.',
        ],
      },
      {
        titulo: 'Gestionar una fila sin salir de la tabla',
        parrafos: [
          'Cada fila de la tabla se puede tocar directamente: el desplegable «Responsable» asigna quién se ocupa de esa renovación, el desplegable «Estado» cambia el trámite entre Pendiente, En curso, Renovada y No renueva, y el campo de nota permite anotar el seguimiento (por ejemplo «lo llamé, dijo que confirma la semana que viene») guardándose solo apenas se sale del campo.',
          'Si una póliza tiene anotado en sus observaciones algo como «20% aumentar cuando se renueva», la fila muestra una etiqueta ámbar con el porcentaje, para que se sepa de entrada que esa renovación viene con aumento.',
        ],
      },
      {
        titulo: 'Renovar o marcar que no renueva',
        parrafos: [
          'Estas son las dos formas de cerrar el trámite. «Renovar» abre un formulario con todo propuesto: la vigencia nueva —corrida por los meses que renueva esa compañía: cuatro en Agrosalta, seis en Río Uruguay, doce en Metropol—, la misma cuota o ya aumentada si las observaciones lo piden (con un botón para volver a la cuota anterior si por esta vez no corresponde el aumento), el número de póliza nuevo y el de propuesta, si ya los tenés. Al guardar, la póliza vieja no desaparece: queda como vigencia histórica, y la nueva es la que sigue activa en la cartera.',
          '«El cliente no renueva» (el botón con la cruz) es lo contrario: se elige un motivo y una nota, y la póliza queda dada de baja. Sale de la bandeja de renovaciones y de la planilla del mes, y pasa a verse en Cartera → Bajas, igual que cualquier otra baja.',
          'El ícono de tarea junto a cada fila crea una tarea vinculada a esa renovación (por ejemplo «llamar para confirmar»), que va a aparecer en el módulo Tareas de quien se le asigne.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Los 60 días',
        explicacion: 'Una póliza entra en esta bandeja apenas le quedan 60 días o menos de vigencia. Es la misma cuenta que muestra el aviso «vence en X días» en Pólizas.',
      },
      {
        termino: 'Renovación manual / automática',
        explicacion:
          'Las compañías que la agencia tiene que renovar a mano —Agrosalta cada 4 meses, Río Uruguay cada 6 y Metropol cada 12— son las que aparecen en esta bandeja. Las demás renuevan solas. Se configura en Administración → Compañías, columna «Renovación (meses)»: vacío = renueva sola.',
      },
      {
        termino: 'Estado del trámite',
        explicacion: 'Pendiente (nadie la tocó), En curso (se está gestionando), Renovada o No renueva: estos dos últimos son los que cierran el trámite y se pueden ocultar con «Ocultar las ya resueltas».',
      },
      {
        termino: 'Aumenta al renovar',
        explicacion: 'Aviso que aparece cuando las observaciones de la póliza piden un aumento (por ejemplo «20% aumentar cuando se renueva»). El formulario de renovar ya propone la cuota con ese aumento aplicado.',
      },
      {
        termino: 'Renovar',
        explicacion: 'Crea la vigencia nueva de la póliza; la anterior queda guardada como histórica, no se borra.',
      },
      {
        termino: 'No renueva',
        explicacion: 'Da de baja la póliza con un motivo: deja de estar en la cartera activa y pasa a Cartera → Bajas.',
      },
    ],
  },
}
