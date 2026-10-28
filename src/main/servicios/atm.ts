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
  DatosDeEmisionAtm,
  EmisionAtm,
  EstadoDeAjusteCompartido,
  EstadoDeAtm,
  EstadoDeTablasAtm,
  OpcionesDeEmisionAtm,
  PersonaDeAtm,
  PruebaDeAtm,
  VendedorDeAtm,
} from '../../shared/tipos'
import { planesAtm, vendedoresAtm, type PlanAtm } from '../aseguradoras/atm/catalogos'
import { crearClienteAtm, ErrorDeAtm, type CuentaAtm } from '../aseguradoras/atm/cliente'
import { emitirPropuestaAtm } from '../aseguradoras/atm/propuesta'
import { actualizarTablasAtm, estadoDeTablasAtm, importarTablasAtm, olvidarFallosDeTablasAtm, tablasEnDisco } from '../aseguradoras/atm/repositorio'
import { localidadesDeAtm, TABLAS_DE_EMISION, type ListasDeEmisionAtm, type TablaAtm, type TablasAtm } from '../aseguradoras/atm/tablas'
import { esDemo } from '../canal'
import { actualizarTablasDeAtmDemo, emisionDeAtmDemo, estadoDeAtmDemo, opcionesDeEmisionAtmDemo, pruebaDeAtmDemo } from '../demo/apis'
import { olvidarListasDeAtm } from '../multicotizador/atm'
import { borrarAtmDelVps, estadoCompartidoDeAtm, publicarSinRomper, traerAtmDelVps } from './ajustesCompartidos'
import { borrarAtm, credencialesAtm, cuentaAtmVisible, guardarAtm } from './config'
import { ErrorDeNegocio } from './errores'
import { objeto, texto } from './validacion'

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
  // Demo: la cuenta de ATM figura cargada, con las tablas al día (ver demo/apis.ts).
  if (esDemo()) return estadoDeAtmDemo()
  return armarEstado(await compartidoSinRomper())
}

/**
 * Guarda la cuenta en esta computadora y la publica para las demás. Si publicar falla, lo guardado
 * acá queda igual: el motivo vuelve en `compartido.error` y la pantalla lo muestra, en vez de un error
 * rojo por algo que sí se guardó.
 */
export async function guardarCuentaAtm(datos: unknown, quien: string | null): Promise<EstadoDeAtm> {
  if (esDemo()) return estadoDeAtmDemo()
  guardarAtm(datos)
  // Los vendedores y los planes en memoria eran de la cuenta anterior, y la última falla del FTP
  // también (con la clave corregida, las tablas se vuelven a bajar solas sin esperar media hora).
  olvidarListasDeAtm()
  olvidarFallosDeTablasAtm()
  return armarEstado(await publicarSinRomper('atmApi', quien))
}

export async function borrarCuentaAtm(): Promise<EstadoDeAtm> {
  if (esDemo()) return estadoDeAtmDemo()
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
  if (esDemo()) return estadoDeAtmDemo()
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
  if (esDemo()) return pruebaDeAtmDemo()
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
  // Demo: no hay FTP al que ir; las tablas «se bajan» igual.
  if (esDemo()) return actualizarTablasDeAtmDemo('ftp')
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
  // Demo: las tablas ya están; no se lee ni se pisa nada.
  if (esDemo()) return estadoDeAtmDemo().tablas
  try {
    return importarTablasAtm(cuentaAtmVisible().ambiente, rutas)
  } catch (error) {
    throw comoErrorDeNegocio(error, 'No se pudieron importar las tablas de ATM')
  }
}

// --- La emisión --------------------------------------------------------------
//
// Se emite desde el multicotizador, sobre una cobertura recién cotizada: ATM convierte esa operación en
// propuesta o póliza (AUTOS_Propuesta_PHP, ver aseguradoras/atm/propuesta.ts).

/** Qué lista de valores sale de cada tabla de emisión. */
const LISTA_DE_TABLA: Record<string, keyof ListasDeEmisionAtm> = {
  ws_au_tipo_doc: 'tiposDeDocumento',
  ws_au_sexo: 'sexos',
  ws_au_est_civil: 'estadosCiviles',
  ws_au_nacionalidad: 'nacionalidades',
  ws_au_actividad: 'actividades',
  ws_au_forma_pago: 'formasDePago',
  ws_au_tarjeta: 'tarjetas',
  ws_au_resp_inspeccion: 'responsablesDeInspeccion',
}

function tablasDeEmisionQueFaltan(tablas: TablasAtm | null): TablaAtm[] {
  return TABLAS_DE_EMISION.filter((tabla) => !tablas || tablas.emision[LISTA_DE_TABLA[tabla]!].length === 0)
}

