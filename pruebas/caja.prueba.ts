// La caja chica del mostrador: la mitad de abajo de la planilla de caja de la agencia.
//
// La prueba grande reproduce un día real de la planilla de septiembre de 2026 (la hoja «0209»): se
// abre con $36.600 de cambio, se cobra una cuota de $88.300 en efectivo con un billete de $100.000
// que va entero a la caja fuerte, y al cerrar quedan $24.900 en el cajón. Si el arqueo de la
// aplicación no da lo mismo que la planilla escrita a mano, es que la cuenta está mal.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import {
  cajaDelDia,
  cargarMovimientoDeCaja,
  hojaDeLaCaja,
  numeroDeTicketDelPago,
  quitarMovimientoDeCaja,
  registrarPagoManual,
  revisarPago,
} from '../src/main/servicios/cobranzas'
import { filaIdDelMovimiento, grupoDelMedio } from '../src/main/servicios/caja'
import type { DatosDePagoManual, SesionUsuario } from '../src/shared/tipos'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { filas, importar } from './ayuda'

const DIA = '2026-09-02'
const DIA_ANTERIOR = '2026-09-01'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

const BRENDA: SesionUsuario = {
  id: 2,
  nombre: 'Brenda López',
  usuario: 'brenda',
  rol: 'EMPLEADO',
  sucursal: { id: 2, nombre: 'Dock Sud' },
  debeCambiarClave: false,
}

const MILAGROS: SesionUsuario = {
  id: 3,
  nombre: 'Milagros',
  usuario: 'milagros',
  rol: 'EMPLEADO',
  sucursal: { id: 3, nombre: 'Lanús' },
  debeCambiarClave: false,
}

