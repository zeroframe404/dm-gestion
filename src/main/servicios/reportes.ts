// Reportes: el centro de exportación. Cada listado de la aplicación ya tiene sus filtros en pantalla;
// lo que faltaba era poder sacar de ahí un archivo —para el contador, para imprimir, para mandar por
// mail— eligiendo qué columnas van.
//
// Un reporte se declara una sola vez acá: cómo se llama, qué filtros entiende, qué columnas tiene y
// de dónde salen las filas. La pantalla dibuja los filtros que el reporte declara y nada más, y el
// .xlsx y el PDF salen los dos de la misma lista de filas: no hay dos caminos que puedan divergir.
//
// Los filtros pesados (mes, rango de fechas) van en el SQL; los de texto —sucursal, compañía, estado y
// la búsqueda— se aplican después en memoria, como en el resto de la aplicación, porque en la hoja de
// la agencia «LANUS», «Lanús» y «lanus » son el mismo local y SQLite no sabe eso.
import { hoyLocal, nombreDePeriodo, periodoDeHoy } from '../../shared/semaforo'
import { normalizarEstadoSiniestro } from '../../shared/siniestros'
import {
  ESTADOS_DE_SINIESTRO,
  type CatalogoDeReportes,
  type ColumnaDeReporte,
  type DefinicionDeReporte,
  type FiltroDeReporte,
  type FiltrosDeReporte,
  type OpcionesPlanillaClasica,
  type PedidoDeReporte,
  type VistaPreviaDeReporte,
} from '../../shared/tipos'
import { db } from '../db/base'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import {
  aFila,
  catalogos,
  nombreDePestanaMensual,
  periodosDisponibles,
  pestanaDeBajas,
  SELECT_PLANILLA,
  type FilaCruda,
} from './cartera'
import { mora } from './cobranzas'
import { diasCoberturaPorCompania } from './companias'
import { ErrorDeNegocio } from './errores'
import { paraNombreDeArchivo } from './exportacion'
import { construirXlsx, escaparXml, type HojaXlsx, type ValorDeCelda } from './xlsx'

/** Cuántas filas muestra la vista previa antes de exportar. */
const FILAS_DE_VISTA_PREVIA = 50

const FORMATO_ISO = /^\d{4}-\d{2}-\d{2}$/
const FORMATO_PERIODO = /^\d{4}-\d{2}$/

export const FILTROS_DE_REPORTE_VACIOS: FiltrosDeReporte = {
  periodo: '',
  sucursal: '',
  compania: '',
  estado: '',
  busqueda: '',
  desde: '',
  hasta: '',
}

type FilaDeReporte = Record<string, ValorDeCelda>

interface Reporte {
  id: string
  nombre: string
  descripcion: string
  filtros: FiltroDeReporte[]
  columnas: ColumnaDeReporte[]
  estados: string[]
  etiquetaDeEstado: string
  /** Columnas que mira cada filtro de texto. Si no está declarada, el filtro no se aplica. */
  campoSucursal?: string
  campoCompania?: string
  campoEstado?: string
  busca: string[]
  obtener: (filtros: FiltrosDeReporte) => FilaDeReporte[]
}

// ---------------------------------------------------------------------------
// Armado de consultas
// ---------------------------------------------------------------------------

interface Consulta {
  donde: string[]
  parametros: unknown[]
}

function condicion(consulta: Consulta, expresion: string, ...valores: unknown[]): void {
  consulta.donde.push(expresion)
  consulta.parametros.push(...valores)
}

/** Rango de fechas del filtro, sobre la expresión ISO que corresponda al reporte. */
function entreFechas(consulta: Consulta, expresion: string, filtros: FiltrosDeReporte): void {
  const desde = limpiar(filtros.desde)
  const hasta = limpiar(filtros.hasta)
  if (FORMATO_ISO.test(desde)) condicion(consulta, `${expresion} >= ?`, desde)
  if (FORMATO_ISO.test(hasta)) condicion(consulta, `${expresion} <= ?`, hasta)
}

function consultar(base: string, consulta: Consulta, orden: string): FilaDeReporte[] {
  const donde = consulta.donde.length > 0 ? ` WHERE ${consulta.donde.join(' AND ')}` : ''
  return db()
    .prepare(`${base}${donde} ORDER BY ${orden}`)
    .all(...(consulta.parametros as [])) as FilaDeReporte[]
}

/** El mes elegido; si no se eligió ninguno, el mes abierto de la cartera. */
function periodoElegido(filtros: FiltrosDeReporte): string {
  const pedido = limpiar(filtros.periodo)
  if (pedido && FORMATO_PERIODO.test(pedido)) return pedido
  return periodosDisponibles()[0]?.periodo ?? periodoDeHoy()
}

function mismaCosa(a: ValorDeCelda | undefined, b: string): boolean {
  return normalizarTexto(a === null || a === undefined ? '' : String(a)) === normalizarTexto(b)
}

// ---------------------------------------------------------------------------
// Los reportes
// ---------------------------------------------------------------------------

/** Atajo para declarar una columna. */
function col(id: string, titulo: string, ancho: number, numerica = false): ColumnaDeReporte {
  return numerica ? { id, titulo, ancho, numerica } : { id, titulo, ancho }
}

const COLUMNAS_DE_CARTERA: ColumnaDeReporte[] = [
  col('sucursal', 'Sucursal', 14),
  col('nombre', 'Apellido y nombre', 30),
  col('documento', 'DNI / CUIT', 15),
  col('telefono', 'Teléfono', 16),
  col('compania', 'Compañía', 20),
  col('numeroPoliza', 'N° de póliza', 16),
  col('patente', 'Patente', 11),
  col('marca', 'Marca', 14),
  col('modelo', 'Modelo', 18),
  col('anio', 'Año', 7),
  col('cobertura', 'Cobertura', 16),
  col('formaPago', 'Forma de pago', 16),
  col('cuota', 'Cuota', 12),
  col('cuotaMonto', 'Cuota ($)', 12, true),
  col('diaVencimiento', 'Día de vto.', 11),
  col('estado', 'Cobrada', 11),
  col('aviso', 'Aviso', 12),
  col('pago', 'Cuándo pagó', 13),
  col('observaciones', 'Observaciones', 34),
]

