// El botón de la papelera: borrado definitivo y puntual, sólo del superadministrador.
//
// Lo que estas pruebas cuidan, en orden de gravedad:
//   1. que un ADMIN o un EMPLEADO no puedan borrar nada;
//   2. que la cascada no deje la base a medias —las claves foráneas están en ON, así que un olvido
//      tira la transacción entera— ni se lleve puesto lo que es de otro cliente;
//   3. que lo que el cartel promete antes de confirmar sea exactamente lo que después se borra;
//   4. que los renglones salgan de la hoja de Google, y que no quede en la cola un «crear» de una fila
//      que ya no existe (eso dejaría la fila en Google para siempre);
//   5. que el historial —que es la red de seguridad de la agencia— no se borre nunca.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db, type BaseDeDatos } from '../src/main/db/base'
import { eliminarRegistro, vistaPreviaDeEliminacion } from '../src/main/servicios/eliminacion'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { agregarNota, crearTarea, listarClientes } from '../src/main/servicios/clientes'
import { bajasDelMes, cerrarMes, darDeBaja, planillaDelMes } from '../src/main/servicios/cartera'
import { avisarRechazo, listarRechazos } from '../src/main/servicios/rechazos'
import { crearLead } from '../src/main/servicios/leads'
import { crearSiniestro } from '../src/main/servicios/siniestros'
import { crearPresupuesto, guardarPresupuesto } from '../src/main/servicios/presupuestos'
import { crearTareaCompleta } from '../src/main/servicios/tareas'
import { copiarAdjunto, rutaDeAdjunto, usarCarpetaDeAdjuntosDePrueba } from '../src/main/servicios/adjuntos'
import { encolar, pestanasPendientes } from '../src/main/sincronizacion/cola'
import { ahoraIso } from '../src/main/importacion/normalizar'
import { resumenDeLoBorrado, TIPOS_ELIMINABLES } from '../src/shared/eliminacion'
import type { FiltrosClientes, SesionUsuario } from '../src/shared/tipos'
import { construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { contar, filas, importar, unico } from './ayuda'

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

const SIN_FILTROS: FiltrosClientes = { busqueda: '', sucursal: '', compania: '', estado: '' }

const carpetasTemporales: string[] = []
test.after(() => {
  for (const carpeta of carpetasTemporales) rmSync(carpeta, { recursive: true, force: true })
})

/** La misma cartera de dos importaciones que usan las demás pruebas: así hay bajas de verdad. */
async function carteraDePrueba(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const base = abrirBaseDeDatos(':memory:')
  console.log = registrar

  const hoja = new HojaSimulada(construirHojaDePrueba())
  const agosto = hoja.quitarPestana('AGOSTO')
  const bajasAgosto = hoja.quitarPestana('BAJAS AGOSTO')
  await importar(base, hoja)
  hoja.restaurarPestana(agosto)
  hoja.restaurarPestana(bajasAgosto)
  await importar(base, hoja)
  return base
}

function idDeCliente(busqueda: string): number {
  const encontrado = listarClientes({ ...SIN_FILTROS, busqueda }).filas[0]
  if (!encontrado) throw new Error(`No está «${busqueda}» en el listado de clientes`)
  return encontrado.id
}

/** Los borrados que quedaron esperando en la cola de subida, con su pestaña. */
function borradosEncolados(base: BaseDeDatos): Array<{ fila_id: string; pestana: string }> {
  return filas<{ fila_id: string; pestana: string }>(
    base,
    `SELECT fila_id, pestana FROM cola_sync WHERE operacion = 'borrar' AND estado = 'pendiente'`,
  )
}

function vaciarCola(base: BaseDeDatos): void {
  base.prepare('DELETE FROM cola_sync').run()
}

// ---------------------------------------------------------------------------
// Quién puede
// ---------------------------------------------------------------------------

test('sólo el superadministrador puede borrar: un ADMIN y un EMPLEADO no', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('gonzalez')
  const antes = contar(base, 'clientes')

  for (const quien of [ANA, MARIA]) {
    assert.throws(
      () => eliminarRegistro('cliente', cliente, quien),
      (error: unknown) => error instanceof ErrorDeNegocio && /superadministrador/i.test((error as Error).message),
      `${quien.rol} no tendría que poder borrar`,
    )
    // Ni siquiera puede mirar lo que se llevaría el borrado: es el detalle entero de una persona.
    assert.throws(() => vistaPreviaDeEliminacion('cliente', cliente, quien), ErrorDeNegocio)
  }
  assert.equal(contar(base, 'clientes'), antes, 'no se borró nada')
})

test('un tipo o un id que no existen se rechazan sin tocar la base', async () => {
  const base = await carteraDePrueba()
  const antes = contar(base, 'clientes')
  assert.throws(() => eliminarRegistro('empleado', 1, DANIEL), ErrorDeNegocio)
  assert.throws(() => eliminarRegistro('cliente', 0, DANIEL), ErrorDeNegocio)
  assert.throws(() => eliminarRegistro('cliente', -3, DANIEL), ErrorDeNegocio)
  assert.throws(() => eliminarRegistro('cliente', 999_999, DANIEL), ErrorDeNegocio)
  assert.equal(contar(base, 'clientes'), antes)
})

test('todos los tipos que se declaran tienen plan: ninguno queda sin implementar', async () => {
  await carteraDePrueba()
  for (const tipo of TIPOS_ELIMINABLES) {
    // Con un id que no existe, la respuesta correcta es «no se encontró», no «no sé qué es esto».
    assert.throws(
      () => vistaPreviaDeEliminacion(tipo, 999_999, DANIEL),
      (error: unknown) => error instanceof ErrorDeNegocio && /No se encontró/i.test((error as Error).message),
      `el tipo «${tipo}» no tiene plan`,
    )
  }
})

// ---------------------------------------------------------------------------
// Cliente: la cascada grande
// ---------------------------------------------------------------------------

