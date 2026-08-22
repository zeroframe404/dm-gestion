// La sincronización de punta a punta contra la hoja simulada: se toca algo en la aplicación y aparece
// en la hoja; se toca algo en la hoja y baja a la aplicación; se corta internet y no se pierde nada.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ejecutarImportacion } from '../src/main/importacion/importador'
import { ahoraIso } from '../src/main/importacion/normalizar'
import {
  cerrarMes,
  darDeBaja,
  editarCelda,
  planillaDelMes,
  registrarPago,
} from '../src/main/servicios/cartera'
import { cuantasFallidas, cuantasPendientes, encolar, esperaDeReintento } from '../src/main/sincronizacion/cola'
import { leerContexto } from '../src/main/sincronizacion/hoja'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { hacerRespaldo, listarRespaldos, rotar, tocaRespaldar, type ServicioDeRespaldo } from '../src/main/sincronizacion/respaldo'
import type { FilaCartera, SesionUsuario } from '../src/shared/tipos'
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

interface Escenario {
  db: BaseDeDatos
  hoja: HojaSimulada
  motor: MotorDeSincronizacion
  importar: () => Promise<void>
}

/** El motor del escenario anterior: hay que apagarlo o sus temporizadores siguen corriendo. */
let motorAnterior: MotorDeSincronizacion | null = null

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

  const motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar })
  motor.encender()
  motorAnterior = motor
  return { db, hoja, motor, importar }
}

function fila(nombre: string): FilaCartera {
  const encontrada = planillaDelMes(null).filas.find((f) => f.nombre === nombre)
  if (!encontrada) throw new Error(`No está «${nombre}» en la planilla`)
  return encontrada
}

/** Valor de una celda de la hoja simulada, buscando la fila por su _ID. */
function enLaHoja(hoja: HojaSimulada, pestana: string, filaId: string, encabezado: string): string | null {
  const filas = hoja.filasDe(pestana)
  const encabezados = hoja.encabezadosDe(pestana)
  const columnaId = hoja.columnaIdDe(pestana)
  const columna = encabezados.findIndex((e) => e.trim() === encabezado)
  if (columnaId < 0 || columna < 0) return null
  const encontrada = filas.find((f) => (f[columnaId] ?? '').trim() === filaId)
  return encontrada ? ((encontrada[columna] ?? '').trim() ?? '') : null
}

// ---------------------------------------------------------------------------
// Subida
// ---------------------------------------------------------------------------

test('un cambio en la aplicación llega a la hoja en el próximo ciclo', async () => {
  const { hoja, motor } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)

  editarCelda(gonzalez.filaId, 'telefono', '11-9999-8888', DANIEL)
  assert.equal(cuantasPendientes(), 1, 'el cambio tiene que quedar encolado en el momento')

  const subidas = await motor.ciclarSubida()
  assert.equal(subidas, 1)
  assert.equal(cuantasPendientes(), 0)
  assert.equal(enLaHoja(hoja, 'AGOSTO', gonzalez.filaId, 'TELEFONO'), '11-9999-8888')
  cerrarBaseDeDatos()
})

test('varios cambios de la misma fila viajan juntos y no se pisan', async () => {
  const { hoja, motor } = await escenario()
  const lopez = fila(CLIENTES.lopez.nombre)

  editarCelda(lopez.filaId, 'cuota', '$ 30.000', DANIEL)
  editarCelda(lopez.filaId, 'observaciones', 'Llamar el martes', DANIEL)
  editarCelda(lopez.filaId, 'telefono', '11-1111-2222', DANIEL)
  assert.equal(cuantasPendientes(), 1, 'los tres cambios se juntan en una sola entrada de la cola')

  await motor.ciclarSubida()
  assert.equal(enLaHoja(hoja, 'AGOSTO', lopez.filaId, 'CUOTA'), '$ 30.000')
  assert.equal(enLaHoja(hoja, 'AGOSTO', lopez.filaId, 'OBS'), 'Llamar el martes')
  assert.equal(enLaHoja(hoja, 'AGOSTO', lopez.filaId, 'TELEFONO'), '11-1111-2222')
  cerrarBaseDeDatos()
})

