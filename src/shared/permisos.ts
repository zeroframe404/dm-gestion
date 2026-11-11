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
import { NOMBRE_ROL, ROLES, type Rol } from './tipos'

/** Cada módulo de la barra lateral es un área de permisos, menos Inicio (que siempre se ve). */
export const AREAS = [
  'cartera',
  'clientes',
  'leads',
  'presupuestos',
  'multicotizador',
  'miLink',
  'polizas',
  'renovaciones',
  'siniestros',
  'cobranzas',
  'metricas',
  'reportes',
  'marketing',
  'tareas',
  'mensajes',
  'companias',
  'administracion',
] as const

export type Area = (typeof AREAS)[number]

/**
 * De menos a más. El orden importa: `alcanza()` compara posiciones.
 * - `ninguno` («Sin permiso»): el módulo no aparece en la barra lateral y sus llamados se rechazan.
 * - `ver` («Solo lectura»): se abre y se consulta, pero no se puede modificar nada.
 * - `editar` («Permitido»): lectura y escritura, como siempre.
 */
export const NIVELES = ['ninguno', 'ver', 'editar'] as const

export type Nivel = (typeof NIVELES)[number]

export const NOMBRE_NIVEL: Record<Nivel, string> = {
  ninguno: 'Sin permiso',
  ver: 'Solo lectura',
  editar: 'Permitido',
}

/** Nombre y explicación de cada área, para la pantalla de Administración → Permisos. */
export const DESCRIPCION_AREA: Record<Area, { nombre: string; detalle: string }> = {
  cartera: { nombre: 'Cartera', detalle: 'La planilla del mes, Bajas, Riesgos varios, AMP, Imputados, las reglas de cobertura y las estadísticas.' },
  clientes: { nombre: 'Clientes', detalle: 'El listado, la ficha de cada cliente y el buscador de deudores.' },
  leads: { nombre: 'Leads', detalle: 'Las consultas que todavía no son clientes.' },
  presupuestos: { nombre: 'Presupuestos', detalle: 'Las cotizaciones, el mensaje de WhatsApp y el PDF.' },
  multicotizador: {
    nombre: 'Multicotizador',
    detalle:
      'Cotizar un auto o una moto en todas las compañías con API a la vez y comparar. Armar el presupuesto y emitir desde ahí piden además editar Presupuestos.',
  },
  miLink: {
    nombre: 'Mi tienda',
    detalle:
      'La página pública de cada uno (en el dominio de la agencia, con /p/…), las solicitudes y denuncias que llegan por ahí y sus métricas. Cada uno ve lo suyo; ver lo de los demás es sólo de administradores.',
  },
  polizas: { nombre: 'Pólizas', detalle: 'El listado por póliza y el alta.' },
  renovaciones: { nombre: 'Renovaciones', detalle: 'La bandeja de lo que vence y el seguimiento.' },
  siniestros: { nombre: 'Siniestros', detalle: 'El listado, la ficha, los documentos y las tareas del siniestro.' },
  cobranzas: { nombre: 'Cobranzas', detalle: 'La caja del día y la mora. Las comisiones siguen siendo sólo de administradores.' },
  metricas: { nombre: 'Métricas', detalle: 'El tablero con los números de la agencia.' },
  reportes: { nombre: 'Reportes', detalle: 'Exportar listados a Excel o PDF y la planilla clásica.' },
  marketing: { nombre: 'Marketing', detalle: 'Los segmentos de la cartera y las plantillas de WhatsApp.' },
  tareas: { nombre: 'Tareas', detalle: 'Los pendientes del equipo y la campana de avisos.' },
  mensajes: {
    nombre: 'Mensajes',
    detalle:
      'El chat interno: hablar con un compañero o con un grupo, con archivos. «Sólo ver» deja leer lo que le mandan a uno y no deja contestar. El registro de todos los mensajes de la agencia es siempre y sólo del superadministrador.',
  },
  companias: {
    nombre: 'Compañías',
    detalle:
      'Las listas de consulta del mostrador: organizadores, precios, antigüedad, grúas y qué ampara cada cobertura. Cargarlas sigue siendo sólo del superadministrador; este permiso decide quién las CONSULTA.',
  },
  administracion: { nombre: 'Administración', detalle: 'El catálogo de compañías (días de cobertura financiera y comisión), impresora, conexión con Google, importación y sincronización. Usuarios y Permisos son siempre sólo del superadministrador, y «Acerca de» la ve todo el mundo.' },
}