/** Las computadoras que bajaron las tablas antes de que se usaran para emitir no tienen éstas: se bajan una vez. */
const yaSeBuscaronLasDeEmision = new Set<AmbienteAtm>()

export async function opcionesDeEmisionAtm(codigoPostal: string): Promise<OpcionesDeEmisionAtm> {
  if (esDemo()) return opcionesDeEmisionAtmDemo(codigoPostal)
  const credenciales = credencialesAtm()
  if (!credenciales) throw new ErrorDeNegocio('Falta cargar la cuenta de ATM en API Aseguradoras → ATM.')
  let tablas = tablasEnDisco(credenciales.ambiente)
  if (tablasDeEmisionQueFaltan(tablas).length > 0 && !yaSeBuscaronLasDeEmision.has(credenciales.ambiente)) {
    yaSeBuscaronLasDeEmision.add(credenciales.ambiente)
    try {
      await actualizarTablasAtm(cuentaDe(credenciales))
    } catch (error) {
      console.error('[atm] No se pudieron bajar las tablas para emitir:', motivo(error))
    }
    tablas = tablasEnDisco(credenciales.ambiente)
  }
  const vacias: ListasDeEmisionAtm = {
    tiposDeDocumento: [],
    sexos: [],
    estadosCiviles: [],
    nacionalidades: [],
    actividades: [],
    formasDePago: [],
    tarjetas: [],
    responsablesDeInspeccion: [],
  }
  const provincias = new Map<string, string>()
  for (const l of tablas?.localidades ?? []) if (l.codigoProvincia && !provincias.has(l.codigoProvincia)) provincias.set(l.codigoProvincia, l.provincia)
  return {
    ...(tablas?.emision ?? vacias),
    provincias: [...provincias]
      .map(([codigo, descripcion]) => ({ codigo, descripcion }))
      .sort((a, b) => a.descripcion.localeCompare(b.descripcion, 'es')),
    localidades: tablas ? localidadesDeAtm(tablas, codigoPostal.trim()) : [],
    faltan: tablasDeEmisionQueFaltan(tablas),
  }
}

function opcional(valor: unknown, campo: string, maximo: number): string | undefined {
  if (valor === undefined || valor === null || valor === '') return undefined
  const limpio = texto(valor, campo, 0, maximo)
  return limpio || undefined
}

function numerico(valor: unknown, campo: string, minimo: number, maximo: number): string {
  const limpio = texto(valor, campo, 1, 40).replace(/[\s.-]/g, '')
  if (!/^\d+$/.test(limpio)) throw new ErrorDeNegocio(`${campo} tiene que ser numérico.`)
  if (limpio.length < minimo || limpio.length > maximo) throw new ErrorDeNegocio(`${campo} no es válido.`)
  return limpio
}

function personaDeAtm(valor: unknown, quien: string): PersonaDeAtm {
  const p = objeto(valor, `Los datos de ${quien}`)
  return {
    tipoDocumento: texto(p.tipoDocumento, `El tipo de documento de ${quien}`, 1, 10),
    numeroDocumento: numerico(p.numeroDocumento, `El documento de ${quien}`, 6, 11),
    apellido: texto(p.apellido, `El apellido de ${quien}`, 1, 100),
    nombre: texto(p.nombre, `El nombre de ${quien}`, 1, 100),
  }
}

