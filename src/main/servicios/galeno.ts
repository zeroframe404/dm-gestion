// Servicio de Galeno Seguros: valida lo que llega por IPC, arma (o reusa) el cliente autenticado con
// las credenciales guardadas en config.json, llama a `main/aseguradoras/galeno/*` y traduce cualquier
// `ErrorDeGaleno` a `ErrorDeNegocio`. Es el único punto por el que un error de Galeno le llega al
// renderer con su mensaje real: `ipc.ts` sólo intercepta `ErrorDeNegocio`, así que sin esta traducción
// cualquier falla de Galeno se vería en pantalla como el mensaje genérico de error inesperado.
//
// Los permisos (`exigirVista`/`exigirEdicion`) los controla `ipc.ts`, como en el resto de la app: acá
// no se repiten.
import {
  RAMA_GALENO_DE_TIPO,
  type CodigoPostalGaleno,
  type CotizacionGaleno,
  type DatosDeCotizacionGaleno,
  type DatosDeEmisionGaleno,
  type EmisionGaleno,
  type EstadoDeGaleno,
  type FiltrosDeReporteGaleno,
  type ImpresionGaleno,
  type OpcionGaleno,
  type PedidoDeImpresionGaleno,
  type PruebaDeGaleno,
  type ReporteDeGaleno,
  type ReporteGaleno,
  type SubModeloGaleno,
  type TipoDeVehiculo,
} from '../../shared/tipos'
import * as art from '../aseguradoras/galeno/art'
import * as catalogos from '../aseguradoras/galeno/catalogos'
import { crearClienteGaleno, ErrorDeGaleno, type ClienteGaleno } from '../aseguradoras/galeno/cliente'
import * as consultas from '../aseguradoras/galeno/consultas'
import { cotizar as cotizarEnGaleno } from '../aseguradoras/galeno/cotizacion'
import * as cuentaCorriente from '../aseguradoras/galeno/cuentaCorriente'
import { emitir as emitirEnGaleno, emitirConInspeccion as emitirConInspeccionEnGaleno } from '../aseguradoras/galeno/emision'
import * as impresion from '../aseguradoras/galeno/impresion'
import {
  borrarCredencialesGaleno,
  credencialesGaleno,
  estadoGaleno as estadoGuardado,
  guardarCredencialesGaleno,
  guardarProductorCodigoGaleno,
} from './config'
import { ErrorDeNegocio } from './errores'
import { objeto, texto } from './validacion'

// --- El cliente en memoria -----------------------------------------------

/**
 * El cliente autenticado vive sólo en memoria mientras el programa está abierto: es una sesión (el
 * token dura una hora), no un dato que haga falta persistir. Se descarta al guardar o borrar
 * credenciales, para no seguir usando una sesión de un usuario que ya no es el cargado.
 */
let clienteEnMemoria: ClienteGaleno | null = null
let usuarioDelCliente = ''

function cliente(): ClienteGaleno {
  const credenciales = credencialesGaleno()
  if (!credenciales) {
    throw new ErrorDeNegocio('Todavía no están cargadas las credenciales de Galeno. Se cargan en API Aseguradoras → Galeno.')
  }
  if (!clienteEnMemoria || usuarioDelCliente !== credenciales.usuario) {
    clienteEnMemoria = crearClienteGaleno(credenciales)
    usuarioDelCliente = credenciales.usuario
  }
  return clienteEnMemoria
}

async function conCliente<T>(accion: (cli: ClienteGaleno) => Promise<T>): Promise<T> {
  try {
    return await accion(cliente())
  } catch (error) {
    if (error instanceof ErrorDeGaleno) throw new ErrorDeNegocio(error.message)
    throw error
  }
}

/**
 * El legajo del productor conectado. Casi todos los servicios de Consultas y de Cuenta Corriente lo
 * piden como parámetro obligatorio; se resuelve una sola vez —desde el web Service de Planes
 * Comerciales, que ya lo trae— y se guarda en config.json para no volver a pedirlo en cada consulta.
 */
