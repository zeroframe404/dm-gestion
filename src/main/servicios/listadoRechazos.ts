// Consulta del listado de Rechazos de Débito (ver el contrato en shared/listados/index.ts). Es de sólo lectura: nada de
// escribir en la base ni de mandar algo al servidor.
//
// Una fila por aviso de rechazo (`rechazos_debito`, la misma fuente que Cartera → Rechazos y la campana). Lo que
// el aviso no guarda se lee de donde sí está, con JOINs al leer:
//   - compañía y número: los del aviso (la foto del momento) o, si faltan, los de la póliza;
//   - productor y rama: de la póliza (y su vehículo), porque el aviso no los copia;
//   - importe: el monto de la cuota de la planilla del mes que rebotó (`cuotas_mes.cuota_monto`), primero por
//     `cuota_fila_id` y, si el aviso no la guardó, por póliza + mes. Sin cuota con monto, queda vacío: no se inventa.
// El «Tipo» es el estado del aviso (Pendiente / Visto / Resuelto), la única clasificación que existe en los datos.
import { coincideAlguno, dentroDelRango, diaDeFecha, listaDeFiltro } from '../../shared/filtros'
import { pareceIso } from '../../shared/polizas'
import { mismaRama, ramaDeVehiculo, NOMBRE_RAMA } from '../../shared/ramas'
import { nombreDeTipoDeRiesgo } from '../../shared/riesgos'
import {
  ESTADOS_DE_RECHAZO,
  NOMBRE_ESTADO_RECHAZO,
  NOMBRE_MOTIVO_RECHAZO,
  type EstadoDeRechazo,
  type MotivoDeRechazo,
} from '../../shared/tipos'
import type { FilaDeRechazo, FiltrosDeRechazos } from '../../shared/listados/rechazos'
import { db } from '../db/base'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import { objeto } from './validacion'

interface FilaCruda {
  id: number
  poliza_id: number | null
  cliente_id: number | null
  fecha: string
  compania: string | null
  numero: string | null
  cliente_nombre: string | null
  cuota: string | null
  periodo: string | null
  cuota_monto: number | null
  estado: string | null
  motivo: string | null
  productor: string | null
  tipo_vehiculo: string | null
  categoria_vehiculo: string | null
}

// El importe sale de la cuota de la planilla: la atada al aviso por `cuota_fila_id` o, si no la hay, la de la misma
// póliza y mes (la viva antes que una dada de baja). Los subselect usan los índices de fila_id y de póliza.
const SELECT_RECHAZOS = `
  SELECT
    r.id, r.poliza_id, COALESCE(r.cliente_id, p.cliente_id) AS cliente_id, r.fecha,
    COALESCE(NULLIF(TRIM(r.compania), ''), p.compania) AS compania,
    COALESCE(NULLIF(TRIM(r.numero_poliza), ''), p.numero) AS numero,
    COALESCE(NULLIF(TRIM(r.cliente_nombre), ''), cl.nombre) AS cliente_nombre,
    r.cuota, r.periodo, q.cuota_monto, r.estado, r.motivo,
    p.productor, v.tipo AS tipo_vehiculo, v.categoria AS categoria_vehiculo
  FROM rechazos_debito r
  LEFT JOIN polizas p ON p.id = r.poliza_id
  LEFT JOIN clientes cl ON cl.id = COALESCE(r.cliente_id, p.cliente_id)
  LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
  LEFT JOIN cuotas_mes q ON q.id = COALESCE(
    (SELECT q1.id FROM cuotas_mes q1 WHERE q1.fila_id = r.cuota_fila_id),
    (SELECT q2.id FROM cuotas_mes q2 WHERE q2.poliza_id = r.poliza_id AND q2.periodo = r.periodo
      ORDER BY q2.dada_de_baja, q2.id LIMIT 1))
`

/**
 * El estado guardado llevado a los tres que la aplicación entiende. La columna viaja a la hoja, donde cualquiera puede
 * escribir «resuelto» en minúscula o vaciarla: lo que no se reconoce cuenta como PENDIENTE (igual que `servicios/rechazos.ts`).
 */
