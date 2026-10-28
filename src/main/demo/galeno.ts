// El cliente de Galeno de la versión de demostración: contesta cada ruta de su API REST con datos
// inventados, con la MISMA forma cruda que devuelve Galeno. Todo lo de `aseguradoras/galeno/*`
// (catálogos, cotizar, emitir, consultas, cuenta corriente, ART, imprimir) lo usa sin enterarse, así que
// en la demo andan igual API Aseguradoras → Galeno, «Cotizar con Galeno» de Presupuestos y la emisión
// desde el multicotizador. Ver `cliente()` en servicios/galeno.ts, que es donde se enchufa.
import { RAMA_GALENO_DE_TIPO, type TipoDeVehiculo } from '../../shared/tipos'
import type { MedioDePago, UsoDelVehiculo } from '../../shared/multicotizador'
import type { ClienteGaleno } from '../aseguradoras/galeno/cliente'
import { anotarCotizacionDeLaSesion, anotarEmisionDeLaSesion, coberturasDeGalenoDemo, cotizadoEnLaSesion, emisionesDeLaSesionCon, planesDeGalenoDemo, polizasInventadasDe, valorEstimado } from './aseguradoras'
import {
  anioDeEjemplo,
  enteroDe,
  esperarComoLaApi,
  fechaArgentina,
  fechaIso,
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

/** El legajo del productor de la agencia de ejemplo. */
export const LEGAJO_DE_LA_DEMO = '84512'

// --- El catálogo de vehículos de Galeno -----------------------------------------------------------------

interface VersionDeGaleno {
  texto: string
  /** Los años en que se vendió esa versión; sin límite si no se indica. */
  desde?: number
  hasta?: number
}

interface ModeloDeGaleno {
  nombre: string
  /** El primer año de fabricación y el último (null si se sigue fabricando): un Cronos 2005 no existe. */
  desde: number
  hasta: number | null
  versiones: VersionDeGaleno[]
}

const unaVersion = (texto: string, desde?: number, hasta?: number): VersionDeGaleno => ({ texto, desde, hasta })
const unModelo = (nombre: string, desde: number, hasta: number | null, ...versiones: VersionDeGaleno[]): ModeloDeGaleno => ({ nombre, desde, hasta, versiones })

const MARCAS: Record<TipoDeVehiculo, Array<{ codigo: string; nombre: string; modelos: ModeloDeGaleno[] }>> = {
  AUTO: [
    {
      codigo: '46',
      nombre: 'VOLKSWAGEN',
      modelos: [
        unModelo('GOL TREND', 2009, 2023, unaVersion('1.6 TRENDLINE 5P'), unaVersion('1.6 COMFORTLINE 5P'), unaVersion('1.6 HIGHLINE 5P', 2009, 2018)),
        unModelo('POLO', 2018, null, unaVersion('1.6 MSI TRACK'), unaVersion('1.6 MSI HIGHLINE'), unaVersion('1.4 TSI GTS', 2019)),
        unModelo('AMAROK', 2011, null, unaVersion('2.0 TDI 4X2 HIGHLINE'), unaVersion('2.0 TDI 4X4 HIGHLINE'), unaVersion('3.0 V6 4X4 EXTREME')),
        unModelo('TAOS', 2021, null, unaVersion('1.4 TSI COMFORTLINE'), unaVersion('1.4 TSI HIGHLINE')),
      ],
    },
    {
      codigo: '23',
      nombre: 'FORD',
      modelos: [
        unModelo('KA', 2008, 2021, unaVersion('1.0 FLY VIRAL', 2008, 2015), unaVersion('1.5 SE', 2016), unaVersion('1.5 SEL', 2016)),
        unModelo('FOCUS', 2009, 2019, unaVersion('2.0 SE PLUS'), unaVersion('2.0 TITANIUM AT')),
        unModelo('RANGER', 2012, null, unaVersion('3.2 DC 4X4 XLT', 2012, 2023), unaVersion('3.2 DC 4X2 XL', 2012, 2023), unaVersion('3.0 V6 DC 4X4 LIMITED', 2023)),
        unModelo('TERRITORY', 2020, null, unaVersion('1.5 TURBO SEL'), unaVersion('1.5 TURBO TITANIUM')),
      ],
    },
    {
      codigo: '12',
      nombre: 'CHEVROLET',
      modelos: [
        unModelo('ONIX', 2013, null, unaVersion('1.4 LT', 2013, 2019), unaVersion('1.2 LT', 2020), unaVersion('1.2 PREMIER', 2020)),
        unModelo('CRUZE', 2011, 2023, unaVersion('1.4 TURBO LT'), unaVersion('1.4 TURBO LTZ'), unaVersion('1.4 TURBO PREMIER', 2017)),
        unModelo('S10', 2012, null, unaVersion('2.8 DC 4X2 LS'), unaVersion('2.8 DC 4X4 LT'), unaVersion('2.8 DC 4X4 HIGH COUNTRY')),
        unModelo('TRACKER', 2013, null, unaVersion('1.8 LTZ', 2013, 2019), unaVersion('1.2 TURBO LT', 2020), unaVersion('1.2 TURBO PREMIER', 2020)),
      ],
    },
    {
      codigo: '21',
      nombre: 'FIAT',
      modelos: [
        unModelo('ARGO', 2018, null, unaVersion('1.3 DRIVE'), unaVersion('1.8 PRECISION')),
        unModelo('CRONOS', 2018, null, unaVersion('1.3 DRIVE GSE'), unaVersion('1.8 PRECISION')),
        unModelo('STRADA', 2012, null, unaVersion('1.4 WORKING', 2012, 2020), unaVersion('1.6 ADVENTURE', 2012, 2020), unaVersion('1.3 FREEDOM', 2020)),
        unModelo('TORO', 2016, null, unaVersion('2.0 TD350 4X4 FREEDOM'), unaVersion('2.0 TD350 4X4 VOLCANO'), unaVersion('1.8 AT6 4X2 FREEDOM')),
      ],
    },
    {
      codigo: '51',
      nombre: 'TOYOTA',
      modelos: [
        unModelo('ETIOS', 2013, 2023, unaVersion('1.5 X'), unaVersion('1.5 XLS'), unaVersion('1.5 PLATINUM')),
        unModelo('YARIS', 2018, null, unaVersion('1.5 XS CVT'), unaVersion('1.5 XLS CVT')),
        unModelo('COROLLA', 2014, null, unaVersion('1.8 XEI CVT', 2014, 2022), unaVersion('1.8 SEG CVT', 2014, 2022), unaVersion('2.0 XEI CVT', 2019), unaVersion('2.0 SEG CVT', 2019)),
        unModelo('HILUX', 2005, null, unaVersion('2.5 DC 4X2 DX', 2005, 2015), unaVersion('3.0 DC 4X4 SRV', 2005, 2015), unaVersion('2.8 DC 4X4 SRV', 2016), unaVersion('2.8 DC 4X2 SR', 2016)),
      ],
    },
    {
      codigo: '40',
      nombre: 'PEUGEOT',
      modelos: [
        unModelo('208', 2014, null, unaVersion('1.6 ALLURE'), unaVersion('1.6 FELINE'), unaVersion('1.2 PURETECH ALLURE', 2021)),
        unModelo('2008', 2016, null, unaVersion('1.6 ALLURE'), unaVersion('1.6 FELINE'), unaVersion('1.6 THP SPORT', 2018)),
        unModelo('308', 2012, 2022, unaVersion('1.6 ALLURE'), unaVersion('1.6 FELINE'), unaVersion('1.6 THP SPORT')),
        unModelo('PARTNER', 2008, null, unaVersion('1.6 HDI CONFORT'), unaVersion('1.6 HDI PATAGONICA')),
      ],
    },
    {
      codigo: '44',
      nombre: 'RENAULT',
      modelos: [
        unModelo('SANDERO', 2008, null, unaVersion('1.6 EXPRESSION'), unaVersion('1.6 PRIVILEGE'), unaVersion('1.6 STEPWAY INTENS', 2017)),
        unModelo('LOGAN', 2008, null, unaVersion('1.6 EXPRESSION'), unaVersion('1.6 PRIVILEGE')),
        unModelo('DUSTER', 2011, null, unaVersion('1.6 4X2 DYNAMIQUE'), unaVersion('2.0 4X4 PRIVILEGE')),
        unModelo('KANGOO', 2008, null, unaVersion('1.6 EXPRESSION'), unaVersion('1.6 CONFORT 5 ASIENTOS')),
      ],
    },
  ],
  MOTO: [
    {
      codigo: '30',
      nombre: 'HONDA',
      modelos: [unModelo('WAVE', 2010, null, unaVersion('110 S'), unaVersion('110 S FULL')), unModelo('CB 190R', 2015, null, unaVersion('190R'), unaVersion('190R ABS', 2019)), unModelo('XR 150L', 2014, null, unaVersion('150L'))],
    },
    {
      codigo: '57',
      nombre: 'YAMAHA',
      modelos: [unModelo('YBR 125', 2008, null, unaVersion('125 ED'), unaVersion('125 FULL')), unModelo('FZ', 2016, null, unaVersion('FZ-S FI 150'), unaVersion('FZ 25')), unModelo('XTZ 250', 2018, null, unaVersion('250'), unaVersion('250 ABS', 2020))],
    },
    {
      codigo: '70',
      nombre: 'MOTOMEL',
      modelos: [unModelo('BLITZ', 2012, null, unaVersion('110 V8 FULL'), unaVersion('110 V8 BASE')), unModelo('SKUA 150', 2013, null, unaVersion('150 V6'), unaVersion('150 V6 FULL'))],
    },
    {
      codigo: '71',
      nombre: 'CORVEN',
      modelos: [unModelo('ENERGY', 2010, null, unaVersion('110'), unaVersion('110 FULL')), unModelo('TRIAX 150', 2012, null, unaVersion('150 R3'), unaVersion('150 R3 FULL'))],
    },
  ],
}

function todasLasMarcas() {
  return [...MARCAS.AUTO.map((m) => ({ ...m, tipo: 'AUTO' as const })), ...MARCAS.MOTO.map((m) => ({ ...m, tipo: 'MOTO' as const }))]
}

/** El modelo por su código («4602» = el segundo modelo de la marca 46). */
function modeloDe(marcaCodigo: string, modeloCodigo: string) {
  const marca = todasLasMarcas().find((m) => m.codigo === marcaCodigo)
  if (!marca) return null
  const indice = Number(modeloCodigo.slice(marcaCodigo.length)) - 1
  const modelo = marca.modelos[indice]
  return modelo ? { marca, modelo } : null
}

/** Las versiones de un modelo que se vendieron ese año (todas, si el año no es un número). */
function versionesDelAnio(modelo: ModeloDeGaleno, anio: number): VersionDeGaleno[] {
  if (!Number.isFinite(anio) || anio <= 0) return modelo.versiones
  return modelo.versiones.filter((v) => anio >= (v.desde ?? 0) && anio <= (v.hasta ?? Infinity))
}

// --- Las listas de valores ----------------------------------------------------------------------------

const opcion = (codigo: string, descripcion: string) => ({ codigo, descripcion })

const MESES_DEL_MODO: Record<string, number> = { M: 1, T: 3, S: 6, A: 12 }
const MODOS = [opcion('M', 'MENSUAL'), opcion('T', 'TRIMESTRAL'), opcion('S', 'SEMESTRAL'), opcion('A', 'ANUAL')]
const FORMAS_DE_PAGO: Array<{ codigo: string; descripcion: string; medio: MedioDePago }> = [
  { codigo: '1', descripcion: 'TARJETA DE CREDITO', medio: 'TARJETA' },
  { codigo: '2', descripcion: 'DEBITO EN CUENTA (CBU)', medio: 'DEBITO' },
  { codigo: '3', descripcion: 'EFECTIVO / CUPON DE PAGO', medio: 'EFECTIVO' },
]
const USOS: Array<{ codigoUsoVehiculo: number; descripcionUsoVehiculo: string; uso: UsoDelVehiculo }> = [
  { codigoUsoVehiculo: 1, descripcionUsoVehiculo: 'PARTICULAR', uso: 'PARTICULAR' },
  { codigoUsoVehiculo: 2, descripcionUsoVehiculo: 'COMERCIAL', uso: 'COMERCIAL' },
  { codigoUsoVehiculo: 3, descripcionUsoVehiculo: 'TAXI / REMIS', uso: 'TAXI' },
  { codigoUsoVehiculo: 4, descripcionUsoVehiculo: 'APLICACIONES DE TRANSPORTE', uso: 'PLATAFORMA' },
]

/** Las listas que no dependen de nada, por ruta. */
const LISTAS_FIJAS: Record<string, unknown> = {
  '/api/cotizadores/comun/ramas': [opcion('4', 'AUTOMOTORES'), opcion('28', 'MOTOS'), opcion('21', 'ACCIDENTES PERSONALES')],
  '/api/cotizadores/comun/tiposPersona': [opcion('1', 'FISICA'), opcion('2', 'JURIDICA')],
  '/api/cotizadores/comun/categoriasIva': [opcion('5', 'CONSUMIDOR FINAL'), opcion('1', 'RESPONSABLE INSCRIPTO'), opcion('6', 'MONOTRIBUTO'), opcion('4', 'EXENTO')],
  '/api/cotizadores/comun/codigosIIBB': [opcion('1', 'CONSUMIDOR FINAL'), opcion('2', 'CONVENIO MULTILATERAL'), opcion('3', 'EXENTO'), opcion('4', 'LOCAL')],
  '/api/cotizadores/comun/tiposDeUso': USOS.map(({ codigoUsoVehiculo, descripcionUsoVehiculo }) => ({ codigoUsoVehiculo, descripcionUsoVehiculo })),
  '/api/cotizadores/comun/codigosAlarma': [opcion('1', 'LOJACK'), opcion('2', 'TRACKER'), opcion('3', 'POINTER'), opcion('4', 'ITURAN'), opcion('5', 'UBICAR')],
  '/api/cotizadores/auto/clausulasDeAjuste': [opcion('0', 'SIN CLAUSULA DE AJUSTE'), opcion('10', 'CLAUSULA DE AJUSTE AUTOMATICO 10 %'), opcion('20', 'CLAUSULA DE AJUSTE AUTOMATICO 20 %'), opcion('30', 'CLAUSULA DE AJUSTE AUTOMATICO 30 %')],
  '/api/cotizadores/auto/equipoGnc': [opcion('1', 'EQUIPO DE GNC DE 5TA GENERACION'), opcion('2', 'EQUIPO DE GNC CONVENCIONAL')],
  '/api/cotizadores/auto/accesorios': [opcion('25', 'EQUIPO DE GNC'), opcion('3', 'EQUIPO DE AUDIO'), opcion('7', 'LLANTAS ESPECIALES'), opcion('12', 'TECHO CORREDIZO')],
  '/api/cotizadores/auto/coberturasAdicionales': [opcion('G1', 'GRANIZO'), opcion('AS', 'AUTO SUSTITUTO'), opcion('CR', 'CRISTALES')],
  '/api/comunes/tiposDocumentos': [opcion('96', 'DNI'), opcion('80', 'CUIT'), opcion('86', 'CUIL'), opcion('89', 'LE'), opcion('90', 'LC'), opcion('94', 'PASAPORTE')],
  '/api/cotizadores/comun/nacionalidades': [opcion('1', 'ARGENTINA'), opcion('2', 'BOLIVIANA'), opcion('3', 'BRASILEÑA'), opcion('4', 'CHILENA'), opcion('5', 'PARAGUAYA'), opcion('6', 'PERUANA'), opcion('7', 'URUGUAYA'), opcion('9', 'OTRA')],
  '/api/cotizadores/comun/sexos': [opcion('M', 'MASCULINO'), opcion('F', 'FEMENINO'), opcion('X', 'NO BINARIO')],
  '/api/cotizadores/comun/estadosCiviles': [opcion('S', 'SOLTERO/A'), opcion('C', 'CASADO/A'), opcion('D', 'DIVORCIADO/A'), opcion('V', 'VIUDO/A'), opcion('U', 'UNION CONVIVENCIAL')],
  '/api/cotizadores/comun/bancos': [opcion('7', 'BANCO DE GALICIA'), opcion('11', 'BANCO DE LA NACION ARGENTINA'), opcion('14', 'BANCO DE LA PROVINCIA DE BUENOS AIRES'), opcion('17', 'BBVA ARGENTINA'), opcion('72', 'BANCO SANTANDER'), opcion('285', 'BANCO MACRO')],
  '/api/cotizadores/comun/tarjetasDeCreditos': [opcion('VI', 'VISA'), opcion('MC', 'MASTERCARD'), opcion('AX', 'AMERICAN EXPRESS'), opcion('CA', 'CABAL'), opcion('NA', 'NARANJA')],
}

function cuotasDelModo(modo: string) {
  const meses = MESES_DEL_MODO[modo] ?? 1
  return [1, 3, 6, 12].filter((n) => n <= meses).map((n) => opcion(String(n).padStart(2, '0'), n === 1 ? '1 CUOTA' : `${n} CUOTAS`))
}

// --- La cartera de ejemplo (para Consultas, Cuenta Corriente y ART) ----------------------------------

interface PolizaDeEjemplo {
  numero: string
  rama: number
  tipo: TipoDeVehiculo
  tomador: string
  patente: string
  vehiculo: string
  cobertura: string
  suma: number
  premio: number
  emision: string
  desde: string
  hasta: string
  endoso: number
  /** Emitida en esta sesión: todavía no tiene cuotas vencidas ni cobradas. */
  deLaSesion?: boolean
  /** Anulada: no está vigente y no debe nada. */
  anulada?: boolean
}

/** Las pólizas de la cartera de ejemplo: las emitidas en esta sesión primero, después las inventadas. */
function carteraDeEjemplo(): PolizaDeEjemplo[] {
  return [...emitidasEnLaSesion(), ...carteraInventada()]
}

function emitidasEnLaSesion(): PolizaDeEjemplo[] {
  return emisionesDeLaSesionCon('GALENO').map((e) => ({
    numero: e.poliza,
    rama: RAMA_GALENO_DE_TIPO[e.tipo],
    tipo: e.tipo,
    tomador: e.tomador,
    patente: e.patente,
    vehiculo: e.vehiculo,
    cobertura: e.cobertura.toUpperCase(),
    suma: e.sumaAsegurada ?? 0,
    // La cartera inventada lleva premio mensual (las consultas lo multiplican por 12); el emitido es el
    // del período con que se cotizó.
    premio: redondear(e.premio / Math.max(1, e.meses)),
    emision: e.fecha,
    desde: e.desde,
    hasta: e.hasta,
    endoso: 0,
    deLaSesion: true,
  }))
}

/**
 * Las pólizas del legajo: las MISMAS que lista Emisiones del multicotizador para Galeno (las de los últimos
 * doce meses, que son las que siguen vigentes), con el mismo número, tomador, patente y fecha de emisión.
 */
function carteraInventada(): PolizaDeEjemplo[] {
  const hoy = fechaIso(new Date())
  return polizasInventadasDe('GALENO', { desde: sumarDias(hoy, -350), hasta: hoy, tipo: null })
    .map((p) => ({
      numero: p.poliza,
      rama: RAMA_GALENO_DE_TIPO[p.tipo],
      tipo: p.tipo,
      tomador: p.tomador,
      patente: p.patente,
      vehiculo: p.vehiculo,
      cobertura: p.cobertura.toUpperCase(),
      suma: p.suma,
      premio: p.premioMensual,
      emision: p.emision,
      desde: p.desde,
      hasta: p.hasta,
      endoso: enteroDe(`galeno:endoso:${p.poliza}`, 0, 3),
      anulada: p.estado === 'Anulada',
    }))
    // Lo más nuevo primero, como en Emisiones.
    .reverse()
}

/** La póliza o la patente que se pidió, si se pidió alguna (cada consulta llama distinto al campo). */
function filtrarCartera(cartera: PolizaDeEjemplo[], body: Cuerpo): PolizaDeEjemplo[] {
  const poliza = String(body.poliza ?? body.nroPoliza ?? '').trim()
  const patente = String(body.patente ?? '').replace(/\s/g, '').toUpperCase()
  return cartera.filter((p) => (!poliza || p.numero === poliza) && (!patente || p.patente === patente))
}

/** Cuántas cuotas ya vencieron: la primera vence el día que empieza la vigencia y después una por mes (hasta 12). */
function cuotasVencidas(p: PolizaDeEjemplo): number {
  const hoy = fechaIso(new Date())
  let n = 1
  while (n < 12 && sumarMeses(p.desde, n) <= hoy) n++
  return n
}

/** El vencimiento de la cuota `n`: parte de donde empieza la vigencia, así nunca es anterior a ella. */
function vencimientoDeCuota(p: PolizaDeEjemplo, n: number): string {
  return sumarMeses(p.desde, n - 1)
}

/**
 * Las que deben una cuota. Es UNA sola regla para «Cuotas impagas», el saldo vencido de «Pólizas
 * vigentes» y «Cuotas cobradas», así las tres consultas cuentan lo mismo. Sólo puede deber una la póliza
 * que ya pasó de la primera cuota, y la impaga es la última que venció (ya vencida, no la de hoy).
 */
function debeUnaCuota(p: PolizaDeEjemplo): boolean {
  if (p.deLaSesion || p.anulada) return false
  const vencidas = cuotasVencidas(p)
  return vencidas >= 2 && vencimientoDeCuota(p, vencidas) < fechaIso(new Date()) && hashDe(`impaga:${p.numero}`) % 4 === 0
}

/** El número de la cuota impaga: la última vencida. */
function cuotaImpaga(p: PolizaDeEjemplo): number {
  return cuotasVencidas(p)
}

function reporteDeConsultas(ruta: string, body: Cuerpo): unknown {
  const cartera = filtrarCartera(carteraDeEjemplo(), body)
  const hoy = fechaIso(new Date())
  const f = fechaArgentina
  switch (ruta) {
    case '/api/polizas/consultaXLegajo':
      return cartera.map((p) => ({
        nroPoliza: p.numero,
        tipoSeguro: 'AUT',
        rama: p.rama,
        nombreTomador: p.tomador,
        patente: p.patente,
        fecvigenciaDesde: f(p.desde),
        fecvigenciaHasta: f(p.hasta),
        fechaEmision: f(p.emision),
        estado: p.anulada ? 'A' : 'X',
      }))
    case '/api/polizas/obtenerPolizasRiesgo':
      // Los riesgos son de UNA póliza (en autos, uno por vehículo): sin número de póliza, los de la primera.
      return cartera.slice(0, 1).map((p) => ({
        numRiesgo: 1,
        descRiesgo: p.vehiculo,
        patente: p.patente,
        desCobertura: p.cobertura,
        valorAsegurado: p.suma,
        nombreAsegurado: p.tomador,
        vigDesde: f(p.desde),
        vigHasta: f(p.hasta),
      }))
    case '/api/polizas/autos/detalleProduccion':
      return cartera.map((p) => ({
        poliza: p.numero,
        endoso: p.endoso,
        tipoEndoso: p.endoso === 0 ? 'EMISION' : 'MODIFICACION',
        nombreTomador: p.tomador,
        patenteVehiculo: p.patente,
        coberturaRiesgo: p.cobertura,
        premioPoliza: redondear(p.premio * 12),
        fechaEmisionEndoso: f(p.emision),
        fechaIniVigPoliza: f(p.desde),
        fechaFinVigPoliza: f(p.hasta),
      }))
    case '/api/polizas/cuotasImpagas':
      return cartera.filter(debeUnaCuota).map((p) => ({
        poliza: p.numero,
        nroCuota: cuotaImpaga(p),
        tomador: p.tomador,
        fechaVtoAsegurado: f(vencimientoDeCuota(p, cuotaImpaga(p))),
        saldoCuota: p.premio,
        estadoPoliza: 'VIGENTE',
      }))
    case '/api/polizas/cuotasCobradas':
      // La última cobrada: la última que venció, o la anterior en las que deben una (la impaga).
      return cartera
        .filter((p) => !p.deLaSesion && !p.anulada)
        .map((p) => {
          const nroCuota = debeUnaCuota(p) ? cuotaImpaga(p) - 1 : cuotasVencidas(p)
          const vencimiento = vencimientoDeCuota(p, nroCuota)
          const cobro = sumarDias(vencimiento, enteroDe(`cobro:${p.numero}`, 0, 4))
          return {
            poliza: p.numero,
            nroCuota,
            tomador: p.tomador,
            fechaVencimientoCuota: f(vencimiento),
            premioCobradoCuota: p.premio,
            formaPagoCuota: unoDe(`forma:${p.numero}`, ['TARJETA DE CREDITO', 'DEBITO EN CUENTA', 'EFECTIVO']),
            // Se cobra a los pocos días del vencimiento, y nunca en el futuro.
            fechaContableImputacion: f(cobro > hoy ? hoy : cobro),
          }
        })
    case '/api/polizas/vigentes':
      return cartera.filter((p) => !p.anulada).map((p) => ({
        poliza: p.numero,
        descRama: p.tipo === 'MOTO' ? 'MOTOS' : 'AUTOMOTORES',
        tomador: p.tomador,
        nombreAsegurado: p.tomador,
        sumaAsegurada: p.suma,
        sumaPremios: redondear(p.premio * 12),
        sumaSaldoVencido: debeUnaCuota(p) ? p.premio : 0,
      }))
    case '/api/polizas/obtenerModificacionesEndosos':
      return cartera
        .filter((p) => p.endoso > 0)
        .map((p) => ({
          poliza: p.numero,
          endoso: p.endoso,
          desc_tipo_modificacion: unoDe(`endoso:${p.numero}`, ['CAMBIO DE DOMICILIO', 'CAMBIO DE FORMA DE PAGO', 'AUMENTO DE SUMA ASEGURADA', 'CAMBIO DE COBERTURA']),
          nombre_asegurado: p.tomador,
          patente_vehiculo: p.patente,
          premio: p.premio,
          fecha_emision_movimiento: f(sumarDias(p.emision, 30 * p.endoso)),
        }))
    case '/api/comisiones/consultaCuentaCorriente':
      return Array.from({ length: 6 }, (_, i) => {
        const mes = sumarMeses(fechaIso(new Date()), -i - 1)
        const importe = redondear(850_000 + enteroDe(`cc:${i}`, 0, 600_000))
        return {
          mesLiquidacion: mes.slice(0, 7),
          importe,
          retencionIVA: redondear(importe * 0.105),
          nroFactura: `0003-${String(10_450 + 6 - i).padStart(8, '0')}`,
          tipoFactura: 'A',
          descConcepto: 'COMISIONES AUTOMOTORES',
          fechaFactura: f(sumarDias(mes.slice(0, 8) + '05', 0)),
        }
      })
    case '/api/comisiones/detalleCuentaCorriente':
      return cartera.map((p) => ({
        contratoOPoliza: p.numero,
        clienteORazonSocial: p.tomador,
        fechaUltimaCobranza: f(sumarDias(fechaIso(new Date()), -enteroDe(`cobro:${p.numero}`, 1, 30))),
        importeCobranzas: p.premio,
        comisionProductor: redondear(p.premio * 0.18),
        razonSocialProductor: 'AGENCIA DE DEMOSTRACION',
      }))
    case '/api/polizas/detalle': {
      const p = cartera[0]
      if (!p) return null
      return { poliza: p.numero, rama: p.rama, tomador: p.tomador, vehiculo: p.vehiculo, patente: p.patente, cobertura: p.cobertura, sumaAsegurada: p.suma, vigenciaDesde: f(p.desde), vigenciaHasta: f(p.hasta), demo: true }
    }
    default:
      return null
  }
}

function csvDeArt(): string {
  const encabezado = 'IDASEGURADORA;FCOBRO;CONTRATO;CONTRATO_ANTERIOR;CODPROD;NOMPROD;CUITCLI;NOMCLI;PREMIO;IMPCOB;PRIMA;PORCOMIS;IMPCOMIS;POR13;IMP13;PERSONAS;MASASAL;PROVINCIA;PERIODO;ALICUOTAFIJA;ALICUOTAVARIABLE;ENDOSO;OBSERVACIONES;CIUU'
  const filas = Array.from({ length: 5 }, (_, i) => {
    const semilla = `art:${i}`
    const personas = enteroDe(`${semilla}:personas`, 3, 40)
    const masa = personas * 1_150_000
    const premio = redondear(masa * 0.041)
    return [
      'GALENO ART',
      fechaArgentina(sumarDias(fechaIso(new Date()), -enteroDe(`${semilla}:cobro`, 1, 25))),
      String(250_000 + i * 37),
      '',
      LEGAJO_DE_LA_DEMO,
      'AGENCIA DE DEMOSTRACION',
      `30${String(hashDe(semilla) % 100_000_000).padStart(8, '0')}9`,
      unoDe(semilla, ['METALURGICA DEL SUR SRL', 'PANADERIA LA ESPIGA SA', 'TRANSPORTES NORTE SRL', 'CLINICA SAN MARTIN SA', 'FERRETERIA EL TORNILLO SRL']),
      premio,
      premio,
      redondear(premio * 0.9),
      '8',
      redondear(premio * 0.08),
      '0',
      '0',
      personas,
      masa,
      'BUENOS AIRES',
      fechaIso(new Date()).slice(0, 7).replace('-', ''),
      '1500',
      '3,1',
      '0',
      '',
      unoDe(`${semilla}:ciuu`, ['259999', '107121', '492299', '861010', '475300']),
    ].join(';')
  })
  return [encabezado, ...filas].join('\n')
}

// --- La impresión: un PDF de verdad, de una hoja, que dice que es de demostración ---------------------
//
// Armado a mano (no hay ventana con la que imprimir un HTML: esto corre también en las pruebas), pero con
// lo que trae una póliza —tomador, vehículo, patente, cobertura, vigencia, premio—, con tildes y con una
// marca de agua «DEMOSTRACIÓN» que no deja dudas.

/** Las letras de Windows-1252 que no están en Latin-1 y que pueden aparecer en un texto. */
const WIN_ANSI: Record<string, number> = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80 }