test('borrar un cliente se lleva sus pólizas, cuotas, pagos, bajas y siniestros', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('perez')
  vaciarCola(base)

  const vista = vistaPreviaDeEliminacion('cliente', cliente, DANIEL)
  assert.ok(vista.titulo.toUpperCase().includes('PEREZ'), 'el cartel dice de quién se trata')
  const polizasQueDijo = vista.arrastra.find((l) => l.que === 'póliza')?.cuantos ?? 0
  assert.equal(polizasQueDijo, 2, 'Pérez tiene el auto y la moto')
  const cuotasQueDijo = vista.arrastra.find((l) => l.que === 'cuota del mes')?.cuantos ?? 0
  assert.ok(cuotasQueDijo > 0, 'y las cuotas de todos los meses importados')

  const resultado = eliminarRegistro('cliente', cliente, DANIEL)
  assert.equal(resultado.tipo, 'cliente')
  assert.deepEqual(resultado.borrado, vista.arrastra, 'lo que se borró es exactamente lo que el cartel prometió')

  assert.equal(contar(base, 'clientes', `id = ${cliente}`), 0)
  for (const tabla of ['polizas', 'cuotas_mes', 'bajas', 'pagos', 'notas', 'siniestros', 'amp', 'riesgos_varios', 'vehiculos']) {
    assert.equal(contar(base, tabla, `cliente_id = ${cliente}`), 0, `quedaron filas en ${tabla}`)
  }
  assert.equal(contar(base, 'cuotas_mes', `poliza_id NOT IN (SELECT id FROM polizas)`), 0, 'ninguna cuota huérfana')
})

test('borrar un cliente NO borra el vehículo que también usa otro cliente', async () => {
  const base = await carteraDePrueba()
  const gonzalez = idDeCliente('gonzalez')
  const lopez = idDeCliente('lopez')

  // El auto de González se vende y López lo asegura: la clave del vehículo es la patente a secas, así
  // que en la base es LA MISMA fila. Es exactamente el caso que el plan tiene que respetar.
  const vehiculo = unico<number>(base, 'SELECT id FROM vehiculos WHERE cliente_id = ? LIMIT 1', gonzalez)
  const polizaDeLopez = unico<number>(base, 'SELECT id FROM polizas WHERE cliente_id = ? LIMIT 1', lopez)
  base.prepare('UPDATE polizas SET vehiculo_id = ? WHERE id = ?').run(vehiculo, polizaDeLopez)

  // Y el cartel no lo cuenta entre lo que borra: promete lo que va a pasar, ni uno más.
  const antes = contar(base, 'vehiculos', `cliente_id = ${gonzalez}`)
  const vista = vistaPreviaDeEliminacion('cliente', gonzalez, DANIEL)
  assert.equal(
    vista.arrastra.find((l) => l.que === 'vehículo')?.cuantos ?? 0,
    antes - 1,
    'el compartido no entra en la cuenta de lo que se borra',
  )
  assert.ok(
    vista.advertencias.some((a) => /vehículo/i.test(a)),
    'pero sí se avisa que queda sin dueño',
  )

  eliminarRegistro('cliente', gonzalez, DANIEL)

  assert.equal(contar(base, 'vehiculos', `id = ${vehiculo}`), 1, 'el auto sigue existiendo')
  assert.equal(unico<number | null>(base, 'SELECT cliente_id FROM vehiculos WHERE id = ?', vehiculo), null, 'y quedó sin dueño')
  assert.equal(
    unico<number>(base, 'SELECT vehiculo_id FROM polizas WHERE id = ?', polizaDeLopez),
    vehiculo,
    'la póliza de López no perdió su vehículo',
  )
})

test('el lead del que salió la venta no se borra: queda sin cliente', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('rodriguez')
  const lead = crearLead(
    {
      nombre: 'RODRIGUEZ ANA',
      telefono: '11 5555 4444',
      documento: '',
      email: '',
      sucursal: 'DANIEL',
      interes: 'el Etios',
      tipoVehiculo: 'AUTO',
      origen: 'WHATSAPP',
      estado: 'GANADO',
      nota: '',
    },
    DANIEL,
  ).lead
  base.prepare('UPDATE leads SET cliente_id = ?, convertido_en = ? WHERE id = ?').run(cliente, ahoraIso(), lead.id)

  const vista = vistaPreviaDeEliminacion('cliente', cliente, DANIEL)
  assert.ok(
    vista.advertencias.some((a) => /lead/i.test(a)),
    'el cartel avisa que el lead queda',
  )

  eliminarRegistro('cliente', cliente, DANIEL)
  assert.equal(contar(base, 'leads', `id = ${lead.id}`), 1, 'el lead sobrevive')
  assert.equal(unico<number | null>(base, 'SELECT cliente_id FROM leads WHERE id = ?', lead.id), null, 'sin cliente')
})

test('la cascada completa: un cliente con todo colgando se borra sin dejar nada roto', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('gonzalez')
  const poliza = unico<number>(base, 'SELECT id FROM polizas WHERE cliente_id = ? LIMIT 1', cliente)

  // Se le cuelga de todo, que es la única forma de saber que la cascada está entera: las claves
  // foráneas están en ON y cualquier tabla que el plan haya olvidado tira la transacción.
  agregarNota(cliente, 'llamó preguntando por la cuota', DANIEL)
  crearTarea(
    { clienteId: cliente, polizaId: poliza, titulo: 'Mandarle la póliza', detalle: '', responsableId: DANIEL.id, venceEl: '' },
    DANIEL,
  )
  crearSiniestro(
    {
      clienteId: cliente,
      polizaId: poliza,
      fecha: '2026-08-10',
      numeroSiniestro: 'S-1',
      descripcion: 'granizo',
      estado: 'ABIERTO',
      importe: '$ 100.000',
      observaciones: '',
    },
    DANIEL,
  )
  avisarRechazo(poliza, { motivo: 'SIN FONDOS', nota: '', sucursal: '' }, DANIEL)
  const presupuesto = crearPresupuesto(
    {
      leadId: null,
      clienteId: cliente,
      clienteNombre: 'GONZALEZ MARIA LAURA',
      telefono: '',
      documento: '',
      sucursal: 'DOCK SUD',
      patente: 'AB123CD',
      marca: 'FORD',
      modelo: 'FIESTA',
      anio: '2018',
      tipoVehiculo: 'AUTO',
      observaciones: '',
      opciones: [{ compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 20.000', comentario: '' }],
    },
    DANIEL,
  ).presupuesto
  base.prepare('INSERT INTO renovaciones (poliza_id, vence_el, creado_en, actualizado_en) VALUES (?, ?, ?, ?)').run(
    poliza,
    '2027-01-01',
    ahoraIso(),
    ahoraIso(),
  )

  const vista = vistaPreviaDeEliminacion('cliente', cliente, DANIEL)
  for (const que of ['póliza', 'nota', 'tarea', 'siniestro', 'aviso de rechazo', 'presupuesto']) {
    assert.ok(
      vista.arrastra.some((l) => l.que === que && l.cuantos > 0),
      `el cartel no cuenta «${que}»`,
    )
  }

  eliminarRegistro('cliente', cliente, DANIEL)

  assert.equal(contar(base, 'clientes', `id = ${cliente}`), 0)
  assert.equal(contar(base, 'presupuestos', `id = ${presupuesto.id}`), 0)
  assert.equal(contar(base, 'renovaciones', `poliza_id = ${poliza}`), 0)
  assert.equal(contar(base, 'notas', `cliente_id = ${cliente}`), 0)
  assert.equal(contar(base, 'tareas', `cliente_id = ${cliente}`), 0)
  assert.equal(contar(base, 'siniestros', `cliente_id = ${cliente}`), 0)
  assert.equal(contar(base, 'rechazos_debito', `cliente_id = ${cliente}`), 0)
  assert.equal(contar(base, 'presupuesto_opciones', `presupuesto_id = ${presupuesto.id}`), 0)
  // Los enganches por texto, que las claves foráneas NO cuidan: si quedaran, apuntarían a la nada.
  assert.equal(contar(base, 'pagos', `cuota_fila_id IS NOT NULL AND cuota_fila_id NOT IN (SELECT fila_id FROM cuotas_mes)`), 0)
  assert.equal(contar(base, 'bajas', `cuota_fila_id IS NOT NULL AND cuota_fila_id NOT IN (SELECT fila_id FROM cuotas_mes)`), 0)
  // La prueba de fuego: SQLite mira si quedó alguna fila apuntando a algo que ya no está.
  assert.deepEqual(base.pragma('foreign_key_check'), [], 'quedaron referencias rotas en la base')
})

test('el historial no se borra nunca, y queda anotado quién borró y qué', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('suarez')
  const historialAntes = contar(base, 'historial')

  const resultado = eliminarRegistro('cliente', cliente, DANIEL)

  assert.ok(contar(base, 'historial') > historialAntes, 'el historial creció, no se achicó')
  const anotado = filas<{ usuario_nombre: string; campo: string; valor_anterior: string | null }>(
    base,
    `SELECT usuario_nombre, campo, valor_anterior FROM historial WHERE accion = 'eliminacion' ORDER BY id DESC LIMIT 1`,
  )[0]
  assert.ok(anotado, 'hay una entrada de eliminación')
  assert.equal(anotado.usuario_nombre, DANIEL.nombre)
  assert.ok(anotado.valor_anterior?.includes(resultado.titulo.split(' · ')[0] ?? ''), 'y dice a quién se borró')
})

