// Servicio de Emisión: "Emitir Póliza Auto/Moto" con y sin inspección vehicular (manual, páginas 39 y
// 49). Es el endpoint más grande del manual — arma un body de más de cien campos a partir de
// `DatosDeEmisionGaleno` (shared/tipos.ts), que ya sigue de cerca la forma del propio manual para que
// este archivo sea sobre todo transcripción y no traducción.
//
// Las fechas de persona (`fechaNacimiento`, `vencimientoPrestamo`, etc.) el manual las pide en
// aaaa-mm-dd, que es justo lo que da un `<input type="date">`: no hace falta convertir nada acá, a
// diferencia de la Cotización, que sí pide dd/mm/aaaa para `vigenciaDesde`.
import type {
  AcreedorPrendarioGaleno,
  DatosDeEmisionGaleno,
  EmisionGaleno,
  ErrorDeEmisionGaleno,
  ExcepcionGaleno,
  PersonaGaleno,
} from '../../../shared/tipos'
import { ErrorDeGaleno, type ClienteGaleno } from './cliente'

function siONo(valor: boolean | undefined): string {
  return valor ? 'S' : ''
}

function personaBody(p: PersonaGaleno): Record<string, unknown> {
  return {
    tipoDocumentoCodigo: p.tipoDocumentoCodigo,
    documentoNumero: p.documentoNumero,
    nacionalidadCodigo: p.nacionalidadCodigo,
    nombre: p.nombre,
    tipoPersona: p.tipoPersona,
    categoriaIVACodigo: p.categoriaIVACodigo,
    calleNombre: p.calleNombre,
    calleNumero: p.calleNumero,
    callePiso: p.callePiso,
    calleDepto: p.calleDepto,
    codigoPostal: p.codigoPostal,
    subCodigoPostal: p.subCodigoPostal,
    telefono: p.telefono,
    email: p.email,
    fechaNacimiento: p.fechaNacimiento,
    sexo: p.sexo,
    estadoCivilCodigo: p.estadoCivilCodigo,
    lugarNacimiento: p.lugarNacimiento,
  }
}

function tomadorBody(datos: DatosDeEmisionGaleno['tomador']): Record<string, unknown> {
  return {
    ...personaBody(datos),
    conyugeNombre: datos.conyugeNombre,
    conyugeTipoDocumentoCodigo: datos.conyugeTipoDocumentoCodigo,
    conyugeDocumentoNumero: datos.conyugeDocumentoNumero,
    relacionEmpleado: datos.relacionEmpleado,
    empleadoLegajo: datos.empleadoLegajo,
    pep: datos.pep,
    cargo: datos.cargo,
    organismo: datos.organismo,
    relacion: datos.relacion,
    declaraTitular: datos.declaraTitular,
    declaranteNombre: datos.declaranteNombre,
    declaranteTipoDocumentoCodigo: datos.declaranteTipoDocumentoCodigo,
    declaranteDocumentoNumero: datos.declaranteDocumentoNumero,
    declaranteCaracter: datos.declaranteCaracter,
    declaranteDenominacion: datos.declaranteDenominacion,
    declaranteCUIT: datos.declaranteCUIT,
    declaranteObservaciones: datos.declaranteObservaciones,
    sujetoObligadoActividadCodigo: datos.sujetoObligadoActividadCodigo,
    sujetoObligadoActividadDetalle: datos.sujetoObligadoActividadDetalle,
    sujetoObligadoRazonSocial: datos.sujetoObligadoRazonSocial,
    documentacionPresentadaListaMiembros: datos.documentacionPresentadaListaMiembros,
    documentacionPresentadaDDJJ: datos.documentacionPresentadaDDJJ,
    documentacionPresentadaRespaldatoria: datos.documentacionPresentadaRespaldatoria,
    documentacionPresentadaReferencias: datos.documentacionPresentadaReferencias,
    conClausulaSubrogacion: datos.conClausulaSubrogacion,
    clausulaSubrogacionId: datos.clausulaSubrogacionId,
    subrogacionEmpresaBeneficiaria1: datos.subrogacionEmpresaBeneficiaria1,
    subrogacionEmpresaBeneficiaria2: datos.subrogacionEmpresaBeneficiaria2,
    subrogacionEmpresaBeneficiaria3: datos.subrogacionEmpresaBeneficiaria3,
    subrogacionEmpresaBeneficiaria4: datos.subrogacionEmpresaBeneficiaria4,
    subrogacionEmpresaBeneficiaria5: datos.subrogacionEmpresaBeneficiaria5,
    representanteLegal: datos.representanteLegal ? personaBody(datos.representanteLegal) : undefined,
  }
}

