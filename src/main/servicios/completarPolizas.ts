// Las pólizas activas a las que les falta la cobertura o alguna vigencia se completan con lo que ESTA
// computadora ya sabe de ellas, sin pedirle nada a la base (15.10.4).
//
// Por qué existe: hasta la 15.10.2 el cierre de mes dejaba la planilla nueva sin COBERTURA ni
// VIGENCIAS, y la importación —que toma la planilla más nueva como la que define cada póliza— pisaba
// todo con vacío. La 15.10.3 arregló las dos puntas y rellena desde las planillas viejas, pero sólo en
// una importación COMPLETA que las lea; mientras tanto la cartera seguía en blanco, con los datos a
// la vista en tres lugares de esta misma computadora:
//
//  1. El historial: cada edición hecha en la aplicación quedó anotada con su valor nuevo.
//  2. La cola de cambios sin subir: lo editado que todavía no viajó lleva el valor adentro.
//  3. Las filas crudas de los meses anteriores: la copia local de cada planilla, con sus celdas.
//
// Lo que anotó la aplicación (1 y 2) manda sobre lo que dice una planilla vieja (3): si la última
// anotación de un campo es que se BORRÓ a propósito, ese campo se deja en blanco y no se vuelve a llenar
// con lo que decía un mes anterior. Sin esa regla, borrar una cobertura duraría hasta el próximo
// arranque.
//
// Y para que la recuperación no quede sólo acá: lo que la póliza sabe y la fila del mes abierto no
// tiene se encola hacia la base, igual que si alguien lo hubiera vuelto a escribir en la ficha. Así la
// planilla del mes queda completa y las otras computadoras lo reciben por la bajada de siempre.
import { db } from '../db/base'
import { resolverCampo, type Campo } from '../importacion/encabezados'
import { ahoraIso, interpretarFecha, limpiar } from '../importacion/normalizar'
import { anotarEvento, encolar } from '../sincronizacion/cola'
import { periodosDisponibles } from './cartera'

type CampoACompletar = 'cobertura' | 'vigencia_desde' | 'vigencia_hasta'
const CAMPOS: CampoACompletar[] = ['cobertura', 'vigencia_desde', 'vigencia_hasta']

/** Cómo rotula cada campo el historial. `editarPoliza` escribe «COBERTURA»; la planilla, «cobertura». */
const ETIQUETA: Record<CampoACompletar, string> = { cobertura: 'COBERTURA', vigencia_desde: 'DESDE', vigencia_hasta: 'HASTA' }
const CAMPO_POR_ETIQUETA: Record<string, CampoACompletar> = {
  COBERTURA: 'cobertura',
  cobertura: 'cobertura',
  DESDE: 'vigencia_desde',
  HASTA: 'vigencia_hasta',
}

const FIRMA = 'Reparación automática'

interface PolizaIncompleta {
  id: number
  fila_id: string | null
  cobertura: string | null
  vigencia_desde: string | null
  vigencia_hasta: string | null
}

/** Lo último que la aplicación anotó de un campo: el valor, o '' si lo borraron a propósito. */
interface Anotacion {
  fecha: string
  valor: string
}

type Anotaciones = Map<number, Partial<Record<CampoACompletar, Anotacion>>>

export interface ResultadoDeCompletar {
  /** Pólizas a las que se les completó al menos un campo. */
  completadas: number
  /** Filas del mes abierto que se mandaron a la base con lo que les faltaba. */
  encoladas: number
}

/**
 * Las vigencias como fecha, con la misma regla que quien las escribió: lo que anotó la aplicación se
 * interpreta con el año de hoy (como `editarPoliza`); lo que viene de una planilla, con el año de su
 * período (como la importación). Para HASTA se corre un año la ventana, porque una vigencia que termina
 * el año que viene es lo normal.
 */
function aIso(campo: CampoACompletar, valor: string, anioBase: number): string | null {
  if (campo === 'cobertura') return null
  const anioActual = new Date().getFullYear()
  return interpretarFecha(valor, anioBase, campo === 'vigencia_hasta' ? anioActual + 1 : anioActual).iso
}

function anotar(anotaciones: Anotaciones, polizaId: number, campo: CampoACompletar, fecha: string, valor: string): void {
  const dePoliza = anotaciones.get(polizaId) ?? {}
  const previa = dePoliza[campo]
  // Manda la más nueva. A igual fecha (la cola y el historial se escriben en el mismo instante), la
  // que llegó última, que es el mismo valor.
  if (previa && previa.fecha > fecha) return
  dePoliza[campo] = { fecha, valor }
  anotaciones.set(polizaId, dePoliza)
}

