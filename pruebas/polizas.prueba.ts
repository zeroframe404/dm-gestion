// El módulo Pólizas: el listado por póliza con su estado calculado, y —lo que pidió el pliego— que un
// vehículo más viejo de lo que la compañía acepta dispare la advertencia y sólo se pueda seguir con
// confirmación de un administrador.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { buscarClientes } from '../src/main/servicios/clientes'
import {
  catalogosDePoliza,
  crearPoliza,
  darDeBajaPoliza,
  editarPoliza,
  listarPolizas,
  polizasDeCliente,
  validarCobertura,
  vehiculosDeCliente,
  verPoliza,
} from '../src/main/servicios/polizas'
import { editarRegla, matrizDeCobertura, crearRegla } from '../src/main/servicios/reglas'
import { cuantasPendientes } from '../src/main/sincronizacion/cola'
import { MotorDeSincronizacion } from '../src/main/sincronizacion/motor'
import { hoyLocal } from '../src/shared/semaforo'
import type { DatosDePoliza, FiltrosPolizas, SesionUsuario } from '../src/shared/tipos'
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

const EMPLEADA: SesionUsuario = {
  id: 2,
  nombre: 'Brenda Empleada',
  usuario: 'brenda',
  rol: 'EMPLEADO',
  sucursal: { id: 2, nombre: 'Dock Sud' },
  debeCambiarClave: false,
}

const SIN_FILTROS: FiltrosPolizas = { busqueda: '', estados: [], companias: [], sucursales: [], coberturas: [], ramas: [] }

/**
 * Dos importaciones, como pasa mes a mes: primero la hoja hasta JULIO y después con AGOSTO. Es lo único
 * que deja pólizas inactivas de verdad (Fernández se fue en julio); con una sola corrida el importador
 * arma toda la cartera desde la planilla más nueva y sale entera activa.
 */
async function carteraDePrueba(): Promise<BaseDeDatos> {
  return (await carteraConHoja()).db
}

/** Lo mismo, pero devolviendo también la hoja: para las pruebas que suben algo y lo vuelven a importar. */
async function carteraConHoja(): Promise<{ db: BaseDeDatos; hoja: HojaSimulada }> {
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
  return { db, hoja }
}

function idDeCliente(nombre: string): number {
  const encontrado = buscarClientes(nombre)[0]
  if (!encontrado) throw new Error(`No está «${nombre}»`)
  return encontrado.id
}

