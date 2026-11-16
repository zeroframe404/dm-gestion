// Servicio de Río Uruguay Seguros (RUS): la cuenta de su API v2 y la prueba de conexión. Llama a
// `main/aseguradoras/rus/*` y traduce cualquier `ErrorDeRus` a `ErrorDeNegocio`: `ipc.ts` sólo muestra
// el mensaje de un `ErrorDeNegocio`.
//
// Como ATM, Mercantil y Equidad, la cuenta vive en cada computadora (config.json): RUS no pide que los
// pedidos salgan de una IP dada de alta, así que cada PC le habla directo. Se carga una vez y viaja a las
// demás como el ajuste compartido `rusApi` (ver ajustesCompartidos.ts). Cotizar se cotiza desde el
// multicotizador (`main/multicotizador/rus.ts`).
//
// Los permisos (`exigirVista`/`exigirEdicion`) los controla `ipc.ts`, como en el resto de la app.
import type { EstadoDeAjusteCompartido, EstadoDeRus, PruebaDeRus } from '../../shared/tipos'
import { marcasRus, TIPOS_DE_UNIDAD_RUS, vigenciasRus } from '../aseguradoras/rus/catalogos'
import { crearClienteRus, ErrorDeRus, olvidarTokensDeRus, type CuentaRus } from '../aseguradoras/rus/cliente'
import { RAMO_RUS } from '../aseguradoras/rus/cotizacion'
import { esDemo } from '../canal'
import { estadoDeRusDemo, pruebaDeRusDemo } from '../demo/apis'
import { olvidarListasDeRus } from '../multicotizador/rus'
import { borrarRusDelVps, estadoCompartidoDeRus, publicarSinRomper, traerRusDelVps } from './ajustesCompartidos'
import { borrarRus, credencialesRus, cuentaRusVisible, guardarRus, type CredencialesRus } from './config'
import { ErrorDeNegocio } from './errores'

const AMBIENTE_CORTO: Record<CredencialesRus['ambiente'], string> = { produccion: 'producción', sandbox: 'sandbox' }

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cuentaDe(credenciales: CredencialesRus): CuentaRus {
  return { ambiente: credenciales.ambiente, usuario: credenciales.usuario, clave: credenciales.clave, apiKey: credenciales.apiKey }
}

/** Al cambiar la cuenta: ni el token ni las listas de la anterior sirven. */
function olvidarLoDeLaCuentaAnterior(): void {
  olvidarTokensDeRus()
  olvidarListasDeRus()
}

// --- La cuenta -------------------------------------------------------------

/** Cómo está la cuenta en el servidor. No rompe nunca: si no se pudo saber, null y la pantalla lo dice. */
async function compartidoSinRomper(): Promise<EstadoDeAjusteCompartido | null> {
  try {
    return await estadoCompartidoDeRus()
  } catch (error) {
    console.error('[rus] No se pudo saber cómo está la cuenta de RUS en el servidor:', motivo(error))
    return null
  }
}

function armarEstado(compartido: EstadoDeAjusteCompartido | null): EstadoDeRus {
  return { ...cuentaRusVisible(), compartido }
}

export async function estadoRus(): Promise<EstadoDeRus> {
  // Demo: la cuenta de RUS figura cargada (ver demo/apis.ts).
  if (esDemo()) return estadoDeRusDemo()
  return armarEstado(await compartidoSinRomper())
}

/**
 * Guarda la cuenta en esta computadora y la publica para las demás. Si publicar falla, lo guardado
 * acá queda igual: el motivo vuelve en `compartido.error` y la pantalla lo muestra.
 */
export async function guardarCuentaRus(datos: unknown, quien: string | null): Promise<EstadoDeRus> {
  if (esDemo()) return estadoDeRusDemo()
  guardarRus(datos)
  olvidarLoDeLaCuentaAnterior()
  return armarEstado(await publicarSinRomper('rusApi', quien))
}

export async function borrarCuentaRus(): Promise<EstadoDeRus> {
  if (esDemo()) return estadoDeRusDemo()
  borrarRus()
  olvidarLoDeLaCuentaAnterior()
  await borrarRusDelVps().catch((error) => console.error('[ajustes] No se pudo borrar la cuenta de RUS del VPS:', motivo(error)))
  return estadoRus()
}