/**
 * Lo que la aplicación anotó de cada póliza incompleta: las ediciones del historial (incluida la
 * renovación, que deja las vigencias nuevas en su descripción) y la cola de cambios sin subir.
 */
function anotacionesDeLaApp(incompletas: PolizaIncompleta[]): Anotaciones {
  const anotaciones: Anotaciones = new Map()
  const ids = new Set(incompletas.map((p) => p.id))

  const historial = db()
    .prepare(
      `SELECT registro_id, campo, valor_nuevo, fecha FROM historial
        WHERE tabla = 'polizas' AND registro_id IS NOT NULL
          AND campo IN ('COBERTURA', 'cobertura', 'DESDE', 'HASTA', 'RENOVACIÓN')
        ORDER BY id`,
    )
    .all() as Array<{ registro_id: number; campo: string; valor_nuevo: string | null; fecha: string }>
  for (const fila of historial) {
    if (!ids.has(fila.registro_id)) continue
    if (fila.campo === 'RENOVACIÓN') {
      // «8501151 · 7/11/2026 a 7/3/2027 · la anterior queda en …»: las vigencias de la póliza nueva.
      const vigencias = /^(.+?) a (.+?)$/.exec(limpiar(fila.valor_nuevo).split(' · ')[1] ?? '')
      if (!vigencias) continue
      if (vigencias[1] && vigencias[1] !== '?') anotar(anotaciones, fila.registro_id, 'vigencia_desde', fila.fecha, vigencias[1])
      if (vigencias[2] && vigencias[2] !== '?') anotar(anotaciones, fila.registro_id, 'vigencia_hasta', fila.fecha, vigencias[2])
      continue
    }
    const campo = CAMPO_POR_ETIQUETA[fila.campo]
    if (campo) anotar(anotaciones, fila.registro_id, campo, fila.fecha, limpiar(fila.valor_nuevo))
  }

  // La cola: por la fila de la cuota (es donde `editarPoliza` encola) o por la fila propia de la póliza.
  const polizaPorFila = new Map<string, number>()
  for (const p of incompletas) if (p.fila_id) polizaPorFila.set(p.fila_id, p.id)
  const cuotas = db()
    .prepare(`SELECT fila_id, poliza_id FROM cuotas_mes WHERE poliza_id IS NOT NULL`)
    .all() as Array<{ fila_id: string; poliza_id: number }>
  for (const c of cuotas) if (ids.has(c.poliza_id)) polizaPorFila.set(c.fila_id, c.poliza_id)

  for (const entrada of entradasSinSubir()) {
    const polizaId = polizaPorFila.get(entrada.fila_id)
    if (polizaId === undefined) continue
    for (const campo of CAMPOS) {
      if (!(campo in entrada.campos)) continue
      const valor = limpiar(entrada.campos[campo])
      // Un «crear» (el cierre de mes, un alta) lleva vacío lo que la póliza no tenía en ese momento: eso
      // no es un borrado. Un «actualizar» con vacío sí lo es: alguien lo borró desde la ficha.
      if (!valor && entrada.operacion !== 'actualizar') continue
      anotar(anotaciones, polizaId, campo, entrada.creado_en, valor)
    }
  }
  return anotaciones
}

interface EntradaSinSubir {
  fila_id: string
  pestana: string
  operacion: string
  creado_en: string
  campos: Partial<Record<Campo, string>>
}

function entradasSinSubir(): EntradaSinSubir[] {
  const filas = db()
    .prepare(
      `SELECT fila_id, pestana, operacion, creado_en, campos_json FROM cola_sync
        WHERE estado IN ('pendiente', 'fallido') AND operacion IN ('actualizar', 'crear') ORDER BY id`,
    )
    .all() as Array<{ fila_id: string; pestana: string; operacion: string; creado_en: string; campos_json: string }>
  return filas.map((f) => {
    let campos: Partial<Record<Campo, string>> = {}
    try {
      campos = JSON.parse(f.campos_json) as Partial<Record<Campo, string>>
    } catch {
      campos = {}
    }
    return { fila_id: f.fila_id, pestana: f.pestana, operacion: f.operacion, creado_en: f.creado_en, campos }
  })
}

/**
 * Qué encabezado de esa pestaña guarda cada campo, resuelto con el mismo criterio que la importación
 * (`resolverCampo`), así «COBERTURA», «COB» o «TIPO DE COBERTURA» caen todos en el mismo lugar. Se arma
 * una vez por pestaña: los encabezados son los mismos en todas sus filas.
 */