/** Los datos mínimos de un alta, para ir pisando sólo lo que interesa en cada prueba. */
function datosBase(clienteId: number): DatosDePoliza {
  return {
    clienteId,
    vehiculoId: null,
    vehiculoNuevo: {
      patente: 'AG333NP',
      marca: 'FORD',
      modelo: 'FALCON',
      // Cargado a mano: sin línea, sin categoría y sin código de catálogo, como los de siempre.
      linea: '',
      anio: '1995',
      tipo: 'AUTO',
      categoria: '',
      catalogoCodigo: '',
      motor: '',
      chasis: '',
      uso: 'PARTICULAR',
      color: 'BLANCO',
      direccionRiesgo: '',
      titularNombre: '',
      titularDocumento: '',
      integrantes: [],
    },
    compania: 'SANCOR',
    cobertura: 'TERCEROS COMPLETO',
    formaPago: 'EFECTIVO',
    cuota: '$ 12.000',
    diaVencimiento: '15',
    numero: '9001234',
    propuesta: '',
    vigenciaDesde: '01/09/2026',
    vigenciaHasta: '01/09/2027',
    avisarVto: '',
    observaciones: '',
    confirmadoPeseAlAviso: false,
  }
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

test('el listado muestra una fila por póliza, con su estado calculado', async () => {
  await carteraDePrueba()
  const listado = listarPolizas(SIN_FILTROS)

  assert.ok(listado.filas.length >= 7, `esperaba al menos 7 pólizas, hubo ${listado.filas.length}`)
  assert.equal(listado.hoy, hoyLocal())
  assert.ok(listado.catalogos.companias.includes('SANCOR'))
  // Los catálogos que alimentan el formulario son los mismos que los del listado.
  assert.deepEqual(catalogosDePoliza().companias, listado.catalogos.companias)

  // El estado no está en ninguna columna de la hoja: sale de `activa` y de la vigencia.
  assert.ok(listado.filas.every((f) => ['ACTIVA', 'BAJA', 'VENCIDA'].includes(f.estado)))
  assert.ok(
    listado.filas.some((f) => f.estado === 'ACTIVA'),
    'tiene que haber pólizas activas',
  )

  // La de Fernández dejó de estar en la planilla de agosto: el importador la marcó inactiva y el
  // listado la muestra como BAJA sin que nadie la tocara desde la aplicación.
  const fernandez = listado.filas.find((f) => f.numero === CLIENTES.fernandez.poliza)
  assert.ok(fernandez, 'la póliza del que se fue no se borra: queda en el histórico')
  assert.equal(fernandez.estado, 'BAJA')

  // Y una que se da de baja desde la aplicación también cambia sola.
  const activa = listado.filas.find((f) => f.estado === 'ACTIVA')!
  darDeBajaPoliza(activa.id, { motivo: 'VENDIO', nota: '' }, DANIEL)
  assert.equal(verPoliza(activa.id).estado, 'BAJA')
})

test('los filtros del listado acotan por estado, compañía y búsqueda', async () => {
  await carteraDePrueba()
  const todas = listarPolizas(SIN_FILTROS)

  const activas = listarPolizas({ ...SIN_FILTROS, estados: ['ACTIVA'] })
  assert.ok(activas.filas.every((f) => f.estado === 'ACTIVA'))
  assert.ok(activas.filas.length < todas.filas.length, 'la de Fernández quedó afuera')

  const deBaja = listarPolizas({ ...SIN_FILTROS, estados: ['BAJA'] })
  assert.equal(deBaja.filas.length, 1)
  assert.equal(deBaja.filas[0]!.numero, CLIENTES.fernandez.poliza)

  const sancor = listarPolizas({ ...SIN_FILTROS, companias: ['SANCOR'] })
  assert.ok(sancor.filas.length > 0 && sancor.filas.every((f) => f.compania === 'SANCOR'))

  assert.equal(listarPolizas({ ...SIN_FILTROS, busqueda: CLIENTES.suarez.poliza }).filas.length, 1, 'por número de póliza')
  assert.equal(listarPolizas({ ...SIN_FILTROS, busqueda: CLIENTES.lopez.patente }).filas.length, 1, 'por patente')

  // El total es cuántas pólizas hay, no cuántas quedaron después de filtrar.
  assert.equal(sancor.total, todas.filas.length)
})

test('las pólizas de un cliente y sus vehículos se pueden pedir por separado, para el formulario', async () => {
  await carteraDePrueba()
  const perez = idDeCliente(CLIENTES.perezAuto.nombre)

  assert.equal(polizasDeCliente(perez).filter((p) => p.estado === 'ACTIVA').length, 2)
  const vehiculos = vehiculosDeCliente(perez)
  assert.equal(vehiculos.length, 2, 'el auto y la moto')
  assert.ok(vehiculos.some((v) => v.marca === 'HONDA'))
})

// ---------------------------------------------------------------------------
// Antigüedad del vehículo: el criterio de aceptación N°2 del pliego
// ---------------------------------------------------------------------------

/** Le pone «hasta 15 años de antigüedad» a SANCOR + TERCEROS COMPLETO y devuelve el año mínimo. */
function cargarReglaDeSancor(): number {
  const matriz = matrizDeCobertura(DANIEL)
  const regla = matriz.reglas.find((r) => r.compania === 'SANCOR' && r.cobertura === 'TERCEROS COMPLETO')
  assert.ok(regla, 'la hoja simulada trae esa regla en la pestaña COBERTURA')
  editarRegla(
    regla.id,
    {
      compania: regla.compania ?? '',
      cobertura: regla.cobertura ?? '',
      incluye: regla.incluye ?? '',
      franquicia: regla.franquicia ?? '',
      detalle: regla.detalle ?? '',
      observaciones: regla.observaciones ?? '',
      antiguedadMaxima: '15',
      anioMinimo: '',
    },
    DANIEL,
  )
  return matriz.anioActual - 15
}

test('sin regla cargada no se advierte nada: la validación degrada bien', async () => {
  await carteraDePrueba()
  // MERCANTIL ANDINA no está en la pestaña COBERTURA de la hoja simulada.
  const aviso = validarCobertura('MERCANTIL ANDINA', 'TODO RIESGO', '1995')
  assert.equal(aviso.hayProblema, false, 'sin regla no se puede afirmar nada, así que no se molesta')
  assert.equal(aviso.regla, null)

  // Con regla pero sin límite cargado, tampoco.
  const sinLimite = validarCobertura('ZURICH', 'TERCEROS COMPLETO', '1995')
  assert.equal(sinLimite.hayProblema, false)
})

test('un vehículo más viejo de lo que acepta la compañía dispara la advertencia', async () => {
  await carteraDePrueba()
  const anioMinimo = cargarReglaDeSancor()

  const viejo = validarCobertura('SANCOR', 'TERCEROS COMPLETO', '1995')
  assert.equal(viejo.hayProblema, true, 'un 1995 con tope de 15 años no entra')
  assert.ok(viejo.mensaje.includes('1995'), 'el mensaje dice qué modelo es el vehículo')
  assert.ok(viejo.mensaje.includes(String(anioMinimo)), 'y desde qué año toma la compañía')

  const nuevo = validarCobertura('SANCOR', 'TERCEROS COMPLETO', String(anioMinimo + 1))
  assert.equal(nuevo.hayProblema, false, 'uno dentro del límite pasa sin ruido')

  // Un año ilegible no se inventa: se avisa sin bloquear.
  const ilegible = validarCobertura('SANCOR', 'TERCEROS COMPLETO', '---')
  assert.equal(ilegible.hayProblema, false)
})

test('el alta se frena con la advertencia y sólo sigue con confirmación de un administrador', async () => {
  await carteraDePrueba()
  cargarReglaDeSancor()
  const cliente = idDeCliente(CLIENTES.suarez.nombre)
  const antes = listarPolizas(SIN_FILTROS).filas.length

  // 1. Sin confirmar: no se guarda y el error explica por qué.
  assert.throws(() => crearPoliza(datosBase(cliente), DANIEL), /1995|antigüedad|acepta/i)
  assert.equal(listarPolizas(SIN_FILTROS).filas.length, antes, 'no se creó nada')

  // 2. Una empleada no puede saltear la advertencia por su cuenta.
  assert.throws(
    () => crearPoliza({ ...datosBase(cliente), confirmadoPeseAlAviso: true }, EMPLEADA),
    /administrador/i,
  )
  assert.equal(listarPolizas(SIN_FILTROS).filas.length, antes)

  // 3. Con la confirmación del administrador, se guarda.
  const creada = crearPoliza({ ...datosBase(cliente), confirmadoPeseAlAviso: true }, DANIEL)
  assert.equal(creada.numero, '9001234')
  assert.equal(creada.estado, 'ACTIVA')
  assert.equal(listarPolizas(SIN_FILTROS).filas.length, antes + 1)
})

// ---------------------------------------------------------------------------
// Alta, edición y baja
// ---------------------------------------------------------------------------

test('un alta sin advertencias crea la póliza, su vehículo y la deja para subir a la hoja', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente(CLIENTES.rodriguez.nombre)
  const vehiculosAntes = vehiculosDeCliente(cliente).length
  const pendientesAntes = cuantasPendientes()

  const datos = { ...datosBase(cliente) }
  datos.vehiculoNuevo = { ...datos.vehiculoNuevo!, anio: '2022', patente: 'AH444QR' }
  const creada = crearPoliza(datos, DANIEL)

  assert.equal(creada.clienteId, cliente)
  assert.equal(creada.patente, 'AH444QR')
  assert.equal(creada.cuota, '$ 12.000', 'la cuota queda cargada en el mes abierto')
  assert.equal(vehiculosDeCliente(cliente).length, vehiculosAntes + 1, 'se creó el vehículo nuevo')

  // La vigencia se guarda como texto y como fecha: la de fecha es la que usa la bandeja de renovaciones.
  assert.equal(creada.vigenciaHasta, '01/09/2027')
  assert.equal(creada.vigenciaHastaIso, '2027-09-01')

  assert.ok(cuantasPendientes() > pendientesAntes, 'la fila nueva queda encolada para la hoja')
})

