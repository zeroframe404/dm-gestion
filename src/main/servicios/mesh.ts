// El control remoto de las computadoras de la agencia (MeshCentral), visto desde el programa.
//
// Qué resuelve: cuando en Sarandí no anda la impresora, o alguien no puede ingresar, hoy hay que
// acordarse de la dirección de la consola, buscarla en el navegador y esperar a ver si contesta. Acá
// está el botón, y —lo que más importa— está el estado ANTES de abrirla: si el mesh está caído, se
// entera acá en dos segundos y no después de tres minutos mirando una pestaña en blanco.
//
// Lo que este archivo NO hace, a propósito: no guarda usuario ni clave de la consola, y no la abre
// dentro del programa. Se abre en el navegador del sistema. Un control remoto de todas las máquinas
// de la agencia es exactamente el tipo de acceso que conviene que siga pidiendo su propia clave.
import type { EstadoDelMesh } from '../../shared/tipos'
import { urlDelMesh } from './config'
import { esFallaDeRed } from './red'

/**
 * Corto a propósito: esto dibuja una pantalla. Si la consola tarda más de esto en contestar, para
 * quien está esperando ya está caída, y decirlo rápido es más útil que acertar con precisión.
 */
const ESPERA_MAXIMA_MS = 6_000

export async function estadoDelMesh(): Promise<EstadoDelMesh> {
  const url = urlDelMesh()
  const desde = Date.now()
  try {
    // GET y no HEAD: MeshCentral responde 404 a un HEAD sobre la raíz y quedaría marcada como caída
    // estando perfectamente arriba. `redirect: manual` evita seguir un redirect al login y medir de
    // más; cualquier respuesta —incluso un 302— ya significa que hay alguien atendiendo.
    const respuesta = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    })
    const tardanza = Date.now() - desde
    // Un 5xx sí es «está pero no anda»: es el caso del nginx arriba con el contenedor del mesh caído.
    if (respuesta.status >= 500) {
      return {
        url,
        enLinea: false,
        detalle: `La consola contestó ${respuesta.status}: el servidor está, pero el control remoto no. Suele ser el contenedor del mesh caído.`,
        tardanzaMs: tardanza,
      }
    }
    return { url, enLinea: true, detalle: 'La consola está en línea.', tardanzaMs: tardanza }
  } catch (error) {
    return {
      url,
      enLinea: false,
      detalle: esFallaDeRed(error)
        ? 'No se pudo conectar con la consola. Puede ser que esta computadora no tenga internet, o que el control remoto esté caído.'
        : error instanceof Error
          ? error.message
          : String(error),
      tardanzaMs: Date.now() - desde,
    }
  }
}
