// Las reglas del glow (14.0) que no dibujan nada: qué frase se lee y qué se guarda.
//
// Vive en un archivo aparte de `componentes/Presencia.tsx` por el mismo motivo que `tema-valores.ts`
// está separado de `tema.ts`: acá adentro no hay una línea de React ni del navegador, así que el banco
// de pruebas —que corre en Node pelado, sin montar nada— puede afirmarlas. Y son cosas que importan: el
// texto es lo que la persona lee cuando el botón de Guardar está apagado, y la regla de abajo es la que
// decide si lo que tipeó se guarda o se tira.
import type { Presente } from '../../main/vivo/protocolo'

/** ¿Está editando de verdad, o nada más mirando? El módulo entero no cuenta como ninguna de las dos. */
export function estaEditando(presente: Presente): boolean {
  return presente.foco !== null && presente.foco.tipo !== 'modulo' && presente.foco.editando
}

/**
 * «Ana está editando», «Ana está mirando», «Ana y Beto están mirando», «Ana y 3 más están mirando».
 *
 * El verbo lo decide si ALGUNA está editando: es la información que cambia lo que se puede hacer, y
 * el que edita es el que traba.
 */
export function textoDePresencia(presentes: readonly Presente[]): string {
  if (presentes.length === 0) return ''
  const verbo = presentes.some(estaEditando) ? 'editando' : 'mirando'
  const nombres = presentes.map((presente) => presente.nombre)
  if (nombres.length === 1) return `${nombres[0]} está ${verbo}`
  if (nombres.length === 2) return `${nombres[0]} y ${nombres[1]} están ${verbo}`
  return `${nombres[0]} y ${nombres.length - 1} más están ${verbo}`
}

/**
 * Lo que se lee en un botón de guardar apagado porque otra persona está editando lo mismo.
 *
 * Sale de acá y no de cada ficha para que las siete digan la misma frase, y para que diga QUÉ hacer:
 * el bloqueo es suave y se suelta solo cuando la otra persona cierra, así que esperar alcanza.
 */
export function motivoDelBloqueo(quien: Presente): string {
  return (
    `${quien.nombre} está editando esto ahora mismo. Si guardás los dos, uno de los dos cambios se pierde. ` +
    'Se destraba solo cuando termine: probá en un ratito.'
  )
}

/**
 * ¿Se guarda lo que quedó escrito en un campo que guarda al SALIR del foco (el panel de detalle de la
 * planilla)?
 *
 * Lo deciden el permiso y el candado que había AL ENTRAR al campo, nunca el candado de ahora. El
 * candado suave es estado VIVO: aparece en cuanto otra computadora entra a la misma fila, y eso puede
 * pasar con la persona a mitad de una palabra. Si lo decidiera el candado de ahora, lo tipeado se
 * tiraría en silencio —el `onBlur` no entraría, no habría ningún cartel, y como el texto sigue a la
 * vista parecería guardado— hasta que la fila se refrescara y volviera el valor viejo.
 *
 * Se guarda igual y el choque lo resuelve la barrera de verdad: cada escritura de celda viaja con el
 * valor anterior y el servidor contesta 409 si cambió en el medio (`previo`). Perder trabajo callado es
 * peor que un pisado avisado.
 */
export function seGuardaAlSalir(trabadoAlEntrar: boolean, escrito: string, original: string): boolean {
  return !trabadoAlEntrar && escrito !== original
}
