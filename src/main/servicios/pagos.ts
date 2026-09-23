// Todo lo que escribe o lee la tabla `pagos`. Es una sola tabla que cumple dos papeles:
//  - la CAJA DEL DÍA: qué se cobró hoy, en qué sucursal, con qué medio y quién lo cobró;
//  - la RENDICIÓN MENSUAL (la pestaña IMPUTADOS de la hoja), con su columna RESULTADO.
//
// Vive aparte de cartera.ts porque lo usan los dos lados —la planilla del mes y el módulo Cobranzas—
// y así no se importan entre ellos.
import {
  ESTADOS_DE_COBRO,
  MODOS_DE_ADELANTO,
  RESULTADOS_DE_IMPUTACION,
  type EstadoDeCobro,
  type ModoDeAdelanto,
  type PagoRegistrado,
  type ResultadoImputacion,
  type SesionUsuario,
} from '../../shared/tipos'
import { db } from '../db/base'
import { resolverCampo, type Campo } from '../importacion/encabezados'
import { MESES } from '../importacion/pestanas'
import { ahoraIso, limpiar, interpretarNumero, normalizarTexto } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { PESTANA_PAGOS_APP } from '../sincronizacion/pestanasApp'
import { registrarFilaDeLaApp } from './filas'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { enteroPositivo, texto as validarTexto } from './validacion'

// ---------------------------------------------------------------------------
// El RESULTADO de la rendición
// ---------------------------------------------------------------------------

/** Cómo se escribe en la hoja lo que la gente pone a mano en la columna RESULTADO. */
const SINONIMOS_DE_RESULTADO: Record<string, ResultadoImputacion> = {
  IMPUTADO: 'IMPUTADO',
  IMPUTADA: 'IMPUTADO',
  IMPUTADOS: 'IMPUTADO',
  IMP: 'IMPUTADO',
  OK: 'OK',
  BIEN: 'OK',
  CORRECTO: 'OK',
  CONCILIADO: 'OK',
  REVISAR: 'REVISAR',
  'A REVISAR': 'REVISAR',
  REVISION: 'REVISAR',
  'EN REVISION': 'REVISAR',
  DUDA: 'REVISAR',
  MAL: 'MAL',
  ERROR: 'MAL',
  INCORRECTO: 'MAL',
  'NO IMPUTADO': 'MAL',
}

/** Lleva a la lista cerrada lo que haya guardado. Lo que no se reconoce queda como pendiente. */
export function normalizarResultado(valor: unknown): ResultadoImputacion {
  const texto = normalizarTexto(valor)
  if (!texto) return ''
  if ((RESULTADOS_DE_IMPUTACION as readonly string[]).includes(texto)) return texto as ResultadoImputacion
  return SINONIMOS_DE_RESULTADO[texto] ?? ''
}

// ---------------------------------------------------------------------------
// El estado del COBRO (PAGO / IMPUTADO) y el modo de un pago adelantado
// ---------------------------------------------------------------------------

/** Cómo se escribe en la columna COBRO de la hoja lo que la gente pone a mano. */
const SINONIMOS_DE_COBRO: Record<string, EstadoDeCobro> = {
  PAGO: 'PAGO',
  PAGADO: 'PAGO',
  PAGADA: 'PAGO',
  COBRADO: 'PAGO',
  COBRADA: 'PAGO',
  IMPUTADO: 'IMPUTADO',
  IMPUTADA: 'IMPUTADO',
  'A COBRAR': 'IMPUTADO',
  'FALTA COBRAR': 'IMPUTADO',
  'SIN COBRAR': 'IMPUTADO',
}

/**
 * Lleva a PAGO o IMPUTADO lo que haya guardado. Lo que no se reconoce (y el vacío, que es lo que traen
 * todos los pagos de antes de la 12.3 y los de una hoja sin columna COBRO) es PAGO: es lo prudente,
 * porque IMPUTADO deja la fila del mes sin pagar y fuera de la caja.
 */
export function normalizarEstadoDeCobro(valor: unknown): EstadoDeCobro {
  const texto = normalizarTexto(valor)
  if (!texto) return 'PAGO'
  if ((ESTADOS_DE_COBRO as readonly string[]).includes(texto)) return texto as EstadoDeCobro
  return SINONIMOS_DE_COBRO[texto] ?? 'PAGO'
}

/** El modo de un pago adelantado tal como está guardado, o null si no es un adelanto o no se reconoce. */
export function normalizarModoDeAdelanto(valor: unknown): ModoDeAdelanto | null {
  const texto = normalizarTexto(valor)
  return (MODOS_DE_ADELANTO as readonly string[]).includes(texto) ? (texto as ModoDeAdelanto) : null
}

/**
 * El _ID de la fila de la planilla que paga un pago, sacado de su propio _ID: el cobro de una cuota
 * viaja como «PAGO:<_ID de la fila>» (ver `idDeLaFilaDelPago` en cartera.ts). Un adelanto
 * («PAGO:ADELANTO:<_ID>») no paga la fila de la que salió sino la del mes que viene, y ésa se ata al
 * imputarlo; un pago suelto de Cobranzas lleva un _ID al azar. Los dos devuelven null.
 *
 * Lo usa la importación: hasta la 15.4.2 el pago que llegaba de otra computadora entraba sin
 * `cuota_fila_id`, y la planilla sólo lo reconocía si la póliza y el mes coincidían. Cuando la póliza
 * no se encontraba (un número escrito distinto, un cliente sin póliza en esta base), la fila seguía
 * «Vencido» acá aunque en la computadora que cobró figurara paga.
 */
