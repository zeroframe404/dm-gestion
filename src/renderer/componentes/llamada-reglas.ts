// Lo que la llamada de voz (14.0) MUESTRA, sin una línea de React: el cronómetro y el cartel del corte.
//
// Aparte de `contexto/Llamada.tsx` por lo mismo que `tema-valores.ts` está aparte de `tema.ts`: acá no
// hay nada del navegador, así que el banco de pruebas puede afirmar el texto exacto sin montar la
// pantalla ni abrir Electron (ver `colaboracion-en-vivo.prueba.ts`).
import type { MotivoDeCorteDeLlamada } from '../../shared/tipos'

/** «3:12». El formato del teléfono: minutos sin cero adelante y segundos siempre de dos dígitos. */
export function duracionLegible(segundos: number): string {
  const minutos = Math.floor(segundos / 60)
  const resto = segundos % 60
  return `${minutos}:${String(resto).padStart(2, '0')}`
}

/**
 * Por qué se cortó la llamada, en una frase, o `null` cuando no hay nada que contar.
 *
 * Existe porque una llamada que se cierra sola no deja rastro: el servidor contesta «ocupado» en menos
 * de un segundo y en la pantalla del que llamó la barra verde aparece y desaparece antes de que llegue
 * a leerla. Sin este cartel, «Beto está hablando con otra persona», «Beto cortó» y «se cayó internet»
 * se ven exactamente igual, y lo que hace la persona es volver a apretar «Llamar» y hacerle sonar el
 * tono corto al otro otra vez.
 *
 * Las dos que NO dicen nada son las que la persona ya sabe porque las hizo ella: colgar una charla
 * (`terminada`) y cancelar antes de que atiendan (`cancelada`).
 */
export function fraseDelCorte(motivo: MotivoDeCorteDeLlamada | null): string | null {
  switch (motivo) {
    case 'ocupado':
      return 'Está hablando por teléfono. Probá en un rato.'
    case 'sin-respuesta':
      return 'No atendió. Le queda la llamada perdida en la conversación.'
    case 'rechazada':
      return 'No puede atender ahora.'
    case 'desconexion':
      return 'Se cortó la conexión y la llamada se terminó.'
    default:
      return null
  }
}
