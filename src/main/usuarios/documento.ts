// El documento de usuarios que vive en GitHub (usuarios.json) y las reglas para cambiarlo.
//
// Todo acá es puro: ni base de datos, ni red, ni Electron. Cada mutación recibe un documento y
// devuelve otro nuevo, así el servicio puede releer el archivo y volver a aplicar el mismo cambio
// cuando otra computadora escribió en el medio (el candado optimista del `sha` de GitHub).
import { normalizarMatriz, permisosPorDefecto, type MatrizPermisos } from '../../shared/permisos'
import { ROLES, type Rol } from '../../shared/tipos'
import { ErrorDeNegocio } from '../servicios/errores'

export const FORMATO_ACTUAL = 1

export interface UsuarioRemoto {
  /** Id estable en GitHub. Nunca se reusa; el id local de cada PC es otro (ver espejo.ts). */
  id: number
  nombre: string
  usuario: string
  /** Hash bcrypt. Es lo único que existe de la contraseña en cualquier lado. */
  claveHash: string
  rol: Rol
  /** Por nombre: las sucursales se siembran iguales en todas las computadoras. */
  sucursal: string
  activo: boolean
  debeCambiarClave: boolean
  creadoEn: string
  actualizadoEn: string
}

export interface DocumentoUsuarios {
  formato: typeof FORMATO_ACTUAL
  siguienteId: number
  usuarios: UsuarioRemoto[]
  /**
   * Qué puede ver y tocar cada rol (Administración → Permisos). Va acá y no en la base de cada
   * computadora porque tiene que valer para toda la agencia: si viviera en el `dm.db` de cada PC, el
   * superadministrador configuraría permisos que sólo se aplicarían en la suya.
   *
   * Un archivo que viene sin `permisos` (los que escribió una versión anterior del programa) se lee
   * con los valores por defecto, que son los de siempre: por eso el formato sigue siendo 1 y las
   * versiones viejas pueden seguir leyendo el archivo. Lo que no pueden es conservar el campo al
   * escribir: si una PC sin actualizar da de alta un usuario, la matriz vuelve a los valores por
   * defecto y hay que volver a guardarla desde una PC al día (ver README).
   */
  permisos: MatrizPermisos
}

export function documentoVacio(): DocumentoUsuarios {
  return { formato: FORMATO_ACTUAL, siguienteId: 1, usuarios: [], permisos: permisosPorDefecto() }
}

function igualSinMayusculas(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

export function buscarPorUsuario(documento: DocumentoUsuarios, usuario: string): UsuarioRemoto | null {
  return documento.usuarios.find((u) => igualSinMayusculas(u.usuario, usuario)) ?? null
}

export function buscarPorId(documento: DocumentoUsuarios, id: number): UsuarioRemoto | null {
  return documento.usuarios.find((u) => u.id === id) ?? null
}

/**
 * Un archivo sin ningún superadministrador activo no se acepta: nadie podría volver a administrar
 * usuarios desde el programa. Las mutaciones lo impiden; esto cubre el archivo editado a mano.
 */
export function tieneSuperAdminActivo(documento: DocumentoUsuarios): boolean {
  return documento.usuarios.some((u) => u.rol === 'SUPER_ADMIN' && u.activo)
}

// ---------------------------------------------------------------------------
// Leer y escribir el archivo
// ---------------------------------------------------------------------------

function textoObligatorio(valor: unknown, campo: string, contexto: string): string {
  if (typeof valor !== 'string' || valor.trim() === '') throw new ErrorDeNegocio(`${contexto}: falta «${campo}».`)
  return valor
}

function leerUsuario(crudo: unknown, posicion: number): UsuarioRemoto {
  const contexto = `El archivo usuarios.json de GitHub no es válido (usuario ${posicion + 1})`
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) throw new ErrorDeNegocio(`${contexto}.`)
  const u = crudo as Record<string, unknown>
  if (typeof u.id !== 'number' || !Number.isInteger(u.id) || u.id <= 0) throw new ErrorDeNegocio(`${contexto}: el id no es válido.`)
  const rol = u.rol
  if (typeof rol !== 'string' || !(ROLES as readonly string[]).includes(rol)) {
    throw new ErrorDeNegocio(`${contexto}: el rol «${String(rol)}» no existe.`)
  }
  const sucursal = textoObligatorio(u.sucursal, 'sucursal', contexto).trim()
  if (sucursal.length > 80) throw new ErrorDeNegocio(`${contexto}: el nombre de la sucursal es demasiado largo.`)
  return {
    id: u.id,
    nombre: textoObligatorio(u.nombre, 'nombre', contexto).trim(),
    usuario: textoObligatorio(u.usuario, 'usuario', contexto).trim().toLowerCase(),
    claveHash: textoObligatorio(u.claveHash, 'claveHash', contexto),
    rol: rol as Rol,
    sucursal,
    activo: u.activo !== false,
    debeCambiarClave: u.debeCambiarClave === true,
    creadoEn: typeof u.creadoEn === 'string' ? u.creadoEn : '',
    actualizadoEn: typeof u.actualizadoEn === 'string' ? u.actualizadoEn : '',
  }
}

