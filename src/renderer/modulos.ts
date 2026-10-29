// Módulos de la aplicación, en el orden en que aparecen en la barra lateral.
import type { SeccionDelMulticotizador } from '../shared/multicotizador'
import { esArea, type Area } from '../shared/permisos'
import type { Rol } from '../shared/tipos'
import type { NombreIcono } from './componentes/Icono'

export type IdModulo =
  | 'inicio'
  | 'cartera'
  | 'clientes'
  | 'leads'
  | 'presupuestos'
  | 'multicotizador'
  | 'polizas'
  | 'renovaciones'
  | 'siniestros'
  | 'cobranzas'
  | 'metricas'
  | 'reportes'
  | 'marketing'
  | 'tareas'
  | 'mensajes'
  | 'companias'
  | 'excel'
  | 'apiAseguradoras'
  | 'administracion'

export interface Modulo {
  id: IdModulo
  nombre: string
  icono: NombreIcono
  /** Qué hace el módulo, en una línea. Se muestra en Inicio y en la pantalla «Próximamente». */
  descripcion: string
  /** Si es false, el módulo muestra la pantalla «Próximamente». */
  disponible: boolean
  /**
   * Su sublista en la barra lateral: cada renglón abre el módulo en esa sección (el `seccion` de la
   * navegación). Sin esto, el módulo es un renglón suelto.
   */
  secciones?: SeccionDeModulo[]
}

export interface SeccionDeModulo {
  id: string
  nombre: string
  icono: NombreIcono
  /**
   * El área de permisos de este renglón, cuando no es la del módulo (Cartera: Asegurados se abre con
   * el permiso de Clientes, Vencimientos con el de Renovaciones…). Sin esto el renglón hereda el
   * permiso del módulo. Ver `moduloVisible` y `areaDelDestino`.
   */
  area?: Area
  /**
   * Si es true, el renglón sólo lo ven ADMIN y SUPER_ADMIN (además del permiso de su área). Es el caso
   * de las comisiones de Cobranzas: información de la agencia, no del mostrador. Ver `seccionesVisibles`.
   */
  soloAdmin?: boolean
}

/** La sublista del Multicotizador: cotizar separado por auto y moto, y lo que salió de cotizar. */
export const SECCIONES_MULTICOTIZADOR: Array<SeccionDeModulo & { id: SeccionDelMulticotizador }> = [
  { id: 'auto', nombre: 'Cotizar Vehículo', icono: 'auto' },
  { id: 'moto', nombre: 'Cotizar Moto', icono: 'moto' },
  { id: 'cotizaciones', nombre: 'Cotizaciones', icono: 'lista' },
  { id: 'planes', nombre: 'Planes de Cotización', icono: 'presupuestos' },
  { id: 'emisiones', nombre: 'Emisiones', icono: 'polizas' },
]

export type IdSeccionDeCartera =
  | 'planilla'
  | 'asegurados'
  | 'grupos'
  | 'polizas'
  | 'siniestros'
  | 'vencimientos'
  | 'indiceAumentos'
  | 'rubrica'

/**
 * La sublista de Cartera. «Planilla del mes» es la pantalla de siempre (con sus pestañas internas:
 * Bajas, Rechazos, Galeno…) y va primera; el resto son los listados. Cada renglón se abre con el
 * permiso del área que ya existe para ese dato: no hay áreas nuevas.
 */
export const SECCIONES_CARTERA: Array<SeccionDeModulo & { id: IdSeccionDeCartera; area: Area }> = [
  { id: 'planilla', nombre: 'Planilla del mes', icono: 'tabla', area: 'cartera' },
  { id: 'asegurados', nombre: 'Asegurados', icono: 'usuario', area: 'clientes' },
  { id: 'grupos', nombre: 'Grupos', icono: 'clientes', area: 'clientes' },
  { id: 'polizas', nombre: 'Pólizas', icono: 'polizas', area: 'polizas' },
  { id: 'siniestros', nombre: 'Siniestros', icono: 'siniestros', area: 'siniestros' },
  { id: 'vencimientos', nombre: 'Vencimientos', icono: 'calendario', area: 'renovaciones' },
  { id: 'indiceAumentos', nombre: 'Índice de Aumentos', icono: 'porcentaje', area: 'polizas' },
  { id: 'rubrica', nombre: 'Rúbrica Digital', icono: 'lapiz', area: 'reportes' },
]