test('registrar un pago escribe CUANDO PAGO en la hoja', async () => {
  const { hoja, motor } = await escenario()
  const perez = fila(CLIENTES.perezAuto.nombre)

  registrarPago(perez.filaId, { fecha: '2026-08-09', importe: '$ 1', medioDePago: 'EFECTIVO' }, DANIEL)
  await motor.ciclarSubida()
  assert.equal(enLaHoja(hoja, 'AGOSTO', perez.filaId, 'PAGO'), '2026-08-09')
  cerrarBaseDeDatos()
})

test('dar de baja saca la fila de la planilla y la agrega a BAJAS, como el cortar y pegar', async () => {
  const { hoja, motor } = await escenario()
  const martinez = fila(CLIENTES.martinez.nombre)
  const filasAntes = hoja.filasDe('AGOSTO').length
  const bajasAntes = hoja.filasDe('BAJAS AGOSTO').length

  darDeBaja(martinez.filaId, { motivo: 'VENDIO', nota: 'Vendió la camioneta' }, DANIEL)
  assert.equal(cuantasPendientes(), 2, 'una entrada para agregar a BAJAS y otra para sacar de la planilla')

  await motor.ciclarSubida()
  assert.equal(hoja.filasDe('AGOSTO').length, filasAntes - 1, 'la fila tiene que desaparecer de la planilla del mes')
  assert.equal(hoja.filasDe('BAJAS AGOSTO').length, bajasAntes + 1, 'y aparecer en BAJAS')
  assert.equal(enLaHoja(hoja, 'AGOSTO', martinez.filaId, 'CUOTA'), null, 'ya no está en la planilla')

  const enBajas = hoja.filasDe('BAJAS AGOSTO').find((f) => f.some((c) => (c ?? '').includes(CLIENTES.martinez.nombre)))
  assert.ok(enBajas, 'la baja tiene que estar en la pestaña de bajas con el nombre del cliente')
  assert.ok(enBajas.some((c) => (c ?? '').includes('VENDIO')), 'y con su motivo')
  cerrarBaseDeDatos()
})

test('cerrar el mes agrega las filas nuevas al final de la pestaña del mes', async () => {
  const { motor } = await escenario()
  cerrarMes(DANIEL)
  assert.equal(cuantasPendientes(), 7, 'una entrada por póliza activa')

  // La pestaña de septiembre todavía no existe en la hoja: la subida lo dice claro y no rompe nada.
  await motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 7)
  const panel = (await import('../src/main/sincronizacion/cola')).pendientes(10)
  assert.equal(panel.length, 0, 'no se reintentan para siempre')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Bajada
// ---------------------------------------------------------------------------

test('un cambio hecho en la hoja baja a la aplicación', async () => {
  const { hoja, motor } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)

  // Alguien edita la cuota directamente en Google.
  const columna = hoja.encabezadosDe('AGOSTO').findIndex((e) => e.trim() === 'CUOTA')
  const columnaId = hoja.columnaIdDe('AGOSTO')
  const numeroDeFila = hoja.filasDe('AGOSTO').findIndex((f) => (f[columnaId] ?? '').trim() === gonzalez.filaId) + 1
  hoja.editarCelda('AGOSTO', numeroDeFila, columna, '$ 99.999')

  const resultado = await motor.ciclarBajada()
  assert.ok(resultado)
  assert.equal(resultado.filasCambiadas, 1)
  assert.equal(fila(CLIENTES.gonzalez.nombre).cuota, '$ 99.999')
  cerrarBaseDeDatos()
})

