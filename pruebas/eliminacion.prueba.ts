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
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, db, type BaseDeDatos } from '../src/main/db/base'
import { eliminarRegistro, vistaPreviaDeEliminacion } from '../src/main/servicios/eliminacion'
import { ErrorDeNegocio } from '../src/main/servicios/errores'
import { agregarNota, crearTarea, listarClientes } from '../src/main/servicios/clientes'
import { bajasDelMes, darDeBaja, planillaDelMes } from '../src/main/servicios/cartera'
import { avisarRechazo, listarRechazos } from '../src/main/servicios/rechazos'
import { crearLead } from '../src/main/servicios/leads'
import { crearSiniestro } from '../src/main/servicios/siniestros'
import { crearPresupuesto } from '../src/main/servicios/presupuestos'
import { crearTareaCompleta } from '../src/main/servicios/tareas'
import { encolar } from '../src/main/sincronizacion/cola'
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
  for (const tabla of ['notas', 'tareas', 'siniestros', 'rechazos_debito', 'presupuesto_opciones', 'tarea_comentarios']) {
    assert.equal(contar(base, tabla, `1 = 1`) >= 0, true, `${tabla} consultable`)
  }
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
  assert.equal(resultado.filasDeLaHoja, 0)
  assert.equal(borradosEncolados(base).length, 0, 'no hay renglón que sacar de la hoja')
  assert.equal(contar(base, 'cola_sync', `fila_id = '${lead.filaId}'`), 0, 'y el crear pendiente se canceló')
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
