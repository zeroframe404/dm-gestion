// Error esperable: su mensaje está pensado para mostrarse tal cual en la interfaz.
export class ErrorDeNegocio extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeNegocio'
  }
}
