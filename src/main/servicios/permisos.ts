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
import {
  alcanza,
  esArea,
  nivelDe,
  normalizarMatriz,
  permisosDelRol,
  resumenDeCambios,
  ROLES_CONFIGURABLES,
  sonIguales,
  veLosNumerosDeLaAgencia,
  type Area,
  type MatrizPermisos,
  type Nivel,
} from '../../shared/permisos'
import type { MatrizDePermisos, MisPermisos, SesionUsuario } from '../../shared/tipos'
import { ahoraIso } from '../importacion/normalizar'
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

export function nivelDelActor(actor: SesionUsuario, area: Area): Nivel {
  return nivelDe(matrizVigente(), actor.rol, area)
}

export function puedeVer(actor: SesionUsuario, area: Area): boolean {
  return alcanza(nivelDelActor(actor, area), 'ver')
}

export function puedeEditar(actor: SesionUsuario, area: Area): boolean {
  return alcanza(nivelDelActor(actor, area), 'editar')
}

export function misPermisos(actor: SesionUsuario): MisPermisos {
  return {
    rol: actor.rol,
    areas: permisosDelRol(matrizVigente(), actor.rol),
    veNumerosDeLaAgencia: veLosNumerosDeLaAgencia(actor.rol),
  }
}

// ---------------------------------------------------------------------------
// Lo que usan los manejadores de ipc.ts
// ---------------------------------------------------------------------------

const NOMBRE_MODULO: Record<Area, string> = {
  cartera: 'Cartera',
  clientes: 'Clientes',
  leads: 'Leads',
  presupuestos: 'Presupuestos',
  polizas: 'Pólizas',
  renovaciones: 'Renovaciones',
  siniestros: 'Siniestros',
  cobranzas: 'Cobranzas',
  metricas: 'Métricas',
  reportes: 'Reportes',
  marketing: 'Marketing',
  tareas: 'Tareas',
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
 */
function exigir(minimo: Nivel, areas: Area[]): SesionUsuario {
  const actor = exigirSesion()
  const matriz = matrizVigente()
  if (!areas.some((area) => alcanza(nivelDe(matriz, actor.rol, area), minimo))) negar(areas, minimo)
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

/**
 * Guarda la matriz. Con base compartida se escribe en GitHub (y desde ahí baja a todas las
 * computadoras); sin ella, en la copia local. El control de rol lo hace además ipc.ts.
 */
export async function guardarPermisos(datos: unknown, actor: SesionUsuario): Promise<MatrizDePermisos> {
  if (actor.rol !== 'SUPER_ADMIN') throw new ErrorDeNegocio('Los permisos los configura sólo el superadministrador.')
  const nueva = validar(datos)
  const anterior = matrizVigente()
  if (sonIguales(anterior, nueva)) return matrizDePermisos(actor)

  if (compartida.usaBaseCompartida()) {
    // El documento vuelve con la matriz ya guardada en GitHub; la copia local se refresca al leerla.
    await compartida.guardarPermisos(actor, nueva)
  } else {
    guardarCopiaLocal(nueva, ahoraIso())
  }
  // Las otras ventanas (y la propia, si quedó abierta la pantalla) se enteran por el evento.
  avisarSiCambio(leerVigente())

  for (const rol of ROLES_CONFIGURABLES) {
    const resumen = resumenDeCambios(anterior[rol], nueva[rol])
    if (!resumen) continue
    registrarCambio(actor, {
      accion: 'permisos',
      tabla: 'configuracion',
      campo: `Permisos de ${rol}`,
      valorAnterior: null,
      valorNuevo: resumen,
    })
  }
  return matrizDePermisos(actor)
}
