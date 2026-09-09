// El cliente de GET /api/dmg/metricas/:clave: trae lo que el servidor ya calculó de una métrica (el
// podio de sucursales, por ahora) en vez de que cada computadora la calcule con su propia base, que
// puede estar más o menos al día que la de al lado.
//
// Es la mitad de bajada del mismo mecanismo que trae los cambios de la grilla: la foto que llega por
// el canal en vivo (ver vivo/grilla.ts; hasta la 13.x lo traía un long-poll, borrado en la 14.0) trae
// también la versión de cada métrica. Cuando una versión no coincide con la que esta computadora ya
// tiene, se llama a esto para traer el resultado nuevo.
//
// Por qué una función suelta y no una clase con estado, a diferencia de PuenteDeMensajes: acá no hay
// nada que recordar entre un pedido y el siguiente —ni credenciales que convenga guardar una sola
// vez—, así que alcanza con pasarle las credenciales cada vez.
//
// CÓMO TRATA LOS ERRORES: devolviendo `null`, nunca tirando. Una métrica sola que no se pudo traer no
// tiene que frenar el resto de la foto: se sigue con las demás métricas y con las pestañas igual, y
// esta versión se vuelve a pedir sola en la próxima porque la versión conocida sigue sin coincidir.
// Por eso todo lo que no sea un 2xx con el cuerpo esperado devuelve `null`: quien llama no tiene que
// poner un `try/catch` para algo que se resuelve solo.

/** Un pedido normal: si el servidor tarda más que esto, algo está mal. No es un long-poll. */
const TIEMPO_MAXIMO_MS = 15_000

export interface MetricaDelServidor {
  disponible: boolean
  version: number
  calculadoEn: string
  payload: unknown
}

/** Lo que llegó, quedándose sólo con lo que tiene la forma esperada; `null` si no la tiene. */
function metricaDeLaRespuesta(json: unknown): MetricaDelServidor | null {
  if (!json || typeof json !== 'object') return null
  const cuerpo = json as { disponible?: unknown; version?: unknown; calculadoEn?: unknown; payload?: unknown }
  if (cuerpo.disponible === false) return { disponible: false, version: 0, calculadoEn: '', payload: null }
  if (cuerpo.disponible !== true) return null
  if (typeof cuerpo.version !== 'number' || !Number.isFinite(cuerpo.version)) return null
  if (typeof cuerpo.calculadoEn !== 'string' || !cuerpo.calculadoEn) return null
  return { disponible: true, version: cuerpo.version, calculadoEn: cuerpo.calculadoEn, payload: cuerpo.payload ?? null }
}

/**
 * Trae lo que el servidor tiene calculado de una métrica.
 *
 * `null` es «no se pudo saber» —sin conexión, tiempo agotado, un error del servidor, o una respuesta
 * cortada a la mitad o con una forma que no es la esperada— y se trata siempre igual: como si el
 * pedido no hubiera llegado, nunca como un falso «no hay nada». `{disponible: false, ...}` es la
 * respuesta de verdad del servidor cuando esa métrica todavía no se calculó ni una vez.
 *
 * `senal` es la de cerrar sesión o cerrar el programa: sin ella, apagar la aplicación en medio de este
 * pedido esperaría a que termine solo.
 */
export async function traerMetricaDelServidor(
  clave: string,
  credenciales: { urlBase: string; token: string },
  senal?: AbortSignal,
): Promise<MetricaDelServidor | null> {
  const urlBase = credenciales.urlBase.replace(/\/+$/, '')
  const corte = senal ? AbortSignal.any([AbortSignal.timeout(TIEMPO_MAXIMO_MS), senal]) : AbortSignal.timeout(TIEMPO_MAXIMO_MS)

  let bruta: Response
  try {
    bruta = await fetch(`${urlBase}/api/dmg/metricas/${encodeURIComponent(clave)}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${credenciales.token}` },
      signal: corte,
    })
  } catch {
    // Sin conexión, tiempo agotado o se cortó a mitad de camino: nada que devolver, se reintenta solo.
    return null
  }

  if (bruta.status < 200 || bruta.status >= 300) return null

  let json: unknown
  try {
    json = await bruta.json()
  } catch {
    // Igual que en FuenteVps: con estado 2xx, un cuerpo ilegible es la misma conexión que se cortó a
    // la mitad, no una respuesta vacía de verdad. Tratarlo como éxito acá dejaría a esta
    // computadora creyendo que ya sabe que la métrica no está disponible, cuando en realidad no se
    // pudo ni preguntar.
    return null
  }

  return metricaDeLaRespuesta(json)
}
