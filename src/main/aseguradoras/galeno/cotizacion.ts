// Servicio de Cotización: "Cotizar Auto/Moto" (manual, página 24). Recibe los datos ya validados por
// servicios/galeno.ts y arma el body exacto que espera Galeno — los nombres de campo del body no son
// siempre los mismos que usa `DatosDeCotizacionGaleno` en el lado de la app (p. ej. `tipoPolizaCodigo`
// no lo elige la persona, sale solo de `rama`), así que el mapeo vive todo acá.
import { RAMA_GALENO_DE_TIPO, type CoberturaCotizadaGaleno, type CotizacionGaleno, type DatosDeCotizacionGaleno, type ExcepcionGaleno } from '../../../shared/tipos'
import { ErrorDeGaleno, type ClienteGaleno } from './cliente'

/** Galeno pide las fechas en dd/mm/aaaa; el resto de la app trabaja en aaaa-mm-dd (lo que da <input type="date">). */
function aFechaGaleno(iso: string): string {
  const [anio, mes, dia] = iso.split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

function comoExcepciones(cruda: unknown): ExcepcionGaleno[] {
  if (!Array.isArray(cruda)) return []
  return cruda
    .map((e): ExcepcionGaleno | null => {
      if (!e || typeof e !== 'object') return null
      const x = e as Record<string, unknown>
      if (typeof x.item !== 'number' && typeof x.estado !== 'string') return null
      return {
        item: typeof x.item === 'number' ? x.item : 0,
        tipo: typeof x.tipo === 'string' ? x.tipo : '',
        motivo: typeof x.motivo === 'number' ? x.motivo : 0,
        detalle: typeof x.detalle === 'string' ? x.detalle : undefined,
        observaciones: typeof x.observaciones === 'string' ? x.observaciones : undefined,
        estado: typeof x.estado === 'string' ? x.estado : '',
      }
    })
    .filter((e): e is ExcepcionGaleno => e !== null)
}

function comoErrores(cruda: unknown): string[] | null {
  if (!Array.isArray(cruda)) return null
  return cruda
    .map((e) => (e && typeof e === 'object' && typeof (e as { descripcion?: unknown }).descripcion === 'string' ? (e as { descripcion: string }).descripcion : null))
    .filter((e): e is string => e !== null)
}

export async function cotizar(cliente: ClienteGaleno, productorCodigo: string, datos: DatosDeCotizacionGaleno): Promise<CotizacionGaleno> {
  const rama = RAMA_GALENO_DE_TIPO[datos.tipoVehiculo]
  const body: Record<string, unknown> = {
    rama,
    tipoPolizaCodigo: datos.tipoVehiculo === 'AUTO' ? 'AUT01' : 'MOT01',
    planComercialCodigo: datos.planComercialCodigo,
    ceroKM: datos.ceroKm ? 'S' : '',
    anioFabricacion: datos.anioFabricacion,
    // El ejemplo del manual manda tomadorTipoPersona, productorCodigo y formaPagoCodigo como número
    // (sin comillas) aunque las listas de valores que los originan (Tipos de Persona, Formas de Pago)
    // los devuelven como texto — el mismo desajuste que marca/modelo/sub-modelo. Se convierten acá.
    tomadorTipoPersona: Number(datos.tomadorTipoPersona),
    codigoPostal: datos.codigoPostal,
    subCodigoPostal: datos.subCodigoPostal,
    productorCodigo: Number(productorCodigo),
    condicionPagoCodigo: datos.condicionPagoCodigo,
    vigenciaDesde: aFechaGaleno(datos.vigenciaDesde),
    modoFacturacionCodigo: datos.modoFacturacionCodigo,
    formaPagoCodigo: Number(datos.formaPagoCodigo),
    tomadorNombre: datos.tomadorNombre,
    // Sin bonificación ni recargo administrativo manual: son ajustes que hoy no ofrece la pantalla de
    // cotización de dm-gestion (podría agregarse más adelante sin tocar este archivo).
    modificarBonificacion: 'N',
    modificarRecargoAdministrativo: 'N',
  }

  // El manual permite reemplazar marca/modelo/submodelo por el código único de InfoAuto: si el
  // vehículo ya lo tiene (porque se resolvió del catálogo de InfoAuto que usa dm-gestion), se manda
  // ése y no hace falta mapear contra el catálogo propio de Galeno, que usa otros códigos.
  if (datos.idInfoAuto) {
    body.idInfoAuto = datos.idInfoAuto
  } else {
    if (!datos.marcaCodigo || !datos.modeloCodigo || !datos.subModeloCodigo) {
      throw new ErrorDeGaleno('Para cotizar sin el código de InfoAuto hacen falta la marca, el modelo y el sub-modelo de Galeno.', false)
    }
    // El catálogo de Galeno (marcas, modelos, sub-modelos) devuelve estos códigos como texto, pero el
    // ejemplo del propio manual para cotizar los manda como número ("marcaCodigo": 46, no "46"): se
    // convierten acá, en el único lugar donde hace falta.
    body.marcaCodigo = Number(datos.marcaCodigo)
    body.modeloCodigo = Number(datos.modeloCodigo)
    body.subModeloCodigo = Number(datos.subModeloCodigo)
  }

  if (datos.sumaAsegurada !== undefined) body.sumaAsegurada = datos.sumaAsegurada
  if (datos.tipoUso) body.tipoUso = datos.tipoUso
  if (datos.clausulaAjusteCodigo) body.clausulaAjusteCodigo = datos.clausulaAjusteCodigo
  // El nombre de campo acá es el que trae el propio manual de Galeno (con "tomado" y no "tomador").
  if (datos.tomadorCategoriaIVACodigo) body.tomadoCategoriaIVACodigo = datos.tomadorCategoriaIVACodigo
  if (datos.tomadorIIBBCodigo) body.tomadorIIBBCodigo = datos.tomadorIIBBCodigo

  if (datos.poseeEquipoGnc) {
    body.poseeEquipoGNC = '2'
    // El código de accesorio para el equipo de GNC es fijo (25); lo pide el manual así.
    body.accesorio1Codigo = '25'
    if (datos.equipoGncValor !== undefined) body.accesorio1Valor = datos.equipoGncValor
  }
  if (datos.poseeEquipoRastreo) {
    body.poseeEquipoRastreo = '2'
    if (datos.equipoRastreoCodigo) body.equipoRastreoCodigo = datos.equipoRastreoCodigo
  }

  // Un solo endpoint sirve autos y motos: lo que cambia es el `rama`/`tipoPolizaCodigo` del body.
  const cruda = await cliente.pedirJson<Record<string, unknown>>('/api/cotizadores/auto/cotizar', { metodo: 'POST', body })

  // Algunas respuestas de error de Galeno vienen con HTTP 200 y sólo un `message`/`errorCode` (por
  // ejemplo, "Legajo o Plan comercial inválidos"), en vez del cuerpo normal de la cotización.
  if (typeof cruda.message === 'string' && cruda.coberturas === undefined && cruda.excepciones === undefined) {
    throw new ErrorDeGaleno(cruda.message, false)
  }
  const erroresDeDatos = comoErrores(cruda.errores)
  if (erroresDeDatos && erroresDeDatos.length > 0 && !Array.isArray(cruda.coberturas)) {
    throw new ErrorDeGaleno(erroresDeDatos.join(' '), false)
  }

  const coberturas: CoberturaCotizadaGaleno[] = Array.isArray(cruda.coberturas)
    ? cruda.coberturas
        .map((c): CoberturaCotizadaGaleno | null => {
          if (!c || typeof c !== 'object') return null
          const x = c as Record<string, unknown>
          if (typeof x.cobertura !== 'string') return null
          return {
            item: typeof x.item === 'number' ? x.item : 0,
            cobertura: x.cobertura,
            descripcionCobertura: typeof x.descripcionCobertura === 'string' ? x.descripcionCobertura : x.cobertura,
            prima: typeof x.prima === 'number' ? x.prima : 0,
            bonificacion: typeof x.bonificacion === 'number' ? x.bonificacion : 0,
            recargoAdministrativo: typeof x.recargoAdministrativo === 'number' ? x.recargoAdministrativo : 0,
            recargoFinanciero: typeof x.recargoFinanciero === 'number' ? x.recargoFinanciero : 0,
            derechoEmision: typeof x.derechoEmision === 'number' ? x.derechoEmision : 0,
            impuestos: typeof x.impuestos === 'number' ? x.impuestos : 0,
            premio: typeof x.premio === 'number' ? x.premio : 0,
            importeCuota1: typeof x.importeCuota1 === 'number' ? x.importeCuota1 : 0,
            importeRestoCuotas: typeof x.importeRestoCuotas === 'number' ? x.importeRestoCuotas : 0,
            comision: typeof x.comision === 'number' ? x.comision : 0,
            listaAdicionales: Array.isArray(x.listaAdicionales) ? x.listaAdicionales.filter((a): a is string => typeof a === 'string') : [],
            franquicia: typeof x.franquicia === 'string' ? x.franquicia : '',
          }
        })
        .filter((c): c is CoberturaCotizadaGaleno => c !== null)
    : []

  return {
    rama: typeof cruda.rama === 'number' ? cruda.rama : rama,
    solicitud: typeof cruda.solicitud === 'number' ? cruda.solicitud : 0,
    instalacion: typeof cruda.instalacion === 'number' ? cruda.instalacion : 0,
    descripcionVehiculo: typeof cruda.descripcionVehiculo === 'string' ? cruda.descripcionVehiculo : '',
    coberturas,
    excepciones: comoExcepciones(cruda.excepciones),
    errores: comoErrores(cruda.errores),
  }
}