export function cuotaDelPago(filaId: string): string | null {
  if (!filaId.startsWith('PAGO:') || filaId.startsWith('PAGO:ADELANTO:')) return null
  return filaId.slice('PAGO:'.length) || null
}

// ---------------------------------------------------------------------------
// La pestaña IMPUTADOS de la hoja
// ---------------------------------------------------------------------------

export interface HojaDeImputados {
  /**
   * Título de la pestaña donde viajan los pagos: la IMPUTADOS de la agencia si es una tabla por fila,
   * y si no, «APP PAGOS», la que crea la aplicación (ver `esDeLaApp`). Nunca es null desde la 12.2.
   */
  pestana: string
  /** true si esa pestaña tiene una columna que se reconoce como RESULTADO. */
  tieneColumnaResultado: boolean
  /** Por qué el RESULTADO no va a viajar a la hoja, o null si sí va. */
  aviso: string | null
  /**
   * true cuando los pagos viajan por «APP PAGOS», la pestaña que la aplicación crea sola al final de
   * la base cuando la agencia no tiene una IMPUTADOS que sea una tabla por fila. Es lo que hace que el
   * pago que cobra una computadora aparezca en la caja del día de las otras: hasta la 12.1 quedaba
   * sólo en la que lo cobró, y en Lanús cada mostrador veía nada más que lo suyo.
   */
  esDeLaApp: boolean
}

const POR_LA_APP: HojaDeImputados = { pestana: PESTANA_PAGOS_APP, tieneColumnaResultado: true, aviso: null, esDeLaApp: true }

/** Campos que tiene que reconocer una pestaña para que valga como tabla de pagos. */
const CAMPOS_MINIMOS: Campo[] = ['fecha', 'importe']

/**
 * La pestaña por la que viajan los pagos. Si la agencia tiene una IMPUTADOS que sea una tabla por fila
 * se sigue usando ésa (es la que mira la contadora); si no —la de la agencia es una matriz de resumen
 * con años y totales, sin una fila por pago— los pagos van a «APP PAGOS», que el motor crea sola la
 * primera vez que hay algo que subir, igual que APP RECHAZOS.
 */
export function hojaDeImputados(): HojaDeImputados {
  const candidata = db()
    .prepare(
      `SELECT pestana, COUNT(*) AS filas FROM filas_crudas
       WHERE tipo_pestana = 'PAGOS' AND en_la_hoja = 1 AND pestana <> ?
       GROUP BY pestana ORDER BY filas DESC LIMIT 1`,
    )
    .get(PESTANA_PAGOS_APP) as { pestana: string; filas: number } | undefined
  if (!candidata) return POR_LA_APP

  const cruda = db()
    .prepare(`SELECT datos_json FROM filas_crudas WHERE pestana = ? AND datos_json <> '{}' LIMIT 1`)
    .get(candidata.pestana) as { datos_json: string } | undefined
  const campos = new Set<Campo>()
  if (cruda) {
    for (const encabezado of Object.keys(JSON.parse(cruda.datos_json) as Record<string, string>)) {
      const campo = resolverCampo(encabezado, 'PAGOS')
      if (campo) campos.add(campo)
    }
  }
  const esTabla = campos.size >= 3 && CAMPOS_MINIMOS.some((campo) => campos.has(campo))
  if (!esTabla) return POR_LA_APP

  const tieneColumnaResultado = campos.has('resultado')
  return {
    pestana: candidata.pestana,
    tieneColumnaResultado,
    esDeLaApp: false,
    aviso: tieneColumnaResultado
      ? null
      : `La pestaña «${candidata.pestana}» de la hoja no tiene columna RESULTADO. Agregale una con ese ` +
        'encabezado y volvé a importar; hasta entonces el resultado queda guardado sólo en DM Gestión.',
  }
}

/** Nombre del mes en mayúscula, como se escribe en la columna MES de la hoja. */
export function nombreDeMesDelPeriodo(periodo: string | null): string {
  if (!periodo) return ''
  return MESES[Number(periodo.slice(5, 7)) - 1] ?? periodo
}

/**
 * Lo que va en la columna MES de la hoja. Un pago común lleva el mes solo («AGOSTO»), como siempre
 * lo escribió la agencia. Un pago ADELANTADO lleva también el año («ENERO 2027»): su mes es el que
 * viene, y el importador deduce el año a partir de la fecha del pago, que para un adelanto de
 * diciembre a enero sería el año equivocado.
 */
export function mesParaLaHoja(periodo: string | null, adelantado: boolean): string {
  const mes = nombreDeMesDelPeriodo(periodo)
  if (!adelantado || !periodo || !mes || mes === periodo) return mes
  return `${mes} ${periodo.slice(0, 4)}`
}

// ---------------------------------------------------------------------------
// Guardar un pago
// ---------------------------------------------------------------------------

