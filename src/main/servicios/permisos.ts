// Los permisos por rol: qué módulos ve y cuáles puede tocar un ADMIN y un EMPLEADO.
//
// Dónde vive la matriz:
//   - Con base de usuarios compartida (lo normal en la agencia): en `usuarios.json` de GitHub, al
//     lado de los usuarios, porque tiene que valer igual en las cinco computadoras. Cada lectura del
//     archivo deja una copia en la tabla `configuracion`.
//   - Sin base compartida (desarrollo, pruebas, o antes de subir los usuarios): en esa misma tabla,
//     que ahí pasa a ser la fuente de verdad.
//
// La copia local no es un atajo: es lo que se usa para ingresar sin internet, cuando todavía no se
// pudo leer GitHub. Sólo restringe respecto de lo que ya decidía el rol; nunca da permisos de más.
import { nivelConcedido, concesionesVigentes } from '../../shared/autorizaciones'
import {
  alcanza,
  AREAS,
  asignarRolEnMatriz,
  esArea,
  mejorNivel,
  nivelDe,
  nombreDelRol,
  normalizarMatriz,
  opcionesDe,
  permisosDelRol,
  resolverGuardado,
  resumenDeCambios,
  ROLES_CONFIGURABLES,
  rolPersonalizadoDe,
  sonIguales,
  veLosNumerosDeLaAgencia,
  type Area,
  type MatrizPermisos,
  type Nivel,
  type PermisosDeUnRol,
} from '../../shared/permisos'
import type { MatrizDePermisos, MisPermisos, SesionUsuario, Usuario } from '../../shared/tipos'
import { solicitudesVigentes } from './almacenDeAutorizaciones'
import { ahoraIso } from '../importacion/normalizar'
import { canal } from '../vivo/canal'
import * as compartida from './baseDeUsuarios'
import { conectarAvisoDeCopia, fechaDeLaCopia, guardarCopiaLocal, leerCopiaLocal } from './copiaDePermisos'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { exigirSesion } from './sesion'

/** La última matriz que el renderer conoce. Sirve para avisarle sólo cuando de verdad cambió algo. */
let ultimaConocida: string | null = null

/** A quién avisarle que la matriz cambió (ipc.ts se lo manda a las ventanas abiertas). */
let avisar: ((permisos: MatrizPermisos) => void) | null = null

export function conectarAvisoDePermisos(nuevo: ((permisos: MatrizPermisos) => void) | null): void {
  avisar = nuevo
  // La matriz también cambia sin que nadie haya pedido un permiso: cuando la revalidación de la
  // sesión (cada 15 minutos) baja de GitHub una que tocaron en otra computadora. Eso reescribe la
  // copia local y nos enteramos por acá; si no, la pantalla se quedaría con la matriz vieja hasta el
  // llamado siguiente.
  conectarAvisoDeCopia(nuevo ? avisarSiCambio : null)
}

/**
 * Avisa a las ventanas abiertas si la matriz cambió desde la última vez. La primera de la sesión no
 * avisa: no hay nada que corregir todavía, es la que la pantalla va a pedir igual al montarse.
 */
function avisarSiCambio(permisos: MatrizPermisos): void {
  const texto = JSON.stringify(permisos)
  if (texto === ultimaConocida) return
  const habiaOtra = ultimaConocida !== null
  ultimaConocida = texto
  if (habiaOtra) avisar?.(permisos)
}

/** La base se abre de nuevo en cada prueba: la memoria de lo que ya se avisó no puede sobrevivirla. */
export function olvidarLoConocido(): void {
  ultimaConocida = null
  huellaDeConcesiones = null
}

// ---------------------------------------------------------------------------
// La matriz que rige ahora
// ---------------------------------------------------------------------------

/**
 * Con base compartida manda el último `usuarios.json` leído, y de paso se refresca la copia local.
 * Si todavía no se pudo leer (recién arrancó sin internet), rige esa copia, que es la del último
 * ingreso con conexión.
 */
