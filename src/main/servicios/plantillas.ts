// Las plantillas de los mensajes de WhatsApp. Hasta la Fase 8 había una sola y vivía en
// `configuracion.plantilla_aviso`; ahora son varias, tienen nombre y se editan desde Marketing.
//
// Vive en su propio archivo, sin depender de la Cartera, porque la Cartera depende de él: el botón
// «Avisar» de la planilla del mes arma su mensaje con la plantilla fija `aviso_vencimiento`.
import {
  CLAVE_AVISO_DE_VENCIMIENTO,
  PLANTILLA_AVISO_POR_DEFECTO,
  VARIABLES_DE_PLANTILLA,
  type DatosDePlantilla,
  type PlantillaAviso,
  type PlantillaDeMensaje,
  type VariableDePlantilla,
} from '../../shared/tipos'
import { db } from '../db/base'
import { ahoraIso, normalizarTexto } from '../importacion/normalizar'
import { ErrorDeNegocio } from './errores'
import { texto } from './validacion'

/** Con qué datos se muestra el ejemplo de cada plantilla en la pantalla. */
const CLIENTE_DE_EJEMPLO: Record<VariableDePlantilla, string> = {
  nombre: 'María',
  cuota: '44.800',
  vencimiento: '11',
  patente: 'AB123CD',
  compania: 'SANCOR',
}

interface PlantillaCruda {
  id: number
  clave: string
  nombre: string
  descripcion: string | null
  texto: string
  fija: number
  actualizado_en: string
}

/**
 * Reemplaza las variables de una plantilla. Lo que no venga se reemplaza por vacío: es preferible un
 * mensaje al que le falta la patente que un mensaje que dice «{patente}».
 */
export function aplicarPlantilla(plantilla: string, valores: Partial<Record<VariableDePlantilla, string | null>>): string {
  let mensaje = plantilla
  for (const variable of VARIABLES_DE_PLANTILLA) {
    mensaje = mensaje.replace(new RegExp(`\\{${variable}\\}`, 'g'), valores[variable] ?? '')
  }
  return mensaje
}

/**
 * Con qué palabra se saluda a alguien que en la hoja está escrito APELLIDO NOMBRE: con la segunda,
 * que es el nombre de pila. Es la misma regla desde la Fase 4 y no puede haber dos.
 */
export function saludoDe(nombre: string | null): string {
  const partes = (nombre ?? '').split(/\s+/).filter(Boolean)
  return partes.length > 1 ? partes[1]! : (partes[0] ?? '')
}

function aPlantilla(cruda: PlantillaCruda): PlantillaDeMensaje {
  return {
    id: cruda.id,
    clave: cruda.clave,
    nombre: cruda.nombre,
    descripcion: cruda.descripcion,
    texto: cruda.texto,
    fija: cruda.fija === 1,
    actualizadoEn: cruda.actualizado_en,
    ejemplo: aplicarPlantilla(cruda.texto, CLIENTE_DE_EJEMPLO),
  }
}

const SELECT_PLANTILLAS = `SELECT id, clave, nombre, descripcion, texto, fija, actualizado_en FROM plantillas_mensaje`

export function listarPlantillas(): PlantillaDeMensaje[] {
  const crudas = db().prepare(`${SELECT_PLANTILLAS} ORDER BY fija DESC, nombre`).all() as PlantillaCruda[]
  return crudas.map(aPlantilla)
}

function buscar(clave: string): PlantillaCruda {
  const cruda = db().prepare(`${SELECT_PLANTILLAS} WHERE clave = ?`).get(clave) as PlantillaCruda | undefined
  if (!cruda) throw new ErrorDeNegocio('No se encontró esa plantilla. Actualizá la pantalla y probá de nuevo.')
  return cruda
}

/** El texto de una plantilla, o cadena vacía si esa clave ya no existe. */
export function textoDePlantilla(clave: string): string {
  const cruda = db().prepare(`SELECT texto FROM plantillas_mensaje WHERE clave = ?`).get(clave) as { texto: string } | undefined
  return cruda?.texto ?? ''
}

