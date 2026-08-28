// Marketing: los segmentos de la cartera y el aviso uno por uno.
//
// Un segmento es un filtro guardado sobre la planilla del mes abierto —«forma de pago CUPONERA +
// vence esta semana + Lanús»— que devuelve la lista de gente a la que hay que escribirle, con el
// mensaje ya armado con la plantilla que se le haya puesto.
//
// NO HAY ENVÍO MASIVO, y no es un olvido: WhatsApp bloquea las cuentas que mandan tandas automáticas,
// y la cuenta de la agencia es la que usa todo el día para atender. El envío es siempre uno a uno, con
// un clic por persona, exactamente igual que el botón «Avisar» de la Cartera: lo que aporta el
// segmento es no tener que buscar a quién le toca.
import { esDebitoAutomatico, fechaDeVencimiento, hoyLocal } from '../../shared/semaforo'
import { mismaSucursal } from '../../shared/sucursales'
import {
  CLAVE_AVISO_DE_VENCIMIENTO,
  SEGMENTO_SIN_FILTROS,
  VENTANAS_DE_VENCIMIENTO,
  type AvisoDeSegmento,
  type DatosDeSegmento,
  type FilaCartera,
  type FilaDeSegmento,
  type FiltrosDeSegmento,
  type ResultadoDeSegmento,
  type Segmento,
  type SesionUsuario,
  type VentanaDeVencimiento,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, limpiar, normalizarTexto } from '../importacion/normalizar'
import { aFila, armarMensaje, catalogos, periodosDisponibles, prepararAvisoDeCuota, SELECT_PLANILLA, type FilaCruda } from './cartera'
import { diasCoberturaPorCompania } from './companias'
import { ErrorDeNegocio } from './errores'
import { listarPlantillas, plantillaDeAviso, textoDePlantilla } from './plantillas'
import { enteroPositivo, texto } from './validacion'

/** Cuántos días mira «vence esta semana». */
const DIAS_DE_LA_SEMANA = 7

function mismaCosa(a: string | null, b: string): boolean {
  return normalizarTexto(a) === normalizarTexto(b)
}

function aDia(iso: string): number {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(anio ?? 1970, (mes ?? 1) - 1, dia ?? 1) / 86_400_000)
}

