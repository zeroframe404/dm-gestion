// El multicotizador del lado del proceso principal: valida lo que llega por IPC y cotiza UNA compañía
// por pedido. La pantalla dispara una por compañía al mismo tiempo, así cada tarjeta se llena apenas
// contesta su compañía en vez de esperar a la más lenta, y una compañía caída no frena a las demás.
//
// Los permisos los controla ipc.ts; acá sólo se decide qué números viajan (la comisión, no para todos).
import {
  CLAUSULAS_DE_AJUSTE,
  COMISIONES,
  CONDICIONES_IIBB,
  CONDICIONES_IVA,
  FACTURACIONES,
  MAXIMO_DE_CUOTAS,
  MEDIOS_DE_PAGO,
  PLANES_DE_COTIZACION,
  RASTREADORES,
  SEXOS,
  TARIFAS,
  TIPOS_DE_PERSONA,
  USOS_DEL_VEHICULO,
  esAccesorio,
  gncDe,
  normalizarTexto,
  type AccesorioACotizar,
  type AseguradoraDelMulticotizador,
  type ClausulaDeAjuste,
  type Comision,
  type CondicionIibb,
  type CondicionIva,
  type CuotasDeseadas,
  type Facturacion,
  type MedioDePago,
  type PlanDeCotizacion,
  type Rastreador,
  type ResultadoDeAseguradora,
  type Sexo,
  type SolicitudDeCotizacion,
  type Tarifa,
  type TipoDePersona,
  type UsoDelVehiculo,
} from '../../shared/multicotizador'
import { TIPOS_DE_VEHICULO, type TipoDeVehiculo } from '../../shared/tipos'
import type { SolicitudResuelta } from '../multicotizador/aseguradora'
import { codigoPostalDeCuatro } from '../multicotizador/equivalencias'
import { aseguradorasRegistradas } from '../multicotizador/registro'
import { ErrorDeNegocio } from './errores'
import { sinComisiones } from './galeno'
import { booleano, objeto, texto } from './validacion'

/** Más que esto y la compañía se da por caída: la tarjeta lo dice y la persona puede reintentar. */
const TIEMPO_MAXIMO_MS = 120_000

export function aseguradorasDelMulticotizador(): AseguradoraDelMulticotizador[] {
  return aseguradorasRegistradas().map((aseguradora) => ({
    id: aseguradora.id,
    nombre: aseguradora.nombre,
    tipos: [...aseguradora.tipos],
    emite: aseguradora.emite,
    noDisponible: aseguradora.noDisponible(),
  }))
}

// --- Validación ---------------------------------------------------------------------------------------

function unoDe<T extends string>(valor: unknown, lista: readonly T[], campo: string): T {
  if (typeof valor === 'string' && (lista as readonly string[]).includes(valor)) return valor as T
  throw new ErrorDeNegocio(`${campo} no es válido.`)
}

function textoOpcional(valor: unknown, maximo: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, maximo) : ''
}

function montoOpcional(valor: unknown, campo: string): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) throw new ErrorDeNegocio(`${campo} no es válido.`)
  return Math.round(valor)
}

function fechaOpcional(valor: unknown, campo: string): string {
  if (valor === null || valor === undefined || valor === '') return ''
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(new Date(`${valor}T00:00:00`).getTime())) {
    throw new ErrorDeNegocio(`${campo} no es válida.`)
  }
  return valor
}

/** Hasta cuántos accesorios se declaran: más que esto ya no es un vehículo, es un error de la pantalla. */
const MAXIMO_DE_ACCESORIOS = 40

function validarAccesorios(valor: unknown): AccesorioACotizar[] {
  if (valor === null || valor === undefined) return []
  if (!Array.isArray(valor) || valor.length > MAXIMO_DE_ACCESORIOS) throw new ErrorDeNegocio('Los accesorios no son válidos.')
  return valor.map((bruto) => {
    const a = objeto(bruto, 'Un accesorio')
    if (!esAccesorio(a.nombre)) throw new ErrorDeNegocio('Uno de los accesorios no está en la lista.')
    const monto = montoOpcional(a.valor, `El valor de «${a.nombre}»`)
    if (monto === null) throw new ErrorDeNegocio(`Falta el valor de «${a.nombre}».`)
    return { nombre: a.nombre, valor: monto }
  })
}

