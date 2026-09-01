// Las credenciales que se cargan UNA vez y las tienen todas las computadoras.
//
// El problema de siempre: las credenciales de los servicios externos viven en el config.json de cada
// PC. Cargar el catálogo de vehículos significaba ir máquina por máquina, y con que una quedara sin
// cargar esa persona atendía el mostrador sin los desplegables y sin la categoría del vehículo, que
// es de lo que dependen la prima y la cobertura.
//
// Desde acá: el superadministrador las carga, viajan al VPS —que las guarda cifradas— y el resto de
// las computadoras las adopta sola al arrancar.
//
// Dos reglas que ordenan todo el archivo:
//
// 1. NADA DE ESTO PUEDE FRENAR EL PROGRAMA. Si el VPS no contesta, si el token está mal o si la
//    respuesta viene rara, se devuelve el motivo y se sigue con lo que haya guardado localmente. Un
//    programa que no abre porque un servidor no contestó es peor que uno sin catálogo.
// 2. LA ÚLTIMA CARGA GANA. No hay resolución de conflictos ni versiones: el superadministrador carga
//    y eso es lo que vale. Es una credencial, no un dato de la agencia.
import type { EstadoDeAjusteCompartido } from '../../shared/tipos'
import { adoptarCredencialesDeVehiculos, huellaDeVehiculos, valorCompartidoDeVehiculos } from './config'
import { ErrorDeNegocio } from './errores'
import { crearFuenteVps } from './sincronizacion'

/** La clave del ajuste en el servidor. La lista blanca del VPS sólo conoce ésta. */
const CLAVE_VEHICULOS = 'vehiculos'

/** Lo que se devuelve cuando ni siquiera hay puente: en desarrollo, o sin VPS configurado. */
const SIN_SERVIDOR: EstadoDeAjusteCompartido = {
  enElServidor: false,
  actualizadoEn: null,
  actualizadoPor: null,
  alDia: false,
  error: null,
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Cómo está el ajuste en el servidor y si esta computadora tiene lo mismo.
 *
 * Pide sólo la ficha (huella y fecha), no el secreto: para dibujar la pantalla no hace falta bajarse
 * una credencial, y no bajarla es una cosa menos que puede quedar dando vueltas en memoria.
 */
export async function estadoCompartidoDeVehiculos(): Promise<EstadoDeAjusteCompartido> {
  const vps = crearFuenteVps()
  if (!vps) return SIN_SERVIDOR
  try {
    const ficha = await vps.estadoAjuste(CLAVE_VEHICULOS)
    if (!ficha) return { ...SIN_SERVIDOR }
    return {
      enElServidor: true,
      actualizadoEn: ficha.actualizadoEn,
      actualizadoPor: ficha.actualizadoPor,
      alDia: ficha.huella === huellaDeVehiculos(),
      error: null,
    }
  } catch (error) {
    return { ...SIN_SERVIDOR, error: motivo(error) }
  }
}

/**
 * Manda al VPS lo que hay en esta computadora.
 *
 * Acá sí se propaga el error: esto lo dispara alguien que tocó «Guardar» y tiene que enterarse de que
 * el resto de las máquinas NO se enteró. Lo local ya quedó escrito antes de llamar a esto, así que un
 * fallo no pierde nada: se vuelve a intentar con el botón.
 */
export async function publicarVehiculosEnElVps(quien: string | null): Promise<EstadoDeAjusteCompartido> {
  const valor = valorCompartidoDeVehiculos()
  if (!valor) {
    throw new ErrorDeNegocio('No hay credenciales del catálogo cargadas en esta computadora para mandar al servidor.')
  }
  const vps = crearFuenteVps()
  if (!vps) {
    throw new ErrorDeNegocio(
      'La base del VPS no está disponible en esta computadora, así que las credenciales quedaron sólo acá.',
    )
  }
  const ficha = await vps.guardarAjuste(CLAVE_VEHICULOS, valor, quien)
  return {
    enElServidor: true,
    actualizadoEn: ficha.actualizadoEn,
    actualizadoPor: ficha.actualizadoPor,
    alDia: ficha.huella === huellaDeVehiculos(),
    error: null,
  }
}

/** Saca las credenciales compartidas del servidor. Lo de cada computadora se borra por separado. */
export async function borrarVehiculosDelVps(): Promise<void> {
  const vps = crearFuenteVps()
  if (!vps) return
  await vps.borrarAjuste(CLAVE_VEHICULOS)
}

export type ResultadoDeAdopcion = {
  adoptadas: boolean
  detalle: string
}

/**
 * Trae del servidor las credenciales y las escribe en esta computadora.
 *
 * Si ya coinciden no toca el config.json: reescribirlo pisaría el `refreshToken` de InfoAuto, que es
 * de esta máquina, y obligaría a volver a entrar con la clave en cada arranque.
 */
export async function adoptarVehiculosDelVps(): Promise<ResultadoDeAdopcion> {
  const vps = crearFuenteVps()
  if (!vps) return { adoptadas: false, detalle: 'No hay conexión con la base del VPS en esta computadora.' }

  const ajuste = await vps.leerAjuste(CLAVE_VEHICULOS)
  if (!ajuste) {
    return {
      adoptadas: false,
      detalle: 'El servidor todavía no tiene credenciales del catálogo. Las carga el superadministrador una sola vez.',
    }
  }
  if (ajuste.huella === huellaDeVehiculos()) {
    return { adoptadas: false, detalle: 'Esta computadora ya tenía las mismas credenciales que el servidor.' }
  }
  if (!adoptarCredencialesDeVehiculos(ajuste.valor)) {
    return { adoptadas: false, detalle: 'Lo que hay guardado en el servidor no tiene la forma de unas credenciales.' }
  }
  return { adoptadas: true, detalle: 'Se adoptaron las credenciales del catálogo que cargó el superadministrador.' }
}

/**
 * La adopción del arranque. No espera a nadie y no rompe nada: si el VPS no contesta, el programa
 * abre igual con lo que ya tenía.
 */
export function adoptarAjustesAlArrancar(): void {
  void adoptarVehiculosDelVps()
    .then((resultado) => {
      if (resultado.adoptadas) console.log(`[ajustes] ${resultado.detalle}`)
    })
    .catch((error) => {
      console.error('[ajustes] No se pudieron traer las credenciales compartidas del VPS:', motivo(error))
    })
}
