// El módulo Clientes contra la hoja simulada: el listado con sus filtros, la ficha completa y —lo que
// pidió el pliego— que cargar un DNI que ya existe NO cree un duplicado.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import {
  agregarNota,
  buscarClientes,
  cambiarEstadoDeTarea,
  crearCliente,
  crearTarea,
  editarCliente,
  fichaDeCliente,
  listarClientes,
} from '../src/main/servicios/clientes'
import { cuotasDelClienteEnElMes } from '../src/main/servicios/cartera'
import { crearSiniestro } from '../src/main/servicios/siniestros'
import { DIRECCION_VACIA, direccionTienePartes, partesDesdeRenglon, sanearDireccion, textoDeDireccion } from '../src/shared/direccion'
import { hoyLocal } from '../src/shared/semaforo'
import { darDeBajaPoliza } from '../src/main/servicios/polizas'
import { cuantasPendientes } from '../src/main/sincronizacion/cola'
import type { DatosDeCliente, FichaCliente, FiltrosClientes, SesionUsuario } from '../src/shared/tipos'
import { CLIENTES, construirHojaDePrueba } from './hoja-de-prueba'
import { HojaSimulada } from './hoja-simulada'
import { filas, importar } from './ayuda'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

const SIN_FILTROS: FiltrosClientes = { busqueda: '', sucursales: [], companias: [], estado: '' }

/** Los datos editables sacados de la ficha, igual que hace la pantalla. */
function datosDe(ficha: FichaCliente): DatosDeCliente {
  return {
    nombre: ficha.nombre,
    documento: ficha.documento ?? '',
    telefono: ficha.telefono ?? '',
    email: ficha.email ?? '',
    direccion: ficha.direccion ?? '',
    localidad: ficha.localidad ?? '',
    sucursal: ficha.sucursal ?? '',
    fechaNacimiento: ficha.fechaNacimiento ?? '',
    direccionDetalle: ficha.direccionDetalle,
  }
}

const VACIO: DatosDeCliente = {
  nombre: '',
  documento: '',
  telefono: '',
  email: '',
  direccion: '',
  localidad: '',
  sucursal: '',
  fechaNacimiento: '',
  direccionDetalle: DIRECCION_VACIA,
}

/**
 * Cartera de prueba con DOS importaciones, que es lo que pasa mes a mes en la agencia: primero la hoja
 * hasta JULIO y después con AGOSTO agregada. Sólo así queda algo dado de baja de verdad —Fernández se
 * fue en julio— y se puede probar el histórico de la ficha. Con una sola corrida toda la cartera sale
 * activa, porque el importador arma clientes y pólizas desde la planilla más nueva.
 */
async function carteraDePrueba(): Promise<BaseDeDatos> {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar

  const hoja = new HojaSimulada(construirHojaDePrueba())
  const agosto = hoja.quitarPestana('AGOSTO')
  const bajasAgosto = hoja.quitarPestana('BAJAS AGOSTO')
  await importar(db, hoja)
  hoja.restaurarPestana(agosto)
  hoja.restaurarPestana(bajasAgosto)
  await importar(db, hoja)
  return db
}

