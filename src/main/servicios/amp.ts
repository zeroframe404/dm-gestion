// AMP: las ampliaciones pendientes. Es la lista más chica de la hoja y la más simple de usar —alguien
// pidió sumar granizo, cristales o una cobertura extra y hay que emitirla— así que la pantalla también
// es simple: la lista, y un tilde que la saca de encima cuando ya está.
//
// El tilde de «resuelto» es de la aplicación. La pestaña AMP de la hoja no siempre tiene una columna
// donde ponerlo, y no se le van a escribir columnas nuevas a una planilla que no las espera: si la
// columna está, el tilde viaja; si no, queda acá y la pantalla lo dice, igual que con la rendición de
// Imputados y su RESULTADO.
import { hoyLocal } from '../../shared/semaforo'
import type { FilaAmp, ListadoAmp, SesionUsuario } from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso } from '../importacion/normalizar'
import { encolar } from '../sincronizacion/cola'
import { ErrorDeNegocio } from './errores'
import { registrarCambio } from './historial'
import { buscarPestana } from './hojas'
import { sucursalesParaElegir } from './sucursales'
import { booleano, enteroPositivo } from './validacion'

const SIN_COLUMNA =
  'La pestaña AMP de la hoja no tiene una columna RESUELTO, así que el tilde queda guardado sólo en ' +
  'DM Gestión (la lista de acá es la que vale). Si querés que se vea también en Google, agregale una ' +
  'columna con ese encabezado y volvé a importar.'

interface HojaDeAmp {
  pestana: string | null
  tieneColumna: boolean
  aviso: string | null
}

function hojaDeAmp(): HojaDeAmp {
  const hoja = buscarPestana({
    tipo: 'AMP',
    nombrePorDefecto: 'AMP',
    minimos: ['nombre', 'fecha'],
    encabezadosEsperados: 'LOCAL, FECHA, NOMBRE, FORMA DE PAGO, PATENTE, MARCA, MODELO, FECHA DE VTO y RESUELTO',
  })
  if (!hoja.pestana) return { pestana: null, tieneColumna: false, aviso: hoja.aviso }
  const tieneColumna = hoja.campos.has('resuelto')
  return { pestana: hoja.pestana, tieneColumna, aviso: tieneColumna ? null : SIN_COLUMNA }
}

const SELECT_AMP = `
  SELECT a.id, a.fila_id, a.sucursal_texto AS sucursal, a.fecha, a.fecha_iso, a.cliente_id,
         COALESCE(a.cliente_nombre, cl.nombre) AS cliente_nombre, a.forma_pago, a.patente, a.marca, a.modelo,
         a.detalle, a.vencimiento, a.vencimiento_iso, a.observaciones, a.resuelto, a.resuelto_en, a.resuelto_por
  FROM amp a
  LEFT JOIN clientes cl ON cl.id = a.cliente_id
`

interface FilaCruda {
  id: number
  fila_id: string
  sucursal: string | null
  fecha: string | null
  fecha_iso: string | null
  cliente_id: number | null
  cliente_nombre: string | null
  forma_pago: string | null
  patente: string | null
  marca: string | null
  modelo: string | null
  detalle: string | null
  vencimiento: string | null
  vencimiento_iso: string | null
  observaciones: string | null
  resuelto: number
  resuelto_en: string | null
  resuelto_por: string | null
}

function aFila(f: FilaCruda): FilaAmp {
  return {
    id: f.id,
    filaId: f.fila_id,
    sucursal: f.sucursal,
    fecha: f.fecha,
    fechaIso: f.fecha_iso,
    clienteId: f.cliente_id,
    clienteNombre: f.cliente_nombre,
    formaPago: f.forma_pago,
    patente: f.patente,
    marca: f.marca,
    modelo: f.modelo,
    detalle: f.detalle,
    vencimiento: f.vencimiento,
    vencimientoIso: f.vencimiento_iso,
    observaciones: f.observaciones,
    resuelto: f.resuelto === 1,
    resueltoEn: f.resuelto_en,
    resueltoPor: f.resuelto_por,
  }
}

