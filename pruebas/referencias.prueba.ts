// Las cinco listas del módulo Compañías, de punta a punta.
//
// Lo que se prueba es lo que se rompe en silencio y llega al mostrador convertido en un dato mal
// pasado: un precio duplicado que hace que se lea el primero que aparezca, una grúa «sin cargar» que
// se confunde con una ilimitada, una consulta de antigüedad que contesta «no» cuando lo correcto es
// «no sé», y la adopción entre computadoras, que borra lo que había antes de escribir lo que bajó.
import assert from 'node:assert/strict'
import test from 'node:test'
import { abrirBaseDeDatos, cerrarBaseDeDatos, type BaseDeDatos } from '../src/main/db/base'
import { ahoraIso } from '../src/main/importacion/normalizar'
import {
  borrarPrecio,
  consultarAntiguedad,
  guardarClausula,
  guardarGrua,
  guardarOrganizador,
  guardarPrecio,
  listasDeCompanias,
  moverOrganizador,
} from '../src/main/servicios/referencias'
import {
  adoptarInstantanea,
  hayCambiosSinPublicar,
  huellaDeReferencias,
  instantaneaDeReferencias,
} from '../src/main/servicios/referenciasCompartidas'
import { crearRegla } from '../src/main/servicios/reglas'
import type { DatosDeClausula, DatosDeGrua, DatosDeOrganizador, DatosDePrecio, SesionUsuario } from '../src/shared/tipos'

const DANIEL: SesionUsuario = {
  id: 1,
  nombre: 'Daniel Martínez',
  usuario: 'daniel',
  rol: 'SUPER_ADMIN',
  sucursal: { id: 1, nombre: 'Daniel' },
  debeCambiarClave: false,
}

/** Una empleada: entra al módulo, pero no carga nada. */
const LUCIA: SesionUsuario = { ...DANIEL, id: 2, nombre: 'Lucía', usuario: 'lucia', rol: 'EMPLEADO' }

const ORGANIZADOR: DatosDeOrganizador = {
  nombre: 'Organización Sur',
  companias: 'ATM, Río Uruguay',
  telefono: '11 4567-8901',
  email: 'sur@ejemplo.com',
  horario: 'Lunes a viernes de 9 a 17',
  observaciones: 'Pide patente y año.',
  activo: true,
}

const PRECIO: DatosDePrecio = {
  compania: 'ATM',
  cobertura: 'RESPONSABILIDAD CIVIL',
  rama: 'AUTO',
  precio: '18500',
  vigenteDesde: '2026-08-01',
  observaciones: '',
}

const GRUA: DatosDeGrua = { compania: 'ATM', cobertura: 'TERCEROS COMPLETO', kilometros: '200', auxilio: 'Cambio de rueda', observaciones: '' }

const CLAUSULA: DatosDeClausula = {
  compania: '',
  cobertura: 'TERCEROS COMPLETO',
  clausula: 'Robo total',
  ampara: true,
  detalle: 'Sin franquicia.',
}

/** Base nueva en memoria, con el esquema y las cuatro sucursales. */
function base(): BaseDeDatos {
  cerrarBaseDeDatos()
  const registrar = console.log
  console.log = () => undefined
  const db = abrirBaseDeDatos(':memory:')
  console.log = registrar
  return db
}

/** Una póliza activa: es de donde salen las compañías de la cartera y las que quedan «sin reglas». */
function polizaActiva(db: BaseDeDatos, compania: string, cobertura: string): void {
  const ahora = ahoraIso()
  const { id } = db
    .prepare(
      `INSERT INTO clientes (clave, nombre, creado_en, actualizado_en) VALUES (?, ?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET actualizado_en = excluded.actualizado_en RETURNING id`,
    )
    .get('CLI:PRUEBA', 'Cliente de prueba', ahora, ahora) as { id: number }
  db.prepare(
    `INSERT INTO polizas (clave, cliente_id, compania, cobertura, periodo_origen, pestana_origen, activa, creado_en, actualizado_en)
     VALUES (?, ?, ?, ?, '2026-01', 'PRUEBA', 1, ?, ?)`,
  ).run(`POL:${compania}:${cobertura}`, id, compania, cobertura, ahora, ahora)
}

