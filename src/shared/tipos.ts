// Tipos compartidos entre el proceso principal, la precarga y el renderer.
// Este archivo no puede importar nada de Electron ni de Node: lo usan los tres lados.
import type { DireccionEstructurada } from './direccion'
import type { MatrizPermisos, PermisosDeUnRol } from './permisos'
// Sólo el tipo: `ramas.ts` importa de acá `CategoriaDeVehiculo`, también sólo el tipo, así que las dos
// flechas se borran al compilar y no queda ningún ciclo en tiempo de ejecución.
import type { Rama } from './ramas'

export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'EMPLEADO'] as const
export type Rol = (typeof ROLES)[number]

/** Nombre legible de cada rol, para mostrar en la interfaz. */
export const NOMBRE_ROL: Record<Rol, string> = {
  SUPER_ADMIN: 'Superadministrador',
  ADMIN: 'Administrador',
  EMPLEADO: 'Empleado',
}

export interface Sucursal {
  id: number
  nombre: string
}

/** Usuario tal como lo ve la pantalla de Administración. Nunca incluye el hash. */
export interface Usuario {
  id: number
  nombre: string
  usuario: string
  rol: Rol
  sucursalId: number
  sucursalNombre: string
  activo: boolean
  debeCambiarClave: boolean
  creadoEn: string
  actualizadoEn: string
}

/** Datos del usuario con la sesión abierta. */
export interface SesionUsuario {
  id: number
  nombre: string
  usuario: string
  rol: Rol
  sucursal: Sucursal
  debeCambiarClave: boolean
}

export interface CredencialesIngreso {
  usuario: string
  clave: string
}

export interface CambioDeClave {
  claveActual: string
  claveNueva: string
}

export interface DatosNuevoUsuario {
  nombre: string
  usuario: string
  clave: string
  rol: Rol
  sucursalId: number
}

export interface DatosEdicionUsuario {
  nombre: string
  usuario: string
  rol: Rol
  sucursalId: number
}

export interface DatosConexionGoogle {
  /** Contenido completo del JSON de la cuenta de servicio. Vacío = conservar el actual. */
  cuentaServicioJson: string
  urlHoja: string
}

/** Estado de la conexión con Google. Nunca expone la clave privada al renderer. */
export interface EstadoConexionGoogle {
  configurado: boolean
  clientEmail: string | null
  projectId: string | null
  urlHoja: string | null
  actualizadoEn: string | null
}

// ---------------------------------------------------------------------------
// La base del GENERAL DE CLIENTES en el VPS — v12
// ---------------------------------------------------------------------------

export interface EstadoBaseVps {
  inicializada: boolean
  inicializada_en: string | null
  pestanas: number
  filas: number
}

export interface EstadoMigracionVps {
  urlBase: string
  googleConfigurado: boolean
  base: EstadoBaseVps | null
  /** Por qué no se pudo consultar la base (sin internet, token inválido, servidor sin configurar). */
  error: string | null
}

export interface ResumenMigracionVps {
  pestanas: number
  filas: number
}

// ---------------------------------------------------------------------------
// Base de usuarios compartida (GitHub) e ingreso sin internet — Fase 11
// ---------------------------------------------------------------------------

/**
 * Cómo está trabajando el ingreso en esta computadora:
 * - `local`: sin base compartida (desarrollo sin token, o versión publicada sin token). Usuarios locales, como antes.
 * - `sin-inicializar`: hay base compartida configurada pero todavía nadie subió los usuarios. Se ingresa con
 *   los usuarios locales hasta que un superadministrador los suba desde Administración → Usuarios.
 * - `en-linea`: el último ingreso o comprobación se validó contra GitHub.
 * - `sin-internet`: no se pudo llegar a GitHub (falla de red o tiempo agotado).
 * - `error-remoto`: hay internet pero GitHub respondió con error (token vencido, repositorio inaccesible, archivo dañado).
 */
export type ModoDeAcceso = 'local' | 'sin-inicializar' | 'en-linea' | 'sin-internet' | 'error-remoto'

export interface EstadoDeAcceso {
  /** false = el programa trabaja con usuarios locales. */
  configurada: boolean
  /** Dónde vive la base compartida, para mostrarlo («GitHub zeroframe404/dm-gestion-datos»). */
  repo: string | null
  modo: ModoDeAcceso
  /** Si es una versión publicada sin token: se avisa, porque no es lo esperado. */
  sinTokenEnProduccion: boolean
  /** El único usuario que puede ingresar sin internet en esta computadora (el último que ingresó con conexión). */
  usuarioGuardado: string | null
  /** false si el sistema no puede cifrar: no se guarda credencial y no va a poder ingresarse sin internet. */
  puedeGuardarCredencial: boolean
  /** Cuántos usuarios tiene la base compartida según la última lectura. */
  cantidad: number | null
  ultimaComprobacion: string | null
  /** Última lectura que terminó bien (sirve para decir «sin internet desde hace 2 horas»). */
  ultimaLecturaBuena: string | null
  /** Error ya traducido, listo para mostrar. */
  ultimoError: string | null
  /** Fecha (AAAA-MM-DD) en que vence el token embebido, si quien armó el programa la anotó. */
  tokenVence: string | null
  /** true cuando la sesión abierta se validó con la credencial guardada y todavía no se confirmó contra GitHub. */
  sesionSinConfirmar: boolean
}

// ---------------------------------------------------------------------------
// Permisos por rol (Administración → Permisos)
// ---------------------------------------------------------------------------
// Las áreas, los niveles y la matriz están en shared/permisos.ts, que es puro y lo usan los tres
// lados. Acá viven nada más que las formas que viajan por IPC.

/** Lo que ve la pantalla de permisos. */
export interface MatrizDePermisos {
  permisos: MatrizPermisos
  /** Sólo el SUPER_ADMIN puede tocarla. */
  puedeEditar: boolean
  /**
   * `compartida` = la matriz vive en usuarios.json y vale para todas las computadoras.
   * `local` = todavía no hay base compartida (desarrollo, o antes de subir los usuarios) y sólo rige acá.
   */
  origen: 'compartida' | 'local'
  actualizadoEn: string | null
}

/** Lo que le toca al usuario con la sesión abierta: es lo que consulta el renderer para mostrar u ocultar. */
export interface MisPermisos {
  rol: Rol
  areas: PermisosDeUnRol
  /**
   * Si puede ver los números agregados de la agencia (el bruto cobrado en el mes, la comisión
   * estimada, el porcentaje de cada compañía). Va aparte de `areas` porque no dice a qué módulo
   * entra sino qué números ve adentro. Lo decide el rol; el proceso principal ya filtra lo que
   * manda, así que esto es sólo para que la pantalla no dibuje huecos.
   */
  veNumerosDeLaAgencia: boolean
}

/** Lo que necesita Administración → Usuarios además de la lista. */
export interface EstadoDeUsuarios {
  acceso: EstadoDeAcceso
  /** De dónde salió la lista que se muestra. */
  origen: 'github' | 'copia-local' | 'local' | 'sin-inicializar'
  /** Usuarios de esta computadora que se subirían al inicializar la base compartida. */
  localesParaSubir: string[]
}

/** El proceso principal cerró la sesión por su cuenta (usuario desactivado o contraseña cambiada desde otra computadora). */
export interface SesionCerrada {
  motivo: string
}

export interface InfoApp {
  nombre: string
  version: string
  electron: string
  chrome: string
  node: string
  plataforma: string
  carpetaDatos: string
  rutaBaseDeDatos: string
  rutaConfig: string
}

/**
 * `deshabilitada` es el caso de desarrollo (`npm run dev`): sin instalador no hay de dónde bajar
 * actualizaciones, así que ni se intenta. En un ejecutable empaquetado nunca aparece.
 */
export type SituacionActualizacion = 'deshabilitada' | 'buscando' | 'al-dia' | 'descargando' | 'lista' | 'error'

export interface EstadoActualizacion {
  situacion: SituacionActualizacion
  /** Versión detectada o descargada, cuando hay una novedad. */
  version: string | null
  /** Progreso de la descarga en curso, 0 a 100. */
  porcentaje: number | null
  canal: string
  ultimoChequeo: string | null
  ultimoError: string | null
}

/**
 * Respuesta estándar de todo llamado IPC. Los errores esperables (validación,
 * permisos, credenciales) vuelven como `ok: false` con un mensaje listo para mostrar.
 */
export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string }

export const LARGO_MINIMO_CLAVE = 8

// ---------------------------------------------------------------------------
// Importación desde Google Sheets
// ---------------------------------------------------------------------------

/** Qué contiene una pestaña de la hoja, deducido de su título. */
export type TipoPestana =
  | 'MENSUAL'
  | 'BAJAS'
  | 'RIESGOS_VARIOS'
  | 'SINIESTROS'
  | 'PAGOS'
  | 'COBERTURA'
  | 'CONTADOR'
  | 'SEGUROS_ACT'
  | 'AMP'
  // Las tres pestañas que crea DM Gestión al final de la hoja: no vienen del Excel de la agencia,
  // las escribe la aplicación para que lo comercial también se pueda mirar desde Google.
  | 'APP_LEADS'
  | 'APP_PRESUPUESTOS'
  | 'APP_TAREAS'
  | 'APP_RECHAZOS'
  | 'OTRA'

export const NOMBRE_TIPO_PESTANA: Record<TipoPestana, string> = {
  MENSUAL: 'Planilla mensual',
  BAJAS: 'Bajas',
  RIESGOS_VARIOS: 'Riesgos varios',
  SINIESTROS: 'Siniestros',
  PAGOS: 'Pagos imputados',
  COBERTURA: 'Reglas de cobertura',
  CONTADOR: 'Contador (sólo crudo)',
  SEGUROS_ACT: 'Seguros act. (sólo crudo)',
  AMP: 'AMP (ampliaciones)',
  APP_LEADS: 'Leads (la escribe DM Gestión)',
  APP_PRESUPUESTOS: 'Presupuestos (la escribe DM Gestión)',
  APP_TAREAS: 'Tareas (la escribe DM Gestión)',
  APP_RECHAZOS: 'Rechazos de débito (la escribe DM Gestión)',
  OTRA: 'Sin clasificar (sólo crudo)',
}

export interface PestanaDetectada {
  sheetId: number
  titulo: string
  indice: number
  filas: number
  columnas: number
  tipo: TipoPestana
  /** 'AAAA-MM' para planillas mensuales y bajas con mes; null si no aplica. */
  periodo: string | null
  /** La planilla mensual más nueva: de ella salen clientes, vehículos y pólizas activas. */
  esLaMasNueva: boolean
  /** La pestaña está oculta en Google: no puede definir la cartera actual. */
  oculta: boolean
}

export interface VistaPreviaHoja {
  hojaId: string
  titulo: string
  pestanas: PestanaDetectada[]
}

export type EstadoImportacion = 'EN_CURSO' | 'COMPLETA' | 'CON_ERRORES' | 'CANCELADA' | 'FALLIDA'

export type EstadoPestanaImportada =
  | 'pendiente'
  | 'leyendo'
  | 'escribiendo_ids'
  | 'guardando'
  | 'lista'
  | 'error'
  | 'omitida'

export interface ColumnaMapeada {
  /** Letra de la columna en la hoja (A, B, …, BA). */
  columna: string
  /** Encabezado tal cual está en la fila 1. */
  encabezado: string
  /** Campo del modelo al que se asignó, o null si quedó sólo en los datos crudos. */
  campo: string | null
  nota: string | null
}

export interface ProblemaImportacion {
  pestana: string
  /** Número de fila en la hoja (1 = encabezados); null si no refiere a una fila. */
  fila: number | null
  filaId: string | null
  tipo: string
  detalle: string
}

export interface ResumenPestana {
  titulo: string
  tipo: TipoPestana
  periodo: string | null
  estado: EstadoPestanaImportada
  filasLeidas: number
  filasConDatos: number
  idsNuevos: number
  idsExistentes: number
  columnaId: string | null
  columnas: ColumnaMapeada[]
  /** Registros escritos por tabla, por ejemplo { cuotas_mes: 130, clientes: 128 }. */
  registros: Record<string, number>
  problemas: number
  error: string | null
}

export interface TotalesImportacion {
  clientes: number
  vehiculos: number
  polizas: number
  polizasInactivadas: number
  cuotasMes: number
  bajas: number
  riesgosVarios: number
  siniestros: number
  amp: number
  reglasCobertura: number
  pagos: number
  filasCrudas: number
  /** Filas que estaban en la hoja en una importación anterior y ahora no: quedan marcadas, no se borran. */
  filasQueYaNoEstan: number
  problemas: number
}

export interface InformeImportacion {
  id: number
  iniciadaEn: string
  terminadaEn: string | null
  estado: EstadoImportacion
  hojaId: string
  hojaTitulo: string
  pestanaMasNueva: string | null
  pestanas: ResumenPestana[]
  totales: TotalesImportacion
  /** Cantidad de problemas por tipo (siempre exacta, aunque la lista esté recortada). */
  problemasPorTipo: Record<string, number>
  /** Valores de sucursal fuera del catálogo y cuántas filas los usan. */
  sucursalesDesconocidas: Record<string, number>
  problemas: ProblemaImportacion[]
  problemasOmitidos: number
  avisos: string[]
  rutaInforme: string | null
  error: string | null
}

export interface ProgresoPestana {
  titulo: string
  tipo: TipoPestana
  estado: EstadoPestanaImportada
  filas: number | null
  detalle: string | null
}

export interface ProgresoImportacion {
  importacionId: number
  fase: 'preparando' | 'pestanas' | 'consolidando' | 'terminada'
  porcentaje: number
  mensaje: string
  pestanas: ProgresoPestana[]
}

export interface EstadoImportador {
  enCurso: boolean
  progreso: ProgresoImportacion | null
  ultima: InformeImportacion | null
}