/** El botón «Traer del servidor»: adopta la cuenta publicada aunque esta computadora tenga otra. */
export async function traerRusDelServidor(): Promise<EstadoDeRus> {
  if (esDemo()) return estadoDeRusDemo()
  let resultado: Awaited<ReturnType<typeof traerRusDelVps>>
  try {
    resultado = await traerRusDelVps()
  } catch (error) {
    if (error instanceof ErrorDeNegocio) throw error
    throw new ErrorDeNegocio(`No se pudo traer la cuenta de RUS del servidor: ${motivo(error)}`)
  }
  if (resultado.adoptadas) olvidarLoDeLaCuentaAnterior()
  const estado = await estadoRus()
  if (!resultado.adoptadas && !estado.compartido?.alDia) throw new ErrorDeNegocio(resultado.detalle)
  return estado
}

// --- Probar conexión ---------------------------------------------------------

/** Lo que conviene revisar según cómo falló. */
function pistaDelFallo(error: unknown): string {
  if (!(error instanceof ErrorDeRus) || error.esDeRed) return ''
  if (error.status === 404) return ' Puede que el ambiente elegido no sea el de la API-Key.'
  if (error.status === 401 || error.status === 403) return ' Si el problema sigue, pedile a integraciones@riouruguay.com.ar que confirme que el usuario y la API-Key están habilitados.'
  return ''
}

function cuando(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * «Probar conexión». No tira nunca: devuelve qué anduvo y qué no, en tres pasos: el token (prueba la
 * API-Key, el usuario y la contraseña), las vigencias de autos (`comunes/vigencias`, prueba los servicios
 * comunes que usa la cotización) y las marcas de autos (prueba el catálogo de vehículos, sin el que no
 * se cotiza).
 */
export async function probarRus(): Promise<PruebaDeRus> {
  if (esDemo()) return pruebaDeRusDemo()
  const credenciales = credencialesRus()
  if (!credenciales) {
    return {
      ok: false,
      detalle: 'No hay una cuenta de RUS cargada en esta computadora: completá el usuario, la contraseña, la API-Key y el código de productor y guardá antes de probar.',
      tokenVenceEn: null,
      vigencias: [],
      marcas: 0,
    }
  }
  const cliente = crearClienteRus(cuentaDe(credenciales))
  const ambiente = AMBIENTE_CORTO[credenciales.ambiente]

  let tokenVenceEn: string | null = null
  try {
    const token = await cliente.token()
    tokenVenceEn = token.venceSegunRus ? new Date(token.venceSegunRus).toISOString() : null
  } catch (error) {
    return { ok: false, detalle: `${motivo(error)}${pistaDelFallo(error)}`, tokenVenceEn: null, vigencias: [], marcas: 0 }
  }
  const partes = [`RUS (${ambiente}) aceptó el usuario ${credenciales.usuario} y la API-Key${tokenVenceEn ? ` (token válido hasta las ${cuando(new Date(tokenVenceEn).getTime())})` : ''}.`]

  const [vigencias, marcas] = await Promise.allSettled([vigenciasRus(cliente, RAMO_RUS.AUTO), marcasRus(cliente, TIPOS_DE_UNIDAD_RUS.AUTO)])
  const nombresDeVigencias = vigencias.status === 'fulfilled' ? vigencias.value.map((v) => v.descripcion) : []
  partes.push(
    vigencias.status === 'fulfilled'
      ? nombresDeVigencias.length > 0
        ? `Vigencias de autos: ${nombresDeVigencias.join(', ').toLowerCase()}.`
        : 'RUS no devolvió vigencias para autos: se cotizará con la de su ejemplo (semestral).'
      : `No se pudieron leer las vigencias (${motivo(vigencias.reason).replace(/\.$/, '')}).${pistaDelFallo(vigencias.reason)}`,
  )
  const cuantasMarcas = marcas.status === 'fulfilled' ? marcas.value.length : 0
  partes.push(
    marcas.status === 'fulfilled'
      ? `Catálogo de vehículos: ${cuantasMarcas === 0 ? 'ninguna marca' : cuantasMarcas === 1 ? '1 marca' : `${cuantasMarcas} marcas`} de autos.`
      : `No se pudo leer el catálogo de vehículos (${motivo(marcas.reason).replace(/\.$/, '')}).${pistaDelFallo(marcas.reason)}`,
  )
  partes.push(`Se cotiza con el productor ${credenciales.productor}${credenciales.solicitante && credenciales.solicitante !== credenciales.productor ? ` (solicitante ${credenciales.solicitante})` : ''}.`)
  const ok = cuantasMarcas > 0
  if (!ok) partes.push('Sin el catálogo de vehículos RUS no cotiza.')
  return { ok, detalle: partes.join(' '), tokenVenceEn, vigencias: nombresDeVigencias, marcas: cuantasMarcas }
}
