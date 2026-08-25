// La red de seguridad del esquema. Nace de un error real en la PC de Daniel: la importación fallaba con
// «table filas_crudas has no column named huella» aunque la aplicación abría sin problemas.
//
// La causa: `ejecutarMigraciones` sólo corre las versiones mayores a `PRAGMA user_version`, así que una
// migración YA APLICADA nunca se vuelve a mirar. Cuando se le agregó el `ALTER TABLE filas_crudas ADD
// COLUMN huella` a la migración 5 —que esa PC ya había pasado— la columna no llegó nunca, mientras que
// una instalación desde cero la tenía. Detalle que lo confirma: SQLite nombra la PRIMERA columna
// desconocida de la lista del INSERT, y en el INSERT del importador `sheet_id` va antes que `huella`;
// que el error dijera «huella» prueba que `sheet_id` sí estaba, o sea que la migración 5 había corrido
// pero con un cuerpo más viejo.
//
// Acá se prueban las dos mitades del arreglo: `reconciliarEsquema` repara las bases que ya quedaron mal,
// y la huella por versión avisa en el banco de pruebas si alguien vuelve a editar una migración vieja.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import {
  declaracionDeColumna,
  reconciliarEsquema,
  reparacionConProblemas,
  sentenciasDeDatos,
} from '../src/main/db/esquema'
import { MIGRACIONES } from '../src/main/db/migraciones'
import { importar } from './ayuda'
import { HUELLAS_POR_VERSION } from './esquema-congelado'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

/** El INSERT del importador, tal cual está en src/main/importacion/importador.ts. */
const INSERT_DEL_IMPORTADOR = `
  INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, periodo, numero_fila, datos_json, importacion_id, en_la_hoja, vista_en, sheet_id, huella, creado_en, actualizado_en)
  VALUES (@fila_id, @pestana, @tipo_pestana, @periodo, @numero_fila, @datos_json, @importacion_id, 1, @ahora, @sheet_id, @huella, @ahora, @ahora)`

/**
 * Una base como la de una PC que actualizó desde una versión vieja: todas las migraciones aplicadas y
 * `user_version` al día, pero con las sentencias de `omitir` nunca ejecutadas (porque en aquel momento
 * no estaban en el cuerpo de la migración).
 */
function baseDesactualizada(omitir: string[] = []): BaseDeDatos {
  const db = new Database(':memory:') as BaseDeDatos
  db.pragma('foreign_keys = ON')
  const omitidas = new Set<string>()
  for (const migracion of [...MIGRACIONES].sort((a, b) => a.version - b.version)) {
    let sql = migracion.sql
    for (const sentencia of omitir) {
      if (!sql.includes(sentencia)) continue
      sql = sql.replace(sentencia, '')
      omitidas.add(sentencia)
    }
    db.exec(sql)
    db.pragma('user_version = ' + migracion.version)
  }
  for (const sentencia of omitir) {
    assert.ok(omitidas.has(sentencia), `la sentencia a omitir no está en ninguna migración: ${sentencia}`)
  }
  return db
}

/** La última migración escrita: lo que tiene `user_version` en una PC al día. */
const ULTIMA_VERSION = Math.max(...MIGRACIONES.map((m) => m.version))

function columnas(db: BaseDeDatos, tabla: string): string[] {
  return (db.pragma(`table_info(${tabla})`) as Array<{ name: string }>).map((c) => c.name)
}

function sinCambios(reparacion: ReturnType<typeof reconciliarEsquema>): boolean {
  return (
    reparacion.tablas.length === 0 &&
    reparacion.columnas.length === 0 &&
    reparacion.indices.length === 0 &&
    reparacion.parciales.length === 0 &&
    reparacion.fallidas.length === 0
  )
}

/** Todas las sentencias que agregan algo al esquema después de haber creado las tablas. */
function sentenciasIncrementales(): string[] {
  return MIGRACIONES.flatMap((m) => [
    ...(m.sql.match(/ALTER TABLE [^;]+;/g) ?? []),
    ...(m.sql.match(/CREATE (?:UNIQUE )?INDEX [^;]+;/g) ?? []),
  ])
}

