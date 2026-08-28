// Contenido de la hoja de prueba: replica la estructura de la hoja real «GENERAL DE CLIENTES».
//
//  - Planillas mensuales DICIEMBRE25, ENERO … AGOSTO, cada una con SUS COLUMNAS EN OTRO ORDEN
//    (en ENERO el vehículo arranca en la columna R; en FEBRERO, en la O) y con variantes de encabezado
//    («LOCAL»/«SUCURSAL», «OB. DE COBERTURAS»/«OBS», «D.N.I.»/«DNI / CUIT», «N° PÓLIZA»/«NRO DE POLIZA»).
//  - Sus pestañas de «BAJAS».
//  - AMP, RIESGOS VARIOS, IMPUTADOS, SINIESTROS, CONTADOR, SEGUROS ACT y COBERTURA.
//  - Datos raros a propósito: fechas imposibles, cuotas no numéricas, DNI repetido con dos nombres,
//    una sucursal fuera de catálogo (BRENDA), filas de TOTAL, CUIT que es el mismo DNI,
//    vehículos sin patente («SIN PATENTE», «0KM») y celdas vacías al final de las filas.
import type { PestanaSimulada } from './hoja-simulada'

/** Arma las filas de una pestaña a partir de objetos con clave = encabezado. */
function armar(encabezados: string[], filas: Array<Record<string, string>>): string[][] {
  return [encabezados, ...filas.map((fila) => encabezados.map((encabezado) => fila[encabezado] ?? ''))]
}

// ---------------------------------------------------------------------------
// Encabezados: cada mes escribió los suyos.
// ---------------------------------------------------------------------------

/** DICIEMBRE25: planilla vieja, corta. */
const ENC_DICIEMBRE = ['NOMBRE', 'DNI', 'LOCAL', 'CIA', 'N° POLIZA', 'PATENTE', 'MARCA', 'MODELO', 'AÑO', 'CUOTA', 'VENCIMIENTO', 'AVISO', 'PAGO', 'OBSERVACIONES']

/** ENERO: el vehículo arranca en la columna R (posición 18). */
const ENC_ENERO = [
  'NOMBRE Y APELLIDO', // A
  'D.N.I.', // B
  'TEL', // C
  'MAIL', // D
  'DIRECCION', // E
  'LOCALIDAD', // F
  'LOCAL', // G
  'F. NAC.', // H
  'CIA', // I
  'N° PÓLIZA', // J
  'COBERTURA', // K
  'PRIMA', // L
  'FORMA DE PAGO', // M
  'PRODUCTOR', // N
  'VIGENCIA DESDE', // O
  'VIGENCIA HASTA', // P
  'ALTA', // Q
  'MARCA', // R  ← vehículo
  'MODELO', // S
  'AÑO', // T
  'PATENTE', // U
  'MOTOR', // V
  'CHASIS', // W
  'CUOTA', // X
  'VTO', // Y
  'AVISO', // Z
  'PAGO', // AA
  'OB. DE COBERTURAS', // AB
]

/** FEBRERO: el vehículo arranca en la columna O (posición 15). */
const ENC_FEBRERO = [
  'APELLIDO Y NOMBRE', // A
  'DNI / CUIT', // B
  'TELEFONO', // C
  'SUCURSAL', // D
  'CIA', // E
  'POLIZA', // F
  'COBERTURA', // G
  'PRIMA', // H
  'FORMA DE PAGO', // I
  'PRODUCTOR', // J
  'CUOTA', // K
  'VTO', // L
  'AVISO', // M
  'PAGO', // N
  'MARCA', // O  ← vehículo
  'MODELO', // P
  'AÑO', // Q
  'PATENTE', // R
  'OBS', // S
]

