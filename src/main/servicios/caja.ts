// La caja chica del mostrador: la mitad de abajo de la planilla de caja de la agencia.
//
// La planilla que se lleva a mano tiene dos partes. Arriba, una fila por cobro —ticket, patente,
// nombre, cuánto se cobró, con qué medio, la compañía y la póliza—: eso ya vive en `pagos` y lo
// muestra la caja del día. Abajo, a partir de la fila 34, un resumen que se hace solo con las cuentas
// del cajón: el cambio con el que se abrió, lo que se pagó de gastos, lo que bajó a la caja fuerte y
// lo que quedó al cerrar. Esa mitad es la que faltaba, y es la que vive acá.
//
// La cuenta es la de la planilla, sin cambiarle nada:
//
//   DEBE  = caja chica al abrir + todo lo cobrado
//   HABER = posnet + transferencias + otros medios + gastos + lo que bajó a la caja fuerte + lo que
//           queda en la caja chica
//
// y las dos tienen que dar igual. Lo que en la planilla se comprueba mirando que los dos totales
// coincidan, acá se dice con todas las letras: si no cuadran, falta cargar algo.
//
// Lo COBRADO no se carga dos veces: sale de los pagos del día de esa sucursal, que son los mismos que
// se ven arriba en la pantalla y los mismos que viajan a las otras computadoras por APP PAGOS. Acá se
// cargan sólo los cuatro renglones que la planilla escribe a mano (ver `TIPOS_DE_MOVIMIENTO_DE_CAJA`).
import {
  MOVIMIENTOS_UNICOS_DEL_DIA,
  TIPOS_DE_MOVIMIENTO_DE_CAJA,
  type ArqueoDeCaja,
  type DatosDeMovimientoDeCaja,
  type MovimientoDeCaja,
  type PagoRegistrado,
  type SesionUsuario,
  type TipoDeMovimientoDeCaja,
} from '../../shared/tipos'
import { claveDeSucursal, mismaSucursal, sucursalCanonica } from '../../shared/sucursales'
import { db } from '../db/base'
import { ahoraIso, generarId, interpretarNumero, limpiar, normalizarTexto } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { PESTANA_CAJA_APP } from '../sincronizacion/pestanasApp'
import { nombreDePestana } from './hojas'
import { ErrorDeNegocio } from './errores'
import { registrarFilaDeLaApp } from './filas'
import { registrarCambio } from './historial'
import { enteroPositivo } from './validacion'

/**
 * La pestaña por la que viaja la caja: la que ya exista en la base con ese tipo (por si alguien la
 * renombró) y, si no hay ninguna, «APP CAJA», que el motor crea sola la primera vez que hay algo que
 * subir. Es el mismo criterio de los rechazos y los anexos.
 */
function pestanaDeLaCaja(): string {
  return nombreDePestana('APP_CAJA', PESTANA_CAJA_APP)
}

/** Cómo se escribe cada renglón en la columna TIPO de APP CAJA, para que se lea desde Google. */
const ETIQUETA_EN_LA_HOJA: Record<TipoDeMovimientoDeCaja, string> = {
  APERTURA: 'APERTURA',
  GASTO: 'GASTO',
  CAJA_FUERTE: 'CAJA FUERTE',
  CIERRE: 'CIERRE',
}

/** Lo que la hoja puede traer escrito en TIPO, incluso a mano, y qué renglón es. */
const TIPO_DESDE_LA_HOJA: Record<string, TipoDeMovimientoDeCaja> = {
  APERTURA: 'APERTURA',
  'CAJA CHICA': 'APERTURA',
  CAMBIO: 'APERTURA',
  GASTO: 'GASTO',
  GASTOS: 'GASTO',
  'CAJA FUERTE': 'CAJA_FUERTE',
  CAJA_FUERTE: 'CAJA_FUERTE',
  'A CAJA FUERTE': 'CAJA_FUERTE',
  EFECTIVO: 'CAJA_FUERTE',
  CIERRE: 'CIERRE',
  ARQUEO: 'CIERRE',
  CONTADO: 'CIERRE',
}

/** El renglón que nombra ese texto, o null si no es ninguno de los cuatro. */
export function tipoDeMovimientoDesdeTexto(valor: unknown): TipoDeMovimientoDeCaja | null {
  const texto = normalizarTexto(valor)
  if (!texto) return null
  if ((TIPOS_DE_MOVIMIENTO_DE_CAJA as readonly string[]).includes(texto)) return texto as TipoDeMovimientoDeCaja
  return TIPO_DESDE_LA_HOJA[texto] ?? null
}

/**
 * El `_ID` de la apertura y del cierre se arma con el día y la sucursal, no al azar: son uno solo por
 * mostrador y por día, así que si el cierre lo carga Lanús desde dos computadoras las dos escriben la
 * MISMA fila de la hoja y no dos que se contradicen. Los gastos y las bajadas a la caja fuerte son
 * varios y llevan un id propio.
 */
