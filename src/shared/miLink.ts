// Mi link: la página pública de cada persona de la agencia (dmartinezseguros.com/p/<dirección>), lo
// que le piden desde ahí (solicitudes de cotización y denuncias de siniestro) y cómo le va (visitas y
// clicks). La página, las solicitudes y las métricas viven en el VPS (`/api/dmg/mi-link`), no en la
// planilla: no tocan la grilla ni los ajustes compartidos, así que la versión normal no se entera.
//
// Este archivo es el contrato. El servidor (repo Seguros_Daniel_Martinez,
// `server/src/modules/milink/milink.contenido.ts`) valida EXACTAMENTE la misma forma; si se agrega un
// campo acá, se agrega allá, y siempre opcional con un valor por defecto, porque una página guardada
// con una versión vieja tiene que seguir abriendo.

/** Las secciones de Mi link, una por renglón de su sublista en la barra lateral. */
export const SECCIONES_DE_MI_LINK = ['pagina', 'solicitudes', 'siniestros', 'metricas'] as const
export type SeccionDeMiLink = (typeof SECCIONES_DE_MI_LINK)[number]

export function esSeccionDeMiLink(valor: unknown): valor is SeccionDeMiLink {
  return typeof valor === 'string' && (SECCIONES_DE_MI_LINK as readonly string[]).includes(valor)
}

/** El dominio donde se publica. La dirección completa es `${URL_BASE_DE_MI_LINK}/p/<direccion>`. */
export const URL_BASE_DE_MI_LINK = 'https://dmartinezseguros.com'
export const PREFIJO_DE_MI_LINK = '/p/'

// ── El contenido de la página ──────────────────────────────────────────────────────────────────────

export const TIPOS_DE_CONTACTO = ['whatsapp', 'telefono', 'email', 'instagram', 'facebook', 'tiktok', 'web', 'direccion'] as const
export type TipoDeContacto = (typeof TIPOS_DE_CONTACTO)[number]

export const NOMBRE_TIPO_DE_CONTACTO: Record<TipoDeContacto, string> = {
  whatsapp: 'WhatsApp',
  telefono: 'Teléfono',
  email: 'Email',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  web: 'Sitio web',
  direccion: 'Dirección',
}

export interface BloqueDeContacto {
  /** Id estable del bloque (lo eligen las pantallas; se usa para contar los clicks). 1..40 caracteres [a-z0-9-]. */
  id: string
  tipo: TipoDeContacto
  /** El número, la cuenta, el mail o la URL, tal como lo escribió la persona. 1..200. */
  valor: string
}

/**
 * Las coberturas que se pueden ofrecer. `auto` y `moto` abren el cotizador (marca, modelo, versión,
 * año del catálogo del VPS); el resto abre un formulario corto (nombre, teléfono, mail y mensaje).
 */
export const TIPOS_DE_COBERTURA = [
  'auto',
  'moto',
  'hogar',
  'vida',
  'accidentes',
  'comercio',
  'bicicleta',
  'celular',
  'art',
  'caucion',
  'otro',
] as const
export type TipoDeCobertura = (typeof TIPOS_DE_COBERTURA)[number]

export const NOMBRE_TIPO_DE_COBERTURA: Record<TipoDeCobertura, string> = {
  auto: 'Seguro de auto',
  moto: 'Seguro de moto',
  hogar: 'Seguro de hogar',
  vida: 'Seguro de vida',
  accidentes: 'Accidentes personales',
  comercio: 'Seguro de comercio',
  bicicleta: 'Seguro de bici',
  celular: 'Seguro de celular',
  art: 'ART',
  caucion: 'Caución',
  otro: 'Otro seguro',
}

/** El ramo con el que se lista una solicitud de esa cobertura (columna «Ramo»). */
export const RAMO_DE_COBERTURA: Record<TipoDeCobertura, string> = {
  auto: 'Automotores',
  moto: 'Motovehículos',
  hogar: 'Combinado familiar',
  vida: 'Vida',
  accidentes: 'Accidentes personales',
  comercio: 'Integral de comercio',
  bicicleta: 'Bicicletas',
  celular: 'Robo de celular',
  art: 'ART',
  caucion: 'Caución',
  otro: 'Otros riesgos',
}