// ---------------------------------------------------------------------------
// La hoja de Google
// ---------------------------------------------------------------------------

test('cada renglón que estaba en la hoja se encola para borrar, una sola vez y en su pestaña', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('lopez')
  vaciarCola(base)

  const vista = vistaPreviaDeEliminacion('cliente', cliente, DANIEL)
  const resultado = eliminarRegistro('cliente', cliente, DANIEL)
  assert.equal(resultado.filasDeLaHoja, vista.filasDeLaHoja, 'el cartel no miente sobre la hoja')
  assert.ok(resultado.filasDeLaHoja > 0, 'López estaba en las planillas mensuales')

  const encolados = borradosEncolados(base)
  assert.equal(encolados.length, resultado.filasDeLaHoja)
  const claves = encolados.map((e) => `${e.pestana} ${e.fila_id}`)
  assert.equal(new Set(claves).size, claves.length, 'ningún renglón encolado dos veces')
  assert.ok(
    encolados.every((e) => e.pestana !== '(cargado en DM Gestión)'),
    'nunca se encola contra la pestaña de lo que todavía no viajó',
  )
})

test('un cambio pendiente de una fila que se borra sale de la cola', async () => {
  const base = await carteraDePrueba()
  // Rodríguez y no Martínez: Martínez comparte el DNI con González y el importador los unifica.
  const cliente = idDeCliente('rodriguez')
  vaciarCola(base)

  const cuota = filas<{ fila_id: string; pestana: string }>(
    base,
    'SELECT fila_id, pestana FROM cuotas_mes WHERE cliente_id = ? LIMIT 1',
    cliente,
  )[0]
  assert.ok(cuota, 'Rodríguez tiene cuotas')
  // Un «crear» que todavía no viajó. Si sobreviviera, la subida lo aplicaría ANTES del borrado y la
  // fila quedaría creada en Google sin que nadie la saque nunca.
  encolar({ operacion: 'crear', pestana: cuota.pestana, filaId: cuota.fila_id, campos: { nombre: 'X' } }, DANIEL)
  assert.equal(contar(base, 'cola_sync', `fila_id = '${cuota.fila_id}' AND operacion = 'crear'`), 1)

  eliminarRegistro('cliente', cliente, DANIEL)

  assert.equal(
    contar(base, 'cola_sync', `fila_id = '${cuota.fila_id}' AND operacion <> 'borrar'`),
    0,
    'no quedó ningún crear ni actualizar de esa fila',
  )
})

test('lo que nunca llegó a la hoja no se cuenta como renglón a borrar', async () => {
  const base = await carteraDePrueba()
  vaciarCola(base)
  const lead = crearLead(
    {
      nombre: 'CONSULTA NUEVA',
      telefono: '11 2222 3333',
      documento: '',
      email: '',
      sucursal: 'DANIEL',
      interes: 'una moto',
      tipoVehiculo: 'MOTO',
      origen: 'LOCAL',
      estado: 'NUEVO',
      nota: '',
    },
    DANIEL,
  ).lead
  // El lead se anotó para subir pero la subida todavía no corrió: `en_la_hoja = 0` y `numero_fila = 0`.
  const vista = vistaPreviaDeEliminacion('lead', lead.id, DANIEL)
  assert.equal(vista.filasDeLaHoja, 0, 'no hay renglón en Google que sacar')

  // Pero el «crear» que dejó el alta SÍ tiene que salir de la cola. Si sobreviviera, la subida
  // escribiría en Google una fila que acá ya no existe y que nadie va a sacar nunca.
  assert.equal(contar(base, 'cola_sync', `fila_id = '${lead.filaId}' AND operacion = 'crear'`), 1)

  const resultado = eliminarRegistro('lead', lead.id, DANIEL)
  assert.equal(resultado.filasDeLaHoja, 0, 'el cartel no promete sacar de Google un renglón que no existe')
  assert.equal(contar(base, 'cola_sync', `fila_id = '${lead.filaId}' AND operacion <> 'borrar'`), 0, 'el crear se canceló')
  // Igual queda encolado un borrado. Es a propósito: el proceso principal es de un solo hilo, pero
  // `subirTanda` espera a Google en el medio, y este borrado puede entrar justo cuando la subida ya
  // leyó el «crear» y lo tiene en la mano. Cancelarle la entrada no le saca los datos: va a escribir la
  // fila igual. El borrado de más no cuesta nada y es lo único que tapa esa carrera.
  assert.equal(borradosEncolados(base).length, 1, 'el borrado defensivo del renglón que la subida podría llegar a escribir')
  assert.equal(contar(base, 'leads', `id = ${lead.id}`), 0)
})

