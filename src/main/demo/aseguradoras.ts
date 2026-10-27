// Las compañías del multicotizador en la versión de demostración: «las APIs se muestran pero no están en
// producción». Cumplen el mismo contrato que los adaptadores de verdad (ver multicotizador/aseguradora.ts)
// y con los mismos ids, nombres y tipos de vehículo —así lo propio de cada compañía en la pantalla, como
// emitir con Galeno o con ATM, sigue andando—, pero ninguna sale a internet: el precio se calcula acá.
//
// EL PRECIO no es un número al azar: sale de lo mismo que mira una compañía —el valor del vehículo (por
// su año, su modelo y la suma asegurada), la zona del código postal, el uso, el rastreador y el scoring,
// el GNC, la forma de pago, el modo de facturación, la bonificación y la cláusula de ajuste— con tasas
// parecidas a las del mercado. Es determinístico (ver simulacion.ts): la misma solicitud da el mismo
// precio y otra solicitud da otro, y cada compañía tiene su propio sesgo por categoría, así que «la más
// barata» no es siempre la misma.
//
// Lo propio de cada compañía (el plan comercial, el modo de facturación, la versión en su catálogo…) se
// devuelve como ajustes con opciones, igual que los adaptadores de verdad: cambiar uno cambia el precio.
import {
  categoriaDeCobertura,
  enPesos,
  enPorcentaje,
  normalizarTexto,
  tieneRastreador,
  type AjusteDeAseguradora,
  type CondicionIva,
  type CoberturaCotizada,
  type EmisionPosible,
  type FiltrosDeListado,
  type MedioDePago,
  type UsoDelVehiculo,
} from '../../shared/multicotizador'
import { RAMA_GALENO_DE_TIPO, type CoberturaCotizadaGaleno, type TipoDeVehiculo } from '../../shared/tipos'
import type { CotizacionDeAseguradora, CotizacionDeLaApi, CotizadorDeAseguradora, EmisionDeLaApi, PlanDeAseguradora, SolicitudResuelta } from '../multicotizador/aseguradora'
import { bajoElFormulario, claveDeCuotas, elegidoBajo } from '../multicotizador/equivalencias'
import {
  azarDe,
  diasDelRango,
  enteroDe,
  esperarComoLaApi,
  factorDeZona,
  hashDe,
  localidadesDeEjemplo,
  patenteDe,
  personaDe,
  redondear,
  sumarDias,
  sumarMeses,
  unoDe,
  VEHICULOS_DE_EJEMPLO,
} from './simulacion'

// --- El riesgo: lo que define el precio ----------------------------------------------------------------

type Nivel = 'RC' | 'BASICO' | 'COMPLETO' | 'PREMIUM' | 'TODO_RIESGO'

const PICK_UPS = /\b(HILUX|RANGER|AMAROK|S ?10|FRONTIER|TORO|STRADA|SAVEIRO|OROCH|ALASKAN|MAVERICK|PICK ?UP|L ?200|DC|CD)\b/

/** Cuánto vale el modelo respecto de un auto mediano: lo de siempre del mercado, y si no se conoce, un valor estable. */
const SEGMENTOS: Array<[RegExp, number]> = [
  [/\b(GOL|UP|KA|MOBI|CLIO|SANDERO|ONIX|PRISMA|ETIOS|CORSA|FIESTA|PALIO|SIENA|ARGO|CRONOS|208|207|KWID|LOGAN|C3)\b/, 0.62],
  [/\b(COROLLA|CRUZE|FOCUS|VENTO|MEGANE|308|408|CIVIC|SENTRA|FLUENCE|VIRTUS|POLO)\b/, 1.15],
  [/\b(TAOS|COMPASS|T ?CROSS|TRACKER|2008|3008|ECOSPORT|DUSTER|KICKS|RENEGADE|TERRITORY|NIVUS|HR ?V|COROLLA CROSS)\b/, 1.3],
  [/\b(110|125|WAVE|BLITZ|ENERGY|SMASH|DAX|BIZ|CRYPTON|MOTARD|SKUA 150)\b/, 0.62],
]

interface Riesgo {
  tipo: TipoDeVehiculo
  antiguedad: number
  ceroKm: boolean
  suma: number
  esPickUp: boolean
  zona: number
  uso: UsoDelVehiculo
  rastreo: boolean
  grua: boolean
  alarma: boolean
  garaje: boolean
  gnc: boolean
  juridica: boolean
  /** Para que el sesgo de cada compañía cambie de un vehículo a otro. */
  semilla: string
}

function anioActual(): number {
  return new Date().getFullYear()
}

function esPickUp(modelo: string, version: string): boolean {
  return PICK_UPS.test(normalizarTexto(`${modelo} ${version}`))
}

/**
 * El valor del vehículo cuando no se cargó la suma asegurada: lo que diría la tabla de la compañía. Un
 * auto mediano 0 km anda por $ 32 millones; cada año le saca un 8,5 % (con un piso), la pick up vale
 * bastante más y el modelo mueve el resto.
 */
export function valorEstimado(tipo: TipoDeVehiculo, marca: string, modelo: string, version: string, anio: number): number {
  const texto = normalizarTexto(`${marca} ${modelo} ${version}`)
  const segmento = SEGMENTOS.find(([patron]) => patron.test(texto))?.[1] ?? 0.85 + azarDe(`segmento:${normalizarTexto(`${marca} ${modelo}`)}`) * 0.45
  const base = tipo === 'MOTO' ? 4_200_000 : 32_000_000
  const pick = tipo === 'AUTO' && esPickUp(modelo, version) ? 1.75 : 1
  const antiguedad = Math.max(0, anioActual() - anio)
  const depreciacion = Math.max(0.16, 0.915 ** antiguedad)
  return Math.round((base * segmento * pick * depreciacion) / 10_000) * 10_000
}

const FACTOR_DE_USO: Partial<Record<UsoDelVehiculo, number>> = {
  PARTICULAR: 1,
  COMERCIAL: 1.2,
  TAXI: 1.85,
  REMIS: 1.7,
  PLATAFORMA: 1.45,
  TRANSPORTE_DE_PASAJEROS: 1.6,
  ESCOLAR: 1.5,
}

const SOLO_TERCEROS: readonly UsoDelVehiculo[] = ['TAXI', 'REMIS', 'TRANSPORTE_DE_PASAJEROS', 'AMBULANCIA', 'POLICIA', 'AUTOBOMBA']

/** Lo que paga por mes cada nivel de cobertura, antes de bonificaciones, recargos e impuestos. */
function tarifaMensual(compania: Compania, riesgo: Riesgo, nivel: Nivel, franquicia: number): number {
  const moto = riesgo.tipo === 'MOTO'
  const uso = FACTOR_DE_USO[riesgo.uso] ?? 1.35
  const rc = (moto ? 9_200 : 21_500) * riesgo.zona * uso * (riesgo.esPickUp ? 1.15 : 1) * (riesgo.juridica ? 1.1 : 1) * (riesgo.grua ? 0.98 : 1)
  const robo = (riesgo.rastreo ? 0.78 : 1) * (riesgo.garaje ? 0.9 : 1) * (riesgo.alarma ? 0.95 : 1) * (riesgo.antiguedad > 15 ? 0.85 : 1)
  const gnc = riesgo.gnc ? 1.06 : 1
  const suma = riesgo.suma
  let tarifa: number
  switch (nivel) {
    case 'RC':
      tarifa = rc
      break
    case 'BASICO':
      tarifa = rc + suma * (moto ? 0.0042 : 0.0016) * robo * gnc
      break
    case 'COMPLETO':
      tarifa = rc + suma * (moto ? 0.0062 : 0.0029) * robo * gnc + (moto ? 0 : 2_500)
      break
    case 'PREMIUM':
      tarifa = (rc + suma * (moto ? 0.0062 : 0.0029) * robo * gnc + (moto ? 0 : 2_500)) * 1.17 + suma * 0.0004
      break
    case 'TODO_RIESGO': {
      const danos = (riesgo.ceroKm ? 0.93 : 1) * (1 + Math.min(0.3, riesgo.antiguedad * 0.02)) * uso
      tarifa = rc + suma * (moto ? 0.012 : 0.0085) * Math.max(0.5, 1 - franquicia * 0.055) * danos * gnc * (0.6 + 0.4 * robo)
      break
    }
  }
  // Cada compañía tiene su tarifa, más cara en unas categorías que en otras, y no igual para todos los vehículos.
  const sesgoDeCategoria = 0.93 + azarDe(`${compania.id}:${nivel}:${riesgo.tipo}`) * 0.14
  const sesgoDelVehiculo = 0.96 + azarDe(`${compania.id}:${riesgo.semilla}`) * 0.08
  return tarifa * compania.factor * sesgoDeCategoria * sesgoDelVehiculo
}