export interface PagoAGuardar {
  /** _ID del pago. Para una cuota de la planilla es 'PAGO:<_ID de la fila>', así no se duplica. */
  filaId: string
  /** Fila de la planilla del mes que se está pagando; null si es un pago suelto. */
  cuotaFilaId: string | null
  clienteId: number | null
  polizaId: number | null
  clienteNombre: string | null
  documento: string | null
  compania: string | null
  numeroPoliza: string | null
  patente: string | null
  /** Sucursal del cliente (la que trae la fila), para conservarla junto al pago. */
  sucursalCliente: string | null
  /** Sucursal donde se cobró; si viene vacía se usa la del usuario. */
  sucursalCobro: string | null
  /** Fecha tal cual se escribió y su versión interpretada. */
  fecha: string
  fechaIso: string
  importe: string | null
  medio: string | null
  periodo: string | null
  observaciones: string | null
  resultado: ResultadoImputacion
  /** PAGO (el cliente pagó) o IMPUTADO (se imputó a la compañía; el cliente paga después). */
  estadoCobro: EstadoDeCobro
  /** Sólo para un pago adelantado (la cuota del mes que viene): qué se hace con él al armar ese mes. */
  adelantoModo: ModoDeAdelanto | null
}

const INSERTAR_PAGO = `
  INSERT INTO pagos (fila_id, pestana, cliente_id, poliza_id, fecha, fecha_iso, cliente_nombre, documento, compania,
                     numero_poliza, patente, sucursal_texto, importe, importe_monto, medio, periodo_texto, periodo,
                     observaciones, resultado, usuario_id, usuario_nombre, sucursal_cobro, cuota_fila_id,
                     estado_cobro, adelanto_modo, hecho_en_la_app, creado_en, actualizado_en)
  VALUES (@fila_id, @pestana, @cliente_id, @poliza_id, @fecha, @fecha_iso, @cliente_nombre, @documento, @compania,
          @numero_poliza, @patente, @sucursal_texto, @importe, @importe_monto, @medio, @periodo_texto, @periodo,
          @observaciones, @resultado, @usuario_id, @usuario_nombre, @sucursal_cobro, @cuota_fila_id,
          @estado_cobro, @adelanto_modo, 1, @ahora, @ahora)
  ON CONFLICT(fila_id) DO UPDATE SET
    fecha = excluded.fecha, fecha_iso = excluded.fecha_iso, importe = excluded.importe,
    importe_monto = excluded.importe_monto, medio = excluded.medio, observaciones = excluded.observaciones,
    usuario_id = excluded.usuario_id, usuario_nombre = excluded.usuario_nombre,
    sucursal_cobro = excluded.sucursal_cobro,
    -- El cobro se corrige entero: un IMPUTADO que el cliente terminó pagando pasa a PAGO, y un pago
    -- adelantado que se vuelve a registrar puede cambiar de modo o quedar apuntando a su fila.
    estado_cobro = excluded.estado_cobro, adelanto_modo = excluded.adelanto_modo,
    cuota_fila_id = COALESCE(excluded.cuota_fila_id, pagos.cuota_fila_id),
    periodo = excluded.periodo, periodo_texto = excluded.periodo_texto,
    -- La pestaña se reescribe: un pago que se registró cuando la hoja todavía no tenía IMPUTADOS
    -- pasa a apuntar a la pestaña en cuanto aparece, y con eso su RESULTADO vuelve a sincronizarse.
    pestana = excluded.pestana, actualizado_en = excluded.actualizado_en`

/**
 * Los campos del pago con los nombres que entiende la sincronización.
 *
 * `conRendicion` es lo que separa las dos cosas que conviven en la misma fila: el COBRO (fecha,
 * importe, medio…) y la RENDICIÓN (RESULTADO y observaciones), que completa la contadora. Al agregar
 * la fila viajan las dos; al corregir un cobro, sólo la primera, o corregir el importe le borraría a
 * la contadora el IMPUTADO que ya había puesto en la hoja.
 */
function camposParaLaHoja(
  datos: PagoAGuardar,
  sucursalCobro: string,
  conRendicion: boolean,
  hoja: HojaDeImputados,
  actor: SesionUsuario | null,
  cobro: EstadoDeCobro | null,
): Record<string, string> {
  const campos: Record<string, string> = {
    fecha: datos.fecha,
    nombre: datos.clienteNombre ?? '',
    documento: datos.documento ?? '',
    sucursal: sucursalCobro,
    compania: datos.compania ?? '',
    numero_poliza: datos.numeroPoliza ?? '',
    patente: datos.patente ?? '',
    importe: datos.importe ?? '',
    medio_pago: datos.medio ?? '',
    mes: mesParaLaHoja(datos.periodo, datos.adelantoModo !== null),
  }
  if (conRendicion) {
    campos.observaciones = datos.observaciones ?? ''
    campos.resultado = datos.resultado
  }
  // Quién cobró viaja sólo por APP PAGOS, que tiene la columna: la IMPUTADOS de una agencia no la
  // tiene, y mandarla igual anotaría «columna faltante» en cada ciclo.
  if (hoja.esDeLaApp && actor) campos.usuario = actor.nombre
  // El estado del cobro viaja sólo cuando hay algo que decir (un IMPUTADO, o un IMPUTADO que pasó a
  // PAGO): la columna COBRO es nueva en APP PAGOS, y las hojas armadas antes no la tienen. Mandarla
  // en cada pago común anotaría «columna faltante» en cada ciclo en todas ellas.
  if (cobro !== null) campos.cobro = cobro
  return campos
}