// ---------------------------------------------------------------------------
// Los tipos chicos
// ---------------------------------------------------------------------------

test('borrar una baja saca la baja y no devuelve nada a la cartera', async () => {
  const base = await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = planilla.filas.find((f) => f.polizaId !== null)
  assert.ok(fila, 'hay filas en el mes abierto')
  darDeBaja(fila.filaId, { motivo: 'ANULA POR DECISION DEL CLIENTE', nota: 'prueba' }, DANIEL)

  const baja = bajasDelMes(planilla.periodo)[0]
  assert.ok(baja, 'quedó la baja recién hecha')
  const poliza = unico<number>(base, 'SELECT poliza_id FROM bajas WHERE id = ?', baja.id)

  const vista = vistaPreviaDeEliminacion('baja', baja.id, DANIEL)
  assert.ok(
    vista.advertencias.some((a) => /Deshacer/i.test(a)),
    'el cartel manda a usar «Deshacer» si lo que se quiere es recuperarla',
  )

  eliminarRegistro('baja', baja.id, DANIEL)
  assert.equal(contar(base, 'bajas', `id = ${baja.id}`), 0)
  assert.equal(unico<number>(base, 'SELECT activa FROM polizas WHERE id = ?', poliza), 0, 'la póliza sigue dada de baja')
  assert.equal(contar(base, 'cuotas_mes', 'dada_de_baja = 1'), 1, 'y su fila sigue fuera de la planilla')
})

test('borrar un aviso de rechazo del débito', async () => {
  const base = await carteraDePrueba()
  const poliza = unico<number>(base, 'SELECT id FROM polizas WHERE activa = 1 LIMIT 1')
  avisarRechazo(poliza, { motivo: 'SIN FONDOS', nota: 'rebotó', sucursal: '' }, DANIEL)
  const rechazo = listarRechazos({ busqueda: '', sucursal: '', estado: '' }).filas[0]
  assert.ok(rechazo, 'quedó el aviso')

  const vista = vistaPreviaDeEliminacion('rechazo', rechazo.id, DANIEL)
  assert.ok(vista.advertencias.some((a) => /otra computadora|sucursal avisada/i.test(a)))

  eliminarRegistro('rechazo', rechazo.id, DANIEL)
  assert.equal(contar(base, 'rechazos_debito', `id = ${rechazo.id}`), 0)
})

test('borrar un presupuesto se lleva todas sus versiones y sus opciones', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('gonzalez')
  const presupuesto = crearPresupuesto(
    {
      leadId: null,
      clienteId: cliente,
      clienteNombre: 'GONZALEZ MARIA LAURA',
      telefono: '',
      documento: '',
      sucursal: 'DOCK SUD',
      patente: 'AB123CD',
      marca: 'FORD',
      modelo: 'FIESTA',
      anio: '2018',
      tipoVehiculo: 'AUTO',
      observaciones: '',
      opciones: [
        { compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 20.000', comentario: '' },
        { compania: 'ZURICH', cobertura: 'TODO RIESGO', precio: '$ 45.000', comentario: '' },
      ],
    },
    DANIEL,
  ).presupuesto

  const opcionesAntes = contar(base, 'presupuesto_opciones', `presupuesto_id = ${presupuesto.id}`)
  assert.equal(opcionesAntes, 2)

  const vista = vistaPreviaDeEliminacion('presupuesto', presupuesto.id, DANIEL)
  assert.equal(vista.arrastra.find((l) => l.que === 'opción del presupuesto')?.cuantos, 2)

  eliminarRegistro('presupuesto', presupuesto.id, DANIEL)
  assert.equal(contar(base, 'presupuestos', `id = ${presupuesto.id}`), 0)
  assert.equal(contar(base, 'presupuesto_opciones', `presupuesto_id = ${presupuesto.id}`), 0)
})

test('borrar una tarea se lleva sus comentarios', async () => {
  const base = await carteraDePrueba()
  const tarea = crearTareaCompleta(
    {
      titulo: 'Llamar a la compañía',
      detalle: 'por la cobertura',
      responsableId: DANIEL.id,
      venceEl: '',
      prioridad: 'NORMAL',
      sucursal: 'DANIEL',
      clienteId: null,
      polizaId: null,
      leadId: null,
      presupuestoId: null,
      siniestroId: null,
      renovacionId: null,
    },
    DANIEL,
  )
  base
    .prepare(`INSERT INTO tarea_comentarios (tarea_id, texto, usuario_nombre, creado_en) VALUES (?, ?, ?, ?)`)
    .run(tarea.id, 'ya llamé', DANIEL.nombre, ahoraIso())

  const vista = vistaPreviaDeEliminacion('tarea', tarea.id, DANIEL)
  assert.equal(vista.arrastra.find((l) => l.que === 'comentario de la tarea')?.cuantos, 1)

  eliminarRegistro('tarea', tarea.id, DANIEL)
  assert.equal(contar(base, 'tareas', `id = ${tarea.id}`), 0)
  assert.equal(contar(base, 'tarea_comentarios', `tarea_id = ${tarea.id}`), 0)
})

test('borrar una fila de la planilla del mes, un riesgo vario, una ampliación y un siniestro', async () => {
  const base = await carteraDePrueba()

  const cuota = unico<number>(base, 'SELECT id FROM cuotas_mes ORDER BY id DESC LIMIT 1')
  eliminarRegistro('cuota', cuota, DANIEL)
  assert.equal(contar(base, 'cuotas_mes', `id = ${cuota}`), 0)

  const riesgo = unico<number>(base, 'SELECT id FROM riesgos_varios LIMIT 1')
  eliminarRegistro('riesgo', riesgo, DANIEL)
  assert.equal(contar(base, 'riesgos_varios', `id = ${riesgo}`), 0)

  const ampliacion = unico<number>(base, 'SELECT id FROM amp LIMIT 1')
  eliminarRegistro('amp', ampliacion, DANIEL)
  assert.equal(contar(base, 'amp', `id = ${ampliacion}`), 0)

  const siniestro = unico<number>(base, 'SELECT id FROM siniestros LIMIT 1')
  eliminarRegistro('siniestro', siniestro, DANIEL)
  assert.equal(contar(base, 'siniestros', `id = ${siniestro}`), 0)
  assert.equal(contar(base, 'siniestro_observaciones', `siniestro_id = ${siniestro}`), 0)
})

