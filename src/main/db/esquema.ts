/**
 * Reconciliación del esquema: repara bases que quedaron con columnas, tablas o índices de menos.
 *
 * Por qué hace falta. `ejecutarMigraciones` sólo corre las versiones mayores a `PRAGMA user_version`:
 * una versión ya aplicada nunca se vuelve a mirar. Si el SQL de una migración YA PUBLICADA se edita
 * (se le agrega una columna en vez de escribir una versión nueva), las PCs que ya habían pasado por esa
 * versión se quedan sin esa columna para siempre, mientras que una instalación desde cero la tiene. La
 * base queda «adelantada» en `user_version` y «atrasada» en columnas, y el error aparece recién cuando
 * alguna consulta la nombra: «table filas_crudas has no column named huella».
 *
 * Cómo se repara. Se arma el esquema ESPERADO corriendo todas las migraciones sobre una base en memoria
 * (o sea: la verdad es el propio archivo de migraciones, no una lista escrita a mano que se desactualiza),
 * se compara contra el esquema REAL y se agrega lo que falte. Es idempotente: en una base sana no toca
 * nada. No borra ni modifica nada existente; sólo agrega.
 *
 * Además, si hubo que aplicar algo tarde de una migración, se vuelven a correr las sentencias de DATOS de
 * esa migración (las semillas y los rellenos). Si no, reponer una tabla la dejaría vacía —«plantillas_mensaje»
 * sin sus plantillas fijas— y una columna marca llegaría con todos los valores en cero.
 */
import Database from 'better-sqlite3'
import { MIGRACIONES } from './migraciones'

type BaseDeDatos = Database.Database

export interface ReparacionDeEsquema {
  /** Tablas que faltaban y se crearon. */
  tablas: string[]
  /** Columnas que faltaban y se agregaron, como «tabla.columna». */
  columnas: string[]
  /** Índices que faltaban y se crearon. */
  indices: string[]
  /**
   * Columnas que se pudieron agregar pero sin todas sus restricciones. `ALTER TABLE ADD COLUMN` es más
   * estricto que `CREATE TABLE`: no acepta UNIQUE, ni NOT NULL sin un valor por defecto constante. Se
   * avisan aparte porque esa base queda distinta de una instalada desde cero.
   */
  parciales: string[]
  /** Lo que no se pudo reparar, con el motivo. La aplicación sigue abriendo igual. */
  fallidas: string[]
}

interface ObjetoDelEsquema {
  nombre: string
  tabla: string
  sql: string
}

interface ColumnaDeTabla {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

/** Palabras con las que empieza una restricción de tabla (no una columna) dentro del CREATE TABLE. */
const RESTRICCIONES_DE_TABLA = new Set(['PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN', 'CONSTRAINT'])

function migracionesEnOrden() {
  return [...MIGRACIONES].sort((a, b) => a.version - b.version)
}

/**
 * Base en memoria con todas las migraciones aplicadas: el esquema tal como lo tendría una instalación
 * desde cero con esta versión de la aplicación.
 */
export function baseDeReferencia(): BaseDeDatos {
  const referencia = new Database(':memory:')
  // Sin claves foráneas: acá sólo interesa la forma del esquema, y así no importa el orden de creación.
  referencia.pragma('foreign_keys = OFF')
  for (const migracion of migracionesEnOrden()) referencia.exec(migracion.sql)
  return referencia
}

function objetosDelTipo(db: BaseDeDatos, tipo: 'table' | 'index' | 'view' | 'trigger'): ObjetoDelEsquema[] {
  const filas = db
    .prepare(
      `SELECT name, tbl_name, sql FROM sqlite_master
       WHERE type = ? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
    )
    .all(tipo) as Array<{ name: string; tbl_name: string; sql: string }>
  return filas.map((f) => ({ nombre: f.name, tabla: f.tbl_name, sql: f.sql }))
}

function columnasDe(db: BaseDeDatos, tabla: string): ColumnaDeTabla[] {
  return db.pragma(`table_info(${entrecomillar(tabla)})`) as ColumnaDeTabla[]
}

function entrecomillar(nombre: string): string {
  return '"' + nombre.replace(/"/g, '""') + '"'
}

function escaparParaRegExp(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------------------
// Lectura del SQL: hace falta un mínimo de análisis porque las migraciones traen comentarios adentro de
// las definiciones y valores como `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, llenos de comas.
// ---------------------------------------------------------------------------

/**
 * Recorre el SQL cortándolo en pedazos por el separador dado, respetando paréntesis, textos entre
 * comillas y comentarios (que se descartan).
 */
function partir(sql: string, separador: ',' | ';', respetarParentesis: boolean): string[] {
  const partes: string[] = []
  let actual = ''
  let profundidad = 0
  let i = 0

  while (i < sql.length) {
    const c = sql[i]

    if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i)
      i = fin === -1 ? sql.length : fin + 1
      actual += ' '
      continue
    }
    if (c === '/' && sql[i + 1] === '*') {
      const fin = sql.indexOf('*/', i + 2)
      i = fin === -1 ? sql.length : fin + 2
      actual += ' '
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2
          else break
        } else j += 1
      }
      actual += sql.slice(i, Math.min(j + 1, sql.length))
      i = j + 1
      continue
    }
    if (c === '[') {
      const fin = sql.indexOf(']', i)
      const corte = fin === -1 ? sql.length : fin + 1
      actual += sql.slice(i, corte)
      i = corte
      continue
    }

