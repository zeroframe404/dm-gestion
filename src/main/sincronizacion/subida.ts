// Subida: vacía la cola contra la hoja. Escribe sólo valores (nunca formatos ni colores) y agrupa todo
// en la menor cantidad posible de llamadas: una lectura de las pestañas involucradas, una escritura de
// celdas, un agregado por pestaña y un borrado por pestaña.
import type { Campo } from '../importacion/encabezados'
import type { CeldaAEscribir, FilaABorrar, FuenteHoja } from '../importacion/fuente'
import { ahoraIso, limpiar } from '../importacion/normalizar'
import { db } from '../db/base'
import { anotarEvento, marcarFallidas, marcarListas, marcarSinArreglo, pendientes, type EntradaCola } from './cola'
import { agregarColumnasFaltantes, refrescarLayoutSiCambio } from './columnas'
import { columnaDelId, filasPorId, huellaDeFila, type ContextoHoja, type PestanaSincronizable } from './hoja'
import { esPestanaDeLaApp, esPestanaDelMes } from './pestanasApp'

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
      // Las pestañas de la aplicación y las del mes las crea solo el motor (ver pestanasApp.ts) ANTES
      // de llegar acá. Una entrada para una de ellas que llegó igual es casi siempre una carrera: se
      // encoló mientras este mismo ciclo estaba creando pestañas o releyendo la estructura. No es un
      // error: queda esperando y el próximo ciclo (10 segundos) la crea y la sube.
      if (esPestanaDeLaApp(entrada.pestana) || esPestanaDelMes(entrada.pestana)) continue
      marcarSinArreglo([entrada.id], `La pestaña «${entrada.pestana}» no existe en la base del GENERAL DE CLIENTES.`)
    }
  }
  if (titulos.length === 0) return { subidas: 0, conflictos: 0, llamadas: 0, error: null }

  let llamadas = 0
  const lecturas = await fuente.leerVarias(titulos)
  llamadas++
  const valoresPorTitulo = new Map(lecturas.map((l) => [l.titulo, l.valores]))

  // 12.7: antes de escribir, cada pestaña gana las columnas que le falten para lo que se va a escribir.
  // Hasta la 12.6 un campo sin columna se descartaba con un aviso, y así fue como los siniestros
  // llegaron a las otras computadoras sin asegurado: la pestaña no tenía dónde guardarlo. Si otra
  // computadora ya agregó la columna, la fila de encabezados recién leída lo dice y el mapeo se rehace.
  for (const titulo of titulos) {
    const pestana = contexto.porTitulo.get(titulo)
    const valores = valoresPorTitulo.get(titulo)
    if (!pestana || !valores) continue
    refrescarLayoutSiCambio(pestana, valores)
    const necesarios = new Set<Campo>()
    for (const entrada of entradas) {
      if (entrada.pestana !== titulo || entrada.operacion === 'borrar') continue
      for (const [campo, valor] of Object.entries(entrada.campos)) {
        if (campo === '_id' || !limpiar(valor ?? '')) continue
        if (!pestana.layout?.mapeo.porCampo.has(campo as Campo)) necesarios.add(campo as Campo)
      }
    }
    if (necesarios.size === 0) continue
    const agregadas = await agregarColumnasFaltantes(fuente, pestana, valores, necesarios)
    if (agregadas.length > 0) llamadas += 2
  }

  const celdas: CeldaAEscribir[] = []
  const aAgregar = new Map<string, Array<{ entrada: EntradaCola; fila: string[] }>>()
  const aBorrar = new Map<string, { sheetId: number; columnaId: number; filas: FilaABorrar[] }>()
  const conflictos: Conflicto[] = []
  const hechas: number[] = []
  const fallidas: Array<{ id: number; motivo: string }> = []

  const bases = basePorFilaId(entradas.map((e) => e.filaId))
  const columnaIdPorPestana = new Map<string, number>()
  /**
   * Campos con valor que no se pudieron escribir porque la pestaña destino no tiene esa columna, y
   * cuántas filas los perdieron. Antes se descartaban en silencio: cerrar el mes contra una pestaña
   * duplicada a mano SIN la columna LOCAL creaba las 2.392 filas sin sucursal, la computadora que cerró
   * el mes se quedaba con el dato (lo tenía en su base) y todas las demás lo importaban en blanco.
   */
  const sinColumna = new Map<string, number>()
  const anotarSinColumna = (pestana: string, campo: string) => {
    const clave = `${pestana}\u0000${campo}`
    sinColumna.set(clave, (sinColumna.get(clave) ?? 0) + 1)
  }

  for (const entrada of entradas) {
    const pestana = contexto.porTitulo.get(entrada.pestana)
    if (!pestana) continue
    const valores = valoresPorTitulo.get(entrada.pestana) ?? []
    const columnaId = columnaDelId(pestana, valores)
    if (columnaId !== null) columnaIdPorPestana.set(entrada.pestana, columnaId)
    if (columnaId === null) {
      fallidas.push({ id: entrada.id, motivo: `«${entrada.pestana}» no tiene columna _ID: reimportá la base (Administración → Reimportar la base).` })
      continue
    }
    const primeraFila = (pestana.layout?.filaEncabezados ?? 0) + 2
    const filas = filasPorId(valores, columnaId, primeraFila)

    // Un «crear» de una fila cuyo _ID YA está en la pestaña no agrega otra: escribe sobre la que hay.
    // Pasa cuando el agregado anterior se aplicó pero la respuesta no llegó (y la entrada quedó como
    // fallida), cuando la misma baja se hizo desde dos computadoras, o cuando se vuelve a dar de baja
    // una póliza cuya fila de BAJAS nunca se llegó a sacar. Antes cada uno de esos casos dejaba dos
    // renglones con el mismo _ID, y la importación siguiente le inventaba un _ID nuevo al segundo: de
    // ahí salían las bajas duplicadas. Se escriben sólo los campos con valor, para no pisar con un
    // vacío lo que otra computadora ya haya completado (el RESULTADO de un pago, por ejemplo).
    if (entrada.operacion === 'crear' && filas.has(entrada.filaId)) {
      entrada.operacion = 'actualizar'
      entrada.campos = Object.fromEntries(Object.entries(entrada.campos).filter(([, valor]) => limpiar(valor ?? '') !== ''))
      registrarFilaSubida(entrada.filaId, entrada.pestana, filas.get(entrada.filaId)!, valores[filas.get(entrada.filaId)! - 1] ?? [], columnaId, pestana)
      if (Object.keys(entrada.campos).length === 0) {
        // No había nada con valor para escribir: la fila ya está, y con eso alcanza.
        hechas.push(entrada.id)
        continue
      }
    }

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
        if (columna === undefined || columna === null) {
          if (limpiar(valor ?? '')) anotarSinColumna(entrada.pestana, campo)
          continue
        }
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
      else fallidas.push({ id: entrada.id, motivo: 'La fila ya no está en la base (la borraron desde otra computadora).' })
      continue
    }

    if (entrada.operacion === 'borrar') {
      const previo = aBorrar.get(entrada.pestana) ?? { sheetId: pestana.sheetId, columnaId, filas: [] }
      // Número Y _ID: la base del VPS comprueba que el número siga siendo ese renglón y, si otra
      // computadora borró algo más arriba desde que se leyó, lo busca por el _ID (ver fuente.ts).
      previo.filas.push({ numero: numeroDeFila, id: entrada.filaId })
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
        celdas.push({ titulo: entrada.pestana, fila: numeroDeFila, columna: columnaId, valor: nuevo, id: entrada.filaId })
        algoQueEscribir = true
        continue
      }
      const campo = nombreCampo as Campo
      const columna = pestana.layout?.mapeo.porCampo.get(campo)
      if (columna === undefined || columna === null) {
        if (limpiar(nuevo)) anotarSinColumna(entrada.pestana, nombreCampo)
        continue
      }
      const remoto = limpiar(celdasDeLaFila[columna])
      const anterior = valorBase(base, pestana, campo)
      if (anterior !== null && limpiar(anterior) !== remoto && remoto !== limpiar(nuevo)) {
        conflictos.push({ filaId: entrada.filaId, pestana: entrada.pestana, campo, valorLocal: nuevo, valorRemoto: remoto })
      }
      celdas.push({ titulo: entrada.pestana, fila: numeroDeFila, columna, valor: nuevo, id: entrada.filaId })
      algoQueEscribir = true
    }
    if (algoQueEscribir) hechas.push(entrada.id)
    else fallidas.push({ id: entrada.id, motivo: 'Ninguno de los campos tiene columna en esa pestaña.' })
  }

  // --- Ejecutar: escribir, agregar y recién al final borrar (borrar corre las filas de abajo).
  // Los renglones que la base dice que ya no están (los borró otra computadora entre la lectura de
  // arriba y esta escritura): sus celdas no se escribieron en ningún lado y sus entradas no se dan por
  // subidas. Hasta la 12.5 esa celda creaba una fila fantasma al final de la pestaña.
  const perdidas = new Set<string>()
  try {
    if (celdas.length > 0) {
      const resultado = await fuente.escribirCeldas(celdas, Object.fromEntries(columnaIdPorPestana))
      llamadas++
      for (const fila of resultado.noEncontradas) perdidas.add(`${fila.titulo}|${fila.id}`)
    }
    for (const [titulo, lista] of aAgregar) {
      const { numeros } = await fuente.agregarFilas(
        titulo,
        lista.map((x) => x.fila),
      )
      llamadas++
      lista.forEach((x, i) => {
        hechas.push(x.entrada.id)
        const numero = numeros[i] ?? null
        // Un null es una fila cuyo _ID ya estaba en la pestaña (el reintento de un agregado que sí se
        // había aplicado): ya está donde tiene que estar y la próxima bajada anota en qué renglón.
        if (numero !== null) registrarFilaSubida(x.entrada.filaId, titulo, numero, x.fila, columnaIdPorPestana.get(titulo) ?? -1, contexto.porTitulo.get(titulo))
        else registrarFilaYaEnLaHoja(x.entrada.filaId, titulo)
      })
    }
    for (const [, { sheetId, columnaId, filas }] of aBorrar) {
      // Un _ID que la base ya no tiene no borra nada en su lugar: el borrado ya estaba hecho.
      await fuente.borrarFilas(sheetId, filas, columnaId)
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

  const celdasEscritas = celdas.filter((celda) => !perdidas.has(`${celda.titulo}|${celda.id ?? ''}`))
  const entradasEscritas = entradas.filter((entrada) => {
    if (entrada.operacion !== 'actualizar' || !perdidas.has(`${entrada.pestana}|${entrada.filaId}`)) return true
    const posicion = hechas.indexOf(entrada.id)
    if (posicion >= 0) hechas.splice(posicion, 1)
    fallidas.push({ id: entrada.id, motivo: 'La fila ya no está en la base (la borraron desde otra computadora).' })
    return false
  })

  // --- Dejar la base local al día con lo que quedó en la hoja.
  actualizarBaseLocal(contexto, valoresPorTitulo, entradasEscritas, celdasEscritas)
  marcarListas(hechas)
  for (const { id, motivo } of fallidas) marcarSinArreglo([id], motivo)
  for (const conflicto of conflictos) anotarConflicto(conflicto)
  for (const [clave, filas] of sinColumna) {
    const [pestana, campo] = clave.split('\u0000')
    anotarEvento(
      'columna faltante',
      `La pestaña «${pestana}» no tiene columna para «${campo}»: ${filas} fila(s) se escribieron sin ese dato. ` +
        'Reimportá la base (Administración → Reimportar la base) para que la pestaña gane la columna.',
      { filas, conError: true },
    )
  }

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
    `«${conflicto.campo}» de la fila ${conflicto.filaId} había cambiado en la base («${conflicto.valorRemoto}»): ganó el cambio de la aplicación («${conflicto.valorLocal}»).`,
  )
}