const REPORTES: Reporte[] = [
  {
    id: 'cartera',
    nombre: 'Planilla del mes',
    descripcion: 'Las filas de la cartera de un mes, con su cuota, su vencimiento y si está cobrada.',
    filtros: ['periodo', 'sucursal', 'compania', 'estado', 'busqueda'],
    columnas: COLUMNAS_DE_CARTERA,
    estados: ['PAGADA', 'IMPAGA'],
    etiquetaDeEstado: 'Cobrada',
    campoSucursal: 'sucursal',
    campoCompania: 'compania',
    campoEstado: 'estado',
    busca: ['nombre', 'documento', 'numeroPoliza', 'patente'],
    obtener: (filtros) => {
      const dias = diasCoberturaPorCompania()
      const crudas = db()
        .prepare(`${SELECT_PLANILLA} WHERE c.periodo = ? AND c.dada_de_baja = 0 ORDER BY nombre`)
        .all(periodoElegido(filtros)) as FilaCruda[]
      return crudas.map((cruda) => {
        const fila = aFila(cruda, dias)
        return {
          sucursal: fila.sucursal,
          nombre: fila.nombre,
          documento: fila.documento,
          telefono: fila.telefono,
          compania: fila.compania,
          numeroPoliza: fila.numeroPoliza,
          patente: fila.patente,
          marca: fila.marca,
          modelo: fila.modelo,
          anio: fila.anio,
          cobertura: fila.cobertura,
          formaPago: fila.formaPago,
          cuota: fila.cuota,
          cuotaMonto: fila.cuotaMonto,
          diaVencimiento: fila.diaVencimiento,
          estado: limpiar(fila.pago) || fila.pagoRegistrado ? 'PAGADA' : 'IMPAGA',
          aviso: fila.aviso,
          pago: fila.pago,
          observaciones: fila.observaciones,
        }
      })
    },
  },
  {
    id: 'bajas',
    nombre: 'Bajas',
    descripcion: 'Quién se dio de baja, en qué mes y por qué motivo.',
    filtros: ['periodo', 'sucursal', 'compania', 'busqueda'],
    columnas: [
      col('periodo', 'Mes', 10),
      col('nombre', 'Apellido y nombre', 30),
      col('documento', 'DNI / CUIT', 15),
      col('compania', 'Compañía', 20),
      col('numeroPoliza', 'N° de póliza', 16),
      col('patente', 'Patente', 11),
      col('sucursal', 'Sucursal', 14),
      col('motivo', 'Motivo', 20),
      col('fechaBaja', 'Fecha de baja', 13),
      col('observaciones', 'Observaciones', 34),
    ],
    estados: [],
    etiquetaDeEstado: 'Estado',
    campoSucursal: 'sucursal',
    campoCompania: 'compania',
    busca: ['nombre', 'documento', 'numeroPoliza', 'patente', 'motivo'],
    obtener: (filtros) => {
      const consulta: Consulta = { donde: [], parametros: [] }
      const periodo = limpiar(filtros.periodo)
      if (periodo && FORMATO_PERIODO.test(periodo)) condicion(consulta, 'b.periodo = ?', periodo)
      return consultar(
        `SELECT b.periodo, b.cliente_nombre AS nombre, b.documento, b.compania, b.numero_poliza AS numeroPoliza,
                b.patente, COALESCE(NULLIF(TRIM(b.sucursal_texto), ''), cl.sucursal_texto) AS sucursal, b.motivo,
                COALESCE(b.fecha_baja_iso, b.fecha_baja) AS fechaBaja,
                COALESCE(NULLIF(TRIM(b.nota), ''), b.observaciones) AS observaciones
           FROM bajas b LEFT JOIN clientes cl ON cl.id = b.cliente_id`,
        consulta,
        'b.periodo DESC, nombre',
      )
    },
  },
  {
    id: 'clientes',
    nombre: 'Clientes',
    descripcion: 'La agenda completa: datos de contacto y cuántas pólizas activas tiene cada uno.',
    filtros: ['sucursal', 'busqueda'],
    columnas: [
      col('nombre', 'Apellido y nombre', 30),
      col('documento', 'DNI / CUIT', 15),
      col('telefono', 'Teléfono', 16),
      col('email', 'Email', 26),
      col('direccion', 'Domicilio', 26),
      col('localidad', 'Localidad', 18),
      col('sucursal', 'Sucursal', 14),
      col('fechaNacimiento', 'Fecha de nac.', 13),
      col('polizas', 'Pólizas activas', 14, true),
      col('creadoEn', 'Alta en el sistema', 15),
    ],
    estados: [],
    etiquetaDeEstado: 'Estado',
    campoSucursal: 'sucursal',
    busca: ['nombre', 'documento', 'telefono', 'email'],
    obtener: () =>
      consultar(
        `SELECT cl.nombre, cl.documento, cl.telefono, cl.email, cl.direccion, cl.localidad,
                cl.sucursal_texto AS sucursal, cl.fecha_nacimiento AS fechaNacimiento,
                (SELECT COUNT(*) FROM polizas p WHERE p.cliente_id = cl.id AND p.activa = 1) AS polizas,
                substr(cl.creado_en, 1, 10) AS creadoEn
           FROM clientes cl`,
        { donde: [], parametros: [] },
        'cl.nombre',
      ),
  },
  {
    id: 'polizas',
    nombre: 'Pólizas',
    descripcion: 'Una fila por póliza, con su vehículo, sus vigencias y si está activa o dada de baja.',
    filtros: ['sucursal', 'compania', 'estado', 'busqueda'],
    columnas: [
      col('nombre', 'Apellido y nombre', 30),
      col('documento', 'DNI / CUIT', 15),
      col('telefono', 'Teléfono', 16),
      col('compania', 'Compañía', 20),
      col('numeroPoliza', 'N° de póliza', 16),
      col('cobertura', 'Cobertura', 16),
      col('patente', 'Patente', 11),
      col('marca', 'Marca', 14),
      col('modelo', 'Modelo', 18),
      col('anio', 'Año', 7),
      col('formaPago', 'Forma de pago', 16),
      col('prima', 'Prima', 13),
      col('vigenciaDesde', 'Vigencia desde', 14),
      col('vigenciaHasta', 'Vigencia hasta', 14),
      col('productor', 'Productor', 16),
      col('sucursal', 'Sucursal', 14),
      col('estado', 'Estado', 14),
    ],
    estados: ['ACTIVA', 'DADA DE BAJA'],
    etiquetaDeEstado: 'Estado',
    campoSucursal: 'sucursal',
    campoCompania: 'compania',
    campoEstado: 'estado',
    busca: ['nombre', 'documento', 'numeroPoliza', 'patente'],
    obtener: () =>
      consultar(
        `SELECT cl.nombre, cl.documento, cl.telefono, p.compania, p.numero AS numeroPoliza, p.cobertura,
                v.patente, v.marca, v.modelo, v.anio, p.forma_pago AS formaPago, p.prima,
                p.vigencia_desde AS vigenciaDesde, p.vigencia_hasta AS vigenciaHasta, p.productor,
                cl.sucursal_texto AS sucursal,
                CASE WHEN p.activa = 1 THEN 'ACTIVA' ELSE 'DADA DE BAJA' END AS estado
           FROM polizas p
           JOIN clientes cl ON cl.id = p.cliente_id
           LEFT JOIN vehiculos v ON v.id = p.vehiculo_id`,
        { donde: [], parametros: [] },
        'cl.nombre, p.compania',
      ),
  },
  {
    id: 'renovaciones',
    nombre: 'Renovaciones',
    descripcion: 'Las pólizas activas por fecha de vencimiento, con el estado de su gestión.',
    filtros: ['fechas', 'sucursal', 'compania', 'estado', 'busqueda'],
    columnas: [
      col('venceEl', 'Vence el', 12),
      col('nombre', 'Apellido y nombre', 30),
      col('telefono', 'Teléfono', 16),
      col('compania', 'Compañía', 20),
      col('numeroPoliza', 'N° de póliza', 16),
      col('patente', 'Patente', 11),
      col('marca', 'Marca', 14),
      col('modelo', 'Modelo', 18),
      col('sucursal', 'Sucursal', 14),
      col('estado', 'Gestión', 14),
      col('responsable', 'Responsable', 18),
      col('nota', 'Nota', 34),
    ],
    estados: ['pendiente', 'en gestion', 'renovada', 'no renueva'],
    etiquetaDeEstado: 'Gestión',
    campoSucursal: 'sucursal',
    campoCompania: 'compania',
    campoEstado: 'estado',
    busca: ['nombre', 'numeroPoliza', 'patente'],
    obtener: (filtros) => {
      const consulta: Consulta = { donde: [], parametros: [] }
      condicion(consulta, 'p.activa = 1')
      condicion(consulta, 'p.vigencia_hasta_iso IS NOT NULL')
      entreFechas(consulta, 'p.vigencia_hasta_iso', filtros)
      return consultar(
        `SELECT p.vigencia_hasta_iso AS venceEl, cl.nombre, cl.telefono, p.compania, p.numero AS numeroPoliza,
                v.patente, v.marca, v.modelo, cl.sucursal_texto AS sucursal,
                COALESCE(r.estado, 'pendiente') AS estado, r.responsable_nombre AS responsable, r.nota
           FROM polizas p
           JOIN clientes cl ON cl.id = p.cliente_id
           LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
           LEFT JOIN renovaciones r ON r.poliza_id = p.id AND r.vence_el = p.vigencia_hasta_iso`,
        consulta,
        'p.vigencia_hasta_iso, cl.nombre',
      )
    },
  },
  {
    id: 'siniestros',
    nombre: 'Siniestros',
    descripcion: 'Los siniestros por fecha, con su estado del trámite y su importe.',
    filtros: ['fechas', 'sucursal', 'compania', 'estado', 'busqueda'],
    columnas: [
      col('fecha', 'Fecha del siniestro', 15),
      col('fechaCarga', 'Fecha de carga', 14),
      col('nombre', 'Apellido y nombre', 30),
      col('documento', 'DNI / CUIT', 15),
      col('patente', 'Patente', 11),
      col('compania', 'Compañía', 20),
      col('numeroPoliza', 'N° de póliza', 16),
      col('numeroSiniestro', 'N° de siniestro', 16),
      col('descripcion', 'Descripción', 30),
      col('estado', 'Estado del trámite', 20),
      col('importe', 'Importe', 13),
      col('sucursal', 'Sucursal', 14),
      col('observaciones', 'Observaciones', 34),
    ],
    estados: [...ESTADOS_DE_SINIESTRO],
    etiquetaDeEstado: 'Estado del trámite',
    campoSucursal: 'sucursal',
    campoCompania: 'compania',
    campoEstado: 'estado',
    busca: ['nombre', 'documento', 'patente', 'numeroPoliza', 'numeroSiniestro', 'descripcion'],
    obtener: (filtros) => {
      const consulta: Consulta = { donde: [], parametros: [] }
      entreFechas(consulta, `COALESCE(s.fecha_iso, s.fecha_carga_iso)`, filtros)
      const filas = consultar(
        `SELECT s.fecha_iso AS fecha, s.fecha_carga_iso AS fechaCarga,
                COALESCE(NULLIF(TRIM(s.cliente_nombre), ''), cl.nombre) AS nombre,
                COALESCE(NULLIF(TRIM(s.documento), ''), cl.documento) AS documento,
                s.patente, s.compania, s.numero_poliza AS numeroPoliza, s.numero_siniestro AS numeroSiniestro,
                s.descripcion, s.estado, s.importe,
                COALESCE(NULLIF(TRIM(s.sucursal_texto), ''), cl.sucursal_texto) AS sucursal, s.observaciones
           FROM siniestros s LEFT JOIN clientes cl ON cl.id = s.cliente_id`,
        consulta,
        'COALESCE(s.fecha_iso, s.fecha_carga_iso) DESC, s.id DESC',
      )
      // El ESTADO de la hoja es texto libre desde hace años: en el reporte va el estado del trámite
      // ya normalizado, que es por el que se filtra y con el que la agencia razona.
      for (const fila of filas) fila.estado = normalizarEstadoSiniestro(fila.estado as string | null)
      return filas
    },
  },
  {
    id: 'pagos',
    nombre: 'Cobranza',
    descripcion: 'Todos los pagos registrados, con su medio, quién cobró y cómo quedó la rendición.',
    filtros: ['periodo', 'fechas', 'sucursal', 'compania', 'estado', 'busqueda'],
    columnas: [
      col('fecha', 'Fecha', 12),
      col('nombre', 'Apellido y nombre', 30),
      col('documento', 'DNI / CUIT', 15),
      col('compania', 'Compañía', 20),
      col('numeroPoliza', 'N° de póliza', 16),
      col('patente', 'Patente', 11),
      col('importe', 'Importe', 13, true),
      col('medio', 'Medio de pago', 16),
      col('sucursal', 'Sucursal del cobro', 16),
      col('cobro', 'Cobró', 18),
      col('periodo', 'Mes que paga', 12),
      col('estado', 'Resultado', 13),
      col('observaciones', 'Observaciones', 30),
    ],
    estados: ['(pendiente)', 'IMPUTADO', 'OK', 'REVISAR', 'MAL'],
    etiquetaDeEstado: 'Resultado',
    campoSucursal: 'sucursal',
    campoCompania: 'compania',
    campoEstado: 'estado',
    busca: ['nombre', 'documento', 'numeroPoliza', 'patente'],
    obtener: (filtros) => {
      const consulta: Consulta = { donde: [], parametros: [] }
      const periodo = limpiar(filtros.periodo)
      if (periodo && FORMATO_PERIODO.test(periodo)) {
        condicion(consulta, `COALESCE(p.periodo, substr(p.fecha_iso, 1, 7)) = ?`, periodo)
      }
      entreFechas(consulta, 'p.fecha_iso', filtros)
      return consultar(
        `SELECT p.fecha_iso AS fecha, p.cliente_nombre AS nombre, p.documento, p.compania,
                p.numero_poliza AS numeroPoliza, p.patente, p.importe_monto AS importe, p.medio,
                COALESCE(NULLIF(TRIM(p.sucursal_cobro), ''), p.sucursal_texto) AS sucursal,
                p.usuario_nombre AS cobro, COALESCE(p.periodo, substr(p.fecha_iso, 1, 7)) AS periodo,
                COALESCE(NULLIF(TRIM(p.resultado), ''), '(pendiente)') AS estado, p.observaciones
           FROM pagos p`,
        consulta,
        'p.fecha_iso DESC, p.id DESC',
      )
    },
  },
  {
    id: 'mora',
    nombre: 'Mora',
    descripcion: 'Las cuotas vencidas sin pago de todos los meses, con los días de atraso.',
    filtros: ['sucursal', 'compania', 'busqueda'],
    columnas: [
      col('nombre', 'Apellido y nombre', 30),
      col('telefono', 'Teléfono', 16),
      col('documento', 'DNI / CUIT', 15),
      col('sucursal', 'Sucursal', 14),
      col('compania', 'Compañía', 20),
      col('numeroPoliza', 'N° de póliza', 16),
      col('patente', 'Patente', 11),
      col('periodo', 'Mes', 10),
      col('vencimiento', 'Venció el', 12),
      col('diasDeAtraso', 'Días de atraso', 13, true),
      col('rango', 'Tramo', 10),
      col('cuota', 'Cuota', 12),
      col('cuotaMonto', 'Cuota ($)', 12, true),
      col('formaPago', 'Forma de pago', 16),
      col('finCobertura', 'Cubierto hasta', 14),
      col('aviso', 'Aviso', 12),
    ],
    estados: [],
    etiquetaDeEstado: 'Estado',
    busca: [],
    obtener: (filtros) =>
      // La mora no se puede sacar con una consulta: hace falta el semáforo, la cobertura financiera de
      // cada compañía y los meses cerrados. Se reusa el servicio de Cobranzas, que ya filtra por
      // sucursal, compañía y búsqueda: no puede haber dos definiciones de «está en mora».
      mora({
        busqueda: filtros.busqueda,
        sucursal: filtros.sucursal,
        compania: filtros.compania,
        rango: '',
        incluirDebito: false,
      }).filas.map((fila) => ({
        nombre: fila.nombre,
        telefono: fila.telefono,
        documento: fila.documento,
        sucursal: fila.sucursal,
        compania: fila.compania,
        numeroPoliza: fila.numeroPoliza,
        patente: fila.patente,
        periodo: fila.periodo,
        vencimiento: fila.vencimiento,
        diasDeAtraso: fila.diasDeAtraso,
        rango: fila.rango,
        cuota: fila.cuota,
        cuotaMonto: fila.cuotaMonto,
        formaPago: fila.formaPago,
        finCobertura: fila.finCobertura,
        aviso: fila.aviso,
      })),
  },
  {
    id: 'riesgos',
    nombre: 'Riesgos varios',
    descripcion: 'Lo que no es automotor: hogar, comercio, vida, accidentes personales.',
    filtros: ['sucursal', 'compania', 'busqueda'],
    columnas: [
      col('nombre', 'Apellido y nombre', 30),
      col('documento', 'DNI / CUIT', 15),
      col('telefono', 'Teléfono', 16),
      col('sucursal', 'Sucursal', 14),
      col('tipoRiesgo', 'Riesgo', 18),
      col('descripcion', 'Detalle', 28),
      col('compania', 'Compañía', 20),
      col('numeroPoliza', 'N° de póliza', 16),
      col('prima', 'Prima', 13),
      col('cuota', 'Cuota', 12),
      col('diaVencimiento', 'Día de vto.', 11),
      col('formaPago', 'Forma de pago', 16),
      col('vigenciaDesde', 'Vigencia desde', 14),
      col('vigenciaHasta', 'Vigencia hasta', 14),
      col('observaciones', 'Observaciones', 30),
    ],
    estados: [],
    etiquetaDeEstado: 'Estado',
    campoSucursal: 'sucursal',
    campoCompania: 'compania',
    busca: ['nombre', 'documento', 'numeroPoliza', 'tipoRiesgo', 'descripcion'],
    obtener: () =>
      consultar(
        `SELECT COALESCE(NULLIF(TRIM(r.cliente_nombre), ''), cl.nombre) AS nombre,
                COALESCE(NULLIF(TRIM(r.documento), ''), cl.documento) AS documento,
                COALESCE(NULLIF(TRIM(r.telefono), ''), cl.telefono) AS telefono,
                COALESCE(NULLIF(TRIM(r.sucursal_texto), ''), cl.sucursal_texto) AS sucursal,
                r.tipo_riesgo AS tipoRiesgo, r.descripcion, r.compania, r.numero_poliza AS numeroPoliza,
                r.prima, r.cuota, r.dia_vencimiento AS diaVencimiento, r.forma_pago AS formaPago,
                r.vigencia_desde AS vigenciaDesde, r.vigencia_hasta AS vigenciaHasta, r.observaciones
           FROM riesgos_varios r LEFT JOIN clientes cl ON cl.id = r.cliente_id`,
        { donde: [], parametros: [] },
        'nombre',
      ),
  },
  {
    id: 'leads',
    nombre: 'Leads',
    descripcion: 'Las consultas que entraron, por dónde entraron y en qué quedaron.',
    filtros: ['fechas', 'sucursal', 'estado', 'busqueda'],
    columnas: [
      col('fecha', 'Fecha', 12),
      col('nombre', 'Nombre', 28),
      col('telefono', 'Teléfono', 16),
      col('documento', 'DNI / CUIT', 15),
      col('email', 'Email', 24),
      col('sucursal', 'Sucursal', 14),
      col('origen', 'Origen', 14),
      col('interes', 'Qué asegura', 28),
      col('tipoVehiculo', 'Tipo', 12),
      col('estado', 'Estado', 13),
      col('cargadoPor', 'Cargado por', 18),
      col('convertido', 'Ya es cliente', 13),
    ],
    estados: ['NUEVO', 'EN CHARLA', 'COTIZADO', 'GANADO', 'PERDIDO'],
    etiquetaDeEstado: 'Estado',
    campoSucursal: 'sucursal',
    campoEstado: 'estado',
    busca: ['nombre', 'telefono', 'documento', 'interes'],
    obtener: (filtros) => {
      const consulta: Consulta = { donde: [], parametros: [] }
      entreFechas(consulta, `substr(l.creado_en, 1, 10)`, filtros)
      return consultar(
        `SELECT substr(l.creado_en, 1, 10) AS fecha, l.nombre, l.telefono, l.documento, l.email,
                COALESCE(NULLIF(TRIM(l.sucursal_texto), ''), s.nombre) AS sucursal, l.origen, l.interes,
                l.tipo_vehiculo AS tipoVehiculo, l.estado, l.usuario_nombre AS cargadoPor,
                CASE WHEN l.cliente_id IS NULL THEN '' ELSE 'SÍ' END AS convertido
           FROM leads l LEFT JOIN sucursales s ON s.id = l.sucursal_id`,
        consulta,
        'l.id DESC',
      )
    },
  },
  {
    id: 'presupuestos',
    nombre: 'Presupuestos',
    descripcion: 'Los presupuestos vigentes, con cuántas compañías se cotizaron y desde qué precio.',
    filtros: ['fechas', 'sucursal', 'estado', 'busqueda'],
    columnas: [
      col('fecha', 'Fecha', 12),
      col('numero', 'Número', 11),
      col('version', 'Versión', 8, true),
      col('nombre', 'Cliente', 28),
      col('telefono', 'Teléfono', 16),
      col('documento', 'DNI / CUIT', 15),
      col('sucursal', 'Sucursal', 14),
      col('patente', 'Patente', 11),
      col('marca', 'Marca', 14),
      col('modelo', 'Modelo', 18),
      col('anio', 'Año', 7),
      col('opciones', 'Compañías', 10, true),
      col('precioDesde', 'Desde ($)', 13, true),
      col('estado', 'Estado', 13),
      col('cargadoPor', 'Cargado por', 18),
      col('observaciones', 'Observaciones', 30),
    ],
    estados: ['BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO'],
    etiquetaDeEstado: 'Estado',
    campoSucursal: 'sucursal',
    campoEstado: 'estado',
    busca: ['nombre', 'numero', 'documento', 'patente'],
    obtener: (filtros) => {
      const consulta: Consulta = { donde: [], parametros: [] }
      // Sólo las versiones vigentes: las anteriores son el historial de un mismo presupuesto y
      // duplicarían cada fila.
      condicion(consulta, 'pr.vigente = 1')
      entreFechas(consulta, `substr(pr.creado_en, 1, 10)`, filtros)
      return consultar(
        `SELECT substr(pr.creado_en, 1, 10) AS fecha, pr.numero, pr.version, pr.cliente_nombre AS nombre,
                pr.telefono, pr.documento, pr.sucursal_texto AS sucursal, pr.patente, pr.marca, pr.modelo, pr.anio,
                (SELECT COUNT(*) FROM presupuesto_opciones o WHERE o.presupuesto_id = pr.id) AS opciones,
                (SELECT MIN(o.precio_monto) FROM presupuesto_opciones o WHERE o.presupuesto_id = pr.id) AS precioDesde,
                pr.estado, pr.usuario_nombre AS cargadoPor, pr.observaciones
           FROM presupuestos pr`,
        consulta,
        'pr.id DESC',
      )
    },
  },
  {
    id: 'tareas',
    nombre: 'Tareas',
    descripcion: 'Los pendientes del equipo: a quién le tocan, para cuándo y cómo vienen.',
    filtros: ['fechas', 'sucursal', 'estado', 'busqueda'],
    columnas: [
      col('fecha', 'Creada el', 12),
      col('titulo', 'Tarea', 30),
      col('detalle', 'Detalle', 34),
      col('responsable', 'Responsable', 18),
      col('sucursal', 'Sucursal', 14),
      col('venceEl', 'Vence el', 12),
      col('prioridad', 'Prioridad', 11),
      col('estado', 'Estado', 13),
      col('creadoPor', 'Creada por', 18),
      col('comentarios', 'Comentarios', 11, true),
    ],
    estados: ['pendiente', 'en gestion', 'hecha'],
    etiquetaDeEstado: 'Estado',
    campoSucursal: 'sucursal',
    campoEstado: 'estado',
    busca: ['titulo', 'detalle', 'responsable'],
    obtener: (filtros) => {
      const consulta: Consulta = { donde: [], parametros: [] }
      entreFechas(consulta, 't.vence_el', filtros)
      return consultar(
        `SELECT substr(t.creado_en, 1, 10) AS fecha, t.titulo, t.detalle, t.responsable_nombre AS responsable,
                t.sucursal_texto AS sucursal, t.vence_el AS venceEl, t.prioridad, t.estado,
                t.creado_por AS creadoPor,
                (SELECT COUNT(*) FROM tarea_comentarios tc WHERE tc.tarea_id = t.id) AS comentarios
           FROM tareas t`,
        consulta,
        't.id DESC',
      )
    },
  },
]