async function legajoDelProductor(cli: ClienteGaleno): Promise<string> {
  const guardado = estadoGuardado().productorCodigo
  if (guardado) return guardado
  const planes = await catalogos.planesComerciales(cli, 4)
  const productorCodigo = planes[0]?.productorCodigo
  if (!productorCodigo) {
    throw new ErrorDeGaleno('Galeno no devolvió ningún plan comercial para este usuario: no se pudo identificar el legajo del productor.', false)
  }
  guardarProductorCodigoGaleno(productorCodigo)
  return productorCodigo
}

// --- Conexión y credenciales -----------------------------------------------

export function estadoGaleno(): EstadoDeGaleno {
  return estadoGuardado()
}

export function guardarGaleno(datos: unknown): EstadoDeGaleno {
  // Credenciales nuevas: se descarta la sesión en memoria, que era de las viejas.
  clienteEnMemoria = null
  return guardarCredencialesGaleno(datos)
}

export function borrarGaleno(): EstadoDeGaleno {
  clienteEnMemoria = null
  return borrarCredencialesGaleno()
}

export async function probarGaleno(): Promise<PruebaDeGaleno> {
  const credenciales = credencialesGaleno()
  if (!credenciales) return { ok: false, detalle: 'Faltan el usuario y la clave de Galeno en esta computadora.', ramasEncontradas: 0 }
  try {
    const cli = cliente()
    const lista = await catalogos.ramas(cli)
    // Aprovecha la prueba para completar el legajo del productor, si todavía no está: así queda listo
    // para Consultas y Cuenta Corriente sin que la persona tenga que hacer nada más.
    try {
      await legajoDelProductor(cli)
    } catch {
      // No es bloqueante para la prueba de conexión: el legajo se puede resolver más adelante.
    }
    return { ok: true, detalle: `Conectado con Galeno Seguros como «${credenciales.usuario}».`, ramasEncontradas: lista.length }
  } catch (error) {
    const esDeRed = error instanceof ErrorDeGaleno && error.esDeRed
    return {
      ok: false,
      detalle: esDeRed ? 'No hay conexión con Galeno Seguros.' : error instanceof Error ? error.message : String(error),
      ramasEncontradas: 0,
    }
  }
}

// --- Listas de valores (cotización y emisión) --------------------------------

export async function planesComercialesGaleno(tipoVehiculo: TipoDeVehiculo): Promise<OpcionGaleno[]> {
  return conCliente(async (cli) => {
    const planes = await catalogos.planesComerciales(cli, RAMA_GALENO_DE_TIPO[tipoVehiculo])
    return planes.map((p) => ({ codigo: p.codPlanComercial, descripcion: p.descripcionPlanComercial || p.codPlanComercial }))
  })
}

export async function marcasGaleno(tipoVehiculo: TipoDeVehiculo): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.marcas(cli, RAMA_GALENO_DE_TIPO[tipoVehiculo]))
}

export async function modelosGaleno(marcaCodigo: string): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.modelos(cli, texto(marcaCodigo, 'La marca', 1, 20)))
}

export async function aniosGaleno(marcaCodigo: string, modeloCodigo: string): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.anios(cli, texto(marcaCodigo, 'La marca', 1, 20), texto(modeloCodigo, 'El modelo', 1, 20)))
}

export async function subModelosGaleno(marcaCodigo: string, modeloCodigo: string, anio: string): Promise<SubModeloGaleno[]> {
  return conCliente((cli) =>
    catalogos.subModelos(cli, texto(marcaCodigo, 'La marca', 1, 20), texto(modeloCodigo, 'El modelo', 1, 20), texto(anio, 'El año', 4, 4)),
  )
}

export async function tiposDePersonaGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.tiposDePersona(cli))
}

export async function codigoPostalGaleno(tipoVehiculo: TipoDeVehiculo, codigoPostal: string): Promise<CodigoPostalGaleno[]> {
  return conCliente((cli) => catalogos.codigoPostal(cli, RAMA_GALENO_DE_TIPO[tipoVehiculo], texto(codigoPostal, 'El código postal', 1, 10)))
}