/** Pagar por adelantado sale algo más barato que mes a mes. */
const DESCUENTO_POR_MESES: Record<number, number> = { 1: 1, 3: 0.985, 4: 0.98, 6: 0.96, 12: 0.92 }

/** Lo que cobra el Estado arriba de la prima: IVA, ingresos brutos, sellados y la tasa de la SSN. */
const IMPUESTOS: Record<CondicionIva, number> = { CONSUMIDOR_FINAL: 0.235, MONOTRIBUTO: 0.235, RESPONSABLE_INSCRIPTO: 0.255, EXENTO: 0.035 }

interface Condicion {
  meses: number
  cuotas: number
  /** Positiva es bonificación; negativa, extra prima. */
  bonificacion: number
  clausula: number
  recargoFinanciero: number
  planFactor: number
  comision: number
  condicionIva: CondicionIva
}

/** Una cobertura ya calculada, con todos los importes que da una API de verdad. */
interface Tarifada {
  codigo: string
  nombre: string
  franquicia: string
  adicionales: string[]
  prima: number
  bonificacion: number
  recargoAdministrativo: number
  recargoFinanciero: number
  derechoEmision: number
  impuestos: number
  premio: number
  primeraCuota: number
  cuota: number
  comision: number
  bonificacionPorcentaje: number
  recargoAdministrativoPorcentaje: number
}

function pesosRedondos(monto: number): string {
  return `$ ${monto.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`
}

function tarifar(compania: Compania, riesgo: Riesgo, condicion: Condicion): Tarifada[] {
  const descuento = DESCUENTO_POR_MESES[condicion.meses] ?? 1
  const clausula = 1 + condicion.clausula * 0.0035
  const sinTodoRiesgo = riesgo.antiguedad > 20 || SOLO_TERCEROS.includes(riesgo.uso)
  const sinPremium = SOLO_TERCEROS.includes(riesgo.uso) || riesgo.antiguedad > 25
  return compania
    .coberturas(riesgo.tipo)
    .filter((c) => !(c.nivel === 'TODO_RIESGO' && sinTodoRiesgo) && !(c.nivel === 'PREMIUM' && sinPremium))
    .map((c) => {
      const franquiciaEnPesos = c.franquicia ? Math.max(riesgo.tipo === 'MOTO' ? 60_000 : 150_000, Math.round((riesgo.suma * c.franquicia) / 100 / 10_000) * 10_000) : 0
      const prima = redondear(tarifaMensual(compania, riesgo, c.nivel, c.franquicia ?? 0) * condicion.meses * descuento * clausula * condicion.planFactor)
      const bonificacion = redondear((prima * condicion.bonificacion) / 100)
      const primaNeta = prima - bonificacion
      const recargoAdministrativo = redondear((primaNeta * compania.recargoAdministrativo) / 100)
      const recargoFinanciero = redondear((primaNeta + recargoAdministrativo) * condicion.recargoFinanciero * (condicion.cuotas > 1 ? 1 : 0.5))
      const derechoEmision = condicion.meses >= 6 ? 2_400 : 1_200
      const neto = primaNeta + recargoAdministrativo + recargoFinanciero + derechoEmision
      const impuestos = redondear(neto * IMPUESTOS[condicion.condicionIva])
      const premio = redondear(neto + impuestos)
      const cuota = redondear((premio - derechoEmision) / condicion.cuotas)
      return {
        codigo: c.codigo,
        nombre: c.nombre.replace('{franquicia}', pesosRedondos(franquiciaEnPesos)),
        franquicia: franquiciaEnPesos ? pesosRedondos(franquiciaEnPesos) : '',
        adicionales: c.adicionales,
        prima,
        bonificacion,
        recargoAdministrativo,
        recargoFinanciero,
        derechoEmision,
        impuestos,
        premio,
        primeraCuota: redondear(cuota + derechoEmision),
        cuota,
        comision: redondear(primaNeta * condicion.comision),
        bonificacionPorcentaje: condicion.bonificacion,
        recargoAdministrativoPorcentaje: compania.recargoAdministrativo,
      }
    })
}

// --- Las compañías -----------------------------------------------------------------------------------

interface CoberturaDelCatalogo {
  codigo: string
  /** `{franquicia}` se reemplaza por el importe de la franquicia para este vehículo. */
  nombre: string
  nivel: Nivel
  /** El porcentaje de la suma asegurada (sólo todo riesgo). */
  franquicia?: number
  adicionales: string[]
}

interface PlanDemo {
  codigo: string
  texto: string
  /** Cuánto mueve el precio (un plan «bonificado» sale más barato…). */
  factor: number
  /** …y le deja menos comisión a la agencia. */
  comision: number
}

interface FormaDePagoDemo {
  codigo: string
  texto: string
  medio: MedioDePago
  recargo: number
}

interface UsoDemo {
  codigo: string
  texto: string
  usos: readonly UsoDelVehiculo[]
}

interface Compania {
  id: string
  nombre: string
  tipos: TipoDeVehiculo[]
  emite: 'GALENO' | 'ATM' | null
  factor: number
  /** Cuánto tarda en contestar su API (ms). */
  demora: [number, number]
  /** Los meses que factura cada modo que ofrece; el primero es el que usa con «Mejor costo». */
  modos: Array<{ codigo: string; texto: string; meses: number }>
  clausulas: string[]
  recargoAdministrativo: number
  /** Cuántos meses dura la vigencia de una póliza (para los listados). */
  vigenciaMeses: number
  prefijoSolicitud: string
  prefijoPoliza: string
  /** Cómo llama a su versión del vehículo («Versión en Galeno», «Modelo ATM»…). */
  tituloVersion: string
  planes(tipo: TipoDeVehiculo): PlanDemo[]
  coberturas(tipo: TipoDeVehiculo): CoberturaDelCatalogo[]
  formasDePago: FormaDePagoDemo[]
  usos: UsoDemo[]
  equiposDeRastreo: string[]
}

const FORMAS_DE_PAGO: FormaDePagoDemo[] = [
  { codigo: 'TV', texto: 'Tarjeta de crédito Visa', medio: 'TARJETA', recargo: 0.045 },
  { codigo: 'TM', texto: 'Tarjeta de crédito Mastercard', medio: 'TARJETA', recargo: 0.048 },
  { codigo: 'DB', texto: 'Débito automático por CBU', medio: 'DEBITO', recargo: 0.02 },
  { codigo: 'EF', texto: 'Efectivo (cupón de pago)', medio: 'EFECTIVO', recargo: 0.06 },
]

