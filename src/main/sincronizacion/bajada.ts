// Bajada: se leen las pestañas y se compara fila por fila contra lo último que sabíamos, usando el _ID
// como clave. Sólo se toca lo que cambió.
//
// Cómo se resuelven los cruces:
//  - La bajada NO corre si hay cambios locales sin subir: primero se vacía la cola. Así el cambio más
//    reciente (el local, que todavía no había llegado a la hoja) nunca se pisa por accidente.
//  - Si un campo cambió en la hoja y en la aplicación desde la última bajada, gana el de la hoja (es el
//    que no se subió porque el local ya había viajado) y el valor local queda en el historial marcado
//    como «pisado por sincronización».
//  - Si aparecen filas nuevas (a mano en la hoja, sin _ID) se les asigna uno y se corre la importación
//    completa, que es la que sabe crear clientes, vehículos y pólizas.
import type { Campo } from '../importacion/encabezados'
import type { FuenteHoja } from '../importacion/fuente'
import { ahoraIso, generarId, interpretarNumero, limpiar } from '../importacion/normalizar'
import { db } from '../db/base'
import { anotarEvento, encolar } from './cola'
import { repiteEncabezados } from '../importacion/encabezados'
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
    importe: { tabla: 'pagos', columna: 'importe', derivadas: (valor) => ({ importe_monto: interpretarNumero(valor) }) },
    medio_pago: { tabla: 'pagos', columna: 'medio' },
    observaciones: { tabla: 'pagos', columna: 'observaciones' },
    // El RESULTADO de la rendición: lo tocan tanto la aplicación como la contadora en la hoja.
    resultado: { tabla: 'pagos', columna: 'resultado' },
  },
  COBERTURA: {
    cobertura: { tabla: 'reglas_cobertura', columna: 'cobertura' },
    incluye: { tabla: 'reglas_cobertura', columna: 'incluye' },
    franquicia: { tabla: 'reglas_cobertura', columna: 'franquicia' },
    detalle: { tabla: 'reglas_cobertura', columna: 'detalle' },
    observaciones: { tabla: 'reglas_cobertura', columna: 'observaciones' },
  },
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
  datos_json: string
  huella: string | null
  en_la_hoja: number
}

/**
 * Aplica a la base local lo que cambió en la hoja. `titulos` acota qué pestañas se miran: el ciclo
 * automático mira las que se usan todos los días y «Forzar bajada completa» las mira todas.
 */
export async function bajarCambios(fuente: FuenteHoja, contexto: ContextoHoja, titulos: string[]): Promise<ResultadoBajada> {
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
    aplicarPestana(pestana, lectura.valores, resultado)
  }
  return resultado
}

function aplicarPestana(pestana: PestanaSincronizable, valores: string[][], resultado: ResultadoBajada): void {
  const columnaId = columnaDelId(pestana, valores)
  const primeraFila = (pestana.layout?.filaEncabezados ?? 0) + 2
  const conocidas = new Map(
    (db().prepare('SELECT fila_id, pestana, numero_fila, datos_json, huella, en_la_hoja FROM filas_crudas WHERE pestana = ?').all(pestana.titulo) as FilaConocida[]).map(
      (f) => [f.fila_id, f],
    ),
  )
  const vistas = new Set<string>()
  const ahora = ahoraIso()

  const actualizarCruda = db().prepare(
    `UPDATE filas_crudas SET datos_json = ?, huella = ?, numero_fila = ?, sheet_id = ?, en_la_hoja = 1, vista_en = ?, actualizado_en = ? WHERE fila_id = ?`,
  )

  db().transaction(() => {
    for (let r = primeraFila - 1; r < valores.length; r++) {
      const celdas = valores[r] ?? []
      const tieneDatos = celdas.some((valor, i) => i !== columnaId && limpiar(valor) !== '')
      if (!tieneDatos) continue
      // Los títulos repetidos a mitad de la planilla no son filas de datos.
      if (repiteEncabezados(celdas, pestana.layout?.mapeo.encabezados ?? [])) continue

      const id = columnaId === null ? '' : limpiar(celdas[columnaId])
      if (!id) {
        // Fila cargada a mano en la hoja: se le asigna un _ID y se manda a escribirlo. La importación
        // completa es la que después la incorpora al modelo (crea cliente, vehículo y póliza).
        const nuevo = generarId()
        encolar({ operacion: 'actualizar', pestana: pestana.titulo, filaId: nuevo, campos: { _id: nuevo } })
        resultado.filasNuevas++
        resultado.necesitaImportacion = true
        continue
      }
      vistas.add(id)

      const conocida = conocidas.get(id)
      const huella = huellaDeFila(celdas, columnaId)
      if (!conocida) {
        // Tiene _ID pero no la conocemos: vino de otra computadora. La incorpora la importación.
        resultado.filasNuevas++
        resultado.necesitaImportacion = true
        continue
      }
      if (conocida.huella === huella && conocida.en_la_hoja === 1) continue

      resultado.filasCambiadas++
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

    // Filas que estaban y ya no: quedan marcadas, nunca se borran.
    for (const [id, conocida] of conocidas) {
      if (vistas.has(id) || conocida.en_la_hoja === 0) continue
      db().prepare('UPDATE filas_crudas SET en_la_hoja = 0, actualizado_en = ? WHERE fila_id = ?').run(ahora, id)
      resultado.filasQueYaNoEstan++
    }
  })()
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
  const asignaciones = [`${destino.columna} = @valor`, ...Object.keys(derivadas).map((c) => `${c} = @${c}`), 'actualizado_en = @ahora']
  db()
    .prepare(`UPDATE ${destino.tabla} SET ${asignaciones.join(', ')} WHERE fila_id = @fila_id`)
    .run({ valor: valor || null, ...derivadas, ahora: ahoraIso(), fila_id: filaId })
  return actual.valor ?? ''
}

function anotarPisado(pestana: string, filaId: string, campo: string, valorLocal: string, valorRemoto: string): void {
  db()
    .prepare(
      `INSERT INTO historial (fecha, usuario_id, usuario_nombre, accion, tabla, registro_id, fila_id, campo, valor_anterior, valor_nuevo)
       VALUES (?, NULL, 'Sincronización', 'sincronizacion', ?, NULL, ?, ?, ?, ?)`,
    )
    .run(ahoraIso(), pestana, filaId, `${campo} (pisado por sincronización)`, valorLocal, valorRemoto)
  anotarEvento('conflicto', `«${campo}» de la fila ${filaId} cambió en la hoja: se pisó el valor local («${valorLocal}» → «${valorRemoto}»).`)
}
