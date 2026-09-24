// El catálogo de vehículos: la caché en SQLite y el selector encadenado que la lee.
//
// La regla que ordena todo el archivo: DIBUJAR UN DESPLEGABLE NUNCA SALE A INTERNET. El selector lee
// siempre de la base, y a internet se sale una sola vez, cuando alguien toca «Refrescar catálogo» en
// Administración. Si no fuera así, elegir un vehículo en el mostrador sería medio segundo de espera
// por cada clic —y nada cuando se corta la conexión, que es cuando más se cobra.
//
// Sin credenciales o sin catálogo bajado, todo sigue funcionando: el formulario cae solo a los campos
// de texto libre de siempre y no se bloquea ningún guardado. Un programa que no deja cargar una
// póliza porque un proveedor externo no contesta es peor que no tener el catálogo.
import {
  NOMBRE_CATEGORIA,
  NOMBRE_PROVEEDOR_CATALOGO,
  TIPOS_DE_VEHICULO,
  type CategoriaDeVehiculo,
  type EstadoDelCatalogo,
  type EstadoDeUnTipo,
  type LineaDeCatalogo,
  type OpcionDeCatalogo,
  type ProgresoDeCatalogo,
  type PruebaDelProveedor,
  type TipoDeVehiculo,
  type VehiculoDelCatalogo,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, limpiar, normalizarTexto } from '../importacion/normalizar'
import { crearProveedorDnrpa } from '../vehiculos/dnrpa'
import { crearProveedorInfoauto } from '../vehiculos/infoauto'
import { crearProveedorMercadoLibre } from '../vehiculos/mercadolibre'
import { ErrorDeProveedor, type ProveedorDeVehiculos } from '../vehiculos/proveedor'
import { credencialesDeVehiculos, guardarRefrescoDeVehiculos, proveedorDeVehiculosElegido, rutaDeLaConfig } from './config'
import { ErrorDeNegocio } from './errores'

/** Pasado esto, el catálogo se considera viejo y la pantalla lo dice. Los modelos salen todo el año. */
export const DIAS_ANTES_DE_ENVEJECER = 30

/**
 * El proveedor de las pruebas. Sin esto habría que salir a internet para probar cualquier cosa, y las
 * pruebas del proyecto no tocan la red.
 */
let proveedorDePrueba: ProveedorDeVehiculos | null = null

export function usarProveedorDePrueba(proveedor: ProveedorDeVehiculos | null): void {
  proveedorDePrueba = proveedor
}

function proveedor(): ProveedorDeVehiculos | null {
  if (proveedorDePrueba) return proveedorDePrueba
  const credenciales = credencialesDeVehiculos()
  if (!credenciales) return null
  if (credenciales.proveedor === 'DNRPA') {
    return crearProveedorDnrpa({ urlFuente: credenciales.urlFuente })
  }
  if (credenciales.proveedor === 'MERCADO_LIBRE') {
    return crearProveedorMercadoLibre({
      appId: credenciales.usuario,
      claveSecreta: credenciales.clave,
      accessToken: credenciales.accessToken,
    })
  }
  return crearProveedorInfoauto(
    { usuario: credenciales.usuario, clave: credenciales.clave, refreshToken: credenciales.refreshToken },
    (token) => guardarRefrescoDeVehiculos(token),
  )
}

export function hayProveedorConfigurado(): boolean {
  return proveedor() !== null
}

function esTipo(valor: unknown): valor is TipoDeVehiculo {
  return typeof valor === 'string' && (TIPOS_DE_VEHICULO as readonly string[]).includes(valor)
}

function exigirTipo(valor: unknown): TipoDeVehiculo {
  if (!esTipo(valor)) throw new ErrorDeNegocio('El tipo de vehículo tiene que ser Auto o Moto.')
  return valor
}

// ---------------------------------------------------------------------------
// El estado de la caché
// ---------------------------------------------------------------------------