const USOS: UsoDemo[] = [
  { codigo: '1', texto: 'Particular', usos: ['PARTICULAR'] },
  { codigo: '2', texto: 'Comercial', usos: ['COMERCIAL', 'TRANSPORTE_DE_BIENES', 'TRABAJO_RURAL', 'AUXILIO_MECANICO'] },
  { codigo: '3', texto: 'Taxi / remís', usos: ['TAXI', 'REMIS'] },
  { codigo: '4', texto: 'Aplicaciones de transporte (Uber, Cabify, DiDi)', usos: ['PLATAFORMA'] },
  { codigo: '5', texto: 'Transporte de pasajeros y escolar', usos: ['TRANSPORTE_DE_PASAJEROS', 'ESCOLAR'] },
  { codigo: '9', texto: 'Otros usos especiales', usos: ['AUTOBOMBA', 'POLICIA', 'AMBULANCIA', 'CASA_RODANTE', 'TANQUE_ATMOSFERICO', 'CARGAS_PELIGROSAS'] },
]

const RASTREO = ['LoJack', 'Tracker / Tracer', 'Pointer', 'Ituran', 'Ubicar', 'Equipo provisto por la compañía']

const MODOS = {
  MENSUAL: { codigo: 'M', texto: 'Mensual', meses: 1 },
  TRIMESTRAL: { codigo: 'T', texto: 'Trimestral', meses: 3 },
  CUATRIMESTRAL: { codigo: 'C', texto: 'Cuatrimestral', meses: 4 },
  SEMESTRAL: { codigo: 'S', texto: 'Semestral', meses: 6 },
  ANUAL: { codigo: 'A', texto: 'Anual', meses: 12 },
}