// ---------------------------------------------------------------------------
// Riesgos que no son vehículos: hogar, comercio, bicicleta, accidentes personales, otros
// ---------------------------------------------------------------------------

/** Lo mismo que `datosBase` pero con un riesgo de otro tipo en lugar del Falcon. */
function datosDeRiesgo(clienteId: number, riesgo: Partial<NonNullable<DatosDePoliza['vehiculoNuevo']>>, numero: string): DatosDePoliza {
  const base = datosBase(clienteId)
  return {
    ...base,
    numero,
    cobertura: '',
    vehiculoNuevo: {
      ...base.vehiculoNuevo!,
      patente: '',
      marca: '',
      modelo: '',
      anio: '',
      uso: '',
      color: '',
      ...riesgo,
    },
  }
}

test('una póliza de hogar se carga con la dirección de la casa y sin cobertura ni antigüedad', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente(CLIENTES.rodriguez.nombre)
  // SANCOR + TERCEROS COMPLETO tiene regla de antigüedad cargada: una casa no puede caer en ella.
  cargarReglaDeSancor()

  const creada = crearPoliza(
    datosDeRiesgo(cliente, { tipo: 'HOGAR', direccionRiesgo: 'Mitre 1234, Lanús', titularNombre: 'MARTA RODRIGUEZ' }, '7000001'),
    DANIEL,
  )

  assert.equal(creada.patente, null, 'una casa no tiene patente')
  assert.equal(creada.vehiculo, 'Hogar · Mitre 1234, Lanús', 'el riesgo se nombra por su dirección')
  assert.equal(creada.cobertura, null, 'la cobertura es opcional cuando no es un vehículo')

  const riesgo = vehiculosDeCliente(cliente).find((v) => v.tipo === 'HOGAR')
  assert.ok(riesgo, 'la casa queda como riesgo del cliente')
  assert.equal(riesgo.direccionRiesgo, 'Mitre 1234, Lanús')
  assert.equal(riesgo.titularNombre, 'MARTA RODRIGUEZ')
  assert.deepEqual(riesgo.integrantes, [])

  // La misma dirección cargada otra vez en otra póliza es la misma casa, no una segunda.
  crearPoliza(datosDeRiesgo(cliente, { tipo: 'HOGAR', direccionRiesgo: 'MITRE 1234 LANUS' }, '7000002'), DANIEL)
  assert.equal(vehiculosDeCliente(cliente).filter((v) => v.tipo === 'HOGAR').length, 1)
})

