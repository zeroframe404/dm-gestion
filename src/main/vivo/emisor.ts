// Por dónde salen los frames que manda esta computadora (14.0).
//
// Existe por una sola razón: que `presencia.ts` y `llamadas.ts` puedan MANDAR sin importar a
// `canal.ts`. El canal ya los importa a ellos —es quien reparte lo que llega—, así que la flecha de
// vuelta cerraría un círculo, que es lo mismo que se evitó entre la sesión y el cartero
// (`servicios/sesion.ts`) y por el mismo motivo: el banco de pruebas carga estos módulos sueltos.
//
// El canal se anota acá cuando saluda y se borra cuando para. Sin canal anotado —o con el socket
// cerrado— el frame simplemente no sale y quien lo mandó se entera por el `false`: un foco que no llegó
// no rompe nada (el servidor manda la foto entera de la presencia apenas alguien se mueve) y una señal
// de llamada que no llegó la resuelve el corte por desconexión.
import type { DelCliente } from './protocolo'

interface ParaMandar {
  enviar(mensaje: DelCliente): boolean
}

let activo: ParaMandar | null = null

/** Lo llama el canal: al saludar se anota, al parar se borra (con `null`). */
export function usarCanalActivo(canal: ParaMandar | null): void {
  activo = canal
}

/** Igual que `usarCanalActivo(null)`, pero sólo si el que se va es el que estaba anotado. */
export function dejarDeSerElCanalActivo(canal: ParaMandar): void {
  if (activo === canal) activo = null
}

/** Manda un frame por el canal del proceso. Devuelve false si no salió. */
export function mandarPorElCanal(mensaje: DelCliente): boolean {
  return activo ? activo.enviar(mensaje) : false
}
