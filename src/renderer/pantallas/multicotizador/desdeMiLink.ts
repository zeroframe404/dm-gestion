// Cotizar lo que pidió alguien desde Mi link: el botón «Cotizar en el Multicotizador» del seguimiento
// de una solicitud abre el cotizador con el formulario en blanco y, encima, lo que dejó el visitante
// (vehículo, nombre, teléfono y código postal). Lo demás —uso, rastreador, condiciones— no lo sabe el
// visitante y queda como en cualquier cotización nueva.
import { normalizarTexto } from '../../../shared/multicotizador'
import type { SolicitudDeMiLink, VehiculoDeSolicitud } from '../../../shared/miLink'
import type { TipoDeVehiculo, VehiculoDelCatalogo } from '../../../shared/tipos'
import type { FormularioMulticotizador } from './FormularioDeCotizacion'

/** AUTO o MOTO según la solicitud; null si no es de vehículo (las de hogar, vida… no se cotizan acá). */
export function tipoDeLaSolicitud(solicitud: SolicitudDeMiLink): TipoDeVehiculo | null {
  if (solicitud.vehiculo) return solicitud.vehiculo.tipo
  if (solicitud.cobertura === 'auto') return 'AUTO'
  if (solicitud.cobertura === 'moto') return 'MOTO'
  return null
}

/**
 * «Juan Carlos Pérez» → nombre «Juan Carlos», apellido «Pérez». El visitante escribe su nombre en un
 * solo campo y el cotizador los pide separados; la última palabra como apellido acierta casi siempre,
 * y quien cotiza lo ve y lo corrige antes de mandar.
 */
function separarNombre(completo: string): { nombre: string; apellido: string } {
  const palabras = completo.trim().split(/\s+/).filter(Boolean)
  if (palabras.length < 2) return { nombre: palabras[0] ?? '', apellido: '' }
  return { nombre: palabras.slice(0, -1).join(' '), apellido: palabras[palabras.length - 1]! }
}

/**
 * El formulario en blanco con lo de la solicitud encima. El vehículo entra como escrito a mano (sin
 * código de catálogo): el que trae la solicitud sale del catálogo de la página pública, que no es el
 * de esta computadora; si los nombres coinciden con el de acá, `vehiculoDelCatalogo` lo identifica después.
 */
export function formularioDesdeMiLink(base: FormularioMulticotizador, solicitud: SolicitudDeMiLink): FormularioMulticotizador {
  const v = solicitud.vehiculo
  const cp = solicitud.codigoPostal.replace(/\D/g, '').slice(0, 4)
  return {
    ...base,
    ...separarNombre(solicitud.nombre),
    telefono: solicitud.telefono.trim(),
    codigoPostal: cp,
    vehiculo: v
      ? {
          ...base.vehiculo,
          marca: v.marca.trim(),
          modelo: v.modelo.trim(),
          linea: v.version.trim(),
          anio: v.anio ? String(v.anio) : '',
          categoria: '',
          catalogoCodigo: '',
        }
      : base.vehiculo,
  }
}

const iguales = (a: string, b: string) => normalizarTexto(a) === normalizarTexto(b)

/**
 * Busca el vehículo de la solicitud en el catálogo de esta computadora por sus nombres (marca, modelo
 * y versión de ese año) y, si lo encuentra entero, lo devuelve identificado: con su código y su
 * categoría, que es lo que las compañías usan para cotizar bien. Ante la menor duda —sin año, sin
 * catálogo, un nombre escrito distinto— devuelve null y el vehículo se queda como carga manual: un
 * vehículo mal identificado cotiza otro auto, uno escrito a mano sólo cotiza un poco peor.
 */
export async function vehiculoDelCatalogo(vehiculo: VehiculoDeSolicitud): Promise<VehiculoDelCatalogo | null> {
  if (!vehiculo.anio || !vehiculo.marca.trim() || !vehiculo.modelo.trim() || !vehiculo.version.trim()) return null
  const { tipo } = vehiculo
  const anio = String(vehiculo.anio)

  const estado = await window.dm.vehiculos.estado()
  if (!estado.ok || !estado.datos.hayCatalogo) return null

  const marcas = await window.dm.vehiculos.marcas(tipo)
  const marca = marcas.ok ? marcas.datos.find((m) => iguales(m.nombre, vehiculo.marca)) : undefined
  if (!marca) return null

  const modelos = await window.dm.vehiculos.modelos(tipo, marca.id, anio)
  const modelo = modelos.ok ? modelos.datos.find((m) => iguales(m.nombre, vehiculo.modelo)) : undefined
  if (!modelo) return null

  const lineas = await window.dm.vehiculos.lineas(tipo, marca.id, modelo.id, anio)
  // Dos versiones con el mismo nombre (distinta carrocería) no se pueden distinguir con lo que dejó el
  // visitante: mejor no elegir ninguna.
  const candidatas = lineas.ok ? lineas.datos.filter((l) => iguales(l.nombre, vehiculo.version)) : []
  if (candidatas.length !== 1) return null

  const resuelto = await window.dm.vehiculos.resolver(tipo, marca.id, modelo.id, candidatas[0]!.id, anio)
  return resuelto.ok ? resuelto.datos : null
}
