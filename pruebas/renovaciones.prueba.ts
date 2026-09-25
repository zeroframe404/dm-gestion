// La bandeja de renovaciones de punta a punta: qué entra en los próximos 60 días, cómo se agrupa por
// semana, la etiqueta de «aumentar al renovar», y que renovar deje la vigencia nueva, la anterior como
// histórica y el cambio camino a la hoja de Google.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { bajasDelMes, planillaDelMes } from '../src/main/servicios/cartera'
import { editarCompania, listarCompanias } from '../src/main/servicios/companias'
import { editarPoliza, listarPolizas, verPoliza } from '../src/main/servicios/polizas'
import {
  actualizarSeguimiento,
  bandejaDeRenovaciones,
  datosSugeridosDeRenovacion,
  noRenueva,
  renovar,
} from '../src/main/servicios/renovaciones'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { aDia, comoTextoDeFecha, desdeDia, DIAS_DE_RENOVACION, mesesDespues, unAnioDespues } from '../src/shared/polizas'
import { hoyLocal } from '../src/shared/semaforo'
import type { DatosDePoliza, FiltrosPolizas, PolizaDeCliente, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
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

let motorAnterior: MotorDeSincronizacion | null = null

interface Escenario {
  db: BaseDeDatos
  hoja: HojaSimulada
  motor: MotorDeSincronizacion
}

async function escenario(): Promise<Escenario> {
  motorAnterior?.apagar()
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  const hoja = new HojaSimulada(construirHojaDePrueba())
  const importar = async () => {
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  }
  await importar()

  // El motor tiene que quedar encendido: `ciclarSubida()` no hace nada con la sincronización apagada.
  const motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar })
  motor.encender()
  motorAnterior = motor
  return { db, hoja, motor }
}

/** Una fecha a N días de hoy, en las dos formas: la ISO y la que se escribe en la hoja. */
function enDias(dias: number): { iso: string; texto: string } {
  const iso = desdeDia((aDia(hoyLocal()) ?? 0) + dias)
  const [anio, mes, dia] = iso.split('-')
  return { iso, texto: `${dia}/${mes}/${anio}` }
}

function polizaDe(numero: string): PolizaDeCliente {
  const encontrada = listarPolizas({ ...SIN_FILTROS, busqueda: numero }).filas[0]
  if (!encontrada) throw new Error(`No está la póliza ${numero}`)
  return encontrada
}

/** Reescribe una póliza cambiando sólo lo que se le pase. */
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

/** Todas las filas de la bandeja, sin importar en qué semana cayeron. */
function filasDeLaBandeja() {
  return bandejaDeRenovaciones().semanas.flatMap((s) => s.filas)
}

// ---------------------------------------------------------------------------
// Qué entra en la bandeja: el criterio de aceptación N°3 del pliego
// ---------------------------------------------------------------------------

test('la bandeja muestra las pólizas que vencen en los próximos 60 días, y sólo ésas', async () => {
  await escenario()
  // La hoja simulada vence toda el 01/01/2027, así que la bandeja arranca vacía: se le acercan
  // tres vencimientos a mano, uno adentro de la ventana, uno justo afuera y uno el mes que viene.
  const enDosSemanas = enDias(14)
  const enUnMes = enDias(35)
  const muyLejos = enDias(DIAS_DE_RENOVACION + 30)

  cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDosSemanas.texto })
  cambiar(polizaDe(CLIENTES.lopez.poliza), { vigenciaHasta: enUnMes.texto })
  cambiar(polizaDe(CLIENTES.suarez.poliza), { vigenciaHasta: muyLejos.texto })

  const bandeja = bandejaDeRenovaciones()
  const numeros = filasDeLaBandeja().map((f) => f.numero)

  assert.ok(numeros.includes(CLIENTES.gonzalez.poliza), 'la que vence en dos semanas tiene que estar')
  assert.ok(numeros.includes(CLIENTES.lopez.poliza), 'la que vence en un mes también')
  assert.ok(!numeros.includes(CLIENTES.suarez.poliza), 'la que vence pasados los 60 días no')
  assert.equal(bandeja.total, filasDeLaBandeja().length)
  assert.equal(bandeja.hoy, hoyLocal())
  assert.ok(bandeja.responsables.length > 0, 'los responsables alimentan el desplegable')
})

test('las pólizas se agrupan por semana, de la más cercana a la más lejana', async () => {
  await escenario()
  const enUnaSemana = enDias(5)
  const enSeisSemanas = enDias(42)
  cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enUnaSemana.texto })
  cambiar(polizaDe(CLIENTES.lopez.poliza), { vigenciaHasta: enSeisSemanas.texto })

  const semanas = bandejaDeRenovaciones().semanas
  assert.ok(semanas.length >= 2, 'dos vencimientos lejanos entre sí caen en semanas distintas')
  assert.ok(semanas.every((s) => s.titulo.length > 0), 'cada semana viene con su título armado')

  // Ordenadas de la más cercana a la más lejana, que es como se trabaja.
  const desde = semanas.map((s) => s.desde)
  assert.deepEqual(desde, [...desde].sort())

  // Dentro de cada semana, por fecha de vencimiento.
  for (const semana of semanas) {
    const vencimientos = semana.filas.map((f) => f.venceEl)
    assert.deepEqual(vencimientos, [...vencimientos].sort())
  }
})

