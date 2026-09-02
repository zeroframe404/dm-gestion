// Compañías aseguradoras y sus días de cobertura financiera: los días que la compañía sigue cubriendo
// al cliente después del vencimiento. Definen el amarillo y el naranja del semáforo de la planilla.
import { DIAS_COBERTURA_POR_DEFECTO } from '../../shared/semaforo'
import type { Compania, DatosDeCompania } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, normalizarTexto } from '../importacion/normalizar'
import { ErrorDeNegocio } from './errores'
import { guardarPlantillaDeAviso, plantillaDeAviso } from './plantillas'
import { enteroPositivo, texto } from './validacion'

/**
 * Días de cobertura que usa cada compañía, tomados de la propia planilla de la agencia (columna
 * «DÍAS COBERTURA FINANCIERA»). Se usan al dar de alta la compañía; después se editan desde la pantalla.
 */
const DIAS_CONOCIDOS: Record<string, number> = {
  ATM: 7,
  RIVADAVIA: 7,
  RUS: 7,
  GALENO: 7,
  EUROAMERICA: 7,
  EQUIDAD: 5,
  METROPOL: 3,
  AGROSALTA: 0,
  MERCANTIL: 0,
  NACION: 0,
  FEDERACION: 0,
  ALLIANZ: 0,
  GALICIA: 0,
  'SAN PATRICIO': 0,
}

export function diasPorDefectoDe(nombre: string): number {
  const normalizado = normalizarTexto(nombre)
  if (normalizado in DIAS_CONOCIDOS) return DIAS_CONOCIDOS[normalizado]!
  // «FEDERACION PATRONAL» es FEDERACION; «RIVADAVIA SEGUROS», RIVADAVIA.
  const primera = normalizado.split(' ')[0] ?? ''
  if (primera in DIAS_CONOCIDOS) return DIAS_CONOCIDOS[primera]!
  return DIAS_COBERTURA_POR_DEFECTO
}

/**
 * Las únicas compañías que la agencia renueva a mano, y cada cuántos meses. El resto renueva solo, así
 * que sus pólizas no tienen por qué aparecer en la bandeja de renovaciones. Se usa al dar de alta la
 * compañía; después se cambia desde Administración → Compañías.
 *
 * «RUS» es Río Uruguay Seguros: en la hoja está escrita de las dos maneras.
 */
const MESES_DE_RENOVACION_CONOCIDOS: Record<string, number> = {
  AGROSALTA: 4,
  METROPOL: 12,
  'RIO URUGUAY': 6,
  RUS: 6,
}

export function mesesDeRenovacionPorDefectoDe(nombre: string): number | null {
  const normalizado = normalizarTexto(nombre)
  if (normalizado in MESES_DE_RENOVACION_CONOCIDOS) return MESES_DE_RENOVACION_CONOCIDOS[normalizado]!
  // «AGROSALTA SEGUROS» es AGROSALTA; «RIO URUGUAY SEGUROS», RIO URUGUAY (dos palabras, por eso las dos).
  const primera = normalizado.split(' ')[0] ?? ''
  const dosPrimeras = normalizado.split(' ').slice(0, 2).join(' ')
  if (dosPrimeras in MESES_DE_RENOVACION_CONOCIDOS) return MESES_DE_RENOVACION_CONOCIDOS[dosPrimeras]!
  if (primera in MESES_DE_RENOVACION_CONOCIDOS) return MESES_DE_RENOVACION_CONOCIDOS[primera]!
  return null
}

/**
 * Da de alta las compañías que aparecen en la cartera y todavía no están en el catálogo. Se llama
 * después de cada importación y al abrir la pantalla: así el catálogo siempre refleja lo que hay.
 */
export function sincronizarCompanias(): number {
  const base = db()
  const existentes = new Set(
    (base.prepare('SELECT nombre_normalizado FROM companias').all() as Array<{ nombre_normalizado: string }>).map((f) => f.nombre_normalizado),
  )
  const enLaCartera = base
    .prepare(`SELECT compania, COUNT(*) AS total FROM polizas WHERE compania IS NOT NULL AND TRIM(compania) <> '' GROUP BY compania`)
    .all() as Array<{ compania: string; total: number }>

  const insertar = base.prepare(`
    INSERT INTO companias (nombre, nombre_normalizado, dias_cobertura_financiera, meses_renovacion, activa, creado_en, actualizado_en)
    VALUES (@nombre, @nombre_normalizado, @dias, @meses, 1, @ahora, @ahora)
    ON CONFLICT(nombre_normalizado) DO NOTHING`)

  const ahora = ahoraIso()
  let nuevas = 0
  base.transaction(() => {
    for (const fila of enLaCartera) {
      const normalizado = normalizarTexto(fila.compania)
      if (!normalizado || existentes.has(normalizado)) continue
      existentes.add(normalizado)
      insertar.run({
        nombre: fila.compania.trim(),
        nombre_normalizado: normalizado,
        dias: diasPorDefectoDe(fila.compania),
        meses: mesesDeRenovacionPorDefectoDe(fila.compania),
        ahora,
      })
      nuevas++
    }
  })()
  return nuevas
}