export function matrizVigente(): MatrizPermisos {
  const permisos = leerVigente()
  avisarSiCambio(permisos)
  return permisos
}

function leerVigente(): MatrizPermisos {
  if (compartida.usaBaseCompartida()) {
    const documento = compartida.ultimoDocumentoLeido()
    if (documento) {
      const permisos = normalizarMatriz(documento.permisos)
      guardarCopiaLocal(permisos, ahoraIso())
      return permisos
    }
  }
  return leerCopiaLocal()
}

/**
 * El nivel del actor en un área: lo que le da su rol, o lo que le concedió una autorización puntual
 * vigente si es más. Una autorización sólo sube el nivel; nunca lo baja.
 */
function nivelEfectivo(matriz: MatrizPermisos, actor: SesionUsuario, area: Area): Nivel {
  const delRol = nivelDe(matriz, actor.rol, area, actor.usuario)
  if (delRol === 'editar' || actor.rol === 'SUPER_ADMIN') return delRol
  return mejorNivel(delRol, nivelConcedido(solicitudesVigentes(), actor.usuario, area, Date.now()))
}

export function nivelDelActor(actor: SesionUsuario, area: Area): Nivel {
  return nivelEfectivo(matrizVigente(), actor, area)
}

/** Lo que puede el actor, área por área, sumando las autorizaciones puntuales vigentes. */
function areasDelActor(matriz: MatrizPermisos, actor: SesionUsuario): PermisosDeUnRol {
  const delRol = permisosDelRol(matriz, actor.rol, actor.usuario)
  for (const area of AREAS) delRol[area] = nivelEfectivo(matriz, actor, area)
  return delRol
}

export function puedeVer(actor: SesionUsuario, area: Area): boolean {
  return alcanza(nivelDelActor(actor, area), 'ver')
}

export function puedeEditar(actor: SesionUsuario, area: Area): boolean {
  return alcanza(nivelDelActor(actor, area), 'editar')
}

export function misPermisos(actor: SesionUsuario): MisPermisos {
  const matriz = matrizVigente()
  const opciones = opcionesDe(matriz, actor.rol, actor.usuario)
  return {
    rol: actor.rol,
    rolNombre: nombreDelRol(matriz, actor.rol, actor.usuario),
    areas: areasDelActor(matriz, actor),
    veNumerosDeLaAgencia: veLosNumerosDeLaAgencia(actor.rol),
    puedeSolicitar: opciones.puedeSolicitar,
    puedeResolver: opciones.puedeResolver,
  }
}

/** Una huella de lo que el actor tiene concedido ahora, para saber cuándo avisarle a la pantalla. */
let huellaDeConcesiones: string | null = null

/**
 * Si cambiaron las concesiones vigentes del actor (llegó una, o venció otra), avisa a las ventanas
 * para que muestren u oculten los módulos. La primera consulta de la sesión no avisa.
 */
export function avisarSiCambiaronLasConcesiones(actor: SesionUsuario): void {
  const huella = concesionesVigentes(solicitudesVigentes(), actor.usuario, Date.now())
    .map((s) => `${s.id}:${s.nivelOtorgado}`)
    .sort()
    .join('|')
  const habiaOtra = huellaDeConcesiones !== null
  const cambio = huella !== huellaDeConcesiones
  huellaDeConcesiones = huella
  if (habiaOtra && cambio) avisar?.(matrizVigente())
}



// ---------------------------------------------------------------------------
// Lo que usan los manejadores de ipc.ts
// ---------------------------------------------------------------------------