// ---------------------------------------------------------------------------
// Cartera: la planilla del mes
// ---------------------------------------------------------------------------

/** Compañía aseguradora con sus días de cobertura financiera (los que sigue cubriendo tras el vencimiento). */
export interface Compania {
  id: number
  nombre: string
  diasCoberturaFinanciera: number
  /**
   * Porcentaje de comisión que deja la compañía. 0 = todavía no se cargó; `null` = quien está mirando
   * no ve los números de la agencia (un empleado), y por eso el dato ni siquiera viajó.
   */
  comisionPorcentaje: number | null
  /**
   * Cada cuántos meses hay que renovar a mano en esta compañía (Agrosalta 4, Río Uruguay 6, Metropol
   * 12). `null` = la compañía renueva sola: sus pólizas no entran en la bandeja de renovaciones.
   */
  mesesRenovacion: number | null
  activa: boolean
  /** Cuántas pólizas activas tiene hoy. */
  polizas: number
}

export interface DatosDeCompania {
  nombre: string
  diasCoberturaFinanciera: number
  comisionPorcentaje: number
  /** Meses entre renovaciones, o null si la compañía renueva sola. */
  mesesRenovacion: number | null
  activa: boolean
}

/** Un período con datos y cuántas filas tiene, para el selector de mes. */
export interface PeriodoCartera {
  periodo: string
  filas: number
  /** El período abierto: el más nuevo. Los anteriores son de sólo lectura. */
  esElActual: boolean
}

/** Una fila de la planilla del mes, con todo lo que muestra la tabla y el panel de detalle. */
export interface FilaCartera {
  filaId: string
  cuotaId: number
  periodo: string
  polizaId: number | null
  clienteId: number | null
  vehiculoId: number | null

  sucursal: string | null
  nombre: string | null
  telefono: string | null
  documento: string | null
  diaVencimiento: string | null
  diaVencimientoNumero: number | null
  cuota: string | null
  cuotaMonto: number | null
  formaPago: string | null
  aviso: string | null
  fechaEnvio: string | null
  avisarVto: string | null
  vehiculo: string | null
  /**
   * La categoría que le puso el catálogo de vehículos («PICKUP», «SUV»…), o null cuando el vehículo se
   * tipeó a mano y nadie la sabe. No se muestra: sirve para deducir la RAMA de la fila, porque una pick
   * up cargada desde «Nueva póliza» queda con `vehiculo = 'AUTO'` y la rama sólo se ve acá.
   */
  categoriaVehiculo: CategoriaDeVehiculo | null
  marca: string | null
  modelo: string | null
  patente: string | null
  anio: string | null
  cobertura: string | null
  compania: string | null
  numeroPoliza: string | null
  /** Número de propuesta: algunas compañías lo dan antes de emitir la póliza. */
  propuesta: string | null
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  observaciones: string | null

  /** CUANDO PAGO tal cual está en la planilla, y su fecha interpretada. */
  pago: string | null
  pagoFecha: string | null
  /**
   * true si además hay un pago cargado desde la aplicación para esta póliza y este mes. No cuenta un
   * pago adelantado que quedó PENDIENTE de imputar (ver `pagoAdelantado`) ni un cobro IMPUTADO.
   */
  pagoRegistrado: boolean
  /**
   * true si la cuota está IMPUTADA: la agencia ya la pagó a la compañía y el cliente todavía no
   * transfirió. La fila no figura paga; falta cobrarla.
   */
  pagoImputado: boolean
  /**
   * El pago adelantado que espera a esta fila: se cobró el mes anterior para este mes y todavía no se
   * imputó (quedó PENDIENTE, o la fila se creó después). null si no hay ninguno.
   */
  pagoAdelantado: PagoAdelantadoDeFila | null
  /** Si desde esta fila se adelantó la cuota del mes siguiente, cuándo y cuánto. null si no. */
  adelantoSiguiente: AdelantoSiguienteDeFila | null

  /** Datos que no entran en la tabla pero sí en el panel de detalle. */
  email: string | null
  direccion: string | null
  localidad: string | null
  motor: string | null
  chasis: string | null
  uso: string | null
  color: string | null
  prima: string | null
  productor: string | null
  alta: string | null
  polizaActiva: boolean
  /** Días de cobertura financiera de su compañía, ya resueltos. */
  diasCobertura: number
}

/** Campos de la planilla que se pueden editar con doble clic. */
export type CampoEditable =
  | 'sucursal'
  | 'nombre'
  | 'telefono'
  | 'documento'
  | 'diaVencimiento'
  | 'cuota'
  | 'formaPago'
  | 'aviso'
  | 'vehiculo'
  | 'marca'
  | 'modelo'
  | 'patente'
  | 'anio'
  | 'cobertura'
  | 'compania'
  | 'numeroPoliza'
  | 'propuesta'
  | 'vigenciaDesde'
  | 'vigenciaHasta'
  | 'observaciones'
  | 'pago'
  | 'avisarVto'
  | 'email'
  | 'direccion'
  | 'localidad'
  | 'motor'
  | 'chasis'
  | 'uso'
  | 'color'
  | 'prima'
  | 'productor'

/** Catálogos para los desplegables de la planilla. */
export interface CatalogosCartera {
  formasDePago: string[]
  sucursales: string[]
  companias: string[]
  coberturas: string[]
  tiposDeVehiculo: string[]
  /**
   * Las siete ramas de la agencia más lo que la base tenga y el catálogo no conozca. Ver
   * `src/shared/ramas.ts`: la lista cerrada está SIEMPRE completa, aunque el mes que se mira no tenga
   * ninguna moto, para que el desplegable diga lo mismo en las cinco computadoras.
   */
  ramas: string[]
  mediosDePago: string[]
}

export interface PlanillaDelMes {
  periodo: string
  soloLectura: boolean
  filas: FilaCartera[]
  catalogos: CatalogosCartera
  /** Días de cobertura financiera por compañía normalizada, para calcular el semáforo. */
  diasCoberturaPorCompania: Record<string, number>
  periodos: PeriodoCartera[]
  /** Fecha de hoy según la máquina, 'AAAA-MM-DD'. */
  hoy: string
}

export const MOTIVOS_DE_BAJA = [
  'VENDIO',
  'ANULA POR FALTA DE PAGO',
  'ANULA POR DECISION DEL CLIENTE',
  'CAMBIO DE COMPANIA',
  'VOLVIO CON OTRO VEHICULO',
  'OTRO',
] as const
export type MotivoDeBaja = (typeof MOTIVOS_DE_BAJA)[number]

export const NOMBRE_MOTIVO_BAJA: Record<MotivoDeBaja, string> = {
  VENDIO: 'Vendió el vehículo',
  'ANULA POR FALTA DE PAGO': 'Anula por falta de pago',
  'ANULA POR DECISION DEL CLIENTE': 'Anula por decisión del cliente',
  'CAMBIO DE COMPANIA': 'Cambió de compañía',
  'VOLVIO CON OTRO VEHICULO': 'Volvió con otro vehículo',
  OTRO: 'Otro',
}

export interface DatosDePago {
  fecha: string
  importe: string
  medioDePago: string
  /** Sucursal donde entró la plata. Vacío = la del usuario que está cobrando. */
  sucursal?: string
  /**
   * PAGO (el cliente pagó; es lo de siempre) o IMPUTADO (la agencia le imputó la cuota a la compañía
   * y el cliente transfiere después). Vacío = PAGO.
   */
  estadoCobro?: EstadoDeCobro
  /**
   * Qué cuota se está cobrando: la de este mes (MES, lo normal), la del mes que viene por adelantado
   * (ADELANTADO) o las dos juntas (AMBAS). Vacío = MES.
   */
  alcance?: AlcanceDelPago
  /** El pago adelantado, cuando `alcance` lo incluye. */
  adelanto?: DatosDeAdelanto
}

/** El estado del cobro de un pago: si el cliente ya pagó o si la agencia se lo imputó a la compañía. */
export const ESTADOS_DE_COBRO = ['PAGO', 'IMPUTADO'] as const
export type EstadoDeCobro = (typeof ESTADOS_DE_COBRO)[number]

export const NOMBRE_ESTADO_DE_COBRO: Record<EstadoDeCobro, string> = {
  PAGO: 'Pagó',
  IMPUTADO: 'Imputado (falta cobrar)',
}

export const ALCANCES_DEL_PAGO = ['MES', 'ADELANTADO', 'AMBAS'] as const
export type AlcanceDelPago = (typeof ALCANCES_DEL_PAGO)[number]

/**
 * Qué se hace con un pago adelantado cuando se arma el mes siguiente (el cierre de mes):
 *  - ACREDITAR: la fila del mes nuevo nace paga, con la fecha del pago en CUANDO PAGO;
 *  - PENDIENTE: la fila nace sin pagar y con el pago a la vista, para imputarlo a mano cuando se
 *    controle el general del mes.
 */
export const MODOS_DE_ADELANTO = ['ACREDITAR', 'PENDIENTE'] as const
export type ModoDeAdelanto = (typeof MODOS_DE_ADELANTO)[number]

export const NOMBRE_MODO_DE_ADELANTO: Record<ModoDeAdelanto, string> = {
  ACREDITAR: 'Acreditar al mes siguiente',
  PENDIENTE: 'Dejar pendiente para imputar',
}

export interface DatosDeAdelanto {
  /** Importe de la cuota adelantada. Vacío = la cuota de la fila. */
  importe: string
  modo: ModoDeAdelanto
}

/** Un pago adelantado que espera a una fila de la planilla (ver `FilaCartera.pagoAdelantado`). */
export interface PagoAdelantadoDeFila {
  pagoId: number
  fecha: string | null
  importe: string | null
  medio: string | null
  modo: ModoDeAdelanto
}

/** La cuota del mes siguiente adelantada desde una fila (ver `FilaCartera.adelantoSiguiente`). */
export interface AdelantoSiguienteDeFila {
  periodo: string
  fecha: string | null
  importe: string | null
  modo: ModoDeAdelanto
  /** true cuando ya se imputó a la fila del mes siguiente. */
  imputado: boolean
}

export interface DatosDeBaja {
  motivo: MotivoDeBaja
  nota: string
}

/** Lo que devuelve «Avisar»: la dirección de WhatsApp lista para abrir. */
export interface AvisoPreparado {
  url: string
  mensaje: string
  telefono: string
  fila: FilaCartera
}

/**
 * Una baja con todo lo que la fila tenía en la cartera, no sólo el nombre y el motivo.
 *
 * Los datos se guardan como una foto en el momento de la baja (la póliza puede cambiar después, y lo
 * que hay que poder mirar es cómo estaba cuando se fue). Las bajas que vinieron de la hoja o que se
 * cargaron antes de que existiera la foto completan lo que puedan desde el cliente, el vehículo y la
 * póliza, que siguen estando: por eso ningún campo es obligatorio.
 */
export interface FilaBaja {
  id: number
  filaId: string
  periodo: string | null
  clienteId: number | null
  clienteNombre: string | null
  documento: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  localidad: string | null
  compania: string | null
  numeroPoliza: string | null
  propuesta: string | null
  cobertura: string | null
  patente: string | null
  vehiculo: string | null
  /** Ver `FilaCartera.categoriaVehiculo`: la usa el filtro de rama de la pantalla de Bajas. */
  categoriaVehiculo: CategoriaDeVehiculo | null
  marca: string | null
  modelo: string | null
  anio: string | null
  motor: string | null
  chasis: string | null
  uso: string | null
  color: string | null
  cuota: string | null
  diaVencimiento: string | null
  formaPago: string | null
  prima: string | null
  productor: string | null
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  alta: string | null
  observaciones: string | null
  sucursal: string | null
  motivo: string | null
  nota: string | null
  fechaBaja: string | null
  polizaId: number | null
  /** true si la baja la cargó la aplicación (se puede deshacer); las importadas de la hoja, no. */
  hechaEnLaApp: boolean
  /**
   * true si la baja se puede volver a poner vigente: hace falta que se sepa de qué póliza es. Deshacer
   * (que es el «me equivoqué», del mismo mes) sigue pidiendo además que la baja la haya hecho la app.
   */
  puedeReactivarse: boolean
}

/**
 * Lo que se puede corregir al poner vigente una baja: el cliente que se fue y vuelve, capaz con otra
 * compañía, otra póliza o otra cuota. Vacío u omitido deja el dato tal como estaba en la baja.
 */
export interface CambiosDeReactivacion {
  compania?: string
  numeroPoliza?: string
  propuesta?: string
  cuota?: string
  diaVencimiento?: string
  formaPago?: string
}

/** Lo que devuelve «Poner vigente»: la baja volvió a la cartera y en qué mes quedó su fila. */
export interface ResultadoDeReactivacion {
  bajas: FilaBaja[]
  clienteNombre: string
  /** Mes en el que quedó la fila de la planilla, 'AAAA-MM'. */
  periodo: string
  /** true si hubo que crear la fila del mes abierto (la vieja era de un mes ya cerrado). */
  filaNueva: boolean
}

// ---------------------------------------------------------------------------
// Avisos de rechazo del débito automático
// ---------------------------------------------------------------------------
// Cuando a la agencia le rebota un débito (el CBU no tiene fondos, la cuenta se cerró, la tarjeta no
// pasó), quien lo ve tiene que poder avisarle a la sucursal del cliente para que lo llame y lo cobre.
// El aviso viaja a la hoja igual que los leads y las tareas, así llega a la computadora de la sucursal.

export const MOTIVOS_DE_RECHAZO = [
  'CBU RECHAZADO',
  'SIN FONDOS',
  'CUENTA CERRADA',
  'CBU MAL CARGADO',
  'TARJETA RECHAZADA',
  'OTRO',
] as const
export type MotivoDeRechazo = (typeof MOTIVOS_DE_RECHAZO)[number]

