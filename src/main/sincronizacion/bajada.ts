// Bajada: se leen las pestañas y se compara fila por fila contra lo último que sabíamos, usando el _ID
// como clave. Sólo se toca lo que cambió.
//
// Cómo se resuelven los cruces:
//  - Antes de bajar se vacía la cola de subida. Lo que igual no llegó a subir deja su fila afuera de la
//    bajada (`filasBloqueadas`), así el cambio más reciente —el local, que todavía no viajó— nunca se
//    pisa por accidente, y el resto de la hoja se actualiza igual.
//  - Si un campo cambió en la hoja y en la aplicación desde la última bajada, gana el de la hoja (es el
//    que no se subió porque el local ya había viajado) y el valor local queda en el historial marcado
//    como «pisado por sincronización».
//  - Si aparecen filas nuevas (a mano en la hoja, sin _ID) se corre la importación completa, que es la
//    que les escribe el _ID en la hoja y sabe crear clientes, vehículos y pólizas.
import type { Campo } from '../importacion/encabezados'
import type { FuenteHoja } from '../importacion/fuente'
import { ahoraIso, interpretarFecha, interpretarNumero, limpiar } from '../importacion/normalizar'
import { db } from '../db/base'
import { anotarEvento } from './cola'
import { repiteEncabezados } from '../importacion/encabezados'
import { esPestanaDeAnexos, guardarAnexoDeLaHoja } from './anexos'
import { alDesaparecerDeLaHoja, alReaparecerEnLaHoja } from '../servicios/filas'
import { normalizarEstadoDeCobro } from '../servicios/pagos'
import { estadoDeTareaDesdeTexto, prioridadDeTareaDesdeTexto } from '../../shared/tareas'
import { columnaDelId, huellaDeFila, type ContextoHoja, type PestanaSincronizable } from './hoja'

export interface ResultadoBajada {
  pestanasLeidas: number
  filasCambiadas: number
  filasNuevas: number
  filasQueYaNoEstan: number
  camposAplicados: number
  pisados: number
  /** true si aparecieron filas nuevas y hay que correr la importación completa para incorporarlas. */
  necesitaImportacion: boolean
  llamadas: number
}

interface DestinoDeBajada {
  tabla: string
  columna: string
  /**
   * Columnas derivadas que hay que recalcular al escribir. Los importes se guardan como texto tal
   * cual vienen de la hoja y aparte como número: si sólo se actualiza el texto, todas las sumas de
   * Cobranzas siguen mostrando el valor viejo.
   */
  derivadas?: (valor: string) => Record<string, unknown>
  /** Cómo llevar lo que dice la hoja a lo que guarda la columna, cuando no es texto tal cual. */
  normalizar?: (valor: string) => string
}