const NOMBRE_MODULO: Record<Area, string> = {
  cartera: 'Cartera',
  clientes: 'Clientes',
  leads: 'Leads',
  presupuestos: 'Presupuestos',
  multicotizador: 'Multicotizador',
  miLink: 'Mi link',
  polizas: 'Pólizas',
  renovaciones: 'Renovaciones',
  siniestros: 'Siniestros',
  cobranzas: 'Cobranzas',
  metricas: 'Métricas',
  reportes: 'Reportes',
  marketing: 'Marketing',
  tareas: 'Tareas',
  mensajes: 'Mensajes',
  companias: 'Compañías',
  administracion: 'Administración',
}

function negar(areas: Area[], minimo: Nivel): never {
  const donde = areas.map((area) => NOMBRE_MODULO[area]).join(' ni ')
  throw new ErrorDeNegocio(
    minimo === 'editar'
      ? `No tenés permiso para modificar ${donde}. Pedíselo a un administrador.`
      : `No tenés permiso para entrar a ${donde}. Pedíselo a un administrador.`,
  )
}

/**
 * Exige la sesión abierta y, además, el nivel pedido en alguna de las áreas. Se admite más de una
 * porque hay pantallas que cruzan módulos: el formulario de póliza busca clientes, la ficha del
 * cliente cobra una cuota de la planilla. Alcanza con tener permiso en una de las dos puntas.
 *
 * Y desde la 14.0, si lo que se pide es EDITAR, también se exige el canal en vivo: «ver sí, tocar no».
 *
 * EL CANDADO VA ACÁ Y NO EN CADA MANEJADOR. `exigirEdicion` es la puerta por la que ya pasa todo lo
 * que escribe —doscientos y pico de canales de `ipc.ts`, más `exigirBorrado`, que la llama por
 * adentro—, así que ponerlo en este renglón lo deja cubierto de una y, sobre todo, deja cubierto lo
 * que se escriba mañana: un canal nuevo que se olvide del candado no existe, porque el permiso no se
 * puede olvidar. Repartido por los manejadores sería una lista que alguien tiene que acordarse de
 * completar, y la que falte es justo la que pisa el trabajo de otro mostrador.
 *
 * El orden importa: primero el rol y después la conexión. A quien no tiene permiso hay que decirle
 * que no tiene permiso, esté como esté internet; que le aparezca «sin conexión» lo mandaría a
 * reiniciar el router por algo que no se le va a arreglar nunca.
 *
 * Los pocos canales que escriben sin pasar por acá (cambiar la clave, tocar usuarios, el reporte de
 * soporte) llaman a `canal().exigirConexion()` a mano; están todos juntos y anotados en `ipc.ts`.
 */
function exigir(minimo: Nivel, areas: Area[]): SesionUsuario {
  const actor = exigirSesion()
  const matriz = matrizVigente()
  if (!areas.some((area) => alcanza(nivelEfectivo(matriz, actor, area), minimo))) negar(areas, minimo)
  if (minimo === 'editar') canal().exigirConexion()
  return actor
}

export function exigirVista(...areas: Area[]): SesionUsuario {
  return exigir('ver', areas)
}

export function exigirEdicion(...areas: Area[]): SesionUsuario {
  return exigir('editar', areas)
}

// ---------------------------------------------------------------------------
// Pantalla Administración → Permisos
// ---------------------------------------------------------------------------

export function matrizDePermisos(actor: SesionUsuario): MatrizDePermisos {
  return {
    permisos: matrizVigente(),
    puedeEditar: actor.rol === 'SUPER_ADMIN',
    origen: compartida.usaBaseCompartida() ? 'compartida' : 'local',
    actualizadoEn: fechaDeLaCopia(),
  }
}

/**
 * Lo que llega del formulario. `normalizarMatriz` completa lo que falte con los valores por defecto,
 * así que un objeto vacío borraría la configuración sin que nadie se entere: se exige que traiga al
 * menos un rol reconocible.
 */