test('cada fila trae lo que hace falta para gestionarla, y arranca pendiente y sin responsable', async () => {
  await escenario()
  cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(10).texto })

  const fila = filasDeLaBandeja().find((f) => f.numero === CLIENTES.gonzalez.poliza)
  assert.ok(fila)
  assert.equal(fila.estado, 'pendiente', 'abrir la bandeja no crea seguimiento: arranca en pendiente')
  assert.equal(fila.responsableId, null)
  assert.ok(fila.clienteNombre?.includes('GONZALEZ'))
  assert.equal(fila.compania, CLIENTES.gonzalez.cia)
  assert.ok(fila.cuota, 'la cuota, que es lo primero que se mira al renovar')
  assert.ok(fila.diasParaVencer >= 9 && fila.diasParaVencer <= 11, `días para vencer raros: ${fila.diasParaVencer}`)
})

test('«20% aumentar cuando se renueva» en las observaciones se muestra destacado', async () => {
  await escenario()
  cambiar(polizaDe(CLIENTES.gonzalez.poliza), {
    vigenciaHasta: enDias(12).texto,
    observaciones: '20% aumentar cuando se renueva',
  })
  cambiar(polizaDe(CLIENTES.lopez.poliza), { vigenciaHasta: enDias(12).texto, observaciones: 'Llamar por la mañana' })

  const filas = filasDeLaBandeja()
  const conAumento = filas.find((f) => f.numero === CLIENTES.gonzalez.poliza)
  const sinAumento = filas.find((f) => f.numero === CLIENTES.lopez.poliza)

  assert.equal(conAumento?.aumentaAlRenovar, true)
  assert.equal(sinAumento?.aumentaAlRenovar, false, 'una observación cualquiera no enciende la etiqueta')
})

test('el responsable, el estado del trámite y la nota se guardan', async () => {
  await escenario()
  cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(20).texto })
  const fila = filasDeLaBandeja().find((f) => f.numero === CLIENTES.gonzalez.poliza)!

  actualizarSeguimiento(
    fila.polizaId,
    fila.venceEl,
    { estado: 'en gestion', responsableId: DANIEL.id, nota: 'Pidió cotización de todo riesgo' },
    DANIEL,
  )

  const despues = filasDeLaBandeja().find((f) => f.numero === CLIENTES.gonzalez.poliza)!
  assert.equal(despues.estado, 'en gestion')
  assert.equal(despues.responsableId, DANIEL.id)
  assert.equal(despues.responsableNombre, DANIEL.nombre)
  assert.equal(despues.nota, 'Pidió cotización de todo riesgo')
})

// ---------------------------------------------------------------------------
// Renovar: el criterio de aceptación N°4 del pliego
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Qué se renueva a mano: Agrosalta cada 4 meses, Río Uruguay cada 6, Metropol cada 12
// ---------------------------------------------------------------------------

test('sólo las compañías que se renuevan a mano quedan marcadas, y con su plazo', async () => {
  await escenario()
  cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(10).texto })
  cambiar(polizaDe(CLIENTES.lopez.poliza), { vigenciaHasta: enDias(10).texto, compania: 'AGROSALTA' })
  cambiar(polizaDe(CLIENTES.martinez.poliza), { vigenciaHasta: enDias(10).texto, compania: 'RIO URUGUAY' })

  const filas = filasDeLaBandeja()
  const sancor = filas.find((f) => f.numero === CLIENTES.gonzalez.poliza)
  const agrosalta = filas.find((f) => f.numero === CLIENTES.lopez.poliza)
  const rus = filas.find((f) => f.numero === CLIENTES.martinez.poliza)

  assert.equal(sancor?.renovacionManual, false, 'SANCOR renueva sola')
  assert.equal(sancor?.mesesDeRenovacion, null)
  assert.equal(agrosalta?.renovacionManual, true)
  assert.equal(agrosalta?.mesesDeRenovacion, 4, 'Agrosalta se renueva cada cuatro meses')
  assert.equal(rus?.renovacionManual, true)
  assert.equal(rus?.mesesDeRenovacion, 6, 'Río Uruguay, cada seis')
})

test('la vigencia nueva dura lo que renueva la compañía, no siempre un año', async () => {
  await escenario()
  const vence = enDias(15)
  const poliza = cambiar(polizaDe(CLIENTES.lopez.poliza), { vigenciaHasta: vence.texto, compania: 'AGROSALTA' })

  const sugerido = datosSugeridosDeRenovacion(poliza.id)
  assert.equal(sugerido.vigenciaDesde, vence.iso)
  assert.equal(sugerido.vigenciaHasta, mesesDespues(vence.iso, 4), 'Agrosalta renueva cada cuatro meses')

  renovar(poliza.id, { ...sugerido, numero: `${CLIENTES.lopez.poliza}-R` }, DANIEL)
  const renovada = polizaDe(`${CLIENTES.lopez.poliza}-R`)
  assert.equal(renovada.vigenciaHasta, comoTextoDeFecha(mesesDespues(vence.iso, 4)), 'la vigencia guardada también')
})