/** MARZO a JULIO: otra variante, con una columna sin encabezado en el medio. */
const ENC_INTERMEDIO = ['APELLIDO Y NOMBRE', 'DOCUMENTO', 'CELULAR', 'SUC', '', 'COMPAÑIA', 'NRO POLIZA', 'PAT', 'MARCA', 'MODELO', 'AÑO', 'COBERTURA', 'IMPORTE', 'DIA DE VTO', 'AVISADO', 'FECHA DE PAGO', 'OBS']

/** AGOSTO: la planilla más nueva, la más completa (define la cartera actual). */
const ENC_AGOSTO = [
  'APELLIDO Y NOMBRE', // A
  'DNI', // B
  'TELEFONO', // C
  'EMAIL', // D
  'DOMICILIO', // E
  'LOCALIDAD', // F
  'SUCURSAL', // G
  'FECHA DE NACIMIENTO', // H
  'COMPAÑIA', // I
  'NRO DE POLIZA', // J
  'COBERTURA', // K
  'PRIMA', // L
  'FORMA DE PAGO', // M
  'PRODUCTOR', // N
  'ESTADO', // O
  'VIGENCIA DESDE', // P
  'VIGENCIA HASTA', // Q
  'ALTA', // R
  'MARCA', // S
  'MODELO', // T
  'AÑO', // U
  'DOMINIO', // V
  'MOTOR', // W
  'CHASIS', // X
  'USO', // Y
  'COLOR', // Z
  'SUMA ASEGURADA', // AA
  'CUOTA', // AB
  'DIA DE VTO', // AC
  'AVISO', // AD
  'PAGO', // AE
  'OBS', // AF
]

const ENC_BAJAS = ['NOMBRE', 'DNI', 'CIA', 'N° POLIZA', 'PATENTE', 'MOTIVO', 'MES', 'FECHA DE BAJA', 'OBSERVACIONES']
const ENC_RIESGOS = ['NOMBRE', 'DNI', 'TEL', 'LOCAL', 'RIESGO', 'DETALLE', 'CIA', 'N° POLIZA', 'PRIMA', 'CUOTA', 'VTO', 'AVISO', 'PAGO', 'OBSERVACIONES']
const ENC_IMPUTADOS = ['FECHA', 'NOMBRE', 'DNI', 'CIA', 'N° POLIZA', 'IMPORTE', 'MEDIO DE PAGO', 'MES', 'RESULTADO', 'OBSERVACIONES']
const ENC_SINIESTROS = ['LOCAL', 'FECHA DE CARGA', 'FECHA', 'NOMBRE', 'DNI', 'PATENTE', 'CIA', 'N° POLIZA', 'COBERTURA', 'N° SINIESTRO', 'DESCRIPCION', 'ESTADO', 'IMPORTE', 'OBSERVACIONES']
const ENC_COBERTURA = ['CIA', 'COBERTURA', 'INCLUYE', 'FRANQUICIA', 'DETALLE']
const ENC_AMP = ['LOCAL', 'FECHA', 'NOMBRE', 'FORMA DE PAGO', 'PATENTE', 'MARCA', 'MODELO', 'FECHA DE VTO', 'AMPLIACION', 'OBSERVACIONES']
const ENC_CONTADOR = ['MES', 'FACTURADO', 'COMISION', 'NOTAS']
const ENC_SEGUROS_ACT = ['COMPAÑIA', 'PRODUCTO', 'VIGENTE', 'NOTAS']

// ---------------------------------------------------------------------------
// La cartera: siete clientes, uno de ellos con dos pólizas.
// ---------------------------------------------------------------------------