export const NOMBRE_MOTIVO_RECHAZO: Record<MotivoDeRechazo, string> = {
  'CBU RECHAZADO': 'Se rechazó el CBU',
  'SIN FONDOS': 'Sin fondos en la cuenta',
  'CUENTA CERRADA': 'La cuenta está cerrada',
  'CBU MAL CARGADO': 'El CBU está mal cargado',
  'TARJETA RECHAZADA': 'La tarjeta no pasó',
  OTRO: 'Otro',
}

/**
 * En qué anda el aviso:
 *  - PENDIENTE: nadie de la sucursal lo abrió todavía (es lo que enciende la campana);
 *  - VISTO: la sucursal lo abrió, pero el cobro sigue sin resolverse;
 *  - RESUELTO: se cobró o se corrigió el CBU. Deja de aparecer en lo pendiente.
 */
export const ESTADOS_DE_RECHAZO = ['PENDIENTE', 'VISTO', 'RESUELTO'] as const
export type EstadoDeRechazo = (typeof ESTADOS_DE_RECHAZO)[number]

export const NOMBRE_ESTADO_RECHAZO: Record<EstadoDeRechazo, string> = {
  PENDIENTE: 'Pendiente',
  VISTO: 'Visto',
  RESUELTO: 'Resuelto',
}

export interface FilaRechazo {
  id: number
  filaId: string | null
  polizaId: number | null
  clienteId: number | null
  clienteNombre: string | null
  documento: string | null
  telefono: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  formaPago: string | null
  cuota: string | null
  /** Mes de la cuota que rebotó, 'AAAA-MM'; null si el aviso no es de un mes puntual. */
  periodo: string | null
  /** La sucursal a la que va el aviso: la que tiene que llamar al cliente. */
  sucursal: string | null
  motivo: string | null
  nota: string | null
  estado: EstadoDeRechazo
  /** Día en que se avisó, 'AAAA-MM-DD'. */
  fecha: string
  avisadoPor: string | null
  vistoEn: string | null
  vistoPor: string | null
  resueltoEn: string | null
  resueltoPor: string | null
  creadoEn: string
}

export interface DatosDeRechazo {
  /** Sucursal a la que le llega el aviso. Vacío = la de la póliza, y si no la de quien avisa. */
  sucursal: string
  motivo: MotivoDeRechazo
  nota: string
}

export interface FiltrosRechazos {
  busqueda: string
  /** Vacío = todas. Se comparan con `mismaSucursal`, que pliega «AVELLANEDA» dentro de «Dock Sud». */
  sucursales: string[]
  /** '' = todos los estados. Es una pestaña con su contador, no un desplegable: se elige uno. */
  estado: '' | EstadoDeRechazo
}

export interface ListadoRechazos {
  filas: FilaRechazo[]
  /** Cuántos hay en cada estado, con la búsqueda y el filtro de sucursal puestos pero no el de estado. */
  porEstado: Record<EstadoDeRechazo, number>
  total: number
  sucursales: string[]
  hoy: string
}

/** Lo que mira la campana de rechazos de la barra superior: lo de la sucursal de quien entró. */
export interface AvisosDeRechazos {
  /** Avisos de la sucursal que todavía nadie abrió: son los que encienden el punto. */
  nuevos: number
  /** Los ids de esos mismos, sin tope. Es lo que decide si suena el aviso; ver `AvisosDeTareas`. */
  idsNuevos: number[]
  /** Todo lo que la sucursal tiene sin resolver (pendiente o visto). */
  sinResolver: number
  filas: FilaRechazo[]
  /** La sucursal cuyos avisos se están mirando. */
  sucursal: string
  hoy: string
}

export interface EntradaHistorial {
  id: number
  fecha: string
  usuarioNombre: string
  accion: string
  tabla: string
  filaId: string | null
  campo: string
  valorAnterior: string | null
  valorNuevo: string | null
}

/** Plantilla del mensaje de WhatsApp, con {nombre}, {cuota} y {vencimiento}. */
export interface PlantillaAviso {
  texto: string
}

export const PLANTILLA_AVISO_POR_DEFECTO =
  'Hola {nombre}, te recordamos que el {vencimiento} vence la cuota de tu seguro por ${cuota}. Cualquier duda escribinos. Seguros Daniel Martínez.'

export interface ResumenCierreDeMes {
  periodo: string
  filasCreadas: number
  /** Pagos adelantados que se acreditaron solos: esas filas nacieron pagas. */
  adelantosAcreditados: number
  /** Pagos adelantados que quedaron a la vista en su fila, para imputarlos a mano. */
  adelantosPendientes: number
}

export interface FilaRiesgoVario {
  id: number
  filaId: string
  clienteId: number | null
  clienteNombre: string | null
  documento: string | null
  telefono: string | null
  sucursal: string | null
  /** Fecha de emisión de la póliza (columna EMISION de la hoja). */
  emision: string | null
  tipoRiesgo: string | null
  descripcion: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  prima: string | null
  cuota: string | null
  diaVencimiento: string | null
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  formaPago: string | null
  observaciones: string | null
  /** true si la fila la cargó la aplicación (todavía no la vio nadie en la hoja). */
  creadoEnLaApp: boolean
}

// ---------------------------------------------------------------------------
// Sincronización con Google Sheets
// ---------------------------------------------------------------------------

export type SituacionSync = 'sincronizado' | 'pendiente' | 'sin-conexion' | 'apagado' | 'trabajando'

export interface EstadoSincronizacion {
  situacion: SituacionSync
  /** Cambios locales esperando subir. */
  pendientes: number
  /** Cambios que fallaron tantas veces que dejaron de reintentarse. */
  fallidas: number
  ultimaBajada: string | null
  ultimaSubida: string | null
  ultimoError: string | null
  /** false si todavía no se cargó la cuenta de servicio: la sincronización no puede arrancar. */
  configurada: boolean
}

export interface EntradaDeCola {
  id: number
  creadoEn: string
  operacion: 'actualizar' | 'crear' | 'borrar'
  pestana: string
  filaId: string
  campos: string[]
  intentos: number
  ultimoError: string | null
  estado: 'pendiente' | 'listo' | 'fallido'
  usuarioNombre: string | null
}

export interface EventoSync {
  id: number
  fecha: string
  tipo: string
  detalle: string
  filas: number | null
  duracionMs: number | null
  conError: boolean
}

export interface PanelSincronizacion {
  estado: EstadoSincronizacion
  cola: EntradaDeCola[]
  eventos: EventoSync[]
  respaldos: RespaldoGuardado[]
}

export interface RespaldoGuardado {
  archivo: string
  ruta: string
  tamano: number
  fecha: string
  /** true si además se subió a la carpeta «Respaldos DM» del Drive de la cuenta de servicio. */
  enDrive: boolean
}

// ---------------------------------------------------------------------------
// Clientes, pólizas y renovaciones
// ---------------------------------------------------------------------------

/** Los tres estados posibles. La constante existe para poder validar lo que llega de la pantalla. */
export const ESTADOS_DE_POLIZA = ['ACTIVA', 'VENCIDA', 'BAJA'] as const
export type EstadoPoliza = (typeof ESTADOS_DE_POLIZA)[number]

/**
 * Cómo está el cliente hoy:
 *  - ACTIVO: le queda al menos una póliza activa;
 *  - BAJA: tuvo pólizas y no le queda ninguna activa (se fue de la agencia);
 *  - SIN POLIZAS: nunca tuvo ninguna (recién dado de alta, todavía sin cargarle la primera).
 */
export type EstadoDeCliente = 'ACTIVO' | 'BAJA' | 'SIN POLIZAS'

export interface FilaCliente {
  id: number
  nombre: string
  documento: string | null
  telefono: string | null
  email: string | null
  sucursal: string | null
  localidad: string | null
  polizasActivas: number
  vehiculos: number
  /** true si tiene alguna cuota del mes abierto sin pagar y sin débito automático. */
  conDeuda: boolean
  /** Compañías de sus pólizas activas, para el filtro. */
  companias: string[]
  estado: EstadoDeCliente
}

/** Las tres vistas de la cartera que pide el mostrador, más la de los que todavía no tienen póliza. */
export type FiltroEstadoCliente = '' | 'activos-sin-deuda' | 'activos-con-deuda' | 'bajas' | 'sin-polizas'

export interface FiltrosClientes {
  busqueda: string
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  sucursales: string[]
  companias: string[]
  /** '' = todos. Es un botón con su contador, no un desplegable: se elige uno. */
  estado: FiltroEstadoCliente
}

/** Cuántos clientes hay en cada estado con la búsqueda y los filtros puestos, pero sin el de estado. */
export interface ResumenDeClientes {
  todos: number
  activosSinDeuda: number
  activosConDeuda: number
  bajas: number
  sinPolizas: number
}

export interface DatosDeCliente {
  nombre: string
  documento: string
  /** El celular. Es el mismo número de WhatsApp: en la agencia nunca fue otro. */
  telefono: string
  email: string
  /**
   * El renglón de la calle, como se imprime. Cuando `direccionDetalle` trae algo se ARMA con ella y lo
   * que se mande acá se ignora; en las fichas viejas, que sólo tienen el renglón libre que vino de la
   * hoja, se sigue guardando tal cual hasta que alguien complete la dirección en partes.
   */
  direccion: string
  localidad: string
  sucursal: string
  fechaNacimiento: string
  /** La dirección en partes. Vacía en las fichas que todavía no se pasaron al formulario nuevo. */
  direccionDetalle: DireccionEstructurada
}

/** Resultado del alta: o se creó, o ya existía alguien con ese documento. */
export type ResultadoAltaCliente =
  | { creado: true; cliente: FichaCliente }
  | { creado: false; yaExiste: FilaCliente; motivo: string }

/**
 * Un riesgo asegurado del cliente. Nació como «el vehículo» y la tabla se sigue llamando `vehiculos`,
 * pero desde que una póliza puede ser de hogar, de bicicleta o de accidentes personales acá entra todo
 * lo que se asegura: `tipo` dice qué es (ver TIPOS_DE_RIESGO) y los campos de abajo se usan según el
 * tipo. En un auto van la patente, la marca y el modelo; en una casa, la dirección del riesgo.
 */
export interface VehiculoDeCliente {
  id: number
  patente: string | null
  marca: string | null
  modelo: string | null
  /** La versión concreta. null en los vehículos cargados antes del catálogo. */
  linea: string | null
  anio: string | null
  anioNumero: number | null
  tipo: string | null
  /** La que decidió el catálogo. null en los que se cargaron a mano. */
  categoria: CategoriaDeVehiculo | null
  motor: string | null
  /** En una bicicleta es el número de cuadro. */
  chasis: string | null
  uso: string | null
  color: string | null
  /** Hogar e integral de comercio: la dirección de la casa o del local. */
  direccionRiesgo: string | null
  /** A nombre de quién está el riesgo (hogar, comercio, «otros»). */
  titularNombre: string | null
  titularDocumento: string | null
  /** Accidentes personales: cada persona cubierta, con su DNI. */
  integrantes: IntegranteDePoliza[]
  polizas: number
}

export interface PolizaDeCliente {
  id: number
  filaId: string | null
  numero: string | null
  propuesta: string | null
  compania: string | null
  cobertura: string | null
  formaPago: string | null
  cuota: string | null
  diaVencimiento: string | null
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  vigenciaHastaIso: string | null
  avisarVto: string | null
  observaciones: string | null
  estado: EstadoPoliza
  vehiculoId: number | null
  /** Cómo se nombra el riesgo en la lista: «FORD FIESTA» dice más que «AUTO». */
  vehiculo: string | null
  /**
   * La rama de la agencia («AUTO», «PICK UP»…), deducida del tipo del riesgo y de la categoría del
   * catálogo, o null cuando el riesgo no es de ninguna de las siete (un hogar, una bicicleta). Se
   * calcula en el servicio y no en la pantalla porque el tipo crudo no viaja: ver `src/shared/ramas.ts`.
   */
  rama: Rama | null
  patente: string | null
  clienteId: number
  clienteNombre: string | null
  sucursal: string | null
  /** Motivo y fecha si la póliza está dada de baja. */
  motivoBaja: string | null
  fechaBaja: string | null
  /** Días que faltan para que venza (negativo si ya venció); null si no tiene vigencia cargada. */
  diasParaVencer: number | null
}

export interface PagoDeCliente {
  id: number
  fecha: string | null
  importe: string | null
  medio: string | null
  compania: string | null
  numeroPoliza: string | null
  periodo: string | null
}

export interface SiniestroDeCliente {
  id: number
  fecha: string | null
  numeroSiniestro: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  descripcion: string | null
  estado: string | null
  importe: string | null
}

export interface NotaDeCliente {
  id: number
  texto: string
  usuarioNombre: string
  creadoEn: string
}

export interface TareaDeCliente {
  id: number
  titulo: string
  detalle: string | null
  responsableNombre: string | null
  venceEl: string | null
  estado: 'pendiente' | 'en gestion' | 'hecha'
  creadoPor: string
  creadoEn: string
}

export interface FichaCliente {
  id: number
  nombre: string
  documento: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  localidad: string | null
  sucursal: string | null
  fechaNacimiento: string | null
  /** La dirección en partes. Toda vacía en las fichas viejas: ahí sólo hay `direccion` y `localidad`. */
  direccionDetalle: DireccionEstructurada
  vehiculos: VehiculoDeCliente[]
  polizas: PolizaDeCliente[]
  pagos: PagoDeCliente[]
  siniestros: SiniestroDeCliente[]
  notas: NotaDeCliente[]
  tareas: TareaDeCliente[]
}