test('borrar una póliza deja al cliente en la cartera', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('perez')
  const poliza = unico<number>(base, 'SELECT id FROM polizas WHERE cliente_id = ? LIMIT 1', cliente)

  const vista = vistaPreviaDeEliminacion('poliza', poliza, DANIEL)
  assert.ok(vista.advertencias.some((a) => /cliente/i.test(a)))

  eliminarRegistro('poliza', poliza, DANIEL)
  assert.equal(contar(base, 'polizas', `id = ${poliza}`), 0)
  assert.equal(contar(base, 'clientes', `id = ${cliente}`), 1, 'el cliente sigue')
  assert.equal(contar(base, 'polizas', `cliente_id = ${cliente}`), 1, 'y le queda la otra póliza')
  assert.equal(contar(base, 'cuotas_mes', `poliza_id = ${poliza}`), 0)
})

// ---------------------------------------------------------------------------
// Lo que la revisión adversarial encontró sin cubrir
// ---------------------------------------------------------------------------

test('la transacción no deja la base a medias: si una tabla queda sin contemplar, no se borra NADA', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('lopez')

  // Una tabla nueva que apunta al cliente y que ningún plan conoce. Es exactamente lo que va a pasar
  // el día que alguien agregue una tabla y se olvide del borrado: las claves foráneas están en ON y la
  // transacción entera se tiene que caer, porque un cliente borrado a medias es mucho peor que uno que
  // no se borró.
  base.exec('CREATE TABLE prueba_engancha (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id))')
  base.prepare('INSERT INTO prueba_engancha (cliente_id) VALUES (?)').run(cliente)

  const polizasAntes = contar(base, 'polizas', `cliente_id = ${cliente}`)
  const cuotasAntes = contar(base, 'cuotas_mes', `cliente_id = ${cliente}`)
  assert.ok(polizasAntes > 0 && cuotasAntes > 0, 'López tiene póliza y cuotas')

  assert.throws(
    () => eliminarRegistro('cliente', cliente, DANIEL),
    (error: unknown) => error instanceof ErrorDeNegocio && /No se borró nada/i.test((error as Error).message),
    'tiene que fallar con un mensaje que diga que no se borró nada',
  )

  assert.equal(contar(base, 'clientes', `id = ${cliente}`), 1, 'el cliente sigue')
  assert.equal(contar(base, 'polizas', `cliente_id = ${cliente}`), polizasAntes, 'y sus pólizas también')
  assert.equal(contar(base, 'cuotas_mes', `cliente_id = ${cliente}`), cuotasAntes, 'y sus cuotas')
  assert.deepEqual(base.pragma('foreign_key_check'), [])

  base.exec('DROP TABLE prueba_engancha')
})

test('el historial de lo borrado sobrevive al borrado', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('rodriguez')
  const cuota = filas<{ fila_id: string }>(base, 'SELECT fila_id FROM cuotas_mes WHERE cliente_id = ? LIMIT 1', cliente)[0]
  assert.ok(cuota)

  // Historia de verdad: alguien corrigió el teléfono de esa fila el mes pasado.
  base
    .prepare(
      `INSERT INTO historial (fecha, usuario_nombre, accion, tabla, fila_id, campo, valor_anterior, valor_nuevo)
       VALUES (?, ?, 'edicion', 'cuotas_mes', ?, 'telefono', '11 4444 5555', '11 6666 7777')`,
    )
    .run(ahoraIso(), 'Ana Ruiz', cuota.fila_id)
  const deEsaFila = contar(base, 'historial', `fila_id = '${cuota.fila_id}'`)
  assert.ok(deEsaFila > 0)

  const historialAntes = contar(base, 'historial')
  eliminarRegistro('cliente', cliente, DANIEL)

  // Es la regla 2 del servicio: el historial es la red de seguridad de la agencia y no se toca nunca.
  assert.equal(
    contar(base, 'historial', `fila_id = '${cuota.fila_id}'`),
    deEsaFila,
    'el historial de la fila borrada tiene que seguir entero',
  )
  assert.ok(contar(base, 'historial') > historialAntes, 'y encima el borrado agrega su propia entrada')
  assert.ok(
    filas<{ campo: string }>(base, `SELECT campo FROM historial WHERE fila_id = ? AND accion = 'edicion'`, cuota.fila_id).length > 0,
    'incluida la corrección vieja del teléfono',
  )
})

test('borrar una fila de la planilla se lleva su pago, su baja y su aviso', async () => {
  const base = await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = planilla.filas.find((f) => f.polizaId !== null)
  assert.ok(fila)

  // Un pago hecho contra esa fila y un aviso de rechazo de esa misma cuota.
  base
    .prepare(
      `INSERT INTO pagos (fila_id, pestana, cliente_id, poliza_id, cuota_fila_id, importe, hecho_en_la_app, creado_en, actualizado_en)
       VALUES (?, '(cargado en DM Gestión)', ?, ?, ?, '$ 1.000', 1, ?, ?)`,
    )
    .run(`PAGO:${fila.filaId}`, fila.clienteId, fila.polizaId, fila.filaId, ahoraIso(), ahoraIso())
  base
    .prepare(
      `INSERT INTO rechazos_debito (poliza_id, cliente_id, cuota_fila_id, estado, fecha, creado_en, actualizado_en)
       VALUES (?, ?, ?, 'PENDIENTE', ?, ?, ?)`,
    )
    .run(fila.polizaId, fila.clienteId, fila.filaId, '2026-08-10', ahoraIso(), ahoraIso())

  const cuotaId = unico<number>(base, 'SELECT id FROM cuotas_mes WHERE fila_id = ?', fila.filaId)
  const vista = vistaPreviaDeEliminacion('cuota', cuotaId, DANIEL)
  assert.equal(vista.arrastra.find((l) => l.que === 'pago')?.cuantos, 1)
  assert.equal(vista.arrastra.find((l) => l.que === 'aviso de rechazo')?.cuantos, 1)
  assert.ok(
    vista.advertencias.some((a) => /plata ya cobrada/i.test(a)),
    'y avisa que entre lo que se borra hay plata',
  )
  assert.ok(
    vista.advertencias.some((a) => /VIGENTE/.test(a)),
    'y que la póliza sigue vigente y se le va a dejar de cobrar',
  )

  eliminarRegistro('cuota', cuotaId, DANIEL)

  assert.equal(contar(base, 'cuotas_mes', `fila_id = '${fila.filaId}'`), 0)
  assert.equal(contar(base, 'pagos', `cuota_fila_id = '${fila.filaId}'`), 0, 'el pago se fue con la fila')
  assert.equal(contar(base, 'rechazos_debito', `cuota_fila_id = '${fila.filaId}'`), 0, 'y el aviso también')
  assert.equal(contar(base, 'polizas', `id = ${fila.polizaId}`), 1, 'la póliza no se toca')
})