function validarCuotas(valor: unknown): CuotasDeseadas {
  if (valor === null || valor === undefined || valor === '') return null
  if (valor === 'MAXIMA') return 'MAXIMA'
  if (typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= MAXIMO_DE_CUOTAS) return valor
  throw new ErrorDeNegocio('Las cuotas no son válidas.')
}

export function validarSolicitud(valor: unknown): SolicitudDeCotizacion {
  const d = objeto(valor, 'Los datos para cotizar')
  const v = objeto(d.vehiculo, 'Los datos del vehículo')
  const t = objeto(d.tomador, 'Los datos del tomador')
  const c = objeto(d.condiciones, 'Las condiciones de la cotización')

  const tipo = unoDe<TipoDeVehiculo>(v.tipo, TIPOS_DE_VEHICULO, 'El tipo de vehículo')
  const anio = texto(v.anio, 'El año del vehículo', 4, 4)
  const anioNumero = Number(anio)
  const tope = new Date().getFullYear() + 1
  if (!/^\d{4}$/.test(anio) || anioNumero < 1950 || anioNumero > tope) throw new ErrorDeNegocio('El año del vehículo no es válido.')

  const codigoPostal = codigoPostalDeCuatro(texto(d.codigoPostal, 'El código postal', 1, 12))
  if (!/^\d{4}$/.test(codigoPostal)) throw new ErrorDeNegocio('El código postal tiene que tener cuatro números (por ejemplo, 1870).')

  const vigenciaDesde = texto(d.vigenciaDesde, 'La vigencia desde', 10, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigenciaDesde) || Number.isNaN(new Date(`${vigenciaDesde}T00:00:00`).getTime())) {
    throw new ErrorDeNegocio('La fecha de vigencia no es válida.')
  }

  const s = objeto(v.scoring ?? {}, 'El scoring del vehículo')
  const accesorios = validarAccesorios(v.accesorios)
  const facturacion = unoDe<Facturacion>(c.facturacion, FACTURACIONES, 'La facturación deseada')
  const cuotas = validarCuotas(c.cuotas)
  // Con «Mejor costo» la única opción es la cantidad máxima de cuotas: es lo que hace que el costo sea el mejor.
  if (facturacion === 'MEJOR_COSTO' && cuotas !== 'MAXIMA') throw new ErrorDeNegocio('Con «Mejor costo» las cuotas son la cantidad máxima posible.')
  return {
    vehiculo: {
      tipo,
      marca: texto(v.marca, 'La marca', 1, 80),
      modelo: texto(v.modelo, 'El modelo', 1, 120),
      version: textoOpcional(v.version, 160),
      anio,
      codigoCatalogo: textoOpcional(v.codigoCatalogo, 80),
      ceroKm: booleano(v.ceroKm, 'Si es 0 km'),
      uso: unoDe<UsoDelVehiculo>(v.uso, USOS_DEL_VEHICULO, 'El uso del vehículo'),
      rastreador: unoDe<Rastreador>(v.rastreador, RASTREADORES, 'El rastreador'),
      scoring: {
        grua: booleano(s.grua ?? false, 'La grúa'),
        alarma: booleano(s.alarma ?? false, 'La alarma'),
        garaje: booleano(s.garaje ?? false, 'El garaje'),
      },
      accesorios,
      // El GNC no se cree lo que diga la pantalla: sale de los accesorios declarados.
      ...gncDe(accesorios),
      sumaAsegurada: montoOpcional(v.sumaAsegurada, 'La suma asegurada'),
    },
    tomador: {
      nombre: textoOpcional(t.nombre, 120),
      apellido: textoOpcional(t.apellido, 120),
      dni: textoOpcional(t.dni, 20),
      cuit: textoOpcional(t.cuit, 20),
      telefono: textoOpcional(t.telefono, 60),
      tipoPersona: unoDe<TipoDePersona>(t.tipoPersona, TIPOS_DE_PERSONA, 'El tipo de persona'),
      condicionIva: unoDe<CondicionIva>(t.condicionIva, CONDICIONES_IVA, 'La condición de IVA'),
      ingresosBrutos: unoDe<CondicionIibb>(t.ingresosBrutos, CONDICIONES_IIBB, 'Ingresos brutos'),
      sexo: t.sexo === null || t.sexo === undefined || t.sexo === '' ? null : unoDe<Sexo>(t.sexo, SEXOS, 'El sexo'),
      fechaNacimiento: fechaOpcional(t.fechaNacimiento, 'La fecha de nacimiento'),
    },
    provincia: textoOpcional(d.provincia, 60),
    codigoPostal,
    localidad: textoOpcional(d.localidad, 120),
    vigenciaDesde,
    medioDePago: unoDe<MedioDePago>(d.medioDePago, MEDIOS_DE_PAGO, 'La forma de pago'),
    condiciones: {
      plan: unoDe<PlanDeCotizacion>(c.plan, PLANES_DE_COTIZACION, 'El plan de cotización'),
      tarifa: unoDe<Tarifa>(c.tarifa, TARIFAS, 'La tarifa'),
      comision: unoDe<Comision>(c.comision, COMISIONES, 'La comisión'),
      facturacion,
      clausulaAjuste: unoDe<ClausulaDeAjuste>(c.clausulaAjuste, CLAUSULAS_DE_AJUSTE, 'La cláusula de ajuste'),
      cuotas,
    },
  }
}