export interface FiltrosPolizas {
  busqueda: string
  /** Vacíos = todos. Acá el estado SÍ es un desplegable más, así que también elige de a varios. */
  estados: EstadoPoliza[]
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  companias: string[]
  sucursales: string[]
  coberturas: string[]
  /** Las siete de `src/shared/ramas.ts`, más lo que la base tenga fuera del catálogo. */
  ramas: string[]
}

/** Una regla de la matriz de coberturas: qué antigüedad de vehículo acepta cada compañía. */
export interface ReglaDeCobertura {
  id: number
  compania: string | null
  cobertura: string | null
  incluye: string | null
  franquicia: string | null
  detalle: string | null
  observaciones: string | null
  /** Años de antigüedad máxima que acepta la compañía para esa cobertura. */
  antiguedadMaxima: number | null
  /** Año de fabricación mínimo aceptado (alternativa a la antigüedad). */
  anioMinimo: number | null
  editable: boolean
}

/** Lo que devuelve la validación de compañía + cobertura + año del vehículo. */
export interface AvisoDeCobertura {
  hayProblema: boolean
  mensaje: string
  /** La regla que se aplicó, si se encontró alguna. */
  regla: ReglaDeCobertura | null
}

export interface DatosDePoliza {
  clienteId: number
  /** Riesgo (vehículo, casa, bicicleta…) que el cliente ya tiene cargado, o null si se carga uno nuevo. */
  vehiculoId: number | null
  /** El riesgo nuevo. Qué campos importan lo decide `tipo`: ver TIPOS_DE_RIESGO. */
  vehiculoNuevo: {
    patente: string
    marca: string
    modelo: string
    /** La versión, del catálogo. Vacío si se cargó a mano. */
    linea: string
    anio: string
    /** Uno de TIPOS_DE_RIESGO. Vacío en los vehículos viejos cargados sin tipo. */
    tipo: string
    /** La decide el catálogo, no la pantalla. Vacío si se cargó a mano. */
    categoria: string
    /** El código del proveedor: distingue un vehículo identificado de uno tipeado. */
    catalogoCodigo: string
    motor: string
    /** En una bicicleta, el número de cuadro. */
    chasis: string
    uso: string
    color: string
    /** Hogar e integral de comercio: la dirección de la casa o del local. */
    direccionRiesgo: string
    /** A nombre de quién está (hogar, comercio, «otros»). */
    titularNombre: string
    titularDocumento: string
    /** Accidentes personales: las personas cubiertas. */
    integrantes: IntegranteDePoliza[]
  } | null
  compania: string
  cobertura: string
  formaPago: string
  cuota: string
  diaVencimiento: string
  numero: string
  propuesta: string
  vigenciaDesde: string
  vigenciaHasta: string
  avisarVto: string
  observaciones: string
  /** true si un administrador confirmó continuar pese a la advertencia de cobertura. */
  confirmadoPeseAlAviso: boolean
}

export const ESTADOS_DE_RENOVACION = ['pendiente', 'en gestion', 'renovada', 'no renueva'] as const
export type EstadoRenovacion = (typeof ESTADOS_DE_RENOVACION)[number]

export const NOMBRE_ESTADO_RENOVACION: Record<EstadoRenovacion, string> = {
  pendiente: 'Pendiente',
  'en gestion': 'En gestión',
  renovada: 'Renovada',
  'no renueva': 'No renueva',
}

export interface FilaRenovacion {
  /** La fila de seguimiento, si ya se creó (se crea al tocar la renovación por primera vez). */
  renovacionId: number | null
  polizaId: number
  filaId: string | null
  clienteId: number
  clienteNombre: string | null
  telefono: string | null
  sucursal: string | null
  compania: string | null
  cobertura: string | null
  numero: string | null
  patente: string | null
  vehiculo: string | null
  cuota: string | null
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  venceEl: string
  diasParaVencer: number
  observaciones: string | null
  /** true si las observaciones piden aumentar la cuota al renovar. */
  aumentaAlRenovar: boolean
  /**
   * true si esta compañía se renueva a mano (tiene meses de renovación cargados en Administración →
   * Compañías). Las demás renuevan solas y la bandeja las esconde salvo que se pidan.
   */
  renovacionManual: boolean
  /** Cada cuántos meses renueva la compañía, si está cargado. */
  mesesDeRenovacion: number | null
  estado: EstadoRenovacion
  responsableId: number | null
  responsableNombre: string | null
  nota: string | null
}

export interface SemanaDeRenovaciones {
  /** Lunes de la semana, 'AAAA-MM-DD'. */
  desde: string
  hasta: string
  titulo: string
  filas: FilaRenovacion[]
}

export interface BandejaRenovaciones {
  semanas: SemanaDeRenovaciones[]
  total: number
  hoy: string
  responsables: Array<{ id: number; nombre: string }>
  /**
   * Las mismas sucursales que ofrece el módulo Tareas. La bandeja tiene «Anotar tarea», que abre el
   * MISMO diálogo que «Nueva tarea»: sin esta lista el diálogo se armaba con la sucursal de la
   * renovación y la de quien entró, así que desde acá no se le podía anotar una tarea a ninguna otra.
   */
  sucursales: string[]
}

export interface DatosDeRenovacion {
  vigenciaDesde: string
  vigenciaHasta: string
  cuota: string
  numero: string
  /** Número de propuesta de la póliza nueva; vacío si la compañía no la usa o todavía no la dio. */
  propuesta: string
  observaciones: string
}

export const TEXTO_AUMENTA_AL_RENOVAR = '20% aumentar cuando se renueva'

// --- Lo que devuelven los listados (las filas más los catálogos de sus filtros) ---

export interface ListadoClientes {
  filas: FilaCliente[]
  /** Cuántos clientes hay en total, antes de aplicar los filtros. */
  total: number
  resumen: ResumenDeClientes
  sucursales: string[]
  companias: string[]
}

// --- Buscador de deudores (Clientes → «Buscar clientes») ---

export const FORMATOS_DE_DEUDORES = ['xlsx', 'txt'] as const
export type FormatoDeDeudores = (typeof FORMATOS_DE_DEUDORES)[number]

/**
 * El filtro rápido de arriba de todo: '' (TODOS) no acota nada, 'VENCIDOS' se queda con las que ya
 * pasaron su fecha de vencimiento y 'PAGOS' con las que se cobran solas (débito, CBU, tarjeta, Mercado
 * Pago) —no hay que llamarlas, se resuelven sin que nadie haga nada—.
 */
export type FiltroEstadoDeDeuda = '' | 'PAGOS' | 'VENCIDOS'

export interface FiltrosDeudores {
  /** 'AAAA-MM' para un mes; '' para mirar todos los meses que tenga la cartera. */
  periodo: string
  estado: FiltroEstadoDeDeuda
  /** Vacío = todas. Se comparan normalizadas (sin tildes ni mayúsculas). */
  sucursales: string[]
  companias: string[]
  formasDePago: string[]
  /** Las siete de `src/shared/ramas.ts`, más lo que la base tenga fuera del catálogo. Vacío = todas. */
  ramas: string[]
  /** Días del mes tildados (1 a 31), en cualquier orden. Vacío = todos los días. */
  dias: number[]
  /**
   * Sólo pesa cuando NO se tildó ninguna forma de pago: sin esto quedan afuera las que se cobran
   * solas (débito, CBU, tarjeta), que es lo que la agencia entiende por deudor. Si se tilda una forma
   * de pago, manda lo tildado: pedir TARJETA es querer ver justamente las tarjetas que no entraron.
   */
  incluirDebito: boolean
}

export const DEUDORES_SIN_FILTROS: FiltrosDeudores = {
  periodo: '',
  estado: '',
  sucursales: [],
  companias: [],
  formasDePago: [],
  ramas: [],
  dias: [],
  incluirDebito: false,
}

/** Una cuota impaga: la deuda, con todo lo que hace falta para llamar o exportar. */
export interface FilaDeudor {
  filaId: string
  periodo: string
  clienteId: number | null
  nombre: string | null
  documento: string | null
  telefono: string | null
  email: string | null
  sucursal: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  cuota: string | null
  cuotaMonto: number | null
  formaPago: string | null
  /** Día del mes en que vence (1 a 31); null si la fila no lo tiene cargado. */
  diaVencimiento: number | null
  /** La fecha completa del vencimiento, 'AAAA-MM-DD'; null si no hay día. */
  vencimiento: string | null
  /** Días de atraso: positivo si ya venció, negativo si todavía falta; null sin vencimiento. */
  diasDeAtraso: number | null
  vencida: boolean
  /** true si esa forma de pago se cobra sola (débito, CBU, tarjeta). */
  seCobraSola: boolean
}

export interface ListadoDeudores {
  filas: FilaDeudor[]
  /** Cuántas personas distintas hay en `filas`: una puede deber dos pólizas. */
  clientes: number
  /** Suma de las cuotas que tienen importe numérico. */
  total: number
  /** Cuántas filas no tienen importe numérico: no suman al total. */
  sinImporte: number
  /** Cuántas deudas quedan afuera por no tener día de vencimiento cargado. */
  sinDia: number
  /** Deudas por día del mes con todo lo demás filtrado: el índice es el día (la posición 0 no se usa). */
  porDia: number[]
  /** El período que se está mirando; '' cuando se miran todos los meses. */
  periodo: string
  periodos: PeriodoCartera[]
  sucursales: string[]
  companias: string[]
  formasDePago: string[]
  /** Las opciones del filtro de rama: las siete de la agencia más lo que la base traiga aparte. */
  ramas: string[]
  hoy: string
}

export interface CatalogosDePoliza {
  companias: string[]
  coberturas: string[]
  formasDePago: string[]
  sucursales: string[]
  tiposDeVehiculo: string[]
  /** Las opciones del filtro de rama: las siete de la agencia más lo que la base traiga aparte. */
  ramas: string[]
}

export interface ListadoPolizas {
  filas: PolizaDeCliente[]
  total: number
  catalogos: CatalogosDePoliza
  hoy: string
}

// --- Tareas y notas de la ficha del cliente ---

export type EstadoTarea = 'pendiente' | 'en gestion' | 'hecha'

export const NOMBRE_ESTADO_TAREA: Record<EstadoTarea, string> = {
  pendiente: 'Pendiente',
  // El valor guardado sigue siendo 'en gestion' (así lo escribió la Fase 5 y así lo acepta el CHECK
  // de la tabla); en pantalla se lee «En curso», que es como lo nombra el pliego de la Fase 8.
  'en gestion': 'En curso',
  hecha: 'Hecha',
}

export const ESTADOS_DE_TAREA: readonly EstadoTarea[] = ['pendiente', 'en gestion', 'hecha']

export interface DatosDeTarea {
  clienteId: number
  polizaId: number | null
  titulo: string
  detalle: string
  /** Usuario al que se le asigna; null = queda sin responsable. */
  responsableId: number | null
  /** 'AAAA-MM-DD' o vacío. */
  venceEl: string
}

// --- La matriz de reglas de cobertura ---

export interface DatosDeRegla {
  compania: string
  cobertura: string
  incluye: string
  franquicia: string
  detalle: string
  observaciones: string
  /** Se reciben como texto porque vienen de un campo del formulario; vacío = sin límite. */
  antiguedadMaxima: string
  anioMinimo: string
}

export interface MatrizDeCobertura {
  reglas: ReglaDeCobertura[]
  /** Combinaciones de compañía y cobertura que hay en la cartera y todavía no tienen regla. */
  faltantes: Array<{ compania: string; cobertura: string; polizas: number }>
  /** Las filas de la pestaña COBERTURA de la hoja, tal cual: sirven de referencia para cargar la matriz. */
  referencia: string[][]
  /** Sólo el SUPER_ADMIN puede tocar la matriz. */
  puedeEditar: boolean
  anioActual: number
}

// --- Seguimiento de una renovación ---

export interface DatosDeSeguimiento {
  estado: EstadoRenovacion
  responsableId: number | null
  nota: string
}

// --- Registrar un pago y cargar un siniestro desde la ficha del cliente ---

/** Las cuotas del mes abierto de un cliente: lo que se puede pagar hoy desde su ficha. */
export interface CuotasDelCliente {
  filas: FilaCartera[]
  mediosDePago: string[]
  hoy: string
  /** El mes al que corresponden, para decirlo en pantalla. */
  periodo: string
}

/** El estado del trámite. Son cuatro y en este orden: es el camino que recorre un siniestro. */
export const ESTADOS_DE_SINIESTRO = ['CARGADO', 'EN TRÁMITE', 'ESPERANDO DOCUMENTACIÓN', 'CERRADO'] as const
export type EstadoSiniestro = (typeof ESTADOS_DE_SINIESTRO)[number]

export interface DatosDeSiniestro {
  clienteId: number
  /** Póliza a la que se imputa; null si todavía no se sabe. */
  polizaId: number | null
  /** 'AAAA-MM-DD' o el texto que se haya escrito. */
  fecha: string
  numeroSiniestro: string
  descripcion: string
  estado: string
  importe: string
  observaciones: string
  /** Cuándo se cargó en la agencia; vacío = hoy. Sólo lo manda el módulo Siniestros. */
  fechaCarga?: string
  /** Sucursal que lo atiende; vacío = la del cliente o la de quien carga. */
  sucursal?: string
}

// ---------------------------------------------------------------------------
// Cobranzas: la caja del día, la mora, la rendición de imputados y las comisiones
// ---------------------------------------------------------------------------