test('el cartel dice la verdad sobre la última fila de una póliza vigente, y la verdad es que no vuelve', async () => {
  const base = await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = planilla.filas.find((f) => f.polizaId !== null)
  assert.ok(fila)
  const cuotaId = unico<number>(base, 'SELECT id FROM cuotas_mes WHERE fila_id = ?', fila.filaId)

  const vista = vistaPreviaDeEliminacion('cuota', cuotaId, DANIEL)
  assert.ok(
    vista.advertencias.some((a) => /única fila/i.test(a) && /cierre de mes/i.test(a) && /Dar de baja/i.test(a)),
    'tiene que decir que el cierre de mes no la va a copiar más y mandar a dar de baja',
  )
  assert.ok(
    !vista.advertencias.some((a) => /nada más/.test(a)),
    'y NO puede decir «borra la fila de ESTE mes y nada más», que es justo lo que no pasa',
  )

  eliminarRegistro('cuota', cuotaId, DANIEL)

  // Y ahora la parte que importa: que la advertencia describa lo que de verdad pasa. `cerrarMes` copia
  // el mes que viene desde las filas del mes abierto, así que una póliza sin fila no se copia nunca más.
  assert.equal(unico<number>(base, 'SELECT activa FROM polizas WHERE id = ?', fila.polizaId), 1, 'la póliza sigue vigente')
  const cierre = cerrarMes(DANIEL)
  assert.equal(
    contar(base, 'cuotas_mes', `poliza_id = ${fila.polizaId} AND periodo = '${cierre.periodo}'`),
    0,
    'la póliza vigente no entró en el mes nuevo: es exactamente lo que el cartel avisó',
  )
})

test('con dos filas de la misma póliza en el mes, borrar la que sobra no dispara el aviso grave', async () => {
  const base = await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = planilla.filas.find((f) => f.polizaId !== null)
  assert.ok(fila)

  // La hoja tenía la misma póliza cargada dos veces: dos renglones con distinto _ID. Sacar el duplicado
  // es justamente para lo que está la papelera, así que ahí el aviso grave no corresponde.
  const original = filas<Record<string, unknown>>(base, 'SELECT * FROM cuotas_mes WHERE fila_id = ?', fila.filaId)[0]
  assert.ok(original)
  base
    .prepare(
      `INSERT INTO cuotas_mes (fila_id, periodo, pestana, poliza_id, cliente_id, cliente_nombre, dada_de_baja, creado_en, actualizado_en)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      `${fila.filaId}-BIS`,
      original.periodo,
      original.pestana,
      original.poliza_id,
      original.cliente_id,
      original.cliente_nombre,
      ahoraIso(),
      ahoraIso(),
    )
  const duplicada = unico<number>(base, 'SELECT id FROM cuotas_mes WHERE fila_id = ?', `${fila.filaId}-BIS`)

  const vista = vistaPreviaDeEliminacion('cuota', duplicada, DANIEL)
  assert.ok(!vista.advertencias.some((a) => /única fila/i.test(a)), 'no es la única fila: no corresponde el aviso grave')
  assert.ok(vista.advertencias.some((a) => /nada más/.test(a)), 'y sí el de siempre')

  eliminarRegistro('cuota', duplicada, DANIEL)
  assert.equal(contar(base, 'cuotas_mes', `poliza_id = ${fila.polizaId} AND periodo = '${original.periodo}'`), 1, 'quedó una sola')
})

test('el título del cartel identifica el registro en todos los tipos', async () => {
  const base = await carteraDePrueba()

  const cliente = idDeCliente('gonzalez')
  assert.match(vistaPreviaDeEliminacion('cliente', cliente, DANIEL).titulo, /GONZALEZ/i)

  const poliza = unico<number>(base, 'SELECT id FROM polizas WHERE cliente_id = ? LIMIT 1', cliente)
  assert.match(vistaPreviaDeEliminacion('poliza', poliza, DANIEL).titulo, /GONZALEZ/i)

  const cuota = unico<number>(base, 'SELECT id FROM cuotas_mes WHERE cliente_id = ? LIMIT 1', cliente)
  assert.match(vistaPreviaDeEliminacion('cuota', cuota, DANIEL).titulo, /GONZALEZ/i)

  // El riesgo y la ampliación pueden venir de la hoja sin la columna NOMBRE: el nombre sale de la ficha
  // del cliente, igual que en la pantalla desde la que se apretó el botón.
  const riesgo = unico<number>(base, 'SELECT id FROM riesgos_varios LIMIT 1')
  base.prepare('UPDATE riesgos_varios SET cliente_nombre = NULL, cliente_id = ? WHERE id = ?').run(cliente, riesgo)
  assert.match(
    vistaPreviaDeEliminacion('riesgo', riesgo, DANIEL).titulo,
    /GONZALEZ/i,
    'sin NOMBRE propio, el título tiene que salir de la ficha y no decir «Sin nombre»',
  )

  const ampliacion = unico<number>(base, 'SELECT id FROM amp LIMIT 1')
  base.prepare('UPDATE amp SET cliente_nombre = NULL, cliente_id = ? WHERE id = ?').run(cliente, ampliacion)
  assert.match(vistaPreviaDeEliminacion('amp', ampliacion, DANIEL).titulo, /GONZALEZ/i)
})

test('el renglón se saca de la pestaña donde vive de verdad, no de la que dice la tabla', async () => {
  const base = await carteraDePrueba()
  const planilla = planillaDelMes(null)
  const fila = planilla.filas.find((f) => f.polizaId !== null)
  assert.ok(fila)
  darDeBaja(fila.filaId, { motivo: 'VENDIO', nota: '' }, DANIEL)
  const baja = bajasDelMes(planilla.periodo)[0]
  assert.ok(baja)

  // Una baja hecha en la aplicación se guarda con `bajas.pestana = '(cargado en DM Gestión)'`, que no es
  // ninguna pestaña real; la de verdad está en `filas_crudas` y la puso `registrarFilaDeLaApp`. Encolar
  // contra la de la tabla mandaría el borrado a una pestaña que no existe y la fila quedaría en Google.
  const enLaTabla = unico<string>(base, 'SELECT pestana FROM bajas WHERE id = ?', baja.id)
  assert.equal(enLaTabla, '(cargado en DM Gestión)', 'la tabla guarda la pestaña de lo que todavía no viajó')

  vaciarCola(base)
  eliminarRegistro('baja', baja.id, DANIEL)

  const encolado = borradosEncolados(base)[0]
  assert.ok(encolado, 'se encoló el borrado del renglón')
  assert.notEqual(encolado.pestana, '(cargado en DM Gestión)')
  assert.match(encolado.pestana, /^BAJAS/, `esperaba una pestaña de BAJAS y fue «${encolado?.pestana}»`)
})

test('el «crear» que ya se había dado por perdido también sale de la cola', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('suarez')
  const cuota = filas<{ fila_id: string; pestana: string }>(
    base,
    'SELECT fila_id, pestana FROM cuotas_mes WHERE cliente_id = ? LIMIT 1',
    cliente,
  )[0]
  assert.ok(cuota)
  vaciarCola(base)

  // Una entrada que agotó sus ocho intentos y quedó en «no se pudo». `reintentarFallidas` la volvería a
  // poner en la cola, así que dejarla viva es lo mismo que dejar viva una pendiente.
  encolar({ operacion: 'crear', pestana: cuota.pestana, filaId: cuota.fila_id, campos: {} }, DANIEL)
  base.prepare(`UPDATE cola_sync SET estado = 'fallido' WHERE fila_id = ?`).run(cuota.fila_id)
  assert.equal(contar(base, 'cola_sync', `fila_id = '${cuota.fila_id}' AND estado = 'fallido'`), 1)

  eliminarRegistro('cliente', cliente, DANIEL)

  assert.equal(
    contar(base, 'cola_sync', `fila_id = '${cuota.fila_id}' AND operacion <> 'borrar'`),
    0,
    'la fallida también se canceló',
  )
})

test('los adjuntos del siniestro se borran del disco, y se cuentan antes', async () => {
  const base = await carteraDePrueba()
  const carpeta = mkdtempSync(path.join(tmpdir(), 'dm-adjuntos-'))
  carpetasTemporales.push(carpeta)
  // Se deja puesta al salir: `siniestros.prueba.ts` y `fase8.prueba.ts` también la usan, y volverla a
  // null haría que la siguiente prueba que toque un adjunto termine en `app.getPath`, que fuera de
  // Electron no existe. Una carpeta temporal válida es lo correcto para todas.
  usarCarpetaDeAdjuntosDePrueba(carpeta)
  {
    const siniestro = unico<number>(base, 'SELECT id FROM siniestros LIMIT 1')
    const origen = path.join(carpeta, 'denuncia.txt')
    writeFileSync(origen, 'la denuncia del granizo')
    const copiado = copiarAdjunto(siniestro, origen)
    base
      .prepare(
        `INSERT INTO siniestro_adjuntos (siniestro_id, nombre, archivo, tamano, usuario_nombre, creado_en)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(siniestro, copiado.nombre, copiado.archivo, copiado.tamano, DANIEL.nombre, ahoraIso())
    assert.equal(existsSync(rutaDeAdjunto(copiado.archivo)), true, 'el archivo está antes de borrar')

    const vista = vistaPreviaDeEliminacion('siniestro', siniestro, DANIEL)
    assert.equal(vista.archivos, 1, 'el cartel dice cuántos archivos se van del disco')
    assert.ok(
      vista.advertencias.some((a) => /Drive/i.test(a)),
      'y avisa que la copia del Drive hay que sacarla desde Google',
    )

    const resultado = eliminarRegistro('siniestro', siniestro, DANIEL)
    assert.equal(resultado.archivos, 1)
    assert.equal(existsSync(rutaDeAdjunto(copiado.archivo)), false, 'el archivo se borró del disco')
    assert.equal(contar(base, 'siniestro_adjuntos', `siniestro_id = ${siniestro}`), 0)
  }
})