/** Parsea y valida el archivo. Un archivo roto se rechaza entero: mejor no entrar que entrar mal. */
export function leerDocumento(texto: string): DocumentoUsuarios {
  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    throw new ErrorDeNegocio('El archivo usuarios.json de GitHub no es un JSON válido.')
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ErrorDeNegocio('El archivo usuarios.json de GitHub no tiene la forma esperada.')
  }
  const d = json as Record<string, unknown>
  if (d.formato !== FORMATO_ACTUAL) {
    throw new ErrorDeNegocio(
      `El archivo usuarios.json de GitHub es de un formato (${String(d.formato)}) que esta versión del programa no entiende. Actualizá el programa.`,
    )
  }
  if (!Array.isArray(d.usuarios)) throw new ErrorDeNegocio('El archivo usuarios.json de GitHub no tiene la lista de usuarios.')
  const usuarios = d.usuarios.map(leerUsuario)

  const ids = new Set<number>()
  const nombres: string[] = []
  for (const u of usuarios) {
    if (ids.has(u.id)) throw new ErrorDeNegocio(`El archivo usuarios.json de GitHub repite el id ${u.id}.`)
    ids.add(u.id)
    if (nombres.some((n) => igualSinMayusculas(n, u.usuario))) {
      throw new ErrorDeNegocio(`El archivo usuarios.json de GitHub repite el usuario «${u.usuario}».`)
    }
    nombres.push(u.usuario)
  }

  const mayorId = usuarios.reduce((mayor, u) => Math.max(mayor, u.id), 0)
  const siguienteId = typeof d.siguienteId === 'number' && d.siguienteId > mayorId ? d.siguienteId : mayorId + 1
  // Los permisos no invalidan el archivo: lo que falte o no se entienda queda en el valor por defecto.
  // Un archivo escrito por una versión anterior (sin el campo) tiene que poder abrirse igual.
  return { formato: FORMATO_ACTUAL, siguienteId, usuarios, permisos: normalizarMatriz(d.permisos) }
}