export const DESCRIPCION_POR_DEFECTO_DE_COBERTURA: Record<TipoDeCobertura, string> = {
  auto: 'Cotizá con todas mis compañías y elegí la que más te conviene.',
  moto: 'Cotizá con todas mis compañías y elegí la que más te conviene.',
  hogar: 'Contame de tu casa y te paso el presupuesto.',
  vida: 'Contame qué buscás y te paso el presupuesto.',
  accidentes: 'Contame qué buscás y te paso el presupuesto.',
  comercio: 'Contame de tu comercio y te paso el presupuesto.',
  bicicleta: 'Contame de tu bici y te paso el presupuesto.',
  celular: 'Contame de tu celular y te paso el presupuesto.',
  art: 'Contame de tu empresa y te paso el presupuesto.',
  caucion: 'Contame qué necesitás y te paso el presupuesto.',
  otro: 'Contame qué necesitás asegurar y te paso el presupuesto.',
}

/** Las coberturas que cotizan con el catálogo de vehículos (el resto va por formulario). */
export function coberturaCotizaVehiculo(tipo: TipoDeCobertura): tipo is 'auto' | 'moto' {
  return tipo === 'auto' || tipo === 'moto'
}

export interface BloqueDeCobertura {
  id: string
  tipo: TipoDeCobertura
  /** 1..60. */
  titulo: string
  /** 0..160. */
  descripcion: string
}

export interface BloqueDeLink {
  id: string
  /** 1..60. */
  titulo: string
  /** http(s)://… 1..500. */
  url: string
}

/** Cómo se arma la página: tres estilos (las miniaturas de «Estilo» en el editor). */
export const ESTILOS_DE_PAGINA = ['sello', 'botones', 'marca'] as const
export type EstiloDePagina = (typeof ESTILOS_DE_PAGINA)[number]
export const NOMBRE_ESTILO: Record<EstiloDePagina, string> = { sello: 'Sello', botones: 'Botones', marca: 'Marca' }
export const DESCRIPCION_ESTILO: Record<EstiloDePagina, string> = {
  sello: 'Blanca y con aire. Tu nombre en grande y las coberturas de a dos.',
  botones: 'Todo en una columna, con botones anchos: la clásica página de links.',
  marca: 'Un encabezado con tu color arriba y las coberturas en tarjetas.',
}

/** Lo que va detrás del avatar (las miniaturas de «Detrás del avatar»). */
export const FONDOS_DE_AVATAR = ['nada', 'franja', 'tarjeta', 'iniciales', 'degradado'] as const
export type FondoDeAvatar = (typeof FONDOS_DE_AVATAR)[number]
export const NOMBRE_FONDO: Record<FondoDeAvatar, string> = {
  nada: 'Nada',
  franja: 'Franja',
  tarjeta: 'Tarjeta',
  iniciales: 'Iniciales',
  degradado: 'Degradado',
}

/** Los colores de la fila «Color». El primero es el de la agencia. */
export const COLORES_DE_PAGINA: ReadonlyArray<{ nombre: string; hex: string }> = [
  { nombre: 'Tu organización', hex: '#6d4aff' },
  { nombre: 'Violeta', hex: '#7c4dff' },
  { nombre: 'Azul', hex: '#2563eb' },
  { nombre: 'Turquesa', hex: '#0e7490' },
  { nombre: 'Verde', hex: '#15803d' },
  { nombre: 'Oliva', hex: '#4d7c0f' },
  { nombre: 'Naranja', hex: '#c2410c' },
  { nombre: 'Rojo', hex: '#dc2626' },
  { nombre: 'Rosa', hex: '#db2777' },
  { nombre: 'Bordó', hex: '#9f1239' },
  { nombre: 'Grafito', hex: '#334155' },
]

export interface DisenoDePagina {
  /** #rrggbb. */
  color: string
  estilo: EstiloDePagina
  fondo: FondoDeAvatar
}

export interface ContenidoDeMiLink {
  /** Versión del formato. Hoy 1. */
  v: 1
  /** El nombre grande. 1..80. */
  nombre: string
  /** «Una línea sobre vos». 0..160. */
  bio: string
  /** Si usa la foto de su perfil de DM Gestión (si tiene) o las iniciales. */
  usarFoto: boolean
  contacto: BloqueDeContacto[]
  coberturas: BloqueDeCobertura[]
  /** Si muestra el botón «Denunciar un siniestro» (abre el formulario con adjuntos). */
  siniestros: boolean
  links: BloqueDeLink[]
  diseno: DisenoDePagina
}

export const LIMITES_DE_MI_LINK = {
  nombre: 80,
  bio: 160,
  valorDeContacto: 200,
  tituloDeCobertura: 60,
  descripcionDeCobertura: 160,
  tituloDeLink: 60,
  urlDeLink: 500,
  contactos: 8,
  coberturas: 12,
  links: 12,
} as const