function estadoDeUnTipo(tipo: TipoDeVehiculo): EstadoDeUnTipo {
  const fila = db().prepare('SELECT refrescado_en, marcas, modelos, lineas, ultimo_error FROM catalogo_estado WHERE tipo = ?').get(tipo) as
    | { refrescado_en: string | null; marcas: number; modelos: number; lineas: number; ultimo_error: string | null }
    | undefined
  return {
    tipo,
    refrescadoEn: fila?.refrescado_en ?? null,
    marcas: fila?.marcas ?? 0,
    modelos: fila?.modelos ?? 0,
    lineas: fila?.lineas ?? 0,
    ultimoError: fila?.ultimo_error ?? null,
  }
}

export function estadoDelCatalogo(): EstadoDelCatalogo {
  const credenciales = credencialesDeVehiculos()
  const porTipo = TIPOS_DE_VEHICULO.map(estadoDeUnTipo)
  const elegido = proveedorDeVehiculosElegido()
  const quien = proveedor()
  return {
    configurado: hayProveedorConfigurado(),
    proveedor: quien?.nombre ?? NOMBRE_PROVEEDOR_CATALOGO[elegido],
    proveedorId: elegido,
    usuario: credenciales?.usuario ?? '',
    tokenCargado: Boolean(credenciales?.accessToken),
    urlFuente: credenciales?.urlFuente ?? null,
    // Sin credenciales todavía no hay a quién preguntarle, y hay que decir algo: se muestran los dos
    // tipos, que es lo que la pantalla venía mostrando y lo que sirve Mercado Libre se corrige solo
    // en cuanto se guardan las credenciales.
    tiposQueSirve: quien ? quien.tiposQueSirve() : [...TIPOS_DE_VEHICULO],
    rutaDeConfig: rutaDeLaConfig(),
    porTipo,
    hayCatalogo: porTipo.some((estado) => estado.lineas > 0),
  }
}

// ---------------------------------------------------------------------------
// El selector encadenado: todo sale de la base
// ---------------------------------------------------------------------------

export function marcasDelCatalogo(tipo: unknown): OpcionDeCatalogo[] {
  const cual = exigirTipo(tipo)
  return db()
    .prepare('SELECT marca_id AS id, nombre FROM catalogo_marcas WHERE tipo = ? ORDER BY nombre_normalizado')
    .all(cual) as OpcionDeCatalogo[]
}

export function modelosDelCatalogo(tipo: unknown, marcaId: unknown): OpcionDeCatalogo[] {
  const cual = exigirTipo(tipo)
  const marca = limpiar(marcaId)
  if (!marca) return []
  return db()
    .prepare('SELECT modelo_id AS id, nombre FROM catalogo_modelos WHERE tipo = ? AND marca_id = ? ORDER BY nombre_normalizado')
    .all(cual, marca) as OpcionDeCatalogo[]
}

export function lineasDelCatalogo(tipo: unknown, marcaId: unknown, modeloId: unknown): LineaDeCatalogo[] {
  const cual = exigirTipo(tipo)
  const marca = limpiar(marcaId)
  const modelo = limpiar(modeloId)
  if (!marca || !modelo) return []
  const filas = db()
    .prepare(
      `SELECT linea_id AS id, nombre, anio_desde, anio_hasta, categoria
         FROM catalogo_lineas WHERE tipo = ? AND marca_id = ? AND modelo_id = ?
        ORDER BY nombre_normalizado`,
    )
    .all(cual, marca, modelo) as Array<{
    id: string
    nombre: string
    anio_desde: number | null
    anio_hasta: number | null
    categoria: string | null
  }>
  return filas.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    anioDesde: fila.anio_desde,
    anioHasta: fila.anio_hasta,
    categoria: (fila.categoria as CategoriaDeVehiculo | null) ?? null,
  }))
}

/**
 * Los años que se pueden elegir para una línea.
 *
 * Si el catálogo dice desde cuándo y hasta cuándo se fabricó, se ofrecen esos y ninguno más: un
 * Corolla 2015 no puede ser de una línea que salió en 2020, y ofrecerlo es dejar que el error entre.
 * Sin esos datos se ofrece una ventana razonable hacia atrás, que es mejor que un campo libre donde
 * alguien escribe «2O24» con una o.
 */
