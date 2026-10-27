// La parte de `canal.ts` que no necesita ni React ni la ventana: el canal que ya se sabe y cómo se llama
// la agencia. Está aparte para que la pueda usar `ayuda/manual.ts`, que es TypeScript puro (lo importa
// también el banco de pruebas). Quien pregunta el canal y lo anota acá es `canalDelPrograma()`, en `canal.ts`.
import type { Canal } from '../shared/canal'
import { NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO } from '../shared/demo'
import { FIRMA_DE_LOS_MENSAJES } from '../shared/tipos'

let canalConocido: Canal | null = null

/** Lo que contestó el proceso principal. Lo llama `canalDelPrograma()` una sola vez. */
export function anotarCanal(canal: Canal): Canal {
  canalConocido = canal
  return canal
}

/**
 * El canal que ya se sabe, sin esperar: `main.tsx` lo pregunta antes de dibujar la primera pantalla, así
 * que desde ahí en adelante ya está. Si todavía no contestó (o no contestó nunca), `estable`.
 */
export function canalSinEsperar(): Canal {
  return canalConocido ?? 'estable'
}

/**
 * El nombre de la agencia: arriba del de DM Gestión, en el manual y en la ayuda impresa. La demo no es
 * de ninguna. El proceso principal tiene lo mismo para lo que genera él (ver `main/demo/identidad.ts`).
 */
export function nombreDeLaAgencia(canal: Canal = canalSinEsperar()): string {
  return canal === 'demo' ? NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO : FIRMA_DE_LOS_MENSAJES
}