/** Dónde vive cada campo del modelo, por tipo de pestaña. */
const DESTINOS: Record<string, Partial<Record<Campo, DestinoDeBajada>>> = {
  MENSUAL: {
    cuota: { tabla: 'cuotas_mes', columna: 'cuota', derivadas: (valor) => ({ cuota_monto: interpretarNumero(valor) }) },
    dia_vencimiento: { tabla: 'cuotas_mes', columna: 'dia_vencimiento' },
    forma_pago: { tabla: 'cuotas_mes', columna: 'forma_pago' },
    aviso: { tabla: 'cuotas_mes', columna: 'aviso' },
    fecha_envio: { tabla: 'cuotas_mes', columna: 'fecha_envio' },
    avisar_vto: { tabla: 'cuotas_mes', columna: 'avisar_vto' },
    pago: { tabla: 'cuotas_mes', columna: 'pago' },
    observaciones: { tabla: 'cuotas_mes', columna: 'observaciones' },
    nombre: { tabla: 'cuotas_mes', columna: 'cliente_nombre' },
    documento: { tabla: 'cuotas_mes', columna: 'documento' },
    sucursal: { tabla: 'cuotas_mes', columna: 'sucursal_texto' },
    compania: { tabla: 'cuotas_mes', columna: 'compania' },
    numero_poliza: { tabla: 'cuotas_mes', columna: 'numero_poliza' },
    patente: { tabla: 'cuotas_mes', columna: 'patente' },
  },
  BAJAS: {
    motivo: { tabla: 'bajas', columna: 'motivo' },
    fecha_baja: { tabla: 'bajas', columna: 'fecha_baja' },
    observaciones: { tabla: 'bajas', columna: 'observaciones' },
    nombre: { tabla: 'bajas', columna: 'cliente_nombre' },
    documento: { tabla: 'bajas', columna: 'documento' },
    compania: { tabla: 'bajas', columna: 'compania' },
    numero_poliza: { tabla: 'bajas', columna: 'numero_poliza' },
    patente: { tabla: 'bajas', columna: 'patente' },
  },
  RIESGOS_VARIOS: {
    tipo_riesgo: { tabla: 'riesgos_varios', columna: 'tipo_riesgo' },
    descripcion: { tabla: 'riesgos_varios', columna: 'descripcion' },
    cuota: { tabla: 'riesgos_varios', columna: 'cuota', derivadas: (valor) => ({ cuota_monto: interpretarNumero(valor) }) },
    observaciones: { tabla: 'riesgos_varios', columna: 'observaciones' },
    telefono: { tabla: 'riesgos_varios', columna: 'telefono' },
    compania: { tabla: 'riesgos_varios', columna: 'compania' },
    numero_poliza: { tabla: 'riesgos_varios', columna: 'numero_poliza' },
  },
  SINIESTROS: {
    descripcion: { tabla: 'siniestros', columna: 'descripcion' },
    estado: { tabla: 'siniestros', columna: 'estado' },
    importe: { tabla: 'siniestros', columna: 'importe' },
    numero_siniestro: { tabla: 'siniestros', columna: 'numero_siniestro' },
    observaciones: { tabla: 'siniestros', columna: 'observaciones' },
  },
  PAGOS: {
    // La fecha cambia cuando se corrige un cobro, y sobre todo cuando un IMPUTADO pasa a PAGO: la
    // fecha de la imputación se reemplaza por la del día que el cliente pagó, y la caja de ese día
    // en las otras computadoras tiene que verlo.
    fecha: { tabla: 'pagos', columna: 'fecha', derivadas: (valor) => ({ fecha_iso: interpretarFecha(valor, null).iso }) },
    importe: { tabla: 'pagos', columna: 'importe', derivadas: (valor) => ({ importe_monto: interpretarNumero(valor) }) },
    medio_pago: { tabla: 'pagos', columna: 'medio' },
    observaciones: { tabla: 'pagos', columna: 'observaciones' },
    // El RESULTADO de la rendición: lo tocan tanto la aplicación como la contadora en la hoja.
    resultado: { tabla: 'pagos', columna: 'resultado' },
    // El estado del COBRO (PAGO / IMPUTADO): lo cambia la computadora que cobró, cuando el cliente
    // termina pagando lo que estaba imputado. Se guarda normalizado: la columna no admite vacío.
    cobro: { tabla: 'pagos', columna: 'estado_cobro', normalizar: (valor) => normalizarEstadoDeCobro(valor) },
  },
  // Los avisos de rechazo del débito. Lo único que cambia después de creado el aviso es en qué anda
  // (PENDIENTE → VISTO → RESUELTO) y la nota: eso lo toca la sucursal avisada, desde su computadora.
  APP_RECHAZOS: {
    estado: { tabla: 'rechazos_debito', columna: 'estado' },
    observaciones: { tabla: 'rechazos_debito', columna: 'nota' },
    motivo: { tabla: 'rechazos_debito', columna: 'motivo' },
  },
  // Las tareas. Lo que cambia después de creada la tarea es de quién es, para cuándo, con qué urgencia
  // y en qué anda: todo eso lo toca la computadora de quien la está haciendo, que puede ser otra.
  //
  // `responsable` merece una nota: en la hoja va el NOMBRE, porque es lo que se lee, pero la campana y
  // el filtro «las mías» trabajan con `responsable_id`. Por eso se deriva el id del nombre en la misma
  // escritura; si el nombre no coincide con ningún usuario activo —o coincide con dos— la tarea queda
  // con el nombre a la vista y sin dueño, que es preferible a asignársela a la persona equivocada.
  APP_TAREAS: {
    titulo: { tabla: 'tareas', columna: 'titulo' },
    descripcion: { tabla: 'tareas', columna: 'detalle' },
    responsable: {
      tabla: 'tareas',
      columna: 'responsable_nombre',
      derivadas: (valor) => ({ responsable_id: idDeResponsablePorNombre(valor) }),
    },
    sucursal: { tabla: 'tareas', columna: 'sucursal_texto' },
    vence: { tabla: 'tareas', columna: 'vence_el' },
    // Los dos tienen CHECK en la tabla: lo que venga escrito a mano se acomoda o no entra.
    prioridad: { tabla: 'tareas', columna: 'prioridad', normalizar: (valor) => prioridadDeTareaDesdeTexto(valor) },
    estado: { tabla: 'tareas', columna: 'estado', normalizar: (valor) => estadoDeTareaDesdeTexto(valor) },
  },
  COBERTURA: {
    cobertura: { tabla: 'reglas_cobertura', columna: 'cobertura' },
    incluye: { tabla: 'reglas_cobertura', columna: 'incluye' },
    franquicia: { tabla: 'reglas_cobertura', columna: 'franquicia' },
    detalle: { tabla: 'reglas_cobertura', columna: 'detalle' },
    observaciones: { tabla: 'reglas_cobertura', columna: 'observaciones' },
  },
}

