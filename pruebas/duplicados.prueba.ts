// Cartera → Duplicados: el detector, la fusión de fichas y el «sacar» de cualquier rol.
import assert from 'node:assert/strict'
import test from 'node:test'
import { usarBaseDeDatos } from '../src/main/db/base'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { darDeBaja, planillaDelMes } from '../src/main/servicios/cartera'
import {
  clientesRepetidos,
  detectarDuplicados,
  fusionarClientes,
  repararClientesDuplicados,
  sacarBajaRepetida,
  sacarCuotaRepetida,
  vistaPreviaDeSacarCuota,
} from '../src/main/servicios/duplicados'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import type { SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { baseDePrueba, contar, importar, unico } from './ayuda'

const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 4, nombre: 'Daniel' }, debeCambiarClave: false }
const FEDE: SesionUsuario = { id: 2, nombre: 'Fede', usuario: 'fede', rol: 'EMPLEADO', sucursal: { id: 1, nombre: 'Dock Sud' }, debeCambiarClave: false }

async function baseImportada() {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const db = baseDePrueba()
  db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES (2, 'Fede', 'fede', 'sin-clave', 'EMPLEADO', (SELECT id FROM sucursales WHERE nombre = 'Dock Sud'), 1, 0)`,
  ).run()
  await importar(db, hoja)
  usarBaseDeDatos(db)
  return { db, hoja }
}

function idDe(db: ReturnType<typeof baseDePrueba>, nombre: string): number {
  return unico<number>(db, `SELECT id FROM clientes WHERE nombre = '${nombre}' ORDER BY id LIMIT 1`)
}

/** Una segunda ficha de la misma persona, cargada a mano sin DNI o con el DNI escrito de otra forma. */
function fichaRepetida(db: ReturnType<typeof baseDePrueba>, nombre: string, documento: string | null, clave: string): number {
  const ahora = ahoraIso()
  const documentoNormalizado = documento ? documento.replace(/\D/g, '').replace(/^(20|23|24|27)(\d{8})\d$/, '$2').replace(/^0+/, '') : null
  const { id } = db
    .prepare(
      `INSERT INTO clientes (clave, documento, documento_normalizado, nombre, telefono, email, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, '11-5555-0000', 'copia@prueba.com', ?, ?) RETURNING id`,
    )
    .get(clave, documento, documentoNormalizado, nombre, ahora, ahora) as { id: number }
  return id
}

test('dos fichas con el mismo DNI y el mismo nombre se juntan solas, y todo lo de la que se va pasa a la que queda', async () => {
  const { db, hoja } = await baseImportada()
  const original = idDe(db, CLIENTES.lopez.nombre)
  const copia = fichaRepetida(db, CLIENTES.lopez.nombre, '20-20111333-9', 'APP:copia0001')
  // Una de las pólizas de López quedó colgada de la copia, con su cuota y una tarea.
  db.prepare('UPDATE polizas SET cliente_id = ? WHERE cliente_id = ?').run(copia, original)
  db.prepare('UPDATE cuotas_mes SET cliente_id = ? WHERE cliente_id = ?').run(copia, original)
  db.prepare(`INSERT INTO notas (cliente_id, texto, usuario_id, usuario_nombre, creado_en) VALUES (?, 'llamar', 1, 'Daniel', ?)`).run(copia, ahoraIso())
  db.prepare(`UPDATE clientes SET localidad = NULL WHERE id = ?`).run(original)
  db.prepare(`UPDATE clientes SET localidad = 'LA COPIA' WHERE id = ?`).run(copia)

  const grupos = clientesRepetidos()
  const grupo = grupos.find((g) => g.clientes.some((c) => c.id === copia))
  assert.ok(grupo, 'el detector la encuentra')
  assert.equal(grupo.motivo, 'dni')
  assert.equal(grupo.clientes.find((c) => c.sugerida)?.id, original, 'sugiere conservar la ficha con la clave del DNI')

  assert.equal(repararClientesDuplicados(), 1, 'se junta sola')
  assert.equal(contar(db, 'clientes', `id = ${copia}`), 0, 'la copia se fue')
  assert.equal(contar(db, 'polizas', `cliente_id = ${copia}`), 0)
  assert.ok(contar(db, 'polizas', `cliente_id = ${original}`) >= 1, 'las pólizas volvieron a la ficha que queda')
  assert.equal(contar(db, 'notas', `cliente_id = ${original}`), 1, 'la nota también')
  assert.equal(contar(db, 'cuotas_mes', `cliente_id = ${copia}`), 0)
  assert.notEqual(unico<string>(db, `SELECT telefono FROM clientes WHERE id = ${original}`), '11-5555-0000', 'el teléfono que la ficha ya tenía no se pisa con el de la copia')
  // Lo que a la ficha le faltaba se completa con lo de la copia: se vacía la localidad antes para probarlo.
  assert.equal(unico<string>(db, `SELECT localidad FROM clientes WHERE id = ${original}`), 'LA COPIA', 'lo que le faltaba se completa con lo de la copia')
  assert.equal(contar(db, 'historial', `accion = 'fusion' AND registro_id = ${original}`), 1)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [], 'ninguna tabla quedó apuntando a la ficha que se fue')
  assert.equal(clientesRepetidos().some((g) => g.clientes.some((c) => c.id === copia)), false)

  // Y la fusión dura: volver a importar no la resucita.
  await importar(db, hoja)
  assert.equal(contar(db, 'clientes', `documento_normalizado = '20111333'`), 1)
  assert.equal(contar(db, 'clientes', `nombre = '${CLIENTES.lopez.nombre}'`), 1)
  db.close()
})

test('mismo DNI con OTRO nombre no se junta solo: puede ser un DNI mal tipeado', async () => {
  const { db } = await baseImportada()
  // La hoja de prueba trae a Martínez con el DNI de González a propósito: son dos personas.
  const conElMismoDni = contar(db, 'clientes', `documento_normalizado = '${CLIENTES.gonzalez.dniPlano}'`)
  const antes = contar(db, 'clientes')
  repararClientesDuplicados()
  assert.equal(contar(db, 'clientes'), antes, 'no se fusionó nada')
  if (conElMismoDni > 1) {
    const grupo = clientesRepetidos().find((g) => g.motivo === 'dni' && g.clientes.some((c) => c.nombre === CLIENTES.martinez.nombre))
    assert.ok(grupo, 'pero queda listado para que una persona decida')
  }
  db.close()
})

test('mismo nombre sin documento se lista, no se junta; fusionar a mano lo junta y el DNI viaja a la planilla', async () => {
  const { db } = await baseImportada()
  const original = idDe(db, CLIENTES.suarez.nombre)
  const copia = fichaRepetida(db, CLIENTES.suarez.nombre, null, 'APP:copia0002')
  // La cuota del mes de Suárez quedó colgada de la copia y sin DNI escrito.
  db.prepare(`UPDATE cuotas_mes SET cliente_id = ?, documento = NULL WHERE cliente_id = ? AND periodo = '2026-08'`).run(copia, original)
  const filaId = unico<string>(db, `SELECT fila_id FROM cuotas_mes WHERE cliente_id = ${copia} AND periodo = '2026-08'`)

  const grupo = clientesRepetidos().find((g) => g.clientes.some((c) => c.id === copia))
  assert.ok(grupo)
  assert.equal(grupo.motivo, 'nombre')
  assert.equal(repararClientesDuplicados(), 0, 'no se junta sola')
  assert.equal(contar(db, 'clientes', `id = ${copia}`), 1)

  const resultado = fusionarClientes(original, copia, DANIEL)
  assert.equal(resultado.eliminadoId, copia)
  assert.ok(resultado.movido.some((m) => m.que === 'cuota del mes' && m.cuantos === 1))
  assert.equal(unico<string>(db, `SELECT documento FROM cuotas_mes WHERE fila_id = '${filaId}'`), CLIENTES.suarez.dni, 'el renglón recibió el DNI de la ficha que queda')
  assert.equal(contar(db, 'cola_sync', `fila_id = '${filaId}' AND operacion = 'actualizar' AND estado = 'pendiente'`), 1, 'y viaja a la base con él')
  assert.equal(contar(db, 'clientes', `id = ${copia}`), 0)
  db.close()
})

test('fusionar exige dos fichas distintas que existan', async () => {
  const { db } = await baseImportada()
  const original = idDe(db, CLIENTES.lopez.nombre)
  assert.throws(() => fusionarClientes(original, original, DANIEL), ErrorDeNegocio)
  assert.throws(() => fusionarClientes(original, 999999, DANIEL), /ya no está/)
  db.close()
})

test('un renglón repetido de la planilla lo saca un EMPLEADO, pero sólo si el detector lo señaló', async () => {
  const { db } = await baseImportada()
  const lopez = planillaDelMes('2026-08').filas.find((f) => f.nombre === CLIENTES.lopez.nombre)!
  const ahora = ahoraIso()
  // La copia que dejaba una carrera de la sincronización: otro _ID, mismo mes, misma póliza.
  db.prepare(
    `INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania, numero_poliza, patente,
                             sucursal_texto, cuota, cuota_monto, dia_vencimiento, dia_vencimiento_numero, aviso, pago, pago_fecha, observaciones,
                             forma_pago, creado_en, actualizado_en)
     SELECT 'COPIA0000001', periodo, pestana, poliza_id, cliente_id, cliente_nombre, documento, compania, numero_poliza, patente,
            sucursal_texto, cuota, cuota_monto, dia_vencimiento, dia_vencimiento_numero, aviso, pago, pago_fecha, observaciones,
            forma_pago, ?, ? FROM cuotas_mes WHERE fila_id = ?`,
  ).run(ahora, ahora, lopez.filaId)
  const copiaId = unico<number>(db, `SELECT id FROM cuotas_mes WHERE fila_id = 'COPIA0000001'`)

  const informe = detectarDuplicados()
  const grupo = informe.cuotas.find((g) => g.cuotas.some((c) => c.cuotaId === copiaId))
  assert.ok(grupo, 'la copia figura entre las repetidas')
  assert.equal(grupo.cuotas.filter((c) => c.sugeridaParaQuedar).length, 1, 'una sola se sugiere dejar')
  assert.ok(informe.total >= 1)

  // Un renglón que NO está repetido no se puede sacar por acá, ni siquiera el superadministrador.
  const suarezId = unico<number>(db, `SELECT id FROM cuotas_mes WHERE periodo = '2026-08' AND cliente_nombre = '${CLIENTES.suarez.nombre}'`)
  assert.throws(() => sacarCuotaRepetida(suarezId, DANIEL), /ya no figura entre los repetidos/)
  assert.throws(() => vistaPreviaDeSacarCuota(suarezId), /ya no figura/)

  // La copia sí, y la saca un empleado: la papelera de cuotas es del SUPER_ADMIN, esto no es la papelera.
  const vista = vistaPreviaDeSacarCuota(copiaId)
  assert.ok(vista.titulo.includes(CLIENTES.lopez.nombre))
  const resultado = sacarCuotaRepetida(copiaId, FEDE)
  assert.equal(resultado.tipo, 'cuota')
  assert.equal(contar(db, 'cuotas_mes', `id = ${copiaId}`), 0)
  assert.equal(planillaDelMes('2026-08').filas.filter((f) => f.nombre === CLIENTES.lopez.nombre).length, 1)
  db.close()
})

test('la póliza en la planilla y en Bajas a la vez se lista, no se toca sola, y se resuelve para cualquiera de los dos lados', async () => {
  const { db } = await baseImportada()
  const lopez = planillaDelMes('2026-08').filas.find((f) => f.nombre === CLIENTES.lopez.nombre)!
  darDeBaja(lopez.filaId, { motivo: 'VENDIO', nota: '' }, DANIEL)
  // La baja quedó a medio camino: el renglón de la planilla volvió a aparecer vivo (lo que dejaba
  // una carrera de la sincronización, o un «Poner vigente» que no llegó a sacar la baja).
  db.prepare(`UPDATE cuotas_mes SET dada_de_baja = 0 WHERE fila_id = ?`).run(lopez.filaId)

  const antes = detectarDuplicados()
  const fila = antes.enLosDosLados.find((f) => f.cuota.filaId === lopez.filaId)
  assert.ok(fila, 'figura en los dos lados')
  repararClientesDuplicados()
  assert.ok(detectarDuplicados().enLosDosLados.some((f) => f.cuota.filaId === lopez.filaId), 'ninguna reparación automática la toca')

  // Decisión: la póliza sigue → se saca la baja (un empleado puede).
  const resultado = sacarBajaRepetida(fila.baja.bajaId, FEDE)
  assert.equal(resultado.tipo, 'baja')
  assert.equal(contar(db, 'bajas', `id = ${fila.baja.bajaId}`), 0)
  assert.equal(detectarDuplicados().enLosDosLados.length, 0)
  assert.throws(() => sacarBajaRepetida(fila.baja.bajaId, FEDE), /ya no figura/)
  db.close()
})
