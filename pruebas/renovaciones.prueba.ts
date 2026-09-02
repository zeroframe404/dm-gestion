// La bandeja de renovaciones de punta a punta: qué entra en los próximos 60 días, cómo se agrupa por
// semana, la etiqueta de «aumentar al renovar», y que renovar deje la vigencia nueva, la anterior como
// histórica y el cambio camino a la hoja de Google.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
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

  // La anterior deja de estar activa, pero no se borra ni se inventa una baja: se renovó, no se dio de baja.
  const vieja = verPoliza(original.id)
  assert.notEqual(vieja.estado, 'ACTIVA', 'la anterior queda como histórica')
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
  assert.notEqual(vieja.estado, 'ACTIVA', 'la anterior queda histórica')
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