/** Último día del mes de una fecha ISO, también en ISO. */
function finDelMes(iso: string): string {
  const anio = Number(iso.slice(0, 4))
  const mes = Number(iso.slice(5, 7))
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return `${iso.slice(0, 7)}-${String(dias).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

/**
 * Deja los filtros en una forma que se pueda guardar y volver a leer sin sorpresas. Lo que viene de
 * la pantalla y lo que viene del JSON guardado pasan los dos por acá: un segmento guardado con una
 * versión vieja no puede romper la pantalla.
 */
export function sanearFiltrosDeSegmento(bruto: unknown): FiltrosDeSegmento {
  const datos = (bruto ?? {}) as Partial<FiltrosDeSegmento>
  const vence = VENTANAS_DE_VENCIMIENTO.includes(datos.vence as VentanaDeVencimiento) ? (datos.vence as VentanaDeVencimiento) : ''
  return {
    sucursal: limpiar(datos.sucursal),
    compania: limpiar(datos.compania),
    formaPago: limpiar(datos.formaPago),
    vence,
    soloImpagas: datos.soloImpagas !== false,
    soloSinAvisar: datos.soloSinAvisar === true,
    excluirDebito: datos.excluirDebito !== false,
  }
}

function coincide(fila: FilaCartera, vencimiento: string | null, filtros: FiltrosDeSegmento, hoy: string): boolean {
  // La sucursal, con `mismaSucursal`: el desplegable del segmento sale de `catalogos().sucursales`,
  // que pliega «AVELLANEDA» dentro de «Dock Sud», y el aviso tiene que salir para esas cuotas también.
  if (filtros.sucursal && !mismaSucursal(fila.sucursal, filtros.sucursal)) return false
  if (filtros.compania && !mismaCosa(fila.compania, filtros.compania)) return false
  if (filtros.formaPago && !mismaCosa(fila.formaPago, filtros.formaPago)) return false
  if (filtros.excluirDebito && esDebitoAutomatico(fila.formaPago)) return false
  if (filtros.soloImpagas && (limpiar(fila.pago) !== '' || fila.pagoRegistrado)) return false
  if (filtros.soloSinAvisar && estaAvisada(fila)) return false

  if (filtros.vence) {
    // Una fila sin día de vencimiento no puede entrar en ninguna ventana: no se sabe cuándo vence.
    if (!vencimiento) return false
    const dias = aDia(vencimiento) - aDia(hoy)
    if (filtros.vence === 'VENCIDAS') return dias < 0
    if (filtros.vence === 'ESTA SEMANA') return dias >= 0 && dias <= DIAS_DE_LA_SEMANA
    if (filtros.vence === 'ESTE MES') return dias >= 0 && aDia(vencimiento) <= aDia(finDelMes(hoy))
  }
  return true
}

/** true si la fila ya tiene el aviso mandado en este mes. */
function estaAvisada(fila: FilaCartera): boolean {
  return limpiar(fila.fechaEnvio) !== '' || normalizarTexto(fila.aviso) === 'ENVIADO'
}

function aFilaDeSegmento(fila: FilaCartera, plantilla: string, hoy: string): FilaDeSegmento {
  const vencimiento = fechaDeVencimiento(fila.periodo, fila.diaVencimientoNumero)
  return {
    filaId: fila.filaId,
    periodo: fila.periodo,
    clienteId: fila.clienteId,
    nombre: fila.nombre,
    telefono: fila.telefono,
    sucursal: fila.sucursal,
    compania: fila.compania,
    numeroPoliza: fila.numeroPoliza,
    patente: fila.patente,
    cuota: fila.cuota,
    cuotaMonto: fila.cuotaMonto,
    formaPago: fila.formaPago,
    diaVencimiento: fila.diaVencimiento,
    vencimiento,
    diasParaVencer: vencimiento ? aDia(vencimiento) - aDia(hoy) : null,
    pagada: limpiar(fila.pago) !== '' || fila.pagoRegistrado,
    avisado: estaAvisada(fila),
    fechaEnvio: fila.fechaEnvio,
    mensaje: armarMensaje(plantilla, fila),
    tieneTelefono: limpiar(fila.telefono).replace(/\D+/g, '').length >= 6,
  }
}

// ---------------------------------------------------------------------------
// Segmentos guardados
// ---------------------------------------------------------------------------

interface SegmentoCrudo {
  id: number
  nombre: string
  descripcion: string | null
  filtros_json: string
  plantilla_clave: string | null
  creado_por: string
  actualizado_en: string
}

function aSegmento(cruda: SegmentoCrudo): Segmento {
  let filtros = SEGMENTO_SIN_FILTROS
  try {
    filtros = sanearFiltrosDeSegmento(JSON.parse(cruda.filtros_json))
  } catch {
    // Un JSON roto no puede dejar la pantalla en blanco: el segmento se muestra sin filtros y se
    // vuelve a guardar con un clic.
  }
  return {
    id: cruda.id,
    nombre: cruda.nombre,
    descripcion: cruda.descripcion,
    filtros,
    plantillaClave: cruda.plantilla_clave,
    creadoPor: cruda.creado_por,
    actualizadoEn: cruda.actualizado_en,
  }
}

const SELECT_SEGMENTOS = `SELECT id, nombre, descripcion, filtros_json, plantilla_clave, creado_por, actualizado_en FROM segmentos`

export function listarSegmentos(): Segmento[] {
  return (db().prepare(`${SELECT_SEGMENTOS} ORDER BY nombre`).all() as SegmentoCrudo[]).map(aSegmento)
}

function buscarSegmento(id: number): Segmento {
  const cruda = db().prepare(`${SELECT_SEGMENTOS} WHERE id = ?`).get(id) as SegmentoCrudo | undefined
  if (!cruda) throw new ErrorDeNegocio('No se encontró ese segmento. Actualizá la pantalla y probá de nuevo.')
  return aSegmento(cruda)
}

// ---------------------------------------------------------------------------
// El resultado de un segmento
// ---------------------------------------------------------------------------

/** La plantilla que se va a usar: la pedida, la del segmento, o la de vencimiento. */
function resolverPlantilla(clave: string): { clave: string; texto: string } {
  const pedida = limpiar(clave)
  if (pedida) {
    const guardada = textoDePlantilla(pedida)
    if (guardada.trim()) return { clave: pedida, texto: guardada }
  }
  return { clave: CLAVE_AVISO_DE_VENCIMIENTO, texto: plantillaDeAviso() }
}

/**
 * La lista de gente de un segmento. Siempre sobre el mes abierto: avisarle a alguien por una cuota de
 * un mes ya cerrado es trabajo de la Mora, que además sabe cuántos días de atraso lleva.
 *
 * `segmentoId` en null es un filtro suelto que todavía no se guardó, que es como se arman.
 *
 * `hoy` es sólo para las pruebas: en la aplicación siempre es el día de la máquina, igual que en la mora.
 */
export function resultadoDeSegmento(
  segmentoId: number | null,
  filtrosPedidos: FiltrosDeSegmento | null,
  plantillaPedida: string,
  hoy = hoyLocal(),
): ResultadoDeSegmento {
  const guardado = typeof segmentoId === 'number' && segmentoId > 0 ? buscarSegmento(segmentoId) : null
  const filtros = sanearFiltrosDeSegmento(filtrosPedidos ?? guardado?.filtros ?? SEGMENTO_SIN_FILTROS)
  const plantilla = resolverPlantilla(limpiar(plantillaPedida) || guardado?.plantillaClave || '')

  const periodo = periodosDisponibles()[0]?.periodo ?? ''
  const dias = diasCoberturaPorCompania()
  const crudas = periodo
    ? (db()
        .prepare(`${SELECT_PLANILLA} WHERE c.periodo = ? AND c.dada_de_baja = 0 ORDER BY c.dia_vencimiento_numero, nombre`)
        .all(periodo) as FilaCruda[])
    : []

  const todas = crudas.map((cruda) => aFila(cruda, dias))
  const filas = todas
    .filter((fila) => coincide(fila, fechaDeVencimiento(fila.periodo, fila.diaVencimientoNumero), filtros, hoy))
    .map((fila) => aFilaDeSegmento(fila, plantilla.texto, hoy))

  const catalogo = catalogos()
  return {
    segmentoId: guardado?.id ?? null,
    filtros,
    plantillaClave: plantilla.clave,
    plantillas: listarPlantillas(),
    segmentos: listarSegmentos(),
    periodo,
    filas,
    total: filas.length,
    avisados: filas.filter((fila) => fila.avisado).length,
    sinTelefono: filas.filter((fila) => !fila.tieneTelefono).length,
    sucursales: catalogo.sucursales,
    companias: catalogo.companias,
    formasDePago: catalogo.formasDePago,
    hoy,
  }
}

export function guardarSegmento(segmentoId: number | null, datos: DatosDeSegmento, actor: SesionUsuario): ResultadoDeSegmento {
  const nombre = texto(datos?.nombre, 'El nombre del segmento', 2, 60)
  const filtros = sanearFiltrosDeSegmento(datos?.filtros)
  const plantilla = resolverPlantilla(limpiar(datos?.plantillaClave))
  const descripcion = (datos?.descripcion ?? '').trim() || null
  const ahora = ahoraIso()

  const repetido = db()
    .prepare('SELECT id FROM segmentos WHERE nombre = ? COLLATE NOCASE AND id <> ?')
    .get(nombre, segmentoId ?? 0)
  if (repetido) throw new ErrorDeNegocio(`Ya hay un segmento que se llama «${nombre}».`)

  let id = segmentoId ?? 0
  if (id > 0) {
    buscarSegmento(id)
    db()
      .prepare('UPDATE segmentos SET nombre = ?, descripcion = ?, filtros_json = ?, plantilla_clave = ?, actualizado_en = ? WHERE id = ?')
      .run(nombre, descripcion, JSON.stringify(filtros), plantilla.clave, ahora, id)
  } else {
    const fila = db()
      .prepare(
        `INSERT INTO segmentos (nombre, descripcion, filtros_json, plantilla_clave, usuario_id, creado_por, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(nombre, descripcion, JSON.stringify(filtros), plantilla.clave, actor.id, actor.nombre, ahora, ahora) as { id: number }
    id = fila.id
  }
  return resultadoDeSegmento(id, filtros, plantilla.clave)
}