/**
 * El id del usuario que se llama así, si hay exactamente uno activo. Con ninguno o con dos devuelve
 * null: una tarea sin dueño se ve igual en el listado y se puede reasignar; una asignada a la persona
 * equivocada desaparece de la vista de quien tenía que hacerla.
 */
function idDeResponsablePorNombre(nombre: string): number | null {
  const buscado = limpiar(nombre)
  if (!buscado) return null
  const iguales = db().prepare('SELECT id FROM usuarios WHERE activo = 1 AND nombre = ?').all(buscado) as Array<{ id: number }>
  return iguales.length === 1 ? (iguales[0]?.id ?? null) : null
}

/** Campos del cliente: se guardan en la ficha del cliente, no en la fila del mes. */
const DESTINOS_DEL_CLIENTE: Partial<Record<Campo, string>> = {
  telefono: 'telefono',
  email: 'email',
  direccion: 'direccion',
  localidad: 'localidad',
  fecha_nacimiento: 'fecha_nacimiento',
}

interface FilaConocida {
  fila_id: string
  pestana: string
  numero_fila: number
  sheet_id: number | null
  datos_json: string
  huella: string | null
  en_la_hoja: number
}

/**
 * Aplica a la base local lo que cambió en la hoja. `titulos` acota qué pestañas se miran: el ciclo
 * automático mira las que se usan todos los días y «Forzar bajada completa» las mira todas.
 *
 * `filasBloqueadas` son las filas que todavía tienen cambios sin subir: se saltean para no pisarlos. Es
 * más fino que frenar la bajada entera, que era lo que hacía que una sola entrada trabada dejara a toda
 * la aplicación sin actualizarse.
 */