test('el presupuesto se borra con todas sus versiones', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('lopez')
  const primera = crearPresupuesto(
    {
      leadId: null,
      clienteId: cliente,
      clienteNombre: 'LOPEZ CARLOS ALBERTO',
      telefono: '',
      documento: '',
      sucursal: 'SARANDI',
      patente: 'AD789GH',
      marca: 'CHEVROLET',
      modelo: 'ONIX',
      anio: '2020',
      tipoVehiculo: 'AUTO',
      observaciones: '',
      opciones: [{ compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 20.000', comentario: '' }],
    },
    DANIEL,
  ).presupuesto

  // Una vez enviado, guardar no edita: crea la versión siguiente y deja la anterior como estaba.
  base.prepare(`UPDATE presupuestos SET estado = 'ENVIADO' WHERE id = ?`).run(primera.id)
  const segunda = guardarPresupuesto(
    primera.id,
    {
      leadId: null,
      clienteId: cliente,
      clienteNombre: 'LOPEZ CARLOS ALBERTO',
      telefono: '',
      documento: '',
      sucursal: 'SARANDI',
      patente: 'AD789GH',
      marca: 'CHEVROLET',
      modelo: 'ONIX',
      anio: '2020',
      tipoVehiculo: 'AUTO',
      observaciones: 'bajó el precio',
      opciones: [{ compania: 'SANCOR', cobertura: 'TERCEROS COMPLETO', precio: '$ 18.000', comentario: '' }],
    },
    DANIEL,
  ).presupuesto
  assert.notEqual(segunda.id, primera.id, 'se creó una versión nueva')
  assert.equal(contar(base, 'presupuestos', `numero = '${primera.numero}'`), 2)

  const vista = vistaPreviaDeEliminacion('presupuesto', segunda.id, DANIEL)
  assert.equal(vista.arrastra.find((l) => l.que === 'versión del presupuesto')?.cuantos, 2)
  assert.ok(
    vista.advertencias.some((a) => /versiones/i.test(a)),
    'el cartel avisa que se lleva las dos, no sólo la que se está mirando',
  )

  eliminarRegistro('presupuesto', segunda.id, DANIEL)
  assert.equal(contar(base, 'presupuestos', `numero = '${primera.numero}'`), 0, 'no queda ninguna versión colgando')
  assert.equal(contar(base, 'presupuesto_opciones', `presupuesto_id IN (${primera.id}, ${segunda.id})`), 0)
})

test('el cartel avisa cuando la persona está asegurada hoy', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente('gonzalez')
  const vista = vistaPreviaDeEliminacion('cliente', cliente, DANIEL)
  assert.ok(
    vista.advertencias.some((a) => /asegurada HOY/i.test(a) && /dar(la)? de baja/i.test(a)),
    'tiene que decir que está asegurada hoy y mandar a dar de baja en vez de borrar',
  )
})

