// Los listados del Multicotizador: cotizaciones, planes de cotización y emisiones.
//
// La regla es que salen de la API de cada compañía —lo que la compañía tiene registrado—, no de la base
// del VPS. La base sólo entra como respaldo, y marcada, cuando la API no puede dar ese listado:
//   - la compañía no tiene API conectada a este programa (la mayoría de la cartera);
//   - la tiene, pero no está configurada en API Aseguradoras;
//   - la tiene configurada, pero su API no ofrece ese listado (ATM sólo busca pólizas de a un DNI);
//   - la API falló al pedirlo.
// Cada fila del respaldo lleva `origen: 'VPS'` y el motivo, que la pantalla muestra en el ícono de
// advertencia. Los planes no tienen respaldo: la base no guarda los planes de las compañías.
//
// Los permisos los controla ipc.ts. Lo del respaldo son datos de otros módulos (las pólizas, los
// presupuestos): sólo se suman si quien pide también puede ver ese módulo.
import {
  avisoDeOrigenVps,
  normalizarTexto,
  type CotizacionListada,
  type EmisionListada,
  type FiltrosDeListado,
  type FuenteDeListado,
  type ListadoDelMulticotizador,
  type PlanListado,
} from '../../shared/multicotizador'
import { ramaCanonica } from '../../shared/ramas'
import { ESTADOS_DE_POLIZA, TIPOS_DE_VEHICULO, type TipoDeVehiculo } from '../../shared/tipos'
import { db } from '../db/base'
import type { CotizadorDeAseguradora } from '../multicotizador/aseguradora'
import { aseguradorasRegistradas } from '../multicotizador/registro'
import { ErrorDeNegocio } from './errores'
import { listarPolizas } from './polizas'
import { objeto } from './validacion'

/** Más que esto y la API de la compañía se da por caída: se cae al respaldo. */
const TIEMPO_MAXIMO_MS = 60_000
/** Un año: más que eso es pedirle a cada compañía media cartera de una vez. */
const RANGO_MAXIMO_DIAS = 366

// --- Validación ---------------------------------------------------------------------------------------

function fechaValida(valor: unknown, campo: string): string {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(new Date(`${valor}T00:00:00`).getTime())) {
    throw new ErrorDeNegocio(`${campo} no es válida.`)
  }
  return valor
}

function tipoValido(valor: unknown): TipoDeVehiculo | null {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor === 'string' && (TIPOS_DE_VEHICULO as readonly string[]).includes(valor)) return valor as TipoDeVehiculo
  throw new ErrorDeNegocio('El tipo de vehículo no es válido.')
}

export function validarFiltrosDeListado(valor: unknown): FiltrosDeListado {
  const f = objeto(valor, 'Los filtros')
  const desde = fechaValida(f.desde, 'La fecha desde')
  const hasta = fechaValida(f.hasta, 'La fecha hasta')
  if (desde > hasta) throw new ErrorDeNegocio('La fecha desde tiene que ser anterior a la fecha hasta.')
  const dias = (new Date(`${hasta}T00:00:00`).getTime() - new Date(`${desde}T00:00:00`).getTime()) / 86_400_000
  if (dias > RANGO_MAXIMO_DIAS) throw new ErrorDeNegocio('El rango de fechas puede ser de un año como máximo.')
  return { desde, hasta, tipo: tipoValido(f.tipo) }
}

// --- Lo común -----------------------------------------------------------------------------------------

function conTiempoMaximo<T>(promesa: Promise<T>, nombre: string): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined
  const vencida = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new ErrorDeNegocio(`${nombre} no contestó en ${TIEMPO_MAXIMO_MS / 1000} segundos.`)), TIEMPO_MAXIMO_MS)
  })
  return Promise.race([promesa, vencida]).finally(() => clearTimeout(reloj))
}

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A qué compañía con API pertenece el nombre que tiene la base («LA EQUIDAD», «MERCANTIL ANDINA S.A.»,
 * «ATM SEGUROS»): la primera palabra del nombre de la compañía, como palabra entera. Devuelve su
 * posición en `registradas`, o -1 si es una compañía sin API.
 */
export function aseguradoraDeLaBase(compania: string | null, registradas: readonly Pick<CotizadorDeAseguradora, 'nombre'>[]): number {
  const texto = ` ${normalizarTexto(compania ?? '')} `
  if (!texto.trim()) return -1
  return registradas.findIndex((aseguradora) => {
    const palabra = normalizarTexto(aseguradora.nombre).split(' ')[0]
    return Boolean(palabra) && texto.includes(` ${palabra} `)
  })
}