/** Un pago tal como se ve en la caja del día y en la rendición. */
export interface PagoRegistrado {
  id: number
  filaId: string
  /** Hora en que se registró ('HH:MM'); null en los pagos que vinieron de la hoja. */
  hora: string | null
  /** Fecha del pago tal cual se escribió, y su versión interpretada. */
  fecha: string | null
  fechaIso: string | null
  clienteId: number | null
  clienteNombre: string | null
  documento: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  importe: string | null
  importeMonto: number | null
  medio: string | null
  /** Sucursal donde entró la plata (la del mostrador, no la del cliente). */
  sucursal: string | null
  /** Quién lo cobró; null en los pagos importados de la hoja. */
  usuarioNombre: string | null
  periodo: string | null
  resultado: ResultadoImputacion
  /** El RESULTADO tal cual está guardado, por si la hoja trae un texto que no es de la lista. */
  resultadoTexto: string | null
  observaciones: string | null
  /** true si lo registró la aplicación; false si vino de la pestaña IMPUTADOS. */
  hechoEnLaApp: boolean
  /** PAGO (el cliente pagó) o IMPUTADO (se imputó a la compañía y el cliente todavía no pagó). */
  estadoCobro: EstadoDeCobro
  /** Si es un pago adelantado (la cuota del mes que viene), qué se hace con él al armar ese mes; null si es un pago común. */
  adelantoModo: ModoDeAdelanto | null
  /** Para un pago adelantado: true cuando ya quedó imputado a la fila del mes que pagaba. */
  adelantoImputado: boolean
}

export interface TotalPorMedio {
  medio: string
  pagos: number
  total: number
}

export interface CajaDelDia {
  /** Día que se está mirando, 'AAAA-MM-DD'. */
  fecha: string
  /** Sucursales filtradas, ya escritas como el catálogo; vacías = todas. */
  sucursalesElegidas: string[]
  /** Las que este usuario puede mirar: son las opciones del desplegable. */
  sucursales: string[]
  /**
   * true cuando la sucursal no se puede cambiar: un empleado ve la caja de su mostrador y nada más.
   * Los administradores eligen las que quieran (o ninguna, que son todas).
   */
  sucursalFija: boolean
  mediosDePago: string[]
  pagos: PagoRegistrado[]
  totalesPorMedio: TotalPorMedio[]
  total: number
  /** Cuántos pagos del día no tienen un importe numérico (no suman al total). */
  sinImporte: number
  /** Cuántos pagos del día están IMPUTADOS y sin cobrar: se ven en la lista pero no suman al total. */
  imputados: number
  hoy: string
}

/** Alta manual de un pago desde la caja. Con `cuotaFilaId` se paga una fila de la planilla del mes. */
export interface DatosDePagoManual {
  /** Fila de la planilla del mes que se está pagando; null = pago suelto. */
  cuotaFilaId: string | null
  clienteId: number | null
  polizaId: number | null
  clienteNombre: string
  documento: string
  compania: string
  numeroPoliza: string
  patente: string
  fecha: string
  importe: string
  medioDePago: string
  sucursal: string
  observaciones: string
  /** PAGO o IMPUTADO; vacío = PAGO. */
  estadoCobro?: EstadoDeCobro
  /** Sólo con `cuotaFilaId`: qué cuota se paga (MES, ADELANTADO o AMBAS). Vacío = MES. */
  alcance?: AlcanceDelPago
  adelanto?: DatosDeAdelanto
}

export const RANGOS_DE_MORA = ['', '1-7', '8-30', '+30'] as const
export type RangoDeMora = (typeof RANGOS_DE_MORA)[number]

export const NOMBRE_RANGO_MORA: Record<RangoDeMora, string> = {
  '': 'Todos los atrasos',
  '1-7': '1 a 7 días',
  '8-30': '8 a 30 días',
  '+30': 'Más de 30 días',
}

/** Una cuota vencida sin pago. */
export interface FilaMora {
  filaId: string
  periodo: string
  clienteId: number | null
  polizaId: number | null
  nombre: string | null
  telefono: string | null
  documento: string | null
  sucursal: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  cuota: string | null
  cuotaMonto: number | null
  formaPago: string | null
  diaVencimiento: string | null
  /** Fecha de vencimiento ya armada, 'AAAA-MM-DD'. */
  vencimiento: string
  diasDeAtraso: number
  rango: Exclude<RangoDeMora, ''>
  /** Última fecha en que la compañía sigue cubriendo; null si no se puede calcular. */
  finCobertura: string | null
  /** true si todavía corre la cobertura financiera de la compañía. */
  dentroDeCobertura: boolean
  aviso: string | null
  fechaEnvio: string | null
  /** false si la cuota es de un mes ya cerrado: se puede avisar, pero la fila no se toca. */
  mesAbierto: boolean
  /** true si la cuota está IMPUTADA: la agencia ya se la pagó a la compañía y lo que falta es cobrarle al cliente. */
  imputada: boolean
}

export interface FiltrosMora {
  busqueda: string
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  sucursales: string[]
  companias: string[]
  /** Vacíos = todos los tramos de atraso. Los carteles de arriba siguen contando los tres por separado. */
  rangos: Array<Exclude<RangoDeMora, ''>>
  /** El débito automático se cobra solo: por omisión no se lista. */
  incluirDebito: boolean
}

export interface ListadoMora {
  filas: FilaMora[]
  sucursales: string[]
  companias: string[]
  /** Cuántas cuotas vencidas hay en total, antes de filtrar. */
  total: number
  /** Cuánto suman las cuotas que quedaron después de los filtros (lo que se ve en pantalla). */
  totalDeuda: number
  porRango: Record<Exclude<RangoDeMora, ''>, number>
  hoy: string
}

/** Lo que devuelve «Avisar» desde la mora. */
export interface AvisoDeMora {
  url: string
  mensaje: string
  telefono: string
  /** true si además se marcó la fila como ENVIADO (sólo se hace en el mes abierto). */
  marcada: boolean
  fila: FilaMora
}

export const RESULTADOS_DE_IMPUTACION = ['', 'IMPUTADO', 'OK', 'REVISAR', 'MAL'] as const
export type ResultadoImputacion = (typeof RESULTADOS_DE_IMPUTACION)[number]

export const NOMBRE_RESULTADO_IMPUTACION: Record<ResultadoImputacion, string> = {
  '': 'Pendiente',
  IMPUTADO: 'Imputado',
  OK: 'OK',
  REVISAR: 'Revisar',
  MAL: 'Mal',
}

export interface RendicionImputados {
  periodo: string
  /** Compañías filtradas, ya plegadas contra las que existen; lista vacía = todas. */
  companiasElegidas: string[]
  /** Sucursal a la que está acotada la rendición ('' = todas): la del mostrador cuando pregunta un empleado. */
  sucursal: string
  periodos: string[]
  /** Todas las compañías que aparecen en el mes: son las opciones del desplegable. */
  companias: string[]
  pagos: PagoRegistrado[]
  /** Cuántos pagos hay de cada resultado (la clave '' son los pendientes). */
  contadores: Record<ResultadoImputacion, number>
  total: number
  totalImporte: number
  pendientes: number
  /** Cuántos de los pagos del mes están IMPUTADOS y todavía sin cobrar al cliente. */
  sinCobrar: number
  /** Pagos de la hoja con la fecha ilegible y sin MES: no caen en ningún mes y no se rinden. */
  sinMes: number
  /**
   * Por qué el RESULTADO no se va a sincronizar con la hoja, si es el caso: o la hoja no tiene una
   * pestaña IMPUTADOS que sea una tabla por fila, o la tiene pero sin columna RESULTADO.
   */
  avisoDeSincronizacion: string | null
}

export interface FilaComision {
  compania: string
  pagos: number
  cobrado: number
  porcentaje: number
  comision: number
}

export interface ResumenComisiones {
  periodo: string
  periodos: string[]
  filas: FilaComision[]
  cobrado: number
  comision: number
  /** Compañías con cobranza en el mes y sin porcentaje cargado: su comisión no se puede estimar. */
  sinPorcentaje: string[]
}

// --- Ticketeadora térmica (opcional) ---

export interface ConfigImpresora {
  habilitada: boolean
  /**
   * Con esto activado, cada pago pregunta antes de imprimir en vez de sacar el ticket solo: hay
   * compañías que no piden comprobante y el rollo se gasta igual.
   */
  preguntar: boolean
  /** Nombre de la impresora en Windows; null si todavía no se eligió ninguna. */
  impresora: string | null
  /** Ancho del papel en milímetros (80 en las POS-80). */
  anchoMm: number
  /** Cuántas copias del ticket salen por pago (1 o 2). Con «preguntar» activado se puede elegir en el momento. */
  copias: number
  /** El número que va a llevar el próximo ticket que se imprima. Sube solo; se puede corregir a mano. */
  proximoNumeroDeTicket: number
  /** Impresoras que ve el sistema. Vacío si no se pudieron leer. */
  disponibles: string[]
  predeterminada: string | null
  /** Último error de impresión, para no perderlo (el ticket se imprime en segundo plano). */
  ultimoError: string | null
}

export interface DatosDeImpresora {
  habilitada: boolean
  preguntar: boolean
  impresora: string
  anchoMm: number
  copias: number
}

/**
 * La dirección que encabeza el ticket, una por sucursal: el comprobante lo firma la sucursal donde se
 * cobró. Se cargan en Administración → Impresora y admiten sucursales nuevas.
 */
export interface DireccionDeSucursal {
  sucursal: string
  direccion: string
  /** false cuando la dirección quedó guardada para un nombre que ya no está en la lista de sucursales. */
  enLaLista: boolean
}

/**
 * El aviso de «¿imprimo el comprobante?» que llega al mostrador después de registrar un pago. Trae lo
 * justo para reconocer el pago en el cartel; el ticket completo lo arma el proceso principal.
 */
export interface PedidoDeTicket {
  pagoId: number
  cliente: string
  compania: string
  poliza: string
  importe: string
  /** Cuántas copias imprimir por defecto (lo que quedó guardado en Administración → Impresora). */
  copiasPorDefecto: number
}

// ---------------------------------------------------------------------------
// Siniestros, riesgos varios y AMP (Fase 7)
// ---------------------------------------------------------------------------

/** Una fila del listado mensual de siniestros: las mismas columnas de la hoja. */
export interface FilaSiniestro {
  id: number
  filaId: string
  sucursal: string | null
  compania: string | null
  numeroPoliza: string | null
  cobertura: string | null
  clienteId: number | null
  clienteNombre: string | null
  documento: string | null
  telefono: string | null
  patente: string | null
  /** Cuándo se cargó en la agencia, tal cual está escrito y en 'AAAA-MM-DD'. */
  fechaCarga: string | null
  fechaCargaIso: string | null
  /** Cuándo pasó el siniestro. */
  fecha: string | null
  fechaIso: string | null
  numeroSiniestro: string | null
  descripcion: string | null
  observaciones: string | null
  importe: string | null
  /** El estado del trámite, ya llevado a los cuatro de la lista. */
  estado: EstadoSiniestro
  /** El texto tal cual está guardado, si no es exactamente uno de los cuatro. */
  estadoTexto: string | null
  /** true si en la descripción o las observaciones aparece la palabra ROBO. */
  esRobo: boolean
  /** Cuántas observaciones, adjuntos y tareas tiene la ficha. */
  observacionesCargadas: number
  adjuntos: number
  tareasPendientes: number
  creadoEnLaApp: boolean
}

export interface FiltrosSiniestros {
  /** 'AAAA-MM' del mes de carga; '' = todos los meses. Elige el mes que se mira, no filtra dentro. */
  periodo: string
  busqueda: string
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  sucursales: string[]
  companias: string[]
  /** '' = todos. Es una pestaña con su contador, no un desplegable: se elige uno. */
  estado: '' | EstadoSiniestro
  /** Sólo los que mencionan ROBO. */
  soloRobos: boolean
}

export interface ListadoSiniestros {
  filas: FilaSiniestro[]
  /** Meses con siniestros cargados, del más nuevo al más viejo. */
  periodos: string[]
  sucursales: string[]
  companias: string[]
  /** Cuántos siniestros hay en total, antes de filtrar. */
  total: number
  /** Cuántos hay en cada estado, con los filtros aplicados menos el de estado. */
  porEstado: Record<EstadoSiniestro, number>
  hoy: string
}

/** Una entrada de la línea de tiempo del siniestro. */
export interface ObservacionDeSiniestro {
  id: number
  texto: string
  usuarioNombre: string
  creadoEn: string
}

export interface AdjuntoDeSiniestro {
  id: number
  nombre: string
  tamano: number
  creadoEn: string
  usuarioNombre: string
  /** true si además se subió a la carpeta «Adjuntos DM» del Drive. */
  enDrive: boolean
  /** Por qué no se pudo subir a Drive, si es el caso. El archivo local está guardado igual. */
  errorDeDrive: string | null
}

export interface FichaSiniestro {
  siniestro: FilaSiniestro
  observaciones: ObservacionDeSiniestro[]
  adjuntos: AdjuntoDeSiniestro[]
  tareas: TareaDeCliente[]
  /** Las pólizas del cliente, para poder imputarlo si se cargó sin saber cuál era. */
  polizas: PolizaDeCliente[]
  responsables: Array<{ id: number; nombre: string }>
  /** Dónde quedan guardados los archivos, para decirlo en pantalla. */
  carpetaDeAdjuntos: string
}

/** Un resultado del buscador del alta rápida: el cliente y su póliza, listos para completar solos. */
export interface CandidatoDeSiniestro {
  clienteId: number
  clienteNombre: string
  documento: string | null
  telefono: string | null
  sucursal: string | null
  polizaId: number | null
  compania: string | null
  numeroPoliza: string | null
  cobertura: string | null
  patente: string | null
  vehiculo: string | null
  estadoPoliza: EstadoPoliza
}

export interface DatosDeTareaDeSiniestro {
  siniestroId: number
  titulo: string
  detalle: string
  responsableId: number | null
  /** 'AAAA-MM-DD' o vacío. */
  venceEl: string
}

// --- Riesgos varios ---