const COMPANIAS: Compania[] = [
  {
    id: 'GALENO',
    nombre: 'Galeno',
    tipos: ['AUTO', 'MOTO'],
    emite: 'GALENO',
    factor: 1,
    demora: [700, 1500],
    modos: [MODOS.MENSUAL, MODOS.TRIMESTRAL, MODOS.SEMESTRAL, MODOS.ANUAL],
    clausulas: ['0', '10', '20', '30'],
    recargoAdministrativo: 12,
    vigenciaMeses: 12,
    prefijoSolicitud: '9',
    prefijoPoliza: '4',
    tituloVersion: 'Versión en Galeno',
    planes: (tipo) =>
      tipo === 'MOTO'
        ? [
            { codigo: '310', texto: 'MOTOS PARTICULARES', factor: 1, comision: 0.2 },
            { codigo: '311', texto: 'MOTOS BONIFICADO', factor: 0.93, comision: 0.13 },
          ]
        : [
            { codigo: '101', texto: 'AUTOS PARTICULARES', factor: 1, comision: 0.2 },
            { codigo: '102', texto: 'AUTOS BONIFICADO', factor: 0.92, comision: 0.12 },
            { codigo: '105', texto: 'AUTOS COMISIÓN PLENA', factor: 1.06, comision: 0.26 },
          ],
    coberturas: (tipo) =>
      tipo === 'MOTO'
        ? [
            { codigo: 'A0', nombre: 'Responsabilidad Civil', nivel: 'RC', adicionales: [] },
            { codigo: 'B1', nombre: 'Terceros - Pérdida Total por Robo e Incendio', nivel: 'BASICO', adicionales: [] },
            { codigo: 'C1', nombre: 'Terceros Completo', nivel: 'COMPLETO', adicionales: ['Robo parcial'] },
            { codigo: 'D8', nombre: 'Todo Riesgo c/ Franquicia {franquicia}', nivel: 'TODO_RIESGO', franquicia: 8, adicionales: ['Robo parcial'] },
          ]
        : [
            { codigo: 'A0', nombre: 'Responsabilidad Civil', nivel: 'RC', adicionales: ['Asistencia al vehículo'] },
            { codigo: 'B1', nombre: 'Terceros - Pérdida Total por Robo e Incendio', nivel: 'BASICO', adicionales: ['Asistencia al vehículo'] },
            { codigo: 'C1', nombre: 'Terceros Completo', nivel: 'COMPLETO', adicionales: ['Cristales', 'Cerraduras', 'Asistencia al vehículo'] },
            { codigo: 'C3', nombre: 'Terceros Completo Plus c/ Granizo', nivel: 'PREMIUM', adicionales: ['Granizo', 'Cristales', 'Cerraduras', 'Reposición 0 km (primer año)'] },
            { codigo: 'D2', nombre: 'Todo Riesgo c/ Franquicia {franquicia}', nivel: 'TODO_RIESGO', franquicia: 2, adicionales: ['Granizo', 'Cristales', 'Auto sustituto'] },
            { codigo: 'D4', nombre: 'Todo Riesgo c/ Franquicia {franquicia}', nivel: 'TODO_RIESGO', franquicia: 4, adicionales: ['Granizo', 'Cristales'] },
          ],
    formasDePago: FORMAS_DE_PAGO,
    usos: USOS,
    equiposDeRastreo: RASTREO,
  },
  {
    id: 'ATM',
    nombre: 'ATM',
    tipos: ['AUTO', 'MOTO'],
    emite: 'ATM',
    factor: 0.93,
    demora: [500, 1100],
    modos: [MODOS.MENSUAL, MODOS.CUATRIMESTRAL, MODOS.SEMESTRAL],
    clausulas: ['0', '10', '20'],
    recargoAdministrativo: 9,
    vigenciaMeses: 6,
    prefijoSolicitud: '7',
    prefijoPoliza: '30',
    tituloVersion: 'Modelo en ATM',
    planes: (tipo) => [
      { codigo: tipo === 'MOTO' ? 'PM01' : 'PA01', texto: tipo === 'MOTO' ? 'Plan Motos Estándar' : 'Plan Autos Estándar', factor: 1, comision: 0.18 },
      { codigo: tipo === 'MOTO' ? 'PM02' : 'PA02', texto: tipo === 'MOTO' ? 'Plan Motos Promoción' : 'Plan Autos Promoción', factor: 0.9, comision: 0.1 },
    ],
    coberturas: (tipo) =>
      tipo === 'MOTO'
        ? [
            { codigo: 'A0', nombre: 'Resp. Civil', nivel: 'RC', adicionales: [] },
            { codigo: 'B1', nombre: 'Robo e Incendio Total', nivel: 'BASICO', adicionales: [] },
            { codigo: 'C1', nombre: 'Terceros Completo Clásico', nivel: 'COMPLETO', adicionales: [] },
            { codigo: 'D9', nombre: 'Todo Riesgo Franq. {franquicia}', nivel: 'TODO_RIESGO', franquicia: 10, adicionales: [] },
          ]
        : [
            { codigo: 'A0', nombre: 'Resp. Civil', nivel: 'RC', adicionales: ['Grúa 100 km'] },
            { codigo: 'B1', nombre: 'Robo e Incendio Total', nivel: 'BASICO', adicionales: ['Grúa 100 km'] },
            { codigo: 'C1', nombre: 'Terceros Completo Clásico', nivel: 'COMPLETO', adicionales: ['Cristales', 'Cerraduras', 'Grúa 300 km'] },
            { codigo: 'C4', nombre: 'Terceros Completo Full c/ Granizo', nivel: 'PREMIUM', adicionales: ['Granizo', 'Cristales', 'Cerraduras', 'Grúa 500 km'] },
            { codigo: 'D3', nombre: 'Todo Riesgo Franq. {franquicia}', nivel: 'TODO_RIESGO', franquicia: 3, adicionales: ['Granizo', 'Grúa 500 km'] },
            { codigo: 'D5', nombre: 'Todo Riesgo Franq. {franquicia}', nivel: 'TODO_RIESGO', franquicia: 5, adicionales: ['Granizo', 'Grúa 500 km'] },
          ],
    formasDePago: FORMAS_DE_PAGO,
    usos: USOS,
    equiposDeRastreo: RASTREO,
  },
  {
    id: 'MERCANTIL',
    nombre: 'Mercantil Andina',
    tipos: ['AUTO'],
    emite: null,
    factor: 1.08,
    demora: [600, 1300],
    modos: [MODOS.MENSUAL, MODOS.SEMESTRAL, MODOS.ANUAL],
    clausulas: ['0', '10', '20', '25'],
    recargoAdministrativo: 10,
    vigenciaMeses: 12,
    prefijoSolicitud: '5',
    prefijoPoliza: '11',
    tituloVersion: 'Versión en Mercantil',
    planes: () => [
      { codigo: 'AUTO-CL', texto: 'Autos Clásico', factor: 1, comision: 0.2 },
      { codigo: 'AUTO-PR', texto: 'Autos Productor Plus', factor: 1.04, comision: 0.25 },
      { codigo: 'AUTO-CO', texto: 'Autos Competitivo', factor: 0.91, comision: 0.11 },
    ],
    coberturas: () => [
      { codigo: 'RC', nombre: 'RC Plus', nivel: 'RC', adicionales: ['Asistencia mecánica'] },
      { codigo: 'B', nombre: 'Destrucción Total + Robo Total', nivel: 'BASICO', adicionales: ['Asistencia mecánica'] },
      { codigo: 'C', nombre: 'Terceros Completo Clásica', nivel: 'COMPLETO', adicionales: ['Cristales', 'Cerraduras'] },
      { codigo: 'CP', nombre: 'Terceros Completo Premium', nivel: 'PREMIUM', adicionales: ['Granizo', 'Cristales', 'Cerraduras', 'Auto sustituto 5 días'] },
      { codigo: 'D2', nombre: 'Todo Riesgo F {franquicia}', nivel: 'TODO_RIESGO', franquicia: 2, adicionales: ['Granizo', 'Auto sustituto 10 días'] },
      { codigo: 'D5', nombre: 'Todo Riesgo F {franquicia}', nivel: 'TODO_RIESGO', franquicia: 5, adicionales: ['Granizo'] },
    ],
    formasDePago: FORMAS_DE_PAGO,
    usos: USOS.slice(0, 4),
    equiposDeRastreo: RASTREO,
  },
  {
    id: 'EQUIDAD',
    nombre: 'Equidad',
    tipos: ['AUTO'],
    emite: null,
    factor: 0.97,
    demora: [900, 1500],
    modos: [MODOS.MENSUAL, MODOS.TRIMESTRAL, MODOS.SEMESTRAL],
    clausulas: ['0', '10', '15', '20'],
    recargoAdministrativo: 11,
    vigenciaMeses: 12,
    prefijoSolicitud: '3',
    prefijoPoliza: '21',
    tituloVersion: 'Versión en Equidad',
    planes: () => [
      { codigo: '01', texto: 'Plan General', factor: 1, comision: 0.2 },
      { codigo: '07', texto: 'Plan Bonificado Productor', factor: 0.93, comision: 0.14 },
    ],
    coberturas: () => [
      { codigo: '1', nombre: 'Responsabilidad Civil', nivel: 'RC', adicionales: [] },
      { codigo: '2', nombre: 'Terceros Pérdida Total', nivel: 'BASICO', adicionales: [] },
      { codigo: '3', nombre: 'Terceros Completo', nivel: 'COMPLETO', adicionales: ['Cristales', 'Cerraduras'] },
      { codigo: '4', nombre: 'Terceros Completo Granizo', nivel: 'PREMIUM', adicionales: ['Granizo', 'Cristales', 'Cerraduras'] },
      { codigo: '6', nombre: 'Todo Riesgo con Franquicia {franquicia}', nivel: 'TODO_RIESGO', franquicia: 3, adicionales: ['Granizo'] },
    ],
    formasDePago: FORMAS_DE_PAGO,
    usos: USOS,
    equiposDeRastreo: RASTREO,
  },
  // Dos compañías más, sólo de la demo: la pantalla del multicotizador es la misma para cualquiera, y
  // con seis tarjetas se ve mejor qué es comparar.
  {
    id: 'FEDERACION_PATRONAL',
    nombre: 'Federación Patronal',
    tipos: ['AUTO', 'MOTO'],
    emite: null,
    factor: 1.03,
    demora: [400, 900],
    modos: [MODOS.MENSUAL, MODOS.TRIMESTRAL, MODOS.SEMESTRAL, MODOS.ANUAL],
    clausulas: ['0', '10', '20', '30'],
    recargoAdministrativo: 10,
    vigenciaMeses: 12,
    prefijoSolicitud: '6',
    prefijoPoliza: '15',
    tituloVersion: 'Versión en Federación Patronal',
    planes: (tipo) => [{ codigo: tipo === 'MOTO' ? 'MO' : 'AU', texto: tipo === 'MOTO' ? 'Motovehículos' : 'Automotores Particulares', factor: 1, comision: 0.19 }],
    coberturas: (tipo) =>
      tipo === 'MOTO'
        ? [
            { codigo: 'A', nombre: 'Responsabilidad Civil', nivel: 'RC', adicionales: [] },
            { codigo: 'B', nombre: 'Robo y Destrucción Total', nivel: 'BASICO', adicionales: [] },
            { codigo: 'C', nombre: 'Terceros Completo', nivel: 'COMPLETO', adicionales: [] },
          ]
        : [
            { codigo: 'A', nombre: 'Responsabilidad Civil', nivel: 'RC', adicionales: [] },
            { codigo: 'B', nombre: 'Robo y Destrucción Total', nivel: 'BASICO', adicionales: [] },
            { codigo: 'C', nombre: 'Terceros Completo', nivel: 'COMPLETO', adicionales: ['Cristales', 'Cerraduras'] },
            { codigo: 'CG', nombre: 'Terceros Completo con Granizo', nivel: 'PREMIUM', adicionales: ['Granizo', 'Cristales', 'Cerraduras'] },
            { codigo: 'D', nombre: 'Todo Riesgo con Franquicia {franquicia}', nivel: 'TODO_RIESGO', franquicia: 4, adicionales: ['Granizo'] },
          ],
    formasDePago: FORMAS_DE_PAGO,
    usos: USOS,
    equiposDeRastreo: RASTREO,
  },
  {
    id: 'SANCOR',
    nombre: 'Sancor Seguros',
    tipos: ['AUTO'],
    emite: null,
    factor: 1.05,
    demora: [300, 800],
    modos: [MODOS.MENSUAL, MODOS.SEMESTRAL],
    clausulas: ['0', '10', '20'],
    recargoAdministrativo: 8,
    vigenciaMeses: 6,
    prefijoSolicitud: '8',
    prefijoPoliza: '6',
    tituloVersion: 'Versión en Sancor',
    planes: () => [
      { codigo: 'P1', texto: 'Autos Familiar', factor: 1, comision: 0.21 },
      { codigo: 'P3', texto: 'Autos Bonificado', factor: 0.92, comision: 0.13 },
    ],
    coberturas: () => [
      { codigo: 'RC', nombre: 'Responsabilidad Civil', nivel: 'RC', adicionales: [] },
      { codigo: 'PT', nombre: 'Pérdida Total por Robo e Incendio', nivel: 'BASICO', adicionales: [] },
      { codigo: 'TC', nombre: 'Terceros Completo', nivel: 'COMPLETO', adicionales: ['Cristales', 'Cerraduras'] },
      { codigo: 'TC+', nombre: 'Terceros Completo Plus', nivel: 'PREMIUM', adicionales: ['Granizo', 'Cristales', 'Cerraduras', 'Auxilio 300 km'] },
      { codigo: 'TR3', nombre: 'Todo Riesgo Franquicia {franquicia}', nivel: 'TODO_RIESGO', franquicia: 3, adicionales: ['Granizo'] },
      { codigo: 'TR6', nombre: 'Todo Riesgo Franquicia {franquicia}', nivel: 'TODO_RIESGO', franquicia: 6, adicionales: ['Granizo'] },
    ],
    formasDePago: FORMAS_DE_PAGO.filter((forma) => forma.codigo !== 'EF'),
    usos: USOS.slice(0, 4),
    equiposDeRastreo: RASTREO,
  },
]

