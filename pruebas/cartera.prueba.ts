// La Cartera de punta a punta: se importa la hoja simulada y después se trabaja la planilla como lo
// hace la gente (editar una celda, avisar, registrar un pago, dar de baja, cerrar el mes).
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import {
  bajasDelMes,
  cerrarMes,
  darDeBaja,
  deshacerBaja,
  editarCelda,
  marcarAvisado,
  planillaDelMes,
  prepararAviso,
  registrarPago,
  telefonoParaWhatsapp,
} from '../src/main/servicios/cartera'
import { editarCompania, listarCompanias } from '../src/main/servicios/companias'
import { listarRiesgos } from '../src/main/servicios/riesgos'
import { historialDeFila } from '../src/main/servicios/historial'
import { guardarPlantillaDeAviso } from '../src/main/servicios/plantillas'
import { calcularAlerta } from '../src/shared/semaforo'
import type { FilaCartera, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { importar } from './ayuda'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

/** Abre una base global (la que usan los servicios) con la hoja de prueba ya importada. */
async function carteraDePrueba(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(construirHojaDePrueba()))
  return db
}

function buscar(filas: FilaCartera[], nombre: string): FilaCartera {
  const fila = filas.find((f) => f.nombre === nombre)
  if (!fila) throw new Error(`No está «${nombre}» en la planilla`)
  return fila
}

test('la planilla abre en el mes más nuevo con todas sus filas', async () => {
  await carteraDePrueba()
  const planilla = planillaDelMes(null)

  assert.equal(planilla.periodo, '2026-08')
  assert.equal(planilla.soloLectura, false)
  assert.equal(planilla.filas.length, 7)
  assert.deepEqual(
    planilla.periodos.map((p) => p.periodo),
    ['2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02', '2026-01', '2025-12'],
  )

  // Una fila trae junto lo del cliente, el vehículo y la póliza.
  const gonzalez = buscar(planilla.filas, CLIENTES.gonzalez.nombre)
  assert.equal(gonzalez.compania, CLIENTES.gonzalez.cia)
  assert.equal(gonzalez.numeroPoliza, CLIENTES.gonzalez.poliza)
  assert.equal(gonzalez.patente, CLIENTES.gonzalez.patente)
  assert.equal(gonzalez.marca, CLIENTES.gonzalez.marca)
  assert.equal(gonzalez.telefono, '11-4444-5555')
  assert.equal(gonzalez.formaPago, 'DEBITO')
  assert.equal(gonzalez.diaVencimientoNumero, 10)
  cerrarBaseDeDatos()
})

test('los meses anteriores se ven completos pero no se pueden tocar', async () => {
  await carteraDePrueba()
  const enero = planillaDelMes('2026-01')
  assert.equal(enero.periodo, '2026-01')
  assert.equal(enero.soloLectura, true)
  assert.equal(enero.filas.length, 7)

  const fila = enero.filas[0]!
  assert.throws(() => editarCelda(fila.filaId, 'cuota', '$ 1', DANIEL), /mes anterior/)
  assert.throws(() => registrarPago(fila.filaId, { fecha: '2026-01-10', importe: '1', medioDePago: 'EFECTIVO' }, DANIEL), /mes anterior/)
  assert.throws(() => darDeBaja(fila.filaId, { motivo: 'VENDIO', nota: '' }, DANIEL), /mes anterior/)
  cerrarBaseDeDatos()
})

test('editar una celda guarda donde corresponde y queda en el historial', async () => {
  await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = buscar(planilla.filas, CLIENTES.lopez.nombre)

  // El teléfono es del cliente: cambia en todos los meses.
  const conTelefono = editarCelda(fila.filaId, 'telefono', '11-2222-3333', DANIEL)
  assert.equal(conTelefono.telefono, '11-2222-3333')
  const enero = planillaDelMes('2026-01')
  assert.equal(buscar(enero.filas, CLIENTES.lopez.nombre).telefono, '11-2222-3333')

  // La cuota es del mes: cambia sólo acá, y se recalcula el monto.
  const conCuota = editarCelda(fila.filaId, 'cuota', '$ 25.500', DANIEL)
  assert.equal(conCuota.cuota, '$ 25.500')
  assert.equal(conCuota.cuotaMonto, 25500)
  assert.notEqual(buscar(planillaDelMes('2026-01').filas, CLIENTES.lopez.nombre).cuota, '$ 25.500')

  const historial = historialDeFila(fila.filaId)
  assert.equal(historial.length, 2)
  assert.equal(historial[0]!.campo, 'cuota')
  assert.equal(historial[0]!.valorNuevo, '$ 25.500')
  assert.equal(historial[0]!.usuarioNombre, 'Daniel Martínez')
  assert.equal(historial[1]!.campo, 'telefono')
  cerrarBaseDeDatos()
})

