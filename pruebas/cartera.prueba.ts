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
  reactivarBaja,
  imputarAdelanto,
  registrarPago,
  telefonoParaWhatsapp,
} from '../src/main/servicios/cartera'
import {
  avisarRechazo,
  avisosDeRechazos,
  listarRechazos,
  marcarRechazosVistos,
  resolverRechazoDesdeLaCampana,
} from '../src/main/servicios/rechazos'
import { editarCompania, listarCompanias } from '../src/main/servicios/companias'
import { listarRiesgos } from '../src/main/servicios/riesgos'
import { historialDeFila } from '../src/main/servicios/historial'
import { guardarPlantillaDeAviso } from '../src/main/servicios/plantillas'
import { calcularAlerta, periodoDeHoy, periodoSiguiente } from '../src/shared/semaforo'
import type { FilaCartera, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { filas, importar, unico } from './ayuda'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}
const ANA: SesionUsuario = { ...DANIEL, id: 2, nombre: 'Ana Ruiz', usuario: 'ana', rol: 'ADMIN' }
const MARIA: SesionUsuario = { ...DANIEL, id: 3, nombre: 'María Pérez', usuario: 'maria', rol: 'EMPLEADO' }

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

/** Los pagos y el historial guardan `usuario_id`: para escribir con ANA o MARIA hacen falta de verdad en la tabla. */
function insertarUsuario(db: BaseDeDatos, actor: SesionUsuario): void {
  db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave) VALUES (?, ?, ?, 'x', ?, ?, 1, 0)`,
  ).run(actor.id, actor.nombre, actor.usuario, actor.rol, actor.sucursal.id)
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

test('los meses anteriores se ven completos pero un empleado no los puede tocar; un administrador sí', async () => {
  await carteraDePrueba()
  const enero = planillaDelMes('2026-01')
  assert.equal(enero.periodo, '2026-01')
  assert.equal(enero.soloLectura, true)
  assert.equal(enero.filas.length, 7)

  const fila = enero.filas[0]!
  assert.throws(() => editarCelda(fila.filaId, 'cuota', '$ 1', MARIA), /mes anterior/)
  assert.throws(() => registrarPago(fila.filaId, { fecha: '2026-01-10', importe: '1', medioDePago: 'EFECTIVO' }, MARIA), /mes anterior/)
  assert.throws(() => darDeBaja(fila.filaId, { motivo: 'VENDIO', nota: '' }, MARIA), /mes anterior/)

  // Un SUPER_ADMIN sigue pudiendo corregir un mes ya cerrado.
  const corregida = editarCelda(fila.filaId, 'cuota', '$ 1', DANIEL)
  assert.equal(corregida.cuota, '$ 1')
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
  // Y no se puede seguir abriendo meses hacia adelante sin que llegue el momento: se puede llegar hasta
  // el mes que viene del calendario real, pero no más allá. Cuántas veces hay que cerrar para chocar con
  // ese límite depende de la fecha en la que corra la prueba, así que se avanza hasta ahí en vez de
  // asumir que septiembre ya es el límite.
  const limite = periodoSiguiente(periodoDeHoy())
  let actual = resumen.periodo
  let vueltas = 0
  while (periodoSiguiente(actual) <= limite) {
    assert.ok(vueltas++ < 24, 'el límite del cierre de mes no debería tardar tanto en aparecer')
    actual = cerrarMes(DANIEL).periodo
  }
  assert.throws(() => cerrarMes(DANIEL), new RegExp(`Ya está abierto ${actual}`))
  cerrarBaseDeDatos()
})

test('un mes cerrado sigue siendo de lectura y escritura para un administrador, y de sólo lectura para un empleado', async () => {
  const db = await carteraDePrueba()
  insertarUsuario(db, ANA)
  insertarUsuario(db, MARIA)
  const agosto = planillaDelMes(null)
  const gonzalez = buscar(agosto.filas, CLIENTES.gonzalez.nombre)
  cerrarMes(DANIEL)

  // Para el SUPER_ADMIN y el ADMIN, agosto ya cerrado se ve como lectura y escritura.
  assert.equal(planillaDelMes('2026-08', DANIEL).soloLectura, false)
  assert.equal(planillaDelMes('2026-08', ANA).soloLectura, false)
  assert.doesNotThrow(() => registrarPago(gonzalez.filaId, { fecha: '2026-08-09', importe: '$ 1', medioDePago: 'EFECTIVO' }, ANA))
  assert.doesNotThrow(() => editarCelda(gonzalez.filaId, 'observaciones', 'corregido por administración', DANIEL))

  // Para el EMPLEADO, agosto cerrado sigue siendo de sólo lectura.
  assert.equal(planillaDelMes('2026-08', MARIA).soloLectura, true)
  assert.throws(() => registrarPago(gonzalez.filaId, { fecha: '2026-08-09', importe: '$ 1', medioDePago: 'EFECTIVO' }, MARIA), /mes anterior/)
  assert.throws(() => editarCelda(gonzalez.filaId, 'observaciones', 'no debería poder', MARIA), /mes anterior/)
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

// ---------------------------------------------------------------------------
// Lo que pidió la agencia: la baja completa, poner vigente y los rechazos del débito
// ---------------------------------------------------------------------------

test('la baja se lleva TODOS los datos de la cartera, no sólo el nombre y el motivo', async () => {
  await carteraDePrueba()
  const fila = buscar(planillaDelMes(null).filas, CLIENTES.gonzalez.nombre)
  darDeBaja(fila.filaId, { motivo: 'VENDIO', nota: 'Vendió el Fiesta' }, DANIEL)

  const baja = bajasDelMes('2026-08').find((b) => b.numeroPoliza === CLIENTES.gonzalez.poliza)
  assert.ok(baja, 'la baja tiene que estar en el mes')
  // Lo que ya se guardaba.
  assert.equal(baja.clienteNombre, CLIENTES.gonzalez.nombre)
  assert.equal(baja.compania, CLIENTES.gonzalez.cia)
  assert.equal(baja.patente, CLIENTES.gonzalez.patente)
  assert.equal(baja.motivo, 'VENDIO')
  // Y lo que antes se perdía.
  assert.equal(baja.telefono, fila.telefono)
  assert.equal(baja.marca, CLIENTES.gonzalez.marca)
  assert.equal(baja.modelo, CLIENTES.gonzalez.modelo)
  assert.equal(baja.anio, CLIENTES.gonzalez.anio)
  assert.equal(baja.cuota, fila.cuota)
  assert.equal(baja.formaPago, fila.formaPago)
  assert.equal(baja.diaVencimiento, fila.diaVencimiento)
  assert.equal(baja.cobertura, fila.cobertura)
  assert.equal(baja.vigenciaDesde, fila.vigenciaDesde)
  assert.equal(baja.clienteId, fila.clienteId)
  assert.equal(baja.puedeReactivarse, true)
  cerrarBaseDeDatos()
})

test('una baja vieja de la hoja muestra lo que ella misma trae, y no se puede reactivar sin póliza', async () => {
  await carteraDePrueba()
  const deLaHoja = bajasDelMes('2026-07').find((b) => !b.hechaEnLaApp)
  assert.ok(deLaHoja, 'la hoja de prueba trae una baja de julio')
  // Fernández se fue antes de la planilla más nueva, así que no quedó ni cliente ni póliza suya en la
  // base (el importador los arma con la más nueva). De la baja se sigue viendo lo que la hoja escribió.
  assert.equal(deLaHoja.clienteNombre, CLIENTES.fernandez.nombre)
  assert.equal(deLaHoja.compania, CLIENTES.fernandez.cia)
  assert.equal(deLaHoja.numeroPoliza, CLIENTES.fernandez.poliza)
  assert.equal(deLaHoja.patente, CLIENTES.fernandez.patente)
  // Y como no hay póliza que reactivar, la pantalla no ofrece el botón y el servicio lo explica.
  assert.equal(deLaHoja.puedeReactivarse, false)
  assert.throws(() => reactivarBaja(deLaHoja.id, DANIEL), /no está enlazada a ninguna póliza/)
  cerrarBaseDeDatos()
})

test('«poner vigente» devuelve a la cartera al cliente que se fue y volvió, sin cargarlo de nuevo', async () => {
  const db = await carteraDePrueba()
  // Se va en agosto…
  const agosto = planillaDelMes(null)
  const fila = buscar(agosto.filas, CLIENTES.lopez.nombre)
  darDeBaja(fila.filaId, { motivo: 'ANULA POR DECISION DEL CLIENTE', nota: 'Se va un tiempo' }, DANIEL)
  const baja = bajasDelMes('2026-08').find((b) => b.numeroPoliza === CLIENTES.lopez.poliza)
  assert.ok(baja)
  assert.equal(baja.puedeReactivarse, true)

  // …se cierra el mes y en septiembre ya no está…
  cerrarMes(DANIEL)
  const septiembre = planillaDelMes(null)
  assert.equal(septiembre.periodo, '2026-09')
  assert.equal(septiembre.filas.some((f) => f.numeroPoliza === CLIENTES.lopez.poliza), false)

  // …y vuelve: no hay que cargarlo otra vez.
  const resultado = reactivarBaja(baja.id, DANIEL)
  assert.equal(resultado.periodo, '2026-09')
  assert.equal(resultado.filaNueva, true, 'la fila de agosto no sirve: se le crea la de septiembre')
  assert.equal(resultado.clienteNombre, CLIENTES.lopez.nombre)

  const despues = planillaDelMes(null)
  assert.equal(despues.filas.length, septiembre.filas.length + 1)
  const vuelto = despues.filas.find((f) => f.numeroPoliza === CLIENTES.lopez.poliza)
  assert.ok(vuelto, 'López vuelve a estar en la planilla del mes')
  assert.equal(vuelto.compania, CLIENTES.lopez.cia)
  assert.equal(vuelto.patente, CLIENTES.lopez.patente)
  assert.equal(vuelto.cuota, fila.cuota, 'con la última cuota que tenía')
  assert.equal(vuelto.formaPago, fila.formaPago)
  assert.equal(vuelto.polizaActiva, true)

  // La baja sale de la lista y de la hoja: hay que pedirle a la hoja que saque el renglón de BAJAS, o
  // el cliente queda en los dos lados. Desde la 12.7 `encolar` además cancela el «crear» de ese
  // renglón si todavía estaba esperando —no tiene sentido escribir una fila que se está borrando— pero
  // el «borrar» se encola IGUAL, porque el «crear» puede haber salido y perdido la respuesta (ver el
  // comentario de `encolar` en sincronizacion/cola.ts). Por eso queda una sola entrada, y es el borrado.
  assert.equal(bajasDelMes('2026-08').some((b) => b.id === baja.id), false)
  const pendientes = filas<{ operacion: string; pestana: string }>(
    db,
    `SELECT operacion, pestana FROM cola_sync WHERE estado = 'pendiente' AND fila_id = ? ORDER BY id`,
    baja.filaId,
  )
  assert.equal(pendientes.length, 1, 'el renglón de BAJAS no puede quedar camino a la hoja')
  assert.equal(pendientes[0]!.operacion, 'borrar')
  assert.match(pendientes[0]!.pestana, /BAJAS/i)
  cerrarBaseDeDatos()
})

test('poner vigente una baja del mes abierto reusa su fila en vez de duplicarla', async () => {
  await carteraDePrueba()
  const antes = planillaDelMes(null)
  const fila = buscar(antes.filas, CLIENTES.suarez.nombre)
  darDeBaja(fila.filaId, { motivo: 'OTRO', nota: '' }, DANIEL)
  const baja = bajasDelMes('2026-08').find((b) => b.numeroPoliza === CLIENTES.suarez.poliza)
  assert.ok(baja)

  const resultado = reactivarBaja(baja.id, DANIEL)
  assert.equal(resultado.filaNueva, false, 'la fila ya era del mes abierto')
  const despues = planillaDelMes(null)
  assert.equal(despues.filas.length, antes.filas.length)
  assert.equal(despues.filas.filter((f) => f.numeroPoliza === CLIENTES.suarez.poliza).length, 1, 'una sola fila, no dos')
  cerrarBaseDeDatos()
})

test('«poner vigente» con cambios corrige compañía, póliza, propuesta, cuota, vencimiento y forma de pago de una', async () => {
  await carteraDePrueba()
  const agosto = planillaDelMes(null)
  const fila = buscar(agosto.filas, CLIENTES.lopez.nombre)
  darDeBaja(fila.filaId, { motivo: 'ANULA POR DECISION DEL CLIENTE', nota: 'Se va a otra compañía' }, DANIEL)
  const baja = bajasDelMes('2026-08').find((b) => b.numeroPoliza === CLIENTES.lopez.poliza)
  assert.ok(baja)
  cerrarMes(DANIEL)

  const resultado = reactivarBaja(baja.id, DANIEL, {
    compania: 'OTRA COMPAÑIA SA',
    numeroPoliza: 'POL-NUEVA-1',
    propuesta: 'PROP-9',
    cuota: '5000',
    diaVencimiento: '15',
    formaPago: 'TARJETA',
  })
  assert.equal(resultado.filaNueva, true)

  const vuelto = planillaDelMes(null).filas.find((f) => f.numeroPoliza === 'POL-NUEVA-1')
  assert.ok(vuelto, 'la fila vuelve con la póliza nueva')
  assert.equal(vuelto.compania, 'OTRA COMPAÑIA SA')
  assert.equal(vuelto.propuesta, 'PROP-9')
  assert.equal(vuelto.cuota, '5000')
  assert.equal(vuelto.diaVencimiento, '15')
  assert.equal(vuelto.formaPago, 'TARJETA')
  cerrarBaseDeDatos()
})

test('«poner vigente» sin cambios deja todo tal como estaba en la baja', async () => {
  await carteraDePrueba()
  const agosto = planillaDelMes(null)
  const fila = buscar(agosto.filas, CLIENTES.lopez.nombre)
  darDeBaja(fila.filaId, { motivo: 'OTRO', nota: '' }, DANIEL)
  const baja = bajasDelMes('2026-08').find((b) => b.numeroPoliza === CLIENTES.lopez.poliza)
  assert.ok(baja)
  cerrarMes(DANIEL)

  reactivarBaja(baja.id, DANIEL, {})
  const vuelto = planillaDelMes(null).filas.find((f) => f.numeroPoliza === CLIENTES.lopez.poliza)
  assert.ok(vuelto)
  assert.equal(vuelto.compania, CLIENTES.lopez.cia)
  assert.equal(vuelto.cuota, fila.cuota)
  cerrarBaseDeDatos()
})

test('las bajas de «todos los meses» juntan las de cualquier período en una sola lista', async () => {
  await carteraDePrueba()
  const agosto = planillaDelMes(null)
  const lopez = buscar(agosto.filas, CLIENTES.lopez.nombre)
  darDeBaja(lopez.filaId, { motivo: 'OTRO', nota: '' }, DANIEL)
  cerrarMes(DANIEL)
  // Sólo el mes abierto admite bajas nuevas: Suárez se da de baja ya en septiembre.
  const septiembre = planillaDelMes(null)
  const suarez = buscar(septiembre.filas, CLIENTES.suarez.nombre)
  darDeBaja(suarez.filaId, { motivo: 'OTRO', nota: '' }, DANIEL)

  const deAgosto = bajasDelMes('2026-08')
  const deSeptiembre = bajasDelMes('2026-09')
  const todas = bajasDelMes('')
  assert.ok(deAgosto.some((b) => b.numeroPoliza === CLIENTES.lopez.poliza))
  assert.ok(deSeptiembre.some((b) => b.numeroPoliza === CLIENTES.suarez.poliza))
  // «Todos los meses» no se queda con uno solo: trae más que mirar cualquiera de los dos por separado.
  assert.ok(todas.length > deAgosto.length && todas.length > deSeptiembre.length)
  assert.ok(todas.some((b) => b.numeroPoliza === CLIENTES.lopez.poliza))
  assert.ok(todas.some((b) => b.numeroPoliza === CLIENTES.suarez.poliza))
  cerrarBaseDeDatos()
})

test('un aviso de rechazo del débito le llega a la sucursal del cliente y se puede resolver', async () => {
  await carteraDePrueba()
  const fila = buscar(planillaDelMes(null).filas, CLIENTES.gonzalez.nombre)
  assert.ok(fila.polizaId)

  const aviso = avisarRechazo(fila.polizaId, { sucursal: '', motivo: 'CBU RECHAZADO', nota: 'Rebotó el débito de agosto' }, DANIEL)
  // Sin sucursal elegida se cae a la de la póliza: González es de Dock Sud.
  assert.equal(aviso.sucursal, fila.sucursal)
  assert.equal(aviso.estado, 'PENDIENTE')
  assert.equal(aviso.clienteNombre, CLIENTES.gonzalez.nombre)
  assert.equal(aviso.telefono, fila.telefono)
  assert.equal(aviso.periodo, '2026-08')
  assert.equal(aviso.avisadoPor, DANIEL.nombre)

  // A quien está en esa sucursal le enciende la campana; a quien está en otra, no. (Se reusa el id 1,
  // que es el único usuario que la semilla crea: el historial tiene clave foránea contra `usuarios`.)
  const enDockSud: SesionUsuario = { ...DANIEL, nombre: 'Fede', sucursal: { id: 2, nombre: 'Dock Sud' } }
  assert.equal(avisosDeRechazos(enDockSud).nuevos, 1)
  assert.equal(avisosDeRechazos(enDockSud).sinResolver, 1)
  assert.equal(avisosDeRechazos({ ...DANIEL, sucursal: { id: 3, nombre: 'Lanús' } }).nuevos, 0)

  // Abrir la campana lo deja visto, pero sigue sin resolver: verlo no es haberlo cobrado.
  assert.equal(marcarRechazosVistos(enDockSud).nuevos, 0)
  assert.equal(avisosDeRechazos(enDockSud).sinResolver, 1)

  // Apretar el botón de nuevo no crea un segundo aviso.
  avisarRechazo(fila.polizaId, { sucursal: '', motivo: 'SIN FONDOS', nota: '' }, DANIEL)
  assert.equal(listarRechazos({ busqueda: '', sucursales: [], estado: '' }).total, 1)

  // Y darlo por resuelto lo saca de la campana.
  assert.equal(resolverRechazoDesdeLaCampana(aviso.id, enDockSud).sinResolver, 0)
  const listado = listarRechazos({ busqueda: '', sucursales: [], estado: '' })
  assert.equal(listado.porEstado.RESUELTO, 1)
  assert.equal(listado.filas[0]!.resueltoPor, 'Fede')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Pagos adelantados y el cierre de mes
// ---------------------------------------------------------------------------

test('al cerrar el mes, el adelanto ACREDITAR deja la fila nueva paga y el PENDIENTE la deja para imputar a mano', async () => {
  const db = await carteraDePrueba()
  const agosto = planillaDelMes(null)
  const gonzalez = buscar(agosto.filas, CLIENTES.gonzalez.nombre)
  const lopez = buscar(agosto.filas, CLIENTES.lopez.nombre)
  const rodriguez = buscar(agosto.filas, CLIENTES.rodriguez.nombre)

  registrarPago(gonzalez.filaId, { fecha: '2026-08-09', importe: '$ 1', medioDePago: 'EFECTIVO', alcance: 'AMBAS', adelanto: { importe: '$ 2', modo: 'ACREDITAR' } }, DANIEL)
  registrarPago(lopez.filaId, { fecha: '2026-08-10', importe: '$ 3', medioDePago: 'EFECTIVO', alcance: 'AMBAS', adelanto: { importe: '$ 4', modo: 'PENDIENTE' } }, DANIEL)
  registrarPago(rodriguez.filaId, { fecha: '2026-08-11', importe: '$ 5', medioDePago: 'EFECTIVO' }, DANIEL)

  const resumen = cerrarMes(DANIEL)
  assert.equal(resumen.periodo, '2026-09')
  assert.equal(resumen.adelantosAcreditados, 1)
  assert.equal(resumen.adelantosPendientes, 1)

  const septiembre = planillaDelMes('2026-09')

  // ACREDITAR: nace paga, con la fecha del cobro, y el pago apunta a la fila nueva.
  const gonzalezNueva = buscar(septiembre.filas, CLIENTES.gonzalez.nombre)
  assert.equal(gonzalezNueva.pago, '2026-08-09')
  assert.equal(gonzalezNueva.pagoFecha, '2026-08-09')
  assert.equal(gonzalezNueva.pagoRegistrado, true)
  assert.equal(gonzalezNueva.pagoAdelantado, null, 'ya no hay nada esperando')
  const enLaCola = unico<string>(db, `SELECT campos_json FROM cola_sync WHERE fila_id = ?`, gonzalezNueva.filaId)
  assert.equal((JSON.parse(enLaCola) as Record<string, string>).pago, '2026-08-09', 'la fila nueva sube a la hoja ya paga')
  assert.equal(buscar(planillaDelMes('2026-08').filas, CLIENTES.gonzalez.nombre).adelantoSiguiente?.imputado, true)

  // PENDIENTE: nace sin pagar, con el adelanto a la vista, y se imputa a mano.
  const lopezNueva = buscar(septiembre.filas, CLIENTES.lopez.nombre)
  assert.equal(lopezNueva.pago, null)
  assert.equal(lopezNueva.pagoRegistrado, false, 'un adelanto pendiente no cuenta como pago de la fila')
  assert.ok(lopezNueva.pagoAdelantado, 'pero la fila lo muestra')
  assert.equal(lopezNueva.pagoAdelantado.fecha, '2026-08-10')
  assert.equal(lopezNueva.pagoAdelantado.importe, '$ 4')
  assert.equal(lopezNueva.pagoAdelantado.modo, 'PENDIENTE')
  const alerta = calcularAlerta(
    { periodo: '2026-09', diaVencimiento: lopezNueva.diaVencimientoNumero, pagada: false, formaPago: lopezNueva.formaPago, diasCobertura: 0, adelantoPendiente: true },
    '2026-09-20',
  )
  assert.equal(alerta.color, 'violeta')

  const imputada = imputarAdelanto(lopezNueva.filaId, DANIEL)
  assert.equal(imputada.pago, '2026-08-10')
  assert.equal(imputada.pagoRegistrado, true)
  assert.equal(imputada.pagoAdelantado, null)
  assert.equal(historialDeFila(lopezNueva.filaId)[0]!.campo, 'CUANDO PAGO')
  assert.throws(() => imputarAdelanto(lopezNueva.filaId, DANIEL), /ningún pago adelantado/)

  // El pago común de agosto no se arrastra, como siempre.
  const rodriguezNueva = buscar(septiembre.filas, CLIENTES.rodriguez.nombre)
  assert.equal(rodriguezNueva.pago, null)
  assert.equal(rodriguezNueva.pagoRegistrado, false)
  cerrarBaseDeDatos()
})

test('un adelanto que llega cuando la fila del mes que viene ya existe se acredita en el momento', async () => {
  await carteraDePrueba()
  // Se abre septiembre primero y se adelanta desde agosto... que ya es mes cerrado. El caso real es al
  // revés: la fila del mes que viene existe por una reactivación. Acá alcanza con probar la regla
  // sobre la fila abierta: adelantar desde septiembre a octubre (que no existe) no acredita nada.
  cerrarMes(DANIEL)
  const septiembre = planillaDelMes('2026-09')
  const fila = buscar(septiembre.filas, CLIENTES.suarez.nombre)
  const actualizada = registrarPago(fila.filaId, { fecha: '2026-09-02', importe: '$ 1', medioDePago: 'EFECTIVO', alcance: 'ADELANTADO', adelanto: { importe: '$ 2', modo: 'ACREDITAR' } }, DANIEL)
  assert.equal(actualizada.pagoRegistrado, false, 'sólo se adelantó la cuota de octubre: la de septiembre sigue sin pagar')
  assert.equal(actualizada.adelantoSiguiente?.periodo, '2026-10')
  assert.equal(actualizada.adelantoSiguiente?.imputado, false)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Corregir el DOCUMENTO desde la planilla (12.7)
// ---------------------------------------------------------------------------

test('corregir el DOCUMENTO desde la planilla rehace el normalizado y la clave del cliente', async () => {
  const db = await carteraDePrueba()
  const fila = buscar(planillaDelMes(null).filas, CLIENTES.lopez.nombre)
  assert.ok(fila.clienteId)
  const antes = db.prepare('SELECT clave, documento_normalizado FROM clientes WHERE id = ?').get(fila.clienteId) as {
    clave: string
    documento_normalizado: string | null
  }
  assert.equal(antes.clave, `DOC:${CLIENTES.lopez.dniPlano}`)

  const corregida = editarCelda(fila.filaId, 'documento', '30.111.444', DANIEL)
  assert.equal(corregida.documento, '30.111.444')

  const despues = db.prepare('SELECT clave, documento, documento_normalizado FROM clientes WHERE id = ?').get(fila.clienteId) as {
    clave: string
    documento: string
    documento_normalizado: string
  }
  assert.equal(despues.documento, '30.111.444')
  // Sin esto la búsqueda por DNI seguía encontrando el número viejo…
  assert.equal(despues.documento_normalizado, '30111444')
  // …y la próxima importación no reconocía a la persona y la duplicaba.
  assert.equal(despues.clave, 'DOC:30111444')
  assert.notEqual(despues.clave, antes.clave)

  // La copia de la fila del mes también se corrige, como siempre.
  assert.equal(unico<string>(db, 'SELECT documento FROM cuotas_mes WHERE fila_id = ?', fila.filaId), '30.111.444')
  cerrarBaseDeDatos()
})

test('ponerle desde la planilla el documento de otro cliente se rechaza, como en la ficha', async () => {
  const db = await carteraDePrueba()
  const fila = buscar(planillaDelMes(null).filas, CLIENTES.lopez.nombre)
  assert.ok(fila.clienteId)

  // La regla del pliego: el mismo documento no puede estar en dos fichas. Desde que la planilla rehace
  // el normalizado, dejarla pasar era peor que el bug viejo: la base quedaba con dos clientes con el
  // mismo DNI —un estado que la ficha no deja armar— y el alta de riesgos y siniestros engancha «el
  // primero por id», o sea el equivocado.
  assert.throws(() => editarCelda(fila.filaId, 'documento', CLIENTES.suarez.dni, DANIEL), /ya es de .*SUAREZ/i)

  // Y el rechazo no dejó nada a medio guardar: ni el documento, ni el normalizado, ni la clave.
  const despues = db.prepare('SELECT clave, documento, documento_normalizado FROM clientes WHERE id = ?').get(fila.clienteId) as {
    clave: string
    documento: string
    documento_normalizado: string
  }
  assert.equal(despues.documento, CLIENTES.lopez.dni)
  assert.equal(despues.documento_normalizado, CLIENTES.lopez.dniPlano)
  assert.equal(despues.clave, `DOC:${CLIENTES.lopez.dniPlano}`)
  assert.equal(unico<string>(db, 'SELECT documento FROM cuotas_mes WHERE fila_id = ?', fila.filaId), CLIENTES.lopez.dni)
  assert.equal(unico<number>(db, `SELECT COUNT(*) FROM clientes WHERE documento_normalizado = ?`, CLIENTES.suarez.dniPlano), 1)
  cerrarBaseDeDatos()
})

test('quitarle el documento devuelve el ancla al nombre, y corregir el nombre la mueve con él', async () => {
  const db = await carteraDePrueba()
  const fila = buscar(planillaDelMes(null).filas, CLIENTES.lopez.nombre)
  assert.ok(fila.clienteId)

  // Sin documento, la clave del cliente es su nombre (`claveDeCliente`): es el ancla con la que la
  // importación siguiente lo reconoce en la hoja.
  editarCelda(fila.filaId, 'documento', '', DANIEL)
  const sinDni = db.prepare('SELECT clave, documento_normalizado FROM clientes WHERE id = ?').get(fila.clienteId) as {
    clave: string
    documento_normalizado: string | null
  }
  assert.equal(sinDni.documento_normalizado, null)
  assert.equal(sinDni.clave, `NOM:${CLIENTES.lopez.nombre}`)

  // Y si a ese cliente le corrigen el nombre, la clave tiene que acompañar: si no, se queda apuntando a
  // un nombre que ya no está en ninguna parte y la importación siguiente lo carga otra vez, duplicado.
  editarCelda(fila.filaId, 'nombre', 'LOPEZ CARLOS ALBERTO JOSE', DANIEL)
  const conOtroNombre = db.prepare('SELECT clave, nombre FROM clientes WHERE id = ?').get(fila.clienteId) as {
    clave: string
    nombre: string
  }
  assert.equal(conOtroNombre.nombre, 'LOPEZ CARLOS ALBERTO JOSE')
  assert.equal(conOtroNombre.clave, 'NOM:LOPEZ CARLOS ALBERTO JOSE')

  // Al que se identifica por documento, en cambio, cambiarle el nombre no le toca la clave: el nombre
  // no entra en 'DOC:<número>'.
  const conDni = buscar(planillaDelMes(null).filas, CLIENTES.suarez.nombre)
  editarCelda(conDni.filaId, 'nombre', 'SUAREZ NATALIA BEATRIZ', DANIEL)
  assert.equal(
    unico<string>(db, 'SELECT clave FROM clientes WHERE id = ?', conDni.clienteId!),
    `DOC:${CLIENTES.suarez.dniPlano}`,
  )
  cerrarBaseDeDatos()
})

test('si la clave que le tocaría ya está ocupada, el dato se guarda igual y la clave no se mueve', async () => {
  const db = await carteraDePrueba()
  // Dos clientes sin documento que se llaman igual: el segundo no puede quedarse con la clave del
  // primero —la columna es única— y perder el ancla es preferible a no poder guardar la corrección.
  const lopez = buscar(planillaDelMes(null).filas, CLIENTES.lopez.nombre)
  editarCelda(lopez.filaId, 'documento', '', DANIEL)
  assert.equal(unico<string>(db, 'SELECT clave FROM clientes WHERE id = ?', lopez.clienteId!), `NOM:${CLIENTES.lopez.nombre}`)

  const rodriguez = buscar(planillaDelMes(null).filas, CLIENTES.rodriguez.nombre)
  editarCelda(rodriguez.filaId, 'documento', '', DANIEL)
  const corregida = editarCelda(rodriguez.filaId, 'nombre', CLIENTES.lopez.nombre, DANIEL)
  assert.equal(corregida.nombre, CLIENTES.lopez.nombre, 'el nombre se guarda igual')
  assert.equal(
    unico<string>(db, 'SELECT clave FROM clientes WHERE id = ?', rodriguez.clienteId!),
    `NOM:${CLIENTES.rodriguez.nombre}`,
    'la clave se queda donde estaba',
  )
  cerrarBaseDeDatos()
})