/**
 * Qué renglón de Cartera corresponde a la sección pedida. La navegación también usa `seccion` para
 * las pestañas internas de la planilla (`ir('cartera', { seccion: 'reglas' })`, 'rechazos'…): todo lo
 * que no sea un renglón del menú —incluido nulo— es la planilla, que es donde viven esas pestañas.
 */
export function seccionDeCartera(seccion: string | null | undefined): IdSeccionDeCartera {
  return SECCIONES_CARTERA.find((item) => item.id === seccion)?.id ?? 'planilla'
}

export type IdSeccionDeCobranzas = 'panel' | 'vencimientosCuotas' | 'rechazos' | 'comisionesListado'

/**
 * La sublista de Cobranzas. «Panel de cobranzas» es el módulo de siempre (con sus pestañas internas:
 * Caja del día, Mora, Imputados y Comisiones) y va primero; el resto son listados. Todos se abren con el
 * permiso del área Cobranzas: no hay áreas nuevas. «Comisiones» (el listado) usa el id
 * `comisionesListado` para no chocar con la pestaña interna `comisiones` del panel, que sigue
 * funcionando como enlace profundo (`ir('cobranzas', { seccion: 'comisiones' })`).
 */
export const SECCIONES_COBRANZAS: Array<SeccionDeModulo & { id: IdSeccionDeCobranzas; area: Area }> = [
  { id: 'panel', nombre: 'Panel de cobranzas', icono: 'billete', area: 'cobranzas' },
  { id: 'vencimientosCuotas', nombre: 'Vencimientos Cuotas', icono: 'calendario', area: 'cobranzas' },
  { id: 'rechazos', nombre: 'Rechazos', icono: 'alerta', area: 'cobranzas' },
  // Como la pestaña «Comisiones» del panel y el canal cobranzas:comisiones: sólo administradores.
  { id: 'comisionesListado', nombre: 'Comisiones', icono: 'porcentaje', area: 'cobranzas', soloAdmin: true },
]

/**
 * Qué renglón de Cobranzas corresponde a la sección pedida. La navegación también usa `seccion` para
 * las pestañas internas del panel ('caja', 'mora', 'imputados', 'comisiones'): todo lo que no sea un
 * renglón del menú —incluido nulo— es el panel, que es donde viven esas pestañas.
 */
export function seccionDeCobranzas(seccion: string | null | undefined): IdSeccionDeCobranzas {
  return SECCIONES_COBRANZAS.find((item) => item.id === seccion)?.id ?? 'panel'
}

