// Arreglo puntual: pólizas sin número que quedaron huérfanas (BAJA sin motivo) por una renovación sin
// período abierto cuyo número real nunca se llegó a enganchar. Ver la nota grande en
// src/main/servicios/reparaciones.ts sobre por qué esto es una acción de administrador y no una
// migración automática.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { listarPolizas, verPoliza } from '../src/main/servicios/polizas'
import { detectarRenovacionesHuerfanas, repararRenovacionesHuerfanas } from '../src/main/servicios/reparaciones'
import { datosSugeridosDeRenovacion, renovar } from '../src/main/servicios/renovaciones'
import type { FiltrosPolizas, SesionUsuario } from '../src/shared/tipos'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

const SIN_FILTROS: FiltrosPolizas = { busqueda: '', estados: [], companias: [], sucursales: [], coberturas: [], ramas: [] }

const ENC_MINIMA = ['NOMBRE', 'DNI', 'CIA', 'N POLIZA', 'PATENTE', 'MARCA', 'MODELO', 'VIGENCIA DESDE', 'VIGENCIA HASTA', 'CUOTA', 'FORMA DE PAGO', 'COBERTURA']

interface FilaMinima {
  nombre: string
  dni: string
  cia: string
  numero: string
  patente: string
  marca?: string
  modelo?: string
}

function filaMinima(f: FilaMinima): string[] {
  return [f.nombre, f.dni, f.cia, f.numero, f.patente, f.marca ?? 'FORD', f.modelo ?? 'FIESTA', '', '', '$ 20.000', 'DEBITO', 'TERCEROS COMPLETO']
}

async function importarUnica(db: BaseDeDatos, hoja: HojaSimulada): Promise<void> {
  const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
  await ejecutarImportacion({ db, fuente: hoja, importacionId: id, anioActual: 2026 })
}

async function escenarioMinimo(titulo: string, filasIniciales: FilaMinima[]): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importarUnica(db, new HojaSimulada([{ titulo, valores: [ENC_MINIMA, ...filasIniciales.map(filaMinima)] }]))
  return db
}

function polizaDe(numero: string) {
  const encontrada = listarPolizas({ ...SIN_FILTROS, busqueda: numero }).filas[0]
  if (!encontrada) throw new Error(`No está la póliza ${numero}`)
  return encontrada
}

/**
 * Reproduce el estado que deja el bug: renueva SIN número y sin período abierto (la póliza nueva queda
 * sin `fila_id`), y después simula el barrido de `inactivarPolizas` que la pasa a `activa = 0` sin
 * ninguna baja anotada —el paso que en la vida real hace una importación más adelante, no relevante
 * acá— para dejar exactamente la BAJA sin motivo del bug. Devuelve el id de esa huérfana.
 */
function crearHuerfana(db: BaseDeDatos, numeroViejo: string, vigenciaDesde: string, vigenciaHasta: string): number {
  const original = polizaDe(numeroViejo)
  db.prepare('UPDATE cuotas_mes SET dada_de_baja = 1').run() // sin período abierto
  const sugerido = datosSugeridosDeRenovacion(original.id)
  renovar(original.id, { ...sugerido, numero: '', vigenciaDesde, vigenciaHasta }, DANIEL)
  const huerfana = db.prepare('SELECT id FROM polizas WHERE poliza_anterior_id = ?').get(original.id) as { id: number }
  db.prepare('UPDATE polizas SET activa = 0 WHERE id = ?').run(huerfana.id)
  return huerfana.id
}

/** La póliza activa con número que, en una base sin el arreglo del importador, quedó totalmente aparte. */
function crearActivaSuelta(db: BaseDeDatos, dni: string, cia: string, patente: string, numero: string, desde: string, hasta: string): number {
  const cliente = db.prepare('SELECT id FROM clientes WHERE documento_normalizado = ?').get(dni) as { id: number }
  const vehiculo = db.prepare('SELECT id FROM vehiculos WHERE patente_normalizada = ?').get(patente) as { id: number }
  const ahora = ahoraIso()
  const { id } = db
    .prepare(
      `INSERT INTO polizas (clave, cliente_id, vehiculo_id, compania, numero, numero_normalizado, activa,
                             vigencia_desde_iso, vigencia_hasta_iso, periodo_origen, pestana_origen, creado_en, actualizado_en)
       VALUES (@clave, @cliente_id, @vehiculo_id, @compania, @numero, @numero, 1, @desde, @hasta, 'sin-periodo', '(prueba)', @ahora, @ahora)
       RETURNING id`,
    )
    .get({ clave: `POL:${cia}|${numero}`, cliente_id: cliente.id, vehiculo_id: vehiculo.id, compania: cia, numero, desde, hasta, ahora }) as { id: number }
  return id
}

test('detecta el par huérfano/activa: mismo cliente, mismo vehículo, misma compañía, vigencia superpuesta', async () => {
  const dni = '30222000'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'DETECTAR PAR SA', dni, cia: 'AGROSALTA', numero: '900100', patente: 'AB123CD' }])
  const huerfanaId = crearHuerfana(db, '900100', '22/8/2026', '22/12/2026')
  const activaId = crearActivaSuelta(db, dni, 'AGROSALTA', 'AB123CD', '900100-R', '2026-08-22', '2026-12-22')

  const pares = detectarRenovacionesHuerfanas()
  assert.equal(pares.length, 1)
  assert.equal(pares[0]!.huerfanaId, huerfanaId)
  assert.equal(pares[0]!.activaId, activaId)
  assert.equal(pares[0]!.numeroActiva, '900100-R')

  // Sólo lectura: no cambió nada en la base.
  assert.equal(verPoliza(huerfanaId).estado, 'BAJA', 'detectar no aplica nada')
})