// --- Los ajustes ---------------------------------------------------------------------------------------

function porcentajesDeBonificacion(): AjusteDeAseguradora['opciones'] {
  const opciones = [{ valor: '-10', texto: 'Extra prima 10 %' }]
  for (let n = 0; n <= 30; n += 5) opciones.push({ valor: String(n), texto: n === 0 ? 'Sin bonificación' : `${n} %` })
  return opciones
}

const BONIFICACION_DE_LA_TARIFA = { DESCUENTO_MAXIMO: '30', DESCUENTO_MEDIO: '15', SIN_DESCUENTO: '0', EXTRA_PRIMA_MAXIMA: '-10' } as const

function valido<T extends { codigo: string }>(elegido: string | undefined, lista: readonly T[]): T | undefined {
  return elegido ? lista.find((opcion) => opcion.codigo === elegido) : undefined
}

/** Las versiones de la compañía para el vehículo pedido: la que coincide, una más equipada y una más básica. */
function versionesDe(solicitud: SolicitudResuelta): Array<{ codigo: string; texto: string; factor: number }> {
  const v = solicitud.vehiculo
  const nombre = `${v.marca} ${v.modelo}`.toUpperCase()
  const pedida = v.version.trim().toUpperCase()
  return [
    { codigo: 'V1', texto: `${nombre} ${pedida || 'BASE'}`.trim(), factor: 1 },
    { codigo: 'V2', texto: `${nombre} ${pedida ? `${pedida} FULL` : 'FULL'}`, factor: 1.12 },
    { codigo: 'V3', texto: `${nombre} ${pedida ? `${pedida} (ANTERIOR)` : 'SEDÁN'}`, factor: 0.9 },
  ]
}

function localidadesParaAjuste(solicitud: SolicitudResuelta): Array<{ codigo: string; texto: string }> {
  const conocidas = localidadesDeEjemplo(solicitud.codigoPostal).map((l, i) => ({ codigo: String(i + 1), texto: l.localidad }))
  if (conocidas.length > 0) return conocidas
  return [{ codigo: '1', texto: (solicitud.localidad || `CP ${solicitud.codigoPostal}`).toUpperCase() }]
}

interface Elecciones {
  plan: PlanDemo
  modo: Compania['modos'][number]
  cuotas: number
  forma: FormaDePagoDemo
  bonificacion: number
  clausula: number
  version: { codigo: string; texto: string; factor: number }
  localidad: { codigo: string; texto: string }
  uso: UsoDemo
  rastreo: string | null
  ajustes: AjusteDeAseguradora[]
}

/** Decide todo lo propio de la compañía —lo elegido a mano si sigue valiendo; si no, lo del formulario— y arma los ajustes. */
function elegir(compania: Compania, solicitud: SolicitudResuelta, elegidos: Record<string, string>): Elecciones {
  const { vehiculo: v, condiciones: c } = solicitud
  const ajustes: AjusteDeAseguradora[] = []
  const opciones = (lista: ReadonlyArray<{ codigo: string; texto: string }>) => lista.map((o) => ({ valor: o.codigo, texto: o.texto }))

  const planes = compania.planes(v.tipo)
  const porComision = [...planes].sort((a, b) => b.comision - a.comision)
  const plan =
    valido(elegidos.plan, planes) ??
    (c.plan === 'COMISION_MAXIMA' || (c.plan === 'SIN_PLAN' && c.comision === 'MAXIMA')
      ? porComision[0]!
      : c.plan === 'DESCUENTO_MAXIMO' || (c.plan === 'SIN_PLAN' && c.comision === 'MINIMA')
        ? porComision[porComision.length - 1]!
        : planes[0]!)
  ajustes.push({ campo: 'plan', titulo: 'Plan comercial', ayuda: `Comisión del plan: ${enPorcentaje(plan.comision * 100)}.`, opciones: opciones(planes), valor: plan.codigo, obligatorio: true })

  const modo =
    valido(elegidoBajo(elegidos.modoFacturacion, c.facturacion), compania.modos) ??
    compania.modos.find((m) => m === MODOS[c.facturacion as keyof typeof MODOS]) ??
    compania.modos[0]!
  ajustes.push(
    bajoElFormulario(c.facturacion, {
      campo: 'modoFacturacion',
      titulo: 'Modo de facturación',
      ayuda: 'El premio y las cuotas son del período que factura este modo.',
      opciones: opciones(compania.modos),
      valor: modo.codigo,
      obligatorio: true,
      dependeDe: 'plan',
      destacado: true,
    }),
  )

  const opcionesDeCuotas = Array.from({ length: modo.meses }, (_, i) => ({ codigo: String(i + 1), texto: i === 0 ? '1 cuota' : `${i + 1} cuotas` }))
  const cuotaElegida = valido(elegidoBajo(elegidos.cuotas, claveDeCuotas(c.cuotas)), opcionesDeCuotas)
  const cuotas = cuotaElegida ? Number(cuotaElegida.codigo) : typeof c.cuotas === 'number' ? Math.min(c.cuotas, modo.meses) : modo.meses
  ajustes.push(
    bajoElFormulario(claveDeCuotas(c.cuotas), {
      campo: 'cuotas',
      titulo: 'Cuotas',
      opciones: opciones(opcionesDeCuotas),
      valor: String(cuotas),
      obligatorio: true,
      dependeDe: 'modoFacturacion',
      destacado: true,
    }),
  )

  const forma =
    valido(elegidoBajo(elegidos.formaDePago, solicitud.medioDePago), compania.formasDePago) ??
    compania.formasDePago.find((f) => f.medio === solicitud.medioDePago) ??
    compania.formasDePago[0]!
  ajustes.push(
    bajoElFormulario(solicitud.medioDePago, {
      campo: 'formaDePago',
      titulo: 'Forma de pago',
      ayuda: 'Cada forma de pago lleva su propio recargo financiero.',
      opciones: opciones(compania.formasDePago),
      valor: forma.codigo,
      obligatorio: true,
      destacado: true,
    }),
  )

  const bonificaciones = porcentajesDeBonificacion()
  const bonificacion = bonificaciones.find((o) => o.valor === elegidoBajo(elegidos.bonificacion, c.tarifa))?.valor ?? BONIFICACION_DE_LA_TARIFA[c.tarifa]
  ajustes.push(
    bajoElFormulario(c.tarifa, {
      campo: 'bonificacion',
      titulo: '% Bonificación',
      ayuda: 'Lo que la agencia resigna de su comisión para bajar el precio (o la extra prima que suma).',
      opciones: bonificaciones,
      valor: bonificacion,
      obligatorio: false,
      destacado: true,
    }),
  )

  const clausulas = compania.clausulas.map((codigo) => ({ codigo, texto: codigo === '0' ? 'No aplica' : `Ajuste automático ${codigo} %` }))
  const clausula =
    valido(elegidoBajo(elegidos.clausulaAjuste, c.clausulaAjuste), clausulas) ??
    valido(c.clausulaAjuste, clausulas) ??
    // La más parecida a la pedida que la compañía tenga.
    [...clausulas].sort((a, b) => Math.abs(Number(a.codigo) - Number(c.clausulaAjuste)) - Math.abs(Number(b.codigo) - Number(c.clausulaAjuste)))[0]!
  ajustes.push(
    bajoElFormulario(c.clausulaAjuste, {
      campo: 'clausulaAjuste',
      titulo: 'Cláusula de ajuste',
      opciones: opciones(clausulas),
      valor: clausula.codigo,
      obligatorio: false,
      destacado: true,
    }),
  )

  const versiones = versionesDe(solicitud)
  const version = valido(elegidos.version, versiones) ?? versiones[0]!
  ajustes.push({
    campo: 'version',
    titulo: compania.tituloVersion,
    ayuda: v.sumaAsegurada === null ? 'Cada versión tiene su propia suma asegurada en la tabla de la compañía.' : undefined,
    opciones: opciones(versiones),
    valor: version.codigo,
    obligatorio: true,
    porSolicitud: true,
  })

  const localidades = localidadesParaAjuste(solicitud)
  const buscada = normalizarTexto(solicitud.localidad)
  const localidad = valido(elegidos.localidad, localidades) ?? localidades.find((l) => normalizarTexto(l.texto) === buscada) ?? localidades[0]!
  ajustes.push({ campo: 'localidad', titulo: `Localidad (CP ${solicitud.codigoPostal})`, opciones: opciones(localidades), valor: localidad.codigo, obligatorio: true, porSolicitud: true })

  const uso = valido(elegidoBajo(elegidos.uso, v.uso), compania.usos) ?? compania.usos.find((u) => u.usos.includes(v.uso)) ?? compania.usos[0]!
  ajustes.push(bajoElFormulario(v.uso, { campo: 'uso', titulo: 'Uso del vehículo', opciones: opciones(compania.usos), valor: uso.codigo, obligatorio: false }))

  let rastreo: string | null = null
  if (tieneRastreador(v)) {
    const equipos = compania.equiposDeRastreo.map((texto, i) => ({ codigo: String(i + 1), texto }))
    const equipo = valido(elegidos.equipoRastreo, equipos) ?? equipos[0]!
    rastreo = equipo.texto
    ajustes.push({ campo: 'equipoRastreo', titulo: 'Equipo de rastreo', opciones: opciones(equipos), valor: equipo.codigo, obligatorio: false })
  }

  return { plan, modo, cuotas, forma, bonificacion: Number(bonificacion), clausula: Number(clausula.codigo), version, localidad, uso, rastreo, ajustes }
}