test('sin plazo cargado en la compañía, el plazo lo dice la vigencia que está terminando', async () => {
  await escenario()
  // SANCOR no tiene plazo cargado (renueva sola), pero esta póliza va de seis en seis meses: se
  // propone lo mismo que duraba, que es lo que dice la fin de vigencia.
  const vence = enDias(15)
  const poliza = cambiar(polizaDe(CLIENTES.gonzalez.poliza), {
    vigenciaDesde: comoTextoDeFecha(mesesDespues(vence.iso, -6)),
    vigenciaHasta: vence.texto,
  })

  assert.equal(datosSugeridosDeRenovacion(poliza.id).vigenciaHasta, mesesDespues(vence.iso, 6))
})

test('una compañía se puede pasar a renovación manual (o sacar) desde Compañías', async () => {
  await escenario()
  cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(10).texto })
  const sancor = listarCompanias().find((c) => c.nombre === CLIENTES.gonzalez.cia)
  assert.ok(sancor)
  assert.equal(sancor.mesesRenovacion, null, 'arranca renovando sola')

  editarCompania(sancor.id, {
    nombre: sancor.nombre,
    diasCoberturaFinanciera: sancor.diasCoberturaFinanciera,
    comisionPorcentaje: sancor.comisionPorcentaje ?? 0,
    mesesRenovacion: 6,
    activa: true,
  })
  const fila = filasDeLaBandeja().find((f) => f.numero === CLIENTES.gonzalez.poliza)
  assert.equal(fila?.renovacionManual, true)
  assert.equal(fila?.mesesDeRenovacion, 6)

  assert.throws(
    () =>
      editarCompania(sancor.id, {
        nombre: sancor.nombre,
        diasCoberturaFinanciera: sancor.diasCoberturaFinanciera,
        comisionPorcentaje: sancor.comisionPorcentaje ?? 0,
        mesesRenovacion: 0,
        activa: true,
      }),
    /entre 1 y 60/,
  )
})

test('la renovación propone un año más y la cuota anterior, y se puede editar', async () => {
  await escenario()
  const vence = enDias(15)
  // La vigencia que empieza también se fija (no sólo la que termina): SANCOR no tiene meses de
  // renovación cargados, así que sin esto el plazo se deduce de la vigencia vieja, y con la fecha del
  // fixture (fija) más la fecha de hoy (real) el resultado puede caer justo en uno de los plazos
  // habituales (3, 4, 6 ó 12 meses) sin querer. Con un «desde» a 200 días, la vigencia siempre da un
  // plazo raro y la sugerencia cae en el año de siempre, que es lo que prueba este test.
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), {
    vigenciaDesde: enDias(-200).texto,
    vigenciaHasta: vence.texto,
  })

  // El diálogo trabaja con fechas 'AAAA-MM-DD' (es lo que entrega un selector de fecha); al guardar,
  // el servicio las vuelve a escribir como día/mes/año, que es el formato de la columna en la hoja.
  const sugerido = datosSugeridosDeRenovacion(original.id)
  assert.equal(sugerido.vigenciaDesde, vence.iso, 'la nueva arranca donde termina la vieja')
  assert.equal(sugerido.vigenciaHasta, unAnioDespues(vence.iso), 'y termina un año después')
  assert.equal(sugerido.cuota, original.cuota, 'con la cuota que venía pagando')
  assert.equal(sugerido.numero, original.numero)
})

test('renovar crea la vigencia nueva y deja la anterior como histórica', async () => {
  await escenario()
  const vence = enDias(15)
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: vence.texto })
  const sugerido = datosSugeridosDeRenovacion(original.id)

  renovar(original.id, { ...sugerido, cuota: '$ 22.200', numero: '1234567-R' }, DANIEL)

  // La anterior deja de estar activa, pero no se borra ni se inventa una baja: se renovó, no se dio de
  // baja. Y se LEE como renovada, que es lo que la separa de una anulación en el listado y en la ficha.
  const vieja = verPoliza(original.id)
  assert.equal(vieja.estado, 'RENOVADA', 'la anterior queda como renovada, no como una baja sin motivo')
  assert.equal(vieja.motivoBaja, null, 'renovar no es dar de baja: no se le pone motivo')

  // La nueva existe, está activa y quedó enganchada a la anterior.
  const nueva = polizaDe('1234567-R')
  assert.equal(nueva.estado, 'ACTIVA')
  assert.equal(nueva.cuota, '$ 22.200')
  assert.equal(nueva.clienteId, original.clienteId)
  assert.equal(nueva.vehiculoId, original.vehiculoId)
  assert.equal(nueva.compania, original.compania)
  // Guardada, la vigencia vuelve al formato de la hoja: '2026-09-05' se escribe '5/9/2026'.
  assert.equal(nueva.vigenciaDesde, comoTextoDeFecha(sugerido.vigenciaDesde))
  assert.equal(nueva.vigenciaHastaIso, sugerido.vigenciaHasta, 'y la fecha de verdad queda para la próxima renovación')

  // El seguimiento de la anterior queda marcado como renovada y sale de lo pendiente.
  const pendientes = filasDeLaBandeja().filter((f) => f.polizaId === original.id && f.estado !== 'renovada')
  assert.equal(pendientes.length, 0, 'la renovada no sigue figurando como pendiente')
})

// ---------------------------------------------------------------------------
// Qué pasa con la póliza anterior: Renovadas, Bajas o Activas
// ---------------------------------------------------------------------------