test('sin dirección no hay hogar ni comercio que asegurar', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente(CLIENTES.rodriguez.nombre)
  assert.throws(() => crearPoliza(datosDeRiesgo(cliente, { tipo: 'HOGAR' }, '7000003'), DANIEL), /dirección de la casa/)
  assert.throws(
    () => crearPoliza(datosDeRiesgo(cliente, { tipo: 'INTEGRAL DE COMERCIO' }, '7000004'), DANIEL),
    /dirección del comercio/,
  )
})

test('un accidentes personales guarda a cada persona cubierta con su DNI', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente(CLIENTES.rodriguez.nombre)

  const integrantes = [
    { nombre: 'MARTA RODRIGUEZ', documento: '20111222' },
    { nombre: 'JUAN RODRIGUEZ', documento: '40111222' },
    { nombre: 'ANA RODRIGUEZ', documento: '45111222' },
    // Una fila que quedó en blanco en la pantalla no es una persona.
    { nombre: '', documento: '' },
  ]
  const creada = crearPoliza(datosDeRiesgo(cliente, { tipo: 'ACCIDENTE PERSONAL', integrantes }, '7000005'), DANIEL)
  assert.equal(creada.vehiculo, 'Accidente personal · MARTA RODRIGUEZ, JUAN RODRIGUEZ y 1 más')

  const riesgo = vehiculosDeCliente(cliente).find((v) => v.tipo === 'ACCIDENTE PERSONAL')
  assert.ok(riesgo)
  assert.deepEqual(riesgo.integrantes, integrantes.slice(0, 3))

  assert.throws(
    () => crearPoliza(datosDeRiesgo(cliente, { tipo: 'ACCIDENTE PERSONAL', integrantes: [] }, '7000006'), DANIEL),
    /al menos una persona/,
  )
})

