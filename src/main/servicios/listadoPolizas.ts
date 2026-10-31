// Consulta del listado de Pólizas (ver el contrato en shared/listados/index.ts). Es de sólo lectura: nada de
// escribir en la base ni de mandar algo al servidor. Una fila por póliza, con el cliente, el riesgo y el
// productor traídos por JOIN. El estado sale de `estadoDePoliza()`, la misma regla del módulo Pólizas.
import { coincideAlguno, listaDeFiltro } from '../../shared/filtros'
import { estadoDePoliza, pareceIso } from '../../shared/polizas'
import { mismaRama, ramaDeVehiculo, NOMBRE_RAMA } from '../../shared/ramas'
import { describirRiesgo, esVehiculo, leerIntegrantes, nombreDeTipoDeRiesgo } from '../../shared/riesgos'
import { hoyLocal } from '../../shared/semaforo'
import {
  ESTADOS_DEL_LISTADO_DE_POLIZAS,
  type EstadoDePolizaListado,
  type FilaDePolizaListado,
  type FiltrosDePolizasListado,
} from '../../shared/listados/polizas'
import { db } from '../db/base'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import { objeto } from './validacion'

interface FilaCruda {
  id: number
  numero: string | null
  propuesta: string | null
  compania: string | null
  activa: number
  productor: string | null
  vigencia_desde_iso: string | null
  vigencia_hasta_iso: string | null
  cliente_id: number
  cliente_nombre: string | null
  documento: string | null
  tipo_vehiculo: string | null
  categoria_vehiculo: string | null
  marca: string | null
  modelo: string | null
  chasis: string | null
  direccion_riesgo: string | null
  titular_nombre: string | null
  titular_documento: string | null
  integrantes: string | null
  patente: string | null
  motivo_baja: string | null
  tiene_sucesora: number
}

// Los mismos JOINs que el módulo Pólizas (servicios/polizas.ts), sin la cuota del mes que acá no hace falta:
// el riesgo sale de `vehiculos` y la baja es la más reciente de esa póliza.
const SELECT_LISTADO = `
  SELECT
    p.id, p.numero, p.propuesta, p.compania, p.activa, p.productor,
    p.vigencia_desde_iso, p.vigencia_hasta_iso, p.cliente_id,
    cl.nombre AS cliente_nombre, cl.documento,
    v.tipo AS tipo_vehiculo, v.categoria AS categoria_vehiculo, v.marca, v.modelo, v.chasis,
    v.direccion_riesgo, v.titular_nombre, v.titular_documento, v.integrantes, v.patente,
    b.motivo AS motivo_baja,
    EXISTS (SELECT 1 FROM polizas s WHERE s.poliza_anterior_id = p.id) AS tiene_sucesora
  FROM polizas p
  LEFT JOIN clientes cl ON cl.id = p.cliente_id
  LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
  LEFT JOIN bajas b ON b.id = (
    SELECT b2.id FROM bajas b2
    WHERE b2.poliza_id = p.id
    ORDER BY COALESCE(b2.fecha_baja_iso, b2.fecha_baja) DESC, b2.id DESC LIMIT 1)
`

/** Fuera de la cartera, con sucesora y sin baja anotada: se renovó, no se perdió (igual que en servicios/polizas.ts). */
function esRenovada(fila: FilaCruda): boolean {
  return fila.activa === 0 && fila.tiene_sucesora === 1 && fila.motivo_baja === null
}

/** Programada si la vigencia todavía no empezó; el resto lo decide `estadoDePoliza()`. */
function estadoDeLaFila(fila: FilaCruda, hoy: string): EstadoDePolizaListado {
  const estado = estadoDePoliza(fila.activa === 1, fila.vigencia_hasta_iso, hoy, esRenovada(fila))
  if (estado === 'ACTIVA') return fila.vigencia_desde_iso && fila.vigencia_desde_iso > hoy ? 'PROGRAMADA' : 'VIGENTE'
  return estado
}

/** Cómo se nombra el riesgo en una celda: igual que en el módulo Pólizas (marca y modelo, o la línea del riesgo). */
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