export const CLIENTES = {
  gonzalez: { nombre: 'GONZALEZ MARIA LAURA', dni: '27.345.678', dniPlano: '27345678', sucursal: 'DOCK SUD', cia: 'SANCOR', poliza: '1234567', patente: 'AB123CD', marca: 'FORD', modelo: 'FIESTA', anio: '2018' },
  perezAuto: { nombre: 'PEREZ JUAN CARLOS', dni: '20-30111222-3', dniPlano: '30111222', sucursal: 'LANUS', cia: 'RIVADAVIA', poliza: '998877', patente: 'AC456EF', marca: 'VOLKSWAGEN', modelo: 'GOL TREND', anio: '2015' },
  perezMoto: { nombre: 'PEREZ JUAN CARLOS', dni: '30111222', sucursal: 'LANUS', cia: 'RIVADAVIA', poliza: '998878', patente: 'A123BCD', marca: 'HONDA', modelo: 'WAVE 110', anio: '2021' },
  rodriguez: { nombre: 'RODRIGUEZ ANA', dni: '33.222.111', dniPlano: '33222111', sucursal: 'DANIEL', cia: 'FEDERACION PATRONAL', poliza: '555000', patente: 'SIN PATENTE', marca: 'TOYOTA', modelo: 'ETIOS', anio: '2024' },
  lopez: { nombre: 'LOPEZ CARLOS ALBERTO', dni: '20.111.333', dniPlano: '20111333', sucursal: 'SARANDI', cia: 'SANCOR', poliza: '777111', patente: 'AD789GH', marca: 'CHEVROLET', modelo: 'ONIX', anio: '2020' },
  // Mismo DNI que González, con otro nombre: tiene que salir en el informe.
  martinez: { nombre: 'MARTINEZ SILVIA', dni: '27.345.678', dniPlano: '27345678', sucursal: 'BRENDA', cia: 'MERCANTIL ANDINA', poliza: '333222', patente: 'AE111JK', marca: 'FIAT', modelo: 'CRONOS', anio: '2021' },
  // Se da de baja en JULIO: está hasta esa planilla y no aparece en AGOSTO.
  fernandez: { nombre: 'FERNANDEZ ROBERTO', dni: '12.345.678', dniPlano: '12345678', sucursal: 'LANUS', cia: 'SANCOR', poliza: '111222', patente: 'XYZ123', marca: 'RENAULT', modelo: 'KANGOO', anio: '2010' },
  // Alta nueva: aparece recién en AGOSTO.
  suarez: { nombre: 'SUAREZ NATALIA', dni: '40.555.666', dniPlano: '40555666', sucursal: 'DOCK SUD', cia: 'ZURICH', poliza: '444555', patente: 'AF222LM', marca: 'PEUGEOT', modelo: '208', anio: '2023' },
}

type Cliente = (typeof CLIENTES)[keyof typeof CLIENTES]

/** Los que están en las planillas viejas (diciembre a julio). */
const CARTERA_VIEJA: Cliente[] = [CLIENTES.gonzalez, CLIENTES.perezAuto, CLIENTES.perezMoto, CLIENTES.rodriguez, CLIENTES.lopez, CLIENTES.martinez, CLIENTES.fernandez]

/** Los que están en AGOSTO: se fue Fernández (baja de julio) y entró Suárez. */
const CARTERA_AGOSTO: Cliente[] = [CLIENTES.gonzalez, CLIENTES.perezAuto, CLIENTES.perezMoto, CLIENTES.rodriguez, CLIENTES.lopez, CLIENTES.martinez, CLIENTES.suarez]

/**
 * Quiénes NO pagaron la cuota de AGOSTO. Una cartera real nunca está toda paga: sin esto no habría
 * mora que mirar. Martínez es el caso del débito que no entró: a un débito automático no se lo persigue.
 */
const MOROSOS_DE_AGOSTO: Cliente[] = [CLIENTES.martinez, CLIENTES.suarez, CLIENTES.rodriguez]

/**
 * Cómo paga cada uno. Casi todos por débito automático, que se cobra solo; los que pagan a mano son
 * los que aparecen en la mora. La forma de pago sale de la planilla más nueva y vale para todos los
 * meses, así que también decide cómo se ven las cuotas viejas de López.
 */
function formaDePagoDe(c: Cliente): string {
  if (c === CLIENTES.lopez) return 'EFECTIVO'
  if (c === CLIENTES.rodriguez) return 'CUPONERA'
  if (c === CLIENTES.suarez) return 'TRANSFERENCIA'
  return 'DEBITO'
}