export async function modosDeFacturacionGaleno(tipoVehiculo: TipoDeVehiculo, planComercialCodigo: string): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.modosDeFacturacion(cli, RAMA_GALENO_DE_TIPO[tipoVehiculo], texto(planComercialCodigo, 'El plan comercial', 1, 20)))
}

export async function condicionesDePagoGaleno(tipoVehiculo: TipoDeVehiculo, modoFacturacionCodigo: string): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.condicionesDePago(cli, RAMA_GALENO_DE_TIPO[tipoVehiculo], texto(modoFacturacionCodigo, 'El modo de facturación', 1, 20)))
}

export async function formasDePagoGaleno(tipoVehiculo: TipoDeVehiculo, modoFacturacionCodigo: string, planComercialCodigo: string): Promise<OpcionGaleno[]> {
  return conCliente((cli) =>
    catalogos.formasDePago(
      cli,
      RAMA_GALENO_DE_TIPO[tipoVehiculo],
      texto(modoFacturacionCodigo, 'El modo de facturación', 1, 20),
      texto(planComercialCodigo, 'El plan comercial', 1, 20),
    ),
  )
}

export async function equipoGncGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.equipoGnc(cli))
}

export async function equiposDeRastreoGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.equiposDeRastreo(cli))
}

export async function clausulasDeAjusteGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.clausulasDeAjuste(cli))
}

export async function accesoriosGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.accesorios(cli))
}

export async function categoriasIvaGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.categoriasIva(cli))
}

export async function codigosIIBBGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.codigosIIBB(cli))
}

export async function tiposDeUsoGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.tiposDeUso(cli))
}

export async function tiposDeDocumentoGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.tiposDeDocumento(cli))
}

export async function nacionalidadesGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.nacionalidades(cli))
}

export async function sexosGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.sexos(cli))
}

export async function estadosCivilesGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.estadosCiviles(cli))
}

export async function bancosGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.bancos(cli))
}

export async function tarjetasDeCreditoGaleno(): Promise<OpcionGaleno[]> {
  return conCliente((cli) => catalogos.tarjetasDeCredito(cli))
}

// --- Cotización -----------------------------------------------------------

function validarDatosDeCotizacion(datos: unknown): DatosDeCotizacionGaleno {
  const d = objeto(datos, 'Los datos de la cotización')
  const tipoVehiculo = d.tipoVehiculo === 'MOTO' ? 'MOTO' : 'AUTO'
  return {
    tipoVehiculo,
    planComercialCodigo: texto(d.planComercialCodigo, 'El plan comercial', 1, 20),
    ceroKm: d.ceroKm === true,
    idInfoAuto: typeof d.idInfoAuto === 'string' && d.idInfoAuto.trim() ? d.idInfoAuto.trim() : null,
    marcaCodigo: typeof d.marcaCodigo === 'string' ? d.marcaCodigo : undefined,
    modeloCodigo: typeof d.modeloCodigo === 'string' ? d.modeloCodigo : undefined,
    subModeloCodigo: typeof d.subModeloCodigo === 'string' ? d.subModeloCodigo : undefined,
    anioFabricacion: texto(d.anioFabricacion, 'El año de fabricación', 4, 4),
    tomadorTipoPersona: texto(d.tomadorTipoPersona, 'El tipo de persona del tomador', 1, 5),
    tomadorNombre: texto(d.tomadorNombre, 'El nombre del tomador', 1, 120),
    codigoPostal: texto(d.codigoPostal, 'El código postal', 1, 10),
    subCodigoPostal: texto(d.subCodigoPostal, 'La localidad (sub-código postal)', 1, 5),
    condicionPagoCodigo: texto(d.condicionPagoCodigo, 'La condición de pago', 1, 10),
    vigenciaDesde: texto(d.vigenciaDesde, 'La vigencia desde', 10, 10),
    modoFacturacionCodigo: texto(d.modoFacturacionCodigo, 'El modo de facturación', 1, 10),
    formaPagoCodigo: texto(d.formaPagoCodigo, 'La forma de pago', 1, 10),
    sumaAsegurada: typeof d.sumaAsegurada === 'number' ? d.sumaAsegurada : undefined,
    tipoUso: typeof d.tipoUso === 'string' ? d.tipoUso : undefined,
    poseeEquipoGnc: d.poseeEquipoGnc === true,
    equipoGncValor: typeof d.equipoGncValor === 'number' ? d.equipoGncValor : undefined,
    poseeEquipoRastreo: d.poseeEquipoRastreo === true,
    equipoRastreoCodigo: typeof d.equipoRastreoCodigo === 'string' ? d.equipoRastreoCodigo : undefined,
    clausulaAjusteCodigo: typeof d.clausulaAjusteCodigo === 'string' ? d.clausulaAjusteCodigo : undefined,
    tomadorCategoriaIVACodigo: typeof d.tomadorCategoriaIVACodigo === 'string' ? d.tomadorCategoriaIVACodigo : undefined,
    tomadorIIBBCodigo: typeof d.tomadorIIBBCodigo === 'string' ? d.tomadorIIBBCodigo : undefined,
  }
}