class Encabezados {
  private porPestana = new Map<string, Partial<Record<CampoACompletar, string>>>()

  valor(pestana: string, datos: Record<string, string>, campo: CampoACompletar): string {
    let mapa = this.porPestana.get(pestana)
    if (!mapa || !(campo in mapa)) {
      mapa = mapa ?? {}
      for (const encabezado of Object.keys(datos)) {
        const resuelto = resolverCampo(encabezado, 'MENSUAL')
        if (resuelto && (CAMPOS as string[]).includes(resuelto) && !(resuelto in mapa)) mapa[resuelto as CampoACompletar] = encabezado
      }
      this.porPestana.set(pestana, mapa)
    }
    const encabezado = mapa[campo]
    return encabezado === undefined ? '' : limpiar(datos[encabezado])
  }
}

function leerDatos(json: string | null): Record<string, string> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, string>
  } catch {
    return {}
  }
}

/**
 * Completa la cobertura y las vigencias que faltan en las pólizas activas con lo que esta computadora
 * ya sabe (ver el encabezado del archivo), y manda a la base lo que la fila del mes abierto no tiene.
 * Es local, idempotente y barato: corre al arrancar y después de cada importación.
 */
export function completarPolizasSinCoberturaNiVigencias(): ResultadoDeCompletar {
  const base = db()
  const ahora = ahoraIso()
  const anioActual = new Date().getFullYear()
  const encabezados = new Encabezados()

  const incompletas = base
    .prepare(
      `SELECT id, fila_id, cobertura, vigencia_desde, vigencia_hasta FROM polizas
        WHERE activa = 1 AND (cobertura IS NULL OR vigencia_desde IS NULL OR vigencia_hasta IS NULL)`,
    )
    .all() as PolizaIncompleta[]

  const anotaciones = incompletas.length > 0 ? anotacionesDeLaApp(incompletas) : new Map()
  const filasCrudasDe = base.prepare(
    `SELECT c.periodo, f.pestana, f.datos_json FROM cuotas_mes c JOIN filas_crudas f ON f.fila_id = c.fila_id
      WHERE c.poliza_id = ? ORDER BY c.periodo DESC, c.id DESC`,
  )
  const anotarEnHistorial = base.prepare(
    `INSERT INTO historial (fecha, usuario_id, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo)
       VALUES (?, NULL, ?, 'edicion', 'polizas', ?, ?, ?, NULL, ?)`,
  )

  let completadas = 0
  const porCampo: Record<CampoACompletar, number> = { cobertura: 0, vigencia_desde: 0, vigencia_hasta: 0 }

  base.transaction(() => {
    for (const poliza of incompletas) {
      const faltantes = CAMPOS.filter((campo) => poliza[campo] === null)
      const nuevos: Partial<Record<CampoACompletar, { valor: string; iso: string | null }>> = {}
      const deLaApp = anotaciones.get(poliza.id) ?? {}
      const paraLasPlanillas: CampoACompletar[] = []
      for (const campo of faltantes) {
        const anotacion = deLaApp[campo]
        if (anotacion) {
          // Con valor se toma; borrado a propósito, se respeta y no se mira ninguna planilla.
          if (anotacion.valor) nuevos[campo] = { valor: anotacion.valor, iso: aIso(campo, anotacion.valor, anioActual) }
          continue
        }
        paraLasPlanillas.push(campo)
      }
      if (paraLasPlanillas.length > 0) {
        // De la planilla más nueva a la más vieja: la primera que lo tenga, como hace la importación.
        const crudas = filasCrudasDe.all(poliza.id) as Array<{ periodo: string; pestana: string; datos_json: string }>
        for (const cruda of crudas) {
          const pendientes = paraLasPlanillas.filter((campo) => !(campo in nuevos))
          if (pendientes.length === 0) break
          const datos = leerDatos(cruda.datos_json)
          const anioBase = /^\d{4}-\d{2}$/.test(cruda.periodo) ? Number(cruda.periodo.slice(0, 4)) : anioActual
          for (const campo of pendientes) {
            const valor = encabezados.valor(cruda.pestana, datos, campo)
            if (valor) nuevos[campo] = { valor, iso: aIso(campo, valor, anioBase) }
          }
        }
      }

      const campos = Object.keys(nuevos) as CampoACompletar[]
      if (campos.length === 0) continue
      const asignaciones: string[] = []
      const valores: Record<string, unknown> = { id: poliza.id, ahora }
      for (const campo of campos) {
        const nuevo = nuevos[campo]!
        asignaciones.push(`${campo} = @${campo}`)
        valores[campo] = nuevo.valor
        if (campo !== 'cobertura') {
          asignaciones.push(`${campo}_iso = @${campo}_iso`)
          valores[`${campo}_iso`] = nuevo.iso
        }
        anotarEnHistorial.run(ahora, FIRMA, poliza.id, poliza.fila_id, ETIQUETA[campo], nuevo.valor)
        porCampo[campo]++
      }
      base.prepare(`UPDATE polizas SET ${asignaciones.join(', ')}, actualizado_en = @ahora WHERE id = @id`).run(valores)
      completadas++
    }
  })()

  const encoladas = mandarALaPlanillaDelMes(encabezados)

  if (completadas > 0 || encoladas > 0) {
    const detalle = [
      porCampo.cobertura > 0 ? `${porCampo.cobertura} coberturas` : '',
      porCampo.vigencia_desde > 0 ? `${porCampo.vigencia_desde} vigencias desde` : '',
      porCampo.vigencia_hasta > 0 ? `${porCampo.vigencia_hasta} vigencias hasta` : '',
    ]
      .filter(Boolean)
      .join(', ')
    anotarEvento(
      'reparacion',
      `${completadas > 0 ? `${completadas} pólizas tenían la cobertura o las vigencias en blanco y se completaron con lo que esta computadora ya sabía de ellas (${detalle}). ` : ''}` +
        `${encoladas > 0 ? `${encoladas} filas de la planilla del mes no tenían esos datos y se mandan a la base.` : ''}`.trim(),
    )
  }
  return { completadas, encoladas }
}