/** Cuota de cada cliente en cada mes: crecen con la inflación y algunas son texto. */
function cuotaDe(cliente: Cliente, mes: number): string {
  const base: Record<string, number> = { '1234567': 18500, '998877': 12300, '998878': 4800, '555000': 32000, '777111': 21000, '333222': 15750, '111222': 9800, '444555': 27400 }
  const monto = Math.round((base[cliente.poliza] ?? 10000) * (1 + mes * 0.04))
  return `$ ${monto.toLocaleString('es-AR')}`
}

// ---------------------------------------------------------------------------
// Planillas mensuales
// ---------------------------------------------------------------------------

function filaDiciembre(c: Cliente): Record<string, string> {
  return {
    NOMBRE: c.nombre,
    DNI: c.dni,
    LOCAL: c.sucursal,
    CIA: c.cia,
    'N° POLIZA': c.poliza,
    PATENTE: c.patente,
    MARCA: c.marca,
    MODELO: c.modelo,
    AÑO: c.anio,
    CUOTA: cuotaDe(c, 0),
    VENCIMIENTO: '10',
    AVISO: 'SI',
    PAGO: '09/12',
    OBSERVACIONES: '',
  }
}

function filaEnero(c: Cliente): Record<string, string> {
  return {
    'NOMBRE Y APELLIDO': c.nombre,
    'D.N.I.': c.dni,
    TEL: '11-4444-5555',
    MAIL: '',
    DIRECCION: 'AV. MITRE 1234',
    LOCALIDAD: 'AVELLANEDA',
    LOCAL: c.sucursal,
    'F. NAC.': '15/04/1980',
    CIA: c.cia,
    'N° PÓLIZA': c.poliza,
    COBERTURA: 'TERCEROS COMPLETO',
    PRIMA: cuotaDe(c, 1),
    'FORMA DE PAGO': 'DEBITO',
    PRODUCTOR: 'DANIEL',
    'VIGENCIA DESDE': '01/01/2026',
    'VIGENCIA HASTA': '01/07/2026',
    ALTA: '01/01/2026',
    MARCA: c.marca,
    MODELO: c.modelo,
    AÑO: c.anio,
    PATENTE: c.patente,
    MOTOR: '',
    CHASIS: '',
    // Rodríguez todavía no tenía cuota cargada.
    CUOTA: c === CLIENTES.rodriguez ? '---' : cuotaDe(c, 1),
    VTO: '10',
    AVISO: 'SI',
    PAGO: '08/01',
    'OB. DE COBERTURAS': c === CLIENTES.rodriguez ? 'ESPERA FACTURA DE LA CONCESIONARIA' : '',
  }
}

function filaFebrero(c: Cliente): Record<string, string> {
  return {
    'APELLIDO Y NOMBRE': c.nombre,
    'DNI / CUIT': c.dni,
    TELEFONO: '11-4444-5555',
    SUCURSAL: c.sucursal,
    CIA: c.cia,
    POLIZA: c.poliza,
    COBERTURA: 'TERCEROS COMPLETO',
    PRIMA: cuotaDe(c, 2),
    'FORMA DE PAGO': 'DEBITO',
    PRODUCTOR: 'DANIEL',
    // González quedó "a debitar": texto conocido, no es un error.
    CUOTA: c === CLIENTES.gonzalez ? 'A/D' : cuotaDe(c, 2),
    VTO: '10',
    AVISO: 'SI',
    PAGO: '07/02',
    MARCA: c.marca,
    MODELO: c.modelo,
    AÑO: c.anio,
    PATENTE: c.patente,
    OBS: '',
  }
}

