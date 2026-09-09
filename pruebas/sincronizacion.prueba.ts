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
  // Importado acá y no con un `await import(...)` dentro de la prueba: el import dinámico hacía que el
  // empaquetador partiera cartera.ts en un chunk aparte y se cayera al re-exportar una constante.
  nombreParaPestanaNueva,
  planillaDelMes,
  registrarPago,
} from '../src/main/servicios/cartera'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { ErrorDelServidorVps } from '../src/main/vps/fuenteVps'
import { avisarRechazo, avisosDeRechazos, listarRechazos } from '../src/main/servicios/rechazos'
import { apurarAgrupadas, cuantasFallidas, cuantasPendientes, encolar, esperaDeReintento, usarDespertadorDeLaCola } from '../src/main/sincronizacion/cola'
import { leerContexto } from '../src/main/sincronizacion/hoja'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { hacerRespaldo, listarRespaldos, rotar, tocaRespaldar, type ServicioDeRespaldo } from '../src/main/sincronizacion/respaldo'
import { subirTanda } from '../src/main/sincronizacion/subida'
import type { FilaCartera, SesionUsuario } from '../src/shared/tipos'
import { unico } from './ayuda'
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

/** Deja correr los relojes cortos del motor (el respiro de `apurarSubida` son 100 ms). */
function esperar(ms: number): Promise<void> {
  return new Promise((seguir) => setTimeout(seguir, ms))
}