/**
 * Lo que cada póliza activa sabe y su fila del mes abierto no tiene (en la copia local de la planilla)
 * se encola hacia la base, campo por campo. Es lo que el cierre de mes copia desde la 15.10.3; para un
 * mes que ya se cerró sin eso, es la forma de que la planilla y las otras computadoras lo reciban. Lo
 * que ya está esperando en la cola con el mismo valor no se vuelve a encolar.
 */
function mandarALaPlanillaDelMes(encabezados: Encabezados): number {
  const periodo = periodosDisponibles()[0]?.periodo
  if (!periodo) return 0
  const filas = db()
    .prepare(
      `SELECT p.id, p.cobertura, p.vigencia_desde, p.vigencia_hasta, c.fila_id, c.pestana, f.datos_json
         FROM polizas p
         JOIN cuotas_mes c ON c.poliza_id = p.id AND c.periodo = @periodo AND c.dada_de_baja = 0
          AND c.id = (SELECT MAX(c2.id) FROM cuotas_mes c2 WHERE c2.poliza_id = p.id AND c2.periodo = @periodo AND c2.dada_de_baja = 0)
         LEFT JOIN filas_crudas f ON f.fila_id = c.fila_id
        WHERE p.activa = 1 AND (p.cobertura IS NOT NULL OR p.vigencia_desde IS NOT NULL OR p.vigencia_hasta IS NOT NULL)`,
    )
    .all({ periodo }) as Array<{
    id: number
    cobertura: string | null
    vigencia_desde: string | null
    vigencia_hasta: string | null
    fila_id: string
    pestana: string
    datos_json: string | null
  }>
  if (filas.length === 0) return 0

  // Lo que ya espera en la cola para cada fila, para no encolar dos veces lo mismo.
  const enCola = new Map<string, Partial<Record<Campo, string>>>()
  for (const entrada of entradasSinSubir()) {
    enCola.set(entrada.fila_id, { ...(enCola.get(entrada.fila_id) ?? {}), ...entrada.campos })
  }

  let encoladas = 0
  for (const fila of filas) {
    const datos = leerDatos(fila.datos_json)
    const pendiente = enCola.get(fila.fila_id) ?? {}
    const campos: Partial<Record<Campo, string>> = {}
    for (const campo of CAMPOS) {
      const local = limpiar(fila[campo])
      if (!local) continue
      if (encabezados.valor(fila.pestana, datos, campo)) continue
      if (limpiar(pendiente[campo]) === local) continue
      campos[campo] = local
    }
    if (Object.keys(campos).length === 0) continue
    encolar({ operacion: 'actualizar', pestana: fila.pestana, filaId: fila.fila_id, campos }, null)
    encoladas++
  }
  return encoladas
}