/**
 * Las compañías, con sus días de cobertura y sus meses de renovación.
 *
 * `conComision` en false deja el porcentaje afuera: es lo que gana la agencia y no hace falta para
 * nada del día a día. Un empleado igual necesita esta pantalla —los días de cobertura financiera son
 * los que decidieron el color de la fila que tiene delante, y saber si una compañía renueva sola o a
 * mano es la mitad de una llamada—, así que la lista se le da igual, sin ese número.
 */
export function listarCompanias(conComision = true): Compania[] {
  sincronizarCompanias()
  const filas = db()
    .prepare(
      `SELECT c.id, c.nombre, c.dias_cobertura_financiera AS dias, c.comision_porcentaje AS comision,
              c.meses_renovacion AS meses, c.activa,
              (SELECT COUNT(*) FROM polizas p WHERE p.activa = 1 AND UPPER(TRIM(p.compania)) = UPPER(TRIM(c.nombre))) AS polizas
       FROM companias c
       ORDER BY polizas DESC, c.nombre`,
    )
    .all() as Array<{ id: number; nombre: string; dias: number; comision: number; meses: number | null; activa: number; polizas: number }>
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    diasCoberturaFinanciera: f.dias,
    comisionPorcentaje: conComision ? f.comision : null,
    mesesRenovacion: f.meses,
    activa: f.activa === 1,
    polizas: f.polizas,
  }))
}

/**
 * Cada cuántos meses renueva cada compañía, por nombre normalizado. Sólo están las que se renuevan a
 * mano: una compañía que no figura acá renueva sola y no va a la bandeja de renovaciones.
 */
export function mesesDeRenovacionPorCompania(): Record<string, number> {
  const filas = db()
    .prepare('SELECT nombre_normalizado, meses_renovacion AS meses FROM companias WHERE meses_renovacion IS NOT NULL')
    .all() as Array<{ nombre_normalizado: string; meses: number }>
  return Object.fromEntries(filas.map((f) => [f.nombre_normalizado, f.meses]))
}

/** Porcentaje de comisión por nombre normalizado, para calcular la rendición sin ir por fila. */
export function comisionPorCompania(): Record<string, number> {
  const filas = db().prepare('SELECT nombre_normalizado, comision_porcentaje AS comision FROM companias').all() as Array<{
    nombre_normalizado: string
    comision: number
  }>
  return Object.fromEntries(filas.map((f) => [f.nombre_normalizado, f.comision]))
}

/** Días de cobertura por nombre normalizado, para calcular el semáforo sin ir a la base por fila. */
export function diasCoberturaPorCompania(): Record<string, number> {
  const filas = db().prepare('SELECT nombre_normalizado, dias_cobertura_financiera AS dias FROM companias').all() as Array<{
    nombre_normalizado: string
    dias: number
  }>
  return Object.fromEntries(filas.map((f) => [f.nombre_normalizado, f.dias]))
}

export function editarCompania(id: number, datos: DatosDeCompania): Compania {
  const identificador = enteroPositivo(id, 'La compañía')
  const nombre = texto(datos.nombre, 'El nombre de la compañía', 1, 120)
  const dias = Number(datos.diasCoberturaFinanciera)
  if (!Number.isInteger(dias) || dias < 0 || dias > 365) {
    throw new ErrorDeNegocio('Los días de cobertura financiera tienen que ser un número entero entre 0 y 365.')
  }
  const comision = Number(datos.comisionPorcentaje)
  if (!Number.isFinite(comision) || comision < 0 || comision > 100) {
    throw new ErrorDeNegocio('El porcentaje de comisión tiene que ser un número entre 0 y 100.')
  }
  // Vacío (null) es «renueva sola»: no es lo mismo que cero, que no querría decir nada.
  const meses = datos.mesesRenovacion === null || datos.mesesRenovacion === undefined ? null : Number(datos.mesesRenovacion)
  if (meses !== null && (!Number.isInteger(meses) || meses < 1 || meses > 60)) {
    throw new ErrorDeNegocio('Los meses entre renovaciones tienen que ser un número entero entre 1 y 60, o quedar vacíos si la compañía renueva sola.')
  }
  const normalizado = normalizarTexto(nombre)
  const otra = db().prepare('SELECT id FROM companias WHERE nombre_normalizado = ? AND id <> ?').get(normalizado, identificador) as
    | { id: number }
    | undefined
  if (otra) throw new ErrorDeNegocio(`Ya hay otra compañía cargada como «${nombre}».`)

  const cambios = db()
    .prepare(
      `UPDATE companias SET nombre = ?, nombre_normalizado = ?, dias_cobertura_financiera = ?, comision_porcentaje = ?,
                           meses_renovacion = ?, activa = ?, actualizado_en = ? WHERE id = ?`,
    )
    .run(nombre, normalizado, dias, Math.round(comision * 100) / 100, meses, datos.activa ? 1 : 0, ahoraIso(), identificador).changes
  if (cambios === 0) throw new ErrorDeNegocio('No se encontró esa compañía.')

  const actualizada = listarCompanias().find((c) => c.id === identificador)
  if (!actualizada) throw new ErrorDeNegocio('No se encontró esa compañía.')
  return actualizada
}