// ---------------------------------------------------------------------------
// Organizadores
// ---------------------------------------------------------------------------

test('el organizador nuevo va al final de la lista y trae armado el enlace de WhatsApp', () => {
  base()
  guardarOrganizador(null, ORGANIZADOR, DANIEL)
  const listas = guardarOrganizador(null, { ...ORGANIZADOR, nombre: 'Organización Norte', telefono: '' }, DANIEL)

  assert.deepEqual(
    listas.organizadores.map((organizador) => organizador.nombre),
    ['Organización Sur', 'Organización Norte'],
    'el segundo se carga al final, no ordenado alfabéticamente',
  )
  // El teléfono se escribe como se escribe en el mostrador y el enlace tiene que salir igual.
  assert.equal(listas.organizadores[0]!.whatsapp, 'https://wa.me/5491145678901')
  assert.equal(listas.organizadores[1]!.whatsapp, null, 'sin teléfono no se inventa un enlace')
})

test('las flechas cambian el orden en el que se le escribe a cada organizador', () => {
  base()
  guardarOrganizador(null, { ...ORGANIZADOR, nombre: 'Primero' }, DANIEL)
  guardarOrganizador(null, { ...ORGANIZADOR, nombre: 'Segundo' }, DANIEL)
  const tercero = guardarOrganizador(null, { ...ORGANIZADOR, nombre: 'Tercero' }, DANIEL).organizadores[2]!

  const subido = moverOrganizador(tercero.id, 'arriba', DANIEL)
  assert.deepEqual(
    subido.organizadores.map((organizador) => organizador.nombre),
    ['Primero', 'Tercero', 'Segundo'],
  )

  // El que ya está primero no se mueve, y tampoco es un error: no hay nada que hacer.
  const primero = subido.organizadores[0]!
  const igual = moverOrganizador(primero.id, 'arriba', DANIEL)
  assert.deepEqual(
    igual.organizadores.map((organizador) => organizador.nombre),
    ['Primero', 'Tercero', 'Segundo'],
  )
})

test('no se puede cargar dos veces el mismo organizador, aunque se escriba distinto', () => {
  base()
  guardarOrganizador(null, ORGANIZADOR, DANIEL)
  assert.throws(
    () => guardarOrganizador(null, { ...ORGANIZADOR, nombre: 'organización  sur' }, DANIEL),
    /Ya hay un organizador cargado/,
  )
})

test('sólo el superadministrador carga las listas; el resto del equipo las consulta', () => {
  base()
  assert.throws(() => guardarOrganizador(null, ORGANIZADOR, LUCIA), /sólo el superadministrador/i)
  guardarOrganizador(null, ORGANIZADOR, DANIEL)
  const listas = listasDeCompanias(LUCIA)
  assert.equal(listas.organizadores.length, 1, 'la lista se ve igual')
  assert.equal(listas.puedeEditar, false, 'pero la pantalla no ofrece cargar nada')
})

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------

test('el precio se acepta con coma o con punto, y el cero se rechaza', () => {
  base()
  const conComa = guardarPrecio(null, { ...PRECIO, precio: '18.500,50' }, DANIEL)
  assert.equal(conComa.precios[0]!.precio, 18500.5, '«18.500,50» es argentino: punto de miles, coma de decimales')

  borrarPrecio(conComa.precios[0]!.id, DANIEL)
  const conPunto = guardarPrecio(null, { ...PRECIO, precio: '18500.5' }, DANIEL)
  assert.equal(conPunto.precios[0]!.precio, 18500.5, 'y «18500.5» es como lo escribe una planilla')

  assert.throws(() => guardarPrecio(null, { ...PRECIO, compania: 'RUS', precio: '0' }, DANIEL), /mayor que cero/)
  assert.throws(() => guardarPrecio(null, { ...PRECIO, compania: 'RUS', precio: 'ochenta mil' }, DANIEL), /tiene que ser un número/)
})

