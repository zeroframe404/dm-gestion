// «Probar conexión» de Administración → Servidor (VPS), en la demo.
//
// La demo no sale a internet, así que esto NO se conecta a la dirección que se escribe: recorre los
// mismos pasos que hace el programa de verdad al hablar con el VPS de una agencia y explica qué se
// comprueba en cada uno. Lo que sí se valida de verdad es lo que se puede validar sin red —que la
// dirección sea https, que el token tenga el largo que exige el servidor—, que es justamente lo que
// suele estar mal la primera vez.
import type { PasoDePruebaDeVps } from '../../shared/demo'
import { esDemo } from '../canal'
import { ErrorDeNegocio } from '../servicios/errores'

/** El largo mínimo del DMG_SYNC_TOKEN que acepta el servidor. */
const LARGO_MINIMO_DEL_TOKEN = 16

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))

export async function probarVpsEnLaDemo(datos: { urlBase: string; token: string }): Promise<PasoDePruebaDeVps[]> {
  if (!esDemo()) throw new ErrorDeNegocio('La prueba simulada del servidor existe sólo en la versión de demostración.')
  const pasos: PasoDePruebaDeVps[] = []
  const urlTexto = (datos.urlBase ?? '').trim()
  const token = (datos.token ?? '').trim()

  let url: URL | null = null
  try {
    url = new URL(urlTexto)
  } catch {
    url = null
  }
  if (!url || !/^https?:$/.test(url.protocol)) {
    pasos.push({ paso: 'Dirección del servidor', ok: false, detalle: 'No es una dirección web. Tiene que ser algo como https://gestion.suagencia.com.ar' })
    return pasos
  }
  pasos.push({ paso: 'Dirección del servidor', ok: true, detalle: `${url.origin} (las rutas del programa cuelgan de ${url.origin}/api/dmg)` })

  await esperar(350)
  pasos.push({ paso: 'Nombre del servidor (DNS)', ok: true, detalle: `${url.hostname} → resuelto (simulado: la demo no sale a internet).` })

  await esperar(300)
  if (url.protocol !== 'https:') {
    pasos.push({
      paso: 'Conexión segura (HTTPS)',
      ok: false,
      detalle: 'El servidor tiene que atender por https: el token y los datos de los clientes viajan en cada pedido. Con nginx y un certificado de Let’s Encrypt alcanza.',
    })
    return pasos
  }
  pasos.push({ paso: 'Conexión segura (HTTPS)', ok: true, detalle: 'Certificado válido (simulado).' })

  await esperar(300)
  pasos.push({ paso: 'El puente responde (GET /api/dmg/estado)', ok: true, detalle: 'Contestó en 84 ms (simulado).' })

  await esperar(250)
  if (token.length < LARGO_MINIMO_DEL_TOKEN) {
    pasos.push({
      paso: 'Token del puente',
      ok: false,
      detalle: `El token tiene que ser el mismo DMG_SYNC_TOKEN del .env del servidor, de al menos ${LARGO_MINIMO_DEL_TOKEN} caracteres.`,
    })
    return pasos
  }
  pasos.push({ paso: 'Token del puente', ok: true, detalle: 'Aceptado (simulado).' })

  await esperar(250)
  pasos.push({ paso: 'Canal en vivo (WebSocket /api/dmg/vivo)', ok: true, detalle: 'Presencia, avisos, chat y llamadas: abierto (simulado).' })

  await esperar(200)
  pasos.push({
    paso: 'Base de la agencia',
    ok: true,
    detalle: 'Vacía: al conectarse por primera vez, Administración → Base de datos ofrece cargarla desde la planilla de la agencia.',
  })
  return pasos
}