    if (respetarParentesis) {
      if (c === '(') profundidad += 1
      else if (c === ')') profundidad -= 1
    }

    if (c === separador && profundidad === 0) {
      partes.push(actual)
      actual = ''
      i += 1
      continue
    }

    actual += c
    i += 1
  }

  partes.push(actual)
  return partes.map((p) => p.trim()).filter((p) => p !== '')
}

/** Las sentencias de un bloque SQL, sin comentarios y sin el punto y coma. */
export function sentenciasDe(sql: string): string[] {
  return partir(sql, ';', true)
}

/** El cuerpo del CREATE TABLE: lo que hay entre el primer paréntesis y el que lo cierra. */
function cuerpoDelCreate(sql: string): string | null {
  const abre = sql.indexOf('(')
  if (abre === -1) return null
  const cierra = sql.lastIndexOf(')')
  if (cierra <= abre) return null
  return sql.slice(abre + 1, cierra)
}

function nombreDeLaParte(parte: string): string | null {
  const m = /^\s*(?:"((?:[^"]|"")+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_$]*))/.exec(parte)
  if (!m) return null
  const crudo = m[1] ?? m[2] ?? m[3] ?? m[4]!
  return m[1] !== undefined ? crudo.replace(/""/g, '"') : crudo
}

/**
 * La declaración exacta de una columna, tal como quedó guardada en `sqlite_master`. SQLite conserva el
 * texto original del CREATE TABLE y, cuando se hace `ALTER TABLE ... ADD COLUMN`, le agrega la definición
 * nueva al final: por eso alcanza con leer de ahí para recuperar tipo, DEFAULT, CHECK y REFERENCES.
 */
export function declaracionDeColumna(sqlDeLaTabla: string, columna: string): string | null {
  const cuerpo = cuerpoDelCreate(sqlDeLaTabla)
  if (cuerpo === null) return null
  for (const parte of partir(cuerpo, ',', true)) {
    const nombre = nombreDeLaParte(parte)
    if (nombre === null) continue
    if (RESTRICCIONES_DE_TABLA.has(nombre.toUpperCase())) continue
    if (nombre.toLowerCase() === columna.toLowerCase()) return parte.replace(/\s+/g, ' ').trim()
  }
  return null
}

/**
 * Versión «floja» de la declaración, para cuando SQLite rechaza la exacta. Deja sólo el tipo y el valor
 * por defecto si es literal: pierde NOT NULL, UNIQUE, CHECK, COLLATE y REFERENCES, por eso la columna que
 * la necesite se informa en `parciales` y no como un arreglo limpio.
 */