test('los precios se leen del más barato al más caro dentro de cada cobertura', () => {
  base()
  guardarPrecio(null, { ...PRECIO, compania: 'ATM', precio: '18500' }, DANIEL)
  guardarPrecio(null, { ...PRECIO, compania: 'Metropol', precio: '12300' }, DANIEL)
  const listas = guardarPrecio(null, { ...PRECIO, compania: 'RUS', precio: '15000' }, DANIEL)

  assert.deepEqual(
    listas.precios.map((precio) => precio.compania),
    ['Metropol', 'RUS', 'ATM'],
    'la pregunta del mostrador es cuál es la más barata: tiene que estar primera',
  )
})

test('no hay dos precios para la misma compañía, cobertura y rama', () => {
  base()
  guardarPrecio(null, PRECIO, DANIEL)
  assert.throws(() => guardarPrecio(null, { ...PRECIO, compania: 'atm', precio: '19000' }, DANIEL), /Ya hay un precio cargado/)
  // Otra rama sí es otro precio: la moto no sale lo mismo que el auto.
  const listas = guardarPrecio(null, { ...PRECIO, rama: 'MOTO', precio: '9000' }, DANIEL)
  assert.equal(listas.precios.length, 2)
})

test('la fecha desde la que rige el precio tiene que existir', () => {
  base()
  assert.throws(() => guardarPrecio(null, { ...PRECIO, vigenteDesde: '2026-02-31' }, DANIEL), /no es una fecha que exista/)
  // Vacía sí vale: no siempre se sabe desde cuándo rige, y la pantalla lo marca como «sin fecha».
  const listas = guardarPrecio(null, { ...PRECIO, vigenteDesde: '' }, DANIEL)
  assert.equal(listas.precios[0]!.vigenteDesde, null)
})

// ---------------------------------------------------------------------------
// Grúas
// ---------------------------------------------------------------------------

test('la grúa sin kilómetros es ilimitada, y la de cero kilómetros no existe', () => {
  base()
  const listas = guardarGrua(null, { ...GRUA, kilometros: '' }, DANIEL)
  assert.equal(listas.gruas[0]!.kilometros, null, 'vacío es ilimitada, no «sin cargar»')
  assert.throws(() => guardarGrua(null, { ...GRUA, compania: 'RUS', kilometros: '0' }, DANIEL), /entre 1 y 20000/)
})

test('no hay dos grúas para la misma compañía y cobertura', () => {
  base()
  guardarGrua(null, GRUA, DANIEL)
  assert.throws(() => guardarGrua(null, { ...GRUA, kilometros: '300' }, DANIEL), /Ya hay una grúa cargada/)
})

// ---------------------------------------------------------------------------
// Cláusulas
// ---------------------------------------------------------------------------

test('las cláusulas se agrupan por cobertura, primero lo que ampara y después lo que no', () => {
  base()
  guardarClausula(null, { ...CLAUSULA, clausula: 'Granizo', ampara: false }, DANIEL)
  guardarClausula(null, CLAUSULA, DANIEL)
  const listas = guardarClausula(null, { ...CLAUSULA, clausula: 'Incendio' }, DANIEL)

  assert.deepEqual(
    listas.clausulas.map((clausula) => `${clausula.clausula}:${clausula.ampara ? 'sí' : 'no'}`),
    ['Robo total:sí', 'Incendio:sí', 'Granizo:no'],
  )
})

test('la misma cláusula se puede cargar general y como excepción de una compañía', () => {
  base()
  guardarClausula(null, CLAUSULA, DANIEL)
  // Sin compañía vale para todas; con compañía es la excepción, y son dos filas distintas.
  const listas = guardarClausula(null, { ...CLAUSULA, compania: 'Metropol', ampara: false }, DANIEL)
  assert.equal(listas.clausulas.length, 2)
  assert.throws(() => guardarClausula(null, { ...CLAUSULA, clausula: 'ROBO  TOTAL' }, DANIEL), /Ya hay una cláusula/)
})

// ---------------------------------------------------------------------------
// Antigüedad
// ---------------------------------------------------------------------------