/**
 * Una fila nueva agregada a la hoja pasa a tener su lugar, su huella y sus datos crudos en la base
 * local. Los datos crudos (12.7) son lo que la hoja tiene de esa fila, encabezado por encabezado: es
 * con lo que después se sabe qué campos quedaron sin viajar (ver `reenviarSiniestrosIncompletos`).
 * Hasta la 12.6 quedaban en «{}» para siempre, porque la bajada nunca vuelve a leer una fila cuya
 * huella no cambió.
 */
function registrarFilaSubida(filaId: string, pestana: string, numeroFila: number, celdas: string[], columnaId: number, layoutDe?: PestanaSincronizable): void {
  const encabezados = layoutDe?.layout?.mapeo.encabezados ?? []
  const datos: Record<string, string> = {}
  encabezados.forEach((encabezado, i) => {
    if (encabezado && i !== columnaId) datos[encabezado] = limpiar(celdas[i])
  })
  db()
    .prepare(
      `UPDATE filas_crudas SET pestana = ?, numero_fila = ?, huella = ?, en_la_hoja = 1, actualizado_en = ?,
              datos_json = CASE WHEN ? = 1 THEN ? ELSE datos_json END
       WHERE fila_id = ?`,
    )
    .run(pestana, numeroFila, huellaDeFila(celdas, columnaId), ahoraIso(), encabezados.length > 0 ? 1 : 0, JSON.stringify(datos), filaId)
}

/** La fila ya estaba en la pestaña con ese _ID: se anota que está, sin inventarle un renglón. */
function registrarFilaYaEnLaHoja(filaId: string, pestana: string): void {
  db().prepare(`UPDATE filas_crudas SET pestana = ?, en_la_hoja = 1, actualizado_en = ? WHERE fila_id = ?`).run(pestana, ahoraIso(), filaId)
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