function declaracionFloja(columna: ColumnaDeTabla): { sql: string; relleno: string | null } {
  const tipo = columna.type && columna.type.trim() !== '' ? ' ' + columna.type : ''
  const literal = columna.dflt_value !== null && /^('[^']*'|-?\d+(\.\d+)?|NULL)$/i.test(columna.dflt_value.trim())
  const defecto = literal ? ' DEFAULT ' + columna.dflt_value : ''
  return {
    sql: entrecomillar(columna.name) + tipo + defecto,
    relleno: literal && columna.notnull === 1 ? columna.dflt_value : null,
  }
}

// ---------------------------------------------------------------------------
// De qué migración vino cada cosa
// ---------------------------------------------------------------------------

function migracionQueCreaLaTabla(tabla: string): number | null {
  const patron = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${escaparParaRegExp(tabla)}"?\\s*\\(`, 'i')
  return migracionesEnOrden().find((m) => patron.test(m.sql))?.version ?? null
}

function migracionQueAgregaLaColumna(tabla: string, columna: string): number | null {
  const alter = new RegExp(
    `ALTER\\s+TABLE\\s+"?${escaparParaRegExp(tabla)}"?\\s+ADD\\s+COLUMN\\s+"?${escaparParaRegExp(columna)}"?[\\s(]`,
    'i',
  )
  return migracionesEnOrden().find((m) => alter.test(m.sql))?.version ?? migracionQueCreaLaTabla(tabla)
}

