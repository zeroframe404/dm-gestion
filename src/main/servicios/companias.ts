// Compañías aseguradoras y sus días de cobertura financiera: los días que la compañía sigue cubriendo
// al cliente después del vencimiento. Definen el amarillo y el naranja del semáforo de la planilla.
import { DIAS_COBERTURA_POR_DEFECTO } from '../../shared/semaforo'
import type { Compania, DatosDeCompania } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, normalizarTexto } from '../importacion/normalizar'
import { ErrorDeNegocio } from './errores'
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
    INSERT INTO companias (nombre, nombre_normalizado, dias_cobertura_financiera, activa, creado_en, actualizado_en)
    VALUES (@nombre, @nombre_normalizado, @dias, 1, @ahora, @ahora)
    ON CONFLICT(nombre_normalizado) DO NOTHING`)

  const ahora = ahoraIso()
  let nuevas = 0
  base.transaction(() => {
    for (const fila of enLaCartera) {
      const normalizado = normalizarTexto(fila.compania)
      if (!normalizado || existentes.has(normalizado)) continue
      existentes.add(normalizado)
      insertar.run({ nombre: fila.compania.trim(), nombre_normalizado: normalizado, dias: diasPorDefectoDe(fila.compania), ahora })
      nuevas++
    }
  })()
  return nuevas
}

export function listarCompanias(): Compania[] {
  sincronizarCompanias()
  const filas = db()
    .prepare(
      `SELECT c.id, c.nombre, c.dias_cobertura_financiera AS dias, c.comision_porcentaje AS comision, c.activa,
              (SELECT COUNT(*) FROM polizas p WHERE p.activa = 1 AND UPPER(TRIM(p.compania)) = UPPER(TRIM(c.nombre))) AS polizas
       FROM companias c
       ORDER BY polizas DESC, c.nombre`,
    )
    .all() as Array<{ id: number; nombre: string; dias: number; comision: number; activa: number; polizas: number }>
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    diasCoberturaFinanciera: f.dias,
    comisionPorcentaje: f.comision,
    activa: f.activa === 1,
    polizas: f.polizas,
  }))
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
  const normalizado = normalizarTexto(nombre)
  const otra = db().prepare('SELECT id FROM companias WHERE nombre_normalizado = ? AND id <> ?').get(normalizado, identificador) as
    | { id: number }
    | undefined
  if (otra) throw new ErrorDeNegocio(`Ya hay otra compañía cargada como «${nombre}».`)

  const cambios = db()
    .prepare(
      `UPDATE companias SET nombre = ?, nombre_normalizado = ?, dias_cobertura_financiera = ?, comision_porcentaje = ?, activa = ?, actualizado_en = ? WHERE id = ?`,
    )
    .run(nombre, normalizado, dias, Math.round(comision * 100) / 100, datos.activa ? 1 : 0, ahoraIso(), identificador).changes
  if (cambios === 0) throw new ErrorDeNegocio('No se encontró esa compañía.')

  const actualizada = listarCompanias().find((c) => c.id === identificador)
  if (!actualizada) throw new ErrorDeNegocio('No se encontró esa compañía.')
  return actualizada
}
