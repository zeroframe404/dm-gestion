// Subida: vacía la cola contra la hoja. Escribe sólo valores (nunca formatos ni colores) y agrupa todo
// en la menor cantidad posible de llamadas: una lectura de las pestañas involucradas, una escritura de
// celdas, un agregado por pestaña y un borrado por pestaña.
import type { Campo } from '../importacion/encabezados'
import type { CeldaAEscribir, FuenteHoja } from '../importacion/fuente'
import { ahoraIso, limpiar } from '../importacion/normalizar'
import { db } from '../db/base'
import { anotarEvento, marcarFallidas, marcarListas, marcarSinArreglo, pendientes, type EntradaCola } from './cola'
import { columnaDelId, filasPorId, huellaDeFila, type ContextoHoja, type PestanaSincronizable } from './hoja'

export interface ResultadoSubida {
  subidas: number
  conflictos: number
  llamadas: number
  error: string | null
}

/** Un conflicto: el mismo campo cambió acá y en la hoja desde la última bajada. */
export interface Conflicto {
  filaId: string
  pestana: string
  campo: string
  valorLocal: string
  valorRemoto: string
}

interface FilaBase {
  fila_id: string
  pestana: string
  datos_json: string
  numero_fila: number
}

function basePorFilaId(filaIds: string[]): Map<string, FilaBase> {
  if (filaIds.length === 0) return new Map()
  const marcas = filaIds.map(() => '?').join(',')
  const filas = db()
    .prepare(`SELECT fila_id, pestana, datos_json, numero_fila FROM filas_crudas WHERE fila_id IN (${marcas})`)
    .all(...filaIds) as FilaBase[]
  return new Map(filas.map((f) => [f.fila_id, f]))
}

/** Valor que la hoja tenía la última vez que la miramos, para ese campo. */
function valorBase(base: FilaBase | undefined, pestana: PestanaSincronizable, campo: Campo): string | null {
  if (!base) return null
  const columna = pestana.layout?.mapeo.porCampo.get(campo)
  if (columna === undefined || columna === null) return null
  const encabezado = pestana.layout?.mapeo.encabezados[columna] ?? ''
  if (!encabezado) return null
  const datos = JSON.parse(base.datos_json) as Record<string, string>
  return datos[encabezado] ?? null
}

/**
 * Sube una tanda. Devuelve cuántas entradas se subieron y cuántos conflictos hubo (el conflicto lo gana
 * el cambio local, que es el que todavía no se había subido; el valor que había en la hoja queda anotado
 * en el historial como «pisado por sincronización»).
 */
