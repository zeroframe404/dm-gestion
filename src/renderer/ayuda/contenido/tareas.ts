import type { ContenidoDeAyuda } from '../tipos'

export const AYUDA_TAREAS: Record<string, ContenidoDeAyuda> = {
  tareas: {
    clave: 'tareas',
    titulo: 'Tareas',
    resumen: 'Los pendientes del equipo: a quién le toca, para cuándo, con comentarios y documentos adjuntos.',
    secciones: [
      {
        titulo: 'Qué es esta pantalla',
        parrafos: [
          'Es la lista de pendientes de la agencia, ordenada siempre de la misma forma: primero lo abierto, dentro de eso lo más urgente, y dentro de eso lo que vence antes. Es el orden en que conviene ir resolviéndolas, no un orden que se elija. Por defecto la pantalla arranca mostrando «Las mías», porque lo primero que uno quiere saber al abrir el módulo es qué le toca a uno mismo ese día.',
          'Una tarea puede estar suelta (un pendiente cualquiera) o vinculada a otra ficha —un cliente, una póliza, un siniestro, una consulta, un presupuesto o una renovación—: la columna «De qué ficha» lo muestra, y tocarla lleva directo a esa ficha.',
        ],
      },
      {
        titulo: 'Filtros y contadores',
        parrafos: [
          'El desplegable de responsable tiene tres opciones fijas —«Las mías», «Las de todos» y «Sin responsable»— además de cada persona del equipo, por si hace falta ver puntualmente lo que le toca a otra persona. Se puede filtrar además por prioridad, por sucursal, por texto (busca en el título, en de quién es y en de qué ficha cuelga) y con la casilla «Sólo vencidas y de hoy» para ver nada más que lo urgente.',
          'Los contadores de arriba (Todas, Pendiente, En curso, Hecha) funcionan también como filtro rápido: tocar uno muestra sólo las de ese estado, y tocarlo de nuevo las vuelve a mostrar todas.',
        ],
      },
      {
        titulo: 'Crear y gestionar una tarea',
        parrafos: [
          '«Nueva tarea» pide qué hay que hacer, a quién se le asigna (por defecto, uno mismo), la sucursal, la fecha límite y la prioridad. Las tareas también se crean sin pasar por este botón: desde la ficha de un cliente, una póliza, un siniestro, una renovación o una consulta hay un botón «Nueva tarea» que ya deja el vínculo puesto solo.',
          'Adentro de una tarea, todo se edita en el mismo lugar donde se ve —título, descripción, responsable, sucursal, fecha y prioridad— sin abrir ningún formulario aparte, porque una tarea cambia de dueño o de fecha seguido y no tiene sentido hacer varios clics para eso. El estado (pendiente, en curso, hecha) se cambia con un desplegable arriba de todo. También se pueden adjuntar documentos (fotos, presupuestos, lo que haga falta) arrastrándolos, pegándolos con Ctrl+V o eligiéndolos: suben al servidor de la agencia y, junto con los comentarios, se ven desde cualquier computadora. Hasta la 12.5 los comentarios y los adjuntos quedaban sólo en la PC donde se cargaron.',
        ],
      },
      {
        titulo: 'La campana de tareas',
        parrafos: [
          'Arriba de la aplicación, la campana avisa cuando hay algo tuyo para mirar: un punto rojo significa que te asignaron algo nuevo que todavía no viste, o que algo tuyo está vencido o vence hoy; el número al lado dice cuántas tenés pendientes en total. Una tarea que te asignás vos mismo no enciende el aviso de «nueva» porque ya la viste al crearla; si te la reasigna otra persona, sí. Se actualiza sola cada dos minutos, así que si alguien te asigna algo desde otra computadora lo vas a ver sin tener que refrescar nada.',
        ],
      },
    ],
    conceptos: [
      {
        termino: 'Pendiente / En curso / Hecha',
        explicacion: 'Los tres estados de una tarea: Pendiente (nadie la empezó), En curso (se está gestionando) y Hecha (ya se resolvió).',
      },
      {
        termino: 'Prioridad',
        explicacion: 'ALTA, NORMAL o BAJA: qué tan urgente es la tarea. Las de prioridad ALTA se destacan con una etiqueta roja en toda la aplicación.',
      },
      {
        termino: 'Vinculada / suelta',
        explicacion: 'Una tarea vinculada cuelga de otra ficha (un cliente, una póliza, un siniestro, una renovación, una consulta o un presupuesto) y desde ahí se puede abrir esa ficha con un clic. Una tarea suelta es un pendiente cualquiera, sin ninguna ficha detrás.',
      },
      {
        termino: 'Nueva / pendiente (campana)',
        explicacion: '«Nueva» es algo que te asignaron y todavía no viste (enciende el punto rojo); «pendiente» es cualquier tarea tuya sin terminar, la hayas visto o no (es el número que muestra la campana).',
      },
    ],
  },
}