function buscarReporte(id: string): Reporte {
  const reporte = REPORTES.find((candidato) => candidato.id === id)
  if (!reporte) throw new ErrorDeNegocio(`No existe el reporte «${id}». Actualizá la pantalla y probá de nuevo.`)
  return reporte
}

// ---------------------------------------------------------------------------
// Filtros que se aplican en memoria
// ---------------------------------------------------------------------------

function filtrarEnMemoria(reporte: Reporte, filas: FilaDeReporte[], filtros: FiltrosDeReporte): FilaDeReporte[] {
  const sucursal = limpiar(filtros.sucursal)
  const compania = limpiar(filtros.compania)
  const estado = limpiar(filtros.estado)
  const busqueda = normalizarTexto(filtros.busqueda).replace(/ /g, '')

  return filas.filter((fila) => {
    if (sucursal && reporte.campoSucursal && !mismaCosa(fila[reporte.campoSucursal], sucursal)) return false
    if (compania && reporte.campoCompania && !mismaCosa(fila[reporte.campoCompania], compania)) return false
    if (estado && reporte.campoEstado && !mismaCosa(fila[reporte.campoEstado], estado)) return false
    if (busqueda && reporte.busca.length > 0) {
      const coincide = reporte.busca.some((campo) => {
        const valor = fila[campo]
        return normalizarTexto(valor === null || valor === undefined ? '' : String(valor))
          .replace(/ /g, '')
          .includes(busqueda)
      })
      if (!coincide) return false
    }
    return true
  })
}