/**
 * Guarda el pago y, si la hoja tiene una pestaña IMPUTADOS que sirva, lo encola para agregarlo o
 * actualizarlo allá. Devuelve el id del pago.
 *
 * Que el pago vaya a la hoja es lo que hace que la rendición esté completa: si no, el mes siguiente
 * la contadora vería en IMPUTADOS sólo lo que alguien cargó a mano.
 */
export function guardarPago(datos: PagoAGuardar, actor: SesionUsuario): number {
  const hoja = hojaDeImputados()
  const sucursalCobro = limpiar(datos.sucursalCobro) || actor.sucursal.nombre
  const conocida = db().prepare('SELECT pestana, en_la_hoja FROM filas_crudas WHERE fila_id = ?').get(datos.filaId) as
    | { pestana: string; en_la_hoja: number }
    | undefined
  const anterior = db().prepare('SELECT estado_cobro FROM pagos WHERE fila_id = ?').get(datos.filaId) as
    | { estado_cobro: string | null }
    | undefined
  const ahora = ahoraIso()

  db()
    .prepare(INSERTAR_PAGO)
    .run({
      fila_id: datos.filaId,
      pestana: hoja.pestana,
      cliente_id: datos.clienteId,
      poliza_id: datos.polizaId,
      fecha: datos.fecha,
      fecha_iso: datos.fechaIso,
      cliente_nombre: datos.clienteNombre,
      documento: datos.documento,
      compania: datos.compania,
      numero_poliza: datos.numeroPoliza,
      patente: datos.patente,
      sucursal_texto: datos.sucursalCliente,
      importe: datos.importe || null,
      importe_monto: interpretarNumero(datos.importe),
      medio: datos.medio || null,
      periodo_texto: nombreDeMesDelPeriodo(datos.periodo) || null,
      periodo: datos.periodo,
      observaciones: datos.observaciones || null,
      resultado: datos.resultado || null,
      usuario_id: actor.id,
      usuario_nombre: actor.nombre,
      sucursal_cobro: sucursalCobro,
      cuota_fila_id: datos.cuotaFilaId,
      estado_cobro: datos.estadoCobro,
      adelanto_modo: datos.adelantoModo,
      ahora,
    })

  const { id } = db().prepare('SELECT id FROM pagos WHERE fila_id = ?').get(datos.filaId) as { id: number }

  // Qué decir de cobro en la hoja: el IMPUTADO siempre, y el PAGO sólo si deja de ser un IMPUTADO.
  const cobroAnterior = anterior ? normalizarEstadoDeCobro(anterior.estado_cobro) : 'PAGO'
  const cobro: EstadoDeCobro | null =
    datos.estadoCobro === 'IMPUTADO' || cobroAnterior === 'IMPUTADO' ? datos.estadoCobro : null

  // Si la fila todavía no llegó a la hoja se vuelve a encolar como «crear»: la cola junta los dos
  // pedidos en uno solo, así no quedan dos filas ni un «actualizar» sobre algo que no existe.
  const nueva = !conocida || conocida.en_la_hoja === 0
  if (nueva) {
    registrarFilaDeLaApp({ filaId: datos.filaId, pestana: hoja.pestana, tipoPestana: 'PAGOS', periodo: datos.periodo })
  }
  encolar(
    {
      operacion: nueva ? 'crear' : 'actualizar',
      pestana: nueva ? hoja.pestana : (conocida?.pestana ?? hoja.pestana),
      filaId: datos.filaId,
      campos: camposParaLaHoja(datos, sucursalCobro, nueva, hoja, actor, cobro),
    },
    actor,
  )
  return id
}

/**
 * Anula un pago cargado por error (la fila equivocada, el cliente equivocado): lo saca de la caja del
 * día, de la rendición y de la hoja —con el mismo `borrar` que usa `borrarMovimientoDeCaja` para un
 * renglón de la caja chica—, y si había dejado paga una cuota de la planilla la vuelve a dejar sin
 * pagar. El pago no queda «marcado como anulado»: se borra entero, porque `registrarCambio` ya deja
 * en el historial de la fila quién lo anuló, cuándo y por qué, que es lo único que hace falta después.
 *
 * Dos casos quedan afuera a propósito, con un error claro en vez de una reversión a ciegas:
 *  - un pago ADELANTADO (`idDeLaFilaDelAdelanto`), porque además puede haber acreditado la cuota del
 *    mes que viene, y desarmar eso desde acá es tan peligroso como el error que se quiere corregir;
 *  - un pago que ya tiene un RESULTADO de rendición cargado, porque ya lo miró la contadora y borrarlo
 *    le haría desaparecer algo que ya concilió.
 */