export function filaIdDelMovimiento(fecha: string, sucursal: string, tipo: TipoDeMovimientoDeCaja): string {
  return `CAJA:${fecha}:${claveDeSucursal(sucursal)}:${tipo}`
}

interface MovimientoCrudo {
  id: number
  fila_id: string
  pestana: string
  fecha_iso: string
  sucursal: string
  tipo: string
  detalle: string | null
  importe: number | null
  usuario_nombre: string | null
  creado_en: string
}

function aMovimiento(cruda: MovimientoCrudo): MovimientoDeCaja {
  return {
    id: cruda.id,
    filaId: cruda.fila_id,
    fecha: cruda.fecha_iso,
    sucursal: cruda.sucursal,
    tipo: (tipoDeMovimientoDesdeTexto(cruda.tipo) ?? 'GASTO') as TipoDeMovimientoDeCaja,
    detalle: cruda.detalle,
    importe: cruda.importe ?? 0,
    usuarioNombre: cruda.usuario_nombre,
    hora: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cruda.creado_en) ? cruda.creado_en.slice(11, 16) : null,
  }
}

const SELECT_MOVIMIENTOS = `
  SELECT id, fila_id, pestana, fecha_iso, sucursal, tipo, detalle, importe, usuario_nombre, creado_en
  FROM caja_movimientos
`

/**
 * Los renglones cargados a mano de un día y un mostrador. La sucursal se compara en JavaScript y no
 * en el SQL, como en toda la aplicación: «Lanús» y «LANUS» son el mismo mostrador y SQLite no lo sabe.
 */
export function movimientosDeLaCaja(fecha: string, sucursal: string): MovimientoDeCaja[] {
  const crudas = db().prepare(`${SELECT_MOVIMIENTOS} WHERE fecha_iso = ? ORDER BY creado_en, id`).all(fecha) as MovimientoCrudo[]
  return crudas.filter((cruda) => mismaSucursal(cruda.sucursal, sucursal)).map(aMovimiento)
}

/** El último cierre contado ANTES de esa fecha en ese mostrador: es el cambio con el que se abre hoy. */
function ultimoCierreAntesDe(fecha: string, sucursal: string): MovimientoDeCaja | null {
  const crudas = db()
    .prepare(`${SELECT_MOVIMIENTOS} WHERE tipo = 'CIERRE' AND fecha_iso < ? ORDER BY fecha_iso DESC, id DESC`)
    .all(fecha) as MovimientoCrudo[]
  const encontrada = crudas.find((cruda) => mismaSucursal(cruda.sucursal, sucursal))
  return encontrada ? aMovimiento(encontrada) : null
}

// ---------------------------------------------------------------------------
// De qué columna de la planilla es cada pago
// ---------------------------------------------------------------------------

export type GrupoDeMedio = 'EFECTIVO' | 'POSNET' | 'TRANSFERENCIA' | 'OTRO'

/**
 * En qué columna de la planilla cae un pago según su medio: EFECTIVO es plata que queda en el cajón,
 * POSNET es la columna «POSNET MP» (las tarjetas) y TRANSFERENCIA la columna «MP» (Mercado Pago,
 * transferencias y CBU). Lo que no es ninguna de las tres —una cuponera, un pago en el local de la
 * compañía— no toca el cajón, pero se cobró igual: va aparte y suma a los dos lados de la cuenta.
 *
 * El débito automático se mira ANTES que las tarjetas a propósito: lleva la palabra «débito» y no es
 * un posnet, es plata que la compañía descuenta sola de la cuenta del cliente.
 */
export function grupoDelMedio(medio: string | null): GrupoDeMedio {
  const texto = normalizarTexto(medio)
  if (!texto) return 'OTRO'
  if (texto.includes('EFECTIVO')) return 'EFECTIVO'
  if (texto.includes('AUTOMATICO')) return 'OTRO'
  if (texto.includes('POSNET') || texto.includes('TARJETA') || texto.includes('CREDITO') || texto.includes('DEBITO')) return 'POSNET'
  if (texto.includes('TRANSFER') || texto.includes('MERCADO PAGO') || texto === 'MP' || texto.includes('CBU') || texto.includes('CVU')) {
    return 'TRANSFERENCIA'
  }
  return 'OTRO'
}

// ---------------------------------------------------------------------------
// El arqueo
// ---------------------------------------------------------------------------

/** Redondea a dos decimales: sumar pesos con centavos deja restos de coma flotante («0,30000000004»). */
function pesos(valor: number): number {
  return Math.round(valor * 100) / 100
}