test('una fila creada a mano en la hoja recibe su _ID y se incorpora', async () => {
  const { hoja, motor, db } = await escenario()
  const clientesAntes = (db.prepare('SELECT COUNT(*) AS n FROM clientes').get() as { n: number }).n

  // Fila cargada a mano en AGOSTO, sin _ID (como la carga cualquiera desde Google).
  const encabezados = hoja.encabezadosDe('AGOSTO')
  const nueva = new Array(encabezados.length).fill('')
  const poner = (titulo: string, valor: string) => {
    const i = encabezados.findIndex((e) => e.trim() === titulo)
    if (i >= 0) nueva[i] = valor
  }
  poner('APELLIDO Y NOMBRE', 'NUÑEZ TAMARA')
  poner('DNI', '32.555.111')
  poner('SUCURSAL', 'LANUS')
  poner('COMPAÑIA', 'SANCOR')
  poner('NRO DE POLIZA', '909090')
  poner('DOMINIO', 'AK909PO')
  poner('CUOTA', '$ 21.000')
  poner('DIA DE VTO', '10')
  // La columna del _ID queda vacía a propósito.
  const columnaId = hoja.columnaIdDe('AGOSTO')
  nueva[columnaId] = ''
  hoja.agregarFila('AGOSTO', nueva)

  const resultado = await motor.ciclarBajada()
  assert.ok(resultado)
  assert.equal(resultado.filasNuevas, 1)
  assert.equal(resultado.necesitaImportacion, true, 'una fila nueva dispara la importación que la incorpora')

  const clientesDespues = (db.prepare('SELECT COUNT(*) AS n FROM clientes').get() as { n: number }).n
  assert.equal(clientesDespues, clientesAntes + 1, 'la clienta nueva tiene que quedar en la base')
  assert.ok(planillaDelMes(null).filas.some((f) => f.nombre === 'NUÑEZ TAMARA'))

  // Y ahora la fila tiene su _ID escrito en la hoja.
  const conId = hoja.filasDe('AGOSTO').find((f) => (f[3] ?? '') === '32.555.111' || f.includes('NUÑEZ TAMARA'))
  assert.ok(conId && (conId[columnaId] ?? '').length === 12, 'la fila nueva quedó con su _ID')
  cerrarBaseDeDatos()
})

