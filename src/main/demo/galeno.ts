// El cliente de Galeno de la versión de demostración: contesta cada ruta de su API REST con datos
// inventados, con la MISMA forma cruda que devuelve Galeno. Todo lo de `aseguradoras/galeno/*`
// (catálogos, cotizar, emitir, consultas, cuenta corriente, ART, imprimir) lo usa sin enterarse, así que
// en la demo andan igual API Aseguradoras → Galeno, «Cotizar con Galeno» de Presupuestos y la emisión
// desde el multicotizador. Ver `cliente()` en servicios/galeno.ts, que es donde se enchufa.
import { RAMA_GALENO_DE_TIPO, type TipoDeVehiculo } from '../../shared/tipos'
import type { MedioDePago, UsoDelVehiculo } from '../../shared/multicotizador'
import type { ClienteGaleno } from '../aseguradoras/galeno/cliente'
import { anotarCotizacionDeGalenoDemo, coberturasDeGalenoDemo, cotizadoEnGalenoDemo, planesDeGalenoDemo, valorEstimado } from './aseguradoras'
import {
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

const MARCAS: Record<TipoDeVehiculo, Array<{ codigo: string; nombre: string; modelos: string[] }>> = {
  AUTO: [
    { codigo: '46', nombre: 'VOLKSWAGEN', modelos: ['GOL TREND', 'POLO', 'AMAROK', 'TAOS'] },
    { codigo: '23', nombre: 'FORD', modelos: ['KA', 'FOCUS', 'RANGER', 'TERRITORY'] },
    { codigo: '12', nombre: 'CHEVROLET', modelos: ['ONIX', 'CRUZE', 'S10', 'TRACKER'] },
    { codigo: '21', nombre: 'FIAT', modelos: ['ARGO', 'CRONOS', 'STRADA', 'TORO'] },
    { codigo: '51', nombre: 'TOYOTA', modelos: ['ETIOS', 'YARIS', 'COROLLA', 'HILUX'] },
    { codigo: '40', nombre: 'PEUGEOT', modelos: ['208', '2008', '308', 'PARTNER'] },
    { codigo: '44', nombre: 'RENAULT', modelos: ['SANDERO', 'LOGAN', 'DUSTER', 'KANGOO'] },
  ],
  MOTO: [
    { codigo: '30', nombre: 'HONDA', modelos: ['WAVE', 'CB 190R', 'XR 150L'] },
    { codigo: '57', nombre: 'YAMAHA', modelos: ['YBR 125', 'FZ', 'XTZ 250'] },
    { codigo: '70', nombre: 'MOTOMEL', modelos: ['BLITZ', 'SKUA 150'] },
    { codigo: '71', nombre: 'CORVEN', modelos: ['ENERGY', 'TRIAX 150'] },
  ],
}

const VERSIONES: Record<TipoDeVehiculo, string[]> = { AUTO: ['BASE', 'INTERMEDIA', 'FULL'], MOTO: ['STD', 'FULL'] }

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
}

function carteraDeEjemplo(): PolizaDeEjemplo[] {
  const hoy = fechaIso(new Date())
  return Array.from({ length: 24 }, (_, i) => {
    const semilla = `galeno:cartera:${i}`
    const ejemplo = VEHICULOS_DE_EJEMPLO[i % VEHICULOS_DE_EJEMPLO.length]!
    const anio = enteroDe(`${semilla}:anio`, 2010, new Date().getFullYear())
    const suma = valorEstimado(ejemplo.tipo, ejemplo.marca, ejemplo.modelo, ejemplo.version, anio)
    const emision = sumarDias(hoy, -enteroDe(`${semilla}:emision`, 3, 330))
    return {
      numero: `4${String(hashDe(semilla) % 1_000_000).padStart(6, '0')}`,
      rama: RAMA_GALENO_DE_TIPO[ejemplo.tipo],
      tipo: ejemplo.tipo,
      tomador: personaDe(semilla),
      patente: patenteDe(semilla, anio, ejemplo.tipo),
      vehiculo: `${ejemplo.marca} ${ejemplo.modelo} ${ejemplo.version} ${anio}`,
      cobertura: unoDe(`${semilla}:cobertura`, ['RESPONSABILIDAD CIVIL', 'TERCEROS COMPLETO', 'TERCEROS COMPLETO PLUS C/ GRANIZO', 'TODO RIESGO C/ FRANQUICIA']),
      suma,
      premio: redondear(suma * (0.005 + enteroDe(`${semilla}:tasa`, 0, 60) / 10_000) + 30_000),
      emision,
      desde: emision,
      hasta: sumarMeses(emision, 12),
      endoso: enteroDe(`${semilla}:endoso`, 0, 3),
    }
  })
}

