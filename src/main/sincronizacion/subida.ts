// Subida: vacía la cola contra la hoja. Escribe sólo valores (nunca formatos ni colores) y agrupa todo
// en la menor cantidad posible de llamadas: una lectura de las pestañas involucradas, una escritura de
// celdas, un agregado por pestaña y un borrado por pestaña.
import type { Campo } from '../importacion/encabezados'
import type { CeldaAEscribir, FilaABorrar, FuenteHoja } from '../importacion/fuente'
import { ahoraIso, limpiar } from '../importacion/normalizar'
import { db } from '../db/base'
import { emitirATodas } from '../servicios/avisos'
import { ErrorDeNegocio } from '../servicios/errores'
import {
  achicarProximaTanda,
  anotarErrorSinContar,
  anotarEvento,
  biseccionAtascada,
  marcarFallidas,
  marcarListas,
  marcarPisadas,
  marcarSinArreglo,
  pendientes,
  restablecerTanda,
  type EntradaCola,
} from './cola'
import { agregarColumnasFaltantes, refrescarLayoutSiCambio } from './columnas'
import { columnaDelId, filasPorId, huellaDeFila, type ContextoHoja, type PestanaSincronizable } from './hoja'
import { esPestanaDeLaApp, esPestanaDelMes } from './pestanasApp'

export interface ResultadoSubida {
  subidas: number
  /** Celdas que la base no dejó escribir porque había cambiado desde que esta computadora la miró. */
  pisadas: number
  /** Las pestañas de esas celdas: hay que bajarlas ya, para mostrar el valor que ganó. */
  pestanasPisadas: string[]
  llamadas: number
  error: string | null
}

/** Una celda que perdió: la base tenía otra cosa y ganó ella (14.0). */
export interface Pisada {
  filaId: string
  pestana: string
  campo: string
  valorLocal: string
  valorServidor: string
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
 * El `previo` que se manda, con la regla de comparación de LA BASE y no la de acá (14.0).
 *
 * Las dos puntas no limpian igual. Lo que esta computadora conoce sale de `filas_crudas.datos_json`, y
 * la bajada de todos los días lo guarda pasado por `limpiar()` —recorta los bordes Y cambia el espacio
 * duro U+00A0 por uno normal, ver `importacion/normalizar.ts`— así que cualquier fila que otra
 * computadora haya tocado desde la última importación completa está normalizada acá. La base, en
 * cambio, guarda la celda tal cual llegó y compara con un `trim()` pelado. Hasta la 13.x eso no
 * molestaba porque el que comparaba era el cliente, con `limpiar` de los dos lados; la 14.0 movió la
 * decisión al servidor y la normalización se quedó de este lado.
 *
 * Sin esto, una celda con un espacio duro adentro —los hay a montones: vienen de la planilla de Google,
 * que es de dónde salió toda la base— quedaba IMPOSIBLE de escribir desde el programa: se mandaba
 * «JUAN PEREZ» con espacio normal contra un «JUAN PEREZ» con espacio duro, la base rechazaba, la
 * pestaña se volvía a bajar y mostraba exactamente el mismo texto, y el intento siguiente perdía igual,
 * para siempre y sin nada visible que lo explicara.
 *
 * La solución es mandar el texto CRUDO de esa celda —el de la lectura que la subida acaba de hacer—
 * pero sólo cuando es el mismo valor que esta computadora conoce. Si de verdad cambió, `limpiar` de los
 * dos lados da distinto y se manda lo conocido, que es lo que la base tiene que rechazar. O sea: el
 * «comparar y escribir» sigue comparando contra lo que la persona vio, y lo único que se ignora es una
 * diferencia de espacios que en la pantalla no existe.
 */
function previoParaLaBase(conocido: string, enLaLectura: unknown): string {
  const crudo = enLaLectura === null || enLaLectura === undefined ? '' : String(enLaLectura)
  return limpiar(crudo) === limpiar(conocido) ? crudo : conocido
}

/**
 * Sube una tanda. Devuelve cuántas entradas se subieron y cuántas celdas rechazó la base.
 *
 * GANA LA BASE (14.0). Cada celda de la que se conoce el valor anterior viaja con él (`previo`) y el
 * servidor la escribe SÓLO si sigue siendo ése. Hasta la 13.x era al revés: ganaba el cambio local
 * —el que todavía no había subido— y lo que había en la base quedaba pisado, anotado en un historial
 * que en la práctica nadie mira. Con dos mostradores cargando el mismo mes eso perdía trabajo ajeno
 * de verdad. Ahora la que pierde es la celda de acá, y quien escribió se entera en el momento: la
 * entrada se cierra con el motivo, la pestaña se baja enseguida y la pantalla muestra un aviso.
 */
export async function subirTanda(fuente: FuenteHoja, contexto: ContextoHoja, limite = 200): Promise<ResultadoSubida> {
  const entradas = pendientes(limite)
  if (entradas.length === 0) {
    restablecerTanda()
    return { subidas: 0, pisadas: 0, pestanasPisadas: [], llamadas: 0, error: null }
  }

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
  // El tope provisorio se restablece también acá: si quedó en 1 por un rechazo y la única entrada que
  // devolvió `pendientes` es de una pestaña que todavía no existe, nadie iba a restablecerlo nunca y la
  // cola se quedaba subiendo de a una para siempre.
  if (titulos.length === 0) {
    restablecerTanda()
    return { subidas: 0, pisadas: 0, pestanasPisadas: [], llamadas: 0, error: null }
  }

  let llamadas = 0
  const lecturas = await fuente.leerVarias(titulos)
  llamadas++
  const valoresPorTitulo = new Map(lecturas.map((l) => [l.titulo, l.valores]))

  // 12.7: antes de escribir, cada pestaña gana las columnas que le falten para lo que se va a escribir.
  // Hasta la 12.6 un campo sin columna se descartaba con un aviso, y así fue como los siniestros
  // llegaron a las otras computadoras sin asegurado: la pestaña no tenía dónde guardarlo. Si otra
  // computadora ya agregó la columna, la fila de encabezados recién leída lo dice y el mapeo se rehace.
  // El orden importa: primero se refresca el mapeo, después se agregan las columnas (que releen los
  // encabezados y sólo dejan en `pestana.layout` las que quedaron de verdad en la base, ver columnas.ts)
  // y recién con ese layout confirmado se arman, más abajo, las celdas y las filas a escribir.
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
    // Las llamadas las cuenta la propia función: son tres por vuelta y puede haber hasta tres vueltas,
    // y hasta las vueltas que no confirmaron ninguna columna gastaron cuota (ver columnas.ts).
    const contador = { llamadas: 0 }
    await agregarColumnasFaltantes(fuente, pestana, valores, necesarios, contador)
    llamadas += contador.llamadas
  }

