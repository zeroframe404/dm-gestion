// Consulta del listado de Vencimientos (ver el contrato en shared/listados/index.ts). Es de sólo lectura: nada de
// escribir en la base ni de mandar algo al servidor. Una fila por póliza cuyo fin de vigencia cae en el rango.
//
// «Renovó» sale de `poliza_anterior_id` (la póliza que la reemplaza), igual que la bandeja de Renovaciones y el
// listado de Pólizas, y NO del estado: una póliza renovada puede seguir activa (destino «activa» al renovar).
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { pareceIso } from '../../shared/polizas'
import { mismaRama, ramaDeVehiculo, NOMBRE_RAMA } from '../../shared/ramas'
import { describirRiesgo, esVehiculo, leerIntegrantes, nombreDeTipoDeRiesgo } from '../../shared/riesgos'
import {
  NOMBRE_TIPO_DE_VENCIMIENTO,
  TIPOS_DE_VENCIMIENTO,
  type FilaDeVencimiento,
  type FiltrosDeVencimientos,
  type TipoDeVencimiento,
} from '../../shared/listados/vencimientos'
import { db } from '../db/base'
import { limpiar } from '../importacion/normalizar'
import { objeto } from './validacion'

interface FilaCruda {
  id: number
  numero: string | null
  compania: string | null
  activa: number
  productor: string | null
  forma_pago: string | null
  vigencia_hasta_iso: string
  cliente_id: number
  cliente_nombre: string | null
  tipo_vehiculo: string | null
  categoria_vehiculo: string | null
  marca: string | null
  modelo: string | null
  chasis: string | null
  direccion_riesgo: string | null
  titular_nombre: string | null
  titular_documento: string | null
  integrantes: string | null
  motivo_baja: string | null
  sucesora_id: number | null
  sucesora_numero: string | null
}

// Los mismos JOINs que el listado de Pólizas, más la póliza que la reemplaza (la más nueva, si hubiera más de una).
// El rango se filtra acá en SQL porque es una comparación de fechas ISO; lo demás (tildes, mayúsculas, ramas) en memoria.
const SELECT_VENCIMIENTOS = `
  SELECT
    p.id, p.numero, p.compania, p.activa, p.productor, p.forma_pago, p.vigencia_hasta_iso, p.cliente_id,
    cl.nombre AS cliente_nombre,
    v.tipo AS tipo_vehiculo, v.categoria AS categoria_vehiculo, v.marca, v.modelo, v.chasis,
    v.direccion_riesgo, v.titular_nombre, v.titular_documento, v.integrantes,
    b.motivo AS motivo_baja,
    s.id AS sucesora_id, s.numero AS sucesora_numero
  FROM polizas p
  LEFT JOIN clientes cl ON cl.id = p.cliente_id
  LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
  LEFT JOIN bajas b ON b.id = (
    SELECT b2.id FROM bajas b2
    WHERE b2.poliza_id = p.id
    ORDER BY COALESCE(b2.fecha_baja_iso, b2.fecha_baja) DESC, b2.id DESC LIMIT 1)
  LEFT JOIN polizas s ON s.id = (
    SELECT s2.id FROM polizas s2 WHERE s2.poliza_anterior_id = p.id ORDER BY s2.id DESC LIMIT 1)
  WHERE p.vigencia_hasta_iso IS NOT NULL
    AND p.vigencia_hasta_iso >= @desde
    AND p.vigencia_hasta_iso <= @hasta
`

/** Cómo se nombra el riesgo en una celda: igual que en el listado de Pólizas. */
function describirElRiesgo(fila: FilaCruda): string | null {
  if (!esVehiculo(fila.tipo_vehiculo)) {
    return (
      describirRiesgo({
        tipo: fila.tipo_vehiculo,
        marca: fila.marca,
        chasis: fila.chasis,
        direccionRiesgo: fila.direccion_riesgo,
        titularNombre: fila.titular_nombre,
        titularDocumento: fila.titular_documento,
        integrantes: leerIntegrantes(fila.integrantes),
      }) || null
    )
  }
  const descripcion = [limpiar(fila.marca), limpiar(fila.modelo)].filter(Boolean).join(' ')
  return descripcion || limpiar(fila.tipo_vehiculo) || null
}