export async function cotizarGaleno(datos: unknown): Promise<CotizacionGaleno> {
  const validados = validarDatosDeCotizacion(datos)
  return conCliente(async (cli) => {
    const productorCodigo = await legajoDelProductor(cli)
    return cotizarEnGaleno(cli, productorCodigo, validados)
  })
}

// --- Emisión -----------------------------------------------------------
//
// El body de Emisión tiene más de cien campos opcionales (ver shared/tipos.ts): validarlo campo por
// campo acá duplicaría ese tamaño sin agregar seguridad real, porque el que llama es el propio
// formulario de dm-gestion, ya tipado en TypeScript del lado del renderer. Se valida lo que el manual
// marca como CAMPO OBLIGATORIO —lo mínimo con lo que Galeno puede llegar a rechazar la emisión sin
// dar ninguna pista— y el resto se pasa tal cual llegó.

function exigirPersona(valor: unknown, quien: string): void {
  const p = objeto(valor, quien)
  texto(p.tipoDocumentoCodigo, `El tipo de documento de ${quien}`, 1, 5)
  texto(p.documentoNumero, `El número de documento de ${quien}`, 1, 20)
  texto(p.nombre, `El nombre de ${quien}`, 1, 120)
  texto(p.categoriaIVACodigo, `La categoría de IVA de ${quien}`, 1, 5)
  texto(p.calleNombre, `La calle de ${quien}`, 1, 120)
  texto(p.calleNumero, `El número de calle de ${quien}`, 1, 10)
  texto(p.codigoPostal, `El código postal de ${quien}`, 1, 10)
  texto(p.subCodigoPostal, `La localidad de ${quien}`, 1, 5)
}

function validarDatosDeEmision(datos: unknown): DatosDeEmisionGaleno {
  const d = objeto(datos, 'Los datos de la emisión')
  enteroPositivoOCero(d.rama, 'La rama')
  enteroPositivoOCero(d.solicitud, 'El número de solicitud (volvé a cotizar si se perdió)')
  texto(d.cobertura, 'La cobertura elegida', 1, 10)
  exigirPersona(d.tomador, 'el tomador')
  if (d.aseguradoEsTomador !== true) exigirPersona(d.asegurado, 'el asegurado')
  const vehiculo = objeto(d.vehiculo, 'Los datos del vehículo')
  texto(vehiculo.patente, 'La patente', 1, 10)
  texto(vehiculo.motor, 'El número de motor', 1, 30)
  texto(vehiculo.chasis, 'El número de chasis', 1, 30)
  objeto(d.formaPago, 'La forma de pago')
  // El resto de la forma (más de cien campos opcionales, casi todos de cumplimiento AFIP/PEP y datos
  // secundarios) ya vino armada y tipada por el formulario del renderer: se pasa tal cual.
  return d as unknown as DatosDeEmisionGaleno
}