// --- Cotizar -------------------------------------------------------------------------------------------

function usoDeLaCompania(uso: UsoDemo, pedido: UsoDelVehiculo): UsoDelVehiculo {
  return uso.usos.includes(pedido) ? pedido : uso.usos[0]!
}

function riesgoDe(solicitud: SolicitudResuelta, elecciones: Elecciones): Riesgo {
  const v = solicitud.vehiculo
  const anio = Number(v.anio)
  const accesorios = v.accesorios.reduce((total, a) => total + a.valor, 0)
  const suma = (v.sumaAsegurada ?? Math.round((valorEstimado(v.tipo, v.marca, v.modelo, v.version, anio) * elecciones.version.factor) / 10_000) * 10_000) + accesorios
  return {
    tipo: v.tipo,
    antiguedad: v.ceroKm ? 0 : Math.max(0, anioActual() - anio),
    ceroKm: v.ceroKm,
    suma,
    esPickUp: v.tipo === 'AUTO' && esPickUp(v.modelo, v.version),
    zona: factorDeZona(solicitud.codigoPostal),
    uso: usoDeLaCompania(elecciones.uso, v.uso),
    rastreo: tieneRastreador(v),
    grua: v.scoring.grua,
    alarma: v.scoring.alarma,
    garaje: v.scoring.garaje,
    gnc: v.gnc,
    juridica: solicitud.tomador.tipoPersona === 'JURIDICA',
    semilla: normalizarTexto(`${v.marca} ${v.modelo} ${v.anio} ${solicitud.codigoPostal}`),
  }
}

/** Un número de solicitud u operación con la forma de los de la compañía, estable para la misma cotización. */
function numeroDe(prefijo: string, semilla: string, digitos = 7): string {
  return `${prefijo}${String(hashDe(semilla) % 10 ** digitos).padStart(digitos, '0')}`
}

const IVA_ATM: Record<CondicionIva, string> = { CONSUMIDOR_FINAL: 'CF', RESPONSABLE_INSCRIPTO: 'IN', MONOTRIBUTO: 'MT', EXENTO: 'EX' }
const PAGO_ATM: Record<MedioDePago, string> = { TARJETA: 'TARJETA', DEBITO: 'CBU', EFECTIVO: 'EFVO' }

function emisionDe(compania: Compania, solicitud: SolicitudResuelta, elecciones: Elecciones, t: Tarifada, numero: string): EmisionPosible | null {
  if (compania.emite === 'GALENO') {
    const cobertura: CoberturaCotizadaGaleno = {
      item: 1,
      cobertura: t.codigo,
      descripcionCobertura: t.nombre,
      prima: t.prima,
      bonificacion: t.bonificacion,
      porcBonificacion: t.bonificacionPorcentaje,
      recargoAdministrativo: t.recargoAdministrativo,
      porcRecargoAdministrativo: t.recargoAdministrativoPorcentaje,
      recargoFinanciero: t.recargoFinanciero,
      derechoEmision: t.derechoEmision,
      impuestos: t.impuestos,
      premio: t.premio,
      importeCuota1: t.primeraCuota,
      importeRestoCuotas: t.cuota,
      comision: t.comision,
      listaAdicionales: t.adicionales,
      franquicia: t.franquicia,
    }
    return {
      tipo: 'GALENO',
      rama: RAMA_GALENO_DE_TIPO[solicitud.vehiculo.tipo],
      solicitud: Number(numero),
      instalacion: 1,
      cobertura,
      codigoPostal: solicitud.codigoPostal,
      subCodigoPostal: elecciones.localidad.codigo,
    }
  }
  if (compania.emite === 'ATM') {
    return {
      tipo: 'ATM',
      operacion: numero,
      cobertura: t.codigo,
      descripcionCobertura: t.nombre,
      premio: t.premio,
      condicionDePago: PAGO_ATM[elecciones.forma.medio],
      seccion: solicitud.vehiculo.tipo === 'MOTO' ? '4' : '3',
      tipoPersona: solicitud.tomador.tipoPersona === 'JURIDICA' ? 'J' : 'F',
      iva: IVA_ATM[solicitud.tomador.condicionIva],
      codigoPostal: solicitud.codigoPostal,
      subCodigoPostal: elecciones.localidad.codigo,
      ceroKm: solicitud.vehiculo.ceroKm,
    }
  }
  return null
}

function avisosDe(compania: Compania, riesgo: Riesgo, solicitud: SolicitudResuelta, tarifadas: Tarifada[]): string[] {
  const avisos: string[] = []
  const conTodoRiesgo = compania.coberturas(riesgo.tipo).some((c) => c.nivel === 'TODO_RIESGO')
  if (riesgo.antiguedad > 20 && conTodoRiesgo) avisos.push('Por la antigüedad del vehículo (más de 20 años) no ofrece todo riesgo: sólo responsabilidad civil y terceros.')
  if (riesgo.antiguedad > 15) avisos.push('Requiere inspección previa: el vehículo tiene más de 15 años.')
  else if (riesgo.antiguedad > 10 && tarifadas.some((t) => categoriaDeCobertura(t.nombre, t.codigo) === 'TODO_RIESGO')) {
    avisos.push('El todo riesgo para vehículos de más de 10 años requiere inspección previa.')
  }
  if (SOLO_TERCEROS.includes(riesgo.uso)) avisos.push('Con este uso sólo cotiza coberturas de terceros.')
  if (riesgo.suma > 45_000_000 && !riesgo.rastreo) avisos.push(`Con una suma asegurada de ${enPesos(riesgo.suma)} pide rastreador instalado para cubrir robo.`)
  if (solicitud.vehiculo.ceroKm) avisos.push('0 km: se emite con la factura de compra; la patente puede ir «A/D» (a declarar).')
  if (compania.id === 'ATM' && riesgo.tipo === 'MOTO') avisos.push('ATM pide fotos de la moto (inspección con su app) antes de emitir robo o todo riesgo.')
  return avisos
}