/**
 * El resumen del día para un mostrador: la caja chica, las cuentas del pie de la planilla y el cuadre.
 * `pagos` son los del día y la sucursal que se están mirando (los mismos que la lista de arriba).
 */
export function arqueoDeLaCaja(fecha: string, sucursal: string, pagos: PagoRegistrado[]): ArqueoDeCaja {
  const movimientos = movimientosDeLaCaja(fecha, sucursal)
  const suma = (tipo: TipoDeMovimientoDeCaja): number =>
    movimientos.filter((m) => m.tipo === tipo).reduce((total, m) => total + m.importe, 0)

  const cargada = movimientos.find((m) => m.tipo === 'APERTURA') ?? null
  const heredada = cargada ? null : ultimoCierreAntesDe(fecha, sucursal)
  const apertura = pesos(cargada?.importe ?? heredada?.importe ?? 0)

  // Un cobro IMPUTADO es plata que la agencia le adelantó a la compañía: el cliente todavía no pagó,
  // así que no entró nada al cajón y no puede sumar al arqueo. Es la misma regla que el total del día.
  const cobrados = pagos.filter((pago) => pago.estadoCobro === 'PAGO' && pago.importeMonto !== null)
  const porGrupo = (grupo: GrupoDeMedio): number =>
    cobrados.filter((pago) => grupoDelMedio(pago.medio) === grupo).reduce((total, pago) => total + (pago.importeMonto ?? 0), 0)

  const efectivo = pesos(porGrupo('EFECTIVO'))
  const posnet = pesos(porGrupo('POSNET'))
  const transferencia = pesos(porGrupo('TRANSFERENCIA'))
  const otros = pesos(porGrupo('OTRO'))
  const cobrado = pesos(efectivo + posnet + transferencia + otros)
  const gastos = pesos(suma('GASTO'))
  const aLaCajaFuerte = pesos(suma('CAJA_FUERTE'))
  const esperado = pesos(apertura + efectivo - gastos - aLaCajaFuerte)

  const cierre = movimientos.find((m) => m.tipo === 'CIERRE') ?? null
  const contado = cierre ? pesos(cierre.importe) : null

  // Los dos lados de la planilla. La caja chica que va en el HABER es la que se contó si el día ya se
  // cerró, y la que debería haber si todavía está abierto: así el cuadre habla del arqueo de verdad.
  const debe = pesos(apertura + cobrado)
  const haber = pesos(posnet + transferencia + otros + gastos + aLaCajaFuerte + (contado ?? esperado))

  return {
    fecha,
    sucursal,
    apertura,
    aperturaCargada: cargada !== null,
    aperturaHeredadaDe: cargada ? null : (heredada?.fecha ?? null),
    cobrado,
    efectivo,
    posnet,
    transferencia,
    otros,
    gastos,
    aLaCajaFuerte,
    esperado,
    contado,
    diferencia: contado === null ? null : pesos(contado - esperado),
    cerradoEn: cierre?.hora ?? null,
    cerradoPor: cierre?.usuarioNombre ?? null,
    debe,
    haber,
    descuadre: pesos(debe - haber),
    movimientos,
  }
}

// ---------------------------------------------------------------------------
// Cargar y borrar renglones
// ---------------------------------------------------------------------------

const FORMATO_ISO = /^\d{4}-\d{2}-\d{2}$/

/** El importe de un renglón: se acepta lo que se escribe en el mostrador («1.500», «1500,50», «$ 200»). */
function importeDelMovimiento(valor: unknown): number {
  const numero = interpretarNumero(valor)
  if (numero === null) throw new ErrorDeNegocio('Poné un importe, con números.')
  if (numero < 0) throw new ErrorDeNegocio('El importe no puede ser negativo. Un gasto ya resta: cargalo en positivo.')
  if (numero > 999_999_999) throw new ErrorDeNegocio('Ese importe es demasiado grande. Revisalo.')
  return pesos(numero)
}

/** Como se escribe el importe en la hoja: entero cuando no tiene centavos, con punto decimal cuando sí. */
function importeParaLaHoja(valor: number): string {
  return Number.isInteger(valor) ? String(valor) : valor.toFixed(2)
}

export interface MovimientoGuardado {
  movimiento: MovimientoDeCaja
  /** true si se corrigió el renglón que ya estaba (la apertura o el cierre del día). */
  corregido: boolean
}

/**
 * Carga (o corrige) un renglón de la caja chica y lo manda a la hoja, que es como llega a las otras
 * computadoras del mismo mostrador.
 *
 * La apertura y el cierre son uno solo por día: volver a cargarlos pisa el que estaba, con el mismo
 * `_ID`, en vez de sumar otro. Un gasto o una bajada a la caja fuerte se agregan siempre.
 */