test('la bicicleta lleva la marca y el número de cuadro, y «otros» sólo la persona', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente(CLIENTES.rodriguez.nombre)

  const bici = crearPoliza(datosDeRiesgo(cliente, { tipo: 'BICICLETA', marca: 'TREK', chasis: 'WTU123' }, '7000007'), DANIEL)
  assert.equal(bici.vehiculo, 'Bicicleta · TREK · cuadro WTU123')
  assert.equal(vehiculosDeCliente(cliente).find((v) => v.tipo === 'BICICLETA')?.chasis, 'WTU123', 'el cuadro va en la columna del chasis')
  assert.throws(() => crearPoliza(datosDeRiesgo(cliente, { tipo: 'BICICLETA' }, '7000008'), DANIEL), /marca o el número de cuadro/)

  const otro = crearPoliza(datosDeRiesgo(cliente, { tipo: 'OTRO', titularNombre: 'PEDRO GOMEZ', titularDocumento: '30111222' }, '7000009'), DANIEL)
  assert.equal(otro.vehiculo, 'Otros · PEDRO GOMEZ (30111222)')
  assert.throws(() => crearPoliza(datosDeRiesgo(cliente, { tipo: 'OTRO' }, '7000010'), DANIEL), /nombre o el DNI/)
})

test('la casa sobrevive al viaje de ida y vuelta por la hoja, y en otra computadora al menos se sabe que es un hogar', async () => {
  const { db, hoja } = await carteraConHoja()
  const cliente = idDeCliente(CLIENTES.rodriguez.nombre)
  const creada = crearPoliza(
    datosDeRiesgo(cliente, { tipo: 'HOGAR', direccionRiesgo: 'Mitre 1234, Lanús', titularNombre: 'MARTA RODRIGUEZ' }, '7000011'),
    DANIEL,
  )
  const riesgoId = creada.vehiculoId
  assert.ok(riesgoId, 'la póliza nació con su casa')

  // Sube a la hoja (la fila lleva TIPO = HOGAR y nada en patente, marca ni modelo) y se vuelve a bajar.
  const motor = new MotorDeSincronizacion({ crearFuente: () => hoja, importar: () => importar(db, hoja).then(() => undefined) })
  motor.encender()
  try {
    await motor.ciclarSubida()
    await importar(db, hoja)
  } finally {
    motor.apagar()
  }

  const releida = verPoliza(creada.id)
  assert.equal(releida.vehiculoId, riesgoId, 'la re-importación no le saca la casa a la póliza')
  assert.equal(releida.vehiculo, 'Hogar · Mitre 1234, Lanús')
  assert.equal(vehiculosDeCliente(cliente).find((v) => v.tipo === 'HOGAR')?.direccionRiesgo, 'Mitre 1234, Lanús')

  // Otra computadora, que sólo tiene la hoja. La planilla de prueba no tenía columna TIPO, pero la
  // subida se la agregó (12.7): la póliza llega y al menos se sabe que es un hogar. La dirección del
  // riesgo no viaja: la planilla no tiene campo para eso.
  assert.ok(hoja.encabezadosDe('AGOSTO').includes('TIPO'), 'la subida le agregó la columna TIPO a la planilla')
  const otraBase = async () => {
    cerrarBaseDeDatos()
    const registrar = console.log
    console.log = () => undefined
    const otra = abrirBaseDeDatos(':memory:')
    console.log = registrar
    await importar(otra, hoja)
    const enLaOtra = listarPolizas({ ...SIN_FILTROS, busqueda: '7000011' }).filas[0]
    assert.ok(enLaOtra, 'la póliza llegó a la otra computadora')
    assert.equal(enLaOtra.patente, null)
    return enLaOtra
  }
  assert.equal((await otraBase()).vehiculo, 'Hogar')

  // Si alguien borra el TIPO de la planilla, la otra computadora recibe la póliza sin nada asegurado.
  const encabezados = hoja.encabezadosDe('AGOSTO')
  const columnaPoliza = encabezados.findIndex((e) => /P[OÓ]LIZA/.test(e.trim().toUpperCase()))
  const filaDeLaCasa = hoja.filasDe('AGOSTO').findIndex((f) => (f[columnaPoliza] ?? '').trim() === '7000011')
  assert.ok(filaDeLaCasa > 0, 'la póliza de la casa está en la planilla del mes')
  hoja.editarCelda('AGOSTO', filaDeLaCasa + 1, encabezados.indexOf('TIPO'), '')
  assert.equal((await otraBase()).vehiculo, null)
})

