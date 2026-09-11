// Tipos compartidos entre el proceso principal, la precarga y el renderer.
// Este archivo no puede importar nada de Electron ni de Node: lo usan los tres lados.
import type { DireccionEstructurada } from './direccion'
import type { MatrizPermisos, PermisosDeUnRol } from './permisos'
// Sólo el tipo: `ramas.ts` importa de acá `CategoriaDeVehiculo`, también sólo el tipo, así que las dos
// flechas se borran al compilar y no queda ningún ciclo en tiempo de ejecución.
import type { Rama } from './ramas'
// El contrato del canal en vivo (14.0), también sólo el tipo. `protocolo.ts` es la copia exacta de lo
// que declara el servidor y no importa nada de nadie: la flecha se borra al compilar, igual que la que
// ya sale de `shared/presencia.ts`. Se toma de ahí y no se vuelve a escribir acá para que la pantalla
// y el proceso principal no puedan quedar diciendo cosas distintas sobre la misma llamada.
import type { ConfiguracionIce, EventoDeLlamada, MotivoDeCorte } from '../main/vivo/protocolo'

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
/**
 * Si la agencia tiene cargada la conexión con Google Drive y si ESTA computadora ya la tiene.
 *
 * Existe aparte de `EstadoConexionGoogle` porque lo mira TODO EL EQUIPO y no sólo quien la carga: no
 * lleva ni el correo de la cuenta ni la URL de la hoja, nada más que si está y de cuándo es. La
 * credencial es obligatoria (12.5) y sin ella no suben los respaldos ni los adjuntos de los
 * siniestros, así que quien atiende el mostrador tiene que poder ver que falta —y avisarle al
 * superadministrador— en vez de enterarse el día que hace falta un documento.
 */
export interface EstadoDeGoogleEnLaAgencia {
  /**
   * true si esta versión habla con el VPS. En desarrollo no hay puente y no se sabe nada del resto de
   * la agencia: sin esto, el cartel de «falta cargarla» quedaría prendido para siempre en la máquina
   * de quien programa, que es la forma más rápida de que un aviso deje de leerse.
   */
  hayServidor: boolean
  /** true si esta computadora tiene la credencial y puede subir a Drive. */
  enEstaComputadora: boolean
  /** true si el superadministrador ya la cargó y viajó al VPS. */
  enElServidor: boolean
  /** true si lo de acá es exactamente lo que hay en el servidor. */
  alDia: boolean
  actualizadoEn: string | null
  actualizadoPor: string | null
  /** Por qué no se pudo preguntarle al servidor, si es el caso. No frena nada. */
  error: string | null
}

export interface EstadoConexionGoogle {
  configurado: boolean
  clientEmail: string | null
  projectId: string | null
  urlHoja: string | null
  actualizadoEn: string | null
  /**
   * Cómo está esta conexión en el servidor, para que la pantalla pueda decir si el resto de las
   * computadoras tiene lo mismo. `null` = todavía no se consultó (o no hay servidor en esta versión).
   */
  compartido?: EstadoDeAjusteCompartido | null
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
 *
 * `disponible` es la novedad que se acaba de detectar y todavía no se bajó: es la que dispara el
 * cartel «Actualización disponible encontrada» con sus dos botones. Antes de la 15-min se pasaba
 * directo a `descargando` sin preguntar nada.
 */
export type SituacionActualizacion = 'deshabilitada' | 'buscando' | 'al-dia' | 'disponible' | 'descargando' | 'lista' | 'error'

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
 * El reporte que cada sucursal manda sobre SU computadora, para que el superadministrador vea desde
 * la pantalla de Usuarios quién tiene el programa al día y quién dejó una actualización para después.
 * Viaja por el mismo mecanismo que el encabezado del ticket: cada sucursal sólo puede escribir su
 * propio renglón (ver `estadoDeActualizaciones.ts`).
 */
export interface EstadoDeActualizacionDeSucursal {
  sucursal: string
  /** Versión que tiene instalada esa sucursal ahora mismo. */
  version: string
  /** Última vez que esa sucursal confirmó su versión (se reporta en cada chequeo). */
  reportadoEn: string
  /** La versión que dejó «para después», o null si nunca la rechazó o si ya actualizó. */
  rechazoVersion: string | null
  rechazadoEn: string | null
}

/**
 * Respuesta estándar de todo llamado IPC. Los errores esperables (validación,
 * permisos, credenciales) vuelven como `ok: false` con un mensaje listo para mostrar.
 *
 * `codigo` está para los pocos errores que la pantalla tiene que tratar distinto del resto y no
 * alcanza con leerle el mensaje (14.0). Hoy hay uno solo, `'sin-conexion'`: se cayó el canal con la
 * base de la agencia y no se puede guardar («ver sí, tocar no»). Eso no es un cartel al lado de un
 * campo mal cargado, es el banner de arriba y volver a intentar cuando vuelva internet.
 */
export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string; codigo?: string }

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
  // 12.6: los adjuntos (fotos y documentos de pólizas, siniestros y tareas) y los comentarios de
  // tareas y observaciones de siniestros. Antes quedaban sólo en la PC donde se cargaron.
  | 'APP_ADJUNTOS'
  | 'APP_COMENTARIOS'
  // 12.10: la caja chica de cada mostrador (el cambio del día, los gastos, lo que baja a la caja
  // fuerte y el arqueo del cierre). Lo cobrado ya viaja por APP PAGOS: acá va sólo lo demás.
  | 'APP_CAJA'
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
  APP_ADJUNTOS: 'Adjuntos (la escribe DM Gestión)',
  APP_COMENTARIOS: 'Comentarios y observaciones (la escribe DM Gestión)',
  APP_CAJA: 'Caja chica (la escribe DM Gestión)',
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
  /** Cuándo se deshizo este cambio, o `null` si sigue en pie. */
  deshechoEn: string | null
  /** Quién lo deshizo. */
  deshechoPor: string | null
  /** Si el botón «Deshacer» tiene sentido acá: no es un tipo de cambio reversible, o ya se deshizo. */
  puedeDeshacerse: boolean
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

/**
 * En qué anda la sincronización, para el indicador de la barra de arriba.
 *
 * `reconectando` es de la 14.0: el canal en vivo se cortó y se está volviendo a conectar. No es
 * «sin conexión» —los dos primeros intentos suelen ser un despliegue del servidor y vuelven en un
 * segundo— pero tampoco es «sincronizado», porque mientras tanto no entra ni sale nada.
 *
 * Desde la 14.0 `sin-conexion` sale del canal y no de que la última llamada haya fallado por red: el
 * canal lo sabe en el momento y no cuando toca subir algo (ver `sincronizacion/motor.ts`).
 */
export type SituacionSync = 'sincronizado' | 'pendiente' | 'reconectando' | 'sin-conexion' | 'apagado' | 'trabajando'

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

/**
 * En qué anda el canal en vivo con el VPS (14.0). Lo mira el banner de arriba de todo y lo miran los
 * botones que escriben: desde la 14.0 la regla es «ver sí, tocar no», así que sin canal la pantalla
 * se sigue leyendo pero nada se guarda.
 *
 * `sin-puente` no es un error: es la computadora de desarrollo (y el banco de pruebas) sin servidor
 * configurado. Ahí no se exige conexión, porque no hay ninguna a la que conectarse.
 */
export type SituacionDeConexion = 'conectado' | 'reconectando' | 'sin-conexion' | 'sin-puente'

export interface EstadoDeConexion {
  situacion: SituacionDeConexion
  /** ISO: desde cuándo está así. Es lo que deja mostrar «sin conexión hace 3 minutos». */
  desde: string
  /** Reintentos seguidos que fallaron. Vuelve a cero apenas el servidor saluda. */
  intentos: number
}

/**
 * La foto y el color de una persona de la agencia (14.0), tal como los muestra la pantalla.
 *
 * Es la versión de `Perfil` (el del canal) que le sirve al renderer: la foto ya viene como data URL —la
 * base la guarda como bytes— y no viaja `actualizadoEn`, que no se dibuja en ningún lado. La identidad
 * es la CLAVE de usuario, no el id local: el mismo perfil se ve igual en las cinco computadoras.
 */
export interface PerfilDeUsuario {
  clave: string
  /** Índice 0-11 en la paleta (`src/shared/paleta.ts`). Único por persona: lo cuida el servidor. */
  color: number
  /** `data:image/jpeg;base64,…` de 256 px, o null si esa persona nunca cargó una foto. */
  foto: string | null
  version: number
}