/** Una fila cargada a mano en AGOSTO desde Google: con datos y con la columna del _ID vacía. */
function agregarFilaAMano(hoja: HojaSimulada, nombre: string, dni: string): void {
  const encabezados = hoja.encabezadosDe('AGOSTO')
  const nueva = new Array<string>(encabezados.length).fill('')
  const poner = (titulo: string, valor: string) => {
    const i = encabezados.findIndex((e) => e.trim() === titulo)
    if (i >= 0) nueva[i] = valor
  }
  poner('APELLIDO Y NOMBRE', nombre)
  poner('DNI', dni)
  poner('SUCURSAL', 'LANUS')
  poner('COMPAÑIA', 'SANCOR')
  poner('NRO DE POLIZA', '909090')
  poner('DOMINIO', 'AK909PO')
  poner('CUOTA', '$ 21.000')
  poner('DIA DE VTO', '10')
  nueva[hoja.columnaIdDe('AGOSTO')] = ''
  hoja.agregarFila('AGOSTO', nueva)
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

// El motor ya no tiene reloj de subida (14.0): la cola lo despierta. Es lo que hace que escribir una
// celda se vea del otro lado en lo que tarda el viaje y no «hasta diez segundos después», y también lo
// más fácil de romper sin que se note —si el despertador se desengancha, todo sigue subiendo igual…
// cuando alguien apriete «Sincronizar ahora»—.
test('encolar despierta al motor y la subida sale sola, sin reloj', async () => {
  const { hoja, motor } = await escenario()
  let avisos = 0
  // Es lo mismo que hace `obtenerMotor()` en el programa de verdad; acá se engancha a mano porque el
  // motor es el del escenario y no el del proceso.
  usarDespertadorDeLaCola(() => {
    avisos++
    motor.apurarSubida()
  })
  try {
    const gonzalez = fila(CLIENTES.gonzalez.nombre)
    editarCelda(gonzalez.filaId, 'telefono', '11-5555-4444', DANIEL)
    assert.equal(avisos, 1, 'encolar avisa en el momento, no en el próximo ciclo')

    // Nadie llama a `ciclarSubida`: la subida sale sola pasado el respiro de los 100 ms, que existe
    // para que guardar una ficha —que encola el cliente, el vehículo y la póliza— viaje en una tanda.
    await esperar(400)
    assert.equal(cuantasPendientes(), 0, 'la cola se vació sin que nadie la empujara')
    assert.equal(enLaHoja(hoja, 'AGOSTO', gonzalez.filaId, 'TELEFONO'), '11-5555-4444')
  } finally {
    // El despertador es del proceso: si queda enganchado a este motor, las pruebas que siguen encolan
    // contra un motor apagado y con la base cerrada.
    usarDespertadorDeLaCola(() => undefined)
  }
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

  // 14.0: las dos entradas viajan en el MISMO ciclo. Hasta la 13.x el borrado esperaba su ventana de
  // agrupado (eran 60 segundos) para juntarse con otros y no hacer recalcular la planilla de Google
  // una vez por baja; la base de la agencia es SQL y no recalcula nada, así que ese minuto era lo
  // único que quedaba entre dar de baja una póliza y verla desaparecer en la otra computadora.
  await motor.ciclarSubida()
  assert.equal(hoja.filasDe('AGOSTO').length, filasAntes - 1, 'la fila tiene que desaparecer de la planilla del mes')
  assert.equal(hoja.filasDe('BAJAS AGOSTO').length, bajasAntes + 1, 'y aparecer en BAJAS')
  assert.equal(enLaHoja(hoja, 'AGOSTO', martinez.filaId, 'CUOTA'), null, 'ya no está en la planilla')

  const enBajas = hoja.filasDe('BAJAS AGOSTO').find((f) => f.some((c) => (c ?? '').includes(CLIENTES.martinez.nombre)))
  assert.ok(enBajas, 'la baja tiene que estar en la pestaña de bajas con el nombre del cliente')
  assert.ok(enBajas.some((c) => (c ?? '').includes('VENDIO')), 'y con su motivo')
  cerrarBaseDeDatos()
})

test('varias bajas seguidas borran las filas en una sola pasada por la hoja', async () => {
  const { hoja, motor } = await escenario()
  const filasAntes = hoja.filasDe('AGOSTO').length
  const borradosAntes = hoja.llamadas.borrarFilas

  // Tres bajas una atrás de otra, como cuando se limpian las pólizas anuladas del sistema.
  for (const nombre of [CLIENTES.martinez.nombre, CLIENTES.gonzalez.nombre, CLIENTES.lopez.nombre]) {
    darDeBaja(fila(nombre).filaId, { motivo: 'ANULA POR FALTA DE PAGO', nota: '' }, DANIEL)
  }

  // 14.0: sin ventana de agrupado, las tres salen en el mismo ciclo. Que salgan en UN solo borrado
  // sigue importando —y por eso esta prueba sigue existiendo— pero ya no lo sostiene el minuto de
  // espera sino la tanda: las tres entradas caen juntas y `subirTanda` agrupa por pestaña.
  await motor.ciclarSubida()
  assert.equal(hoja.filasDe('AGOSTO').length, filasAntes - 3, 'las tres filas salieron de la planilla')
  assert.equal(hoja.llamadas.borrarFilas, borradosAntes + 1, 'y salieron en un solo borrado, no en tres')
  assert.equal(cuantasPendientes(), 0)
  cerrarBaseDeDatos()
})

test('cerrar el mes crea solo la pestaña nueva en la base y sube las filas', async () => {
  const { hoja, motor } = await escenario()
  cerrarMes(DANIEL)
  assert.equal(cuantasPendientes(), 7, 'una entrada por póliza activa')

  // La pestaña de septiembre no existe todavía: el motor la crea al final copiando los encabezados
  // de AGOSTO (hasta la v11 esto se hacía duplicando la pestaña a mano en Google; con la base en el
  // VPS lo hace la aplicación) y en el mismo ciclo suben las 7 filas.
  await motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 0, 'ninguna entrada queda sin arreglo')
  assert.equal(cuantasPendientes(), 0, 'todo subió en el mismo ciclo')
  assert.equal(hoja.llamadas.crearPestana, 1, 'la pestaña se creó una sola vez')

  const encabezados = hoja.encabezadosDe('SEPTIEMBRE')
  assert.ok(encabezados.length > 0, 'SEPTIEMBRE existe en la hoja con encabezados')
  assert.ok(hoja.columnaIdDe('SEPTIEMBRE') >= 0, 'la pestaña nueva tiene su columna _ID')
  for (const encabezado of ['LOCAL', 'CUOTA']) {
    assert.ok(
      encabezados.some((e) => e.trim().toUpperCase().includes(encabezado)),
      `los encabezados copiados de AGOSTO traen «${encabezado}»`,
    )
  }
  const idsDeSeptiembre = hoja.idsDe('SEPTIEMBRE')
  assert.equal(idsDeSeptiembre.size, 7, 'las 7 pólizas activas quedaron en la pestaña nueva, cada una con su _ID')
  assert.ok([...idsDeSeptiembre.values()].every((id) => id.length === 12), 'los _ID viajaron bien formados')

  // Y la primera baja de septiembre crea también su pestaña de BAJAS, con los encabezados de las
  // BAJAS anteriores más la columna _ID (las viejas no la tienen con título en la fila 1).
  darDeBaja(fila(CLIENTES.gonzalez.nombre).filaId, { motivo: 'VENDIO', nota: '' }, DANIEL)
  apurarAgrupadas()
  await motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 0, 'la baja de septiembre subió sin quedar trabada')
  assert.ok(hoja.columnaIdDe('BAJAS SEPTIEMBRE') >= 0, 'BAJAS SEPTIEMBRE se creó con su columna _ID')
  assert.equal(hoja.idsDe('BAJAS SEPTIEMBRE').size, 1, 'la baja viajó a la pestaña nueva')

  // Cambio de año: si el nombre pelado ya lo usa OTRO período (la «ENERO» de este año cuando se
  // cierre diciembre), la pestaña nueva sale con el año para no caer en la planilla vieja.
  assert.equal(nombreParaPestanaNueva('ENERO', '2027-01'), 'ENERO 27', 'ENERO de 2027 no pisa la ENERO de 2026')
  assert.equal(nombreParaPestanaNueva('BAJAS ENERO', '2027-01'), 'BAJAS ENERO 27')
  assert.equal(nombreParaPestanaNueva('OCTUBRE', '2026-10'), 'OCTUBRE', 'sin choque, el nombre pelado de siempre')
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
  const columnaId = hoja.columnaIdDe('AGOSTO')
  agregarFilaAMano(hoja, 'NUÑEZ TAMARA', '32.555.111')

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

test('una fila cargada a mano no deja entradas muertas en la cola', async () => {
  const { hoja, motor } = await escenario()
  agregarFilaAMano(hoja, 'PAEZ LUCIA', '31.444.222')

  // Antes, la bajada inventaba un _ID y lo encolaba para escribirlo. Ese _ID no estaba en ninguna fila
  // de la hoja, así que la subida no encontraba dónde ponerlo y la entrada quedaba en «no se pudo» para
  // siempre: una más en cada ciclo, y el indicador de arriba nunca volvía al verde.
  await motor.ciclarBajada()
  assert.equal(cuantasPendientes(), 0, 'la bajada no encola nada por una fila cargada a mano')

  await motor.ciclarSubida()
  assert.equal(cuantasFallidas(), 0, 'y no queda nada en «no se pudo»')
  assert.equal(motor.estado().situacion, 'sincronizado')

  // El ciclo siguiente ya no la ve como nueva: el _ID quedó escrito.
  const segunda = await motor.ciclarBajada()
  assert.ok(segunda)
  assert.equal(segunda.filasNuevas, 0, 'la fila ya tiene su _ID, no se vuelve a pedir la importación')
  assert.equal(cuantasFallidas(), 0)
  cerrarBaseDeDatos()
})

test('una segunda columna _ID no hace pedir la importación completa en cada ciclo', async () => {
  const { hoja, motor } = await escenario()
  // Duplicar la pestaña del mes deja a veces una segunda columna titulada _ID con identificadores viejos.
  // Eso no es una fila de datos: el importador la descarta, y si la bajada la contara como fila nueva
  // pediría una importación completa en cada ciclo aunque en la hoja no cambiara nada.
  const columnaDeMas = hoja.encabezadosDe('AGOSTO').length
  hoja.editarCelda('AGOSTO', 1, columnaDeMas, '_ID')
  hoja.editarCelda('AGOSTO', hoja.filasDe('AGOSTO').length + 1, columnaDeMas, 'VIEJO1234567')

  const resultado = await motor.ciclarBajada()
  assert.ok(resultado)
  assert.equal(resultado.filasNuevas, 0)
  assert.equal(resultado.necesitaImportacion, false, 'una fila cuyo único contenido es un _ID viejo no es una fila nueva')
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

// El choque de dos computadoras sobre la misma celda, que es LO QUE CAMBIÓ DE FONDO en la 14.0.
//
// Hasta la 13.x ganaba el cambio local —el que todavía no había subido— y lo que había en la base
// quedaba pisado, anotado en un historial que en la práctica nadie mira. Con dos mostradores cargando
// el mismo mes eso perdía trabajo ajeno de verdad. Ahora cada celda viaja con el valor que esta
// computadora creía que tenía la base (`previo`) y la base la escribe SÓLO si sigue siendo ése: la que
// pierde es la de acá, la entrada se cierra con el motivo a la vista y la pestaña se baja enseguida
// para que la pantalla muestre el número que ganó.
test('si el mismo campo cambió de los dos lados, gana la base y el de acá queda anotado', async () => {
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
  assert.equal(enLaHoja(hoja, 'AGOSTO', perez.filaId, 'CUOTA'), '$ 11.111', 'la base no se pisa: sigue lo que había')
  assert.equal(cuantasPendientes(), 0, 'la entrada no queda reintentando: la base ya decidió')

  // Y la copia local termina mostrando lo que ganó, sin que nadie apriete nada: la subida se trae la
  // pestaña pisada en el mismo ciclo (ver `bajarLoQuePisoLaBase` en motor.ts).
  assert.equal(fila(CLIENTES.perezAuto.nombre).cuota, '$ 11.111', 'la pantalla queda mostrando el valor de la base')

  const conflicto = db
    .prepare(`SELECT detalle FROM eventos_sync WHERE tipo = 'conflicto' ORDER BY id DESC LIMIT 1`)
    .get() as { detalle: string } | undefined
  assert.ok(conflicto, 'el choque tiene que quedar anotado en la bitácora de sincronización')
  assert.ok(conflicto.detalle.includes('$ 11.111'), `el anotado dice qué había en la base: ${conflicto.detalle}`)
  assert.ok(conflicto.detalle.includes('$ 22.222'), `y qué no se escribió: ${conflicto.detalle}`)
  cerrarBaseDeDatos()
})

// La otra mitad de lo mismo, mirada por dentro: qué devuelve la subida cuando la base rechaza una
// celda. De eso salen las tres cosas que ve la persona —la pestaña que hay que bajar YA para mostrar
// el valor que ganó, el motivo que queda en la entrada de la cola, y el aviso `datos:pisados` que
// dispara el cartel—. El evento en sí no se puede escuchar acá (sin Electron no hay ventanas a las
// que emitir), pero sale de la misma función que escribe el anotado en la bitácora, así que lo que se
// afirma abajo es exactamente lo que viaja a la pantalla.
test('una celda con el previo viejo queda pisada, marca su pestaña para bajar y deja el motivo', async () => {
  const { hoja, db } = await escenario()
  const perez = fila(CLIENTES.perezAuto.nombre)

  const columna = hoja.encabezadosDe('AGOSTO').findIndex((e) => e.trim() === 'OBS')
  const columnaId = hoja.columnaIdDe('AGOSTO')
  const numeroDeFila = hoja.filasDe('AGOSTO').findIndex((f) => (f[columnaId] ?? '').trim() === perez.filaId) + 1
  hoja.editarCelda('AGOSTO', numeroDeFila, columna, 'Lo anotó Lanús')
  editarCelda(perez.filaId, 'observaciones', 'Lo anoté yo', DANIEL)

  const contexto = await leerContexto(hoja)
  const resultado = await subirTanda(hoja, contexto)
  assert.equal(resultado.pisadas, 1, 'la única celda de la tanda no se escribió')
  assert.deepEqual(resultado.pestanasPisadas, ['AGOSTO'], 'la pestaña a bajar ya, para mostrar lo que ganó')
  assert.equal(enLaHoja(hoja, 'AGOSTO', perez.filaId, 'OBS'), 'Lo anotó Lanús', 'la base quedó intacta')

  // La entrada sale de la cola —no hay nada que reintentar— pero conserva el motivo a la vista, que es
  // lo que se lee en Administración → Sincronización cuando alguien pregunta «¿y mi cambio?».
  assert.equal(cuantasPendientes(), 0)
  const entrada = db
    .prepare(`SELECT estado, ultimo_error FROM cola_sync WHERE fila_id = ? ORDER BY id DESC LIMIT 1`)
    .get(perez.filaId) as { estado: string; ultimo_error: string | null } | undefined
  assert.ok(entrada, 'la entrada tiene que seguir en la tabla, cerrada')
  assert.notEqual(entrada.estado, 'pendiente')
  assert.ok(
    (entrada.ultimo_error ?? '').includes('base'),
    `el motivo tiene que decir que ganó la base: ${entrada.ultimo_error}`,
  )
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

test('un cambio esperando su reintento no frena la bajada de las demás filas', async () => {
  const { hoja, motor, db } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  const rodriguez = fila(CLIENTES.rodriguez.nombre)

  // Falló el intento de escribir en la hoja y la entrada quedó esperando su reintento: sigue pendiente,
  // pero ahora mismo no hay nada para intentar.
  editarCelda(gonzalez.filaId, 'observaciones', 'Pasa mañana', DANIEL)
  db.prepare(`UPDATE cola_sync SET intentos = 1, proximo_intento = ?, ultimo_error = 'no se pudo escribir' WHERE estado = 'pendiente'`).run(
    new Date(Date.now() + 60_000).toISOString(),
  )
  assert.equal(cuantasPendientes(), 1, 'el cambio sigue en la cola')

  // Mientras tanto, en la hoja cambian otra fila y también la que tiene el cambio sin subir.
  const columnaId = hoja.columnaIdDe('AGOSTO')
  const filaDe = (filaId: string) => hoja.filasDe('AGOSTO').findIndex((f) => (f[columnaId] ?? '').trim() === filaId) + 1
  const columnaDe = (titulo: string) => hoja.encabezadosDe('AGOSTO').findIndex((e) => e.trim() === titulo)
  hoja.editarCelda('AGOSTO', filaDe(rodriguez.filaId), columnaDe('CUOTA'), '$ 77.777')
  hoja.editarCelda('AGOSTO', filaDe(gonzalez.filaId), columnaDe('OBS'), 'Lo escribió otro')

  // Antes la bajada se cortaba entera acá: la hoja cambiaba y la aplicación nunca se enteraba.
  const resultado = await motor.ciclarBajada()
  assert.ok(resultado, 'la bajada tiene que correr igual')
  assert.equal(fila(CLIENTES.rodriguez.nombre).cuota, '$ 77.777', 'lo de la hoja llega a la aplicación')
  assert.equal(fila(CLIENTES.gonzalez.nombre).observaciones, 'Pasa mañana', 'y la fila con el cambio sin subir no se pisa')

  // Y cuando la entrada por fin sale, la fila deja de estar bloqueada. Lo que escribe NO llega a la
  // hoja, y es lo correcto (14.0): mientras esperaba el reintento, la hoja pasó a decir otra cosa, así
  // que el `previo` que viaja con la celda ya no coincide y la base la rechaza. La cola queda vacía
  // igual —una celda pisada no es algo que haya que reintentar— y la bajada que dispara la subida deja
  // la copia local mostrando lo que ganó.
  db.prepare(`UPDATE cola_sync SET proximo_intento = NULL WHERE estado = 'pendiente'`).run()
  await motor.ciclarSubida()
  assert.equal(cuantasPendientes(), 0)
  assert.equal(enLaHoja(hoja, 'AGOSTO', gonzalez.filaId, 'OBS'), 'Lo escribió otro', 'gana la base')
  assert.equal(fila(CLIENTES.gonzalez.nombre).observaciones, 'Lo escribió otro', 'y acá se ve lo que ganó')
  cerrarBaseDeDatos()
})

test('las entradas que no se pueden subir nunca se barren al encender', async () => {
  const { motor, db } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  const rodriguez = fila(CLIENTES.rodriguez.nombre)

  // Así quedaba la cola en las versiones anteriores: un _ID inventado para una fila que la hoja no tiene.
  encolar({ operacion: 'actualizar', pestana: 'AGOSTO', filaId: 'MUERTA123456', campos: { _id: 'MUERTA123456' } })
  // Un cambio de verdad y un _id de una fila que sí existe: ninguno de los dos se toca.
  editarCelda(gonzalez.filaId, 'observaciones', 'Esto sí tiene que subir', DANIEL)
  encolar({ operacion: 'actualizar', pestana: 'AGOSTO', filaId: rodriguez.filaId, campos: { _id: rodriguez.filaId } })
  assert.equal(cuantasPendientes(), 3)

  motor.apagar()
  motor.encender()
  assert.equal(cuantasPendientes(), 2, 'sólo se va la entrada que no se podía subir nunca')
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM cola_sync WHERE fila_id = 'MUERTA123456'`).get() as { n: number }).n,
    0,
    'la entrada muerta se borró',
  )
  cerrarBaseDeDatos()
})

test('«Sincronizar ahora» espera al ciclo en curso en vez de no hacer nada', async () => {
  const { motor } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  editarCelda(gonzalez.filaId, 'telefono', '11-1234-1234', DANIEL)
  assert.equal(motor.estado().ultimaBajada, null)

  // Arranca el ciclo automático y, sin esperarlo, alguien toca el botón de la barra superior. Antes el
  // botón se encontraba con «ya estoy trabajando», se iba sin hacer nada y todo quedaba igual.
  const automatico = motor.ciclarSubida()
  await motor.sincronizarAhora()
  await automatico

  assert.equal(cuantasPendientes(), 0)
  assert.ok(motor.estado().ultimaBajada, 'la bajada del botón tiene que haber corrido')
  cerrarBaseDeDatos()
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
// La cola frente a lo que se crea y se borra antes de subir, y frente a las otras computadoras
// ---------------------------------------------------------------------------

test('una ficha creada y borrada sin internet no deja una fila fantasma en la base', async () => {
  const { hoja, motor, db } = await escenario()
  const filasAntes = hoja.filasDe('BAJAS AGOSTO').length
  const columnaId = hoja.columnaIdDe('BAJAS AGOSTO')
  hoja.desconectar()

  // Como adjuntar un archivo y borrarlo antes de que la cola se vacíe: el «crear» todavía está en la
  // cola, así que se cancela (y con él los «actualizar» que se le juntaron adentro), pero el «borrar»
  // se encola igual, porque nadie puede saber desde acá si ese «crear» ya se aplicó allá.
  encolar({ operacion: 'crear', pestana: 'BAJAS AGOSTO', filaId: 'FANTASMA0001', campos: { nombre: 'NADIE', motivo: 'VENDIO' } }, DANIEL)
  encolar({ operacion: 'actualizar', pestana: 'BAJAS AGOSTO', filaId: 'FANTASMA0001', campos: { motivo: 'ANULA' } }, DANIEL)
  assert.equal(cuantasPendientes(), 1)
  encolar({ operacion: 'borrar', pestana: 'BAJAS AGOSTO', filaId: 'FANTASMA0001', campos: {} }, DANIEL)
  const deLaPrimera = db.prepare(`SELECT operacion FROM cola_sync WHERE estado = 'pendiente' AND fila_id = 'FANTASMA0001'`).all() as Array<{
    operacion: string
  }>
  assert.deepEqual(deLaPrimera.map((e) => e.operacion), ['borrar'], 'el «crear» se cancela y queda sólo el «borrar»')

  // El caso que de verdad deja la ficha fantasma: el «crear» SÍ viajó y se aplicó, pero la respuesta se
  // perdió en el camino, así que la entrada sigue en la cola y la fila YA está en la base. Los intentos
  // no sirven para distinguirlo: al juntarle el «actualizar» de abajo (el {subido} de un adjunto que
  // terminó de subir) vuelven a cero. Si el «borrar» no se encolara, nadie sacaría más ese renglón.
  encolar({ operacion: 'crear', pestana: 'BAJAS AGOSTO', filaId: 'FANTASMA0002', campos: { nombre: 'NADIE', motivo: 'VENDIO' } }, DANIEL)
  db.prepare(`UPDATE cola_sync SET intentos = 1, ultimo_error = 'socket hang up' WHERE fila_id = 'FANTASMA0002'`).run()
  const renglon: string[] = []
  while (renglon.length <= columnaId) renglon.push('')
  renglon[columnaId] = 'FANTASMA0002'
  hoja.agregarFila('BAJAS AGOSTO', renglon)
  encolar({ operacion: 'actualizar', pestana: 'BAJAS AGOSTO', filaId: 'FANTASMA0002', campos: { motivo: 'ANULA' } }, DANIEL)
  assert.equal(
    (db.prepare(`SELECT intentos FROM cola_sync WHERE fila_id = 'FANTASMA0002'`).get() as { intentos: number }).intentos,
    0,
    'juntar campos contra un «crear» le borra los intentos: por eso no se los puede usar para saber si salió',
  )
  encolar({ operacion: 'borrar', pestana: 'BAJAS AGOSTO', filaId: 'FANTASMA0002', campos: {} }, DANIEL)
  assert.equal(hoja.filasDe('BAJAS AGOSTO').length, filasAntes + 1, 'la fila del «crear» aplicado está en la base')

  hoja.conectar()
  await motor.ciclarSubida()
  assert.equal(cuantasPendientes(), 0)
  assert.equal(cuantasFallidas(), 0)
  assert.equal(hoja.filasDe('BAJAS AGOSTO').length, filasAntes, 'ninguna de las dos fichas quedó en la base')
  assert.ok(![...hoja.idsDe('BAJAS AGOSTO').values()].some((id) => id.startsWith('FANTASMA')), 'ni quedó su _ID en la pestaña')
  cerrarBaseDeDatos()
})

test('si otra computadora pisa el título de la columna recién agregada, el dato va a una columna propia y no a la ajena', async () => {
  const { hoja, motor, db } = await escenario()
  const filaId = [...hoja.idsDe('RIESGOS VARIOS').values()][0]
  assert.ok(filaId, 'RIESGOS VARIOS tiene filas con _ID')
  assert.ok(!hoja.encabezadosDe('RIESGOS VARIOS').includes('PATENTE'), 'la pestaña no tiene columna para la patente')
  encolar({ operacion: 'actualizar', pestana: 'RIESGOS VARIOS', filaId, campos: { patente: 'AB123CD' } }, DANIEL)

  // La carrera: las dos computadoras eligen la misma columna libre en el mismo ciclo, y la otra escribe
  // su título («MARCA») justo después que ésta. El servidor traba la pestaña sólo mientras escribe,
  // así que la última escritura gana. Hasta ahora esta computadora escribía la patente en esa columna
  // creyendo que era la suya: la patente aparecía como marca en todas las demás.
  const escribirDeVerdad = hoja.escribirCeldas.bind(hoja)
  let pisadas = 0
  hoja.escribirCeldas = async (celdas, columnaIdPorTitulo) => {
    const resultado = await escribirDeVerdad(celdas, columnaIdPorTitulo)
    const titulo = celdas.find((c) => c.titulo === 'RIESGOS VARIOS' && c.fila === 1 && c.valor === 'PATENTE')
    if (titulo && pisadas === 0) {
      pisadas++
      hoja.editarCelda('RIESGOS VARIOS', 1, titulo.columna, 'MARCA')
    }
    return resultado
  }
  await motor.ciclarSubida()
  hoja.escribirCeldas = escribirDeVerdad

  assert.equal(cuantasPendientes(), 0)
  assert.equal(cuantasFallidas(), 0)
  const encabezados = hoja.encabezadosDe('RIESGOS VARIOS')
  const columnaMarca = encabezados.indexOf('MARCA')
  const columnaPatente = encabezados.indexOf('PATENTE')
  assert.ok(columnaMarca >= 0, 'el título de la otra computadora quedó donde lo escribió')
  assert.ok(columnaPatente > columnaMarca, 'y PATENTE se volvió a agregar en la columna libre siguiente')
  assert.equal(enLaHoja(hoja, 'RIESGOS VARIOS', filaId, 'PATENTE'), 'AB123CD', 'la patente está bajo SU título')
  assert.equal(enLaHoja(hoja, 'RIESGOS VARIOS', filaId, 'MARCA'), '', 'y la columna ajena quedó vacía')
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM eventos_sync WHERE tipo = 'columna faltante'`).get() as { n: number }).n, 0, 'ningún dato se descartó')
  cerrarBaseDeDatos()
})

test('una celda que el servidor rechaza no arrastra a «no se pudo» a las demás de su tanda', async () => {
  const { hoja, motor, db } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  const lopez = fila(CLIENTES.lopez.nombre)
  const rodriguez = fila(CLIENTES.rodriguez.nombre)
  editarCelda(gonzalez.filaId, 'observaciones', 'Pasa el lunes', DANIEL)
  editarCelda(lopez.filaId, 'observaciones', 'ESTO LA BASE NO LO ACEPTA', DANIEL)
  editarCelda(rodriguez.filaId, 'observaciones', 'Pasa el martes', DANIEL)
  assert.equal(cuantasPendientes(), 3)

  // El servidor rechaza cualquier tanda que traiga la celda de López (un 4xx, no un corte de red).
  const escribirDeVerdad = hoja.escribirCeldas.bind(hoja)
  hoja.escribirCeldas = async (celdas, columnaIdPorTitulo) => {
    // Un 400: el servidor se queja del CONTENIDO, que es lo único que se puede achacar a una celda.
    if (celdas.some((c) => c.id === lopez.filaId))
      throw new ErrorDelServidorVps('El servidor del VPS rechazó la operación (escribir celdas): valor inválido.', 400)
    return escribirDeVerdad(celdas, columnaIdPorTitulo)
  }

  // Hasta la 12.6 cada tanda rechazada le sumaba un intento a las tres y a la octava las tres quedaban en
  // «no se pudo». Ahora la tanda se va partiendo hasta que la mala queda sola: las buenas viajan igual.
  for (let ciclo = 0; ciclo < 5; ciclo++) await motor.ciclarSubida()
  hoja.escribirCeldas = escribirDeVerdad

  assert.equal(enLaHoja(hoja, 'AGOSTO', gonzalez.filaId, 'OBS'), 'Pasa el lunes', 'la buena de antes de la mala llegó')
  assert.equal(enLaHoja(hoja, 'AGOSTO', rodriguez.filaId, 'OBS'), 'Pasa el martes', 'y la de después también')
  assert.equal(cuantasFallidas(), 0)
  const deLopez = db.prepare(`SELECT estado, intentos FROM cola_sync WHERE fila_id = ?`).get(lopez.filaId) as { estado: string; intentos: number }
  assert.equal(deLopez.estado, 'pendiente', 'la mala sigue esperando su reintento')
  assert.equal(deLopez.intentos, 1, 'y el intento se le contó a ella sola, cuando quedó sola en la tanda')
  const buenas = db.prepare(`SELECT intentos FROM cola_sync WHERE fila_id IN (?, ?)`).all(gonzalez.filaId, rodriguez.filaId) as Array<{ intentos: number }>
  assert.deepEqual(buenas.map((b) => b.intentos), [0, 0], 'a las buenas no se les contó ningún intento')
  cerrarBaseDeDatos()
})

test('un error de cuota o de credenciales hace esperar a toda la tanda, en vez de reintentar sin parar', async () => {
  const { hoja, motor, db } = await escenario()
  editarCelda(fila(CLIENTES.gonzalez.nombre).filaId, 'observaciones', 'Pasa el lunes', DANIEL)
  editarCelda(fila(CLIENTES.lopez.nombre).filaId, 'observaciones', 'Pasa el martes', DANIEL)
  editarCelda(fila(CLIENTES.rodriguez.nombre).filaId, 'observaciones', 'Pasa el miércoles', DANIEL)

  // Un límite de cuota (o un token vencido, o la hoja que no está) no es culpa de ninguna celda: es del
  // pedido entero y lo que pide es esperar. Google los manda como `ErrorDeNegocio` sin código, así que
  // si se los tomara por «una celda mala» la cola se partiría en pedazos y volvería a escribir cada
  // diez segundos, sin espera, justo contra el servidor que está pidiendo que la aplicación afloje.
  let escrituras = 0
  hoja.escribirCeldas = async () => {
    escrituras++
    throw new ErrorDeNegocio('Google limitó la cantidad de pedidos (cuota) al escribir celdas. Esperá un minuto.')
  }
  await motor.ciclarSubida()
  assert.equal(escrituras, 1, 'una sola escritura intentada')
  const enLaCola = db.prepare(`SELECT intentos, proximo_intento FROM cola_sync WHERE estado = 'pendiente'`).all() as Array<{
    intentos: number
    proximo_intento: string | null
  }>
  assert.equal(enLaCola.length, 3)
  assert.ok(
    enLaCola.every((e) => e.intentos === 1 && e.proximo_intento !== null),
    'a las tres se les contó el intento y las tres esperan su turno',
  )

  await motor.ciclarSubida()
  assert.equal(escrituras, 1, 'y el ciclo siguiente ni siquiera lo intenta: está esperando')
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

// ---------------------------------------------------------------------------
// El aviso de rechazo del débito: el viaje de ida y vuelta entre dos sucursales
// ---------------------------------------------------------------------------

test('un aviso de rechazo sube a APP RECHAZOS y lo que la otra sucursal resuelve vuelve por la bajada', async () => {
  const { db, hoja, motor } = await escenario()
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  assert.ok(gonzalez.polizaId)

  // La administración avisa: a González se le rechazó el CBU y lo tiene que llamar Dock Sud.
  const aviso = avisarRechazo(gonzalez.polizaId, { sucursal: 'Dock Sud', motivo: 'SIN FONDOS', nota: 'Rebotó el de agosto' }, DANIEL)
  assert.equal(cuantasPendientes(), 1)

  await motor.ciclarSubida()
  assert.ok(hoja.titulos().includes('APP RECHAZOS'), 'la pestaña se crea sola la primera vez que hay algo que subir')
  assert.ok(aviso.filaId)
  assert.equal(enLaHoja(hoja, 'APP RECHAZOS', aviso.filaId, 'NOMBRE'), CLIENTES.gonzalez.nombre)
  assert.equal(enLaHoja(hoja, 'APP RECHAZOS', aviso.filaId, 'LOCAL'), 'Dock Sud')
  assert.equal(enLaHoja(hoja, 'APP RECHAZOS', aviso.filaId, 'POLIZA'), CLIENTES.gonzalez.poliza)
  assert.equal(enLaHoja(hoja, 'APP RECHAZOS', aviso.filaId, 'MOTIVO'), 'SIN FONDOS')
  assert.equal(enLaHoja(hoja, 'APP RECHAZOS', aviso.filaId, 'ESTADO'), 'PENDIENTE')
  assert.equal(enLaHoja(hoja, 'APP RECHAZOS', aviso.filaId, 'CARGADO POR'), DANIEL.nombre)
  assert.equal(cuantasPendientes(), 0)

  // En Dock Sud lo cobran y lo dan por resuelto: para esta computadora, eso pasa en la hoja.
  const columnaEstado = hoja.encabezadosDe('APP RECHAZOS').findIndex((e) => e.trim() === 'ESTADO')
  const columnaId = hoja.columnaIdDe('APP RECHAZOS')
  const numeroDeFila = hoja.filasDe('APP RECHAZOS').findIndex((f) => (f[columnaId] ?? '').trim() === aviso.filaId) + 1
  hoja.editarCelda('APP RECHAZOS', numeroDeFila, columnaEstado, 'RESUELTO')

  await motor.ciclarBajada(true)
  assert.equal(
    unico<string>(db, 'SELECT estado FROM rechazos_debito WHERE id = ?', aviso.id),
    'RESUELTO',
    'lo que resolvió la otra sucursal baja acá',
  )
  assert.equal(listarRechazos({ busqueda: '', sucursales: [], estado: '' }).porEstado.RESUELTO, 1)
  cerrarBaseDeDatos()
})

test('un aviso cargado en otra computadora llega por la importación, no queda sólo en la hoja', async () => {
  const { hoja, motor, importar } = await escenario()
  // La hoja ya tiene la pestaña porque la creó una sucursal que avisó desde su computadora.
  const gonzalez = fila(CLIENTES.gonzalez.nombre)
  assert.ok(gonzalez.polizaId)
  avisarRechazo(gonzalez.polizaId, { sucursal: 'Dock Sud', motivo: 'CBU RECHAZADO', nota: '' }, DANIEL)
  await motor.ciclarSubida()

  // Ahora aparece un renglón que esta computadora nunca escribió: es el que cargó la otra sucursal.
  const encabezados = hoja.encabezadosDe('APP RECHAZOS')
  const nueva = new Array<string>(encabezados.length).fill('')
  const poner = (titulo: string, valor: string) => {
    const i = encabezados.findIndex((e) => e.trim() === titulo)
    if (i >= 0) nueva[i] = valor
  }
  poner('FECHA', '2026-08-20')
  poner('LOCAL', 'Lanús')
  poner('NOMBRE', CLIENTES.perezAuto.nombre)
  poner('DNI/CUIT', CLIENTES.perezAuto.dni)
  poner('COMPAÑIA', CLIENTES.perezAuto.cia)
  poner('POLIZA', CLIENTES.perezAuto.poliza)
  poner('PATENTE', CLIENTES.perezAuto.patente)
  poner('MOTIVO', 'CUENTA CERRADA')
  poner('ESTADO', 'PENDIENTE')
  poner('CARGADO POR', 'Oli')
  hoja.agregarFila('APP RECHAZOS', nueva)

  await importar()

  const enLanus = listarRechazos({ busqueda: '', sucursales: ['Lanús'], estado: '' })
  assert.equal(enLanus.filas.length, 1, 'el aviso de la otra computadora llegó a esta base')
  const traido = enLanus.filas[0]!
  assert.equal(traido.clienteNombre, CLIENTES.perezAuto.nombre)
  assert.equal(traido.motivo, 'CUENTA CERRADA')
  assert.equal(traido.estado, 'PENDIENTE')
  assert.equal(traido.avisadoPor, 'Oli')
  assert.equal(traido.polizaId, fila(CLIENTES.perezAuto.nombre).polizaId, 'y quedó enganchado a su póliza')

  // Y le enciende la campana a quien trabaja en Lanús, que es de quien es el cliente.
  const enLanusSesion: SesionUsuario = { ...DANIEL, nombre: 'Oli', sucursal: { id: 3, nombre: 'Lanús' } }
  assert.equal(avisosDeRechazos(enLanusSesion).nuevos, 1)
  cerrarBaseDeDatos()
})

/**
 * El motor de la última prueba quedaba encendido. `escenario()` apaga el ANTERIOR al armar el
 * siguiente, y después del último no hay siguiente: sus temporizadores —el de subida cada diez
 * segundos— seguían corriendo durante las pruebas de los demás módulos. En cuanto una de esas cierra
 * la base (`cerrarBaseDeDatos()`, que es lo que hacen casi todas al terminar), el ciclo toca una base
 * cerrada, la promesa queda rechazada sin dueño y node:test termina el proceso con error AUNQUE no
 * haya fallado ninguna prueba. Así se cayó la publicación de 1.0.13: «374 pass, 0 fail» y exit 1.
 */
test('el motor queda apagado cuando terminan las pruebas de sincronización', () => {
  motorAnterior?.apagar()
  assert.equal(motorAnterior?.estaEncendido() ?? false, false, 'un motor encendido sigue tocando la base de las pruebas que vienen después')
})