/** Texto estable (ordenado por id, indentado) para que los diffs del repositorio se lean. */
export function escribirDocumento(documento: DocumentoUsuarios): string {
  const ordenado: DocumentoUsuarios = {
    formato: FORMATO_ACTUAL,
    siguienteId: documento.siguienteId,
    usuarios: [...documento.usuarios].sort((a, b) => a.id - b.id),
    permisos: normalizarMatriz(documento.permisos),
  }
  return JSON.stringify(ordenado, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// Mutaciones
// ---------------------------------------------------------------------------

export interface DatosDeAlta {
  nombre: string
  usuario: string
  claveHash: string
  rol: Rol
  sucursal: string
  /** true para los usuarios que crea un administrador: tienen que cambiar la contraseña al entrar. */
  debeCambiarClave: boolean
}

export interface DatosDeEdicion {
  nombre: string
  usuario: string
  rol: Rol
  sucursal: string
}

export interface Cambio {
  documento: DocumentoUsuarios
  usuario: UsuarioRemoto
}

function exigirUsuario(documento: DocumentoUsuarios, id: number): UsuarioRemoto {
  const usuario = buscarPorId(documento, id)
  if (!usuario) throw new ErrorDeNegocio('El usuario ya no existe en la base de usuarios.')
  return usuario
}

function exigirNombreLibre(documento: DocumentoUsuarios, usuario: string, exceptoId?: number): void {
  const existente = buscarPorUsuario(documento, usuario)
  if (existente && existente.id !== exceptoId) {
    throw new ErrorDeNegocio(`Ya existe un usuario con el nombre "${usuario}".`)
  }
}

function contarOtrosSuperAdminsActivos(documento: DocumentoUsuarios, exceptoId: number): number {
  return documento.usuarios.filter((u) => u.rol === 'SUPER_ADMIN' && u.activo && u.id !== exceptoId).length
}

function reemplazar(documento: DocumentoUsuarios, usuario: UsuarioRemoto): Cambio {
  return {
    documento: { ...documento, usuarios: documento.usuarios.map((u) => (u.id === usuario.id ? usuario : u)) },
    usuario,
  }
}

export function agregarUsuario(documento: DocumentoUsuarios, datos: DatosDeAlta, ahora: string): Cambio {
  exigirNombreLibre(documento, datos.usuario)
  const usuario: UsuarioRemoto = {
    id: documento.siguienteId,
    nombre: datos.nombre,
    usuario: datos.usuario,
    claveHash: datos.claveHash,
    rol: datos.rol,
    sucursal: datos.sucursal,
    activo: true,
    debeCambiarClave: datos.debeCambiarClave,
    creadoEn: ahora,
    actualizadoEn: ahora,
  }
  return {
    documento: { ...documento, siguienteId: documento.siguienteId + 1, usuarios: [...documento.usuarios, usuario] },
    usuario,
  }
}

/**
 * Agrega varios usuarios ya existentes (con sus hashes) conservando sus ids: es el bootstrap, cuando
 * el archivo todavía no existe en GitHub y se sube lo que tenía la primera computadora.
 */
export function agregarExistentes(documento: DocumentoUsuarios, usuarios: Omit<UsuarioRemoto, 'id'>[], ahora: string): DocumentoUsuarios {
  let actual = documento
  for (const u of usuarios) {
    if (buscarPorUsuario(actual, u.usuario)) continue
    const nuevo: UsuarioRemoto = {
      ...u,
      id: actual.siguienteId,
      creadoEn: u.creadoEn || ahora,
      actualizadoEn: u.actualizadoEn || ahora,
    }
    actual = { ...actual, siguienteId: actual.siguienteId + 1, usuarios: [...actual.usuarios, nuevo] }
  }
  return actual
}

export function editarUsuario(documento: DocumentoUsuarios, id: number, datos: DatosDeEdicion, actorId: number, ahora: string): Cambio {
  const actual = exigirUsuario(documento, id)
  exigirNombreLibre(documento, datos.usuario, id)
  if (actual.id === actorId && datos.rol !== actual.rol) {
    throw new ErrorDeNegocio('No podés cambiar tu propio rol.')
  }
  if (
    actual.rol === 'SUPER_ADMIN' &&
    datos.rol !== 'SUPER_ADMIN' &&
    actual.activo &&
    contarOtrosSuperAdminsActivos(documento, actual.id) === 0
  ) {
    throw new ErrorDeNegocio('Tiene que quedar al menos un superadministrador activo.')
  }
  return reemplazar(documento, {
    ...actual,
    nombre: datos.nombre,
    usuario: datos.usuario,
    rol: datos.rol,
    sucursal: datos.sucursal,
    actualizadoEn: ahora,
  })
}

export function cambiarActivo(documento: DocumentoUsuarios, id: number, activo: boolean, actorId: number, ahora: string): Cambio {
  const actual = exigirUsuario(documento, id)
  if (!activo) {
    if (actual.id === actorId) throw new ErrorDeNegocio('No podés desactivar tu propio usuario.')
    if (actual.rol === 'SUPER_ADMIN' && actual.activo && contarOtrosSuperAdminsActivos(documento, actual.id) === 0) {
      throw new ErrorDeNegocio('Tiene que quedar al menos un superadministrador activo.')
    }
  }
  return reemplazar(documento, { ...actual, activo, actualizadoEn: ahora })
}

/**
 * Reemplaza la matriz de permisos. No toca a los usuarios: quién es quién y qué puede hacer cada rol
 * son cosas distintas y se editan en pantallas distintas.
 */
export function guardarPermisos(documento: DocumentoUsuarios, permisos: MatrizPermisos): DocumentoUsuarios {
  return { ...documento, permisos: normalizarMatriz(permisos) }
}

export function cambiarClaveHash(
  documento: DocumentoUsuarios,
  id: number,
  claveHash: string,
  debeCambiarClave: boolean,
  ahora: string,
): Cambio {
  const actual = exigirUsuario(documento, id)
  return reemplazar(documento, { ...actual, claveHash, debeCambiarClave, actualizadoEn: ahora })
}