/**
 * La lista. Por omisión sólo las pendientes, que es de lo que se trata: lo resuelto ya no molesta a
 * nadie. Ordenadas por vencimiento —lo que vence antes, primero— y después por fecha de pedido.
 */
export function listarAmp(incluirResueltas: unknown = false): ListadoAmp {
  const conResueltas = incluirResueltas === true
  const filas = (
    db()
      .prepare(
        `${SELECT_AMP}
         WHERE @conResueltas = 1 OR a.resuelto = 0
         ORDER BY a.resuelto, COALESCE(a.vencimiento_iso, a.fecha_iso) IS NULL,
                  COALESCE(a.vencimiento_iso, a.fecha_iso), a.id`,
      )
      .all({ conResueltas: conResueltas ? 1 : 0 }) as FilaCruda[]
  ).map(aFila)

  const contadores = db().prepare('SELECT resuelto, COUNT(*) AS n FROM amp GROUP BY resuelto').all() as Array<{ resuelto: number; n: number }>
  // El DISTINCT y el ORDER BY salieron del SQL a propósito: SQLite compara byte a byte, así que
  // «LANUS» y «Lanús» le parecían dos ampliaciones de sucursales distintas y el orden dejaba a las dos
  // con tilde en cualquier lado. Y la lista ahora arranca por las cuatro de la agencia: la sucursal que
  // todavía no pidió ninguna ampliación tiene que estar en el filtro igual.
  const sucursales = sucursalesParaElegir(
    (db().prepare('SELECT DISTINCT sucursal_texto AS s FROM amp').all() as Array<{ s: string | null }>).map((f) => f.s),
  )

  return {
    filas,
    pendientes: contadores.find((c) => c.resuelto === 0)?.n ?? 0,
    resueltas: contadores.find((c) => c.resuelto === 1)?.n ?? 0,
    incluyeResueltas: conResueltas,
    sucursales,
    avisoDeSincronizacion: hojaDeAmp().aviso,
    hoy: hoyLocal(),
  }
}

/** Tildar «resuelto» saca la ampliación de la lista. Destildarlo la devuelve: nada se borra nunca. */
export function cambiarResueltoDeAmp(ampId: number, resuelto: unknown, incluirResueltas: unknown, actor: SesionUsuario): ListadoAmp {
  const id = enteroPositivo(ampId, 'La ampliación')
  const valor = booleano(resuelto, 'El tilde de resuelto')
  const fila = db().prepare(`${SELECT_AMP} WHERE a.id = ?`).get(id) as FilaCruda | undefined
  if (!fila) throw new ErrorDeNegocio('No se encontró esa ampliación.')

  if ((fila.resuelto === 1) !== valor) {
    const ahora = ahoraIso()
    db()
      .prepare('UPDATE amp SET resuelto = ?, resuelto_en = ?, resuelto_por = ?, actualizado_en = ? WHERE id = ?')
      .run(valor ? 1 : 0, valor ? ahora : null, valor ? actor.nombre : null, ahora, id)

    const hoja = hojaDeAmp()
    if (hoja.pestana && hoja.tieneColumna) {
      encolar({ operacion: 'actualizar', pestana: hoja.pestana, filaId: fila.fila_id, campos: { resuelto: valor ? 'SI' : '' } }, actor)
    }

    registrarCambio(actor, {
      accion: 'edicion',
      tabla: 'amp',
      registroId: id,
      filaId: fila.fila_id,
      campo: 'RESUELTO',
      valorAnterior: fila.resuelto === 1 ? 'SI' : 'NO',
      valorNuevo: valor ? 'SI' : 'NO',
    })
  }
  return listarAmp(incluirResueltas === true)
}