test('el error de Daniel: falta huella y el importador no puede ni preparar el INSERT', () => {
  const db = baseDesactualizada(['ALTER TABLE filas_crudas ADD COLUMN huella TEXT;'])

  assert.ok(columnas(db, 'filas_crudas').includes('sheet_id'), 'sheet_id sí estaba en su base')
  assert.ok(!columnas(db, 'filas_crudas').includes('huella'))
  assert.equal(db.pragma('user_version', { simple: true }), ULTIMA_VERSION, 'la base se ve al día')

  assert.throws(
    () => db.prepare(INSERT_DEL_IMPORTADOR),
    /table filas_crudas has no column named huella/,
    'el mensaje tiene que ser exactamente el del informe',
  )
  db.close()
})

test('reconciliarEsquema repara la columna que falta y el importador vuelve a andar', () => {
  const db = baseDesactualizada(['ALTER TABLE filas_crudas ADD COLUMN huella TEXT;'])
  db.prepare(
    `INSERT INTO filas_crudas (fila_id, pestana, tipo_pestana, numero_fila, datos_json, creado_en, actualizado_en)
     VALUES ('VIEJA', 'CARTERA 2025', 'CARTERA', 4, '{"a":1}', 'antes', 'antes')`,
  ).run()

  const reparacion = reconciliarEsquema(db)
  assert.deepEqual(reparacion.columnas, ['filas_crudas.huella'])
  assert.deepEqual(reparacion.fallidas, [])

  db.prepare(INSERT_DEL_IMPORTADOR).run({
    fila_id: 'NUEVA', pestana: 'CARTERA 2025', tipo_pestana: 'CARTERA', periodo: '2025-01', numero_fila: 5,
    datos_json: '{}', importacion_id: null, ahora: 'hoy', sheet_id: 7, huella: 'abc',
  })

  // La fila que ya estaba sigue intacta, con la columna nueva en NULL.
  const vieja = db.prepare(`SELECT datos_json, huella FROM filas_crudas WHERE fila_id = 'VIEJA'`).get() as
    | { datos_json: string; huella: string | null }
    | undefined
  assert.deepEqual(vieja, { datos_json: '{"a":1}', huella: null })
  assert.equal(db.prepare(`SELECT huella FROM filas_crudas WHERE fila_id = 'NUEVA'`).pluck().get(), 'abc')
  db.close()
})

test('en una base sana no toca nada, y correrla de nuevo tampoco', () => {
  const db = baseDesactualizada()
  assert.ok(sinCambios(reconciliarEsquema(db)), 'no debería reparar nada en una base al día')
  assert.ok(sinCambios(reconciliarEsquema(db)))
  db.close()
})

test('repara cualquier ALTER o índice que se haya perdido, uno por uno', () => {
  const sentencias = sentenciasIncrementales()
  assert.ok(sentencias.length >= 45, `se esperaban muchas sentencias incrementales, hay ${sentencias.length}`)

  let probadas = 0
  for (const sentencia of sentencias) {
    let db: BaseDeDatos
    try {
      db = baseDesactualizada([sentencia])
    } catch {
      // Sin esta sentencia una migración POSTERIOR no compila (por ejemplo el índice que usa la columna
      // recién agregada). O sea que no puede faltar sola en una base real: si hubiera faltado, aquella
      // migración habría explotado, `user_version` no habría avanzado y se volvería a intentar sola.
      continue
    }
    probadas += 1

    const reparacion = reconciliarEsquema(db)
    const arreglado = reparacion.tablas.length + reparacion.columnas.length + reparacion.indices.length

    assert.deepEqual(reparacion.fallidas, [], `no se pudo reparar: ${sentencia}`)
    assert.ok(arreglado > 0, `no detectó lo que falta: ${sentencia}`)
    assert.ok(sinCambios(reconciliarEsquema(db)), `no quedó estable después de reparar: ${sentencia}`)
    db.close()
  }
  assert.ok(probadas >= 40, `se probaron sólo ${probadas} sentencias de ${sentencias.length}`)
})