test('avisar arma el WhatsApp y deja la fila como ENVIADO con la fecha', async () => {
  await carteraDePrueba()
  guardarPlantillaDeAviso('Hola {nombre}, vence el {vencimiento} tu cuota de ${cuota}.')
  const planilla = planillaDelMes(null)
  const fila = buscar(planilla.filas, CLIENTES.gonzalez.nombre)

  const aviso = prepararAviso(fila.filaId, DANIEL)
  assert.match(aviso.url, /^https:\/\/wa\.me\/5491144445555\?text=/)
  assert.equal(aviso.mensaje, 'Hola MARIA, vence el 10 tu cuota de $$ 24.420.')
  assert.equal(aviso.fila.aviso, 'ENVIADO')
  assert.equal(aviso.fila.fechaEnvio, planilla.hoy)
  assert.equal(decodeURIComponent(aviso.url.split('text=')[1]!), aviso.mensaje)

  const historial = historialDeFila(fila.filaId)
  assert.equal(historial[0]!.campo, 'OB. AVISOS')
  assert.match(historial[0]!.valorNuevo ?? '', /ENVIADO/)
  cerrarBaseDeDatos()
})

test('«Avisado» deja la fila igual que el WhatsApp, pero sin abrirlo', async () => {
  await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = buscar(planilla.filas, CLIENTES.lopez.nombre)
  assert.notEqual(fila.aviso, 'ENVIADO', 'arranca sin avisar')

  const marcada = marcarAvisado(fila.filaId, DANIEL)
  assert.equal(marcada.aviso, 'ENVIADO')
  assert.equal(marcada.fechaEnvio, planilla.hoy, 'con la fecha de hoy, que es lo que cuenta «Avisados hoy»')

  const historial = historialDeFila(fila.filaId)
  assert.equal(historial[0]!.campo, 'OB. AVISOS')
  assert.match(historial[0]!.valorNuevo ?? '', /ENVIADO.*a mano/)
  cerrarBaseDeDatos()
})

test('«Avisado» no necesita teléfono: es para cuando ya se avisó por otro lado', async () => {
  await carteraDePrueba()
  const fila = buscar(planillaDelMes(null).filas, CLIENTES.suarez.nombre)
  editarCelda(fila.filaId, 'telefono', '', DANIEL)
  assert.equal(marcarAvisado(fila.filaId, DANIEL).aviso, 'ENVIADO')
  cerrarBaseDeDatos()
})

test('la propuesta se carga desde la planilla y queda en la póliza, sin ir a la hoja', async () => {
  await carteraDePrueba()
  const fila = buscar(planillaDelMes(null).filas, CLIENTES.gonzalez.nombre)
  assert.equal(fila.propuesta, null, 'la hoja no trae propuestas: arranca vacía')

  const conPropuesta = editarCelda(fila.filaId, 'propuesta', 'PR-99887', DANIEL)
  assert.equal(conPropuesta.propuesta, 'PR-99887')
  assert.equal(buscar(planillaDelMes(null).filas, CLIENTES.gonzalez.nombre).propuesta, 'PR-99887', 'y se sigue viendo')

  const historial = historialDeFila(fila.filaId)
  assert.equal(historial[0]!.campo, 'PROPUESTA')
  cerrarBaseDeDatos()
})

test('sin teléfono, avisar explica qué falta en vez de abrir cualquier cosa', async () => {
  await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = buscar(planilla.filas, CLIENTES.suarez.nombre)
  editarCelda(fila.filaId, 'telefono', '', DANIEL)
  assert.throws(() => prepararAviso(fila.filaId, DANIEL), /no tiene teléfono/)
  cerrarBaseDeDatos()
})

