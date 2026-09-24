// El multicotizador del lado del proceso principal: valida lo que llega por IPC y cotiza UNA compañía
// por pedido. La pantalla dispara una por compañía al mismo tiempo, así cada tarjeta se llena apenas
// contesta su compañía en vez de esperar a la más lenta, y una compañía caída no frena a las demás.
//
// Los permisos los controla ipc.ts; acá sólo se decide qué números viajan (la comisión, no para todos).
import {
  CONDICIONES_IVA,
  MEDIOS_DE_PAGO,
  TIPOS_DE_PERSONA,
  USOS_DEL_VEHICULO,
  normalizarTexto,
  type AseguradoraDelMulticotizador,
  type CondicionIva,
  type MedioDePago,
  type ResultadoDeAseguradora,
  type SolicitudDeCotizacion,
  type TipoDePersona,
  type UsoDelVehiculo,
} from '../../shared/multicotizador'
import { TIPOS_DE_VEHICULO, type TipoDeVehiculo } from '../../shared/tipos'
import type { SolicitudResuelta } from '../multicotizador/aseguradora'
import { codigoPostalDeCuatro } from '../multicotizador/equivalencias'
import { aseguradorasRegistradas } from '../multicotizador/registro'
import { ErrorDeNegocio } from './errores'
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

export function validarSolicitud(valor: unknown): SolicitudDeCotizacion {
  const d = objeto(valor, 'Los datos para cotizar')
  const v = objeto(d.vehiculo, 'Los datos del vehículo')
  const t = objeto(d.tomador, 'Los datos del tomador')

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

  const gnc = booleano(v.gnc, 'El equipo de GNC')
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
      gnc,
      valorGnc: gnc ? montoOpcional(v.valorGnc, 'El valor del equipo de GNC') : null,
      rastreo: booleano(v.rastreo, 'El rastreo satelital'),
      sumaAsegurada: montoOpcional(v.sumaAsegurada, 'La suma asegurada'),
    },
    tomador: {
      nombre: textoOpcional(t.nombre, 120),
      documento: textoOpcional(t.documento, 40),
      telefono: textoOpcional(t.telefono, 60),
      tipoPersona: unoDe<TipoDePersona>(t.tipoPersona, TIPOS_DE_PERSONA, 'El tipo de persona'),
      condicionIva: unoDe<CondicionIva>(t.condicionIva, CONDICIONES_IVA, 'La condición de IVA'),
    },
    codigoPostal,
    localidad: textoOpcional(d.localidad, 120),
    vigenciaDesde,
    medioDePago: unoDe<MedioDePago>(d.medioDePago, MEDIOS_DE_PAGO, 'El medio de pago'),
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
 * escribir el nombre bien: si ninguna contesta, la pantalla deja escribirlo a mano.
 */
export async function localidadesDelMulticotizador(tipo: unknown, codigoPostal: unknown): Promise<string[]> {
  const cual = unoDe<TipoDeVehiculo>(tipo, TIPOS_DE_VEHICULO, 'El tipo de vehículo')
  const cp = codigoPostalDeCuatro(typeof codigoPostal === 'string' ? codigoPostal : '')
  if (!/^\d{4}$/.test(cp)) return []
  const conLocalidades = aseguradorasRegistradas().filter((aseguradora) => aseguradora.localidades && aseguradora.noDisponible() === null)
  const respuestas = await Promise.allSettled(conLocalidades.map((aseguradora) => aseguradora.localidades!(cual, cp)))
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
          emision: cobertura.emision ? { ...cobertura.emision, cobertura: { ...cobertura.emision.cobertura, comision: 0 } } : null,
        }))
    return { aseguradora: aseguradora.id, nombre: aseguradora.nombre, ...cotizacion, coberturas, duracionMs: Date.now() - inicio }
  } catch (error) {
    return {
      ...base,
      estado: 'ERROR',
      mensaje: error instanceof Error ? error.message : String(error),
      duracionMs: Date.now() - inicio,
    }
  }
}