test('sin elegir destino, la anterior queda en Renovadas: es lo que hacía la versión anterior', async () => {
  await escenario()
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(15).texto })
  const sugerido = datosSugeridosDeRenovacion(original.id)
  assert.equal(sugerido.destinoDeLaAnterior, 'renovada', 'el cartel abre con Renovadas elegida')

  // Se manda a propósito sin el campo, que es lo que haría una computadora sin actualizar.
  const { destinoDeLaAnterior: _sinUsar, ...comoLaVersionAnterior } = sugerido
  renovar(original.id, { ...comoLaVersionAnterior, numero: '1234567-R' }, DANIEL)

  const vieja = verPoliza(original.id)
  assert.equal(vieja.estado, 'RENOVADA')
  assert.equal(vieja.motivoBaja, null, 'no se le inventa una baja')
})

test('con destino Bajas la anterior sale de la cartera Y aparece en Cartera → Bajas', async () => {
  await escenario()
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(15).texto })
  const sugerido = datosSugeridosDeRenovacion(original.id)

  renovar(
    original.id,
    { ...sugerido, numero: '1234567-B', destinoDeLaAnterior: 'baja', motivoDeBaja: 'CAMBIO DE COMPANIA', notaDeBaja: 'La reemitieron' },
    DANIEL,
  )

  const vieja = verPoliza(original.id)
  assert.equal(vieja.estado, 'BAJA', 'la anterior queda dada de baja')
  assert.equal(vieja.motivoBaja, 'CAMBIO DE COMPANIA')

  const baja = bajasDelMes('').find((fila) => fila.polizaId === original.id)
  assert.ok(baja, 'y tiene su fila en Bajas, que es donde la agencia mira lo que se perdió')
  assert.equal(baja.motivo, 'CAMBIO DE COMPANIA')

  // Y la nueva nació igual, que es lo que separa esto de «No renueva».
  const nueva = polizaDe('1234567-B')
  assert.equal(nueva.estado, 'ACTIVA')
  assert.equal(nueva.clienteId, original.clienteId)

  // El trámite queda cerrado: la bandeja no la vuelve a pedir.
  const fila = filasDeLaBandeja().find((f) => f.polizaId === original.id)
  if (fila) assert.equal(fila.estado, 'no renueva')
})

test('con destino Activas quedan las dos vigentes, con sus dos filas del mes', async () => {
  await escenario()
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(15).texto })
  const sugerido = datosSugeridosDeRenovacion(original.id)
  const filasAntes = planillaDelMes(null).filas.filter((f) => f.polizaId === original.id).length

  renovar(original.id, { ...sugerido, numero: '1234567-A', destinoDeLaAnterior: 'activa' }, DANIEL)

  const vieja = verPoliza(original.id)
  assert.equal(vieja.estado, 'ACTIVA', 'la anterior sigue vigente: es lo que se pidió')
  assert.equal(vieja.motivoBaja, null)

  const nueva = polizaDe('1234567-A')
  assert.equal(nueva.estado, 'ACTIVA')

  // Las dos filas del mes: la vieja no se dio de baja, porque su póliza sigue cobrándose.
  const enElMes = planillaDelMes(null).filas
  assert.equal(enElMes.filter((f) => f.polizaId === original.id).length, filasAntes, 'la fila de la anterior sigue en la planilla')
  assert.equal(enElMes.filter((f) => f.polizaId === nueva.id).length, 1, 'y la nueva tiene la suya')

  // Aun vigente y vencida, no vuelve a la bandeja como pendiente: el seguimiento quedó cerrado.
  const pendientes = filasDeLaBandeja().filter((f) => f.polizaId === original.id && f.estado === 'pendiente')
  assert.equal(pendientes.length, 0, 'la bandeja no la vuelve a pedir todos los días')
})

test('un destino que no está en la lista se rechaza sin renovar nada', async () => {
  await escenario()
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(15).texto })
  const sugerido = datosSugeridosDeRenovacion(original.id)

  assert.throws(
    () => renovar(original.id, { ...sugerido, numero: '1234567-X', destinoDeLaAnterior: 'archivada' as never }, DANIEL),
    /Renovadas|Bajas|Activa/i,
  )
  assert.equal(verPoliza(original.id).estado, 'ACTIVA', 'no se tocó nada')
})

test('la renovación llega a la hoja de Google en el próximo ciclo', async () => {
  const { hoja, motor } = await escenario()
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(15).texto })
  const sugerido = datosSugeridosDeRenovacion(original.id)

  renovar(original.id, { ...sugerido, cuota: '$ 25.900', numero: '7654321' }, DANIEL)

  const filasAntes = hoja.filasDe('AGOSTO').length
  await motor.ciclarSubida()

  // La fila nueva se agregó a la planilla del mes con su número y su cuota.
  const filas = hoja.filasDe('AGOSTO')
  const encabezados = hoja.encabezadosDe('AGOSTO')
  const columnaPoliza = encabezados.findIndex((e) => e.trim() === 'NRO DE POLIZA')
  const columnaCuota = encabezados.findIndex((e) => e.trim() === 'CUOTA')
  const enLaHoja = filas.find((f) => (f[columnaPoliza] ?? '').trim() === '7654321')

  assert.ok(enLaHoja, `la póliza renovada tiene que estar en la hoja (había ${filasAntes} filas antes, ahora ${filas.length})`)
  assert.equal((enLaHoja[columnaCuota] ?? '').trim(), '$ 25.900')
  motor.apagar()
})