/** El id del cliente cuyo nombre aparece en la planilla. */
function idDe(nombre: string): number {
  const encontrado = listarClientes({ ...SIN_FILTROS, busqueda: nombre }).filas[0]
  if (!encontrado) throw new Error(`No está «${nombre}» en el listado de clientes`)
  return encontrado.id
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

test('el listado trae los clientes de la cartera con sus pólizas y vehículos', async () => {
  await carteraDePrueba()
  const listado = listarClientes(SIN_FILTROS)

  // Siete filas en la planilla, pero menos clientes: Pérez tiene auto y moto, y González y Martínez
  // comparten el DNI (el importador los unifica a propósito).
  assert.ok(listado.filas.length >= 5, `esperaba al menos 5 clientes, hubo ${listado.filas.length}`)
  assert.equal(listado.total, listado.filas.length, 'sin filtros, lo listado y el total coinciden')
  assert.ok(listado.sucursales.length > 0, 'el catálogo de sucursales alimenta el filtro')
  assert.ok(listado.companias.includes('SANCOR'))

  const perez = listado.filas.find((f) => f.documento && f.documento.includes('30111222'))
  assert.ok(perez, 'Pérez tiene que estar')
  assert.equal(perez.polizasActivas, 2, 'el auto y la moto')
  assert.equal(perez.vehiculos, 2)
})

test('la búsqueda encuentra por nombre, documento, patente y número de póliza', async () => {
  await carteraDePrueba()
  const porNombre = listarClientes({ ...SIN_FILTROS, busqueda: 'gonzalez' })
  assert.equal(porNombre.filas.length, 1, 'busca sin importar mayúsculas ni tildes')

  // El documento se busca normalizado: en la hoja está «20-30111222-3» y se escribe el DNI pelado.
  assert.equal(listarClientes({ ...SIN_FILTROS, busqueda: '30111222' }).filas.length, 1)
  assert.equal(listarClientes({ ...SIN_FILTROS, busqueda: CLIENTES.lopez.patente }).filas.length, 1, 'por patente')
  assert.equal(listarClientes({ ...SIN_FILTROS, busqueda: CLIENTES.suarez.poliza }).filas.length, 1, 'por número de póliza')
  assert.equal(listarClientes({ ...SIN_FILTROS, busqueda: 'no existe nadie así' }).filas.length, 0)
})

test('los filtros de sucursal, compañía y deuda acotan el listado', async () => {
  await carteraDePrueba()
  const todos = listarClientes(SIN_FILTROS)

  const deLanus = listarClientes({ ...SIN_FILTROS, sucursales: ['LANUS'] })
  assert.ok(deLanus.filas.length > 0 && deLanus.filas.length < todos.filas.length)
  assert.ok(
    deLanus.filas.every((f) => f.sucursal === 'Lanús'),
    'todas las filas filtradas son de esa sucursal',
  )

  const deSancor = listarClientes({ ...SIN_FILTROS, companias: ['SANCOR'] })
  assert.ok(deSancor.filas.every((f) => f.companias.includes('SANCOR')))

  const conDeuda = listarClientes({ ...SIN_FILTROS, estado: 'activos-con-deuda' })
  const alDia = listarClientes({ ...SIN_FILTROS, estado: 'activos-sin-deuda' })
  const bajas = listarClientes({ ...SIN_FILTROS, estado: 'bajas' })
  const sinPolizas = listarClientes({ ...SIN_FILTROS, estado: 'sin-polizas' })
  assert.equal(
    conDeuda.filas.length + alDia.filas.length + bajas.filas.length + sinPolizas.filas.length,
    todos.filas.length,
    'los cuatro estados parten el listado sin superponerse ni dejar a nadie afuera',
  )
  assert.ok(conDeuda.filas.every((f) => f.conDeuda && f.estado === 'ACTIVO'))
  assert.ok(alDia.filas.every((f) => !f.conDeuda && f.estado === 'ACTIVO'))
  // El total no se mueve con los filtros: es cuántos clientes hay en la base.
  assert.equal(conDeuda.total, todos.filas.length)

  // Y el resumen dice de antemano cuántos va a traer cada uno: es lo que muestran los botones.
  assert.equal(todos.resumen.todos, todos.filas.length)
  assert.equal(todos.resumen.activosConDeuda, conDeuda.filas.length)
  assert.equal(todos.resumen.activosSinDeuda, alDia.filas.length)
  assert.equal(todos.resumen.bajas, bajas.filas.length)
  assert.deepEqual(conDeuda.resumen, todos.resumen, 'el resumen no depende del estado elegido')
})

test('el que se fue queda como baja y el que nunca tuvo póliza no', async () => {
  await carteraDePrueba()
  // Fernández se dio de baja en julio: no le queda ninguna póliza activa.
  const fernandez = listarClientes({ ...SIN_FILTROS, busqueda: CLIENTES.fernandez.nombre }).filas[0]
  assert.ok(fernandez)
  assert.equal(fernandez.estado, 'BAJA')
  assert.equal(fernandez.polizasActivas, 0)

  const bajas = listarClientes({ ...SIN_FILTROS, estado: 'bajas' })
  assert.ok(
    bajas.filas.some((f) => f.id === fernandez.id),
    'y aparece al filtrar por bajas',
  )

  // Un alta a mano todavía no tiene pólizas: no es una baja, y decirle baja sería mentir.
  const nuevo = crearCliente({ ...VACIO, nombre: 'TESTA MARIANO', documento: '11222333' }, DANIEL)
  assert.equal(nuevo.creado, true)
  const recienCreado = listarClientes({ ...SIN_FILTROS, busqueda: 'TESTA' }).filas[0]
  assert.ok(recienCreado)
  assert.equal(recienCreado.estado, 'SIN POLIZAS')
  assert.equal(listarClientes({ ...SIN_FILTROS, estado: 'bajas' }).filas.length, bajas.filas.length, 'no se sumó a las bajas')
  assert.ok(listarClientes({ ...SIN_FILTROS, estado: 'sin-polizas' }).filas.some((f) => f.id === recienCreado.id))
})

test('el débito automático no cuenta como deuda aunque la cuota no esté paga', async () => {
  await carteraDePrueba()
  // González paga por DEBITO en la hoja simulada: se cobra sola, no hay que perseguirla.
  const gonzalez = listarClientes({ ...SIN_FILTROS, busqueda: CLIENTES.gonzalez.nombre }).filas[0]
  assert.ok(gonzalez)
  assert.equal(gonzalez.conDeuda, false, 'la que se cobra sola nunca figura con deuda')
})

test('el buscador del formulario de póliza devuelve pocas filas', async () => {
  await carteraDePrueba()
  const encontrados = buscarClientes('perez')
  assert.equal(encontrados.length, 1)
  assert.ok(encontrados[0]!.nombre.includes('PEREZ'))
  assert.equal(buscarClientes('').length, 0, 'sin texto no devuelve la cartera entera')
})

// ---------------------------------------------------------------------------
// Ficha
// ---------------------------------------------------------------------------

test('un cliente que se fue sigue teniendo ficha, con su póliza en el histórico', async () => {
  await carteraDePrueba()
  // Fernández se dio de baja en julio: no está en la planilla de agosto, pero su ficha y su historia
  // tienen que poder consultarse (es lo que se mira cuando llama para volver o para reclamar algo).
  const ficha = fichaDeCliente(idDe(CLIENTES.fernandez.nombre))

  assert.ok(ficha.nombre.includes('FERNANDEZ'))
  assert.ok(ficha.vehiculos.length >= 1, 'el vehículo queda en la ficha')

  const historico = ficha.polizas.filter((p) => p.estado === 'BAJA')
  assert.equal(historico.length, 1)
  assert.equal(historico[0]!.numero, CLIENTES.fernandez.poliza)
  assert.ok(historico[0]!.motivoBaja, 'con el motivo que trajo la hoja')
  assert.equal(ficha.polizas.filter((p) => p.estado === 'ACTIVA').length, 0, 'no le queda ninguna activa')
})

test('la ficha separa las pólizas activas del histórico, con el motivo de cada baja', async () => {
  await carteraDePrueba()
  // Pérez tiene dos pólizas (el auto y la moto): se da de baja una y tiene que quedar en el histórico
  // con su motivo, mientras la otra sigue activa.
  const perez = idDe(CLIENTES.perezAuto.nombre)
  const laMoto = fichaDeCliente(perez).polizas.find((p) => p.numero === CLIENTES.perezMoto.poliza)
  assert.ok(laMoto, 'la moto tiene que estar entre las pólizas de Pérez')

  darDeBajaPoliza(laMoto.id, { motivo: 'VENDIO', nota: 'Vendió la moto' }, DANIEL)

  const ficha = fichaDeCliente(perez)
  assert.equal(ficha.vehiculos.length, 2, 'el vehículo no se borra: es parte de la historia del cliente')

  const activas = ficha.polizas.filter((p) => p.estado === 'ACTIVA')
  const historico = ficha.polizas.filter((p) => p.estado === 'BAJA')
  assert.equal(activas.length, 1, 'le queda el auto')
  assert.equal(historico.length, 1, 'y la moto pasa al histórico')
  assert.equal(historico[0]!.motivoBaja, 'VENDIO', 'con su motivo, que es lo que se mira al reclamar')
  assert.ok(historico[0]!.fechaBaja, 'y con la fecha')
})

test('la ficha de un cliente con dos vehículos muestra las dos pólizas activas', async () => {
  await carteraDePrueba()
  const ficha = fichaDeCliente(idDe(CLIENTES.perezAuto.nombre))
  const activas = ficha.polizas.filter((p) => p.estado === 'ACTIVA')
  assert.equal(activas.length, 2)
  assert.equal(ficha.vehiculos.length, 2)
  // Cada póliza trae la cuota del mes abierto, que es lo que se consulta cuando llama el cliente.
  assert.ok(activas.every((p) => p.cuota), 'las pólizas activas traen su cuota del mes')
})

// ---------------------------------------------------------------------------
// Alta sin duplicados: el criterio de aceptación N°1 del pliego
// ---------------------------------------------------------------------------

test('cargar un cliente con un DNI que ya existe NO crea un duplicado: ofrece el existente', async () => {
  await carteraDePrueba()
  const antes = listarClientes(SIN_FILTROS).filas.length

  const resultado = crearCliente({ ...VACIO, nombre: 'GONZALEZ M. L.', documento: '27.345.678', sucursal: 'DOCK SUD' }, DANIEL)

  assert.equal(resultado.creado, false, 'no se crea nada')
  if (resultado.creado) throw new Error('inalcanzable')
  assert.ok(resultado.yaExiste.id > 0, 'devuelve el cliente que ya estaba, para poder abrirlo')
  assert.ok(resultado.motivo.length > 0, 'con un motivo redactado para mostrar tal cual')
  assert.ok(/27/.test(resultado.motivo), 'el motivo nombra el documento repetido')
  assert.equal(listarClientes(SIN_FILTROS).filas.length, antes, 'la cantidad de clientes no cambió')
})

test('el DNI repetido se detecta aunque esté escrito distinto (con puntos, o como CUIT)', async () => {
  await carteraDePrueba()
  // «20-30111222-3» y «30.111.222» son la misma persona: el CUIT de persona física lleva el DNI adentro.
  for (const documento of ['30111222', '30.111.222', '20-30111222-3', '20301112223']) {
    const resultado = crearCliente({ ...VACIO, nombre: 'OTRO PEREZ', documento }, DANIEL)
    assert.equal(resultado.creado, false, `«${documento}» tendría que reconocerse como repetido`)
  }
})

test('un cliente nuevo con un documento que no está se crea normalmente', async () => {
  await carteraDePrueba()
  const antes = listarClientes(SIN_FILTROS).filas.length

  const resultado = crearCliente(
    { ...VACIO, nombre: 'ALVAREZ LUCIA', documento: '35.111.999', telefono: '11-5555-1234', sucursal: 'DOCK SUD' },
    DANIEL,
  )

  assert.equal(resultado.creado, true)
  if (!resultado.creado) throw new Error('inalcanzable')
  assert.equal(resultado.cliente.nombre, 'ALVAREZ LUCIA')
  assert.equal(listarClientes(SIN_FILTROS).filas.length, antes + 1)

  // Un cliente sin póliza no tiene fila de PÓLIZA en la hoja (la mensual es una fila por póliza), pero
  // desde la 15.4 sí se le crea su fila propia en APP CLIENTES, así que algo queda para subir.
  assert.equal(cuantasPendientes(), 1, 'el alta encola la fila propia del cliente en APP CLIENTES')
})

test('el nombre es obligatorio y el documento puede faltar', async () => {
  await carteraDePrueba()
  assert.throws(() => crearCliente({ ...VACIO, nombre: '  ' }, DANIEL), /nombre/i)

  // En la hoja real hay clientes sin documento: no se puede exigir.
  const resultado = crearCliente({ ...VACIO, nombre: 'SIN DOCUMENTO SA' }, DANIEL)
  assert.equal(resultado.creado, true)
})

// ---------------------------------------------------------------------------
// Edición, notas y tareas
// ---------------------------------------------------------------------------

test('editar cualquier dato de un cliente importado NO le borra la dirección que vino de la hoja', async () => {
  await carteraDePrueba()
  const id = idDe(CLIENTES.lopez.nombre)

  // Un cliente como los ~2.100 que ya están: dirección y localidad de texto libre, sin las partes
  // nuevas cargadas. Es el estado en el que quedan todos después de la migración.
  const conDireccionVieja = { ...datosDe(fichaDeCliente(id)), direccion: 'Mitre 1234', localidad: 'Lanús' }
  editarCliente(id, conDireccionVieja, DANIEL)
  assert.equal(fichaDeCliente(id).direccion, 'Mitre 1234')

  // Y ahora se cambia SÓLO el celular, que es lo que hace cualquiera en la ficha. Sin tocar la
  // dirección, la dirección no se puede mover.
  editarCliente(id, { ...conDireccionVieja, telefono: '11-2222-3333' }, DANIEL)

  const despues = fichaDeCliente(id)
  assert.equal(despues.telefono, '11-2222-3333')
  assert.equal(despues.direccion, 'Mitre 1234', 'cambiar el celular no puede borrar la dirección')
  assert.equal(despues.localidad, 'Lanús', 'ni la localidad')
})

test('cargar la dirección en partes reemplaza el renglón viejo, y vaciarla no lo resucita', async () => {
  await carteraDePrueba()
  const id = idDe(CLIENTES.lopez.nombre)
  const base = { ...datosDe(fichaDeCliente(id)), direccion: 'Mitre 1234', localidad: 'Lanús' }
  editarCliente(id, base, DANIEL)

  // Cargada en partes, el renglón se ARMA con ellas y pisa al viejo: si no, la ficha guardaría dos
  // direcciones distintas y nadie sabría cuál manda.
  const conPartes = editarCliente(
    id,
    {
      ...base,
      direccionDetalle: sanearDireccion({
        calle: 'Belgrano',
        altura: '567',
        provincia: 'Buenos Aires',
        localidad: 'Sarandí',
        codigoPostal: 'B1872',
      }),
    },
    DANIEL,
  )
  assert.equal(conPartes.direccion, 'Belgrano 567')
  assert.equal(conPartes.localidad, 'Sarandí')
  assert.equal(conPartes.direccionDetalle.codigoPostal, 'B1872')

  // Y si después alguien vacía las partes con el botón «Vaciar», queda vacío: no vuelve el renglón
  // viejo, que ya no existe en ningún lado.
  const vaciada = editarCliente(id, { ...base, direccion: '', localidad: '', direccionDetalle: DIRECCION_VACIA }, DANIEL)
  assert.equal(vaciada.direccion, null)
  assert.equal(vaciada.direccionDetalle.calle, '')
})

test('la dirección que cambió otra computadora se ve, y guardar otro campo no le sube la vieja', async () => {
  const db = await carteraDePrueba()
  const id = idDe(CLIENTES.lopez.nombre)
  const base = datosDe(fichaDeCliente(id))

  // Esta computadora la cargó en partes.
  editarCliente(
    id,
    { ...base, direccionDetalle: sanearDireccion({ calle: 'Belgrano', altura: '567', provincia: 'Buenos Aires', localidad: 'Sarandí' }) },
    DANIEL,
  )
  // El refresco devuelve las mismas partes: el renglón es de ellas.
  assert.equal(fichaDeCliente(id).direccionDetalle.calle, 'Belgrano')

  // Otra computadora la cambió: a esta base baja SOLO el renglón y la localidad (bajada.ts / importador),
  // las partes de acá no se tocan.
  db.prepare(`UPDATE clientes SET direccion = 'Mitre 1234', localidad = 'Lanús' WHERE id = ?`).run(id)

  const ficha = fichaDeCliente(id)
  assert.equal(ficha.direccion, 'Mitre 1234')
  assert.equal(ficha.direccionDetalle.calle, '', 'las partes viejas no pueden tapar la dirección nueva')
  assert.equal(ficha.direccionDetalle.localidad, 'Lanús')
  assert.equal(ficha.direccionDetalle.provincia, 'Buenos Aires', 'la provincia no es del renglón: perderla con la calle vieja sería peor, porque a diferencia de la calle sí sincroniza sola')

  // Y cambiar sólo el celular no rearma el renglón con las partes viejas.
  const despues = editarCliente(id, { ...datosDe(ficha), telefono: '11-4444-5555' }, DANIEL)
  assert.equal(despues.direccion, 'Mitre 1234')
  assert.equal(despues.localidad, 'Lanús')
  assert.equal(despues.direccionDetalle.provincia, 'Buenos Aires')
})

test('una corrección de tilde o mayúsculas hecha en otra computadora no se deshace al guardar acá', async () => {
  const db = await carteraDePrueba()
  const id = idDe(CLIENTES.lopez.nombre)
  const base = datosDe(fichaDeCliente(id))
  editarCliente(id, { ...base, direccionDetalle: sanearDireccion({ calle: 'Hipolito Yrigoyen', altura: '450', localidad: 'Lanús' }) }, DANIEL)

  db.prepare(`UPDATE clientes SET direccion = 'Hipólito Yrigoyen 450' WHERE id = ?`).run(id)

  const ficha = fichaDeCliente(id)
  assert.equal(ficha.direccionDetalle.calle, '', 'la calle sin tilde ya no es la guardada')
  const despues = editarCliente(id, { ...datosDe(ficha), telefono: '11-4444-5555' }, DANIEL)
  assert.equal(despues.direccion, 'Hipólito Yrigoyen 450')
})

test('la provincia y el código postal se encolan hacia la hoja, a diferencia de las partes de la calle', async () => {
  const db = await carteraDePrueba()
  const id = idDe(CLIENTES.lopez.nombre)
  const base = datosDe(fichaDeCliente(id))

  editarCliente(
    id,
    { ...base, direccionDetalle: sanearDireccion({ calle: 'Belgrano', altura: '567', provincia: 'Buenos Aires', codigoPostal: 'B1872', localidad: 'Sarandí' }) },
    DANIEL,
  )

  const filaIds = (db.prepare(`SELECT fila_id FROM cuotas_mes WHERE cliente_id = ?`).all(id) as Array<{ fila_id: string }>).map((f) => f.fila_id)
  const encoladas = db.prepare(`SELECT campos_json FROM cola_sync WHERE fila_id IN (${filaIds.map(() => '?').join(',')})`).all(...filaIds) as Array<{ campos_json: string }>
  const campos = encoladas.flatMap((fila) => Object.keys(JSON.parse(fila.campos_json)))
  assert.ok(campos.includes('provincia'), 'la provincia tiene que viajar a la hoja')
  assert.ok(campos.includes('codigo_postal'), 'el código postal tiene que viajar a la hoja')
  assert.ok(!campos.includes('calle'), 'la calle en partes sigue siendo sólo de esta computadora')
})

test('el renglón guardado se separa en partes sólo cuando se puede volver a armar igual', () => {
  assert.deepEqual(partesDesdeRenglon('Mitre 1234'), { calle: 'Mitre', calle2: '', altura: '1234', sinAltura: false })
  assert.deepEqual(partesDesdeRenglon('Pasaje 5 s/n, esq. Belgrano'), { calle: 'Pasaje 5', calle2: 'Belgrano', altura: '', sinAltura: true })
  assert.deepEqual(partesDesdeRenglon('25 de Mayo 300'), { calle: '25 de Mayo', calle2: '', altura: '300', sinAltura: false })
  // Texto libre de la hoja: va entero a la calle, no se pierde nada.
  assert.equal(partesDesdeRenglon('al lado de la plaza').calle, 'al lado de la plaza')
  assert.equal(partesDesdeRenglon('Mitre 1234 Lanús').calle, 'Mitre 1234 Lanús')
  // El último número es el departamento o el lote, no la altura: no se adivina.
  for (const renglon of ['Mitre 1234 Dto 5', 'Barrio Los Pinos Mz 4 Casa 7', 'Mitre 1234 5B', 'Barrio Manzana 12-Lote-34-Casa-5-Depto-B']) {
    assert.deepEqual(partesDesdeRenglon(renglon), { calle: renglon, calle2: '', altura: '', sinAltura: false }, renglon)
  }
  for (const renglon of ['Mitre 1234', 'Pasaje 5 s/n, esq. Belgrano', 'Mitre 1234 Lanús', 'MITRE S/N', 'Mitre 1234 Dto 5']) {
    assert.equal(textoDeDireccion({ ...DIRECCION_VACIA, ...partesDesdeRenglon(renglon) }), renglon)
  }
  assert.equal(direccionTienePartes({ ...DIRECCION_VACIA, localidad: 'Lanús' }), false, 'la localidad sola no es una dirección cargada')
})

test('editar el cliente actualiza su ficha y encola el cambio hacia la hoja', async () => {
  await carteraDePrueba()
  const id = idDe(CLIENTES.lopez.nombre)
  const ficha = fichaDeCliente(id)

  const actualizada = editarCliente(
    id,
    {
      ...VACIO,
      nombre: ficha.nombre,
      documento: ficha.documento ?? '',
      telefono: '11-7777-0000',
      email: 'lopez@ejemplo.com.ar',
      sucursal: ficha.sucursal ?? '',
    },
    DANIEL,
  )

  assert.equal(actualizada.telefono, '11-7777-0000')
  assert.equal(actualizada.email, 'lopez@ejemplo.com.ar')
  // Tiene una póliza en el mes abierto: el teléfono es columna de la planilla, así que viaja a la hoja.
  assert.ok(cuantasPendientes() > 0, 'el cambio queda en la cola de sincronización')
})

test('las notas y las tareas del cliente se guardan y se pueden ir marcando', async () => {
  const db = await carteraDePrueba()
  const id = idDe(CLIENTES.rodriguez.nombre)

  const notas = agregarNota(id, 'Llamó preguntando por el granizo.', DANIEL)
  assert.equal(notas.length, 1)
  assert.equal(notas[0]!.texto, 'Llamó preguntando por el granizo.')
  assert.equal(notas[0]!.usuarioNombre, DANIEL.nombre)

  const tareas = crearTarea(
    { clienteId: id, polizaId: null, titulo: 'Pedir la cédula verde', detalle: '', responsableId: DANIEL.id, venceEl: '' },
    DANIEL,
  )
  assert.equal(tareas.length, 1)
  assert.equal(tareas[0]!.estado, 'pendiente')
  assert.equal(tareas[0]!.responsableNombre, DANIEL.nombre)

  const marcadas = cambiarEstadoDeTarea(tareas[0]!.id, 'hecha', DANIEL)
  assert.equal(marcadas[0]!.estado, 'hecha')

  // La nota es interna: la hoja no tiene dónde guardarla y no se encola. La tarea sí: desde la Fase 8
  // hay una pestaña APP TAREAS y una tarea es la misma cosa venga de la ficha o del módulo.
  const cola = filas<{ pestana: string; operacion: string }>(db, `SELECT pestana, operacion FROM cola_sync ORDER BY id`)
  assert.equal(cola.filter((c) => c.pestana === 'APP TAREAS').length, 1, 'la tarea sale camino a APP TAREAS')
  assert.equal(cola.filter((c) => c.pestana === 'APP TAREAS')[0]!.operacion, 'crear')
  assert.equal(cuantasPendientes(), 1, 'sólo la tarea: la nota no viaja a ningún lado')
})

// ---------------------------------------------------------------------------
// Las dos acciones que la ficha hace sobre otros módulos
// ---------------------------------------------------------------------------

test('desde la ficha se ven las cuotas del mes del cliente, que es lo que se puede cobrarle', async () => {
  await carteraDePrueba()
  const perez = idDe(CLIENTES.perezAuto.nombre)
  const cuotas = cuotasDelClienteEnElMes(perez)

  assert.equal(cuotas.periodo, '2026-08', 'las del mes abierto')
  assert.equal(cuotas.filas.length, 2, 'el auto y la moto')
  assert.ok(cuotas.filas.every((f) => f.clienteId === perez))
  assert.ok(cuotas.mediosDePago.length > 0, 'los medios de pago alimentan el desplegable')
  assert.equal(cuotas.hoy, hoyLocal())

  // Un cliente que ya no está en la planilla no tiene nada que pagar, y eso se puede decir en pantalla.
  assert.equal(cuotasDelClienteEnElMes(idDe(CLIENTES.fernandez.nombre)).filas.length, 0)
})

test('desde la ficha también se puede cobrar una cuota de un mes anterior que quedó adeudada', async () => {
  const db = await carteraDePrueba()
  const perez = idDe(CLIENTES.perezAuto.nombre)

  // Julio se importó como pagado (débito automático); se lo marca sin pagar, como si hubiera rebotado.
  const atrasada = db
    .prepare(`SELECT fila_id, periodo FROM cuotas_mes WHERE cliente_id = ? AND periodo < '2026-08' ORDER BY periodo DESC LIMIT 1`)
    .get(perez) as { fila_id: string; periodo: string }
  db.prepare(`UPDATE cuotas_mes SET pago = NULL, pago_fecha = NULL WHERE fila_id = ?`).run(atrasada.fila_id)

  const cuotas = cuotasDelClienteEnElMes(perez)
  assert.equal(cuotas.periodo, '2026-08', 'el período de referencia sigue siendo el mes abierto')
  assert.equal(cuotas.filas.length, 3, 'el auto y la moto de agosto, más la cuota atrasada')
  const cuotaAtrasada = cuotas.filas.find((f) => f.periodo === atrasada.periodo)
  assert.ok(cuotaAtrasada, 'la cuota atrasada aparece junto con las del mes abierto')
  assert.equal(cuotaAtrasada!.pagoFecha, null)

  // Las de agosto ya pagas de otros meses no vuelven a aparecer: sólo lo que sigue sin pagar.
  assert.ok(cuotas.filas.every((f) => f.periodo === '2026-08' || f.filaId === atrasada.fila_id))
})

test('cargar un siniestro lo deja en la ficha y camino a la hoja', async () => {
  const db = await carteraDePrueba()
  const cliente = idDe(CLIENTES.gonzalez.nombre)
  const poliza = fichaDeCliente(cliente).polizas.find((p) => p.estado === 'ACTIVA')!
  const pendientesAntes = cuantasPendientes()

  const siniestros = crearSiniestro(
    {
      clienteId: cliente,
      polizaId: poliza.id,
      fecha: '2026-08-15',
      numeroSiniestro: 'S-9001',
      descripcion: 'Granizo en la playa de estacionamiento',
      estado: 'DENUNCIADO',
      importe: '$ 450.000',
      observaciones: 'Mandó fotos por WhatsApp',
    },
    DANIEL,
  )

  const cargado = siniestros.find((s) => s.numeroSiniestro === 'S-9001')
  assert.ok(cargado, 'aparece en la lista del cliente')
  assert.equal(cargado.descripcion, 'Granizo en la playa de estacionamiento')
  assert.equal(cargado.compania, poliza.compania, 'se completa con los datos de la póliza')
  assert.equal(cargado.numeroPoliza, poliza.numero)
  assert.ok(cuantasPendientes() > pendientesAntes, 'queda encolado para subir a la hoja')

  // Y también en la ficha, que es donde lo va a buscar la gente.
  assert.ok(fichaDeCliente(cliente).siniestros.some((s) => s.numeroSiniestro === 'S-9001'))

  // Lo que se carga desde la aplicación ya entra con uno de los cuatro estados.
  assert.equal(cargado.estado, 'CARGADO', 'DENUNCIADO es CARGADO')
  assert.equal(cargado.estadoTexto, null, 'y no hay texto distinto que mostrar al lado')

  // Lo que viene de la hoja, en cambio, se guarda tal como lo escribió la agencia. La ficha del
  // cliente mostraba ESE texto crudo, así que un trámite EN TRÁMITE o CERRADO no figuraba nunca acá
  // con su estado: ahora se lleva a uno de los cuatro y el original queda al lado.
  db.prepare(`UPDATE siniestros SET estado = ? WHERE numero_siniestro = ?`).run('CERRADO 15/08', 'S-9001')
  const enLaFicha = fichaDeCliente(cliente).siniestros.find((s) => s.numeroSiniestro === 'S-9001')!
  assert.equal(enLaFicha.estado, 'CERRADO')
  assert.equal(enLaFicha.estadoTexto, 'CERRADO 15/08')
})

test('un siniestro sin fecha o sin descripción no se guarda, y la póliza tiene que ser del cliente', async () => {
  await carteraDePrueba()
  const cliente = idDe(CLIENTES.gonzalez.nombre)
  const base = {
    clienteId: cliente,
    polizaId: null,
    fecha: '2026-08-15',
    numeroSiniestro: '',
    descripcion: 'Choque en cadena',
    estado: 'DENUNCIADO',
    importe: '',
    observaciones: '',
  }

  assert.throws(() => crearSiniestro({ ...base, fecha: '' }, DANIEL), /fecha/i)
  assert.throws(() => crearSiniestro({ ...base, fecha: '32/13/2026' }, DANIEL), /fecha/i)
  assert.throws(() => crearSiniestro({ ...base, descripcion: '  ' }, DANIEL), /descripci/i)

  // La póliza de otro cliente no se puede usar: sería imputarle un siniestro a quien no le corresponde.
  const deOtro = fichaDeCliente(idDe(CLIENTES.lopez.nombre)).polizas[0]!
  assert.throws(() => crearSiniestro({ ...base, polizaId: deOtro.id }, DANIEL), /no es de este cliente/i)

  // Sin póliza sí se puede: a veces se denuncia antes de saber cuál.
  assert.equal(crearSiniestro(base, DANIEL).length >= 1, true)
})