function migracionQueCreaElIndice(nombre: string): number | null {
  const patron = new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?"?${escaparParaRegExp(nombre)}"?[\\s(]`, 'i')
  return migracionesEnOrden().find((m) => patron.test(m.sql))?.version ?? null
}

/**
 * Las tablas que quedan cuando terminan todas las migraciones.
 *
 * Se lee del texto de las migraciones y no de una base de referencia porque acá sólo hacen falta los
 * NOMBRES, y armar la base cuesta bastante más que leer tres expresiones regulares. El orden dentro de
 * una misma migración no importa: una tabla que se crea y se borra en la misma versión (la de al lado
 * de una tabla que se rehace) no está al final, se mire como se mire.
 */
function tablasDelEsquemaFinal(): Set<string> {
  const tablas = new Set<string>()
  for (const migracion of migracionesEnOrden()) {
    for (const [, nombre] of migracion.sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) {
      tablas.add(nombre.toLowerCase())
    }
    for (const [, nombre] of migracion.sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) {
      tablas.delete(nombre.toLowerCase())
    }
    for (const [, viejo, nuevo] of migracion.sql.matchAll(/ALTER\s+TABLE\s+"?(\w+)"?\s+RENAME\s+TO\s+"?(\w+)"?/gi)) {
      tablas.delete(viejo.toLowerCase())
      tablas.add(nuevo.toLowerCase())
    }
  }
  return tablas
}

/** A qué tabla le escribe una sentencia de datos, o null si no se pudo leer. */
function tablaQueEscribe(sentencia: string): string | null {
  const encontrado = /^(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+"?(\w+)"?/i.exec(sentencia)
  return encontrado ? encontrado[1]!.toLowerCase() : null
}

/**
 * Las sentencias de datos de una migración (semillas y rellenos), listas para volver a correr: los INSERT
 * pasan a ser `INSERT OR IGNORE` para no chocar con lo que ya esté. Los UPDATE de las migraciones están
 * escritos con un WHERE que los hace idempotentes (lo verifica pruebas/esquema.prueba.ts).
 *
 * Quedan afuera las que le escriben a una tabla que YA NO EXISTE al final de las migraciones (14.0). Ésas
 * no son semillas: son la copia del medio de una tabla rehecha con los doce pasos de SQLite —la migración
 * 29 vuelve a crear `mensajes` para que `tipo` acepte LLAMADA y la copia pasa por `mensajes_nueva`, que
 * al terminar ya no está—. Repetirlas no repone ningún dato: falla con «no such table» y ensucia el
 * informe de la reparación con un problema que no existe.
 */
export function sentenciasDeDatos(version: number): string[] {
  const migracion = MIGRACIONES.find((m) => m.version === version)
  if (!migracion) return []
  const finales = tablasDelEsquemaFinal()
  return sentenciasDe(migracion.sql)
    .filter((s) => /^(INSERT|UPDATE|DELETE)\b/i.test(s))
    .filter((s) => {
      const destino = tablaQueEscribe(s)
      return destino === null || finales.has(destino)
    })
    .map((s) => s.replace(/^INSERT\s+INTO\b/i, 'INSERT OR IGNORE INTO'))
}

// ---------------------------------------------------------------------------
// La reconciliación
// ---------------------------------------------------------------------------

/**
 * Compara la base contra el esquema esperado y agrega lo que falte. Devuelve qué se reparó.
 * No corre dentro de una transacción única a propósito: si un arreglo falla, los demás igual se aplican.
 */
export function reconciliarEsquema(db: BaseDeDatos): ReparacionDeEsquema {
  const reparacion: ReparacionDeEsquema = { tablas: [], columnas: [], indices: [], parciales: [], fallidas: [] }
  const referencia = baseDeReferencia()
  /** Migraciones de las que hubo que aplicar algo tarde: hay que repetirles las sentencias de datos. */
  const aRellenar = new Set<number>()

  try {
    const tablasReales = new Map(objetosDelTipo(db, 'table').map((t) => [t.nombre.toLowerCase(), t]))
    const tablasEsperadas = objetosDelTipo(referencia, 'table')

    // 1. Tablas que faltan enteras.
    for (const tabla of tablasEsperadas) {
      if (tablasReales.has(tabla.nombre.toLowerCase())) continue
      try {
        db.exec(tabla.sql)
        reparacion.tablas.push(tabla.nombre)
        const version = migracionQueCreaLaTabla(tabla.nombre)
        if (version !== null) aRellenar.add(version)
      } catch (error) {
        reparacion.fallidas.push(`tabla ${tabla.nombre}: ${mensaje(error)}`)
      }
    }

    // 2. Columnas que faltan en tablas que sí existen.
    for (const tabla of tablasEsperadas) {
      if (reparacion.tablas.includes(tabla.nombre)) continue
      const real = tablasReales.get(tabla.nombre.toLowerCase())
      if (!real) continue

      const presentes = new Set(columnasDe(db, real.nombre).map((c) => c.name.toLowerCase()))
      for (const esperada of columnasDe(referencia, tabla.nombre)) {
        if (presentes.has(esperada.name.toLowerCase())) continue

        // Una clave primaria no se puede agregar con ALTER: la tabla habría que rehacerla entera. Es un
        // caso que no puede venir de una migración (todas agregan columnas comunes), así que se avisa.
        if (esperada.pk > 0) {
          reparacion.fallidas.push(
            `columna ${real.nombre}.${esperada.name}: es clave primaria y ALTER TABLE no puede agregarla`,
          )
          continue
        }

        const exacta = declaracionDeColumna(tabla.sql, esperada.name)
        let agregada = false

        if (exacta) {
          try {
            db.exec(`ALTER TABLE ${entrecomillar(real.nombre)} ADD COLUMN ${exacta}`)
            agregada = true
          } catch {
            // Cae al intento flojo: ADD COLUMN es más estricto que CREATE TABLE.
          }
        }
        if (!agregada) {
          const floja = declaracionFloja(esperada)
          try {
            db.exec(`ALTER TABLE ${entrecomillar(real.nombre)} ADD COLUMN ${floja.sql}`)
            if (floja.relleno !== null) {
              db.exec(
                `UPDATE ${entrecomillar(real.nombre)} SET ${entrecomillar(esperada.name)} = ${floja.relleno}` +
                  ` WHERE ${entrecomillar(esperada.name)} IS NULL`,
              )
            }
            agregada = true
            reparacion.parciales.push(`${real.nombre}.${esperada.name} (sin todas sus restricciones)`)
          } catch (error) {
            reparacion.fallidas.push(`columna ${real.nombre}.${esperada.name}: ${mensaje(error)}`)
          }
        }

        if (agregada) {
          reparacion.columnas.push(`${real.nombre}.${esperada.name}`)
          const version = migracionQueAgregaLaColumna(real.nombre, esperada.name)
          if (version !== null) aRellenar.add(version)
        }
      }
    }

    // 3. Índices, vistas y disparadores que falten (los índices implícitos de UNIQUE no están acá: los
    //    crea SQLite sola junto con la tabla).
    const faltantes: ObjetoDelEsquema[] = []
    for (const tipo of ['index', 'view', 'trigger'] as const) {
      const reales = new Set(objetosDelTipo(db, tipo).map((o) => o.nombre.toLowerCase()))
      for (const esperado of objetosDelTipo(referencia, tipo)) {
        if (reales.has(esperado.nombre.toLowerCase())) continue
        // Un índice de una tabla que tampoco se pudo crear no tiene sentido.
        if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(esperado.tabla)) continue
        faltantes.push(esperado)
        if (tipo === 'index') {
          const version = migracionQueCreaElIndice(esperado.nombre)
          if (version !== null) aRellenar.add(version)
        }
      }
    }

    // 4. Los datos de las migraciones de las que hubo que aplicar algo: las plantillas fijas que llenan
    //    una tabla recién creada, los rellenos de las columnas marca y el desempate que tiene que correr
    //    ANTES de crear los índices únicos (por eso este paso va antes del siguiente).
    for (const version of [...aRellenar].sort((a, b) => a - b)) {
      for (const sentencia of sentenciasDeDatos(version)) {
        try {
          db.exec(sentencia)
        } catch (error) {
          reparacion.fallidas.push(`datos de la migración ${version}: ${mensaje(error)}`)
        }
      }
    }

    // 5. Recién ahora, los índices.
    for (const esperado of faltantes) {
      try {
        db.exec(esperado.sql)
        if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX/i.test(esperado.sql)) reparacion.indices.push(esperado.nombre)
      } catch (error) {
        // Un índice UNIQUE puede fallar si la base ya tiene repetidos: se avisa y se sigue.
        reparacion.fallidas.push(`${esperado.nombre}: ${mensaje(error)}`)
      }
    }
  } finally {
    referencia.close()
  }

  return reparacion
}

function mensaje(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function huboReparacion(reparacion: ReparacionDeEsquema): boolean {
  return (
    reparacion.tablas.length > 0 ||
    reparacion.columnas.length > 0 ||
    reparacion.indices.length > 0 ||
    reparacion.parciales.length > 0 ||
    reparacion.fallidas.length > 0
  )
}

/** Una reparación que dejó la base distinta de una instalación desde cero, o que no pudo completarse. */
export function reparacionConProblemas(reparacion: ReparacionDeEsquema): boolean {
  return reparacion.parciales.length > 0 || reparacion.fallidas.length > 0
}

/** Resumen de una línea para el log y para la bitácora de sincronización. */
export function resumenDeReparacion(reparacion: ReparacionDeEsquema): string {
  const partes: string[] = []
  if (reparacion.tablas.length > 0) partes.push(`${reparacion.tablas.length} tabla(s): ${reparacion.tablas.join(', ')}`)
  if (reparacion.columnas.length > 0) partes.push(`${reparacion.columnas.length} columna(s): ${reparacion.columnas.join(', ')}`)
  if (reparacion.indices.length > 0) partes.push(`${reparacion.indices.length} índice(s): ${reparacion.indices.join(', ')}`)
  if (reparacion.parciales.length > 0) partes.push(`agregadas a medias: ${reparacion.parciales.join(', ')}`)
  if (reparacion.fallidas.length > 0) partes.push(`no se pudo reparar: ${reparacion.fallidas.join('; ')}`)
  return partes.join(' · ')
}
