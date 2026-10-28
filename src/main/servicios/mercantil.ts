// Servicio de Mercantil Andina: la cuenta de su API y la prueba de conexión. Llama a
// `main/aseguradoras/mercantil/*` y traduce cualquier `ErrorDeMercantil` a `ErrorDeNegocio`: `ipc.ts`
// sólo muestra el mensaje de un `ErrorDeNegocio`.
//
// Como ATM, la cuenta vive en cada computadora (config.json): Mercantil no pide que los pedidos salgan
// de una IP dada de alta, así que cada PC le habla directo. Se carga una vez y viaja a las demás como
// el ajuste compartido `mercantilApi` (ver ajustesCompartidos.ts). Cotizar se cotiza desde el
// multicotizador (`main/multicotizador/mercantil.ts`).
//
// Los permisos (`exigirVista`/`exigirEdicion`) los controla `ipc.ts`, como en el resto de la app.
import type { EstadoDeAjusteCompartido, EstadoDeMercantil, ProductorDeMercantil, PruebaDeMercantil } from '../../shared/tipos'
import { marcasMercantil, productoresMercantil } from '../aseguradoras/mercantil/catalogos'
import { crearClienteMercantil, ErrorDeMercantil, olvidarTokensDeMercantil, type CuentaMercantil } from '../aseguradoras/mercantil/cliente'
import { esDemo } from '../canal'
import { estadoDeMercantilDemo, pruebaDeMercantilDemo } from '../demo/apis'
import { olvidarListasDeMercantil } from '../multicotizador/mercantil'
import { borrarMercantilDelVps, estadoCompartidoDeMercantil, publicarSinRomper, traerMercantilDelVps } from './ajustesCompartidos'
import { borrarMercantil, credencialesMercantil, cuentaMercantilVisible, guardarMercantil, type CredencialesMercantil } from './config'
import { ErrorDeNegocio } from './errores'

const AMBIENTE_CORTO: Record<CredencialesMercantil['ambiente'], string> = { produccion: 'producción', desarrollo: 'desarrollo' }

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cuentaDe(credenciales: CredencialesMercantil): CuentaMercantil {
  return { ambiente: credenciales.ambiente, usuario: credenciales.usuario, clave: credenciales.clave, claveDeSuscripcion: credenciales.claveDeSuscripcion }
}

/** Al cambiar la cuenta: ni el token ni las listas de la anterior sirven. */
function olvidarLoDeLaCuentaAnterior(): void {
  olvidarTokensDeMercantil()
  olvidarListasDeMercantil()
}

// --- La cuenta -------------------------------------------------------------

/** Cómo está la cuenta en el servidor. No rompe nunca: si no se pudo saber, null y la pantalla lo dice. */
async function compartidoSinRomper(): Promise<EstadoDeAjusteCompartido | null> {
  try {
    return await estadoCompartidoDeMercantil()
  } catch (error) {
    console.error('[mercantil] No se pudo saber cómo está la cuenta de Mercantil en el servidor:', motivo(error))
    return null
  }
}

function armarEstado(compartido: EstadoDeAjusteCompartido | null): EstadoDeMercantil {
  return { ...cuentaMercantilVisible(), compartido }
}

export async function estadoMercantil(): Promise<EstadoDeMercantil> {
  // Demo: la cuenta de Mercantil figura cargada (ver demo/apis.ts).
  if (esDemo()) return estadoDeMercantilDemo()
  return armarEstado(await compartidoSinRomper())
}

/**
 * Guarda la cuenta en esta computadora y la publica para las demás. Si publicar falla, lo guardado
 * acá queda igual: el motivo vuelve en `compartido.error` y la pantalla lo muestra.
 */
export async function guardarCuentaMercantil(datos: unknown, quien: string | null): Promise<EstadoDeMercantil> {
  if (esDemo()) return estadoDeMercantilDemo()
  guardarMercantil(datos)
  olvidarLoDeLaCuentaAnterior()
  return armarEstado(await publicarSinRomper('mercantilApi', quien))
}

export async function borrarCuentaMercantil(): Promise<EstadoDeMercantil> {
  if (esDemo()) return estadoDeMercantilDemo()
  borrarMercantil()
  olvidarLoDeLaCuentaAnterior()
  await borrarMercantilDelVps().catch((error) => console.error('[ajustes] No se pudo borrar la cuenta de Mercantil del VPS:', motivo(error)))
  return estadoMercantil()
}

/** El botón «Traer del servidor»: adopta la cuenta publicada aunque esta computadora tenga otra. */
export async function traerMercantilDelServidor(): Promise<EstadoDeMercantil> {
  if (esDemo()) return estadoDeMercantilDemo()
  let resultado: Awaited<ReturnType<typeof traerMercantilDelVps>>
  try {
    resultado = await traerMercantilDelVps()
  } catch (error) {
    if (error instanceof ErrorDeNegocio) throw error
    throw new ErrorDeNegocio(`No se pudo traer la cuenta de Mercantil del servidor: ${motivo(error)}`)
  }
  if (resultado.adoptadas) olvidarLoDeLaCuentaAnterior()
  const estado = await estadoMercantil()
  if (!resultado.adoptadas && !estado.compartido?.alDia) throw new ErrorDeNegocio(resultado.detalle)
  return estado
}