test('en un vehículo la cobertura sigue siendo obligatoria', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente(CLIENTES.rodriguez.nombre)
  assert.throws(() => crearPoliza({ ...datosBase(cliente), cobertura: '' }, DANIEL), /Cargá la cobertura/)
})

test('el alta se puede hacer sobre un vehículo que el cliente ya tiene', async () => {
  await carteraDePrueba()
  const cliente = idDeCliente(CLIENTES.lopez.nombre)
  const vehiculo = vehiculosDeCliente(cliente)[0]!

  const datos = { ...datosBase(cliente), vehiculoId: vehiculo.id, vehiculoNuevo: null, numero: '9005555', compania: 'ZURICH' }
  const creada = crearPoliza(datos, DANIEL)

  assert.equal(creada.vehiculoId, vehiculo.id)
  assert.equal(vehiculosDeCliente(cliente).length, 1, 'no se duplicó el vehículo')
})

test('editar una póliza cambia sus datos y deja el cambio para subir', async () => {
  await carteraDePrueba()
  const poliza = listarPolizas({ ...SIN_FILTROS, busqueda: CLIENTES.suarez.poliza }).filas[0]!
  const pendientesAntes = cuantasPendientes()

  const editada = editarPoliza(
    poliza.id,
    {
      clienteId: poliza.clienteId,
      vehiculoId: poliza.vehiculoId,
      vehiculoNuevo: null,
      compania: poliza.compania ?? '',
      cobertura: 'TODO RIESGO',
      formaPago: poliza.formaPago ?? '',
      cuota: '$ 31.000',
      diaVencimiento: poliza.diaVencimiento ?? '',
      numero: poliza.numero ?? '',
      propuesta: '',
      vigenciaDesde: poliza.vigenciaDesde ?? '',
      vigenciaHasta: poliza.vigenciaHasta ?? '',
      avisarVto: '',
      observaciones: 'Revisar la suma asegurada.',
      confirmadoPeseAlAviso: false,
    },
    DANIEL,
  )

  assert.equal(editada.cobertura, 'TODO RIESGO')
  assert.equal(editada.observaciones, 'Revisar la suma asegurada.')
  assert.ok(cuantasPendientes() > pendientesAntes)
  assert.equal(verPoliza(poliza.id).cobertura, 'TODO RIESGO', 'quedó guardado')
})

test('dar de baja una póliza la saca de la cartera y le deja el motivo', async () => {
  await carteraDePrueba()
  const poliza = listarPolizas({ ...SIN_FILTROS, busqueda: CLIENTES.suarez.poliza }).filas[0]!

  darDeBajaPoliza(poliza.id, { motivo: 'VENDIO', nota: 'Vendió el 208' }, DANIEL)

  const despues = verPoliza(poliza.id)
  assert.equal(despues.estado, 'BAJA')
  assert.equal(despues.motivoBaja, 'VENDIO')
  assert.ok(despues.fechaBaja, 'con la fecha del día')
})