test('«No renueva» da de baja la póliza con su motivo', async () => {
  await escenario()
  const original = cambiar(polizaDe(CLIENTES.lopez.poliza), { vigenciaHasta: enDias(25).texto })

  noRenueva(original.id, { motivo: 'CAMBIO DE COMPANIA', nota: 'Se va a Federación' }, DANIEL)

  const despues = verPoliza(original.id)
  assert.equal(despues.estado, 'BAJA')
  assert.equal(despues.motivoBaja, 'CAMBIO DE COMPANIA')

  const fila = filasDeLaBandeja().find((f) => f.polizaId === original.id)
  if (fila) assert.equal(fila.estado, 'no renueva', 'si sigue en la bandeja, es con el trámite cerrado')
})

// ---------------------------------------------------------------------------
// Dos casos que encontró una revisión adversarial y las pruebas del camino feliz no miraban
// ---------------------------------------------------------------------------

test('renovar conservando el mismo número de póliza no choca contra la clave de la anterior', async () => {
  await escenario()
  // Es el caso NORMAL: la compañía renueva y el número sigue siendo el mismo. La clave interna de la
  // póliza se arma con compañía + número, así que la nueva pide exactamente la que ocupa la vieja; hay
  // que liberarla ANTES de insertar o revienta contra el índice único de `polizas.clave`.
  const original = cambiar(polizaDe(CLIENTES.gonzalez.poliza), { vigenciaHasta: enDias(15).texto })
  const sugerido = datosSugeridosDeRenovacion(original.id)

  renovar(original.id, { ...sugerido, numero: original.numero ?? '' }, DANIEL)

  const vieja = verPoliza(original.id)
  assert.equal(vieja.estado, 'RENOVADA', 'la anterior queda histórica')
  assert.equal(vieja.numero, original.numero, 'y conserva su número: lo que cambia es la clave interna')

  const activas = listarPolizas({ ...SIN_FILTROS, busqueda: original.numero ?? '', estados: ['ACTIVA'] }).filas
  assert.equal(activas.length, 1, 'queda una sola póliza activa con ese número')
  assert.notEqual(activas[0]!.id, original.id, 'y es la nueva, no la vieja')
})

test('la renovación se encola contra la pestaña REAL de la hoja, no contra el nombre del mes', async () => {
  // La agencia titula la pestaña de diciembre «DICIEMBRE25», no «DICIEMBRE». Si la renovación inventa
  // el nombre, el alta de la fila nueva queda fallida mientras el borrado de la vieja sí se ejecuta,
  // y la póliza desaparece de la hoja.
  motorAnterior?.apagar()
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  const hoja = new HojaSimulada(construirHojaDePrueba({ hastaMes: 0 }))
  const importar = async () => {
    const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db, fuente: hoja, importacionId: id })
  }
  await importar()
  const motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar })
  motor.encender()
  motorAnterior = motor

  assert.ok(hoja.titulos().includes('DICIEMBRE25'), 'la pestaña se llama DICIEMBRE25, no DICIEMBRE')
  const filasAntes = hoja.filasDe('DICIEMBRE25').length

  const original = polizaDe(CLIENTES.gonzalez.poliza)
  const sugerido = datosSugeridosDeRenovacion(original.id)
  renovar(original.id, { ...sugerido, numero: '1234567-B', cuota: '$ 30.000' }, DANIEL)
  await motor.ciclarSubida()

  const filas = hoja.filasDe('DICIEMBRE25')
  const encabezados = hoja.encabezadosDe('DICIEMBRE25')
  const columnaPoliza = encabezados.findIndex((e) => e.trim() === 'N° POLIZA')
  assert.ok(
    filas.some((f) => (f[columnaPoliza] ?? '').trim() === '1234567-B'),
    `la fila renovada tiene que estar en DICIEMBRE25 (había ${filasAntes} filas, ahora ${filas.length})`,
  )
  motor.apagar()
})

// ---------------------------------------------------------------------------
// Renovar sin número y sin período abierto: el número real, cuando llega, no puede duplicar la póliza
// ---------------------------------------------------------------------------
//
// Caso real: ABELLEIRA MARIANO FERNANDO quedó con una póliza ACTIVA de AGROSALTA (con número) y una
// BAJA sin número, misma compañía, mismo vehículo, misma vigencia, «sin motivo cargado». La causa:
// `renovar()` acepta un número vacío (algunas compañías lo avisan después) y, sin período abierto, la
// póliza nueva queda sin `fila_id` y con una clave provisoria (DOCPAT/NOMPAT). Cuando el número real
// aparece en una fila de la hoja, `guardarPoliza()` calcula OTRA clave (POL:cía|número) que nadie
// ocupa todavía: sin enganchar esa fila con la póliza sin número, el upsert inserta una póliza aparte y
// el barrido de `inactivarPolizas` deja la original como una BAJA huérfana.

/** Encabezados mínimos que el mapeador reconoce (nombre, documento, compañía, número, patente, vigencia). */
const ENC_MINIMA = ['NOMBRE', 'DNI', 'CIA', 'N POLIZA', 'PATENTE', 'MARCA', 'MODELO', 'VIGENCIA DESDE', 'VIGENCIA HASTA', 'CUOTA', 'FORMA DE PAGO', 'COBERTURA']

