// Servicio de La Equidad: la cuenta de su API GLM y la prueba de conexión. Llama a
// `main/aseguradoras/equidad/*` y traduce cualquier `ErrorDeEquidad` a `ErrorDeNegocio`: `ipc.ts`
// sólo muestra el mensaje de un `ErrorDeNegocio`.
//
// Como ATM y Mercantil, la cuenta vive en cada computadora (config.json): Equidad no pide que los
// pedidos salgan de una IP dada de alta, así que cada PC le habla directo. Se carga una vez y viaja a
// las demás como el ajuste compartido `equidadApi` (ver ajustesCompartidos.ts). Cotizar se cotiza
// desde el multicotizador (`main/multicotizador/equidad.ts`).
//
// Los permisos (`exigirVista`/`exigirEdicion`) los controla `ipc.ts`, como en el resto de la app.
import type { EstadoDeAjusteCompartido, EstadoDeEquidad, ProductorDeEquidad, PruebaDeEquidad } from '../../shared/tipos'
import { marcasEquidad, productoresEquidad, tiposDePolizaEquidad, type ContextoEquidad, type OpcionEquidad } from '../aseguradoras/equidad/catalogos'
import { crearClienteEquidad, ErrorDeEquidad, olvidarSesionesDeEquidad, type CuentaEquidad } from '../aseguradoras/equidad/cliente'
import { esDemo } from '../canal'
import { estadoDeEquidadDemo, pruebaDeEquidadDemo } from '../demo/apis'
import { olvidarListasDeEquidad } from '../multicotizador/equidad'
import { borrarEquidadDelVps, estadoCompartidoDeEquidad, publicarSinRomper, traerEquidadDelVps } from './ajustesCompartidos'
import { borrarEquidad, credencialesEquidad, cuentaEquidadVisible, guardarEquidad, type CredencialesEquidad } from './config'
import { ErrorDeNegocio } from './errores'

const AMBIENTE_CORTO: Record<CredencialesEquidad['ambiente'], string> = { produccion: 'producción', prueba: 'prueba' }

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function cuentaDe(credenciales: CredencialesEquidad): CuentaEquidad {
  return {
    urlBase: credenciales.urlBase,
    usuario: credenciales.usuario,
    clave: credenciales.clave,
    usuarioDeServicio: credenciales.usuarioDeServicio,
    claveDeServicio: credenciales.claveDeServicio,
  }
}

/** Al cambiar la cuenta: ni la sesión ni las listas de la anterior sirven. */
function olvidarLoDeLaCuentaAnterior(): void {
  olvidarSesionesDeEquidad()
  olvidarListasDeEquidad()
}

// --- La cuenta -------------------------------------------------------------

/** Cómo está la cuenta en el servidor. No rompe nunca: si no se pudo saber, null y la pantalla lo dice. */
async function compartidoSinRomper(): Promise<EstadoDeAjusteCompartido | null> {
  try {
    return await estadoCompartidoDeEquidad()
  } catch (error) {
    console.error('[equidad] No se pudo saber cómo está la cuenta de Equidad en el servidor:', motivo(error))
    return null
  }
}

function armarEstado(compartido: EstadoDeAjusteCompartido | null): EstadoDeEquidad {
  return { ...cuentaEquidadVisible(), compartido }
}

export async function estadoEquidad(): Promise<EstadoDeEquidad> {
  // Demo: la cuenta de Equidad figura cargada (ver demo/apis.ts).
  if (esDemo()) return estadoDeEquidadDemo()
  return armarEstado(await compartidoSinRomper())
}

/**
 * Guarda la cuenta en esta computadora y la publica para las demás. Si publicar falla, lo guardado
 * acá queda igual: el motivo vuelve en `compartido.error` y la pantalla lo muestra.
 */
export async function guardarCuentaEquidad(datos: unknown, quien: string | null): Promise<EstadoDeEquidad> {
  if (esDemo()) return estadoDeEquidadDemo()
  guardarEquidad(datos)
  olvidarLoDeLaCuentaAnterior()
  return armarEstado(await publicarSinRomper('equidadApi', quien))
}

export async function borrarCuentaEquidad(): Promise<EstadoDeEquidad> {
  if (esDemo()) return estadoDeEquidadDemo()
  borrarEquidad()
  olvidarLoDeLaCuentaAnterior()
  await borrarEquidadDelVps().catch((error) => console.error('[ajustes] No se pudo borrar la cuenta de Equidad del VPS:', motivo(error)))
  return estadoEquidad()
}

/** El botón «Traer del servidor»: adopta la cuenta publicada aunque esta computadora tenga otra. */
export async function traerEquidadDelServidor(): Promise<EstadoDeEquidad> {
  if (esDemo()) return estadoDeEquidadDemo()
  let resultado: Awaited<ReturnType<typeof traerEquidadDelVps>>
  try {
    resultado = await traerEquidadDelVps()
  } catch (error) {
    if (error instanceof ErrorDeNegocio) throw error
    throw new ErrorDeNegocio(`No se pudo traer la cuenta de Equidad del servidor: ${motivo(error)}`)
  }
  if (resultado.adoptadas) olvidarLoDeLaCuentaAnterior()
  const estado = await estadoEquidad()
  if (!resultado.adoptadas && !estado.compartido?.alDia) throw new ErrorDeNegocio(resultado.detalle)
  return estado
}

// --- Probar conexión ---------------------------------------------------------