/** Las columnas elegidas, en el orden pedido. Vacío = todas las del reporte. */
function columnasElegidas(reporte: Reporte, pedidas: string[] | undefined): ColumnaDeReporte[] {
  if (!Array.isArray(pedidas) || pedidas.length === 0) return reporte.columnas
  const elegidas = pedidas
    .map((id) => reporte.columnas.find((columna) => columna.id === id))
    .filter((columna): columna is ColumnaDeReporte => columna !== undefined)
  // Pedir sólo columnas que no existen es casi siempre una pantalla vieja: mejor todas que ninguna.
  return elegidas.length > 0 ? elegidas : reporte.columnas
}

interface ReporteArmado {
  reporte: Reporte
  columnas: ColumnaDeReporte[]
  filas: ValorDeCelda[][]
  /** Lo que se escribe arriba de todo: qué reporte es y con qué filtros salió. */
  titulo: string
}

function descripcionDeFiltros(reporte: Reporte, filtros: FiltrosDeReporte): string {
  const partes: string[] = []
  if (reporte.filtros.includes('periodo')) {
    const periodo = limpiar(filtros.periodo)
    // La planilla del mes siempre sale de un mes concreto: si no se eligió, es el mes abierto.
    if (periodo && FORMATO_PERIODO.test(periodo)) partes.push(nombreDePeriodo(periodo))
    else if (reporte.id === 'cartera') partes.push(nombreDePeriodo(periodoElegido(filtros)))
  }
  if (reporte.filtros.includes('fechas')) {
    const desde = limpiar(filtros.desde)
    const hasta = limpiar(filtros.hasta)
    if (desde && hasta) partes.push(`del ${desde} al ${hasta}`)
    else if (desde) partes.push(`desde el ${desde}`)
    else if (hasta) partes.push(`hasta el ${hasta}`)
  }
  if (limpiar(filtros.sucursal)) partes.push(limpiar(filtros.sucursal))
  if (limpiar(filtros.compania)) partes.push(limpiar(filtros.compania))
  if (limpiar(filtros.estado)) partes.push(`${reporte.etiquetaDeEstado}: ${limpiar(filtros.estado)}`)
  if (limpiar(filtros.busqueda)) partes.push(`«${limpiar(filtros.busqueda)}»`)
  return partes.join(' · ')
}