test('la columna reparada conserva tipo, valor por defecto, CHECK y REFERENCES', () => {
  // `prioridad` es la más exigente: NOT NULL, DEFAULT y CHECK a la vez.
  const db = baseDesactualizada([
    `ALTER TABLE tareas ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'NORMAL' CHECK (prioridad IN ('ALTA', 'NORMAL', 'BAJA'));`,
  ])
  reconciliarEsquema(db)

  const sql = db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'tareas'`).pluck().get() as string
  const declaracion = declaracionDeColumna(sql, 'prioridad')
  assert.ok(declaracion?.includes('NOT NULL'), declaracion ?? '(sin declaración)')
  assert.ok(declaracion?.includes("DEFAULT 'NORMAL'"), declaracion ?? '(sin declaración)')
  assert.ok(declaracion?.includes('CHECK'), declaracion ?? '(sin declaración)')

  const info = (db.pragma('table_info(tareas)') as Array<{ name: string; notnull: number; dflt_value: string | null }>)
    .find((c) => c.name === 'prioridad')
  assert.equal(info?.notnull, 1)
  assert.equal(info?.dflt_value, "'NORMAL'")
  db.close()
})

test('una columna NOT NULL que llega a una tabla con filas se completa con su valor por defecto', () => {
  const db = baseDesactualizada(['ALTER TABLE companias ADD COLUMN comision_porcentaje REAL NOT NULL DEFAULT 0;'])
  db.prepare(`INSERT INTO companias (nombre, nombre_normalizado, creado_en, actualizado_en) VALUES ('RUS', 'RUS', 'hoy', 'hoy')`).run()

  const reparacion = reconciliarEsquema(db)
  assert.deepEqual(reparacion.fallidas, [])
  assert.equal(db.prepare(`SELECT comision_porcentaje FROM companias WHERE nombre = 'RUS'`).pluck().get(), 0)
  db.close()
})

test('vuelve a crear una tabla entera que falte, con sus índices', () => {
  const db = baseDesactualizada()
  db.pragma('foreign_keys = OFF')
  db.exec('DROP TABLE lead_notas')
  db.pragma('foreign_keys = ON')

  const reparacion = reconciliarEsquema(db)
  assert.deepEqual(reparacion.tablas, ['lead_notas'])
  assert.ok(reparacion.indices.some((i) => i.includes('lead_notas')), JSON.stringify(reparacion.indices))
  assert.ok(sinCambios(reconciliarEsquema(db)))
  db.close()
})

test('una tabla repuesta vuelve con sus datos de fábrica, no vacía', () => {
  // Sin esto, reponer `plantillas_mensaje` dejaría a Marketing sin ninguna plantilla y borraría para
  // siempre la fija `aviso_vencimiento`, que la aplicación da por sentada (servicios/plantillas.ts).
  const db = baseDesactualizada()
  const antes = db.prepare('SELECT COUNT(*) FROM plantillas_mensaje').pluck().get() as number
  assert.ok(antes > 0, 'la migración siembra plantillas')

  db.pragma('foreign_keys = OFF')
  db.exec('DROP TABLE plantillas_mensaje')
  db.pragma('foreign_keys = ON')

  const reparacion = reconciliarEsquema(db)
  assert.deepEqual(reparacion.tablas, ['plantillas_mensaje'])
  assert.deepEqual(reparacion.fallidas, [])
  assert.equal(db.prepare('SELECT COUNT(*) FROM plantillas_mensaje').pluck().get(), antes)
  assert.equal(
    db.prepare(`SELECT fija FROM plantillas_mensaje WHERE clave = 'aviso_vencimiento'`).pluck().get(),
    1,
    'la plantilla fija tiene que volver',
  )
  db.close()
})

test('una columna marca repuesta se rellena con lo que hacía su migración', () => {
  // La migración 7 agrega `pagos.hecho_en_la_app` y a continuación marca los pagos que ya había cargado
  // la aplicación. Si la columna llega tarde y el relleno no se repite, esos pagos pasan a contarse como
  // importados de la hoja y se desarma la caja del día.
  // Se saca el par completo, que es como se habría agregado: la columna y su relleno van juntos.
  const db = baseDesactualizada([
    'ALTER TABLE pagos ADD COLUMN hecho_en_la_app INTEGER NOT NULL DEFAULT 0;',
    `UPDATE pagos SET hecho_en_la_app = 1 WHERE pestana = '(cargado en DM Gestión)';`,
  ])
  db.prepare(`INSERT INTO pagos (fila_id, pestana, creado_en, actualizado_en)
              VALUES ('P1', '(cargado en DM Gestión)', 'hoy', 'hoy')`).run()
  db.prepare(`INSERT INTO pagos (fila_id, pestana, creado_en, actualizado_en)
              VALUES ('P2', 'PAGOS 2025', 'hoy', 'hoy')`).run()

  reconciliarEsquema(db)
  assert.equal(db.prepare(`SELECT hecho_en_la_app FROM pagos WHERE fila_id = 'P1'`).pluck().get(), 1)
  assert.equal(db.prepare(`SELECT hecho_en_la_app FROM pagos WHERE fila_id = 'P2'`).pluck().get(), 0)
  db.close()
})

test('las sentencias de datos de las migraciones se pueden volver a correr sin cambiar nada', () => {
  // La reconciliación las repite cuando aplica algo tarde: tienen que ser idempotentes.
  const db = baseDesactualizada()
  const foto = () =>
    JSON.stringify(
      ['clientes', 'vehiculos', 'polizas', 'pagos', 'siniestros', 'plantillas_mensaje'].map((t) =>
        db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      ),
    )

  const hoja = new HojaSimulada(construirHojaDePrueba())
  return importar(db, hoja).then(() => {
    const antes = foto()
    for (const migracion of MIGRACIONES) {
      for (const sentencia of sentenciasDeDatos(migracion.version)) db.exec(sentencia)
    }
    assert.equal(foto(), antes, 'repetir las sentencias de datos no puede cambiar la base')
    db.close()
  })
})

/** Rehace una tabla con la forma dada, para simular deterioros que ninguna migración puede producir. */
function deformarTabla(db: BaseDeDatos, tabla: string, create: string): void {
  db.pragma('foreign_keys = OFF')
  db.exec(`DROP TABLE ${tabla}`)
  db.exec(create)
  db.pragma('foreign_keys = ON')
}

test('una columna que sólo se puede agregar a medias se informa aparte, no como arreglo limpio', () => {
  // `sucursales.nombre` es UNIQUE, y ALTER TABLE ADD COLUMN no acepta UNIQUE. Se agrega igual para que la
  // aplicación funcione, pero tiene que quedar avisado: esa base no es idéntica a una instalada de cero.
  const db = baseDesactualizada()
  deformarTabla(db, 'sucursales', 'CREATE TABLE sucursales (id INTEGER PRIMARY KEY AUTOINCREMENT)')

  const reparacion = reconciliarEsquema(db)
  assert.deepEqual(reparacion.columnas, ['sucursales.nombre'])
  assert.equal(reparacion.parciales.length, 1)
  assert.match(reparacion.parciales[0]!, /sucursales\.nombre/)
  assert.deepEqual(reparacion.fallidas, [])
  assert.ok(reparacionConProblemas(reparacion), 'tiene que quedar marcado como evento con error')

  db.prepare(`INSERT INTO sucursales (nombre) VALUES ('Lanús')`).run()
  db.close()
})

test('una clave primaria que falta se informa como no reparable, no se inventa una columna suelta', () => {
  const db = baseDesactualizada()
  deformarTabla(db, 'sucursales', 'CREATE TABLE sucursales (nombre TEXT NOT NULL UNIQUE)')

  const reparacion = reconciliarEsquema(db)
  assert.deepEqual(reparacion.columnas, [])
  assert.equal(reparacion.fallidas.length, 1)
  assert.match(reparacion.fallidas[0]!, /sucursales\.id.*clave primaria/)
  assert.ok(!columnas(db, 'sucursales').includes('id'), 'no tiene que agregar un id trucho')
  db.close()
})

test('un índice UNIQUE que no se puede crear por datos repetidos se avisa y no rompe el arranque', () => {
  const db = baseDesactualizada(['CREATE UNIQUE INDEX idx_usuarios_remoto ON usuarios (remoto_id);'])
  const { id } = db.prepare(`INSERT INTO sucursales (nombre) VALUES ('Daniel') RETURNING id`).get() as { id: number }
  db.prepare(`INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, remoto_id)
              VALUES ('A', 'a', 'x', 'EMPLEADO', ?, 9)`).run(id)
  db.prepare(`INSERT INTO usuarios (nombre, usuario, clave_hash, rol, sucursal_id, remoto_id)
              VALUES ('B', 'b', 'x', 'EMPLEADO', ?, 9)`).run(id)

  const reparacion = reconciliarEsquema(db)
  assert.deepEqual(reparacion.indices, [])
  assert.equal(reparacion.fallidas.length, 1)
  assert.match(reparacion.fallidas[0]!, /idx_usuarios_remoto/)
  db.close()
})

test('abrirBaseDeDatos repara al arrancar y deja constancia en la bitácora', (t) => {
  // La base se arma rota en un archivo temporal y se abre con la ruta real de la aplicación.
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-esquema-'))
  const ruta = path.join(carpeta, 'dm.db')
  t.after(() => {
    cerrarBaseDeDatos()
    rmSync(carpeta, { recursive: true, force: true })
  })

  const rota = new Database(ruta)
  for (const migracion of [...MIGRACIONES].sort((a, b) => a.version - b.version)) {
    rota.exec(migracion.sql.replace('ALTER TABLE filas_crudas ADD COLUMN huella TEXT;', ''))
    rota.pragma('user_version = ' + migracion.version)
  }
  rota.close()

  const registrar = { log: console.log, warn: console.warn }
  console.log = () => undefined
  console.warn = () => undefined
  let db: BaseDeDatos
  try {
    db = abrirBaseDeDatos(ruta)
  } finally {
    console.log = registrar.log
    console.warn = registrar.warn
  }

  assert.ok(columnas(db, 'filas_crudas').includes('huella'), 'la columna tiene que estar después de abrir')
  db.prepare(INSERT_DEL_IMPORTADOR).run({
    fila_id: 'A', pestana: 'X', tipo_pestana: 'CARTERA', periodo: null, numero_fila: 1,
    datos_json: '{}', importacion_id: null, ahora: 'hoy', sheet_id: null, huella: 'h',
  })

  const evento = db.prepare(`SELECT tipo, detalle FROM eventos_sync WHERE tipo = 'esquema'`).get() as
    | { tipo: string; detalle: string }
    | undefined
  assert.ok(evento, 'la reparación tiene que quedar anotada en Sincronización')
  assert.match(evento!.detalle, /filas_crudas\.huella/)
})

test('la importación entera corre sobre una base a la que le faltaba la columna', async () => {
  const db = baseDesactualizada(['ALTER TABLE filas_crudas ADD COLUMN huella TEXT;'])
  for (const nombre of ['Dock Sud', 'Lanús', 'Daniel']) {
    db.prepare('INSERT OR IGNORE INTO sucursales (nombre) VALUES (?)').run(nombre)
  }

  const hoja = new HojaSimulada(construirHojaDePrueba())
  await assert.rejects(
    () => importar(db, hoja),
    /table filas_crudas has no column named huella/,
    'antes de reparar tiene que fallar igual que en la PC de Daniel',
  )

  reconciliarEsquema(db)

  const { informe } = await importar(db, hoja)
  assert.equal(informe.estado, 'COMPLETA', informe.error ?? '')
  assert.ok(informe.totales.filasCrudas > 0)
  assert.ok(informe.totales.clientes > 0)
  assert.ok(informe.totales.polizas > 0)

  // Y correrla de nuevo no duplica: las huellas ya se están guardando.
  const segunda = await importar(db, hoja)
  assert.equal(segunda.informe.totales.clientes, informe.totales.clientes)
  assert.equal(
    db.prepare('SELECT COUNT(*) FROM filas_crudas WHERE huella IS NOT NULL').pluck().get(),
    informe.totales.filasCrudas,
    'todas las filas tienen que quedar con su huella',
  )
  db.close()
})

// ---------------------------------------------------------------------------
// El guardián: que no vuelva a pasar
// ---------------------------------------------------------------------------

/** La forma del esquema después de aplicar las migraciones 1..version, en texto normalizado. */
function esquemaHasta(version: number): string {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = OFF')
  for (const migracion of [...MIGRACIONES].sort((a, b) => a.version - b.version)) {
    if (migracion.version > version) break
    db.exec(migracion.sql)
  }

  const lineas: string[] = []
  const tablas = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .pluck()
    .all() as string[]
  for (const tabla of tablas) {
    const cols = db.pragma(`table_info("${tabla}")`) as Array<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>
    for (const c of [...cols].sort((a, b) => a.name.localeCompare(b.name))) {
      lineas.push(`${tabla}.${c.name} ${c.type} nn=${c.notnull} def=${c.dflt_value ?? ''} pk=${c.pk}`)
    }
  }
  const indices = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`)
    .all() as Array<{ name: string; sql: string }>
  for (const i of indices) lineas.push(`indice ${i.name}: ${i.sql.replace(/\s+/g, ' ').trim()}`)

  db.close()
  return lineas.join('\n')
}