/** La plantilla del botón «Avisar». Si alguien la vació, vuelve la de fábrica: nunca un mensaje en blanco. */
export function plantillaDeAviso(): string {
  const guardada = textoDePlantilla(CLAVE_AVISO_DE_VENCIMIENTO)
  return guardada.trim() ? guardada : PLANTILLA_AVISO_POR_DEFECTO
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const CONOCIDAS = new Set<string>(VARIABLES_DE_PLANTILLA)

/**
 * Una variable mal escrita no se ve hasta que el mensaje ya salió: «{Nombre}» llega tal cual al
 * teléfono del cliente. Se corta acá, con la lista de las que sí valen.
 */
function validarTexto(valor: unknown): string {
  const limpio = texto(valor, 'El mensaje', 1, 1000)
  const desconocidas = [...limpio.matchAll(/\{([^}]*)\}/g)]
    .map((coincidencia) => coincidencia[1] ?? '')
    .filter((variable) => !CONOCIDAS.has(variable))
  if (desconocidas.length > 0) {
    throw new ErrorDeNegocio(
      `«{${desconocidas[0]}}» no es una variable válida. Se pueden usar ${VARIABLES_DE_PLANTILLA.map((v) => `{${v}}`).join(', ')}.`,
    )
  }
  return limpio
}

/** Una clave a partir del nombre: en minúsculas, sin tildes y con guiones bajos. */
function claveDe(nombre: string, usadas: Set<string>): string {
  const base =
    normalizarTexto(nombre)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'plantilla'
  if (!usadas.has(base)) return base
  for (let n = 2; ; n++) {
    const candidata = `${base}_${n}`
    if (!usadas.has(candidata)) return candidata
  }
}

// ---------------------------------------------------------------------------
// Alta, edición y baja
// ---------------------------------------------------------------------------

export function crearPlantilla(datos: DatosDePlantilla): PlantillaDeMensaje[] {
  const nombre = texto(datos?.nombre, 'El nombre de la plantilla', 2, 60)
  const contenido = validarTexto(datos?.texto)
  const usadas = new Set((db().prepare('SELECT clave FROM plantillas_mensaje').all() as Array<{ clave: string }>).map((f) => f.clave))
  const repetida = db().prepare('SELECT id FROM plantillas_mensaje WHERE nombre = ? COLLATE NOCASE').get(nombre)
  if (repetida) throw new ErrorDeNegocio(`Ya hay una plantilla que se llama «${nombre}».`)

  const ahora = ahoraIso()
  db()
    .prepare(
      `INSERT INTO plantillas_mensaje (clave, nombre, descripcion, texto, fija, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(claveDe(nombre, usadas), nombre, (datos?.descripcion ?? '').trim() || null, contenido, ahora, ahora)
  return listarPlantillas()
}

export function editarPlantilla(clave: string, datos: DatosDePlantilla): PlantillaDeMensaje[] {
  const actual = buscar(texto(clave, 'La plantilla', 1, 60))
  const contenido = validarTexto(datos?.texto)
  // A la plantilla fija se le cambia el texto y la descripción, pero no el nombre: la pantalla de la
  // Cartera y la de la Mora la nombran, y renombrarla dejaría dos nombres para la misma cosa.
  const nombre = actual.fija === 1 ? actual.nombre : texto(datos?.nombre, 'El nombre de la plantilla', 2, 60)
  const repetida = db()
    .prepare('SELECT id FROM plantillas_mensaje WHERE nombre = ? COLLATE NOCASE AND id <> ?')
    .get(nombre, actual.id)
  if (repetida) throw new ErrorDeNegocio(`Ya hay otra plantilla que se llama «${nombre}».`)

  db()
    .prepare('UPDATE plantillas_mensaje SET nombre = ?, descripcion = ?, texto = ?, actualizado_en = ? WHERE id = ?')
    .run(nombre, (datos?.descripcion ?? '').trim() || null, contenido, ahoraIso(), actual.id)
  return listarPlantillas()
}

export function borrarPlantilla(clave: string): PlantillaDeMensaje[] {
  const actual = buscar(texto(clave, 'La plantilla', 1, 60))
  if (actual.fija === 1) {
    throw new ErrorDeNegocio(`«${actual.nombre}» es la que usa el botón «Avisar» de la Cartera: se puede cambiar el texto, pero no borrar.`)
  }
  db().transaction(() => {
    // Un segmento que apuntaba a esta plantilla vuelve a la de vencimiento: no puede quedar sin ninguna.
    db().prepare('UPDATE segmentos SET plantilla_clave = ? WHERE plantilla_clave = ?').run(CLAVE_AVISO_DE_VENCIMIENTO, actual.clave)
    db().prepare('DELETE FROM plantillas_mensaje WHERE id = ?').run(actual.id)
  })()
  return listarPlantillas()
}

/** Lo que sigue usando Administración → Compañías, que edita sólo la plantilla del aviso. */
export function guardarPlantillaDeAviso(valor: unknown): PlantillaAviso {
  const contenido = validarTexto(valor)
  db()
    .prepare('UPDATE plantillas_mensaje SET texto = ?, actualizado_en = ? WHERE clave = ?')
    .run(contenido, ahoraIso(), CLAVE_AVISO_DE_VENCIMIENTO)
  return { texto: contenido }
}