function armar(pedido: PedidoDeReporte): ReporteArmado {
  const reporte = buscarReporte(limpiar(pedido?.reporteId))
  const filtros = { ...FILTROS_DE_REPORTE_VACIOS, ...(pedido?.filtros ?? {}) }
  const columnas = columnasElegidas(reporte, pedido?.columnas)
  const filas = filtrarEnMemoria(reporte, reporte.obtener(filtros), filtros).map((fila) =>
    columnas.map((columna) => fila[columna.id] ?? null),
  )
  const detalle = descripcionDeFiltros(reporte, filtros)
  return { reporte, columnas, filas, titulo: detalle ? `${reporte.nombre} — ${detalle}` : reporte.nombre }
}

// ---------------------------------------------------------------------------
// Lo que usan los canales
// ---------------------------------------------------------------------------

export function catalogoDeReportes(): CatalogoDeReportes {
  const catalogo = catalogos()
  return {
    reportes: REPORTES.map(
      (reporte): DefinicionDeReporte => ({
        id: reporte.id,
        nombre: reporte.nombre,
        descripcion: reporte.descripcion,
        filtros: reporte.filtros,
        columnas: reporte.columnas,
        estados: reporte.estados,
        etiquetaDeEstado: reporte.etiquetaDeEstado,
      }),
    ),
    periodos: periodosDisponibles().map((p) => p.periodo),
    sucursales: catalogo.sucursales,
    companias: catalogo.companias,
    hoy: hoyLocal(),
  }
}

