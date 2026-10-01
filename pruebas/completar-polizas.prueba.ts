// La reparación de las pólizas que quedaron sin cobertura ni vigencias (15.10.4): se completan con lo
// que esta computadora ya sabe —el historial, la cola sin subir, los meses anteriores— y la planilla
// del mes recibe lo que le falta. Es lo que corre al arrancar después del cierre de mes de la 15.10.2.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { planillaDelMes } from '../src/main/servicios/cartera'
import { completarPolizasSinCoberturaNiVigencias } from '../src/main/servicios/completarPolizas'
import { registrarCambio } from '../src/main/servicios/historial'
import { editarPoliza, listarPolizas, verPoliza } from '../src/main/servicios/polizas'
import { bandejaDeRenovaciones } from '../src/main/servicios/renovaciones'
import { aDia, desdeDia } from '../src/shared/polizas'
import { hoyLocal } from '../src/shared/semaforo'
import type { DatosDePoliza, FiltrosPolizas, PolizaDeCliente, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'

const DANIEL: SesionUsuario = { id: 1, nombre: 'Daniel Martínez', usuario: 'daniel', rol: 'SUPER_ADMIN', sucursal: { id: 1, nombre: 'Daniel' }, debeCambiarClave: false }
const SIN_FILTROS: FiltrosPolizas = { busqueda: '', estados: [], companias: [], sucursales: [], coberturas: [], ramas: [] }

let base: BaseDeDatos | null = null

/** La cartera importada, SIN motor de sincronización: lo que se encola queda en la cola, a la vista. */
async function escenario(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
  await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  base = db
  return db
}

function enDias(dias: number): string {
  const iso = desdeDia((aDia(hoyLocal()) ?? 0) + dias)
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function polizaDe(numero: string): PolizaDeCliente {
  const encontrada = listarPolizas({ ...SIN_FILTROS, busqueda: numero }).filas.find((f) => f.numero === numero)
  if (!encontrada) throw new Error(`No está la póliza ${numero}`)
  return encontrada
}

function cambiar(poliza: PolizaDeCliente, cambios: Partial<DatosDePoliza>): PolizaDeCliente {
  const datos: DatosDePoliza = {
    clienteId: poliza.clienteId,
    vehiculoId: poliza.vehiculoId,
    vehiculoNuevo: null,
    compania: poliza.compania ?? '',
    cobertura: poliza.cobertura ?? '',
    formaPago: poliza.formaPago ?? '',
    cuota: poliza.cuota ?? '',
    diaVencimiento: poliza.diaVencimiento ?? '',
    numero: poliza.numero ?? '',
    propuesta: poliza.propuesta ?? '',
    vigenciaDesde: poliza.vigenciaDesde ?? '',
    vigenciaHasta: poliza.vigenciaHasta ?? '',
    avisarVto: poliza.avisarVto ?? '',
    observaciones: poliza.observaciones ?? '',
    confirmadoPeseAlAviso: true,
    ...cambios,
  }
  return editarPoliza(poliza.id, datos, DANIEL)
}

/** Lo que dejaba la importación de la 15.10.2 después del cierre de mes: la póliza en blanco. */
function borrarComoLaImportacionVieja(polizaId: number): void {
  base!
    .prepare(
      `UPDATE polizas SET cobertura = NULL, vigencia_desde = NULL, vigencia_hasta = NULL,
              vigencia_desde_iso = NULL, vigencia_hasta_iso = NULL WHERE id = ?`,
    )
    .run(polizaId)
}

/** Deja en blanco esas celdas en la copia local de la fila del mes, como la planilla nueva del cierre. */
function vaciarEnLaFilaDelMes(filaId: string, encabezados: string[]): void {
  const fila = base!.prepare('SELECT datos_json FROM filas_crudas WHERE fila_id = ?').get(filaId) as { datos_json: string }
  const datos = JSON.parse(fila.datos_json) as Record<string, string>
  for (const encabezado of encabezados) datos[encabezado] = ''
  base!.prepare('UPDATE filas_crudas SET datos_json = ? WHERE fila_id = ?').run(JSON.stringify(datos), filaId)
}

function camposEnCola(filaId: string): Record<string, string> {
  const entradas = base!
    .prepare(`SELECT campos_json FROM cola_sync WHERE estado = 'pendiente' AND fila_id = ? ORDER BY id`)
    .all(filaId) as Array<{ campos_json: string }>
  return Object.assign({}, ...entradas.map((e) => JSON.parse(e.campos_json) as Record<string, string>))
}

test('lo que se editó en la aplicación vuelve del historial, con su fecha interpretada y en la bandeja', async () => {
  await escenario()
  const antes = polizaDe(CLIENTES.suarez.poliza)
  const desde = enDias(-325)
  const hasta = enDias(40)
  cambiar(antes, { cobertura: 'TODO RIESGO', vigenciaDesde: desde, vigenciaHasta: hasta })

  borrarComoLaImportacionVieja(antes.id)
  assert.equal(verPoliza(antes.id).cobertura, null, 'arranca en blanco, como quedó después del cierre')

  const resultado = completarPolizasSinCoberturaNiVigencias()
  assert.ok(resultado.completadas >= 1)
  const despues = verPoliza(antes.id)
  assert.equal(despues.cobertura, 'TODO RIESGO')
  assert.equal(despues.vigenciaDesde, desde)
  assert.equal(despues.vigenciaHasta, hasta)
  assert.equal(despues.vigenciaHastaIso, desdeDia((aDia(hoyLocal()) ?? 0) + 40), 'la fecha se interpreta como la escribió la ficha')
  assert.ok(
    bandejaDeRenovaciones().semanas.flatMap((s) => s.filas).some((f) => f.numero === CLIENTES.suarez.poliza),
    'y la bandeja de renovaciones la vuelve a ver',
  )
  const historial = base!
    .prepare(`SELECT usuario_nombre, campo, valor_nuevo FROM historial WHERE tabla = 'polizas' AND registro_id = ? ORDER BY id DESC LIMIT 3`)
    .all(antes.id) as Array<{ usuario_nombre: string; campo: string; valor_nuevo: string }>
  assert.ok(historial.every((h) => h.usuario_nombre === 'Reparación automática'), 'queda anotado quién lo completó')
  assert.deepEqual(historial.map((h) => h.campo).sort(), ['COBERTURA', 'DESDE', 'HASTA'])

  // Correr de nuevo no hace nada: ya está todo.
  assert.deepEqual(completarPolizasSinCoberturaNiVigencias(), { completadas: 0, encoladas: 0 })
  cerrarBaseDeDatos()
})

test('lo que la planilla del mes trae en blanco vuelve del mes anterior y se le manda a la planilla', async () => {
  await escenario()
  const poliza = polizaDe(CLIENTES.gonzalez.poliza)
  assert.equal(poliza.cobertura, 'TERCEROS COMPLETO', 'AGOSTO la trae con cobertura')
  const filaDelMes = planillaDelMes(null).filas.find((f) => f.nombre === CLIENTES.gonzalez.nombre)!

  // Es lo que dejaba el cierre de mes: la fila nueva sin esas celdas y, tras importar, la póliza en blanco.
  vaciarEnLaFilaDelMes(filaDelMes.filaId, ['COBERTURA', 'VIGENCIA DESDE', 'VIGENCIA HASTA'])
  borrarComoLaImportacionVieja(poliza.id)

  const resultado = completarPolizasSinCoberturaNiVigencias()
  assert.ok(resultado.completadas >= 1)
  assert.ok(resultado.encoladas >= 1)
  const despues = verPoliza(poliza.id)
  assert.equal(despues.cobertura, 'TERCEROS COMPLETO', 'la cobertura la tenía JULIO')
  assert.equal(despues.vigenciaDesde, '01/01/2026', 'las vigencias, la última planilla que las tiene (ENERO)')
  assert.equal(despues.vigenciaHasta, '01/07/2026')
  assert.equal(despues.vigenciaDesdeIso, '2026-01-01')

  const enCola = camposEnCola(filaDelMes.filaId)
  assert.equal(enCola.cobertura, 'TERCEROS COMPLETO', 'la fila del mes recibe la cobertura')
  assert.equal(enCola.vigencia_desde, '01/01/2026')
  assert.equal(enCola.vigencia_hasta, '01/07/2026')

  // Con lo mismo ya en la cola no se encola de nuevo.
  assert.deepEqual(completarPolizasSinCoberturaNiVigencias(), { completadas: 0, encoladas: 0 })
  cerrarBaseDeDatos()
})

test('una cobertura borrada a propósito desde la ficha se respeta: no se vuelve a llenar con un mes viejo', async () => {
  await escenario()
  const poliza = polizaDe(CLIENTES.gonzalez.poliza)
  // Lo que deja `editarPoliza` cuando alguien borra la cobertura (una moto, un hogar).
  registrarCambio(DANIEL, { accion: 'edicion', tabla: 'polizas', registroId: poliza.id, filaId: poliza.filaId, campo: 'COBERTURA', valorAnterior: 'TERCEROS COMPLETO', valorNuevo: null })
  base!.prepare('UPDATE polizas SET cobertura = NULL WHERE id = ?').run(poliza.id)

  completarPolizasSinCoberturaNiVigencias()
  assert.equal(verPoliza(poliza.id).cobertura, null, 'sigue en blanco aunque JULIO diga TERCEROS COMPLETO')
  cerrarBaseDeDatos()
})

test('lo que espera en la cola sin subir también cuenta, aunque el historial no lo tenga', async () => {
  await escenario()
  const poliza = polizaDe(CLIENTES.lopez.poliza)
  const filaDelMes = planillaDelMes(null).filas.find((f) => f.nombre === CLIENTES.lopez.nombre)!
  base!
    .prepare(`INSERT INTO cola_sync (creado_en, operacion, pestana, fila_id, campos_json) VALUES (?, 'actualizar', 'AGOSTO', ?, ?)`)
    .run(ahoraIso(), filaDelMes.filaId, JSON.stringify({ cobertura: 'RC', vigencia_hasta: enDias(20) }))
  borrarComoLaImportacionVieja(poliza.id)

  completarPolizasSinCoberturaNiVigencias()
  const despues = verPoliza(poliza.id)
  assert.equal(despues.cobertura, 'RC', 'la cobertura que todavía no viajó')
  assert.equal(despues.vigenciaHasta, enDias(20))
  assert.equal(despues.vigenciaDesde, '01/07/2026', 'y lo que la cola no tiene sale de la planilla más nueva que lo tenga (AGOSTO)')
  cerrarBaseDeDatos()
})
