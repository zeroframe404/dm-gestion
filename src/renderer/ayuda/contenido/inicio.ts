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
        termino: 'Módulo',
        explicacion: 'Cada una de las grandes secciones de la aplicación, como Cartera o Clientes, accesible desde la barra lateral o desde el mapa de Inicio.',
      },
    ],
  },
}