/** Un texto para mostrar en la vista previa: los números se ven como los escribe la agencia. */
function comoTexto(valor: ValorDeCelda): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'number') return Number.isInteger(valor) ? valor.toLocaleString('es-AR') : valor.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return valor
}

export function vistaPreviaDeReporte(pedido: PedidoDeReporte): VistaPreviaDeReporte {
  const armado = armar(pedido)
  const mostradas = armado.filas.slice(0, FILAS_DE_VISTA_PREVIA)
  return {
    reporteId: armado.reporte.id,
    nombre: armado.titulo,
    columnas: armado.columnas,
    filas: mostradas.map((fila) => fila.map(comoTexto)),
    total: armado.filas.length,
    mostradas: mostradas.length,
  }
}

function nombreDeArchivo(armado: ReporteArmado, extension: string): string {
  return `${paraNombreDeArchivo(armado.titulo.replace(/ — /g, ' - '))}.${extension}`
}

export function xlsxDelReporte(pedido: PedidoDeReporte): { nombre: string; contenido: Buffer } {
  const armado = armar(pedido)
  const hoja: HojaXlsx = {
    nombre: armado.reporte.nombre,
    titulo: armado.titulo,
    encabezados: armado.columnas.map((columna) => columna.titulo),
    anchos: armado.columnas.map((columna) => columna.ancho),
    filas: armado.filas,
  }
  return { nombre: nombreDeArchivo(armado, 'xlsx'), contenido: construirXlsx([hoja]) }
}