test('la matriz de reglas dice qué combinaciones de la cartera todavía no tienen regla', async () => {
  await carteraDePrueba()
  const matriz = matrizDeCobertura(DANIEL)

  assert.equal(matriz.puedeEditar, true, 'el superadministrador la puede editar')
  assert.ok(matriz.faltantes.length > 0, 'hay compañías en la cartera sin regla cargada')
  assert.ok(
    matriz.faltantes.every((f) => f.polizas > 0),
    'cada faltante dice cuántas pólizas la usan, para saber qué cargar primero',
  )
  // Ordenadas de la que más pólizas tiene a la que menos: es el orden en que conviene cargarlas.
  const cantidades = matriz.faltantes.map((f) => f.polizas)
  assert.deepEqual(cantidades, [...cantidades].sort((a, b) => b - a))
})

test('sólo el superadministrador toca la matriz, y no admite dos reglas iguales', async () => {
  await carteraDePrueba()
  const nueva = {
    compania: 'MERCANTIL ANDINA',
    cobertura: 'TODO RIESGO',
    incluye: '',
    franquicia: '',
    detalle: '',
    observaciones: '',
    antiguedadMaxima: '12',
    anioMinimo: '',
  }

  assert.throws(() => crearRegla(nueva, EMPLEADA), /permiso|superadministrador/i)
  assert.throws(() => matrizDeCobertura(EMPLEADA).reglas.length && crearRegla(nueva, EMPLEADA), /permiso|superadministrador/i)

  const conLaNueva = crearRegla(nueva, DANIEL)
  assert.ok(conLaNueva.reglas.some((r) => r.compania === 'MERCANTIL ANDINA' && r.cobertura === 'TODO RIESGO'))

  assert.throws(() => crearRegla(nueva, DANIEL), /ya/i, 'no se puede cargar dos veces la misma')
  assert.throws(() => crearRegla({ ...nueva, compania: 'OTRA', antiguedadMaxima: 'muchos' }, DANIEL), /número|entero|válid/i)
})

test('los filtros encuentran aunque el catálogo tenga tildes y la hoja no', async () => {
  await carteraDePrueba()
  // El desplegable ofrece «Lanús» (el nombre oficial de la sucursal) pero la planilla escribió «LANUS».
  // Filtrar con UPPER() de SQLite no los hacía coincidir —sólo sube el ASCII— y el listado salía vacío
  // sin decir por qué, que es lo peor que puede pasar: parece que no hay pólizas.
  const catalogos = catalogosDePoliza()
  assert.ok(catalogos.sucursales.includes('Lanús'), 'el catálogo trae el nombre oficial, con tilde')

  const conTilde = listarPolizas({ ...SIN_FILTROS, sucursales: ['Lanús'] })
  assert.ok(conTilde.filas.length > 0, 'elegir «Lanús» del desplegable tiene que encontrar las de LANUS')
  assert.deepEqual(
    conTilde.filas.map((f) => f.id).sort(),
    listarPolizas({ ...SIN_FILTROS, sucursales: ['LANUS'] }).filas.map((f) => f.id).sort(),
    'con tilde y sin tilde dan lo mismo',
  )

  // Acá el desplegable no puede devolver cero porque la hoja de prueba tiene pólizas en las cuatro
  // sucursales. En una base de verdad SÍ puede: el desplegable ofrece siempre las cuatro de la agencia
  // aunque una no tenga ni una póliza todavía (es lo que pasó con Sarandí recién abierta). Lo que se
  // prueba acá es que el filtro engancha con el texto de la hoja, no que toda opción tenga filas.
  for (const sucursal of catalogos.sucursales) {
    const cantidad = listarPolizas({ ...SIN_FILTROS, sucursales: [sucursal] }).filas.length
    assert.ok(cantidad > 0, `el filtro de sucursal «${sucursal}» no encontró ninguna póliza`)
  }
  for (const compania of catalogos.companias) {
    const cantidad = listarPolizas({ ...SIN_FILTROS, companias: [compania] }).filas.length
    assert.ok(cantidad > 0, `el filtro de compañía «${compania}» no encontró ninguna póliza`)
  }
})