interface FilaMinima {
  nombre: string
  dni: string
  cia: string
  numero: string
  patente: string
  marca?: string
  modelo?: string
  desde?: string
  hasta?: string
}

function filaMinima(f: FilaMinima): string[] {
  return [f.nombre, f.dni, f.cia, f.numero, f.patente, f.marca ?? 'FORD', f.modelo ?? 'FIESTA', f.desde ?? '', f.hasta ?? '', '$ 20.000', 'DEBITO', 'TERCEROS COMPLETO']
}

/**
 * Espera a que el reloj pase al milisegundo siguiente. El importador marca con su `ahora` lo que toca y
 * el barrido de `inactivarPolizas` deja inactivo todo lo que tenga otra marca (`actualizado_en <> @ahora`):
 * si la acción manual de la prueba —`renovar`, que también escribe `ahoraIso()`— cae en el mismo
 * milisegundo en que arranca la importación, su póliza pasa por tocada y el barrido no la ve.
 */
async function pasarDeMilisegundo(): Promise<void> {
  const antes = ahoraIso()
  while (ahoraIso() === antes) await new Promise((listo) => setTimeout(listo, 1))
}

async function importarUnica(db: BaseDeDatos, hoja: HojaSimulada): Promise<void> {
  await pasarDeMilisegundo()
  const { id } = db.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
  await ejecutarImportacion({ db, fuente: hoja, importacionId: id, anioActual: 2026 })
}

/** Una base nueva con UNA sola pestaña mensual: así es, sin ambigüedad, «la más nueva». */
async function escenarioMinimo(titulo: string, filasIniciales: FilaMinima[]): Promise<BaseDeDatos> {
  motorAnterior?.apagar()
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importarUnica(db, new HojaSimulada([{ titulo, valores: [ENC_MINIMA, ...filasIniciales.map(filaMinima)] }]))
  return db
}

/** Reemplaza la hoja por UNA sola pestaña nueva (una fila fresca, sin _ID) y reimporta. */
async function reimportarConUnaFila(db: BaseDeDatos, titulo: string, fila: FilaMinima): Promise<void> {
  await importarUnica(db, new HojaSimulada([{ titulo, valores: [ENC_MINIMA, filaMinima(fila)] }]))
}

interface PolizaCruda {
  id: number
  numero: string | null
  fila_id: string | null
  activa: number
  compania: string | null
  vehiculo_id: number | null
  poliza_anterior_id: number | null
}

function polizasDeCliente(db: BaseDeDatos, documentoNormalizado: string): PolizaCruda[] {
  return db
    .prepare(
      `SELECT p.id, p.numero, p.fila_id, p.activa, p.compania, p.vehiculo_id, p.poliza_anterior_id
       FROM polizas p JOIN clientes c ON c.id = p.cliente_id
       WHERE c.documento_normalizado = ?
       ORDER BY p.id`,
    )
    .all(documentoNormalizado) as PolizaCruda[]
}

/** Sin período abierto: se cierran todas las cuotas del mes que sembró `escenarioMinimo`. */
function sinPeriodoAbierto(db: BaseDeDatos): void {
  db.prepare('UPDATE cuotas_mes SET dada_de_baja = 1').run()
}

const DATOS_RENOVACION_SIN_NUMERO = (desde: string, hasta: string) => ({
  vigenciaDesde: desde,
  vigenciaHasta: hasta,
  cuota: '$ 22.000',
  numero: '',
  propuesta: '',
  observaciones: '',
})

test('renovar sin número y sin período abierto: cuando el número real llega en una fila nueva, se pega a la renovación en vez de duplicarla', async () => {
  const dni = '30111000'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'ABELLEIRA MARIANO FERNANDO', dni, cia: 'AGROSALTA', numero: '8589509', patente: 'AB123CD', marca: 'VOLKSWAGEN', modelo: 'SAVEIRO' }])
  const original = polizaDe('8589509')
  sinPeriodoAbierto(db)

  renovar(original.id, DATOS_RENOVACION_SIN_NUMERO('22/8/2026', '22/12/2026'), DANIEL)

  const antes = polizasDeCliente(db, dni)
  const huerfana = antes.find((p) => p.numero === null)
  assert.ok(huerfana, 'la renovación tiene que haber creado la póliza sin número, sin período abierto')
  assert.equal(huerfana!.fila_id, null, 'sin período abierto no hay fila del mes que enganchar')
  assert.equal(huerfana!.activa, 1)
  assert.equal(huerfana!.poliza_anterior_id, original.id)

  // El número real llega en una fila NUEVA de la hoja (la que en la vida real terminó agregándose a
  // mano), con la misma compañía, el mismo vehículo y la misma vigencia que la renovación.
  await reimportarConUnaFila(db, 'FEBRERO', { nombre: 'ABELLEIRA MARIANO FERNANDO', dni, cia: 'AGROSALTA', numero: '8589509-R', patente: 'AB123CD', desde: '22/8/2026', hasta: '22/12/2026' })

  const despues = polizasDeCliente(db, dni)
  const activas = despues.filter((p) => p.activa === 1)
  assert.equal(activas.length, 1, 'sólo tiene que quedar UNA póliza activa, no dos')
  assert.equal(activas[0]!.numero, '8589509-R')
  assert.equal(activas[0]!.id, huerfana!.id, 'el número real se pega a la póliza de la renovación; no crea otra al lado')
  assert.ok(activas[0]!.fila_id, 'queda enganchada a la fila de la hoja')
  assert.equal(activas[0]!.poliza_anterior_id, original.id, 'la cadena de la renovación se conserva')

  assert.equal(
    despues.filter((p) => p.numero === null).length,
    0,
    'no puede quedar una póliza BAJA sin número, sin motivo y sin fecha de baja',
  )

  const anteriorDespues = despues.find((p) => p.id === original.id)!
  assert.equal(anteriorDespues.activa, 0, 'la póliza original de la renovación sigue histórica')
  assert.equal(anteriorDespues.numero, '8589509', 'y conserva su propio número')
})