/** Carga una regla en la matriz de Cartera, que es de donde lee la consulta de antigüedad. */
function regla(compania: string, cobertura: string, anioMinimo: string): void {
  crearRegla(
    { compania, cobertura, incluye: '', franquicia: '', detalle: '', observaciones: '', antiguedadMaxima: '', anioMinimo },
    DANIEL,
  )
}

test('la consulta de antigüedad separa lo que le venden a ese modelo de lo que no', () => {
  base()
  regla('ATM', 'RESPONSABILIDAD CIVIL', '1990')
  regla('ATM', 'TODO RIESGO', '2018')
  regla('Metropol', 'RESPONSABILIDAD CIVIL', '2015')

  const consulta = consultarAntiguedad('2011')
  assert.equal(consulta.anio, 2011)
  assert.equal(consulta.antiguedad, consulta.anioActual - 2011)

  const atm = consulta.companias.find((compania) => compania.compania === 'ATM')!
  assert.deepEqual(atm.acepta.map((cobertura) => cobertura.cobertura), ['RESPONSABILIDAD CIVIL'])
  assert.deepEqual(atm.rechaza.map((cobertura) => cobertura.cobertura), ['TODO RIESGO'])

  const metropol = consulta.companias.find((compania) => compania.compania === 'Metropol')!
  assert.equal(metropol.acepta.length, 0, 'a un 2011 no le vende nada')

  // Arriba la que más coberturas ofrece: es por dónde se empieza a llamar.
  assert.equal(consulta.companias[0]!.compania, 'ATM')
})

test('el año se puede escribir con dos cifras, y lo que no es un año no se contesta', () => {
  base()
  regla('ATM', 'RESPONSABILIDAD CIVIL', '2015')

  assert.equal(consultarAntiguedad('11').anio, 2011, '«11» es 2011, como se tipea en el mostrador')
  assert.equal(consultarAntiguedad('1').anio, null)
  assert.equal(consultarAntiguedad('19').anio, 2019)
  assert.equal(consultarAntiguedad('').anio, null)

  // Sin año no se decide nada: todas las coberturas quedan del lado de «entra».
  const sinAnio = consultarAntiguedad('')
  assert.equal(sinAnio.companias[0]!.rechaza.length, 0)
})

test('una compañía sin reglas se nombra aparte: «no sé» no es lo mismo que «no»', () => {
  const db = base()
  polizaActiva(db, 'ATM', 'RESPONSABILIDAD CIVIL')
  polizaActiva(db, 'Metropol', 'RESPONSABILIDAD CIVIL')
  regla('ATM', 'RESPONSABILIDAD CIVIL', '2015')

  const consulta = consultarAntiguedad('2011')
  assert.deepEqual(consulta.companias.map((compania) => compania.compania), ['ATM'])
  assert.deepEqual(consulta.sinReglas, ['Metropol'], 'trabaja en la cartera y nadie cargó hasta qué modelo toma')
})

test('una regla sin límite acepta cualquier modelo', () => {
  base()
  crearRegla(
    { compania: 'RUS', cobertura: 'RESPONSABILIDAD CIVIL', incluye: '', franquicia: '', detalle: '', observaciones: '', antiguedadMaxima: '', anioMinimo: '' },
    DANIEL,
  )
  const consulta = consultarAntiguedad('1975')
  assert.equal(consulta.companias[0]!.acepta.length, 1)
  assert.equal(consulta.companias[0]!.acepta[0]!.limite, 'sin límite de antigüedad')
})

// ---------------------------------------------------------------------------
// Compartir entre computadoras
// ---------------------------------------------------------------------------

test('la huella no cambia si no cambian los datos, y cambia apenas se toca uno', () => {
  base()
  guardarPrecio(null, PRECIO, DANIEL)
  const antes = huellaDeReferencias()
  assert.equal(huellaDeReferencias(), antes, 'dos lecturas seguidas tienen que dar lo mismo')

  const precio = listasDeCompanias(DANIEL).precios[0]!
  guardarPrecio(precio.id, { ...PRECIO, precio: '19000' }, DANIEL)
  assert.notEqual(huellaDeReferencias(), antes)
})

