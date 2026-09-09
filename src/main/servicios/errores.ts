// Error esperable: su mensaje está pensado para mostrarse tal cual en la interfaz.
export class ErrorDeNegocio extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeNegocio'
  }
}

/**
 * No hay canal en vivo con la base de la agencia: se puede seguir MIRANDO la copia local, pero no
 * escribir (14.0).
 *
 * Hasta la 13.x se escribía igual sin internet y la cola subía al volver, con la regla «el último que
 * llega gana»: dos mostradores cargando la misma póliza con uno de los dos desconectado terminaban
 * con el trabajo de alguien pisado y anotado en el historial. Desde la 14.0 la regla es «ver sí,
 * tocar no», y esto es lo que la hace cumplir desde un solo lugar (`canal().exigirConexion()`).
 *
 * Es un `ErrorDeNegocio` porque el mensaje se muestra tal cual en la pantalla: no es una falla del
 * programa, es el estado normal de una computadora a la que se le cayó internet.
 */
export class SinConexion extends ErrorDeNegocio {
  constructor() {
    super('Sin conexión con la base de la agencia: no se puede guardar hasta que vuelva internet.')
    this.name = 'SinConexion'
  }
}
