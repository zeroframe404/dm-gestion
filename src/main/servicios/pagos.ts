// Todo lo que escribe o lee la tabla `pagos`. Es una sola tabla que cumple dos papeles:
//  - la CAJA DEL DÍA: qué se cobró hoy, en qué sucursal, con qué medio y quién lo cobró;
//  - la RENDICIÓN MENSUAL (la pestaña IMPUTADOS de la hoja), con su columna RESULTADO.
//
// Vive aparte de cartera.ts porque lo usan los dos lados —la planilla del mes y el módulo Cobranzas—
// y así no se importan entre ellos.
import { RESULTADOS_DE_IMPUTACION, type PagoRegistrado, type ResultadoImputacion, type SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { resolverCampo, type Campo } from '../importacion/encabezados'
import { MESES } from '../importacion/pestanas'
import { ahoraIso, limpiar, interpretarNumero, normalizarTexto } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { PESTANA_APP, registrarFilaDeLaApp } from './filas'

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
// La pestaña IMPUTADOS de la hoja
// ---------------------------------------------------------------------------

export interface HojaDeImputados {
  /** Título de la pestaña, si la hoja tiene una IMPUTADOS que sea una tabla por fila; null si no. */
  pestana: string | null
  /** true si esa pestaña tiene una columna que se reconoce como RESULTADO. */
  tieneColumnaResultado: boolean
  /** Por qué el RESULTADO no va a viajar a la hoja, o null si sí va. */
  aviso: string | null
}

const SIN_PESTANA =
  'La hoja de Google no tiene una pestaña IMPUTADOS con una fila por pago (en la hoja de la agencia es una ' +
  'planilla de resumen, no una tabla), así que los pagos y el RESULTADO quedan sólo en DM Gestión. Para ' +
  'sincronizarlos, armá en la hoja una pestaña IMPUTADOS con encabezados FECHA, NOMBRE, DNI, CIA, POLIZA, ' +
  'IMPORTE, MEDIO DE PAGO, MES y RESULTADO, e importala.'

/** Campos que tiene que reconocer una pestaña para que valga como tabla de pagos. */
const CAMPOS_MINIMOS: Campo[] = ['fecha', 'importe']

/**
 * Busca la pestaña de pagos de la hoja y mira si sirve. No alcanza con que exista una pestaña llamada
 * IMPUTADOS: la de la agencia es una matriz de resumen con años y totales, sin una fila por pago. Se
 * la da por buena sólo si sus encabezados se reconocen como una tabla (fecha e importe, al menos).
 */
export function hojaDeImputados(): HojaDeImputados {
  const candidata = db()
    .prepare(
      `SELECT pestana, COUNT(*) AS filas FROM filas_crudas
       WHERE tipo_pestana = 'PAGOS' AND en_la_hoja = 1
       GROUP BY pestana ORDER BY filas DESC LIMIT 1`,
    )
    .get() as { pestana: string; filas: number } | undefined
  if (!candidata) return { pestana: null, tieneColumnaResultado: false, aviso: SIN_PESTANA }

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
  if (!esTabla) return { pestana: null, tieneColumnaResultado: false, aviso: SIN_PESTANA }

  const tieneColumnaResultado = campos.has('resultado')
  return {
    pestana: candidata.pestana,
    tieneColumnaResultado,
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
}

const INSERTAR_PAGO = `
  INSERT INTO pagos (fila_id, pestana, cliente_id, poliza_id, fecha, fecha_iso, cliente_nombre, documento, compania,
                     numero_poliza, patente, sucursal_texto, importe, importe_monto, medio, periodo_texto, periodo,
                     observaciones, resultado, usuario_id, usuario_nombre, sucursal_cobro, cuota_fila_id,
                     hecho_en_la_app, creado_en, actualizado_en)
  VALUES (@fila_id, @pestana, @cliente_id, @poliza_id, @fecha, @fecha_iso, @cliente_nombre, @documento, @compania,
          @numero_poliza, @patente, @sucursal_texto, @importe, @importe_monto, @medio, @periodo_texto, @periodo,
          @observaciones, @resultado, @usuario_id, @usuario_nombre, @sucursal_cobro, @cuota_fila_id,
          1, @ahora, @ahora)
  ON CONFLICT(fila_id) DO UPDATE SET
    fecha = excluded.fecha, fecha_iso = excluded.fecha_iso, importe = excluded.importe,
    importe_monto = excluded.importe_monto, medio = excluded.medio, observaciones = excluded.observaciones,
    usuario_id = excluded.usuario_id, usuario_nombre = excluded.usuario_nombre,
    sucursal_cobro = excluded.sucursal_cobro,
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
function camposParaLaHoja(datos: PagoAGuardar, sucursalCobro: string, conRendicion: boolean): Record<string, string> {
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
    mes: nombreDeMesDelPeriodo(datos.periodo),
  }
  if (conRendicion) {
    campos.observaciones = datos.observaciones ?? ''
    campos.resultado = datos.resultado
  }
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
  const conocida = db().prepare('SELECT en_la_hoja FROM filas_crudas WHERE fila_id = ?').get(datos.filaId) as
    | { en_la_hoja: number }
    | undefined
  const ahora = ahoraIso()

  db()
    .prepare(INSERTAR_PAGO)
    .run({
      fila_id: datos.filaId,
      pestana: hoja.pestana ?? PESTANA_APP,
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
      ahora,
    })

  const { id } = db().prepare('SELECT id FROM pagos WHERE fila_id = ?').get(datos.filaId) as { id: number }

  if (hoja.pestana) {
    // Si la fila todavía no llegó a la hoja se vuelve a encolar como «crear»: la cola junta los dos
    // pedidos en uno solo, así no quedan dos filas ni un «actualizar» sobre algo que no existe.
    const nueva = !conocida || conocida.en_la_hoja === 0
    if (nueva) {
      registrarFilaDeLaApp({ filaId: datos.filaId, pestana: hoja.pestana, tipoPestana: 'PAGOS', periodo: datos.periodo })
    }
    encolar(
      {
        operacion: nueva ? 'crear' : 'actualizar',
        pestana: hoja.pestana,
        filaId: datos.filaId,
        campos: camposParaLaHoja(datos, sucursalCobro, nueva),
      },
      actor,
    )
  }
  return id
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
}

/**
 * Deja el pago apuntando a la pestaña IMPUTADOS de la hoja y encolado para agregarse, si todavía no
 * lo estaba. Hace falta para el pago que se cobró ANTES de que la hoja tuviera una pestaña usable:
 * en cuanto la agencia la arma e importa, ese pago se suma a la rendición en vez de quedarse para
 * siempre sólo en DM Gestión.
 *
 * Devuelve qué operación quedó encolada, o null si no hay pestaña donde escribir.
 */
export function asegurarPagoEnLaHoja(pagoId: number, actor: SesionUsuario): 'crear' | 'actualizar' | null {
  const hoja = hojaDeImputados()
  if (!hoja.pestana) return null
  const pago = db()
    .prepare(
      `SELECT fila_id, pestana, fecha, cliente_nombre, documento, compania, numero_poliza, patente, importe, medio,
              periodo, observaciones, resultado, COALESCE(sucursal_cobro, sucursal_texto) AS sucursal
       FROM pagos WHERE id = ?`,
    )
    .get(pagoId) as PagoParaLaHoja | undefined
  if (!pago) return null

  const conocida = db().prepare('SELECT en_la_hoja FROM filas_crudas WHERE fila_id = ?').get(pago.fila_id) as
    | { en_la_hoja: number }
    | undefined
  if (conocida && conocida.en_la_hoja === 1 && pago.pestana === hoja.pestana) return 'actualizar'

  db().prepare('UPDATE pagos SET pestana = ?, actualizado_en = ? WHERE id = ?').run(hoja.pestana, ahoraIso(), pagoId)
  registrarFilaDeLaApp({ filaId: pago.fila_id, pestana: hoja.pestana, tipoPestana: 'PAGOS', periodo: pago.periodo })
  encolar(
    {
      operacion: 'crear',
      pestana: hoja.pestana,
      filaId: pago.fila_id,
      campos: {
        fecha: pago.fecha ?? '',
        nombre: pago.cliente_nombre ?? '',
        documento: pago.documento ?? '',
        sucursal: pago.sucursal ?? '',
        compania: pago.compania ?? '',
        numero_poliza: pago.numero_poliza ?? '',
        patente: pago.patente ?? '',
        importe: pago.importe ?? '',
        medio_pago: pago.medio ?? '',
        mes: nombreDeMesDelPeriodo(pago.periodo),
        observaciones: pago.observaciones ?? '',
        resultado: normalizarResultado(pago.resultado),
      },
    },
    actor,
  )
  return 'crear'
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
}

/** Columnas comunes a la caja y a la rendición. `sucursal` es la del cobro, con la del cliente de respaldo. */
export const SELECT_PAGOS = `
  SELECT p.id, p.fila_id, p.pestana, p.cliente_id, p.poliza_id, p.fecha, p.fecha_iso, p.cliente_nombre,
         p.documento, p.compania, p.numero_poliza, p.patente,
         COALESCE(p.sucursal_cobro, p.sucursal_texto) AS sucursal,
         p.importe, p.importe_monto, p.medio, COALESCE(p.periodo, substr(p.fecha_iso, 1, 7)) AS periodo,
         p.resultado, p.observaciones, p.usuario_nombre, p.hecho_en_la_app, p.creado_en
  FROM pagos p
`

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
  }
}
