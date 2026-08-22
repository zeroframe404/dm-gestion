// La matriz de reglas de cobertura: qué antigüedad de vehículo acepta cada compañía para cada cobertura.
// Es lo que alimenta la advertencia que aparece al emitir una póliza.
//
// Por qué esta pantalla se carga a mano en lugar de importarse: la pestaña «COBERTURA» de la planilla
// real no es una tabla, es una matriz de resumen (compañías en un eje, coberturas en el otro, celdas
// combinadas y años sueltos) y sus encabezados no están en la primera fila. El importador, por diseño,
// no la mapea: contra la hoja real `reglas_cobertura` queda vacía y esas filas viven sólo en
// `filas_crudas`. Intentar parsear la matriz sería frágil y se rompería en silencio el día que alguien
// mueva una celda, así que la matriz la carga el superadministrador desde acá y la hoja se muestra al
// costado como referencia (`referencia`) para copiarla sin adivinar.
import { hoyLocal } from '../../shared/semaforo'
import type { DatosDeRegla, MatrizDeCobertura, ReglaDeCobertura, SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, generarId, limpiar, normalizarTexto } from '../importacion/normalizar'
import { ErrorDeNegocio } from './errores'
import { registrarCambio, type AccionHistorial } from './historial'
import { enteroPositivo, objeto, texto } from './validacion'

/** Pestaña de las reglas que nacen en la aplicación: no existe en la hoja, y ése es el punto. */
const PESTANA_APP = '(cargado en DM Gestión)'

/** Todo cambio de la matriz se anota en el historial con esta acción. */
const ACCION_COBERTURA: AccionHistorial = 'cobertura'

/** Cuántas filas de la pestaña COBERTURA se mandan como referencia: lo que entra en pantalla. */
const MAXIMO_DE_REFERENCIA = 60

/** Nadie asegura un vehículo de más de 60 años como flota común: arriba de eso es un error de tipeo. */
const ANTIGUEDAD_ADMITIDA = 60

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

interface FilaRegla {
  id: number
  fila_id: string
  compania: string | null
  cobertura: string | null
  incluye: string | null
  franquicia: string | null
  detalle: string | null
  observaciones: string | null
  antiguedad_maxima: number | null
  anio_minimo: number | null
  creada_en_la_app: number
}

const SELECT_REGLAS = `
  SELECT id, fila_id, compania, cobertura, incluye, franquicia, detalle, observaciones,
         antiguedad_maxima, anio_minimo, creada_en_la_app
  FROM reglas_cobertura
`

/**
 * `editable` marca las reglas que nacieron en la aplicación: son las únicas cuyo texto tiene sentido
 * corregir acá. Las que bajaron de la hoja las vuelve a pisar el importador en cada corrida.
 */
function aRegla(fila: FilaRegla): ReglaDeCobertura {
  return {
    id: fila.id,
    compania: fila.compania,
    cobertura: fila.cobertura,
    incluye: fila.incluye,
    franquicia: fila.franquicia,
    detalle: fila.detalle,
    observaciones: fila.observaciones,
    antiguedadMaxima: fila.antiguedad_maxima,
    anioMinimo: fila.anio_minimo,
    editable: fila.creada_en_la_app === 1,
  }
}

/**
 * Todas las reglas cargadas, ordenadas para leerlas de corrido. La importa polizas.ts para validar la
 * antigüedad al emitir, así que no pide sesión ni toca nada: es sólo lectura.
 */
export function reglasVigentes(): ReglaDeCobertura[] {
  const filas = db().prepare(SELECT_REGLAS).all() as FilaRegla[]
  return filas
    .map(aRegla)
    .sort(
      (a, b) =>
        (a.compania ?? '').localeCompare(b.compania ?? '', 'es') || (a.cobertura ?? '').localeCompare(b.cobertura ?? '', 'es'),
    )
}