async function cajaDePrueba(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(construirHojaDePrueba()))
  const alta = db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES (@id, @nombre, @usuario, 'sin-clave', @rol, (SELECT id FROM sucursales WHERE nombre = @sucursal), 1, 0)`,
  )
  for (const persona of [BRENDA, MILAGROS]) {
    alta.run({ id: persona.id, nombre: persona.nombre, usuario: persona.usuario, rol: persona.rol, sucursal: persona.sucursal.nombre })
  }
  return db
}

/** Un cobro suelto en el mostrador de Dock Sud, que es el que lleva la caja de estas pruebas. */
function cobrar(
  nombre: string,
  importe: string,
  medio: string,
  extra: Partial<DatosDePagoManual> = {},
  actor: SesionUsuario = BRENDA,
  fecha = DIA,
): number {
  const { pagoId } = registrarPagoManual(
    {
      cuotaFilaId: null,
      clienteId: null,
      polizaId: null,
      clienteNombre: nombre,
      documento: '',
      compania: 'FEDERACION',
      numeroPoliza: '10697595',
      patente: 'AA123BB',
      fecha,
      importe,
      medioDePago: medio,
      sucursal: 'Dock Sud',
      observaciones: '',
      ...extra,
    },
    actor,
  )
  return pagoId
}

function arqueoDe(fecha = DIA) {
  const arqueo = cajaDelDia(fecha, ['Dock Sud'], BRENDA).arqueo
  assert.ok(arqueo, 'con una sola sucursal a la vista siempre hay arqueo')
  return arqueo
}

// ---------------------------------------------------------------------------
// Las cuentas del día
// ---------------------------------------------------------------------------

test('el arqueo da lo mismo que la planilla escrita a mano: apertura, cobro en efectivo, vuelto y caja fuerte', async () => {
  await cajaDePrueba()
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '36600' }, BRENDA)
  cobrar('BARI SEBASTIAN', '88300', 'EFECTIVO')
  // Pagó con un billete de $100.000: el billete entero baja a la caja fuerte y el vuelto sale del cajón.
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'CAJA_FUERTE', detalle: 'billete de 100.000', importe: '100000' }, BRENDA)

  const arqueo = arqueoDe()
  assert.equal(arqueo.apertura, 36600)
  assert.equal(arqueo.efectivo, 88300)
  assert.equal(arqueo.aLaCajaFuerte, 100000)
  assert.equal(arqueo.esperado, 24900, 'lo que la planilla escribe a mano en CAJA CHICA')
  assert.equal(arqueo.debe, 124900)
  assert.equal(arqueo.haber, 124900)
  assert.equal(arqueo.descuadre, 0, 'el DEBE y el HABER de la planilla dan lo mismo')
  assert.equal(arqueo.contado, null, 'el día todavía no se cerró')
  assert.equal(arqueo.diferencia, null)
  cerrarBaseDeDatos()
})

test('cada medio de pago cae en la columna de la planilla que le toca', async () => {
  await cajaDePrueba()
  cobrar('EN EFECTIVO', '1000', 'EFECTIVO')
  cobrar('CON POSNET', '2000', 'TARJETA')
  cobrar('POR MERCADO PAGO', '4000', 'MERCADO PAGO')
  cobrar('POR TRANSFERENCIA', '8000', 'TRANSFERENCIA')
  cobrar('CON CUPONERA', '16000', 'CUPONERA')

  const arqueo = arqueoDe()
  assert.equal(arqueo.efectivo, 1000)
  assert.equal(arqueo.posnet, 2000, 'la columna POSNET MP son las tarjetas')
  assert.equal(arqueo.transferencia, 12000, 'la columna MP junta Mercado Pago y las transferencias')
  assert.equal(arqueo.otros, 16000, 'lo que no toca el cajón ni el posnet va aparte')
  assert.equal(arqueo.cobrado, 31000)
  // Los medios que no son plata del cajón suman a los dos lados: la cuenta cierra igual.
  assert.equal(arqueo.descuadre, 0)

  // El débito automático lleva la palabra «débito» y NO es un posnet: es plata que descuenta la compañía.
  assert.equal(grupoDelMedio('DEBITO AUTOMATICO'), 'OTRO')
  assert.equal(grupoDelMedio('Tarjeta de crédito'), 'POSNET')
  assert.equal(grupoDelMedio('CBU'), 'TRANSFERENCIA')
  assert.equal(grupoDelMedio(null), 'OTRO')
  cerrarBaseDeDatos()
})

test('un cobro imputado no suma al arqueo: la plata todavía no entró', async () => {
  await cajaDePrueba()
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '10000' }, BRENDA)
  cobrar('PAGA DESPUES', '5000', 'EFECTIVO', { estadoCobro: 'IMPUTADO' })

  const arqueo = arqueoDe()
  assert.equal(arqueo.cobrado, 0)
  assert.equal(arqueo.efectivo, 0)
  assert.equal(arqueo.esperado, 10000)
  assert.equal(arqueo.descuadre, 0)
  cerrarBaseDeDatos()
})

test('un gasto sale de la caja chica y se carga con el concepto al lado', async () => {
  await cajaDePrueba()
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '24900' }, BRENDA)
  const caja = cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'GASTO', detalle: 'limpieza', importe: '4.600' }, BRENDA)

  assert.equal(caja.arqueo?.gastos, 4600)
  assert.equal(caja.arqueo?.esperado, 20300)
  const gasto = caja.arqueo?.movimientos.find((movimiento) => movimiento.tipo === 'GASTO')
  assert.equal(gasto?.detalle, 'limpieza')
  assert.equal(gasto?.usuarioNombre, 'Brenda López')

  assert.throws(
    () => cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'GASTO', detalle: '', importe: '1000' }, BRENDA),
    /de qué es el gasto/,
    'un gasto sin concepto no dice nada dentro de un mes',
  )
  assert.throws(
    () => cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'GASTO', detalle: 'nafta', importe: 'lo que sea' }, BRENDA),
    /Poné un importe/,
  )

  // Sacar el gasto lo devuelve al cajón.
  const sinGasto = quitarMovimientoDeCaja(gasto!.id, BRENDA)
  assert.equal(sinGasto.arqueo?.gastos, 0)
  assert.equal(sinGasto.arqueo?.esperado, 24900)
  cerrarBaseDeDatos()
})

test('una observación queda anotada en la caja pero no toca ninguna cuenta', async () => {
  await cajaDePrueba()
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '24900' }, BRENDA)
  cargarMovimientoDeCaja(
    { fecha: DIA, sucursal: 'Dock Sud', tipo: 'CAJA_FUERTE', detalle: 'Dani se llevó $740.000', importe: '740000' },
    BRENDA,
  )
  const antes = arqueoDe()

  const caja = cargarMovimientoDeCaja(
    { fecha: DIA, sucursal: 'Dock Sud', tipo: 'OBSERVACION', detalle: 'Dani se llevó la plata a las 20:51', importe: '' },
    BRENDA,
  )

  assert.equal(caja.arqueo?.esperado, antes.esperado, 'la observación no cambia lo que debería quedar en el cajón')
  assert.equal(caja.arqueo?.debe, antes.debe)
  assert.equal(caja.arqueo?.haber, antes.haber)
  assert.equal(caja.arqueo?.descuadre, 0)
  const observacion = caja.arqueo?.movimientos.find((movimiento) => movimiento.tipo === 'OBSERVACION')
  assert.equal(observacion?.detalle, 'Dani se llevó la plata a las 20:51')
  assert.equal(observacion?.importe, 0)

  assert.throws(
    () => cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'OBSERVACION', detalle: '', importe: '' }, BRENDA),
    /Escribí la observación/,
  )

  // Sacarla no cambia ninguna cuenta tampoco.
  const sinObservacion = quitarMovimientoDeCaja(observacion!.id, BRENDA)
  assert.equal(sinObservacion.arqueo?.esperado, antes.esperado)
  cerrarBaseDeDatos()
})

test('el cierre de un día es la caja chica con la que abre el siguiente', async () => {
  await cajaDePrueba()
  cargarMovimientoDeCaja({ fecha: DIA_ANTERIOR, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '36600' }, BRENDA)
  cargarMovimientoDeCaja({ fecha: DIA_ANTERIOR, sucursal: 'Dock Sud', tipo: 'CIERRE', detalle: '', importe: '24900' }, BRENDA)

  const cerrado = arqueoDe(DIA_ANTERIOR)
  assert.equal(cerrado.contado, 24900)
  assert.equal(cerrado.diferencia, -11700, 'se contó menos de lo que decía la cuenta: la diferencia queda a la vista')

  const hoy = arqueoDe(DIA)
  assert.equal(hoy.apertura, 24900, 'el día abre con lo que quedó contado')
  assert.equal(hoy.aperturaCargada, false)
  assert.equal(hoy.aperturaHeredadaDe, DIA_ANTERIOR)

  // Y si se carga a mano, manda la cargada.
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '30000' }, BRENDA)
  const conApertura = arqueoDe(DIA)
  assert.equal(conApertura.apertura, 30000)
  assert.equal(conApertura.aperturaCargada, true)
  assert.equal(conApertura.aperturaHeredadaDe, null)
  cerrarBaseDeDatos()
})

test('la apertura y el cierre son uno solo por día y mostrador: cargarlos de nuevo corrige', async () => {
  const db = await cajaDePrueba()
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '20000' }, BRENDA)
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '36600' }, DANIEL)

  const aperturas = filas(db, `SELECT * FROM caja_movimientos WHERE tipo = 'APERTURA'`)
  assert.equal(aperturas.length, 1, 'no hay dos aperturas del mismo día')
  assert.equal(arqueoDe().apertura, 36600)
  // El _ID se arma con el día y el mostrador: dos computadoras escriben la MISMA fila de la hoja.
  assert.equal(aperturas[0]!.fila_id, filaIdDelMovimiento(DIA, 'Dock Sud', 'APERTURA'))
  assert.equal(aperturas[0]!.fila_id, 'CAJA:2026-09-02:DOCKSUD:APERTURA')

  // Los gastos, en cambio, son todos los que haga falta.
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'GASTO', detalle: 'nafta', importe: '1000' }, BRENDA)
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'GASTO', detalle: 'limpieza', importe: '2000' }, BRENDA)
  assert.equal(arqueoDe().gastos, 3000)
  cerrarBaseDeDatos()
})

test('la caja chica de cada mostrador es la suya: un empleado no toca la de al lado', async () => {
  await cajaDePrueba()
  assert.throws(
    () => cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Lanús', tipo: 'APERTURA', detalle: '', importe: '10000' }, BRENDA),
    /La caja de Lanús/,
  )
  // Un administrador sí: es quien mira la agencia entera.
  const caja = cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Lanús', tipo: 'APERTURA', detalle: '', importe: '10000' }, DANIEL)
  assert.equal(caja.arqueo?.sucursal, 'Lanús')
  assert.equal(caja.arqueo?.apertura, 10000)

  // Y mirando varias sucursales a la vez no hay caja chica que mostrar: es el cajón de un mostrador.
  assert.equal(cajaDelDia(DIA, [], DANIEL).arqueo, null)
  assert.equal(cajaDelDia(DIA, ['Lanús', 'Dock Sud'], DANIEL).arqueo, null)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Las dos columnas de la planilla que faltaban en el pago
// ---------------------------------------------------------------------------

test('el tilde de revisión y el número de ticket quedan en el pago y viajan a la hoja', async () => {
  const db = await cajaDePrueba()
  const pagoId = cobrar('LUNA GUSTAVO RAMON', '15100', 'MERCADO PAGO')

  const revisada = revisarPago(pagoId, true, BRENDA)
  const pago = revisada.pagos.find((p) => p.id === pagoId)
  assert.equal(pago?.revisado, true)
  assert.equal(pago?.revisadoPor, 'Brenda López')

  const conTicket = numeroDeTicketDelPago(pagoId, '000123', BRENDA)
  assert.equal(conTicket.pagos.find((p) => p.id === pagoId)?.numeroTicket, '000123')

  // Las dos van a la hoja por APP PAGOS, para que la otra computadora las vea.
  const encolado = filas<{ campos_json: string }>(db, `SELECT campos_json FROM cola_sync WHERE fila_id = (SELECT fila_id FROM pagos WHERE id = ?)`, pagoId)
  const campos = Object.assign({}, ...encolado.map((entrada) => JSON.parse(entrada.campos_json) as Record<string, string>)) as Record<string, string>
  assert.equal(campos.revisado, 'SI')
  assert.equal(campos.ticket, '000123')

  // Y se puede sacar el tilde: la celda viaja vacía, si no la otra computadora seguiría viéndolo.
  const sinTilde = revisarPago(pagoId, false, BRENDA)
  assert.equal(sinTilde.pagos.find((p) => p.id === pagoId)?.revisado, false)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// La planilla que se exporta
// ---------------------------------------------------------------------------

test('la planilla exportada tiene la forma de la de la agencia, con el resumen de abajo', async () => {
  await cajaDePrueba()
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'APERTURA', detalle: '', importe: '36600' }, BRENDA)
  const pagoId = cobrar('BARI SEBASTIAN', '88300', 'EFECTIVO')
  numeroDeTicketDelPago(pagoId, '000123', BRENDA)
  revisarPago(pagoId, true, BRENDA)
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'CAJA_FUERTE', detalle: 'billete de 100.000', importe: '100000' }, BRENDA)
  cargarMovimientoDeCaja({ fecha: DIA, sucursal: 'Dock Sud', tipo: 'GASTO', detalle: 'limpieza', importe: '4600' }, BRENDA)

  const hoja = hojaDeLaCaja(cajaDelDia(DIA, ['Dock Sud'], BRENDA))
  assert.equal(hoja.nombre, '0209', 'la pestaña se llama como las de la agencia')
  const buscar = (texto: string) => hoja.filas.find((fila) => String(fila[2] ?? '') === texto)

  assert.equal(buscar('CAJA CHICA AL ABRIR')?.[3], 36600, 'la apertura va en la fila 2, en el DEBE')
  const cobro = buscar('BARI SEBASTIAN')
  assert.equal(cobro?.[0], '000123', 'la columna A es el número de ticket')
  assert.equal(cobro?.[3], 88300)
  assert.equal(cobro?.[7], '✔', 'la columna H es el tilde de revisión')
  assert.equal(buscar('A LA CAJA FUERTE')?.[4], 100000, 'lo que bajó a la caja fuerte va en el HABER')
  assert.equal(buscar('GASTOS')?.[4], 4600)
  assert.equal(buscar('CAJA CHICA')?.[4], 20300, 'lo que debería quedar en el cajón')

  const total = buscar('TOTAL')
  assert.equal(total?.[3], 124900)
  assert.equal(total?.[4], 124900, 'el DEBE y el HABER cierran, como en la planilla')
  cerrarBaseDeDatos()
})