/**
 * El PDF va apaisado y con la tabla en letra chica: un reporte de la agencia tiene quince columnas y
 * en vertical no entra ninguna.
 */
export function htmlDelReporte(pedido: PedidoDeReporte): { nombre: string; html: string } {
  const armado = armar(pedido)
  const encabezados = armado.columnas
    .map((columna) => `<th class="${columna.numerica ? 'num' : ''}">${escaparXml(columna.titulo)}</th>`)
    .join('')
  const cuerpo = armado.filas
    .map(
      (fila) =>
        `<tr>${fila
          .map((valor, i) => `<td class="${armado.columnas[i]?.numerica ? 'num' : ''}">${escaparXml(comoTexto(valor))}</td>`)
          .join('')}</tr>`,
    )
    .join('')
  const vacio = armado.filas.length === 0 ? `<p class="vacio">No hay filas con esos filtros.</p>` : ''

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escaparXml(armado.titulo)}</title><style>
@page { size: A4 landscape; margin: 12mm 10mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 0; font-size: 8.5pt; }
h1 { font-size: 14pt; margin: 0 0 2mm; color: #0f2c4c; }
.pie { color: #64748b; font-size: 8pt; margin: 0 0 4mm; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { background: #e2e8f0; text-align: left; font-weight: 700; border-bottom: 1px solid #94a3b8; }
th, td { padding: 1.2mm 1.6mm; border-bottom: 1px solid #e2e8f0; vertical-align: top; word-break: break-word; }
tr { break-inside: avoid; }
.num { text-align: right; white-space: nowrap; }
.vacio { color: #64748b; padding: 6mm 0; }
</style></head><body>
<h1>${escaparXml(armado.titulo)}</h1>
<p class="pie">Seguros Daniel Martínez · ${armado.filas.length} fila(s) · generado el ${hoyLocal()}</p>
${vacio || `<table><thead><tr>${encabezados}</tr></thead><tbody>${cuerpo}</tbody></table>`}
</body></html>`
  return { nombre: nombreDeArchivo(armado, 'pdf'), html }
}

// ---------------------------------------------------------------------------
// El reporte especial: la planilla clásica
// ---------------------------------------------------------------------------

/**
 * Las columnas de la planilla mensual tal cual las escribe la agencia en la hoja «GENERAL DE
 * CLIENTES» (las de AGOSTO, que es la más completa y la que define el formato). El orden es parte del
 * trato: quien recibe el archivo tiene que reconocerlo de un vistazo, no leerlo.
 */
const COLUMNAS_CLASICAS: Array<{ titulo: string; campo: string; ancho: number }> = [
  { titulo: 'APELLIDO Y NOMBRE', campo: 'nombre', ancho: 30 },
  { titulo: 'DNI', campo: 'documento', ancho: 15 },
  { titulo: 'TELEFONO', campo: 'telefono', ancho: 16 },
  { titulo: 'EMAIL', campo: 'email', ancho: 26 },
  { titulo: 'DOMICILIO', campo: 'direccion', ancho: 26 },
  { titulo: 'LOCALIDAD', campo: 'localidad', ancho: 18 },
  { titulo: 'SUCURSAL', campo: 'sucursal', ancho: 14 },
  { titulo: 'FECHA DE NACIMIENTO', campo: 'fechaNacimiento', ancho: 15 },
  { titulo: 'COMPAÑIA', campo: 'compania', ancho: 20 },
  { titulo: 'NRO DE POLIZA', campo: 'numeroPoliza', ancho: 16 },
  { titulo: 'COBERTURA', campo: 'cobertura', ancho: 16 },
  { titulo: 'PRIMA', campo: 'prima', ancho: 13 },
  { titulo: 'FORMA DE PAGO', campo: 'formaPago', ancho: 16 },
  { titulo: 'PRODUCTOR', campo: 'productor', ancho: 16 },
  { titulo: 'ESTADO', campo: 'estado', ancho: 12 },
  { titulo: 'VIGENCIA DESDE', campo: 'vigenciaDesde', ancho: 14 },
  { titulo: 'VIGENCIA HASTA', campo: 'vigenciaHasta', ancho: 14 },
  { titulo: 'ALTA', campo: 'alta', ancho: 12 },
  { titulo: 'MARCA', campo: 'marca', ancho: 14 },
  { titulo: 'MODELO', campo: 'modelo', ancho: 18 },
  { titulo: 'AÑO', campo: 'anio', ancho: 7 },
  { titulo: 'DOMINIO', campo: 'patente', ancho: 11 },
  { titulo: 'MOTOR', campo: 'motor', ancho: 18 },
  { titulo: 'CHASIS', campo: 'chasis', ancho: 20 },
  { titulo: 'USO', campo: 'uso', ancho: 12 },
  { titulo: 'COLOR', campo: 'color', ancho: 12 },
  { titulo: 'SUMA ASEGURADA', campo: 'sumaAsegurada', ancho: 15 },
  { titulo: 'CUOTA', campo: 'cuota', ancho: 12 },
  { titulo: 'DIA DE VTO', campo: 'diaVencimiento', ancho: 11 },
  { titulo: 'AVISO', campo: 'aviso', ancho: 12 },
  { titulo: 'PAGO', campo: 'pago', ancho: 13 },
  { titulo: 'OBS', campo: 'observaciones', ancho: 34 },
]

/** Las columnas de una pestaña de BAJAS, también como están en la hoja. */
const COLUMNAS_CLASICAS_DE_BAJAS: Array<{ titulo: string; campo: string; ancho: number }> = [
  { titulo: 'NOMBRE', campo: 'nombre', ancho: 30 },
  { titulo: 'DNI', campo: 'documento', ancho: 15 },
  { titulo: 'CIA', campo: 'compania', ancho: 20 },
  { titulo: 'N° POLIZA', campo: 'numeroPoliza', ancho: 16 },
  { titulo: 'PATENTE', campo: 'patente', ancho: 11 },
  { titulo: 'MOTIVO', campo: 'motivo', ancho: 20 },
  { titulo: 'MES', campo: 'mes', ancho: 12 },
  { titulo: 'FECHA DE BAJA', campo: 'fechaBaja', ancho: 14 },
  { titulo: 'OBSERVACIONES', campo: 'observaciones', ancho: 34 },
]

function filasClasicasDelMes(periodo: string, sucursal: string): FilaDeReporte[] {
  const filas = db()
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(c.cliente_nombre), ''), cl.nombre) AS nombre,
              COALESCE(NULLIF(TRIM(c.documento), ''), cl.documento) AS documento,
              cl.telefono, cl.email, cl.direccion, cl.localidad,
              COALESCE(NULLIF(TRIM(c.sucursal_texto), ''), cl.sucursal_texto) AS sucursal,
              cl.fecha_nacimiento AS fechaNacimiento,
              COALESCE(NULLIF(TRIM(c.compania), ''), p.compania) AS compania,
              COALESCE(NULLIF(TRIM(c.numero_poliza), ''), p.numero) AS numeroPoliza,
              p.cobertura, p.prima,
              COALESCE(NULLIF(TRIM(c.forma_pago), ''), p.forma_pago) AS formaPago,
              p.productor, p.estado_texto AS estado,
              p.vigencia_desde AS vigenciaDesde, p.vigencia_hasta AS vigenciaHasta, p.alta,
              v.marca, v.modelo, v.anio,
              COALESCE(NULLIF(TRIM(c.patente), ''), v.patente) AS patente,
              v.motor, v.chasis, v.uso, v.color, v.suma_asegurada AS sumaAsegurada,
              c.cuota, c.dia_vencimiento AS diaVencimiento, c.aviso, c.pago, c.observaciones
         FROM cuotas_mes c
         LEFT JOIN clientes cl ON cl.id = c.cliente_id
         LEFT JOIN polizas p ON p.id = c.poliza_id
         LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
        WHERE c.periodo = ? AND c.dada_de_baja = 0
        ORDER BY c.dia_vencimiento_numero, nombre`,
    )
    .all(periodo) as FilaDeReporte[]
  return sucursal ? filas.filter((fila) => mismaCosa(fila.sucursal, sucursal)) : filas
}

function filasClasicasDeBajas(periodo: string, sucursal: string): FilaDeReporte[] {
  const filas = db()
    .prepare(
      `SELECT b.cliente_nombre AS nombre, b.documento, b.compania, b.numero_poliza AS numeroPoliza, b.patente,
              b.motivo, COALESCE(NULLIF(TRIM(b.mes_texto), ''), b.periodo) AS mes,
              COALESCE(b.fecha_baja, b.fecha_baja_iso) AS fechaBaja,
              COALESCE(NULLIF(TRIM(b.observaciones), ''), b.nota) AS observaciones,
              COALESCE(NULLIF(TRIM(b.sucursal_texto), ''), cl.sucursal_texto) AS sucursal
         FROM bajas b LEFT JOIN clientes cl ON cl.id = b.cliente_id
        WHERE b.periodo = ?
        ORDER BY nombre`,
    )
    .all(periodo) as FilaDeReporte[]
  return sucursal ? filas.filter((fila) => mismaCosa(fila.sucursal, sucursal)) : filas
}

/**
 * La «Planilla clásica»: un .xlsx con el formato exacto de la hoja mensual, una pestaña por mes
 * elegido y su pestaña de BAJAS al lado. Es lo que se imprime y lo que se le manda al contador, así
 * que no lleva ni título ni resumen: arranca en la fila de encabezados, como la hoja de siempre.
 */
export function xlsxDePlanillaClasica(opciones: OpcionesPlanillaClasica): { nombre: string; contenido: Buffer } {
  const disponibles = periodosDisponibles().map((p) => p.periodo)
  const pedidos = Array.isArray(opciones?.periodos) ? opciones.periodos.map(limpiar).filter((p) => FORMATO_PERIODO.test(p)) : []
  const periodos = [...new Set(pedidos.length > 0 ? pedidos : disponibles.slice(0, 1))].sort()
  if (periodos.length === 0) {
    throw new ErrorDeNegocio('Todavía no hay ninguna planilla cargada: importá la hoja de Google antes de exportarla.')
  }
  const sucursal = limpiar(opciones?.sucursal)
  // Si se piden meses de más de un año, el nombre de la pestaña lleva el año: si no, dos «AGOSTO».
  const variosAnios = new Set(periodos.map((periodo) => periodo.slice(0, 4))).size > 1
  const nombreDelMes = (periodo: string) =>
    variosAnios ? `${nombreDePestanaMensual(periodo)} ${periodo.slice(2, 4)}` : nombreDePestanaMensual(periodo)

  const hojas: HojaXlsx[] = []
  for (const periodo of periodos) {
    hojas.push({
      nombre: nombreDelMes(periodo),
      titulo: null,
      encabezados: COLUMNAS_CLASICAS.map((columna) => columna.titulo),
      anchos: COLUMNAS_CLASICAS.map((columna) => columna.ancho),
      filas: filasClasicasDelMes(periodo, sucursal).map((fila) => COLUMNAS_CLASICAS.map((columna) => fila[columna.campo] ?? null)),
    })
    hojas.push({
      // La pestaña de bajas se llama como en la hoja si ya existe allá; si no, «BAJAS <MES>».
      nombre: variosAnios ? `BAJAS ${nombreDelMes(periodo)}` : pestanaDeBajas(periodo),
      titulo: null,
      encabezados: COLUMNAS_CLASICAS_DE_BAJAS.map((columna) => columna.titulo),
      anchos: COLUMNAS_CLASICAS_DE_BAJAS.map((columna) => columna.ancho),
      filas: filasClasicasDeBajas(periodo, sucursal).map((fila) =>
        COLUMNAS_CLASICAS_DE_BAJAS.map((columna) => fila[columna.campo] ?? null),
      ),
    })
  }

  const sufijo = sucursal ? ` - ${sucursal}` : ''
  const rango = periodos.length === 1 ? nombreDePeriodo(periodos[0]!) : `${periodos[0]} a ${periodos[periodos.length - 1]}`
  return {
    nombre: `${paraNombreDeArchivo(`Planilla clasica ${rango}${sufijo}`)}.xlsx`,
    contenido: construirXlsx(hojas),
  }
}