/** Clave de comparación de una regla. La hoja escribe «RUS» y «R.U.S.»: normalizado son la misma. */
function clave(compania: string | null | undefined, cobertura: string | null | undefined): string {
  return `${normalizarTexto(compania)}|${normalizarTexto(cobertura)}`
}

/**
 * Las combinaciones de compañía y cobertura que ya existen en la cartera y todavía no tienen regla.
 * Es lo que hace útil la pantalla desde el primer día: en vez de una matriz vacía, la lista concreta
 * de lo que falta cargar, con las que más pólizas tienen arriba.
 */
function combinacionesSinRegla(reglas: ReglaDeCobertura[]): MatrizDeCobertura['faltantes'] {
  const yaCargadas = new Set(reglas.map((r) => clave(r.compania, r.cobertura)))
  const filas = db()
    .prepare(
      `SELECT compania, cobertura, COUNT(*) AS polizas
       FROM polizas
       WHERE activa = 1 AND TRIM(COALESCE(compania, '')) <> '' AND TRIM(COALESCE(cobertura, '')) <> ''
       GROUP BY compania, cobertura`,
    )
    .all() as Array<{ compania: string; cobertura: string; polizas: number }>

  // El GROUP BY de SQLite agrupa por el texto crudo: «RUS» y «Rus » caen en grupos distintos. Se vuelven
  // a juntar acá por la clave normalizada, quedándose con la primera forma que apareció para mostrarla.
  const acumuladas = new Map<string, { compania: string; cobertura: string; polizas: number }>()
  for (const fila of filas) {
    const k = clave(fila.compania, fila.cobertura)
    if (yaCargadas.has(k)) continue
    const previa = acumuladas.get(k)
    if (previa) previa.polizas += fila.polizas
    else acumuladas.set(k, { compania: limpiar(fila.compania), cobertura: limpiar(fila.cobertura), polizas: fila.polizas })
  }

  return [...acumuladas.values()].sort(
    (a, b) =>
      b.polizas - a.polizas || a.compania.localeCompare(b.compania, 'es') || a.cobertura.localeCompare(b.cobertura, 'es'),
  )
}

/**
 * Las filas de las pestañas de cobertura tal cual bajaron, sin interpretar nada: van al costado de la
 * pantalla para que el superadministrador copie la matriz mirándola. `datos_json` es un objeto
 * {encabezado: valor}; se devuelven los valores en el orden en que están, que es el orden de las
 * columnas de la hoja.
 */
function filasDeReferencia(): string[][] {
  const filas = db()
    .prepare(
      `SELECT datos_json FROM filas_crudas
       WHERE tipo_pestana = 'COBERTURA' AND en_la_hoja = 1
       ORDER BY pestana, numero_fila`,
    )
    .all() as Array<{ datos_json: string }>

  const referencia: string[][] = []
  for (const fila of filas) {
    if (referencia.length >= MAXIMO_DE_REFERENCIA) break
    let datos: unknown
    try {
      datos = JSON.parse(fila.datos_json)
    } catch {
      continue
    }
    if (typeof datos !== 'object' || datos === null) continue
    const valores = Object.values(datos as Record<string, unknown>).map((valor) => limpiar(valor))
    // Una matriz de resumen tiene filas enteras en blanco (las separaciones visuales): no aportan nada
    // como referencia y se comerían el cupo de las que sí tienen datos.
    if (valores.every((valor) => valor === '')) continue
    referencia.push(valores)
  }
  return referencia
}

export function matrizDeCobertura(actor: SesionUsuario): MatrizDeCobertura {
  const reglas = reglasVigentes()
  return {
    reglas,
    faltantes: combinacionesSinRegla(reglas),
    referencia: filasDeReferencia(),
    puedeEditar: actor.rol === 'SUPER_ADMIN',
    anioActual: anioDeHoy(),
  }
}

function anioDeHoy(): number {
  return Number(hoyLocal().slice(0, 4))
}

// ---------------------------------------------------------------------------
// Validación de lo que llega del formulario
// ---------------------------------------------------------------------------