export const MODULOS: Modulo[] = [
  { id: 'inicio', nombre: 'Inicio', icono: 'inicio', descripcion: 'Resumen general y accesos rápidos.', disponible: true },
  {
    id: 'cartera',
    nombre: 'Cartera',
    icono: 'cartera',
    descripcion: 'La planilla mensual (semáforo, avisos y pagos) y los listados de asegurados, pólizas, siniestros y vencimientos.',
    disponible: true,
    secciones: SECCIONES_CARTERA,
  },
  { id: 'clientes', nombre: 'Clientes', icono: 'clientes', descripcion: 'La ficha de cada cliente: datos, vehículos, pólizas, pagos y siniestros.', disponible: true },
  {
    id: 'leads',
    nombre: 'Leads',
    icono: 'leads',
    descripcion: 'Las consultas que todavía no son clientes: quién preguntó, por qué y cómo viene la charla.',
    disponible: true,
  },
  {
    id: 'presupuestos',
    nombre: 'Presupuestos',
    icono: 'presupuestos',
    descripcion: 'Las compañías cotizadas para cada vehículo, el mensaje de WhatsApp y el PDF.',
    disponible: true,
  },
  {
    id: 'multicotizador',
    nombre: 'Multicotizador',
    icono: 'billete',
    descripcion: 'Un auto o una moto cotizados en todas las compañías con API a la vez, comparados por cobertura.',
    disponible: true,
    secciones: SECCIONES_MULTICOTIZADOR,
  },
  {
    id: 'polizas',
    nombre: 'Pólizas',
    icono: 'polizas',
    descripcion: 'El listado por póliza, con vigencias, estado y el alta en una sola pantalla.',
    disponible: true,
  },
  {
    id: 'renovaciones',
    nombre: 'Renovaciones',
    icono: 'renovaciones',
    descripcion: 'Las pólizas que vencen en los próximos 60 días, por semana y con responsable.',
    disponible: true,
  },
  {
    id: 'siniestros',
    nombre: 'Siniestros',
    icono: 'siniestros',
    descripcion: 'El listado del mes y la ficha de cada siniestro: estado, observaciones, documentos y tareas.',
    disponible: true,
  },
  {
    id: 'cobranzas',
    nombre: 'Cobranzas',
    icono: 'cobranzas',
    descripcion: 'La caja del día por sucursal, la mora, la rendición mensual y las comisiones, más los listados de vencimientos de cuotas, rechazos y comisiones.',
    disponible: true,
    secciones: SECCIONES_COBRANZAS,
  },
  {
    id: 'metricas',
    nombre: 'Métricas',
    icono: 'metricas',
    descripcion: 'Los números de la agencia: activos, altas, bajas, cobranza y siniestros, mes a mes.',
    disponible: true,
  },
  {
    id: 'reportes',
    nombre: 'Reportes',
    icono: 'reportes',
    descripcion: 'El centro de exportación: cualquier listado a Excel o PDF, y la planilla de siempre.',
    disponible: true,
  },
  {
    id: 'marketing',
    nombre: 'Marketing',
    icono: 'marketing',
    descripcion: 'Las plantillas de WhatsApp y los segmentos de la cartera, para avisar de a uno.',
    disponible: true,
  },
  {
    id: 'tareas',
    nombre: 'Tareas',
    icono: 'tareas',
    descripcion: 'Los pendientes del equipo: a quién le toca, para cuándo, con comentarios y documentos.',
    disponible: true,
  },
  {
    id: 'mensajes',
    nombre: 'Mensajes',
    icono: 'mensaje',
    descripcion: 'El chat de la agencia: hablarle a un compañero o a un grupo, con fotos y documentos.',
    disponible: true,
  },
  {
    id: 'companias',
    nombre: 'Compañías',
    icono: 'escudo',
    descripcion: 'Lo que ofrece cada compañía: organizadores, precios, antigüedad, grúas y qué ampara cada cobertura.',
    disponible: true,
  },
  {
    id: 'excel',
    nombre: 'General Excel',
    icono: 'cuadricula',
    descripcion: 'Todas las áreas en un solo lugar y en formato planilla, como se venía trabajando.',
    disponible: true,
  },
]

/** Va separado, al pie de la barra lateral. */
export const MODULO_ADMINISTRACION: Modulo = {
  id: 'administracion',
  nombre: 'Administración',
  icono: 'administracion',
  descripcion: 'Usuarios, la base del GENERAL DE CLIENTES e información de la aplicación.',
  disponible: true,
}

/**
 * También va separado, al pie de la barra lateral, junto a Administración: las credenciales con las
 * que DM Gestión habla con la API de cada aseguradora (hoy, Galeno, ATM, Mercantil Andina y Equidad). No es un área de
 * permisos configurable —igual que el catálogo de vehículos o la propia conexión con Galeno antes de
 * mudarse acá—: son credenciales de un tercero, no algo que necesite el mostrador, así que sólo la ven
 * ADMIN y SUPER_ADMIN (ver `BarraLateral`).
 */
export const MODULO_API_ASEGURADORAS: Modulo = {
  id: 'apiAseguradoras',
  nombre: 'API Aseguradoras',
  icono: 'llave',
  descripcion: 'Las credenciales con las que el programa habla con la API de cada aseguradora.',
  disponible: true,
}

/**
 * Todos los módulos son un área de permisos menos Inicio —la pantalla que queda cuando no se tiene
 * ninguna otra, y por eso no se puede sacar— y «General Excel», que no tiene permiso propio a
 * propósito: no muestra datos nuevos, sino los de los módulos que cada uno ya puede ver, y con el
 * permiso de esos módulos. Darle un permiso aparte permitiría dos configuraciones que se contradicen:
 * alguien sin Siniestros que igual ve los siniestros «en Excel».
 */