function filaIntermedia(c: Cliente, mes: number): Record<string, string> {
  return {
    'APELLIDO Y NOMBRE': c.nombre,
    DOCUMENTO: c.dni,
    CELULAR: '11-4444-5555',
    SUC: c.sucursal,
    COMPAÑIA: c.cia,
    'NRO POLIZA': c.poliza,
    PAT: c.patente,
    MARCA: c.marca,
    MODELO: c.modelo,
    // Un año de vehículo mal tipeado en MAYO.
    AÑO: mes === 5 && c === CLIENTES.lopez ? '20o20' : c.anio,
    COBERTURA: 'TERCEROS COMPLETO',
    IMPORTE: cuotaDe(c, mes),
    'DIA DE VTO': c === CLIENTES.martinez ? 'no sabe' : '10',
    AVISADO: mes % 2 === 0 ? 'SI' : 'NO',
    // Fecha imposible en MARZO: 31 de febrero. Y López dejó de pagar en junio: es la deuda vieja.
    'FECHA DE PAGO':
      mes === 3 && c === CLIENTES.gonzalez ? '31/02' : mes >= 6 && c === CLIENTES.lopez ? '' : `0${Math.min(9, mes)}/0${mes}`,
    OBS: '',
  }
}

function filaAgosto(c: Cliente): Record<string, string> {
  return {
    'APELLIDO Y NOMBRE': c.nombre,
    DNI: c.dni,
    TELEFONO: '11-4444-5555',
    EMAIL: 'cliente@ejemplo.com.ar',
    DOMICILIO: 'AV. MITRE 1234',
    LOCALIDAD: 'AVELLANEDA',
    SUCURSAL: c.sucursal,
    'FECHA DE NACIMIENTO': '15/04/1980',
    COMPAÑIA: c.cia,
    'NRO DE POLIZA': c.poliza,
    COBERTURA: 'TERCEROS COMPLETO',
    PRIMA: cuotaDe(c, 8),
    'FORMA DE PAGO': formaDePagoDe(c),
    PRODUCTOR: 'DANIEL',
    ESTADO: 'VIGENTE',
    'VIGENCIA DESDE': '01/07/2026',
    'VIGENCIA HASTA': '01/01/2027',
    ALTA: c === CLIENTES.suarez ? '05/08/2026' : '01/01/2020',
    MARCA: c.marca,
    MODELO: c.modelo,
    AÑO: c.anio,
    DOMINIO: c === CLIENTES.rodriguez ? '0KM' : c.patente,
    MOTOR: 'MOT-00123',
    CHASIS: 'CHA-00456',
    USO: 'PARTICULAR',
    COLOR: 'BLANCO',
    'SUMA ASEGURADA': '$ 25.000.000',
    // López tiene un texto libre en la cuota: dato raro que sí hay que informar.
    CUOTA: c === CLIENTES.lopez ? 'PREGUNTAR A DANIEL' : cuotaDe(c, 8),
    // Suárez vence el 15; el resto, el 10. Con dos días de vencimiento distintos la mora reparte.
    'DIA DE VTO': c === CLIENTES.suarez ? '15' : '10',
    AVISO: 'SI',
    PAGO: MOROSOS_DE_AGOSTO.includes(c) ? '' : '08/08',
    OBS: c === CLIENTES.suarez ? 'ALTA NUEVA' : '',
  }
}

/** Fila de totales al pie, como la que suele quedar en las planillas. */
function filaTotal(encabezadoNombre: string, encabezadoImporte: string, total: string): Record<string, string> {
  return { [encabezadoNombre]: 'TOTAL', [encabezadoImporte]: total }
}

const MESES_INTERMEDIOS: Array<{ titulo: string; mes: number }> = [
  { titulo: 'MARZO', mes: 3 },
  { titulo: 'ABRIL', mes: 4 },
  { titulo: 'MAYO', mes: 5 },
  { titulo: 'JUNIO', mes: 6 },
  { titulo: 'JULIO', mes: 7 },
]

export interface OpcionesHojaDePrueba {
  /** Hasta qué mes de 2026 incluir (8 = AGOSTO, la planilla más nueva). */
  hastaMes?: number
  /** Si es false, no se incluyen las pestañas que no son planillas mensuales ni bajas. */
  conPestanasEspeciales?: boolean
}