export async function bajarCambios(
  fuente: FuenteHoja,
  contexto: ContextoHoja,
  titulos: string[],
  filasBloqueadas: Set<string> = new Set(),
): Promise<ResultadoBajada> {
  const resultado: ResultadoBajada = {
    pestanasLeidas: 0,
    filasCambiadas: 0,
    filasNuevas: 0,
    filasQueYaNoEstan: 0,
    camposAplicados: 0,
    pisados: 0,
    necesitaImportacion: false,
    llamadas: 0,
  }
  const aLeer = titulos.filter((t) => contexto.porTitulo.has(t))
  if (aLeer.length === 0) return resultado

  const lecturas = await fuente.leerVarias(aLeer)
  resultado.llamadas++
  resultado.pestanasLeidas = lecturas.length

  for (const lectura of lecturas) {
    const pestana = contexto.porTitulo.get(lectura.titulo)
    if (!pestana) continue
    aplicarPestana(pestana, lectura.valores, resultado, filasBloqueadas)
  }
  return resultado
}

function aplicarPestana(
  pestana: PestanaSincronizable,
  valores: string[][],
  resultado: ResultadoBajada,
  filasBloqueadas: Set<string>,
): void {
  const columnaId = columnaDelId(pestana, valores)
  // Todas las columnas tituladas _ID, no sólo la que manda: si una pestaña arrastra una segunda columna
  // _ID de cuando la duplicaron, sus valores no son datos de la fila. El importador usa el mismo criterio,
  // y si acá fuera más laxo la bajada vería filas «con datos y sin _ID» que la importación descarta, y
  // pediría una importación completa en cada ciclo sin que la hoja cambiara nunca.
  const columnasId = new Set<number>(pestana.layout?.mapeo.columnasId ?? [])
  if (columnaId !== null) columnasId.add(columnaId)
  const primeraFila = (pestana.layout?.filaEncabezados ?? 0) + 2
  const conocidas = new Map(
    (db().prepare('SELECT fila_id, pestana, numero_fila, sheet_id, datos_json, huella, en_la_hoja FROM filas_crudas WHERE pestana = ?').all(pestana.titulo) as FilaConocida[]).map(
      (f) => [f.fila_id, f],
    ),
  )
  const vistas = new Set<string>()
  const ahora = ahoraIso()

  const actualizarCruda = db().prepare(
    `UPDATE filas_crudas SET datos_json = ?, huella = ?, numero_fila = ?, sheet_id = ?, en_la_hoja = 1, vista_en = ?, actualizado_en = ? WHERE fila_id = ?`,
  )
  const refrescarLugar = db().prepare(`UPDATE filas_crudas SET numero_fila = ?, sheet_id = ? WHERE fila_id = ?`)

  db().transaction(() => {
    for (let r = primeraFila - 1; r < valores.length; r++) {
      const celdas = valores[r] ?? []
      const tieneDatos = celdas.some((valor, i) => !columnasId.has(i) && limpiar(valor) !== '')
      if (!tieneDatos) continue
      // Los títulos repetidos a mitad de la planilla no son filas de datos.
      if (repiteEncabezados(celdas, pestana.layout?.mapeo.encabezados ?? [])) continue

      const id = columnaId === null ? '' : limpiar(celdas[columnaId])
      if (!id) {
        // Fila cargada a mano en la hoja. El _ID lo escribe la importación completa, que corre a
        // continuación por `necesitaImportacion`: es la única que sabe en qué fila va y, de paso, crea
        // el cliente, el vehículo y la póliza. Acá no se encola nada: el _ID que inventáramos ahora no
        // estaría en ninguna fila de la hoja y la subida no tendría dónde escribirlo.
        resultado.filasNuevas++
        resultado.necesitaImportacion = true
        continue
      }
      vistas.add(id)
      // Con cambios locales sin subir, esta fila no se toca: bajarla ahora los pisaría. Queda para el
      // ciclo siguiente, cuando su entrada de la cola ya haya viajado.
      if (filasBloqueadas.has(id)) continue

      const conocida = conocidas.get(id)
      const huella = huellaDeFila(celdas, columnaId)
      if (!conocida) {
        // Tiene _ID pero no la conocemos: vino de otra computadora. La incorpora la importación… salvo
        // que sea un adjunto o un comentario (12.6): ésos se guardan acá mismo, así un comentario
        // escrito en la otra sucursal aparece con el carril rápido y no con la importación completa.
        if (esPestanaDeAnexos(pestana.tipo) && incorporarAnexo(pestana, id, celdas, huella, r + 1, ahora)) {
          resultado.filasNuevas++
          continue
        }
        resultado.filasNuevas++
        resultado.necesitaImportacion = true
        continue
      }
      if (conocida.huella === huella && conocida.en_la_hoja === 1) {
        // Sin cambios en el contenido, pero si otra computadora borró un renglón más arriba la fila
        // ahora está en otro número: se anota, porque el número es lo que las reparaciones y los
        // desempates usan para saber cuál es el renglón original. No cuenta como fila cambiada.
        if (conocida.numero_fila !== r + 1 || conocida.sheet_id !== pestana.sheetId) {
          refrescarLugar.run(r + 1, pestana.sheetId, id)
        }
        continue
      }

      resultado.filasCambiadas++
      // Estaba marcada como fuera de la hoja y volvió: la deshicieron desde otra computadora.
      if (conocida.en_la_hoja === 0) alReaparecerEnLaHoja(db(), id, pestana.tipo)
      const anteriores = JSON.parse(conocida.datos_json) as Record<string, string>
      const encabezados = pestana.layout?.mapeo.encabezados ?? []
      const nuevos: Record<string, string> = { ...anteriores }

      for (const [campo, columna] of pestana.layout?.mapeo.porCampo ?? []) {
        const encabezado = encabezados[columna] ?? ''
        if (!encabezado) continue
        const remoto = limpiar(celdas[columna])
        const anterior = limpiar(anteriores[encabezado] ?? '')
        if (remoto === anterior) continue
        nuevos[encabezado] = remoto
        const pisado = aplicarCampo(pestana, id, campo, remoto)
        resultado.camposAplicados++
        if (pisado !== null && limpiar(pisado) !== anterior) {
          anotarPisado(pestana.titulo, id, campo, pisado, remoto)
          resultado.pisados++
        }
      }
      // Las columnas sin mapeo también se guardan: los datos crudos son la red de seguridad.
      encabezados.forEach((encabezado, i) => {
        if (encabezado && i !== columnaId) nuevos[encabezado] = limpiar(celdas[i])
      })

      actualizarCruda.run(JSON.stringify(nuevos), huella, r + 1, pestana.sheetId, ahora, ahora, id)
    }

    // Filas que estaban y ya no: quedan marcadas, nunca se borran. Lo que sí cambia es lo que la
    // fila representaba (la cuota sale de la planilla, la baja deshecha se olvida): ver filas.ts.
    const desaparecidas: string[] = []
    for (const [id, conocida] of conocidas) {
      if (vistas.has(id) || conocida.en_la_hoja === 0) continue
      db().prepare('UPDATE filas_crudas SET en_la_hoja = 0, actualizado_en = ? WHERE fila_id = ?').run(ahora, id)
      resultado.filasQueYaNoEstan++
      desaparecidas.push(id)
    }
    alDesaparecerDeLaHoja(
      db(),
      desaparecidas.map((filaId) => ({ filaId, tipo: pestana.tipo })),
      filasBloqueadas,
    )
  })()
}