function aseguradoBody(datos: NonNullable<DatosDeEmisionGaleno['asegurado']>): Record<string, unknown> {
  return {
    ...personaBody(datos),
    relacionEmpleado: datos.relacionEmpleado,
    empleadoLegajo: datos.empleadoLegajo,
    pep: datos.pep,
    cargo: datos.cargo,
    organismo: datos.organismo,
    relacion: datos.relacion,
    declaraTitular: datos.declaraTitular,
    declaranteNombre: datos.declaranteNombre,
    declaranteTipoDocumentoCodigo: datos.declaranteTipoDocumentoCodigo,
    declaranteDocumentoNumero: datos.declaranteDocumentoNumero,
    declaranteCaracter: datos.declaranteCaracter,
    declaranteDenominacion: datos.declaranteDenominacion,
    declaranteCUIT: datos.declaranteCUIT,
    declaranteObservaciones: datos.declaranteObservaciones,
    representanteLegal: datos.representanteLegal ? personaBody(datos.representanteLegal) : undefined,
  }
}

function acreedorPrendarioBody(datos: AcreedorPrendarioGaleno): Record<string, unknown> {
  return { ...personaBody(datos), vencimientoPrestamo: datos.vencimientoPrestamo, numeroPrestamo: datos.numeroPrestamo }
}

function armarBody(datos: DatosDeEmisionGaleno, codServicioInspeccion: string | undefined): Record<string, unknown> {
  const vehiculo: Record<string, unknown> = {
    patente: datos.vehiculo.patente,
    motor: datos.vehiculo.motor,
    chasis: datos.vehiculo.chasis,
    equipoGNCCodigo: datos.vehiculo.equipoGNCCodigo,
    equipoGNCIdentificacion: datos.vehiculo.equipoGNCIdentificacion,
    rastreoIdentificacion: datos.vehiculo.rastreoIdentificacion,
    rastreoDatosContacto1: datos.vehiculo.rastreoDatosContacto1,
    rastreoDatosContacto2: datos.vehiculo.rastreoDatosContacto2,
    ruta: datos.vehiculo.ruta,
    poseeAcreedorPrendario: datos.vehiculo.poseeAcreedorPrendario,
    acreedorPrendario: datos.vehiculo.acreedorPrendario ? acreedorPrendarioBody(datos.vehiculo.acreedorPrendario) : undefined,
  }

  return {
    rama: datos.rama,
    solicitud: datos.solicitud,
    instalacion: datos.instalacion,
    cobertura: datos.cobertura,
    tomador: tomadorBody(datos.tomador),
    aseguradoEsTomador: siONo(datos.aseguradoEsTomador),
    asegurado: !datos.aseguradoEsTomador && datos.asegurado ? aseguradoBody(datos.asegurado) : undefined,
    aseguradoRUTA: datos.aseguradoRUTA,
    formaPagoTarjetaCodigo: datos.formaPago.formaPagoTarjetaCodigo,
    formaPagoTarjetaNumero: datos.formaPago.formaPagoTarjetaNumero,
    formaPagoTarjetaBancoCodigo: datos.formaPago.formaPagoTarjetaBancoCodigo,
    formaPagoTarjetaVencimiento: datos.formaPago.formaPagoTarjetaVencimiento,
    formaPagoDebitoCBU: datos.formaPago.formaPagoDebitoCBU,
    formaPagoDebitoBancoCodigo: datos.formaPago.formaPagoDebitoBancoCodigo,
    formaPagoOBBancoCodigo: datos.formaPago.formaPagoOBBancoCodigo,
    formaPagoOBSucursalCodigo: datos.formaPago.formaPagoOBSucursalCodigo,
    formaPagoOBOperatoriaId: datos.formaPago.formaPagoOBOperatoriaId,
    formaPagoOBNumeroCuenta: datos.formaPago.formaPagoOBNumeroCuenta,
    formaPagoOBTipoCuenta: datos.formaPago.formaPagoOBTipoCuenta,
    formaPagoOBTipoDocumentoCodigo: datos.formaPago.formaPagoOBTipoDocumentoCodigo,
    formaPagoOBNumeroDocumento: datos.formaPago.formaPagoOBNumeroDocumento,
    formaPagoOBNumeroContrato: datos.formaPago.formaPagoOBNumeroContrato,
    formaPagoOBVencimientoContrato: datos.formaPago.formaPagoOBVencimientoContrato,
    // Distinto de los `formaPagoXxx` de arriba (que son los DATOS del medio de pago): esto cambia
    // cuál es el medio de pago elegido, si hace falta pisar el que se usó para cotizar.
    formaPago: datos.formaPagoCodigo,
    paseCartera: siONo(datos.paseCartera),
    paseCarteraVencimiento: datos.paseCarteraVencimiento,
    paseCarteraPlanComercialCodigo: datos.paseCarteraPlanComercialCodigo,
    polizaElectronicaAceptar: siONo(datos.polizaElectronicaAceptar),
    polizaElectronicaEmail: datos.polizaElectronicaEmail,
    vehiculo,
    origen: datos.origen,
    referenciaInterna: datos.referenciaInterna,
    referenciaVendedor: datos.referenciaVendedor,
    observacionesVendedor: datos.observacionesVendedor,
    nuevaVigenciaDesde: datos.nuevaVigenciaDesde,
    ...(codServicioInspeccion ? { codServicioInspeccion } : {}),
  }
}