function validarElegidos(valor: unknown): Record<string, string> {
  if (valor === null || valor === undefined) return {}
  const d = objeto(valor, 'Los ajustes de la compañía')
  const elegidos: Record<string, string> = {}
  for (const [campo, elegido] of Object.entries(d)) {
    if (typeof elegido === 'string' && elegido.trim() && campo.length <= 40) elegidos[campo] = elegido.trim().slice(0, 80)
  }
  return elegidos
}

// --- Localidades -------------------------------------------------------------------------------------

/**
 * Las localidades de un código postal, juntando lo que sepa cada compañía. Es sólo una ayuda para
 * escribir el nombre bien: si ninguna contesta, la pantalla deja escribirlo a mano. Si TODAS fallan, el
 * motivo vuelve como error (antes se tragaba y la lista quedaba vacía sin explicación).
 */
export async function localidadesDelMulticotizador(tipo: unknown, codigoPostal: unknown): Promise<string[]> {
  const cual = unoDe<TipoDeVehiculo>(tipo, TIPOS_DE_VEHICULO, 'El tipo de vehículo')
  const cp = codigoPostalDeCuatro(typeof codigoPostal === 'string' ? codigoPostal : '')
  if (!/^\d{4}$/.test(cp)) return []
  const conLocalidades = aseguradorasRegistradas().filter((aseguradora) => aseguradora.localidades && aseguradora.noDisponible() === null)
  const respuestas = await Promise.allSettled(conLocalidades.map((aseguradora) => aseguradora.localidades!(cual, cp)))
  const fallas = respuestas.flatMap((respuesta, i) =>
    respuesta.status === 'rejected'
      ? [`${conLocalidades[i]!.nombre}: ${respuesta.reason instanceof Error ? respuesta.reason.message : String(respuesta.reason)}`]
      : [],
  )
  if (fallas.length > 0 && fallas.length === respuestas.length) {
    throw new ErrorDeNegocio(`No se pudieron traer las localidades del ${cp}. ${fallas.join(' · ')}`)
  }
  const vistas = new Map<string, string>()
  for (const respuesta of respuestas) {
    if (respuesta.status !== 'fulfilled') continue
    for (const nombre of respuesta.value) {
      const clave = normalizarTexto(nombre)
      if (clave && !vistas.has(clave)) vistas.set(clave, nombre.trim())
    }
  }
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, 'es'))
}