// --- Probar conexión ---------------------------------------------------------

/** Lo que conviene revisar según cómo falló. */
function pistaDelFallo(error: unknown): string {
  if (!(error instanceof ErrorDeMercantil)) return ''
  if (error.esDeRed) return ''
  if (error.status === 404) return ' Si la cuenta es nueva, puede que todavía no esté suscripta a ese producto en el portal de APIs.'
  if (error.status === 401 || error.status === 403) return ' Revisá que la suscripción del portal esté activa y que el usuario sea el que Mercantil vinculó al código de PAS.'
  return ''
}

function cuando(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function textoDeProductores(configurado: string, lista: ProductorDeMercantil[]): string {
  if (lista.length === 0) return configurado ? `Se cotiza con el productor ${configurado}.` : 'Se cotiza con el productor que Mercantil asocia al usuario.'
  const nombres = lista.map((p) => `${p.codigo} (${p.nombre})`).join(', ')
  if (!configurado) return `Productor asociado al usuario: ${nombres}. Se cotiza con ése; cargalo en el campo si querés fijarlo.`
  return lista.some((p) => p.codigo === configurado)
    ? `El productor ${configurado} es de la cuenta (${lista.find((p) => p.codigo === configurado)!.nombre}).`
    : `El productor ${configurado} no figura entre los que Mercantil asocia al usuario (${nombres}): si al cotizar lo rechaza, usá uno de ésos.`
}

/**
 * «Probar conexión». No tira nunca: devuelve qué anduvo y qué no, en tres pasos que son los tres
 * secretos de la cuenta: el token (prueba el usuario, la contraseña y la clave de suscripción), el
 * productor asociado (`productores/v1`, prueba que el usuario esté vinculado a un PAS) y las marcas
 * del catálogo (prueba que la suscripción incluya el producto de vehículos, sin el que no se cotiza).
 */
export async function probarMercantil(): Promise<PruebaDeMercantil> {
  if (esDemo()) return pruebaDeMercantilDemo()
  const credenciales = credencialesMercantil()
  if (!credenciales) {
    return {
      ok: false,
      detalle: 'No hay una cuenta de Mercantil cargada en esta computadora: completá el usuario, la contraseña y la clave de suscripción y guardá antes de probar.',
      productores: [],
      marcas: 0,
      tokenVenceEn: null,
    }
  }
  const cliente = crearClienteMercantil(cuentaDe(credenciales))
  const ambiente = AMBIENTE_CORTO[credenciales.ambiente]

  let tokenVenceEn: string | null = null
  try {
    const token = await cliente.token()
    tokenVenceEn = token.venceSegunMercantil ? new Date(token.venceSegunMercantil).toISOString() : null
  } catch (error) {
    return { ok: false, detalle: `${motivo(error)}${pistaDelFallo(error)}`, productores: [], marcas: 0, tokenVenceEn: null }
  }
  const aceptada = `Mercantil (${ambiente}) aceptó el usuario ${credenciales.usuario} y la clave de suscripción${tokenVenceEn ? ` (token válido hasta las ${cuando(new Date(tokenVenceEn).getTime())})` : ''}.`

  const [productores, marcas] = await Promise.allSettled([productoresMercantil(cliente), marcasMercantil(cliente, String(new Date().getFullYear()))])
  const partes = [aceptada]
  const lista = productores.status === 'fulfilled' ? productores.value : []
  partes.push(
    productores.status === 'fulfilled'
      ? textoDeProductores(credenciales.productor, lista)
      : `No se pudo leer el productor asociado (${motivo(productores.reason).replace(/\.$/, '')}).${pistaDelFallo(productores.reason)}`,
  )
  const cuantasMarcas = marcas.status === 'fulfilled' ? marcas.value.length : 0
  partes.push(
    marcas.status === 'fulfilled'
      ? `Catálogo de vehículos: ${cuantasMarcas === 0 ? 'ninguna marca' : cuantasMarcas === 1 ? '1 marca' : `${cuantasMarcas} marcas`} para ${new Date().getFullYear()}.`
      : `No se pudo leer el catálogo de vehículos (${motivo(marcas.reason).replace(/\.$/, '')}).${pistaDelFallo(marcas.reason)}`,
  )
  const ok = cuantasMarcas > 0
  if (!ok) partes.push('Sin el catálogo de vehículos Mercantil no cotiza: revisá que la suscripción del portal incluya el producto Automotores.')
  return { ok, detalle: partes.join(' '), productores: lista, marcas: cuantasMarcas, tokenVenceEn }
}