export function aniosDeLaLinea(tipo: unknown, marcaId: unknown, modeloId: unknown, lineaId: unknown, hoy = new Date()): number[] {
  const linea = lineasDelCatalogo(tipo, marcaId, modeloId).find((candidata) => candidata.id === limpiar(lineaId))
  const anioActual = hoy.getFullYear()
  // Los modelos del año que viene ya se venden en el último trimestre.
  const tope = Math.min(linea?.anioHasta ?? anioActual + 1, anioActual + 1)
  const piso = linea?.anioDesde ?? anioActual - 40
  const anios: number[] = []
  for (let anio = tope; anio >= piso; anio--) anios.push(anio)
  return anios
}

/**
 * El vehículo terminado, con la categoría que decidió el catálogo. Es lo único que devuelve la
 * categoría, y no hay ningún camino por el que la pantalla pueda mandar una distinta.
 */
export function resolverVehiculoDelCatalogo(tipo: unknown, marcaId: unknown, modeloId: unknown, lineaId: unknown, anio: unknown): VehiculoDelCatalogo {
  const cual = exigirTipo(tipo)
  const marca = db().prepare('SELECT nombre FROM catalogo_marcas WHERE tipo = ? AND marca_id = ?').get(cual, limpiar(marcaId)) as
    | { nombre: string }
    | undefined
  const modelo = db()
    .prepare('SELECT nombre FROM catalogo_modelos WHERE tipo = ? AND marca_id = ? AND modelo_id = ?')
    .get(cual, limpiar(marcaId), limpiar(modeloId)) as { nombre: string } | undefined
  const linea = db()
    .prepare('SELECT nombre, categoria FROM catalogo_lineas WHERE tipo = ? AND marca_id = ? AND modelo_id = ? AND linea_id = ?')
    .get(cual, limpiar(marcaId), limpiar(modeloId), limpiar(lineaId)) as { nombre: string; categoria: string | null } | undefined

  if (!marca || !modelo || !linea) {
    throw new ErrorDeNegocio('Ese vehículo no está en el catálogo bajado. Refrescalo desde Administración o cargalo a mano.')
  }
  const anioTexto = limpiar(anio)
  if (!/^\d{4}$/.test(anioTexto)) throw new ErrorDeNegocio('Elegí el año del vehículo.')

  return {
    tipo: cual,
    marca: marca.nombre,
    modelo: modelo.nombre,
    linea: linea.nombre,
    anio: anioTexto,
    categoria: (linea.categoria as CategoriaDeVehiculo | null) ?? null,
    // El código lleva el tipo adelante: los ids de autos y de motos se repiten entre sí.
    codigo: `${cual}:${limpiar(lineaId)}`,
  }
}

/**
 * El código de InfoAuto (CODIA) de un vehículo elegido del catálogo, o null si el catálogo que está
 * bajado para ese tipo no es el de InfoAuto. Es el código que entienden casi todas las compañías
 * argentinas —Galeno lo acepta en lugar de su propio catálogo—, y por eso el multicotizador lo prefiere
 * a buscar el vehículo por nombre en cada compañía. Con Mercado Libre o DNRPA los ids son de otro
 * sistema y no sirven para esto.
 */
export function codigoInfoAutoDe(codigoCatalogo: string): string | null {
  const [tipo, id] = codigoCatalogo.split(':')
  if (!esTipo(tipo) || !id) return null
  const fila = db().prepare('SELECT proveedor FROM catalogo_estado WHERE tipo = ?').get(tipo) as { proveedor: string | null } | undefined
  return fila?.proveedor === 'InfoAuto' ? id : null
}

/** El nombre legible de una categoría, para las pantallas que sólo tienen el código guardado. */
export function nombreDeCategoria(categoria: string | null): string {
  if (!categoria) return ''
  return NOMBRE_CATEGORIA[categoria as CategoriaDeVehiculo] ?? categoria
}

// ---------------------------------------------------------------------------
// Bajar el catálogo
// ---------------------------------------------------------------------------

/** Una bajada por vez: dos a la vez se pisarían en las mismas tablas y duplicarían el trabajo. */
let refrescoEnCurso = false