/** Columnas de un riesgo vario que se editan con doble clic, igual que la planilla del mes. */
export type CampoDeRiesgo =
  | 'sucursal'
  | 'emision'
  | 'clienteNombre'
  | 'documento'
  | 'telefono'
  | 'tipoRiesgo'
  | 'descripcion'
  | 'compania'
  | 'numeroPoliza'
  | 'patente'
  | 'prima'
  | 'cuota'
  | 'diaVencimiento'
  | 'formaPago'
  | 'vigenciaDesde'
  | 'vigenciaHasta'
  | 'observaciones'

export interface ListadoRiesgos {
  filas: FilaRiesgoVario[]
  total: number
  sucursales: string[]
  companias: string[]
  tiposDeRiesgo: string[]
  formasDePago: string[]
  /** Por qué el alta no va a llegar a la hoja, si es el caso (no hay pestaña RIESGOS VARIOS importada). */
  avisoDeSincronizacion: string | null
}

export interface DatosDeRiesgo {
  clienteNombre: string
  documento: string
  telefono: string
  sucursal: string
  emision: string
  tipoRiesgo: string
  descripcion: string
  compania: string
  numeroPoliza: string
  patente: string
  prima: string
  cuota: string
  diaVencimiento: string
  formaPago: string
  vigenciaDesde: string
  vigenciaHasta: string
  observaciones: string
}

// --- AMP: las ampliaciones pendientes ---

export interface FilaAmp {
  id: number
  filaId: string
  sucursal: string | null
  fecha: string | null
  fechaIso: string | null
  clienteId: number | null
  clienteNombre: string | null
  formaPago: string | null
  patente: string | null
  marca: string | null
  modelo: string | null
  detalle: string | null
  /** Fecha de vencimiento tal cual está y en 'AAAA-MM-DD'. */
  vencimiento: string | null
  vencimientoIso: string | null
  observaciones: string | null
  resuelto: boolean
  resueltoEn: string | null
  resueltoPor: string | null
}

export interface ListadoAmp {
  filas: FilaAmp[]
  /** Cuántas ampliaciones hay pendientes y cuántas resueltas, antes de filtrar. */
  pendientes: number
  resueltas: number
  /** true si la lista incluye además las resueltas. */
  incluyeResueltas: boolean
  sucursales: string[]
  /** Por qué el tilde de «resuelto» no viaja a la hoja, si es el caso. */
  avisoDeSincronizacion: string | null
  hoy: string
}

// ---------------------------------------------------------------------------
// Fase 8 · Leads: la consulta que todavía no es cliente
// ---------------------------------------------------------------------------

/** Cómo llegó la consulta. Es lo único que se pregunta siempre, y define de dónde viene el trabajo. */
export const ORIGENES_DE_LEAD = ['WHATSAPP', 'LOCAL', 'RECOMENDADO', 'REDES', 'OTRO'] as const
export type OrigenDeLead = (typeof ORIGENES_DE_LEAD)[number]

export const NOMBRE_ORIGEN_LEAD: Record<OrigenDeLead, string> = {
  WHATSAPP: 'WhatsApp',
  LOCAL: 'Vino al local',
  RECOMENDADO: 'Recomendado',
  REDES: 'Redes',
  OTRO: 'Otro',
}

/** El embudo, de la consulta a la venta. GANADO y PERDIDO son el final del camino. */
export const ESTADOS_DE_LEAD = ['NUEVO', 'EN CHARLA', 'COTIZADO', 'GANADO', 'PERDIDO'] as const
export type EstadoLead = (typeof ESTADOS_DE_LEAD)[number]

export interface NotaDeLead {
  id: number
  texto: string
  usuarioNombre: string
  creadoEn: string
}

export interface FilaLead {
  id: number
  filaId: string
  nombre: string
  telefono: string | null
  sucursal: string | null
  /** Qué quiere asegurar, en las palabras del cliente. */
  interes: string | null
  tipoVehiculo: string | null
  origen: OrigenDeLead
  estado: EstadoLead
  documento: string | null
  email: string | null
  /** Si ya se convirtió en cliente, cuál. */
  clienteId: number | null
  convertidoEn: string | null
  usuarioNombre: string | null
  creadoEn: string
  actualizadoEn: string
  /** Cuántas notas tiene y qué dice la última: la tarjeta muestra cómo viene la charla. */
  notas: number
  ultimaNota: string | null
  ultimaNotaEn: string | null
  presupuestos: number
  tareasPendientes: number
  /** Listo para abrir WhatsApp, o null si no tiene teléfono cargado. */
  urlWhatsapp: string | null
}

export interface FiltrosLeads {
  busqueda: string
  /** '' = todos. Es una pestaña con su contador, no un desplegable: se elige uno. */
  estado: '' | EstadoLead
  /** Vacíos = todos. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  origenes: OrigenDeLead[]
  sucursales: string[]
  /** false = se esconden los GANADO y PERDIDO, que ya no son trabajo pendiente. */
  incluirCerrados: boolean
}

export interface ListadoLeads {
  filas: FilaLead[]
  /** Cuántos hay de cada estado dentro de lo filtrado (sin contar el filtro de estado). */
  porEstado: Record<EstadoLead, number>
  total: number
  sucursales: string[]
  /** Por qué lo que se cargue no va a llegar a la hoja, si es el caso. */
  avisoDeSincronizacion: string | null
  hoy: string
}

export interface FichaLead {
  lead: FilaLead
  notas: NotaDeLead[]
  presupuestos: FilaPresupuesto[]
  tareas: FilaTarea[]
  /**
   * Las mismas sucursales que ofrece el listado. La ficha tiene el botón «Editar la consulta», que
   * abre el MISMO diálogo que «Nueva consulta»: si acá viajara sólo la sucursal del lead, corregir una
   * consulta desde su ficha ofrecería dos opciones (la de quien entró y la que ya tenía) y no habría
   * forma de pasarla a ninguna de las otras. Es lo mismo que la ficha de la tarea ya hace.
   */
  sucursales: string[]
}

export interface DatosDeLead {
  nombre: string
  telefono: string
  sucursal: string
  interes: string
  tipoVehiculo: string
  origen: OrigenDeLead | ''
  estado: EstadoLead | ''
  documento: string
  email: string
  /** Primera nota, para no tener que abrir la ficha apenas se carga. */
  nota: string
}

/**
 * Lo que devuelve «Convertir en cliente»: el cliente (nuevo o el que ya existía con ese documento) y
 * la ficha del lead actualizada. La pantalla usa `clienteId` para abrir el formulario de póliza nueva.
 */
export interface ResultadoConversion {
  clienteId: number
  clienteNombre: string
  /** false = ya había un cliente con ese DNI/CUIT y se usó ése en vez de duplicarlo. */
  creado: boolean
  aviso: string | null
  lead: FichaLead
}

// ---------------------------------------------------------------------------
// Fase 8 · Presupuestos
// ---------------------------------------------------------------------------

export const ESTADOS_DE_PRESUPUESTO = ['BORRADOR', 'ENVIADO', 'ACEPTADO', 'RECHAZADO'] as const
export type EstadoPresupuesto = (typeof ESTADOS_DE_PRESUPUESTO)[number]

/** Una compañía cotizada. Un presupuesto son dos o tres de éstas, para que el cliente elija. */
export interface OpcionDePresupuesto {
  id: number
  compania: string
  cobertura: string
  /** El precio tal cual se escribió y como número, para ordenar y para marcar la más barata. */
  precio: string
  precioMonto: number | null
  comentario: string | null
  /** true si es la opción que el cliente aceptó. */
  aceptada: boolean
}

export interface DatosDeOpcion {
  compania: string
  cobertura: string
  precio: string
  comentario: string
}

export interface FilaPresupuesto {
  id: number
  filaId: string
  numero: string
  version: number
  estado: EstadoPresupuesto
  leadId: number | null
  clienteId: number | null
  clienteNombre: string
  telefono: string | null
  documento: string | null
  sucursal: string | null
  patente: string | null
  marca: string | null
  modelo: string | null
  anio: string | null
  tipoVehiculo: string | null
  observaciones: string | null
  opciones: number
  /** El precio más barato de las opciones, para verlo en el listado. */
  desde: string | null
  enviadoEn: string | null
  aceptadoEn: string | null
  /** La póliza que salió de este presupuesto, si ya se emitió. */
  polizaId: number | null
  usuarioNombre: string | null
  creadoEn: string
  actualizadoEn: string
  /** false cuando lo reemplazó una versión más nueva: queda como historia. */
  vigente: boolean
}

export interface FiltrosPresupuestos {
  busqueda: string
  /** '' = todos. Es una pestaña con su contador, no un desplegable: se elige uno. */
  estado: '' | EstadoPresupuesto
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  sucursales: string[]
  /** false = sólo la última versión de cada presupuesto. */
  incluirVersiones: boolean
}

export interface ListadoPresupuestos {
  filas: FilaPresupuesto[]
  porEstado: Record<EstadoPresupuesto, number>
  total: number
  sucursales: string[]
  avisoDeSincronizacion: string | null
  hoy: string
}

export interface FichaPresupuesto {
  presupuesto: FilaPresupuesto
  opciones: OpcionDePresupuesto[]
  /** Las versiones anteriores del mismo presupuesto, de la más nueva a la más vieja. */
  versiones: FilaPresupuesto[]
  /** El mensaje de WhatsApp ya armado, para poder leerlo antes de mandarlo. */
  mensaje: string
  urlWhatsapp: string | null
  companias: string[]
  coberturas: string[]
}

export interface DatosDePresupuesto {
  /** De quién es: un lead, un cliente, o ninguno de los dos (se escribe el nombre a mano). */
  leadId: number | null
  clienteId: number | null
  clienteNombre: string
  telefono: string
  documento: string
  sucursal: string
  patente: string
  marca: string
  modelo: string
  anio: string
  tipoVehiculo: string
  observaciones: string
  opciones: DatosDeOpcion[]
}

/** Lo que devuelve «Enviar por WhatsApp»: la dirección lista y la ficha ya marcada como ENVIADO. */
export interface EnvioDePresupuesto {
  url: string
  mensaje: string
  telefono: string
  ficha: FichaPresupuesto
}

/** Lo que devuelve aceptar una opción: la ficha y con qué cliente se puede emitir la póliza. */
export interface AceptacionDePresupuesto {
  ficha: FichaPresupuesto
  /** Null si el presupuesto todavía no tiene cliente (hay que convertir el lead primero). */
  clienteId: number | null
  /** Por qué todavía no se puede emitir la póliza, si es el caso. */
  aviso: string | null
}

// ---------------------------------------------------------------------------
// Fase 8 · Tareas
// ---------------------------------------------------------------------------

export const PRIORIDADES_DE_TAREA = ['ALTA', 'NORMAL', 'BAJA'] as const
export type PrioridadTarea = (typeof PRIORIDADES_DE_TAREA)[number]

/** A qué ficha cuelga una tarea. 'suelta' es una tarea interna sin vínculo. */
export type VinculoDeTarea = 'suelta' | 'cliente' | 'poliza' | 'siniestro' | 'renovacion' | 'lead' | 'presupuesto'

export interface ComentarioDeTarea {
  id: number
  texto: string
  usuarioNombre: string
  creadoEn: string
}

export interface AdjuntoDeTarea {
  id: number
  nombre: string
  tamano: number
  creadoEn: string
  usuarioNombre: string
  /** true si además se subió a la carpeta «Adjuntos DM» del Drive. */
  enDrive: boolean
  errorDeDrive: string | null
}

export interface FilaTarea {
  id: number
  titulo: string
  detalle: string | null
  responsableId: number | null
  responsableNombre: string | null
  sucursal: string | null
  venceEl: string | null
  prioridad: PrioridadTarea
  estado: EstadoTarea
  creadoPor: string
  creadoEn: string
  actualizadoEn: string
  /** De qué ficha cuelga y cómo se llama eso, para poder saltar hasta allá. */
  vinculo: VinculoDeTarea
  vinculoId: number | null
  vinculoTexto: string | null
  clienteId: number | null
  polizaId: number | null
  siniestroId: number | null
  renovacionId: number | null
  leadId: number | null
  presupuestoId: number | null
  comentarios: number
  adjuntos: number
  /** Días que faltan para el vencimiento (negativo = vencida); null si no tiene fecha. */
  diasParaVencer: number | null
  vencida: boolean
  venceHoy: boolean
}

export interface FiltrosTareas {
  busqueda: string
  /** '' = todas. Es una pestaña con su contador, no un desplegable: se elige una. */
  estado: '' | EstadoTarea
  /** Vacíos = todos. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  prioridades: PrioridadTarea[]
  /** Ids de los responsables; lista vacía = los de todos, y el -1 son las que no tienen responsable. */
  responsableIds: number[]
  sucursales: string[]
  /** true = sólo las que vencen hoy o ya vencieron. */
  soloVencidas: boolean
}

export interface ListadoTareas {
  filas: FilaTarea[]
  porEstado: Record<EstadoTarea, number>
  total: number
  sucursales: string[]
  responsables: Array<{ id: number; nombre: string }>
  /** Cuántas de las que se están mirando están vencidas y cuántas vencen hoy. */
  vencidas: number
  venceHoy: number
  avisoDeSincronizacion: string | null
  hoy: string
}

export interface FichaTarea {
  tarea: FilaTarea
  comentarios: ComentarioDeTarea[]
  adjuntos: AdjuntoDeTarea[]
  responsables: Array<{ id: number; nombre: string }>
  sucursales: string[]
  /** Dónde quedan guardados los archivos, para decirlo en pantalla. */
  carpetaDeAdjuntos: string
}

export interface DatosDeTareaCompleta {
  titulo: string
  detalle: string
  responsableId: number | null
  sucursal: string
  /** 'AAAA-MM-DD' o vacío. */
  venceEl: string
  prioridad: PrioridadTarea | ''
  /** Con qué ficha se vincula. Todos opcionales: una tarea puede ser suelta. */
  clienteId: number | null
  polizaId: number | null
  siniestroId: number | null
  /** La fila de la bandeja de renovaciones de la que salió la tarea. */
  renovacionId: number | null
  leadId: number | null
  presupuestoId: number | null
}