export function esAreaDePermisos(id: IdModulo): id is IdModulo & Area {
  return esArea(id)
}

/**
 * Las sub-entradas de un módulo que esta persona puede abrir (las que no piden un área propia siempre
 * se ven). `rol` sólo hace falta para los renglones `soloAdmin`: sin rol, esos renglones no se ven.
 */
export function seccionesVisibles(modulo: Modulo, puedeVer: (area: Area) => boolean, rol?: Rol): SeccionDeModulo[] {
  return (modulo.secciones ?? []).filter(
    (item) => (!item.area || puedeVer(item.area)) && (!item.soloAdmin || (rol !== undefined && rol !== 'EMPLEADO')),
  )
}

/**
 * Si el módulo aparece en la barra lateral y en Inicio. Un módulo con sub-entradas que piden su propia
 * área (Cartera, Cobranzas) se ve si alguna de ellas es visible; el resto, con el permiso de su área.
 */
export function moduloVisible(modulo: Modulo, puedeVer: (area: Area) => boolean, rol?: Rol): boolean {
  if (modulo.secciones?.some((item) => item.area)) return seccionesVisibles(modulo, puedeVer, rol).length > 0
  return !esAreaDePermisos(modulo.id) || puedeVer(modulo.id)
}

/**
 * A qué sección mandar a quien abre el módulo «a secas» (el ícono de la barra achicada, el mapa de
 * Inicio): la primera que pueda ver. Sólo importa en los módulos cuyas sub-entradas piden su propia
 * área (Cartera, Cobranzas): quien no tiene la planilla pero sí Clientes tiene que caer en Asegurados y
 * no en un «no tenés permiso». En el resto devuelve undefined y el módulo abre en su sección de siempre.
 */
export function primeraSeccionVisible(modulo: Modulo, puedeVer: (area: Area) => boolean, rol?: Rol): string | undefined {
  if (!modulo.secciones?.some((item) => item.area)) return undefined
  return seccionesVisibles(modulo, puedeVer, rol)[0]?.id
}

/**
 * El área de permisos que exige abrir `id` en `seccion`, o null si no pide ninguna (Inicio,
 * Administración, API Aseguradoras). Para Cartera y Cobranzas depende de la sección: una sección
 * desconocida es la planilla / el panel, que siguen pidiendo el permiso del módulo como siempre.
 */
export function areaDelDestino(id: IdModulo, seccion: string | null | undefined): Area | null {
  if (id === 'cartera') return SECCIONES_CARTERA.find((item) => item.id === seccionDeCartera(seccion))?.area ?? 'cartera'
  if (id === 'cobranzas') return SECCIONES_COBRANZAS.find((item) => item.id === seccionDeCobranzas(seccion))?.area ?? 'cobranzas'
  return esAreaDePermisos(id) && id !== 'administracion' ? id : null
}

/**
 * Si esta persona puede abrir el módulo en esa sección: el permiso del área (`areaDelDestino`) más la
 * restricción de rol de los renglones `soloAdmin` (Cobranzas → Comisiones).
 */
export function puedeAbrirDestino(
  id: IdModulo,
  seccion: string | null | undefined,
  puedeVer: (area: Area) => boolean,
  rol: Rol,
): boolean {
  const area = areaDelDestino(id, seccion)
  if (area && !puedeVer(area)) return false
  if (id === 'cobranzas' && SECCIONES_COBRANZAS.find((item) => item.id === seccionDeCobranzas(seccion))?.soloAdmin) return rol !== 'EMPLEADO'
  return true
}

export function buscarModulo(id: IdModulo): Modulo {
  if (id === MODULO_ADMINISTRACION.id) return MODULO_ADMINISTRACION
  if (id === MODULO_API_ASEGURADORAS.id) return MODULO_API_ASEGURADORAS
  const modulo = MODULOS.find((candidato) => candidato.id === id)
  if (!modulo) throw new Error(`Módulo desconocido: ${id}`)
  return modulo
}