/**
 * Una fila nueva de APP ADJUNTOS / APP COMENTARIOS: se guarda el registro y la fila cruda sin pasar
 * por la importación completa. Devuelve false si la ficha madre todavía no está en esta computadora:
 * ahí sí hace falta la importación (que trae la ficha y, con ella, el anexo).
 */
function incorporarAnexo(pestana: PestanaSincronizable, id: string, celdas: string[], huella: string, numeroFila: number, ahora: string): boolean {
  if (pestana.tipo !== 'APP_ADJUNTOS' && pestana.tipo !== 'APP_COMENTARIOS') return false
  const porCampo = pestana.layout?.mapeo.porCampo ?? new Map<Campo, number>()
  const valor = (campo: Campo): string => {
    const columna = porCampo.get(campo)
    return columna === undefined ? '' : limpiar(celdas[columna])
  }
  const resultado = guardarAnexoDeLaHoja(pestana.tipo, { filaId: id, pestana: pestana.titulo, valor }, db())
  if (resultado === 'sin-padre') return false
  const encabezados = pestana.layout?.mapeo.encabezados ?? []
  const datos: Record<string, string> = {}
  encabezados.forEach((encabezado, i) => {
    if (encabezado) datos[encabezado] = limpiar(celdas[i])
  })
  db()
    .prepare(
      `INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, periodo, numero_fila, datos_json, en_la_hoja, vista_en, sheet_id, huella, creado_en, actualizado_en)
       VALUES (?, ?, ?, NULL, ?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(fila_id) DO UPDATE SET pestana = excluded.pestana, numero_fila = excluded.numero_fila, datos_json = excluded.datos_json,
         en_la_hoja = 1, vista_en = excluded.vista_en, sheet_id = excluded.sheet_id, huella = excluded.huella, actualizado_en = excluded.actualizado_en`,
    )
    .run(id, pestana.titulo, pestana.tipo, numeroFila, JSON.stringify(datos), ahora, pestana.sheetId, huella, ahora, ahora)
  return true
}

