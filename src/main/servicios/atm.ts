// Servicio de ATM Seguros: la cuenta de su web service, la prueba de conexión y las tablas de
// parámetros que ATM publica por FTP. Llama a `main/aseguradoras/atm/*` y traduce cualquier
// `ErrorDeAtm` a `ErrorDeNegocio`: `ipc.ts` sólo muestra el mensaje de un `ErrorDeNegocio`, así que
// sin esta traducción cualquier falla de ATM se vería en pantalla como el error inesperado genérico.
//
// A DIFERENCIA DE GALENO, la cuenta vive en cada computadora (config.json) y no sólo en el VPS: ATM no
// pide que los pedidos salgan de una IP dada de alta, así que cada PC le habla directo. Se carga una
// vez y viaja a las demás como el ajuste compartido `atmApi`, igual que la app de Meta (ver
// ajustesCompartidos.ts). Cotizar se cotiza desde el multicotizador (`main/multicotizador/atm.ts`).
//
// Los permisos (`exigirVista`/`exigirEdicion`) los controla `ipc.ts`, como en el resto de la app: acá
// no se repiten.
import type {
  AmbienteAtm,
  EstadoDeAjusteCompartido,
  EstadoDeAtm,
  EstadoDeTablasAtm,
  PruebaDeAtm,
  VendedorDeAtm,
} from '../../shared/tipos'
import { planesAtm, vendedoresAtm, type PlanAtm } from '../aseguradoras/atm/catalogos'
import { crearClienteAtm, ErrorDeAtm, type CuentaAtm } from '../aseguradoras/atm/cliente'
import { actualizarTablasAtm, estadoDeTablasAtm, importarTablasAtm, olvidarFallosDeTablasAtm } from '../aseguradoras/atm/repositorio'
import { olvidarListasDeAtm } from '../multicotizador/atm'
import { borrarAtmDelVps, estadoCompartidoDeAtm, publicarSinRomper, traerAtmDelVps } from './ajustesCompartidos'
import { borrarAtm, credencialesAtm, cuentaAtmVisible, guardarAtm } from './config'
import { ErrorDeNegocio } from './errores'

const AMBIENTE_CORTO: Record<AmbienteAtm, string> = { produccion: 'producción', desarrollo: 'desarrollo' }

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Lo que llega a la pantalla. Los errores de ATM ya vienen escritos para mostrarse; cualquier otro (un
 * disco lleno al guardar las tablas, por ejemplo) se anota en el registro y se muestra con contexto.
 */
function comoErrorDeNegocio(error: unknown, contexto: string): ErrorDeNegocio {
  if (error instanceof ErrorDeNegocio) return error
  if (error instanceof ErrorDeAtm) return new ErrorDeNegocio(error.message)
  console.error(`[atm] ${contexto}:`, error)
  return new ErrorDeNegocio(`${contexto}: ${motivo(error)}`)
}

function cuentaDe(credenciales: NonNullable<ReturnType<typeof credencialesAtm>>): CuentaAtm {
  return { ambiente: credenciales.ambiente, usuario: credenciales.usuario, clave: credenciales.clave }
}

// --- La cuenta -------------------------------------------------------------

/** Cómo está la cuenta en el servidor. No rompe nunca: si no se pudo saber, null y la pantalla lo dice. */
async function compartidoSinRomper(): Promise<EstadoDeAjusteCompartido | null> {
  try {
    return await estadoCompartidoDeAtm()
  } catch (error) {
    console.error('[atm] No se pudo saber cómo está la cuenta de ATM en el servidor:', motivo(error))
    return null
  }
}

function armarEstado(compartido: EstadoDeAjusteCompartido | null): EstadoDeAtm {
  const cuenta = cuentaAtmVisible()
  return { ...cuenta, compartido, tablas: estadoDeTablasAtm(cuenta.ambiente) }
}

export async function estadoAtm(): Promise<EstadoDeAtm> {
  return armarEstado(await compartidoSinRomper())
}

/**
 * Guarda la cuenta en esta computadora y la publica para las demás. Si publicar falla, lo guardado
 * acá queda igual: el motivo vuelve en `compartido.error` y la pantalla lo muestra, en vez de un error
 * rojo por algo que sí se guardó.
 */