/** La dirección: lo que va después de /p/. 3..40, minúsculas, números y guiones, sin guion en las puntas. */
export const PATRON_DE_DIRECCION = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/
/** Direcciones que no se pueden tomar (rutas del sitio, palabras que confunden). */
export const DIRECCIONES_RESERVADAS: readonly string[] = [
  'admin', 'api', 'app', 'dm', 'dmg', 'gestion', 'login', 'p', 'pagina', 'seguros', 'cotizacion',
  'siniestros', 'contacto', 'nosotros', 'coberturas', 'privacidad', 'cookies', 'soporte', 'ayuda',
  'www', 'mail', 'agencia', 'daniel-martinez-seguros', 'dmartinezseguros',
]

export function esDireccionValida(valor: string): boolean {
  return PATRON_DE_DIRECCION.test(valor) && !valor.includes('--') && !DIRECCIONES_RESERVADAS.includes(valor)
}

/** Una dirección sugerida a partir del nombre: «Daniel Adrián Martínez» → «daniel-adrian-martinez». */
export function direccionSugerida(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return base.length >= 3 ? base : `${base || 'productor'}-dm`.slice(0, 40)
}

/** La página recién creada: nombre, un mail para completar, auto y moto, y el botón de siniestros. */
export function contenidoInicial(nombre: string): ContenidoDeMiLink {
  return {
    v: 1,
    nombre: nombre.trim().slice(0, LIMITES_DE_MI_LINK.nombre) || 'Mi página',
    bio: '',
    usarFoto: true,
    contacto: [],
    coberturas: [
      { id: 'auto', tipo: 'auto', titulo: NOMBRE_TIPO_DE_COBERTURA.auto, descripcion: DESCRIPCION_POR_DEFECTO_DE_COBERTURA.auto },
      { id: 'moto', tipo: 'moto', titulo: NOMBRE_TIPO_DE_COBERTURA.moto, descripcion: DESCRIPCION_POR_DEFECTO_DE_COBERTURA.moto },
    ],
    siniestros: true,
    links: [],
    diseno: { color: COLORES_DE_PAGINA[0]!.hex, estilo: 'sello', fondo: 'iniciales' },
  }
}

// ── Lo que devuelve el VPS ─────────────────────────────────────────────────────────────────────────

export interface MiLink {
  /** La clave del usuario dueño (login en minúscula). */
  usuarioClave: string
  /** Lo que va después de /p/. */
  direccion: string
  publicada: boolean
  contenido: ContenidoDeMiLink
  /** Candado optimista: se manda la que se leyó; si otra PC guardó en el medio, el VPS contesta 409. */
  version: number
  /** ISO. */
  actualizadaEn: string
  /** La URL pública completa. */
  url: string
  /** Si el dueño tiene foto en su perfil (para mostrarla en el editor y en la página si `usarFoto`). */
  tieneFoto: boolean
}

export interface CambiosDeMiLink {
  /** La versión que se leyó (null = todavía no existe, se crea). */
  version: number | null
  direccion: string
  publicada: boolean
  contenido: ContenidoDeMiLink
}

// ── Solicitudes ────────────────────────────────────────────────────────────────────────────────────

export const ESTADOS_DE_SOLICITUD = ['NUEVA', 'CONTACTADA', 'COTIZADA', 'CERRADA', 'DESCARTADA'] as const
export type EstadoDeSolicitud = (typeof ESTADOS_DE_SOLICITUD)[number]
export const NOMBRE_ESTADO_DE_SOLICITUD: Record<EstadoDeSolicitud, string> = {
  NUEVA: 'Nueva',
  CONTACTADA: 'Contactada',
  COTIZADA: 'Cotizado',
  CERRADA: 'Cerrado',
  DESCARTADA: 'Descartada',
}

/** «Link público» = el cotizador de auto/moto; «Formulario del link» = las demás coberturas. */
export type CanalDeSolicitud = 'COTIZADOR' | 'FORMULARIO'
export const NOMBRE_CANAL_DE_SOLICITUD: Record<CanalDeSolicitud, string> = {
  COTIZADOR: 'Link público',
  FORMULARIO: 'Formulario del link',
}

export interface VehiculoDeSolicitud {
  tipo: 'AUTO' | 'MOTO'
  marca: string
  modelo: string
  version: string
  anio: number | null
  /** La clave del catálogo maestro del VPS, si se eligió del catálogo. */
  codigoCatalogo: string
}