/** Lo que se le puede cambiar a una tarea ya creada, desde su ficha. */
export interface DatosDeEdicionDeTarea {
  titulo: string
  detalle: string
  responsableId: number | null
  sucursal: string
  venceEl: string
  prioridad: PrioridadTarea | ''
  estado: EstadoTarea
}

/** Lo que muestra la campana de la barra superior: lo que le toca a quien está usando la aplicación. */
export interface AvisosDeTareas {
  /** Tareas asignadas a mí que todavía no vi: son las que encienden el punto de la campana. */
  nuevas: number
  venceHoy: number
  vencidas: number
  pendientes: number
  /**
   * Los ids de las que todavía no vi. Es lo que decide si SUENA la campana, y va aparte de `filas` a
   * propósito: `filas` son las ocho primeras de todo lo abierto, así que sonar por lo que aparece ahí
   * daría un aviso cada vez que una tarea vieja sube un lugar, y ninguno por una tarea nueva que
   * ordena novena. Sin tope: son sólo números.
   */
  idsNuevas: number[]
  /** Las primeras, para el desplegable de la campana. */
  filas: FilaTarea[]
  hoy: string
}

/**
 * Una tarea que se acaba de dar por terminada. Viaja del proceso principal al renderer para que suene
 * el aviso, y es lo mismo que dice la notificación del sistema. Se manda desde las tres pantallas que
 * pueden cerrar una tarea (el módulo Tareas, la ficha de un cliente y la de un siniestro).
 */
export interface TareaCompletada {
  tareaId: number
  titulo: string
  /** Quién la marcó. Vacío si no se sabe. */
  porQuien: string
}

// ---------------------------------------------------------------------------
// Fase 9 · Métricas y estadísticas
// ---------------------------------------------------------------------------

/** Filtros globales del tablero: una sucursal (o todas) y un mes. */
export interface FiltrosMetricas {
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  sucursales: string[]
  /** 'AAAA-MM'; null = el mes abierto de la cartera. */
  periodo: string | null
}

/** Una porción de un reparto: cuántos son y qué parte del total representan. */
export interface PorcionMetrica {
  etiqueta: string
  cantidad: number
  /** 0 a 100, con un decimal. */
  porcentaje: number
}

export interface BajaPorMotivo {
  motivo: string
  cantidad: number
}

/** Un mes de la evolución de los últimos doce. */
export interface MesDeEvolucion {
  periodo: string
  activos: number
  altas: number
  bajas: number
  /** null cuando quien mira no ve los números de la agencia. Un cero diría «no se cobró nada». */
  cobrado: number | null
}

export interface CobranzaDelMes {
  /** null cuando quien mira no ve los números de la agencia. */
  cobrado: number | null
  pendiente: number | null
  /** La CANTIDAD de cuotas la ve todo el mundo: es trabajo hecho y trabajo por hacer, no plata. */
  cuotasCobradas: number
  cuotasPendientes: number
  /** Cuotas sin importe numérico: no suman ni de un lado ni del otro, pero se cuentan. */
  sinImporte: number
  /** null por lo mismo que `cobrado`: es el reparto de lo recaudado. */
  porMedio: TotalPorMedio[] | null
}

/**
 * Lo que muestra el módulo Métricas: el equivalente de las pestañas SEGUROS ACT y CONTADOR de la
 * hoja, más la cobranza del mes y los siniestros abiertos.
 */
export interface TableroMetricas {
  periodo: string
  periodos: string[]
  /** Las sucursales filtradas, ya escritas como el catálogo. Vacías = el tablero es de toda la agencia. */
  sucursalesElegidas: string[]
  /** Todas las del catálogo: son las opciones del desplegable. */
  sucursales: string[]

  activos: number
  activosPorCompania: PorcionMetrica[]
  activosPorSucursal: PorcionMetrica[]

  altas: number
  bajas: number
  bajasPorMotivo: BajaPorMotivo[]
  /** false si no hay mes anterior cargado: sin él las altas no se pueden deducir y van en 0. */
  hayMesAnterior: boolean

  evolucion: MesDeEvolucion[]
  cobranza: CobranzaDelMes

  siniestrosAbiertos: number
  siniestrosPorCompania: PorcionMetrica[]

  hoy: string
}

/** Una fila de la versión tabular (Cartera → Estadísticas), sea de compañía o de sucursal. */
export interface FilaEstadistica {
  etiqueta: string
  activos: number
  altas: number
  bajas: number
  /** Cuántos pagos entraron en el mes. La cantidad la ve todo el mundo. */
  pagos: number
  /** Cuánto suman. null cuando quien mira no ve los números de la agencia. */
  cobrado: number | null
}

export interface EstadisticasDeCartera {
  periodo: string
  periodos: string[]
  /** Las sucursales filtradas, ya escritas como el catálogo. Vacías = son las de toda la agencia. */
  sucursalesElegidas: string[]
  /** Todas las del catálogo: son las opciones del desplegable. */
  sucursales: string[]
  porCompania: FilaEstadistica[]
  porSucursal: FilaEstadistica[]
  totales: FilaEstadistica
  hayMesAnterior: boolean
  hoy: string
}

// ---------------------------------------------------------------------------
// Fase 9 · Reportes: el centro de exportación
// ---------------------------------------------------------------------------

export const FORMATOS_DE_REPORTE = ['xlsx', 'pdf'] as const
export type FormatoDeReporte = (typeof FORMATOS_DE_REPORTE)[number]

/** Qué filtro entiende cada reporte. La pantalla dibuja sólo los que el reporte declara. */
export type FiltroDeReporte = 'periodo' | 'sucursal' | 'compania' | 'estado' | 'busqueda' | 'fechas'

export interface ColumnaDeReporte {
  id: string
  titulo: string
  /** Ancho sugerido en caracteres, para que el .xlsx abra ya legible. */
  ancho: number
  /** true si la columna es un número: va alineada a la derecha. */
  numerica?: boolean
}

export interface DefinicionDeReporte {
  id: string
  nombre: string
  descripcion: string
  filtros: FiltroDeReporte[]
  columnas: ColumnaDeReporte[]
  /** Valores del filtro «estado», si el reporte lo tiene. */
  estados: string[]
  /** Cómo se llama el filtro de estado en este reporte («Estado del trámite», «Cobrada»…). */
  etiquetaDeEstado: string
}

export interface CatalogoDeReportes {
  reportes: DefinicionDeReporte[]
  periodos: string[]
  sucursales: string[]
  companias: string[]
  hoy: string
}

export interface FiltrosDeReporte {
  /** 'AAAA-MM' o vacío. Elige el mes del reporte, no filtra dentro. */
  periodo: string
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  sucursales: string[]
  companias: string[]
  estados: string[]
  busqueda: string
  /** 'AAAA-MM-DD' o vacío. */
  desde: string
  hasta: string
}

export interface PedidoDeReporte {
  reporteId: string
  filtros: FiltrosDeReporte
  /** Ids de las columnas elegidas, en orden. Vacío = todas las del reporte. */
  columnas: string[]
}

export interface VistaPreviaDeReporte {
  reporteId: string
  nombre: string
  columnas: ColumnaDeReporte[]
  /** Las primeras filas, para mirar antes de exportar. */
  filas: string[][]
  total: number
  mostradas: number
}

/**
 * Lo mismo que la vista previa pero entero, para la pantalla que muestra un área «como en Excel».
 *
 * Va aparte de `VistaPreviaDeReporte` porque son dos cosas distintas: la vista previa son cincuenta
 * filas para mirar antes de exportar, y esto es la planilla para trabajar. Con un tope igual, porque
 * mandar setenta mil filas al renderer cuelga la ventana; cuando se llega, la pantalla lo dice y
 * ofrece filtrar o bajar el .xlsx, en vez de mostrar un pedazo sin avisar.
 */
export interface FilasDeReporte {
  reporteId: string
  nombre: string
  columnas: ColumnaDeReporte[]
  filas: string[][]
  /** Cuántas hay en total, antes del tope. */
  total: number
  /** true si `filas` está recortada: hay más de las que se mandaron. */
  recortado: boolean
}

/** Un área del programa mirada como planilla: qué reporte la alimenta y cómo se llama. */
export interface AreaDeExcel {
  /** El id del reporte que la alimenta. */
  id: string
  nombre: string
  descripcion: string
  /** Los filtros que entiende, para dibujar sólo esos. */
  filtros: FiltroDeReporte[]
  estados: string[]
  etiquetaDeEstado: string
  /** A qué módulo de la barra lateral corresponde: el botón «Ver como Excel» vuelve desde ahí. */
  modulo: string
}

/** Lo que necesita el módulo «General Excel» para dibujarse. */
export interface CatalogoDeExcel {
  areas: AreaDeExcel[]
  periodos: string[]
  sucursales: string[]
  companias: string[]
  hoy: string
}

/** Lo que hace falta para armar el reporte especial «Planilla clásica». */
export interface OpcionesPlanillaClasica {
  /** Meses elegidos, 'AAAA-MM'. Una pestaña por mes, más su pestaña de BAJAS. */
  periodos: string[]
  /** Vacías = todas. Con una o varias elegidas, el nombre del archivo las nombra. */
  sucursales: string[]
}

// ---------------------------------------------------------------------------
// Catálogo de vehículos (autos y motos por API)
// ---------------------------------------------------------------------------

/**
 * Lo ÚNICO que se elige a mano de todo el vehículo. El resto —marca, modelo, línea, año y sobre todo
 * la categoría— sale del catálogo, porque quien carga no tiene por qué saber si una Amarok es
 * camioneta o pick-up, y la compañía sí.
 */
export const TIPOS_DE_VEHICULO = ['AUTO', 'MOTO'] as const
export type TipoDeVehiculo = (typeof TIPOS_DE_VEHICULO)[number]

export const NOMBRE_TIPO_VEHICULO: Record<TipoDeVehiculo, string> = {
  AUTO: 'Auto',
  MOTO: 'Moto',
}

/**
 * Qué se puede asegurar con una póliza. Los dos primeros son los vehículos de siempre (van al catálogo
 * y a la validación de antigüedad); el resto son los riesgos que la agencia también vende y que hasta
 * ahora no tenían dónde cargarse desde «Nueva póliza». Se guardan en `vehiculos.tipo`, en mayúsculas y
 * con espacios, para que en la planilla se lean tal cual («HOGAR», «ACCIDENTE PERSONAL»).
 */
export const TIPOS_DE_RIESGO = ['AUTO', 'MOTO', 'BICICLETA', 'ACCIDENTE PERSONAL', 'HOGAR', 'INTEGRAL DE COMERCIO', 'OTRO'] as const
export type TipoDeRiesgo = (typeof TIPOS_DE_RIESGO)[number]

export const NOMBRE_TIPO_RIESGO: Record<TipoDeRiesgo, string> = {
  AUTO: 'Auto',
  MOTO: 'Moto',
  BICICLETA: 'Bicicleta',
  'ACCIDENTE PERSONAL': 'Accidente personal',
  HOGAR: 'Hogar',
  'INTEGRAL DE COMERCIO': 'Integral de comercio',
  OTRO: 'Otros',
}

/** Una persona cubierta por una póliza de accidentes personales. */
export interface IntegranteDePoliza {
  nombre: string
  documento: string
}

/**
 * La categoría la DECIDE el catálogo con los datos elegidos: no se puede elegir ni corregir. Es lo
 * que pidió la agencia y además es lo correcto: de la categoría dependen la prima y la cobertura, y
 * dejar que se elija a mano es dejar que se equivoque a mano.
 */
export const CATEGORIAS_DE_VEHICULO = [
  'SEDAN',
  'HATCHBACK',
  'COUPE',
  'CABRIOLET',
  'RURAL',
  'MONOVOLUMEN',
  'SUV',
  'PICKUP',
  'FURGON',
  'CAMION',
  'MICRO',
  'MOTO',
  'SCOOTER',
  'CUATRICICLO',
  'OTRO',
] as const
export type CategoriaDeVehiculo = (typeof CATEGORIAS_DE_VEHICULO)[number]

export const NOMBRE_CATEGORIA: Record<CategoriaDeVehiculo, string> = {
  SEDAN: 'Sedán',
  HATCHBACK: 'Hatchback',
  COUPE: 'Coupé',
  CABRIOLET: 'Cabriolet',
  RURAL: 'Rural / familiar',
  MONOVOLUMEN: 'Monovolumen',
  SUV: 'SUV',
  PICKUP: 'Pick-up',
  FURGON: 'Furgón / utilitario',
  CAMION: 'Camión',
  MICRO: 'Micro / colectivo',
  MOTO: 'Moto',
  SCOOTER: 'Scooter',
  CUATRICICLO: 'Cuatriciclo',
  OTRO: 'Otro',
}

/** Una opción de un desplegable del selector encadenado. */
export interface OpcionDeCatalogo {
  id: string
  nombre: string
}

/** Una línea (la versión concreta): es el único nivel que trae categoría y años. */
export interface LineaDeCatalogo extends OpcionDeCatalogo {
  anioDesde: number | null
  anioHasta: number | null
  categoria: CategoriaDeVehiculo | null
}

/** Lo que queda cuando el vehículo se terminó de elegir del catálogo. */
export interface VehiculoDelCatalogo {
  tipo: TipoDeVehiculo
  marca: string
  modelo: string
  linea: string
  anio: string
  /** null cuando el catálogo no la sabe. No se inventa un «OTRO» que después nadie puede corregir. */
  categoria: CategoriaDeVehiculo | null
  /** El código del proveedor: es lo que distingue un vehículo identificado de uno tipeado. */
  codigo: string
}

