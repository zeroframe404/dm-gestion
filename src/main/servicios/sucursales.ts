// Sucursales: sólo lectura. Las cuatro de la agencia (Dock Sud, Lanús, Sarandí y Daniel) las deja
// sembradas `ajustarCatalogoDeSucursales` en cada arranque; acá no se crea ninguna.
import { claveDeSucursal, sucursalCanonica, SUCURSALES } from '../../shared/sucursales'
import type { Sucursal } from '../../shared/tipos'
import { db } from '../db/base'
import { limpiar } from '../importacion/normalizar'

const ORDEN: readonly string[] = SUCURSALES

/**
 * El catálogo en el orden de la agencia, no en el del `id`: Sarandí se agregó después de las otras
 * tres, así que en una base vieja su id es el más alto y ordenar por id la mandaba al final de todos
 * los desplegables. Un nombre que no sea de los cuatro (queda si alguna base lo tenía) va al final.
 */
export function listarSucursales(): Sucursal[] {
  const filas = db().prepare('SELECT id, nombre FROM sucursales').all() as Sucursal[]
  const orden = (nombre: string) => {
    const posicion = ORDEN.indexOf(sucursalCanonica(nombre) ?? '')
    return posicion === -1 ? ORDEN.length : posicion
  }
  return filas.sort((a, b) => orden(a.nombre) - orden(b.nombre) || a.nombre.localeCompare(b.nombre, 'es'))
}

export function obtenerSucursal(id: number): Sucursal | null {
  const fila = db().prepare('SELECT id, nombre FROM sucursales WHERE id = ?').get(id) as Sucursal | undefined
  return fila ?? null
}

/**
 * El id de la sucursal del catálogo que corresponde a ese texto, sin distinguir mayúsculas, tildes ni
 * espacios de más, y entendiendo los dos nombres del mismo mostrador: la hoja escribe «LANUS»,
 * «DOCK SUD», «DOCKSUD» o «AVELLANEDA», y el catálogo dice «Lanús» y «Dock Sud».
 *
 * La comparación TIENE que hacerse acá y no en el SQL. `UPPER()` y `COLLATE NOCASE` de SQLite sólo
 * tocan el ASCII: `UPPER('Lanús')` devuelve `'LANúS'`, que no empata nunca con el «LANUS» de la
 * planilla. De las cuatro sucursales de la agencia, las que llevan tilde son justamente Lanús y
 * Sarandí, así que eran las que no se enganchaban con su catálogo mientras Dock Sud y Daniel andaban
 * bien. Son cuatro filas: recorrerlas no se nota.
 */
export function idDeSucursalPorNombre(nombre: string): number | null {
  const clave = claveDeSucursal(nombre)
  if (!clave) return null
  const buscado = sucursalCanonica(nombre)
  for (const fila of listarSucursales()) {
    if (buscado ? sucursalCanonica(fila.nombre) === buscado : claveDeSucursal(fila.nombre) === clave) return fila.id
  }
  return null
}

/**
 * El texto de sucursal listo para guardar: escrito como el catálogo, o null si viene vacío. Lo que la
 * agencia carga a mano —una consulta, un cliente nuevo— tiene que quedar igual que lo que trae la hoja,
 * o el mismo local termina siendo dos opciones distintas en el desplegable.
 */
export function sucursalParaGuardar(texto: string | null | undefined): string | null {
  const limpio = (texto ?? '').trim()
  if (!limpio) return null
  return sucursalCanonica(limpio) ?? limpio
}

/**
 * La lista para el desplegable de sucursal: las del catálogo primero, en el orden de la agencia, y
 * detrás lo que traigan los datos y no sea ninguna de ellas, alfabético.
 *
 * El caso real es Sarandí. Se agregó al catálogo cuando abrió el mostrador, pero las pantallas que
 * armaban el desplegable sólo con los valores ya cargados no la ofrecían hasta que alguien cargara la
 * primera fila con esa sucursal —y para cargarla había que poder elegirla—. Desde el mostrador se ve
 * como que la sucursal no existe: la de al lado está en la lista y la propia no.
 *
 * Lo que viene de los datos y no está en el catálogo tampoco se puede perder: son las filas viejas de
 * la hoja de Google con una sucursal que la agencia ya no usa («BRENDA» es la que quedó). Si esos
 * textos desaparecen del desplegable, esas filas siguen en el listado pero no hay ninguna opción que
 * las traiga, y no hay forma de encontrarlas para corregirlas.
 *
 * Se cruza con `mismaSucursal` y no comparando el texto: así «LANUS» de la planilla no se suma al lado
 * de «Lanús» del catálogo, ni «AVELLANEDA» al lado de «Dock Sud». Serían dos opciones para el mismo
 * mostrador y elegir una escondería las filas de la otra.
 *
 * Y TIENE que ser `mismaSucursal`, la misma que usan los filtros de sucursal de todas las pantallas.
 * Cuando esto plegaba más que el filtro pasaba lo peor de los dos mundos: la opción «AVELLANEDA» ya no
 * estaba —quedaba plegada dentro de «Dock Sud»— pero elegir «Dock Sud» comparaba el texto y no traía
 * esas filas, así que no había NINGUNA opción que las mostrara. La celda «Sucursal» de la Planilla del
 * mes y el alta de un riesgo son campos de texto libre con sugerencias: escribir ahí «Avellaneda»
 * sigue siendo posible, y esas filas tienen que poder encontrarse.
 *
 * Recibe los textos ya en memoria —`filas.map((f) => f.sucursal)`, o una consulta pasada a arreglo—
 * porque cada pantalla los saca de una tabla distinta: no hay una sola consulta que sirva a todas.
 */
export function sucursalesParaElegir(deLosDatos: Array<string | null | undefined>): string[] {
  // `mismaSucursal` escrita como clave, para poder cruzar con un Set en vez de comparar de a pares:
  // dentro del catálogo manda el nombre oficial, y fuera del catálogo cada texto sigue empatando
  // consigo mismo en vez de perderse. Dos textos dan la misma clave exactamente cuando `mismaSucursal`
  // dice que sí, que es como los comparan los filtros: son el mismo plegado escrito de dos formas.
  const identidad = (nombre: string) => claveDeSucursal(sucursalCanonica(nombre) ?? nombre)

  const vistas = new Set<string>()
  const lista: string[] = []
  // `listarSucursales()` ya viene en el orden de la agencia (Dock Sud, Lanús, Sarandí, Daniel) y deja
  // al final cualquier nombre que alguna base vieja tenga de más.
  for (const sucursal of listarSucursales()) {
    const clave = identidad(sucursal.nombre)
    if (!clave || vistas.has(clave)) continue
    vistas.add(clave)
    lista.push(sucursal.nombre)
  }

  const fueraDelCatalogo: string[] = []
  for (const valor of deLosDatos) {
    const texto = limpiar(valor)
    const clave = identidad(texto)
    if (!clave || vistas.has(clave)) continue
    vistas.add(clave)
    fueraDelCatalogo.push(texto)
  }

  return [...lista, ...fueraDelCatalogo.sort((a, b) => a.localeCompare(b, 'es'))]
}