// --- Cotizar -----------------------------------------------------------------------------------------

function conTiempoMaximo<T>(promesa: Promise<T>, nombre: string): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined
  const vencida = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new ErrorDeNegocio(`${nombre} no contestó en ${TIEMPO_MAXIMO_MS / 1000} segundos. Probá de nuevo en un rato.`)), TIEMPO_MAXIMO_MS)
  })
  return Promise.race([promesa, vencida]).finally(() => clearTimeout(reloj))
}

/**
 * Cotiza en una compañía. Nunca tira por culpa de la compañía: cualquier falla de su lado vuelve como
 * un resultado con estado ERROR, así la pantalla la muestra en su tarjeta y sigue con las demás. Lo
 * único que sí tira es una solicitud mal armada, que es un error de la pantalla y no de la compañía.
 */
export async function cotizarEnAseguradora(pedido: unknown, veNumerosDeLaAgencia: boolean): Promise<ResultadoDeAseguradora> {
  const p = objeto(pedido, 'El pedido de cotización')
  const solicitud = validarSolicitud(p.solicitud)
  const elegidos = validarElegidos(p.elegidos)
  const aseguradora = aseguradorasRegistradas().find((candidata) => candidata.id === p.aseguradora)
  if (!aseguradora) throw new ErrorDeNegocio('Esa compañía no está en el multicotizador.')

  const base = { aseguradora: aseguradora.id, nombre: aseguradora.nombre, descripcionVehiculo: '', coberturas: [], avisos: [], ajustes: [] }
  const inicio = Date.now()

  if (!aseguradora.tipos.includes(solicitud.vehiculo.tipo)) {
    return { ...base, estado: 'NO_APLICA', mensaje: `${aseguradora.nombre} no cotiza ${solicitud.vehiculo.tipo === 'MOTO' ? 'motos' : 'autos'} por su API.`, duracionMs: 0 }
  }
  const motivo = aseguradora.noDisponible()
  if (motivo) return { ...base, estado: 'NO_APLICA', mensaje: motivo, duracionMs: 0 }

  const resuelta: SolicitudResuelta = {
    ...solicitud,
    // El catálogo ya no es el de InfoAuto (es el maestro de la DNRPA): no hay CODIA que mandar. La
    // traducción del código MTM al de cada compañía la hace la tabla de equivalencias.
    codigoInfoAuto: null,
  }

  try {
    const cotizacion = await conTiempoMaximo(aseguradora.cotizar(resuelta, elegidos), aseguradora.nombre)
    const coberturas = veNumerosDeLaAgencia
      ? cotizacion.coberturas
      : // La comisión es un número de la agencia (ver `veLosNumerosDeLaAgencia`): no viaja a quien no
        // la ve, ni suelta ni adentro de lo que se guarda para emitir.
        cotizacion.coberturas.map((cobertura) => ({
          ...cobertura,
          comision: null,
          emision:
            cobertura.emision?.tipo === 'GALENO'
              ? { ...cobertura.emision, cobertura: { ...cobertura.emision.cobertura, comision: 0 } }
              : cobertura.emision,
        }))
    const detalleTecnico = cotizacion.detalleTecnico === undefined || veNumerosDeLaAgencia ? cotizacion.detalleTecnico : sinComisiones(cotizacion.detalleTecnico)
    return { aseguradora: aseguradora.id, nombre: aseguradora.nombre, ...cotizacion, coberturas, detalleTecnico, duracionMs: Date.now() - inicio }
  } catch (error) {
    return {
      ...base,
      estado: 'ERROR',
      mensaje: error instanceof Error ? error.message : String(error),
      duracionMs: Date.now() - inicio,
    }
  }
}
