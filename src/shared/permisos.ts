// Qué puede ver y qué puede tocar cada rol, módulo por módulo.
//
// Es puro y compartido (main, precarga y renderer) como semaforo.ts: el proceso principal lo usa para
// aceptar o rechazar cada llamado y el renderer, para mostrar u ocultar. El que manda es el proceso
// principal; el renderer sólo evita ofrecer botones que después van a fallar.
//
// Tres decisiones que conviene tener presentes:
//   1. El SUPER_ADMIN no está en la matriz: siempre tiene todo. Si pudiera sacarse permisos a sí
//      mismo, la agencia se quedaría sin nadie que pueda devolvérselos.
//   2. La matriz sólo RESTRINGE. Los controles que ya existían por rol (cerrar el mes, ver comisiones,
//      borrar un documento, administrar usuarios) siguen valiendo igual: darle «editar» a un empleado
//      en Cobranzas no le abre las comisiones.
//   3. «Inicio» no se puede sacar: es la pantalla que queda cuando no se tiene ninguna otra.
import { ROLES, type Rol } from './tipos'

/** Cada módulo de la barra lateral es un área de permisos, menos Inicio (que siempre se ve). */
export const AREAS = [
  'cartera',
  'clientes',
  'leads',
  'presupuestos',
  'polizas',
  'renovaciones',
  'siniestros',
  'cobranzas',
  'metricas',
  'reportes',
  'marketing',
  'tareas',
  'administracion',
] as const

export type Area = (typeof AREAS)[number]

/**
 * De menos a más. El orden importa: `alcanza()` compara posiciones.
 * - `ninguno`: el módulo no aparece en la barra lateral y sus llamados se rechazan.
 * - `ver`: se abre y se consulta, pero no se puede modificar nada.
 * - `editar`: como siempre.
 */
export const NIVELES = ['ninguno', 'ver', 'editar'] as const

export type Nivel = (typeof NIVELES)[number]

export const NOMBRE_NIVEL: Record<Nivel, string> = {
  ninguno: 'Sin acceso',
  ver: 'Sólo ver',
  editar: 'Ver y editar',
}

/** Nombre y explicación de cada área, para la pantalla de Administración → Permisos. */
export const DESCRIPCION_AREA: Record<Area, { nombre: string; detalle: string }> = {
  cartera: { nombre: 'Cartera', detalle: 'La planilla del mes, Bajas, Riesgos varios, AMP, Imputados, las reglas de cobertura y las estadísticas.' },
  clientes: { nombre: 'Clientes', detalle: 'El listado, la ficha de cada cliente y el buscador de deudores.' },
  leads: { nombre: 'Leads', detalle: 'Las consultas que todavía no son clientes.' },
  presupuestos: { nombre: 'Presupuestos', detalle: 'Las cotizaciones, el mensaje de WhatsApp y el PDF.' },
  polizas: { nombre: 'Pólizas', detalle: 'El listado por póliza y el alta.' },
  renovaciones: { nombre: 'Renovaciones', detalle: 'La bandeja de lo que vence y el seguimiento.' },
  siniestros: { nombre: 'Siniestros', detalle: 'El listado, la ficha, los documentos y las tareas del siniestro.' },
  cobranzas: { nombre: 'Cobranzas', detalle: 'La caja del día y la mora. Las comisiones siguen siendo sólo de administradores.' },
  metricas: { nombre: 'Métricas', detalle: 'El tablero con los números de la agencia.' },
  reportes: { nombre: 'Reportes', detalle: 'Exportar listados a Excel o PDF y la planilla clásica.' },
  marketing: { nombre: 'Marketing', detalle: 'Los segmentos de la cartera y las plantillas de WhatsApp.' },
  tareas: { nombre: 'Tareas', detalle: 'Los pendientes del equipo y la campana de avisos.' },
  administracion: { nombre: 'Administración', detalle: 'Compañías, impresora, conexión con Google, importación y sincronización. Usuarios y Permisos son siempre sólo del superadministrador, y «Acerca de» la ve todo el mundo.' },
}

