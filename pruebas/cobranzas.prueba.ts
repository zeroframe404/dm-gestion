// Cobranzas de punta a punta: se importa la hoja simulada y se trabaja como en el mostrador —cobrar,
// mirar la caja del día, perseguir la mora, rendir el mes contra las compañías y ver la comisión.
import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarMigraciones, MIGRACIONES } from '../src/main/db/migraciones'
import { sembrarDatosIniciales } from '../src/main/db/semilla'
import { planillaDelMes, registrarPago } from '../src/main/servicios/cartera'
import {
  avisarMora,
  cajaDelDia,
  cambiarResultado,
  comisiones,
  csvDeLaCaja,
  imputados,
  mora,
  registrarPagoManual,
} from '../src/main/servicios/cobranzas'
import { editarCompania, listarCompanias } from '../src/main/servicios/companias'
import { hojaDeImputados, normalizarResultado } from '../src/main/servicios/pagos'
import { historialDeFila } from '../src/main/servicios/historial'
import { SUCURSALES } from '../src/shared/sucursales'
import type { FilaCartera, FiltrosMora, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { filas, importar } from './ayuda'

/** El día en que corren las pruebas: la hoja simulada llega hasta AGOSTO de 2026. */
const HOY = '2026-08-20'
const DIA_DE_CAJA = '2026-08-19'

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

const SIN_FILTROS: FiltrosMora = { busqueda: '', sucursales: [], companias: [], rangos: [], incluirDebito: false }

async function cobranzasDePrueba(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  await importar(db, new HojaSimulada(construirHojaDePrueba()))
  // La semilla sólo trae al usuario inicial y los pagos apuntan a quien cobró: para probar la caja de
  // otra sucursal hace falta una segunda persona. La clave no se usa: acá nadie inicia sesión.
  db.prepare(
    `INSERT INTO usuarios (id, nombre, usuario, clave_hash, rol, sucursal_id, activo, debe_cambiar_clave)
     VALUES (@id, @nombre, @usuario, 'sin-clave', @rol, (SELECT id FROM sucursales WHERE nombre = @sucursal), 1, 0)`,
  ).run({ id: BRENDA.id, nombre: BRENDA.nombre, usuario: BRENDA.usuario, rol: BRENDA.rol, sucursal: BRENDA.sucursal.nombre })
  return db
}

function buscar(nombre: string): FilaCartera {
  const fila = planillaDelMes(null).filas.find((f) => f.nombre === nombre)
  if (!fila) throw new Error(`No está «${nombre}» en la planilla`)
  return fila
}

/** Las entradas de la cola de subida que apuntan a la pestaña IMPUTADOS. */
function colaDeImputados(db: BaseDeDatos) {
  return filas<{ operacion: string; fila_id: string; campos_json: string }>(
    db,
    `SELECT operacion, fila_id, campos_json FROM cola_sync WHERE pestana = 'IMPUTADOS' ORDER BY id`,
  )
}

// ---------------------------------------------------------------------------
// Caja del día
// ---------------------------------------------------------------------------

test('tres pagos del día suman bien por medio de pago', async () => {
  await cobranzasDePrueba()

  registrarPago(buscar(CLIENTES.gonzalez.nombre).filaId, { fecha: DIA_DE_CAJA, importe: '$ 10.000', medioDePago: 'EFECTIVO' }, DANIEL)
  registrarPago(buscar(CLIENTES.perezAuto.nombre).filaId, { fecha: DIA_DE_CAJA, importe: '$ 5.500,50', medioDePago: 'EFECTIVO' }, DANIEL)
  registrarPago(buscar(CLIENTES.rodriguez.nombre).filaId, { fecha: DIA_DE_CAJA, importe: '$ 20.000', medioDePago: 'TRANSFERENCIA' }, DANIEL)

  const caja = cajaDelDia(DIA_DE_CAJA, '')
  assert.equal(caja.fecha, DIA_DE_CAJA)
  assert.equal(caja.pagos.length, 3)
  assert.equal(caja.total, 35_500.5)
  assert.equal(caja.sinImporte, 0)

  const porMedio = new Map(caja.totalesPorMedio.map((t) => [t.medio, t]))
  assert.equal(porMedio.get('TRANSFERENCIA')?.total, 20_000)
  assert.equal(porMedio.get('TRANSFERENCIA')?.pagos, 1)
  assert.equal(porMedio.get('EFECTIVO')?.total, 15_500.5)
  assert.equal(porMedio.get('EFECTIVO')?.pagos, 2)
  cerrarBaseDeDatos()
})

test('cada pago de la caja dice la hora, quién cobró y en qué sucursal', async () => {
  await cobranzasDePrueba()
  registrarPago(buscar(CLIENTES.gonzalez.nombre).filaId, { fecha: DIA_DE_CAJA, importe: '$ 10.000', medioDePago: 'EFECTIVO' }, BRENDA)

  const caja = cajaDelDia(DIA_DE_CAJA, '')
  const pago = caja.pagos[0]!
  assert.equal(pago.clienteNombre, CLIENTES.gonzalez.nombre)
  assert.equal(pago.numeroPoliza, CLIENTES.gonzalez.poliza)
  assert.equal(pago.usuarioNombre, 'Brenda López')
  assert.equal(pago.sucursal, 'Dock Sud', 'la caja es del mostrador donde entró la plata, no de la sucursal del cliente')
  assert.match(pago.hora ?? '', /^\d{2}:\d{2}$/)
  assert.equal(pago.hechoEnLaApp, true)

  // Y filtrando por otra sucursal ese pago no aparece.
  assert.equal(cajaDelDia(DIA_DE_CAJA, 'Lanús').pagos.length, 0)
  assert.equal(cajaDelDia(DIA_DE_CAJA, 'Dock Sud').pagos.length, 1)
  cerrarBaseDeDatos()
})

test('el alta manual sobre una cuota del mes deja la fila paga y no duplica el pago', async () => {
  const db = await cobranzasDePrueba()
  const fila = buscar(CLIENTES.lopez.nombre)

  const primera = registrarPagoManual(
    {
      cuotaFilaId: fila.filaId,
      clienteId: fila.clienteId,
      polizaId: fila.polizaId,
      clienteNombre: fila.nombre ?? '',
      documento: fila.documento ?? '',
      compania: fila.compania ?? '',
      numeroPoliza: fila.numeroPoliza ?? '',
      patente: fila.patente ?? '',
      fecha: DIA_DE_CAJA,
      importe: '$ 21.840',
      medioDePago: 'MERCADO PAGO',
      sucursal: 'Lanús',
      observaciones: '',
    },
    DANIEL,
  )
  assert.equal(primera.caja.pagos.length, 1)
  assert.equal(buscar(CLIENTES.lopez.nombre).pagoRegistrado, true)

  // La misma cuota cobrada de nuevo corrige el pago; no aparece dos veces en la caja.
  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 22.000', medioDePago: 'EFECTIVO' }, DANIEL)
  const caja = cajaDelDia(DIA_DE_CAJA, '')
  assert.equal(caja.pagos.length, 1)
  assert.equal(caja.total, 22_000)
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM pagos WHERE hecho_en_la_app = 1`).get() as { n: number }).n, 1)
  cerrarBaseDeDatos()
})

test('un pago suelto se puede cargar sin cliente de la base', async () => {
  await cobranzasDePrueba()
  const resultado = registrarPagoManual(
    {
      cuotaFilaId: null,
      clienteId: null,
      polizaId: null,
      clienteNombre: 'QUIROGA MARTA',
      documento: '18.222.333',
      compania: 'SANCOR',
      numeroPoliza: 'CF-9001',
      patente: '',
      fecha: DIA_DE_CAJA,
      importe: '8.900',
      medioDePago: 'EFECTIVO',
      sucursal: 'Daniel',
      observaciones: 'COMBINADO FAMILIAR',
    },
    DANIEL,
  )
  const pago = resultado.caja.pagos.find((p) => p.clienteNombre === 'QUIROGA MARTA')
  assert.ok(pago, 'el pago suelto tiene que estar en la caja')
  assert.equal(pago.importeMonto, 8900)
  assert.equal(pago.clienteId, null)
  assert.equal(pago.periodo, '2026-08')

  // Sin importe o con un importe que no es número, no se guarda.
  assert.throws(
    () =>
      registrarPagoManual(
        { cuotaFilaId: null, clienteId: null, polizaId: null, clienteNombre: 'OTRO', documento: '', compania: '', numeroPoliza: '', patente: '', fecha: DIA_DE_CAJA, importe: '', medioDePago: '', sucursal: 'Daniel', observaciones: '' },
        DANIEL,
      ),
    /importe/,
  )
  assert.throws(
    () =>
      registrarPagoManual(
        { cuotaFilaId: null, clienteId: null, polizaId: null, clienteNombre: 'OTRO', documento: '', compania: '', numeroPoliza: '', patente: '', fecha: DIA_DE_CAJA, importe: 'A/D', medioDePago: '', sucursal: 'Daniel', observaciones: '' },
        DANIEL,
      ),
    /no es un importe/,
  )
  cerrarBaseDeDatos()
})

test('«Exportar el día» arma un CSV con los pagos y los totales por medio', async () => {
  await cobranzasDePrueba()
  registrarPago(buscar(CLIENTES.gonzalez.nombre).filaId, { fecha: DIA_DE_CAJA, importe: '$ 10.000', medioDePago: 'EFECTIVO' }, DANIEL)
  registrarPago(buscar(CLIENTES.rodriguez.nombre).filaId, { fecha: DIA_DE_CAJA, importe: '$ 20.000', medioDePago: 'TRANSFERENCIA' }, DANIEL)

  const archivo = csvDeLaCaja(DIA_DE_CAJA, '')
  assert.equal(archivo.nombre, `caja-${DIA_DE_CAJA}.csv`)
  // El BOM del principio es lo que hace que Excel lo abra en UTF-8.
  assert.ok(archivo.contenido.startsWith('﻿'))
  assert.match(archivo.contenido, /"Hora";"Cliente";"DNI\/CUIT"/)
  assert.match(archivo.contenido, new RegExp(CLIENTES.gonzalez.nombre))
  assert.match(archivo.contenido, /"EFECTIVO";1;10000,00/)
  assert.match(archivo.contenido, /"TOTAL";2;30000,00/)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Mora
// ---------------------------------------------------------------------------

test('la mora lista cuotas realmente vencidas, con sus días de atraso', async () => {
  await cobranzasDePrueba()
  const listado = mora(SIN_FILTROS, HOY)

  assert.ok(listado.total > 0, 'la hoja de prueba deja cuotas impagas de meses anteriores')
  for (const fila of listado.filas) {
    assert.ok(fila.diasDeAtraso >= 1, `«${fila.nombre}» no está vencida`)
    assert.ok(fila.vencimiento < HOY, 'el vencimiento tiene que haber pasado')
    assert.equal(fila.cuota !== null || fila.cuotaMonto !== null, true)
  }
  // Y viene ordenada de la más atrasada a la más nueva.
  const atrasos = listado.filas.map((f) => f.diasDeAtraso)
  assert.deepEqual(atrasos, [...atrasos].sort((a, b) => b - a))

  // Cobrarle a alguien lo saca de la mora en el acto.
  const deudor = buscar(CLIENTES.rodriguez.nombre)
  assert.ok(listado.filas.some((f) => f.filaId === deudor.filaId), 'antes de pagar está en mora')
  registrarPago(deudor.filaId, { fecha: HOY, importe: '$ 1', medioDePago: 'EFECTIVO' }, DANIEL)
  assert.equal(mora(SIN_FILTROS, HOY).filas.some((f) => f.filaId === deudor.filaId), false)
  cerrarBaseDeDatos()
})

test('los rangos de atraso reparten las cuotas en 1-7, 8-30 y +30 días', async () => {
  await cobranzasDePrueba()
  const listado = mora(SIN_FILTROS, HOY)

  const suma = listado.porRango['1-7'] + listado.porRango['8-30'] + listado.porRango['+30']
  assert.equal(suma, listado.filas.length)
  assert.ok(listado.porRango['+30'] > 0, 'las cuotas de los meses viejos pasan los 30 días')

  for (const rango of ['1-7', '8-30', '+30'] as const) {
    const filtrado = mora({ ...SIN_FILTROS, rangos: [rango] }, HOY)
    assert.equal(filtrado.filas.length, listado.porRango[rango])
    for (const fila of filtrado.filas) assert.equal(fila.rango, rango)
  }
  cerrarBaseDeDatos()
})

test('el débito automático no se persigue: queda fuera salvo que se lo pida', async () => {
  await cobranzasDePrueba()
  const conDebito = mora({ ...SIN_FILTROS, incluirDebito: true }, HOY)
  const sinDebito = mora(SIN_FILTROS, HOY)

  // Martínez debe agosto pero paga por DEBITO: es el débito que no entró, no alguien a quien llamar.
  assert.equal(sinDebito.filas.some((f) => f.nombre === CLIENTES.martinez.nombre), false)
  assert.equal(conDebito.filas.some((f) => f.nombre === CLIENTES.martinez.nombre), true)
  assert.ok(conDebito.total > sinDebito.total)
  cerrarBaseDeDatos()
})

test('los filtros de la mora acotan por sucursal y por compañía', async () => {
  await cobranzasDePrueba()
  const listado = mora(SIN_FILTROS, HOY)
  const compania = listado.companias[0]!
  const porCompania = mora({ ...SIN_FILTROS, companias: [compania] }, HOY)
  assert.ok(porCompania.filas.length > 0)
  for (const fila of porCompania.filas) assert.equal(fila.compania, compania)

  // La sucursal a probar sale de una cuota de verdad y no de `sucursales[0]`: el desplegable ofrece
  // siempre las cuatro de la agencia, así que la primera de la lista puede no deber nada y el filtro
  // devolvería vacío —la prueba pasaría sin haber probado nada—.
  const sucursal = listado.filas.find((f) => f.sucursal)!.sucursal!
  const porSucursal = mora({ ...SIN_FILTROS, sucursales: [sucursal] }, HOY)
  assert.ok(porSucursal.filas.length > 0, 'filtrar por una sucursal que sí debe trae sus cuotas')
  for (const fila of porSucursal.filas) assert.equal(fila.sucursal, sucursal)

  // Y la lista ofrece las cuatro, deban o no: la sucursal sin mora tiene que poder elegirse igual.
  for (const deLaAgencia of SUCURSALES) assert.ok(listado.sucursales.includes(deLaAgencia), `«${deLaAgencia}» está en el filtro`)

  // La búsqueda encuentra por póliza aunque se escriba con espacios.
  const alguna = listado.filas.find((f) => f.numeroPoliza)!
  const buscada = mora({ ...SIN_FILTROS, busqueda: ` ${alguna.numeroPoliza} ` }, HOY)
  assert.ok(buscada.filas.some((f) => f.filaId === alguna.filaId))
  cerrarBaseDeDatos()
})

test('«Avisar» desde la mora arma el WhatsApp y sólo marca la fila si el mes está abierto', async () => {
  await cobranzasDePrueba()
  const listado = mora(SIN_FILTROS, HOY)

  const delMesAbierto = listado.filas.find((f) => f.mesAbierto && f.telefono)
  assert.ok(delMesAbierto, 'tiene que haber una cuota impaga de agosto con teléfono')
  const aviso = avisarMora(delMesAbierto.filaId, DANIEL, HOY)
  assert.match(aviso.url, /^https:\/\/wa\.me\/549\d+\?text=/)
  assert.equal(aviso.marcada, true)
  assert.equal(aviso.fila.aviso, 'ENVIADO')

  const deMesCerrado = listado.filas.find((f) => !f.mesAbierto && f.telefono)
  assert.ok(deMesCerrado, 'tiene que haber cuotas impagas de meses anteriores')
  const avisoViejo = avisarMora(deMesCerrado.filaId, DANIEL, HOY)
  assert.equal(avisoViejo.marcada, false, 'un mes cerrado no se toca')
  assert.notEqual(avisoViejo.fila.aviso, 'ENVIADO')
  // Pero queda constancia de que se avisó.
  const historial = historialDeFila(deMesCerrado.filaId)
  assert.equal(historial[0]!.campo, 'OB. AVISOS')
  assert.match(historial[0]!.valorNuevo ?? '', /AVISADO POR MORA/)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Imputados: la rendición mensual
// ---------------------------------------------------------------------------

test('la rendición trae los pagos del mes con su RESULTADO, normalizado', async () => {
  await cobranzasDePrueba()
  const rendicion = imputados('2026-08', [])

  assert.equal(rendicion.periodo, '2026-08')
  assert.equal(rendicion.pagos.length, 3, 'los tres pagos de la pestaña IMPUTADOS')
  assert.equal(rendicion.avisoDeSincronizacion, null, 'la hoja de prueba sí tiene columna RESULTADO')

  const porPoliza = new Map(rendicion.pagos.map((p) => [p.numeroPoliza, p]))
  assert.equal(porPoliza.get('1234567')?.resultado, 'IMPUTADO')
  assert.equal(porPoliza.get('998877')?.resultado, '')
  // «revisar» en minúscula es REVISAR.
  assert.equal(porPoliza.get('777111')?.resultado, 'REVISAR')
  assert.equal(rendicion.pendientes, 1)
  assert.equal(rendicion.contadores.IMPUTADO, 1)
  assert.equal(rendicion.contadores.REVISAR, 1)

  // El filtro por compañía deja sólo las de esa compañía.
  const soloSancor = imputados('2026-08', ['SANCOR'])
  assert.equal(soloSancor.pagos.length, 2)
  for (const pago of soloSancor.pagos) assert.equal(pago.compania, 'SANCOR')
  cerrarBaseDeDatos()
})

test('marcar RESULTADO=IMPUTADO lo guarda y lo manda a la hoja', async () => {
  const db = await cobranzasDePrueba()
  const rendicion = imputados('2026-08', [])
  const pendiente = rendicion.pagos.find((p) => p.resultado === '')!

  const despues = cambiarResultado(pendiente.id, 'IMPUTADO', [], DANIEL)
  assert.equal(despues.pendientes, 0)
  assert.equal(despues.contadores.IMPUTADO, 2)
  assert.equal(despues.pagos.find((p) => p.id === pendiente.id)?.resultado, 'IMPUTADO')

  // Y quedó encolado contra la pestaña IMPUTADOS de la hoja.
  const cola = colaDeImputados(db).filter((e) => e.fila_id === pendiente.filaId)
  assert.equal(cola.length, 1)
  assert.equal(cola[0]!.operacion, 'actualizar')
  assert.deepEqual(JSON.parse(cola[0]!.campos_json), { resultado: 'IMPUTADO' })

  // El cambio queda en el historial con quién lo hizo.
  const historial = historialDeFila(pendiente.filaId)
  assert.equal(historial[0]!.campo, 'RESULTADO')
  assert.equal(historial[0]!.valorNuevo, 'IMPUTADO')
  assert.equal(historial[0]!.usuarioNombre, 'Daniel Martínez')

  // Volver a marcar lo mismo no encola nada nuevo.
  cambiarResultado(pendiente.id, 'IMPUTADO', [], DANIEL)
  assert.equal(colaDeImputados(db).filter((e) => e.fila_id === pendiente.filaId).length, 1)
  cerrarBaseDeDatos()
})

test('un pago cobrado en la aplicación se suma a la rendición y viaja a la hoja', async () => {
  const db = await cobranzasDePrueba()
  const fila = buscar(CLIENTES.suarez.nombre)
  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 28.000', medioDePago: 'EFECTIVO' }, DANIEL)

  const rendicion = imputados('2026-08', [])
  const nuevo = rendicion.pagos.find((p) => p.numeroPoliza === CLIENTES.suarez.poliza)
  assert.ok(nuevo, 'el cobro del mostrador tiene que aparecer en la rendición')
  assert.equal(nuevo.hechoEnLaApp, true)
  assert.equal(nuevo.resultado, '')

  // Se encoló como fila nueva de la pestaña IMPUTADOS, con los campos que la hoja entiende.
  const creada = colaDeImputados(db).find((e) => e.fila_id === `PAGO:${fila.filaId}`)
  assert.ok(creada, 'tiene que quedar encolada la creación de la fila')
  assert.equal(creada.operacion, 'crear')
  const campos = JSON.parse(creada.campos_json) as Record<string, string>
  assert.equal(campos.nombre, CLIENTES.suarez.nombre)
  assert.equal(campos.importe, '$ 28.000')
  assert.equal(campos.medio_pago, 'EFECTIVO')
  assert.equal(campos.mes, 'AGOSTO')
  assert.equal(campos.numero_poliza, CLIENTES.suarez.poliza)

  // Y la fila queda anotada como conocida: si no, cada bajada pediría una importación completa.
  const conocida = filas<{ en_la_hoja: number; pestana: string }>(
    db,
    `SELECT en_la_hoja, pestana FROM filas_crudas WHERE fila_id = ?`,
    `PAGO:${fila.filaId}`,
  )
  assert.equal(conocida.length, 1)
  assert.equal(conocida[0]!.pestana, 'IMPUTADOS')
  assert.equal(conocida[0]!.en_la_hoja, 0)
  cerrarBaseDeDatos()
})

test('corregir un pago antes de que se suba junta los dos cambios en una sola fila', async () => {
  const db = await cobranzasDePrueba()
  const fila = buscar(CLIENTES.suarez.nombre)
  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 28.000', medioDePago: 'EFECTIVO' }, DANIEL)
  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 30.000', medioDePago: 'TRANSFERENCIA' }, DANIEL)

  const entradas = colaDeImputados(db).filter((e) => e.fila_id === `PAGO:${fila.filaId}`)
  assert.equal(entradas.length, 1, 'no puede quedar una fila duplicada en la hoja')
  assert.equal(entradas[0]!.operacion, 'crear')
  const campos = JSON.parse(entradas[0]!.campos_json) as Record<string, string>
  assert.equal(campos.importe, '$ 30.000')
  assert.equal(campos.medio_pago, 'TRANSFERENCIA')
  cerrarBaseDeDatos()
})

test('sin una pestaña IMPUTADOS que sirva, los pagos y el resultado viajan por APP PAGOS', async () => {
  const db = await cobranzasDePrueba()
  // Se simula la hoja real: IMPUTADOS es una planilla de resumen, no una tabla por fila.
  db.prepare(`UPDATE filas_crudas SET en_la_hoja = 0 WHERE tipo_pestana = 'PAGOS'`).run()

  const hoja = hojaDeImputados()
  assert.equal(hoja.pestana, 'APP PAGOS', 'la pestaña de la aplicación, que el motor crea sola')
  assert.equal(hoja.esDeLaApp, true)
  assert.equal(hoja.tieneColumnaResultado, true)
  assert.equal(hoja.aviso, null, 'ya no hay nada que avisar: los pagos no se quedan sólo en esta computadora')

  const rendicion = imputados('2026-08', [])
  assert.equal(rendicion.avisoDeSincronizacion, null)

  // Un pago que vino de la hoja vieja (nunca estuvo en APP PAGOS): al imputarlo se agrega entero allá,
  // con el resultado adentro.
  const pendiente = rendicion.pagos.find((p) => p.resultado === '')!
  const despues = cambiarResultado(pendiente.id, 'OK', [], DANIEL)
  assert.equal(despues.pagos.find((p) => p.id === pendiente.id)?.resultado, 'OK')
  const encolada = filas<{ operacion: string; pestana: string; campos_json: string }>(
    db,
    `SELECT operacion, pestana, campos_json FROM cola_sync WHERE fila_id = ? ORDER BY id`,
    pendiente.filaId,
  )
  assert.equal(encolada.length, 1)
  assert.equal(encolada[0]!.operacion, 'crear')
  assert.equal(encolada[0]!.pestana, 'APP PAGOS')
  assert.equal((JSON.parse(encolada[0]!.campos_json) as Record<string, string>).resultado, 'OK')
  cerrarBaseDeDatos()
})

test('el resultado que llega escrito de cualquier manera se lleva a la lista corta', () => {
  assert.equal(normalizarResultado('IMPUTADO'), 'IMPUTADO')
  assert.equal(normalizarResultado(' imputada '), 'IMPUTADO')
  assert.equal(normalizarResultado('ok'), 'OK')
  assert.equal(normalizarResultado('A REVISAR'), 'REVISAR')
  assert.equal(normalizarResultado('Mal'), 'MAL')
  assert.equal(normalizarResultado(''), '')
  assert.equal(normalizarResultado('cualquier cosa'), '')
})

// ---------------------------------------------------------------------------
// Comisiones
// ---------------------------------------------------------------------------

test('la comisión estimada sale de lo cobrado en el mes y del porcentaje de cada compañía', async () => {
  await cobranzasDePrueba()
  const porNombre = new Map(listarCompanias().map((c) => [c.nombre, c]))
  const sancor = porNombre.get('SANCOR')!
  const rivadavia = porNombre.get('RIVADAVIA')!
  editarCompania(sancor.id, { nombre: sancor.nombre, diasCoberturaFinanciera: sancor.diasCoberturaFinanciera, comisionPorcentaje: 20, mesesRenovacion: sancor.mesesRenovacion, activa: true })

  // Lo importado de IMPUTADOS: SANCOR 24.420 (el otro pago de SANCOR no tiene importe numérico) y
  // RIVADAVIA 16.236. Se suma un cobro más del mostrador.
  registrarPago(buscar(CLIENTES.suarez.nombre).filaId, { fecha: DIA_DE_CAJA, importe: '$ 30.000', medioDePago: 'EFECTIVO' }, DANIEL)

  const resumen = comisiones('2026-08')
  const filaSancor = resumen.filas.find((f) => f.compania === 'SANCOR')!
  assert.equal(filaSancor.cobrado, 24_420)
  assert.equal(filaSancor.porcentaje, 20)
  assert.equal(filaSancor.comision, 4884)

  // RIVADAVIA todavía no tiene porcentaje: cobra pero no estima comisión, y se avisa.
  const filaRivadavia = resumen.filas.find((f) => f.compania === 'RIVADAVIA')!
  assert.equal(filaRivadavia.cobrado, 16_236)
  assert.equal(filaRivadavia.comision, 0)
  assert.ok(resumen.sinPorcentaje.includes('RIVADAVIA'))
  assert.equal(resumen.cobrado, 24_420 + 16_236 + 30_000)
  assert.equal(resumen.comision, 4884)

  // Cargado el porcentaje, la estimación aparece.
  editarCompania(rivadavia.id, { nombre: rivadavia.nombre, diasCoberturaFinanciera: rivadavia.diasCoberturaFinanciera, comisionPorcentaje: 10, mesesRenovacion: rivadavia.mesesRenovacion, activa: true })
  const conPorcentaje = comisiones('2026-08')
  assert.equal(conPorcentaje.filas.find((f) => f.compania === 'RIVADAVIA')?.comision, 1623.6)
  assert.equal(conPorcentaje.sinPorcentaje.includes('RIVADAVIA'), false)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Actualización de una base que venía de la Fase 5
// ---------------------------------------------------------------------------

test('una base de la Fase 5 se actualiza sola a la Fase 6 sin perder los pagos que ya tenía', () => {
  const db = new Database(':memory:') as BaseDeDatos
  db.pragma('foreign_keys = ON')
  const registrar = console.log
  console.log = () => undefined
  try {
    // Se arma una base como la que dejaba la Fase 5: hasta la migración 6, ni una más.
    for (const migracion of MIGRACIONES.filter((m) => m.version <= 6)) {
      db.exec(migracion.sql)
      db.pragma('user_version = ' + migracion.version)
    }
    sembrarDatosIniciales(db)
    db.prepare(
      `INSERT INTO pagos (fila_id, pestana, fecha, cliente_nombre, importe, importe_monto, medio, periodo, creado_en, actualizado_en)
       VALUES ('PAGO:vieja', '(cargado en DM Gestión)', '10/07/2026', 'CLIENTE VIEJO', '$ 1.000', 1000, 'EFECTIVO', '2026-07', '2026-07-10T12:00:00.000Z', '2026-07-10T12:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO pagos (fila_id, pestana, fecha, cliente_nombre, importe, importe_monto, medio, periodo, creado_en, actualizado_en)
       VALUES ('abc123def456', 'IMPUTADOS', '11/07/2026', 'DE LA HOJA', '$ 2.000', 2000, 'EFECTIVO', '2026-07', '2026-07-11T12:00:00.000Z', '2026-07-11T12:00:00.000Z')`,
    ).run()
    db.prepare(
      `INSERT INTO companias (nombre, nombre_normalizado, dias_cobertura_financiera, activa, creado_en, actualizado_en)
       VALUES ('SANCOR', 'SANCOR', 7, 1, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')`,
    ).run()

    ejecutarMigraciones(db)
  } finally {
    console.log = registrar
  }

  // Se aplican todas las que falten, no sólo la de la Fase 6: la base tiene que quedar al día.
  assert.equal(db.pragma('user_version', { simple: true }), MIGRACIONES[MIGRACIONES.length - 1]!.version)
  // Los pagos que ya estaban siguen ahí, y los que había cargado la aplicación quedan marcados.
  const pagos = db.prepare('SELECT fila_id, hecho_en_la_app, resultado FROM pagos ORDER BY fila_id').all() as Array<{
    fila_id: string
    hecho_en_la_app: number
    resultado: string | null
  }>
  assert.equal(pagos.length, 2)
  assert.equal(pagos.find((p) => p.fila_id === 'PAGO:vieja')?.hecho_en_la_app, 1)
  assert.equal(pagos.find((p) => p.fila_id === 'abc123def456')?.hecho_en_la_app, 0)
  assert.equal(pagos[0]!.resultado, null, 'el RESULTADO arranca vacío, no inventado')
  // Y la compañía que ya existía arranca sin porcentaje de comisión.
  assert.equal((db.prepare(`SELECT comision_porcentaje AS c FROM companias WHERE nombre = 'SANCOR'`).get() as { c: number }).c, 0)
  db.close()
})

// ---------------------------------------------------------------------------
// Que la rendición no se pierda: los tres caminos por los que se podría borrar
// ---------------------------------------------------------------------------

/** Deja la hoja de prueba con la pestaña IMPUTADOS SIN columna RESULTADO. */
function hojaSinColumnaResultado(): HojaSimulada {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const encabezados = hoja.encabezadosDe('IMPUTADOS')
  const columna = encabezados.findIndex((e) => e.trim() === 'RESULTADO')
  assert.ok(columna >= 0, 'la hoja de prueba tiene columna RESULTADO')
  hoja.editarCelda('IMPUTADOS', 1, columna, 'NOTA INTERNA')
  return hoja
}

test('sin columna RESULTADO en la hoja, reimportar no borra la rendición hecha a mano', async () => {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  const hoja = hojaSinColumnaResultado()
  await importar(db, hoja)

  const rendicion = imputados('2026-08', [])
  assert.match(rendicion.avisoDeSincronizacion ?? '', /no tiene columna RESULTADO/)
  const pago = rendicion.pagos[0]!
  cambiarResultado(pago.id, 'IMPUTADO', [], DANIEL)
  assert.equal(imputados('2026-08', []).pagos.find((p) => p.id === pago.id)?.resultado, 'IMPUTADO')

  // La importación completa vuelve a correr (la dispara sola la bajada al ver filas nuevas): lo que
  // se cargó a mano tiene que seguir ahí, porque la hoja no tiene de dónde traerlo.
  await importar(db, hoja)
  assert.equal(imputados('2026-08', []).pagos.find((p) => p.id === pago.id)?.resultado, 'IMPUTADO')
  cerrarBaseDeDatos()
})

test('corregir un pago no le borra a la contadora el RESULTADO que puso en la hoja', async () => {
  const db = await cobranzasDePrueba()
  const fila = buscar(CLIENTES.suarez.nombre)
  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 28.000', medioDePago: 'EFECTIVO' }, DANIEL)

  // La fila ya viajó a la hoja y allá le pusieron IMPUTADO.
  const filaDelPago = `PAGO:${fila.filaId}`
  db.prepare(`UPDATE filas_crudas SET en_la_hoja = 1, numero_fila = 5 WHERE fila_id = ?`).run(filaDelPago)
  db.prepare(`UPDATE cola_sync SET estado = 'listo' WHERE fila_id = ?`).run(filaDelPago)
  db.prepare(`UPDATE pagos SET resultado = 'IMPUTADO' WHERE fila_id = ?`).run(filaDelPago)

  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 30.000', medioDePago: 'TRANSFERENCIA' }, DANIEL)

  const entradas = colaDeImputados(db).filter((e) => e.fila_id === filaDelPago && e.operacion === 'actualizar')
  assert.equal(entradas.length, 1)
  const campos = JSON.parse(entradas[0]!.campos_json) as Record<string, string>
  assert.equal(campos.importe, '$ 30.000')
  assert.equal('resultado' in campos, false, 'la corrección del cobro no toca la columna de la rendición')
  assert.equal('observaciones' in campos, false)
  cerrarBaseDeDatos()
})

test('un pago cobrado sin pestaña IMPUTADOS va a APP PAGOS, y se queda ahí aunque después aparezca una', async () => {
  const db = await cobranzasDePrueba()
  // Se simula la hoja real: IMPUTADOS no es una tabla por fila.
  db.prepare(`UPDATE filas_crudas SET en_la_hoja = 0 WHERE tipo_pestana = 'PAGOS'`).run()
  const fila = buscar(CLIENTES.suarez.nombre)
  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 28.000', medioDePago: 'EFECTIVO' }, DANIEL)
  assert.equal(colaDeImputados(db).length, 0, 'a la IMPUTADOS de la agencia no se le escribe nada')
  const enAppPagos = filas<{ operacion: string; fila_id: string; campos_json: string }>(
    db,
    `SELECT operacion, fila_id, campos_json FROM cola_sync WHERE pestana = 'APP PAGOS' ORDER BY id`,
  )
  assert.equal(enAppPagos.length, 1, 'el pago se encola hacia APP PAGOS en el momento')
  assert.equal(enAppPagos[0]!.operacion, 'crear')
  const campos = JSON.parse(enAppPagos[0]!.campos_json) as Record<string, string>
  assert.equal(campos.usuario, DANIEL.nombre, 'con quién cobró')
  assert.equal(campos.sucursal, 'Daniel', 'y en qué mostrador')
  assert.equal((db.prepare('SELECT pestana FROM pagos WHERE fila_id = ?').get(`PAGO:${fila.filaId}`) as { pestana: string }).pestana, 'APP PAGOS')

  // La fila ya viajó y después la agencia arma una IMPUTADOS por fila: el resultado se actualiza
  // donde vive el pago, no en la pestaña nueva.
  db.prepare(`UPDATE filas_crudas SET en_la_hoja = 1 WHERE fila_id = ?`).run(`PAGO:${fila.filaId}`)
  db.prepare(`UPDATE cola_sync SET estado = 'listo'`).run()
  db.prepare(`UPDATE filas_crudas SET en_la_hoja = 1 WHERE tipo_pestana = 'PAGOS' AND numero_fila > 0`).run()
  assert.equal(hojaDeImputados().pestana, 'IMPUTADOS')
  const pago = imputados('2026-08', []).pagos.find((p) => p.numeroPoliza === CLIENTES.suarez.poliza)!
  cambiarResultado(pago.id, 'IMPUTADO', [], DANIEL)
  const actualizada = filas<{ operacion: string; pestana: string }>(db, `SELECT operacion, pestana FROM cola_sync WHERE estado = 'pendiente' AND fila_id = ?`, `PAGO:${fila.filaId}`)
  assert.deepEqual(actualizada, [{ operacion: 'actualizar', pestana: 'APP PAGOS' }])
  cerrarBaseDeDatos()
})

test('el CSV no deja que una celda de la hoja se abra como fórmula en Excel', async () => {
  await cobranzasDePrueba()
  registrarPagoManual(
    {
      cuotaFilaId: null,
      clienteId: null,
      polizaId: null,
      clienteNombre: '=SUMA(A1:A9)',
      documento: '',
      compania: '',
      numeroPoliza: '@raro',
      patente: '',
      fecha: DIA_DE_CAJA,
      importe: '1000',
      medioDePago: 'EFECTIVO',
      sucursal: 'Daniel',
      observaciones: '',
    },
    DANIEL,
  )
  const archivo = csvDeLaCaja(DIA_DE_CAJA, '')
  assert.match(archivo.contenido, /"'=SUMA\(A1:A9\)"/)
  assert.match(archivo.contenido, /"'@raro"/)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Cobro imputado: se le paga a la compañía y el cliente transfiere después
// ---------------------------------------------------------------------------

test('un cobro IMPUTADO no deja la fila paga ni suma a la caja; cuando el cliente paga, sí', async () => {
  const db = await cobranzasDePrueba()
  const fila = buscar(CLIENTES.rodriguez.nombre)

  const imputada = registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '$ 10.000', medioDePago: 'TRANSFERENCIA', estadoCobro: 'IMPUTADO' }, DANIEL)
  assert.equal(imputada.pagoImputado, true)
  assert.equal(imputada.pagoRegistrado, false, 'la fila no figura paga: el cliente todavía no pagó')
  assert.equal(imputada.pago, null, 'CUANDO PAGO sigue vacío')
  assert.equal(imputada.pagoFecha, null)

  const caja = cajaDelDia(DIA_DE_CAJA, '')
  assert.equal(caja.pagos.length, 1, 'el pago se ve en la caja')
  assert.equal(caja.pagos[0]!.estadoCobro, 'IMPUTADO')
  assert.equal(caja.total, 0, 'pero no suma: la plata no entró')
  assert.equal(caja.imputados, 1)
  assert.equal(caja.totalesPorMedio.length, 0)
  assert.match(csvDeLaCaja(DIA_DE_CAJA, '').contenido, /IMPUTADO \(falta cobrar\)/)

  // En la rendición se cuenta como «sin cobrar», y en la mora sigue apareciendo con la marca.
  assert.equal(imputados('2026-08', []).sinCobrar, 1)
  const enMora = mora(SIN_FILTROS, HOY).filas.find((f) => f.filaId === fila.filaId)
  assert.ok(enMora, 'la cuota vencida sigue en mora: lo que se persigue es el pago del cliente')
  assert.equal(enMora.imputada, true)

  // La cola lleva el COBRO a la hoja, y no toca CUANDO PAGO de la fila del mes.
  const encolado = filas<{ pestana: string; campos_json: string }>(db, `SELECT pestana, campos_json FROM cola_sync WHERE fila_id = ?`, `PAGO:${fila.filaId}`)
  assert.equal(encolado.length, 1)
  assert.equal((JSON.parse(encolado[0]!.campos_json) as Record<string, string>).cobro, 'IMPUTADO')
  assert.equal(filas(db, `SELECT 1 FROM cola_sync WHERE fila_id = ?`, fila.filaId).length, 0, 'la fila del mes no se encola: no cambió')

  // El cliente paga: se registra de nuevo como PAGO sobre la misma fila.
  const pagada = registrarPago(fila.filaId, { fecha: HOY, importe: '$ 10.000', medioDePago: 'TRANSFERENCIA', estadoCobro: 'PAGO' }, DANIEL)
  assert.equal(pagada.pagoImputado, false)
  assert.equal(pagada.pagoRegistrado, true)
  assert.equal(pagada.pagoFecha, HOY)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pagos WHERE hecho_en_la_app = 1').get() as { n: number }).n, 1, 'es el mismo pago, corregido')
  assert.equal(cajaDelDia(HOY, '').total, 10_000, 'ahora sí suma, en el día que pagó')
  assert.equal(cajaDelDia(DIA_DE_CAJA, '').pagos.length, 0, 'y ya no está en el día de la imputación')
  assert.equal(mora(SIN_FILTROS, HOY).filas.some((f) => f.filaId === fila.filaId), false)
  const corregido = filas<{ campos_json: string }>(db, `SELECT campos_json FROM cola_sync WHERE fila_id = ?`, `PAGO:${fila.filaId}`)
  assert.equal((JSON.parse(corregido[0]!.campos_json) as Record<string, string>).cobro, 'PAGO', 'la hoja se entera de que dejó de estar imputado')
  cerrarBaseDeDatos()
})

test('el alta manual desde la caja también puede quedar como IMPUTADO', async () => {
  await cobranzasDePrueba()
  const fila = buscar(CLIENTES.suarez.nombre)
  const resultado = registrarPagoManual(
    {
      cuotaFilaId: fila.filaId,
      clienteId: fila.clienteId,
      polizaId: fila.polizaId,
      clienteNombre: fila.nombre ?? '',
      documento: fila.documento ?? '',
      compania: fila.compania ?? '',
      numeroPoliza: fila.numeroPoliza ?? '',
      patente: fila.patente ?? '',
      fecha: DIA_DE_CAJA,
      importe: '$ 21.840',
      medioDePago: 'TRANSFERENCIA',
      sucursal: 'Lanús',
      observaciones: '',
      estadoCobro: 'IMPUTADO',
    },
    DANIEL,
  )
  assert.equal(resultado.caja.imputados, 1)
  assert.equal(resultado.caja.total, 0)
  assert.equal(buscar(CLIENTES.suarez.nombre).pagoImputado, true)
  assert.equal(buscar(CLIENTES.suarez.nombre).pagoRegistrado, false)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Pago adelantado: dos cuotas el mismo mes
// ---------------------------------------------------------------------------

test('pagar las dos cuotas juntas cobra la de este mes y deja la del mes que viene guardada como adelanto', async () => {
  const db = await cobranzasDePrueba()
  const fila = buscar(CLIENTES.suarez.nombre)
  const enAgostoAntes = imputados('2026-08', []).pagos.length
  const pagosAntes = (db.prepare('SELECT COUNT(*) AS n FROM pagos').get() as { n: number }).n

  const actualizada = registrarPago(
    fila.filaId,
    { fecha: DIA_DE_CAJA, importe: '$ 10.000', medioDePago: 'EFECTIVO', alcance: 'AMBAS', adelanto: { importe: '$ 10.500', modo: 'ACREDITAR' } },
    DANIEL,
  )
  assert.equal(actualizada.pagoRegistrado, true)
  assert.equal(actualizada.pagoFecha, DIA_DE_CAJA)
  assert.ok(actualizada.adelantoSiguiente, 'la fila sabe que adelantó la que viene')
  assert.equal(actualizada.adelantoSiguiente.periodo, '2026-09')
  assert.equal(actualizada.adelantoSiguiente.importe, '$ 10.500')
  assert.equal(actualizada.adelantoSiguiente.modo, 'ACREDITAR')
  assert.equal(actualizada.adelantoSiguiente.imputado, false, 'todavía no existe la fila de septiembre')

  // Las dos entran hoy en la caja.
  const caja = cajaDelDia(DIA_DE_CAJA, '')
  assert.equal(caja.pagos.length, 2)
  assert.equal(caja.total, 20_500)
  const adelanto = caja.pagos.find((p) => p.adelantoModo !== null)
  assert.ok(adelanto)
  assert.equal(adelanto.periodo, '2026-09', 'el adelanto es del mes que viene')
  assert.equal(adelanto.adelantoImputado, false)

  // Y cada una se rinde en el mes que paga.
  assert.equal(imputados('2026-08', []).pagos.length, enAgostoAntes + 1)
  assert.equal(imputados('2026-09', []).pagos.length, 1)

  // En la hoja el adelanto viaja con MES y año, para que ningún importador lo tome por el mes de este año.
  const encolado = filas<{ campos_json: string }>(db, `SELECT campos_json FROM cola_sync WHERE fila_id = ?`, `PAGO:ADELANTO:${fila.filaId}`)
  assert.equal(encolado.length, 1)
  assert.equal((JSON.parse(encolado[0]!.campos_json) as Record<string, string>).mes, 'SEPTIEMBRE 2026')

  // Volver a adelantar corrige, no duplica.
  registrarPago(fila.filaId, { fecha: DIA_DE_CAJA, importe: '', medioDePago: 'EFECTIVO', alcance: 'ADELANTADO', adelanto: { importe: '$ 11.000', modo: 'PENDIENTE' } }, DANIEL)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pagos').get() as { n: number }).n, pagosAntes + 2)
  assert.equal(buscar(CLIENTES.suarez.nombre).adelantoSiguiente?.importe, '$ 11.000')
  assert.equal(buscar(CLIENTES.suarez.nombre).adelantoSiguiente?.modo, 'PENDIENTE')

  // Sin modo no hay adelanto: se rechaza antes de cobrar nada.
  const perez = buscar(CLIENTES.martinez.nombre)
  assert.throws(
    () => registrarPago(perez.filaId, { fecha: DIA_DE_CAJA, importe: '1', medioDePago: '', alcance: 'AMBAS', adelanto: { importe: '1', modo: 'x' as never } }, DANIEL),
    /acreditarla al mes siguiente o dejarla pendiente/,
  )
  assert.equal(buscar(CLIENTES.martinez.nombre).pagoRegistrado, false, 'no quedó cobrada media operación')
  cerrarBaseDeDatos()
})