/** Cómo está la caché de un tipo de vehículo. */
export interface EstadoDeUnTipo {
  tipo: TipoDeVehiculo
  refrescadoEn: string | null
  marcas: number
  modelos: number
  lineas: number
  ultimoError: string | null
}

/**
 * Con qué proveedor habla el catálogo. InfoAuto es el catálogo clásico de las aseguradoras
 * argentinas; Mercado Libre es la API que la agencia contrató desde el panel de desarrolladores de
 * Mercado Pago. Se elige uno: los ids de marca y modelo de cada uno no tienen nada que ver entre sí,
 * así que mezclarlos rompería las pólizas ya cargadas con el código del otro.
 */
export const PROVEEDORES_DE_CATALOGO = ['INFOAUTO', 'MERCADO_LIBRE'] as const
export type ProveedorDeCatalogo = (typeof PROVEEDORES_DE_CATALOGO)[number]

export const NOMBRE_PROVEEDOR_CATALOGO: Record<ProveedorDeCatalogo, string> = {
  INFOAUTO: 'InfoAuto',
  MERCADO_LIBRE: 'Mercado Libre',
}

/**
 * Cómo se llama cada credencial según el proveedor. Es lo mismo por dentro —un identificador y un
 * secreto— pero en el panel de cada uno se llama distinto, y la pantalla tiene que decir el nombre
 * que la persona está viendo del otro lado.
 */
export const ETIQUETAS_DE_CREDENCIAL: Record<ProveedorDeCatalogo, { usuario: string; clave: string; ayuda: string }> = {
  INFOAUTO: {
    usuario: 'Usuario',
    clave: 'Clave',
    ayuda: 'El usuario y la clave de la cuenta que la agencia tiene con InfoAuto.',
  },
  MERCADO_LIBRE: {
    usuario: 'App ID',
    clave: 'Clave secreta',
    ayuda: 'Se copian del panel de desarrolladores de Mercado Pago, en la aplicación que creaste (App ID y Clave secreta).',
  },
}

/**
 * Cómo quedó la sincronización de las credenciales con el VPS.
 *
 * El superadministrador las carga una sola vez y viajan al servidor; el resto de las computadoras las
 * adopta al arrancar. `alDia` compara huellas: sirve para decir «esta PC tiene lo mismo que el
 * servidor» sin volver a bajar el secreto.
 */
export interface EstadoDeAjusteCompartido {
  /** true si el VPS tiene credenciales guardadas para compartir. */
  enElServidor: boolean
  actualizadoEn: string | null
  actualizadoPor: string | null
  /** true si lo que hay en esta computadora coincide con lo del servidor. */
  alDia: boolean
  /** Por qué no se pudo hablar con el servidor, si no se pudo. Nunca frena nada. */
  error: string | null
}

export interface EstadoDelCatalogo {
  /** false = faltan las credenciales del proveedor en esta computadora. */
  configurado: boolean
  proveedor: string
  proveedorId: ProveedorDeCatalogo
  usuario: string
  /** true si además del identificador y el secreto hay un Access Token pegado a mano. */
  tokenCargado: boolean
  /** Los tipos de vehículo que este proveedor puede servir: Mercado Libre no publica motos. */
  tiposQueSirve: TipoDeVehiculo[]
  /** Dónde se guardan las credenciales, para poder decirlo en la pantalla. */
  rutaDeConfig: string
  porTipo: EstadoDeUnTipo[]
  /** true si hay algo bajado: sin esto el selector cae solo a los campos de texto de siempre. */
  hayCatalogo: boolean
}

export interface DatosDelProveedorDeVehiculos {
  proveedor?: ProveedorDeCatalogo
  usuario: string
  clave: string
  /** Sólo Mercado Libre: un Access Token `APP_USR-…` pegado a mano, si se prefiere ese camino. */
  accessToken?: string
}

/** El estado de las credenciales acá y en el servidor: lo que devuelve todo lo que las toca. */
export interface EstadoDeCredencialesDeVehiculos {
  estado: EstadoDelCatalogo
  compartido: EstadoDeAjusteCompartido
}

export interface GuardadoDeCredencialesDeVehiculos extends EstadoDeCredencialesDeVehiculos {
  /** Qué pasó, en una frase, para mostrar arriba de la pantalla. */
  detalle: string
}

export interface AdopcionDeCredencialesDeVehiculos extends EstadoDeCredencialesDeVehiculos {
  /** true si esta computadora se quedó con las credenciales que había en el servidor. */
  adoptadas: boolean
  detalle: string
}

/**
 * La consola del control remoto de las computadoras de la agencia (MeshCentral).
 *
 * `enLinea` se mide de verdad, con un pedido: el valor de esto es enterarse de que está caída ANTES
 * de abrir el navegador, no después.
 */
export interface EstadoDelMesh {
  url: string
  enLinea: boolean
  detalle: string
  tardanzaMs: number
}

export interface PruebaDelProveedor {
  ok: boolean
  detalle: string
  marcasEncontradas: number
}

/** El avance del refresco, que baja decenas de miles de filas y no puede parecer colgado. */
export interface ProgresoDeCatalogo {
  tipo: TipoDeVehiculo
  etapa: 'marcas' | 'modelos' | 'lineas' | 'listo'
  hechas: number
  totales: number
  detalle: string
}

// ---------------------------------------------------------------------------
// Marketing · Redes sociales (Facebook e Instagram)
// ---------------------------------------------------------------------------

export const DESTINOS_DE_PUBLICACION = ['FACEBOOK', 'INSTAGRAM'] as const
export type DestinoDePublicacion = (typeof DESTINOS_DE_PUBLICACION)[number]

export const NOMBRE_DESTINO: Record<DestinoDePublicacion, string> = {
  FACEBOOK: 'Facebook',
  INSTAGRAM: 'Instagram',
}

/** Lo que hay cargado de la app de Meta. El App Secret NUNCA viaja al renderer. */
export interface EstadoDeMeta {
  /** true si están cargados el App ID y el App Secret en esta computadora. */
  configurada: boolean
  appId: string
  /** La dirección que hay que registrar en el panel de Meta. Es el error de configuración más común. */
  urlDeRedireccion: string
  /** Dónde se guarda, para poder decirlo en la pantalla. */
  rutaDeConfig: string
  actualizadoEn: string | null
}

export interface DatosDeMeta {
  appId: string
  appSecret: string
}

/** Una Página para elegir, cuando la persona administra más de una. */
export interface PaginaParaElegir {
  id: string
  nombre: string
  /** El usuario de Instagram vinculado a esa Página, o null si no tiene. */
  instagramUsuario: string | null
}

/** El vínculo activo, tal como lo ve la pantalla. Sin tokens. */
export interface VinculoConMeta {
  paginaId: string
  paginaNombre: string
  instagramUsuario: string | null
  vinculadoPor: string
  vinculadoEn: string
}

/** Lo que devuelve «Vincular cuenta»: las Páginas encontradas, para elegir una. */
export interface VinculacionPendiente {
  paginas: PaginaParaElegir[]
  /**
   * Cuando hay una sola Página se elige sola y esto viene con el vínculo ya hecho: preguntar «cuál de
   * esta única opción» es una pregunta que no es una pregunta.
   */
  vinculada: VinculoConMeta | null
}

export interface PublicacionDeRed {
  id: number
  destino: DestinoDePublicacion
  estado: 'PUBLICADA' | 'FALLIDA'
  texto: string
  /** El nombre del archivo que se publicó, sin la ruta. null si fue sólo texto. */
  archivo: string | null
  /** La dirección de la publicación, para abrirla. null si falló. */
  url: string | null
  /** El motivo, cuando falló. Se guarda porque si no se pierde apenas se cierra la pantalla. */
  error: string | null
  publicadoPor: string
  publicadoEn: string
}

/** Un archivo elegido para publicar, ya revisado por el proceso principal. */
export interface ArchivoParaPublicar {
  ruta: string
  nombre: string
  tipo: string
  bytes: number
  /** La imagen en data: URI para la vista previa. */
  vistaPrevia: string
  /** Qué le impide ir a Instagram, si algo. Vacío = se puede. */
  avisoDeInstagram: string
}

/** Todo lo que necesita la pestaña Marketing → Redes para dibujarse. */
export interface PanelDeRedes {
  /** false = falta cargar el App ID y el App Secret en Administración. */
  appConfigurada: boolean
  /** false = el sistema no puede cifrar y no se puede guardar el vínculo. */
  puedeGuardar: boolean
  vinculo: VinculoConMeta | null
  /** Si la Página vinculada tiene una cuenta de Instagram Business. */
  puedePublicarEnInstagram: boolean
  /** Cuántas publicaciones más admite Instagram hoy; null si no se pudo averiguar. */
  cuotaDeInstagram: number | null
  /** El último error de Meta, si el vínculo se cayó. */
  ultimoError: string | null
  historial: PublicacionDeRed[]
}

export interface PedidoDePublicacion {
  destino: DestinoDePublicacion
  texto: string
  /** Ruta del archivo elegido. Vacío = sólo texto (que Instagram no acepta). */
  ruta: string
}

// ---------------------------------------------------------------------------
// Fase 9 · Marketing: plantillas de mensajes y segmentos de la cartera
// ---------------------------------------------------------------------------

/** Las variables que se pueden usar en cualquier plantilla. */
export const VARIABLES_DE_PLANTILLA = ['nombre', 'cuota', 'vencimiento', 'patente', 'compania'] as const
export type VariableDePlantilla = (typeof VARIABLES_DE_PLANTILLA)[number]

/** La clave de la plantilla que usa el botón «Avisar» de la Cartera y de la Mora. */
export const CLAVE_AVISO_DE_VENCIMIENTO = 'aviso_vencimiento'

export interface PlantillaDeMensaje {
  id: number
  clave: string
  nombre: string
  descripcion: string | null
  texto: string
  /** La del botón «Avisar»: se le cambia el texto pero no se borra. */
  fija: boolean
  actualizadoEn: string
  /** Cómo queda el mensaje con un cliente de ejemplo. */
  ejemplo: string
}

export interface DatosDePlantilla {
  nombre: string
  descripcion: string
  texto: string
}

/** Qué ventana de vencimiento pide el segmento. */
export const VENTANAS_DE_VENCIMIENTO = ['', 'ESTA SEMANA', 'ESTE MES', 'VENCIDAS'] as const
export type VentanaDeVencimiento = (typeof VENTANAS_DE_VENCIMIENTO)[number]

/** El filtro guardado de un segmento. Es lo que se recalcula cada vez que se abre. */
export interface FiltrosDeSegmento {
  /** Vacías = todas. Ver `src/shared/filtros.ts`: la lista vacía nunca filtra. */
  sucursales: string[]
  companias: string[]
  formasDePago: string[]
  /** Las siete de `src/shared/ramas.ts`, más lo que la base tenga fuera del catálogo. */
  ramas: string[]
  vence: VentanaDeVencimiento
  /** Sólo las cuotas que no figuran pagas. */
  soloImpagas: boolean
  /** Sólo las que todavía no tienen el aviso enviado. */
  soloSinAvisar: boolean
  /** Deja afuera débito automático, CBU y tarjeta: se cobran solos y no hay que avisar. */
  excluirDebito: boolean
}

export const SEGMENTO_SIN_FILTROS: FiltrosDeSegmento = {
  sucursales: [],
  companias: [],
  formasDePago: [],
  ramas: [],
  vence: '',
  soloImpagas: true,
  soloSinAvisar: false,
  excluirDebito: true,
}

export interface Segmento {
  id: number
  nombre: string
  descripcion: string | null
  filtros: FiltrosDeSegmento
  plantillaClave: string | null
  creadoPor: string
  actualizadoEn: string
}

export interface DatosDeSegmento {
  nombre: string
  descripcion: string
  filtros: FiltrosDeSegmento
  plantillaClave: string
}

/** Una fila del resultado de un segmento: la cuota del mes abierto y su mensaje ya armado. */
export interface FilaDeSegmento {
  filaId: string
  periodo: string
  clienteId: number | null
  nombre: string | null
  telefono: string | null
  sucursal: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  cuota: string | null
  cuotaMonto: number | null
  formaPago: string | null
  diaVencimiento: string | null
  /** 'AAAA-MM-DD' del vencimiento de la cuota; null si la fila no tiene día cargado. */
  vencimiento: string | null
  diasParaVencer: number | null
  pagada: boolean
  avisado: boolean
  fechaEnvio: string | null
  /** El mensaje ya armado con la plantilla elegida, para leerlo antes de mandarlo. */
  mensaje: string
  /** Sin teléfono no se puede avisar: la fila se muestra igual, con el botón apagado. */
  tieneTelefono: boolean
}

export interface ResultadoDeSegmento {
  /** null si se está mirando un filtro suelto y no un segmento guardado. */
  segmentoId: number | null
  filtros: FiltrosDeSegmento
  plantillaClave: string
  plantillas: PlantillaDeMensaje[]
  segmentos: Segmento[]
  periodo: string
  filas: FilaDeSegmento[]
  total: number
  /** Cuántas de las que están en la lista ya tienen el aviso enviado. */
  avisados: number
  sinTelefono: number
  sucursales: string[]
  companias: string[]
  formasDePago: string[]
  /** Las opciones del filtro de rama: las siete de la agencia más lo que la base traiga aparte. */
  ramas: string[]
  hoy: string
}

/** Lo que devuelve «Avisar» en una fila del segmento: el WhatsApp listo y la fila actualizada. */
export interface AvisoDeSegmento {
  url: string
  mensaje: string
  telefono: string
  fila: FilaDeSegmento
  /** false si el mes de la cuota ya está cerrado: se avisa igual, pero la planilla no se toca. */
  marcada: boolean
  avisados: number
}
