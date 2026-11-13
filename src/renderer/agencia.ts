// La parte de `canal.ts` que no necesita ni React ni la ventana: el canal que ya se sabe y cómo se llama
// la agencia. Está aparte para que la pueda usar `ayuda/manual.ts`, que es TypeScript puro (lo importa
// también el banco de pruebas). Quien pregunta el canal y lo anota acá es `canalDelPrograma()`, en `canal.ts`.
import type { Canal } from '../shared/canal'
import { NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO } from '../shared/demo'
import { MARCA_DEMO } from '../shared/canal'
import { MARCA_DE_FABRICA, type Marca } from '../shared/marca'

let canalConocido: Canal | null = null
let marcaConocida: Marca = MARCA_DE_FABRICA
const oyentesDeMarca = new Set<() => void>()

/** La marca configurada (la de fábrica hasta que contesta el proceso principal). */
export function marcaActual(): Marca {
  return marcaConocida
}

/** La anota y avisa a las pantallas que la muestran. Pintarla en la ventana lo hace `aplicarMarca()`, en `canal.ts`. */
export function anotarMarca(marca: Marca): void {
  marcaConocida = marca
  for (const oyente of oyentesDeMarca) oyente()
}

export function alCambiarMarca(oyente: () => void): () => void {
  oyentesDeMarca.add(oyente)
  return () => {
    oyentesDeMarca.delete(oyente)
  }
}

/** El nombre del programa tal como se ve (sin «(Beta)» ni «(Demo)»): la demo es Cobertia; el resto, la marca configurada. */
export function marcaVisible(canal: Canal = canalSinEsperar()): string {
  return canal === 'demo' ? MARCA_DEMO : marcaConocida.nombre
}

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
  return canal === 'demo' ? NOMBRE_DE_LA_AGENCIA_DE_LA_DEMO : marcaConocida.agencia
}

/**
 * Lo que dice la pantalla después de «Avisar por WhatsApp». En la demo no se abre WhatsApp (se muestra
 * cómo llegaría el mensaje, ver `main/demo/whatsapp.ts`), así que no puede decir «abierto». Sin el punto
 * final del nombre: «FLETES ESCALADA S.R.L.» más el punto de la oración daba «S.R.L..».
 */
export function avisoDeWhatsapp(nombre: string | null): string {
  const quien = (nombre ?? 'el cliente').replace(/\.+$/, '')
  return canalSinEsperar() === 'demo' ? `Se mostró cómo le llegaría el WhatsApp a ${quien} (demostración)` : `WhatsApp abierto para ${quien}`
}