async function cotizarEn(compania: Compania, solicitud: SolicitudResuelta, elegidos: Record<string, string>): Promise<CotizacionDeAseguradora> {
  await esperarComoLaApi(compania.demora[0], compania.demora[1])
  const elecciones = elegir(compania, solicitud, elegidos)
  const riesgo = riesgoDe(solicitud, elecciones)
  const condicion: Condicion = {
    meses: elecciones.modo.meses,
    cuotas: elecciones.cuotas,
    bonificacion: elecciones.bonificacion,
    clausula: elecciones.clausula,
    recargoFinanciero: elecciones.forma.recargo,
    planFactor: elecciones.plan.factor,
    // Bonificar es resignar comisión: con la bonificación máxima queda bastante menos.
    comision: Math.max(0.05, elecciones.plan.comision - Math.max(0, elecciones.bonificacion) / 200),
    condicionIva: solicitud.tomador.condicionIva,
  }
  const tarifadas = tarifar(compania, riesgo, condicion)
  const numero = numeroDe(compania.prefijoSolicitud, `${compania.id}:${JSON.stringify(solicitud)}:${JSON.stringify(elegidos)}`)
  if (compania.emite === 'GALENO') anotarCotizacionDeGalenoDemo(Number(numero), tarifadas)

  const coberturas: CoberturaCotizada[] = tarifadas.map((t) => ({
    aseguradora: compania.id,
    nombreAseguradora: compania.nombre,
    codigo: t.codigo,
    nombre: t.nombre,
    categoria: categoriaDeCobertura(t.nombre, t.codigo),
    premio: t.premio,
    prima: t.prima,
    primeraCuota: t.primeraCuota,
    cuota: t.cuota,
    franquicia: t.franquicia,
    adicionales: t.adicionales,
    comision: t.comision,
    bonificacionPorcentaje: t.bonificacionPorcentaje,
    recargoAdministrativoPorcentaje: t.recargoAdministrativoPorcentaje,
    emision: emisionDe(compania, solicitud, elecciones, t, numero),
  }))

  const resumen = [
    `Cotizado con el plan ${elecciones.plan.texto}`,
    `modo de facturación «${elecciones.modo.texto}»`,
    elecciones.cuotas === 1 ? 'en 1 cuota' : `en ${elecciones.cuotas} cuotas`,
    `forma de pago «${elecciones.forma.texto}»`,
    elecciones.clausula ? `cláusula de ajuste ${elecciones.clausula} %` : 'sin cláusula de ajuste',
    `suma asegurada ${enPesos(riesgo.suma)}${solicitud.vehiculo.sumaAsegurada === null ? ` (la de ${compania.nombre})` : ''}`,
    elecciones.bonificacion > 0 ? `bonificación ${elecciones.bonificacion} %` : elecciones.bonificacion < 0 ? `extra prima ${-elecciones.bonificacion} %` : '',
  ]
    .filter(Boolean)
    .join(', ')

  return {
    estado: 'OK',
    mensaje: `${resumen}. Precios de demostración: no salen de la API de ${compania.nombre}.`,
    descripcionVehiculo: `${elecciones.version.texto} ${solicitud.vehiculo.ceroKm ? '0 KM' : solicitud.vehiculo.anio}`,
    coberturas,
    avisos: avisosDe(compania, riesgo, solicitud, tarifadas),
    ajustes: elecciones.ajustes,
    detalleTecnico: {
      demo: true,
      aviso: 'Respuesta simulada por la versión de demostración: no se consultó a la compañía.',
      endpoint: `POST https://api.demo.invalid/${compania.id.toLowerCase()}/cotizar`,
      pedido: {
        solicitud: numero,
        plan: elecciones.plan.codigo,
        modoFacturacion: elecciones.modo.codigo,
        cuotas: elecciones.cuotas,
        formaDePago: elecciones.forma.codigo,
        version: elecciones.version.texto,
        codigoPostal: solicitud.codigoPostal,
        localidad: elecciones.localidad.texto,
        sumaAsegurada: riesgo.suma,
        uso: elecciones.uso.texto,
        rastreo: elecciones.rastreo,
      },
      respuesta: { solicitud: numero, coberturas: tarifadas },
    },
  }
}

// --- Los listados ---------------------------------------------------------------------------------------

const ESTADOS_DE_EMISION = ['Vigente', 'Vigente', 'Vigente', 'Vigente', 'Vigente', 'Vigente', 'Pendiente de inspección', 'Anulada']

interface FilaInventada {
  dia: string
  semilla: string
  tipo: TipoDeVehiculo
  vehiculo: string
  anio: number
  patente: string
  tomador: string
  cobertura: Tarifada
  suma: number
}

/** Las filas «de la API» de un rango: cuántas por día y de qué vehículo sale del hash, nunca del azar. */
function filasInventadas(compania: Compania, filtros: FiltrosDeListado, que: string, porDia: number): FilaInventada[] {
  const tipos = compania.tipos.filter((tipo) => !filtros.tipo || tipo === filtros.tipo)
  if (tipos.length === 0) return []
  const filas: FilaInventada[] = []
  for (const dia of diasDelRango(filtros.desde, filtros.hasta)) {
    const finDeSemana = [0, 6].includes(new Date(`${dia}T12:00:00`).getDay())
    const cuantas = enteroDe(`${compania.id}:${que}:${dia}`, 0, finDeSemana ? 0 : porDia)
    for (let i = 0; i < cuantas; i++) {
      const semilla = `${compania.id}:${que}:${dia}:${i}`
      const tipo = unoDe(`${semilla}:tipo`, tipos)
      const ejemplo = unoDe(semilla, VEHICULOS_DE_EJEMPLO.filter((vehiculo) => vehiculo.tipo === tipo))
      const anio = enteroDe(`${semilla}:anio`, 2008, anioActual())
      const suma = valorEstimado(tipo, ejemplo.marca, ejemplo.modelo, ejemplo.version, anio)
      const riesgo: Riesgo = {
        tipo,
        antiguedad: anioActual() - anio,
        ceroKm: false,
        suma,
        esPickUp: esPickUp(ejemplo.modelo, ejemplo.version),
        zona: factorDeZona(unoDe(`${semilla}:cp`, ['1870', '1824', '1878', '1406', '1900', '1636'])),
        uso: 'PARTICULAR',
        rastreo: false,
        grua: false,
        alarma: false,
        garaje: false,
        gnc: false,
        juridica: false,
        semilla,
      }
      const condicion: Condicion = { meses: 1, cuotas: 1, bonificacion: 0, clausula: 10, recargoFinanciero: 0.045, planFactor: 1, comision: 0.2, condicionIva: 'CONSUMIDOR_FINAL' }
      const tarifadas = tarifar(compania, riesgo, condicion)
      filas.push({
        dia,
        semilla,
        tipo,
        vehiculo: `${ejemplo.marca} ${ejemplo.modelo} ${ejemplo.version} ${anio}`,
        anio,
        patente: patenteDe(semilla, anio, tipo),
        tomador: personaDe(semilla),
        cobertura: unoDe(`${semilla}:cobertura`, tarifadas),
        suma,
      })
    }
  }
  return filas.slice(0, 300)
}