/**
 * Escribe el valor que vino de la hoja en la tabla que corresponde. Devuelve el valor que había en la
 * base local (para saber si se pisó un cambio hecho acá), o null si el campo no se guarda en ninguna tabla.
 */
function aplicarCampo(pestana: PestanaSincronizable, filaId: string, campo: Campo, valor: string): string | null {
  const columnaCliente = DESTINOS_DEL_CLIENTE[campo]
  if (columnaCliente) {
    const cliente = db()
      .prepare(
        `SELECT c.id, c.${columnaCliente} AS valor FROM clientes c
         JOIN cuotas_mes q ON q.cliente_id = c.id WHERE q.fila_id = ?`,
      )
      .get(filaId) as { id: number; valor: string | null } | undefined
    if (!cliente) return null
    db().prepare(`UPDATE clientes SET ${columnaCliente} = ?, actualizado_en = ? WHERE id = ?`).run(valor || null, ahoraIso(), cliente.id)
    return cliente.valor ?? ''
  }

  const destino = DESTINOS[pestana.tipo]?.[campo]
  if (!destino) return null
  const actual = db().prepare(`SELECT ${destino.columna} AS valor FROM ${destino.tabla} WHERE fila_id = ?`).get(filaId) as
    | { valor: string | null }
    | undefined
  if (!actual) return null
  const derivadas = destino.derivadas?.(valor) ?? {}
  const guardado = destino.normalizar ? destino.normalizar(valor) : valor
  const asignaciones = [`${destino.columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`), 'actualizado_en = @ahora']
  db()
    .prepare(`UPDATE ${destino.tabla} SET ${asignaciones.join(', ')} WHERE fila_id = @fila_id`)
    .run({ valor: destino.normalizar ? guardado : valor || null, ...derivadas, ahora: ahoraIso(), fila_id: filaId })
  return actual.valor ?? ''
}

function anotarPisado(pestana: string, filaId: string, campo: string, valorLocal: string, valorRemoto: string): void {
  db()
    .prepare(
      `INSERT INTO historial (fecha, usuario_id, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo)
       VALUES (?, NULL, 'Sincronización', 'sincronizacion', ?, NULL, ?, ?, ?, ?)`,
    )
    .run(ahoraIso(), pestana, filaId, `${campo} (pisado por sincronización)`, valorLocal, valorRemoto)
  anotarEvento('conflicto', `«${campo}» de la fila ${filaId} cambió en la base: se pisó el valor local («${valorLocal}» → «${valorRemoto}»).`)
}