export async function subirTanda(fuente: FuenteHoja, contexto: ContextoHoja, limite = 200): Promise<ResultadoSubida> {
  const entradas = pendientes(limite)
  if (entradas.length === 0) return { subidas: 0, conflictos: 0, llamadas: 0, error: null }

  const titulos = [...new Set(entradas.map((e) => e.pestana))].filter((t) => contexto.porTitulo.has(t))
  const desconocidas = entradas.filter((e) => !contexto.porTitulo.has(e.pestana))
  if (desconocidas.length > 0) {
    for (const entrada of desconocidas) {
      marcarSinArreglo(
        [entrada.id],
        `La pestaña «${entrada.pestana}» no existe en la hoja. Creala en Google (podés duplicar la del mes anterior) y tocá «Volver a intentar».`,
      )
    }
  }
  if (titulos.length === 0) return { subidas: 0, conflictos: 0, llamadas: 0, error: null }

  let llamadas = 0
  const lecturas = await fuente.leerVarias(titulos)
  llamadas++
  const valoresPorTitulo = new Map(lecturas.map((l) => [l.titulo, l.valores]))

  const celdas: CeldaAEscribir[] = []
  const aAgregar = new Map<string, Array<{ entrada: EntradaCola; fila: string[] }>>()
  const aBorrar = new Map<string, { sheetId: number; filas: number[] }>()
  const conflictos: Conflicto[] = []
  const hechas: number[] = []
  const fallidas: Array<{ id: number; motivo: string }> = []

  const bases = basePorFilaId(entradas.map((e) => e.filaId))
  const columnaIdPorPestana = new Map<string, number>()

  for (const entrada of entradas) {
    const pestana = contexto.porTitulo.get(entrada.pestana)
    if (!pestana) continue
    const valores = valoresPorTitulo.get(entrada.pestana) ?? []
    const columnaId = columnaDelId(pestana, valores)
    if (columnaId !== null) columnaIdPorPestana.set(entrada.pestana, columnaId)
    if (columnaId === null) {
      fallidas.push({ id: entrada.id, motivo: `«${entrada.pestana}» no tiene columna _ID: importá la hoja de nuevo.` })
      continue
    }
    const primeraFila = (pestana.layout?.filaEncabezados ?? 0) + 2
    const filas = filasPorId(valores, columnaId, primeraFila)

    if (entrada.operacion === 'crear') {
      const fila: string[] = []
      const poner = (columna: number, valor: string) => {
        while (fila.length <= columna) fila.push('')
        fila[columna] = valor
      }
      poner(columnaId, entrada.filaId)
      for (const [campo, valor] of Object.entries(entrada.campos)) {
        if (campo === '_id') continue
        const columna = pestana.layout?.mapeo.porCampo.get(campo as Campo)
        if (columna === undefined || columna === null) continue
        poner(columna, valor ?? '')
      }
      const lista = aAgregar.get(entrada.pestana) ?? []
      lista.push({ entrada, fila })
      aAgregar.set(entrada.pestana, lista)
      continue
    }

    const numeroDeFila = filas.get(entrada.filaId)
    if (numeroDeFila === undefined) {
      // La fila ya no está en la hoja: si era un borrado, ya está hecho; si era una edición, se perdió.
      if (entrada.operacion === 'borrar') hechas.push(entrada.id)
      else fallidas.push({ id: entrada.id, motivo: 'La fila ya no está en la hoja (la borraron desde Google).' })
      continue
    }

    if (entrada.operacion === 'borrar') {
      const previo = aBorrar.get(entrada.pestana) ?? { sheetId: pestana.sheetId, filas: [] }
      previo.filas.push(numeroDeFila)
      aBorrar.set(entrada.pestana, previo)
      hechas.push(entrada.id)
      continue
    }

    // Actualizar: se comparan los valores contra lo último que sabíamos de la hoja.
    const base = bases.get(entrada.filaId)
    const celdasDeLaFila = valores[numeroDeFila - 1] ?? []
    let algoQueEscribir = false
    for (const [nombreCampo, valor] of Object.entries(entrada.campos)) {
      const nuevo = valor ?? ''
      if (nombreCampo === '_id') {
        celdas.push({ titulo: entrada.pestana, fila: numeroDeFila, columna: columnaId, valor: nuevo })
        algoQueEscribir = true
        continue
      }
      const campo = nombreCampo as Campo
      const columna = pestana.layout?.mapeo.porCampo.get(campo)
      if (columna === undefined || columna === null) continue
      const remoto = limpiar(celdasDeLaFila[columna])
      const anterior = valorBase(base, pestana, campo)
      if (anterior !== null && limpiar(anterior) !== remoto && remoto !== limpiar(nuevo)) {
        conflictos.push({ filaId: entrada.filaId, pestana: entrada.pestana, campo, valorLocal: nuevo, valorRemoto: remoto })
      }
      celdas.push({ titulo: entrada.pestana, fila: numeroDeFila, columna, valor: nuevo })
      algoQueEscribir = true
    }
    if (algoQueEscribir) hechas.push(entrada.id)
    else fallidas.push({ id: entrada.id, motivo: 'Ninguno de los campos tiene columna en esa pestaña.' })
  }

  // --- Ejecutar: escribir, agregar y recién al final borrar (borrar corre las filas de abajo).
  try {
    if (celdas.length > 0) {
      await fuente.escribirCeldas(celdas)
      llamadas++
    }
    for (const [titulo, lista] of aAgregar) {
      const primera = await fuente.agregarFilas(
        titulo,
        lista.map((x) => x.fila),
      )
      llamadas++
      lista.forEach((x, i) => {
        hechas.push(x.entrada.id)
        registrarFilaSubida(x.entrada.filaId, titulo, primera + i, x.fila, columnaIdPorPestana.get(titulo) ?? -1)
      })
    }
    for (const [, { sheetId, filas }] of aBorrar) {
      await fuente.borrarFilas(sheetId, filas)
      llamadas++
    }
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error)
    marcarFallidas(
      entradas.map((e) => e.id),
      motivo,
    )
    return { subidas: 0, conflictos: 0, llamadas, error: motivo }
  }

  // --- Dejar la base local al día con lo que quedó en la hoja.
  actualizarBaseLocal(contexto, valoresPorTitulo, entradas, celdas)
  for (const [, { filas }] of aBorrar) void filas
  marcarListas(hechas)
  for (const { id, motivo } of fallidas) marcarSinArreglo([id], motivo)
  for (const conflicto of conflictos) anotarConflicto(conflicto)

  return { subidas: hechas.length, conflictos: conflictos.length, llamadas, error: null }
}