export function borrarSegmento(segmentoId: number): ResultadoDeSegmento {
  const id = enteroPositivo(segmentoId, 'El segmento')
  buscarSegmento(id)
  db().prepare('DELETE FROM segmentos WHERE id = ?').run(id)
  return resultadoDeSegmento(null, null, '')
}

// ---------------------------------------------------------------------------
// Avisar, de a uno
// ---------------------------------------------------------------------------

/**
 * Prepara el WhatsApp de una fila del segmento con la plantilla elegida y deja la fila marcada como
 * avisada, igual que el botón de la Cartera. Devuelve además el contador de avisados actualizado: es
 * lo que la pantalla muestra para saber por dónde va la tanda.
 */
export function avisarDeSegmento(
  filaId: string,
  segmentoId: number | null,
  filtros: FiltrosDeSegmento | null,
  plantillaPedida: string,
  actor: SesionUsuario,
): AvisoDeSegmento {
  const plantilla = resolverPlantilla(limpiar(plantillaPedida))
  const aviso = prepararAvisoDeCuota(filaId, actor, false, plantilla.texto)
  const resultado = resultadoDeSegmento(segmentoId, filtros, plantilla.clave)
  const enLaLista = resultado.filas.find((fila) => fila.filaId === filaId)
  return {
    url: aviso.url,
    mensaje: aviso.mensaje,
    telefono: aviso.telefono,
    // Si el aviso la sacó de la lista (el segmento pedía «sin avisar»), se devuelve igual la fila
    // recién actualizada: la pantalla necesita algo que mostrar mientras se va.
    fila: enLaLista ?? aFilaDeSegmento(aviso.fila, plantilla.texto, resultado.hoy),
    marcada: aviso.marcada,
    avisados: resultado.avisados,
  }
}