test('reparar liga la activa a la huérfana por poliza_anterior_id, y la pantalla la muestra RENOVADA', async () => {
  const dni = '30222001'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'REPARAR PAR SA', dni, cia: 'ZURICH', numero: '900200', patente: 'AC456EF' }])
  const huerfanaId = crearHuerfana(db, '900200', '1/1/2026', '1/1/2027')
  const activaId = crearActivaSuelta(db, dni, 'ZURICH', 'AC456EF', '900200-R', '2026-01-01', '2027-01-01')

  assert.equal(verPoliza(huerfanaId).estado, 'BAJA', 'antes de reparar: BAJA sin motivo, el bug')

  const ligadas = repararRenovacionesHuerfanas()
  assert.equal(ligadas, 1)

  assert.equal(verPoliza(huerfanaId).estado, 'RENOVADA', 'después de reparar: RENOVADA, como una renovación de verdad')
  const activaDespues = db.prepare('SELECT poliza_anterior_id FROM polizas WHERE id = ?').get(activaId) as { poliza_anterior_id: number | null }
  assert.equal(activaDespues.poliza_anterior_id, huerfanaId)

  // Idempotente: correrla de nuevo no cambia nada más (ya no hay pares: la huérfana ahora tiene sucesora).
  assert.equal(repararRenovacionesHuerfanas(), 0)
  assert.equal(detectarRenovacionesHuerfanas().length, 0)
})

test('reparar no toca nada cuando no hay pares (base sana)', async () => {
  await escenarioMinimo('ENERO', [{ nombre: 'BASE SANA SA', dni: '30222002', cia: 'SANCOR', numero: '900300', patente: 'AD789GH' }])
  assert.equal(detectarRenovacionesHuerfanas().length, 0)
  assert.equal(repararRenovacionesHuerfanas(), 0)
})

test('con dos activas candidatas para la misma huérfana (ambiguo), no se detecta ningún par', async () => {
  const dni = '30222003'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'AMBIGUO SA', dni, cia: 'SANCOR', numero: '900400', patente: 'AE111JK' }])
  const huerfanaId = crearHuerfana(db, '900400', '1/1/2026', '1/1/2027')
  crearActivaSuelta(db, dni, 'SANCOR', 'AE111JK', '900400-A', '2026-01-01', '2027-01-01')
  crearActivaSuelta(db, dni, 'SANCOR', 'AE111JK', '900400-B', '2026-01-01', '2027-01-01')

  assert.equal(detectarRenovacionesHuerfanas().length, 0, 'dos activas candidatas: ambiguo, no se adivina ninguna')
  assert.equal(repararRenovacionesHuerfanas(), 0)
  assert.equal(verPoliza(huerfanaId).estado, 'BAJA', 'sigue como estaba: nadie la tocó')
})

test('con dos huérfanas candidatas para la misma activa (ambiguo), no se detecta ningún par', async () => {
  const dni = '30222005'
  const db = await escenarioMinimo('ENERO', [
    { nombre: 'AMBIGUO DOS SA', dni, cia: 'SANCOR', numero: '900600', patente: 'AG333NO' },
    { nombre: 'AMBIGUO DOS SA', dni, cia: 'SANCOR', numero: '900700', patente: 'AG333NO' },
  ])
  crearHuerfana(db, '900600', '1/1/2026', '1/1/2027')
  crearHuerfana(db, '900700', '1/1/2026', '1/1/2027')
  crearActivaSuelta(db, dni, 'SANCOR', 'AG333NO', '900600-R', '2026-01-01', '2027-01-01')

  assert.equal(detectarRenovacionesHuerfanas().length, 0, 'dos huérfanas candidatas: ambiguo, no se adivina ninguna')
})

test('distinta compañía: no se detecta el par', async () => {
  const dni = '30222006'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'OTRA CIA SA', dni, cia: 'SANCOR', numero: '900800', patente: 'AH444PQ' }])
  crearHuerfana(db, '900800', '1/1/2026', '1/1/2027')
  crearActivaSuelta(db, dni, 'ZURICH', 'AH444PQ', '900800-R', '2026-01-01', '2027-01-01')

  assert.equal(detectarRenovacionesHuerfanas().length, 0, 'otra compañía: no puede ser la misma póliza')
})

test('sin vigencias superpuestas, no se detecta el par', async () => {
  const dni = '30222004'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'SIN SOLAPAR SA', dni, cia: 'SANCOR', numero: '900500', patente: 'AF222LM' }])
  // La huérfana vence en 2025: es una renovación vieja que no tiene nada que ver con la activa de 2026.
  crearHuerfana(db, '900500', '1/1/2025', '1/6/2025')
  crearActivaSuelta(db, dni, 'SANCOR', 'AF222LM', '900500-R', '2026-01-01', '2027-01-01')

  assert.equal(detectarRenovacionesHuerfanas().length, 0, 'vigencias que no se tocan: no hay forma conservadora de emparejarlas')
})