/** Lo que la pantalla puede cambiar de un perfil. Lo que no viene, no se toca. */
export interface DatosDePerfil {
  color?: number
  /** La foto nueva como data URL, o null para sacar la que había. */
  foto?: string | null
}

/**
 * En qué anda la llamada de voz de ESTA computadora (14.0). Hay una sola por vez: el teléfono de la
 * agencia tampoco atiende dos llamadas juntas, y una segunda mientras se está hablando sería un audio
 * encima del otro.
 *
 *   libre → llamando → en-llamada → terminando        (la que sale de acá)
 *   libre → timbrando → en-llamada → terminando       (la que entra)
 */
export type SituacionDeLlamada = 'libre' | 'llamando' | 'timbrando' | 'en-llamada' | 'terminando'

/** Por qué se cortó. Es el del protocolo del canal: lo escribe el servidor en el registro de llamadas. */
export type MotivoDeCorteDeLlamada = MotivoDeCorte

/** Lo que hace falta para armar la conexión de audio: los STUN de siempre y el TURN del VPS. */
export type ConfiguracionDeIce = ConfiguracionIce

/**
 * La señalización que hay que pasarle a la `RTCPeerConnection`: la oferta o la respuesta de la otra
 * punta, y cada candidato de red que va apareciendo. El audio NO pasa por acá ni por el servidor: va
 * derecho de una computadora a la otra.
 */
export type SenalDeLlamada = Extract<EventoDeLlamada, { tipo: 'sdp' } | { tipo: 'ice' }>

/** Lo que la pantalla manda cuando su `RTCPeerConnection` tiene algo para la otra punta. */
export type SenalParaMandar = { sdp: Extract<EventoDeLlamada, { tipo: 'sdp' }>['sdp'] } | { ice: Extract<EventoDeLlamada, { tipo: 'ice' }>['candidato'] }

export interface EstadoDeLlamada {
  situacion: SituacionDeLlamada
  /** El id que comparten las dos computadoras y el servidor. Null cuando no hay ninguna llamada. */
  llamadaId: string | null
  /** El id REMOTO de la conversación (el que conocen las cinco computadoras), para abrirla al atender. */
  conversacionId: string | null
  /** Con quién se está hablando (o quién llama). */
  con: { clave: string; nombre: string } | null
  /** true si la llamada la empezó esta computadora: es quien manda la oferta SDP. */
  saliente: boolean
  /** ISO: cuándo empezó a sonar. Sirve para el «llamando…» y para el corte por falta de respuesta. */
  desde: string | null
  /** ISO: cuándo se atendió, que es desde cuándo corre el cronómetro «3:12». Null si todavía no. */
  hablandoDesde: string | null
  /** Por qué se cortó la última: es lo que muestra el cartel al cerrarse. */
  motivo: MotivoDeCorteDeLlamada | null
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

/**
 * Un respaldo del GENERAL DE CLIENTES guardado EN EL SERVIDOR (12.5). Es otra cosa que
 * `RespaldoGuardado`, que es la copia .xlsx de esta computadora:
 *
 *   · la copia local la hace la aplicación y depende de que alguien la abra después de las 20:00, y
 *     queda en la máquina de la que justamente hay que tener copia;
 *   · éste lo hace el reloj del servidor, que está siempre encendido, y guarda la base de verdad.
 *
 * Los dos siguen existiendo: el .xlsx se abre en Excel sin nada más, y éste se puede rebobinar.
 */
export interface RespaldoDelVps {
  id: number
  /** El día que la agencia le pone, AAAA-MM-DD. */
  dia: string
  motivo: MotivoDeRespaldo
  /** Cuándo se guardó, en ISO. */
  fecha: string
  /** El volcado comprimido, en bytes. */
  tamano: number
  pestanas: number
  filas: number
  /** Quién lo pidió, o null cuando lo hizo solo el reloj del servidor. */
  hechoPor: string | null
}

export const MOTIVOS_DE_RESPALDO = ['DIARIO', 'A_MANO', 'ANTES_DE_RESTAURAR'] as const
export type MotivoDeRespaldo = (typeof MOTIVOS_DE_RESPALDO)[number]

export const NOMBRE_MOTIVO_RESPALDO: Record<MotivoDeRespaldo, string> = {
  DIARIO: 'Del día',
  A_MANO: 'A mano',
  ANTES_DE_RESTAURAR: 'Antes de restaurar',
}

/** Qué quedó después de rebobinar. */
export interface ResumenDeRestauracion {
  pestanas: number
  filas: number
/**
   * La foto que el servidor sacó del estado anterior antes de pisarlo: con esto se puede deshacer.
   * Viene en null en el único caso en que no había nada que fotografiar: el servidor estaba vacío.
   */
  respaldoPrevio: RespaldoDelVps | null
  /** Cuántas filas quedaron en la base de ESTA computadora después de volver a importar. */
  filasLocales: number
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
/**
 * RENOVADA se agregó en la 12.5 y no es un estado guardado: se deduce de que la póliza esté fuera de
 * la cartera Y tenga una sucesora que la nombra en `poliza_anterior_id`.
 *
 * Antes esa póliza se leía «Baja» —sin motivo— en el listado, en la ficha del cliente y en el Excel,
 * indistinguible de una que la compañía anuló. Es justamente lo contrario: la cartera no se perdió,
 * siguió con otro número. Confundirlas hace que la agencia crea que perdió clientes que no perdió.
 */
export const ESTADOS_DE_POLIZA = ['ACTIVA', 'VENCIDA', 'RENOVADA', 'BAJA'] as const
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
  /**
   * El `_ID` de la fila en la hoja de la agencia: el nombre que esta fila tiene en las CINCO
   * computadoras (14.0). El `id` de arriba es de esta base y en cada máquina es otro, así que no sirve
   * para decir «Ana está mirando a este cliente»: la presencia y el glow se agarran de acá.
   *
   * Null en un cliente que todavía no viajó a la hoja (recién dado de alta, con la cola sin subir).
   */
  filaId: string | null
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
  /** Uno de los cuatro estados del trámite, el mismo que muestra el módulo Siniestros. */
  estado: EstadoSiniestro
  /** Lo que decía la hoja, cuando no es exactamente uno de los cuatro. Va al lado, entre paréntesis. */
  estadoTexto: string | null
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
  /**
   * El `_ID` de la fila en la hoja, igual que en `FilaCliente` (14.0): es con lo que la ficha abierta
   * reporta el foco y con lo que las otras computadoras dibujan el glow. Null si el cliente todavía no
   * viajó a la hoja.
   */
  filaId: string | null
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

/**
 * Qué pasa con la póliza VIEJA cuando se carga el número nuevo. Las tres son situaciones reales del
 * mostrador y hasta la 12.4 la aplicación resolvía siempre por la primera, sin preguntar:
 *
 *   · `renovada` — lo normal y lo que viene elegido: la vieja sale de la cartera y queda enganchada a
 *     la nueva. No es una baja y en BAJAS no tiene nada que hacer: no se dio de baja, se renovó.
 *   · `baja` — la compañía anuló la vieja en vez de renovarla (cambió de compañía, la reemitió con
 *     otro número, el cliente la anuló y volvió a tomar). Sale de la cartera Y aparece en
 *     Cartera → Bajas con su motivo, que es donde la agencia mira lo que se perdió en el mes.
 *   · `activa` — las dos conviven. Pasa cuando la compañía todavía no dio de baja la anterior, cuando
 *     la nueva es de otro riesgo del mismo cliente, o cuando la vieja sigue cubriendo hasta que la
 *     nueva empiece. Queda vigente en la cartera, con su fila del mes, y no vuelve a la bandeja de
 *     renovaciones porque su seguimiento ya quedó cerrado.
 */
export const DESTINOS_DE_LA_ANTERIOR = ['renovada', 'baja', 'activa'] as const
export type DestinoDeLaAnterior = (typeof DESTINOS_DE_LA_ANTERIOR)[number]

export const NOMBRE_DESTINO_ANTERIOR: Record<DestinoDeLaAnterior, string> = {
  renovada: 'Renovadas',
  baja: 'Bajas',
  activa: 'Activas',
}

/** La frase que explica cada opción en el cartel, para no repetirla en dos pantallas. */
export const DETALLE_DESTINO_ANTERIOR: Record<DestinoDeLaAnterior, string> = {
  renovada: 'Sale de la cartera y queda enganchada a la póliza nueva. Es lo que corresponde casi siempre.',
  baja: 'Sale de la cartera y además aparece en Cartera → Bajas con el motivo que elijas.',
  activa: 'Sigue vigente en la cartera, con su fila del mes: quedan las dos pólizas.',
}

export function esDestinoDeLaAnterior(valor: unknown): valor is DestinoDeLaAnterior {
  return typeof valor === 'string' && (DESTINOS_DE_LA_ANTERIOR as readonly string[]).includes(valor)
}

export interface DatosDeRenovacion {
  vigenciaDesde: string
  vigenciaHasta: string
  cuota: string
  numero: string
  /** Número de propuesta de la póliza nueva; vacío si la compañía no la usa o todavía no la dio. */
  propuesta: string
  observaciones: string
  /** Qué pasa con la póliza vieja. Sin esto se asume `renovada`, que es lo que hacía la 12.4. */
  destinoDeLaAnterior?: DestinoDeLaAnterior
  /** Sólo cuando el destino es `baja`: el motivo con el que entra a Cartera → Bajas. */
  motivoDeBaja?: MotivoDeBaja
  /** Sólo cuando el destino es `baja`: la nota de esa baja. */
  notaDeBaja?: string
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

/**
 * Qué es cada documento que se adjunta a un siniestro. Es la lista que pide la compañía para armar el
 * legajo, en el orden en que se junta: primero la denuncia y la cobertura, después las fotos y los
 * papeles del conductor y del auto, y al final lo que aparece según el caso.
 *
 * «Otras documentaciones» pide además escribir cuál: un adjunto sin nombre propio dentro de un mes se
 * vuelve un archivo que nadie sabe para qué está.
 */
export const CATEGORIAS_DE_ADJUNTO = [
  'Denuncia',
  'Certificado de cobertura',
  'Fotos del siniestro',
  'Registro de conducir',
  'DNI',
  'Cédula verde',
  'Denuncia policial',
  'Constancia médica',
  'Otras documentaciones',
] as const
export type CategoriaDeAdjunto = (typeof CATEGORIAS_DE_ADJUNTO)[number]

/** La categoría que exige aclarar de qué se trata. */
export const CATEGORIA_DE_ADJUNTO_OTRAS: CategoriaDeAdjunto = 'Otras documentaciones'

/** Si hubo terceros lesionados: vacío mientras no se sepa, y de ahí depende la constancia médica. */
export const RESPUESTAS_DE_LESIONADOS = ['', 'NO', 'SI'] as const
export type RespuestaDeLesionados = (typeof RESPUESTAS_DE_LESIONADOS)[number]

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
  /** Número del comprobante (la columna NRO TICKET de la planilla de caja); null si no se imprimió. */
  numeroTicket: string | null
  /** El tilde de REVISIÓN DE PAGO: alguien miró el cobro y está todo bien. */
  revisado: boolean
  /** Quién puso el tilde, y cuándo (ISO); null si todavía nadie lo revisó. */
  revisadoPor: string | null
  revisadoEn: string | null
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
  /**
   * La caja chica y el cuadre del día, que es la mitad de abajo de la planilla de caja de la agencia.
   * Es null cuando se está mirando más de una sucursal (o todas): la caja chica es el cambio que tiene
   * cada mostrador en el cajón, y sumar la de Lanús con la de Dock Sud no es la caja de nadie.
   */
  arqueo: ArqueoDeCaja | null
  hoy: string