/** Qué nivel tiene cada rol en cada área. El SUPER_ADMIN no figura: tiene todo. */
export type PermisosDeUnRol = Record<Area, Nivel>

export type RolConfigurable = Exclude<Rol, 'SUPER_ADMIN'>

/** Los roles integrados que se configuran desde la pantalla de permisos. */
export const ROLES_CONFIGURABLES = ROLES.filter((rol): rol is RolConfigurable => rol !== 'SUPER_ADMIN')

/**
 * Un rol armado por la agencia (Administración → Permisos → «Nuevo rol»).
 *
 * `base` es el rol integrado del que hereda TODO lo que no es la matriz: los controles que siguen
 * siendo «de administrador» (cerrar el mes, ver comisiones, borrar un documento) y los que ve un
 * «usuario» (sólo su sucursal, sin los números de la agencia). La matriz decide a qué módulos entra;
 * `base` decide qué clase de persona es dentro de ellos. Se elige al crear el rol y no se cambia:
 * es lo que se guarda en el usuario (su `rol`) y cambiarlo dejaría a los usuarios del rol con una
 * base distinta de la del rol.
 */
export type RolBase = RolConfigurable

export interface RolPersonalizado {
  /** Estable: es lo que apuntan las asignaciones. Letras, números y guiones. */
  id: string
  nombre: string
  base: RolBase
  permisos: PermisosDeUnRol
}

/** Lo que cada rol puede hacer con las autorizaciones puntuales (ver `autorizaciones.ts`). */
export interface OpcionesDeRol {
  /** Ve el botón «Pedir autorización» y puede pedir acceso a una pantalla que no tiene. */
  puedeSolicitar: boolean
  /** Ve los pedidos de los demás y decide: lectura y escritura, sólo lectura o denegar. */
  puedeResolver: boolean
}

export interface MatrizPermisos {
  ADMIN: PermisosDeUnRol
  EMPLEADO: PermisosDeUnRol
  /** Los roles que armó la agencia, además de los dos integrados. */
  personalizados: RolPersonalizado[]
  /** Por clave de rol: `ADMIN`, `EMPLEADO` o el id de un rol personalizado. */
  opciones: Record<string, OpcionesDeRol>
  /**
   * Qué usuario tiene qué rol personalizado: `usuario` (minúsculas) → id del rol. Vive acá y no en
   * el registro del usuario porque el usuario se guarda en cuatro lugares (GitHub, espejo local,
   * credencial guardada y sesión) y este documento ya viaja a todos con los permisos.
   */
  asignaciones: Record<string, string>
}

function todas(nivel: Nivel): PermisosDeUnRol {
  return Object.fromEntries(AREAS.map((area) => [area, nivel])) as PermisosDeUnRol
}

export function opcionesPorDefecto(clave: string): OpcionesDeRol {
  return { puedeSolicitar: false, puedeResolver: clave === 'ADMIN' }
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
    personalizados: [],
    opciones: { ADMIN: opcionesPorDefecto('ADMIN'), EMPLEADO: opcionesPorDefecto('EMPLEADO') },
    asignaciones: {},
  }
}

/**
 * ¿Este rol puede ver los números de la agencia?
 *
 * Es una línea distinta de la matriz de permisos y por eso no está en ella: la matriz dice a qué
 * MÓDULOS entra cada uno, y esto dice qué NÚMEROS ve dentro de los módulos a los que ya entró. Un
 * empleado necesita Cobranzas todos los días —la caja de su sucursal, la mora que tiene que salir a
 * cobrar, la cuota de la persona que tiene delante— y nada de eso es lo que gana la agencia.
 *
 * Lo que queda del otro lado es lo agregado: el bruto cobrado en el mes, la comisión estimada, el
 * porcentaje que paga cada compañía, la evolución de la recaudación. Se oculta para que el sueldo de
 * nadie se discuta contra un número que además está mal leído —«cobrado» no es «ganado»—, que es
 * exactamente el problema que pidió resolver la agencia.
 *
 * Es una regla de ROL y no un permiso configurable a propósito: si se pudiera activar por pantalla,
 * alcanzaría con que alguien se distraiga una vez.
 */