/** Qué nivel tiene cada rol en cada área. El SUPER_ADMIN no figura: tiene todo. */
export type PermisosDeUnRol = Record<Area, Nivel>

export type RolConfigurable = Exclude<Rol, 'SUPER_ADMIN'>

/** Los roles que se configuran desde la pantalla de permisos. */
export const ROLES_CONFIGURABLES = ROLES.filter((rol): rol is RolConfigurable => rol !== 'SUPER_ADMIN')

export type MatrizPermisos = Record<RolConfigurable, PermisosDeUnRol>

function todas(nivel: Nivel): PermisosDeUnRol {
  return Object.fromEntries(AREAS.map((area) => [area, nivel])) as PermisosDeUnRol
}

/**
 * Lo que rige mientras nadie toque la pantalla de permisos: exactamente lo que hacía el programa
 * antes de que existiera esta matriz. Un ADMIN entra a todo; un EMPLEADO trabaja todos los módulos
 * del día a día y no entra a Administración (salvo «Acerca de», que no se configura).
 */
export function permisosPorDefecto(): MatrizPermisos {
  return {
    ADMIN: todas('editar'),
    EMPLEADO: { ...todas('editar'), administracion: 'ninguno' },
  }
}

export function esArea(valor: unknown): valor is Area {
  return typeof valor === 'string' && (AREAS as readonly string[]).includes(valor)
}

export function esNivel(valor: unknown): valor is Nivel {
  return typeof valor === 'string' && (NIVELES as readonly string[]).includes(valor)
}

/** ¿`nivel` llega a lo que pide `minimo`? `editar` alcanza para ver; `ver` no alcanza para editar. */
export function alcanza(nivel: Nivel, minimo: Nivel): boolean {
  return NIVELES.indexOf(nivel) >= NIVELES.indexOf(minimo)
}

/**
 * Deja la matriz en su forma canónica: completa las áreas que falten con el valor por defecto y
 * descarta lo que no entienda. Se usa al leer usuarios.json (que puede venir de una versión anterior
 * del programa o editado a mano) y al recibir lo que manda la pantalla, así nunca queda a medias.
 */
export function normalizarMatriz(crudo: unknown): MatrizPermisos {
  const base = permisosPorDefecto()
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) return base
  const entrada = crudo as Record<string, unknown>
  for (const rol of ROLES_CONFIGURABLES) {
    const deEsteRol = entrada[rol]
    if (typeof deEsteRol !== 'object' || deEsteRol === null || Array.isArray(deEsteRol)) continue
    const valores = deEsteRol as Record<string, unknown>
    for (const area of AREAS) {
      const nivel = valores[area]
      if (esNivel(nivel)) base[rol][area] = nivel
    }
  }
  return base
}

/** El nivel que le corresponde a un rol en un área. El SUPER_ADMIN siempre puede todo. */
export function nivelDe(matriz: MatrizPermisos, rol: Rol, area: Area): Nivel {
  if (rol === 'SUPER_ADMIN') return 'editar'
  return matriz[rol][area]
}

/** La matriz aplanada para un rol: es lo que viaja al renderer. */
export function permisosDelRol(matriz: MatrizPermisos, rol: Rol): PermisosDeUnRol {
  if (rol === 'SUPER_ADMIN') return todas('editar')
  return { ...matriz[rol] }
}

export function sonIguales(a: MatrizPermisos, b: MatrizPermisos): boolean {
  return ROLES_CONFIGURABLES.every((rol) => AREAS.every((area) => a[rol][area] === b[rol][area]))
}

/** Resumen legible de un rol, para el historial: «Cartera: sólo ver · Marketing: sin acceso». */
export function resumenDeCambios(antes: PermisosDeUnRol, despues: PermisosDeUnRol): string {
  const cambios = AREAS.filter((area) => antes[area] !== despues[area]).map(
    (area) => `${DESCRIPCION_AREA[area].nombre}: ${NOMBRE_NIVEL[antes[area]]} → ${NOMBRE_NIVEL[despues[area]]}`,
  )
  return cambios.join(' · ')
}