/**
 * La matriz define qué se puede vender: una regla mal cargada frena una emisión legítima o deja pasar
 * una que la compañía va a rechazar. Por eso la edita sólo el superadministrador, además del control
 * que hace ipc.ts.
 */
function exigirSuperAdmin(actor: SesionUsuario): void {
  if (actor.rol !== 'SUPER_ADMIN') {
    throw new ErrorDeNegocio('La matriz de coberturas la carga sólo el superadministrador.')
  }
}

interface ReglaValidada {
  compania: string
  cobertura: string
  incluye: string | null
  franquicia: string | null
  detalle: string | null
  observaciones: string | null
  antiguedadMaxima: number | null
  anioMinimo: number | null
}

/** Campo de texto que puede quedar vacío: vacío se guarda como NULL, no como cadena vacía. */
function opcional(valor: unknown, campo: string, maximo: number): string | null {
  const limpio = limpiar(valor)
  if (!limpio) return null
  return texto(limpio, campo, 1, maximo)
}

/**
 * Los límites llegan como texto porque son campos de formulario. Vacío significa «esta compañía no pone
 * límite» y es un valor válido y frecuente, no un error: sin límite la regla nunca advierte nada.
 */
function limite(valor: unknown, campo: string, minimo: number, maximo: number, ayuda: string): number | null {
  const limpio = limpiar(valor)
  if (!limpio) return null
  if (!/^\d{1,4}$/.test(limpio)) {
    throw new ErrorDeNegocio(`${campo} tiene que ser un número entero, sin letras ni símbolos. ${ayuda}`)
  }
  const numero = Number(limpio)
  if (numero < minimo || numero > maximo) {
    throw new ErrorDeNegocio(`${campo} tiene que estar entre ${minimo} y ${maximo}. ${ayuda}`)
  }
  return numero
}

function validarDatos(datos: DatosDeRegla): ReglaValidada {
  const crudos = objeto(datos, 'Los datos de la regla')
  const sinLimite = 'Dejalo vacío si la compañía no pone límite.'
  return {
    compania: texto(crudos.compania, 'La compañía', 1, 120),
    cobertura: texto(crudos.cobertura, 'La cobertura', 1, 120),
    incluye: opcional(crudos.incluye, 'Lo que incluye', 300),
    franquicia: opcional(crudos.franquicia, 'La franquicia', 120),
    detalle: opcional(crudos.detalle, 'El detalle', 500),
    observaciones: opcional(crudos.observaciones, 'Las observaciones', 500),
    antiguedadMaxima: limite(crudos.antiguedadMaxima, 'La antigüedad máxima', 0, ANTIGUEDAD_ADMITIDA, `Se cuenta en años. ${sinLimite}`),
    anioMinimo: limite(crudos.anioMinimo, 'El año mínimo', 1900, anioDeHoy() + 1, `Es el modelo más viejo que toma. ${sinLimite}`),
  }
}

/** No puede haber dos reglas para la misma compañía y cobertura: no se sabría cuál se aplica. */
function exigirCombinacionLibre(compania: string, cobertura: string, exceptoId: number | null): void {
  const buscada = clave(compania, cobertura)
  const otra = reglasVigentes().find((regla) => regla.id !== exceptoId && clave(regla.compania, regla.cobertura) === buscada)
  if (!otra) return
  const origen = otra.editable ? '' : ' (vino de la hoja de Google)'
  throw new ErrorDeNegocio(
    `Ya hay una regla cargada para ${otra.compania ?? compania} + ${otra.cobertura ?? cobertura}${origen}: editá esa en lugar de cargar otra.`,
  )
}

function buscarPorId(id: number): FilaRegla {
  const fila = db().prepare(`${SELECT_REGLAS} WHERE id = ?`).get(id) as FilaRegla | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa regla. Actualizá la pantalla y probá de nuevo.')
  return fila
}