export function veLosNumerosDeLaAgencia(rol: Rol): boolean {
  return rol !== 'EMPLEADO'
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

const FORMA_DE_ID = /^[a-z0-9_-]{1,40}$/
export const LARGO_MAXIMO_NOMBRE_DE_ROL = 40
const NOMBRES_RESERVADOS = ['superadministrador', 'administrador', 'usuario', 'admin', 'empleado', 'super admin']

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor) ? (valor as Record<string, unknown>) : null
}

function leerNiveles(crudo: unknown, base: PermisosDeUnRol): PermisosDeUnRol {
  const resultado = { ...base }
  const valores = objeto(crudo)
  if (!valores) return resultado
  for (const area of AREAS) {
    const nivel = valores[area]
    if (esNivel(nivel)) resultado[area] = nivel
  }
  return resultado
}

function normalizarNombre(valor: unknown): string {
  return typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, LARGO_MAXIMO_NOMBRE_DE_ROL) : ''
}

/**
 * Deja la matriz en su forma canónica: completa las áreas que falten con el valor por defecto y
 * descarta lo que no entienda. Se usa al leer usuarios.json (que puede venir de una versión anterior
 * del programa o editado a mano) y al recibir lo que manda la pantalla, así nunca queda a medias.
 */
export function normalizarMatriz(crudo: unknown): MatrizPermisos {
  const base = permisosPorDefecto()
  const entrada = objeto(crudo)
  if (!entrada) return base
  for (const rol of ROLES_CONFIGURABLES) base[rol] = leerNiveles(entrada[rol], base[rol])

  const vistos = new Set<string>()
  const crudos = Array.isArray(entrada.personalizados) ? entrada.personalizados : []
  for (const candidato of crudos) {
    const r = objeto(candidato)
    if (!r) continue
    const id = typeof r.id === 'string' ? r.id : ''
    const nombre = normalizarNombre(r.nombre)
    if (!FORMA_DE_ID.test(id) || vistos.has(id) || nombre.length < 2) continue
    const rolBase: RolBase = r.base === 'ADMIN' ? 'ADMIN' : 'EMPLEADO'
    vistos.add(id)
    base.personalizados.push({ id, nombre, base: rolBase, permisos: leerNiveles(r.permisos, base[rolBase]) })
  }

  const opciones = objeto(entrada.opciones) ?? {}
  const claves = ['ADMIN', 'EMPLEADO', ...base.personalizados.map((rol) => rol.id)]
  base.opciones = {}
  for (const clave of claves) {
    const porDefecto = opcionesPorDefecto(clave)
    const dado = objeto(opciones[clave])
    base.opciones[clave] = {
      puedeSolicitar: typeof dado?.puedeSolicitar === 'boolean' ? dado.puedeSolicitar : porDefecto.puedeSolicitar,
      puedeResolver: typeof dado?.puedeResolver === 'boolean' ? dado.puedeResolver : porDefecto.puedeResolver,
    }
  }

  const asignaciones = objeto(entrada.asignaciones) ?? {}
  for (const usuario of Object.keys(asignaciones).sort()) {
    const id = asignaciones[usuario]
    if (typeof id === 'string' && vistos.has(id) && usuario.trim()) base.asignaciones[usuario.trim().toLowerCase()] = id
  }
  return base
}

/** El rol personalizado que tiene un usuario, si tiene alguno. El SUPER_ADMIN nunca. */
export function rolPersonalizadoDe(matriz: MatrizPermisos, rol: Rol, usuario?: string | null): RolPersonalizado | null {
  if (rol === 'SUPER_ADMIN' || !usuario) return null
  const id = matriz.asignaciones[usuario.trim().toLowerCase()]
  return id ? (matriz.personalizados.find((candidato) => candidato.id === id) ?? null) : null
}

/** La clave del rol que rige para este usuario: `ADMIN`, `EMPLEADO` o el id del rol personalizado. */
export function claveDeRol(matriz: MatrizPermisos, rol: Rol, usuario?: string | null): string {
  return rolPersonalizadoDe(matriz, rol, usuario)?.id ?? rol
}

/** Cómo se llama el rol de este usuario, para mostrar. */
export function nombreDelRol(matriz: MatrizPermisos, rol: Rol, usuario?: string | null): string {
  return rolPersonalizadoDe(matriz, rol, usuario)?.nombre ?? NOMBRE_ROL[rol]
}

/** El nivel que le corresponde a un rol en un área. El SUPER_ADMIN siempre puede todo. */
export function nivelDe(matriz: MatrizPermisos, rol: Rol, area: Area, usuario?: string | null): Nivel {
  return permisosDelRol(matriz, rol, usuario)[area]
}