test('el teléfono se arma como lo espera WhatsApp', () => {
  assert.equal(telefonoParaWhatsapp('11 3169-9902'), '5491131699902')
  assert.equal(telefonoParaWhatsapp('011 3169 9902'), '5491131699902')
  assert.equal(telefonoParaWhatsapp('+54 9 11 3169-9902'), '5491131699902')
  assert.equal(telefonoParaWhatsapp('5491131699902'), '5491131699902')
  assert.equal(telefonoParaWhatsapp(''), '')
  assert.equal(telefonoParaWhatsapp('---'), '')
})

test('registrar un pago pone la fila en verde y crea el pago', async () => {
  const db = await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = buscar(planilla.filas, CLIENTES.perezAuto.nombre)

  const antes = calcularAlerta(
    { periodo: fila.periodo, diaVencimiento: fila.diaVencimientoNumero, pagada: false, formaPago: 'CUPONERA', diasCobertura: 0 },
    '2026-08-20',
  )
  assert.notEqual(antes.color, 'verde')

  const pagosAntes = (db.prepare('SELECT COUNT(*) AS n FROM pagos').get() as { n: number }).n
  const actualizada = registrarPago(fila.filaId, { fecha: '2026-08-09', importe: '$ 16.236', medioDePago: 'TRANSFERENCIA' }, DANIEL)

  assert.equal(actualizada.pagoFecha, '2026-08-09')
  assert.equal(actualizada.pagoRegistrado, true)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pagos').get() as { n: number }).n, pagosAntes + 1)

  const despues = calcularAlerta(
    { periodo: actualizada.periodo, diaVencimiento: actualizada.diaVencimientoNumero, pagada: Boolean(actualizada.pagoFecha), formaPago: actualizada.formaPago, diasCobertura: 0 },
    '2026-08-20',
  )
  assert.equal(despues.color, 'verde')

  // Registrarlo dos veces corrige el pago, no lo duplica.
  registrarPago(fila.filaId, { fecha: '2026-08-10', importe: '$ 16.236', medioDePago: 'EFECTIVO' }, DANIEL)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pagos').get() as { n: number }).n, pagosAntes + 1)
  cerrarBaseDeDatos()
})

test('dar de baja saca la fila de la planilla y la deja en Bajas con su motivo', async () => {
  await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = buscar(planilla.filas, CLIENTES.martinez.nombre)

  darDeBaja(fila.filaId, { motivo: 'ANULA POR FALTA DE PAGO', nota: 'Debe tres cuotas' }, DANIEL)

  const despues = planillaDelMes(null)
  assert.equal(despues.filas.length, planilla.filas.length - 1)
  assert.equal(despues.filas.some((f) => f.filaId === fila.filaId), false)

  const bajas = bajasDelMes('2026-08')
  const baja = bajas.find((b) => b.numeroPoliza === CLIENTES.martinez.poliza)
  assert.ok(baja, 'la baja tiene que aparecer en el mes')
  assert.equal(baja.motivo, 'ANULA POR FALTA DE PAGO')
  assert.equal(baja.nota, 'Debe tres cuotas')
  assert.equal(baja.hechaEnLaApp, true)

  // Y la póliza deja de estar activa.
  const historial = historialDeFila(fila.filaId)
  assert.equal(historial[0]!.campo, 'BAJA')

  // Deshacerla la devuelve a la planilla.
  deshacerBaja(baja.id, DANIEL)
  const reactivada = planillaDelMes(null)
  assert.equal(reactivada.filas.length, planilla.filas.length)
  assert.ok(reactivada.filas.some((f) => f.filaId === fila.filaId))
  assert.equal(bajasDelMes('2026-08').some((b) => b.id === baja.id), false)
  cerrarBaseDeDatos()
})

test('una baja que vino de la hoja no se puede deshacer desde la aplicación', async () => {
  await carteraDePrueba()
  const bajas = bajasDelMes('2026-07')
  const deLaHoja = bajas.find((b) => !b.hechaEnLaApp)
  assert.ok(deLaHoja, 'la hoja de prueba trae una baja de julio')
  assert.throws(() => deshacerBaja(deLaHoja.id, DANIEL), /vino de la hoja/)
  cerrarBaseDeDatos()
})