export async function guardarCuentaAtm(datos: unknown, quien: string | null): Promise<EstadoDeAtm> {
  guardarAtm(datos)
  // Los vendedores y los planes en memoria eran de la cuenta anterior, y la última falla del FTP
  // también (con la clave corregida, las tablas se vuelven a bajar solas sin esperar media hora).
  olvidarListasDeAtm()
  olvidarFallosDeTablasAtm()
  return armarEstado(await publicarSinRomper('atmApi', quien))
}

export async function borrarCuentaAtm(): Promise<EstadoDeAtm> {
  borrarAtm()
  olvidarListasDeAtm()
  olvidarFallosDeTablasAtm()
  // Las tablas bajadas NO se borran: no son de la cuenta sino de ATM, y si el FTP está bloqueado en
  // esta red volver a conseguirlas cuesta. Se usan de nuevo apenas se carga otra cuenta.
  await borrarAtmDelVps().catch((error) => console.error('[ajustes] No se pudo borrar la cuenta de ATM del VPS:', motivo(error)))
  return estadoAtm()
}

/** El botón «Traer del servidor»: adopta la cuenta publicada aunque esta computadora tenga otra. */
export async function traerAtmDelServidor(): Promise<EstadoDeAtm> {
  let resultado: Awaited<ReturnType<typeof traerAtmDelVps>>
  try {
    resultado = await traerAtmDelVps()
  } catch (error) {
    if (error instanceof ErrorDeNegocio) throw error
    throw new ErrorDeNegocio(`No se pudo traer la cuenta de ATM del servidor: ${motivo(error)}`)
  }
  if (resultado.adoptadas) {
    olvidarListasDeAtm()
    olvidarFallosDeTablasAtm()
  }
  const estado = await estadoAtm()
  // «Ya tenía lo mismo» no se adopta y no es una falla; todo lo demás (servidor sin cuenta, sin VPS,
  // un valor con otra forma) sí lo es, y se dice por qué.
  if (!resultado.adoptadas && !estado.compartido?.alDia) throw new ErrorDeNegocio(resultado.detalle)
  return estado
}

// --- Probar conexión ---------------------------------------------------------

/** Lo que conviene revisar según cómo falló la cuenta. */
function pistaDelFallo(ambiente: AmbienteAtm, error: unknown): string {
  if (!(error instanceof ErrorDeAtm)) return ''
  if (error.esDeRed || error.status !== undefined) {
    return ambiente === 'desarrollo' ? ' El ambiente de desarrollo de ATM sólo anda de lunes a viernes de 8 a 18 (hora argentina).' : ''
  }
  return ' Revisá el usuario, la clave y que el ambiente sea el de la cuenta.'
}

/** Sin vendedor cargado, `lista` trae al menos uno: quien llama ya cortó antes si no. */
function textoDelVendedor(configurado: string, lista: VendedorDeAtm[]): string {
  if (!configurado) {
    const primero = lista[0]
    return `No hay vendedor cargado: se cotiza con el primero de la cuenta, ${primero.codigo} (${primero.nombre}).`
  }
  const enLista = lista.find((v) => v.codigo === configurado)
  if (enLista) return `El vendedor ${configurado} es de la cuenta (${enLista.nombre}).`
  // Pasa de verdad: el vendedor que usa la agencia no figura en ws_vendedores y ATM cotiza igual con él.
  const codigos = lista.length > 0 ? lista.map((v) => v.codigo).join(', ') : 'no lista ninguno'
  return (
    `El vendedor ${configurado} no figura entre los que ATM lista para esta cuenta (${codigos}). ` +
    'No siempre es un problema —ATM puede aceptarlo igual—, pero si al cotizar contesta «Vendedor inválido», usá uno de la lista.'
  )
}

function textoDePlanes(que: string, resultado: PromiseSettledResult<PlanAtm[]>): string {
  if (resultado.status === 'rejected') return `${que}, no se pudieron traer (${motivo(resultado.reason).replace(/\.$/, '')})`
  const cuantos = resultado.value.length
  return `${que}, ${cuantos === 0 ? 'ninguno' : cuantos === 1 ? '1 plan' : `${cuantos} planes`}`
}