function validar(datos: unknown): MatrizPermisos {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    throw new ErrorDeNegocio('Los permisos que llegaron no tienen la forma esperada.')
  }
  const crudo = datos as Record<string, unknown>
  const traeAlgo = ROLES_CONFIGURABLES.some((rol) => {
    const valores = crudo[rol]
    return typeof valores === 'object' && valores !== null && !Array.isArray(valores) && Object.keys(valores).some(esArea)
  })
  if (!traeAlgo) throw new ErrorDeNegocio('Los permisos que llegaron están vacíos.')
  return normalizarMatriz(crudo)
}

/** Lo que cambió en cada rol, para el historial: una línea por rol integrado o personalizado que se tocó. */
function cambiosParaElHistorial(antes: MatrizPermisos, despues: MatrizPermisos): Array<{ campo: string; texto: string }> {
  const cambios: Array<{ campo: string; texto: string }> = []
  for (const rol of ROLES_CONFIGURABLES) {
    const resumen = resumenDeCambios(antes[rol], despues[rol])
    if (resumen) cambios.push({ campo: `Permisos de ${rol}`, texto: resumen })
  }
  for (const rol of despues.personalizados) {
    const previo = antes.personalizados.find((candidato) => candidato.id === rol.id)
    if (!previo) {
      cambios.push({ campo: `Rol «${rol.nombre}»`, texto: 'Rol creado' })
      continue
    }
    if (previo.nombre !== rol.nombre) cambios.push({ campo: `Rol «${previo.nombre}»`, texto: `Ahora se llama «${rol.nombre}»` })
    const resumen = resumenDeCambios(previo.permisos, rol.permisos)
    if (resumen) cambios.push({ campo: `Permisos de «${rol.nombre}»`, texto: resumen })
  }
  for (const rol of antes.personalizados) {
    if (!despues.personalizados.some((candidato) => candidato.id === rol.id)) cambios.push({ campo: `Rol «${rol.nombre}»`, texto: 'Rol borrado' })
  }
  const clavesDeOpciones = ['ADMIN', 'EMPLEADO', ...despues.personalizados.map((rol) => rol.id)]
  for (const clave of clavesDeOpciones) {
    const a = antes.opciones[clave]
    const d = despues.opciones[clave]
    if (!a || !d) continue
    const nombre = clave === 'ADMIN' ? 'Administrador' : clave === 'EMPLEADO' ? 'Usuario' : `«${despues.personalizados.find((rol) => rol.id === clave)?.nombre ?? clave}»`
    if (a.puedeSolicitar !== d.puedeSolicitar) {
      cambios.push({ campo: `Autorizaciones de ${nombre}`, texto: d.puedeSolicitar ? 'Puede solicitar autorizaciones puntuales' : 'Ya no puede solicitar autorizaciones puntuales' })
    }
    if (a.puedeResolver !== d.puedeResolver) {
      cambios.push({ campo: `Autorizaciones de ${nombre}`, texto: d.puedeResolver ? 'Puede resolver autorizaciones puntuales' : 'Ya no puede resolver autorizaciones puntuales' })
    }
  }
  return cambios
}

/**
 * Guarda la matriz. Con base compartida se escribe en GitHub (y desde ahí baja a todas las
 * computadoras); sin ella, en la copia local. El control de rol lo hace además ipc.ts.
 *
 * Las asignaciones de usuarios a roles NO se pisan con lo que manda la pantalla: se editan desde
 * Usuarios y la pantalla puede tener una copia vieja (ver `resolverGuardado`).
 */