test('renovar sin número: si hay dos candidatas (dos renovaciones sin número del mismo auto), no se fusiona ninguna', async () => {
  const dni = '30111002'
  const db = await escenarioMinimo('ENERO', [
    { nombre: 'DOS CANDIDATAS SA', dni, cia: 'SANCOR', numero: '200100', patente: 'AC456EF' },
    { nombre: 'DOS CANDIDATAS SA', dni, cia: 'SANCOR', numero: '200200', patente: 'AC456EF' },
  ])
  const polizaA = polizaDe('200100')
  const polizaB = polizaDe('200200')
  sinPeriodoAbierto(db)

  renovar(polizaA.id, DATOS_RENOVACION_SIN_NUMERO('1/1/2026', '1/1/2027'), DANIEL)
  renovar(polizaB.id, DATOS_RENOVACION_SIN_NUMERO('1/1/2026', '1/1/2027'), DANIEL)

  const huerfanas = polizasDeCliente(db, dni).filter((p) => p.numero === null)
  assert.equal(huerfanas.length, 2, 'las dos renovaciones sin número tienen que existir, del mismo vehículo y compañía')

  await reimportarConUnaFila(db, 'FEBRERO', { nombre: 'DOS CANDIDATAS SA', dni, cia: 'SANCOR', numero: '200300', patente: 'AC456EF' })

  const despues = polizasDeCliente(db, dni)
  const conNumeroNuevo = despues.find((p) => p.numero === '200300')!
  assert.ok(conNumeroNuevo, 'la fila nueva tiene que haber creado su propia póliza')
  assert.ok(
    huerfanas.every((h) => conNumeroNuevo.id !== h.id),
    'con dos candidatas ambiguas no se elige ninguna: la póliza nueva no puede ser ninguna de las dos huérfanas',
  )
  assert.equal(despues.filter((p) => p.numero === null).length, 2, 'las dos siguen sin número: no se tocó ninguna')
})

test('renovar sin número: si el vehículo de la fila nueva es otro, no se fusiona', async () => {
  const dni = '30111003'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'OTRO VEHICULO SA', dni, cia: 'SANCOR', numero: '300100', patente: 'AD789GH' }])
  const original = polizaDe('300100')
  sinPeriodoAbierto(db)
  renovar(original.id, DATOS_RENOVACION_SIN_NUMERO('1/1/2026', '1/1/2027'), DANIEL)
  const huerfana = polizasDeCliente(db, dni).find((p) => p.numero === null)!

  // Mismo cliente, misma compañía, pero OTRA patente: no es el mismo vehículo.
  await reimportarConUnaFila(db, 'FEBRERO', { nombre: 'OTRO VEHICULO SA', dni, cia: 'SANCOR', numero: '300100-R', patente: 'ZZZ999' })

  const despues = polizasDeCliente(db, dni)
  const conNumeroNuevo = despues.find((p) => p.numero === '300100-R')!
  assert.notEqual(conNumeroNuevo.id, huerfana.id, 'un vehículo distinto no puede quedarse con el número de otro')
  assert.ok(
    despues.some((p) => p.id === huerfana.id && p.numero === null),
    'la póliza sin número del vehículo original sigue como estaba',
  )
})

test('renovar sin número: si la fila nueva es de otra compañía, no se fusiona', async () => {
  const dni = '30111004'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'OTRA CIA SA', dni, cia: 'SANCOR', numero: '400100', patente: 'AE111JK' }])
  const original = polizaDe('400100')
  sinPeriodoAbierto(db)
  renovar(original.id, DATOS_RENOVACION_SIN_NUMERO('1/1/2026', '1/1/2027'), DANIEL)
  const huerfana = polizasDeCliente(db, dni).find((p) => p.numero === null)!

  // Mismo cliente, mismo vehículo, pero OTRA compañía: no es la misma póliza sin número.
  await reimportarConUnaFila(db, 'FEBRERO', { nombre: 'OTRA CIA SA', dni, cia: 'ZURICH', numero: '400100-R', patente: 'AE111JK' })

  const despues = polizasDeCliente(db, dni)
  const conNumeroNuevo = despues.find((p) => p.numero === '400100-R')!
  assert.notEqual(conNumeroNuevo.id, huerfana.id, 'otra compañía no puede quedarse con el número de la huérfana')
  assert.ok(
    despues.some((p) => p.id === huerfana.id && p.numero === null),
    'la póliza sin número de SANCOR sigue como estaba',
  )
})