/** Arma todas las pestañas de la hoja de prueba, en el mismo orden que la hoja real. */
export function construirHojaDePrueba(opciones: OpcionesHojaDePrueba = {}): PestanaSimulada[] {
  const hastaMes = opciones.hastaMes ?? 8
  const conEspeciales = opciones.conPestanasEspeciales ?? true
  const pestanas: PestanaSimulada[] = []

  pestanas.push({
    titulo: 'DICIEMBRE25',
    valores: armar(ENC_DICIEMBRE, [...CARTERA_VIEJA.map(filaDiciembre), filaTotal('NOMBRE', 'CUOTA', '$ 114.150')]),
  })
  pestanas.push({
    titulo: 'BAJAS DICIEMBRE',
    valores: armar(ENC_BAJAS, [
      { NOMBRE: 'ACOSTA MIRTA', DNI: '10.222.333', CIA: 'SANCOR', 'N° POLIZA': '900100', PATENTE: 'RTY456', MOTIVO: 'VENDIO EL AUTO', MES: 'DICIEMBRE', 'FECHA DE BAJA': '15/12/2025', OBSERVACIONES: '' },
    ]),
  })

  if (hastaMes >= 1) {
    pestanas.push({ titulo: 'ENERO', valores: armar(ENC_ENERO, CARTERA_VIEJA.map(filaEnero)) })
    pestanas.push({
      titulo: 'BAJAS ENERO',
      valores: armar(ENC_BAJAS, [{ NOMBRE: 'DIAZ HECTOR', DNI: '14.777.888', CIA: 'RIVADAVIA', 'N° POLIZA': '900200', PATENTE: 'QWE789', MOTIVO: 'FALTA DE PAGO', MES: 'ENERO', 'FECHA DE BAJA': '20/01', OBSERVACIONES: 'DEBE 3 CUOTAS' }]),
    })
  }
  if (hastaMes >= 2) {
    pestanas.push({ titulo: 'FEBRERO', valores: armar(ENC_FEBRERO, [...CARTERA_VIEJA.map(filaFebrero), filaTotal('APELLIDO Y NOMBRE', 'CUOTA', '$ 128.400')]) })
    pestanas.push({ titulo: 'BAJAS FEBRERO', valores: armar(ENC_BAJAS, []) })
  }

  for (const { titulo, mes } of MESES_INTERMEDIOS) {
    if (hastaMes < mes) continue
    pestanas.push({ titulo, valores: armar(ENC_INTERMEDIO, CARTERA_VIEJA.map((c) => filaIntermedia(c, mes))) })
  }

  if (hastaMes >= 7) {
    pestanas.push({
      titulo: 'BAJAS JULIO',
      valores: armar(ENC_BAJAS, [
        {
          NOMBRE: CLIENTES.fernandez.nombre,
          DNI: CLIENTES.fernandez.dni,
          CIA: CLIENTES.fernandez.cia,
          'N° POLIZA': CLIENTES.fernandez.poliza,
          PATENTE: CLIENTES.fernandez.patente,
          MOTIVO: 'SE PASO A OTRO PRODUCTOR',
          MES: 'JULIO',
          'FECHA DE BAJA': '28/07/2026',
          OBSERVACIONES: 'AVISO POR WHATSAPP',
        },
      ]),
    })
  }

  if (hastaMes >= 8) {
    // La grilla de AGOSTO tiene exactamente 32 columnas (A..AF): el _ID obliga a agrandarla.
    pestanas.push({ titulo: 'AGOSTO', valores: armar(ENC_AGOSTO, CARTERA_AGOSTO.map(filaAgosto)), columnas: ENC_AGOSTO.length })
    pestanas.push({ titulo: 'BAJAS AGOSTO', valores: armar(ENC_BAJAS, []) })
  }

  if (!conEspeciales) return pestanas

  pestanas.push({
    titulo: 'AMP',
    valores: armar(ENC_AMP, [
      // La primera engancha con la póliza de González por patente; la segunda es de un cliente que
      // todavía no está en la cartera, que es lo que pasa cuando la ampliación llega antes que el alta.
      { LOCAL: 'DOCK SUD', FECHA: '10/03/2026', NOMBRE: CLIENTES.gonzalez.nombre, 'FORMA DE PAGO': 'TARJETA', PATENTE: CLIENTES.gonzalez.patente, MARCA: CLIENTES.gonzalez.marca, MODELO: CLIENTES.gonzalez.modelo, 'FECHA DE VTO': '10/04/2026', AMPLIACION: 'GRANIZO', OBSERVACIONES: 'SIN CARGO' },
      { LOCAL: 'LANUS', FECHA: '22/05/2026', NOMBRE: 'QUIROGA NATALIA', 'FORMA DE PAGO': 'CUPONERA', PATENTE: 'AF321LM', MARCA: 'RENAULT', MODELO: 'SANDERO', 'FECHA DE VTO': '22/06/2026', AMPLIACION: 'CRISTALES', OBSERVACIONES: '' },
    ]),
  })
  pestanas.push({
    titulo: 'RIESGOS VARIOS',
    valores: armar(ENC_RIESGOS, [
      { NOMBRE: CLIENTES.gonzalez.nombre, DNI: CLIENTES.gonzalez.dni, TEL: '11-4444-5555', LOCAL: 'DOCK SUD', RIESGO: 'COMBINADO FAMILIAR', DETALLE: 'CASA DE AVELLANEDA', CIA: 'SANCOR', 'N° POLIZA': 'CF-4455', PRIMA: '$ 8.900', CUOTA: '$ 8.900', VTO: '15', AVISO: 'SI', PAGO: '14/08', OBSERVACIONES: '' },
      { NOMBRE: 'COOPERATIVA EL SOL', DNI: '30-71234567-9', TEL: '11-3333-2222', LOCAL: 'LANUS', RIESGO: 'INCENDIO', DETALLE: 'DEPOSITO', CIA: 'MERCANTIL ANDINA', 'N° POLIZA': 'INC-9001', PRIMA: '$ 45.000', CUOTA: 'A/D', VTO: '05', AVISO: 'NO', PAGO: '', OBSERVACIONES: 'CLIENTE NUEVO' },
    ]),
  })
  pestanas.push({
    titulo: 'IMPUTADOS',
    valores: armar(ENC_IMPUTADOS, [
      // La columna RESULTADO es la de la rendición: viene vacía, escrita a mano o en minúscula.
      { FECHA: '09/08/2026', NOMBRE: CLIENTES.gonzalez.nombre, DNI: CLIENTES.gonzalez.dni, CIA: 'SANCOR', 'N° POLIZA': '1234567', IMPORTE: '$ 24.420', 'MEDIO DE PAGO': 'TRANSFERENCIA', MES: 'AGOSTO', RESULTADO: 'IMPUTADO', OBSERVACIONES: '' },
      { FECHA: '10/08/2026', NOMBRE: CLIENTES.perezAuto.nombre, DNI: CLIENTES.perezAuto.dni, CIA: 'RIVADAVIA', 'N° POLIZA': '998877', IMPORTE: '16.236', 'MEDIO DE PAGO': 'EFECTIVO', MES: 'AGOSTO', RESULTADO: '', OBSERVACIONES: '' },
      { FECHA: '32/08/2026', NOMBRE: CLIENTES.lopez.nombre, DNI: CLIENTES.lopez.dni, CIA: 'SANCOR', 'N° POLIZA': '777111', IMPORTE: 'NO PAGO', 'MEDIO DE PAGO': '', MES: 'AGOSTO', RESULTADO: 'revisar', OBSERVACIONES: 'FECHA MAL CARGADA' },
    ]),
  })
  pestanas.push({
    titulo: 'SINIESTROS',
    valores: armar(ENC_SINIESTROS, [
      { LOCAL: 'LANUS', 'FECHA DE CARGA': '13/04/2026', FECHA: '12/04/2026', NOMBRE: CLIENTES.perezAuto.nombre, DNI: CLIENTES.perezAuto.dni, PATENTE: CLIENTES.perezAuto.patente, CIA: 'RIVADAVIA', 'N° POLIZA': '998877', COBERTURA: 'TERCEROS COMPLETO', 'N° SINIESTRO': 'S-2026-0412', DESCRIPCION: 'CHOQUE EN CADENA', ESTADO: 'CERRADO', IMPORTE: '$ 380.000', OBSERVACIONES: '' },
      { LOCAL: 'DANIEL', 'FECHA DE CARGA': '01/03/2026', FECHA: '30/02/2026', NOMBRE: CLIENTES.martinez.nombre, DNI: CLIENTES.martinez.dni, PATENTE: CLIENTES.martinez.patente, CIA: 'MERCANTIL ANDINA', 'N° POLIZA': '333222', COBERTURA: 'TERCEROS COMPLETO', 'N° SINIESTRO': 'S-2026-0230', DESCRIPCION: 'GRANIZO', ESTADO: 'ABIERTO', IMPORTE: '', OBSERVACIONES: 'FECHA IMPOSIBLE' },
      // Un robo: la palabra va destacada en rojo en la pantalla, como en la hoja. El estado «EN TRAMITE»
      // viene sin tilde, que es como lo escriben, y tiene que caer igual en EN TRÁMITE.
      { LOCAL: 'DOCK SUD', 'FECHA DE CARGA': '05/08/2026', FECHA: '04/08/2026', NOMBRE: CLIENTES.gonzalez.nombre, DNI: CLIENTES.gonzalez.dni, PATENTE: CLIENTES.gonzalez.patente, CIA: 'SANCOR', 'N° POLIZA': '1234567', COBERTURA: 'TODO RIESGO', 'N° SINIESTRO': 'S-2026-0804', DESCRIPCION: 'ROBO DE RUEDAS EN LA VIA PUBLICA', ESTADO: 'EN TRAMITE', IMPORTE: '$ 450.000', OBSERVACIONES: 'FALTA LA DENUNCIA' },
    ]),
  })
  pestanas.push({
    titulo: 'CONTADOR',
    valores: armar(ENC_CONTADOR, [
      { MES: 'JULIO', FACTURADO: '$ 1.250.000', COMISION: '$ 187.500', NOTAS: '' },
      { MES: 'AGOSTO', FACTURADO: '$ 1.310.000', COMISION: '$ 196.500', NOTAS: '' },
    ]),
  })
  pestanas.push({
    titulo: 'SEGUROS ACT',
    valores: armar(ENC_SEGUROS_ACT, [
      { COMPAÑIA: 'SANCOR', PRODUCTO: 'AUTOMOTOR', VIGENTE: 'SI', NOTAS: '' },
      { COMPAÑIA: 'ZURICH', PRODUCTO: 'AUTOMOTOR', VIGENTE: 'SI', NOTAS: 'DESDE 2026' },
    ]),
  })
  pestanas.push({
    titulo: 'COBERTURA',
    valores: armar(ENC_COBERTURA, [
      { CIA: 'SANCOR', COBERTURA: 'TERCEROS COMPLETO', INCLUYE: 'RC, INCENDIO, ROBO TOTAL', FRANQUICIA: '---', DETALLE: 'SIN DAÑOS PROPIOS' },
      { CIA: 'SANCOR', COBERTURA: 'TODO RIESGO', INCLUYE: 'RC, INCENDIO, ROBO, DAÑOS', FRANQUICIA: '$ 350.000', DETALLE: '' },
      { CIA: 'ZURICH', COBERTURA: 'TERCEROS COMPLETO', INCLUYE: 'RC, INCENDIO, ROBO TOTAL', FRANQUICIA: '---', DETALLE: '' },
    ]),
  })

  return pestanas
}