/** Una rama de la base (AUTO, MOTO, SCOOTER, PICK UP…) en los dos tipos del multicotizador. */
function tipoDeRama(texto: string | null): TipoDeVehiculo | null {
  const rama = ramaCanonica(texto)
  if (!rama) return null
  return rama === 'MOTO' || rama === 'SCOOTER' || rama === 'MOTO ELÉCTRICA' ? 'MOTO' : 'AUTO'
}

/** Con un tipo elegido, se quedan las de ese tipo y las que no se sabe (no hay con qué descartarlas). */
function delTipo<T extends { tipo: TipoDeVehiculo | null }>(filas: T[], tipo: TipoDeVehiculo | null): T[] {
  return tipo ? filas.filter((fila) => fila.tipo === null || fila.tipo === tipo) : filas
}

/** aaaa-mm-dd en la hora de esta computadora (la base guarda en UTC: las 22 h de acá ya son mañana allá). */
function fechaLocal(iso: string | null): string {
  if (!iso) return ''
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

/** Por qué una compañía con API no da este listado desde su API, o null si sí lo da. */
function motivoSinApi(aseguradora: CotizadorDeAseguradora, tieneElListado: boolean, queLista: string): string | null {
  const noDisponible = aseguradora.noDisponible()
  if (noDisponible) return `${aseguradora.nombre} tiene API, pero no está configurada en este programa (${noDisponible.replace(/\.$/, '')}).`
  if (!tieneElListado) return `${aseguradora.nombre} tiene API, pero su API no da el listado de ${queLista}.`
  return null
}

interface ListadoDeUnaCompania<T> {
  fuente: FuenteDeListado
  filas: T[]
}

/**
 * El esqueleto de cotizaciones y emisiones: cada compañía con API se pide a su API; las que no pueden,
 * y todas las compañías sin API, salen de la base (si se puede ver), marcadas.
 */
async function listar<T extends { tipo: TipoDeVehiculo | null; origen: 'API' | 'VPS'; aseguradora: string; nombreAseguradora: string; motivoVps: string | null }>(opciones: {
  filtros: FiltrosDeListado
  queLista: string
  deLaApi: (aseguradora: CotizadorDeAseguradora) => ((filtros: FiltrosDeListado) => Promise<Array<Omit<T, 'origen' | 'aseguradora' | 'nombreAseguradora' | 'motivoVps'>>>) | undefined
  /** Lo de la base, con el nombre de la compañía tal como está escrito ahí. Null si no se puede ver. */
  deLaBase: () => Array<Omit<T, 'origen' | 'aseguradora' | 'nombreAseguradora' | 'motivoVps'> & { compania: string }> | null
  sinPermisoParaLaBase: string
  ordenar: (a: T, b: T) => number
}): Promise<ListadoDelMulticotizador<T>> {
  const { filtros } = opciones
  const registradas = aseguradorasRegistradas()

  const porCompania: Array<ListadoDeUnaCompania<T> & { motivo: string | null }> = await Promise.all(
    registradas.map(async (aseguradora) => {
      const pedir = opciones.deLaApi(aseguradora)
      const cotizaEsteTipo = !filtros.tipo || aseguradora.tipos.includes(filtros.tipo)
      let motivo = motivoSinApi(aseguradora, Boolean(pedir), opciones.queLista)
      let error: string | null = null
      if (!motivo && pedir && cotizaEsteTipo) {
        try {
          const filas = delTipo(await conTiempoMaximo(pedir.call(aseguradora, filtros), aseguradora.nombre), filtros.tipo).map(
            (fila) => ({ ...fila, origen: 'API', aseguradora: aseguradora.id, nombreAseguradora: aseguradora.nombre, motivoVps: null }) as T,
          )
          return {
            motivo: null,
            filas,
            fuente: { aseguradora: aseguradora.id, nombre: aseguradora.nombre, origen: 'API', motivoVps: null, error: null, filas: filas.length },
          }
        } catch (falla) {
          error = mensajeDe(falla)
          motivo = `La API de ${aseguradora.nombre} no pudo dar el listado: ${error.replace(/\.$/, '')}.`
        }
      }
      if (!motivo && !cotizaEsteTipo) motivo = `${aseguradora.nombre} no cotiza ${filtros.tipo === 'MOTO' ? 'motos' : 'autos'} por su API.`
      return {
        motivo,
        filas: [],
        fuente: { aseguradora: aseguradora.id, nombre: aseguradora.nombre, origen: 'VPS', motivoVps: motivo, error, filas: 0 },
      }
    }),
  )

  const deLaBase = opciones.deLaBase()
  const sinApi = new Map<string, ListadoDeUnaCompania<T>>()
  for (const fila of delTipo(deLaBase ?? [], filtros.tipo)) {
    const { compania, ...resto } = fila
    const indice = aseguradoraDeLaBase(compania, registradas)
    if (indice >= 0) {
      const destino = porCompania[indice]!
      // Lo de una compañía que contestó por su API no se repite desde la base.
      if (destino.fuente.origen === 'API') continue
      destino.filas.push({ ...resto, origen: 'VPS', aseguradora: destino.fuente.aseguradora, nombreAseguradora: destino.fuente.nombre, motivoVps: destino.motivo } as unknown as T)
      continue
    }
    const nombre = compania.trim() || 'Sin compañía'
    const clave = normalizarTexto(nombre)
    let grupo = sinApi.get(clave)
    if (!grupo) {
      const motivo = `${nombre} no tiene una API conectada a este programa.`
      grupo = { filas: [], fuente: { aseguradora: nombre, nombre, origen: 'VPS', motivoVps: motivo, error: null, filas: 0 } }
      sinApi.set(clave, grupo)
    }
    grupo.filas.push({ ...resto, origen: 'VPS', aseguradora: nombre, nombreAseguradora: nombre, motivoVps: grupo.fuente.motivoVps } as unknown as T)
  }

  const grupos = [...porCompania, ...[...sinApi.values()].sort((a, b) => a.fuente.nombre.localeCompare(b.fuente.nombre, 'es'))]
  const fuentes = grupos.map((grupo) => {
    const fuente = { ...grupo.fuente, filas: grupo.filas.length }
    // Sin permiso para la base, lo que hubiera ahí no se puede mostrar: se dice por qué falta.
    if (fuente.origen === 'VPS' && deLaBase === null) fuente.motivoVps = [fuente.motivoVps, opciones.sinPermisoParaLaBase].filter(Boolean).join(' ')
    return fuente
  })
  const filas = grupos
    .flatMap((grupo) => grupo.filas)
    .map((fila) => (fila.origen === 'VPS' ? { ...fila, motivoVps: avisoDeOrigenVps(fila.nombreAseguradora, fila.motivoVps) } : fila))
    .sort(opciones.ordenar)
  return { filas, fuentes }
}

// --- Emisiones ----------------------------------------------------------------------------------------

/** Las pólizas de la base que se emitieron en el rango: el mismo filtro de «Emisión» del módulo Pólizas. */
function emisionesDeLaBase(filtros: FiltrosDeListado): Array<Omit<EmisionListada, 'origen' | 'aseguradora' | 'nombreAseguradora' | 'motivoVps'> & { compania: string }> {
  const listado = listarPolizas({
    busqueda: '',
    estados: [...ESTADOS_DE_POLIZA],
    companias: [],
    sucursales: [],
    coberturas: [],
    ramas: [],
    emisionDesde: filtros.desde,
    emisionHasta: filtros.hasta,
  })
  return listado.filas.map((poliza) => ({
    compania: poliza.compania ?? '',
    tipo: tipoDeRama(poliza.rama),
    poliza: poliza.numero ?? poliza.propuesta ?? '',
    fechaEmision: poliza.vigenciaDesdeIso ?? '',
    tomador: poliza.clienteNombre ?? '',
    patente: poliza.patente ?? '',
    cobertura: poliza.cobertura ?? '',
    vigenciaDesde: poliza.vigenciaDesdeIso ?? '',
    vigenciaHasta: poliza.vigenciaHastaIso ?? '',
    estado: poliza.estado.charAt(0) + poliza.estado.slice(1).toLowerCase(),
  }))
}

export async function emisionesDelMulticotizador(valor: unknown, puedeVerPolizas: boolean): Promise<ListadoDelMulticotizador<EmisionListada>> {
  const filtros = validarFiltrosDeListado(valor)
  return listar<EmisionListada>({
    filtros,
    queLista: 'pólizas emitidas',
    deLaApi: (aseguradora) => aseguradora.emisiones,
    deLaBase: () => (puedeVerPolizas ? emisionesDeLaBase(filtros) : null),
    sinPermisoParaLaBase: 'Lo de la base no se muestra porque no tenés permiso para ver Pólizas.',
    ordenar: (a, b) => b.fechaEmision.localeCompare(a.fechaEmision) || a.nombreAseguradora.localeCompare(b.nombreAseguradora, 'es'),
  })
}

// --- Cotizaciones -------------------------------------------------------------------------------------

interface OpcionDeLaBase {
  compania: string
  cobertura: string
  precio_monto: number | null
  numero: string
  creado_en: string
  cliente_nombre: string
  patente: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  tipo_vehiculo: string | null
  observaciones: string | null
}

/**
 * Lo cotizado según la base: cada opción de cada presupuesto vigente armado en el rango. Es lo que la
 * agencia le presupuestó al cliente, no la cotización que quedó en la compañía.
 */
function cotizacionesDeLaBase(filtros: FiltrosDeListado): Array<Omit<CotizacionListada, 'origen' | 'aseguradora' | 'nombreAseguradora' | 'motivoVps'> & { compania: string }> {
  const filas = db()
    .prepare(
      `SELECT o.compania, o.cobertura, o.precio_monto, p.numero, p.creado_en, p.cliente_nombre, p.patente, p.marca, p.modelo,
              p.anio, p.tipo_vehiculo, p.observaciones
         FROM presupuesto_opciones o
         JOIN presupuestos p ON p.id = o.presupuesto_id
        WHERE p.vigente = 1
        ORDER BY p.creado_en DESC, o.orden, o.id`,
    )
    .all() as OpcionDeLaBase[]
  return filas.flatMap((fila) => {
    const fecha = fechaLocal(fila.creado_en)
    if (!fecha || fecha < filtros.desde || fecha > filtros.hasta) return []
    // El presupuesto no guarda si es auto o moto: el multicotizador lo deja escrito en las observaciones.
    const esMoto = /\bMOTO\b/.test(normalizarTexto(`${fila.tipo_vehiculo ?? ''} ${fila.observaciones ?? ''}`))
    return [
      {
        compania: fila.compania,
        tipo: esMoto ? 'MOTO' : 'AUTO',
        numero: fila.numero,
        fecha,
        tomador: fila.cliente_nombre,
        vehiculo: [fila.marca, fila.modelo, fila.anio].filter(Boolean).join(' '),
        patente: fila.patente ?? '',
        cobertura: fila.cobertura,
        premio: fila.precio_monto,
        sumaAsegurada: null,
        vigenciaDesde: '',
        vigenciaHasta: '',
      },
    ]
  })
}

export async function cotizacionesDelMulticotizador(valor: unknown, puedeVerPresupuestos: boolean): Promise<ListadoDelMulticotizador<CotizacionListada>> {
  const filtros = validarFiltrosDeListado(valor)
  return listar<CotizacionListada>({
    filtros,
    queLista: 'cotizaciones',
    deLaApi: (aseguradora) => aseguradora.cotizaciones,
    deLaBase: () => (puedeVerPresupuestos ? cotizacionesDeLaBase(filtros) : null),
    sinPermisoParaLaBase: 'Lo de la base no se muestra porque no tenés permiso para ver Presupuestos.',
    ordenar: (a, b) => b.fecha.localeCompare(a.fecha) || a.nombreAseguradora.localeCompare(b.nombreAseguradora, 'es'),
  })
}

// --- Planes de cotización -----------------------------------------------------------------------------

/** Los planes comerciales con que cotiza cada compañía, siempre desde su API (la base no los tiene). */
export async function planesDelMulticotizador(valor: unknown): Promise<ListadoDelMulticotizador<PlanListado>> {
  const tipo = tipoValido(valor) ?? 'AUTO'
  const resultados = await Promise.all(
    aseguradorasRegistradas().map(async (aseguradora): Promise<ListadoDeUnaCompania<PlanListado>> => {
      const base: FuenteDeListado = { aseguradora: aseguradora.id, nombre: aseguradora.nombre, origen: 'API', motivoVps: null, error: null, filas: 0 }
      if (!aseguradora.tipos.includes(tipo)) return { filas: [], fuente: { ...base, error: `No cotiza ${tipo === 'MOTO' ? 'motos' : 'autos'} por su API.` } }
      const noDisponible = aseguradora.noDisponible()
      if (noDisponible) return { filas: [], fuente: { ...base, error: noDisponible } }
      if (!aseguradora.planes) return { filas: [], fuente: { ...base, error: 'Su API no trabaja con planes comerciales: cotiza con los datos del vehículo y la forma de pago.' } }
      try {
        const planes = await conTiempoMaximo(aseguradora.planes(tipo), aseguradora.nombre)
        const filas = planes.map((plan) => ({ ...plan, aseguradora: aseguradora.id, nombreAseguradora: aseguradora.nombre, tipo }))
        return { filas, fuente: { ...base, filas: filas.length } }
      } catch (error) {
        return { filas: [], fuente: { ...base, error: mensajeDe(error) } }
      }
    }),
  )
  return { filas: resultados.flatMap((r) => r.filas), fuentes: resultados.map((r) => r.fuente) }
}