/** Cómo queda escrito el límite en el historial, para que se entienda sin abrir la pantalla. */
function enPalabras(antiguedadMaxima: number | null, anioMinimo: number | null): string {
  const partes: string[] = []
  if (antiguedadMaxima !== null) partes.push(`hasta ${antiguedadMaxima} ${antiguedadMaxima === 1 ? 'año' : 'años'} de antigüedad`)
  if (anioMinimo !== null) partes.push(`desde el modelo ${anioMinimo}`)
  return partes.length > 0 ? partes.join(' · ') : 'sin límite de antigüedad'
}

function resumen(regla: {
  compania: string | null
  cobertura: string | null
  antiguedadMaxima: number | null
  anioMinimo: number | null
}): string {
  return `${regla.compania ?? ''} · ${regla.cobertura ?? ''} · ${enPalabras(regla.antiguedadMaxima, regla.anioMinimo)}`
}

// ---------------------------------------------------------------------------
// Alta, edición y baja
// ---------------------------------------------------------------------------
//
// Nada de lo que sigue llama a encolar(): la pestaña COBERTURA de la hoja es una matriz de resumen y no
// hay ninguna fila donde escribir estas reglas. Tampoco se anotan con registrarFilaDeLaApp(), que existe
// para que la bajada reconozca filas que sí van a aparecer en la hoja: éstas no van a aparecer nunca y
// además ensuciarían `referencia`, que lee justamente filas_crudas de las pestañas de cobertura.
// La matriz vive sólo en la base local, y el historial deja constancia de quién la tocó.

export function crearRegla(datos: DatosDeRegla, actor: SesionUsuario): MatrizDeCobertura {
  exigirSuperAdmin(actor)
  const validada = validarDatos(datos)
  exigirCombinacionLibre(validada.compania, validada.cobertura, null)

  // El _ID no corresponde a ninguna fila de la hoja: el prefijo lo deja claro de un vistazo y evita
  // que se confunda con un identificador bajado de Google si alguna vez se cruzan las tablas.
  const filaId = `REGLA:${generarId()}`
  const ahora = ahoraIso()
  const resultado = db()
    .prepare(
      `INSERT INTO reglas_cobertura (fila_id, pestana, compania, cobertura, incluye, franquicia, detalle, observaciones,
                                     antiguedad_maxima, anio_minimo, creada_en_la_app, creado_en, actualizado_en)
       VALUES (@fila_id, @pestana, @compania, @cobertura, @incluye, @franquicia, @detalle, @observaciones,
               @antiguedad_maxima, @anio_minimo, 1, @ahora, @ahora)`,
    )
    .run({
      fila_id: filaId,
      pestana: PESTANA_APP,
      compania: validada.compania,
      cobertura: validada.cobertura,
      incluye: validada.incluye,
      franquicia: validada.franquicia,
      detalle: validada.detalle,
      observaciones: validada.observaciones,
      antiguedad_maxima: validada.antiguedadMaxima,
      anio_minimo: validada.anioMinimo,
      ahora,
    })

  registrarCambio(actor, {
    accion: ACCION_COBERTURA,
    tabla: 'reglas_cobertura',
    registroId: Number(resultado.lastInsertRowid),
    filaId,
    campo: `${validada.compania} · ${validada.cobertura}`,
    valorAnterior: null,
    valorNuevo: resumen(validada),
  })
  return matrizDeCobertura(actor)
}