  /** Mismo campo y mismo motivo que en `TableroMetricas`, con una salvedad: sólo `totalesPorMedio`/
   *  `total`/`sinImporte`/`imputados` pueden venir del servidor (nunca `pagos` ni `arqueo`, que siguen
   *  siendo siempre locales — ver la cabecera de servicios/cobranzasDesdeCache.ts), y sólo para hoy y
   *  ayer: cualquier otro día se calcula 100% acá, sin este campo. */
  calculadoEn?: string
  recibidoEnEstaComputadora?: string
  frescura?: FrescuraDeMetrica
}

/**
 * Los renglones de la caja chica que se cargan a mano. Lo demás —lo que se cobró y con qué medio— sale
 * de los pagos del día, así que no se escribe dos veces.
 *
 * - `APERTURA`: con cuánto cambio se empieza el día (la fila 2 de la planilla de la agencia). Uno solo
 *   por día y sucursal; si no está, se arrastra el último cierre contado.
 * - `GASTO`: lo que se pagó del cajón (la nafta, la limpieza), con el concepto al lado.
 * - `CAJA_FUERTE`: la plata que se bajó en efectivo y se guardó en la caja fuerte.
 * - `CIERRE`: lo que se contó en el cajón al cerrar. Uno solo por día y sucursal: es el arqueo.
 * - `OBSERVACION`: una nota de texto para dejar asentado algo del día (qué se llevó alguien, una
 *   aclaración) sin que sea plata: no tiene importe y no entra en ninguna cuenta de la caja.
 */
export const TIPOS_DE_MOVIMIENTO_DE_CAJA = ['APERTURA', 'GASTO', 'CAJA_FUERTE', 'CIERRE', 'OBSERVACION'] as const
export type TipoDeMovimientoDeCaja = (typeof TIPOS_DE_MOVIMIENTO_DE_CAJA)[number]

export const NOMBRE_MOVIMIENTO_DE_CAJA: Record<TipoDeMovimientoDeCaja, string> = {
  APERTURA: 'Caja chica al abrir',
  GASTO: 'Gasto',
  CAJA_FUERTE: 'A la caja fuerte',
  CIERRE: 'Contado al cerrar',
  OBSERVACION: 'Observación',
}

/** Los dos que son únicos por día y sucursal: cargarlos de nuevo corrige el que ya estaba. */
export const MOVIMIENTOS_UNICOS_DEL_DIA: TipoDeMovimientoDeCaja[] = ['APERTURA', 'CIERRE']

export interface MovimientoDeCaja {
  id: number
  filaId: string
  fecha: string
  sucursal: string
  tipo: TipoDeMovimientoDeCaja
  /** El concepto del gasto («limpieza»), o la aclaración de la bajada a la caja fuerte. */
  detalle: string | null
  importe: number
  usuarioNombre: string | null
  /** Hora en que se cargó ('HH:MM'); null en los que llegaron de la base sin hora. */
  hora: string | null
}

export interface DatosDeMovimientoDeCaja {
  fecha: string
  sucursal: string
  tipo: TipoDeMovimientoDeCaja
  detalle: string
  importe: string
}

/**
 * El arqueo de la caja chica de un mostrador en un día: el resumen automático de la planilla de la
 * agencia (las cuentas de la fila 34 para abajo), con el cuadre incluido.
 *
 * La cuenta es la misma que hace la planilla a mano:
 *   DEBE  = caja chica al abrir + todo lo que se cobró
 *   HABER = posnet + transferencias + otros medios + gastos + lo que bajó a la caja fuerte + lo que
 *           queda en la caja chica
 * y las dos tienen que dar igual.
 */
export interface ArqueoDeCaja {
  fecha: string
  sucursal: string
  /** El cambio con el que se abrió el día. */
  apertura: number
  /** false cuando la apertura no se cargó y se arrastró del último cierre contado. */
  aperturaCargada: boolean
  /** De qué día se arrastró la apertura; null si se cargó a mano o si no había ningún cierre antes. */
  aperturaHeredadaDe: string | null
  /** Todo lo cobrado en el día (lo que en la planilla va en la columna DEBE, sin la apertura). */
  cobrado: number
  efectivo: number
  posnet: number
  transferencia: number
  /** Lo cobrado por medios que no son ni efectivo, ni posnet, ni transferencia (cuponera, local…). */
  otros: number
  gastos: number
  aLaCajaFuerte: number
  /** Lo que tendría que haber en el cajón: apertura + efectivo − gastos − lo que bajó a la caja fuerte. */
  esperado: number
  /** Lo que se contó al cerrar; null mientras el día no se cerró. */
  contado: number | null
  /** contado − esperado; null mientras el día no se cerró. Positivo sobra, negativo falta. */
  diferencia: number | null
  cerradoEn: string | null
  cerradoPor: string | null
  debe: number
  haber: number
  /**
   * debe − haber, que es el control que hace la planilla comparando sus dos totales. Mientras el día
   * está abierto da cero siempre (los dos lados salen de las mismas cuentas); cuando el día se cierra
   * es lo mismo que `diferencia` mirado del otro lado, porque lo contado es lo único que entra en la
   * cuenta sin salir de ella.
   */
  descuadre: number
  movimientos: MovimientoDeCaja[]
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
  /**
   * Sucursales filtradas, ya plegadas contra las que existen; lista vacía = todas.
   *
   * Es un filtro de pantalla y no un recorte por rol: la rendición del mes la ven entera los tres
   * roles (ver `imputados` en servicios/cobranzas.ts). El que sí se recorta por rol es el de la caja
   * del día, que es otra cosa: ahí se muestra plata.
   */
  sucursalesElegidas: string[]
  /** Todas las sucursales que se pueden elegir: las cuatro del catálogo más las que traen los pagos. */
  sucursales: string[]
  periodos: string[]
  /** Todas las compañías que aparecen en el mes: son las opciones del desplegable. */
  companias: string[]
  pagos: PagoRegistrado[]
  /** Cuántos pagos hay de cada resultado (la clave '' son los pendientes). */
  contadores: Record<ResultadoImputacion, number>
  total: number
  /**
   * El bruto cobrado del mes, o null para quien no ve los números de la agencia (ver
   * `veLosNumerosDeLaAgencia` en permisos.ts). Desde que la rendición se ve entera, este total es el de
   * las cuatro sucursales juntas: es lo agregado, y es justo lo que la agencia pidió no mostrarle a un
   * empleado. Cada fila sí trae su importe, que es el trabajo del día.
   */
  totalImporte: number | null
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