/** Lo que el manual marca como obligatorio, revisado antes de mandar: ATM rechaza de a un motivo. */
export function validarDatosDeEmisionAtm(datos: unknown): DatosDeEmisionAtm {
  const d = objeto(datos, 'Los datos de la emisión')
  const operacion = numerico(d.operacion, 'El número de operación (volvé a cotizar si se perdió)', 1, 15)
  const t = objeto(d.titular, 'Los datos del titular')
  const tipoPersona = t.tipoPersona === 'J' ? 'J' : t.tipoPersona === 'F' ? 'F' : null
  if (!tipoPersona) throw new ErrorDeNegocio('El tipo de persona del titular no es válido.')
  const esFisica = tipoPersona === 'F'
  const telefono = opcional(t.telefono, 'El teléfono', 20)
  const celular = opcional(t.celular, 'El celular', 20)
  if (!telefono && !celular) throw new ErrorDeNegocio('Cargá un teléfono o un celular del titular.')
  const email = texto(t.email, 'El email del titular', 1, 100)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErrorDeNegocio('El email del titular no es válido.')
  const titular: DatosDeEmisionAtm['titular'] = {
    tipoPersona,
    tipoDocumento: texto(t.tipoDocumento, 'El tipo de documento', 1, 10),
    numeroDocumento: numerico(t.numeroDocumento, 'El número de documento', 6, 11),
    apellido: texto(t.apellido, esFisica ? 'El apellido y nombre' : 'La razón social', 1, 100),
    codigoProvincia: texto(t.codigoProvincia, 'La provincia del domicilio', 1, 5),
    localidad: texto(t.localidad, 'La localidad del domicilio', 1, 100),
    calle: texto(t.calle, 'La calle', 1, 100),
    altura: numerico(t.altura, 'La altura de la calle', 1, 10),
    piso: opcional(t.piso, 'El piso', 5),
    depto: opcional(t.depto, 'El departamento', 5),
    codigoPostal: numerico(t.codigoPostal, 'El código postal', 4, 4),
    subCodigoPostal: opcional(t.subCodigoPostal, 'El subcódigo postal', 5),
    telefono,
    celular,
    email,
    actividad: opcional(t.actividad, 'La actividad', 10),
    cuit: t.cuit ? numerico(t.cuit, 'El CUIT', 11, 11) : undefined,
  }
  if (esFisica) {
    titular.sexo = texto(t.sexo, 'El sexo', 1, 5)
    titular.estadoCivil = texto(t.estadoCivil, 'El estado civil', 1, 5)
    titular.nacionalidad = texto(t.nacionalidad, 'La nacionalidad', 1, 5)
    titular.actividad = texto(t.actividad, 'La actividad', 1, 10)
    titular.provinciaNacimiento = opcional(t.provinciaNacimiento, 'La provincia de nacimiento', 5)
    titular.localidadNacimiento = opcional(t.localidadNacimiento, 'La localidad de nacimiento', 100)
    const fecha = texto(t.fechaNacimiento, 'La fecha de nacimiento', 1, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(new Date(`${fecha}T00:00:00`).getTime())) {
      throw new ErrorDeNegocio('La fecha de nacimiento no es válida.')
    }
    titular.fechaNacimiento = fecha
  } else {
    titular.representante = personaDeAtm(t.representante, 'el representante legal')
  }

  const v = objeto(d.vehiculo, 'Los datos del vehículo')
  const vehiculo = {
    patente: texto(v.patente, 'La patente', 1, 10),
    chasis: texto(v.chasis, 'El número de chasis', 1, 20),
    motor: texto(v.motor, 'El número de motor', 1, 20),
  }

  const f = objeto(d.formaDePago, 'La forma de pago')
  const formaDePago: DatosDeEmisionAtm['formaDePago'] = { forma: texto(f.forma, 'La forma de pago', 1, 5) }
  if (f.cbu !== undefined) formaDePago.cbu = numerico(f.cbu, 'El CBU', 22, 22)
  if (f.tarjeta !== undefined) {
    const tarjeta = objeto(f.tarjeta, 'Los datos de la tarjeta')
    const vencimiento = numerico(tarjeta.vencimiento, 'El vencimiento de la tarjeta (MMAAAA)', 6, 6)
    const mes = Number(vencimiento.slice(0, 2))
    if (mes < 1 || mes > 12) throw new ErrorDeNegocio('El vencimiento de la tarjeta va como MMAAAA (por ejemplo 122028).')
    formaDePago.tarjeta = {
      codigo: texto(tarjeta.codigo, 'La tarjeta', 1, 5),
      numero: numerico(tarjeta.numero, 'El número de tarjeta', 13, 19),
      vencimiento,
    }
  }

  return {
    operacion,
    cobertura: texto(d.cobertura, 'La cobertura elegida', 1, 10),
    condicionDePago: texto(d.condicionDePago, 'La forma de pago cotizada', 1, 20),
    titular,
    vehiculo,
    formaDePago,
    acreedor: d.acreedor ? personaDeAtm(d.acreedor, 'el acreedor prendario') : undefined,
    responsableInspeccion: opcional(d.responsableInspeccion, 'El responsable de la inspección', 30),
  }
}

/**
 * Emite de verdad contra ATM. No se reintenta nunca: una operación se emite una sola vez, y si ATM no
 * contestó a tiempo puede haberla emitido igual.
 */
export async function emitirAtm(datos: unknown): Promise<EmisionAtm> {
  const validados = validarDatosDeEmisionAtm(datos)
  // Demo: se valida todo igual que de verdad y la operación queda «emitida» con un número inventado.
  if (esDemo()) return emisionDeAtmDemo(validados)
  const credenciales = credencialesAtm()
  if (!credenciales) throw new ErrorDeNegocio('Falta cargar la cuenta de ATM en API Aseguradoras → ATM.')
  try {
    return await emitirPropuestaAtm(crearClienteAtm(cuentaDe(credenciales)), validados)
  } catch (error) {
    if (error instanceof ErrorDeAtm && error.esDeRed) {
      throw new ErrorDeNegocio(
        `${error.message} Antes de volver a mandar, fijate en la web de ATM si la operación ${validados.operacion} no quedó emitida.`,
      )
    }
    throw comoErrorDeNegocio(error, 'No se pudo emitir con ATM')
  }
}