export function editarRegla(id: number, datos: DatosDeRegla, actor: SesionUsuario): MatrizDeCobertura {
  exigirSuperAdmin(actor)
  const identificador = enteroPositivo(id, 'La regla')
  const fila = buscarPorId(identificador)
  const validada = validarDatos(datos)
  const importada = fila.creada_en_la_app !== 1

  // En las reglas que bajaron de la hoja se guarda sólo la antigüedad. El importador reescribe compañía,
  // cobertura, incluye, franquicia, detalle y observaciones en cada corrida con lo que diga la planilla,
  // pero no toca la antigüedad ni el año: cambiar el texto acá sería prometer algo que la próxima
  // importación deshace en silencio. Lo que se completa —y sobrevive— es el límite de antigüedad.
  const antes = aRegla(fila)
  const despues = {
    compania: importada ? fila.compania : validada.compania,
    cobertura: importada ? fila.cobertura : validada.cobertura,
    incluye: importada ? fila.incluye : validada.incluye,
    franquicia: importada ? fila.franquicia : validada.franquicia,
    detalle: importada ? fila.detalle : validada.detalle,
    observaciones: importada ? fila.observaciones : validada.observaciones,
    antiguedadMaxima: validada.antiguedadMaxima,
    anioMinimo: validada.anioMinimo,
  }
  if (!importada) exigirCombinacionLibre(validada.compania, validada.cobertura, identificador)

  const sinCambios =
    antes.compania === despues.compania &&
    antes.cobertura === despues.cobertura &&
    antes.incluye === despues.incluye &&
    antes.franquicia === despues.franquicia &&
    antes.detalle === despues.detalle &&
    antes.observaciones === despues.observaciones &&
    antes.antiguedadMaxima === despues.antiguedadMaxima &&
    antes.anioMinimo === despues.anioMinimo
  // Abrir el formulario y guardar sin tocar nada no es un cambio: no ensucia el historial.
  if (sinCambios) return matrizDeCobertura(actor)

  db()
    .prepare(
      `UPDATE reglas_cobertura
       SET compania = @compania, cobertura = @cobertura, incluye = @incluye, franquicia = @franquicia,
           detalle = @detalle, observaciones = @observaciones, antiguedad_maxima = @antiguedad_maxima,
           anio_minimo = @anio_minimo, actualizado_en = @ahora
       WHERE id = @id`,
    )
    .run({
      compania: despues.compania,
      cobertura: despues.cobertura,
      incluye: despues.incluye,
      franquicia: despues.franquicia,
      detalle: despues.detalle,
      observaciones: despues.observaciones,
      antiguedad_maxima: despues.antiguedadMaxima,
      anio_minimo: despues.anioMinimo,
      ahora: ahoraIso(),
      id: identificador,
    })

  registrarCambio(actor, {
    accion: ACCION_COBERTURA,
    tabla: 'reglas_cobertura',
    registroId: identificador,
    filaId: fila.fila_id,
    campo: `${despues.compania ?? ''} · ${despues.cobertura ?? ''}`,
    valorAnterior: resumen(antes),
    valorNuevo: resumen(despues),
  })
  return matrizDeCobertura(actor)
}

export function borrarRegla(id: number, actor: SesionUsuario): MatrizDeCobertura {
  exigirSuperAdmin(actor)
  const identificador = enteroPositivo(id, 'La regla')
  const fila = buscarPorId(identificador)

  // Borrar una regla que vino de la hoja no sirve de nada: la próxima importación la vuelve a crear con
  // el mismo _ID. Lo que de verdad apaga la advertencia es dejarle los dos límites vacíos, así que se
  // explica eso en lugar de dejar que el borrado «funcione» y reaparezca sola al rato.
  if (fila.creada_en_la_app !== 1) {
    throw new ErrorDeNegocio(
      `«${fila.compania ?? 'Esa regla'} · ${fila.cobertura ?? ''}» vino de la hoja de Google y la próxima importación la volvería a traer. ` +
        'Si no querés que avise, editala y dejá vacías la antigüedad máxima y el año mínimo.',
    )
  }

  db().prepare('DELETE FROM reglas_cobertura WHERE id = ?').run(identificador)

  registrarCambio(actor, {
    accion: ACCION_COBERTURA,
    tabla: 'reglas_cobertura',
    registroId: identificador,
    filaId: fila.fila_id,
    campo: `${fila.compania ?? ''} · ${fila.cobertura ?? ''}`,
    valorAnterior: resumen(aRegla(fila)),
    valorNuevo: null,
  })
  return matrizDeCobertura(actor)
}