function estadoNormalizado(valor: string | null): EstadoDeRechazo {
  const escrito = normalizarTexto(valor)
  return (ESTADOS_DE_RECHAZO as readonly string[]).includes(escrito) ? (escrito as EstadoDeRechazo) : 'PENDIENTE'
}

/** El motivo como se lee. Uno que no está en la lista (se escribió a mano en la hoja) se muestra tal cual. */
function causaDelMotivo(motivo: string | null): string | null {
  const texto = limpiar(motivo)
  if (!texto) return null
  return NOMBRE_MOTIVO_RECHAZO[texto.toUpperCase() as MotivoDeRechazo] ?? texto
}

/** La rama de la póliza: la del vehículo o, si no es una de las siete, el tipo de riesgo («Hogar»). */
function ramoDeLaFila(fila: FilaCruda): string | null {
  const rama = ramaDeVehiculo(fila.tipo_vehiculo, fila.categoria_vehiculo)
  if (rama) return NOMBRE_RAMA[rama]
  return nombreDeTipoDeRiesgo(fila.tipo_vehiculo) || null
}

export function listarRechazosDelListado(filtros: FiltrosDeRechazos): FilaDeRechazo[] {
  const f = objeto(filtros ?? {}, 'Los filtros')
  const desde = pareceIso(limpiar(f.desde)) ? limpiar(f.desde) : ''
  const hasta = pareceIso(limpiar(f.hasta)) ? limpiar(f.hasta) : ''
  // Un rango al revés no trae nada, en vez de adivinar cuál de las dos fechas era la buena.
  if (desde && hasta && desde > hasta) return []

  const companias = listaDeFiltro(f.companias)
  const ramas = listaDeFiltro(f.ramas)
  const productores = listaDeFiltro(f.productores)
  const causas = listaDeFiltro(f.causas)
  const tipos = listaDeFiltro(f.tipos)
  const cliente = normalizarTexto(f.cliente).replace(/ /g, '')

  const crudas = db().prepare(SELECT_RECHAZOS).all() as FilaCruda[]

  const filas: Array<FilaDeRechazo & { _orden: number }> = []
  for (const cruda of crudas) {
    if (!dentroDelRango(cruda.fecha, desde, hasta)) continue
    const estado = estadoNormalizado(cruda.estado)
    const tipo = NOMBRE_ESTADO_RECHAZO[estado]
    const causa = causaDelMotivo(cruda.motivo)
    const nombre = limpiar(cruda.cliente_nombre) || 'Sin nombre'
    const ramo = ramoDeLaFila(cruda)
    if (!coincideAlguno(companias, cruda.compania)) continue
    if (!coincideAlguno(productores, cruda.productor)) continue
    if (!coincideAlguno(tipos, tipo)) continue
    if (!coincideAlguno(causas, causa)) continue
    if (ramas.length > 0 && !ramas.some((r) => mismaRama(r, ramo))) continue
    if (cliente && !normalizarTexto(nombre).replace(/ /g, '').includes(cliente)) continue

    filas.push({
      id: String(cruda.id),
      polizaId: cruda.poliza_id,
      clienteId: cruda.cliente_id,
      // Un día 'AAAA-MM-DD'; una fecha que no se entiende (escrita a mano en la hoja) se deja tal cual.
      fecha: diaDeFecha(cruda.fecha) ?? limpiar(cruda.fecha),
      compania: limpiar(cruda.compania) || null,
      numero: limpiar(cruda.numero) || null,
      ramo,
      cliente: nombre,
      cuota: limpiar(cruda.cuota) || null,
      periodo: limpiar(cruda.periodo) || null,
      importe: typeof cruda.cuota_monto === 'number' && Number.isFinite(cruda.cuota_monto) ? cruda.cuota_monto : null,
      estado,
      tipo,
      causa,
      productor: limpiar(cruda.productor) || null,
      _orden: cruda.id,
    })
  }

  // Por fecha, la más nueva primero y, a igual fecha, el aviso más nuevo.
  filas.sort((a, b) => b.fecha.localeCompare(a.fecha) || b._orden - a._orden)
  return filas.map(({ _orden: _, ...fila }) => fila)
}