  /** Mismo campo y mismo motivo que en `TableroMetricas`: presente sólo cuando `contadores`/`total`/
   *  `totalImporte`/`pendientes`/`sinCobrar` de arriba vinieron del cálculo del servidor (la lista de
   *  `pagos` en sí sigue siendo siempre local, cache o no — ver metricasDesdeCache.ts). */
  calculadoEn?: string
  recibidoEnEstaComputadora?: string
  frescura?: FrescuraDeMetrica
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

  /** Mismo campo y mismo motivo que en `TableroMetricas`. */
  calculadoEn?: string
  recibidoEnEstaComputadora?: string
  frescura?: FrescuraDeMetrica
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
 * El encabezado del ticket, uno por sucursal: el comprobante lo firma la sucursal donde se cobró, con
 * su dirección y su teléfono. Se cargan en Administración → Impresora y admiten sucursales nuevas.
 */
export interface DireccionDeSucursal {
  sucursal: string
  direccion: string
  /** Teléfono del local, debajo de la dirección. Vacío deja la línea con sólo la provincia. */
  telefono: string
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
  /** Quién lleva el caso por lo legal, si hay alguien. Texto libre: estudio, nombre y teléfono. */
  abogado: string | null
  /** El otro auto: la compañía, el teléfono y la patente con los que se sigue el reclamo. */
  terceroCompania: string | null
  terceroTelefono: string | null
  terceroPatente: string | null
  /** '' mientras no se sepa, 'NO' o 'SI'. Un SI es lo que obliga a pedir la constancia médica. */
  terceroLesionados: RespuestaDeLesionados
  /** Quién se lesionó y a qué hospital fue. */
  terceroLesionadosDetalle: string | null
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
  /** Qué es el documento. null en los que se adjuntaron antes de que existieran las categorías. */
  categoria: CategoriaDeAdjunto | null
  /** El «indicando cuál» de «Otras documentaciones». */
  categoriaDetalle: string | null
  /** true si además se subió a la carpeta «Adjuntos DM» del Drive. */
  enDrive: boolean
  /** Por qué no se pudo subir a Drive, si es el caso. El archivo local está guardado igual. */
  errorDeDrive: string | null
  /** Lo que comparten todos los adjuntos desde la 12.6: si está en el servidor, si está en esta PC, la miniatura. */
  tipo: string
  enElServidor: boolean
  errorDelServidor: string | null
  /** false cuando lo cargó otra computadora y esta todavía no lo bajó (se baja al abrirlo). */
  descargado: boolean
  /** Lo cargó otra computadora y todavía no se sabe si terminó de subirlo (12.7). */
  enOtraComputadora: boolean
  miniatura: string | null
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
  tipo: string
  enElServidor: boolean
  errorDelServidor: string | null
  descargado: boolean
  /** Lo cargó otra computadora y todavía no se sabe si terminó de subirlo (12.7). */
  enOtraComputadora: boolean
  miniatura: string | null
}

/**
 * Un adjunto de una póliza (12.6): las fotos del auto o la moto, el frente de la póliza, la cédula.
 * Mismo modelo que los de siniestros y tareas, sin categoría: en una póliza el nombre alcanza.
 */
export interface AdjuntoDePoliza {
  id: number
  nombre: string
  tipo: string
  tamano: number
  creadoEn: string
  usuarioNombre: string
  enDrive: boolean
  errorDeDrive: string | null
  enElServidor: boolean
  errorDelServidor: string | null
  descargado: boolean
  /** Lo cargó otra computadora y todavía no se sabe si terminó de subirlo (12.7). */
  enOtraComputadora: boolean
  miniatura: string | null
  ancho: number | null
  alto: number | null
}

/**
 * Un archivo que la pantalla manda para adjuntar: los bytes vienen de la ventana (arrastrar, pegar o
 * elegir), no de una ruta del disco, porque la pantalla ya achicó la foto antes de mandarla.
 */
export interface ArchivoParaAdjuntar {
  nombre: string
  tipo: string
  contenido: Uint8Array
  ancho?: number | null
  alto?: number | null
  /** true si la pantalla lo recomprimió (una foto de 6 MB que llegó en 800 KB). */
  optimizado?: boolean
}

export interface FilaTarea {
  id: number
  /**
   * El `_ID` de la fila en la hoja (14.0), como en `FilaCliente`: el nombre que esta tarea tiene en
   * las cinco computadoras, para la presencia y el glow. Null mientras la tarea no subió.
   */
  filaId: string | null
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
  /** null cuando no hay mes anterior cargado: sin él las altas no se pueden deducir (no es un cero). */
  altas: number | null
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

  /** null si no hay mes anterior cargado (ver `hayMesAnterior`): la pantalla muestra un guion, no un cero. */
  altas: number | null
  bajas: number
  bajasPorMotivo: BajaPorMotivo[]
  /** false si no hay mes anterior cargado: sin él las altas no se pueden deducir y van en null. */
  hayMesAnterior: boolean

  evolucion: MesDeEvolucion[]
  cobranza: CobranzaDelMes

  siniestrosAbiertos: number
  siniestrosPorCompania: PorcionMetrica[]

  hoy: string

  /** Cuándo el SERVIDOR calculó este tablero, y cuándo esta computadora lo recibió: `undefined`
   *  mientras el tablero salga del cálculo local de siempre (ver `tableroDeMetricasLocal` en
   *  metricas.ts), que no tiene un "servidor" del que hablar. Mismo campo que `PodioMensual`. */
  calculadoEn?: string
  recibidoEnEstaComputadora?: string
  frescura?: FrescuraDeMetrica
}

/** Una fila de la versión tabular (Cartera → Estadísticas), sea de compañía o de sucursal. */
export interface FilaEstadistica {
  etiqueta: string
  activos: number
  /** null cuando no hay mes anterior cargado: la columna muestra un guion. */
  altas: number | null
  bajas: number
  /** Cuántos pagos entraron en el mes. La cantidad la ve todo el mundo. */
  pagos: number
  /** Cuánto suman. null cuando quien mira no ve los números de la agencia. */
  cobrado: number | null
}

/**
 * El resumen de TODA la cartera (no de un mes): activas, fuera de vigencia y dadas de baja, cada
 * póliza contada una sola vez. Ver `categoriaDeCartera` en shared/polizas.ts para la regla exacta.
 */
export interface ResumenDeCartera {
  activas: number
  fueraDeVigencia: number
  dadasDeBaja: number
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
  /** El estado de la cartera completa, sin filtrar por mes ni sucursal. */
  resumenCartera: ResumenDeCartera
  hoy: string