/**
 * «Probar conexión». No tira nunca, como la de Galeno: devuelve qué anduvo y qué no.
 *
 * Se prueba en dos pasos porque ATM separa las cosas: `ws_vendedores` es el único servicio que pide
 * usuario y clave sin cotizar (prueba la cuenta), y `get_plans` dice qué planes tiene el vendedor con
 * que se va a cotizar (sin planes no hay cotización posible).
 */
export async function probarAtm(): Promise<PruebaDeAtm> {
  const credenciales = credencialesAtm()
  if (!credenciales) {
    return {
      ok: false,
      detalle: 'No hay una cuenta de ATM cargada en esta computadora: completá el usuario y la clave y guardá antes de probar.',
      vendedores: [],
      planesAuto: 0,
      planesMoto: 0,
    }
  }
  const { ambiente, usuario } = credenciales
  const cliente = crearClienteAtm(cuentaDe(credenciales))

  let vendedores: VendedorDeAtm[]
  try {
    vendedores = (await vendedoresAtm(cliente)).map((v) => ({ codigo: v.codigo, nombre: v.nombre }))
  } catch (error) {
    return { ok: false, detalle: `${motivo(error)}${pistaDelFallo(ambiente, error)}`, vendedores: [], planesAuto: 0, planesMoto: 0 }
  }

  const aceptada = `ATM (${AMBIENTE_CORTO[ambiente]}) aceptó el usuario ${usuario}.`
  const vendedor = credenciales.vendedor || vendedores[0]?.codigo || ''
  if (!vendedor) {
    return {
      ok: false,
      detalle: `${aceptada} Pero la cuenta no tiene vendedores: cargá el código de vendedor de 10 números que te dio ATM.`,
      vendedores,
      planesAuto: 0,
      planesMoto: 0,
    }
  }

  const [auto, moto] = await Promise.allSettled([planesAtm(cliente, 'AUTO', vendedor), planesAtm(cliente, 'MOTO', vendedor)])
  const planesAuto = auto.status === 'fulfilled' ? auto.value.length : 0
  const planesMoto = moto.status === 'fulfilled' ? moto.value.length : 0
  const ok = planesAuto > 0 || planesMoto > 0
  const partes = [
    aceptada,
    textoDelVendedor(credenciales.vendedor, vendedores),
    `Planes del vendedor ${vendedor}: ${textoDePlanes('autos', auto)}; ${textoDePlanes('motos', moto)}.`,
  ]
  if (!ok) partes.push('Sin planes ATM no cotiza: revisá el código de vendedor.')
  return { ok, detalle: partes.join(' '), vendedores, planesAuto, planesMoto }
}

// --- Las tablas de parámetros ----------------------------------------------

/** «Actualizar tablas»: las baja del FTP de ATM, que pide el mismo usuario y clave que el web service. */
export async function actualizarTablasDeAtm(): Promise<EstadoDeTablasAtm> {
  const credenciales = credencialesAtm()
  if (!credenciales) {
    throw new ErrorDeNegocio('Para bajar las tablas del FTP de ATM primero cargá la cuenta: el FTP usa el mismo usuario y la misma clave.')
  }
  try {
    return await actualizarTablasAtm(cuentaDe(credenciales))
  } catch (error) {
    throw comoErrorDeNegocio(error, 'No se pudieron guardar las tablas de ATM en esta computadora')
  }
}

/**
 * «Importar desde archivos»: para cuando el FTP no se alcanza desde esta red y alguien las bajó a mano.
 * Van al ambiente de la cuenta cargada (producción si todavía no hay ninguna).
 */
export function importarTablasDeAtm(rutas: string[]): EstadoDeTablasAtm {
  if (rutas.length === 0) throw new ErrorDeNegocio('Elegí al menos un archivo con las tablas de ATM.')
  try {
    return importarTablasAtm(cuentaAtmVisible().ambiente, rutas)
  } catch (error) {
    throw comoErrorDeNegocio(error, 'No se pudieron importar las tablas de ATM')
  }
}