test('una fila borrada de la hoja queda marcada, no se pierde el histórico', async () => {
  const { hoja, motor, db } = await escenario()
  const suarez = fila(CLIENTES.suarez.nombre)
  const columnaId = hoja.columnaIdDe('AGOSTO')
  const numeroDeFila = hoja.filasDe('AGOSTO').findIndex((f) => (f[columnaId] ?? '').trim() === suarez.filaId) + 1
  hoja.borrarFila('AGOSTO', numeroDeFila)

  const resultado = await motor.ciclarBajada()
  assert.ok(resultado)
  assert.equal(resultado.filasQueYaNoEstan, 1)
  assert.equal((db.prepare(`SELECT en_la_hoja AS v FROM filas_crudas WHERE fila_id = ?`).get(suarez.filaId) as { v: number }).v, 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM cuotas_mes WHERE fila_id = ?').get(suarez.filaId) as { n: number }).n, 1, 'la cuota sigue guardada')
  cerrarBaseDeDatos()
})

test('primero se sube y recién después se baja: un cambio local nunca se pisa', async () => {
  const { hoja, motor } = await escenario()
  const rodriguez = fila(CLIENTES.rodriguez.nombre)
  editarCelda(rodriguez.filaId, 'observaciones', 'Pasa el jueves', DANIEL)

  await motor.ciclarBajada()
  assert.equal(cuantasPendientes(), 0, 'la bajada arrastra la subida pendiente')
  assert.equal(enLaHoja(hoja, 'AGOSTO', rodriguez.filaId, 'OBS'), 'Pasa el jueves')
  assert.equal(fila(CLIENTES.rodriguez.nombre).observaciones, 'Pasa el jueves', 'y el valor local sobrevive')
  cerrarBaseDeDatos()
})

test('si el mismo campo cambió de los dos lados, el que pierde queda anotado en el historial', async () => {
  const { hoja, motor, db } = await escenario()
  const perez = fila(CLIENTES.perezAuto.nombre)

  // Alguien cambia la cuota en la hoja…
  const columna = hoja.encabezadosDe('AGOSTO').findIndex((e) => e.trim() === 'CUOTA')
  const columnaId = hoja.columnaIdDe('AGOSTO')
  const numeroDeFila = hoja.filasDe('AGOSTO').findIndex((f) => (f[columnaId] ?? '').trim() === perez.filaId) + 1
  hoja.editarCelda('AGOSTO', numeroDeFila, columna, '$ 11.111')
  // …y acá se cambia la misma cuota sin haber bajado ese cambio.
  editarCelda(perez.filaId, 'cuota', '$ 22.222', DANIEL)

  await motor.ciclarSubida()
  assert.equal(enLaHoja(hoja, 'AGOSTO', perez.filaId, 'CUOTA'), '$ 22.222', 'gana el cambio local, que es el más nuevo')

  const pisado = db
    .prepare(`SELECT campo, valor_anterior, valor_nuevo FROM historial WHERE campo LIKE '%pisado por sincronización%' AND fila_id = ?`)
    .get(perez.filaId) as { campo: string; valor_anterior: string; valor_nuevo: string } | undefined
  assert.ok(pisado, 'el valor que había en la hoja tiene que quedar registrado')
  assert.equal(pisado.valor_anterior, '$ 11.111')
  assert.equal(pisado.valor_nuevo, '$ 22.222')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Sin internet
// ---------------------------------------------------------------------------

test('sin internet se sigue trabajando, la cola espera y al volver se vacía sola', async () => {
  const { hoja, motor } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  hoja.desconectar()

  editarCelda(gonzalez.filaId, 'telefono', '11-7777-6666', DANIEL)
  editarCelda(gonzalez.filaId, 'observaciones', 'Sin señal', DANIEL)
  assert.equal(fila(CLIENTES.gonzalez.nombre).telefono, '11-7777-6666', 'la aplicación sigue funcionando igual')

  const subidas = await motor.ciclarSubida()
  assert.equal(subidas, 0)
  assert.equal(motor.estado().situacion, 'sin-conexion')
  assert.equal(motor.estado().pendientes, 1, 'el cambio sigue esperando, no se perdió')

  hoja.conectar()
  await motor.ciclarSubida()
  assert.equal(motor.estado().situacion, 'sincronizado')
  assert.equal(motor.estado().pendientes, 0)
  assert.equal(enLaHoja(hoja, 'AGOSTO', gonzalez.filaId, 'TELEFONO'), '11-7777-6666')
  cerrarBaseDeDatos()
})

test('la espera entre reintentos crece pero tiene techo', () => {
  assert.equal(esperaDeReintento(1), 10_000)
  assert.equal(esperaDeReintento(2), 20_000)
  assert.equal(esperaDeReintento(3), 40_000)
  assert.equal(esperaDeReintento(20), 10 * 60_000)
})

test('el estado que ve la barra superior cuenta lo que falta subir', async () => {
  const { motor } = await escenario()
  assert.equal(motor.estado().situacion, 'sincronizado')
  assert.equal(motor.estado().configurada, true)

  encolar({ operacion: 'actualizar', pestana: 'AGOSTO', filaId: 'inexistente1', campos: { cuota: '$ 1' } })
  assert.equal(motor.estado().situacion, 'pendiente')
  assert.equal(motor.estado().pendientes, 1)

  motor.apagar()
  assert.equal(motor.estado().situacion, 'apagado')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Cuota de llamadas a Google
// ---------------------------------------------------------------------------

test('una tanda de subida usa pocas llamadas, no una por cambio', async () => {
  const { hoja, motor } = await escenario()
  const filas = planillaDelMes(null).filas
  for (const f of filas) editarCelda(f.filaId, 'observaciones', `nota ${f.filaId}`, DANIEL)
  assert.equal(cuantasPendientes(), filas.length)

  const antes = { leerVarias: hoja.llamadas.leerVarias, escribirCeldas: hoja.llamadas.escribirCeldas, estructura: hoja.llamadas.estructura }
  await motor.ciclarSubida()
  const usadas =
    hoja.llamadas.leerVarias - antes.leerVarias + (hoja.llamadas.escribirCeldas - antes.escribirCeldas) + (hoja.llamadas.estructura - antes.estructura)
  assert.ok(usadas <= 4, `una tanda con ${filas.length} cambios usó ${usadas} llamadas`)
  assert.equal(cuantasPendientes(), 0)
  cerrarBaseDeDatos()
})

test('el contexto de la hoja no se relee en cada ciclo', async () => {
  const { hoja, motor } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)

  editarCelda(gonzalez.filaId, 'observaciones', 'uno', DANIEL)
  await motor.ciclarSubida()
  const estructurasDespuesDeLaPrimera = hoja.llamadas.estructura

  editarCelda(gonzalez.filaId, 'observaciones', 'dos', DANIEL)
  await motor.ciclarSubida()
  assert.equal(hoja.llamadas.estructura, estructurasDespuesDeLaPrimera, 'la estructura se cachea')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Respaldo
// ---------------------------------------------------------------------------

test('el respaldo se hace una vez por día después de las 20:00', async () => {
  await escenario()
  assert.equal(tocaRespaldar(new Date(2026, 7, 21, 19, 59)), false, 'antes de las 20 todavía no')
  assert.equal(tocaRespaldar(new Date(2026, 7, 21, 20, 1)), true)
  cerrarBaseDeDatos()
})

test('el respaldo guarda el .xlsx, lo sube a Drive y conserva 30', async () => {
  await escenario()
  const { mkdtempSync, writeFileSync, readdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-respaldos-'))

  let subidos = 0
  const servicio: ServicioDeRespaldo = {
    exportarXlsx: async () => Buffer.from('PK hoja simulada'),
    subirADrive: async () => {
      subidos++
      return 'archivo-123'
    },
  }

  const resultado = await hacerRespaldo(servicio, 'HOJA', carpeta, new Date(2026, 7, 21, 20, 30))
  assert.equal(resultado.hecho, true)
  assert.equal(resultado.enDrive, true)
  assert.equal(subidos, 1)
  assert.equal(listarRespaldos(carpeta).length, 1)
  assert.match(listarRespaldos(carpeta)[0]!.archivo, /^respaldo-20260821\.xlsx$/)

  // Ya hecho el de hoy, no se repite.
  assert.equal(tocaRespaldar(new Date(2026, 7, 21, 22, 0)), false)

  // Y no se acumulan más de 30.
  for (let i = 1; i <= 35; i++) writeFileSync(path.join(carpeta, `respaldo-2026070${String(i).padStart(2, '0')}.xlsx`), 'x')
  rotar(carpeta)
  assert.equal(readdirSync(carpeta).filter((a) => a.endsWith('.xlsx')).length, 30)
  cerrarBaseDeDatos()
})

test('si Drive falla, el respaldo local igual queda guardado', async () => {
  await escenario()
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-respaldos-'))

  const servicio: ServicioDeRespaldo = {
    exportarXlsx: async () => Buffer.from('PK'),
    subirADrive: async () => {
      throw new Error('La cuenta de servicio no tiene espacio propio en Drive.')
    },
  }
  const resultado = await hacerRespaldo(servicio, 'HOJA', carpeta, new Date(2026, 7, 21, 21, 0))
  assert.equal(resultado.hecho, true, 'el respaldo del disco vale aunque Drive falle')
  assert.equal(resultado.enDrive, false)
  assert.equal(listarRespaldos(carpeta).length, 1)
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Las dos computadoras
// ---------------------------------------------------------------------------

test('lo que carga una computadora aparece en la otra', async () => {
  // Dos bases distintas contra la misma hoja: es exactamente el caso de dos PC en la agencia.
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const registrar = console.log
  console.log = () => undefined

  cerrarBaseDeDatos()
  const dockSud = abrirBaseDeDatos(':memory:')
  const importarEnDockSud = async () => {
    const { id } = dockSud.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db: dockSud, fuente: hoja, importacionId: id })
  }
  await importarEnDockSud()
  motorAnterior?.apagar()
  const motorDockSud = new MotorDeSincronizacion({ crearFuente: () => hoja, importar: importarEnDockSud })
  motorDockSud.encender()
  motorAnterior = motorDockSud

  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  registrarPago(gonzalez.filaId, { fecha: '2026-08-12', importe: '$ 24.420', medioDePago: 'EFECTIVO' }, DANIEL)
  await motorDockSud.ciclarSubida()
  cerrarBaseDeDatos()

  // Ahora la notebook de Lanús, con su propia base, importa y sincroniza.
  const lanus = abrirBaseDeDatos(':memory:')
  const importarEnLanus = async () => {
    const { id } = lanus.prepare(`INSERT INTO importaciones (iniciada_en, estado) VALUES (?, 'EN_CURSO') RETURNING id`).get(ahoraIso()) as { id: number }
    await ejecutarImportacion({ db: lanus, fuente: hoja, importacionId: id })
  }
  await importarEnLanus()
  console.log = registrar

  const enLanus = planillaDelMes(null).filas.find((f) => f.filaId === gonzalez.filaId)
  assert.ok(enLanus, 'la fila tiene que existir en la otra computadora con el mismo _ID')
  assert.equal(enLanus.pago, '2026-08-12', 'el pago cargado en una aparece en la otra')
  cerrarBaseDeDatos()
})

// ---------------------------------------------------------------------------
// Contexto de la hoja
// ---------------------------------------------------------------------------

test('el contexto reconoce el tipo y el layout de cada pestaña con dos llamadas', async () => {
  const hoja = new HojaSimulada(construirHojaDePrueba())
  const antes = hoja.llamadas.estructura + hoja.llamadas.leerVarias
  const contexto = await leerContexto(hoja)
  assert.equal(hoja.llamadas.estructura + hoja.llamadas.leerVarias - antes, 2, 'una para la estructura y una para todos los encabezados')

  assert.equal(contexto.porTitulo.get('AGOSTO')?.tipo, 'MENSUAL')
  assert.equal(contexto.porTitulo.get('BAJAS AGOSTO')?.tipo, 'BAJAS')
  assert.ok(contexto.porTitulo.get('AGOSTO')?.layout, 'la planilla del mes tiene layout')
  assert.equal(contexto.porTitulo.get('AGOSTO')?.periodo, '2026-08')
})

/** Escribe una celda de la hoja simulada buscando la fila por su _ID. */
function editarEnLaHoja(hoja: HojaSimulada, pestana: string, filaId: string, encabezado: string, valor: string): void {
  const columnaId = hoja.columnaIdDe(pestana)
  const columna = hoja.encabezadosDe(pestana).findIndex((e) => e.trim() === encabezado)
  const numeroDeFila = hoja.filasDe(pestana).findIndex((f) => (f[columnaId] ?? '').trim() === filaId) + 1
  if (columna < 0 || numeroDeFila <= 0) throw new Error(`No se pudo ubicar «${encabezado}» de ${filaId} en ${pestana}`)
  hoja.editarCelda(pestana, numeroDeFila, columna, valor)
}

test('un importe editado en la hoja recalcula el número con el que se suman las cobranzas', async () => {
  const { hoja, motor, db } = await escenario()
  // Los importes se guardan dos veces: el texto tal cual está en la hoja y su valor numérico, que es
  // el que suman la caja del día, la rendición y las comisiones. La bajada tiene que actualizar los dos.
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  editarEnLaHoja(hoja, 'AGOSTO', gonzalez.filaId, 'CUOTA', '$ 99.999')
  const pago = db.prepare(`SELECT fila_id FROM pagos WHERE numero_poliza = '998877'`).get() as { fila_id: string }
  editarEnLaHoja(hoja, 'IMPUTADOS', pago.fila_id, 'IMPORTE', '$ 20.000')

  const resultado = await motor.ciclarBajada()
  assert.ok(resultado)

  const actualizada = fila(CLIENTES.gonzalez.nombre)
  assert.equal(actualizada.cuota, '$ 99.999')
  assert.equal(actualizada.cuotaMonto, 99999, 'el monto de la cuota se recalcula, no queda el viejo')
  const enLaBase = db.prepare('SELECT importe, importe_monto FROM pagos WHERE fila_id = ?').get(pago.fila_id) as {
    importe: string
    importe_monto: number
  }
  assert.equal(enLaBase.importe, '$ 20.000')
  assert.equal(enLaBase.importe_monto, 20000)
  cerrarBaseDeDatos()
})

test('el RESULTADO que escribe la contadora en la hoja baja a la rendición', async () => {
  const { hoja, motor, db } = await escenario()
  const pago = db.prepare(`SELECT fila_id FROM pagos WHERE numero_poliza = '998877'`).get() as { fila_id: string }
  editarEnLaHoja(hoja, 'IMPUTADOS', pago.fila_id, 'RESULTADO', 'OK')

  await motor.ciclarBajada()
  assert.equal((db.prepare('SELECT resultado FROM pagos WHERE fila_id = ?').get(pago.fila_id) as { resultado: string }).resultado, 'OK')
  cerrarBaseDeDatos()
})