/** El ramo: la rama del vehículo («Auto», «Pick up»…) o, si no es una de las siete, el tipo de riesgo («Hogar»). */
function ramoDeLaFila(fila: FilaCruda): string | null {
  const rama = ramaDeVehiculo(fila.tipo_vehiculo, fila.categoria_vehiculo)
  if (rama) return NOMBRE_RAMA[rama]
  return nombreDeTipoDeRiesgo(fila.tipo_vehiculo) || null
}

/** true si la vigencia de la póliza se superpone con el rango (los límites vacíos no filtran). */
function vigenciaEnElRango(desdePoliza: string | null, hastaPoliza: string | null, desde: string, hasta: string): boolean {
  if (!desde && !hasta) return true
  const inicio = desdePoliza ?? hastaPoliza
  const fin = hastaPoliza ?? desdePoliza
  if (!inicio || !fin) return false
  if (desde && fin < desde) return false
  if (hasta && inicio > hasta) return false
  return true
}

export function listarPolizasDelListado(filtros: FiltrosDePolizasListado): FilaDePolizaListado[] {
  const f = objeto(filtros ?? {}, 'Los filtros')
  const busqueda = normalizarTexto(f.busqueda)
  const companias = listaDeFiltro(f.companias)
  const ramos = listaDeFiltro(f.ramos)
  const productores = listaDeFiltro(f.productores)
  const estados = listaDeFiltro(f.estados).filter((e): e is EstadoDePolizaListado =>
    (ESTADOS_DEL_LISTADO_DE_POLIZAS as readonly string[]).includes(e),
  )
  const desde = pareceIso(limpiar(f.vigenciaDesde)) ? limpiar(f.vigenciaDesde) : ''
  const hasta = pareceIso(limpiar(f.vigenciaHasta)) ? limpiar(f.vigenciaHasta) : ''
  const hoy = hoyLocal()

  // Todo se filtra en memoria con los comparadores de shared (tildes y mayúsculas): el `UPPER()` de SQLite
  // sólo sube el ASCII y dejaría afuera «Lanús» vs «LANUS». Son unas 2.400 filas: no se nota.
  const crudas = db().prepare(SELECT_LISTADO).all() as FilaCruda[]

  const filas: FilaDePolizaListado[] = []
  for (const cruda of crudas) {
    if (!coincideAlguno(companias, cruda.compania)) continue
    if (!coincideAlguno(productores, cruda.productor)) continue
    if (ramos.length > 0 && !ramos.some((r) => mismaRama(r, ramoDeLaFila(cruda)))) continue
    if (!vigenciaEnElRango(cruda.vigencia_desde_iso, cruda.vigencia_hasta_iso, desde, hasta)) continue
    const estado = estadoDeLaFila(cruda, hoy)
    if (estados.length > 0 && !estados.includes(estado)) continue
    if (busqueda) {
      const donde = [cruda.cliente_nombre, cruda.documento, cruda.numero, cruda.propuesta, cruda.patente]
      if (!donde.some((valor) => normalizarTexto(valor).includes(busqueda))) continue
    }
    filas.push({
      polizaId: cruda.id,
      clienteId: cruda.cliente_id,
      compania: limpiar(cruda.compania) || null,
      numero: limpiar(cruda.numero) || null,
      ramo: ramoDeLaFila(cruda),
      cliente: limpiar(cruda.cliente_nombre) || 'Sin nombre',
      riesgo: describirElRiesgo(cruda),
      vigenciaDesde: cruda.vigencia_desde_iso,
      vigenciaHasta: cruda.vigencia_hasta_iso,
      estado,
      productor: limpiar(cruda.productor) || null,
    })
  }

  // La vigencia más reciente primero; las que no tienen fecha cargada, al final.
  return filas.sort((a, b) => {
    const porDesde = (b.vigenciaDesde ?? '').localeCompare(a.vigenciaDesde ?? '')
    if (porDesde !== 0) return porDesde
    const porHasta = (b.vigenciaHasta ?? '').localeCompare(a.vigenciaHasta ?? '')
    return porHasta !== 0 ? porHasta : b.polizaId - a.polizaId
  })
}