/** Lo que conviene revisar según cómo falló. */
function pistaDelFallo(error: unknown): string {
  if (!(error instanceof ErrorDeEquidad)) return ''
  if (error.esDeRed) return ' Fijate que la URL base sea la que dio Equidad y que esta computadora llegue a ella.'
  if (error.status === 404) return ' La URL base tiene que terminar en /servlet/ (como en los ejemplos de la documentación).'
  if (error.status === 401) return ''
  if (error.status === 400) return ' Puede ser la rama o el código de empresa: revisalos con Equidad.'
  return ''
}

function cuando(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

function textoDeProductores(configurado: string, lista: ProductorDeEquidad[]): string {
  if (lista.length === 0) return configurado ? `Se cotiza con el productor ${configurado}.` : 'La API no listó productores para el usuario: cargá el código de productor a mano.'
  const nombres = lista.map((p) => `${p.codigo} (${p.nombre})`).join(', ')
  if (!configurado) return lista.length === 1 ? `Productor del usuario: ${nombres}. Se cotiza con ése.` : `Productores del usuario: ${nombres}. Sin elegir uno se cotiza con el primero; cargalo en el campo para fijarlo.`
  return lista.some((p) => p.codigo === configurado)
    ? `El productor ${configurado} es del usuario (${lista.find((p) => p.codigo === configurado)!.nombre}).`
    : `El productor ${configurado} no figura entre los del usuario (${nombres}): si al cotizar lo rechaza, usá uno de ésos.`
}

/**
 * «Probar conexión». No tira nunca: devuelve qué anduvo y qué no, en cuatro pasos: la autenticación
 * (prueba la URL base, el usuario de aplicación y, si hay, el de servicio), los productores del
 * usuario, los tipos de póliza de la rama (prueba que la rama sea la de autos) y las marcas del
 * catálogo (sin las que no se cotiza).
 */
export async function probarEquidad(): Promise<PruebaDeEquidad> {
  if (esDemo()) return pruebaDeEquidadDemo()
  const sinNada = { productores: [] as ProductorDeEquidad[], tiposDePoliza: [] as OpcionEquidad[], marcas: 0, usuarioCodigo: '', usuarioNombre: '', tokenVenceEn: null }
  const credenciales = credencialesEquidad()
  if (!credenciales) {
    return { ok: false, detalle: 'No hay una cuenta de Equidad cargada en esta computadora: completá la URL base, el usuario y la contraseña de la API y guardá antes de probar.', ...sinNada }
  }
  const cliente = crearClienteEquidad(cuentaDe(credenciales))
  const ambiente = AMBIENTE_CORTO[credenciales.ambiente]

  let usuarioCodigo = ''
  let usuarioNombre = ''
  let tokenVenceEn: string | null = null
  try {
    const sesion = await cliente.sesion()
    usuarioCodigo = sesion.usuarioCodigo
    usuarioNombre = sesion.usuarioNombre
    tokenVenceEn = sesion.venceSegunEquidad ? new Date(sesion.venceSegunEquidad).toISOString() : null
  } catch (error) {
    return { ok: false, detalle: `${motivo(error)}${pistaDelFallo(error)}`, ...sinNada }
  }
  const aceptada = `Equidad (${ambiente}) aceptó el usuario ${credenciales.usuario}${usuarioNombre ? ` (${usuarioNombre})` : ''}: código de usuario ${usuarioCodigo}${tokenVenceEn ? `, token válido hasta las ${cuando(new Date(tokenVenceEn).getTime())}` : ''}.`

  const contexto: ContextoEquidad = { usuario: usuarioCodigo, empresa: credenciales.empresa, rama: credenciales.rama }
  const [productores, tipos, marcas] = await Promise.allSettled([productoresEquidad(cliente, contexto), tiposDePolizaEquidad(cliente, contexto), marcasEquidad(cliente, contexto)])
  const partes = [aceptada]
  const lista = productores.status === 'fulfilled' ? productores.value : []
  partes.push(
    productores.status === 'fulfilled'
      ? textoDeProductores(credenciales.productor, lista)
      : `No se pudieron leer los productores del usuario (${motivo(productores.reason).replace(/\.$/, '')}).${pistaDelFallo(productores.reason)}`,
  )
  const tiposDePoliza = tipos.status === 'fulfilled' ? tipos.value : []
  partes.push(
    tipos.status === 'fulfilled'
      ? tiposDePoliza.length === 0
        ? `La rama ${credenciales.rama} no tiene tipos de póliza para este usuario: revisá el código de rama de automotores.`
        : `Rama ${credenciales.rama}: ${tiposDePoliza.map((t) => `${t.codigo} ${t.descripcion}`).join(', ')}.`
      : `No se pudieron leer los tipos de póliza de la rama ${credenciales.rama} (${motivo(tipos.reason).replace(/\.$/, '')}).${pistaDelFallo(tipos.reason)}`,
  )
  const cuantasMarcas = marcas.status === 'fulfilled' ? marcas.value.length : 0
  partes.push(
    marcas.status === 'fulfilled'
      ? `Catálogo de vehículos: ${cuantasMarcas === 0 ? 'ninguna marca' : cuantasMarcas === 1 ? '1 marca' : `${cuantasMarcas} marcas`}.`
      : `No se pudo leer el catálogo de vehículos (${motivo(marcas.reason).replace(/\.$/, '')}).${pistaDelFallo(marcas.reason)}`,
  )
  const ok = cuantasMarcas > 0 && tiposDePoliza.length > 0
  if (!ok) partes.push('Sin el catálogo de vehículos y un tipo de póliza Equidad no cotiza.')
  return { ok, detalle: partes.join(' '), usuarioCodigo, usuarioNombre, tokenVenceEn, productores: lista, tiposDePoliza, marcas: cuantasMarcas }
}