// ---------------------------------------------------------------------------
// Lo que viaja al resto de las computadoras
// ---------------------------------------------------------------------------

/**
 * El catálogo de compañías, listo para publicar.
 *
 * Por qué viaja. Los días de cobertura financiera son los que pintan de amarillo o de naranja la fila
 * que el mostrador tiene delante, y los meses de renovación deciden qué pólizas entran en la bandeja.
 * Cargados máquina por máquina, dos sucursales podían ver la misma póliza de dos colores distintos y
 * discutir cuál tenía razón. Ahora los toca un administrador y valen para todas.
 *
 * Qué NO viaja: el `id` (es de cada base) ni la cantidad de pólizas (se cuenta en cada una). El nombre
 * normalizado es la clave con la que se cruzan las dos puntas, y por eso las filas van ordenadas por
 * él: la huella es el hash del JSON y tiene que salir igual en las cinco computadoras.
 */
export function valorCompartidoDeCompanias(): {
  version: number
  companias: Array<{
    nombre: string
    nombreNormalizado: string
    diasCoberturaFinanciera: number
    comisionPorcentaje: number
    mesesRenovacion: number | null
    activa: boolean
  }>
  plantillaAviso: string
} | null {
  const filas = db()
    .prepare(
      `SELECT nombre, nombre_normalizado AS normalizado, dias_cobertura_financiera AS dias,
              comision_porcentaje AS comision, meses_renovacion AS meses, activa
       FROM companias ORDER BY nombre_normalizado`,
    )
    .all() as Array<{ nombre: string; normalizado: string; dias: number; comision: number; meses: number | null; activa: number }>
  if (filas.length === 0) return null
  return {
    version: 1,
    companias: filas.map((f) => ({
      nombre: f.nombre,
      nombreNormalizado: f.normalizado,
      diasCoberturaFinanciera: f.dias,
      comisionPorcentaje: f.comision,
      mesesRenovacion: f.meses,
      activa: f.activa === 1,
    })),
    plantillaAviso: plantillaDeAviso(),
  }
}

/**
 * Adopta el catálogo que publicó un administrador.
 *
 * Se cruza por `nombreNormalizado`, que es único en la tabla: una compañía que acá todavía no existía
 * se da de alta, y una que existe se actualiza. Las que hay acá y no vinieron NO se tocan: pueden ser
 * de una póliza que esta sucursal cargó hoy y todavía no viajó, y borrarlas dejaría esas filas sin
 * días de cobertura. `sincronizarCompanias()` ya se encarga de que aparezcan solas.
 */
export function adoptarCompanias(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object') return false
  const v = valor as { version?: unknown; companias?: unknown; plantillaAviso?: unknown }
  // Una versión más nueva no se adopta a medias: esta computadora no sabe qué significa.
  if (v.version !== undefined && v.version !== 1) return false
  if (!Array.isArray(v.companias)) return false

  const insertar = db().prepare(
    `INSERT INTO companias (nombre, nombre_normalizado, dias_cobertura_financiera, comision_porcentaje,
                            meses_renovacion, activa, creado_en, actualizado_en)
     VALUES (@nombre, @normalizado, @dias, @comision, @meses, @activa, @ahora, @ahora)
     ON CONFLICT(nombre_normalizado) DO UPDATE SET
       nombre = excluded.nombre,
       dias_cobertura_financiera = excluded.dias_cobertura_financiera,
       comision_porcentaje = excluded.comision_porcentaje,
       meses_renovacion = excluded.meses_renovacion,
       activa = excluded.activa,
       actualizado_en = excluded.actualizado_en`,
  )
  const ahora = ahoraIso()
  let escritas = 0
  db().transaction(() => {
    for (const cruda of v.companias as unknown[]) {
      if (!cruda || typeof cruda !== 'object') continue
      const c = cruda as Record<string, unknown>
      const nombre = typeof c.nombre === 'string' ? c.nombre.trim() : ''
      if (!nombre) continue
      const normalizado = typeof c.nombreNormalizado === 'string' && c.nombreNormalizado.trim() ? c.nombreNormalizado.trim() : normalizarTexto(nombre)
      const dias = Number(c.diasCoberturaFinanciera)
      const comision = Number(c.comisionPorcentaje)
      const meses = c.mesesRenovacion === null || c.mesesRenovacion === undefined ? null : Number(c.mesesRenovacion)
      // Una fila con un número imposible se saltea sola en vez de llevarse puesta la adopción entera.
      if (!Number.isInteger(dias) || dias < 0 || dias > 365) continue
      if (!Number.isFinite(comision) || comision < 0 || comision > 100) continue
      if (meses !== null && (!Number.isInteger(meses) || meses < 1 || meses > 60)) continue
      insertar.run({ nombre, normalizado, dias, comision, meses, activa: c.activa === false ? 0 : 1, ahora })
      escritas++
    }
    if (typeof v.plantillaAviso === 'string' && v.plantillaAviso.trim()) {
      guardarPlantillaDeAviso(v.plantillaAviso)
    }
  })()
  return escritas > 0
}