  /** Mismo campo y mismo motivo que en `TableroMetricas`: `undefined` mientras salga del cálculo local. */
  calculadoEn?: string
  recibidoEnEstaComputadora?: string
  frescura?: FrescuraDeMetrica
}

/** Una de las pólizas que el mes cuenta como alta, con lo justo para reconocerla en la planilla. */
export interface FilaDeAlta {
  cliente: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  sucursal: string | null
}

/**
 * El detalle de las altas de un mes: qué pólizas son, una por una. Existe para poder CONTROLAR el
 * número en vez de creerle —«Dock Sud, 128 altas» no se puede discutir; una lista de 128 nombres sí—,
 * y sale de las mismas filas que cuenta el podio, así que si el detalle no cierra con la tarjeta es
 * que el número está mal y no al revés.
 */
export interface DetalleDeAltas {
  periodo: string
  /** La sucursal pedida tal cual se pidió, o null si son las de toda la agencia. */
  sucursal: string | null
  /** false si no hay mes anterior cargado: sin él no hay altas que deducir y la lista va vacía. */
  hayMesAnterior: boolean
  filas: FilaDeAlta[]
}

/**
 * ¿Qué tan al día está lo que esta computadora está mostrando de una métrica calculada en el servidor?
 *
 *  - AL_DIA: lo último que se ve es lo último que el servidor calculó y esta computadora ya lo recibió.
 *  - DESCONECTADA: esta computadora no tiene ahora mismo conexión con el servidor (ver
 *    `EstadoConexion` en sincronizacion/motor.ts), así que lo que se ve es el último snapshot que
 *    llegó a tiempo, no necesariamente lo más nuevo.
 *  - SIN_DATOS: todavía no llegó ningún snapshot de esta métrica a esta computadora.
 */
export type FrescuraDeMetrica = 'AL_DIA' | 'DESCONECTADA' | 'SIN_DATOS'

/**
 * El podio mensual de sucursales: quién metió más altas este mes, para que se corran una carrera. Lo
 * ve cualquiera que entre a la aplicación, no sólo quien tiene el módulo Métricas —es competencia, no
 * un número de la agencia—, así que nunca trae `cobrado`: cada fila sale con ese campo en null.
 *
 * DE DÓNDE SALE (13.2). Hasta la 13.1 cada computadora calculaba el podio con su propia base SQLite, y
 * `calculadoEn`/`datosBajadosEn` decían de cuándo eran ESOS números: si dos sucursales veían podios
 * distintos en el mismo instante, no era un error, era que una había bajado la hoja hace un rato y la
 * otra recién. Eso quedaba bien pero no resolvía la pregunta de fondo —¿cuál de las dos tiene razón
 * AHORA MISMO?—, así que la cuenta se mudó al servidor: la hace una sola vez, para toda la agencia, y
 * la manda por el mismo aviso en vivo que ya trae los cambios de la grilla (ver
 * main/vivo/grilla.ts). `calculadoEn` pasa a significar cuándo lo calculó el SERVIDOR, y
 * `recibidoEnEstaComputadora` reemplaza a `datosBajadosEn`: ya no es «de qué bajada de la hoja salen
 * estos números», es «cuándo le llegó a esta computadora el resultado ya hecho». `frescura` es lo que
 * queda para el caso en que dos computadoras SIGAN mostrando números distintos: una de las dos no tiene
 * conexión con el servidor ahora mismo y está mostrando el último podio que le llegó.
 */
export interface PodioMensual {
  periodo: string
  /** El mes contra el que se comparó: las altas son lo que está en `periodo` y no estaba acá. */
  periodoAnterior: string
  /** false si no hay mes anterior cargado: sin él las altas no se pueden deducir y el podio no tiene sentido. */
  hayMesAnterior: boolean
  /** Una fila por sucursal (la etiqueta es el nombre de la sucursal), ya ordenadas por altas de mayor a
   *  menor y, a igualdad, por activos; sin la fila «(sin sucursal)», que no compite. */
  ranking: FilaEstadistica[]
  hoy: string
  /** Cuándo el SERVIDOR hizo esta cuenta (ISO con hora): no cuándo esta computadora la recibió. */
  calculadoEn: string
  /** Cuándo esta computadora recibió este resultado del servidor (ISO con hora). */
  recibidoEnEstaComputadora: string
  frescura: FrescuraDeMetrica
}

// ---------------------------------------------------------------------------
// 12.6 · Duplicados: lo que la sincronización dejó repetido, a la vista y con botón
// ---------------------------------------------------------------------------

/** Una ficha de cliente dentro de un grupo de repetidas, con lo que cuelga de ella para elegir cuál queda. */
export interface ClienteRepetido {
  id: number
  nombre: string
  documento: string | null
  sucursal: string | null
  telefono: string | null
  email: string | null
  /** Lo que arrastra: para ver de un vistazo cuál es la ficha «de verdad». */
  polizas: number
  polizasActivas: number
  cuotas: number
  pagos: number
  siniestros: number
  tareas: number
  creadoEn: string
  /** La ficha que el programa sugiere conservar (la que tiene la clave del DNI, o la que más tiene). */
  sugerida: boolean
}

export type MotivoDeClienteRepetido = 'dni' | 'nombre' | 'nombre+patente' | 'cuit-dni'

export const NOMBRE_MOTIVO_REPETIDO: Record<MotivoDeClienteRepetido, string> = {
  dni: 'Mismo DNI/CUIT',
  nombre: 'Mismo nombre y sin documento',
  'nombre+patente': 'Mismo nombre y misma patente',
  'cuit-dni': 'Un CUIT que contiene el DNI de otra ficha (puede ser la empresa y su dueño)',
}

export interface GrupoDeClientesRepetidos {
  motivo: MotivoDeClienteRepetido
  clientes: ClienteRepetido[]
}

/** Un renglón de la planilla dentro de un grupo de repetidos de la misma póliza y el mismo mes. */
export interface CuotaRepetida {
  cuotaId: number
  filaId: string
  pestana: string
  numeroFila: number
  cuota: string | null
  pago: string | null
  sucursal: string | null
  /** De esta fila cuelga un cobro, una baja o un aviso: ésa no se sugiere sacar. */
  atada: boolean
  /** La que el programa dejaría (la misma regla que la reparación automática). */
  sugeridaParaQuedar: boolean
}

export interface GrupoDeCuotasRepetidas {
  periodo: string
  polizaId: number
  clienteNombre: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  cuotas: CuotaRepetida[]
}

export interface BajaRepetida {
  bajaId: number
  filaId: string
  motivo: string | null
  fecha: string | null
  hechaEnLaApp: boolean
  sugeridaParaQuedar: boolean
}

export interface GrupoDeBajasRepetidas {
  periodo: string
  polizaId: number
  clienteNombre: string | null
  compania: string | null
  numeroPoliza: string | null
  bajas: BajaRepetida[]
}

/**
 * Una de las pólizas de un grupo que asegura el mismo auto, con lo que cuelga de ella para poder
 * elegir cuál conviene conservar.
 */
export interface PolizaRepetida {
  id: number
  numero: string | null
  /** El número de propuesta, si lo tiene: a veces lo que se cargó como póliza es en realidad éste. */
  propuesta: string | null
  cobertura: string | null
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  sucursal: string | null
  /** Lo que arrastra: para ver de un vistazo cuál es la póliza «de verdad». */
  cuotas: number
  pagos: number
  siniestros: number
  adjuntos: number
  creadoEn: string
  /**
   * La que el programa sugiere conservar: la que tiene número propio, después la que más arrastra,
   * después la del número más completo y, a igualdad de todo, la de clave más chica.
   */
  sugerida: boolean
}

/**
 * El mismo auto, en la misma compañía y a nombre del mismo cliente, asegurado por DOS pólizas que en
 * algún mes tienen las dos su renglón vivo en la planilla. Es la misma póliza cargada con el número
 * escrito de dos formas («40-02-357878» y «357878»): como el número es lo que la identifica, el
 * programa las tomó por dos y la agencia ve al cliente dos veces.
 */
export interface GrupoDePolizasDelMismoRiesgo {
  clienteId: number
  clienteNombre: string | null
  compania: string | null
  patente: string | null
  /** Los meses en los que las dos tienen renglón vivo a la vez: es lo que se ve doble en la planilla. */
  periodosEnConflicto: string[]
  polizas: PolizaRepetida[]
}

/** Una póliza que en el mismo mes está en la planilla Y en Bajas: quedó a medio camino de una baja (o de una reactivación). */
export interface PolizaEnLosDosLados {
  periodo: string
  polizaId: number
  clienteNombre: string | null
  compania: string | null
  numeroPoliza: string | null
  cuota: { cuotaId: number; filaId: string; pestana: string; pago: string | null }
  baja: { bajaId: number; filaId: string; motivo: string | null; fecha: string | null; hechaEnLaApp: boolean }
}

export interface InformeDeDuplicados {
  clientes: GrupoDeClientesRepetidos[]
  polizasDelMismoRiesgo: GrupoDePolizasDelMismoRiesgo[]
  cuotas: GrupoDeCuotasRepetidas[]
  bajas: GrupoDeBajasRepetidas[]
  enLosDosLados: PolizaEnLosDosLados[]
  /** Cuántas cosas hay para mirar, para el contador de la pestaña. */
  total: number
  /** Cuándo se revisó. */
  revisadoEn: string
}

export interface ResultadoDeFusion {
  sobrevivienteId: number
  eliminadoId: number
  nombre: string
  /** Qué se movió a la ficha que queda, contado. */
  movido: Array<{ que: string; cuantos: number }>
}

export interface ResultadoDeFusionDePolizas {
  sobrevivienteId: number
  eliminadaId: number
  /** Cómo nombrarla en el cartel: cliente · compañía · número. */
  titulo: string
  /** Qué se movió a la póliza que queda, contado. */
  movido: Array<{ que: string; cuantos: number }>
  /** Cuántos renglones de la planilla quedaron ahora colgando de la misma póliza (el paso que sigue). */
  renglonesQueQuedanJuntos: number
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
 * Mercado Pago; DNRPA es la Tabla de Valuación de Automotores y Motovehículos que publica gratis el
 * organismo, y es el único de los tres que cubre motos sin costo. Se elige uno: los ids de marca y
 * modelo de cada uno no tienen nada que ver entre sí, así que mezclarlos rompería las pólizas ya
 * cargadas con el código del otro.
 */
export const PROVEEDORES_DE_CATALOGO = ['INFOAUTO', 'MERCADO_LIBRE', 'DNRPA'] as const
export type ProveedorDeCatalogo = (typeof PROVEEDORES_DE_CATALOGO)[number]

export const NOMBRE_PROVEEDOR_CATALOGO: Record<ProveedorDeCatalogo, string> = {
  INFOAUTO: 'InfoAuto',
  MERCADO_LIBRE: 'Mercado Libre',
  DNRPA: 'DNRPA',
}

/**
 * Cómo se llama cada credencial según el proveedor. Es lo mismo por dentro —un identificador y un
 * secreto— pero en el panel de cada uno se llama distinto, y la pantalla tiene que decir el nombre
 * que la persona está viendo del otro lado. DNRPA no tiene ninguno de los dos: la tabla es pública y
 * no hace falta iniciar sesión en ningún lado.
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
  DNRPA: {
    usuario: '',
    clave: '',
    ayuda:
      'La DNRPA publica gratis la Tabla de Valuación de Automotores y Motovehículos. No hace falta usuario ni clave: el programa detecta sola la tabla vigente.',
  },
}

/**
 * Cómo quedó la sincronización de las credenciales con el VPS.
 *
 * El superadministrador las carga una sola vez y viajan al servidor; el resto de las computadoras las
 * adopta al arrancar. `alDia` compara huellas: sirve para decir «esta PC tiene lo mismo que el
 * servidor» sin volver a bajar el secreto.
 */
// ---------------------------------------------------------------------------
// Reportar un error (Inicio → «Reportar error»)
// ---------------------------------------------------------------------------

/** Una captura elegida o pegada, tal como la muestra el cuadro antes de mandarla. */
export interface ImagenDeReporte {
  /** Dónde está el archivo en esta computadora. Es lo que se manda de vuelta al enviar. */
  ruta: string
  nombre: string
  tipo: string
  tamano: number
  /** Miniatura en `data:` para dibujarla en el cuadro. Vacía si no se pudo generar. */
  vistaPrevia: string
}

/** Un reporte de error o una sugerencia de mejora (12.6): el mismo cuadro, el mismo camino, otra etiqueta en GitHub. */
export type TipoDeReporte = 'error' | 'mejora'

export interface ReporteDeError {
  titulo: string
  cuerpo: string
  /** Las capturas elegidas, por ruta. Vacío o ausente = un reporte sin imágenes, que es lo normal. */
  rutasDeImagenes?: string[]
  /** Ausente = 'error', que es lo que mandaban las versiones anteriores. */
  tipo?: TipoDeReporte
}

/** El issue que quedó creado. La URL es la que se le ofrece abrir a quien reportó. */
export interface ReporteCreado {
  numero: number
  url: string
  imagenesSubidas: number
}

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
  /** Sólo DNRPA: la URL puesta a mano, si se pisó la detección automática. No es un secreto. */
  urlFuente: string | null
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
  /** Sólo DNRPA, y opcional: pisa la URL del PDF que el programa detecta solo. Es el escape manual
   * para cuando la DNRPA cambia la página y la detección deja de encontrar la tabla vigente. */
  urlFuente?: string
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
  /** Cómo está la app en el servidor: si el resto de las computadoras tiene la misma. */
  compartido?: EstadoDeAjusteCompartido | null
}

export interface DatosDeMeta {
  appId: string
  appSecret: string
  /** Vacía deja la de fábrica. Tiene que ser la MISMA que está registrada en el panel de Meta. */
  urlDeRedireccion?: string
}

/** Una Página para elegir, cuando la persona administra más de una. */
export interface PaginaParaElegir {
  id: string
  nombre: string
  /** El usuario de Instagram vinculado a esa Página, o null si no tiene. */
  instagramUsuario: string | null
}

/**
 * La cuenta vinculada a una sucursal, tal como la ve la pantalla. Sin tokens: el token de la Página
 * vive cifrado en el servidor y esta computadora nunca lo recibe.
 */
export interface VinculoConMeta {
  sucursal: string
  paginaId: string
  paginaNombre: string
  instagramId: string | null
  instagramUsuario: string | null
  estado: 'ACTIVA' | 'DESVINCULADA' | 'TOKEN_RECHAZADO'
  puedePublicarEnInstagram: boolean
  vinculadoPor: string
  vinculadoEn: string
}

/** Lo que devuelve «Vincular cuenta»: las Páginas encontradas para esa sucursal, para elegir una. */
export interface VinculacionPendiente {
  sucursal: string
  paginas: PaginaParaElegir[]
  /**
   * Cuando hay una sola Página se elige sola y esto viene con el vínculo ya hecho: preguntar «cuál de
   * esta única opción» es una pregunta que no es una pregunta.
   */
  vinculada: VinculoConMeta | null
}

/** Feed (foto o video en el muro), Reel (siempre video) o Historia (foto o video, 24 horas). */
export type TipoDeContenido = 'FEED' | 'REEL' | 'STORIA'

export interface PublicacionDeRed {
  id: string
  sucursal: string
  destino: DestinoDePublicacion
  tipoDeContenido: TipoDeContenido
  estado: 'BORRADOR' | 'PROGRAMADA' | 'PUBLICADA' | 'FALLIDA'
  texto: string
  /** La dirección de la publicación, para abrirla. null si falló, todavía no se publicó, o es una historia. */
  url: string | null
  /** El motivo, cuando falló. Se guarda porque si no se pierde apenas se cierra la pantalla. */
  error: string | null
  creadoPor: string
  /** Cuándo tiene que salir sola. null = no está programada (ya se publicó, o falló). */
  programadoPara: string | null
  /** Cuándo se publicó de verdad. null si falló o todavía no se publicó (ver `creadoEn`). */
  publicadoEn: string | null
  creadoEn: string
}

/** Un archivo elegido para publicar, ya revisado por el proceso principal. */
export interface ArchivoParaPublicar {
  ruta: string
  nombre: string
  tipo: string
  bytes: number
  tipoDeArchivo: 'FOTO' | 'VIDEO'
  /** La imagen en data: URI para la vista previa. Para un video, vacío: no hay miniatura. */
  vistaPrevia: string
  /** Qué le impide ir a Instagram, si algo. Vacío = se puede. */
  avisoDeInstagram: string
}

/** Todo lo que necesita la pestaña Marketing → Redes para dibujarse. */
export interface PanelDeRedes {
  /** false = falta cargar el App ID y el App Secret en Administración. */
  appConfigurada: boolean
  /** true si este actor puede vincular/desvincular cuentas: sólo SUPER_ADMIN. */
  puedeVincular: boolean
  /** Una fila por sucursal: todas para SUPER_ADMIN, sólo la propia (si la tiene) para el resto. */
  cuentas: VinculoConMeta[]
  /** La sucursal de este actor. null para un SUPER_ADMIN sin sucursal propia (publica donde elija). */
  sucursalPropia: string | null
  /** El último error de Meta, si algún vínculo se cayó. */
  ultimoError: string | null
}

export interface PedidoDePublicacion {
  /** Para qué sucursal es. Vacío = la propia del actor (obligatorio elegir si es SUPER_ADMIN sin sucursal). */
  sucursal: string
  destino: DestinoDePublicacion
  tipoDeContenido: TipoDeContenido
  texto: string
  /** Ruta del archivo elegido. Vacío = sólo texto (que Instagram no acepta, y que ni Reel ni Historia aceptan). */
  ruta: string
  /** Fecha/hora (ISO) a la que tiene que salir sola. Vacío = publicar ya. Una historia no se puede programar. */
  programarPara: string
}

/** Una respuesta ya mandada a un comentario. */
export interface RespuestaDeComentario {
  id: string
  mensaje: string
  respondidoPor: string
  respondidoEn: string
}

/**
 * Un comentario de una publicación, tal como lo juntó el webhook de Meta. Las tres banderas `puede*`
 * son optimistas al llegar (true) y se corrigen solas la primera vez que la acción se prueba y Meta la
 * rechaza — ahí es donde aparece `motivoSiNoPuede`, y es el texto que va en el aviso amarillo.
 */
export interface ComentarioDeRed {
  id: string
  sucursal: string
  plataforma: DestinoDePublicacion
  autorNombre: string
  mensaje: string
  creadoEnMeta: string
  estado: 'VISIBLE' | 'OCULTO' | 'ELIMINADO'
  respondido: boolean
  puedeResponder: boolean
  puedeOcultar: boolean
  puedeEliminar: boolean
  motivoSiNoPuede: string | null
  respuestas: RespuestaDeComentario[]
}

/**
 * Una conversación de mensajes privados (Messenger o Instagram). `puedeResponder` ya viene resuelto
 * por el servidor: junta la ventana de 24 horas (no se puede mandar un mensaje libre si pasaron más
 * de 24 horas desde el último mensaje que mandó la persona) con las veces que Meta ya rechazó
 * responder acá antes.
 */
export interface ConversacionDeRed {
  id: string
  sucursal: string
  plataforma: DestinoDePublicacion
  participanteNombre: string
  ultimoMensajeEn: string
  puedeResponder: boolean
  motivoSiNoPuedeResponder: string | null
}

export interface MensajeDeRed {
  id: string
  direccion: 'ENTRANTE' | 'SALIENTE'
  mensaje: string
  creadoEnMeta: string
  enviadoPor: string | null
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

// ---------------------------------------------------------------------------
// Módulo Compañías: las listas de consulta del mostrador
// ---------------------------------------------------------------------------
//
// Cinco listas que no describen a ningún cliente: describen lo que ofrece el mercado. Son las que se
// miran mientras alguien espera del otro lado del teléfono, y por eso viven juntas y en su propio
// módulo en lugar de repartidas entre Presupuestos y Cartera.
//
// Cuatro se cargan a mano (organizadores, precios, grúas y cláusulas) y la quinta —Antigüedad— no se
// carga: se calcula sobre la matriz de reglas de cobertura que ya existe en Cartera. Duplicar esa
// matriz habría dado dos verdades sobre lo mismo, y la que avisa al emitir una póliza es aquélla.

/** Uno de los organizadores a los que el bróker le pide precio. */
export interface Organizador {
  id: number
  nombre: string
  /** Las compañías que cotiza, tal cual se escriben («ATM, Río Uruguay»). Vacío si no se aclaró. */
  companias: string | null
  /** El teléfono al que se le manda el mensaje. */
  telefono: string | null
  email: string | null
  /** En qué horario contesta («Lunes a viernes de 9 a 17»). */
  horario: string | null
  observaciones: string | null
  /** En qué orden se le escribe. Lo decide la agencia, no el alfabeto. */
  orden: number
  activo: boolean
  /** El enlace de WhatsApp ya armado, o null si el teléfono no sirve para armarlo. */
  whatsapp: string | null
}

export interface DatosDeOrganizador {
  nombre: string
  companias: string
  telefono: string
  email: string
  horario: string
  observaciones: string
  activo: boolean
}

/** El precio de lista de una compañía para una cobertura. */
export interface PrecioDeCompania {
  id: number
  compania: string
  cobertura: string
  /** A qué se le cotiza ese precio: AUTO, MOTO, PICK UP… Vacío = vale para cualquiera. */
  rama: string | null
  precio: number
  /** Desde qué día rige esa lista ('AAAA-MM-DD'), o null si no se aclaró. */
  vigenteDesde: string | null
  observaciones: string | null
}

export interface DatosDePrecio {
  compania: string
  cobertura: string
  rama: string
  /** Llega como texto porque viene de un campo del formulario. */
  precio: string
  vigenteDesde: string
  observaciones: string
}

/** Cuántos kilómetros de grúa da una compañía en una cobertura. */
export interface GruaDeCompania {
  id: number
  compania: string
  cobertura: string
  /** null es ILIMITADA, no «sin cargar»: lo que no está cargado no tiene fila. */
  kilometros: number | null
  /** Qué más entra además del remolque: cambio de rueda, batería, cerrajería. */
  auxilio: string | null
  observaciones: string | null
}

export interface DatosDeGrua {
  compania: string
  cobertura: string
  /** Vacío = ilimitada. Llega como texto porque viene de un campo del formulario. */
  kilometros: string
  auxilio: string
  observaciones: string
}

/** Una cláusula de una cobertura: lo que ampara, o lo que deja afuera. */
export interface ClausulaDeCobertura {
  id: number
  /** null = la cláusula vale para todas las compañías. */
  compania: string | null
  cobertura: string
  clausula: string
  /** false es una EXCLUSIÓN: en el mostrador la pregunta que llega incluye lo que no cubre. */
  ampara: boolean
  detalle: string | null
  orden: number
}

export interface DatosDeClausula {
  compania: string
  cobertura: string
  clausula: string
  ampara: boolean
  detalle: string
}

/** Lo que una compañía le ofrece a un vehículo de un año concreto, según la matriz de reglas. */
export interface CoberturaSegunAntiguedad {
  cobertura: string
  /** true si ese modelo entra: la regla no pone límite o el año llega. */
  entra: boolean
  /** El modelo más viejo que acepta, o null si esa cobertura no tiene límite cargado. */
  anioMinimo: number | null
  /** El límite en el idioma del mostrador («desde el modelo 2011»). */
  limite: string
  franquicia: string | null
  observaciones: string | null
}

export interface CompaniaSegunAntiguedad {
  compania: string
  acepta: CoberturaSegunAntiguedad[]
  rechaza: CoberturaSegunAntiguedad[]
}

/** La consulta de antigüedad: se pide un año y se devuelve compañía por compañía. */
export interface ConsultaDeAntiguedad {
  /** El año que se consultó, ya interpretado. null si todavía no se pidió ninguno. */
  anio: number | null
  anioActual: number
  /** Cuántos años tiene ese modelo. null si no hay año consultado. */
  antiguedad: number | null
  companias: CompaniaSegunAntiguedad[]
  /** Compañías que están en la cartera y no tienen ninguna regla cargada: no se puede responder por ellas. */
  sinReglas: string[]
}

/**
 * Cómo están las listas en el servidor y si esta computadora tiene lo mismo.
 *
 * Las cuatro listas cargadas a mano viajan juntas por el puente de ajustes del VPS —el mismo por el
 * que viajan las credenciales del catálogo de vehículos—, porque en la planilla no hay ninguna
 * pestaña donde escribirlas. La regla es la de ese puente: la última publicación gana.
 */
export interface EstadoDeReferencias {
  /** false = esta computadora no tiene puente con el VPS (desarrollo, o sin configurar). */
  hayServidor: boolean
  enElServidor: boolean
  actualizadoEn: string | null
  actualizadoPor: string | null
  /** true si lo de esta computadora es idéntico a lo del servidor. */
  alDia: boolean
  /** true si acá se cargó algo que todavía no viajó a las demás computadoras. */
  sinPublicar: boolean
  error: string | null
}

/** Todo lo que la pantalla del módulo Compañías necesita para dibujarse de una sola llamada. */
export interface ListasDeCompanias {
  organizadores: Organizador[]
  precios: PrecioDeCompania[]
  gruas: GruaDeCompania[]
  clausulas: ClausulaDeCobertura[]
  /** Las compañías de la cartera, para no tipear el nombre a mano y que no queden dos formas de escribirlo. */
  companias: string[]
  /** Las coberturas que ya se usan en la cartera y en la matriz de reglas. */
  coberturas: string[]
  /** Sólo el SUPER_ADMIN carga estas listas, igual que la matriz de coberturas. */
  puedeEditar: boolean
  anioActual: number
}

// ---------------------------------------------------------------------------
// Mensajería interna (12.8)
// ---------------------------------------------------------------------------
//
// El chat entre los usuarios de la agencia. Los mensajes viven en la base del VPS —no en la grilla
// del GENERAL DE CLIENTES— y esta computadora guarda un espejo local para poder leerlos sin internet
// y para que la cola tenga dónde esperar cuando no hay.
//
// La identidad de la persona que va y viene es SIEMPRE su usuario de ingreso en minúscula
// (`claveDeUsuario` en shared/texto.ts): el id de la tabla `usuarios` es local a cada máquina.

/**
 * En qué anda un mensaje que mandó esta computadora. Las dos confirmaciones que pidió la agencia son
 * las dos últimas.
 *
 *  - `enCola`     lo escribió y todavía no salió de acá (sin internet, o esperando el turno).
 *  - `enviado`    el servidor lo aceptó y lo guardó. Un tilde.
 *  - `entregado`  la computadora del otro lo bajó. Dos tildes.
 *  - `leido`      el otro abrió la conversación con el mensaje a la vista. Dos tildes en color.
 *  - `fallado`    el servidor lo rechazó y no se va a arreglar reintentando.
 *
 * En un grupo el estado es el del que MENOS avanzó: si tres lo leyeron y uno no lo recibió todavía,
 * el mensaje está «enviado». Es lo que hace WhatsApp y es lo que la gente espera: el tilde doble azul
 * significa «lo vieron todos».
 */
export type EstadoDeEnvio = 'enCola' | 'enviado' | 'entregado' | 'leido' | 'fallado'

export interface AcuseDeMensaje {
  /** El usuario de ingreso de la persona, en minúscula. */
  clave: string
  nombre: string
  entregadoEn: string | null
  leidoEn: string | null
}

/** Un archivo colgado de un mensaje, tal como lo dibuja la burbuja. */
export interface AdjuntoDeMensaje {
  id: number
  nombre: string
  tipo: string
  tamano: number
  /** true si el archivo está en el disco de ESTA computadora y se puede abrir sin bajar nada. */
  descargado: boolean
  /** true cuando el servidor ya lo tiene: recién ahí lo pueden abrir las otras computadoras. */
  enElServidor: boolean
  /** Lo cargó otra computadora y todavía no terminó de subirlo: la burbuja lo dice y no miente. */
  enOtraComputadora: boolean
  /** El motivo por el que no subió, si se dio por vencido. */
  error: string | null
  /** `data:image/jpeg;base64,…` de 320 px para las fotos y los videos. Null en lo demás. */
  miniatura: string | null
  ancho: number | null
  alto: number | null
}

/**
 * Qué clase de mensaje es. El ZUMBIDO es el de Messenger: no lleva texto, del otro lado suena fuerte y
 * la ventana se sacude. LLAMADA (14.0) es el renglón que deja una llamada de voz cuando termina
 * («Llamada de voz · 3:12», «Llamada perdida»): lo escribe el servidor y llega por el camino de
 * siempre, así que la conversación cuenta lo que pasó aunque nadie haya escrito una palabra.
 *
 * Son tipos y no textos convenidos para que se distingan de verdad de un mensaje que casualmente diga
 * lo mismo. El CHECK de la tabla acompaña desde la migración 29.
 */
export type TipoDeMensaje = 'NORMAL' | 'ZUMBIDO' | 'LLAMADA'

/**
 * Una reacción de un mensaje, ya agrupada por emoji (14.0): el pulgar de WhatsApp.
 *
 * Viene agrupada y no fila por fila porque es como se dibuja —el emoji con su contador— y porque así
 * la pantalla no tiene que contar nada. `mia` es lo que decide si la pastilla va resaltada y si
 * tocarla saca la reacción en vez de ponerla.
 */
export interface ReaccionDeMensaje {
  emoji: string
  /** Las claves de quienes reaccionaron con este emoji. */
  claves: string[]
  /** Los nombres, en el mismo orden que las claves: es el globito «Ana, Beto». */
  nombres: string[]
  mia: boolean
}

export interface MensajeInterno {
  id: number
  tipo: TipoDeMensaje
  /** El id que comparten las cinco computadoras (UUID v4). El `id` de arriba es de esta base. */
  remotoId: string
  conversacionId: number
  autorClave: string
  autorNombre: string
  /** true si lo escribió quien está mirando: es lo que decide de qué lado va la burbuja. */
  mio: boolean
  /** El texto tal cual se escribió: UTF-16 completo, emojis incluidos. Vacío si se borró. */
  cuerpo: string
  creadoEn: string
  estado: EstadoDeEnvio
  /** Por qué no salió, cuando el estado es `fallado`. */
  error: string | null
  eliminadoEn: string | null
  adjuntos: AdjuntoDeMensaje[]
  /** Quién lo recibió y quién lo leyó. Sólo viene con los mensajes propios. */
  acuses: AcuseDeMensaje[]
  /** Las reacciones, agrupadas por emoji y ordenadas de la más puesta a la menos (14.0). */
  reacciones: ReaccionDeMensaje[]
}

export interface ParticipanteDeConversacion {
  clave: string
  nombre: string
  /** El id local, cuando esta computadora conoce a la persona. Sirve para la foto y para el estado. */
  usuarioId: number | null
  salioEn: string | null
}

export interface ConversacionInterna {
  id: number
  remotoId: string
  tipo: 'DIRECTA' | 'GRUPO'
  /** Cómo se llama en la lista: el nombre del grupo, o el de la otra persona en una directa. */
  titulo: string
  participantes: ParticipanteDeConversacion[]
  /** La última línea que se muestra abajo del título, ya recortada. */
  ultimoTexto: string
  ultimoEn: string | null
  ultimoMio: boolean
  sinLeer: number
}

export interface HiloDeMensajes {
  conversacion: ConversacionInterna
  mensajes: MensajeInterno[]
  /** true si más arriba hay mensajes viejos que todavía no se trajeron. */
  hayMas: boolean
}

/** Con quién se puede hablar: los usuarios activos de la agencia, menos uno mismo. */
export interface ContactoDeMensajeria {
  clave: string
  nombre: string
  usuario: string
  rol: Rol
  sucursal: string | null
}

/** Lo que mira la campana de mensajes de la barra superior. */
export interface AvisosDeMensajes {
  sinLeer: number
  /** Los ids de los mensajes sin leer. `useAvisoNuevo` los compara para sonar una sola vez. */
  ids: number[]
  /** Las conversaciones con algo sin leer, para el desplegable de la campana. */
  conversaciones: ConversacionInterna[]
}

/** Lo que la pantalla manda para adjuntar a un mensaje: bytes de la ventana o rutas del disco. */
export interface ParaMandarUnMensaje {
  conversacionId: number
  cuerpo: string
  archivos?: ArchivoParaAdjuntar[]
  /** Archivos elegidos con el diálogo del sistema: se leen en el main y no viajan por IPC. */
  rutas?: string[]
}

export interface FiltrosDelLogDeMensajes {
  usuario: string | null
  desde: string | null
  hasta: string | null
  texto: string
  pagina: number
}

export interface RenglonDelLogDeMensajes {
  remotoId: string
  conversacion: string
  tipo: 'DIRECTA' | 'GRUPO'
  /**
   * Qué fue: un mensaje o un zumbido. Va aparte del cuerpo porque un zumbido no tiene texto, y sin
   * esto el registro mostraría un renglón vacío —que es peor que no mostrarlo—.
   */
  claseDeMensaje: TipoDeMensaje
  participantes: string
  autorClave: string
  autorNombre: string
  /** El texto original, incluso el de un mensaje borrado: para eso existe el registro. */
  cuerpo: string
  creadoEn: string
  eliminadoEn: string | null
  eliminadoPor: string | null
  adjuntos: string
  /** «Leído por 2 de 3», ya resuelto para la tabla. */
  acuse: string
  /** «👍 2, ❤️ 1», ya resuelto para la tabla (14.0). Vacío si nadie reaccionó. */
  reacciones: string
}

export interface LogDeMensajes {
  renglones: RenglonDelLogDeMensajes[]
  total: number
  pagina: number
  porPagina: number
}

/** Cómo viene la conexión de la mensajería, para el cartelito de la pantalla. */
export interface EstadoDeMensajeria {
  /** true si el puente con el VPS está configurado en esta computadora. */
  configurada: boolean
  /** true si el último intento de hablar con el servidor salió bien. */
  enLinea: boolean
  /** Cuántos mensajes escritos acá están esperando para salir. */
  enCola: number
  ultimoError: string | null
}