export async function guardarPermisos(datos: unknown, actor: SesionUsuario): Promise<MatrizDePermisos> {
  if (actor.rol !== 'SUPER_ADMIN') throw new ErrorDeNegocio('Los permisos los configura sólo el superadministrador.')
  const enviada = validar(datos)
  const anterior = matrizVigente()
  const resolucion = resolverGuardado(anterior, enviada)
  if ('error' in resolucion) throw new ErrorDeNegocio(resolucion.error)
  const nueva = resolucion.matriz
  if (sonIguales(anterior, nueva)) return matrizDePermisos(actor)

  if (compartida.usaBaseCompartida()) {
    // El documento vuelve con la matriz ya guardada en GitHub; la copia local se refresca al leerla.
    await compartida.guardarPermisos(actor, nueva)
  } else {
    guardarCopiaLocal(nueva, ahoraIso())
  }
  // Las otras ventanas (y la propia, si quedó abierta la pantalla) se enteran por el evento.
  avisarSiCambio(leerVigente())

  for (const cambio of cambiosParaElHistorial(anterior, nueva)) {
    registrarCambio(actor, {
      accion: 'permisos',
      tabla: 'configuracion',
      campo: cambio.campo,
      valorAnterior: null,
      valorNuevo: cambio.texto,
    })
  }
  return matrizDePermisos(actor)
}

// ---------------------------------------------------------------------------
// Roles personalizados en Administración → Usuarios
// ---------------------------------------------------------------------------

/**
 * Lo que llega del formulario de usuario trae `rolPersonalizadoId` si se eligió un rol armado por la
 * agencia. El `rol` que se guarda en el usuario pasa a ser el de la base de ese rol (todo lo que no es
 * la matriz se sigue decidiendo por él). Devuelve los datos ya corregidos y el id a asignar después.
 */
export function prepararDatosDeUsuario(datos: unknown): { datos: unknown; rolId: string | null } {
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) return { datos, rolId: null }
  const d = datos as Record<string, unknown>
  const pedido = typeof d.rolPersonalizadoId === 'string' && d.rolPersonalizadoId.trim() ? d.rolPersonalizadoId.trim() : null
  const { rolPersonalizadoId: _descartado, ...resto } = d
  void _descartado
  if (!pedido || resto.rol === 'SUPER_ADMIN') return { datos: resto, rolId: null }
  const rol = matrizVigente().personalizados.find((candidato) => candidato.id === pedido)
  if (!rol) throw new ErrorDeNegocio('El rol elegido ya no existe. Cerrá el diálogo y volvé a abrirlo.')
  return { datos: { ...resto, rol: rol.base }, rolId: rol.id }
}

/**
 * Deja asignado (o sin asignar) el rol personalizado de un usuario. `anterior` es el nombre de usuario
 * de antes de la edición: si se lo cambiaron, la asignación se mueve con él.
 */
export async function asignarRolDeUsuario(actor: SesionUsuario, usuario: string, rolId: string | null, anterior?: string): Promise<void> {
  const actual = matrizVigente()
  const clave = usuario.trim().toLowerCase()
  const previa = actual.asignaciones[clave] ?? (anterior ? actual.asignaciones[anterior.trim().toLowerCase()] : undefined) ?? null
  if (previa === rolId && (!anterior || anterior.trim().toLowerCase() === clave)) return
  if (compartida.usaBaseCompartida()) {
    await compartida.asignarRolPersonalizado(actor, usuario, rolId, anterior)
  } else {
    guardarCopiaLocal(asignarRolEnMatriz(actual, usuario, rolId, anterior), ahoraIso())
  }
  avisarSiCambio(leerVigente())
  const nombre = (id: string | null) => (id ? (actual.personalizados.find((rol) => rol.id === id)?.nombre ?? id) : 'ninguno')
  registrarCambio(actor, {
    accion: 'permisos',
    tabla: 'configuracion',
    campo: `Rol de ${clave}`,
    valorAnterior: nombre(previa),
    valorNuevo: nombre(rolId),
  })
}

/** Le agrega a cada usuario de la lista el rol personalizado que tiene, para que la pantalla lo muestre. */
export function conRolPersonalizado<T extends Usuario>(usuarios: T[]): T[] {
  const matriz = matrizVigente()
  return usuarios.map((usuario) => ({ ...usuario, rolPersonalizadoId: rolPersonalizadoDe(matriz, usuario.rol, usuario.usuario)?.id ?? null }))
}