export function anularPago(pagoId: unknown, motivo: unknown, actor: SesionUsuario): void {
  const id = enteroPositivo(pagoId, 'El pago')
  const pago = db()
    .prepare(
      `SELECT id, fila_id, pestana, cuota_fila_id, estado_cobro, resultado, fecha, importe, medio, cliente_nombre
         FROM pagos WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number
        fila_id: string
        pestana: string
        cuota_fila_id: string | null
        estado_cobro: string | null
        resultado: string | null
        fecha: string | null
        importe: string | null
        medio: string | null
        cliente_nombre: string | null
      }
    | undefined
  if (!pago) throw new ErrorDeNegocio('No se encontró ese pago.')
  if (pago.fila_id.startsWith('PAGO:ADELANTO:')) {
    throw new ErrorDeNegocio('Un pago adelantado todavía no se puede anular desde acá: corregilo a mano en la hoja.')
  }
  if (normalizarResultado(pago.resultado)) {
    throw new ErrorDeNegocio(
      'Ese pago ya tiene un resultado de rendición cargado, así que no se puede anular desde acá: corregilo con administración.',
    )
  }
  const motivoLimpio = limpiar(validarTexto(motivo, 'El motivo', 3, 300))
  const ahora = ahoraIso()

  db().transaction(() => {
    db().prepare('DELETE FROM pagos WHERE id = ?').run(id)
    if (normalizarEstadoDeCobro(pago.estado_cobro) === 'PAGO' && pago.cuota_fila_id) {
      const cuota = db().prepare('SELECT id, fila_id, pestana, pago FROM cuotas_mes WHERE fila_id = ?').get(pago.cuota_fila_id) as
        | { id: number; fila_id: string; pestana: string; pago: string | null }
        | undefined
      // Sólo se destapa si sigue siendo ESTE pago el que la dejó paga: si alguien ya cobró de nuevo esa
      // cuota (otro pago con otra fecha) desmarcarla ahora le borraría el cobro nuevo.
      if (cuota && limpiar(cuota.pago) === limpiar(pago.fecha)) {
        db().prepare('UPDATE cuotas_mes SET pago = NULL, pago_fecha = NULL, actualizado_en = ? WHERE id = ?').run(ahora, cuota.id)
        encolar({ operacion: 'actualizar', pestana: cuota.pestana, filaId: cuota.fila_id, campos: { pago: '' } }, actor)
      }
    }
  })()

  encolar({ operacion: 'borrar', pestana: pago.pestana, filaId: pago.fila_id, campos: {} }, actor)

  registrarCambio(actor, {
    accion: 'pago_anulado',
    tabla: 'pagos',
    registroId: id,
    // A la fila de la CUOTA cuando la tiene (la misma que anotó 'CUANDO PAGO' al cobrarlo), no a la
    // del pago: así la anulación aparece junto al cobro en el historial de esa fila de la planilla.
    // Un pago suelto (sin cuota) no tiene otra fila que la propia.
    filaId: pago.cuota_fila_id ?? pago.fila_id,
    campo: 'PAGO ANULADO',
    valorAnterior: `${pago.cliente_nombre ?? ''} · ${pago.fecha ?? ''}${pago.importe ? ` · ${pago.importe}` : ''}${pago.medio ? ` · ${pago.medio}` : ''}`.trim(),
    valorNuevo: `Anulado: ${motivoLimpio}`,
  })
}

interface PagoParaLaHoja {
  fila_id: string
  pestana: string
  fecha: string | null
  cliente_nombre: string | null
  documento: string | null
  compania: string | null
  numero_poliza: string | null
  patente: string | null
  importe: string | null
  medio: string | null
  periodo: string | null
  observaciones: string | null
  resultado: string | null
  sucursal: string | null
  estado_cobro: string | null
  adelanto_modo: string | null
  numero_ticket: string | null
  revisado_en: string | null
}

/** Dónde quedó encolado un pago: en qué pestaña y si se agrega entero o se actualiza. */
export interface LugarDelPago {
  operacion: 'crear' | 'actualizar'
  pestana: string
}

/**
 * Deja el pago apuntando a la pestaña de pagos de la hoja y encolado para agregarse, si todavía no
 * lo estaba. Hace falta para el pago que se cobró ANTES de tener dónde escribirlo (hasta la 12.1, sin
 * una IMPUTADOS usable no se escribía nada): en cuanto hay pestaña, ese pago se suma a la rendición y
 * a la caja de las otras computadoras en vez de quedarse para siempre sólo en ésta.
 *
 * Devuelve dónde quedó, o null si el pago no existe.
 */
export function asegurarPagoEnLaHoja(pagoId: number, actor: SesionUsuario | null): LugarDelPago | null {
  const hoja = hojaDeImputados()
  const pago = db()
    .prepare(
      `SELECT fila_id, pestana, fecha, cliente_nombre, documento, compania, numero_poliza, patente, importe, medio,
              periodo, observaciones, resultado, COALESCE(sucursal_cobro, sucursal_texto) AS sucursal, usuario_nombre,
              estado_cobro, adelanto_modo, numero_ticket, revisado_en
       FROM pagos WHERE id = ?`,
    )
    .get(pagoId) as (PagoParaLaHoja & { usuario_nombre: string | null }) | undefined
  if (!pago) return null

  const conocida = db().prepare('SELECT pestana, en_la_hoja FROM filas_crudas WHERE fila_id = ?').get(pago.fila_id) as
    | { pestana: string; en_la_hoja: number }
    | undefined
  // Ya está en la hoja: se actualiza donde vive, que puede no ser la pestaña de hoy (un pago que viajó
  // por APP PAGOS sigue ahí aunque la agencia después arme una IMPUTADOS por fila).
  if (conocida && conocida.en_la_hoja === 1) return { operacion: 'actualizar', pestana: conocida.pestana }

  db().prepare('UPDATE pagos SET pestana = ?, actualizado_en = ? WHERE id = ?').run(hoja.pestana, ahoraIso(), pagoId)
  registrarFilaDeLaApp({ filaId: pago.fila_id, pestana: hoja.pestana, tipoPestana: 'PAGOS', periodo: pago.periodo })
  const campos: Record<string, string> = {
    fecha: pago.fecha ?? '',
    nombre: pago.cliente_nombre ?? '',
    documento: pago.documento ?? '',
    sucursal: pago.sucursal ?? '',
    compania: pago.compania ?? '',
    numero_poliza: pago.numero_poliza ?? '',
    patente: pago.patente ?? '',
    importe: pago.importe ?? '',
    medio_pago: pago.medio ?? '',
    mes: mesParaLaHoja(pago.periodo, normalizarModoDeAdelanto(pago.adelanto_modo) !== null),
    observaciones: pago.observaciones ?? '',
    resultado: normalizarResultado(pago.resultado),
  }
  if (hoja.esDeLaApp && pago.usuario_nombre) campos.usuario = pago.usuario_nombre
  if (normalizarEstadoDeCobro(pago.estado_cobro) === 'IMPUTADO') campos.cobro = 'IMPUTADO'
  // Las dos de la planilla de caja viajan sólo cuando tienen algo adentro, igual que COBRO: un pago
  // sin ticket ni revisar no manda columnas que una APP PAGOS vieja no tiene.
  if (limpiar(pago.numero_ticket)) campos.ticket = limpiar(pago.numero_ticket)
  if (limpiar(pago.revisado_en)) campos.revisado = REVISADO_EN_LA_HOJA
  encolar({ operacion: 'crear', pestana: hoja.pestana, filaId: pago.fila_id, campos }, actor)
  return { operacion: 'crear', pestana: hoja.pestana }
}

/**
 * Los pagos que esta computadora cobró y nunca viajaron: los de antes de la 12.2, cuando sin una
 * IMPUTADOS usable el pago quedaba sólo acá (eso era lo que hacía que en Lanús cada mostrador viera
 * nada más que lo que cobraba él). Se encolan hacia la pestaña de pagos de hoy, de a uno, con lo que
 * la caja del día de las otras computadoras los ve en cuanto suben. Devuelve cuántos encoló.
 */
export function subirPagosRezagados(): number {
  const rezagados = db()
    .prepare(
      `SELECT p.id FROM pagos p
       LEFT JOIN filas_crudas fc ON fc.fila_id = p.fila_id
       WHERE p.hecho_en_la_app = 1
         AND (fc.fila_id IS NULL OR (fc.en_la_hoja = 0 AND fc.numero_fila = 0))
         AND p.fila_id NOT IN (SELECT fila_id FROM cola_sync WHERE estado IN ('pendiente', 'fallido'))
       ORDER BY p.id`,
    )
    .all() as Array<{ id: number }>
  let encolados = 0
  for (const { id } of rezagados) {
    if (asegurarPagoEnLaHoja(id, null)?.operacion === 'crear') encolados++
  }
  return encolados
}

// ---------------------------------------------------------------------------
// Leer pagos
// ---------------------------------------------------------------------------

export interface PagoCrudo {
  id: number
  fila_id: string
  pestana: string
  cliente_id: number | null
  poliza_id: number | null
  fecha: string | null
  fecha_iso: string | null
  cliente_nombre: string | null
  documento: string | null
  compania: string | null
  numero_poliza: string | null
  patente: string | null
  sucursal: string | null
  importe: string | null
  importe_monto: number | null
  medio: string | null
  periodo: string | null
  resultado: string | null
  observaciones: string | null
  usuario_nombre: string | null
  hecho_en_la_app: number
  creado_en: string
  estado_cobro: string | null
  adelanto_modo: string | null
  cuota_fila_id: string | null
  numero_ticket: string | null
  revisado_en: string | null
  revisado_por: string | null
}

// ---------------------------------------------------------------------------
// Las dos columnas de la planilla de caja: el número del ticket y el tilde de revisión
// ---------------------------------------------------------------------------

/** Cómo se escribe el tilde de REVISIÓN DE PAGO en la hoja, para que se lea desde Google. */
const REVISADO_EN_LA_HOJA = 'SI'

/** Lo que puede haber escrito en esa columna —el tilde de la planilla incluido— y qué quiere decir. */
export function estaRevisado(valor: unknown): boolean {
  const texto = limpiar(valor)
  if (!texto) return false
  if (/^[✓✔√x×]+$/i.test(texto)) return true
  return ['SI', 'SÍ', 'OK', 'LISTO', 'REVISADO', 'REVISADA', 'CONTROLADO', 'TRUE', '1'].includes(normalizarTexto(texto))
}

/**
 * El tilde de REVISIÓN DE PAGO: alguien miró el cobro contra el ticket y está todo bien. Es de la
 * planilla de caja del mostrador, no de la rendición mensual (eso es el RESULTADO, más arriba): acá se
 * controla el cobro del día antes de cerrar la caja; allá, lo que la compañía dijo del mes.
 *
 * Viaja por la columna REVISIÓN DE PAGO de APP PAGOS, y sólo cuando hay algo que decir: un pago que
 * nadie revisó no manda la columna, así una APP PAGOS armada antes de la 12.10 no anota «columna
 * faltante» por cada cobro (mismo criterio que COBRO).
 */
export function marcarPagoRevisado(pagoId: number, revisado: boolean, actor: SesionUsuario): boolean {
  const id = enteroPositivo(pagoId, 'El pago')
  const pago = db().prepare('SELECT fila_id, revisado_en FROM pagos WHERE id = ?').get(id) as
    | { fila_id: string; revisado_en: string | null }
    | undefined
  if (!pago) throw new ErrorDeNegocio('No se encontró ese pago.')
  const estaba = limpiar(pago.revisado_en) !== ''
  if (estaba === revisado) return revisado

  const ahora = ahoraIso()
  db()
    .prepare('UPDATE pagos SET revisado_en = ?, revisado_por = ?, actualizado_en = ? WHERE id = ?')
    .run(revisado ? ahora : null, revisado ? actor.nombre : null, ahora, id)

  // Al destildar hay que mandar la celda vacía igual: si no, la otra computadora seguiría viendo el
  // tilde que se acaba de sacar. La columna ya existe, porque para destildar alguien tildó antes.
  const lugar = asegurarPagoEnLaHoja(id, actor)
  if (lugar?.operacion === 'actualizar') {
    encolar({ operacion: 'actualizar', pestana: lugar.pestana, filaId: pago.fila_id, campos: { revisado: revisado ? REVISADO_EN_LA_HOJA : '' } }, actor)
  }
  registrarCambio(actor, {
    accion: 'caja',
    tabla: 'pagos',
    registroId: id,
    filaId: pago.fila_id,
    campo: 'REVISIÓN DE PAGO',
    valorAnterior: estaba ? REVISADO_EN_LA_HOJA : null,
    valorNuevo: revisado ? REVISADO_EN_LA_HOJA : null,
  })
  return revisado
}

/**
 * Guarda en el pago el número del comprobante (la columna NRO TICKET de la planilla de caja). Lo llama
 * la ticketeadora cuando toma el correlativo, así el número que salió en el papel queda pegado al
 * cobro y nadie lo copia a mano; también se puede escribir desde la caja para un ticket viejo o para
 * un comprobante que se hizo a mano.
 *
 * `actor` es null cuando lo llama la impresión: el ticket sale en segundo plano y no puede depender de
 * quién tenga la sesión abierta en ese instante.
 */
export function guardarNumeroDeTicket(pagoId: number, numero: string | null, actor: SesionUsuario | null): string | null {
  const id = enteroPositivo(pagoId, 'El pago')
  const pago = db().prepare('SELECT fila_id, numero_ticket FROM pagos WHERE id = ?').get(id) as
    | { fila_id: string; numero_ticket: string | null }
    | undefined
  if (!pago) throw new ErrorDeNegocio('No se encontró ese pago.')
  const limpio = limpiar(numero).slice(0, 40)
  if ((pago.numero_ticket ?? '') === limpio) return pago.numero_ticket

  db().prepare('UPDATE pagos SET numero_ticket = ?, actualizado_en = ? WHERE id = ?').run(limpio || null, ahoraIso(), id)
  const lugar = asegurarPagoEnLaHoja(id, actor)
  if (lugar?.operacion === 'actualizar') {
    encolar({ operacion: 'actualizar', pestana: lugar.pestana, filaId: pago.fila_id, campos: { ticket: limpio } }, actor)
  }
  return limpio || null
}

/**
 * La sucursal de un pago es la del mostrador donde entró la plata: un cliente de Lanús que paga en
 * Dock Sud suma a la caja de Dock Sud, y por eso `sucursal_cobro` manda sobre todo lo demás.
 *
 * Los dos respaldos son para los pagos que NO se cargaron desde la aplicación. `sucursal_cobro` la
 * escribe sólo la computadora que cobró (ver `guardarPago`): ni el importador ni la bajada la traen,
 * así que en una computadora recién instalada TODO el historial de cobranza entra por la importación
 * con esa columna vacía. Y `sucursal_texto` sale de la pestaña IMPUTADOS, que no tiene columna LOCAL.
 * Sin el último respaldo, esa cobranza no cae en ninguna sucursal y la caja filtrada sale vacía en esa
 * computadora mientras en la que cobró se ve entera.
 *
 * Es la misma expresión que usan las métricas, importada de acá para que no puedan volver a separarse:
 * cuando diferían, el mismo pago sumaba en Métricas/Lanús y era invisible en Caja del día/Lanús.
 */
export const SUCURSAL_DEL_PAGO = `COALESCE(NULLIF(TRIM(p.sucursal_cobro), ''), NULLIF(TRIM(p.sucursal_texto), ''), cl.sucursal_texto)`

/** Columnas comunes a la caja y a la rendición. `sucursal` es la del cobro, con la del cliente de respaldo. */
export const SELECT_PAGOS = `
  SELECT p.id, p.fila_id, p.pestana, p.cliente_id, p.poliza_id, p.fecha, p.fecha_iso, p.cliente_nombre,
         p.documento, p.compania, p.numero_poliza, p.patente,
         ${SUCURSAL_DEL_PAGO} AS sucursal,
         p.importe, p.importe_monto, p.medio, COALESCE(p.periodo, substr(p.fecha_iso, 1, 7)) AS periodo,
         p.resultado, p.observaciones, p.usuario_nombre, p.hecho_en_la_app, p.creado_en,
         p.estado_cobro, p.adelanto_modo, p.cuota_fila_id, p.numero_ticket, p.revisado_en, p.revisado_por
  FROM pagos p
  LEFT JOIN clientes cl ON cl.id = p.cliente_id
`

/**
 * «Esta cuota tiene un pago que la cubre»: la condición que comparten la mora, los deudores y las
 * métricas para no perseguir a quien ya pagó. Espera la planilla como `c`. Un cobro IMPUTADO no
 * cuenta: la agencia le pagó a la compañía, pero el cliente todavía debe.
 *
 * Dos EXISTS unidos por OR y no un EXISTS con el OR adentro, por lo mismo que SELECT_PLANILLA
 * (ver el comentario de cartera.ts): con el OR adentro SQLite no puede usar ningún índice y recorre
 * `pagos` entera por cada cuota. Partido en dos, cada uno entra por el suyo —idx_pagos_cuota_fila
 * (cuota_fila_id) y idx_pagos_adelanto (poliza_id, periodo, …)— y la mora de un mes deja de ser
 * cuadrática. Va entre paréntesis porque quien lo usa lo niega (`AND NOT ...`): en SQL el NOT ata
 * más fuerte que el OR y sin ellos sólo negaría el primer EXISTS.
 *
 * A propósito NO lleva el «AND NOT (adelanto_modo = 'PENDIENTE' AND cuota_fila_id IS NULL)» que sí
 * tiene el `pago_registrado` de SELECT_PLANILLA, aunque el resto sea idéntico. Las dos preguntas son
 * distintas: `pago_registrado` es «¿esta fila está paga?» y un adelanto PENDIENTE justamente nace sin
 * imputar para que alguien lo impute a mano, así que la fila tiene que seguir viéndose impaga en la
 * planilla. Esto de acá es «¿hay que perseguir a este cliente?», y la plata de ese adelanto YA entró:
 * llamarlo para cobrarle lo que pagó el mes pasado sería el peor error de los dos.
 */
export const PAGO_QUE_CUBRE_LA_CUOTA = `(
  EXISTS (
    SELECT 1 FROM pagos pg
    WHERE pg.cuota_fila_id = c.fila_id
      AND COALESCE(pg.estado_cobro, 'PAGO') <> 'IMPUTADO'
  )
  OR EXISTS (
    SELECT 1 FROM pagos pg
    WHERE pg.poliza_id = c.poliza_id AND pg.periodo = c.periodo
      AND COALESCE(pg.estado_cobro, 'PAGO') <> 'IMPUTADO'
  )
)`

/** La hora del cobro sale de cuándo se registró; los pagos importados de la hoja no la tienen. */
function horaDe(cruda: PagoCrudo): string | null {
  if (cruda.hecho_en_la_app !== 1) return null
  const fecha = new Date(cruda.creado_en)
  if (Number.isNaN(fecha.getTime())) return null
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`
}

export function aPagoRegistrado(cruda: PagoCrudo): PagoRegistrado {
  return {
    id: cruda.id,
    filaId: cruda.fila_id,
    hora: horaDe(cruda),
    fecha: cruda.fecha,
    fechaIso: cruda.fecha_iso,
    clienteId: cruda.cliente_id,
    clienteNombre: cruda.cliente_nombre,
    documento: cruda.documento,
    compania: cruda.compania,
    numeroPoliza: cruda.numero_poliza,
    patente: cruda.patente,
    importe: cruda.importe,
    importeMonto: cruda.importe_monto,
    medio: cruda.medio,
    sucursal: cruda.sucursal,
    usuarioNombre: cruda.usuario_nombre,
    periodo: cruda.periodo,
    resultado: normalizarResultado(cruda.resultado),
    resultadoTexto: cruda.resultado,
    observaciones: cruda.observaciones,
    hechoEnLaApp: cruda.hecho_en_la_app === 1,
    estadoCobro: normalizarEstadoDeCobro(cruda.estado_cobro),
    adelantoModo: normalizarModoDeAdelanto(cruda.adelanto_modo),
    adelantoImputado: cruda.adelanto_modo !== null && cruda.cuota_fila_id !== null,
    numeroTicket: cruda.numero_ticket,
    // Vacío y NULL son lo mismo: la bajada escribe '' cuando en la hoja se sacó el tilde.
    revisado: limpiar(cruda.revisado_en) !== '',
    revisadoPor: cruda.revisado_por,
    revisadoEn: cruda.revisado_en,
  }
}
