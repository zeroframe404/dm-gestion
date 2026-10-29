// Consulta del listado de Siniestros (ver el contrato en shared/listados/index.ts). Es de sólo lectura: nada de
// escribir en la base ni de mandar algo al servidor. Una fila por siniestro, con la póliza (ramo, productor) y el
// riesgo (vehículo de la póliza) traídos por JOIN. El estado sale de `normalizarEstadoSiniestro()`, la misma
// regla del módulo Siniestros.
import { coincideAlguno, diaDeFecha, dentroDelRango, limiteDeFecha, listaDeFiltro } from '../../shared/filtros'
import { ramaDeVehiculo, NOMBRE_RAMA } from '../../shared/ramas'
import { describirRiesgo, esVehiculo, leerIntegrantes, nombreDeTipoDeRiesgo } from '../../shared/riesgos'
import { mencionaRobo, normalizarEstadoSiniestro } from '../../shared/siniestros'
import { ESTADOS_DE_SINIESTRO, type EstadoSiniestro } from '../../shared/tipos'
import type { FiltrosDeSiniestrosListado, FilaDeSiniestroListado } from '../../shared/listados/siniestros'
import { db } from '../db/base'
import { limpiar, normalizarTexto } from '../importacion/normalizar'
import { objeto } from './validacion'

interface FilaCruda {
  id: number
  cliente_id: number | null
  poliza_id: number | null
  compania: string | null
  numero_siniestro: string | null
  descripcion: string | null
  observaciones: string | null
  numero_poliza_siniestro: string | null
  numero_poliza: string | null
  fecha_iso: string | null
  fecha_carga_iso: string | null
  cliente_nombre: string | null
  documento: string | null
  patente_siniestro: string | null
  estado: string | null
  productor: string | null
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
}

// Los mismos JOINs del módulo Siniestros (servicios/siniestros.ts) más la póliza y su vehículo: de ahí salen el
// ramo, el riesgo y el productor. El asegurado se resuelve igual que allá (fila, cliente, cliente de la póliza).
const SELECT_LISTADO = `
  SELECT
    s.id, COALESCE(s.cliente_id, po.cliente_id) AS cliente_id, s.poliza_id, s.compania,
    s.numero_siniestro, s.descripcion, s.observaciones, s.numero_poliza AS numero_poliza_siniestro,
    po.numero AS numero_poliza, s.fecha_iso, s.fecha_carga_iso,
    COALESCE(s.cliente_nombre, cl.nombre, clp.nombre) AS cliente_nombre,
    COALESCE(s.documento, cl.documento, clp.documento) AS documento,
    s.patente AS patente_siniestro, s.estado, po.productor,
    v.tipo AS tipo_vehiculo, v.categoria AS categoria_vehiculo, v.marca, v.modelo, v.chasis,
    v.direccion_riesgo, v.titular_nombre, v.titular_documento, v.integrantes, v.patente
  FROM siniestros s
  LEFT JOIN clientes cl ON cl.id = s.cliente_id
  LEFT JOIN polizas po ON po.id = s.poliza_id
  LEFT JOIN clientes clp ON clp.id = po.cliente_id
  LEFT JOIN vehiculos v ON v.id = po.vehiculo_id
`

/** Largo máximo del «tipo» en la celda: la descripción puede ser un párrafo. */
const LARGO_DEL_TIPO = 60

/**
 * Qué fue el siniestro, sin inventar categorías: la primera línea de la descripción, acortada; si no hay
 * descripción pero el siniestro menciona un robo, «Robo».
 */
function tipoDelSiniestro(fila: FilaCruda): string | null {
  const primeraLinea = limpiar(fila.descripcion).split(/\r?\n/)[0]?.trim() ?? ''
  if (primeraLinea) {
    return primeraLinea.length > LARGO_DEL_TIPO ? `${primeraLinea.slice(0, LARGO_DEL_TIPO - 1).trimEnd()}…` : primeraLinea
  }
  return mencionaRobo(fila.observaciones, fila.numero_siniestro) ? 'Robo' : null
}

/** Cómo se nombra el riesgo en una celda: igual que en el listado de Pólizas (marca y modelo, o la línea del riesgo). */
function describirElRiesgo(fila: FilaCruda): string | null {
  if (!fila.tipo_vehiculo && !fila.marca && !fila.modelo) return limpiar(fila.patente_siniestro) || null
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

/** El ramo de la póliza: la rama del vehículo («Auto», «Pick up»…) o, si no es una de las siete, el tipo de riesgo. */
function ramoDeLaFila(fila: FilaCruda): string | null {
  if (!fila.tipo_vehiculo) return null
  const rama = ramaDeVehiculo(fila.tipo_vehiculo, fila.categoria_vehiculo)
  if (rama) return NOMBRE_RAMA[rama]
  return nombreDeTipoDeRiesgo(fila.tipo_vehiculo) || null
}

export function listarSiniestrosDelListado(filtros: FiltrosDeSiniestrosListado): FilaDeSiniestroListado[] {
  const f = objeto(filtros ?? {}, 'Los filtros')
  const busqueda = normalizarTexto(f.busqueda)
  const companias = listaDeFiltro(f.companias)
  const productores = listaDeFiltro(f.productores)
  const estados = listaDeFiltro(f.estados).filter((e): e is EstadoSiniestro =>
    (ESTADOS_DE_SINIESTRO as readonly string[]).includes(e),
  )
  const desde = limiteDeFecha(f.fechaDesde)
  const hasta = limiteDeFecha(f.fechaHasta)

  // Todo se filtra en memoria con los comparadores de shared (tildes y mayúsculas), como el resto de los listados.
  const crudas = db().prepare(SELECT_LISTADO).all() as FilaCruda[]

  const filas: FilaDeSiniestroListado[] = []
  for (const cruda of crudas) {
    const fecha = diaDeFecha(cruda.fecha_iso) ?? diaDeFecha(cruda.fecha_carga_iso)
    if (!dentroDelRango(fecha, desde, hasta)) continue
    if (!coincideAlguno(companias, cruda.compania)) continue
    if (!coincideAlguno(productores, cruda.productor)) continue
    const estado = normalizarEstadoSiniestro(cruda.estado)
    if (estados.length > 0 && !estados.includes(estado)) continue
    const numeroDePoliza = limpiar(cruda.numero_poliza) || limpiar(cruda.numero_poliza_siniestro) || null
    if (busqueda) {
      const donde = [
        cruda.numero_siniestro,
        numeroDePoliza,
        cruda.cliente_nombre,
        cruda.documento,
        cruda.patente,
        cruda.patente_siniestro,
        cruda.compania,
      ]
      if (!donde.some((valor) => normalizarTexto(valor).includes(busqueda))) continue
    }
    filas.push({
      siniestroId: cruda.id,
      clienteId: cruda.cliente_id,
      polizaId: cruda.poliza_id,
      compania: limpiar(cruda.compania) || null,
      numero: limpiar(cruda.numero_siniestro) || null,
      tipo: tipoDelSiniestro(cruda),
      numeroDePoliza,
      ramo: ramoDeLaFila(cruda),
      fecha,
      asegurado: limpiar(cruda.cliente_nombre) || null,
      riesgo: describirElRiesgo(cruda),
      estado,
      productor: limpiar(cruda.productor) || null,
    })
  }

  // Los más recientes primero; los que no tienen fecha cargada, al final.
  return filas.sort((a, b) => {
    const porFecha = (b.fecha ?? '').localeCompare(a.fecha ?? '')
    return porFecha !== 0 ? porFecha : b.siniestroId - a.siniestroId
  })
}