function reporteDeConsultas(ruta: string): unknown {
  const cartera = carteraDeEjemplo()
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
        estado: 'X',
      }))
    case '/api/polizas/obtenerPolizasRiesgo':
      return cartera.slice(0, 6).map((p, i) => ({
        numRiesgo: i + 1,
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
        premioPoliza: p.premio * 12,
        fechaEmisionEndoso: f(p.emision),
        fechaIniVigPoliza: f(p.desde),
        fechaFinVigPoliza: f(p.hasta),
      }))
    case '/api/polizas/cuotasImpagas':
      return cartera
        .filter((p) => hashDe(`impaga:${p.numero}`) % 4 === 0)
        .map((p) => ({
          poliza: p.numero,
          nroCuota: enteroDe(`cuota:${p.numero}`, 2, 11),
          tomador: p.tomador,
          fechaVtoAsegurado: f(sumarDias(fechaIso(new Date()), -enteroDe(`vto:${p.numero}`, 1, 40))),
          saldoCuota: p.premio,
          estadoPoliza: 'VIGENTE',
        }))
    case '/api/polizas/cuotasCobradas':
      return cartera.map((p) => ({
        poliza: p.numero,
        nroCuota: enteroDe(`cuota:${p.numero}`, 1, 10),
        tomador: p.tomador,
        fechaVencimientoCuota: f(sumarDias(fechaIso(new Date()), -enteroDe(`cobro:${p.numero}`, 1, 30))),
        premioCobradoCuota: p.premio,
        formaPagoCuota: unoDe(`forma:${p.numero}`, ['TARJETA DE CREDITO', 'DEBITO EN CUENTA', 'EFECTIVO']),
        fechaContableImputacion: f(sumarDias(fechaIso(new Date()), -enteroDe(`imputa:${p.numero}`, 0, 25))),
      }))
    case '/api/polizas/vigentes':
      return cartera.map((p) => ({
        poliza: p.numero,
        descRama: p.tipo === 'MOTO' ? 'MOTOS' : 'AUTOMOTORES',
        tomador: p.tomador,
        nombreAsegurado: p.tomador,
        sumaAsegurada: p.suma,
        sumaPremios: p.premio * 12,
        sumaSaldoVencido: hashDe(`saldo:${p.numero}`) % 5 === 0 ? p.premio : 0,
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
      const p = cartera[0]!
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

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Un PDF mínimo (Helvetica, una página) armado a mano: alcanza para que se abra en cualquier visor. */
function pdfDeDemostracion(lineas: string[]): string {
  // Sólo ASCII: así cada carácter es un byte y las posiciones de la tabla xref dan justo.
  const escapar = (texto: string) =>
    sinTildes(texto)
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[\\()]/g, (c) => `\\${c}`)
  const contenido = lineas.map((linea, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${780 - i * 22} Td (${escapar(linea)}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
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

const DOCUMENTO: Record<string, string> = { P: 'Poliza', C: 'Certificado de cobertura', M: 'Certificado Mercosur' }

// --- El cliente ----------------------------------------------------------------------------------------

type Cuerpo = Record<string, unknown>

function cotizar(body: Cuerpo): Cuerpo {
  const rama = Number(body.rama)
  const tipo: TipoDeVehiculo = rama === RAMA_GALENO_DE_TIPO.MOTO ? 'MOTO' : 'AUTO'
  const anio = Number(body.anioFabricacion) || new Date().getFullYear()
  const encontrado = modeloDe(String(body.marcaCodigo ?? ''), String(body.modeloCodigo ?? ''))
  const marca = encontrado?.marca.nombre ?? 'VEHICULO'
  const modelo = encontrado?.modelo ?? 'GENERICO'
  const version = VERSIONES[tipo][Number(body.subModeloCodigo ?? 1) - 1] ?? VERSIONES[tipo][0]!
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
  anotarCotizacionDeGalenoDemo(
    solicitud,
    coberturas.map((c) => ({ codigo: c.cobertura, premio: c.premio, impuestos: c.impuestos })),
  )
  return {
    rama,
    solicitud,
    instalacion: 1,
    descripcionVehiculo: `${marca} ${modelo} ${version} ${body.ceroKM === 'S' ? '0 KM' : anio}`,
    coberturas,
    excepciones: [],
    errores: [],
    demo: 'Respuesta simulada por la versión de demostración: no se consultó a Galeno.',
  }
}

function emitir(body: Cuerpo, conInspeccion: boolean): Cuerpo {
  const solicitud = Number(body.solicitud)
  const cotizado = cotizadoEnGalenoDemo(solicitud, String(body.cobertura ?? ''))
  const premio = cotizado?.premio ?? 95_000
  return {
    idServicioEmision: enteroDe(`emision:${solicitud}`, 100_000, 999_999),
    rama: Number(body.rama) || RAMA_GALENO_DE_TIPO.AUTO,
    poliza: Number(`4${String(hashDe(`poliza:${solicitud}:${String(body.cobertura)}`) % 1_000_000).padStart(6, '0')}`),
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
    return (marca?.modelos ?? []).map((modelo, i) => opcion(`${marca!.codigo}${String(i + 1).padStart(2, '0')}`, modelo))
  }
  partes = /^\/api\/cotizadores\/auto\/anios\/([^/]+)\/([^/]+)$/.exec(camino)
  if (partes) {
    const hasta = new Date().getFullYear() + 1
    return Array.from({ length: hasta - 2005 + 1 }, (_, i) => String(hasta - i)).map((anio) => opcion(anio, anio))
  }
  partes = /^\/api\/cotizadores\/auto\/submodelos\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(camino)
  if (partes) {
    const encontrado = modeloDe(decodeURIComponent(partes[1]!), decodeURIComponent(partes[2]!))
    if (!encontrado) return []
    return VERSIONES[encontrado.marca.tipo].map((version, i) => ({
      version: `${encontrado.modelo} ${version}`,
      codigoMarca: Number(encontrado.marca.codigo),
      codigoModelo: Number(decodeURIComponent(partes![2]!)),
      codigoSubModelo: i + 1,
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
  return reporteDeConsultas(camino)
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
        const que = DOCUMENTO[String(cuerpo.tipoImpresion)] ?? 'Documento'
        const pdf = pdfDeDemostracion([
          `Galeno Seguros - ${que} (DEMOSTRACION)`,
          `Poliza N ${String(cuerpo.poliza ?? '')} - Rama ${String(cuerpo.rama ?? '')}`,
          `Legajo del productor: ${String(cuerpo.legajo ?? LEGAJO_DE_LA_DEMO)}`,
          `Emitido el ${fechaArgentina(fechaIso(new Date()))}`,
          '',
          'Este documento lo genero la version de demostracion de DM Gestion.',
          'No es una poliza real ni tiene validez ante ninguna compania.',
        ])
        return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } })
      }
      return new Response(JSON.stringify(contestar(ruta, cuerpo)), { status: 200, headers: { 'content-type': 'application/json' } })
    },
  }
}