test('cerrar el mes abre el siguiente con las pólizas activas y sin los pagos del anterior', async () => {
  await carteraDePrueba()
  const agosto = planillaDelMes(null)
  const fila = buscar(agosto.filas, CLIENTES.gonzalez.nombre)
  registrarPago(fila.filaId, { fecha: '2026-08-09', importe: '$ 1', medioDePago: 'EFECTIVO' }, DANIEL)
  prepararAviso(fila.filaId, DANIEL)

  const resumen = cerrarMes(DANIEL)
  assert.equal(resumen.periodo, '2026-09')
  assert.equal(resumen.filasCreadas, 7)

  const septiembre = planillaDelMes('2026-09')
  assert.equal(septiembre.periodo, '2026-09')
  assert.equal(septiembre.soloLectura, false)
  assert.equal(septiembre.filas.length, 7)

  const nueva = buscar(septiembre.filas, CLIENTES.gonzalez.nombre)
  assert.equal(nueva.cuota, fila.cuota, 'la cuota se copia')
  assert.equal(nueva.diaVencimientoNumero, fila.diaVencimientoNumero, 'el día de vencimiento también')
  assert.equal(nueva.pago, null, 'el pago del mes anterior no se arrastra')
  assert.equal(nueva.pagoFecha, null)
  assert.equal(nueva.fechaEnvio, null, 'ni la fecha del aviso')
  assert.notEqual(nueva.filaId, fila.filaId, 'es otra fila')

  // Agosto queda como mes cerrado.
  assert.equal(planillaDelMes('2026-08').soloLectura, true)
  // Y no se puede seguir abriendo meses hacia adelante sin que llegue el momento.
  assert.throws(() => cerrarMes(DANIEL), /Ya está abierto 2026-09/)
  cerrarBaseDeDatos()
})

test('los días de cobertura financiera se cargan solos y se pueden cambiar', async () => {
  await carteraDePrueba()
  const companias = listarCompanias()
  assert.ok(companias.length >= 4, 'las compañías se dan de alta desde la cartera')

  const sancor = companias.find((c) => c.nombre === 'SANCOR')
  assert.ok(sancor)
  assert.equal(sancor.polizas > 0, true)

  const editada = editarCompania(sancor.id, { nombre: 'SANCOR', diasCoberturaFinanciera: 7, comisionPorcentaje: 15, mesesRenovacion: null, activa: true })
  assert.equal(editada.diasCoberturaFinanciera, 7)
  assert.equal(editada.comisionPorcentaje, 15)

  // La planilla ya usa los días nuevos.
  const planilla = planillaDelMes(null)
  const fila = planilla.filas.find((f) => f.compania === 'SANCOR')
  assert.ok(fila)
  assert.equal(fila.diasCobertura, 7)

  assert.throws(() => editarCompania(sancor.id, { nombre: 'SANCOR', diasCoberturaFinanciera: -1, comisionPorcentaje: 0, mesesRenovacion: null, activa: true }), /entre 0 y 365/)
  cerrarBaseDeDatos()
})

test('las compañías conocidas arrancan con los días que usa la agencia', async () => {
  await carteraDePrueba()
  // La hoja de prueba usa compañías reales: ATM y RIVADAVIA dan 7 días; FEDERACION, 0.
  const porNombre = new Map(listarCompanias().map((c) => [c.nombre, c.diasCoberturaFinanciera]))
  assert.equal(porNombre.get('RIVADAVIA'), 7)
  assert.equal(porNombre.get('FEDERACION PATRONAL') ?? porNombre.get('FEDERACION'), 0)
  cerrarBaseDeDatos()
})

test('riesgos varios se lee entero', async () => {
  await carteraDePrueba()
  const riesgos = listarRiesgos().filas
  assert.equal(riesgos.length, 2)
  assert.ok(riesgos.some((r) => r.tipoRiesgo === 'COMBINADO FAMILIAR'))
  cerrarBaseDeDatos()
})

test('los catálogos de los desplegables salen de los datos que ya hay', async () => {
  await carteraDePrueba()
  const { catalogos } = planillaDelMes(null)
  assert.ok(catalogos.formasDePago.includes('CUPONERA'))
  assert.ok(catalogos.formasDePago.includes('TARJETA'))
  assert.ok(catalogos.sucursales.includes('Dock Sud'))
  assert.ok(catalogos.companias.length > 0)
  assert.ok(catalogos.mediosDePago.includes('EFECTIVO'))
  cerrarBaseDeDatos()
})