  const celdas: CeldaAEscribir[] = []
  const aAgregar = new Map<string, Array<{ entrada: EntradaCola; fila: string[] }>>()
  const aBorrar = new Map<string, { sheetId: number; columnaId: number; filas: FilaABorrar[] }>()
  /**
   * Qué fue cada celda que se manda, para poder leer las rechazadas que vuelvan: la base contesta con
   * `titulo|id|columna` y de acá sale el campo, el valor que se quería escribir y la entrada de la
   * cola que hay que cerrar.
   */
  const loQueSeManda = new Map<string, { entrada: EntradaCola; campo: string; valor: string }>()
  const claveDeCelda = (titulo: string, id: string, columna: number) => `${titulo}\u0000${id}\u0000${columna}`
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

    // Un «borrar» de una fila que ESTA MISMA tanda iba a agregar (12.7): la fila no está en la base y
    // ya no tiene que estar. Se saca del agregado y los dos se dan por hechos. Sin esto el «borrar»
    // no la encontraba, se daba por hecho, y el agregado de abajo la creaba igual: una ficha fantasma
    // (`encolar` ya cancela el caso común; acá se cubre el «crear» que se reintenta, ver allá).
    if (entrada.operacion === 'borrar') {
      const lista = aAgregar.get(entrada.pestana) ?? []
      const posicion = lista.findIndex((x) => x.entrada.filaId === entrada.filaId)
      if (posicion >= 0) {
        hechas.push(lista[posicion]!.entrada.id, entrada.id)
        lista.splice(posicion, 1)
        if (lista.length === 0) aAgregar.delete(entrada.pestana)
        continue
      }
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

    // Actualizar: cada celda viaja con lo último que sabíamos de la hoja, y la base decide.
    const base = bases.get(entrada.filaId)
    let algoQueEscribir = false
    for (const [nombreCampo, valor] of Object.entries(entrada.campos)) {
      const nuevo = valor ?? ''
      if (nombreCampo === '_id') {
        // El _ID no viaja con `previo`: no es un dato que dos personas puedan estar editando, es la
        // identidad del renglón, y compararlo contra sí mismo sólo podría hacer fallar la escritura.
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
      // Lo último que esta computadora vio en esa celda. Sin base conocida —una fila recién creada
      // acá, que nadie bajó todavía— no hay contra qué comparar y la celda se escribe como siempre.
      const anterior = valorBase(base, pestana, campo)
      celdas.push({
        titulo: entrada.pestana,
        fila: numeroDeFila,
        columna,
        valor: nuevo,
        id: entrada.filaId,
        ...(anterior === null ? {} : { previo: previoParaLaBase(anterior, valores[numeroDeFila - 1]?.[columna]) }),
      })
      loQueSeManda.set(claveDeCelda(entrada.pestana, entrada.filaId, columna), { entrada, campo, valor: nuevo })
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
  /** Las celdas que la base no dejó escribir porque ya decían otra cosa (14.0). */
  const rechazadas: Array<{ clave: string; pisada: Pisada }> = []
  try {
    if (celdas.length > 0) {
      const resultado = await fuente.escribirCeldas(celdas, Object.fromEntries(columnaIdPorPestana))
      llamadas++
      for (const fila of resultado.noEncontradas) perdidas.add(`${fila.titulo}|${fila.id}`)
      for (const fila of resultado.rechazadas ?? []) {
        const clave = claveDeCelda(fila.titulo, fila.id, fila.columna)
        const mandada = loQueSeManda.get(clave)
        // Una rechazada que no reconocemos no puede tumbar la subida: se ignora. Pasa si el servidor
        // devuelve una columna distinta de la que se le mandó, y no hay nada sensato que mostrar.
        if (!mandada) continue
        rechazadas.push({
          clave,
          pisada: {
            filaId: mandada.entrada.filaId,
            pestana: fila.titulo,
            campo: mandada.campo,
            valorLocal: mandada.valor,
            valorServidor: fila.actual,
          },
        })
      }
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
    // Un rechazo del CONTENIDO a una tanda de varias no cuenta como intento de ninguna: la que sigue
    // sale más chica, hasta que la entrada mala quede sola (ver `achicarProximaTanda` en cola.ts). Todo
    // lo demás —corte de red, 5xx, credenciales, cuota, o una sola entrada rechazada— se marca como
    // siempre, así la espera exponencial entra en vez de martillar al servidor cada diez segundos. Y si
    // la bisección ya se partió muchas veces sin que ninguna tanda pase, el rechazo no era de una celda
    // sola: se cuenta el intento igual.
    if (esRechazoDelContenido(error) && entradas.length > 1 && !biseccionAtascada()) {
      anotarErrorSinContar(
        entradas.map((e) => e.id),
        motivo,
      )
      achicarProximaTanda(entradas.length)
    } else {
      marcarFallidas(
        entradas.map((e) => e.id),
        motivo,
      )
      restablecerTanda()
    }
    return { subidas: 0, pisadas: 0, pestanasPisadas: [], llamadas, error: motivo }
  }
  restablecerTanda()

  const noSeEscribieron = new Set(rechazadas.map((r) => r.clave))
  // Las rechazadas no se escribieron en ningún lado: no pueden entrar en la copia local de la fila. Si
  // entraran, esta computadora creería que la base dice lo que ella quiso escribir y la bajada de acá
  // abajo no traería nada.
  const celdasEscritas = celdas.filter(
    (celda) =>
      !perdidas.has(`${celda.titulo}|${celda.id ?? ''}`) && !noSeEscribieron.has(claveDeCelda(celda.titulo, celda.id ?? '', celda.columna)),
  )
  const entradasEscritas = entradas.filter((entrada) => {
    if (entrada.operacion !== 'actualizar' || !perdidas.has(`${entrada.pestana}|${entrada.filaId}`)) return true
    const posicion = hechas.indexOf(entrada.id)
    if (posicion >= 0) hechas.splice(posicion, 1)
    fallidas.push({ id: entrada.id, motivo: 'La fila ya no está en la base (la borraron desde otra computadora).' })
    return false
  })

  // --- Dejar la base local al día con lo que quedó en la hoja.
  //
  // Las filas que tuvieron alguna celda rechazada quedan AFUERA (14.0), y es lo que hace que el
  // «gana la base» se vea en la pantalla. `actualizarBaseLocal` le recalcula la huella a la fila con
  // lo que la base dice hoy; si eso corriera también acá, la bajada que sale enseguida
  // (`pestanasPisadas` → `bajarLoQuePisoLaBase` en motor.ts) vería la fila «sin cambios» y no la
  // releería nunca: la copia local se quedaría para siempre con el número que la base no aceptó, que
  // es exactamente lo que esto vino a evitar. Dejándoles la huella vieja, esa bajada las trae enteras.
  const filasPisadas = new Set(rechazadas.map(({ pisada }) => `${pisada.pestana}\u0000${pisada.filaId}`))
  actualizarBaseLocal(
    contexto,
    valoresPorTitulo,
    entradasEscritas.filter((entrada) => !filasPisadas.has(`${entrada.pestana}\u0000${entrada.filaId}`)),
    celdasEscritas,
  )
  marcarListas(hechas)
  for (const { id, motivo } of fallidas) marcarSinArreglo([id], motivo)
  // Después de `marcarListas`: las entradas pisadas también salen de la cola —no hay nada que
  // reintentar, la base ya decidió— pero conservan el motivo a la vista.
  for (const { pisada } of rechazadas) anotarPisada(pisada)
  marcarPisadas(
    [...new Set(rechazadas.map((r) => loQueSeManda.get(r.clave)!.entrada.id))],
    'La base tenía otro valor: ganó el de la base (lo cambiaron desde otra computadora).',
  )
  for (const [clave, filas] of sinColumna) {
    const [pestana, campo] = clave.split('\u0000')
    anotarEvento(
      'columna faltante',
      `La pestaña «${pestana}» no tiene columna para «${campo}»: ${filas} fila(s) se escribieron sin ese dato. ` +
        'Reimportá la base (Administración → Reimportar la base) para que la pestaña gane la columna.',
      { filas, conError: true },
    )
  }

  return {
    subidas: hechas.length,
    pisadas: rechazadas.length,
    pestanasPisadas: [...new Set(rechazadas.map((r) => r.pisada.pestana))],
    llamadas,
    error: null,
  }
}

/**
 * El servidor rechazó EL CONTENIDO de lo que se le mandó: un 400 o un 422, que es lo que devuelve
 * cuando un valor no le sirve. Sólo esos dos códigos son «la culpa es de una celda».
 *
 * Todo el resto de los 4xx son del pedido entero y transitorios —401/403 (credenciales o token
 * vencido), 404 (la hoja no está), 409 (otra computadora tocó la fila), 429 (cuota)— y lo que piden es
 * esperar; partir la tanda ahí dejaría a la cola reintentando cada diez segundos sin espera, justo
 * contra un servidor que está pidiendo que la aplicación afloje. Un `ErrorDeNegocio` sin código
 * (todos los de la fuente de Google, ver fuente.ts, incluidos los de cuota y credenciales) tampoco
 * dice de qué se queja: se trata como los demás.
 */
function esRechazoDelContenido(error: unknown): boolean {
  if (!(error instanceof ErrorDeNegocio)) return false
  const status = (error as { status?: number }).status
  return status === 400 || status === 422
}

/**
 * Deja anotado que la base tenía otro valor y ganó ella (14.0), y se lo dice a la pantalla.
 *
 * El evento va a la bitácora de sincronización, que es donde se mira «qué pasó con este cambio»; el
 * aviso al renderer es lo que hace que la persona se entere ahora y no cuando note que su número no
 * está. La pantalla ya tiene el valor que ganó cuando el aviso llega: la pestaña se baja enseguida
 * (ver `ResultadoSubida.pestanasPisadas`).
 */
function anotarPisada(pisada: Pisada): void {
  anotarEvento(
    'conflicto',
    `«${pisada.campo}» de la fila ${pisada.filaId} ya había cambiado en la base («${pisada.valorServidor}»): ` +
      `no se escribió lo de esta computadora («${pisada.valorLocal}»).`,
    { conError: true },
  )
  emitirATodas('datos:pisados', pisada)
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