/** Deja anotado en el historial el valor que había en la hoja y quedó pisado por el cambio local. */
function anotarConflicto(conflicto: Conflicto): void {
  db()
    .prepare(
      `INSERT INTO historial (fecha, usuario_id, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo)
       VALUES (?, NULL, 'Sincronización', 'sincronizacion', ?, NULL, ?, ?, ?, ?)`,
    )
    .run(ahoraIso(), conflicto.pestana, conflicto.filaId, `${conflicto.campo} (pisado por sincronización)`, conflicto.valorRemoto, conflicto.valorLocal)
  anotarEvento(
    'conflicto',
    `«${conflicto.campo}» de la fila ${conflicto.filaId} había cambiado en la hoja («${conflicto.valorRemoto}»): ganó el cambio de la aplicación («${conflicto.valorLocal}»).`,
  )
}

/** Una fila nueva agregada a la hoja pasa a tener su lugar y su huella en la base local. */
function registrarFilaSubida(filaId: string, pestana: string, numeroFila: number, celdas: string[], columnaId: number): void {
  db()
    .prepare(`UPDATE filas_crudas SET pestana = ?, numero_fila = ?, huella = ?, en_la_hoja = 1, actualizado_en = ? WHERE fila_id = ?`)
    .run(pestana, numeroFila, huellaDeFila(celdas, columnaId), ahoraIso(), filaId)
}

/**
 * Después de escribir, la hoja quedó con esos valores: se actualiza la copia local de la fila para que
 * el próximo ciclo no vuelva a verlos como un cambio remoto.
 */
function actualizarBaseLocal(
  contexto: ContextoHoja,
  valoresPorTitulo: Map<string, string[][]>,
  entradas: EntradaCola[],
  celdas: CeldaAEscribir[],
): void {
  const porFila = new Map<string, CeldaAEscribir[]>()
  for (const celda of celdas) {
    const clave = `${celda.titulo}|${celda.fila}`
    porFila.set(clave, [...(porFila.get(clave) ?? []), celda])
  }
  const actualizar = db().prepare(`UPDATE filas_crudas SET datos_json = ?, huella = ?, numero_fila = ?, actualizado_en = ? WHERE fila_id = ?`)
  const leer = db().prepare('SELECT fila_id, datos_json FROM filas_crudas WHERE fila_id = ?')
  const ahora = ahoraIso()

  db().transaction(() => {
    for (const entrada of entradas) {
      if (entrada.operacion !== 'actualizar') continue
      const pestana = contexto.porTitulo.get(entrada.pestana)
      const valores = valoresPorTitulo.get(entrada.pestana)
      if (!pestana || !valores) continue
      const columnaId = columnaDelId(pestana, valores)
      if (columnaId === null) continue
      const numeroDeFila = filasPorId(valores, columnaId, (pestana.layout?.filaEncabezados ?? 0) + 2).get(entrada.filaId)
      if (numeroDeFila === undefined) continue

      const celdasDeLaFila = [...(valores[numeroDeFila - 1] ?? [])]
      for (const celda of porFila.get(`${entrada.pestana}|${numeroDeFila}`) ?? []) {
        while (celdasDeLaFila.length <= celda.columna) celdasDeLaFila.push('')
        celdasDeLaFila[celda.columna] = celda.valor
      }

      const guardada = leer.get(entrada.filaId) as { datos_json: string } | undefined
      if (!guardada) continue
      const datos = JSON.parse(guardada.datos_json) as Record<string, string>
      const encabezados = pestana.layout?.mapeo.encabezados ?? []
      for (const celda of porFila.get(`${entrada.pestana}|${numeroDeFila}`) ?? []) {
        const encabezado = encabezados[celda.columna]
        if (encabezado) datos[encabezado] = celda.valor
      }
      actualizar.run(JSON.stringify(datos), huellaDeFila(celdasDeLaFila, columnaId), numeroDeFila, ahora, entrada.filaId)
    }
  })()
}