export function hayRefrescoEnCurso(): boolean {
  return refrescoEnCurso
}

function anotarEstado(tipo: TipoDeVehiculo, nombreProveedor: string, cuentas: { marcas: number; modelos: number; lineas: number } | null, error: string | null): void {
  db()
    .prepare(
      `INSERT INTO catalogo_estado (tipo, proveedor, refrescado_en, marcas, modelos, lineas, ultimo_error)
       VALUES (@tipo, @proveedor, @refrescado_en, @marcas, @modelos, @lineas, @ultimo_error)
       ON CONFLICT(tipo) DO UPDATE SET proveedor = excluded.proveedor,
         refrescado_en = COALESCE(excluded.refrescado_en, catalogo_estado.refrescado_en),
         marcas = CASE WHEN excluded.refrescado_en IS NULL THEN catalogo_estado.marcas ELSE excluded.marcas END,
         modelos = CASE WHEN excluded.refrescado_en IS NULL THEN catalogo_estado.modelos ELSE excluded.modelos END,
         lineas = CASE WHEN excluded.refrescado_en IS NULL THEN catalogo_estado.lineas ELSE excluded.lineas END,
         ultimo_error = excluded.ultimo_error`,
    )
    .run({
      tipo,
      proveedor: nombreProveedor,
      refrescado_en: cuentas ? ahoraIso() : null,
      marcas: cuentas?.marcas ?? 0,
      modelos: cuentas?.modelos ?? 0,
      lineas: cuentas?.lineas ?? 0,
      ultimo_error: error,
    })
}

/**
 * Baja el catálogo de un tipo y reemplaza lo que había.
 *
 * Se borra y se vuelve a escribir dentro de UNA transacción, al final: si la bajada se corta a la
 * mitad, la caché anterior queda intacta. Borrar primero y bajar después dejaría al mostrador sin
 * catálogo justo el día que se cortó internet.
 */