export function guardarMovimientoDeCaja(datos: DatosDeMovimientoDeCaja, actor: SesionUsuario): MovimientoGuardado {
  const fecha = limpiar(datos?.fecha)
  if (!FORMATO_ISO.test(fecha)) throw new ErrorDeNegocio('El día de la caja no es válido.')
  const tipo = tipoDeMovimientoDesdeTexto(datos?.tipo)
  if (!tipo) throw new ErrorDeNegocio('Ese renglón de la caja no existe.')
  const pedida = limpiar(datos?.sucursal) || actor.sucursal.nombre
  const sucursal = sucursalCanonica(pedida) ?? pedida
  const detalle = limpiar(datos?.detalle).slice(0, 200)
  if (tipo === 'GASTO' && !detalle) throw new ErrorDeNegocio('Poné de qué es el gasto (nafta, limpieza, un envío…).')
  const importe = importeDelMovimiento(datos?.importe)
  const unico = MOVIMIENTOS_UNICOS_DEL_DIA.includes(tipo)
  const ahora = ahoraIso()

  const anterior = unico ? (movimientosDeLaCaja(fecha, sucursal).find((m) => m.tipo === tipo) ?? null) : null
  const filaId = anterior?.filaId ?? (unico ? filaIdDelMovimiento(fecha, sucursal, tipo) : generarId())
  const pestana = pestanaDeLaCaja()

  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO caja_movimientos (fila_id, pestana, fecha_iso, sucursal, tipo, detalle, importe, usuario_id,
                                       usuario_nombre, creado_en, actualizado_en)
         VALUES (@fila_id, @pestana, @fecha, @sucursal, @tipo, @detalle, @importe, @usuario_id, @usuario_nombre, @ahora, @ahora)
         ON CONFLICT(fila_id) DO UPDATE SET
           detalle = excluded.detalle, importe = excluded.importe, usuario_id = excluded.usuario_id,
           usuario_nombre = excluded.usuario_nombre, actualizado_en = excluded.actualizado_en`,
      )
      .run({
        fila_id: filaId,
        pestana,
        fecha,
        sucursal,
        tipo,
        detalle: detalle || null,
        importe,
        usuario_id: actor.id,
        usuario_nombre: actor.nombre,
        ahora,
      })
    if (!anterior) registrarFilaDeLaApp({ filaId, pestana, tipoPestana: 'APP_CAJA', periodo: null })
  })()

  encolar(
    {
      operacion: anterior ? 'actualizar' : 'crear',
      pestana,
      filaId,
      campos: {
        fecha,
        sucursal,
        tipo_registro: ETIQUETA_EN_LA_HOJA[tipo],
        detalle,
        importe: importeParaLaHoja(importe),
        usuario: actor.nombre,
      },
    },
    actor,
  )

  registrarCambio(actor, {
    accion: 'caja',
    tabla: 'caja_movimientos',
    filaId,
    campo: ETIQUETA_EN_LA_HOJA[tipo],
    valorAnterior: anterior ? importeParaLaHoja(anterior.importe) : null,
    valorNuevo: `${importeParaLaHoja(importe)}${detalle ? ` · ${detalle}` : ''} · ${sucursal} · ${fecha}`,
  })

  const guardado = movimientosDeLaCaja(fecha, sucursal).find((m) => m.filaId === filaId)
  if (!guardado) throw new ErrorDeNegocio('El renglón se guardó pero no se pudo leer de vuelta. Actualizá la pantalla.')
  return { movimiento: guardado, corregido: anterior !== null }
}

/** Saca un renglón de la caja (un gasto mal cargado, una bajada que no fue) y lo borra de la hoja. */
export function borrarMovimientoDeCaja(movimientoId: unknown, actor: SesionUsuario): MovimientoDeCaja {
  const id = enteroPositivo(movimientoId, 'El renglón de la caja')
  const cruda = db().prepare(`${SELECT_MOVIMIENTOS} WHERE id = ?`).get(id) as MovimientoCrudo | undefined
  if (!cruda) throw new ErrorDeNegocio('Ese renglón de la caja ya no está.')
  const movimiento = aMovimiento(cruda)

  db().prepare('DELETE FROM caja_movimientos WHERE id = ?').run(id)
  // Se borra de la pestaña donde vive esa fila, que puede no ser la de hoy si la base tiene dos.
  encolar({ operacion: 'borrar', pestana: cruda.pestana || pestanaDeLaCaja(), filaId: movimiento.filaId, campos: {} }, actor)
  registrarCambio(actor, {
    accion: 'caja',
    tabla: 'caja_movimientos',
    filaId: movimiento.filaId,
    campo: ETIQUETA_EN_LA_HOJA[movimiento.tipo],
    valorAnterior: `${importeParaLaHoja(movimiento.importe)}${movimiento.detalle ? ` · ${movimiento.detalle}` : ''}`,
    valorNuevo: null,
  })
  return movimiento
}