test('renovar sin número y sin período abierto: si una importación de OTRO cliente corre antes de que llegue el número real, la fusión igual funciona', async () => {
  const dni = '30111006'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'ABELLEIRA MARIANO FERNANDO', dni, cia: 'AGROSALTA', numero: '8589509', patente: 'AB123CD', marca: 'VOLKSWAGEN', modelo: 'SAVEIRO' }])
  const original = polizaDe('8589509')
  sinPeriodoAbierto(db)

  renovar(original.id, DATOS_RENOVACION_SIN_NUMERO('22/8/2026', '22/12/2026'), DANIEL)
  const huerfana = polizasDeCliente(db, dni).find((p) => p.numero === null)!
  assert.equal(huerfana.activa, 1)

  // `renovar()` es una acción manual: no corre dentro de una importación. Antes de que llegue el número
  // real puede pasar un ciclo de importación entero para CUALQUIER otro cliente — y el barrido de
  // `inactivarPolizas` (que corre en TODA importación) deja la huérfana en activa=0 sin que nadie la
  // haya tocado todavía.
  await reimportarConUnaFila(db, 'FEBRERO', { nombre: 'OTRO CLIENTE INTERMEDIO SA', dni: '30111099', cia: 'SANCOR', numero: '999999', patente: 'ZZ000ZZ' })
  const huerfanaTrasElBarrido = polizasDeCliente(db, dni).find((p) => p.id === huerfana.id)!
  assert.equal(huerfanaTrasElBarrido.activa, 0, 'una importación de otro cliente la dejó inactiva antes de que llegara el número real')

  // Recién ahora, en una importación posterior, llega la fila con el número real.
  await reimportarConUnaFila(db, 'MARZO', { nombre: 'ABELLEIRA MARIANO FERNANDO', dni, cia: 'AGROSALTA', numero: '8589509-R', patente: 'AB123CD', desde: '22/8/2026', hasta: '22/12/2026' })

  const despues = polizasDeCliente(db, dni)
  const activas = despues.filter((p) => p.activa === 1)
  assert.equal(activas.length, 1, 'sólo tiene que quedar UNA póliza activa para Abelleira, no dos')
  assert.equal(activas[0]!.id, huerfana.id, 'el número real se pega a la huérfana aunque ya estuviera inactiva por el barrido de otra importación')
  assert.equal(despues.filter((p) => p.numero === null).length, 0, 'no puede quedar una póliza BAJA sin número, sin motivo y sin fecha de baja')
})

test('renovar sin número: si la vigencia de la fila nueva no se superpone con la de la huérfana, no se fusiona', async () => {
  const dni = '30111007'
  const db = await escenarioMinimo('ENERO', [{ nombre: 'VIGENCIA DISTINTA SA', dni, cia: 'SANCOR', numero: '600100', patente: 'AG333NP' }])
  const original = polizaDe('600100')
  sinPeriodoAbierto(db)
  renovar(original.id, DATOS_RENOVACION_SIN_NUMERO('1/1/2026', '1/6/2026'), DANIEL)
  const huerfana = polizasDeCliente(db, dni).find((p) => p.numero === null)!

  // Mismo cliente, mismo vehículo, misma compañía — pero una vigencia que no se superpone: podría ser
  // una póliza distinta, sin relación con la renovación que quedó sin número, y fusionarlas a ciegas
  // pisaría los datos de una con los de la otra.
  await reimportarConUnaFila(db, 'FEBRERO', { nombre: 'VIGENCIA DISTINTA SA', dni, cia: 'SANCOR', numero: '600100-R', patente: 'AG333NP', desde: '1/1/2027', hasta: '1/6/2027' })

  const despues = polizasDeCliente(db, dni)
  const conNumeroNuevo = despues.find((p) => p.numero === '600100-R')!
  assert.notEqual(conNumeroNuevo.id, huerfana.id, 'una vigencia que no se superpone no puede fusionarse a ciegas')
  assert.ok(
    despues.some((p) => p.id === huerfana.id && p.numero === null),
    'la huérfana sigue sin número: no se tocó',
  )
})

test('renovar sin número: una póliza que YA tiene número no es candidata, aunque después llegue otro número para el mismo auto', async () => {
  const dni = '30111005'
  // Acá no hay renovación: la póliza YA nace con número y con fila propia (la de la importación inicial).
  const db = await escenarioMinimo('ENERO', [{ nombre: 'YA TIENE NUMERO SA', dni, cia: 'SANCOR', numero: '500100', patente: 'AF222LM' }])
  const original = polizaDe('500100')

  await reimportarConUnaFila(db, 'FEBRERO', { nombre: 'YA TIENE NUMERO SA', dni, cia: 'SANCOR', numero: '500200', patente: 'AF222LM' })

  const despues = polizasDeCliente(db, dni)
  const conNumeroNuevo = despues.find((p) => p.numero === '500200')!
  assert.ok(conNumeroNuevo, 'la fila nueva tiene que haber creado su propia póliza')
  assert.notEqual(conNumeroNuevo.id, original.id, 'una póliza que ya tenía número y fila no es candidata a que se la reemplace')
  assert.ok(
    despues.some((p) => p.id === original.id && p.numero === '500100'),
    'la póliza original conserva su propio número',
  )
})