export interface SolicitudDeMiLink {
  id: string
  /** Número correlativo para mostrar (columna «Cotización»). */
  numero: number
  usuarioClave: string
  /** El nombre del dueño de la página al momento de la solicitud. */
  usuarioNombre: string
  canal: CanalDeSolicitud
  cobertura: TipoDeCobertura
  /** El título de la tarjeta que tocó. */
  coberturaTitulo: string
  estado: EstadoDeSolicitud
  nombre: string
  telefono: string
  email: string
  codigoPostal: string
  mensaje: string
  vehiculo: VehiculoDeSolicitud | null
  /** Notas internas de la agencia. */
  nota: string
  /** ISO. */
  creadaEn: string
  actualizadaEn: string
}

// ── Siniestros ─────────────────────────────────────────────────────────────────────────────────────

export const TIPOS_DE_SINIESTRO_DEL_LINK = ['choque', 'robo', 'rotura', 'incendio', 'granizo', 'otro'] as const
export type TipoDeSiniestroDelLink = (typeof TIPOS_DE_SINIESTRO_DEL_LINK)[number]
export const NOMBRE_TIPO_DE_SINIESTRO: Record<TipoDeSiniestroDelLink, string> = {
  choque: 'Choque',
  robo: 'Robo',
  rotura: 'Rotura de cristales',
  incendio: 'Incendio',
  granizo: 'Granizo',
  otro: 'Otro',
}

export const ESTADOS_DE_DENUNCIA = ['NUEVA', 'EN CURSO', 'CARGADA', 'CERRADA'] as const
export type EstadoDeDenuncia = (typeof ESTADOS_DE_DENUNCIA)[number]
export const NOMBRE_ESTADO_DE_DENUNCIA: Record<EstadoDeDenuncia, string> = {
  NUEVA: 'Nueva',
  'EN CURSO': 'En curso',
  CARGADA: 'Cargada',
  CERRADA: 'Cerrada',
}

export interface ArchivoDeDenuncia {
  id: string
  nombre: string
  /** MIME: image/png, image/jpeg o application/pdf. */
  tipo: string
  tamano: number
}

export interface DenunciaDeMiLink {
  id: string
  numero: number
  usuarioClave: string
  usuarioNombre: string
  tipo: TipoDeSiniestroDelLink
  estado: EstadoDeDenuncia
  nombre: string
  telefono: string
  email: string
  dni: string
  patente: string
  /** aaaa-mm-dd o ''. */
  fecha: string
  lugar: string
  descripcion: string
  /** ¿Hubo un tercero? */
  hayTercero: boolean
  terceroDatos: string
  hayLesionados: boolean
  archivos: ArchivoDeDenuncia[]
  nota: string
  creadaEn: string
  actualizadaEn: string
}

// ── Filtros de los listados ────────────────────────────────────────────────────────────────────────

export interface FiltrosDeMiLink {
  /** aaaa-mm-dd o ''. */
  desde: string
  hasta: string
  /** '' = todos. */
  estado: string
  /** Texto libre: nombre, teléfono, patente, marca… */
  texto: string
  /**
   * De quién: '' = las propias. Solo ADMIN y SUPER_ADMIN pueden pedir 'todos' o la clave de otro.
   */
  usuario: string
}

export function filtrosVaciosDeMiLink(): FiltrosDeMiLink {
  return { desde: '', hasta: '', estado: '', texto: '', usuario: '' }
}

// ── Métricas ───────────────────────────────────────────────────────────────────────────────────────

export const RANGOS_DE_METRICAS = [7, 30, 90] as const
export type RangoDeMetricas = (typeof RANGOS_DE_METRICAS)[number]

export interface PuntoDeMetricas {
  /** aaaa-mm-dd (hora de Argentina). */
  dia: string
  visitas: number
  clicks: number
}

export interface FilaDeMetricas {
  etiqueta: string
  valor: number
}

export interface MetricasDeMiLink {
  /** aaaa-mm-dd, inclusive. */
  desde: string
  hasta: string
  visitas: number
  /** Visitantes únicos por día (el mismo que vuelve el mismo día cuenta una vez). */
  visitantes: number
  clicks: number
  /** clicks / visitas, 0..∞ (se muestra como porcentaje). */
  clicksPorVisita: number
  porDia: PuntoDeMetricas[]
  /** Clicks por bloque (etiqueta = el título del bloque). */
  bloques: FilaDeMetricas[]
  /** Directo, Google, Instagram, Facebook, WhatsApp, Otros sitios. */
  origenes: FilaDeMetricas[]
  /** Celular, Escritorio, Tablet, Otro. */
  dispositivos: FilaDeMetricas[]
  /** Cuántas solicitudes y denuncias entraron en el período. */
  solicitudes: number
  denuncias: number
}
