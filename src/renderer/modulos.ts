// Módulos de la aplicación, en el orden en que aparecen en la barra lateral.
import { esArea, type Area } from '../shared/permisos'
import type { NombreIcono } from './componentes/Icono'

export type IdModulo =
  | 'inicio'
  | 'cartera'
  | 'clientes'
  | 'leads'
  | 'presupuestos'
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
}

export const MODULOS: Modulo[] = [
  { id: 'inicio', nombre: 'Inicio', icono: 'inicio', descripcion: 'Resumen general y accesos rápidos.', disponible: true },
  {
    id: 'cartera',
    nombre: 'Cartera',
    icono: 'cartera',
    descripcion: 'La planilla mensual: semáforo de vencimientos, avisos y pagos.',
    disponible: true,
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
    descripcion: 'La caja del día por sucursal, la mora, la rendición mensual y las comisiones.',
    disponible: true,
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
 * que DM Gestión habla con la API de cada aseguradora (por ahora, sólo Galeno). No es un área de
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

export function buscarModulo(id: IdModulo): Modulo {
  if (id === MODULO_ADMINISTRACION.id) return MODULO_ADMINISTRACION
  if (id === MODULO_API_ASEGURADORAS.id) return MODULO_API_ASEGURADORAS
  const modulo = MODULOS.find((candidato) => candidato.id === id)
  if (!modulo) throw new Error(`Módulo desconocido: ${id}`)
  return modulo
}