async function refrescarUnTipo(
  quien: ProveedorDeVehiculos,
  tipo: TipoDeVehiculo,
  avisar: (progreso: ProgresoDeCatalogo) => void,
): Promise<void> {
  avisar({ tipo, etapa: 'marcas', hechas: 0, totales: 0, detalle: 'Pidiendo las marcas…' })
  const marcas = await quien.marcas(tipo)

  const modelos: Array<{ marcaId: string; id: string; nombre: string }> = []
  for (const [indice, marca] of marcas.entries()) {
    avisar({ tipo, etapa: 'modelos', hechas: indice, totales: marcas.length, detalle: `Modelos de ${marca.nombre}` })
    modelos.push(...(await quien.modelos(tipo, marca.id)))
  }

  const lineas: Awaited<ReturnType<ProveedorDeVehiculos['lineas']>> = []
  for (const [indice, modelo] of modelos.entries()) {
    avisar({ tipo, etapa: 'lineas', hechas: indice, totales: modelos.length, detalle: `Versiones de ${modelo.nombre}` })
    lineas.push(...(await quien.lineas(tipo, modelo.marcaId, modelo.id)))
  }

  // Una bajada que no trajo nada NO puede borrar lo que había. El proveedor no siempre falla con un
  // error: si cambia la forma de la respuesta (otra envoltura, otro nombre para el id), la lectura
  // devuelve listas vacías en silencio, y entonces el borrado de más abajo dejaría al mostrador sin
  // catálogo y lo anotaría como un refresco exitoso, sin motivo que mirar. Se corta acá, por el
  // camino del error, que conserva las cuentas anteriores y guarda el porqué.
  if (marcas.length === 0) {
    throw new ErrorDeProveedor(
      'El catálogo no devolvió ninguna marca. No se tocó lo que ya estaba bajado; probá de nuevo o revisá la cuenta.',
      false,
    )
  }
  if (lineas.length === 0) {
    throw new ErrorDeProveedor(
      `El catálogo devolvió ${marcas.length} marca(s) pero ninguna versión. No se tocó lo que ya estaba bajado.`,
      false,
    )
  }

  const ahora = ahoraIso()
  db().transaction(() => {
    db().prepare('DELETE FROM catalogo_marcas WHERE tipo = ?').run(tipo)
    db().prepare('DELETE FROM catalogo_modelos WHERE tipo = ?').run(tipo)
    db().prepare('DELETE FROM catalogo_lineas WHERE tipo = ?').run(tipo)

    const insertarMarca = db().prepare(
      `INSERT INTO catalogo_marcas (proveedor, tipo, marca_id, nombre, nombre_normalizado, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const marca of marcas) insertarMarca.run(quien.nombre, tipo, marca.id, marca.nombre, normalizarTexto(marca.nombre), ahora)

    const insertarModelo = db().prepare(
      `INSERT INTO catalogo_modelos (proveedor, tipo, marca_id, modelo_id, nombre, nombre_normalizado, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const modelo of modelos) {
      insertarModelo.run(quien.nombre, tipo, modelo.marcaId, modelo.id, modelo.nombre, normalizarTexto(modelo.nombre), ahora)
    }

    const insertarLinea = db().prepare(
      `INSERT INTO catalogo_lineas (proveedor, tipo, marca_id, modelo_id, linea_id, nombre, nombre_normalizado,
                                    anio_desde, anio_hasta, categoria, categoria_cruda, precio_lista, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const linea of lineas) {
      insertarLinea.run(
        quien.nombre,
        tipo,
        linea.marcaId,
        linea.modeloId,
        linea.id,
        linea.nombre,
        normalizarTexto(linea.nombre),
        linea.anioDesde,
        linea.anioHasta,
        linea.categoria,
        linea.categoriaCruda,
        linea.precioLista,
        ahora,
      )
    }
    anotarEstado(tipo, quien.nombre, { marcas: marcas.length, modelos: modelos.length, lineas: lineas.length }, null)
  })()

  avisar({ tipo, etapa: 'listo', hechas: lineas.length, totales: lineas.length, detalle: `${lineas.length} versiones guardadas` })
}

/** `tipo` en null refresca los dos. Que falle uno no impide que el otro se baje. */
export async function refrescarCatalogo(tipo: unknown, avisar: (progreso: ProgresoDeCatalogo) => void): Promise<EstadoDelCatalogo> {
  const quien = proveedor()
  if (!quien) {
    throw new ErrorDeNegocio('Todavía no está configurado el catálogo de vehículos. Se carga en Administración → Catálogo de vehículos.')
  }
  if (refrescoEnCurso) throw new ErrorDeNegocio('Ya hay un refresco del catálogo en curso. Esperá a que termine.')

  const cuales = tipo === null || tipo === undefined ? quien.tiposQueSirve() : [exigirTipo(tipo)]
  refrescoEnCurso = true
  try {
    for (const cual of cuales) {
      try {
        await refrescarUnTipo(quien, cual, avisar)
      } catch (error) {
        // La agencia puede tener contratados los autos y no las motos: que falle uno no puede tirar
        // abajo el otro, y el motivo queda anotado para que la pantalla lo muestre.
        const motivo = error instanceof Error ? error.message : String(error)
        anotarEstado(cual, quien.nombre, null, motivo)
        console.error(`[vehiculos] No se pudo refrescar el catálogo de ${cual}:`, motivo)
      }
    }
  } finally {
    refrescoEnCurso = false
  }
  return estadoDelCatalogo()
}

export async function probarProveedorDeVehiculos(): Promise<PruebaDelProveedor> {
  const quien = proveedor()
  if (!quien) {
    return { ok: false, detalle: 'Faltan el usuario y la clave del catálogo en esta computadora.', marcasEncontradas: 0 }
  }
  try {
    const prueba = await quien.probar()
    return { ok: prueba.ok, detalle: prueba.detalle, marcasEncontradas: prueba.marcasEncontradas }
  } catch (error) {
    const esDeRed = error instanceof ErrorDeProveedor && error.esDeRed
    return {
      ok: false,
      detalle: esDeRed ? 'No hay conexión con el catálogo de vehículos.' : error instanceof Error ? error.message : String(error),
      marcasEncontradas: 0,
    }
  }
}