function enteroPositivoOCero(valor: unknown, campo: string): number {
  const n = Number(valor)
  if (!Number.isInteger(n) || n < 0) throw new ErrorDeNegocio(`${campo} no es válido.`)
  return n
}

export async function emitirGaleno(datos: unknown): Promise<EmisionGaleno> {
  const validados = validarDatosDeEmision(datos)
  return conCliente((cli) => emitirEnGaleno(cli, validados))
}

export async function emitirConInspeccionGaleno(datos: unknown): Promise<EmisionGaleno> {
  const validados = validarDatosDeEmision(datos)
  if (!validados.codServicioInspeccion) throw new ErrorDeNegocio('Falta elegir el tipo de inspección vehicular.')
  return conCliente((cli) => emitirConInspeccionEnGaleno(cli, validados))
}

// --- Consultas, Cuenta Corriente y ART ---------------------------------------

export async function reporteGaleno(tipoDeReporte: ReporteDeGaleno, filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  return conCliente(async (cli) => {
    const nroLegajo = await legajoDelProductor(cli)
    switch (tipoDeReporte) {
      case 'POLIZAS_POR_LEGAJO':
        return consultas.polizasPorLegajo(cli, nroLegajo, filtros)
      case 'RIESGOS_DE_POLIZA':
        return consultas.riesgosDePoliza(cli, nroLegajo, filtros)
      case 'PRODUCCION_DE_AUTOMOTORES':
        return consultas.detalleDeProduccion(cli, nroLegajo, filtros)
      case 'CUOTAS_IMPAGAS':
        return consultas.cuotasImpagas(cli, nroLegajo, filtros)
      case 'CUOTAS_COBRADAS':
        return consultas.cuotasCobradas(cli, nroLegajo, filtros)
      case 'POLIZAS_VIGENTES':
        return consultas.polizasVigentes(cli, nroLegajo, filtros)
      case 'ENDOSOS':
        return consultas.endosos(cli, nroLegajo, filtros)
      case 'CUENTA_CORRIENTE':
        return cuentaCorriente.consultaCuentaCorriente(cli, nroLegajo, filtros)
      case 'CONTRATOS_ART':
        return art.contratosART(cli, nroLegajo, filtros)
      case 'DETALLE_DE_POLIZA':
        throw new ErrorDeGaleno('El detalle de póliza se pide con "detalleDePolizaGaleno": no es un listado.', false)
      default:
        throw new ErrorDeGaleno('Ese reporte de Galeno no existe.', false)
    }
  })
}

export async function detalleDePolizaGaleno(rama: number, poliza?: string, nroRiesgo?: string): Promise<unknown> {
  return conCliente(async (cli) => {
    const nroLegajo = await legajoDelProductor(cli)
    return consultas.detalleDePoliza(cli, nroLegajo, rama, poliza, nroRiesgo)
  })
}

export async function detalleDeLiquidacionesGaleno(filtros: FiltrosDeReporteGaleno): Promise<ReporteGaleno> {
  return conCliente(async (cli) => {
    const nroLegajo = await legajoDelProductor(cli)
    return cuentaCorriente.detalleDeLiquidaciones(cli, nroLegajo, filtros)
  })
}

// --- Impresión -----------------------------------------------------------

export async function imprimirGaleno(pedido: unknown): Promise<ImpresionGaleno> {
  const d = objeto(pedido, 'El pedido de impresión')
  const tipoImpresion = d.tipoImpresion === 'C' || d.tipoImpresion === 'M' ? d.tipoImpresion : 'P'
  const datos: PedidoDeImpresionGaleno = {
    tipoImpresion,
    poliza: texto(d.poliza, 'La póliza', 1, 20),
    rama: enteroPositivoOCero(d.rama, 'La rama'),
    legajo: texto(d.legajo, 'El legajo', 1, 20),
    idRiesgo: typeof d.idRiesgo === 'string' ? d.idRiesgo : undefined,
    nroEndoso: typeof d.nroEndoso === 'number' ? d.nroEndoso : undefined,
  }
  return conCliente((cli) => impresion.imprimir(cli, datos))
}