function listadosDe(compania: Compania): Pick<CotizadorDeAseguradora, 'planes' | 'cotizaciones' | 'emisiones'> {
  return {
    async planes(tipo: TipoDeVehiculo): Promise<PlanDeAseguradora[]> {
      await esperarComoLaApi(compania.demora[0] / 2, compania.demora[1] / 2)
      if (!compania.tipos.includes(tipo)) return []
      return compania.planes(tipo).map((plan) => ({ codigo: plan.codigo, descripcion: plan.texto, detalle: `Comisión ${enPorcentaje(plan.comision * 100)} · demostración` }))
    },
    async cotizaciones(filtros: FiltrosDeListado): Promise<CotizacionDeLaApi[]> {
      await esperarComoLaApi(compania.demora[0], compania.demora[1])
      return filasInventadas(compania, filtros, 'cotizacion', 3).map((fila) => {
        const desde = sumarDias(fila.dia, enteroDe(`${fila.semilla}:vigencia`, 0, 10))
        return {
          tipo: fila.tipo,
          numero: numeroDe(compania.prefijoSolicitud, fila.semilla),
          fecha: fila.dia,
          tomador: fila.tomador,
          vehiculo: fila.vehiculo,
          patente: fila.patente,
          cobertura: fila.cobertura.nombre,
          premio: fila.cobertura.premio,
          sumaAsegurada: fila.suma,
          vigenciaDesde: desde,
          vigenciaHasta: sumarMeses(desde, compania.vigenciaMeses),
        }
      })
    },
    async emisiones(filtros: FiltrosDeListado): Promise<EmisionDeLaApi[]> {
      await esperarComoLaApi(compania.demora[0], compania.demora[1])
      return filasInventadas(compania, filtros, 'emision', 1).map((fila) => ({
        tipo: fila.tipo,
        poliza: numeroDe(compania.prefijoPoliza, fila.semilla, 6),
        fechaEmision: fila.dia,
        tomador: fila.tomador,
        patente: fila.patente,
        cobertura: fila.cobertura.nombre,
        vigenciaDesde: fila.dia,
        vigenciaHasta: sumarMeses(fila.dia, compania.vigenciaMeses),
        estado: unoDe(`${fila.semilla}:estado`, ESTADOS_DE_EMISION),
      }))
    },
  }
}

// --- Lo que se registra ------------------------------------------------------------------------------

function comoCotizador(compania: Compania): CotizadorDeAseguradora {
  return {
    id: compania.id,
    nombre: compania.nombre,
    tipos: compania.tipos,
    emite: compania.emite !== null,
    // En la demo todas están «configuradas»: no hay credenciales que cargar.
    noDisponible: () => null,
    async localidades(_tipo, codigoPostal) {
      await esperarComoLaApi(150, 450)
      return localidadesDeEjemplo(codigoPostal).map((l) => l.localidad)
    },
    cotizar: (solicitud, elegidos) => cotizarEn(compania, solicitud, elegidos),
    ...listadosDe(compania),
  }
}

/** Las compañías del multicotizador en la demo (ver `aseguradorasRegistradas` en multicotizador/registro.ts). */
export const ASEGURADORAS_DE_LA_DEMO: readonly CotizadorDeAseguradora[] = COMPANIAS.map(comoCotizador)

// --- Para el cliente de Galeno de la demo (ver galeno.ts) ---------------------------------------------

/** Lo cotizado con Galeno en la demo, por número de solicitud: al emitir se cobra lo mismo que se cotizó. */
const cotizadoEnGaleno = new Map<number, Map<string, { premio: number; impuestos: number }>>()

export function anotarCotizacionDeGalenoDemo(solicitud: number, coberturas: Array<{ codigo: string; premio: number; impuestos: number }>): void {
  cotizadoEnGaleno.set(solicitud, new Map(coberturas.map((c) => [c.codigo, { premio: c.premio, impuestos: c.impuestos }])))
  // Sólo hacen falta las últimas: nadie emite una cotización de hace cien cotizaciones.
  if (cotizadoEnGaleno.size > 200) cotizadoEnGaleno.delete(cotizadoEnGaleno.keys().next().value!)
}

export function cotizadoEnGalenoDemo(solicitud: number, cobertura: string): { premio: number; impuestos: number } | null {
  return cotizadoEnGaleno.get(solicitud)?.get(cobertura) ?? null
}

export interface PedidoDeGalenoDemo {
  tipo: TipoDeVehiculo
  marca: string
  modelo: string
  version: string
  anio: number
  ceroKm: boolean
  sumaAsegurada: number | null
  codigoPostal: string
  uso: UsoDelVehiculo
  rastreo: boolean
  gnc: boolean
  valorGnc: number
  meses: number
  cuotas: number
  formaDePago: MedioDePago
  bonificacion: number | null
  clausula: number
  planCodigo: string
  juridica: boolean
}

/** Las coberturas de Galeno para el «Cotizar con Galeno» de Presupuestos, con la forma cruda de su API. */
export function coberturasDeGalenoDemo(pedido: PedidoDeGalenoDemo): CoberturaCotizadaGaleno[] {
  const compania = COMPANIAS[0]!
  const plan = compania.planes(pedido.tipo).find((p) => p.codigo === pedido.planCodigo) ?? compania.planes(pedido.tipo)[0]!
  const riesgo: Riesgo = {
    tipo: pedido.tipo,
    antiguedad: pedido.ceroKm ? 0 : Math.max(0, anioActual() - pedido.anio),
    ceroKm: pedido.ceroKm,
    suma: (pedido.sumaAsegurada ?? valorEstimado(pedido.tipo, pedido.marca, pedido.modelo, pedido.version, pedido.anio)) + (pedido.gnc ? pedido.valorGnc : 0),
    esPickUp: pedido.tipo === 'AUTO' && esPickUp(pedido.modelo, pedido.version),
    zona: factorDeZona(pedido.codigoPostal),
    uso: pedido.uso,
    rastreo: pedido.rastreo,
    grua: false,
    alarma: false,
    garaje: false,
    gnc: pedido.gnc,
    juridica: pedido.juridica,
    semilla: normalizarTexto(`${pedido.marca} ${pedido.modelo} ${pedido.anio} ${pedido.codigoPostal}`),
  }
  const bonificacion = pedido.bonificacion ?? 0
  const forma = compania.formasDePago.find((f) => f.medio === pedido.formaDePago) ?? compania.formasDePago[0]!
  const tarifadas = tarifar(compania, riesgo, {
    meses: pedido.meses,
    cuotas: pedido.cuotas,
    bonificacion,
    clausula: pedido.clausula,
    recargoFinanciero: forma.recargo,
    planFactor: plan.factor,
    comision: Math.max(0.05, plan.comision - Math.max(0, bonificacion) / 200),
    condicionIva: 'CONSUMIDOR_FINAL',
  })
  return tarifadas.map((t, i) => ({
    item: i + 1,
    cobertura: t.codigo,
    descripcionCobertura: t.nombre,
    prima: t.prima,
    bonificacion: t.bonificacion,
    porcBonificacion: t.bonificacionPorcentaje,
    recargoAdministrativo: t.recargoAdministrativo,
    porcRecargoAdministrativo: t.recargoAdministrativoPorcentaje,
    recargoFinanciero: t.recargoFinanciero,
    derechoEmision: t.derechoEmision,
    impuestos: t.impuestos,
    premio: t.premio,
    importeCuota1: t.primeraCuota,
    importeRestoCuotas: t.cuota,
    comision: t.comision,
    listaAdicionales: t.adicionales,
    franquicia: t.franquicia,
  }))
}

/** Los planes comerciales de Galeno en la demo, para su cliente simulado. */
export function planesDeGalenoDemo(tipo: TipoDeVehiculo): Array<{ codigo: string; texto: string }> {
  return COMPANIAS[0]!.planes(tipo)
}