test('los avisos de sincronización dicen la verdad según el tipo', async () => {
  const base = await carteraDePrueba()

  // Un cliente SÍ se reconstruye desde la hoja: el aviso de la reimportación corresponde.
  const cliente = idDeCliente('lopez')
  const deCliente = vistaPreviaDeEliminacion('cliente', cliente, DANIEL)
  assert.ok(deCliente.filasDeLaHoja > 0)
  assert.ok(deCliente.advertencias.some((a) => /importación completa/i.test(a)))
  assert.ok(deCliente.advertencias.some((a) => /otras computadoras/i.test(a)))

  // Un presupuesto NO: el importador no lo lee de vuelta, así que prometerlo sería mentir.
  const presupuesto = crearPresupuesto(
    {
      leadId: null,
      clienteId: null,
      clienteNombre: 'CONSULTA SUELTA',
      telefono: '',
      documento: '',
      sucursal: 'DANIEL',
      patente: '',
      marca: '',
      modelo: '',
      anio: '',
      tipoVehiculo: 'AUTO',
      observaciones: '',
      opciones: [{ compania: 'SANCOR', cobertura: 'TERCEROS', precio: '$ 9.000', comentario: '' }],
    },
    DANIEL,
  ).presupuesto
  // Se lo hace pasar por subido, para que tenga renglón y el aviso pueda aparecer.
  base.prepare('UPDATE filas_crudas SET en_la_hoja = 1, numero_fila = 12 WHERE fila_id = ?').run(presupuesto.filaId)
  const dePresupuesto = vistaPreviaDeEliminacion('presupuesto', presupuesto.id, DANIEL)
  assert.ok(dePresupuesto.filasDeLaHoja > 0, 'tiene renglón')
  assert.ok(
    !dePresupuesto.advertencias.some((a) => /importación completa/i.test(a)),
    'pero NO se avisa una reimportación que no lo va a revivir',
  )
  assert.ok(dePresupuesto.advertencias.some((a) => /otras computadoras/i.test(a)), 'lo de las otras PCs sí vale igual')
})

test('lo que se desenlaza no se borra: el presupuesto de una póliza que se va', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('rodriguez')
  const poliza = unico<number>(base, 'SELECT id FROM polizas WHERE cliente_id = ? LIMIT 1', cliente)
  const presupuesto = crearPresupuesto(
    {
      leadId: null,
      clienteId: null,
      clienteNombre: 'OTRO CLIENTE',
      telefono: '',
      documento: '',
      sucursal: 'DANIEL',
      patente: '',
      marca: '',
      modelo: '',
      anio: '',
      tipoVehiculo: 'AUTO',
      observaciones: '',
      opciones: [{ compania: 'ZURICH', cobertura: 'TODO RIESGO', precio: '$ 40.000', comentario: '' }],
    },
    DANIEL,
  ).presupuesto
  base.prepare('UPDATE presupuestos SET poliza_id = ? WHERE id = ?').run(poliza, presupuesto.id)

  const vista = vistaPreviaDeEliminacion('poliza', poliza, DANIEL)
  assert.ok(vista.advertencias.some((a) => /presupuesto/i.test(a)), 'el cartel dice que el presupuesto queda')

  eliminarRegistro('poliza', poliza, DANIEL)
  assert.equal(contar(base, 'presupuestos', `id = ${presupuesto.id}`), 1, 'la cotización no se borra')
  assert.equal(unico<number | null>(base, 'SELECT poliza_id FROM presupuestos WHERE id = ?', presupuesto.id), null)
})

test('un borrado nunca hace que se cree una pestaña nueva en la hoja', async () => {
  const base = await carteraDePrueba()
  vaciarCola(base)

  // La agencia archivó las planillas viejas: «MARZO 2021» ya no está en la hoja. Borrar un cliente de
  // esa época encola el borrado de sus filas igual, y el motor pregunta a qué pestañas hay que
  // escribir para crear las que falten. Si el borrado contara, crearía una pestaña vacía por cada mes
  // archivado, nada más que para sacarle una fila que tampoco está.
  encolar({ operacion: 'borrar', pestana: 'MARZO 2021', filaId: 'FILA-VIEJA', campos: {} }, DANIEL)
  assert.deepEqual(pestanasPendientes(), [], 'una pestaña donde lo único pendiente es un borrado no se crea')

  encolar({ operacion: 'crear', pestana: 'MARZO 2021', filaId: 'FILA-NUEVA', campos: {} }, DANIEL)
  assert.deepEqual(pestanasPendientes(), ['MARZO 2021'], 'pero si además hay algo que escribir, sí hace falta')
})

test('la fila que ya no está en la hoja no se cuenta como renglón a sacar', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('lopez')
  const conTodas = vistaPreviaDeEliminacion('cliente', cliente, DANIEL).filasDeLaHoja
  assert.ok(conTodas > 1)

  // Una de sus filas ya salió de la hoja (una baja de un mes anterior la sacó, y la bajada la marcó).
  const alguna = filas<{ fila_id: string }>(
    base,
    'SELECT fila_id FROM cuotas_mes WHERE cliente_id = ? AND fila_id IN (SELECT fila_id FROM filas_crudas WHERE en_la_hoja = 1) LIMIT 1',
    cliente,
  )[0]
  assert.ok(alguna)
  base.prepare('UPDATE filas_crudas SET en_la_hoja = 0 WHERE fila_id = ?').run(alguna.fila_id)

  assert.equal(
    vistaPreviaDeEliminacion('cliente', cliente, DANIEL).filasDeLaHoja,
    conTodas - 1,
    'el cartel no promete sacar de Google un renglón que ya no está ahí',
  )
})

// ---------------------------------------------------------------------------
// Redacción
// ---------------------------------------------------------------------------

test('el resumen de lo borrado se lee en castellano', () => {
  assert.equal(resumenDeLoBorrado([]), '')
  assert.equal(resumenDeLoBorrado([{ que: 'póliza', cuantos: 1 }]), '1 póliza')
  assert.equal(resumenDeLoBorrado([{ que: 'póliza', cuantos: 3 }]), '3 pólizas')
  assert.equal(
    resumenDeLoBorrado([
      { que: 'póliza', cuantos: 2 },
      { que: 'cuota del mes', cuantos: 12 },
      { que: 'ampliación', cuantos: 1 },
    ]),
    '2 pólizas, 12 cuotas del mes y 1 ampliación',
  )
  assert.equal(resumenDeLoBorrado([{ que: 'lead', cuantos: 4 }]), '4 leads')
  assert.equal(resumenDeLoBorrado([{ que: 'riesgo vario', cuantos: 2 }]), '2 riesgos varios')
  assert.equal(resumenDeLoBorrado([{ que: 'póliza', cuantos: 0 }]), '', 'lo que no hay no se nombra')
})

test('después de borrar, la base sigue abierta y consultable', async () => {
  const base = await carteraDePrueba()
  const cliente = idDeCliente('gonzalez')
  eliminarRegistro('cliente', cliente, DANIEL)
  // Las pantallas que quedaron abiertas vuelven a consultar: nada tiene que reventar por una fila que ya no está.
  assert.doesNotThrow(() => listarClientes(SIN_FILTROS))
  assert.doesNotThrow(() => planillaDelMes(null))
  assert.equal(db(), base)
})