function huellaDelEsquema(version: number): string {
  return createHash('sha256').update(esquemaHasta(version)).digest('hex').slice(0, 16)
}

test('ninguna migración ya publicada cambió de forma', () => {
  const versiones = MIGRACIONES.map((m) => m.version).sort((a, b) => a - b)
  assert.deepEqual(
    versiones,
    versiones.map((_, i) => i + 1),
    'las versiones tienen que ser 1..N sin saltos ni repetidas',
  )

  for (const version of versiones) {
    const esperada = HUELLAS_POR_VERSION[version]
    if (esperada === undefined) {
      assert.fail(
        `La migración ${version} es nueva y no tiene huella. Agregá "${version}: '${huellaDelEsquema(version)}'" ` +
          `en pruebas/esquema-congelado.ts.`,
      )
    }
    assert.equal(
      huellaDelEsquema(version),
      esperada,
      `Cambió el esquema que deja la migración ${version}, que ya está instalada en las PCs.\n` +
        `Una migración publicada no se edita: las bases que ya pasaron por esa versión nunca la vuelven a correr ` +
        `y se quedan sin el cambio (así apareció «table filas_crudas has no column named huella»).\n` +
        `Agregá una versión NUEVA al final de MIGRACIONES con el ALTER que necesitás.\n` +
        `Si el cambio es a propósito (por ejemplo estás preparando una versión todavía no publicada), ` +
        `actualizá la huella en pruebas/esquema-congelado.ts.`,
    )
  }
})

test('el guardián detecta de verdad una migración editada', () => {
  const original = MIGRACIONES[4]!.sql
  const antes = huellaDelEsquema(11)
  MIGRACIONES[4]!.sql = original + '\nALTER TABLE filas_crudas ADD COLUMN inventada TEXT;'
  try {
    assert.notEqual(huellaDelEsquema(11), antes, 'la huella tiene que cambiar si se edita una migración vieja')
    assert.notEqual(huellaDelEsquema(5), HUELLAS_POR_VERSION[5])
  } finally {
    MIGRACIONES[4]!.sql = original
  }
  assert.equal(huellaDelEsquema(11), antes, 'y volver a su valor al deshacer el cambio')
})