/** La matriz aplanada para un rol: es lo que viaja al renderer. */
export function permisosDelRol(matriz: MatrizPermisos, rol: Rol, usuario?: string | null): PermisosDeUnRol {
  if (rol === 'SUPER_ADMIN') return todas('editar')
  return { ...(rolPersonalizadoDe(matriz, rol, usuario)?.permisos ?? matriz[rol]) }
}

/** Qué puede hacer este usuario con las autorizaciones puntuales. El SUPER_ADMIN siempre resuelve. */
export function opcionesDe(matriz: MatrizPermisos, rol: Rol, usuario?: string | null): OpcionesDeRol {
  if (rol === 'SUPER_ADMIN') return { puedeSolicitar: false, puedeResolver: true }
  const clave = claveDeRol(matriz, rol, usuario)
  return matriz.opciones[clave] ?? opcionesPorDefecto(clave)
}

/** El mayor de dos niveles. */
export function mejorNivel(a: Nivel, b: Nivel): Nivel {
  return NIVELES.indexOf(a) >= NIVELES.indexOf(b) ? a : b
}

export function sonIguales(a: MatrizPermisos, b: MatrizPermisos): boolean {
  return JSON.stringify(normalizarMatriz(a)) === JSON.stringify(normalizarMatriz(b))
}

/**
 * Lo que llega del formulario contra lo que hay guardado. Las asignaciones NO se toman de lo
 * enviado: se editan desde Usuarios y la pantalla de permisos puede tener una copia vieja; pisarlas
 * dejaría a alguien sin su rol. Tampoco se puede borrar un rol que todavía tiene gente.
 */
export function resolverGuardado(actual: MatrizPermisos, enviada: MatrizPermisos): { matriz: MatrizPermisos } | { error: string } {
  const nombres = new Set<string>()
  for (const rol of enviada.personalizados ?? []) {
    const nombre = normalizarNombre(rol?.nombre)
    if (nombre.length < 2) return { error: 'Cada rol necesita un nombre de al menos 2 letras.' }
    const clave = nombre.toLowerCase()
    if (NOMBRES_RESERVADOS.includes(clave)) return { error: `«${nombre}» es el nombre de un rol que ya existe. Elegí otro.` }
    if (nombres.has(clave)) return { error: `Hay dos roles que se llaman «${nombre}». Cada uno necesita un nombre distinto.` }
    nombres.add(clave)
  }
  const nueva = normalizarMatriz({ ...enviada, asignaciones: actual.asignaciones })
  for (const rol of actual.personalizados) {
    if (nueva.personalizados.some((candidato) => candidato.id === rol.id)) continue
    const quienes = Object.entries(actual.asignaciones).filter(([, id]) => id === rol.id).map(([usuario]) => usuario)
    if (quienes.length > 0) {
      return { error: `El rol «${rol.nombre}» lo tienen ${quienes.join(', ')}. Cambiales el rol desde Usuarios antes de borrarlo.` }
    }
  }
  // Un rol que ya existía conserva su base: cambiarla dejaría a sus usuarios con otra distinta.
  for (const rol of nueva.personalizados) {
    const previo = actual.personalizados.find((candidato) => candidato.id === rol.id)
    if (previo) rol.base = previo.base
  }
  return { matriz: nueva }
}

/** Le pone (o le saca) un rol personalizado a un usuario. Devuelve la matriz nueva. */
export function asignarRolEnMatriz(matriz: MatrizPermisos, usuario: string, rolId: string | null, anterior?: string): MatrizPermisos {
  const asignaciones = { ...matriz.asignaciones }
  if (anterior) delete asignaciones[anterior.trim().toLowerCase()]
  const clave = usuario.trim().toLowerCase()
  delete asignaciones[clave]
  if (rolId) asignaciones[clave] = rolId
  return normalizarMatriz({ ...matriz, asignaciones })
}

/** Resumen legible de un rol, para el historial: «Cartera: sólo ver · Marketing: sin acceso». */
export function resumenDeCambios(antes: PermisosDeUnRol, despues: PermisosDeUnRol): string {
  const cambios = AREAS.filter((area) => antes[area] !== despues[area]).map(
    (area) => `${DESCRIPCION_AREA[area].nombre}: ${NOMBRE_NIVEL[antes[area]]} → ${NOMBRE_NIVEL[despues[area]]}`,
  )
  return cambios.join(' · ')
}