/** El ramo: la rama del vehículo o, si no es una de las siete, el tipo de riesgo («Hogar»). */
function ramoDeLaFila(fila: FilaCruda): string | null {
  const rama = ramaDeVehiculo(fila.tipo_vehiculo, fila.categoria_vehiculo)
  if (rama) return NOMBRE_RAMA[rama]
  return nombreDeTipoDeRiesgo(fila.tipo_vehiculo) || null
}

export function listarVencimientos(filtros: FiltrosDeVencimientos): FilaDeVencimiento[] {
  const f = objeto(filtros ?? {}, 'Los filtros')
  const desde = pareceIso(limpiar(f.desde)) ? limpiar(f.desde) : ''
  const hasta = pareceIso(limpiar(f.hasta)) ? limpiar(f.hasta) : ''
  // Sin rango no se consulta nada: es una búsqueda, no una lista que se carga sola.
  if (!desde || !hasta || desde > hasta) return []

  // La refacturación no existe en el modelo: pedirla sola no trae nada; la mixta trae lo único que hay (renovaciones).
  const tipo = (TIPOS_DE_VENCIMIENTO as readonly string[]).includes(limpiar(f.tipo)) ? (limpiar(f.tipo) as TipoDeVencimiento) : 'RENOVACION'
  if (tipo === 'REFACTURACION') return []

  const companias = listaDeFiltro(f.companias)
  const ramas = listaDeFiltro(f.ramas)
  const productores = listaDeFiltro(f.productores)
  const formasDePago = listaDeFiltro(f.formasDePago)
  const incluirAnuladas = f.incluirAnuladas === true
  const excluirRenovadas = f.excluirRenovadas === true
  const soloRenovadas = f.soloRenovadas === true

  const crudas = db().prepare(SELECT_VENCIMIENTOS).all({ desde, hasta }) as FilaCruda[]

  const filas: FilaDeVencimiento[] = []
  for (const cruda of crudas) {
    if (!coincideAlguno(companias, cruda.compania)) continue
    if (!coincideAlguno(productores, cruda.productor)) continue
    if (!coincideAlguno(formasDePago, cruda.forma_pago)) continue
    if (ramas.length > 0 && !ramas.some((r) => mismaRama(r, ramoDeLaFila(cruda)))) continue

    const renovada = cruda.sucesora_id !== null
    // Anulada = fuera de la cartera por una baja SIN sucesora («No renueva», baja directa). En este listado
    // «Renovó» manda: la que se renovó con destino «baja» también tiene baja con motivo, pero sí se renovó, así
    // que no se descarta ni se marca como anulada.
    const anulada = cruda.activa === 0 && !renovada
    if (anulada && !incluirAnuladas) continue
    if (excluirRenovadas && renovada) continue
    if (soloRenovadas && !renovada) continue

    filas.push({
      polizaId: cruda.id,
      clienteId: cruda.cliente_id,
      compania: limpiar(cruda.compania) || null,
      numero: limpiar(cruda.numero) || null,
      ramo: ramoDeLaFila(cruda),
      cliente: limpiar(cruda.cliente_nombre) || 'Sin nombre',
      vencimiento: cruda.vigencia_hasta_iso,
      tipo: NOMBRE_TIPO_DE_VENCIMIENTO.RENOVACION,
      renovada,
      renovadaPorId: cruda.sucesora_id,
      renovadaPorNumero: limpiar(cruda.sucesora_numero) || null,
      anulada,
      formaPago: limpiar(cruda.forma_pago) || null,
      riesgo: describirElRiesgo(cruda),
      productor: limpiar(cruda.productor) || null,
    })
  }

  // Por fecha de vencimiento (la más próxima primero) y, a igual fecha, por cliente.
  return filas.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || a.cliente.localeCompare(b.cliente, 'es') || a.polizaId - b.polizaId)
}