function comoExcepciones(cruda: unknown): ExcepcionGaleno[] {
  if (!Array.isArray(cruda)) return []
  return cruda
    .map((e): ExcepcionGaleno | null => {
      if (!e || typeof e !== 'object') return null
      const x = e as Record<string, unknown>
      if (typeof x.estado !== 'string') return null
      return {
        item: typeof x.item === 'number' ? x.item : 0,
        tipo: typeof x.tipo === 'string' ? x.tipo : '',
        motivo: typeof x.motivo === 'number' ? x.motivo : 0,
        observaciones: typeof x.observaciones === 'string' ? x.observaciones : undefined,
        estado: x.estado,
      }
    })
    .filter((e): e is ExcepcionGaleno => e !== null)
}

function comoErrores(cruda: unknown): ErrorDeEmisionGaleno[] {
  if (!Array.isArray(cruda)) return []
  return cruda
    .map((e): ErrorDeEmisionGaleno | null => {
      if (!e || typeof e !== 'object') return null
      const x = e as Record<string, unknown>
      if (typeof x.descripcion !== 'string') return null
      return { codigo: typeof x.codigo === 'number' ? x.codigo : 0, descripcion: x.descripcion, nivel: typeof x.nivel === 'string' ? x.nivel : '' }
    })
    .filter((e): e is ErrorDeEmisionGaleno => e !== null)
}

function comoEmision(cruda: Record<string, unknown>): EmisionGaleno {
  if (typeof cruda.message === 'string' && cruda.estadoSolicitud === undefined) {
    throw new ErrorDeGaleno(cruda.message, false)
  }
  return {
    idServicioEmision: typeof cruda.idServicioEmision === 'number' ? cruda.idServicioEmision : 0,
    rama: typeof cruda.rama === 'number' ? cruda.rama : 0,
    poliza: typeof cruda.poliza === 'number' ? cruda.poliza : 0,
    endoso: typeof cruda.endoso === 'number' ? cruda.endoso : 0,
    estadoSolicitud: typeof cruda.estadoSolicitud === 'string' ? cruda.estadoSolicitud : '',
    impuestos: typeof cruda.impuestos === 'number' ? cruda.impuestos : 0,
    premio: typeof cruda.premio === 'number' ? cruda.premio : 0,
    excepciones: comoExcepciones(cruda.excepciones),
    errores: comoErrores(cruda.errores),
    urlInspeccion: typeof cruda.urlInspeccion === 'string' ? cruda.urlInspeccion : null,
    observacionesInspeccion: typeof cruda.observacionesInspeccion === 'string' ? cruda.observacionesInspeccion : null,
  }
}

export async function emitir(cliente: ClienteGaleno, datos: DatosDeEmisionGaleno): Promise<EmisionGaleno> {
  const cruda = await cliente.pedirJson<Record<string, unknown>>('/api/emisores/auto/emitir', { metodo: 'POST', body: armarBody(datos, undefined) })
  return comoEmision(cruda)
}

export async function emitirConInspeccion(cliente: ClienteGaleno, datos: DatosDeEmisionGaleno): Promise<EmisionGaleno> {
  if (!datos.codServicioInspeccion) {
    throw new ErrorDeGaleno('Falta elegir el tipo de inspección (Photobook, Coordinar Inspección, etc.).', false)
  }
  const cruda = await cliente.pedirJson<Record<string, unknown>>('/api/emisores/auto/emitirConInspeccion', {
    metodo: 'POST',
    body: armarBody(datos, datos.codServicioInspeccion),
  })
  return comoEmision(cruda)
}
