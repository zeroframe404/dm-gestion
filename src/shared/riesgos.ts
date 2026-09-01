// Qué es cada riesgo asegurado y cómo se nombra en una línea. Vive en shared porque lo usan el
// formulario de la póliza, la ficha del cliente y el proceso principal, y los tres tienen que decir lo
// mismo: «HOGAR · Mitre 1234» acá es «HOGAR · Mitre 1234» en todos lados.
import { NOMBRE_TIPO_RIESGO, TIPOS_DE_RIESGO, type IntegranteDePoliza, type TipoDeRiesgo } from './tipos'

function clave(valor: string | null | undefined): string {
  return (valor ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/** Otras maneras de escribir el mismo tipo, por si llega de la planilla o de una versión vieja. */
const ALIAS: Record<string, TipoDeRiesgo> = {
  AUTOMOVIL: 'AUTO',
  AUTOS: 'AUTO',
  MOTOS: 'MOTO',
  MOTOCICLETA: 'MOTO',
  BICI: 'BICICLETA',
  BICICLETAS: 'BICICLETA',
  'ACCIDENTES PERSONALES': 'ACCIDENTE PERSONAL',
  'ACC PERSONAL': 'ACCIDENTE PERSONAL',
  'ACC PERSONALES': 'ACCIDENTE PERSONAL',
  AP: 'ACCIDENTE PERSONAL',
  CASA: 'HOGAR',
  'COMBINADO FAMILIAR': 'HOGAR',
  COMERCIO: 'INTEGRAL DE COMERCIO',
  'INTEGRAL COMERCIO': 'INTEGRAL DE COMERCIO',
  OTROS: 'OTRO',
}

/** El tipo de riesgo que dice ese texto, o null si no es ninguno de los conocidos («CAMIONETA», vacío). */
export function tipoDeRiesgo(tipo: string | null | undefined): TipoDeRiesgo | null {
  const c = clave(tipo)
  if (!c) return null
  if ((TIPOS_DE_RIESGO as readonly string[]).includes(c)) return c as TipoDeRiesgo
  return ALIAS[c] ?? null
}

/**
 * true si el riesgo es un vehículo: un auto, una moto, o cualquier cosa que no sea uno de los riesgos
 * nuevos. Los vehículos importados de la planilla traen de todo en el tipo («CAMIONETA», «PICK UP»,
 * vacío), y todos ellos siguen siendo vehículos: van al catálogo y se les valida la antigüedad.
 */
export function esVehiculo(tipo: string | null | undefined): boolean {
  const conocido = tipoDeRiesgo(tipo)
  return conocido === null || conocido === 'AUTO' || conocido === 'MOTO'
}

/** «Hogar», «Accidente personal»… o el texto tal cual si no es un tipo conocido. */
export function nombreDeTipoDeRiesgo(tipo: string | null | undefined): string {
  const conocido = tipoDeRiesgo(tipo)
  return conocido ? NOMBRE_TIPO_RIESGO[conocido] : (tipo ?? '').trim()
}

/** Los integrantes tal como se guardan en la base (JSON) → la lista. Un texto roto o vacío es una lista vacía. */
export function leerIntegrantes(json: string | null | undefined): IntegranteDePoliza[] {
  if (!json) return []
  try {
    const lista = JSON.parse(json) as unknown
    if (!Array.isArray(lista)) return []
    return lista
      .map((item) => {
        const i = (item ?? {}) as { nombre?: unknown; documento?: unknown }
        return {
          nombre: typeof i.nombre === 'string' ? i.nombre.trim() : '',
          documento: typeof i.documento === 'string' ? i.documento.trim() : '',
        }
      })
      .filter((i) => i.nombre || i.documento)
  } catch {
    return []
  }
}

/** Lo que hace falta para nombrar un riesgo. Es un subconjunto de VehiculoDeCliente. */
export interface RiesgoParaDescribir {
  tipo: string | null
  patente?: string | null
  marca?: string | null
  modelo?: string | null
  anio?: string | null
  chasis?: string | null
  direccionRiesgo?: string | null
  titularNombre?: string | null
  titularDocumento?: string | null
  integrantes?: IntegranteDePoliza[] | null
}

function limpio(valor: string | null | undefined): string {
  return (valor ?? '').trim()
}

/** «JUAN PEREZ (12345678)»: la persona con su documento, si lo tiene. */
export function nombrarPersona(nombre: string | null | undefined, documento: string | null | undefined): string {
  const n = limpio(nombre)
  const d = limpio(documento)
  if (n && d) return `${n} (${d})`
  return n || d
}

/**
 * El riesgo en una sola línea, para el desplegable del formulario y las tablas.
 *  - Vehículo: «AB123CD · FORD FIESTA · 2018» (lo de siempre).
 *  - Bicicleta: «Bicicleta · TREK · cuadro 12345».
 *  - Accidente personal: «Accidente personal · JUAN PEREZ, ANA PEREZ y 2 más».
 *  - Hogar / comercio: «Hogar · MITRE 1234, LANUS».
 *  - Otros: «Otros · JUAN PEREZ (12345678)».
 * Devuelve '' si no hay nada con qué nombrarlo.
 */
export function describirRiesgo(riesgo: RiesgoParaDescribir): string {
  const tipo = tipoDeRiesgo(riesgo.tipo)
  if (esVehiculo(riesgo.tipo)) {
    const partes = [riesgo.patente, riesgo.marca, riesgo.modelo, riesgo.anio].map(limpio).filter(Boolean)
    return partes.join(' · ') || limpio(riesgo.tipo)
  }
  const nombre = NOMBRE_TIPO_RIESGO[tipo!]
  const detalle = detalleDeRiesgo(riesgo)
  return detalle ? `${nombre} · ${detalle}` : nombre
}

/** Sólo lo que distingue a ese riesgo, sin el tipo adelante: la dirección, el cuadro, las personas. */
export function detalleDeRiesgo(riesgo: RiesgoParaDescribir): string {
  const tipo = tipoDeRiesgo(riesgo.tipo)
  switch (tipo) {
    case 'BICICLETA': {
      const marca = limpio(riesgo.marca)
      const cuadro = limpio(riesgo.chasis)
      return [marca, cuadro && `cuadro ${cuadro}`].filter(Boolean).join(' · ')
    }
    case 'ACCIDENTE PERSONAL': {
      const nombres = (riesgo.integrantes ?? []).map((i) => limpio(i.nombre) || limpio(i.documento)).filter(Boolean)
      if (nombres.length === 0) return nombrarPersona(riesgo.titularNombre, riesgo.titularDocumento)
      if (nombres.length <= 2) return nombres.join(', ')
      return `${nombres.slice(0, 2).join(', ')} y ${nombres.length - 2} más`
    }
    case 'HOGAR':
    case 'INTEGRAL DE COMERCIO': {
      const direccion = limpio(riesgo.direccionRiesgo)
      const titular = limpio(riesgo.titularNombre)
      return direccion || titular
    }
    case 'OTRO':
      return nombrarPersona(riesgo.titularNombre, riesgo.titularDocumento)
    default:
      return [riesgo.patente, riesgo.marca, riesgo.modelo, riesgo.anio].map(limpio).filter(Boolean).join(' · ')
  }
}