/** Un texto para un string de PDF: ASCII tal cual y el resto como octal de WinAnsi, así cada carácter del archivo es un byte. */
function textoPdf(texto: string): string {
  let salida = ''
  for (const letra of texto) {
    const codigo = letra.codePointAt(0)!
    if (letra === '\\' || letra === '(' || letra === ')') salida += `\\${letra}`
    else if (codigo >= 0x20 && codigo <= 0x7e) salida += letra
    else {
      const byte = WIN_ANSI[letra] ?? (codigo >= 0xa0 && codigo <= 0xff ? codigo : 0x3f)
      salida += `\\${byte.toString(8).padStart(3, '0')}`
    }
  }
  return salida
}

interface Renglon {
  texto: string
  x: number
  y: number
  tamano?: number
  negrita?: boolean
  /** 0 negro … 1 blanco. */
  gris?: number
}

/** Un PDF de una página A4 (Helvetica) con los renglones y los trazos dados. */
function pdfDeDemostracion(renglones: Renglon[], trazos: string): string {
  const texto = renglones
    .map((r) => `BT ${r.gris ?? 0} g /${r.negrita ? 'F2' : 'F1'} ${r.tamano ?? 10} Tf ${r.x} ${r.y} Td (${textoPdf(r.texto)}) Tj ET`)
    .join('\n')
  // La marca de agua va primero, para que el texto le quede encima.
  const marca = `q BT 0.91 g /F2 70 Tf 0.766 0.643 -0.643 0.766 95 150 Tm (${textoPdf('DEMOSTRACIÓN')}) Tj ET Q`
  const contenido = `${marca}\n${trazos}\n${texto}`
  const fuente = (nombre: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${nombre} /Encoding /WinAnsiEncoding >>`
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    fuente('Helvetica'),
    fuente('Helvetica-Bold'),
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones: number[] = []
  objetos.forEach((objeto, i) => {
    posiciones.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${objeto}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

const DOCUMENTO: Record<string, string> = { P: 'Póliza', C: 'Certificado de cobertura', M: 'Certificado Mercosur' }

function pesos(monto: number): string {
  return `$ ${monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** La póliza que se pidió imprimir: la de la cartera (o la recién emitida); si no está, una armada con su número. */
function polizaParaImprimir(numero: string, rama: number): PolizaDeEjemplo {
  const encontrada = carteraDeEjemplo().find((p) => p.numero === numero)
  if (encontrada) return encontrada
  const tipo: TipoDeVehiculo = rama === RAMA_GALENO_DE_TIPO.MOTO ? 'MOTO' : 'AUTO'
  const semilla = `galeno:impresion:${numero}`
  const ejemplo = unoDe(semilla, VEHICULOS_DE_EJEMPLO.filter((v) => v.tipo === tipo))
  const anio = anioDeEjemplo(`${semilla}:anio`, ejemplo)
  const suma = valorEstimado(ejemplo.tipo, ejemplo.marca, ejemplo.modelo, ejemplo.version, anio)
  const emision = sumarDias(fechaIso(new Date()), -enteroDe(`${semilla}:emision`, 3, 200))
  return {
    numero: numero || '4000000',
    rama: RAMA_GALENO_DE_TIPO[tipo],
    tipo,
    tomador: personaDe(semilla),
    patente: patenteDe(semilla, anio, tipo),
    vehiculo: `${ejemplo.marca} ${ejemplo.modelo} ${ejemplo.version} ${anio}`,
    cobertura: 'TERCEROS COMPLETO',
    suma,
    premio: redondear(suma * 0.0062 + 30_000),
    emision,
    desde: emision,
    hasta: sumarMeses(emision, 12),
    endoso: 0,
  }
}

function pdfDePoliza(cuerpo: Cuerpo): string {
  const que = DOCUMENTO[String(cuerpo.tipoImpresion)] ?? 'Documento'
  const p = polizaParaImprimir(String(cuerpo.poliza ?? '').trim(), Number(cuerpo.rama))
  const legajo = String(cuerpo.legajo ?? LEGAJO_DE_LA_DEMO)
  const f = fechaArgentina
  const renglones: Renglon[] = [
    { texto: 'GALENO SEGUROS', x: 56, y: 800, tamano: 18, negrita: true, gris: 1 },
    { texto: `${que} · Seguro de ${p.tipo === 'MOTO' ? 'motovehículos' : 'automotores'}`, x: 56, y: 782, tamano: 11, gris: 1 },
    { texto: `Nº ${p.numero}`, x: 430, y: 800, tamano: 16, negrita: true, gris: 1 },
    { texto: `Rama ${p.rama} · Endoso ${p.endoso}`, x: 430, y: 782, tamano: 10, gris: 1 },
  ]
  let y = 730
  /** Cada fila, uno o dos campos (etiqueta y valor); uno solo ocupa todo el ancho. */
  const seccion = (titulo: string, filas: Array<Array<[string, string]>>) => {
    renglones.push({ texto: titulo.toUpperCase(), x: 56, y, tamano: 9, negrita: true, gris: 0.35 })
    y -= 20
    for (const campos of filas) {
      for (const [j, [etiqueta, valor]] of campos.entries()) {
        const x = j === 0 ? 56 : 330
        renglones.push({ texto: etiqueta, x, y, tamano: 8, gris: 0.45 })
        renglones.push({ texto: valor || '—', x, y: y - 13, tamano: 11 })
      }
      y -= 34
    }
    y -= 12
  }
  seccion('Tomador / asegurado', [
    [
      ['Apellido y nombre', p.tomador],
      ['Productor', `Legajo ${legajo} · Agencia de demostración`],
    ],
  ])
  seccion('Vehículo asegurado', [
    [['Marca, modelo, versión y año', p.vehiculo]],
    [
      ['Patente', p.patente],
      ['Uso', 'Particular'],
    ],
    [['Suma asegurada', p.suma ? pesos(p.suma) : '']],
  ])
  seccion('Cobertura y vigencia', [
    [['Cobertura', p.cobertura]],
    [
      ['Vigencia', `Del ${f(p.desde)} al ${f(p.hasta)}, a las 12 hs`],
      ['Fecha de emisión', f(p.emision)],
    ],
    [['Premio', pesos(p.premio)]],
  ])
  renglones.push(
    { texto: 'DOCUMENTO DE DEMOSTRACIÓN', x: 56, y: 110, tamano: 10, negrita: true, gris: 0.2 },
    { texto: 'Lo generó la versión de demostración de DM Gestión con datos inventados: no es una póliza real', x: 56, y: 94, tamano: 9, gris: 0.3 },
    { texto: 'ni tiene validez ante Galeno Seguros ni ante ninguna otra compañía.', x: 56, y: 81, tamano: 9, gris: 0.3 },
    { texto: `Impreso el ${f(fechaIso(new Date()))}.`, x: 56, y: 62, tamano: 8, gris: 0.45 },
  )
  // La franja de arriba y las líneas que separan las secciones.
  const trazos = ['q 0.09 0.27 0.49 rg 0 762 595 80 re f Q', 'q 0.8 G 0.6 w 56 125 m 539 125 l S Q'].join('\n')
  return pdfDeDemostracion(renglones, trazos)
}

// --- El cliente ----------------------------------------------------------------------------------------

type Cuerpo = Record<string, unknown>

function cotizar(body: Cuerpo): Cuerpo {
  const rama = Number(body.rama)
  const tipo: TipoDeVehiculo = rama === RAMA_GALENO_DE_TIPO.MOTO ? 'MOTO' : 'AUTO'
  const anio = Number(body.anioFabricacion) || new Date().getFullYear()
  const encontrado = modeloDe(String(body.marcaCodigo ?? ''), String(body.modeloCodigo ?? ''))
  const marca = encontrado?.marca.nombre ?? 'VEHICULO'
  const modelo = encontrado?.modelo.nombre ?? 'GENERICO'
  const versiones = encontrado?.modelo.versiones ?? []
  const version = (versiones[Number(body.subModeloCodigo ?? 1) - 1] ?? versiones[0])?.texto ?? 'BASE'
  const modo = String(body.modoFacturacionCodigo ?? 'M')
  const meses = MESES_DEL_MODO[modo] ?? 1
  const cuotas = Math.min(meses, Math.max(1, Number(body.condicionPagoCodigo) || 1))
  const forma = FORMAS_DE_PAGO.find((f) => f.codigo === String(body.formaPagoCodigo))?.medio ?? 'TARJETA'
  const uso = USOS.find((u) => String(u.codigoUsoVehiculo) === String(body.tipoUso ?? ''))?.uso ?? 'PARTICULAR'
  const solicitud = Number(`9${String(hashDe(JSON.stringify(body)) % 10_000_000).padStart(7, '0')}`)
  const coberturas = coberturasDeGalenoDemo({
    tipo,
    marca,
    modelo,
    version,
    anio,
    ceroKm: body.ceroKM === 'S',
    sumaAsegurada: typeof body.sumaAsegurada === 'number' ? body.sumaAsegurada : null,
    codigoPostal: String(body.codigoPostal ?? ''),
    uso,
    rastreo: body.poseeEquipoRastreo === '2',
    gnc: body.poseeEquipoGNC === '2',
    valorGnc: typeof body.accesorio1Valor === 'number' ? body.accesorio1Valor : 0,
    meses,
    cuotas,
    formaDePago: forma,
    bonificacion: body.modificarBonificacion === 'S' ? Number(body.bonificacionPorc) || 0 : null,
    clausula: Number(body.clausulaAjusteCodigo ?? 10) || 0,
    planCodigo: String(body.planComercialCodigo ?? ''),
    juridica: Number(body.tomadorTipoPersona) === 2,
  })
  const descripcionVehiculo = `${marca} ${modelo} ${version} ${body.ceroKM === 'S' ? '0 KM' : anio}`
  anotarCotizacionDeLaSesion('GALENO', {
    numero: String(solicitud),
    tipo,
    tomador: String(body.tomadorNombre ?? ''),
    vehiculo: descripcionVehiculo,
    sumaAsegurada: typeof body.sumaAsegurada === 'number' ? body.sumaAsegurada : valorEstimado(tipo, marca, modelo, version, anio),
    vigenciaDesde: fechaIsoDeGaleno(String(body.vigenciaDesde ?? '')),
    coberturas: coberturas.map((c) => ({ codigo: c.cobertura, nombre: c.descripcionCobertura, premio: c.premio, impuestos: c.impuestos })),
    meses,
  })
  return {
    rama,
    solicitud,
    instalacion: 1,
    descripcionVehiculo,
    coberturas,
    excepciones: [],
    errores: [],
    demo: 'Respuesta simulada por la versión de demostración: no se consultó a Galeno.',
  }
}

/** dd/mm/aaaa (como la pide Galeno al cotizar) → aaaa-mm-dd; vacío si no es una fecha. */
function fechaIsoDeGaleno(fecha: string): string {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha.trim())
  return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(fecha.trim()) ? fecha.trim() : ''
}

function emitir(body: Cuerpo, conInspeccion: boolean): Cuerpo {
  const solicitud = Number(body.solicitud)
  const cobertura = String(body.cobertura ?? '')
  const cotizado = cotizadoEnLaSesion('GALENO', String(solicitud), cobertura)
  const premio = cotizado?.premio ?? 95_000
  const rama = Number(body.rama) || RAMA_GALENO_DE_TIPO.AUTO
  const poliza = Number(`4${String(hashDe(`poliza:${solicitud}:${cobertura}`) % 1_000_000).padStart(6, '0')}`)
  const tomador = body.tomador && typeof body.tomador === 'object' ? (body.tomador as Cuerpo) : {}
  const vehiculo = body.vehiculo && typeof body.vehiculo === 'object' ? (body.vehiculo as Cuerpo) : {}
  // Queda en la sesión: aparece en Emisiones del multicotizador, en las consultas y en «Imprimir».
  anotarEmisionDeLaSesion('GALENO', {
    poliza: String(poliza),
    numeroDeCotizacion: String(solicitud),
    cobertura,
    tomador: String(tomador.nombre ?? ''),
    patente: String(vehiculo.patente ?? ''),
    premio,
    tipo: rama === RAMA_GALENO_DE_TIPO.MOTO ? 'MOTO' : 'AUTO',
  })
  return {
    idServicioEmision: enteroDe(`emision:${solicitud}`, 100_000, 999_999),
    rama,
    poliza,
    endoso: 0,
    estadoSolicitud: 'E',
    impuestos: cotizado?.impuestos ?? redondear(premio * 0.19),
    premio,
    excepciones: [],
    errores: [],
    // Con inspección, Galeno devuelve el enlace donde se hace; en la demo no hay a dónde mandarlo.
    urlInspeccion: null,
    observacionesInspeccion: conInspeccion ? 'Inspección de demostración: no hace falta hacerla.' : null,
  }
}

function contestar(ruta: string, body: Cuerpo): unknown {
  const [camino = '', consulta = ''] = ruta.split('?')
  if (camino in LISTAS_FIJAS) return LISTAS_FIJAS[camino]

  if (camino === '/api/administracion/usuario/planes/comerciales' || camino.startsWith('/api/administracion/usuario/planes/comercialesXRamaLegajo/')) {
    const rama = Number(new URLSearchParams(consulta).get('rama') ?? camino.split('/').at(-2))
    const tipo: TipoDeVehiculo = rama === RAMA_GALENO_DE_TIPO.MOTO ? 'MOTO' : 'AUTO'
    return planesDeGalenoDemo(tipo).map((plan) => ({ codPlanComercial: plan.codigo, productorCodigo: LEGAJO_DE_LA_DEMO, codRama: String(rama), descripcionPlanComercial: plan.texto }))
  }
  if (camino === '/api/cotizadores/auto/marcas') {
    const rama = Number(new URLSearchParams(consulta).get('rama'))
    return MARCAS[rama === RAMA_GALENO_DE_TIPO.MOTO ? 'MOTO' : 'AUTO'].map((m) => opcion(m.codigo, m.nombre))
  }
  let partes = /^\/api\/cotizadores\/auto\/modelos\/([^/]+)$/.exec(camino)
  if (partes) {
    const marca = todasLasMarcas().find((m) => m.codigo === decodeURIComponent(partes![1]!))
    return (marca?.modelos ?? []).map((modelo, i) => opcion(`${marca!.codigo}${String(i + 1).padStart(2, '0')}`, modelo.nombre))
  }
  partes = /^\/api\/cotizadores\/auto\/anios\/([^/]+)\/([^/]+)$/.exec(camino)
  if (partes) {
    // Sólo los años en que se fabricó ese modelo; el de los que se siguen fabricando llega al año que viene.
    const encontrado = modeloDe(decodeURIComponent(partes[1]!), decodeURIComponent(partes[2]!))
    if (!encontrado) return []
    const tope = new Date().getFullYear() + 1
    const hasta = Math.min(encontrado.modelo.hasta ?? tope, tope)
    return Array.from({ length: Math.max(0, hasta - encontrado.modelo.desde + 1) }, (_, i) => String(hasta - i)).map((anio) => opcion(anio, anio))
  }
  partes = /^\/api\/cotizadores\/auto\/submodelos\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(camino)
  if (partes) {
    const encontrado = modeloDe(decodeURIComponent(partes[1]!), decodeURIComponent(partes[2]!))
    if (!encontrado) return []
    const disponibles = versionesDelAnio(encontrado.modelo, Number(decodeURIComponent(partes[3]!)))
    // El código de la versión es su lugar en la lista completa del modelo, no en la del año.
    return disponibles.map((version) => ({
      version: `${encontrado.modelo.nombre} ${version.texto}`,
      codigoMarca: Number(encontrado.marca.codigo),
      codigoModelo: Number(decodeURIComponent(partes![2]!)),
      codigoSubModelo: encontrado.modelo.versiones.indexOf(version) + 1,
    }))
  }
  partes = /^\/api\/cotizadores\/comun\/codigoPostal\/(\d+)\/([^/]+)$/.exec(camino)
  if (partes) {
    const cp = decodeURIComponent(partes[2]!).replace(/\D/g, '').slice(0, 4)
    const localidades = localidadesDeEjemplo(cp)
    const lista = localidades.length > 0 ? localidades.map((l) => l.localidad) : cp.length === 4 ? [`LOCALIDAD DEL CP ${cp}`] : []
    return lista.map((localidad, i) => ({ codigoRama: partes![1], codigoPostal: cp, subCodigoPostal: String(i + 1), localidad }))
  }
  if (camino === '/api/cotizadores/comun/modosDeFacturacion') return MODOS
  if (camino === '/api/cotizadores/comun/condicionesDePago') return cuotasDelModo(String(body.modoFacturacion ?? 'M'))
  if (camino === '/api/cotizadores/comun/formasDePago') return FORMAS_DE_PAGO.map(({ codigo, descripcion }) => opcion(codigo, descripcion))
  if (camino === '/api/cotizadores/auto/adicionalesGranizo') return [opcion('G1', 'GRANIZO HASTA $ 1.500.000'), opcion('G2', 'GRANIZO SIN TOPE')]
  if (camino === '/api/cotizadores/auto/coberturas') return []
  if (camino === '/api/cotizadores/auto/cotizar') return cotizar(body)
  if (camino === '/api/emisores/auto/emitir') return emitir(body, false)
  if (camino === '/api/emisores/auto/emitirConInspeccion') return emitir(body, true)
  return reporteDeConsultas(camino, body)
}

/** Un `ClienteGaleno` que no sale a ningún lado: contesta como Galeno, después de lo que tardaría Galeno. */
export function clienteGalenoDeLaDemo(): ClienteGaleno {
  return {
    async pedirJson<T>(ruta: string, opciones: { metodo?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
      const cuerpo = (opciones.body && typeof opciones.body === 'object' ? opciones.body : {}) as Cuerpo
      const esCotizarOEmitir = /\/(cotizar|emitir|emitirConInspeccion)$/.test(ruta)
      await esperarComoLaApi(esCotizarOEmitir ? 800 : 120, esCotizarOEmitir ? 1600 : 400)
      return contestar(ruta, cuerpo) as T
    },
    async pedirCrudo(ruta: string, opciones: { metodo?: 'GET' | 'POST'; body?: unknown } = {}): Promise<Response> {
      const cuerpo = (opciones.body && typeof opciones.body === 'object' ? opciones.body : {}) as Cuerpo
      await esperarComoLaApi(400, 1200)
      if (ruta.startsWith('/api/contrato/listaContratosART')) {
        return new Response(csvDeArt(), { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      }
      if (ruta.startsWith('/api/imprimir')) {
        return new Response(pdfDePoliza(cuerpo), { status: 200, headers: { 'content-type': 'application/pdf' } })
      }
      return new Response(JSON.stringify(contestar(ruta, cuerpo)), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }
}