test('adoptar lo publicado deja la computadora exactamente igual a la que publicó', () => {
  base()
  guardarOrganizador(null, ORGANIZADOR, DANIEL)
  guardarPrecio(null, PRECIO, DANIEL)
  guardarGrua(null, GRUA, DANIEL)
  guardarClausula(null, CLAUSULA, DANIEL)
  const publicada = instantaneaDeReferencias()
  const huella = huellaDeReferencias()
  const original = listasDeCompanias(DANIEL)

  // La otra computadora: arranca con otra cosa cargada y adopta lo que bajó.
  base()
  guardarPrecio(null, { ...PRECIO, compania: 'Vieja', precio: '999' }, DANIEL)
  const resultado = adoptarInstantanea(JSON.parse(JSON.stringify(publicada)))
  assert.equal(resultado.adoptadas, true)

  const adoptadas = listasDeCompanias(DANIEL)
  assert.equal(huellaDeReferencias(), huella, 'la huella tiene que ser la misma de la máquina que publicó')
  assert.deepEqual(
    adoptadas.precios.map((precio) => `${precio.compania}:${precio.precio}`),
    original.precios.map((precio) => `${precio.compania}:${precio.precio}`),
    'adoptar REEMPLAZA: el precio viejo no puede sobrevivir mezclado con los nuevos',
  )
  assert.equal(adoptadas.organizadores[0]!.nombre, ORGANIZADOR.nombre)
  assert.equal(adoptadas.gruas[0]!.kilometros, 200)
  assert.equal(adoptadas.clausulas[0]!.clausula, CLAUSULA.clausula)
})

test('lo que publicó una versión más nueva no se adopta a medias: no se adopta', () => {
  base()
  guardarPrecio(null, PRECIO, DANIEL)
  const antes = huellaDeReferencias()

  const resultado = adoptarInstantanea({ version: 99, organizadores: [], precios: [], gruas: [], clausulas: [] })
  assert.equal(resultado.adoptadas, false)
  assert.match(resultado.detalle, /versión más nueva/)
  assert.equal(huellaDeReferencias(), antes, 'y lo que había en esta computadora quedó intacto')
})

test('lo que se cargó acá y no se publicó cuenta como cambio sin publicar', () => {
  base()
  assert.equal(hayCambiosSinPublicar(), false, 'una computadora recién instalada no tiene nada que perder')

  guardarPrecio(null, PRECIO, DANIEL)
  assert.equal(hayCambiosSinPublicar(), true, 'lo cargado y no publicado no se puede pisar en el arranque')

  // Adoptar iguala esta computadora con el servidor: desde ahí ya no hay nada pendiente.
  adoptarInstantanea(instantaneaDeReferencias())
  assert.equal(hayCambiosSinPublicar(), false)

  guardarPrecio(null, { ...PRECIO, compania: 'RUS', precio: '15000' }, DANIEL)
  assert.equal(hayCambiosSinPublicar(), true, 'y vuelve a haber pendiente apenas se toca una lista')
})

test('una fila rota de lo publicado se saltea sola, sin llevarse puesta la adopción entera', () => {
  base()
  const publicada = {
    version: 1,
    organizadores: [],
    gruas: [],
    clausulas: [],
    precios: [
      { compania: 'ATM', cobertura: 'RESPONSABILIDAD CIVIL', rama: 'AUTO', precio: 18500, vigente_desde: null, observaciones: null },
      // Sin importe: la tabla lo exige y no se puede inventar.
      { compania: 'RUS', cobertura: 'RESPONSABILIDAD CIVIL', rama: 'AUTO', precio: null, vigente_desde: null, observaciones: null },
      // Sin compañía ni cobertura no hay con qué armar la clave: no se podría volver a encontrar.
      { compania: '', cobertura: '', rama: null, precio: 100, vigente_desde: null, observaciones: null },
    ],
  }

  const resultado = adoptarInstantanea(publicada)
  assert.equal(resultado.adoptadas, true)
  assert.deepEqual(
    listasDeCompanias(DANIEL).precios.map((precio) => precio.compania),
    ['ATM'],
    'entra el precio sano y los dos rotos quedan afuera',
  )
})
